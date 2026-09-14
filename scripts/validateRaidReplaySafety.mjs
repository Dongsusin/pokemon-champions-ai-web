import assert from 'node:assert/strict'
import test from 'node:test'
import { createMemoryRankedStore } from '../server/rankedStore.js'
import { createRaidService } from '../server/raidService.js'
import { createRaidHttpHandler } from '../server/raidHttp.js'
import * as realEngine from '../server/raidBattle.js'
import { getLearnableMoves, getMoveById, normalizePokemon } from '../src/data/trainingData.js'

// Local fault injection is limited to persisted version markers and barriers
// around the actual pure engine. There are no production calls, fake engine
// outcomes, modified HP/stats, or test-only production commands.
const clone = value => structuredClone(value)
const readActions = new Set(['status', 'catalog', 'rooms', 'raidList'])
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }

async function fixture({ humans = 1, engine = realEngine } = {}) {
  let time = 1_000_000, serial = 0, seedSerial = 0
  const store = createMemoryRankedStore()
  const identities = Array.from({ length: humans }, (_, index) => ({ uid: `replay-owner-${index}`, name: `검증트레이너${index}`, isGuest: false }))
  const moveIds = ['crunch', 'stoneedge', 'icepunch', 'dragondance']
  const legal = new Set(getLearnableMoves(248).map(move => move.id))
  moveIds.forEach(id => assert(legal.has(id), `Illegal fixture move: ${id}`))
  const owned = new Map(identities.map((identity, index) => [identity.uid, normalizePokemon({
    speciesId: 248, captureId: `replay-owned-${index}`, moves: moveIds.map(id => getMoveById(id).name),
  })]))
  const options = { store, engine, now: () => time, newId: () => `replay-server-${++serial}`, makeSeed: () => `locked-seed-${++seedSerial}`,
    resolvePokemon: async (identity, selection) => {
      const pokemon = owned.get(identity.uid)
      assert.equal(selection.captureId, pokemon?.captureId, 'Fixture must select the authenticated owner\'s actual Pokémon')
      return clone(pokemon)
    },
  }
  const service = createRaidService(options)
  const http = createRaidHttpHandler({ service, enabled: true, now: options.now, authenticate: async (_request, token) => {
    const index = identities.findIndex((_, i) => token === `replay-bearer-${i}`)
    assert(index >= 0, 'Unexpected fixture bearer')
    return identities[index]
  } })
  const nextRequestId = () => `replay-request-${++serial}`
  const command = (action, payload = {}) => ({ action, ...(readActions.has(action) ? {} : { requestId: nextRequestId() }), ...payload })
  const call = (index, action, payload = {}) => service.execute(identities[index], command(action, payload))
  const rawHttp = async (index, action, payload = {}) => {
    const read = readActions.has(action)
    const url = new URL('https://raid.example.test/api/raid')
    if (read) for (const [key, value] of Object.entries({ action, ...payload })) url.searchParams.set(key, String(value))
    return http(new Request(url, { method: read ? 'GET' : 'POST', headers: {
      Authorization: `Bearer replay-bearer-${index}`, 'Content-Type': 'application/json',
    }, ...(read ? {} : { body: JSON.stringify(command(action, payload)) }) }))
  }
  let view = await call(0, 'roomCreate', { bossId: 'mewtwo', visibility: 'public', title: '재시도 안전성 검증' })
  const roomId = view.room.id
  for (let index = 1; index < humans; index++) {
    view = await call(index, 'status')
    view = await call(index, 'roomJoin', { roomId, roomRevision: view.rooms.find(room => room.id === roomId).roomRevision })
  }
  for (let index = 0; index < humans; index++) {
    view = await call(index, 'status')
    await call(index, 'roomReady', { roomId, roomRevision: view.room.roomRevision, ready: true, pokemon: { captureId: owned.get(identities[index].uid).captureId } })
  }
  view = await call(0, 'status')
  view = await call(0, 'roomStart', { roomId, roomRevision: view.room.roomRevision })
  const raidId = view.raid.id
  const readRun = () => store.transaction(tx => tx.get('raidRuns', raidId))
  const firstCommand = realEngine.chooseRaidCommand((await readRun()).battle, identities[0].uid, { seed: 'legal-human-command' })
  assert(firstCommand)
  return { store, service, options, identities, view, raidId, roomId, call, rawHttp, command, readRun, firstCommand,
    advance: milliseconds => { time += milliseconds }, now: () => time }
}

for (const layer of ['outer', 'inner']) for (const field of ['schemaVersion', 'engineVersion', 'ruleVersion']) {
  test(`${layer} future ${field}: actual GET, withdraw and advance reject without modifying any record`, async () => {
    const f = await fixture()
    await f.store.transaction(async tx => {
      const run = await tx.get('raidRuns', f.raidId)
      const versioned = layer === 'outer' ? run : run.battle.raid
      versioned[field] += 1
      tx.set('raidRuns', f.raidId, run)
      // An outer-version snapshot and its matching compact header are written
      // together in production. Exercise both full and compact read paths.
      if (layer === 'outer') {
        const head = await tx.get('raidRunHeads', f.raidId)
        if (head) { head[field] = versioned[field]; tx.set('raidRunHeads', f.raidId, head) }
      }
    })
    const before = await f.store.inspect()
    const operations = [
      ['status', { raidId: f.raidId }],
      ...(layer === 'outer' ? [['status', { raidId: f.raidId, revision: f.view.raid.revision, eventCursor: f.view.raid.eventCursor }]] : []),
      ['raidWithdraw', { raidId: f.raidId }],
      ['raidAdvance', { raidId: f.raidId, decisionToken: f.view.raid.decisionToken }],
    ]
    for (const [action, payload] of operations) {
      const response = await f.rawHttp(0, action, payload)
      const body = await response.json()
      assert.equal(response.status, 409, `${layer}.${field} ${action}: ${JSON.stringify(body)}`)
      assert.equal(body.error?.code, 'RAID_VERSION_UNSUPPORTED')
      assert.deepEqual(await f.store.inspect(), before, `${action} must preserve the entire unsupported save, pointers and rewards`)
    }
  })
}

test('a completed request replay is read-only after the next deadline, while a fresh stale-token command is rejected', async () => {
  const f = await fixture()
  const original = f.command('raidSubmit', { raidId: f.raidId, decisionToken: f.view.raid.decisionToken, commandVersion: 1, command: f.firstCommand })
  const resolved = await f.service.execute(f.identities[0], original)
  assert.equal(resolved.raid.turnNumber, f.view.raid.turnNumber + 1)
  f.advance(46_000)
  const before = await f.store.inspect()
  await assert.rejects(f.call(0, 'raidSubmit', { ...original, requestId: 'fresh-stale-token-request' }), { code: 'STALE_DECISION' })
  assert.deepEqual(await f.store.inspect(), before)
  const replayed = await f.service.execute(f.identities[0], original)
  assert.equal(replayed.raid.turnNumber, resolved.raid.turnNumber, 'An old acknowledged request must not auto-play the next turn')
  assert.deepEqual(await f.store.inspect(), before, 'Retrying a completed request must not change presence, pointers, queues, events or gameplay')
})

test('active resolution leases prevent duplicate calculation; expired takeover retains locked inputs and rejects the old worker commit', async () => {
  const firstStarted = deferred(), firstGate = deferred(), takeoverStarted = deferred(), takeoverGate = deferred()
  const calls = []
  let holdTakeover = false, originalRequest, takeoverRequest
  const engine = { ...realEngine, resolveRaidTurn: async (...args) => {
    const index = calls.length
    calls.push(clone(args))
    if (index === 0) { firstStarted.resolve(); await firstGate.promise }
    if (index === 1 && holdTakeover) { takeoverStarted.resolve(); await takeoverGate.promise }
    return realEngine.resolveRaidTurn(...args)
  } }
  const f = await fixture({ engine })
  const initialRun = await f.readRun()
  try {
    originalRequest = f.call(0, 'raidSubmit', { raidId: f.raidId, decisionToken: f.view.raid.decisionToken, commandVersion: 1, command: f.firstCommand })
    await firstStarted.promise
    const firstClaim = await f.readRun()
    assert.equal(firstClaim.lifecycle, 'resolving')
    assert(firstClaim.resolution.leaseUntil > f.now())
    const restarted = createRaidService(f.options)
    await restarted.execute(f.identities[0], f.command('raidAdvance', { raidId: f.raidId, decisionToken: f.view.raid.decisionToken }))
    assert.equal(calls.length, 1, 'A still-valid lease must not launch a second engine calculation')
    assert.equal((await f.readRun()).resolution.id, firstClaim.resolution.id)

    f.advance(21_000)
    holdTakeover = true
    takeoverRequest = restarted.execute(f.identities[0], f.command('raidAdvance', { raidId: f.raidId, decisionToken: f.view.raid.decisionToken }))
    await takeoverStarted.promise
    const taken = await f.readRun()
    assert.equal(calls.length, 2)
    assert.notEqual(taken.resolution.id, firstClaim.resolution.id, 'Takeover must fence the old worker with a new claim ID')
    assert.equal(taken.resolution.seed, firstClaim.resolution.seed)
    assert.deepEqual(taken.resolution.commands, firstClaim.resolution.commands)
    assert.equal(taken.resolution.baseRevision, firstClaim.resolution.baseRevision)
    assert.deepEqual(calls[1], calls[0], 'A restarted worker must execute exactly the persisted battle, commands and seed')

    // Finish the old worker before its replacement. A merely lifecycle-based
    // CAS would let it commit here; the new resolution ID must reject it.
    const beforeOldCompletion = await f.store.inspect()
    firstGate.resolve()
    await originalRequest
    assert.deepEqual(await f.store.inspect(), beforeOldCompletion, 'The old worker cannot commit during its replacement lease')
    assert.equal((await f.readRun()).turnNumber, initialRun.turnNumber)
    takeoverGate.resolve()
    await takeoverRequest
    const final = await f.readRun()
    assert.equal(final.turnNumber, initialRun.turnNumber + 1)
    assert.equal(final.lifecycle, 'input')
    assert.equal(final.resolution, null)
    assert.deepEqual(final.battle, realEngine.resolveRaidTurn(...calls[0]))
    const after = await f.store.inspect()
    await f.call(0, 'status')
    assert.deepEqual(await f.store.inspect(), after)
  } finally {
    firstGate.resolve()
    takeoverGate.resolve()
    await Promise.allSettled([originalRequest, takeoverRequest].filter(Boolean))
  }
})

test('pending command deduplication, revoked versions, delayed revokes and version gaps cannot duplicate a turn', async () => {
  const f = await fixture({ humans: 2 })
  const fields = { raidId: f.raidId, decisionToken: f.view.raid.decisionToken, commandVersion: 1, command: f.firstCommand }
  await f.call(0, 'raidSubmit', fields)
  await f.call(0, 'raidSubmit', fields)
  let stored = await f.readRun()
  assert.equal(stored.turnNumber, f.view.raid.turnNumber)
  assert.equal(Object.keys(stored.commands).length, 1)
  assert.equal(stored.commandVersions[f.identities[0].uid], 1)
  await f.call(0, 'raidRevoke', { raidId: f.raidId, decisionToken: fields.decisionToken, commandVersion: 1 })
  const afterRevoke = await f.store.inspect()
  await assert.rejects(f.call(0, 'raidSubmit', fields), { code: 'STALE_COMMAND_VERSION' })
  assert.deepEqual(await f.store.inspect(), afterRevoke)
  await f.call(0, 'raidSubmit', { ...fields, commandVersion: 2 })
  const beforeRejectedCommands = await f.store.inspect()
  await assert.rejects(f.call(0, 'raidRevoke', { raidId: f.raidId, decisionToken: fields.decisionToken, commandVersion: 1 }), { code: 'STALE_COMMAND_VERSION' })
  assert.deepEqual(await f.store.inspect(), beforeRejectedCommands)
  await assert.rejects(f.call(0, 'raidSubmit', { ...fields, commandVersion: 4 }), { code: 'COMMAND_VERSION_GAP' })
  assert.deepEqual(await f.store.inspect(), beforeRejectedCommands)
  stored = await f.readRun()
  assert.equal(stored.turnNumber, f.view.raid.turnNumber)
  assert.equal(Object.keys(stored.commands).length, 1)
})
