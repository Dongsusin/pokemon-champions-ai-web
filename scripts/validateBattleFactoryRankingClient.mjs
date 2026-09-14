import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { resolveChromiumExecutable } from '../promo/scripts/browserRuntime.mjs'
import {
  createFactoryRankingClient, createFactoryRankingOutbox, createFactoryRankingSession,
  createLocalFactoryRankingClient, FACTORY_LOCAL_RANKINGS_KEY, FACTORY_RANKING_PENDING_LIMIT,
  normalizeFactoryRankingSnapshot,
} from '../src/battleFactoryRankingClient.js'
import { createFactoryRun, selectFactoryRentals, selectFactoryLead, beginFactoryBattle, resolveFactoryBattle } from '../src/data/battleFactory.js'
import { createFactoryRankingSubmission } from '../src/data/battleFactoryRanking.js'

// All HTTP calls in this suite use explicit fetch fixtures. Accidental external
// network access fails closed; neither accounts nor server rankings are changed.
const originalFetch = globalThis.fetch
globalThis.fetch = async () => { throw new Error('Factory ranking client tests forbid real network requests') }
class MemoryStorage {
  values = new Map()
  readError = null
  writeError = null
  writes = []
  getItem(key) { if (this.readError) throw this.readError; return this.values.get(key) ?? null }
  setItem(key, value) { if (this.writeError) throw this.writeError; this.values.set(key, String(value)); this.writes.push({ key, value: String(value) }) }
}
const pendingKey = (uid = 'alice', scope = 'global') => `champions-factory-outbox-v1-${scope}:${encodeURIComponent(uid)}`
const pending = (storage, uid = 'alice', scope = 'global') => JSON.parse(storage.getItem(pendingKey(uid, scope)) ?? '{"pending":[],"completed":[]}')
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const seed = createFactoryRun({ seed: 42, id: 'factory-client-base' })
const ready = selectFactoryRentals(seed, seed.offers.slice(0, 3).map(pokemon => pokemon.captureId))
const battle = beginFactoryBattle(selectFactoryLead(ready, ready.party[0].captureId))
const base = resolveFactoryBattle(battle, { battleId: battle.battleId, winner: 'opponent', forfeited: true })
function finishedRun(id = 'factory-client-run-1', floor = 1) {
  return { ...structuredClone(base), id, floor, wins: floor - 1, battleId: `${id}:floor:${floor}`,
    lastResult: { ...base.lastResult, battleId: `${id}:floor:${floor}`, floor } }
}
const report = (id, floor) => createFactoryRankingSubmission(finishedRun(id, floor))
const entry = (value = report(), id = 'alice', recordedAt = 1000) => ({ id, runId: value.runId,
  trainerName: '테**', floor: value.floor, wins: value.wins, party: structuredClone(value.party), recordedAt })
const snapshot = value => value ? { entries: [value], ownBest: value } : { entries: [], ownBest: null }
const tests = []
const test = (name, run) => tests.push({ name, run })

test('factory leaderboard GET and compact report POST use fresh credentials and a stable run identity', async () => {
  let credentials = 0
  const requests = []
  const value = report('factory-client-http', 4)
  const client = createFactoryRankingClient({ uid: 'alice', getIdToken: async () => `fresh-${++credentials}`,
    fetchImpl: async (url, options) => {
      requests.push({ url, ...options })
      return Response.json(snapshot(options.method === 'POST' ? entry(value) : null))
    } })
  assert.deepEqual(await client.read(), snapshot())
  assert.equal((await client.report(value)).ownBest.floor, 4)
  assert.equal(requests[0].method, 'GET')
  assert.equal(new URL(requests[0].url).searchParams.get('action'), 'factoryLeaderboard')
  assert.equal(requests[0].body, undefined)
  assert.equal(requests[1].method, 'POST')
  assert.equal(requests[0].headers.Authorization, 'Bearer fresh-1')
  assert.equal(requests[1].headers.Authorization, 'Bearer fresh-2')
  const submitted = JSON.parse(requests[1].body)
  assert.deepEqual(submitted.report, value)
  assert.equal(submitted.action, 'reportFactoryRun')
  assert.match(submitted.requestId, /^[a-zA-Z0-9_-]{8,128}$/)
  assert.equal(requests[1].redirect, 'error')
})

test('local test credentials require every dev, factory mode, flag and loopback guard', async () => {
  const url = new URL('../src/battleFactoryRankingClient.js', import.meta.url)
  const source = await readFile(url, 'utf8')
  const originalWindow = globalThis.window
  let sequence = 0
  async function inspect(env, hostname = '127.0.0.1', endpoint = 'http://127.0.0.1:8789/api/ranked') {
    globalThis.window = { location: { hostname } }
    const code = source.replace("import { createRankedClient, rankedApiUrl } from './rankedClient.js'",
      `import { createRankedClient } from '${new URL('../src/rankedClient.js', import.meta.url).href}';const rankedApiUrl=${JSON.stringify(endpoint)};`)
      .replace(/from '(\.\/[^']+)'/g, (_, specifier) => `from '${new URL(specifier, url).href}'`)
      .replace('const env = import.meta.env ?? {}', `const env = ${JSON.stringify(env)}`)
    return import(`data:text/javascript;base64,${Buffer.from(`${code}\n// guard ${sequence++}`).toString('base64')}`)
  }
  try {
    const flags = { DEV: true, MODE: 'factory-test', VITE_FACTORY_LOCAL_TEST: 'true' }
    const local = await inspect(flags)
    assert.equal(local.isFactoryRankingLocalTest, true)
    for (const [uid, token] of [['factory-local', 'alice'], ['factory-local-b', 'bob']]) {
      let observed
      await local.createFactoryRankingClient({ uid, fetchImpl: async (_url, options) => { observed = options.headers.Authorization; return Response.json(snapshot()) } }).read()
      assert.equal(observed, `Bearer ranked-test-${token}`)
    }
    assert.throws(() => local.createFactoryRankingClient({ uid: 'not-a-test-user' }), /테스트 계정/)
    assert.throws(() => local.createFactoryRankingClient({ uid: 'factory-local', apiUrl: 'https://example.com/api/ranked' }), /로컬 서버/)
    for (const args of [
      [{ ...flags, DEV: false }], [{ ...flags, MODE: 'production' }], [{ ...flags, MODE: 'ranked-test' }],
      [{ ...flags, VITE_FACTORY_LOCAL_TEST: 'false' }], [flags, 'example.com'],
      [flags, '127.0.0.1', 'https://example.com/api/ranked'],
    ]) assert.equal((await inspect(...args)).isFactoryRankingLocalTest, false)
  } finally {
    if (originalWindow === undefined) delete globalThis.window
    else globalThis.window = originalWindow
  }
})

test('durable enqueue precedes transmission, isolates mutation and deduplicates concurrent flushes', async () => {
  const storage = new MemoryStorage()
  const response = deferred()
  const snapshots = []
  let calls = 0
  const value = report('factory-client-queued', 2)
  const outbox = createFactoryRankingOutbox({ uid: 'alice', storage, onSnapshot: state => snapshots.push(state),
    send: async (saved, signal) => {
      calls++
      assert.deepEqual(pending(storage).pending, [value])
      assert.deepEqual(saved, value)
      assert.equal(signal.aborted, false)
      return response.promise
    } })
  const input = structuredClone(value)
  assert(outbox.enqueue(input))
  input.party[0].moves.length = 0
  input.floor = 99
  assert(outbox.enqueue(value))
  assert.equal(calls, 0)
  const first = outbox.flush()
  assert.equal(outbox.flush(), first)
  response.resolve(snapshot(entry(value)))
  await first
  assert.equal(calls, 1)
  assert.equal(pending(storage).pending.length, 0)
  assert.deepEqual(pending(storage).completed, [value.runId])
  assert.equal(snapshots.length, 1)
  outbox.stop()
  const remounted = createFactoryRankingOutbox({ uid: 'alice', storage, send: async () => { throw new Error('A successful run must not be resent after a StrictMode/remount replay') } })
  assert(remounted.enqueue(value))
  await remounted.flush()
  remounted.stop()
})

test('an ambiguous response is retried after reload with the same ID and never duplicates a server receipt', async () => {
  const storage = new MemoryStorage()
  const receipts = new Set()
  let calls = 0
  const value = report('factory-client-lost', 3)
  const send = async saved => {
    receipts.add(saved.runId)
    if (++calls === 1) throw new Error('response lost after commit')
    return snapshot(entry(saved))
  }
  const original = createFactoryRankingOutbox({ uid: 'alice', storage, send })
  original.enqueue(value)
  await assert.rejects(original.flush(), /response lost/)
  original.stop()
  assert.deepEqual(pending(storage).pending, [value])
  const reloaded = createFactoryRankingOutbox({ uid: 'alice', storage, send })
  await reloaded.flush()
  assert.equal(calls, 2)
  assert.equal(receipts.size, 1)
  assert.equal(pending(storage).pending.length, 0)
  reloaded.stop()
})

test('pending queues are isolated per account and scope and capped without deleting unsent runs', async () => {
  const storage = new MemoryStorage()
  const make = (uid, scope) => createFactoryRankingOutbox({ uid, scope, storage, send: async value => snapshot(entry(value, uid)) })
  const alice = make('alice', 'global'), bob = make('bob', 'global'), local = make('alice', 'test')
  for (let index = 0; index < FACTORY_RANKING_PENDING_LIMIT; index++) alice.enqueue(report(`factory-queued-${index}`))
  assert.throws(() => alice.enqueue(report('factory-queue-overflow')), /가득/)
  bob.enqueue(report('factory-bob-queued'))
  local.enqueue(report('factory-local-queued'))
  assert.equal(pending(storage).pending.length, FACTORY_RANKING_PENDING_LIMIT)
  await bob.flush()
  assert.equal(pending(storage, 'bob').pending.length, 0)
  assert.equal(pending(storage).pending.length, FACTORY_RANKING_PENDING_LIMIT)
  assert.equal(pending(storage, 'alice', 'test').pending.length, 1)
  alice.stop(); bob.stop(); local.stop()
})

test('stopped and switched identities ignore delayed results and retain their own pending report', async () => {
  for (const mode of ['stop', 'switch']) {
    const storage = new MemoryStorage(), response = deferred(), observed = []
    let activeUid = 'alice', signal
    const value = report(`factory-stale-${mode}`, 6)
    const outbox = createFactoryRankingOutbox({ uid: 'alice', storage, isCurrent: () => activeUid === 'alice',
      onSnapshot: result => observed.push(result), send: async (_value, supplied) => { signal = supplied; return response.promise } })
    outbox.enqueue(value)
    const flushing = outbox.flush()
    if (mode === 'stop') { outbox.stop(); assert.equal(signal.aborted, true) }
    else activeUid = 'bob'
    response.resolve(snapshot(entry(value)))
    await flushing
    assert.deepEqual(observed, [])
    assert.deepEqual(pending(storage).pending, [value])
    assert.equal(storage.getItem(pendingKey('bob')), null)
    outbox.stop()
  }
})

test('a report added during an in-flight request is preserved and sent next', async () => {
  const storage = new MemoryStorage(), response = deferred(), sent = []
  const first = report('factory-inflight-first'), second = report('factory-inflight-next', 2)
  const outbox = createFactoryRankingOutbox({ uid: 'alice', storage, send: async value => {
    sent.push(value.runId)
    return sent.length === 1 ? response.promise : snapshot(entry(value))
  } })
  outbox.enqueue(first)
  const flushing = outbox.flush()
  outbox.enqueue(second)
  response.resolve(snapshot(entry(first)))
  await flushing
  assert.deepEqual(sent, [first.runId, second.runId])
  assert.equal(pending(storage).pending.length, 0)
  outbox.stop()
})

test('guest personal best survives reload, keeps first tied record and sorts only the top ten', async () => {
  const storage = new MemoryStorage()
  const guest = createLocalFactoryRankingClient({ uid: 'guest', trainerName: '홍길동', storage, now: () => 100 })
  await guest.report(report('factory-guest-best', 9))
  for (const [id, floor] of [['factory-guest-lower', 3], ['factory-guest-tie', 9]]) await guest.report(report(id, floor))
  assert.equal((await guest.read()).ownBest.runId, 'factory-guest-best')
  await guest.report(report('factory-guest-higher', 10))
  const reload = createLocalFactoryRankingClient({ uid: 'guest', trainerName: '변경된 이름', storage, now: () => 200 })
  assert.equal((await reload.read()).ownBest.floor, 10)
  assert.equal((await reload.read()).ownBest.trainerName, '홍**')
  for (let index = 0; index < 12; index++) {
    await createLocalFactoryRankingClient({ uid: `guest-${index}`, trainerName: '동일 이름', storage, now: () => 300 + index })
      .report(report(`factory-guest-other-${index}`, 11 + index))
  }
  const read = await reload.read()
  assert.equal(read.entries.length, 10)
  assert.deepEqual(read.entries.map(value => value.floor), [22, 21, 20, 19, 18, 17, 16, 15, 14, 13])
  assert.equal(read.ownBest.floor, 10, 'Personal best must remain available even outside the public top ten')
  assert.equal(JSON.parse(storage.getItem(FACTORY_LOCAL_RANKINGS_KEY)).length, 13)
})

test('equal-time local ties retain their order without rewriting a worse or repeated personal best', async () => {
  const storage = new MemoryStorage()
  const first = createLocalFactoryRankingClient({ uid: 'first', trainerName: '가나다', storage, now: () => 100 })
  const second = createLocalFactoryRankingClient({ uid: 'second', trainerName: '라마바', storage, now: () => 100 })
  await first.report(report('factory-first-tied', 4))
  await second.report(report('factory-second-tied', 4))
  const before = storage.getItem(FACTORY_LOCAL_RANKINGS_KEY), writes = storage.writes.length
  await first.report(report('factory-first-lower', 2))
  await first.report(report('factory-first-again', 4))
  assert.equal(storage.getItem(FACTORY_LOCAL_RANKINGS_KEY), before)
  assert.equal(storage.writes.length, writes)
  assert.deepEqual((await first.read()).entries.map(value => value.id), ['local:first', 'local:second'])
})

test('session saves terminal runs once, reports failures without throwing, and retries failed storage', async () => {
  const storage = new MemoryStorage(), errors = [], snapshots = []
  let sends = 0
  const session = createFactoryRankingSession({ uid: 'alice', storage,
    onRecordError: value => errors.push(value), onSnapshot: value => snapshots.push(value),
    client: { report: async value => { sends++; return snapshot(entry(value)) }, read: async () => snapshot() } })
  assert.equal(session.recordRun({ ...finishedRun(), phase: 'ready' }), false)
  assert.equal(sends, 0)
  storage.writeError = new Error('quota unavailable')
  assert.equal(session.recordRun(finishedRun()), false)
  assert.equal(sends, 0)
  assert.match(errors.at(-1), /quota/)
  storage.writeError = null
  await session.retry()
  assert.equal(sends, 1)
  assert.equal(pending(storage).pending.length, 0)
  assert(session.recordRun(finishedRun()))
  await session.flush()
  assert.equal(sends, 1)
  assert(snapshots.length > 0)
  session.stop()
})

test('a slow leaderboard read cannot replace a newer report response, and stale account callbacks are suppressed', async () => {
  const storage = new MemoryStorage(), delayed = deferred(), received = [], readStarted = deferred()
  let activeUid = 'alice'
  const session = createFactoryRankingSession({ uid: 'alice', storage, isCurrent: () => activeUid === 'alice',
    onSnapshot: value => received.push(value),
    client: { read: async () => { readStarted.resolve(); return delayed.promise }, report: async value => snapshot(entry(value)) } })
  const refresh = session.refresh()
  await readStarted.promise
  assert(session.recordRun(finishedRun('factory-newer-report', 8)))
  await session.flush()
  delayed.resolve(snapshot())
  await refresh
  assert.equal(received.at(-1).ownBest.floor, 8)
  activeUid = 'bob'
  assert.equal(session.recordRun(finishedRun('factory-wrong-account', 9)), false)
  await session.refresh()
  assert.equal(received.length, 1)
  session.stop()
})

test('malformed server data and storage failures preserve the pending record for a retry', async () => {
  const storage = new MemoryStorage()
  const value = report('factory-invalid-response')
  const outbox = createFactoryRankingOutbox({ uid: 'alice', storage, send: async () => ({ entries: 'broken', ownBest: null }) })
  outbox.enqueue(value)
  await assert.rejects(outbox.flush(), /순위 응답/)
  assert.deepEqual(pending(storage).pending, [value])
  outbox.stop()
  assert.throws(() => normalizeFactoryRankingSnapshot({ entries: [], ownBest: {} }), /순위 응답/)
  storage.readError = new Error('storage access denied')
  const broken = createFactoryRankingOutbox({ uid: 'alice', storage, send: async () => snapshot() })
  assert.throws(() => broken.enqueue(value), /storage access denied/)
  broken.stop()
})

test('actual React hook recovers failed initialization through refresh and retry without loops or cross-account records', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url))
  const entrySource = `import React,{StrictMode,useEffect,useState}from'react';import{createRoot}from'react-dom/client';import useBattleFactoryRankings from'/src/useBattleFactoryRankings.js';
function Harness(){const[uid,setUid]=useState('hook-alice');const[nickname,setNickname]=useState('');window.__setNickname=setNickname;window.__activeUid=uid;const ranking=useBattleFactoryRankings({uid,displayName:uid,nickname,isLocalGuest:window.__guest});
window.__ranking=ranking;window.__changeUid=setUid;window.__callbackIdentities??=[];if(!window.__callbackIdentities.includes(ranking.recordRun))window.__callbackIdentities.push(ranking.recordRun);
useEffect(()=>{if(window.__runFixture)ranking.recordRun(window.__runFixture)},[ranking.recordRun]);return React.createElement('output',null,JSON.stringify({uid,source:ranking.source,ownBest:ranking.ownBest,error:ranking.error,recordError:ranking.recordError}))}
createRoot(document.getElementById('root')).render(React.createElement(StrictMode,null,React.createElement(Harness)));`
  const server = await createServer({ root, mode: 'factory-ranking-hook-test', logLevel: 'error',
    define: { 'import.meta.env.VITE_RANKED_ENABLED': JSON.stringify('true'), 'import.meta.env.VITE_RANKED_API_URL': JSON.stringify('/api/ranked') },
    plugins: [{ name: 'factory-ranking-hook-entry', enforce: 'pre',
      resolveId(source) {
        if (source === '/factory-ranking-hook-entry.js') return source
        if (/\/auth\/firebaseClient(?:\.js)?$/.test(source)) return '\0factory-ranking-offline-auth'
      },
      load(id) {
        if (id === '/factory-ranking-hook-entry.js') return entrySource
        if (id === '\0factory-ranking-offline-auth') return 'export const firebaseAuth={get currentUser(){return{uid:window.__activeUid,getIdToken:async()=>"hook-fixture-token"}}};'
      },
    }], server: { host: '127.0.0.1', port: 0, hmr: false } })
  const require = createRequire(new URL('../promo/package.json', import.meta.url))
  const { chromium } = require('playwright')
  let browser
  try {
    await server.listen()
    const port = server.httpServer.address().port
    browser = await chromium.launch({ headless: true, executablePath: await resolveChromiumExecutable(chromium) })
    const html = await server.transformIndexHtml('/factory-ranking-hook.html', '<!doctype html><html><body><div id="root"></div><script type="module" src="/factory-ranking-hook-entry.js"></script></body></html>')
    for (const scenario of [{ guest: true, action: 'retry' }, { guest: true, action: 'refresh' }, { guest: false, action: 'refresh' }]) {
      const page = await browser.newPage()
      const errors = [], denied = [], requests = []
      let publicNickname = ''
      page.on('pageerror', error => errors.push(error.message))
      await page.addInitScript(({ run, guest }) => {
        const realStorage = window.localStorage
        realStorage.clear()
        window.__runFixture = run
        window.__guest = guest
        window.__blockedStorage = true
        window.__storageAttempts = 0
        Object.defineProperty(window, 'localStorage', { configurable: true, get() {
          window.__storageAttempts++
          if (window.__blockedStorage) throw new Error('fixture: storage unavailable during initialization')
          return realStorage
        } })
      }, { run: scenario.guest ? finishedRun('factory-hook-recovery', 5) : null, guest: scenario.guest })
      await page.route('**/*', route => {
        const url = new URL(route.request().url())
        if (url.hostname === '127.0.0.1' && url.pathname === '/api/ranked'
          && !scenario.guest && url.searchParams.get('action') === 'factoryLeaderboard') {
          requests.push(route.request().method())
          return route.fulfill({ contentType: 'application/json', body: JSON.stringify(snapshot({ ...entry(report('factory-hook-global', 7)),
            ...(publicNickname ? { trainerName: publicNickname } : {}) })) })
        }
        if (url.hostname !== '127.0.0.1' || url.pathname.startsWith('/api/')) {
          denied.push(url.href)
          return route.abort('blockedbyclient')
        }
        return route.continue()
      })
      await page.route('**/factory-ranking-hook.html', route => route.fulfill({ contentType: 'text/html', body: html }))
      await page.goto(`http://127.0.0.1:${port}/factory-ranking-hook.html`)
      await page.waitForFunction(() => Boolean(window.__ranking?.error))
      if (scenario.guest) assert(await page.evaluate(() => Boolean(window.__ranking.recordError)))
      const initialAttempts = await page.evaluate(() => window.__storageAttempts)
      await page.evaluate(async action => { await window.__ranking[action]() }, scenario.action)
      await page.waitForFunction(count => window.__storageAttempts > count && Boolean(window.__ranking.error), initialAttempts)
      const failedAttempts = await page.evaluate(() => window.__storageAttempts)
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      assert.equal(await page.evaluate(() => window.__storageAttempts), failedAttempts, 'Failed initialization must wait for user retry instead of looping')
      if (scenario.guest && scenario.action === 'refresh') {
        // The completed Alice run has not reached storage yet. A different
        // account recovering storage must not inherit that in-memory report.
        await page.evaluate(() => window.__changeUid('hook-bob'))
        await page.waitForFunction(() => JSON.parse(document.querySelector('output').textContent).uid === 'hook-bob' && Boolean(window.__ranking.error))
        await page.evaluate(async () => { window.__blockedStorage = false; await window.__ranking.refresh() })
        await page.waitForFunction(() => !window.__ranking.error && !window.__ranking.loading)
        assert.equal(await page.evaluate(() => window.__ranking.ownBest), null)
        assert.equal(await page.evaluate(() => localStorage.getItem('champions-factory-outbox-v1-guest:hook-bob')), null)
        await page.evaluate(() => window.__changeUid('hook-alice'))
      }
      await page.evaluate(async action => { window.__blockedStorage = false; await window.__ranking[action]() }, scenario.action)
      const expectedId = scenario.guest ? 'factory-hook-recovery' : 'factory-hook-global'
      await page.waitForFunction(id => window.__ranking?.ownBest?.runId === id, expectedId)
      assert.equal(await page.evaluate(() => window.__callbackIdentities.length), 1)
      assert.equal(await page.evaluate(() => window.__ranking.source), scenario.guest ? 'local' : 'global')
      assert.equal(await page.evaluate(() => window.__ranking.recordError), '')
      assert.equal(await page.evaluate(() => window.__ranking.error), '')
      if (!scenario.guest) {
        const beforeRenameReads = requests.length
        publicNickname = '팩토리새별명'
        await page.evaluate(() => window.__setNickname('팩토리새별명'))
        await page.waitForFunction(() => window.__ranking.ownBest?.trainerName === '팩토리새별명')
        assert.equal(requests.length, beforeRenameReads + 1, 'Nickname changes refresh the existing ranking session once')
        assert.equal(await page.evaluate(() => window.__callbackIdentities.length), 1, 'Renaming must not restart run recording')
        assert.equal(await page.evaluate(() => window.__ranking.ownBest.floor), 7)
      }
      if (scenario.guest) {
        await page.evaluate(() => window.__changeUid('hook-bob'))
        await page.waitForFunction(() => JSON.parse(document.querySelector('output').textContent).uid === 'hook-bob')
        assert.equal(await page.evaluate(() => window.__ranking.ownBest), null)
        assert.equal(await page.evaluate(() => localStorage.getItem('champions-factory-outbox-v1-guest:hook-bob')), null)
        await page.evaluate(() => window.__changeUid('hook-alice'))
        await page.waitForFunction(() => window.__ranking?.ownBest?.runId === 'factory-hook-recovery')
        const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('champions-factory-outbox-v1-guest:hook-alice')))
        assert.equal(saved.pending.length, 0)
        assert.deepEqual(saved.completed, ['factory-hook-recovery'])
      } else {
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
        assert.deepEqual(requests, ['GET', 'GET'], 'Recovery and one confirmed rename each refresh once, without background polling')
      }
      assert.deepEqual(errors, [])
      assert.deepEqual(denied, [])
      await page.close()
    }
  } finally {
    await browser?.close()
    await server.close()
  }
})

let failures = 0
try {
  for (const { name, run } of tests) {
    try { await run(); await nextTurn(); console.log(`PASS ${name}`) }
    catch (error) { failures++; console.error(`FAIL ${name}: ${error.stack}`) }
  }
} finally { globalThis.fetch = originalFetch }
console.log(`Factory ranking client validation: ${tests.length - failures}/${tests.length} checks passed`)
if (failures) process.exitCode = 1
