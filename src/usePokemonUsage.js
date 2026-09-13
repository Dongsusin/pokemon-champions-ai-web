import { useCallback, useEffect, useRef, useState } from 'react'
import { firebaseAuth } from './auth/firebaseClient'
import { createEmptyUsageSnapshot, mergeUsageSnapshots } from './data/pokemonUsage'
import { createPokemonUsageClient, createUsageOutbox, isPokemonUsageDemo, isPokemonUsageEnabled } from './pokemonUsageClient'

export default function usePokemonUsage(user) {
  const [snapshot, setSnapshot] = useState(createEmptyUsageSnapshot)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [recordError, setRecordError] = useState('')
  const session = useRef(null)
  const canUse = isPokemonUsageEnabled && (isPokemonUsageDemo || !user?.isLocalGuest)

  useEffect(() => {
    setSnapshot(createEmptyUsageSnapshot())
    setLoading(false)
    setError('')
    setRecordError('')
    if (!canUse) return
    let storage
    try { storage = window.localStorage }
    catch { setError('브라우저 저장소에 접근할 수 없어 사용률 기록을 준비하지 못했습니다.'); return }
    const current = { alive: true, controller: new AbortController(), refreshing: null, snapshot: createEmptyUsageSnapshot() }
    const accept = value => {
      if (!current.alive) return
      try {
        current.snapshot = { ...mergeUsageSnapshots(current.snapshot, value), source: isPokemonUsageDemo ? 'demo' : 'live' }
      } catch { throw new Error('사용률 집계 응답을 확인할 수 없습니다. 다시 시도해주세요.') }
      setSnapshot(current.snapshot)
      setError('')
    }
    const client = createPokemonUsageClient(async () => {
      const activeUser = firebaseAuth?.currentUser
      if (!current.alive || activeUser?.uid !== user.uid) return null
      return activeUser.getIdToken()
    })
    const outbox = createUsageOutbox({ uid: user.uid, storage,
      keyPrefix: `champions-usage-outbox-v1-${isPokemonUsageDemo ? 'demo' : 'live'}`,
      send: (report, signal) => client.request('reportAiUsage', report, { signal }), onSnapshot: accept })
    current.flush = async () => {
      try { await outbox.flush() }
      catch (failure) { if (current.alive) setError(`사용률 기록을 전송하지 못했습니다. 다시 시도하면 이어서 반영합니다. ${failure.message}`) }
    }
    current.refresh = async () => {
      if (current.refreshing) return current.refreshing
      current.refreshing = (async () => {
        setLoading(true)
        try {
          await outbox.flush()
          accept(await client.request('usage', {}, { signal: current.controller.signal }))
          if (current.alive) setError('')
        } catch (failure) { if (current.alive) setError(failure.message) }
        finally { if (current.alive) setLoading(false); current.refreshing = null }
      })()
      return current.refreshing
    }
    current.record = report => { outbox.enqueue(report); void current.flush() }
    session.current = current
    void current.flush()
    const retry = () => { if (document.visibilityState !== 'hidden') void current.flush() }
    window.addEventListener('online', retry)
    const timer = window.setInterval(retry, 30_000)
    return () => {
      current.alive = false
      current.controller.abort()
      outbox.stop()
      if (session.current === current) session.current = null
      window.clearInterval(timer)
      window.removeEventListener('online', retry)
    }
  }, [user?.uid, canUse])

  const refresh = useCallback(async () => {
    if (!isPokemonUsageEnabled) { setError('사용률 집계는 아직 공개 준비 중입니다.'); return }
    if (!canUse) { setError('전체 유저 사용률은 Google 로그인 후 확인할 수 있습니다.'); return }
    await session.current?.refresh()
  }, [canUse])
  const recordAiBattle = useCallback(report => {
    if (!canUse) return true
    try {
      if (!session.current) throw new Error('Usage session unavailable')
      session.current.record(report)
      return true
    } catch {
      setRecordError('브라우저 저장 문제로 집계하지 못한 대전이 있습니다. 해당 기록은 새로고침만으로 복구되지 않습니다.')
      return false
    }
  }, [canUse])
  return { snapshot, loading, error: [error, recordError].filter(Boolean).join(' '), refresh, recordAiBattle }
}
