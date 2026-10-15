import assert from 'node:assert/strict'
import { startRankedPolling } from '../src/rankedPolling.js'
const documentRef = new EventTarget(), windowRef = new EventTarget(), navigatorRef = { onLine: true }
documentRef.hidden = false
let calls = 0
const timers = new Map()
const options = { refresh: async () => { calls++ }, getSnapshot: () => ({}), visibleInterval: () => 1500,
  documentRef, windowRef, navigatorRef, setTimer: callback => { timers.set(1, callback); return 1 }, clearTimer: id => timers.delete(id) }
const flush = async () => { for (let i=0;i<10;i++) await Promise.resolve() }
const page = startRankedPolling(options)
await flush()
assert.equal(calls, 1)
assert.equal(timers.size, 0, 'An idle page must schedule zero network reads')
for (let i=0;i<120;i++) {
  documentRef.hidden = !documentRef.hidden
  documentRef.dispatchEvent(new Event('visibilitychange'))
  windowRef.dispatchEvent(new Event('online'))
}
await flush()
assert.equal(calls, 1, 'Focus/reconnect must not refresh passive information')
page.refresh(); await flush(); assert.equal(calls, 2)
assert.equal(timers.size, 0)
page.stop()
const nextPage = startRankedPolling(options)
await flush(); assert.equal(calls, 3, 'Re-entering a page reads its data once')
nextPage.stop()
console.log('PASS page entry reads once and schedules zero passive requests')
console.log('PASS focus and connectivity changes do not trigger passive reads')
console.log('PASS manual refresh and the next page each fetch once')
console.log(JSON.stringify({tests:3,passed:3,failed:0,initialRequests:1,scheduledRequests:0}))
