import assert from 'node:assert/strict'
import test from 'node:test'
import { createBattle, playBattleTurnWithActions } from '../src/data/battleEngine.js'
import { SPECIES_PROFILES, getLearnableMoves, getMoveById } from '../src/data/trainingData.js'

// Primary rules: https://github.com/smogon/pokemon-showdown/blob/master/data/moves.ts
// (Curse, Strength Sap, Substitute) and data/conditions.ts (futuremove).
// Species, abilities and moves are selectable in-game; edited HP/stages below
// describe reachable positions rather than adding unsupported move fixtures.
let fixtureId = 0
const profiles = Object.values(SPECIES_PROFILES)
function pokemon(slug, moveIds, overrides = {}) {
  const profile = profiles.find(entry => entry.slug === slug)
  assert(profile, `Missing species ${slug}`)
  const learnable = new Set(getLearnableMoves(profile.id).map(move => move.id))
  moveIds.forEach(id => assert(learnable.has(id), `${slug} cannot learn ${id}`))
  if (overrides.ability) assert(profile.abilities.includes(overrides.ability), `${slug} cannot have ${overrides.ability}`)
  return { speciesId: profile.id, captureId: `rule-correction-${++fixtureId}`,
    moves: moveIds.map(id => getMoveById(id).name), ...overrides }
}
function battle(playerPokemon, opponents, weather = 'clear') {
  return createBattle({ playerPokemon, opponent: { name: 'MOVE RULE CORRECTIONS' },
    opponentTeam: { pokemon: opponents, battleGimmicks: [] }, rules: {
      weather: { id: weather }, terrain: { id: 'neutral' },
      format: { id: 'single', activeSlots: 1, actionSlots: 1 },
      teamRule: { id: 'full', battleSize: Math.max(playerPokemon.length, opponents.length) },
    } })
}
function turn(state, playerMove, opponentMove, random = () => .5) {
  const action = (sideId, moveId) => {
    const actor = state[sideId].team[state[sideId].activeIndexes[0]]
    const moveIndex = actor.moves.findIndex(move => move.id === moveId)
    assert(moveIndex >= 0, `Missing battle move ${moveId}`)
    return { type: 'move', actorSlot: 0, targetSlot: 0, moveIndex }
  }
  return playBattleTurnWithActions(state, [action('player', playerMove)], [action('opponent', opponentMove)], random)
}

test('Electro Shot raises Special Attack on the charging turn, not again when it attacks', () => {
  let state = battle([pokemon('archaludon', ['electroshot'])], [pokemon('blissey', ['calmmind'])])
  const targetHp = state.opponent.team[0].hp
  state = turn(state, 'electroshot', 'calmmind')
  assert.equal(state.player.team[0].statStages.specialAttack, 1)
  assert.equal(state.player.team[0].chargingMove?.moveId, 'electroshot')
  assert.equal(state.opponent.team[0].hp, targetHp)

  state = turn(state, 'electroshot', 'calmmind')
  assert.equal(state.player.team[0].statStages.specialAttack, 1)
  assert.equal(state.player.team[0].chargingMove, null)
  assert(state.opponent.team[0].hp < targetHp)
})

test('Electro Shot raises Special Attack before attacking immediately in rain', () => {
  const before = battle([pokemon('archaludon', ['electroshot'])], [pokemon('blissey', ['calmmind'])], 'rain')
  const after = turn(before, 'electroshot', 'calmmind')
  assert.equal(after.player.team[0].statStages.specialAttack, 1)
  assert.equal(after.player.team[0].chargingMove, null)
  assert(after.opponent.team[0].hp < before.opponent.team[0].hp)
  assert.equal(before.player.team[0].moves[0].currentPp - after.player.team[0].moves[0].currentPp, 1)
})

test('Electro Shot keeps its rain boost even when Protect blocks the attack', () => {
  const before = battle([pokemon('archaludon', ['electroshot'])], [pokemon('blissey', ['protect'])], 'rain')
  const after = turn(before, 'electroshot', 'protect')
  assert.equal(after.player.team[0].statStages.specialAttack, 1)
  assert.equal(after.opponent.team[0].hp, before.opponent.team[0].hp)
})

test('Electro Shot uses Power Herb only outside rain and boosts once either way', () => {
  for (const weather of ['clear', 'rain']) {
    const before = battle([
      pokemon('archaludon', ['electroshot'], { heldItemId: 'power-herb' }),
    ], [pokemon('blissey', ['calmmind'])], weather)
    const after = turn(before, 'electroshot', 'calmmind')
    assert.equal(after.player.team[0].statStages.specialAttack, 1, weather)
    assert.equal(after.player.team[0].chargingMove, null, weather)
    assert.equal(after.player.team[0].consumedItem, weather === 'clear', weather)
    assert(after.opponent.team[0].hp < before.opponent.team[0].hp, weather)
  }
})

test('Ghost Curse can sacrifice a user with 1 HP and apply its residual damage', () => {
  const before = battle([pokemon('gengar', ['curse']), pokemon('magikarp', ['splash'])], [pokemon('snorlax', ['amnesia'])])
  before.player.team[0].hp = 1
  const frozen = JSON.stringify(before)
  const after = turn(before, 'curse', 'amnesia')
  assert.equal(JSON.stringify(before), frozen)
  assert.equal(after.player.team[0].hp, 0)
  assert.equal(after.player.team[0].fainted, true)
  assert.equal(after.player.faintCount, 1)
  assert.equal(after.opponent.team[0].cursedActive, true)
  assert.equal(after.opponent.team[0].hp, before.opponent.team[0].maxHp - Math.floor(before.opponent.team[0].maxHp / 4))
  assert.equal(after.awaitingPlayerSwitch, true)
})

test('Sacrificing the last Pokemon with Ghost Curse resolves the loss', () => {
  const before = battle([pokemon('gengar', ['curse'])], [pokemon('snorlax', ['amnesia'])])
  before.player.team[0].hp = 1
  const after = turn(before, 'curse', 'amnesia')
  assert.equal(after.player.team[0].hp, 0)
  assert.equal(after.opponent.team[0].cursedActive, true)
  assert.equal(after.winner, 'opponent')
})

test('An already cursed target does not take another HP payment from the user', () => {
  const before = battle([pokemon('gengar', ['curse'])], [pokemon('snorlax', ['amnesia'])])
  before.opponent.team[0].cursedActive = true
  const after = turn(before, 'curse', 'amnesia')
  assert.equal(after.player.team[0].hp, before.player.team[0].hp)
})

test('Non-Ghost Curse still raises Attack/Defense and lowers Speed without HP cost', () => {
  const before = battle([pokemon('snorlax', ['curse'])], [pokemon('magikarp', ['splash'])])
  const after = turn(before, 'curse', 'splash')
  assert.equal(after.player.team[0].hp, before.player.team[0].hp)
  assert.equal(after.player.team[0].statStages.attack, 1)
  assert.equal(after.player.team[0].statStages.defense, 1)
  assert.equal(after.player.team[0].statStages.speed, -1)
  assert.equal(after.opponent.team[0].cursedActive, false)
})

for (const [ability, heldItemId, stage] of [
  ['천하장사', '', 0], ['두꺼운지방', 'choice-band', 0], ['천하장사', 'choice-band', 2],
]) {
  test(`Strength Sap uses raw Attack and stages, excluding ${ability}/${heldItemId || 'no item'}`, () => {
    const before = battle([pokemon('drifblim', ['strengthsap'])], [pokemon('azumarill', ['defensecurl'], { ability, heldItemId })])
    before.player.team[0].hp = 1
    before.opponent.team[0].statStages.attack = stage
    const expected = Math.floor(before.opponent.team[0].stats.attack * (2 + stage) / 2)
    assert(expected < before.player.team[0].maxHp - 1, 'Healing must not be hidden by the HP cap')
    const after = turn(before, 'strengthsap', 'defensecurl')
    assert.equal(after.player.team[0].hp - 1, expected)
    assert.equal(after.opponent.team[0].statStages.attack, stage - 1)
  })
}

test('Strength Sap still heals when Clear Body prevents the Attack drop', () => {
  const before = battle([pokemon('drifblim', ['strengthsap'])], [pokemon('metagross', ['irondefense'], { ability: '클리어바디' })])
  before.player.team[0].hp = 1
  const after = turn(before, 'strengthsap', 'irondefense')
  assert.equal(after.player.team[0].hp - 1, before.opponent.team[0].stats.attack)
  assert.equal(after.opponent.team[0].statStages.attack, 0)
})

test('Strength Sap fails without healing when Attack is already at -6', () => {
  const before = battle([pokemon('drifblim', ['strengthsap'])], [pokemon('azumarill', ['defensecurl'])])
  before.player.team[0].hp = 1
  before.opponent.team[0].statStages.attack = -6
  const after = turn(before, 'strengthsap', 'defensecurl')
  assert.equal(after.player.team[0].hp, 1)
})

for (const [slug, futureMove, filler] of [
  ['alakazam', 'futuresight', 'calmmind'], ['jirachi', 'doomdesire', 'calmmind'],
]) {
  test(`${futureMove} damages an actual Substitute without touching the last opponent's HP`, () => {
    let state = battle([pokemon(slug, [futureMove, filler])], [pokemon('snorlax', ['substitute', 'amnesia'])])
    state = turn(state, futureMove, 'substitute')
    const hp = state.opponent.team[0].hp, substituteHp = state.opponent.team[0].substituteHp
    assert(substituteHp > 0)
    state = turn(state, filler, 'amnesia')
    assert.equal(state.opponent.team[0].substituteHp, substituteHp, 'Must wait until the third turn')
    state = turn(state, filler, 'amnesia')
    assert.equal(state.opponent.team[0].hp, hp)
    assert(state.opponent.team[0].substituteHp < substituteHp)
    assert.equal(state.opponent.team[0].hitCountTaken, 0)
    assert.equal(state.opponent.team[0].lastDamageTaken, 0)
    assert.equal(state.opponent.team[0].fainted, false)
    assert.equal(state.winner, null)
    assert.equal(state.opponent.futureMoveSlots[0], undefined)
  })
}

test('Future Sight damage to Substitute is not capped by the holder having only 1 HP', () => {
  let state = battle([pokemon('alakazam', ['futuresight', 'calmmind'])], [pokemon('snorlax', ['substitute', 'amnesia'])])
  state = turn(state, 'futuresight', 'substitute')
  state.opponent.team[0].hp = 1
  const substituteHp = state.opponent.team[0].substituteHp
  state = turn(state, 'calmmind', 'amnesia')
  state = turn(state, 'calmmind', 'amnesia')
  assert.equal(state.opponent.team[0].hp, 1)
  assert(substituteHp - state.opponent.team[0].substituteHp > 1)
  assert.equal(state.winner, null)
})

test('Infiltrator Future Sight still bypasses the actual Substitute', () => {
  let state = battle([pokemon('meowstic-female', ['futuresight', 'calmmind'], { ability: '틈새포착' })], [pokemon('snorlax', ['substitute', 'amnesia'])])
  state = turn(state, 'futuresight', 'substitute')
  const hp = state.opponent.team[0].hp, substituteHp = state.opponent.team[0].substituteHp
  state = turn(state, 'calmmind', 'amnesia')
  state = turn(state, 'calmmind', 'amnesia')
  assert(state.opponent.team[0].hp < hp)
  assert.equal(state.opponent.team[0].substituteHp, substituteHp)
  assert.equal(state.opponent.team[0].hitCountTaken, 1)
})

test('Future Sight still knocks out the last opponent when it has no Substitute', () => {
  let state = battle([pokemon('alakazam', ['futuresight', 'calmmind'])], [pokemon('snorlax', ['amnesia'])])
  state = turn(state, 'futuresight', 'amnesia')
  state.opponent.team[0].hp = 1
  state = turn(state, 'calmmind', 'amnesia')
  state = turn(state, 'calmmind', 'amnesia')
  assert.equal(state.opponent.team[0].hp, 0)
  assert.equal(state.opponent.team[0].fainted, true)
  assert.equal(state.opponent.faintCount, 1)
  assert.equal(state.winner, 'player')
})

function rolls(...values) {
  // orderedActions assigns one tie-break draw to each side before either move.
  values = [.5, .5, ...values]
  let index = 0
  return () => values[index++] ?? .5
}

test('Magnitude samples all seven legal power bands, with one PP spent per use', () => {
  const damages = []
  for (const [roll, level] of [[.02, 4], [.10, 5], [.25, 6], [.50, 7], [.75, 8], [.90, 9], [.97, 10]]) {
    const before = battle([pokemon('golem', ['magnitude'])], [pokemon('snorlax', ['amnesia'])])
    const after = turn(before, 'magnitude', 'amnesia', rolls(roll))
    assert(after.log.some(entry => entry.message === `매그니튜드 ${level}!`))
    assert.equal(before.player.team[0].moves[0].currentPp - after.player.team[0].moves[0].currentPp, 1)
    damages.push(before.opponent.team[0].hp - after.opponent.team[0].hp)
  }
  for (let index = 1; index < damages.length; index++) assert(damages[index] > damages[index - 1], JSON.stringify(damages))
  assert(damages.at(-1) > damages[0] * 8, 'The 150-power result must differ substantially from the 10-power result')
})

test('Magnitude rolls once for the whole double-battle attack', () => {
  const before = createBattle({
    playerPokemon: [pokemon('golem', ['magnitude']), pokemon('snorlax', ['amnesia'])],
    opponent: { name: 'MAGNITUDE SPREAD' }, opponentTeam: { pokemon: [pokemon('snorlax', ['amnesia']), pokemon('snorlax', ['amnesia'])], battleGimmicks: [] },
    rules: { weather: { id: 'clear' }, terrain: { id: 'neutral' }, format: { id: 'double', activeSlots: 2, actionSlots: 2 }, teamRule: { id: 'full', battleSize: 2 } },
  })
  const action = slot => ({ type: 'move', actorSlot: slot, targetSlot: 0, moveIndex: 0 })
  const after = playBattleTurnWithActions(before, [action(0), action(1)], [action(0), action(1)], () => .5)
  const logs = after.log.filter(entry => entry.message === '매그니튜드 7!')
  assert.equal(logs.length, 1)
  const damages = before.opponent.team.map((entry, index) => entry.hp - after.opponent.team[index].hp)
  assert(damages[0] > 0)
  assert.equal(damages[0], damages[1])
  assert.equal(before.player.team[1].hp - after.player.team[1].hp, damages[0])
})

test('Present has distinct 40, 80 and 120 power damage outcomes', () => {
  const damages = [.3, .7, .95].map(roll => {
    const before = battle([pokemon('delibird', ['present'])], [pokemon('snorlax', ['amnesia'])])
    const after = turn(before, 'present', 'amnesia', rolls(roll))
    assert.equal(before.player.team[0].moves[0].currentPp - after.player.team[0].moves[0].currentPp, 1)
    return before.opponent.team[0].hp - after.opponent.team[0].hp
  })
  assert(damages[0] > 0 && damages[0] < damages[1] && damages[1] < damages[2], JSON.stringify(damages))
})

test('The healing Present restores one quarter of target HP through its actual Substitute', () => {
  let state = battle([pokemon('delibird', ['protect', 'present'])], [pokemon('snorlax', ['substitute', 'amnesia'])])
  state = turn(state, 'protect', 'substitute')
  const before = state
  const after = turn(before, 'present', 'amnesia', rolls(.1))
  assert.equal(after.opponent.team[0].hp - before.opponent.team[0].hp, Math.floor(before.opponent.team[0].maxHp / 4))
  assert.equal(after.opponent.team[0].substituteHp, before.opponent.team[0].substituteHp)
  assert.equal(after.opponent.team[0].hitCountTaken, 0)
  assert.equal(after.player.team[0].moveFailedThisTurn, false)
})

test('Healing Present still respects accuracy, Protect and target Heal Block', () => {
  for (const blocked of ['accuracy', 'protect', 'heal-block']) {
    const before = battle([pokemon('delibird', ['present'])], [pokemon('snorlax', ['amnesia', 'protect'])])
    before.opponent.team[0].hp = 1
    if (blocked === 'heal-block') before.opponent.team[0].healBlockTurns = 3
    const after = turn(before, 'present', blocked === 'protect' ? 'protect' : 'amnesia',
      blocked === 'accuracy' ? rolls(.1, .99) : () => .1)
    assert.equal(after.opponent.team[0].hp, 1, blocked)
    assert.equal(before.player.team[0].moves[0].currentPp - after.player.team[0].moves[0].currentPp, 1)
  }
})

test('Max Strike from Present cannot roll a healing gift', () => {
  const before = battle([pokemon('delibird', ['present'], { battleMechanics: ['dynamax'] })], [pokemon('snorlax', ['amnesia'])])
  before.opponent.team[0].hp = 100
  const after = playBattleTurnWithActions(before,
    [{ type: 'move', actorSlot: 0, moveIndex: 0, targetSlot: 0, gimmick: 'dynamax' }],
    [{ type: 'move', actorSlot: 0, moveIndex: 0, targetSlot: 0 }], () => .1)
  assert(after.player.team[0].dynamaxActive)
  assert(after.opponent.team[0].hp < 100)
})
