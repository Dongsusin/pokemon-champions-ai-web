import assert from 'node:assert/strict'
import { mkdtemp, readFile, rmdir, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRankedService } from '../server/rankedService.js'
import { createMemoryRankedStore, createFileRankedStore, createFirestoreRankedStore } from '../server/rankedStore.js'
import { createLocalRankedAuthenticator, createRankedHttpHandler } from '../server/rankedHttp.js'
import { createEmptyUsageSnapshot } from '../src/data/pokemonUsage.js'

const tests = []
const test = (name, run) => tests.push({ name, run })
const identities = { alice: { uid: 'ranked-test-alice', name: 'Alice' }, bob: { uid: 'ranked-test-bob', name: 'Bob' } }
const team = label => [25, 6, 149, 143, 94, 9].map(speciesId => ({ speciesId, captureId: `${label}-${speciesId}`, name: `Species ${speciesId}` }))
const engine = {
  canonicalizeRankedTeam: entries => structuredClone(entries),
  createRankedBattle: ({ playerTeam, opponentTeam, format }) => ({ player: { team: playerTeam }, opponent: { team: opponentTeam }, format, turn: 1, winner: null }),
  getRankedBattleView: state => ({ turn: state.turn, winner: state.winner }),
  getRankedTimelineView: () => [],
}
function environment(options = {}) {
  const store = options.store ?? createMemoryRankedStore()
  let timestamp = 1_000_000
  let counter = 0
  const service = createRankedService({ store, engine, usageEnabled: true,
    now: () => timestamp, makeSeed: () => 1, newId: () => `usage-match-${++counter}`,
    timeouts: { selection: 1000, turn: 1000, playbackGrace: 0 }, ...options })
  const call = (who, action, payload = {}) => service.execute(identities[who], { action, requestId: `usage-request-${++counter}`, ...payload })
  return { store, service, call, advance: value => { timestamp += value } }
}
const report = (battleId = 'ai-battle-0001', format = 'single', speciesIds = [25, 6, 149]) => ({ battleId, format, speciesIds })
const rejectsCode = (promise, code) => assert.rejects(promise, error => error.code === code)
async function paired(env, format) {
  await env.call('alice', 'join', { format, team: team('alice') })
  return (await env.call('bob', 'join', { format, team: team('bob') })).match
}
async function startBattle(env, format = 'single') {
  const match = await paired(env, format)
  const selection = format === 'single' ? [0, 1, 2] : [0, 1, 2, 3]
  const payload = { matchId: match.id, revision: match.revision, selection }
  await env.call('alice', 'select', payload)
  const second = { ...payload, requestId: `${match.id}-second-select` }
  return { match: (await env.call('bob', 'select', second)).match, second }
}

test('usage is explicitly disabled by default without breaking existing ranked battles', async () => {
  const env = environment({ usageEnabled: false })
  await rejectsCode(env.call('alice', 'usage'), 'USAGE_DISABLED')
  await rejectsCode(env.call('alice', 'reportAiUsage', report()), 'USAGE_DISABLED')
  await startBattle(env)
  const database = await env.store.inspect()
  assert.equal(database.collections.pokemonUsage, undefined)
  assert.equal(database.collections.pokemonUsageEvents, undefined)
  const defaultService = createRankedService({ store: createMemoryRankedStore(), engine })
  await rejectsCode(defaultService.execute(identities.alice, { action: 'usage' }), 'USAGE_DISABLED')
})

test('authenticated usage reads return four empty live buckets without creating player records or sample counts', async () => {
  const env = environment()
  assert.deepEqual(await env.call('alice', 'usage'), createEmptyUsageSnapshot())
  assert.deepEqual((await env.store.inspect()).collections, {})
  await rejectsCode(env.service.execute(null, { action: 'usage' }), 'UNAUTHENTICATED')
})

test('ranked queues and incomplete selection are not counted; both selected human teams count once in each format', async () => {
  for (const format of ['single', 'double']) {
    const env = environment()
    const match = await paired(env, format)
    const selection = format === 'single' ? [0, 1, 2] : [0, 1, 2, 3]
    await env.call('alice', 'select', { matchId: match.id, revision: match.revision, selection })
    assert.equal((await env.call('alice', 'usage')).buckets[`ranked-${format}`].teamCount, 0)
    const second = { matchId: match.id, revision: match.revision, selection, requestId: `selected-${format}` }
    await Promise.all(Array.from({ length: 8 }, () => env.call('bob', 'select', second)))
    const usage = await env.call('alice', 'usage')
    const bucket = usage.buckets[`ranked-${format}`]
    assert.equal(bucket.teamCount, 2)
    for (const index of selection) assert.equal(bucket.counts[team('unused')[index].speciesId], 2)
    assert.equal(bucket.counts[94], undefined)
    assert.equal(bucket.previous.teamCount, 0)
    for (const [key, other] of Object.entries(usage.buckets)) if (key !== `ranked-${format}`) assert.equal(other.teamCount, 0)
    await env.call('alice', 'status', { matchId: match.id })
    await env.call('alice', 'forfeit', { matchId: match.id })
    assert.deepEqual(await env.call('alice', 'usage'), usage)
  }
})

test('selection timeout and prebattle forfeit leave participation at zero', async () => {
  for (const reason of ['forfeit', 'timeout']) {
    const env = environment()
    const match = await paired(env, 'single')
    if (reason === 'forfeit') await env.call('alice', 'forfeit', { matchId: match.id })
    else { env.advance(2000); await env.call('alice', 'status') }
    assert.equal((await env.call('alice', 'usage')).buckets['ranked-single'].teamCount, 0)
  }
})

test('read-only usage does not expire an active match or mutate private records', async () => {
  const env = environment()
  const match = await paired(env, 'single')
  const before = await env.store.inspect()
  env.advance(2000)
  const usage = await env.call('alice', 'usage')
  assert.equal(usage.buckets['ranked-single'].teamCount, 0)
  assert.deepEqual(await env.store.inspect(), before)
  assert.equal(before.collections.matches[match.id].phase, 'select')
})

test('starting with usage disabled then enabling it does not backfill existing matches', async () => {
  const original = environment({ usageEnabled: false })
  const { match } = await startBattle(original)
  const enabled = environment({ store: original.store })
  await enabled.call('alice', 'status', { matchId: match.id })
  await enabled.call('alice', 'forfeit', { matchId: match.id })
  assert.equal((await enabled.call('alice', 'usage')).buckets['ranked-single'].teamCount, 0)
})

test('AI start reports count one team, canonicalize and deduplicate species, and isolate battle formats', async () => {
  const env = environment()
  for (const format of ['single', 'double']) {
    const response = await env.call('alice', 'reportAiUsage', report(`ai-${format}-start`, format, [25, 10080, 6, 149, 143, 94]))
    assert.equal(response.accepted, true)
    const bucket = response.usage.buckets[`ai-${format}`]
    assert.equal(bucket.teamCount, 1)
    assert.equal(bucket.counts[25], 1)
    assert.equal(bucket.counts[10080], undefined)
    assert.equal(Object.values(bucket.counts).reduce((sum, count) => sum + count, 0), 5)
    assert.equal(response.usage.buckets[`ranked-${format}`].teamCount, 0)
  }
})

test('an older in-flight request cannot move the aggregate update timestamp backward', async () => {
  const env = environment()
  await env.call('alice', 'reportAiUsage', report('timestamp-first-event'))
  const before = await env.call('alice', 'usage')
  env.advance(-1000)
  const after = await env.call('alice', 'reportAiUsage', report('timestamp-older-event'))
  assert.equal(after.usage.updatedAt, before.updatedAt)
  assert.equal(after.usage.buckets['ai-single'].teamCount, 2)
})

test('real competition battle IDs containing round and trainer separators are accepted and deduplicated', async () => {
  const env = environment()
  const competition = { id: 'league-1757721600000-372819', round: 0 }
  const currentMatch = { opponent: { id: 'trainer-cynthia' } }
  const battleId = `${competition.id}:${competition.round}:${currentMatch.opponent.id}`
  const payload = report(battleId)
  const accepted = await env.call('alice', 'reportAiUsage', payload)
  assert.equal(accepted.accepted, true)
  assert.equal(accepted.usage.buckets['ai-single'].teamCount, 1)
  assert.equal((await env.call('alice', 'reportAiUsage', payload)).accepted, false)
  assert.equal((await env.call('alice', 'usage')).buckets['ai-single'].teamCount, 1)
})

test('concurrent repeated AI reports share a durable receipt independent of request ID history', async () => {
  const env = environment()
  const payload = report('ai-concurrent-start')
  const results = await Promise.all(Array.from({ length: 20 }, () => env.call('alice', 'reportAiUsage', payload)))
  assert.equal(results.filter(result => result.accepted).length, 1)
  for (let index = 0; index < 70; index += 1) await env.call('alice', 'reportAiUsage', report(`subsequent-battle-${index}`))
  assert.equal((await env.call('alice', 'reportAiUsage', payload)).accepted, false)
  assert.equal((await env.call('alice', 'usage')).buckets['ai-single'].teamCount, 71)
  assert.equal(Object.keys((await env.store.inspect()).collections.pokemonUsageEvents).length, 71)
})

test('different concurrent AI reports have no lost updates and cannot choose another account identity', async () => {
  const env = environment()
  await Promise.all(Array.from({ length: 30 }, (_, index) => env.call('alice', 'reportAiUsage', report(`distinct-battle-${index}`, index % 2 ? 'single' : 'double'))))
  const sameBattle = report('shared-battle-identifier')
  await env.call('alice', 'reportAiUsage', { ...sameBattle, uid: identities.bob.uid, source: 'demo', mode: 'ranked', teamCount: 999999 })
  const result = await env.call('bob', 'reportAiUsage', sameBattle)
  assert.equal(result.accepted, true)
  assert.equal(result.usage.buckets['ai-single'].teamCount, 17)
  assert.equal(result.usage.buckets['ai-double'].teamCount, 15)
  assert.equal(result.usage.buckets['ranked-single'].teamCount, 0)
  assert.equal(result.usage.source, 'live')
  assert.deepEqual(Object.keys(result.usage).sort(), ['buckets', 'source', 'updatedAt'])
  assert.equal(JSON.stringify(result.usage).includes('ranked-test'), false)
})

test('AI event identifiers cannot be replayed with a different format or selected team', async () => {
  const env = environment()
  const payload = report()
  await env.call('alice', 'reportAiUsage', payload)
  const before = await env.call('alice', 'usage')
  await rejectsCode(env.call('alice', 'reportAiUsage', { ...payload, format: 'double' }), 'USAGE_EVENT_REUSED')
  await rejectsCode(env.call('alice', 'reportAiUsage', { ...payload, speciesIds: [9, 94, 143] }), 'USAGE_EVENT_REUSED')
  const reordered = await env.call('alice', 'reportAiUsage', { ...payload, speciesIds: [149, 6, 25, 25] })
  assert.equal(reordered.accepted, false)
  assert.deepEqual(await env.call('alice', 'usage'), before)
})

test('malformed AI identifiers, formats, species and bodies are rejected without writes', async () => {
  const env = environment()
  for (const format of ['triples', '__proto__', '', null, 3]) await rejectsCode(env.call('alice', 'reportAiUsage', { ...report(), format }), 'INVALID_FORMAT')
  for (const battleId of ['', 'short', 'bad/battle-id', 'x'.repeat(129), null, 123]) await rejectsCode(env.call('alice', 'reportAiUsage', { ...report(), battleId }), 'INVALID_USAGE_BATTLE')
  for (const speciesIds of [null, {}, [], [25, 6, 149, 143, 94, 9, 3], ['25'], [{ speciesId: 25 }], [0], [-1], [1.5], [999999], [NaN], [Infinity]]) {
    await rejectsCode(env.call('alice', 'reportAiUsage', { ...report(), speciesIds }), 'INVALID_USAGE_TEAM')
  }
  await rejectsCode(env.call('alice', 'reportAiUsage', { ...report(), requestId: '' }), 'INVALID_REQUEST_ID')
  assert.deepEqual((await env.store.inspect()).collections, {})
})

test('ranked start and AI report roll back aggregates and receipts when the shared transaction fails', async () => {
  const store = createMemoryRankedStore()
  const transaction = store.transaction.bind(store)
  let failCommit = false
  store.transaction = work => transaction(async tx => {
    const result = await work(tx)
    if (failCommit) { failCommit = false; throw new Error('simulated failed commit') }
    return result
  })
  const env = environment({ store })
  const match = await paired(env, 'single')
  const payload = { matchId: match.id, revision: match.revision, selection: [0, 1, 2] }
  await env.call('alice', 'select', payload)
  failCommit = true
  await assert.rejects(env.call('bob', 'select', payload), /simulated failed commit/)
  assert.equal((await env.call('alice', 'usage')).buckets['ranked-single'].teamCount, 0)
  assert.equal((await store.inspect()).collections.matches[match.id].phase, 'select')
  await env.call('bob', 'select', payload)
  assert.equal((await env.call('alice', 'usage')).buckets['ranked-single'].teamCount, 2)
  failCommit = true
  await assert.rejects(env.call('alice', 'reportAiUsage', report()), /simulated failed commit/)
  assert.equal((await env.call('alice', 'usage')).buckets['ai-single'].teamCount, 0)
  assert.equal((await store.inspect()).collections.pokemonUsageEvents, undefined)
  assert.equal((await env.call('alice', 'reportAiUsage', report())).accepted, true)
})

test('HTTP usage routes enforce authentication, report POST-only semantics and existing rate limits', async () => {
  const env = environment()
  const handler = createRankedHttpHandler({ service: env.service, enabled: true,
    authenticate: createLocalRankedAuthenticator({ enabled: true, production: false }) })
  const headers = { Authorization: 'Bearer ranked-test-alice' }
  const url = 'http://127.0.0.1/api/ranked?action=usage'
  assert.equal((await handler(new Request(url))).status, 401)
  const live = await handler(new Request(url, { headers }))
  assert.equal(live.status, 200)
  assert.deepEqual(await live.json(), createEmptyUsageSnapshot())
  assert.equal((await handler(new Request('http://127.0.0.1/api/ranked?action=reportAiUsage', { headers }))).status, 405)
  const post = await handler(new Request('http://127.0.0.1/api/ranked', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'reportAiUsage', requestId: 'http-report-0001', ...report() }) }))
  assert.equal(post.status, 200)
  assert.equal((await post.json()).accepted, true)
  const responses = await Promise.all(Array.from({ length: 61 }, () => handler(new Request(url, { headers }))))
  assert.ok(responses.some(response => response.status === 429))
})

test('file-store restart preserves usage and durable AI replay protection', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pokemon-usage-validation-'))
  const filename = join(directory, 'state.json')
  let store
  try {
    store = await createFileRankedStore(filename)
    const env = environment({ store })
    await env.call('alice', 'reportAiUsage', report())
    const usage = await env.call('alice', 'usage')
    await store.close()
    store = await createFileRankedStore(filename)
    const restarted = environment({ store })
    assert.equal((await restarted.call('alice', 'reportAiUsage', report())).accepted, false)
    assert.deepEqual(await restarted.call('alice', 'usage'), usage)
    assert.equal(JSON.parse(await readFile(filename, 'utf8')).version, 1)
  } finally {
    await store?.close()
    await unlink(filename)
    await rmdir(directory)
  }
})

test('Firestore adapter commits usage only after reads and retries AI commands without duplicate increments', async () => {
  const documents = new Map()
  const firestore = {
    collection: name => ({ doc: id => ({ path: `${name}/${id}` }) }),
    async runTransaction(work) {
      // Firestore can discard an attempt and rerun the callback after a conflict.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        let wrote = false
        const writes = new Map()
        const result = await work({
          async get(reference) {
            assert.equal(wrote, false, 'Firestore reads must precede writes')
            const data = documents.get(reference.path)
            return { exists: Boolean(data), data: () => structuredClone(data) }
          },
          set(reference, data) { wrote = true; writes.set(reference.path, structuredClone(data)) },
          delete(reference) { wrote = true; writes.set(reference.path, null) },
        })
        if (attempt === 0) continue
        for (const [key, value] of writes) if (value === null) documents.delete(key); else documents.set(key, value)
        return result
      }
    },
  }
  const store = createFirestoreRankedStore(firestore, { prefix: 'usageValidation' })
  const env = environment({ store })
  assert.equal((await env.call('alice', 'reportAiUsage', report())).accepted, true)
  assert.equal((await env.call('alice', 'reportAiUsage', report())).accepted, false)
  const usage = await env.call('alice', 'usage')
  assert.equal(usage.buckets['ai-single'].teamCount, 1)
  assert.equal(documents.size, 2)
  assert.ok([...documents.keys()].every(path => path.startsWith('usageValidation_')))
})

for (const { name, run } of tests) {
  await run()
  console.log(`PASS ${name}`)
}
console.log(`Pokemon usage server: ${tests.length} checks passed. No external services contacted.`)
