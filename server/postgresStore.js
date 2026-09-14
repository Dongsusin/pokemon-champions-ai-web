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
    idleTimeoutMillis: 5_000,
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
    async close() {
      if (closed) return
      closed = true
      await Promise.allSettled([...active])
      if (!suppliedPool) await pool.end()
    },
  }
}
