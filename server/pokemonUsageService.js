import { createHash } from 'node:crypto'
import {
  canonicalUsageSpeciesId, canonicalUsageTeamEntry, createEmptyUsageSnapshot, createUsageBucket,
  recordUsageTeams, usageBucketKey,
} from '../src/data/pokemonUsage.js'
import { getRankedFormat } from '../src/data/rankedRules.js'

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
  const format = getRankedFormat(match.format)
  if (!format) fail('INVALID_FORMAT', '싱글 또는 더블 배틀을 선택해주세요.')
  if (!Array.isArray(selectedTeams) || selectedTeams.length !== 2
    || selectedTeams.some(team => !Array.isArray(team) || team.length !== format.battleSize)) {
    fail('INVALID_USAGE_SELECTION_SIZE', `각 트레이너가 출전 선출한 포켓몬 ${format.battleSize}마리만 기록할 수 있습니다.`)
  }
  const key = usageBucketKey('ranked', match.format)
  const bucket = await tx.get('pokemonUsage', key) ?? createUsageBucket()
  // The trusted battle canonicalizer represents an unequipped slot as ''.
  // Telemetry uses explicit null so this is an observed no-item sample; the
  // stricter client-report validator must still reject arbitrary empty IDs.
  const usageTeams = selectedTeams.map(team => team.map(entry => ({
    speciesId: entry.speciesId, heldItemId: entry.heldItemId || null,
  })))
  tx.set('pokemonUsage', key, recordUsageTeams(bucket, usageTeams, Math.max(timestamp, bucket.updatedAt)))
  // The caller saves this marker in the same transaction as starting the match.
  // Already-running matches are deliberately never backfilled during polling.
  match.usageRecordedAt = timestamp
}

export function validateAiPokemonUsage(payload) {
  const format = getRankedFormat(payload.format)
  if (!format) fail('INVALID_FORMAT', '싱글 또는 더블 배틀을 선택해주세요.')
  if (typeof payload.battleId !== 'string' || !/^[a-zA-Z0-9_:-]{8,128}$/.test(payload.battleId)) {
    fail('INVALID_USAGE_BATTLE', '배틀 사용률 기록 식별자가 올바르지 않습니다.')
  }
  // Validate species before selection size so malformed payloads retain their
  // original error. Registered six-Pokémon candidate teams are never samples.
  if (!Array.isArray(payload.speciesIds) || payload.speciesIds.length < 1 || payload.speciesIds.length > 6
    || payload.speciesIds.some(id => !Number.isSafeInteger(id))) {
    fail('INVALID_USAGE_TEAM', '출전 선출한 포켓몬의 종 번호 배열이 필요합니다.')
  }
  let speciesIds
  let selectedSpecies
  try {
    selectedSpecies = payload.speciesIds.map(canonicalUsageSpeciesId).sort((a, b) => a - b)
    speciesIds = [...new Set(selectedSpecies)]
  }
  catch { fail('INVALID_USAGE_TEAM', '존재하는 포켓몬 종 번호만 기록할 수 있습니다.') }
  if (payload.speciesIds.length !== format.battleSize) {
    fail('INVALID_USAGE_SELECTION_SIZE', `${format.label}에서 출전 선출한 포켓몬 ${format.battleSize}마리만 기록할 수 있습니다.`)
  }
  let team
  if (Object.hasOwn(payload, 'team')) {
    if (!Array.isArray(payload.team) || payload.team.length !== payload.speciesIds.length
      || payload.team.some(entry => !entry || typeof entry !== 'object' || Array.isArray(entry) || !Object.hasOwn(entry, 'heldItemId'))) {
      fail('INVALID_USAGE_TEAM', '출전 포켓몬마다 실제 장착 아이템 또는 미장착 상태가 필요합니다.')
    }
    try { team = payload.team.map(canonicalUsageTeamEntry) }
    catch { fail('INVALID_USAGE_TEAM', '존재하는 포켓몬과 배틀 아이템만 기록할 수 있습니다.') }
    if (JSON.stringify(team.map(entry => entry.speciesId).sort((a, b) => a - b)) !== JSON.stringify(selectedSpecies)) {
      fail('INVALID_USAGE_TEAM', '아이템 기록은 실제 출전 포켓몬과 일치해야 합니다.')
    }
    team.sort((left, right) => left.speciesId - right.speciesId
      || ((left.heldItemId ?? '') < (right.heldItemId ?? '') ? -1 : (left.heldItemId ?? '') > (right.heldItemId ?? '') ? 1 : 0))
  }
  return { battleId: payload.battleId, format: payload.format, speciesIds, ...(team ? { team } : {}) }
}

export async function reportAiPokemonUsage(tx, uid, report, timestamp) {
  // Authentication establishes the reporting account. AI battles run in the
  // browser, so these are client reports, not server-verified battle outcomes.
  const receiptId = digest([uid, report.battleId])
  const legacyHash = digest({ format: report.format, speciesIds: report.speciesIds })
  const reportHash = report.team ? digest({ format: report.format, team: report.team }) : legacyHash
  const previous = await tx.get('pokemonUsageEvents', receiptId)
  if (previous) {
    // Old receipts did not retain item details. A retry from either version
    // may acknowledge the original species-only event without backfilling it.
    // A detailed receipt rejects changes to item assignments or sample counts.
    const compatibleLegacy = previous.version !== 2 && previous.hash === legacyHash
    const compatibleOldClient = !report.team && previous.legacyHash === legacyHash
    if (previous.hash !== reportHash && !compatibleLegacy && !compatibleOldClient) fail('USAGE_EVENT_REUSED', '같은 배틀의 사용률 기록을 변경할 수 없습니다.', 409)
    return { accepted: false, usage: await readPokemonUsage(tx) }
  }
  const key = usageBucketKey('ai', report.format)
  const bucket = await tx.get('pokemonUsage', key) ?? createUsageBucket()
  tx.set('pokemonUsage', key, recordUsageTeams(bucket, [report.team ?? report.speciesIds], Math.max(timestamp, bucket.updatedAt)))
  tx.set('pokemonUsageEvents', receiptId, { hash: reportHash, recordedAt: timestamp, ...(report.team ? { version: 2, legacyHash } : {}) })
  return { accepted: true, usage: await readPokemonUsage(tx) }
}
