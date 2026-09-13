import { createHash, randomInt } from 'node:crypto'

const PROFILE_COLLECTION = 'guestProfiles'
const NAME_COLLECTION = 'guestNames'
export const GUEST_NAME_ATTEMPTS = 32
const uidKey = uid => createHash('sha256').update(`guest-owner:${uid}`).digest('hex')
const isGuestName = value => typeof value === 'string' && /^guest-\d{6}$/.test(value)
const fail = (code, message, status = 503) => { throw Object.assign(new Error(message), { code, status }) }

// Call only after Firebase Admin verifies the token. Client request fields and
// Firebase's editable displayName are never evidence of an anonymous identity.
export function rankedIdentityFromVerifiedToken(verified) {
  const isGuest = verified?.firebase?.sign_in_provider === 'anonymous'
  return { uid: verified?.uid, name: isGuest ? '' : verified?.name || '트레이너', isGuest }
}

function requireGuest(identity) {
  if (identity?.isGuest !== true) fail('GUEST_ONLY', '게스트 계정으로 접속해주세요.', 403)
  if (typeof identity.uid !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(identity.uid)) {
    fail('UNAUTHENTICATED', '로그인이 필요합니다.', 401)
  }
}

function publicProfile(profile, uid) {
  if (profile?.deleted === true || profile?.deleting === true) fail('GUEST_ACCOUNT_DELETED', '로그아웃으로 삭제된 게스트입니다. 새 게스트로 접속해주세요.', 410)
  if (profile?.version !== 1 || profile.uid !== uid || !isGuestName(profile.displayName)
    || !Number.isSafeInteger(profile.createdAt) || profile.createdAt < 0) {
    fail('GUEST_PROFILE_INVALID', '게스트 계정 정보를 불러오지 못했습니다. 잠시 후 다시 접속해주세요.')
  }
  return { uid, displayName: profile.displayName, isGuest: true }
}

export function createGuestIdentityRegistry({ store, now = Date.now, chooseNumber = () => randomInt(1_000_000) }) {
  async function readFromTransaction(tx, identity) {
    requireGuest(identity)
    const profile = await tx.get(PROFILE_COLLECTION, uidKey(identity.uid))
    if (!profile) fail('GUEST_PROFILE_REQUIRED', '게스트 계정을 준비한 뒤 다시 시도해주세요.', 409)
    return publicProfile(profile, identity.uid)
  }
  return {
    async read(identity, tx) {
      return tx ? readFromTransaction(tx, identity) : store.transaction(view => readFromTransaction(view, identity))
    },
    async beginDeletion(identity) {
      requireGuest(identity)
      return store.transaction(async tx => {
        const owner = uidKey(identity.uid)
        const profile = await tx.get(PROFILE_COLLECTION, owner)
        if (profile?.deleted || profile?.deleting) return
        // Persist the fence before the larger cleanup transaction. If that
        // cleanup rolls back, subsequent ranked requests still cannot write.
        tx.set(PROFILE_COLLECTION, owner, { ...profile, deleting: true })
      })
    },
    async erase(identity, tx) {
      requireGuest(identity)
      const owner = uidKey(identity.uid)
      const profile = await tx.get(PROFILE_COLLECTION, owner)
      if (profile?.deleted === true) return
      if (profile?.uid === identity.uid && isGuestName(profile.displayName)) {
        const number = profile.displayName.slice(-6)
        const reservation = await tx.get(NAME_COLLECTION, number)
        if (reservation?.owner === owner) tx.delete(NAME_COLLECTION, number)
      }
      // Keep only an irreversible, hashed security fence. No UID, nickname,
      // game data or session secret remains, and stale tokens cannot recreate it.
      tx.set(PROFILE_COLLECTION, owner, { deleted: true, deletedAt: now() })
    },
    async create(identity) {
      requireGuest(identity)
      const owner = uidKey(identity.uid)
      const createdAt = now()
      if (!Number.isSafeInteger(createdAt) || createdAt < 0 || createdAt > 8_640_000_000_000_000) {
        fail('GUEST_PROFILE_INVALID', '게스트 계정을 준비하지 못했습니다. 잠시 후 다시 시도해주세요.')
      }
      // Generate bounded candidates before the transaction, so Firestore's
      // retries replay the same choices. Reservations are released only by an
      // authenticated guest account deletion, never by clearing browser data.
      const candidates = [...new Set(Array.from({ length: GUEST_NAME_ATTEMPTS }, () => {
        const number = chooseNumber()
        if (!Number.isInteger(number) || number < 0 || number >= 1_000_000) {
          fail('GUEST_PROFILE_INVALID', '게스트 이름을 준비하지 못했습니다. 잠시 후 다시 시도해주세요.')
        }
        return String(number).padStart(6, '0')
      }))]
      return store.transaction(async tx => {
        const previous = await tx.get(PROFILE_COLLECTION, owner)
        if (previous) return publicProfile(previous, identity.uid)
        for (const number of candidates) {
          if (await tx.get(NAME_COLLECTION, number)) continue
          const profile = { version: 1, uid: identity.uid, displayName: `guest-${number}`, createdAt }
          tx.set(NAME_COLLECTION, number, { version: 1, owner, createdAt })
          tx.set(PROFILE_COLLECTION, owner, profile)
          return publicProfile(profile, identity.uid)
        }
        fail('GUEST_NAMES_BUSY', '게스트 이름을 준비 중입니다. 잠시 후 다시 시도해주세요.')
      })
    },
  }
}
