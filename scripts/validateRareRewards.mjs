import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  deriveRareRewardEntitlements, getRareReward, getUnlockedRareItems,
} from '../src/data/rareRewards.js'
import {
  ALL_BATTLE_ITEMS, BATTLE_ITEMS, attemptItemEquip, attemptItemPurchase,
  createCompleteBattleItemInventory, getBattleItem, getOwnedBattleItems,
  getVisibleBattleItems, normalizeItemInventory,
} from '../src/data/shopData.js'
import {
  SPECIES_PROFILES, calculateStats, getLearnableMoves, getMoveById, normalizePokemon,
} from '../src/data/trainingData.js'
import {
  createBattle, createBattleTurnTimeline, getBattleMovePreview, getTypeEffectiveness,
  playBattleTurnWithActions,
} from '../src/data/battleEngine.js'
import { TRAINERS } from '../src/data/trainerTeams.js'

let passed = 0
let sequence = 0
const failures = []
const profiles = new Map(Object.values(SPECIES_PROFILES).map((entry) => [entry.slug, entry]))
const fullProgress = { unlocked: Object.fromEntries([
  'flawless-league', 'flawless-tournament', 'collection-all', 'collection-shiny-all', 'achievements-all',
].map((id) => [id, 123])) }

// Exercise the actual private AI heuristic without adding a production API.
// Public AI action selection also simulates complete turns, which can conceal
// a wrong intermediate damage estimate by eventually choosing the right move.
const engineUrl = new URL('../src/data/battleEngine.js', import.meta.url)
const auditEngineSource = (await readFile(engineUrl, 'utf8'))
  .replace(/from (['"])(\.[^'"]+)\1/g, (_, quote, specifier) => (
    `from ${quote}${new URL(specifier, engineUrl).href}${quote}`
  ))
const { auditResolveAiMove, auditEstimateAiDamage } = await import(`data:text/javascript;base64,${Buffer.from(
  `${auditEngineSource}\nexport { resolveAiMove as auditResolveAiMove, estimateAiDamage as auditEstimateAiDamage };`,
).toString('base64')}`)

function test(name, run) {
  try { run(); passed += 1; console.log(`PASS ${name}`) }
  catch (error) { failures.push(name); console.error(`FAIL ${name}: ${error.stack}`) }
}
function pokemon(slug, moveIds = ['protect'], overrides = {}) {
  const profile = profiles.get(slug)
  assert(profile, `Unknown ${slug}`)
  const learnable = new Set(getLearnableMoves(profile.id).map((move) => move.id))
  for (const id of moveIds) assert(learnable.has(id), `${slug} cannot learn ${id}`)
  return normalizePokemon({
    captureId: `rare-test-${++sequence}`, speciesId: profile.id,
    moves: moveIds.map((id) => getMoveById(id).name), moveIds, ...overrides,
  })
}
function battle(player, targets = [pokemon('charizard')]) {
  return createBattle({ playerPokemon: player,
    opponent: { id: 'rare-test', name: 'RARE REWARD TEST' },
    opponentTeam: { pokemon: targets, battleGimmicks: [], strategy: {} },
  })
}
const action = (moveIndex = 0, gimmick = null) => ({ type: 'move', moveIndex, gimmick, actorSlot: 0, targetSlot: 0 })
const turn = (state, playerAction = action(), opposingActions = []) => playBattleTurnWithActions(state, [playerAction], opposingActions, () => 0.5)
const legendBattle = (target = 'charizard') => battle([pokemon('arceus', ['judgment', 'protect'], { heldItemId: 'legend-plate' })], [pokemon(target)])

test('hidden rewards have no entitlement until the exact achievement is earned', () => {
  assert.deepEqual(getUnlockedRareItems({}), [])
  assert.deepEqual(getUnlockedRareItems({ unlocked: { 'flawless-league': true } }), [])
  assert.deepEqual(deriveRareRewardEntitlements(fullProgress), { itemIds: ['legend-plate'] })
  assert.equal(getRareReward('legend-plate').kind, 'item')
  assert.equal(getRareReward('armored-mewtwo'), null, 'Cosmetic skins are trainer titles now')
  assert.equal(getRareReward('unknown'), null)
})

test('Legend Plate never enters normal purchase, complete inventory, or AI loadouts', () => {
  assert(!BATTLE_ITEMS.some((item) => item.id === 'legend-plate'))
  assert(ALL_BATTLE_ITEMS.some((item) => item.id === 'legend-plate'))
  assert.equal(createCompleteBattleItemInventory()['legend-plate'], undefined)
  assert.equal(attemptItemPurchase(999999, {}, 'legend-plate').reason, 'reward-only')
  assert(!getVisibleBattleItems({}).some((item) => item.id === 'legend-plate'))
  assert.equal(getOwnedBattleItems({ 'legend-plate': 1 })[0].id, 'legend-plate')
  assert(getVisibleBattleItems({ 'legend-plate': 1 }).some((item) => item.id === 'legend-plate'))
  assert.deepEqual(normalizeItemInventory({ 'legend-plate': 9 }), { 'legend-plate': 1 })
  assert.equal(createCompleteBattleItemInventory({ 'legend-plate': 1 })['legend-plate'], 1)
  assert(!TRAINERS.some((trainer) => trainer.teams.some((team) => team.pokemon.some((entry) => entry.heldItemId === 'legend-plate'))))
  const team = [pokemon('arceus')]
  assert.equal(attemptItemEquip(team, {}, team[0].captureId, 'legend-plate').ok, false)
  assert.equal(attemptItemEquip(team, { 'legend-plate': 1 }, team[0].captureId, 'legend-plate').ok, true)
})

test('Legend Plate previews the selected target without changing state, then changes body and attack type', () => {
  const state = legendBattle()
  const snapshot = JSON.stringify(state)
  const preview = getBattleMovePreview(state)
  assert.equal(preview.type, '바위')
  assert.equal(getTypeEffectiveness(preview.type, ['불꽃', '비행']), 4)
  assert.equal(JSON.stringify(state), snapshot)
  const beforeStats = { ...state.player.team[0].stats }
  const result = createBattleTurnTimeline(state, action(), () => 0.5)
  assert.equal(result.state.player.team[0].legendPlateType, '바위')
  assert.deepEqual(result.state.player.team[0].types, ['바위'])
  assert.deepEqual(result.state.player.team[0].stats, beforeStats)
  assert(result.timeline.some((entry) => entry.phase === 'announce' && entry.sideId === 'player' && entry.moveType === '바위'))
})

test('AI forecasts Judgment STAB without mutating state or changing Tera and Max body types', () => {
  const state = legendBattle()
  const attacker = state.player.team[0]
  const defender = state.opponent.team[0]
  defender.hp = defender.maxHp = defender.originalMaxHp = 3000
  const before = JSON.stringify(state)
  const forecast = auditResolveAiMove(state, attacker, defender, attacker.moves[0], null)
  assert.equal(forecast.move.type, '바위')
  assert.deepEqual(forecast.attacker.types, ['바위'])
  const estimate = auditEstimateAiDamage(state, forecast.attacker, defender, forecast.move)
  const result = turn(state)
  const actualAttacker = result.player.team[0]
  const expected = auditEstimateAiDamage(state, actualAttacker, defender, forecast.move)
  assert.equal(estimate.rawDamage, expected.rawDamage, 'AI must include the body change and STAB that execution applies')
  assert(estimate.rawDamage > 300, 'The Normal-type forecast incorrectly estimates only about 225 damage')
  assert.equal(JSON.stringify(state), before, 'Forecasting and turn execution must leave the source state intact')

  const teraAttacker = { ...attacker, teraActive: true, teraType: '물', types: ['물'] }
  const teraForecast = auditResolveAiMove(state, teraAttacker, defender, attacker.moves[0], null)
  assert.deepEqual(teraForecast.attacker.types, ['물'])
  const pendingTera = auditResolveAiMove(state, { ...attacker, teraType: '물' }, defender, attacker.moves[0], 'tera')
  assert.deepEqual(pendingTera.attacker.types, ['물'])
  const maxForecast = auditResolveAiMove(state, attacker, defender, attacker.moves[0], 'dynamax')
  assert.notEqual(maxForecast.move.id, 'judgment')
  assert.deepEqual(maxForecast.attacker.types, attacker.types)
  const suppressed = { ...attacker, magicRoomSuppressed: true }
  const suppressedForecast = auditResolveAiMove(state, suppressed, defender, attacker.moves[0], null)
  assert.deepEqual(suppressedForecast.attacker.types, ['노말'])
})

test('Legend Plate adapts again when the opponent changes and preserves chosen body type between actions', () => {
  const state = battle([pokemon('arceus', ['judgment', 'protect'], { heldItemId: 'legend-plate' })], [pokemon('charizard'), pokemon('garchomp')])
  state.opponent.activeIndex = 0
  state.opponent.activeIndexes = [0]
  state.opponent.team.forEach((entry) => { entry.hp = entry.maxHp = entry.originalMaxHp = 3000 })
  const next = turn(state)
  assert.deepEqual(next.player.team[0].types, ['바위'])
  const waiting = turn(next, action(1))
  assert.deepEqual(waiting.player.team[0].types, ['바위'])
  waiting.opponent.activeIndex = 1
  waiting.opponent.activeIndexes = [1]
  assert.equal(getBattleMovePreview(waiting).type, '얼음')
  assert.deepEqual(turn(waiting).player.team[0].types, ['얼음'])
})

test('Legend Plate avoids ability immunities and weather-blocked types', () => {
  const levitate = legendBattle('eelektross')
  assert.notEqual(getBattleMovePreview(levitate).type, '땅')
  const sun = legendBattle('rhyperior')
  sun.rules.weather.id = 'desolateland'
  const preview = getBattleMovePreview(sun)
  assert.equal(preview.type, '풀')
  assert.equal(getTypeEffectiveness(preview.type, sun.opponent.team[0].types), 4)
})

test('item suppression disables adaptive Judgment and other holders cannot use it', () => {
  for (const suppression of ['magicRoomSuppressed', 'consumedItem']) {
    const state = legendBattle()
    state.player.team[0][suppression] = true
    assert.equal(getBattleMovePreview(state).type, '노말')
    assert.equal(turn(state).player.team[0].legendPlateType, null)
  }
  const smeargle = battle([pokemon('smeargle', ['judgment'], { heldItemId: 'legend-plate' })])
  assert.equal(getBattleMovePreview(smeargle).type, '노말')
  assert.equal(turn(smeargle).player.team[0].legendPlateType, null)
})

test('Terastallization retains its body type while adaptive Judgment selects its own type', () => {
  const state = battle([pokemon('arceus', ['judgment'], { heldItemId: 'legend-plate', teraType: '물' })])
  const next = turn(state, action(0, 'tera'))
  assert.equal(next.player.team[0].teraActive, true)
  assert.deepEqual(next.player.team[0].types, ['물'])
  assert.equal(next.player.team[0].legendPlateType, '바위')
})

test('Legend Plate retains Arceus plate removal protection', () => {
  const state = legendBattle('weavile')
  state.opponent.team[0].moves = [{ ...getMoveById('knockoff'), maxPp: 20, currentPp: 20 }]
  const next = turn(state, action(1), [action()])
  assert.equal(next.player.team[0].heldItemId, 'legend-plate')
  assert.equal(next.player.team[0].consumedItem, false)
  assert.equal(getBattleItem('legend-plate').flingPower, 0)
})

console.log(`Rare rewards: ${passed} passed, ${failures.length} failed.`)
if (failures.length) process.exitCode = 1
