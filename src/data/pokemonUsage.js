import { NATIONAL_DEX, getSpeciesProfile } from './trainingData.js'
import { getBattleItem } from './shopData.js'

export const USAGE_MODES = Object.freeze([
  Object.freeze({ id: 'ai', label: 'AI 대전' }),
  Object.freeze({ id: 'ranked', label: '레이팅 배틀' }),
])

export const USAGE_FORMATS = Object.freeze([
  Object.freeze({ id: 'single', label: '싱글배틀' }),
  Object.freeze({ id: 'double', label: '더블배틀' }),
])

const NATIONAL_SPECIES_IDS = new Set(NATIONAL_DEX.map(({ id }) => id))

export function usageBucketKey(mode, format) {
  if (!USAGE_MODES.some(({ id }) => id === mode) || !USAGE_FORMATS.some(({ id }) => id === format)) {
    throw new TypeError('Unknown Pokémon usage mode or format')
  }
  return `${mode}-${format}`
}

export function createUsageBucket() {
  return { teamCount: 0, counts: {}, itemSamples: {}, itemCounts: {}, previous: { teamCount: 0, counts: {} }, updatedAt: 0 }
}

/** Resolve trusted profile ancestry, never a team entry's claimed parent ID. */
export function canonicalUsageSpeciesId(value) {
  let speciesId = value && typeof value === 'object' && !Array.isArray(value) ? value.speciesId : value
  const visited = new Set()

  while (Number.isSafeInteger(speciesId) && speciesId > 0 && !visited.has(speciesId)) {
    visited.add(speciesId)
    const profile = getSpeciesProfile(speciesId)
    if (!profile) break
    if (profile.parentSpeciesId == null) {
      if (NATIONAL_SPECIES_IDS.has(speciesId)) return speciesId
      break
    }
    speciesId = profile.parentSpeciesId
  }

  throw new TypeError('Usage teams must contain known numeric Pokémon species IDs')
}

function assertNonnegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`Invalid usage ${label}`)
}

function assertCountSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new TypeError('Invalid usage count snapshot')
  }
  assertNonnegativeInteger(snapshot.teamCount, 'team count')
  if (!snapshot.counts || typeof snapshot.counts !== 'object' || Array.isArray(snapshot.counts)) {
    throw new TypeError('Invalid usage species counts')
  }

  let total = 0
  for (const [key, count] of Object.entries(snapshot.counts)) {
    const speciesId = Number(key)
    if (String(speciesId) !== key || !NATIONAL_SPECIES_IDS.has(speciesId)) {
      throw new TypeError('Usage counts must use canonical National Dex species IDs')
    }
    assertNonnegativeInteger(count, 'species count')
    if (count > snapshot.teamCount) throw new TypeError('Usage species count exceeds its team count')
    total += count
  }
  if (!Number.isSafeInteger(total) || total < snapshot.teamCount || total > snapshot.teamCount * 6) {
    throw new TypeError('Usage species totals do not match one to six Pokémon per team')
  }
}

function assertItemSnapshot(bucket) {
  // Records made before item collection began contain no item information.
  // They are unknown samples, never inferred to have no held item.
  if (bucket.itemSamples === undefined && bucket.itemCounts === undefined) return
  for (const value of [bucket.itemSamples, bucket.itemCounts]) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid usage item counters')
  }
  let totalSamples = 0
  for (const [speciesId, sampleCount] of Object.entries(bucket.itemSamples)) {
    if (String(Number(speciesId)) !== speciesId || !NATIONAL_SPECIES_IDS.has(Number(speciesId))) {
      throw new TypeError('Usage item samples must use canonical National Dex species IDs')
    }
    assertNonnegativeInteger(sampleCount, 'item sample count')
    if (sampleCount > (bucket.counts[speciesId] ?? 0) * 6) throw new TypeError('Usage item samples exceed selected species occurrences')
    totalSamples += sampleCount
  }
  if (!Number.isSafeInteger(totalSamples) || totalSamples > bucket.teamCount * 6) throw new TypeError('Usage item samples exceed selected Pokémon')
  for (const [speciesId, counts] of Object.entries(bucket.itemCounts)) {
    if (!Object.hasOwn(bucket.itemSamples, speciesId) || !counts || typeof counts !== 'object' || Array.isArray(counts)) {
      throw new TypeError('Invalid usage species item counts')
    }
    let total = 0
    for (const [itemId, count] of Object.entries(counts)) {
      if (!getBattleItem(itemId)) throw new TypeError('Usage item counts must contain known battle items')
      assertNonnegativeInteger(count, 'item count')
      total += count
    }
    if (!Number.isSafeInteger(total) || total > bucket.itemSamples[speciesId]) throw new TypeError('Usage item counts exceed known item samples')
  }
}

export function assertUsageBucket(bucket) {
  assertCountSnapshot(bucket)
  assertItemSnapshot(bucket)
  assertCountSnapshot(bucket.previous)
  assertNonnegativeInteger(bucket.updatedAt, 'timestamp')
  if (bucket.previous.teamCount > bucket.teamCount) {
    throw new TypeError('Previous usage team count exceeds the current count')
  }
  for (const [speciesId, count] of Object.entries(bucket.previous.counts)) {
    if (count > (bucket.counts[speciesId] ?? 0)) {
      throw new TypeError('Previous usage species count exceeds the current count')
    }
  }
}

export function canonicalUsageTeamEntry(value) {
  const speciesId = canonicalUsageSpeciesId(value)
  if (value && typeof value === 'object' && Object.hasOwn(value, 'heldItemId')) {
    const heldItemId = value.heldItemId
    if (heldItemId !== null && (typeof heldItemId !== 'string' || !getBattleItem(heldItemId))) {
      throw new TypeError('Usage teams must contain a known battle item or explicit null')
    }
    return { speciesId, heldItemId }
  }
  return { speciesId }
}

/**
 * Count selected human teams as one atomic event. A species counts at most once
 * per team, including when multiple forms of that species were selected.
 * Event identity and replay protection belong to the persistence layer.
 */
export function recordUsageTeams(bucket, teams, timestamp = Date.now()) {
  assertUsageBucket(bucket)
  assertNonnegativeInteger(timestamp, 'timestamp')
  if (!Array.isArray(teams) || teams.length === 0) {
    throw new TypeError('Usage events must contain at least one team')
  }

  // Validate the complete event before changing any counters.
  const canonicalTeams = Array.from(teams, (team) => {
    if (!Array.isArray(team) || team.length < 1 || team.length > 6) {
      throw new TypeError('Usage teams must contain one to six Pokémon')
    }
    return Array.from(team, canonicalUsageTeamEntry)
  })
  const teamCount = bucket.teamCount + canonicalTeams.length
  assertNonnegativeInteger(teamCount, 'team count')
  const counts = { ...bucket.counts }
  const itemSamples = { ...bucket.itemSamples }
  const itemCounts = Object.fromEntries(Object.entries(bucket.itemCounts ?? {}).map(([speciesId, items]) => [speciesId, { ...items }]))
  for (const team of canonicalTeams) {
    for (const speciesId of new Set(team.map(entry => entry.speciesId))) counts[speciesId] = (counts[speciesId] ?? 0) + 1
    // Unlike species/team usage, every selected individual supplies an item
    // sample. Two forms of the same species can carry different items.
    for (const entry of team) {
      if (!Object.hasOwn(entry, 'heldItemId')) continue
      const { speciesId, heldItemId } = entry
      itemSamples[speciesId] = (itemSamples[speciesId] ?? 0) + 1
      if (heldItemId !== null) {
        const items = itemCounts[speciesId] ??= {}
        items[heldItemId] = (items[heldItemId] ?? 0) + 1
      }
    }
  }

  const result = {
    teamCount,
    counts,
    itemSamples,
    itemCounts,
    previous: { teamCount: bucket.teamCount, counts: { ...bucket.counts } },
    updatedAt: timestamp,
  }
  assertUsageBucket(result)
  return result
}

function orderedSpecies(counts) {
  return [...NATIONAL_DEX].sort((left, right) => (
    (counts[right.id] ?? 0) - (counts[left.id] ?? 0) || left.id - right.id
  ))
}

function usageRate(count, teamCount) {
  return teamCount > 0 ? count / teamCount * 100 : 0
}

function itemUsageResult(sampleCount, counts, { limit = 3, allowedItemIds } = {}) {
  if (!Number.isSafeInteger(limit) || limit < 0) throw new TypeError('Invalid item usage limit')
  const allowed = allowedItemIds === undefined ? null : new Set(allowedItemIds)
  const allCounts = Object.values(counts).reduce((sum, count) => sum + count, 0)
  return {
    sampleCount,
    noItemCount: sampleCount - allCounts,
    items: Object.entries(counts).filter(([itemId, count]) => count > 0 && (!allowed || allowed.has(itemId)))
      .sort(([leftId, left], [rightId, right]) => right - left || (leftId < rightId ? -1 : leftId > rightId ? 1 : 0))
      .slice(0, limit).map(([itemId, count], index) => ({ rank: index + 1, itemId, count, rate: usageRate(count, sampleCount) })),
  }
}

/** Item rates use only explicitly recorded individuals, including no-item. */
export function getPokemonItemUsage(bucket, speciesId, options) {
  assertUsageBucket(bucket)
  const canonicalId = canonicalUsageSpeciesId(speciesId)
  return itemUsageResult(bucket.itemSamples?.[canonicalId] ?? 0, bucket.itemCounts?.[canonicalId] ?? {}, options)
}

/** Pool the four categories by observed individual counts, not rate averages. */
export function getCombinedPokemonItemUsage(snapshot, speciesId, options) {
  const canonicalId = canonicalUsageSpeciesId(speciesId)
  let sampleCount = 0
  const counts = {}
  for (const key of Object.keys(createEmptyUsageSnapshot().buckets)) {
    const bucket = snapshot?.buckets?.[key]
    assertUsageBucket(bucket)
    sampleCount += bucket.itemSamples?.[canonicalId] ?? 0
    for (const [itemId, count] of Object.entries(bucket.itemCounts?.[canonicalId] ?? {})) counts[itemId] = (counts[itemId] ?? 0) + count
  }
  assertNonnegativeInteger(sampleCount, 'combined item sample count')
  return itemUsageResult(sampleCount, counts, options)
}

export function getUsageRanking(bucket) {
  assertUsageBucket(bucket)
  const previousRanks = new Map(orderedSpecies(bucket.previous.counts).map(({ id }, index) => [id, index + 1]))

  return orderedSpecies(bucket.counts).slice(0, 100).map((profile, index) => {
    const count = bucket.counts[profile.id] ?? 0
    const previousCount = bucket.previous.counts[profile.id] ?? 0
    const rank = index + 1
    const rate = usageRate(count, bucket.teamCount)

    return {
      rank,
      speciesId: profile.id,
      name: profile.name,
      types: [...profile.types],
      sprite: profile.spriteFrontFallback,
      count,
      rate,
      rankDelta: previousRanks.get(profile.id) - rank,
      rateDelta: rate - usageRate(previousCount, bucket.previous.teamCount),
      isNew: count > 0 && previousCount === 0,
      itemUsage: itemUsageResult(bucket.itemSamples?.[profile.id] ?? 0, bucket.itemCounts?.[profile.id] ?? {}),
    }
  })
}

export function createEmptyUsageSnapshot() {
  return {
    source: 'live',
    buckets: Object.fromEntries(USAGE_MODES.flatMap(({ id: mode }) => (
      USAGE_FORMATS.map(({ id: format }) => [usageBucketKey(mode, format), createUsageBucket()])
    ))),
    updatedAt: 0,
  }
}

/** Keep each cumulative category current when GET and report responses race. */
export function mergeUsageSnapshots(current, incoming) {
  const keys = Object.keys(createEmptyUsageSnapshot().buckets)
  for (const key of keys) {
    assertUsageBucket(current?.buckets?.[key])
    assertUsageBucket(incoming?.buckets?.[key])
  }
  const buckets = Object.fromEntries(keys.map(key => {
    const previous = current.buckets[key]
    const next = incoming.buckets[key]
    const newer = next.teamCount > previous.teamCount
      || (next.teamCount === previous.teamCount && next.updatedAt > previous.updatedAt)
    const selected = structuredClone(newer ? next : previous)
    // Keep the monotonic item counters when an older server/response shape
    // still lacks them. Item history is never reconstructed from species use.
    const samples = bucket => Object.values(bucket.itemSamples ?? {}).reduce((sum, count) => sum + count, 0)
    const richer = samples(next) > samples(previous) ? next : previous
    if (samples(richer) > samples(selected)
      || (selected.itemSamples === undefined && (next.itemSamples !== undefined || previous.itemSamples !== undefined))) {
      const source = richer.itemSamples !== undefined ? richer : next.itemSamples !== undefined ? next : previous
      selected.itemSamples = structuredClone(source.itemSamples)
      selected.itemCounts = structuredClone(source.itemCounts)
    }
    assertUsageBucket(selected)
    return [key, selected]
  }))
  return {
    source: incoming.source,
    buckets,
    updatedAt: Math.max(...Object.values(buckets).map(bucket => bucket.updatedAt)),
  }
}
