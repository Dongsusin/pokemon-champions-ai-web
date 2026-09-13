import assert from 'node:assert/strict'
import { createRankedService } from '../server/rankedService.js'
import { createMemoryRankedStore } from '../server/rankedStore.js'
import * as engine from '../server/rankedBattle.js'
import { normalizePokemon, getMoveById } from '../src/data/trainingData.js'

const tests = []
const test = (name, run) => tests.push({ name, run })
const roster = [25, 6, 9, 143, 68, 131].map(speciesId => normalizePokemon({ speciesId, captureId: `room-mon-${speciesId}`, moves: [getMoveById('protect').name] }))
const who = number => ({ uid: `room-user-${number}`, name: `사용자${number}` })
function environment(options = {}) {
  let time = 1_000_000, serial = 0, request = 0
  const store = options.store ?? createMemoryRankedStore()
  const setup = { store, engine, now: () => time, newId: () => `room-test-${++serial}`, makeSeed: () => 125, usageEnabled: true, timeouts: { selection: 900, turn: 600, replacement: 450, playbackGrace: 0 }, ...options }
  const service = createRankedService(setup)
  const call = (uid, action, payload = {}) => service.execute(who(uid), { action, ...(!['status', 'rooms'].includes(action) ? { requestId: `room-request-${++request}` } : {}), ...payload })
  return { call, service, store, setup, advance: value => { time += value } }
}
async function makeRoom(env, count, mode = 'tournament', format = 'single', extra = {}) {
  const first = await env.call(0, 'roomCreate', { title: '친구 대회', mode, format, team: roster, ...extra })
  for (let member = 1; member < count; member += 1) await env.call(member, 'roomJoin', { roomId: first.room.id, team: roster, password: extra.password ?? '' })
  return (await env.call(0, 'rooms')).room
}
const raw = async (env, id) => (await env.store.inspect()).collections.matches[id]
const uidNumber = uid => Number(uid.split('-').at(-1))
async function startBattle(env, matchId) {
  let match = await raw(env, matchId)
  const selection = match.format === 'single' ? [2, 0, 1] : [2, 0, 1, 3]
  for (const member of match.players) await env.call(uidNumber(member.uid), 'select', { matchId, revision: match.revision, selection })
  match = await raw(env, matchId)
  assert.equal(match.phase, 'battle')
  assert.equal(match.state.rules.pvp, true)
  assert.equal(match.state.player.team[0].speciesId, 9)
  const actions = Array.from({ length: match.format === 'single' ? 1 : 2 }, (_, actorSlot) => ({ type: 'move', actorSlot, moveIndex: 0, targetSideId: 'player', targetSlot: actorSlot }))
  for (const member of match.players) await env.call(uidNumber(member.uid), 'submit', { matchId, revision: match.revision, actions })
  match = await raw(env, matchId)
  assert.equal(match.state.turn, 2)
  assert(match.timelineChunks > 0)
  return match
}
const rejects = (promise, code) => assert.rejects(promise, error => error.code === code)

for (const mode of ['tournament', 'league']) for (const count of [2, 3, 4]) {
  test(`${count}-player ${mode} plays genuine matches, schedules each round and deletes completed room`, async () => {
    const env = environment()
    const room = await makeRoom(env, count, mode, count === 4 ? 'double' : 'single')
    const initial = await env.call(0, 'roomStart', { roomId: room.id })
    assert.equal(initial.room.matches.filter(match => match.phase === 'bye').length, count === 3 && mode === 'tournament' ? 1 : 0)
    assert.equal(initial.room.matches.filter(match => match.phase === 'select').length, count === 4 ? 2 : 1)
    const visited = new Set()
    for (let iteration = 0; iteration < 8; iteration += 1) {
      const snap = await env.call(0, 'rooms')
      if (!snap.room) break
      const current = snap.room.matches.filter(match => ['select', 'battle'].includes(match.phase))
      assert(current.length > 0)
      for (const scheduled of current) {
        assert(!visited.has(scheduled.id))
        visited.add(scheduled.id)
        const match = await startBattle(env, scheduled.id)
        const old = await env.call(uidNumber(match.players[1].uid), 'forfeit', { matchId: match.id })
        assert.equal(old.match.id, match.id)
        assert.equal(old.match.phase, 'finished')
        assert.equal(old.match.result.rewardVp, 0)
        assert.equal(old.match.result.friendly, true)
        const finalAnimation = await env.call(uidNumber(match.players[0].uid), 'rooms', { matchId: match.id })
        assert.equal(finalAnimation.match.id, match.id)
        assert(finalAnimation.match.timeline.length > 0)
      }
    }
    assert.equal(visited.size, mode === 'tournament' ? count - 1 : count * (count - 1) / 2)
    const final = await env.call(0, 'rooms')
    assert.equal(final.room, null)
    assert.equal(final.match, null)
    assert.equal(final.roomResult.reason, 'completed')
    assert.equal(final.roomResult.standings.length, count)
    const db = await env.store.inspect()
    assert.equal(db.collections.battleRooms[room.id], undefined)
    assert.equal(Object.keys(db.collections.pokemonUsage ?? {}).length, 0)
    for (let member = 0; member < count; member += 1) {
      const player = db.collections.players[who(member).uid]
      assert.equal(player.activeRoomId, null)
      assert.equal(player.activeMatchId, null)
      assert.equal(player.vpRewardTotal, 0)
      assert.equal(player.profiles.single.played, 0)
      assert.equal(player.profiles.double.played, 0)
      assert.equal(player.history, undefined)
      if (mode === 'league') assert.equal(player.roomResult.standings.find(entry => entry.uid === player.uid).played, count - 1)
    }
  })
}

test('global create race is capped at ten and concurrent joins at four, including active rooms', async () => {
  const env = environment()
  const outcomes = await Promise.allSettled(Array.from({ length: 15 }, (_, member) => env.call(member, 'roomCreate', { title: `대회 ${member}`, mode: 'league', format: 'single', team: roster })))
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 10)
  assert(outcomes.filter(result => result.status === 'rejected').every(result => result.reason.code === 'ROOM_LIMIT'))
  const first = outcomes[0].value.room
  const joins = await Promise.allSettled(Array.from({ length: 8 }, (_, index) => env.call(20 + index, 'roomJoin', { roomId: first.id, team: roster })))
  assert.equal(joins.filter(result => result.status === 'fulfilled').length, 3)
  assert(joins.filter(result => result.status === 'rejected').every(result => result.reason.code === 'ROOM_FULL'))
  await env.call(0, 'roomStart', { roomId: first.id })
  await rejects(env.call(40, 'roomCreate', { title: '한도', mode: 'league', format: 'single', team: roster }), 'ROOM_LIMIT')
})

test('passwords retain leading zeros, hide hashes and persist failed attempts across service restarts', async () => {
  const env = environment()
  const room = await makeRoom(env, 1, 'tournament', 'single', { password: '0012' })
  const view = JSON.stringify(await env.call(9, 'rooms'))
  assert(!view.includes('0012'))
  assert(!view.includes('passwordHash'))
  assert(!view.includes('passwordSalt'))
  const stored = (await env.store.inspect()).collections.battleRooms[room.id]
  assert(stored.passwordHash && stored.passwordHash !== '0012')
  for (let attempt = 0; attempt < 5; attempt += 1) await rejects(env.call(1, 'roomJoin', { roomId: room.id, password: '12', team: roster, requestId: 'repeated-wrong-id' }), 'WRONG_ROOM_PASSWORD')
  const restarted = createRankedService(env.setup)
  await rejects(restarted.execute(who(1), { action: 'roomJoin', roomId: room.id, password: '0012', team: roster, requestId: 'restart-attempt' }), 'ROOM_PASSWORD_LIMIT')
  assert.equal((await env.call(2, 'roomJoin', { roomId: room.id, password: '0012', team: roster })).room.memberCount, 2)
  for (const password of ['12345', '12a', '１２', 1234, null]) await rejects(env.call(3, 'roomCreate', { title: '형식', mode: 'league', format: 'single', team: roster, password }), 'INVALID_ROOM_PASSWORD')
})

test('host checks, one-room rule, ranked exclusions and canonical team ownership hold', async () => {
  let ownershipCalls = 0
  const env = environment({ resolveTeam: async (_identity, team) => { ownershipCalls += 1; if (team?.unowned) { const error = new Error('Unowned'); error.code = 'UNOWNED'; throw error } return team } })
  const room = await makeRoom(env, 2)
  assert.equal(ownershipCalls, 2)
  await rejects(env.call(1, 'roomStart', { roomId: room.id }), 'ROOM_HOST_ONLY')
  await rejects(env.call(8, 'roomLeave', { roomId: room.id }), 'ROOM_FORBIDDEN')
  await rejects(env.call(1, 'roomCreate', { title: '중복', mode: 'league', format: 'single', team: roster }), 'ALREADY_IN_ROOM')
  await rejects(env.call(0, 'join', { format: 'single', team: roster }), 'ALREADY_IN_ROOM')
  await env.call(3, 'join', { format: 'single', team: roster })
  await rejects(env.call(3, 'roomJoin', { roomId: room.id, team: roster }), 'ALREADY_QUEUED')
  await rejects(env.call(4, 'roomJoin', { roomId: room.id, team: { unowned: true } }), 'UNOWNED')
  await assert.rejects(env.call(4, 'roomJoin', { roomId: room.id, team: [...roster.slice(0, 5), roster[0]] }))
  const started = await env.call(0, 'roomStart', { roomId: room.id })
  await rejects(env.call(8, 'rooms', { matchId: started.match.id }), 'MATCH_FORBIDDEN')
  await rejects(env.call(8, 'forfeit', { matchId: started.match.id }), 'MATCH_FORBIDDEN')
  assert(!JSON.stringify(started.room).includes('moveIds'))
  assert.equal(started.match.teamPreview.opponent[0].heldItemId, undefined)
})

test('ten-minute and first-full one-minute deadlines delete rooms without leave/rejoin timer resets', async () => {
  const env = environment()
  const single = await makeRoom(env, 1)
  env.advance(600_000)
  await rejects(env.call(0, 'roomStart', { roomId: single.id }), 'ROOM_NOT_FOUND')
  assert.equal((await env.store.inspect()).collections.battleRooms[single.id], undefined, 'Expiry commits even if the expired room command is rejected')
  assert.equal((await env.call(0, 'rooms')).roomResult.reason, 'idle-timeout')
  assert.equal((await env.store.inspect()).collections.battleRooms[single.id], undefined)
  await rejects(env.call(0, 'roomStart', { roomId: single.id }), 'ROOM_NOT_FOUND')
  const full = await makeRoom(env, 4)
  const deadline = full.startDeadlineAt
  env.advance(30_000)
  await env.call(3, 'roomLeave', { roomId: full.id })
  await env.call(3, 'roomJoin', { roomId: full.id, team: roster })
  assert.equal((await env.call(0, 'rooms')).room.startDeadlineAt, deadline)
  env.advance(30_000)
  const expired = await env.call(0, 'rooms')
  assert.equal(expired.room, null)
  assert.equal(expired.roomResult.reason, 'full-timeout')
  assert.equal((await env.store.inspect()).collections.battleRooms[full.id], undefined)
})

test('room lists report ranked conflicts without rendering a ranked match and entering after expiry preserves settled rewards', async () => {
  const env = environment()
  await env.call(0, 'join', { format: 'single', team: roster })
  const waiting = await env.call(0, 'rooms')
  assert.equal(waiting.rankedConflict, true)
  assert.equal(waiting.match, null)
  const ranked = (await env.call(1, 'join', { format: 'single', team: roster })).match
  const snapshot = await env.call(0, 'rooms')
  assert.equal(snapshot.rankedConflict, true)
  assert.equal(snapshot.match, null)
  await rejects(env.call(0, 'roomCreate', { title: '충돌', mode: 'league', format: 'single', team: roster }), 'ALREADY_IN_MATCH')
  await env.call(0, 'select', { matchId: ranked.id, revision: ranked.revision, selection: [0, 1, 2] })
  env.advance(900)
  const next = await env.call(0, 'roomCreate', { title: '종료후', mode: 'league', format: 'single', team: roster })
  assert.equal(next.profile.single.played, 1)
  assert.equal(next.profile.single.wins, 1)
  assert.equal(next.rankedConflict, false)
})

test('tournament turn-limit draws use a published deterministic tiebreak and finish instead of stalling', async () => {
  const env = environment()
  const room = await makeRoom(env, 4)
  const initial = await env.call(0, 'roomStart', { roomId: room.id })
  const first = initial.room.matches.find(entry => entry.phase === 'select')
  let match = await startBattle(env, first.id)
  await env.store.transaction(async tx => { const stored = await tx.get('matches', match.id); stored.state.turn = 300; tx.set('matches', stored.id, stored) })
  match = await raw(env, match.id)
  const actions = [{ type: 'move', actorSlot: 0, moveIndex: 0, targetSideId: 'player', targetSlot: 0 }]
  const firstBody = { matchId: match.id, revision: match.revision, actions, requestId: 'draw-first-command' }
  const secondBody = { matchId: match.id, revision: match.revision, actions, requestId: 'draw-second-command' }
  await Promise.all([
    env.call(uidNumber(match.players[0].uid), 'submit', firstBody),
    env.call(uidNumber(match.players[1].uid), 'submit', secondBody),
  ])
  const result = await env.call(0, 'rooms')
  const tiebreak = result.room.matches.find(entry => entry.id === first.id)
  assert.equal(tiebreak.reason, 'draw-tiebreak-lottery')
  assert(tiebreak.winnerUid)
  await env.call(uidNumber(match.players[0].uid), 'submit', firstBody)
  await env.call(uidNumber(match.players[1].uid), 'submit', secondBody)
  assert.deepEqual((await env.call(0, 'rooms')).room.matches.find(entry => entry.id === first.id), tiebreak)
  const second = result.room.matches.find(entry => entry.phase === 'select')
  await env.call(uidNumber(second.players[0].uid), 'forfeit', { matchId: second.id })
  const finalRound = (await env.call(0, 'rooms')).room
  assert.equal(finalRound.round, 2)
  assert(finalRound.matches.find(entry => entry.round === 2).players.some(player => player.uid === tiebreak.winnerUid))
})

test('unrelated active rooms skip match reads until deadline and unchanged waiting/active polling does not write', async () => {
  const actual = createMemoryRankedStore()
  let writes = 0, matchReads = 0
  const store = { transaction: work => actual.transaction(tx => work({
    ...tx,
    get: (collection, key) => { if (collection === 'matches') matchReads += 1; return tx.get(collection, key) },
    set: (...args) => { writes += 1; return tx.set(...args) },
    delete: (...args) => { writes += 1; return tx.delete(...args) },
  })), inspect: () => actual.inspect() }
  const env = environment({ store })
  const room = await makeRoom(env, 2)
  writes = 0
  await env.call(0, 'rooms')
  assert.equal(writes, 0)
  await env.call(0, 'roomStart', { roomId: room.id })
  await env.call(8, 'rooms') // Creates this caller's player record once.
  writes = 0; matchReads = 0
  await env.call(8, 'rooms')
  assert.equal(writes, 0)
  assert.equal(matchReads, 0)
  await env.call(0, 'rooms')
  assert.equal(writes, 0)
})

test('host migration preserves deadline; empty rooms release capacity immediately', async () => {
  const env = environment()
  const room = await makeRoom(env, 2)
  await env.call(0, 'roomLeave', { roomId: room.id })
  const next = (await env.call(1, 'rooms')).room
  assert.equal(next.hostUid, who(1).uid)
  assert.equal(next.startDeadlineAt, room.startDeadlineAt)
  await env.call(1, 'roomLeave', { roomId: room.id })
  assert.equal((await env.call(1, 'rooms')).rooms.length, 0)
})

test('idempotent create/start/turn/forfeit retries never duplicate room matches or final results', async () => {
  const env = environment()
  const request = { title: '재시도', mode: 'tournament', format: 'single', team: roster, requestId: 'create-once-only' }
  const initial = await env.call(0, 'roomCreate', request)
  const retry = await env.call(0, 'roomCreate', request)
  assert.equal(retry.room.id, initial.room.id)
  await rejects(env.call(0, 'roomCreate', { ...request, title: '다른내용' }), 'REQUEST_ID_REUSED')
  await env.call(1, 'roomJoin', { roomId: initial.room.id, team: roster })
  const body = { roomId: initial.room.id, requestId: 'start-once-only' }
  const first = await env.call(0, 'roomStart', body)
  assert.equal((await env.call(0, 'roomStart', body)).match.id, first.match.id)
  await startBattle(env, first.match.id)
  const forfeit = { matchId: first.match.id, requestId: 'forfeit-once-only' }
  await env.call(0, 'forfeit', forfeit)
  const result = (await env.call(0, 'rooms')).roomResult
  await env.call(0, 'forfeit', forfeit)
  assert.deepEqual((await env.call(0, 'rooms')).roomResult, result)
  await env.call(0, 'roomDismissResult')
  assert.equal((await env.call(0, 'rooms')).roomResult, null)
})

test('two disconnected tournament entrants are disqualified; three-player bye advances and room cannot stall', async () => {
  const env = environment()
  const room = await makeRoom(env, 3)
  const start = await env.call(0, 'roomStart', { roomId: room.id })
  const bye = start.room.matches.find(entry => entry.phase === 'bye').winnerUid
  env.advance(900)
  const result = await env.call(0, 'rooms')
  assert.equal(result.room, null)
  assert.equal(result.roomResult.standings.find(entry => entry.uid === bye).rank, 1)
  assert.equal(result.roomResult.standings.filter(entry => entry.withdrawn).length, 2)
})

test('one selection or turn timeout awards opponent without RP; league double timeout disqualifies and finishes', async () => {
  const env = environment()
  let room = await makeRoom(env, 2)
  let match = (await env.call(0, 'roomStart', { roomId: room.id })).match
  await env.call(0, 'select', { matchId: match.id, revision: match.revision, selection: [0, 1, 2] })
  env.advance(900)
  let result = await env.call(0, 'rooms', { matchId: match.id })
  assert.equal(result.match.result.outcome, 'win')
  assert.equal(result.match.result.reason, 'selection-timeout')
  room = await makeRoom(env, 2)
  match = (await env.call(0, 'roomStart', { roomId: room.id })).match
  await startBattle(env, match.id)
  match = await raw(env, match.id)
  await env.call(0, 'submit', { matchId: match.id, revision: match.revision, actions: [{ type: 'move', actorSlot: 0, moveIndex: 0, targetSideId: 'player', targetSlot: 0 }] })
  env.advance(600)
  result = await env.call(0, 'rooms', { matchId: match.id })
  assert.equal(result.match.result.outcome, 'win')
  assert.equal(result.match.result.reason, 'turn-timeout')
  room = await makeRoom(env, 4, 'league')
  await env.call(0, 'roomStart', { roomId: room.id })
  env.advance(900)
  result = await env.call(0, 'rooms')
  assert.equal(result.room, null)
  assert.equal(result.roomResult.reason, 'all-withdrawn')
  assert.equal(result.roomResult.standings.every(row => row.points === 0), true)
})

test('leaving during a league idle round withdraws remaining matches and cannot stall the schedule', async () => {
  const env = environment()
  const room = await makeRoom(env, 3, 'league')
  const snap = await env.call(0, 'roomStart', { roomId: room.id })
  const active = snap.room.matches.find(entry => entry.phase === 'select')
  const idle = [0, 1, 2].find(member => !active.players.some(player => player.uid === who(member).uid))
  await env.call(idle, 'roomLeave', { roomId: room.id })
  assert.equal((await env.call(uidNumber(active.players[0].uid), 'rooms')).room.members.find(member => member.uid === who(idle).uid).withdrawn, true)
  await env.call(uidNumber(active.players[1].uid), 'forfeit', { matchId: active.id })
  const result = await env.call(uidNumber(active.players[0].uid), 'rooms')
  assert.equal(result.room, null)
  assert.equal(result.roomResult.standings.find(member => member.uid === who(idle).uid).losses, 2)
})

test('optimistic transaction retries keep room IDs, password hashes, tournament draws and engine outcomes deterministic', async () => {
  const actual = createMemoryRankedStore()
  const retry = new Error('Simulated optimistic conflict')
  const store = {
    async transaction(work) {
      let attempted
      try { await actual.transaction(async tx => { attempted = await work(tx); throw retry }) }
      catch (error) { if (error !== retry) throw error }
      const committed = await actual.transaction(work)
      assert.deepEqual(committed, attempted)
      return committed
    },
    inspect: () => actual.inspect(),
  }
  const env = environment({ store })
  const room = await makeRoom(env, 3, 'tournament', 'single', { password: '0042' })
  const started = await env.call(0, 'roomStart', { roomId: room.id })
  const match = started.room.matches.find(entry => entry.phase === 'select')
  await startBattle(env, match.id)
  assert.equal(Object.keys((await actual.inspect()).collections.battleRooms).length, 1)
  assert.equal(Object.keys((await actual.inspect()).collections.matches).length, 1)
})

for (const finishNewRoom of [false, true]) test(`an old league finishing after withdrawal preserves the entrant's ${finishNewRoom ? 'newer completed receipt' : 'new active room and match'}`, async () => {
  const env = environment()
  const oldRoom = await makeRoom(env, 3, 'league')
  const started = await env.call(0, 'roomStart', { roomId: oldRoom.id })
  const oldMatch = started.room.matches.find(entry => entry.phase === 'select')
  const idle = [0, 1, 2].find(member => !oldMatch.players.some(player => player.uid === who(member).uid))
  await env.call(idle, 'roomLeave', { roomId: oldRoom.id })
  const newer = await env.call(idle, 'roomCreate', { title: '새로운 대회', mode: 'tournament', format: 'single', team: roster })
  await env.call(9, 'roomJoin', { roomId: newer.room.id, team: roster })
  const newMatch = (await env.call(idle, 'roomStart', { roomId: newer.room.id })).match
  if (finishNewRoom) await env.call(9, 'forfeit', { matchId: newMatch.id })
  const before = (await env.store.inspect()).collections.players[who(idle).uid]
  await env.call(uidNumber(oldMatch.players[0].uid), 'forfeit', { matchId: oldMatch.id })
  assert.equal((await env.store.inspect()).collections.battleRooms[oldRoom.id], undefined)
  const after = (await env.store.inspect()).collections.players[who(idle).uid]
  assert.equal(after.activeRoomId, before.activeRoomId)
  assert.equal(after.activeMatchId, before.activeMatchId)
  assert.deepEqual(after.roomResult, before.roomResult)
  const visible = await env.call(idle, 'rooms')
  if (finishNewRoom) {
    assert.equal(visible.roomResult.roomId, newer.room.id)
    assert.equal(visible.room, null)
  } else {
    assert.equal(visible.room.id, newer.room.id)
    assert.equal(visible.match.id, newMatch.id)
    assert.equal(visible.roomResult, null)
  }
})

let passed = 0
for (const { name, run } of tests) {
  try { await run(); passed += 1; console.log(`PASS ${name}`) }
  catch (error) { console.error(`FAIL ${name}`); throw error }
}
console.log(`Battle rooms validation passed: ${passed}/${tests.length}`)
