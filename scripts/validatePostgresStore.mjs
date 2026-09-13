import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createPostgresPool, createPostgresStore } from '../server/postgresStore.js'

const copy = value => structuredClone(value)
const address = values => values.slice(0, 3).join('/')
const sqlError = code => Object.assign(new Error(`Fixture database ${code}`), { code })
class FixturePool extends EventEmitter {
  rows = new Map()
  calls = []
  released = []
  conflicts = []
  rollbackFailure = false
  connectCount = 0
  ended = false
  constructor(config) { super(); this.config = config; this.options = config }
  async connect() {
    const id = ++this.connectCount
    let draft
    return {
      query: async (text, values = []) => {
        this.calls.push({ id, text, values: copy(values) })
        if (text.startsWith('BEGIN')) { draft = new Map(copy([...this.rows])); return { rows: [] } }
        if (text.startsWith('SELECT set_config')) return { rows: [] }
        if (text === 'ROLLBACK') { if (this.rollbackFailure) throw sqlError('08006'); draft = null; return { rows: [] } }
        if (text === 'COMMIT') {
          const code = this.conflicts.shift()
          if (code) throw sqlError(code)
          this.rows = draft; return { rows: [] }
        }
        if (text.startsWith('SELECT payload')) {
          const payload = draft.get(address(values)); return { rows: payload === undefined ? [] : [{ payload: copy(payload) }] }
        }
        if (text.startsWith('SELECT key, jsonb_build_object')) return { rows: [...draft].filter(([key]) => key.startsWith(`${values[0]}/${values[1]}/`))
          .map(([key, payload]) => ({ key: key.split('/')[2], profile: copy({ uid: payload.uid, name: payload.name, isGuest: payload.isGuest, profiles: payload.profiles }) })) }
        if (text.startsWith('SELECT key, payload')) return { rows: [...draft].filter(([key]) => key.startsWith(`${values[0]}/${values[1]}/`))
          .map(([key, payload]) => ({ key: key.split('/')[2], payload: copy(payload) })).sort((a, b) => a.key.localeCompare(b.key)) }
        if (text.startsWith('INSERT INTO')) { draft.set(address(values), JSON.parse(values[3])); return { rows: [] } }
        if (text.startsWith('DELETE FROM')) { draft.delete(address(values)); return { rows: [] } }
        throw new Error('Unexpected fixture query')
      },
      release: discard => this.released.push({ id, discard }),
    }
  }
  async end() { this.ended = true }
}

const tests = []
const test = (name, run) => tests.push({ name, run })
const fixture = options => {
  const pool = new FixturePool()
  const store = createPostgresStore({ pool, namespace: 'ranked', retryDelay: async () => {}, ...options })
  return { pool, store }
}

test('pool keeps three verified TLS connections and rejects SSL URL overrides', () => {
  const config = { connectionString: 'postgresql://champions_server:fixture-password@db.example.test:5432/postgres',
    sslCa: '-----BEGIN CERTIFICATE-----\nfixture\n-----END CERTIFICATE-----', PoolClass: FixturePool }
  const pool = createPostgresPool(config)
  assert.equal(pool.config.max, 3)
  assert.equal(pool.config.ssl.rejectUnauthorized, true)
  assert.equal(pool.config.ssl.ca, config.sslCa)
  assert.equal(pool.config.statement_timeout, 8_000)
  assert.equal(pool.config.idle_in_transaction_session_timeout, 10_000)
  assert.equal(pool.listenerCount('error'), 1)
  pool.emit('error', sqlError('08006'))
  for (const parameter of ['sslmode=require', 'sslmode=no-verify', 'ssl=false', 'sslcert=hidden', 'sslrootcert=hidden', 'sslkey=hidden']) {
    assert.throws(() => createPostgresPool({ ...config, connectionString: `${config.connectionString}?${parameter}` }), /TLS/)
  }
  for (const connectionString of [null, '', 'https://db.example.test', 'postgresql://db.example.test/postgres']) {
    assert.throws(() => createPostgresPool({ ...config, connectionString }), /configured/)
  }
  assert.throws(() => createPostgresPool({ ...config, sslCa: 'not-a-certificate' }), /certificate/)
})

test('buffered writes, deletes, repeated reads and collection lists are atomic and isolated', async () => {
  const { pool, store } = fixture()
  pool.rows.set('ranked/players/alice', { uid: 'alice', score: 1 })
  pool.rows.set('ranked/players/bob', { uid: 'bob', score: 2 })
  await store.transaction(async tx => {
    const first = await tx.get('players', 'alice')
    first.score = 999
    assert.equal((await tx.get('players', 'alice')).score, 1)
    const incoming = { uid: 'alice', score: 3 }
    tx.set('players', 'alice', incoming)
    incoming.score = 888
    tx.delete('players', 'bob')
    tx.set('players', 'charlie', { uid: 'charlie', score: 4 })
    assert.equal((await tx.get('players', 'alice')).score, 3)
    assert.equal(await tx.get('players', 'bob'), null)
    assert.deepEqual(await tx.list('players'), [{ id: 'alice', uid: 'alice', score: 3 }, { id: 'charlie', uid: 'charlie', score: 4 }])
    assert.equal(pool.rows.get('ranked/players/alice').score, 1, 'No writes are visible before COMMIT')
  })
  assert.equal(pool.rows.get('ranked/players/alice').score, 3)
  assert.equal(pool.rows.has('ranked/players/bob'), false)
  assert.equal(pool.calls.filter(call => call.text.startsWith('SELECT payload')).length, 1)
  assert.equal(new Set(pool.calls.map(call => call.id)).size, 1, 'Every transaction statement uses one checked-out client')
  assert.equal(pool.calls[0].text, 'BEGIN ISOLATION LEVEL SERIALIZABLE')
  assert.deepEqual(pool.calls[1].values, ['8000', '10000', '5000'])
  assert.deepEqual(pool.released, [{ id: 1, discard: false }])
})

test('ranked projection excludes private payloads and includes atomic buffered changes', async () => {
  const { pool, store } = fixture()
  const profile = { single: { played: 1, points: 30 }, double: { played: 0, points: 0 } }
  pool.rows.set('ranked/players/alice', { uid: 'alice', name: 'Alice', isGuest: false, profiles: profile, team: ['private'], history: ['private'], requests: ['private'] })
  pool.rows.set('ranked/players/bob', { uid: 'bob', name: 'Bob', profiles: profile })
  pool.rows.set('account/players/other', { uid: 'other', profiles: profile })
  await store.transaction(async tx => {
    const first = await tx.listRankedProfiles()
    assert.equal(first.length, 2)
    assert.deepEqual(first[0], { id: 'alice', uid: 'alice', name: 'Alice', isGuest: false, profiles: profile })
    first[0].profiles.single.points = 9999
    assert.equal((await tx.listRankedProfiles())[0].profiles.single.points, 30)
    tx.delete('players', 'bob')
    tx.set('players', 'charlie', { name: 'Charlie', profiles: profile, team: ['private'] })
    const updated = await tx.listRankedProfiles()
    assert.deepEqual(updated.map(player => player.uid), ['alice', 'charlie'])
    assert(updated.every(player => Object.keys(player).every(key => ['id', 'uid', 'name', 'isGuest', 'profiles'].includes(key))))
  })
  const queries = pool.calls.filter(call => call.text.startsWith('SELECT key, jsonb_build_object'))
  assert.equal(queries.length, 3)
  assert(queries.every(call => !call.text.includes('SELECT key, payload') && !call.text.includes("payload->'team'")))
  assert(queries.every(call => JSON.stringify(call.values) === JSON.stringify(['ranked', 'players'])))
  await store.close()
})

test('account and ranked namespaces share a pool without sharing documents', async () => {
  const { pool, store: ranked } = fixture()
  const account = createPostgresStore({ pool, namespace: 'account' })
  await ranked.transaction(tx => tx.set('players', 'same_uid', { score: 12 }))
  await account.transaction(tx => tx.set('players', 'same_uid', { wallet: 50_000 }))
  assert.deepEqual(await ranked.transaction(tx => tx.get('players', 'same_uid')), { score: 12 })
  assert.deepEqual(await account.transaction(tx => tx.get('players', 'same_uid')), { wallet: 50_000 })
  await ranked.close()
  assert.equal(pool.ended, false)
  assert.deepEqual(await account.transaction(tx => tx.get('players', 'same_uid')), { wallet: 50_000 })
  await assert.rejects(ranked.transaction(() => {}), /closed/)
  await account.close()
})

test('callback and write errors roll back all documents and release the client', async () => {
  const { pool, store } = fixture()
  await assert.rejects(store.transaction(tx => { tx.set('players', 'alice', { value: 1 }); throw new Error('callback failure') }), /callback failure/)
  assert.equal(pool.rows.size, 0)
  assert.equal(pool.calls.at(-1).text, 'ROLLBACK')
  assert.equal(pool.released.length, 1)
  await assert.rejects(store.transaction(tx => { tx.set('players', 'alice', { value: 1 }); return () => {} }), /could not be cloned/)
  assert.equal(pool.rows.size, 0, 'A result clone failure must occur before COMMIT')
  pool.rollbackFailure = true
  await assert.rejects(store.transaction(() => { throw new Error('original failure') }), /original failure/)
  assert.equal(pool.released.at(-1).discard, true)
})

test('serialization and deadlock errors replay the whole callback within a fixed bound', async () => {
  const { pool, store } = fixture()
  pool.conflicts.push('40001', '40P01')
  let runs = 0
  const returned = await store.transaction(async tx => { runs++; await tx.get('players', 'alice'); tx.set('players', 'alice', { attempts: runs }); return { runs } })
  assert.equal(runs, 3)
  assert.deepEqual(returned, { runs: 3 })
  assert.deepEqual(pool.rows.get('ranked/players/alice'), { attempts: 3 })
  assert.equal(pool.calls.filter(call => call.text === 'ROLLBACK').length, 2)
  assert.equal(pool.released.length, 3)
  const exhausted = fixture({ maxAttempts: 2 })
  exhausted.pool.conflicts.push('40001', '40001', '40001')
  await assert.rejects(exhausted.store.transaction(tx => tx.set('players', 'alice', { value: 1 })), error => error.code === '40001')
  assert.equal(exhausted.pool.connectCount, 2)
  assert.equal(exhausted.pool.rows.size, 0)
  const forbidden = fixture()
  forbidden.pool.conflicts.push('42501')
  await assert.rejects(forbidden.store.transaction(tx => tx.set('players', 'alice', {})), error => error.code === '42501')
  assert.equal(forbidden.pool.connectCount, 1)
})

test('SQL values remain parameters, malformed addresses fail, and JSON snapshots support over two megabytes', async () => {
  const { pool, store } = fixture()
  const text = `'); DELETE FROM champions.documents; --`
  const large = { text, history: '한'.repeat(720_000) }
  await store.transaction(tx => tx.set('gameData', 'uid_a', large))
  const insert = pool.calls.find(call => call.text.startsWith('INSERT'))
  assert(!insert.text.includes(text))
  assert.equal(JSON.parse(insert.values[3]).text, text)
  assert.deepEqual(await store.transaction(tx => tx.get('gameData', 'uid_a')), large)
  for (const key of ['', 123, '../uid', 'a/b', 'x'.repeat(129)]) {
    await assert.rejects(store.transaction(tx => tx.get('players', key)), /address/)
    await assert.rejects(store.transaction(tx => tx.set('players', key, {})), /address/)
  }
  await assert.rejects(store.transaction(tx => tx.set('players', 'undefined', undefined)), /JSON/)
  await assert.rejects(store.transaction(tx => tx.set('players', 'huge', { text: 'x'.repeat(8 * 1024 * 1024) })), /size limit/)
  assert.throws(() => createPostgresStore({ pool, namespace: 'account; DROP SCHEMA champions' }), /namespace/)
})

test('transaction handles expire after commit and store close waits for active work', async () => {
  const { pool, store } = fixture()
  let view, release
  const pending = new Promise(resolve => { release = resolve })
  const operation = store.transaction(async tx => { view = tx; await pending; tx.set('sessions', 'alice', { active: true }) })
  let closed = false
  const closing = store.close().then(() => { closed = true })
  await Promise.resolve()
  assert.equal(closed, false)
  release()
  await operation
  await closing
  assert.equal(closed, true)
  assert.throws(() => view.set('sessions', 'bob', {}), /ended/)
  await assert.rejects(view.get('sessions', 'alice'), /ended/)
  assert.equal(pool.rows.get('ranked/sessions/alice').active, true)
})

test('migration exposes documents only to the dedicated server role under forced RLS', async () => {
  const sql = await readFile(new URL('../supabase/migrations/202609130001_champions_documents.sql', import.meta.url), 'utf8')
  for (const required of ['create schema if not exists champions', 'create table if not exists champions.documents',
    'primary key (namespace, collection, key)', 'enable row level security', 'force row level security',
    'from public, anon, authenticated', 'for all to champions_server using (true) with check (true)',
    'nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls']) assert(sql.includes(required))
  assert(!/password\s+'[^']+'/i.test(sql))
})

let passed = 0
for (const { name, run } of tests) { await run(); passed++; console.log(`PASS ${name}`) }

if (process.env.POSTGRES_STORE_INTEGRATION === 'true') {
  const pool = createPostgresPool()
  const namespace = `validation_${randomUUID().replaceAll('-', '')}`
  const store = createPostgresStore({ pool, namespace, maxAttempts: 8 })
  try {
    await store.transaction(tx => tx.set('counters', 'concurrent', { count: 0 }))
    await Promise.all(Array.from({ length: 6 }, () => store.transaction(async tx => {
      const previous = await tx.get('counters', 'concurrent')
      tx.set('counters', 'concurrent', { count: previous.count + 1 })
    })))
    assert.equal((await store.transaction(tx => tx.get('counters', 'concurrent'))).count, 6)
    await assert.rejects(store.transaction(tx => { tx.set('counters', 'rolled_back', { value: true }); throw new Error('rollback verification') }), /rollback verification/)
    assert.equal(await store.transaction(tx => tx.get('counters', 'rolled_back')), null)
    await store.transaction(async tx => { tx.set('counters', 'inflight', { value: 2 }); assert.equal((await tx.get('counters', 'inflight')).value, 2); tx.delete('counters', 'inflight') })
    const privileges = await pool.query("SELECT current_user, has_schema_privilege('anon', 'champions', 'USAGE') AS anon_schema, has_table_privilege('authenticated', 'champions.documents', 'SELECT') AS auth_read, relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'champions.documents'::regclass")
    assert.equal(privileges.rows[0].current_user, 'champions_server')
    assert.equal(privileges.rows[0].anon_schema, false)
    assert.equal(privileges.rows[0].auth_read, false)
    assert.equal(privileges.rows[0].relrowsecurity, true)
    assert.equal(privileges.rows[0].relforcerowsecurity, true)
    console.log('PASS live Postgres concurrent writes, rollback, TLS and private RLS configuration')
    passed++
  } finally {
    await store.transaction(async tx => { for (const row of await tx.list('counters')) tx.delete('counters', row.id) })
    await store.close()
    await pool.end()
  }
} else console.log('SKIP live Postgres integration (set POSTGRES_STORE_INTEGRATION=true with server connection secrets)')
console.log(`Postgres store validation passed: ${passed}/${passed}`)
