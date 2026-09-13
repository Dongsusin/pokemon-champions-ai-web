import assert from 'node:assert/strict'
import { mkdtemp, unlink, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGuestIdentityRegistry, GUEST_NAME_ATTEMPTS, rankedIdentityFromVerifiedToken } from '../server/guestIdentity.js'
import { createMemoryRankedStore, createFileRankedStore, createFirestoreRankedStore } from '../server/rankedStore.js'
import { createRankedService } from '../server/rankedService.js'
import { createRankedHttpHandler, createFirebaseRankedTeamResolver } from '../server/rankedHttp.js'
import * as engine from '../server/rankedBattle.js'
import { normalizePokemon } from '../src/data/trainingData.js'
import { maskRankedMatch } from '../src/data/rankedPrivacy.js'
import { createFactoryRun, selectFactoryRentals, selectFactoryLead, beginFactoryBattle, resolveFactoryBattle } from '../src/data/battleFactory.js'
import { createFactoryRankingSubmission } from '../src/data/battleFactoryRanking.js'

const tests = []
const test = (name, run) => tests.push({ name, run })
const guest = (uid, extra = {}) => rankedIdentityFromVerifiedToken({ uid, name: 'forged-google-name', firebase: { sign_in_provider: 'anonymous' }, ...extra })
const google = (uid, name = '실명 트레이너') => rankedIdentityFromVerifiedToken({ uid, name, firebase: { sign_in_provider: 'google.com' } })
const expectCode = (promise, code) => assert.rejects(promise, error => error.code === code)
const ownedTeam = prefix => [3, 6, 9, 25, 94, 149].map((speciesId, index) => normalizePokemon({ speciesId, captureId: `${prefix}-${index}` }))
function environment({ store = createMemoryRankedStore(), chooseNumber = () => 123456, resolveTeam } = {}) {
  let id = 0
  const registry = createGuestIdentityRegistry({ store, chooseNumber, now: () => 1000 })
  const service = createRankedService({ store, engine, usageEnabled: true, resolveTeam, guestRegistry: registry, now: () => 1000, newId: () => `guest-match-${++id}`, makeSeed: () => 42 })
  return { store, registry, service, call: (identity, action, payload = {}) => service.execute(identity, { action, requestId: `guest-request-${++id}`, ...payload }) }
}

test('only the verified anonymous provider enables a guest identity', () => {
  assert.deepEqual(guest('verified-uid'), { uid: 'verified-uid', name: '', isGuest: true })
  for (const token of [
    { uid: 'google', name: 'guest-123456', isGuest: true, firebase: { sign_in_provider: 'google.com' } },
    { uid: 'missing-provider', name: 'guest-123456', isAnonymous: true, isGuest: true },
    { uid: 'nested-flag', firebase: { isGuest: true, sign_in_provider: 'custom' } },
  ]) assert.equal(rankedIdentityFromVerifiedToken(token).isGuest, false)
})

test('six-digit names include both numeric boundaries and remain stable for repeated concurrent calls', async () => {
  for (const number of [0, 999999]) {
    const env = environment({ chooseNumber: () => number })
    const identity = guest(`boundary-${number}`)
    const results = await Promise.all(Array.from({ length: 20 }, () => env.registry.create(identity)))
    assert.equal(new Set(results.map(profile => profile.displayName)).size, 1)
    assert.equal(results[0].displayName, `guest-${String(number).padStart(6, '0')}`)
    assert.deepEqual(await env.registry.read(identity), results[0])
    const before = await env.store.inspect()
    await env.registry.create(identity)
    assert.deepEqual(await env.store.inspect(), before)
    assert.equal(Object.keys(before.collections.guestProfiles).length, 1)
    assert.equal(Object.keys(before.collections.guestNames).length, 1)
    assert.deepEqual(Object.keys(results[0]).sort(), ['uid', 'displayName', 'isGuest'].sort())
  }
})

test('concurrent colliding accounts reserve unique names with bounded reads and no collection scans', async () => {
  const actual = createMemoryRankedStore()
  const costs = []
  const store = { transaction: work => actual.transaction(async tx => {
    const cost = { reads: 0, writes: 0 }
    costs.push(cost)
    return work({
      get: (...args) => { cost.reads += 1; return tx.get(...args) },
      set: (...args) => { cost.writes += 1; return tx.set(...args) },
      list: () => { throw new Error('Guest allocation cannot scan a collection') },
    })
  }) }
  let generated = 0
  const registry = createGuestIdentityRegistry({ store, now: () => 1000, chooseNumber: () => generated++ % GUEST_NAME_ATTEMPTS })
  const profiles = await Promise.all(Array.from({ length: GUEST_NAME_ATTEMPTS }, (_, index) => registry.create(guest(`collision-${index}`))))
  assert.equal(new Set(profiles.map(profile => profile.displayName)).size, GUEST_NAME_ATTEMPTS)
  assert(profiles.every(profile => /^guest-\d{6}$/.test(profile.displayName)))
  assert(costs.every(cost => cost.reads <= 1 + GUEST_NAME_ATTEMPTS && cost.writes === 2))
  const before = await actual.inspect()
  await expectCode(registry.create(guest('collision-overflow')), 'GUEST_NAMES_BUSY')
  assert.deepEqual(await actual.inspect(), before)
  // Removing a profile cannot make its old name available to a different UID.
  await actual.transaction(tx => { tx.delete('guestProfiles', Object.keys(before.collections.guestProfiles)[0]) })
  await expectCode(registry.create(guest('new-after-cleared-profile')), 'GUEST_NAMES_BUSY')
})

test('Firestore retries preserve generated candidates and commit both reservations together', async () => {
  const documents = new Map()
  let generated = 0, reads = 0, writes = 0, scans = 0
  const firestore = {
    collection: collection => ({ collection, doc: key => ({ collection, key }) }),
    async runTransaction(work) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const pending = []
        const value = await work({
          async get(ref) {
            if (!ref.key) { scans += 1; throw new Error('Collection scans forbidden') }
            reads += 1
            const data = documents.get(`${ref.collection}/${ref.key}`)
            return { exists: Boolean(data), data: () => data }
          },
          set(ref, data) { writes += 1; pending.push([`${ref.collection}/${ref.key}`, data]) },
        })
        if (attempt === 1) {
          for (const [key, data] of pending) documents.set(key, data)
          return value
        }
      }
    },
  }
  const registry = createGuestIdentityRegistry({ store: createFirestoreRankedStore(firestore, { prefix: 'guestTest' }), chooseNumber: () => generated++, now: () => 1000 })
  const profile = await registry.create(guest('firestore-retry'))
  assert.equal(profile.displayName, 'guest-000000')
  assert.equal(generated, GUEST_NAME_ATTEMPTS)
  assert.equal(reads, 4)
  assert.equal(writes, 4)
  assert.equal(documents.size, 2)
  assert.equal(scans, 0)
  assert.deepEqual(await registry.read(guest('firestore-retry')), profile)
})

test('private guest profiles persist across file-store restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'champions-guests-'))
  const filename = join(directory, 'state.json')
  let store
  try {
    store = await createFileRankedStore(filename)
    const registry = createGuestIdentityRegistry({ store, chooseNumber: () => 7 })
    const saved = await registry.create(guest('persistent-guest'))
    await store.close()
    store = await createFileRankedStore(filename)
    const reopened = createGuestIdentityRegistry({ store, chooseNumber: () => 999 })
    assert.deepEqual(await reopened.create(guest('persistent-guest')), saved)
  } finally {
    await store?.close()
    await unlink(filename).catch(error => { if (error.code !== 'ENOENT') throw error })
    await rmdir(directory)
  }
})

test('HTTP guest bootstrap is POST-only and rejects Google or client identity spoofing', async () => {
  const env = environment()
  const handler = createRankedHttpHandler({ service: env.service, enabled: true, authenticate: async (_request, token) => {
    if (token === 'anonymous-token') return guest('actual-guest')
    if (token === 'google-token') return google('actual-google', 'guest-123456')
    throw Object.assign(new Error('invalid'), { code: 'auth/invalid-id-token' })
  } })
  const request = (method, token, payload) => handler(new Request(`https://game.example/api/ranked${method === 'GET' ? `?action=${payload.action}` : ''}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(method === 'POST' ? { body: JSON.stringify(payload) } : {}),
  }))
  assert.equal((await request('GET', 'anonymous-token', { action: 'guestProfile' })).status, 405)
  assert.equal((await request('GET', 'anonymous-token', { action: 'factoryLeaderboard' })).status, 409)
  assert.equal((await request('POST', 'google-token', { action: 'guestProfile', isGuest: true, uid: 'actual-guest' })).status, 403)
  assert.equal((await request('POST', 'invalid-token', { action: 'guestProfile' })).status, 401)
  assert.deepEqual((await env.store.inspect()).collections, {})
  const created = await request('POST', 'anonymous-token', { action: 'guestProfile', uid: 'another-user', name: 'guest-999999', displayName: 'admin', isGuest: false })
  assert.equal(created.status, 200)
  assert.deepEqual(await created.json(), { uid: 'actual-guest', displayName: 'guest-123456', isGuest: true })
  const beforeRead = await env.store.inspect()
  assert.equal((await request('GET', 'anonymous-token', { action: 'factoryLeaderboard' })).status, 200)
  assert.equal((await request('GET', 'anonymous-token', { action: 'usage' })).status, 200)
  assert.deepEqual(await env.store.inspect(), beforeRead)
})

test('guest ranked registration retains server-owned team and item validation', async () => {
  const saved = ownedTeam('owned')
  const paths = []
  const resolver = createFirebaseRankedTeamResolver({ doc: path => ({ async get() {
    paths.push(path)
    if (path.endsWith('/collection')) return { data: () => ({ revision: 7, payload: { 'champions-dex-v2': JSON.stringify(saved) } }) }
    return { data: () => ({ revision: 7, payload: { 'champions-battle-items-v1': '{}' } }) }
  } }) })
  const env = environment({ resolveTeam: resolver })
  const identity = guest('owned-guest')
  await env.call(identity, 'guestProfile')
  await expectCode(env.call(identity, 'join', { format: 'single', team: ownedTeam('forged') }), 'POKEMON_NOT_OWNED')
  const forgedFields = saved.map(pokemon => ({ captureId: pokemon.captureId, speciesId: 99999, heldItemId: 'legend-plate', moves: ['impossible'] }))
  const joined = await env.call(identity, 'join', { format: 'single', team: forgedFields, name: 'admin', isGuest: false })
  assert(joined.queue)
  assert(paths.every(path => path.startsWith('players/owned-guest/gameData/')))
  const queue = (await env.store.inspect()).collections.queue['owned-guest']
  assert.equal(queue.name, 'guest-123456')
  assert.equal(queue.isGuest, true)
  assert.deepEqual(queue.team.map(pokemon => pokemon.speciesId), saved.map(pokemon => pokemon.speciesId))
  assert(queue.team.every(pokemon => pokemon.heldItemId === ''))
})

test('guest and Google users match, preserve distinct public names, complete battle and receive VP', async () => {
  for (const format of ['single', 'double']) {
    const env = environment()
    const first = guest(`guest-${format}`)
    // Matching format in a Google displayName does not grant guest visibility.
    const second = google(`google-${format}`, 'guest-654321')
    await env.call(first, 'guestProfile')
    await env.call(first, 'join', { format, team: ownedTeam('first') })
    const selected = (await env.call(second, 'join', { format, team: ownedTeam('second') })).match
    assert.equal(selected.opponent.name, 'guest-123456')
    assert.equal(selected.opponent.isGuest, true)
    assert.equal(selected.you.name, 'g**')
    assert.equal(selected.you.isGuest, false)
    const selection = format === 'single' ? [0, 1, 2] : [0, 1, 2, 3]
    await env.call(first, 'select', { matchId: selected.id, revision: selected.revision, selection })
    const running = (await env.call(second, 'select', { matchId: selected.id, revision: selected.revision, selection })).match
    assert.equal(running.state.player.name, 'g**')
    assert.equal(running.state.opponent.name, 'guest-123456')
    assert.equal(running.state.opponentMeta.name, 'guest-123456')
    assert(running.state.log.some(entry => entry.message.includes('guest-123456')))
    assert(!JSON.stringify(running).includes('guest-654321'))
    assert.deepEqual(maskRankedMatch(running), running, 'Repeated masking must preserve guest identifiers')
    const stored = (await env.store.inspect()).collections.matches[selected.id]
    const messages = engine.getRankedTimelineView([{ phase: 'switch-out', sideId: 'player', message: 'guest-123456은(는) 이상해꽃을(를) 불러들였다!', state: stored.state }], 'opponent')
    assert.equal(messages[0].message, 'guest-123456은(는) 이상해꽃을(를) 불러들였다!')
    assert.equal(messages[0].state.opponent.isGuest, true)
    const result = await env.call(second, 'forfeit', { matchId: selected.id })
    assert.equal(result.match.result.outcome, 'loss')
    const winner = await env.call(first, 'status', { matchId: selected.id })
    assert.equal(winner.match.result.outcome, 'win')
    assert.equal(winner.vpRewards.total, 600)
    assert.equal(winner.vpRewards.uid, first.uid)
    assert.equal((await env.call(first, 'status')).match, null)
    const usage = await env.call(first, 'usage')
    assert.equal(usage.buckets[`ranked-${format}`].teamCount, 2)
  }
})

test('guest AI telemetry is counted once and factory rankings show the canonical guest name', async () => {
  const env = environment()
  const identity = guest('factory-ai-guest')
  await env.call(identity, 'guestProfile')
  const telemetry = { format: 'single', battleId: 'guest-ai-battle-1', speciesIds: [3, 6, 9], team: [3, 6, 9].map(speciesId => ({ speciesId, heldItemId: null })) }
  assert.equal((await env.call(identity, 'reportAiUsage', telemetry)).accepted, true)
  assert.equal((await env.call(identity, 'reportAiUsage', telemetry)).accepted, false)
  let run = createFactoryRun({ id: 'guest-factory-run', seed: 42 })
  run = selectFactoryRentals(run, run.offers.slice(0, 3).map(pokemon => pokemon.captureId))
  run = beginFactoryBattle(selectFactoryLead(run, run.party[0].captureId))
  run = resolveFactoryBattle(run, { battleId: run.battleId, winner: 'opponent' })
  const result = await env.call(identity, 'reportFactoryRun', { report: createFactoryRankingSubmission(run), trainerName: 'admin', isGuest: false })
  assert.equal(result.ownBest.trainerName, 'guest-123456')
  assert.equal(result.ownBest.isGuest, true)
  assert.equal(result.entries[0].trainerName, 'guest-123456')
  assert(!JSON.stringify(result).includes(identity.uid))
})

for (const { name, run } of tests) {
  await run()
  console.log(`PASS ${name}`)
}
console.log(`Guest identity validation passed: ${tests.length}/${tests.length}`)
