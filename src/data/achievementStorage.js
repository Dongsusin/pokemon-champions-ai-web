import { ACHIEVEMENT_STORAGE_KEY, normalizeAchievementState } from './achievementData.js'
import { INITIAL_VP_BALANCE } from './pokemonPool.js'

const VP_STORAGE_KEY = 'champions-vp-v1'
const validBalance = value => Number.isSafeInteger(value) && value >= 0

export function loadAchievementWallet(storage = globalThis.localStorage) {
  let saved = null
  let legacyBalance = INITIAL_VP_BALANCE
  try {
    const text = storage?.getItem(ACHIEVEMENT_STORAGE_KEY)
    saved = text ? JSON.parse(text) : null
  } catch {}
  try {
    const text = storage?.getItem(VP_STORAGE_KEY)
    const value = text === null || text === undefined ? null : Number(text)
    if (validBalance(value)) legacyBalance = value
  } catch {}
  return {
    progress: normalizeAchievementState(saved),
    balance: validBalance(saved?.walletBalance) ? saved.walletBalance : legacyBalance,
  }
}

export function saveAchievementWallet(progress, balance, storage = globalThis.localStorage) {
  if (!storage || !validBalance(balance)) throw new Error('Cannot save an invalid achievement wallet')
  // Achievement grants and the resulting VP balance commit in one storage write.
  // A reload between this write and the legacy mirror cannot pay twice or lose VP.
  storage.setItem(ACHIEVEMENT_STORAGE_KEY, JSON.stringify({
    ...normalizeAchievementState(progress), walletBalance: balance,
  }))
  try { storage.setItem(VP_STORAGE_KEY, String(balance)) } catch {}
}
