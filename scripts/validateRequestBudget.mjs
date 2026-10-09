import assert from 'node:assert/strict'
import { startRankedPolling } from '../src/rankedPolling.js'
import { QUEUE_COUNT_POLL_MS, chatPollDelay, rankedPollDelay, roomPollDelay } from '../src/requestCadence.js'

const tests = []
const test = (name, run) => tests.push({ name, run })
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }

// Exercise the real poller over virtual time, including its initial read and
// visibility handling. A passive counter must never become a lease heartbeat.
async function measure(interval, { snapshot = {}, hidden = false, duration = 600_000 } = {}) {
  let now = 0, nextId = 0
  const calls = [], timers = new Map(), documentRef = new EventTarget(), windowRef = new EventTarget()
  documentRef.hidden = hidden
  const polling = startRankedPolling({ getSnapshot: () => snapshot, visibleInterval: interval,
    documentRef, windowRef,
    refresh: async () => { calls.push(now) },
    setTimer: (callback, delay) => { const id = ++nextId; timers.set(id, { at: now + delay, callback }); return id },
    clearTimer: id => timers.delete(id),
  })
  await settle()
  while (timers.size) {
    const [id, timer] = [...timers].sort((a, b) => a[1].at - b[1].at)[0]
    if (timer.at > duration) break
    assert(timer.at > now, 'Polling must yield between requests')
    now = timer.at; timers.delete(id); timer.callback(); await settle()
  }
  polling.stop()
  assert.equal(timers.size, 0)
  return calls
}

test('main queue counter makes at most ten repeat reads in ten minutes', async () => {
  const calls = await measure(() => QUEUE_COUNT_POLL_MS)
  assert(calls.length <= 11, `Queue counter made ${calls.length - 1} repeat requests; budget is 10`)
})
test('ranked lobby without a queue makes at most ten repeat reads in ten minutes', async () => {
  const calls = await measure(() => rankedPollDelay({}))
  assert(calls.length <= 11, `Idle ranked lobby made ${calls.length - 1} repeat requests; budget is 10`)
})
test('empty room browser makes at most ten repeat reads in ten minutes', async () => {
  const calls = await measure(() => roomPollDelay({ rooms: [] }))
  assert(calls.length <= 11, `Empty room browser made ${calls.length - 1} repeat requests; budget is 10`)
})
test('closed chat waits two minutes, including when its retry cap applies', () => {
  assert(chatPollDelay(false) >= 120_000, 'Closed chat is still polling more often than two minutes')
  assert(chatPollDelay(false, 1) >= chatPollDelay(false))
  assert(chatPollDelay(false, 20) <= 300_000, 'A failed connection must remain recoverable')
})
test('open chat halves background reads while retaining timely delivery', () => {
  const delay = chatPollDelay(true)
  assert(delay >= 8000 && delay <= 10_000)
  assert(chatPollDelay(true, 1) > delay)
})
for (const snapshot of [{ queue: {} }, { match: { phase: 'select' } }, { match: { phase: 'battle' } }]) {
  test(`active ${snapshot.queue ? 'queue' : snapshot.match.phase} retains forty repeat reads per minute`, async () => {
    const original = structuredClone(snapshot)
    const calls = await measure(() => rankedPollDelay(snapshot), { snapshot, duration: 60_000 })
    assert.equal(calls.length, 41)
    assert.deepEqual(snapshot, original)
  })
}
test('joined waiting rooms and busy actions keep their existing responsiveness', async () => {
  const snapshot = { room: { phase: 'waiting', startDeadlineAt: 60_000 } }
  const calls = await measure(() => roomPollDelay(snapshot), { snapshot, duration: 60_000 })
  assert.equal(calls.length, 13)
  assert.equal(roomPollDelay(snapshot, true), 500)
  assert.equal(roomPollDelay({ room: { phase: 'active' } }), 1500)
})
test('room browser keeps renewing an existing ranked queue before its lease expires', async () => {
  const snapshot = { room: null, match: null, queue: { expiresAt: 30_000 } }
  const calls = await measure(() => roomPollDelay(snapshot), { snapshot, duration: 60_000 })
  assert.equal(calls.length, 13)
  assert(calls.slice(1).every((at, i) => at - calls[i] < 30_000))
  assert.equal(snapshot.queue.expiresAt, 30_000)
})
test('hidden passive counters stop while active queues renew within their lease', async () => {
  assert.deepEqual(await measure(() => QUEUE_COUNT_POLL_MS, { hidden: true }), [0])
  const snapshot = { queue: { expiresAt: 30_000 } }
  const calls = await measure(() => rankedPollDelay(snapshot), { snapshot, hidden: true, duration: 60_000 })
  assert.equal(calls.length, 13)
  assert(calls.slice(1).every((at, i) => at - calls[i] < 30_000))
  assert.equal(snapshot.queue.expiresAt, 30_000)
})

let passed = 0
for (const { name, run } of tests) {
  try { await run(); passed++; console.log(`PASS ${name}`) }
  catch (error) { console.error(`FAIL ${name}: ${error.message}`); process.exitCode = 1 }
}
console.log(`Request budget: ${passed}/${tests.length} checks passed`)
if (!process.exitCode) {
  const before = 60_000 / 15_000 + 60_000 / 30_000 + 60_000 / 30_000
  const after = 60_000 / QUEUE_COUNT_POLL_MS + 60_000 / chatPollDelay(false) + 60_000 / 30_000
  console.log(`Steady idle main requests/minute: ${before} -> ${after}; reduction ${((1 - after / before) * 100).toFixed(2)}% (account heartbeat unchanged)`)
}
