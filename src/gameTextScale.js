import { GAME_TEXT_SCALES } from './gameSettings.js'

export function applyGameTextScale(value) {
  const scale = GAME_TEXT_SCALES.includes(value) ? value : 1
  if (typeof document === 'undefined') return scale
  document.documentElement.style.setProperty('--game-text-scale', String(scale))
  document.documentElement.dataset.gameTextScale = String(scale)
  return scale
}
