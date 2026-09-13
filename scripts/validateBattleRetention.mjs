import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createPostgresStore } from '../server/postgresStore.js'
import { createRankedService } from '../server/rankedService.js'
import { createAccountService } from '../server/accountService.js'
import * as engine from '../server/rankedBattle.js'
import { normalizePokemon } from '../src/data/trainingData.js'

const cacheRequire = createRequire(resolve('scripts/.cache/retention-test/package.json'))
let PGlite
try { ({ PGlite } = cacheRequire('@electric-sql/pglite')) } catch {
  throw new Error('Install the isolated PostgreSQL test runtime: npm install --prefix scripts/.cache/retention-test @electric-sql/pglite@0.5.8 --no-save --no-package-lock')
}
const db = new PGlite()
const pool = { async connect() { return { query: (query, parameters) => db.query(query, parameters), release() {} } } }
const store = createPostgresStore({ pool, namespace: 'ranked' })
let checked = 0
const check = (name, run) => Promise.resolve().then(run).then(() => { checked += 1; console.log(`PASS ${name}`) })
const put = (namespace, collection, key, payload) => db.query('insert into champions.documents(namespace,collection,key,payload) values($1,$2,$3,$4::jsonb)', [namespace, collection, key, JSON.stringify(payload)])
const read = async (namespace, collection, key) => (await db.query('select payload from champions.documents where namespace=$1 and collection=$2 and key=$3', [namespace, collection, key])).rows[0]?.payload
const rows = async () => (await db.query('select namespace,collection,key,payload from champions.documents order by namespace,collection,key')).rows
const prune = async (namespace = 'ranked') => (await db.query('select champions.prune_completed_battles($1) as count', [namespace])).rows[0].count

try {
  await db.exec('create role anon; create role authenticated;')
  await db.exec(await readFile('supabase/migrations/202609130001_champions_documents.sql', 'utf8'))
  const retentionSQL = await readFile('supabase/migrations/202609130002_completed_battle_retention.sql', 'utf8')
  await db.exec(retentionSQL)
  // Reapplying a migration only redefines the function; it must not prune data.
  assert(!/\bcron\s*\.\s*schedule\s*\(/i.test(retentionSQL))
  const time = Number((await db.query('select floor(extract(epoch from statement_timestamp())*1000)::bigint as now')).rows[0].now)
  await check('real PostgreSQL JSONB key ordering and delayed save retries cannot regress account data', async () => {
    const accountStore = createPostgresStore({ pool, namespace: 'accountValidation' })
    try {
      const accountService = createAccountService({ store: accountStore, now: () => time })
      const identity = { uid: 'postgres-save-test', name: 'Tester' }
      const command = fields => accountService.execute(identity, { ownerId: 'owner-postgres-validation', ...fields })
      await command({ action: 'sessionAcquire' })
      const first = { action: 'save', revision: 'pg-save-revision-a', saveSequence: 1, payload: { 'champions-settings-v1': '{"music":true}', 'champions-vp-v1': '100' } }
      await command(first)
      await command({ ...first, payload: Object.fromEntries(Object.entries(first.payload).reverse()) })
      const second = { ...first, revision: 'pg-save-revision-b', saveSequence: 2, payload: { 'champions-vp-v1': '200' } }
      await command(second)
      await assert.rejects(command(first), error => error.code === 'STALE_SAVE')
      await command(second)
      assert.deepEqual((await command({ action: 'load' })).gameData.payload, second.payload)
    } finally { await accountStore.close() }
  })
  const identities = [{ uid: 'retention-alice', name: 'Alice' }, { uid: 'retention-bob', name: 'Bob' }]
  let id = 0
  const service = createRankedService({ store, engine, now: () => time - 2 * 86_400_000, newId: () => `old_match_under_score_${++id}`, makeSeed: () => 42, usageEnabled: true })
  const call = (identity, action, extra = {}) => service.execute(identity, { action, requestId: `retention-command-${++id}`, ...extra })
  const team = index => [3, 6, 9, 25, 94, 149].map((speciesId, slot) => normalizePokemon({ speciesId, captureId: `retention-${index}-${slot}` }))
  await call(identities[0], 'join', { format: 'single', team: team(0) })
  const match = (await call(identities[1], 'join', { format: 'single', team: team(1) })).match
  await call(identities[0], 'select', { matchId: match.id, revision: match.revision, selection: [0, 1, 2] })
  await call(identities[1], 'select', { matchId: match.id, revision: match.revision, selection: [0, 1, 2] })
  await call(identities[1], 'forfeit', { matchId: match.id })
  const original = await read('ranked', 'matches', match.id)
  assert(original.state && original.phase === 'finished')
  await db.query("update champions.documents set payload=jsonb_set(payload,'{timelineChunks}','2'::jsonb) where namespace='ranked' and collection='matches' and key=$1", [match.id])
  const timelineKeys = [`${match.id}_${original.timelineRevision}_0`, `${match.id}_${original.timelineRevision}_1`, `${match.id}_999_0`]
  for (const key of timelineKeys) await put('ranked', 'timelines', key, { frames: [{ state: original.state }] })
  const similarKeys = [`${match.id}_sibling_1_0`, `${match.id.replaceAll('_', 'X')}_1_0`, `${match.id}_1_0_extra`, `${match.id}_200_3_0`]
  for (const key of similarKeys) await put('ranked', 'timelines', key, { keep: true })
  const shifted = (key, fields) => ({ ...structuredClone(original), id: key, ...fields })
  await put('ranked', 'matches', 'recent_match', shifted('recent_match', { finishedAt: time - 3600_000 }))
  await put('ranked', 'matches', 'boundary_match', shifted('boundary_match', { finishedAt: time }))
  await put('ranked', 'matches', 'active_match', shifted('active_match', { phase: 'battle' }))
  await put('ranked', 'matches', 'bad_timestamp', shifted('bad_timestamp', { finishedAt: '0' }))
  await put('ranked', 'matches', 'bad_players', shifted('bad_players', { players: {} }))
  await put('ranked', 'matches', 'mismatched_key', shifted('other-key', {}))
  await put('otherNamespace', 'matches', match.id, original)
  await put('otherNamespace', 'timelines', timelineKeys[0], { frames: [{ state: original.state }] })
  await put('account', 'gameData', identities[0].uid, { revision: 'preserved-save', payload: { 'champions-vp-v1': '50000' } })
  await put('ranked', 'factoryRanking', 'top10', { entries: [{ floor: 50, party: team(0) }] })
  await put('ranked', 'factoryPersonalBest', 'owner-receipt', { floor: 50, party: team(0) })
  await put('ranked', 'guestProfiles', 'owner-profile', { displayName: 'guest-123456' })
  const before = await rows()
  const originalSize = Buffer.byteLength(JSON.stringify(original))

  await check('actual SQL only prunes battles strictly older than twenty-four hours and preserves active/recent/malformed rows', async () => {
    const result = await db.query(`with boundary as (
      update champions.documents set payload=jsonb_set(payload,'{finishedAt}',to_jsonb(floor(extract(epoch from statement_timestamp())*1000)::bigint-86400000))
      where namespace='ranked' and collection='matches' and key='boundary_match' returning key
    ) select champions.prune_completed_battles('ranked') as count from boundary`)
    assert.equal(result.rows[0].count, 1)
    assert.equal((await read('ranked', 'matches', 'boundary_match')).payloadPrunedAt, undefined)
    for (const key of ['recent_match', 'active_match', 'bad_timestamp', 'bad_players', 'mismatched_key']) {
      assert.deepEqual(await read('ranked', 'matches', key), before.find(row => row.namespace === 'ranked' && row.collection === 'matches' && row.key === key).payload)
    }
  })
  await check('tombstones preserve results and clear large state/team/action payloads', async () => {
    const compact = await read('ranked', 'matches', match.id)
    assert.deepEqual(compact.result, original.result)
    for (const key of ['id', 'format', 'phase', 'revision', 'timelineRevision', 'createdAt', 'finishedAt', 'winner', 'reason', 'usageRecordedAt']) assert.deepEqual(compact[key], original[key])
    assert.equal(compact.state, null)
    assert.equal(compact.timelineChunks, 0)
    assert.deepEqual(compact.players.map(player => player.team), [[], []])
    assert.deepEqual(compact.players.map(player => player.uid), original.players.map(player => player.uid))
    assert.deepEqual(compact.requests, [])
    assert.deepEqual(compact.pendingActions, {})
    assert.deepEqual(compact.selections, {})
    assert(Number.isSafeInteger(compact.payloadPrunedAt))
    assert(Buffer.byteLength(JSON.stringify(compact)) < originalSize / 10)
  })
  await check('timeline cleanup uses the literal match ID and exact revision/chunk suffix across namespaces', async () => {
    for (const key of timelineKeys) assert.equal(await read('ranked', 'timelines', key), undefined)
    for (const key of similarKeys) assert.deepEqual(await read('ranked', 'timelines', key), { keep: true })
    assert.deepEqual(await read('otherNamespace', 'matches', match.id), original)
    assert(await read('otherNamespace', 'timelines', timelineKeys[0]))
  })
  await check('account saves, ratings/history/VP totals, usage, guest names and factory rankings are unchanged', async () => {
    for (const row of before.filter(row => !['matches', 'timelines'].includes(row.collection))) {
      assert.deepEqual(await read(row.namespace, row.collection, row.key), row.payload)
    }
  })
  await check('real ranked service accepts late status/commands without replaying battles or paying VP twice', async () => {
    const profiles = await Promise.all(identities.map(identity => read('ranked', 'players', identity.uid)))
    for (const [index, identity] of identities.entries()) {
      assert.equal((await call(identity, 'status')).match, null)
      const shown = await call(identity, 'status', { matchId: match.id })
      assert.equal(shown.match.state, null)
      assert.deepEqual(shown.match.timeline, [])
      assert.deepEqual(shown.match.teamPreview, { you: [], opponent: [] })
      assert.deepEqual(shown.match.result, original.result[index])
      for (const action of ['submit', 'forfeit', 'select', 'replace']) {
        const retried = await call(identity, action, { matchId: match.id })
        assert.deepEqual(retried.match.result, original.result[index])
      }
      assert.deepEqual(await read('ranked', 'players', identity.uid), profiles[index])
    }
    await assert.rejects(call({ uid: 'unrelated-viewer', name: 'Third' }, 'status', { matchId: match.id }), error => error.code === 'MATCH_FORBIDDEN')
  })
  await check('repeated cleanup is idempotent, validates namespace and is unavailable to browser roles', async () => {
    // Move the boundary fixture back inside its grace period after testing the exact boundary.
    await db.query("update champions.documents set payload=jsonb_set(payload,'{finishedAt}',to_jsonb($1::bigint)) where namespace='ranked' and collection='matches' and key='boundary_match'", [time])
    const beforeRepeat = await rows()
    assert.equal(await prune(), 0)
    assert.deepEqual(await rows(), beforeRepeat)
    await assert.rejects(prune("ranked';delete all"), error => error.code === '22023')
    const permissions = await db.query("select has_function_privilege('anon','champions.prune_completed_battles(text)','execute') as anon, has_function_privilege('authenticated','champions.prune_completed_battles(text)','execute') as authenticated, has_function_privilege('champions_server','champions.prune_completed_battles(text)','execute') as server")
    assert.deepEqual(permissions.rows[0], { anon: false, authenticated: false, server: true })
  })
  await check('each call is bounded to one hundred finished matches', async () => {
    // Corrupt rows sort first but must not consume the valid-row batch limit.
    for (let index = 0; index < 100; index += 1) {
      const key = `aaa_malformed_${String(index).padStart(3, '0')}`
      await put('batchRanked', 'matches', key, shifted(key, { players: {} }))
    }
    for (let index = 0; index < 101; index += 1) {
      const key = `batch_finished_${String(index).padStart(3, '0')}`
      await put('batchRanked', 'matches', key, shifted(key, { state: { small: true } }))
    }
    assert.equal(await prune('batchRanked'), 100)
    assert.equal(await prune('batchRanked'), 1)
    assert.equal(await prune('batchRanked'), 0)
  })
  console.log(`Battle retention validation passed: ${checked}/${checked}`)
} finally {
  await store.close()
  await db.close()
}
