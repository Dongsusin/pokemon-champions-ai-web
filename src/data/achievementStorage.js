import { ACHIEVEMENT_STORAGE_KEY, normalizeAchievementState } from './achievementData.js'
import { INITIAL_VP_BALANCE } from './pokemonPool.js'

const VP_STORAGE_KEY = 'champions-vp-v1'
const validBalance = value => Number.isSafeInteger(value) && value >= 0

function readRankedVpRewards(storage, tolerateLegacyCorruption = false, key = 'rankedVpRewards') {
  const text = storage.getItem(ACHIEVEMENT_STORAGE_KEY)
  if (!text) return null
  let saved
  try { saved = JSON.parse(text) } catch (error) {
    if (tolerateLegacyCorruption) return null
    throw error
  }
  const rewards = saved?.[key]
  if (rewards == null) return null
  if (typeof rewards.uid !== 'string' || !rewards.uid || !validBalance(rewards.total)) {
    throw new Error('Cannot read the ranked VP receipt')
  }
  return { uid: rewards.uid, total: rewards.total }
}

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
  const rankedVpRewards = readRankedVpRewards(storage, true)
  writeAchievementWallet(progress, balance, rankedVpRewards, storage)
}

function writeAchievementWallet(progress, balance, rankedVpRewards, storage, raidVpRewards = readRankedVpRewards(storage, true, 'raidVpRewards')) {
  // Achievement grants and the resulting VP balance commit in one storage write.
  // A reload between this write and the legacy mirror cannot pay twice or lose VP.
  storage.setItem(ACHIEVEMENT_STORAGE_KEY, JSON.stringify({
    ...normalizeAchievementState(progress), walletBalance: balance,
    ...(rankedVpRewards ? { rankedVpRewards } : {}),
    ...(raidVpRewards ? { raidVpRewards } : {}),
  }))
  try { storage.setItem(VP_STORAGE_KEY, String(balance)) } catch {}
}

// The server total never expires with match history. Persist its receipt in the
// same record as spendable VP so a repeated response or restored cloud save can
// only credit the still-missing difference. Other wallet saves retain the receipt.
export function creditRankedVpRewards(progress, balance, rewards, uid, storage = globalThis.localStorage) {
  if (!storage || !validBalance(balance) || typeof uid !== 'string' || !uid
    || rewards?.uid !== uid || !validBalance(rewards?.total)) {
    throw new Error('레이팅 보상 정보를 확인하지 못했습니다. 다시 연결해주세요.')
  }
  const previous = readRankedVpRewards(storage)
  if (previous && previous.uid !== uid) throw new Error('계정 보상 정보를 다시 동기화해주세요.')
  const appliedTotal = previous?.total ?? 0
  const granted = Math.max(0, rewards.total - appliedTotal)
  if (!granted) return { balance, granted: 0, appliedTotal }
  const nextBalance = balance + granted
  if (!validBalance(nextBalance)) throw new Error('VP 잔액을 저장할 수 없습니다.')
  writeAchievementWallet(progress, nextBalance, { uid, total: rewards.total }, storage)
  return { balance: nextBalance, granted, appliedTotal: rewards.total }
}

export function creditRaidVpRewards(progress, balance, rewards, uid, storage = globalThis.localStorage) {
  if (!storage || !validBalance(balance) || typeof uid !== 'string' || !uid
    || rewards?.uid !== uid || !validBalance(rewards?.total)) {
    throw new Error('보스전 보상 정보를 확인하지 못했습니다. 다시 연결해주세요.')
  }
  const previous = readRankedVpRewards(storage, false, 'raidVpRewards')
  if (previous && previous.uid !== uid) throw new Error('계정 보상 정보를 다시 동기화해주세요.')
  const appliedTotal = previous?.total ?? 0
  const granted = Math.max(0, rewards.total - appliedTotal)
  if (!granted) return { balance, granted: 0, appliedTotal }
  const nextBalance = balance + granted
  if (!validBalance(nextBalance)) throw new Error('VP 잔액을 저장할 수 없습니다.')
  writeAchievementWallet(progress, nextBalance, readRankedVpRewards(storage), storage, { uid, total: rewards.total })
  return { balance: nextBalance, granted, appliedTotal: rewards.total }
}
