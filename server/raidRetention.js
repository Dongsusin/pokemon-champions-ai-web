import { createHash } from 'node:crypto'
import { RAID_ENGINE_VERSION, RAID_RULE_VERSION, RAID_SCHEMA_VERSION } from '../src/data/raidRules.js'

export const RAID_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
export const RAID_RETENTION_BATCH_SIZE = 5

const MAX_EVENT_CHUNKS = 24
const MAX_PARTICIPANTS = 3
const isId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value)
const isTime = value => Number.isSafeInteger(value) && value >= 0
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 60)
const supported = value => value?.schemaVersion === RAID_SCHEMA_VERSION
  && value?.ruleVersion === RAID_RULE_VERSION && value?.engineVersion === RAID_ENGINE_VERSION

function terminalTimestamp(run) {
  if (!isId(run?.id) || !['finished', 'abandoned'].includes(run.lifecycle)
    || !supported(run) || !supported(run.battle?.raid)) return null
  const finishedAt = run.result?.finishedAt
  return isTime(finishedAt) && Number.isSafeInteger(finishedAt + RAID_RETENTION_MS) ? finishedAt : null
}

// Save this small document together with the terminal run. Polling/cleanup can
// inspect this collection without downloading any active battle snapshots.
export function createRaidRetentionIndex(run) {
  const finishedAt = terminalTimestamp(run)
  if (finishedAt === null) return null
  return {
    id: run.id, raidId: run.id,
    schemaVersion: RAID_SCHEMA_VERSION, ruleVersion: RAID_RULE_VERSION, engineVersion: RAID_ENGINE_VERSION,
    finishedAt, expiresAt: finishedAt + RAID_RETENTION_MS,
  }
}

function validIndex(index) {
  return isId(index?.id) && index.id === index.raidId && supported(index)
    && isTime(index.finishedAt) && isTime(index.expiresAt)
    && index.expiresAt === index.finishedAt + RAID_RETENTION_MS
}

const compareIndex = (a, b) => a.expiresAt - b.expiresAt || a.raidId.localeCompare(b.raidId, 'en')

// Only the tiny index is scanned. The caller directly gets at most five full
// runs and rechecks each one in the same transaction that deletes its records.
export function selectExpiredRaidRetentionIndexes(entries, now, { limit = RAID_RETENTION_BATCH_SIZE } = {}) {
  if (!Array.isArray(entries) || !isTime(now)) return []
  const count = Number.isSafeInteger(limit) ? Math.max(0, Math.min(RAID_RETENTION_BATCH_SIZE, limit)) : RAID_RETENTION_BATCH_SIZE
  if (count === 0) return []
  const selected = []
  for (const entry of entries) {
    if (!validIndex(entry) || entry.expiresAt > now || selected.some(value => value.raidId === entry.raidId)) continue
    const before = selected.findIndex(value => compareIndex(entry, value) < 0)
    selected.splice(before < 0 ? selected.length : before, 0, entry)
    if (selected.length > count) selected.pop()
  }
  return structuredClone(selected)
}

// The plan is deliberately limited to replay data. Reward receipts, first
// clears, account wallets and player totals never appear in deleteDocuments.
// An unsupported or stale run/index pair remains intact for a newer server.
export function planRaidRetentionCleanup(index, run, now) {
  if (!isTime(now) || !validIndex(index) || index.expiresAt > now) return null
  const finishedAt = terminalTimestamp(run)
  if (finishedAt === null || run.id !== index.raidId || finishedAt !== index.finishedAt) return null
  if (!Array.isArray(run.participants) || run.participants.length > MAX_PARTICIPANTS) return null
  const humans = run.participants.filter(member => member?.isNpc !== true)
  if (humans.some(member => !isId(member?.ownerId))) return null
  const ownerIds = [...new Set(humans.map(member => member.ownerId))]
  const chunks = run.eventChunks ?? []
  if (!Array.isArray(chunks) || chunks.length > MAX_EVENT_CHUNKS) return null
  const eventIds = []
  for (const chunk of chunks) {
    if (!Number.isSafeInteger(chunk?.cursorStart) || chunk.cursorStart < 1
      || !Number.isSafeInteger(chunk.cursorEnd) || chunk.cursorEnd < chunk.cursorStart
      || chunk.id !== `re_${digest([run.id, chunk.cursorStart, chunk.cursorEnd])}`) return null
    eventIds.push(chunk.id)
  }
  return {
    raidId: run.id,
    ownerIds,
    deleteDocuments: [
      ...[...new Set(eventIds)].map(id => ({ collection: 'raidEvents', id })),
      ...ownerIds.map(ownerId => ({ collection: 'raidResults', id: `rr_${digest([run.id, ownerId, 'result'])}` })),
      { collection: 'raidRuns', id: run.id },
      { collection: 'raidRunHeads', id: run.id },
      { collection: 'raidExpiryIndex', id: run.id },
    ],
  }
}
