// Independent entitlement registry: do not import achievements or training data here.
// Cosmetic rewards are trainer titles now (see titleData.js); what remains here
// is the one tangible battle item an achievement can grant.
export const RARE_BATTLE_ITEMS = Object.freeze([Object.freeze({
  id: 'legend-plate', name: '레전드플레이트', englishName: 'Legend Plate', kind: 'item',
  category: 'held', categoryLabel: '지닌 도구', rarity: 'mythic',
  price: 0, sprite: '/assets/items/legend-plate-la.png', image: '/assets/items/legend-plate-la.png',
  grade: '신화', effect: '심판의뭉치 타입 자동 선택', sourceCategory: 'plates',
  description: '아르세우스가 지니면 심판의뭉치가 상대에게 가장 효과적인 타입으로 바뀌고, 아르세우스도 그 타입이 됩니다. 테라스탈 중에는 몸의 타입이 유지됩니다.',
  effectId: 'legend-plate-judgment', compatibleBaseSpeciesIds: Object.freeze([493]),
  rewardOnly: true, rewardAchievementId: 'achievements-all',
  flingPower: 0,
})])

const earned = (progress, achievementId) => {
  const unlocked = progress?.unlocked
  return unlocked && Object.hasOwn(unlocked, achievementId)
    && Number.isSafeInteger(unlocked[achievementId]) && unlocked[achievementId] >= 0
}

export function getRareReward(id) {
  return RARE_BATTLE_ITEMS.find((entry) => entry.id === id) ?? null
}

export function getUnlockedRareItems(progress) {
  return RARE_BATTLE_ITEMS.filter((entry) => earned(progress, entry.rewardAchievementId))
}

export function deriveRareRewardEntitlements(progress) {
  return { itemIds: getUnlockedRareItems(progress).map((entry) => entry.id) }
}
