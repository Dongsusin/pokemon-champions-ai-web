import { NATIONAL_DEX } from '../../src/data/trainingData.js'
import { createEmptyUsageSnapshot, createUsageBucket, recordUsageTeams } from '../../src/data/pokemonUsage.js'

const DEMO_TIMESTAMP = Date.UTC(2026, 0, 1)

// Illustrative fixtures only. These weights are not real player statistics.
const DEMO_FEATURED_SPECIES = [
  6, 9, 25, 38, 59, 94, 130, 149, 197, 212, 248, 260, 282, 373, 376,
  445, 448, 460, 479, 497, 530, 547, 571, 598, 635, 637, 658, 663, 681,
  700, 706, 727, 778, 812, 815, 823, 858, 861, 887, 892, 901, 903, 908,
  911, 914, 925, 934, 936, 937, 945, 950, 964, 977, 978, 983, 987, 1000,
  1002, 1003, 1004, 1006, 1017, 1018, 1020, 1021,
]

const DEMO_ITEM_IDS = ['leftovers', 'life-orb', 'sitrus-berry', 'focus-sash', 'choice-scarf', 'assault-vest']

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

    const sampleOffsets = new Map()
    const withItems = teams => teams.map(team => team.map(speciesId => {
      const offset = sampleOffsets.get(speciesId) ?? 0
      sampleOffsets.set(speciesId, offset + 1)
      // A species-specific rotation gives frequent species three popular
      // items, plus a smaller explicit unequipped share. No real data implied.
      const cycle = [0, 0, 1, 0, 2, 1, 0, 2, 1, null, 0, 1][offset % 12]
      return { speciesId, heldItemId: cycle === null ? null : DEMO_ITEM_IDS[(speciesId + bucketIndex + cycle) % DEMO_ITEM_IDS.length] }
    }))
    const previous = recordUsageTeams(createUsageBucket(), withItems(historicalTeams), DEMO_TIMESTAMP - 60_000)
    const recentTeams = Array.from({ length: 32 }, (_, teamIndex) => (
      Array.from({ length: 6 }, (_, slot) => species[(teamIndex * (slot + 1) + slot * 23 + bucketIndex * 7) % (slot < 3 ? 18 : species.length)])
    ))
    snapshot.buckets[key] = recordUsageTeams(previous, withItems(recentTeams), DEMO_TIMESTAMP)
  })

  return snapshot
}
