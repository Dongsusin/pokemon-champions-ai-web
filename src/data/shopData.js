import generatedBattleItems, { GENERATED_BATTLE_ITEM_META } from './generatedBattleItems.js'

export const MAX_ITEM_QUANTITY = 1

export const SHOP_CATEGORIES = [
  { id: 'all', label: '전체', eyebrow: 'ALL ITEMS' },
  { id: 'berry', label: '나무열매', eyebrow: 'BERRIES' },
  { id: 'held', label: '지닌 도구', eyebrow: 'HELD ITEMS' },
  { id: 'gimmick', label: '배틀 기믹', eyebrow: 'BATTLE GIMMICK' },
]

export const BATTLE_ITEMS = generatedBattleItems
export const BATTLE_ITEM_META = GENERATED_BATTLE_ITEM_META

const BATTLE_ITEM_BY_ID = new Map(BATTLE_ITEMS.map((item) => [item.id, item]))

export function getBattleItem(itemId) {
  return BATTLE_ITEM_BY_ID.get(itemId) ?? null
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

  return Object.fromEntries(BATTLE_ITEMS.flatMap((item) => {
    const quantity = Math.min(MAX_ITEM_QUANTITY, Math.max(0, Math.floor(Number(value[item.id]) || 0)))
    return quantity > 0 ? [[item.id, quantity]] : []
  }))
}

export function attemptItemPurchase(balance, inventory, itemId) {
  const item = BATTLE_ITEM_BY_ID.get(itemId)
  const currentBalance = Math.max(0, Math.floor(Number(balance) || 0))
  const currentInventory = normalizeItemInventory(inventory)

  if (!item) return { ok: false, reason: 'unknown-item', balance: currentBalance, inventory: currentInventory }

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

export function attemptItemEquip(pokemon, inventory, captureId, itemId) {
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
  const equippedElsewhere = currentPokemon.reduce((count, entry) => (
    entry.captureId !== captureId && entry.heldItemId === item.id ? count + 1 : count
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
