import assert from 'node:assert/strict'
import test from 'node:test'
import { createBattle, playBattleTurnWithActions } from '../src/data/battleEngine.js'
import { SPECIES_PROFILES, getLearnableMoves, getMoveById } from '../src/data/trainingData.js'

// Primary rules reference: Pokemon Showdown sim/battle-actions.ts (spread target
// iteration, 0.75 spreadModifier, once-per-move self effects and total recoil),
// sim/pokemon.ts (getMoveTargets/Pressure), data/moves.ts and data/items.ts.
// https://github.com/smogon/pokemon-showdown/blob/master/sim/battle-actions.ts
// https://github.com/smogon/pokemon-showdown/blob/master/sim/pokemon.ts
// https://github.com/smogon/pokemon-showdown/blob/master/data/moves.ts
// https://github.com/smogon/pokemon-showdown/blob/master/data/items.ts
// https://github.com/smogon/pokemon-showdown/blob/master/data/abilities.ts
// Checked 2026-09-11. Never change imported move targeting/power/secondary data.
const profiles = new Map(Object.values(SPECIES_PROFILES).map(profile => [profile.slug, profile]))
let serial = 0
function pokemon(slug, moveIds = ['protect'], overrides = {}) {
  const profile = profiles.get(slug)
  assert(profile, `Missing legal fixture species ${slug}`)
  const learnable = new Set(getLearnableMoves(profile.id).map(move => move.id))
  for (const moveId of moveIds) {
    assert(getMoveById(moveId), `Missing source move ${moveId}`)
    assert(learnable.has(moveId), `${slug} cannot learn ${moveId}`)
  }
  const ability = overrides.ability ?? profile.abilities[0]
  assert(profile.abilities.includes(ability), `${slug} cannot have ${ability}`)
  return { speciesId: profile.id, captureId: `spread-${++serial}`, ability,
    moveIds, moves: moveIds.map(id => getMoveById(id).name), ...overrides }
}
const harmlessAlly = () => pokemon('wailord', ['splash'])
function battle(attacker, foes = [pokemon('snorlax'), pokemon('snorlax')], allies = [harmlessAlly()], activeSlots = 2) {
  return createBattle({
    playerPokemon: [attacker, ...allies],
    opponent: { name: 'SPREAD AUDIT', tier: 'S' },
    opponentTeam: { pokemon: foes, battleGimmicks: [] },
    rules: {
      weather: { id: 'clear', label: '맑음' }, terrain: { id: 'neutral', label: '일반 필드' },
      format: { id: activeSlots === 3 ? 'triple' : activeSlots === 2 ? 'double' : 'single', label: '광역 검증', activeSlots, actionSlots: activeSlots },
      teamRule: { id: 'full', label: '풀 배틀', battleSize: 6 },
      aiDifficulty: { id: 'normal' },
    },
  })
}
function attack(state, options = {}, opponentActions = []) {
  const actorSlot = options.actorSlot ?? 0
  // Allies select their real harmless first move. Empty opponent actions stop
  // unrelated AI attacks while leaving all opposing targets present on field.
  const playerActions = state.player.activeIndexes.map((_, slot) => ({
    type: 'move', actorSlot: slot, moveIndex: 0, targetSlot: 0,
    ...(slot === actorSlot ? options : {}),
  }))
  return playBattleTurnWithActions(state, playerActions, opponentActions, () => 0.5)
}
const hpDamage = (before, after, side, index) => before[side].team[index].hp - after[side].team[index].hp
function assertOneUse(before, after, moveIndex = 0, ppCost = 1) {
  const attacker = before.player.team[0]
  const move = attacker.moves[moveIndex]
  assert.equal(after.player.team[0].moves[moveIndex].currentPp, move.currentPp - ppCost)
  assert.equal(after.turn, before.turn + 1)
  const announcements = after.log.slice(before.log.length).filter(entry => entry.message === `${attacker.name}의 ${move.name}!`)
  assert.equal(announcements.length, 1, 'One spread move has exactly one use announcement, regardless of its target count')
}

test('Earthquake hits both opponents and its adjacent ally, excluding the user', () => {
  assert.equal(getMoveById('earthquake').target, 'allAdjacent')
  const before = battle(pokemon('garchomp', ['earthquake']))
  const after = attack(before)
  assert(hpDamage(before, after, 'opponent', 0) > 0)
  assert(hpDamage(before, after, 'opponent', 1) > 0)
  assert(hpDamage(before, after, 'player', 1) > 0)
  assert.equal(hpDamage(before, after, 'player', 0), 0)
  assertOneUse(before, after)
})

test('Surf damages every adjacent Pokemon while excluding the user', () => {
  assert.equal(getMoveById('surf').target, 'allAdjacent')
  const before = battle(pokemon('blastoise', ['surf']))
  const after = attack(before)
  for (const [side, index] of [['opponent', 0], ['opponent', 1], ['player', 1]]) {
    assert(hpDamage(before, after, side, index) > 0, `Surf missed ${side} slot ${index}`)
  }
  assert.equal(hpDamage(before, after, 'player', 0), 0)
  assertOneUse(before, after)
})

test('Heat Wave hits both opponents, never the ally, and spends PP only once', () => {
  assert.equal(getMoveById('heatwave').target, 'allAdjacentFoes')
  const before = battle(pokemon('charizard', ['heatwave']))
  const after = attack(before)
  assert(hpDamage(before, after, 'opponent', 0) > 0)
  assert(hpDamage(before, after, 'opponent', 1) > 0)
  assert.equal(hpDamage(before, after, 'player', 0), 0)
  assert.equal(hpDamage(before, after, 'player', 1), 0)
  assertOneUse(before, after)
})

test('Protect blocks only its own target and does not remove the spread modifier', () => {
  const before = battle(pokemon('charizard', ['heatwave']))
  const control = attack(before)
  const after = attack(before, {}, [{ type: 'move', actorSlot: 0, moveIndex: 0, targetSlot: 0 }])
  assert.equal(hpDamage(before, after, 'opponent', 0), 0)
  assert(hpDamage(before, after, 'opponent', 1) > 0)
  assert.equal(hpDamage(before, after, 'opponent', 1), hpDamage(before, control, 'opponent', 1),
    'The initial two-target set determines spread reduction even when one target protects')
})

test('Water Absorb heals one Surf target without cancelling the other hits', () => {
  const before = battle(pokemon('blastoise', ['surf']), [pokemon('lapras', ['protect'], { ability: '저수' }), pokemon('snorlax')])
  before.opponent.team[0].hp -= 30
  const after = attack(before)
  assert.equal(after.opponent.team[0].hp, before.opponent.team[0].maxHp)
  assert(hpDamage(before, after, 'opponent', 1) > 0)
  assert(hpDamage(before, after, 'player', 1) > 0)
  assertOneUse(before, after)
})

test('Levitate and Flying immunity are evaluated separately for Earthquake targets', () => {
  for (const immune of [pokemon('flygon'), pokemon('charizard')]) {
    const before = battle(pokemon('garchomp', ['earthquake']), [immune, pokemon('snorlax')])
    const after = attack(before)
    assert.equal(hpDamage(before, after, 'opponent', 0), 0)
    assert(hpDamage(before, after, 'opponent', 1) > 0)
    assert(hpDamage(before, after, 'player', 1) > 0)
  }
})

test('Two real Substitutes each absorb their own spread hit', () => {
  const initial = battle(pokemon('charizard', ['protect', 'heatwave']), [pokemon('snorlax', ['substitute']), pokemon('snorlax', ['substitute'])])
  const before = attack(initial, {}, [0, 1].map(actorSlot => ({ type: 'move', actorSlot, moveIndex: 0 })))
  assert(before.opponent.team.every(member => member.substituteHp > 0), 'Both actual Substitute moves must succeed before the tested attack')
  const after = attack(before, { moveIndex: 1 })
  for (let index = 0; index < 2; index += 1) {
    assert.equal(after.opponent.team[index].hp, before.opponent.team[index].hp)
    assert(after.opponent.team[index].substituteHp < before.opponent.team[index].substituteHp)
  }
  assertOneUse(before, after, 1)
})

test('Two living targets receive the 0.75 modifier; one surviving target receives full damage', () => {
  const multiple = battle(pokemon('charizard', ['heatwave']))
  const single = structuredClone(multiple)
  single.opponent.team[1].hp = 0
  single.opponent.team[1].fainted = true
  const spreadDamage = hpDamage(multiple, attack(multiple), 'opponent', 0)
  const singleDamage = hpDamage(single, attack(single), 'opponent', 0)
  assert(singleDamage > 20)
  // The modifier occurs before the remaining integer damage rounding, so the
  // two independently rounded final values can differ by one or two HP.
  assert(Math.abs(spreadDamage - singleDamage * 0.75) <= 2,
    `Expected 0.75 spread damage (rounding tolerance 2 HP), got ${spreadDamage}/${singleDamage}`)
  assert(spreadDamage < singleDamage)
})

test('Make It Rain applies one Special Attack drop after both full-strength hits', () => {
  const before = battle(pokemon('gholdengo', ['makeitrain']))
  const after = attack(before)
  const first = hpDamage(before, after, 'opponent', 0)
  const second = hpDamage(before, after, 'opponent', 1)
  assert(first > 0 && second > 0)
  assert.equal(first, second, 'The second target must not use the already-lowered Special Attack stat')
  assert.equal(after.player.team[0].statStages.specialAttack, -1)
  assertOneUse(before, after)
})

test('Stellar boosts both spread targets equally and spends the type bonus for the next move', () => {
  const before = battle(pokemon('charizard', ['heatwave'], { teraType: '스텔라' }))
  const ordinary = attack(before)
  const first = attack(before, { gimmick: 'tera' })
  assert.equal(first.player.team[0].teraActive, true)
  assert.deepEqual(first.player.team[0].stellarBoostedTypes, ['불꽃'])
  const firstDamage = hpDamage(before, first, 'opponent', 0)
  assert.equal(firstDamage, hpDamage(before, first, 'opponent', 1),
    'The first hit must not spend the Stellar bonus before the second hit')
  assert(firstDamage > hpDamage(before, ordinary, 'opponent', 0))
  const second = attack(first)
  const secondDamage = hpDamage(first, second, 'opponent', 0)
  assert.equal(secondDamage, hpDamage(first, second, 'opponent', 1))
  assert.equal(secondDamage, hpDamage(before, ordinary, 'opponent', 0),
    'The next Fire move returns to its original STAB after the one-use Stellar bonus')
  assert(secondDamage < firstDamage)
  assert.deepEqual(second.player.team[0].stellarBoostedTypes, ['불꽃'])
  assertOneUse(before, first)
  assertOneUse(first, second)
})

test('Life Orb costs one tenth of base HP once after a spread action', () => {
  const before = battle(pokemon('charizard', ['heatwave'], { heldItemId: 'life-orb' }))
  const after = attack(before)
  assert(hpDamage(before, after, 'opponent', 0) > 0 && hpDamage(before, after, 'opponent', 1) > 0)
  assert.equal(hpDamage(before, after, 'player', 0), Math.floor(before.player.team[0].originalMaxHp / 10))
  assert.equal(after.log.slice(before.log.length).filter(entry => entry.message.includes('생명의구슬로 HP가 줄었다')).length, 1)
  assertOneUse(before, after)
})

test('Mind Blown pays half maximum HP once while hitting all adjacent targets', () => {
  const before = battle(pokemon('blacephalon', ['mindblown']))
  const after = attack(before)
  assert.equal(hpDamage(before, after, 'player', 0), Math.ceil(before.player.team[0].maxHp / 2))
  for (const [side, index] of [['opponent', 0], ['opponent', 1], ['player', 1]]) assert(hpDamage(before, after, side, index) > 0)
  assertOneUse(before, after)
})

test('Shared recoil settlement retains actual-damage capping for legal Double-Edge', () => {
  // No original spread move has damage-proportional recoil metadata. Keep the
  // real half-HP spread case above and guard the shared proportional path with
  // actual Double-Edge rather than inventing an allAdjacent recoil move.
  const before = battle(pokemon('snorlax', ['doubleedge']))
  before.opponent.team[0].hp = 9
  const after = attack(before)
  assert.equal(hpDamage(before, after, 'opponent', 0), 9)
  assert.equal(hpDamage(before, after, 'player', 0), 3)
  assert.equal(hpDamage(before, after, 'opponent', 1), 0)
  assertOneUse(before, after)
})

test('Pressure consumes one extra PP per opposing spread target, excluding allies', () => {
  const before = battle(pokemon('blastoise', ['surf']),
    [pokemon('dusknoir', ['protect'], { ability: '프레셔' }), pokemon('dusclops', ['protect'], { ability: '프레셔' })],
    [pokemon('wailord', ['splash'], { ability: '프레셔' })])
  const after = attack(before)
  assert(hpDamage(before, after, 'opponent', 0) > 0 && hpDamage(before, after, 'opponent', 1) > 0)
  assertOneUse(before, after, 0, 3)
})

test('Triple spread attacks respect mirrored opponent adjacency and adjacent allies', () => {
  const before = battle(pokemon('garchomp', ['earthquake']),
    [pokemon('snorlax'), pokemon('snorlax'), pokemon('snorlax')], [harmlessAlly(), harmlessAlly()], 3)
  assert.equal(before.player.activeIndexes.length, 3)
  const after = attack(before)
  // Left-most player (slot 0) is adjacent to opposing slots 2 and 1, not 0.
  assert.equal(hpDamage(before, after, 'opponent', 0), 0)
  assert(hpDamage(before, after, 'opponent', 1) > 0)
  assert(hpDamage(before, after, 'opponent', 2) > 0)
  assert(hpDamage(before, after, 'player', 1) > 0)
  assert.equal(hpDamage(before, after, 'player', 2), 0)
  assert.equal(hpDamage(before, after, 'player', 0), 0)
  assertOneUse(before, after)
})

test('Fainting the first spread target does not cancel hits on the remaining targets', () => {
  const before = battle(pokemon('garchomp', ['earthquake']))
  before.opponent.team[0].hp = 1
  const after = attack(before)
  assert.equal(after.opponent.team[0].hp, 0)
  assert(after.opponent.team[0].fainted)
  assert(hpDamage(before, after, 'opponent', 1) > 0)
  assert(hpDamage(before, after, 'player', 1) > 0)
  assertOneUse(before, after)
})

test('Growl lowers both opposing Attack stages without changing its ally', () => {
  const before = battle(pokemon('charizard', ['growl']))
  const after = attack(before)
  assert.equal(after.opponent.team[0].statStages.attack, -1)
  assert.equal(after.opponent.team[1].statStages.attack, -1)
  assert.equal(after.player.team[1].statStages.attack, 0)
  assertOneUse(before, after)
})

test('A spread dance triggers one Dancer copy, not one copy per target', () => {
  const before = battle(pokemon('ludicolo', ['teeterdance']),
    [pokemon('snorlax'), pokemon('blissey')], [pokemon('oricorio', ['protect'], { ability: '무희' })])
  const after = attack(before)
  const dancerCopies = after.log.slice(before.log.length).filter(entry => entry.message.includes('의 무희!'))
  assert.equal(dancerCopies.length, 1, 'A single Teeter Dance use causes exactly one Dancer activation')
  assertOneUse(before, after)
  assert.equal(after.player.team[1].moves[0].currentPp, before.player.team[1].moves[0].currentPp - 1,
    'The ally spends PP for its selected Protect only; the Dancer copy is free')
})

test('A later missed Growl target does not overwrite an earlier successful target', () => {
  const before = battle(pokemon('pikachu', ['growl']),
    [pokemon('vaporeon'), pokemon('blissey')], [pokemon('snorlax')])
  before.opponent.team[1].statStages.evasion = 6
  const after = attack(before)
  assert.equal(after.opponent.team[0].statStages.attack, -1)
  assert.equal(after.opponent.team[1].statStages.attack, 0)
  assert.equal(after.player.team[0].moveFailedThisTurn, false,
    'One successful target makes the status spread action successful despite a later miss')
  assertOneUse(before, after)
})

test('A Soundproof first opponent does not cancel Perish Song for other field Pokemon', () => {
  const before = battle(pokemon('lapras', ['perishsong']), [pokemon('exploud', ['protect'], { ability: '방음' }), pokemon('snorlax')])
  const after = attack(before)
  assert.equal(after.opponent.team[0].perishCount, null)
  assert.equal(after.opponent.team[1].perishCount, 3)
  assert.equal(after.player.team[0].perishCount, 3)
  assert.equal(after.player.team[1].perishCount, 3)
  assertOneUse(before, after)
})

test('Explosion damages every adjacent target even though its user also faints', () => {
  const before = battle(pokemon('electrode', ['explosion'], { ability: '정전기' }))
  const after = attack(before)
  assert.equal(after.player.team[0].hp, 0)
  assert(after.player.team[0].fainted)
  for (const [side, index] of [['opponent', 0], ['opponent', 1], ['player', 1]]) assert(hpDamage(before, after, side, index) > 0)
  assertOneUse(before, after)
})
