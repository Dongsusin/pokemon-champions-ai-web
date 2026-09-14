import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import { createRankedProfile } from '../src/data/rankedRules.js'
import { RAID_BOSSES, RAID_DEFAULTS, RAID_ENGINE_VERSION, RAID_RULE_VERSION, RAID_SCHEMA_VERSION } from '../src/data/raidRules.js'
import { sanitizeRaidPresentation } from '../src/data/raidPresentation.js'
import { maskRankedTrainerName } from '../src/data/rankedPrivacy.js'
import { readTrainerNickname } from '../src/data/trainerNickname.js'
import { containsChatProfanity } from './chatModeration.js'
import { createGuestIdentityRegistry } from './guestIdentity.js'
import {
  createRaidRetentionIndex,
  planRaidRetentionCleanup,
  RAID_RETENTION_BATCH_SIZE,
  selectExpiredRaidRetentionIndexes,
} from './raidRetention.js'

// Raid records deliberately live in their own collections.  A three-person
// cooperative run is not a ranked match with a larger player array: it has
// different ownership, command and settlement semantics.
const MAX_ROOMS = 10
const ROOM_WAIT_MS = 10 * 60_000
const ROOM_FULL_MS = 60_000
const ROOM_CODE_ATTEMPTS = 5
const ROOM_CODE_ATTEMPT_WINDOW_MS = 60_000
const COMMAND_MS = (RAID_DEFAULTS.commandSeconds ?? 45) * 1000
const RESOLUTION_LEASE_MS = 20_000
// A normal status fetch is intentionally read-only.  Clients renew this
// lightweight presence lease with the explicit raidHeartbeat mutation instead.
// It gives a brief network-recovery window without treating one missed poll as
// a voluntary exit.
const HEARTBEAT_GRACE_MS = 75_000
const SUSPEND_MS = 5 * 60_000
const REQUEST_HISTORY = 64
const MAX_PUBLIC_EVENTS = 128
const MAX_EVENT_CHUNKS = 24

const clone = value => structuredClone(value)
const isId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value)
const isCaptureId = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,96}$/.test(value)
const isPlain = value => value && typeof value === 'object' && !Array.isArray(value)
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const rewardKey = (...parts) => `rr_${digest(parts).slice(0, 60)}`
const firstClearKey = (...parts) => `rf_${digest(parts).slice(0, 60)}`
const joinAttemptKey = (roomId, uid) => `rj_${digest([roomId, uid]).slice(0, 60)}`
const publicName = identity => maskRankedTrainerName(identity.name, identity.isGuest === true, identity.nickname)

export class RaidError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status }
}
const fail = (code, message, status) => { throw new RaidError(code, message, status) }

function assertRequest(payload) {
  if (!isId(payload?.requestId) || payload.requestId.length < 8) fail('INVALID_REQUEST_ID', '요청 식별자가 올바르지 않습니다.')
}

function sanitizeTitle(value) {
  if (typeof value !== 'string') return ''
  const title = value.normalize('NFC').replace(/[\p{Cc}\p{Cs}\p{Bidi_Control}]/gu, '').trim()
  if (!title || [...title].length > 32 || containsChatProfanity(title)) fail('INVALID_ROOM_TITLE', '방 이름은 비속어 없이 1~32자로 입력해주세요.')
  return title
}

function normalizeNpcRoles(value) {
  if (value === undefined) return null
  if (!Array.isArray(value) || value.length > 2 || value.some(role => !['attack', 'support'].includes(role))) {
    fail('INVALID_NPC_ROLES', '지원 NPC 역할을 다시 선택해주세요.')
  }
  return [...value]
}

function defaultNpcRoles(humanCount) {
  if (humanCount <= 1) return ['attack', 'support']
  if (humanCount === 2) return ['support']
  return []
}

function roomMemberCount(room) {
  if (Number.isSafeInteger(room?.memberCount) && room.memberCount >= 0) return room.memberCount
  return room?.members?.filter(member => !member.isNpc && !member.withdrawn).length ?? 0
}

function roomNpcRoles(room) {
  const humanCount = roomMemberCount(room)
  const missing = Math.max(0, 3 - humanCount)
  const configured = Array.isArray(room?.npcRoles) ? room.npcRoles.slice(0, missing) : []
  return [...configured, ...defaultNpcRoles(humanCount).slice(configured.length, missing)]
}

function normalizeIdentity(input) {
  if (!input || !isId(input.uid)) fail('UNAUTHENTICATED', '로그인이 필요합니다.', 401)
  const isGuest = input.isGuest === true
  const name = String(input.name || '트레이너').replace(/[\p{Cc}\p{Cs}\p{Bidi_Control}]/gu, '').slice(0, 32) || '트레이너'
  return { uid: input.uid, name, isGuest, nickname: isGuest ? '' : readTrainerNickname(input.nickname) }
}

function rankedPlayerRecord(identity) {
  return {
    uid: identity.uid,
    name: identity.name,
    nickname: identity.nickname,
    isGuest: identity.isGuest === true,
    profiles: { single: createRankedProfile('single'), double: createRankedProfile('double') },
    vpRewardTotal: 0,
    activeMatchId: null,
    queueTicket: null,
    requests: [],
    activeRaidId: null,
  }
}

function updateRankedIdentity(player, identity) {
  player.name = identity.name
  player.nickname = identity.nickname
  player.isGuest = identity.isGuest === true
  return player
}

function newPointer(identity) {
  return {
    uid: identity.uid,
    name: identity.name,
    nickname: identity.nickname,
    isGuest: identity.isGuest === true,
    activeRoomId: null,
    activeRaidId: null,
    lastRaidId: null,
    vpRewardTotal: 0,
    requests: [],
  }
}

function updatePointerIdentity(pointer, identity) {
  pointer.name = identity.name
  pointer.nickname = identity.nickname
  pointer.isGuest = identity.isGuest === true
  return pointer
}

function requestKnown(record, requestId, hash) {
  const previous = record?.requests?.find(entry => entry.id === requestId)
  if (previous && previous.hash !== hash) fail('REQUEST_ID_REUSED', '같은 요청 식별자로 다른 명령을 보낼 수 없습니다.', 409)
  return previous ?? null
}

function rememberRequest(record, requestId, hash, { claim = null } = {}) {
  record.requests ??= []
  record.requests.push({
    id: requestId,
    hash,
    ...(claim?.raidId && claim?.resolutionId ? { resolution: { raidId: claim.raidId, resolutionId: claim.resolutionId } } : {}),
  })
  record.requests = record.requests.slice(-REQUEST_HISTORY)
}

function previewPokemon(pokemon, { includeCaptureId = false } = {}) {
  if (!isPlain(pokemon)) return null
  const result = {}
  // captureId, EVs, IVs and loadout internals never leave the room record.
  for (const key of ['speciesId', 'dexSpeciesId', 'slug', 'name', 'formName', 'types', 'spriteFront', 'spriteBack', 'isShiny', 'level']) {
    if (pokemon[key] !== undefined) result[key] = clone(pokemon[key])
  }
  if (includeCaptureId && pokemon.captureId !== undefined) result.captureId = pokemon.captureId
  return result
}

function roomDeadline(room) {
  return Math.min(room.createdAt + ROOM_WAIT_MS, room.firstFullAt === null ? Infinity : room.firstFullAt + ROOM_FULL_MS)
}

function expiryCursor(value) {
  if (!isPlain(value) || !Number.isSafeInteger(value.expiresAt) || value.expiresAt < 0 || !isId(value.raidId)) return null
  return { expiresAt: value.expiresAt, raidId: value.raidId }
}

function isAfterExpiryCursor(index, cursor) {
  if (!cursor || !Number.isSafeInteger(index?.expiresAt) || !isId(index?.raidId)) return !cursor
  return index.expiresAt > cursor.expiresAt
    || (index.expiresAt === cursor.expiresAt && index.raidId.localeCompare(cursor.raidId, 'en') > 0)
}

// A small server-side waiting-room projection.  Browsing must not deserialize
// full ready Pokémon snapshots from every active room on each poll.
function raidRoomIndex(room) {
  return {
    id: room.id,
    bossId: room.bossId,
    title: room.title,
    visibility: room.visibility,
    hostUid: room.hostUid,
    hostName: room.hostName,
    hostNickname: room.hostNickname,
    hostIsGuest: room.hostIsGuest === true,
    status: room.status,
    roomRevision: room.roomRevision,
    memberCount: roomMemberCount(room),
    createdAt: room.createdAt,
    firstFullAt: room.firstFullAt,
    npcRoles: clone(room.npcRoles ?? null),
    codeHash: room.codeHash ?? null,
    codeSalt: room.codeSalt ?? null,
  }
}

// Active runs keep a compact, server-only header beside the authoritative
// battle snapshot.  The header is deliberately enough to authorize a polling
// player and report command/presence changes, but never contains a Pokémon,
// move, seed, or battle-state payload.  This lets a 1.5 second status poll
// avoid reading the much larger raidRuns document when its public revision is
// unchanged.
function raidRunHead(run) {
  if (!run?.id) return null
  const commands = isPlain(run.commands) ? run.commands : {}
  const versions = isPlain(run.commandVersions) ? run.commandVersions : {}
  return {
    id: run.id,
    roomId: run.roomId,
    bossId: run.bossId,
    schemaVersion: run.schemaVersion,
    ruleVersion: run.ruleVersion,
    engineVersion: run.engineVersion,
    battleSchemaVersion: run.battle?.raid?.schemaVersion,
    battleRuleVersion: run.battle?.raid?.ruleVersion,
    battleEngineVersion: run.battle?.raid?.engineVersion,
    phase: run.phase,
    phaseEpoch: run.phaseEpoch,
    turnNumber: run.turnNumber,
    lifecycle: run.lifecycle,
    deadlineAt: run.deadlineAt ?? null,
    suspendedAt: run.suspendedAt ?? null,
    decisionToken: typeof run.battle?.raid?.decisionToken === 'string' ? run.battle.raid.decisionToken : run.decisionToken ?? null,
    revision: Number.isSafeInteger(run.revision) ? run.revision : 0,
    eventCursor: Number.isSafeInteger(run.eventCursor) ? run.eventCursor : 0,
    submittedOwnerIds: Object.keys(commands),
    commandVersions: Object.fromEntries(Object.entries(versions)
      .filter(([ownerId, version]) => isId(ownerId) && Number.isSafeInteger(version) && version >= 0)),
    participants: (Array.isArray(run.participants) ? run.participants : []).map(member => ({
      ownerId: member.ownerId,
      displayName: member.displayName,
      isNpc: member.isNpc === true,
      slotId: member.slotId,
      withdrawn: member.withdrawn === true,
      lastSeenAt: Number.isSafeInteger(member.lastSeenAt) ? member.lastSeenAt : null,
    })),
    // Terminal results are small and let a just-finished run show its result
    // without reloading its complete battle state on every result-screen poll.
    result: run.result ? clone(run.result) : null,
  }
}

function passwordHash(password, salt) {
  return scryptSync(password, salt, 32).toString('hex')
}

function verifyPassword(room, supplied) {
  if (!room.codeHash) return true
  if (typeof supplied !== 'string' || !/^[A-HJ-NP-Z2-9]{8}$/.test(supplied)) return false
  const expected = Buffer.from(room.codeHash, 'hex')
  const actual = Buffer.from(passwordHash(supplied, room.codeSalt), 'hex')
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

function publicMember(member, viewerUid, hostUid) {
  return {
    name: member.isNpc ? member.name : maskRankedTrainerName(member.name, member.isGuest === true, member.nickname),
    slotId: member.slotId,
    ready: member.ready === true,
    isAi: member.isNpc === true,
    withdrawn: member.withdrawn === true,
    joinedAt: member.joinedAt,
    selectedPokemon: previewPokemon(member.pokemon, { includeCaptureId: member.uid === viewerUid }),
    ...(member.uid === viewerUid ? { isOwn: true } : {}),
    ...(member.uid === hostUid ? { isHost: true } : {}),
  }
}

function publicRoom(room, viewerUid) {
  if (!room) return null
  const npcRoles = roomNpcRoles(room)
  const members = Array.isArray(room.members) ? room.members : []
  const occupiedSlots = new Set(members.filter(member => !member.withdrawn).map(member => member.slotId))
  const npcSlots = [0, 1, 2].filter(slotId => !occupiedSlots.has(slotId))
  return {
    id: room.id,
    bossId: room.bossId,
    title: room.title,
    visibility: room.visibility,
    locked: Boolean(room.codeHash),
    hostName: maskRankedTrainerName(room.hostName, room.hostIsGuest === true, room.hostNickname),
    isHost: room.hostUid === viewerUid,
    status: room.status,
    roomRevision: room.roomRevision,
    memberCount: roomMemberCount(room),
    capacity: 3,
    createdAt: room.createdAt,
    startDeadlineAt: room.status === 'waiting' ? roomDeadline(room) : null,
    activeRaidId: room.activeRaidId ?? null,
    npcRoles,
    npcSlots: npcRoles.map((role, index) => ({
      slotId: npcSlots[index] ?? index,
      role,
      name: role === 'support' ? '지원 AI' : '공격 AI',
      isAi: true,
    })),
    members: members.map(member => publicMember(member, viewerUid, room.hostUid)),
  }
}

function catalogFromEngine(engine) {
  const candidate = typeof engine?.getRaidCatalog === 'function' ? engine.getRaidCatalog() : RAID_BOSSES
  return (Array.isArray(candidate) ? candidate : RAID_BOSSES).map(boss => ({
    id: boss.id,
    name: boss.name,
    subtitle: boss.subtitle,
    speciesId: boss.speciesId,
  }))
}

function assertBoss(engine, bossId) {
  if (!isId(bossId) || !catalogFromEngine(engine).some(boss => boss.id === bossId)) fail('INVALID_BOSS', '선택할 수 없는 보스입니다.')
}

function publicEvents(view) {
  const events = Array.isArray(view?.raid?.events) ? view.raid.events
    : Array.isArray(view?.events) ? view.events : Array.isArray(view?.timeline) ? view.timeline : []
  // Engine events are already designed for presentation, but keep the network
  // boundary defensive.  Do not accidentally expose a future internal event
  // payload merely because it was appended to the battle snapshot.
  return events.slice(-MAX_PUBLIC_EVENTS).map(event => {
    if (!isPlain(event)) return null
    const result = {}
    for (const key of ['id', 'kind', 'type', 'message', 'turn', 'phase', 'cuePhase', 'actorId', 'targetActorId', 'targetIds', 'targetSideId', 'actorSlot', 'targetSlot', 'actorName', 'actorSpeciesId', 'actorOriginalSpeciesId', 'targetName', 'targetSpeciesId', 'moveId', 'moveName', 'moveType', 'moveCategory', 'movePower', 'moveTarget', 'movePriority', 'moveMultihit', 'moveDrain', 'moveRecoil', 'moveStatus', 'moveSelfdestruct', 'moveFlags', 'moveDescription', 'moveGeneration', 'animationType', 'animationVariant', 'animationVariantKey', 'animationReferenceKey', 'gimmickId', 'mechanicId', 'mechanicLabel', 'mechanicType', 'mechanicMode', 'actorPreviousName', 'spriteBeforeFront', 'spriteBeforeBack', 'spriteBeforeFrontFallback', 'spriteBeforeBackFallback', 'spriteAfterFront', 'spriteAfterBack', 'spriteAfterFrontFallback', 'spriteAfterBackFallback', 'formSourceName', 'result', 'damage', 'critical', 'effectiveness', 'hitIndex', 'hitCount', 'hp', 'maxHp', 'form', 'outcome', 'requested', 'applied', 'rootId', 'sideId']) {
      if (event[key] !== undefined) result[key] = clone(event[key])
    }
    if (Array.isArray(event.changes)) result.changes = event.changes.slice(0, 12).map(change => {
      if (!isPlain(change)) return null
      return Object.fromEntries(['actorId', 'sideId', 'beforeHp', 'hp', 'maxHp', 'form'].filter(key => change[key] !== undefined).map(key => [key, clone(change[key])]))
    }).filter(Boolean)
    if (event.presentation) result.presentation = sanitizeRaidPresentation(event.presentation)
    return result
  }).filter(Boolean)
}

// The engine returns an allow-listed projection.  These aliases keep the HTTP
// contract stable for the client while avoiding a second, less-safe renderer of
// the raw engine snapshot.
function clientBattleView(view) {
  if (!view) return null
  const safe = clone(view)
  const allies = Array.isArray(safe.player?.team) ? safe.player.team : []
  const enemies = Array.isArray(safe.opponent?.team) ? safe.opponent.team : []
  const events = publicEvents(safe)
  if (safe.raid) safe.raid.events = events
  return {
    ...safe,
    allies,
    enemies,
    events,
    legalCommands: {
      actorId: safe.ownActorId ?? null,
      moves: safe.moves ?? [],
      mechanics: safe.mechanics ?? [],
    },
  }
}

function ownActorId(run, ownerId) {
  return run.battle?.player?.team?.find(entry => entry.raidOwnerId === ownerId)?.battleId ?? null
}

function winnerFromOutcome(outcome) {
  return outcome === 'won' ? 'win' : outcome === 'lost' ? 'loss' : null
}

function publicResult(result, ownerId, run = null) {
  if (!result) return null
  const own = result.participants?.find(entry => entry.ownerId === ownerId) ?? null
  return {
    // Result-only recovery needs a stable identifier for the close action.
    // Older records did not repeat it inside `result`, so safely fall back to
    // the enclosing current-version run/header when available.
    raidId: isId(result.raidId) ? result.raidId : (isId(run?.id) ? run.id : null),
    bossId: isId(result.bossId) ? result.bossId : (isId(run?.bossId) ? run.bossId : null),
    humanCount: Math.min(3, result.participants?.length ?? 0),
    npcCount: Math.max(0, 3 - (result.participants?.length ?? 0)),
    outcome: own?.outcome ?? (result.outcome === 'won' ? 'loss' : result.outcome),
    raidOutcome: result.outcome,
    finishedAt: result.finishedAt,
    rewardVp: Number.isSafeInteger(own?.rewardVp) ? own.rewardVp : 0,
    firstClearVp: Number.isSafeInteger(own?.firstClearVp) ? own.firstClearVp : 0,
  }
}

function hasSupportedRaidVersions(record) {
  return record?.schemaVersion === RAID_SCHEMA_VERSION
    && record?.ruleVersion === RAID_RULE_VERSION
    && record?.engineVersion === RAID_ENGINE_VERSION
}

function assertSupportedRaidHead(head) {
  if (!head) return
  const nested = {
    schemaVersion: head.battleSchemaVersion,
    ruleVersion: head.battleRuleVersion,
    engineVersion: head.battleEngineVersion,
  }
  if (!hasSupportedRaidVersions(head) || !hasSupportedRaidVersions(nested)) {
    fail('RAID_VERSION_UNSUPPORTED', '이 보스전 기록의 버전을 지원하지 않습니다. 기록은 보존됩니다.', 409)
  }
}

function assertSupportedRaidRun(run) {
  if (!run) return
  if (!hasSupportedRaidVersions(run)) {
    fail('RAID_VERSION_UNSUPPORTED', '이 보스전 기록의 버전을 지원하지 않습니다. 기록은 보존됩니다.', 409)
  }
  // The outer record and the engine snapshot are versioned independently.
  // Do not let a newer nested battle pass through a withdrawal/settlement path
  // just because the wrapper document still has an older schema marker.
  if (!hasSupportedRaidVersions(run.battle?.raid)) {
    fail('RAID_VERSION_UNSUPPORTED', '이 보스전 기록의 버전을 지원하지 않습니다. 기록은 보존됩니다.', 409)
  }
}

function optionalInteger(value) {
  if (value === undefined || value === null || value === '') return null
  if (!Number.isSafeInteger(Number(value))) return null
  return Number(value)
}

function expectedRoomRevision(payload) {
  const raw = payload?.roomRevision ?? payload?.expectedRoomRevision ?? payload?.expectedRevision
  if (raw === undefined || raw === null || raw === '') return null
  const revision = optionalInteger(raw)
  if (revision === null || revision < 1) fail('INVALID_ROOM_REVISION', '방 상태 버전이 올바르지 않습니다.')
  return revision
}

function assertRoomRevision(room, payload, { required = false } = {}) {
  const expected = expectedRoomRevision(payload)
  if (required && expected === null) fail('ROOM_REVISION_REQUIRED', '최신 방 상태를 불러온 뒤 다시 시도해주세요.', 409)
  if (expected !== null && expected !== room.roomRevision) {
    fail('STALE_ROOM', '방 정보가 변경되었습니다. 최신 상태를 불러와주세요.', 409)
  }
}

/**
 * Server-owned lobby and run coordinator.  Every mutation enters the configured
 * transaction store; the pure battle engine only receives server-owned stored
 * state and a deterministic seed.
 */
export function createRaidService({
  store,
  engine,
  resolvePokemon = async (_identity, pokemon) => pokemon,
  now = Date.now,
  newId = randomUUID,
  makeSeed = () => randomBytes(4).readUInt32LE(),
  makeRoomCode = () => {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    return [...randomBytes(8)].map(byte => alphabet[byte % alphabet.length]).join('')
  },
  guestRegistry = null,
  timeouts = {},
} = {}) {
  if (!store?.transaction) throw new TypeError('Raid store is required')
  const guests = guestRegistry ?? createGuestIdentityRegistry({ store, now })
  const commandMs = Number.isSafeInteger(timeouts.command) && timeouts.command >= 5_000 ? timeouts.command : COMMAND_MS
  // Match the existing ranked battle's bounded allowance for server-resolved
  // animation. Clients cannot extend it by replaying or acknowledging frames.
  const playbackGraceMs = Number.isSafeInteger(timeouts.playbackGrace) && timeouts.playbackGrace >= 0
    ? Math.min(15_000, timeouts.playbackGrace) : 15_000
  const resolutionLeaseMs = Number.isSafeInteger(timeouts.resolutionLease) && timeouts.resolutionLease >= 1_000 ? timeouts.resolutionLease : RESOLUTION_LEASE_MS
  const heartbeatGraceMs = Number.isSafeInteger(timeouts.heartbeatGrace) && timeouts.heartbeatGrace >= 5_000 ? timeouts.heartbeatGrace : HEARTBEAT_GRACE_MS
  const suspendMs = Number.isSafeInteger(timeouts.suspend) && timeouts.suspend >= 5_000 ? timeouts.suspend : SUSPEND_MS

  function requireEngine(method) {
    if (typeof engine?.[method] !== 'function') throw new Error(`Raid battle engine does not provide ${method}`)
    return engine[method]
  }

  async function transaction(identity, work) {
    return store.transaction(async tx => {
      if (identity.isGuest) await guests.read(identity, tx)
      return work(tx)
    })
  }

  async function loadPointer(tx, identity) {
    let pointer = await tx.get('raidPlayers', identity.uid)
    if (!pointer) pointer = newPointer(identity)
    return updatePointerIdentity(pointer, identity)
  }

  async function loadRankedPlayer(tx, identity) {
    let player = await tx.get('players', identity.uid)
    if (!player) player = rankedPlayerRecord(identity)
    return updateRankedIdentity(player, identity)
  }

  async function lobbyLock(tx) {
    const value = await tx.get('meta', 'raidLobby') ?? { version: 0 }
    tx.set('meta', 'raidLobby', { version: Number.isSafeInteger(value.version) ? value.version + 1 : 1 })
  }

  function saveRoomIndex(tx, room) {
    if (!room?.id) return
    if (room.status !== 'waiting') tx.delete('raidRoomIndex', room.id)
    else tx.set('raidRoomIndex', room.id, raidRoomIndex(room))
  }

  function saveRun(tx, run) {
    if (!run?.id) return
    tx.set('raidRuns', run.id, run)
    const head = raidRunHead(run)
    if (head) tx.set('raidRunHeads', run.id, head)
    // Terminal replays are independently short-lived.  The small index is
    // written with the terminal snapshot, while receipts and reward totals
    // deliberately stay outside this cleanup path.
    const expiryIndex = createRaidRetentionIndex(run)
    if (expiryIndex) tx.set('raidExpiryIndex', run.id, expiryIndex)
  }

  async function loadRun(tx, raidId) {
    if (!isId(raidId)) fail('INVALID_RAID', '보스전 식별자가 올바르지 않습니다.')
    const run = await tx.get('raidRuns', raidId)
    assertSupportedRaidRun(run)
    return run
  }

  async function loadRunHead(tx, raidId) {
    if (!isId(raidId)) fail('INVALID_RAID', '보스전 식별자가 올바르지 않습니다.')
    const head = await tx.get('raidRunHeads', raidId)
    assertSupportedRaidHead(head)
    return head
  }

  async function releaseMembership(tx, uid, { roomId = null, raidId = null, resultId = null } = {}) {
    const pointer = await tx.get('raidPlayers', uid)
    if (pointer) {
      if (!roomId || pointer.activeRoomId === roomId) pointer.activeRoomId = null
      if (!raidId || pointer.activeRaidId === raidId) pointer.activeRaidId = null
      if (resultId) pointer.lastRaidId = resultId
      tx.set('raidPlayers', uid, pointer)
    }
    const player = await tx.get('players', uid)
    if (player && (!raidId || player.activeRaidId === raidId)) {
      player.activeRaidId = null
      tx.set('players', uid, player)
    }
  }

  async function clearStalePointer(tx, pointer) {
    let changed = false
    if (pointer.activeRoomId && !await tx.get('raidRooms', pointer.activeRoomId)) { pointer.activeRoomId = null; changed = true }
    if (pointer.activeRaidId) {
      const run = await loadRun(tx, pointer.activeRaidId)
      if (!run || ['finished', 'abandoned'].includes(run.lifecycle)) { pointer.activeRaidId = null; changed = true }
    }
    if (changed) tx.set('raidPlayers', pointer.uid, pointer)
    return pointer
  }

  async function assertRaidAvailable(tx, pointer, player, timestamp) {
    await clearStalePointer(tx, pointer)
    if (pointer.activeRoomId || pointer.activeRaidId) fail('ALREADY_IN_RAID', '참가 중인 보스전을 먼저 나가거나 끝내주세요.', 409)
    const queue = await tx.get('queue', player.uid)
    if (queue?.expiresAt > timestamp) fail('ALREADY_QUEUED', '레이팅 상대 검색을 먼저 취소해주세요.', 409)
    if (queue) { tx.delete('queue', player.uid); player.queueTicket = null }
    if (player.activeRoomId && await tx.get('battleRooms', player.activeRoomId)) fail('ALREADY_IN_ROOM', '대전방 참가를 먼저 끝내주세요.', 409)
    if (player.activeRoomId) player.activeRoomId = null
    const match = player.activeMatchId ? await tx.get('matches', player.activeMatchId) : null
    if (match?.phase && match.phase !== 'finished') fail('ALREADY_IN_MATCH', '진행 중인 대전을 먼저 끝내주세요.', 409)
    if (player.activeMatchId && (!match || match.phase === 'finished')) player.activeMatchId = null
  }

  async function cleanExpiredRooms(tx, timestamp) {
    const indexes = await tx.list('raidRoomIndex')
    for (const index of indexes) {
      if (index.status !== 'waiting' || roomDeadline(index) > timestamp) continue
      const room = await tx.get('raidRooms', index.id)
      if (!room) {
        tx.delete('raidRoomIndex', index.id)
        continue
      }
      if (room.status !== 'waiting' || roomDeadline(room) > timestamp) {
        saveRoomIndex(tx, room)
        continue
      }
      tx.delete('raidRooms', room.id)
      tx.delete('raidRoomIndex', room.id)
      for (const member of room.members ?? []) {
        if (!member.isNpc) await releaseMembership(tx, member.uid, { roomId: room.id })
      }
    }
  }

  async function cleanExpiredRaidHistory(tx, timestamp) {
    // Only the compact expiry index is listed.  Each invocation follows at
    // most five entries with direct run reads; active battles never appear in
    // the sweep and ordinary status GETs never call this function.
    const indexes = await tx.list('raidExpiryIndex')
    const storedCursor = await tx.get('meta', 'raidExpiryCursor')
    const cursor = expiryCursor(storedCursor)
    const afterCursor = cursor ? indexes.filter(index => isAfterExpiryCursor(index, cursor)) : indexes
    const candidates = selectExpiredRaidRetentionIndexes(afterCursor, timestamp, { limit: RAID_RETENTION_BATCH_SIZE })

    // An unsupported or malformed full run must remain byte-for-byte
    // preserved.  Advancing past its *current-version index* keeps one bad
    // historical record from starving later, safe expirations.  When a pass
    // reaches the end, clear only the separate cursor and start a later pass
    // from the oldest record again.
    if (!candidates.length) {
      if (cursor) tx.delete('meta', 'raidExpiryCursor')
      return
    }

    for (const index of candidates) {
      const run = await tx.get('raidRuns', index.raidId)
      const plan = planRaidRetentionCleanup(index, run, timestamp)
      if (!plan) continue
      for (const document of plan.deleteDocuments) tx.delete(document.collection, document.id)
      for (const ownerId of plan.ownerIds) {
        const pointer = await tx.get('raidPlayers', ownerId)
        // A player may already have completed another raid.  The old cleanup
        // is permitted to dismiss only the matching result pointer.
        if (pointer?.lastRaidId === plan.raidId) {
          pointer.lastRaidId = null
          tx.set('raidPlayers', pointer.uid, pointer)
        }
      }
    }
    const last = candidates[candidates.length - 1]
    tx.set('meta', 'raidExpiryCursor', { expiresAt: last.expiresAt, raidId: last.raidId })
  }

  function decisionToken(run) {
    const fromBattle = run.battle?.raid?.decisionToken
    return typeof fromBattle === 'string' && fromBattle.length <= 128 ? fromBattle : run.decisionToken
  }

  function nextDecisionToken(run) {
    return `r${run.revision + 1}_p${run.phase}_e${run.phaseEpoch}_t${run.turnNumber}`
  }

  function participantList(room) {
    return room.members.filter(member => !member.withdrawn).map(member => ({
      ownerId: member.uid,
      displayName: maskRankedTrainerName(member.name, member.isGuest === true, member.nickname),
      isNpc: false,
      pokemon: clone(member.pokemon),
      slotId: member.slotId,
      withdrawn: false,
    }))
  }

  function eventSequence(battle) {
    return Number.isSafeInteger(battle?.raid?.eventSequence) && battle.raid.eventSequence >= 0
      ? battle.raid.eventSequence : 0
  }

  function eventNumber(event) {
    const match = typeof event?.id === 'string' ? /:(\d+)$/.exec(event.id) : null
    return match ? Number(match[1]) : null
  }

  function eventDocumentId(raidId, cursorStart, cursorEnd) {
    return `re_${digest([raidId, cursorStart, cursorEnd]).slice(0, 60)}`
  }

  async function persistEvents(tx, run, battle, previousCursor) {
    const cursorEnd = eventSequence(battle)
    const events = publicEvents({ raid: { events: battle?.raid?.events ?? [] } })
      .filter(event => (eventNumber(event) ?? 0) > previousCursor)
    run.eventCursor = cursorEnd
    if (!events.length || cursorEnd <= previousCursor) return
    const id = eventDocumentId(run.id, previousCursor + 1, cursorEnd)
    tx.set('raidEvents', id, {
      id,
      raidId: run.id,
      cursorStart: previousCursor + 1,
      cursorEnd,
      revision: run.revision,
      events,
      createdAt: run.updatedAt,
    })
    const chunks = [...(Array.isArray(run.eventChunks) ? run.eventChunks : []), {
      id,
      cursorStart: previousCursor + 1,
      cursorEnd,
    }]
    const retained = chunks.slice(-MAX_EVENT_CHUNKS)
    const retainedIds = new Set(retained.map(chunk => chunk?.id))
    // Do not leave unbounded event documents behind after the run no longer
    // references them.  The exact document-id check prevents a malformed
    // retained snapshot from turning an overflow cleanup into an unrelated
    // document delete.
    for (const stale of chunks.slice(0, Math.max(0, chunks.length - MAX_EVENT_CHUNKS))) {
      const isKnownChunk = stale?.id === eventDocumentId(run.id, stale?.cursorStart, stale?.cursorEnd)
      if (isKnownChunk && !retainedIds.has(stale.id)) tx.delete('raidEvents', stale.id)
    }
    run.eventChunks = retained
  }

  async function eventsSince(tx, run, requestedCursor, fallbackView) {
    const cursor = optionalInteger(requestedCursor)
    if (cursor !== null && cursor >= run.eventCursor) return []
    const chunks = Array.isArray(run.eventChunks) ? run.eventChunks.filter(chunk => chunk?.cursorEnd > (cursor ?? -1)) : []
    if (!chunks.length) return publicEvents(fallbackView)
    const rows = await Promise.all(chunks.map(chunk => tx.get('raidEvents', chunk.id)))
    const events = rows.flatMap(row => Array.isArray(row?.events) ? row.events : [])
      .filter(event => (eventNumber(event) ?? 0) > (cursor ?? -1))
    return publicEvents({ events })
  }

  function activeHumanParticipants(run) {
    return run.participants.filter(member => !member.isNpc && !member.withdrawn)
  }

  function isParticipantPresent(participant, timestamp) {
    return Number.isSafeInteger(participant?.lastSeenAt) && timestamp - participant.lastSeenAt <= heartbeatGraceMs
  }

  function publicRunHead(head, uid, timestamp) {
    if (!head) return null
    const own = head.participants?.find(member => member.ownerId === uid && !member.isNpc)
    if (!own) fail('RAID_FORBIDDEN', '이 보스전 참가자만 상태를 볼 수 있습니다.', 403)
    const submitted = new Set(Array.isArray(head.submittedOwnerIds) ? head.submittedOwnerIds : [])
    return {
      id: head.id,
      roomId: head.roomId,
      bossId: head.bossId,
      stage: head.phase,
      phase: head.phase,
      lifecycle: head.lifecycle,
      turnNumber: head.turnNumber,
      deadlineAt: head.deadlineAt,
      decisionToken: head.decisionToken,
      revision: head.revision,
      eventCursor: head.eventCursor,
      // The client merges an unchanged header into its last full battle
      // projection.  It must not treat this as a replacement battle payload.
      unchanged: true,
      pendingSubmitted: submitted.has(uid),
      submitted: submitted.has(uid),
      actionSubmitted: submitted.has(uid),
      ownCommandVersion: Number.isSafeInteger(head.commandVersions?.[uid]) ? head.commandVersions[uid] : 0,
      participants: (head.participants ?? []).map(member => ({
        name: member.displayName,
        slotId: member.slotId,
        isAi: member.isNpc === true || member.withdrawn === true,
        aiControlled: member.isNpc === true || member.withdrawn === true || !isParticipantPresent(member, timestamp),
        submitted: submitted.has(member.ownerId),
        withdrawn: member.withdrawn === true,
        ...(member.ownerId === uid ? { isOwn: true } : {}),
      })),
      result: publicResult(head.result, uid, head),
    }
  }

  // Presence only changes from explicit POSTs.  GET /status remains a true
  // cache-safe projection and cannot secretly resolve a battle or alter a
  // player's disconnect state.
  async function applyPresence(tx, run, uid, timestamp) {
    if (!run || ['finished', 'abandoned'].includes(run.lifecycle)) return { expired: false, resumed: false }
    const humans = activeHumanParticipants(run)
    // A resolver has already locked this turn.  Presence cannot replace it
    // with a suspension in the small window before the deterministic result is
    // committed.
    if (run.lifecycle === 'resolving') {
      const participant = humans.find(member => member.ownerId === uid)
      if (participant) participant.lastSeenAt = timestamp
      return { expired: false, resumed: false }
    }
    const allAbsent = humans.length > 0 && humans.every(member => !isParticipantPresent(member, timestamp))
    let changed = false
    let expired = false
    if (allAbsent) {
      const absentSince = Math.max(...humans.map(member => (Number.isSafeInteger(member.lastSeenAt) ? member.lastSeenAt : timestamp) + heartbeatGraceMs))
      if (run.lifecycle !== 'suspended') {
        run.suspendedAt = absentSince
        run.suspendedFromLifecycle = run.lifecycle
      }
      const suspendedAt = Number.isSafeInteger(run.suspendedAt) ? run.suspendedAt : absentSince
      if (timestamp - suspendedAt >= suspendMs) {
        run.lifecycle = 'abandoned'
        run.deadlineAt = null
        run.updatedAt = timestamp
        run.revision += 1
        await settleRun(tx, run, 'lost', timestamp)
        expired = true
      } else if (run.lifecycle !== 'suspended') {
        run.lifecycle = 'suspended'
        run.deadlineAt = null
        run.updatedAt = timestamp
        run.revision += 1
        changed = true
      }
    }
    const participant = humans.find(member => member.ownerId === uid)
    if (!participant || expired) {
      if (changed && !expired) saveRun(tx, run)
      return { expired, resumed: false }
    }
    participant.lastSeenAt = timestamp
    if (run.lifecycle === 'suspended') {
      const resumeLifecycle = run.suspendedFromLifecycle === 'intermission' ? 'intermission' : 'input'
      run.lifecycle = resumeLifecycle
      run.suspendedAt = null
      run.suspendedFromLifecycle = null
      run.deadlineAt = resumeLifecycle === 'input' ? timestamp + commandMs : null
      run.updatedAt = timestamp
      run.revision += 1
      if (resumeLifecycle === 'input') run.decisionToken = nextDecisionToken(run)
      changed = true
      return { expired: false, resumed: true }
    }
    if (changed) saveRun(tx, run)
    return { expired: false, resumed: false }
  }

  async function createRoom(tx, identity, payload, timestamp, id, salt, inviteCodes) {
    assertBoss(engine, payload.bossId)
    const title = sanitizeTitle(payload.title ?? `${catalogFromEngine(engine).find(boss => boss.id === payload.bossId)?.name ?? '보스'} 레이드`)
    const visibility = payload.visibility === 'private' ? 'private' : payload.visibility === undefined || payload.visibility === 'public' ? 'public' : null
    if (!visibility) fail('INVALID_VISIBILITY', '공개 또는 비공개 방을 선택해주세요.')
    // Raid invite codes are generated by the server.  A caller-provided code
    // is never trusted or stored, even if it happens to match the format.
    const pointer = await loadPointer(tx, identity)
    const player = await loadRankedPlayer(tx, identity)
    await assertRaidAvailable(tx, pointer, player, timestamp)
    await lobbyLock(tx)
    const current = await tx.list('raidRoomIndex')
    if (current.filter(room => room.status === 'waiting').length >= MAX_ROOMS) fail('ROOM_LIMIT', '보스전 방은 최대 10개까지 열 수 있습니다.', 409)
    const code = visibility === 'private'
      ? (Array.isArray(inviteCodes) ? inviteCodes : []).find(candidate => typeof candidate === 'string' && /^[A-HJ-NP-Z2-9]{8}$/.test(candidate)
        && !current.some(existing => existing.status === 'waiting' && existing.visibility === 'private' && verifyPassword(existing, candidate)))
      : null
    if (visibility === 'private' && !code) throw new Error('Unable to allocate a private raid invite code')
    const room = {
      id,
      bossId: payload.bossId,
      title,
      visibility,
      hostUid: identity.uid,
      hostName: identity.name,
      hostNickname: identity.nickname,
      hostIsGuest: identity.isGuest === true,
      status: 'waiting',
      createdAt: timestamp,
      firstFullAt: null,
      roomRevision: 1,
      activeRaidId: null,
      npcRoles: normalizeNpcRoles(payload.npcRoles),
      codeHash: code ? passwordHash(code, salt) : null,
      codeSalt: code ? salt : null,
      members: [{
        uid: identity.uid, name: identity.name, nickname: identity.nickname, isGuest: identity.isGuest === true,
        slotId: 0, joinedAt: timestamp, lastSeenAt: timestamp, ready: false, withdrawn: false, isNpc: false, pokemon: null,
      }],
    }
    pointer.activeRoomId = room.id
    pointer.activeRaidId = null
    pointer.lastRaidId = null
    player.activeRaidId = room.id // A non-null reservation prevents queue/room races before raid start.
    tx.set('raidRooms', room.id, room)
    saveRoomIndex(tx, room)
    tx.set('raidPlayers', pointer.uid, pointer)
    tx.set('players', player.uid, player)
    return { room, inviteCode: code }
  }

  async function joinRoom(tx, identity, payload, timestamp) {
    const normalizedCode = typeof (payload.code ?? payload.password) === 'string'
      ? (payload.code ?? payload.password).trim().toUpperCase() : ''
    const recordCodeFailure = async scope => {
      const attemptId = joinAttemptKey(scope, identity.uid)
      const attempt = await tx.get('raidJoinAttempts', attemptId)
      if (attempt?.blockedUntil > timestamp) {
        return { code: 'ROOM_CODE_RATE_LIMITED', message: '초대 코드 시도가 너무 많습니다. 잠시 후 다시 시도해주세요.', status: 429 }
      }
      const fresh = !attempt || !Number.isSafeInteger(attempt.windowStartedAt) || timestamp - attempt.windowStartedAt >= ROOM_CODE_ATTEMPT_WINDOW_MS
      const count = fresh ? 1 : (Number.isSafeInteger(attempt.count) ? attempt.count : 0) + 1
      tx.set('raidJoinAttempts', attemptId, {
        id: attemptId,
        scope,
        windowStartedAt: fresh ? timestamp : attempt.windowStartedAt,
        count,
        blockedUntil: count >= ROOM_CODE_ATTEMPTS ? timestamp + ROOM_CODE_ATTEMPT_WINDOW_MS : 0,
      })
      return { code: 'ROOM_CODE_INVALID', message: '초대 코드가 올바르지 않습니다.', status: 403 }
    }

    let room
    const directRoom = payload.roomId !== undefined && payload.roomId !== null && payload.roomId !== ''
    if (directRoom) {
      if (!isId(payload.roomId)) fail('INVALID_ROOM', '방 식별자가 올바르지 않습니다.')
      room = await tx.get('raidRooms', payload.roomId)
    } else {
      if (!/^[A-HJ-NP-Z2-9]{8}$/.test(normalizedCode)) return { codeError: await recordCodeFailure('lookup') }
      const candidates = await tx.list('raidRoomIndex')
      const candidate = candidates.find(entry => entry.status === 'waiting' && entry.visibility === 'private' && verifyPassword(entry, normalizedCode)) ?? null
      room = candidate ? await tx.get('raidRooms', candidate.id) : null
      if (!room) return { codeError: await recordCodeFailure('lookup') }
    }
    if (!room) fail('ROOM_NOT_FOUND', '방이 종료되었거나 삭제되었습니다.', 404)
    if (room.status !== 'waiting') fail('ROOM_STARTED', '이미 시작한 방에는 참가할 수 없습니다.', 409)
    if (room.members.some(member => member.uid === identity.uid && !member.withdrawn)) return room
    if (directRoom) assertRoomRevision(room, payload, { required: true })
    if (room.members.filter(member => !member.isNpc && !member.withdrawn).length >= 3) fail('ROOM_FULL', '방이 가득 찼습니다.', 409)
    const attemptId = joinAttemptKey(room.id, identity.uid)
    const attempt = await tx.get('raidJoinAttempts', attemptId)
    if (attempt?.blockedUntil > timestamp) return { codeError: { code: 'ROOM_CODE_RATE_LIMITED', message: '초대 코드 시도가 너무 많습니다. 잠시 후 다시 시도해주세요.', status: 429 } }
    if (room.codeHash && !verifyPassword(room, normalizedCode)) return { codeError: await recordCodeFailure(room.id) }
    if (attempt) tx.delete('raidJoinAttempts', attemptId)
    const pointer = await loadPointer(tx, identity)
    const player = await loadRankedPlayer(tx, identity)
    await assertRaidAvailable(tx, pointer, player, timestamp)
    const used = new Set(room.members.filter(member => !member.withdrawn).map(member => member.slotId))
    const slotId = [0, 1, 2].find(slot => !used.has(slot))
    if (slotId === undefined) fail('ROOM_FULL', '방이 가득 찼습니다.', 409)
    room.members.push({
      uid: identity.uid, name: identity.name, nickname: identity.nickname, isGuest: identity.isGuest === true,
      slotId, joinedAt: timestamp, lastSeenAt: timestamp, ready: false, withdrawn: false, isNpc: false, pokemon: null,
    })
    // A changed party changes both the selected ally composition and the
    // available NPC roles.  Everyone confirms readiness again.
    for (const member of room.members) member.ready = false
    if (room.members.filter(member => !member.isNpc && !member.withdrawn).length === 3 && room.firstFullAt === null) room.firstFullAt = timestamp
    room.roomRevision += 1
    pointer.activeRoomId = room.id
    pointer.activeRaidId = null
    pointer.lastRaidId = null
    player.activeRaidId = room.id
    tx.set('raidRooms', room.id, room)
    saveRoomIndex(tx, room)
    tx.set('raidPlayers', pointer.uid, pointer)
    tx.set('players', player.uid, player)
    return room
  }

  async function setReady(tx, identity, payload, timestamp, selectedPokemon) {
    if (!isId(payload.roomId)) fail('INVALID_ROOM', '방 식별자가 올바르지 않습니다.')
    const room = await tx.get('raidRooms', payload.roomId)
    if (!room) fail('ROOM_NOT_FOUND', '방이 종료되었거나 삭제되었습니다.', 404)
    if (room.status !== 'waiting') fail('ROOM_STARTED', '이미 시작한 방은 편성할 수 없습니다.', 409)
    assertRoomRevision(room, payload, { required: true })
    const member = room.members.find(entry => entry.uid === identity.uid && !entry.withdrawn)
    if (!member) fail('ROOM_FORBIDDEN', '이 방에 참가한 계정만 편성할 수 있습니다.', 403)
    if (payload.npcRoles !== undefined) {
      if (room.hostUid !== identity.uid) fail('ROOM_HOST_ONLY', '방장만 지원 NPC 역할을 정할 수 있습니다.', 403)
      room.npcRoles = normalizeNpcRoles(payload.npcRoles)
      for (const entry of room.members) entry.ready = false
    }
    const ready = payload.ready !== false
    member.ready = ready
    member.pokemon = ready ? clone(selectedPokemon) : null
    member.lastSeenAt = timestamp
    room.roomRevision += 1
    tx.set('raidRooms', room.id, room)
    saveRoomIndex(tx, room)
    return room
  }

  async function heartbeatRoom(tx, identity, payload, timestamp) {
    if (!isId(payload.roomId)) fail('INVALID_ROOM', '방 식별자가 올바르지 않습니다.')
    const room = await tx.get('raidRooms', payload.roomId)
    if (!room) fail('ROOM_NOT_FOUND', '방이 종료되었거나 삭제되었습니다.', 404)
    if (room.status !== 'waiting') fail('ROOM_STARTED', '대기실 연결은 이미 시작된 보스전에 사용할 수 없습니다.', 409)
    const member = room.members?.find(entry => entry.uid === identity.uid && !entry.withdrawn)
    if (!member) fail('ROOM_FORBIDDEN', '이 방에 참가한 계정만 연결을 갱신할 수 있습니다.', 403)
    assertRoomRevision(room, payload)
    member.lastSeenAt = timestamp
    tx.set('raidRooms', room.id, room)
    return room
  }

  async function startRoom(tx, identity, payload, timestamp, raidId, seed) {
    if (!isId(payload.roomId)) fail('INVALID_ROOM', '방 식별자가 올바르지 않습니다.')
    const room = await tx.get('raidRooms', payload.roomId)
    if (!room) fail('ROOM_NOT_FOUND', '방이 종료되었거나 삭제되었습니다.', 404)
    if (room.status === 'active' && room.activeRaidId) return { room, run: await loadRun(tx, room.activeRaidId) }
    if (room.status !== 'waiting') fail('ROOM_STARTED', '이 방은 더 이상 시작할 수 없습니다.', 409)
    assertRoomRevision(room, payload, { required: true })
    if (room.hostUid !== identity.uid) fail('ROOM_HOST_ONLY', '방장만 레이드를 시작할 수 있습니다.', 403)
    const humans = room.members.filter(member => !member.isNpc && !member.withdrawn)
    if (!humans.length || humans.some(member => !member.ready || !isPlain(member.pokemon))) fail('MEMBERS_NOT_READY', '모든 참가자가 포켓몬을 선택하고 준비해야 합니다.', 409)
    const host = humans.find(member => member.uid === identity.uid)
    if (!host) fail('ROOM_HOST_ONLY', '방장만 레이드를 시작할 수 있습니다.', 403)
    host.lastSeenAt = timestamp
    // The lobby holds only a preview.  Re-resolve each selected capture from
    // its owning account immediately before the immutable battle snapshot is
    // created, so a stale client cannot start with an item or Pokémon it no
    // longer owns.
    for (const member of humans) {
      if (!isCaptureId(member.pokemon?.captureId)) fail('INVALID_POKEMON', '참가 포켓몬 정보를 다시 선택해주세요.', 409)
      const verified = await resolvePokemon({
        uid: member.uid,
        name: member.name,
        nickname: member.nickname,
        isGuest: member.isGuest === true,
      }, { captureId: member.pokemon.captureId })
      member.pokemon = clone(verified)
    }
    const members = participantList(room)
    const battle = clone(requireEngine('createRaidBattle')({ raidId, bossId: room.bossId, members, ...(room.npcRoles ? { npcRoles: room.npcRoles } : {}), seed }))
    const run = {
      id: raidId,
      roomId: room.id,
      bossId: room.bossId,
      schemaVersion: RAID_SCHEMA_VERSION,
      ruleVersion: RAID_RULE_VERSION,
      engineVersion: RAID_ENGINE_VERSION,
      createdAt: timestamp,
      updatedAt: timestamp,
      phase: Number(battle?.raid?.phase ?? battle?.phase ?? 1),
      phaseEpoch: Number(battle?.raid?.phaseEpoch ?? 1),
      turnNumber: Number(battle?.turn ?? 1),
      lifecycle: 'input',
      deadlineAt: timestamp + commandMs,
      suspendedAt: null,
      suspendedFromLifecycle: null,
      decisionToken: typeof battle?.raid?.decisionToken === 'string' ? battle.raid.decisionToken : `r1_p1_e1_t1`,
      revision: 1,
      eventCursor: 0,
      eventChunks: [],
      participants: battle.raid.members.map((member, slotId) => ({
        ownerId: member.ownerId,
        displayName: member.displayName,
        isNpc: member.isNpc === true,
        pokemon: member.isNpc ? null : clone(member.pokemon),
        slotId,
        withdrawn: false,
        lastSeenAt: member.isNpc ? null : timestamp,
      })),
      battle,
      commands: {},
      commandVersions: {},
      resolution: null,
      requests: [],
      result: null,
    }
    room.status = 'active'
    room.activeRaidId = raidId
    room.roomRevision += 1
    for (const member of humans) {
      const pointer = await tx.get('raidPlayers', member.uid)
      if (pointer) { pointer.activeRoomId = room.id; pointer.activeRaidId = raidId; tx.set('raidPlayers', member.uid, pointer) }
      const player = await tx.get('players', member.uid)
      if (player) { player.activeRaidId = raidId; tx.set('players', member.uid, player) }
    }
    tx.set('raidRooms', room.id, room)
    saveRoomIndex(tx, room)
    await persistEvents(tx, run, battle, 0)
    saveRun(tx, run)
    return { room, run }
  }

  async function leaveRoom(tx, identity, payload, timestamp) {
    if (!isId(payload.roomId)) fail('INVALID_ROOM', '방 식별자가 올바르지 않습니다.')
    const room = await tx.get('raidRooms', payload.roomId)
    if (!room) return null
    if (room.status === 'waiting') assertRoomRevision(room, payload, { required: true })
    else assertRoomRevision(room, payload)
    const member = room.members.find(entry => entry.uid === identity.uid && !entry.withdrawn)
    if (!member) fail('ROOM_FORBIDDEN', '이 방에 참가한 계정만 나갈 수 있습니다.', 403)
    if (room.status === 'waiting') {
      room.members = room.members.filter(entry => entry.uid !== identity.uid)
      if (!room.members.length) {
        tx.delete('raidRooms', room.id)
        tx.delete('raidRoomIndex', room.id)
      }
      else {
        if (room.hostUid === identity.uid) {
          const successor = room.members.slice().sort((a, b) => a.joinedAt - b.joinedAt || a.uid.localeCompare(b.uid))[0]
          Object.assign(room, { hostUid: successor.uid, hostName: successor.name, hostNickname: successor.nickname, hostIsGuest: successor.isGuest === true })
        }
        for (const entry of room.members) entry.ready = false
        room.firstFullAt = room.members.length === 3 ? room.firstFullAt ?? timestamp : null
        room.roomRevision += 1
        tx.set('raidRooms', room.id, room)
        saveRoomIndex(tx, room)
      }
      await releaseMembership(tx, identity.uid, { roomId: room.id })
      return room
    }
    const run = room.activeRaidId ? await loadRun(tx, room.activeRaidId) : null
    if (!run || ['finished', 'abandoned'].includes(run.lifecycle)) {
      await releaseMembership(tx, identity.uid, { roomId: room.id, raidId: room.activeRaidId })
      return room
    }
    member.withdrawn = true
    const participant = run.participants.find(entry => entry.ownerId === identity.uid)
    if (participant) participant.withdrawn = true
    delete run.commands[identity.uid]
    room.roomRevision += 1
    run.updatedAt = timestamp
    run.revision += 1
    // Explicit exit is not a disconnect. The engine will take over that slot
    // through an NPC command, and this player is excluded from success rewards.
    if (!commandParticipants(run).length) {
      await settleRun(tx, run, 'lost', timestamp)
      return room
    }
    tx.set('raidRooms', room.id, room)
    saveRun(tx, run)
    await releaseMembership(tx, identity.uid, { roomId: room.id, raidId: run.id })
    return room
  }

  function commandParticipants(run) {
    return run.participants.filter(member => {
      if (member.isNpc || member.withdrawn) return false
      const actor = run.battle?.player?.team?.find(pokemon => pokemon.raidOwnerId === member.ownerId)
      return actor && actor.hp > 0 && !actor.fainted
    })
  }

  function shouldResolve(run, timestamp) {
    if (run.lifecycle !== 'input') return false
    const humans = commandParticipants(run)
    return humans.every(member => Boolean(run.commands?.[member.ownerId])) || timestamp >= run.deadlineAt
  }

  function automaticCommand(battle, ownerId, seed) {
    const choose = requireEngine('chooseRaidCommand')
    const command = choose(clone(battle), ownerId, { seed })
    return command ? requireEngine('validateRaidCommand')(battle, ownerId, command) : null
  }

  function claimResolution(run, timestamp, resolutionId, seed) {
    if (run.lifecycle === 'resolving' && run.resolution?.id) {
      // A current lease belongs to the request that first locked the turn.
      // Other heartbeats must observe it, not recompute the engine turn.
      if (Number.isSafeInteger(run.resolution.leaseUntil) && run.resolution.leaseUntil > timestamp) return null
      // The original worker may have died after persisting the lock.  A new
      // request can take over only after the lease, retaining exactly the
      // already-locked commands and deterministic seed.  Its CAS id fences
      // off the old worker at commit time.
      run.resolution = {
        ...run.resolution,
        id: resolutionId,
        claimedAt: timestamp,
        leaseUntil: timestamp + resolutionLeaseMs,
      }
      run.updatedAt = timestamp
      run.revision += 1
      return { raidId: run.id, resolutionId }
    }
    if (!shouldResolve(run, timestamp)) return null
    const commands = {}
    for (const participant of run.participants) {
      const submitted = run.commands?.[participant.ownerId]?.command
      const command = submitted ?? automaticCommand(run.battle, participant.ownerId, seed)
      if (command) commands[participant.ownerId] = command
    }
    run.lifecycle = 'resolving'
    // Resolving is observable state.  Bump the public revision so short
    // polls cannot keep rendering an input turn after its lease was claimed.
    run.revision += 1
    run.resolution = {
      id: resolutionId,
      baseRevision: run.revision,
      seed,
      commands,
      claimedAt: timestamp,
      leaseUntil: timestamp + resolutionLeaseMs,
    }
    run.updatedAt = timestamp
    return { raidId: run.id, resolutionId }
  }

  async function settleRun(tx, run, outcome, timestamp) {
    if (run.result) return run.result
    const result = { raidId: run.id, bossId: run.bossId, outcome, finishedAt: timestamp, participants: [], rewards: [] }
    const win = outcome === 'won'
    for (const participant of run.participants.filter(entry => !entry.isNpc)) {
      const row = { ownerId: participant.ownerId, raidId: run.id, bossId: run.bossId, outcome: win && !participant.withdrawn ? 'win' : 'loss', rewardVp: 0, firstClearVp: 0 }
      if (win && !participant.withdrawn) {
        const clearReceiptId = rewardKey(run.id, participant.ownerId, 'clear')
        if (!await tx.get('raidRewardReceipts', clearReceiptId)) {
          row.rewardVp = RAID_DEFAULTS.winVp
          tx.set('raidRewardReceipts', clearReceiptId, { id: clearReceiptId, raidId: run.id, uid: participant.ownerId, bossId: run.bossId, kind: 'clear', vp: row.rewardVp, createdAt: timestamp })
        }
        const clearKey = firstClearKey(run.bossId, participant.ownerId)
        if (!await tx.get('raidFirstClears', clearKey)) {
          row.firstClearVp = RAID_DEFAULTS.firstClearVp
          tx.set('raidFirstClears', clearKey, { id: clearKey, bossId: run.bossId, uid: participant.ownerId, raidId: run.id, clearedAt: timestamp })
          const firstReceiptId = rewardKey(run.id, participant.ownerId, 'first')
          tx.set('raidRewardReceipts', firstReceiptId, { id: firstReceiptId, raidId: run.id, uid: participant.ownerId, bossId: run.bossId, kind: 'first-clear', vp: row.firstClearVp, createdAt: timestamp })
        }
        const pointer = await tx.get('raidPlayers', participant.ownerId)
        if (pointer) {
          pointer.vpRewardTotal = (Number.isSafeInteger(pointer.vpRewardTotal) ? pointer.vpRewardTotal : 0) + row.rewardVp + row.firstClearVp
          tx.set('raidPlayers', pointer.uid, pointer)
        }
      }
      result.participants.push(row)
      result.rewards.push({ uid: participant.ownerId, totalVp: row.rewardVp + row.firstClearVp, firstClear: row.firstClearVp > 0 })
      const resultId = rewardKey(run.id, participant.ownerId, 'result')
      tx.set('raidResults', resultId, { id: resultId, raidId: run.id, uid: participant.ownerId, bossId: run.bossId, ...row, finishedAt: timestamp })
      await releaseMembership(tx, participant.ownerId, { roomId: run.roomId, raidId: run.id, resultId: run.id })
    }
    run.lifecycle = 'finished'
    run.deadlineAt = null
    run.result = result
    run.resolution = null
    run.commands = {}
    run.updatedAt = timestamp
    const room = await tx.get('raidRooms', run.roomId)
    if (room?.activeRaidId === run.id) {
      tx.delete('raidRooms', room.id)
      tx.delete('raidRoomIndex', room.id)
    }
    // settleRun is also called from timeout and withdrawal paths which do not
    // have a later generic save. Persist here so a terminal result cannot be
    // lost between the reward receipts and player-pointer release.
    saveRun(tx, run)
    return result
  }

  async function resolveClaim(claim, identity, timestamp) {
    if (!claim) return null
    const base = await transaction(identity, async tx => {
      const run = await loadRun(tx, claim.raidId)
      if (!run || run.lifecycle !== 'resolving' || run.resolution?.id !== claim.resolutionId) return null
      return clone(run)
    })
    if (!base) return null
    const resolvedBattle = clone(await requireEngine('resolveRaidTurn')(clone(base.battle), clone(base.resolution.commands), { seed: base.resolution.seed }))
    // Keep the final prelude cues and the reset presentation in the same
    // deterministic result. The resolution CAS commits both stages once;
    // clients replay that event order before enabling boss commands.
    const nextBattle = requireEngine('getRaidOutcome')(resolvedBattle) === 'stage-cleared'
      ? clone(await requireEngine('startRaidBossStage')(resolvedBattle, { seed: `${base.resolution.seed}:boss-stage` }))
      : resolvedBattle
    const outcome = requireEngine('getRaidOutcome')(nextBattle)
    return transaction(identity, async tx => {
      const run = await loadRun(tx, claim.raidId)
      if (!run || run.lifecycle !== 'resolving' || run.resolution?.id !== claim.resolutionId || run.resolution.baseRevision !== base.resolution.baseRevision) {
        return snapshot(tx, identity.uid, { timestamp })
      }
      const previousCursor = run.eventCursor
      run.battle = nextBattle
      run.phase = Number(nextBattle?.raid?.phase ?? nextBattle?.phase ?? run.phase)
      run.phaseEpoch = Number(nextBattle?.raid?.phaseEpoch ?? run.phaseEpoch)
      run.turnNumber = Number(nextBattle?.turn ?? run.turnNumber + 1)
      run.revision += 1
      run.commands = {}
      run.resolution = null
      run.updatedAt = timestamp
      if (winnerFromOutcome(outcome)) {
        await settleRun(tx, run, outcome, timestamp)
      } else {
        run.lifecycle = 'input'
        const hasNewCues = nextBattle.raid?.events?.some(event => event.kind === 'battle-cue' && (eventNumber(event) ?? 0) > previousCursor)
        run.deadlineAt = timestamp + commandMs + (hasNewCues ? playbackGraceMs : 0)
        run.decisionToken = typeof nextBattle?.raid?.decisionToken === 'string' ? nextBattle.raid.decisionToken : nextDecisionToken(run)
      }
      await persistEvents(tx, run, nextBattle, previousCursor)
      saveRun(tx, run)
      return snapshot(tx, identity.uid, { timestamp })
    })
  }

  async function transitionLegacyIntermission(tx, run, timestamp, seed) {
    if (run.lifecycle !== 'intermission') return false
    const previousCursor = run.eventCursor
    const battle = clone(await requireEngine('startRaidBossStage')(clone(run.battle), { seed }))
    run.battle = battle
    run.phase = Number(battle?.raid?.phase ?? battle?.phase ?? 2)
    run.phaseEpoch = Number(battle?.raid?.phaseEpoch ?? run.phaseEpoch + 1)
    run.turnNumber = Number(battle?.turn ?? 1)
    run.lifecycle = 'input'
    run.deadlineAt = timestamp + commandMs + playbackGraceMs
    run.revision += 1
    run.commands = {}
    run.resolution = null
    run.decisionToken = typeof battle?.raid?.decisionToken === 'string' ? battle.raid.decisionToken : nextDecisionToken(run)
    run.updatedAt = timestamp
    await persistEvents(tx, run, battle, previousCursor)
    saveRun(tx, run)
    return true
  }

  async function advanceStage(tx, identity, payload, timestamp, seed, resolutionId) {
    if (!isId(payload.raidId)) fail('INVALID_RAID', '보스전 식별자가 올바르지 않습니다.')
    const run = await loadRun(tx, payload.raidId)
    if (!run) fail('RAID_NOT_FOUND', '보스전을 찾을 수 없습니다.', 404)
    const participant = run.participants.find(entry => entry.ownerId === identity.uid && !entry.isNpc && !entry.withdrawn)
    if (!participant) fail('RAID_FORBIDDEN', '이 보스전 참가자만 진행할 수 있습니다.', 403)
    await applyPresence(tx, run, identity.uid, timestamp)
    if (['finished', 'abandoned', 'suspended'].includes(run.lifecycle)) {
      saveRun(tx, run)
      return { run, claim: null }
    }
    if (run.lifecycle === 'input' || run.lifecycle === 'resolving') {
      const claim = claimResolution(run, timestamp, resolutionId, seed)
      saveRun(tx, run)
      return { run, claim }
    }
    if (run.lifecycle !== 'intermission') return { run, claim: null }
    if (payload.decisionToken !== undefined && payload.decisionToken !== decisionToken(run)) {
      fail('STALE_DECISION', '단계 전환 상태가 바뀌었습니다. 최신 상태를 불러와주세요.', 409)
    }
    await transitionLegacyIntermission(tx, run, timestamp, seed)
    return { run, claim: null }
  }

  async function submitCommand(tx, identity, payload, timestamp, resolutionId, resolutionSeed) {
    if (!isId(payload.raidId)) fail('INVALID_RAID', '보스전 식별자가 올바르지 않습니다.')
    const run = await loadRun(tx, payload.raidId)
    if (!run) fail('RAID_NOT_FOUND', '보스전을 찾을 수 없습니다.', 404)
    const participant = run.participants.find(entry => entry.ownerId === identity.uid && !entry.isNpc && !entry.withdrawn)
    if (!participant) fail('RAID_FORBIDDEN', '이 보스전 참가자만 명령을 제출할 수 있습니다.', 403)
    await applyPresence(tx, run, identity.uid, timestamp)
    if (run.lifecycle !== 'input') fail('WRONG_PHASE', '현재는 행동을 선택할 수 없습니다.', 409)
    if (payload.decisionToken !== decisionToken(run)) fail('STALE_DECISION', '행동 선택 단계가 바뀌었습니다. 최신 상태를 불러와주세요.', 409)
    const raw = payload.command ?? payload.action
    if (!isPlain(raw)) fail('INVALID_COMMAND', '행동을 다시 선택해주세요.')
    const canonical = requireEngine('validateRaidCommand')(run.battle, identity.uid, raw)
    const previous = run.commands?.[identity.uid]
    const requestedVersion = optionalInteger(payload.commandVersion)
    if (requestedVersion === null || requestedVersion < 1) fail('INVALID_COMMAND_VERSION', '행동 버전이 올바르지 않습니다.')
    run.commandVersions ??= {}
    const highestVersion = Number.isSafeInteger(run.commandVersions[identity.uid]) ? run.commandVersions[identity.uid] : 0
    if (requestedVersion <= highestVersion) {
      if (previous && requestedVersion === previous.version && digest(previous.command) === digest(canonical)) return { run, claim: null }
      fail('STALE_COMMAND_VERSION', '이미 더 최신 행동을 제출했습니다.', 409)
    }
    if (requestedVersion !== highestVersion + 1) fail('COMMAND_VERSION_GAP', '다음 행동 버전으로 다시 제출해주세요.', 409)
    const version = requestedVersion
    run.commands ??= {}
    run.commands[identity.uid] = { command: clone(canonical), version, submittedAt: timestamp }
    run.commandVersions[identity.uid] = version
    run.updatedAt = timestamp
    // Command presence is public to allies, so it receives a distinct public
    // revision even when this is not the final command of the turn.
    run.revision += 1
    const claim = claimResolution(run, timestamp, resolutionId, resolutionSeed)
    saveRun(tx, run)
    return { run, claim }
  }

  async function revokeCommand(tx, identity, payload, timestamp) {
    if (!isId(payload.raidId)) fail('INVALID_RAID', '보스전 식별자가 올바르지 않습니다.')
    const run = await loadRun(tx, payload.raidId)
    if (!run) fail('RAID_NOT_FOUND', '보스전을 찾을 수 없습니다.', 404)
    if (!run.participants.some(entry => entry.ownerId === identity.uid && !entry.isNpc && !entry.withdrawn)) fail('RAID_FORBIDDEN', '이 보스전 참가자만 행동을 취소할 수 있습니다.', 403)
    await applyPresence(tx, run, identity.uid, timestamp)
    if (run.lifecycle !== 'input' || payload.decisionToken !== decisionToken(run)) fail('STALE_DECISION', '행동 선택 단계가 바뀌었습니다.', 409)
    const previous = run.commands?.[identity.uid]
    const requestedVersion = optionalInteger(payload.commandVersion)
    const highestVersion = Number.isSafeInteger(run.commandVersions?.[identity.uid]) ? run.commandVersions[identity.uid] : 0
    if (!previous) fail('COMMAND_NOT_SUBMITTED', '취소할 행동이 없습니다.', 409)
    if (requestedVersion !== null && requestedVersion !== highestVersion) fail('STALE_COMMAND_VERSION', '최신 행동 상태를 불러온 뒤 다시 취소해주세요.', 409)
    delete run.commands?.[identity.uid]
    run.updatedAt = timestamp
    // commandVersions intentionally remains monotonic.  Reusing a revoked
    // version would let an old network retry win an ABA race.
    run.revision += 1
    saveRun(tx, run)
    return run
  }

  async function maybeClaimExpired(tx, uid, timestamp, id, seed, { touch = false } = {}) {
    const pointer = await tx.get('raidPlayers', uid)
    const raidId = pointer?.activeRaidId
    if (!raidId) return null
    const run = await loadRun(tx, raidId)
    if (!run) return null
    const participant = run.participants?.find(entry => entry.ownerId === uid && !entry.isNpc && !entry.withdrawn)
    if (!participant) return null
    if (touch) await applyPresence(tx, run, uid, timestamp)
    if (['finished', 'abandoned', 'suspended'].includes(run.lifecycle)) {
      saveRun(tx, run)
      return null
    }
    if (await transitionLegacyIntermission(tx, run, timestamp, seed)) return null
    const claim = claimResolution(run, timestamp, id, seed)
    // A duplicate mutation can still renew this caller's presence even when
    // the turn is not ready to resolve. Keep its compact header in sync.
    saveRun(tx, run)
    return claim
  }

  async function heartbeat(tx, identity, payload, timestamp, resolutionId, seed) {
    if (!isId(payload.raidId)) fail('INVALID_RAID', '보스전 식별자가 올바르지 않습니다.')
    const run = await loadRun(tx, payload.raidId)
    if (!run) fail('RAID_NOT_FOUND', '보스전을 찾을 수 없습니다.', 404)
    if (!run.participants?.some(entry => entry.ownerId === identity.uid && !entry.isNpc && !entry.withdrawn)) fail('RAID_FORBIDDEN', '이 보스전 참가자만 상태를 갱신할 수 있습니다.', 403)
    await applyPresence(tx, run, identity.uid, timestamp)
    if (['finished', 'abandoned'].includes(run.lifecycle)) {
      saveRun(tx, run)
      return { run, claim: null }
    }
    if (await transitionLegacyIntermission(tx, run, timestamp, seed)) return { run, claim: null }
    const claim = claimResolution(run, timestamp, resolutionId, seed)
    saveRun(tx, run)
    return { run, claim }
  }

  async function viewRun(tx, run, uid, { eventCursor, timestamp } = {}) {
    if (!run) return null
    const participant = run.participants?.find(entry => entry.ownerId === uid && !entry.isNpc)
    if (!participant) fail('RAID_FORBIDDEN', '이 보스전 참가자만 상태를 볼 수 있습니다.', 403)
    const view = run.battle ? clientBattleView(requireEngine('getRaidBattleView')(clone(run.battle), uid)) : null
    const events = await eventsSince(tx, run, eventCursor, view)
    const own = run.commands?.[uid]
    return {
      id: run.id,
      roomId: run.roomId,
      bossId: run.bossId,
      stage: run.phase,
      phase: run.phase,
      lifecycle: run.lifecycle,
      turnNumber: run.turnNumber,
      deadlineAt: run.deadlineAt,
      decisionToken: decisionToken(run),
      revision: run.revision,
      eventCursor: run.eventCursor,
      ownActorId: ownActorId(run, uid),
      primaryBossId: view?.raid?.primaryBossId ?? null,
      pendingSubmitted: Boolean(own),
      submitted: Boolean(own),
      actionSubmitted: Boolean(own),
      ownCommandVersion: Number.isSafeInteger(run.commandVersions?.[uid]) ? run.commandVersions[uid] : (own?.version ?? 0),
      participants: run.participants.map(member => ({
        name: member.displayName,
        slotId: member.slotId,
        isAi: member.isNpc === true || member.withdrawn === true,
        aiControlled: member.isNpc === true || member.withdrawn === true || (Number.isSafeInteger(timestamp) && !isParticipantPresent(member, timestamp)),
        submitted: Boolean(run.commands?.[member.ownerId]),
        withdrawn: member.withdrawn === true,
        ...(member.ownerId === uid ? { isOwn: true } : {}),
      })),
      battle: view,
      events,
      result: publicResult(run.result, uid, run),
    }
  }

  async function snapshot(tx, uid, {
    eventCursor,
    requestedRaidId = null,
    sinceRevision = null,
    revision = null,
    timestamp = now(),
  } = {}) {
    // This function is used by GET endpoints.  It must never clean rooms,
    // resolve turns, refresh leases, or clear pointers.  Those changes belong
    // to explicit POST commands so CDNs/retries cannot mutate the raid.
    const pointer = await tx.get('raidPlayers', uid)
    // Browsing reads only compact waiting-room rows.  Full room documents are
    // fetched by id for the caller's own room, never deserialized for every
    // public listing entry.
    const roomIndexes = await tx.list('raidRoomIndex')
    const ownRoomId = pointer?.activeRoomId ?? null
    let room = null

    let raidId = pointer?.activeRaidId ?? null
    if (requestedRaidId) {
      if (!isId(requestedRaidId)) fail('INVALID_RAID', '보스전 식별자가 올바르지 않습니다.')
      raidId = requestedRaidId
    }
    const knownRevision = optionalInteger(sinceRevision ?? revision)
    let head = raidId ? await loadRunHead(tx, raidId) : null
    let run = null
    let raid = null
    let usedCompactHead = false

    if (head) {
      const participant = head.participants?.find(entry => entry.ownerId === uid && !entry.isNpc)
      if (!participant) fail('RAID_FORBIDDEN', '이 보스전 참가자만 상태를 볼 수 있습니다.', 403)
      const terminal = ['finished', 'abandoned'].includes(head.lifecycle)
      // A terminal header already holds a small result projection.  An active
      // run is compact only when the caller has the exact public revision;
      // first load and changed revisions still receive the full battle view.
      if ((terminal && head.result) || (!terminal && knownRevision !== null && knownRevision === head.revision)) {
        raid = publicRunHead(head, uid, timestamp)
        usedCompactHead = true
      }
    }

    if (!usedCompactHead && raidId) {
      run = await loadRun(tx, raidId)
      if (run && !run.participants?.some(entry => entry.ownerId === uid && !entry.isNpc)) fail('RAID_FORBIDDEN', '이 보스전 참가자만 상태를 볼 수 있습니다.', 403)
      if (run && ['finished', 'abandoned'].includes(run.lifecycle)) {
        // A pre-index terminal run is safe to render from a freshly derived
        // compact view; GET remains read-only and never backfills the header.
        raid = publicRunHead(raidRunHead(run), uid, timestamp)
      } else if (run) {
        raid = await viewRun(tx, run, uid, { eventCursor, timestamp })
      }
    }

    // An unchanged active run intentionally does not fetch or return the
    // large active-room record. The client retains its previous room state;
    // a lobby-only status still receives its one direct room document.
    if (ownRoomId && !usedCompactHead) {
      room = await tx.get('raidRooms', ownRoomId)
      if (room?.status === 'waiting' && roomDeadline(room) <= timestamp) room = null
    }
    // Requested historic runs may not be the current pointer's room.  Only a
    // verified full run reaches this branch, so it is one direct document get.
    if (!room && run?.roomId) {
      const candidate = await tx.get('raidRooms', run.roomId)
      if (candidate?.members?.some(member => member.uid === uid && !member.withdrawn)) room = candidate
    }

    let result = raid?.result ?? null
    if (!result && pointer?.lastRaidId) {
      const resultHead = pointer.lastRaidId === raidId ? head : await loadRunHead(tx, pointer.lastRaidId)
      if (resultHead) {
        const participant = resultHead.participants?.find(entry => entry.ownerId === uid && !entry.isNpc)
        if (participant) result = publicResult(resultHead.result, uid, resultHead)
      } else {
        const resultRun = await loadRun(tx, pointer.lastRaidId)
        if (resultRun?.participants?.some(entry => entry.ownerId === uid && !entry.isNpc)) result = publicResult(resultRun.result, uid, resultRun)
      }
    }
    const grantedVp = (Number.isSafeInteger(result?.rewardVp) ? result.rewardVp : 0) + (Number.isSafeInteger(result?.firstClearVp) ? result.firstClearVp : 0)
    const visibleRooms = roomIndexes.filter(entry => entry.status === 'waiting' && roomDeadline(entry) > timestamp
      // Private invitations are code-only.  The host still sees their own
      // entry; non-host members receive their room through the direct pointer.
      && (entry.visibility === 'public' || entry.hostUid === uid))
    const response = {
      catalog: catalogFromEngine(engine),
      rooms: visibleRooms.map(entry => publicRoom(entry, uid)).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)),
      raid,
      result,
      rewards: { total: Number.isSafeInteger(pointer?.vpRewardTotal) ? pointer.vpRewardTotal : 0, vp: grantedVp, vpGranted: grantedVp },
      conflicts: {
        activeRaidId: pointer?.activeRaidId ?? null,
        activeRoomId: pointer?.activeRoomId ?? null,
      },
      serverTime: timestamp,
    }
    // Omit room instead of sending null during a compact active-run response.
    // The client retains its last full room projection while it merges the
    // header into the retained battle state.
    if (!usedCompactHead || room) response.room = publicRoom(room, uid)
    return response
  }

  function selectionPayload(payload) {
    const input = payload.pokemon ?? payload.selectedPokemon ?? payload.selectedPokemonId
    if (typeof input === 'string') {
      if (!isCaptureId(input)) fail('INVALID_POKEMON', '보유 포켓몬 한 마리를 선택해주세요.')
      return { captureId: input }
    }
    if (!isPlain(input) || !isCaptureId(input.captureId)) fail('INVALID_POKEMON', '보유 포켓몬 한 마리를 선택해주세요.')
    return { captureId: input.captureId }
  }

  async function resumeKnownResolution(tx, known) {
    const locked = known?.resolution
    if (!isId(locked?.raidId) || !isId(locked?.resolutionId)) return null
    const run = await loadRun(tx, locked.raidId)
    // A retry may only resume the exact resolution its original mutation
    // claimed.  It must never inspect a later deadline and claim a new turn.
    if (run?.lifecycle !== 'resolving' || run.resolution?.id !== locked.resolutionId) return null
    return { raidId: locked.raidId, resolutionId: locked.resolutionId }
  }

  async function assertMutationVersions(tx, pointer, action, payload) {
    // Version compatibility is a preflight, before expiry cleanup or any
    // pointer mutation. A newer persisted run must remain byte-for-byte
    // preserved even when a caller asks to withdraw, dismiss, or join another
    // mode while it is referenced by an older pointer.
    const raidIds = new Set()
    if (isId(pointer?.activeRaidId)) raidIds.add(pointer.activeRaidId)
    const rankedPlayer = pointer?.uid ? await tx.get('players', pointer.uid) : null
    if (isId(rankedPlayer?.activeRaidId)) raidIds.add(rankedPlayer.activeRaidId)
    if (action === 'raidDismissResult' && isId(pointer?.lastRaidId)) raidIds.add(pointer.lastRaidId)
    if (['raidSubmit', 'raidRevoke', 'raidAdvance', 'raidHeartbeat', 'raidWithdraw', 'raidForfeit'].includes(action) && isId(payload?.raidId)) {
      raidIds.add(payload.raidId)
    }
    const roomIds = new Set()
    if (isId(pointer?.activeRoomId)) roomIds.add(pointer.activeRoomId)
    if (isId(rankedPlayer?.activeRaidId)) roomIds.add(rankedPlayer.activeRaidId)
    if (['roomReady', 'roomHeartbeat', 'roomStart', 'roomLeave'].includes(action) && isId(payload?.roomId)) roomIds.add(payload.roomId)
    for (const roomId of roomIds) {
      const room = await tx.get('raidRooms', roomId)
      if (isId(room?.activeRaidId)) raidIds.add(room.activeRaidId)
    }
    for (const raidId of raidIds) await loadRun(tx, raidId)
  }

  async function execute(rawIdentity, rawPayload = {}) {
    let identity = normalizeIdentity(rawIdentity)
    const action = rawPayload?.action ?? 'status'
    const readActions = new Set(['catalog', 'rooms', 'raidList', 'status'])
    const actions = new Set([...readActions, 'roomCreate', 'roomJoin', 'roomLeave', 'roomReady', 'roomHeartbeat', 'roomStart', 'raidSubmit', 'raidRevoke', 'raidAdvance', 'raidHeartbeat', 'raidWithdraw', 'raidForfeit', 'raidDismissResult'])
    // Lobby changes may clear expired waiting rooms.  Only infrequent lobby
    // and result actions sweep the terminal expiry index; per-turn submit,
    // advance and heartbeat paths touch only their current raid documents.
    const lobbySweepActions = new Set(['roomCreate', 'roomJoin', 'roomLeave', 'roomReady', 'roomStart'])
    const retentionSweepActions = new Set([...lobbySweepActions, 'raidDismissResult'])
    if (!actions.has(action)) fail('UNKNOWN_ACTION', '지원하지 않는 보스전 요청입니다.')
    if (identity.isGuest) {
      const profile = await guests.read(identity)
      identity = { ...identity, name: profile.displayName }
    }
    const payload = isPlain(rawPayload) ? rawPayload : {}
    const timestamp = now()
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new Error('Invalid raid server clock')
    if (readActions.has(action)) {
      return transaction(identity, tx => snapshot(tx, identity.uid, {
        eventCursor: payload.eventCursor,
        requestedRaidId: payload.raidId ?? null,
        sinceRevision: payload.sinceRevision ?? payload.revision,
        timestamp,
      }))
    }
    const id = newId()
    const seed = makeSeed()
    const salt = randomBytes(16).toString('hex')
    const inviteCodes = action === 'roomCreate'
      ? Array.from({ length: 16 }, () => makeRoomCode())
      : []
    let selectedPokemon = null
    assertRequest(payload)
    if (action === 'roomReady' && payload.ready !== false) selectedPokemon = clone(await resolvePokemon(identity, selectionPayload(payload)))
    const requestHash = digest(payload)
    const transactionResult = await transaction(identity, async tx => {
      // Retries are read-only except for resuming the exact resolution that
      // the original request already locked.  In particular they cannot make
      // a late old submit advance a later turn through deadline handling.
      let pointer = await loadPointer(tx, identity)
      const known = requestKnown(pointer, payload.requestId, requestHash)
      if (known) {
        const claim = await resumeKnownResolution(tx, known)
        return {
          response: await snapshot(tx, identity.uid, {
            eventCursor: payload.eventCursor,
            requestedRaidId: payload.raidId ?? null,
            sinceRevision: payload.sinceRevision ?? payload.revision,
            timestamp,
          }),
          claim,
        }
      }
      // Fence a result close before the opportunistic terminal sweep.  If the
      // matching seven-day record is removed by that same transaction, the
      // close is already complete and must not turn into a retry loop.  A
      // different newer pointer remains a stale-result conflict.
      if (action === 'raidDismissResult') {
        if (!isId(payload.raidId)) fail('RESULT_ID_REQUIRED', '닫을 결과를 다시 확인해주세요.', 409)
        if (pointer.lastRaidId !== payload.raidId) fail('STALE_RESULT', '더 최신 보스전 결과가 있어 이전 결과를 닫을 수 없습니다.', 409)
      }
      await assertMutationVersions(tx, pointer, action, payload)
      if (lobbySweepActions.has(action)) await cleanExpiredRooms(tx, timestamp)
      if (retentionSweepActions.has(action)) await cleanExpiredRaidHistory(tx, timestamp)
      // Expiry cleanup may have released this caller from an old room. Reload
      // the pointer before a new mutation and re-check a transaction retry.
      pointer = await loadPointer(tx, identity)
      const knownAfterCleanup = requestKnown(pointer, payload.requestId, requestHash)
      if (knownAfterCleanup) {
        const claim = await resumeKnownResolution(tx, knownAfterCleanup)
        return {
          response: await snapshot(tx, identity.uid, {
            eventCursor: payload.eventCursor,
            requestedRaidId: payload.raidId ?? null,
            sinceRevision: payload.sinceRevision ?? payload.revision,
            timestamp,
          }),
          claim,
        }
      }
      let claim = null
      let issuedInviteCode = null
      if (action === 'roomCreate') {
        const created = await createRoom(tx, identity, payload, timestamp, id, salt, inviteCodes)
        issuedInviteCode = created.inviteCode
      }
      else if (action === 'roomJoin') {
        const joined = await joinRoom(tx, identity, payload, timestamp)
        if (joined?.codeError) return { error: joined.codeError }
      }
      else if (action === 'roomReady') await setReady(tx, identity, payload, timestamp, selectedPokemon)
      else if (action === 'roomHeartbeat') await heartbeatRoom(tx, identity, payload, timestamp)
      else if (action === 'roomStart') await startRoom(tx, identity, payload, timestamp, id, seed)
      else if (action === 'roomLeave' || action === 'raidWithdraw' || action === 'raidForfeit') {
        const roomId = action === 'roomLeave' ? payload.roomId : (await loadRun(tx, payload.raidId))?.roomId
        if (!roomId) fail('ROOM_NOT_FOUND', '방을 찾을 수 없습니다.', 404)
        await leaveRoom(tx, identity, { roomId, roomRevision: payload.roomRevision ?? payload.expectedRoomRevision ?? payload.expectedRevision }, timestamp)
      } else if (action === 'roomReady') { /* covered above */ }
      else if (action === 'raidSubmit') {
        const submitted = await submitCommand(tx, identity, payload, timestamp, id, seed)
        claim = submitted.claim
      } else if (action === 'raidRevoke') await revokeCommand(tx, identity, payload, timestamp)
      else if (action === 'raidAdvance') {
        const advanced = await advanceStage(tx, identity, payload, timestamp, seed, id)
        claim = advanced.claim
      } else if (action === 'raidHeartbeat') {
        const beat = await heartbeat(tx, identity, payload, timestamp, id, seed)
        claim = beat.claim
      }
      else if (action === 'raidDismissResult') {
        if (pointer.lastRaidId === payload.raidId) {
          pointer.lastRaidId = null
          tx.set('raidPlayers', pointer.uid, pointer)
        } else if (pointer.lastRaidId !== null) {
          fail('STALE_RESULT', '더 최신 보스전 결과가 있어 이전 결과를 닫을 수 없습니다.', 409)
        }
        // `null` is allowed only because the matching pointer was verified
        // above and the same transaction may have expired that exact result.
      }
      const latestPointer = await loadPointer(tx, identity)
      if (!requestKnown(latestPointer, payload.requestId, requestHash)) rememberRequest(latestPointer, payload.requestId, requestHash, { claim })
      tx.set('raidPlayers', latestPointer.uid, latestPointer)
      const response = await snapshot(tx, identity.uid, {
        eventCursor: payload.eventCursor,
        requestedRaidId: payload.raidId ?? null,
        sinceRevision: payload.sinceRevision ?? payload.revision,
        timestamp,
      })
      if (issuedInviteCode) {
        response.inviteCode = issuedInviteCode
        if (response.room?.isHost) response.room.inviteCode = issuedInviteCode
      }
      return { response, claim }
    })
    if (transactionResult.error) throw new RaidError(transactionResult.error.code, transactionResult.error.message, transactionResult.error.status)
    return transactionResult.claim ? (await resolveClaim(transactionResult.claim, identity, timestamp) ?? transactionResult.response) : transactionResult.response
  }

  return {
    execute,
    deleteGuestAccount: identity => eraseGuestRaidData({ store, now }, identity),
  }
}

// Called from the existing single guest-cleanup transaction.  It deliberately
// uses no guest-registry operation: the outer cleanup has already fenced the
// anonymous identity, and this function must not reopen it.
export async function eraseGuestRaidData({ store, now = Date.now } = {}, identity, suppliedTx = null) {
  if (identity?.isGuest !== true || !isId(identity.uid)) throw new RaidError('GUEST_ONLY', '게스트 계정만 삭제할 수 있습니다.', 403)
  const uid = identity.uid
  const timestamp = now()
  // Generate once before a Firestore/Postgres transaction callback.  Those
  // adapters may replay the callback after a contention retry.
  const surrogate = `deleted_${randomUUID().replaceAll('-', '')}`
  const clean = async tx => {
    const rooms = await tx.list('raidRooms')
    for (const room of rooms) {
      const member = room.members?.find(entry => entry.uid === uid)
      if (!member) continue
      if (room.status === 'waiting') {
        room.members = room.members.filter(entry => entry.uid !== uid)
        if (!room.members.length) {
          tx.delete('raidRooms', room.id)
          tx.delete('raidRoomIndex', room.id)
        }
        else {
          if (room.hostUid === uid) {
            const host = room.members.slice().sort((a, b) => a.joinedAt - b.joinedAt || a.uid.localeCompare(b.uid))[0]
            Object.assign(room, { hostUid: host.uid, hostName: host.name, hostNickname: host.nickname, hostIsGuest: host.isGuest === true })
          }
          room.roomRevision = (room.roomRevision ?? 0) + 1
          tx.set('raidRooms', room.id, room)
          tx.set('raidRoomIndex', room.id, raidRoomIndex(room))
        }
      } else {
        member.uid = surrogate
        member.name = '탈퇴한 게스트'
        member.nickname = ''
        member.isGuest = false
        member.withdrawn = true
        member.pokemon = null
        if (room.hostUid === uid) {
          const successor = room.members.find(entry => entry.uid !== surrogate && !entry.withdrawn && !entry.isNpc)
          if (successor) Object.assign(room, { hostUid: successor.uid, hostName: successor.name, hostNickname: successor.nickname, hostIsGuest: successor.isGuest === true })
          else Object.assign(room, { hostUid: surrogate, hostName: '탈퇴한 게스트', hostNickname: '', hostIsGuest: false })
        }
        room.roomRevision = (room.roomRevision ?? 0) + 1
        tx.set('raidRooms', room.id, room)
        tx.delete('raidRoomIndex', room.id)
      }
    }
    const runs = await tx.list('raidRuns')
    for (const run of runs) {
      const participant = run.participants?.find(entry => entry.ownerId === uid)
      if (!participant) continue
      assertSupportedRaidRun(run)
      participant.ownerId = surrogate
      participant.displayName = '탈퇴한 게스트'
      participant.pokemon = null
      participant.withdrawn = true
      participant.isNpc = true
      if (run.commands) delete run.commands[uid]
      if (run.commandVersions) delete run.commandVersions[uid]
      if (run.resolution?.commands) delete run.resolution.commands[uid]
      if (run.resolution) {
        // A resolver may have read the old owner before deletion.  Clear its
        // lease so its compare-and-commit guard cannot reintroduce the UID.
        run.resolution = null
        if (run.lifecycle === 'resolving') {
          run.lifecycle = 'input'
          run.deadlineAt = timestamp
        }
      }
      for (const actor of run.battle?.player?.team ?? []) {
        if (actor.raidOwnerId !== uid) continue
        actor.raidOwnerId = surrogate
        actor.raidDisplayName = '탈퇴한 게스트'
        actor.raidNpc = true
      }
      for (const member of run.battle?.raid?.members ?? []) {
        if (member.ownerId !== uid) continue
        member.ownerId = surrogate
        member.displayName = '탈퇴한 게스트'
        member.isNpc = true
        member.pokemon = null
      }
      if (run.result?.participants) {
        run.result.participants = run.result.participants.map(row => row.ownerId === uid
          ? { ...row, ownerId: surrogate, rewardVp: 0, firstClearVp: 0 } : row)
      }
      if (run.result?.rewards) {
        run.result.rewards = run.result.rewards.map(row => row.uid === uid
          ? { ...row, uid: surrogate, totalVp: 0, firstClear: false } : row)
      }
      // The battle snapshot has to remain usable for other players.  Its
      // public projection masks names; selected-team data is removed above and
      // the departed actor is driven as an AI slot by the raid engine.
      run.updatedAt = timestamp
      run.revision = (run.revision ?? 0) + 1
      tx.set('raidRuns', run.id, run)
      const head = raidRunHead(run)
      if (head) tx.set('raidRunHeads', run.id, head)
    }
    for (const receipt of await tx.list('raidRewardReceipts')) if (receipt.uid === uid) tx.delete('raidRewardReceipts', receipt.id)
    for (const clear of await tx.list('raidFirstClears')) if (clear.uid === uid) tx.delete('raidFirstClears', clear.id)
    for (const result of await tx.list('raidResults')) if (result.uid === uid) tx.delete('raidResults', result.id)
    tx.delete('raidPlayers', uid)
    return { deleted: true }
  }
  return suppliedTx ? clean(suppliedTx) : store.transaction(clean)
}
