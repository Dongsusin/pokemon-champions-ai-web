import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Coins, Dices, HeartPulse, Users, X } from 'lucide-react'
import { FACTORY_TP_ITEM_REROLL_COST, getFactoryHpRatio, getFactoryPartyHealCost } from './data/battleFactoryChallenge'
import { getSpeciesProfile } from './data/trainingData'

const nameOf = pokemon => pokemon?.name ?? getSpeciesProfile(pokemon?.speciesId)?.name ?? '포켓몬'

export function FactoryHealthMeter({ pokemon }) {
  const ratio = getFactoryHpRatio(pokemon)
  const percent = Math.round(ratio * 100)
  const tone = ratio <= 0 ? 'fainted' : ratio <= 0.25 ? 'critical' : ratio <= 0.5 ? 'warning' : 'healthy'
  return <span className={`factory-card-health tone-${tone}`} aria-label={`체력 ${percent}%`}>
    <span className="factory-card-health-track"><i style={{ width: `${percent}%` }} /></span>
    <b>{ratio <= 0 ? '기절' : `${percent}%`}</b>
  </span>
}

/**
 * The Tower Point spending panel, opened from a button rather than taking up
 * the standby screen. It holds real controls, so it opens on click and stays
 * open while the player uses it; only an outside click, Escape or a resize
 * closes it.
 */
export default function FactoryTeamManager({ run, onHealParty, onRerollItem }) {
  const id = useId()
  const anchor = useRef(null)
  const panel = useRef(null)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState(null)
  const party = run.party ?? []
  const points = run.towerPoints ?? 0
  const close = () => { setOpen(false); setPosition(null) }

  useLayoutEffect(() => {
    if (!open || !anchor.current || !panel.current) return
    const target = anchor.current.getBoundingClientRect()
    const box = panel.current.getBoundingClientRect()
    const margin = 12
    const gap = 10
    const clamp = (value, max) => Math.max(margin, Math.min(value, Math.max(margin, max)))
    // Prefer opening upward, the way the button sits above the action bar, and
    // fall back below only when there is genuinely no room.
    const fitsAbove = target.top >= box.height + gap + margin
    setPosition({
      left: clamp(target.left + (target.width - box.width) / 2, window.innerWidth - box.width - margin),
      top: clamp(fitsAbove ? target.top - box.height - gap : target.bottom + gap, window.innerHeight - box.height - margin),
    })
  }, [open, party, points])

  useEffect(() => {
    if (!open) return
    const dismissOutside = event => {
      if (!anchor.current?.contains(event.target) && !panel.current?.contains(event.target)) close()
    }
    const dismissEscape = event => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      close()
      anchor.current?.focus()
    }
    document.addEventListener('pointerdown', dismissOutside, true)
    document.addEventListener('keydown', dismissEscape, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('pointerdown', dismissOutside, true)
      document.removeEventListener('keydown', dismissEscape, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  const healCost = getFactoryPartyHealCost(party)
  const canHeal = healCost > 0 && points >= healCost

  return <>
    <button ref={anchor} type="button" className={`factory-secondary factory-team-manage${open ? ' is-open' : ''}`}
      aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => (open ? close() : setOpen(true))}>
      <Users size={17} />팀 관리
      <span className="factory-team-manage-points"><Coins size={13} />{points} TP</span>
      {canHeal && <span className="factory-team-manage-alert" aria-label="전체 회복 가능">!</span>}
    </button>
    {open && createPortal(<div ref={panel} id={id} role="dialog" aria-label="팀 관리 · 타워 포인트"
      className="factory-team-manager" style={{ ...position, visibility: position ? 'visible' : 'hidden' }}>
      <header>
        <span className="factory-tp-balance"><Coins size={17} /><strong>{points}</strong><small>TP</small></span>
        <button type="button" className="factory-team-manager-close" aria-label="팀 관리 닫기" onClick={close}><X size={16} /></button>
      </header>
      <p className="factory-team-manager-note">승리할수록 더 많은 TP를 받습니다. 이번 도전에서만 사용할 수 있고, 패배하면 사라집니다.</p>
      <button type="button" className="factory-heal-party" disabled={healCost === 0 || points < healCost} onClick={onHealParty}>
        <HeartPulse size={17} />
        <span>{healCost === 0 ? '팀 전체 회복 완료' : '팀 전체 회복'}</span>
        {healCost > 0 && <b>{healCost} TP</b>}
      </button>
      {healCost > 0 && points < healCost && <p className="factory-team-manager-warning" role="status">TP가 {healCost - points} 부족합니다.</p>}
      <ul className="factory-tp-actions">
        {party.map(pokemon => <li key={pokemon.captureId}>
          <span className="factory-tp-name">
            <strong>{nameOf(pokemon)}</strong>
            <FactoryHealthMeter pokemon={pokemon} />
          </span>
          <span className="factory-tp-buttons">
            <button type="button" disabled={points < FACTORY_TP_ITEM_REROLL_COST} onClick={() => onRerollItem(pokemon.captureId)}>
              <Dices size={15} />도구 변경 {FACTORY_TP_ITEM_REROLL_COST} TP
            </button>
          </span>
        </li>)}
      </ul>
    </div>, anchor.current?.closest('dialog') ?? document.body)}
  </>
}
