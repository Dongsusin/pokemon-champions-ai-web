import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  GoogleAuthProvider,
  browserLocalPersistence,
  browserSessionPersistence,
  deleteUser,
  linkWithPopup,
  onAuthStateChanged,
  reauthenticateWithPopup,
  setPersistence,
  signInAnonymously,
  signInWithCredential,
  signInWithPopup,
  signOut as firebaseSignOut,
} from 'firebase/auth'
import {
  firebaseAuth,
  isFirebaseConfigured,
  missingFirebaseEnvironmentVariables,
} from './firebaseClient'
import {
  clearLocalPlayerData,
  backupGuestPlayerData,
  clearPendingGoogleMigration,
  markPendingGoogleMigration,
  readPlayerSyncState,
  clearGuestPlayerData,
  readGuestDeletion,
  writeGuestDeletion,
  clearGuestDeletion,
  clearCompletedGuestDeletions,
} from './accountStorage'
import { resolveGuestIdentity, deleteGuestAccount } from './guestIdentityClient'
import { deletePlayerProfile, ensurePlayerProfile, setPlayerNickname, setPlayerTitle, withPlayerNickname } from './playerProfile'
import { acquireAccountSession, ACCOUNT_SESSION_ERROR_CODES } from './accountSession'

const AuthContext = createContext(null)

export const AUTH_AUTO_LOGIN_STORAGE_KEY = 'champions-auto-login-v1'
export const LOCAL_GUEST_STORAGE_KEY = 'champions-local-guest-v1'

const AUTH_ERROR_MESSAGES = {
  'auth/account-exists-with-different-credential': '같은 이메일로 연결된 다른 로그인 방식이 있습니다.',
  'auth/cancelled-popup-request': 'Google 로그인 요청이 취소되었습니다.',
  'auth/network-request-failed': '네트워크 연결을 확인한 뒤 다시 시도해주세요.',
  'auth/operation-not-allowed': '현재 로그인 서비스를 사용할 수 없습니다. 잠시 후 다시 시도해주세요.',
  'auth/popup-blocked': '브라우저에서 로그인 팝업이 차단되었습니다.',
  'auth/popup-closed-by-user': 'Google 로그인 창이 닫혔습니다.',
  'auth/too-many-requests': '로그인 요청이 너무 많습니다. 잠시 뒤 다시 시도해주세요.',
  'auth/unauthorized-domain': '현재 도메인이 Firebase 승인 도메인에 등록되지 않았습니다.',
}

function loadAutoLoginPreference() {
  if (typeof window === 'undefined') return true
  try {
    return window.localStorage.getItem(AUTH_AUTO_LOGIN_STORAGE_KEY) !== 'false'
  } catch {
    return true
  }
}

function saveAutoLoginPreference(enabled) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(AUTH_AUTO_LOGIN_STORAGE_KEY, String(enabled))
  } catch {}
}

function authPersistence(enabled) {
  return enabled ? browserLocalPersistence : browserSessionPersistence
}

function normalizeLocalGuest(value) {
  if (!value || value.version !== 1 || typeof value.uid !== 'string') return null
  return {
    uid: value.uid,
    displayName: value.displayName || '게스트 트레이너',
    email: null,
    photoURL: null,
    isAnonymous: false,
    isLocalGuest: true,
    providerData: [{ providerId: 'local-guest' }],
  }
}

function readLocalGuest(autoLogin) {
  if (typeof window === 'undefined') return null
  try {
    const storage = autoLogin ? window.localStorage : window.sessionStorage
    const value = storage.getItem(LOCAL_GUEST_STORAGE_KEY)
    return value ? normalizeLocalGuest(JSON.parse(value)) : null
  } catch {
    return null
  }
}

function clearLocalGuest() {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(LOCAL_GUEST_STORAGE_KEY)
  } catch {}
  try {
    window.sessionStorage.removeItem(LOCAL_GUEST_STORAGE_KEY)
  } catch {}
}

function storeLocalGuest(guest, autoLogin) {
  if (typeof window === 'undefined') return
  clearLocalGuest()
  const storage = autoLogin ? window.localStorage : window.sessionStorage
  storage.setItem(LOCAL_GUEST_STORAGE_KEY, JSON.stringify({
    version: 1,
    uid: guest.uid,
    displayName: guest.displayName,
  }))
}

function createLocalGuest() {
  const randomId = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return normalizeLocalGuest({
    version: 1,
    uid: `local-guest-${randomId}`,
    displayName: '게스트 트레이너',
  })
}

function authErrorMessage(error) {
  if (error?.code === ACCOUNT_SESSION_ERROR_CODES.occupied) {
    return '다른 창이나 기기에서 이미 접속 중입니다. 접속 중인 창을 닫거나 로그아웃한 뒤 다시 시도해주세요.'
  }
  if (error?.code === ACCOUNT_SESSION_ERROR_CODES.lost) {
    return '접속 상태를 확인할 수 없어 게임을 일시 중단했습니다. 인터넷 연결을 확인한 뒤 다시 로그인해주세요.'
  }
  if (error?.code === ACCOUNT_SESSION_ERROR_CODES.unavailable) {
    return '접속 상태를 확인하지 못했습니다. 인터넷 연결을 확인한 뒤 잠시 후 다시 시도해주세요.'
  }
  if (error?.code?.startsWith('guest/') || error?.code === 'GUEST_NAMES_EXHAUSTED') return error.message
  return AUTH_ERROR_MESSAGES[error?.code] ?? '로그인 중 오류가 발생했습니다. 연결을 확인한 뒤 다시 시도해주세요.'
}

function accountDeletionErrorMessage(error) {
  if (error?.code === 'auth/user-mismatch') {
    return '현재 로그인된 Google 계정으로 다시 인증해주세요.'
  }
  if (error?.code === 'auth/requires-recent-login') {
    return '보안을 위해 Google 계정 인증이 다시 필요합니다.'
  }
  if (error?.code === 'permission-denied') {
    return '서버 프로필을 삭제할 권한이 없습니다. 잠시 후 다시 시도해주세요.'
  }
  return AUTH_ERROR_MESSAGES[error?.code] ?? '계정을 삭제하지 못했습니다. 잠시 후 다시 시도해주세요.'
}

export function AuthProvider({ children }) {
  const initialAutoLoginRef = useRef(loadAutoLoginPreference())
  const [user, setUser] = useState(null)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [profileSyncError, setProfileSyncError] = useState('')
  const [autoLogin, setAutoLoginState] = useState(initialAutoLoginRef.current)
  const autoLoginRef = useRef(initialAutoLoginRef.current)
  const userRef = useRef(user)
  const candidateRef = useRef(readLocalGuest(initialAutoLoginRef.current))
  const sessionRef = useRef(null)
  const admissionRef = useRef(null)
  const generationRef = useRef(0)
  const cleanupRef = useRef(Promise.resolve())
  const mountedRef = useRef(false)
  const manualAuthRef = useRef(false)
  const logoutPendingRef = useRef(false)
  const deletedGuestAuthRef = useRef(null)
  const nicknamePendingRef = useRef(false)

  const setCurrentUser = useCallback((nextUser) => {
    userRef.current = nextUser
    setUser(nextUser)
  }, [])

  const releaseSession = useCallback(async () => {
    generationRef.current += 1
    const pending = admissionRef.current?.promise
    admissionRef.current = null
    const session = sessionRef.current
    sessionRef.current = null
    setCurrentUser(null)
    // Let a cancelled acquisition clean up before another login can claim its lock.
    cleanupRef.current = Promise.all([cleanupRef.current, session?.handle.release(), pending])
    await cleanupRef.current
  }, [setCurrentUser])

  const finishGuestDeletion = useCallback(async (firebaseUser, { release = true, uid = firebaseUser?.uid } = {}) => {
    const pendingRecord = uid ? readGuestDeletion(uid) : null
    const authDeleted = !firebaseAuth?.currentUser && (deletedGuestAuthRef.current === uid || pendingRecord?.authDeleted === true)
    if (!uid || (!authDeleted && (!firebaseUser?.isAnonymous || firebaseAuth?.currentUser?.uid !== uid || !firebaseAuth.currentUser.isAnonymous))) {
      throw new Error('삭제할 게스트 인증이 변경되었습니다.')
    }
    let pending = pendingRecord
    if (!pending) {
      const lease = await sessionRef.current?.handle.pauseForGuestDeletion()
      if (!lease) throw new Error('게스트 삭제에 필요한 접속 상태가 없습니다.')
      pending = { lease, serverDeleted: false }
      // Persist before dispatch: a lost response must retry deletion, never
      // acquire a new guest profile or upload its former save on next startup.
      writeGuestDeletion(uid, pending)
    }
    if (!pending.serverDeleted) {
      await deleteGuestAccount(firebaseUser, pending.lease, {
        isCurrent: () => firebaseAuth?.currentUser?.uid === firebaseUser.uid && firebaseAuth.currentUser.isAnonymous,
      })
      pending = { ...pending, serverDeleted: true }
      writeGuestDeletion(uid, pending)
    }
    // Keep Firebase credentials until server deletion and local cleanup are
    // confirmed. Failed identity deletion can then retry without losing access.
    clearGuestPlayerData(uid)
    if (!authDeleted) {
      await deleteUser(firebaseUser)
      deletedGuestAuthRef.current = uid
      writeGuestDeletion(uid, { ...pending, authDeleted: true })
    }
    clearGuestDeletion(uid)
    deletedGuestAuthRef.current = null
    candidateRef.current = null
    // Startup recovery runs inside admission itself and has no active handle;
    // waiting for releaseSession there would await this same admission promise.
    if (release) await releaseSession()
  }, [releaseSession])

  const activateUser = useCallback((nextUser) => {
    if (!nextUser) return Promise.resolve(false)
    if (sessionRef.current?.uid === nextUser.uid && userRef.current && sessionRef.current.handle.isActive()) {
      // Linking an anonymous user keeps its UID and lease, but changes its
      // identity. Do not retain the anonymous wrapper after a successful link.
      if (userRef.current.isAnonymous && !nextUser.isAnonymous) {
        candidateRef.current = nextUser
        setCurrentUser(nextUser)
        const generation = generationRef.current
        return ensurePlayerProfile(nextUser).then(result => {
          if (mountedRef.current && generationRef.current === generation && userRef.current?.uid === nextUser.uid) {
            setCurrentUser(withPlayerNickname(nextUser, result?.profile))
          }
          return true
        }).catch(() => {
          if (mountedRef.current && generationRef.current === generation) setProfileSyncError('계정 프로필을 서버와 동기화하지 못했습니다.')
          return true
        })
      }
      return Promise.resolve(true)
    }
    if (admissionRef.current?.uid === nextUser.uid) return admissionRef.current.promise

    const generation = ++generationRef.current
    const previousSession = sessionRef.current
    const previousAdmission = admissionRef.current?.promise
    sessionRef.current = null
    candidateRef.current = nextUser
    setCurrentUser(null)
    setReady(false)
    setBusy(true)
    setError('')
    const isCurrent = () => mountedRef.current && generationRef.current === generation

    const promise = (async () => {
      let handle
      try {
        await Promise.all([cleanupRef.current, previousSession?.handle.release(), previousAdmission])
        if (!isCurrent()) return false
        if (nextUser.isAnonymous && readGuestDeletion(nextUser.uid)) {
          manualAuthRef.current = true
          try { await finishGuestDeletion(nextUser, { release: false }) }
          finally { manualAuthRef.current = false }
          if (mountedRef.current) { setBusy(false); setReady(true) }
          return false
        }
        handle = await acquireAccountSession(nextUser, {
          projectId: firebaseAuth?.app?.options.projectId,
          onLost: (sessionError) => {
            if (!isCurrent()) return
            generationRef.current += 1
            sessionRef.current = null
            admissionRef.current = null
            setCurrentUser(null)
            setProfileSyncError('')
            setError(authErrorMessage(sessionError))
            setBusy(false)
            setReady(true)
          },
        })
        if (!isCurrent()) {
          await handle.release()
          return false
        }

        let admittedUser = nextUser
        if (nextUser.isAnonymous) {
          admittedUser = await resolveGuestIdentity(nextUser)
          if (!isCurrent()) {
            await handle.release()
            return false
          }
        }
        sessionRef.current = { uid: nextUser.uid, handle }
        if (nextUser.isLocalGuest) {
          storeLocalGuest(nextUser, autoLoginRef.current)
        } else {
          // Credentials can be shared across tabs; only the admitted tab may change
          // persistence. In particular, never sign out Firebase in a rejected tab.
          await setPersistence(firebaseAuth, authPersistence(autoLoginRef.current))
          if (!isCurrent()) {
            await handle.release()
            return false
          }
          if (nextUser.isAnonymous) {
            const rememberedGuest = readLocalGuest(autoLoginRef.current)
            // Only the explicitly remembered guest may transfer its own data.
            // Never copy another account's shared-browser save into a new UID.
            if (rememberedGuest && readPlayerSyncState()?.ownerUid === rememberedGuest.uid) {
              backupGuestPlayerData(rememberedGuest.uid)
              markPendingGoogleMigration(rememberedGuest.uid, nextUser.uid)
            }
          }
          clearLocalGuest()
        }
        setProfileSyncError('')
        if (!nextUser.isLocalGuest) {
          try {
            const result = await ensurePlayerProfile(admittedUser)
            if (!isCurrent()) { await handle.release(); return false }
            admittedUser = withPlayerNickname(admittedUser, result?.profile)
          } catch {
            if (isCurrent()) setProfileSyncError('계정 프로필을 서버와 동기화하지 못했습니다.')
          }
        }
        if (!isCurrent()) { await handle.release(); return false }
        candidateRef.current = admittedUser
        setCurrentUser(admittedUser)
        return true
      } catch (sessionError) {
        await handle?.release()
        if (isCurrent()) {
          sessionRef.current = null
          setError(nextUser.isAnonymous && readGuestDeletion(nextUser.uid)
            ? '게스트 정보 삭제를 완료하지 못했습니다. 연결을 확인한 뒤 게스트로 시작을 눌러 삭제를 다시 시도해주세요.'
            : authErrorMessage(sessionError))
        }
        return false
      } finally {
        if (isCurrent()) {
          admissionRef.current = null
          setBusy(false)
          setReady(true)
        }
      }
    })()
    admissionRef.current = { uid: nextUser.uid, promise }
    return promise
  }, [setCurrentUser, finishGuestDeletion])

  useEffect(() => {
    mountedRef.current = true
    const restore = async (firebaseUser) => {
      if (!mountedRef.current || manualAuthRef.current) return
      try { clearCompletedGuestDeletions() }
      catch {
        setError('게스트 정보 삭제의 마지막 정리를 완료하지 못했습니다. 브라우저 저장 공간을 확인한 뒤 다시 시도해주세요.')
        setBusy(false)
        setReady(true)
        return
      }
      let nextUser = firebaseUser ?? (candidateRef.current?.isLocalGuest ? candidateRef.current : null)
      if (nextUser?.isLocalGuest && firebaseAuth) {
        // Upgrade legacy guest saves once, using persisted Firebase credentials
        // from then on. The profile/owner checks happen after session admission.
        manualAuthRef.current = true
        setReady(false)
        setBusy(true)
        try {
          nextUser = (await signInAnonymously(firebaseAuth)).user
        } catch (authError) {
          if (mountedRef.current) {
            setError(authErrorMessage(authError))
            setBusy(false)
            setReady(true)
          }
          return
        } finally {
          manualAuthRef.current = false
        }
        if (!mountedRef.current) return
      }
      if (nextUser) {
        void activateUser(nextUser)
      } else {
        candidateRef.current = null
        void releaseSession()
        setProfileSyncError('')
        setBusy(false)
        setReady(true)
      }
    }
    const unsubscribe = firebaseAuth
      ? onAuthStateChanged(firebaseAuth, restore, (authError) => {
        if (!mountedRef.current) return
        void releaseSession()
        setError(authErrorMessage(authError))
        setBusy(false)
        setReady(true)
      })
      : (() => { restore(null); return () => {} })()

    const restoreCachedPage = (event) => {
      if (!event.persisted) return
      // pagehide releases ownership even when the browser keeps the page in BFCache.
      void releaseSession().then(() => restore(firebaseAuth?.currentUser ?? null))
    }
    window.addEventListener('pageshow', restoreCachedPage)
    return () => {
      mountedRef.current = false
      unsubscribe()
      window.removeEventListener('pageshow', restoreCachedPage)
      void releaseSession()
    }
  }, [activateUser, releaseSession])

  const updateAutoLogin = useCallback(async (nextValue) => {
    const enabled = Boolean(nextValue)
    setBusy(true)
    setError('')
    try {
      if (userRef.current?.isLocalGuest) {
        storeLocalGuest(userRef.current, enabled)
      } else if (firebaseAuth && userRef.current) {
        await setPersistence(firebaseAuth, authPersistence(enabled))
      }
      autoLoginRef.current = enabled
      setAutoLoginState(enabled)
      saveAutoLoginPreference(enabled)
    } catch {
      setError('자동 로그인 설정을 저장하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }, [])

  const signInWithGoogle = useCallback(async () => {
    if (!firebaseAuth) {
      setError('Firebase 연결 설정이 필요합니다.')
      return false
    }

    setBusy(true)
    setError('')
    manualAuthRef.current = true
    try {
      clearCompletedGuestDeletions()
      let firebaseUser = firebaseAuth.currentUser
      if (firebaseUser?.isAnonymous && readGuestDeletion(firebaseUser.uid)) {
        await finishGuestDeletion(firebaseUser)
        firebaseUser = null
      }
      if (!firebaseUser || firebaseUser.isAnonymous || userRef.current?.isLocalGuest) {
        const provider = new GoogleAuthProvider()
        provider.setCustomParameters({ prompt: 'select_account' })
        firebaseUser = (await signInWithPopup(firebaseAuth, provider)).user
      }
      return await activateUser(firebaseUser)
    } catch (authError) {
      setError(authErrorMessage(authError))
      return false
    } finally {
      manualAuthRef.current = false
      setBusy(false)
    }
  }, [activateUser, finishGuestDeletion])

  const connectGuestToGoogle = useCallback(async () => {
    const currentGuest = userRef.current
    if (!currentGuest?.isLocalGuest && !currentGuest?.isAnonymous) return false
    try {
      backupGuestPlayerData(currentGuest.uid)
      // Preflight storage before opening authentication. The destination is
      // bound below, so a later unrelated login cannot claim this guest's save.
      markPendingGoogleMigration(currentGuest.uid, '__awaiting_google_link__')
    } catch {
      setError('게스트 진행 기록의 이전 설정을 저장하지 못했습니다. 브라우저 저장 공간을 확인해주세요.')
      return false
    }
    if (!firebaseAuth) {
      clearPendingGoogleMigration()
      setError('Firebase 연결 설정이 필요합니다.')
      return false
    }
    setBusy(true)
    setError('')
    manualAuthRef.current = true
    let destinationBound = false
    try {
      const provider = new GoogleAuthProvider()
      provider.setCustomParameters({ prompt: 'select_account' })
      let firebaseUser
      let preserveExistingCloud = false
      if (currentGuest.isAnonymous && firebaseAuth.currentUser?.uid === currentGuest.uid) {
        try {
          firebaseUser = (await linkWithPopup(firebaseAuth.currentUser, provider)).user
        } catch (authError) {
          if (!['auth/credential-already-in-use', 'auth/email-already-in-use'].includes(authError?.code)) throw authError
          const credential = GoogleAuthProvider.credentialFromError(authError)
          if (!credential) throw authError
          preserveExistingCloud = true
          firebaseUser = (await signInWithCredential(firebaseAuth, credential)).user
        }
      } else {
        preserveExistingCloud = true
        firebaseUser = (await signInWithPopup(firebaseAuth, provider)).user
      }
      if (firebaseUser.uid === currentGuest.uid) {
        clearPendingGoogleMigration()
      } else {
        markPendingGoogleMigration(currentGuest.uid, firebaseUser.uid, { preserveExistingCloud })
        destinationBound = true
      }
      const connected = await activateUser(firebaseUser)
      if (connected && preserveExistingCloud) {
        setProfileSyncError('기존 Google 계정의 저장 기록을 우선 불러옵니다. 게스트 기록은 이전 백업으로 이 기기에 보관했습니다.')
      }
      return connected
    } catch (authError) {
      setError(authErrorMessage(authError))
      return false
    } finally {
      if (!destinationBound) clearPendingGoogleMigration()
      manualAuthRef.current = false
      setBusy(false)
    }
  }, [activateUser])

  const signInAsGuest = useCallback(async () => {
    setBusy(true)
    setError('')
    manualAuthRef.current = true
    try {
      clearCompletedGuestDeletions()
      if (firebaseAuth) {
        // Reuse persisted anonymous credentials; a fresh UID must never bypass
        // the current guest's single-window session lock.
        const currentFirebaseUser = firebaseAuth.currentUser
        if (currentFirebaseUser && !currentFirebaseUser.isAnonymous) {
          setError('현재 계정에서 로그아웃한 뒤 게스트로 시작해주세요.')
          return false
        }
        const firebaseUser = currentFirebaseUser ?? (await signInAnonymously(firebaseAuth)).user
        return await activateUser(firebaseUser)
      }
      const localGuest = readLocalGuest(autoLoginRef.current) ?? createLocalGuest()
      return await activateUser(localGuest)
    } catch (authError) {
      setError(authErrorMessage(authError))
      return false
    } finally {
      manualAuthRef.current = false
      setBusy(false)
    }
  }, [activateUser])

  const signOut = useCallback(async () => {
    if (logoutPendingRef.current) return false
    logoutPendingRef.current = true
    const currentUser = userRef.current
    setBusy(true)
    setError('')
    manualAuthRef.current = true
    try {
      if (currentUser?.isLocalGuest) {
        clearGuestPlayerData(currentUser.uid)
      } else if (currentUser?.isAnonymous) {
        await finishGuestDeletion(firebaseAuth?.currentUser, { uid: currentUser.uid })
        setProfileSyncError('')
        return true
      } else if (firebaseAuth && currentUser) {
        await firebaseSignOut(firebaseAuth)
      }
      // Clear shared credentials before freeing the lock, so a newly admitted tab
      // cannot be signed out by this window's delayed signOut operation.
      candidateRef.current = null
      await releaseSession()
      setProfileSyncError('')
      return true
    } catch (authError) {
      setError(currentUser?.isAnonymous || currentUser?.isLocalGuest
        ? '게스트 로그아웃과 정보 삭제를 완료하지 못했습니다. 연결을 확인한 뒤 다시 시도해주세요. 삭제가 완료될 때까지 게임은 중단됩니다.'
        : authErrorMessage(authError))
      return false
    } finally {
      logoutPendingRef.current = false
      manualAuthRef.current = false
      setBusy(false)
      setReady(true)
    }
  }, [releaseSession, finishGuestDeletion])

  const deleteAccount = useCallback(async () => {
    const currentUser = userRef.current
    if (!currentUser) return false
    if (currentUser.isAnonymous || currentUser.isLocalGuest) return signOut()

    setBusy(true)
    setError('')
    setProfileSyncError('')
    manualAuthRef.current = true

    try {
      if (currentUser.isLocalGuest) {
        clearLocalPlayerData()
        clearLocalGuest()
        candidateRef.current = null
        await releaseSession()
        return true
      }

      const firebaseUser = firebaseAuth?.currentUser
      if (!firebaseUser) throw new Error('Firebase user is not available.')

      if (!firebaseUser.isAnonymous) {
        const provider = new GoogleAuthProvider()
        provider.setCustomParameters({
          prompt: 'select_account',
          ...(firebaseUser.email ? { login_hint: firebaseUser.email } : {}),
        })
        await reauthenticateWithPopup(firebaseUser, provider)
      }
      await deletePlayerProfile(firebaseUser)
      // Release while the ID token is still valid; deleteUser revokes authentication.
      candidateRef.current = null
      await releaseSession()
      await deleteUser(firebaseUser)

      clearLocalPlayerData()
      clearLocalGuest()
      setCurrentUser(null)
      return true
    } catch (accountError) {
      setError(accountDeletionErrorMessage(accountError))
      return false
    } finally {
      manualAuthRef.current = false
      setBusy(false)
      setReady(true)
    }
  }, [releaseSession, setCurrentUser, signOut])

  const setNickname = useCallback(async value => {
    const currentUser = userRef.current
    const generation = generationRef.current
    if (!currentUser || currentUser.isAnonymous || currentUser.isLocalGuest) throw new Error('게스트는 현재 이름을 그대로 사용합니다.')
    if (nicknamePendingRef.current || logoutPendingRef.current || manualAuthRef.current || !sessionRef.current?.handle.isActive()) {
      throw new Error('계정 처리가 진행 중입니다. 잠시 후 다시 시도해주세요.')
    }
    nicknamePendingRef.current = true
    try {
      const result = await setPlayerNickname(currentUser, value)
      if (!mountedRef.current || generationRef.current !== generation || userRef.current?.uid !== currentUser.uid
        || !sessionRef.current?.handle.isActive() || logoutPendingRef.current) {
        throw new Error('로그인 계정이 변경되었습니다. 현재 계정에서 다시 확인해주세요.')
      }
      setCurrentUser(withPlayerNickname(currentUser, result.profile))
      setProfileSyncError('')
      return result.profile.nickname
    } finally { nicknamePendingRef.current = false }
  }, [setCurrentUser])

  // Shares the nickname's in-flight guard: both write the same profile record,
  // so letting them overlap would let the older response win.
  const setTitle = useCallback(async value => {
    const currentUser = userRef.current
    const generation = generationRef.current
    if (!currentUser || currentUser.isAnonymous || currentUser.isLocalGuest) throw new Error('게스트는 칭호를 설정할 수 없습니다.')
    if (nicknamePendingRef.current || logoutPendingRef.current || manualAuthRef.current || !sessionRef.current?.handle.isActive()) {
      throw new Error('계정 처리가 진행 중입니다. 잠시 후 다시 시도해주세요.')
    }
    nicknamePendingRef.current = true
    try {
      const result = await setPlayerTitle(currentUser, value)
      if (!mountedRef.current || generationRef.current !== generation || userRef.current?.uid !== currentUser.uid
        || !sessionRef.current?.handle.isActive() || logoutPendingRef.current) {
        throw new Error('로그인 계정이 변경되었습니다. 현재 계정에서 다시 확인해주세요.')
      }
      setCurrentUser(withPlayerNickname(currentUser, result.profile))
      setProfileSyncError('')
      return result.profile.title
    } finally { nicknamePendingRef.current = false }
  }, [setCurrentUser])

  const value = useMemo(() => ({
    user,
    ready,
    busy,
    error,
    profileSyncError,
    autoLogin,
    configured: isFirebaseConfigured,
    missingConfiguration: missingFirebaseEnvironmentVariables,
    setAutoLogin: updateAutoLogin,
    signInWithGoogle,
    connectGuestToGoogle,
    signInAsGuest,
    signOut,
    deleteAccount,
    setNickname,
    setTitle,
  }), [
    autoLogin,
    busy,
    connectGuestToGoogle,
    deleteAccount,
    setNickname,
    setTitle,
    error,
    profileSyncError,
    ready,
    signInAsGuest,
    signInWithGoogle,
    signOut,
    updateAutoLogin,
    user,
  ])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider')
  return context
}
