const WALLET_KEY = 'champions-achievements-v1'
const RECEIPTS = ['raidVpRewards', 'rankedVpRewards']
const parse = value => { try { const result = JSON.parse(value); return result && typeof result === 'object' && !Array.isArray(result) ? result : {} } catch { return {} } }

// Currency already earned by a guest is part of the explicitly transferred
// save. A cumulative online receipt is account-scoped, however, and cannot be
// presented as another UID's authorization or block its cloud bootstrap.
export function migrateOnlineWalletReceipts(payload, { sourceUid, targetUid, targetPayload } = {}) {
  if (!sourceUid || !targetUid || sourceUid === targetUid || !payload?.[WALLET_KEY]) return payload
  const wallet = parse(payload[WALLET_KEY])
  const target = parse(targetPayload?.[WALLET_KEY])
  for (const key of RECEIPTS) {
    delete wallet[key]
    if (target[key]?.uid === targetUid && Number.isSafeInteger(target[key].total) && target[key].total >= 0) wallet[key] = { ...target[key] }
  }
  return { ...payload, [WALLET_KEY]: JSON.stringify(wallet) }
}
