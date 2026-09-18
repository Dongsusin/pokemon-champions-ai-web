import { createHash, randomUUID, randomBytes } from 'node:crypto'
import { createRankedProfile, getRankedFormat, settleRankedRatings } from '../src/data/rankedRules.js'
import { getRankedVpReward } from '../src/data/rankedRewards.js'
import { maskRankedMatch, maskRankedTrainerName } from '../src/data/rankedPrivacy.js'
import { readTrainerNickname } from '../src/data/trainerNickname.js'
import { readPokemonUsage, recordRankedPokemonUsage, reportAiPokemonUsage, validateAiPokemonUsage } from './pokemonUsageService.js'
import { readFactoryLeaderboard, reportFactoryRun, validateFactoryRankingReport } from './battleFactoryRankingService.js'
import { readRankedLeaderboard } from './rankedLeaderboardService.js'
import { createRankedQueueCountsReader } from './rankedQueueCounts.js'
import { createGuestIdentityRegistry } from './guestIdentity.js'
import { createBattleRoomService, validateRoomPassword } from './battleRoomService.js'
import { eraseGuestRankedData } from './guestAccountCleanup.js'

const QUEUE_LEASE = 30_000
const QUEUE_HEARTBEAT = 10_000
const SELECT_TIMEOUT = 90_000
const TURN_TIMEOUT = 60_000
const REPLACEMENT_TIMEOUT = 45_000
const MAX_TURNS = 300
const MAX_QUEUE = 200
const REQUEST_HISTORY = 64
// Leave room for the match document and Firestore deleting the previous
// timeline in the same 10 MiB transaction, as well as Vercel's response limit.
const MAX_TIMELINE_BYTES = 3_500_000
const clone = value => structuredClone(value)
const vpRewardTotal = value => Number.isSafeInteger(value) && value >= 0 ? value : 0

export class RankedError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status }
}
const fail = (code, message, status) => { throw new RankedError(code, message, status) }
const isId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value)
const sideOf = (match, uid) => match.players[0].uid === uid ? 'player' : 'opponent'
const indexOf = (match, uid) => match.players.findIndex(player => player.uid === uid)
const opposite = side => side === 'player' ? 'opponent' : 'player'

function digest(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex') }
function seededRandom(seed) {
  let state = seed >>> 0
  return () => {
    state += 0x6D2B79F5
    let value = state
    value = Math.imul(value ^ value >>> 15, value | 1)
    value ^= value + Math.imul(value ^ value >>> 7, value | 61)
    return ((value ^ value >>> 14) >>> 0) / 4294967296
  }
}

function previewPokemon(pokemon) {
  const view = {}
  for (const key of ['captureId', 'speciesId', 'dexSpeciesId', 'slug', 'name', 'formName', 'types', 'spriteFront', 'spriteBack', 'isShiny']) {
    if (pokemon[key] !== undefined) view[key] = clone(pokemon[key])
  }
  return view
}

function profileRecord(uid, name) {
  return { uid, name, profiles: { single: createRankedProfile('single'), double: createRankedProfile('double') }, vpRewardTotal: 0, activeMatchId: null, queueTicket: null, requests: [] }
}

function assertRequest(payload) {
  if (!isId(payload.requestId) || payload.requestId.length < 8) fail('INVALID_REQUEST_ID', '요청 식별자가 올바르지 않습니다.')
}
function remember(record, requestId, hash) {
  record.requests ??= []
  record.requests.push({ id: requestId, hash })
  record.requests = record.requests.slice(-REQUEST_HISTORY)
}
function hasRequest(record, requestId, hash) {
  const previous = record.requests?.find(request => request.id === requestId)
  if (previous && previous.hash !== hash) fail('REQUEST_ID_REUSED', '같은 요청 식별자로 다른 명령을 보낼 수 없습니다.', 409)
  return Boolean(previous)
}

export function createRankedService({ store, engine, now = Date.now, newId = randomUUID,
  makeSeed = () => randomBytes(4).readUInt32LE(), resolveTeam = async (_identity, team) => team,
  fixtures = null, timeouts = {}, usageEnabled = false, guestRegistry = null }) {
  const guestIdentities = guestRegistry ?? createGuestIdentityRegistry({ store, now })
  const readQueueCounts = createRankedQueueCountsReader({ store, now })
  const selectionTimeout = timeouts.selection ?? SELECT_TIMEOUT
  const turnTimeout = timeouts.turn ?? TURN_TIMEOUT
  const replacementTimeout = timeouts.replacement ?? REPLACEMENT_TIMEOUT
  const playbackGrace = timeouts.playbackGrace ?? 15_000

  async function loadPlayer(tx, identity) {
    let player = await tx.get('players', identity.uid)
    const nicknameChanged = player && readTrainerNickname(player.nickname) !== identity.nickname
    if (!player) player = profileRecord(identity.uid, identity.name)
    player.name = identity.name
    player.isGuest = identity.isGuest === true
    player.nickname = identity.nickname
    if (nicknameChanged) tx.set('players', identity.uid, player)
    return player
  }
  async function lobbyLock(tx) {
    const lobby = await tx.get('meta', 'lobby') ?? { version: 0 }
    tx.set('meta', 'lobby', { version: lobby.version + 1 })
  }
  async function settlement(tx, match, winner, reason, timestamp) {
    if (match.phase === 'finished') return
    if (match.roomId) {
      match.phase = 'finished'
      match.deadlineAt = null
      match.finishedAt = timestamp
      match.winner = winner
      match.reason = reason
      match.revision += 1
      match.pendingActions = {}
      match.result = match.players.map((_, index) => ({ outcome: winner === 'draw' ? 'draw' : (winner === 'player' ? 0 : 1) === index ? 'win' : 'loss', reason, friendly: true, rewardVp: 0, ratingDelta: 0, pointsDelta: 0 }))
      for (const entrant of match.players) {
        const player = await tx.get('players', entrant.uid)
        if (player?.activeMatchId === match.id) { player.activeMatchId = null; tx.set('players', player.uid, player) }
      }
      tx.set('matches', match.id, match)
      return
    }
    const first = await tx.get('players', match.players[0].uid)
    const second = await tx.get('players', match.players[1].uid)
    if (!first || !second) throw new Error('Ranked player record missing')
    const outcome = winner === 'draw' ? 'draw' : winner === 'player' ? 'win' : 'loss'
    const before = [clone(first.profiles[match.format]), clone(second.profiles[match.format])]
    const settled = settleRankedRatings(before[0], before[1], outcome)
    first.profiles[match.format] = settled.a
    second.profiles[match.format] = settled.b
    match.phase = 'finished'
    match.deadlineAt = null
    match.finishedAt = timestamp
    match.winner = winner
    match.reason = reason
    match.revision += 1
    match.pendingActions = {}
    match.result = [
      { outcome, reason, ratingBefore: before[0].rating, ratingAfter: settled.a.rating, ratingDelta: settled.a.rating - before[0].rating, pointsBefore: before[0].points, pointsAfter: settled.a.points, pointsDelta: settled.a.points - before[0].points },
      { outcome: outcome === 'draw' ? 'draw' : outcome === 'win' ? 'loss' : 'win', reason, ratingBefore: before[1].rating, ratingAfter: settled.b.rating, ratingDelta: settled.b.rating - before[1].rating, pointsBefore: before[1].points, pointsAfter: settled.b.points, pointsDelta: settled.b.points - before[1].points },
    ]
    for (const player of [first, second]) {
      const result = match.result[indexOf(match, player.uid)]
      result.rewardVp = getRankedVpReward({ outcome: result.outcome, reason, battleStarted: Boolean(match.state) })
      // A lifetime counter lets clients reconcile missed rewards without
      // depending on the bounded match history or replaying finished games.
      player.vpRewardTotal = vpRewardTotal(player.vpRewardTotal) + result.rewardVp
      if (!Number.isSafeInteger(player.vpRewardTotal)) throw new Error('Ranked VP reward total exceeds the safe integer range')
      // Keep the settled match for safe retries, but it is no longer a session
      // to resume when either player opens the game again.
      if (player.activeMatchId === match.id) player.activeMatchId = null
      player.history = [{ matchId: match.id, format: match.format, finishedAt: timestamp, ...result }, ...(player.history ?? [])].slice(0, 20)
      tx.set('players', player.uid, player)
    }
    tx.set('matches', match.id, match)
  }

  async function expireMatch(tx, match, timestamp) {
    if (!match || match.phase === 'finished' || timestamp < match.deadlineAt) return false
    let winner = 'draw'
    let reason = 'both-timeout'
    if (match.phase === 'select') {
      const ready = match.players.map(player => Boolean(match.selections[player.uid]))
      if (ready[0] !== ready[1]) winner = ready[0] ? 'player' : 'opponent'
      reason = winner === 'draw' ? 'both-selection-timeout' : 'selection-timeout'
    } else if (match.state?.pendingHumanSwitch) {
      winner = opposite(match.state.pendingHumanSwitch.sideId)
      reason = 'replacement-timeout'
    } else {
      const ready = ['player', 'opponent'].map(side => Boolean(match.pendingActions[side]))
      if (ready[0] !== ready[1]) winner = ready[0] ? 'player' : 'opponent'
      reason = winner === 'draw' ? 'both-timeout' : 'turn-timeout'
    }
    await settlement(tx, match, winner, reason, timestamp)
    return true
  }

  function viewMatch(match, uid, timeline = []) {
    if (!match) return null
    const index = indexOf(match, uid)
    if (index < 0) fail('MATCH_FORBIDDEN', '이 대전에 참여한 계정만 조회할 수 있습니다.', 403)
    const side = index === 0 ? 'player' : 'opponent'
    const you = match.players[index]
    const opponent = match.players[1 - index]
    return maskRankedMatch({
      id: match.id, roomId: match.roomId ?? null, format: match.format, phase: match.phase, revision: match.revision,
      timelineRevision: match.timelineRevision,
      createdAt: match.createdAt, deadlineAt: match.deadlineAt, finishedAt: match.finishedAt ?? null,
      you: { name: you.name, nickname: you.nickname, rating: you.rating, isGuest: you.isGuest === true }, opponent: { name: opponent.name, nickname: opponent.nickname, rating: opponent.rating, isGuest: opponent.isGuest === true },
      teamPreview: { you: clone(you.team), opponent: opponent.team.map(previewPokemon) },
      selectionSubmitted: Boolean(match.selections[uid]), opponentSelectionSubmitted: Boolean(match.selections[opponent.uid]),
      selectedIndices: clone(match.selections[uid] ?? []),
      actionSubmitted: Boolean(match.pendingActions[side]), opponentActionSubmitted: Boolean(match.pendingActions[opposite(side)]),
      state: match.state ? engine.getRankedBattleView(match.state, side) : null,
      timeline: timeline.length ? engine.getRankedTimelineView(timeline, side) : [],
      result: match.result ? clone(match.result[index]) : null,
    })
  }

  async function spectatorView(tx, uid, matchId, knownTimelineRevision) {
    if (!matchId) return null
    const target = await tx.get('matches', matchId)
    if (!target) return null
    if (!target.roomId) fail('SPECTATOR_FORBIDDEN', '같은 방에서 진행 중인 경기만 관전할 수 있습니다.', 403)
    const player = await tx.get('players', uid)
    const room = player?.activeRoomId ? await tx.get('battleRooms', player.activeRoomId) : null
    if (!room || room.id !== target.roomId) {
      // A completed/deleted room or a voluntary departure cannot resume the
      // old stream. A different room's ID remains an authorization error.
      if (!room && (player?.lastRoomId === target.roomId || player?.roomResult?.roomId === target.roomId)) return null
      fail('SPECTATOR_FORBIDDEN', '같은 방에 참가한 대기자만 관전할 수 있습니다.', 403)
    }
    const member = room.members.find(entry => entry.uid === uid)
    if (!member || member.withdrawn) fail('SPECTATOR_FORBIDDEN', '이 방의 대기 참가자만 관전할 수 있습니다.', 403)
    const own = player.activeMatchId ? await tx.get('matches', player.activeMatchId) : null
    if (room.phase !== 'active' || (own && own.phase !== 'finished') || indexOf(target, uid) >= 0 || target.phase === 'finished') return null
    if (!room.fixtures.some(entry => entry.id === target.id && entry.round === room.round && ['select', 'battle'].includes(entry.phase))) return null
    const timeline = []
    if (Number(knownTimelineRevision) !== target.timelineRevision) {
      for (let index = 0; index < (target.timelineChunks ?? 0); index += 1) {
        const chunk = await tx.get('timelines', `${target.id}_${target.timelineRevision}_${index}`)
        if (chunk) timeline.push(...chunk.frames)
      }
    }
    return {
      id: target.id, roomId: target.roomId, format: target.format, phase: target.phase,
      revision: target.revision, timelineRevision: target.timelineRevision, deadlineAt: target.deadlineAt,
      players: target.players.map(player => ({ name: maskRankedTrainerName(player.name, player.isGuest, player.nickname), nickname: player.nickname, isGuest: player.isGuest === true })),
      state: target.state ? engine.getRoomSpectatorBattleView(target.state, target.id) : null,
      timeline: timeline.length ? engine.getRoomSpectatorTimelineView(timeline, target.id) : [], result: null,
    }
  }

  async function snapshot(tx, uid, { knownTimelineRevision, knownMatchId, includeRooms = false, spectateMatchId, spectateTimelineRevision } = {}) {
    let player = await tx.get('players', uid)
    const knownRoomMatch = knownMatchId ? await tx.get('matches', knownMatchId) : null
    const roomContext = includeRooms || Boolean(player?.activeRoomId || knownRoomMatch?.roomId)
    if (roomContext) { await rooms.cleanup(tx, now(), player?.activeRoomId ?? knownRoomMatch?.roomId); player = await tx.get('players', uid) }
    const queue = await tx.get('queue', uid)
    let match = player?.activeMatchId ? await tx.get('matches', player.activeMatchId) : null
    if (knownMatchId) {
      const known = await tx.get('matches', knownMatchId)
      if (known?.roomId && known.phase === 'finished' && indexOf(known, uid) >= 0 && !(spectateMatchId && match && match.phase !== 'finished')) match = known
    }
    if (match?.phase === 'finished') {
      // Lazy migration for matches settled before active pointers were cleared.
      if (!match.roomId) {
        player.activeMatchId = null
        tx.set('players', uid, player)
        match = null
      }
    }
    if (!match && !player?.activeMatchId && !queue && knownMatchId) {
      const known = await tx.get('matches', knownMatchId)
      // Only a client already playing this match needs the last animation and
      // result. A fresh status request gets the settled profile and lobby.
      if (known?.phase === 'finished') match = known
    }
    const rankedConflict = Boolean(queue || (match && !match.roomId && match.phase !== 'finished'))
    if (includeRooms && match && !match.roomId) match = null
    const timeline = []
    const unchangedTimeline = match && knownMatchId === match.id && Number(knownTimelineRevision) === match.timelineRevision
    for (let index = 0; !unchangedTimeline && index < (match?.timelineChunks ?? 0); index += 1) {
      const chunk = await tx.get('timelines', `${match.id}_${match.timelineRevision}_${index}`)
      if (chunk) timeline.push(...chunk.frames)
    }
    return {
      profile: clone(player?.profiles ?? { single: createRankedProfile('single'), double: createRankedProfile('double') }),
      vpRewards: { uid, total: vpRewardTotal(player?.vpRewardTotal) },
      queue: queue ? { ticket: queue.ticket, format: queue.format, queuedAt: queue.queuedAt, expiresAt: queue.expiresAt, rating: queue.rating } : null,
      match: viewMatch(match, uid, timeline), serverTime: now(),
      ...(roomContext ? await rooms.context(tx, uid) : { room: null, roomResult: clone(player?.roomResult ?? null) }),
      ...(includeRooms ? { rankedConflict, spectator: await spectatorView(tx, uid, spectateMatchId, spectateTimelineRevision) } : {}),
    }
  }

  async function tryMatch(tx, queue, timestamp, matchId) {
    if (!queue || queue.expiresAt <= timestamp) return null
    const all = await tx.list('queue')
    const candidates = all.filter(other => other.uid !== queue.uid && other.format === queue.format && other.expiresAt > timestamp)
      .filter(other => Math.abs(other.rating - queue.rating) <= Math.min(800, 100 + Math.floor(Math.max(timestamp - queue.queuedAt, timestamp - other.queuedAt) / 15_000) * 100))
      .sort((a, b) => a.queuedAt - b.queuedAt || a.uid.localeCompare(b.uid))
    for (const other of candidates) {
      const first = await tx.get('players', other.uid)
      const second = await tx.get('players', queue.uid)
      if (!first || !second || first.queueTicket !== other.ticket || second.queueTicket !== queue.ticket) continue
      const match = {
        id: matchId, format: queue.format, phase: 'select', revision: 1, timelineRevision: 0,
        createdAt: timestamp, deadlineAt: timestamp + selectionTimeout,
        players: [other, queue].map(entry => ({ uid: entry.uid, name: entry.name, nickname: readTrainerNickname(entry.nickname), isGuest: entry.isGuest === true, rating: entry.rating, team: entry.team })),
        selections: {}, pendingActions: {}, state: null, timelineChunks: 0, requests: [],
      }
      for (const player of [first, second]) {
        player.activeMatchId = matchId
        player.queueTicket = null
        tx.delete('queue', player.uid)
        tx.set('players', player.uid, player)
      }
      tx.set('matches', matchId, match)
      return match
    }
    return null
  }

  async function sync(tx, identity, timestamp, matchId) {
    let player = await loadPlayer(tx, identity)
    const match = player.activeMatchId ? await tx.get('matches', player.activeMatchId) : null
    if (match && await expireMatch(tx, match, timestamp)) player = await tx.get('players', identity.uid)
    let queue = await tx.get('queue', identity.uid)
    if (queue && queue.expiresAt > timestamp && readTrainerNickname(queue.nickname) !== identity.nickname) {
      Object.assign(queue, { name: identity.name, nickname: identity.nickname, isGuest: identity.isGuest })
      tx.set('queue', identity.uid, queue)
    }
    if (queue) {
      if (queue.expiresAt <= timestamp) {
        await lobbyLock(tx)
        tx.delete('queue', identity.uid)
        player.queueTicket = null
        tx.set('players', identity.uid, player)
      } else if (queue.expiresAt - timestamp <= QUEUE_LEASE - QUEUE_HEARTBEAT) {
        // Frequent UI polls are read-only between heartbeats. The 30-second
        // lease still leaves 20 seconds for a delayed renewal, while newly
        // joining opponents match immediately through their join transaction.
        // Re-check widening rating ranges only when renewing the lease.
        await lobbyLock(tx)
        queue.expiresAt = timestamp + QUEUE_LEASE
        tx.set('queue', identity.uid, queue)
        await tryMatch(tx, queue, timestamp, matchId)
      }
    } else if (!await tx.get('players', identity.uid)) {
      tx.set('players', identity.uid, player)
    }
  }

  async function afterEngine(tx, match, result, timestamp) {
    match.state = result.state ?? result
    for (let index = 0; index < (match.timelineChunks ?? 0); index += 1) tx.delete('timelines', `${match.id}_${match.timelineRevision}_${index}`)
    match.revision += 1
    match.timelineRevision = match.revision
    const chunks = []
    let frames = []
    let bytes = 0
    let totalBytes = 2
    for (const frame of result.timeline ?? []) {
      const size = Buffer.byteLength(JSON.stringify(frame), 'utf8')
      totalBytes += size + 1
      if (totalBytes > MAX_TIMELINE_BYTES) throw new RankedError('BATTLE_STATE_TOO_LARGE', '대전 연출이 저장 한도를 넘었습니다. 운영자에게 문의해주세요.', 503)
      if (size > 700_000) throw new RankedError('BATTLE_STATE_TOO_LARGE', '대전 상태가 저장 한도를 넘었습니다. 운영자에게 문의해주세요.', 503)
      if (bytes + size > 700_000) { chunks.push(frames); frames = []; bytes = 0 }
      frames.push(frame)
      bytes += size
    }
    if (frames.length) chunks.push(frames)
    if (chunks.length > 100) throw new RankedError('BATTLE_STATE_TOO_LARGE', '대전 연출이 저장 한도를 넘었습니다.', 503)
    match.timelineChunks = chunks.length
    match.timelineBytes = totalBytes
    chunks.forEach((chunk, index) => tx.set('timelines', `${match.id}_${match.timelineRevision}_${index}`, { frames: chunk }))
    match.pendingActions = {}
    match.deadlineAt = timestamp + (match.state.pendingHumanSwitch ? replacementTimeout : turnTimeout) + (chunks.length ? playbackGrace : 0)
    if (match.state.winner) await settlement(tx, match, match.state.winner, 'battle', timestamp)
    else if ((match.state.turn ?? 0) > MAX_TURNS) await settlement(tx, match, 'draw', 'turn-limit', timestamp)
    else tx.set('matches', match.id, match)
  }

  function mapAction(action, side) {
    const mapped = clone(action)
    // Browser always sees itself as player. Convert only the explicit target;
    // the engine receives the actor side from authenticated match membership.
    if (side === 'opponent' && ['player', 'opponent'].includes(mapped.targetSideId)) mapped.targetSideId = opposite(mapped.targetSideId)
    return mapped
  }

  const rooms = createBattleRoomService({ fail, loadPlayer, expireMatch, settleMatch: settlement, now, selectionTimeout,
    async createMatch(tx, room, fixture, timestamp) {
      const match = {
        id: fixture.id, roomId: room.id, format: room.format, phase: 'select', revision: 1, timelineRevision: 0,
        createdAt: timestamp, deadlineAt: timestamp + selectionTimeout,
        players: fixture.uids.map(uid => { const member = room.members.find(entry => entry.uid === uid); return { uid, name: member.name, nickname: readTrainerNickname(member.nickname), isGuest: member.isGuest === true, rating: 0, team: clone(member.team) } }),
        selections: {}, pendingActions: {}, state: null, timelineChunks: 0, requests: [],
      }
      for (const entrant of match.players) {
        const player = await tx.get('players', entrant.uid)
        const member = room.members.find(member => member.uid === entrant.uid)
        if (!member.withdrawn && player?.activeRoomId === room.id) {
          const publicIdentity = { name: player.name, nickname: readTrainerNickname(player.nickname), isGuest: player.isGuest === true }
          Object.assign(entrant, publicIdentity)
          Object.assign(member, publicIdentity)
          player.activeMatchId = match.id
          tx.set('players', player.uid, player)
        }
      }
      tx.set('matches', match.id, match)
      return match
    },
  })

  async function execute(identity, payload) {
    if (!identity || !isId(identity.uid)) fail('UNAUTHENTICATED', '로그인이 필요합니다.', 401)
    identity = { uid: identity.uid, name: String(identity.name || '트레이너').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 32), isGuest: identity.isGuest === true, nickname: identity.isGuest === true ? '' : readTrainerNickname(identity.nickname) }
    const action = payload?.action ?? 'status'
    if (!['guestProfile', 'status', 'queueCounts', 'fixtures', 'usage', 'reportAiUsage', 'factoryLeaderboard', 'rankedLeaderboard', 'reportFactoryRun', 'join', 'cancel', 'select', 'submit', 'replace', 'forfeit', 'rooms', 'roomCreate', 'roomJoin', 'roomStart', 'roomLeave', 'roomDismissResult'].includes(action)) fail('UNKNOWN_ACTION', '지원하지 않는 요청입니다.')
    if (action === 'guestProfile') return guestIdentities.create(identity)
    if (identity.isGuest) {
      const profile = await guestIdentities.read(identity)
      identity.name = profile.displayName
    }
    if (action === 'queueCounts') return readQueueCounts()
    const transaction = work => store.transaction(async tx => {
      // Recheck within the write transaction. A request already in flight when
      // logout starts must not recreate data after the deletion transaction.
      if (identity.isGuest) await guestIdentities.read(identity, tx)
      return work(tx)
    })
    if (action === 'factoryLeaderboard') return transaction(tx => readFactoryLeaderboard(tx, identity.uid, identity, payload.mode))
    if (action === 'rankedLeaderboard') return transaction(tx => readRankedLeaderboard(tx, identity.uid, now(), identity))
    if (action === 'reportFactoryRun') {
      const report = validateFactoryRankingReport(payload.report)
      const recordedAt = now()
      const entryId = newId()
      return transaction(tx => reportFactoryRun(tx, identity, report, recordedAt, entryId))
    }
    if (action === 'fixtures') {
      if (!fixtures) fail('NOT_FOUND', '테스트 팀은 로컬 테스트에서만 제공됩니다.', 404)
      return { teams: clone(fixtures) }
    }
    if (action === 'usage' || action === 'reportAiUsage') {
      if (usageEnabled !== true) fail('USAGE_DISABLED', '포켓몬 사용률 집계는 아직 운영 서버에서 활성화되지 않았습니다.', 503)
      if (action === 'usage') return transaction(readPokemonUsage)
      assertRequest(payload)
      const report = validateAiPokemonUsage(payload)
      const reportedAt = now()
      return transaction(tx => reportAiPokemonUsage(tx, identity.uid, report, reportedAt))
    }
    const timestamp = now()
    const id = newId()
    const seed = makeSeed()
    const salt = randomBytes(16).toString('hex')
    let team
    if (!['status', 'rooms'].includes(action)) assertRequest(payload)
    if (action === 'roomCreate') {
      if (!['tournament', 'league'].includes(payload.mode)) fail('INVALID_ROOM_MODE', '토너먼트 또는 리그전을 선택해주세요.')
      if (!getRankedFormat(payload.format)) fail('INVALID_FORMAT', '싱글 또는 더블 배틀을 선택해주세요.')
      const title = typeof payload.title === 'string' ? payload.title.trim().replace(/[\u0000-\u001f\u007f]/g, '') : ''
      if (!title || title.length > 32) fail('INVALID_ROOM_TITLE', '방 이름은 1~32자로 입력해주세요.')
      payload = { ...payload, title }
      validateRoomPassword(payload.password, fail)
      team = engine.canonicalizeRankedTeam(await resolveTeam(identity, payload.team), { format: payload.format, requireRegisteredTeam: true })
    }
    if (['roomJoin', 'roomStart', 'roomLeave'].includes(action) && !isId(payload.roomId)) fail('INVALID_ROOM', '방 식별자가 올바르지 않습니다.')
    if (action === 'roomJoin') {
      validateRoomPassword(payload.password, fail)
      const targetRoom = await transaction(tx => tx.get('battleRooms', payload.roomId))
      if (!targetRoom) fail('ROOM_NOT_FOUND', '방이 종료되었거나 삭제되었습니다.', 404)
      team = engine.canonicalizeRankedTeam(await resolveTeam(identity, payload.team), { format: targetRoom.format, requireRegisteredTeam: true })
    }
    if (action === 'join') {
      if (!getRankedFormat(payload.format)) fail('INVALID_FORMAT', '싱글 또는 더블 배틀을 선택해주세요.')
      team = engine.canonicalizeRankedTeam(await resolveTeam(identity, payload.team), { format: payload.format, requireRegisteredTeam: true })
    }
    const requestHash = digest(payload)
    const response = await transaction(async tx => {
      const existingPlayer = await tx.get('players', identity.uid)
      if (!['status', 'rooms'].includes(action) && (action.startsWith('room') || existingPlayer?.activeRoomId)) await rooms.cleanup(tx, timestamp, existingPlayer?.activeRoomId)
      if (action === 'status' || action === 'rooms') {
        if (action === 'rooms' && payload.spectateMatchId !== undefined && !isId(payload.spectateMatchId)) fail('INVALID_SPECTATOR_MATCH', '관전할 경기 식별자가 올바르지 않습니다.')
        if (action === 'rooms' && payload.spectateTimelineRevision !== undefined && (!/^\d+$/.test(String(payload.spectateTimelineRevision)) || !Number.isSafeInteger(Number(payload.spectateTimelineRevision)))) fail('INVALID_SPECTATOR_REVISION', '관전 연출 버전이 올바르지 않습니다.')
        await sync(tx, identity, timestamp, id)
        if (payload.matchId) {
          if (!isId(payload.matchId)) fail('INVALID_MATCH', '대전 식별자가 올바르지 않습니다.')
          const requested = await tx.get('matches', payload.matchId)
          if (!requested) fail('MATCH_NOT_FOUND', '대전을 찾을 수 없습니다.', 404)
          if (indexOf(requested, identity.uid) < 0) fail('MATCH_FORBIDDEN', '이 대전에 참여한 계정만 조회할 수 있습니다.', 403)
        }
        return snapshot(tx, identity.uid, { knownTimelineRevision: payload.timelineRevision, knownMatchId: payload.matchId, includeRooms: action === 'rooms',
          ...(action === 'rooms' ? { spectateMatchId: payload.spectateMatchId, spectateTimelineRevision: payload.spectateTimelineRevision } : {}),
        })
      }
      let player = await loadPlayer(tx, identity)
      if (hasRequest(player, payload.requestId, requestHash)) return snapshot(tx, identity.uid, { includeRooms: action.startsWith('room') })
      if (['roomCreate', 'roomJoin', 'roomStart', 'roomLeave', 'roomDismissResult'].includes(action)) {
        let result
        try { result = await rooms.operate(tx, identity, payload, { timestamp, id, seed, team, salt }) }
        catch (error) {
          // Validation occurs before room mutations. Commit any preceding
          // deadline cleanup even when the requested room has just expired.
          if (error instanceof RankedError) return { roomError: { code: error.code, message: error.message, status: error.status } }
          throw error
        }
        if (result?.roomError) return result
        player = await tx.get('players', identity.uid) ?? player
        remember(player, payload.requestId, requestHash)
        tx.set('players', player.uid, player)
        return snapshot(tx, player.uid, { includeRooms: true })
      }
      if (action === 'join') {
        await lobbyLock(tx)
        if (player.activeRoomId && await tx.get('battleRooms', player.activeRoomId)) fail('ALREADY_IN_ROOM', '참가 중인 방을 먼저 나가주세요.', 409)
        const current = player.activeMatchId ? await tx.get('matches', player.activeMatchId) : null
        if (current) await expireMatch(tx, current, timestamp)
        if (current && current.phase !== 'finished') fail('ALREADY_IN_MATCH', '진행 중인 대전을 먼저 마쳐주세요.', 409)
        // An expiry may have settled ratings. Never overwrite its fresh profile.
        player = await tx.get('players', identity.uid) ?? player
        const previous = await tx.get('queue', identity.uid)
        if (previous && previous.expiresAt > timestamp) {
          if (previous.format !== payload.format || digest(previous.team) !== digest(team)) fail('ALREADY_QUEUED', '다른 팀으로 검색하려면 현재 검색을 취소해주세요.', 409)
          if (readTrainerNickname(previous.nickname) !== identity.nickname) {
            Object.assign(previous, { name: identity.name, nickname: identity.nickname, isGuest: identity.isGuest })
            tx.set('queue', identity.uid, previous)
          }
          remember(player, payload.requestId, requestHash)
          tx.set('players', player.uid, player)
          return snapshot(tx, player.uid)
        }
        const queues = await tx.list('queue')
        for (const expired of queues.filter(entry => entry.expiresAt <= timestamp)) tx.delete('queue', expired.uid)
        if (queues.filter(entry => entry.expiresAt > timestamp).length >= MAX_QUEUE) fail('QUEUE_FULL', '매칭 서버가 혼잡합니다. 잠시 후 다시 시도해주세요.', 503)
        const queue = { uid: identity.uid, name: identity.name, nickname: identity.nickname, isGuest: identity.isGuest === true, ticket: id, format: payload.format, team, queuedAt: timestamp, expiresAt: timestamp + QUEUE_LEASE, rating: player.profiles[payload.format].rating }
        player.queueTicket = id
        player.activeMatchId = null
        remember(player, payload.requestId, requestHash)
        tx.set('players', player.uid, player)
        tx.set('queue', player.uid, queue)
        await tryMatch(tx, queue, timestamp, id)
        return snapshot(tx, player.uid)
      }
      if (action === 'cancel') {
        await lobbyLock(tx)
        const queue = await tx.get('queue', identity.uid)
        if (queue && queue.ticket !== payload.queueTicket) fail('STALE_QUEUE', '검색 상태가 바뀌었습니다. 최신 화면에서 다시 시도해주세요.', 409)
        if (queue) {
          tx.delete('queue', identity.uid)
          player.queueTicket = null
        }
        // A match won the race: leave it intact and return it to the client.
        remember(player, payload.requestId, requestHash)
        tx.set('players', player.uid, player)
        return snapshot(tx, player.uid)
      }
      if (!isId(payload.matchId)) fail('INVALID_MATCH', '대전 식별자가 올바르지 않습니다.')
      const match = await tx.get('matches', payload.matchId)
      if (!match) fail('MATCH_NOT_FOUND', '대전을 찾을 수 없습니다.', 404)
      if (indexOf(match, identity.uid) < 0) fail('MATCH_FORBIDDEN', '이 대전에 참여한 계정만 명령을 보낼 수 있습니다.', 403)
      if (match.phase === 'finished' || await expireMatch(tx, match, timestamp)) return snapshot(tx, player.uid, { knownMatchId: match.id })
      if (hasRequest(match, `${identity.uid}_${payload.requestId}`, requestHash)) return snapshot(tx, player.uid, { knownMatchId: match.id })
      const side = sideOf(match, identity.uid)
      if (action !== 'forfeit' && (!Number.isSafeInteger(payload.revision) || payload.revision !== match.revision)) fail('STALE_REVISION', '대전이 진행됐습니다. 최신 상태를 불러온 뒤 다시 선택해주세요.', 409)
      if (action === 'forfeit') {
        await settlement(tx, match, opposite(side), 'forfeit', timestamp)
        return snapshot(tx, player.uid, { knownMatchId: match.id })
      }
      remember(match, `${identity.uid}_${payload.requestId}`, requestHash)
      if (action === 'select') {
        if (match.phase !== 'select') fail('WRONG_PHASE', '현재는 출전 포켓몬 선택 단계가 아닙니다.', 409)
        if (match.selections[identity.uid]) fail('ALREADY_SUBMITTED', '이미 출전 포켓몬을 확정했습니다.', 409)
        const selection = payload.selection
        const count = getRankedFormat(match.format).battleSize
        if (!Array.isArray(selection) || selection.length !== count || new Set(selection).size !== count || selection.some(index => !Number.isInteger(index) || index < 0 || index > 5)) fail('INVALID_SELECTION', `서로 다른 포켓몬 ${count}마리를 순서대로 선택해주세요.`)
        match.selections[identity.uid] = clone(selection)
        if (match.players.every(entry => match.selections[entry.uid])) {
          const selected = match.players.map(entry => match.selections[entry.uid].map(index => entry.team[index]))
          match.phase = 'battle'
          const state = engine.createRankedBattle({ playerTeam: selected[0], opponentTeam: selected[1], format: match.format, playerName: maskRankedTrainerName(match.players[0].name, match.players[0].isGuest, match.players[0].nickname), opponentName: maskRankedTrainerName(match.players[1].name, match.players[1].isGuest, match.players[1].nickname), playerNickname: match.players[0].nickname, opponentNickname: match.players[1].nickname, playerIsGuest: match.players[0].isGuest === true, opponentIsGuest: match.players[1].isGuest === true, random: seededRandom(seed) })
          if (usageEnabled === true && !match.roomId) await recordRankedPokemonUsage(tx, match, selected, timestamp)
          await afterEngine(tx, match, { state, timeline: [] }, timestamp)
        } else tx.set('matches', match.id, match)
      } else if (action === 'submit') {
        if (match.phase !== 'battle' || match.state.pendingHumanSwitch) fail('WRONG_PHASE', '현재는 기술 선택 단계가 아닙니다.', 409)
        if (match.pendingActions[side]) fail('ALREADY_SUBMITTED', '이미 이번 턴의 행동을 확정했습니다.', 409)
        if (!Array.isArray(payload.actions) || payload.actions.length > 2 || payload.actions.some(action => !action || typeof action !== 'object' || Array.isArray(action))) fail('INVALID_ACTION', '행동을 다시 선택해주세요.')
        const actions = engine.validateRankedAction(match.state, side, payload.actions.map(action => mapAction(action, side)))
        match.pendingActions[side] = actions
        if (match.pendingActions.player && match.pendingActions.opponent) {
          await afterEngine(tx, match, engine.resolveRankedTurn(match.state, match.pendingActions, seededRandom(seed)), timestamp)
        } else tx.set('matches', match.id, match)
      } else if (action === 'replace') {
        if (match.phase !== 'battle' || match.state.pendingHumanSwitch?.sideId !== side) fail('WRONG_PHASE', '현재 교체 포켓몬을 선택할 차례가 아닙니다.', 409)
        if (!Number.isInteger(payload.targetIndex) || payload.targetIndex < 0 || payload.targetIndex >= getRankedFormat(match.format).battleSize) fail('INVALID_REPLACEMENT', '교체할 포켓몬을 다시 선택해주세요.')
        await afterEngine(tx, match, engine.resolveRankedReplacement(match.state, side, payload.targetIndex, seededRandom(seed)), timestamp)
      }
      return snapshot(tx, player.uid, { knownMatchId: match.id })
    })
    if (response?.roomError) fail(response.roomError.code, response.roomError.message, response.roomError.status)
    return response
  }
  return { execute, deleteGuestAccount: identity => eraseGuestRankedData({
    store, guestRegistry: guestIdentities, rooms, settlement, lobbyLock, now,
  }, identity) }
}
