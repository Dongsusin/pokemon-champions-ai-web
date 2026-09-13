import assert from 'node:assert/strict'
import {
  DEFAULT_GAME_SETTINGS,
  GAME_TEXT_SCALES,
  SETTINGS_STORAGE_KEY,
  createDefaultGameSettings,
  loadGameSettings,
  normalizeGameSettings,
} from '../src/gameSettings.js'

let checks = 0
const check = (label, run) => {
  run()
  checks += 1
  console.log(`PASS ${label}`)
}

check('new settings start at the existing 1x text size', () => {
  assert.deepEqual(GAME_TEXT_SCALES, [0.5, 1, 1.5, 2])
  assert.equal(DEFAULT_GAME_SETTINGS.game.textScale, 1)
  assert.equal(createDefaultGameSettings().game.textScale, 1)
  assert.equal(loadGameSettings().game.textScale, 1)
})

check('legacy settings retain their choices and gain the default text size', () => {
  const legacy = {
    game: { playerGender: 'female', attackAnimation: 'fast', hpBarSpeed: 'instant', showDamageNumbers: false },
    audio: { enabled: false, music: 35 },
  }
  const normalized = normalizeGameSettings(legacy)
  assert.deepEqual(normalized.game, { ...legacy.game, textScale: 1 })
  assert.equal(normalized.audio.enabled, false)
  assert.equal(normalized.audio.music, 35)
  assert.equal(legacy.game.textScale, undefined, 'normalization must not change the original settings')
})

check('every supported numeric multiplier survives normalization', () => {
  for (const textScale of GAME_TEXT_SCALES) {
    assert.equal(normalizeGameSettings({ game: { textScale } }).game.textScale, textScale)
  }
})

check('unsupported, nonnumeric and nonfinite multipliers fall back to 1x', () => {
  for (const textScale of [undefined, null, 0, -1, 0.75, 3, NaN, Infinity, -Infinity, '0.5', '1', '2', true, false, {}, [2]]) {
    assert.equal(normalizeGameSettings({ game: { textScale } }).game.textScale, 1, String(textScale))
  }
  assert.equal(normalizeGameSettings(null).game.textScale, 1)
})

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
try {
  const stored = new Map()
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key) => stored.get(key) ?? null,
        setItem: (key, value) => stored.set(key, String(value)),
      },
    },
  })

  check('saved text sizes are restored after reopening the game', () => {
    for (const textScale of GAME_TEXT_SCALES) {
      const settings = normalizeGameSettings({ game: { textScale }, audio: { music: 42 } })
      window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings))
      const reloaded = loadGameSettings()
      assert.equal(reloaded.game.textScale, textScale)
      assert.equal(reloaded.audio.music, 42)
    }
  })

  check('legacy and malformed persisted settings load safely', () => {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ game: { playerGender: 'female' } }))
    assert.equal(loadGameSettings().game.textScale, 1)
    assert.equal(loadGameSettings().game.playerGender, 'female')
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, '{broken JSON')
    assert.deepEqual(loadGameSettings(), createDefaultGameSettings())
    stored.clear()
    assert.equal(loadGameSettings().game.textScale, 1)
  })

  check('restoring defaults resets 2x to 1x without modifying defaults', () => {
    const settings = createDefaultGameSettings()
    settings.game.textScale = 2
    assert.equal(DEFAULT_GAME_SETTINGS.game.textScale, 1)
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings))
    assert.equal(loadGameSettings().game.textScale, 2)
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(createDefaultGameSettings()))
    assert.equal(loadGameSettings().game.textScale, 1)
  })

  check('unavailable local storage returns usable default settings', () => {
    window.localStorage.getItem = () => { throw new Error('Storage unavailable') }
    assert.deepEqual(loadGameSettings(), createDefaultGameSettings())
  })
} finally {
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
  else delete globalThis.window
}

console.log(`PASS ${checks} game text settings checks`)
