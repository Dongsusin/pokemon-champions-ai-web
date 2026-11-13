import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { createD1DocumentApi } from '../cloudflare/document-store.mjs'
import { hashValue } from '../server/cloudflareCodec.js'
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { sqliteD1 } from '../cloudflare/test/d1-sqlite.mjs'
import { createTursoStore } from '../server/tursoStore.js'
import { createAccountService } from '../server/accountService.js'
import { fingerprintAccountSlots } from '../src/auth/accountSavePatch.js'
import { createClient } from '@libsql/client'
import { finishedMatchIndex, pruneTursoCompletedBattles } from '../server/tursoRetention.js'
import { importRecord } from '../cloudflare/migration/import-record.mjs'
import { documentDigest } from '../cloudflare/migration/export-to-postgres.mjs'
import { applyTursoMigration } from './applyTursoMigration.mjs'

const schema = await readFile(new URL('../cloudflare/migrations/0001_documents.sql', import.meta.url), 'utf8')
function fixture() {
  const db = sqliteD1(schema)
  const calls = []
  const result = row => ({ rows: row.results, rowsAffected: row.meta.changes })
  const client = {
    async execute(statement) {
      calls.push({ mode: 'single', statements: [statement] })
      return result(await db.prepare(statement.sql).bind(...statement.args).all())
    },
    async batch(statements, mode) {
      calls.push({ mode, statements })
      return (await db.batch(statements)).map(result)
    },
    close() { db.sqlite.close() },
  }
  return { db, calls, client, store: createTursoStore({ client, namespace: 'account' }) }
}

test('Turso keeps session ownership, exact slots, and save patches atomic', async () => {
  const { store, client, calls } = fixture()
  try {
    const service = createAccountService({ store, now: () => 1000 })
    const identity = { uid: 'alice', isGuest: false }
    const ownerId = 'arena-turso-test-owner'
    const request = (action, options) => service.execute(identity, { action, ownerId, ...options })
    await request('sessionAcquire')
    const box = '[{"name":"피카츄😀"}]'
    const payload = { 'champions-box-v1': box, 'champions-vp-v1': '50000' }
    await request('save', { revision: 'save-initial', saveSequence: 1, payload })
    assert.deepEqual((await request('load')).gameData.payload, payload)
    await request('savePatch', { revision: 'save-updated', baseRevision: 'save-initial',
      saveSequence: 2, patch: { 'champions-vp-v1': '51000' }, removed: [] })
    assert.deepEqual((await request('load')).gameData.payload, { ...payload, 'champions-vp-v1': '51000' })
    await assert.rejects(request('load', { ownerId: 'arena-different-owner' }), { code: 'account-session/lost' })
    assert.ok(calls.some(call => call.mode === 'read'))
    assert.ok(calls.some(call => call.mode === 'write'))
  } finally { client.close() }
})

test('a write with a stale document witness rolls back and reruns its callback', async () => {
  const { store, client } = fixture()
  try {
    await store.transaction(tx => tx.set('profiles', 'alice', { version: 1 }))
    let runs = 0
    await store.transaction(async tx => {
      const before = await tx.get('profiles', 'alice')
      if (++runs === 1) await store.transaction(other => other.set('profiles', 'alice', { version: 2 }))
      tx.set('profiles', 'alice', { version: before.version + 1 })
    })
    assert.equal(runs, 2)
    assert.deepEqual(await store.transaction(tx => tx.get('profiles', 'alice')), { version: 3 })
  } finally { client.close() }
})

test('a failed transport after committing is never retried', async () => {
  const { store, client } = fixture()
  try {
    const batch = client.batch.bind(client)
    let writes = 0
    client.batch = async (statements, mode) => {
      const result = await batch(statements, mode)
      if (mode === 'write') { writes++; throw new TypeError('connection reset') }
      return result
    }
    await assert.rejects(store.transaction(tx => tx.set('profiles', 'alice', { name: 'Alice' })), { code: 'STORE_UNAVAILABLE' })
    assert.equal(writes, 1)
    assert.deepEqual(await store.transaction(tx => tx.get('profiles', 'alice')), { name: 'Alice' })
  } finally { client.close() }
})

test('metadata-only loads verify a save without fetching any compressed slot bytes', async () => {
  const { store, client, calls } = fixture()
  try {
    const service = createAccountService({ store, now: () => 1000 })
    const request = (action, options) => service.execute({ uid: 'alice' }, {
      action, ownerId: 'arena-turso-test-owner', ...options,
    })
    await request('sessionAcquire')
    const payload = { 'champions-box-v1': '[{"name":"피카츄😀"}]', 'champions-vp-v1': '50000' }
    await request('save', { revision: 'save-initial', saveSequence: 1, payload })
    const knownPayloadHash = await fingerprintAccountSlots(payload)
    calls.length = 0
    const options = { knownRevision: 'save-initial', knownPayloadHash, knownHashMode: 'slots-v1' }
    const saved = await request('load', options)
    assert.equal(saved.localPayloadVerified, true)
    assert.equal(saved.gameData.payload, undefined)
    assert.ok(!calls.flatMap(call => call.statements).some(query => /FROM document_slot_overflow/i.test(query.sql)))
    assert.deepEqual((await request('load', { ...options, knownPayloadHash: '0'.repeat(64) })).gameData.payload, payload)
  } finally { client.close() }
})

test('a profile update skips every save-slot query and unused document deletion', async () => {
  const { store, calls, client } = fixture()
  try {
    await store.transaction(tx => tx.set('profiles', 'alice', { nickname: 'Pikachu' }))
    const witness = calls.find(call => call.mode === 'read').statements[0]
    assert.match(witness.sql, /SELECT version,NULL AS payload/)
    const statements = calls.find(call => call.mode === 'write').statements
    assert.equal(statements.length, 3)
    assert.ok(statements.every(({ sql }) => !/document_slot|DELETE FROM/i.test(sql)))
    assert.deepEqual(await store.transaction(tx => tx.get('profiles', 'alice')), { nickname: 'Pikachu' })
  } finally { client.close() }
})

test('a settings-only patch does not fetch overflow data or run slot deletes', async () => {
  const { store, calls, client } = fixture()
  try {
    await store.transaction(tx => tx.set('gameData', 'alice', { revision: 'first', payload: { box: 'Large box', settings: '{}' } }))
    calls.length = 0
    await store.transaction(async tx => {
      await tx.readGameDataPatch('alice', { settings: '{"sound":false}' }, [])
      await tx.writeGameDataPatch('alice', { settings: '{"sound":false}' }, [], { revision: 'second' }, 'first')
    })
    const sql = calls.flatMap(call => call.statements.map(query => query.sql))
    assert.ok(!sql.some(query => /SELECT slot,part,data|DELETE FROM document_slots|DELETE FROM documents WHERE/i.test(query)))
    assert.deepEqual((await store.transaction(tx => tx.get('gameData', 'alice'))).payload, { box: 'Large box', settings: '{"sound":false}' })
  } finally { client.close() }
})

test('a large battle timeline, match update and old chunk deletion commit together', async () => {
  const { store, client } = fixture()
  try {
    const large = 'x'.repeat(680_000)
    await store.transaction(tx => tx.set('timelines', 'old-turn', { frames: ['previous'] }))
    await store.transaction(tx => {
      tx.delete('timelines', 'old-turn')
      for (let i = 0; i < 5; i++) tx.set('timelines', 'turn-' + i, { frames: [large] })
      tx.set('matches', 'match', { timelineChunks: 5, state: { turn: 9 } })
      tx.set('players', 'alice', { score: 100 })
    })
    assert.equal(await store.transaction(tx => tx.get('timelines', 'old-turn')), null)
    assert.equal((await store.transaction(tx => tx.get('timelines', 'turn-4'))).frames[0].length, large.length)
    assert.equal((await store.transaction(tx => tx.get('matches', 'match'))).state.turn, 9)
  } finally { client.close() }
})

test('recompressing an overflow slot keeps head and tail from the same encoding', async () => {
  const { db, client, store } = fixture()
  try {
    const api = createD1DocumentApi(db)
    const box = randomBytes(700_000).toString('base64')
    const raw = Buffer.from(JSON.stringify(box))
    const makeSlot = level => ({
      slot: 'box', bytes: raw.length, hash: hashValue(box), data: gzipSync(raw, { level }).toString('base64'),
    })
    const first = makeSlot(1), second = makeSlot(9)
    assert.ok(first.data.length > 600_000 && second.data.length > 600_000)
    assert.notEqual(first.data.slice(600_000), second.data.slice(600_000))
    for (const [id, slot] of [['first', first], ['second', second]]) {
      await api({ action: 'commit', namespace: 'account', id, reads: [],
        writes: [{ collection: 'gameData', key: 'alice', value: { revision: id }, slots: [slot] }] })
    }
    assert.equal((await store.transaction(tx => tx.get('gameData', 'alice'))).payload.box, box)
  } finally { client.close() }
})

test('repeated metadata and full reads of the same missing save do not conflict', async () => {
  const { store, client } = fixture()
  try {
    assert.equal(await store.transaction(async tx => {
      assert.equal(await tx.compareGameData('absent', {}), null)
      return tx.get('gameData', 'absent')
    }), null)
  } finally { client.close() }
})

test('libSQL batches keep the retention grace period and only remove the exact old replay', async () => {
  const client = createClient({ url: 'file::memory:' })
  const namespace = 'ranked_test'
  const now = 100_000_000
  try {
    await client.executeMultiple(schema)
    await client.execute(finishedMatchIndex)
    const store = createTursoStore({ client, namespace })
    const match = (id, finishedAt, phase = 'finished') => ({ id, finishedAt, phase, revision: 5, timelineRevision: 7,
      result: { winner: 1, rating: 15 }, players: [{ uid: 'alice', team: [{ species: 'Pikachu' }] }, { uid: 'bob', team: [] }],
      state: { private: true }, timelineChunks: 1, requests: [{ id: 'already-ran' }] })
    await store.transaction(tx => {
      tx.set('matches', 'old_match', match('old_match', 10_000))
      tx.set('matches', 'recent', match('recent', now - 100))
      tx.set('matches', 'ongoing', match('ongoing', 10_000, 'battle'))
      tx.set('timelines', 'old_match_7_0', { events: ['expired'] })
      tx.set('timelines', 'old_match_extra_7_0', { events: ['other match'] })
      tx.set('timelines', 'old_match_7_0_2', { events: ['invalid suffix'] })
      tx.set('timelines', 'recent_7_0', { events: ['still replayable'] })
      tx.set('players', 'alice', { rewards: 30 })
    })
    assert.equal(await pruneTursoCompletedBattles(client, namespace, now), 1)
    assert.equal(await pruneTursoCompletedBattles(client, namespace, now + 10), 0)
    await store.transaction(async tx => {
      const old = await tx.get('matches', 'old_match')
      assert.deepEqual(old.result, { winner: 1, rating: 15 })
      assert.equal(old.state, null)
      assert.equal(old.payloadPrunedAt, now)
      assert.equal(old.timelineChunks, 0)
      assert.deepEqual(old.players.map(player => player.team), [[], []])
      assert.equal(await tx.get('timelines', 'old_match_7_0'), null)
      for (const key of ['old_match_extra_7_0', 'old_match_7_0_2', 'recent_7_0']) assert.ok(await tx.get('timelines', key))
      for (const key of ['recent', 'ongoing']) assert.equal((await tx.get('matches', key)).timelineChunks, 1)
      assert.deepEqual(await tx.get('players', 'alice'), { rewards: 30 })
    })
  } finally { client.close() }
})

test('migration verifies the warm copy, changes, deletes, and unchanged slots on libSQL', async () => {
  const client = createClient({ url: 'file::memory:' })
  const directory = await mkdtemp(join(tmpdir(), 'arena-turso-test-'))
  async function snapshot(phase, rows) {
    const local = new DatabaseSync(join(directory, phase + '.sqlite'))
    try {
      local.exec(schema)
      for (const row of rows) importRecord(local, 'documents', row)
    } finally { local.close() }
    const documents = Object.fromEntries(rows.map(row => [JSON.stringify([row.namespace, row.collection, row.key]), documentDigest(row)]))
    await writeFile(join(directory, phase + '-receipt.json'), JSON.stringify({ documents, digest: hashValue(documents) }))
  }
  const save = { namespace: 'account', collection: 'gameData', key: 'alice',
    payload: { revision: 'one', payload: { box: randomBytes(650_000).toString('base64'), settings: '{}' } } }
  const removed = { namespace: 'account', collection: 'profiles', key: 'bob', payload: { nickname: 'Bob' } }
  const stable = { namespace: 'ranked', collection: 'matches', key: 'unchanged', payload: { state: 'ready', revision: 2 } }
  const newcomer = { namespace: 'account', collection: 'sessions', key: 'charlie', payload: { ownerId: 'new-owner' } }
  try {
    await snapshot('warm', [save, removed, stable])
    const warm = await applyTursoMigration(client, directory, 'warm')
    assert.equal(warm.manifests.documents.count, 3)
    assert.equal(warm.manifests.document_slot_overflow.count, 1)
    const edited = { ...save, payload: { revision: 'two', payload: { ...save.payload.payload, settings: '{"audio":false}' } } }
    await snapshot('final', [edited, stable, newcomer])
    const final = await applyTursoMigration(client, directory, 'final')
    assert.equal(final.manifests.documents.count, 3)
    assert.equal(final.manifests.documents.verifiedChangedDocuments, 3)
    assert.equal(final.manifests.collection_versions.count, 3)
    const account = createTursoStore({ client, namespace: 'account' })
    const ranked = createTursoStore({ client, namespace: 'ranked' })
    assert.deepEqual(await account.transaction(tx => tx.get('gameData', 'alice')), edited.payload)
    assert.equal(await account.transaction(tx => tx.get('profiles', 'bob')), null)
    assert.deepEqual(await account.transaction(tx => tx.get('sessions', 'charlie')), newcomer.payload)
    assert.deepEqual(await ranked.transaction(tx => tx.get('matches', 'unchanged')), stable.payload)
  } finally {
    client.close()
    await rm(directory, { recursive: true, force: true })
  }
})
