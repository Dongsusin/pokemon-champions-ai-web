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
  onAuthStateChanged,
  reauthenticateWithPopup,
  setPersistence,
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
  clearPendingGoogleMigration,
  markPendingGoogleMigration,
} from './accountStorage'
import { deletePlayerProfile, ensurePlayerProfile } from './playerProfile'
import { acquireAccountSession, ACCOUNT_SESSION_ERROR_CODES } from './accountSession'

const AuthContext = createContext(null)

export const AUTH_AUTO_LOGIN_STORAGE_KEY = 'champions-auto-login-v1'
export const LOCAL_GUEST_STORAGE_KEY = 'champions-local-guest-v1'

const AUTH_ERROR_MESSAGES = {
  'auth/account-exists-with-different-credential': '같은 이메일로 연결된 다른 로그인 방식이 있습니다.',
  'auth/cancelled-popup-request': 'Google 로그인 요청이 취소되었습니다.',
  'auth/network-request-failed': '네트워크 연결을 확인한 뒤 다시 시도해주세요.',
  'auth/operation-not-allowed': 'Firebase Console에서 Google 로그인을 활성화해주세요.',
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
  return AUTH_ERROR_MESSAGES[error?.code] ?? 'Google 로그인 중 오류가 발생했습니다.'
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

  const activateUser = useCallback((nextUser) => {
    if (!nextUser) return Promise.resolve(false)
    if (sessionRef.current?.uid === nextUser.uid && userRef.current && sessionRef.current.handle.isActive()) {
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
          clearLocalGuest()
        }
        setProfileSyncError('')
        setCurrentUser(nextUser)
        if (!nextUser.isLocalGuest) {
          void ensurePlayerProfile(nextUser).catch(() => {
            if (isCurrent()) setProfileSyncError('계정 프로필을 서버와 동기화하지 못했습니다.')
          })
        }
        return true
      } catch (sessionError) {
        await handle?.release()
        if (isCurrent()) {
          sessionRef.current = null
          setError(authErrorMessage(sessionError))
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
  }, [setCurrentUser])

  useEffect(() => {
    mountedRef.current = true
    const restore = (firebaseUser) => {
      if (!mountedRef.current || manualAuthRef.current) return
      const nextUser = candidateRef.current?.isLocalGuest ? candidateRef.current : firebaseUser
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
      let firebaseUser = firebaseAuth.currentUser
      if (!firebaseUser || userRef.current?.isLocalGuest) {
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
  }, [activateUser])

  const connectGuestToGoogle = useCallback(async () => {
    const currentGuest = userRef.current
    if (!currentGuest?.isLocalGuest) return false
    try {
      markPendingGoogleMigration(currentGuest.uid)
    } catch {
      setError('게스트 진행 기록의 이전 설정을 저장하지 못했습니다. 브라우저 저장 공간을 확인해주세요.')
      return false
    }
    const connected = await signInWithGoogle()
    if (!connected) clearPendingGoogleMigration()
    return connected
  }, [signInWithGoogle])

  const signInAsGuest = useCallback(async () => {
    setBusy(true)
    setError('')
    try {
      // Reuse a remembered guest; creating a fresh UID must not bypass its window lock.
      const localGuest = readLocalGuest(autoLoginRef.current) ?? createLocalGuest()
      return await activateUser(localGuest)
    } catch {
      setError('이 PC에 게스트 정보를 저장하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }, [activateUser])

  const signOut = useCallback(async () => {
    setBusy(true)
    setError('')
    manualAuthRef.current = true
    try {
      const currentUser = userRef.current
      candidateRef.current = null
      if (currentUser?.isLocalGuest) {
        clearLocalGuest()
      } else if (firebaseAuth && currentUser) {
        await firebaseSignOut(firebaseAuth)
      }
      // Clear shared credentials before freeing the lock, so a newly admitted tab
      // cannot be signed out by this window's delayed signOut operation.
      await releaseSession()
      setProfileSyncError('')
    } catch (authError) {
      setError(authErrorMessage(authError))
    } finally {
      manualAuthRef.current = false
      setBusy(false)
      setReady(true)
    }
  }, [releaseSession])

  const deleteAccount = useCallback(async () => {
    const currentUser = userRef.current
    if (!currentUser) return false

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

      const provider = new GoogleAuthProvider()
      provider.setCustomParameters({
        prompt: 'select_account',
        ...(firebaseUser.email ? { login_hint: firebaseUser.email } : {}),
      })
      await reauthenticateWithPopup(firebaseUser, provider)
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
  }, [releaseSession, setCurrentUser])

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
  }), [
    autoLogin,
    busy,
    connectGuestToGoogle,
    deleteAccount,
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
