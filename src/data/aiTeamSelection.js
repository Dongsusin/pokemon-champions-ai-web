import { getTypeEffectiveness } from './battleEngine.js'
import {
  getMove,
  getMoveById,
  getSpeciesProfile,
  NATURE_OPTIONS,
  STAT_META,
} from './trainingData.js'

const ABILITY_TYPE_IMMUNITIES = new Map([
  ['levitate', '땅'],
  ['부유', '땅'],
  ['flashfire', '불꽃'],
  ['타오르는불꽃', '불꽃'],
  ['waterabsorb', '물'],
  ['저수', '물'],
  ['stormdrain', '물'],
  ['마중물', '물'],
  ['dryskin', '물'],
  ['건조피부', '물'],
  ['voltabsorb', '전기'],
  ['축전', '전기'],
  ['lightningrod', '전기'],
  ['피뢰침', '전기'],
  ['motordrive', '전기'],
  ['전기엔진', '전기'],
  ['sapsipper', '풀'],
  ['초식', '풀'],
])

const HAZARD_MOVE_IDS = new Set(['stealthrock', 'spikes', 'toxicspikes', 'stickyweb'])
const HAZARD_CLEAR_MOVE_IDS = new Set(['rapidspin', 'defog', 'mortalspin', 'tidyup'])
const PIVOT_MOVE_IDS = new Set(['uturn', 'voltswitch', 'flipturn', 'partingshot', 'teleport'])
const RECOVERY_MOVE_IDS = new Set([
  'recover',
  'roost',
  'slackoff',
  'softboiled',
  'synthesis',
  'moonlight',
  'morningsun',
  'shoreup',
  'strengthsap',
  'rest',
  'wish',
  'milkdrink',
])
const SPEED_CONTROL_MOVE_IDS = new Set([
  'tailwind',
  'trickroom',
  'thunderwave',
  'icywind',
  'electroweb',
  'stickyweb',
])
const MATCHUP_POKEMON_CACHE = new WeakMap()
const COUNTER_TEAM_RANKING_CACHE = new WeakMap()

function resolveMoves(entry) {
  const movesById = (entry.moveIds ?? []).map((moveId) => getMoveById(moveId)).filter(Boolean)
  const movesByName = (entry.moves ?? []).map((moveEntry) => {
    if (moveEntry && typeof moveEntry === 'object') return getMoveById(moveEntry.id) ?? moveEntry
    const move = getMove(moveEntry)
    return move?.name === moveEntry ? move : null
  }).filter(Boolean)

  return [...new Map([...movesById, ...movesByName].map((move) => [move.id, move])).values()]
}

function createMatchupPokemon(entry) {
  const cached = entry && typeof entry === 'object' ? MATCHUP_POKEMON_CACHE.get(entry) : null
  if (cached) return cached
  const species = getSpeciesProfile(entry.speciesId)
  const nature = NATURE_OPTIONS.find((option) => option.label === entry.nature)
  const stats = Object.fromEntries(STAT_META.map((stat, index) => {
    const baseStat = Number(species?.stats?.[index]) || 1
    const trainingPoint = Math.max(0, Number(entry.trainingPoints?.[stat.key]) || 0)
    const natureMultiplier = nature?.up === stat.key ? 1.1 : nature?.down === stat.key ? 0.9 : 1
    const value = stat.key === 'hp'
      ? baseStat + trainingPoint + 75
      : Math.floor((baseStat + trainingPoint + 20) * natureMultiplier)
    return [stat.key, value]
  }))
  const matchupPokemon = {
    ...entry,
    types: entry.types ?? species?.types ?? ['노말'],
    stats,
    moves: resolveMoves(entry),
  }
  if (entry && typeof entry === 'object') MATCHUP_POKEMON_CACHE.set(entry, matchupPokemon)
  return matchupPokemon
}

function abilityTypeImmunity(pokemon) {
  return ABILITY_TYPE_IMMUNITIES.get(pokemon.abilityId)
    ?? ABILITY_TYPE_IMMUNITIES.get(pokemon.ability)
    ?? null
}

function matchupEffectiveness(moveType, defender) {
  if (abilityTypeImmunity(defender) === moveType) return 0
  let effectiveness = getTypeEffectiveness(moveType, defender.types)
  if (defender.ability === '두꺼운지방' && ['불꽃', '얼음'].includes(moveType)) effectiveness *= 0.5
  if (effectiveness > 1 && ['필터', '하드록', '프리즘아머'].includes(defender.ability)) effectiveness *= 0.75
  return effectiveness
}

function movePressure(attacker, defender, move) {
  if (!move || move.categoryId === 'status') return 0
  const effectiveness = matchupEffectiveness(move.type, defender)
  if (effectiveness <= 0) return 0
  const attackStat = move.categoryId === 'physical' ? attacker.stats.attack : attacker.stats.specialAttack
  const defenseStat = move.categoryId === 'physical' ? defender.stats.defense : defender.stats.specialDefense
  const power = Math.max(45, Number(move.power) || 0)
  const accuracy = move.accuracy == null ? 1 : Math.max(0.3, Number(move.accuracy) / 100)
  const stab = attacker.types.includes(move.type) ? 1.5 : 1
  const statRatio = Math.sqrt(Math.max(0.25, attackStat / Math.max(1, defenseStat)))
  return power * accuracy * stab * effectiveness * statRatio
    + Math.max(0, Number(move.priority) || 0) * 16
}

function duelScore(attacker, defender) {
  const outgoing = attacker.moves.reduce((best, move) => (
    Math.max(best, movePressure(attacker, defender, move))
  ), 0)
  const incoming = defender.moves.reduce((best, move) => (
    Math.max(best, movePressure(defender, attacker, move))
  ), 0)
  const speedDelta = attacker.stats.speed - defender.stats.speed
  const speedScore = speedDelta > 0 ? 16 : speedDelta < 0 ? -10 : 0
  const knockoutPressure = outgoing >= defender.stats.hp ? 24 : 0
  const knockoutRisk = incoming >= attacker.stats.hp ? 22 : 0
  return outgoing * 0.72 - incoming * 0.48 + speedScore + knockoutPressure - knockoutRisk
}

function teamSupportScore(pokemon) {
  const moveIds = new Set(pokemon.flatMap((entry) => entry.moves.map((move) => move.id)))
  const hasMove = (moveIdsToCheck) => [...moveIdsToCheck].some((moveId) => moveIds.has(moveId))
  const setupCount = pokemon.flatMap((entry) => entry.moves).filter((move) => (
    move.categoryId === 'status' && (move.boosts || move.self?.boosts)
  )).length
  return (hasMove(HAZARD_MOVE_IDS) ? 18 : 0)
    + (hasMove(HAZARD_CLEAR_MOVE_IDS) ? 14 : 0)
    + (hasMove(PIVOT_MOVE_IDS) ? 12 : 0)
    + (hasMove(RECOVERY_MOVE_IDS) ? 9 : 0)
    + (hasMove(SPEED_CONTROL_MOVE_IDS) ? 12 : 0)
    + Math.min(18, setupCount * 4)
}

function sharedWeaknessPenalty(candidateTeam, playerTeam) {
  const playerMoveTypes = [...new Set(playerTeam.flatMap((pokemon) => (
    pokemon.moves.filter((move) => move.categoryId !== 'status').map((move) => move.type)
  )))]
  return playerMoveTypes.reduce((penalty, moveType) => {
    const weakCount = candidateTeam.filter((pokemon) => matchupEffectiveness(moveType, pokemon) > 1).length
    const resistCount = candidateTeam.filter((pokemon) => matchupEffectiveness(moveType, pokemon) < 1).length
    return penalty
      + Math.max(0, weakCount - 2) ** 2 * 12
      + (weakCount >= 3 && resistCount === 0 ? 16 : 0)
  }, 0)
}

function defensiveSwitchCoverageScore(candidateTeam, playerTeam) {
  const threatTypes = [...new Set(playerTeam.flatMap((pokemon) => (
    pokemon.moves
      .filter((move) => move.categoryId !== 'status')
      .map((move) => move.type)
  )))]
  if (threatTypes.length === 0) return 0
  const safetyScore = (effectiveness) => {
    if (effectiveness <= 0) return 30
    if (effectiveness <= 0.25) return 24
    if (effectiveness <= 0.5) return 17
    if (effectiveness < 1) return 10
    if (effectiveness === 1) return 0
    if (effectiveness <= 2) return -12
    return -24
  }
  return threatTypes.reduce((total, moveType) => {
    const switchScores = candidateTeam
      .map((pokemon) => safetyScore(matchupEffectiveness(moveType, pokemon)))
      .sort((first, second) => second - first)
    return total + (switchScores[0] ?? -30) + (switchScores[1] ?? switchScores[0] ?? -30) * 0.45
  }, 0) / threatTypes.length
}

export function scoreTrainerTeamAgainstPlayer(team, playerTeam) {
  const candidatePokemon = (team?.pokemon ?? []).map(createMatchupPokemon)
  const playerPokemon = (playerTeam ?? []).map(createMatchupPokemon)
  if (candidatePokemon.length === 0 || playerPokemon.length === 0) return -Infinity

  const counterCoverage = playerPokemon.reduce((total, target) => {
    const counterScores = candidatePokemon
      .map((pokemon) => duelScore(pokemon, target))
      .sort((first, second) => second - first)
    return total + (counterScores[0] ?? -120) + (counterScores[1] ?? counterScores[0] ?? -120) * 0.32
  }, 0)
  const rosterUsefulness = candidatePokemon.reduce((total, pokemon) => (
    total + Math.max(...playerPokemon.map((target) => duelScore(pokemon, target))) * 0.2
  ), 0)
  const typeDiversity = new Set(candidatePokemon.flatMap((pokemon) => pokemon.types)).size * 3
  const configuredMechanics = new Set(candidatePokemon.flatMap((pokemon) => pokemon.battleMechanics ?? []))
  const mechanicScore = Math.min(30, Math.max(
    team.battleGimmicks?.length ?? 0,
    configuredMechanics.size,
  ) * 6)

  return counterCoverage
    + rosterUsefulness
    + teamSupportScore(candidatePokemon)
    + defensiveSwitchCoverageScore(candidatePokemon, playerPokemon)
    + typeDiversity
    + mechanicScore
    - sharedWeaknessPenalty(candidatePokemon, playerPokemon)
}

export function rankTrainerTeamsAgainstPlayer(trainer, playerTeam) {
  const teams = trainer?.teams ?? []
  if (teams.length === 0 || !Array.isArray(playerTeam) || playerTeam.length === 0) return []
  let trainerCache = COUNTER_TEAM_RANKING_CACHE.get(trainer)
  if (!trainerCache) {
    trainerCache = new WeakMap()
    COUNTER_TEAM_RANKING_CACHE.set(trainer, trainerCache)
  }
  const cached = trainerCache.get(playerTeam)
  if (cached) return cached

  const ranking = teams
    .map((team) => ({
      number: team.number,
      score: scoreTrainerTeamAgainstPlayer(team, playerTeam),
    }))
    .sort((first, second) => second.score - first.score || first.number - second.number)
  trainerCache.set(playerTeam, ranking)
  return ranking
}

export function selectCounterTeamNumber(trainer, playerTeam, random = Math.random) {
  const teams = trainer?.teams ?? []
  if (teams.length === 0) return 1
  if (!Array.isArray(playerTeam) || playerTeam.length === 0) {
    return teams[Math.floor(random() * teams.length)]?.number ?? 1
  }

  return rankTrainerTeamsAgainstPlayer(trainer, playerTeam)[0]?.number ?? 1
}

function buildCombinations(entries, count, startIndex = 0, selected = [], combinations = []) {
  if (selected.length === count) {
    combinations.push([...selected])
    return combinations
  }

  for (let index = startIndex; index <= entries.length - (count - selected.length); index += 1) {
    selected.push(entries[index])
    buildCombinations(entries, count, index + 1, selected, combinations)
    selected.pop()
  }
  return combinations
}

export function selectCounterBattlePokemon(pokemon, playerTeam, rules) {
  const battleSize = Math.min(
    pokemon.length,
    Math.max(1, Math.floor(Number(rules?.teamRule?.battleSize) || pokemon.length)),
  )
  if (battleSize >= pokemon.length || !Array.isArray(playerTeam) || playerTeam.length === 0) {
    return [...pokemon]
  }

  return buildCombinations(pokemon, battleSize)
    .map((selection) => ({
      selection,
      score: scoreTrainerTeamAgainstPlayer({ pokemon: selection }, playerTeam),
      key: selection.map((entry) => entry.speciesId).join(':'),
    }))
    .sort((first, second) => second.score - first.score || first.key.localeCompare(second.key))[0]?.selection
    ?? pokemon.slice(0, battleSize)
}
