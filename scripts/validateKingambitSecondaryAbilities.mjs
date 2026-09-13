import assert from 'node:assert/strict'
import test from 'node:test'
import { createBattle, playBattleTurnWithActions } from '../src/data/battleEngine.js'
import { SPECIES_PROFILES, getLearnableMoves, getMoveById, getSpeciesProfile, normalizePokemon } from '../src/data/trainingData.js'

// Primary rules checked 2026-09-14: Kingambit's three abilities, Defiant's
// opponent-only actual stat drops, and Pressure's actual targets/mustpressure.
// https://github.com/smogon/pokemon-showdown/blob/master/data/pokedex.ts
// https://github.com/smogon/pokemon-showdown/blob/master/data/abilities.ts
// https://github.com/smogon/pokemon-showdown/blob/master/data/moves.ts
// https://github.com/smogon/pokemon-showdown/blob/master/sim/pokemon.ts
// https://github.com/smogon/pokemon-showdown/blob/master/sim/battle-actions.ts
const profiles = new Map(Object.values(SPECIES_PROFILES).map(profile => [profile.slug, profile]))
let serial = 0
function pokemon(slug, moveIds, options = {}) {
  const profile = profiles.get(slug)
  assert(profile, slug)
  const legal = new Set(getLearnableMoves(profile.id).map(move => move.id))
  for (const id of moveIds) assert(legal.has(id), `${slug} cannot learn ${id}`)
  const ability = options.ability ?? profile.abilities[0]
  assert(profile.abilities.includes(ability), `${slug} cannot have ${ability}`)
  return { speciesId: profile.id, captureId: `kingambit-secondary-${++serial}`, ability,
    moveIds, moves: moveIds.map(id => getMoveById(id).name), ...options }
}
// Awake Sleep Talk is a legal, harmless fallback when the turn API fills an
// unselected player slot; it cannot accidentally add boosts or block a hit.
const kingambit = (ability = '오기', options = {}, moves = ['sleeptalk', 'protect']) => pokemon('kingambit', moves, { ability, ...options })
const quiet = () => pokemon('wailord', ['splash'])
function battle(players, opponents, slots = 1) {
  return createBattle({ playerPokemon: players, opponent: { name: 'Kingambit ability audit', tier: 'C' },
    opponentTeam: { pokemon: opponents, battleGimmicks: [], strategy: {} }, rules: {
      pvp: true, weather: { id: 'clear' }, terrain: { id: 'neutral' },
      format: { id: slots === 3 ? 'triple' : slots === 2 ? 'double' : 'single', activeSlots: slots, actionSlots: slots },
      teamRule: { id: 'full', battleSize: 6 }, aiDifficulty: { id: 'normal' },
    } })
}
const action = (moveIndex = 0, options = {}) => ({ type: 'move', actorSlot: 0, moveIndex, targetSlot: 0, ...options })
const turn = (state, players = [], opponents = [], random = () => 0.5) => playBattleTurnWithActions(state, players, opponents, random)
const spent = (before, after, side = 'player', index = 0, moveIndex = 0) => before[side].team[index].moves[moveIndex].currentPp - after[side].team[index].moves[moveIndex].currentPp
const stage = (state, key, side = 'player', index = 0) => state[side].team[index].statStages[key]
const defiantLogs = (before, after) => after.log.slice(before.log.length).filter(entry => entry.message.includes('오기!'))

test('Kingambit exposes and preserves exactly Defiant, Supreme Overlord and Pressure', () => {
  assert.deepEqual(getSpeciesProfile(983).abilities, ['오기', '총대장', '프레셔'])
  for (const ability of ['오기', '총대장', '프레셔']) {
    assert.equal(normalizePokemon({ speciesId: 983, ability }).ability, ability)
    assert.equal(battle([kingambit(ability)], [quiet()]).player.team[0].ability, ability)
  }
})

for (const side of ['player', 'opponent']) test(`Defiant: ${side} Kingambit gets net Attack +1 from opposing Intimidate`, () => {
  const intimidator = pokemon('gyarados', ['splash'], { ability: '위협' })
  const state = side === 'player' ? battle([kingambit()], [intimidator]) : battle([intimidator], [kingambit()])
  assert.equal(stage(state, 'attack', side), 1)
})

test('Defiant: opposing Leer drops Defense and raises Attack by two', () => {
  const before = battle([kingambit()], [pokemon('haxorus', ['leer'])])
  const after = turn(before, [], [action()])
  assert.equal(stage(after, 'defense'), -1)
  assert.equal(stage(after, 'attack'), 2)
  assert.equal(defiantLogs(before, after).length, 1)
})

test('Defiant: Noble Roar dropping two stats triggers only once', () => {
  const before = battle([kingambit()], [pokemon('pyroar', ['nobleroar'])])
  const after = turn(before, [], [action()])
  assert.equal(stage(after, 'attack'), 1)
  assert.equal(stage(after, 'specialAttack'), -1)
  assert.equal(defiantLogs(before, after).length, 1)
})

test('Defiant: an allied Screech lowers Defense without triggering', () => {
  const before = battle([kingambit(), pokemon('weezing', ['screech'])], [quiet(), quiet()], 2)
  const after = turn(before, [action(0, { actorSlot: 1, targetSideId: 'player', targetSlot: 0 })])
  assert.equal(stage(after, 'defense'), -2)
  assert.equal(stage(after, 'attack'), 0)
  assert.equal(defiantLogs(before, after).length, 0)
})

test('Defiant: an already minimum stat cannot trigger another boost', () => {
  const before = battle([kingambit()], [pokemon('haxorus', ['leer'])])
  before.player.team[0].statStages.defense = -6
  const after = turn(before, [], [action()])
  assert.equal(stage(after, 'defense'), -6)
  assert.equal(stage(after, 'attack'), 0)
})

test('Defiant: Clear Amulet blocks the stat drop and prevents activation', () => {
  const before = battle([kingambit('오기', { heldItemId: 'clear-amulet' })], [pokemon('haxorus', ['leer'])])
  const after = turn(before, [], [action()])
  assert.equal(stage(after, 'defense'), 0)
  assert.equal(stage(after, 'attack'), 0)
})

test('Defiant: Mold Breaker does not suppress the reaction ability', () => {
  const before = battle([kingambit()], [pokemon('haxorus', ['leer'], { ability: '틀깨기' })])
  const after = turn(before, [], [action()])
  assert.equal(stage(after, 'defense'), -1)
  assert.equal(stage(after, 'attack'), 2)
})

test('Defiant: Neutralizing Gas suppresses the reaction', () => {
  const before = battle([kingambit()], [pokemon('weezing', ['screech'], { ability: '화학변화가스' })])
  const after = turn(before, [], [action()])
  assert.equal(stage(after, 'defense'), -2)
  assert.equal(stage(after, 'attack'), 0)
})

test('Defiant: Stellar Tera Blast self drops do not activate it', () => {
  const before = battle([kingambit('오기', { teraType: '스텔라' }, ['terablast'])], [quiet()])
  const after = turn(before, [action(0, { gimmick: 'tera' })])
  assert.equal(stage(after, 'attack'), -1)
  assert.equal(stage(after, 'specialAttack'), -1)
  assert.equal(defiantLogs(before, after).length, 0)
})

for (const side of ['player', 'opponent']) test(`Pressure: ${side} attacking opposing Kingambit spends two PP`, () => {
  const hitter = pokemon('slowbro', ['tackle'])
  const before = side === 'player' ? battle([hitter], [kingambit('프레셔')]) : battle([kingambit('프레셔')], [hitter])
  const after = side === 'player' ? turn(before, [action()]) : turn(before, [], [action()])
  assert.equal(spent(before, after, side), 2)
})

test('Pressure: an untargeted opposing Kingambit does not charge extra PP', () => {
  const before = battle([pokemon('slowbro', ['tackle']), quiet()], [quiet(), kingambit('프레셔')], 2)
  const after = turn(before, [action()])
  assert.equal(spent(before, after), 1)
})

test('Pressure: healing an allied Kingambit costs only one PP', () => {
  const before = battle([pokemon('slowbro', ['healpulse']), kingambit('프레셔')], [quiet(), quiet()], 2)
  before.player.team[1].hp -= 50
  const after = turn(before, [action(0, { targetSideId: 'player', targetSlot: 1 })])
  assert(after.player.team[1].hp > before.player.team[1].hp)
  assert.equal(spent(before, after), 1)
})

test('Pressure: direct damage to an allied Kingambit costs only one PP', () => {
  const before = battle([pokemon('slowbro', ['tackle']), kingambit('프레셔')], [quiet(), quiet()], 2)
  const after = turn(before, [action(0, { targetSideId: 'player', targetSlot: 1 })])
  assert(after.player.team[1].hp < before.player.team[1].hp)
  assert.equal(spent(before, after), 1)
})

for (const move of ['imprison', 'snatch']) test(`Pressure: ${move} mustpressure overrides its self target`, () => {
  const before = battle([pokemon('smeargle', [move]), quiet()], [kingambit('프레셔'), kingambit('프레셔')], 2)
  assert(getMoveById(move).flags.includes('mustpressure'))
  const after = turn(before, [action()])
  assert.equal(spent(before, after), 3)
})

test('Pressure: ordinary self boosts never incur extra PP', () => {
  const before = battle([kingambit('오기', {}, ['swordsdance'])], [kingambit('프레셔')])
  const after = turn(before, [action()])
  assert.equal(stage(after, 'attack'), 2)
  assert.equal(spent(before, after), 1)
})

for (const move of ['stealthrock', 'spikes']) test(`Pressure: ${move} mustpressure counts all opposing holders`, () => {
  const before = battle([pokemon('garchomp', [move]), quiet()], [kingambit('프레셔'), kingambit('프레셔')], 2)
  assert(getMoveById(move).flags.includes('mustpressure'))
  const after = turn(before, [action()])
  assert.equal(spent(before, after), 3)
})

test('Pressure: Surf counts both opposing holders and excludes its allied holder', () => {
  const before = battle([pokemon('blastoise', ['surf']), kingambit('프레셔')], [kingambit('프레셔'), kingambit('프레셔')], 2)
  const after = turn(before, [action()])
  for (const [side, index] of [['player', 1], ['opponent', 0], ['opponent', 1]]) assert(after[side].team[index].hp < before[side].team[index].hp)
  assert.equal(spent(before, after), 3)
})

test('Pressure: a triple spread move excludes the nonadjacent holder', () => {
  const before = battle([pokemon('garchomp', ['earthquake']), quiet(), quiet()], [kingambit('프레셔'), quiet(), quiet()], 3)
  const after = turn(before, [action(0, { targetSlot: 2 })])
  assert.equal(after.opponent.team[0].hp, before.opponent.team[0].hp)
  assert(after.opponent.team[1].hp < before.opponent.team[1].hp)
  assert(after.opponent.team[2].hp < before.opponent.team[2].hp)
  assert.equal(spent(before, after), 1)
})

test('Pressure: a triple spread move counts only its two adjacent opposing holders', () => {
  const before = battle([pokemon('blastoise', ['surf']), quiet(), quiet()], [kingambit('프레셔'), kingambit('프레셔'), kingambit('프레셔')], 3)
  const after = turn(before, [action(0, { targetSlot: 2 })])
  assert.equal(after.opponent.team[0].hp, before.opponent.team[0].hp)
  assert.equal(spent(before, after), 3)
})

test('Pressure: mustpressure hazards include even nonadjacent opposing holders', () => {
  const before = battle([pokemon('garchomp', ['stealthrock']), quiet(), quiet()], [kingambit('프레셔'), quiet(), quiet()], 3)
  const after = turn(before, [action()])
  assert.equal(spent(before, after), 2)
})

test('Pressure: Protect still costs the attacker extra PP', () => {
  const before = battle([pokemon('slowbro', ['tackle'])], [kingambit('프레셔')])
  const after = turn(before, [action()], [action(1)])
  assert.equal(after.opponent.team[0].hp, before.opponent.team[0].hp)
  assert.equal(spent(before, after), 2)
})

test('Pressure: type immunity still costs the attacker extra PP', () => {
  const before = battle([pokemon('slowbro', ['psychic'])], [kingambit('프레셔')])
  const after = turn(before, [action()])
  assert.equal(after.opponent.team[0].hp, before.opponent.team[0].hp)
  assert.equal(spent(before, after), 2)
})

test('Pressure: missing still costs the attacker extra PP', () => {
  const before = battle([pokemon('weezing', ['screech'])], [kingambit('프레셔')])
  const after = turn(before, [action()], [], () => 0.99)
  assert.equal(stage(after, 'defense', 'opponent'), 0)
  assert.equal(spent(before, after), 2)
})

test('Pressure: Mold Breaker cannot bypass the PP cost', () => {
  const before = battle([pokemon('haxorus', ['leer'], { ability: '틀깨기' })], [kingambit('프레셔')])
  const after = turn(before, [action()])
  assert.equal(stage(after, 'defense', 'opponent'), -1)
  assert.equal(spent(before, after), 2)
})

test('Pressure: Neutralizing Gas removes the extra PP cost', () => {
  const before = battle([pokemon('weezing', ['tackle'], { ability: '화학변화가스' })], [kingambit('프레셔')])
  const after = turn(before, [action()])
  assert.equal(spent(before, after), 1)
})

test('Pressure: a move with one PP remaining is usable and never goes negative', () => {
  const before = battle([pokemon('slowbro', ['tackle'])], [kingambit('프레셔')])
  before.player.team[0].moves[0].currentPp = 1
  const after = turn(before, [action()])
  assert.equal(after.player.team[0].moves[0].currentPp, 0)
  assert(after.opponent.team[0].hp < before.opponent.team[0].hp)
})
