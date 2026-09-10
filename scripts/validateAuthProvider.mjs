import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

// Keep the optional lifecycle-test dependency outside the application's dependencies.
// npm install --prefix "$env:TEMP/champions-auth-provider-validation" --no-package-lock --no-audit --no-fund react@19.2.8 react-test-renderer@19.2.8
// node scripts/validateAuthProvider.mjs
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const rendererRoot = process.env.AUTH_TEST_RENDERER_ROOT
  ?? path.join(os.tmpdir(), 'champions-auth-provider-validation')
const rendererRequire = createRequire(path.join(rendererRoot, 'package.json'))
let React, renderer
try {
  React = rendererRequire('react')
  renderer = rendererRequire('react-test-renderer')
} catch {
  throw new Error(`Install react@19.2.8 and react-test-renderer@19.2.8 in ${rendererRoot}, or set AUTH_TEST_RENDERER_ROOT to its package root.`)
}
const installedReact = JSON.parse(await readFile(path.join(projectRoot, 'node_modules/react/package.json'), 'utf8')).version
assert.equal(React.version, installedReact, 'Lifecycle harness must use the application React version')
const { act, create } = renderer
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mockModules = {
  'firebase/auth': [
    'GoogleAuthProvider', 'browserLocalPersistence', 'browserSessionPersistence', 'deleteUser',
    'onAuthStateChanged', 'reauthenticateWithPopup', 'setPersistence', 'signInWithPopup', 'signOut',
  ],
  './firebaseClient': ['firebaseAuth', 'isFirebaseConfigured', 'missingFirebaseEnvironmentVariables'],
  './accountStorage': ['clearLocalPlayerData', 'clearPendingGoogleMigration', 'markPendingGoogleMigration'],
  './playerProfile': ['deletePlayerProfile', 'ensurePlayerProfile'],
  './accountSession': ['acquireAccountSession', 'ACCOUNT_SESSION_ERROR_CODES'],
}
const compiled = await build({
  entryPoints: [path.join(projectRoot, 'src/auth/AuthProvider.jsx')],
  bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic', external: ['react', 'react/jsx-runtime'],
  plugins: [{
    name: 'auth-provider-test-services',
    setup(buildApi) {
      buildApi.onResolve({ filter: /^(firebase\/auth|\.\/(firebaseClient|accountStorage|playerProfile|accountSession))$/ }, ({ path: modulePath }) => (
        { path: modulePath, namespace: 'auth-test' }
      ))
      buildApi.onLoad({ filter: /.*/, namespace: 'auth-test' }, ({ path: modulePath }) => ({
        contents: mockModules[modulePath].map((name) => `export const ${name} = globalThis.__authProviderHarness.${name}`).join('\n'),
      }))
    },
  }],
})

const occupied = () => Object.assign(new Error('occupied'), { code: 'account-session/occupied' })
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const flush = async () => { for (let index = 0; index < 12; index += 1) await Promise.resolve() }
const storage = () => {
  const values = new Map()
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: (key) => values.delete(key) }
}
const googleUser = { uid: 'google-user', displayName: 'Trainer', email: 'trainer@example.invalid' }
const guestUser = { version: 1, uid: 'local-guest-remembered', displayName: 'Guest' }

function environment({ initialUser = null, rememberedGuest = null, acquireGate = null, rejectAll = false } = {}) {
  const windowObject = Object.assign(new EventTarget(), { localStorage: storage(), sessionStorage: storage() })
  const pageshowCallbacks = new Set()
  const addListener = windowObject.addEventListener.bind(windowObject)
  const removeListener = windowObject.removeEventListener.bind(windowObject)
  windowObject.addEventListener = (type, callback, options) => {
    if (type === 'pageshow') pageshowCallbacks.add(callback)
    addListener(type, callback, options)
  }
  windowObject.removeEventListener = (type, callback, options) => {
    if (type === 'pageshow') pageshowCallbacks.delete(callback)
    removeListener(type, callback, options)
  }
  if (rememberedGuest) windowObject.localStorage.setItem('champions-local-guest-v1', JSON.stringify(rememberedGuest))
  globalThis.window = windowObject
  const observers = new Set()
  const calls = { acquire: [], profiles: [], persistence: [], signOut: 0, popups: 0, releases: 0, order: [] }
  let activeHandle = null
  const services = {
    firebaseAuth: { currentUser: initialUser }, isFirebaseConfigured: true, missingFirebaseEnvironmentVariables: [],
    ACCOUNT_SESSION_ERROR_CODES: { occupied: 'account-session/occupied', unavailable: 'account-session/unavailable', lost: 'account-session/lost' },
    GoogleAuthProvider: class { setCustomParameters() {} },
    browserLocalPersistence: 'local', browserSessionPersistence: 'session',
    onAuthStateChanged(auth, callback) {
      observers.add(callback)
      queueMicrotask(() => { if (observers.has(callback)) callback(auth.currentUser) })
      return () => observers.delete(callback)
    },
    async setPersistence(auth, value) { calls.persistence.push(value); calls.order.push('persistence') },
    async signInWithPopup(auth) { calls.popups += 1; auth.currentUser = googleUser; for (const observer of observers) observer(googleUser); return { user: googleUser } },
    async signOut(auth) {
      assert.ok(activeHandle?.isActive(), 'Keep the lock until shared credentials are cleared')
      calls.signOut += 1
      calls.order.push('firebase-signout')
      auth.currentUser = null
      for (const observer of observers) observer(null)
    },
    async reauthenticateWithPopup() {}, async deleteUser() {}, async deletePlayerProfile() {},
    async ensurePlayerProfile(user) { calls.profiles.push(user.uid); calls.order.push('profile') },
    clearLocalPlayerData() {}, clearPendingGoogleMigration() {}, markPendingGoogleMigration() {},
    async acquireAccountSession(user, options) {
      calls.acquire.push(user.uid)
      calls.order.push('acquire')
      if (acquireGate) await acquireGate.promise
      if (rejectAll || activeHandle) throw occupied()
      let ended = false
      const handle = {
        user, options,
        isActive: () => !ended,
        async release() {
          if (ended) return
          ended = true
          calls.releases += 1
          calls.order.push('release')
          windowObject.removeEventListener('pagehide', hide)
          if (activeHandle === handle) activeHandle = null
        },
      }
      const hide = () => { void handle.release() }
      windowObject.addEventListener('pagehide', hide)
      activeHandle = handle
      return handle
    },
  }
  globalThis.__authProviderHarness = services
  const providerModule = { exports: {} }
  new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(rendererRequire, providerModule, providerModule.exports)
  const { AuthProvider, useAuth } = providerModule.exports
  const roots = []
  async function mount({ strict = false } = {}) {
    const observed = { current: null, history: [] }
    function Probe() {
      observed.current = useAuth()
      observed.history.push({ user: observed.current.user, active: Boolean(activeHandle?.isActive()) })
      return null
    }
    await act(async () => {
      const element = React.createElement(AuthProvider, null, React.createElement(Probe))
      observed.root = create(strict ? React.createElement(React.StrictMode, null, element) : element)
      roots.push(observed.root)
      await flush()
    })
    return observed
  }
  async function cleanup() {
    await act(async () => { for (const root of roots) root.unmount(); await flush() })
    assert.equal(activeHandle, null, 'Unmount must leave no active session')
  }
  const emitAuthStateChanged = (nextUser) => {
    services.firebaseAuth.currentUser = nextUser
    for (const observer of observers) observer(nextUser)
  }
  return { calls, services, windowObject, pageshowCallbacks, emitAuthStateChanged, mount, cleanup, active: () => activeHandle }
}

const cases = []
async function check(name, test) {
  await test()
  cases.push(name)
  console.log(`PASS ${name}`)
}

await check('startup waits for admission before exposing user or syncing profile', async () => {
  const gate = deferred()
  const env = environment({ initialUser: googleUser, acquireGate: gate })
  const app = await env.mount()
  assert.equal(app.current.user, null)
  assert.equal(app.current.ready, false)
  assert.equal(env.calls.profiles.length, 0)
  assert.equal(env.calls.persistence.length, 0)
  await act(async () => { gate.resolve(); await flush() })
  assert.equal(app.current.user.uid, googleUser.uid)
  assert.equal(app.current.ready, true)
  assert.deepEqual(env.calls.profiles, [googleUser.uid])
  assert.ok(app.history.every((state) => !state.user || state.active), 'No rendered account precedes ownership')
  await env.cleanup()
})

await check('rejected automatic/manual admission never signs out shared Firebase credentials', async () => {
  const env = environment({ initialUser: googleUser, rejectAll: true })
  const app = await env.mount()
  assert.equal(app.current.user, null)
  assert.equal(app.current.ready, true)
  assert.ok(app.current.error)
  let result
  await act(async () => { result = await app.current.signInWithGoogle() })
  assert.equal(result, false)
  assert.equal(env.calls.signOut, 0)
  assert.equal(env.calls.popups, 0)
  assert.deepEqual(env.calls.persistence, [])
  assert.deepEqual(env.calls.profiles, [])
  assert.equal(env.services.firebaseAuth.currentUser, googleUser)
  await env.cleanup()
})

await check('popup authentication still returns false when session admission is rejected', async () => {
  const env = environment({ rejectAll: true })
  const app = await env.mount()
  let result
  await act(async () => { result = await app.current.signInWithGoogle() })
  assert.equal(result, false)
  assert.equal(env.calls.popups, 1)
  assert.deepEqual(env.calls.acquire, [googleUser.uid], 'Popup auth observer must not duplicate admission')
  assert.equal(app.current.user, null)
  assert.equal(app.current.busy, false)
  assert.equal(env.calls.signOut, 0)
  assert.deepEqual(env.calls.profiles, [])
  await env.cleanup()
})

await check('second provider rejection preserves the admitted owner and profile sync', async () => {
  const env = environment({ initialUser: googleUser })
  const owner = await env.mount()
  const second = await env.mount()
  assert.equal(owner.current.user, googleUser)
  assert.equal(second.current.user, null)
  assert.ok(second.current.error)
  let result
  await act(async () => { result = await second.current.signInWithGoogle() })
  assert.equal(result, false)
  assert.equal(owner.current.user, googleUser)
  assert.equal(env.calls.signOut, 0)
  assert.deepEqual(env.calls.profiles, [googleUser.uid])
  await env.cleanup()
})

await check('remembered guest uses the same lock for automatic and manual login', async () => {
  const env = environment({ rememberedGuest: guestUser, rejectAll: true })
  const app = await env.mount()
  let result
  await act(async () => { result = await app.current.signInAsGuest() })
  assert.equal(result, false)
  assert.deepEqual(env.calls.acquire, [guestUser.uid, guestUser.uid])
  assert.equal(app.current.user, null)
  assert.equal(JSON.parse(env.windowObject.localStorage.getItem('champions-local-guest-v1')).uid, guestUser.uid)
  assert.equal(env.calls.signOut, 0)
  await env.cleanup()
})

await check('new guest is stored only after admission and releases ownership on signout', async () => {
  const gate = deferred()
  const env = environment({ acquireGate: gate })
  const app = await env.mount()
  let pending
  await act(async () => { pending = app.current.signInAsGuest(); await flush() })
  assert.equal(app.current.user, null)
  assert.equal(env.windowObject.localStorage.getItem('champions-local-guest-v1'), null)
  let result
  await act(async () => { gate.resolve(); result = await pending })
  assert.equal(result, true)
  assert.equal(app.current.user.isLocalGuest, true)
  assert.equal(JSON.parse(env.windowObject.localStorage.getItem('champions-local-guest-v1')).uid, app.current.user.uid)
  await act(async () => { await app.current.signOut() })
  assert.equal(app.current.user, null)
  assert.equal(env.calls.signOut, 0)
  assert.equal(env.calls.releases, 1)
  assert.equal(env.windowObject.localStorage.getItem('champions-local-guest-v1'), null)
  await env.cleanup()
})

await check('StrictMode effect replay cleans cancelled admission and holds one session', async () => {
  const env = environment({ initialUser: googleUser })
  const app = await env.mount({ strict: true })
  assert.equal(app.current.user, googleUser)
  assert.equal(app.current.ready, true)
  assert.equal(env.calls.acquire.length, 1)
  assert.equal(env.calls.profiles.length, 1)
  await env.cleanup()
  assert.equal(env.calls.releases, 1)
})

await check('unmount during pending admission releases its eventual handle', async () => {
  const gate = deferred()
  const env = environment({ initialUser: googleUser, acquireGate: gate })
  const app = await env.mount()
  await act(async () => { app.root.unmount(); await flush() })
  await act(async () => { gate.resolve(); await flush() })
  assert.equal(env.active(), null)
  assert.equal(env.calls.releases, 1)
  assert.equal(env.calls.profiles.length, 0)
  await env.cleanup()
})

await check('signout during pending admission prevents late account activation', async () => {
  const gate = deferred()
  const env = environment({ initialUser: googleUser, acquireGate: gate })
  const app = await env.mount()
  let pendingSignout
  await act(async () => { pendingSignout = app.current.signOut(); await flush() })
  await act(async () => { gate.resolve(); await pendingSignout })
  assert.equal(app.current.user, null)
  assert.equal(app.current.ready, true)
  assert.equal(env.active(), null)
  assert.equal(env.calls.releases, 1)
  assert.equal(env.calls.signOut, 0, 'Unadmitted credentials may belong to another window')
  assert.equal(env.calls.profiles.length, 0)
  await env.cleanup()
})

await check('external auth signout cancels pending admission and clears busy state', async () => {
  const gate = deferred()
  const env = environment({ initialUser: googleUser, acquireGate: gate })
  const app = await env.mount()
  assert.equal(app.current.busy, true)
  await act(async () => { env.emitAuthStateChanged(null); await flush() })
  assert.equal(app.current.user, null)
  assert.equal(app.current.ready, true)
  assert.equal(app.current.busy, false)
  await act(async () => { gate.resolve(); await flush() })
  assert.equal(app.current.user, null)
  assert.equal(app.current.ready, true)
  assert.equal(app.current.busy, false)
  assert.equal(env.active(), null)
  assert.equal(env.calls.releases, 1)
  assert.equal(env.calls.signOut, 0)
  assert.equal(env.calls.profiles.length, 0)
  await env.cleanup()
})

await check('explicit signout clears shared credentials before releasing ownership', async () => {
  const env = environment({ initialUser: googleUser })
  const app = await env.mount()
  await act(async () => { await app.current.signOut() })
  assert.equal(app.current.user, null)
  assert.equal(app.current.ready, true)
  assert.equal(env.calls.signOut, 1)
  assert.ok(env.calls.order.indexOf('firebase-signout') < env.calls.order.indexOf('release'))
  await env.cleanup()
})

await check('ownership loss removes game access without shared Firebase signout', async () => {
  const env = environment({ initialUser: googleUser })
  const app = await env.mount()
  const handle = env.active()
  await act(async () => {
    handle.options.onLost(Object.assign(new Error('lost'), { code: 'account-session/lost' }))
    await handle.release()
  })
  assert.equal(app.current.user, null)
  assert.equal(app.current.ready, true)
  assert.ok(app.current.error)
  assert.equal(env.calls.signOut, 0)
  await env.cleanup()
})

await check('BFCache restoration reacquires ownership after pagehide release', async () => {
  const env = environment({ initialUser: googleUser })
  const app = await env.mount()
  await act(async () => { env.windowObject.dispatchEvent(new Event('pagehide')); await flush() })
  assert.equal(env.active(), null)
  await act(async () => {
    env.windowObject.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }))
    await flush()
  })
  assert.equal(app.current.user, googleUser)
  assert.equal(env.calls.acquire.length, 2)
  assert.equal(env.calls.releases, 1)
  await env.cleanup()
})

await check('BFCache restoration stays logged out if another window took ownership', async () => {
  const env = environment({ initialUser: googleUser })
  const previous = await env.mount()
  const restorePreviousPage = [...env.pageshowCallbacks][0]
  await act(async () => { env.windowObject.dispatchEvent(new Event('pagehide')); await flush() })
  const nextOwner = await env.mount()
  assert.equal(nextOwner.current.user, googleUser)
  // Only the restored page receives its pageshow event in an actual browser.
  await act(async () => { restorePreviousPage({ persisted: true }); await flush() })
  assert.equal(previous.current.user, null)
  assert.ok(previous.current.error)
  assert.equal(nextOwner.current.user, googleUser)
  assert.equal(env.calls.signOut, 0)
  await env.cleanup()
})

delete globalThis.__authProviderHarness
console.log(`Validated ${cases.length} AuthProvider lifecycle scenarios (React ${React.version}).`)
