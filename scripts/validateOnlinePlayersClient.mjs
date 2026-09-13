import assert from 'node:assert/strict'
import { createOnlinePlayersStore, getOnlinePlayersSnapshot } from '../src/auth/onlinePlayers.js'
import { acquireAccountSession, ACCOUNT_SESSION_ERROR_CODES } from '../src/auth/accountSession.js'

let passed = 0
async function test(name, run) { await run(); passed++; console.log(`PASS ${name}`) }
const sample = (count = 12, staleAfterMs = 60_000) => ({ count, sampledAt: 100_000, staleAfterMs })
function storeFixture() {
  const timers = new Map()
  let sequence = 0
  const store = createOnlinePlayersStore({ setTimeoutImpl: (fn, delay) => { timers.set(++sequence, { fn, delay }); return sequence }, clearTimeoutImpl: id => timers.delete(id) })
  return { store, timers }
}
await test('cached stable snapshot, zero count, subscription and unsubscribe', () => {
  const { store } = storeFixture(); let calls = 0
  assert.equal(store.getSnapshot(), null)
  const unsubscribe = store.subscribe(() => calls++)
  store.update('user', 'owner', sample(0))
  assert.equal(store.getSnapshot(), store.getSnapshot())
  assert.equal(store.getSnapshot().count, 0)
  assert.equal(calls, 1)
  unsubscribe(); store.update('user', 'owner', sample(5)); assert.equal(calls, 1)
})
await test('remaining freshness expires and old timer cannot clear newer sample', () => {
  const { store, timers } = storeFixture()
  store.update('user', 'owner', sample(4, 1200))
  const old = [...timers.values()][0]; assert.equal(old.delay, 1200)
  store.update('user', 'owner', sample(5, 400))
  assert.equal(timers.size, 1); old.fn(); assert.equal(store.getSnapshot().count, 5)
  ;[...timers.values()][0].fn(); assert.equal(store.getSnapshot().count, null)
})
await test('malformed or missing metadata is unknown, never a fabricated zero', () => {
  const { store, timers } = storeFixture()
  for (const invalid of [null, {}, sample(-1), sample(1.5), sample('5'), sample(Infinity), sample(5, 0), sample(5, 60001), { ...sample(), sampledAt: NaN }]) {
    store.update('user', 'owner', sample()); store.update('user', 'owner', invalid)
    assert.equal(store.getSnapshot().count, null); assert.equal(timers.size, 0)
  }
})
await test('old owner release cannot clear replacement account; subscriber errors are isolated', () => {
  const { store, timers } = storeFixture()
  store.subscribe(() => { throw new Error('Display error') })
  store.update('new-user', 'new-owner', sample())
  store.clear('old-user', 'old-owner'); store.clear('new-user', 'old-owner')
  assert.equal(store.getSnapshot().count, 12)
  store.clear('new-user', 'new-owner'); assert.equal(store.getSnapshot(), null); assert.equal(timers.size, 0)
})

// The actual session client processes metadata only after validating ownership;
// local clocks/timers and HTTP are isolated, with no production credentials.
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)) }
function sessionFixture() {
  const windowObject = new EventTarget(), documentObject = new EventTarget(), timers = new Map()
  documentObject.visibilityState = 'visible'
  let revision = 0, nextCount = sample(), afterResponse = null, releaseCalls = 0
  const user = { uid: 'online-client-test', getIdToken: async () => 'isolated-test-token' }
  const options = { storageProvider: 'supabase', apiUrl: 'http://127.0.0.1/api/account', windowObject, documentObject, navigatorObject: {}, now: () => 100_000,
    setTimeoutImpl: (fn, delay) => { const id = Symbol(); timers.set(id, { fn, delay }); return id }, clearTimeoutImpl: id => timers.delete(id),
    fetchImpl: async (_url, init) => {
      const command = JSON.parse(init.body)
      if (command.action === 'sessionRelease') { releaseCalls++; return Response.json({ released: true }) }
      const body = { ownerId: command.ownerId, version: `test-version-${++revision}`, expiresAt: 190_000, leaseMs: 90_000, onlinePlayers: nextCount }
      const wait = afterResponse; afterResponse = null
      if (wait) await wait()
      return Response.json(body)
    } }
  return { user, options, windowObject, documentObject, timers, setSample: value => { nextCount = value }, delay: wait => { afterResponse = wait }, releases: () => releaseCalls }
}
await test('actual lease acquisition populates cache before UI mount; renewal and offline invalidate it', async () => {
  const fixture = sessionFixture(); const handle = await acquireAccountSession(fixture.user, fixture.options)
  try {
    assert.equal(getOnlinePlayersSnapshot().count, 12)
    fixture.setSample(sample(22)); fixture.documentObject.dispatchEvent(new Event('visibilitychange')); await flush()
    assert.equal(getOnlinePlayersSnapshot().count, 22)
    fixture.setSample(null); fixture.documentObject.dispatchEvent(new Event('visibilitychange')); await flush()
    assert.equal(handle.isActive(), true); assert.equal(getOnlinePlayersSnapshot().count, null)
    fixture.windowObject.dispatchEvent(new Event('offline'))
    assert.equal(getOnlinePlayersSnapshot(), null); assert.equal(handle.isActive(), false)
  } finally { await handle.release() }
  assert.equal(fixture.timers.size, 0)
})
await test('late heartbeat after page close cannot republish old count', async () => {
  const fixture = sessionFixture(); const handle = await acquireAccountSession(fixture.user, fixture.options)
  let resume
  const pending = new Promise(resolve => { resume = resolve })
  fixture.delay(() => pending); fixture.setSample(sample(99))
  fixture.documentObject.dispatchEvent(new Event('visibilitychange')); await flush()
  fixture.windowObject.dispatchEvent(new Event('pagehide')); assert.equal(getOnlinePlayersSnapshot(), null)
  resume(); await flush(); assert.equal(getOnlinePlayersSnapshot(), null)
  assert.equal(handle.isActive(), false); await handle.release(); assert.equal(fixture.timers.size, 0)
})
await test('cancelled initial acquisition does not publish or retain a lease', async () => {
  const fixture = sessionFixture(); let resume
  const pending = new Promise(resolve => { resume = resolve }); fixture.delay(() => pending)
  const acquisition = acquireAccountSession(fixture.user, fixture.options)
  const rejected = assert.rejects(acquisition, { code: ACCOUNT_SESSION_ERROR_CODES.lost })
  await flush(); fixture.windowObject.dispatchEvent(new Event('pagehide')); resume(); await rejected
  assert.equal(getOnlinePlayersSnapshot(), null); assert.equal(fixture.timers.size, 0); assert(fixture.releases() > 0)
})
console.log(`Online player client validation passed (${passed} checks).`)
