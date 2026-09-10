import assert from 'node:assert/strict'
import { ACHIEVEMENT_STORAGE_KEY, ACHIEVEMENTS, createAchievementState } from '../src/data/achievementData.js'
import { loadAchievementWallet, saveAchievementWallet } from '../src/data/achievementStorage.js'

class Storage {
  values = new Map()
  failKey = null
  getItem(key) { return this.values.get(key) ?? null }
  setItem(key,value) {
    if (key === this.failKey) throw new Error('QuotaExceededError')
    this.values.set(key,String(value))
  }
  removeItem(key) { this.values.delete(key) }
}
const storage = new Storage()
storage.setItem('champions-vp-v1','27500')
assert.equal(loadAchievementWallet(storage).balance,27500)
assert.deepEqual(loadAchievementWallet(storage).progress,createAchievementState())
const progress = createAchievementState()
progress.unlocked[ACHIEVEMENTS[0].id] = 1000
progress.stats.wins = 1
progress.processedBattleIds = ['match-1']
saveAchievementWallet(progress,27800,storage)
assert.equal(storage.getItem('champions-vp-v1'),'27800')
assert.deepEqual(loadAchievementWallet(storage),{progress,balance:27800})

// The old VP mirror cannot undo a committed achievement reward after a reload.
storage.setItem('champions-vp-v1','27500')
assert.equal(loadAchievementWallet(storage).balance,27800)
storage.failKey = 'champions-vp-v1'
saveAchievementWallet(progress,28000,storage)
assert.equal(loadAchievementWallet(storage).balance,28000)
assert.equal(storage.getItem('champions-vp-v1'),'27500')

// If the atomic write fails, neither achievement progress nor currency changes.
const before = storage.getItem(ACHIEVEMENT_STORAGE_KEY)
storage.failKey = ACHIEVEMENT_STORAGE_KEY
assert.throws(()=>saveAchievementWallet({...progress,stats:{...progress.stats,wins:2}},29000,storage))
assert.equal(storage.getItem(ACHIEVEMENT_STORAGE_KEY),before)
assert.equal(loadAchievementWallet(storage).balance,28000)
for (const invalid of [-1,Infinity,NaN,12.5]) assert.throws(()=>saveAchievementWallet(progress,invalid,storage))
storage.failKey = null
storage.setItem(ACHIEVEMENT_STORAGE_KEY,'{invalid json')
assert.equal(loadAchievementWallet(storage).balance,27500)
assert.deepEqual(loadAchievementWallet(storage).progress,createAchievementState())

globalThis.window = {localStorage:storage,sessionStorage:new Storage()}
const {readLocalPlayerData,replaceLocalPlayerData,clearLocalPlayerData,getPlayerDataProgressScore} = await import('../src/auth/accountStorage.js')
saveAchievementWallet(progress,28000,storage)
const payload = readLocalPlayerData()
assert.ok(payload[ACHIEVEMENT_STORAGE_KEY])
const withoutAchievements = {...payload}
delete withoutAchievements[ACHIEVEMENT_STORAGE_KEY]
assert.ok(getPlayerDataProgressScore(payload)>getPlayerDataProgressScore(withoutAchievements))
replaceLocalPlayerData({'champions-vp-v1':'1000'})
assert.equal(storage.getItem(ACHIEVEMENT_STORAGE_KEY),null)
assert.equal(loadAchievementWallet(storage).balance,1000)
replaceLocalPlayerData(payload)
assert.deepEqual(loadAchievementWallet(storage),{progress,balance:28000})
clearLocalPlayerData()
assert.equal(storage.getItem(ACHIEVEMENT_STORAGE_KEY),null)
console.log('Achievement wallet: legacy migration, atomic rewards, reload, failed writes and account isolation passed.')
