import { createHash, randomUUID, randomBytes } from 'node:crypto'
import { createRankedProfile, getRankedFormat, settleRankedRatings } from '../src/data/rankedRules.js'
import { getRankedVpReward } from '../src/data/rankedRewards.js'
import { maskRankedMatch, maskRankedTrainerName } from '../src/data/rankedPrivacy.js'
import { readPokemonUsage, recordRankedPokemonUsage, reportAiPokemonUsage, validateAiPokemonUsage } from './pokemonUsageService.js'
import { readFactoryLeaderboard, reportFactoryRun, validateFactoryRankingReport } from './battleFactoryRankingService.js'
import { createGuestIdentityRegistry } from './guestIdentity.js'

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
  const selectionTimeout = timeouts.selection ?? SELECT_TIMEOUT
  const turnTimeout = timeouts.turn ?? TURN_TIMEOUT
  const replacementTimeout = timeouts.replacement ?? REPLACEMENT_TIMEOUT
  const playbackGrace = timeouts.playbackGrace ?? 15_000

  async function loadPlayer(tx, identity) {
    let player = await tx.get('players', identity.uid)
    if (!player) player = profileRecord(identity.uid, identity.name)
    player.name = identity.name
    player.isGuest = identity.isGuest === true
    return player
  }
  async function lobbyLock(tx) {
    const lobby = await tx.get('meta', 'lobby') ?? { version: 0 }
    tx.set('meta', 'lobby', { version: lobby.version + 1 })
  }
  async function settlement(tx, match, winner, reason, timestamp) {
    if (match.phase === 'finished') return
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
      id: match.id, format: match.format, phase: match.phase, revision: match.revision,
      timelineRevision: match.timelineRevision,
      createdAt: match.createdAt, deadlineAt: match.deadlineAt, finishedAt: match.finishedAt ?? null,
      you: { name: you.name, rating: you.rating, isGuest: you.isGuest === true }, opponent: { name: opponent.name, rating: opponent.rating, isGuest: opponent.isGuest === true },
      teamPreview: { you: clone(you.team), opponent: opponent.team.map(previewPokemon) },
      selectionSubmitted: Boolean(match.selections[uid]), opponentSelectionSubmitted: Boolean(match.selections[opponent.uid]),
      selectedIndices: clone(match.selections[uid] ?? []),
      actionSubmitted: Boolean(match.pendingActions[side]), opponentActionSubmitted: Boolean(match.pendingActions[opposite(side)]),
      state: match.state ? engine.getRankedBattleView(match.state, side) : null,
      timeline: timeline.length ? engine.getRankedTimelineView(timeline, side) : [],
      result: match.result ? clone(match.result[index]) : null,
    })
  }

  async function snapshot(tx, uid, { knownTimelineRevision, knownMatchId } = {}) {
    const player = await tx.get('players', uid)
    const queue = await tx.get('queue', uid)
    let match = player?.activeMatchId ? await tx.get('matches', player.activeMatchId) : null
    if (match?.phase === 'finished') {
      // Lazy migration for matches settled before active pointers were cleared.
      player.activeMatchId = null
      tx.set('players', uid, player)
      match = null
    }
    if (!match && !player?.activeMatchId && !queue && knownMatchId) {
      const known = await tx.get('matches', knownMatchId)
      // Only a client already playing this match needs the last animation and
      // result. A fresh status request gets the settled profile and lobby.
      if (known?.phase === 'finished') match = known
    }
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
        players: [other, queue].map(entry => ({ uid: entry.uid, name: entry.name, isGuest: entry.isGuest === true, rating: entry.rating, team: entry.team })),
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

  async function execute(identity, payload) {
    if (!identity || !isId(identity.uid)) fail('UNAUTHENTICATED', '로그인이 필요합니다.', 401)
    identity = { uid: identity.uid, name: String(identity.name || '트레이너').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 32), isGuest: identity.isGuest === true }
    const action = payload?.action ?? 'status'
    if (!['guestProfile', 'status', 'fixtures', 'usage', 'reportAiUsage', 'factoryLeaderboard', 'reportFactoryRun', 'join', 'cancel', 'select', 'submit', 'replace', 'forfeit'].includes(action)) fail('UNKNOWN_ACTION', '지원하지 않는 요청입니다.')
    if (action === 'guestProfile') return guestIdentities.create(identity)
    if (identity.isGuest) {
      const profile = await guestIdentities.read(identity)
      identity.name = profile.displayName
    }
    if (action === 'factoryLeaderboard') return store.transaction(tx => readFactoryLeaderboard(tx, identity.uid))
    if (action === 'reportFactoryRun') {
      const report = validateFactoryRankingReport(payload.report)
      const recordedAt = now()
      const entryId = newId()
      return store.transaction(tx => reportFactoryRun(tx, identity, report, recordedAt, entryId))
    }
    if (action === 'fixtures') {
      if (!fixtures) fail('NOT_FOUND', '테스트 팀은 로컬 테스트에서만 제공됩니다.', 404)
      return { teams: clone(fixtures) }
    }
    if (action === 'usage' || action === 'reportAiUsage') {
      if (usageEnabled !== true) fail('USAGE_DISABLED', '포켓몬 사용률 집계는 아직 운영 서버에서 활성화되지 않았습니다.', 503)
      if (action === 'usage') return store.transaction(readPokemonUsage)
      assertRequest(payload)
      const report = validateAiPokemonUsage(payload)
      const reportedAt = now()
      return store.transaction(tx => reportAiPokemonUsage(tx, identity.uid, report, reportedAt))
    }
    const timestamp = now()
    const id = newId()
    const seed = makeSeed()
    let team
    if (action !== 'status') assertRequest(payload)
    if (action === 'join') {
      if (!getRankedFormat(payload.format)) fail('INVALID_FORMAT', '싱글 또는 더블 배틀을 선택해주세요.')
      team = engine.canonicalizeRankedTeam(await resolveTeam(identity, payload.team), { format: payload.format, requireRegisteredTeam: true })
    }
    const requestHash = digest(payload)
    return store.transaction(async tx => {
      if (action === 'status') {
        await sync(tx, identity, timestamp, id)
        if (payload.matchId) {
          if (!isId(payload.matchId)) fail('INVALID_MATCH', '대전 식별자가 올바르지 않습니다.')
          const requested = await tx.get('matches', payload.matchId)
          if (!requested) fail('MATCH_NOT_FOUND', '대전을 찾을 수 없습니다.', 404)
          if (indexOf(requested, identity.uid) < 0) fail('MATCH_FORBIDDEN', '이 대전에 참여한 계정만 조회할 수 있습니다.', 403)
        }
        return snapshot(tx, identity.uid, { knownTimelineRevision: payload.timelineRevision, knownMatchId: payload.matchId })
      }
      let player = await loadPlayer(tx, identity)
      if (hasRequest(player, payload.requestId, requestHash)) return snapshot(tx, identity.uid)
      if (action === 'join') {
        await lobbyLock(tx)
        const current = player.activeMatchId ? await tx.get('matches', player.activeMatchId) : null
        if (current) await expireMatch(tx, current, timestamp)
        if (current && current.phase !== 'finished') fail('ALREADY_IN_MATCH', '진행 중인 대전을 먼저 마쳐주세요.', 409)
        // An expiry may have settled ratings. Never overwrite its fresh profile.
        player = await tx.get('players', identity.uid) ?? player
        const previous = await tx.get('queue', identity.uid)
        if (previous && previous.expiresAt > timestamp) {
          if (previous.format !== payload.format || digest(previous.team) !== digest(team)) fail('ALREADY_QUEUED', '다른 팀으로 검색하려면 현재 검색을 취소해주세요.', 409)
          remember(player, payload.requestId, requestHash)
          tx.set('players', player.uid, player)
          return snapshot(tx, player.uid)
        }
        const queues = await tx.list('queue')
        for (const expired of queues.filter(entry => entry.expiresAt <= timestamp)) tx.delete('queue', expired.uid)
        if (queues.filter(entry => entry.expiresAt > timestamp).length >= MAX_QUEUE) fail('QUEUE_FULL', '매칭 서버가 혼잡합니다. 잠시 후 다시 시도해주세요.', 503)
        const queue = { uid: identity.uid, name: identity.name, isGuest: identity.isGuest === true, ticket: id, format: payload.format, team, queuedAt: timestamp, expiresAt: timestamp + QUEUE_LEASE, rating: player.profiles[payload.format].rating }
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
          const state = engine.createRankedBattle({ playerTeam: selected[0], opponentTeam: selected[1], format: match.format, playerName: maskRankedTrainerName(match.players[0].name, match.players[0].isGuest), opponentName: maskRankedTrainerName(match.players[1].name, match.players[1].isGuest), playerIsGuest: match.players[0].isGuest === true, opponentIsGuest: match.players[1].isGuest === true, random: seededRandom(seed) })
          if (usageEnabled === true) await recordRankedPokemonUsage(tx, match, selected, timestamp)
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
  }
  return { execute }
}
