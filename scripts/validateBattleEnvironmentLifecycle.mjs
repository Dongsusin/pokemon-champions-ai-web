import assert from 'node:assert/strict'
import { createBattle, playBattleTurnWithActions } from '../src/data/battleEngine.js'
import { getLearnableMoves, getMoveById, SPECIES_PROFILES } from '../src/data/trainingData.js'
import { BATTLE_TERRAINS, BATTLE_WEATHER_DEFINITIONS } from '../src/data/battleRules.js'

// Showdown's clearTerrain()/clearWeather() discard the replaced environment.
// Reference: data/moves.ts (Defog, Ice Spinner, Steel Roller) and
// data/abilities.ts (Desolate Land, Primordial Sea, Delta Stream).
const profiles = new Map(Object.values(SPECIES_PROFILES).map(profile => [profile.slug, profile]))
let fixtureId = 0
let checks = 0
const failures = []
const action = (moveIndex = 0, gimmick = null, actorSlot = 0) => ({ type: 'move', moveIndex, gimmick, actorSlot, targetSlot: 0 })
const switchAction = (targetIndex, actorSlot = 0) => ({ type: 'switch', targetIndex, actorSlot })

function pokemon(slug, moveIds = ['protect'], options = {}) {
  const profile = profiles.get(slug)
  assert(profile, `Missing species: ${slug}`)
  const legalMoves = new Set(getLearnableMoves(profile.id).map(move => move.id))
  for (const moveId of moveIds) assert(legalMoves.has(moveId), `${slug} cannot learn ${moveId}`)
  return {
    captureId: `environment-lifecycle-${++fixtureId}`, speciesId: profile.id, slug,
    ability: profile.abilities[0], nature: '노력', dynamaxMode: 'dynamax',
    moveIds, moves: moveIds.map(id => getMoveById(id).name), ...options,
  }
}

function battle(player, { weather = 'clear', terrain = 'neutral', opponent, double = false } = {}) {
  opponent ??= [pokemon('snorlax', ['amnesia'])]
  const slots = double ? 2 : 1
  return createBattle({
    playerPokemon: player, opponent: { name: 'ENVIRONMENT LIFECYCLE', tier: 'C' },
    opponentTeam: { pokemon: opponent, battleGimmicks: [], strategy: {} },
    rules: {
      weather: BATTLE_WEATHER_DEFINITIONS.find(value => value.id === weather),
      terrain: BATTLE_TERRAINS.find(value => value.id === terrain),
      format: { id: double ? 'double' : 'single', activeSlots: slots, actionSlots: slots },
      teamRule: { id: 'full', battleSize: Math.max(player.length, opponent.length) },
    },
  })
}

function turn(state, player = [action()], opponent = [action()]) {
  return playBattleTurnWithActions(state, player, opponent, () => 0.5)
}

function check(name, run) {
  checks += 1
  try { run() } catch (error) { failures.push(`${name}: ${error.stack}`) }
}

function assertExpires(state, kind, environmentId, expectedTurns, playerAction = action(1)) {
  const turnsKey = `${kind}Turns`
  const neutralId = kind === 'weather' ? 'clear' : 'neutral'
  for (let remaining = expectedTurns; remaining > 0; remaining -= 1) {
    assert.equal(state.rules[kind].id, environmentId, `${environmentId} must persist through each complete turn`)
    assert.equal(state.environment[turnsKey], remaining)
    state = turn(state, [playerAction])
  }
  assert.equal(state.rules[kind].id, neutralId, 'Expired environment must not restore the opening battle conditions')
  assert.equal(state.environment[turnsKey], null)
  state = turn(state, [playerAction])
  assert.equal(state.rules[kind].id, neutralId, 'The old opening environment must not return on the following turn')
  return state
}

check('Default battle starts clear and neutral', () => {
  const state = battle([pokemon('mew')])
  assert.equal(state.rules.weather.id, 'clear')
  assert.equal(state.rules.terrain.id, 'neutral')
})

for (const [moveId, kind, nextId, openingId] of [
  ['thunderbolt', 'terrain', 'electric', 'grassy'],
  ['energyball', 'terrain', 'grassy', 'electric'],
  ['psychic', 'terrain', 'psychic', 'misty'],
  ['dazzlinggleam', 'terrain', 'misty', 'psychic'],
  ['flamethrower', 'weather', 'sun', 'rain'],
  ['surf', 'weather', 'rain', 'sun'],
  ['icebeam', 'weather', 'snow', 'sun'],
  ['ancientpower', 'weather', 'sandstorm', 'rain'],
]) {
  check(`Dynamax ${moveId} replaces opening ${openingId}, lasts five turns, and expires normally`, () => {
    const initial = battle([pokemon('mew', [moveId, 'protect'])], { [kind]: openingId })
    const state = turn(initial, [action(0, 'dynamax')])
    assert(state.player.team[0].dynamaxActive)
    assert.equal(initial.rules[kind].id, openingId, 'Turn processing must preserve the input snapshot')
    assertExpires(state, kind, nextId, 4)
  })
}

for (const [moveId, kind, nextId, openingId, itemId] of [
  ['raindance', 'weather', 'rain', 'sun', 'damp-rock'],
  ['electricterrain', 'terrain', 'electric', 'grassy', 'terrain-extender'],
]) {
  check(`${itemId} preserves eight-turn duration without restoring the old environment`, () => {
    let state = battle([pokemon('mew', [moveId, 'protect'], { heldItemId: itemId })], { [kind]: openingId })
    state = turn(state)
    assertExpires(state, kind, nextId, 7)
  })
}

for (const [slug, moveId] of [['mew', 'defog'], ['mew', 'icespinner'], ['bronzong', 'steelroller']]) {
  for (const timed of [false, true]) {
    check(`${moveId} clears ${timed ? 'temporary' : 'opening'} terrain across later turns`, () => {
      let state = battle([pokemon(slug, [moveId, 'protect'])], { terrain: 'grassy' })
      if (timed) {
        // A resumed legacy match may store a non-neutral base underneath a new field.
        state.rules.terrain = { ...BATTLE_TERRAINS.find(value => value.id === 'electric') }
        state.environment.terrainTurns = 3
      }
      state = turn(state)
      assert.equal(state.rules.terrain.id, 'neutral')
      assert.equal(state.environment.terrainTurns, null)
      state = turn(state, [action(1)])
      assert.equal(state.rules.terrain.id, 'neutral')
    })
  }
}

check('Defog clears legacy opening fog without reinstating it', () => {
  let state = battle([pokemon('mew', ['defog', 'protect'])], { weather: 'fog' })
  state = turn(state)
  assert.equal(state.rules.weather.id, 'clear')
  state = turn(state, [action(1)])
  assert.equal(state.rules.weather.id, 'clear')
})

for (const [slug, moveId, gimmick, options] of [
  ['corviknight', 'airslash', 'dynamax', { dynamaxMode: 'gigantamax' }],
  ['lycanroc', 'stoneedge', 'zmove', { heldItemId: 'lycanium-z--held' }],
]) {
  check(`${slug}'s field-clearing special move removes legacy terrain permanently`, () => {
    let state = battle([pokemon(slug, [moveId, 'protect'], options)], { terrain: 'electric' })
    state = turn(state, [action(0, gimmick)])
    assert.equal(state.rules.terrain.id, 'neutral')
    assert.equal(state.environment.terrainTurns, null)
    state = turn(state, [action(1)])
    assert.equal(state.rules.terrain.id, 'neutral')
  })
}

for (const [slug, ability, kind, environmentId] of [
  ['ninetales', '가뭄', 'weather', 'sun'],
  ['rillaboom', '그래스메이커', 'terrain', 'grassy'],
]) {
  check(`${ability} works at entry and lasts normally after its source switches out`, () => {
    let state = battle([pokemon(slug, ['protect'], { ability }), pokemon('mew')])
    assert.equal(state.rules[kind].id, environmentId)
    assert.equal(state.environment[`${kind}Turns`], 5)
    state = turn(state, [switchAction(1)])
    assertExpires(state, kind, environmentId, 4, action())
  })
}

check('An entry terrain ability does not overwrite a later Dynamax terrain each turn', () => {
  let state = battle([pokemon('tapu-koko', ['dazzlinggleam', 'protect'], { ability: '일렉트릭메이커' })])
  assert.equal(state.rules.terrain.id, 'electric')
  state = turn(state, [action(0, 'dynamax')])
  assertExpires(state, 'terrain', 'misty', 4)
})

for (const [slug, weatherId] of [['groudon-primal', 'desolateland'], ['kyogre-primal', 'primordialsea'], ['rayquaza-mega', 'deltastream']]) {
  check(`${weatherId} blocks ordinary weather and clears when its source leaves`, () => {
    let state = battle([pokemon(slug), pokemon('mew')], {
      weather: 'snow', opponent: [pokemon('mew', ['raindance', 'amnesia'])],
    })
    state = turn(state)
    assert.equal(state.rules.weather.id, weatherId)
    assert.equal(state.environment.weatherTurns, null)
    assert.equal(state.environment.weatherStrong, true)
    state = turn(state, [switchAction(1)], [action(1)])
    assert.equal(state.rules.weather.id, 'clear', 'Strong weather must not reinstate old opening weather')
    assert.equal(state.environment.weatherStrong, false)
    assert.equal(state.environment.weatherSourceBattleId, null)
  })
}

check('Strong weather persists while another source with the same ability remains active', () => {
  let state = battle([pokemon('groudon-primal'), pokemon('groudon-primal'), pokemon('mew')], {
    weather: 'rain', double: true, opponent: [pokemon('snorlax', ['amnesia']), pokemon('snorlax', ['amnesia'])],
  })
  state = turn(state, [switchAction(2), action(0, null, 1)], [action(), action(0, null, 1)])
  assert.equal(state.rules.weather.id, 'desolateland')
  assert.equal(state.environment.weatherSourceBattleId, state.player.team[1].battleId)
})

if (failures.length) {
  console.error(failures.join('\n\n'))
  process.exitCode = 1
} else {
  console.log(`Validated ${checks} battle environment lifecycle scenarios.`)
}
