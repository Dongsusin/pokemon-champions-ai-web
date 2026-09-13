import { createHash } from 'node:crypto'
import {
  canonicalUsageSpeciesId, createEmptyUsageSnapshot, createUsageBucket,
  recordUsageTeams, usageBucketKey,
} from '../src/data/pokemonUsage.js'

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const fail = (code, message, status = 400) => {
  throw Object.assign(new Error(message), { code, status })
}

// Only this aggregate collection is read; event receipts and private battle
// records are never included in the public-to-authenticated-users snapshot.
export async function readPokemonUsage(tx) {
  const snapshot = createEmptyUsageSnapshot()
  for (const key of Object.keys(snapshot.buckets)) {
    snapshot.buckets[key] = await tx.get('pokemonUsage', key) ?? createUsageBucket()
    snapshot.updatedAt = Math.max(snapshot.updatedAt ?? 0, snapshot.buckets[key].updatedAt ?? 0)
  }
  return snapshot
}

export async function recordRankedPokemonUsage(tx, match, selectedTeams, timestamp) {
  if (match.usageRecordedAt != null) return
  const key = usageBucketKey('ranked', match.format)
  const bucket = await tx.get('pokemonUsage', key) ?? createUsageBucket()
  tx.set('pokemonUsage', key, recordUsageTeams(bucket, selectedTeams, Math.max(timestamp, bucket.updatedAt)))
  // The caller saves this marker in the same transaction as starting the match.
  // Already-running matches are deliberately never backfilled during polling.
  match.usageRecordedAt = timestamp
}

export function validateAiPokemonUsage(payload) {
  if (!['single', 'double'].includes(payload.format)) fail('INVALID_FORMAT', '싱글 또는 더블 배틀을 선택해주세요.')
  if (typeof payload.battleId !== 'string' || !/^[a-zA-Z0-9_:-]{8,128}$/.test(payload.battleId)) {
    fail('INVALID_USAGE_BATTLE', '배틀 사용률 기록 식별자가 올바르지 않습니다.')
  }
  // AI rules include both pick-three and full-team battles, and can use smaller
  // owned rosters. Accept the actual selected team, up to the six-slot limit.
  if (!Array.isArray(payload.speciesIds) || payload.speciesIds.length < 1 || payload.speciesIds.length > 6
    || payload.speciesIds.some(id => !Number.isSafeInteger(id))) {
    fail('INVALID_USAGE_TEAM', '실제로 출전한 포켓몬 1~6마리의 종 번호가 필요합니다.')
  }
  let speciesIds
  try { speciesIds = [...new Set(payload.speciesIds.map(canonicalUsageSpeciesId))].sort((a, b) => a - b) }
  catch { fail('INVALID_USAGE_TEAM', '존재하는 포켓몬 종 번호만 기록할 수 있습니다.') }
  return { battleId: payload.battleId, format: payload.format, speciesIds }
}

export async function reportAiPokemonUsage(tx, uid, report, timestamp) {
  // Authentication establishes the reporting account. AI battles run in the
  // browser, so these are client reports, not server-verified battle outcomes.
  const receiptId = digest([uid, report.battleId])
  const reportHash = digest({ format: report.format, speciesIds: report.speciesIds })
  const previous = await tx.get('pokemonUsageEvents', receiptId)
  if (previous) {
    if (previous.hash !== reportHash) fail('USAGE_EVENT_REUSED', '같은 배틀의 사용률 기록을 변경할 수 없습니다.', 409)
    return { accepted: false, usage: await readPokemonUsage(tx) }
  }
  const key = usageBucketKey('ai', report.format)
  const bucket = await tx.get('pokemonUsage', key) ?? createUsageBucket()
  tx.set('pokemonUsage', key, recordUsageTeams(bucket, [report.speciesIds], Math.max(timestamp, bucket.updatedAt)))
  tx.set('pokemonUsageEvents', receiptId, { hash: reportHash, recordedAt: timestamp })
  return { accepted: true, usage: await readPokemonUsage(tx) }
}
