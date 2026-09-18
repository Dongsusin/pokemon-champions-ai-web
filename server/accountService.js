import { createHash, randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { PLAYER_STORAGE_KEYS } from '../src/auth/accountStorage.js'
import { normalizeTrainerNickname, readTrainerNickname } from '../src/data/trainerNickname.js'
import { hasTrainerTitle, normalizeTrainerTitle, readTrainerTitle } from '../src/data/titleData.js'
import { ACHIEVEMENT_STORAGE_KEY } from '../src/data/achievementData.js'
import { containsChatProfanity } from './chatModeration.js'

export const ACCOUNT_LEASE_MS = 90_000
export const ACCOUNT_PAYLOAD_MAX_BYTES = 2 * 1024 * 1024
export const ONLINE_PLAYERS_CACHE_MS = 15_000
export const ONLINE_PLAYERS_STALE_MS = 60_000
const keys = new Set(PLAYER_STORAGE_KEYS)
const clone = value => structuredClone(value)
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value)
const validOwner = value => validId(value) && value.length >= 16
const validVersion = value => typeof value === 'string' && /^[a-zA-Z0-9_:-]{8,128}$/.test(value)
const plain = value => value && typeof value === 'object' && !Array.isArray(value)
const guestDeletionKey = uid => createHash('sha256').update(`guest-delete:${uid}`).digest('hex')
export class AccountError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status }
}
const fail = (code, message, status) => { throw new AccountError(code, message, status) }
const text = (value, max) => typeof value === 'string' ? value.replace(/[\p{Cc}\p{Cs}\p{Bidi_Control}]/gu, '').slice(0, max) : null

export function validateAccountPayload(payload) {
  if (!plain(payload)) fail('INVALID_SAVE', '저장할 게임 데이터가 올바르지 않습니다.')
  if (Object.entries(payload).some(([key, value]) => !keys.has(key) || typeof value !== 'string')) {
    fail('INVALID_SAVE', '허용되지 않은 게임 저장 항목입니다.')
  }
  if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > ACCOUNT_PAYLOAD_MAX_BYTES) {
    fail('SAVE_TOO_LARGE', '게임 저장 데이터가 허용 크기를 넘었습니다.', 413)
  }
  return clone(payload)
}

export function createAccountService({ store, guestRegistry, deleteGuestData, now = Date.now, newVersion = randomUUID }) {
  let onlineSample = null, pendingCount = null, lastCountAttemptAt = null
  const usableSample = timestamp => Number.isSafeInteger(timestamp) && onlineSample && timestamp >= onlineSample.sampledAt
    && timestamp - onlineSample.sampledAt < ONLINE_PLAYERS_STALE_MS
    ? { ...onlineSample, staleAfterMs: ONLINE_PLAYERS_STALE_MS - (timestamp - onlineSample.sampledAt) } : undefined
  async function readOnlinePlayers() {
    if (typeof store.countActiveSessions !== 'function') return undefined
    const timestamp = now()
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) return undefined
    if (pendingCount) return pendingCount
    if (lastCountAttemptAt !== null && timestamp >= lastCountAttemptAt
      && timestamp - lastCountAttemptAt < ONLINE_PLAYERS_CACHE_MS) return usableSample(timestamp)
    lastCountAttemptAt = timestamp
    pendingCount = (async () => {
      try {
        const count = await store.countActiveSessions(timestamp)
        if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid online player count')
        onlineSample = { count, sampledAt: timestamp }
      } catch {
        // Presence is optional. An aggregate outage must never invalidate a
        // login or a lease that has already been renewed successfully.
      }
      return usableSample(now())
    })()
    try { return await pendingCount } finally { pendingCount = null }
  }
  async function requireActive(tx, uid, ownerId) {
    const session = await tx.get('sessions', uid)
    if (!session || session.ownerId !== ownerId || session.expiresAt <= now()) {
      fail('account-session/lost', '이 창의 로그인 세션이 만료됐습니다. 다시 접속해주세요.', 409)
    }
    return session
  }
  const sessionView = session => ({ ownerId: session.ownerId, version: session.version, leaseMs: ACCOUNT_LEASE_MS, expiresAt: session.expiresAt })
  return {
    async execute(identity, command) {
      if (!identity || !validId(identity.uid)) fail('UNAUTHENTICATED', '로그인이 필요합니다.', 401)
      if (!plain(command) || !validOwner(command.ownerId)) fail('INVALID_SESSION_OWNER', '이 창의 세션 식별자가 올바르지 않습니다.')
      const { action, ownerId } = command
      if (!['sessionAcquire', 'sessionHeartbeat', 'sessionRelease', 'load', 'save', 'ensureProfile', 'setNickname', 'setTitle', 'deleteGameData', 'deleteProfile', 'deleteGuestAccount'].includes(action)) {
        fail('UNKNOWN_ACTION', '지원하지 않는 계정 요청입니다.')
      }
      if (action === 'sessionHeartbeat' || action === 'sessionRelease') {
        if (!validVersion(command.version)) fail('INVALID_SESSION_VERSION', '세션 버전이 올바르지 않습니다.')
      }
      if (action === 'save' && !validVersion(command.revision)) fail('INVALID_SAVE_REVISION', '저장 버전이 올바르지 않습니다.')
      if (action === 'save' && (!Number.isSafeInteger(command.saveSequence) || command.saveSequence < 1)) fail('INVALID_SAVE_SEQUENCE', '저장 순서가 올바르지 않습니다.')
      if (action === 'deleteGuestAccount') {
        if (identity.isGuest !== true) fail('GUEST_ONLY', '게스트 계정만 이 방식으로 삭제할 수 있습니다.', 403)
        if (typeof deleteGuestData !== 'function') fail('GUEST_DELETE_UNAVAILABLE', '게스트 삭제 서버를 준비하지 못했습니다. 다시 시도해주세요.', 503)
        const key = guestDeletionKey(identity.uid)
        const alreadyDeleted = await store.transaction(async tx => {
          const marker = await tx.get('guestDeletions', key)
          if (marker) return marker.status === 'deleted'
          const session = await requireActive(tx, identity.uid, ownerId)
          if (!validVersion(command.version) || session.version !== command.version) {
            fail('account-session/lost', '로그인 세션 상태가 바뀌었습니다. 최신 세션에서 다시 시도해주세요.', 409)
          }
          tx.set('guestDeletions', key, { status: 'deleting', deletedAt: now() })
          return false
        })
        if (!alreadyDeleted) {
          // The fence survives a failure between the two storage namespaces.
          // Retrying the same authenticated UID resumes cleanup without a lease.
          await deleteGuestData(identity)
          await store.transaction(async tx => {
            await tx.get('guestDeletions', key)
            for (const collection of ['gameData', 'profiles', 'sessions']) tx.delete(collection, identity.uid)
            tx.set('guestDeletions', key, { status: 'deleted', deletedAt: now() })
          })
        }
        return { deleted: true, uid: identity.uid }
      }
      const payload = action === 'save' ? validateAccountPayload(command.payload) : null
      let nickname
      if (action === 'setNickname') {
        if (identity.isGuest === true || identity.isLocalGuest === true
          || !identity.accountProfile?.providerIds?.includes('google.com')) {
          fail('NICKNAME_GOOGLE_ONLY', '닉네임은 Google 계정으로 로그인한 트레이너만 설정할 수 있습니다.', 403)
        }
        try { nickname = normalizeTrainerNickname(command.nickname) }
        catch (error) { fail('INVALID_NICKNAME', error.message) }
        if (containsChatProfanity(nickname)) fail('NICKNAME_PROFANITY', '욕설이나 비속어가 포함된 닉네임은 사용할 수 없습니다.', 422)
      }
      let titleId
      if (action === 'setTitle') {
        if (identity.isGuest === true || identity.isLocalGuest === true
          || !identity.accountProfile?.providerIds?.includes('google.com')) {
          fail('TITLE_GOOGLE_ONLY', '칭호는 Google 계정으로 로그인한 트레이너만 설정할 수 있습니다.', 403)
        }
        try { titleId = normalizeTrainerTitle(command.title) }
        catch (error) { fail('INVALID_TITLE', error.message) }
      }
      let metadata
      if (action === 'ensureProfile' || action === 'setNickname' || action === 'setTitle') {
        const guest = identity.isGuest === true ? await guestRegistry.read(identity) : null
        const source = identity.accountProfile ?? {}
        const photoURL = text(source.photoURL, 2048)
        metadata = {
          uid: identity.uid,
          email: identity.isGuest ? null : text(source.email, 320),
          displayName: guest?.displayName ?? text(source.displayName ?? identity.name, 256),
          photoURL: !identity.isGuest && photoURL?.startsWith('https://') ? photoURL : null,
          providerIds: identity.isGuest ? ['anonymous'] : (source.providerIds ?? []).filter(value => typeof value === 'string' && /^[a-zA-Z0-9.-]{1,64}$/.test(value)).slice(0, 8),
          isGuest: identity.isGuest === true,
        }
      }
      // Versions belong to this request; transaction retries cannot resurrect
      // a stale release or generate a different lease for the same attempt.
      const version = action === 'sessionAcquire' || action === 'sessionHeartbeat' ? newVersion() : null
      const result = await store.transaction(async tx => {
        const uid = identity.uid
        const timestamp = now()
        if (identity.isGuest === true && await tx.get('guestDeletions', guestDeletionKey(uid))) {
          fail('GUEST_ACCOUNT_DELETED', '삭제가 진행된 게스트입니다. 로그아웃을 다시 시도해주세요.', 410)
        }
        if (action === 'sessionAcquire') {
          const previous = await tx.get('sessions', uid)
          if (previous && previous.expiresAt > timestamp) {
            if (previous.ownerId !== ownerId) fail('account-session/occupied', '다른 창이나 기기에서 이미 로그인 중입니다.', 409)
            return sessionView(previous)
          }
          const session = { ownerId, version, expiresAt: timestamp + ACCOUNT_LEASE_MS, lastSaveSequence: 0 }
          tx.set('sessions', uid, session)
          return sessionView(session)
        }
        if (action === 'sessionRelease') {
          const previous = await tx.get('sessions', uid)
          if (!previous || previous.ownerId !== ownerId || previous.version !== command.version) return { released: false }
          tx.delete('sessions', uid)
          return { released: true }
        }
        const session = await requireActive(tx, uid, ownerId)
        if (action === 'sessionHeartbeat') {
          if (session.version !== command.version) fail('account-session/lost', '로그인 세션 상태가 바뀌었습니다. 다시 접속해주세요.', 409)
          const next = { ...session, ownerId, version, expiresAt: now() + ACCOUNT_LEASE_MS }
          tx.set('sessions', uid, next)
          return sessionView(next)
        }
        if (action === 'load') {
          const saved = await tx.get('gameData', uid)
          return { gameData: saved ? { schemaVersion: saved.schemaVersion, revision: saved.revision, updatedAtMs: saved.updatedAtMs, payload: clone(saved.payload) } : null }
        }
        if (action === 'save') {
          const previous = typeof tx.compareGameData === 'function'
            ? await tx.compareGameData(uid, payload)
            : await tx.get('gameData', uid).then(saved => saved ? { revision: saved.revision, payloadMatches: isDeepStrictEqual(saved.payload, payload) } : null)
          const lastSequence = Number.isSafeInteger(session.lastSaveSequence) ? session.lastSaveSequence : 0
          const sameSave = previous?.revision === command.revision && previous.payloadMatches
          if (command.saveSequence < lastSequence || (command.saveSequence === lastSequence && !sameSave)) {
            fail('STALE_SAVE', '더 최신 게임 데이터가 이미 저장됐습니다.', 409)
          }
          if (previous?.revision === command.revision) {
            if (!previous.payloadMatches) fail('SAVE_REVISION_REUSED', '이미 사용된 저장 버전입니다.', 409)
            if (command.saveSequence > lastSequence) tx.set('sessions', uid, { ...session, lastSaveSequence: command.saveSequence })
            return { revision: command.revision }
          }
          tx.set('sessions', uid, { ...session, lastSaveSequence: command.saveSequence })
          tx.set('gameData', uid, { schemaVersion: 1, revision: command.revision, updatedAtMs: now(), payload })
          return { revision: command.revision }
        }
        if (action === 'ensureProfile' || action === 'setNickname' || action === 'setTitle') {
          const previous = await tx.get('profiles', uid)
          const previousNickname = readTrainerNickname(previous?.nickname)
          // A title is a claim about this account's achievements, so it is
          // checked against the saved achievement record rather than trusted
          // from the request. Clearing one ('') always works.
          if (action === 'setTitle' && titleId) {
            const saved = await tx.get('gameData', uid)
            let progress = null
            try { progress = JSON.parse(saved?.payload?.[ACHIEVEMENT_STORAGE_KEY] ?? 'null') } catch { progress = null }
            if (!hasTrainerTitle(progress, titleId)) {
              fail('TITLE_NOT_EARNED', '아직 획득하지 않은 칭호입니다.', 403)
            }
          }
          const previousTitle = readTrainerTitle(previous?.title)
          const profile = { ...metadata,
            ...(!identity.isGuest ? {
              nickname: action === 'setNickname' ? nickname : containsChatProfanity(previousNickname) ? '' : previousNickname,
              title: action === 'setTitle' ? titleId : previousTitle,
            } : {}),
            createdAtMs: Number.isSafeInteger(previous?.createdAtMs) ? previous.createdAtMs : now(), lastSeenAtMs: now(),
          }
          if (!isDeepStrictEqual(previous, profile)) tx.set('profiles', uid, profile)
          return { profile }
        }
        tx.delete(action === 'deleteGameData' ? 'gameData' : 'profiles', uid)
        return { deleted: true }
      })
      if (action !== 'sessionAcquire' && action !== 'sessionHeartbeat') return result
      // Count only after COMMIT. Aggregating all leases inside a SERIALIZABLE
      // renewal would create conflicts between otherwise independent players.
      const onlinePlayers = await readOnlinePlayers()
      return onlinePlayers ? { ...result, onlinePlayers } : result
    },
  }
}

export function createAccountRankedTeamResolver(accountStore) {
  return async (identity, entries) => {
    if (!Array.isArray(entries) || entries.length !== 6) fail('INVALID_TEAM', '등록할 포켓몬 6마리를 선택해주세요.')
    const saved = await accountStore.transaction(tx => tx.get('gameData', identity.uid))
    let owned, inventory
    try {
      if (!saved?.revision || !plain(saved.payload)) throw new Error('Missing account save')
      owned = JSON.parse(saved.payload['champions-dex-v2'] ?? saved.payload['champions-box-v1'] ?? '[]')
      inventory = JSON.parse(saved.payload['champions-battle-items-v1'] ?? '{}')
    } catch { fail('ACCOUNT_SYNC_REQUIRED', '보유 포켓몬 정보를 서버에 동기화한 뒤 다시 시도해주세요.', 409) }
    if (!Array.isArray(owned) || !plain(inventory)) fail('ACCOUNT_SYNC_REQUIRED', '보유 포켓몬 정보를 먼저 동기화해주세요.', 409)
    return entries.map(entry => {
      const pokemon = owned.find(candidate => plain(candidate) && candidate.captureId === entry?.captureId)
      if (!pokemon) fail('POKEMON_NOT_OWNED', '서버에 저장된 보유 포켓몬만 레이팅에 등록할 수 있습니다.', 403)
      if (pokemon.heldItemId && !(Number(inventory[pokemon.heldItemId]) > 0)) fail('ITEM_NOT_OWNED', '보유 도구 정보를 동기화한 뒤 다시 시도해주세요.', 409)
      return clone(pokemon)
    })
  }
}
