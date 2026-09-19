import assert from 'node:assert/strict'
import test from 'node:test'
import { createBattle, createBattleTurnTimeline, getActivePokemon, getEffectiveBattleStat, chooseAiReplacementIndex } from '../src/data/battleEngine.js'
import { SPECIES_PROFILES } from '../src/data/trainingData.js'
import { TRAINERS } from '../src/data/trainerTeams.js'

const profiles = Object.values(SPECIES_PROFILES)
let serial = 0
function mon(slug, moveIds, extra = {}) {
  const profile = profiles.find(p => p.slug === slug)
  assert(profile, slug)
  return { speciesId: profile.id, captureId: `reported-${++serial}`, moveIds, ...extra }
}
function battle(players, opponents) {
  const state = createBattle({ playerPokemon: players, opponent: { name: '회귀 검증', tier: 'C' },
    opponentTeam: { pokemon: opponents, battleGimmicks: [], strategy: {} }, rules: {
      weather: { id: 'clear' }, terrain: { id: 'neutral' }, format: { id: 'single', activeSlots: 1 },
      teamRule: { id: 'full', battleSize: 3 }, aiDifficulty: { id: 'normal' },
    } })
  state.opponent.activeIndexes = [0]
  state.opponent.activeIndex = 0
  return state
}
const move = (moveIndex = 0) => ({ type: 'move', moveIndex, actorSlot: 0, targetSlot: 0 })
const turn = (state, player = move(), opponent = move(), roll = .5) => createBattleTurnTimeline(state, player, () => roll, [opponent])

test('Endure takes ordinary damage and only prevents a lethal hit', () => {
  let state = battle([mon('snorlax', ['endure'])], [mon('machamp', ['tackle'])])
  let after = turn(state).state
  assert(after.player.team[0].hp < state.player.team[0].hp)
  assert(after.player.team[0].hp > 1)
  state.player.team[0].hp = 2
  after = turn(state).state
  assert.equal(after.player.team[0].hp, 1)
  assert.equal(after.player.team[0].fainted, false)
})

test('Endure shares the Protect streak, fails on repeat, and resets after another move', () => {
  let state = battle([mon('snorlax', ['endure', 'protect', 'amnesia'])], [mon('wailord', ['splash'])])
  state = turn(state).state
  assert.equal(state.player.team[0].protectChain, 1)
  state = turn(state).state
  assert.equal(state.player.team[0].protectMode, null)
  assert.equal(state.player.team[0].protectChain, 0)
  state = turn(state, move(1)).state
  state = turn(state).state
  assert.equal(state.player.team[0].protectMode, null)
  state = turn(state).state
  state = turn(state, move(2)).state
  state = turn(state).state
  assert.equal(state.player.team[0].protectMode, 'endure')
  state = turn(state, move(), move(), .2).state
  assert.equal(state.player.team[0].protectChain, 2)
  state = turn(state, move(), move(), .2).state
  assert.equal(state.player.team[0].protectMode, null, 'Third consecutive success requires a roll below 1/9')
})

test('AI must send its remaining Pokemon even when entry hazards will KO all of them', () => {
  const state = battle([mon('wailord', ['splash'])], [mon('machamp', ['tackle']), mon('charizard', ['flamethrower']), mon('butterfree', ['gust'])])
  state.opponent.team[0].hp = 0
  state.opponent.team[0].fainted = true
  state.opponent.team.slice(1).forEach(p => { p.hp = 1 })
  state.opponent.hazards.stealthRock = true
  assert.notEqual(chooseAiReplacementIndex(state), null)
  const { state: after, timeline } = turn(state)
  assert.equal(after.winner, 'player')
  assert.equal(after.opponent.team.filter(p => p.hp > 0).length, 0)
  assert.equal(timeline.filter(step => step.phase === 'switch' && step.sideId === 'opponent').length, 2)
})

test('AI selects a surviving reserve when one is available', () => {
  const state = battle([mon('wailord', ['splash'])], [mon('machamp', ['tackle']), mon('charizard', ['flamethrower']), mon('blastoise', ['surf'])])
  state.opponent.team[0].hp = 0
  state.opponent.team[0].fainted = true
  state.opponent.team[1].hp = 1
  state.opponent.hazards.stealthRock = true
  const after = turn(state).state
  assert.equal(after.winner, null)
  assert(getActivePokemon(after, 'opponent').hp > 0)
})

test('Actual AI Archaludon sets do not outspeed speed trained Flutter Mane in normal conditions', () => {
  const sets = TRAINERS.flatMap(trainer => trainer.teams.flatMap(team => team.pokemon))
    .filter(pokemon => pokemon.slug === 'archaludon')
  assert(sets.length > 0)
  for (const set of sets) {
    const state = battle([mon('flutter-mane', ['moonblast'], { nature: '겁쟁이', trainingPoints: { speed: 32 } })], [set])
    assert(getEffectiveBattleStat(state, state.player.team[0], 'speed') > getEffectiveBattleStat(state, state.opponent.team[0], 'speed'))
    const { timeline } = turn(state)
    assert.equal(timeline.find(step => step.phase === 'announce' && step.moveId)?.sideId, 'player')
  }
})

test('Speed trained Flutter Mane moves before maximum speed Archaludon without modifiers', () => {
  for (const heldItemId of [null, 'assault-vest', 'leftovers', 'power-herb']) {
    const state = battle([mon('flutter-mane', ['moonblast'], { nature: '겁쟁이', trainingPoints: { speed: 32 } })],
      [mon('archaludon', ['flashcannon'], { nature: '겁쟁이', trainingPoints: { speed: 32 }, heldItemId })])
    assert(getEffectiveBattleStat(state, state.player.team[0], 'speed') > getEffectiveBattleStat(state, state.opponent.team[0], 'speed'))
    const { timeline } = turn(state)
    const attacks = timeline.filter(step => step.phase === 'announce' && step.moveId)
    assert(attacks.length > 0, JSON.stringify(timeline.map(s => [s.phase, s.moveId])))
    assert.equal(attacks[0].sideId, 'player')
  }
})
