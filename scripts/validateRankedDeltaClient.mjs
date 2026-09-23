import assert from 'node:assert/strict'
import { createRankedService } from '../server/rankedService.js'
import { createMemoryRankedStore } from '../server/rankedStore.js'
import * as engine from '../server/rankedBattle.js'
import { normalizePokemon, getMoveById } from '../src/data/trainingData.js'
import { createRankedClient } from '../src/rankedClient.js'
import { knownMatchRevision, mergeRankedMatchSnapshot } from '../src/rankedSnapshot.js'

const roster = [25, 6, 9, 143, 68, 131].map(speciesId => normalizePokemon({
  speciesId, captureId: `delta-mon-${speciesId}`, moves: [getMoveById('protect').name],
}))
const who = index => ({ uid: `delta-user-${index}`, name: `User ${index}` })
let request = 0
let clock = 1_000_000
const service = createRankedService({
  store: createMemoryRankedStore(), engine, now: () => clock,
  newId: () => 'delta-match', makeSeed: () => 125,
  timeouts: { selection: 900_000, turn: 600_000, replacement: 450_000, playbackGrace: 0 },
})
const call = (index, action, payload = {}) => service.execute(who(index), {
  action, ...(!['status', 'rooms'].includes(action) ? { requestId: `delta-request-${++request}` } : {}), ...payload,
})
const size = value => Buffer.byteLength(JSON.stringify(value))
const poll = (index, match) => call(index, 'status', { matchId: match.id,
  matchRevision: knownMatchRevision(match), timelineRevision: match.timelineRevision })

let requestedUrl = null
const client = createRankedClient({
  apiUrl: 'http://127.0.0.1/api/ranked', getIdToken: async () => 'test-token',
  fetchImpl: async url => { requestedUrl = new URL(url); return Response.json({ ok: true }) },
})
await client.status({ matchId: 'delta-match', matchRevision: 3, timelineRevision: 3 })
assert.equal(requestedUrl.searchParams.get('matchRevision'), '3')
assert.equal(requestedUrl.searchParams.get('timelineRevision'), '3')
assert.equal(requestedUrl.searchParams.get('matchId'), 'delta-match')

assert.equal(knownMatchRevision({ id: 'missing-data', revision: 1 }), null)
assert.equal(knownMatchRevision({ id: 'empty', revision: 1, state: null, teamPreview: {} }), 1)
assert.equal(mergeRankedMatchSnapshot({ id: 'first', revision: 1, state: { old: true } },
  { id: 'second', revision: 1 }).state, undefined)
assert.equal(mergeRankedMatchSnapshot({ id: 'first', revision: 1, state: { old: true } },
  { id: 'first', revision: 2, state: null }).state, null)

await call(0, 'join', { format: 'single', team: roster })
const queued = await call(1, 'join', { format: 'single', team: roster })
let full = await call(0, 'status', { matchId: queued.match.id })
assert.equal(full.match.phase, 'select')
assert.equal(full.match.state, null)
let delta = await poll(0, full.match)
assert.equal(Object.hasOwn(delta.match, 'state'), false)
assert.equal(Object.hasOwn(delta.match, 'teamPreview'), false)
assert.equal(mergeRankedMatchSnapshot(full.match, delta.match).state, null)
assert.deepEqual(mergeRankedMatchSnapshot(full.match, delta.match).teamPreview, full.match.teamPreview)

await call(0, 'select', { matchId: full.match.id, revision: full.match.revision, selection: [0, 1, 2] })
const selected = await call(1, 'select', { matchId: full.match.id, revision: full.match.revision, selection: [0, 1, 2] })
full = await call(0, 'status', { matchId: selected.match.id })
assert.equal(full.match.phase, 'battle')
assert.ok(full.match.state)
delta = await poll(0, full.match)
assert.equal(Object.hasOwn(delta.match, 'state'), false)
assert.equal(Object.hasOwn(delta.match, 'teamPreview'), false)
assert.ok(size(delta) < size(full) / 5, `Repeated status still too large: ${size(delta)} vs ${size(full)}`)
let combined = mergeRankedMatchSnapshot(full.match, delta.match)
assert.deepEqual(combined.state, full.match.state)
assert.deepEqual(combined.teamPreview, full.match.teamPreview)

const action = { type: 'move', actorSlot: 0, moveIndex: 0, targetSideId: 'player', targetSlot: 0 }
await call(0, 'submit', { matchId: full.match.id, revision: full.match.revision, actions: [action] })
delta = await poll(0, combined)
assert.equal(delta.match.revision, full.match.revision)
assert.equal(delta.match.actionSubmitted, true)
combined = mergeRankedMatchSnapshot(combined, delta.match)
assert.equal(combined.actionSubmitted, true)
assert.deepEqual(combined.state, full.match.state)

clock += 1_000
await call(1, 'submit', { matchId: full.match.id, revision: full.match.revision, actions: [action] })
const changed = await poll(0, combined)
assert.ok(changed.match.revision > combined.revision)
assert.ok(Object.hasOwn(changed.match, 'state'))
assert.ok(Object.hasOwn(changed.match, 'teamPreview'))
assert.ok(changed.match.timeline.length > 0)
assert.equal(mergeRankedMatchSnapshot(combined, changed.match).revision, changed.match.revision)
assert.deepEqual(mergeRankedMatchSnapshot(combined, changed.match).state, changed.match.state)

console.log(`Ranked delta client PASS: repeated battle status ${size(delta)} B, full battle status ${size(full)} B`)
