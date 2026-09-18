import { applyBattleAchievements, applyCollectionAchievements, normalizeAchievementState } from './achievementData.js'
import { normalizePokemon } from './trainingData.js'
import { normalizeItemInventory } from './shopData.js'
import { RARE_BATTLE_ITEMS, getUnlockedRareItems } from './rareRewards.js'

const rareItemIds = new Set(RARE_BATTLE_ITEMS.map(item => item.id))

// Entitlements live in the atomic achievement record. Reconstruct their tangible
// rewards after a reload even if the ordinary box/item mirror was not written yet.
export function restoreAchievementRewards(progress, collection = [], inventory = {}) {
  const earnedItems = getUnlockedRareItems(progress)
  const earnedItemIds = new Set(earnedItems.map(item => item.id))
  let collectionChanged = false
  const source = Array.isArray(collection) ? collection : []
  const restoredCollection = source.map(pokemon => {
    if (!rareItemIds.has(pokemon.heldItemId) || earnedItemIds.has(pokemon.heldItemId)) return pokemon
    collectionChanged = true
    return normalizePokemon({ ...pokemon, heldItemId: null, heldItemName: null })
  })
  const restoredInventory = normalizeItemInventory({
    ...Object.fromEntries(Object.entries(inventory).filter(([id]) => !rareItemIds.has(id))),
    ...Object.fromEntries(earnedItems.map(item => [item.id, 1])),
  })
  return {
    collection: collectionChanged ? restoredCollection : collection,
    inventory: JSON.stringify(restoredInventory) === JSON.stringify(inventory) ? inventory : restoredInventory,
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
  let restored = restoreAchievementRewards(state, collection, inventory)
  // The collection pass can complete a goal that entitles the player to a rare
  // item, so settle once more before reporting the final state.
  const result = applyCollectionAchievements(state, restored.collection, now)
  state = result.state
  rewardVp += result.rewardVp
  unlocked.push(...result.unlocked)
  restored = restoreAchievementRewards(state, restored.collection, restored.inventory)
  return {
    state, unlocked, rewardVp,
    battleProcessed: battleResult?.processed ?? false,
    progressChanged: JSON.stringify(state) !== JSON.stringify(initialState),
    collection: restored.collection,
    inventory: restored.inventory,
  }
}
