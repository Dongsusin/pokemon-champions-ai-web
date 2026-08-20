import {
  POKEMON_POOL,
  createPokemonDraw,
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

let seed = 20260820
const seededRandom = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 4294967296
}
const sampledDraws = createPokemonDraw(1000, [], seededRandom)

if (sampledDraws.some((pokemon) => !poolIds.has(pokemon.id) || !isFinalEvolutionSpecies(pokemon.id))) {
  failures.push('실제 뽑기 결과에 최종 진화형이 아닌 포켓몬이 포함됨')
}

if (failures.length > 0) {
  console.error(failures.slice(0, 30).join('\n'))
  if (failures.length > 30) console.error(`외 ${failures.length - 30}건`)
  process.exitCode = 1
} else {
  process.stdout.write(`Validated ${POKEMON_POOL.length} final-evolution draw candidates.\n`)
}
