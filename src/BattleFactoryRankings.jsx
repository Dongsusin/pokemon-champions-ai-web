import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ChevronDown, Crown, Flag, Info, Layers3, LoaderCircle, RefreshCw, Trophy, Wifi, X } from 'lucide-react'
import SpriteImage from './SpriteImage'
import BattleItemSprite from './BattleItemSprite'
import FactoryInfoTooltip from './FactoryInfoTooltip'
import { RentalDetails } from './BattleFactoryLobby'
import { normalizePokemon } from './data/trainingData'
import { getBattleItem } from './data/shopData'
import { FACTORY_DEFAULT_MODE, FACTORY_MODES, getFactoryMode } from './data/battleFactoryChallenge'
import './battleFactoryRankings.css'

function normalizeRecord(entry) {
  return {
    ...entry,
    party: (Array.isArray(entry.party) ? entry.party : []).slice(0, 3).map((pokemon, index) => normalizePokemon({
      ...pokemon,
      captureId: pokemon.captureId ?? `${entry.id ?? entry.runId}:ranking:${index}`,
    })),
  }
}

function recordDate(recordedAt) {
  if (!recordedAt) return ''
  const date = new Date(typeof recordedAt === 'object' && recordedAt.seconds ? recordedAt.seconds * 1000 : recordedAt)
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('ko-KR', { month: '2-digit', day: '2-digit' }).format(date)
}

function FinalPokemon({ pokemon, onDetails }) {
  const item = getBattleItem(pokemon.heldItemId)
  return <article className="factory-ranking-pokemon">
    <header><SpriteImage src={pokemon.icon} fallbackSrc={pokemon.iconFallback} alt="" /><div><strong>{pokemon.name}</strong><small>{pokemon.types.join(' · ')}</small></div>
      <button type="button" aria-label={`${pokemon.name} 능력치와 기술 정보`} onClick={() => onDetails(pokemon)}><Info size={16} /></button>
    </header>
    <div className="factory-ranking-held-item"><span>지닌 도구</span><FactoryInfoTooltip title={item?.name} description={item?.description ?? item?.effect}><strong>{item && <BattleItemSprite item={item} size={20} />}{item?.name ?? '없음'}</strong></FactoryInfoTooltip></div>
    <div className="factory-ranking-move-names" aria-label={`${pokemon.name} 최종 기술`}>{pokemon.moves.slice(0, 4).map((move, index) => <span key={`${index}:${typeof move === 'string' ? move : move.id}`} title={typeof move === 'string' ? move : move.name}><i />{typeof move === 'string' ? move : move.name}</span>)}</div>
  </article>
}

function RankingRow({ entry, position, isOwn, open, onToggle, onDetails, regionId }) {
  const date = recordDate(entry.recordedAt)
  return <article className={`factory-ranking-record${open ? ' is-open' : ''}${isOwn ? ' is-own' : ''}`}>
    <button type="button" className="factory-ranking-row" onClick={onToggle} aria-expanded={open} aria-controls={regionId}
      aria-label={`${position}위 ${entry.trainerName || '트레이너'}, ${entry.floor}층, 최종 팀 ${open ? '닫기' : '보기'}`}>
      <span className={`factory-ranking-position position-${position}`}>{position === 1 && <Crown size={15} />}<strong>{String(position).padStart(2, '0')}</strong></span>
      <span className="factory-ranking-player"><strong>{entry.trainerName || '트레이너'}{isOwn && <b>나</b>}</strong><small>{date ? `${date} 기록` : '완료된 도전'}</small></span>
      <span className="factory-ranking-floor"><strong>{entry.floor}<em>F</em></strong><small>{entry.wins}층 클리어</small></span>
      <span className="factory-ranking-team-preview" aria-label="최종 렌탈 팀">{entry.party.map(pokemon => {
        const item = getBattleItem(pokemon.heldItemId)
        return <span key={pokemon.captureId}><SpriteImage src={pokemon.icon} fallbackSrc={pokemon.iconFallback} alt={pokemon.name} />{item && <FactoryInfoTooltip title={item.name} description={item.description ?? item.effect} focusable={false}><span className="factory-ranking-mini-item"><BattleItemSprite item={item} size={15} /></span></FactoryInfoTooltip>}</span>
      })}</span>
      <span className="factory-ranking-expand"><span>{open ? '접기' : '팀 보기'}</span><ChevronDown size={18} /></span>
    </button>
    {open && <section id={regionId} className="factory-ranking-expanded" aria-label={`${entry.trainerName || '트레이너'}의 최종 렌탈 팀`}>
      <div className="factory-ranking-expanded-heading"><span><Flag size={13} />도전 종료 시 렌탈 팀</span><small>포켓몬 정보 버튼으로 능력치까지 확인하세요.</small></div>
      <div className="factory-ranking-final-team">{entry.party.map(pokemon => <FinalPokemon key={pokemon.captureId} pokemon={pokemon} onDetails={onDetails} />)}</div>
    </section>}
  </article>
}

export default function BattleFactoryRankings({ ranking = {}, mode = FACTORY_DEFAULT_MODE, onSelectMode, onBack }) {
  const id = useId()
  const [openId, setOpenId] = useState(null)
  const [details, setDetails] = useState(null)
  const refresh = useRef(ranking.refresh)
  const didRefresh = useRef(false)
  refresh.current = ranking.refresh
  const entries = useMemo(() => (Array.isArray(ranking.entries) ? ranking.entries : []).slice(0, 10).map(normalizeRecord), [ranking.entries])
  const ownBest = ranking.ownBest
  const isGlobal = ranking.source === 'global'
  const loading = Boolean(ranking.loading)
  const board = getFactoryMode(mode)

  useEffect(() => {
    if (didRefresh.current) return
    didRefresh.current = true
    refresh.current?.()
  }, [])

  return <main className="battle-factory factory-rankings">
    <header className="factory-heading">
      <button className="factory-back" type="button" onClick={onBack}><ArrowLeft size={18} /><span>배틀팩토리</span></button>
      <div><span>THE HIGHEST FLOOR. THE FINAL TEAM.</span><h1><Trophy size={26} />팩토리 랭킹</h1></div>
      <button type="button" className="factory-ranking-refresh" onClick={() => refresh.current?.()} disabled={loading}><RefreshCw size={15} className={loading ? 'is-spinning' : ''} /><span>새로고침</span></button>
    </header>
    <div className="factory-ranking-workspace">
      <aside className="factory-ranking-summary">
        <span className="factory-ranking-summary-label"><Layers3 size={16} />BATTLE FACTORY</span>
        <div className="factory-ranking-top-ten"><span>가장 높은 층을 향해</span><strong>TOP<em>10</em></strong><p>기록을 펼치고,<br />최종 렌탈 팀을 살펴보세요.</p></div>
        <div className="factory-ranking-stair-art" aria-hidden="true"><i /><i /><i /><i /><Crown size={27} /></div>
        <div className="factory-ranking-personal"><small><Flag size={13} />나의 최고 기록 · {board.label}</small>{ownBest ? <><strong>{ownBest.floor}<em>F</em></strong><span>{ownBest.wins}층 클리어{recordDate(ownBest.recordedAt) && ` · ${recordDate(ownBest.recordedAt)}`}</span></> : <><strong className="factory-ranking-no-best">첫 기록을 기다려요</strong><span>도전을 마치고 기록을 남겨 보세요.</span></>}</div>
        <div className="factory-ranking-source"><Wifi size={14} /><span><strong>{isGlobal ? '전체 트레이너 랭킹' : '이 기기 랭킹'}</strong><small>{isGlobal ? '트레이너별 최고 기록 1개' : '이 기기에 저장된 도전 기록'}</small></span></div>
      </aside>
      <section className="factory-ranking-board" aria-label="배틀팩토리 상위 10위">
        <header className="factory-ranking-board-heading"><div><span>FACTORY LEADERBOARD</span><h2>어디까지 올라갔나요?</h2></div><span className="factory-ranking-count">{entries.length}<small> / 10</small></span></header>
        <div className="factory-ranking-modes" role="tablist" aria-label="랭킹 모드 선택">
          {FACTORY_MODES.map(entry => <button type="button" key={entry.id} role="tab" aria-selected={entry.id === board.id}
            className={`factory-ranking-mode${entry.id === board.id ? ' selected' : ''}`}
            disabled={!onSelectMode} onClick={() => onSelectMode?.(entry.id)}>
            <small>{entry.tagline}</small><strong>{entry.label}</strong>
          </button>)}
        </div>
        <div className="factory-ranking-notices" aria-live="polite">
          {ranking.recordError && <div className="factory-ranking-error"><span><strong>내 기록을 전송하지 못했어요.</strong><small>{ranking.recordError}</small></span><button type="button" onClick={() => ranking.retry?.()} disabled={!ranking.retry || loading}>다시 전송</button></div>}
          {ranking.error && <div className="factory-ranking-error"><span><strong>랭킹을 불러오지 못했어요.</strong><small>{ranking.error}</small></span><button type="button" onClick={() => refresh.current?.()} disabled={loading}>다시 시도</button></div>}
        </div>
        <div className="factory-ranking-column-labels" aria-hidden="true"><span>순위</span><span>트레이너</span><span>도달 층수</span><span>최종 렌탈 팀</span><span /></div>
        <div className="factory-ranking-list" aria-busy={loading}>
          {loading && !entries.length ? <div className="factory-ranking-empty" role="status"><LoaderCircle size={37} className="is-spinning" /><h3>도전 기록을 불러오는 중입니다.</h3><p>잠시만 기다려 주세요.</p></div>
            : !entries.length ? <div className="factory-ranking-empty"><span className="factory-ranking-empty-icon">{ranking.error ? <X size={34} /> : <Trophy size={37} />}</span><h3>{ranking.error ? '잠시 후 다시 확인해 주세요.' : '아직 등록된 기록이 없습니다.'}</h3><p>{ranking.error ? '다시 시도 버튼으로 랭킹을 불러올 수 있습니다.' : `${board.label} 도전을 마치면 최고 도달 층수와 최종 팀이 기록됩니다.`}</p>{!ranking.error && <button type="button" className="factory-secondary" onClick={onBack}>배틀팩토리로 돌아가기</button>}</div>
              : entries.map((entry, index) => <RankingRow key={entry.id ?? entry.runId} entry={entry} position={index + 1} isOwn={Boolean(ownBest?.id && entry.id === ownBest.id)}
                open={openId === (entry.id ?? entry.runId)} onToggle={() => setOpenId(current => current === (entry.id ?? entry.runId) ? null : entry.id ?? entry.runId)}
                regionId={`${id}-factory-rank-${index + 1}`} onDetails={setDetails} />)}
        </div>
        <footer className="factory-ranking-board-footer"><Info size={13} /><span>최고 도달 층수 순 · 같은 층수는 먼저 기록한 순으로 표시합니다. 일반 모드와 도전 모드는 각각 따로 집계합니다.</span></footer>
      </section>
    </div>
    {details && <RentalDetails pokemon={details} onClose={() => setDetails(null)} />}
  </main>
}
