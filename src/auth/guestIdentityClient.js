import { createRankedClient } from '../rankedClient.js'
import { createAccountApiClient } from './accountApiClient.js'

export async function deleteGuestAccount(firebaseUser, lease, options = {}) {
  if (!firebaseUser?.uid || firebaseUser.isAnonymous !== true || typeof firebaseUser.getIdToken !== 'function'
    || !lease?.ownerId || !lease?.version) {
    throw Object.assign(new Error('삭제할 게스트의 인증과 접속 상태를 확인하지 못했습니다.'), { code: 'guest/invalid-user' })
  }
  const client = createAccountApiClient({ ...options, getIdToken: firebaseUser.getIdToken.bind(firebaseUser) })
  const result = await client.request('deleteGuestAccount', { ownerId: lease.ownerId, version: lease.version })
  if (result.deleted !== true || result.uid !== firebaseUser.uid) {
    throw Object.assign(new Error('게스트 정보 삭제 결과를 확인하지 못했습니다. 다시 시도해주세요.'), { code: 'guest/invalid-deletion' })
  }
  return result
}

// A guest nickname is reserved atomically by the server. Never derive it from a
// browser random number, Firebase displayName, or a remembered local nickname.
export async function resolveGuestIdentity(firebaseUser, options = {}) {
  if (!firebaseUser?.uid || !firebaseUser.isAnonymous || typeof firebaseUser.getIdToken !== 'function') {
    throw Object.assign(new Error('게스트 인증을 확인하지 못했습니다.'), { code: 'guest/invalid-user' })
  }
  const getIdToken = firebaseUser.getIdToken.bind(firebaseUser)
  const client = createRankedClient({ ...options, getIdToken })
  const profile = await client.request('guestProfile')
  if (profile.uid !== firebaseUser.uid || profile.isGuest !== true
    || !/^guest-\d{6}$/.test(profile.displayName)) {
    throw Object.assign(new Error('게스트 이름을 확인하지 못했습니다. 다시 로그인해주세요.'), { code: 'guest/invalid-profile' })
  }
  return {
    uid: firebaseUser.uid,
    displayName: profile.displayName,
    email: null,
    photoURL: null,
    isAnonymous: true,
    isGuest: true,
    isLocalGuest: false,
    providerData: firebaseUser.providerData ?? [],
    auth: firebaseUser.auth,
    getIdToken,
  }
}
