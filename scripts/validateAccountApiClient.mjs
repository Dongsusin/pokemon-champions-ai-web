import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const environment = { VITE_GAME_STORAGE_PROVIDER: 'supabase', VITE_ACCOUNT_API_URL: 'http://127.0.0.1:9909/api/account' }
const requests = []
const wires = []
let firestoreCalls = 0
let currentOwner = 'session-owner-example'
let tokenCalls = 0
let tokenGate = null
const user = { uid: 'guest-authenticated-owner', isAnonymous: true, async getIdToken() {
  assert.equal(this, user)
  tokenCalls += 1
  if (tokenGate) await tokenGate.promise
  return `fresh-token-${tokenCalls}`
} }
const auth = { currentUser: user }
globalThis.__accountApiHarness = { auth, owner: () => currentOwner,
  unexpectedFirestore: () => { firestoreCalls += 1; throw new Error('Firestore must never be used in Supabase mode') } }
const result = await build({ stdin: { contents: `export * from './src/auth/playerGameData.js'; export * from './src/auth/playerProfile.js'; export * from './src/auth/accountApiClient.js';`, resolveDir: root },
  bundle: true, write: false, platform: 'node', format: 'cjs', define: { 'import.meta.env': JSON.stringify(environment) }, plugins: [{
    name: 'account-api-services', setup(api) {
      api.onResolve({ filter: /^\.\/(firebaseClient|accountSession)(\.js)?$/ }, args => ({ path: args.path, namespace: 'account-client-test' }))
      api.onResolve({ filter: /^firebase\/firestore$/ }, args => ({ path: args.path, namespace: 'account-client-test' }))
      api.onLoad({ filter: /.*/, namespace: 'account-client-test' }, args => ({ contents: args.path.includes('firebaseClient')
        ? 'export const firebaseAuth=globalThis.__accountApiHarness.auth;export const firebaseDb=null;'
        : args.path.includes('accountSession') ? 'export const getActiveAccountSessionOwnerId=globalThis.__accountApiHarness.owner;'
          : ['doc', 'getDoc', 'deleteDoc', 'serverTimestamp', 'setDoc', 'writeBatch'].map(name => `export const ${name}=globalThis.__accountApiHarness.unexpectedFirestore;`).join('\n') }))
    },
  }] })
const module = { exports: {} }
new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, module, module.exports)
const api = module.exports
const validData = { schemaVersion: 1, revision: 'stored-revision', updatedAtMs: Date.now(), payload: { 'champions-vp-v1': '12345' } }
let responseBody = body => body.action === 'load' ? { gameData: validData } : body.action === 'save'
  ? { revision: body.revision } : body.action === 'ensureProfile' ? { profile: { uid: user.uid } } : { deleted: true }
let responseGate = null
let status = 200
const originalFetch = globalThis.fetch
globalThis.fetch = async (url, options) => {
  assert.equal(url, environment.VITE_ACCOUNT_API_URL)
  assert.equal(options.method, 'POST')
  assert.equal(options.credentials, 'omit')
  assert.match(options.headers.Authorization, /^Bearer fresh-token-/)
  const transmitted = JSON.parse(options.body)
  const compressed = transmitted.encoding === 'gzip-base64-v1'
  const body = compressed
    ? JSON.parse(gunzipSync(Buffer.from(transmitted.data, 'base64')).toString('utf8')) : transmitted
  assert.equal(body.ownerId, currentOwner)
  assert.equal('uid' in body, false, 'Owner identity comes from the Firebase token')
  requests.push(body)
  wires.push({ bytes: Buffer.byteLength(options.body), compressed })
  if (responseGate) await responseGate.promise
  return new Response(JSON.stringify(responseBody(body)), { status, headers: { 'content-type': 'application/json' } })
}
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const flush = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve() }
let checks = 0
async function check(name, callback) { await callback(); checks += 1; console.log(`PASS ${name}`) }
try {
  await check('load, save, profile and deletion route only to authenticated account API', async () => {
    assert.deepEqual(await api.loadPlayerGameData(user.uid), validData)
    assert.ok((await api.savePlayerGameData(user.uid, validData.payload)).revision)
    await api.ensurePlayerProfile(user)
    await api.deletePlayerProfile(user)
    assert.deepEqual(requests.map(body => body.action), ['load', 'save', 'ensureProfile', 'deleteGameData', 'deleteProfile'])
    assert.equal(tokenCalls, 5, 'Every operation requests a fresh credential')
    assert.equal(firestoreCalls, 0)
  })
  await check('missing owner and foreign UID stop before sending an account request', async () => {
    const before = requests.length
    await assert.rejects(api.loadPlayerGameData('another-owner'), { code: 'account/identity-changed' })
    currentOwner = null
    await assert.rejects(api.loadPlayerGameData(user.uid), { code: 'account-session/lost' })
    await assert.rejects(api.savePlayerGameData(user.uid, {}), { code: 'account-session/lost' })
    await assert.rejects(api.ensurePlayerProfile(user), { code: 'account-session/lost' })
    assert.equal(requests.length, before)
    currentOwner = 'session-owner-example'
  })
  await check('save sequences increase for one lease and restart only for a new owner', async () => {
    const originalOwner = currentOwner
    currentOwner = 'save-sequence-lease-a'
    const before = requests.length
    await api.savePlayerGameData(user.uid, { 'champions-vp-v1': '1' })
    await api.savePlayerGameData(user.uid, { 'champions-vp-v1': '2' })
    // A heartbeat keeps the same owner; its changing version is intentionally
    // absent from the game-save identity and cannot reset the sequence.
    await api.savePlayerGameData(user.uid, { 'champions-vp-v1': '3' })
    currentOwner = 'save-sequence-lease-b'
    await api.savePlayerGameData(user.uid, { 'champions-vp-v1': '4' })
    assert.deepEqual(requests.slice(before).map(request => request.saveSequence), [1, 2, 3, 1])
    currentOwner = originalOwner
  })
  await check('account switch during token refresh sends no request for the wrong owner', async () => {
    const before = requests.length
    tokenGate = deferred()
    const pending = api.loadPlayerGameData(user.uid)
    await flush()
    auth.currentUser = { uid: 'replacement-google-user' }
    tokenGate.resolve()
    await assert.rejects(pending, { code: 'account/identity-changed' })
    assert.equal(requests.length, before)
    tokenGate = null
    auth.currentUser = user
  })
  await check('account switch during response refuses stale game data', async () => {
    responseGate = deferred()
    const pending = api.loadPlayerGameData(user.uid)
    await flush()
    auth.currentUser = { uid: 'replacement-google-user' }
    responseGate.resolve()
    await assert.rejects(pending, { code: 'account/identity-changed' })
    responseGate = null
    auth.currentUser = user
  })
  await check('server outage propagates without Firestore or empty-save fallback', async () => {
    const original = responseBody
    status = 503
    responseBody = () => ({ error: { code: 'account/unavailable', message: 'offline' } })
    await assert.rejects(api.loadPlayerGameData(user.uid), { code: 'account/unavailable' })
    await assert.rejects(api.savePlayerGameData(user.uid, validData.payload), { code: 'account/unavailable' })
    assert.equal(firestoreCalls, 0)
    status = 200
    responseBody = original
  })
  await check('only explicit null means no saved record; malformed load and save acknowledgments fail', async () => {
    const original = responseBody
    responseBody = () => ({ gameData: null })
    assert.equal(await api.loadPlayerGameData(user.uid), null)
    for (const bad of [{}, { gameData: { ...validData, payload: [] } }, { gameData: { ...validData, revision: '' } }]) {
      responseBody = () => bad
      await assert.rejects(api.loadPlayerGameData(user.uid), { code: 'account/invalid-response' })
    }
    responseBody = () => ({ revision: 'unrelated-revision' })
    await assert.rejects(api.savePlayerGameData(user.uid, validData.payload), { code: 'account/invalid-response' })
    responseBody = original
  })
  await check('negotiated saves skip identical snapshots and send only changed or deleted keys', async () => {
    const original = responseBody
    const collection = JSON.stringify(Array.from({ length: 541 }, (_, i) => ({ captureId: `fixture-${i}`, speciesId: i + 1, moves: [1, 2, 3, 4] })))
    const payload = { ...validData.payload, 'champions-dex-v2': collection, 'champions-settings-v1': '{}' }
    responseBody = body => body.action === 'load' ? { gameData: { ...validData, payload }, savePatchVersion: 1 } : { revision: body.revision }
    await api.loadPlayerGameData(user.uid)
    const before = requests.length
    await api.savePlayerGameData(user.uid, payload)
    assert.equal(requests.length, before)
    await api.savePlayerGameData(user.uid, { ...payload, 'champions-vp-v1': '12346' })
    assert.equal(requests.at(-1).action, 'savePatch')
    assert.deepEqual(requests.at(-1).patch, { 'champions-vp-v1': '12346' })
    assert.deepEqual(requests.at(-1).removed, [])
    const fullBytes = Buffer.byteLength(JSON.stringify({ ...requests.at(-1), action: 'save', patch: undefined, removed: undefined, baseRevision: undefined, payload }))
    const patchBytes = Buffer.byteLength(JSON.stringify(requests.at(-1)))
    console.log(`Synthetic 541 Pokemon VP-only save: ${fullBytes} -> ${patchBytes} bytes (${(100 * (1 - patchBytes / fullBytes)).toFixed(2)}% less)`)
    const { 'champions-settings-v1': omitted, ...withoutSettings } = payload
    await api.savePlayerGameData(user.uid, withoutSettings)
    assert.deepEqual(requests.at(-1).removed, ['champions-settings-v1'])
    const changedCollection = collection.replace('fixture-0', 'fixture-0-updated')
    await api.savePlayerGameData(user.uid, { ...withoutSettings, 'champions-dex-v2': changedCollection })
    assert.equal(requests.at(-1).action, 'savePatch')
    assert.equal(requests.at(-1).patch['champions-dex-v2'], changedCollection)
    assert.equal(wires.at(-1).compressed, true)
    const collectionPatchBytes = Buffer.byteLength(JSON.stringify(requests.at(-1)))
    assert(wires.at(-1).bytes < collectionPatchBytes / 3, 'Changed collections should use the compressed envelope')
    console.log(`Synthetic 541 Pokemon collection save: ${collectionPatchBytes} -> ${wires.at(-1).bytes} bytes (${(100 * (1 - wires.at(-1).bytes / collectionPatchBytes)).toFixed(2)}% less)`)
    const originalCompressionStream = globalThis.CompressionStream
    try {
      globalThis.CompressionStream = undefined
      await api.savePlayerGameData(user.uid, { ...withoutSettings, 'champions-dex-v2': collection })
      assert.equal(wires.at(-1).compressed, false, 'Older browsers must keep the existing JSON format')
    } finally { globalThis.CompressionStream = originalCompressionStream }
    await api.deletePlayerGameData(user.uid)
    responseBody = original
  })
  await check('base conflicts retry the full snapshot with the same sequence; failed patches are not acknowledged', async () => {
    const original = responseBody
    responseBody = body => body.action === 'load' ? { gameData: validData, savePatchVersion: 1 } : { revision: body.revision }
    await api.loadPlayerGameData(user.uid)
    responseBody = body => {
      status = body.action === 'savePatch' ? 409 : 200
      return body.action === 'savePatch' ? { error: { code: 'SAVE_BASE_MISMATCH', message: 'conflict' } } : { revision: body.revision }
    }
    await api.savePlayerGameData(user.uid, { 'champions-vp-v1': '7' })
    const [patch, full] = requests.slice(-2)
    assert.equal(patch.action, 'savePatch')
    assert.equal(full.action, 'save')
    assert.equal(full.saveSequence, patch.saveSequence)
    assert.equal(full.revision, patch.revision)
    responseBody = () => ({ error: { code: 'STALE_SAVE', message: 'stale' } })
    status = 409
    const before = requests.length
    await assert.rejects(api.savePlayerGameData(user.uid, { 'champions-vp-v1': '8' }), { code: 'STALE_SAVE' })
    assert.equal(requests.length, before + 1)
    status = 200
    responseBody = original
    await api.savePlayerGameData(user.uid, { 'champions-vp-v1': '7' })
    assert.equal(requests.at(-1).action, 'save', 'An uncertain baseline never skips the recovery write')
  })
  await check('unsafe HTTP endpoints and embedded credentials are rejected', async () => {
    for (const apiUrl of ['http://example.invalid/api/account', 'https://name:password@example.invalid/api/account', 'file:///api/account']) {
      assert.throws(() => api.createAccountApiClient({ apiUrl }), { code: 'account/invalid-endpoint' })
    }
  })
} finally {
  globalThis.fetch = originalFetch
  delete globalThis.__accountApiHarness
}

let initialized = 0
globalThis.__firebaseStorageHarness = { initialize: () => { initialized += 1; return { name: 'auth-only' } } }
const firebaseBuild = await build({ entryPoints: [path.join(root, 'src/auth/firebaseClient.js')], bundle: true, write: false,
  platform: 'node', format: 'cjs', define: { 'import.meta.env': JSON.stringify({ ...environment, VITE_FIREBASE_API_KEY: 'test-api-key',
    VITE_FIREBASE_AUTH_DOMAIN: 'test.firebaseapp.com', VITE_FIREBASE_PROJECT_ID: 'test-project', VITE_FIREBASE_APP_ID: 'test-app' }) },
  plugins: [{ name: 'auth-only-bootstrap', setup(compiler) {
    compiler.onResolve({ filter: /^firebase\// }, args => ({ path: args.path, namespace: 'firebase-init-test' }))
    compiler.onLoad({ filter: /.*/, namespace: 'firebase-init-test' }, args => ({ contents: args.path === 'firebase/app'
      ? 'export const getApps=()=>[];export const getApp=()=>null;export const initializeApp=globalThis.__firebaseStorageHarness.initialize;'
      : args.path === 'firebase/auth' ? 'export const getAuth=app=>({app});'
        : 'export const getFirestore=()=>{throw new Error("Firestore initialized in Supabase mode")};' }))
  } }] })
const firebaseModule = { exports: {} }
new Function('require', 'module', 'exports', firebaseBuild.outputFiles[0].text)(require, firebaseModule, firebaseModule.exports)
assert.equal(initialized, 1)
assert.ok(firebaseModule.exports.firebaseAuth)
assert.equal(firebaseModule.exports.firebaseDb, null)
assert.equal(firebaseModule.exports.isFirebaseConfigured, true)
delete globalThis.__firebaseStorageHarness
console.log('PASS Supabase mode initializes Firebase Auth without initializing Firestore')
console.log(`Validated ${checks + 1} Supabase account client scenarios.`)
