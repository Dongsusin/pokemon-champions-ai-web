import assert from 'node:assert/strict'
import { mkdir, mkdtemp, unlink, rmdir, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import { createRankedService, RankedError } from '../server/rankedService.js'
import { createMemoryRankedStore, createFileRankedStore, createFirestoreRankedStore } from '../server/rankedStore.js'
import { createRankedHttpHandler, createLocalRankedAuthenticator, createFirebaseRankedTeamResolver, handleProductionRankedRequest } from '../server/rankedHttp.js'
import { startRankedDevServer } from './rankedDevServer.mjs'
import { canonicalizeRankedTeam } from '../server/rankedBattle.js'
import { normalizePokemon } from '../src/data/trainingData.js'
import { getRankedVpReward, RANKED_VP_REWARDS } from '../src/data/rankedRewards.js'

let checked = 0
const tests = []
const test = (name, run) => tests.push({ name, run })
const identities = Object.fromEntries(['alice', 'bob', 'charlie', 'dana'].map(name => [name, { uid: `ranked-test-${name}`, name }]))
const team = number => Array.from({ length: 6 }, (_, index) => ({ captureId: `fixture-${number}-${index}`, speciesId: index + 1, name: `Pokemon ${index}`, moves: ['secret-move'], heldItemId: 'secret-item', stats: { attack: 123 } }))
const fakeEngine = () => {
  const calls = { turns: 0, replacements: 0, actions: [] }
  return {
    calls,
    canonicalizeRankedTeam(entries) {
      if (!Array.isArray(entries) || entries.length !== 6) throw new RankedError('INVALID_TEAM', 'Six Pokemon required')
      return structuredClone(entries)
    },
    createRankedBattle({ playerTeam, opponentTeam, format }) { return { format, turn: 1, player: { team: playerTeam }, opponent: { team: opponentTeam }, winner: null } },
    validateRankedAction(_state, side, actions) {
      if (actions.length !== 1 || !['move', 'switch'].includes(actions[0].type)) throw new RankedError('INVALID_ACTION', 'Invalid action')
      calls.actions.push({ side, actions: structuredClone(actions) })
      return structuredClone(actions)
    },
    resolveRankedTurn(state, actions) {
      calls.turns += 1
      const next = structuredClone(state)
      next.turn += 1
      if (actions.player[0].finish) next.winner = ['player', 'opponent', 'draw'].includes(actions.player[0].finish) ? actions.player[0].finish : 'player'
      if (actions.player[0].turnLimit) next.turn = 301
      if (actions.player[0].replacement) next.pendingHumanSwitch = { sideId: 'player', kind: 'faint' }
      return { state: next, timeline: [{ state: structuredClone(next) }] }
    },
    resolveRankedReplacement(state, side, targetIndex) {
      calls.replacements += 1
      if (targetIndex === 0) throw new RankedError('INVALID_REPLACEMENT', 'Already active')
      const next = structuredClone(state)
      delete next.pendingHumanSwitch
      return { state: next, timeline: [{ state: next }] }
    },
    getRankedBattleView(state, side) {
      return { turn: state.turn, winner: state.winner, pendingHumanSwitch: state.pendingHumanSwitch ? { ...state.pendingHumanSwitch, sideId: state.pendingHumanSwitch.sideId === side ? 'player' : 'opponent' } : null, side }
    },
    getRankedTimelineView(timeline, side) { return timeline.map(frame => ({ state: this.getRankedBattleView(frame.state, side) })) },
  }
}
function environment(options = {}) {
  const store = options.store ?? createMemoryRankedStore()
  const engine = options.engine ?? fakeEngine()
  let current = 1_000_000
  let id = 0
  const service = createRankedService({ store, engine, now: () => current, newId: () => `test-match-${++id}`, makeSeed: () => 1, timeouts: { selection: 1000, turn: 1000, replacement: 1000, playbackGrace: 0 }, ...options })
  let request = 0
  const call = (who, action, payload = {}) => service.execute(identities[who], { action, ...(action === 'status' ? {} : { requestId: `request-${++request}` }), ...payload })
  return { store, service, engine, call, advance: milliseconds => { current += milliseconds } }
}
async function paired(env, format = 'single') {
  await env.call('alice', 'join', { format, team: team('a') })
  const joined = await env.call('bob', 'join', { format, team: team('b') })
  return joined.match
}
async function battle(env, format = 'single') {
  const match = await paired(env, format)
  const selection = format === 'single' ? [0, 1, 2] : [0, 1, 2, 3]
  await env.call('alice', 'select', { matchId: match.id, revision: match.revision, selection })
  return (await env.call('bob', 'select', { matchId: match.id, revision: match.revision, selection })).match
}
const command = (match, action = {}) => ({ matchId: match.id, revision: match.revision, actions: [{ type: 'move', ...action }] })
const rejectsCode = async (promise, code) => assert.rejects(promise, error => error.code === code)

test('VP reward policy awards completed battles and protects prebattle or abandoned matches', () => {
  assert.deepEqual(RANKED_VP_REWARDS, { win: 600, loss: 200, draw: 300 })
  for (const [outcome, amount] of Object.entries(RANKED_VP_REWARDS)) {
    for (const reason of ['battle', 'turn-limit']) assert.equal(getRankedVpReward({ outcome, reason, battleStarted: true }), amount)
    for (const reason of ['forfeit', 'turn-timeout', 'replacement-timeout']) assert.equal(getRankedVpReward({ outcome, reason, battleStarted: true }), outcome === 'win' ? 600 : 0)
    for (const reason of ['selection-timeout', 'both-selection-timeout', 'both-timeout', 'unknown']) assert.equal(getRankedVpReward({ outcome, reason, battleStarted: true }), 0)
    for (const reason of ['battle', 'turn-limit', 'forfeit', 'turn-timeout', 'replacement-timeout']) assert.equal(getRankedVpReward({ outcome, reason, battleStarted: false }), 0)
  }
  assert.equal(getRankedVpReward(), 0)
  assert.equal(getRankedVpReward({ outcome: 'toString', reason: 'battle', battleStarted: true }), 0)
})

test('new and existing accounts expose only their authenticated cumulative VP reward total', async () => {
  const env = environment()
  const initial = await env.call('alice', 'status')
  assert.deepEqual(initial.vpRewards, { uid: identities.alice.uid, total: 0 })
  assert.equal((await env.store.inspect()).collections.players[identities.alice.uid].vpRewardTotal, 0)
  await env.store.transaction(async tx => { const player = await tx.get('players', identities.alice.uid); player.vpRewardTotal = 1200; tx.set('players', player.uid, player) })
  assert.deepEqual((await env.call('alice', 'status')).vpRewards, { uid: identities.alice.uid, total: 1200 })
  assert.deepEqual((await env.call('bob', 'status', { vpRewards: { uid: identities.alice.uid, total: 999999 } })).vpRewards, { uid: identities.bob.uid, total: 0 })
})

test('ordinary wins and losses award server-computed VP exactly once under concurrent commands and retries', async () => {
  for (const format of ['single', 'double']) {
    const env = environment()
    const match = await battle(env, format)
    const first = { ...command(match, { finish: true }), requestId: 'vp-alice-finish', rewardVp: 999999, vpRewardTotal: 999999 }
    const second = { ...command(match), requestId: 'vp-bob-finish', vpRewards: { uid: identities.bob.uid, total: 999999 } }
    await Promise.all([env.call('alice', 'submit', first), env.call('bob', 'submit', second)])
    await Promise.all(Array.from({ length: 4 }, () => Promise.all([env.call('alice', 'submit', first), env.call('bob', 'submit', second)])))
    assert.equal(env.engine.calls.turns, 1)
    for (const [who, amount, outcome] of [['alice', 600, 'win'], ['bob', 200, 'loss']]) {
      const result = await env.call(who, 'status', { matchId: match.id })
      assert.equal(result.match.result.outcome, outcome)
      assert.equal(result.match.result.rewardVp, amount)
      assert.deepEqual(result.vpRewards, { uid: identities[who].uid, total: amount })
      assert.equal(result.profile[format].played, 1)
      const reconnect = await env.call(who, 'status')
      assert.equal(reconnect.match, null)
      assert.equal(reconnect.vpRewards.total, amount)
      const record = (await env.store.inspect()).collections.players[identities[who].uid]
      assert.equal(record.history[0].rewardVp, amount)
      assert.equal(record.vpRewardTotal, amount)
    }
  }
})

test('a failed settlement transaction rolls back ratings and VP before a successful retry', async () => {
  const store = createMemoryRankedStore()
  const transaction = store.transaction.bind(store)
  let failCommit = false
  store.transaction = work => transaction(async tx => {
    const value = await work(tx)
    if (failCommit) { failCommit = false; throw new Error('simulated commit failure') }
    return value
  })
  const env = environment({ store })
  const match = await battle(env)
  await env.call('alice', 'submit', command(match, { finish: true }))
  const lastCommand = { ...command(match), requestId: 'retry-failed-vp-settlement' }
  failCommit = true
  await assert.rejects(env.call('bob', 'submit', lastCommand), /simulated commit failure/)
  for (const who of ['alice', 'bob']) {
    const status = await env.call(who, 'status')
    assert.equal(status.match.phase, 'battle')
    assert.equal(status.profile.single.played, 0)
    assert.equal(status.vpRewards.total, 0)
  }
  await env.call('bob', 'submit', lastCommand)
  await env.call('bob', 'submit', lastCommand)
  assert.equal((await env.call('alice', 'status')).vpRewards.total, 600)
  assert.equal((await env.call('bob', 'status')).vpRewards.total, 200)
  assert.equal((await env.call('alice', 'status')).profile.single.played, 1)
})

test('normal draws and the turn limit both grant 300 VP to each participant', async () => {
  for (const [action, reason] of [[{ finish: 'draw' }, 'battle'], [{ turnLimit: true }, 'turn-limit']]) {
    const env = environment()
    const match = await battle(env)
    await env.call('alice', 'submit', command(match, action))
    await env.call('bob', 'submit', command(match))
    for (const who of ['alice', 'bob']) {
      const result = await env.call(who, 'status', { matchId: match.id })
      assert.equal(result.match.result.reason, reason)
      assert.equal(result.match.result.outcome, 'draw')
      assert.equal(result.match.result.rewardVp, 300)
      assert.equal(result.vpRewards.total, 300)
      assert.equal(result.profile.single.draws, 1)
    }
  }
})

test('forfeiting before both selections complete never grants VP to either account', async () => {
  const env = environment()
  const match = await paired(env)
  await env.call('alice', 'select', { matchId: match.id, revision: match.revision, selection: [0, 1, 2] })
  await env.call('bob', 'forfeit', { matchId: match.id })
  for (const who of ['alice', 'bob']) {
    const result = await env.call(who, 'status', { matchId: match.id })
    assert.equal(result.match.state, null)
    assert.equal(result.match.result.rewardVp, 0)
    assert.equal(result.vpRewards.total, 0)
    assert.equal(result.profile.single.played, 1, 'Existing rating settlement must stay unchanged')
  }
})

test('VP totals survive more than 20 matches, format changes, and a fresh service instance', async () => {
  const env = environment()
  let oldMatchId
  for (let index = 0; index < 22; index += 1) {
    const format = Math.floor(index / 2) % 2 ? 'double' : 'single'
    const match = await battle(env, format)
    oldMatchId ??= match.id
    await env.call('alice', 'submit', command(match, { finish: index % 2 ? 'opponent' : 'player' }))
    await env.call('bob', 'submit', command(match))
  }
  const reconnected = createRankedService({ store: env.store, engine: env.engine })
  for (const who of ['alice', 'bob']) {
    const record = (await env.store.inspect()).collections.players[identities[who].uid]
    assert.equal(record.history.length, 20)
    assert.equal(record.vpRewardTotal, 8800)
    assert.equal(record.history.reduce((sum, result) => sum + result.rewardVp, 0), 8000)
    const result = await reconnected.execute(identities[who], { action: 'status' })
    assert.equal(result.match, null)
    assert.deepEqual(result.vpRewards, { uid: identities[who].uid, total: 8800 })
    await env.call(who, 'forfeit', { matchId: oldMatchId })
    assert.equal((await env.call(who, 'status')).vpRewards.total, 8800, 'An old retry cannot pay again after history eviction')
  }
})

test('legacy finished matches are never retroactively paid and new battles start their counter at zero', async () => {
  const env = environment()
  const match = await battle(env)
  await env.call('alice', 'submit', command(match, { finish: true }))
  await env.call('bob', 'submit', command(match))
  await env.store.transaction(async tx => {
    const finished = await tx.get('matches', match.id)
    for (const result of finished.result) delete result.rewardVp
    tx.set('matches', match.id, finished)
    for (const who of ['alice', 'bob']) {
      const player = await tx.get('players', identities[who].uid)
      delete player.vpRewardTotal
      player.activeMatchId = match.id
      for (const result of player.history) delete result.rewardVp
      tx.set('players', player.uid, player)
    }
  })
  for (const who of ['alice', 'bob']) {
    const status = await env.call(who, 'status')
    assert.equal(status.match, null)
    assert.equal(status.vpRewards.total, 0)
    const retry = await env.call(who, 'forfeit', { matchId: match.id })
    assert.equal(retry.match.result.rewardVp, undefined)
    assert.equal(retry.vpRewards.total, 0)
  }
  const next = await battle(env)
  await env.call('alice', 'submit', command(next, { finish: 'opponent' }))
  await env.call('bob', 'submit', command(next))
  assert.equal((await env.call('alice', 'status')).vpRewards.total, 200)
  assert.equal((await env.call('bob', 'status')).vpRewards.total, 600)
})

test('already paid rewards retain their original amounts after the reward increase and only new matches use doubled VP', async () => {
  const env = environment()
  const oldMatch = await battle(env)
  await env.call('alice', 'submit', command(oldMatch, { finish: true }))
  await env.call('bob', 'submit', command(oldMatch))
  const oldAmounts = { 'ranked-test-alice': 300, 'ranked-test-bob': 100 }
  await env.store.transaction(async tx => {
    const finished = await tx.get('matches', oldMatch.id)
    finished.result.forEach((result, index) => { result.rewardVp = oldAmounts[finished.players[index].uid] })
    tx.set('matches', oldMatch.id, finished)
    for (const who of ['alice', 'bob']) {
      const player = await tx.get('players', identities[who].uid)
      player.vpRewardTotal = oldAmounts[player.uid]
      for (const result of player.history) result.rewardVp = oldAmounts[player.uid]
      tx.set('players', player.uid, player)
    }
  })
  for (const who of ['alice', 'bob']) {
    const expected = oldAmounts[identities[who].uid]
    assert.equal((await env.call(who, 'status')).vpRewards.total, expected)
    const replay = await env.call(who, 'forfeit', { matchId: oldMatch.id })
    assert.equal(replay.match.result.rewardVp, expected)
    assert.equal(replay.vpRewards.total, expected)
  }
  const next = await battle(env)
  await env.call('alice', 'submit', command(next, { finish: true }))
  await env.call('bob', 'submit', command(next))
  assert.equal((await env.call('alice', 'status')).vpRewards.total, 900)
  assert.equal((await env.call('bob', 'status')).vpRewards.total, 300)
  for (const who of ['alice', 'bob']) {
    const player = (await env.store.inspect()).collections.players[identities[who].uid]
    assert.equal(player.history.find(result => result.matchId === oldMatch.id).rewardVp, oldAmounts[player.uid])
  }
})

test('simultaneous queue joins create one match without self matching', async () => {
  const env = environment()
  const outcomes = await Promise.all(['alice', 'bob'].map(who => env.call(who, 'join', { format: 'single', team: team(who) })))
  const alice = await env.call('alice', 'status')
  const bob = await env.call('bob', 'status')
  assert.equal(alice.match.id, bob.match.id)
  assert.notEqual(alice.match.you.name, alice.match.opponent.name)
  assert.equal((await env.store.inspect()).collections.queue && Object.keys((await env.store.inspect()).collections.queue).length, 0)
  assert.equal(outcomes.filter(value => value.match).length, 1)
})
test('repeated queue request is idempotent; reused ID with another team is rejected', async () => {
  const env = environment()
  const body = { format: 'single', team: team('a'), requestId: 'duplicate-join' }
  const first = await env.call('alice', 'join', body)
  const again = await env.call('alice', 'join', body)
  assert.equal(first.queue.ticket, again.queue.ticket)
  await rejectsCode(env.call('alice', 'join', { ...body, team: team('b') }), 'REQUEST_ID_REUSED')
  assert.equal((await env.call('alice', 'status')).match, null)
})
test('single and doubles queues never mix', async () => {
  const env = environment()
  await env.call('alice', 'join', { format: 'single', team: team('a') })
  assert.equal((await env.call('bob', 'join', { format: 'double', team: team('b') })).match, null)
  const paired = await env.call('charlie', 'join', { format: 'single', team: team('c') })
  assert.equal(paired.match.opponent.name, 'a**')
  assert.equal((await env.call('bob', 'status')).queue.format, 'double')
})
test('waiting queue polls write only once per ten-second heartbeat and retain the thirty-second lease', async () => {
  const actual = createMemoryRankedStore()
  let writes = 0, scans = 0
  const store = { transaction: work => actual.transaction(tx => work({
    get: (...args) => tx.get(...args),
    list: (...args) => { scans += 1; return tx.list(...args) },
    set: (...args) => { writes += 1; return tx.set(...args) },
    delete: (...args) => { writes += 1; return tx.delete(...args) },
  })), inspect: () => actual.inspect() }
  const env = environment({ store })
  const initial = await env.call('alice', 'join', { format: 'single', team: team('a') })
  const before = await actual.inspect()
  writes = 0; scans = 0
  for (let poll = 0; poll < 60; poll += 1) {
    env.advance(150)
    const status = await env.call('alice', 'status')
    assert.equal(status.queue.ticket, initial.queue.ticket)
    assert.equal(status.queue.expiresAt, initial.queue.expiresAt)
  }
  assert.equal(writes, 0)
  assert.equal(scans, 0)
  assert.deepEqual(await actual.inspect(), before)
  env.advance(1_000)
  const renewed = await env.call('alice', 'status')
  assert.equal(renewed.queue.expiresAt, renewed.serverTime + 30_000)
  assert.equal(renewed.queue.expiresAt, initial.queue.expiresAt + 10_000)
  assert.equal(writes, 2, 'Only the lobby lock and queue lease are written')
  assert.equal(scans, 1)
  writes = 0; scans = 0
  await Promise.all(Array.from({ length: 30 }, () => env.call('alice', 'status')))
  assert.equal(writes, 0)
  assert.equal(scans, 0)
  // Matching must not wait for the next heartbeat when someone joins now.
  const paired = await env.call('bob', 'join', { format: 'single', team: team('b') })
  assert(paired.match)
  assert.equal(paired.match.opponent.name, 'a**')
  assert.equal((await env.call('alice', 'status')).match.id, paired.match.id)
})
test('matching search expands by wait time and expired queues cannot match', async () => {
  const env = environment()
  await env.call('bob', 'status')
  await env.store.transaction(async tx => { const player = await tx.get('players', identities.bob.uid); player.profiles.single.rating = 1300; tx.set('players', player.uid, player) })
  await env.call('alice', 'join', { format: 'single', team: team('a') })
  assert.equal((await env.call('bob', 'join', { format: 'single', team: team('b') })).match, null)
  env.advance(16_000)
  await env.call('alice', 'status'); await env.call('bob', 'status')
  env.advance(16_000)
  assert((await env.call('alice', 'status')).match)
  const expired = environment()
  await expired.call('alice', 'join', { format: 'single', team: team('a') })
  expired.advance(31_000)
  assert.equal((await expired.call('bob', 'join', { format: 'single', team: team('b') })).match, null)
  assert.equal((await expired.call('alice', 'status')).queue, null)
})
test('cancellation racing a match preserves the newly created match', async () => {
  const env = environment()
  const queued = await env.call('alice', 'join', { format: 'single', team: team('a') })
  const [joined, cancelled] = await Promise.all([
    env.call('bob', 'join', { format: 'single', team: team('b') }),
    env.call('alice', 'cancel', { queueTicket: queued.queue.ticket }),
  ])
  if (joined.match) {
    assert.equal(joined.match.id, cancelled.match.id)
    assert.equal(cancelled.match.phase, 'select')
  } else {
    assert.equal(cancelled.match, null)
    assert.equal(cancelled.queue, null)
    assert(joined.queue)
  }
  const matched = environment()
  const old = await matched.call('alice', 'join', { format: 'single', team: team('a') })
  const result = await matched.call('bob', 'join', { format: 'single', team: team('b') })
  const cancelAfterMatch = await matched.call('alice', 'cancel', { queueTicket: old.queue.ticket })
  assert.equal(result.match.id, cancelAfterMatch.match.id)
})
test('stale queue cancellation cannot cancel a newer search', async () => {
  const env = environment()
  const queued = await env.call('alice', 'join', { format: 'single', team: team('a') })
  await env.call('alice', 'cancel', { queueTicket: queued.queue.ticket })
  const next = await env.call('alice', 'join', { format: 'single', team: team('a') })
  await rejectsCode(env.call('alice', 'cancel', { queueTicket: queued.queue.ticket }), 'STALE_QUEUE')
  assert.equal((await env.call('alice', 'status')).queue.ticket, next.queue.ticket)
})
test('preview hides opponent loadout and submitted selection', async () => {
  const env = environment()
  const match = await paired(env)
  assert.equal(match.teamPreview.opponent[0].moves, undefined)
  assert.equal(match.teamPreview.opponent[0].heldItemId, undefined)
  assert.equal(match.teamPreview.opponent[0].stats, undefined)
  await env.call('alice', 'select', { matchId: match.id, revision: match.revision, selection: [2, 0, 1] })
  const bob = await env.call('bob', 'status')
  assert.equal(bob.match.opponentSelectionSubmitted, true)
  assert.deepEqual(bob.match.selectedIndices, [])
  assert.equal(bob.match.selections, undefined)
})
test('selection requires distinct three/four Pokemon and freezes after submission', async () => {
  const env = environment()
  const match = await paired(env, 'double')
  await rejectsCode(env.call('alice', 'select', { matchId: match.id, revision: 1, selection: [0, 1, 2] }), 'INVALID_SELECTION')
  await rejectsCode(env.call('alice', 'select', { matchId: match.id, revision: 1, selection: [0, 0, 1, 2] }), 'INVALID_SELECTION')
  await env.call('alice', 'select', { matchId: match.id, revision: 1, selection: [0, 1, 2, 3] })
  await rejectsCode(env.call('alice', 'select', { matchId: match.id, revision: 1, selection: [1, 0, 2, 3] }), 'ALREADY_SUBMITTED')
})
test('both command submissions resolve exactly one server turn and remain private', async () => {
  const env = environment()
  const match = await battle(env)
  const first = await env.call('alice', 'submit', command(match, { moveIndex: 3 }))
  assert.equal(env.engine.calls.turns, 0)
  assert.equal(first.match.actionSubmitted, true)
  const observer = await env.call('bob', 'status')
  assert.equal(observer.match.pendingActions, undefined)
  assert.equal(observer.match.opponentActions, undefined)
  assert.equal(observer.match.opponentActionSubmitted, true)
  assert.equal(observer.match.revision, match.revision)
  const next = await env.call('bob', 'submit', command(match, { moveIndex: 1 }))
  assert.equal(env.engine.calls.turns, 1)
  assert.equal(next.match.state.turn, 2)
  assert(next.match.timelineRevision > match.timelineRevision)
})
test('simultaneous commands and lost-response retries cannot resolve twice', async () => {
  const env = environment()
  const match = await battle(env)
  const first = { ...command(match), requestId: 'alice-turn-request' }
  const second = { ...command(match), requestId: 'bob-turn-request' }
  await Promise.all([env.call('alice', 'submit', first), env.call('bob', 'submit', second)])
  await Promise.all([env.call('alice', 'submit', first), env.call('bob', 'submit', second)])
  assert.equal(env.engine.calls.turns, 1)
  await rejectsCode(env.call('alice', 'submit', command(match)), 'STALE_REVISION')
})
test('opponent perspective target sides are mapped only on the authenticated server', async () => {
  const env = environment()
  const match = await battle(env)
  await env.call('bob', 'submit', command(match, { targetSideId: 'opponent' }))
  assert.equal(env.engine.calls.actions.at(-1).side, 'opponent')
  assert.equal(env.engine.calls.actions.at(-1).actions[0].targetSideId, 'player')
})
test('unrelated account cannot read, submit, or forfeit a match', async () => {
  const env = environment()
  const match = await battle(env)
  await rejectsCode(env.call('charlie', 'status', { matchId: match.id }), 'MATCH_FORBIDDEN')
  await rejectsCode(env.call('charlie', 'submit', command(match)), 'MATCH_FORBIDDEN')
  await rejectsCode(env.call('charlie', 'forfeit', { matchId: match.id }), 'MATCH_FORBIDDEN')
  assert.equal(env.engine.calls.turns, 0)
})
test('reconnect retains own submitted action and deadline', async () => {
  const env = environment()
  const match = await battle(env)
  await env.call('alice', 'submit', command(match))
  const reconnected = createRankedService({ store: env.store, engine: env.engine, now: () => 1_000_500 })
  const state = await reconnected.execute(identities.alice, { action: 'status' })
  assert.equal(state.match.actionSubmitted, true)
  assert.equal(state.match.deadlineAt, match.deadlineAt)
})
test('forfeit settles both ratings once and detaches both players while current clients receive results', async () => {
  const env = environment()
  const match = await battle(env)
  const responses = await Promise.all(Array.from({ length: 6 }, () => env.call('alice', 'forfeit', { matchId: match.id })))
  assert.ok(responses.every(value => value.match.result.outcome === 'loss'))
  assert.ok(responses.every(value => value.match.result.rewardVp === 0 && value.vpRewards.total === 0))
  const alice = await env.call('alice', 'status')
  const bob = await env.call('bob', 'status')
  assert.equal(alice.profile.single.played, 1)
  assert.equal(alice.profile.single.losses, 1)
  assert.equal(bob.profile.single.wins, 1)
  assert.equal(bob.profile.single.points, 30)
  assert.equal(alice.match, null)
  assert.equal(bob.match, null)
  assert.equal((await env.call('bob', 'status', { matchId: match.id })).match.result.ratingDelta, 16)
  assert.equal(responses[0].match.result.ratingDelta, -16)
  assert.equal(bob.profile.double.played, 0)
  assert.equal(bob.vpRewards.total, 600)
  assert.equal((await env.call('bob', 'status', { matchId: match.id })).match.result.rewardVp, 600)
  const records = (await env.store.inspect()).collections.players
  for (const who of ['alice', 'bob']) {
    assert.equal(records[identities[who].uid].activeMatchId, null)
    assert.equal(records[identities[who].uid].history.length, 1)
  }
})
test('battle winner delivers the last animation to both current clients without replaying on a new session', async () => {
  const env = environment()
  const match = await battle(env)
  await env.call('alice', 'submit', command(match, { finish: true }))
  const final = await env.call('bob', 'submit', command(match))
  assert.equal(final.match.phase, 'finished')
  assert.equal(final.match.result.outcome, 'loss')
  assert.equal(final.match.timeline.length, 1)
  const waiting = await env.call('alice', 'status', { matchId: match.id, timelineRevision: match.timelineRevision })
  assert.equal(waiting.match.result.outcome, 'win')
  assert.equal(waiting.match.timeline.length, 1)
  const replayed = await env.call('alice', 'status', { matchId: match.id, timelineRevision: final.match.timelineRevision })
  assert.deepEqual(replayed.match.timeline, [])
  const reconnected = createRankedService({ store: env.store, engine: env.engine, now: () => 1_000_500 })
  for (const who of ['alice', 'bob']) {
    const lobby = await reconnected.execute(identities[who], { action: 'status' })
    assert.equal(lobby.match, null)
    assert.equal(lobby.queue, null)
    assert.equal(lobby.profile.single.played, 1)
  }
  const next = await env.call('alice', 'join', { format: 'double', team: team('a') })
  assert.equal(next.match, null)
  assert.equal(next.queue.format, 'double')
  assert.equal(next.profile.single.wins, 1)
})
test('legacy finished pointers are removed on reconnect without repeating settlement', async () => {
  const env = environment()
  const match = await battle(env)
  await env.call('alice', 'forfeit', { matchId: match.id })
  await env.store.transaction(async tx => {
    for (const who of ['alice', 'bob']) {
      const player = await tx.get('players', identities[who].uid)
      player.activeMatchId = match.id
      tx.set('players', player.uid, player)
    }
  })
  const before = (await env.store.inspect()).collections
  for (const who of ['alice', 'bob']) {
    const status = await env.call(who, 'status')
    assert.equal(status.match, null)
    assert.equal(status.profile.single.played, 1)
    const player = (await env.store.inspect()).collections.players[identities[who].uid]
    assert.equal(player.activeMatchId, null)
    assert.deepEqual(player.profiles, before.players[player.uid].profiles)
    assert.deepEqual(player.history, before.players[player.uid].history)
  }
  assert.deepEqual((await env.store.inspect()).collections.matches[match.id], before.matches[match.id])
  await rejectsCode(env.call('charlie', 'status', { matchId: match.id }), 'MATCH_FORBIDDEN')
  await rejectsCode(env.call('charlie', 'forfeit', { matchId: match.id }), 'MATCH_FORBIDDEN')
})

test('public trainer names are masked during selection and before a new engine state is created', async () => {
  const env = environment()
  const create = env.engine.createRankedBattle
  let received
  env.engine.createRankedBattle = options => { received = options; return create(options) }
  const selected = await paired(env)
  assert.equal(selected.you.name, 'b**')
  assert.equal(selected.opponent.name, 'a**')
  await env.call('alice', 'select', { matchId: selected.id, revision: selected.revision, selection: [0, 1, 2] })
  await env.call('bob', 'select', { matchId: selected.id, revision: selected.revision, selection: [0, 1, 2] })
  assert.equal(received.playerName, 'a**')
  assert.equal(received.opponentName, 'b**')
})

test('legacy live match snapshots mask both trainers and timeline text without altering authenticated identities', async () => {
  const env = environment()
  const match = await battle(env)
  env.engine.getRankedBattleView = state => structuredClone(state)
  env.engine.getRankedTimelineView = timeline => structuredClone(timeline)
  await env.store.transaction(async tx => {
    const legacy = await tx.get('matches', match.id)
    legacy.players[0].name = 'Alexander'
    legacy.players[1].name = 'Amelia'
    legacy.state.player.name = 'Alexander'
    legacy.state.opponent.name = 'Amelia'
    legacy.state.opponentMeta = { name: 'Amelia' }
    const message = 'Alexander vs Amelia, 레이팅 배틀 시작!'
    legacy.state.log = [{ id: `1-0-${message}`, message, tone: 'opponent' }]
    legacy.timelineChunks = 1
    tx.set('matches', match.id, legacy)
    tx.set('timelines', `${match.id}_${legacy.timelineRevision}_0`, { frames: [{ id: '1-0-switch-out', phase: 'switch-out', message: 'Amelia은(는) 피카츄을(를) 불러들였다!', actorName: '피카츄', state: legacy.state }] })
  })
  for (const who of ['alice', 'bob']) {
    const result = await env.call(who, 'status')
    assert.equal(result.match.you.name, 'A**')
    assert.equal(result.match.opponent.name, 'A**')
    assert.equal(result.match.state.player.name, 'A**')
    assert.equal(result.match.state.opponent.name, 'A**')
    assert.equal(result.match.state.opponentMeta.name, 'A**')
    assert.equal(result.match.timeline[0].message, 'A**은(는) 피카츄을(를) 불러들였다!')
    assert.equal(result.match.timeline[0].actorName, '피카츄')
    assert.equal(result.vpRewards.uid, identities[who].uid)
    assert.ok(!JSON.stringify(result.match).includes('Alexander'))
    assert.ok(!JSON.stringify(result.match).includes('Amelia'))
  }
  const stored = (await env.store.inspect()).collections.matches[match.id]
  assert.equal(stored.state.player.name, 'Alexander', 'Reading a public snapshot cannot rewrite the stored battle')
})

test('new queues and matches take priority over delayed status or commands for a finished match', async () => {
  const env = environment()
  const match = await battle(env)
  await env.call('alice', 'forfeit', { matchId: match.id })
  const queued = await env.call('alice', 'join', { format: 'double', team: team('a') })
  const oldPoll = await env.call('alice', 'status', { matchId: match.id })
  assert.equal(oldPoll.match, null)
  assert.equal(oldPoll.queue.ticket, queued.queue.ticket)
  const oldForfeit = await env.call('alice', 'forfeit', { matchId: match.id })
  assert.equal(oldForfeit.match, null)
  assert.equal(oldForfeit.queue.ticket, queued.queue.ticket)
  const current = (await env.call('charlie', 'join', { format: 'double', team: team('c') })).match
  assert.equal((await env.call('alice', 'status', { matchId: match.id })).match.id, current.id)
  for (const action of ['submit', 'replace', 'forfeit']) {
    const response = await env.call('alice', action, { ...command(match), targetIndex: 1 })
    assert.equal(response.match.id, current.id)
    assert.equal(response.match.phase, 'select')
    assert.equal(response.profile.single.played, 1)
    assert.equal(response.profile.double.played, 0)
  }
  assert.equal((await env.store.inspect()).collections.players[identities.alice.uid].activeMatchId, current.id)
})

test('a reconnect that expires an abandoned battle returns only its settled profile', async () => {
  const env = environment()
  const match = await battle(env)
  await env.call('bob', 'submit', command(match))
  env.advance(1001)
  const reconnected = await env.call('alice', 'status')
  assert.equal(reconnected.match, null)
  assert.equal(reconnected.profile.single.losses, 1)
  const stillWaiting = await env.call('bob', 'status', { matchId: match.id })
  assert.equal(stillWaiting.match.result.outcome, 'win')
  assert.equal(stillWaiting.profile.single.wins, 1)
  assert.equal((await env.call('bob', 'status')).match, null)
})

test('a match ending during replacement returns its final state and stays finished on retry', async () => {
  const env = environment()
  const match = await battle(env)
  await env.call('alice', 'submit', command(match, { replacement: true }))
  const waiting = (await env.call('bob', 'submit', command(match))).match
  const resolveReplacement = env.engine.resolveRankedReplacement
  env.engine.resolveRankedReplacement = (...args) => {
    const result = resolveReplacement(...args)
    result.state.winner = 'opponent'
    return result
  }
  const body = { matchId: match.id, revision: waiting.revision, targetIndex: 1, requestId: 'final-replacement' }
  const result = await env.call('alice', 'replace', body)
  assert.equal(result.match.phase, 'finished')
  assert.equal(result.match.result.outcome, 'loss')
  assert.equal(result.match.timeline.length, 1)
  const retry = await env.call('alice', 'replace', body)
  assert.equal(retry.match.phase, 'finished')
  assert.equal(retry.profile.single.played, 1)
  assert.equal(env.engine.calls.replacements, 1)
  assert.equal((await env.call('alice', 'status')).match, null)
  assert.equal((await env.call('bob', 'status')).match, null)
})

test('selection timeout penalizes only the unready player; both absent is a draw', async () => {
  const env = environment()
  const match = await paired(env)
  await env.call('alice', 'select', { matchId: match.id, revision: 1, selection: [0, 1, 2] })
  env.advance(1001)
  const result = await env.call('alice', 'status', { matchId: match.id })
  assert.equal(result.match.result.outcome, 'win')
  assert.equal(result.match.result.reason, 'selection-timeout')
  assert.equal(result.match.result.rewardVp, 0)
  assert.equal(result.vpRewards.total, 0)
  assert.equal((await env.call('bob', 'status')).vpRewards.total, 0)
  const absent = environment()
  const absentMatch = await paired(absent); absent.advance(1001)
  const draw = await absent.call('alice', 'status', { matchId: absentMatch.id })
  assert.equal(draw.match.result.outcome, 'draw')
  assert.equal(draw.profile.single.points, 0)
  assert.equal(draw.match.result.rewardVp, 0)
  assert.equal(draw.vpRewards.total, 0)
  assert.equal((await absent.call('bob', 'status')).vpRewards.total, 0)
})
test('turn timeout gives the waiting player a win, repeated polling settles once', async () => {
  const env = environment()
  const match = await battle(env)
  await env.call('bob', 'submit', command(match))
  env.advance(1001)
  await Promise.all([env.call('alice', 'status'), env.call('bob', 'status')])
  const result = await env.call('bob', 'status', { matchId: match.id })
  assert.equal(result.match.result.outcome, 'win')
  assert.equal(result.profile.single.played, 1)
  assert.equal(result.match.result.reason, 'turn-timeout')
  assert.equal(result.match.result.rewardVp, 600)
  assert.equal(result.vpRewards.total, 600)
  assert.equal((await env.call('alice', 'status', { matchId: match.id })).match.result.rewardVp, 0)
  assert.equal((await env.call('alice', 'status')).vpRewards.total, 0)
})
test('both players missing the turn receive a draw without points', async () => {
  const env = environment()
  const match = await battle(env); env.advance(1001)
  const result = await env.call('alice', 'status', { matchId: match.id })
  assert.equal(result.match.result.outcome, 'draw')
  assert.equal(result.profile.single.points, 0)
  assert.equal(result.match.result.rewardVp, 0)
  assert.equal(result.vpRewards.total, 0)
  assert.equal((await env.call('bob', 'status')).vpRewards.total, 0)
})
test('forced replacement only accepts the requested side, then resumes the turn timer', async () => {
  const env = environment()
  const match = await battle(env)
  await env.call('alice', 'submit', command(match, { replacement: true }))
  const waiting = (await env.call('bob', 'submit', command(match))).match
  await rejectsCode(env.call('bob', 'replace', { matchId: waiting.id, revision: waiting.revision, targetIndex: 1 }), 'WRONG_PHASE')
  await rejectsCode(env.call('alice', 'submit', command(waiting)), 'WRONG_PHASE')
  const resumed = await env.call('alice', 'replace', { matchId: waiting.id, revision: waiting.revision, targetIndex: 1 })
  assert.equal(resumed.match.state.pendingHumanSwitch, null)
  assert.equal(env.engine.calls.replacements, 1)
})
test('forced replacement timeout never penalizes the waiting opponent', async () => {
  const env = environment()
  const match = await battle(env)
  await env.call('alice', 'submit', command(match, { replacement: true }))
  await env.call('bob', 'submit', command(match))
  env.advance(1001)
  const result = await env.call('bob', 'status', { matchId: match.id })
  assert.equal(result.match.result.outcome, 'win')
  assert.equal(result.match.result.reason, 'replacement-timeout')
  assert.equal(result.match.result.rewardVp, 600)
  assert.equal(result.vpRewards.total, 600)
  assert.equal((await env.call('alice', 'status', { matchId: match.id })).match.result.rewardVp, 0)
  assert.equal((await env.call('alice', 'status')).vpRewards.total, 0)
})
test('timeline payloads are separate from matches and replaced each resolved turn', async () => {
  const env = environment()
  let match = await battle(env)
  for (let index = 0; index < 2; index += 1) {
    await env.call('alice', 'submit', command(match))
    match = (await env.call('bob', 'submit', command(match))).match
  }
  const data = await env.store.inspect()
  assert.equal(data.collections.matches[match.id].timeline, undefined)
  assert.equal(Object.keys(data.collections.timelines).length, 1)
  assert.equal(match.timeline.length, 1)
  const fresh = await env.call('alice', 'status', { matchId: match.id, timelineRevision: match.timelineRevision })
  assert.deepEqual(fresh.match.timeline, [])
  assert.equal(fresh.match.timelineRevision, match.timelineRevision)
})
test('oversized whole timelines fail atomically before exceeding production storage limits', async () => {
  const env = environment()
  const match = await battle(env)
  const resolveTurn = env.engine.resolveRankedTurn
  env.engine.resolveRankedTurn = (state, actions) => {
    const result = resolveTurn(state, actions)
    result.timeline = Array.from({ length: 6 }, () => ({ state: result.state, padding: 'x'.repeat(600_000) }))
    return result
  }
  await env.call('alice', 'submit', command(match))
  await rejectsCode(env.call('bob', 'submit', command(match)), 'BATTLE_STATE_TOO_LARGE')
  const snapshot = await env.call('bob', 'status')
  assert.equal(snapshot.match.revision, match.revision)
  assert.equal(snapshot.match.state.turn, 1)
  assert.equal(snapshot.match.actionSubmitted, false)
  assert.equal(snapshot.match.opponentActionSubmitted, true)
  assert.equal(Object.keys((await env.store.inspect()).collections.timelines ?? {}).length, 0)
})
test('failed transactions roll back, without poisoning later transactions', async () => {
  const store = createMemoryRankedStore()
  await assert.rejects(store.transaction(async tx => { tx.set('players', 'someone', { rating: 99 }); throw new Error('rollback') }))
  assert.equal(await store.transaction(tx => tx.get('players', 'someone')), null)
  await store.transaction(tx => tx.set('players', 'someone', { rating: 100 }))
  assert.equal((await store.transaction(tx => tx.get('players', 'someone'))).rating, 100)
})
test('file store survives closing and reopening, and blocks simultaneous owners', async () => {
  const directory = resolve('scripts/.cache/ranked-validation')
  await mkdir(directory, { recursive: true })
  const temporary = await mkdtemp(join(directory, 'store-'))
  const filename = join(temporary, 'state.json')
  let store = await createFileRankedStore(filename)
  try {
    await store.transaction(tx => tx.set('players', 'alice', { rating: 1234 }))
    await assert.rejects(createFileRankedStore(filename), /already open/)
    await store.close()
    store = await createFileRankedStore(filename)
    assert.equal((await store.transaction(tx => tx.get('players', 'alice'))).rating, 1234)
  } finally { await store.close(); await unlink(filename); await rmdir(temporary) }
})
test('file store recovers a positively dead PID after forced shutdown but refuses malformed locks', async () => {
  const directory = resolve('scripts/.cache/ranked-validation')
  await mkdir(directory, { recursive: true })
  const temporary = await mkdtemp(join(directory, 'recovery-'))
  const filename = join(temporary, 'state.json')
  const child = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8', windowsHide: true })
  assert.equal(child.status, 0)
  const oldPid = Number(child.stdout)
  assert.throws(() => process.kill(oldPid, 0), error => error.code === 'ESRCH')
  await writeFile(`${filename}.lock`, String(oldPid))
  const store = await createFileRankedStore(filename)
  try { await store.transaction(tx => tx.set('players', 'alice', { rating: 1500 })) } finally { await store.close() }
  await writeFile(`${filename}.lock`, 'not-a-process-id')
  try { await assert.rejects(createFileRankedStore(filename), /invalid/) } finally {
    await unlink(`${filename}.lock`); await unlink(filename); await rmdir(temporary)
  }
})

function firestoreFixture() {
  const documents = new Map()
  return {
    documents,
    collection(name) { return { name, doc(id) { return { name, id } } } },
    async runTransaction(work) {
      const writes = []
      const value = await work({
        async get(ref) {
          assert.equal(writes.length, 0, 'Firestore read must precede writes')
          if (ref.id) {
            const value = documents.get(`${ref.name}/${ref.id}`)
            return { exists: Boolean(value), data: () => structuredClone(value) }
          }
          return { docs: [...documents].filter(([key]) => key.startsWith(`${ref.name}/`)).map(([key, value]) => ({ id: key.split('/')[1], data: () => structuredClone(value) })) }
        },
        set(ref, value) { writes.push([`${ref.name}/${ref.id}`, value]) },
        delete(ref) { writes.push([`${ref.name}/${ref.id}`, null]) },
      })
      for (const [key, value] of writes) if (value === null) documents.delete(key); else documents.set(key, value)
      return value
    },
  }
}
test('Firestore adapter serializes nested arrays and buffers writes until reads finish', async () => {
  const db = firestoreFixture()
  const store = createFirestoreRankedStore(db, { prefix: 'rankedValidation' })
  const value = { nested: [[1, 2], ['a']], nullable: null }
  await store.transaction(async tx => { tx.set('matches', 'sample', value); assert.equal(await tx.get('players', 'missing'), null) })
  assert.equal(typeof db.documents.get('rankedValidation_matches/sample').payload, 'string')
  assert.deepEqual(await store.transaction(tx => tx.get('matches', 'sample')), value)
  assert.deepEqual(await store.transaction(tx => tx.list('matches')), [{ id: 'sample', ...value }])
  await assert.rejects(store.transaction(tx => tx.set('matches', 'huge', { text: 'x'.repeat(860_000) })), /size limit/)
  assert.equal(db.documents.has('rankedValidation_matches/huge'), false)
})
test('Firestore transaction adapter supports a full match and settles both profiles once', async () => {
  const db = firestoreFixture()
  const env = environment({ store: createFirestoreRankedStore(db, { prefix: 'rankedValidation' }) })
  const match = await battle(env, 'double')
  await env.call('alice', 'submit', command(match))
  const progressed = await env.call('bob', 'submit', command(match))
  assert.equal(progressed.match.state.turn, 2)
  await env.call('bob', 'forfeit', { matchId: match.id })
  await env.call('bob', 'forfeit', { matchId: match.id })
  const alice = await env.call('alice', 'status')
  const bob = await env.call('bob', 'status')
  assert.equal(alice.profile.double.points, 30)
  assert.equal(alice.profile.double.wins, 1)
  assert.equal(bob.profile.double.losses, 1)
  assert.equal(alice.profile.single.played, 0)
  assert.deepEqual(alice.vpRewards, { uid: identities.alice.uid, total: 600 })
  assert.deepEqual(bob.vpRewards, { uid: identities.bob.uid, total: 0 })
  assert.equal(alice.match, null)
  assert.equal(bob.match, null)
  assert.equal((await env.call('bob', 'status', { matchId: match.id })).match.result.outcome, 'loss')
  assert.ok([...db.documents.values()].every(value => Buffer.byteLength(value.payload) <= 850_000))
})
test('ownership resolver ignores forged client stats/species and rejects unowned items', async () => {
  const owned = { captureId: 'owned-capture', speciesId: 25, stats: { attack: 55 } }
  const docs = {
    collection: { payload: { 'champions-dex-v2': JSON.stringify([owned]) } },
    progress: { payload: { 'champions-battle-items-v1': '{}' } },
  }
  const resolver = createFirebaseRankedTeamResolver({ doc(path) { return { async get() { return { data: () => docs[path.split('/').at(-1)] } } } } })
  const entries = Array.from({ length: 6 }, () => ({ captureId: owned.captureId, speciesId: 999, stats: { attack: 99999 } }))
  assert.deepEqual((await resolver(identities.alice, entries))[0], owned)
  await rejectsCode(resolver(identities.alice, entries.map(entry => ({ ...entry, captureId: 'missing' }))), 'POKEMON_NOT_OWNED')
  owned.heldItemId = 'missing-item'
  docs.collection.payload['champions-dex-v2'] = JSON.stringify([owned])
  await rejectsCode(resolver(identities.alice, entries), 'ITEM_NOT_OWNED')
})
test('saved production loadouts canonicalize and mixed cloud revisions request resync', async () => {
  const owned = [3, 6, 9, 25, 94, 149].map((speciesId, index) => normalizePokemon({ speciesId, captureId: `saved-${index}` }))
  const docs = {
    collection: { revision: 'same-revision', payload: { 'champions-dex-v2': JSON.stringify(owned) } },
    progress: { revision: 'same-revision', payload: { 'champions-battle-items-v1': '{}' } },
  }
  const resolver = createFirebaseRankedTeamResolver({ doc(path) { return { async get() { return { data: () => docs[path.split('/').at(-1)] } } } } })
  const submitted = [...owned].reverse().map(pokemon => ({ captureId: pokemon.captureId, speciesId: 999, moves: ['forged'] }))
  const canonical = canonicalizeRankedTeam(await resolver(identities.alice, submitted))
  assert.deepEqual(canonical.map(pokemon => pokemon.speciesId), [149, 94, 25, 9, 6, 3])
  assert.ok(canonical.every(pokemon => pokemon.moveIds.length === 4 && !pokemon.moves.includes('forged')))
  docs.collection.revision = 'new-revision'
  await rejectsCode(resolver(identities.alice, submitted), 'ACCOUNT_SYNC_REQUIRED')
  docs.progress.revision = 'new-revision'
  docs.progress.payload['champions-battle-items-v1'] = 'null'
  await rejectsCode(resolver(identities.alice, submitted), 'ACCOUNT_SYNC_REQUIRED')
})
test('test identity bypass requires explicit development mode and loopback', async () => {
  assert.throws(() => createLocalRankedAuthenticator({ enabled: false }), /explicit/)
  assert.throws(() => createLocalRankedAuthenticator({ enabled: true, production: true }), /explicit/)
  const authenticate = createLocalRankedAuthenticator({ enabled: true, production: false })
  await rejectsCode(authenticate(new Request('https://game.example/api/ranked'), 'ranked-test-alice'), 'LOCAL_ONLY')
  await rejectsCode(authenticate(new Request('http://127.0.0.1/api/ranked'), 'invalid-token'), 'UNAUTHENTICATED')
})
test('production endpoint remains disabled without explicit configuration', async () => {
  const previous = process.env.RANKED_ENABLED
  delete process.env.RANKED_ENABLED
  try {
    const result = await handleProductionRankedRequest(new Request('https://game.example/api/ranked'))
    assert.equal(result.status, 503)
    assert.equal((await result.json()).error.code, 'RANKED_DISABLED')
  } finally { if (previous === undefined) delete process.env.RANKED_ENABLED; else process.env.RANKED_ENABLED = previous }
})
test('production startup and authentication outages remain distinct from invalid login without leaking secrets', async () => {
  const logs = []
  const originalLog = console.error
  console.error = (...values) => logs.push(values)
  const saved = Object.fromEntries(['RANKED_ENABLED', 'RANKED_FIREBASE_PROJECT_ID', 'RANKED_FIRESTORE_PREFIX', 'RANKED_FIREBASE_SERVICE_ACCOUNT_JSON'].map(key => [key, process.env[key]]))
  try {
    process.env.RANKED_ENABLED = 'true'
    delete process.env.RANKED_FIREBASE_PROJECT_ID
    delete process.env.RANKED_FIRESTORE_PREFIX
    const startup = await handleProductionRankedRequest(new Request('https://game.example/api/ranked'))
    assert.equal(startup.status, 503)
    assert.equal((await startup.json()).error.code, 'RANKED_UNAVAILABLE')
    process.env.RANKED_FIREBASE_PROJECT_ID = 'ranked-validation'
    process.env.RANKED_FIRESTORE_PREFIX = 'rankedValidation'
    process.env.RANKED_FIREBASE_SERVICE_ACCOUNT_JSON = '{private-credential-content'
    const malformedCredential = await handleProductionRankedRequest(new Request('https://game.example/api/ranked'))
    assert.equal(malformedCredential.status, 503)
    const request = () => new Request('https://game.example/api/ranked', { headers: { Authorization: 'Bearer private-id-token' } })
    for (const [code, status] of [['auth/id-token-expired', 401], ['auth/invalid-credential', 503], ['auth/certificate-fetch-failed', 503]]) {
      const handler = createRankedHttpHandler({ enabled: true, service: {}, authenticate: async () => { throw Object.assign(new Error('private-credential-content'), { code }) } })
      const result = await handler(request())
      assert.equal(result.status, status)
      assert.equal((await result.json()).error.code, status === 401 ? 'UNAUTHENTICATED' : 'RANKED_UNAVAILABLE')
    }
    const printed = JSON.stringify(logs)
    assert.ok(printed.includes('initialization') && printed.includes('ranked/configuration-incomplete'))
    assert.ok(printed.includes('authentication') && printed.includes('auth/invalid-credential'))
    assert.ok(printed.includes('credential-json') && printed.includes('SyntaxError'))
    assert.ok(!printed.includes('private-id-token') && !printed.includes('private-credential-content'))
  } finally {
    console.error = originalLog
    for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value
  }
})
test('HTTP rejects unauthorized, oversized, malformed, foreign-origin, and GET mutation requests', async () => {
  const env = environment()
  const handler = createRankedHttpHandler({ service: env.service, authenticate: createLocalRankedAuthenticator({ enabled: true, production: false }), enabled: true, allowLocalOrigins: true })
  const base = 'http://127.0.0.1:8787/api/ranked'
  const headers = { Authorization: 'Bearer ranked-test-alice', 'Content-Type': 'application/json' }
  assert.equal((await handler(new Request(base))).status, 401)
  assert.equal((await handler(new Request(base, { method: 'POST', headers, body: 'x'.repeat(140_000) }))).status, 413)
  assert.equal((await handler(new Request(base, { method: 'POST', headers, body: '{' }))).status, 400)
  assert.equal((await handler(new Request(base, { headers: { ...headers, Origin: 'https://evil.example' } }))).status, 403)
  assert.equal((await handler(new Request(`${base}?action=forfeit`, { headers }))).status, 405)
  const accepted = await handler(new Request(base, { headers: { ...headers, Origin: 'http://localhost:5173' } }))
  assert.equal(accepted.status, 200)
  assert.equal(accepted.headers.get('Access-Control-Allow-Origin'), 'http://localhost:5173')
})
test('two independent HTTP clients match, choose teams, play, reconnect, and receive one result', async () => {
  const env = environment()
  const handler = createRankedHttpHandler({ service: env.service, authenticate: createLocalRankedAuthenticator({ enabled: true, production: false }), enabled: true })
  let url
  const server = createServer(async (incoming, outgoing) => {
    const request = new Request(new URL(incoming.url, url), { method: incoming.method, headers: incoming.headers, ...(incoming.method === 'POST' ? { body: Readable.toWeb(incoming), duplex: 'half' } : {}) })
    const result = await handler(request)
    outgoing.writeHead(result.status, Object.fromEntries(result.headers)); outgoing.end(Buffer.from(await result.arrayBuffer()))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  url = `http://127.0.0.1:${server.address().port}/api/ranked`
  let sequence = 0
  const client = token => ({
    async post(action, values = {}) {
      const response = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action, requestId: `http-request-${++sequence}`, ...values }) })
      const payload = await response.json(); assert.equal(response.status, 200, JSON.stringify(payload)); return payload
    },
    async status(matchId) { const response = await fetch(matchId ? `${url}?matchId=${encodeURIComponent(matchId)}` : url, { headers: { Authorization: `Bearer ${token}` } }); assert.equal(response.status, 200); return response.json() },
  })
  try {
    const alice = client('ranked-test-alice'), bob = client('ranked-test-bob')
    await Promise.all([alice.post('join', { format: 'single', team: team('a') }), bob.post('join', { format: 'single', team: team('b') })])
    let match = (await alice.status()).match
    const selected = { matchId: match.id, revision: match.revision, selection: [0, 1, 2] }
    await Promise.all([alice.post('select', selected), bob.post('select', selected)])
    match = (await alice.status()).match
    await Promise.all([alice.post('submit', command(match)), bob.post('submit', command(match))])
    const reconnected = client('ranked-test-alice')
    match = (await reconnected.status()).match
    assert.equal(match.state.turn, 2)
    await alice.post('forfeit', { matchId: match.id })
    assert.equal((await bob.status(match.id)).match.result.outcome, 'win')
    assert.equal((await bob.status()).match, null)
    assert.equal((await reconnected.status()).match, null)
    assert.equal((await reconnected.status()).profile.single.played, 1)
    assert.equal(env.engine.calls.turns, 1)
  } finally { await new Promise(resolve => server.close(resolve)) }
})

test('real battle engine over HTTP supports singles and doubles with damage, replacement, and rating results', async () => {
  const store = createMemoryRankedStore()
  const server = await startRankedDevServer({ port: 0, testAccounts: true, store })
  let sequence = 0
  const client = who => ({
    async status(matchId) {
      const result = await fetch(matchId ? `${server.url}?matchId=${encodeURIComponent(matchId)}` : server.url, { headers: { Authorization: `Bearer ranked-test-${who}` } })
      assert.equal(result.status, 200); return result.json()
    },
    async post(action, body) {
      const result = await fetch(server.url, { method: 'POST', headers: { Authorization: `Bearer ranked-test-${who}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action, requestId: `real-http-request-${++sequence}`, ...body }) })
      const data = await result.json(); assert.equal(result.status, 200, JSON.stringify(data)); return data
    },
  })
  try {
    const fixtures = await (await fetch(`${server.url}?action=fixtures`, { headers: { Authorization: 'Bearer ranked-test-alice' } })).json()
    const alice = client('alice'), bob = client('bob')
    for (const format of ['single', 'double']) {
      await alice.post('join', { format, team: fixtures.teams[0].pokemon })
      let match = (await bob.post('join', { format, team: fixtures.teams[1].pokemon })).match
      const selection = format === 'single' ? [0, 1, 2] : [0, 1, 2, 3]
      const chosen = { matchId: match.id, revision: match.revision, selection }
      await Promise.all([alice.post('select', chosen), bob.post('select', chosen)])
      const states = await Promise.all([alice.status(), bob.status()])
      match = states[0].match
      assert.equal(match.phase, 'battle')
      assert.equal(match.state.player.team.length, selection.length)
      assert.equal(match.state.commandOptions.length, format === 'single' ? 1 : 2)
      const actions = state => state.commandOptions.map(option => {
        const move = option.moves.find(move => !move.disabled && move.preview.power > 0)
        const target = move.targets.find(target => target.sideId === 'opponent') ?? move.targets[0]
        return { type: 'move', actorSlot: option.actorSlot, moveIndex: move.moveIndex, ...(target ? { targetSideId: target.sideId, targetSlot: target.slot } : {}) }
      })
      await Promise.all([
        alice.post('submit', { matchId: match.id, revision: match.revision, actions: actions(states[0].match.state) }),
        bob.post('submit', { matchId: match.id, revision: match.revision, actions: actions(states[1].match.state) }),
      ])
      const snapshots = await Promise.all([alice.status(), bob.status()])
      assert(snapshots.some(snapshot => snapshot.match.state.player.team.some(pokemon => pokemon.hp < pokemon.maxHp)), 'real move must deal damage')
      assert(snapshots[0].match.timeline.length > 0)
      for (let safety = 0; safety < 4; safety += 1) {
        const next = await Promise.all([alice.status(), bob.status()])
        const awaiting = next.findIndex(snapshot => snapshot.match.state.awaitingPlayerSwitch)
        if (awaiting < 0) break
        const pending = next[awaiting].match
        await [alice, bob][awaiting].post('replace', { matchId: pending.id, revision: pending.revision, targetIndex: pending.state.replacementIndexes[0] })
      }
      const completed = await alice.post('forfeit', { matchId: match.id })
      assert.equal(completed.match.result.outcome, 'loss')
      const winner = await bob.status(match.id)
      assert.equal(winner.match.result.outcome, 'win')
      assert.equal(winner.profile[format].wins, 1)
      assert.equal(winner.profile[format].played, 1)
      assert.equal((await alice.status()).match, null)
      assert.equal((await bob.status()).match, null)
      const data = await store.inspect()
      for (const value of Object.values(data.collections.matches)) assert(Buffer.byteLength(JSON.stringify(value)) < 850_000)
      for (const value of Object.values(data.collections.timelines ?? {})) assert(Buffer.byteLength(JSON.stringify(value)) < 850_000)
    }
  } finally { await server.close() }
})

for (const { name, run } of tests) {
  try { await run(); checked += 1; console.log(`PASS ${name}`) } catch (error) { console.error(`FAIL ${name}`); throw error }
}
console.log(`Ranked service validation passed: ${checked}/${tests.length}`)
