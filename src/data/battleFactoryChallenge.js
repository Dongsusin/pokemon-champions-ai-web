import { getSpeciesProfile } from './trainingData.js'
import { getPokemonRarity, RARITY_META, DRAW_RARITY_ORDER } from './pokemonPool.js'
import { BATTLE_ITEMS } from './shopData.js'

// Challenge mode keeps the standard Battle Factory flow and adds a resource to
// manage: damage is never healed for free between floors, and Tower Points are
// the only way to undo it. TP lives inside one run and dies with it.
export const FACTORY_MODES = Object.freeze([
  Object.freeze({
    id: 'standard', label: '일반 모드', tagline: 'CLASSIC RUN',
    description: '매 층 시작 시 HP·PP·상태가 모두 회복됩니다. 교환은 무료입니다.',
  }),
  Object.freeze({
    id: 'challenge', label: '도전 모드', tagline: 'CHALLENGE RUN',
    description: 'HP가 회복되지 않고 다음 층으로 이어집니다. 승리로 얻은 TP로만 회복·교체·도구 변경을 할 수 있습니다.',
  }),
])

export const FACTORY_DEFAULT_MODE = 'standard'
export const isFactoryChallengeMode = (mode) => mode === 'challenge'
export function getFactoryMode(id) {
  return FACTORY_MODES.find((mode) => mode.id === id) ?? FACTORY_MODES[0]
}

// One win pays a floor-scaled amount, but never more than the cap, so a deep
// run cannot bankroll unlimited healing.
export const FACTORY_TP_BASE_AWARD = 20
export const FACTORY_TP_PER_FLOOR = 4
export const FACTORY_TP_MAX_AWARD = 60
export const FACTORY_TP_ITEM_REROLL_COST = 25
// A flat price for putting the whole team back on its feet, cheap enough that
// a bad floor does not end the run outright.
export const FACTORY_TP_PARTY_HEAL_COST = 20

// Swapping is priced by what you gain, so a legendary costs far more than a
// rookie. The order matches the draw table's grades.
export const FACTORY_TP_SWAP_COST = Object.freeze({
  common: 20, rare: 30, elite: 45, champion: 65, legend: 90,
})

const clampInteger = (value, minimum = 0) => (
  Number.isSafeInteger(value) && value >= minimum ? value : minimum
)

export function getFactoryTpAward(floor) {
  const safeFloor = Math.max(1, clampInteger(floor, 1))
  return Math.min(FACTORY_TP_MAX_AWARD, FACTORY_TP_BASE_AWARD + safeFloor * FACTORY_TP_PER_FLOOR)
}

export function getFactoryPokemonRarity(pokemon) {
  const profile = getSpeciesProfile(pokemon?.dexSpeciesId ?? pokemon?.speciesId)
  return profile ? getPokemonRarity(profile) : 'common'
}

export function getFactoryRarityLabel(pokemon) {
  return RARITY_META[getFactoryPokemonRarity(pokemon)]?.label ?? RARITY_META.common.label
}

export function getFactorySwapCost(pokemon) {
  return FACTORY_TP_SWAP_COST[getFactoryPokemonRarity(pokemon)] ?? FACTORY_TP_SWAP_COST.common
}

/** The flat price, or 0 when there is nothing to heal. */
export function getFactoryPartyHealCost(party) {
  const members = Array.isArray(party) ? party : []
  return members.some((pokemon) => getFactoryHpRatio(pokemon) < 1) ? FACTORY_TP_PARTY_HEAL_COST : 0
}

/** Rentals with no recorded damage are at full health. */
export function getFactoryHpRatio(pokemon) {
  const ratio = pokemon?.startHpRatio
  if (!Number.isFinite(ratio)) return 1
  return Math.min(1, Math.max(0, ratio))
}

export const isFactoryPokemonFainted = (pokemon) => getFactoryHpRatio(pokemon) <= 0

export function withFactoryHpRatio(pokemon, ratio) {
  const next = Math.min(1, Math.max(0, Number.isFinite(ratio) ? ratio : 1))
  return { ...pokemon, startHpRatio: next }
}

// The reroll draws from the ordinary purchasable items only, so it can never
// hand out a reward-only item the player has not earned.
const REROLLABLE_ITEMS = BATTLE_ITEMS.filter((item) => item.category === 'held' && !item.rewardOnly)

export function rollFactoryHeldItem(random, currentItemId) {
  const pool = REROLLABLE_ITEMS.filter((item) => item.id !== currentItemId)
  if (pool.length === 0) return null
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))]
}

export const FACTORY_RARITY_ORDER = DRAW_RARITY_ORDER
