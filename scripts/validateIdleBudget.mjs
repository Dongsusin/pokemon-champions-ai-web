import assert from 'node:assert/strict'
import { startRankedPolling } from '../src/rankedPolling.js'
const policy = await import('../src/networkBudget.js').catch(() => ({}))
const tests = [], test = (name, run) => tests.push({ name, run })
test('a closed chat performs no more than thirty scheduled reads per hour', () => {
  assert.equal(typeof policy.chatPollDelay, 'function')
  assert(3600000 / policy.chatPollDelay({ expanded: false }) <= 30)
})
test('unchanged open chat backs off, active traffic remains responsive, failures have bounded retries', () => {
  assert.equal(typeof policy.chatPollDelay, 'function')
  assert.equal(policy.chatPollDelay({ expanded: true, unchanged: 0 }), 4000)
  assert(policy.chatPollDelay({ expanded: true, unchanged: 10 }) >= 30000)
  assert(policy.chatPollDelay({ expanded: true, failures: 10 }) <= 120000)
  assert(policy.chatPollDelay({ expanded: true, failures: 3 }) > 4000)
})
test('the real idle ranked scheduler stays below sixty scheduled calls per hour', async () => {
  assert(Number.isFinite(policy.RANKED_IDLE_POLL_MS))
  let now = 0, serial = 0, calls = 0
  const timers = new Map(), doc = new EventTarget(), win = new EventTarget()
  doc.hidden = false
  const polling = startRankedPolling({ refresh: async () => { calls++ }, getSnapshot: () => ({}),
    visibleInterval: () => policy.RANKED_IDLE_POLL_MS, documentRef: doc, windowRef: win,
    setTimer: (callback, delay) => { timers.set(++serial, { at: now + delay, callback }); return serial }, clearTimer: id => timers.delete(id) })
  const flush = async () => { for (let i=0;i<10;i++) await Promise.resolve() }
  await flush()
  for (let limit=0;limit<500;limit++) {
    const next=[...timers].sort((a,b)=>a[1].at-b[1].at)[0]
    if (!next || next[1].at > 3600000) break
    now=next[1].at;timers.delete(next[0]);next[1].callback();await flush()
  }
  polling.stop()
  assert(calls <= 61, 'Idle lobby should not poll hundreds of times per hour: '+calls)
  assert.equal(policy.QUEUE_COUNTS_POLL_MS, 60000)
  assert.equal(policy.ROOM_LOBBY_POLL_MS, 15000)
  console.log(JSON.stringify({ scenario:'idle ranked hour', requests:calls }))
})
let failed=0
for(const {name,run} of tests){try{await run();console.log('PASS '+name)}catch(error){failed++;console.error('FAIL '+name+': '+error.message)}}
console.log(JSON.stringify({tests:tests.length,passed:tests.length-failed,failed}));process.exitCode=failed?1:0
