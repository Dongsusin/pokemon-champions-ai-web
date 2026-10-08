export const SETTINGS_STORAGE_KEY = 'champions-settings-v1'
export const GAME_TEXT_SCALES = Object.freeze([0.5, 1, 1.5, 2])

const ATTACK_ANIMATION_MODES = new Set(['skip', 'normal', 'fast', 'very-fast'])
const HP_BAR_SPEEDS = new Set(['slow', 'normal', 'fast', 'instant'])
const PLAYER_GENDERS = new Set(['male', 'female'])
const AUDIO_KEYS = ['master', 'music', 'ui', 'event', 'effects', 'cries']

export const DEFAULT_GAME_SETTINGS = {
  game: {
    textScale: 1,
    playerGender: 'male',
    attackAnimation: 'normal',
    hpBarSpeed: 'normal',
    showDamageNumbers: true,
  },
  audio: {
    enabled: true,
    master: 100,
    music: 100,
    ui: 100,
    event: 100,
    effects: 100,
    cries: 100,
  },
}

function clampPercent(value, fallback = 100) {
  const normalized = Number(value)
  if (!Number.isFinite(normalized)) return fallback
  return Math.max(0, Math.min(100, Math.round(normalized)))
}

export function createDefaultGameSettings() {
  return {
    game: { ...DEFAULT_GAME_SETTINGS.game },
    audio: { ...DEFAULT_GAME_SETTINGS.audio },
  }
}

export function normalizeGameSettings(value = {}) {
  const defaults = createDefaultGameSettings()
  const game = value?.game ?? {}
  const audio = value?.audio ?? {}
  const normalizedAudio = {
    ...defaults.audio,
    enabled: audio.enabled !== false,
  }

  AUDIO_KEYS.forEach((key) => {
    normalizedAudio[key] = clampPercent(audio[key], defaults.audio[key])
  })

  return {
    game: {
      textScale: GAME_TEXT_SCALES.includes(game.textScale)
        ? game.textScale
        : defaults.game.textScale,
      playerGender: PLAYER_GENDERS.has(game.playerGender)
        ? game.playerGender
        : defaults.game.playerGender,
      attackAnimation: ATTACK_ANIMATION_MODES.has(game.attackAnimation)
        ? game.attackAnimation
        : defaults.game.attackAnimation,
      hpBarSpeed: HP_BAR_SPEEDS.has(game.hpBarSpeed)
        ? game.hpBarSpeed
        : defaults.game.hpBarSpeed,
      showDamageNumbers: game.showDamageNumbers !== false,
    },
    audio: normalizedAudio,
  }
}

export function loadGameSettings() {
  if (typeof window === 'undefined') return createDefaultGameSettings()
  try {
    const stored = window.localStorage.getItem(SETTINGS_STORAGE_KEY)
    return normalizeGameSettings(stored ? JSON.parse(stored) : null)
  } catch {
    return createDefaultGameSettings()
  }
}
