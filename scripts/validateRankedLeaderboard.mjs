import assert from 'node:assert/strict'
import { createRankedProfile } from '../src/data/rankedRules.js'
import { createGuestIdentityRegistry } from '../server/guestIdentity.js'
import { readRankedLeaderboard } from '../server/rankedLeaderboardService.js'
import { createMemoryRankedStore } from '../server/rankedStore.js'
import { createRankedService } from '../server/rankedService.js'
import { createRankedHttpHandler } from '../server/rankedHttp.js'

const tests = []
const test = (name, run) => tests.push({ name, run })
const profile = (format, values = {}) => ({ ...createRankedProfile(format), played: 1, wins: 1, ...values })
const player = (uid, single, double, extra = {}) => ({
  uid, name: `${uid} 비공개 이름`,
  profiles: { single: single ?? createRankedProfile('single'), double: double ?? createRankedProfile('double') },
  team: ['private-team'], history: ['private-history'], requests: [], ...extra,
})
const makeStore = players => createMemoryRankedStore({ version: 1, collections: { players: Object.fromEntries(players.map(entry => [entry.uid, entry])) } })
const read = (store, uid = 'viewer') => store.transaction(tx => readRankedLeaderboard(tx, uid, 1_234_567))
const assertPrivate = value => {
  const fields = ['rank', 'trainerName', 'isGuest', 'isOwn', 'points', 'rating', 'wins', 'losses', 'draws', 'played'].sort()
  for (const board of Object.values(value.boards)) for (const entry of board.entries) assert.deepEqual(Object.keys(entry).sort(), fields)
  assert.doesNotMatch(JSON.stringify(value), /private-team|private-history|비공개 이름|secret-account/)
}

test('empty and unplayed profiles create no artificial ranked participants', async () => {
  const store = makeStore([player('unplayed'), player('single-only', profile('single', { points: 30 }))])
  const result = await read(store)
  assert.equal(result.updatedAt, 1_234_567)
  assert.equal(result.boards.single.participantCount, 1)
  assert.deepEqual(result.boards.double, { participantCount: 0, entries: [] })
  assert.equal(result.boards.single.entries[0].trainerName, 's**')
  assert.deepEqual((await read(makeStore([]))).boards.single.entries, [])
})

test('both formats independently return exactly the highest 10 current records', async () => {
  const records = Array.from({ length: 15 }, (_, index) => player(`trainer-${String(index).padStart(2, '0')}`,
    profile('single', { points: 100 + index * 10 }), profile('double', { points: 300 - index * 10 })))
  const result = await read(makeStore(records), 'trainer-14')
  assert.equal(result.boards.single.participantCount, 15)
  assert.equal(result.boards.double.participantCount, 15)
  assert.deepEqual(result.boards.single.entries.map(entry => entry.points), [240, 230, 220, 210, 200, 190, 180, 170, 160, 150])
  assert.deepEqual(result.boards.double.entries.map(entry => entry.points), [300, 290, 280, 270, 260, 250, 240, 230, 220, 210])
  assert.deepEqual(result.boards.single.entries.map(entry => entry.rank), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  assert.equal(result.boards.single.entries[0].isOwn, true)
  assert.equal(result.boards.double.entries.some(entry => entry.isOwn), false)
})

test('master tier competes on rating; lower tiers compete on points with stable private ties', async () => {
  const records = [
    player('master-high-points', profile('single', { points: 1800, rating: 1100 })),
    player('ultra-high-rating', profile('single', { points: 1199, rating: 9999 })),
    player('master-high-rating', profile('single', { points: 1200, rating: 1500 })),
    player('master-tiebreak-points', profile('single', { points: 1210, rating: 1500 })),
    player('lower-high-points', profile('single', { points: 500, rating: 900 })),
    player('lower-high-rating', profile('single', { points: 400, rating: 1600 })),
    player('tie-b', profile('single', { points: 500, rating: 900, wins: 4, played: 4 })),
    player('tie-a', profile('single', { points: 500, rating: 900, wins: 4, played: 4 })),
  ]
  const store = makeStore(records.reverse())
  const rankOf = async uid => (await read(store, uid)).boards.single.entries.find(entry => entry.isOwn).rank
  assert.equal(await rankOf('master-tiebreak-points'), 1)
  assert.equal(await rankOf('master-high-rating'), 2)
  assert.equal(await rankOf('master-high-points'), 3)
  assert.equal(await rankOf('ultra-high-rating'), 4)
  assert.equal(await rankOf('tie-a'), 5)
  assert.equal(await rankOf('tie-b'), 6)
  assert.equal(await rankOf('lower-high-points'), 7)
  assert.equal(await rankOf('lower-high-rating'), 8)
})

test('public entries mask account names, preserve verified guest names, and reveal only own flag', async () => {
  const records = [
    player('secret-account-1', profile('single', { points: 200 }), undefined, { name: '김트레이너', email: 'private@example.com' }),
    player('secret-account-2', profile('single', { points: 190 }), undefined, { name: 'guest-123456', isGuest: true }),
    player('secret-account-3', profile('single', { points: 180 }), undefined, { name: 'guest-654321', isGuest: false }),
  ]
  const result = await read(makeStore(records), 'secret-account-2')
  assert.deepEqual(result.boards.single.entries.map(entry => entry.trainerName), ['김**', 'guest-123456', 'g**'])
  assert.deepEqual(result.boards.single.entries.map(entry => entry.isOwn), [false, true, false])
  assertPrivate(result)
  assert.doesNotMatch(JSON.stringify(result), /private@example|김트레이너|guest-654321/)
})

test('malformed counters cannot create infinite scores or unplayed participants', async () => {
  const records = [
    player('infinite-played', profile('single', { played: Infinity, points: 9999 })),
    player('string-played', profile('single', { played: '4', points: 9999 })),
    player('negative-played', profile('single', { played: -1, points: 9999 })),
    player('bad-stats', profile('single', { points: Infinity, rating: -99, wins: NaN, losses: -1, draws: '2' })),
  ]
  const result = await read(makeStore(records))
  assert.equal(result.boards.single.participantCount, 1)
  const entry = result.boards.single.entries[0]
  assert.deepEqual([entry.points, entry.rating, entry.wins, entry.losses, entry.draws, entry.played], [0, 1000, 0, 0, 0, 1])
})

test('compact provider projection is read once for both formats with no writes or broad fallback', async () => {
  let reads = 0
  const result = await readRankedLeaderboard({
    async listRankedProfiles() { reads += 1; return [{ id: 'projected-user', name: '가나다', profiles: { single: profile('single'), double: profile('double') } }] },
    async list() { assert.fail('Should use compact projection') },
    set() { assert.fail('Leaderboard cannot mutate storage') },
    delete() { assert.fail('Leaderboard cannot delete storage') },
  }, 'projected-user', 42)
  assert.equal(reads, 1)
  assert.equal(result.boards.single.entries[0].isOwn, true)
  assert.equal(result.boards.double.entries[0].isOwn, true)
  assert.equal(result.updatedAt, 42)
})

const engine = {
  canonicalizeRankedTeam: entries => structuredClone(entries),
  createRankedBattle: ({ playerTeam, opponentTeam, format }) => ({ format, turn: 1, player: { team: playerTeam }, opponent: { team: opponentTeam }, winner: null }),
  getRankedBattleView: state => ({ turn: state.turn, winner: state.winner }),
  getRankedTimelineView: timeline => timeline,
}
function environment(store, overrides = {}) {
  let sequence = 0
  const service = createRankedService({ store, engine, now: () => 1_000_000, newId: () => `ranking-match-${++sequence}`, makeSeed: () => 1, ...overrides })
  const call = (uid, action, payload = {}) => service.execute({ uid, name: `${uid} 비공개 이름` }, { action, requestId: `ranking-request-${++sequence}`, ...payload })
  const start = async (first, second, format = 'single') => {
    const team = Array.from({ length: 6 }, (_, index) => ({ captureId: `capture-${index}`, speciesId: index + 1, name: `Pokemon ${index}` }))
    await call(first, 'join', { format, team })
    const joined = await call(second, 'join', { format, team })
    const { id: matchId, revision } = joined.match
    const selection = format === 'single' ? [0, 1, 2] : [0, 1, 2, 3]
    await call(first, 'select', { matchId, revision, selection })
    return (await call(second, 'select', { matchId, revision, selection })).match
  }
  return { service, call, start }
}

test('a real server settlement replaces a falling tenth place with the former eleventh immediately', async () => {
  const records = Array.from({ length: 12 }, (_, index) => player(`rank-${String(index).padStart(2, '0')}`,
    profile('single', { points: 400 - index }), profile('double', { points: 200 + index })))
  const store = makeStore(records)
  const env = environment(store)
  const before = await read(store, 'rank-09')
  assert.equal(before.boards.single.entries.find(entry => entry.isOwn).rank, 10)
  const match = await env.start('rank-09', 'rank-00')
  assert.equal(match.phase, 'battle')
  await env.call('rank-09', 'forfeit', { matchId: match.id })
  const result = await env.service.execute({ uid: 'rank-10', name: 'reader' }, { action: 'rankedLeaderboard' })
  assert.equal(result.boards.single.entries.find(entry => entry.isOwn).rank, 10)
  assert.equal(result.boards.single.entries[0].points, 430)
  assert.equal(result.boards.single.entries[0].wins, 2)
  assert.equal(result.boards.single.entries[0].played, 2)
  assert.deepEqual(result.boards.double.entries.map(({ isOwn, ...entry }) => entry), before.boards.double.entries.map(({ isOwn, ...entry }) => entry))
  await env.call('rank-09', 'forfeit', { matchId: match.id })
  assert.deepEqual((await read(store, 'rank-10')).boards, result.boards)
})

test('leaderboard reads neither expire pending matches nor create profiles or update ratings', async () => {
  const store = makeStore([player('active-user', profile('single', { points: 100 }), undefined, { activeMatchId: 'expired-match' })])
  await store.transaction(tx => {
    tx.set('matches', 'expired-match', { id: 'expired-match', phase: 'select', deadlineAt: 1, players: [] })
    tx.set('queue', 'expired-user', { uid: 'expired-user', expiresAt: 1 })
  })
  const before = await store.inspect()
  const env = environment(store)
  const response = await env.service.execute({ uid: 'new-reader', name: 'viewer' }, { action: 'rankedLeaderboard' })
  assert.equal(response.boards.single.participantCount, 1)
  assert.deepEqual(await store.inspect(), before)
})

test('authenticated GET supports normal and verified guest viewers without a mutation request ID', async () => {
  const store = makeStore([player('public-reader', profile('single', { points: 30 }))])
  const guestRegistry = createGuestIdentityRegistry({ store, now: () => 100, chooseNumber: () => 123456 })
  const guest = { uid: 'guest-reader', isGuest: true, name: 'untrusted-name' }
  await guestRegistry.create(guest)
  const env = environment(store, { guestRegistry })
  const handler = createRankedHttpHandler({ enabled: true, service: env.service, authenticate: async (_request, token) => token === 'guest-token' ? guest : { uid: 'public-reader', name: 'reader' } })
  const url = 'https://game.example/api/ranked?action=rankedLeaderboard'
  const before = await store.inspect()
  for (const token of ['normal-token', 'guest-token']) {
    const response = await handler(new Request(url, { headers: { Authorization: `Bearer ${token}` } }))
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    const body = await response.json()
    assert.equal(body.boards.single.entries[0].isOwn, token === 'normal-token')
    assertPrivate(body)
  }
  assert.equal((await handler(new Request(url))).status, 401)
  assert.equal((await handler(new Request('https://game.example/api/ranked?action=join', { headers: { Authorization: 'Bearer normal-token' } }))).status, 405)
  assert.deepEqual(await store.inspect(), before)
})

for (const { name, run } of tests) {
  await run()
  console.log(`PASS ${name}`)
}
console.log(`Validated ${tests.length} ranked leaderboard scenarios.`)
