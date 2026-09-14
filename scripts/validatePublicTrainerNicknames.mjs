import assert from 'node:assert/strict'
import {
  maskRankedTrainerName, maskRankedMatch, maskRankedBattleState,
} from '../src/data/rankedPrivacy.js'
import { normalizePokemon, getMoveById } from '../src/data/trainingData.js'
import { createRankedProfile } from '../src/data/rankedRules.js'
import { createMemoryRankedStore } from '../server/rankedStore.js'
import { createRankedService } from '../server/rankedService.js'
import { createGlobalChatService } from '../server/globalChatService.js'
import { createGuestIdentityRegistry } from '../server/guestIdentity.js'
import * as engine from '../server/rankedBattle.js'
import {
  createFactoryRun, selectFactoryRentals, selectFactoryLead, beginFactoryBattle, resolveFactoryBattle,
} from '../src/data/battleFactory.js'
import { createFactoryRankingSubmission } from '../src/data/battleFactoryRanking.js'
import { readRankedLeaderboard } from '../server/rankedLeaderboardService.js'

const tests = []
const test = (name, run) => tests.push({ name, run })
const clone = structuredClone
const alice = { uid: 'nickname-alice', name: '홍비공개본명', nickname: '피카츄', isGuest: false }
const bob = { uid: 'nickname-bob', name: '김비공개본명', nickname: '파도타기왕', isGuest: false }
const noName = { uid: 'nickname-unset', name: '박비공개본명', nickname: '', isGuest: false }
const roster = [25, 6, 9, 143, 68, 131].map(speciesId => normalizePokemon({ speciesId,
  captureId: `nickname-mon-${speciesId}`, moves: [getMoveById('protect').name] }))
function environment() {
  const store = createMemoryRankedStore()
  let timestamp = 1_000_000, serial = 0, requests = 0
  const service = createRankedService({ store, engine, now: () => timestamp,
    newId: () => `nickname-match-${++serial}`, makeSeed: () => 3, timeouts: { playbackGrace: 0 } })
  return { store, service, advance: () => { timestamp += 3000 },
    call: (identity, action, payload = {}) => service.execute(identity,
      { action, requestId: `nickname-request-${++requests}`, ...payload }) }
}
async function pair(env, first = alice, second = bob) {
  await env.call(first, 'join', { format: 'single', team: roster, nickname: '위조된닉네임', name: '위조이름' })
  const result = await env.call(second, 'join', { format: 'single', team: roster })
  return result.match
}
async function select(env, match, first = alice, second = bob) {
  await env.call(first, 'select', { matchId: match.id, revision: match.revision, selection: [0, 1, 2] })
  return (await env.call(second, 'select', { matchId: match.id, revision: match.revision, selection: [0, 1, 2] })).match
}
const noRawNames = value => assert.doesNotMatch(JSON.stringify(value), /홍비공개본명|김비공개본명|박비공개본명|위조된닉네임|위조이름/)

test('only an explicit validated nickname unmasks a regular account; guests and invalid nicknames retain existing rules', () => {
  assert.equal(maskRankedTrainerName(alice.name, false, alice.nickname), '피카츄')
  assert.equal(maskRankedTrainerName('피카츄', false, '피카츄'), '피카츄')
  assert.equal(maskRankedTrainerName('피카츄'), '피**', 'An untrusted display name cannot approve itself')
  for (const invalid of ['', null, undefined, '<script>', 'x', 'a'.repeat(13), '\u202e공개닉']) {
    assert.equal(maskRankedTrainerName(alice.name, false, invalid), '홍**')
  }
  assert.equal(maskRankedTrainerName('guest-123456', true, '설정한닉'), 'guest-123456')
  assert.equal(maskRankedTrainerName('guest-123456', false), 'g**')
})

test('legacy trainer positions use explicit nicknames without changing Pokemon names, move text or log keys', () => {
  const state = { player: { name: alice.name, nickname: '피카츄', team: [{ name: '피카츄' }] },
    opponent: { name: noName.name }, opponentMeta: { name: noName.name },
    log: [{ id: `${alice.name}-opening`, message: `${alice.name} vs ${noName.name}, 레이팅 배틀 시작!` },
      { id: `${alice.name}-switch`, message: `${alice.name}은(는) 피카츄을(를) 내보냈다!` },
      { id: 'pokemon-move', message: '피카츄의 10만볼트!' }] }
  const match = { you: { name: alice.name, nickname: '피카츄' }, opponent: { name: noName.name }, state,
    timeline: [{ message: `${alice.name}의 승리!`, actorName: '피카츄', state: clone(state) }] }
  const original = clone(match), view = maskRankedMatch(match)
  assert.equal(view.you.name, '피카츄')
  assert.equal(view.opponent.name, '박**')
  assert.equal(view.state.log[0].message, '피카츄 vs 박**, 레이팅 배틀 시작!')
  assert.equal(view.state.log[1].message, '피카츄은(는) 피카츄을(를) 내보냈다!')
  assert.equal(view.state.log[2].message, '피카츄의 10만볼트!')
  assert.equal(view.timeline[0].message, '피카츄의 승리!')
  assert.equal(view.timeline[0].actorName, '피카츄')
  assert.deepEqual(view.state.player.team, original.state.player.team)
  assert.deepEqual(maskRankedMatch(view), view)
  assert.deepEqual(match, original)
  noRawNames(view)
})

test('new battle states, both client perspectives, timeline and spectator views retain public nickname snapshots', () => {
  const state = engine.createRankedBattle({ playerTeam: roster.slice(0, 3), opponentTeam: roster.slice(3),
    playerName: alice.name, playerNickname: alice.nickname, opponentName: bob.name, opponentNickname: bob.nickname })
  assert.equal(state.player.name, alice.nickname)
  assert.equal(state.opponent.name, bob.nickname)
  noRawNames(state)
  for (const side of ['player', 'opponent']) {
    const view = engine.getRankedBattleView(state, side)
    const expected = side === 'player' ? [alice.nickname, bob.nickname] : [bob.nickname, alice.nickname]
    assert.deepEqual([view.player.name, view.opponent.name], expected)
    assert.deepEqual(maskRankedBattleState(view), view)
    const frames = engine.getRankedTimelineView([{ id: 'nickname-frame', phase: 'switch-out', sideId: 'player',
      actorSlot: 0, actorName: '피카츄', message: '피카츄은(는) 피카츄을(를) 불러들였다!', state }], side)
    assert.equal(frames[0].message, '피카츄은(는) 피카츄을(를) 불러들였다!')
    noRawNames({ view, frames })
  }
  const spectator = engine.getRoomSpectatorBattleView(state, 'nickname-spectator')
  assert.equal(spectator.player.name, alice.nickname)
  assert.equal(spectator.opponent.name, bob.nickname)
  noRawNames(spectator)
})

for (const fixture of [
  { label: 'same Google name on both accounts', firstName: '동일한본명', nickname: '공개닉네임', secondName: '동일한본명', firstLogName: '동**' },
  { label: 'approved nickname equals the opposing Google name', firstName: alice.name, nickname: '상대의본명', secondName: '상대의본명', firstLogName: '상대의본명' },
  { label: 'invalid nickname resembles the opponent masked label', firstName: alice.name, nickname: '김**', secondName: bob.name, firstLogName: '홍**' },
]) {
  test(`name collision: ${fixture.label} never approves the unconfigured account`, () => {
    const first = { name: fixture.firstName, nickname: fixture.nickname, isGuest: false }
    const second = { name: fixture.secondName, nickname: '', isGuest: false }
    const state = { player: clone(first), opponent: clone(second), opponentMeta: clone(second),
      log: [{ id: 'collision-opening', message: `${first.name} vs ${second.name}, 레이팅 배틀 시작!` },
        { id: 'collision-win', message: `${second.name}의 승리!` },
        { id: 'collision-pokemon', message: '피카츄의 10만볼트!' }] }
    const original = { you: first, opponent: second, state, timeline: [{ state: clone(state), message: `${second.name}의 승리!` }] }
    const masked = maskRankedMatch(original)
    const publicFirst = maskRankedTrainerName(first.name, false, first.nickname)
    const publicSecond = maskRankedTrainerName(second.name)
    assert.equal(masked.you.name, publicFirst)
    assert.equal(masked.opponent.name, publicSecond)
    assert.equal(masked.state.player.name, publicFirst)
    assert.equal(masked.state.opponent.name, publicSecond)
    assert.equal(masked.state.opponentMeta.name, publicSecond)
    assert.equal(masked.state.log[0].message, `${fixture.firstLogName} vs ${publicSecond}, 레이팅 배틀 시작!`)
    assert.equal(masked.state.log[1].message, `${publicSecond}의 승리!`)
    assert.equal(masked.timeline[0].message, `${publicSecond}의 승리!`)
    assert.equal(masked.state.log[2].message, '피카츄의 10만볼트!')
    assert.deepEqual(maskRankedMatch(masked), masked)
    const newState = engine.createRankedBattle({ playerTeam: roster.slice(0, 3), opponentTeam: roster.slice(3),
      playerName: first.name, playerNickname: first.nickname, opponentName: second.name })
    for (const side of ['player', 'opponent']) {
      const view = engine.getRankedBattleView(newState, side)
      assert.equal(view.player.name, side === 'player' ? publicFirst : publicSecond)
      assert.equal(view.opponent.name, side === 'player' ? publicSecond : publicFirst)
      assert.deepEqual(maskRankedBattleState(view), view)
    }
  })
}

test('ranked matchmaking ignores payload identity and preserves nicknames through selection and both battle views', async () => {
  const env = environment(), matched = await pair(env)
  assert.equal(matched.you.name, bob.nickname)
  assert.equal(matched.opponent.name, alice.nickname)
  const selected = await select(env, matched)
  assert.equal(selected.state.player.name, bob.nickname)
  assert.equal(selected.state.opponent.name, alice.nickname)
  const other = await env.call(alice, 'status', { matchId: matched.id })
  assert.equal(other.match.you.name, alice.nickname)
  assert.equal(other.match.state.player.name, alice.nickname)
  assert.equal(other.match.state.opponent.name, bob.nickname)
  noRawNames([matched, selected, other])
})

test('finished match snapshots retain their original public nicknames after an account rename', async () => {
  const env = environment(), match = await pair(env)
  await env.call(bob, 'forfeit', { matchId: match.id })
  const result = await env.call({ ...alice, nickname: '새로운닉네임' }, 'status', { matchId: match.id })
  assert.equal(result.match.phase, 'finished')
  assert.equal(result.match.you.name, alice.nickname)
  assert.equal(result.match.opponent.name, bob.nickname)
  noRawNames(result)
})

test('an account renamed while queued uses its refreshed nickname in the next match', async () => {
  for (const action of ['status', 'join']) {
    const env = environment()
    const queued = await env.call(alice, 'join', { format: 'single', team: roster })
    const renamed = { ...alice, nickname: '새로운닉네임' }
    const refreshed = await env.call(renamed, action, action === 'join' ? { format: 'single', team: roster } : {})
    assert.equal(refreshed.queue.ticket, queued.queue.ticket)
    const matched = await env.call(bob, 'join', { format: 'single', team: roster })
    assert.equal(matched.match.opponent.name, renamed.nickname)
    noRawNames(matched)
  }
})

test('room members, scheduled matches, battle snapshots and final standings use verified nicknames', async () => {
  const env = environment()
  const created = await env.call(alice, 'roomCreate', { title: '닉네임 대회', mode: 'tournament', format: 'single', team: roster, nickname: '위조된닉네임' })
  const joined = await env.call(bob, 'roomJoin', { roomId: created.room.id, team: roster, name: '위조이름' })
  assert.deepEqual(joined.room.members.map(member => member.name), [alice.nickname, bob.nickname])
  const started = await env.call(alice, 'roomStart', { roomId: created.room.id })
  assert.deepEqual(started.room.matches[0].players.map(member => member.name).sort(), [alice.nickname, bob.nickname].sort())
  const match = started.match
  await select(env, match)
  await env.call(bob, 'forfeit', { matchId: match.id })
  const ended = await env.call(alice, 'rooms', { matchId: match.id })
  assert.equal(ended.roomResult.championName, alice.nickname)
  assert.deepEqual(ended.roomResult.standings.map(member => member.name).sort(), [alice.nickname, bob.nickname].sort())
  noRawNames([created, joined, started, ended])
})

test('new chat messages reflect nickname changes and clearing; old messages remain honest snapshots', async () => {
  const store = createMemoryRankedStore()
  let time = 1000000, id = 0
  const service = createGlobalChatService({ store, now: () => time, newId: () => `nickname-chat-${++id}` })
  const send = async (nickname, extra = {}) => { time += 3000; return service.execute({ ...alice, nickname },
    { action: 'send', text: '배틀을 시작해요', requestId: `nickname-chat-request-${id + 1}`, ...extra }) }
  await send('피카츄', { nickname: '위조된닉네임', name: '위조이름' })
  await send('파도타기왕')
  const snapshot = await send('')
  assert.deepEqual(snapshot.messages.map(message => message.name), ['피카츄', '파도타기왕', '홍**'])
  noRawNames(snapshot)
})

test('renaming an existing room member updates its next view and next scheduled match without rejoining', async () => {
  for (const refresh of ['rooms', 'rankedLeaderboard']) {
    const env = environment()
    const created = await env.call(alice, 'roomCreate', { title: '닉네임 대회', mode: 'tournament', format: 'single', team: roster })
    await env.call(bob, 'roomJoin', { roomId: created.room.id, team: roster })
    const renamed = { ...bob, nickname: '바뀐참가자' }
    const refreshed = await env.call(renamed, refresh)
    if (refresh === 'rooms') assert.equal(refreshed.room.members.find(member => member.uid === bob.uid).name, renamed.nickname)
    const started = await env.call(alice, 'roomStart', { roomId: created.room.id })
    assert.equal(started.match.opponent.name, renamed.nickname)
    assert.equal(started.room.members.find(member => member.uid === bob.uid).name, renamed.nickname)
    const selected = await select(env, started.match, alice, renamed)
    assert.equal(selected.state.player.name, renamed.nickname)
    assert.equal(selected.state.opponent.name, alice.nickname)
    noRawNames([refreshed, started, selected])
  }
})

test('verified guest chat IDs cannot be replaced by any supplied nickname', async () => {
  const store = createMemoryRankedStore()
  const guestRegistry = createGuestIdentityRegistry({ store, number: () => 123456 })
  const identity = { uid: 'nickname-guest', name: '위조이름', nickname: '위조된닉네임', isGuest: true }
  const guest = await guestRegistry.create(identity)
  const service = createGlobalChatService({ store, guestRegistry, newId: () => 'nickname-guest-message' })
  const result = await service.execute(identity, { action: 'send', text: '안녕하세요', requestId: 'nickname-guest-request' })
  assert.equal(result.latest.name, guest.displayName)
  assert.match(result.latest.name, /^guest-\d{6}$/)
  noRawNames(result)
})

test('ranked leaderboard refresh changes only the authenticated viewer name, preserves scores and is write-free when unchanged', async () => {
  let writes = 0
  const store = createMemoryRankedStore(undefined, { persist: async () => { writes++ } })
  const stats = { single: { ...createRankedProfile('single'), played: 4, wins: 3, losses: 1, points: 400 }, double: createRankedProfile('double') }
  await store.transaction(tx => {
    tx.set('players', alice.uid, { ...alice, nickname: '', profiles: stats, history: [{ marker: 'preserve' }], activeMatchId: 'existing-match' })
    tx.set('players', bob.uid, { ...bob, profiles: stats })
  })
  const before = (await store.inspect()).collections.players[alice.uid]
  const service = createRankedService({ store, engine })
  const first = await service.execute(alice, { action: 'rankedLeaderboard', nickname: '위조된닉네임' })
  assert.equal(first.boards.single.entries.find(entry => entry.isOwn).trainerName, alice.nickname)
  assert.equal(first.boards.single.entries.find(entry => !entry.isOwn).trainerName, bob.nickname)
  const stored = (await store.inspect()).collections.players[alice.uid]
  assert.deepEqual(stored.profiles, before.profiles)
  assert.deepEqual(stored.history, before.history)
  assert.equal(stored.activeMatchId, before.activeMatchId)
  const count = writes
  await service.execute(alice, { action: 'rankedLeaderboard' })
  assert.equal(writes, count)
  const clear = await service.execute({ ...alice, nickname: '' }, { action: 'rankedLeaderboard' })
  assert.equal(clear.boards.single.entries.find(entry => entry.isOwn).trainerName, '홍**')
  noRawNames([first, clear])
})

test('ranked compact projection keeps stored nicknames without account lookups or writes', async () => {
  let reads = 0
  const result = await readRankedLeaderboard({
    listRankedProfiles: async () => { reads++; return [{ ...alice, profiles: { single: { ...createRankedProfile('single'), played: 1, wins: 1 } } }] },
    get: () => assert.fail('No extra profile lookup'), set: () => assert.fail('No write'),
  }, alice.uid, 1, alice)
  assert.equal(reads, 1)
  assert.equal(result.boards.single.entries[0].trainerName, alice.nickname)
  noRawNames(result)
})

function factoryReport() {
  let run = createFactoryRun({ seed: 42, id: 'nickname-factory-run' })
  run = selectFactoryRentals(run, run.offers.slice(0, 3).map(pokemon => pokemon.captureId))
  run = beginFactoryBattle(selectFactoryLead(run, run.party[0].captureId))
  run = resolveFactoryBattle(run, { battleId: run.battleId, winner: 'opponent' })
  return createFactoryRankingSubmission(run)
}
test('factory leaderboard refresh changes current nickname without replacing the accepted run, time, party or row ID', async () => {
  const env = environment(), report = factoryReport()
  const first = await env.call({ ...alice, nickname: '' }, 'reportFactoryRun', { report })
  const original = first.ownBest
  const renamed = await env.call(alice, 'factoryLeaderboard', { nickname: '위조된닉네임' })
  assert.equal(renamed.ownBest.trainerName, alice.nickname)
  assert.equal(renamed.entries[0].trainerName, alice.nickname)
  assert.deepEqual({ ...renamed.ownBest, trainerName: original.trainerName }, original)
  const peer = await env.call(bob, 'factoryLeaderboard')
  assert.equal(peer.entries[0].trainerName, alice.nickname)
  const cleared = await env.call({ ...alice, nickname: '' }, 'factoryLeaderboard')
  assert.equal(cleared.ownBest.trainerName, '홍**')
  assert.deepEqual({ ...cleared.ownBest, trainerName: original.trainerName }, original)
  noRawNames([first, renamed, peer, cleared])
})

test('factory retry can refresh the public nickname while retaining the original score and acceptance snapshot', async () => {
  const env = environment(), report = factoryReport()
  const first = await env.call(alice, 'reportFactoryRun', { report })
  env.advance()
  const retry = await env.call({ ...alice, nickname: '새로운닉네임' }, 'reportFactoryRun', { report })
  assert.equal(retry.ownBest.trainerName, '새로운닉네임')
  assert.deepEqual({ ...retry.ownBest, trainerName: first.ownBest.trainerName }, first.ownBest)
})

let passed = 0
for (const { name, run } of tests) {
  try { await run(); passed++; console.log(`PASS ${name}`) }
  catch (error) { console.error(`FAIL ${name}\n${error.stack}`); process.exitCode = 1 }
}
console.log(`Public trainer nickname validation: ${passed}/${tests.length} passed`)
