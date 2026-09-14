import assert from 'node:assert/strict'
import test from 'node:test'
import { createBattle, playBattleTurnWithActions } from '../src/data/battleEngine.js'
import { canPokemonLearnMove, getMoveById, normalizePokemon } from '../src/data/trainingData.js'

// Primary reference: Showdown data/abilities.ts, asonespectrier/asoneglastrier.
// As One retains Unnerve and grants the rider's Neigh once per move-caused KO.
let fixtureId = 0
function pokemon(speciesId, ids, options = {}) {
  const moves = ids.map(id => getMoveById(id).name)
  for (const move of moves) assert(canPokemonLearnMove(speciesId, move), `${speciesId}: illegal ${move}`)
  return normalizePokemon({ speciesId, captureId: `as-one-${++fixtureId}`, moves, ...options })
}

function battle({ speciesId = 10194, moveIds = ['astralbarrage', 'agility'], double = false, berry = false, gas = false } = {}) {
  const enemy = () => pokemon(129, ['splash'], berry ? { heldItemId: 'sitrus-berry' } : {})
  return createBattle({
    playerPokemon: [pokemon(speciesId, moveIds), pokemon(129, ['splash'])],
    opponent: { name: '혼연일체 검증' },
    opponentTeam: { pokemon: [enemy(), gas ? pokemon(110, ['haze'], { ability: '화학변화가스' }) : enemy(), enemy()], battleGimmicks: [] },
    rules: { weather: { id: 'clear' }, terrain: { id: 'neutral' },
      format: { id: double ? 'double' : 'single', activeSlots: double ? 2 : 1, actionSlots: double ? 2 : 1 },
      teamRule: { id: 'full', battleSize: 3 }, pvp: true },
    random: () => 0.5,
  })
}

function turn(state, { moveIndex = 0 } = {}) {
  const player = [{ type: 'move', actorSlot: 0, moveIndex, targetSlot: 0, targetSideId: 'opponent' }]
  const opponent = [{ type: 'move', actorSlot: 0, moveIndex: 0 }]
  if (state.rules.format.id === 'double') {
    player.push({ type: 'move', actorSlot: 1, moveIndex: 0 })
    opponent.push({ type: 'move', actorSlot: 1, moveIndex: 0 })
  }
  return playBattleTurnWithActions(state, player, opponent, () => 0.5)
}

function abilityLogs(state, ability) {
  return state.log.filter(entry => entry.tone === 'ability' && entry.message.includes(`의 ${ability}!`))
}

test('Shadow Rider uses its actual As One ability and gains Special Attack on a move KO', () => {
  const before = battle()
  assert.equal(before.player.team[0].ability, '혼연일체')
  before.opponent.team[0].hp = 1
  const after = turn(before)
  assert.equal(after.opponent.team[0].hp, 0)
  assert.equal(after.player.team[0].statStages.specialAttack, 1)
  assert.equal(after.player.team[0].statStages.attack, 0)
  assert.equal(after.player.team[0].ability, '혼연일체', 'do not replace As One and lose Unnerve')
  assert.equal(abilityLogs(after, '흑의울음').length, 1)
  assert.equal(before.player.team[0].statStages.specialAttack, 0, 'input state remains immutable')
})

test('Astral Barrage knocking out both opponents grants two Special Attack stages', () => {
  const before = battle({ double: true })
  before.opponent.team[0].hp = before.opponent.team[1].hp = 1
  const after = turn(before)
  assert.equal(after.opponent.team[0].hp, 0)
  assert.equal(after.opponent.team[1].hp, 0)
  assert.equal(after.player.team[0].statStages.specialAttack, 2)
  assert.equal(after.player.team[1].statStages.specialAttack, 0)
  assert.equal(abilityLogs(after, '흑의울음').length, 2)
})

test('Astral Barrage grants only one stage if the other opponent survives', () => {
  const before = battle({ double: true })
  before.opponent.team[0].hp = 1
  before.opponent.team[1].hp = before.opponent.team[1].maxHp = 5000
  const after = turn(before)
  assert.equal(after.opponent.team[0].hp, 0)
  assert(after.opponent.team[1].hp > 0)
  assert.equal(after.player.team[0].statStages.specialAttack, 1)
})

test('dealing damage without a KO does not trigger Grim Neigh', () => {
  const before = battle()
  before.opponent.team[0].hp = before.opponent.team[0].maxHp = 5000
  const after = turn(before)
  assert(after.opponent.team[0].hp < 5000 && after.opponent.team[0].hp > 0)
  assert.equal(after.player.team[0].statStages.specialAttack, 0)
  assert.equal(abilityLogs(after, '흑의울음').length, 0)
})

test('a poison KO at turn end does not trigger Grim Neigh', () => {
  const before = battle()
  before.opponent.team[0].hp = 1
  before.opponent.team[0].status = { id: 'poison', counter: 0 }
  const after = turn(before, { moveIndex: 1 })
  assert.equal(after.opponent.team[0].hp, 0)
  assert.equal(after.player.team[0].statStages.specialAttack, 0)
})

test('the Special Attack stage remains capped at six', () => {
  const before = battle({ double: true })
  before.player.team[0].statStages.specialAttack = 5
  before.opponent.team[0].hp = before.opponent.team[1].hp = 1
  const after = turn(before)
  assert.equal(after.player.team[0].statStages.specialAttack, 6)
})

test('As One continues suppressing berries after its Grim Neigh boost', () => {
  const before = battle({ double: true, berry: true })
  before.opponent.team[0].hp = 1
  before.opponent.team[1].hp = 2000
  before.opponent.team[1].maxHp = 5000
  const after = turn(before)
  assert.equal(after.player.team[0].statStages.specialAttack, 1)
  assert.equal(after.opponent.team[1].consumedItem, false)
  assert.equal(after.opponent.team[1].heldItemId, 'sitrus-berry')
})

test('As One cannot be suppressed by Neutralizing Gas', () => {
  const before = battle({ double: true, gas: true })
  before.opponent.team[0].hp = 1
  before.opponent.team[1].hp = before.opponent.team[1].maxHp = 5000
  before.opponent.team[1].rechargeTurns = 1
  assert.equal(before.opponent.team[1].ability, '화학변화가스')
  assert.equal(before.player.team[0].ability, '혼연일체')
  const after = turn(before)
  assert.equal(after.player.team[0].statStages.specialAttack, 1)
})

test('Ice Rider As One triggers Chilling Neigh rather than Grim Neigh', () => {
  const before = battle({ speciesId: 10193, moveIds: ['glaciallance', 'agility'] })
  before.opponent.team[0].hp = 1
  const after = turn(before)
  assert.equal(after.opponent.team[0].hp, 0)
  assert.equal(after.player.team[0].statStages.attack, 1)
  assert.equal(after.player.team[0].statStages.specialAttack, 0)
  assert.equal(abilityLogs(after, '백의울음').length, 1)
})

test('Spectrier standalone Grim Neigh still activates', () => {
  const before = battle({ speciesId: 897, moveIds: ['shadowball', 'agility'] })
  before.opponent.team[0].hp = 1
  const after = turn(before)
  assert.equal(after.player.team[0].ability, '흑의울음')
  assert.equal(after.player.team[0].statStages.specialAttack, 1)
})
