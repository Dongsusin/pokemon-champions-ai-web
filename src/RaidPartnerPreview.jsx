import { useMemo } from 'react'
import { Info, RefreshCw } from 'lucide-react'
import SpriteImage from './SpriteImage'
import BattleItemSprite from './BattleItemSprite'
import FactoryInfoTooltip from './FactoryInfoTooltip'
import { createBattlePreviewPokemon } from './data/battleEngine'
import { STAT_META, getAbility, typeClassName } from './data/trainingData'
import { getBattleItem } from './data/shopData'
import './raidPartnerPreview.css'

export default function RaidPartnerPreview({ pokemon, onChange, busy }) {
  const preview = useMemo(() => createBattlePreviewPokemon(pokemon), [pokemon])
  const ability = getAbility(preview.ability)
  const item = getBattleItem(preview.heldItemId)
  const details = <div className="raid-partner-details">
    <div className="raid-partner-types">{preview.types.map(type => <b key={type} className={`type-${typeClassName(type)}`}>{type}</b>)}<span>Lv.{preview.level}</span></div>
    <dl>
      <div><dt>특성</dt><dd>{preview.ability}<small>{ability?.description}</small></dd></div>
      <div><dt>성격</dt><dd>{preview.nature}</dd></div>
      <div><dt>지닌 도구</dt><dd>{item && <BattleItemSprite item={item} size={20} />}{item?.name ?? '없음'}{item && <small>{item.description ?? item.effect}</small>}</dd></div>
      <div><dt>테라타입</dt><dd>{preview.teraType}</dd></div>
    </dl>
    <section className="raid-partner-stats" aria-label="출전 능력치">{STAT_META.map(({ key, shortLabel }) => <div key={key}><span>{shortLabel}</span><strong>{preview.stats[key]}</strong></div>)}</section>
    <section className="raid-partner-moves" aria-label="배틀 기술"><h3>배틀 기술</h3>{preview.moves.map(move => <article key={move.id}>
      <header><b className={`type-${typeClassName(move.type)}`}>{move.type}</b><strong>{move.name}</strong><span>PP {move.maxPp}</span></header>
      <small>{move.category} · 위력 {move.power || '—'} · 명중 {move.accuracyLabel ?? move.accuracy ?? '—'}</small><p>{move.description}</p>
    </article>)}</section>
  </div>
  return <div className="raid-selected-pokemon-info">
    <FactoryInfoTooltip title={preview.name} content={details} className="raid-partner-tooltip">
      <button type="button" className="raid-selected-pokemon" aria-label={`${preview.name} 상세 정보`}>
        <SpriteImage src={preview.spriteFront} fallbackSrc={preview.spriteFrontFallback} alt="" draggable="false" />
        <div><small>Lv.{preview.level}</small><strong>{preview.name}</strong><span>{preview.types.join(' · ')}</span><small className="raid-partner-hint"><Info size={12} /> 호버하거나 터치해서 정보 보기</small></div>
      </button>
    </FactoryInfoTooltip>
    <button type="button" className="raid-change-pokemon" disabled={busy} onClick={onChange}><RefreshCw size={14} /> 포켓몬 변경</button>
  </div>
}
