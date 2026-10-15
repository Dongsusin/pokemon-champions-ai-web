import assert from 'node:assert/strict'
import { startRankedPolling } from '../src/rankedPolling.js'

const tests = []
const test = (name, run) => tests.push({ name, run })
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
function setup({ hidden = false, snapshot = {}, interval = () => 1500, keepPolling, request = async () => {} } = {}) {
  let now = 0, serial = 0
  const documentRef = new EventTarget(), windowRef = new EventTarget(), timers = new Map(), calls = []
  documentRef.hidden = hidden
  const state = { snapshot }, navigatorRef = { onLine: true }
  const polling = startRankedPolling({ documentRef, windowRef, navigatorRef,
    getSnapshot: () => state.snapshot, visibleInterval: interval, keepPolling,
    setTimer: (callback, delay) => { const id = ++serial; timers.set(id, { at: now + delay, callback }); return id },
    clearTimer: id => timers.delete(id),
    refresh: async () => { calls.push(now); return request(state, now) },
  })
  return { polling, calls, state, timers,
    visible(value) { documentRef.hidden = !value; documentRef.dispatchEvent(new Event('visibilitychange')) },
    online() { navigatorRef.onLine = true; windowRef.dispatchEvent(new Event('online')) },
    offline() { navigatorRef.onLine = false; windowRef.dispatchEvent(new Event('offline')) },
    async advance(amount) {
      await flush()
      const until = now + amount
      for (let limit = 0; limit < 10000; limit++) {
        const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0]
        if (!next || next[1].at > until) { now = until; await flush(); return }
        now = next[1].at; timers.delete(next[0]); next[1].callback(); await flush()
      }
      throw new Error('Unexpected busy polling loop')
    },
  }
}

test('idle page reads once per visit; focus and reconnect do not fetch, manual refresh works', async () => {
  const env = setup()
  await env.advance(3_600_000)
  assert.deepEqual(env.calls, [0])
  env.visible(false); env.offline(); env.online(); env.visible(true)
  await flush()
  assert.deepEqual(env.calls, [0])
  env.polling.refresh()
  await env.advance(3_600_000)
  assert.deepEqual(env.calls, [0, 3_600_000])
  env.polling.stop()
})

test('initial hidden visit fetches once to discover a resumable session before pausing', async () => {
  const idle = setup({ hidden: true })
  await idle.advance(60_000)
  assert.deepEqual(idle.calls, [0])
  idle.polling.stop()
  const restored = setup({ hidden: true, request: async state => { state.snapshot = { queue: { expiresAt: 30000 } } } })
  await restored.advance(15000)
  assert.deepEqual(restored.calls, [0, 5000, 10000, 15000])
  restored.polling.stop()
})

test('failed passive bootstrap waits for a manual retry rather than polling forever', async () => {
  const env = setup({ hidden: true, request: async (state, now) => {
    if (!now) return false
    state.snapshot = { queue: {} }
    return true
  } })
  await env.advance(20_000)
  assert.deepEqual(env.calls, [0])
  env.polling.refresh()
  await env.advance(10_000)
  assert.deepEqual(env.calls, [0, 20000, 25000, 30000])
  env.polling.stop()
})

test('an unexpectedly rejected active refresh remains contained and retries', async () => {
  const env = setup({ hidden: true, snapshot: { queue: {} }, request: async (state, now) => {
    if (!now) throw new Error('rejected refresh fixture')
    state.snapshot = { queue: {} }
  } })
  await env.advance(10000)
  assert.deepEqual(env.calls, [0, 5000, 10000])
  env.polling.stop()
})

test('a join completed after hiding the lobby can wake its paused heartbeat', async () => {
  const env = setup()
  await flush()
  env.visible(false)
  await env.advance(1000)
  assert.equal(env.timers.size, 0)
  env.state.snapshot = { queue: { expiresAt: 31000 } }
  env.polling.refresh()
  await env.advance(15000)
  assert.deepEqual(env.calls, [0, 1000, 6000, 11000, 16000])
  env.polling.stop()
})

for (const [name, snapshot] of Object.entries({
  queue: { queue: { expiresAt: 30000 } }, selection: { match: { phase: 'select', deadlineAt: 90000 } },
  battle: { match: { phase: 'battle', deadlineAt: 60000 } }, waitingRoom: { room: { phase: 'waiting', startDeadlineAt: 60000 } },
  activeRoom: { room: { phase: 'active' } }, spectator: { spectator: { phase: 'battle', deadlineAt: 60000 } },
})) test(`hidden ${name} polls every five seconds and leaves server deadlines untouched`, async () => {
  const original = structuredClone(snapshot), env = setup({ hidden: true, snapshot })
  await env.advance(60_000)
  assert.deepEqual(env.calls, Array.from({ length: 13 }, (_, index) => index * 5000))
  assert.deepEqual(env.state.snapshot, original)
  assert(env.calls.slice(1).every((at, index) => at - env.calls[index] < 30_000), 'Queue lease renewal gap exceeded')
  env.polling.stop()
})

test('match completion stops automatic reads, including focus events', async () => {
  const env = setup({ hidden: true, snapshot: { match: { phase: 'battle' } }, request: async (state, now) => {
    if (now >= 5000) state.snapshot = { match: { phase: 'finished' } }
  } })
  await env.advance(60_000)
  assert.deepEqual(env.calls, [0, 5000])
  env.visible(true)
  await flush()
  assert.deepEqual(env.calls, [0, 5000])
  env.polling.stop()
})

test('visibility and reconnect never duplicate an in-flight request; unmount removes future work', async () => {
  let resolve
  const deferred = new Promise(done => { resolve = done })
  const env = setup({ snapshot: { queue: {} }, request: () => deferred })
  env.visible(false)
  await env.advance(10000)
  env.visible(true)
  env.online()
  env.polling.refresh()
  assert.deepEqual(env.calls, [0])
  env.polling.stop()
  resolve()
  await flush()
  env.visible(false)
  env.visible(true)
  env.online()
  env.polling.refresh()
  await env.advance(60000)
  assert.deepEqual(env.calls, [0])
  assert.equal(env.timers.size, 0)
})

test('handled network failures retain paced retries and recover immediately on focus', async () => {
  let failed = 0
  const env = setup({ snapshot: { match: { phase: 'battle' } }, request: async () => {
    try { await Promise.reject(new Error('offline fixture')) } catch { failed++ }
  } })
  env.visible(false)
  await env.advance(10000)
  assert.equal(failed, 3)
  env.visible(true)
  await flush()
  assert.equal(failed, 4)
  await env.advance(1499)
  assert.equal(failed, 4)
  await env.advance(1)
  assert.equal(failed, 5)
  env.polling.stop()
})

test('a hidden active queue resumes its heartbeat immediately when connectivity returns', async () => {
  const env = setup({ hidden:true, snapshot:{ queue:{ expiresAt:30000 } } })
  await env.advance(1000)
  env.offline()
  await env.advance(1000)
  assert.equal(env.timers.size,0)
  env.online()
  await env.advance(10000)
  assert.deepEqual(env.calls,[0,2000,7000,12000])
  env.polling.stop()
})

test('room lobby and operation retry intervals stay dynamic while visible', async () => {
  let busy = false, active = false
  const env = setup({ keepPolling: () => busy || active, interval: () => busy ? 500 : 1500 })
  await env.advance(5000)
  assert.deepEqual(env.calls, [0])
  busy = true
  env.polling.refresh()
  await env.advance(1000)
  assert.deepEqual(env.calls.slice(-3), [5000, 5500, 6000])
  busy = false; active = true
  await env.advance(2000)
  assert.deepEqual(env.calls.slice(-2), [6500, 8000])
  env.polling.stop()
})

let passed = 0
for (const { name, run } of tests) {
  await run(); passed++; console.log(`PASS ${name}`)
}
console.log(`${passed}/${tests.length} ranked polling checks passed`)
