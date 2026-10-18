import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createRankedService } from '../server/rankedService.js'
import { createMemoryRankedStore } from '../server/rankedStore.js'
import { createPostgresStore } from '../server/postgresStore.js'
import * as engine from '../server/rankedBattle.js'
import { normalizePokemon, getMoveById } from '../src/data/trainingData.js'

// Local synthetic records only. This script never connects to PostgreSQL.
// Service doubles prove behavior; the SQL artifact separately exercises actual SQL.
const NOW = 1_000_000
const copy = structuredClone
const bytes = value => Buffer.byteLength(JSON.stringify(value))
const who = index => ({ uid: 'budget-user-' + index, name: 'User ' + index })
const roster = [25, 6, 9, 143, 68, 131].map(speciesId => normalizePokemon({
  speciesId, captureId: 'budget-' + speciesId, moves: [getMoveById('protect').name],
}))
const tests = []
const test = (name, run) => tests.push({ name, run })
let measuredBudget, emittedProjectionSQL

function project(match, uid, revision, timelineRevision, timestamp) {
  if (!match || match.roomId || !['select', 'battle'].includes(match.phase)
    || match.revision !== revision || match.timelineRevision !== timelineRevision
    || match.deadlineAt <= timestamp || !match.players.some(player => player.uid === uid)) return null
  const { state, requests, players, ...metadata } = match
  return { ...metadata, players: players.map(({ team, ...player }) => player) }
}

function harness(initial, { compact = true, time = NOW } = {}) {
  const base = createMemoryRankedStore(initial)
  const reads = { logicalFullMatchGets: 0, projectedReads: 0, lastProjection: null }
  let serial = 0, request = 0
  const store = { transaction: work => base.transaction(tx => work({
    ...tx,
    async get(collection, key) {
      // These are logical service calls, NOT SQL calls; Postgres deduplicates gets.
      if (collection === 'matches') reads.logicalFullMatchGets++
      return tx.get(collection, key)
    },
    ...(compact ? {
      async readUnchangedMatch(key, uid, revision, timelineRevision, timestamp) {
        reads.projectedReads++
        reads.lastProjection = project(await tx.get('matches', key), uid, revision, timelineRevision, timestamp)
        return copy(reads.lastProjection)
      },
    } : {}),
  })) }
  const service = createRankedService({
    store, engine, now: () => time, newId: () => 'budget-id-' + (++serial), makeSeed: () => 125,
  })
  return {
    base, service, reads,
    call(identity, action, payload = {}) {
      return service.execute(typeof identity === 'number' ? who(identity) : identity, {
        action, requestId: 'budget-request-' + (++request), ...payload,
      })
    },
    resetReads() { reads.logicalFullMatchGets = 0; reads.projectedReads = 0; reads.lastProjection = null },
  }
}

async function fixture({ format = 'single', phase = 'battle', guest = false, room = false } = {}) {
  const env = harness(undefined, { compact: false })
  const identities = [0, 1].map(index => ({ ...who(index), isGuest: guest }))
  if (guest) for (const identity of identities) await env.call(identity, 'guestProfile')
  if (room) {
    const created = await env.call(0, 'roomCreate', { title: 'Synthetic room', mode: 'tournament', format, team: roster })
    await env.call(1, 'roomJoin', { roomId: created.room.id, team: roster })
    await env.call(0, 'roomStart', { roomId: created.room.id })
  } else {
    for (const identity of identities) await env.call(identity, 'join', { format, team: roster })
  }
  const initial = await env.base.inspect()
  const matchId = initial.collections.players[who(0).uid].activeMatchId
  const match = initial.collections.matches[matchId]
  if (phase === 'battle') {
    const selection = format === 'single' ? [0, 1, 2] : [0, 1, 2, 3]
    for (const identity of identities) await env.call(identity, 'select', { matchId, revision: match.revision, selection })
  }
  return { data: await env.base.inspect(), matchId }
}

function statusCommand(setup, extra = {}) {
  const match = setup.data.collections.matches[setup.matchId]
  return { action: 'status', matchId: match.id, matchRevision: match.revision, timelineRevision: match.timelineRevision, ...extra }
}

async function compare(setup, command = statusCommand(setup), { identity = who(0), time = NOW } = {}) {
  const normal = harness(setup.data, { compact: false, time })
  const compact = harness(setup.data, { time })
  const execute = async env => {
    try { return { value: await env.service.execute(identity, { requestId: 'budget-comparison-request', ...command }) } }
    catch (error) { return { error: { code: error.code, status: error.status } } }
  }
  const [expected, actual] = await Promise.all([execute(normal), execute(compact)])
  assert.deepEqual(actual, expected, 'Compact and original responses must agree')
  const [expectedData, actualData] = await Promise.all([normal.base.inspect(), compact.base.inspect()])
  assert.deepEqual(actualData, expectedData, 'Compact and original persisted data must agree')
  return { ...actual, data: actualData, reads: compact.reads }
}

function assertCompact(result) {
  assert.equal(result.error, undefined)
  assert.equal(result.reads.projectedReads, 1)
  assert.equal(result.reads.logicalFullMatchGets, 0, 'Eligible status must not request a complete match')
  for (const field of ['state', 'teamPreview', 'pendingActions', 'requests', 'selections', 'players']) {
    assert(!Object.hasOwn(result.value.match, field), 'Private or unchanged field leaked: ' + field)
  }
}

const single = await fixture()
for (const format of ['single', 'double']) for (const phase of ['select', 'battle']) {
  test(format + ' ' + phase + ' compact status equals full path without exporting state or teams', async () => {
    const setup = format === 'single' && phase === 'battle' ? single : await fixture({ format, phase })
    const result = await compare(setup)
    assertCompact(result)
    assert.deepEqual(result.data, setup.data, 'Read-only polling must not mutate persisted records')
    if (format === 'single' && phase === 'battle') {
      const fullBytes = bytes(setup.data.collections.matches[setup.matchId])
      const compactBytes = bytes(result.reads.lastProjection)
      assert(compactBytes < fullBytes / 20)
      measuredBudget = { fullMatchBytes: fullBytes, compactMatchBytes: compactBytes, reductionPercent: 100 * (1 - compactBytes / fullBytes) }
    }
  })
}

test('same-revision opponent submission remains fresh and private', async () => {
  const env = harness(single.data)
  const before = single.data.collections.matches[single.matchId]
  await env.call(1, 'submit', { matchId: before.id, revision: before.revision,
    actions: [{ type: 'move', actorSlot: 0, moveIndex: 0, targetSideId: 'player', targetSlot: 0 }] })
  const setup = { data: await env.base.inspect(), matchId: before.id }
  assert.equal(setup.data.collections.matches[before.id].revision, before.revision)
  const result = await compare(setup)
  assertCompact(result)
  assert.equal(result.value.match.opponentActionSubmitted, true)
})

test('nickname refresh preserves complete player history and receipts', async () => {
  const result = await compare(single, statusCommand(single), { identity: { ...who(0), nickname: 'Tester' } })
  assertCompact(result)
  const before = single.data.collections.players[who(0).uid]
  assert.deepEqual(result.data.collections.players[who(0).uid], { ...before, name: who(0).name, isGuest: false, nickname: 'Tester' })
})

for (const field of ['matchRevision', 'timelineRevision']) {
  test(field + ' mismatch falls back to the complete path', async () => {
    const result = await compare(single, statusCommand(single, { [field]: 0 }))
    assert.equal(result.error, undefined)
    assert(result.reads.logicalFullMatchGets > 0)
    if (field === 'matchRevision') assert(Object.hasOwn(result.value.match, 'state'))
  })
}
for (const revision of [null, -1, '01', 'NaN', '9007199254740992']) {
  test('invalid revision ' + String(revision) + ' bypasses compact reads', async () => {
    const result = await compare(single, statusCommand(single, { matchRevision: revision }))
    assert.equal(result.reads.projectedReads, 0)
  })
}

test('outsider and forged active-match pointer are rejected', async () => {
  const outsider = await compare(single, statusCommand(single), { identity: who(2) })
  assert.equal(outsider.error.code, 'MATCH_FORBIDDEN')
  assert.equal(outsider.reads.projectedReads, 0)
  const setup = copy(single)
  setup.data.collections.players[who(2).uid] = { ...copy(setup.data.collections.players[who(0).uid]), uid: who(2).uid }
  const forged = await compare(setup, statusCommand(setup), { identity: who(2) })
  assert.equal(forged.error.code, 'MATCH_FORBIDDEN')
  assert.equal(forged.reads.projectedReads, 1, 'Exercise the participant gate after the pointer gate')
})

test('expired queue conflict falls back and clears the queue and ticket', async () => {
  const setup = copy(single)
  setup.data.collections.queue[who(0).uid] = { uid: who(0).uid, ticket: 'expired-ticket', expiresAt: NOW, format: 'single' }
  setup.data.collections.players[who(0).uid].queueTicket = 'expired-ticket'
  const result = await compare(setup)
  assert.equal(result.error, undefined)
  assert.equal(result.reads.projectedReads, 1)
  assert(result.reads.logicalFullMatchGets > 0)
  assert.equal(result.data.collections.queue[who(0).uid], undefined)
  assert.equal(result.data.collections.players[who(0).uid].queueTicket, null)
})

test('deadline equality and replacement timeout settle with the full state exactly once', async () => {
  for (const replacement of [false, true]) {
    const setup = copy(single)
    const match = setup.data.collections.matches[setup.matchId]
    if (replacement) match.state.pendingHumanSwitch = { sideId: 'player', kind: 'faint' }
    const result = await compare(setup, statusCommand(setup), { time: match.deadlineAt })
    assert.equal(result.error, undefined)
    assert(result.reads.logicalFullMatchGets > 0)
    assert.equal(result.value.match.phase, 'finished')
    assert.equal(result.value.match.result.reason, replacement ? 'replacement-timeout' : 'both-timeout')
    const settled = { data: result.data, matchId: setup.matchId }
    const retry = await compare(settled, statusCommand(settled), { time: match.deadlineAt })
    assert.equal(retry.reads.projectedReads, 0)
    assert.deepEqual(retry.data, settled.data, 'Finished retry must not settle ratings or rewards again')
  }
})

test('rooms requests and active room membership retain the original room flow', async () => {
  const plainRooms = await compare(single, statusCommand(single, { action: 'rooms' }))
  assert.equal(plainRooms.reads.projectedReads, 0)
  const setup = await fixture({ room: true, phase: 'select' })
  for (const action of ['status', 'rooms']) {
    const result = await compare(setup, statusCommand(setup, { action }))
    assert.equal(result.error, undefined)
    assert.equal(result.reads.projectedReads, 0)
    assert(result.value.room)
  }
  // Even a stale missing player room pointer cannot turn a room match into ranked.
  delete setup.data.collections.players[who(0).uid].activeRoomId
  const stalePointer = await compare(setup)
  assert.equal(stalePointer.error, undefined)
  assert.equal(stalePointer.reads.projectedReads, 1)
  assert(stalePointer.reads.logicalFullMatchGets > 0)
})

test('guest deletion fence executes before the early return', async () => {
  const setup = await fixture({ guest: true })
  const identity = { ...who(0), isGuest: true }
  assertCompact(await compare(setup, statusCommand(setup), { identity }))
  const key = createHash('sha256').update('guest-owner:' + identity.uid).digest('hex')
  setup.data.collections.guestProfiles[key].deleting = true
  const result = await compare(setup, statusCommand(setup), { identity })
  assert.equal(result.error.code, 'GUEST_ACCOUNT_DELETED')
  assert.equal(result.reads.projectedReads, 0)
  assert.deepEqual(result.data, setup.data)
})

for (const action of ['submit', 'forfeit']) {
  test(action + ' mutation bypasses projection and preserves complete match data', async () => {
    const match = single.data.collections.matches[single.matchId]
    const result = await compare(single, statusCommand(single, {
      action, revision: match.revision,
      ...(action === 'submit' ? { actions: [{ type: 'move', actorSlot: 0, moveIndex: 0, targetSideId: 'player', targetSlot: 0 }] } : {}),
    }))
    assert.equal(result.error, undefined)
    assert.equal(result.reads.projectedReads, 0)
    assert(result.reads.logicalFullMatchGets > 0)
    const stored = result.data.collections.matches[single.matchId]
    assert(stored.state)
    assert(stored.players.every(player => player.team.length === 6))
    assert(stored.requests.length >= match.requests.length)
  })
}

// A deliberately non-SQL pool double: tests adapter isolation, parameter binding,
// buffered writes and rollback only. SQL predicates belong to the .sql fixture.
function adapterFixture() {
  const original = copy(single.data.collections.matches[single.matchId])
  const queries = []
  let persisted = copy(original), draft, failProjection = false
  const pool = { connect: async () => ({
    async query(text, values) {
      queries.push({ text, values: copy(values) })
      if (text.startsWith('BEGIN ')) { draft = copy(persisted); return { rows: [] } }
      if (text.startsWith('SELECT set_config')) return { rows: [] }
      if (text === 'COMMIT') { persisted = copy(draft); return { rows: [] } }
      if (text === 'ROLLBACK') { draft = undefined; return { rows: [] } }
      if (text.includes('AS status_match')) {
        if (failProjection) throw new Error('Synthetic projection failure')
        const { state, requests, players, ...rest } = draft
        return { rows: [{ status_match: { ...rest, players: players.map(({ team, ...player }) => player) } }] }
      }
      if (text.startsWith('SELECT payload FROM')) return { rows: draft ? [{ payload: copy(draft) }] : [] }
      if (text.startsWith('INSERT INTO')) { draft = JSON.parse(values[3]); return { rows: [], rowCount: 1 } }
      if (text.startsWith('DELETE FROM')) { draft = null; return { rows: [], rowCount: 1 } }
      throw new Error('Unexpected adapter query in test')
    },
    release() {},
  }) }
  const db = createPostgresStore({ pool, namespace: 'budget_adapter_test' })
  return {
    db, queries, original, inspect: () => copy(persisted), failProjection: () => { failProjection = true },
    project: tx => tx.readUnchangedMatch(original.id, who(0).uid, original.revision, original.timelineRevision, NOW),
  }
}

test('adapter projection leaves full cache and full update state, teams and receipts intact', async () => {
  const env = adapterFixture()
  let ended
  await env.db.transaction(async tx => {
    ended = tx
    const compact = await env.project(tx)
    assert(!Object.hasOwn(compact, 'state') && !Object.hasOwn(compact, 'requests'))
    assert(compact.players.every(player => !Object.hasOwn(player, 'team')))
    compact.players[0].uid = 'mutated-copy'
    const original = await tx.get('matches', env.original.id)
    assert.deepEqual(original, env.original)
    tx.set('matches', original.id, { ...original, revision: original.revision + 1 })
  })
  assert.deepEqual(env.inspect(), { ...env.original, revision: env.original.revision + 1 })
  const query = env.queries.find(query => query.text.includes('AS status_match'))
  emittedProjectionSQL = query.text
  assert.deepEqual(query.values, ['budget_adapter_test', 'matches', env.original.id, who(0).uid, env.original.revision, env.original.timelineRevision, NOW])
  assert.equal(env.queries.filter(query => query.text.startsWith('SELECT payload FROM')).length, 1)
  await assert.rejects(env.project(ended), /ended/)
  await env.db.close()
})

for (const operation of ['set', 'delete']) {
  test('adapter buffered ' + operation + ' bypasses projection without a stale SQL read', async () => {
    const env = adapterFixture()
    const updated = { ...env.original, revision: env.original.revision + 1 }
    await env.db.transaction(async tx => {
      if (operation === 'set') tx.set('matches', env.original.id, updated)
      else tx.delete('matches', env.original.id)
      assert.equal(await env.project(tx), null)
      assert.deepEqual(await tx.get('matches', env.original.id), operation === 'set' ? updated : null)
    })
    assert(!env.queries.some(query => query.text.includes('AS status_match')))
    assert.deepEqual(env.inspect(), operation === 'set' ? updated : null)
    await env.db.close()
  })
}

test('adapter rejects invalid numeric arguments before issuing projection SQL', async () => {
  const env = adapterFixture()
  await env.db.transaction(async tx => {
    for (const value of [-1, 1.5, NaN, Number.MAX_SAFE_INTEGER + 1]) {
      assert.equal(await tx.readUnchangedMatch(env.original.id, who(0).uid, value, 2, NOW), null)
      assert.equal(await tx.readUnchangedMatch(env.original.id, who(0).uid, 2, value, NOW), null)
    }
    assert.equal(await tx.readUnchangedMatch(env.original.id, who(0).uid, 2, 2, NaN), null)
  })
  assert(!env.queries.some(query => query.text.includes('AS status_match')))
  await env.db.close()
})

test('adapter projection failure rolls back pending changes', async () => {
  const env = adapterFixture()
  env.failProjection()
  await assert.rejects(env.db.transaction(async tx => {
    tx.set('players', who(0).uid, { synthetic: true })
    await env.project(tx)
  }), /Synthetic projection failure/)
  assert(env.queries.some(query => query.text === 'ROLLBACK'))
  assert(!env.queries.some(query => query.text === 'COMMIT' || query.text.startsWith('INSERT INTO')))
  assert.deepEqual(env.inspect(), env.original)
  await env.db.close()
})

test('rollback fixture embeds the exact adapter SQL and is transaction bounded', async () => {
  const fixtureText = await readFile(new URL('./ranked-database-budget.sql', import.meta.url), 'utf8')
  const embedded = fixtureText.match(/\$adapter_sql\$([\s\S]*?)\$adapter_sql\$/)
  assert(embedded, 'Rollback artifact must contain the tagged adapter query')
  assert.equal(embedded[1].trim(), emittedProjectionSQL.trim(), 'Refresh the rollback fixture when adapter SQL changes')
  const withoutComments = fixtureText.replace(/--[^\n]*/g, '').trim()
  assert(withoutComments.startsWith('BEGIN ISOLATION LEVEL SERIALIZABLE;'))
  assert(withoutComments.endsWith('ROLLBACK;'))
  assert(!/\bCOMMIT\b/i.test(withoutComments))
  assert(!/ON\s+CONFLICT|TRUNCATE|DROP\s+TABLE/i.test(withoutComments), 'Fixture must not overwrite or remove existing records')
})

let passed = 0
for (const { name, run } of tests) {
  await run()
  passed++
  console.log('PASS ' + name)
}
console.log(JSON.stringify({
  passed: true, checks: passed, ...measuredBudget,
  livePostgresExecuted: false, sqlFixture: 'scripts/ranked-database-budget.sql',
}))
