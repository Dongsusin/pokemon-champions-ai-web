import { useId, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowLeft, ArrowUp, BarChart3, Bot, ChevronLeft, ChevronRight, Clock3, Database, Info, RefreshCw, Search, Swords, Trophy, UsersRound, X } from 'lucide-react'
import SpriteImage from './SpriteImage'
import BattleItemSprite from './BattleItemSprite'
import { getBattleItem } from './data/shopData.js'
import { USAGE_FORMATS, USAGE_MODES, createUsageBucket, getUsageRanking, usageBucketKey } from './data/pokemonUsage.js'
import './pokemonUsage.css'

const PAGE_SIZE = 20
const EMPTY_BUCKET = createUsageBucket()
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0
const countLabel = (value) => number(value).toLocaleString('ko-KR')
const percentLabel = (value) => number(value).toFixed(1)
const TYPE_COLORS = {
  노말: '#bbc6d2', 불꽃: '#ffac79', 물: '#86b8ff', 전기: '#f8dc78', 풀: '#a2dc83',
  얼음: '#9be8e6', 격투: '#f3a295', 독: '#d8a0e8', 땅: '#ddbd88', 비행: '#b6c6ff',
  에스퍼: '#ffa7c0', 벌레: '#c4d77e', 바위: '#d0c090', 고스트: '#bcaff3', 드래곤: '#a59fff',
  악: '#c3b6b0', 강철: '#b1d1d8', 페어리: '#f4b4df',
}

function updatedLabel(value) {
  if (!value) return '아직 집계 전'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '집계 시각 확인 중'
  return new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
}

function TypeBadges({ types = [] }) {
  return <span className="pokemon-usage-types">{types.map(type => <span key={type} style={{ '--usage-type-color': TYPE_COLORS[type] ?? '#b4c4d8' }}>{type}</span>)}</span>
}

function RankChange({ entry }) {
  if (entry.isNew) return <span className="pokemon-usage-rank-change is-new" aria-label="직전 집계에 없던 신규 사용">NEW</span>
  if (entry.rankDelta == null) return <span className="pokemon-usage-rank-change is-neutral" aria-label="비교할 순위가 없습니다">—</span>
  const delta = number(entry.rankDelta)
  const Direction = delta > 0 ? ArrowUp : ArrowDown
  return <span className={`pokemon-usage-rank-change ${delta > 0 ? 'is-up' : delta < 0 ? 'is-down' : 'is-neutral'}`} aria-label={delta ? `직전 집계 대비 ${Math.abs(delta)}위 ${delta > 0 ? '상승' : '하락'}` : '직전 집계 대비 순위 유지'}>
    {delta ? <><Direction size={12} strokeWidth={2.6} />{Math.abs(delta)}</> : '—'}
  </span>
}

function RateChange({ value }) {
  if (value == null) return <span className="pokemon-usage-rate-change is-neutral" aria-label="비교할 사용률이 없습니다">—</span>
  const delta = number(value)
  const displayDelta = Number(delta.toFixed(1))
  return <span className={`pokemon-usage-rate-change ${displayDelta > 0 ? 'is-up' : displayDelta < 0 ? 'is-down' : 'is-neutral'}`} aria-label={`직전 집계 대비 사용률 ${displayDelta > 0 ? '+' : ''}${displayDelta.toFixed(1)} 퍼센트포인트`}>
    {displayDelta > 0 ? '+' : ''}{displayDelta.toFixed(1)}<small>%p</small>
  </span>
}

function ItemUsage({ entry, inventory, compact = false }) {
  const usage = entry.itemUsage
  const sampleCount = number(usage?.sampleCount)
  const items = (usage?.items ?? []).slice(0, 3)
  if (!sampleCount || !items.length) return <span className={`pokemon-usage-items-empty${compact ? ' is-compact' : ''}`}>{sampleCount ? '장착 아이템 기록 없음' : '아이템 집계 대기'}</span>
  return <ol className={`pokemon-usage-items${compact ? ' is-compact' : ''}`} aria-label={`${entry.name} 장착 아이템 사용률 상위 3위`}>
    {items.map((record, index) => {
      const item = getBattleItem(record.itemId)
      const hidden = !item || (item.rewardOnly && !(inventory?.[item.id] > 0))
      const name = hidden ? '?' : item.name
      const rank = record.rank ?? index + 1
      const label = `${rank}위 ${hidden ? '미획득 희귀 아이템' : name} · ${percentLabel(record.rate)}% (${countLabel(record.count)} / ${countLabel(sampleCount)}회)`
      return <li key={record.itemId} data-item-rank={rank} data-item-id={hidden ? undefined : item.id} title={`${label} · 무장착 출전 포함`} aria-label={label}>
        <span className="pokemon-usage-item-rank">{rank}</span>
        <span className="pokemon-usage-item-art" aria-hidden="true">{hidden ? <span className="pokemon-usage-item-hidden">?</span> : <BattleItemSprite item={item} size={24} loading="lazy" draggable="false" fallback={<span className="pokemon-usage-item-fallback">◆</span>} />}</span>
        <span className="pokemon-usage-item-copy"><strong>{name}</strong><span>{percentLabel(record.rate)}<small>%</small></span></span>
      </li>
    })}
  </ol>
}

function LeaderCard({ entry, inventory }) {
  return <article className={`pokemon-usage-leader pokemon-usage-leader-${entry.rank}`} aria-label={`${entry.rank}위 ${entry.name}, 사용률 ${percentLabel(entry.rate)}퍼센트`}>
    <span className="pokemon-usage-leader-place"><Trophy size={14} /><strong>{String(entry.rank).padStart(2, '0')}</strong></span>
    <span className="pokemon-usage-leader-art" aria-hidden="true"><SpriteImage src={entry.sprite} alt="" draggable="false" /></span>
    <div className="pokemon-usage-leader-copy"><strong>{entry.name}</strong><TypeBadges types={entry.types} /><span className="pokemon-usage-leader-count">{countLabel(entry.count)}팀에서 출전</span></div>
    <div className="pokemon-usage-leader-rate"><strong>{percentLabel(entry.rate)}<small>%</small></strong><RateChange value={entry.rateDelta} /></div>
    <div className="pokemon-usage-leader-items"><ItemUsage entry={entry} inventory={inventory} compact /></div>
  </article>
}

function RankingRow({ entry, inventory }) {
  return <li className={`pokemon-usage-row${entry.rank <= 3 ? ' is-top-three' : ''}`} data-usage-rank={entry.rank} data-species-id={entry.speciesId}>
    <div className="pokemon-usage-position"><strong>{String(entry.rank).padStart(2, '0')}</strong><RankChange entry={entry} /></div>
    <div className="pokemon-usage-pokemon"><span className="pokemon-usage-row-art" aria-hidden="true"><SpriteImage src={entry.sprite} alt="" draggable="false" loading="lazy" /></span><div><strong>{entry.name}</strong><TypeBadges types={entry.types} /></div></div>
    <div className="pokemon-usage-item-column"><ItemUsage entry={entry} inventory={inventory} /></div>
    <div className="pokemon-usage-rate"><div className="pokemon-usage-rate-track" aria-hidden="true"><span style={{ width: `${Math.max(0, Math.min(100, number(entry.rate)))}%` }} /></div><strong>{percentLabel(entry.rate)}<small>%</small></strong></div>
    <div className="pokemon-usage-count"><strong>{countLabel(entry.count)}</strong><small>팀</small></div>
    <div className="pokemon-usage-change"><RateChange value={entry.rateDelta} /></div>
  </li>
}

export default function PokemonUsageScreen({ snapshot, loading = false, error = '', onRefresh, onBack, embedded = false, inventory = {} }) {
  const [mode, setMode] = useState(USAGE_MODES[0].id)
  const [format, setFormat] = useState(USAGE_FORMATS[0].id)
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const listRef = useRef(null)
  const modeRefs = useRef([])
  const id = useId().replace(/:/g, '')
  const bucket = snapshot?.buckets?.[usageBucketKey(mode, format)] ?? EMPTY_BUCKET
  const ranking = useMemo(() => getUsageRanking(bucket).slice(0, 100), [bucket])
  const search = query.trim().toLocaleLowerCase('ko-KR')
  const filtered = useMemo(() => ranking.filter(entry => !search || [entry.name, String(entry.speciesId), ...(entry.types ?? [])].some(value => value.toLocaleLowerCase('ko-KR').includes(search))), [ranking, search])
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
  const teamCount = number(bucket?.teamCount)
  const isDemo = snapshot?.source === 'demo'
  const modeLabel = USAGE_MODES.find(entry => entry.id === mode)?.label
  const formatLabel = USAGE_FORMATS.find(entry => entry.id === format)?.label
  const errorMessage = typeof error === 'string' ? error : error?.message
  const changePage = (next) => {
    setPage(next)
    if (listRef.current) listRef.current.scrollTop = 0
  }
  const changeMode = (next) => { setMode(next); changePage(1) }
  const handleModeKeys = (event, index) => {
    let next
    if (event.key === 'ArrowRight') next = (index + 1) % USAGE_MODES.length
    else if (event.key === 'ArrowLeft') next = (index - 1 + USAGE_MODES.length) % USAGE_MODES.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = USAGE_MODES.length - 1
    else return
    event.preventDefault()
    changeMode(USAGE_MODES[next].id)
    modeRefs.current[next]?.focus()
  }
  const Container = embedded ? 'section' : 'main'

  return <Container className={`pokemon-usage-screen${embedded ? ' pokemon-usage-embedded' : ''}`} aria-label="포켓몬 사용률" data-usage-source={snapshot?.source ?? 'pending'}>
    <header className="pokemon-usage-header">
      {!embedded && onBack && <button className="pokemon-usage-back" type="button" onClick={onBack}><ArrowLeft size={17} /><span>돌아가기</span></button>}
      <div className="pokemon-usage-heading"><span>POKÉMON USAGE REPORT</span>{embedded ? <h2>포켓몬 사용률 <small>TOP 100</small></h2> : <h1>포켓몬 사용률 <small>TOP 100</small></h1>}<p>지금, 트레이너들이 선택한 포켓몬</p></div>
      <div className="pokemon-usage-source"><span className={isDemo ? 'is-demo' : ''}><Database size={12} />{isDemo ? '로컬 테스트 · 임의 표본 포함' : snapshot?.source === 'local' ? '로컬 플레이 집계' : snapshot ? '전체 유저 집계' : '집계 확인 중'}</span><small><Clock3 size={11} />{updatedLabel(bucket?.updatedAt ?? snapshot?.updatedAt)}</small></div>
      {onRefresh && <button className={`pokemon-usage-refresh${loading ? ' is-loading' : ''}`} onClick={onRefresh} type="button" disabled={loading} aria-label={loading ? '사용률 집계 새로고침 중' : '사용률 집계 새로고침'} title="사용률 집계 새로고침"><RefreshCw size={16} /></button>}
    </header>

    <div className="pokemon-usage-controls">
      <div className="pokemon-usage-mode-tabs" role="tablist" aria-label="대전 종류">
        {USAGE_MODES.map((entry, index) => { const Icon = entry.id === 'ai' ? Bot : Swords; return <button type="button" key={entry.id} ref={element => { modeRefs.current[index] = element }} role="tab" id={`${id}-mode-${entry.id}`} aria-controls={`${id}-ranking-panel`} aria-selected={mode === entry.id} tabIndex={mode === entry.id ? 0 : -1} className={mode === entry.id ? 'is-selected' : ''} onClick={() => changeMode(entry.id)} onKeyDown={event => handleModeKeys(event, index)}><Icon size={17} />{entry.label}</button> })}
      </div>
      <div className="pokemon-usage-formats" role="group" aria-label="배틀 형식">{USAGE_FORMATS.map(entry => <button type="button" key={entry.id} aria-pressed={format === entry.id} className={format === entry.id ? 'is-selected' : ''} onClick={() => { setFormat(entry.id); changePage(1) }}>{entry.label}</button>)}</div>
      <span className="pokemon-usage-sample"><UsersRound size={15} /><span>집계 출전팀</span><strong>{countLabel(teamCount)}</strong><small>팀</small></span>
    </div>

    <section className="pokemon-usage-panel" role="tabpanel" id={`${id}-ranking-panel`} aria-labelledby={`${id}-mode-${mode}`} aria-busy={loading}>
      {errorMessage && <div className="pokemon-usage-error" role="alert"><Info size={16} /><span><strong>사용률 집계 알림</strong> · {errorMessage}</span>{onRefresh && <button type="button" onClick={onRefresh} disabled={loading}>다시 시도</button>}</div>}
      {teamCount > 0 && <section className="pokemon-usage-leaders" aria-label={`${modeLabel} ${formatLabel} 사용률 상위 3위`}>{ranking.slice(0, 3).map(entry => <LeaderCard key={entry.speciesId} entry={entry} inventory={inventory} />)}</section>}
      <div className="pokemon-usage-catalog">
        <div className="pokemon-usage-toolbar"><div><BarChart3 size={16} /><h3>{modeLabel} <span>· {formatLabel}</span></h3><small>TOP 100</small></div><label className="pokemon-usage-search"><Search size={15} /><input type="search" aria-label="포켓몬 이름 또는 타입 검색" placeholder="포켓몬 이름 또는 타입 검색" value={query} onChange={event => { setQuery(event.target.value); changePage(1) }} />{query && <button type="button" aria-label="사용률 검색어 지우기" onClick={() => { setQuery(''); changePage(1) }}><X size={13} /></button>}</label></div>
        <div className="pokemon-usage-column-head" aria-hidden="true"><span>순위 / 변동</span><span>포켓몬</span><span className="pokemon-usage-items-heading" title="아이템 사용률은 해당 포켓몬의 아이템 정보가 기록된 출전 횟수 기준입니다. 무장착 출전도 포함합니다.">장착 아이템 TOP 3 <Info size={10} /></span><span>사용률</span><span>출전팀</span><span>사용률 변동</span></div>
        <div className="pokemon-usage-list-scroll" ref={listRef} tabIndex={0} aria-label="포켓몬 사용률 순위 스크롤 영역">
          {!snapshot && loading ? <div className="pokemon-usage-empty" role="status"><RefreshCw size={26} className="pokemon-usage-spinner" /><strong>사용률 집계를 불러오는 중입니다</strong><p>출전팀 기록을 확인하고 있습니다.</p></div> : <>
            {teamCount === 0 && !errorMessage && <div className="pokemon-usage-no-battles" role="status"><BarChart3 size={22} /><div><strong>집계된 대전이 없습니다</strong><p>이 모드의 출전팀이 기록되면 사용률과 순위가 표시됩니다.</p></div></div>}
            {visible.length ? <ol className="pokemon-usage-list" start={(currentPage - 1) * PAGE_SIZE + 1} aria-label={`${modeLabel} ${formatLabel} 포켓몬 사용률 순위`}>{visible.map(entry => <RankingRow key={entry.speciesId} entry={entry} inventory={inventory} />)}</ol> : <div className="pokemon-usage-empty"><Search size={28} /><strong>검색 결과가 없습니다</strong><p>상위 100위 안에서 다른 이름이나 타입을 검색해 보세요.</p><button type="button" onClick={() => { setQuery(''); changePage(1) }}>전체 순위 보기</button></div>}
          </>}
        </div>
        <footer className="pokemon-usage-pagination"><span aria-live="polite">{search ? <><strong>{filtered.length}</strong>마리 검색됨 <small>· 원래 순위 표시</small></> : <><strong>{visible[0]?.rank ?? 0}–{visible.at(-1)?.rank ?? 0}</strong>위 <small>/ 100위</small></>}</span><nav aria-label="포켓몬 사용률 순위 페이지"><button type="button" className="pokemon-usage-page-arrow" aria-label="이전 사용률 페이지" disabled={currentPage === 1} onClick={() => changePage(currentPage - 1)}><ChevronLeft size={16} /></button>{Array.from({ length: pageCount }, (_, index) => index + 1).map(value => <button type="button" key={value} aria-label={search ? `검색 결과 ${value}페이지` : `${(value - 1) * PAGE_SIZE + 1}~${Math.min(value * PAGE_SIZE, 100)}위 보기`} aria-current={currentPage === value ? 'page' : undefined} className={currentPage === value ? 'is-selected' : ''} onClick={() => changePage(value)}>{search ? value : `${(value - 1) * PAGE_SIZE + 1}–${Math.min(value * PAGE_SIZE, 100)}`}</button>)}<button type="button" className="pokemon-usage-page-arrow" aria-label="다음 사용률 페이지" disabled={currentPage === pageCount} onClick={() => changePage(currentPage + 1)}><ChevronRight size={16} /></button></nav></footer>
      </div>
    </section>
    <footer className="pokemon-usage-method"><Info size={13} /><p><span>배틀 시작 시 확정된 출전팀 기준 · 같은 팀의 같은 도감 번호는 1회 · 직전 집계 대비</span><small>사용률 = 해당 포켓몬 출전팀 ÷ 전체 출전팀{mode === 'ai' ? ' · AI 상대팀 제외 · AI 대전은 플레이 기기에서 집계한 기록' : ' · 랭크배틀 양쪽 유저 출전팀 포함'}</small><small>아이템 사용률 = 장착 횟수 ÷ 해당 포켓몬의 아이템 정보가 기록된 출전 횟수 · 무장착 포함</small></p></footer>
  </Container>
}
