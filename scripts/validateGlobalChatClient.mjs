import assert from 'node:assert/strict'
import { createGlobalChatClient, validateChatSnapshot, GlobalChatError } from '../src/globalChatClient.js'

const message = { id: 'message-1', name: 'guest-123456', text: '함께 배틀해요!', createdAt: 1_800_000_000_000, isOwn: false }
const snapshot = { revision: 1, latest: message, messages: [message] }
const endpoint = 'http://127.0.0.1:5186/api/chat'
let passed = 0
async function test(label, run) { await run(); passed++; console.log(`PASS ${label}`) }
const response = (body = snapshot, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

await test('authenticated POST uses current token and bounded snapshot', async () => {
  let token = 'first-token'
  const requests = []
  const client = createGlobalChatClient({ apiUrl: endpoint, getIdToken: async () => token,
    fetchImpl: async (url, options) => { requests.push({ url, ...options }); return response() } })
  assert.deepEqual(await client.request('read', { expanded: true }), snapshot)
  token = 'refreshed-token'
  await client.request('send', { text: message.text, requestId: 'retry-same-id' })
  assert.equal(requests[0].headers.Authorization, 'Bearer first-token')
  assert.equal(requests[1].headers.Authorization, 'Bearer refreshed-token')
  assert.equal(requests[1].credentials, 'omit')
  assert.equal(requests[1].redirect, 'error')
  assert.equal(requests[1].cache, 'no-store')
  assert.deepEqual(JSON.parse(requests[1].body), { text: message.text, requestId: 'retry-same-id', action: 'send' })
})
await test('token absence never contacts chat server', async () => {
  let called = false
  const client = createGlobalChatClient({ apiUrl: endpoint, fetchImpl: () => { called = true } })
  await assert.rejects(client.request('read'), { code: 'UNAUTHENTICATED' })
  assert.equal(called, false)
})
await test('identity change while obtaining a token cancels before fetch', async () => {
  let current = true, called = false
  const client = createGlobalChatClient({ apiUrl: endpoint, isCurrent: () => current,
    getIdToken: async () => { current = false; return 'former-user-token' }, fetchImpl: () => { called = true } })
  await assert.rejects(client.request('read'), { code: 'CHAT_IDENTITY_CHANGED' })
  assert.equal(called, false)
})
await test('identity change during response refuses former account data', async () => {
  let current = true
  const client = createGlobalChatClient({ apiUrl: endpoint, isCurrent: () => current, getIdToken: async () => 'test-token',
    fetchImpl: async () => { current = false; return response() } })
  await assert.rejects(client.request('read'), { code: 'CHAT_IDENTITY_CHANGED' })
})
await test('external cancellation prevents fetch and preserves AbortError', async () => {
  const controller = new AbortController()
  controller.abort()
  let called = false
  const client = createGlobalChatClient({ apiUrl: endpoint, getIdToken: async () => 'test-token', fetchImpl: () => { called = true } })
  await assert.rejects(client.request('read', {}, { signal: controller.signal }), { name: 'AbortError' })
  assert.equal(called, false)
})
await test('server cooldown and validation messages remain actionable', async () => {
  const client = createGlobalChatClient({ apiUrl: endpoint, getIdToken: async () => 'test-token',
    fetchImpl: async () => response({ error: { code: 'SEND_RATE_LIMITED', message: '잠시 후 다시 보내주세요.' } }, 429) })
  await assert.rejects(client.request('send'), { code: 'SEND_RATE_LIMITED', status: 429, message: '잠시 후 다시 보내주세요.' })
})
await test('network failures do not expose underlying credentials or URL', async () => {
  const client = createGlobalChatClient({ apiUrl: endpoint, getIdToken: async () => 'test-token', fetchImpl: async () => { throw Error('private-secret') } })
  await assert.rejects(client.request('read'), error => error instanceof GlobalChatError && !error.message.includes('private-secret'))
})
await test('invalid response and more than30 messages fail safely', async () => {
  for (const body of [null, {}, { ...snapshot, revision: -1 }, { ...snapshot, messages: Array(31).fill(message) },
    { ...snapshot, messages: [message, message] }, { ...snapshot, latest: { ...message, text: 'a'.repeat(201) } },
    { ...snapshot, latest: { ...message, createdAt: '2026-09-14' } }]) {
    assert.throws(() => validateChatSnapshot(body), { code: 'CHAT_INVALID_RESPONSE' })
  }
})
await test('compact unchanged response and Unicode200 message are valid', async () => {
  assert.deepEqual(validateChatSnapshot({ revision: 0, latest: null }), { revision: 0, latest: null })
  const unicode = { ...message, text: '😀'.repeat(200) }
  assert.equal(validateChatSnapshot({ revision: 2, latest: unicode }).latest.text, unicode.text)
})
await test('insecure remote endpoint and URL credentials are rejected', async () => {
  for (const apiUrl of ['http://example.com/api/chat', 'https://user:pass@example.com/api/chat', 'file:///tmp/chat']) {
    assert.throws(() => createGlobalChatClient({ apiUrl }), { code: 'CHAT_INVALID_ENDPOINT' })
  }
})
console.log(`Global chat client: ${passed} checks passed.`)
