import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { createMemoryRankedStore } from '../server/rankedStore.js'
import { RAID_ENGINE_VERSION, RAID_RULE_VERSION, RAID_SCHEMA_VERSION } from '../src/data/raidRules.js'
import { createRaidRetentionIndex, planRaidRetentionCleanup, RAID_RETENTION_BATCH_SIZE, RAID_RETENTION_MS, selectExpiredRaidRetentionIndexes } from '../server/raidRetention.js'

// Pure retention policy + the real transactional memory adapter. These tests
// never connect to a deployed database and do not add any production test API.
const versions = { schemaVersion: RAID_SCHEMA_VERSION, ruleVersion: RAID_RULE_VERSION, engineVersion: RAID_ENGINE_VERSION }
const hash = parts => createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 60)
const resultId = (raidId, ownerId) => `rr_${hash([raidId, ownerId, 'result'])}`
const eventId = (raidId, start, end) => `re_${hash([raidId, start, end])}`
const clone = value => structuredClone(value)

function runFixture(id = 'retention-run-01', finishedAt = 1000) {
  return {
    id, ...versions, lifecycle: 'finished', bossId: 'mewtwo', revision: 123,
    participants: [{ ownerId: `${id}-owner-a`, isNpc: false }, { ownerId: `${id}-owner-b`, isNpc: false, withdrawn: true }, { ownerId: 'npc-support', isNpc: true }],
    result: { outcome: 'won', finishedAt },
    battle: { raid: { ...versions }, privateSnapshot: 'must-never-enter-the-index' },
    eventChunks: [{ id: eventId(id, 1, 20), cursorStart: 1, cursorEnd: 20 }, { id: eventId(id, 21, 40), cursorStart: 21, cursorEnd: 40 }],
  }
}

async function seedRun(store, run, index = createRaidRetentionIndex(run)) {
  await store.transaction(async tx => {
    tx.set('raidRuns', run.id, run)
    tx.set('raidRunHeads', run.id, { id: run.id, ...versions, lifecycle: run.lifecycle })
    if (index) tx.set('raidExpiryIndex', run.id, index)
    for (const chunk of run.eventChunks) tx.set('raidEvents', chunk.id, { ...chunk, raidId: run.id, events: ['retained battle event'] })
    for (const member of run.participants.filter(member => !member.isNpc)) {
      const id = resultId(run.id, member.ownerId)
      tx.set('raidResults', id, { id, raidId: run.id, uid: member.ownerId, finishedAt: run.result.finishedAt })
      tx.set('raidRewardReceipts', `clear_${member.ownerId}`, { uid: member.ownerId, raidId: run.id, vp: 300 })
      tx.set('raidFirstClears', `first_${member.ownerId}`, { uid: member.ownerId, bossId: run.bossId, raidId: run.id })
      tx.set('raidWallets', member.ownerId, { uid: member.ownerId, earnedTotal: 800, appliedTotal: 800 })
      tx.set('raidPlayers', member.ownerId, { uid: member.ownerId, vpRewardTotal: 800, lastRaidId: run.id, activeRaidId: null })
    }
  })
}

// Model the integration contract: index-only discovery, bounded direct gets,
// validation + deletion in one transaction. Service wiring has its own suite.
async function cleanup(store, now, reads = [], { failBeforeCommit = false } = {}) {
  return store.transaction(async tx => {
    reads.push(['list', 'raidExpiryIndex'])
    const candidates = selectExpiredRaidRetentionIndexes(await tx.list('raidExpiryIndex'), now)
    const deleted = []
    for (const index of candidates) {
      reads.push(['get', 'raidRuns', index.raidId])
      const plan = planRaidRetentionCleanup(index, await tx.get('raidRuns', index.raidId), now)
      if (!plan) continue
      for (const { collection, id } of plan.deleteDocuments) tx.delete(collection, id)
      for (const ownerId of plan.ownerIds) {
        const pointer = await tx.get('raidPlayers', ownerId)
        if (pointer?.lastRaidId === plan.raidId) tx.set('raidPlayers', ownerId, { ...pointer, lastRaidId: null })
      }
      deleted.push(plan.raidId)
    }
    if (failBeforeCommit) throw new Error('Injected transaction failure')
    return deleted
  })
}

test('terminal index is tiny, deterministic, excludes state/identities and expires after exactly seven days', () => {
  const run = runFixture()
  const before = clone(run)
  const index = createRaidRetentionIndex(run)
  assert.equal(index.expiresAt, run.result.finishedAt + 7 * 24 * 60 * 60 * 1000)
  assert.deepEqual(Object.keys(index).sort(), ['id', 'raidId', 'schemaVersion', 'ruleVersion', 'engineVersion', 'finishedAt', 'expiresAt'].sort())
  assert(Buffer.byteLength(JSON.stringify(index)) < 256)
  assert(!JSON.stringify(index).includes('owner'))
  assert.deepEqual(run, before)
  assert.deepEqual(index, createRaidRetentionIndex(JSON.parse(JSON.stringify(run))))
})

test('seven-day boundary preserves before expiry and permits deletion exactly at expiry', () => {
  const run = runFixture(), index = createRaidRetentionIndex(run)
  assert.equal(planRaidRetentionCleanup(index, run, index.expiresAt - 1), null)
  assert.deepEqual(selectExpiredRaidRetentionIndexes([index], index.expiresAt - 1), [])
  assert(planRaidRetentionCleanup(index, run, index.expiresAt))
  assert.deepEqual(selectExpiredRaidRetentionIndexes([index], index.expiresAt), [index])
  const zeroRun = runFixture('retention-epoch-zero', 0)
  assert.equal(createRaidRetentionIndex(zeroRun).expiresAt, RAID_RETENTION_MS)
})

test('active lifecycle, missing completion timestamps and stale terminal indexes are never purged', () => {
  const base = runFixture(), index = createRaidRetentionIndex(base), now = index.expiresAt + 10_000
  for (const lifecycle of ['input', 'resolving', 'intermission', 'paused', 'waiting']) {
    const run = { ...base, lifecycle }
    assert.equal(createRaidRetentionIndex(run), null)
    assert.equal(planRaidRetentionCleanup(index, run, now), null)
  }
  for (const finishedAt of [undefined, null, -1, NaN, Infinity, '1000', Number.MAX_SAFE_INTEGER]) {
    const run = { ...base, result: { finishedAt } }
    assert.equal(createRaidRetentionIndex(run), null)
    assert.equal(planRaidRetentionCleanup(index, run, now), null)
  }
  assert.equal(planRaidRetentionCleanup(index, { ...base, result: { finishedAt: 2000 } }, now), null)
  assert.equal(planRaidRetentionCleanup(index, { ...base, id: 'another-raid' }, now), null)
  assert.equal(planRaidRetentionCleanup(index, null, now), null)
  assert(createRaidRetentionIndex({ ...base, lifecycle: 'abandoned' }))
})

test('unknown outer, inner and expiry-index versions preserve records rather than guessing a migration', async () => {
  for (const layer of ['outer', 'inner', 'index']) for (const field of Object.keys(versions)) {
    for (const version of [undefined, 0, versions[field] + 1, String(versions[field])]) {
      const run = runFixture(), index = createRaidRetentionIndex(run)
      const target = layer === 'outer' ? run : layer === 'inner' ? run.battle.raid : index
      target[field] = version
      if (layer !== 'index') assert.equal(createRaidRetentionIndex(run), null)
      assert.equal(planRaidRetentionCleanup(index, run, index.expiresAt), null)
      const store = createMemoryRankedStore()
      await seedRun(store, run, index)
      const before = await store.inspect()
      await cleanup(store, index.expiresAt)
      assert.deepEqual(await store.inspect(), before, `${layer}.${field}=${version} must preserve all records`)
    }
  }
})

test('selection is stable, bounded to five and only reads full runs for expired supported index candidates', async () => {
  const store = createMemoryRankedStore(), entries = [], now = RAID_RETENTION_MS + 10_000
  for (let index = 0; index < 12; index++) {
    const run = runFixture(`retention-run-${String(index).padStart(2, '0')}`, 1000 + index)
    entries.push(createRaidRetentionIndex(run))
    await seedRun(store, run)
  }
  const future = createRaidRetentionIndex(runFixture('retention-not-expired', now))
  const unknown = { ...entries[0], id: 'unknown-version', raidId: 'unknown-version', engineVersion: 999 }
  const input = [...entries].reverse().concat([future, unknown, entries[1]])
  const before = clone(input)
  assert.deepEqual(selectExpiredRaidRetentionIndexes(input, now).map(entry => entry.raidId), entries.slice(0, 5).map(entry => entry.raidId))
  assert.equal(selectExpiredRaidRetentionIndexes(input, now, { limit: 999 }).length, RAID_RETENTION_BATCH_SIZE)
  assert.equal(selectExpiredRaidRetentionIndexes(input, now, { limit: 2 }).length, 2)
  assert.equal(selectExpiredRaidRetentionIndexes(input, now, { limit: 0 }).length, 0)
  assert.deepEqual(input, before)
  await store.transaction(async tx => {
    for (let index = 0; index < 40; index++) {
      const run = runFixture(`active-run-${index}`)
      run.lifecycle = 'input'
      tx.set('raidRuns', run.id, run)
    }
  })
  const reads = []
  assert.equal((await cleanup(store, now, reads)).length, 5)
  assert.deepEqual(reads.filter(entry => entry[0] === 'list'), [['list', 'raidExpiryIndex']])
  assert.equal(reads.filter(entry => entry[0] === 'get').length, 5)
  assert(!reads.some(entry => entry[2]?.startsWith('active-')))
  assert.equal(Object.keys((await store.inspect()).collections.raidRuns).length, 47)
})

test('cleanup removes the run, header, index, known event chunks and all human results while preserving permanent rewards', async () => {
  const store = createMemoryRankedStore(), run = runFixture(), index = createRaidRetentionIndex(run)
  await seedRun(store, run)
  const newerOwner = run.participants[1].ownerId
  await store.transaction(async tx => {
    const pointer = await tx.get('raidPlayers', newerOwner)
    tx.set('raidPlayers', newerOwner, { ...pointer, lastRaidId: 'newer-run', activeRaidId: 'active-run' })
    tx.set('raidEvents', 'unrelated-event', { raidId: 'other-run' })
    tx.set('raidResults', 'unrelated-result', { raidId: 'other-run' })
  })
  const before = await store.inspect()
  const plan = planRaidRetentionCleanup(index, run, index.expiresAt)
  assert.deepEqual(plan.ownerIds, run.participants.filter(member => !member.isNpc).map(member => member.ownerId))
  assert.equal(plan.deleteDocuments.length, 7)
  assert(plan.deleteDocuments.some(row => row.id === resultId(run.id, newerOwner)), 'Withdrawn human result is temporary too')
  assert(!plan.deleteDocuments.some(row => /Reward|FirstClear|Player|Wallet/i.test(row.collection)))
  assert.deepEqual(await cleanup(store, index.expiresAt), [run.id])
  const after = await store.inspect()
  for (const collection of ['raidRuns', 'raidRunHeads', 'raidExpiryIndex']) assert.equal(Object.keys(after.collections[collection]).length, 0)
  assert.deepEqual(Object.keys(after.collections.raidEvents), ['unrelated-event'])
  assert.deepEqual(Object.keys(after.collections.raidResults), ['unrelated-result'])
  for (const collection of ['raidRewardReceipts', 'raidFirstClears', 'raidWallets']) assert.deepEqual(after.collections[collection], before.collections[collection])
  assert.equal(after.collections.raidPlayers[run.participants[0].ownerId].lastRaidId, null)
  assert.deepEqual(after.collections.raidPlayers[newerOwner], before.collections.raidPlayers[newerOwner])
  for (const ownerId of plan.ownerIds) assert.equal(after.collections.raidPlayers[ownerId].vpRewardTotal, 800)
})

test('malformed and cross-run document references cannot turn cleanup into deletion of unrelated records', () => {
  const base = runFixture(), index = createRaidRetentionIndex(base), now = index.expiresAt
  for (const change of [
    run => { run.eventChunks[0].id = eventId('unrelated-run', 1, 20) },
    run => { run.eventChunks[0].cursorStart = 0 },
    run => { run.eventChunks[0].cursorEnd = 0 },
    run => { run.eventChunks = Array.from({ length: 25 }, () => run.eventChunks[0]) },
    run => { run.participants.push({ ownerId: 'fourth-human', isNpc: false }) },
    run => { run.participants[0].ownerId = '../unrelated' },
    run => { run.participants = null },
  ]) {
    const run = clone(base)
    change(run)
    assert.equal(planRaidRetentionCleanup(index, run, now), null)
  }
  for (const patch of [{ id: 'other-run' }, { expiresAt: index.expiresAt - 1 }, { finishedAt: '1000' }]) {
    assert.equal(planRaidRetentionCleanup({ ...index, ...patch }, base, now), null)
  }
})

test('transaction failure rolls every deletion back and repeated/concurrent cleanup is idempotent', async () => {
  const store = createMemoryRankedStore(), run = runFixture(), now = createRaidRetentionIndex(run).expiresAt
  await seedRun(store, run)
  const before = await store.inspect()
  await assert.rejects(cleanup(store, now, [], { failBeforeCommit: true }), /Injected transaction failure/)
  assert.deepEqual(await store.inspect(), before)
  const results = await Promise.all([cleanup(store, now), cleanup(store, now)])
  assert.equal(results.flat().length, 1)
  const after = await store.inspect()
  assert.deepEqual(await cleanup(store, now), [])
  assert.deepEqual(await store.inspect(), after)
})
