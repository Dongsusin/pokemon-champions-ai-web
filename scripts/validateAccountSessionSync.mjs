import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

// Reuse the optional, isolated dependency setup from validateAuthProvider.mjs:
// npm install --prefix "$env:TEMP/champions-auth-provider-validation" --no-package-lock --no-audit --no-fund react@19.2.8 react-test-renderer@19.2.8
// node scripts/validateAccountSessionSync.mjs
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const rendererRoot = process.env.AUTH_TEST_RENDERER_ROOT
  ?? path.join(os.tmpdir(), 'champions-auth-provider-validation')
const rendererRequire = createRequire(path.join(rendererRoot, 'package.json'))
let React, renderer
try {
  React = rendererRequire('react')
  renderer = rendererRequire('react-test-renderer')
} catch {
  throw new Error(`Install react@19.2.8 and react-test-renderer@19.2.8 in ${rendererRoot}, or set AUTH_TEST_RENDERER_ROOT.`)
}
assert.equal(React.version, createRequire(import.meta.url)('react/package.json').version)
const { act, create } = renderer
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mockModules = {
  './playerGameData': ['loadPlayerGameData', 'savePlayerGameData'],
  './accountSession': ['getActiveAccountSessionOwnerId', 'hasActiveAccountSession'],
}
const compiled = await build({
  stdin: {
    contents: `export { useAccountGameData } from './src/auth/useAccountGameData.js'; export * from './src/auth/accountStorage.js';`,
    resolveDir: projectRoot,
  },
  bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react'],
  plugins: [{
    name: 'account-sync-test-services',
    setup(buildApi) {
      buildApi.onResolve({ filter: /^\.\/(playerGameData|accountSession)$/ }, ({ path: modulePath }) => ({
        path: modulePath, namespace: 'sync-test',
      }))
      buildApi.onLoad({ filter: /.*/, namespace: 'sync-test' }, ({ path: modulePath }) => ({
        contents: mockModules[modulePath].map((name) => `export const ${name} = globalThis.__accountSyncHarness.${name}`).join('\n'),
      }))
    },
  }],
})

const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const flush = async () => { for (let index = 0; index < 12; index += 1) await Promise.resolve() }
const user = { uid: 'google-user' }
const cloudData = {
  payload: { 'champions-vp-v1': '200' }, revision: 'cloud-current', updatedAtMs: 200,
}

function environment({ loadGate = null, saveGate = null, loadError = null, saveError = null, cloudResult = cloudData } = {}) {
  const values = new Map()
  const writes = []
  const localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem(key, value) { values.set(key, String(value)); writes.push(['set', key, String(value)]) },
    removeItem(key) { values.delete(key); writes.push(['remove', key]) },
  }
  globalThis.window = Object.assign(new EventTarget(), { localStorage, setTimeout, clearTimeout })
  globalThis.document = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  const calls = { load: [], save: [] }
  let ownerId = 'session-original'
  const failures = { load: loadError, save: saveError }
  globalThis.__accountSyncHarness = {
    getActiveAccountSessionOwnerId: () => ownerId,
    hasActiveAccountSession: () => Boolean(ownerId),
    async loadPlayerGameData(uid) { calls.load.push(uid); if (failures.load) throw failures.load; return loadGate ? loadGate.promise : cloudResult },
    async savePlayerGameData(uid, payload) { calls.save.push({ uid, payload }); if (failures.save) throw failures.save; return saveGate ? saveGate.promise : { revision: 'save-current' } },
  }
  const hookModule = { exports: {} }
  new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(rendererRequire, hookModule, hookModule.exports)
  const api = hookModule.exports
  api.replaceLocalPlayerData({ 'champions-vp-v1': '100' })
  api.claimLocalPlayerData(user.uid)
  const observed = { current: null, root: null }
  function Probe() { observed.current = api.useAccountGameData(user); return null }
  async function mount() {
    await act(async () => { observed.root = create(React.createElement(Probe)); await flush() })
    return observed
  }
  async function unmount() { await act(async () => { observed.root.unmount(); await flush() }) }
  return { api, calls, writes, values, failures, mount, unmount, owner: (next) => { ownerId = next } }
}

let checks = 0
async function check(name, test) {
  await test()
  checks += 1
  console.log(`PASS ${name}`)
}

await check('a deferred bootstrap cannot replace storage or mark synced after session owner changes', async () => {
  const loadGate = deferred()
  const env = environment({ loadGate })
  const app = await env.mount()
  assert.equal(app.current.ready, false)
  assert.deepEqual(env.calls.load, [user.uid])
  env.owner('session-replacement')
  env.api.replaceLocalPlayerData({ 'champions-vp-v1': '900' })
  env.api.markLocalPlayerDataSynced(user.uid, 'replacement-revision')
  const snapshot = [...env.values]
  const writeCount = env.writes.length
  await act(async () => { loadGate.resolve(cloudData); await flush() })
  assert.equal(env.writes.length, writeCount, 'Stale bootstrap must perform zero local-storage mutations')
  assert.deepEqual([...env.values], snapshot)
  assert.equal(env.calls.save.length, 0)
  await env.unmount()
})

await check('a delayed save success cannot clear dirty state after session ownership is lost', async () => {
  const saveGate = deferred()
  const env = environment({ saveGate })
  const app = await env.mount()
  assert.equal(app.current.ready, true)
  assert.deepEqual(env.api.readLocalPlayerData(), cloudData.payload, 'Current owner may apply bootstrap data')
  assert.equal(env.api.readPlayerSyncState().revision, cloudData.revision)
  env.api.replaceLocalPlayerData({ 'champions-vp-v1': '300' })
  env.api.markLocalPlayerDataDirty(user.uid)
  let pendingSave
  await act(async () => { pendingSave = app.current.flush(); await flush() })
  assert.deepEqual(env.calls.save, [{ uid: user.uid, payload: { 'champions-vp-v1': '300' } }])
  env.owner(null)
  const snapshot = [...env.values]
  const writeCount = env.writes.length
  await act(async () => { saveGate.resolve({ revision: 'late-save-revision' }); await pendingSave })
  assert.equal(env.writes.length, writeCount, 'Lost session must not mark a delayed save synced')
  assert.deepEqual([...env.values], snapshot)
  assert.equal(env.api.readPlayerSyncState().dirty, true)
  assert.equal(env.api.readPlayerSyncState().revision, cloudData.revision)
  await env.unmount()
})

await check('a deferred bootstrap resolving after unmount cannot touch replacement storage', async () => {
  const loadGate = deferred()
  const env = environment({ loadGate })
  await env.mount()
  await env.unmount()
  env.owner('session-after-unmount')
  env.api.replaceLocalPlayerData({ 'champions-vp-v1': '800' })
  env.api.markLocalPlayerDataSynced('another-user', 'new-account-revision')
  const snapshot = [...env.values]
  const writeCount = env.writes.length
  await act(async () => { loadGate.resolve(cloudData); await flush() })
  assert.equal(env.writes.length, writeCount, 'Unmounted bootstrap must perform zero local-storage mutations')
  assert.deepEqual([...env.values], snapshot)
  assert.equal(env.calls.save.length, 0)
})

await check('signout flush waits for the in-flight upload and its latest queued data', async () => {
  const saveGate = deferred()
  const env = environment({ saveGate })
  const app = await env.mount()
  env.api.replaceLocalPlayerData({ 'champions-vp-v1': '300' })
  env.api.markLocalPlayerDataDirty(user.uid)
  let original, signoutFlush, returned = false
  await act(async () => { original = app.current.flush(); await flush() })
  env.api.replaceLocalPlayerData({ 'champions-vp-v1': '400' })
  env.api.markLocalPlayerDataDirty(user.uid)
  await act(async () => { signoutFlush = app.current.flush().then(() => { returned = true }); await flush() })
  assert.equal(returned, false, 'Log out must wait until the active upload completes')
  await act(async () => { saveGate.resolve({ revision: 'latest-save' }); await Promise.all([original, signoutFlush]) })
  assert.deepEqual(env.calls.save.map(call => call.payload['champions-vp-v1']), ['300', '400'])
  assert.equal(env.api.readPlayerSyncState().dirty, false)
  await env.unmount()
})

await check('a fresh browser restores cloud data without treating absent migration as consent to overwrite', async () => {
  const env = environment()
  env.api.clearLocalPlayerData()
  const app = await env.mount()
  assert.equal(app.current.ready, true)
  assert.deepEqual(env.calls.save, [])
  assert.deepEqual(env.api.readLocalPlayerData(), cloudData.payload)
  await env.unmount()
})

for (const trigger of ['manual', 'online']) await check(`failed initial cloud read preserves original storage and retries safely (${trigger})`, async () => {
  const env = environment({ loadError: new Error('offline') })
  env.api.markLocalPlayerDataSynced('another-user', 'other-revision')
  const snapshot = [...env.values]
  const app = await env.mount()
  assert.equal(app.current.ready, false)
  assert.ok(app.current.syncError)
  assert.deepEqual([...env.values], snapshot, 'Failed read must not clear another local account')
  assert.equal(await app.current.flush(), false)
  await act(async () => { app.current.scheduleSave(); await flush() })
  assert.deepEqual(env.calls.save, [])
  env.failures.load = null
  await act(async () => {
    if (trigger === 'manual') app.current.retry()
    else window.dispatchEvent(new Event('online'))
    await flush()
  })
  assert.equal(app.current.ready, true)
  assert.equal(app.current.syncError, '')
  assert.deepEqual(env.api.readLocalPlayerData(), cloudData.payload)
  assert.deepEqual(env.calls.save, [])
  await env.unmount()
})

await check('a rejected initial account creation preserves other local data until retry succeeds', async () => {
  const env = environment({ cloudResult: null, saveError: new Error('write denied') })
  env.api.markLocalPlayerDataSynced('another-user', 'other-revision')
  const snapshot = [...env.values]
  const app = await env.mount()
  assert.equal(app.current.ready, false)
  assert.deepEqual([...env.values], snapshot)
  assert.deepEqual(env.calls.save[0].payload, {})
  env.failures.save = null
  await act(async () => { app.current.retry(); await flush() })
  assert.equal(app.current.ready, true)
  assert.deepEqual(env.api.readLocalPlayerData(), {})
  await env.unmount()
})

await check('upload failure returns false and preserves dirty data until a confirmed retry', async () => {
  const env = environment()
  const app = await env.mount()
  env.api.replaceLocalPlayerData({ 'champions-vp-v1': '500' })
  env.api.markLocalPlayerDataDirty(user.uid)
  env.failures.save = new Error('network unavailable')
  let result
  await act(async () => { result = await app.current.flush() })
  assert.equal(result, false)
  assert.ok(app.current.syncError)
  assert.equal(env.api.readPlayerSyncState().dirty, true)
  assert.equal(env.api.readLocalPlayerData()['champions-vp-v1'], '500')
  env.failures.save = null
  await act(async () => { result = await app.current.flush() })
  assert.equal(result, true)
  assert.equal(app.current.syncError, '')
  assert.equal(env.api.readPlayerSyncState().dirty, false)
  await env.unmount()
})

await check('unsynced changes based on the same cloud revision survive a device clock rollback', async () => {
  const env = environment()
  env.api.markLocalPlayerDataSynced(user.uid, cloudData.revision)
  env.api.replaceLocalPlayerData({ 'champions-vp-v1': '550' })
  env.values.set(env.api.PLAYER_SYNC_STORAGE_KEY, JSON.stringify({version:1,ownerUid:user.uid,revision:cloudData.revision,dirty:true,localUpdatedAt:1}))
  const app = await env.mount()
  assert.equal(app.current.ready, true)
  assert.deepEqual(env.calls.save.map(call=>call.payload), [{'champions-vp-v1':'550'}])
  assert.equal(env.api.readLocalPlayerData()['champions-vp-v1'], '550')
  await env.unmount()
})

await check('a newer cloud revision wins over stale dirty data even when the local clock is ahead', async () => {
  const env = environment()
  env.api.markLocalPlayerDataSynced(user.uid, 'older-revision')
  env.api.markLocalPlayerDataDirty(user.uid)
  const app = await env.mount()
  assert.equal(app.current.ready, true)
  assert.deepEqual(env.calls.save, [])
  assert.deepEqual(env.api.readLocalPlayerData(), cloudData.payload)
  await env.unmount()
})

await check('unreadable local storage never uploads a partial save', async () => {
  const env = environment()
  const app = await env.mount()
  const originalRead = window.localStorage.getItem
  window.localStorage.getItem = key => { if (key === 'champions-dex-v2') throw new Error('blocked'); return originalRead(key) }
  let result
  await act(async () => { result = await app.current.flush() })
  assert.equal(result, false)
  assert.deepEqual(env.calls.save, [])
  window.localStorage.getItem = originalRead
  await env.unmount()
})

await check('legacy guest migration transfers exactly once to its bound authenticated owner', async () => {
  const env = environment({ cloudResult: null })
  env.api.claimLocalPlayerData('local-guest-migrate')
  env.api.markPendingGoogleMigration('local-guest-migrate', user.uid)
  const app = await env.mount()
  assert.equal(app.current.ready, true)
  assert.deepEqual(env.calls.save, [{ uid: user.uid, payload: { 'champions-vp-v1': '100' } }])
  assert.equal(env.api.readPlayerSyncState().ownerUid, user.uid)
  assert.equal(env.api.readPendingGoogleMigration(), null)
  await env.unmount()
})

await check('migration for a different destination never imports another guest save', async () => {
  const env = environment({ cloudResult: null })
  env.api.claimLocalPlayerData('local-guest-migrate')
  env.api.markPendingGoogleMigration('local-guest-migrate', 'different-destination')
  const app = await env.mount()
  assert.equal(app.current.ready, true)
  assert.deepEqual(env.calls.save, [{ uid: user.uid, payload: {} }])
  assert.equal(env.api.readPendingGoogleMigration().targetUid, 'different-destination')
  await env.unmount()
})

await check('existing Google progress wins during anonymous linking while guest backup is preserved', async () => {
  const env = environment()
  const sourceUid = 'anonymous-source'
  env.api.claimLocalPlayerData(sourceUid)
  assert.equal(env.api.backupGuestPlayerData(sourceUid), true)
  env.api.markPendingGoogleMigration(sourceUid, user.uid, { preserveExistingCloud: true })
  const app = await env.mount()
  assert.equal(app.current.ready, true)
  assert.deepEqual(env.calls.save, [])
  assert.deepEqual(env.api.readLocalPlayerData(), cloudData.payload)
  const backup = JSON.parse(env.values.get(`${env.api.GUEST_MIGRATION_BACKUP_PREFIX}${sourceUid}`))
  assert.deepEqual(backup.payload, { 'champions-vp-v1': '100' })
  assert.equal(backup.sourceUid, sourceUid)
  assert.equal(env.api.readPendingGoogleMigration(), null)
  await env.unmount()
})

await check('explicit migration into a new Google account preserves guest progress', async () => {
  const env = environment({ cloudResult: null })
  env.api.claimLocalPlayerData('anonymous-source')
  env.api.markPendingGoogleMigration('anonymous-source', user.uid, { preserveExistingCloud: true })
  const app = await env.mount()
  assert.equal(app.current.ready, true)
  assert.deepEqual(env.calls.save[0].payload, { 'champions-vp-v1': '100' })
  await env.unmount()
})

delete globalThis.__accountSyncHarness
console.log(`Validated ${checks} account session sync scenarios (React ${React.version}, real accountStorage).`)
