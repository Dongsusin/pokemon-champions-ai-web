import { useEffect, useState } from 'react'
import { UsersRound } from 'lucide-react'
import { getOnlinePlayersSnapshot } from './auth/onlinePlayers'
import { getActiveAccountSessionOwnerId } from './auth/accountSession'
import { createAccountApiClient } from './auth/accountApiClient'
import { isServerGameStorage } from './auth/gameStorageConfig'
import './onlinePlayers.css'

export default function OnlinePlayersBadge({ user, pageKey }) {
  const userId = user?.uid
  const [sample, setSample] = useState(null)
  useEffect(() => {
    const cached = getOnlinePlayersSnapshot()
    const accept = count => setSample({ userId, pageKey, count })
    accept(cached?.userId === userId ? cached.count : null)
    const ownerId = getActiveAccountSessionOwnerId(userId)
    if (!isServerGameStorage || !ownerId || typeof user?.getIdToken !== 'function') return
    const controller = new AbortController()
    const current = () => !controller.signal.aborted && getActiveAccountSessionOwnerId(userId) === ownerId
    const client = createAccountApiClient({ getIdToken: () => user.getIdToken(), isCurrent: current })
    // One read for this page. No timers, focus listeners, or automatic retries.
    void client.request('onlinePlayers', { ownerId }, { signal: controller.signal }).then(result => {
      if (current()) accept(Number.isSafeInteger(result.onlinePlayers?.count) && result.onlinePlayers.count >= 0 ? result.onlinePlayers.count : null)
    }).catch(() => { if (current()) accept(null) })
    return () => controller.abort()
  }, [userId, pageKey])
  const count = sample?.userId === userId && sample.pageKey === pageKey ? sample.count : null
  const available = Number.isSafeInteger(count)
  return (
    <div className={'online-players-badge' + (available ? '' : ' is-pending')}
      role="status" aria-live="polite" aria-atomic="true"
      aria-label={available ? '페이지 접속 시 플레이 중 ' + count.toLocaleString('ko-KR') + '명' : '접속 인원 확인 불가'}
      title={available ? '페이지를 열었을 때의 접속 인원입니다.' : '접속 인원을 확인하지 못했습니다. 다시 방문하면 조회합니다.'}>
      <UsersRound size={18} aria-hidden="true" />
      <span className="online-players-copy">
        <small><i aria-hidden="true" />접속 인원</small>
        <strong>{available ? count.toLocaleString('ko-KR') : '—'}<span>명</span></strong>
      </span>
    </div>
  )
}
