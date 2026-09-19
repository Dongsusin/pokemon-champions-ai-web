import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, ArrowRight, Check, ChevronUp, Coins, Factory, Flag, Heart, Info, Layers3, RefreshCw, Shuffle, Swords, Trophy, X } from 'lucide-react'
import SpriteImage from './SpriteImage'
import BattleItemSprite from './BattleItemSprite'
import FactoryInfoTooltip from './FactoryInfoTooltip'
import FactoryTeamManager, { FactoryHealthMeter as HealthMeter } from './FactoryTeamManager'
import { createBattlePreviewPokemon } from './data/battleEngine'
import { getBattleFactoryVpReward } from './data/battleFactoryRewards'
import { getFactoryDifficulty } from './data/battleFactoryDifficulty'
import { getBattleItem } from './data/shopData'
import {
  FACTORY_MODES, getFactoryMode, getFactoryRarityLabel, getFactorySwapCost,
  isFactoryChallengeMode, isFactoryPokemonFainted,
} from './data/battleFactoryChallenge'
import { getAbility, getSpeciesProfile, NATURE_OPTIONS, STAT_META, typeClassName } from './data/trainingData'
import './battleFactory.css'

const TRAINER_IMAGE = '/assets/trainers/factory-clown-cutout.png'
const speciesKey = pokemon => Number(pokemon?.dexSpeciesId ?? pokemon?.speciesId)
const nameOf = pokemon => pokemon?.name ?? getSpeciesProfile(pokemon?.speciesId)?.name ?? '포켓몬'

export function RentalDetails({ pokemon, onClose }) {
  const dialog = useRef(null)
  const preview = useMemo(() => createBattlePreviewPokemon(pokemon), [pokemon])
  const item = getBattleItem(preview.heldItemId)
  const ability = getAbility(preview.ability)
  const nature = NATURE_OPTIONS.find(option => option.label === preview.nature)
  const statLabel = key => STAT_META.find(stat => stat.key === key)?.label ?? key
  const natureDescription = nature?.up && nature?.down
    ? `${statLabel(nature.up)} 10% 상승 · ${statLabel(nature.down)} 10% 하락`
    : '올라가거나 내려가는 능력치 없이 모든 능력치가 그대로 적용됩니다.'

  useEffect(() => {
    const element = dialog.current
    element.showModal()
    return () => element.close()
  }, [])

  return createPortal(<dialog className="factory-details" ref={dialog} aria-labelledby="factory-details-title"
    onCancel={event => { event.preventDefault(); onClose() }} onClick={event => { if (event.target === event.currentTarget) onClose() }}>
    <div className="factory-details-content">
      <button type="button" className="factory-close" aria-label="포켓몬 정보 닫기" onClick={onClose} autoFocus><X size={20} /></button>
      <header>
        <SpriteImage src={preview.icon} fallbackSrc={preview.iconFallback} alt="" />
        <div><small>RENTAL POKÉMON · Lv.{preview.level ?? 50}</small><h2 id="factory-details-title">{preview.name}</h2>
          <div className="factory-type-list">{preview.types.map(type => <span className={`type-${typeClassName(type)}`} key={type}>{type}</span>)}</div>
        </div>
      </header>
      <dl className="factory-details-meta">
        <div><dt>특성</dt><dd><FactoryInfoTooltip title={preview.ability} description={ability.description} meta={`발동 조건 · ${ability.trigger}`}><span>{preview.ability}</span></FactoryInfoTooltip></dd></div>
        <div><dt>성격</dt><dd><FactoryInfoTooltip title={`${preview.nature} 성격`} description={natureDescription}><span>{preview.nature}</span></FactoryInfoTooltip></dd></div>
        <div><dt>지닌 도구</dt><FactoryInfoTooltip title={item?.name} description={item?.description ?? item?.effect}><dd>{item && <BattleItemSprite item={item} size={22} />}{item?.name ?? '없음'}</dd></FactoryInfoTooltip></div>
        <div><dt>테라타입</dt><dd>{preview.teraType ?? '—'}</dd></div>
        <div><dt>다이맥스</dt><dd>{preview.dynamaxMode === 'gigantamax' ? '거다이맥스' : '다이맥스'}</dd></div>
      </dl>
      <div className="factory-stat-grid" aria-label="능력치">{STAT_META.map(stat => <div key={stat.key}><small>{stat.shortLabel}</small><strong>{preview.stats?.[stat.key] ?? '—'}</strong></div>)}</div>
      <h3 className="factory-moves-title">배틀 기술</h3>
      <div className="factory-move-list">{preview.moves.map(move => <FactoryInfoTooltip key={move.id} title={move.name} description={move.description}
        meta={`${move.type} · ${move.category} · 위력 ${move.power || '—'} · 명중 ${move.accuracyLabel ?? move.accuracy ?? '—'} · PP ${move.maxPp}`}><div>
        <span className={`type-${typeClassName(move.type)}`}>{move.type}</span><div><strong>{move.name}</strong><small>{move.category} · 위력 {move.power || '—'} · 명중 {move.accuracyLabel ?? move.accuracy ?? '—'}</small></div><b>PP {move.maxPp}</b>
      </div></FactoryInfoTooltip>)}</div>
    </div>
  </dialog>, document.body)
}

function RentalCard({ pokemon, order, selected = false, disabled = false, onSelect, onDetails, label, compact = false, selectAriaLabel, selectedLabel = '선택', showHealth = false, showRarity = false, footer = null }) {
  const profile = getSpeciesProfile(pokemon.speciesId)
  const item = getBattleItem(pokemon.heldItemId)
  const name = nameOf(pokemon)
  const content = <>
    <span className="factory-card-number">{selected ? <><Check size={13} />{order ? `${order}번` : selectedLabel}</> : label}</span>
    <SpriteImage src={pokemon.icon ?? profile?.icon} fallbackSrc={pokemon.iconFallback ?? profile?.iconFallback} alt="" draggable="false" />
    <strong>{name}</strong><span className="factory-card-types">{(pokemon.types ?? profile?.types ?? []).join(' · ')}</span>
    {showRarity && <span className="factory-card-rarity">{getFactoryRarityLabel(pokemon)}</span>}
    {showHealth && <HealthMeter pokemon={pokemon} />}
  </>
  return <article className={`factory-rental-card${selected ? ' selected' : ''}${disabled ? ' unavailable' : ''}${compact ? ' compact' : ''}`}>
    {onSelect ? <button type="button" className="factory-rental-select" aria-label={selectAriaLabel ?? `${name} ${selected ? '선택 해제' : '선택'}${disabled ? ' 불가' : ''}`}
      aria-pressed={selected} disabled={disabled} onClick={onSelect}>{content}</button>
      : <div className="factory-rental-select">{content}</div>}
    <FactoryInfoTooltip title={item?.name} description={item?.description ?? item?.effect}><span className="factory-card-item">{item && <BattleItemSprite item={item} size={18} />}{item?.name ?? '지닌 도구 없음'}</span></FactoryInfoTooltip>
    <button type="button" className="factory-rental-info" aria-label={`${name} 능력치와 기술 정보`} onClick={() => onDetails(pokemon)}><Info size={17} /></button>
    {footer}
  </article>
}

function FloorRail({ run }) {
  const floor = Math.max(1, run.floor ?? 1)
  const levels = Array.from({ length: 5 }, (_, index) => Math.max(5, floor + 2) - index)
  return <aside className="factory-tower" aria-label={`현재 ${floor}층, ${run.wins ?? 0}연승`}>
    <div className="factory-tower-label"><Layers3 size={18} /><span>BATTLE TOWER</span></div>
    <div className="factory-floor-number"><span>{run.phase === 'finished' ? '도달 층수' : '현재 도전 층수'}</span><strong>{floor}<small>F</small></strong></div>
    <div className="factory-win-count"><Trophy size={15} /><strong>{run.wins ?? 0}</strong> 연승</div>
    <ol className="factory-floor-rail">{levels.map(level => <li key={level} className={level === floor ? 'current' : level < floor ? 'cleared' : ''} aria-current={level === floor ? 'step' : undefined}>
      <span>{level < floor ? <Check size={14} /> : level === floor ? <ChevronUp size={17} /> : <i />}</span><b>{level}F</b><small>{level < floor ? '클리어' : level === floor ? '현재 층' : 'NEXT'}</small>
    </li>)}</ol>
    <div className="factory-trainer"><div className="factory-trainer-image"><img src={TRAINER_IMAGE} alt="배틀팩토리 AI 트레이너" /></div><span><small>FACTORY TRAINER</small><strong>팩토리 AI 트레이너</strong><em>{getFactoryDifficulty(floor, run.mode).label} 팀 · 전술 하드</em></span></div>
  </aside>
}

function FactoryModePicker({ mode, onSelect }) {
  return <div className="factory-mode-picker" role="radiogroup" aria-label="배틀팩토리 모드 선택">
    {FACTORY_MODES.map(entry => <button type="button" key={entry.id} role="radio" aria-checked={entry.id === mode}
      className={`factory-mode-option${entry.id === mode ? ' selected' : ''}`} onClick={() => onSelect(entry.id)}>
      <small>{entry.tagline}</small><strong>{entry.label}</strong><span>{entry.description}</span>
    </button>)}
  </div>
}

function FactoryRunLobby({ run, onChooseRentals, onChooseLead, onStartBattle, onAdvanceFloor, onHealParty, onRerollItem, onRestart, onBack, onOpenRankings, rankingError, onRetryRanking, error }) {
  const [chosenIds, setChosenIds] = useState([])
  const [giveId, setGiveId] = useState(null)
  const [takeId, setTakeId] = useState(null)
  const [details, setDetails] = useState(null)
  const offers = run.offers ?? []
  const party = run.party ?? []
  const previousOpponent = run.previousOpponent ?? []
  const opponent = run.opponentTeam?.pokemon ?? []
  const leadPokemon = party.find(pokemon => pokemon.captureId === run.leadCaptureId)
  const selectedOffers = chosenIds.map(id => offers.find(pokemon => pokemon.captureId === id)).filter(Boolean)
  const exchangeTarget = previousOpponent.find(pokemon => pokemon.captureId === takeId)
  const exchangeSource = party.find(pokemon => pokemon.captureId === giveId)
  const challenge = isFactoryChallengeMode(run.mode)
  const points = run.towerPoints ?? 0
  const swapCost = challenge && exchangeTarget ? getFactorySwapCost(exchangeTarget) : 0
  const distinctSpecies = Boolean(exchangeSource && exchangeTarget && !party.some(pokemon => pokemon.captureId !== giveId && speciesKey(pokemon) === speciesKey(exchangeTarget)))
  const canAffordSwap = !challenge || points >= swapCost
  const canExchange = distinctSpecies && canAffordSwap
  const phase = run.phase
  const titles = {
    selection: ['RENTAL SELECTION', '랜덤 6마리. 당신의 선택은 3마리.', '함께할 3마리를 고른 뒤, 준비 화면에서 선봉을 선택합니다.'],
    ready: ['READY TO BATTLE', `${run.floor}층, 선봉을 선택하세요.`, '내 렌탈 포켓몬 중 먼저 출전할 선봉 1마리를 선택해 주세요.'],
    exchange: ['FLOOR CLEAR', `${run.floor}층 클리어! 팀을 바꿔 볼까요?`, challenge
      ? '내 팀 1마리와 방금 상대했던 포켓몬 1마리를 교환할 수 있습니다. 교체에는 등급에 따른 TP가 듭니다.'
      : '내 팀 1마리와 방금 상대했던 포켓몬 1마리를 교환할 수 있습니다.'],
    finished: ['CHALLENGE COMPLETE', '이번 도전은 여기까지.', '새로운 렌탈 팀으로 더 높은 층에 도전해 보세요.'],
  }
  const [eyebrow, title, description] = titles[phase] ?? titles.ready
  const selectOffer = pokemon => setChosenIds(current => current.includes(pokemon.captureId)
    ? current.filter(id => id !== pokemon.captureId)
    : current.length < 3 ? [...current, pokemon.captureId] : current)

  return <main className={`battle-factory phase-${phase}`}>
    <header className="factory-heading">
      <button className="factory-back" type="button" onClick={onBack}><ArrowLeft size={18} /><span>배틀 선택</span></button>
      <div><span>BUILD YOUR TEAM. CLIMB HIGHER.</span><h1><Factory size={26} />배틀팩토리</h1></div>
      <nav className="factory-header-actions" aria-label="팩토리 메뉴">
        <span className="factory-format"><Swords size={16} />3 vs 3 · Lv.50</span>
        <span className="factory-format">승리 보상 {getBattleFactoryVpReward(run.floor).toLocaleString()} VP</span>
        <span className={`factory-format factory-mode-badge${challenge ? ' is-challenge' : ''}`}>{getFactoryMode(run.mode).label}</span>
        {challenge && <span className="factory-format factory-tp-badge"><Coins size={15} />{points} TP</span>}
        {onOpenRankings && <button type="button" className="factory-ranking-button" onClick={onOpenRankings}><Trophy size={17} /><span>TOP 10 랭킹</span></button>}
      </nav>
    </header>
    <div className="factory-workspace">
      <FloorRail run={run} />
      <section className="factory-panel" aria-labelledby="factory-phase-title">
        <header className="factory-panel-heading"><span>{eyebrow}</span><h2 id="factory-phase-title">{title}</h2><p>{description}</p></header>
        <div className="factory-panel-scroll">
          {phase === 'selection' && <>
            <FactoryModePicker mode={run.mode ?? 'standard'} onSelect={id => { if (id !== run.mode) onRestart(id) }} />
            <div className="factory-selection-progress"><span><strong>{chosenIds.length}</strong> / 3 선택</span><div>{selectedOffers.length ? selectedOffers.map((pokemon, index) => <span key={pokemon.captureId}><b>{index + 1}번</b>{nameOf(pokemon)}</span>) : <small>함께 올라갈 포켓몬을 선택해 주세요.</small>}</div></div>
            <div className="factory-rental-grid" aria-label="렌탈 후보 6마리">{offers.map((pokemon, index) => <RentalCard key={pokemon.captureId} pokemon={pokemon} label={String(index + 1).padStart(2, '0')}
              selected={chosenIds.includes(pokemon.captureId)} order={chosenIds.indexOf(pokemon.captureId) + 1} disabled={!chosenIds.includes(pokemon.captureId) && chosenIds.length === 3}
              onSelect={() => selectOffer(pokemon)} onDetails={setDetails} />)}</div>
          </>}
          {phase === 'ready' && <div className="factory-team-groups">
            <section><h3><Flag size={16} />나의 렌탈 팀 <span>카드를 눌러 선봉 선택</span></h3><div className="factory-team-grid" aria-label="출전 선봉 선택">{party.map((pokemon, index) => <RentalCard key={pokemon.captureId} pokemon={pokemon} label={`${index + 1}번`}
              selected={pokemon.captureId === run.leadCaptureId} selectedLabel="선봉" selectAriaLabel={`${nameOf(pokemon)} 선봉 선택`}
              disabled={challenge && isFactoryPokemonFainted(pokemon)} showHealth={challenge}
              onSelect={() => onChooseLead(pokemon.captureId)} onDetails={setDetails} />)}</div></section>
            <section className="factory-enemy-group"><h3><Swords size={16} />{run.floor}층 상대 팀 <span>팩토리 AI 트레이너</span></h3><div className="factory-team-grid">{opponent.map((pokemon, index) => <RentalCard key={pokemon.captureId} pokemon={pokemon} label={`상대 ${index + 1}`} onDetails={setDetails} compact />)}</div></section>
          </div>}
          {phase === 'exchange' && <div className="factory-team-groups factory-exchange-groups">
            <section><h3><Flag size={16} />내보낼 포켓몬 <span>현재 렌탈 팀에서 1마리</span></h3><div className="factory-team-grid">{party.map(pokemon => <RentalCard key={pokemon.captureId} pokemon={pokemon} label="MY TEAM" selected={giveId === pokemon.captureId}
              showHealth={challenge}
              onSelect={() => setGiveId(current => current === pokemon.captureId ? null : pokemon.captureId)} onDetails={setDetails} />)}</div></section>
            <div className="factory-exchange-indicator" aria-live="polite"><RefreshCw size={19} /><span>{exchangeSource && exchangeTarget ? `${nameOf(exchangeSource)} ↔ ${nameOf(exchangeTarget)}` : '위와 아래에서 각각 1마리씩 선택하세요.'}</span></div>
            <section><h3><Shuffle size={16} />데려올 포켓몬 <span>{challenge ? '이전 상대 팀에서 1마리 · 등급별 TP 소모' : '이전 상대 팀에서 1마리'}</span></h3><div className="factory-team-grid">{previousOpponent.map(pokemon => <RentalCard key={pokemon.captureId} pokemon={pokemon} label="OPPONENT" selected={takeId === pokemon.captureId}
              showRarity={challenge}
              footer={challenge ? <span className="factory-card-cost"><Coins size={13} />{getFactorySwapCost(pokemon)} TP</span> : null}
              onSelect={() => setTakeId(current => current === pokemon.captureId ? null : pokemon.captureId)} onDetails={setDetails} />)}</div></section>
            {giveId && takeId && !distinctSpecies && <p className="factory-exchange-warning" role="status">같은 종류의 포켓몬을 2마리 데리고 갈 수 없습니다. 다른 조합을 선택해 주세요.</p>}
            {giveId && takeId && distinctSpecies && !canAffordSwap && <p className="factory-exchange-warning" role="status">TP가 부족합니다. 이 교체에는 {swapCost} TP가 필요하고 현재 {points} TP입니다.</p>}
          </div>}
          {phase === 'finished' && <div className="factory-finished">
            <span className="factory-finished-emblem"><Trophy size={48} /></span><p>렌탈 팀과 함께 쌓아 올린 기록</p>
            <div className="factory-result-stats"><div><small>도달 층수</small><strong>{run.floor}<em>F</em></strong></div><div><small>클리어한 층</small><strong>{run.wins ?? 0}<em>층</em></strong></div>{challenge && <div><small>모드</small><strong className="factory-result-mode">도전<em>모드</em></strong></div>}</div>
            <div className="factory-final-party">{party.map(pokemon => <div key={pokemon.captureId}><SpriteImage src={pokemon.icon} fallbackSrc={pokemon.iconFallback} alt="" /><span>{nameOf(pokemon)}</span></div>)}</div>
          </div>}
        </div>
        <footer className="factory-actions">
          {error && <p className="factory-error" role="alert">{error}</p>}
          {rankingError && <p className="factory-error factory-ranking-error" role="alert">{rankingError}<button type="button" onClick={onRetryRanking}>저장 다시 시도</button></p>}
          <div className="factory-action-row">
            {phase === 'ready' ? <div className={`factory-rules-note factory-lead-note${leadPokemon ? ' is-chosen' : ''}`} aria-live="polite">
              <span><Flag size={14} /><strong>{leadPokemon ? `선봉 · ${nameOf(leadPokemon)}` : '먼저 출전할 선봉을 선택해 주세요.'}</strong></span>
              <small>{challenge ? 'HP는 이어지고 PP·상태만 회복' : '매 층 시작 시 HP·PP·상태 회복'}</small>
            </div> : <div className="factory-rules-note"><span><Heart size={14} />{challenge ? 'HP는 이어지고 PP·상태만 회복' : '매 층 시작 시 HP·PP·상태 회복'}</span><small>{challenge ? 'TP로만 회복·교체·도구 변경이 가능합니다.' : '렌탈 포켓몬은 도전 중에만 함께합니다.'}</small></div>}
            <div className="factory-action-buttons">
              {challenge && ['ready', 'exchange'].includes(phase) && <FactoryTeamManager run={run} onHealParty={onHealParty} onRerollItem={onRerollItem} />}
              {phase === 'selection' && <button type="button" className="factory-primary" disabled={chosenIds.length !== 3} onClick={() => onChooseRentals(chosenIds)}>렌탈 팀 확정 <span>{chosenIds.length}/3</span><ArrowRight size={18} /></button>}
              {phase === 'ready' && <button type="button" className="factory-primary" disabled={!leadPokemon} onClick={onStartBattle}><Swords size={18} />{run.floor}층 배틀 시작</button>}
              {phase === 'exchange' && <><button type="button" className="factory-secondary" onClick={() => onAdvanceFloor(null)}>교환 없이 다음 층</button><button type="button" className="factory-primary" disabled={!canExchange} onClick={() => onAdvanceFloor({ giveCaptureId: giveId, takeCaptureId: takeId })}><RefreshCw size={17} />교환하고 다음 층{challenge && exchangeTarget ? ` · ${swapCost} TP` : ''}</button></>}
              {phase === 'finished' && <><button type="button" className="factory-secondary" onClick={onBack}>배틀 선택</button><button type="button" className="factory-primary" onClick={() => onRestart(run.mode)}><RefreshCw size={18} />새 도전 시작</button></>}
            </div>
          </div>
        </footer>
      </section>
    </div>
    {details && <RentalDetails pokemon={details} onClose={() => setDetails(null)} />}
  </main>
}

export default function BattleFactoryLobby(props) {
  if (!props.run) return null
  return <FactoryRunLobby {...props} key={`${props.run.id}:${props.run.phase}:${props.run.floor}`} />
}
