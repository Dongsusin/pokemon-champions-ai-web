import assert from 'node:assert/strict'
import test from 'node:test'
import { createMemoryRankedStore } from '../server/rankedStore.js'
import { createRaidService } from '../server/raidService.js'
import * as engine from '../server/raidBattle.js'
import { getMoveById, normalizePokemon } from '../src/data/trainingData.js'

const clone = value => structuredClone(value)

function countedStore(base, counters) {
  return {
    transaction(work) {
      return base.transaction(async tx => work({
        get: async (collection, key) => {
          counters.get[collection] = (counters.get[collection] ?? 0) + 1
          return tx.get(collection, key)
        },
        list: async collection => {
          counters.list[collection] = (counters.list[collection] ?? 0) + 1
          return tx.list(collection)
        },
        set: (...args) => tx.set(...args),
        delete: (...args) => tx.delete(...args),
      }))
    },
    inspect: () => base.inspect(),
  }
}

async function fixture() {
  let timestamp = 1_000_000
  let serial = 0
  const base = createMemoryRankedStore()
  const counters = { get: {}, list: {} }
  const store = countedStore(base, counters)
  const owners = [
    { uid: 'poll-owner-a', name: '폴링검증A', isGuest: false },
    { uid: 'poll-owner-b', name: '폴링검증B', isGuest: false },
  ]
  const owned = new Map(owners.map((owner, index) => [owner.uid, normalizePokemon({
    speciesId: 248,
    captureId: `poll-owned-${index}`,
    moves: ['crunch', 'stoneedge', 'icepunch', 'dragondance'].map(id => getMoveById(id).name),
  })]))
  const service = createRaidService({
    store,
    engine,
    now: () => timestamp,
    newId: () => `poll-server-${++serial}`,
    makeSeed: () => `poll-seed-${++serial}`,
    resolvePokemon: async (identity, selection) => {
      const pokemon = owned.get(identity.uid)
      assert.equal(selection.captureId, pokemon?.captureId)
      return clone(pokemon)
    },
  })
  const request = async (index, action, payload = {}) => service.execute(owners[index], {
    action,
    ...(new Set(['status', 'catalog', 'rooms', 'raidList']).has(action) ? {} : { requestId: `poll-request-${++serial}` }),
    ...payload,
  })
  let view = await request(0, 'roomCreate', { bossId: 'mewtwo', visibility: 'public', title: '경량 폴링 검증' })
  const roomId = view.room.id
  view = await request(1, 'status')
  await request(1, 'roomJoin', { roomId, roomRevision: view.rooms.find(room => room.id === roomId).roomRevision })
  for (let index = 0; index < owners.length; index++) {
    view = await request(index, 'status')
    await request(index, 'roomReady', {
      roomId,
      roomRevision: view.room.roomRevision,
      ready: true,
      pokemon: { captureId: owned.get(owners[index].uid).captureId },
    })
  }
  view = await request(0, 'status')
  view = await request(0, 'roomStart', { roomId, roomRevision: view.room.roomRevision })
  return { base, counters, service, owners, request, raidId: view.raid.id, view }
}

test('unchanged raid polling reads a compact run header and waiting-room index, without full battle or room lists', async () => {
  const f = await fixture()
  f.counters.get = {}
  f.counters.list = {}
  const before = await f.base.inspect()
  const compact = await f.request(0, 'status', {
    raidId: f.raidId,
    sinceRevision: f.view.raid.revision,
    eventCursor: f.view.raid.eventCursor,
  })
  assert.equal(compact.raid?.unchanged, true)
  assert.equal(compact.raid?.revision, f.view.raid.revision)
  assert.equal(Object.hasOwn(compact.raid, 'battle'), false)
  assert.equal(Object.hasOwn(compact.raid, 'events'), false)
  assert.equal(Object.hasOwn(compact, 'room'), false)
  assert.equal(f.counters.get.raidRuns ?? 0, 0, 'unchanged poll must not read the full battle document')
  assert.equal(f.counters.get.raidRooms ?? 0, 0, 'unchanged active poll must not read the full room snapshot')
  assert.equal(f.counters.list.raidRooms ?? 0, 0, 'room browse must never list full room snapshots')
  assert.equal(f.counters.get.raidRunHeads, 1)
  assert.equal(f.counters.list.raidRoomIndex, 1)
  assert.deepEqual(await f.base.inspect(), before, 'GET status is strictly read-only')
})

test('a command changes the public header revision and causes peers with an old revision to receive one full authoritative battle view', async () => {
  const f = await fixture()
  const stored = await f.base.transaction(tx => tx.get('raidRuns', f.raidId))
  const command = engine.chooseRaidCommand(stored.battle, f.owners[0].uid, { seed: 'poll-legal-command' })
  assert(command)
  await f.request(0, 'raidSubmit', {
    raidId: f.raidId,
    decisionToken: f.view.raid.decisionToken,
    commandVersion: 1,
    command,
  })
  const changed = await f.request(1, 'status', {
    raidId: f.raidId,
    sinceRevision: f.view.raid.revision,
    eventCursor: f.view.raid.eventCursor,
  })
  assert.equal(changed.raid?.unchanged, undefined)
  assert(changed.raid?.battle, 'a changed header must refresh the authoritative battle projection')
  assert(changed.raid.participants.some(member => !member.isOwn && member.submitted), 'allies receive safe submitted state')
  assert(changed.raid.revision > f.view.raid.revision)
  const fresh = await f.request(1, 'status', {
    raidId: f.raidId,
    sinceRevision: changed.raid.revision,
    eventCursor: changed.raid.eventCursor,
  })
  assert.equal(fresh.raid?.unchanged, true)
  assert.equal(fresh.raid?.pendingSubmitted, false)
})
