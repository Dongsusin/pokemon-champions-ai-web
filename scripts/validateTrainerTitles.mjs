import assert from 'node:assert/strict'
import {
  ACHIEVEMENTS, applyFactoryAchievements, applyRankedAchievements,
  createAchievementState, getAchievementProgress, normalizeAchievementState,
} from '../src/data/achievementData.js'
import {
  TRAINER_TITLES, getEarnedTrainerTitles, getTitleForAchievement, getTrainerTitle,
  hasTrainerTitle, normalizeTrainerTitle, readTrainerTitle,
} from '../src/data/titleData.js'
import { RANKED_TIERS } from '../src/data/rankedRules.js'
import { RARE_BATTLE_ITEMS } from '../src/data/rareRewards.js'

let passed = 0
const failures = []
const check = (name, run) => {
  try { run(); passed += 1; console.log(`PASS ${name}`) }
  catch (error) { failures.push(name); console.error(`FAIL ${name}: ${error.stack}`) }
}
const byId = new Map(ACHIEVEMENTS.map((entry) => [entry.id, entry]))
const earnedState = (...ids) => {
  const state = createAchievementState()
  for (const id of ids) state.unlocked[id] = 1234
  return state
}

check('every title names a real achievement and every titled achievement points back', () => {
  assert.equal(new Set(TRAINER_TITLES.map((entry) => entry.id)).size, TRAINER_TITLES.length)
  assert.equal(new Set(TRAINER_TITLES.map((entry) => entry.name)).size, TRAINER_TITLES.length)
  assert.equal(new Set(TRAINER_TITLES.map((entry) => entry.achievementId)).size, TRAINER_TITLES.length)
  for (const title of TRAINER_TITLES) {
    const achievement = byId.get(title.achievementId)
    assert(achievement, `${title.id} names a missing achievement: ${title.achievementId}`)
    assert.equal(achievement.titleId, title.id)
    assert(title.name.length > 0 && title.description.length > 0)
  }
  const titled = ACHIEVEMENTS.filter((entry) => entry.titleId)
  assert.equal(titled.length, TRAINER_TITLES.length)
  for (const achievement of titled) assert.equal(getTitleForAchievement(achievement.id).id, achievement.titleId)
})

check('cosmetic Pokemon skins are gone and only the rare item remains a tangible reward', () => {
  assert.deepEqual(RARE_BATTLE_ITEMS.map((entry) => entry.id), ['legend-plate'])
  const withRewardId = ACHIEVEMENTS.filter((entry) => entry.rewardId)
  assert.deepEqual(withRewardId.map((entry) => [entry.id, entry.rewardId]), [['achievements-all', 'legend-plate']])
  // The four goals that used to grant a skin now grant a title instead.
  for (const id of ['flawless-league', 'flawless-tournament', 'collection-all', 'collection-shiny-all']) {
    assert.equal(byId.get(id).rewardId, null)
    assert(byId.get(id).titleId, `${id} must award a title`)
  }
})

check('a title is only offered once its achievement is unlocked', () => {
  assert.deepEqual(getEarnedTrainerTitles(createAchievementState()), [])
  assert.deepEqual(getEarnedTrainerTitles(null), [])
  const state = earnedState('collection-all')
  assert.deepEqual(getEarnedTrainerTitles(state).map((entry) => entry.id), ['dex-master'])
  assert.equal(hasTrainerTitle(state, 'dex-master'), true)
  assert.equal(hasTrainerTitle(state, 'champion-proof'), false)
  assert.equal(hasTrainerTitle(state, 'not-a-title'), false)
  // A malformed timestamp is not an unlock.
  assert.equal(hasTrainerTitle({ unlocked: { 'collection-all': 'yes' } }, 'dex-master'), false)
  assert.equal(hasTrainerTitle({ unlocked: { 'collection-all': -1 } }, 'dex-master'), false)
})

check('title ids normalize strictly and unknown ids never reach a profile', () => {
  assert.equal(normalizeTrainerTitle(''), '')
  assert.equal(normalizeTrainerTitle(null), '')
  assert.equal(normalizeTrainerTitle(undefined), '')
  assert.equal(normalizeTrainerTitle(' dex-master '), 'dex-master')
  assert.throws(() => normalizeTrainerTitle('made-up'))
  assert.throws(() => normalizeTrainerTitle(42))
  assert.equal(readTrainerTitle('made-up'), '')
  assert.equal(readTrainerTitle('dex-master'), 'dex-master')
  assert.equal(getTrainerTitle('made-up'), null)
})

check('Battle Factory titles land on the fiftieth and hundredth floors only', () => {
  const fifty = byId.get('factory-floor-50')
  const hundred = byId.get('factory-floor-100')
  assert.equal(fifty.target, 50)
  assert.equal(hundred.target, 100)
  const fresh = createAchievementState()
  assert.equal(applyFactoryAchievements(fresh, 49).unlocked.length, 0)
  assert.equal(applyFactoryAchievements(fresh, 49).state.stats.factoryBestFloor, 49)
  const atFifty = applyFactoryAchievements(fresh, 50)
  assert.deepEqual(atFifty.unlocked.map((entry) => entry.id), ['factory-floor-50'])
  const atHundred = applyFactoryAchievements(atFifty.state, 100)
  assert.deepEqual(atHundred.unlocked.map((entry) => entry.id), ['factory-floor-100'])
  // Climbing past the last milestone is allowed but earns nothing more, and the
  // stored best never exceeds that ceiling.
  const beyond = applyFactoryAchievements(atHundred.state, 500)
  assert.equal(beyond.processed, false)
  assert.equal(beyond.state.stats.factoryBestFloor, 100)
  assert.equal(normalizeAchievementState({ stats: { factoryBestFloor: 9999 } }).stats.factoryBestFloor, 100)
})

check('a stored personal best unlocks its floor title retroactively and only once', () => {
  const first = applyFactoryAchievements(createAchievementState(), 73)
  assert.deepEqual(first.unlocked.map((entry) => entry.id), ['factory-floor-50'])
  const replay = applyFactoryAchievements(first.state, 73)
  assert.equal(replay.processed, false)
  assert.equal(replay.rewardVp, 0)
  // A later, worse run cannot take the record or the title away.
  const worse = applyFactoryAchievements(first.state, 12)
  assert.equal(worse.state.stats.factoryBestFloor, 73)
  assert.equal(worse.processed, false)
})

check('ranked titles follow the ball tiers above the opening one', () => {
  const ranked = ACHIEVEMENTS.filter((entry) => entry.category === 'ranked')
  assert.deepEqual(ranked.map((entry) => entry.id), ['ranked-greatball', 'ranked-ultraball', 'ranked-masterball'])
  assert.deepEqual(ranked.map((entry) => entry.titleId), ['rank-greatball', 'rank-ultraball', 'rank-masterball'])
  assert.deepEqual(ranked.map((entry) => getTrainerTitle(entry.titleId).name), ['슈퍼볼', '하이퍼볼', '마스터볼'])
  assert.deepEqual(ranked.map((entry) => entry.target), [1, 2, 3])
  const [pokeball, greatball, ultraball, masterball] = RANKED_TIERS
  assert.equal(pokeball.minPoints, 0, 'The opening tier earns no title')
  const fresh = createAchievementState()
  assert.equal(applyRankedAchievements(fresh, greatball.minPoints - 1).unlocked.length, 0)
  const atGreat = applyRankedAchievements(fresh, greatball.minPoints)
  assert.deepEqual(atGreat.unlocked.map((entry) => entry.id), ['ranked-greatball'])
  // Jumping straight to the top settles every tier below it in one call.
  const atMaster = applyRankedAchievements(fresh, masterball.minPoints)
  assert.deepEqual(atMaster.unlocked.map((entry) => entry.id), ['ranked-greatball', 'ranked-ultraball', 'ranked-masterball'])
  assert.equal(atMaster.state.stats.rankedTierIndex, 3)
  assert.equal(applyRankedAchievements(atMaster.state, ultraball.minPoints).processed, false,
    'Falling back down keeps the highest tier ever reached')
  assert.equal(normalizeAchievementState({ stats: { rankedTierIndex: 99 } }).stats.rankedTierIndex, 3)
})

check('an account that already cleared the ladder settles on the first observation', () => {
  // Nothing recorded yet, exactly like a save made before titles existed.
  const legacy = createAchievementState()
  assert.equal(legacy.stats.factoryBestFloor, 0)
  assert.equal(legacy.stats.rankedTierIndex, 0)
  const factory = applyFactoryAchievements(legacy, 100)
  assert.deepEqual(factory.unlocked.map((entry) => entry.id), ['factory-floor-50', 'factory-floor-100'])
  const ranked = applyRankedAchievements(factory.state, 1200)
  assert.deepEqual(ranked.unlocked.map((entry) => entry.id), ['ranked-greatball', 'ranked-ultraball', 'ranked-masterball'])
  assert.deepEqual(getEarnedTrainerTitles(ranked.state).map((entry) => entry.id),
    ['factory-50', 'factory-100', 'rank-greatball', 'rank-ultraball', 'rank-masterball'])
})

check('the new goals count toward the meta achievement and survive a reload', () => {
  const meta = byId.get('achievements-all')
  assert.equal(meta.target, ACHIEVEMENTS.length - 1)
  const state = applyRankedAchievements(applyFactoryAchievements(createAchievementState(), 100).state, 1200).state
  const restored = normalizeAchievementState(JSON.parse(JSON.stringify(state)))
  assert.equal(restored.stats.factoryBestFloor, 100)
  assert.equal(restored.stats.rankedTierIndex, 3)
  assert.equal(getAchievementProgress(meta, restored).current, 5)
  for (const id of ['factory-floor-50', 'factory-floor-100', 'ranked-greatball', 'ranked-ultraball', 'ranked-masterball']) {
    assert.equal(getAchievementProgress(byId.get(id), restored).completed, true)
  }
})

console.log(`Trainer titles: ${passed} passed, ${failures.length} failed.`)
if (failures.length) process.exitCode = 1
