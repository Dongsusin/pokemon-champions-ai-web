import assert from 'node:assert/strict'

import battleMoveData from '../src/data/generatedBattleMoves.json' with { type: 'json' }
import {
  createBattle,
  createBattlePreviewPokemon,
  createBattleTurnTimeline,
} from '../src/data/battleEngine.js'
import { isBattleMoveSupported } from '../src/data/moveSupportData.js'
import {
  getLearnableMoves,
  HIDDEN_POWER_TYPES,
  normalizePokemon,
  resolveMoveForPokemon,
  SPECIES_PROFILES,
} from '../src/data/trainingData.js'

const hiddenPowerMoves = battleMoveData.moves.filter((move) => move.id.startsWith('hiddenpower'))
assert.deepEqual(hiddenPowerMoves.map((move) => move.id), ['hiddenpower'])
assert.equal(HIDDEN_POWER_TYPES.length, 16)

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

const hiddenPowerLearner = profiles.find((profile) => (
  getLearnableMoves(profile.id).some((move) => move.id === 'hiddenpower')
))
assert.ok(hiddenPowerLearner, '잠재파워를 배울 수 있는 포켓몬이 필요합니다.')

const configuredPokemon = normalizePokemon({
  captureId: 'hidden-power-validation',
  speciesId: hiddenPowerLearner.id,
  hiddenPowerType: '불꽃',
  moves: ['잠재파워'],
})
const resolvedHiddenPower = resolveMoveForPokemon(hiddenPowerMoves[0], configuredPokemon)
assert.equal(resolvedHiddenPower.type, '불꽃')
assert.match(resolvedHiddenPower.description, /현재 설정은 불꽃타입/)

const battlePokemon = createBattlePreviewPokemon({
  ...configuredPokemon,
  moveIds: ['hiddenpower'],
})
assert.equal(battlePokemon.moves.find((move) => move.id === 'hiddenpower')?.type, '불꽃')

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
console.log(`Hidden Power types: ${HIDDEN_POWER_TYPES.join(', ')}`)
if (emptyProfiles.length > 0) {
  console.log(`Profiles without an engine-supported move: ${emptyProfiles.map((profile) => profile.name).join(', ')}`)
}
