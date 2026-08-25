import { TRAINERS, getTrainerTeam } from './trainerTeams.js'
import { createBattleMatchRules, normalizeAiBattleDifficulty } from './battleRules.js'
import { selectCounterTeamNumber } from './aiTeamSelection.js'

export const PLAYER_PARTICIPANT_ID = 'player'

export const COMPETITION_RULES = {
  tournament: {
    entrantCount: 128,
    roundLabels: ['128강', '64강', '32강', '16강', '8강', '준결승', '결승'],
  },
  league: {
    entrantCount: 8,
    roundLabels: ['1라운드', '2라운드', '3라운드', '4라운드', '5라운드', '6라운드', '7라운드'],
  },
}

function shuffle(entries, random) {
  const shuffledEntries = [...entries]

  for (let index = shuffledEntries.length - 1; index > 0; index -= 1) {
    const targetIndex = Math.floor(random() * (index + 1))
    ;[shuffledEntries[index], shuffledEntries[targetIndex]] = [shuffledEntries[targetIndex], shuffledEntries[index]]
  }

  return shuffledEntries
}

function createTrainerParticipant(trainer, playerTeam, random) {
  return {
    id: trainer.id,
    name: trainer.name,
    tier: trainer.tier,
    region: trainer.region,
    teamNumber: selectCounterTeamNumber(trainer, playerTeam, random),
    isPlayer: false,
  }
}

function createPlayerParticipant(teamName) {
  return {
    id: PLAYER_PARTICIPANT_ID,
    name: 'PLAYER_01',
    tier: 'PLAYER',
    region: 'player',
    teamName,
    teamNumber: 1,
    isPlayer: true,
  }
}

function createLeagueSchedule(participantIds) {
  const rotation = [...participantIds]
  const rounds = []

  for (let roundIndex = 0; roundIndex < participantIds.length - 1; roundIndex += 1) {
    const matches = []

    for (let pairIndex = 0; pairIndex < participantIds.length / 2; pairIndex += 1) {
      const first = rotation[pairIndex]
      const second = rotation[rotation.length - 1 - pairIndex]
      matches.push(roundIndex % 2 === 0 ? [first, second] : [second, first])
    }

    rounds.push(matches)
    rotation.splice(1, 0, rotation.pop())
  }

  return rounds
}

export function createCompetition(
  mode,
  playerTeam,
  teamName,
  difficultyOrRandom = 'normal',
  fallbackRandom = Math.random,
) {
  const random = typeof difficultyOrRandom === 'function' ? difficultyOrRandom : fallbackRandom
  const aiDifficulty = normalizeAiBattleDifficulty(
    typeof difficultyOrRandom === 'function' ? 'normal' : difficultyOrRandom,
  )
  const rules = COMPETITION_RULES[mode] ?? COMPETITION_RULES.tournament
  const trainers = shuffle(TRAINERS, random)
    .slice(0, rules.entrantCount - 1)
    .map((trainer) => createTrainerParticipant(trainer, playerTeam, random))
  const player = createPlayerParticipant(teamName)
  const participants = shuffle([player, ...trainers], random)
  const baseCompetition = {
    id: `${mode}-${Date.now()}-${Math.floor(random() * 1_000_000)}`,
    mode,
    participants,
    playerTeam: playerTeam.map((pokemon) => ({ ...pokemon })),
    round: 0,
    roundHistory: [],
    status: 'active',
    championId: null,
    aiDifficulty,
    currentMatchRules: createBattleMatchRules(random, aiDifficulty),
  }

  if (mode === 'league') {
    const standings = Object.fromEntries(participants.map((participant) => [participant.id, {
      participantId: participant.id,
      wins: 0,
      losses: 0,
      differential: 0,
      points: 0,
    }]))

    return {
      ...baseCompetition,
      schedule: createLeagueSchedule(participants.map((participant) => participant.id)),
      standings,
    }
  }

  return {
    ...baseCompetition,
    activeParticipantIds: participants.map((participant) => participant.id),
  }
}

export function getCompetitionParticipant(competition, participantId) {
  return competition?.participants.find((participant) => participant.id === participantId) ?? null
}

export function getCompetitionRoundLabel(competition) {
  const labels = COMPETITION_RULES[competition?.mode]?.roundLabels ?? []
  return labels[competition?.round] ?? '대회 종료'
}

export function getCurrentCompetitionMatch(competition) {
  if (!competition || competition.status !== 'active') return null

  if (competition.mode === 'league') {
    const pairing = competition.schedule[competition.round]
      ?.find((pair) => pair.includes(PLAYER_PARTICIPANT_ID))
    if (!pairing) return null

    const opponentId = pairing.find((participantId) => participantId !== PLAYER_PARTICIPANT_ID)
    return {
      player: getCompetitionParticipant(competition, PLAYER_PARTICIPANT_ID),
      opponent: getCompetitionParticipant(competition, opponentId),
      pairing,
      rules: competition.currentMatchRules,
    }
  }

  const playerIndex = competition.activeParticipantIds.indexOf(PLAYER_PARTICIPANT_ID)
  if (playerIndex < 0) return null
  const opponentIndex = playerIndex % 2 === 0 ? playerIndex + 1 : playerIndex - 1
  const opponentId = competition.activeParticipantIds[opponentIndex]

  return {
    player: getCompetitionParticipant(competition, PLAYER_PARTICIPANT_ID),
    opponent: getCompetitionParticipant(competition, opponentId),
    pairing: playerIndex % 2 === 0
      ? [PLAYER_PARTICIPANT_ID, opponentId]
      : [opponentId, PLAYER_PARTICIPANT_ID],
    rules: competition.currentMatchRules,
  }
}

export function getCompetitionOpponentTeam(competition) {
  const match = getCurrentCompetitionMatch(competition)
  if (!match?.opponent) return null
  return getTrainerTeam(match.opponent.name, match.opponent.teamNumber)
}

function randomRemainingPokemon(random) {
  return Math.max(1, Math.ceil(random() * 5))
}

function tournamentResult(competition, playerWon, random, battleSummary) {
  const matches = []
  const winners = []

  for (let index = 0; index < competition.activeParticipantIds.length; index += 2) {
    const firstId = competition.activeParticipantIds[index]
    const secondId = competition.activeParticipantIds[index + 1]
    const isPlayerMatch = firstId === PLAYER_PARTICIPANT_ID || secondId === PLAYER_PARTICIPANT_ID
    const winnerId = isPlayerMatch
      ? (playerWon ? PLAYER_PARTICIPANT_ID : (firstId === PLAYER_PARTICIPANT_ID ? secondId : firstId))
      : (random() < 0.5 ? firstId : secondId)
    const loserId = winnerId === firstId ? secondId : firstId
    const winnerRemaining = isPlayerMatch
      ? Math.max(1, Number(playerWon ? battleSummary?.playerRemaining : battleSummary?.opponentRemaining) || 1)
      : randomRemainingPokemon(random)

    winners.push(winnerId)
    matches.push({
      firstId,
      secondId,
      winnerId,
      loserId,
      winnerRemaining,
      isPlayerMatch,
    })
  }

  const nextRoundHistory = [...competition.roundHistory, {
    round: competition.round,
    label: getCompetitionRoundLabel(competition),
    matches,
  }]

  if (!playerWon) {
    return {
      ...competition,
      roundHistory: nextRoundHistory,
      activeParticipantIds: winners,
      status: 'eliminated',
      championId: winners.length === 1 ? winners[0] : null,
    }
  }

  if (winners.length === 1) {
    return {
      ...competition,
      roundHistory: nextRoundHistory,
      activeParticipantIds: winners,
      status: 'complete',
      championId: PLAYER_PARTICIPANT_ID,
    }
  }

  return {
    ...competition,
    round: competition.round + 1,
    roundHistory: nextRoundHistory,
    activeParticipantIds: winners,
  }
}

function updateStanding(standings, winnerId, loserId, differential) {
  return {
    ...standings,
    [winnerId]: {
      ...standings[winnerId],
      wins: standings[winnerId].wins + 1,
      differential: standings[winnerId].differential + differential,
      points: standings[winnerId].points + 3,
    },
    [loserId]: {
      ...standings[loserId],
      losses: standings[loserId].losses + 1,
      differential: standings[loserId].differential - differential,
    },
  }
}

function leagueResult(competition, playerWon, random, battleSummary) {
  const roundPairings = competition.schedule[competition.round] ?? []
  let standings = competition.standings
  const matches = roundPairings.map(([firstId, secondId]) => {
    const isPlayerMatch = firstId === PLAYER_PARTICIPANT_ID || secondId === PLAYER_PARTICIPANT_ID
    const playerOpponentId = firstId === PLAYER_PARTICIPANT_ID ? secondId : firstId
    const winnerId = isPlayerMatch
      ? (playerWon ? PLAYER_PARTICIPANT_ID : playerOpponentId)
      : (random() < 0.5 ? firstId : secondId)
    const loserId = winnerId === firstId ? secondId : firstId
    const differential = isPlayerMatch
      ? Math.max(1, Math.abs(
        Number(battleSummary?.playerRemaining ?? 0) - Number(battleSummary?.opponentRemaining ?? 0),
      ) || 1)
      : Math.max(1, Math.ceil(random() * 4))

    standings = updateStanding(standings, winnerId, loserId, differential)

    return {
      firstId,
      secondId,
      winnerId,
      loserId,
      winnerRemaining: differential,
      isPlayerMatch,
    }
  })
  const nextRound = competition.round + 1
  const isComplete = nextRound >= competition.schedule.length
  const nextCompetition = {
    ...competition,
    round: nextRound,
    standings,
    roundHistory: [...competition.roundHistory, {
      round: competition.round,
      label: getCompetitionRoundLabel(competition),
      matches,
    }],
    status: isComplete ? 'complete' : 'active',
  }

  if (!isComplete) return nextCompetition

  const champion = getSortedLeagueStandings(nextCompetition)[0]
  return {
    ...nextCompetition,
    championId: champion?.participantId ?? null,
  }
}

export function resolveCompetitionMatch(
  competition,
  playerWon,
  battleSummary = {},
  random = Math.random,
) {
  if (!competition || competition.status !== 'active') return competition
  const resolvedCompetition = competition.mode === 'league'
    ? leagueResult(competition, playerWon, random, battleSummary)
    : tournamentResult(competition, playerWon, random, battleSummary)
  return resolvedCompetition.status === 'active'
    ? {
        ...resolvedCompetition,
        currentMatchRules: createBattleMatchRules(random, resolvedCompetition.aiDifficulty),
      }
    : resolvedCompetition
}

export function getSortedLeagueStandings(competition) {
  if (!competition?.standings) return []

  return Object.values(competition.standings).sort((first, second) => (
    second.points - first.points
    || second.differential - first.differential
    || second.wins - first.wins
    || first.participantId.localeCompare(second.participantId)
  ))
}

export function getParticipantProgressState(competition, participantId) {
  if (competition.mode === 'league') return 'active'
  if (competition.activeParticipantIds.includes(participantId)) return 'active'

  const wonAnyMatch = competition.roundHistory.some((round) => (
    round.matches.some((match) => match.winnerId === participantId)
  ))
  return wonAnyMatch ? 'eliminated-late' : 'eliminated'
}
