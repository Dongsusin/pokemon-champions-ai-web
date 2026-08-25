import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  ArrowLeftRight,
  Axe,
  Bug,
  ChevronLeft,
  ChevronRight,
  Circle,
  Dna,
  Droplets,
  Dumbbell,
  Earth,
  Eye,
  Feather,
  Flag,
  Flame,
  Flower2,
  Gem,
  Ghost,
  Heart,
  Moon,
  Mountain,
  ScrollText,
  Settings,
  Shield,
  Skull,
  Snowflake,
  Sparkles,
  Star,
  Swords,
  Trophy,
  Volume2,
  VolumeX,
  Zap,
} from 'lucide-react'
import { createBattleAudio } from './battleAudio'
import BattlePokemonStatusTooltip, { battleStatStageEntries } from './BattlePokemonStatusTooltip'
import PokemonSprite from './PokemonSprite'
import TrainerSprite from './TrainerSprite'
import {
  createBattle,
  createBattleTurnTimeline,
  forcePlayerSwitch,
  getActivePokemon,
  getActivePokemonList,
  getAvailableBattleMechanics,
  getBattleMovePreview,
  getBattleTypeEffectiveness,
  getBattleSummary,
  getConditionalBattleFormAssets,
  getForcedBattleAction,
} from './data/battleEngine'
import {
  getMoveAnimationAssets,
  getMoveAnimationProfile,
  getMovePixelAnimationPlan,
} from './data/moveAnimationData'
import { getAiBattleDifficultyLabel, getBattleRuleDescription } from './data/battleRules'
import { getRelatedFormOptions, typeClassName } from './data/trainingData'

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
  const battleBaseSpeciesId = Number(
    pokemon.battleBaseSpeciesId ?? pokemon.originalSpeciesId ?? pokemon.speciesId,
  )
  const formAssets = getRelatedFormOptions(battleBaseSpeciesId)
    .filter((form) => (
      Number(form.id) === battleBaseSpeciesId
      || Number(form.parentSpeciesId) === battleBaseSpeciesId
    ))
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
    ...getConditionalBattleFormAssets(pokemon),
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

const MANUAL_OPPONENT_TARGETS = new Set(['normal', 'adjacentFoe', 'any'])

function moveDealsDirectDamage(move) {
  return move?.category !== '변화'
    && (
      Number(move?.power) > 0
      || move?.ohko
      || move?.damage !== undefined
      || move?.currentHpFraction
      || move?.id === 'finalgambit'
    )
}

function needsOpponentTargetSelection(move, availableTargetCount) {
  return availableTargetCount > 1 && MANUAL_OPPONENT_TARGETS.has(move?.moveTarget ?? move?.target)
}

const TURN_STEP_DURATIONS = {
  gimmick: 2100,
  form: 1200,
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

const TURN_ACTION_PAUSE = 520

const ATTACK_ANIMATION_PHASES = new Set(['announce', 'attack', 'impact', 'resolve'])
const ATTACK_ANIMATION_RATES = {
  normal: 1,
  fast: 1.5,
  'very-fast': 2,
}

const HP_BAR_DURATIONS = {
  slow: 900,
  normal: 520,
  fast: 240,
  instant: 0,
}

const GIMMICK_STEP_DURATIONS = {
  form: 1200,
  mega: 3000,
  zmove: 2700,
  dynamax: 3300,
  tera: 3050,
  primal: 2350,
}

function baseTurnStepDuration(step) {
  if (step?.moveId && (step.phase === 'attack' || step.phase === 'impact' || (step.phase === 'resolve' && step.result === 'blocked'))) {
    const profile = getMoveAnimationProfile(step)
    return step.phase === 'attack' ? profile.duration : getMovePixelAnimationPlan(profile).impactDuration
  }
  if (step?.phase === 'gimmick' || step?.phase === 'form') {
    return GIMMICK_STEP_DURATIONS[step.mechanicId] ?? TURN_STEP_DURATIONS[step.phase]
  }
  return TURN_STEP_DURATIONS[step?.phase] ?? 700
}

function attackAnimationRate(mode = 'normal') {
  return ATTACK_ANIMATION_RATES[mode] ?? 1
}

function turnStepDuration(step, animationMode = 'normal') {
  const duration = baseTurnStepDuration(step)
  if (!ATTACK_ANIMATION_PHASES.has(step?.phase)) return duration
  if (animationMode === 'skip') return 70
  return Math.max(90, Math.round(duration / attackAnimationRate(animationMode)))
}

function turnPlaybackDelay(steps, stepIndex, animationMode = 'normal') {
  const step = steps[stepIndex]
  const nextStep = steps[stepIndex + 1]
  const baseDuration = turnStepDuration(step, animationMode)
  if (step?.actionOrder == null) return baseDuration
  if (nextStep?.actionOrder === step.actionOrder) return baseDuration
  const actionPause = animationMode === 'skip'
    ? 90
    : Math.round(TURN_ACTION_PAUSE / attackAnimationRate(animationMode))
  return baseDuration + actionPause
}

function battleStageAnchor(camera, sideId, activeSlot) {
  const stage = camera.querySelector(`.battle-pokemon-stage.${sideId}.slot-${activeSlot ?? 0}`)
  if (!stage) return null

  const cameraBounds = camera.getBoundingClientRect()
  const stageBounds = stage.getBoundingClientRect()
  return {
    x: stageBounds.left - cameraBounds.left + stageBounds.width * 0.5,
    y: stageBounds.top - cameraBounds.top + stageBounds.height * 0.45,
    width: stageBounds.width,
    height: stageBounds.height,
  }
}

function battleSideAnchor(camera, sideId) {
  const stages = [...camera.querySelectorAll(`.battle-pokemon-stage.${sideId}:not(.is-fainted)`)]
    .filter((stage) => !stage.classList.contains('is-rotation-reserve'))
  const anchors = stages
    .map((stage) => {
      const slotClass = [...stage.classList].find((className) => className.startsWith('slot-'))
      return battleStageAnchor(camera, sideId, Number(slotClass?.slice(5)) || 0)
    })
    .filter(Boolean)

  if (!anchors.length) return null
  return {
    x: anchors.reduce((sum, anchor) => sum + anchor.x, 0) / anchors.length,
    y: anchors.reduce((sum, anchor) => sum + anchor.y, 0) / anchors.length,
  }
}

function useMoveAnimationAnchors(animationRef, cue, profile) {
  useLayoutEffect(() => {
    const animationRoot = animationRef.current
    const camera = animationRoot?.closest('.battle-field-camera')
    const format = cue.state?.rules?.format
    if (!animationRoot || !camera) return undefined

    const cameraProperties = [
      '--actor-lunge-x',
      '--actor-lunge-y',
      '--actor-recoil-x',
      '--actor-recoil-y',
      '--actor-cast-x',
      '--actor-cast-y',
    ]

    const updateAnchors = () => {
      const cameraBounds = camera.getBoundingClientRect()
      const sourceStage = battleStageAnchor(camera, cue.sideId, cue.actorSlot)
      if (!sourceStage || cameraBounds.width <= 0 || cameraBounds.height <= 0) return

      const useSpreadAnchor = profile.targetSpread && !format?.rotation
      const targetStage = profile.targetSelf
        ? sourceStage
        : profile.targetField
          ? { x: cameraBounds.width * 0.5, y: cameraBounds.height * 0.61 }
          : useSpreadAnchor
            ? battleSideAnchor(camera, cue.targetSideId)
            : battleStageAnchor(camera, cue.targetSideId, cue.targetSlot)
      if (!targetStage) return

      const stageTravelX = targetStage.x - sourceStage.x
      const stageTravelY = targetStage.y - sourceStage.y
      const stageDistance = Math.max(1, Math.hypot(stageTravelX, stageTravelY))
      const unitX = stageTravelX / stageDistance
      const unitY = stageTravelY / stageDistance
      const canInsetAnchors = !profile.targetSelf && !profile.targetField && !useSpreadAnchor
      const sourceInset = canInsetAnchors
        ? Math.min(sourceStage.width ?? 0, sourceStage.height ?? 0) * (profile.motion === 'dash' || profile.motion === 'lunge' ? 0.14 : 0.23)
        : 0
      const targetInset = canInsetAnchors
        ? Math.min(targetStage.width ?? 0, targetStage.height ?? 0) * 0.12
        : 0
      const source = {
        x: sourceStage.x + unitX * sourceInset,
        y: sourceStage.y + unitY * sourceInset,
      }
      const target = {
        x: targetStage.x - unitX * targetInset,
        y: targetStage.y - unitY * targetInset,
      }
      const travelX = target.x - source.x
      const travelY = target.y - source.y
      const distance = Math.max(1, Math.hypot(travelX, travelY))
      const motionDistance = profile.motion === 'dash'
        ? Math.min(220, distance * 0.42)
        : profile.motion === 'lunge'
          ? Math.min(150, distance * 0.28)
          : profile.motion === 'leap'
            ? Math.min(120, distance * 0.22)
            : Math.min(28, distance * 0.06)
      const lungeX = unitX * motionDistance
      const lungeY = unitY * motionDistance
      animationRoot.style.setProperty('--source-x', `${source.x}px`)
      animationRoot.style.setProperty('--source-y', `${source.y}px`)
      animationRoot.style.setProperty('--target-x', `${target.x}px`)
      animationRoot.style.setProperty('--target-y', `${target.y}px`)
      animationRoot.style.setProperty('--travel-x', `${travelX}px`)
      animationRoot.style.setProperty('--travel-y', `${travelY}px`)
      animationRoot.style.setProperty('--reverse-travel-x', `${-travelX}px`)
      animationRoot.style.setProperty('--reverse-travel-y', `${-travelY}px`)
      animationRoot.style.setProperty('--trajectory-distance', `${Math.hypot(travelX, travelY)}px`)
      animationRoot.style.setProperty('--trajectory-angle', `${Math.atan2(travelY, travelX) * 180 / Math.PI}deg`)
      animationRoot.classList.add('is-slot-anchored')
      camera.style.setProperty('--actor-lunge-x', `${lungeX}px`)
      camera.style.setProperty('--actor-lunge-y', `${lungeY}px`)
      camera.style.setProperty('--actor-recoil-x', `${-unitX * 18}px`)
      camera.style.setProperty('--actor-recoil-y', `${-unitY * 18}px`)
      camera.style.setProperty('--actor-cast-x', `${unitX * 22}px`)
      camera.style.setProperty('--actor-cast-y', `${unitY * 22}px`)
    }

    let frameId = null
    const syncAnchors = () => {
      updateAnchors()
      frameId = requestAnimationFrame(syncAnchors)
    }

    syncAnchors()
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateAnchors)
    resizeObserver?.observe(camera)
    return () => {
      if (frameId !== null) cancelAnimationFrame(frameId)
      resizeObserver?.disconnect()
      cameraProperties.forEach((property) => camera.style.removeProperty(property))
    }
  }, [cue.id, cue.actorSlot, cue.sideId, cue.targetSideId, cue.targetSlot, cue.state?.rules?.format?.id, profile.motion, profile.targetField, profile.targetSelf, profile.targetSpread])
}

function moveAnimationStyle(profile, plan, duration = profile.duration, impactDuration = plan.impactDuration) {
  return {
    '--move-primary': profile.primary,
    '--move-secondary': profile.secondary,
    '--move-highlight': profile.highlight,
    '--move-duration': `${duration}ms`,
    '--impact-duration': `${impactDuration}ms`,
    '--move-scale': plan.scale,
    '--move-impact-scale': plan.impactScale,
    '--move-arc': `${plan.arc}deg`,
  }
}

function moveAnimationClassName(cue, profile, plan, phase) {
  const targetSelf = profile.targetSelf || cue.targetSideId === cue.sideId
  return `battle-pixel-${phase}-animation timeline-frame-0 side-${cue.sideId} actor-slot-${cue.actorSlot ?? 0} target-slot-${cue.targetSlot ?? 0} mode-${plan.mode} tempo-${plan.tempo} fx-${profile.archetype} motif-${profile.motif} screen-${profile.screen} variant-${profile.variant} intensity-${profile.intensity} reference-${animationClassToken(profile.recordVariant)} coverage-${animationClassToken(profile.runtimeCoverage)}${profile.manualPriority ? ` manual-${animationClassToken(profile.manualPriority)}` : ''}${targetSelf ? ' target-self' : ''}${profile.targetField ? ' target-field' : ''}${profile.targetSpread ? ' target-spread' : ''}`
}

function sceneAssetForSide(plan, sideId) {
  if (!plan.sceneAssets.length) return null
  const sidePattern = sideId === 'player' ? /_PU(?:_|\.|$)/i : /_EU(?:_|\.|$)/i
  return plan.sceneAssets.find((asset) => sidePattern.test(asset.file ?? '')) ?? plan.sceneAssets[0]
}

function useFxSheetPlayback(animationRef, duration, cueId) {
  useEffect(() => {
    const animationRoot = animationRef.current
    if (!animationRoot) return undefined

    const framedAssets = [...animationRoot.querySelectorAll('.pixel-fx-asset.has-frames')]
    const startedAt = performance.now()
    let requestId = null
    let currentTimelineFrame = -1

    const renderFrame = (timestamp) => {
      const elapsed = Math.max(0, timestamp - startedAt)
      const progress = Math.min(1, elapsed / Math.max(1, duration))
      const timelineFrame = Math.min(11, Math.floor(progress * 12))
      if (timelineFrame !== currentTimelineFrame) {
        if (currentTimelineFrame >= 0) animationRoot.classList.remove(`timeline-frame-${currentTimelineFrame}`)
        animationRoot.classList.add(`timeline-frame-${timelineFrame}`)
        currentTimelineFrame = timelineFrame
      }

      framedAssets.forEach((assetNode) => {
        const columns = Math.max(1, Number(assetNode.dataset.fxColumns) || 1)
        const rows = Math.max(1, Number(assetNode.dataset.fxRows) || 1)
        const frameCount = Math.max(1, Number(assetNode.dataset.fxFrameCount) || columns * rows)
        const frameOffset = Math.max(0, Number(assetNode.dataset.fxFrameOffset) || 0)
        const start = Math.max(0, Math.min(1, Number(assetNode.dataset.fxTimelineStart) || 0))
        const end = Math.max(start + 0.01, Math.min(1, Number(assetNode.dataset.fxTimelineEnd) || 1))
        const localProgress = Math.max(0, Math.min(1, (progress - start) / (end - start)))
        const sheetFrame = assetNode.dataset.fxPlayback === 'loop'
          ? (Math.floor(localProgress * frameCount * 1.8) + frameOffset) % frameCount
          : Math.min(frameCount - 1, Math.floor(localProgress * frameCount))

        if (assetNode.dataset.renderedFxFrame === String(sheetFrame)) return
        assetNode.dataset.renderedFxFrame = String(sheetFrame)
        const sheetColumn = sheetFrame % columns
        const sheetRow = Math.floor(sheetFrame / columns) % rows
        assetNode.style.setProperty('--fx-fallback-shift-x', `${-((sheetColumn / columns) * 100)}%`)
        assetNode.style.setProperty('--fx-fallback-shift-y', `${-((sheetRow / rows) * 100)}%`)
      })

      if (elapsed < duration) requestId = requestAnimationFrame(renderFrame)
    }

    requestId = requestAnimationFrame(renderFrame)
    return () => {
      if (requestId !== null) cancelAnimationFrame(requestId)
    }
  }, [cueId, duration, animationRef])
}

function MoveAnimation({ cue, animationMode }) {
  const profile = getMoveAnimationProfile(cue)
  const plan = getMovePixelAnimationPlan(profile)
  const animationRef = useRef(null)
  const duration = turnStepDuration(cue, animationMode)
  const animationRate = attackAnimationRate(animationMode)
  const impactDuration = Math.max(90, Math.round(plan.impactDuration / animationRate))
  const sprites = Array.from({ length: plan.trajectoryAssets.length ? plan.copies : 0 }, (_, spriteIndex) => ({
    index: spriteIndex,
    asset: plan.trajectoryAssets[spriteIndex % plan.trajectoryAssets.length],
    delay: spriteIndex * plan.stagger,
    lane: ((profile.seed >>> (spriteIndex % 12)) + spriteIndex * 17) % 5,
    spin: ['projectile', 'stream', 'wave', 'drain', 'dash', 'melee'].includes(plan.mode)
      ? ((((profile.seed >>> (spriteIndex % 9)) + spriteIndex * 7) % 17) - 8)
      : ((profile.seed >>> (spriteIndex % 9)) + spriteIndex * 53) % 360,
  }))

  useMoveAnimationAnchors(animationRef, cue, profile)
  useFxSheetPlayback(animationRef, duration, cue.id)

  return (
    <div
      ref={animationRef}
      className={moveAnimationClassName(cue, profile, plan, 'move')}
      style={moveAnimationStyle(profile, plan, duration, impactDuration)}
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
      {plan.sourceAssets.length > 0 && (
        <span className="pixel-move-source">
          {plan.sourceAssets.map((asset, assetIndex) => (
            <MoveFxAsset
              key={`${asset.src}-${assetIndex}`}
              asset={asset}
              frameOffset={assetIndex}
              role="source"
              timelineEnd={0.46}
            />
          ))}
          <i />
        </span>
      )}

      <span className="pixel-move-trajectory">
        {sprites.map((sprite) => (
          <MoveFxAsset
            key={`${profile.moveId}-${sprite.index}`}
            asset={sprite.asset}
            frameOffset={sprite.index}
            role="trajectory"
            timelineStart={0.18}
            timelineEnd={0.96}
            style={{
              '--sprite-index': sprite.index,
              '--sprite-delay': `${Math.round(sprite.delay / animationRate)}ms`,
              '--sprite-lane': sprite.lane,
              '--sprite-spin': `${sprite.spin}deg`,
            }}
          />
        ))}
      </span>

      <span className="pixel-move-beam">
        {plan.beamAsset && <MoveFxAsset asset={plan.beamAsset} role="beam" timelineStart={0.24} timelineEnd={0.92} />}
        <i /><b />
      </span>
      {plan.inlineImpact && (
        <span className="pixel-move-impact inline-impact">
          {plan.impactAssets.map((asset, assetIndex) => (
            <MoveFxAsset
              key={`${asset.src}-${assetIndex}`}
              asset={asset}
              frameOffset={assetIndex}
              role="impact"
              timelineStart={0.38}
              timelineEnd={0.94}
              style={{ '--impact-index': assetIndex }}
            />
          ))}
        </span>
      )}
    </div>
  )
}

function MoveSceneAnimation({ cue, animationMode }) {
  const profile = getMoveAnimationProfile(cue)
  const plan = getMovePixelAnimationPlan(profile)
  const animationRef = useRef(null)
  const sceneAsset = sceneAssetForSide(plan, cue.sideId)
  const duration = turnStepDuration(cue, animationMode)
  const impactDuration = Math.max(90, Math.round(plan.impactDuration / attackAnimationRate(animationMode)))

  useMoveAnimationAnchors(animationRef, cue, profile)
  useFxSheetPlayback(animationRef, duration, cue.id)

  return (
    <div
      ref={animationRef}
      className={moveAnimationClassName(cue, profile, plan, 'scene')}
      style={moveAnimationStyle(profile, plan, duration, impactDuration)}
      aria-hidden="true"
    >
      <span className="pixel-move-screen" />
      {sceneAsset && <img className="pixel-move-field" src={sceneAsset.src} alt="" draggable="false" />}
    </div>
  )
}

function MoveImpactAnimation({ cue, presentation, animationMode, showDamageNumbers }) {
  const profile = getMoveAnimationProfile(cue)
  const plan = getMovePixelAnimationPlan(profile)
  const animationRef = useRef(null)
  const hitCount = Math.max(1, Math.min(5, Number(cue.hitCount) || 1))
  const feedbackLabel = cue.critical ? '급소에 맞았다!' : presentation?.label ?? '명중'
  const duration = turnStepDuration(cue, animationMode)
  const damageLabel = cue.result === 'blocked'
    ? 'BLOCK'
    : showDamageNumbers && cue.damage > 0
      ? `-${cue.damage}`
      : presentation?.value ?? 'HIT'

  useMoveAnimationAnchors(animationRef, cue, profile)
  useFxSheetPlayback(animationRef, duration, cue.id)

  return (
    <div
      ref={animationRef}
      className={`${moveAnimationClassName(cue, profile, plan, 'impact')} result-${cue.result ?? 'hit'}${presentation ? ` effectiveness-${presentation.tone}` : ''}${cue.critical ? ' is-critical' : ''}`}
      style={moveAnimationStyle(profile, plan, duration, duration)}
      aria-hidden="true"
    >
      <span className="pixel-impact-wash" />
      <span className="pixel-move-impact phase-impact">
        {plan.impactAssets.map((asset, assetIndex) => (
          <MoveFxAsset
            key={`${asset.src}-${assetIndex}`}
            asset={asset}
            frameOffset={assetIndex}
            role="impact"
            timelineEnd={0.72}
            style={{ '--impact-index': assetIndex }}
          />
        ))}
        <i className="pixel-impact-core" />
        <b className="pixel-impact-ring" />
        {Array.from({ length: hitCount }, (_, echoIndex) => (
          <em className="pixel-impact-echo" key={echoIndex} style={{ '--echo-index': echoIndex }} />
        ))}
      </span>
      <span className="director-impact-feedback">
        <strong>{damageLabel}</strong>
        <small>{cue.result === 'blocked' ? '공격을 막았다!' : feedbackLabel}</small>
      </span>
    </div>
  )
}

function MoveFxAsset({ asset, frameOffset = 0, role = 'effect', style, timelineStart = 0, timelineEnd = 1, playback = 'once' }) {
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
      className={`pixel-fx-asset fx-role-${role}${framed ? ' has-frames' : ''}`}
      style={assetStyle}
      data-fx-columns={framed ? columns : undefined}
      data-fx-rows={framed ? rows : undefined}
      data-fx-frame-count={framed ? frameCount : undefined}
      data-fx-frame-offset={framed ? frameOffset : undefined}
      data-fx-timeline-start={framed ? timelineStart : undefined}
      data-fx-timeline-end={framed ? timelineEnd : undefined}
      data-fx-playback={framed ? playback : undefined}
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

const TERA_TYPE_ICONS = {
  normal: Circle,
  fire: Flame,
  water: Droplets,
  electric: Zap,
  grass: Flower2,
  ice: Snowflake,
  fighting: Dumbbell,
  poison: Skull,
  ground: Earth,
  flying: Feather,
  psychic: Eye,
  bug: Bug,
  rock: Mountain,
  ghost: Ghost,
  dragon: Dna,
  dark: Moon,
  steel: Axe,
  fairy: Heart,
  stellar: Star,
}

const TERA_JEWEL_RAYS = Array.from({ length: 8 }, (_, index) => index)
const GIMMICK_SPARKS = Array.from({ length: 22 }, (_, index) => index)
const GIMMICK_CRYSTALS = Array.from({ length: 18 }, (_, index) => index)
const GIMMICK_SHARDS = Array.from({ length: 12 }, (_, index) => index)

function TeraTypeJewel({ type, mode = 'stage' }) {
  const typeToken = typeClassName(type ?? '노말')
  const TypeIcon = TERA_TYPE_ICONS[typeToken] ?? Gem

  return (
    <span className={`tera-type-jewel is-${mode} tera-jewel-${typeToken}`} aria-hidden="true">
      <span className="tera-jewel-aura" />
      <span className="tera-jewel-rays">
        {TERA_JEWEL_RAYS.map((index) => <i key={index} style={{ '--jewel-ray': index }} />)}
      </span>
      <span className="tera-jewel-crest">
        <span className="tera-jewel-prong prong-left" />
        <span className="tera-jewel-prong prong-right" />
        <span className="tera-jewel-emblem"><TypeIcon /></span>
        <span className="tera-jewel-facet facet-left" />
        <span className="tera-jewel-facet facet-right" />
      </span>
      <span className="tera-jewel-circlet"><i /><i /><i /></span>
    </span>
  )
}

const GIMMICK_PRESENTATION = {
  form: {
    eyebrow: 'BATTLE FORM SHIFT',
    title: '폼체인지',
  },
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
  if (cue.mechanicId === 'dynamax') return cue.mechanicMode === 'gigantamax' ? '거다이맥스' : '다이맥스'
  if (cue.mechanicId === 'zmove') return cue.chargedMoveName ?? 'Z-MOVE CHARGED'
  if (cue.mechanicId === 'form') {
    const transition = cue.actorPreviousName && cue.actorPreviousName !== cue.actorName
      ? `${cue.actorPreviousName}  →  ${cue.actorName}`
      : cue.actorName
    return cue.formSourceName ? `${transition} · ${cue.formSourceName}` : transition
  }
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
  const mechanicModeClass = cue.mechanicMode ? ` mode-${animationClassToken(cue.mechanicMode)}` : ''
  const duration = turnStepDuration(cue)

  return (
    <section
      className={`battle-gimmick-sequence mechanic-${cue.mechanicId} side-${cue.sideId}${mechanicTypeClass}${mechanicModeClass}`}
      style={{ '--gimmick-duration': `${duration}ms` }}
      role="img"
      aria-label={`${cue.actorName}의 ${presentation.title} 연출`}
    >
      <span className="battle-gimmick-screen-tint" />
      <span className="battle-gimmick-speedlines" />
      <span className="battle-gimmick-whiteout" />
      <span className="battle-gimmick-return-flash" />

      {cue.mechanicId === 'mega' && (
        <div className="gimmick-mega-layer" aria-hidden="true">
          <img className="gimmick-mega-background" src="/assets/move-fx/ebdx/ebMegaBg.png" alt="" />
          <span className="gimmick-mega-keystone">
            <span className="gimmick-mega-keystone-core"><b>M</b><i /><i /><i /><i /></span>
          </span>
          <span className="gimmick-mega-resonance-beam" />
          <span className="gimmick-mega-helix"><i /><i /><i /></span>
          <img className="gimmick-mega-sigil" src="/assets/move-fx/ebdx/ebMega006.png" alt="" />
          <img className="gimmick-mega-strike" src="/assets/move-fx/ebdx/ebMega005.png" alt="" />
          <span className="gimmick-mega-shards">
            {GIMMICK_SHARDS.map((index) => <i key={index} style={{ '--gimmick-shard': index }} />)}
          </span>
        </div>
      )}

      {cue.mechanicId === 'zmove' && (
        <div className="gimmick-z-layer" aria-hidden="true">
          <span className="gimmick-z-crystal"><b>Z</b><i /><i /><i /><i /></span>
          <span className="gimmick-z-pose"><i /><i /><i /></span>
          <span className="gimmick-z-emblem">Z</span>
          <span className="gimmick-z-prism"><i /><i /><i /><i /><i /><i /></span>
          <span className="gimmick-z-energy-line"><i /><i /><i /></span>
          <span className="gimmick-z-power-ring"><i /><i /><i /></span>
        </div>
      )}

      {cue.mechanicId === 'dynamax' && (
        <div className="gimmick-dynamax-layer" aria-hidden="true">
          <span className="gimmick-dynamax-band"><b>MAX</b><i /><i /><i /></span>
          <span className="gimmick-dynamax-ball"><i /><i /><b /></span>
          <span className="gimmick-dynamax-clouds"><i /><i /><i /></span>
          <span className="gimmick-dynamax-vortex"><i /><i /><i /></span>
          <span className="gimmick-dynamax-pillars"><i /><i /><i /><i /></span>
          <span className="gimmick-dynamax-crown-clouds"><i /><i /><i /></span>
        </div>
      )}

      {cue.mechanicId === 'tera' && (
        <div className="gimmick-tera-layer" aria-hidden="true">
          <span className="gimmick-tera-orb"><b><Sparkles /></b><i /><i /><i /></span>
          <span className="gimmick-tera-rainbow" />
          <span className="gimmick-tera-shell"><i /><i /><i /><i /><i /><i /></span>
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

      {cue.mechanicId === 'form' && (
        <div className="gimmick-form-layer" aria-hidden="true">
          <span className="gimmick-form-core" />
          <span className="gimmick-form-wave wave-one" />
          <span className="gimmick-form-wave wave-two" />
          <span className="gimmick-form-wave wave-three" />
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
        {cue.mechanicId === 'tera' && <TeraTypeJewel type={cue.mechanicType} mode="cinematic" />}
      </div>

      <div className="battle-gimmick-title-card">
        <small>{presentation.eyebrow}</small>
        <strong>{cue.mechanicId === 'dynamax' && cue.mechanicMode === 'gigantamax' ? '거다이맥스' : presentation.title}</strong>
        <span>{gimmickDetail(cue)}</span>
      </div>
    </section>
  )
}

const FIELD_PARTICLE_COUNTS = Object.freeze({
  neutral: 12,
  grassy: 20,
  electric: 18,
  psychic: 18,
  misty: 20,
})

const FIELD_DURATION_RANGES = Object.freeze({
  neutral: [3.8, 6.2],
  grassy: [5.2, 8.8],
  electric: [1.4, 3.1],
  psychic: [5.4, 9.4],
  misty: [5.8, 10.2],
})

function fieldParticleStyle(terrainId, index) {
  const [minimumDuration, maximumDuration] = FIELD_DURATION_RANGES[terrainId] ?? FIELD_DURATION_RANGES.neutral
  const terrainOffset = ['neutral', 'grassy', 'electric', 'psychic', 'misty'].indexOf(terrainId) * 13
  const horizontalPhase = ((index * 43) + 17 + terrainOffset) % 101
  const verticalPhase = 8 + (((index * 31) + terrainOffset) % 78)
  const timingPhase = (((index * 29) + 7 + terrainOffset) % 97) / 96
  const duration = minimumDuration + ((maximumDuration - minimumDuration) * timingPhase)
  const scale = 0.62 + ((((index * 19) + terrainOffset) % 47) / 46)
  const drift = (((index * 37) + terrainOffset) % 141) - 70
  const spin = ((index * 53) + terrainOffset) % 360

  return {
    '--field-x': `${horizontalPhase}%`,
    '--field-y': `${verticalPhase}%`,
    '--field-delay': `${-(duration * timingPhase).toFixed(2)}s`,
    '--field-duration': `${duration.toFixed(2)}s`,
    '--field-scale': scale.toFixed(2),
    '--field-drift': `${drift}px`,
    '--field-spin': `${spin}deg`,
  }
}

function BattleFieldEffects({ terrainId }) {
  const normalizedTerrainId = FIELD_PARTICLE_COUNTS[terrainId] ? terrainId : 'neutral'
  const particleCount = FIELD_PARTICLE_COUNTS[normalizedTerrainId]

  return (
    <div className={`battle-field-effects field-effect-${normalizedTerrainId}`} aria-hidden="true">
      <span className="battle-field-ambient field-ambient-far" />
      <span className="battle-field-ambient field-ambient-near" />
      <span className="battle-field-energy" />
      <span className="battle-field-particles">
        {[...Array(particleCount).keys()].map((index) => (
          <i key={index} style={fieldParticleStyle(normalizedTerrainId, index)} />
        ))}
      </span>
      <span className="battle-field-transition" />
    </div>
  )
}

const WEATHER_PARTICLE_COUNTS = Object.freeze({
  clear: { back: 9, front: 4 },
  deltastream: { back: 18, front: 20 },
  desolateland: { back: 18, front: 10 },
  primordialsea: { back: 36, front: 30 },
  sun: { back: 13, front: 7 },
  rain: { back: 28, front: 22 },
  sandstorm: { back: 21, front: 25 },
  snow: { back: 18, front: 24 },
  fog: { back: 7, front: 6 },
})

const WEATHER_DURATION_RANGES = Object.freeze({
  clear: [4.8, 7.4],
  deltastream: [1.2, 2.1],
  desolateland: [2.2, 4.2],
  primordialsea: [0.44, 0.76],
  sun: [2.8, 5.2],
  rain: [0.58, 0.94],
  sandstorm: [1.45, 2.5],
  snow: [4.1, 7.2],
  fog: [7.5, 12.5],
})

function weatherParticleStyle(weatherId, layer, index) {
  const [minimumDuration, maximumDuration] = WEATHER_DURATION_RANGES[weatherId] ?? WEATHER_DURATION_RANGES.clear
  const layerOffset = layer === 'front' ? 29 : 11
  const horizontalPhase = ((index * 37) + layerOffset) % 101
  const verticalPhase = ((index * 53) + (layerOffset * 2)) % 101
  const timingPhase = (((index * 23) + layerOffset) % 97) / 96
  const duration = minimumDuration + ((maximumDuration - minimumDuration) * timingPhase)
  const scale = (layer === 'front' ? 0.92 : 0.56) + ((((index * 17) + layerOffset) % 41) / 40)
  const opacity = (layer === 'front' ? 0.48 : 0.28) + ((((index * 31) + layerOffset) % 37) / 72)
  const drift = (((index * 19) + layerOffset) % 81) - 40
  const spin = ((index * 47) + layerOffset) % 360

  return {
    '--weather-x': `${horizontalPhase}%`,
    '--weather-y': `${verticalPhase}%`,
    '--weather-ground-y': `${2 + (verticalPhase * 0.18)}%`,
    '--weather-delay': `${-(duration * timingPhase).toFixed(2)}s`,
    '--weather-duration': `${duration.toFixed(2)}s`,
    '--weather-scale': scale.toFixed(2),
    '--weather-opacity': Math.min(opacity, 0.94).toFixed(2),
    '--weather-drift': `${drift}px`,
    '--weather-spin': `${spin}deg`,
  }
}

function BattleWeatherEffects({ weatherId, layer }) {
  const particleCount = WEATHER_PARTICLE_COUNTS[weatherId]?.[layer] ?? 0
  const isBackLayer = layer === 'back'

  return (
    <div className={`battle-weather-layer weather-layer-${layer} weather-effect-${weatherId}`} aria-hidden="true">
      {isBackLayer && (
        <>
          <span className="battle-weather-grade" />
          <span className="battle-weather-celestial" />
          <span className="battle-weather-cloud cloud-one" />
          <span className="battle-weather-cloud cloud-two" />
          <span className="battle-weather-gust gust-one" />
          <span className="battle-weather-gust gust-two" />
          <span className="battle-weather-loop" />
        </>
      )}
      <span className="battle-weather-particles">
        {[...Array(particleCount).keys()].map((index) => (
          <i key={index} style={weatherParticleStyle(weatherId, layer, index)} />
        ))}
      </span>
      {!isBackLayer && (
        <>
          <span className="battle-weather-ground">
            {[...Array(9).keys()].map((index) => (
              <i key={index} style={weatherParticleStyle(weatherId, layer, index + particleCount)} />
            ))}
          </span>
          <span className="battle-weather-transition" />
        </>
      )}
    </div>
  )
}

function BattleArenaEffects({ cue, animationMode = 'normal', showDamageNumbers = true }) {
  if (!cue) return null
  const presentation = cue.effectiveness == null
    ? null
    : effectivenessPresentation(cue.effectiveness)
  const attackAnimationsVisible = animationMode !== 'skip'
  const showMoveEffect = attackAnimationsVisible && cue.phase === 'attack' && cue.moveName
  const showImpact = attackAnimationsVisible && (cue.phase === 'impact' || (cue.phase === 'resolve' && cue.result === 'blocked'))
  const showSwitch = cue.phase === 'switch-out' || cue.phase === 'switch'
  const showFaint = cue.phase === 'faint'

  return (
    <>
      {(cue.phase === 'gimmick' || cue.phase === 'form') && (
        <GimmickAnimation cue={cue} key={`gimmick-${cue.id}`} />
      )}

      {showMoveEffect && (
        <>
          <MoveSceneAnimation cue={cue} animationMode={animationMode} key={`scene-${cue.id}`} />
          <MoveAnimation cue={cue} animationMode={animationMode} key={`move-${cue.id}`} />
        </>
      )}

      {showImpact && cue.result !== 'miss' && (
        <MoveImpactAnimation
          cue={cue}
          presentation={presentation}
          animationMode={animationMode}
          showDamageNumbers={showDamageNumbers}
          key={`impact-${cue.id}`}
        />
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
        <div className={`battle-faint-effect target-${cue.targetSideId} slot-${cue.targetSlot ?? 0}`} key={`faint-${cue.id}`} aria-hidden="true">
          <span /><i /><i /><i /><b />
        </div>
      )}
    </>
  )
}

function battleStageClassName(sideId, pokemon, cue, activeSlot = 0) {
  const classes = ['battle-pokemon-stage', sideId, `slot-${activeSlot}`]
  if (pokemon.dynamaxActive) classes.push('is-dynamax')
  if (pokemon.teraActive) classes.push('is-terastal', `tera-${typeClassName(pokemon.teraType)}`)
  if (pokemon.fainted) classes.push('is-fainted')
  if (!cue) return classes.join(' ')

  const isActor = cue.sideId === sideId && (cue.actorSlot == null || cue.actorSlot === activeSlot)
  const isTarget = cue.targetSideId === sideId && (cue.targetSlot == null || cue.targetSlot === activeSlot)
  if (isActor && cue.phase === 'attack') {
    const profile = getMoveAnimationProfile(cue)
    classes.push(
      'is-attacking',
      `attack-${cue.moveCategory ?? 'special'}`,
      `move-motion-${profile.motion}`,
      `move-archetype-${profile.archetype}`,
    )
  }
  if (isActor && (cue.phase === 'gimmick' || cue.phase === 'form')) {
    classes.push('is-gimmicking', `gimmick-${cue.mechanicId}`)
  }
  if (isActor && cue.phase === 'switch-out') classes.push('is-switching-out')
  if (isActor && cue.phase === 'switch') classes.push('is-switching-in')
  if (isTarget && cue.phase === 'attack' && cue.sideId !== sideId) classes.push('is-anticipating-hit')
  if (isTarget && cue.phase === 'impact') classes.push('is-hit')
  if (isTarget && cue.phase === 'resolve' && cue.result !== 'miss') classes.push('is-guarding')
  if (isTarget && cue.phase === 'status') classes.push('is-status-pulse')
  if (isTarget && cue.phase === 'residual') classes.push('is-residual-hit')
  if (isTarget && cue.phase === 'faint') classes.push('is-fainting')
  return classes.join(' ')
}

function battleCameraClassName(cue) {
  const classes = ['battle-field-camera']
  if (!cue) return classes.join(' ')
  classes.push(`phase-${cue.phase}`)
  if (cue.sideId) classes.push(`actor-${cue.sideId}`)
  if (cue.targetSideId) classes.push(`target-${cue.targetSideId}`)
  if ((cue.phase === 'gimmick' || cue.phase === 'form') && cue.mechanicId) classes.push(`gimmick-${cue.mechanicId}`)
  return classes.join(' ')
}

function battleStageStyle(cue, animationMode = 'normal') {
  if (cue?.phase === 'attack') return { '--move-duration': `${turnStepDuration(cue, animationMode)}ms` }
  if (cue?.phase === 'impact') return { '--impact-duration': `${turnStepDuration(cue, animationMode)}ms` }
  if (cue?.phase === 'gimmick' || cue?.phase === 'form') {
    return { '--gimmick-duration': `${turnStepDuration(cue)}ms` }
  }
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

function statusAnchorClassName(sideId, pokemon, cue, activeSlot = 0) {
  const classes = ['battle-status-anchor', `${sideId}-status-anchor`, `slot-${activeSlot}`]
  if (pokemon.fainted) classes.push('is-fainted')
  if (!cue) return classes.join(' ')
  const isActor = cue.sideId === sideId && (cue.actorSlot == null || cue.actorSlot === activeSlot)
  const isTarget = cue.targetSideId === sideId && (cue.targetSlot == null || cue.targetSlot === activeSlot)
  if (isActor) classes.push('is-acting')
  if (isTarget) classes.push('is-targeted')
  if (isTarget && cue.phase === 'impact') classes.push('is-taking-damage')
  if (isTarget && cue.phase === 'faint') classes.push('is-fainting')
  return classes.join(' ')
}

function cueTone(cue) {
  if (!cue) return 'neutral'
  if (cue.phase === 'faint' || cue.phase === 'impact') return cue.targetSideId === 'player' ? 'opponent' : 'player'
  if (cue.phase === 'gimmick' || cue.phase === 'form') return 'gimmick'
  return cue.sideId ?? 'neutral'
}

function BattleRuleBadge({ id, category, label, description }) {
  const tooltipId = `battle-rule-${id}-tooltip`
  return (
    <span className={`battle-rule-badge rule-${id}`} tabIndex={0} aria-describedby={tooltipId}>
      <span className="battle-rule-badge-category">{category}</span>
      <strong>{label}</strong>
      <span className="battle-rule-tooltip" id={tooltipId} role="tooltip">
        <small>{category}</small>
        <strong>{label}</strong>
        <span>{description}</span>
      </span>
    </span>
  )
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

function PokemonPartyMenu({ battle, forced, activeSlot = 0, onSelect, onBack, onPreview }) {
  const activeIndexes = battle.player.activeIndexes ?? [battle.player.activeIndex]
  const activeIndex = activeIndexes[activeSlot] ?? battle.player.activeIndex

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
          const isActive = activeIndexes.includes(index)
          const isSelectedSlot = index === activeIndex
          const isDisabled = pokemon.fainted || pokemon.hp <= 0 || isActive
          return (
            <button
              className={`${isActive ? 'active' : ''}${isSelectedSlot ? ' selected-slot' : ''}${pokemon.fainted ? ' fainted' : ''}`}
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
                <small>{pokemon.fainted ? '기절' : isSelectedSlot ? '교대 대상' : isActive ? '배틀 중' : pokemon.status?.label ?? '정상'}</small>
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

function MoveMenu({
  battle,
  activeSlot = 0,
  targetSlot = 0,
  pendingGimmick,
  reservedMechanicIds,
  onActiveSlot,
  onGimmick,
  onMove,
  onOpenParty,
  onBack,
  onPreview,
}) {
  const [activeTooltipIndex, setActiveTooltipIndex] = useState(null)
  const pokemon = getActivePokemon(battle, 'player', activeSlot)
  const opponent = getActivePokemon(battle, 'opponent', targetSlot)
  const playerActive = getActivePokemonList(battle, 'player')
  const mechanics = getAvailableBattleMechanics(battle, 'player', activeSlot)
    .filter((mechanic) => !reservedMechanicIds?.has(mechanic.id))

  return (
    <section className="battle-move-menu">
      <header>
        <button type="button" onPointerEnter={onPreview} onClick={onBack}><ChevronLeft size={17} /> 행동 선택</button>
        <button className="battle-slot-switch-button" type="button" onPointerEnter={onPreview} onClick={onOpenParty}>
          <ArrowLeftRight size={14} /> 교대
        </button>
        {battle.rules?.format?.rotation && (
          <div className="battle-rotation-selector" aria-label="행동할 포켓몬">
            {playerActive.map((entry, slot) => (
              <button
                className={activeSlot === slot ? 'selected' : ''}
                type="button"
                disabled={entry.fainted || entry.hp <= 0}
                key={entry.battleId}
                onClick={() => onActiveSlot(slot)}
              >{entry.name}</button>
            ))}
          </div>
        )}
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
          const displayMove = getBattleMovePreview(
            battle,
            'player',
            moveIndex,
            activeSlot,
            targetSlot,
            pendingGimmick,
          ) ?? move
          const multiplier = moveDealsDirectDamage(displayMove)
            ? getBattleTypeEffectiveness(battle, displayMove.type, opponent.types)
            : null
          const presentation = effectivenessPresentation(multiplier)
          const tooltipId = `battle-move-tooltip-${pokemon.battleId}-${moveIndex}`
          const isTooltipVisible = activeTooltipIndex === moveIndex
          const isZMoveLocked = pendingGimmick === 'zmove' && displayMove.zMoveCompatible === false

          return (
            <div
              className={`battle-move-option effectiveness-${presentation.tone}${isTooltipVisible ? ' tooltip-open' : ''}${isZMoveLocked ? ' z-incompatible' : ''}`}
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
                className={`battle-move-button type-${typeClassName(displayMove.type)} effectiveness-${presentation.tone}`}
                type="button"
                disabled={move.currentPp <= 0 || isZMoveLocked}
                aria-describedby={tooltipId}
                aria-label={isZMoveLocked ? `${move.name}: 현재 Z크리스탈과 호환되지 않음` : undefined}
                onFocus={() => setActiveTooltipIndex(moveIndex)}
                onBlur={() => setActiveTooltipIndex((currentIndex) => (
                  currentIndex === moveIndex ? null : currentIndex
                ))}
                onClick={() => onMove(moveIndex)}
              >
                <span className="battle-move-type">{displayMove.type}</span>
                <span className="battle-move-name">
                  <strong>{displayMove.name}</strong>
                  <small>{displayMove.category}</small>
                </span>
                <span className="battle-move-pp">
                  <small>PP</small>
                  <strong>{move.currentPp}/{move.maxPp}</strong>
                </span>
                <span className="battle-move-power">
                  <small>위력</small>
                  <strong>{displayMove.power || '—'}</strong>
                </span>
                <span className={`battle-move-effectiveness effectiveness-${presentation.tone}`}>
                  <small>상성</small>
                  <strong>{presentation.value}</strong>
                </span>
              </button>
              <BattleMoveTooltip
                id={tooltipId}
                move={displayMove}
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

function MoveTargetMenu({
  battle,
  activeSlot = 0,
  moveIndex = 0,
  pendingGimmick,
  onSelect,
  onBack,
  onPreview,
}) {
  const pokemon = getActivePokemon(battle, 'player', activeSlot)
  const move = pokemon?.moves?.[moveIndex]
  const targets = getActivePokemonList(battle, 'opponent')
    .map((target, slot) => ({ target, slot }))
    .filter(({ target }) => target.hp > 0 && !target.fainted)
  const selectedMechanic = getAvailableBattleMechanics(battle, 'player', activeSlot)
    .find((mechanic) => mechanic.id === pendingGimmick)
  const displayMove = getBattleMovePreview(
    battle,
    'player',
    moveIndex,
    activeSlot,
    targets[0]?.slot ?? 0,
    pendingGimmick,
  ) ?? move

  if (!pokemon || !move) return null

  return (
    <section className="battle-target-menu">
      <header>
        <button type="button" onPointerEnter={onPreview} onClick={onBack}>
          <ChevronLeft size={17} /> 기술 선택
        </button>
        <div className="battle-target-title">
          <small>SELECT TARGET</small>
          <strong>공격 대상 선택</strong>
        </div>
        <div className="battle-target-move-summary">
          <span className={`type-${typeClassName(displayMove.type)}`}>{displayMove.type}</span>
          <strong>{displayMove.name}</strong>
          {selectedMechanic && <em>{selectedMechanic.shortLabel}</em>}
        </div>
      </header>
      <div
        className="battle-target-grid"
        style={{ '--battle-target-columns': Math.max(1, targets.length) }}
      >
        {targets.map(({ target, slot }) => {
          const targetMove = getBattleMovePreview(
            battle,
            'player',
            moveIndex,
            activeSlot,
            slot,
            pendingGimmick,
          ) ?? move
          const multiplier = moveDealsDirectDamage(targetMove)
            ? getBattleTypeEffectiveness(battle, targetMove.type, target.types)
            : null
          const presentation = effectivenessPresentation(multiplier)

          return (
            <button
              className={`battle-target-card effectiveness-${presentation.tone}`}
              type="button"
              aria-label={`${target.name}을 공격 대상으로 선택`}
              key={target.battleId}
              onPointerEnter={onPreview}
              onClick={() => onSelect(slot)}
            >
              <span className="battle-target-number">TARGET {String(slot + 1).padStart(2, '0')}</span>
              <span className="battle-target-icon">
                <img
                  src={target.icon}
                  alt=""
                  draggable="false"
                  onError={fallbackImageHandler(target.iconFallback)}
                />
              </span>
              <span className="battle-target-info">
                <strong>{target.name}</strong>
                <small>Lv.50 · {target.types.join(' / ')}</small>
                <span className={`battle-target-hp tone-${hpTone(target)}`}>
                  <i style={{ width: `${hpRatio(target)}%` }} />
                </span>
                <em>HP {Math.round(hpRatio(target))}%</em>
              </span>
              <span className={`battle-target-effectiveness effectiveness-${presentation.tone}`}>
                <small>상성</small>
                <strong>{presentation.value}</strong>
                <em>{presentation.label}</em>
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}

function BattleOverviewMenu({ battle, onBack, onPreview }) {
  const sides = [
    { id: 'player', label: '아군', side: battle.player },
    { id: 'opponent', label: '상대', side: battle.opponent },
  ].map((entry) => ({
    ...entry,
    fieldPokemon: (entry.side.activeIndexes ?? [entry.side.activeIndex])
      .map((teamIndex, fieldSlot) => ({ pokemon: entry.side.team[teamIndex], fieldSlot }))
      .filter(({ pokemon }) => pokemon && !pokemon.fainted && pokemon.hp > 0),
  }))
  const overviewColumns = Math.max(1, ...sides.map(({ fieldPokemon }) => fieldPokemon.length))

  return (
    <section className="battle-overview-menu">
      <header>
        <button type="button" onPointerEnter={onPreview} onClick={onBack}><ChevronLeft size={17} /> 행동 선택</button>
        <span>TURN {Math.max(1, battle.turn)} · 배틀 현황</span>
      </header>
      <div
        className={`battle-overview-grid${overviewColumns === 1 ? ' is-single' : ''}`}
        style={{ '--overview-columns': overviewColumns }}
      >
        {sides.map(({ id, label, side, fieldPokemon }) => (
          <div className={`battle-overview-side side-${id}`} role="list" aria-label={`${label} 출전 포켓몬`} key={id}>
            {fieldPokemon.map(({ pokemon, fieldSlot }) => {
              const hpPercent = Math.ceil(hpRatio(pokemon))
              const statStages = battleStatStageEntries(pokemon)
              const isRotationLead = battle.rules.format.rotation && fieldSlot === (side.rotationSlot ?? 0)

              return (
                <article className={isRotationLead ? 'is-rotation-lead' : ''} role="listitem" key={pokemon.battleId}>
                  <div className="battle-overview-heading">
                    <strong>{pokemon.name}</strong>
                    {isRotationLead && <em>ACTIVE</em>}
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
            {fieldPokemon.length === 0 && <span className="battle-overview-empty">교체 대기</span>}
          </div>
        ))}
      </div>
    </section>
  )
}

function BattleIntro({ opponent, opponentTeam, playerTeam, playerGender, rules, effectsReady, onStart, onPreview }) {
  return (
    <section className={`battle-intro-overlay${effectsReady ? ' is-ready' : ' is-loading'}`}>
      <div className="battle-intro-streaks" />
      <div className="battle-intro-light battle-intro-light-player" />
      <div className="battle-intro-light battle-intro-light-opponent" />
      <article className="battle-intro-trainer player">
        <TrainerSprite isPlayer playerGender={playerGender} className="battle-intro-trainer-sprite" />
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
        <small>{rules.teamRule.shortLabel} · {rules.format.label}</small>
        <span>{rules.weather.label} · {rules.terrain.label}</span>
        <em>{rules.gimmickRestriction.label} · AI {getAiBattleDifficultyLabel(rules.aiDifficulty)}</em>
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
  rules,
  soundEnabled = true,
  gameSettings = {},
  playerGender = 'male',
  audioSettings = {},
  onToggleSound,
  onOpenSettings,
  onComplete,
}) {
  const [battle, setBattle] = useState(() => createBattle({ playerPokemon, opponent, opponentTeam, rules }))
  const [introVisible, setIntroVisible] = useState(true)
  const [menu, setMenu] = useState('command')
  const [pendingGimmick, setPendingGimmick] = useState(null)
  const [queuedActions, setQueuedActions] = useState([])
  const [commandSlot, setCommandSlot] = useState(0)
  const [targetSlot, setTargetSlot] = useState(0)
  const [pendingMoveIndex, setPendingMoveIndex] = useState(null)
  const [turnCue, setTurnCue] = useState(null)
  const [isTurnAnimating, setIsTurnAnimating] = useState(false)
  const [moveAssetsReady, setMoveAssetsReady] = useState(false)
  const [hoveredPokemonSide, setHoveredPokemonSide] = useState(null)
  const [focusedPokemonSide, setFocusedPokemonSide] = useState(null)
  const [pinnedPokemonSide, setPinnedPokemonSide] = useState(null)
  const logRef = useRef(null)
  const playbackTimerRef = useRef(null)
  const playbackTokenRef = useRef(0)
  const turnLockedRef = useRef(false)
  const battleAudioRef = useRef(null)
  if (!battleAudioRef.current) battleAudioRef.current = createBattleAudio(soundEnabled, audioSettings)
  const playerActive = getActivePokemon(battle, 'player')
  const opponentActive = getActivePokemon(battle, 'opponent')
  const playerActivePokemon = getActivePokemonList(battle, 'player')
  const opponentActivePokemon = getActivePokemonList(battle, 'opponent')
  const inspectedPokemonSide = hoveredPokemonSide ?? focusedPokemonSide ?? pinnedPokemonSide
  const summary = useMemo(() => getBattleSummary(battle), [battle])
  const currentLogEntry = battle.log.at(-1)
  const currentBattleMessage = turnCue?.message ?? currentLogEntry?.message ?? '배틀을 준비하고 있습니다.'
  const currentBattleTone = turnCue ? cueTone(turnCue) : currentLogEntry?.tone ?? 'neutral'
  const battleLogHistory = battle.log
    .filter((entry) => entry.id !== currentLogEntry?.id || turnCue)
    .slice(-12)
  const commandLocked = isTurnAnimating || Boolean(battle.winner)
  const attackAnimationMode = gameSettings.attackAnimation ?? 'normal'
  const showDamageNumbers = gameSettings.showDamageNumbers !== false
  const hpBarDuration = HP_BAR_DURATIONS[gameSettings.hpBarSpeed] ?? HP_BAR_DURATIONS.normal
  const visualTurnCue = attackAnimationMode === 'skip' && ATTACK_ANIMATION_PHASES.has(turnCue?.phase)
    ? null
    : turnCue

  useEffect(() => {
    let active = true
    let idleHandle = null
    const battleRoster = [...battle.player.team, ...battle.opponent.team]
    battleAudioRef.current?.preload(battleRoster)
    const activePokemon = [
      ...getActivePokemonList(battle, 'player'),
      ...getActivePokemonList(battle, 'opponent'),
    ]
    const criticalAssets = activePokemon.flatMap((pokemon) => [
      ...getBattleSpriteAssets(pokemon),
      ...pokemon.moves.flatMap(getMoveAnimationAssets),
    ])
    const allAssets = battleRoster.flatMap((pokemon) => [
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
    battleAudioRef.current?.setMix(audioSettings)
  }, [audioSettings])

  useEffect(() => {
    setHoveredPokemonSide(null)
    setFocusedPokemonSide(null)
    setPinnedPokemonSide(null)
  }, [playerActive.battleId, opponentActive.battleId])

  useEffect(() => {
    battleAudioRef.current?.setLowHpWarning(
      !introVisible && !battle.winner && playerActive.hp > 0 && hpRatio(playerActive) <= 20,
    )
  }, [battle.winner, introVisible, playerActive.hp, playerActive.maxHp])

  useEffect(() => {
    const skipAttackCue = attackAnimationMode === 'skip' && ATTACK_ANIMATION_PHASES.has(turnCue?.phase)
    if (!introVisible && turnCue && !skipAttackCue) battleAudioRef.current?.playCue(turnCue)
  }, [attackAnimationMode, introVisible, turnCue])

  const startAnimatedTurn = (playerAction) => {
    if (turnLockedRef.current || battle.winner || battle.awaitingPlayerSwitch) return
    turnLockedRef.current = true
    const playbackToken = playbackTokenRef.current + 1
    playbackTokenRef.current = playbackToken
    const resolution = createBattleTurnTimeline(battle, playerAction)
    const steps = resolution.timeline

    setMenu('command')
    setQueuedActions([])
    setPendingMoveIndex(null)
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
      playbackTimerRef.current = setTimeout(
        () => playStep(stepIndex + 1),
        turnPlaybackDelay(steps, stepIndex, attackAnimationMode),
      )
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

  const forcedPlayerAction = getForcedBattleAction(battle, 'player')
  const forcedReason = forcedPlayerAction?.forcedReason ?? null
  const forcedMoveIndex = forcedPlayerAction?.moveIndex ?? null

  useEffect(() => {
    if (
      introVisible
      || isTurnAnimating
      || battle.winner
      || battle.awaitingPlayerSwitch
      || (battle.rules?.format?.actionSlots ?? 1) > 1
      || !forcedReason
    ) return undefined

    const timerId = window.setTimeout(() => {
      startAnimatedTurn({
        type: 'move',
        moveIndex: forcedMoveIndex ?? 0,
        gimmick: null,
        forcedReason,
      })
    }, 320)
    return () => window.clearTimeout(timerId)
  }, [
    battle.awaitingPlayerSwitch,
    battle.turn,
    battle.winner,
    forcedMoveIndex,
    forcedReason,
    introVisible,
    isTurnAnimating,
  ])

  const livingPlayerActionSlots = playerActivePokemon
    .map((pokemon, slot) => (pokemon.hp > 0 && !pokemon.fainted ? slot : -1))
    .filter((slot) => slot >= 0)
  const livingOpponentTargetSlots = opponentActivePokemon
    .map((pokemon, slot) => (pokemon.hp > 0 && !pokemon.fainted ? slot : -1))
    .filter((slot) => slot >= 0)
  const reservedMechanicIds = useMemo(() => new Set(
    queuedActions
      .filter((action) => action.actorSlot !== commandSlot && action.gimmick)
      .map((action) => action.gimmick),
  ), [commandSlot, queuedActions])

  const submitPlayerAction = (action) => {
    if (action.gimmick && reservedMechanicIds.has(action.gimmick)) {
      battleAudioRef.current?.playMenu('cancel')
      setPendingGimmick(null)
      return
    }

    const nextAction = {
      ...action,
      actorSlot: commandSlot,
      targetSlot: action.targetSlot ?? targetSlot,
    }
    if (battle.rules?.format?.rotation || livingPlayerActionSlots.length <= 1) {
      startAnimatedTurn(nextAction)
      return
    }

    const nextActions = [...queuedActions.filter((queued) => queued.actorSlot !== commandSlot), nextAction]
    const nextSlot = livingPlayerActionSlots.find((slot) => !nextActions.some((queued) => queued.actorSlot === slot))
    if (nextSlot == null) {
      startAnimatedTurn(nextActions)
      return
    }

    setQueuedActions(nextActions)
    setCommandSlot(nextSlot)
    setTargetSlot(livingOpponentTargetSlots[0] ?? 0)
    setPendingGimmick(null)
    setPendingMoveIndex(null)
    setMenu('fight')
  }

  const chooseMove = (moveIndex) => {
    battleAudioRef.current?.playMenu('select')
    const pokemon = getActivePokemon(battle, 'player', commandSlot)
    const move = getBattleMovePreview(
      battle,
      'player',
      moveIndex,
      commandSlot,
      targetSlot,
      pendingGimmick,
    ) ?? pokemon?.moves?.[moveIndex]
    if (pendingGimmick === 'zmove' && move?.zMoveCompatible === false) return
    if (needsOpponentTargetSelection(move, livingOpponentTargetSlots.length)) {
      setPendingMoveIndex(moveIndex)
      setTargetSlot((currentSlot) => (
        livingOpponentTargetSlots.includes(currentSlot)
          ? currentSlot
          : livingOpponentTargetSlots[0] ?? 0
      ))
      setMenu('target')
      return
    }

    submitPlayerAction({
      type: 'move',
      moveIndex,
      gimmick: pendingGimmick,
    })
    setPendingMoveIndex(null)
    setPendingGimmick(null)
  }

  const chooseMoveTarget = (selectedTargetSlot) => {
    if (pendingMoveIndex == null || !livingOpponentTargetSlots.includes(selectedTargetSlot)) return
    battleAudioRef.current?.playMenu('select')
    setTargetSlot(selectedTargetSlot)
    submitPlayerAction({
      type: 'move',
      moveIndex: pendingMoveIndex,
      gimmick: pendingGimmick,
      targetSlot: selectedTargetSlot,
    })
    setPendingMoveIndex(null)
    setPendingGimmick(null)
  }

  const chooseSwitch = (targetIndex) => {
    if (turnLockedRef.current) return
    battleAudioRef.current?.playMenu('select')
    if (battle.awaitingPlayerSwitch) {
      const activeSlot = battle.awaitingPlayerSwitchSlots?.[0] ?? 0
      const nextBattle = forcePlayerSwitch(battle, targetIndex)
      if (nextBattle === battle) return
      const target = nextBattle.player.team[targetIndex]
      const forcedSwitchCue = {
        id: `${battle.turn}-forced-switch-${target.battleId}`,
        phase: 'switch',
        sideId: 'player',
        targetSideId: 'player',
        actorSlot: activeSlot,
        targetSlot: activeSlot,
        actorName: target.name,
        actorSpeciesId: target.speciesId,
        actorOriginalSpeciesId: target.originalSpeciesId,
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
      }, turnStepDuration(forcedSwitchCue, attackAnimationMode))
    } else {
      submitPlayerAction({ type: 'switch', targetIndex })
    }
    setPendingMoveIndex(null)
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
    const firstLivingSlot = livingPlayerActionSlots[0] ?? 0
    setQueuedActions([])
    setCommandSlot(battle.rules?.format?.rotation ? battle.player.rotationSlot ?? firstLivingSlot : firstLivingSlot)
    setTargetSlot(livingOpponentTargetSlots[0] ?? 0)
    setPendingMoveIndex(null)
    setMenu(nextMenu)
  }

  const returnToCommandMenu = () => {
    battleAudioRef.current?.playMenu('cancel')
    setPendingGimmick(null)
    setQueuedActions([])
    setPendingMoveIndex(null)
    setMenu('command')
  }

  const returnToMoveMenu = () => {
    battleAudioRef.current?.playMenu('cancel')
    setPendingMoveIndex(null)
    setMenu('fight')
  }

  const selectRotationCommandSlot = (nextSlot) => {
    if (!battle.rules?.format?.rotation || nextSlot === commandSlot) return
    const nextPokemon = getActivePokemon(battle, 'player', nextSlot)
    if (!nextPokemon || nextPokemon.fainted || nextPokemon.hp <= 0) return

    battleAudioRef.current?.playMenu('select')
    setPendingGimmick(null)
    setPendingMoveIndex(null)
    setCommandSlot(nextSlot)
  }

  const openPartyForCurrentSlot = () => {
    battleAudioRef.current?.playMenu('select')
    setPendingGimmick(null)
    setPendingMoveIndex(null)
    setMenu('party')
  }

  const previewBattleMenu = () => {
    battleAudioRef.current?.playMenu('cursor')
  }

  const pokemonInspectorProps = (side, pokemon) => ({
    tabIndex: 0,
    role: 'button',
    'aria-label': `${pokemon.name} 현재 상태 보기`,
    'aria-describedby': `${side}-pokemon-status-tooltip`,
    'aria-expanded': inspectedPokemonSide === side,
    onPointerEnter: (event) => {
      if (event.pointerType === 'mouse') setHoveredPokemonSide(side)
    },
    onPointerLeave: (event) => {
      if (event.pointerType === 'mouse') {
        setHoveredPokemonSide((currentSide) => (currentSide === side ? null : currentSide))
      }
    },
    onPointerDown: (event) => {
      if (event.pointerType === 'mouse') return
      event.stopPropagation()
      setPinnedPokemonSide((currentSide) => (currentSide === side ? null : side))
    },
    onFocus: (event) => {
      if (event.currentTarget.matches(':focus-visible')) setFocusedPokemonSide(side)
    },
    onBlur: () => {
      setFocusedPokemonSide((currentSide) => (currentSide === side ? null : currentSide))
    },
    onKeyDown: (event) => {
      if (event.key === 'Escape') {
        setFocusedPokemonSide(null)
        setPinnedPokemonSide(null)
        event.currentTarget.blur()
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        setPinnedPokemonSide((currentSide) => (currentSide === side ? null : side))
      }
    },
  })
  const weatherTurns = battle.environment?.weatherTurns
  const terrainTurns = battle.environment?.terrainTurns
  const baseWeatherLabel = battle.environment?.baseWeather?.label ?? battle.rules.weather.label
  const baseTerrainLabel = battle.environment?.baseTerrain?.label ?? battle.rules.terrain.label
  const weatherDescription = `${getBattleRuleDescription('weather', battle.rules.weather)} ${Number.isFinite(weatherTurns)
    ? `현재 임시 날씨이며 ${weatherTurns}턴 뒤 기본 날씨인 ${baseWeatherLabel} 상태로 돌아갑니다.`
    : `이 대전의 기본 날씨는 ${baseWeatherLabel}입니다.`}`
  const terrainDescription = `${getBattleRuleDescription('terrain', battle.rules.terrain)} ${Number.isFinite(terrainTurns)
    ? `현재 임시 필드이며 ${terrainTurns}턴 뒤 기본 필드인 ${baseTerrainLabel} 상태로 돌아갑니다.`
    : `이 대전의 기본 필드는 ${baseTerrainLabel}입니다.`}`

  return (
    <main
      className={`battle-game-screen cue-${visualTurnCue?.phase ?? 'command'} actor-${visualTurnCue?.sideId ?? 'none'} target-${visualTurnCue?.targetSideId ?? 'none'} format-${battle.rules.format.id} weather-${battle.rules.weather.id} terrain-${battle.rules.terrain.id}`}
      style={{ '--battle-hp-duration': `${hpBarDuration}ms` }}
    >
      <header className="battle-game-header">
        <div className="battle-title-lockup">
          <span><Swords size={14} /> TRAINER BATTLE</span>
          <strong>{competitionLabel}</strong>
        </div>
        <div className="battle-game-turn">
          <small>TURN</small>
          <strong>{Math.max(1, battle.turn)}</strong>
        </div>
        <div className="battle-header-cluster">
          <div className="battle-rule-hud" aria-label="현재 배틀 규칙">
            <BattleRuleBadge
              id="weather"
              category="날씨"
              label={`${battle.rules.weather.label}${Number.isFinite(weatherTurns) ? ` · ${weatherTurns}T` : ''}`}
              description={weatherDescription}
            />
            <BattleRuleBadge
              id="terrain"
              category="필드"
              label={`${battle.rules.terrain.label}${Number.isFinite(terrainTurns) ? ` · ${terrainTurns}T` : ''}`}
              description={terrainDescription}
            />
            <BattleRuleBadge
              id="format"
              category="배틀"
              label={battle.rules.format.label}
              description={getBattleRuleDescription('format', battle.rules.format)}
            />
            <BattleRuleBadge
              id="gimmick"
              category="기믹"
              label={battle.rules.gimmickRestriction.label}
              description={getBattleRuleDescription('gimmick', battle.rules.gimmickRestriction)}
            />
            <BattleRuleBadge
              id="difficulty"
              category="AI"
              label={getAiBattleDifficultyLabel(battle.rules.aiDifficulty)}
              description={getBattleRuleDescription('difficulty', battle.rules.aiDifficulty)}
            />
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
            <button
              type="button"
              aria-label="환경 설정"
              onClick={() => {
                battleAudioRef.current?.playMenu('select')
                onOpenSettings?.()
              }}
            >
              <Settings size={17} />
            </button>
          </div>
        </div>
      </header>

      <section
        className={`battle-arena phase-${visualTurnCue?.phase ?? 'command'} format-${battle.rules.format.id} weather-${battle.rules.weather.id} terrain-${battle.rules.terrain.id}`}
        onPointerDown={(event) => {
          if (event.pointerType !== 'mouse') setPinnedPokemonSide(null)
        }}
      >
        {opponentActivePokemon.map((pokemon, slot) => (
          <div className={statusAnchorClassName('opponent', pokemon, visualTurnCue, slot)} key={`opponent-status-${pokemon.battleId}`}>
            <BattleStatusPanel pokemon={pokemon} side="opponent" trainerName={opponent.name} />
            {slot === 0 && <PartyIndicators side={battle.opponent} />}
          </div>
        ))}
        {playerActivePokemon.map((pokemon, slot) => (
          <div className={statusAnchorClassName('player', pokemon, visualTurnCue, slot)} key={`player-status-${pokemon.battleId}`}>
            <BattleStatusPanel pokemon={pokemon} side="player" trainerName="PLAYER_01" />
            {slot === 0 && <PartyIndicators side={battle.player} />}
          </div>
        ))}

        {opponentActivePokemon.map((pokemon, slot) => (
          <BattlePokemonStatusTooltip
            id={`opponent-${slot}-pokemon-status-tooltip`}
            key={`opponent-tooltip-${pokemon.battleId}`}
            pokemon={pokemon}
            side="opponent"
            trainerName={opponent.name}
            visible={!introVisible && inspectedPokemonSide === `opponent-${slot}`}
          />
        ))}
        {playerActivePokemon.map((pokemon, slot) => (
          <BattlePokemonStatusTooltip
            id={`player-${slot}-pokemon-status-tooltip`}
            key={`player-tooltip-${pokemon.battleId}`}
            pokemon={pokemon}
            side="player"
            trainerName="PLAYER_01"
            visible={!introVisible && inspectedPokemonSide === `player-${slot}`}
          />
        ))}

        <div className={battleCameraClassName(visualTurnCue)} style={battleStageStyle(visualTurnCue, attackAnimationMode)}>
          <div className="battle-environment-backdrop" />
          <BattleFieldEffects
            key={`terrain-${battle.rules.terrain.id}`}
            terrainId={battle.rules.terrain.id}
          />
          <div className="battle-terrain-aura" />
          <BattleWeatherEffects
            key={`weather-back-${battle.rules.weather.id}`}
            weatherId={battle.rules.weather.id}
            layer="back"
          />
          <div className="battle-field-horizon" />
          <div className="battle-field-light battle-field-light-player" />
          <div className="battle-field-light battle-field-light-opponent" />
          <div className="battle-cinematic-flash" />
          <div className="battle-arena-scanlines" />
          <div className="battle-platform opponent-platform" />
          <div className="battle-platform player-platform" />

          {opponentActivePokemon.map((pokemon, slot) => (
            <div
              className={`${battleStageClassName('opponent', pokemon, visualTurnCue, slot)}${battle.rules.format.rotation ? (battle.opponent.rotationSlot === slot ? ' is-rotation-active' : ' is-rotation-reserve') : ''}`}
              key={`opponent-stage-${pokemon.battleId}`}
              style={battleStageStyle(visualTurnCue, attackAnimationMode)}
              {...pokemonInspectorProps(`opponent-${slot}`, pokemon)}
            >
              <span className="battle-pokemon-shadow" aria-hidden="true" />
              <PokemonSprite
                animatedSrc={pokemon.spriteFront}
                fallbackSrc={pokemon.spriteFrontFallback}
                frameClassName="battle-live-sprite-frame opponent-sprite-frame"
                className="battle-live-sprite"
                decodingMode="async"
                alt={pokemon.name}
              />
              {pokemon.teraActive && <TeraTypeJewel type={pokemon.teraType} />}
            </div>
          ))}

          {playerActivePokemon.map((pokemon, slot) => (
            <div
              className={`${battleStageClassName('player', pokemon, visualTurnCue, slot)}${battle.rules.format.rotation ? (battle.player.rotationSlot === slot ? ' is-rotation-active' : ' is-rotation-reserve') : ''}`}
              key={`player-stage-${pokemon.battleId}`}
              style={battleStageStyle(visualTurnCue, attackAnimationMode)}
              {...pokemonInspectorProps(`player-${slot}`, pokemon)}
            >
              <span className="battle-pokemon-shadow" aria-hidden="true" />
              <PokemonSprite
                animatedSrc={pokemon.spriteBack}
                fallbackSrc={pokemon.spriteBackFallback}
                frameClassName="battle-live-sprite-frame player-sprite-frame"
                className="battle-live-sprite"
                decodingMode="async"
                alt={pokemon.name}
              />
              {pokemon.teraActive && <TeraTypeJewel type={pokemon.teraType} />}
            </div>
          ))}

          <BattleWeatherEffects
            key={`weather-front-${battle.rules.weather.id}`}
            weatherId={battle.rules.weather.id}
            layer="front"
          />
          <BattleArenaEffects
            cue={visualTurnCue}
            animationMode={attackAnimationMode}
            showDamageNumbers={showDamageNumbers}
          />
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
              activeSlot={battle.awaitingPlayerSwitch ? battle.awaitingPlayerSwitchSlots?.[0] ?? 0 : commandSlot}
              onSelect={chooseSwitch}
              onBack={returnToCommandMenu}
              onPreview={previewBattleMenu}
            />
          ) : !commandLocked && menu === 'target' && pendingMoveIndex != null ? (
            <MoveTargetMenu
              battle={battle}
              activeSlot={commandSlot}
              moveIndex={pendingMoveIndex}
              pendingGimmick={pendingGimmick}
              onSelect={chooseMoveTarget}
              onBack={returnToMoveMenu}
              onPreview={previewBattleMenu}
            />
          ) : !commandLocked && menu === 'fight' ? (
            <MoveMenu
              key={getActivePokemon(battle, 'player', commandSlot)?.battleId ?? `rotation-slot-${commandSlot}`}
              battle={battle}
              activeSlot={commandSlot}
              targetSlot={targetSlot}
              pendingGimmick={pendingGimmick}
              reservedMechanicIds={reservedMechanicIds}
              onActiveSlot={selectRotationCommandSlot}
              onGimmick={setPendingGimmick}
              onMove={chooseMove}
              onOpenParty={openPartyForCurrentSlot}
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
          playerGender={playerGender}
          rules={battle.rules}
          effectsReady={moveAssetsReady}
          onPreview={previewBattleMenu}
          onStart={() => {
            battleAudioRef.current?.start({ player: playerActive, opponent: opponentActive })
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
