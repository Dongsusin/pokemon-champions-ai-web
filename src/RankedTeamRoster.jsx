import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Info } from 'lucide-react'
import SpriteImage from './SpriteImage'
import BattleItemSprite from './BattleItemSprite'
import { createBattlePreviewPokemon } from './data/battleEngine'
import { BATTLE_TEAM_SIZE } from './data/teamData'
import { STAT_META, getSpeciesProfile, typeClassName } from './data/trainingData'
import { getBattleItem } from './data/shopData'

function PokemonDetails({ id, pokemon, anchor, onEnter, onLeave, tooltipRef }) {
  const [position, setPosition] = useState(null)
  const item = getBattleItem(pokemon.heldItemId)
  useLayoutEffect(() => {
    let frame = 0
    const measure = () => {
      const element = tooltipRef.current
      if (!element || !anchor?.isConnected) return
      const viewport = window.visualViewport
      const width = viewport?.width ?? window.innerWidth
      const height = viewport?.height ?? window.innerHeight
      const leftEdge = (viewport?.offsetLeft ?? 0) + 12
      const topEdge = (viewport?.offsetTop ?? 0) + 12
      const rightEdge = leftEdge + width - 24
      const bottomEdge = topEdge + height - 24
      element.style.maxWidth = `${width - 24}px`
      element.style.maxHeight = `${height - 24}px`
      const target = anchor.getBoundingClientRect()
      const tip = element.getBoundingClientRect()
      let left = target.left - tip.width - 10
      let top = target.top + (target.height - tip.height) / 2
      if (left < leftEdge) {
        left = target.right + 10
        if (left + tip.width > rightEdge) {
          left = target.left + (target.width - tip.width) / 2
          top = target.top - tip.height - 10 >= topEdge ? target.top - tip.height - 10 : target.bottom + 10
        }
      }
      setPosition({ left: Math.max(leftEdge, Math.min(left, rightEdge - tip.width)), top: Math.max(topEdge, Math.min(top, bottomEdge - tip.height)) })
    }
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure) }
    measure()
    const observer = new ResizeObserver(schedule)
    observer.observe(anchor)
    observer.observe(tooltipRef.current)
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, true)
    window.visualViewport?.addEventListener('resize', schedule)
    window.visualViewport?.addEventListener('scroll', schedule)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule, true)
      window.visualViewport?.removeEventListener('resize', schedule)
      window.visualViewport?.removeEventListener('scroll', schedule)
    }
  }, [anchor, pokemon, tooltipRef])

  return createPortal(<aside id={id} ref={tooltipRef} role="tooltip" className="ranked-pokemon-tooltip"
    style={{ ...position, visibility: position ? 'visible' : 'hidden' }} onPointerEnter={onEnter} onPointerLeave={onLeave}>
    <header className="ranked-tooltip-header">
      <SpriteImage src={pokemon.icon} fallbackSrc={pokemon.iconFallback} alt="" draggable="false" />
      <div><small>출전 포켓몬 · Lv.{pokemon.level}</small><strong>{pokemon.name}{pokemon.isShiny && <span className="ranked-tooltip-shiny"> ✦</span>}</strong>
        {pokemon.formName !== pokemon.name && <span>{pokemon.formName}</span>}
        <div className="ranked-tooltip-types">{pokemon.types.map(type => <b className={`type-${typeClassName(type)}`} key={type}>{type}</b>)}</div>
      </div>
    </header>
    <dl className="ranked-tooltip-meta">
      <div><dt>특성</dt><dd>{pokemon.ability}</dd></div>
      <div><dt>성격</dt><dd>{pokemon.nature}</dd></div>
      <div><dt>지닌 도구</dt><dd>{item && <BattleItemSprite item={item} size={20} />}{item?.name ?? '없음'}</dd></div>
      <div><dt>테라타입</dt><dd>{pokemon.teraType}</dd></div>
      <div><dt>다이맥스</dt><dd>{pokemon.dynamaxMode === 'gigantamax' ? '거다이맥스' : '다이맥스'}</dd></div>
    </dl>
    <section className="ranked-tooltip-stats" aria-label="레벨 50 기준 능력치">
      {STAT_META.map(({ key, shortLabel }) => <div key={key}><span>{shortLabel}</span><strong>{pokemon.stats[key]}</strong></div>)}
    </section>
    <section className="ranked-tooltip-moves"><h3>배틀 기술</h3>
      {pokemon.moves.map(move => <div key={move.id}>
        <b className={`type-${typeClassName(move.type)}`}>{move.type}</b><span><strong>{move.name}</strong><small>{move.category} · 위력 {move.power || '—'} · 명중 {move.accuracyLabel ?? move.accuracy ?? '—'}</small></span><em>PP {move.maxPp}</em>
      </div>)}
    </section>
  </aside>, document.body)
}

// Only the player's registered roster uses this inspector. Opponent previews
// keep using the public species cards from RankedBattleScreen.
export default function RankedTeamRoster({ pokemon: roster, className = '', renderCard }) {
  const id = useId()
  const [activeId, setActiveId] = useState(null)
  const anchors = useRef(new Map())
  const tooltipRef = useRef(null)
  const tooltipPointerInside = useRef(false)
  const closeTimer = useRef(null)
  const active = roster.find(pokemon => pokemon.captureId === activeId)
  const preview = useMemo(() => active && getSpeciesProfile(active.speciesId) ? createBattlePreviewPokemon(active) : null, [active])
  const anchor = anchors.current.get(activeId)
  const keepOpen = () => clearTimeout(closeTimer.current)
  const close = () => { keepOpen(); tooltipPointerInside.current = false; setActiveId(null) }
  const open = pokemon => { keepOpen(); tooltipPointerInside.current = false; setActiveId(pokemon.captureId) }
  const scheduleClose = () => { keepOpen(); closeTimer.current = setTimeout(() => setActiveId(null), 150) }

  useEffect(() => () => clearTimeout(closeTimer.current), [])
  useEffect(() => {
    if (!activeId) return
    if (!active || !anchor?.isConnected) { setActiveId(null); return }
    const dismiss = event => {
      if (event.key === 'Escape') { clearTimeout(closeTimer.current); tooltipPointerInside.current = false; setActiveId(null) }
    }
    const outside = event => {
      if (!anchor.contains(event.target) && !tooltipRef.current?.contains(event.target)) {
        clearTimeout(closeTimer.current)
        tooltipPointerInside.current = false
        setActiveId(null)
      }
    }
    document.addEventListener('keydown', dismiss)
    document.addEventListener('pointerdown', outside)
    return () => {
      document.removeEventListener('keydown', dismiss)
      document.removeEventListener('pointerdown', outside)
    }
  }, [activeId, active, anchor])

  return <div className={`ranked-six-grid ${className}`} aria-label="선택한 팀 포켓몬">
    {Array.from({ length: BATTLE_TEAM_SIZE }, (_, index) => {
      const pokemon = roster[index]
      if (!pokemon) return <div className="ranked-pokemon-card empty" key={`empty-${index}`}><span>+</span><small>팀 편성 필요</small></div>
      const profile = getSpeciesProfile(pokemon.speciesId)
      return <button type="button" className="ranked-pokemon-card ranked-roster-card" key={pokemon.captureId}
        ref={element => { if (element) anchors.current.set(pokemon.captureId, element); else anchors.current.delete(pokemon.captureId) }}
        aria-label={`${pokemon.name ?? profile?.name} 정보 보기`} aria-describedby={activeId === pokemon.captureId && preview ? id : undefined}
        onPointerEnter={event => { if (event.pointerType !== 'touch') open(pokemon) }}
        onPointerLeave={event => { if (event.pointerType !== 'touch') scheduleClose() }}
        onPointerCancel={close} onFocus={() => open(pokemon)}
        onBlur={event => { if (!tooltipPointerInside.current && !tooltipRef.current?.contains(event.relatedTarget)) scheduleClose() }} onClick={() => open(pokemon)}>
        {renderCard ? renderCard(pokemon, index, profile) : <><span className="ranked-pokemon-number">{String(index + 1).padStart(2, '0')}<Info size={13} aria-hidden="true" /></span>
        <SpriteImage src={pokemon.icon ?? profile?.icon} fallbackSrc={pokemon.iconFallback ?? profile?.iconFallback} alt="" draggable="false" />
        <strong>{pokemon.name ?? profile?.name}</strong><small>{(pokemon.types ?? profile?.types ?? []).join(' · ')}</small></>}
      </button>
    })}
    {preview && anchor && <PokemonDetails key={activeId} id={id} pokemon={preview} anchor={anchor} tooltipRef={tooltipRef}
      onEnter={() => { tooltipPointerInside.current = true; keepOpen() }}
      onLeave={event => {
        // A touch pointer leaves on finger-up before the compatibility blur.
        // Keep the inspector open until an outside tap or an explicit dismissal.
        if (event.pointerType === 'touch') return
        tooltipPointerInside.current = false
        scheduleClose()
      }} />}
  </div>
}
