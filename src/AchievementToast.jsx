import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowRight, Check, Gift, Trophy, X } from 'lucide-react'
import SpriteImage from './SpriteImage'
import { getRareReward } from './data/rareRewards.js'
import { getTrainerTitle } from './data/titleData.js'
import './achievementToast.css'

export const ACHIEVEMENT_TOAST_DURATION = 5500
const EXIT_DURATION = 220

// A notification only represents newly committed grants, never all earned goals.
// It does not take focus or block play; hover/focus pauses its reading time.
const hasReward = (definition) => Boolean(definition?.titleId || definition?.rewardId)

export default function AchievementToast({ notification, onDismiss, onOpenAchievements }) {
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [hidden, setHidden] = useState(() => document.hidden)
  const [leaving, setLeaving] = useState(false)
  const remaining = useRef(ACHIEVEMENT_TOAST_DURATION)
  const dismissRef = useRef(onDismiss)
  dismissRef.current = onDismiss
  const entries = [...notification.unlocked].sort((first, second) => Number(hasReward(second)) - Number(hasReward(first)))
  const visibleEntries = entries.slice(0, 2)
  const bonus = entries.reduce((total, definition) => total + definition.rewardVp, 0)
  const paused = hovered || focused || hidden

  useEffect(() => {
    const onVisibility = () => setHidden(document.hidden)
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  useEffect(() => {
    if (paused || leaving) return undefined
    const started = performance.now()
    const timer = window.setTimeout(() => setLeaving(true), remaining.current)
    return () => {
      window.clearTimeout(timer)
      remaining.current = Math.max(0, remaining.current - (performance.now() - started))
    }
  }, [paused, leaving])

  useEffect(() => {
    if (!leaving) return undefined
    const timer = window.setTimeout(() => dismissRef.current(), EXIT_DURATION)
    return () => window.clearTimeout(timer)
  }, [leaving])

  return createPortal(
    <aside className="achievement-toast-layer" aria-label="업적 알림 영역">
      <section className={`achievement-toast${leaving ? ' is-leaving' : ''}${entries.some(hasReward) ? ' has-rare-reward' : ''}`}
        role="status" aria-live="polite" aria-atomic="true" aria-label="업적 달성 알림"
        onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
        onFocusCapture={() => setFocused(true)}
        onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false) }}>
        <header>
          <span className="achievement-toast-medal" aria-hidden="true"><Trophy size={24} /></span>
          <div><small>ACHIEVEMENT UNLOCKED</small><strong>{entries.length === 1 ? '새로운 업적 달성!' : `업적 ${entries.length}개 달성!`}</strong></div>
          <button type="button" className="achievement-toast-close" aria-label="업적 알림 닫기" onClick={() => setLeaving(true)}><X size={17} /></button>
        </header>
        <ul>
          {visibleEntries.map(definition => {
            const item = getRareReward(definition.rewardId)
            const title = getTrainerTitle(definition.titleId)
            return <li key={definition.id}>
              <span className="achievement-toast-art" aria-hidden="true">{item ? <SpriteImage src={item.image} alt="" /> : <Check size={17} />}</span>
              <div><strong>{definition.title}</strong>
                {title && <span>칭호 「{title.name}」 획득</span>}
                {item && <span>{item.name} 획득</span>}
              </div>
            </li>
          })}
        </ul>
        {entries.length > visibleEntries.length && <p className="achievement-toast-more">외 {entries.length - visibleEntries.length}개 업적도 함께 달성했습니다.</p>}
        <footer><span><Gift size={14} /> +{bonus.toLocaleString('ko-KR')} VP 지급</span><button type="button" aria-label="달성 업적 보기" onClick={onOpenAchievements}>업적 보기 <ArrowRight size={14} /></button></footer>
        <span className="achievement-toast-timer" aria-hidden="true" style={{ animationDuration: `${ACHIEVEMENT_TOAST_DURATION}ms`, animationPlayState: paused || leaving ? 'paused' : 'running' }} />
      </section>
    </aside>, document.body,
  )
}
