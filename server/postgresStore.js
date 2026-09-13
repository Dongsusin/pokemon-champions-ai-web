import { Pool } from 'pg'
import { attachDatabasePool } from '@vercel/functions'

const TABLE = 'champions.documents'
const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024
const RETRYABLE = new Set(['40001', '40P01'])
const keyPattern = /^[a-zA-Z0-9_-]{1,128}$/
const namespacePattern = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/
const clone = value => value === undefined ? undefined : structuredClone(value)
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
      const reads = new Map(), writes = new Map()
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
          const result = await client.query(`SELECT key, payload FROM ${TABLE} WHERE namespace = $1 AND collection = $2 ORDER BY key`, [namespace, collection])
          const rows = new Map(result.rows.map(row => [row.key, row.payload]))
          for (const change of writes.values()) {
            if (change.collection !== collection) continue
            if (change.deleted) rows.delete(change.key)
            else rows.set(change.key, change.value)
          }
          return [...rows].map(([id, value]) => ({ id, ...clone(value) }))
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

  return {
    transaction(work) {
      const operation = transact(work)
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
