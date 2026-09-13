import assert from 'node:assert/strict'
import { createRankedService } from '../server/rankedService.js'
import { createMemoryRankedStore } from '../server/rankedStore.js'
import { createRankedHttpHandler } from '../server/rankedHttp.js'
import * as engine from '../server/rankedBattle.js'
import { normalizePokemon, getMoveById } from '../src/data/trainingData.js'
import { getActivePokemon } from '../src/data/battleEngine.js'

const tests = []
const test = (name, run) => tests.push({ name, run })
const identity = index => ({ uid: `viewer-test-${index}`, name: `관전자비밀이름${index}` })
const roster = [571, 25, 143, 6, 9, 68].map(speciesId => normalizePokemon({ speciesId, captureId: `spectator-mon-${speciesId}`, moves: [getMoveById('protect').name] }))
const who = uid => Number(uid.split('-').at(-1))
function setup() {
  let serial = 0, request = 0, time = 1_000_000, timelineReads = 0
  const actual = createMemoryRankedStore()
  const store = { transaction: work => actual.transaction(tx => work({ ...tx, get: (collection, key) => { if (collection === 'timelines') timelineReads += 1; return tx.get(collection, key) } })), inspect: () => actual.inspect() }
  const service = createRankedService({ store, engine, now: () => time, newId: () => `spectator-room-${++serial}`, makeSeed: () => 515,
    timeouts: { selection: 9000, turn: 6000, replacement: 4500, playbackGrace: 0 } })
  const call = (index, action, data = {}) => service.execute(identity(index), { action, ...(!['rooms', 'status'].includes(action) ? { requestId: `spectator-request-${++request}` } : {}), ...data })
  return { store, service, call, advance: amount => { time += amount }, reads: () => timelineReads, resetReads: () => { timelineReads = 0 } }
}
async function room(env, count, mode = 'tournament', offset = 0) {
  const created = await env.call(offset, 'roomCreate', { title: '관전 대회', mode, format: 'single', team: roster })
  for (let index = 1; index < count; index += 1) await env.call(offset + index, 'roomJoin', { roomId: created.room.id, team: roster })
  return env.call(offset, 'roomStart', { roomId: created.room.id })
}
async function playTurn(env, matchId) {
  let match = (await env.store.inspect()).collections.matches[matchId]
  for (const player of match.players) await env.call(who(player.uid), 'select', { matchId, revision: match.revision, selection: [0, 1, 2] })
  match = (await env.store.inspect()).collections.matches[matchId]
  for (const player of match.players) await env.call(who(player.uid), 'submit', { matchId, revision: match.revision,
    actions: [{ type: 'move', actorSlot: 0, moveIndex: 0, targetSideId: 'player', targetSlot: 0 }] })
  return (await env.store.inspect()).collections.matches[matchId]
}
const forbidden = promise => assert.rejects(promise, error => error.status === 403 && error.code === 'SPECTATOR_FORBIDDEN')

test('three-player tournament bye can observe selection without any selected team or loadout data', async () => {
  const env = setup()
  const initial = await room(env, 3)
  const bye = who(initial.room.matches.find(entry => entry.phase === 'bye').winnerUid)
  const active = initial.room.matches.find(entry => entry.phase === 'select')
  const before = await env.call(bye, 'rooms', { spectateMatchId: active.id })
  assert.equal(before.match, null)
  assert.equal(before.spectator.phase, 'select')
  assert.equal(before.spectator.state, null)
  assert.deepEqual(before.spectator.timeline, [])
  assert.equal(before.room.matches.find(entry => entry.id === active.id).canSpectate, true)
  await env.call(who(active.players[0].uid), 'select', { matchId: active.id, revision: 1, selection: [2, 3, 4] })
  const after = await env.call(bye, 'rooms', { spectateMatchId: active.id })
  assert.deepEqual(after.spectator, before.spectator)
  for (const key of ['teamPreview', 'selections', 'selectedIndices', 'pendingActions', 'you', 'opponent']) assert.equal(after.spectator[key], undefined)
  assert(after.spectator.players.every(player => player.name === '관**'))
})

test('live players, withdrawn entrants, other rooms and ranked matches cannot be spectated', async () => {
  const env = setup()
  const first = await room(env, 4)
  const [one, two] = first.room.matches.filter(entry => entry.phase === 'select')
  const busy = who(one.players[0].uid)
  const denied = await env.call(busy, 'rooms', { spectateMatchId: two.id })
  assert.equal(denied.spectator, null)
  assert(denied.match)
  assert(denied.room.matches.every(entry => !entry.canSpectate))
  await forbidden(env.call(99, 'rooms', { spectateMatchId: two.id }))
  const second = await room(env, 3, 'tournament', 10)
  const bye = who(second.room.matches.find(entry => entry.phase === 'bye').winnerUid)
  const active = second.room.matches.find(entry => entry.phase === 'select')
  await forbidden(env.call(bye, 'rooms', { spectateMatchId: two.id }))
  await env.call(bye, 'roomLeave', { roomId: second.room.id })
  assert.equal((await env.call(bye, 'rooms', { spectateMatchId: active.id })).spectator, null)
  await env.call(30, 'join', { format: 'single', team: roster })
  const ranked = await env.call(31, 'join', { format: 'single', team: roster })
  await forbidden(env.call(bye, 'rooms', { spectateMatchId: ranked.match.id }))
})

test('a finished semifinal winner and eliminated entrant can watch another semifinal; next own match takes priority', async () => {
  const env = setup()
  const first = await room(env, 4)
  const [one, two] = first.room.matches.filter(entry => entry.phase === 'select')
  const winner = who(one.players[0].uid), loser = who(one.players[1].uid)
  await env.call(loser, 'forfeit', { matchId: one.id })
  for (const entrant of [winner, loser]) assert.equal((await env.call(entrant, 'rooms', { spectateMatchId: two.id })).spectator.id, two.id)
  await playTurn(env, two.id)
  await env.call(who(two.players[1].uid), 'forfeit', { matchId: two.id })
  const next = await env.call(winner, 'rooms', { matchId: one.id, spectateMatchId: two.id })
  assert.equal(next.spectator, null)
  assert.equal(next.match.phase, 'select')
  assert.notEqual(next.match.id, one.id)
  const watchedFinal = await env.call(loser, 'rooms', { spectateMatchId: next.match.id })
  assert.equal(watchedFinal.spectator.id, next.match.id)
  await env.call(winner, 'forfeit', { matchId: next.match.id })
  const finished = await env.call(loser, 'rooms', { spectateMatchId: next.match.id })
  assert.equal(finished.spectator, null)
  assert.equal(finished.room, null)
  assert.equal(finished.roomResult.reason, 'completed')
})

test('three-player league idle member observes a real public timeline and unchanged revisions avoid chunk reads', async () => {
  const env = setup()
  const started = await room(env, 3, 'league')
  const active = started.room.matches.find(entry => entry.phase === 'select')
  const idle = [0, 1, 2].find(index => !active.players.some(player => player.uid === identity(index).uid))
  await playTurn(env, active.id)
  env.resetReads()
  const viewed = await env.call(idle, 'rooms', { spectateMatchId: active.id })
  assert.equal(viewed.spectator.state.turn, 2)
  assert(viewed.spectator.timeline.length > 0)
  assert(env.reads() > 0)
  env.resetReads()
  const again = await env.call(idle, 'rooms', { spectateMatchId: active.id, spectateTimelineRevision: viewed.spectator.timelineRevision })
  assert.equal(env.reads(), 0)
  assert.deepEqual(again.spectator.timeline, [])
  assert.deepEqual(again.spectator.state, viewed.spectator.state)
  const refreshed = await env.call(idle, 'rooms', { spectateMatchId: active.id })
  assert.deepEqual(refreshed.spectator.timeline, viewed.spectator.timeline)
})

test('both Illusion users and their benches hide species, gear, abilities, exact HP, stats and private commands', () => {
  const state = engine.createRankedBattle({ playerTeam: roster.slice(0, 3), opponentTeam: roster.slice(0, 3), format: 'single', playerName: '왼쪽비밀이름', opponentName: '오른쪽비밀이름', random: () => .5 })
  for (const sideId of ['player', 'opponent']) {
    const side = state[sideId]
    const lead = getActivePokemon(state, sideId)
    assert(lead.illusionSnapshot)
    lead.hp = 331; lead.maxHp = 997; lead.originalMaxHp = 997
    lead.ability = `SECRET_ABILITY_${sideId}`; lead.heldItemId = `SECRET_ITEM_${sideId}`
    lead.moves.push({ id: `SECRET_MOVE_${sideId}`, name: `SECRET_MOVE_NAME_${sideId}`, currentPp: 17 })
    lead.stats = { hp: 997, speed: 77115 }; lead.trainingPoints = { hp: 113 }
    lead.status = { id: 'burn', label: '화상', internalCounter: 'SECRET_STATUS_COUNTER' }
    lead.teraType = 'SECRET_TERA'; lead.teraActive = false
    side.team[1].hp = 17; side.team[1].status = { id: 'SECRET_BENCH_STATUS' }
    side.achievementStart = { token: 'SECRET_ACHIEVEMENT' }
    side.futureMoveSlots = { 0: { moveId: 'SECRET_FUTURE_MOVE', source: lead } }
    side.selectedIndices = [5, 3, 4]
  }
  state.pendingTurn = { actions: [{ moveId: 'SECRET_FUTURE_COMMAND' }] }
  state.pendingHumanSwitch = { sideId: 'player', targetIndex: 2 }
  state.environment.weatherSourceAbility = 'SECRET_WEATHER_ABILITY'
  state.environment.weatherSourceBattleId = 'SECRET_WEATHER_SOURCE'
  state.randomState = 'SECRET_RNG'
  state.log.push({ id: 'exact-hp-997', message: '잠만보에게 997의 데미지!', tone: 'damage', private: 'SECRET_LOG_EXTRA' },
    { id: 'exact-heal-331', message: '잠만보은(는) 기술으로 HP를 331 회복했다.', tone: 'heal' })
  const view = engine.getRoomSpectatorBattleView(state, 'privacy-scope')
  const serialized = JSON.stringify(view)
  assert(!serialized.includes('SECRET_'))
  for (const text of ['zoroark', '조로아크', 'pikachu', '피카츄', '77115', '997', '331', 'ranked-player-', 'ranked-opponent-', '왼쪽비밀이름', '오른쪽비밀이름']) assert(!serialized.includes(text), text)
  for (const sideId of ['player', 'opponent']) {
    const active = getActivePokemon(view, sideId)
    assert.equal(active.speciesId, 143)
    assert.equal(active.hp, 34)
    assert.equal(active.maxHp, 100)
    assert.deepEqual(active.moves, [])
    assert.deepEqual(active.stats, {})
    assert.deepEqual(active.status, { id: 'burn', label: '화상' })
    assert.equal(active.teraType, null)
    assert.equal(view[sideId].team.filter(pokemon => pokemon.hidden).length, 2)
    assert(view[sideId].team.filter(pokemon => pokemon.hidden).every(pokemon => pokemon.status === null && pokemon.hp === 100))
  }
  assert.deepEqual(view.commandOptions, [])
  assert.equal(view.pendingTurn, null)
  assert.equal(view.pendingPlayerSwitch, null)
  assert.deepEqual(engine.getRoomSpectatorBattleView(state, 'privacy-scope'), view)
})

test('public timeline sanitizes both actors, hides switch-in targets and redacts exact damage/heal amounts', () => {
  const state = engine.createRankedBattle({ playerTeam: roster.slice(0, 3), opponentTeam: roster.slice(0, 3), format: 'single', random: () => .5 })
  const timeline = ['player', 'opponent'].map(sideId => ({ id: `${sideId}-SECRET_FRAME_ID`, phase: 'impact', sideId, targetSideId: sideId === 'player' ? 'opponent' : 'player', actorSlot: 0, targetSlot: 0,
    actorSpeciesId: 571, actorOriginalSpeciesId: 571, actorSpeciesSlug: 'zoroark', actorName: '조로아크', targetSpeciesId: 571, targetOriginalSpeciesId: 571,
    actorHeldItemId: 'SECRET_ITEM', pendingAction: 'SECRET_ACTION', damage: 997, movePower: 77115, moveId: 'protect', moveName: '방어',
    message: '잠만보에게 997데미지!', state }))
  timeline.push({ id: 'switch-private', phase: 'switch-out', sideId: 'opponent', targetSideId: 'opponent', actorSlot: 0, targetSlot: 0,
    targetName: 'SECRET_NEXT_POKEMON', message: '잠만보, 돌아와!', state })
  const visible = engine.getRoomSpectatorTimelineView(timeline, 'same-match')
  assert.equal(visible.length, 3)
  const text = JSON.stringify(visible)
  for (const hidden of ['SECRET_', 'zoroark', '조로아크', '997', '77115']) assert(!text.includes(hidden), hidden)
  for (const step of visible.slice(0, 2)) {
    assert.equal(step.actorSpeciesId, 143)
    assert.equal(step.targetSpeciesId, 143)
    assert.equal(step.moveName, '방어')
    assert.equal(step.damage, undefined)
    assert.equal(step.message, '잠만보에게 데미지!')
  }
  assert.equal(visible[2].targetName, undefined)
  const view = engine.getRoomSpectatorBattleView(state, 'same-match')
  assert.equal(getActivePokemon(view, 'player').battleId, getActivePokemon(visible[0].state, 'player').battleId)
})

test('spectators see real weather and terrain changes while internal sources and future state stay private', () => {
  const mew = normalizePokemon({ speciesId: 151, captureId: 'spectator-environment', moves: ['raindance', 'electricterrain', 'protect'].map(id => getMoveById(id).name) })
  const initial = engine.createRankedBattle({ playerTeam: [mew, roster[1], roster[2]], opponentTeam: roster.slice(3, 6), format: 'single', random: () => .5 })
  const opponent = [{ type: 'move', actorSlot: 0, moveIndex: 0, targetSideId: 'opponent', targetSlot: 0 }]
  const rain = engine.resolveRankedTurn(initial, { player: [{ type: 'move', actorSlot: 0, moveIndex: 0 }], opponent }, () => .5)
  const first = engine.getRoomSpectatorBattleView(rain.state, 'environment-match')
  assert.equal(first.rules.weather.id, 'rain')
  assert.equal(first.environment.weatherTurns, 4)
  const electric = engine.resolveRankedTurn(rain.state, { player: [{ type: 'move', actorSlot: 0, moveIndex: 1 }], opponent }, () => .5)
  const second = engine.getRoomSpectatorBattleView(electric.state, 'environment-match')
  assert.equal(second.rules.weather.id, 'rain')
  assert.equal(second.rules.terrain.id, 'electric')
  assert.equal(second.environment.weatherTurns, 3)
  assert.equal(second.environment.terrainTurns, 4)
  assert.equal(second.environment.weatherSource, undefined)
  assert.equal(second.environment.terrainSource, undefined)
  assert.equal(second.environment.weatherSourceAbility, undefined)
  const timeline = engine.getRoomSpectatorTimelineView(electric.timeline, 'environment-match')
  assert(timeline.some(step => step.state.rules.terrain.id === 'electric'))
  assert.equal(initial.rules.weather.id, 'clear')
  assert.equal(initial.rules.terrain.id, 'neutral')
})

test('doubles preserve both visible slots and timeline actors after opaque party index remapping', () => {
  const initial = engine.createRankedBattle({ playerTeam: roster.slice(0, 4), opponentTeam: roster.slice(0, 4), format: 'double', random: () => .5 })
  const actions = sideId => [0, 1].map(actorSlot => ({ type: 'move', actorSlot, moveIndex: 0, targetSideId: sideId, targetSlot: actorSlot }))
  const turn = engine.resolveRankedTurn(initial, { player: actions('player'), opponent: actions('opponent') }, () => .5)
  const view = engine.getRoomSpectatorBattleView(turn.state, 'doubles-match')
  assert.equal(view.rules.format.id, 'double')
  assert.equal(view.rules.format.activeSlots, 2)
  for (const sideId of ['player', 'opponent']) {
    assert.equal(view[sideId].team.length, 4)
    assert.equal(view[sideId].activeIndexes.length, 2)
    assert.equal(getActivePokemon(view, sideId, 0).speciesId, 6)
    assert.equal(getActivePokemon(view, sideId, 1).speciesId, 25)
    assert.equal(view[sideId].team.filter(pokemon => pokemon.hidden).length, 2)
  }
  const frames = engine.getRoomSpectatorTimelineView(turn.timeline, 'doubles-match')
  for (const frame of frames.filter(entry => entry.actorSpeciesId && entry.sideId)) {
    assert.equal(frame.actorSpeciesId, getActivePokemon(frame.state, frame.sideId, frame.actorSlot ?? 0).speciesId)
  }
  assert(!JSON.stringify(frames).includes('zoroark'))
})

test('spectator requests cannot submit, select, replace or forfeit another participant match', async () => {
  const env = setup()
  const initial = await room(env, 3)
  const bye = who(initial.room.matches.find(entry => entry.phase === 'bye').winnerUid)
  const active = initial.room.matches.find(entry => entry.phase === 'select')
  for (const action of ['select', 'submit', 'replace', 'forfeit']) await assert.rejects(env.call(bye, action, { matchId: active.id, revision: 1, selection: [0, 1, 2], targetIndex: 1, actions: [] }), error => error.code === 'MATCH_FORBIDDEN')
  await assert.rejects(env.call(bye, 'rooms', { spectateMatchId: '../bad' }), error => error.code === 'INVALID_SPECTATOR_MATCH')
  await assert.rejects(env.call(bye, 'rooms', { spectateMatchId: active.id, spectateTimelineRevision: '-1' }), error => error.code === 'INVALID_SPECTATOR_REVISION')
})

test('HTTP parses spectator query and unchanged revision while missing authentication stays rejected', async () => {
  const env = setup()
  const initial = await room(env, 3)
  const bye = who(initial.room.matches.find(entry => entry.phase === 'bye').winnerUid)
  const active = initial.room.matches.find(entry => entry.phase === 'select')
  await playTurn(env, active.id)
  const handler = createRankedHttpHandler({ enabled: true, service: env.service, authenticate: async (_request, token) => identity(Number(token.replace('spectator-token-', ''))) })
  const url = `http://127.0.0.1/api/ranked?action=rooms&spectateMatchId=${active.id}`
  assert.equal((await handler(new Request(url))).status, 401)
  const headers = { Authorization: `Bearer spectator-token-${bye}` }
  const response = await handler(new Request(url, { headers }))
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.spectator.id, active.id)
  assert(body.spectator.timeline.length > 0)
  const unchanged = await (await handler(new Request(`${url}&spectateTimelineRevision=${body.spectator.timelineRevision}`, { headers }))).json()
  assert.deepEqual(unchanged.spectator.timeline, [])
  assert.equal(response.headers.get('cache-control'), 'no-store')
})

let passed = 0
for (const { name, run } of tests) {
  try { await run(); passed += 1; console.log(`PASS ${name}`) }
  catch (error) { console.error(`FAIL ${name}`); throw error }
}
console.log(`Room spectator validation passed: ${passed}/${tests.length}`)
