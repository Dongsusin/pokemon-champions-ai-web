import assert from 'node:assert/strict'
import test from 'node:test'
import { createBattle, createBattleTurnTimeline, getAvailableBattleMechanics, playBattleTurnWithActions } from '../src/data/battleEngine.js'
import { SPECIES_PROFILES, getLearnableMoves, getMoveById } from '../src/data/trainingData.js'

// Primary rule reference: Z-Mirror Move raises Attack by two before calling a move.
// https://github.com/smogon/pokemon-showdown/blob/master/data/moves.ts (mirrormove)
// https://github.com/smogon/pokemon-showdown/blob/master/sim/battle-actions.ts (runZPower)
const profiles = new Map(Object.values(SPECIES_PROFILES).map(profile => [profile.slug, profile]))
const rng = () => 0.5
let serial = 0
function pokemon(slug, moveIds, options = {}) {
  const profile = profiles.get(slug)
  assert(profile, `Missing ${slug}`)
  const legal = new Set(getLearnableMoves(profile.id).map(move => move.id))
  for (const id of moveIds) assert(legal.has(id), `${slug} cannot learn ${id}`)
  return { speciesId: profile.id, captureId: `z-mirror-${++serial}`, slug,
    ability: profile.abilities[0], moveIds,
    moves: moveIds.map(id => getMoveById(id).name), ...options }
}
const mirrorUser = () => pokemon('pidgeot', ['mirrormove', 'tackle'], { heldItemId: 'flyinium-z' })
const action = (moveIndex = 0, gimmick = 'zmove') => ({ type: 'move', actorSlot: 0, targetSlot: 0, moveIndex, gimmick })
function battle(player = mirrorUser(), opponent = pokemon('snorlax', ['tackle'])) {
  const state = createBattle({ playerPokemon: [player], opponent: { name: 'Z-MIRROR MOVE', tier: 'C' },
    opponentTeam: { pokemon: [opponent], battleGimmicks: [], strategy: {} }, rules: {
      weather: { id: 'clear' }, terrain: { id: 'neutral' },
      format: { id: 'single', activeSlots: 1, actionSlots: 1 },
      teamRule: { id: 'full', battleSize: 1 },
    } })
  return state
}
// Establish an actual previous move, rather than fabricating copied-move metadata.
const withHistory = (opponent) => playBattleTurnWithActions(battle(undefined, opponent), [action(1, null)], [action(0, null)], rng)
const execute = (state, gimmick = 'zmove') => createBattleTurnTimeline(state, [action(0, gimmick)], rng, [])
const user = state => state.player.team[0]
const zPowerSteps = timeline => timeline.filter(step => step.sideId === 'player' && step.result === 'z-power')
function assertSpentOnce(before, after) {
  assert.equal(user(after).moves[0].currentPp, user(before).moves[0].currentPp - 1)
  assert.equal(after.player.usedMechanics.zmove, true)
  assert.equal(user(after).usedBattleMechanicId, 'zmove')
  assert(!getAvailableBattleMechanics(after, 'player', 0).some(mechanic => mechanic.id === 'zmove'))
}

test('Z-Mirror Move raises Attack by two, spends one PP and cannot spend Z power twice', () => {
  const before = withHistory()
  const snapshot = structuredClone(before)
  const { state: after, timeline } = execute(before)
  assert.equal(user(after).statStages.attack, 2)
  assertSpentOnce(before, after)
  assert.equal(user(after).moves[1].currentPp, user(before).moves[1].currentPp)
  assert.equal(zPowerSteps(timeline).length, 1)
  assert.deepEqual(before, snapshot)
  const repeated = execute(after)
  assert.equal(user(repeated.state).statStages.attack, 2)
  assert.equal(zPowerSteps(repeated.timeline).length, 0)
})
test('The self-targeted Attack boost snapshot precedes copied physical damage', () => {
  const before = withHistory()
  const { state: after, timeline } = execute(before)
  const announce = timeline.findIndex(step => step.sideId === 'player' && step.phase === 'announce' && step.moveId === 'mirrormove')
  const boost = timeline.findIndex(step => step.sideId === 'player' && step.phase === 'status' && step.result === 'z-power')
  const impact = timeline.findIndex(step => step.sideId === 'player' && step.phase === 'impact')
  assert(announce >= 0 && boost === announce + 1 && impact > boost)
  const step = timeline[boost]
  assert.equal(step.targetSideId, 'player')
  assert.equal(step.targetSlot, step.actorSlot)
  assert.equal(step.targetName, step.actorName)
  assert.equal(step.targetSpeciesId, step.actorSpeciesId)
  assert.equal(user(step.state).statStages.attack, 2)
  assert.equal(step.state.opponent.team[0].hp, before.opponent.team[0].hp)
  assert.equal(user(timeline[impact].state).statStages.attack, 2)
  const ordinary = execute(before, null).state
  const boostedDamage = before.opponent.team[0].hp - after.opponent.team[0].hp
  const ordinaryDamage = before.opponent.team[0].hp - ordinary.opponent.team[0].hp
  assert(ordinaryDamage > 0 && boostedDamage > ordinaryDamage, 'The copied physical attack must use the raised Attack')
})

for (const [name, prepare] of [
  ['no previous move', () => battle()],
  ['an uncopyable previous move', () => withHistory(pokemon('magikarp', ['splash']))],
]) test(`Z-Mirror Move keeps its +2 boost when copying fails with ${name}`, () => {
  const before = prepare()
  const { state: after, timeline } = execute(before)
  assert.equal(user(after).statStages.attack, 2)
  assertSpentOnce(before, after)
  assert.equal(after.opponent.team[0].hp, before.opponent.team[0].hp)
  assert.equal(zPowerSteps(timeline).length, 1)
  const failed = timeline.findIndex(step => step.sideId === 'player' && step.moveId === 'mirrormove' && step.phase === 'resolve' && step.result === 'failed')
  assert(failed > timeline.indexOf(zPowerSteps(timeline)[0]))
  assert.equal(user(timeline[failed].state).statStages.attack, 2)
})

test('Ordinary Mirror Move copies damage without any Z boost or charge', () => {
  const before = withHistory()
  const { state: after, timeline } = execute(before, null)
  assert.equal(user(after).statStages.attack, 0)
  assert.equal(after.player.usedMechanics.zmove, false)
  assert.equal(user(after).moves[0].currentPp, user(before).moves[0].currentPp - 1)
  assert(after.opponent.team[0].hp < before.opponent.team[0].hp)
  assert.equal(zPowerSteps(timeline).length, 0)
})

test('Z-Mirror Move respects the +6 Attack cap from both +5 and +6', () => {
  for (const initial of [5, 6]) {
    const before = withHistory()
    user(before).statStages.attack = initial
    const { state: after, timeline } = execute(before)
    assert.equal(user(after).statStages.attack, 6)
    assertSpentOnce(before, after)
    assert.equal(zPowerSteps(timeline).length, 1)
    assert.equal(user(zPowerSteps(timeline)[0].state).statStages.attack, 6)
  }
})
test('Z-Splash still applies its Attack +3 bonus exactly once', () => {
  const before = battle(pokemon('magikarp', ['splash'], { heldItemId: 'normalium-z' }))
  const { state: after, timeline } = execute(before)
  assert.equal(user(after).statStages.attack, 3)
  assertSpentOnce(before, after)
  assert.equal(zPowerSteps(timeline).length, 1)
  assert.equal(user(zPowerSteps(timeline)[0].state).statStages.attack, 3)
})

test('Z-Swords Dance clears negative stages before its ordinary Attack +2 effect', () => {
  const before = battle(pokemon('scyther', ['swordsdance'], { heldItemId: 'normalium-z' }))
  Object.assign(user(before).statStages, { attack: -1, defense: -2, speed: 1 })
  const { state: after, timeline } = execute(before)
  assert.equal(user(after).statStages.attack, 2)
  assert.equal(user(after).statStages.defense, 0)
  assert.equal(user(after).statStages.speed, 1)
  assertSpentOnce(before, after)
  assert.equal(zPowerSteps(timeline).length, 1)
  assert.equal(user(zPowerSteps(timeline)[0].state).statStages.attack, 0)
})

test('Awake Z-Sleep Talk retains its critical bonus before the base move fails', () => {
  const before = battle(pokemon('snorlax', ['sleeptalk'], { heldItemId: 'normalium-z' }))
  const { state: after, timeline } = execute(before)
  assert.equal(user(after).criticalStageBoost, 2)
  assertSpentOnce(before, after)
  assert.equal(zPowerSteps(timeline).length, 1)
  const failed = timeline.findIndex(step => step.sideId === 'player' && step.moveId === 'sleeptalk' && step.phase === 'resolve' && step.result === 'failed')
  assert(failed > timeline.indexOf(zPowerSteps(timeline)[0]))
})
