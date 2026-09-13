// VP is awarded only for a server-settled battle. Leaving before battle starts
// or letting both command timers expire cannot earn participation rewards.
export const RANKED_VP_REWARDS = Object.freeze({ win: 600, loss: 200, draw: 300 })

export function getRankedVpReward({ outcome, reason, battleStarted } = {}) {
  if (!battleStarted) return 0
  if (reason === 'battle' || reason === 'turn-limit') {
    return Object.hasOwn(RANKED_VP_REWARDS, outcome) ? RANKED_VP_REWARDS[outcome] : 0
  }
  if (['forfeit', 'turn-timeout', 'replacement-timeout'].includes(reason)) {
    return outcome === 'win' ? RANKED_VP_REWARDS.win : 0
  }
  return 0
}
