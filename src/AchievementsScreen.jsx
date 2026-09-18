import SpriteImage from './SpriteImage'
import { useIsCompactLayout } from './useMobileLayout'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft, ArrowRight, Check, CheckCheck, ChevronLeft, ChevronRight,
  Crown, Flag, Gift, Medal, Search, ShieldCheck, Sparkles,
  Target, Trophy, UsersRound, Zap,
} from 'lucide-react'
import TrainerSprite from './TrainerSprite'
import { TRAINERS } from './data/trainerTeams.js'
import { getTrainerTitle } from './data/titleData.js'
import { getBattleItem } from './data/shopData.js'
import {
  ACHIEVEMENTS,
  ACHIEVEMENT_CATEGORIES,
  getAchievementProgress,
} from './data/achievementData.js'
import './achievements.css'

const PAGE_SIZE = 12
const COMPACT_PAGE_SIZE = 6
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
  { id: 'in-progress', label: '미달성' },
  { id: 'completed', label: '달성' },
]
const SORT_OPTIONS = [
  { id: 'recommended', label: '추천' },
  { id: 'progress', label: '진행도' },
  { id: 'recent', label: '최근 달성' },
  { id: 'name', label: '이름' },
]

function formatNumber(value) {
  return Math.max(0, Number(value) || 0).toLocaleString('ko-KR')
}

function formatDate(value) {
  if (value == null) return ''
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

// An achievement can carry a title, a rare item, or both.
function getRevealedRewards(definition) {
  if (!definition) return []
  const title = getTrainerTitle(definition.titleId)
  const item = definition.rewardId ? getBattleItem(definition.rewardId) : null
  return [
    ...(title ? [{ ...title, image: null, kind: '칭호' }] : []),
    ...(item ? [{ ...item, image: item.sprite, kind: '희귀 배틀 도구' }] : []),
  ]
}
const hasRevealedReward = (definition) => Boolean(definition?.titleId || definition?.rewardId)

function RevealedRewardEntry({ reward, compact }) {
  const [imageFailed, setImageFailed] = useState(false)
  useEffect(() => setImageFailed(false), [reward.image])
  return (
    <div className={`achievement-revealed-reward${compact ? ' achievement-reward-compact' : ''}`}>
      <span className="achievement-reward-art" aria-hidden="true">{reward.image && !imageFailed ? <SpriteImage src={reward.image} alt="" loading="lazy" onError={() => setImageFailed(true)} /> : <Gift size={24} />}</span>
      <div><small>{reward.kind} 획득</small><strong>{reward.name}</strong>{!compact && <p>{reward.description ?? reward.effect}</p>}</div>
    </div>
  )
}

function RevealedReward({ definition, compact = false }) {
  const rewards = getRevealedRewards(definition)
  if (rewards.length === 0) return null
  return rewards.map((reward) => <RevealedRewardEntry key={`${reward.kind}:${reward.id}`} reward={reward} compact={compact} />)
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
      {record.completed && hasRevealedReward(definition) && <RevealedReward definition={definition} compact />}
      <footer className="achievement-card-footer">
        {isSealedReward ? <strong className="achievement-sealed-reward" aria-label="미공개 보상">?</strong> : <strong className="achievement-vp-reward"><Zap size={14} fill="currentColor" /> {formatNumber(definition.rewardVp)} <small>VP</small></strong>}
        {record.completed ? (
          <span className="achievement-paid"><CheckCheck size={13} /> 지급 완료{date && <time dateTime={new Date(record.completedAt).toISOString()}>{date}</time>}</span>
        ) : <span className="achievement-auto-reward">{isSealedReward ? '달성 후 공개' : '달성 시 자동 지급'}</span>}
      </footer>
    </article>
  )
}

export function AchievementCatalog({ progress, onBack, balance = 0, embedded = false }) {
  const [category, setCategory] = useState('all')
  const [status, setStatus] = useState('all')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('recommended')
  const [page, setPage] = useState(1)
  const catalogRef = useRef(null)
  const entries = useMemo(() => ACHIEVEMENTS.map((definition) => ({
    definition, record: getAchievementProgress(definition, progress),
  })), [progress])
  const completedEntries = entries.filter(({ record }) => record.completed)
  const completedRewardVp = completedEntries.reduce((sum, { definition }) => sum + definition.rewardVp, 0)
  const completionPercent = Math.round(completedEntries.length / Math.max(1, entries.length) * 100)
  const trainerCompleted = completedEntries.filter(({ definition }) => definition.trainerId).length
  const revealedRewards = completedEntries.filter(({ definition }) => hasRevealedReward(definition))
  const categoryCounts = useMemo(() => Object.fromEntries(ACHIEVEMENT_CATEGORIES.map((entry) => [
    entry.id, entries.filter(({ definition }) => definition.category === entry.id).length,
  ])), [entries])
  const filteredEntries = useMemo(() => {
    const search = normalizeSearch(query)
    const filtered = entries.filter(({ definition, record }) => {
      if (category !== 'all' && definition.category !== category) return false
      if (status === 'completed' && !record.completed) return false
      if (status === 'in-progress' && record.completed) return false
      if (!search) return true
      const trainer = TRAINER_BY_ID.get(definition.trainerId)
      // Only an earned reward is searchable, so a sealed one stays hidden.
      const revealedNames = record.completed ? getRevealedRewards(definition).map((reward) => reward.name) : []
      return [definition.title, definition.description, trainer?.name, trainer?.alias, ...revealedNames]
        .some((text) => normalizeSearch(text).includes(search))
    })
    // Only public progress and titles participate in ordering. A sealed reward's
    // amount, identity, and rarity must not be discoverable through sort order.
    const ratio = ({ record }) => record.current / Math.max(1, record.target)
    return filtered.sort((a, b) => {
      if (sort === 'name') return a.definition.title.localeCompare(b.definition.title, 'ko')
      if (sort === 'recent') return Number(b.record.completed) - Number(a.record.completed)
        || (b.record.completedAt ?? 0) - (a.record.completedAt ?? 0) || ratio(b) - ratio(a)
      if (sort === 'progress') return ratio(b) - ratio(a)
      return Number(a.record.completed) - Number(b.record.completed) || ratio(b) - ratio(a)
    })
  }, [entries, category, status, query, sort])
  // Six cards on a 3x2 board is what a phone frame holds once each card
  // keeps a readable title and progress bar.
  const compactLayout = useIsCompactLayout()
  const pageSize = compactLayout ? COMPACT_PAGE_SIZE : PAGE_SIZE
  const pageCount = Math.max(1, Math.ceil(filteredEntries.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const visibleEntries = filteredEntries.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  function resetFilters() {
    setCategory('all')
    setStatus('all')
    setQuery('')
    setSort('recommended')
    setPage(1)
  }

  function changePage(nextPage) {
    setPage(nextPage)
    catalogRef.current?.scrollTo({ top: 0, behavior: 'instant' })
  }

  const Container = embedded ? 'section' : 'main'
  return (
    <Container className={`achievement-screen${embedded ? ' achievement-embedded' : ''}`} aria-label={embedded ? '업적 현황과 목록' : undefined}>
      {embedded ? (
        <div className="achievement-embedded-summary">
          <span><Trophy size={18} /><strong>{completedEntries.length}<small> / {entries.length} 달성</small></strong></span>
          <p>달성 시 VP가 자동 지급됩니다.</p>
          <span className="achievement-embedded-wallet"><Zap size={15} /><strong>{formatNumber(balance)} <small>VP 보유</small></strong></span>
        </div>
      ) : <>
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
        <div className="achievement-overview-stat achievement-earned-stat"><span title="달성한 업적의 현재 보상 기준 합계입니다. 과거 지급액이나 현재 보유 VP와는 다를 수 있습니다."><Zap size={15} /> 달성 보상 · 현재 기준</span><strong>{formatNumber(completedRewardVp)}<small>VP</small></strong></div>
      </section>
      </>}

      <section className="achievement-catalog" aria-label="업적 목록">
        <div className="achievement-category-tabs" aria-label="업적 분류">
          <button type="button" className={category === 'all' ? 'achievement-selected' : ''} aria-pressed={category === 'all'} onClick={() => { setCategory('all'); setPage(1) }}><Medal size={15} /> 전체 업적 <small>{entries.length}</small></button>
          {ACHIEVEMENT_CATEGORIES.map((entry) => {
            const Icon = CATEGORY_ICONS[entry.id] ?? Target
            return <button type="button" key={entry.id} className={category === entry.id ? 'achievement-selected' : ''} aria-pressed={category === entry.id} onClick={() => { setCategory(entry.id); setPage(1) }}><Icon size={15} />{entry.label}<small>{categoryCounts[entry.id]}</small></button>
          })}
        </div>
        <div className="achievement-toolbar">
          <div className="achievement-status-filters" role="group" aria-label="달성 상태">
            {STATUS_FILTERS.map((entry) => <button type="button" key={entry.id} className={status === entry.id ? 'achievement-selected' : ''} aria-pressed={status === entry.id} onClick={() => { setStatus(entry.id); setPage(1) }}>{entry.label}</button>)}
          </div>
          <label className="achievement-sort"><span>정렬</span><select aria-label="업적 정렬" value={sort} onChange={(event) => { setSort(event.target.value); setPage(1) }}>{SORT_OPTIONS.map((entry) => <option value={entry.id} key={entry.id}>{entry.label}</option>)}</select></label>
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
          <span role="status">총 <strong>{filteredEntries.length}</strong>개{filteredEntries.length > 0 && <> · {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, filteredEntries.length)}개 표시</>}</span>
          <div><button type="button" disabled={currentPage === 1} aria-label="이전 업적 페이지" onClick={() => changePage(currentPage - 1)}><ChevronLeft size={17} /></button><span><strong>{currentPage}</strong> / {pageCount}</span><button type="button" disabled={currentPage === pageCount} aria-label="다음 업적 페이지" onClick={() => changePage(currentPage + 1)}><ChevronRight size={17} /></button></div>
        </footer>
      </section>
    </Container>
  )
}

function AchievementsScreen(props) {
  return <AchievementCatalog {...props} />
}

export function AchievementBattleRewards({ unlocked = [], baseVp = 0, rewardVp }) {
  const definitions = rewardDefinitions(unlocked)
  const bonus = rewardVp ?? definitions.reduce((sum, entry) => sum + entry.rewardVp, 0)
  if (definitions.length === 0) return null
  return (
    <section className="achievement-battle-rewards" aria-label="이번 배틀에서 달성한 업적">
      <header><span><Trophy size={16} /> 새 업적 {definitions.length}개 달성</span><strong>+{formatNumber(bonus)} VP</strong></header>
      <ul tabIndex={0} aria-label="이번 배틀 업적 보상 목록">{definitions.map((entry) => <li className={hasRevealedReward(entry) ? 'achievement-battle-rare' : ''} key={entry.id}><Check size={13} /><div className="achievement-battle-reward-copy"><span>{entry.title}</span>{hasRevealedReward(entry) && <RevealedReward definition={entry} compact />}</div><strong>+{formatNumber(entry.rewardVp)} VP</strong></li>)}</ul>
      <footer><span>승리 보상 {formatNumber(baseVp)} VP + 업적 보상</span><strong>총 +{formatNumber(Number(baseVp) + bonus)} VP 지급</strong></footer>
    </section>
  )
}

export default AchievementsScreen
