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

const DEFAULT_BENCHMARK_TRAINERS = ['레드', '난천', '단델', '아이리스', '성호', '네모', '지우', 'N']
const BENCHMARK_TRAINERS = (process.env.BATTLE_AI_BENCHMARK_TRAINERS ?? '')
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean)
const SELECTED_TRAINERS = BENCHMARK_TRAINERS.length > 0 ? BENCHMARK_TRAINERS : DEFAULT_BENCHMARK_TRAINERS
const BENCHMARK_TEAMS = (process.env.BATTLE_AI_BENCHMARK_TEAMS ?? '1,2,3')
  .split(',')
  .map((value) => Number.parseInt(value.trim(), 10))
  .filter((value) => value >= 1 && value <= 3)
const BENCHMARK_SIDES = (process.env.BATTLE_AI_BENCHMARK_SIDES ?? 'player,opponent')
  .split(',')
  .map((value) => value.trim())
  .filter((value) => ['player', 'opponent'].includes(value))
const BENCHMARK_REPEATS = Math.max(
  1,
  Number.parseInt(process.env.BATTLE_AI_BENCHMARK_REPEATS ?? '1', 10) || 1,
)
const INCLUDE_ANALYSIS = process.env.BATTLE_AI_BENCHMARK_ANALYSIS === '1'
const TRACE_SEED = Number.parseInt(process.env.BATTLE_AI_TRACE_SEED ?? '', 10)
const MIN_WIN_RATE = Math.max(0, Math.min(
  1,
  Number.parseFloat(process.env.BATTLE_AI_MIN_WIN_RATE ?? '0.6') || 0,
))

function incrementCount(counts, key) {
  if (!key) return
  counts[key] = (counts[key] ?? 0) + 1
}

function topCounts(counts, limit = 5) {
  return Object.entries(counts)
    .sort((first, second) => second[1] - first[1] || first[0].localeCompare(second[0], 'ko'))
    .slice(0, limit)
    .map(([id, count]) => ({ id, count }))
}

function mergeCounts(target, source) {
  Object.entries(source).forEach(([id, count]) => {
    target[id] = (target[id] ?? 0) + count
  })
}

function lossLinkedCounts(lossCounts, winCounts, losses, wins, limit = 5) {
  return Object.entries(lossCounts)
    .map(([id, count]) => {
      const lossUsesPerMatch = count / Math.max(1, losses)
      const winUsesPerMatch = (winCounts[id] ?? 0) / Math.max(1, wins)
      return {
        id,
        lossUsesPerMatch: Number(lossUsesPerMatch.toFixed(2)),
        winUsesPerMatch: Number(winUsesPerMatch.toFixed(2)),
        excessUses: Number((lossUsesPerMatch - winUsesPerMatch).toFixed(2)),
      }
    })
    .filter((entry) => entry.excessUses > 0)
    .sort((first, second) => second.excessUses - first.excessUses || first.id.localeCompare(second.id, 'ko'))
    .slice(0, limit)
}

function sideSnapshot(side) {
  const activeIndexSet = new Set(side.activeIndexes)
  return {
    active: side.activeIndexes.map((index) => {
      const pokemon = side.team[index]
      return {
        index,
        name: pokemon.name,
        hp: pokemon.hp,
        maxHp: pokemon.maxHp,
        stages: { ...pokemon.statStages },
      }
    }),
    bench: side.team
      .map((pokemon, index) => ({ pokemon, index }))
      .filter(({ pokemon, index }) => !activeIndexSet.has(index) && pokemon.hp > 0 && !pokemon.fainted)
      .map(({ pokemon, index }) => ({ index, name: pokemon.name, hp: pokemon.hp, maxHp: pokemon.maxHp })),
    fainted: side.team.filter((pokemon) => pokemon.hp <= 0 || pokemon.fainted).length,
  }
}

function actionSnapshot(state, sideId, action) {
  const attacker = getActivePokemon(state, sideId, action.actorSlot)
  if (action.type === 'switch') {
    return {
      actor: attacker?.name ?? '?',
      action: 'switch',
      target: state[sideId].team[action.targetIndex]?.name ?? '?',
    }
  }
  return {
    actor: attacker?.name ?? '?',
    action: attacker?.moves[action.moveIndex]?.id ?? '?',
    gimmick: action.gimmick ?? null,
  }
}

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
  const advancedChoices = { moves: {}, switches: {}, gimmicks: {} }
  const trace = seed === TRACE_SEED ? [] : null

  while (!state.winner && state.turn <= 80) {
    state = resolveAutomatedPlayerSwitches(state)
    if (state.winner || state.awaitingPlayerSwitch) break
    const playerActions = advancedSide === 'player'
      ? chooseAiActionsForSide(state, 'player', random)
      : chooseBaselineActions(state, 'player')
    const opponentActions = advancedSide === 'opponent'
      ? chooseAiActionsForSide(state, 'opponent', random)
      : chooseBaselineActions(state, 'opponent')
    const traceEntry = trace ? {
      turn: state.turn,
      before: {
        player: sideSnapshot(state.player),
        opponent: sideSnapshot(state.opponent),
      },
      playerActions: playerActions.map((action) => actionSnapshot(state, 'player', action)),
      opponentActions: opponentActions.map((action) => actionSnapshot(state, 'opponent', action)),
    } : null
    ;[
      ['player', playerActions],
      ['opponent', opponentActions],
    ].forEach(([sideId, actions]) => {
      const policyStats = decisionStats[sideId === advancedSide ? 'advanced' : 'baseline']
      actions.forEach((action) => {
        if (action.type === 'switch') {
          policyStats.switches += 1
          if (sideId === advancedSide) {
            const source = getActivePokemon(state, sideId, action.actorSlot)
            const target = state[sideId].team[action.targetIndex]
            incrementCount(advancedChoices.switches, `${source?.name ?? '?'} -> ${target?.name ?? '?'}`)
          }
          return
        }
        policyStats.moves += 1
        if (action.gimmick) {
          policyStats.gimmicks += 1
          if (sideId === advancedSide) incrementCount(advancedChoices.gimmicks, action.gimmick)
        }
        const attacker = getActivePokemon(state, sideId, action.actorSlot)
        const move = attacker?.moves[action.moveIndex]
        if (sideId === advancedSide) incrementCount(advancedChoices.moves, move?.id)
        if (move?.categoryId === 'status') policyStats.statusMoves += 1
      })
    })
    state = playBattleTurnWithActions(state, playerActions, opponentActions, random)
    if (traceEntry) {
      traceEntry.after = {
        player: sideSnapshot(state.player),
        opponent: sideSnapshot(state.opponent),
      }
      trace.push(traceEntry)
    }
  }

  const winner = resolveTimedWinner(state)
  return {
    playerName,
    opponentName,
    advancedSide,
    teamNumber,
    seed,
    winner,
    advancedWon: winner === advancedSide,
    turns: Math.min(80, state.turn - 1),
    decisionStats,
    advancedChoices,
    finalState: {
      advancedRemaining: state[advancedSide].team.filter((pokemon) => pokemon.hp > 0 && !pokemon.fainted).length,
      baselineRemaining: state[advancedSide === 'player' ? 'opponent' : 'player'].team
        .filter((pokemon) => pokemon.hp > 0 && !pokemon.fainted).length,
      timedOut: !state.winner,
    },
    ...(trace ? { trace } : {}),
  }
}

function createLossAnalysis(results) {
  const matchupGroups = new Map()
  results.forEach((result) => {
    const key = `${result.playerName} · 팀 ${result.teamNumber}`
    const group = matchupGroups.get(key) ?? {
      matchup: key,
      matches: 0,
      wins: 0,
      losses: 0,
      winMoves: {},
      winSwitches: {},
      lossMoves: {},
      lossSwitches: {},
      lossGimmicks: {},
      lossExamples: [],
    }
    group.matches += 1
    if (result.advancedWon) {
      group.wins += 1
      mergeCounts(group.winMoves, result.advancedChoices.moves)
      mergeCounts(group.winSwitches, result.advancedChoices.switches)
    } else {
      group.losses += 1
      mergeCounts(group.lossMoves, result.advancedChoices.moves)
      mergeCounts(group.lossSwitches, result.advancedChoices.switches)
      mergeCounts(group.lossGimmicks, result.advancedChoices.gimmicks)
      if (group.lossExamples.length < 6) {
        group.lossExamples.push({
          seed: result.seed,
          advancedSide: result.advancedSide,
          turns: result.turns,
          advancedRemaining: result.finalState.advancedRemaining,
          baselineRemaining: result.finalState.baselineRemaining,
        })
      }
    }
    matchupGroups.set(key, group)
  })

  return [...matchupGroups.values()]
    .map((group) => ({
      matchup: group.matchup,
      matches: group.matches,
      wins: group.wins,
      losses: group.losses,
      winRate: Number((group.wins / Math.max(1, group.matches) * 100).toFixed(1)),
      topLossMoves: topCounts(group.lossMoves),
      topLossSwitches: topCounts(group.lossSwitches, 3),
      lossLinkedMoves: lossLinkedCounts(group.lossMoves, group.winMoves, group.losses, group.wins),
      lossLinkedSwitches: lossLinkedCounts(
        group.lossSwitches,
        group.winSwitches,
        group.losses,
        group.wins,
        3,
      ),
      lossGimmicks: topCounts(group.lossGimmicks, 5),
      lossExamples: group.lossExamples,
    }))
    .sort((first, second) => first.winRate - second.winRate || second.losses - first.losses)
}

const results = SELECTED_TRAINERS.flatMap((trainerName) => {
  const trainerIndex = DEFAULT_BENCHMARK_TRAINERS.indexOf(trainerName)
  return BENCHMARK_TEAMS.flatMap((teamNumber) => {
    return Array.from({ length: BENCHMARK_REPEATS }, (_, repeatIndex) => {
      const seed = trainerIndex * 1000 + teamNumber * 100 + repeatIndex * 10
      return BENCHMARK_SIDES.map((advancedSide) => runMatch(
        trainerName,
        trainerName,
        advancedSide,
        teamNumber,
        seed + (advancedSide === 'player' ? 1 : 2),
      ))
    }).flat()
  })
})
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
  trainers: SELECTED_TRAINERS,
  teams: BENCHMARK_TEAMS,
  advancedSides: BENCHMARK_SIDES,
  minimumWinRate: Number((MIN_WIN_RATE * 100).toFixed(1)),
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
if (INCLUDE_ANALYSIS) summary.weakMatchups = createLossAnalysis(results)
const tracedResult = results.find((result) => result.trace)
if (tracedResult) summary.traceMatch = tracedResult

process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
if (process.env.BATTLE_AI_BENCHMARK_DETAILS === '1' || winRate < MIN_WIN_RATE) {
  process.stderr.write(`${JSON.stringify(results, null, 2)}\n`)
}
assert.ok(
  winRate >= MIN_WIN_RATE,
  `Predictive AI benchmark win rate was only ${(winRate * 100).toFixed(1)}%`,
)
