import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { setImmediate as nextTurn } from 'node:timers/promises'

// Preserve the actual client implementation; Node only needs its Vite-style
// extensionless import rewritten to an absolute module URL. No app is started.
const clientUrl = new URL('../src/pokemonUsageClient.js', import.meta.url)
const clientSource = (await readFile(clientUrl, 'utf8')).replace(
  "from './rankedClient'",
  `from '${new URL('../src/rankedClient.js', import.meta.url).href}'`,
)
const { createUsageOutbox } = await import(`data:text/javascript;base64,${Buffer.from(clientSource).toString('base64')}`)

// Every send in this suite is an injected fake, including simulated server
// receipts. Fail closed if a future client change attempts any real network.
const originalFetch = globalThis.fetch
globalThis.fetch = async () => { throw new Error('Usage client validation forbids network requests') }

class MemoryStorage {
  values = new Map()
  readError = null
  writeError = null
  writes = []

  getItem(key) {
    if (this.readError) throw this.readError
    return this.values.get(key) ?? null
  }

  setItem(key, value) {
    if (this.writeError) throw this.writeError
    this.values.set(key, String(value))
    this.writes.push({ key, value: String(value) })
  }
}

const key = (uid = 'alice', prefix = 'champions-usage-outbox-v1') => `${prefix}:${uid}`
const entries = (storage, uid = 'alice', prefix) => JSON.parse(storage.getItem(key(uid, prefix)) ?? '[]')
const report = (battleId = 'battle-1', format = 'single') => ({ battleId, format, speciesIds: [6, 25, 94] })
const usage = teamCount => ({ source: 'live', buckets: { 'ai-single': { teamCount } }, updatedAt: 1000 })

function deferred() {
  let resolve
  let reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

const tests = []
const test = (name, run) => tests.push({ name, run })

test('save before send and isolate the report from later caller mutations', async () => {
  const storage = new MemoryStorage()
  const snapshots = []
  let requests = 0
  const outbox = createUsageOutbox({ uid: 'alice', storage, onSnapshot: value => snapshots.push(value),
    send: async (entry, signal) => {
      requests += 1
      assert.deepEqual(entries(storage), [entry], 'The pending report must already be durable at send time')
      assert(signal instanceof AbortSignal)
      assert.equal(signal.aborted, false)
      return { usage: usage(1) }
    } })
  const input = { ...report(), secret: 'not part of the usage report' }
  assert.equal(outbox.enqueue(input), true)
  input.speciesIds.push(9)
  input.battleId = 'changed-after-enqueue'
  assert.deepEqual(entries(storage), [report()])
  assert.equal(requests, 0, 'Enqueue must never transmit before its storage write finishes')
  await outbox.flush()
  assert.equal(requests, 1)
  assert.deepEqual(entries(storage), [])
  assert.deepEqual(snapshots, [usage(1)])
  outbox.stop()
})

test('offline retry survives a fresh outbox instance', async () => {
  const storage = new MemoryStorage()
  const offline = createUsageOutbox({ uid: 'alice', storage, send: async () => { throw new Error('offline') } })
  offline.enqueue(report())
  await assert.rejects(offline.flush(), /offline/)
  assert.deepEqual(entries(storage), [report()])
  offline.stop()

  const retried = []
  const restarted = createUsageOutbox({ uid: 'alice', storage,
    send: async entry => { retried.push(entry); return { usage: usage(1) } } })
  await restarted.flush()
  assert.deepEqual(retried, [report()])
  assert.deepEqual(entries(storage), [])
  restarted.stop()
})

test('ambiguous response retry preserves battle identity for server deduplication', async () => {
  const storage = new MemoryStorage()
  const receipts = new Set()
  const requests = []
  let loseResponse = true
  let countedTeams = 0
  const send = async entry => {
    requests.push(structuredClone(entry))
    if (!receipts.has(entry.battleId)) {
      receipts.add(entry.battleId)
      countedTeams += 1
    }
    if (loseResponse) { loseResponse = false; throw new Error('response lost after the server commit') }
    return { usage: usage(countedTeams) }
  }
  const first = createUsageOutbox({ uid: 'alice', storage, send })
  first.enqueue(report())
  await assert.rejects(first.flush(), /response lost/)
  assert.equal(countedTeams, 1)
  assert.deepEqual(entries(storage), [report()])
  first.stop()

  const restarted = createUsageOutbox({ uid: 'alice', storage, send })
  await restarted.flush()
  assert.equal(countedTeams, 1, 'The unchanged battle ID allows server receipts to reject double counting')
  assert.deepEqual(requests, [report(), report()])
  assert.deepEqual(entries(storage), [])
  restarted.stop()
})

test('duplicate enqueues and concurrent flush calls share one request', async () => {
  const storage = new MemoryStorage()
  const response = deferred()
  let requests = 0
  const outbox = createUsageOutbox({ uid: 'alice', storage,
    send: async () => { requests += 1; return response.promise } })
  outbox.enqueue(report())
  outbox.enqueue({ ...report(), format: 'double', speciesIds: [9] })
  assert.deepEqual(entries(storage), [report()], 'A repeated battle ID must not replace the original selected team')
  const firstFlush = outbox.flush()
  assert.equal(outbox.flush(), firstFlush)
  assert.equal(outbox.flush(), firstFlush)
  assert.equal(requests, 1)
  response.resolve({ usage: usage(1) })
  await firstFlush
  await outbox.flush()
  assert.equal(requests, 1)
  outbox.stop()
})

test('a battle queued while a send waits remains in the same flush', async () => {
  const storage = new MemoryStorage()
  const response = deferred()
  const requests = []
  const outbox = createUsageOutbox({ uid: 'alice', storage, send: async entry => {
    requests.push(entry.battleId)
    return entry.battleId === 'battle-1' ? response.promise : { usage: usage(2) }
  } })
  outbox.enqueue(report())
  const flushing = outbox.flush()
  outbox.enqueue(report('battle-2', 'double'))
  response.resolve({ usage: usage(1) })
  await flushing
  assert.deepEqual(requests, ['battle-1', 'battle-2'])
  assert.deepEqual(entries(storage), [])
  outbox.stop()
})

test('account and demo/live namespaces never send each other\'s reports', async () => {
  const storage = new MemoryStorage()
  const requests = []
  const prefix = 'champions-usage-outbox-v1-live'
  const fixture = (uid, keyPrefix = prefix) => createUsageOutbox({ uid, keyPrefix, storage,
    send: async entry => { requests.push({ uid, keyPrefix, battleId: entry.battleId }); return { usage: usage(1) } } })
  const alice = fixture('alice')
  const bob = fixture('bob')
  const demo = fixture('alice', 'champions-usage-outbox-v1-demo')
  alice.enqueue(report('alice-battle'))
  bob.enqueue(report('bob-battle'))
  demo.enqueue(report('demo-battle'))
  await bob.flush()
  assert.deepEqual(requests, [{ uid: 'bob', keyPrefix: prefix, battleId: 'bob-battle' }])
  assert.deepEqual(entries(storage, 'alice', prefix), [report('alice-battle')])
  assert.deepEqual(entries(storage, 'alice', 'champions-usage-outbox-v1-demo'), [report('demo-battle')])
  alice.stop()
  bob.stop()
  demo.stop()
})

test('account switch aborts a pending send and ignores its late success', async () => {
  const storage = new MemoryStorage()
  const response = deferred()
  let signal
  const snapshots = []
  const alice = createUsageOutbox({ uid: 'alice', storage, onSnapshot: value => snapshots.push(value),
    send: async (_entry, currentSignal) => { signal = currentSignal; return response.promise } })
  alice.enqueue(report('alice-battle'))
  const pending = alice.flush()
  alice.stop()
  assert.equal(signal.aborted, true)
  assert.equal(alice.enqueue(report('should-not-save')), false)
  await alice.flush()
  response.resolve({ usage: usage(1) })
  await pending
  assert.deepEqual(snapshots, [], 'A stale account response must not reach the new account UI')
  assert.deepEqual(entries(storage), [report('alice-battle')], 'A cancelled report must remain available for the original account')
  const bob = createUsageOutbox({ uid: 'bob', storage, send: async () => assert.fail('Bob must not send Alice reports') })
  await bob.flush()
  bob.stop()
})

test('abort rejection keeps an interrupted report for restart', async () => {
  const storage = new MemoryStorage()
  const outbox = createUsageOutbox({ uid: 'alice', storage, send: (_entry, signal) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true })
  }) })
  outbox.enqueue(report())
  const pending = outbox.flush()
  const rejected = assert.rejects(pending, { name: 'AbortError' })
  outbox.stop()
  await rejected
  assert.deepEqual(entries(storage), [report()])
})

test('enqueue storage failure is visible and never sends an unsaved report', async () => {
  const storage = new MemoryStorage()
  let requests = 0
  const outbox = createUsageOutbox({ uid: 'alice', storage,
    send: async () => { requests += 1; return { usage: usage(1) } } })
  storage.writeError = new DOMException('storage full', 'QuotaExceededError')
  assert.throws(() => outbox.enqueue(report()), { name: 'QuotaExceededError' })
  await outbox.flush()
  assert.equal(requests, 0)
  assert.equal(storage.values.size, 0)
  storage.writeError = null
  outbox.enqueue(report())
  await outbox.flush()
  assert.equal(requests, 1)
  outbox.stop()
})

test('storage failure after server acceptance retains a safe retry', async () => {
  const storage = new MemoryStorage()
  const receipts = new Set()
  let requests = 0
  const snapshots = []
  const outbox = createUsageOutbox({ uid: 'alice', storage, onSnapshot: value => snapshots.push(value), send: async entry => {
    requests += 1
    receipts.add(entry.battleId)
    return { usage: usage(receipts.size) }
  } })
  outbox.enqueue(report())
  storage.writeError = new Error('write failed after server accepted')
  await assert.rejects(outbox.flush(), /write failed/)
  assert.equal(receipts.size, 1)
  assert.deepEqual(entries(storage), [report()])
  assert.deepEqual(snapshots, [])
  storage.writeError = null
  await outbox.flush()
  assert.equal(requests, 2)
  assert.equal(receipts.size, 1)
  assert.deepEqual(snapshots, [usage(1)])
  assert.deepEqual(entries(storage), [])
  outbox.stop()
})

test('unreadable and corrupt storage reject without erasing queued evidence', async () => {
  const storage = new MemoryStorage()
  const outbox = createUsageOutbox({ uid: 'alice', storage,
    send: async () => assert.fail('Unreadable reports must never be sent') })
  storage.readError = new DOMException('storage access denied', 'SecurityError')
  assert.throws(() => outbox.enqueue(report()), { name: 'SecurityError' })
  await assert.rejects(outbox.flush(), { name: 'SecurityError' })
  storage.readError = null
  for (const badValue of ['{invalid', '{"battleId":"not-an-array"}', 'null']) {
    storage.values.set(key(), badValue)
    assert.throws(() => outbox.enqueue(report()))
    await assert.rejects(outbox.flush())
    assert.equal(storage.values.get(key()), badValue)
  }
  assert.equal(storage.writes.length, 0)
  outbox.stop()
})

test('bounded queue preserves all old reports when capacity is reached', async () => {
  const storage = new MemoryStorage()
  const outbox = createUsageOutbox({ uid: 'alice', storage, send: async () => ({ usage: usage(1) }) })
  for (let index = 0; index < 200; index += 1) outbox.enqueue(report(`battle-${index}`))
  const saved = storage.values.get(key())
  assert.equal(outbox.enqueue(report('battle-1')), true, 'A duplicate must be harmless even at capacity')
  assert.throws(() => outbox.enqueue(report('overflow')), /가득/)
  assert.equal(storage.values.get(key()), saved)
  outbox.stop()
})

try {
  for (const { name, run } of tests) {
    await run()
    await nextTurn()
    console.log(`PASS ${name}`)
  }
  console.log(`PASS ${tests.length} Pokémon usage outbox regressions; no network or production requests`)
} finally {
  globalThis.fetch = originalFetch
}
