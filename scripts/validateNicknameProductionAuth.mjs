import assert from 'node:assert/strict'
import { createMemoryRankedStore } from '../server/rankedStore.js'
import { createVerifiedNicknameReader, initializeProductionServices, NICKNAME_CACHE_MS } from '../server/productionServices.js'
import { createGlobalChatHttpHandler } from '../server/globalChatHttp.js'
import { createRankedHttpHandler } from '../server/rankedHttp.js'

const tests = []
const test = (name, run) => tests.push({ name, run })
function fixture() {
  const database = createMemoryRankedStore()
  let timestamp = 1000, profileReads = 0
  const store = { transaction: work => database.transaction(tx => work({ ...tx,
    get: async (collection, key) => { if (collection === 'profiles') profileReads++; return tx.get(collection, key) },
  })) }
  return { database, store, reads: () => profileReads, now: () => timestamp, advance: ms => { timestamp += ms },
    save: (uid, nickname) => database.transaction(tx => tx.set('profiles', uid, { uid, nickname })),
  }
}

test('bounded TTL cache coalesces repeated reads and refreshes after fifteen seconds', async () => {
  const env = fixture()
  await env.save('alice', '별빛')
  const read = createVerifiedNicknameReader({ accountStore: env.store, now: env.now })
  assert.deepEqual((await Promise.all(Array.from({ length: 20 }, () => read('alice')))).map(entry => entry.nickname), Array(20).fill('별빛'))
  assert.equal(env.reads(), 1)
  await env.save('alice', '새별명')
  env.advance(NICKNAME_CACHE_MS - 1)
  assert.equal((await read('alice')).nickname, '별빛')
  assert.equal(env.reads(), 1)
  env.advance(1)
  assert.equal((await read('alice')).nickname, '새별명')
  assert.equal(env.reads(), 2)
})

test('forced public writes read canonical changes immediately including nickname removal', async () => {
  const env = fixture()
  await env.save('alice', '첫별명')
  const read = createVerifiedNicknameReader({ accountStore: env.store, now: env.now })
  assert.equal((await read('alice')).nickname, '첫별명')
  await env.save('alice', '바뀐별명')
  assert.equal((await read('alice', { fresh: true })).nickname, '바뀐별명')
  assert.equal((await read('alice')).nickname, '바뀐별명')
  await env.save('alice', '')
  assert.equal((await read('alice', { fresh: true })).nickname, '')
  assert.equal(env.reads(), 3)
})

test('an old in-flight read cannot overwrite a newer forced nickname lookup', async () => {
  let finishOld, reads = 0
  const old = new Promise(resolve => { finishOld = resolve })
  const store = { transaction: async work => work({ get: async () => ++reads === 1 ? old : { nickname: '최신별명' } }) }
  const read = createVerifiedNicknameReader({ accountStore: store })
  const pending = read('alice')
  assert.equal((await read('alice', { fresh: true })).nickname, '최신별명')
  finishOld({ nickname: '이전별명' })
  assert.equal((await pending).nickname, '이전별명')
  assert.equal((await read('alice')).nickname, '최신별명')
  assert.equal(reads, 2)
})

test('cache remains bounded and invalid stored names never become verified public nicknames', async () => {
  const env = fixture()
  const read = createVerifiedNicknameReader({ accountStore: env.store, now: env.now })
  for (const value of ['한글😀', '시발', 'a'.repeat(13), '한', '\u115f\u1160', '별\u3164명', '\uffa0별명', 'guest-000000']) {
    await env.save('invalid', value)
    assert.equal((await read('invalid', { fresh: true })).nickname, '')
  }
  for (let index = 0; index < 2001; index++) await read(`user-${index}`)
  const before = env.reads()
  await read('user-0')
  assert.equal(env.reads(), before + 1, 'Oldest entry is evicted at the fixed account bound')
})

test('failed profile lookup is not cached and another account never shares its name', async () => {
  const env = fixture()
  await env.save('alice', '앨리스')
  await env.save('bob', '보브')
  let failOnce = true
  const read = createVerifiedNicknameReader({ accountStore: { transaction: work => {
    if (failOnce) { failOnce = false; return Promise.reject(new Error('private database failure')) }
    return env.store.transaction(work)
  } }, now: env.now })
  await assert.rejects(read('alice'))
  assert.equal((await read('alice')).nickname, '앨리스')
  assert.equal((await read('bob')).nickname, '보브')
})

test('production authentication takes nickname from server profile, skips account heartbeats and guests', async () => {
  const env = fixture()
  await env.save('verified-google', '서버별명')
  const verified = []
  const modules = {
    'firebase-admin/app': { initializeApp: () => ({ name: 'ranked-server' }), getApps: () => [], applicationDefault: () => ({}), cert: () => ({}) },
    'firebase-admin/auth': { getAuth: () => ({ async verifyIdToken(token, checkRevoked) {
      verified.push(checkRevoked)
      return { uid: token === 'guest-token' ? 'verified-guest' : 'verified-google', name: '김실제이름', nickname: 'forged-claim',
        firebase: { sign_in_provider: token === 'guest-token' ? 'anonymous' : 'google.com' } }
    } }) },
    './postgresStore.js': { createPostgresPool: () => ({ async end() {} }),
      createPostgresStore: ({ namespace }) => namespace === 'account' ? env.store : createMemoryRankedStore() },
  }
  const services = await initializeProductionServices({ now: env.now,
    env: { GAME_STORAGE_PROVIDER: 'supabase', DATABASE_URL: 'postgres://not-used', RANKED_FIREBASE_PROJECT_ID: 'nickname-test', RANKED_FIRESTORE_PREFIX: 'nickname_test' },
    loadModule: async name => modules[name],
  })
  for (let index = 0; index < 5; index++) {
    const identity = await services.authenticate(new Request('https://game.test/api/account'), 'google-token')
    assert.equal(identity.nickname, '')
  }
  assert.equal(env.reads(), 0, 'Account session heartbeats add zero nickname queries')
  const first = await services.authenticate(new Request('https://game.test/api/chat'), 'google-token')
  assert.equal(first.name, '김실제이름')
  assert.equal(first.nickname, '서버별명')
  assert.equal(first.accountProfile.displayName, '김실제이름')
  await services.authenticate(new Request('https://game.test/api/chat'), 'google-token')
  await services.authenticate(new Request('https://game.test/api/ranked'), 'guest-token', { freshNickname: true })
  assert.equal(env.reads(), 1)
  await env.save('verified-google', '즉시반영')
  assert.equal((await services.authenticate(new Request('https://game.test/api/chat'), 'google-token', { freshNickname: true })).nickname, '즉시반영')
  assert.equal(env.reads(), 2)
  assert(verified.every(Boolean), 'Revoked-token verification remains enabled')
  await services.close()
})

test('HTTP alone decides freshness for public actions and ignores forged freshness fields', async () => {
  const calls = []
  const authenticate = async (_request, _token, options) => { calls.push(options.freshNickname); return { uid: 'verified-google' } }
  const service = { execute: async () => ({ revision: 0, latest: null }) }
  const chat = createGlobalChatHttpHandler({ service, authenticate })
  const ranked = createRankedHttpHandler({ service, authenticate, enabled: true })
  const request = (path, action, method = 'POST') => new Request(`https://game.test/api/${path}${method === 'GET' ? `?action=${action}` : ''}`, {
    method, headers: { authorization: 'Bearer verified-token', 'content-type': 'application/json' },
    ...(method === 'POST' ? { body: JSON.stringify({ action, freshNickname: false, nickname: 'forged-input' }) } : {}),
  })
  for (const action of ['read', 'send']) assert.equal((await chat(request('chat', action))).status, 200)
  for (const action of ['status', 'rooms', 'factoryLeaderboard', 'rankedLeaderboard']) assert.equal((await ranked(request('ranked', action, 'GET'))).status, 200)
  for (const action of ['join', 'roomCreate', 'roomJoin', 'reportFactoryRun', 'action']) assert.equal((await ranked(request('ranked', action))).status, 200)
  assert.deepEqual(calls, [false, true, false, false, true, true, true, true, true, true, false])
})

for (const { name, run } of tests) { await run(); console.log(`PASS ${name}`) }
console.log(`Nickname production authentication: ${tests.length}/${tests.length} passed`)
