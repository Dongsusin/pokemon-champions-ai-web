import { useCallback, useEffect, useRef, useState } from 'react'
import { firebaseAuth } from './auth/firebaseClient'
import { isRankedEnabled } from './rankedClient.js'
import {
  createFactoryRankingClient,
  createFactoryRankingSession,
  createLocalFactoryRankingClient,
  isFactoryRankingLocalTest,
} from './battleFactoryRankingClient.js'
import { FACTORY_DEFAULT_MODE, getFactoryMode } from './data/battleFactoryChallenge.js'

const empty = () => ({ entries: [], ownBest: null })

// Each mode has its own board, so the session is rebuilt when the mode changes
// and a record can never be reported to the other board.
export default function useBattleFactoryRankings(user, mode = FACTORY_DEFAULT_MODE) {
  const boardMode = getFactoryMode(mode).id
  const localGuest = Boolean(user?.isLocalGuest) && !isFactoryRankingLocalTest
  const source = localGuest || isFactoryRankingLocalTest ? 'local' : 'global'
  const scope = localGuest ? 'guest' : isFactoryRankingLocalTest ? 'test' : 'global'
  const uid = user?.uid
  const identity = `${scope}:${boardMode}:${uid ?? ''}`
  const identityRef = useRef(identity)
  identityRef.current = identity
  const session = useRef(null)
  const unsavedRun = useRef(null)
  const refreshRequested = useRef(null)
  const lastNickname = useRef({ identity, value: user?.nickname })
  const [snapshot, setSnapshot] = useState(() => ({ identity, value: empty() }))
  const [restart, setRestart] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [recordError, setRecordError] = useState('')

  useEffect(() => {
    setSnapshot({ identity, value: empty() })
    setLoading(false)
    setError('')
    setRecordError('')
    if (!uid) return undefined
    let current
    try {
      const storage = window.localStorage
      const client = localGuest
        ? createLocalFactoryRankingClient({ uid, trainerName: user.displayName ?? '트레이너', nickname: user.nickname,
          isGuest: Boolean(user.isAnonymous || user.isLocalGuest), storage, mode: boardMode })
        : createFactoryRankingClient({ uid, getIdToken: async () => {
          if (!isRankedEnabled) throw new Error('온라인 순위 서버가 아직 준비되지 않았습니다.')
          const active = firebaseAuth?.currentUser
          if (identityRef.current !== identity || active?.uid !== uid) return null
          const token = await active.getIdToken()
          return identityRef.current === identity && firebaseAuth?.currentUser?.uid === uid ? token : null
        }, mode: boardMode })
      current = createFactoryRankingSession({ uid, storage, client, scope, mode: boardMode,
        isCurrent: () => identityRef.current === identity,
        onSnapshot: value => setSnapshot({ identity, value }), onLoading: setLoading, onError: setError, onRecordError: setRecordError })
      session.current = { identity, current }
      if (unsavedRun.current?.identity === identity && current.recordRun(unsavedRun.current.run)) unsavedRun.current = null
      if (localGuest || refreshRequested.current === identity) {
        void current.refresh().finally(() => {
          if (session.current?.current === current && refreshRequested.current === identity) refreshRequested.current = null
        })
      }
      else void current.flush()
    } catch (failure) {
      setError(`팩토리 순위를 준비하지 못했습니다. ${failure.message}`)
    }
    const retryPending = () => {
      if (document.visibilityState !== 'hidden') void current?.flush()
    }
    window.addEventListener('online', retryPending)
    return () => {
      current?.stop()
      if (session.current?.identity === identity) session.current = null
      window.removeEventListener('online', retryPending)
    }
  }, [identity, uid, localGuest, scope, boardMode, user?.displayName, restart])

  useEffect(() => {
    const previous = lastNickname.current
    lastNickname.current = { identity, value: user?.nickname }
    if (previous.identity === identity && previous.value !== user?.nickname && session.current?.identity === identity) {
      void session.current.current.refresh()
    }
  }, [identity, user?.nickname])

  const refresh = useCallback(async () => {
    const active = session.current
    if (active?.identity === identityRef.current) await active.current.refresh()
    else {
      // The leaderboard's load-error button also has to recover when browser
      // storage prevented the session from being created in the first place.
      refreshRequested.current = identityRef.current
      setRestart(value => value + 1)
    }
  }, [])
  const recordRun = useCallback(run => {
    const active = session.current
    if (active?.identity === identityRef.current) {
      const recorded = active.current.recordRun(run)
      unsavedRun.current = recorded ? null : { identity: identityRef.current, run }
      return recorded
    }
    unsavedRun.current = { identity: identityRef.current, run }
    setRecordError('팩토리 기록을 저장할 트레이너를 확인하지 못했습니다. 다시 시도해주세요.')
    return false
  }, [])
  const retry = useCallback(async () => {
    const active = session.current
    if (active?.identity === identityRef.current) await active.current.retry()
    else await refresh()
  }, [refresh])

  return { ...(snapshot.identity === identity ? snapshot.value : empty()), loading, error, recordError, source, refresh, retry, recordRun }
}
