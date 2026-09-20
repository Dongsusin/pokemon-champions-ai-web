import assert from 'node:assert/strict'
import { applyBossAchievements, createAchievementState, normalizeAchievementState, ACHIEVEMENTS } from '../src/data/achievementData.js'
import { getEarnedTrainerTitles } from '../src/data/titleData.js'
import { saveAchievementWallet, loadAchievementWallet } from '../src/data/achievementStorage.js'
const fresh = createAchievementState()
const victory = bossId => ({bossId, round:3, winner:'player'})
for(const event of [null, {...victory('mewtwo'),round:1}, {...victory('mewtwo'),round:2}, {...victory('mewtwo'),winner:'opponent'}, {...victory('mewtwo'),forfeited:true}, victory('invalid'), victory('constructor')]) {
 const result=applyBossAchievements(fresh,event); assert.equal(result.rewardVp,0); assert.deepEqual(result.state,fresh)
}
let result=applyBossAchievements(fresh,victory('mewtwo'),100)
assert.equal(result.rewardVp,3000); assert.equal(result.unlocked.length,2)
assert.equal(getEarnedTrainerTitles(result.state).length,2)
assert.deepEqual(fresh,createAchievementState())
let total=result.rewardVp
for(const id of ['hooh','lugia']) { result=applyBossAchievements(normalizeAchievementState(JSON.parse(JSON.stringify(result.state))),victory(id),101); total+=result.rewardVp }
assert.equal(total,12000); assert.equal(result.state.stats.bossKinds,3)
assert.equal(getEarnedTrainerTitles(result.state).length,5)
for(const boss of ['mewtwo','hooh','lugia']) {const again=applyBossAchievements(result.state,victory(boss));assert.equal(again.rewardVp,0);assert.equal(again.processed,false)}
const values=new Map(); const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)}
saveAchievementWallet(result.state,total,storage)
const loaded=loadAchievementWallet(storage);assert.equal(loaded.balance,total);assert.deepEqual(loaded.progress,result.state)
assert.equal(ACHIEVEMENTS.filter(a=>a.category==='boss').length,5)
console.log('PASS boss achievements: final wins only, five titles, 12000 VP once, repeated callbacks, invalid input, immutable state, wallet reload')
