import assert from 'node:assert/strict'
import test from 'node:test'
import { generateKeyPairSync, sign } from 'node:crypto'
import { createDiscordInteractionHandler } from '../server/discordInteractionHttp.js'

const keys = generateKeyPairSync('ed25519')
const publicKey = keys.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex')
const time = 1_789_200_000_000
const env = {
  DISCORD_PUBLIC_KEY: publicKey, DISCORD_APPLICATION_ID: '100000000000000001',
  DISCORD_GUILD_ID: '100000000000000002', DISCORD_BOT_TOKEN: 'fixture-token-never-real',
  DISCORD_FREE_CHANNEL_ID: '100000000000000003', DISCORD_BUG_CHANNEL_ID: '100000000000000004',
  DISCORD_IDEA_CHANNEL_ID: '100000000000000005', DISCORD_UPDATE_CHANNEL_ID: '100000000000000006',
}
const interaction = {
  id: '100000000000000010', application_id: env.DISCORD_APPLICATION_ID, guild_id: env.DISCORD_GUILD_ID,
  type: 2, data: { name: '안내' }, token: 'interaction-fixture',
  member: { user: { id: '100000000000000011' }, permissions: '0', roles: [] },
}
function request(payload, { timestamp = String(time / 1000), raw, headers = {}, key = keys.privateKey } = {}) {
  const body = raw ?? JSON.stringify(payload)
  const signature = sign(null, Buffer.concat([Buffer.from(timestamp), Buffer.from(body)]), key).toString('hex')
  return new Request('https://test.invalid/api/discord-interactions', {
    method: 'POST', body, headers: { 'Content-Type': 'application/json',
      'X-Signature-Timestamp': timestamp, 'X-Signature-Ed25519': signature, ...headers },
  })
}
function harness(options = {}) {
  const calls = []
  const jobs = []
  const handle = createDiscordInteractionHandler({ env, now: () => time,
    restFactory: () => { throw new Error('No test may reach a real REST client') },
    prepare: () => { throw new Error('Unexpected dispatch') },
    schedule: promise => jobs.push(promise), ...options,
  })
  return { handle, calls, jobs }
}

test('Discord PING verifies exact raw JSON bytes and works before channel setup', async () => {
  const { handle } = harness({ env: { DISCORD_PUBLIC_KEY: publicKey } })
  const response = await handle(request(null, { raw: '{  "type" : 1, "text":"안녕하세요" }\n' }))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { type: 1 })
  assert.equal(response.headers.get('cache-control'), 'no-store')
})

for (const kind of ['altered body', 'wrong key', 'missing signature', 'malformed signature', 'stale', 'future']) {
  test(`Reject ${kind} without processing an interaction`, async () => {
    const { handle } = harness()
    let req
    if (kind === 'altered body') {
      const original = request({ type: 1 })
      req = new Request(original.url, { method: 'POST', headers: original.headers, body: '{"type":2}' })
    } else if (kind === 'wrong key') req = request({ type: 1 }, { key: generateKeyPairSync('ed25519').privateKey })
    else if (kind === 'missing signature') req = request({ type: 1 }, { headers: { 'X-Signature-Ed25519': '' } })
    else if (kind === 'malformed signature') req = request({ type: 1 }, { headers: { 'X-Signature-Ed25519': 'zz'.repeat(64) } })
    else req = request({ type: 1 }, { timestamp: String(time / 1000 + (kind === 'future' ? 301 : -301)) })
    assert.equal((await handle(req)).status, 401)
  })
}

test('Reject a signed oversized payload even without Content-Length', async () => {
  const { handle } = harness()
  assert.equal((await handle(request(null, { raw: ' '.repeat(65537) }))).status, 413)
})
test('Reject invalid JSON, non-object JSON, wrong content type, and unsupported method', async () => {
  const { handle } = harness()
  assert.equal((await handle(request(null, { raw: '{broken' }))).status, 400)
  assert.equal((await handle(request([]))).status, 400)
  assert.equal((await handle(request({ type: 1 }, { headers: { 'Content-Type': 'text/plain' } }))).status, 415)
  const method = await handle(new Request('https://test.invalid/api/discord-interactions'))
  assert.equal(method.status, 405)
  assert.equal(method.headers.get('allow'), 'POST')
})
test('Missing configuration never exposes secrets or sends messages', async () => {
  assert.equal((await harness({ env: {} }).handle(request({ type: 1 }))).status, 503)
  const { handle } = harness({ env: { ...env, DISCORD_BUG_CHANNEL_ID: '' } })
  const result = await (await handle(request(interaction))).json()
  assert.equal(result.data.flags, 64)
  assert(!JSON.stringify(result).includes(env.DISCORD_BOT_TOKEN))
})
for (const field of ['guild_id', 'application_id']) {
  test(`A signed interaction from a different ${field} cannot dispatch`, async () => {
    const { handle } = harness()
    const result = await (await handle(request({ ...interaction, [field]: '100000000000000099' }))).json()
    assert.equal(result.data.flags, 64)
    assert.match(result.data.content, /지정된/)
  })
}
test('Malformed member or token cannot be used to construct an outbound route', async () => {
  const { handle } = harness()
  for (const override of [{ member: {} }, { id: '../path' }, { token: 'x\ny' }, { token: '' }]) {
    assert.equal((await handle(request({ ...interaction, ...override }))).status, 400)
  }
})
test('Valid command dispatches once and caches retried interaction responses', async () => {
  let prepared = 0
  const { handle } = harness({ restFactory: () => ({}), prepare: () => {
    prepared += 1
    return { response: { type: 4, data: { content: '안내', flags: 64 } } }
  } })
  assert.equal((await handle(request(interaction))).status, 200)
  assert.equal((await handle(request(interaction))).status, 200)
  assert.equal(prepared, 1)
})
test('Deferred work is scheduled without waiting for slow Discord requests', async () => {
  let finish
  let executions = 0
  const slow = new Promise(resolve => { finish = resolve })
  const { handle, jobs } = harness({ restFactory: () => ({}), prepare: () => ({
    response: { type: 5, data: { flags: 64 } }, run: async () => { executions += 1; await slow },
  }) })
  const result = await handle(request(interaction))
  assert.deepEqual(await result.json(), { type: 5, data: { flags: 64 } })
  await handle(request(interaction))
  assert.equal(jobs.length, 1)
  assert.equal(executions, 1)
  finish()
  await Promise.all(jobs)
})
test('Unavailable background runtime cannot start an outbound operation', async () => {
  let executions = 0
  const { handle } = harness({ schedule: () => { throw new Error('offline') }, restFactory: () => ({}),
    prepare: () => ({ response: { type: 5 }, run: () => { executions += 1 } }) })
  assert.equal((await handle(request(interaction))).status, 503)
  await Promise.resolve()
  assert.equal(executions, 0)
})
test('Background failures do not log request body or credentials', async () => {
  const observed = []
  const { handle, jobs } = harness({ restFactory: () => ({}), onBackgroundError: (...args) => observed.push(args),
    prepare: () => ({ response: { type: 5 }, run: () => { throw new Error(env.DISCORD_BOT_TOKEN) } }) })
  assert.equal((await handle(request(interaction))).status, 200)
  await Promise.all(jobs)
  assert.deepEqual(observed, [[]])
})
