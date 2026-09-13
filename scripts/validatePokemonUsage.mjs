import assert from 'node:assert/strict'
import { NATIONAL_DEX, SPECIES_PROFILES, getSpeciesProfile } from '../src/data/trainingData.js'
import { createDemoUsageSnapshot } from './fixtures/pokemonUsageDemo.mjs'
import {
  USAGE_MODES,
  USAGE_FORMATS,
  canonicalUsageSpeciesId,
  canonicalUsageTeamEntry,
  createEmptyUsageSnapshot,
  createUsageBucket,
  getUsageRanking,
  getPokemonItemUsage,
  getCombinedPokemonItemUsage,
  mergeUsageSnapshots,
  recordUsageTeams,
  usageBucketKey,
} from '../src/data/pokemonUsage.js'

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.freeze(value)
    Object.values(value).forEach(deepFreeze)
  }
  return value
}

function close(actual, expected) {
  assert(Math.abs(actual - expected) < 1e-10, `${actual} should equal ${expected}`)
}

const empty = deepFreeze(createUsageBucket())
const emptyRows = getUsageRanking(empty)
assert.equal(emptyRows.length, 100)
assert.deepEqual(emptyRows.map(({ speciesId }) => speciesId), NATIONAL_DEX.map(({ id }) => id).sort((a, b) => a - b).slice(0, 100))
assert(emptyRows.every((row) => row.count === 0 && row.rate === 0 && row.rankDelta === 0 && row.rateDelta === 0 && !row.isNew))
assert(emptyRows.every((row) => row.sprite === getSpeciesProfile(row.speciesId).spriteFrontFallback && row.name && row.types.length))
emptyRows[0].types.push('TEST')
assert(!getSpeciesProfile(emptyRows[0].speciesId).types.includes('TEST'), 'Ranking rows must not expose mutable profile type arrays')

const before = deepFreeze(recordUsageTeams(empty, [[25, 6], [25, 9]], 1000))
assert.equal(before.teamCount, 2)
assert.deepEqual(before.counts, { 6: 1, 9: 1, 25: 2 })
assert.deepEqual(empty, createUsageBucket(), 'Frozen input bucket must remain unchanged')
assert.deepEqual(before.previous, { teamCount: 0, counts: {} })
const beforeRows = getUsageRanking(before)
assert.deepEqual(beforeRows.slice(0, 3).map(({ speciesId }) => speciesId), [25, 6, 9])
assert.equal(beforeRows[0].rate, 100)
assert.equal(beforeRows[1].rate, 50)
assert(beforeRows.slice(0, 3).every(({ isNew }) => isNew))
assert(beforeRows.slice(3).every(({ isNew, count }) => !isNew && count === 0))

const after = recordUsageTeams(before, [[9, 6], [9, 94]], 2000)
assert.equal(after.teamCount, 4, 'Two human teams in one event must add two denominator samples')
assert.deepEqual(after.counts, { 6: 2, 9: 3, 25: 2, 94: 1 })
assert.deepEqual(after.previous, { teamCount: 2, counts: { 6: 1, 9: 1, 25: 2 } }, 'Previous must snapshot the whole bucket before the batch')
assert.notEqual(after.previous.counts, before.counts)
assert.notEqual(after.counts, before.counts)
assert.equal(after.updatedAt, 2000)
const afterRows = getUsageRanking(after)
assert.deepEqual(afterRows.slice(0, 4).map(({ speciesId }) => speciesId), [9, 6, 25, 94])
assert.equal(afterRows[0].rankDelta, 2)
assert.equal(afterRows[0].rate, 75)
assert.equal(afterRows[0].rateDelta, 25)
assert.equal(afterRows[0].isNew, false)
assert.equal(afterRows[2].rankDelta, -2)
assert.equal(afterRows[2].rateDelta, -50)
assert.equal(afterRows[3].isNew, true)
assert.equal(afterRows[3].rateDelta, 25)
assert.equal(afterRows[3].rankDelta, 90)
close(getUsageRanking(recordUsageTeams(before, [[94]], 3000)).find(({ speciesId }) => speciesId === 25).rateDelta, -100 / 3)

const charizardForms = Object.values(SPECIES_PROFILES).filter((profile) => profile.parentSpeciesId === 6)
assert(charizardForms.length >= 2, 'Form aggregation test needs two known Charizard forms')
const duplicateTeam = deepFreeze([[6, 6, { speciesId: charizardForms[0].id }, { speciesId: charizardForms[1].id }]])
const forms = recordUsageTeams(empty, duplicateTeam, 4000)
assert.deepEqual(forms.counts, { 6: 1 })
assert.equal(forms.teamCount, 1)
assert.equal(canonicalUsageSpeciesId({ speciesId: charizardForms[0].id, parentSpeciesId: 25 }), 6, 'Only trusted metadata determines the base species')
for (const profile of Object.values(SPECIES_PROFILES)) {
  const canonicalId = canonicalUsageSpeciesId(profile.id)
  assert(NATIONAL_DEX.some(({ id }) => id === canonicalId))
  assert.equal(canonicalUsageSpeciesId({ speciesId: profile.id }), canonicalId)
}

for (const invalid of [null, undefined, NaN, Infinity, 0, -1, 1.5, 999999, '25', true, {}, [], { id: 25 }, { speciesId: '25' }]) {
  assert.throws(() => canonicalUsageSpeciesId(invalid), TypeError)
  assert.throws(() => recordUsageTeams(before, [[25, invalid]], 5000), TypeError)
}
for (const invalidTeams of [null, {}, [], [null], [[]], [[1, 2, 3, 4, 5, 6, 7]], new Array(1), [new Array(1)]]) {
  assert.throws(() => recordUsageTeams(before, invalidTeams, 5000), TypeError)
}
assert.throws(() => recordUsageTeams(before, [[25], [999999]], 5000), TypeError, 'A bad second team must reject the whole event')
assert.deepEqual(before.counts, { 6: 1, 9: 1, 25: 2 })
for (const timestamp of [-1, NaN, Infinity, '100', 0.5]) {
  assert.throws(() => recordUsageTeams(empty, [[25]], timestamp), TypeError)
}

for (const corrupt of [
  { ...createUsageBucket(), teamCount: 1 },
  { ...createUsageBucket(), teamCount: 1, counts: { 25: 2 } },
  { ...createUsageBucket(), teamCount: 1, counts: { 999999: 1 } },
  { ...createUsageBucket(), teamCount: 1, counts: { [charizardForms[0].id]: 1 } },
  { ...createUsageBucket(), teamCount: 1, counts: { '025': 1 } },
  { ...createUsageBucket(), teamCount: 1, counts: { 25: -1 } },
  { ...createUsageBucket(), teamCount: 1, counts: { 25: 0.5 } },
  { ...createUsageBucket(), teamCount: 1, counts: { 25: '1' } },
  { ...createUsageBucket(), teamCount: 1, counts: { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1 } },
  { ...createUsageBucket(), previous: { teamCount: 1, counts: { 25: 1 } } },
  { ...before, previous: { teamCount: 1, counts: { 94: 1 } } },
]) {
  assert.throws(() => getUsageRanking(corrupt), TypeError, 'Corrupt persisted counts must not turn into a plausible zero ranking')
  assert.throws(() => recordUsageTeams(corrupt, [[25]], 5000), TypeError)
}

const snapshot = createEmptyUsageSnapshot()
assert.equal(snapshot.source, 'live')
assert.equal(snapshot.updatedAt, 0)
assert.deepEqual(Object.keys(snapshot.buckets), ['ai-single', 'ai-double', 'ranked-single', 'ranked-double'])
for (const { id: mode } of USAGE_MODES) {
  for (const { id: format } of USAGE_FORMATS) {
    assert.deepEqual(snapshot.buckets[usageBucketKey(mode, format)], createUsageBucket())
  }
}
snapshot.buckets['ai-single'] = recordUsageTeams(snapshot.buckets['ai-single'], [[25]], 5000)
assert.equal(snapshot.buckets['ai-double'].teamCount, 0)
assert.equal(snapshot.buckets['ranked-single'].teamCount, 0)
assert.equal(snapshot.buckets['ranked-double'].teamCount, 0)
assert.notEqual(snapshot.buckets['ai-double'].counts, snapshot.buckets['ranked-double'].counts)
for (const [mode, format] of [['AI', 'single'], ['ai', 'triples'], ['ranked', null], ['trainer', 'double']]) {
  assert.throws(() => usageBucketKey(mode, format), TypeError)
}

const demo = createDemoUsageSnapshot()
assert.equal(demo.source, 'demo')
assert.deepEqual(demo, createDemoUsageSnapshot(), 'Demo snapshots must be reproducible independently of the current time')
assert.equal(createEmptyUsageSnapshot().source, 'live', 'Demo creation must not leak into live snapshot defaults')
for (const bucket of Object.values(demo.buckets)) {
  assert.equal(bucket.teamCount, 298)
  assert.equal(bucket.previous.teamCount, 266)
  assert(Object.values(bucket.counts).filter((count) => count > 0).length >= 100)
  const ranking = getUsageRanking(bucket)
  assert.equal(ranking.length, 100)
  assert.equal(new Set(ranking.map(({ speciesId }) => speciesId)).size, 100)
  assert(ranking.every(({ count, rate, rankDelta, rateDelta }) => count > 0 && rate > 0 && rate <= 100 && Number.isFinite(rankDelta) && Number.isFinite(rateDelta)))
  assert(ranking.some(({ rankDelta }) => rankDelta > 0))
  assert(ranking.some(({ rankDelta }) => rankDelta < 0))
}
assert.equal(new Set(Object.values(demo.buckets).map((bucket) => JSON.stringify(bucket.counts))).size, 4, 'All four demo buckets must have distinct distributions')

const oldResponse = createEmptyUsageSnapshot()
oldResponse.buckets['ai-single'] = recordUsageTeams(createUsageBucket(), [[25]], 1000)
const newResponse = structuredClone(oldResponse)
newResponse.buckets['ai-single'] = recordUsageTeams(oldResponse.buckets['ai-single'], [[6]], 2000)
deepFreeze(oldResponse)
deepFreeze(newResponse)
const forward = mergeUsageSnapshots(oldResponse, newResponse)
const reverse = mergeUsageSnapshots(newResponse, oldResponse)
assert.deepEqual(forward, reverse, 'A delayed GET must not undo the newer report response')
assert.equal(reverse.buckets['ai-single'].teamCount, 2)
assert.equal(reverse.updatedAt, 2000, 'Snapshot time must derive from the retained category timestamps')
assert.notEqual(reverse.buckets['ai-single'], newResponse.buckets['ai-single'], 'Merged data must not expose mutable input references')

const sameTimestamp = structuredClone(oldResponse)
sameTimestamp.buckets['ai-single'] = recordUsageTeams(oldResponse.buckets['ai-single'], [[6]], 1000)
assert.equal(mergeUsageSnapshots(sameTimestamp, oldResponse).buckets['ai-single'].teamCount, 2,
  'Concurrent commits in the same millisecond must retain the higher cumulative team count')
const fewerTeamsLaterTime = structuredClone(oldResponse)
fewerTeamsLaterTime.buckets['ai-single'].updatedAt = 9999
assert.equal(mergeUsageSnapshots(newResponse, fewerTeamsLaterTime).buckets['ai-single'].teamCount, 2,
  'A lower team count must never win solely because of a later timestamp')
const sameTeamsLaterTime = structuredClone(newResponse)
sameTeamsLaterTime.buckets['ai-single'].updatedAt = 3000
assert.equal(mergeUsageSnapshots(newResponse, sameTeamsLaterTime).buckets['ai-single'].updatedAt, 3000)
assert.equal(mergeUsageSnapshots(sameTeamsLaterTime, newResponse).buckets['ai-single'].updatedAt, 3000)

const aiLatest = structuredClone(newResponse)
aiLatest.buckets['ai-double'] = recordUsageTeams(createUsageBucket(), [[9]], 5000)
const rankedLatest = structuredClone(oldResponse)
rankedLatest.buckets['ranked-double'] = recordUsageTeams(createUsageBucket(), [[149], [94]], 4000)
const combined = mergeUsageSnapshots(aiLatest, rankedLatest)
assert.equal(combined.buckets['ai-single'].teamCount, 2)
assert.equal(combined.buckets['ai-double'].teamCount, 1)
assert.equal(combined.buckets['ranked-double'].teamCount, 2)
assert.equal(combined.buckets['ranked-single'].teamCount, 0)
assert.equal(combined.updatedAt, 5000)
assert.deepEqual(combined, mergeUsageSnapshots(rankedLatest, aiLatest),
  'Independent category updates must survive either response arrival order')
for (const invalid of [null, {}, { ...oldResponse, buckets: {} }, { ...oldResponse, buckets: { ...oldResponse.buckets, 'ranked-double': { ...createUsageBucket(), teamCount: 1 } } }]) {
  assert.throws(() => mergeUsageSnapshots(newResponse, invalid), TypeError)
  assert.throws(() => mergeUsageSnapshots(invalid, newResponse), TypeError)
}

const legacyBucket = deepFreeze({ teamCount: 2, counts: { 25: 2, 6: 1 }, previous: { teamCount: 0, counts: {} }, updatedAt: 100 })
assert.deepEqual(getPokemonItemUsage(legacyBucket, 25), { sampleCount: 0, noItemCount: 0, items: [] },
  'Historical species-only samples must not be mislabeled as unequipped Pokémon')
assert.deepEqual(canonicalUsageTeamEntry(25), { speciesId: 25 })
assert.deepEqual(canonicalUsageTeamEntry({ speciesId: 25, heldItemId: null }), { speciesId: 25, heldItemId: null })
const itemBefore = deepFreeze(recordUsageTeams(legacyBucket, [
  [{ speciesId: 25, heldItemId: 'light-ball' }, { speciesId: 6, heldItemId: 'life-orb' }],
  [{ speciesId: 25, heldItemId: 'focus-sash' }],
  [{ speciesId: 25, heldItemId: null }],
  [{ speciesId: 25, heldItemId: 'light-ball' }],
  [{ speciesId: 25, heldItemId: 'life-orb' }],
  [{ speciesId: 25, heldItemId: 'leftovers' }],
], 6000))
const pikachuItems = getPokemonItemUsage(itemBefore, 25)
assert.equal(itemBefore.counts[25], 8)
assert.equal(itemBefore.itemSamples[25], 6, 'Only six newly explicit item observations count toward item usage')
assert.deepEqual({ ...pikachuItems, items: pikachuItems.items.map(({ rate, ...item }) => item) }, {
  sampleCount: 6, noItemCount: 1,
  items: [
    { rank: 1, itemId: 'light-ball', count: 2 },
    { rank: 2, itemId: 'focus-sash', count: 1 },
    { rank: 3, itemId: 'leftovers', count: 1 },
  ],
})
close(pikachuItems.items[0].rate, 100 / 3)
close(pikachuItems.items[1].rate, 100 / 6)
close(pikachuItems.items[2].rate, 100 / 6)
assert.deepEqual(getUsageRanking(itemBefore).find(row => row.speciesId === 25).itemUsage, pikachuItems)
const allowedItems = getPokemonItemUsage(itemBefore, 25, { allowedItemIds: new Set(['life-orb', 'leftovers']) })
assert.deepEqual(allowedItems.items.map(item => item.itemId), ['leftovers', 'life-orb'])
close(allowedItems.items[0].rate, 100 / 6)
assert.equal(allowedItems.noItemCount, 1, 'Hidden/ineligible items must not be misrepresented as no item')
assert.equal(getPokemonItemUsage(itemBefore, 25, { limit: 10 }).items.length, 4)
assert.deepEqual(getPokemonItemUsage(itemBefore, 25, { limit: 0 }).items, [])
assert.deepEqual(getPokemonItemUsage(itemBefore, 25, { allowedItemIds: [] }).items, [])
assert.deepEqual(getPokemonItemUsage(itemBefore, 149), { sampleCount: 0, noItemCount: 0, items: [] })
const itemAfter = recordUsageTeams(itemBefore, [[{ speciesId: 25, heldItemId: 'focus-sash' }]], 7000)
assert.equal(itemAfter.itemSamples[25], 7)
assert.equal(itemBefore.itemSamples[25], 6)
assert.equal(itemBefore.itemCounts[25]['focus-sash'], 1, 'Nested item counts must not mutate the previous snapshot')
assert.deepEqual(getPokemonItemUsage(itemAfter, 25).items.map(item => item.itemId), ['focus-sash', 'light-ball', 'leftovers'],
  'The new observation must reorder tied items deterministically')
const itemForms = recordUsageTeams(createUsageBucket(), [[
  { speciesId: 6, heldItemId: 'life-orb' },
  { speciesId: charizardForms[0].id, heldItemId: 'charizardite-x' },
  { speciesId: charizardForms[1].id, heldItemId: null },
  6,
]], 7000)
assert.equal(itemForms.counts[6], 1, 'Canonical species must still be deduplicated per team')
assert.equal(itemForms.itemSamples[6], 3, 'Distinct selected individuals each supply one item observation')
assert.equal(getPokemonItemUsage(itemForms, charizardForms[0].id).noItemCount, 1)
close(getPokemonItemUsage(itemForms, 6).items[0].rate, 100 / 3)
const unknownExtension = recordUsageTeams(itemBefore, [[25, { speciesId: 25 }]], 7000)
assert.deepEqual(unknownExtension.itemSamples, itemBefore.itemSamples)
assert.deepEqual(unknownExtension.itemCounts, itemBefore.itemCounts)
for (const heldItemId of ['', 'not-an-item', '__proto__', undefined, 123, {}, []]) {
  assert.throws(() => recordUsageTeams(itemBefore, [[{ speciesId: 25, heldItemId }]], 7000), TypeError)
}
for (const limit of [-1, 1.5, '3', NaN, Infinity]) assert.throws(() => getPokemonItemUsage(itemBefore, 25, { limit }), TypeError)
for (const corrupt of [
  { ...legacyBucket, itemSamples: {} },
  { ...legacyBucket, itemCounts: {} },
  { ...itemBefore, itemSamples: null },
  { ...itemBefore, itemCounts: [] },
  { ...itemBefore, itemSamples: { ...itemBefore.itemSamples, 999999: 1 } },
  { ...itemBefore, itemSamples: { ...itemBefore.itemSamples, '025': 1 } },
  { ...itemBefore, itemSamples: { ...itemBefore.itemSamples, 149: 1 } },
  { ...itemBefore, itemSamples: { ...itemBefore.itemSamples, 25: 49 } },
  { ...itemBefore, itemSamples: { ...itemBefore.itemSamples, 25: -1 } },
  { ...itemBefore, itemSamples: { ...itemBefore.itemSamples, 25: 1.5 } },
  { ...itemBefore, itemCounts: { ...itemBefore.itemCounts, 149: {} } },
  { ...itemBefore, itemCounts: { ...itemBefore.itemCounts, 25: { 'not-an-item': 1 } } },
  { ...itemBefore, itemCounts: { ...itemBefore.itemCounts, 25: { 'light-ball': 7 } } },
  { ...itemBefore, itemCounts: { ...itemBefore.itemCounts, 25: { 'light-ball': -1 } } },
  { ...itemBefore, itemCounts: { ...itemBefore.itemCounts, 25: { 'light-ball': '1' } } },
  { ...createUsageBucket(), teamCount: 1, counts: { 25: 1, 6: 1 }, itemSamples: { 25: 6, 6: 6 } },
]) {
  assert.throws(() => getPokemonItemUsage(corrupt, 25), TypeError)
  assert.throws(() => getUsageRanking(corrupt), TypeError)
  assert.throws(() => recordUsageTeams(corrupt, [[25]], 8000), TypeError)
}
const itemSnapshot = createEmptyUsageSnapshot()
itemSnapshot.buckets['ai-single'] = itemBefore
itemSnapshot.buckets['ranked-double'] = recordUsageTeams(createUsageBucket(), Array.from({ length: 14 }, () => [{ speciesId: 25, heldItemId: 'focus-sash' }]), 7000)
const pooled = getCombinedPokemonItemUsage(itemSnapshot, 25)
assert.equal(pooled.sampleCount, 20)
assert.equal(pooled.items[0].itemId, 'focus-sash')
assert.equal(pooled.items[0].count, 15)
assert.equal(pooled.items[0].rate, 75, 'Combined recommendations must pool counts instead of averaging four category percentages')
assert.equal(pooled.noItemCount, 1)
assert.equal(getCombinedPokemonItemUsage(itemSnapshot, 25, { allowedItemIds: ['light-ball'] }).items[0].rate, 10)
assert.throws(() => getCombinedPokemonItemUsage({ buckets: {} }, 25), TypeError)

const itemSnapshotOld = createEmptyUsageSnapshot()
itemSnapshotOld.buckets['ai-single'] = structuredClone(itemBefore)
delete itemSnapshotOld.buckets['ai-single'].itemSamples
delete itemSnapshotOld.buckets['ai-single'].itemCounts
const itemSnapshotNew = structuredClone(itemSnapshotOld)
itemSnapshotNew.buckets['ai-single'] = structuredClone(itemBefore)
assert.deepEqual(mergeUsageSnapshots(itemSnapshotOld, itemSnapshotNew), mergeUsageSnapshots(itemSnapshotNew, itemSnapshotOld),
  'A legacy snapshot of the same event must not erase item fields in either arrival order')
const itemSnapshotLaterLegacy = structuredClone(itemSnapshotOld)
itemSnapshotLaterLegacy.buckets['ai-single'].teamCount += 1
itemSnapshotLaterLegacy.buckets['ai-single'].counts[25] += 1
itemSnapshotLaterLegacy.buckets['ai-single'].updatedAt += 1
for (const args of [[itemSnapshotLaterLegacy, itemSnapshotNew], [itemSnapshotNew, itemSnapshotLaterLegacy]]) {
  const mergedItems = mergeUsageSnapshots(...args).buckets['ai-single']
  assert.equal(mergedItems.teamCount, itemBefore.teamCount + 1)
  assert.deepEqual(mergedItems.itemSamples, itemBefore.itemSamples)
  assert.deepEqual(mergedItems.itemCounts, itemBefore.itemCounts)
}
const itemSnapshotLatest = structuredClone(itemSnapshotNew)
itemSnapshotLatest.buckets['ai-single'] = itemAfter
assert.deepEqual(mergeUsageSnapshots(itemSnapshotLatest, itemSnapshotNew).buckets['ai-single'].itemCounts, itemAfter.itemCounts,
  'A delayed old GET must not overwrite a newer item observation')
for (const bucket of Object.values(demo.buckets)) {
  assert.equal(Object.values(bucket.itemSamples).reduce((sum, count) => sum + count, 0), 298 * 6)
  const first = getUsageRanking(bucket)[0]
  assert.equal(first.itemUsage.items.length, 3)
  assert(first.itemUsage.noItemCount > 0)
  assert(first.itemUsage.items.every(item => item.rate > 0 && item.rate <= 100))
}

console.log('PASS Pokémon usage arithmetic, 100-place ranking, ties, deltas, forms, immutability, strict event/persistence validation, four isolated modes, deterministic demo data, out-of-order snapshot merging, actual equipped-item sampling, top-three item rates, weighted recommendations, and legacy compatibility')
