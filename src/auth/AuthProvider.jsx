import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import { flushLocalSave, gameStorage } from '../local/gameStorage.js'
import { AUTO_START_KEY, PROFILE_KEY } from '../local/saveSchema.js'
import { normalizeTrainerNickname } from '../data/trainerNickname.js'
import { getEarnedTrainerTitles, normalizeTrainerTitle } from '../data/titleData.js'

const AuthContext = createContext(null)
function readProfile() {
  const raw = gameStorage.getItem(PROFILE_KEY)
  return raw ? asGuest(JSON.parse(raw)) : null
}
function asGuest(profile) {
  return { uid: profile.uid, displayName: profile.displayName, nickname: profile.nickname ?? '',
    title: profile.title ?? '', isLocal: true, isLocalGuest: true, isAnonymous: true, photoURL: null, email: null }
}

// Returning to the start screen never deletes this persistent local guest.
export function AuthProvider({ children }) {
  const [autoLogin, setAutoLoginState] = useState(() => gameStorage.getItem(AUTO_START_KEY) !== 'false')
  const [user, setUser] = useState(() => gameStorage.getItem(AUTO_START_KEY) !== 'false' ? readProfile() : null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef(false)
  const run = useCallback(async action => {
    if (pending.current) throw new Error('저장 작업이 진행 중입니다. 잠시 후 다시 시도해주세요.')
    pending.current = true
    setBusy(true)
    setError('')
    try { return await action() } catch (failure) { setError(failure.message); throw failure }
    finally { pending.current = false; setBusy(false) }
  }, [])
  const startGuest = useCallback(name => run(async () => {
    let profile = readProfile()
    if (!profile) {
      const nickname = normalizeTrainerNickname(name || '로컬 트레이너')
      profile = asGuest({ uid: `local-guest-${crypto.randomUUID()}`, displayName: nickname, nickname, title: '' })
      gameStorage.setItem(PROFILE_KEY, JSON.stringify(profile))
    }
    await flushLocalSave()
    setUser(profile)
    return profile
  }), [run])
  const signOut = useCallback(() => run(async () => { await flushLocalSave(); setUser(null); return true }), [run])
  const setAutoLogin = useCallback(enabled => run(async () => {
    gameStorage.setItem(AUTO_START_KEY, String(Boolean(enabled)))
    await flushLocalSave()
    setAutoLoginState(Boolean(enabled))
  }), [run])
  const updateProfile = useCallback(patch => run(async () => {
    const profile = readProfile()
    if (!profile) throw new Error('로컬 트레이너가 준비되지 않았습니다.')
    const next = asGuest({ ...profile, ...patch })
    gameStorage.setItem(PROFILE_KEY, JSON.stringify(next))
    await flushLocalSave()
    setUser(next)
    return next
  }), [run])
  const setNickname = useCallback(async value => {
    const nickname = normalizeTrainerNickname(value)
    return (await updateProfile({ nickname, ...(nickname ? { displayName: nickname } : {}) })).nickname
  }, [updateProfile])
  const setTitle = useCallback(async value => {
    const title = normalizeTrainerTitle(value)
    const progress = JSON.parse(gameStorage.getItem('champions-achievements-v1') ?? '{}')
    if (title && !getEarnedTrainerTitles(progress).some(entry => entry.id === title)) throw new Error('아직 획득하지 않은 칭호입니다.')
    return (await updateProfile({ title })).title
  }, [updateProfile])
  const value = useMemo(() => ({ user, ready: true, busy, error, autoLogin, setAutoLogin,
    savedProfile: readProfile(), startGuest, signOut, setNickname, setTitle }),
  [user, busy, error, autoLogin, setAutoLogin, startGuest, signOut, setNickname, setTitle])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider')
  return context
}
