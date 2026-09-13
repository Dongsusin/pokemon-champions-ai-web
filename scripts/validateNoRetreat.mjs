import assert from 'node:assert/strict'
import test from 'node:test'
import { chooseAiAction, createBattle, createBattleTurnTimeline, getBattleSwitchIndexes, playBattleTurnWithActions, resumeBattleTurnTimeline } from '../src/data/battleEngine.js'
import { SPECIES_PROFILES, getLearnableMoves, getMoveById } from '../src/data/trainingData.js'

// Rules checked 2026-09-14 against the primary Pokemon Showdown simulator:
// https://github.com/smogon/pokemon-showdown/blob/master/data/moves.ts (noretreat, meanlook, block, spiderweb)
// https://github.com/smogon/pokemon-showdown/blob/master/data/conditions.ts (trapped vs partiallytrapped)
// https://github.com/smogon/pokemon-showdown/blob/master/sim/pokemon.ts (tryTrap, copyVolatileFrom)
const profiles = new Map(Object.values(SPECIES_PROFILES).map(p => [p.slug, p]))
const statKeys = ['attack', 'defense', 'specialAttack', 'specialDefense', 'speed']
let serial = 0
function pokemon(slug, ids, options = {}) {
  const profile = profiles.get(slug)
  assert(profile, slug)
  const legal = new Set(getLearnableMoves(profile.id).map(move => move.id))
  for (const id of ids) assert(legal.has(id), `${slug} cannot learn ${id}`)
  const ability = options.ability ?? profile.abilities[0]
  assert(profile.abilities.includes(ability), `${slug} cannot have ${ability}`)
  return { speciesId: profile.id, captureId: `noretreat-${++serial}`, ability,
    moveIds: ids, moves: ids.map(id => getMoveById(id).name), ...options }
}
const quiet = () => pokemon('wailord', ['splash'])
const falinks = (options = {}) => pokemon('falinks', ['noretreat', 'focusenergy', 'protect', 'tackle'], options)
function battle(players = [falinks(), quiet()], opponents = [quiet(), quiet()]) {
  const state = createBattle({ playerPokemon: players, opponent: { name: 'No Retreat audit', tier: 'C' },
    opponentTeam: { pokemon: opponents, battleGimmicks: [], strategy: {} }, rules: {
      weather: { id: 'clear' }, terrain: { id: 'neutral' },
      format: { id: 'single', activeSlots: 1, actionSlots: 1 },
      teamRule: { id: 'full', battleSize: 6 }, aiDifficulty: { id: 'normal' },
    } })
  // Use the declared legal lead instead of the AI's matchup lead optimization.
  state.opponent.activeIndex = 0
  state.opponent.activeIndexes = [0]
  return state
}
const action = (moveIndex = 0, extra = {}) => ({ type: 'move', actorSlot: 0, moveIndex, targetSlot: 0, ...extra })
const swap = (targetIndex) => ({ type: 'switch', actorSlot: 0, targetIndex })
const turn = (state, players = [action()], opponents = []) => playBattleTurnWithActions(state, players, opponents, () => 0.5)
const stages = (state, side = 'player', index = 0) => statKeys.map(key => state[side].team[index].statStages[key])
const equalStages = (state, n, side = 'player', index = 0) => assert.deepEqual(stages(state, side, index), statKeys.map(() => n))
const spent = (before, after, side = 'player', index = 0) => before[side].team[index].moves[0].currentPp - after[side].team[index].moves[0].currentPp

for (const side of ['player', 'opponent']) test(`${side}: first No Retreat boosts each battle stat once and prevents voluntary switching`, () => {
  const before = side === 'player' ? battle() : battle([quiet(), quiet()], [falinks(), quiet()])
  const snapshot = structuredClone(before)
  const after = side === 'player' ? turn(before) : turn(before, [action()], [action()])
  equalStages(after, 1, side)
  assert.equal(after[side].team[0].statStages.accuracy, 0)
  assert.equal(after[side].team[0].statStages.evasion, 0)
  assert.equal(after[side].team[0].noRetreatActive, true)
  assert.deepEqual(getBattleSwitchIndexes(after, side), [])
  assert.equal(spent(before, after, side), 1)
  assert.deepEqual(before, snapshot)
  const denied = side === 'player' ? turn(after, [swap(1)]) : turn(after, [action()], [swap(1)])
  assert.equal(denied[side].activeIndexes[0], 0)
})

test('Repeat No Retreat fails before any stat boost, spends one PP, and emits a failed timeline', () => {
  const before = turn(battle())
  const { state: after, timeline } = createBattleTurnTimeline(before, [action()], () => 0.5, [])
  equalStages(after, 1)
  assert.equal(spent(before, after), 1)
  assert.equal(after.player.team[0].moveFailedThisTurn, true)
  assert(timeline.some(step => step.moveId === 'noretreat' && step.phase === 'resolve' && step.result === 'failed'))
  assert(after.log.some(entry => entry.message.includes('이미 배수의진')))
})

test('Resetting boosts with Haze does not remove the reuse restriction', () => {
  let state = battle(undefined, [pokemon('gengar', ['haze']), quiet()])
  state = turn(state)
  state = turn(state, [action(1)], [action()])
  equalStages(state, 0)
  const after = turn(state)
  equalStages(after, 0)
  assert.equal(after.player.team[0].noRetreatActive, true)
  assert.equal(after.player.team[0].moveFailedThisTurn, true)
})

test('Ghost Tera may switch after No Retreat but cannot repeat it while staying in battle', () => {
  const before = turn(battle([falinks({ teraType: '고스트' }), quiet()]), [action(0, { gimmick: 'tera' })])
  assert(before.player.team[0].types.includes('고스트'))
  equalStages(before, 1)
  assert.deepEqual(getBattleSwitchIndexes(before), [1])
  const repeated = turn(before)
  equalStages(repeated, 1)
  assert.equal(repeated.player.team[0].moveFailedThisTurn, true)
  const out = turn(repeated, [swap(1)])
  assert.equal(out.player.activeIndexes[0], 1)
  assert.equal(out.player.team[0].noRetreatActive, false)
})

test('Shed Shell allows switching; returning resets the No Retreat use restriction and stat stages', () => {
  const used = turn(battle([falinks({ heldItemId: 'shed-shell' }), quiet()]))
  assert.deepEqual(getBattleSwitchIndexes(used), [1])
  const out = turn(used, [swap(1)])
  assert.equal(out.player.activeIndexes[0], 1)
  assert.equal(out.player.team[0].noRetreatActive, false)
  const returned = turn(out, [swap(0)])
  equalStages(returned, 0)
  const after = turn(returned)
  equalStages(after, 1)
  assert.equal(after.player.team[0].noRetreatActive, true)
})

for (const [slug, trap] of [['gengar', 'meanlook'], ['snorlax', 'block'], ['ariados', 'spiderweb']]) {
  test(`${trap}: linked trapping allows repeated No Retreat boosts without adding its self-trap`, () => {
    const before = turn(battle(undefined, [pokemon(slug, [trap]), quiet()]), [action(1)], [action()])
    assert.equal(before.player.team[0].trappedByMoveSourceBattleId, before.opponent.team[0].battleId)
    assert.deepEqual(getBattleSwitchIndexes(before), [])
    const first = turn(before)
    equalStages(first, 1)
    assert.equal(first.player.team[0].noRetreatActive, false)
    const second = turn(first)
    equalStages(second, 2)
    assert.equal(second.player.team[0].noRetreatActive, false)
    assert.equal(second.player.team[0].moveFailedThisTurn, false)
    assert.equal(spent(first, second), 1)
  })
}

test('Existing Mean Look ends with its source leaving; the next No Retreat then adds its own restriction', () => {
  let state = turn(battle(undefined, [pokemon('gengar', ['meanlook']), quiet()]), [action(1)], [action()])
  state = turn(state)
  state = turn(state, [action(1)], [swap(1)])
  assert.equal(state.player.team[0].trappedByMoveSourceBattleId, null)
  assert.deepEqual(getBattleSwitchIndexes(state), [1])
  const after = turn(state)
  equalStages(after, 2)
  assert.equal(after.player.team[0].noRetreatActive, true)
  equalStages(turn(after), 2)
})

for (const cause of ['switch', 'faint']) test(`No Retreat remains after a later Mean Look source ${cause}`, () => {
  let state = turn(battle(undefined, [pokemon('snorlax', ['block']), quiet()]))
  state = turn(state, [action(1)], [action()])
  assert(state.player.team[0].trappedByMoveSourceBattleId)
  if (cause === 'faint') {
    state.opponent.team[0].hp = 1
    state = turn(state, [action(3)])
  } else state = turn(state, [action(1)], [swap(1)])
  assert.equal(state.player.team[0].trappedByMoveSourceBattleId, null)
  assert.equal(state.player.team[0].noRetreatActive, true)
  assert.deepEqual(getBattleSwitchIndexes(state), [])
  const repeated = turn(state)
  equalStages(repeated, 1)
  assert.equal(repeated.player.team[0].moveFailedThisTurn, true)
})

test('Wrap is partial binding, so it does not enable repeated No Retreat', () => {
  let state = turn(battle(undefined, [pokemon('dragonite', ['wrap']), quiet()]), [action(1)], [action()])
  assert(state.player.team[0].trappedTurns > 0)
  assert.equal(state.player.team[0].trapDamages, true)
  state = turn(state)
  equalStages(state, 1)
  assert.equal(state.player.team[0].noRetreatActive, true)
  const after = turn(state)
  equalStages(after, 1)
  assert.equal(after.player.team[0].moveFailedThisTurn, true)
})

test('Wrap expiry never frees No Retreat and does not turn a damaging bind into a permanent bind', () => {
  let state = turn(battle(undefined, [pokemon('dragonite', ['wrap']), quiet()]), [action(1)], [action()])
  state = turn(state)
  const boundHp = state.player.team[0].hp
  for (let i = 0; i < 5; i++) state = turn(state, [action(1)])
  assert.equal(state.player.team[0].trappedTurns, 0)
  assert(state.player.team[0].hp < boundHp)
  assert.equal(state.player.team[0].noRetreatActive, true)
  assert.deepEqual(getBattleSwitchIndexes(state), [])
  const next = turn(state, [action(1)])
  assert.equal(next.player.team[0].hp, state.player.team[0].hp)
})

test('A binding source switching out does not remove No Retreat', () => {
  let state = turn(battle(undefined, [pokemon('dragonite', ['wrap']), quiet()]), [action(1)], [action()])
  state = turn(state)
  state = turn(state, [action(1)], [swap(1)])
  assert.equal(state.player.team[0].trappedTurns, 0)
  assert.equal(state.player.team[0].noRetreatActive, true)
  assert.deepEqual(getBattleSwitchIndexes(state), [])
})

test('Octolock is a separate volatile and does not grant the linked-trapping repeat exception', () => {
  let state = turn(battle(undefined, [pokemon('grapploct', ['octolock']), quiet()]), [action(1)], [action()])
  assert.equal(state.player.team[0].octolockActive, true)
  state = turn(state)
  assert.equal(state.player.team[0].noRetreatActive, true)
  const before = stages(state)
  const after = turn(state)
  assert.equal(after.player.team[0].moveFailedThisTurn, true)
  assert.equal(stages(after)[0], before[0])
  assert.equal(stages(after)[2], before[2])
  assert.equal(stages(after)[4], before[4])
})

test('Shadow Tag is an ability trap and does not enable repeated No Retreat', () => {
  let state = battle(undefined, [pokemon('wobbuffet', ['splash'], { ability: '그림자밟기' }), quiet()])
  assert.deepEqual(getBattleSwitchIndexes(state), [])
  state = turn(state)
  equalStages(state, 1)
  assert.equal(state.player.team[0].noRetreatActive, true)
  equalStages(turn(state), 1)
})

test('Ghost targets are immune to Mean Look and therefore do not gain its repeat exception', () => {
  let state = battle([falinks({ teraType: '고스트' }), quiet()], [pokemon('gengar', ['meanlook']), quiet()])
  state = turn(state, [action(1, { gimmick: 'tera' })], [action()])
  assert(!state.player.team[0].trappedByMoveSourceBattleId)
  assert.equal(state.opponent.team[0].moveFailedThisTurn, true)
  const first = turn(state)
  const second = turn(first)
  equalStages(second, 1)
  assert.equal(second.player.team[0].moveFailedThisTurn, true)
  assert.deepEqual(getBattleSwitchIndexes(second), [1])
})

test('Mean Look and partial binding coexist; source release removes only its own trap', () => {
  const initial = battle([pokemon('smeargle', ['noretreat', 'focusenergy']), quiet()], [pokemon('smeargle', ['meanlook', 'wrap']), quiet()])
  let state = turn(initial, [action(1)], [action()])
  state = turn(state, [action(1)], [action(1)])
  assert(state.player.team[0].trappedByMoveSourceBattleId)
  assert(state.player.team[0].trapDamages)
  state = turn(state)
  equalStages(state, 1)
  assert.equal(state.player.team[0].noRetreatActive, false)
  state = turn(state, [action(1)], [swap(1)])
  assert.equal(state.player.team[0].trappedByMoveSourceBattleId, null)
  assert.equal(state.player.team[0].trappedTurns, 0)
  assert.deepEqual(getBattleSwitchIndexes(state), [1])
})

test('Rapid Spin clears partial binding but cannot clear No Retreat', () => {
  let state = turn(battle([pokemon('smeargle', ['noretreat', 'rapidspin']), quiet()]))
  state = turn(state, [action(1)])
  assert.equal(state.player.team[0].noRetreatActive, true)
  assert.deepEqual(getBattleSwitchIndexes(state), [])
  const before = stages(state)
  const after = turn(state)
  assert.deepEqual(stages(after), before)
  assert.equal(after.player.team[0].moveFailedThisTurn, true)
})

test('Baton Pass transfers No Retreat; the receiver cannot switch or reuse it', () => {
  let state = turn(battle([pokemon('smeargle', ['noretreat', 'batonpass']), falinks()]))
  state = turn(state, [action(1)])
  assert.equal(state.pendingPlayerSwitch?.kind, 'pivot')
  state = resumeBattleTurnTimeline(state, 1, () => 0.5).state
  assert.equal(state.player.activeIndexes[0], 1)
  assert.equal(state.player.team[0].noRetreatActive, false)
  assert.equal(state.player.team[1].noRetreatActive, true)
  equalStages(state, 1, 'player', 1)
  assert.deepEqual(getBattleSwitchIndexes(state), [])
  const after = turn(state)
  equalStages(after, 1, 'player', 1)
  assert.equal(after.player.team[1].moveFailedThisTurn, true)
})

test('AI chooses a legal attack instead of repeating its already active No Retreat', () => {
  const before = battle([quiet(), quiet()], [pokemon('falinks', ['noretreat', 'tackle']), quiet()])
  const state = turn(before, [action()], [action()])
  assert.equal(state.opponent.team[0].noRetreatActive, true)
  const selected = chooseAiAction(state, () => 0.5)
  assert.equal(selected.type, 'move')
  assert.equal(state.opponent.team[0].moves[selected.moveIndex].id, 'tackle')
})

test('AI may repeat No Retreat when existing linked trapping makes it legal', () => {
  const before = battle([pokemon('gengar', ['meanlook']), quiet()], [pokemon('falinks', ['noretreat', 'tackle']), quiet()])
  let state = turn(before, [action()], [action()])
  assert(state.opponent.team[0].trappedByMoveSourceBattleId)
  assert.equal(state.opponent.team[0].noRetreatActive, false)
  const selected = chooseAiAction(state, () => 0.5)
  assert.equal(selected.type, 'move')
  assert.equal(state.opponent.team[0].moves[selected.moveIndex].id, 'noretreat')
  state = turn(state, [action()], [selected])
  equalStages(state, 2, 'opponent')
})
