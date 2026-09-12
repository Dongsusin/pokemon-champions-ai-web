import assert from 'node:assert/strict'
import test from 'node:test'
import { createBattle, createBattleTurnTimeline, getForcedBattleAction, playBattleTurnWithActions } from '../src/data/battleEngine.js'
import { SPECIES_PROFILES, getLearnableMoves, getMoveById } from '../src/data/trainingData.js'

// Modern targeting rules, checked 2026-09-12 against Pokemon Showdown:
// sim/battle.ts getTarget/getRandomTarget; sim/pokemon.ts getMoveTargets;
// data/conditions.ts twoturnmove/commanding; data/moves.ts Sky Drop.
// https://github.com/smogon/pokemon-showdown/blob/master/sim/battle.ts
// https://github.com/smogon/pokemon-showdown/blob/master/sim/pokemon.ts
// https://github.com/smogon/pokemon-showdown/blob/master/data/conditions.ts
// https://github.com/smogon/pokemon-showdown/blob/master/data/moves.ts
const profiles = new Map(Object.values(SPECIES_PROFILES).map(p => [p.slug, p]))
let serial = 0
function pokemon(slug, moveIds, options = {}) {
  const profile = profiles.get(slug)
  assert(profile, slug)
  const learnable = new Set(getLearnableMoves(profile.id).map(move => move.id))
  for (const id of moveIds) assert(learnable.has(id), `${slug} cannot learn ${id}`)
  const ability = options.ability ?? profile.abilities[0]
  assert(profile.abilities.includes(ability), `${slug} cannot have ${ability}`)
  return { speciesId: profile.id, captureId: `retarget-${++serial}`, ability, moveIds,
    moves: moveIds.map(id => getMoveById(id).name), ...options }
}
const idle = () => pokemon('wailord', ['splash'])
const foe = () => pokemon('snorlax', ['protect'])
function battle(players, opponents = [foe(), foe()], activeSlots = 2) {
  const state = createBattle({ playerPokemon: players, opponent: { name: 'Retarget audit', tier: 'S' },
    opponentTeam: { pokemon: opponents, battleGimmicks: [] }, rules: {
      weather: { id: 'clear', label: '맑음' }, terrain: { id: 'neutral', label: '일반' },
      format: { id: activeSlots === 3 ? 'triple' : 'double', activeSlots, actionSlots: activeSlots },
      teamRule: { id: 'full', battleSize: 6 }, aiDifficulty: { id: 'normal' },
    } })
  state.opponent.activeIndexes = opponents.slice(0, activeSlots).map((_, index) => index)
  state.opponent.activeIndex = 0
  return state
}
const move = (actorSlot, targetSlot = 0, moveIndex = 0, targetSideId = 'opponent') => ({ type: 'move', actorSlot, targetSlot, moveIndex, targetSideId })
const commands = (state, side, actions) => actions.map(action => {
  const pokemon = state[side].team[state[side].activeIndexes[action.actorSlot]]
  return action.type === 'move' && pokemon?.moves[action.moveIndex]?.target === 'self'
    ? { ...action, targetSideId: side, targetSlot: action.actorSlot } : action
})
const turn = (state, playerActions, opponentActions = [], random = () => 0.5) => playBattleTurnWithActions(state,
  commands(state, 'player', playerActions), commands(state, 'opponent', opponentActions), random)
const spent = (before, after, side, slot, index = 0) => before[side].team[slot].moves[index].currentPp - after[side].team[slot].moves[index].currentPp
const duo = () => [pokemon('alakazam', ['psychic']), pokemon('garchomp', ['dragonclaw'])]

for (const side of ['player', 'opponent']) for (const targetSlot of [0, 1]) {
  test(`${side}: second selected attack retargets after slot ${targetSlot} faints`, () => {
    const other = side === 'player' ? 'opponent' : 'player'
    const before = side === 'player' ? battle(duo()) : battle([idle(), idle()], duo())
    before[other].team[targetSlot].hp = 1
    const original = structuredClone(before)
    const actions = [move(0, targetSlot, 0, other), move(1, targetSlot, 0, other)]
    const after = side === 'player' ? turn(before, actions) : turn(before, [move(0), move(1)], actions)
    assert.equal(after[other].team[targetSlot].hp, 0)
    assert(after[other].team[1 - targetSlot].hp < before[other].team[1 - targetSlot].hp)
    for (const index of [0, 1]) assert.equal(spent(before, after, side, index), 1)
    assert.equal(after[side].team[1].moveFailedThisTurn, false)
    assert.deepEqual(before, original)
  })
}

test('Retargeted announce and impact identify the living slot and the second actor', () => {
  const before = battle(duo(), [idle(), idle()])
  before.opponent.team[0].hp = 1
  const { state, timeline } = createBattleTurnTimeline(before, [move(0), move(1)], () => 0.5,
    commands(before, 'opponent', [move(0, 0, 0, 'player'), move(1, 0, 0, 'player')]))
  const steps = timeline.filter(step => step.sideId === 'player' && step.actorSlot === 1 && step.moveId === 'dragonclaw')
  assert(steps.some(step => step.phase === 'announce'))
  assert(steps.some(step => step.phase === 'impact' && step.damage > 0))
  assert(steps.every(step => step.targetSideId === 'opponent' && step.targetSlot === 1))
  assert(state.opponent.team[1].hp < before.opponent.team[1].hp)
})

test('Retargeting also works for a legacy action without explicit targetSideId', () => {
  const before = battle(duo())
  before.opponent.team[1].hp = 1
  const actions = [move(0, 1), move(1, 1)].map(({ targetSideId, ...action }) => action)
  const after = turn(before, actions)
  assert(after.opponent.team[0].hp < before.opponent.team[0].hp)
})

test('Protect on the selected living target does not redirect damage to its partner', () => {
  const before = battle([pokemon('garchomp', ['dragonclaw']), idle()])
  const after = turn(before, [move(0), move(1)], [move(0, 0, 0, 'player')])
  assert.deepEqual(after.opponent.team.map(p => p.hp), before.opponent.team.map(p => p.hp))
  assert.equal(spent(before, after, 'player', 0), 1)
})

test('A target using Fly remains the target and the attack misses without hitting its ally', () => {
  const before = battle([pokemon('snorlax', ['tackle']), idle()], [pokemon('charizard', ['fly']), foe()])
  const after = turn(before, [move(0), move(1)], [move(0, 0, 0, 'player')])
  assert.equal(after.opponent.team[0].semiInvulnerable, 'airborne')
  assert.deepEqual(after.opponent.team.map(p => p.hp), before.opponent.team.map(p => p.hp))
  assert.equal(spent(before, after, 'player', 0), 1)
})

test('A Ground-immune living target does not cause retargeting to a vulnerable partner', () => {
  const before = battle([pokemon('garchomp', ['earthpower']), idle()], [pokemon('charizard', ['protect']), foe()])
  const after = turn(before, [move(0), move(1)])
  assert.deepEqual(after.opponent.team.map(p => p.hp), before.opponent.team.map(p => p.hp))
})

test('A selected slot that switches is attacked at its new occupant, without jumping slots', () => {
  const before = battle([pokemon('garchomp', ['dragonclaw']), idle()], [foe(), foe(), pokemon('slowbro', ['protect'])])
  const after = turn(before, [move(0), move(1)], [{ type: 'switch', actorSlot: 0, targetIndex: 2 }])
  assert(after.opponent.team[2].hp < before.opponent.team[2].hp)
  assert.equal(after.opponent.team[0].hp, before.opponent.team[0].hp)
  assert.equal(after.opponent.team[1].hp, before.opponent.team[1].hp)
})

test('A selected Tatsugiri swallowed after Dondozo switches in is not replaced by Dondozo as target', () => {
  const before = battle([pokemon('tatsugiri', ['protect'], { ability: '사령탑' }), idle(), pokemon('dondozo', ['protect'])],
    [pokemon('garchomp', ['dragonclaw']), idle()])
  assert.equal(before.player.team[0].commanding, false)
  const after = turn(before, [move(0), { type: 'switch', actorSlot: 1, targetIndex: 2 }], [move(0, 0, 0, 'player')])
  assert.equal(after.player.team[0].commanding, true)
  assert.equal(after.player.team[0].hp, before.player.team[0].hp)
  assert.equal(after.player.team[2].hp, before.player.team[2].hp)
  assert.equal(spent(before, after, 'opponent', 0), 1)
})

test('Triple retargeting from an edge can only choose the remaining adjacent foe', () => {
  const before = battle([pokemon('garchomp', ['dragonclaw']), pokemon('alakazam', ['psychic']), idle()], [foe(), foe(), foe()], 3)
  before.opponent.team[1].hp = 1
  const after = turn(before, [move(0, 1), move(1, 1), move(2)])
  assert.equal(after.opponent.team[1].hp, 0)
  assert(after.opponent.team[2].hp < before.opponent.team[2].hp)
  assert.equal(after.opponent.team[0].hp, before.opponent.team[0].hp)
})

test('Triple retargeting samples either legal foe, rather than always choosing the first slot', () => {
  const destinations = new Set()
  for (const roll of [0.01, 0.99]) {
    const before = battle([pokemon('alakazam', ['psychic']), pokemon('garchomp', ['dragonclaw']), idle()], [foe(), foe(), foe()], 3)
    before.opponent.team[1].hp = 1
    const after = turn(before, [move(0, 1), move(1, 1), move(2)], [], () => roll)
    for (const index of [0, 2]) if (after.opponent.team[index].hp < before.opponent.team[index].hp) destinations.add(index)
  }
  assert.deepEqual([...destinations].sort(), [0, 2])
})

test('Triple attack with no adjacent surviving foe fails with PP spent instead of hitting far foe or ally', () => {
  const before = battle([pokemon('garchomp', ['dragonclaw']), pokemon('alakazam', ['psychic']), pokemon('regieleki', ['thunderbolt'])],
    [foe(), foe(), foe()], 3)
  before.opponent.team[1].hp = 1
  before.opponent.team[2].hp = 1
  const after = turn(before, [move(0, 1), move(1, 2), move(2, 1)])
  assert.equal(after.opponent.team[1].hp, 0)
  assert.equal(after.opponent.team[2].hp, 0)
  assert.equal(after.opponent.team[0].hp, before.opponent.team[0].hp)
  assert.deepEqual(after.player.team.map(p => p.hp), before.player.team.map(p => p.hp))
  assert.equal(spent(before, after, 'player', 0), 1)
  assert.equal(after.player.team[0].moveFailedThisTurn, true)
})

test('A fainted ally selected for Heal Pulse is not replaced by the user, another ally, or a foe', () => {
  const before = battle([pokemon('slowbro', ['healpulse']), idle(), pokemon('alakazam', ['psychic'])], [foe(), foe(), foe()], 3)
  before.player.team[0].hp -= 40
  before.player.team[1].hp = 1
  const after = turn(before, [move(0, 1, 0, 'player'), move(1), move(2, 1, 0, 'player')])
  assert.equal(after.player.team[1].hp, 0)
  assert.equal(after.player.team[0].hp, before.player.team[0].hp)
  assert.deepEqual(after.opponent.team.map(p => p.hp), before.opponent.team.map(p => p.hp))
  assert.equal(spent(before, after, 'player', 0), 1)
})

test('Acupressure has the modern adjacentAllyOrSelf exception: a fainted chosen ally redirects to self', () => {
  const before = battle([pokemon('shuckle', ['acupressure']), idle(), pokemon('alakazam', ['psychic'])], [foe(), foe(), foe()], 3)
  before.player.team[1].hp = 1
  const after = turn(before, [move(0, 1, 0, 'player'), move(1), move(2, 1, 0, 'player')])
  assert.equal(after.player.team[1].hp, 0)
  assert.equal(Object.values(after.player.team[0].statStages).reduce((a, b) => a + b, 0), 2)
  assert.equal(Object.values(after.player.team[2].statStages).reduce((a, b) => a + b, 0), 0)
  assert.equal(spent(before, after, 'player', 0), 1)
})

test('Fly second turn retargets a fainted foe and does not spend PP a second time', () => {
  const initial = battle([pokemon('charizard', ['fly']), pokemon('garchomp', ['protect', 'dragonclaw'])])
  initial.opponent.team[0].hp = 1
  const before = turn(initial, [move(0), move(1)])
  assert.equal(getForcedBattleAction(before, 'player', 0).forcedReason, 'charge')
  const after = turn(before, [move(0), move(1, 0, 1)])
  assert.equal(after.opponent.team[0].hp, 0)
  assert(after.opponent.team[1].hp < before.opponent.team[1].hp)
  assert.equal(spent(before, after, 'player', 0), 0)
  assert.equal(after.player.team[0].chargingMove, null)
})

test('A charged Fly aimed at an ally does not jump to enemies after that ally faints', () => {
  const initial = battle([pokemon('charizard', ['fly']), idle(), pokemon('garchomp', ['protect', 'dragonclaw'])], [foe(), foe(), foe()], 3)
  initial.player.team[1].hp = 1
  const before = turn(initial, [move(0, 1, 0, 'player'), move(1), move(2)])
  const after = turn(before, [move(0), move(1), move(2, 1, 1, 'player')])
  assert.equal(after.player.team[1].hp, 0)
  assert.deepEqual(after.opponent.team.map(p => p.hp), before.opponent.team.map(p => p.hp))
  assert.equal(spent(before, after, 'player', 0), 0)
  assert.equal(after.player.team[0].chargingMove, null)
})

test('A multi-hit move stops when its target faints instead of moving remaining hits to another foe', () => {
  const before = battle([pokemon('cloyster', ['iciclespear'], { ability: '스킬링크' }), idle()])
  before.opponent.team[0].hp = 1
  const after = turn(before, [move(0), move(1)])
  assert.equal(after.opponent.team[0].hp, 0)
  assert.equal(after.opponent.team[1].hp, before.opponent.team[1].hp)
  assert.equal(spent(before, after, 'player', 0), 1)
})

test('Sky Drop does not replace its grabbed victim after Thunder knocks that victim out', () => {
  const initial = battle([pokemon('aerodactyl', ['skydrop']), pokemon('regieleki', ['protect', 'thunder'])],
    [pokemon('pikachu', ['protect']), foe()])
  initial.opponent.team[0].hp = 1
  const before = turn(initial, [move(0), move(1)])
  assert.equal(before.player.team[0].chargingMove?.moveId, 'skydrop')
  assert.equal(before.opponent.team[0].skyDropSourceBattleId, before.player.team[0].battleId)
  const after = turn(before, [move(0), move(1, 0, 1)])
  assert.equal(after.opponent.team[0].hp, 0)
  assert.equal(after.opponent.team[1].hp, before.opponent.team[1].hp)
  assert.equal(spent(before, after, 'player', 0), 0)
  assert.equal(after.player.team[0].chargingMove, null)
  assert.equal(after.player.team[0].skyDropTargetBattleId, null)
})
