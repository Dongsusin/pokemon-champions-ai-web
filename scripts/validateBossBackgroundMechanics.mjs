import assert from 'node:assert/strict'
import { createBossChallengeBattle, createBossOpponent } from '../src/data/bossChallenge.js'
import { createBattlePreviewPokemon, playBattleTurnWithActions } from '../src/data/battleEngine.js'
import { BATTLE_TERRAINS, BATTLE_WEATHER_DEFINITIONS } from '../src/data/battleRules.js'

const move = { type: 'move', moveIndex: 0, actorSlot: 0, targetSlot: 0 }
function encounter(moveId, { speciesId = 151, terrain = 'neutral', weather = 'clear', opponentMove = 'growl' } = {}) {
  const party = Array.from({ length: 6 }, (_, index) => createBossOpponent({ speciesId, moves: [moveId] }, `background-mechanics-${index}`))
  const state = createBossChallengeBattle({ bossId: 'mewtwo', round: 2, party, playerName: '배경 회귀 테스트', random: () => 0.5 })
  state.opponent.activeIndexes = [0]
  state.opponent.activeIndex = 0
  state.rules.terrain = { ...BATTLE_TERRAINS.find(value => value.id === terrain) }
  state.rules.weather = { ...BATTLE_WEATHER_DEFINITIONS.find(value => value.id === weather) }
  state.opponent.team[0].moves = createBattlePreviewPokemon(createBossOpponent({ speciesId: 53, moves: [opponentMove] }, 'background-opponent')).moves
  return state
}
function turn(state) { return playBattleTurnWithActions(state, [move], [move], () => 0.5) }

for (const terrain of ['neutral', 'grassy']) {
  const state = encounter('protect', { terrain, opponentMove: 'protect' })
  state.player.team[0].hp -= 60
  const previousHp = state.player.team[0].hp
  const result = turn(state)
  assert.equal(result.player.team[0].hp, previousHp + (terrain === 'grassy' ? Math.floor(state.player.team[0].maxHp / 16) : 0), 'Grassy Terrain still heals grounded Pokemon in a boss encounter')
}
for (const terrain of ['neutral', 'electric']) {
  const state = encounter('rest', { terrain, opponentMove: 'protect' })
  state.player.team[0].hp -= 60
  const result = turn(state)
  assert.equal(result.player.team[0].status?.id ?? null, terrain === 'electric' ? null : 'sleep', 'Electric Terrain still prevents sleep in a boss encounter')
}
for (const terrain of ['neutral', 'psychic']) {
  const state = encounter('quickattack', { speciesId: 25, terrain })
  const result = turn(state)
  assert.equal(result.opponent.team[0].hp === state.opponent.team[0].hp, terrain === 'psychic', 'Psychic Terrain still blocks priority against grounded targets')
}
for (const terrain of ['neutral', 'misty']) {
  const result = turn(encounter('willowisp', { terrain }))
  assert.equal(result.opponent.team[0].status?.id ?? null, terrain === 'misty' ? null : 'burn', 'Misty Terrain still prevents status in a boss encounter')
}
const neutral = encounter('surf')
const rain = encounter('surf', { weather: 'rain' })
const neutralDamage = neutral.opponent.team[0].hp - turn(neutral).opponent.team[0].hp
const rainDamage = rain.opponent.team[0].hp - turn(rain).opponent.team[0].hp
assert(rainDamage > neutralDamage, 'Rain still boosts Water move damage in a boss encounter')
console.log('PASS boss encounter mechanics: grassy recovery, electric sleep immunity, psychic priority protection, misty status immunity, and rain damage boost')
