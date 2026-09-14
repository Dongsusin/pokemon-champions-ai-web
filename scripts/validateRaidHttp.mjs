import assert from 'node:assert/strict'
import test from 'node:test'
import { createRaidHttpHandler, createLocalRaidAuthenticator, handleProductionRaidRequest } from '../server/raidHttp.js'

// The real HTTP parser/authentication boundary is exercised against a counting
// in-memory service. No Firebase token exchange, DB connection or production
// mutation is performed by this suite.
const URL_BASE = 'https://raid.example.test/api/raid'
const BODY_LIMIT = 128 * 1024
const identity = { uid: 'http-verified-owner', name: '검증트레이너', isGuest: false }
const secret = 'private-token-database-credential-DO-NOT-EXPOSE'

function request({ method = 'POST', body = { action: 'raidAdvance', requestId: 'http-request-1234' }, token = 'verified-test-bearer', headers = {}, url = URL_BASE } = {}) {
  const headerValues = { ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
    ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}), ...headers }
  return new Request(url, { method, headers: headerValues,
    ...(!['GET', 'HEAD'].includes(method) && body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) })
}

function fixture(overrides = {}) {
  const calls = [], authentications = []
  let time = 1000
  const handler = createRaidHttpHandler({
    enabled: true, now: () => time,
    service: { execute: async (...args) => { calls.push(structuredClone(args)); return { ok: true } } },
    authenticate: async (_request, token, options) => { authentications.push({ token, options }); return identity },
    ...overrides,
  })
  return { handler, calls, authentications, advance: ms => { time += ms } }
}

async function expectError(response, status, code) {
  assert.equal(response.status, status)
  assert.equal(response.headers.get('Cache-Control'), 'no-store')
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff')
  const body = await response.json()
  assert.equal(body.error?.code, code)
  assert.equal(JSON.stringify(body).includes(secret), false)
  return body
}

function withEnv(values, run) {
  const previous = new Map(Object.keys(values).map(key => [key, process.env[key]]))
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  const restore = () => { for (const [key, value] of previous) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  } }
  try {
    const result = run()
    if (result && typeof result.finally === 'function') return result.finally(restore)
    restore()
    return result
  } catch (error) { restore(); throw error }
}

test('disabled feature, missing handler dependencies and explicit startup failure return 503 before authentication or mutation', async () => {
  for (const [overrides, code] of [[{ enabled: false }, 'RAID_DISABLED'], [{ service: null }, 'RAID_DISABLED'],
    [{ authenticate: null }, 'RAID_DISABLED'], [{ unavailable: true }, 'RAID_UNAVAILABLE']]) {
    const f = fixture(overrides)
    await expectError(await f.handler(request()), 503, code)
    assert.equal(f.calls.length, 0)
    assert.equal(f.authentications.length, 0)
  }
  await withEnv({ RAID_ENABLED: undefined }, async () => {
    // The production entrypoint must stop at its feature gate without loading
    // credentials or attempting a production service connection.
    await expectError(await handleProductionRaidRequest(request()), 503, 'RAID_DISABLED')
  })
})

test('missing, malformed, too-short and oversized bearer credentials return 401 without invoking authentication or service', async () => {
  const f = fixture()
  for (const authorization of [undefined, '', 'Basic not-a-bearer', 'Bearer short', 'Bearer white space', `Bearer ${'x'.repeat(4097)}`]) {
    await expectError(await f.handler(request({ token: null, headers: authorization === undefined ? {} : { Authorization: authorization } })), 401, 'UNAUTHENTICATED')
  }
  assert.equal(f.authentications.length, 0)
  assert.equal(f.calls.length, 0)
})

test('invalid, revoked, expired and disabled Firebase identities are 401 rather than infrastructure failures', async () => {
  for (const code of ['auth/argument-error', 'auth/invalid-argument', 'auth/invalid-id-token', 'auth/id-token-expired',
    'auth/id-token-revoked', 'auth/user-disabled', 'auth/user-not-found', 'UNAUTHENTICATED']) {
    const f = fixture({ authenticate: async () => { throw Object.assign(new Error(secret), { code, ...(code === 'UNAUTHENTICATED' ? { status: 401 } : {}) }) } })
    await expectError(await f.handler(request()), 401, 'UNAUTHENTICATED')
    assert.equal(f.calls.length, 0)
  }
})

test('authentication provider failure returns 503 and emits only bounded diagnostics', async t => {
  const logs = []
  t.mock.method(console, 'error', (...args) => { logs.push(args) })
  const f = fixture({ authenticate: async () => { throw Object.assign(new Error(secret), { code: 'auth/internal-error', rankedStartupStep: secret }) } })
  await expectError(await f.handler(request()), 503, 'RAID_UNAVAILABLE')
  assert.equal(f.calls.length, 0)
  assert.equal(logs.length, 1)
  assert.equal(JSON.stringify(logs).includes(secret), false)
  assert.equal(logs[0][1].code, 'auth/internal-error')
})

test('GET mutations and unsupported verbs are 405 and never reach the service', async () => {
  const f = fixture()
  for (const action of ['roomCreate', 'roomJoin', 'roomLeave', 'roomReady', 'roomStart', 'raidSubmit', 'raidRevoke', 'raidAdvance', 'raidHeartbeat', 'raidWithdraw', 'raidDismissResult']) {
    await expectError(await f.handler(request({ method: 'GET', url: `${URL_BASE}?action=${action}` })), 405, 'METHOD_NOT_ALLOWED')
  }
  for (const method of ['PUT', 'PATCH', 'DELETE']) await expectError(await f.handler(request({ method })), 405, 'METHOD_NOT_ALLOWED')
  assert.equal(f.calls.length, 0)
  assert.equal(f.authentications.length, 0)
})

test('cross-origin and cross-site requests are forbidden; only explicit loopback development CORS is allowed', async () => {
  const f = fixture()
  for (const headers of [{ Origin: 'https://other.example.test' }, { Origin: 'null' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    await expectError(await f.handler(request({ headers })), 403, 'ORIGIN_FORBIDDEN')
  }
  assert.equal(f.calls.length, 0)
  assert.equal(f.authentications.length, 0)
  const local = fixture({ allowLocalOrigins: true })
  await expectError(await local.handler(request({ url: 'http://127.0.0.1/api/raid', headers: { Origin: 'https://other.example.test' } })), 403, 'ORIGIN_FORBIDDEN')
  await expectError(await local.handler(request({ headers: { Origin: 'http://127.0.0.1:5186' } })), 403, 'ORIGIN_FORBIDDEN')
  const permitted = await local.handler(request({ url: 'http://127.0.0.1/api/raid', headers: { Origin: 'http://localhost:5186' } }))
  assert.equal(permitted.status, 200)
  assert.equal(permitted.headers.get('Access-Control-Allow-Origin'), 'http://localhost:5186')
  assert.equal(permitted.headers.get('Vary'), 'Origin')
  assert.equal(local.calls.length, 1)
})

test('malformed JSON, missing body, non-object payloads and wrong content types never reach authentication or mutation', async () => {
  const f = fixture()
  for (const body of ['{', '', 'null', '[]', '123', '"scalar"']) await expectError(await f.handler(request({ body })), 400, 'INVALID_JSON')
  await expectError(await f.handler(new Request(URL_BASE, { method: 'POST', headers: { Authorization: 'Bearer verified-test-bearer', 'Content-Type': 'application/json' } })), 400, 'INVALID_JSON')
  for (const contentType of ['', 'text/plain', 'application/x-www-form-urlencoded']) {
    await expectError(await f.handler(request({ headers: { 'Content-Type': contentType } })), 415, 'INVALID_CONTENT_TYPE')
  }
  assert.equal(f.calls.length, 0)
  assert.equal(f.authentications.length, 0)
})

test('the 128 KiB body limit covers declared and streamed bytes, including misleading Content-Length', async () => {
  const f = fixture()
  await expectError(await f.handler(request({ body: '{}', headers: { 'Content-Length': String(BODY_LIMIT + 1) } })), 413, 'BODY_TOO_LARGE')
  const encoded = new TextEncoder().encode(JSON.stringify({ text: '한'.repeat(BODY_LIMIT / 2) }))
  let offset = 0, cancelled = false
  const stream = new ReadableStream({
    pull(controller) {
      if (offset >= encoded.length) { controller.close(); return }
      const end = Math.min(offset + 16_384, encoded.length)
      controller.enqueue(encoded.subarray(offset, end))
      offset = end
    },
    cancel() { cancelled = true },
  })
  const streamed = new Request(URL_BASE, { method: 'POST', duplex: 'half', body: stream,
    headers: { Authorization: 'Bearer verified-test-bearer', 'Content-Type': 'application/json', 'Content-Length': '1' } })
  await expectError(await f.handler(streamed), 413, 'BODY_TOO_LARGE')
  assert.equal(cancelled, true)
  assert.equal(f.calls.length, 0)
  assert.equal(f.authentications.length, 0)
  const atLimit = JSON.stringify({ text: 'a'.repeat(BODY_LIMIT - JSON.stringify({ text: '' }).length) })
  assert.equal(Buffer.byteLength(atLimit), BODY_LIMIT)
  assert.equal((await f.handler(request({ body: atLimit }))).status, 200)
  assert.equal(f.calls.length, 1)
})

test('local test authentication requires an explicit development flag and never accepts production hosts', async () => {
  for (const enabled of [undefined, false, 'true']) assert.throws(() => createLocalRaidAuthenticator({ enabled, production: false }))
  assert.throws(() => createLocalRaidAuthenticator({ enabled: true, production: true }))
  withEnv({ NODE_ENV: 'production', VERCEL: undefined }, () => assert.throws(() => createLocalRaidAuthenticator({ enabled: true })))
  withEnv({ NODE_ENV: 'development', VERCEL: '1' }, () => assert.throws(() => createLocalRaidAuthenticator({ enabled: true })))
  const authenticate = createLocalRaidAuthenticator({ enabled: true, production: false })
  await assert.rejects(authenticate(request({ url: URL_BASE }), 'local-alice'), { code: 'LOCAL_ONLY', status: 403 })
  await assert.rejects(authenticate(request({ url: 'https://127.0.0.1/api/raid' }), 'local-alice'), { code: 'LOCAL_ONLY', status: 403 })
  await assert.rejects(authenticate(request({ url: 'http://127.0.0.1/api/raid' }), 'invalid-local-token'), { code: 'UNAUTHENTICATED', status: 401 })
})

test('accepted requests use verified identity, preserve compact read parameters and request fresh names only for public joins', async () => {
  const f = fixture()
  const get = await f.handler(request({ method: 'GET', url: `${URL_BASE}?action=status&raidId=raid-test&sinceRevision=4&revision=3&eventCursor=2&uid=forged-owner` }))
  assert.equal(get.status, 200)
  assert.deepEqual(f.calls[0], [identity, { action: 'status', raidId: 'raid-test', sinceRevision: '4', revision: '3', eventCursor: '2' }])
  assert.equal(f.authentications[0].options.freshNickname, false)
  for (const action of ['roomCreate', 'roomJoin', 'raidAdvance']) {
    assert.equal((await f.handler(request({ body: { action, requestId: `accepted-${action}`, uid: 'forged-owner' } }))).status, 200)
    assert.deepEqual(f.calls.at(-1)[0], identity)
    assert.equal(f.authentications.at(-1).options.freshNickname, action !== 'raidAdvance')
  }
})

test('per-identity mutation throttling rejects before service execution and recovers after the window', async () => {
  const f = fixture()
  for (let index = 0; index < 20; index++) assert.equal((await f.handler(request())).status, 200)
  await expectError(await f.handler(request()), 429, 'RATE_LIMITED')
  assert.equal(f.calls.length, 20)
  f.advance(10_000)
  assert.equal((await f.handler(request())).status, 200)
  assert.equal(f.calls.length, 21)
})

test('unexpected service failures are 503 without response or log disclosure of private data', async t => {
  const logs = []
  t.mock.method(console, 'error', (...args) => { logs.push(args) })
  let calls = 0
  const f = fixture({ service: { execute: async () => { calls++; throw Object.assign(new Error(secret), { code: secret, rankedStartupStep: secret }) } } })
  await expectError(await f.handler(request()), 503, 'RAID_UNAVAILABLE')
  assert.equal(calls, 1)
  assert.equal(logs.length, 1)
  assert.equal(JSON.stringify(logs).includes(secret), false)
  assert.equal(logs[0][1].code, 'unknown')
})
