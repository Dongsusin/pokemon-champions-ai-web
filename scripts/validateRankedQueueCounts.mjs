import assert from 'node:assert/strict'
import { createMemoryRankedStore } from '../server/rankedStore.js'
import { createRankedService } from '../server/rankedService.js'
import { createRankedHttpHandler, createLocalRankedAuthenticator } from '../server/rankedHttp.js'
import { createRankedQueueCountsReader } from '../server/rankedQueueCounts.js'
import { createPostgresPool, createPostgresStore } from '../server/postgresStore.js'

const tests = []
const test = (name, run) => tests.push({ name, run })
const engine = { canonicalizeRankedTeam: team => structuredClone(team) }
const team = Array.from({ length: 6 }, (_, index) => ({ captureId: `private-capture-${index}`, speciesId: index + 1, name: `Private Pokemon ${index}` }))
function environment() {
  const store = createMemoryRankedStore()
  let timestamp = 1_000_000, sequence = 0
  const service = createRankedService({ store, engine, now: () => timestamp, newId: () => `queue-match-${++sequence}`, makeSeed: () => 1 })
  const call = (uid, action, payload = {}) => service.execute({ uid, name: `${uid} Private Name` }, { action, requestId: `queue-request-${++sequence}`, ...payload })
  const counts = () => service.execute({ uid: 'viewer', name: 'Private Viewer' }, { action: 'queueCounts' })
  return { store, service, call, counts, now: () => timestamp, advance: ms => { timestamp += ms } }
}
const assertCounts = (result, single, double, timestamp) => assert.deepEqual(result, { single, double, total: single + double, updatedAt: timestamp })

test('real join, match, cancel and exact lease expiry change only the appropriate waiting counts', async () => {
  const env = environment()
  await env.call('alice', 'join', { format: 'single', team })
  const bob = await env.call('bob', 'join', { format: 'double', team })
  assertCounts(await env.counts(), 1, 1, env.now())
  const matched = await env.call('charlie', 'join', { format: 'single', team })
  assert.equal(matched.match.phase, 'select')
  env.advance(10_000)
  assertCounts(await env.counts(), 0, 1, env.now())
  await env.call('bob', 'cancel', { queueTicket: bob.queue.ticket })
  env.advance(10_000)
  assertCounts(await env.counts(), 0, 0, env.now())
  await env.call('dave', 'join', { format: 'double', team })
  env.advance(10_000)
  assertCounts(await env.counts(), 0, 1, env.now())
  env.advance(20_000)
  const before = await env.store.inspect()
  assert.equal(before.collections.queue.dave.expiresAt, env.now())
  assertCounts(await env.counts(), 0, 0, env.now())
  assert.deepEqual(await env.store.inspect(), before, 'Expired queue documents are not deleted or renewed by the overview')
})

test('overview reads never create players, settle matches, renew leases or attempt matches', async () => {
  const env = environment()
  await env.call('alice', 'join', { format: 'single', team })
  env.advance(12_000)
  await env.store.transaction(tx => tx.set('matches', 'expired-battle', { phase: 'select', deadlineAt: 1, players: [] }))
  const before = await env.store.inspect()
  assertCounts(await env.counts(), 1, 0, env.now())
  assert.deepEqual(await env.store.inspect(), before)
  assert.equal(before.collections.players.viewer, undefined)
  assert.doesNotMatch(JSON.stringify(await env.counts()), /alice|Private|capture|team|uid|ticket|rating|match/i)
})

test('orphaned, stale-ticket, already matched and malformed queue entries are excluded', async () => {
  const env = environment()
  await env.call('alice', 'join', { format: 'single', team })
  await env.store.transaction(tx => {
    const row = { format: 'double', ticket: 'valid-ticket', expiresAt: env.now() + 5_000 }
    tx.set('queue', 'missing-player', { ...row, uid: 'missing-player' })
    for (const [uid, value, player] of [
      ['stale-ticket', {}, { queueTicket: 'newer-ticket' }],
      ['matched-player', {}, { activeMatchId: 'live-match' }],
      ['invalid-format', { format: 'triple' }, {}],
      ['invalid-expiry', { expiresAt: String(row.expiresAt) }, {}],
      ['wrong-uid', { uid: 'someone-else' }, {}],
      ['valid-double', {}, {}],
    ]) {
      tx.set('queue', uid, { ...row, uid, ...value })
      tx.set('players', uid, { uid, queueTicket: row.ticket, activeMatchId: null, ...player })
    }
  })
  assertCounts(await env.counts(), 1, 1, env.now())
  env.advance(5_000)
  assertCounts(await env.counts(), 1, 0, env.now())
})

test('all viewers share a ten-second aggregate cache and concurrent reads coalesce without broad reads', async () => {
  let timestamp = 1000, reads = 0, resolveRead
  const gate = new Promise(resolve => { resolveRead = resolve })
  const reader = createRankedQueueCountsReader({ now: () => timestamp, store: {
    transaction() { assert.fail('Postgres counts must not download full queue documents') },
    async countRankedQueue(at) { reads++; await gate; return { single: 2, double: 3, nextExpiry: at + 30_000 } },
  } })
  const pending = Array.from({ length: 20 }, () => reader())
  assert.equal(reads, 1)
  resolveRead()
  const results = await Promise.all(pending)
  for (const result of results) assertCounts(result, 2, 3, 1000)
  results[0].single = 999
  timestamp += 9_999
  assertCounts(await reader(), 2, 3, 1000)
  assert.equal(reads, 1)
  timestamp++
  assertCounts(await reader(), 2, 3, timestamp)
  assert.equal(reads, 2)
  timestamp--
  assertCounts(await reader(), 2, 3, timestamp)
  assert.equal(reads, 3, 'Clock rollback must not present a future sample')
})

test('aggregate outages and invalid results are throttled without zero or stale count fabrication', async () => {
  let timestamp = 1000, reads = 0, fail = false
  const reader = createRankedQueueCountsReader({ now: () => timestamp, store: {
    async countRankedQueue() { reads++; if (fail) throw new Error('aggregate unavailable'); return { single: 1, double: 0 } },
  } })
  assertCounts(await reader(), 1, 0, timestamp)
  timestamp += 10_000
  fail = true
  await assert.rejects(reader(), /unavailable/)
  await assert.rejects(reader(), /unavailable/)
  assert.equal(reads, 2)
  timestamp += 10_000
  fail = false
  assertCounts(await reader(), 1, 0, timestamp)
  for (const single of [null, '4', -1, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    const invalid = createRankedQueueCountsReader({ store: { async countRankedQueue() { return { single, double: 0 } } } })
    await assert.rejects(invalid(), /Invalid ranked queue aggregate/)
  }
})

test('authenticated GET exposes only aggregate numbers and rejects missing or invalid authentication', async () => {
  const env = environment()
  const http = createRankedHttpHandler({ service: env.service, enabled: true, now: env.now,
    authenticate: createLocalRankedAuthenticator({ enabled: true, production: false }) })
  const request = token => new Request('http://127.0.0.1/api/ranked?action=queueCounts', {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  })
  assert.equal((await http(request())).status, 401)
  assert.equal((await http(request('invalid-auth-token'))).status, 401)
  const result = await http(request('ranked-test-alice'))
  assert.equal(result.status, 200)
  assert.equal(result.headers.get('cache-control'), 'no-store')
  assertCounts(await result.json(), 0, 0, env.now())
  assert.deepEqual((await env.store.inspect()).collections, {})
  assert.equal((await http(new Request('http://127.0.0.1/api/ranked?action=join', { headers: { authorization: 'Bearer ranked-test-alice' } }))).status, 405)
})

test('guest access keeps deletion fences and does not create a guest profile during count reads', async () => {
  const env = environment()
  const identity = { uid: 'guest-viewer', isGuest: true }
  await assert.rejects(env.service.execute(identity, { action: 'queueCounts' }), error => error.code === 'GUEST_PROFILE_REQUIRED')
  await env.service.execute(identity, { action: 'guestProfile' })
  const before = await env.store.inspect()
  assertCounts(await env.service.execute(identity, { action: 'queueCounts' }), 0, 0, env.now())
  assert.deepEqual(await env.store.inspect(), before)
  await env.store.transaction(tx => tx.set('guestProfiles', Object.keys(before.collections.guestProfiles)[0], { deleted: true, deletedAt: env.now() }))
  await assert.rejects(env.service.execute(identity, { action: 'queueCounts' }), error => error.code === 'GUEST_ACCOUNT_DELETED')
})

test('Postgres uses one aggregate statement, parameters and no payload export; errors discard the connection', async () => {
  const calls = [], releases = []
  let reply = { single: '2', double: '1', next_expiry: '2500' }, queryError
  const pool = { async connect() { return {
    async query(config) { calls.push(config); if (queryError) throw queryError; return { rows: [reply] } },
    release(discard) { releases.push(discard) },
  } } }
  const store = createPostgresStore({ pool, namespace: 'ranked' })
  assert.deepEqual(await store.countRankedQueue(1000), { single: 2, double: 1, nextExpiry: 2500 })
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].values, ['ranked', 1000])
  assert.match(calls[0].text, /COUNT\(\*\) FILTER/)
  assert.match(calls[0].text, /JOIN champions\.documents p/)
  assert.match(calls[0].text, /queueTicket/)
  assert.doesNotMatch(calls[0].text, /SELECT (?:key, )?payload|jsonb_agg|\bBEGIN\b|\bUPDATE\b|\bDELETE\b/)
  assert.equal(calls[0].query_timeout, 2000)
  assert.deepEqual(releases, [false])
  for (const single of [null, undefined, 'NaN', '-1', '0.5']) {
    reply = { single, double: '0', next_expiry: null }
    await assert.rejects(store.countRankedQueue(1000), /result/)
    assert.equal(releases.at(-1), true)
  }
  queryError = Object.assign(new Error('query timeout'), { code: '57014' })
  await assert.rejects(store.countRankedQueue(1000), error => error.code === '57014')
  assert.equal(releases.at(-1), true)
  const queries = calls.length
  await assert.rejects(store.countRankedQueue(-1), /timestamp/)
  assert.equal(calls.length, queries)
  await store.close()
  await assert.rejects(store.countRankedQueue(1000), /closed/)
})

if (process.argv.includes('--live')) test('live PostgreSQL runs the aggregate and read-only SQL fixtures without storing test data', async () => {
  let query
  const capture = createPostgresStore({ pool: { async connect() { return {
    async query(config) { query = config; return { rows: [{ single: '0', double: '0', next_expiry: null }] } },
    release() {},
  } } } })
  await capture.countRankedQueue(1000)
  await capture.close()
  const fixtures = []
  const add = (uid, queue = {}, player = {}) => {
    fixtures.push({ namespace: 'ranked', collection: 'queue', key: uid,
      payload: { uid, format: 'single', ticket: 'valid-ticket', expiresAt: 4000, ...queue } })
    if (player) fixtures.push({ namespace: 'ranked', collection: 'players', key: uid,
      payload: { uid, queueTicket: 'valid-ticket', activeMatchId: null, ...player } })
  }
  add('single-one')
  add('single-two', { expiresAt: 3000 })
  add('double-one', { format: 'double', expiresAt: 2000 })
  add('expired', { expiresAt: 1000 })
  add('orphan', {}, null)
  add('old-ticket', {}, { queueTicket: 'new-ticket' })
  add('in-match', {}, { activeMatchId: 'ongoing' })
  add('wrong-uid', { uid: 'another-user' })
  add('wrong-format', { format: 'raid' })
  add('fractional-expiry', { expiresAt: 2000.5 })
  add('string-expiry', { expiresAt: 'invalid-numeric' })
  add('missing-expiry', { expiresAt: null })
  add('huge-expiry', { expiresAt: 1e100 })
  const pool = createPostgresPool()
  const store = createPostgresStore({ pool, namespace: process.env.RANKED_FIRESTORE_PREFIX || 'ranked' })
  try {
    const statement = `WITH test_documents AS (
      SELECT * FROM jsonb_to_recordset($3::jsonb) AS fixture(namespace text, collection text, key text, payload jsonb)
    ) ${query.text.replaceAll('champions.documents', 'test_documents')}`
    const tested = await pool.query({ text: statement, values: ['ranked', 1000, JSON.stringify(fixtures)], query_timeout: 2000 })
    assert.deepEqual(tested.rows, [{ single: '2', double: '1', next_expiry: '2000' }])
    const current = await store.countRankedQueue(Date.now())
    console.log(`Live aggregate: single=${current.single}, double=${current.double}, total=${current.single + current.double}`)
  } finally { await store.close(); await pool.end() }
})

for (const { name, run } of tests) { await run(); console.log(`PASS ${name}`) }
console.log(`Ranked queue counts: ${tests.length} checks passed`)
