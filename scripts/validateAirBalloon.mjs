import assert from 'node:assert/strict'
import test from 'node:test'
import { chooseAiAction, createBattle, playBattleTurnWithActions } from '../src/data/battleEngine.js'
import { SPECIES_PROFILES, getLearnableMoves, getMoveById } from '../src/data/trainingData.js'

// Primary rules checked 2026-09-11:
// https://github.com/smogon/pokemon-showdown/blob/master/data/items.ts#L184
// https://github.com/smogon/pokemon-showdown/blob/master/sim/pokemon.ts (isGrounded/runImmunity)
// https://github.com/smogon/pokemon-showdown/blob/master/data/moves.ts (thousandarrows/smackdown)
const profiles = new Map(Object.values(SPECIES_PROFILES).map(profile => [profile.slug, profile]))
let serial = 0
function pokemon(slug, moveIds = ['protect'], options = {}, addSetupMove = true) {
  const profile = profiles.get(slug)
  assert(profile, `Unknown species: ${slug}`)
  const learnable = new Set(getLearnableMoves(profile.id).map(move => move.id))
  moveIds = !addSetupMove || moveIds.includes('protect') ? moveIds : [...moveIds, 'protect']
  for (const id of moveIds) assert(learnable.has(id), `${slug} cannot learn ${id}`)
  const ability = options.ability ?? profile.abilities[0]
  assert(profile.abilities.includes(ability), `${slug} cannot have ${ability}`)
  return { speciesId: profile.id, captureId: `balloon-${++serial}`, ability, moveIds,
    moves: moveIds.map(id => getMoveById(id).name), ...options }
}
const balloon = (slug = 'snorlax', moveIds, options = {}) => pokemon(slug, moveIds, { heldItemId: 'air-balloon', ...options })
function battle(players, opponents) {
  return createBattle({ playerPokemon: players, opponent: { name: 'Air Balloon audit', tier: 'S' },
    opponentTeam: { pokemon: opponents, battleGimmicks: [] }, rules: {
      weather: { id: 'clear' }, terrain: { id: 'neutral' },
      format: { id: players.length > 1 ? 'double' : 'single', activeSlots: players.length > 1 ? 2 : 1, actionSlots: players.length > 1 ? 2 : 1 },
      teamRule: { id: 'full', battleSize: 6 }, aiDifficulty: { id: 'normal' },
    } })
}
const action = (moveIndex = 0, actorSlot = 0, targetSlot = 0) => ({ type: 'move', moveIndex, actorSlot, targetSlot })
const turn = (state, players = [action()], opponents = []) => playBattleTurnWithActions(state,
  players.length ? players : [action(state.player.team[0].moves.findIndex(move => move.id === 'protect'))], opponents, () => 0.5)
const pops = (before, after) => after.log.slice(before.log.length).filter(entry => entry.message.includes('풍선이 터졌다')).length
function assertImmune(before, after, side = 'opponent', index = 0) {
  assert.equal(after[side].team[index].hp, before[side].team[index].hp, 'Ground move must not damage the balloon holder')
  assert.equal(after[side].team[index].consumedItem, false, 'An immune hit must not pop the balloon')
}

for (const move of ['earthquake', 'earthpower']) {
  for (const side of ['player', 'opponent']) test(`${move}: ${side} Air Balloon holder is immune without consuming its item`, () => {
    const attacker = pokemon('garchomp', [move])
    const before = side === 'player' ? battle([balloon('wailord', ['splash'])], [attacker]) : battle([attacker], [balloon()])
    const original = structuredClone(before)
    const after = side === 'player' ? turn(before, [action()], [action()]) : turn(before)
    assertImmune(before, after, side)
    assert.equal(pops(before, after), 0)
    assert.deepEqual(before, original, 'Battle resolution must not mutate its input')
  })
}

test('Earthquake independently respects allied and opposing balloons in doubles', () => {
  const before = battle([pokemon('garchomp', ['earthquake']), balloon('wailord', ['splash'])], [balloon(), pokemon('snorlax')])
  const after = turn(before)
  assertImmune(before, after, 'player', 1)
  assertImmune(before, after)
  assert(after.opponent.team[1].hp < before.opponent.team[1].hp)
  assert.equal(after.player.team[0].moves[0].currentPp, before.player.team[0].moves[0].currentPp - 1)
})

test('Mold Breaker bypasses Levitate but never Air Balloon', () => {
  for (const withBalloon of [false, true]) {
    const before = battle([pokemon('excadrill', ['earthquake'], { ability: '틀깨기' })],
      [pokemon('bronzong', ['protect'], { ability: '부유', heldItemId: withBalloon ? 'air-balloon' : null })])
    const after = turn(before)
    if (withBalloon) assertImmune(before, after)
    else assert(after.opponent.team[0].hp < before.opponent.team[0].hp)
  }
})

test('A successful non-Ground hit pops once and permits the following Earthquake', () => {
  const before = battle([pokemon('garchomp', ['tackle', 'earthquake'])], [balloon()])
  const hit = turn(before)
  assert(hit.opponent.team[0].hp < before.opponent.team[0].hp)
  assert.equal(hit.opponent.team[0].consumedItem, true)
  assert.equal(pops(before, hit), 1)
  const after = turn(hit, [action(1)])
  assert(after.opponent.team[0].hp < hit.opponent.team[0].hp)
  assert.equal(pops(hit, after), 0)
})

test('Protect prevents damage and does not pop Air Balloon', () => {
  const before = battle([pokemon('garchomp', ['tackle'])], [balloon()])
  const after = turn(before, [action()], [action()])
  assertImmune(before, after)
})

test('A non-Ground hit on Substitute pops its holder balloon without damaging real HP', () => {
  const initial = battle([pokemon('garchomp', ['tackle', 'earthquake'])], [balloon('snorlax', ['substitute'])])
  const before = turn(initial, [], [action()])
  assert(before.opponent.team[0].substituteHp > 0)
  const after = turn(before)
  assert.equal(after.opponent.team[0].hp, before.opponent.team[0].hp)
  assert(after.opponent.team[0].substituteHp < before.opponent.team[0].substituteHp)
  assert.equal(after.opponent.team[0].consumedItem, true)
  assert.equal(pops(before, after), 1)
})

test('An Earthquake blocked by balloon cannot damage its Substitute', () => {
  const initial = battle([pokemon('garchomp', ['earthquake'])], [balloon('snorlax', ['substitute'])])
  const before = turn(initial, [], [action()])
  const after = turn(before)
  assertImmune(before, after)
  assert.equal(after.opponent.team[0].substituteHp, before.opponent.team[0].substituteHp)
})

test('Gravity grounds a balloon holder, permits Earthquake, and then pops its balloon', () => {
  const initial = battle([pokemon('golurk', ['gravity', 'earthquake'])], [balloon()])
  const before = turn(initial)
  assert(before.environment.gravityTurns > 0)
  const after = turn(before, [action(1)])
  assert(after.opponent.team[0].hp < before.opponent.team[0].hp)
  assert.equal(after.opponent.team[0].consumedItem, true)
})

test('Gravity also overrides the Flying type and Levitate instead of only the item', () => {
  for (const target of [balloon('charizard'), balloon('bronzong', ['protect'], { ability: '부유' })]) {
    const initial = battle([pokemon('golurk', ['gravity', 'earthquake'])], [target])
    const before = turn(initial)
    const after = turn(before, [action(1)])
    assert(after.opponent.team[0].hp < before.opponent.team[0].hp)
    assert.equal(after.opponent.team[0].consumedItem, true)
  }
})

test('Smack Down pops the balloon and grounds Levitate for the next Ground hit', () => {
  const before = battle([pokemon('nidoking', ['smackdown', 'earthpower'])], [balloon('bronzong', ['protect'], { ability: '부유' })])
  const grounded = turn(before)
  assert.equal(grounded.opponent.team[0].smackDownActive, true)
  assert.equal(grounded.opponent.team[0].consumedItem, true)
  const after = turn(grounded, [action(1)])
  assert(after.opponent.team[0].hp < grounded.opponent.team[0].hp)
})

test('Thousand Arrows hits and pops balloon holders, including a Levitate holder', () => {
  const before = battle([pokemon('zygarde', ['thousandarrows']), pokemon('snorlax')],
    [balloon(), balloon('bronzong', ['protect'], { ability: '부유' })])
  const after = turn(before)
  for (const index of [0, 1]) {
    assert(after.opponent.team[index].hp < before.opponent.team[index].hp)
    assert.equal(after.opponent.team[index].consumedItem, true)
    assert.equal(after.opponent.team[index].smackDownActive, true)
  }
})

test('Ingrain overrides balloon levitation without consuming the item before damage', () => {
  const initial = battle([pokemon('garchomp', ['earthquake'])], [balloon('cradily', ['ingrain'])])
  const before = turn(initial, [], [action()])
  assert(before.opponent.team[0].ingrainActive)
  assert.equal(before.opponent.team[0].consumedItem, false)
  const after = turn(before)
  assert(after.opponent.team[0].hp < before.opponent.team[0].hp)
  assert.equal(after.opponent.team[0].consumedItem, true)
})

test('Klutz suppresses balloon immunity and popping', () => {
  const before = battle([pokemon('garchomp', ['earthquake'])], [balloon('audino', ['protect'], { ability: '서투름' })])
  const after = turn(before)
  assert(after.opponent.team[0].hp < before.opponent.team[0].hp)
  assert.equal(after.opponent.team[0].consumedItem, false)
})

test('Magic Room suppresses balloon immunity and popping', () => {
  const initial = battle([pokemon('garchomp', ['earthquake'])], [balloon('alakazam', ['magicroom'])])
  const before = turn(initial, [], [action()])
  assert(before.opponent.team[0].magicRoomSuppressed)
  const after = turn(before)
  assert(after.opponent.team[0].hp < before.opponent.team[0].hp)
  assert.equal(after.opponent.team[0].consumedItem, false)
})

test('Embargo suppresses balloon immunity and popping on only its affected holder', () => {
  const initial = battle([pokemon('garchomp', ['earthquake']), pokemon('alakazam', ['embargo'])], [balloon(), balloon()])
  const before = turn(initial, [action(1), action(0, 1)])
  assert(before.opponent.team[0].embargoTurns > 0)
  const after = turn(before)
  assert(after.opponent.team[0].hp < before.opponent.team[0].hp)
  assert.equal(after.opponent.team[0].consumedItem, false)
  assertImmune(before, after, 'opponent', 1)
})

test('Roost does not ground a Flying type that still holds an active balloon', () => {
  const before = battle([pokemon('snorlax', ['earthquake'])], [balloon('charizard', ['roost'])])
  before.opponent.team[0].hp -= 40
  const after = turn(before, [action()], [action()])
  assert.equal(after.opponent.team[0].hp, before.opponent.team[0].maxHp)
  assert.equal(after.opponent.team[0].consumedItem, false)
})

test('AI avoids Ground damage against an active balloon without mutating its state', () => {
  const before = battle([balloon('wailord', ['splash'])],
    [pokemon('garchomp', ['earthquake', 'earthpower', 'bulldoze', 'tackle'], {}, false)])
  const original = structuredClone(before)
  const decision = chooseAiAction(before, () => 0.5)
  assert.equal(decision.moveIndex, 3)
  assert.deepEqual(before, original)
})

test('Magnet Rise blocks Ground hits even from Mold Breaker after the balloon is absent', () => {
  const initial = battle([pokemon('excadrill', ['earthquake'], { ability: '틀깨기' })],
    [pokemon('excadrill', ['magnetrise'])])
  const before = turn(initial, [], [action()])
  assert(before.opponent.team[0].magnetRiseTurns > 0)
  const after = turn(before)
  assert.equal(after.opponent.team[0].hp, before.opponent.team[0].hp)
})

test('Telekinesis blocks Earthquake until Gravity forces the target down', () => {
  const initial = battle([pokemon('golurk', ['telekinesis', 'earthquake', 'gravity'])], [pokemon('snorlax')])
  const floating = turn(initial)
  assert(floating.opponent.team[0].telekinesisTurns > 0)
  const immune = turn(floating, [action(1)])
  assert.equal(immune.opponent.team[0].hp, floating.opponent.team[0].hp)
  const grounded = turn(immune, [action(2)])
  const hit = turn(grounded, [action(1)])
  assert(hit.opponent.team[0].hp < grounded.opponent.team[0].hp)
})

test('Iron Ball grounds Flying types and Levitate for Ground attacks', () => {
  for (const target of [pokemon('charizard', ['protect'], { heldItemId: 'iron-ball' }),
    pokemon('bronzong', ['protect'], { ability: '부유', heldItemId: 'iron-ball' })]) {
    const before = battle([pokemon('garchomp', ['earthquake'])], [target])
    const after = turn(before)
    assert(after.opponent.team[0].hp < before.opponent.team[0].hp)
  }
})

test('Poison residual damage does not pop a balloon or remove its Ground immunity', () => {
  const initial = battle([pokemon('nidoking', ['toxic', 'earthquake'])], [balloon('snorlax', ['protect'], { ability: '두꺼운지방' })])
  const before = turn(initial)
  assert(before.opponent.team[0].hp < initial.opponent.team[0].hp)
  assert.equal(before.opponent.team[0].consumedItem, false)
  const control = turn(before, [])
  const after = turn(before, [action(1)])
  assert.equal(after.opponent.team[0].hp, control.opponent.team[0].hp)
  assert.equal(after.opponent.team[0].consumedItem, false)
  assert.equal(pops(initial, after), 0)
})
