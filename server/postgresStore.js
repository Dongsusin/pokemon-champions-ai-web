import { Pool } from 'pg'
import { attachDatabasePool } from '@vercel/functions'
import { isDeepStrictEqual } from 'node:util'

const TABLE = 'champions.documents'
const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024
const RETRYABLE = new Set(['40001', '40P01'])
const keyPattern = /^[a-zA-Z0-9_-]{1,128}$/
const namespacePattern = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/
const clone = value => value === undefined ? undefined : structuredClone(value)
const rankedProfile = (id, value) => ({ id, uid: value.uid ?? id, name: value.name, ...(typeof value.nickname === 'string' ? { nickname: value.nickname } : {}), isGuest: value.isGuest, profiles: clone(value.profiles) })
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

function checkAddress(collection, key) {
  if (typeof collection !== 'string' || typeof key !== 'string' || !keyPattern.test(collection) || !keyPattern.test(key)) {
    throw new TypeError('Invalid document storage address')
  }
}

function jsonDocument(value, maxBytes) {
  const encoded = JSON.stringify(value)
  if (encoded === undefined || Buffer.byteLength(encoded, 'utf8') > maxBytes) {
    throw new TypeError('Document is not valid JSON or exceeds the storage size limit')
  }
  return { encoded, value: JSON.parse(encoded) }
}

export function createPostgresPool({
  connectionString = process.env.DATABASE_URL,
  sslCa = process.env.DATABASE_SSL_CA,
  PoolClass = Pool,
} = {}) {
  let url
  try { url = new URL(connectionString) } catch { throw new TypeError('Postgres connection is not configured') }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.username || !url.password
    || !url.pathname || url.pathname === '/' || url.hash) throw new TypeError('Postgres connection is not configured')
  // pg connection-string SSL parameters replace the supplied TLS object. Refuse
  // them so neither sslmode=require nor a URL can disable CA/host verification.
  if ([...url.searchParams.keys()].some(key => /^ssl/i.test(key))) {
    throw new TypeError('Configure Postgres TLS with DATABASE_SSL_CA, without URL SSL parameters')
  }
  if (sslCa !== undefined && (typeof sslCa !== 'string' || !sslCa.includes('-----BEGIN CERTIFICATE-----'))) {
    throw new TypeError('Postgres CA certificate is invalid')
  }
  const pool = new PoolClass({
    connectionString: url.href,
    max: 3,
    connectionTimeoutMillis: 5_000,
    // The Vercel adapter waits idleTimeoutMillis + 100ms via waitUntil.
    // Keep a brief burst-reuse window without holding every request five seconds.
    idleTimeoutMillis: 500,
    maxLifetimeSeconds: 300,
    allowExitOnIdle: true,
    statement_timeout: 8_000,
    idle_in_transaction_session_timeout: 10_000,
    query_timeout: 12_000,
    application_name: 'champions-server',
    ssl: { rejectUnauthorized: true, ...(sslCa ? { ca: sslCa } : {}) },
  })
  // pg removes a failed idle client itself. Attach an error listener so an idle
  // network reset cannot crash the function; never log SQL, tokens or the URL.
  pool.on('error', () => {})
  if (process.env.VERCEL) attachDatabasePool(pool)
  return pool
}

// JSONB values stay in PostgreSQL. Never return the collection just to edit one
// Pokemon, and use character offsets rather than UTF-16 byte positions.
function splicePayloadSQL(splicesArg) {
  const merged = "((payload->'payload' || $4::jsonb) - $5::text[])"
  return "CASE WHEN " + splicesArg + "::jsonb = '{}'::jsonb THEN " + merged + " ELSE (SELECT COALESCE(jsonb_object_agg(entry.key, CASE WHEN "
    + splicesArg + "::jsonb ? entry.key THEN to_jsonb(substring(entry.value, 1, (" + splicesArg + "::jsonb->entry.key->>0)::integer) || ("
    + splicesArg + "::jsonb->entry.key->>2) || substring(entry.value, (" + splicesArg + "::jsonb->entry.key->>0)::integer + ("
    + splicesArg + "::jsonb->entry.key->>1)::integer + 1)) ELSE to_jsonb(entry.value) END), '{}'::jsonb) FROM jsonb_each_text("
    + merged + ") AS entry(key, value)) END"
}
function validSplicesSQL(splicesArg) {
  return "NOT EXISTS (SELECT 1 FROM jsonb_each(" + splicesArg + "::jsonb) AS edit(key, value) WHERE jsonb_typeof(payload->'payload'->edit.key) IS DISTINCT FROM 'string'"
    + " OR char_length(payload->'payload'->>edit.key) < (edit.value->>0)::integer + (edit.value->>1)::integer)"
}

/**
 * JSON document adapter shared by account and battle services. Supply the same
 * pool to multiple namespaces to keep a warm server instance at three sockets.
 * Work callbacks can be replayed after a SERIALIZABLE conflict: allocate IDs and
 * perform external effects outside the callback, just as with Firestore.
 */
export function createPostgresStore({
  pool: suppliedPool,
  connectionString,
  sslCa,
  namespace = 'ranked',
  maxAttempts = 4,
  maxDocumentBytes = MAX_DOCUMENT_BYTES,
  retryDelay = attempt => pause(Math.min(25 * 2 ** attempt, 200) + Math.floor(Math.random() * 20)),
} = {}) {
  if (typeof namespace !== 'string' || !namespacePattern.test(namespace)) throw new TypeError('Invalid document storage namespace')
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 8) throw new TypeError('Invalid transaction retry limit')
  if (!Number.isSafeInteger(maxDocumentBytes) || maxDocumentBytes < 1 || maxDocumentBytes > MAX_DOCUMENT_BYTES) {
    throw new TypeError('Invalid document storage size limit')
  }
  const pool = suppliedPool ?? createPostgresPool({ connectionString, sslCa })
  if (!pool || typeof pool.connect !== 'function') throw new TypeError('Invalid Postgres connection pool')
  let closed = false
  const active = new Set()

  async function transact(work) {
    if (closed) throw new Error('Postgres document store is closed')
    if (typeof work !== 'function') throw new TypeError('A transaction callback is required')
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const client = await pool.connect()
      let began = false, discard = false, retry = false, available = true
      const reads = new Map(), writes = new Map(), lists = new Map()
      const assertActive = () => { if (!available) throw new Error('Document transaction has ended') }
      const view = {
        async get(collection, key) {
          assertActive(); checkAddress(collection, key)
          const address = `${collection}/${key}`
          if (writes.has(address)) return clone(writes.get(address).value)
          if (!reads.has(address)) reads.set(address, client.query(
            `SELECT payload FROM ${TABLE} WHERE namespace = $1 AND collection = $2 AND key = $3`,
            [namespace, collection, key],
          ).then(result => result.rows[0]?.payload ?? null))
          return clone(await reads.get(address))
        },
        async list(collection) {
          assertActive(); checkAddress(collection, 'list')
          // SERIALIZABLE reads share a snapshot. Reuse it within this callback,
          // then overlay buffered changes so room cleanup/context see each other.
          if (!lists.has(collection)) lists.set(collection, client.query(
            `SELECT key, payload FROM ${TABLE} WHERE namespace = $1 AND collection = $2 ORDER BY key`, [namespace, collection],
          ).then(result => result.rows))
          const rows = new Map((await lists.get(collection)).map(row => [row.key, row.payload]))
          for (const change of writes.values()) {
            if (change.collection !== collection) continue
            if (change.deleted) rows.delete(change.key)
            else rows.set(change.key, change.value)
          }
          return [...rows].map(([id, value]) => ({ id, ...clone(value) }))
        },
        async readUnchangedMatch(key, uid, revision, timelineRevision, timestamp) {
          assertActive(); checkAddress('matches', key); checkAddress('players', uid)
          if (!Number.isSafeInteger(revision) || revision < 0 || !Number.isSafeInteger(timelineRevision)
            || timelineRevision < 0 || !Number.isSafeInteger(timestamp)) return null
          // A partial snapshot must never enter reads/writes: mutations still
          // fetch the complete row and cannot erase state or request receipts.
          if (writes.has('matches/' + key)) return null
          const result = await client.query(`SELECT (payload - 'state' - 'requests' - 'players')
            || jsonb_build_object('players', (SELECT jsonb_agg(p.value - 'team' ORDER BY p.ordinality)
              FROM jsonb_array_elements(payload->'players') WITH ORDINALITY p(value, ordinality))) AS status_match
            FROM ${TABLE} WHERE namespace = $1 AND collection = $2 AND key = $3
              AND payload->'players' @> jsonb_build_array(jsonb_build_object('uid', $4::text))
              AND payload->>'roomId' IS NULL AND payload->>'phase' IN ('select','battle')
              AND payload->'revision' = to_jsonb($5::bigint) AND payload->'timelineRevision' = to_jsonb($6::bigint)
              AND CASE WHEN jsonb_typeof(payload->'deadlineAt') = 'number'
                THEN (payload->>'deadlineAt')::numeric > $7::numeric ELSE false END`,
          [namespace, 'matches', key, uid, revision, timelineRevision, timestamp])
          return clone(result.rows[0]?.status_match ?? null)
        },
        async readGameDataForLoad(key, revision, fingerprint) {
          assertActive(); checkAddress('gameData', key)
          // Match the exact UTF-8 bytes of each saved string without sending the
          // collection back to Vercel when this device already has it.
          const result = await client.query(`WITH checked AS MATERIALIZED (
            SELECT payload, CASE WHEN payload->>'revision' = $4
              AND jsonb_typeof(payload->'payload') = 'object' THEN (
                SELECT COALESCE(bool_and(jsonb_typeof(value) = 'string'), true)
                  AND encode(sha256(convert_to(COALESCE(string_agg(
                    octet_length(key)::text || ':' || key ||
                    octet_length(value #>> '{}')::text || ':' || (value #>> '{}'),
                    '' ORDER BY key COLLATE "C"), ''), 'UTF8')), 'hex') = $5
                FROM jsonb_each(payload->'payload')
              ) ELSE false END AS matches
            FROM ${TABLE} WHERE namespace = $1 AND collection = $2 AND key = $3
          ) SELECT CASE WHEN matches THEN payload - 'payload' ELSE payload END AS saved, matches FROM checked`,
          [namespace, 'gameData', key, revision, fingerprint])
          const row = result.rows[0]
          return { saved: row?.saved ?? null, matches: row?.matches === true }
        },
        async readGameDataPatch(key, patch, removed, splices = {}) {
          assertActive(); checkAddress('gameData', key)
          if (writes.has(`gameData/${key}`)) throw new Error('Cannot patch a buffered game save')
          const result = await client.query(`SELECT payload->>'revision' AS revision,
            payload->>'patchHash' AS patch_hash,
            octet_length((${splicePayloadSQL('$6')})::text) AS merged_bytes,
            ${validSplicesSQL('$6')} AS splices_valid
            FROM ${TABLE} WHERE namespace = $1 AND collection = $2 AND key = $3`,
          [namespace, 'gameData', key, jsonDocument(patch, maxDocumentBytes).encoded, removed, jsonDocument(splices, maxDocumentBytes).encoded])
          const row = result.rows[0]
          return row ? { revision: row.revision, patchHash: row.patch_hash, mergedBytes: Number(row.merged_bytes), splicesValid: row.splices_valid !== false } : null
        },
        async writeGameDataPatch(key, patch, removed, metadata, baseRevision, splices = {}) {
          assertActive(); checkAddress('gameData', key)
          // Merge inside the same SERIALIZABLE transaction: neither direction
          // transfers the unchanged collection, and a rollback includes this write.
          const result = await client.query(`UPDATE ${TABLE} SET payload = $6::jsonb ||
            jsonb_build_object('payload', ${splicePayloadSQL('$8')})
            WHERE namespace = $1 AND collection = $2 AND key = $3 AND payload->>'revision' = $7
              AND ${validSplicesSQL('$8')}`,
          [namespace, 'gameData', key, jsonDocument(patch, maxDocumentBytes).encoded, removed,
            jsonDocument(metadata, maxDocumentBytes).encoded, baseRevision, jsonDocument(splices, maxDocumentBytes).encoded])
          if (result.rowCount !== 1) throw new Error('Game save changed during transaction')
          reads.delete(`gameData/${key}`)
        },
        async compareGameData(key, expectedPayload) {
          assertActive(); checkAddress('gameData', key)
          const pending = writes.get(`gameData/${key}`)
          if (pending) return pending.deleted ? null : {
            revision: pending.value.revision,
            payloadMatches: isDeepStrictEqual(pending.value.payload, expectedPayload),
          }
          // Saving needs revision/idempotency checks, not another download of
          // the entire box. Equality stays in PostgreSQL; only two fields leave.
          const result = await client.query(`SELECT payload->>'revision' AS revision,
            payload->'payload' = $4::jsonb AS payload_matches
            FROM ${TABLE} WHERE namespace = $1 AND collection = $2 AND key = $3`,
          [namespace, 'gameData', key, jsonDocument(expectedPayload, maxDocumentBytes).encoded])
          const row = result.rows[0]
          return row ? { revision: row.revision, payloadMatches: row.payload_matches === true } : null
        },
        async listGuestMatches(uid) {
          assertActive(); checkAddress('matches', uid)
          const result = await client.query(`SELECT key,
            (payload - 'state' - 'selections' - 'pendingActions' - 'requests' - 'players')
            || jsonb_build_object('players', COALESCE((
              SELECT jsonb_agg(p.value - 'team' || jsonb_build_object('team', '[]'::jsonb) ORDER BY p.ordinality)
              FROM jsonb_array_elements(payload->'players') WITH ORDINALITY p(value, ordinality)
            ), '[]'::jsonb), 'hadBattleState', payload->'state' IS NOT NULL AND payload->'state' <> 'null'::jsonb) AS match
            FROM ${TABLE} WHERE namespace = $1 AND collection = $2
              AND payload->'players' @> jsonb_build_array(jsonb_build_object('uid', $3::text))
            ORDER BY key`, [namespace, 'matches', uid])
          const rows = new Map(result.rows.map(row => [row.key, row.match]))
          for (const change of writes.values()) {
            if (change.collection !== 'matches') continue
            if (change.deleted || !change.value.players?.some(player => player.uid === uid)) rows.delete(change.key)
            else {
              const { state, selections, pendingActions, requests, players, ...metadata } = change.value
              rows.set(change.key, { ...metadata, players: players.map(({ team, ...player }) => ({ ...player, team: [] })), hadBattleState: Boolean(state) })
            }
          }
          return [...rows].map(([id, value]) => ({ id, ...clone(value) }))
        },
        async listGuestRelatedPlayers(uid) {
          assertActive(); checkAddress('players', uid)
          const result = await client.query(`SELECT key, payload FROM ${TABLE}
            WHERE namespace = $1 AND collection = $2
              AND payload->'roomResult'->'standings' @> jsonb_build_array(jsonb_build_object('uid', $3::text))
            ORDER BY key`, [namespace, 'players', uid])
          const rows = new Map(result.rows.map(row => [row.key, row.payload]))
          for (const change of writes.values()) {
            if (change.collection !== 'players') continue
            if (change.deleted || !change.value.roomResult?.standings?.some(player => player.uid === uid)) rows.delete(change.key)
            else rows.set(change.key, change.value)
          }
          return [...rows].map(([id, value]) => ({ id, ...clone(value) }))
        },
        async deleteGuestUsageEvents(owner) {
          assertActive(); checkAddress('pokemonUsageEvents', owner)
          const result = await client.query(`SELECT key FROM ${TABLE}
            WHERE namespace = $1 AND collection = $2 AND payload->>'owner' = $3`, [namespace, 'pokemonUsageEvents', owner])
          const keys = new Set(result.rows.map(row => row.key))
          for (const change of writes.values()) {
            if (change.collection !== 'pokemonUsageEvents') continue
            if (change.deleted || change.value.owner !== owner) keys.delete(change.key)
            else keys.add(change.key)
          }
          for (const key of keys) view.delete('pokemonUsageEvents', key)
          return keys.size
        },
        async listFactoryBestCandidates(excludeOwner) {
          assertActive(); checkAddress('factoryPersonalBest', excludeOwner)
          const changes = [...writes.values()].filter(change => change.collection === 'factoryPersonalBest')
          // Refill a deleted ranking entry without downloading every player's
          // rental party. Exclude pending rows before LIMIT, then merge writes.
          const result = await client.query(`SELECT key, payload FROM ${TABLE}
            WHERE namespace = $1 AND collection = $2 AND key <> $3
              AND payload->>'owner' IS DISTINCT FROM $3 AND NOT (key = ANY($4::text[]))
            ORDER BY (payload->>'floor')::integer DESC, (payload->>'recordedAt')::bigint ASC, key ASC LIMIT 10`,
          [namespace, 'factoryPersonalBest', excludeOwner, changes.map(change => change.key)])
          const rows = new Map(result.rows.map(row => [row.key, row.payload]))
          for (const change of changes) {
            if (!change.deleted && change.key !== excludeOwner && change.value.owner !== excludeOwner) rows.set(change.key, change.value)
          }
          return [...rows].sort(([a, first], [b, second]) => second.floor - first.floor
            || first.recordedAt - second.recordedAt || a.localeCompare(b)).slice(0, 10)
            .map(([id, value]) => ({ id, ...clone(value) }))
        },
        async listRankedProfiles() {
          assertActive()
          // Leaderboards need only ratings and display names. Keep private team
          // snapshots and match histories in Postgres instead of transferring
          // every complete player document on each explicit leaderboard read.
          const result = await client.query(`SELECT key, jsonb_build_object(
            'uid', payload->'uid', 'name', payload->'name', 'nickname', payload->'nickname', 'isGuest', payload->'isGuest',
            'profiles', payload->'profiles') AS profile
            FROM ${TABLE} WHERE namespace = $1 AND collection = $2 ORDER BY key`, [namespace, 'players'])
          const rows = new Map(result.rows.map(row => [row.key, rankedProfile(row.key, row.profile)]))
          for (const change of writes.values()) {
            if (change.collection !== 'players') continue
            if (change.deleted) rows.delete(change.key)
            else rows.set(change.key, rankedProfile(change.key, change.value))
          }
          return [...rows.values()]
        },
        set(collection, key, value) {
          assertActive(); checkAddress(collection, key)
          writes.set(`${collection}/${key}`, { collection, key, ...jsonDocument(value, maxDocumentBytes), deleted: false })
        },
        delete(collection, key) {
          assertActive(); checkAddress(collection, key)
          writes.set(`${collection}/${key}`, { collection, key, value: null, deleted: true })
        },
      }
      try {
        await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE')
        began = true
        // Transaction-local settings also apply to injected/shared pools and
        // cannot leak into the next transaction on a Supabase pooler socket.
        await client.query("SELECT set_config('statement_timeout', $1, true), set_config('idle_in_transaction_session_timeout', $2, true), set_config('lock_timeout', $3, true)", ['8000', '10000', '5000'])
        const result = await work(view)
        available = false
        for (const [, change] of [...writes].sort(([left], [right]) => left.localeCompare(right))) {
          const values = [namespace, change.collection, change.key]
          if (change.deleted) await client.query(`DELETE FROM ${TABLE} WHERE namespace = $1 AND collection = $2 AND key = $3`, values)
          else await client.query(`INSERT INTO ${TABLE} (namespace, collection, key, payload) VALUES ($1, $2, $3, $4::jsonb)
            ON CONFLICT (namespace, collection, key) DO UPDATE SET payload = EXCLUDED.payload
            WHERE ${TABLE}.payload IS DISTINCT FROM EXCLUDED.payload`, [...values, change.encoded])
        }
        // Clone before commit: a non-cloneable callback result must not report a
        // failure after its writes have actually been committed.
        const returned = clone(result)
        await client.query('COMMIT')
        return returned
      } catch (error) {
        if (began) {
          try { await client.query('ROLLBACK') } catch { discard = true }
        } else discard = true
        retry = RETRYABLE.has(error?.code) && attempt + 1 < maxAttempts
        if (!retry) throw error
      } finally {
        available = false
        client.release(discard)
      }
      if (retry) await retryDelay(attempt)
    }
    throw new Error('Postgres transaction retry limit exceeded')
  }

  async function countRankedQueue(timestamp) {
    if (closed) throw new Error('Postgres document store is closed')
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new TypeError('Invalid ranked queue count timestamp')
    const client = await pool.connect()
    let discard = false
    try {
      // Aggregate both formats in one read-committed statement. The primary key
      // locates the queue and matching player ticket without exporting teams,
      // UIDs, nicknames, or battling players to the function/client.
      const result = await client.query({
        text: `SELECT COUNT(*) FILTER (WHERE q.payload->>'format' = 'single') AS single,
          COUNT(*) FILTER (WHERE q.payload->>'format' = 'double') AS double,
          MIN((q.payload->>'expiresAt')::numeric) AS next_expiry
          FROM ${TABLE} q JOIN ${TABLE} p
            ON p.namespace = q.namespace AND p.collection = 'players' AND p.key = q.key
          WHERE q.namespace = $1 AND q.collection = 'queue'
            AND q.payload->>'format' IN ('single', 'double')
            AND q.payload->>'uid' = q.key
            AND jsonb_typeof(q.payload->'ticket') = 'string' AND q.payload->>'ticket' <> ''
            AND p.payload->>'queueTicket' = q.payload->>'ticket'
            AND COALESCE(p.payload->>'activeMatchId', '') = ''
            AND CASE WHEN jsonb_typeof(q.payload->'expiresAt') = 'number'
              THEN (q.payload->>'expiresAt')::numeric > $2
                AND (q.payload->>'expiresAt')::numeric <= 9007199254740991
                AND (q.payload->>'expiresAt')::numeric = trunc((q.payload->>'expiresAt')::numeric)
              ELSE FALSE END`,
        values: [namespace, timestamp],
        query_timeout: 2_000,
      })
      const row = result.rows[0]
      const count = value => typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value)) ? Number(value) : NaN
      const single = count(row?.single), double = count(row?.double)
      const nextExpiry = row?.next_expiry == null ? null : Number(row.next_expiry)
      if (!Number.isSafeInteger(single) || single < 0 || !Number.isSafeInteger(double) || double < 0
        || (nextExpiry !== null && (!Number.isSafeInteger(nextExpiry) || nextExpiry <= timestamp))) throw new Error('Invalid ranked queue count result')
      return { single, double, nextExpiry }
    } catch (error) {
      discard = true
      throw error
    } finally { client.release(discard) }
  }

  async function countActiveSessions(timestamp) {
    if (closed) throw new Error('Postgres document store is closed')
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new TypeError('Invalid session count timestamp')
    const client = await pool.connect()
    let discard = false
    try {
      // The namespace/collection/key primary key already deduplicates each UID.
      // Anonymous and Google accounts use the same leases; no profile join or
      // personal document payload is needed. This is deliberately outside a
      // SERIALIZABLE transaction so renewals cannot conflict with the aggregate.
      const result = await client.query({
        text: `SELECT COUNT(*) AS count FROM ${TABLE}
          WHERE namespace = $1 AND collection = $2
          AND CASE WHEN jsonb_typeof(payload->'expiresAt') = 'number'
            THEN (payload->>'expiresAt')::numeric > $3 ELSE FALSE END`,
        values: [namespace, 'sessions', timestamp],
        query_timeout: 2_000,
      })
      const rawCount = result.rows[0]?.count
      const count = typeof rawCount === 'number' || (typeof rawCount === 'string' && /^\d+$/.test(rawCount)) ? Number(rawCount) : NaN
      if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid session count result')
      return count
    } catch (error) {
      // query_timeout can reject before the server finishes. Discard that
      // socket instead of returning an outstanding query to the shared pool.
      discard = true
      throw error
    } finally { client.release(discard) }
  }

  async function renewSessionLease({ uid, ownerId, expectedVersion, nextVersion, nowMs, expiresAt, guestDeletionKey = null }) {
    if (closed) throw new Error('Postgres document store is closed')
    checkAddress('sessions', uid)
    if (guestDeletionKey !== null) checkAddress('guestDeletions', guestDeletionKey)
    if (typeof ownerId !== 'string' || typeof expectedVersion !== 'string' || typeof nextVersion !== 'string'
      || !Number.isSafeInteger(nowMs) || nowMs < 0 || !Number.isSafeInteger(expiresAt) || expiresAt <= nowMs) {
      throw new TypeError('Invalid account session renewal')
    }
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const client = await pool.connect()
      let discard = false, retry = false
      try {
        // A lease heartbeat only changes two small JSON fields. One conditional
        // statement avoids a serializable BEGIN/read/write/COMMIT round trip,
        // while PostgreSQL still locks the row and rechecks owner/version/expiry.
        // Keep the guest-deletion fence in the same statement snapshot.
        const result = await client.query({
          text: `WITH guest_deletion AS (
              SELECT $8::text IS NOT NULL AND EXISTS (
                SELECT 1 FROM ${TABLE} WHERE namespace = $1 AND collection = 'guestDeletions' AND key = $8
              ) AS blocked
            ), renewed AS (
              UPDATE ${TABLE} AS session SET payload =
                jsonb_set(jsonb_set(session.payload, '{version}', to_jsonb($5::text)), '{expiresAt}', to_jsonb($6::bigint))
              WHERE session.namespace = $1 AND session.collection = 'sessions' AND session.key = $2
                AND session.payload->>'ownerId' = $3 AND session.payload->>'version' = $4
                AND CASE WHEN jsonb_typeof(session.payload->'expiresAt') = 'number'
                  THEN (session.payload->>'expiresAt')::numeric > $7::numeric ELSE FALSE END
                AND NOT (SELECT blocked FROM guest_deletion)
              RETURNING session.payload->>'ownerId' AS owner_id, session.payload->>'version' AS version,
                session.payload->>'expiresAt' AS expires_at
            )
            SELECT (SELECT blocked FROM guest_deletion) AS guest_deleted,
              (SELECT owner_id FROM renewed) AS owner_id,
              (SELECT version FROM renewed) AS version,
              (SELECT expires_at FROM renewed) AS expires_at`,
          values: [namespace, uid, ownerId, expectedVersion, nextVersion, expiresAt, nowMs, guestDeletionKey],
          query_timeout: 8_000,
        })
        const row = result.rows[0]
        const updatedExpiry = row?.expires_at == null ? null : Number(row.expires_at)
        if (!row || (row.version !== null && (!Number.isSafeInteger(updatedExpiry) || updatedExpiry !== expiresAt
          || row.owner_id !== ownerId || row.version !== nextVersion))) throw new Error('Invalid account session renewal result')
        return { guestDeleted: row.guest_deleted === true,
          session: row.version === null ? null : { ownerId: row.owner_id, version: row.version, expiresAt: updatedExpiry } }
      } catch (error) {
        discard = true
        retry = RETRYABLE.has(error?.code) && attempt + 1 < maxAttempts
        if (!retry) throw error
      } finally { client.release(discard) }
      if (retry) await retryDelay(attempt)
    }
    throw new Error('Postgres session renewal retry limit exceeded')
  }

  return {
    transaction(work) {
      const operation = transact(work)
      active.add(operation)
      void operation.then(() => active.delete(operation), () => active.delete(operation))
      return operation
    },
    countActiveSessions(timestamp) {
      const operation = countActiveSessions(timestamp)
      active.add(operation)
      void operation.then(() => active.delete(operation), () => active.delete(operation))
      return operation
    },
    renewSessionLease(options) {
      const operation = renewSessionLease(options)
      active.add(operation)
      void operation.then(() => active.delete(operation), () => active.delete(operation))
      return operation
    },
    countRankedQueue(timestamp) {
      const operation = countRankedQueue(timestamp)
      active.add(operation)
      void operation.then(() => active.delete(operation), () => active.delete(operation))
      return operation
    },
    async close() {
      if (closed) return
      closed = true
      await Promise.allSettled([...active])
      if (!suppliedPool) await pool.end()
    },
  }
}
