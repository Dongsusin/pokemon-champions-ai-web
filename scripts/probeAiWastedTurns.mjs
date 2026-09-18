import {
  chooseAiActionsForSide,
  chooseAiReplacementIndex,
  createBattle,
  forcePlayerSwitch,
  getActivePokemonList,
  playBattleTurnWithActions,
} from '../src/data/battleEngine.js'
import { getTrainer, getTrainerTeam } from '../src/data/trainerTeams.js'
import { getBattleTypeEffectiveness } from '../src/data/battleEngine.js'

// Counts the turns the predictive AI throws away: a move the target was immune
// to, a move that simply failed, or a miss. "Do not use moves that do not work"
// is only a claim until the wasted-turn rate is on the board, so this plays the
// AI against itself over the real trainer teams and reports it.
const TRAINERS = (process.env.AI_WASTE_TRAINERS ?? '레드,난천,단델,아이리스,성호,네모,지우,N')
  .split(',').map(name => name.trim()).filter(Boolean)
const TEAMS = (process.env.AI_WASTE_TEAMS ?? '1,2,3').split(',').map(Number).filter(value => value >= 1 && value <= 3)
const DIFFICULTY = ['easy', 'normal', 'hard'].includes(process.env.AI_WASTE_DIFFICULTY)
  ? process.env.AI_WASTE_DIFFICULTY
  : 'normal'

// Messages the engine writes when an action accomplished nothing. Each one is a
// turn the side could have spent on something that worked.
const WASTE_PATTERNS = [
  { id: 'immune', test: message => /효과가 없|무효화했다|들어가지 않는다/.test(message) },
  { id: 'failed', test: message => /실패했다|통하지 않았다|아무 일도 일어나지 않았다/.test(message) },
  { id: 'missed', test: message => /빗나갔다|맞지 않았다/.test(message) },
]

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
    aiDifficulty: { id: DIFFICULTY, boostStage: 0 },
    gimmickRestriction: { id: null, label: '제한 없음' },
  }
}

// The log names the Pokemon that acted, so waste is attributed by matching the
// message against the side's active names rather than by guessing turn order.
function attribute(message, ownNames, foeNames) {
  const ownHit = ownNames.some(name => name && message.startsWith(name))
  const foeHit = foeNames.some(name => name && message.startsWith(name))
  if (ownHit && !foeHit) return 'own'
  if (foeHit && !ownHit) return 'foe'
  return null
}

function runMatch(playerName, opponentName, teamNumber, seed, tally) {
  const playerTeam = getTrainerTeam(playerName, teamNumber)
  const opponentTrainer = getTrainer(opponentName)
  const opponentTeam = getTrainerTeam(opponentName, teamNumber)
  if (!playerTeam || !opponentTeam || !opponentTrainer) return
  let state = createBattle({
    playerPokemon: playerTeam.pokemon,
    opponent: { ...opponentTrainer, tier: 'S' },
    opponentTeam,
    rules: battleRules(),
  })
  const playerRandom = seededRandom(seed * 7919 + 17)
  const opponentRandom = seededRandom(seed * 7919 + 31)
  const battleRandom = seededRandom(seed * 7919 + 47)

  while (!state.winner && state.turn <= 80) {
    if (state.awaitingPlayerSwitch) {
      const index = chooseAiReplacementIndex(state, 'player')
      state = forcePlayerSwitch(state, index ?? 0)
      continue
    }
    const names = sideId => getActivePokemonList(state, sideId)
      .filter(pokemon => pokemon && pokemon.hp > 0 && !pokemon.fainted)
      .map(pokemon => pokemon.name)
    const playerNames = names('player')
    const opponentNames = names('opponent')
    const playerActions = chooseAiActionsForSide(state, 'player', playerRandom)
    const opponentActions = chooseAiActionsForSide(state, 'opponent', opponentRandom)
    for (const [sideId, actions] of [['player', playerActions], ['opponent', opponentActions]]) {
      for (const action of actions) {
        if (action?.type === 'move') tally[sideId].moves += 1
      }
    }
    // The engine trims its log to the last 80 entries, so counting indexes
    // across turns reads stale lines. Resume from the last entry we saw.
    const lastSeenId = state.log.at(-1)?.id ?? null
    const next = playBattleTurnWithActions(state, playerActions, opponentActions, battleRandom)
    const resumeIndex = lastSeenId ? next.log.findIndex(entry => entry.id === lastSeenId) : -1
    const fresh = next.log.slice(resumeIndex + 1)
    for (const entry of fresh) {
      const message = String(entry?.message ?? '')
      for (const pattern of WASTE_PATTERNS) {
        if (!pattern.test(message)) continue
        const owner = attribute(message, opponentNames, playerNames)
        // A miss or immunity is reported against the Pokemon that was hit, so
        // the wasted turn belongs to the other side.
        if (owner === 'own') tally.player[pattern.id] += 1
        else if (owner === 'foe') tally.opponent[pattern.id] += 1
        // An immunity is only a mistake when the attacker had a move that would
        // have landed, or a bench Pokemon that could have come in instead.
        if (pattern.id === 'immune' && owner) {
          const attackerSideId = owner === 'own' ? 'player' : 'opponent'
          const defenderSideId = owner === 'own' ? 'opponent' : 'player'
          const attacker = getActivePokemonList(state, attackerSideId)
            .find(pokemon => pokemon && pokemon.hp > 0 && !pokemon.fainted)
          const defender = getActivePokemonList(state, defenderSideId)
            .find(pokemon => pokemon && message.startsWith(pokemon.name))
          const chosen = (attackerSideId === 'player' ? playerActions : opponentActions)
            .find(action => action?.type === 'move')
          if (attacker && defender) {
            const landing = attacker.moves.filter(move => (
              move.currentPp > 0
              && move.category !== '변화'
              && getBattleTypeEffectiveness(state, move.type, defender.types) > 0
            )).length
            const bench = getSide(state, attackerSideId).team
              .filter((pokemon, index) => pokemon.hp > 0 && !pokemon.fainted
                && !getSide(state, attackerSideId).activeIndexes?.includes(index)).length
            tally.incidents.push({
              turn: state.turn,
              attacker: attacker.name,
              defender: `${defender.name} (${defender.types.join('/')})`,
              message: message.slice(0, 40),
              chose: chosen ? attacker.moves[chosen.moveIndex]?.id ?? `#${chosen.moveIndex}` : null,
              choseType: chosen ? attacker.moves[chosen.moveIndex]?.type ?? null : null,
              moves: attacker.moves.map(move => `${move.id}:${move.type}:${getBattleTypeEffectiveness(state, move.type, defender.types)}`),
              landingMovesAvailable: landing,
              benchAvailable: bench,
            })
          }
        }
      }
    }
    state = next
  }
}

const getSide = (state, sideId) => (sideId === 'player' ? state.player : state.opponent)
const tally = {
  player: { moves: 0, immune: 0, failed: 0, missed: 0 },
  opponent: { moves: 0, immune: 0, failed: 0, missed: 0 },
  incidents: [],
}
let matches = 0
for (const playerName of TRAINERS) {
  for (const opponentName of TRAINERS) {
    if (playerName === opponentName) continue
    for (const teamNumber of TEAMS) {
      runMatch(playerName, opponentName, teamNumber, matches + 1, tally)
      matches += 1
    }
  }
}

const report = side => {
  const data = tally[side]
  const wasted = data.immune + data.failed
  return {
    moves: data.moves,
    immune: data.immune,
    failed: data.failed,
    missed: data.missed,
    wastedPerHundredMoves: Number((wasted / Math.max(1, data.moves) * 100).toFixed(2)),
  }
}
console.log(JSON.stringify({
  difficulty: DIFFICULTY,
  matches,
  player: report('player'),
  opponent: report('opponent'),
  avoidableImmunities: tally.incidents.filter(entry => entry.landingMovesAvailable > 0).length,
  incidents: tally.incidents.slice(0, 12),
}, null, 2))
