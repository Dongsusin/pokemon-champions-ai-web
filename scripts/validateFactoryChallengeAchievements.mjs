import assert from 'node:assert/strict'
import {applyFactoryAchievements, createAchievementState, normalizeAchievementState, ACHIEVEMENTS} from '../src/data/achievementData.js'
import {getEarnedTrainerTitles} from '../src/data/titleData.js'
import {saveAchievementWallet,loadAchievementWallet} from '../src/data/achievementStorage.js'
const apply=(state,floor,mode='challenge')=>applyFactoryAchievements(state,floor,1234,mode)
let result=apply(createAchievementState(),100,'standard')
assert.equal(result.state.stats.factoryChallengeBestFloor,0)
assert.equal(result.unlocked.some(a=>a.category==='factory-challenge'),false)
const initial=result.state
let extra=0
for(const [floor,target] of [[9,0],[10,1],[29,1],[30,2],[49,2],[50,3],[99,3],[100,4]]){
 result=apply(result.state,floor);extra+=result.rewardVp
 assert.equal(getEarnedTrainerTitles(result.state).filter(t=>t.id.startsWith('factory-challenge-')).length,target)
 assert.equal(apply(result.state,floor).rewardVp,0)
}
assert.equal(extra,19000)
assert.equal(initial.stats.factoryChallengeBestFloor,0)
assert.equal(apply(result.state,10).state.stats.factoryChallengeBestFloor,100)
assert.equal(apply(result.state,999).rewardVp,0)
const restored=apply(normalizeAchievementState(JSON.parse(JSON.stringify(initial))),95)
assert.equal(restored.unlocked.filter(a=>a.category==='factory-challenge').length,3)
assert.equal(restored.rewardVp,9000)
const values=new Map(),storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)}
saveAchievementWallet(result.state,30000,storage)
assert.deepEqual(loadAchievementWallet(storage).progress,result.state)
for(const floor of [NaN,Infinity,-1,10.5,'100']) assert.equal(apply(createAchievementState(),floor).rewardVp,0)
assert.equal(ACHIEVEMENTS.filter(a=>a.category==='factory-challenge').length,4)
console.log('PASS challenge achievements: mode isolation, four floor boundaries, 19000 VP once, titles, restored 95F, monotonic record, wallet persistence, invalid floors')
