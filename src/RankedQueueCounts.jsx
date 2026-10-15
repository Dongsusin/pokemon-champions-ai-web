import { useEffect, useMemo, useState } from 'react'
import { UsersRound } from 'lucide-react'
import { firebaseAuth } from './auth/firebaseClient'
import { createRankedClient, isRankedEnabled, isRankedLocalTest } from './rankedClient'
import { startRankedPolling } from './rankedPolling'
import { readRankedQueueCounts } from './rankedQueueCountData'
import './rankedQueueCounts.css'

export default function RankedQueueCounts({ user }) {
  const canRead = (isRankedEnabled && Boolean(user?.uid && !user.isLocalGuest)) || isRankedLocalTest
  const client = useMemo(() => createRankedClient({
    // Count reads never join the queue or renew the test identity's session.
    localTestIdentity: isRankedLocalTest ? 'alice' : undefined,
    getIdToken: async () => {
      const current = firebaseAuth?.currentUser
      if (!current || current.uid !== user?.uid) return null
      const token = await current.getIdToken()
      return firebaseAuth?.currentUser?.uid === user?.uid ? token : null
    },
  }), [user?.uid])
  const [snapshot, setSnapshot] = useState(null)
  const state = canRead && snapshot?.client === client ? snapshot : null
  const counts = state?.counts

  useEffect(() => {
    if (!canRead) return
    const controller = new AbortController()
    const polling = startRankedPolling({
      getSnapshot: () => ({}), visibleInterval: () => 5000,
      refresh: async () => {
        try {
          const counts = readRankedQueueCounts(await client.request('queueCounts', {}, { signal: controller.signal }))
          if (!controller.signal.aborted) setSnapshot({ client, counts, failed: false })
        } catch {
          // An unavailable response must never be presented as zero waiting players.
          if (!controller.signal.aborted) setSnapshot({ client, counts: null, failed: true })
        }
      },
    })
    return () => { controller.abort(); polling.stop() }
  }, [client, canRead])

  const pendingText = !canRead || state?.failed ? '인원 확인 불가' : '인원 확인 중'
  return <span className={`ranked-queue-counts${counts ? '' : ' is-pending'}`} role="status" aria-live="polite" aria-atomic="true"
    aria-label={counts ? `레이팅 매칭 대기 총 ${counts.total}명, 싱글 ${counts.single}명, 더블 ${counts.double}명` : `레이팅 매칭 대기 ${pendingText}`}
    title="페이지를 열었을 때의 매칭 대기 인원입니다. 다시 방문하면 갱신됩니다.">
    <span className="ranked-queue-counts-heading"><UsersRound size={16} aria-hidden="true" /><span>레이팅 매칭 대기</span>
      <b>{counts ? `${counts.total.toLocaleString('ko-KR')}명` : '—'}</b></span>
    <span className="ranked-queue-counts-formats">{counts ? <>
      <span>싱글 <b>{counts.single.toLocaleString('ko-KR')}</b>명</span>
      <span>더블 <b>{counts.double.toLocaleString('ko-KR')}</b>명</span>
    </> : <span>{pendingText}</span>}</span>
  </span>
}
