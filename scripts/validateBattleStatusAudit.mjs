import assert from 'node:assert/strict'
import pokemonData from '../src/data/generatedPokemonData.json' with { type: 'json' }
import { createBattle, getEffectiveBattleStat, playBattleTurnWithActions } from '../src/data/battleEngine.js'
import { getLearnableMoves, getMoveById } from '../src/data/trainingData.js'

// Gen 9 rules reference: smogon/pokemon-showdown data/{conditions,abilities,
// items,moves}.ts. Fixtures keep legal species, abilities, and move learnsets;
// initial status/HP represents an already reached state from a previous turn.
const profiles = [...pokemonData.species, ...pokemonData.forms]
let fixtureId = 0
let passed = 0
const failures = []

function pokemon(slug, moveIds = ['protect'], overrides = {}) {
  const profile = profiles.find((entry) => entry.slug === slug)
  assert.ok(profile, `Missing species: ${slug}`)
  const learnable = new Set(getLearnableMoves(profile.id).map((move) => move.id))
  const moves = moveIds.map((id) => {
    assert.ok(learnable.has(id), `${slug} cannot learn ${id}`)
    return getMoveById(id)
  })
  if (overrides.ability) assert.ok(profile.abilities.includes(overrides.ability), `${slug} cannot have ${overrides.ability}`)
  return {
    captureId: `status-audit-${++fixtureId}`, speciesId: profile.id,
    ability: profile.abilities[0], moves: moves.map((move) => move.name), moveIds,
    ...overrides,
  }
}

function battle(player = [pokemon('magikarp', ['splash'])], opponent = [pokemon('snorlax', ['protect'], { ability: '두꺼운지방' })], options = {}) {
  return createBattle({
    playerPokemon: player,
    opponent: { name: 'STATUS AUDIT' },
    opponentTeam: { pokemon: opponent, battleGimmicks: [], strategy: {} },
    rules: {
      weather: { id: options.weather ?? 'clear', label: options.weather ?? '맑음' },
      terrain: { id: options.terrain ?? 'neutral', label: options.terrain ?? '일반 필드' },
      format: { id: options.double ? 'double' : 'single', activeSlots: options.double ? 2 : 1, actionSlots: options.double ? 2 : 1 },
      teamRule: { id: 'full', battleSize: Math.max(player.length, opponent.length) },
      aiDifficulty: { id: 'normal' },
    },
  })
}

const action = (moveIndex = 0, actorSlot = 0) => ({ type: 'move', actorSlot, targetSlot: 0, moveIndex, gimmick: null })
const turn = (state, playerActions = [action()], opponentActions = [action()], random = () => 0.5) => playBattleTurnWithActions(state, playerActions, opponentActions, random)
const status = (id, extra = {}) => ({ id, label: id, counter: 0, toxicCounter: id === 'toxic' ? 1 : 0, ...extra })
const active = (state, side = 'opponent') => state[side].team[state[side].activeIndex]

function test(name, run) {
  try { run(); passed += 1; console.log(`PASS ${name}`) }
  catch (error) { failures.push({ name, error }); console.error(`FAIL ${name}: ${error.message}`) }
}

for (const [id, denominator] of [['burn', 16], ['poison', 8]]) {
  test(`${id} removes the correct fraction of maximum HP`, () => {
    const state = battle()
    const target = active(state)
    target.status = status(id)
    const expected = target.hp - Math.max(1, Math.floor(target.maxHp / denominator))
    assert.equal(active(turn(state)).hp, expected)
  })
}

test('Heatproof halves residual burn damage', () => {
  const state = battle(undefined, [pokemon('bronzong', ['protect'], { ability: '내열' })])
  const target = active(state)
  target.status = status('burn')
  assert.equal(active(turn(state)).hp, target.hp - Math.max(1, Math.floor(Math.floor(target.maxHp / 16) / 2)))
})

test('Safety Goggles prevents sandstorm chip damage', () => {
  const state = battle(undefined, [pokemon('snorlax', ['protect'], { heldItemId: 'safety-goggles' })], { weather: 'sandstorm' })
  assert.equal(active(turn(state)).hp, active(state).hp)
})

test('toxic truncates the base sixteenth before multiplying its stage', () => {
  const state = battle()
  const target = active(state)
  assert.notEqual(target.maxHp % 16, 0, 'Rounding fixture requires a non-multiple of sixteen')
  target.status = status('toxic', { toxicCounter: 3 })
  assert.equal(active(turn(state)).hp, target.hp - Math.max(1, Math.floor(target.maxHp / 16)) * 3)
})

test('toxic stage cannot exceed fifteen', () => {
  const state = battle(undefined, [pokemon('clefable', ['protect'], { ability: '매직가드' })])
  active(state).status = status('toxic', { toxicCounter: 15 })
  assert.equal(active(turn(state)).status.toxicCounter, 15)
})

test('Poison Heal restores HP while advancing the toxic stage', () => {
  const state = battle(undefined, [pokemon('gliscor', ['protect'], { ability: '포이즌힐' })])
  const target = active(state)
  target.hp = Math.floor(target.maxHp / 2)
  target.status = status('toxic', { toxicCounter: 3 })
  const after = active(turn(state))
  assert.equal(after.hp, target.hp + Math.floor(target.maxHp / 8))
  assert.equal(after.status.toxicCounter, 4)
})

test('Magic Guard prevents status and Leech Seed damage without curing status', () => {
  const state = battle(undefined, [pokemon('clefable', ['protect'], { ability: '매직가드' })])
  const target = active(state)
  target.status = status('poison')
  target.leechSeedSourceSideId = 'player'
  target.leechSeedSourceSlot = 0
  const after = active(turn(state))
  assert.equal(after.hp, target.hp)
  assert.equal(after.status.id, 'poison')
})

for (const terrain of [false, true]) {
  test(`${terrain ? 'Grassy Terrain' : 'Leftovers'} heals before lethal burn chip`, () => {
    const state = battle(undefined, [pokemon('snorlax', ['protect'], { ability: '두꺼운지방', ...(terrain ? {} : { heldItemId: 'leftovers' }) })], terrain ? { terrain: 'grassy' } : {})
    const target = active(state)
    target.hp = 1
    target.status = status('burn')
    const after = active(turn(state))
    assert.equal(after.hp, 1)
    assert.equal(after.fainted, false)
  })
}

test('Wish heals its current slot before poison damage', () => {
  const state = battle()
  const target = active(state)
  target.hp = 1
  target.status = status('poison')
  state.opponent.wishSlots = { 0: { turns: 1, amount: 60, sourceName: 'previous Wish' } }
  const after = active(turn(state))
  assert.equal(after.hp, 61 - Math.floor(target.maxHp / 8))
  assert.equal(after.fainted, false)
})

test('global Leech Seed recovery precedes poison on the opposite side', () => {
  const state = battle([pokemon('venusaur', ['protect'])])
  const recipient = active(state, 'player')
  const victim = active(state)
  recipient.hp = 1
  recipient.status = status('poison')
  victim.leechSeedSourceSideId = 'player'
  victim.leechSeedSourceSlot = 0
  const after = active(turn(state), 'player')
  assert.equal(after.hp, 1 + Math.floor(victim.maxHp / 8) - Math.floor(recipient.maxHp / 8))
  assert.equal(after.fainted, false, 'A Pokemon must not remain marked fainted after later healing')
})

test('simultaneously poisoned final Pokemon resolve in speed order', () => {
  const state = battle([pokemon('snorlax', ['protect'], { ability: '두꺼운지방' })], [pokemon('jolteon', ['protect'])])
  for (const side of ['player', 'opponent']) { active(state, side).hp = 1; active(state, side).status = status('poison') }
  assert.ok(getEffectiveBattleStat(state, active(state), 'speed') > getEffectiveBattleStat(state, active(state, 'player'), 'speed'))
  const after = turn(state)
  assert.equal(after.winner, 'player', 'Faster Jolteon faints to poison before slower Snorlax and battle ends immediately')
  assert.equal(active(after, 'player').hp, 1)
})

test('Hydration in rain cures poison before poison residual damage', () => {
  const state = battle(undefined, [pokemon('goodra', ['protect'], { ability: '촉촉바디' })], { weather: 'rain' })
  active(state).status = status('poison')
  const after = active(turn(state))
  assert.equal(after.hp, active(state).hp)
  assert.equal(after.status, null)
})

test('Shed Skin can cure poison before poison residual damage', () => {
  const state = battle(undefined, [pokemon('scrafty', ['protect'], { ability: '탈피' })])
  active(state).status = status('poison')
  const after = active(turn(state, [action()], [action()], () => 0.1))
  assert.equal(after.hp, active(state).hp)
  assert.equal(after.status, null)
})

test('poisonous orb activates after residual status damage', () => {
  const state = battle(undefined, [pokemon('snorlax', ['protect'], { ability: '두꺼운지방', heldItemId: 'toxic-orb' })])
  const after = active(turn(state))
  assert.equal(after.hp, active(state).hp)
  assert.equal(after.status.id, 'toxic')
  assert.equal(after.status.toxicCounter, 1)
})

test('Moody excludes accuracy and evasion from random stat changes', () => {
  const state = battle(undefined, [pokemon('glalie', ['protect'], { ability: '변덕쟁이' })])
  const after = active(turn(state, [action()], [action()], () => 0.99))
  assert.equal(after.statStages.accuracy, 0)
  assert.equal(after.statStages.evasion, 0)
  assert.equal(Object.values(after.statStages).filter((value) => value === 2).length, 1)
})

test('Early Bird can wake on the first move attempt after minimum-duration Spore', () => {
  let state = battle([pokemon('amoonguss', ['spore', 'protect'])], [pokemon('kangaskhan', ['leer'], { ability: '일찍기상' })])
  state = turn(state, [action()], [], () => 0)
  assert.equal(active(state).status.id, 'sleep')
  state = turn(state, [action(1)], [action()], () => 0.5)
  assert.equal(active(state).status, null)
})

test('ordinary sleep preserves its remaining clock across a switch', () => {
  let state = battle([pokemon('snorlax', ['protect'], { ability: '두꺼운지방' }), pokemon('magikarp', ['splash'])])
  active(state, 'player').status = status('sleep', { counter: 3 })
  state = turn(state, [{ type: 'switch', actorSlot: 0, targetIndex: 1 }])
  assert.equal(state.player.team[0].status.counter, 3)
  state = turn(state, [{ type: 'switch', actorSlot: 0, targetIndex: 0 }])
  assert.equal(state.player.team[0].status.counter, 3)
})

test('expired confusion cannot cause one extra self-hit', () => {
  const state = battle([pokemon('snorlax', ['protect'], { ability: '두꺼운지방' })])
  const target = active(state, 'player')
  target.confusionTurns = 1
  const after = active(turn(state, [action()], [action()], () => 0.1), 'player')
  assert.equal(after.confusionTurns, 0)
  assert.equal(after.hp, target.hp)
  assert.equal(after.protected, true)
})

test('Sleep Talk still checks confusion while asleep', () => {
  const state = battle([pokemon('snorlax', ['sleeptalk', 'tackle'], { ability: '두꺼운지방' })])
  const target = active(state, 'player')
  target.status = status('sleep', { counter: 3 })
  target.confusionTurns = 3
  const after = active(turn(state, [action()], [action()], () => 0.1), 'player')
  assert.ok(after.hp < target.hp, 'Sleeping through confusion checks allowed Sleep Talk incorrectly')
  assert.equal(after.confusionTurns, 2)
})

test('Scald thaws its frozen user before attacking', () => {
  const state = battle([pokemon('milotic', ['scald'])])
  active(state, 'player').status = status('freeze')
  const after = turn(state, [action()], [])
  assert.equal(active(after, 'player').status, null)
  assert.ok(active(after).hp < active(state).hp)
})

test('fire damage thaws a frozen target', () => {
  const state = battle([pokemon('arcanine', ['flamethrower'])])
  active(state).status = status('freeze')
  assert.equal(active(turn(state, [action()], [])).status, null)
})

test('full paralysis blocks a move and halves speed', () => {
  const state = battle([pokemon('snorlax', ['protect'], { ability: '두꺼운지방' })])
  const target = active(state, 'player')
  const normalSpeed = getEffectiveBattleStat(state, target, 'speed')
  target.status = status('paralysis')
  assert.equal(getEffectiveBattleStat(state, target, 'speed'), Math.floor(normalSpeed / 2))
  assert.equal(active(turn(state, [action()], [action()], () => 0.1), 'player').protected, false)
})

test('switching clears toxic progression, confusion, Leech Seed and binding', () => {
  const state = battle([pokemon('snorlax', ['protect'], { ability: '두꺼운지방', heldItemId: 'shed-shell' }), pokemon('magikarp', ['splash'])])
  const target = active(state, 'player')
  target.status = status('toxic', { toxicCounter: 6 })
  target.confusionTurns = 3
  target.leechSeedSourceSideId = 'opponent'
  target.leechSeedSourceSlot = 0
  target.trappedTurns = 3
  target.trapDamages = true
  target.trapSourceBattleId = active(state).battleId
  const after = turn(state, [{ type: 'switch', actorSlot: 0, targetIndex: 1 }]).player.team[0]
  assert.equal(after.status.toxicCounter, 1)
  assert.equal(after.confusionTurns, 0)
  assert.equal(after.leechSeedSourceSideId, null)
  assert.equal(after.trappedTurns, 0)
})

test('binding ends when its source switches out', () => {
  let state = battle([pokemon('cloyster', ['clamp']), pokemon('magikarp', ['splash'])])
  state = turn(state, [action()], [], () => 0.2)
  assert.ok(active(state).trappedTurns > 0)
  const before = active(state).hp
  state = turn(state, [{ type: 'switch', actorSlot: 0, targetIndex: 1 }], [])
  assert.equal(active(state).trappedTurns, 0)
  assert.equal(active(state).hp, before)
})

test('Dynamax residual burn uses original maximum HP', () => {
  const state = battle([pokemon('snorlax', ['protect'], { ability: '두꺼운지방', battleMechanics: ['dynamax'] })])
  const target = active(state, 'player')
  target.status = status('burn')
  const after = active(turn(state, [{ ...action(), gimmick: 'dynamax' }], []), 'player')
  assert.equal(after.dynamaxActive, true)
  assert.equal(after.maxHp - after.hp, Math.floor(target.maxHp / 16))
})

test('equal-Speed residual order can favor either side', () => {
  for (const [randomValue, winner] of [[0.1, 'player'], [0.9, 'opponent']]) {
    const state = battle([pokemon('snorlax', ['protect'], { ability: '두꺼운지방' })], [pokemon('snorlax', ['protect'], { ability: '두꺼운지방' })])
    for (const side of ['player', 'opponent']) { active(state, side).hp = 1; active(state, side).status = status('poison') }
    assert.equal(turn(state, [action()], [action()], () => randomValue).winner, winner)
  }
})

test('confusion expires before the full-paralysis check', () => {
  const state = battle([pokemon('snorlax', ['protect'], { ability: '두꺼운지방' })])
  active(state, 'player').status = status('paralysis')
  active(state, 'player').confusionTurns = 1
  const after = active(turn(state, [action()], [action()], () => 0.1), 'player')
  assert.equal(after.confusionTurns, 0)
  assert.equal(after.protected, false)
})

test('Octolock stat drops stop when its source switches', () => {
  let state = battle([pokemon('grapploct', ['octolock']), pokemon('magikarp', ['splash'])])
  state = turn(state, [action()], [])
  assert.equal(active(state).statStages.defense, -1)
  state = turn(state, [{ type: 'switch', actorSlot: 0, targetIndex: 1 }], [])
  assert.equal(active(state).octolockActive, false)
  assert.equal(active(state).statStages.defense, -1)
})

test('Attract ends when its source leaves the field', () => {
  let state = battle([pokemon('lopunny', ['attract'], { gender: 'female' }), pokemon('magikarp', ['splash'])], [pokemon('snorlax', ['protect'], { ability: '두꺼운지방', gender: 'male' })])
  state = turn(state, [action()], [])
  assert.equal(active(state).infatuated, true)
  state = turn(state, [{ type: 'switch', actorSlot: 0, targetIndex: 1 }], [])
  assert.equal(active(state).infatuated, false)
})

test('Binding Band damage strength is retained after the source loses the item', () => {
  let state = battle([pokemon('cloyster', ['clamp'], { heldItemId: 'binding-band' })])
  state = turn(state, [action()], [], () => 0.2)
  assert.ok(active(state).trappedTurns > 0)
  // Reached after a legal Knock Off, Trick, or item-consuming action.
  active(state, 'player').consumedItem = true
  const before = active(state).hp
  state = turn(state, [{ type: 'move', moveIndex: 0 }], [action()], () => 0.5)
  assert.equal(before - active(state).hp, Math.floor(active(state).maxHp / 6))
})

test('each Bad Dreams user damages sleeping opponents at the late ability phase', () => {
  const state = battle([pokemon('darkrai', ['protect']), pokemon('darkrai', ['protect'])], [pokemon('snorlax', ['protect'], { ability: '두꺼운지방' }), pokemon('magikarp', ['splash'])], { double: true })
  const target = active(state)
  target.status = status('sleep', { counter: 4 })
  const after = active(turn(state, [action(0, 0), action(0, 1)], []))
  assert.equal(target.hp - after.hp, 2 * Math.floor(target.maxHp / 8))
})

test('turn counters decrement once and field tenure increments once per turn', () => {
  const state = battle()
  const target = active(state)
  target.tauntTurns = 3
  target.healBlockTurns = 4
  target.telekinesisTurns = 2
  const before = target.activeTurnCount
  const after = active(turn(state, [action()], []))
  assert.equal(after.tauntTurns, 2)
  assert.equal(after.healBlockTurns, 3)
  assert.equal(after.telekinesisTurns, 1)
  assert.equal(after.activeTurnCount, before + 1)
})

if (failures.length) {
  console.error(`Status audit failed: ${failures.length}/${passed + failures.length} scenarios.`)
  process.exitCode = 1
} else console.log(`Validated ${passed} deterministic status and end-of-turn scenarios.`)
