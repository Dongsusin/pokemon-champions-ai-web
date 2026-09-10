import assert from 'node:assert/strict'
import pokemonData from '../src/data/generatedPokemonData.json' with { type: 'json' }
import {
  createBattle,
  forcePlayerSwitch,
  getBattleSummary,
  playBattleTurnWithActions,
} from '../src/data/battleEngine.js'
import { getLearnableMoves, getMoveById } from '../src/data/trainingData.js'

// Legal species/moves use real turn resolution. Low HP fixtures represent a
// reached battle state, while explicit opposing actions isolate each condition.
const profiles = new Map([...pokemonData.species, ...pokemonData.forms].map((entry) => [entry.slug, entry]))
let fixtureId = 0
let passed = 0
const failures = []

function pokemon(slug, moveIds = ['protect'], overrides = {}) {
  const profile = profiles.get(slug)
  assert(profile, `Missing species ${slug}`)
  const learnable = new Set(getLearnableMoves(profile.id).map((move) => move.id))
  for (const moveId of moveIds) assert(learnable.has(moveId), `${slug} cannot learn ${moveId}`)
  return {
    captureId: `achievement-facts-${++fixtureId}`,
    speciesId: profile.id,
    slug,
    ability: profile.abilities[0],
    moves: moveIds.map((moveId) => getMoveById(moveId).name),
    moveIds,
    ...overrides,
  }
}

function battle(player, opponents = [pokemon('magikarp', ['splash'])], options = {}) {
  return createBattle({
    playerPokemon: player,
    opponent: { id: 'achievement-test-ai', name: 'ACHIEVEMENT FACTS', tier: 'S', region: 'kanto' },
    opponentTeam: { pokemon: opponents, battleGimmicks: [], strategy: {} },
    rules: {
      weather: { id: 'clear', label: '맑음' },
      terrain: { id: 'neutral', label: '일반 필드' },
      format: { id: options.double ? 'double' : 'single', activeSlots: options.double ? 2 : 1, actionSlots: options.double ? 2 : 1 },
      teamRule: { id: options.teamRule ?? 'full', battleSize: player.length },
      aiDifficulty: options.difficulty ?? { id: 'normal' },
      disabledGimmickId: options.disabledGimmickId ?? null,
    },
  })
}

const action = (moveIndex = 0, gimmick = null, actorSlot = 0) => ({ type: 'move', moveIndex, gimmick, actorSlot, targetSlot: 0 })
const turn = (state, actions = [action()], opposingActions = []) => playBattleTurnWithActions(state, actions, opposingActions, () => 0.5)
const facts = (state) => getBattleSummary(state).achievementFacts

function test(name, run) {
  try { run(); passed += 1; console.log(`PASS ${name}`) }
  catch (error) { failures.push({ name, error }); console.error(`FAIL ${name}: ${error.stack}`) }
}

test('completed ordinary victory preserves existing summary and captures starting roster', () => {
  const state = battle([pokemon('charizard', ['flamethrower'])])
  const before = facts(state)
  assert.equal(before.completed, false)
  assert.equal(before.playerTeamSize, 1)
  assert.equal(before.playerHeldItemCountAtStart, 0)
  assert.deepEqual(before.playerTeamTypes, [['불꽃', '비행']])
  assert.deepEqual(before.playerTeamSpeciesIds, [6])
  assert.deepEqual(before.playerUsedMechanics, [])
  state.opponent.team[0].hp = 1
  const result = getBattleSummary(turn(state))
  assert.equal(result.winner, 'player')
  assert.equal(result.playerRemaining, 1)
  assert.equal(result.opponentRemaining, 0)
  assert.equal(result.turns, 1)
  assert.equal(result.achievementFacts.completed, true)
  assert.equal(result.achievementFacts.playerFaintCount, 0)
  assert.equal(result.achievementFacts.opponentTeamSize, 1)
  assert.equal(result.achievementFacts.opponentId, 'achievement-test-ai')
  assert.equal(result.achievementFacts.opponentTier, 'S')
  assert.equal(result.achievementFacts.opponentRegion, 'kanto')
})

for (const fixture of [
  { id: 'mega', slug: 'charizard', item: 'charizardite-x', expectedTypes: ['불꽃', '비행'] },
  { id: 'tera', slug: 'charizard', teraType: '드래곤', expectedTypes: ['불꽃', '비행'] },
  { id: 'dynamax', slug: 'charizard', expectedTypes: ['불꽃', '비행'] },
  { id: 'zmove', slug: 'pikachu', item: 'electrium-z--held', move: 'thunderbolt', expectedTypes: ['전기'] },
  { id: 'primal', slug: 'groudon', item: 'red-orb', expectedTypes: ['땅'] },
]) {
  test(`${fixture.id} records actual activation while preserving original types/items`, () => {
    const state = battle([pokemon(fixture.slug, [fixture.move ?? 'protect'], {
      heldItemId: fixture.item ?? '', teraType: fixture.teraType, dynamaxMode: 'dynamax',
    })])
    const next = turn(state, [action(0, fixture.id)])
    assert.equal(next.player.usedMechanics[fixture.id], true)
    assert(facts(next).playerUsedMechanics.includes(fixture.id))
    assert.deepEqual(facts(state).playerUsedMechanics, [], 'Prior turn snapshot must remain unchanged')
    assert.deepEqual(facts(next).playerTeamTypes, [fixture.expectedTypes])
    assert.equal(facts(next).playerHeldItemCountAtStart, fixture.item ? 1 : 0)
  })
}

test('blocked gimmick request does not count as activation', () => {
  const state = battle([pokemon('charizard')], undefined, { disabledGimmickId: 'tera' })
  const next = turn(state, [action(0, 'tera')])
  assert.equal(next.player.team[0].teraActive, false)
  assert.deepEqual(facts(next).playerUsedMechanics, [])
})

test('expired Dynamax still prevents a no-gimmick achievement', () => {
  let state = battle([pokemon('charizard')])
  state = turn(state, [action(0, 'dynamax')])
  state = turn(state)
  state = turn(state)
  assert.equal(state.player.team[0].dynamaxActive, false)
  assert.deepEqual(facts(state).playerUsedMechanics, ['dynamax'])
})

test('a battle starting in a primal form cannot qualify as no-gimmick', () => {
  const state = battle([pokemon('groudon-primal')])
  assert.equal(state.player.team[0].speciesId, profiles.get('groudon-primal').id)
  assert(facts(state).playerUsedMechanics.includes('primal'))
})

test('entry-consumed Booster Energy remains in the starting held-item count', () => {
  const state = battle([pokemon('flutter-mane', ['protect'], { heldItemId: 'booster-energy' })])
  assert.equal(state.player.team[0].consumedItem, true)
  assert.equal(facts(state).playerHeldItemCountAtStart, 1)
  assert.equal(facts(turn(state)).playerHeldItemCountAtStart, 1)
})

test('a faint followed by Revival Blessing and victory remains non-flawless', () => {
  const initial = battle(
    [pokemon('electrode', ['explosion']), pokemon('rabsca', ['revivalblessing', 'psychic'])],
    [pokemon('gengar', ['protect'])],
  )
  const fainted = turn(initial)
  assert.equal(fainted.player.team[0].fainted, true)
  assert.equal(facts(fainted).playerFaintCount, 1, 'Repeated faint settling must not count the same faint twice')
  assert.equal(facts(initial).playerFaintCount, 0, 'Cloned turns must not alter earlier counter values')
  assert.equal(fainted.awaitingPlayerSwitch, true)
  const switched = forcePlayerSwitch(fainted, 1)
  const revived = turn(switched)
  assert.equal(revived.player.team[0].fainted, false)
  assert.equal(getBattleSummary(revived).playerRemaining, 2)
  assert.equal(facts(revived).playerFaintCount, 1)
  revived.opponent.team[0].hp = 1
  const won = turn(revived, [action(1)])
  assert.equal(won.winner, 'player')
  assert.equal(getBattleSummary(won).playerRemaining, 2)
  assert.equal(facts(won).playerFaintCount, 1)
  assert.equal(facts(won).completed, true)
})

test('the same revived Pokemon fainting again increments cumulative count', () => {
  let state = battle(
    [pokemon('electrode', ['explosion']), pokemon('rabsca', ['revivalblessing', 'psychic'])],
    [pokemon('gengar', ['protect'])],
  )
  state = forcePlayerSwitch(turn(state), 1)
  state = turn(state)
  state = turn(state, [{ type: 'switch', actorSlot: 0, targetIndex: 0 }])
  state = turn(state)
  assert.equal(state.player.team[0].fainted, true)
  assert.equal(facts(state).playerFaintCount, 2)
})

test('two active allies fainting in a doubles turn count exactly twice', () => {
  const state = battle(
    [pokemon('pikachu', ['growl']), pokemon('eevee', ['growl']), pokemon('rabsca')],
    [pokemon('garchomp', ['earthquake']), pokemon('gengar', ['darkpulse'])],
    { double: true, teamRule: 'pick3' },
  )
  state.player.team[0].hp = 1
  state.player.team[1].hp = 1
  const next = turn(state, [], [action(), { ...action(0, null, 1), targetSlot: 1 }])
  assert.equal(next.player.team[0].fainted, true)
  assert.equal(next.player.team[1].fainted, true)
  assert.equal(facts(next).playerFaintCount, 2)
  assert.equal(facts(next).formatId, 'double')
  assert.equal(facts(next).teamRuleId, 'pick3')
  assert.equal(facts(next).playerTeamSize, 3)
})

test('defeat and ongoing states expose completion accurately', () => {
  const state = battle([pokemon('magikarp', ['splash'])], [pokemon('pikachu', ['thunderbolt'])])
  state.player.team[0].hp = 1
  const next = turn(state, [action()], [action()])
  assert.equal(next.winner, 'opponent')
  assert.equal(facts(next).completed, true)
  assert.equal(facts(next).playerFaintCount, 1)
  assert.equal(facts(next).playerRemainingHpRatio, 0)
  assert.equal(facts(state).completed, false)
  state.winner = 'player'
  assert.equal(facts(state).completed, false, 'A winner field alone is insufficient without a settled complete phase')
})

test('difficulty and surviving HP facts are explicit and summary snapshots cannot mutate battle facts', () => {
  const state = battle([pokemon('charizard'), pokemon('venusaur')], undefined, { difficulty: { id: 'hard', boostStage: 3 } })
  state.player.team[0].hp = 1
  const result = facts(state)
  assert.equal(result.aiDifficultyId, 'hard')
  assert.equal(result.aiBoostStage, 3)
  assert.equal(result.playerRemainingHpRatio, 1 / state.player.team[0].maxHp)
  result.playerTeamTypes[0].push('고스트')
  result.playerTeamSpeciesIds.push(9999)
  assert.deepEqual(facts(state).playerTeamTypes[0], ['불꽃', '비행'])
  assert.equal(facts(state).playerTeamSpeciesIds.length, 2)
  const next = turn(state)
  next.player.achievementStart.teamTypes[0].push('악')
  assert.deepEqual(facts(state).playerTeamTypes[0], ['불꽃', '비행'], 'Battle clones must isolate nested participation snapshots')
})

test('legacy state with no participation history does not invent flawless/itemless eligibility', () => {
  const state = battle([pokemon('charizard')])
  delete state.player.achievementStart
  delete state.player.faintCount
  const result = facts(state)
  assert.equal(result.playerTeamSize, null)
  assert.equal(result.playerHeldItemCountAtStart, null)
  assert.equal(result.playerFaintCount, null)
})

console.log(`Battle achievement facts: ${passed} passed, ${failures.length} failed.`)
if (failures.length) process.exitCode = 1
