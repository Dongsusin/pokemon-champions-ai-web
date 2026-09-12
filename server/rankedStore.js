import { mkdir, readFile, rename, open, unlink } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const copy = value => value === undefined ? undefined : structuredClone(value)
const empty = () => ({ version: 1, collections: {} })
const validKey = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value)

function assertAddress(collection, key) {
  if (!validKey(collection) || !validKey(key)) throw new Error('Invalid ranked storage address')
}

async function acquireFileLock(lockPath) {
  try { return await open(lockPath, 'wx', 0o600) } catch (error) {
    if (error.code !== 'EEXIST') throw error
  }
  // An abnormal Windows terminal shutdown can leave the lock file behind.
  // Recovery has its own exclusive lock; only a positively dead owner (ESRCH)
  // may be replaced. An empty, malformed, inaccessible, or live PID is refused.
  const recoveryPath = `${lockPath}.recovery`
  let recovery
  try { recovery = await open(recoveryPath, 'wx', 0o600) } catch {
    throw new Error('Ranked test store is already open or being recovered. Stop its server before retrying.')
  }
  try {
    let text
    try { text = (await readFile(lockPath, 'utf8')).trim() } catch (error) {
      if (error.code === 'ENOENT') return await open(lockPath, 'wx', 0o600)
      throw error
    }
    const pid = Number(text)
    if (!/^[1-9]\d*$/.test(text) || !Number.isSafeInteger(pid) || pid > 2147483647) throw new Error('Ranked test store lock is invalid; verify the old server has stopped before removing its lock.')
    let dead = false
    try { process.kill(pid, 0) } catch (error) { dead = error.code === 'ESRCH' }
    if (!dead) throw new Error('Ranked test store is already open. Stop its server before opening the same file.')
    await unlink(lockPath)
    return await open(lockPath, 'wx', 0o600)
  } finally {
    await recovery.close()
    await unlink(recoveryPath)
  }
}

function memoryTransaction(database) {
  return {
    async get(collection, key) {
      assertAddress(collection, key)
      return copy(database.collections[collection]?.[key] ?? null)
    },
    async list(collection) {
      assertAddress(collection, 'list')
      return Object.entries(database.collections[collection] ?? {}).map(([id, data]) => ({ id, ...copy(data) }))
    },
    set(collection, key, value) {
      assertAddress(collection, key)
      database.collections[collection] ??= {}
      database.collections[collection][key] = copy(value)
    },
    delete(collection, key) {
      assertAddress(collection, key)
      delete database.collections[collection]?.[key]
    },
  }
}

// One serialized transaction is also used by the file adapter. A rejected operation
// never commits its draft, and one rejection must not poison later transactions.
export function createMemoryRankedStore(initial = empty(), { persist } = {}) {
  let database = copy(initial)
  let tail = Promise.resolve()
  return {
    transaction(work) {
      const result = tail.then(async () => {
        const draft = copy(database)
        const value = await work(memoryTransaction(draft))
        if (JSON.stringify(draft) !== JSON.stringify(database)) {
          if (persist) await persist(draft)
          database = draft
        }
        return copy(value)
      })
      tail = result.catch(() => {})
      return result
    },
    async inspect() { await tail; return copy(database) },
    async close() { await tail },
  }
}

export async function createFileRankedStore(filename) {
  const path = resolve(filename)
  await mkdir(dirname(path), { recursive: true })
  const lockPath = `${path}.lock`
  const lock = await acquireFileLock(lockPath)
  try {
    await lock.writeFile(String(process.pid))
    let database
    try { database = JSON.parse(await readFile(path, 'utf8')) } catch (error) {
      if (error.code !== 'ENOENT') throw new Error('Ranked test store cannot be read; it was not overwritten.')
      database = empty()
    }
    if (database?.version !== 1 || !database.collections || typeof database.collections !== 'object') {
      throw new Error('Unsupported ranked test store format')
    }
    const store = createMemoryRankedStore(database, { persist: async next => {
      const temporary = `${path}.${process.pid}.tmp`
      const file = await open(temporary, 'w', 0o600)
      try { await file.writeFile(JSON.stringify(next)); await file.sync() } finally { await file.close() }
      await rename(temporary, path)
    } })
    const close = store.close
    let closed = false
    store.close = async () => {
      if (closed) return
      closed = true
      await close()
      await lock.close()
      await unlink(lockPath)
    }
    return store
  } catch (error) {
    await lock.close()
    await unlink(lockPath)
    throw error
  }
}

// Firestore's transaction can retry work. Mutations are buffered until every read
// finishes, and all randomness/IDs belong to the request rather than its retries.
// Each match has its own document; battle snapshots are never stored in the lobby.
export function createFirestoreRankedStore(firestore, { prefix = 'rankedTest' } = {}) {
  if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,48}$/.test(prefix)) throw new Error('Invalid ranked collection prefix')
  return {
    transaction(work) {
      return firestore.runTransaction(async transaction => {
        const reads = new Map()
        const writes = new Map()
        const reference = (collection, key) => {
          assertAddress(collection, key)
          return firestore.collection(`${prefix}_${collection}`).doc(key)
        }
        const view = {
          async get(collection, key) {
            const address = `${collection}/${key}`
            if (writes.has(address)) return copy(writes.get(address).value)
            if (!reads.has(address)) {
              const snapshot = await transaction.get(reference(collection, key))
              reads.set(address, snapshot.exists ? JSON.parse(snapshot.data().payload) : null)
            }
            return copy(reads.get(address))
          },
          async list(collection) {
            assertAddress(collection, 'list')
            const snapshots = await transaction.get(firestore.collection(`${prefix}_${collection}`))
            const rows = new Map(snapshots.docs.map(snapshot => [snapshot.id, JSON.parse(snapshot.data().payload)]))
            for (const { collection: kind, key, value } of writes.values()) {
              if (kind !== collection) continue
              if (value === null) rows.delete(key)
              else rows.set(key, value)
            }
            return [...rows].map(([id, data]) => ({ id, ...copy(data) }))
          },
          set(collection, key, value) {
            reference(collection, key)
            writes.set(`${collection}/${key}`, { collection, key, value: copy(value) })
          },
          delete(collection, key) {
            reference(collection, key)
            writes.set(`${collection}/${key}`, { collection, key, value: null })
          },
        }
        const result = await work(view)
        for (const { collection, key, value } of writes.values()) {
          if (value === null) transaction.delete(reference(collection, key))
          else {
            // Nested arrays in engine state are legal JSON but invalid Firestore
            // field values. Store a bounded string, preserving exact engine data.
            const payload = JSON.stringify(value)
            if (Buffer.byteLength(payload, 'utf8') > 850_000) throw new Error('Ranked document exceeds the safe Firestore size limit')
            transaction.set(reference(collection, key), { schemaVersion: 1, payload })
          }
        }
        return copy(result)
      })
    },
    async close() {},
  }
}
