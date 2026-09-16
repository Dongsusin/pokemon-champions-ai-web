import assert from 'node:assert/strict'
import {
  BASE_SHINY_ODDS,
  DRAW_BANNERS,
  DRAW_RARITY_ORDER,
  DRAW_RARITY_POOLS,
  LEGENDARY_MYTHICAL_POOL,
  PICKUP_ROTATION_MS,
  POKEMON_POOL,
  RARITY_META,
  STANDARD_DRAW_NEW_SPECIES_GUARANTEE,
  DUPLICATE_DRAW_REFUND_VP,
  createPokemonDraw,
  mergePokemonDraws,
  migratePokemonCollection,
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
const expectedSpeciesIds = new Set(NATIONAL_DEX.map((pokemon) => pokemon.id))

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

if (POKEMON_POOL.length !== NATIONAL_DEX.length || poolIds.size !== expectedSpeciesIds.size) {
  failures.push(`전국도감 전체가 뽑기 후보에 포함되지 않음: ${POKEMON_POOL.length}/${NATIONAL_DEX.length}`)
}

if (!LEGENDARY_MYTHICAL_POOL.some((pokemon) => pokemon.id === 792)) {
  failures.push('루나아라(도감 792번)가 전설·환상 EX 뽑기 풀에서 누락됨')
}

for (const pokemon of NATIONAL_DEX) {
  if (expectedSpeciesIds.has(pokemon.id) !== poolIds.has(pokemon.id)) {
    failures.push(`${pokemon.name}(${pokemon.id}): 전국도감 뽑기 후보 누락`)
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
  const missingIds = route.expectedFinalIds.filter((speciesId) => !poolIds.has(speciesId))
  if (missingIds.length > 0) {
    failures.push(`${route.rootId}번 진화 계통: 분기 진화형 누락 (${missingIds.join(',')})`)
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

if (sampledDraws.some((pokemon) => !poolIds.has(pokemon.id))) {
  failures.push('실제 뽑기 결과에 전국도감에 없는 포켓몬이 포함됨')
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

let guaranteeChecks = 0
function checkGuarantee(name, run) {
  try { run(); guaranteeChecks += 1 }
  catch (error) { failures.push(`${name}: ${error.message}`) }
}
const collectionOf = ids => ids.map(id => ({ speciesId: id, dexSpeciesId: id, directDrawCount: 1 }))
const draw = (collection, random = () => 0.5, options = {}) => createPokemonDraw(10, collection, random, { now: 0, ...options })
function assertMinimumNew(collection, results, expected = 3) {
  // Every collection entry counts as owned, evolution-route placeholders
  // included, so a pre-evolution of an owned species is never "new".
  const before = new Set(migratePokemonCollection(collection).map(pokemon => pokemon.dexSpeciesId))
  const missing = POKEMON_POOL.filter(pokemon => !before.has(pokemon.id)).length
  const newIds = new Set(results.filter(pokemon => !before.has(pokemon.id)).map(pokemon => pokemon.id))
  assert(newIds.size >= Math.min(expected, missing), `${newIds.size} new species; expected ${Math.min(expected, missing)}`)
  const merged = mergePokemonDraws(collection, results)
  assert.equal(merged.results.filter(result => !result.isDuplicate).length, newIds.size)
  assert.equal(merged.duplicateRefundVp, (results.length - newIds.size) * DUPLICATE_DRAW_REFUND_VP)
  return merged
}

checkGuarantee('empty account gets three distinct species even when every random roll repeats', () => {
  const collection = []
  const results = draw(collection, () => 0)
  assert.equal(results.length, 10)
  assert.equal(STANDARD_DRAW_NEW_SPECIES_GUARANTEE, 3)
  assert.deepEqual(collection, [])
  assert.equal(new Set(results.map(pokemon => pokemon.id)).size, 3)
  assertMinimumNew(collection, results)
})
checkGuarantee('partial collections retain ten draws, original ownership and correct NEW/refund results across seeds', () => {
  const collection = collectionOf(POKEMON_POOL.filter((_, index) => index % 2 === 0).map(pokemon => pokemon.id))
  const original = JSON.stringify(collection)
  for (let seed = 1; seed <= 40; seed += 1) {
    const results = draw(collection, createSeededRandom(seed))
    assert.equal(results.length, 10)
    assert(results.every(pokemon => poolIds.has(pokemon.id) && pokemon.shinyChance === 1 / BASE_SHINY_ODDS))
    assertMinimumNew(collection, results)
  }
  assert.equal(JSON.stringify(collection), original)
})
checkGuarantee('owning a final evolution owns its pre-evolutions, which then refund as duplicates', () => {
  const finalEvolutionIds = NATIONAL_DEX
    .filter(pokemon => isFinalEvolutionSpecies(pokemon.id))
    .map(pokemon => pokemon.id)
  const collection = collectionOf(finalEvolutionIds)
  const preEvolutionIds = migratePokemonCollection(collection)
    .map(pokemon => pokemon.dexSpeciesId)
    .filter(id => !finalEvolutionIds.includes(id))
  assert(preEvolutionIds.length > 0, 'migration should materialize pre-evolution placeholders')
  // 한카리아스를 보유하면 딥상어동도 보유로 본다: 하위 진화형을 따로 뽑을 수는 없고,
  // 대신 뽑혔을 때 중복으로 VP를 돌려준다.
  const merged = mergePokemonDraws(collection, preEvolutionIds.slice(0, 3).map(id => ({ id, isShiny: false })))
  assert(merged.results.every(result => result.isDuplicate), 'pre-evolutions of owned species must count as duplicates')
  assert.equal(merged.duplicateRefundVp, merged.results.length * DUPLICATE_DRAW_REFUND_VP)
  assert.equal(merged.newlyUnlockedCount, 0)
  // With every family owned the ten-draw guarantee has nothing new to award.
  const batch = assertMinimumNew(collection, draw(collection, () => 0))
  assert(batch.results.every(result => result.isDuplicate))
})
for (const remaining of [0, 1, 2, 3]) {
  checkGuarantee(`${remaining} unowned species left: award all possible new species without rerolling forever`, () => {
    const missing = [150, 151, 384].slice(0, remaining)
    const collection = collectionOf(POKEMON_POOL.filter(pokemon => !missing.includes(pokemon.id)).map(pokemon => pokemon.id))
    let calls = 0
    const results = draw(collection, () => { calls += 1; return 0 })
    const merged = assertMinimumNew(collection, results)
    assert.deepEqual(merged.results.filter(result => !result.isDuplicate).map(result => result.id).sort((a, b) => a - b), missing.slice().sort((a, b) => a - b))
    assert(calls <= 46, `Unexpected rerolls: ${calls}`)
  })
}
checkGuarantee('separate purchases and multiple ten-draw batches each observe the updated collection', () => {
  const collection = collectionOf(POKEMON_POOL.filter(pokemon => pokemon.rarity !== 'legend').map(pokemon => pokemon.id))
  const results = createPokemonDraw(20, collection, () => 0, { bannerId: 'standard', now: 0 })
  const first = assertMinimumNew(collection, results.slice(0, 10))
  const second = assertMinimumNew(first.collection, results.slice(10))
  assertMinimumNew(second.collection, draw(second.collection, () => 0))
  assert.deepEqual(createPokemonDraw(0, collection, () => 0), [])
})
checkGuarantee('a purchase with at least three natural new species needs no forced roll', () => {
  let calls = 0
  const results = draw([], () => {
    const index = calls++
    return index % 4 === 1 ? Math.floor(index / 4) / DRAW_RARITY_POOLS.common.length : 0.1
  })
  assert.equal(calls, 40)
  assert.equal(new Set(results.map(pokemon => pokemon.id)).size, 10)
})
checkGuarantee('single draws and incomplete batches preserve normal rates and do not receive a three-species guarantee', () => {
  const results = createPokemonDraw(9, [], () => 0, { bannerId: 'standard', now: 0 })
  assert.equal(new Set(results.map(pokemon => pokemon.id)).size, 1)
  assert.equal(results.length, 9)
})
for (const bannerId of ['pickup', 'shiny']) {
  checkGuarantee(`${bannerId} retains ten duplicate results with unchanged refunds and shiny behavior`, () => {
    const collection = collectionOf(POKEMON_POOL.map(pokemon => pokemon.id))
    const results = draw(collection, () => 0.5, { bannerId })
    assert.equal(new Set(results.map(pokemon => pokemon.id)).size, 1)
    assert(results.every(pokemon => pokemon.bannerId === bannerId && pokemon.isShiny === (bannerId === 'shiny')))
    assert.equal(mergePokemonDraws(collection, results).duplicateCount, 10)
    const unownedResults = draw([], () => 0.5, { bannerId })
    assert.equal(new Set(unownedResults.map(pokemon => pokemon.id)).size, 1)
  })
}
checkGuarantee('prices and base rarity/shiny rates remain unchanged', () => {
  assert.deepEqual(Object.values(DRAW_BANNERS).map(banner => banner.price), [1000, 1800, 3600])
  assert.deepEqual(DRAW_RARITY_ORDER.map(rarity => RARITY_META[rarity].rate), [0.5, 0.32, 0.14, 0.03, 0.01])
  assert.equal(BASE_SHINY_ODDS, 4096)
})

if (failures.length > 0) {
  console.error(failures.slice(0, 30).join('\n'))
  if (failures.length > 30) console.error(`외 ${failures.length - 30}건`)
  process.exitCode = 1
} else {
  process.stdout.write(
    `Validated ${POKEMON_POOL.length} National Dex candidates, ${LEGENDARY_MYTHICAL_POOL.length} EX pickups, 3 draw banners and ${guaranteeChecks} guarantee checks.\n`,
  )
}
