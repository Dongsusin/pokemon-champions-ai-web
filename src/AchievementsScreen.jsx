import SpriteImage from './SpriteImage'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowLeft, ArrowRight, Check, CheckCheck, ChevronLeft, ChevronRight,
  Crown, Flag, Gift, LockKeyhole, Medal, Search, ShieldCheck, Sparkles,
  Target, Trophy, UsersRound, X, Zap,
} from 'lucide-react'
import TrainerSprite from './TrainerSprite'
import { TRAINERS } from './data/trainerTeams.js'
import { getPokemonSkin } from './data/rareRewards.js'
import { getBattleItem } from './data/shopData.js'
import {
  ACHIEVEMENTS,
  ACHIEVEMENT_CATEGORIES,
  getAchievementProgress,
} from './data/achievementData.js'
import './achievements.css'

const PAGE_SIZE = 12
const TRAINER_BY_ID = new Map(TRAINERS.map((trainer) => [trainer.id, trainer]))
const ACHIEVEMENT_BY_ID = new Map(ACHIEVEMENTS.map((entry) => [entry.id, entry]))
const CATEGORY_ICONS = {
  victory: Trophy,
  challenge: ShieldCheck,
  gimmick: Sparkles,
  exploration: Flag,
  competition: Crown,
  trainers: UsersRound,
  collection: Sparkles,
  mastery: Crown,
}
const STATUS_FILTERS = [
  { id: 'all', label: '전체' },
  { id: 'in-progress', label: '도전 중' },
  { id: 'completed', label: '달성 완료' },
]

function formatNumber(value) {
  return Math.max(0, Number(value) || 0).toLocaleString('ko-KR')
}

function formatDate(value) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit',
  })
}

function normalizeSearch(value) {
  return String(value ?? '').toLocaleLowerCase('ko-KR').replace(/[\s_-]/g, '')
}

function rewardDefinitions(unlocked) {
  return (unlocked ?? []).map((entry) => (
    typeof entry === 'string' ? ACHIEVEMENT_BY_ID.get(entry) : entry
  )).filter(Boolean)
}

function getRevealedReward(definition) {
  if (!definition?.rewardId) return null
  const skin = getPokemonSkin(definition.rewardId)
  if (skin) return { ...skin, image: skin.image ?? skin.spriteFront, kind: '특별 스킨' }
  const item = getBattleItem(definition.rewardId)
  return item ? { ...item, image: item.sprite, kind: '희귀 배틀 도구' } : null
}

function RevealedReward({ definition, compact = false }) {
  const reward = getRevealedReward(definition)
  const [imageFailed, setImageFailed] = useState(false)
  useEffect(() => setImageFailed(false), [reward?.image])
  if (!reward) return null
  return (
    <div className={`achievement-revealed-reward${compact ? ' achievement-reward-compact' : ''}`}>
      <span className="achievement-reward-art" aria-hidden="true">{reward.image && !imageFailed ? <SpriteImage src={reward.image} alt="" loading="lazy" onError={() => setImageFailed(true)} /> : <Gift size={24} />}</span>
      <div><small>{reward.kind} 획득</small><strong>{reward.name}</strong>{!compact && <p>{reward.description ?? reward.effect}</p>}{reward.artCredit && <small className="achievement-art-credit">스프라이트: {reward.artCredit}</small>}</div>
    </div>
  )
}

function AchievementCard({ definition, record }) {
  const trainer = TRAINER_BY_ID.get(definition.trainerId)
  const Icon = CATEGORY_ICONS[definition.category] ?? Medal
  const ratio = Math.min(100, Math.max(0, record.current / Math.max(1, record.target) * 100))
  const date = formatDate(record.completedAt)
  const isSealedReward = definition.secretReward && !record.completed

  return (
    <article className={`achievement-card achievement-category-${definition.category}${record.completed ? ' achievement-is-complete' : ''}`}>
      <div className="achievement-card-heading">
        {trainer ? (
          <div className="achievement-trainer-art">
            <TrainerSprite trainer={trainer} className="achievement-trainer-sprite" />
          </div>
        ) : <span className="achievement-card-icon" aria-hidden="true"><Icon size={26} /></span>}
        <div className="achievement-card-title">
          <span>{trainer ? `AI 트레이너 · ${trainer.tier} 티어` : ACHIEVEMENT_CATEGORIES.find((entry) => entry.id === definition.category)?.label}</span>
          <h3>{definition.title}</h3>
        </div>
        {record.completed && <span className="achievement-complete-check" aria-label="달성 완료"><Check size={14} strokeWidth={3} /></span>}
      </div>
      <p className="achievement-card-description">{definition.description}</p>
      <div className="achievement-card-progress">
        <div className="achievement-progress-label">
          <span>{record.completed ? '달성 완료' : '달성 진행도'}</span>
          <strong>{formatNumber(record.current)} <span>/ {formatNumber(record.target)}</span></strong>
        </div>
        <div className="achievement-progress-track" role="progressbar" aria-label={`${definition.title} 진행도`} aria-valuemin={0} aria-valuemax={record.target} aria-valuenow={record.current}>
          <span style={{ width: `${ratio}%` }} />
        </div>
      </div>
      {record.completed && definition.rewardId && <RevealedReward definition={definition} compact />}
      <footer className="achievement-card-footer">
        {isSealedReward ? <strong className="achievement-sealed-reward"><LockKeyhole size={14} /> 미공개 보상</strong> : <strong className="achievement-vp-reward"><Zap size={14} fill="currentColor" /> {formatNumber(definition.rewardVp)} <small>VP</small></strong>}
        {record.completed ? (
          <span className="achievement-paid"><CheckCheck size={13} /> 지급 완료{date && <time dateTime={new Date(record.completedAt).toISOString()}>{date}</time>}</span>
        ) : <span className="achievement-auto-reward">{isSealedReward ? '달성 후 공개' : '달성 시 자동 지급'}</span>}
      </footer>
    </article>
  )
}

function AchievementsScreen({ progress, onBack, balance = 0 }) {
  const [category, setCategory] = useState('all')
  const [status, setStatus] = useState('all')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const catalogRef = useRef(null)
  const entries = useMemo(() => ACHIEVEMENTS.map((definition) => ({
    definition, record: getAchievementProgress(definition, progress),
  })), [progress])
  const completedEntries = entries.filter(({ record }) => record.completed)
  const earnedVp = completedEntries.reduce((sum, { definition }) => sum + definition.rewardVp, 0)
  const completionPercent = Math.round(completedEntries.length / Math.max(1, entries.length) * 100)
  const trainerCompleted = completedEntries.filter(({ definition }) => definition.trainerId).length
  const revealedRewards = completedEntries.filter(({ definition }) => definition.rewardId)
  const categoryCounts = useMemo(() => Object.fromEntries(ACHIEVEMENT_CATEGORIES.map((entry) => [
    entry.id, entries.filter(({ definition }) => definition.category === entry.id).length,
  ])), [entries])
  const filteredEntries = useMemo(() => {
    const search = normalizeSearch(query)
    return entries.filter(({ definition, record }) => {
      if (category !== 'all' && definition.category !== category) return false
      if (status === 'completed' && !record.completed) return false
      if (status === 'in-progress' && record.completed) return false
      if (!search) return true
      const trainer = TRAINER_BY_ID.get(definition.trainerId)
      const revealedName = record.completed ? getRevealedReward(definition)?.name : ''
      return [definition.title, definition.description, trainer?.name, trainer?.alias, revealedName]
        .some((text) => normalizeSearch(text).includes(search))
    })
  }, [entries, category, status, query])
  const pageCount = Math.max(1, Math.ceil(filteredEntries.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const visibleEntries = filteredEntries.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  function resetFilters() {
    setCategory('all')
    setStatus('all')
    setQuery('')
    setPage(1)
  }

  function changePage(nextPage) {
    setPage(nextPage)
    catalogRef.current?.scrollTo({ top: 0, behavior: 'instant' })
  }

  return (
    <main className="achievement-screen">
      <header className="achievement-header">
        <button className="achievement-back-button" type="button" onClick={onBack}><ArrowLeft size={18} /><span>돌아가기</span></button>
        <div className="achievement-title"><span>CHAMPION'S RECORD</span><h1>업적</h1><p>매번의 도전이, 당신만의 기록이 됩니다.</p></div>
        <div className="achievement-wallet"><Zap size={20} fill="currentColor" /><span><small>보유 VP</small><strong>{formatNumber(balance)} <em>VP</em></strong></span></div>
      </header>

      <section className="achievement-overview" aria-label="전체 업적 현황">
        <div className="achievement-overview-lead">
          <div className="achievement-completion-ring" style={{ '--achievement-completion': `${completionPercent}%` }}><span><Trophy size={24} /><strong>{completionPercent}<small>%</small></strong></span></div>
          <div><span className="achievement-eyebrow">YOUR ACHIEVEMENTS</span><h2>챔피언으로 가는 여정</h2><p><Gift size={14} /> 달성 시 VP가 자동 지급됩니다.</p></div>
        </div>
        <div className="achievement-overview-stat"><span><Medal size={15} /> 달성한 업적</span><strong>{completedEntries.length}<small>/ {entries.length}</small></strong></div>
        <div className="achievement-overview-stat"><span><UsersRound size={15} /> 첫 승리를 거둔 AI</span><strong>{trainerCompleted}<small>/ {TRAINERS.length}</small></strong></div>
        <div className="achievement-overview-stat achievement-earned-stat"><span><Zap size={15} /> 받은 업적 보상</span><strong>{formatNumber(earnedVp)}<small>VP</small></strong></div>
      </section>

      <section className="achievement-catalog" aria-label="업적 목록">
        <div className="achievement-category-tabs" aria-label="업적 분류">
          <button type="button" className={category === 'all' ? 'achievement-selected' : ''} aria-pressed={category === 'all'} onClick={() => { setCategory('all'); setPage(1) }}><Medal size={15} /> 전체 업적 <small>{entries.length}</small></button>
          {ACHIEVEMENT_CATEGORIES.map((entry) => {
            const Icon = CATEGORY_ICONS[entry.id] ?? Target
            return <button type="button" key={entry.id} className={category === entry.id ? 'achievement-selected' : ''} aria-pressed={category === entry.id} onClick={() => { setCategory(entry.id); setPage(1) }}><Icon size={15} />{entry.label}<small>{categoryCounts[entry.id]}</small></button>
          })}
        </div>
        <div className="achievement-toolbar">
          <div className="achievement-status-filters" aria-label="달성 상태">
            {STATUS_FILTERS.map((entry) => <button type="button" key={entry.id} className={status === entry.id ? 'achievement-selected' : ''} aria-pressed={status === entry.id} onClick={() => { setStatus(entry.id); setPage(1) }}>{entry.label}</button>)}
          </div>
          <label className="achievement-search"><Search size={16} /><input type="search" aria-label="업적 또는 트레이너 검색" placeholder="업적 또는 트레이너 검색" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} /><span>{filteredEntries.length}</span></label>
        </div>
        <div className="achievement-catalog-scroll" ref={catalogRef} tabIndex={0} aria-label="업적 카드 스크롤 영역">
          {category === 'all' && status !== 'in-progress' && !query && revealedRewards.length > 0 && (
            <section className="achievement-reward-showcase" aria-label="획득한 특별 보상">
              <h2><Crown size={17} /> 획득한 특별 보상 <small>{revealedRewards.length}</small></h2>
              <div>{revealedRewards.map(({ definition }) => <RevealedReward key={definition.id} definition={definition} compact />)}</div>
            </section>
          )}
          {visibleEntries.length ? <div className="achievement-grid">{visibleEntries.map(({ definition, record }) => <AchievementCard key={definition.id} definition={definition} record={record} />)}</div> : (
            <div className="achievement-empty"><Search size={35} /><h3>조건에 맞는 업적이 없습니다</h3><p>{status === 'completed' ? '배틀에서 조건을 달성하면 이곳에 첫 기록이 남습니다.' : '다른 분류를 선택하거나 검색어를 바꿔 보세요.'}</p><button type="button" onClick={resetFilters}>전체 업적 보기 <ArrowRight size={15} /></button></div>
          )}
        </div>
        <footer className="achievement-pagination">
          <span role="status">총 <strong>{filteredEntries.length}</strong>개{filteredEntries.length > 0 && <> · {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filteredEntries.length)}개 표시</>}</span>
          <div><button type="button" disabled={currentPage === 1} aria-label="이전 업적 페이지" onClick={() => changePage(currentPage - 1)}><ChevronLeft size={17} /></button><span><strong>{currentPage}</strong> / {pageCount}</span><button type="button" disabled={currentPage === pageCount} aria-label="다음 업적 페이지" onClick={() => changePage(currentPage + 1)}><ChevronRight size={17} /></button></div>
        </footer>
      </section>
    </main>
  )
}

export function AchievementBattleRewards({ unlocked = [], baseVp = 0, rewardVp }) {
  const definitions = rewardDefinitions(unlocked)
  const bonus = rewardVp ?? definitions.reduce((sum, entry) => sum + entry.rewardVp, 0)
  if (definitions.length === 0) return null
  return (
    <section className="achievement-battle-rewards" aria-label="이번 배틀에서 달성한 업적">
      <header><span><Trophy size={16} /> 새 업적 {definitions.length}개 달성</span><strong>+{formatNumber(bonus)} VP</strong></header>
      <ul tabIndex={0} aria-label="이번 배틀 업적 보상 목록">{definitions.map((entry) => <li className={entry.rewardId ? 'achievement-battle-rare' : ''} key={entry.id}><Check size={13} /><div className="achievement-battle-reward-copy"><span>{entry.title}</span>{entry.rewardId && <RevealedReward definition={entry} compact />}</div><strong>+{formatNumber(entry.rewardVp)} VP</strong></li>)}</ul>
      <footer><span>승리 보상 {formatNumber(baseVp)} VP + 업적 보상</span><strong>총 +{formatNumber(Number(baseVp) + bonus)} VP 지급</strong></footer>
    </section>
  )
}

export function AchievementRewardNotice({ unlocked = [], onClose, totalVp, baseVp = 0 }) {
  const panelRef = useRef(null)
  const closeRef = useRef(null)
  const entries = rewardDefinitions(unlocked)
  const bonus = totalVp ?? entries.reduce((total, entry) => total + entry.rewardVp, 0)
  const open = entries.length > 0

  useEffect(() => {
    if (!open) return undefined
    const previousFocus = document.activeElement
    closeRef.current?.focus()
    return () => { if (previousFocus?.isConnected) previousFocus.focus?.() }
  }, [open])

  if (!open) return null

  function onKeyDown(event) {
    if (event.key === 'Escape') { event.preventDefault(); onClose?.(); return }
    if (event.key !== 'Tab') return
    const controls = [...panelRef.current.querySelectorAll('button:not(:disabled), [tabindex="0"]')]
    const first = controls[0]
    const last = controls[controls.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }

  return createPortal(
    <div className="achievement-reveal-backdrop">
      <section className="achievement-reveal-dialog" role="dialog" aria-modal="true" aria-labelledby="achievement-reveal-title" aria-describedby="achievement-reveal-description" ref={panelRef} onKeyDown={onKeyDown}>
        <button className="achievement-reveal-close" type="button" onClick={onClose} aria-label="업적 보상 알림 닫기" ref={closeRef}><X size={19} /></button>
        <header><span><Trophy size={27} /></span><div><small>ACHIEVEMENT UNLOCKED</small><h2 id="achievement-reveal-title">새로운 기록, 특별한 보상</h2><p id="achievement-reveal-description">{entries.length}개 업적의 보상이 지급되었습니다.</p></div></header>
        <div className="achievement-reveal-list" tabIndex={0} aria-label="새로 획득한 업적 보상">
          {entries.map((entry) => <article key={entry.id}><h3><Check size={15} />{entry.title}<strong>+{formatNumber(entry.rewardVp)} VP</strong></h3>{entry.rewardId && <RevealedReward definition={entry} />}<p>{entry.description}</p></article>)}
        </div>
        <footer><span><Gift size={18} /> 총 보상 지급 완료</span><strong>+{formatNumber(Number(bonus) + Number(baseVp))} VP</strong></footer>
        <button className="achievement-reveal-confirm" type="button" onClick={onClose}>확인 <Check size={17} /></button>
      </section>
    </div>, document.body,
  )
}

export default AchievementsScreen
