import { GAME_TEXT_SCALES } from './gameSettings.js'

export const LOCKED_GAME_TEXT_SCALE = 1

/**
 * Phones and tablets stay on the 1x type ramp. Their landscape frame is a
 * fixed canvas, so the larger presets push controls outside it instead of
 * scrolling like the desktop layout does.
 */
export function isGameTextScaleLocked() {
  if (typeof document === 'undefined') return false
  const layout = document.documentElement.dataset.mobileLayout
  return layout === 'landscape' || layout === 'portrait'
}

export function applyGameTextScale(value) {
  const requested = GAME_TEXT_SCALES.includes(value) ? value : LOCKED_GAME_TEXT_SCALE
  const scale = isGameTextScaleLocked() ? LOCKED_GAME_TEXT_SCALE : requested
  if (typeof document === 'undefined') return scale
  document.documentElement.style.setProperty('--game-text-scale', String(scale))
  document.documentElement.dataset.gameTextScale = String(scale)
  return scale
}
