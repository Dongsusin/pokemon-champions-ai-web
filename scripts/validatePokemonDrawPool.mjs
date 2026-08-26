import {
  BASE_SHINY_ODDS,
  DRAW_BANNERS,
  DRAW_RARITY_ORDER,
  DRAW_RARITY_POOLS,
  LEGENDARY_MYTHICAL_POOL,
  PICKUP_ROTATION_MS,
  POKEMON_POOL,
  RARITY_META,
  createPokemonDraw,
  getCurrentLegendaryPickup,
  getPokemonRarity,
  getShinyOdds,
  isFinalEvolutionSpecies,
} from '../src/data/pokemonPool.js'
import {
  NATIONAL_DEX,
  getEvolutionSpeciesIds,
} from '../src/data/trainingData.js'

const failures = []
const poolIds = new Set(POKEMON_POOL.map((pokemon) => pokemon.id))
const evolutionParentIds = new Set(
  NATIONAL_DEX
    .map((pokemon) => pokemon.evolvesFrom)
    .filter((speciesId) => Number.isInteger(speciesId) && speciesId > 0),
)
const expectedFinalIds = new Set(
  NATIONAL_DEX
    .filter((pokemon) => !evolutionParentIds.has(pokemon.id))
    .map((pokemon) => pokemon.id),
)

if (poolIds.size !== POKEMON_POOL.length) {
  failures.push('뽑기 후보에 중복된 포켓몬이 있음')
}

const rarityRateTotal = DRAW_RARITY_ORDER.reduce(
  (total, rarity) => total + RARITY_META[rarity].rate,
  0,
)

if (Math.abs(rarityRateTotal - 1) > Number.EPSILON * 10) {
  failures.push(`등급별 확률 합계가 100%가 아님: ${rarityRateTotal}`)
}

if (RARITY_META.legend.rate !== 0.01) {
  failures.push('전설·환상 EX 등급의 총 확률이 1%가 아님')
}

if (!(
  DRAW_BANNERS.standard.price < DRAW_BANNERS.pickup.price
  && DRAW_BANNERS.pickup.price < DRAW_BANNERS.shiny.price
)) {
  failures.push('뽑기 가격이 일반 < 픽업 < 이로치 순서가 아님')
}

if (getShinyOdds(0) !== BASE_SHINY_ODDS || getShinyOdds(9999) !== BASE_SHINY_ODDS) {
  failures.push('일반·픽업 뽑기의 이로치 확률에 기존 중복 보정이 남아 있음')
}

for (const pokemon of POKEMON_POOL) {
  if (pokemon.rarity !== getPokemonRarity(pokemon)) {
    failures.push(`${pokemon.name}(${pokemon.id}): 종족값 등급 판정 불일치`)
  }

  const isSpecial = pokemon.isLegendary || pokemon.isMythical
  if (isSpecial !== (pokemon.rarity === 'legend')) {
    failures.push(`${pokemon.name}(${pokemon.id}): 전설·환상 EX 등급 분리 실패`)
  }
}

for (const rarity of DRAW_RARITY_ORDER) {
  if (DRAW_RARITY_POOLS[rarity].length === 0) {
    failures.push(`${rarity} 등급 뽑기 풀이 비어 있음`)
  }
}

for (const pokemon of NATIONAL_DEX) {
  const shouldAppear = expectedFinalIds.has(pokemon.id)
  const appears = poolIds.has(pokemon.id)

  if (shouldAppear !== appears || appears !== isFinalEvolutionSpecies(pokemon.id)) {
    failures.push(`${pokemon.name}(${pokemon.id}): 최종 진화형 판정 불일치`)
  }
}

const branchingRoutes = [
  { rootId: 133, expectedFinalIds: [134, 135, 136, 196, 197, 470, 471, 700] },
  { rootId: 236, expectedFinalIds: [106, 107, 237] },
  { rootId: 265, expectedFinalIds: [267, 269] },
  { rootId: 290, expectedFinalIds: [291, 292] },
  { rootId: 840, expectedFinalIds: [841, 842, 1019] },
]

for (const route of branchingRoutes) {
  const actualFinalIds = getEvolutionSpeciesIds(route.rootId)
    .filter((speciesId) => poolIds.has(speciesId))
    .sort((left, right) => left - right)
  const expectedIds = route.expectedFinalIds.slice().sort((left, right) => left - right)

  if (actualFinalIds.join(',') !== expectedIds.join(',')) {
    failures.push(`${route.rootId}번 진화 계통: 분기 최종 진화형 누락`)
  }
}

function createSeededRandom(initialSeed) {
  let seed = initialSeed
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 4294967296
  }
}

function sequenceRandom(sequence) {
  let index = 0
  return () => sequence[Math.min(index++, sequence.length - 1)]
}

const sampledDraws = createPokemonDraw(1000, [], createSeededRandom(20260820))

if (sampledDraws.some((pokemon) => !poolIds.has(pokemon.id) || !isFinalEvolutionSpecies(pokemon.id))) {
  failures.push('실제 뽑기 결과에 최종 진화형이 아닌 포켓몬이 포함됨')
}

const rarityBoundaryCases = [
  ['common', 0.1],
  ['rare', 0.6],
  ['elite', 0.9],
  ['champion', 0.98],
  ['legend', 0.9995],
]

for (const [expectedRarity, rarityRoll] of rarityBoundaryCases) {
  const [result] = createPokemonDraw(
    1,
    [],
    sequenceRandom([rarityRoll, 0.25, 0.5, 0.5]),
    { bannerId: 'standard', now: 0 },
  )
  if (result.rarity !== expectedRarity) {
    failures.push(`${expectedRarity} 등급 확률 경계에서 ${result.rarity} 등장`)
  }
}

const pickupAtHourZero = getCurrentLegendaryPickup(0)
const pickupWithinSameHour = getCurrentLegendaryPickup(PICKUP_ROTATION_MS - 1)
const pickupAtNextHour = getCurrentLegendaryPickup(PICKUP_ROTATION_MS)

if (pickupAtHourZero.id !== pickupWithinSameHour.id || pickupAtHourZero.id === pickupAtNextHour.id) {
  failures.push('전설·환상 픽업이 1시간 단위로 교체되지 않음')
}

const [forcedPickup] = createPokemonDraw(
  1,
  [],
  sequenceRandom([0.9995, 0.8, 0.5, 0.5]),
  { bannerId: 'pickup', now: 0 },
)

if (forcedPickup.id !== pickupAtHourZero.id || !LEGENDARY_MYTHICAL_POOL.some((pokemon) => pokemon.id === forcedPickup.id)) {
  failures.push('픽업 배너 EX 당첨이 현재 픽업 전설·환상으로 고정되지 않음')
}

const [standardShiny] = createPokemonDraw(
  1,
  [],
  sequenceRandom([0.1, 0.2, 0, 0.5]),
  { bannerId: 'standard', now: 0 },
)

if (!standardShiny.isShiny) {
  failures.push('일반 뽑기에서 기본 확률의 이로치가 등장할 수 없음')
}

const shinyDraws = createPokemonDraw(
  100,
  [],
  createSeededRandom(20260823),
  { bannerId: 'shiny', now: 0 },
)

if (shinyDraws.some((pokemon) => !pokemon.isShiny || pokemon.shinyChance !== 1)) {
  failures.push('이로치 뽑기에서 일반색 포켓몬이 등장함')
}

if (failures.length > 0) {
  console.error(failures.slice(0, 30).join('\n'))
  if (failures.length > 30) console.error(`외 ${failures.length - 30}건`)
  process.exitCode = 1
} else {
  process.stdout.write(
    `Validated ${POKEMON_POOL.length} final-evolution candidates, ${LEGENDARY_MYTHICAL_POOL.length} EX pickups, and 3 draw banners.\n`,
  )
}
