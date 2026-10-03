import { gameStorage } from '../local/gameStorage.js'
import { ACHIEVEMENT_STORAGE_KEY, normalizeAchievementState } from './achievementData.js'
import { INITIAL_VP_BALANCE } from './pokemonPool.js'
import { getBattleFactoryVpReward } from './battleFactoryRewards.js'

const VP_STORAGE_KEY = 'champions-vp-v1'
const validBalance = value => Number.isSafeInteger(value) && value >= 0

function readRankedVpRewards(storage, tolerateLegacyCorruption = false) {
  const text = storage.getItem(ACHIEVEMENT_STORAGE_KEY)
  if (!text) return null
  let saved
  try { saved = JSON.parse(text) } catch (error) {
    if (tolerateLegacyCorruption) return null
    throw error
  }
  const rewards = saved?.rankedVpRewards
  if (rewards == null) return null
  if (typeof rewards.uid !== 'string' || !rewards.uid || !validBalance(rewards.total)) {
    throw new Error('Cannot read the ranked VP receipt')
  }
  return { uid: rewards.uid, total: rewards.total }
}

function readFactoryVpRewards(storage, tolerateCorruption = false) {
  try {
    const text = storage.getItem(ACHIEVEMENT_STORAGE_KEY)
    const saved = text ? JSON.parse(text) : null
    const rewards = saved?.factoryVpRewards
    if (rewards == null) return null
    if (typeof rewards.uid !== 'string' || !rewards.uid || !Array.isArray(rewards.runs)
      || rewards.runs.length > 100 || rewards.runs.some(run => typeof run?.id !== 'string'
        || !/^[a-zA-Z0-9_:-]{8,128}$/.test(run.id)
        || !Number.isSafeInteger(run.floor) || run.floor < 1 || run.floor > 10000)
      || new Set(rewards.runs.map(run => run.id)).size !== rewards.runs.length) {
      throw new Error('Cannot read the Battle Factory VP receipt')
    }
    return { uid: rewards.uid, runs: rewards.runs.map(run => ({ id: run.id, floor: run.floor })) }
  } catch (error) {
    if (tolerateCorruption) return null
    throw error
  }
}

export function loadAchievementWallet(storage = gameStorage) {
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

export function saveAchievementWallet(progress, balance, storage = gameStorage) {
  if (!storage || !validBalance(balance)) throw new Error('Cannot save an invalid achievement wallet')
  const rankedVpRewards = readRankedVpRewards(storage, true)
  writeAchievementWallet(progress, balance, rankedVpRewards, storage)
}

function writeAchievementWallet(progress, balance, rankedVpRewards, storage, factoryVpRewards = readFactoryVpRewards(storage, true)) {
  // Achievement grants and the resulting VP balance commit in one storage write.
  // A reload between this write and the legacy mirror cannot pay twice or lose VP.
  storage.setItem(ACHIEVEMENT_STORAGE_KEY, JSON.stringify({
    ...normalizeAchievementState(progress), walletBalance: balance,
    ...(rankedVpRewards ? { rankedVpRewards } : {}),
    ...(factoryVpRewards ? { factoryVpRewards } : {}),
  }))
  try { storage.setItem(VP_STORAGE_KEY, String(balance)) } catch {}
}

// Factory battles currently run locally. Record the highest paid floor for
// each run in the same atomic wallet write as its VP, so repeated completion
// callbacks and interrupted saves cannot pay the same floor again.
export function creditBattleFactoryVpReward(progress, balance, result, uid, storage = gameStorage) {
  if (!storage || !validBalance(balance) || typeof uid !== 'string' || !uid
    || result?.uid !== uid || typeof result?.runId !== 'string'
    || !/^[a-zA-Z0-9_:-]{8,128}$/.test(result.runId)
    || !Number.isSafeInteger(result.floor) || result.floor < 1 || result.floor > 10000
    || result.battleId !== `${result.runId}:floor:${result.floor}`) {
    throw new Error('배틀팩토리 승리 기록을 확인하지 못했습니다.')
  }
  if (result.winner !== 'player' || result.forfeited === true) return { balance, granted: 0 }
  const previous = readFactoryVpRewards(storage)
  const runs = previous?.uid === uid ? previous.runs : []
  const paidFloor = runs.find(run => run.id === result.runId)?.floor ?? 0
  if (result.floor <= paidFloor) return { balance, granted: 0 }
  if (result.floor !== paidFloor + 1) throw new Error('이전 층의 VP 기록을 확인하지 못했습니다.')
  const granted = getBattleFactoryVpReward(result.floor)
  const nextBalance = balance + granted
  if (!validBalance(nextBalance)) throw new Error('VP 잔액을 저장할 수 없습니다.')
  const nextReceipt = { uid, runs: [...runs.filter(run => run.id !== result.runId),
    { id: result.runId, floor: result.floor }].slice(-100) }
  writeAchievementWallet(progress, nextBalance, readRankedVpRewards(storage, true), storage, nextReceipt)
  return { balance: nextBalance, granted }
}

// The server total never expires with match history. Persist its receipt in the
// same record as spendable VP so a repeated response or restored cloud save can
// only credit the still-missing difference. Other wallet saves retain the receipt.
export function creditRankedVpRewards(progress, balance, rewards, uid, storage = gameStorage) {
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
