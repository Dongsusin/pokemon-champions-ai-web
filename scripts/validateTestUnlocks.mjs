import {
  DUPLICATE_DRAW_REFUND_VP,
  INITIAL_VP_BALANCE,
  POKEMON_POOL,
  createCompletePokemonCollection,
  mergePokemonDraws,
} from '../src/data/pokemonPool.js'
import { NATIONAL_DEX } from '../src/data/trainingData.js'
import {
  BATTLE_ITEMS,
  MAX_ITEM_QUANTITY,
  createCompleteBattleItemInventory,
} from '../src/data/shopData.js'

const failures = []
const directlyDrawnPokemon = POKEMON_POOL[0]
const partialCollection = mergePokemonDraws([], [{
  ...directlyDrawnPokemon,
  isShiny: true,
}]).collection
const sameBatchDuplicate = mergePokemonDraws([], [
  { ...directlyDrawnPokemon, isShiny: false },
  { ...directlyDrawnPokemon, isShiny: false },
])
const ownedPokemonDuplicates = mergePokemonDraws(partialCollection, [
  { ...directlyDrawnPokemon, isShiny: false },
  { ...directlyDrawnPokemon, isShiny: false },
])
const originalPokemon = partialCollection.find((pokemon) => pokemon.dexSpeciesId === directlyDrawnPokemon.id)
const completeCollection = createCompletePokemonCollection(partialCollection)
const completeDexIds = new Set(completeCollection.map((pokemon) => pokemon.dexSpeciesId))
const preservedPokemon = completeCollection.find((pokemon) => pokemon.dexSpeciesId === directlyDrawnPokemon.id)
const normalColorPreference = { ...originalPokemon, isShiny: false }
const migratedNormalColor = createCompletePokemonCollection([normalColorPreference])
  .find((pokemon) => pokemon.dexSpeciesId === directlyDrawnPokemon.id)
const redrawnNormalColor = mergePokemonDraws([normalColorPreference], [{
  ...directlyDrawnPokemon,
  isShiny: false,
}]).collection.find((pokemon) => pokemon.dexSpeciesId === directlyDrawnPokemon.id)

if (INITIAL_VP_BALANCE !== 30_000) {
  failures.push(`Initial VP mismatch: ${INITIAL_VP_BALANCE}/30000`)
}

if (DUPLICATE_DRAW_REFUND_VP !== 50) {
  failures.push(`Duplicate refund mismatch: ${DUPLICATE_DRAW_REFUND_VP}/50`)
}

if (
  sameBatchDuplicate.duplicateCount !== 1
  || sameBatchDuplicate.duplicateRefundVp !== 50
  || sameBatchDuplicate.results[0]?.isDuplicate
  || !sameBatchDuplicate.results[1]?.isDuplicate
  || sameBatchDuplicate.results[1]?.duplicateRefundVp !== 50
) {
  failures.push('A repeated Pokemon in the same draw did not refund exactly 50 VP.')
}

if (
  ownedPokemonDuplicates.duplicateCount !== 2
  || ownedPokemonDuplicates.duplicateRefundVp !== 100
  || ownedPokemonDuplicates.results.some((result) => !result.isDuplicate)
) {
  failures.push('Already-owned Pokemon did not refund 50 VP for every repeated draw.')
}

if (!originalPokemon?.shinyObtained || !originalPokemon.isShiny) {
  failures.push('첫 이로치 획득 시 이로치 색상이 자동으로 활성화되지 않음')
}

if (completeCollection.length !== NATIONAL_DEX.length) {
  failures.push(`전체 도감 수 불일치: ${completeCollection.length}/${NATIONAL_DEX.length}`)
}

for (const pokemon of NATIONAL_DEX) {
  if (!completeDexIds.has(pokemon.id)) failures.push(`${pokemon.name}(${pokemon.id}): 도감 미획득`)
}

if (
  !preservedPokemon
  || preservedPokemon.directDrawCount !== originalPokemon.directDrawCount
  || preservedPokemon.shinyObtained !== originalPokemon.shinyObtained
  || preservedPokemon.nature !== originalPokemon.nature
) {
  failures.push('기존 포켓몬의 획득·이로치·육성 정보가 보존되지 않음')
}

if (
  !migratedNormalColor?.shinyObtained
  || migratedNormalColor.isShiny
  || !redrawnNormalColor?.shinyObtained
  || redrawnNormalColor.isShiny
) {
  failures.push('이로치 보유 포켓몬의 일반색 설정이 저장 또는 중복 뽑기 후 유지되지 않음')
}

const completeInventory = createCompleteBattleItemInventory()
const ownedItemIds = Object.keys(completeInventory)

if (ownedItemIds.length !== BATTLE_ITEMS.length) {
  failures.push(`전체 아이템 수 불일치: ${ownedItemIds.length}/${BATTLE_ITEMS.length}`)
}

for (const item of BATTLE_ITEMS) {
  if (completeInventory[item.id] !== MAX_ITEM_QUANTITY) {
    failures.push(`${item.name}(${item.id}): 미보유`)
  }
}

if (failures.length > 0) {
  console.error(failures.slice(0, 30).join('\n'))
  if (failures.length > 30) console.error(`외 ${failures.length - 30}건`)
  process.exitCode = 1
} else {
  process.stdout.write(
    `Validated ${completeCollection.length} Pokemon and ${ownedItemIds.length} battle item test unlocks.\n`,
  )
}
