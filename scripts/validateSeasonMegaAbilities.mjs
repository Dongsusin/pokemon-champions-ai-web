import assert from 'node:assert/strict'
import test from 'node:test'
import pokemonData from '../src/data/generatedPokemonData.json' with { type: 'json' }
import {
  chooseAiAction,
  createBattle,
  getAvailableBattleMechanics,
  playBattleTurnWithActions,
} from '../src/data/battleEngine.js'
import { getLearnableMoves, getMoveById } from '../src/data/trainingData.js'

const profiles = new Map([...pokemonData.species, ...pokemonData.forms].map((entry) => [entry.slug, entry]))
const seasonMegas = [
  ['absol', 'absolite-z', 'absol-mega-z', '예리함'],
  ['garchomp', 'garchompite-z', 'garchomp-mega-z', '부유'],
  ['lucario', 'lucarionite-z', 'lucario-mega-z', '파동의방호'],
  ['golisopod', 'golisopite', 'golisopod-mega', '단단한발톱'],
  ['baxcalibur', 'baxcalibrite', 'baxcalibur-mega', '열교환'],
]
let fixtureId = 0

function pokemon(slug, moveIds = ['protect'], overrides = {}) {
  const profile = profiles.get(slug)
  assert(profile, `Missing season fixture: ${slug}`)
  const learnable = new Set(getLearnableMoves(profile.id).map((move) => move.id))
  const moves = moveIds.map((id) => {
    assert(learnable.has(id), `${slug} cannot learn ${id}`)
    return getMoveById(id)
  })
  return {
    captureId: `season-mega-${++fixtureId}`,
    speciesId: profile.id,
    slug,
    ability: profile.abilities[0],
    moveIds,
    moves: moves.map((move) => move.name),
    ...overrides,
  }
}

function battle(playerPokemon, opponentPokemon) {
  return createBattle({
    playerPokemon,
    opponent: { name: 'SEASON MEGA TEST', tier: 'S' },
    opponentTeam: { pokemon: opponentPokemon, battleGimmicks: [] },
    rules: {
      weather: { id: 'clear', label: '맑음' },
      terrain: { id: 'neutral', label: '일반 필드' },
      format: { id: 'single', label: '싱글배틀', activeSlots: 1, actionSlots: 1 },
      teamRule: { id: 'full', label: '6대6', battleSize: 6 },
      disabledGimmickId: null,
      gimmickRestriction: { id: null, label: '제한 없음' },
    },
  })
}

function turn(state, playerAction = {}, opponentAction = {}) {
  const action = { type: 'move', actorSlot: 0, targetSlot: 0, moveIndex: 0, gimmick: null }
  return playBattleTurnWithActions(
    state,
    [{ ...action, ...playerAction }],
    [{ ...action, ...opponentAction }],
    () => 0.5,
  )
}

function damageState(attacker, defender, mutate = () => {}) {
  const state = battle([attacker], [defender])
  state.opponent.team[0].hp = state.opponent.team[0].maxHp = 5000
  state.opponent.team[0].rechargeTurns = 1
  mutate(state)
  return turn(state)
}

function damage(attacker, defender, mutate) {
  return 5000 - damageState(attacker, defender, mutate).opponent.team[0].hp
}

function assertMultiplier(actual, baseline, multiplier) {
  assert(baseline > 0, 'The control move must deal damage')
  assert(Math.abs(actual - baseline * multiplier) <= 1.5,
    `Expected ${multiplier}× ${baseline} damage; got ${actual}`)
}

for (const [baseSlug, stoneId, formSlug, ability] of seasonMegas) {
  test(`${stoneId} evolves ${baseSlug} into ${formSlug} with ${ability}`, () => {
    const state = battle(
      [pokemon(baseSlug, ['protect'], { heldItemId: stoneId }), pokemon('snorlax')],
      [pokemon('smeargle', ['agility'])],
    )
    assert(getAvailableBattleMechanics(state).some((entry) => entry.id === 'mega'))
    const next = turn(state, { gimmick: 'mega' })
    const evolved = next.player.team[0]
    assert.equal(evolved.speciesId, profiles.get(formSlug).id)
    assert.equal(evolved.ability, ability)
    assert.deepEqual(evolved.types, profiles.get(formSlug).types)
    assert.equal(evolved.megaActive, true)
    assert.equal(evolved.heldItemId, stoneId)
    const switched = turn(next, { type: 'switch', targetIndex: 1 })
    const returned = turn(switched, { type: 'switch', targetIndex: 0 })
    assert.equal(returned.player.team[0].speciesId, evolved.speciesId)
    assert.equal(returned.player.team[0].ability, ability)
  })
}

for (const [baseSlug, stoneId] of [['absol', 'absolite'], ['garchomp', 'garchompite'], ['lucario', 'lucarionite']]) {
  test(`${stoneId} still selects the original Mega form`, () => {
    const state = battle([pokemon(baseSlug, ['protect'], { heldItemId: stoneId })], [pokemon('smeargle', ['agility'])])
    assert.equal(turn(state, { gimmick: 'mega' }).player.team[0].speciesId, profiles.get(`${baseSlug}-mega`).id)
  })

  test(`${baseSlug} evolves according to its stone despite an old configured form`, () => {
    for (const isZ of [true, false]) {
      const state = battle(
        [pokemon(baseSlug, ['protect'], { heldItemId: `${stoneId}${isZ ? '-z' : ''}` })],
        [pokemon('smeargle', ['agility'])],
      )
      state.player.team[0].gimmickFormId = profiles.get(`${baseSlug}-mega${isZ ? '' : '-z'}`).id
      assert.equal(turn(state, { gimmick: 'mega' }).player.team[0].speciesId,
        profiles.get(`${baseSlug}-mega${isZ ? '-z' : ''}`).id)
    }
  })
}

test('A Mega Z stone cannot enable another species to Mega Evolve', () => {
  const state = battle([pokemon('absol', ['protect'], { heldItemId: 'lucarionite-z' })], [pokemon('smeargle')])
  assert(!getAvailableBattleMechanics(state).some((entry) => entry.id === 'mega'))
})

for (const [moveId, multiplier] of [
  ['tackle', 0.5],
  ['drainingkiss', 0.5],
  ['doublehit', 0.5],
  ['rockslide', 1],
  ['flamethrower', 1],
]) {
  test(`Aura Guard handles ${moveId} by contact, independent of damage category`, () => {
    const attacker = pokemon('smeargle', [moveId])
    const defender = pokemon('lucario-mega-z')
    const baseline = damage(attacker, defender, (state) => { state.opponent.team[0].ability = '' })
    assertMultiplier(damage(attacker, defender), baseline, multiplier)
  })
}

for (const [label, attackerAbility, itemId, moveId, multiplier] of [
  ['Long Reach removes contact', '원격', '', 'tackle', 1],
  // Follows Showdown's current breakable flag; upstream still marks it TODO to verify.
  ['Mold Breaker bypasses Aura Guard', '틀깨기', '', 'tackle', 1],
  ['Protective Pads retain contact damage reduction', '', 'protective-pads', 'tackle', 0.5],
  ['Punching Glove retains contact on non-punch moves', '', 'punching-glove', 'tackle', 0.5],
  ['Punching Glove removes contact on punches', '', 'punching-glove', 'drainpunch', 1],
]) {
  test(label, () => {
    const attacker = pokemon('smeargle', [moveId], { heldItemId: itemId })
    const defender = pokemon('lucario-mega-z')
    const configure = (state) => { state.player.team[0].ability = attackerAbility }
    const baseline = damage(attacker, defender, (state) => {
      configure(state)
      state.opponent.team[0].ability = ''
    })
    assertMultiplier(damage(attacker, defender, configure), baseline, multiplier)
  })
}

test('Aura Guard is suppressed by Gastro Acid', () => {
  let state = battle([pokemon('smeargle', ['gastroacid', 'tackle'])], [pokemon('lucario-mega-z')])
  state.opponent.team[0].hp = state.opponent.team[0].maxHp = 5000
  state.opponent.team[0].rechargeTurns = 1
  state = turn(state)
  assert.equal(state.opponent.team[0].abilitySuppressed, true)
  state.opponent.team[0].rechargeTurns = 1
  const next = turn(state, { moveIndex: 1 })
  const baseline = damage(pokemon('smeargle', ['tackle']), pokemon('lucario-mega-z'), (entry) => {
    entry.opponent.team[0].ability = ''
  })
  assert.equal(5000 - next.opponent.team[0].hp, baseline)
})

test('AI prefers a non-contact attack against Aura Guard', () => {
  const state = battle([pokemon('lucario-mega-z', ['swordsdance'])], [pokemon('smeargle', ['return', 'hypervoice'])])
  // Equal attack/defense stats isolate the real moves' power/contact difference.
  for (const side of [state.player, state.opponent]) {
    for (const key of ['attack', 'defense', 'specialAttack', 'specialDefense']) side.team[0].stats[key] = 100
    side.team[0].hp = side.team[0].maxHp = 1000
    side.team[0].usedBattleMechanicId = 'mega'
  }
  assert.equal(chooseAiAction(state, () => 0.5).moveIndex, 1)
  const control = structuredClone(state)
  control.player.team[0].ability = ''
  assert.equal(chooseAiAction(control, () => 0.5).moveIndex, 0)
})

for (const [slug, moveId, multiplier] of [
  ['absol-mega-z', 'slash', 1.5],
  ['absol-mega-z', 'bite', 1],
  ['golisopod-mega', 'slash', 1.3],
  ['golisopod-mega', 'surf', 1],
]) {
  test(`${slug} applies its ability correctly to ${moveId}`, () => {
    const attacker = pokemon(slug, [moveId])
    const defender = pokemon('smeargle')
    const baseline = damage(attacker, defender, (state) => { state.player.team[0].ability = '' })
    assertMultiplier(damage(attacker, defender), baseline, multiplier)
  })
}

test('Mega Garchomp Z Levitate blocks Earthquake and yields to Mold Breaker', () => {
  const attacker = pokemon('smeargle', ['earthquake'])
  const defender = pokemon('garchomp-mega-z')
  assert.equal(damage(attacker, defender), 0)
  assert(damage(attacker, defender, (state) => { state.player.team[0].ability = '틀깨기' }) > 0)
})

test('Mega Garchomp Z avoids Spikes but still takes Stealth Rock damage', () => {
  const base = battle([pokemon('smeargle'), pokemon('garchomp-mega-z')], [pokemon('smeargle')])
  base.player.hazards.spikes = 3
  base.opponent.team[0].rechargeTurns = 1
  const spikes = turn(base, { type: 'switch', targetIndex: 1 })
  assert.equal(spikes.player.team[1].hp, spikes.player.team[1].maxHp)
  base.player.hazards.stealthRock = true
  const rocks = turn(base, { type: 'switch', targetIndex: 1 })
  assert(rocks.player.team[1].hp < rocks.player.team[1].maxHp)
})

test('Mega Baxcalibur takes Fire damage and gains one Attack stage through Thermal Exchange', () => {
  const state = damageState(pokemon('smeargle', ['flamethrower']), pokemon('baxcalibur-mega'))
  assert(state.opponent.team[0].hp < 5000)
  assert.equal(state.opponent.team[0].statStages.attack, 1)
  assert.equal(state.opponent.team[0].status, null)
  const nonFire = damageState(pokemon('smeargle', ['tackle']), pokemon('baxcalibur-mega'))
  assert.equal(nonFire.opponent.team[0].statStages.attack, 0)
})

test('Mega Baxcalibur cannot be burned by Will-O-Wisp', () => {
  const state = damageState(pokemon('smeargle', ['willowisp']), pokemon('baxcalibur-mega'))
  assert.equal(state.opponent.team[0].status, null)
  assert.equal(state.opponent.team[0].statStages.attack, 0)
  const control = damageState(pokemon('smeargle', ['willowisp']), pokemon('baxcalibur-mega'), (entry) => {
    entry.opponent.team[0].ability = ''
  })
  assert.equal(control.opponent.team[0].status?.id, 'burn')
})
