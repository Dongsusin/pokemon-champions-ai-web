import { randomUUID } from 'node:crypto'

const DAY_MS = 86_400_000
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value)
const retainedFields = ['id', 'format', 'phase', 'revision', 'timelineRevision', 'createdAt',
  'finishedAt', 'winner', 'reason', 'result', 'usageRecordedAt']

export const finishedMatchIndex = `CREATE INDEX IF NOT EXISTS turso_finished_match_retention
  ON documents(namespace, json_extract(payload, '$.finishedAt'), key)
  WHERE collection='matches' AND json_extract(payload, '$.phase')='finished'
    AND json_extract(payload, '$.payloadPrunedAt') IS NULL`

export async function pruneTursoCompletedBattles(client, namespace, timestamp = Date.now()) {
  const { rows } = await client.execute({
    sql: `SELECT key, version, json_remove(payload, '$.state', '$.selections', '$.pendingActions', '$.requests') AS payload
      FROM documents WHERE namespace=? AND collection='matches' AND json_extract(payload, '$.phase')='finished'
        AND json_extract(payload, '$.payloadPrunedAt') IS NULL
        AND json_type(payload, '$.finishedAt')='integer' AND json_extract(payload, '$.finishedAt')<?
      ORDER BY json_extract(payload, '$.finishedAt'), key LIMIT 100`,
    args: [namespace, timestamp - DAY_MS],
  })
  let pruned = 0
  for (const { key, version, payload } of rows) {
    const match = JSON.parse(payload)
    if (match.id !== key || !validId(key) || !Number.isSafeInteger(match.finishedAt) || match.finishedAt < 0
      || !Array.isArray(match.players) || match.players.length !== 2 || !match.players.every(player => validId(player?.uid))) continue
    const compact = Object.fromEntries(retainedFields.filter(field => Object.hasOwn(match, field)).map(field => [field, match[field]]))
    compact.players = match.players.map(({ uid, name = null, isGuest = false, rating = null }) => ({ uid, name, isGuest, rating, team: [] }))
    Object.assign(compact, { state: null, deadlineAt: null, timelineChunks: 0, timelineBytes: 2,
      selections: {}, pendingActions: {}, requests: [], payloadPrunedAt: timestamp })
    const id = randomUUID()
    const prefix = key + '_'
    const guard = `EXISTS(SELECT 1 FROM documents WHERE namespace=? AND collection='matches' AND key=? AND version=?)`
    const results = await client.batch([
      { sql: `UPDATE documents SET version=?,payload=? WHERE namespace=? AND collection='matches' AND key=? AND version=?`,
        args: [id, JSON.stringify(compact), namespace, key, version] },
      // The bounded PK range treats underscores in the ID literally. Limit
      // deletion to the exact <revision>_<chunk> suffix owned by this match.
      { sql: `DELETE FROM documents WHERE namespace=? AND collection='timelines' AND key>=? AND key<?
        AND substr(key,?) GLOB '[0-9]*_[0-9]*' AND substr(key,?) NOT GLOB '*[^0-9_]*'
        AND length(substr(key,?))-length(replace(substr(key,?),'_',''))=1 AND ${guard}`,
        args: [namespace, prefix, key + String.fromCharCode('_'.charCodeAt(0) + 1), prefix.length + 1, prefix.length + 1, prefix.length + 1, prefix.length + 1, namespace, key, id] },
      { sql: `INSERT INTO collection_versions(namespace,collection,version)
        SELECT ?,value,? FROM json_each('["matches","timelines"]') WHERE ${guard}
        ON CONFLICT(namespace,collection) DO UPDATE SET version=excluded.version`,
        args: [namespace, id, namespace, key, id] },
    ], 'write')
    pruned += results[0].rowsAffected
  }
  return pruned
}
