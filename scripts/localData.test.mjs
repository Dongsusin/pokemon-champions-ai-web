import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createLocalGameStore } from '../src/local/gameStorage.js'
import { createSave, MAX_SAVE_BYTES, parseBackup, PROFILE_KEY, validateSave, validateSaveValues } from '../src/local/saveSchema.js'
import { createLocalUsageStore, rankedUsageReport } from '../src/local/localUsage.js'
import { requestLauncherOnline } from '../src/local/launcherBridge.js'
import { createRankedClient } from '../src/rankedClient.js'
import { createGlobalChatClient } from '../src/globalChatClient.js'

class MemoryStorage {
  entries = new Map()
  getItem(key) { return this.entries.get(key) ?? null }
  setItem(key, value) { this.entries.set(key, String(value)) }
  removeItem(key) { this.entries.delete(key) }
}
const values = () => ({
  [PROFILE_KEY]: JSON.stringify({ uid: 'local-guest-fixture', displayName: '테스트 트레이너', nickname: '테스트', title: '' }),
  'champions-dex-v2': JSON.stringify([{ speciesId: 25, captureId: 'test-25' }]),
  'champions-teams-v1': JSON.stringify({ version: 1, activeTeamId: 'team-1', teams: [{ id: 'team-1', pokemonIds: ['test-25'] }] }),
  'champions-vp-v1': '75000', 'champions-battle-items-v1': '{"leftovers":1}',
  'champions-settings-v1': '{"audio":{"enabled":false}}', 'champions-achievements-v1': '{}',
})
function backend(initial = null) {
  let current = initial
  return { kind: 'test', location: 'test', backup: null, fail: false, writes: 0,
    read: async () => current,
    async write(save, revision) {
      if (this.fail) throw new Error('Disk is full')
      if ((current?.revision ?? 0) !== revision) throw new Error('Revision conflict')
      this.backup = current
      current = createSave(save.values, revision + 1)
      this.writes++
      return current
    },
  }
}
test('all progress and local guest identity round-trip without credentials', () => {
  const save = createSave(values())
  assert.deepEqual(parseBackup(JSON.stringify(save)), save)
  assert.deepEqual(validateSave(save).values, values())
  for (const key of ['firebase:authUser:private', 'champions-cloud-sync-v1', 'champions-google-migration-v1']) {
    assert.throws(() => validateSaveValues({ [key]: 'secret' }))
  }
})
test('unsupported versions, corrupt JSON, wrong types and invalid VP never import', () => {
  assert.throws(() => parseBackup('not-json'))
  assert.throws(() => parseBackup(JSON.stringify({ ...createSave(values()), version: 2 })))
  assert.throws(() => createSave({ 'champions-dex-v2': '{}' }))
  assert.throws(() => createSave({ 'champions-vp-v1': '-1' }))
  assert.throws(() => createSave({ 'champions-vp-v1': '9007199254740992' }))
  assert.throws(() => createSave({ 'champions-dex-v2': '[null]' }))
  assert.throws(() => createSave({ 'champions-teams-v1': '{"teams":[{"id":"team-1","pokemonIds":{}}]}' }))
  assert.throws(() => createSave({ 'champions-achievements-v1': '{"walletBalance":-1}' }))
  assert.throws(() => createSave({ 'champions-battle-items-v1': '{"leftovers":-1}' }))
})

test('size validation includes the envelope so an accepted file can be read again', () => {
  const payload = { 'champions-settings-v1': JSON.stringify({ note: '' }) }
  const emptyBytes = new TextEncoder().encode(JSON.stringify(payload)).length
  payload['champions-settings-v1'] = JSON.stringify({ note: 'x'.repeat(MAX_SAVE_BYTES - emptyBytes) })
  assert.equal(new TextEncoder().encode(JSON.stringify(validateSaveValues(payload))).length, MAX_SAVE_BYTES)
  assert.throws(() => createSave(payload), /최대 크기/)
})
test('one-time legacy payload import keeps only game progress', () => {
  const legacy = { payload: { ...values(), 'champions-cloud-sync-v1': '{"ownerUid":"old"}' } }
  assert.deepEqual(parseBackup(JSON.stringify(legacy)).values, values())
  assert.throws(() => parseBackup('{"accessToken":"private"}'))
})
test('first local start preserves migrated data and writes it only once', async () => {
  const disk = backend(), journal = new MemoryStorage()
  const store = createLocalGameStore({ backend: disk, journal })
  await store.initialize(values())
  assert.deepEqual(store.snapshot().values, values())
  assert.equal(disk.writes, 1)
  await store.flush()
  assert.equal(disk.writes, 1)
  store.close()
})
test('existing durable save remains authoritative over browser migration', async () => {
  const disk = backend(createSave({ ...values(), 'champions-vp-v1': '90000' }, 5))
  const store = createLocalGameStore({ backend: disk, journal: new MemoryStorage() })
  await store.initialize(values())
  assert.equal(store.getItem('champions-vp-v1'), '90000')
  assert.equal(disk.writes, 0)
  store.close()
})
test('renderer interruption recovers only a journal based on the durable revision', async () => {
  const disk = backend(createSave(values(), 4)), journal = new MemoryStorage()
  const before = createLocalGameStore({ backend: disk, journal, debounceMs: 10000 })
  await before.initialize()
  before.setItem('champions-vp-v1', '81000')
  before.close()
  const after = createLocalGameStore({ backend: disk, journal })
  await after.initialize()
  assert.equal(after.getItem('champions-vp-v1'), '81000')
  assert.equal(after.snapshot().revision, 5)
  after.close()
  journal.setItem('champions-local-journal-v1', JSON.stringify({ revision: 4, values: { ...values(), 'champions-vp-v1': '1' } }))
  const restarted = createLocalGameStore({ backend: disk, journal })
  await restarted.initialize()
  assert.equal(restarted.getItem('champions-vp-v1'), '81000')
  restarted.close()
})
test('disk failure keeps dirty changes, emits an error and can be retried', async () => {
  const disk = backend(createSave(values(), 1)), journal = new MemoryStorage(), states = []
  const store = createLocalGameStore({ backend: disk, journal, onStatus: status => states.push(status) })
  await store.initialize()
  disk.fail = true
  store.setItem('champions-vp-v1', '82000')
  await assert.rejects(store.flush(), /Disk is full/)
  assert.equal(store.status().dirty, true)
  assert.ok(states.some(state => state.error === 'Disk is full'))
  assert.equal(store.getItem('champions-vp-v1'), '82000')
  disk.fail = false
  await store.flush()
  assert.equal(store.status().dirty, false)
  assert.equal(store.status().error, '')
  assert.equal((await disk.read()).values['champions-vp-v1'], '82000')
  store.close()
})
test('journal quota failure does not change data and is visibly reported', async () => {
  const disk = backend(createSave(values(), 1)), journal = new MemoryStorage()
  const store = createLocalGameStore({ backend: disk, journal })
  await store.initialize()
  journal.setItem = () => { throw new Error('Quota exceeded') }
  assert.throws(() => store.setItem('champions-vp-v1', '1'), /Quota/)
  assert.equal(store.getItem('champions-vp-v1'), '75000')
  assert.ok(store.status().error)
  store.close()
})
test('changes arriving during an asynchronous save are committed in order', async () => {
  const disk = backend(createSave(values(), 1)), original = disk.write
  let release
  disk.write = async function (...args) { await new Promise(resolve => { release = resolve }); return original.apply(this, args) }
  const store = createLocalGameStore({ backend: disk, journal: new MemoryStorage(), debounceMs: 10000 })
  await store.initialize()
  store.setItem('champions-vp-v1', '80000')
  const flush = store.flush()
  store.setItem('champions-vp-v1', '81000')
  disk.write = original
  release()
  await flush
  assert.equal((await disk.read()).values['champions-vp-v1'], '81000')
  assert.equal(disk.writes, 2)
  store.close()
})
test('failed imports and invalid imports leave both displayed and saved data intact', async () => {
  const disk = backend(createSave(values(), 1)), journal = new MemoryStorage()
  const store = createLocalGameStore({ backend: disk, journal })
  await store.initialize()
  disk.fail = true
  await assert.rejects(store.replace(createSave({ ...values(), 'champions-vp-v1': '999' })))
  assert.equal(store.getItem('champions-vp-v1'), '75000')
  assert.equal((await disk.read()).values['champions-vp-v1'], '75000')
  disk.fail = false
  await store.replace(createSave({ ...values(), 'champions-vp-v1': '999' }))
  assert.equal(store.getItem('champions-vp-v1'), '999')
  assert.equal(disk.backup.values['champions-vp-v1'], '75000')
  store.close()
})
test('another writer cannot silently overwrite a newer revision', async () => {
  const disk = backend(createSave(values(), 1))
  const first = createLocalGameStore({ backend: disk, journal: new MemoryStorage() })
  const second = createLocalGameStore({ backend: disk, journal: new MemoryStorage() })
  await first.initialize(); await second.initialize()
  first.setItem('champions-vp-v1', '80000'); await first.flush()
  second.setItem('champions-vp-v1', '1')
  await assert.rejects(second.flush(), /Revision conflict/)
  assert.equal((await disk.read()).values['champions-vp-v1'], '80000')
  first.close(); second.close()
})
test('personal usage statistics persist and repeated battle callbacks do not double count', () => {
  const storage = new MemoryStorage(), first = createLocalUsageStore(storage)
  const report = { battleId: 'ai-personal-1', format: 'single', speciesIds: [25, 6, 9],
    team: [{ speciesId: 25, heldItemId: null }, { speciesId: 6, heldItemId: 'leftovers' }, { speciesId: 9, heldItemId: null }] }
  first.record(report); first.record(report)
  const restored = createLocalUsageStore(storage).read()
  assert.equal(restored.source, 'local')
  assert.equal(restored.buckets['ai-single'].teamCount, 1)
  assert.equal(restored.buckets['ai-single'].itemCounts[6].leftovers, 1)
  assert.throws(() => first.record({ ...report, battleId: 'bad', speciesIds: [25] }))
  assert.equal(first.read().buckets['ai-single'].teamCount, 1)
})
test('unconnected ranked and chat clients make no HTTP requests', async () => {
  let requests = 0
  const fetchImpl = async () => { requests++; throw new Error('Unexpected HTTP') }
  await assert.rejects(createRankedClient({ fetchImpl, userId: 'local-guest' }).request('status'), /런처/)
  await assert.rejects(createGlobalChatClient({ fetchImpl, userId: 'local-guest' }).request('latest'), /런처/)
  assert.equal(requests, 0)
})
test('personal service receives the guest operation without a Google token or save file', async () => {
  const calls = []
  globalThis.window = { location: { href: 'http://127.0.0.1/' }, championsLauncher: { version: 1,
    online: { channels: ['ranked'], request: async (...args) => { calls.push(args); return { profile: {} } } } } }
  try {
    const client = createRankedClient({ userId: 'local-guest-fixture', fetchImpl: () => { throw new Error('HTTP not allowed') } })
    await client.request('join', { format: 'single', team: [25, 6, 9] })
    assert.equal(calls[0][0], 'ranked')
    assert.equal(calls[0][1], 'join')
    assert.equal(calls[0][3].userId, 'local-guest-fixture')
    assert.ok(!JSON.stringify(calls).includes('Authorization'))
    assert.ok(!JSON.stringify(calls).includes('champions-dex'))
  } finally { delete globalThis.window }
})

test('a committed import survives optional journal cleanup failure', async () => {
  const disk = backend(createSave(values(), 1)), journal = new MemoryStorage()
  const store = createLocalGameStore({ backend: disk, journal })
  await store.initialize()
  journal.removeItem = () => { throw new Error('Blocked browser storage') }
  await store.replace(createSave({ ...values(), 'champions-vp-v1': '91000' }))
  assert.equal(store.getItem('champions-vp-v1'), '91000')
  assert.equal((await disk.read()).values['champions-vp-v1'], '91000')
  assert.equal(store.status().dirty, false)
  assert.equal(store.status().error, '')
  store.close()
})

test('ranked personal statistics use the completed selected team and deduplicate replay', () => {
  const store = createLocalUsageStore(new MemoryStorage())
  const team = [{ speciesId: 25, heldItemId: null }, { speciesId: 6, heldItemId: 'leftovers' }, { speciesId: 9, heldItemId: null }]
  const match = { id: 'ranked-personal-1', format: 'single', phase: 'finished', state: { player: { team } } }
  assert.equal(rankedUsageReport({ ...match, phase: 'select' }), null)
  assert.equal(rankedUsageReport({ ...match, state: null }), null)
  assert.equal(rankedUsageReport({ ...match, state: { player: { team: [...team, ...team] } } }), null)
  const report = rankedUsageReport(match)
  store.record(report, 'ranked'); store.record(report, 'ranked')
  assert.equal(store.read().buckets['ranked-single'].teamCount, 1)
  assert.equal(store.read().buckets['ranked-single'].itemCounts[6].leftovers, 1)
  assert.equal(store.read().buckets['ai-single'].teamCount, 0)
})

test('launcher cancellation and timeout finish even when personal transport ignores signals', async () => {
  globalThis.window = { championsLauncher: { online: { channels: ['ranked'], request: () => new Promise(() => {}) } } }
  try {
    const controller = new AbortController()
    const pending = requestLauncherOnline('ranked', 'status', {}, { signal: controller.signal })
    controller.abort()
    await assert.rejects(pending, { name: 'AbortError' })
    await assert.rejects(requestLauncherOnline('ranked', 'status', {}, { timeoutMs: 5 }), /지연/)
  } finally { delete globalThis.window }
})
