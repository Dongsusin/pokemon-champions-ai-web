import { NATIONAL_DEX, getSpeciesProfile } from './trainingData.js'

export const USAGE_MODES = Object.freeze([
  Object.freeze({ id: 'ai', label: 'AI 대전' }),
  Object.freeze({ id: 'ranked', label: '레이팅 배틀' }),
])

export const USAGE_FORMATS = Object.freeze([
  Object.freeze({ id: 'single', label: '싱글배틀' }),
  Object.freeze({ id: 'double', label: '더블배틀' }),
])

const NATIONAL_SPECIES_IDS = new Set(NATIONAL_DEX.map(({ id }) => id))
const DEMO_TIMESTAMP = Date.UTC(2026, 0, 1)

export function usageBucketKey(mode, format) {
  if (!USAGE_MODES.some(({ id }) => id === mode) || !USAGE_FORMATS.some(({ id }) => id === format)) {
    throw new TypeError('Unknown Pokémon usage mode or format')
  }
  return `${mode}-${format}`
}

export function createUsageBucket() {
  return { teamCount: 0, counts: {}, previous: { teamCount: 0, counts: {} }, updatedAt: 0 }
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

export function assertUsageBucket(bucket) {
  assertCountSnapshot(bucket)
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
    return new Set(Array.from(team, canonicalUsageSpeciesId))
  })
  const teamCount = bucket.teamCount + canonicalTeams.length
  assertNonnegativeInteger(teamCount, 'team count')
  const counts = { ...bucket.counts }
  for (const team of canonicalTeams) {
    for (const speciesId of team) counts[speciesId] = (counts[speciesId] ?? 0) + 1
  }

  return {
    teamCount,
    counts,
    previous: { teamCount: bucket.teamCount, counts: { ...bucket.counts } },
    updatedAt: timestamp,
  }
}

function orderedSpecies(counts) {
  return [...NATIONAL_DEX].sort((left, right) => (
    (counts[right.id] ?? 0) - (counts[left.id] ?? 0) || left.id - right.id
  ))
}

function usageRate(count, teamCount) {
  return teamCount > 0 ? count / teamCount * 100 : 0
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
    return [key, structuredClone(newer ? next : previous)]
  }))
  return {
    source: incoming.source,
    buckets,
    updatedAt: Math.max(...Object.values(buckets).map(bucket => bucket.updatedAt)),
  }
}

// Illustrative fixtures only. These weights are not real player statistics.
const DEMO_FEATURED_SPECIES = [
  6, 9, 25, 38, 59, 94, 130, 149, 197, 212, 248, 260, 282, 373, 376,
  445, 448, 460, 479, 497, 530, 547, 571, 598, 635, 637, 658, 663, 681,
  700, 706, 727, 778, 812, 815, 823, 858, 861, 887, 892, 901, 903, 908,
  911, 914, 925, 934, 936, 937, 945, 950, 964, 977, 978, 983, 987, 1000,
  1002, 1003, 1004, 1006, 1017, 1018, 1020, 1021,
]

/** Explicit opt-in demo fixture, independent of the clock and live snapshots. */
export function createDemoUsageSnapshot() {
  const snapshot = createEmptyUsageSnapshot()
  snapshot.source = 'demo'
  snapshot.updatedAt = DEMO_TIMESTAMP

  Object.keys(snapshot.buckets).forEach((key, bucketIndex) => {
    const featured = DEMO_FEATURED_SPECIES.map((_, index, entries) => (
      entries[(index + bucketIndex * 13) % entries.length]
    ))
    const varied = NATIONAL_DEX.map((_, index, entries) => (
      entries[(index * 37 + bucketIndex * 97) % entries.length].id
    ))
    const species = [...new Set([...featured, ...varied])].slice(0, 156)
    const historicalTeams = []

    // Guarantee a positive sample for over 100 distinct species in every tab.
    for (let index = 0; index < species.length; index += 6) {
      historicalTeams.push(species.slice(index, index + 6))
    }
    for (let teamIndex = 0; teamIndex < 240; teamIndex += 1) {
      historicalTeams.push(Array.from({ length: 6 }, (_, slot) => {
        const poolSize = slot < 3 ? 12 + bucketIndex * 3 : species.length
        return species[(teamIndex * (slot + 3) + slot * 17 + bucketIndex * 11) % poolSize]
      }))
    }

    const previous = recordUsageTeams(createUsageBucket(), historicalTeams, DEMO_TIMESTAMP - 60_000)
    const recentTeams = Array.from({ length: 32 }, (_, teamIndex) => (
      Array.from({ length: 6 }, (_, slot) => species[(teamIndex * (slot + 1) + slot * 23 + bucketIndex * 7) % (slot < 3 ? 18 : species.length)])
    ))
    snapshot.buckets[key] = recordUsageTeams(previous, recentTeams, DEMO_TIMESTAMP)
  })

  return snapshot
}
