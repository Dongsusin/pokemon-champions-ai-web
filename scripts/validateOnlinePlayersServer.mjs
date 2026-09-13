import assert from 'node:assert/strict'
import { createAccountService, ACCOUNT_LEASE_MS, ONLINE_PLAYERS_CACHE_MS, ONLINE_PLAYERS_STALE_MS } from '../server/accountService.js'
import { createMemoryRankedStore } from '../server/rankedStore.js'

const tests = []
const test = (name, run) => tests.push({ name, run })
const identities = {
  alice: { uid: 'online-alice', name: 'Alice Private', accountProfile: { email: 'alice@example.test' } },
  bob: { uid: 'online-bob', name: 'Bob Private' },
  guest: { uid: 'online-guest', name: 'guest-123456', isGuest: true },
}
const ownerId = 'online-owner-1234567890'
function environment(options = {}) {
  const database = createMemoryRankedStore()
  let timestamp = 1000, revision = 0, countCalls = 0, failCount = false, nextCount
  const versions = new Map(), events = []
  const store = {
    async transaction(work) {
      const result = await database.transaction(work)
      events.push('commit')
      return result
    },
    async countActiveSessions(at) {
      countCalls += 1
      events.push('count')
      if (options.beforeCount) await options.beforeCount()
      if (failCount) throw new Error('private connection failure')
      if (nextCount !== undefined) return nextCount
      const sessions = (await database.inspect()).collections.sessions ?? {}
      // The fixture follows the production COUNT semantics using UID-keyed
      // leases, independent of Google/anonymous profile or saved game data.
      return Object.values(sessions).filter(session => typeof session.expiresAt === 'number' && session.expiresAt > at).length
    },
  }
  if (options.unsupported) delete store.countActiveSessions
  const service = createAccountService({ store, now: () => timestamp, newVersion: () => `online-version-${++revision}` })
  const call = async (who, action, values = {}) => {
    const identity = identities[who]
    const result = await service.execute(identity, { action, ownerId, ...(['sessionHeartbeat', 'sessionRelease'].includes(action) ? { version: versions.get(who) } : {}), ...values })
    if (result.version) versions.set(who, result.version)
    return result
  }
  return { database, service, call, events, now: () => timestamp, advance: ms => { timestamp += ms },
    countCalls: () => countCalls, failCounts: value => { failCount = value }, setCount: value => { nextCount = value } }
}
const assertAggregate = (actual, count, sampledAt, staleAfterMs = ONLINE_PLAYERS_STALE_MS) => {
  assert.deepEqual(actual, { count, sampledAt, staleAfterMs })
  assert.deepEqual(Object.keys(actual).sort(), ['count', 'sampledAt', 'staleAfterMs'])
}

test('lease acquire counts committed authenticated and guest sessions once per UID', async () => {
  const env = environment()
  const first = await env.call('alice', 'sessionAcquire')
  assertAggregate(first.onlinePlayers, 1, env.now())
  assert.deepEqual(env.events, ['commit', 'count'], 'Aggregate must run only after the lease has committed')
  await env.call('bob', 'sessionAcquire')
  env.advance(ONLINE_PLAYERS_CACHE_MS)
  const guest = await env.call('guest', 'sessionAcquire')
  assertAggregate(guest.onlinePlayers, 3, env.now())
  const retried = await env.call('alice', 'sessionAcquire')
  assert.equal(retried.onlinePlayers.count, 3)
  assert.equal(retried.version, first.version)
  const countCalls = env.countCalls()
  await assert.rejects(env.call('alice', 'sessionAcquire', { ownerId: 'foreign-window-1234567890' }), error => error.code === 'account-session/occupied')
  assert.equal(env.countCalls(), countCalls)
  assert.equal(Object.keys((await env.database.inspect()).collections.sessions).length, 3)
  assert.doesNotMatch(JSON.stringify(guest.onlinePlayers), /online-alice|online-guest|Private|example|owner|version|guest-123456/)
})

test('release and exact 90-second expiration remove sessions from the next aggregate', async () => {
  const env = environment()
  await env.call('alice', 'sessionAcquire')
  await env.call('bob', 'sessionAcquire')
  await env.call('guest', 'sessionAcquire')
  const reads = env.countCalls()
  assert.deepEqual(await env.call('bob', 'sessionRelease'), { released: true })
  assert.equal(env.countCalls(), reads, 'Release introduces no aggregate query')
  env.advance(ONLINE_PLAYERS_CACHE_MS)
  assertAggregate((await env.call('alice', 'sessionHeartbeat')).onlinePlayers, 2, env.now())
  env.advance(ACCOUNT_LEASE_MS - ONLINE_PLAYERS_CACHE_MS)
  const renewed = await env.call('alice', 'sessionHeartbeat')
  assertAggregate(renewed.onlinePlayers, 1, env.now())
  const sessions = (await env.database.inspect()).collections.sessions
  assert.equal(sessions[identities.guest.uid].expiresAt, env.now(), 'Expired documents may remain stored, but never count as online')
  assert.equal(sessions[identities.bob.uid], undefined)
})

test('cached samples keep their original timestamp and remaining freshness, with no game-data polling', async () => {
  const env = environment()
  const sample = (await env.call('alice', 'sessionAcquire')).onlinePlayers
  env.advance(5000)
  assertAggregate((await env.call('alice', 'sessionHeartbeat')).onlinePlayers, 1, sample.sampledAt, ONLINE_PLAYERS_STALE_MS - 5000)
  assert.deepEqual(await env.call('alice', 'load'), { gameData: null })
  assert.equal(env.countCalls(), 1)
  env.advance(ONLINE_PLAYERS_CACHE_MS - 5000)
  assertAggregate((await env.call('alice', 'sessionHeartbeat')).onlinePlayers, 1, env.now())
  assert.equal(env.countCalls(), 2)
  assert.deepEqual(Object.keys((await env.database.inspect()).collections), ['sessions'], 'Count feature adds no persistent documents')
})

test('concurrent acquire requests coalesce one aggregate while every lease commits independently', async () => {
  let releaseCount, started
  const gate = new Promise(resolve => { releaseCount = resolve })
  const began = new Promise(resolve => { started = resolve })
  const env = environment({ beforeCount: async () => { started(); await gate } })
  const first = env.call('alice', 'sessionAcquire')
  await began
  const second = env.call('bob', 'sessionAcquire')
  const third = env.call('guest', 'sessionAcquire')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(Object.keys((await env.database.inspect()).collections.sessions).length, 3)
  assert.equal(env.countCalls(), 1)
  releaseCount()
  const leases = await Promise.all([first, second, third])
  for (const lease of leases) assertAggregate(lease.onlinePlayers, 3, env.now())
  assert.equal(new Set(leases.map(lease => lease.version)).size, 3)
})

test('count failures preserve login and heartbeat and never extend a stale cached sample', async () => {
  const env = environment()
  env.failCounts(true)
  const lease = await env.call('alice', 'sessionAcquire')
  assert.equal(lease.onlinePlayers, undefined)
  assert.equal((await env.database.inspect()).collections.sessions[identities.alice.uid].version, lease.version)
  env.advance(1000)
  const retry = await env.call('alice', 'sessionHeartbeat')
  assert.notEqual(retry.version, lease.version)
  assert.equal(retry.onlinePlayers, undefined)
  assert.equal(env.countCalls(), 1, 'Failures are throttled too')
  env.advance(ONLINE_PLAYERS_CACHE_MS - 1000)
  env.failCounts(false)
  const good = (await env.call('alice', 'sessionHeartbeat')).onlinePlayers
  assertAggregate(good, 1, env.now())
  env.failCounts(true)
  env.advance(ONLINE_PLAYERS_CACHE_MS)
  const cached = (await env.call('alice', 'sessionHeartbeat')).onlinePlayers
  assertAggregate(cached, 1, good.sampledAt, ONLINE_PLAYERS_STALE_MS - ONLINE_PLAYERS_CACHE_MS)
  env.advance(ONLINE_PLAYERS_STALE_MS - ONLINE_PLAYERS_CACHE_MS)
  const expired = await env.call('alice', 'sessionHeartbeat')
  assert.equal(expired.onlinePlayers, undefined)
  assert.equal(expired.expiresAt, env.now() + ACCOUNT_LEASE_MS)
})

test('invalid aggregates and unsupported storage omit metadata without failing session controls', async () => {
  for (const count of [NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, null, '7', {}]) {
    const env = environment()
    env.setCount(count)
    const lease = await env.call('alice', 'sessionAcquire')
    assert.equal(lease.onlinePlayers, undefined)
    assert(lease.version)
  }
  const legacy = environment({ unsupported: true })
  const lease = await legacy.call('alice', 'sessionAcquire')
  assert.deepEqual(Object.keys(lease).sort(), ['ownerId', 'version', 'leaseMs', 'expiresAt'].sort())
  assert.equal((await legacy.call('alice', 'sessionHeartbeat')).onlinePlayers, undefined)
  assert.equal(legacy.countCalls(), 0)
})

test('failed lease authorization does not trigger a count and a clock rollback cannot make a future sample fresh', async () => {
  const env = environment()
  await env.call('alice', 'sessionAcquire')
  const calls = env.countCalls()
  await assert.rejects(env.call('alice', 'sessionHeartbeat', { version: 'stale-version-1234' }), error => error.code === 'account-session/lost')
  assert.equal(env.countCalls(), calls)
  env.failCounts(true)
  env.advance(-1)
  assert.equal((await env.call('alice', 'sessionHeartbeat')).onlinePlayers, undefined)
})

for (const { name, run } of tests) { await run(); console.log(`PASS ${name}`) }
console.log(`Online player server validation passed: ${tests.length}/${tests.length}`)
