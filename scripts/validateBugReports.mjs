import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { createBugReportHandler } from '../server/bugReports.js'

const ORIGIN = 'https://game.example.test'
const BASE_TIME = Date.UTC(2026, 8, 11)
const ENV = { BUG_REPORT_ENABLED: 'true', BUG_REPORT_TO: 'owner@example.test' }
const validReport = () => ({
  requestId: randomUUID(), title: '배틀 중 화면이 멈췄습니다', category: 'battle',
  description: '기술을 선택한 뒤 다음 턴으로 진행되지 않았습니다.',
  steps: '배틀 시작\n기술 선택', expected: '다음 턴으로 넘어가야 합니다.',
  replyTo: 'player@example.test', website: '',
  diagnostics: { page: '/battle?token=SECRET#account', viewport: { width: 1440, height: 900 }, screen: { width: 1920, height: 1080 }, userAgent: 'Test Browser', language: 'ko-KR', build: 'test-build' },
})
const jsonResponse = (body = { success: 'true', message: 'The form was submitted successfully.' }, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function setup(options = {}) {
  let time = BASE_TIME
  const calls = []
  let upstream = options.upstream || (() => jsonResponse())
  const handler = createBugReportHandler({
    env: options.env || { ...ENV }, now: () => time, timeoutMs: options.timeoutMs || 1000,
    fetch: async (url, init) => {
      calls.push({ url, ...init, parsedBody: JSON.parse(init.body) })
      return upstream(url, init)
    },
  })
  async function request(body = validReport(), overrides = {}) {
    const req = {
      method: 'POST', body, socket: { remoteAddress: '192.0.2.1' },
      headers: { origin: ORIGIN, host: 'game.example.test', 'x-forwarded-proto': 'https', 'content-type': 'application/json' },
      ...overrides,
    }
    if (overrides.headers) req.headers = { origin: ORIGIN, host: 'game.example.test', 'x-forwarded-proto': 'https', 'content-type': 'application/json', ...overrides.headers }
    const result = { headers: {} }
    const res = {
      statusCode: 200,
      setHeader(name, value) { result.headers[name.toLowerCase()] = value },
      end(value) { result.status = this.statusCode; result.body = JSON.parse(value) },
    }
    await handler(req, res)
    return result
  }
  return { handler, request, calls, advance: value => { time += value }, setUpstream: value => { upstream = value } }
}

const results = []
async function check(name, run) {
  await run()
  results.push(name)
  console.log(`PASS ${name}`)
}

await check('Availability requires explicit enablement and server-only configuration', async () => {
  for (const env of [{}, { BUG_REPORT_TO: ENV.BUG_REPORT_TO }, { ...ENV, BUG_REPORT_ENABLED: 'false' }, { ...ENV, BUG_REPORT_TO: 'bad' }, { ...ENV, BUG_REPORT_PROVIDER: 'unknown' }, { ...ENV, BUG_REPORT_PROVIDER: 'resend' }]) {
    const app = setup({ env })
    assert.deepEqual((await app.request(undefined, { method: 'GET' })).body, { enabled: false })
    assert.equal((await app.request()).status, 503)
    assert.equal(app.calls.length, 0)
  }
  const app = setup()
  const response = await app.request(undefined, { method: 'GET' })
  assert.deepEqual(response.body, { enabled: true })
  assert.equal(response.headers['cache-control'], 'no-store')
  assert.ok(!JSON.stringify(response).includes(ENV.BUG_REPORT_TO))
})

await check('Valid report goes only to configured recipient with sanitized diagnostics', async () => {
  const app = setup()
  const report = { ...validReport(), to: 'attacker@example.test', _cc: 'attacker@example.test', authorization: 'PRIVATE_TOKEN' }
  Object.assign(report.diagnostics, { token: 'PRIVATE_TOKEN', uid: 'PRIVATE_UID', localStorage: 'PRIVATE_SAVE' })
  const response = await app.request(report)
  assert.equal(response.status, 200)
  assert.equal(response.body.ok, true)
  assert.equal(response.body.reportId, `BR-20260911-${report.requestId}`)
  assert.equal(app.calls[0].url, 'https://formsubmit.co/ajax/owner%40example.test')
  const mail = app.calls[0].parsedBody
  assert.equal(mail._replyto, 'player@example.test')
  assert.ok(mail.message.includes('분류: 배틀'))
  assert.ok(mail.message.includes('페이지: /battle\n'))
  assert.ok(mail.message.includes('1440 × 900'))
  assert.ok(mail.message.includes(report.requestId))
  assert.ok(!JSON.stringify(mail).includes('PRIVATE_'))
  assert.ok(!JSON.stringify(mail).includes('SECRET'))
  assert.ok(!JSON.stringify(mail).includes('attacker'))
  assert.equal(app.calls[0].headers.Origin, ORIGIN)
  assert.equal(app.calls[0].redirect, 'error')
  assert.ok(!JSON.stringify(response).includes('owner@'))
})

await check('Diagnostics are optional and do not import unknown fields', async () => {
  const app = setup()
  const report = { ...validReport(), diagnostics: null, replyTo: '' }
  assert.equal((await app.request(report)).status, 200)
  assert.ok(!app.calls[0].parsedBody.message.includes('[사용자가 동의한 진단 정보]'))
  assert.equal(app.calls[0].parsedBody.email, undefined)
  assert.equal(app.calls[0].parsedBody._replyto, undefined)
})

await check('Only same-origin or explicit allowed origins can submit', async () => {
  const app = setup()
  for (const origin of ['', 'null', 'https://evil.example.test', `${ORIGIN}/path`, 'javascript:alert(1)']) {
    assert.equal((await app.request(validReport(), { headers: { origin } })).status, 403)
  }
  assert.equal(app.calls.length, 0)
  const configured = setup({ env: { ...ENV, BUG_REPORT_ALLOWED_ORIGINS: 'https://canonical.example.test, https://www.canonical.example.test' } })
  assert.equal((await configured.request(validReport(), { headers: { origin: 'https://canonical.example.test' } })).status, 200)
})

await check('Methods, media type, malformed and oversized bodies are rejected', async () => {
  const app = setup()
  assert.equal((await app.request(undefined, { method: 'DELETE' })).status, 405)
  assert.equal((await app.request(validReport(), { headers: { 'content-type': 'text/plain' } })).status, 415)
  assert.equal((await app.request('{oops')).status, 400)
  assert.equal((await app.request([])).status, 400)
  assert.equal((await app.request('x'.repeat(32769))).status, 413)
  assert.equal((await app.request(validReport(), { headers: { 'content-length': '99999' } })).status, 413)
  assert.equal((await app.request({ ...validReport(), extra: '가'.repeat(20000) })).status, 413)
  assert.equal(app.calls.length, 0)
})

await check('Raw JSON stream and parsed Vercel bodies both work', async () => {
  const app = setup()
  const report = validReport()
  const stream = Readable.from([Buffer.from(JSON.stringify(report).slice(0, 80)), Buffer.from(JSON.stringify(report).slice(80))])
  Object.assign(stream, { method: 'POST', headers: { origin: ORIGIN, host: 'game.example.test', 'x-forwarded-proto': 'https', 'content-type': 'application/json' }, socket: { remoteAddress: '192.0.2.2' } })
  let parsed
  const res = { setHeader() {}, end(value) { parsed = JSON.parse(value) } }
  await app.handler(stream, res)
  assert.equal(res.statusCode, 200)
  assert.equal(parsed.ok, true)
  app.advance(31000)
  assert.equal((await app.request(Buffer.from(JSON.stringify(validReport())))).status, 200)
})

await check('Required fields, limits, category, UUID and honeypot are enforced', async () => {
  const app = setup()
  for (const invalid of [
    { title: '' }, { title: 't'.repeat(101) }, { description: '짧음' }, { description: 'x'.repeat(4001) },
    { steps: 's'.repeat(2001) }, { expected: 'e'.repeat(1001) }, { title: {} }, { category: 'administrator' },
    { category: '__proto__' }, { requestId: 'not-a-uuid' }, { requestId: [randomUUID()] }, { website: 'https://spam.example.test' },
  ]) assert.equal((await app.request({ ...validReport(), ...invalid })).status, 400, JSON.stringify(invalid).slice(0, 50))
  assert.equal(app.calls.length, 0)
})

await check('Header injection and multiple Reply-To recipients are rejected', async () => {
  const app = setup()
  for (const invalid of [
    { title: '제목\r\nBcc: attacker@example.test' },
    { replyTo: 'a@example.test\r\nBcc: attacker@example.test' },
    { replyTo: 'a@example.test,b@example.test' }, { replyTo: 'A <a@example.test>' },
    { replyTo: 'a@example.test b@example.test' }, { replyTo: 'invalid' },
  ]) assert.equal((await app.request({ ...validReport(), ...invalid })).status, 400)
  assert.equal(app.calls.length, 0)
})

await check('Concurrent duplicates share one in-flight send and completed retries are idempotent', async () => {
  let finish
  const app = setup({ upstream: () => new Promise(resolve => { finish = resolve }) })
  const report = validReport()
  const first = app.request(report)
  const second = app.request(report)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(app.calls.length, 1)
  finish(jsonResponse())
  const [a, b] = await Promise.all([first, second])
  assert.deepEqual(a.body, b.body)
  assert.equal(a.status, 200)
  assert.equal((await app.request(report)).status, 200)
  assert.equal(app.calls.length, 1)
  assert.equal((await app.request({ ...report, title: '변경된 제목' })).status, 409)
})

await check('Failed requests retain their fingerprint but can retry successfully', async () => {
  const app = setup({ upstream: () => jsonResponse({ success: false, message: 'secret provider failure' }) })
  const report = validReport()
  const failed = await app.request(report)
  assert.equal(failed.status, 502)
  assert.equal(failed.body.ok, false)
  assert.ok(!JSON.stringify(failed).includes('secret provider'))
  app.advance(31000)
  assert.equal((await app.request({ ...report, description: '내용을 바꾼 요청은 이전 번호를 사용할 수 없습니다.' })).status, 409)
  app.setUpstream(() => jsonResponse())
  assert.equal((await app.request(report)).status, 200)
  assert.equal(app.calls.length, 2)
})

await check('HTML, malformed JSON, HTTP failures, false and unrecognized success are never accepted', async () => {
  const variants = [
    () => new Response('<html>success</html>', { headers: { 'Content-Type': 'text/html' } }),
    () => new Response('{bad', { headers: { 'Content-Type': 'application/json' } }),
    () => jsonResponse({ success: true }, 500), () => jsonResponse({ success: false }),
    () => jsonResponse({ success: 'false' }), () => jsonResponse({ success: '1' }),
    () => jsonResponse({ accepted: true }), () => { throw new Error('PRIVATE_KEY transport failure') },
  ]
  for (const upstream of variants) {
    const response = await setup({ upstream }).request()
    assert.equal(response.status, 502)
    assert.equal(response.body.ok, false)
    assert.ok(!JSON.stringify(response).includes('PRIVATE_KEY'))
  }
  assert.equal((await setup({ upstream: () => jsonResponse({ success: true }) }).request()).status, 200)
})

await check('Activation-required upstream replies cannot become a false success', async () => {
  for (const message of ['Please activate your form.', 'Check your inbox to confirm your email address.', 'Verify your email before sending.']) {
    const response = await setup({ upstream: () => jsonResponse({ success: 'true', message }) }).request()
    assert.equal(response.status, 503)
    assert.equal(response.body.code, 'ACTIVATION_REQUIRED')
  }
})

await check('FormSubmit JSON with text/html MIME is parsed strictly, including real activation reply', async () => {
  const activation = { success: 'false', message: "This form needs Activation. We've sent you an email containing an 'Activate Form' link. Just click it and your form will be actived!" }
  const upstreamReply = body => () => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'text/html; charset=UTF-8' } })
  const response = await setup({ upstream: upstreamReply(activation) }).request()
  assert.equal(response.status, 503)
  assert.equal(response.body.code, 'ACTIVATION_REQUIRED')
  assert.equal((await setup({ upstream: upstreamReply({ success: 'true', message: 'The form was submitted successfully.' }) }).request()).status, 200)
  for (const body of [{ success: [] }, { success: true, message: {} }, [{ success: true }], null, { arbitrary: true }]) {
    assert.equal((await setup({ upstream: upstreamReply(body) }).request()).status, 502)
  }
})

await check('Upstream timeout aborts the request and preserves retry state', async () => {
  const app = setup({ timeoutMs: 20, upstream: () => new Promise(() => {}) })
  const report = validReport()
  const response = await app.request(report)
  assert.equal(response.status, 504)
  assert.equal(app.calls[0].signal.aborted, true)
  app.advance(31000)
  app.setUpstream(() => jsonResponse())
  assert.equal((await app.request(report)).status, 200)
})

await check('Cooldown and rolling 10-minute quota protect the recipient', async () => {
  const app = setup()
  assert.equal((await app.request()).status, 200)
  let blocked = await app.request()
  assert.equal(blocked.status, 429)
  assert.equal(blocked.body.retryAfter, 30)
  assert.equal(blocked.headers['retry-after'], '30')
  for (let index = 1; index < 5; index++) {
    app.advance(31000)
    assert.equal((await app.request()).status, 200)
  }
  app.advance(31000)
  blocked = await app.request()
  assert.equal(blocked.status, 429)
  assert.equal(app.calls.length, 5)
  app.advance(600000)
  assert.equal((await app.request()).status, 200)
})

await check('Rate limits are separate across client IPs', async () => {
  const app = setup()
  assert.equal((await app.request(validReport(), { headers: { 'x-vercel-forwarded-for': '192.0.2.10' } })).status, 200)
  assert.equal((await app.request(validReport(), { headers: { 'x-vercel-forwarded-for': '192.0.2.11' } })).status, 200)
  assert.equal((await app.request(validReport(), { headers: { 'x-vercel-forwarded-for': '192.0.2.10' } })).status, 429)
})

await check('Resend has fixed sender and recipient, provider idempotency and plain text only', async () => {
  const app = setup({ env: { ...ENV, BUG_REPORT_PROVIDER: 'resend', RESEND_API_KEY: 'SERVER_ONLY_KEY', BUG_REPORT_FROM: 'Arena <reports@example.test>' }, upstream: () => jsonResponse({ id: 'provider-message-id' }) })
  const report = { ...validReport(), from: 'attacker@example.test', to: 'attacker@example.test' }
  const response = await app.request(report)
  assert.equal(response.status, 200)
  assert.equal(app.calls[0].url, 'https://api.resend.com/emails')
  assert.equal(app.calls[0].headers.Authorization, 'Bearer SERVER_ONLY_KEY')
  assert.equal(app.calls[0].headers['Idempotency-Key'], report.requestId)
  assert.equal(app.calls[0].parsedBody.from, 'Arena <reports@example.test>')
  assert.deepEqual(app.calls[0].parsedBody.to, ['owner@example.test'])
  assert.equal(app.calls[0].parsedBody.reply_to, 'player@example.test')
  assert.equal(app.calls[0].parsedBody.html, undefined)
  assert.ok(!JSON.stringify(response).includes('SERVER_ONLY_KEY'))
  assert.ok(!JSON.stringify(response).includes('provider-message-id'))
  const failed = setup({ env: { ...ENV, BUG_REPORT_PROVIDER: 'resend', RESEND_API_KEY: 'KEY', BUG_REPORT_FROM: 'reports@example.test' }, upstream: () => jsonResponse({ success: true }) })
  assert.equal((await failed.request()).status, 502)
})

await check('Instance cache bounds and expired duplicate IDs do not block new reports', async () => {
  const app = setup()
  for (let index = 0; index < 1005; index++) {
    const response = await app.request(validReport(), { headers: { 'x-vercel-forwarded-for': `client-${index}` } })
    assert.equal(response.status, 200)
  }
  assert.equal(app.calls.length, 1005)
  const report = validReport()
  assert.equal((await app.request(report)).status, 200)
  app.advance(31 * 60000)
  assert.equal((await app.request({ ...report, title: '캐시 만료 후 새 내용' })).status, 200)
})

console.log(`\nBug report server: ${results.length} checks passed. No real emails were sent.`)
