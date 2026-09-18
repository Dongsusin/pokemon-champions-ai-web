import { deleteDoc, doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import { firebaseDb } from './firebaseClient'
import { createPlayerAccountClient, deletePlayerGameData, requireAccountSessionOwner } from './playerGameData'
import { isServerGameStorage } from './gameStorageConfig.js'
import { normalizeTrainerNickname, readTrainerNickname } from '../data/trainerNickname.js'
import { normalizeTrainerTitle, readTrainerTitle } from '../data/titleData.js'

export function withPlayerNickname(user, profile) {
  // Keep Firebase's original identity separate from the game's public nickname.
  // Bind token access to the original SDK user, including after a profile update.
  return {
    ...user,
    nickname: !user?.isAnonymous && !user?.isLocalGuest && profile?.uid === user?.uid
      ? readTrainerNickname(profile.nickname) : '',
    title: !user?.isAnonymous && !user?.isLocalGuest && profile?.uid === user?.uid
      ? readTrainerTitle(profile.title) : '',
    ...(typeof user?.getIdToken === 'function' ? { getIdToken: user.getIdToken.bind(user) } : {}),
  }
}

export async function setPlayerNickname(user, value) {
  if (!user?.uid || user.isAnonymous || user.isLocalGuest) {
    throw new Error('게스트는 현재 이름을 그대로 사용합니다.')
  }
  if (!isServerGameStorage) throw new Error('닉네임을 저장할 계정 서버에 연결되지 않았습니다.')
  const nickname = normalizeTrainerNickname(value)
  const ownerId = requireAccountSessionOwner(user.uid)
  const result = await createPlayerAccountClient(user.uid).request('setNickname', { ownerId, nickname })
  if (result?.profile?.uid !== user.uid || result.profile.nickname !== nickname) {
    throw new Error('닉네임 저장 결과를 확인하지 못했습니다. 다시 시도해주세요.')
  }
  return result
}

export async function setPlayerTitle(user, value) {
  if (!user?.uid || user.isAnonymous || user.isLocalGuest) {
    throw new Error('게스트는 칭호를 설정할 수 없습니다.')
  }
  if (!isServerGameStorage) throw new Error('칭호를 저장할 계정 서버에 연결되지 않았습니다.')
  const title = normalizeTrainerTitle(value)
  const ownerId = requireAccountSessionOwner(user.uid)
  const result = await createPlayerAccountClient(user.uid).request('setTitle', { ownerId, title })
  if (result?.profile?.uid !== user.uid || readTrainerTitle(result.profile.title) !== title) {
    throw new Error('칭호 저장 결과를 확인하지 못했습니다. 다시 시도해주세요.')
  }
  return result
}

export async function ensurePlayerProfile(user) {
  if (isServerGameStorage) {
    const ownerId = requireAccountSessionOwner(user?.uid)
    return createPlayerAccountClient(user?.uid).request('ensureProfile', { ownerId })
  }
  if (!firebaseDb || !user) return

  const profileReference = doc(firebaseDb, 'players', user.uid)
  const profileSnapshot = await getDoc(profileReference)
  const providerIds = [...new Set((user.providerData ?? []).map((provider) => provider.providerId).filter(Boolean))]

  await setDoc(profileReference, {
    uid: user.uid,
    email: user.email ?? null,
    displayName: user.displayName ?? null,
    photoURL: user.photoURL ?? null,
    providerIds,
    lastSeenAt: serverTimestamp(),
    ...(!profileSnapshot.exists() ? { createdAt: serverTimestamp() } : {}),
  }, { merge: true })
  return { profile: { uid: user.uid, nickname: readTrainerNickname(profileSnapshot.data()?.nickname), title: readTrainerTitle(profileSnapshot.data()?.title) } }
}

export async function deletePlayerProfile(user) {
  if (isServerGameStorage) {
    const ownerId = requireAccountSessionOwner(user?.uid)
    const client = createPlayerAccountClient(user?.uid)
    await deletePlayerGameData(user.uid)
    await client.request('deleteProfile', { ownerId })
    return
  }
  if (!firebaseDb || !user) return
  await deletePlayerGameData(user.uid)
  await deleteDoc(doc(firebaseDb, 'players', user.uid))
}
