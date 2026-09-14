import assert from 'node:assert/strict'
import test from 'node:test'
import { createBattle, playBattleTurnWithActions, chooseAiActionsForSide } from '../src/data/battleEngine.js'
import { getMoveById, canPokemonLearnMove, normalizePokemon } from '../src/data/trainingData.js'

// Showdown data/moves.ts: Sticky Web targets foeSide and triggers on grounded switch-ins.
// data/abilities.ts: Good as Gold blocks Status moves that hit another Pokemon.
let fixtureId = 0
function pokemon(speciesId, ids, options = {}) {
  const moves = ids.map(id => getMoveById(id).name)
  for (const move of moves) assert(canPokemonLearnMove(speciesId, move), `${speciesId}: illegal ${move}`)
  return normalizePokemon({ speciesId, captureId: `gold-hazard-${++fixtureId}`, moves, ...options })
}
function battle({ double = false, goldSlot = 0, moveIds = ['stickyweb', 'splash'], item = null, playerSpeciesId = 235 } = {}) {
  const gold = pokemon(1000, ['recover'], { heldItemId: item })
  const partner = pokemon(129, ['splash'])
  return createBattle({
    playerPokemon: [pokemon(playerSpeciesId, moveIds), pokemon(129, ['splash'])],
    opponent: { name: '황금몸 설치기 검증' },
    opponentTeam: { pokemon: goldSlot === 0 ? [gold, partner] : [partner, gold], battleGimmicks: [] },
    rules: { weather: { id: 'clear' }, terrain: { id: 'neutral' },
      format: { id: double ? 'double' : 'single', activeSlots: double ? 2 : 1, actionSlots: double ? 2 : 1 },
      teamRule: { id: 'full', battleSize: 2 }, pvp: true },
    random: () => 0.5,
  })
}
function turn(state, { moveIndex = 0, targetSlot = 0, opponentAction = null } = {}) {
  const player = [{ type: 'move', actorSlot: 0, moveIndex, targetSlot, targetSideId: 'opponent' }]
  const opponent = [opponentAction ?? { type: 'move', actorSlot: 0, moveIndex: 0 }]
  if (state.rules.format.id === 'double') {
    player.push({ type: 'move', actorSlot: 1, moveIndex: 0 })
    opponent.push({ type: 'move', actorSlot: 1, moveIndex: 0 })
  }
  return playBattleTurnWithActions(state, player, opponent, () => 0.5)
}

for (const [double, goldSlot] of [[false, 0], [true, 0], [true, 1]]) {
  test(`${double ? 'double' : 'single'} slot ${goldSlot}: Sticky Web installs once and spends one PP`, () => {
    const before = battle({ double, goldSlot })
    assert.equal(before.player.team[0].moves[0].target, 'foeSide')
    const after = turn(before, { targetSlot: goldSlot })
    assert.equal(after.opponent.hazards.stickyWeb, true)
    assert.equal(after.player.hazards.stickyWeb, false)
    assert.equal(before.opponent.hazards.stickyWeb, false)
    assert.equal(after.player.team[0].moves[0].currentPp, before.player.team[0].moves[0].currentPp - 1)
    assert.equal(after.opponent.team[goldSlot].statStages.speed, 0, 'already active Pokemon is unaffected')
  })
}

for (const [id, key, value] of [['spikes', 'spikes', 1], ['toxicspikes', 'toxicSpikes', 1], ['stealthrock', 'stealthRock', true]]) {
  test(`${id} also targets the side and bypasses Good as Gold`, () => {
    const after = turn(battle({ moveIds: [id, 'splash'] }))
    assert.equal(after.opponent.hazards[key], value)
  })
}

for (const item of [null, 'heavy-duty-boots', 'air-balloon']) {
  test(`Sticky Web on switch-in: ${item ?? 'grounded Good as Gold loses Speed'}`, () => {
    let state = turn(battle({ item }))
    assert.equal(state.opponent.hazards.stickyWeb, true)
    assert.equal(state.opponent.team[0].heldItemId, item)
    state = turn(state, { moveIndex: 1, opponentAction: { type: 'switch', actorSlot: 0, targetIndex: 1 } })
    assert.equal(state.opponent.activeIndex, 1)
    state = turn(state, { moveIndex: 1, opponentAction: { type: 'switch', actorSlot: 0, targetIndex: 0 } })
    assert.equal(state.opponent.activeIndex, 0)
    assert.equal(state.opponent.team[0].ability, '황금몸')
    assert.equal(state.opponent.team[0].statStages.speed, item ? 0 : -1)
  })
}

test('Good as Gold still blocks directly targeted Spore and Defog', () => {
  const before = battle({ moveIds: ['spore', 'defog'] })
  before.opponent.hazards.stickyWeb = true
  const afterSpore = turn(before)
  assert.equal(afterSpore.opponent.team[0].status, null)
  const afterDefog = turn(afterSpore, { moveIndex: 1 })
  assert.equal(afterDefog.opponent.hazards.stickyWeb, true)
  assert.equal(afterDefog.opponent.team[0].statStages.evasion, 0)
})

test('spread Growl is blocked only for the Good as Gold target', () => {
  const after = turn(battle({ double: true, moveIds: ['growl'] }))
  assert.equal(after.opponent.team[0].statStages.attack, 0)
  assert.equal(after.opponent.team[1].statStages.attack, -1)
})

for (const item of [null, 'ability-shield']) {
  test(`Mycelium Might bypasses Good as Gold unless Ability Shield is held: ${item ?? 'no item'}`, () => {
    const before = battle({ playerSpeciesId: 949, moveIds: ['spore'], item })
    assert.equal(before.player.team[0].ability, '균사의힘')
    const after = turn(before)
    assert.equal(after.opponent.team[0].status?.id ?? null, item ? null : 'sleep')
  })
}

test('Magic Bounce still reflects Sticky Web', () => {
  // Ability-isolation fixture: the target scope must not disable hazard reflection.
  const before = battle()
  before.opponent.team[0].ability = '매직미러'
  const after = turn(before)
  assert.equal(after.opponent.hazards.stickyWeb, false)
  assert.equal(after.player.hazards.stickyWeb, true)
})

test('AI chooses Sticky Web against Good as Gold instead of rejecting it as immune', () => {
  const before = battle({ moveIds: ['splash', 'stickyweb'] })
  const actions = chooseAiActionsForSide(before, 'player', () => 0.5)
  assert.equal(actions[0]?.type, 'move')
  assert.equal(actions[0]?.moveIndex, 1)
  const after = playBattleTurnWithActions(before, actions, [{ type: 'move', actorSlot: 0, moveIndex: 0 }], () => 0.5)
  assert.equal(after.opponent.hazards.stickyWeb, true)
})
