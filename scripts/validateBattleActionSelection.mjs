import assert from 'node:assert/strict'
import test from 'node:test'
import {
  chooseAiActionsForSide, createBattle, getActivePokemon, getBattleMovePreview,
  getBattleMoveSelectionState, getBattleMoveTargets, getBattleStruggleAction,
  getForcedBattleAction, playBattleTurnWithActions,
} from '../src/data/battleEngine.js'
import { getLearnableMoves, getMoveById, SPECIES_PROFILES } from '../src/data/trainingData.js'

// Primary semantics: Pokemon Showdown data/moves.ts Encore condition and
// sim/side.ts chooseMove; https://github.com/smogon/pokemon-showdown.
// Species, move learnsets and held items below are selectable in the game.
let nextId = 0
const action = (moveIndex = 0, actorSlot = 0, extra = {}) => ({ type: 'move', moveIndex, actorSlot, targetSlot: 0, ...extra })
function pokemon(slug, ids, extra = {}) {
  const profile = Object.values(SPECIES_PROFILES).find(entry => entry.slug === slug)
  assert(profile, `Missing species ${slug}`)
  const legal = new Set(getLearnableMoves(profile.id).map(move => move.id))
  for (const id of ids) assert(legal.has(id), `${slug} cannot learn ${id}`)
  return { speciesId: profile.id, captureId: `selection-${++nextId}`, moves: ids.map(id => getMoveById(id).name), ...extra }
}
function battle(players = [pokemon('magikarp', ['splash', 'tackle'])], opponents = [pokemon('smeargle', ['splash'])], double = false) {
  return createBattle({ playerPokemon: players, opponent: { name: 'ACTION SELECTION AUDIT', tier: 'S' },
    opponentTeam: { pokemon: opponents, battleGimmicks: [], strategy: {} },
    rules: { format: { id: double ? 'double' : 'single', activeSlots: double ? 2 : 1, actionSlots: double ? 2 : 1 },
      weather: { id: 'clear' }, terrain: { id: 'neutral' }, teamRule: { id: 'full', battleSize: Math.max(players.length, opponents.length) } } })
}
const turn = (state, player = [action()], opponent = [action()]) => playBattleTurnWithActions(state, player, opponent, () => .5)
function encorePosition(fast = true) {
  let state = battle([pokemon('magikarp', ['splash', 'tackle']), pokemon('gyarados', ['tackle'])],
    [pokemon(fast ? 'alakazam' : 'smeargle', fast ? ['protect', 'encore'] : ['splash', 'encore'])])
  return turn(state)
}

test('faster Encore changes the already selected move on the same turn', () => {
  const before = encorePosition()
  const after = turn(before, [action(1)], [action(1)])
  assert.equal(after.player.team[0].lastMoveId, 'splash')
  assert.equal(after.player.team[0].moves[1].currentPp, before.player.team[0].moves[1].currentPp)
  assert.equal(after.player.team[0].encoreTurns, 2)
})
test('slower Encore lasts for three future move selections', () => {
  let state = turn(encorePosition(false), [action()], [action(1)])
  assert.equal(state.player.team[0].encoreTurns, 3)
  for (const remaining of [2, 1, 0]) {
    state = turn(state, [action(1)])
    assert.equal(state.player.team[0].lastMoveId, 'splash')
    assert.equal(state.player.team[0].encoreTurns, remaining)
  }
  state = turn(state, [action(1)])
  assert.equal(state.player.team[0].lastMoveId, 'tackle')
})
test('Encore restricts move selection without auto-playing or blocking a switch', () => {
  const before = turn(encorePosition(), [action()], [action(1)])
  assert.equal(getForcedBattleAction(before), null)
  assert.equal(getBattleMoveSelectionState(before, 'player', 0).disabled, false)
  assert.match(getBattleMoveSelectionState(before, 'player', 1).reason, /앵콜/)
  const after = turn(before, [{ type: 'switch', actorSlot: 0, targetIndex: 1 }])
  assert.equal(after.player.activeIndex, 1)
  assert.equal(after.player.team[0].encoreTurns, 0)
})
test('Encore ends when its move runs out of PP', () => {
  const before = turn(encorePosition(), [action()], [action(1)])
  before.player.team[0].moves[0].currentPp = 1
  const after = turn(before)
  assert.equal(after.player.team[0].encoreTurns, 0)
  assert.equal(after.player.team[0].encoredMoveIndex, null)
  assert.equal(getBattleMoveSelectionState(after, 'player', 1).disabled, false)
})
test('Encore fails when the previously used move has no PP', () => {
  const state = encorePosition()
  state.player.team[0].moves[0].currentPp = 0
  const after = turn(state, [action(1)], [action(1)])
  assert.equal(after.player.team[0].encoreTurns, 0)
  assert.equal(after.player.team[0].lastMoveId, 'tackle')
})
test('all depleted PP selects Struggle, does damage and recoil without touching PP', () => {
  const before = battle()
  before.player.team[0].moves.forEach(move => { move.currentPp = 0 })
  const selected = getBattleStruggleAction(before)
  assert.equal(selected.moveIndex, -1)
  assert.equal(getBattleMovePreview(before, 'player', -1).id, 'struggle')
  assert.equal(getBattleMovePreview(before, 'player', -1).target, 'randomNormal')
  assert.deepEqual(getBattleMoveTargets(before, 'player', -1), [])
  const snapshot = JSON.stringify(before)
  const after = turn(before, [selected])
  assert.equal(JSON.stringify(before), snapshot)
  assert.equal(after.player.team[0].lastMoveId, 'struggle')
  assert(after.opponent.team[0].hp < before.opponent.team[0].hp)
  assert.equal(before.player.team[0].hp - after.player.team[0].hp, Math.round(before.player.team[0].originalMaxHp / 4))
  assert(after.player.team[0].moves.every(move => move.currentPp === 0))
})
test('Struggle cannot be requested while an ordinary move is available', () => {
  const state = battle()
  assert.equal(getBattleStruggleAction(state), null)
  assert.equal(getBattleMoveSelectionState(state, 'player', -1).disabled, true)
  assert.notEqual(turn(state, [action(-1)]).player.team[0].lastMoveId, 'struggle')
})
test('a taunted Pokemon with only status moves can Struggle or switch', () => {
  const state = battle([pokemon('magikarp', ['splash']), pokemon('gyarados', ['tackle'])])
  state.player.team[0].moves.slice(1).forEach(move => { move.currentPp = 0 })
  state.player.team[0].tauntTurns = 3
  assert.match(getBattleMoveSelectionState(state).reason, /도발/)
  assert.equal(turn(state).player.team[0].lastMoveId, 'struggle')
  assert.equal(turn(state, [{ type: 'switch', targetIndex: 1 }]).player.activeIndex, 1)
})
test('Encore plus Disable falls back to Struggle rather than an endless blocked move', () => {
  const state = turn(encorePosition(), [action()], [action(1)])
  state.player.team[0].disabledMoveIndex = 0
  state.player.team[0].disabledMoveTurns = 4
  const after = turn(state)
  assert.equal(after.player.team[0].lastMoveId, 'struggle')
})
test('Choice lock with depleted locked PP permits repeated Struggle', () => {
  const state = battle([pokemon('magikarp', ['splash', 'tackle'], { heldItemId: 'choice-band' })])
  state.player.team[0].choiceLockedMoveIndex = 0
  state.player.team[0].moves[0].currentPp = 0
  assert.match(getBattleMoveSelectionState(state, 'player', 1).reason, /구애/)
  const after = turn(turn(state))
  assert.equal(after.player.team[0].lastMoveId, 'struggle')
  assert.equal(after.player.team[0].moves[1].currentPp, state.player.team[0].moves[1].currentPp)
})
test('all blocked AI moves use Struggle and forecast leaves the state unchanged', () => {
  const state = battle()
  state.opponent.team[0].moves.forEach(move => { move.currentPp = 0 })
  const before = JSON.stringify(state)
  const selected = chooseAiActionsForSide(state, 'opponent', () => .5)
  assert.equal(selected[0].moveIndex, -1)
  assert.equal(JSON.stringify(state), before)
  assert.equal(turn(state, [action()], selected).opponent.team[0].lastMoveId, 'struggle')
})
test('AI never selects a move outside Encore without a compatible escape gimmick', () => {
  const state = turn(encorePosition(), [action()], [action(1)])
  const choices = chooseAiActionsForSide(state, 'player', () => .5)
  for (const choice of choices) assert(choice.type === 'switch' || choice.moveIndex === 0 || ['zmove', 'dynamax'].includes(choice.gimmick))
})
test('double battle resolves Struggle for the depleted slot independently', () => {
  const state = battle([pokemon('magikarp', ['splash']), pokemon('gyarados', ['tackle'])],
    [pokemon('smeargle', ['splash']), pokemon('smeargle', ['splash'])], true)
  state.player.team[0].moves.forEach(move => { move.currentPp = 0 })
  assert(getBattleStruggleAction(state, 'player', 0))
  assert.equal(getBattleStruggleAction(state, 'player', 1), null)
  const after = turn(state, [action(0, 0), action(0, 1)], [action(0, 0), action(0, 1)])
  assert.equal(after.player.team[0].lastMoveId, 'struggle')
  assert.equal(after.player.team[1].lastMoveId, 'tackle')
})
test('a charging move continues with depleted PP and clears charge after paralysis', () => {
  const state = battle([pokemon('charizard', ['fly'])])
  const charged = turn(state)
  charged.player.team[0].moves[0].currentPp = 0
  assert.equal(getBattleStruggleAction(charged), null)
  assert.equal(getForcedBattleAction(charged).forcedReason, 'charge')
  const after = turn(charged)
  assert.equal(after.player.team[0].lastMoveId, 'fly')
  assert.equal(after.player.team[0].chargingMove, null)
  charged.player.team[0].status = { id: 'paralysis', counter: 0 }
  const stopped = playBattleTurnWithActions(charged, [action()], [action()], () => 0)
  assert.equal(stopped.player.team[0].chargingMove, null)
})
test('a recharge turn cannot be replaced with Struggle even at zero PP', () => {
  const state = battle([pokemon('snorlax', ['hyperbeam'])], [pokemon('blissey', ['softboiled'])])
  const charged = turn(state)
  assert.equal(charged.player.team[0].rechargeTurns, 1)
  charged.player.team[0].moves.forEach(move => { move.currentPp = 0 })
  assert.equal(getBattleStruggleAction(charged), null)
  assert.equal(getForcedBattleAction(charged).forcedReason, 'recharge')
  assert.equal(turn(charged).player.team[0].rechargeTurns, 0)
})
test('Dynamax bypasses Encore/Disable selection and never transforms Struggle', () => {
  const state = battle()
  const pokemon = getActivePokemon(state, 'player')
  pokemon.encoreTurns = 3; pokemon.encoredMoveIndex = 0
  pokemon.disabledMoveTurns = 3; pokemon.disabledMoveIndex = 1
  assert.equal(getBattleMoveSelectionState(state, 'player', 1).disabled, true)
  assert.equal(getBattleMoveSelectionState(state, 'player', 1, 0, 'dynamax').disabled, false)
  const after = turn(state, [action(1, 0, { gimmick: 'dynamax' })])
  assert.equal(after.player.team[0].dynamaxActive, true)
  assert.match(after.player.team[0].lastMoveId, /^max/)
  after.player.team[0].moves.forEach(move => { move.currentPp = 0 })
  assert.equal(getBattleMovePreview(after, 'player', -1).id, 'struggle')
  assert.equal(turn(after).player.team[0].lastMoveId, 'struggle')
})
test('PP, Assault Vest, Heal Block, Torment and Imprison expose selection reasons', () => {
  const state = battle([pokemon('smeargle', ['splash', 'recover', 'tackle'], { heldItemId: 'assault-vest' })])
  const user = state.player.team[0]
  assert.match(getBattleMoveSelectionState(state).reason, /돌격조끼/)
  user.heldItemId = ''; user.healBlockTurns = 2
  assert.match(getBattleMoveSelectionState(state, 'player', 1).reason, /회복봉인/)
  user.tormented = true; user.lastMoveIndex = 2
  assert.match(getBattleMoveSelectionState(state, 'player', 2).reason, /트집/)
  user.tormented = false; user.moves[2].currentPp = 0
  assert.match(getBattleMoveSelectionState(state, 'player', 2).reason, /PP/)
  state.opponent.team[0].imprisonActive = true
  assert.match(getBattleMoveSelectionState(state).reason, /봉인/)
})

test('an incompatible Z selection cannot unlock Struggle while base moves work', () => {
  const state = battle([pokemon('smeargle', ['charge', 'tackle', 'splash', 'recover'], { heldItemId: 'electrium-z--held' })])
  state.player.team[0].tauntTurns = 3
  assert(state.player.team[0].moves.every((move, index) => getBattleMoveSelectionState(state, 'player', index, 0, 'zmove').disabled))
  assert.equal(getBattleStruggleAction(state, 'player', 0, 'zmove'), null)
  state.player.team[0].moves.forEach(move => { move.currentPp = 0 })
  assert(getBattleStruggleAction(state, 'player', 0, 'zmove'))
  assert.equal(getBattleMovePreview(state, 'player', -1, 0, 0, 'zmove').id, 'struggle')
  assert.equal(getBattleMovePreview(state, 'player', -1, 0, 0, 'dynamax').id, 'struggle')
})
test('a compatible Z move can escape a complete Encore and Taunt lock', () => {
  const state = battle([pokemon('smeargle', ['thunderbolt', 'tackle', 'splash', 'recover'], { heldItemId: 'electrium-z--held' })])
  const user = state.player.team[0]
  user.encoreTurns = 2; user.encoredMoveIndex = 2; user.tauntTurns = 2
  assert(getBattleStruggleAction(state))
  assert.equal(getBattleStruggleAction(state, 'player', 0, 'zmove'), null)
  assert.equal(getBattleMoveSelectionState(state, 'player', 0, 0, 'zmove').disabled, false)
  const after = turn(state, [action(0, 0, { gimmick: 'zmove' })])
  assert.equal(after.player.usedMechanics.zmove, true)
  assert.notEqual(after.player.team[0].lastMoveId, 'struggle')
})
test('typeless Struggle hits Wonder Guard and does not activate Protean', () => {
  const state = battle([pokemon('greninja', ['watergun'], { ability: '변환자재' })], [pokemon('shedinja', ['harden'])])
  state.player.team[0].moves.forEach(move => { move.currentPp = 0 })
  assert.equal(getBattleMovePreview(state, 'player', -1).type, '???')
  const after = turn(state)
  assert(after.opponent.team[0].hp < state.opponent.team[0].hp)
  assert.equal(after.player.team[0].proteanUsed, false)
  assert.deepEqual(after.player.team[0].types, state.player.team[0].types)
})
test('Struggle ignores Normal STAB and does not give Color Change an invalid type', () => {
  const state = battle([pokemon('smeargle', ['splash'])], [pokemon('kecleon', ['recover'], { ability: '변색' })])
  state.player.team[0].moves.forEach(move => { move.currentPp = 0 })
  const withoutStab = structuredClone(state)
  withoutStab.player.team[0].types = ['물']
  const normalAfter = turn(state), waterAfter = turn(withoutStab)
  assert.equal(normalAfter.opponent.team[0].hp, waterAfter.opponent.team[0].hp)
  assert.deepEqual(normalAfter.opponent.team[0].types, state.opponent.team[0].types)
})
