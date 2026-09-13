import { deleteDoc, doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import { firebaseDb } from './firebaseClient'
import { createPlayerAccountClient, deletePlayerGameData, requireAccountSessionOwner } from './playerGameData'
import { isServerGameStorage } from './gameStorageConfig.js'

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
