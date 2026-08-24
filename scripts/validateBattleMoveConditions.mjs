import assert from 'node:assert/strict'
import pokemonData from '../src/data/generatedPokemonData.json' with { type: 'json' }
import {
  chooseAiAction,
  createBattle,
  playBattleTurnWithActions,
} from '../src/data/battleEngine.js'
import { getMoveById } from '../src/data/trainingData.js'

const profiles = [...pokemonData.species, ...pokemonData.forms]
const profileBySlug = new Map(profiles.map((profile) => [profile.slug, profile]))

function battlePokemon(slug, moveIds, captureId) {
  const profile = profileBySlug.get(slug)
  const moves = moveIds.map((moveId) => getMoveById(moveId))
  assert(profile, `Missing species fixture: ${slug}`)
  moves.forEach((move, index) => assert(move, `Missing move fixture: ${moveIds[index]}`))

  return {
    captureId,
    speciesId: profile.id,
    slug: profile.slug,
    ability: profile.abilities[0],
    moves: moves.map((move) => move.name),
    moveIds,
  }
}

function createFakeOutBattle({ aiUsesFakeOut = false } = {}) {
  const fakeOutUser = battlePokemon('persian', ['fakeout', 'tackle'], 'fake-out-user')
  const target = battlePokemon('snorlax', ['splash'], 'fake-out-target')
  const backup = battlePokemon('magikarp', ['splash'], 'fake-out-backup')

  return createBattle({
    playerPokemon: aiUsesFakeOut ? [target] : [fakeOutUser, backup],
    opponent: { name: 'FAKE OUT TEST' },
    opponentTeam: {
      pokemon: aiUsesFakeOut ? [fakeOutUser] : [target, backup],
      battleGimmicks: [],
      strategy: {},
    },
  })
}

const fixedRandom = () => 0.5
const fakeOutAction = { type: 'move', actorSlot: 0, targetSlot: 0, moveIndex: 0, gimmick: null }
const splashAction = { type: 'move', actorSlot: 0, targetSlot: 0, moveIndex: 0, gimmick: null }

for (const moveId of ['fakeout', 'firstimpression', 'matblock']) {
  assert.equal(getMoveById(moveId)?.firstTurnOnly, true, `${moveId} should be marked first-turn-only`)
}

let state = createFakeOutBattle()
const initialTargetHp = state.opponent.team[0].hp

state = playBattleTurnWithActions(state, [fakeOutAction], [splashAction], fixedRandom)
const firstHitTargetHp = state.opponent.team[0].hp
assert(firstHitTargetHp < initialTargetHp, 'Fake Out should hit on the first action after entering battle')
assert(state.log.some((entry) => entry.message.includes('풀죽어서 움직일 수 없다')))

const logCountBeforeFailure = state.log.length
state = playBattleTurnWithActions(state, [fakeOutAction], [splashAction], fixedRandom)
assert.equal(state.opponent.team[0].hp, firstHitTargetHp, 'Repeated Fake Out should fail without dealing damage')
assert(state.log.slice(logCountBeforeFailure).some((entry) => entry.message.includes('실패했다')))

state = playBattleTurnWithActions(
  state,
  [{ type: 'switch', actorSlot: 0, targetIndex: 1 }],
  [splashAction],
  fixedRandom,
)
state = playBattleTurnWithActions(
  state,
  [{ type: 'switch', actorSlot: 0, targetIndex: 0 }],
  [splashAction],
  fixedRandom,
)
const targetHpBeforeReentryFakeOut = state.opponent.team[0].hp
state = playBattleTurnWithActions(state, [fakeOutAction], [splashAction], fixedRandom)
assert(
  state.opponent.team[0].hp < targetHpBeforeReentryFakeOut,
  'Fake Out should become usable again after switching out and back in',
)

let aiState = createFakeOutBattle({ aiUsesFakeOut: true })
aiState = playBattleTurnWithActions(aiState, [splashAction], [fakeOutAction], fixedRandom)
const aiAction = chooseAiAction(aiState, fixedRandom)
assert.equal(aiAction.type, 'move')
assert.notEqual(aiAction.moveIndex, fakeOutAction.moveIndex, 'AI should not repeat an unavailable Fake Out')

console.log('Validated first-action-only moves, Fake Out flinch timing, switch reset, and AI selection.')
