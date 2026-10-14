import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { createMemoryRankedStore } from '../server/rankedStore.js'
import { createGuestIdentityRegistry } from '../server/guestIdentity.js'
import { ACCOUNT_LEASE_MS, ACCOUNT_PAYLOAD_MAX_BYTES, createAccountService, createAccountRankedTeamResolver } from '../server/accountService.js'
import { ACCOUNT_HTTP_MAX_BYTES, createAccountHttpHandler } from '../server/accountHttp.js'
import { initializeProductionServices } from '../server/productionServices.js'
import { createRankedService } from '../server/rankedService.js'
import * as engine from '../server/rankedBattle.js'
import { normalizePokemon } from '../src/data/trainingData.js'

const tests = []
const test = (name, run) => tests.push({ name, run })
const ownerA = 'owner-a-1234567890123456'
const ownerB = 'owner-b-1234567890123456'
const alice = { uid: 'account-alice', name: 'Alice', isGuest: false, accountProfile: { email: 'alice@example.test', displayName: 'Alice', photoURL: 'https://example.test/avatar.png', providerIds: ['google.com'] } }
const bob = { uid: 'account-bob', name: 'Bob', isGuest: false }
const guest = { uid: 'account-guest', name: 'forged', isGuest: true }
const rejectCode = (promise, code) => assert.rejects(promise, error => error.code === code)
function environment() {
  const store = createMemoryRankedStore()
  const rankedStore = createMemoryRankedStore()
  const guestRegistry = createGuestIdentityRegistry({ store: rankedStore, chooseNumber: () => 123456, now: () => 1000 })
  let timestamp = 1000, revision = 0, saveSequence = 0
  const service = createAccountService({ store, guestRegistry, now: () => timestamp, newVersion: () => `lease-version-${++revision}` })
  return { store, rankedStore, guestRegistry, service, now: () => timestamp, advance: value => { timestamp += value },
    call: (identity, action, values = {}) => service.execute(identity, { action, ownerId: ownerA, ...(action === 'save' ? { saveSequence: ++saveSequence } : {}), ...values }) }
}
const ownedTeam = prefix => [3, 6, 9, 25, 94, 149].map((speciesId, index) => normalizePokemon({ speciesId, captureId: `${prefix}-${index}` }))

test('concurrent windows admit only one lease and an identical acquire retry is read-only', async () => {
  const env = environment()
  const results = await Promise.allSettled([env.call(alice, 'sessionAcquire'), env.call(alice, 'sessionAcquire', { ownerId: ownerB })])
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'account-session/occupied')
  const lease = results.find(result => result.status === 'fulfilled').value
  assert.equal(lease.leaseMs, ACCOUNT_LEASE_MS)
  assert.equal(lease.expiresAt, 1000 + ACCOUNT_LEASE_MS)
  const before = await env.store.inspect()
  assert.deepEqual(await env.call(alice, 'sessionAcquire', { ownerId: lease.ownerId }), lease)
  assert.deepEqual(await env.store.inspect(), before)
})

test('heartbeat rotates version, stale release cannot remove a renewed or replacement session', async () => {
  const env = environment()
  const first = await env.call(alice, 'sessionAcquire')
  env.advance(20_000)
  const second = await env.call(alice, 'sessionHeartbeat', { version: first.version })
  assert.notEqual(second.version, first.version)
  assert.equal(second.expiresAt, env.now() + ACCOUNT_LEASE_MS)
  assert.deepEqual(await env.call(alice, 'sessionRelease', { version: first.version }), { released: false })
  await rejectCode(env.call(alice, 'sessionHeartbeat', { version: first.version }), 'account-session/lost')
  env.advance(ACCOUNT_LEASE_MS)
  const third = await env.call(alice, 'sessionAcquire', { ownerId: ownerB })
  assert.notEqual(third.version, second.version)
  assert.deepEqual(await env.call(alice, 'sessionRelease', { version: second.version }), { released: false })
  await rejectCode(env.call(alice, 'sessionHeartbeat', { version: second.version }), 'account-session/lost')
  assert.equal((await env.store.inspect()).collections.sessions[alice.uid].ownerId, ownerB)
  assert.deepEqual(await env.call(alice, 'sessionRelease', { ownerId: ownerB, version: third.version }), { released: true })
  assert.deepEqual(await env.call(alice, 'sessionRelease', { ownerId: ownerB, version: third.version }), { released: false })
})

test('every save/read/profile/delete requires the current unexpired owner and token UID', async () => {
  const env = environment()
  await env.call(alice, 'sessionAcquire')
  for (const action of ['load', 'save', 'ensureProfile', 'deleteGameData', 'deleteProfile']) {
    const fields = action === 'save' ? { revision: 'save-revision-a', payload: {} } : {}
    await rejectCode(env.call(alice, action, { ...fields, ownerId: ownerB }), 'account-session/lost')
    await rejectCode(env.call(bob, action, { ...fields, uid: alice.uid }), 'account-session/lost')
  }
  env.advance(ACCOUNT_LEASE_MS)
  await rejectCode(env.call(alice, 'load'), 'account-session/lost')
  await rejectCode(env.call(alice, 'save', { revision: 'save-revision-a', payload: {} }), 'account-session/lost')
})

test('single atomic snapshot replaces old keys, deduplicates retries and survives a service restart', async () => {
  const env = environment()
  await env.call(alice, 'sessionAcquire')
  assert.deepEqual(await env.call(alice, 'load'), { gameData: null })
  const first = { 'champions-vp-v1': '50000', 'champions-settings-v1': '{"music":true}' }
  assert.deepEqual(await env.call(alice, 'save', { revision: 'revision-first', payload: first, uid: bob.uid, saveSequence: 1 }), { revision: 'revision-first' })
  const before = await env.store.inspect()
  await env.call(alice, 'save', { revision: 'revision-first', payload: first, saveSequence: 1 })
  await env.call(alice, 'save', { revision: 'revision-first', payload: Object.fromEntries(Object.entries(first).reverse()), saveSequence: 1 })
  assert.deepEqual(await env.store.inspect(), before)
  await rejectCode(env.call(alice, 'save', { revision: 'revision-first', payload: {} }), 'SAVE_REVISION_REUSED')
  const saved = (await env.call(alice, 'load')).gameData
  assert.deepEqual(saved, { schemaVersion: 1, revision: 'revision-first', updatedAtMs: 1000, payload: first })
  saved.payload['champions-vp-v1'] = '999999'
  assert.equal((await env.call(alice, 'load')).gameData.payload['champions-vp-v1'], '50000')
  env.advance(100)
  await env.call(alice, 'save', { revision: 'revision-second', payload: { 'champions-vp-v1': '40000' } })
  const recreated = createAccountService({ store: env.store, guestRegistry: env.guestRegistry, now: env.now })
  const result = await recreated.execute(alice, { action: 'load', ownerId: ownerA })
  assert.deepEqual(result.gameData.payload, { 'champions-vp-v1': '40000' })
  assert.equal((await env.store.inspect()).collections.gameData[bob.uid], undefined)
})

test('delayed saves cannot overwrite a newer snapshot and heartbeats retain the save sequence', async () => {
  const env = environment()
  const lease = await env.call(alice, 'sessionAcquire')
  const first = { revision: 'sequence-revision-a', payload: { 'champions-vp-v1': '100' }, saveSequence: 1 }
  const second = { revision: 'sequence-revision-b', payload: { 'champions-vp-v1': '200' }, saveSequence: 2 }
  await env.call(alice, 'save', first)
  await env.call(alice, 'save', second)
  const before = await env.store.inspect()
  await rejectCode(env.call(alice, 'save', first), 'STALE_SAVE')
  await rejectCode(env.call(alice, 'save', { ...first, saveSequence: 2 }), 'STALE_SAVE')
  await env.call(alice, 'save', second)
  assert.deepEqual(await env.store.inspect(), before)
  env.advance(20_000)
  await env.call(alice, 'sessionHeartbeat', { version: lease.version })
  assert.equal((await env.store.inspect()).collections.sessions[alice.uid].lastSaveSequence, 2)
  assert.equal((await env.call(alice, 'load')).gameData.payload['champions-vp-v1'], '200')
  await rejectCode(env.call(alice, 'save', { ...first, saveSequence: 0 }), 'INVALID_SAVE_SEQUENCE')
  await rejectCode(env.call(alice, 'save', { ...first, saveSequence: 1.5 }), 'INVALID_SAVE_SEQUENCE')
})

test('payloads permit only storage whitelist strings within two MiB and reject malformed owners/revisions', async () => {
  const env = environment()
  await env.call(alice, 'sessionAcquire')
  for (const payload of [[], null, { admin: 'true' }, { 'champions-vp-v1': 99999 }, JSON.parse('{"__proto__":"injected"}')]) {
    await rejectCode(env.call(alice, 'save', { revision: 'valid-revision', payload }), 'INVALID_SAVE')
  }
  await rejectCode(env.call(alice, 'save', { revision: 'valid-revision', payload: { 'champions-box-v1': 'x'.repeat(ACCOUNT_PAYLOAD_MAX_BYTES) } }), 'SAVE_TOO_LARGE')
  for (const ownerId of ['short', '../foreign-owner', 'a'.repeat(129)]) await rejectCode(env.call(alice, 'load', { ownerId }), 'INVALID_SESSION_OWNER')
  await rejectCode(env.call(alice, 'save', { revision: '../invalid/revision', payload: {} }), 'INVALID_SAVE_REVISION')
  await rejectCode(env.service.execute({ uid: '../foreign' }, { action: 'load', ownerId: ownerA }), 'UNAUTHENTICATED')
  assert.equal((await env.store.inspect()).collections.gameData, undefined)
})

test('profile metadata comes only from verified identity and canonical reserved guest name', async () => {
  const env = environment()
  await env.call(alice, 'sessionAcquire')
  const profile = (await env.call(alice, 'ensureProfile', { uid: bob.uid, email: 'forged@example.test', name: 'admin', providerIds: ['admin'] })).profile
  assert.equal(profile.uid, alice.uid)
  assert.equal(profile.email, alice.accountProfile.email)
  assert.equal(profile.displayName, 'Alice')
  assert.deepEqual(profile.providerIds, ['google.com'])
  env.advance(1000)
  const again = (await env.call(alice, 'ensureProfile')).profile
  assert.equal(again.createdAtMs, profile.createdAtMs)
  assert.equal(again.lastSeenAtMs, env.now())
  await env.guestRegistry.create(guest)
  await env.call(guest, 'sessionAcquire')
  const anonymous = (await env.call({ ...guest, accountProfile: { email: 'forged@example.test', displayName: 'admin', photoURL: 'https://evil.test/x', providerIds: ['google.com'] } }, 'ensureProfile')).profile
  assert.equal(anonymous.displayName, 'guest-123456')
  assert.equal(anonymous.email, null)
  assert.equal(anonymous.photoURL, null)
  assert.deepEqual(anonymous.providerIds, ['anonymous'])
})

test('account deletion is scoped to owner data and retains reserved guest identifiers', async () => {
  const env = environment()
  await env.guestRegistry.create(guest)
  for (const identity of [alice, guest]) {
    await env.call(identity, 'sessionAcquire')
    await env.call(identity, 'save', { revision: 'initial-revision', payload: { 'champions-vp-v1': '50000' } })
    await env.call(identity, 'ensureProfile')
  }
  const reserved = await env.rankedStore.inspect()
  await env.call(guest, 'deleteGameData', { uid: alice.uid })
  await env.call(guest, 'deleteProfile', { uid: alice.uid })
  assert.equal((await env.call(guest, 'load')).gameData, null)
  assert((await env.call(alice, 'load')).gameData)
  const records = (await env.store.inspect()).collections
  assert(records.profiles[alice.uid])
  assert.equal(records.profiles[guest.uid], undefined)
  assert.deepEqual(await env.rankedStore.inspect(), reserved)
})

test('ranked team resolver reads the new account snapshot and still enforces ownership and items', async () => {
  const env = environment()
  const team = ownedTeam('owned')
  await env.call(alice, 'sessionAcquire')
  await env.call(alice, 'save', { revision: 'owned-revision', payload: { 'champions-dex-v2': JSON.stringify(team), 'champions-battle-items-v1': '{}' } })
  const resolveTeam = createAccountRankedTeamResolver(env.store)
  const requested = team.map(pokemon => ({ captureId: pokemon.captureId, speciesId: 999999, moves: ['forged'] }))
  assert.deepEqual((await resolveTeam(alice, requested)).map(pokemon => pokemon.speciesId), team.map(pokemon => pokemon.speciesId))
  await rejectCode(resolveTeam(bob, requested), 'ACCOUNT_SYNC_REQUIRED')
  await rejectCode(resolveTeam(alice, requested.map(pokemon => ({ ...pokemon, captureId: 'foreign' }))), 'POKEMON_NOT_OWNED')
  team[0].heldItemId = 'leftovers'
  await env.call(alice, 'save', { revision: 'item-revision', payload: { 'champions-dex-v2': JSON.stringify(team), 'champions-battle-items-v1': '{}' } })
  await rejectCode(resolveTeam(alice, requested), 'ITEM_NOT_OWNED')
})

test('two authenticated users play ranked battles using migrated account snapshot teams', async () => {
  const env = environment()
  await env.guestRegistry.create(guest)
  const teams = [ownedTeam('guest-team'), ownedTeam('google-team')]
  for (const [index, identity] of [guest, alice].entries()) {
    await env.call(identity, 'sessionAcquire')
    await env.call(identity, 'save', { revision: `team-revision-${index}`, payload: { 'champions-dex-v2': JSON.stringify(teams[index]), 'champions-battle-items-v1': '{}' } })
  }
  let id = 0
  const ranked = createRankedService({ store: env.rankedStore, engine, guestRegistry: env.guestRegistry, resolveTeam: createAccountRankedTeamResolver(env.store), now: env.now, newId: () => `account-match-${++id}` })
  const call = (identity, action, fields = {}) => ranked.execute(identity, { action, requestId: `account-ranked-request-${++id}`, ...fields })
  await call(guest, 'join', { format: 'single', team: teams[0].map(({ captureId }) => ({ captureId })) })
  const selected = (await call(alice, 'join', { format: 'single', team: teams[1].map(({ captureId }) => ({ captureId })) })).match
  await call(guest, 'select', { matchId: selected.id, revision: selected.revision, selection: [0, 1, 2] })
  await call(alice, 'select', { matchId: selected.id, revision: selected.revision, selection: [0, 1, 2] })
  await call(alice, 'forfeit', { matchId: selected.id })
  const winner = await call(guest, 'status', { matchId: selected.id })
  assert.equal(winner.match.you.name, 'guest-123456')
  assert.equal(winner.vpRewards.total, 600)
  assert.equal(winner.profile.single.wins, 1)
})

test('HTTP rejects unauthenticated/foreign-origin/oversized/GET requests and hides backend secrets', async () => {
  const env = environment()
  const handler = createAccountHttpHandler({ service: env.service, authenticate: async (_request, token) => {
    if (token === 'valid-google-token') return alice
    if (token === 'database-secret-token') throw Object.assign(new Error('secret private credential'), { code: 'auth/invalid-credential' })
    throw Object.assign(new Error('secret private token'), { code: 'auth/id-token-expired' })
  } })
  const request = (payload, options = {}) => handler(new Request('https://game.example/api/account', {
    method: options.method ?? 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${options.token ?? 'valid-google-token'}`, ...options.headers },
    ...(options.method === 'GET' ? {} : { body: typeof payload === 'string' ? payload : JSON.stringify(payload) }),
  }))
  assert.equal((await request({}, { method: 'GET' })).status, 405)
  assert.equal((await request({}, { token: 'invalid-user-token' })).status, 401)
  assert.equal((await request({}, { headers: { Origin: 'https://evil.example' } })).status, 403)
  assert.equal((await request('x'.repeat(ACCOUNT_HTTP_MAX_BYTES + 1))).status, 413)
  assert.equal((await request('{')).status, 400)
  const failure = await request({}, { token: 'database-secret-token' })
  assert.equal(failure.status, 503)
  assert(!JSON.stringify(await failure.json()).includes('secret'))
  const acquired = await request({ action: 'sessionAcquire', ownerId: ownerA, uid: bob.uid })
  assert.equal(acquired.status, 200)
  assert.equal((await request({ action: 'load', ownerId: ownerA })).status, 200)
  assert((await env.store.inspect()).collections.sessions[alice.uid])
  assert.equal((await env.store.inspect()).collections.sessions[bob.uid], undefined)
})

test('HTTP accepts compressed account saves while bounding decoded size and preserving legacy JSON', async () => {
  const env = environment()
  const handler = createAccountHttpHandler({ service: env.service, authenticate: async () => alice })
  const request = payload => handler(new Request('https://game.example/api/account', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid-google-token' },
    body: JSON.stringify(payload),
  }))
  const compressed = value => ({ encoding: 'gzip-base64-v1', data: gzipSync(JSON.stringify(value)).toString('base64') })
  assert.equal((await request({ action: 'sessionAcquire', ownerId: ownerA })).status, 200)
  const collection = JSON.stringify(Array.from({ length: 541 }, (_, index) => ({ captureId: `caught-${index}`, speciesId: index + 1 })))
  const save = { action: 'save', ownerId: ownerA, revision: 'compressed-revision-1', saveSequence: 1,
    payload: { 'champions-dex-v2': collection, 'champions-vp-v1': '500' } }
  const transmitted = compressed(save)
  assert(Buffer.byteLength(JSON.stringify(transmitted)) < Buffer.byteLength(JSON.stringify(save)) / 3)
  assert.equal((await request(transmitted)).status, 200)
  assert.deepEqual((await env.call(alice, 'load')).gameData.payload, save.payload)
  const legacy = { ...save, revision: 'legacy-revision-2', saveSequence: 2,
    payload: { ...save.payload, 'champions-vp-v1': '600' } }
  assert.equal((await request(legacy)).status, 200)
  assert.equal((await env.call(alice, 'load')).gameData.payload['champions-vp-v1'], '600')
  assert.equal((await request({ encoding: 'gzip-base64-v1', data: '%%%' })).status, 400)
  assert.equal((await request({ encoding: 'gzip-base64-v1', data: Buffer.from('not gzip').toString('base64') })).status, 400)
  const oversized = compressed({ ...save, payload: { 'champions-dex-v2': 'x'.repeat(ACCOUNT_HTTP_MAX_BYTES) } })
  const rejected = await request(oversized)
  assert.equal(rejected.status, 413)
  assert.equal((await rejected.json()).error.code, 'BODY_TOO_LARGE')
  assert.equal((await env.call(alice, 'load')).gameData.payload['champions-vp-v1'], '600')
})

test('Supabase startup shares one pool, retains Firebase revoked-token verification and never imports Firestore', async () => {
  const loaded = [], stores = [], verified = []
  let pools = 0
  const pool = { async end() {} }
  const modules = {
    'firebase-admin/app': { initializeApp: options => ({ name: 'ranked-server', options }), getApps: () => [], applicationDefault: () => ({}), cert: () => ({}) },
    'firebase-admin/auth': { getAuth: () => ({ async verifyIdToken(token, checkRevoked) { verified.push({ token, checkRevoked }); return { uid: alice.uid, name: 'Alice', email: 'alice@example.test', firebase: { sign_in_provider: 'google.com' } } } }) },
    './postgresStore.js': { createPostgresPool: () => { pools += 1; return pool }, createPostgresStore: options => { stores.push(options); return createMemoryRankedStore() } },
  }
  const loadModule = async name => { loaded.push(name); if (!modules[name]) throw new Error(`Unexpected module: ${name}`); return modules[name] }
  const env = { GAME_STORAGE_PROVIDER: 'supabase', DATABASE_URL: 'postgres://private-connection', RANKED_FIREBASE_PROJECT_ID: 'account-validation', RANKED_FIRESTORE_PREFIX: 'rankedProduction' }
  const production = await initializeProductionServices({ env, loadModule })
  assert.equal(pools, 1)
  assert.deepEqual(stores.map(store => store.namespace), ['rankedProduction', 'account'])
  assert(stores.every(store => store.pool === pool))
  assert.equal(production.firestore, null)
  const identity = await production.authenticate({}, 'verified-google-token')
  assert.equal(identity.accountProfile.email, alice.accountProfile.email)
  assert.deepEqual(verified, [{ token: 'verified-google-token', checkRevoked: true }])
  assert(!loaded.includes('firebase-admin/firestore'))
  await rejectCode(initializeProductionServices({ env: { ...env, DATABASE_URL: '' }, loadModule }), 'ranked/configuration-incomplete')
  await assert.rejects(initializeProductionServices({ env, loadModule: async name => {
    if (name === './postgresStore.js') throw new Error('Database down; never fallback')
    return loadModule(name)
  } }), /never fallback/)
  assert(!loaded.includes('firebase-admin/firestore'))
})

test('real production module loader initializes Firebase and PostgreSQL adapters without network or account writes', async () => {
  // This is an ephemeral signing key for an intentionally nonexistent project.
  // No real credentials are read, and neither auth verification nor SQL is run.
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } })
  const { getApps, deleteApp } = await import('firebase-admin/app')
  assert(!getApps().some(app => app.name === 'ranked-server'), 'Test requires an isolated Firebase app registry')
  let services
  try {
    services = await initializeProductionServices({ env: {
      GAME_STORAGE_PROVIDER: 'supabase',
      DATABASE_URL: 'postgresql://validation:unusable@storage-validation.invalid:5432/postgres',
      RANKED_FIREBASE_PROJECT_ID: 'production-loader-validation',
      RANKED_FIRESTORE_PREFIX: 'production_loader_validation',
      RANKED_FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({ project_id: 'production-loader-validation',
        client_email: 'validation@production-loader-validation.iam.gserviceaccount.com', private_key: privateKey }),
    } })
    assert.equal(services.provider, 'supabase')
    assert.equal(services.firestore, null)
    assert.equal(typeof services.authenticate, 'function')
    assert.equal(typeof services.accountStore.transaction, 'function')
    assert.equal(typeof services.rankedStore.transaction, 'function')
    assert.equal(typeof services.guestRegistry.create, 'function')
    assert.equal(getApps().find(app => app.name === 'ranked-server')?.options.projectId, 'production-loader-validation')
  } finally {
    await services?.close()
    const app = getApps().find(candidate => candidate.name === 'ranked-server')
    if (app && app.options.projectId === 'production-loader-validation') await deleteApp(app)
  }
})

test('patch saves preserve untouched data, delete keys, and reject stale, invalid and oversized merges', async () => {
  const env = environment()
  await env.call(alice, 'sessionAcquire')
  const payload = { 'champions-dex-v2': '["collection"]', 'champions-vp-v1': '100', 'champions-settings-v1': '{}' }
  await env.call(alice, 'save', { revision: 'base-revision', payload, saveSequence: 1 })
  assert.equal((await env.call(alice, 'load', { patchVersion: 1 })).savePatchVersion, 1)
  const change = { baseRevision: 'base-revision', revision: 'next-revision', saveSequence: 2, patch: { 'champions-vp-v1': '200' }, removed: ['champions-settings-v1'] }
  await env.call(alice, 'savePatch', change)
  await env.call(alice, 'savePatch', change)
  assert.deepEqual((await env.call(alice, 'load')).gameData.payload, { 'champions-dex-v2': '["collection"]', 'champions-vp-v1': '200' })
  await rejectCode(env.call(alice, 'savePatch', { ...change, patch: { 'champions-vp-v1': '300' } }), 'SAVE_REVISION_REUSED')
  await rejectCode(env.call(alice, 'savePatch', { ...change, revision: 'late-revision', saveSequence: 1 }), 'STALE_SAVE')
  await rejectCode(env.call(alice, 'savePatch', { ...change, revision: 'late-revision', saveSequence: 3 }), 'SAVE_BASE_MISMATCH')
  await rejectCode(env.call(alice, 'savePatch', { ...change, removed: ['unknown'] }), 'INVALID_SAVE')
  await rejectCode(env.call(alice, 'savePatch', { ...change, removed: ['champions-vp-v1'] }), 'INVALID_SAVE')
  await rejectCode(env.call(alice, 'savePatch', { ...change, ownerId: ownerB }), 'account-session/lost')
  await env.call(alice, 'save', { revision: 'large-revision', saveSequence: 3, payload: { 'champions-dex-v2': 'a'.repeat(ACCOUNT_PAYLOAD_MAX_BYTES - 100) } })
  await rejectCode(env.call(alice, 'savePatch', { baseRevision: 'large-revision', revision: 'huge-revision', saveSequence: 4, patch: { 'champions-vp-v1': 'b'.repeat(200) }, removed: [] }), 'SAVE_TOO_LARGE')
  assert.equal((await env.call(alice, 'load')).gameData.revision, 'large-revision')
})

test('version two edits preserve exact Unicode data and protect retries, bounds and ownership', async () => {
  const env = environment()
  await env.call(alice, 'sessionAcquire')
  const before = '한글🐉'.repeat(1000)
  await env.call(alice, 'save', { revision: 'splice-base', saveSequence: 1, payload: { 'champions-dex-v2': before, 'champions-vp-v1': '100' } })
  assert.equal((await env.call(alice, 'load', { patchVersion: 2 })).savePatchVersion, 2)
  const change = { baseRevision: 'splice-base', revision: 'splice-next', saveSequence: 2, patch: {}, removed: [],
    splices: { 'champions-dex-v2': [1500, 3, '진화🦊'] } }
  await env.call(alice, 'savePatch', change)
  await env.call(alice, 'savePatch', change)
  assert.deepEqual((await env.call(alice, 'load')).gameData.payload,
    { 'champions-dex-v2': [...before].slice(0, 1500).join('') + '진화🦊' + [...before].slice(1503).join(''), 'champions-vp-v1': '100' })
  await rejectCode(env.call(alice, 'savePatch', { ...change, splices: { 'champions-dex-v2': [1500, 3, '다른변경'] } }), 'SAVE_REVISION_REUSED')
  await rejectCode(env.call(alice, 'savePatch', { ...change, revision: 'splice-stale', saveSequence: 1 }), 'STALE_SAVE')
  await rejectCode(env.call(alice, 'savePatch', { ...change, ownerId: ownerB }), 'account-session/lost')
  const validNext = { ...change, baseRevision: 'splice-next', revision: 'splice-invalid', saveSequence: 3 }
  for (const splices of [{ unknown: [0, 0, 'x'] }, { 'champions-dex-v2': [-1, 0, 'x'] },
    { 'champions-dex-v2': [999999, 0, 'x'] }, { 'champions-dex-v2': [0, 999999, ''] },
    { 'champions-dex-v2': [0, 1.5, 'x'] }, { 'champions-dex-v2': [0, 1, 123] },
    { 'champions-settings-v1': [0, 0, 'x'] }]) {
    await rejectCode(env.call(alice, 'savePatch', { ...validNext, splices }), 'INVALID_SAVE')
  }
  await rejectCode(env.call(alice, 'savePatch', { ...validNext, patch: { 'champions-dex-v2': 'x' } }), 'INVALID_SAVE')
  await rejectCode(env.call(alice, 'savePatch', { ...validNext, removed: ['champions-dex-v2'] }), 'INVALID_SAVE')
  await rejectCode(env.call(alice, 'savePatch', { ...validNext, splices: { 'champions-dex-v2': [0, 0, 'x'.repeat(ACCOUNT_PAYLOAD_MAX_BYTES)] } }), 'SAVE_TOO_LARGE')
  assert.equal((await env.call(alice, 'load')).gameData.revision, 'splice-next')
})

for (const { name, run } of tests) {
  await run()
  console.log(`PASS ${name}`)
}
console.log(`Account server validation passed: ${tests.length}/${tests.length}`)
