import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  ArrowLeftRight,
  ChevronLeft,
  ChevronRight,
  Flag,
  Gem,
  ScrollText,
  Shield,
  Sparkles,
  Swords,
  Trophy,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { createBattleAudio } from './battleAudio'
import PokemonSprite from './PokemonSprite'
import TrainerSprite from './TrainerSprite'
import {
  createBattle,
  createBattleTurnTimeline,
  forcePlayerSwitch,
  getActivePokemon,
  getAvailableBattleMechanics,
  getBattleSummary,
  getTypeEffectiveness,
} from './data/battleEngine'
import {
  getMoveAnimationAssets,
  getMoveAnimationProfile,
  getMovePixelAnimationPlan,
} from './data/moveAnimationData'
import { typeClassName } from './data/trainingData'

function fallbackImageHandler(fallback) {
  return (event) => {
    if (!fallback || event.currentTarget.dataset.fallbackApplied) return
    event.currentTarget.dataset.fallbackApplied = 'true'
    event.currentTarget.src = fallback
  }
}

const moveAssetDecodeCache = new Map()

function decodeMoveAsset(src) {
  if (!src) return Promise.resolve()
  if (moveAssetDecodeCache.has(src)) return moveAssetDecodeCache.get(src)

  const decodePromise = new Promise((resolve) => {
    const image = new Image()
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      if (image.decode && image.naturalWidth) {
        image.decode().catch(() => {}).finally(resolve)
      } else {
        resolve()
      }
    }

    image.decoding = 'async'
    image.onload = finish
    image.onerror = finish
    image.src = src
    if (image.complete) finish()
  })

  moveAssetDecodeCache.set(src, decodePromise)
  return decodePromise
}

function preloadMoveAssets(assets) {
  return Promise.allSettled([...new Set(assets)].map(decodeMoveAsset))
}

function preloadMoveAssetsWithTimeout(assets, timeout = 1800) {
  return new Promise((resolve) => {
    const timeoutId = window.setTimeout(resolve, timeout)
    preloadMoveAssets(assets).finally(() => {
      window.clearTimeout(timeoutId)
      resolve()
    })
  })
}

function getBattleSpriteAssets(pokemon) {
  return [
    pokemon.spriteFront,
    pokemon.spriteBack,
    pokemon.spriteFrontFallback,
    pokemon.spriteBackFallback,
  ].flat().filter(Boolean)
}

function hpRatio(pokemon) {
  return Math.max(0, Math.min(100, (pokemon.hp / pokemon.maxHp) * 100))
}

function hpTone(pokemon) {
  const ratio = pokemon.hp / pokemon.maxHp
  if (ratio <= 0.2) return 'critical'
  if (ratio <= 0.5) return 'warning'
  return 'healthy'
}

function effectivenessPresentation(multiplier) {
  if (multiplier === null) {
    return { value: '—', label: '직접 피해 없음', tone: 'status' }
  }
  if (multiplier === 0) {
    return { value: 'X0', label: '효과 없음', tone: 'immune' }
  }
  if (multiplier >= 4) {
    return { value: `X${multiplier}`, label: '4배 약점', tone: 'quad' }
  }
  if (multiplier > 1) {
    return { value: `X${multiplier}`, label: '효과 굉장', tone: 'super' }
  }
  if (multiplier <= 0.25) {
    return { value: `X${multiplier}`, label: '강한 내성', tone: 'quarter' }
  }
  if (multiplier < 1) {
    return { value: `X${multiplier}`, label: '효과 별로', tone: 'resisted' }
  }
  return { value: 'X1', label: '보통 효과', tone: 'neutral' }
}

const TURN_STEP_DURATIONS = {
  gimmick: 920,
  announce: 380,
  attack: 760,
  impact: 440,
  resolve: 380,
  status: 560,
  'switch-out': 660,
  switch: 780,
  residual: 520,
  faint: 900,
  prompt: 420,
  result: 760,
}

function turnStepDuration(step) {
  if (step?.phase === 'attack' && step.moveId) return getMoveAnimationProfile(step).duration
  return TURN_STEP_DURATIONS[step?.phase] ?? 700
}

function turnPhaseLabel(cue) {
  if (!cue) return 'TURN PROCESSING'
  if (cue.phase === 'gimmick') return 'BATTLE GIMMICK'
  if (cue.phase === 'announce') return cue.actionOrder === 0 ? 'FIRST ACTION' : 'SECOND ACTION'
  if (cue.phase === 'attack') return 'MOVE IN MOTION'
  if (cue.phase === 'impact') return 'DAMAGE'
  if (cue.phase === 'resolve') return 'MOVE RESULT'
  if (cue.phase === 'status') return 'STATUS EFFECT'
  if (cue.phase === 'switch-out' || cue.phase === 'switch') return 'POKÉMON SWITCH'
  if (cue.phase === 'residual') return 'END OF TURN'
  if (cue.phase === 'faint') return 'KNOCK OUT'
  if (cue.phase === 'prompt') return 'CHOOSE NEXT'
  if (cue.phase === 'result') return 'BATTLE RESULT'
  return 'TURN PROCESSING'
}

function BattleTurnPlayback({ cue, turn }) {
  const presentation = cue?.effectiveness == null
    ? null
    : effectivenessPresentation(cue.effectiveness)

  return (
    <section
      className={`battle-turn-playback phase-${cue?.phase ?? 'waiting'} side-${cue?.sideId ?? 'neutral'}`}
      style={{ '--turn-step-duration': `${turnStepDuration(cue)}ms` }}
      aria-live="assertive"
    >
      <span className="battle-turn-playback-emblem">
        {cue?.phase?.includes('switch') ? <ArrowLeftRight size={27} /> : cue?.phase === 'gimmick' ? <Sparkles size={27} /> : <Swords size={27} />}
      </span>
      <div>
        <small>TURN {turn} · {turnPhaseLabel(cue)}</small>
        <strong>{cue?.message ?? '행동 순서를 결정하고 있습니다.'}</strong>
        {cue?.moveName && (
          <span className="battle-turn-move-meta">
            <b className={`type-${typeClassName(cue.moveType)}`}>{cue.moveType}</b>
            <em>{cue.moveName}</em>
            {cue.actionOrder != null && <i>{cue.actionOrder === 0 ? '선공' : '후공'}</i>}
          </span>
        )}
      </div>
      {cue?.damage > 0 && <b className="battle-turn-damage-readout">-{cue.damage}</b>}
      {presentation && (
        <span className={`battle-turn-effectiveness effectiveness-${presentation.tone}`}>
          <strong>{presentation.value}</strong>
          <small>{presentation.label}</small>
        </span>
      )}
      <span className="battle-turn-progress" aria-hidden="true"><i /></span>
    </section>
  )
}

function MoveAnimation({ cue }) {
  const profile = getMoveAnimationProfile(cue)
  const plan = getMovePixelAnimationPlan(profile)
  const animationRef = useRef(null)
  const renderTrajectory = plan.trajectoryAssets.length > 0 || plan.mode === 'dash'
  const trajectoryAssets = plan.trajectoryAssets.length
    ? plan.trajectoryAssets
    : [plan.primaryAsset, plan.secondaryAsset]
  const sprites = Array.from({ length: renderTrajectory ? plan.copies : 0 }, (_, spriteIndex) => ({
    index: spriteIndex,
    asset: trajectoryAssets[spriteIndex % trajectoryAssets.length],
    delay: spriteIndex * plan.stagger,
    lane: ((profile.seed >>> (spriteIndex % 12)) + spriteIndex * 17) % 5,
    spin: ((profile.seed >>> (spriteIndex % 9)) + spriteIndex * 53) % 360,
  }))
  const targetSelf = profile.targetSelf || cue.targetSideId === cue.sideId
  const style = {
    '--move-primary': profile.primary,
    '--move-secondary': profile.secondary,
    '--move-highlight': profile.highlight,
    '--move-duration': `${profile.duration}ms`,
    '--move-scale': plan.scale,
    '--move-impact-scale': plan.impactScale,
    '--move-arc': `${plan.arc}deg`,
  }

  useEffect(() => {
    const animationRoot = animationRef.current
    if (!animationRoot) return undefined

    const framedAssets = [...animationRoot.querySelectorAll('.pixel-fx-asset.has-frames')]
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    const startedAt = performance.now()
    let requestId = null
    let currentTimelineFrame = 0

    const renderFrame = (timestamp) => {
      const elapsed = Math.max(0, timestamp - startedAt)

      if (reducedMotion) {
        const timelineFrame = Math.min(11, Math.floor((elapsed / profile.duration) * 12))
        if (timelineFrame !== currentTimelineFrame) {
          animationRoot.classList.remove(`timeline-frame-${currentTimelineFrame}`)
          animationRoot.classList.add(`timeline-frame-${timelineFrame}`)
          currentTimelineFrame = timelineFrame
        }
      }

      framedAssets.forEach((assetNode) => {
        const columns = Math.max(1, Number(assetNode.dataset.fxColumns) || 1)
        const rows = Math.max(1, Number(assetNode.dataset.fxRows) || 1)
        const frameCount = Math.max(1, Number(assetNode.dataset.fxFrameCount) || columns * rows)
        const frameOffset = Math.max(0, Number(assetNode.dataset.fxFrameOffset) || 0)
        const frameInterval = Math.max(72, Math.min(120, profile.duration / Math.max(4, frameCount * 2)))
        const cycleLength = frameCount > 1 ? frameCount * 2 - 2 : 1
        const cycleFrame = Math.floor(elapsed / frameInterval + frameOffset) % cycleLength
        const sheetFrame = cycleFrame < frameCount ? cycleFrame : cycleLength - cycleFrame

        if (assetNode.dataset.renderedFxFrame === String(sheetFrame)) return
        assetNode.dataset.renderedFxFrame = String(sheetFrame)
        const sheetColumn = sheetFrame % columns
        const sheetRow = Math.floor(sheetFrame / columns) % rows
        assetNode.style.setProperty('--fx-fallback-shift-x', `${-((sheetColumn / columns) * 100)}%`)
        assetNode.style.setProperty('--fx-fallback-shift-y', `${-((sheetRow / rows) * 100)}%`)
      })

      if (elapsed < profile.duration) requestId = requestAnimationFrame(renderFrame)
    }

    requestId = requestAnimationFrame(renderFrame)
    return () => {
      if (requestId !== null) cancelAnimationFrame(requestId)
    }
  }, [cue.id, profile.duration])

  return (
    <div
      ref={animationRef}
      className={`battle-pixel-move-animation timeline-frame-0 side-${cue.sideId} mode-${plan.mode} fx-${profile.archetype} motif-${profile.motif} screen-${profile.screen} variant-${profile.variant} intensity-${profile.intensity}${targetSelf ? ' target-self' : ''}${profile.targetField ? ' target-field' : ''}`}
      style={style}
      data-move-id={profile.moveId}
      data-animation-source={profile.sourceKind}
      data-move-generation={profile.generation ?? undefined}
      aria-hidden="true"
    >
      <span className="pixel-move-screen" />
      {plan.fieldAsset && <img className="pixel-move-field" src={plan.fieldAsset.src} alt="" draggable="false" />}

      <span className="pixel-move-source">
        <MoveFxAsset asset={plan.primaryAsset} />
        <MoveFxAsset asset={plan.secondaryAsset} frameOffset={1} />
        <i />
      </span>

      <span className="pixel-move-trajectory">
        {sprites.map((sprite) => (
          <MoveFxAsset
            key={`${profile.moveId}-${sprite.index}`}
            asset={sprite.asset}
            frameOffset={sprite.index}
            style={{
              '--sprite-index': sprite.index,
              '--sprite-delay': `${sprite.delay}ms`,
              '--sprite-lane': sprite.lane,
              '--sprite-spin': `${sprite.spin}deg`,
            }}
          />
        ))}
      </span>

      <span className="pixel-move-beam"><i /><b /></span>
      <span className="pixel-move-impact">
        {plan.impactAssets.map((asset, assetIndex) => (
          <MoveFxAsset
            key={`${asset.src}-${assetIndex}`}
            asset={asset}
            frameOffset={assetIndex}
            style={{ '--impact-index': assetIndex }}
          />
        ))}
      </span>
      <strong className="pixel-move-name">{cue.moveName}</strong>
    </div>
  )
}

function MoveFxAsset({ asset, frameOffset = 0, style }) {
  if (!asset?.src) return null
  const frame = asset.frame
  const columns = Math.max(1, Number(frame?.columns) || 1)
  const rows = Math.max(1, Number(frame?.rows) || 1)
  const frameCount = Math.max(1, Number(frame?.count) || columns * rows)
  const framed = frameCount > 1
  const assetStyle = framed
    ? {
        ...style,
        '--fx-columns': columns,
        '--fx-rows': rows,
        '--fx-frame-steps': Math.max(1, frameCount - 1),
        '--fx-frame-duration': `${Math.max(180, frameCount * 88)}ms`,
        '--fx-shift-x': `${-((columns - 1) / columns) * 100}%`,
        '--fx-shift-y': `${-((rows - 1) / rows) * 100}%`,
        '--fx-fallback-shift-x': '0%',
        '--fx-fallback-shift-y': '0%',
        aspectRatio: `${frame.frameWidth} / ${frame.frameHeight}`,
      }
    : style

  return (
    <span
      className={`pixel-fx-asset${framed ? ' has-frames' : ''}`}
      style={assetStyle}
      data-fx-columns={framed ? columns : undefined}
      data-fx-rows={framed ? rows : undefined}
      data-fx-frame-count={framed ? frameCount : undefined}
      data-fx-frame-offset={framed ? frameOffset : undefined}
    >
      {framed ? (
        <span className="pixel-fx-frame">
          <img src={asset.src} alt="" draggable="false" decoding="async" />
        </span>
      ) : (
        <img src={asset.src} alt="" draggable="false" decoding="async" />
      )}
    </span>
  )
}

function BattleArenaEffects({ cue }) {
  if (!cue) return null
  const presentation = cue.effectiveness == null
    ? null
    : effectivenessPresentation(cue.effectiveness)
  const showMoveEffect = cue.phase === 'attack' && cue.moveName
  const showImpact = cue.phase === 'impact' || (cue.phase === 'resolve' && cue.result === 'blocked')
  const showSwitch = cue.phase === 'switch-out' || cue.phase === 'switch'
  const showFaint = cue.phase === 'faint'

  return (
    <>
      {cue.phase === 'gimmick' && (
        <div className={`battle-gimmick-aura side-${cue.sideId} mechanic-${cue.mechanicId}`} key={`gimmick-${cue.id}`}>
          <i /><span /><b>{cue.actorName}</b>
        </div>
      )}

      {showMoveEffect && (
        <MoveAnimation cue={cue} key={`move-${cue.id}`} />
      )}

      {showImpact && (
        <div
          className={`battle-hit-spark target-${cue.targetSideId}${presentation ? ` effectiveness-${presentation.tone}` : ''}${cue.critical ? ' is-critical' : ''} result-${cue.result ?? 'hit'}`}
          key={`impact-${cue.id}`}
          aria-hidden="true"
        >
          <span /><i /><i /><i /><b />
        </div>
      )}

      {showImpact && cue.result !== 'miss' && (
        <div
          className={`battle-impact-feedback target-${cue.targetSideId}${presentation ? ` effectiveness-${presentation.tone}` : ''}${cue.critical ? ' is-critical' : ''}`}
          key={`feedback-${cue.id}`}
          aria-hidden="true"
        >
          <strong>{cue.damage > 0 ? `-${cue.damage}` : presentation?.value ?? 'HIT'}</strong>
          <small>{cue.critical ? '급소에 맞았다!' : presentation?.label ?? '명중'}</small>
          <span className="battle-impact-burst" />
        </div>
      )}

      {showSwitch && (
        <div
          className={`battle-switch-effect side-${cue.sideId} mode-${cue.phase === 'switch-out' ? 'recall' : 'release'}`}
          key={`switch-${cue.id}`}
          aria-hidden="true"
        >
          <span className="battle-switch-ball"><i /></span>
          <span className="battle-switch-beam"><i /></span>
          <span className="battle-switch-ring" />
          <b className="spark-one" /><b className="spark-two" /><b className="spark-three" />
        </div>
      )}

      {showFaint && (
        <div className={`battle-faint-effect target-${cue.targetSideId}`} key={`faint-${cue.id}`} aria-hidden="true">
          <span /><i /><i /><i /><b />
        </div>
      )}
    </>
  )
}

function battleStageClassName(sideId, pokemon, cue) {
  const classes = ['battle-pokemon-stage', sideId]
  if (pokemon.dynamaxActive) classes.push('is-dynamax')
  if (pokemon.fainted) classes.push('is-fainted')
  if (!cue) return classes.join(' ')

  if (cue.sideId === sideId && cue.phase === 'attack') {
    const profile = getMoveAnimationProfile(cue)
    classes.push(
      'is-attacking',
      `attack-${cue.moveCategory ?? 'special'}`,
      `move-motion-${profile.motion}`,
      `move-archetype-${profile.archetype}`,
    )
  }
  if (cue.sideId === sideId && cue.phase === 'gimmick') classes.push('is-gimmicking')
  if (cue.sideId === sideId && cue.phase === 'switch-out') classes.push('is-switching-out')
  if (cue.sideId === sideId && cue.phase === 'switch') classes.push('is-switching-in')
  if (cue.targetSideId === sideId && cue.phase === 'attack' && cue.sideId !== sideId) classes.push('is-anticipating-hit')
  if (cue.targetSideId === sideId && cue.phase === 'impact') classes.push('is-hit')
  if (cue.targetSideId === sideId && cue.phase === 'resolve' && cue.result !== 'miss') classes.push('is-guarding')
  if (cue.targetSideId === sideId && cue.phase === 'status') classes.push('is-status-pulse')
  if (cue.targetSideId === sideId && cue.phase === 'residual') classes.push('is-residual-hit')
  if (cue.targetSideId === sideId && cue.phase === 'faint') classes.push('is-fainting')
  return classes.join(' ')
}

function battleCameraClassName(cue) {
  const classes = ['battle-field-camera']
  if (!cue) return classes.join(' ')
  classes.push(`phase-${cue.phase}`)
  if (cue.sideId) classes.push(`actor-${cue.sideId}`)
  if (cue.targetSideId) classes.push(`target-${cue.targetSideId}`)
  return classes.join(' ')
}

function battleStageStyle(cue) {
  if (cue?.phase !== 'attack') return undefined
  return { '--move-duration': `${turnStepDuration(cue)}ms` }
}

function PartyIndicators({ side }) {
  return (
    <div className="battle-party-indicators" aria-label={`${side.name} 남은 포켓몬`}>
      {side.team.map((pokemon) => (
        <span
          className={`${pokemon.fainted ? 'fainted' : ''}${pokemon.status ? ' statused' : ''}`}
          key={pokemon.battleId}
          title={`${pokemon.name}${pokemon.fainted ? ' · 기절' : ''}`}
        ><i /></span>
      ))}
    </div>
  )
}

function statusAnchorClassName(sideId, cue) {
  const classes = ['battle-status-anchor', `${sideId}-status-anchor`]
  if (!cue) return classes.join(' ')
  if (cue.sideId === sideId) classes.push('is-acting')
  if (cue.targetSideId === sideId) classes.push('is-targeted')
  if (cue.targetSideId === sideId && cue.phase === 'impact') classes.push('is-taking-damage')
  if (cue.targetSideId === sideId && cue.phase === 'faint') classes.push('is-fainting')
  return classes.join(' ')
}

function cueTone(cue) {
  if (!cue) return 'neutral'
  if (cue.phase === 'faint' || cue.phase === 'impact') return cue.targetSideId === 'player' ? 'opponent' : 'player'
  if (cue.phase === 'gimmick') return 'gimmick'
  return cue.sideId ?? 'neutral'
}

function BattleStatusPanel({ pokemon, side, trainerName }) {
  return (
    <section className={`battle-hp-panel side-${side}`}>
      <header>
        <div>
          <strong>{pokemon.name}</strong>
          {pokemon.teraActive && <span className={`type-${typeClassName(pokemon.teraType)}`}><Gem size={10} /> {pokemon.teraType}</span>}
          {pokemon.dynamaxActive && <span className="dynamax-state">MAX</span>}
        </div>
        <span>Lv.50</span>
      </header>
      <div className="battle-hp-meter-row">
        <small>HP</small>
        <span className={`battle-hp-meter tone-${hpTone(pokemon)}`}>
          <i style={{ width: `${hpRatio(pokemon)}%` }} />
        </span>
      </div>
      <footer>
        {side === 'player' ? <b>{pokemon.hp} / {pokemon.maxHp}</b> : <span>{trainerName}</span>}
        {pokemon.status && <em className={`status-${pokemon.status.id}`}>{pokemon.status.label}</em>}
      </footer>
    </section>
  )
}

function PokemonPartyMenu({ battle, forced, onSelect, onBack, onPreview }) {
  const activeIndex = battle.player.activeIndex

  return (
    <section className="battle-party-menu">
      <header>
        <div>
          <small>{forced ? 'CHOOSE NEXT POKÉMON' : 'POKÉMON'}</small>
          <strong>{forced ? '다음 포켓몬을 선택하세요' : '교대할 포켓몬 선택'}</strong>
        </div>
        {!forced && <button type="button" onPointerEnter={onPreview} onClick={onBack}><ChevronLeft size={17} /> 돌아가기</button>}
      </header>
      <div className="battle-party-menu-grid">
        {battle.player.team.map((pokemon, index) => {
          const isActive = index === activeIndex
          const isDisabled = pokemon.fainted || pokemon.hp <= 0 || isActive
          return (
            <button
              className={`${isActive ? 'active' : ''}${pokemon.fainted ? ' fainted' : ''}`}
              type="button"
              disabled={isDisabled}
              key={pokemon.battleId}
              onPointerEnter={isDisabled ? undefined : onPreview}
              onClick={() => onSelect(index)}
            >
              <span className="battle-party-menu-icon">
                <img
                  src={pokemon.icon}
                  alt=""
                  draggable="false"
                  onError={fallbackImageHandler(pokemon.iconFallback)}
                />
              </span>
              <span>
                <strong>{pokemon.name}</strong>
                <small>{pokemon.fainted ? '기절' : isActive ? '배틀 중' : pokemon.status?.label ?? '정상'}</small>
              </span>
              <span className={`battle-party-mini-hp tone-${hpTone(pokemon)}`}>
                <i style={{ width: `${hpRatio(pokemon)}%` }} />
              </span>
              <em>{pokemon.hp}/{pokemon.maxHp}</em>
            </button>
          )
        })}
      </div>
    </section>
  )
}

function BattleMoveTooltip({ id, move, opponent, presentation, visible }) {
  const accuracy = move.accuracyLabel ?? move.accuracy ?? '—'

  return (
    <span
      className={`battle-tooltip battle-move-tooltip type-accent-${typeClassName(move.type)} effectiveness-${presentation.tone}${visible ? ' is-visible' : ''}`}
      id={id}
      role="tooltip"
      aria-hidden={!visible}
    >
      <span className="battle-tooltip-eyebrow">{move.type}타입 · {move.category}</span>
      <strong>{move.name}</strong>
      <span className="battle-tooltip-description">{move.description || '등록된 기술 설명이 없습니다.'}</span>
      <span className="battle-tooltip-meta">
        <span><small>위력</small><b>{move.power || '—'}</b></span>
        <span><small>명중</small><b>{accuracy}</b></span>
        <span><small>PP</small><b>{move.currentPp}/{move.maxPp}</b></span>
        <span><small>상성</small><b>{presentation.value}</b></span>
      </span>
      <span className={`battle-tooltip-matchup effectiveness-${presentation.tone}`}>
        <small>VS {opponent.name}</small>
        <strong>{presentation.value}</strong>
        <span>{presentation.label}</span>
      </span>
      <em>기술 정보</em>
    </span>
  )
}

function MoveMenu({ battle, pendingGimmick, onGimmick, onMove, onBack, onPreview }) {
  const [activeTooltipIndex, setActiveTooltipIndex] = useState(null)
  const pokemon = getActivePokemon(battle, 'player')
  const opponent = getActivePokemon(battle, 'opponent')
  const mechanics = getAvailableBattleMechanics(battle, 'player')

  return (
    <section className="battle-move-menu">
      <header>
        <button type="button" onPointerEnter={onPreview} onClick={onBack}><ChevronLeft size={17} /> 행동 선택</button>
        <div className="battle-gimmick-selector">
          {mechanics.map((mechanic) => (
            <button
              className={`${pendingGimmick === mechanic.id ? 'selected' : ''} mechanic-${mechanic.id}`}
              type="button"
              aria-pressed={pendingGimmick === mechanic.id}
              key={mechanic.id}
              onPointerEnter={onPreview}
              onClick={() => onGimmick(pendingGimmick === mechanic.id ? null : mechanic.id)}
            >
              {mechanic.id === 'tera' ? <Gem size={13} /> : <Sparkles size={13} />}
              {mechanic.shortLabel}
            </button>
          ))}
        </div>
      </header>
      <div className="battle-move-grid">
        {pokemon.moves.map((move, moveIndex) => {
          const isDamagingMove = Number(move.power) > 0 && move.category !== '변화'
          const multiplier = isDamagingMove
            ? getTypeEffectiveness(move.type, opponent.types)
            : null
          const presentation = effectivenessPresentation(multiplier)
          const tooltipId = `battle-move-tooltip-${pokemon.battleId}-${moveIndex}`
          const isTooltipVisible = activeTooltipIndex === moveIndex

          return (
            <div
              className={`battle-move-option effectiveness-${presentation.tone}${isTooltipVisible ? ' tooltip-open' : ''}`}
              key={`${pokemon.battleId}-${move.id}-${moveIndex}`}
              onMouseEnter={() => {
                onPreview?.()
                setActiveTooltipIndex(moveIndex)
              }}
              onMouseLeave={() => setActiveTooltipIndex((currentIndex) => (
                currentIndex === moveIndex ? null : currentIndex
              ))}
            >
              <button
                className={`battle-move-button type-${typeClassName(move.type)} effectiveness-${presentation.tone}`}
                type="button"
                disabled={move.currentPp <= 0}
                aria-describedby={tooltipId}
                onFocus={() => setActiveTooltipIndex(moveIndex)}
                onBlur={() => setActiveTooltipIndex((currentIndex) => (
                  currentIndex === moveIndex ? null : currentIndex
                ))}
                onClick={() => onMove(moveIndex)}
              >
                <span className="battle-move-type">{move.type}</span>
                <span className="battle-move-name">
                  <strong>{move.name}</strong>
                  <small>{move.category}</small>
                </span>
                <span className="battle-move-pp">
                  <small>PP</small>
                  <strong>{move.currentPp}/{move.maxPp}</strong>
                </span>
                <span className="battle-move-power">
                  <small>위력</small>
                  <strong>{move.power || '—'}</strong>
                </span>
                <span className={`battle-move-effectiveness effectiveness-${presentation.tone}`}>
                  <small>상성</small>
                  <strong>{presentation.value}</strong>
                </span>
              </button>
              <BattleMoveTooltip
                id={tooltipId}
                move={move}
                opponent={opponent}
                presentation={presentation}
                visible={isTooltipVisible}
              />
            </div>
          )
        })}
      </div>
    </section>
  )
}

function BattleOverviewMenu({ battle, onBack, onPreview }) {
  const player = getActivePokemon(battle, 'player')
  const opponent = getActivePokemon(battle, 'opponent')

  return (
    <section className="battle-overview-menu">
      <header>
        <button type="button" onPointerEnter={onPreview} onClick={onBack}><ChevronLeft size={17} /> 행동 선택</button>
        <span>TURN {Math.max(1, battle.turn)} · 배틀 현황</span>
      </header>
      <div className="battle-overview-grid">
        {[
          { id: 'player', label: '아군', pokemon: player, remaining: battle.player.team.filter((member) => !member.fainted).length },
          { id: 'opponent', label: '상대', pokemon: opponent, remaining: battle.opponent.team.filter((member) => !member.fainted).length },
        ].map(({ id, label, pokemon, remaining }) => (
          <article className={`side-${id}`} key={id}>
            <div>
              <small>{label} · 남은 포켓몬 {remaining}</small>
              <strong>{pokemon.name}</strong>
            </div>
            <span className="battle-overview-types">
              {pokemon.types.map((type) => <b className={`type-${typeClassName(type)}`} key={type}>{type}</b>)}
            </span>
            <span className={`battle-overview-hp tone-${hpTone(pokemon)}`}>
              <i style={{ width: `${hpRatio(pokemon)}%` }} />
            </span>
            <em>HP {pokemon.hp} / {pokemon.maxHp}{pokemon.status ? ` · ${pokemon.status.label}` : ''}</em>
          </article>
        ))}
      </div>
    </section>
  )
}

function BattleIntro({ opponent, opponentTeam, playerTeam, effectsReady, onStart, onPreview }) {
  return (
    <section className={`battle-intro-overlay${effectsReady ? ' is-ready' : ' is-loading'}`}>
      <div className="battle-intro-streaks" />
      <div className="battle-intro-light battle-intro-light-player" />
      <div className="battle-intro-light battle-intro-light-opponent" />
      <article className="battle-intro-trainer player">
        <TrainerSprite isPlayer className="battle-intro-trainer-sprite" />
        <div>
          <small>CHALLENGER</small>
          <strong>PLAYER_01</strong>
          <span>{playerTeam.map((pokemon) => (
            <img
              key={pokemon.captureId}
              src={pokemon.icon}
              alt={pokemon.name}
              draggable="false"
              onError={fallbackImageHandler(pokemon.iconFallback)}
            />
          ))}</span>
        </div>
      </article>
      <div className="battle-intro-versus">
        <Swords size={36} />
        <strong>VS</strong>
        <small>6 POKÉMON SINGLE BATTLE</small>
      </div>
      <article className="battle-intro-trainer opponent">
        <TrainerSprite trainer={opponent} className="battle-intro-trainer-sprite" />
        <div>
          <small>{opponent.tier} TIER · TEAM {opponent.teamNumber}</small>
          <strong>{opponent.name}</strong>
          <span>{opponentTeam.pokemon.map((pokemon, index) => (
            <img
              key={`${pokemon.speciesId}-${index}`}
              src={pokemon.icon ?? pokemon.iconFallback ?? ''}
              alt={pokemon.name}
              draggable="false"
              onError={fallbackImageHandler(pokemon.iconFallback)}
            />
          ))}</span>
        </div>
      </article>
      <div className="battle-intro-strategy">
        <small>AI BATTLE PLAN</small>
        <strong>{opponentTeam.strategy?.summary ?? `${opponent.name}의 정예 팀과 맞붙습니다.`}</strong>
      </div>
      <button type="button" disabled={!effectsReady} onPointerEnter={effectsReady ? onPreview : undefined} onClick={onStart}>
        {effectsReady ? <Swords size={19} /> : <Sparkles size={19} />}
        {effectsReady ? '배틀 개시' : '기술 연출 준비 중…'}
        {effectsReady && <ChevronRight size={19} />}
      </button>
    </section>
  )
}

function BattleScreen({
  competitionLabel,
  playerPokemon,
  opponent,
  opponentTeam,
  soundEnabled = true,
  onToggleSound,
  onComplete,
}) {
  const [battle, setBattle] = useState(() => createBattle({ playerPokemon, opponent, opponentTeam }))
  const [introVisible, setIntroVisible] = useState(true)
  const [menu, setMenu] = useState('command')
  const [pendingGimmick, setPendingGimmick] = useState(null)
  const [turnCue, setTurnCue] = useState(null)
  const [isTurnAnimating, setIsTurnAnimating] = useState(false)
  const [moveAssetsReady, setMoveAssetsReady] = useState(false)
  const logRef = useRef(null)
  const playbackTimerRef = useRef(null)
  const playbackTokenRef = useRef(0)
  const turnLockedRef = useRef(false)
  const battleAudioRef = useRef(null)
  if (!battleAudioRef.current) battleAudioRef.current = createBattleAudio(soundEnabled)
  const playerActive = getActivePokemon(battle, 'player')
  const opponentActive = getActivePokemon(battle, 'opponent')
  const summary = useMemo(() => getBattleSummary(battle), [battle])
  const currentLogEntry = battle.log.at(-1)
  const currentBattleMessage = turnCue?.message ?? currentLogEntry?.message ?? '배틀을 준비하고 있습니다.'
  const currentBattleTone = turnCue ? cueTone(turnCue) : currentLogEntry?.tone ?? 'neutral'
  const battleLogHistory = battle.log
    .filter((entry) => entry.id !== currentLogEntry?.id || turnCue)
    .slice(-12)

  useEffect(() => {
    let active = true
    let idleHandle = null
    const activePokemon = [
      battle.player.team[battle.player.activeIndex],
      battle.opponent.team[battle.opponent.activeIndex],
    ].filter(Boolean)
    const criticalAssets = activePokemon.flatMap((pokemon) => [
      ...getBattleSpriteAssets(pokemon),
      ...pokemon.moves.flatMap(getMoveAnimationAssets),
    ])
    const allAssets = [...battle.player.team, ...battle.opponent.team]
      .flatMap((pokemon) => [
        ...getBattleSpriteAssets(pokemon),
        ...pokemon.moves.flatMap(getMoveAnimationAssets),
      ])

    preloadMoveAssetsWithTimeout(criticalAssets).then(() => {
      if (active) setMoveAssetsReady(true)
    })

    const warmRemainingAssets = () => {
      allAssets.forEach((asset) => {
        if (!moveAssetDecodeCache.has(asset)) decodeMoveAsset(asset)
      })
    }

    if ('requestIdleCallback' in window) {
      idleHandle = window.requestIdleCallback(warmRemainingAssets, { timeout: 1200 })
    } else {
      idleHandle = window.setTimeout(warmRemainingAssets, 80)
    }

    return () => {
      active = false
      if ('cancelIdleCallback' in window) window.cancelIdleCallback(idleHandle)
      else window.clearTimeout(idleHandle)
    }
  }, [])

  useEffect(() => {
    const animationFrame = requestAnimationFrame(() => {
      if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
    })

    return () => cancelAnimationFrame(animationFrame)
  }, [battle.log.length])

  useEffect(() => () => {
    playbackTokenRef.current += 1
    turnLockedRef.current = false
    if (playbackTimerRef.current) clearTimeout(playbackTimerRef.current)
    battleAudioRef.current?.destroy()
  }, [])

  useEffect(() => {
    battleAudioRef.current?.setEnabled(soundEnabled)
  }, [soundEnabled])

  useEffect(() => {
    battleAudioRef.current?.setLowHpWarning(
      !introVisible && !battle.winner && playerActive.hp > 0 && hpRatio(playerActive) <= 20,
    )
  }, [battle.winner, introVisible, playerActive.hp, playerActive.maxHp])

  useEffect(() => {
    if (!introVisible && turnCue) battleAudioRef.current?.playCue(turnCue)
  }, [introVisible, turnCue])

  const startAnimatedTurn = (playerAction) => {
    if (turnLockedRef.current || battle.winner || battle.awaitingPlayerSwitch) return
    turnLockedRef.current = true
    const playbackToken = playbackTokenRef.current + 1
    playbackTokenRef.current = playbackToken
    const resolution = createBattleTurnTimeline(battle, playerAction)
    const steps = resolution.timeline

    setMenu('command')
    setIsTurnAnimating(steps.length > 0)

    const playStep = (stepIndex) => {
      if (playbackTokenRef.current !== playbackToken) return
      if (stepIndex >= steps.length) {
        setBattle(resolution.state)
        setTurnCue(null)
        setIsTurnAnimating(false)
        turnLockedRef.current = false
        playbackTimerRef.current = null
        return
      }

      const step = steps[stepIndex]
      if (step.phase !== 'attack' || stepIndex === 0) setBattle(step.state)
      setTurnCue(step)
      playbackTimerRef.current = setTimeout(() => playStep(stepIndex + 1), turnStepDuration(step))
    }

    if (steps.length > 0) {
      playStep(0)
    } else {
      setBattle(resolution.state)
      setTurnCue(null)
      setIsTurnAnimating(false)
      turnLockedRef.current = false
    }
  }

  const chooseMove = (moveIndex) => {
    battleAudioRef.current?.playMenu('select')
    startAnimatedTurn({
      type: 'move',
      moveIndex,
      gimmick: pendingGimmick,
    })
    setPendingGimmick(null)
  }

  const chooseSwitch = (targetIndex) => {
    if (turnLockedRef.current) return
    battleAudioRef.current?.playMenu('select')
    if (battle.awaitingPlayerSwitch) {
      const nextBattle = forcePlayerSwitch(battle, targetIndex)
      if (nextBattle === battle) return
      const target = nextBattle.player.team[targetIndex]
      const forcedSwitchCue = {
        id: `${battle.turn}-forced-switch-${target.battleId}`,
        phase: 'switch',
        sideId: 'player',
        targetSideId: 'player',
        actorName: target.name,
        message: `${target.name}! 부탁해!`,
      }

      turnLockedRef.current = true
      setBattle(nextBattle)
      setTurnCue(forcedSwitchCue)
      setIsTurnAnimating(true)
      playbackTimerRef.current = setTimeout(() => {
        setTurnCue(null)
        setIsTurnAnimating(false)
        turnLockedRef.current = false
        playbackTimerRef.current = null
      }, turnStepDuration(forcedSwitchCue))
    } else {
      startAnimatedTurn({ type: 'switch', targetIndex })
    }
    setMenu('command')
  }

  const completeBattle = (forcedWinner) => {
    if (forcedWinner === 'opponent') battleAudioRef.current?.playMenu('cancel')
    onComplete({
      ...summary,
      winner: forcedWinner ?? summary.winner,
      playerRemaining: forcedWinner === 'opponent' ? 0 : summary.playerRemaining,
    })
  }

  const openBattleMenu = (nextMenu) => {
    battleAudioRef.current?.playMenu('select')
    setMenu(nextMenu)
  }

  const returnToCommandMenu = () => {
    battleAudioRef.current?.playMenu('cancel')
    setPendingGimmick(null)
    setMenu('command')
  }

  const previewBattleMenu = () => {
    battleAudioRef.current?.playMenu('cursor')
  }

  return (
    <main className={`battle-game-screen cue-${turnCue?.phase ?? 'command'} actor-${turnCue?.sideId ?? 'none'} target-${turnCue?.targetSideId ?? 'none'}`}>
      <header className="battle-game-header">
        <div className="battle-title-lockup">
          <span><Swords size={14} /> TRAINER BATTLE</span>
          <strong>{competitionLabel}</strong>
        </div>
        <div className="battle-game-turn">
          <small>TURN</small>
          <strong>{Math.max(1, battle.turn)}</strong>
        </div>
        <div className="battle-header-actions">
          <span>{playerActive.name} VS {opponentActive.name}</span>
          <button
            type="button"
            aria-label={soundEnabled ? '배틀 사운드 끄기' : '배틀 사운드 켜기'}
            onClick={() => {
              battleAudioRef.current?.playMenu('select')
              onToggleSound?.()
            }}
          >
            {soundEnabled ? <Volume2 size={17} /> : <VolumeX size={17} />}
          </button>
        </div>
      </header>

      <section className={`battle-arena phase-${turnCue?.phase ?? 'command'}`}>
        <div className={statusAnchorClassName('opponent', turnCue)}>
          <BattleStatusPanel pokemon={opponentActive} side="opponent" trainerName={opponent.name} />
          <PartyIndicators side={battle.opponent} />
        </div>
        <div className={statusAnchorClassName('player', turnCue)}>
          <BattleStatusPanel pokemon={playerActive} side="player" trainerName="PLAYER_01" />
          <PartyIndicators side={battle.player} />
        </div>

        <div className={battleCameraClassName(turnCue)} style={battleStageStyle(turnCue)}>
          <div className="battle-field-horizon" />
          <div className="battle-field-light battle-field-light-player" />
          <div className="battle-field-light battle-field-light-opponent" />
          <div className="battle-cinematic-flash" />
          <div className="battle-arena-scanlines" />
          <div className="battle-platform opponent-platform" />
          <div className="battle-platform player-platform" />

          <div
            className={battleStageClassName('opponent', opponentActive, turnCue)}
            key={`opponent-stage-${opponentActive.battleId}`}
            style={battleStageStyle(turnCue)}
          >
            <span className="battle-pokemon-shadow" aria-hidden="true" />
            <PokemonSprite
              animatedSrc={opponentActive.spriteFront}
              fallbackSrc={opponentActive.spriteFrontFallback}
              frameClassName="battle-live-sprite-frame opponent-sprite-frame"
              className="battle-live-sprite"
              decodingMode="async"
              alt={opponentActive.name}
            />
          </div>

          <div
            className={battleStageClassName('player', playerActive, turnCue)}
            key={`player-stage-${playerActive.battleId}`}
            style={battleStageStyle(turnCue)}
          >
            <span className="battle-pokemon-shadow" aria-hidden="true" />
            <PokemonSprite
              animatedSrc={playerActive.spriteBack}
              fallbackSrc={playerActive.spriteBackFallback}
              frameClassName="battle-live-sprite-frame player-sprite-frame"
              className="battle-live-sprite"
              decodingMode="async"
              alt={playerActive.name}
            />
          </div>

          <BattleArenaEffects cue={turnCue} />
        </div>
      </section>

      <section className="battle-command-deck">
        <aside className="battle-log-panel">
          <header>
            <span><ScrollText size={15} /> 배틀 메시지</span>
            <strong>TURN {Math.max(1, battle.turn)}</strong>
          </header>
          <div className="battle-log-body">
            <div className={`battle-log-focus tone-${currentBattleTone}`} aria-live="assertive">
              <span aria-hidden="true">▶</span>
              <strong>{currentBattleMessage}</strong>
              {!isTurnAnimating && <i aria-hidden="true" />}
            </div>
            <div className="battle-log-scroll" ref={logRef} aria-label="이전 배틀 메시지">
              {battleLogHistory.map((entry) => (
                <p className={`tone-${entry.tone}`} key={entry.id}>{entry.message}</p>
              ))}
            </div>
          </div>
        </aside>

        <div className={`battle-command-panel${isTurnAnimating ? ' is-turn-locked' : ''}`}>
          {isTurnAnimating ? (
            <BattleTurnPlayback key={turnCue?.id ?? 'waiting'} cue={turnCue} turn={Math.max(1, battle.turn)} />
          ) : battle.awaitingPlayerSwitch || menu === 'party' ? (
            <PokemonPartyMenu
              battle={battle}
              forced={battle.awaitingPlayerSwitch}
              onSelect={chooseSwitch}
              onBack={returnToCommandMenu}
              onPreview={previewBattleMenu}
            />
          ) : menu === 'fight' ? (
            <MoveMenu
              battle={battle}
              pendingGimmick={pendingGimmick}
              onGimmick={setPendingGimmick}
              onMove={chooseMove}
              onBack={returnToCommandMenu}
              onPreview={previewBattleMenu}
            />
          ) : menu === 'overview' ? (
            <BattleOverviewMenu battle={battle} onBack={returnToCommandMenu} onPreview={previewBattleMenu} />
          ) : (
            <section className="battle-command-menu">
              <div className="battle-dialogue-box">
                <small>행동을 선택해 주세요</small>
                <strong>{playerActive.name}은(는) 무엇을 할까?</strong>
                <span>{opponentActive.name} · HP {Math.ceil(hpRatio(opponentActive))}%</span>
              </div>
              <div className="battle-command-buttons">
                <button className="fight" type="button" onPointerEnter={previewBattleMenu} onClick={() => openBattleMenu('fight')}>
                  <Swords size={21} />
                  <span><small>FIGHT</small><strong>싸운다</strong></span>
                </button>
                <button className="pokemon" type="button" onPointerEnter={previewBattleMenu} onClick={() => openBattleMenu('party')}>
                  <ArrowLeftRight size={21} />
                  <span><small>POKÉMON</small><strong>포켓몬</strong></span>
                </button>
                <button className="overview" type="button" onPointerEnter={previewBattleMenu} onClick={() => openBattleMenu('overview')}>
                  <Activity size={21} />
                  <span><small>STATUS</small><strong>전황</strong></span>
                </button>
                <button className="surrender" type="button" disabled={isTurnAnimating} onPointerEnter={previewBattleMenu} onClick={() => completeBattle('opponent')}>
                  <Flag size={21} />
                  <span><small>GIVE UP</small><strong>기권</strong></span>
                </button>
              </div>
            </section>
          )}
        </div>
      </section>

      {introVisible && (
        <BattleIntro
          opponent={opponent}
          opponentTeam={{ ...opponentTeam, pokemon: battle.opponent.team }}
          playerTeam={playerPokemon}
          effectsReady={moveAssetsReady}
          onPreview={previewBattleMenu}
          onStart={() => {
            battleAudioRef.current?.start()
            setIntroVisible(false)
          }}
        />
      )}

      {battle.winner && !introVisible && !isTurnAnimating && (
        <section className={`battle-result-overlay result-${battle.winner}`}>
          <span>{battle.winner === 'player' ? <Trophy size={42} /> : <Shield size={42} />}</span>
          <div>
            <small>{battle.winner === 'player' ? 'BATTLE WON' : 'BATTLE LOST'}</small>
            <h2>{battle.winner === 'player' ? `${opponent.name}에게 승리!` : `${opponent.name}에게 패배`}</h2>
            <p>{summary.turns}턴 · 아군 {summary.playerRemaining}마리 · 상대 {summary.opponentRemaining}마리</p>
          </div>
          <button type="button" onClick={() => completeBattle()}>
            대회 결과로 <ChevronRight size={18} />
          </button>
        </section>
      )}
    </main>
  )
}

export default BattleScreen
