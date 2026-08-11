import generatedTrainerTeams from './generatedTrainerTeams.json' with { type: 'json' }

export const TRAINER_TEAM_META = {
  generatedAt: generatedTrainerTeams.generatedAt,
  method: generatedTrainerTeams.method,
  competitiveUsageSource: generatedTrainerTeams.competitiveUsageSource,
  trainerCount: generatedTrainerTeams.trainerCount,
  teamCount: generatedTrainerTeams.teamCount,
  slotCount: generatedTrainerTeams.slotCount,
  legendaryTrainerCount: generatedTrainerTeams.legendaryTrainerCount,
  legendaryTeamCount: generatedTrainerTeams.legendaryTeamCount,
  tierCounts: generatedTrainerTeams.tierCounts,
  loadoutMethod: generatedTrainerTeams.loadoutMethod,
  loadoutSources: generatedTrainerTeams.loadoutSources,
  loadoutCoverage: generatedTrainerTeams.loadoutCoverage,
  moveCatalogSource: generatedTrainerTeams.moveCatalogSource,
  battleGimmickRule: generatedTrainerTeams.battleGimmickRule,
  battleGimmickTeamCount: generatedTrainerTeams.battleGimmickTeamCount,
  battleGimmickCounts: generatedTrainerTeams.battleGimmickCounts,
  battleGimmickSources: generatedTrainerTeams.battleGimmickSources,
}

export const TRAINER_TIERS = ['S', 'A', 'B', 'C', 'D']
export const TRAINERS = generatedTrainerTeams.trainers

const TRAINER_BY_NAME = new Map(TRAINERS.map((trainer) => [trainer.name, trainer]))

export function getTrainer(name) {
  return TRAINER_BY_NAME.get(name) ?? null
}

export function getTrainersByTier(tier) {
  return TRAINERS.filter((trainer) => trainer.tier === tier)
}

export function getTrainerTeam(name, teamNumber = 1) {
  const trainer = getTrainer(name)
  if (!trainer) return null

  const normalizedTeamNumber = Math.min(3, Math.max(1, Math.floor(Number(teamNumber) || 1)))
  return trainer.teams.find((team) => team.number === normalizedTeamNumber) ?? null
}
