import assert from 'node:assert/strict'
import test from 'node:test'
import { createBattle, playBattleTurnWithActions, getBattleMoveSelectionState } from '../src/data/battleEngine.js'
import { SPECIES_PROFILES, getLearnableMoves, getMoveById } from '../src/data/trainingData.js'

// Primary rules: pokemon-showdown/data/moves.ts (strengthsap), data/items.ts
// (bigroot), data/abilities.ts (liquidooze) and sim/battle.ts (modify/rounding).
// Fixtures use the game's actual selectable species, abilities and learnsets.
const profiles = Object.values(SPECIES_PROFILES)
let serial = 0
function pokemon(slug, moveIds, overrides = {}) {
  const profile = profiles.find(candidate => candidate.slug === slug)
  assert(profile, `Missing species: ${slug}`)
  const learnable = new Set(getLearnableMoves(profile.id).map(move => move.id))
  for (const id of moveIds) assert(learnable.has(id), `${slug} must legally retain ${id}`)
  if (overrides.ability) assert(profile.abilities.includes(overrides.ability), `${slug} cannot have ${overrides.ability}`)
  return { captureId: `strength-sap-${++serial}`, speciesId: profile.id,
    moves: moveIds.map(id => getMoveById(id).name), ...overrides }
}
function battle({ target = 'azumarill', targetMove = 'defensecurl', targetOptions = {}, userOptions = {}, doubles = false,
  ally = 'magikarp', allyMove = 'splash', allyOptions = {} } = {}) {
  const playerPokemon = [pokemon('jellicent', ['strengthsap', 'protect'], userOptions)]
  const opponents = [pokemon(target, [targetMove, ...(targetMove === 'protect' ? [] : ['protect'])], targetOptions)]
  if (doubles) {
    playerPokemon.push(pokemon(ally, [allyMove], allyOptions))
    opponents.push(pokemon('magikarp', ['splash']))
  }
  return createBattle({ playerPokemon, opponent: { name: 'STRENGTH SAP VALIDATION' },
    opponentTeam: { pokemon: opponents, battleGimmicks: [] }, rules: {
      weather: { id: 'clear' }, terrain: { id: 'neutral' },
      format: { id: doubles ? 'double' : 'single', activeSlots: doubles ? 2 : 1, actionSlots: doubles ? 2 : 1 },
      teamRule: { id: 'full', battleSize: doubles ? 2 : 1 },
    } })
}
function turn(state, { targetSlot = 0, targetSideId = 'opponent', opponentMoveIndex = 0 } = {}) {
  const doubles = state.rules.format.activeSlots === 2
  const playerActions = [{ type: 'move', actorSlot: 0, moveIndex: 0, targetSlot, targetSideId }]
  const opponentActions = [{ type: 'move', actorSlot: 0, moveIndex: opponentMoveIndex, targetSlot: 0 }]
  if (doubles) {
    playerActions.push({ type: 'move', actorSlot: 1, moveIndex: 0, targetSlot: 0 })
    opponentActions.push({ type: 'move', actorSlot: 1, moveIndex: 0, targetSlot: 0 })
  }
  return playBattleTurnWithActions(state, playerActions, opponentActions, () => 0.5)
}
const multiplier = stage => stage < 0 ? 2 / (2 - stage) : (2 + stage) / 2
const attackBeforeDrop = target => Math.floor(target.stats.attack * multiplier(target.statStages.attack))
const bigRootAmount = amount => Math.floor((amount * 5324 + 2047) / 4096)
const healedHp = (user, amount) => Math.min(user.maxHp, user.hp + amount)

test('actual Jellicent retains Strength Sap through battle construction and heals from a full-HP enemy', () => {
  const before = battle()
  before.player.team[0].hp = 1
  assert.equal(before.player.team[0].moves[0].id, 'strengthsap')
  assert.equal(before.player.team[0].moves[0].target, 'normal')
  const frozen = JSON.stringify(before)
  const expected = healedHp(before.player.team[0], attackBeforeDrop(before.opponent.team[0]))
  const after = turn(before)
  assert.equal(JSON.stringify(before), frozen)
  assert.equal(after.player.team[0].hp, expected)
  assert.equal(after.opponent.team[0].hp, before.opponent.team[0].hp, 'Sap drains no target HP')
  assert.equal(after.opponent.team[0].statStages.attack, -1)
  assert.equal(after.player.team[0].moves[0].currentPp, before.player.team[0].moves[0].currentPp - 1)
  assert(after.log.some(log => log.message.includes('힘흡수으로 HP를')))
})

for (const stage of [-5, -2, 0, 2, 6]) {
  test(`recovery uses target Attack stage ${stage} before lowering it`, () => {
    const before = battle({ targetOptions: { ability: '천하장사', heldItemId: 'choice-band' } })
    before.player.team[0].hp = 1
    before.opponent.team[0].statStages.attack = stage
    const after = turn(before)
    assert.equal(after.player.team[0].hp, healedHp(before.player.team[0], attackBeforeDrop(before.opponent.team[0])))
    assert.equal(after.opponent.team[0].statStages.attack, stage - 1)
  })
}

test('full HP still allows the Attack drop, while -6 fails even against Contrary', () => {
  const full = battle()
  const lowered = turn(full)
  assert.equal(lowered.player.team[0].hp, full.player.team[0].hp)
  assert.equal(lowered.opponent.team[0].statStages.attack, -1)
  assert.equal(lowered.player.team[0].moveFailedThisTurn, false)
  for (const target of ['azumarill', 'malamar']) {
    const before = battle({ target, targetMove: target === 'malamar' ? 'calmmind' : 'defensecurl',
      targetOptions: target === 'malamar' ? { ability: '심술꾸러기' } : {} })
    before.player.team[0].hp = 1
    before.opponent.team[0].statStages.attack = -6
    const after = turn(before)
    assert.equal(after.player.team[0].hp, 1)
    assert.equal(after.opponent.team[0].statStages.attack, -6)
    assert.equal(after.player.team[0].moveFailedThisTurn, true)
  }
})

test('Clear Body, Clear Amulet and Mist block the drop but do not prevent recovery', () => {
  for (const block of ['ability', 'item', 'mist']) {
    const before = battle(block === 'ability'
      ? { target: 'metagross', targetMove: 'irondefense', targetOptions: { ability: '클리어바디' } }
      : { targetOptions: block === 'item' ? { heldItemId: 'clear-amulet' } : {} })
    before.player.team[0].hp = 1
    if (block === 'mist') before.opponent.mistTurns = 3
    const after = turn(before)
    assert.equal(after.player.team[0].hp, healedHp(before.player.team[0], attackBeforeDrop(before.opponent.team[0])), block)
    assert.equal(after.opponent.team[0].statStages.attack, 0, block)
    assert.equal(after.player.team[0].moveFailedThisTurn, false, block)
  }
})

test('full HP and a blocked Attack drop correctly record a failed move', () => {
  const before = battle({ target: 'metagross', targetMove: 'irondefense', targetOptions: { ability: '클리어바디' } })
  const after = turn(before)
  assert.equal(after.player.team[0].hp, before.player.team[0].hp)
  assert.equal(after.opponent.team[0].statStages.attack, 0)
  assert.equal(after.player.team[0].moveFailedThisTurn, true)
})

test('Contrary and Defiant reactions do not change the amount captured before the drop', () => {
  for (const target of ['malamar', 'bisharp']) {
    const before = battle({ target, targetMove: target === 'malamar' ? 'calmmind' : 'irondefense',
      targetOptions: { ability: target === 'malamar' ? '심술꾸러기' : '오기' } })
    before.player.team[0].hp = 1
    const after = turn(before)
    assert.equal(after.player.team[0].hp, healedHp(before.player.team[0], attackBeforeDrop(before.opponent.team[0])))
    assert.equal(after.opponent.team[0].statStages.attack, 1)
  }
})

test('Big Root uses the official 5324/4096 rounded recovery amount', () => {
  const before = battle({ userOptions: { heldItemId: 'big-root' } })
  before.player.team[0].hp = 1
  const amount = attackBeforeDrop(before.opponent.team[0])
  assert.notEqual(bigRootAmount(amount), Math.floor(amount * 5324 / 4096), 'Fixture distinguishes rounding from truncation')
  const after = turn(before)
  assert.equal(after.player.team[0].hp, healedHp(before.player.team[0], bigRootAmount(amount)))
})

test('Liquid Ooze reverses recovery at full HP and Big Root applies to its damage', () => {
  for (const heldItemId of ['', 'big-root']) {
    const before = battle({ target: 'tentacruel', targetMove: 'barrier', targetOptions: { ability: '해감액' }, userOptions: { heldItemId } })
    const amount = attackBeforeDrop(before.opponent.team[0])
    const after = turn(before)
    assert.equal(after.player.team[0].hp, before.player.team[0].hp - (heldItemId ? bigRootAmount(amount) : amount))
    assert.equal(after.opponent.team[0].statStages.attack, -1)
    assert(after.log.some(log => log.message.includes('해감액')))
  }
})

test('Mold Breaker obtained by a real Entrainment does not bypass Liquid Ooze', () => {
  let state = battle({ doubles: true, target: 'tentacruel', targetMove: 'barrier', targetOptions: { ability: '해감액' },
    ally: 'pangoro', allyMove: 'entrainment', allyOptions: { ability: '틀깨기' } })
  const targetSlot = state.opponent.activeIndexes.findIndex(index => state.opponent.team[index].speciesId === 73)
  const players = [
    { type: 'move', actorSlot: 0, moveIndex: 0, targetSlot, targetSideId: 'opponent' },
    { type: 'move', actorSlot: 1, moveIndex: 0, targetSlot: 0, targetSideId: 'player' },
  ]
  const opponents = [0, 1].map(actorSlot => ({ type: 'move', actorSlot, moveIndex: 0, targetSlot: 0 }))
  state = playBattleTurnWithActions(state, players, opponents, () => 0.5)
  assert.equal(state.player.team[0].ability, '틀깨기')
  const beforeHp = state.player.team[0].hp
  const expectedLoss = attackBeforeDrop(state.opponent.team[state.opponent.activeIndexes[targetSlot]])
  state = playBattleTurnWithActions(state, players, opponents, () => 0.5)
  assert.equal(state.player.team[0].hp, Math.max(0, beforeHp - expectedLoss))
  assert(state.log.some(log => log.message.includes('해감액')))
})

test('Heal Block disables Strength Sap and prevents both effects when an action is submitted directly', () => {
  const before = battle()
  before.player.team[0].hp = 1
  before.player.team[0].healBlockTurns = 3
  assert.equal(getBattleMoveSelectionState(before, 'player', 0).disabled, true)
  const after = turn(before)
  assert.equal(after.player.team[0].hp, 1)
  assert.equal(after.opponent.team[0].statStages.attack, 0)
})

test('Substitute and Protect prevent both the Attack drop and healing', () => {
  for (const block of ['substitute', 'protect']) {
    const before = battle()
    before.player.team[0].hp = 1
    if (block === 'substitute') before.opponent.team[0].substituteHp = 25
    const after = turn(before, { opponentMoveIndex: block === 'protect' ? 1 : 0 })
    assert.equal(after.player.team[0].hp, 1, block)
    assert.equal(after.opponent.team[0].statStages.attack, 0, block)
    if (block === 'substitute') assert.equal(after.opponent.team[0].substituteHp, 25)
  }
})

test('Magic Bounce reverses the target and heals the reflector using Jellicent Attack', () => {
  const before = battle({ target: 'espeon', targetMove: 'calmmind', targetOptions: { ability: '매직미러' } })
  before.player.team[0].hp = 1
  before.opponent.team[0].hp = 1
  const after = turn(before)
  assert.equal(after.player.team[0].hp, 1)
  assert.equal(after.player.team[0].statStages.attack, -1)
  assert.equal(after.opponent.team[0].statStages.attack, 0)
  assert.equal(after.opponent.team[0].hp, healedHp(before.opponent.team[0], attackBeforeDrop(before.player.team[0])))
})

test('double battles drain only the selected opponent and heal only the user', () => {
  const before = battle({ doubles: true })
  before.player.team[0].hp = 1
  const selectedIndex = before.opponent.activeIndexes[1]
  const unselectedIndex = before.opponent.activeIndexes[0]
  const after = turn(before, { targetSlot: 1 })
  assert.equal(after.player.team[0].hp, healedHp(before.player.team[0], attackBeforeDrop(before.opponent.team[selectedIndex])))
  assert.equal(after.opponent.team[unselectedIndex].statStages.attack, 0)
  assert.equal(after.opponent.team[selectedIndex].statStages.attack, -1)
  assert.equal(after.player.team[1].hp, before.player.team[1].hp)
})
