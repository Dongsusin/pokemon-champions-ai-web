// Arena's test ladder. Tier names follow Pokémon; these points are our rules,
// not an assertion about the official game's unpublished matchmaking formula.
export const RANKED_FORMATS = Object.freeze([
  Object.freeze({ id: 'single', label: '싱글배틀', battleSize: 3, registeredSize: 6, activeSlots: 1 }),
  Object.freeze({ id: 'double', label: '더블배틀', battleSize: 4, registeredSize: 6, activeSlots: 2 }),
])

export const RANKED_TIERS = Object.freeze([
  Object.freeze({ id: 'pokeball', name: '몬스터볼', minPoints: 0, color: '#fb727e' }),
  Object.freeze({ id: 'greatball', name: '슈퍼볼', minPoints: 400, color: '#6cb9ff' }),
  Object.freeze({ id: 'ultraball', name: '하이퍼볼', minPoints: 800, color: '#ffe277' }),
  Object.freeze({ id: 'masterball', name: '마스터볼', minPoints: 1200, color: '#c99aff' }),
])

export function getRankedFormat(id) {
  return RANKED_FORMATS.find(format => format.id === id) ?? null
}

const integer = (value, fallback = 0, minimum = 0) => (
  Number.isSafeInteger(value) && value >= minimum ? value : fallback
)

export function createRankedProfile(format = 'single') {
  if (!getRankedFormat(format)) throw new Error('지원하지 않는 레이팅 배틀 형식입니다.')
  return { format, points: 0, rating: 1000, wins: 0, losses: 0, draws: 0, played: 0, streak: 0 }
}

export function normalizeRankedProfile(profile, format = profile?.format ?? 'single') {
  const initial = createRankedProfile(format)
  return { ...initial, ...Object.fromEntries(
    ['points', 'rating', 'wins', 'losses', 'draws', 'played', 'streak']
      .map(key => [key, integer(profile?.[key], initial[key])]),
  ) }
}

export function getRankedTier(points = 0) {
  const safePoints = integer(points)
  const tier = [...RANKED_TIERS].reverse().find(entry => safePoints >= entry.minPoints)
  const master = tier.id === 'masterball'
  const divisionIndex = master ? 0 : Math.min(3, Math.floor((safePoints - tier.minPoints) / 100))
  const division = master ? null : ['IV', 'III', 'II', 'I'][divisionIndex]
  const minPoints = tier.minPoints + divisionIndex * 100
  const nextPoints = master ? null : minPoints + 100
  return {
    ...tier,
    label: `${tier.name}${division ? ` ${division}` : ''}`,
    division, minPoints, nextPoints,
    progress: master ? 1 : (safePoints - minPoints) / 100,
  }
}

export function settleRankedRatings(profileA, profileB, resultA) {
  if (!['win', 'loss', 'draw'].includes(resultA)) throw new Error('확정된 배틀 결과가 필요합니다.')
  const a = normalizeRankedProfile(profileA)
  const b = normalizeRankedProfile(profileB)
  if (a.format !== b.format) throw new Error('같은 배틀 형식의 레이팅만 정산할 수 있습니다.')
  const scoreA = resultA === 'win' ? 1 : resultA === 'loss' ? 0 : 0.5
  const expectedA = 1 / (1 + 10 ** ((b.rating - a.rating) / 400))
  const ratingDelta = Math.round(32 * (scoreA - expectedA))
  const change = (profile, result, delta) => ({
    ...profile,
    points: Math.max(0, profile.points + (result === 'win' ? 30 : result === 'loss' ? -15 : 0)),
    rating: Math.max(0, profile.rating + delta),
    wins: profile.wins + Number(result === 'win'),
    losses: profile.losses + Number(result === 'loss'),
    draws: profile.draws + Number(result === 'draw'),
    played: profile.played + 1,
    streak: result === 'win' ? profile.streak + 1 : 0,
  })
  const nextA = change(a, resultA, ratingDelta)
  const nextB = change(b, resultA === 'win' ? 'loss' : resultA === 'loss' ? 'win' : 'draw', -ratingDelta)
  return {
    a: nextA, b: nextB,
    changes: {
      a: { points: nextA.points - a.points, rating: nextA.rating - a.rating },
      b: { points: nextB.points - b.points, rating: nextB.rating - b.rating },
    },
  }
}
