import assert from 'node:assert/strict'
import test from 'node:test'
import { createBattle, playBattleTurnWithActions } from '../src/data/battleEngine.js'
import { SPECIES_PROFILES, calculateStats, getLearnableMoves, getMoveById } from '../src/data/trainingData.js'

// Showdown data/items.ts and data/moves.ts use baseMaxhp for percentage heals;
// berry activation thresholds still use the current (Dynamaxed) maximum HP.
const profiles = new Map(Object.values(SPECIES_PROFILES).map((p) => [p.slug, p]))
function pokemon(slug, moveId = 'protect', overrides = {}) {
  const profile = profiles.get(slug)
  assert(getLearnableMoves(profile.id).some((m) => m.id === moveId), `${slug} cannot learn ${moveId}`)
  if (overrides.ability) assert(profile.abilities.includes(overrides.ability))
  return { speciesId: profile.id, captureId: `${slug}-${moveId}`, moves: [getMoveById(moveId).name], ...overrides }
}
function battle(playerPokemon, opponentPokemon, activeSlots = 1, ruleOverrides = {}) {
  return createBattle({ playerPokemon, opponent: { name: 'HP AUDIT' },
    opponentTeam: { pokemon: opponentPokemon, battleGimmicks: [] },
    rules: {
      weather: { id: 'clear', label: '맑음' }, terrain: { id: 'neutral', label: '일반 필드' },
      format: { id: activeSlots === 1 ? 'single' : 'double', label: '검증', activeSlots, actionSlots: activeSlots },
      teamRule: { id: 'full', label: '검증', battleSize: playerPokemon.length },
      disabledGimmickId: null, gimmickRestriction: { id: null, label: '제한 없음' },
      ...ruleOverrides,
    },
  })
}
const moveAction = (slot = 0, extra = {}) => ({ type: 'move', actorSlot: slot, moveIndex: 0, targetSlot: 0, ...extra })
function run(state, playerActions = [moveAction()], opponentActions = [moveAction()]) {
  return playBattleTurnWithActions(state, playerActions, opponentActions, () => 0.5)
}
function dynamax(pokemon, hp = 50) {
  pokemon.originalMaxHp = pokemon.maxHp
  pokemon.maxHp *= 2
  pokemon.hp = hp
  pokemon.dynamaxActive = true
  pokemon.dynamaxTurns = 3
}
test('Activating Dynamax preserves the current HP ratio at 1 HP', () => {
  const state = battle([pokemon('snorlax', 'protect', { battleMechanics: ['dynamax'] })], [pokemon('snorlax')])
  state.player.team[0].hp = 1
  const base = state.player.team[0].maxHp
  const next = run(state, [moveAction(0, { gimmick: 'dynamax' })])
  assert.equal(next.player.team[0].maxHp, base * 2)
  assert.equal(next.player.team[0].hp, 2)
})

// Showdown data/pokedex.ts: Shedinja maxHP: 1; data/conditions.ts: Dynamax
// preserves that HP, while Transform still preserves the user's own HP.
test('Shedinja keeps its fixed maximum HP regardless of HP training', () => {
  for (const hp of [0, 32]) {
    const entry = pokemon('shedinja', 'harden', { trainingPoints: { hp } })
    assert.equal(calculateStats(entry).find(stat => stat.key === 'hp').value, 1)
    const state = battle([entry], [pokemon('snorlax')])
    assert.equal(state.player.team[0].hp, 1)
    assert.equal(state.player.team[0].maxHp, 1)
    assert.equal(state.player.team[0].stats.hp, 1)
  }
})

test('Shedinja retains 1 HP at every hard difficulty boost and during Dynamax', () => {
  for (const boostStage of [1, 2, 3]) {
    const state = battle([pokemon('snorlax')], [pokemon('shedinja', 'harden', { battleMechanics: ['dynamax'] })],
      1, { aiDifficulty: { id: 'hard', boostStage } })
    const original = state.opponent.team[0]
    assert.equal(original.maxHp, 1)
    assert.equal(original.originalMaxHp, 1)
    assert.equal(original.statStages.attack, boostStage)
    const next = run(state, [moveAction()], [moveAction(0, { gimmick: 'dynamax' })])
    assert(next.opponent.team[0].dynamaxActive)
    assert.equal(next.opponent.team[0].maxHp, 1)
    assert.equal(next.opponent.team[0].hp, 1)
  }
})

test('Shedinja keeps 1 HP throughout Dynamax and its expiry', () => {
  let state = battle([pokemon('shedinja', 'harden', { battleMechanics: ['dynamax'] })], [pokemon('snorlax')])
  state = run(state, [moveAction(0, { gimmick: 'dynamax' })])
  assert(state.player.team[0].dynamaxActive)
  for (let remaining = 2; remaining >= 0; remaining--) {
    assert.equal(state.player.team[0].hp, 1)
    assert.equal(state.player.team[0].maxHp, 1)
    assert.equal(state.player.team[0].dynamaxTurns, remaining)
    if (remaining) state = run(state)
  }
  assert.equal(state.player.team[0].dynamaxActive, false)
})

test('Ditto transformed into Shedinja keeps its own HP when Dynamaxing', () => {
  let state = battle([pokemon('ditto', 'transform', { battleMechanics: ['dynamax'], ability: '유연' })], [pokemon('shedinja', 'harden')])
  const baseHp = state.player.team[0].maxHp
  state = run(state)
  assert.equal(state.player.team[0].ability, '불가사의부적')
  assert.equal(state.player.team[0].maxHp, baseHp)
  state = run(state, [moveAction(0, { gimmick: 'dynamax' })])
  assert(state.player.team[0].dynamaxActive)
  assert.equal(state.player.team[0].maxHp, baseHp * 2)
  assert.equal(state.player.team[0].hp, baseHp * 2)
})
for (const [slug, ability, item, fraction, multiplier] of [
  ['snorlax', '면역', 'sitrus-berry', 1 / 4, 1],
  ['snorlax', '면역', 'figy-berry', 1 / 3, 1],
  ['flapple', '숙성', 'sitrus-berry', 1 / 4, 2],
  ['greedent', '볼주머니', 'sitrus-berry', 1 / 4, 1],
]) {
  test(`${ability}/${item} healing uses original HP during Dynamax`, () => {
    const state = battle([pokemon(slug, 'protect', { ability, heldItemId: item })], [pokemon('snorlax')])
    const holder = state.player.team[0]
    dynamax(holder)
    const baseHp = holder.originalMaxHp
    const expected = 50 + Math.floor(baseHp * fraction * multiplier) + (ability === '볼주머니' ? Math.floor(baseHp / 3) : 0)
    const next = run(state)
    assert.equal(next.player.team[0].hp, expected)
    assert(next.player.team[0].consumedItem)
  })
}
test('Heal Block prevents eating a healing pinch berry', () => {
  const state = battle([pokemon('snorlax', 'protect', { heldItemId: 'figy-berry' })], [pokemon('snorlax')])
  state.player.team[0].hp = 20
  state.player.team[0].healBlockTurns = 3
  const next = run(state)
  assert.equal(next.player.team[0].hp, 20)
  assert.equal(next.player.team[0].consumedItem, false)
})
test('Unnerve blocks berry consumption during Dynamax', () => {
  const state = battle([pokemon('snorlax', 'protect', { heldItemId: 'sitrus-berry' })], [pokemon('corviknight', 'protect', { ability: '긴장감' })])
  dynamax(state.player.team[0])
  const next = run(state)
  assert.equal(next.player.team[0].hp, 50)
  assert.equal(next.player.team[0].consumedItem, false)
})
for (const [slug, moveId, expectedFraction] of [
  ['audino', 'healpulse', 1 / 2],
  ['comfey', 'floralhealing', 1 / 2],
]) {
  test(`${moveId} heals ceil(original HP/2) on a Dynamax target`, () => {
    const state = battle([pokemon(slug, moveId)], [pokemon('snorlax')])
    const target = state.opponent.team[0]
    dynamax(target)
    target.rechargeTurns = 1
    const next = run(state)
    assert.equal(next.opponent.team[0].hp, 50 + Math.ceil(target.originalMaxHp * expectedFraction))
  })
}
test('Pollen Puff heals its Dynamax ally by original HP', () => {
  const state = battle([pokemon('ribombee', 'pollenpuff'), pokemon('snorlax')], [pokemon('snorlax'), pokemon('blissey')], 2)
  dynamax(state.player.team[1])
  state.player.team[1].rechargeTurns = 1
  const expected = 50 + Math.floor(state.player.team[1].originalMaxHp / 2)
  const next = run(state, [moveAction(0, { targetSideId: 'player', targetSlot: 1 }), moveAction(1)], [])
  assert.equal(next.player.team[1].hp, expected)
})
test('Life Dew never revives a fainted ally', () => {
  const state = battle([pokemon('audino', 'lifedew'), pokemon('snorlax')], [pokemon('snorlax'), pokemon('blissey')], 2)
  state.player.team[1].hp = 0
  state.player.team[1].fainted = true
  const next = run(state, [moveAction()], [])
  assert.equal(next.player.team[1].hp, 0)
  assert.equal(next.player.team[1].fainted, true)
})
