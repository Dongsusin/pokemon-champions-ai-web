import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { convertBackup } from './migrateFirestoreToPostgres.mjs'

const snapshot = value => ({ __firestoreTimestamp: value })
const document = (path, data) => ({ path, data })
const ranked = (collection, key, payload) => document(`ranked_${collection}/${key}`, { schemaVersion: 1, payload: JSON.stringify(payload) })
const fixture = () => {
  const corePayload = {
    'champions-vp-v1': '54321',
    'champions-teams-v1': JSON.stringify({ activeTeamId: 'team-3', teams: [{ id: 'team-3', pokemonIds: ['capture-25', 'capture-6'] }] }),
    'champions-battle-items-v1': JSON.stringify({ inventory: { 'leftovers': 2, 'life-orb': 1 } }),
    'champions-achievements-v1': JSON.stringify({ unlocked: ['first-win'], claimed: ['first-win'], counters: { rankedWins: 4 } }),
    'champions-settings-v1': JSON.stringify({ audio: { enabled: true, music: 40 } }),
  }
  const collectionPayload = {
    'champions-box-v1': JSON.stringify([{ captureId: 'capture-25', speciesId: 25, isShiny: true, heldItemId: 'leftovers', moves: ['10만볼트', '볼트체인지'] }, { captureId: 'capture-6', speciesId: 6 }]),
    'champions-dex-v2': JSON.stringify({ owned: [25, 6], seen: [25, 6, 9] }),
  }
  return { schemaVersion: 1, prefix: 'ranked', sourceProject: 'fixture-source', documents: [
    document('players/fixture-account', { uid: 'fixture-account', email: 'fixture@example.invalid', displayName: 'Fixture', photoURL: null,
      providerIds: ['google.com'], createdAt: snapshot(1000), lastSeenAt: snapshot(2000) }),
    document('players/fixture-account/gameData/progress', { schemaVersion: 1, revision: 'same-revision', updatedAt: snapshot(3000), payload: corePayload }),
    document('players/fixture-account/gameData/collection', { schemaVersion: 1, revision: 'same-revision', updatedAt: snapshot(4000), payload: collectionPayload }),
    ranked('players', 'fixture-account', { uid: 'fixture-account', profiles: { single: { points: 140, wins: 4, losses: 1, rating: 1011 } }, vpRewardTotal: 2400 }),
    ranked('matches', 'fixture-match', { id: 'fixture-match', phase: 'finished', state: { turn: 13, winner: 'player', player: { team: [{ speciesId: 25, hp: 50 }] } } }),
    ranked('pokemonUsage', 'ai-single', { teamCount: 2, counts: { 25: 2 }, itemCounts: { 25: { leftovers: 1 } }, itemSamples: { 25: 2 } }),
    ranked('guestNames', '000001', { owner: 'fixture-owner-hash', createdAt: 100 }),
    ranked('guestProfiles', 'fixture-owner-hash', { uid: 'guest-fixture', displayName: 'guest-000001', version: 1, createdAt: 100 }),
    ranked('factoryRanking', 'top10', { entries: [{ id: 'best-1', floor: 9, wins: 8, party: [{ speciesId: 25, heldItemId: 'leftovers', moves: ['10만볼트'] }] }], updatedAt: 5000 }),
    document('accountSessions/fixture-account', { ownerId: 'expired-session', leaseExpiresAt: snapshot(99999) }),
  ] }
}
const find = (converted, collection, namespace = 'account') => converted.rows.find(row => row.namespace === namespace && row.collection === collection)
const tests = []
const test = (name, run) => tests.push({ name, run })

test('account UID, Pokémon, VP, teams, items and achievements retain every saved JSON byte', () => {
  const backup = fixture(), before = structuredClone(backup), converted = convertBackup(backup)
  const account = find(converted, 'gameData')
  assert.equal(account.key, 'fixture-account')
  assert.equal(account.payload.revision, 'same-revision')
  assert.equal(account.payload.schemaVersion, 1)
  assert.deepEqual(account.payload.payload, { ...backup.documents[1].data.payload, ...backup.documents[2].data.payload })
  assert.equal(Object.keys(account.payload.payload).length, 7)
  assert.deepEqual(backup, before)
})

test('profile fields and encoded timestamps convert without replacing Firebase UIDs', () => {
  const converted = convertBackup(fixture())
  assert.deepEqual(find(converted, 'profiles'), { namespace: 'account', collection: 'profiles', key: 'fixture-account', payload: {
    uid: 'fixture-account', email: 'fixture@example.invalid', displayName: 'Fixture', photoURL: null, providerIds: ['google.com'],
    isGuest: false, createdAtMs: 1000, lastSeenAtMs: 2000,
  } })
  assert.equal(find(converted, 'gameData').payload.updatedAtMs, 4000)
  const backup = fixture()
  backup.documents[0].data.createdAt = 0
  backup.documents[0].data.lastSeenAt = 1234
  backup.documents[0].data.isGuest = true
  assert.equal(find(convertBackup(backup), 'profiles').payload.createdAtMs, 0)
  assert.equal(find(convertBackup(backup), 'profiles').payload.lastSeenAtMs, 1234)
  assert.equal(find(convertBackup(backup), 'profiles').payload.isGuest, true)
})

test('ranked rating, final battle, usage/item statistics, guest reservations and factory snapshots remain exact', () => {
  const backup = fixture(), converted = convertBackup(backup)
  for (const source of backup.documents.filter(row => row.path.startsWith('ranked_'))) {
    const [collection, key] = source.path.replace('ranked_', '').split('/')
    const target = converted.rows.find(row => row.namespace === 'ranked' && row.collection === collection && row.key === key)
    assert.deepEqual(target.payload, JSON.parse(source.data.payload))
  }
  assert.equal(converted.accountCount, 1)
  assert.equal(converted.rows.length, 8)
  assert.equal(converted.counts['account/gameData'], 1)
  assert.equal(converted.counts['ranked/guestNames'], 1)
  assert(!converted.rows.some(row => row.collection === 'sessions' || row.collection === 'accountSessions'), 'Old session leases must never lock users out after cutover')
})

test('mismatched save revisions abort conversion before a partial account can be imported', () => {
  const backup = fixture()
  backup.documents[2].data.revision = 'different-revision'
  assert.throws(() => convertBackup(backup), /revisions differ/)
})

test('unknown source collections and malformed ranked JSON stop conversion', () => {
  for (const path of ['unrecognized/document', 'players/fixture-account/unrecognized/secret']) {
    const backup = fixture(); backup.documents.push(document(path, {}))
    assert.throws(() => convertBackup(backup), /Unexpected/)
  }
  const invalid = fixture(); invalid.documents[3].data.payload = '{'
  assert.throws(() => convertBackup(invalid))
  assert.throws(() => convertBackup({ schemaVersion: 0, documents: [] }), /format/)
})

test('converted rows have no mutable references into the archived backup', () => {
  const backup = fixture(), before = structuredClone(backup), converted = convertBackup(backup)
  find(converted, 'profiles').payload.providerIds.push('mutated-fixture-provider')
  find(converted, 'players', 'ranked').payload.profiles.single.points = 999999
  assert.deepEqual(backup, before)
})

test('duplicate source paths and incomplete or conflicting account snapshots are rejected', () => {
  const duplicate = fixture(); duplicate.documents.push(structuredClone(duplicate.documents[1]))
  assert.throws(() => convertBackup(duplicate), /Duplicate/i)
  const partial = fixture(); partial.documents.splice(2, 1)
  assert.throws(() => convertBackup(partial), /incomplete|partial|missing/i)
  const conflict = fixture(); conflict.documents[2].data.payload['champions-vp-v1'] = '0'
  assert.throws(() => convertBackup(conflict), /conflict|overlap/i)
})

test('the real initial backup converts without mutation or exposing user data', async () => {
  const file = new URL('./.cache/storage-migration/firestore-initial-20260913.json', import.meta.url)
  let serialized
  try { serialized = await readFile(file, 'utf8') } catch (error) { if (error.code === 'ENOENT') return; throw error }
  const checksum = (await readFile(new URL(`${file.href}.sha256`), 'utf8')).trim()
  assert.equal(createHash('sha256').update(serialized).digest('hex'), checksum)
  const backup = JSON.parse(serialized), before = createHash('sha256').update(JSON.stringify(backup)).digest('hex'), converted = convertBackup(backup, backup.prefix)
  assert.equal(createHash('sha256').update(JSON.stringify(backup)).digest('hex'), before)
  assert.equal(converted.accountCount, 71)
  assert.equal(converted.rows.filter(row => row.namespace === 'account' && row.collection === 'gameData').length, 71)
  assert.equal(converted.rows.filter(row => row.namespace === 'account' && row.collection === 'profiles').length, 71)
  const sourceSaves = new Map()
  for (const source of backup.documents) {
    const segments = source.path.split('/')
    if (segments[0] === 'players' && segments[2] === 'gameData') {
      sourceSaves.set(segments[1], { ...(sourceSaves.get(segments[1]) ?? {}), ...source.data.payload })
    }
  }
  for (const target of converted.rows.filter(row => row.namespace === 'account' && row.collection === 'gameData')) {
    // Print neither raw values nor UIDs if a check fails: compare digests only.
    assert.equal(createHash('sha256').update(JSON.stringify(Object.entries(target.payload.payload).sort())).digest('hex'),
      createHash('sha256').update(JSON.stringify(Object.entries(sourceSaves.get(target.key)).sort())).digest('hex'))
  }
})

let passed = 0
for (const { name, run } of tests) { await run(); passed++; console.log(`PASS ${name}`) }
console.log(`Storage migration validation passed: ${passed}/${passed}`)
