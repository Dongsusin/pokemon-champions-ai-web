import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createMemoryRankedStore } from '../server/rankedStore.js'
import { createGuestIdentityRegistry } from '../server/guestIdentity.js'
import { createAccountService } from '../server/accountService.js'
import { createAccountHttpHandler } from '../server/accountHttp.js'
import { createRankedService } from '../server/rankedService.js'
import * as engine from '../server/rankedBattle.js'
import { normalizePokemon } from '../src/data/trainingData.js'
import { createFactoryRun, selectFactoryRentals, selectFactoryLead, beginFactoryBattle, resolveFactoryBattle } from '../src/data/battleFactory.js'
import { createFactoryRankingSubmission } from '../src/data/battleFactoryRanking.js'

const tests = []
const test = (name, run) => tests.push({ name, run })
const guest = { uid: 'delete-me-guest', name: 'forged-name', isGuest: true }
const google = { uid: 'keep-me-google', name: '보존 계정', isGuest: false }
const ownerId = 'window-owner-1234567890123456'
const team = [3, 6, 9, 25, 94, 149].map(speciesId => normalizePokemon({ speciesId, captureId: `private-mon-${speciesId}`, moves: ['방어'] }))
const rejectCode = (promise, code) => assert.rejects(promise, error => error.code === code)
function environment(options = {}) {
  const accountStore = options.accountStore ?? createMemoryRankedStore()
  const rankedStore = options.rankedStore ?? createMemoryRankedStore()
  if (options.projectCleanup) {
    const transact = rankedStore.transaction.bind(rankedStore)
    rankedStore.transaction = work => transact(tx => work({ ...tx,
      listGuestMatches: async uid => (await tx.list('matches')).filter(match => match.players.some(player => player.uid === uid))
        .map(({ state, selections, pendingActions, requests, players, ...metadata }) => ({
          ...metadata, players: players.map(({ team, ...player }) => ({ ...player, team: [] })), hadBattleState: Boolean(state),
        })),
      listGuestRelatedPlayers: async uid => (await tx.list('players')).filter(player => player.roomResult?.standings?.some(row => row.uid === uid)),
      deleteGuestUsageEvents: async owner => { for (const event of await tx.list('pokemonUsageEvents')) if (event.owner === owner) tx.delete('pokemonUsageEvents', event.id) },
    }))
  }
  let serial = 0, names = 123456
  const registry = createGuestIdentityRegistry({ store: rankedStore, chooseNumber: () => names++, now: () => 1000 })
  const ranked = createRankedService({ store: rankedStore, guestRegistry: registry, engine, now: () => 1000,
    usageEnabled: true, newId: () => `delete-test-${++serial}`, makeSeed: () => options.seed ?? 42,
    ...(options.resolveTeam ? { resolveTeam: options.resolveTeam } : {}),
  })
  const account = createAccountService({ store: accountStore, guestRegistry: registry, now: () => 1000,
    newVersion: () => `delete-lease-${++serial}`,
    deleteGuestData: options.deleteGuestData ? identity => options.deleteGuestData(identity, ranked.deleteGuestAccount) : ranked.deleteGuestAccount,
  })
  const call = (identity, action, fields = {}) => account.execute(identity, { action, ownerId, ...fields })
  const rank = (identity, action, fields = {}) => ranked.execute(identity, { action, requestId: `delete-request-${++serial}`, ...fields })
  const bootstrap = async identity => {
    if (identity.isGuest) await registry.create(identity)
    const lease = await call(identity, 'sessionAcquire')
    await call(identity, 'ensureProfile')
    await call(identity, 'save', { revision: `save-version-${++serial}`, saveSequence: 1,
      payload: { 'champions-dex-v2': JSON.stringify(team), 'champions-battle-items-v1': '{}' } })
    return lease
  }
  return { accountStore, rankedStore, registry, ranked, account, call, rank, bootstrap,
    erase: lease => call(guest, 'deleteGuestAccount', { version: lease.version }),
  }
}
async function assertErased(env, identity = guest, name = 'guest-123456') {
  const account = await env.accountStore.inspect()
  const ranked = await env.rankedStore.inspect()
  for (const collection of ['gameData', 'profiles', 'sessions']) assert.equal(account.collections[collection]?.[identity.uid], undefined)
  assert.equal(ranked.collections.players?.[identity.uid], undefined)
  assert.equal(ranked.collections.queue?.[identity.uid], undefined)
  assert.equal(JSON.stringify(account).includes(identity.uid), false, 'No raw UID is retained in account deletion fences')
  assert.equal(JSON.stringify(ranked).includes(identity.uid), false, 'Shared results and rooms must not retain the deleted identity')
  assert.equal(JSON.stringify(ranked).includes(name), false, 'The guest nickname must be released and removed from results')
  for (const marker of Object.values(account.collections.guestDeletions ?? {})) assert.deepEqual(Object.keys(marker).sort(), ['deletedAt', 'status'])
  return { account, ranked }
}

test('authenticated guest logout deletes owned saves, queue, rankings and receipts while preserving other accounts and anonymous aggregates', async () => {
  const env = environment()
  const lease = await env.bootstrap(guest)
  await env.bootstrap(google)
  await env.rank(google, 'status')
  const googleBefore = (await env.accountStore.inspect()).collections.gameData[google.uid]
  const report = { format: 'single', battleId: 'guest-private-ai-battle', speciesIds: [3, 6, 9] }
  await env.rank(guest, 'reportAiUsage', report)
  await env.rank(google, 'reportAiUsage', { ...report, battleId: 'google-ai-battle' })
  let run = createFactoryRun({ id: 'private-factory-run', seed: 42 })
  run = selectFactoryRentals(run, run.offers.slice(0, 3).map(pokemon => pokemon.captureId))
  run = beginFactoryBattle(selectFactoryLead(run, run.party[0].captureId))
  run = resolveFactoryBattle(run, { battleId: run.battleId, winner: 'opponent' })
  await env.rank(guest, 'reportFactoryRun', { report: createFactoryRankingSubmission(run) })
  await env.rank(guest, 'join', { format: 'single', team })
  const aggregate = (await env.rankedStore.inspect()).collections.pokemonUsage
  assert.deepEqual(await env.erase(lease), { deleted: true, uid: guest.uid })
  const { account, ranked } = await assertErased(env)
  assert.deepEqual(account.collections.gameData[google.uid], googleBefore)
  assert(ranked.collections.players[google.uid])
  assert.deepEqual(ranked.collections.pokemonUsage, aggregate)
  assert.equal(Object.keys(ranked.collections.pokemonUsageEvents).length, 1)
  assert.equal(Object.keys(ranked.collections.factoryPersonalBest).length, 0)
  assert.deepEqual(ranked.collections.factoryRanking.top10.entries, [])
  assert.equal(ranked.collections.guestNames['123456'], undefined)
  const reuse = createGuestIdentityRegistry({ store: env.rankedStore, chooseNumber: () => 123456, now: () => 1001 })
  assert.equal((await reuse.create({ uid: 'new-guest-after-logout', isGuest: true })).displayName, 'guest-123456')
  assert.deepEqual(await env.erase(lease), { deleted: true, uid: guest.uid }, 'Lost response retries are idempotent')
})

test('Google identities, missing identity, stale leases and foreign windows cannot authorize deletion', async () => {
  const env = environment()
  const lease = await env.bootstrap(guest)
  await env.bootstrap(google)
  const before = await env.rankedStore.inspect()
  await rejectCode(env.call(google, 'deleteGuestAccount', { version: lease.version, uid: guest.uid, isGuest: true }), 'GUEST_ONLY')
  await rejectCode(env.call(null, 'deleteGuestAccount', { version: lease.version }), 'UNAUTHENTICATED')
  await rejectCode(env.call(guest, 'deleteGuestAccount', { version: lease.version, ownerId: 'different-window-owner-12345' }), 'account-session/lost')
  await rejectCode(env.call(guest, 'deleteGuestAccount', { version: 'wrong-version-12345' }), 'account-session/lost')
  assert.deepEqual(await env.rankedStore.inspect(), before)
  assert.equal((await env.accountStore.inspect()).collections.guestDeletions, undefined)
})

test('deleting a factory top-ten entrant promotes the next personal best while preserving the remaining rankings', async () => {
  const env = environment()
  const lease = await env.bootstrap(guest)
  let run = createFactoryRun({ id: 'top-ten-factory-run', seed: 42 })
  run = selectFactoryRentals(run, run.offers.slice(0, 3).map(pokemon => pokemon.captureId))
  run = beginFactoryBattle(selectFactoryLead(run, run.party[0].captureId))
  run = resolveFactoryBattle(run, { battleId: run.battleId, winner: 'opponent' })
  const report = createFactoryRankingSubmission(run)
  for (let index = 0; index < 12; index += 1) {
    const identity = index === 0 ? guest : { uid: `factory-survivor-${index}`, name: `선수${index}`, isGuest: false }
    await env.rank(identity, 'reportFactoryRun', { report: { ...report, runId: `factory-record-${index}`, floor: 20 - index, wins: 19 - index } })
  }
  await env.erase(lease)
  const { ranked } = await assertErased(env)
  assert.deepEqual(ranked.collections.factoryRanking.top10.entries.map(entry => entry.floor), [19, 18, 17, 16, 15, 14, 13, 12, 11, 10])
  assert.equal(Object.keys(ranked.collections.factoryPersonalBest).length, 11)
})

test('a failed cleanup fences stale writes and can resume without recreating an expired session', async () => {
  let failOnce = true
  const env = environment({ deleteGuestData: async (identity, cleanup) => {
    if (failOnce) { failOnce = false; throw new Error('Injected cleanup outage') }
    return cleanup(identity)
  } })
  const lease = await env.bootstrap(guest)
  await assert.rejects(env.erase(lease), /Injected cleanup outage/)
  for (const [action, fields] of [
    ['sessionAcquire', {}], ['sessionHeartbeat', { version: lease.version }],
    ['save', { revision: 'another-save-version', saveSequence: 2, payload: {} }], ['load', {}],
  ]) await rejectCode(env.call(guest, action, fields), 'GUEST_ACCOUNT_DELETED')
  assert((await env.accountStore.inspect()).collections.gameData[guest.uid], 'A failed cleanup must not claim all data was deleted')
  await env.erase(lease)
  await assertErased(env)
  for (const action of ['guestProfile', 'status', 'usage', 'factoryLeaderboard', 'rankedLeaderboard']) {
    await rejectCode(env.rank(guest, action), 'GUEST_ACCOUNT_DELETED')
  }
})

test('failure after ranked cleanup still resumes account deletion safely', async () => {
  let rejectFinalCommit = true
  const accountStore = createMemoryRankedStore(undefined, { persist: async database => {
    if (rejectFinalCommit && Object.values(database.collections.guestDeletions ?? {}).some(marker => marker.status === 'deleted')) {
      rejectFinalCommit = false
      throw new Error('Injected final commit outage')
    }
  } })
  const env = environment({ accountStore })
  const lease = await env.bootstrap(guest)
  await assert.rejects(env.erase(lease), /Injected final commit outage/)
  await rejectCode(env.rank(guest, 'guestProfile'), 'GUEST_ACCOUNT_DELETED')
  await env.erase(lease)
  await assertErased(env)
})

test('ranked cleanup rollback preserves its fence and cannot be bypassed by a stale token', async () => {
  let failOnce = true
  const rankedStore = createMemoryRankedStore(undefined, { persist: async database => {
    if (failOnce && Object.values(database.collections.guestProfiles ?? {}).some(profile => profile.deleted)) {
      failOnce = false
      throw new Error('Injected ranked cleanup rollback')
    }
  } })
  const env = environment({ rankedStore })
  const lease = await env.bootstrap(guest)
  await env.rank(guest, 'status')
  await assert.rejects(env.erase(lease), /Injected ranked cleanup rollback/)
  assert((await env.rankedStore.inspect()).collections.players[guest.uid])
  for (const action of ['guestProfile', 'status', 'usage']) await rejectCode(env.rank(guest, action), 'GUEST_ACCOUNT_DELETED')
  await env.erase(lease)
  await assertErased(env)
})

test('an already authenticated in-flight ranked join cannot recreate a deleted guest', async () => {
  let release, started
  const waiting = new Promise(resolve => { release = resolve })
  const entered = new Promise(resolve => { started = resolve })
  const env = environment({ resolveTeam: async (_identity, roster) => { started(); await waiting; return roster } })
  const lease = await env.bootstrap(guest)
  const pendingJoin = env.rank(guest, 'join', { format: 'single', team })
  await entered
  await env.erase(lease)
  release()
  await rejectCode(pendingJoin, 'GUEST_ACCOUNT_DELETED')
  await assertErased(env)
})

test('logout during a real ranked battle settles the opponent once and removes private teams, actions and timelines', async () => {
  const env = environment({ projectCleanup: true })
  const lease = await env.bootstrap(guest)
  await env.bootstrap(google)
  await env.rank(guest, 'join', { format: 'single', team })
  const joined = await env.rank(google, 'join', { format: 'single', team })
  const id = joined.match.id
  for (const identity of [guest, google]) {
    const current = (await env.rankedStore.inspect()).collections.matches[id]
    await env.rank(identity, 'select', { matchId: id, revision: current.revision, selection: [0, 1, 2] })
  }
  for (const identity of [guest, google]) {
    const current = (await env.rankedStore.inspect()).collections.matches[id]
    await env.rank(identity, 'submit', { matchId: id, revision: current.revision,
      actions: [{ type: 'move', moveIndex: 0, actorSlot: 0, targetSideId: 'player', targetSlot: 0 }] })
  }
  assert(Object.keys((await env.rankedStore.inspect()).collections.timelines).length > 0)
  await env.erase(lease)
  const { ranked } = await assertErased(env)
  const receipt = ranked.collections.matches[id]
  assert.equal(receipt.phase, 'finished')
  assert.equal(receipt.state, null)
  assert(receipt.players.every(player => player.team.length === 0))
  const erasedIndex = receipt.players.findIndex(player => player.uid !== google.uid)
  assert.equal(receipt.players[erasedIndex].rating, 0)
  assert.deepEqual(Object.keys(receipt.result[erasedIndex]).sort(), ['outcome', 'reason'])
  assert.deepEqual(receipt.pendingActions, {})
  assert.deepEqual(receipt.requests, [])
  assert.equal(Object.keys(ranked.collections.timelines).length, 0)
  const result = await env.rank(google, 'status', { matchId: id })
  assert.equal(result.match.result.outcome, 'win')
  assert(result.match.result.rewardVp > 0)
  assert.equal(result.profile.single.wins, 1)
  const reward = result.vpRewards.total
  await env.erase(lease)
  const repeated = await env.rank(google, 'status', { matchId: id })
  assert.equal(repeated.profile.single.wins, 1)
  assert.equal(repeated.vpRewards.total, reward)
  assert.equal((await env.rank(google, 'status')).match, null)
})

for (const mode of ['tournament', 'league']) for (const count of [2, 3, 4]) {
  test(`guest logout safely withdraws from a ${count}-player ${mode} and remaining participants finish`, async () => {
    const people = [guest, ...Array.from({ length: count - 1 }, (_, index) => ({ uid: `room-survivor-${index}`, name: `참가자${index}`, isGuest: false }))]
    const seed = count === 3 && mode === 'tournament' ? Array.from({ length: 100 }, (_, value) => value).find(value => {
      const ordered = [...people].sort((a, b) => createHash('sha256').update(`${value}:${a.uid}`).digest('hex').localeCompare(createHash('sha256').update(`${value}:${b.uid}`).digest('hex')))
      return ordered[2].uid === guest.uid
    }) : 42
    const env = environment({ seed })
    const lease = await env.bootstrap(guest)
    const created = await env.rank(guest, 'roomCreate', { title: '함께하는 대회', mode, format: 'single', team })
    const roomId = created.room.id
    for (const identity of people.slice(1)) await env.rank(identity, 'roomJoin', { roomId, team })
    const begun = await env.rank(guest, 'roomStart', { roomId })
    if (count === 3 && mode === 'tournament') assert(begun.room.matches.some(match => match.phase === 'bye' && match.winnerUid === guest.uid))
    await env.erase(lease)
    await assertErased(env)
    for (let iteration = 0; iteration < 10; iteration += 1) {
      const db = await env.rankedStore.inspect()
      const room = db.collections.battleRooms[roomId]
      if (!room) break
      const fixture = room.fixtures.find(match => ['select', 'battle'].includes(match.phase))
      assert(fixture, 'Remaining room must not wait forever on the deleted guest')
      const match = db.collections.matches[fixture.id]
      const identity = people.find(person => person.uid === match.players[1].uid && person.uid !== guest.uid)
        ?? people.find(person => person.uid === match.players[0].uid && person.uid !== guest.uid)
      assert(identity)
      await env.rank(identity, 'forfeit', { matchId: match.id })
    }
    const { ranked } = await assertErased(env)
    assert.equal(ranked.collections.battleRooms[roomId], undefined)
    for (const identity of people.slice(1)) {
      const final = await env.rank(identity, 'rooms')
      assert.equal(final.room, null)
      assert.equal(final.profile.single.played, 0, 'Friendly withdrawal must not affect ratings')
      assert(final.roomResult)
      assert.equal(final.roomResult.standings.length, count)
    }
  })
}

test('waiting room host deletion transfers ownership and preserves other entrants', async () => {
  const env = environment()
  const lease = await env.bootstrap(guest)
  const created = await env.rank(guest, 'roomCreate', { title: '대기실', mode: 'league', format: 'single', team, password: '1234' })
  await env.rank(google, 'roomJoin', { roomId: created.room.id, team, password: '1234' })
  await env.erase(lease)
  await assertErased(env)
  const status = await env.rank(google, 'rooms')
  assert.equal(status.room.hostUid, google.uid)
  assert.deepEqual(status.room.members.map(member => member.uid), [google.uid])
})

test('HTTP deletion is authenticated POST-only and never trusts the requested UID or guest flag', async () => {
  const env = environment()
  const lease = await env.bootstrap(guest)
  await env.bootstrap(google)
  const handler = createAccountHttpHandler({ service: env.account, authenticate: async (_request, token) => {
    if (token === 'guest-token-123') return guest
    if (token === 'google-token-123') return google
    throw Object.assign(new Error('Invalid token'), { code: 'auth/invalid-id-token' })
  } })
  const request = (method, token, extra = {}) => handler(new Request('https://example.test/api/account', {
    method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    ...(method === 'POST' ? { body: JSON.stringify({ action: 'deleteGuestAccount', ownerId, version: lease.version, ...extra }) } : {}),
  }))
  assert.equal((await request('GET', 'guest-token-123')).status, 405)
  assert.equal((await request('POST', 'bad-token-123')).status, 401)
  assert.equal((await request('POST', 'google-token-123', { uid: guest.uid, isGuest: true })).status, 403)
  const response = await request('POST', 'guest-token-123', { uid: google.uid, isGuest: false })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { deleted: true, uid: guest.uid })
  assert.equal(response.headers.get('Cache-Control'), 'no-store')
  assert((await env.accountStore.inspect()).collections.gameData[google.uid])
})

for (const { name, run } of tests) { await run(); console.log(`PASS ${name}`) }
console.log(`Guest account deletion validation passed: ${tests.length}/${tests.length}`)
