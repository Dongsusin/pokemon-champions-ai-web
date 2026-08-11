export const SAVED_TEAM_LIMIT = 5
export const BATTLE_TEAM_SIZE = 6

function normalizePokemonIds(pokemonIds, availableCaptureIds) {
  const availableIds = new Set(availableCaptureIds)
  return [...new Set(Array.isArray(pokemonIds) ? pokemonIds : [])]
    .filter((captureId) => availableIds.has(captureId))
    .slice(0, BATTLE_TEAM_SIZE)
}

export function createSavedTeams(firstTeamPokemonIds = [], availableCaptureIds = []) {
  return Array.from({ length: SAVED_TEAM_LIMIT }, (_, index) => ({
    id: `team-${index + 1}`,
    name: `팀 ${index + 1}`,
    pokemonIds: index === 0
      ? normalizePokemonIds(firstTeamPokemonIds, availableCaptureIds)
      : [],
  }))
}

export function normalizeSavedTeamState(storedState, availableCaptureIds = [], legacyTeamPokemonIds = []) {
  const storedTeams = Array.isArray(storedState?.teams) ? storedState.teams : []
  const hasStoredTeams = storedTeams.length > 0
  const fallbackTeams = createSavedTeams(legacyTeamPokemonIds, availableCaptureIds)
  const teams = Array.from({ length: SAVED_TEAM_LIMIT }, (_, index) => {
    const teamId = `team-${index + 1}`
    const storedTeam = storedTeams.find((team) => team?.id === teamId) ?? storedTeams[index]

    if (!hasStoredTeams || !storedTeam) return fallbackTeams[index]

    return {
      id: teamId,
      name: typeof storedTeam.name === 'string' && storedTeam.name.trim()
        ? storedTeam.name.trim().slice(0, 20)
        : `팀 ${index + 1}`,
      pokemonIds: normalizePokemonIds(
        storedTeam.pokemonIds ?? storedTeam.teamIds,
        availableCaptureIds,
      ),
    }
  })
  const requestedActiveTeamId = storedState?.activeTeamId
  const activeTeamId = teams.some((team) => team.id === requestedActiveTeamId)
    ? requestedActiveTeamId
    : teams[0].id

  return { teams, activeTeamId }
}

export function sanitizeSavedTeams(teams, availableCaptureIds = []) {
  return normalizeSavedTeamState({ teams }, availableCaptureIds).teams
}
