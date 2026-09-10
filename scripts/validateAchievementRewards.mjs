import assert from 'node:assert/strict'
import { ACHIEVEMENTS, createAchievementState } from '../src/data/achievementData.js'
import { prepareAchievementRewards, restoreAchievementRewards } from '../src/data/achievementRewards.js'
import { loadAchievementWallet, saveAchievementWallet } from '../src/data/achievementStorage.js'
import { NATIONAL_DEX, normalizePokemon } from '../src/data/trainingData.js'
import { migratePokemonCollection } from '../src/data/pokemonPool.js'
import { getVisibleBattleItems } from '../src/data/shopData.js'

const completeCollection = NATIONAL_DEX.map(profile => ({
  captureId: `dex-${profile.id}`, speciesId: profile.id, dexSpeciesId: profile.id,
  directDrawCount: 1, shinyObtained: false, isShiny: false,
}))
const fresh = createAchievementState()
const ordinary = prepareAchievementRewards(fresh, completeCollection, {})
assert.deepEqual(ordinary.unlocked.map(def => def.id), ['collection-all'])
assert.equal(ordinary.rewardVp, 100000)
assert.equal(ordinary.state.stats.collectionSpeciesCount, 1025)
assert.equal(ordinary.state.stats.shinySpeciesCount, 0)
assert.equal(ordinary.collection.length, 1025)
assert.deepEqual(fresh, createAchievementState())
const repeat = prepareAchievementRewards(ordinary.state, ordinary.collection, ordinary.inventory)
assert.equal(repeat.rewardVp, 0)
assert.equal(repeat.progressChanged, false)
assert.equal(repeat.collection, ordinary.collection)

// A saved flawless-tournament entitlement may survive a crash before its Lugia
// was mirrored into the box. Restoring that final species must also settle the
// newly completed collection and meta goal exactly once.
const almostComplete = createAchievementState()
for (const def of ACHIEVEMENTS) {
  if (!['collection-all', 'achievements-all'].includes(def.id)) almostComplete.unlocked[def.id] = 123
}
const withoutLugia = completeCollection.filter(pokemon => pokemon.speciesId !== 249)
const completed = prepareAchievementRewards(almostComplete, withoutLugia, { 'leftovers': 1 })
assert.deepEqual(completed.unlocked.map(def => def.id), ['collection-all', 'achievements-all'])
assert.equal(completed.rewardVp, 400000)
assert.equal(completed.collection.length, 1025)
assert.equal(completed.collection.find(pokemon => pokemon.speciesId === 249).captureId, 'dex-249')
assert.equal(completed.collection.find(pokemon => pokemon.speciesId === 249).skinId, 'shadow-lugia')
assert.deepEqual(completed.inventory, { leftovers: 1, 'legend-plate': 1 })
assert(getVisibleBattleItems(completed.inventory).some(item => item.id === 'legend-plate'))

class MemoryStorage {
  data = new Map()
  fail = false
  getItem(key) { return this.data.get(key) ?? null }
  setItem(key, value) { if (this.fail) throw new Error('QuotaExceededError'); this.data.set(key, String(value)) }
}
const storage = new MemoryStorage()
saveAchievementWallet(almostComplete, 25000, storage)
storage.fail = true
assert.throws(() => saveAchievementWallet(completed.state, 425000, storage))
assert.equal(loadAchievementWallet(storage).balance, 25000)
assert.equal(loadAchievementWallet(storage).progress.unlocked['achievements-all'], undefined)
storage.fail = false
saveAchievementWallet(completed.state, 425000, storage)
const loaded = loadAchievementWallet(storage)
const recovered = restoreAchievementRewards(loaded.progress, withoutLugia, { leftovers: 1 })
assert.equal(recovered.collection.length, 1025)
assert.equal(recovered.inventory['legend-plate'], 1)
assert.equal(prepareAchievementRewards(loaded.progress, recovered.collection, recovered.inventory).rewardVp, 0)
assert.equal(loadAchievementWallet(storage).balance, 425000)
const migrated = migratePokemonCollection(recovered.collection)
assert.equal(migrated.filter(pokemon => pokemon.speciesId === 249).length, 1)
assert.equal(migrated.find(pokemon => pokemon.speciesId === 249).captureId, 'dex-249')
assert.equal(migrated.find(pokemon => pokemon.speciesId === 249).skinId, 'shadow-lugia')

const unearnedLoadout = normalizePokemon({ captureId: 'dex-150', speciesId: 150,
  skinId: 'armored-mewtwo', heldItemId: 'legend-plate', heldItemName: '레전드플레이트', isShiny: true, shinyObtained: true })
const sanitized = restoreAchievementRewards(fresh, [unearnedLoadout], { leftovers: 1, 'legend-plate': 1 })
assert.equal(sanitized.collection[0].skinId, null)
assert.equal(sanitized.collection[0].heldItemId, null)
assert.equal(sanitized.collection[0].heldItemName, null)
assert.equal(sanitized.collection[0].shinyObtained, true)
assert.equal(sanitized.inventory['legend-plate'], undefined)
assert(!getVisibleBattleItems(sanitized.inventory).some(item => item.id === 'legend-plate'))
assert.equal(unearnedLoadout.skinId, 'armored-mewtwo', 'Restoration must not mutate old save objects')

const existingMewtwo = normalizePokemon({ captureId: 'dex-150', speciesId: 150 })
const earned = { ...createAchievementState(), unlocked: { 'flawless-league': 456 } }
const original = [existingMewtwo]
const skinUnlock = restoreAchievementRewards(earned, original, {})
assert.equal(skinUnlock.collection, original, 'An owned base is not duplicated or silently reskinned')
assert.equal(skinUnlock.grantedPokemon.length, 0)
console.log('Achievement reward integration passed: collection grants, chained meta, atomic wallet failure/recovery, stable gifted IDs, hidden unearned loadouts and once-only payouts.')
