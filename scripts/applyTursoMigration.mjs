import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { createTursoClient } from '../server/tursoStore.js'
import { finishedMatchIndex } from '../server/tursoRetention.js'

const address = row => [row.namespace,row.collection,row.key]
const keyOf = row => JSON.stringify(address(row))
const documentTables = ['documents', 'document_slots', 'document_slot_overflow']
const tables = [...documentTables, 'collection_versions', 'transaction_guard']
const schema = await readFile(new URL('../cloudflare/migrations/0001_documents.sql',import.meta.url),'utf8')
const primary = {
  documents: ['namespace','collection','key'],
  document_slots: ['namespace','collection','key','slot'],
  document_slot_overflow: ['namespace','collection','key','slot','part'],
  collection_versions: ['namespace','collection'],
  transaction_guard: ['id'],
}
function insert(table, row) {
  const columns = Object.keys(row)
  const keys = primary[table]
  const updates = columns.filter(column => !keys.includes(column))
  const action = updates.length ? 'DO UPDATE SET '+updates.map(column => column+'=excluded.'+column).join(',') : 'DO NOTHING'
  return {sql:'INSERT INTO '+table+' ('+columns.join(',')+') VALUES ('+columns.map(()=>'?').join(',')+') ON CONFLICT('+keys.join(',')+') '+action,args:columns.map(column=>row[column])}
}
function remove(table, row) {
  const keys = primary[table].slice(0, table === 'collection_versions' ? 2 : 3)
  return { sql: 'DELETE FROM ' + table + ' WHERE ' + keys.map(key => key + '=?').join(' AND '), args: keys.map(key => row[key]) }
}

export async function applyTursoMigration(client, directory, phase) {
  const root = resolve(directory)
  const read = path => readFile(resolve(root, path), 'utf8')
  const db = new DatabaseSync(resolve(root, phase + '.sqlite'), { readOnly: true })

  async function writeBatch(queries) {
    let pending = [], bytes = 0, completed = 0
    for (const query of queries) {
      const size = Buffer.byteLength(JSON.stringify(query))
      if (pending.length && (pending.length >= 200 || bytes + size > 2_500_000)) {
        await client.batch(pending,'write')
        completed += pending.length
        if (completed % 2000 < 200) console.log('Imported statements',completed)
        pending = []; bytes = 0
      }
      pending.push(query); bytes += size
    }
    if (pending.length) await client.batch(pending,'write')
    return completed + pending.length
  }
  async function countRows(table) {
    const result = await client.execute({sql:'SELECT count(*) AS n FROM '+table,args:[]})
    const count = db.prepare('SELECT count(*) AS n FROM '+table).get().n
    if (Number(result.rows[0].n) !== count) throw Error('Turso count mismatch: '+table)
    return count
  }

  async function verify(table) {
    const keys = primary[table]
    const order = keys.join(',')
    const count = await countRows(table)
    const local = db.prepare('SELECT * FROM '+table+' ORDER BY '+order)
    // Query bounded rows in primary-key order, preserving exact values from the
    // local conversion. This verification never exposes the payload in a log.
    const digest = createHash('sha256')
    if (count === 0) return { count, digest: digest.digest('hex') }
    const position = row => keys.map(key => row[key])
    const tuple = keys.length === 1 ? order : '(' + order + ')'
    const bound = keys.length === 1 ? '?' : '(' + keys.map(() => '?').join(',') + ')'
    async function verifyPage(rows, next) {
      const range = tuple + '>=' + bound + (next ? ' AND ' + tuple + '<' + bound : '')
      const args = [...position(rows[0]), ...(next ? position(next) : [])]
      const remote = await client.execute({ sql: 'SELECT * FROM ' + table + ' WHERE ' + range + ' ORDER BY ' + order, args })
      assertRows(table, rows, remote.rows)
    }
    let rows = [], bytes = 0, checked = 0
    const pending = []
    async function flush(next) {
      const page = rows
      pending.push(verifyPage(page, next))
      for (const row of page) digest.update(JSON.stringify(Object.values(row)) + '\n')
      checked += page.length
      rows = []
      bytes = 0
      if (pending.length >= 4 || !next) {
        const results = await Promise.allSettled(pending.splice(0))
        const failure = results.find(result => result.status === 'rejected')
        if (failure) throw failure.reason
        if (!next || checked % 2400 < 1024) console.log('Verified', table, checked, '/', count)
      }
    }
    for (const row of local.iterate()) {
      const size = Buffer.byteLength(JSON.stringify(Object.values(row)))
      if (rows.length && (rows.length >= 256 || bytes + size > 1_500_000)) await flush(row)
      rows.push(row)
      bytes += size
    }
    await flush(null)
    return { count, digest: digest.digest('hex') }
  }

  function assertRows(table, expected, actual) {
    if (actual.length !== expected.length) throw Error('Turso row mismatch: ' + table)
    for (const [index, row] of expected.entries()) {
      const values = Object.keys(row).map(column => actual[index][column])
      if (JSON.stringify(values) !== JSON.stringify(Object.values(row))) throw Error('Turso content mismatch: ' + table)
    }
  }

  async function verifyChanges(changed) {
    const result = {}
    for (const table of documentTables) {
      const count = await countRows(table)
      const order = primary[table].join(',')
      const local = db.prepare('SELECT * FROM ' + table + ' WHERE namespace=? AND collection=? AND key=? ORDER BY ' + order)
      const qualified = primary[table].map(column => 'd.' + column).join(',')
      const sql = 'SELECT d.* FROM json_each(?) AS key JOIN ' + table + ' AS d ON d.namespace=json_extract(key.value,\'$[0]\') AND d.collection=json_extract(key.value,\'$[1]\') AND d.key=json_extract(key.value,\'$[2]\') ORDER BY ' + qualified
      const groups = []
      let keys = [], bytes = 0
      for (const row of changed) {
        const args = address(row)
        const size = Buffer.byteLength(JSON.stringify(local.all(...args)))
        if (keys.length && (keys.length >= 100 || bytes + size > 1_500_000)) {
          groups.push(keys)
          keys = []
          bytes = 0
        }
        keys.push(args)
        bytes += size
      }
      if (keys.length) groups.push(keys)
      let next = 0
      const results = await Promise.allSettled(Array.from({length: 4}, async () => {
        while (next < groups.length) {
          const group = groups[next++]
          const expected = group.flatMap(args => local.all(...args))
          expected.sort((a, b) => {
            for (const column of primary[table]) {
              if (a[column] === b[column]) continue
              return typeof a[column] === 'number' ? a[column] - b[column] : Buffer.compare(Buffer.from(a[column]), Buffer.from(b[column]))
            }
            return 0
          })
          assertRows(table, expected, (await client.execute({sql, args: [JSON.stringify(group)]})).rows)
        }
      }))
      const failure = results.find(result => result.status === 'rejected')
      if (failure) throw failure.reason
      result[table] = { count, verifiedChangedDocuments: changed.length }
    }
    for (const table of ['collection_versions', 'transaction_guard']) result[table] = await verify(table)
    return result
  }

  try {
    await client.batch([...schema.trim().split(/\r?\n/).filter(Boolean), finishedMatchIndex].map(sql=>({sql,args:[]})),'write')
    let writes = 0, manifests
    const receipt = JSON.parse(await read(phase + '-receipt.json'))
    if (phase === 'warm') {
      for (const table of tables) {
        const sql = db.prepare('SELECT * FROM '+table+' ORDER BY '+primary[table].join(','))
        writes += await writeBatch((function*(){for(const row of sql.iterate())yield insert(table,row)})())
      }
      manifests = {}
      for (const table of tables) manifests[table] = await verify(table)
    } else {
      const warmReceipt = JSON.parse(await read('warm-receipt.json'))
      const proof = JSON.parse(await read('warm-turso-proof.json'))
      if (proof.snapshotDigest !== warmReceipt.digest) throw Error('Warm Turso snapshot has not been verified')
      const warm = warmReceipt.documents
      const final = receipt.documents
      const current = db.prepare('SELECT * FROM documents ORDER BY namespace,collection,key')
      const changed = [...current.iterate()].filter(row=>warm[keyOf(row)]!==final[keyOf(row)])
      const gone = Object.keys(warm).filter(key=>!Object.hasOwn(final,key)).map(key=>{
        const [namespace,collection,record] = JSON.parse(key)
        return {namespace,collection,key:record}
      })
      const readSlots = db.prepare('SELECT * FROM document_slots WHERE namespace=? AND collection=? AND key=?')
      const readParts = db.prepare('SELECT * FROM document_slot_overflow WHERE namespace=? AND collection=? AND key=?')
      const versions = db.prepare('SELECT * FROM collection_versions')
      const warmDb = new DatabaseSync(resolve(root,'warm.sqlite'), { readOnly: true })
      const goneCollections = [...warmDb.prepare('SELECT namespace,collection FROM collection_versions').iterate()].filter(row => !db.prepare('SELECT 1 FROM collection_versions WHERE namespace=? AND collection=?').get(row.namespace,row.collection))
      warmDb.close()
      writes += await writeBatch((function*() {
        for (const row of [...changed,...gone]) {
          yield remove('document_slot_overflow',row)
          yield remove('document_slots',row)
          if (!Object.hasOwn(final,keyOf(row))) yield remove('documents',row)
          else {
            yield insert('documents',row)
            for (const slot of readSlots.iterate(...address(row))) yield insert('document_slots',slot)
            for (const part of readParts.iterate(...address(row))) yield insert('document_slot_overflow',part)
          }
        }
        for (const row of versions.iterate()) yield insert('collection_versions',row)
        for (const row of goneCollections) yield remove('collection_versions',row)
      })())
      // The destination remains fenced from application writes. Exact rows were
      // checked at warm import, so only changed and removed addresses need rereading.
      manifests = await verifyChanges([...changed,...gone])
    }
    const proof = { phase, verified: true, writes, manifests, snapshotDigest: receipt.digest }
    await writeFile(resolve(root, phase + '-turso-proof.json'), JSON.stringify(proof, null, 2))
    return proof
  } finally {
    db.close()
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const [directory, phase] = process.argv.slice(2)
  if (!directory || !['warm', 'final'].includes(phase)) throw Error('Usage: node scripts/applyTursoMigration.mjs <private-dir> <warm|final>')
  const read = path => readFile(resolve(directory, path), 'utf8')
  const client = createTursoClient({ url: (await read('turso-url')).trim(), authToken: (await read('turso-token')).trim() })
  try {
    console.log(JSON.stringify(await applyTursoMigration(client, directory, phase)))
  } catch (error) {
    console.error('Turso migration stopped:', error?.code ?? error?.message?.slice(0, 140))
    process.exitCode = 1
  } finally { client.close() }
}
