import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import { firebaseDb } from './firebaseClient'

export async function ensurePlayerProfile(user) {
  if (!firebaseDb || !user) return

  const profileReference = doc(firebaseDb, 'players', user.uid)
  const profileSnapshot = await getDoc(profileReference)
  const providerIds = [...new Set(user.providerData.map((provider) => provider.providerId).filter(Boolean))]

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
