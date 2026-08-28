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
  const [user, setUser] = useState(() => readLocalGuest(initialAutoLoginRef.current))
  const [ready, setReady] = useState(!isFirebaseConfigured)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [profileSyncError, setProfileSyncError] = useState('')
  const [autoLogin, setAutoLoginState] = useState(initialAutoLoginRef.current)
  const autoLoginRef = useRef(initialAutoLoginRef.current)
  const userRef = useRef(user)

  const setCurrentUser = useCallback((nextUser) => {
    userRef.current = nextUser
    setUser(nextUser)
  }, [])

  useEffect(() => {
    if (!firebaseAuth) {
      setReady(true)
      return undefined
    }

    let active = true
    let unsubscribe = () => {}

    const observeAuthState = () => {
      if (!active) return
      unsubscribe = onAuthStateChanged(firebaseAuth, (nextUser) => {
        if (!active) return
        setError('')
        setReady(true)

        if (!nextUser) {
          const localGuest = readLocalGuest(autoLoginRef.current)
          setCurrentUser(localGuest)
          setProfileSyncError('')
          return
        }

        clearLocalGuest()
        setCurrentUser(nextUser)
        ensurePlayerProfile(nextUser)
          .then(() => {
            if (active) setProfileSyncError('')
          })
          .catch(() => {
            if (active) setProfileSyncError('계정 프로필을 서버와 동기화하지 못했습니다.')
          })
      }, (authError) => {
        if (!active) return
        setError(authErrorMessage(authError))
        setReady(true)
      })
    }

    setPersistence(firebaseAuth, authPersistence(autoLoginRef.current))
      .catch((authError) => {
        if (active) setError(authErrorMessage(authError))
      })
      .finally(observeAuthState)

    return () => {
      active = false
      unsubscribe()
    }
  }, [setCurrentUser])

  const updateAutoLogin = useCallback(async (nextValue) => {
    const enabled = Boolean(nextValue)
    setBusy(true)
    setError('')
    try {
      if (userRef.current?.isLocalGuest) {
        storeLocalGuest(userRef.current, enabled)
      } else if (firebaseAuth) {
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
    try {
      await setPersistence(firebaseAuth, authPersistence(autoLoginRef.current))
      const provider = new GoogleAuthProvider()
      provider.setCustomParameters({ prompt: 'select_account' })
      await signInWithPopup(firebaseAuth, provider)
      return true
    } catch (authError) {
      setError(authErrorMessage(authError))
      return false
    } finally {
      setBusy(false)
    }
  }, [])

  const connectGuestToGoogle = useCallback(async () => {
    const currentGuest = userRef.current
    if (!currentGuest?.isLocalGuest) return false
    markPendingGoogleMigration(currentGuest.uid)
    const connected = await signInWithGoogle()
    if (!connected) clearPendingGoogleMigration()
    return connected
  }, [signInWithGoogle])

  const signInAsGuest = useCallback(async () => {
    setBusy(true)
    setError('')
    try {
      clearLocalGuest()
      if (firebaseAuth?.currentUser) await firebaseSignOut(firebaseAuth)
      const localGuest = createLocalGuest()
      storeLocalGuest(localGuest, autoLoginRef.current)
      setProfileSyncError('')
      setCurrentUser(localGuest)
    } catch {
      setError('이 PC에 게스트 정보를 저장하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }, [setCurrentUser])

  const signOut = useCallback(async () => {
    setBusy(true)
    setError('')
    try {
      if (userRef.current?.isLocalGuest) {
        clearLocalGuest()
        setCurrentUser(null)
        setProfileSyncError('')
      } else if (firebaseAuth) {
        await firebaseSignOut(firebaseAuth)
      }
    } catch (authError) {
      setError(authErrorMessage(authError))
    } finally {
      setBusy(false)
    }
  }, [setCurrentUser])

  const deleteAccount = useCallback(async () => {
    const currentUser = userRef.current
    if (!currentUser) return false

    setBusy(true)
    setError('')
    setProfileSyncError('')

    try {
      if (currentUser.isLocalGuest) {
        clearLocalPlayerData()
        clearLocalGuest()
        setCurrentUser(null)
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
      await deleteUser(firebaseUser)

      clearLocalPlayerData()
      clearLocalGuest()
      setCurrentUser(null)
      return true
    } catch (accountError) {
      setError(accountDeletionErrorMessage(accountError))
      return false
    } finally {
      setBusy(false)
    }
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
