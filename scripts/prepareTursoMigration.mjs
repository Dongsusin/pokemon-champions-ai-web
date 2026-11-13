import { readFile, writeFile, unlink, mkdir, copyFile, constants } from 'node:fs/promises'
import { resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { gunzipSync } from 'node:zlib'
import { createHash, randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { readDocuments, documentDigest } from '../cloudflare/migration/export-to-postgres.mjs'
import { importRecord } from '../cloudflare/migration/import-record.mjs'

const args = process.argv.slice(2)
const [dir, oldDump, cli, phase] = args
if (!dir || !oldDump || !cli || !['warm', 'final'].includes(phase)) throw Error('Usage: node scripts/prepareTursoMigration.mjs <private-dir> <prior-d1-snapshot.sql> <vercel-cli> <warm|final>')
const root = resolve(dir)
await mkdir(root, { recursive: true })
const source = (await readFile(resolve(root,'source-url'),'utf8')).trim()
const secret = (await readFile(resolve(root,'export-key'),'utf8')).trim()
const execute = promisify(execFile)
const keyOf = row => JSON.stringify([row.namespace, row.collection, row.key])
const addr = row => ({ namespace: row.namespace, collection: row.collection, key: row.key })

async function call(action, input = {}) {
  const requestId = randomUUID()
  const path = resolve(root, 'source-request-' + requestId + '.json')
  const headers = resolve(root, 'source-request-' + requestId + '.headers')
  try {
    await writeFile(path, JSON.stringify({ action, ...input }), { mode: 0o600 })
    await writeFile(headers, 'x-migration-key: ' + secret + '\n', { mode: 0o600 })
    const { stdout } = await execute(process.execPath, [cli, 'curl', '/api/export', '--deployment', source, '--',
      '--fail-with-body', '-sS', '--max-time', '45', '-X', 'POST', '-H', 'Content-Type: application/json',
      '-H', '@' + headers, '--data-binary', '@' + path],
    { encoding: 'buffer', timeout: 55_000, maxBuffer: 4_500_000, windowsHide: true })
    return JSON.parse((stdout[0] === 0x1f && stdout[1] === 0x8b ? gunzipSync(stdout, { maxOutputLength: 24_000_000 }) : stdout).toString('utf8'))
  } catch (error) {
    throw Error('Source ' + action + ' failed (' + (error.code ?? 'invalid response') + ')')
  } finally {
    await Promise.allSettled([unlink(path), unlink(headers)])
  }
}

function pgNumber(number) {
  const text = String(number)
  if (!text.includes('e')) return text
  const [coefficient, exponent] = text.split('e')
  const sign = coefficient.startsWith('-') ? '-' : ''
  const [integer, fraction = ''] = coefficient.slice(sign.length).split('.')
  const digits = integer + fraction
  const point = integer.length + Number(exponent)
  if (point <= 0) return sign + '0.' + '0'.repeat(-point) + digits
  if (point >= digits.length) return sign + digits + '0'.repeat(point - digits.length)
  return sign + digits.slice(0, point) + '.' + digits.slice(point)
}

function pgJson(value) {
  if (typeof value === 'number') return pgNumber(value)
  if (!value || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(pgJson).join(', ') + ']'
  const keys = Object.keys(value).map(key => ({ key, bytes: Buffer.from(key) }))
  keys.sort((a,b) => a.bytes.length - b.bytes.length || Buffer.compare(a.bytes,b.bytes))
  return '{' + keys.map(({ key }) => JSON.stringify(key) + ': ' + pgJson(value[key])).join(', ') + '}'
}
const pgHash = value => createHash('sha256').update(pgJson(value)).digest('hex')
const previous = new Map()
let warmReceipt
if (phase === 'final') {
  warmReceipt = JSON.parse(await readFile(resolve(root,'warm-receipt.json'),'utf8'))
  for (const [key, hash] of Object.entries(warmReceipt.postgresHashes)) previous.set(key, { hash })
} else {
  const db = new DatabaseSync(':memory:')
  db.exec(await readFile(oldDump,'utf8'))
  for (const row of readDocuments(db)) previous.set(keyOf(row), { row, hash: pgHash(row.payload) })
  db.close()
}

const count = (await call('count')).count
const current = new Map()
function addManifest(rows) {
  if (!Array.isArray(rows)) throw Error('Invalid source manifest page')
  for (const row of rows) {
    const key = keyOf(row)
    if (current.has(key) || !/^[0-9a-f]{64}$/.test(row.hash)) throw Error('Invalid source manifest')
    current.set(key, row)
  }
}
if (phase === 'final') {
  const addresses = Object.keys(warmReceipt.postgresHashes)
  const bounds = [['', '', '']]
  for (let i = 2400; i < addresses.length; i += 2400) bounds.push(JSON.parse(addresses[i]))
  for (let i = 0; i < bounds.length; i += 4) {
    const pages = await Promise.all(bounds.slice(i, i + 4).map((start, offset) => call('finalManifest', { cursor: [start, bounds[i + offset + 1] ?? null] })))
    for (const { rows } of pages) addManifest(rows)
    console.log('Source manifest', current.size)
  }
} else {
  let cursor = ['', '', '']
  for (;;) {
    const { rows } = await call('manifest', { cursor })
    addManifest(rows)
    console.log('Source manifest', current.size)
    if (rows.length < 1200) break
    const last = rows.at(-1)
    cursor = [last.namespace, last.collection, last.key]
  }
}
if (phase === 'final' && current.size !== count) throw Error('Fenced source count does not match manifest')

const changed = [...current.values()].filter(row => previous.get(keyOf(row))?.hash !== row.hash)
const groups = []
let group = [], groupBytes = 0
for (const row of changed) {
  if (group.length && (group.length >= 400 || groupBytes + row.bytes > 12_000_000)) {
    groups.push(group); group = []; groupBytes = 0
  }
  group.push(row); groupBytes += row.bytes
}
if (group.length) groups.push(group)
console.log(JSON.stringify({ source: current.size, changed: changed.length, groups: groups.length }))
let next = 0
let completed = 0
let failure
await Promise.all(Array.from({length: 4}, async () => {
  while (!failure && next < groups.length) {
    const batch = groups[next++]
    try {
      const { rows } = await call('rows', { keys: batch.map(addr) })
      const seen = new Set()
      const expected = new Set(batch.map(keyOf))
      for (const { hash, ...row } of rows) {
        const key = keyOf(row)
        if (!expected.has(key) || seen.has(key) || !/^[0-9a-f]{64}$/.test(hash)) throw Error('Invalid source row')
        if (phase === 'final' && current.get(key).hash !== hash) throw Error('Fenced source changed during copy')
        seen.add(key)
        previous.set(key,{ row, hash })
      }
      if (phase === 'final' && seen.size !== batch.length) throw Error('Fenced source record missing')
      for (const row of batch) if (!seen.has(keyOf(row))) current.delete(keyOf(row))
      console.log('Source records', ++completed + '/' + groups.length)
    } catch (error) { failure ??= error }
  }
}))
if (failure) throw failure

const output = resolve(root, phase + '.sqlite')
if (phase === 'final') await copyFile(resolve(root, 'warm.sqlite'), output, constants.COPYFILE_EXCL)
const out = new DatabaseSync(output)
const schema = await readFile(new URL('../cloudflare/migrations/0001_documents.sql',import.meta.url),'utf8')
const postgresHashes = {}, documents = {}
out.exec(schema)
if (out.prepare('SELECT count(*) AS n FROM documents').get().n !== (warmReceipt?.count ?? 0)) throw Error('Invalid snapshot base')
out.exec('BEGIN')
try {
  const remove = ['document_slot_overflow', 'document_slots', 'documents'].map(table => out.prepare('DELETE FROM ' + table + ' WHERE namespace=? AND collection=? AND key=?'))
  if (warmReceipt) {
    const removed = [...Object.keys(warmReceipt.documents).filter(key => !current.has(key)), ...changed.map(keyOf)]
    for (const key of removed) for (const statement of remove) statement.run(...JSON.parse(key))
  }
  for (const key of current.keys()) {
    const { row, hash } = previous.get(key)
    if (row) importRecord(out,'documents',row)
    postgresHashes[key] = hash
    documents[key] = row ? documentDigest(row) : warmReceipt.documents[key]
    if (!documents[key]) throw Error('Missing snapshot document digest')
  }
  if (warmReceipt) out.exec('DELETE FROM collection_versions WHERE NOT EXISTS (SELECT 1 FROM documents d WHERE d.namespace=collection_versions.namespace AND d.collection=collection_versions.collection)')
  if (out.prepare('SELECT count(*) AS n FROM documents').get().n !== current.size) throw Error('Snapshot count mismatch')
  out.exec('COMMIT')
} catch(error) {
  out.exec('ROLLBACK')
  throw error
}
const integrity = out.prepare('PRAGMA integrity_check').get().integrity_check
out.close()
if (integrity !== 'ok') throw Error('SQLite integrity check failed')
const digest = createHash('sha256').update(JSON.stringify(documents)).digest('hex')
await writeFile(resolve(root,phase+'-receipt.json'), JSON.stringify({ count: current.size, changed:changed.length, digest, postgresHashes, documents }))
console.log(JSON.stringify({ phase, verified: true, count: current.size, changed: changed.length, digest, integrity }))
