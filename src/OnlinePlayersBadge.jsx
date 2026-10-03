import { useEffect, useSyncExternalStore } from 'react'
import { UsersRound } from 'lucide-react'
import { getOnlinePlayersSnapshot, getServerOnlinePlayersSnapshot, subscribeOnlinePlayers, updateOnlinePlayers, clearOnlinePlayers } from './auth/onlinePlayers'
import { hasLauncherOnline, requestLauncherOnline } from './local/launcherBridge.js'
import './onlinePlayers.css'

export default function OnlinePlayersBadge({ userId }) {
  const connected = hasLauncherOnline('presence')
  useEffect(() => {
    if (!connected || !userId) return
    const controller = new AbortController()
    const ownerId = `local:${userId}`
    const refresh = async () => {
      try {
        const sample = await requestLauncherOnline('presence', 'count', {}, { userId, signal: controller.signal })
        if (!controller.signal.aborted) updateOnlinePlayers(userId, ownerId, sample)
      } catch { if (!controller.signal.aborted) clearOnlinePlayers(userId, ownerId) }
    }
    void refresh()
    const timer = setInterval(() => { if (document.visibilityState !== 'hidden') void refresh() }, 30_000)
    return () => { controller.abort(); clearInterval(timer); clearOnlinePlayers(userId, ownerId) }
  }, [connected, userId])
  const snapshot = useSyncExternalStore(subscribeOnlinePlayers, getOnlinePlayersSnapshot, getServerOnlinePlayersSnapshot)
  const count = snapshot?.userId === userId ? snapshot.count : null
  const available = Number.isSafeInteger(count)
  return (
    <div className={`online-players-badge${available ? '' : ' is-pending'}`}
      role="status" aria-live="polite" aria-atomic="true"
      aria-label={!connected ? '로컬 플레이' : available ? `현재 플레이 중 ${count.toLocaleString('ko-KR')}명` : '접속 인원 확인 불가'}
      title={!connected ? '런처 온라인 서비스 연결 전 · 로컬 플레이 가능' : '개인 운영 서버의 접속 인원'}>
      <UsersRound size={18} aria-hidden="true" />
      <span className="online-players-copy">
        <small><i aria-hidden="true" />{connected ? '현재 플레이 중' : 'LOCAL PLAY'}</small>
        <strong>{!connected ? '로컬' : available ? count.toLocaleString('ko-KR') : '—'}{connected && <span>명</span>}</strong>
      </span>
    </div>
  )
}
