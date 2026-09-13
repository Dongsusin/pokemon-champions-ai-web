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
  if (profile?.version !== 1 || profile.uid !== uid || !isGuestName(profile.displayName)
    || !Number.isSafeInteger(profile.createdAt) || profile.createdAt < 0) {
    fail('GUEST_PROFILE_INVALID', '게스트 계정 정보를 불러오지 못했습니다. 잠시 후 다시 접속해주세요.')
  }
  return { uid, displayName: profile.displayName, isGuest: true }
}

export function createGuestIdentityRegistry({ store, now = Date.now, chooseNumber = () => randomInt(1_000_000) }) {
  return {
    async read(identity) {
      requireGuest(identity)
      return store.transaction(async tx => {
        const profile = await tx.get(PROFILE_COLLECTION, uidKey(identity.uid))
        if (!profile) fail('GUEST_PROFILE_REQUIRED', '게스트 계정을 준비한 뒤 다시 시도해주세요.', 409)
        return publicProfile(profile, identity.uid)
      })
    },
    async create(identity) {
      requireGuest(identity)
      const owner = uidKey(identity.uid)
      const createdAt = now()
      if (!Number.isSafeInteger(createdAt) || createdAt < 0 || createdAt > 8_640_000_000_000_000) {
        fail('GUEST_PROFILE_INVALID', '게스트 계정을 준비하지 못했습니다. 잠시 후 다시 시도해주세요.')
      }
      // Generate bounded candidates before the transaction, so Firestore's
      // retries replay the same choices. A reservation is never overwritten or
      // released, even after an account is deleted or its browser data cleared.
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
