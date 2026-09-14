import assert from 'node:assert/strict'
import test from 'node:test'
import { createMemoryRankedStore } from '../server/rankedStore.js'
import { createRankedService } from '../server/rankedService.js'
import { createGuestIdentityRegistry } from '../server/guestIdentity.js'
import { createRaidService, eraseGuestRaidData } from '../server/raidService.js'
import * as raidEngine from '../server/raidBattle.js'
import { RAID_RETENTION_MS } from '../server/raidRetention.js'
import { RAID_DEFAULTS } from '../src/data/raidRules.js'
import { getMoveById, normalizePokemon } from '../src/data/trainingData.js'
import { createRaidBattlePlayback } from '../src/raidBattlePlayback.js'

const clone = value => structuredClone(value)
const READ_ACTIONS = new Set(['status', 'catalog', 'rooms', 'raidList'])
const rejectCode = (promise, code) => assert.rejects(promise, error => error?.code === code)
function pathsContaining(value, needle, path = '$') {
  if (typeof value === 'string') return value.includes(needle) ? [path] : []
  if (!value || typeof value !== 'object') return []
  return Object.entries(value).flatMap(([key, nested]) => pathsContaining(nested, needle, `${path}.${key}`))
}

function identities(count, prefix = 'raid-service-user') {
  return Array.from({ length: count }, (_, index) => ({ uid: `${prefix}-${index}`, name: `서비스검증${index}`, isGuest: false }))
}

function tracedStore(store, calls) {
  return {
    transaction: work => store.transaction(tx => work({
      get: async (collection, key) => { calls.push(['get', collection, key]); return tx.get(collection, key) },
      list: async collection => { calls.push(['list', collection]); return tx.list(collection) },
      set: (collection, key, value) => tx.set(collection, key, value),
      delete: (collection, key) => tx.delete(collection, key),
    })),
    inspect: () => store.inspect(),
  }
}

function fixture({ users = identities(4), engine = raidEngine, timeouts = {}, guestRegistry = null, calls = null } = {}) {
  let timestamp = 1_000_000
  let serial = 0
  const backingStore = createMemoryRankedStore()
  const store = calls ? tracedStore(backingStore, calls) : backingStore
  const owned = new Map(users.map((owner, index) => [owner.uid, normalizePokemon({
    speciesId: 248,
    captureId: `${owner.uid}.owned.${index}`,
    moves: ['crunch', 'stoneedge', 'icepunch', 'dragondance'].map(id => getMoveById(id).name),
  })]))
  const service = createRaidService({
    store,
    engine,
    guestRegistry,
    now: () => timestamp,
    newId: () => `raid-service-${++serial}`,
    makeSeed: () => `raid-service-seed-${++serial}`,
    timeouts,
    resolvePokemon: async (identity, selection) => {
      const pokemon = owned.get(identity.uid)
      assert.equal(selection.captureId, pokemon?.captureId, 'server must resolve the selected capture from its owner')
      return clone(pokemon)
    },
  })
  const call = (index, action, payload = {}) => service.execute(users[index], {
    action,
    ...(READ_ACTIONS.has(action) ? {} : { requestId: `raid-request-${++serial}` }),
    ...payload,
  })
  return { store, service, users, owned, call, advance: milliseconds => { timestamp += milliseconds }, now: () => timestamp }
}

test('resolved battle cues add ranked-style playback grace once, without client-controlled deadline extensions', async () => {
  const env = fixture()
  const { view: started, raidId } = await startRaid(env, [0])
  assert.equal(started.raid.deadlineAt - env.now(), 45_000, 'First input has no previous turn animation')
  const run = await env.store.transaction(tx => tx.get('raidRuns', raidId))
  const command = raidEngine.chooseRaidCommand(run.battle, env.users[0].uid, { seed: 'playback-grace-command' })
  const resolved = await env.call(0, 'raidSubmit', { raidId, decisionToken: started.raid.decisionToken, commandVersion: 1, command })
  assert.equal(resolved.raid.lifecycle, 'input')
  assert.equal(resolved.raid.deadlineAt - env.now(), 60_000)
  const deadline = resolved.raid.deadlineAt
  env.advance(45_001)
  const duringGrace = await env.call(0, 'raidHeartbeat', { raidId })
  assert.equal(duringGrace.raid.turnNumber, resolved.raid.turnNumber, 'Animation allowance must prevent early automatic commands')
  assert.equal(duringGrace.raid.deadlineAt, deadline, 'Heartbeats do not extend animation grace')
  env.advance(deadline - env.now() + 1)
  const timedOut = await env.call(0, 'raidHeartbeat', { raidId })
  assert.equal(timedOut.raid.turnNumber, resolved.raid.turnNumber + 1, 'The bounded server deadline still resolves absent input')
})

async function createRoom(env, { owner = 0, bossId = 'mewtwo', password, solo = false, title = '서비스 검증 레이드' } = {}) {
  const view = await env.call(owner, 'roomCreate', { bossId, password, solo, title })
  return { roomId: view.room.id, view }
}

async function startRaid(env, members, options = {}) {
  const { roomId } = await createRoom(env, options)
  for (const member of members.slice(1)) {
    const listed = await env.call(member, 'status')
    await env.call(member, 'roomJoin', { roomId, roomRevision: listed.rooms.find(room => room.id === roomId).roomRevision })
  }
  for (const member of members) {
    const lobby = await env.call(member, 'status')
    await env.call(member, 'roomReady', {
      roomId,
      roomRevision: lobby.room.roomRevision,
      ready: true,
      pokemon: { captureId: env.owned.get(env.users[member].uid).captureId },
    })
  }
  const lobby = await env.call(members[0], 'status')
  const started = await env.call(members[0], 'roomStart', { roomId, roomRevision: lobby.room.roomRevision })
  return { roomId, raidId: started.raid.id, view: started }
}

async function finishWinningRaid(env, { owner = 0 } = {}) {
  const { raidId, view } = await startRaid(env, [owner])
  const run = await env.store.transaction(tx => tx.get('raidRuns', raidId))
  const command = raidEngine.chooseRaidCommand(run.battle, env.users[owner].uid, { seed: `finish-${raidId}` })
  const finished = await env.call(owner, 'raidSubmit', {
    raidId,
    decisionToken: view.raid.decisionToken,
    commandVersion: 1,
    command,
  })
  assert.equal(finished.result?.raidId, raidId)
  return { raidId, view: finished }
}

async function preparePreludeFinalTurn(env, raidId) {
  await env.store.transaction(async tx => {
    const run = await tx.get('raidRuns', raidId)
    for (const [index, actor] of run.battle.opponent.team.entries()) {
      actor.hp = index === 0 ? 1 : 0
      actor.fainted = index !== 0
    }
    for (const actor of run.battle.player.team) {
      actor.hp = Math.max(1, Math.floor(actor.maxHp / 2))
      actor.status = 'brn'
      actor.statStages.speed = 6
      actor.moves[0].currentPp = 2
      actor.usedBattleMechanicId = 'tera'
    }
    run.battle.raid.usedMechanicsByOwner = Object.fromEntries(env.users.slice(0, 3).map(user => [user.uid, true]))
    tx.set('raidRuns', raidId, run)
  })
  return env.call(0, 'status', { raidId })
}

test('the real prelude final turn automatically enters the boss once for concurrent participants and retains replay order', async () => {
  const env = fixture()
  const { raidId } = await startRaid(env, [0, 1, 2])
  const before = await preparePreludeFinalTurn(env, raidId)
  const run = await env.store.transaction(tx => tx.get('raidRuns', raidId))
  const command = { type: 'move', moveIndex: 0, targetActorId: run.battle.opponent.team[0].battleId }
  const submit = { raidId, decisionToken: before.raid.decisionToken, commandVersion: 1, command }
  await Promise.all([0, 1, 2].map(index => env.call(index, 'raidSubmit', submit)))
  const after = await env.call(0, 'status', { raidId, eventCursor: before.raid.eventCursor })
  assert.equal(after.raid.lifecycle, 'input')
  assert.equal(after.raid.stage, 2)
  assert.equal(after.raid.turnNumber, 1)
  assert.notEqual(after.raid.decisionToken, before.raid.decisionToken)
  assert.equal(after.raid.deadlineAt - env.now(), 60_000, 'The final prelude cues receive bounded playback grace')
  const stored = await env.store.transaction(tx => tx.get('raidRuns', raidId))
  assert.equal(stored.battle.raid.totalTurns, 1)
  assert.equal(stored.battle.raid.phaseEpoch, 2)
  assert.deepEqual(stored.commands, {})
  assert.equal(stored.resolution, null)
  assert.deepEqual(stored.battle.raid.usedMechanicsByOwner, {})
  for (const actor of stored.battle.player.team) {
    assert.equal(actor.hp, actor.maxHp)
    assert(!actor.status)
    assert(!actor.usedBattleMechanicId)
    assert.equal(actor.statStages.speed, 0)
    assert(actor.moves.every(move => move.currentPp === move.maxPp))
  }
  const transitionIndex = after.raid.events.findIndex(event => event.kind === 'stage-transition')
  const faintIndex = after.raid.events.findIndex(event => event.kind === 'battle-cue' && event.cuePhase === 'faint')
  assert(faintIndex >= 0 && transitionIndex > faintIndex, 'Final hit and faint cues come before boss presentation')
  assert.equal(after.raid.events.filter(event => event.kind === 'stage-transition').length, 1)
  assert.equal(after.raid.events[transitionIndex].presentation.resetActors, true)
  const pending = [], frames = []
  const playback = createRaidBattlePlayback({ publish: frame => frames.push(clone(frame)), duration: () => 1,
    schedule: callback => { pending.push(callback); return pending.length }, unschedule: () => {} })
  playback.receive(before.raid)
  playback.receive(after.raid)
  assert.equal(playback.getSnapshot().battle.raid.phase, 1, 'Authoritative boss arrival does not jump over the prelude replay')
  while (pending.length) pending.shift()()
  const faintFrame = frames.find(frame => frame.cue?.cuePhase === 'faint')
  const bossFrame = frames.find(frame => frame.cue?.kind === 'stage-transition')
  assert.equal(faintFrame.battle.raid.phase, 1)
  assert.equal(bossFrame.battle.raid.phase, 2)
  assert.equal(bossFrame.battle.opponent.team.length, 1)
  playback.dispose()
  const oldDecision = env.call(0, 'raidSubmit', { ...submit, commandVersion: 2 })
  await rejectCode(oldDecision, 'STALE_DECISION')
  await Promise.all([0, 1, 2].map(index => env.call(index, 'raidHeartbeat', { raidId })))
  const reconnected = await env.call(2, 'status', { raidId })
  assert.equal(reconnected.raid.stage, 2)
  assert.equal(reconnected.raid.turnNumber, 1)
  assert.equal(reconnected.raid.deadlineAt, after.raid.deadlineAt)
  const eventRows = Object.values((await env.store.inspect()).collections.raidEvents)
  assert.equal(eventRows.flatMap(row => row.events).filter(event => event.kind === 'stage-transition').length, 1)
})

test('legacy saved intermissions resume automatically through heartbeat without a stage button', async () => {
  const env = fixture()
  const { raidId } = await startRaid(env, [0, 1, 2])
  await preparePreludeFinalTurn(env, raidId)
  await env.store.transaction(async tx => {
    const run = await tx.get('raidRuns', raidId)
    run.battle.opponent.team.forEach(actor => { actor.hp = 0; actor.fainted = true })
    run.lifecycle = 'intermission'
    run.deadlineAt = null
    tx.set('raidRuns', raidId, run)
  })
  await Promise.all([0, 1, 2].map(index => env.call(index, 'raidHeartbeat', { raidId })))
  const resumed = await env.call(0, 'status', { raidId })
  assert.equal(resumed.raid.lifecycle, 'input')
  assert.equal(resumed.raid.stage, 2)
  assert.equal(resumed.raid.turnNumber, 1)
  assert.equal(resumed.raid.events.filter(event => event.kind === 'stage-transition').length, 1)
})

test('public catalog and event projections exclude legacy boss pattern thresholds', async () => {
  const engine = { ...raidEngine, getRaidCatalog: () => raidEngine.RAID_BOSSES.map(boss => ({ ...boss, gates: { 50: 'unreleased boss pattern' } })) }
  const env = fixture({ engine })
  const catalog = await env.call(0, 'catalog')
  assert.equal(JSON.stringify(catalog).includes('unreleased boss pattern'), false)
  const { raidId } = await startRaid(env, [0])
  await env.store.transaction(async tx => {
    const run = await tx.get('raidRuns', raidId)
    run.eventChunks = []
    run.battle.raid.events.push({ id: `${raidId}:2`, kind: 'boss-mechanic', message: '뮤츠의 모습이 변했다.', gate: 50 })
    tx.set('raidRuns', raidId, run)
  })
  const snapshot = await env.call(0, 'status', { raidId })
  const event = snapshot.raid.events.find(entry => entry.kind === 'boss-mechanic')
  assert(event)
  assert.equal(event.gate, undefined)
  assert.equal(event.message, '뮤츠의 모습이 변했다.', 'Already occurred battle effects remain visible')
})

test('four-digit room passwords are hashed, listed only as locks, and enforce persistent per-user attempt limits', async () => {
  const env = fixture()
  const password = '0123'
  const { roomId, view } = await createRoom(env, { password, title: '비밀번호 방' })
  assert.equal(view.inviteCode, undefined)
  assert.equal(view.room.inviteCode, undefined)
  assert.equal(view.room.locked, true)
  const raw = await env.store.inspect()
  const stored = raw.collections.raidRooms[roomId]
  assert(stored.passwordHash && stored.passwordHash !== password)
  assert(stored.passwordSalt)
  assert.equal(stored.password, undefined)
  assert.equal(stored.codeHash, undefined)
  const index = raw.collections.raidRoomIndex[roomId]
  assert.equal(index.hasPassword, true)
  for (const key of ['password', 'passwordHash', 'passwordSalt', 'codeHash', 'codeSalt']) assert.equal(index[key], undefined, key)
  const listed = (await env.call(1, 'status')).rooms.find(room => room.id === roomId)
  assert(listed, 'Password-protected rooms remain discoverable')
  assert.equal(listed.locked, true)
  assert.equal(listed.hasPassword, true)
  for (const key of ['password', 'passwordHash', 'passwordSalt', 'codeHash', 'codeSalt']) assert.equal(listed[key], undefined, key)
  for (let attempt = 0; attempt < 5; attempt++) {
    await rejectCode(env.call(1, 'roomJoin', { roomId, roomRevision: listed.roomRevision, password: '9999' }), 'ROOM_PASSWORD_INVALID')
  }
  await rejectCode(env.call(1, 'roomJoin', { roomId, roomRevision: listed.roomRevision, password }), 'ROOM_PASSWORD_RATE_LIMITED')
  const joined = await env.call(2, 'roomJoin', { roomId, roomRevision: listed.roomRevision, password })
  assert.equal(joined.room.memberCount, 2)
  assert.equal(JSON.stringify(joined).includes(env.users[0].uid), false)
  env.advance(60_001)
  const retried = await env.call(1, 'roomJoin', { roomId, roomRevision: joined.room.roomRevision, password })
  assert.equal(retried.room.memberCount, 3, 'Only the failed user is rate limited and can retry after the cooldown')
  assert.equal(Object.keys((await env.store.inspect()).collections.raidJoinAttempts).length, 0)
})

test('room passwords require exactly four digits and never locate rooms without their id', async () => {
  const env = fixture()
  for (const password of ['1', '123', '12345', '12a4', ' 1234', '１２３４', 1234, null]) {
    await rejectCode(createRoom(env, { password }), 'INVALID_ROOM_PASSWORD')
  }
  assert.equal((await env.call(0, 'status')).rooms.length, 0)
  const first = await createRoom(env, { password: '0000' })
  const second = await createRoom(env, { owner: 1, password: '0000' })
  const raw = await env.store.inspect()
  assert.notEqual(raw.collections.raidRooms[first.roomId].passwordHash, raw.collections.raidRooms[second.roomId].passwordHash, 'Each room salts the same password independently')
  await rejectCode(env.call(2, 'roomJoin', { password: '0000' }), 'INVALID_ROOM')
  await rejectCode(env.call(2, 'roomJoin', { code: 'ABCDEFGH' }), 'INVALID_ROOM')
  const joined = await env.call(2, 'roomJoin', { roomId: second.roomId, roomRevision: second.view.room.roomRevision, password: '0000' })
  assert.equal(joined.room.id, second.roomId)
  assert.equal((await env.call(0, 'status')).room.memberCount, 1, 'The identical password does not join the other room')
})

test('solo rooms stay unlisted and refuse additional players without generating invitation codes', async () => {
  const env = fixture()
  const { roomId, view } = await createRoom(env, { solo: true, password: '' })
  assert.equal(view.inviteCode, undefined)
  assert.equal(view.room.solo, true)
  assert.equal(view.room.locked, false)
  assert.equal((await env.call(1, 'status')).rooms.some(room => room.id === roomId), false)
  await rejectCode(env.call(1, 'roomJoin', { roomId, roomRevision: view.room.roomRevision }), 'ROOM_SOLO_ONLY')
  const owned = await env.call(0, 'status')
  assert.equal(owned.room.id, roomId)
  assert.equal(owned.room.memberCount, 1)
})

test('random AI trainers remain stable across polling, player joins, host succession and battle start', async () => {
  const env = fixture()
  const created = await env.call(0, 'roomCreate', {
    bossId: 'mewtwo', title: '트레이너 편성 검증', npcRoles: ['forged'],
    npcTrainers: [{ trainerId: 'forged-client-trainer', name: 'forged-client-name' }],
  })
  const roomId = created.room.id
  const originalNpcs = created.room.npcSlots
  assert.equal(originalNpcs.length, 2)
  assert.equal(new Set(originalNpcs.map(npc => npc.trainerId)).size, 2)
  assert(originalNpcs.every(npc => npc.image && npc.trainer.name === npc.name))
  assert.equal(JSON.stringify(created).includes('forged-client'), false)
  assert.equal(created.room.npcRoles, undefined)
  assert.deepEqual((await env.call(0, 'status')).room.npcSlots, originalNpcs)
  const joined = await env.call(1, 'roomJoin', { roomId, roomRevision: created.room.roomRevision })
  assert.deepEqual(joined.room.npcSlots, originalNpcs.filter(npc => npc.slotId === 2), 'A player replaces slot 1 while the other AI stays')
  const hostReady = await env.call(0, 'roomReady', {
    roomId, roomRevision: joined.room.roomRevision,
    pokemon: { captureId: env.owned.get(env.users[0].uid).captureId },
  })
  const teammateReady = await env.call(1, 'roomReady', {
    roomId, roomRevision: hostReady.room.roomRevision,
    pokemon: { captureId: env.owned.get(env.users[1].uid).captureId },
    npcRoles: ['attack', 'attack'], npcTrainers: [{ trainerId: 'forged-client-trainer' }],
  })
  assert.equal(teammateReady.room.members.every(member => member.ready), true, 'Legacy role fields do not mutate the party or clear anyone else’s ready state')
  await env.call(0, 'roomLeave', { roomId, roomRevision: teammateReady.room.roomRevision })
  const inherited = await env.call(1, 'status')
  assert.equal(inherited.room.isHost, true)
  assert.deepEqual(inherited.room.npcSlots.map(npc => npc.slotId), [0, 2])
  assert.equal(inherited.room.npcSlots[1].trainerId, originalNpcs[1].trainerId)
  assert.equal(new Set(inherited.room.npcSlots.map(npc => npc.trainerId)).size, 2)
  const ready = await env.call(1, 'roomReady', {
    roomId, roomRevision: inherited.room.roomRevision,
    pokemon: { captureId: env.owned.get(env.users[1].uid).captureId },
  })
  const started = await env.call(1, 'roomStart', { roomId, roomRevision: ready.room.roomRevision })
  const run = await env.store.transaction(tx => tx.get('raidRuns', started.raid.id))
  assert.equal(run.battle.player.team[1].raidOwnerId, env.users[1].uid, 'Human ownership stays in the same slot after host succession')
  for (const npc of inherited.room.npcSlots) {
    const actor = run.battle.player.team[npc.slotId]
    assert.equal(actor.raidTrainer.id, npc.trainerId)
    assert.equal(actor.raidDisplayName, npc.name)
    assert.equal(actor.raidTrainerImage, npc.image)
  }
})

test('room capacity, ready revisions, and concurrent start requests preserve one three-player raid', async () => {
  const env = fixture({ users: identities(5, 'raid-race-user') })
  const { roomId } = await createRoom(env)
  for (const index of [1, 2]) {
    const listed = await env.call(index, 'status')
    await env.call(index, 'roomJoin', { roomId, roomRevision: listed.rooms.find(room => room.id === roomId).roomRevision })
  }
  const full = await env.call(3, 'status')
  await rejectCode(env.call(3, 'roomJoin', { roomId, roomRevision: full.rooms.find(room => room.id === roomId).roomRevision }), 'ROOM_FULL')
  const revision = (await env.call(0, 'status')).room.roomRevision
  const competingReady = await Promise.allSettled([0, 1].map(index => env.call(index, 'roomReady', {
    roomId,
    roomRevision: revision,
    ready: true,
    pokemon: { captureId: env.owned.get(env.users[index].uid).captureId },
  })))
  assert.equal(competingReady.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(competingReady.filter(result => result.status === 'rejected')[0]?.reason?.code, 'STALE_ROOM')
  for (const index of [0, 1, 2]) {
    const lobby = await env.call(index, 'status')
    if (lobby.room.members.find(member => member.isOwn)?.ready) continue
    await env.call(index, 'roomReady', {
      roomId,
      roomRevision: lobby.room.roomRevision,
      ready: true,
      pokemon: { captureId: env.owned.get(env.users[index].uid).captureId },
    })
  }
  const ready = await env.call(0, 'status')
  const starts = await Promise.all([0, 0].map(() => env.call(0, 'roomStart', { roomId, roomRevision: ready.room.roomRevision })))
  assert.equal(starts[0].raid.id, starts[1].raid.id)
  const database = await env.store.inspect()
  assert.equal(Object.keys(database.collections.raidRuns).length, 1)
  const run = database.collections.raidRuns[starts[0].raid.id]
  assert.equal(run.participants.filter(member => !member.isNpc).length, 3)
  assert.equal(new Set(run.participants.map(member => member.slotId)).size, 3)
})

test('fainted humans never hold the living teammates at the command deadline', async () => {
  const env = fixture()
  const { raidId, view } = await startRaid(env, [0, 1, 2])
  await env.store.transaction(async tx => {
    const run = await tx.get('raidRuns', raidId)
    run.battle.player.team[0].hp = 0
    run.battle.player.team[0].fainted = true
    tx.set('raidRuns', raidId, run)
  })
  for (const index of [1, 2]) {
    const run = await env.store.transaction(tx => tx.get('raidRuns', raidId))
    const command = raidEngine.chooseRaidCommand(run.battle, env.users[index].uid, { seed: 'living-teammate' })
    await env.call(index, 'raidSubmit', { raidId, decisionToken: view.raid.decisionToken, commandVersion: 1, command })
  }
  const run = await env.store.transaction(tx => tx.get('raidRuns', raidId))
  assert.equal(run.battle.raid.totalTurns, 1, 'The two living humans resolve immediately without the fainted user')
  assert(env.now() < view.raid.deadlineAt, 'No clock/deadline advance is used')
})

test('a fainted solo trainer can observe NPC allies progress without submitting an impossible command', async () => {
  const env = fixture()
  const { raidId, view } = await startRaid(env, [0])
  await env.store.transaction(async tx => {
    const run = await tx.get('raidRuns', raidId)
    run.battle.player.team[0].hp = 0
    run.battle.player.team[0].fainted = true
    tx.set('raidRuns', raidId, run)
  })
  await env.call(0, 'raidHeartbeat', { raidId })
  const run = await env.store.transaction(tx => tx.get('raidRuns', raidId))
  assert.equal(run.battle.raid.totalTurns, 1, 'The next explicit heartbeat resolves NPC commands before timeout')
  assert(env.now() < view.raid.deadlineAt)
})

test('raid reservations block ranked queue and battle rooms, while a ranked queue blocks a new raid room', async () => {
  const env = fixture({ users: identities(2, 'raid-exclusion-user') })
  const { roomId } = await createRoom(env)
  const rankedEngine = {
    canonicalizeRankedTeam: team => clone(team),
    createRankedBattle: () => { throw new Error('match creation is not expected for this exclusion test') },
  }
  const ranked = createRankedService({
    store: env.store,
    engine: rankedEngine,
    now: env.now,
    newId: () => 'ranked-exclusion-id',
    makeSeed: () => 1,
    resolveTeam: async (_identity, team) => team,
  })
  const team = Array.from({ length: 6 }, (_, index) => ({ captureId: `ranked-${index}`, speciesId: index + 1 }))
  await rejectCode(ranked.execute(env.users[0], { action: 'join', requestId: 'ranked-blocked-queue', format: 'single', team }), 'ALREADY_IN_RAID')
  await rejectCode(ranked.execute(env.users[0], { action: 'roomCreate', requestId: 'ranked-blocked-room', title: '차단 확인', mode: 'league', format: 'single', team }), 'ALREADY_IN_RAID')
  let lobby = await env.call(0, 'status')
  await env.call(0, 'roomLeave', { roomId, roomRevision: lobby.room.roomRevision })
  await ranked.execute(env.users[0], { action: 'join', requestId: 'ranked-queue-ok', format: 'single', team })
  await rejectCode(env.call(0, 'roomCreate', { bossId: 'mewtwo', visibility: 'public', title: '큐 중 레이드' }), 'ALREADY_QUEUED')
})

test('a present ally can keep a raid alive through recovery and the server takes over a silent ally at the turn deadline', async () => {
  const chosenOwners = []
  const engine = {
    ...raidEngine,
    chooseRaidCommand: (...args) => {
      chosenOwners.push(args[1])
      return raidEngine.chooseRaidCommand(...args)
    },
  }
  const env = fixture({ users: identities(2, 'raid-presence-user'), engine, timeouts: { command: 5_000, heartbeatGrace: 5_000, suspend: 5_000 } })
  const { raidId, view } = await startRaid(env, [0, 1])
  // Both initial leases have elapsed. The returning second trainer resumes
  // inside the five-minute recovery window instead of losing the raid.
  env.advance(6_000)
  const resumed = await env.call(1, 'raidHeartbeat', { raidId })
  assert.equal(resumed.raid.lifecycle, 'input')
  assert(resumed.raid.deadlineAt > env.now())
  const stored = await env.store.transaction(tx => tx.get('raidRuns', raidId))
  const command = raidEngine.chooseRaidCommand(stored.battle, env.users[1].uid, { seed: 'present-ally-command' })
  assert(command)
  env.advance(4_000)
  await env.call(1, 'raidSubmit', {
    raidId,
    decisionToken: resumed.raid.decisionToken,
    commandVersion: 1,
    command,
  })
  env.advance(2_000)
  const advanced = await env.call(1, 'raidAdvance', { raidId, decisionToken: resumed.raid.decisionToken })
  assert(advanced.raid.turnNumber > view.raid.turnNumber, 'the turn resolves after its server deadline')
  assert(chosenOwners.includes(env.users[0].uid), 'silent human slot receives a server-selected AI command')

  // A later heartbeat beyond the recovery deadline settles the abandoned run
  // once, clears its pointers, and grants no victory receipt.
  env.advance(11_000)
  const expired = await env.call(1, 'raidHeartbeat', { raidId })
  assert.equal(expired.result?.outcome, 'loss')
  const final = await env.store.transaction(tx => tx.get('raidRuns', raidId))
  assert.equal(final.lifecycle, 'finished')
  assert.equal(Object.keys((await env.store.inspect()).collections.raidRewardReceipts ?? {}).length, 0)
})

test('turn commands and heartbeats never scan terminal expiry indexes or write the shared cleanup cursor', async () => {
  const calls = []
  const env = fixture({ users: identities(1, 'raid-turn-io-user'), calls })
  const { raidId, view } = await startRaid(env, [0])
  calls.length = 0
  await env.call(0, 'raidHeartbeat', { raidId })
  const run = await env.store.transaction(tx => tx.get('raidRuns', raidId))
  const command = raidEngine.chooseRaidCommand(run.battle, env.users[0].uid, { seed: 'turn-io-command' })
  await env.call(0, 'raidSubmit', {
    raidId,
    decisionToken: view.raid.decisionToken,
    commandVersion: 1,
    command,
  })
  assert.equal(calls.some(([kind, collection, key]) => collection === 'raidExpiryIndex' || (collection === 'meta' && key === 'raidExpiryCursor')), false)
})

test('first-clear receipts and rewards settle once under concurrent winning commands', async () => {
  const engine = { ...raidEngine, getRaidOutcome: () => 'won' }
  const env = fixture({ users: identities(2, 'raid-reward-user'), engine })
  const { raidId, view } = await startRaid(env, [0, 1])
  const run = await env.store.transaction(tx => tx.get('raidRuns', raidId))
  const commands = [0, 1].map(index => raidEngine.chooseRaidCommand(run.battle, env.users[index].uid, { seed: `reward-command-${index}` }))
  await Promise.all(commands.map((command, index) => env.call(index, 'raidSubmit', {
    raidId,
    decisionToken: view.raid.decisionToken,
    commandVersion: 1,
    command,
  })))
  const database = await env.store.inspect()
  assert.equal(Object.keys(database.collections.raidRewardReceipts ?? {}).length, 4)
  assert.equal(Object.keys(database.collections.raidFirstClears ?? {}).length, 2)
  for (const owner of env.users) {
    assert.equal(database.collections.raidPlayers[owner.uid].vpRewardTotal, RAID_DEFAULTS.winVp + RAID_DEFAULTS.firstClearVp)
    assert.equal(database.collections.players[owner.uid].activeRaidId, null)
  }
  const repeat = await env.call(0, 'status')
  assert.equal(repeat.result?.outcome, 'win')
  assert.equal(Object.keys((await env.store.inspect()).collections.raidRewardReceipts ?? {}).length, 4)
})

test('result projections carry a stable raid id and an old close request cannot dismiss a newer result', async () => {
  const engine = { ...raidEngine, getRaidOutcome: () => 'won' }
  const env = fixture({ users: identities(1, 'raid-result-user'), engine })
  const first = await finishWinningRaid(env)
  const second = await finishWinningRaid(env)
  assert.notEqual(first.raidId, second.raidId)
  assert.equal(second.view.result?.raidId, second.raidId)
  assert.equal(second.view.result?.bossId, 'mewtwo')

  await rejectCode(env.call(0, 'raidDismissResult', { raidId: first.raidId }), 'STALE_RESULT')
  let pointer = await env.store.transaction(tx => tx.get('raidPlayers', env.users[0].uid))
  assert.equal(pointer.lastRaidId, second.raidId, 'old result close must leave the newer pointer unchanged')
  await rejectCode(env.call(0, 'raidDismissResult', {}), 'RESULT_ID_REQUIRED')
  pointer = await env.store.transaction(tx => tx.get('raidPlayers', env.users[0].uid))
  assert.equal(pointer.lastRaidId, second.raidId)

  await env.call(0, 'raidDismissResult', { raidId: second.raidId })
  pointer = await env.store.transaction(tx => tx.get('raidPlayers', env.users[0].uid))
  assert.equal(pointer.lastRaidId, null)
})

test('terminal raid data expires after seven days without touching payout receipts or newer result pointers', async () => {
  const engine = { ...raidEngine, getRaidOutcome: () => 'won' }
  const env = fixture({ users: identities(1, 'raid-expiry-user'), engine })
  const { raidId } = await finishWinningRaid(env)
  const before = await env.store.inspect()
  assert(before.collections.raidExpiryIndex?.[raidId], 'settlement writes the compact expiry index')
  assert(Object.keys(before.collections.raidEvents ?? {}).length > 0, 'terminal replay has persisted events')
  const receipts = clone(before.collections.raidRewardReceipts)
  const firstClears = clone(before.collections.raidFirstClears)
  const totalVp = before.collections.raidPlayers[env.users[0].uid].vpRewardTotal

  env.advance(RAID_RETENTION_MS - 1)
  await env.call(0, 'status')
  assert((await env.store.inspect()).collections.raidRuns[raidId], 'read-only status never runs expiry cleanup')
  env.advance(1)
  await env.call(0, 'roomCreate', { bossId: 'mewtwo', visibility: 'public', title: '만료 정리 후 새 방' })
  const after = await env.store.inspect()
  assert.equal(after.collections.raidRuns?.[raidId] ?? null, null)
  assert.equal(after.collections.raidRunHeads?.[raidId] ?? null, null)
  assert.equal(after.collections.raidExpiryIndex?.[raidId] ?? null, null)
  assert.equal(Object.values(after.collections.raidEvents ?? {}).some(event => event.raidId === raidId), false)
  assert.equal(Object.values(after.collections.raidResults ?? {}).some(result => result.raidId === raidId), false)
  assert.deepEqual(after.collections.raidRewardReceipts, receipts)
  assert.deepEqual(after.collections.raidFirstClears, firstClears)
  assert.equal(after.collections.raidPlayers[env.users[0].uid].vpRewardTotal, totalVp)
  assert.equal(after.collections.raidPlayers[env.users[0].uid].lastRaidId, null)
})

test('closing the matching result at the expiry boundary succeeds after that same transaction removes it', async () => {
  const engine = { ...raidEngine, getRaidOutcome: () => 'won' }
  const env = fixture({ users: identities(1, 'raid-expiry-dismiss-user'), engine })
  const { raidId } = await finishWinningRaid(env)
  env.advance(RAID_RETENTION_MS)
  const closed = await env.call(0, 'raidDismissResult', { raidId })
  assert.equal(closed.result, null)
  const database = await env.store.inspect()
  assert.equal(database.collections.raidRuns?.[raidId] ?? null, null)
  assert.equal(database.collections.raidPlayers[env.users[0].uid].lastRaidId, null)
})

test('unsupported terminal snapshots stay preserved while expiry cleanup continues past them', async () => {
  const engine = { ...raidEngine, getRaidOutcome: () => 'won' }
  const env = fixture({ users: identities(1, 'raid-expiry-version-user'), engine })
  const old = await finishWinningRaid(env)
  const current = await finishWinningRaid(env)
  await env.store.transaction(async tx => {
    const run = await tx.get('raidRuns', old.raidId)
    run.battle.raid.engineVersion += 1
    tx.set('raidRuns', old.raidId, run)
  })
  env.advance(RAID_RETENTION_MS)
  await env.call(0, 'roomCreate', { bossId: 'mewtwo', visibility: 'public', title: '보존 확인 첫 정리' })
  let database = await env.store.inspect()
  assert(database.collections.raidRuns[old.raidId], 'unsupported run is preserved')
  assert(database.collections.raidExpiryIndex[old.raidId], 'unsupported index is preserved')
  assert.equal(database.collections.raidRuns[current.raidId] ?? null, null, 'later supported run is not starved by an unsupported predecessor')
  assert.equal(database.collections.raidPlayers[env.users[0].uid].lastRaidId, null, 'only the matching expired result pointer is cleared')
  // The next pass may revisit the unsupported record, but it must not delete
  // it or corrupt the separate room created by the previous cleanup.
  await env.call(0, 'roomLeave', { roomId: (await env.call(0, 'status')).room.id, roomRevision: (await env.call(0, 'status')).room.roomRevision })
  await env.call(0, 'roomCreate', { bossId: 'mewtwo', visibility: 'public', title: '보존 확인 두 번째 정리' })
  database = await env.store.inspect()
  assert(database.collections.raidRuns[old.raidId])
})

test('event history deletes overflow chunks instead of leaving unreferenced replay documents', async () => {
  const engine = {
    ...raidEngine,
    getRaidOutcome: () => null,
    resolveRaidTurn: battle => {
      const next = clone(battle)
      const sequence = (next.raid.eventSequence ?? 0) + 1
      next.turn += 1
      next.raid.totalTurns += 1
      next.raid.eventSequence = sequence
      next.raid.events = [...(next.raid.events ?? []), {
        id: `overflow-turn:${sequence}`,
        type: 'turn-resolved',
        message: `overflow event ${sequence}`,
        turn: next.turn,
      }]
      return next
    },
  }
  const env = fixture({ users: identities(1, 'raid-event-overflow-user'), engine })
  const { raidId, view: started } = await startRaid(env, [0])
  let view = started
  for (let version = 1; version <= 25; version++) {
    const run = await env.store.transaction(tx => tx.get('raidRuns', raidId))
    const command = raidEngine.chooseRaidCommand(run.battle, env.users[0].uid, { seed: `overflow-command-${version}` })
    view = await env.call(0, 'raidSubmit', {
      raidId,
      decisionToken: view.raid.decisionToken,
      commandVersion: version,
      command,
    })
    assert.equal(view.raid.lifecycle, 'input')
  }
  const database = await env.store.inspect()
  const run = database.collections.raidRuns[raidId]
  const chunks = run.eventChunks
  assert.equal(chunks.length, 24)
  const eventIds = Object.keys(database.collections.raidEvents ?? {})
  assert.equal(eventIds.length, 24, 'the two overflow chunk documents are deleted in the same transaction')
  assert.deepEqual(new Set(eventIds), new Set(chunks.map(chunk => chunk.id)))
})

test('guest raid cleanup removes the guest identity from retained room, run, and compact-head projections while preserving co-op state', async () => {
  const users = [{ uid: 'raid-guest-owner', name: '', isGuest: true }, { uid: 'raid-retained-owner', name: '보존 사용자', isGuest: false }]
  const env = fixture({ users, guestRegistry: undefined })
  // The service creates its own registry when none is supplied. Create the
  // required guest profile against the same store before the guest joins.
  const registry = createGuestIdentityRegistry({ store: env.store, now: env.now, chooseNumber: () => 123456 })
  await registry.create(users[0])
  const service = createRaidService({
    store: env.store,
    engine: raidEngine,
    guestRegistry: registry,
    now: env.now,
    newId: () => 'guest-retention-run',
    makeSeed: () => 'guest-retention-seed',
    resolvePokemon: async (identity, selection) => {
      const pokemon = env.owned.get(identity.uid)
      assert.equal(selection.captureId, pokemon?.captureId)
      return clone(pokemon)
    },
  })
  let serial = 0
  const call = (index, action, payload = {}) => service.execute(users[index], {
    action,
    ...(READ_ACTIONS.has(action) ? {} : { requestId: `guest-retention-request-${++serial}` }),
    ...payload,
  })
  let view = await call(0, 'roomCreate', { bossId: 'mewtwo', visibility: 'public', title: '게스트 보존 검증' })
  const roomId = view.room.id
  view = await call(1, 'status')
  await call(1, 'roomJoin', { roomId, roomRevision: view.rooms.find(room => room.id === roomId).roomRevision })
  for (const index of [0, 1]) {
    view = await call(index, 'status')
    await call(index, 'roomReady', { roomId, roomRevision: view.room.roomRevision, ready: true, pokemon: { captureId: env.owned.get(users[index].uid).captureId } })
  }
  view = await call(0, 'status')
  view = await call(0, 'roomStart', { roomId, roomRevision: view.room.roomRevision })
  await eraseGuestRaidData({ store: env.store, now: env.now }, users[0])
  const database = await env.store.inspect()
  const retained = database.collections.raidRuns[view.raid.id]
  assert(retained)
  const raidRecords = { rooms: database.collections.raidRooms, runs: database.collections.raidRuns, heads: database.collections.raidRunHeads, results: database.collections.raidResults }
  for (const [kind, value] of Object.entries(raidRecords)) {
    const paths = pathsContaining(value, users[0].uid)
    assert.equal(paths.length, 0, `guest UID remains in retained ${kind}: ${paths.join(', ')}`)
  }
  assert(retained.participants.some(member => member.withdrawn && member.isNpc), 'departed guest becomes a retained AI slot')
  const survivor = await call(1, 'status')
  assert.equal(survivor.raid.id, view.raid.id)
})
