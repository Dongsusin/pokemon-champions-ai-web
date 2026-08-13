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
import { getBattleFormOptions, typeClassName } from './data/trainingData'

const MOVE_REFERENCE_BADGES = {
  MAX_MOVE: 'MAX MOVE',
  GMAX_MOVE: 'G-MAX MOVE',
  Z_GENERIC_PHYSICAL: 'Z-POWER',
  Z_GENERIC_SPECIAL: 'Z-POWER',
  Z_SIGNATURE: 'SIGNATURE Z',
  SHADOW_MOVE: 'SHADOW MOVE',
  TERA_TYPE_VARIANTS: 'TERA TYPE',
  FORM_TYPE_VARIANTS: 'FORM TYPE',
  STARMOBILE_TORQUE: 'STAR TORQUE',
  PLZA_NEW_MOVE: 'NEW MOVE',
}

function animationClassToken(value = '') {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unmapped'
}

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
  const formAssets = getBattleFormOptions(pokemon.originalSpeciesId ?? pokemon.speciesId)
    .flatMap((form) => [
      form.spriteFront,
      form.spriteBack,
      form.spriteFrontFallback,
      form.spriteBackFallback,
    ])

  return [
    pokemon.spriteFront,
    pokemon.spriteBack,
    pokemon.spriteFrontFallback,
    pokemon.spriteBackFallback,
    ...formAssets,
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
  gimmick: 2100,
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

const GIMMICK_STEP_DURATIONS = {
  mega: 2300,
  zmove: 1950,
  dynamax: 2450,
  tera: 2200,
  primal: 2350,
}

function turnStepDuration(step) {
  if (step?.phase === 'attack' && step.moveId) return getMoveAnimationProfile(step).duration
  if (step?.phase === 'gimmick') return GIMMICK_STEP_DURATIONS[step.mechanicId] ?? TURN_STEP_DURATIONS.gimmick
  return TURN_STEP_DURATIONS[step?.phase] ?? 700
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
  const referenceBadge = MOVE_REFERENCE_BADGES[profile.recordVariant] ?? null
  const displayedMoveName = referenceBadge && profile.referenceName ? profile.referenceName : cue.moveName
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
      className={`battle-pixel-move-animation timeline-frame-0 side-${cue.sideId} mode-${plan.mode} fx-${profile.archetype} motif-${profile.motif} screen-${profile.screen} variant-${profile.variant} intensity-${profile.intensity} reference-${animationClassToken(profile.recordVariant)} coverage-${animationClassToken(profile.runtimeCoverage)}${profile.manualPriority ? ` manual-${animationClassToken(profile.manualPriority)}` : ''}${targetSelf ? ' target-self' : ''}${profile.targetField ? ' target-field' : ''}`}
      style={style}
      data-move-id={profile.moveId}
      data-animation-source={profile.sourceKind}
      data-move-generation={profile.generation ?? undefined}
      data-reference-record={profile.referenceRecordNo ?? undefined}
      data-reference-variant={profile.recordVariant}
      data-reference-availability={profile.referenceAvailability}
      data-reference-fidelity={profile.fidelityGrade ?? undefined}
      data-runtime-coverage={profile.runtimeCoverage}
      data-logical-canvas={`${profile.logicalCanvas.width}x${profile.logicalCanvas.height}`}
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
      <strong className="pixel-move-name">{displayedMoveName}</strong>
      {referenceBadge && <small className="pixel-move-reference-badge">{referenceBadge}</small>}
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

const GIMMICK_SPARKS = Array.from({ length: 18 }, (_, index) => index)
const GIMMICK_CRYSTALS = Array.from({ length: 14 }, (_, index) => index)

const GIMMICK_PRESENTATION = {
  mega: {
    eyebrow: 'KEY STONE RESONANCE',
    title: '메가진화',
  },
  zmove: {
    eyebrow: 'TRAINER & POKÉMON · FULL FORCE',
    title: 'Z파워',
  },
  dynamax: {
    eyebrow: 'GALAR PARTICLE SURGE',
    title: '다이맥스',
  },
  tera: {
    eyebrow: 'TERASTAL PHENOMENON',
    title: '테라스탈',
  },
  primal: {
    eyebrow: 'ANCIENT ENERGY AWAKENING',
    title: '원시회귀',
  },
}

function gimmickDetail(cue) {
  if (cue.mechanicId === 'tera') return `${cue.mechanicType ?? '노말'} TERA TYPE`
  if (cue.mechanicId === 'dynamax') return cue.mechanicMode === 'gigantamax' ? 'GIGANTAMAX' : 'DYNAMAX'
  if (cue.mechanicId === 'zmove') return cue.chargedMoveName ?? 'Z-MOVE CHARGED'
  if (cue.actorPreviousName && cue.actorPreviousName !== cue.actorName) {
    return `${cue.actorPreviousName}  →  ${cue.actorName}`
  }
  return cue.actorName
}

function GimmickAnimation({ cue }) {
  const presentation = GIMMICK_PRESENTATION[cue.mechanicId] ?? {
    eyebrow: 'BATTLE GIMMICK',
    title: cue.mechanicLabel ?? '배틀 기믹',
  }
  const useBackSprite = cue.sideId === 'player'
  const beforeSrc = useBackSprite ? cue.spriteBeforeBack : cue.spriteBeforeFront
  const beforeFallback = useBackSprite ? cue.spriteBeforeBackFallback : cue.spriteBeforeFrontFallback
  const afterSrc = useBackSprite ? cue.spriteAfterBack : cue.spriteAfterFront
  const afterFallback = useBackSprite ? cue.spriteAfterBackFallback : cue.spriteAfterFrontFallback
  const mechanicTypeClass = cue.mechanicType ? ` tera-type-${typeClassName(cue.mechanicType)}` : ''
  const duration = turnStepDuration(cue)

  return (
    <section
      className={`battle-gimmick-sequence mechanic-${cue.mechanicId} side-${cue.sideId}${mechanicTypeClass}`}
      style={{ '--gimmick-duration': `${duration}ms` }}
      role="img"
      aria-label={`${cue.actorName}의 ${presentation.title} 연출`}
    >
      <span className="battle-gimmick-screen-tint" />
      <span className="battle-gimmick-speedlines" />
      <span className="battle-gimmick-whiteout" />

      {cue.mechanicId === 'mega' && (
        <div className="gimmick-mega-layer" aria-hidden="true">
          <img className="gimmick-mega-background" src="/assets/move-fx/ebdx/ebMegaBg.png" alt="" />
          <span className="gimmick-mega-helix"><i /><i /><i /></span>
          <img className="gimmick-mega-sigil" src="/assets/move-fx/ebdx/ebMega006.png" alt="" />
          <img className="gimmick-mega-strike" src="/assets/move-fx/ebdx/ebMega005.png" alt="" />
        </div>
      )}

      {cue.mechanicId === 'zmove' && (
        <div className="gimmick-z-layer" aria-hidden="true">
          <span className="gimmick-z-emblem">Z</span>
          <span className="gimmick-z-prism"><i /><i /><i /><i /><i /><i /></span>
          <span className="gimmick-z-energy-line" />
        </div>
      )}

      {cue.mechanicId === 'dynamax' && (
        <div className="gimmick-dynamax-layer" aria-hidden="true">
          <span className="gimmick-dynamax-clouds"><i /><i /><i /></span>
          <span className="gimmick-dynamax-vortex"><i /><i /><i /></span>
          <span className="gimmick-dynamax-pillars"><i /><i /><i /><i /></span>
        </div>
      )}

      {cue.mechanicId === 'tera' && (
        <div className="gimmick-tera-layer" aria-hidden="true">
          <span className="gimmick-tera-rainbow" />
          <span className="gimmick-tera-crown"><i /><i /><i /><b>{cue.mechanicType?.slice(0, 1)}</b></span>
          <span className="gimmick-tera-crystals">
            {GIMMICK_CRYSTALS.map((index) => (
              <i key={index} style={{ '--crystal-index': index }} />
            ))}
          </span>
        </div>
      )}

      {cue.mechanicId === 'primal' && (
        <div className="gimmick-primal-layer" aria-hidden="true">
          <span className="gimmick-primal-sigil"><i /><i /><i /></span>
          <span className="gimmick-primal-wave"><i /><i /></span>
        </div>
      )}

      <div className="battle-gimmick-sparks" aria-hidden="true">
        {GIMMICK_SPARKS.map((index) => (
          <i key={index} style={{ '--spark-index': index }} />
        ))}
      </div>

      <div className="battle-gimmick-focus" aria-hidden="true">
        <span className="battle-gimmick-ground" />
        <span className="battle-gimmick-orbit orbit-outer" />
        <span className="battle-gimmick-orbit orbit-inner" />
        <PokemonSprite
          animatedSrc={beforeSrc}
          fallbackSrc={beforeFallback}
          frameClassName="battle-gimmick-pokemon is-before"
          className="battle-gimmick-pokemon-image"
          decodingMode="sync"
          alt=""
        />
        <PokemonSprite
          animatedSrc={afterSrc ?? beforeSrc}
          fallbackSrc={afterFallback ?? beforeFallback}
          frameClassName="battle-gimmick-pokemon is-after"
          className="battle-gimmick-pokemon-image"
          decodingMode="sync"
          alt=""
        />
        <span className="battle-gimmick-silhouette" />
      </div>

      <div className="battle-gimmick-title-card">
        <small>{presentation.eyebrow}</small>
        <strong>{cue.mechanicId === 'dynamax' && cue.mechanicMode === 'gigantamax' ? '거다이맥스' : presentation.title}</strong>
        <span>{gimmickDetail(cue)}</span>
      </div>
    </section>
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
        <GimmickAnimation cue={cue} key={`gimmick-${cue.id}`} />
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
  if (pokemon.teraActive) classes.push('is-terastal', `tera-${typeClassName(pokemon.teraType)}`)
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
  if (cue.sideId === sideId && cue.phase === 'gimmick') {
    classes.push('is-gimmicking', `gimmick-${cue.mechanicId}`)
  }
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
  if (cue.phase === 'gimmick' && cue.mechanicId) classes.push(`gimmick-${cue.mechanicId}`)
  return classes.join(' ')
}

function battleStageStyle(cue) {
  if (cue?.phase === 'attack') return { '--move-duration': `${turnStepDuration(cue)}ms` }
  if (cue?.phase === 'gimmick') return { '--gimmick-duration': `${turnStepDuration(cue)}ms` }
  return undefined
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
          {pokemon.megaActive && <span className="mega-state">MEGA</span>}
          {pokemon.primalActive && <span className="primal-state">PRIMAL</span>}
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
              <span className="battle-gimmick-button-symbol" aria-hidden="true">
                {mechanic.id === 'tera' ? '◇' : mechanic.id === 'dynamax' ? 'MAX' : mechanic.id === 'zmove' ? 'Z' : 'M'}
              </span>
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

const BATTLE_STAT_STAGE_LABELS = [
  ['attack', '공격'],
  ['defense', '방어'],
  ['specialAttack', '특공'],
  ['specialDefense', '특방'],
  ['speed', '스피드'],
]

function battleStatStageEntries(pokemon) {
  return BATTLE_STAT_STAGE_LABELS
    .map(([id, label]) => ({ id, label, stage: pokemon.statStages?.[id] ?? 0 }))
    .filter(({ stage }) => stage !== 0)
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
        ].map(({ id, label, pokemon, remaining }) => {
          const hpPercent = Math.ceil(hpRatio(pokemon))
          const statStages = battleStatStageEntries(pokemon)

          return (
            <article className={`side-${id}`} key={id}>
              <div className="battle-overview-heading">
                <small>{label} · 남은 포켓몬 {remaining}</small>
                <strong>{pokemon.name}</strong>
              </div>
              <span className="battle-overview-types">
                {pokemon.types.map((type) => <b className={`type-${typeClassName(type)}`} key={type}>{type}</b>)}
              </span>
              <div className="battle-overview-hp-line">
                <span className={`battle-overview-hp tone-${hpTone(pokemon)}`}>
                  <i style={{ width: `${hpRatio(pokemon)}%` }} />
                </span>
                <em>HP {hpPercent}%{pokemon.status ? ` · ${pokemon.status.label}` : ''}</em>
              </div>
              <div className="battle-overview-stat-stages" aria-label={`${pokemon.name} 능력 변화`}>
                <small>능력 변화</small>
                <span>
                  {statStages.length > 0 ? statStages.map(({ id: statId, label: statLabel, stage }) => (
                    <b
                      className={stage > 0 ? 'is-raised' : 'is-lowered'}
                      key={statId}
                      title={`${statLabel} ${Math.abs(stage)}단계 ${stage > 0 ? '상승' : '하락'}`}
                    >
                      {statLabel}<em>{stage > 0 ? '+' : ''}{stage}</em>
                    </b>
                  )) : <em className="is-neutral">변화 없음</em>}
                </span>
              </div>
            </article>
          )
        })}
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
  const commandLocked = isTurnAnimating || Boolean(battle.winner)

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
  }, [battle.log.length, currentBattleMessage])

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
            <span><ScrollText size={15} /> 배틀 로그</span>
            <strong>TURN {Math.max(1, battle.turn)}</strong>
          </header>
          <div className="battle-log-body">
            <div className="battle-log-scroll" ref={logRef} aria-label="배틀 로그" aria-live="polite">
              {battleLogHistory.map((entry) => (
                <p className={`tone-${entry.tone}`} key={entry.id}>{entry.message}</p>
              ))}
              <p
                className={`battle-log-current tone-${currentBattleTone}`}
                key={`current-${turnCue?.id ?? currentLogEntry?.id ?? 'ready'}`}
              >
                <span aria-hidden="true">▶</span>
                <span className="battle-log-current-message">{currentBattleMessage}</span>
              </p>
            </div>
          </div>
        </aside>

        <div className={`battle-command-panel${commandLocked ? ' is-turn-locked' : ''}`} aria-busy={isTurnAnimating}>
          {!commandLocked && (battle.awaitingPlayerSwitch || menu === 'party') ? (
            <PokemonPartyMenu
              battle={battle}
              forced={battle.awaitingPlayerSwitch}
              onSelect={chooseSwitch}
              onBack={returnToCommandMenu}
              onPreview={previewBattleMenu}
            />
          ) : !commandLocked && menu === 'fight' ? (
            <MoveMenu
              battle={battle}
              pendingGimmick={pendingGimmick}
              onGimmick={setPendingGimmick}
              onMove={chooseMove}
              onBack={returnToCommandMenu}
              onPreview={previewBattleMenu}
            />
          ) : !commandLocked && menu === 'overview' ? (
            <BattleOverviewMenu battle={battle} onBack={returnToCommandMenu} onPreview={previewBattleMenu} />
          ) : (
            <section className="battle-command-menu">
              <div className="battle-command-buttons">
                <button className="fight" type="button" disabled={commandLocked} onPointerEnter={previewBattleMenu} onClick={() => openBattleMenu('fight')}>
                  <Swords size={21} />
                  <span><small>FIGHT</small><strong>싸운다</strong></span>
                </button>
                <button className="pokemon" type="button" disabled={commandLocked} onPointerEnter={previewBattleMenu} onClick={() => openBattleMenu('party')}>
                  <ArrowLeftRight size={21} />
                  <span><small>POKÉMON</small><strong>포켓몬</strong></span>
                </button>
                <button className="overview" type="button" disabled={commandLocked} onPointerEnter={previewBattleMenu} onClick={() => openBattleMenu('overview')}>
                  <Activity size={21} />
                  <span><small>STATUS</small><strong>전황</strong></span>
                </button>
                <button className="surrender" type="button" disabled={commandLocked} onPointerEnter={previewBattleMenu} onClick={() => completeBattle('opponent')}>
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
