export const AI_BATTLE_VP_REWARDS = Object.freeze({ league: 200, tournament: 300 })

// Achievement settlement owns replay detection; a repeated or forfeited battle
// must never create an additional base victory reward.
export function getAiBattleVpReward({ mode, battleProcessed, playerWon, forfeited } = {}) {
  if (!battleProcessed || !playerWon || forfeited) return 0
  return Object.hasOwn(AI_BATTLE_VP_REWARDS, mode) ? AI_BATTLE_VP_REWARDS[mode] : 0
}
