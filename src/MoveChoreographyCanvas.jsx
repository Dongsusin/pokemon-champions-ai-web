import { useEffect, useRef } from 'react'
import { getMoveChoreography } from './data/moveChoreographyData.js'
import { paintBattleMove } from './battleMovePainter.js'

export default function MoveChoreographyCanvas({ cue, profile, phase, duration, anchorRef }) {
  const canvasRef = useRef(null)
  const recipe = getMoveChoreography(profile, cue)

  useEffect(() => {
    const canvas = canvasRef.current
    const root = anchorRef.current
    const ctx = canvas?.getContext('2d', { alpha: true })
    if (!ctx || !root) return undefined
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let frameId = null
    let disposed = false
    let ratio = 1
    let startedAt = performance.now()
    let lastFrame = -Infinity

    const resize = () => {
      const bounds = root.getBoundingClientRect()
      // A capped backing store keeps sharp pixels and a small mobile GPU surface.
      ratio = Math.min(1, 960 / Math.max(1, bounds.width))
      canvas.width = Math.max(1, Math.round(bounds.width * ratio))
      canvas.height = Math.max(1, Math.round(bounds.height * ratio))
    }
    const coordinate = (name, fallback, dimension) => {
      const value = root.style.getPropertyValue(name).trim()
      if (!value) return fallback
      const number = Number.parseFloat(value)
      if (!Number.isFinite(number)) return fallback
      return value.endsWith('%') ? number / 100 * dimension : number * ratio
    }
    const render = (time) => {
      if (disposed) return
      const elapsed = Math.max(0, time - startedAt)
      const progress = motion.matches ? .65 : Math.min(1, elapsed / Math.max(1, duration))
      if (time - lastFrame >= 1000 / 60 || progress >= 1 || motion.matches) {
        const source = {
          x: coordinate('--source-x', canvas.width * (cue.sideId === 'opponent' ? .78 : .22), canvas.width),
          y: coordinate('--source-y', canvas.height * (cue.sideId === 'opponent' ? .35 : .7), canvas.height),
        }
        const target = {
          x: coordinate('--target-x', canvas.width - source.x, canvas.width),
          y: coordinate('--target-y', canvas.height - source.y, canvas.height),
        }
        paintBattleMove(ctx, { width: canvas.width, height: canvas.height, source, target,
          progress, phase, recipe, cue, seed: profile.seed, reducedMotion: motion.matches })
        lastFrame = time
      }
      if (!motion.matches && elapsed < duration) frameId = requestAnimationFrame(render)
    }
    const restart = () => {
      if (frameId !== null) cancelAnimationFrame(frameId)
      startedAt = performance.now()
      lastFrame = -Infinity
      resize()
      render(startedAt + 1)
    }
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      resize()
      if (motion.matches) {
        if (frameId !== null) cancelAnimationFrame(frameId)
        frameId = requestAnimationFrame(render)
      }
    })
    resize()
    observer?.observe(root)
    motion.addEventListener('change', restart)
    frameId = requestAnimationFrame(render)
    return () => {
      disposed = true
      if (frameId !== null) cancelAnimationFrame(frameId)
      observer?.disconnect()
      motion.removeEventListener('change', restart)
    }
  }, [cue.id, phase, duration, anchorRef, profile.seed])

  return <canvas ref={canvasRef} className="battle-move-choreography-canvas" aria-hidden="true"
    data-choreography={recipe.id} data-fx-family={recipe.family} data-fx-signature={recipe.signature ?? undefined}
    data-fx-quality="composed" />
}
