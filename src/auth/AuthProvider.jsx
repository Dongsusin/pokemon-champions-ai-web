import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import {
  GoogleAuthProvider,
  browserLocalPersistence,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  signOut as firebaseSignOut,
} from 'firebase/auth'
import {
  firebaseAuth,
  isFirebaseConfigured,
  missingFirebaseEnvironmentVariables,
} from './firebaseClient'
import { ensurePlayerProfile } from './playerProfile'

const AuthContext = createContext(null)

const AUTH_ERROR_MESSAGES = {
  'auth/account-exists-with-different-credential': '같은 이메일로 연결된 다른 로그인 방식이 있습니다.',
  'auth/cancelled-popup-request': 'Google 로그인 요청이 취소되었습니다.',
  'auth/network-request-failed': '네트워크 연결을 확인한 뒤 다시 시도해주세요.',
  'auth/operation-not-allowed': 'Firebase Console에서 Google 로그인을 활성화해주세요.',
  'auth/popup-blocked': '브라우저에서 로그인 팝업이 차단되었습니다.',
  'auth/popup-closed-by-user': 'Google 로그인 창이 닫혔습니다.',
  'auth/unauthorized-domain': '현재 도메인이 Firebase 승인 도메인에 등록되지 않았습니다.',
}

function authErrorMessage(error) {
  return AUTH_ERROR_MESSAGES[error?.code] ?? 'Google 로그인 중 오류가 발생했습니다.'
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [ready, setReady] = useState(!isFirebaseConfigured)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [profileSyncError, setProfileSyncError] = useState('')

  useEffect(() => {
    if (!firebaseAuth) return undefined
    let active = true

    const unsubscribe = onAuthStateChanged(firebaseAuth, (nextUser) => {
      if (!active) return
      setUser(nextUser)
      setReady(true)
      setError('')

      if (!nextUser) {
        setProfileSyncError('')
        return
      }

      ensurePlayerProfile(nextUser)
        .then(() => {
          if (active) setProfileSyncError('')
        })
        .catch(() => {
          if (active) setProfileSyncError('계정 프로필을 서버에 동기화하지 못했습니다.')
        })
    }, (authError) => {
      if (!active) return
      setError(authErrorMessage(authError))
      setReady(true)
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const signInWithGoogle = useCallback(async () => {
    if (!firebaseAuth) {
      setError('Firebase 연결 설정이 필요합니다.')
      return
    }

    setBusy(true)
    setError('')
    try {
      await setPersistence(firebaseAuth, browserLocalPersistence)
      const provider = new GoogleAuthProvider()
      provider.setCustomParameters({ prompt: 'select_account' })
      await signInWithPopup(firebaseAuth, provider)
    } catch (authError) {
      setError(authErrorMessage(authError))
    } finally {
      setBusy(false)
    }
  }, [])

  const signOut = useCallback(async () => {
    if (!firebaseAuth) return
    setBusy(true)
    setError('')
    try {
      await firebaseSignOut(firebaseAuth)
    } catch (authError) {
      setError(authErrorMessage(authError))
    } finally {
      setBusy(false)
    }
  }, [])

  const value = useMemo(() => ({
    user,
    ready,
    busy,
    error,
    profileSyncError,
    configured: isFirebaseConfigured,
    missingConfiguration: missingFirebaseEnvironmentVariables,
    signInWithGoogle,
    signOut,
  }), [busy, error, profileSyncError, ready, signInWithGoogle, signOut, user])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider')
  return context
}
