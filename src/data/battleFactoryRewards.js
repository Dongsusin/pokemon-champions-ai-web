export const FACTORY_VP_BASE = 300
export const FACTORY_VP_STEP = 50
export const FACTORY_VP_CAP = 1000

export function getBattleFactoryVpReward(floor) {
  if (!Number.isSafeInteger(floor) || floor < 1) return 0
  return Math.min(FACTORY_VP_CAP, FACTORY_VP_BASE + (floor - 1) * FACTORY_VP_STEP)
}
