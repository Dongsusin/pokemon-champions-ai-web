import assert from 'node:assert/strict'

import battleMoveData from '../src/data/generatedBattleMoves.json' with { type: 'json' }
import {
  createBattle,
  createBattleTurnTimeline,
} from '../src/data/battleEngine.js'
import { isBattleMoveSupported } from '../src/data/moveSupportData.js'
import {
  getLearnableMoves,
  SPECIES_PROFILES,
} from '../src/data/trainingData.js'

const hiddenPowerMoves = battleMoveData.moves.filter((move) => move.id.startsWith('hiddenpower'))
assert.deepEqual(hiddenPowerMoves, [])

const duplicateNames = Object.entries(Object.groupBy(battleMoveData.moves, (move) => move.name))
  .filter(([, moves]) => moves.length > 1)
assert.deepEqual(duplicateNames, [])

const unsupportedMoves = battleMoveData.moves.filter((move) => !isBattleMoveSupported(move))
const supportedUnavailableDescriptions = battleMoveData.moves.filter((move) => (
  isBattleMoveSupported(move) && move.description.startsWith('사용할 수 없는 기술입니다')
))
assert.deepEqual(supportedUnavailableDescriptions, [])

const profiles = Object.values(SPECIES_PROFILES)
profiles.forEach((profile) => {
  getLearnableMoves(profile.id).forEach((move) => {
    assert.equal(isBattleMoveSupported(move), true, `${profile.name}: ${move.name}`)
  })
})

const unown = profiles.find((profile) => profile.slug === 'unown')
assert.ok(unown)
assert.deepEqual(getLearnableMoves(unown.id).map((move) => move.id), ['struggle'])
assert.deepEqual(battleMoveData.moves.find((move) => move.id === 'struggle')?.recoil, [1, 4])

const transformBattle = createBattle({
  playerPokemon: [{ captureId: 'ditto-validation', speciesId: 132, moves: ['변신'] }],
  opponent: { name: '변신 검증', tier: 'D' },
  opponentTeam: {
    pokemon: [{ captureId: 'bulbasaur-validation', speciesId: 1, moves: ['몸통박치기'] }],
    battleGimmicks: [],
    strategy: {},
  },
})
const transformedTurn = createBattleTurnTimeline(
  transformBattle,
  { type: 'move', moveIndex: 0, actorSlot: 0, targetSlot: 0 },
  () => 0.5,
)
assert.equal(transformedTurn.state.player.team[0].speciesId, 1)
assert.equal(transformedTurn.state.player.team[0].moves[0].id, 'tackle')
assert.equal(transformedTurn.state.player.team[0].moves[0].currentPp, 5)

const emptyProfiles = profiles.filter((profile) => getLearnableMoves(profile.id).length === 0)
console.log(`Training move validation passed: ${battleMoveData.moves.length - unsupportedMoves.length} supported, ${unsupportedMoves.length} excluded.`)
if (emptyProfiles.length > 0) {
  console.log(`Profiles without an engine-supported move: ${emptyProfiles.map((profile) => profile.name).join(', ')}`)
}
