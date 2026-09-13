import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { isDeepStrictEqual } from 'node:util'
import { createPostgresPool, createPostgresStore } from '../server/postgresStore.js'
import { createAccountService } from '../server/accountService.js'

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
  countError = null
  countReply = undefined
  constructor(config) { super(); this.config = config; this.options = config }
  async connect() {
    const id = ++this.connectCount
    let draft
    return {
      query: async (text, values = []) => {
        const config = typeof text === 'object' ? text : null
        if (config) { values = config.values ?? []; text = config.text }
        this.calls.push({ id, text, values: copy(values), ...(config ? { queryTimeout: config.query_timeout } : {}) })
        if (text.startsWith('SELECT COUNT(*)')) {
          if (this.countError) throw this.countError
          const count = [...this.rows].filter(([key, value]) => key.startsWith(`${values[0]}/${values[1]}/`)
            && typeof value.expiresAt === 'number' && value.expiresAt > values[2]).length
          return { rows: [{ count: this.countReply === undefined ? String(count) : this.countReply }] }
        }
        if (text.startsWith('BEGIN')) { draft = new Map(copy([...this.rows])); return { rows: [] } }
        if (text.startsWith('SELECT set_config')) return { rows: [] }
        if (text === 'ROLLBACK') { if (this.rollbackFailure) throw sqlError('08006'); draft = null; return { rows: [] } }
        if (text === 'COMMIT') {
          const code = this.conflicts.shift()
          if (code) throw sqlError(code)
          this.rows = draft; return { rows: [] }
        }
        if (text.startsWith("SELECT payload->>'revision'")) {
          const payload = draft.get(address(values))
          return { rows: payload === undefined ? [] : [{ revision: payload.revision, payload_matches: isDeepStrictEqual(payload.payload, JSON.parse(values[3])) }] }
        }
        if (text.includes('AS match')) return { rows: [...draft].filter(([key, value]) => key.startsWith(`${values[0]}/${values[1]}/`) && value.players?.some(player => player.uid === values[2]))
          .map(([key, { state, selections, pendingActions, requests, players, ...metadata }]) => ({ key: key.split('/')[2], match: copy({ ...metadata, players: players.map(({ team, ...player }) => ({ ...player, team: [] })), hadBattleState: Boolean(state) }) })) }
        if (text.includes("payload->'roomResult'->'standings'")) return { rows: [...draft].filter(([key, value]) => key.startsWith(`${values[0]}/${values[1]}/`) && value.roomResult?.standings?.some(player => player.uid === values[2]))
          .map(([key, payload]) => ({ key: key.split('/')[2], payload: copy(payload) })) }
        if (text.startsWith('SELECT key FROM')) return { rows: [...draft].filter(([key, value]) => key.startsWith(`${values[0]}/${values[1]}/`) && value.owner === values[2])
          .map(([key]) => ({ key: key.split('/')[2] })) }
        if (text.startsWith('SELECT payload')) {
          const payload = draft.get(address(values)); return { rows: payload === undefined ? [] : [{ payload: copy(payload) }] }
        }
        if (text.startsWith('SELECT key, jsonb_build_object')) return { rows: [...draft].filter(([key]) => key.startsWith(`${values[0]}/${values[1]}/`))
          .map(([key, payload]) => ({ key: key.split('/')[2], profile: copy({ uid: payload.uid, name: payload.name, isGuest: payload.isGuest, profiles: payload.profiles }) })) }
        if (text.includes('LIMIT 10')) return { rows: [...draft].filter(([key, value]) => key.startsWith(`${values[0]}/${values[1]}/`)
          && key.split('/')[2] !== values[2] && value.owner !== values[2] && !values[3].includes(key.split('/')[2]))
          .map(([key, payload]) => ({ key: key.split('/')[2], payload: copy(payload) }))
          .sort((a, b) => b.payload.floor - a.payload.floor || a.payload.recordedAt - b.payload.recordedAt || a.key.localeCompare(b.key)).slice(0, 10) }
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

test('room lists reuse one database snapshot while reflecting later writes and deletes', async () => {
  const { pool, store } = fixture()
  pool.rows.set('ranked/battleRooms/room_a', { title: 'Before', members: [{ uid: 'alice', team: ['private-team'] }] })
  await store.transaction(async tx => {
    const first = await tx.list('battleRooms')
    first[0].members.length = 0
    assert.equal((await tx.list('battleRooms'))[0].members.length, 1)
    tx.set('battleRooms', 'room_b', { title: 'After', members: [] })
    tx.delete('battleRooms', 'room_a')
    assert.deepEqual(await tx.list('battleRooms'), [{ id: 'room_b', title: 'After', members: [] }])
  })
  assert.equal(pool.calls.filter(call => call.text.startsWith('SELECT key, payload')).length, 1)
  assert.deepEqual(await store.transaction(tx => tx.list('battleRooms')), [{ id: 'room_b', title: 'After', members: [] }], 'The cache must not escape its transaction')
})

test('account save comparison returns only revision and equality, with full payload kept inside the database', async () => {
  const { pool, store } = fixture({ namespace: 'account' })
  const payload = { 'champions-dex-v2': 'x'.repeat(1_000_000), 'champions-vp-v1': '50000' }
  const saved = { schemaVersion: 1, revision: 'revision-0001', updatedAtMs: 1, payload }
  pool.rows.set('account/gameData/guest_a', saved)
  await store.transaction(async tx => {
    assert.equal(await tx.compareGameData('missing', payload), null)
    const same = await tx.compareGameData('guest_a', { 'champions-vp-v1': '50000', 'champions-dex-v2': payload['champions-dex-v2'] })
    assert.deepEqual(same, { revision: 'revision-0001', payloadMatches: true })
    assert(Buffer.byteLength(JSON.stringify(same)) < 100, 'A one-megabyte save must yield a small metadata response')
    assert.equal((await tx.compareGameData('guest_a', { ...payload, 'champions-vp-v1': '49999' })).payloadMatches, false)
    tx.set('gameData', 'guest_a', { ...saved, revision: 'revision-0002' })
    assert.deepEqual(await tx.compareGameData('guest_a', payload), { revision: 'revision-0002', payloadMatches: true })
    tx.delete('gameData', 'guest_a')
    assert.equal(await tx.compareGameData('guest_a', payload), null)
  })
  assert.equal(pool.calls.filter(call => /^SELECT payload FROM/.test(call.text)).length, 0)
  assert.equal(pool.calls.filter(call => call.text.includes('AS payload_matches')).length, 3)
})

test('projected saves retain idempotency, sequence ordering and revision reuse protection', async () => {
  const { pool, store } = fixture({ namespace: 'account' })
  const service = createAccountService({ store, now: () => 1000, newVersion: () => 'validation-lease' })
  const identity = { uid: 'account_a', isGuest: false }
  const execute = command => service.execute(identity, { ownerId: 'validation-owner-12345', ...command })
  await execute({ action: 'sessionAcquire' })
  const first = { action: 'save', revision: 'revision-first', saveSequence: 1, payload: { 'champions-vp-v1': '50000', 'champions-dex-v2': '[]' } }
  await execute(first)
  await execute({ ...first, payload: Object.fromEntries(Object.entries(first.payload).reverse()) })
  await assert.rejects(execute({ ...first, saveSequence: 2, payload: { 'champions-vp-v1': '1' } }), error => error.code === 'SAVE_REVISION_REUSED')
  await execute({ ...first, revision: 'revision-next', saveSequence: 2, payload: { 'champions-vp-v1': '45000' } })
  await assert.rejects(execute(first), error => error.code === 'STALE_SAVE')
  assert.deepEqual(pool.rows.get('account/gameData/account_a').payload, { 'champions-vp-v1': '45000' })
  assert(!pool.calls.some(call => /^SELECT payload FROM/.test(call.text) && call.values[1] === 'gameData'))
})

test('guest cleanup reads only related metadata and removes only matching usage receipts atomically', async () => {
  const { pool, store } = fixture()
  const match = { id: 'match_a', state: { private: 'x'.repeat(100_000) }, selections: { guest_a: [1] }, pendingActions: { player: {} }, requests: ['private'], players: [{ uid: 'guest_a', team: ['private'] }, { uid: 'alice', team: ['private'] }] }
  pool.rows.set('ranked/matches/match_a', match)
  pool.rows.set('ranked/matches/unrelated', { ...match, id: 'unrelated', players: [{ uid: 'bob', team: [] }, { uid: 'alice', team: [] }] })
  pool.rows.set('account/matches/match_a', match)
  pool.rows.set('ranked/players/alice', { roomResult: { standings: [{ uid: 'guest_a' }, { uid: 'alice' }] } })
  pool.rows.set('ranked/players/bob', { roomResult: { standings: [{ uid: 'bob' }] } })
  pool.rows.set('ranked/pokemonUsageEvents/first', { owner: 'guest_hash' })
  pool.rows.set('ranked/pokemonUsageEvents/second', { owner: 'other_hash' })
  pool.rows.set('ranked/pokemonUsageEvents/legacy', { hash: 'anonymous_aggregate_receipt' })
  await assert.rejects(store.transaction(async tx => { await tx.deleteGuestUsageEvents('guest_hash'); throw new Error('rollback cleanup') }), /rollback cleanup/)
  assert(pool.rows.has('ranked/pokemonUsageEvents/first'))
  await store.transaction(async tx => {
    const matches = await tx.listGuestMatches('guest_a')
    assert.equal(matches.length, 1)
    assert.equal(matches[0].hadBattleState, true)
    assert(matches[0].players.every(player => player.team.length === 0))
    assert(['state', 'selections', 'pendingActions', 'requests'].every(key => !Object.hasOwn(matches[0], key)))
    tx.delete('matches', 'match_a')
    tx.set('matches', 'new_match', { ...match, id: 'new_match', state: null })
    assert.deepEqual((await tx.listGuestMatches('guest_a')).map(entry => [entry.id, entry.hadBattleState]), [['new_match', false]])
    assert.deepEqual((await tx.listGuestRelatedPlayers('guest_a')).map(entry => entry.id), ['alice'])
    tx.set('players', 'alice', { roomResult: null })
    tx.set('players', 'charlie', { roomResult: { standings: [{ uid: 'guest_a' }] } })
    assert.deepEqual((await tx.listGuestRelatedPlayers('guest_a')).map(entry => entry.id), ['charlie'])
    tx.set('pokemonUsageEvents', 'third', { owner: 'guest_hash' })
    assert.equal(await tx.deleteGuestUsageEvents('guest_hash'), 2)
  })
  assert(!pool.rows.has('ranked/pokemonUsageEvents/first'))
  assert(!pool.rows.has('ranked/pokemonUsageEvents/third'))
  assert(pool.rows.has('ranked/pokemonUsageEvents/second'))
  assert(pool.rows.has('ranked/pokemonUsageEvents/legacy'))
  assert(pool.rows.has('account/matches/match_a'))
})

test('factory ranking refill downloads only ten remaining personal bests and accounts for pending deletions before LIMIT', async () => {
  const { pool, store } = fixture()
  for (let index = 0; index < 14; index++) {
    const owner = `owner_${String(index).padStart(2, '0')}`
    pool.rows.set(`ranked/factoryPersonalBest/${owner}`, { id: `entry_${index}`, owner, floor: 100 - index, recordedAt: 1000, party: [{ speciesId: 6 }] })
  }
  pool.rows.set('account/factoryPersonalBest/foreign', { owner: 'foreign', floor: 1000, recordedAt: 0 })
  await store.transaction(async tx => {
    tx.delete('factoryPersonalBest', 'owner_00')
    tx.delete('factoryPersonalBest', 'owner_01')
    tx.set('factoryPersonalBest', 'owner_02', { owner: 'owner_02', floor: 1, recordedAt: 1 })
    tx.set('factoryPersonalBest', 'new_best', { owner: 'new_best', floor: 200, recordedAt: 2 })
    const entries = await tx.listFactoryBestCandidates('owner_00')
    assert.equal(entries.length, 10)
    assert.equal(entries[0].owner, 'new_best')
    assert.equal(entries[1].id, 'entry_3', 'Stored entry IDs must be preserved')
    assert.equal(entries.at(-1).owner, 'owner_11', 'Pending deleted and demoted rows cannot consume the top ten query limit')
    entries[1].party.length = 0
    assert.equal((await tx.listFactoryBestCandidates('owner_00'))[1].party.length, 1)
  })
  const queries = pool.calls.filter(call => call.text.includes('LIMIT 10'))
  assert.equal(queries.length, 2)
  assert(queries.every(call => call.values[0] === 'ranked' && call.values[2] === 'owner_00'))
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

test('online session COUNT is namespace filtered, bounded, private and outside a serializable transaction', async () => {
  const { pool, store } = fixture({ namespace: 'account' })
  pool.rows.set('account/sessions/alice', { expiresAt: 1001, ownerId: 'private-owner', version: 'private-version' })
  pool.rows.set('account/sessions/guest', { expiresAt: 90000 })
  pool.rows.set('account/sessions/expired', { expiresAt: 999 })
  pool.rows.set('account/sessions/boundary', { expiresAt: 1000 })
  pool.rows.set('account/sessions/malformed', { expiresAt: 'never' })
  pool.rows.set('ranked/sessions/foreign', { expiresAt: 90000 })
  pool.rows.set('account/profiles/unrelated', { expiresAt: 90000 })
  assert.equal(await store.countActiveSessions(1000), 2)
  assert.equal(pool.calls.length, 1)
  const query = pool.calls[0]
  assert(query.text.startsWith('SELECT COUNT(*) AS count'))
  assert(!/SELECT\s+(?:payload|key)/i.test(query.text))
  assert(query.text.includes("jsonb_typeof(payload->'expiresAt') = 'number'"))
  assert.deepEqual(query.values, ['account', 'sessions', 1000])
  assert.equal(query.queryTimeout, 2000)
  assert.deepEqual(pool.released, [{ id: 1, discard: false }])
  await assert.rejects(store.countActiveSessions(NaN), /timestamp/)
  await assert.rejects(store.countActiveSessions(-1), /timestamp/)
  assert.equal(pool.connectCount, 1)
  await store.close()
  await assert.rejects(store.countActiveSessions(1000), /closed/)
})

test('failed or malformed session counts discard their socket without issuing rollback or writes', async () => {
  const { pool, store } = fixture({ namespace: 'account' })
  pool.countError = sqlError('57014')
  await assert.rejects(store.countActiveSessions(1000), error => error.code === '57014')
  pool.countError = null
  for (const response of ['NaN', '-1', null, '9007199254740992']) {
    pool.countReply = response
    await assert.rejects(store.countActiveSessions(1000), /result/)
  }
  assert(pool.released.every(release => release.discard === true))
  assert(pool.calls.every(call => call.text.startsWith('SELECT COUNT(*)')))
  assert.equal(pool.rows.size, 0)
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
    const savedPayload = { 'champions-dex-v2': 'x'.repeat(100_000), 'champions-vp-v1': '50000' }
    await store.transaction(tx => {
      tx.set('gameData', 'save_fixture', { revision: 'live-revision', payload: savedPayload })
      tx.set('matches', 'match_fixture', { id: 'match_fixture', state: { private: true }, selections: {}, players: [{ uid: 'guest_fixture', team: [1] }, { uid: 'other_fixture', team: [2] }] })
      tx.set('matches', 'unrelated_fixture', { players: [{ uid: 'other_fixture', team: [2] }] })
      tx.set('players', 'other_fixture', { roomResult: { standings: [{ uid: 'guest_fixture' }, { uid: 'other_fixture' }] } })
      tx.set('pokemonUsageEvents', 'receipt_fixture', { owner: 'guest_fixture_hash' })
      for (let index = 0; index < 13; index++) {
        const owner = `owner_${String(index).padStart(2, '0')}`
        tx.set('factoryPersonalBest', owner, { id: `entry_${index}`, owner, floor: 100 - index, recordedAt: index, party: [{ speciesId: 6 }] })
      }
    })
    await store.transaction(async tx => {
      assert.deepEqual(await tx.compareGameData('save_fixture', savedPayload), { revision: 'live-revision', payloadMatches: true })
      assert.equal((await tx.compareGameData('save_fixture', {})).payloadMatches, false)
      const matches = await tx.listGuestMatches('guest_fixture')
      assert.equal(matches.length, 1)
      assert.equal(matches[0].hadBattleState, true)
      assert(!Object.hasOwn(matches[0], 'state'))
      assert(matches[0].players.every(player => player.team.length === 0))
      assert.deepEqual((await tx.listGuestRelatedPlayers('guest_fixture')).map(player => player.id), ['other_fixture'])
      assert.equal(await tx.deleteGuestUsageEvents('guest_fixture_hash'), 1)
      tx.delete('factoryPersonalBest', 'owner_01')
      const candidates = await tx.listFactoryBestCandidates('owner_00')
      assert.equal(candidates.length, 10)
      assert.equal(candidates[0].id, 'entry_2')
      assert.equal(candidates.at(-1).owner, 'owner_11')
    })
    assert.equal(await store.transaction(tx => tx.get('pokemonUsageEvents', 'receipt_fixture')), null)
    const privileges = await pool.query("SELECT current_user, has_schema_privilege('anon', 'champions', 'USAGE') AS anon_schema, has_table_privilege('authenticated', 'champions.documents', 'SELECT') AS auth_read, relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'champions.documents'::regclass")
    assert.equal(privileges.rows[0].current_user, 'champions_server')
    assert.equal(privileges.rows[0].anon_schema, false)
    assert.equal(privileges.rows[0].auth_read, false)
    assert.equal(privileges.rows[0].relrowsecurity, true)
    assert.equal(privileges.rows[0].relforcerowsecurity, true)
    console.log('PASS live Postgres save comparisons, guest projections, concurrent writes, rollback, TLS and private RLS configuration')
    passed++
  } finally {
    await store.transaction(async tx => {
      for (const collection of ['counters', 'gameData', 'matches', 'players', 'pokemonUsageEvents', 'factoryPersonalBest']) {
        for (const row of await tx.list(collection)) tx.delete(collection, row.id)
      }
    })
    await store.close()
    await pool.end()
  }
} else console.log('SKIP live Postgres integration (set POSTGRES_STORE_INTEGRATION=true with server connection secrets)')
console.log(`Postgres store validation passed: ${passed}/${passed}`)
