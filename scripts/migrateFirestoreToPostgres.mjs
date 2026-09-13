import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { initializeApp, cert, deleteApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const option = name => process.argv[process.argv.indexOf(name) + 1]
const mode = process.argv[2]
const sourceProject = option('--project')
const prefix = process.argv.includes('--prefix') ? option('--prefix') : 'ranked'
const backupPath = process.argv.includes('--backup') ? path.resolve(option('--backup')) : ''
const hash = value => createHash('sha256').update(value).digest('hex')

function encode(value) {
  if (value && typeof value.toMillis === 'function') return { __firestoreTimestamp: value.toMillis() }
  if (Array.isArray(value)) return value.map(encode)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)]))
  return value
}
const timestamp = value => Number(value?.__firestoreTimestamp) || Number(value) || 0

export function convertBackup(backup, rankedPrefix = 'ranked') {
  if (backup?.schemaVersion !== 1 || !Array.isArray(backup.documents)) throw new Error('Unsupported backup format')
  const rows = []
  const accounts = new Map()
  const counts = {}
  const paths = new Set()
  for (const { path: documentPath, data } of backup.documents) {
    if (typeof documentPath !== 'string' || paths.has(documentPath)) throw new Error('Unexpected duplicate or invalid source document path')
    paths.add(documentPath)
    const segments = documentPath.split('/')
    if (segments[0].startsWith(`${rankedPrefix}_`) && segments.length === 2) {
      const collection = segments[0].slice(rankedPrefix.length + 1)
      rows.push({ namespace: rankedPrefix, collection, key: segments[1], payload: JSON.parse(data.payload) })
    } else if (segments[0] === 'players') {
      const uid = segments[1]
      const account = accounts.get(uid) ?? {}
      if (segments.length === 2) account.profile = data
      else if (segments.length === 4 && segments[2] === 'gameData' && ['collection', 'progress'].includes(segments[3])) account[segments[3]] = data
      else throw new Error('Unexpected player subcollection; update the migration before importing')
      accounts.set(uid, account)
    } else if (segments[0] !== 'accountSessions') throw new Error('Unexpected source collection')
  }
  for (const [uid, account] of accounts) {
    if (account.profile) rows.push({ namespace: 'account', collection: 'profiles', key: uid, payload: {
      uid, email: account.profile.email ?? null, displayName: account.profile.displayName ?? null,
      photoURL: account.profile.photoURL ?? null, providerIds: account.profile.providerIds ?? [],
      isGuest: account.profile.isGuest === true,
      createdAtMs: timestamp(account.profile.createdAt), lastSeenAtMs: timestamp(account.profile.lastSeenAt),
    } })
    const core = account.progress, collection = account.collection
    if (core || collection) {
      if (!core || !collection) throw new Error('Account snapshot is incomplete; preserve the backup and investigate before importing')
      if (core && collection && core.revision !== collection.revision) throw new Error('Account snapshot revisions differ; export again during the write freeze')
      if (typeof core.revision !== 'string' || !core.revision) throw new Error('Account snapshot has no revision')
      for (const snapshot of [core, collection]) {
        if (!snapshot.payload || typeof snapshot.payload !== 'object' || Array.isArray(snapshot.payload) || Object.values(snapshot.payload).some(value => typeof value !== 'string')) throw new Error('Account payload is malformed')
      }
      if (Object.keys(core.payload).some(key => key in collection.payload && core.payload[key] !== collection.payload[key])) throw new Error('Account payload fields conflict')
      rows.push({ namespace: 'account', collection: 'gameData', key: uid, payload: {
        schemaVersion: Math.max(Number(core?.schemaVersion) || 1, Number(collection?.schemaVersion) || 1),
        revision: core?.revision || collection?.revision || '',
        updatedAtMs: Math.max(timestamp(core?.updatedAt), timestamp(collection?.updatedAt)),
        payload: { ...(core?.payload ?? {}), ...(collection?.payload ?? {}) },
      } })
    }
  }
  for (const row of rows) counts[`${row.namespace}/${row.collection}`] = (counts[`${row.namespace}/${row.collection}`] || 0) + 1
  return { rows: structuredClone(rows), counts, accountCount: accounts.size }
}

async function main() {
  if (!['export', 'inspect', 'import', 'verify'].includes(mode) || !backupPath) throw new Error('Usage: node scripts/migrateFirestoreToPostgres.mjs export|inspect|import|verify --backup <ignored local file> [--project <id> --credentials <file> --prefix ranked]')
  if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,48}$/.test(prefix)) throw new Error('Invalid source prefix')
  if (mode === 'export') {
    if (!sourceProject || (!process.argv.includes('--credentials') && !process.argv.includes('--oauth-token-file'))) throw new Error('Explicit source project and credential file are required')
    let credential
    if (process.argv.includes('--oauth-token-file')) {
      const token = JSON.parse(await fs.readFile(option('--oauth-token-file'), 'utf8'))
      if (token.projectId !== sourceProject || typeof token.access_token !== 'string' || token.expiresAt < Date.now() + 60_000) throw new Error('Source credential project mismatch or expired access')
      credential = { getAccessToken: async () => ({ access_token: token.access_token, expires_in: Math.max(0, Math.floor((token.expiresAt - Date.now()) / 1000)) }) }
    } else {
      const credentials = JSON.parse(await fs.readFile(option('--credentials'), 'utf8'))
      if (credentials.project_id !== sourceProject) throw new Error('Source credential project mismatch')
      credential = cert(credentials)
    }
    const app = initializeApp({ credential, projectId: sourceProject }, `migration-${Date.now()}`)
    try {
      const db = getFirestore(app)
      const roots = await db.listCollections()
      const selected = roots.filter(ref => ['players', 'accountSessions'].includes(ref.id) || ref.id.startsWith(`${prefix}_`))
      const documents = []
      const walk = async collection => {
        // listDocuments also includes missing parent documents that still have
        // gameData children; a normal query would silently omit those accounts.
        const references = await collection.listDocuments()
        for (let offset = 0; offset < references.length; offset += 100) {
          const snapshots = await db.getAll(...references.slice(offset, offset + 100))
          for (const doc of snapshots) {
            if (doc.exists) documents.push({ path: doc.ref.path, data: encode(doc.data()) })
            for (const child of await doc.ref.listCollections()) await walk(child)
          }
        }
      }
      for (const collection of selected) await walk(collection)
      documents.sort((a, b) => a.path.localeCompare(b.path))
      const backup = { schemaVersion: 1, sourceProject, prefix, exportedAt: new Date().toISOString(), documents }
      const serialized = JSON.stringify(backup)
      await fs.mkdir(path.dirname(backupPath), { recursive: true })
      await fs.writeFile(backupPath, serialized, { flag: 'wx', mode: 0o600 })
      await fs.writeFile(`${backupPath}.sha256`, hash(serialized), { flag: 'wx', mode: 0o600 })
      const converted = convertBackup(backup, prefix)
      console.log(JSON.stringify({ mode, sourceProject, documents: documents.length, bytes: Buffer.byteLength(serialized), sha256: hash(serialized), counts: converted.counts, accountCount: converted.accountCount, omittedRoots: roots.length - selected.length }))
    } finally { await deleteApp(app) }
    return
  }
  const serialized = await fs.readFile(backupPath, 'utf8')
  if ((await fs.readFile(`${backupPath}.sha256`, 'utf8')).trim() !== hash(serialized)) throw new Error('Backup checksum mismatch')
  const backup = JSON.parse(serialized)
  const converted = convertBackup(backup, prefix)
  const destinationPrefix = process.argv.includes('--destination-prefix') ? option('--destination-prefix') : prefix
  const accountNamespace = process.argv.includes('--account-namespace') ? option('--account-namespace') : 'account'
  if (![destinationPrefix, accountNamespace].every(value => /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(value)) || destinationPrefix === accountNamespace) throw new Error('Invalid destination namespaces')
  converted.rows = converted.rows.map(row => ({ ...row, namespace: row.namespace === 'account' ? accountNamespace : destinationPrefix }))
  if (mode === 'inspect') {
    console.log(JSON.stringify({ mode, sourceProject: backup.sourceProject, documents: backup.documents.length, bytes: Buffer.byteLength(serialized), counts: converted.counts, accountCount: converted.accountCount }))
    return
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL must be supplied privately in the environment')
  const { createPostgresPool } = await import('../server/postgresStore.js')
  const pool = createPostgresPool()
  try {
    if (mode === 'import') {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const existing = await client.query('SELECT count(*)::int AS count FROM champions.documents WHERE namespace = ANY($1::text[])', [[destinationPrefix, accountNamespace]])
        if (existing.rows[0].count !== 0) throw new Error('Destination namespaces must be empty; existing game data was not overwritten')
        for (const row of converted.rows) await client.query('INSERT INTO champions.documents(namespace, collection, key, payload) VALUES($1,$2,$3,$4::jsonb)', [row.namespace, row.collection, row.key, JSON.stringify(row.payload)])
        await client.query('COMMIT')
      } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error } finally { client.release() }
    }
    const actual = await pool.query('SELECT namespace, collection, key, payload FROM champions.documents WHERE namespace = ANY($1::text[]) ORDER BY namespace, collection, key', [[destinationPrefix, accountNamespace]])
    const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value
    const normalize = rows => JSON.stringify(stable([...rows].sort((a,b) => `${a.namespace}/${a.collection}/${a.key}`.localeCompare(`${b.namespace}/${b.collection}/${b.key}`))))
    if (normalize(actual.rows) !== normalize(converted.rows)) throw new Error('Destination verification mismatch')
    console.log(JSON.stringify({ mode, verified: true, rows: actual.rows.length, accountCount: converted.accountCount, counts: converted.counts, backupSha256: hash(serialized) }))
  } finally { await pool.end() }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1'))) {
  main().catch(error => { console.error('Migration failed:', ['ECONNREFUSED','ENOTFOUND','ETIMEDOUT'].includes(error.code) ? error.code : error.message?.startsWith('Destination') || error.message?.startsWith('Backup') || error.message?.startsWith('Account') || error.message?.startsWith('Unexpected') ? error.message : 'Check source/destination access and the explicit migration arguments. No credentials were logged.'); process.exitCode = 1 })
}
