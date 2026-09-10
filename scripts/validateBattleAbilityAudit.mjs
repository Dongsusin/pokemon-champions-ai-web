import assert from 'node:assert/strict'
import test from 'node:test'
import pokemonData from '../src/data/generatedPokemonData.json' with { type: 'json' }
import { createBattle, createBattleTurnTimeline, getEffectiveBattleStat, playBattleTurnWithActions } from '../src/data/battleEngine.js'
import { getLearnableMoves, getMoveById } from '../src/data/trainingData.js'

// Reference mechanics: Pokémon Showdown data/abilities.ts, data/items.ts and
// sim/battle.ts (breakable ability flags), checked 2026-09-10.
const profiles = new Map([...pokemonData.species, ...pokemonData.forms].map((profile) => [profile.slug, profile]))
let fixtureId = 0
function pokemon(slug, moveIds = ['protect'], overrides = {}) {
  const profile = profiles.get(slug)
  assert(profile, `Missing legal fixture: ${slug}`)
  const learnable = new Set(getLearnableMoves(profile.id).map((move) => move.id))
  moveIds.forEach((id) => assert(learnable.has(id), `${slug} cannot learn ${id}`))
  if (overrides.ability) assert(profile.abilities.includes(overrides.ability), `${slug} cannot have ${overrides.ability}`)
  return {
    captureId: `ability-audit-${++fixtureId}`,
    speciesId: profile.id,
    slug,
    ability: profile.abilities[0],
    moveIds,
    moves: moveIds.map((id) => getMoveById(id).name),
    ...overrides,
  }
}
function battle(playerPokemon, opponentPokemon, activeSlots = 1) {
  const state = createBattle({
    playerPokemon,
    opponent: { name: 'ABILITY AUDIT', tier: 'S' },
    opponentTeam: { pokemon: opponentPokemon, battleGimmicks: [] },
    rules: {
      weather: { id: 'clear', label: '맑음' },
      terrain: { id: 'neutral', label: '일반 필드' },
      format: { id: activeSlots === 2 ? 'double' : 'single', label: '테스트', activeSlots, actionSlots: activeSlots },
      teamRule: { id: 'full', label: '6대6', battleSize: 6 },
      disabledGimmickId: null,
      gimmickRestriction: { id: null, label: '제한 없음' },
    },
  })
  for (const side of [state.player, state.opponent]) {
    side.activeIndexes = Array.from({ length: Math.min(activeSlots, side.team.length) }, (_, index) => index)
    side.activeIndex = 0
  }
  return state
}
function turn(state, playerAction = {}, opponentAction = {}, random = () => 0.5) {
  const action = { type: 'move', actorSlot: 0, targetSlot: 0, moveIndex: 0, gimmick: null }
  const actions = (override) => Array.from({ length: state.rules.format.activeSlots }, (_, actorSlot) => ({
    ...action, actorSlot, ...(actorSlot === (override.actorSlot ?? 0) ? override : {}),
  }))
  return playBattleTurnWithActions(state, actions(playerAction), actions(opponentAction), random)
}
function oneAttack(attacker, defender, mutate = () => {}) {
  const state = battle([attacker], [defender])
  state.opponent.team[0].hp = state.opponent.team[0].maxHp = 5000
  state.opponent.team[0].rechargeTurns = 1
  mutate(state)
  return turn(state)
}
function damage(attacker, defender, mutate) {
  return oneAttack(attacker, defender, mutate).opponent.team[0].lastDamageTaken
}
function withoutDefenderAbility(state) { state.opponent.team[0].ability = '' }

for (const [slug, ability, configure] of [
  ['furfrou', '퍼코트', () => {}],
  ['gogoat', '풀모피', (state) => { state.rules.terrain.id = 'grassy' }],
  ['milotic', '이상한비늘', (state) => { state.opponent.team[0].status = { id: 'paralysis' } }],
]) {
  test(`Mold Breaker bypasses ${ability} defensive stat modification`, () => {
    const attacker = pokemon('haxorus', ['dragonclaw'], { ability: '틀깨기' })
    const defender = pokemon(slug, ['protect'], { ability })
    const control = damage(attacker, defender, (state) => { configure(state); withoutDefenderAbility(state) })
    assert.equal(damage(attacker, defender, configure), control)
    const shielded = damage(attacker, { ...defender, heldItemId: 'ability-shield' }, configure)
    assert(shielded < control, 'Ability Shield must preserve the defensive modifier')
  })
}

test('Mold Breaker does not bypass Clear Amulet stat-drop protection', () => {
  const state = oneAttack(pokemon('haxorus', ['leer'], { ability: '틀깨기' }), pokemon('smeargle', ['protect'], { heldItemId: 'clear-amulet' }))
  assert.equal(state.opponent.team[0].statStages.defense, 0)
})

test('Mold Breaker does not bypass Mist stat-drop protection', () => {
  const state = oneAttack(pokemon('haxorus', ['leer'], { ability: '틀깨기' }), pokemon('smeargle'), (entry) => { entry.opponent.mistTurns = 3 })
  assert.equal(state.opponent.team[0].statStages.defense, 0)
})

test('Mirror Armor reflection respects the original attacker Clear Amulet', () => {
  const state = oneAttack(pokemon('smeargle', ['leer'], { heldItemId: 'clear-amulet' }), pokemon('corviknight', ['protect'], { ability: '미러아머' }))
  assert.equal(state.player.team[0].statStages.defense, 0)
  assert.equal(state.opponent.team[0].statStages.defense, 0)
})

test('Mold Breaker still triggers Rough Skin contact damage', () => {
  const state = oneAttack(pokemon('haxorus', ['scratch'], { ability: '틀깨기' }), pokemon('garchomp', ['protect'], { ability: '까칠한피부' }))
  assert(state.player.team[0].hp < state.player.team[0].maxHp)
})

test('Mold Breaker still triggers Gooey Speed drop', () => {
  const state = oneAttack(pokemon('haxorus', ['scratch'], { ability: '틀깨기' }), pokemon('goodra', ['protect'], { ability: '미끈미끈' }))
  assert.equal(state.player.team[0].statStages.speed, -1)
})

test('Mold Breaker still triggers Stamina Defense gain', () => {
  const state = oneAttack(pokemon('haxorus', ['scratch'], { ability: '틀깨기' }), pokemon('mudsdale', ['protect'], { ability: '지구력' }))
  assert.equal(state.opponent.team[0].statStages.defense, 1)
})

test('Mold Breaker still triggers Toxic Debris hazards', () => {
  const state = oneAttack(pokemon('haxorus', ['scratch'], { ability: '틀깨기' }), pokemon('glimmora', ['protect'], { ability: '독치장' }))
  assert.equal(state.player.hazards.toxicSpikes, 1)
})

test('Magic Guard prevents Rough Skin indirect damage', () => {
  const state = oneAttack(pokemon('alakazam', ['drainpunch'], { ability: '매직가드' }), pokemon('garchomp', ['protect'], { ability: '까칠한피부' }))
  assert.equal(state.player.team[0].hp, state.player.team[0].maxHp)
})

test('Long Reach contact removal bypasses Fluffy reduction', () => {
  const attacker = pokemon('decidueye', ['leafblade'], { ability: '원격' })
  const defender = pokemon('bewear', ['protect'], { ability: '복슬복슬' })
  assert.equal(damage(attacker, defender), damage(attacker, defender, withoutDefenderAbility))
})

test('Punching Glove prevents Tough Claws boost for punching moves', () => {
  const attacker = pokemon('metagross-mega', ['bulletpunch'], { heldItemId: 'punching-glove' })
  const defender = pokemon('smeargle')
  const control = damage(attacker, defender, (state) => { state.player.team[0].ability = '' })
  assert.equal(damage(attacker, defender), control)
})

test('Protective Pads do not remove Unseen Fist Protect bypass', () => {
  const state = battle([pokemon('urshifu', ['wickedblow'], { heldItemId: 'protective-pads' })], [pokemon('smeargle')])
  const next = turn(state)
  assert(next.opponent.team[0].hp < next.opponent.team[0].maxHp)
})

test('Neutralizing Gas suppresses Huge Power and restores it after switching out', () => {
  const state = battle([pokemon('azumarill', ['protect'], { ability: '천하장사' })], [pokemon('weezing', ['protect'], { ability: '화학변화가스' }), pokemon('smeargle')])
  const attacker = state.player.team[0]
  assert.equal(attacker.ability, '')
  assert.equal(getEffectiveBattleStat(state, attacker, 'attack'), attacker.stats.attack)
  const restored = turn(state, {}, { type: 'switch', targetIndex: 1 })
  assert.equal(restored.player.team[0].ability, '천하장사')
  assert.equal(getEffectiveBattleStat(restored, restored.player.team[0], 'attack'), attacker.stats.attack * 2)
})

test('Ability Shield preserves Huge Power against Neutralizing Gas', () => {
  const state = battle([pokemon('azumarill', ['protect'], { ability: '천하장사', heldItemId: 'ability-shield' })], [pokemon('weezing', ['protect'], { ability: '화학변화가스' })])
  assert.equal(state.player.team[0].ability, '천하장사')
  assert.equal(getEffectiveBattleStat(state, state.player.team[0], 'attack'), state.player.team[0].stats.attack * 2)
})

test('Mold Breaker cannot bypass Full Metal Body', () => {
  const state = oneAttack(pokemon('haxorus', ['leer'], { ability: '틀깨기' }), pokemon('solgaleo'))
  assert.equal(state.opponent.team[0].statStages.defense, 0)
})

test('Contrary reverses boosts and Simple doubles boosts', () => {
  const contrary = oneAttack(pokemon('malamar', ['superpower'], { ability: '심술꾸러기' }), pokemon('smeargle'))
  assert.equal(contrary.player.team[0].statStages.attack, 1)
  assert.equal(contrary.player.team[0].statStages.defense, 1)
  const simple = oneAttack(pokemon('bibarel', ['swordsdance'], { ability: '단순' }), pokemon('smeargle'))
  assert.equal(simple.player.team[0].statStages.attack, 4)
})

test('Defiant reacts after an opposing stat drop despite Mold Breaker', () => {
  const state = oneAttack(pokemon('haxorus', ['leer'], { ability: '틀깨기' }), pokemon('bisharp', ['protect'], { ability: '오기' }))
  assert.equal(state.opponent.team[0].statStages.defense, -1)
  assert.equal(state.opponent.team[0].statStages.attack, 2)
})

test('Quick Feet replaces the paralysis speed penalty', () => {
  const state = battle([pokemon('ursaring', ['protect'], { ability: '속보' })], [pokemon('smeargle')])
  state.player.team[0].status = { id: 'paralysis' }
  assert.equal(getEffectiveBattleStat(state, state.player.team[0], 'speed'), state.player.team[0].stats.speed * 1.5)
})

test('Gastro Acid suppresses Neutralizing Gas and immediately restores other abilities', () => {
  const state = battle([pokemon('smeargle', ['gastroacid'])], [pokemon('weezing', ['protect'], { ability: '화학변화가스' })])
  state.opponent.team[0].rechargeTurns = 1
  const next = turn(state)
  assert.equal(next.opponent.team[0].abilitySuppressed, true)
  assert.equal(next.opponent.team[0].ability, '')
  assert.equal(next.player.team[0].ability, state.player.team[0].neutralizedAbility)
})

test('Gastro Acid under Neutralizing Gas remains in force when the gas leaves', () => {
  const state = battle([pokemon('smeargle', ['gastroacid']), pokemon('smeargle')], [
    pokemon('azumarill', ['protect'], { ability: '천하장사' }),
    pokemon('weezing', ['protect'], { ability: '화학변화가스' }),
    pokemon('smeargle'),
  ], 2)
  state.opponent.team[0].rechargeTurns = 1
  const suppressed = turn(state)
  assert.equal(suppressed.opponent.team[0].abilitySuppressed, true)
  const next = turn(suppressed, {}, { type: 'switch', actorSlot: 1, targetIndex: 2 })
  assert.equal(next.opponent.team[0].ability, '')
  assert.equal(getEffectiveBattleStat(next, next.opponent.team[0], 'attack'), next.opponent.team[0].stats.attack)
})

test('Mold Breaker cannot ignore an ally Friend Guard protected by Ability Shield', () => {
  const state = battle([pokemon('haxorus', ['scratch'], { ability: '틀깨기' }), pokemon('smeargle')], [
    pokemon('smeargle'), pokemon('clefairy', ['protect'], { ability: '프렌드가드', heldItemId: 'ability-shield' }),
  ], 2)
  state.opponent.team[0].hp = state.opponent.team[0].maxHp = 5000
  state.opponent.team[0].rechargeTurns = 1
  const control = structuredClone(state)
  control.opponent.team[1].ability = ''
  const controlResult = turn(control)
  const normalDamage = controlResult.opponent.team[0].lastDamageTaken
  const protectedDamage = turn(state).opponent.team[0].lastDamageTaken
  assert(normalDamage > 0, controlResult.log.map((entry) => entry.message).join(' | '))
  assert(Math.abs(protectedDamage - normalDamage * 0.75) <= 1)
})

test('Poison Touch still triggers when its user wears Protective Pads', () => {
  const state = battle([pokemon('muk', ['pound'], { ability: '독수', heldItemId: 'protective-pads' })], [pokemon('smeargle')])
  state.opponent.team[0].hp = state.opponent.team[0].maxHp = 5000
  state.opponent.team[0].rechargeTurns = 1
  assert.equal(turn(state, {}, {}, () => 0.2).opponent.team[0].status?.id, 'poison')
})

test('Gastro Acid suppresses Forecast while preserving Castform current form', () => {
  let state = battle([pokemon('castform', ['raindance'])], [pokemon('smeargle', ['gastroacid', 'agility'])])
  state = turn(state, {}, { moveIndex: 1 })
  assert.equal(state.player.team[0].slug, 'castform-rainy')
  state = turn(state)
  assert.equal(state.player.team[0].slug, 'castform-rainy')
  assert.equal(state.player.team[0].ability, '')
  assert.equal(state.player.team[0].abilitySuppressed, true)
})

test('Forecast is suppressed by Neutralizing Gas and returns after the gas leaves', () => {
  let state = battle([pokemon('castform', ['raindance'])], [pokemon('smeargle', ['agility']), pokemon('weezing', ['protect'], { ability: '화학변화가스' })])
  state = turn(state)
  assert.equal(state.player.team[0].slug, 'castform-rainy')
  state = turn(state, {}, { type: 'switch', targetIndex: 1 })
  assert.equal(state.player.team[0].slug, 'castform-rainy')
  assert.equal(state.player.team[0].ability, '')
  state = turn(state, {}, { type: 'switch', targetIndex: 0 })
  assert.equal(state.player.team[0].slug, 'castform-rainy')
  assert.equal(state.player.team[0].ability, '기분파')
})

test('Stamina Defense gain reduces later hits of the same multi-hit move', () => {
  const attacker = pokemon('smeargle', ['doublehit'])
  const defender = pokemon('mudsdale', ['protect'], { ability: '지구력' })
  const configure = (state) => {
    state.player.team[0].stats.attack = 200
    state.opponent.team[0].stats.defense = 100
  }
  const control = damage(attacker, defender, (state) => { configure(state); withoutDefenderAbility(state) })
  const state = oneAttack(attacker, defender, configure)
  assert.equal(state.opponent.team[0].statStages.defense, 2)
  assert(state.opponent.team[0].lastDamageTaken < control, 'The second hit must use the first hit Stamina boost')
})

test('Rough Skin can knock out an attacker before later hits land', () => {
  const state = oneAttack(pokemon('smeargle', ['doublehit']), pokemon('garchomp', ['protect'], { ability: '까칠한피부' }), (entry) => {
    entry.player.team[0].hp = 1
    entry.player.team[0].stats.attack = 200
  })
  assert.equal(state.player.team[0].hp, 0)
  assert.equal(state.opponent.team[0].hitCountTaken, 1)
})

test('Draining recovery occurs before contact retaliation', () => {
  const state = oneAttack(pokemon('alakazam', ['drainpunch'], { ability: '정신력' }), pokemon('garchomp', ['protect'], { ability: '까칠한피부' }), (entry) => {
    entry.player.team[0].hp = 1
    entry.player.team[0].stats.attack = 500
  })
  assert(state.player.team[0].hp > 1)
})

test('Sitrus Berry can restore HP between hits and prevent a multi-hit knockout', () => {
  const attacker = pokemon('smeargle', ['doublehit'])
  const defender = pokemon('snorlax', ['protect'], { heldItemId: 'sitrus-berry' })
  const configure = (state) => {
    state.player.team[0].stats.attack = 300
    state.opponent.team[0].stats.defense = 100
    state.opponent.team[0].hp = 110
    state.opponent.team[0].maxHp = 160
  }
  const control = oneAttack(attacker, { ...defender, heldItemId: '' }, configure)
  assert.equal(control.opponent.team[0].hp, 0)
  const healed = oneAttack(attacker, defender, configure)
  assert(healed.opponent.team[0].hp > 0)
  assert.equal(healed.opponent.team[0].consumedItem, true)
})

test('Focus Sash does not block the second hit and timeline damage matches actual HP loss', () => {
  const state = battle([pokemon('smeargle', ['doublehit'])], [pokemon('smeargle', ['protect'], { heldItemId: 'focus-sash' })])
  state.player.team[0].stats.attack = 1000
  state.opponent.team[0].hp = state.opponent.team[0].maxHp = 100
  state.opponent.team[0].rechargeTurns = 1
  const before = structuredClone(state)
  const result = createBattleTurnTimeline(state, { type: 'move', moveIndex: 0 }, () => 0.5)
  const impacts = result.timeline.filter((step) => step.phase === 'impact' && step.sideId === 'player')
  assert.equal(impacts.length, 2)
  assert.deepEqual(impacts.map((step) => step.damage), [99, 1])
  assert.deepEqual(impacts.map((step) => step.state.opponent.team[0].hp), [1, 0])
  assert.equal(impacts.reduce((sum, step) => sum + step.damage, 0), 100)
  assert.equal(result.state.opponent.team[0].hp, 0)
  assert.deepEqual(state, before, 'Timeline generation must not mutate its input battle')
})

test('Multiscale only reduces the first hit when later hits strike below full HP', () => {
  const state = battle([pokemon('smeargle', ['doublehit'])], [pokemon('dragonite', ['protect'], { ability: '멀티스케일' })])
  state.opponent.team[0].hp = state.opponent.team[0].maxHp = 5000
  state.opponent.team[0].rechargeTurns = 1
  const result = createBattleTurnTimeline(state, { type: 'move', moveIndex: 0 }, () => 0.5)
  const impacts = result.timeline.filter((step) => step.phase === 'impact' && step.sideId === 'player')
  assert.equal(impacts.length, 2)
  assert(impacts[1].damage > impacts[0].damage * 1.8)
  assert.equal(impacts.reduce((sum, step) => sum + step.damage, 0), 5000 - result.state.opponent.team[0].hp)
})
