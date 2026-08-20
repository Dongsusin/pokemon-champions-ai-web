import {
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
const originalPokemon = partialCollection.find((pokemon) => pokemon.dexSpeciesId === directlyDrawnPokemon.id)
const completeCollection = createCompletePokemonCollection(partialCollection)
const completeDexIds = new Set(completeCollection.map((pokemon) => pokemon.dexSpeciesId))
const preservedPokemon = completeCollection.find((pokemon) => pokemon.dexSpeciesId === directlyDrawnPokemon.id)

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
