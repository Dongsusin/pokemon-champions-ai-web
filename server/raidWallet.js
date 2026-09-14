import { INITIAL_VP_BALANCE } from '../src/data/pokemonPool.js'

const KEY = 'champions-achievements-v1'
const valid = value => Number.isSafeInteger(value) && value >= 0
const parse = (value, fallback) => { try { return JSON.parse(value) ?? fallback } catch { return fallback } }

// The account service verifies the monotonically increasing earned total from
// the ranked namespace; no total supplied by the browser can authorize VP.
export function reconcileRaidWallet(payload, uid, earnedTotal, previouslyApplied = 0, { rejectStale = false, creditMissing = true } = {}) {
  const saved = parse(payload?.[KEY], {})
  const receipt = saved.raidVpRewards
  const previous = valid(previouslyApplied) ? previouslyApplied : 0
  const earned = Math.max(previous, valid(earnedTotal) ? earnedTotal : 0)
  const supplied = receipt?.uid === uid && valid(receipt.total) ? receipt.total : 0
  if (receipt && (receipt.uid !== uid || !valid(receipt.total) || receipt.total > earned)) {
    const error = new Error('보스전 보상 기록을 다시 동기화해주세요.'); error.code = 'INVALID_RAID_REWARD_RECEIPT'; error.status = 409; throw error
  }
  if (rejectStale && supplied < previous) {
    const error = new Error('이 저장보다 최신 보스전 보상이 있습니다. 게임 데이터를 다시 불러와주세요.'); error.code = 'STALE_RAID_REWARD_SAVE'; error.status = 409; throw error
  }
  const applied = Math.max(previous, supplied)
  const creditTotal = creditMissing ? earned : applied
  if (!creditTotal && !receipt) return { payload, appliedTotal: 0, changed: false }
  const legacy = Number(payload?.['champions-vp-v1'])
  const balance = valid(saved.walletBalance) ? saved.walletBalance : valid(legacy) ? legacy : 0
  const nextBalance = balance + Math.max(0, creditTotal - applied)
  if (!valid(nextBalance)) throw new Error('Invalid raid wallet balance')
  const nextWallet = { ...saved, walletBalance: nextBalance, raidVpRewards: { uid, total: creditTotal } }
  const next = { ...payload, [KEY]: JSON.stringify(nextWallet), 'champions-vp-v1': String(nextBalance) }
  return { payload: next, appliedTotal: creditTotal, changed: JSON.stringify(next) !== JSON.stringify(payload) }
}

export function createRaidRewardTotalResolver(rankedStore) {
  return async uid => rankedStore.transaction(async tx => {
    const player = await tx.get('raidPlayers', uid)
    return valid(player?.vpRewardTotal) ? player.vpRewardTotal : 0
  })
}

export function createResetRaidWalletPayload(uid, appliedTotal) {
  return { [KEY]: JSON.stringify({ walletBalance: INITIAL_VP_BALANCE, raidVpRewards: { uid, total: appliedTotal } }),
    'champions-vp-v1': String(INITIAL_VP_BALANCE) }
}
