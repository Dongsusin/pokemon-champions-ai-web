import { useSyncExternalStore } from 'react'
import { UsersRound } from 'lucide-react'
import { getOnlinePlayersSnapshot, getServerOnlinePlayersSnapshot, subscribeOnlinePlayers } from './auth/onlinePlayers'
import './onlinePlayers.css'

export default function OnlinePlayersBadge({ userId }) {
  const snapshot = useSyncExternalStore(subscribeOnlinePlayers, getOnlinePlayersSnapshot, getServerOnlinePlayersSnapshot)
  const count = snapshot?.userId === userId ? snapshot.count : null
  const available = Number.isSafeInteger(count)
  return (
    <div className={`online-players-badge${available ? '' : ' is-pending'}`}
      role="status" aria-live="polite" aria-atomic="true"
      aria-label={available ? `현재 플레이 중 ${count.toLocaleString('ko-KR')}명` : '접속 인원 확인 중'}
      title={available ? '로그인·게스트 유저 포함 · 접속 상태를 약 30초마다 갱신합니다.' : '현재 접속 인원을 확인하고 있습니다.'}>
      <UsersRound size={18} aria-hidden="true" />
      <span className="online-players-copy">
        <small><i aria-hidden="true" />현재 플레이 중</small>
        <strong>{available ? count.toLocaleString('ko-KR') : '—'}<span>명</span></strong>
      </span>
    </div>
  )
}
