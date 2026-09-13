import assert from 'node:assert/strict'
import { mkdtemp, rm, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createFactoryRun, selectFactoryRentals, selectFactoryLead, beginFactoryBattle,
  resolveFactoryBattle, advanceFactoryFloor,
} from '../src/data/battleFactory.js'
import {
  createFactoryRankingSubmission, validateFactoryRankingSubmission,
  chooseFactoryPersonalBest, sortFactoryRankingEntries,
} from '../src/data/battleFactoryRanking.js'
import { normalizePokemon } from '../src/data/trainingData.js'
import { createRankedService } from '../server/rankedService.js'
import { createRankedHttpHandler } from '../server/rankedHttp.js'
import { createMemoryRankedStore, createFileRankedStore, createFirestoreRankedStore } from '../server/rankedStore.js'

const tests = []
const test = (name, run) => tests.push({ name, run })
const clone = value => structuredClone(value)
const identity = index => ({ uid: `factory-ranking-user-${index}`, name: `도전자${index}` })
function finishedRun({ floor = 1, seed = 42, id = 'factory-ranking-fixture', forfeited = false } = {}) {
  let run = createFactoryRun({ seed, id })
  run = selectFactoryRentals(run, run.offers.slice(0, 3).map(pokemon => pokemon.captureId))
  for (let current = 1; current <= floor; current += 1) {
    run = beginFactoryBattle(selectFactoryLead(run, run.party[0].captureId))
    run = resolveFactoryBattle(run, { battleId: run.battleId, winner: current === floor ? 'opponent' : 'player', forfeited: current === floor && forfeited })
    if (current < floor) run = advanceFactoryFloor(run)
  }
  return run
}
const report = (floor, id, seed = 42) => createFactoryRankingSubmission(finishedRun({ floor, id, seed }))
function environment(store = createMemoryRankedStore()) {
  let clock = 1000000, id = 0
  const engine = new Proxy({}, { get() { throw new Error('Factory ranking must not use rated battle or economy engine') } })
  const service = createRankedService({ store, engine, now: () => clock, newId: () => `opaque-factory-row-${++id}` })
  return { store, service, setTime: time => { clock = time },
    submit: (user, value, extra = {}) => service.execute(user, { action: 'reportFactoryRun', report: value, ...extra }),
    read: user => service.execute(user, { action: 'factoryLeaderboard' }),
  }
}
const invalid = fn => assert.throws(fn, error => error.code === 'FACTORY_RANKING_INVALID' && error.status === 400)

test('finished snapshots keep legal final equipment and moves without runtime or identity fields', () => {
  const run = finishedRun({ floor: 3 })
  const before = JSON.stringify(run)
  const value = createFactoryRankingSubmission(run)
  assert.deepEqual(Object.keys(value).sort(), ['runId', 'floor', 'wins', 'party', 'outcome', 'forfeited'].sort())
  assert.equal(value.floor, 3)
  assert.equal(value.wins, 2)
  for (let index = 0; index < 3; index += 1) {
    assert.equal(value.party[index].heldItemId, run.party[index].heldItemId)
    assert.deepEqual(value.party[index].moves, run.party[index].moves)
    assert.equal(normalizePokemon(value.party[index]).name, run.party[index].name)
    for (const key of ['captureId', 'spriteFront', 'factoryGimmicks', 'hp', 'stats', 'name']) assert(!Object.hasOwn(value.party[index], key))
  }
  assert.deepEqual(validateFactoryRankingSubmission(value), value)
  value.party[0].moves[0] = 'changed'
  assert.equal(JSON.stringify(run), before)
  invalid(() => createFactoryRankingSubmission({ ...run, phase: 'battle' }))
  invalid(() => createFactoryRankingSubmission({ ...run, lastResult: { ...run.lastResult, won: true } }))
  invalid(() => createFactoryRankingSubmission({ ...run, lastResult: { ...run.lastResult, battleId: 'stale' } }))
  assert.equal(createFactoryRankingSubmission(finishedRun({ forfeited: true })).forfeited, true)
})

test('reject malformed floors, wins, identifiers, teams, moves, items and inflated training', () => {
  const valid = report(3, 'valid-report-id')
  for (const modify of [
    value => { value.floor = 0 }, value => { value.floor = 10001 }, value => { value.floor = 1.5 },
    value => { value.wins = 99 }, value => { value.floor = Number.MAX_SAFE_INTEGER },
    value => { value.runId = 'x'.repeat(129) }, value => { value.runId = 'someone@example.com' },
    value => { value.trainerName = 'forged' }, value => { value.outcome = 'win' },
    value => { value.forfeited = 'false' }, value => { value.forfeited = true; value.outcome = 'draw' },
    value => { value.party.pop() }, value => { value.party.push(clone(value.party[0])) },
    value => { value.party[0] = null }, value => { value.party[0].speciesId = 999999999 },
    value => { value.party[1] = clone(value.party[0]) }, value => { value.party[0].heldItemId = 'imaginary-item' },
    value => { value.party[0].heldItemId = null }, value => { value.party[0].moves = ['파괴광선'.repeat(40)] },
    value => { value.party[0].moves = ['선물', '선물'] }, value => { value.party[0].ability = 'unknown' },
    value => { value.party[0].nature = 'unknown' }, value => { value.party[0].teraType = 'unknown' },
    value => { value.party[0].trainingPoints.hp = 999 }, value => { value.party[0].trainingPoints.hp = 0.1 },
    value => { value.party[0].trainingPoints = { hp: 1 } }, value => { value.party[0].spriteFront = 'https://untrusted.invalid/x' },
  ]) {
    const changed = clone(valid)
    modify(changed)
    invalid(() => validateFactoryRankingSubmission(changed))
  }
  const emptyItem = clone(valid)
  emptyItem.party[0].heldItemId = ''
  assert.equal(validateFactoryRankingSubmission(emptyItem).party[0].heldItemId, '')
})

test('eleven authenticated players produce top ten by floor and keep out-of-board personal best', async () => {
  const env = environment()
  assert.deepEqual(await env.read(identity(0)), { entries: [], ownBest: null })
  for (let index = 1; index <= 11; index += 1) {
    env.setTime(1000000 + index)
    await env.submit(identity(index), report(index, `finished-run-${index}`))
  }
  const snapshot = await env.read(identity(1))
  assert.equal(snapshot.entries.length, 10)
  assert.deepEqual(snapshot.entries.map(entry => entry.floor), [11, 10, 9, 8, 7, 6, 5, 4, 3, 2])
  assert.equal(snapshot.ownBest.floor, 1)
  assert(!snapshot.entries.some(entry => entry.id === snapshot.ownBest.id))
  assert(snapshot.entries.every(entry => entry.trainerName === '도**'))
  const serialized = JSON.stringify(snapshot)
  assert(!serialized.includes('factory-ranking-user-'))
  assert(!serialized.includes('도전자'))
  assert(!serialized.includes('owner'))
  const database = await env.store.inspect()
  assert.deepEqual(Object.keys(database.collections).sort(), ['factoryPersonalBest', 'factoryRanking'])
  assert.equal(Object.keys(database.collections.factoryPersonalBest).length, 11)
  assert.equal(database.collections.factoryRanking.top10.entries.length, 10)
})

test('server acceptance times decide ties; same-floor retries preserve team, nickname, time and row ID', async () => {
  const env = environment()
  env.setTime(2000)
  const first = await env.submit(identity(1), report(5, 'first-original-run'))
  env.setTime(1000)
  const second = await env.submit(identity(2), report(5, 'second-original-run'))
  assert.equal(second.entries[0].id, first.ownBest.id)
  assert.equal(second.entries[1].recordedAt, 2000, 'clock rollback must not jump earlier accepted records')
  const original = clone(first.ownBest)
  env.setTime(9000)
  for (const value of [report(5, 'another-tied-run', 9), report(2, 'another-worse-run', 18), report(8, 'first-original-run', 33)]) {
    const retry = await env.submit({ ...identity(1), name: '변경된 이름' }, value)
    assert.deepEqual(retry.ownBest, original)
  }
  const improved = await env.submit(identity(1), report(7, 'strictly-better-run', 12))
  assert.equal(improved.ownBest.id, original.id)
  assert.equal(improved.ownBest.recordedAt, 9000)
  assert.equal(improved.entries.length, 2)
  assert.equal(improved.entries[0].floor, 7)
  assert.notDeepEqual(improved.ownBest.party, original.party)
})

test('concurrent submissions and retry are idempotent and response snapshots cannot mutate records', async () => {
  const env = environment()
  const value = report(4, 'concurrent-final-run')
  const results = await Promise.all(Array.from({ length: 8 }, () => env.submit(identity(1), value)))
  assert(results.every(result => JSON.stringify(result) === JSON.stringify(results[0])))
  results[0].ownBest.party[0].moves[0] = 'changed response'
  results[0].entries[0].floor = 9999
  value.party[0].moves[0] = 'changed request'
  const again = await env.read(identity(1))
  assert.equal(again.entries.length, 1)
  assert.equal(again.entries[0].floor, 4)
  assert(!again.ownBest.party[0].moves.includes('changed response'))
  assert(!again.ownBest.party[0].moves.includes('changed request'))
})

test('local helpers select strict improvements and stable top ten without mutating the input', () => {
  const old = { id: 'old', floor: 3, recordedAt: 5 }
  assert.equal(chooseFactoryPersonalBest(old, { floor: 3 }), old)
  assert.equal(chooseFactoryPersonalBest(old, { floor: 2 }), old)
  const better = { id: 'new', floor: 4, recordedAt: 8 }
  assert.equal(chooseFactoryPersonalBest(old, better), better)
  assert.equal(chooseFactoryPersonalBest(null, old), old)
  const values = Array.from({ length: 11 }, (_, index) => ({ id: index, floor: 3, recordedAt: 1000 }))
  assert.deepEqual(sortFactoryRankingEntries(values).map(entry => entry.id), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  assert.equal(values.length, 11)
})

function fakeFirestore() {
  const documents = new Map()
  const transactions = []
  return {
    documents, transactions,
    collection(name) { return { name, doc(id) { return { name, id } } } },
    async runTransaction(work) {
      let result
      // Firestore may replay the callback; discard the first draft to emulate
      // optimistic conflict retries without accepting new timestamps or IDs.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const writes = []
        const reads = []
        result = await work({
          async get(ref) {
            assert(ref.id, 'Factory leaderboard must never scan a collection')
            assert.equal(writes.length, 0, 'Firestore reads must precede writes')
            reads.push(`${ref.name}/${ref.id}`)
            const value = documents.get(`${ref.name}/${ref.id}`)
            return { exists: Boolean(value), data: () => clone(value) }
          },
          set(ref, value) { writes.push([`${ref.name}/${ref.id}`, clone(value)]) },
          delete() { throw new Error('Factory ranking must not delete rated records') },
        })
        assert.equal(reads.length, 2)
        assert(writes.length <= 2)
        transactions.push({ reads, writes })
        if (attempt === 1) for (const [key, value] of writes) documents.set(key, value)
      }
      return result
    },
  }
}

test('Firestore adapter stores bounded atomic board and personal-best documents across transaction retries', async () => {
  const firestore = fakeFirestore()
  const env = environment(createFirestoreRankedStore(firestore, { prefix: 'factoryValidation' }))
  const posted = await env.submit(identity(5), report(2, 'firestore-final-run'))
  const fetched = await env.read(identity(5))
  assert.deepEqual(fetched, posted)
  assert.equal(firestore.documents.size, 2)
  assert(firestore.transactions.every(transaction => transaction.reads.length === 2))
  assert.deepEqual(firestore.transactions[0].writes, firestore.transactions[1].writes)
  for (const document of firestore.documents.values()) assert.equal(typeof document.payload, 'string')
})

test('file store survives closing and reopening without losing the final-team snapshot', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'factory-ranking-validation-'))
  const filename = join(directory, 'store.json')
  let store
  try {
    store = await createFileRankedStore(filename)
    const saved = await environment(store).submit(identity(6), report(4, 'durable-final-run'))
    await store.close()
    store = await createFileRankedStore(filename)
    const read = await environment(store).read(identity(6))
    assert.deepEqual(read, saved)
  } finally {
    await store?.close()
    // Remove only the exact file created in the mkdtemp workspace.
    await rm(filename, { force: true })
    await rmdir(directory)
  }
})

test('authenticated HTTP routes protect leaderboard reads and report writes; payload identity is ignored', async () => {
  const env = environment()
  const handler = createRankedHttpHandler({ service: env.service, enabled: true, authenticate: async (_request, token) => {
    if (token !== 'valid-factory-token') throw Object.assign(new Error('expired'), { code: 'auth/id-token-expired' })
    return identity(9)
  } })
  const request = (action, body, token = 'valid-factory-token') => new Request(`http://127.0.0.1/api/ranked?action=${action}`, {
    method: body ? 'POST' : 'GET', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  assert.equal((await handler(request('factoryLeaderboard', null, ''))).status, 401)
  assert.equal((await handler(request('factoryLeaderboard', null, 'expired-factory-token'))).status, 401)
  assert.equal((await handler(request('reportFactoryRun'))).status, 405)
  const initial = await handler(request('factoryLeaderboard'))
  assert.equal(initial.status, 200)
  assert.deepEqual(await initial.json(), { entries: [], ownBest: null })
  const submitted = await handler(request('', { action: 'reportFactoryRun', report: report(4, 'http-final-record'), uid: 'forged-user', name: '위조이름' }))
  assert.equal(submitted.status, 200)
  const result = await submitted.json()
  assert.equal(result.ownBest.trainerName, '도**')
  assert.equal((await env.read({ uid: 'forged-user', name: '위조이름' })).ownBest, null)
  const invalidReport = report(4, 'invalid-http-record')
  invalidReport.party[0].heldItemId = 'not-real'
  assert.equal((await handler(request('', { action: 'reportFactoryRun', report: invalidReport }))).status, 400)
  assert.equal((await env.read(identity(9))).entries.length, 1)
})

let passed = 0
for (const { name, run } of tests) {
  await run()
  passed += 1
  console.log(`PASS ${name}`)
}
console.log(`Battle Factory ranking validation passed: ${passed}/${tests.length}`)
