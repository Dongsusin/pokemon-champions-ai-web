import assert from 'node:assert/strict'
import { creditBattleFactoryVpReward, saveAchievementWallet } from '../src/data/achievementStorage.js'
import { getBattleFactoryVpReward } from '../src/data/battleFactoryRewards.js'

const values = new Map()
const storage = {
  getItem: key => values.has(key) ? values.get(key) : null,
  setItem: (key, value) => values.set(key, String(value)),
}
const uid = 'factory-reward-test-user'
const runId = 'factory-reward-test-run'
const result = floor => ({ uid, runId, battleId: `${runId}:floor:${floor}`, floor, winner: 'player', forfeited: false })

assert.equal(getBattleFactoryVpReward(1), 300)
assert.equal(getBattleFactoryVpReward(2), 350)
assert.equal(getBattleFactoryVpReward(15), 1000)
assert.equal(getBattleFactoryVpReward(100), 1000)
assert.equal(getBattleFactoryVpReward(0), 0)

let wallet = creditBattleFactoryVpReward({}, 50000, result(1), uid, storage)
assert.deepEqual(wallet, { balance: 50300, granted: 300 })
assert.deepEqual(creditBattleFactoryVpReward({}, wallet.balance, result(1), uid, storage), { balance: 50300, granted: 0 })

wallet = creditBattleFactoryVpReward({}, wallet.balance, result(2), uid, storage)
assert.deepEqual(wallet, { balance: 50650, granted: 350 })
saveAchievementWallet({}, wallet.balance, storage)
assert.deepEqual(creditBattleFactoryVpReward({}, wallet.balance, result(2), uid, storage), { balance: 50650, granted: 0 })

assert.deepEqual(creditBattleFactoryVpReward({}, wallet.balance, { ...result(3), winner: 'opponent' }, uid, storage), { balance: 50650, granted: 0 })
assert.deepEqual(creditBattleFactoryVpReward({}, wallet.balance, { ...result(3), forfeited: true }, uid, storage), { balance: 50650, granted: 0 })
assert.throws(() => creditBattleFactoryVpReward({}, wallet.balance, result(4), uid, storage), /이전 층/)
assert.throws(() => creditBattleFactoryVpReward({}, wallet.balance, { ...result(3), battleId: 'forged' }, uid, storage), /확인하지 못했습니다/)

console.log('PASS Battle Factory VP reward schedule, payout, persistence, and duplicate prevention')
