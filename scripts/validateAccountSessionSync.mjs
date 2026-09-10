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
  let resolve
  const promise = new Promise((yes) => { resolve = yes })
  return { promise, resolve }
}
const flush = async () => { for (let index = 0; index < 12; index += 1) await Promise.resolve() }
const user = { uid: 'google-user' }
const cloudData = {
  payload: { 'champions-vp-v1': '200' }, revision: 'cloud-current', updatedAtMs: 200,
}

function environment({ loadGate = null, saveGate = null } = {}) {
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
  globalThis.__accountSyncHarness = {
    getActiveAccountSessionOwnerId: () => ownerId,
    hasActiveAccountSession: () => Boolean(ownerId),
    async loadPlayerGameData(uid) { calls.load.push(uid); return loadGate ? loadGate.promise : cloudData },
    async savePlayerGameData(uid, payload) { calls.save.push({ uid, payload }); return saveGate ? saveGate.promise : { revision: 'save-current' } },
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
  return { api, calls, writes, values, mount, unmount, owner: (next) => { ownerId = next } }
}

async function check(name, test) {
  await test()
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

delete globalThis.__accountSyncHarness
console.log(`Validated 3 account session sync races (React ${React.version}, real accountStorage).`)
