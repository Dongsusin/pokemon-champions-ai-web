import { applyBattleAchievements, applyCollectionAchievements, normalizeAchievementState } from './achievementData.js'
import { normalizePokemon } from './trainingData.js'
import { normalizeItemInventory } from './shopData.js'
import { POKEMON_SKINS, RARE_BATTLE_ITEMS, fulfillRareRewardCollection, getUnlockedPokemonSkins, getUnlockedRareItems } from './rareRewards.js'

const rareItemIds = new Set(RARE_BATTLE_ITEMS.map(item => item.id))

// Entitlements live in the atomic achievement record. Reconstruct their tangible
// rewards after a reload even if the ordinary box/item mirror was not written yet.
export function restoreAchievementRewards(progress, collection = [], inventory = {}) {
  const materialized = fulfillRareRewardCollection(progress, collection)
  const grantedIds = new Set(materialized.grantedPokemon.map(pokemon => pokemon.captureId))
  const earnedItems = getUnlockedRareItems(progress)
  const earnedItemIds = new Set(earnedItems.map(item => item.id))
  let collectionChanged = materialized.collection !== collection
  const restoredCollection = materialized.collection.map(pokemon => {
    const skinAllowed = !pokemon.skinId || getUnlockedPokemonSkins(progress, pokemon).some(skin => skin.id === pokemon.skinId)
    const itemAllowed = !rareItemIds.has(pokemon.heldItemId) || earnedItemIds.has(pokemon.heldItemId)
    if (!grantedIds.has(pokemon.captureId) && skinAllowed && itemAllowed) return pokemon
    collectionChanged = true
    return normalizePokemon({
      ...pokemon,
      skinId: skinAllowed ? pokemon.skinId : null,
      heldItemId: itemAllowed ? pokemon.heldItemId : null,
      heldItemName: itemAllowed ? pokemon.heldItemName : null,
    })
  })
  const restoredInventory = normalizeItemInventory({
    ...Object.fromEntries(Object.entries(inventory).filter(([id]) => !rareItemIds.has(id))),
    ...Object.fromEntries(earnedItems.map(item => [item.id, 1])),
  })
  return {
    collection: collectionChanged ? restoredCollection : collection,
    inventory: JSON.stringify(restoredInventory) === JSON.stringify(inventory) ? inventory : restoredInventory,
    grantedPokemon: materialized.grantedPokemon,
  }
}

// A battle reward can supply the last missing species, unlocking a collection
// reward and then the final achievement in the same once-only settlement.
export function prepareAchievementRewards(progress, collection, inventory, battleEvent = null, now = Date.now()) {
  const initialState = normalizeAchievementState(progress)
  const battleResult = battleEvent ? applyBattleAchievements(initialState, battleEvent, now) : null
  let state = battleResult?.state ?? initialState
  let rewardVp = battleResult?.rewardVp ?? 0
  const unlocked = [...(battleResult?.unlocked ?? [])]
  let restored = { collection, inventory }
  for (let step = 0; step < POKEMON_SKINS.length + 2; step += 1) {
    const beforeCollection = restored.collection
    restored = restoreAchievementRewards(state, restored.collection, restored.inventory)
    const result = applyCollectionAchievements(state, restored.collection, now)
    state = result.state
    rewardVp += result.rewardVp
    unlocked.push(...result.unlocked)
    if (restored.collection === beforeCollection && result.unlocked.length === 0) break
  }
  restored = restoreAchievementRewards(state, restored.collection, restored.inventory)
  return {
    state, unlocked, rewardVp,
    battleProcessed: battleResult?.processed ?? false,
    progressChanged: JSON.stringify(state) !== JSON.stringify(initialState),
    collection: restored.collection,
    inventory: restored.inventory,
  }
}
