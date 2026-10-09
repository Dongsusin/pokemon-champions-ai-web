import assert from 'node:assert/strict'
import { initializeProductionServices } from '../server/productionServices.js'
import { createMemoryRankedStore } from '../server/rankedStore.js'
import { createRankedHttpHandler } from '../server/rankedHttp.js'
import { createGlobalChatHttpHandler } from '../server/globalChatHttp.js'

const tests = [], test = (name, run) => tests.push({ name, run })
const verified = uid => ({ uid, name: 'Private Google name', firebase: { sign_in_provider: 'google.com' } })
async function fixture(verify = async token => verified(token)) {
  let verifications = 0, profileReads = 0
  const revoked = []
  const database = createMemoryRankedStore()
  const modules = {
    'firebase-admin/app': { initializeApp: () => ({}), getApps: () => [], applicationDefault: () => ({}) },
    'firebase-admin/auth': { getAuth: () => ({ verifyIdToken: (token, checkRevoked) => {
      verifications++; revoked.push(checkRevoked); return verify(token)
    } }) },
    './postgresStore.js': { createPostgresPool: () => ({ end: async () => {} }),
      createPostgresStore: ({ namespace }) => namespace === 'account' ? {
        transaction: work => database.transaction(tx => work({ ...tx, get: (collection, uid) => {
          if (collection === 'profiles') profileReads++
          return tx.get(collection, uid)
        } })),
      } : createMemoryRankedStore(),
    },
  }
  const services = await initializeProductionServices({ env: { GAME_STORAGE_PROVIDER: 'supabase',
    DATABASE_URL: 'postgres://test-only', RANKED_FIREBASE_PROJECT_ID: 'budget-test' }, loadModule: async name => modules[name] })
  return { services, database, verifications: () => verifications, profileReads: () => profileReads, revoked }
}
const account = () => new Request('https://game.test/api/account')

test('overlapping same-token requests share one revocation check, sequential requests recheck', async () => {
  const f = await fixture()
  const result = await Promise.all(Array.from({ length: 12 }, () => f.services.authenticate(account(), 'google-alice')))
  assert(result.every(identity => identity.uid === 'google-alice'))
  assert.equal(f.verifications(), 1)
  await f.services.authenticate(account(), 'google-alice')
  assert.equal(f.verifications(), 2)
  assert(f.revoked.every(value => value === true))
})
test('different tokens and accounts never share verification results', async () => {
  const f = await fixture()
  const result = await Promise.all(['google-alice', 'google-bob'].map(token => f.services.authenticate(account(), token)))
  assert.deepEqual(result.map(identity => identity.uid), ['google-alice', 'google-bob'])
  assert.equal(f.verifications(), 2)
})
test('a rejected overlapping check is removed and a later request retries', async () => {
  let failed = true
  const f = await fixture(async token => { if (failed) throw Object.assign(Error('revoked'), { code: 'auth/id-token-revoked' }); return verified(token) })
  const outcomes = await Promise.allSettled(Array.from({ length: 8 }, () => f.services.authenticate(account(), 'google-alice')))
  assert(outcomes.every(result => result.status === 'rejected' && result.reason.code === 'auth/id-token-revoked'))
  assert.equal(f.verifications(), 1)
  failed = false
  assert.equal((await f.services.authenticate(account(), 'google-alice')).uid, 'google-alice')
  assert.equal(f.verifications(), 2)
})
test('revocation immediately after a completed request is never hidden by a result cache', async () => {
  let revoked = false
  const f = await fixture(async token => { if (revoked) throw Object.assign(Error('revoked'), { code: 'auth/id-token-revoked' }); return verified(token) })
  await f.services.authenticate(account(), 'google-alice')
  revoked = true
  await assert.rejects(f.services.authenticate(account(), 'google-alice'), { code: 'auth/id-token-revoked' })
})
test('passive aggregates skip public profile reads while public writes retain canonical labels', async () => {
  const f = await fixture()
  await f.database.transaction(tx => tx.set('profiles', 'google-alice', { nickname: 'BudgetName' }))
  const request = new Request('https://game.test/api/ranked?action=queueCounts')
  assert.equal((await f.services.authenticate(request, 'google-alice', { includePublicLabels: false })).nickname, '')
  assert.equal(f.profileReads(), 0)
  assert.equal((await f.services.authenticate(request, 'google-alice', { includePublicLabels: true, freshNickname: true })).nickname, 'BudgetName')
  assert.equal(f.profileReads(), 1)
})
test('trusted HTTP handlers select passive label reads and ignore forged client flags', async () => {
  const options = []
  const authenticate = async (_request, _token, option) => { options.push(option); return { uid: 'google-alice' } }
  const service = { execute: async () => ({}) }
  const ranked = createRankedHttpHandler({ service, authenticate, enabled: true })
  const chat = createGlobalChatHttpHandler({ service, authenticate })
  const request = (path, action) => new Request('https://game.test/api/' + path, { method: 'POST',
    headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
    body: JSON.stringify({ action, includePublicLabels: false, freshNickname: false }) })
  for (const action of ['queueCounts', 'status', 'join']) assert.equal((await ranked(request('ranked', action))).status, 200)
  for (const action of ['read', 'send']) assert.equal((await chat(request('chat', action))).status, 200)
  assert.deepEqual(options.map(value => value.includePublicLabels), [false, true, true, false, true])
  assert.equal(options[2].freshNickname, true)
  assert.equal(options[4].freshNickname, true)
})

let passed = 0
for (const { name, run } of tests) {
  try { await run(); passed++; console.log('PASS ' + name) }
  catch (error) { console.error('FAIL ' + name + ': ' + error.message); process.exitCode = 1 }
}
console.log(`Server request budget: ${passed}/${tests.length} checks passed`)
