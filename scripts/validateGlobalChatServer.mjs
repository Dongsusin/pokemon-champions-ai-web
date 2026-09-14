import assert from 'node:assert/strict'
import { createMemoryRankedStore } from '../server/rankedStore.js'
import { createGuestIdentityRegistry } from '../server/guestIdentity.js'
import { createGlobalChatService, GLOBAL_CHAT_MAX_MESSAGES, GLOBAL_CHAT_SEND_COOLDOWN_MS } from '../server/globalChatService.js'
import { createGlobalChatHttpHandler, GLOBAL_CHAT_HTTP_MAX_BYTES } from '../server/globalChatHttp.js'
import { eraseGuestRankedData } from '../server/guestAccountCleanup.js'
import { CHAT_PROFANITY_MESSAGE } from '../server/chatModeration.js'

const tests = []
const test = (name, run) => tests.push({ name, run })
const alice = { uid: 'chat-private-alice', name: '김비공개', isGuest: false }
const bob = { uid: 'chat-private-bob', name: '이비공개', isGuest: false }
const guest = { uid: 'chat-private-guest', name: 'spoofed-nickname', isGuest: true }
const rejectCode = (promise, code) => assert.rejects(promise, error => error.code === code)

function environment(options = {}) {
  const database = options.database ?? createMemoryRankedStore()
  let timestamp = 1_000_000, serial = 0
  const reads = []
  const store = { transaction: work => database.transaction(tx => work({ ...tx,
    get: async (collection, key) => { reads.push(`${collection}/${key}`); return tx.get(collection, key) },
  })) }
  const registry = createGuestIdentityRegistry({ store, now: () => timestamp, chooseNumber: () => 123456 })
  const service = createGlobalChatService({ store, guestRegistry: registry, now: () => timestamp, newId: () => `server-message-${++serial}` })
  const call = (identity, action, fields = {}) => service.execute(identity, { action, ...fields })
  const send = (identity, text, fields = {}) => call(identity, 'send', { text, requestId: `request-${++serial}`, ...fields })
  const erase = identity => eraseGuestRankedData({ store, guestRegistry: registry,
    rooms: { eraseGuest: async () => {} }, settlement: async () => {}, lobbyLock: async () => {}, now: () => timestamp,
  }, identity)
  return { database, store, registry, service, call, send, erase, reads,
    now: () => timestamp, advance: milliseconds => { timestamp += milliseconds },
  }
}

test('empty collapsed and expanded snapshots agree without any persisted message', async () => {
  const env = environment()
  assert.deepEqual(await env.call(alice, 'read'), { revision: 0, latest: null })
  assert.deepEqual(await env.call(alice, 'read', { expanded: true }), { revision: 0, latest: null, messages: [] })
  assert.deepEqual((await env.database.inspect()).collections, {})
})

test('server identity, server clock and per-view ownership override all spoofed fields', async () => {
  const env = environment()
  const sent = await env.send(alice, '안녕하세요!', {
    uid: bob.uid, name: '운영자', createdAt: 0, id: 'forged-id', owner: bob.uid, isOwn: false, isGuest: true,
  })
  assert.deepEqual(sent.latest, { id: 'server-message-2', name: '김**', text: '안녕하세요!', createdAt: env.now(), isOwn: true })
  const seen = await env.call(bob, 'read', { expanded: true })
  assert.equal(seen.latest.isOwn, false)
  assert.equal(seen.messages[0].isOwn, false)
  assert.deepEqual(Object.keys(seen.messages[0]).sort(), ['createdAt', 'id', 'isOwn', 'name', 'text'])
  assert.doesNotMatch(JSON.stringify(seen), /private|비공개|운영자|owner|requestId|digest/)
  assert.doesNotMatch(JSON.stringify(await env.database.inspect()), /chat-private-alice|김비공개/)
})

test('verified guest names remain public, and unavailable or deleted guest profiles cannot send', async () => {
  const env = environment()
  await rejectCode(env.send(guest, '이름 준비 전'), 'GUEST_PROFILE_REQUIRED')
  await env.registry.create(guest)
  assert.equal((await env.send(guest, '준비 완료')).latest.name, 'guest-123456')
  assert.equal((await env.send({ ...bob, name: 'guest-123456' }, '구글 이름')).latest.name, 'g**')
  await env.registry.beginDeletion(guest)
  env.advance(3000)
  await rejectCode(env.send(guest, '삭제 도중'), 'GUEST_ACCOUNT_DELETED')
  await rejectCode(env.call(guest, 'read'), 'GUEST_ACCOUNT_DELETED')
})

test('concurrent clients retain exactly the globally newest thirty and never overwrite each other', async () => {
  const env = environment()
  const results = await Promise.all(Array.from({ length: 45 }, (_, index) => env.send({ uid: `parallel-${index}`, name: '참가자' }, `message-${index}`)))
  assert.equal(results.at(-1).revision, 45)
  const result = await env.call(alice, 'read', { expanded: true })
  assert.equal(result.messages.length, GLOBAL_CHAT_MAX_MESSAGES)
  assert.deepEqual(result.messages.map(message => message.text), Array.from({ length: 30 }, (_, index) => `message-${index + 15}`))
  assert.equal(new Set(result.messages.map(message => message.id)).size, 30)
  assert.equal(result.latest.id, result.messages.at(-1).id)
  const stored = (await env.database.inspect()).collections.globalChat
  assert.equal(stored.feed.messages.length, 30)
  assert.deepEqual(stored.metadata.latest, stored.feed.messages.at(-1))
  assert.equal(JSON.stringify(stored).includes('"message-0"'), false)
})

test('collapsed and unchanged expanded reads fetch only the compact metadata document', async () => {
  const env = environment()
  const first = await env.send(alice, '가벼운 갱신')
  env.reads.length = 0
  const collapsed = await env.call(alice, 'read')
  assert.deepEqual(env.reads, ['globalChat/metadata'])
  assert.equal(Object.hasOwn(collapsed, 'messages'), false)
  env.reads.length = 0
  const unchanged = await env.call(alice, 'read', { expanded: true, revision: first.revision })
  assert.deepEqual(env.reads, ['globalChat/metadata'])
  assert.equal(Object.hasOwn(unchanged, 'messages'), false)
  env.reads.length = 0
  await env.call(alice, 'read', { expanded: true, revision: 0 })
  assert.deepEqual(env.reads, ['globalChat/metadata', 'globalChat/feed'])
})

test('shared transactional cooldown rejects racing sends across service instances', async () => {
  const env = environment()
  const other = createGlobalChatService({ store: env.store, now: env.now })
  const raced = await Promise.allSettled([
    env.send(alice, '첫 요청'),
    other.execute(alice, { action: 'send', text: '동시 요청', requestId: 'concurrent-other' }),
  ])
  assert.equal(raced.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(raced.find(result => result.status === 'rejected').reason.code, 'SEND_RATE_LIMITED')
  env.advance(GLOBAL_CHAT_SEND_COOLDOWN_MS - 1)
  await assert.rejects(env.send(alice, '1ms 빠름'), error => error.retryAfterMs === 1)
  env.advance(1)
  assert.equal((await env.send(alice, '3초 후')).messages.length, 2)
})

test('eviction does not reset cooldown or duplicate a lost-response retry', async () => {
  const env = environment()
  await env.send(alice, '밀려날 메시지', { requestId: 'lost-response-request' })
  for (let index = 0; index < 31; index++) await env.send({ uid: `evict-${index}`, name: '교체' }, `새 메시지 ${index}`)
  await rejectCode(env.send(alice, '너무 빠른 새 메시지'), 'SEND_RATE_LIMITED')
  const retry = await env.send(alice, '밀려날 메시지', { requestId: 'lost-response-request' })
  assert.equal(retry.revision, 32)
  assert.equal(retry.messages.length, 30)
  assert.equal(retry.messages.some(message => message.text === '밀려날 메시지'), false)
  await rejectCode(env.send(alice, '바꾼 내용', { requestId: 'lost-response-request' }), 'REQUEST_ID_REUSED')
})

test('sender receipts stay bounded and retain no previous message text', async () => {
  const env = environment()
  for (let index = 0; index < 40; index++) {
    await env.send(alice, `secret-sender-text-${index}`)
    env.advance(3000)
  }
  const senders = Object.values((await env.database.inspect()).collections.globalChatSenders)
  assert.equal(senders.length, 1)
  assert.equal(senders[0].receipts.length, 16)
  assert.doesNotMatch(JSON.stringify(senders), /secret-sender-text|private-alice/)
})

test('real guest cleanup removes authored messages, latest metadata and sender receipts atomically', async () => {
  const env = environment()
  await env.registry.create(guest)
  await env.send(guest, '지울 첫 메시지')
  await env.send(alice, '남길 메시지')
  env.advance(3000)
  const before = await env.send(guest, '지울 최신 메시지')
  await env.erase(guest)
  const after = await env.call(alice, 'read', { expanded: true, revision: before.revision })
  assert.equal(after.revision, before.revision + 1)
  assert.deepEqual(after.messages.map(message => message.text), ['남길 메시지'])
  assert.equal(after.latest.text, '남길 메시지')
  const stored = await env.database.inspect()
  assert.doesNotMatch(JSON.stringify(stored), /지울|chat-private-guest|guest-123456/)
  assert.equal(Object.keys(stored.collections.globalChatSenders).length, 1)
  await rejectCode(env.send(guest, '종료된 토큰'), 'GUEST_ACCOUNT_DELETED')
})

test('guest-only feed becomes empty with an increased revision, and already authenticated sends stay fenced', async () => {
  const env = environment()
  await env.registry.create(guest)
  await env.send(guest, '마지막 메시지')
  let resume, entered
  const gate = new Promise(resolve => { resume = resolve })
  const started = new Promise(resolve => { entered = resolve })
  const delayed = createGlobalChatService({ store: { transaction: async work => { entered(); await gate; return env.store.transaction(work) } }, guestRegistry: env.registry, now: env.now })
  env.advance(3000)
  const pending = delayed.execute(guest, { action: 'send', text: '로그아웃 중', requestId: 'after-auth-before-transaction' })
  await started
  await env.erase(guest)
  resume()
  await rejectCode(pending, 'GUEST_ACCOUNT_DELETED')
  assert.deepEqual(await env.call(alice, 'read', { expanded: true }), { revision: 2, latest: null, messages: [] })
})

test('Unicode limits accept two hundred emoji, strip controls, and preserve literal HTML as text', async () => {
  const env = environment()
  assert.equal((await env.send(alice, '😀'.repeat(200))).latest.text, '😀'.repeat(200))
  await rejectCode(env.send(bob, '😀'.repeat(201)), 'TEXT_TOO_LONG')
  for (const text of ['', '   ', '\u0000\u202e\u200b', '\u200d\u0300', null, 4]) await rejectCode(env.send(bob, text), 'INVALID_TEXT')
  assert.equal((await env.send(bob, '\u202e  <script>alert(1)</script>\r\n안녕\u0000  ')).latest.text, '<script>alert(1)</script> 안녕')
  const longName = await env.send({ uid: 'long-name-user', name: `가${'\u0301'.repeat(1000)}` }, '이름 제한')
  assert.equal([...longName.latest.name].length <= 64, true)
  assert.equal(longName.latest.name.endsWith('**'), true)
})

test('invalid actions, identities, revisions and request IDs leave the feed untouched', async () => {
  const env = environment()
  for (const identity of [null, {}, { uid: '../bad' }]) await rejectCode(env.call(identity, 'read'), 'UNAUTHENTICATED')
  await rejectCode(env.call(alice, 'eraseAll'), 'UNKNOWN_ACTION')
  for (const revision of [-1, 0.5, '1', Number.MAX_SAFE_INTEGER + 1]) await rejectCode(env.call(alice, 'read', { revision }), 'INVALID_REVISION')
  await rejectCode(env.call(alice, 'read', { expanded: 'true' }), 'INVALID_COMMAND')
  for (const requestId of ['', 'short', 'bad/identifier', 'a'.repeat(81)]) await rejectCode(env.send(alice, '내용', { requestId }), 'INVALID_REQUEST_ID')
  assert.deepEqual((await env.database.inspect()).collections, {})
})

test('profanity is rejected before storage, cooldown or receipts and a corrected retry can reuse its ID', async () => {
  const env = environment()
  await env.send(alice, '좋은 대전이었어요')
  const before = await env.database.inspect()
  env.reads.length = 0
  // Rejection takes place even during a cooldown, without consuming a new send.
  for (const text of ['시발', '씨.1.발', 'ㅂ ㅅ', 'f u c k', 'sh1t']) {
    await assert.rejects(env.send(alice, text, { requestId: 'moderated-request' }), error => {
      assert.equal(error.code, 'CHAT_PROFANITY')
      assert.equal(error.status, 422)
      assert.equal(error.message, CHAT_PROFANITY_MESSAGE)
      assert.equal(error.message.includes(text), false)
      return true
    })
  }
  assert.deepEqual(env.reads, [], 'Rejected text must never enter a storage transaction')
  assert.deepEqual(await env.database.inspect(), before, 'Existing messages and receipts remain byte-for-byte unchanged')
  const corrected = await env.send(bob, '다시 도전해 볼게요', { requestId: 'moderated-request' })
  assert.equal(corrected.revision, 2)
  assert.equal(corrected.messages.length, 2)
  const replay = await env.send(bob, '다시 도전해 볼게요', { requestId: 'moderated-request' })
  assert.equal(replay.revision, 2)
})

test('masking never exposes a profane first syllable of an authenticated name', async () => {
  const env = environment()
  const result = await env.send({ ...alice, name: '좆' }, '안녕하세요')
  assert.equal(result.latest.name, '트**')
  assert.equal((await env.send({ ...bob, name: '시바' }, '반갑습니다')).latest.name, '시**')
})

const origin = 'https://game.example.test'
const request = (payload = { action: 'read' }, options = {}) => new Request(`${origin}/api/chat`, {
  method: options.method ?? 'POST',
  headers: { origin, authorization: 'Bearer valid-chat-token', 'content-type': 'application/json', ...options.headers },
  ...(!['GET', 'OPTIONS'].includes(options.method) ? { body: options.body ?? JSON.stringify(payload) } : {}),
})

test('HTTP allows authenticated same-origin chat and exposes safe cooldown metadata', async () => {
  const env = environment()
  const handler = createGlobalChatHttpHandler({ service: env.service, authenticate: async (_request, token) => {
    assert.equal(token, 'valid-chat-token')
    return alice
  }, now: env.now })
  const sent = await handler(request({ action: 'send', text: '실제 HTTP', requestId: 'http-send-request' }))
  assert.equal(sent.status, 200)
  assert.equal(sent.headers.get('cache-control'), 'no-store')
  assert.equal((await sent.json()).latest.name, '김**')
  const limited = await handler(request({ action: 'send', text: '다음 HTTP', requestId: 'http-send-another' }))
  assert.equal(limited.status, 429)
  assert.equal(limited.headers.get('retry-after'), '3')
  assert.equal((await limited.json()).error.retryAfterMs, 3000)
})

test('direct HTTP cannot bypass moderation; rejected text is private and corrected text sends immediately', async () => {
  const env = environment()
  const handler = createGlobalChatHttpHandler({ service: env.service, authenticate: async () => alice, now: env.now })
  const blockedText = `${'가'.repeat(198)}시발`
  const blocked = await handler(request({ action: 'send', text: blockedText, requestId: 'direct-http-moderated', moderationPassed: true }))
  assert.equal(blocked.status, 422)
  const payload = await blocked.json()
  assert.deepEqual(payload, { error: { code: 'CHAT_PROFANITY', message: CHAT_PROFANITY_MESSAGE } })
  assert.equal(JSON.stringify(payload).includes(blockedText), false)
  assert.deepEqual((await env.database.inspect()).collections, {})
  const corrected = await handler(request({ action: 'send', text: '즐겁게 대전해요!', requestId: 'direct-http-moderated' }))
  assert.equal(corrected.status, 200)
  assert.equal((await corrected.json()).revision, 1)
})

test('HTTP rejects bad origins, auth, methods, JSON, content type and oversized streamed bodies', async () => {
  const env = environment()
  let authenticated = 0
  const handler = createGlobalChatHttpHandler({ service: env.service, authenticate: async () => { authenticated++; return alice } })
  const cases = [
    [request({}, { headers: { origin: 'https://attacker.example' } }), 403],
    [request({}, { headers: { origin: 'null' } }), 403],
    [request({}, { headers: { authorization: '' } }), 401],
    [request({}, { method: 'GET' }), 405],
    [request({}, { body: '{malformed' }), 400],
    [request({}, { body: '[]' }), 400],
    [request({}, { headers: { 'content-type': 'text/plain' } }), 415],
    [request({}, { headers: { 'content-length': String(GLOBAL_CHAT_HTTP_MAX_BYTES + 1) } }), 413],
    [request({}, { body: JSON.stringify({ text: '가'.repeat(GLOBAL_CHAT_HTTP_MAX_BYTES) }) }), 413],
  ]
  for (const [input, status] of cases) assert.equal((await handler(input)).status, status)
  assert.equal(authenticated, 0, 'Invalid requests must not spend token verification or database calls')
  const preflight = await handler(request({}, { method: 'OPTIONS' }))
  assert.equal(preflight.status, 204)
})

test('HTTP maps expired tokens and infrastructure failures without leaking private errors', async () => {
  const env = environment()
  const expired = createGlobalChatHttpHandler({ service: env.service, authenticate: async () => { throw Object.assign(new Error('private-token'), { code: 'auth/id-token-expired' }) } })
  assert.equal((await expired(request())).status, 401)
  for (const parts of [
    { service: env.service, authenticate: async () => { throw new Error('postgres://secret-password@host') } },
    { service: { execute: async () => { throw new Error('SQL private-message') } }, authenticate: async () => alice },
  ]) {
    const failed = await createGlobalChatHttpHandler(parts)(request())
    assert.equal(failed.status, 503)
    assert.doesNotMatch(await failed.text(), /postgres|password|SQL|private-message/)
  }
})

test('HTTP read bursts are throttled and recover after the bounded interval', async () => {
  const env = environment()
  const handler = createGlobalChatHttpHandler({ service: env.service, authenticate: async () => alice, now: env.now })
  for (let index = 0; index < 30; index++) assert.equal((await handler(request())).status, 200)
  const limited = await handler(request())
  assert.equal(limited.status, 429)
  assert.equal((await limited.json()).error.code, 'RATE_LIMITED')
  env.advance(10_000)
  assert.equal((await handler(request())).status, 200)
})

let passed = 0
for (const { name, run } of tests) {
  await run()
  passed++
  console.log(`PASS ${name}`)
}
console.log(`Global chat server validation: ${passed}/${tests.length} passed`)
