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
      if (actions.player[0].finish) next.winner = 'player'
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
  assert.equal(paired.match.opponent.name, 'alice')
  assert.equal((await env.call('bob', 'status')).queue.format, 'double')
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
test('forfeit updates both ratings exactly once, including concurrent retries and result reload', async () => {
  const env = environment()
  const match = await battle(env)
  await Promise.all(Array.from({ length: 6 }, () => env.call('alice', 'forfeit', { matchId: match.id })))
  const alice = await env.call('alice', 'status')
  const bob = await env.call('bob', 'status')
  assert.equal(alice.profile.single.played, 1)
  assert.equal(alice.profile.single.losses, 1)
  assert.equal(bob.profile.single.wins, 1)
  assert.equal(bob.profile.single.points, 30)
  assert.equal(bob.match.result.ratingDelta, 16)
  assert.equal(alice.match.result.ratingDelta, -16)
  assert.equal(bob.profile.double.played, 0)
})
test('battle winner settles ratings and a new search clears the finished match', async () => {
  const env = environment()
  const match = await battle(env)
  await env.call('alice', 'submit', command(match, { finish: true }))
  const final = await env.call('bob', 'submit', command(match))
  assert.equal(final.match.phase, 'finished')
  assert.equal(final.match.result.outcome, 'loss')
  const next = await env.call('alice', 'join', { format: 'double', team: team('a') })
  assert.equal(next.match, null)
  assert.equal(next.queue.format, 'double')
  assert.equal(next.profile.single.wins, 1)
})
test('selection timeout penalizes only the unready player; both absent is a draw', async () => {
  const env = environment()
  const match = await paired(env)
  await env.call('alice', 'select', { matchId: match.id, revision: 1, selection: [0, 1, 2] })
  env.advance(1001)
  const result = await env.call('alice', 'status')
  assert.equal(result.match.result.outcome, 'win')
  assert.equal(result.match.result.reason, 'selection-timeout')
  const absent = environment()
  await paired(absent); absent.advance(1001)
  const draw = await absent.call('alice', 'status')
  assert.equal(draw.match.result.outcome, 'draw')
  assert.equal(draw.profile.single.points, 0)
})
test('turn timeout gives the waiting player a win, repeated polling settles once', async () => {
  const env = environment()
  const match = await battle(env)
  await env.call('bob', 'submit', command(match))
  env.advance(1001)
  await Promise.all([env.call('alice', 'status'), env.call('bob', 'status')])
  const result = await env.call('bob', 'status')
  assert.equal(result.match.result.outcome, 'win')
  assert.equal(result.profile.single.played, 1)
  assert.equal(result.match.result.reason, 'turn-timeout')
})
test('both players missing the turn receive a draw without points', async () => {
  const env = environment()
  await battle(env); env.advance(1001)
  const result = await env.call('alice', 'status')
  assert.equal(result.match.result.outcome, 'draw')
  assert.equal(result.profile.single.points, 0)
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
  const result = await env.call('bob', 'status')
  assert.equal(result.match.result.outcome, 'win')
  assert.equal(result.match.result.reason, 'replacement-timeout')
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
  assert.equal(bob.match.result.outcome, 'loss')
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
    const request = new Request(url, { method: incoming.method, headers: incoming.headers, ...(incoming.method === 'POST' ? { body: Readable.toWeb(incoming), duplex: 'half' } : {}) })
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
    async status() { const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } }); assert.equal(response.status, 200); return response.json() },
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
    assert.equal((await bob.status()).match.result.outcome, 'win')
    assert.equal((await reconnected.status()).profile.single.played, 1)
    assert.equal(env.engine.calls.turns, 1)
  } finally { await new Promise(resolve => server.close(resolve)) }
})

test('real battle engine over HTTP supports singles and doubles with damage, replacement, and rating results', async () => {
  const store = createMemoryRankedStore()
  const server = await startRankedDevServer({ port: 0, testAccounts: true, store })
  let sequence = 0
  const client = who => ({
    async status() {
      const result = await fetch(server.url, { headers: { Authorization: `Bearer ranked-test-${who}` } })
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
      const winner = await bob.status()
      assert.equal(winner.match.result.outcome, 'win')
      assert.equal(winner.profile[format].wins, 1)
      assert.equal(winner.profile[format].played, 1)
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
