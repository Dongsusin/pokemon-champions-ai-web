import assert from 'node:assert/strict'
import { INITIAL_VP_BALANCE } from '../src/data/pokemonPool.js'
import { AI_BATTLE_VP_REWARDS, getAiBattleVpReward } from '../src/data/aiBattleRewards.js'
import { RANKED_VP_REWARDS, getRankedVpReward } from '../src/data/rankedRewards.js'
import { ACHIEVEMENTS, ACHIEVEMENT_STORAGE_KEY, createAchievementState } from '../src/data/achievementData.js'
import { prepareAchievementRewards } from '../src/data/achievementRewards.js'
import { creditRankedVpRewards, loadAchievementWallet, saveAchievementWallet } from '../src/data/achievementStorage.js'

class MemoryStorage {
  data = new Map()
  getItem(key) { return this.data.get(key) ?? null }
  setItem(key, value) { this.data.set(key, String(value)) }
}

assert.equal(INITIAL_VP_BALANCE, 50000)
assert.equal(loadAchievementWallet(new MemoryStorage()).balance, 50000, 'A new account starts with 50,000 VP')
for (const balance of [0, 1, 30000, 48750, 425000]) {
  const storage = new MemoryStorage()
  storage.setItem('champions-vp-v1', String(balance))
  assert.equal(loadAchievementWallet(storage).balance, balance, 'Changing the default must not refill or multiply an existing balance')
  saveAchievementWallet(createAchievementState(), balance, storage)
  storage.setItem('champions-vp-v1', '999999')
  assert.equal(loadAchievementWallet(storage).balance, balance, 'The saved atomic wallet takes precedence over a stale legacy mirror')
}

assert.deepEqual(AI_BATTLE_VP_REWARDS, { league: 200, tournament: 300 })
for (const [mode, amount] of Object.entries(AI_BATTLE_VP_REWARDS)) {
  assert.equal(getAiBattleVpReward({ mode, battleProcessed: true, playerWon: true, forfeited: false }), amount)
  assert.equal(getAiBattleVpReward({ mode, battleProcessed: false, playerWon: true, forfeited: false }), 0)
  assert.equal(getAiBattleVpReward({ mode, battleProcessed: true, playerWon: false, forfeited: false }), 0)
  assert.equal(getAiBattleVpReward({ mode, battleProcessed: true, playerWon: true, forfeited: true }), 0)
}
assert.equal(getAiBattleVpReward(), 0)
assert.equal(getAiBattleVpReward({ mode: 'toString', battleProcessed: true, playerWon: true }), 0)
assert.deepEqual(RANKED_VP_REWARDS, { win: 600, loss: 200, draw: 300 })
for (const [outcome, amount] of Object.entries(RANKED_VP_REWARDS)) {
  assert.equal(getRankedVpReward({ outcome, reason: 'battle', battleStarted: true }), amount)
  assert.equal(getRankedVpReward({ outcome, reason: 'turn-limit', battleStarted: true }), amount)
  for (const reason of ['forfeit', 'turn-timeout', 'replacement-timeout']) {
    assert.equal(getRankedVpReward({ outcome, reason, battleStarted: true }), outcome === 'win' ? 600 : 0)
  }
  for (const reason of ['both-timeout', 'selection-timeout', 'both-selection-timeout']) {
    assert.equal(getRankedVpReward({ outcome, reason, battleStarted: true }), 0)
  }
  assert.equal(getRankedVpReward({ outcome, reason: 'battle', battleStarted: false }), 0)
}

// The release baseline makes the requested exact doubling verifiable for every
// definition, including the generated first-win achievement for each trainer.
const previousAchievementRewards = {
  'wins-1': 200, 'wins-10': 300, 'wins-50': 700, 'wins-100': 1200,
  'flawless-1': 200, 'flawless-10': 600, 'no-gimmick-1': 200, 'no-gimmick-10': 500,
  'pure-flawless': 500, 'quick-victory': 300, 'last-standing': 300, 'no-held-items': 300,
  'monotype-victory': 400, 'mechanic-mega': 300, 'mechanic-zmove': 300,
  'mechanic-dynamax': 300, 'mechanic-tera': 300, 'mechanic-primal': 300,
  'format-single': 200, 'format-double': 300, 'hard-victory': 400, 'boost-three-victory': 500,
  'trainers-5': 500, 'trainers-25': 800, 'trainers-100': 1200, 'trainers-all': 2000,
  'regions-3': 400, 'regions-8': 800, 'regions-all': 1500,
  'league-champion': 1000, 'tournament-champion': 800, 'league-perfect': 1500,
  'streak-3': 300, 'streak-5': 600, 'streak-10': 1000,
  'flawless-league': 50000, 'flawless-tournament': 50000,
  'collection-all': 100000, 'collection-shiny-all': 200000, 'achievements-all': 300000,
}
assert.equal(ACHIEVEMENTS.length, 278)
for (const definition of ACHIEVEMENTS) {
  const previous = definition.trainerId ? 100 : previousAchievementRewards[definition.id]
  assert(Number.isSafeInteger(previous), `Missing economy baseline for ${definition.id}`)
  assert.equal(definition.rewardVp, previous * 2, `${definition.id} must pay exactly twice its previous reward`)
}
assert.equal(Object.keys(previousAchievementRewards).length, ACHIEVEMENTS.filter(definition => !definition.trainerId).length)

const existing = createAchievementState()
existing.unlocked = Object.fromEntries(ACHIEVEMENTS.map(definition => [definition.id, 12345]))
const oldStorage = new MemoryStorage()
oldStorage.setItem(ACHIEVEMENT_STORAGE_KEY, JSON.stringify({
  ...existing, walletBalance: 48750, rankedVpRewards: { uid: 'economy-existing-user', total: 1200 },
}))
const loaded = loadAchievementWallet(oldStorage)
const replay = prepareAchievementRewards(loaded.progress, [], {})
assert.equal(loaded.balance, 48750)
assert.equal(replay.rewardVp, 0, 'Previously granted achievements do not pay a price-adjustment bonus')
assert.deepEqual(replay.unlocked, [])
assert.deepEqual(replay.state.unlocked, existing.unlocked, 'Original achievement grant timestamps are preserved')
const oldReceipt = creditRankedVpRewards(replay.state, loaded.balance, { uid: 'economy-existing-user', total: 1200 }, 'economy-existing-user', oldStorage)
assert.deepEqual(oldReceipt, { balance: 48750, granted: 0, appliedTotal: 1200 }, 'The old cumulative ranked total must not be doubled or paid again')
const nextWin = creditRankedVpRewards(replay.state, loaded.balance, { uid: 'economy-existing-user', total: 1800 }, 'economy-existing-user', oldStorage)
assert.deepEqual(nextWin, { balance: 49350, granted: 600, appliedTotal: 1800 })
assert.equal(creditRankedVpRewards(replay.state, nextWin.balance, { uid: 'economy-existing-user', total: 1800 }, 'economy-existing-user', oldStorage).granted, 0)
assert.equal(loadAchievementWallet(oldStorage).balance, 49350)

console.log('VP economy validation passed: new-account 50,000 VP; existing wallet/achievement/ranked receipt preservation; doubled AI and ranked rewards; exactly doubled 278 achievements; unchanged zero-reward exits and replay protection.')
