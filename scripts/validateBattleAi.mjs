import assert from 'node:assert/strict'
import {
  chooseAiAction,
  createBattle,
  createBattleTurnTimeline,
} from '../src/data/battleEngine.js'
import { getMoveById } from '../src/data/trainingData.js'

function runtimeMove(moveId) {
  const move = getMoveById(moveId)
  return { ...move, maxPp: move.pp, currentPp: move.pp }
}

function battleRules(activeSlots = 1) {
  return {
    weather: { id: 'clear', label: '맑음' },
    terrain: { id: 'neutral', label: '일반 필드' },
    format: {
      id: activeSlots === 1 ? 'single' : 'double',
      label: activeSlots === 1 ? '싱글배틀' : '더블배틀',
      activeSlots,
      actionSlots: activeSlots,
    },
    teamRule: { id: 'full', label: '6대6', battleSize: 6 },
    disabledGimmickId: null,
    gimmickRestriction: { id: null, label: '제한 없음' },
  }
}

function makeBattle({
  playerCount = 1,
  opponentCount = 1,
  activeSlots = 1,
  opponentEntry = {},
} = {}) {
  return createBattle({
    playerPokemon: Array.from({ length: playerCount }, (_, index) => ({
      speciesId: [9, 450, 3][index] ?? 9,
      captureId: `player-${index}`,
    })),
    opponent: { name: '검증 AI', tier: 'S' },
    opponentTeam: {
      pokemon: Array.from({ length: opponentCount }, (_, index) => ({
        speciesId: [25, 6, 149][index] ?? 25,
        captureId: `ai-${index}`,
        ...opponentEntry,
      })),
      battleGimmicks: [],
      strategy: {},
    },
    rules: battleRules(activeSlots),
  })
}

{
  const state = makeBattle()
  state.opponent.team[0].moves = [runtimeMove('thunderbolt'), runtimeMove('tackle')]
  state.player.team[0].types = ['물']
  const action = chooseAiAction(state, () => 0)
  assert.equal(state.opponent.team[0].moves[action.moveIndex].id, 'thunderbolt')
}

{
  const state = makeBattle({ playerCount: 2, opponentCount: 2, activeSlots: 2 })
  state.opponent.team[0].moves = [runtimeMove('thunderbolt')]
  state.player.team[0].types = ['땅']
  state.player.team[1].types = ['물']
  const action = chooseAiAction(state, () => 0, 0, 0)
  assert.equal(action.targetSlot, 1)
}

{
  const state = makeBattle()
  state.opponent.team[0].moves = [runtimeMove('recover'), runtimeMove('tackle')]
  const action = chooseAiAction(state, () => 0)
  assert.equal(state.opponent.team[0].moves[action.moveIndex].id, 'tackle')
}

{
  const state = makeBattle({ opponentCount: 2 })
  state.opponent.team[0].moves = [runtimeMove('thunderbolt')]
  state.opponent.team[0].types = ['전기']
  state.player.team[0].moves = [runtimeMove('earthquake')]
  state.player.team[0].types = ['땅']
  state.opponent.team[1].moves = [runtimeMove('icebeam')]
  state.opponent.team[1].types = ['비행']
  const action = chooseAiAction(state, () => 0)
  assert.equal(action.type, 'switch')
  assert.equal(action.targetIndex, 1)
}

{
  const state = makeBattle({
    opponentEntry: {
      battleMechanics: ['z-move'],
      heldItemId: 'electrium-z--held',
    },
  })
  state.opponent.team[0].moves = [runtimeMove('thunderbolt'), runtimeMove('tackle')]
  state.player.team[0].types = ['물']
  state.player.team[0].hp = Math.ceil(state.player.team[0].maxHp * 0.7)
  const action = chooseAiAction(state, () => 0)
  assert.equal(action.gimmick, 'zmove')
}

{
  const state = makeBattle({
    playerCount: 2,
    opponentCount: 2,
    activeSlots: 2,
    opponentEntry: {
      battleMechanics: ['z-move'],
      heldItemId: 'electrium-z--held',
    },
  })
  state.player.team.forEach((pokemon) => {
    pokemon.types = ['물']
    pokemon.moves = [runtimeMove('tackle')]
  })
  state.opponent.team.forEach((pokemon) => {
    pokemon.moves = [runtimeMove('thunderbolt')]
  })
  const { timeline } = createBattleTurnTimeline(state, [
    { type: 'move', actorSlot: 0, targetSlot: 0, moveIndex: 0, gimmick: null },
    { type: 'move', actorSlot: 1, targetSlot: 1, moveIndex: 0, gimmick: null },
  ], () => 0.5)
  const opponentZMoves = timeline.filter((step) => (
    step.phase === 'gimmick' && step.sideId === 'opponent' && step.mechanicId === 'zmove'
  ))
  assert.equal(opponentZMoves.length, 1)
}

process.stdout.write('Validated 6 advanced battle AI decisions.\n')
