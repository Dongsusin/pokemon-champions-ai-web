import generatedBattleItems, { GENERATED_BATTLE_ITEM_META } from './generatedBattleItems.js'
import { RARE_BATTLE_ITEMS } from './rareRewards.js'
import { localAssetUrl } from '../local/localAssets.js'

export const MAX_ITEM_QUANTITY = 1

export const SHOP_CATEGORIES = [
  { id: 'all', label: '전체', eyebrow: 'ALL ITEMS' },
  { id: 'berry', label: '나무열매', eyebrow: 'BERRIES' },
  { id: 'held', label: '지닌 도구', eyebrow: 'HELD ITEMS' },
  { id: 'gimmick', label: '배틀 기믹', eyebrow: 'BATTLE GIMMICK' },
]

export const BATTLE_ITEMS = generatedBattleItems.map(item => ({ ...item, sprite: localAssetUrl(item.sprite) }))
export const REWARD_BATTLE_ITEMS = RARE_BATTLE_ITEMS
export const ALL_BATTLE_ITEMS = [...BATTLE_ITEMS, ...REWARD_BATTLE_ITEMS]
export const BATTLE_ITEM_META = GENERATED_BATTLE_ITEM_META

const BATTLE_ITEM_BY_ID = new Map(ALL_BATTLE_ITEMS.map((item) => [item.id, item]))

export function getBattleItem(itemId) {
  return BATTLE_ITEM_BY_ID.get(itemId) ?? null
}

export function getVisibleBattleItems(inventory = {}) {
  const owned = normalizeItemInventory(inventory)
  return [...BATTLE_ITEMS, ...REWARD_BATTLE_ITEMS.filter((item) => owned[item.id] > 0)]
}

export function getOwnedBattleItems(inventory = {}) {
  const owned = normalizeItemInventory(inventory)
  return ALL_BATTLE_ITEMS.filter((item) => owned[item.id] > 0)
}

export function getEquippedBattleItemCounts(pokemon = []) {
  const counts = new Map()

  for (const entry of Array.isArray(pokemon) ? pokemon : []) {
    if (!BATTLE_ITEM_BY_ID.has(entry.heldItemId)) continue
    counts.set(entry.heldItemId, (counts.get(entry.heldItemId) ?? 0) + 1)
  }

  return counts
}

export function normalizeItemInventory(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

  return Object.fromEntries(ALL_BATTLE_ITEMS.flatMap((item) => {
    const quantity = Math.min(MAX_ITEM_QUANTITY, Math.max(0, Math.floor(Number(value[item.id]) || 0)))
    return quantity > 0 ? [[item.id, quantity]] : []
  }))
}

export function createCompleteBattleItemInventory(value = {}) {
  const currentInventory = normalizeItemInventory(value)
  return { ...currentInventory, ...Object.fromEntries(BATTLE_ITEMS.map((item) => [
    item.id,
    currentInventory[item.id] ?? MAX_ITEM_QUANTITY,
  ])) }
}

export function attemptItemPurchase(balance, inventory, itemId) {
  const item = BATTLE_ITEM_BY_ID.get(itemId)
  const currentBalance = Math.max(0, Math.floor(Number(balance) || 0))
  const currentInventory = normalizeItemInventory(inventory)

  if (!item) return { ok: false, reason: 'unknown-item', balance: currentBalance, inventory: currentInventory }
  if (item.rewardOnly) return { ok: false, reason: 'reward-only', balance: currentBalance, inventory: currentInventory }

  const isOwned = Boolean(currentInventory[item.id])
  if (isOwned) {
    return { ok: false, reason: 'already-owned', item, balance: currentBalance, inventory: currentInventory }
  }

  if (currentBalance < item.price) {
    return {
      ok: false,
      reason: 'insufficient-vp',
      item,
      shortfall: item.price - currentBalance,
      balance: currentBalance,
      inventory: currentInventory,
    }
  }

  return {
    ok: true,
    item,
    balance: currentBalance - item.price,
    inventory: { ...currentInventory, [item.id]: 1 },
  }
}

export function attemptItemEquip(pokemon, inventory, captureId, itemId, teamCaptureIds = null) {
  const currentPokemon = Array.isArray(pokemon) ? pokemon : []
  const targetPokemon = currentPokemon.find((entry) => entry.captureId === captureId)
  const normalizedItemId = itemId || null

  if (!targetPokemon) return { ok: false, reason: 'unknown-pokemon', pokemon: currentPokemon }

  const previousItem = getBattleItem(targetPokemon.heldItemId)

  if (normalizedItemId === (targetPokemon.heldItemId || null)) {
    return { ok: true, unchanged: true, item: previousItem, previousItem, pokemon: currentPokemon }
  }

  if (!normalizedItemId) {
    return {
      ok: true,
      item: null,
      previousItem,
      pokemon: currentPokemon.map((entry) => (
        entry.captureId === captureId ? { ...entry, heldItemId: null } : entry
      )),
    }
  }

  const item = getBattleItem(normalizedItemId)
  if (!item) return { ok: false, reason: 'unknown-item', pokemon: currentPokemon }

  const currentInventory = normalizeItemInventory(inventory)
  const scopedCaptureIds = Array.isArray(teamCaptureIds)
    ? new Set([...teamCaptureIds, captureId])
    : null
  const equippedElsewhere = currentPokemon.reduce((count, entry) => (
    entry.captureId !== captureId
      && (!scopedCaptureIds || scopedCaptureIds.has(entry.captureId))
      && entry.heldItemId === item.id
      ? count + 1
      : count
  ), 0)
  const availableQuantity = (currentInventory[item.id] ?? 0) - equippedElsewhere

  if (availableQuantity <= 0) {
    return {
      ok: false,
      reason: 'item-unavailable',
      item,
      previousItem,
      pokemon: currentPokemon,
    }
  }

  return {
    ok: true,
    item,
    previousItem,
    pokemon: currentPokemon.map((entry) => (
      entry.captureId === captureId ? { ...entry, heldItemId: item.id } : entry
    )),
  }
}
