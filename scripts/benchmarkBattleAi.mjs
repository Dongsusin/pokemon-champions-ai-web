import assert from 'node:assert/strict'
import {
  chooseAiActionsForSide,
  chooseAiReplacementIndex,
  createBattle,
  forcePlayerSwitch,
  getActivePokemon,
  getActivePokemonList,
  getAvailableBattleMechanics,
  getBattleMovePreview,
  getBattleTypeEffectiveness,
  getForcedBattleAction,
  playBattleTurnWithActions,
} from '../src/data/battleEngine.js'
import { getTrainer, getTrainerTeam } from '../src/data/trainerTeams.js'

const BENCHMARK_TRAINERS = ['레드', '난천', '단델', '아이리스', '성호', '네모', '지우', 'N']
const BENCHMARK_REPEATS = Math.max(
  1,
  Number.parseInt(process.env.BATTLE_AI_BENCHMARK_REPEATS ?? '1', 10) || 1,
)

function seededRandom(seed) {
  let value = seed >>> 0
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0
    return value / 0x100000000
  }
}

function battleRules() {
  return {
    weather: { id: 'clear', label: '맑음' },
    terrain: { id: 'neutral', label: '일반 필드' },
    format: { id: 'single', label: '싱글배틀', activeSlots: 1, actionSlots: 1 },
    teamRule: { id: 'full', label: '6대6', battleSize: 6 },
    disabledGimmickId: null,
    gimmickRestriction: { id: null, label: '제한 없음' },
  }
}

function accuracyRatio(move) {
  if (move?.accuracyLabel === '필중' || move?.accuracy == null) return 1
  return Math.max(0, Math.min(1, Number(move.accuracy) / 100))
}

function baselineMoveScore(state, sideId, activeSlot, targetSlot, moveIndex, gimmick) {
  const attacker = getActivePokemon(state, sideId, activeSlot)
  const defender = getActivePokemon(state, sideId === 'player' ? 'opponent' : 'player', targetSlot)
  const move = getBattleMovePreview(state, sideId, moveIndex, activeSlot, targetSlot, gimmick)
  if (!attacker || !defender || !move || attacker.moves[moveIndex]?.currentPp <= 0) return -Infinity

  if (move.categoryId === 'status' || move.category === '변화') {
    const hpRatio = attacker.hp / Math.max(1, attacker.maxHp)
    if (move.heal) return hpRatio < 0.45 ? 78 : 12
    if (move.target === 'self' || move.self?.boosts || move.boosts) return hpRatio > 0.65 ? 46 : 18
    return 24 * accuracyRatio(move)
  }

  const effectiveness = getBattleTypeEffectiveness(state, move.type, defender.types)
  if (effectiveness <= 0) return -Infinity
  const stab = attacker.types.includes(move.type) ? 1.5 : 1
  const knockoutPressure = Number(move.power) * effectiveness * stab >= defender.hp ? 45 : 0
  return Number(move.power || 1) * effectiveness * stab * accuracyRatio(move)
    + Math.max(0, Number(move.priority || 0)) * 18
    + knockoutPressure
    + (gimmick ? 14 : 0)
}

function chooseBaselineActions(state, sideId) {
  const targetSideId = sideId === 'player' ? 'opponent' : 'player'
  const targetSlots = getActivePokemonList(state, targetSideId)
    .map((pokemon, slot) => (pokemon.hp > 0 && !pokemon.fainted ? slot : -1))
    .filter((slot) => slot >= 0)

  return getActivePokemonList(state, sideId).flatMap((attacker, activeSlot) => {
    if (!attacker || attacker.hp <= 0 || attacker.fainted) return []
    const forcedAction = getForcedBattleAction(state, sideId, activeSlot)
    if (forcedAction) return [{ ...forcedAction, actorSlot: activeSlot, targetSlot: targetSlots[0] ?? 0 }]

    const mechanics = [
      null,
      ...getAvailableBattleMechanics(state, sideId, activeSlot).map((mechanic) => mechanic.id),
    ]
    const candidates = []
    attacker.moves.forEach((move, moveIndex) => {
      if (!move || move.currentPp <= 0) return
      targetSlots.forEach((targetSlot) => {
        mechanics.forEach((gimmick) => {
          candidates.push({
            action: { type: 'move', actorSlot: activeSlot, targetSlot, moveIndex, gimmick },
            score: baselineMoveScore(state, sideId, activeSlot, targetSlot, moveIndex, gimmick),
          })
        })
      })
    })
    candidates.sort((first, second) => second.score - first.score)
    return [candidates[0]?.action ?? {
      type: 'move',
      actorSlot: activeSlot,
      targetSlot: targetSlots[0] ?? 0,
      moveIndex: 0,
      gimmick: null,
    }]
  })
}

function resolveAutomatedPlayerSwitches(state) {
  let resolved = state
  while (!resolved.winner && resolved.awaitingPlayerSwitch) {
    const activeSlot = resolved.awaitingPlayerSwitchSlots[0] ?? 0
    const targetIndex = chooseAiReplacementIndex(resolved, 'player', activeSlot)
    if (targetIndex == null) break
    resolved = forcePlayerSwitch(resolved, targetIndex)
  }
  return resolved
}

function sideStrength(side) {
  return side.team.reduce((total, pokemon) => (
    total + (pokemon.hp > 0 && !pokemon.fainted ? 1000 + pokemon.hp / Math.max(1, pokemon.maxHp) * 100 : 0)
  ), 0)
}

function resolveTimedWinner(state) {
  if (state.winner) return state.winner
  const playerStrength = sideStrength(state.player)
  const opponentStrength = sideStrength(state.opponent)
  if (playerStrength === opponentStrength) return null
  return playerStrength > opponentStrength ? 'player' : 'opponent'
}

function runMatch(playerName, opponentName, advancedSide, teamNumber, seed) {
  const playerTrainer = getTrainer(playerName)
  const opponentTrainer = getTrainer(opponentName)
  const playerTeam = getTrainerTeam(playerName, teamNumber)
  const opponentTeam = getTrainerTeam(opponentName, teamNumber)
  assert(playerTrainer && opponentTrainer && playerTeam && opponentTeam)

  const random = seededRandom(seed * 7919 + 17)
  let state = createBattle({
    playerPokemon: playerTeam.pokemon,
    opponent: { ...opponentTrainer, tier: 'S' },
    opponentTeam,
    rules: battleRules(),
  })
  const decisionStats = {
    advanced: { moves: 0, switches: 0, gimmicks: 0, statusMoves: 0 },
    baseline: { moves: 0, switches: 0, gimmicks: 0, statusMoves: 0 },
  }

  while (!state.winner && state.turn <= 80) {
    state = resolveAutomatedPlayerSwitches(state)
    if (state.winner || state.awaitingPlayerSwitch) break
    const playerActions = advancedSide === 'player'
      ? chooseAiActionsForSide(state, 'player', random)
      : chooseBaselineActions(state, 'player')
    const opponentActions = advancedSide === 'opponent'
      ? chooseAiActionsForSide(state, 'opponent', random)
      : chooseBaselineActions(state, 'opponent')
    ;[
      ['player', playerActions],
      ['opponent', opponentActions],
    ].forEach(([sideId, actions]) => {
      const policyStats = decisionStats[sideId === advancedSide ? 'advanced' : 'baseline']
      actions.forEach((action) => {
        if (action.type === 'switch') {
          policyStats.switches += 1
          return
        }
        policyStats.moves += 1
        if (action.gimmick) policyStats.gimmicks += 1
        const attacker = getActivePokemon(state, sideId, action.actorSlot)
        const move = attacker?.moves[action.moveIndex]
        if (move?.categoryId === 'status') policyStats.statusMoves += 1
      })
    })
    state = playBattleTurnWithActions(state, playerActions, opponentActions, random)
  }

  const winner = resolveTimedWinner(state)
  return {
    playerName,
    opponentName,
    advancedSide,
    teamNumber,
    winner,
    advancedWon: winner === advancedSide,
    turns: Math.min(80, state.turn - 1),
    decisionStats,
  }
}

const results = BENCHMARK_TRAINERS.flatMap((trainerName, trainerIndex) => (
  [1, 2, 3].flatMap((teamNumber) => {
    return Array.from({ length: BENCHMARK_REPEATS }, (_, repeatIndex) => {
      const seed = trainerIndex * 1000 + teamNumber * 100 + repeatIndex * 10
      return [
        runMatch(trainerName, trainerName, 'player', teamNumber, seed + 1),
        runMatch(trainerName, trainerName, 'opponent', teamNumber, seed + 2),
      ]
    }).flat()
  })
))
const wins = results.filter((result) => result.advancedWon).length
const draws = results.filter((result) => result.winner == null).length
const losses = results.length - wins - draws
const winRate = wins / Math.max(1, results.length - draws)
const averageTurns = results.reduce((total, result) => total + result.turns, 0) / results.length
const decisionStats = results.reduce((summary, result) => {
  ;['advanced', 'baseline'].forEach((policy) => {
    Object.entries(result.decisionStats[policy]).forEach(([key, value]) => {
      summary[policy][key] += value
    })
  })
  return summary
}, {
  advanced: { moves: 0, switches: 0, gimmicks: 0, statusMoves: 0 },
  baseline: { moves: 0, switches: 0, gimmicks: 0, statusMoves: 0 },
})
const outcomeStats = ['wins', 'losses'].reduce((summary, outcome) => {
  const selected = results.filter((result) => (outcome === 'wins' ? result.advancedWon : !result.advancedWon))
  const totals = selected.reduce((counts, result) => {
    Object.entries(result.decisionStats.advanced).forEach(([key, value]) => {
      counts[key] += value
    })
    return counts
  }, { moves: 0, switches: 0, gimmicks: 0, statusMoves: 0 })
  summary[outcome] = Object.fromEntries(Object.entries(totals).map(([key, value]) => [
    key,
    Number((value / Math.max(1, selected.length)).toFixed(1)),
  ]))
  return summary
}, {})
const summary = {
  repeats: BENCHMARK_REPEATS,
  matches: results.length,
  wins,
  losses,
  draws,
  winRate: Number((winRate * 100).toFixed(1)),
  averageTurns: Number(averageTurns.toFixed(1)),
  decisionStats,
  advancedAverages: outcomeStats,
}

process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
if (process.env.BATTLE_AI_BENCHMARK_DETAILS === '1' || winRate < 0.6) {
  process.stderr.write(`${JSON.stringify(results, null, 2)}\n`)
}
assert.ok(winRate >= 0.6, `Predictive AI benchmark win rate was only ${(winRate * 100).toFixed(1)}%`)
