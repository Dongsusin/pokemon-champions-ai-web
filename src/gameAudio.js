import { MENU_MUSIC_TRACKS } from './data/menuMusic.js'

const MASTER_VOLUME = 0.94
const MUSIC_VOLUME = 0.16
const UI_VOLUME = 0.58
const EVENT_VOLUME = 0.64

const DEFAULT_AUDIO_MIX = {
  master: 1,
  music: 1,
  ui: 1,
  event: 1,
}

function audioMixLevel(value, fallback = 1) {
  const normalized = Number(value)
  if (!Number.isFinite(normalized)) return fallback
  return Math.max(0, Math.min(1, normalized / 100))
}

function mergeAudioMix(current = DEFAULT_AUDIO_MIX, value = {}) {
  return Object.fromEntries(Object.keys(DEFAULT_AUDIO_MIX).map((key) => [
    key,
    value[key] == null ? current[key] : audioMixLevel(value[key], current[key]),
  ]))
}

function audioContextConstructor() {
  if (typeof window === 'undefined') return null
  return window.AudioContext ?? window.webkitAudioContext ?? null
}

function clampPan(value) {
  return Math.max(-1, Math.min(1, Number(value) || 0))
}

export function createGameAudio(initialEnabled = true, initialMix = {}) {
  let context = null
  let masterGain = null
  let musicGain = null
  let uiGain = null
  let eventGain = null
  let compressor = null
  let schedulerTimer = null
  let nextMusicTime = 0
  let musicStep = 0
  let musicTrackIndex = 0
  let scheduledMusicSteps = []
  const musicSources = new Map()
  let menuMusicActive = true
  let enabled = Boolean(initialEnabled)
  let mix = mergeAudioMix(DEFAULT_AUDIO_MIX, initialMix)
  let activated = false
  let lastCursorTime = 0

  const busFor = (bus) => {
    if (bus === 'music') return musicGain
    if (bus === 'event') return eventGain
    return uiGain
  }

  const ensureContext = () => {
    if (context) {
      if (context.state === 'suspended') context.resume().catch(() => {})
      return context
    }

    const AudioContext = audioContextConstructor()
    if (!AudioContext) return null

    context = new AudioContext()
    masterGain = context.createGain()
    musicGain = context.createGain()
    uiGain = context.createGain()
    eventGain = context.createGain()
    compressor = context.createDynamicsCompressor()

    masterGain.gain.value = enabled ? MASTER_VOLUME * mix.master : 0
    musicGain.gain.value = menuMusicActive ? MUSIC_VOLUME * mix.music : 0
    uiGain.gain.value = UI_VOLUME * mix.ui
    eventGain.gain.value = EVENT_VOLUME * mix.event
    compressor.threshold.value = -20
    compressor.knee.value = 18
    compressor.ratio.value = 7
    compressor.attack.value = 0.003
    compressor.release.value = 0.18

    musicGain.connect(masterGain)
    uiGain.connect(masterGain)
    eventGain.connect(masterGain)
    masterGain.connect(compressor)
    compressor.connect(context.destination)
    return context
  }

  const trackMusicSource = (source, start, bus) => {
    if (bus !== 'music') return
    musicSources.set(source, start)
    source.onended = () => {
      musicSources.delete(source)
      source.disconnect()
    }
  }

  const tone = (frequency, start, duration, options = {}) => {
    if (!context || !enabled || !frequency) return
    const oscillator = context.createOscillator()
    const envelope = context.createGain()
    const output = busFor(options.bus)
    const attack = Math.min(options.attack ?? 0.008, duration * 0.35)
    const releaseStart = Math.max(start + attack, start + duration - (options.release ?? duration * 0.34))
    const end = start + duration
    let lastNode = envelope

    oscillator.type = options.wave ?? 'square'
    oscillator.frequency.setValueAtTime(Math.max(30, frequency), start)
    if (options.slide) oscillator.frequency.exponentialRampToValueAtTime(Math.max(30, options.slide), end)
    oscillator.detune.value = options.detune ?? 0

    envelope.gain.setValueAtTime(0.0001, start)
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.0001, options.volume ?? 0.12), start + attack)
    envelope.gain.setValueAtTime(Math.max(0.0001, options.volume ?? 0.12), releaseStart)
    envelope.gain.exponentialRampToValueAtTime(0.0001, end)
    oscillator.connect(envelope)

    if (options.filter) {
      const filter = context.createBiquadFilter()
      filter.type = options.filter.type ?? 'lowpass'
      filter.frequency.value = options.filter.frequency ?? 1800
      filter.Q.value = options.filter.q ?? 0.7
      lastNode.connect(filter)
      lastNode = filter
    }

    if (context.createStereoPanner && options.pan !== undefined) {
      const panner = context.createStereoPanner()
      panner.pan.value = clampPan(options.pan)
      lastNode.connect(panner)
      lastNode = panner
    }

    lastNode.connect(output)
    trackMusicSource(oscillator, start, options.bus)
    oscillator.start(start)
    oscillator.stop(end + 0.025)
  }

  const noise = (start, duration, options = {}) => {
    if (!context || !enabled) return
    const frameCount = Math.max(1, Math.floor(context.sampleRate * duration))
    const buffer = context.createBuffer(1, frameCount, context.sampleRate)
    const samples = buffer.getChannelData(0)
    const source = context.createBufferSource()
    const filter = context.createBiquadFilter()
    const envelope = context.createGain()
    const output = busFor(options.bus)

    for (let index = 0; index < frameCount; index += 1) {
      samples[index] = (Math.random() * 2 - 1) * (1 - index / frameCount * (options.decay ?? 0.35))
    }

    source.buffer = buffer
    filter.type = options.filterType ?? 'bandpass'
    filter.frequency.value = options.frequency ?? 1200
    filter.Q.value = options.q ?? 0.9
    envelope.gain.setValueAtTime(Math.max(0.0001, options.volume ?? 0.09), start)
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration)
    source.connect(filter)
    filter.connect(envelope)

    if (context.createStereoPanner && options.pan !== undefined) {
      const panner = context.createStereoPanner()
      panner.pan.value = clampPan(options.pan)
      envelope.connect(panner)
      panner.connect(output)
    } else {
      envelope.connect(output)
    }

    trackMusicSource(source, start, options.bus)
    source.start(start)
    source.stop(start + duration + 0.025)
  }

  const sequence = (notes, options = {}) => {
    const audio = ensureContext()
    if (!audio || !enabled) return
    const start = audio.currentTime + (options.delay ?? 0.008)
    const step = options.step ?? 0.075

    notes.forEach((frequency, index) => {
      tone(frequency, start + index * step, options.duration ?? step * 0.82, {
        ...options,
        pan: options.panSpread ? -options.panSpread + (index / Math.max(1, notes.length - 1)) * options.panSpread * 2 : options.pan,
      })
    })
  }

  const scheduleMusicStep = (theme, stepIndex, start) => {
    const melodyIndex = stepIndex % theme.melody.length
    const melody = theme.melody[melodyIndex]
    const beatIndex = Math.floor(melodyIndex / 2)
    const stepDuration = 60 / theme.bpm / 2

    if (melody) {
      tone(melody, start, stepDuration * 0.78, {
        bus: 'music',
        volume: melodyIndex % 4 === 0 ? 0.135 : 0.102,
        wave: theme.wave ?? 'square',
        pan: melodyIndex % 2 === 0 ? -0.12 : 0.12,
        filter: { frequency: 2600, q: 0.45 },
      })
      if (theme.sparkle && melodyIndex % 4 === 2) {
        tone(melody * 2, start + stepDuration * 0.18, stepDuration * 0.52, {
          bus: 'music',
          volume: 0.038,
          wave: 'sine',
          pan: 0.35,
        })
      }
    }

    if (melodyIndex % 2 === 0) {
      const bass = theme.bass[beatIndex % theme.bass.length]
      tone(bass, start, stepDuration * 1.55, {
        bus: 'music',
        volume: theme.march ? 0.13 : 0.105,
        wave: 'triangle',
        filter: { frequency: 520, q: 0.6 },
        pan: -0.18,
      })
    }

    if (melodyIndex % 4 === 0) {
      tone(theme.march ? 72 : 64, start, 0.11, {
        bus: 'music',
        volume: theme.march ? 0.16 : 0.115,
        wave: 'sine',
        slide: 42,
      })
    } else if (melodyIndex % 4 === 2) {
      noise(start, 0.075, {
        bus: 'music',
        volume: theme.march ? 0.08 : 0.055,
        frequency: theme.march ? 1550 : 2250,
        filterType: 'highpass',
        pan: 0.12,
      })
    }
  }

  const schedulerTick = () => {
    if (!activated || !enabled || !menuMusicActive || !context) return
    const now = context.currentTime
    const lookAhead = now + 0.22
    scheduledMusicSteps = scheduledMusicSteps.filter(step => step.start >= now)
    // A throttled background timer must not play all missed notes at once.
    if (nextMusicTime < now) nextMusicTime = now + 0.025

    while (nextMusicTime < lookAhead) {
      let theme = MENU_MUSIC_TRACKS[musicTrackIndex]
      if (musicStep >= theme.melody.length * theme.loops) {
        musicTrackIndex = (musicTrackIndex + 1) % MENU_MUSIC_TRACKS.length
        musicStep = 0
        theme = MENU_MUSIC_TRACKS[musicTrackIndex]
      }
      scheduledMusicSteps.push({ trackIndex: musicTrackIndex, step: musicStep, start: nextMusicTime })
      scheduleMusicStep(theme, musicStep, nextMusicTime)
      musicStep += 1
      // Carry the same audio timeline across songs, including tempo changes.
      nextMusicTime += 60 / theme.bpm / 2
    }
  }

  const stopMusic = () => {
    if (schedulerTimer !== null) window.clearInterval(schedulerTimer)
    schedulerTimer = null
    const now = context?.currentTime ?? 0
    // Return queued, unheard notes to the playback cursor before pausing.
    const pendingStep = scheduledMusicSteps.find(step => step.start >= now)
    if (pendingStep) {
      musicTrackIndex = pendingStep.trackIndex
      musicStep = pendingStep.step
    }
    scheduledMusicSteps = []
    for (const [source, start] of musicSources) {
      try { source.stop(start >= now ? now : now + 0.035) } catch { /* Already ended. */ }
    }
    musicSources.clear()
  }

  const startMusic = () => {
    const audio = ensureContext()
    if (!audio || !activated || !enabled || !menuMusicActive) return
    if (schedulerTimer === null) {
      nextMusicTime = audio.currentTime + 0.06
      schedulerTick()
      schedulerTimer = window.setInterval(schedulerTick, 70)
    }
  }

  const activate = () => {
    activated = true
    const audio = ensureContext()
    if (!audio || !enabled) return
    startMusic()
  }

  const playUi = (kind = 'select') => {
    if (kind === 'cursor' && !activated) return
    activate()
    if (!context || !enabled) return
    const now = context.currentTime + 0.004

    if (kind === 'cursor') {
      const timestamp = performance.now()
      if (timestamp - lastCursorTime < 55) return
      lastCursorTime = timestamp
      tone(784, now, 0.032, { volume: 0.08, wave: 'square', pan: -0.08 })
      tone(1047, now + 0.018, 0.036, { volume: 0.045, wave: 'square', pan: 0.08 })
      return
    }

    if (kind === 'cancel') {
      tone(494, now, 0.055, { volume: 0.14, wave: 'square' })
      tone(330, now + 0.05, 0.09, { volume: 0.13, wave: 'square' })
      return
    }

    if (kind === 'error') {
      tone(150, now, 0.16, { volume: 0.18, wave: 'sawtooth', slide: 105 })
      tone(142, now + 0.09, 0.16, { volume: 0.15, wave: 'square', slide: 96 })
      return
    }

    if (kind === 'confirm') {
      sequence([523, 659, 784, 1047], {
        bus: 'ui',
        step: 0.052,
        duration: 0.082,
        volume: 0.115,
        wave: 'square',
        panSpread: 0.18,
      })
      return
    }

    tone(523, now, 0.046, { volume: 0.14, wave: 'square', pan: -0.08 })
    tone(784, now + 0.038, 0.07, { volume: 0.115, wave: 'square', pan: 0.08 })
  }

  const playEvent = (kind = 'success') => {
    activate()
    if (!context || !enabled) return
    const now = context.currentTime + 0.008

    if (kind === 'draw' || kind === 'shiny') {
      tone(110, now, 0.58, { bus: 'event', volume: 0.14, wave: 'sawtooth', slide: 440 })
      noise(now + 0.12, 0.42, { bus: 'event', volume: 0.075, frequency: 2800, filterType: 'highpass' })
      sequence(kind === 'shiny'
        ? [523, 659, 784, 1047, 1319, 1568, 2093]
        : [392, 523, 659, 784, 1047], {
        bus: 'event',
        delay: 0.16,
        step: 0.072,
        duration: 0.13,
        volume: 0.12,
        wave: kind === 'shiny' ? 'sine' : 'square',
        panSpread: 0.55,
      })
      return
    }

    if (kind === 'purchase') {
      sequence([988, 1319, 1568, 1319, 1976], {
        bus: 'event',
        step: 0.055,
        duration: 0.09,
        volume: 0.125,
        wave: 'square',
        panSpread: 0.28,
      })
      return
    }

    if (kind === 'equip') {
      noise(now, 0.065, { bus: 'event', volume: 0.12, frequency: 1750 })
      tone(330, now, 0.18, { bus: 'event', volume: 0.13, wave: 'triangle', slide: 990 })
      tone(1320, now + 0.13, 0.1, { bus: 'event', volume: 0.1, wave: 'sine' })
      return
    }

    if (kind === 'save' || kind === 'team') {
      sequence(kind === 'team' ? [392, 523, 659] : [523, 659, 784, 988], {
        bus: 'event',
        step: 0.065,
        duration: 0.105,
        volume: 0.12,
        wave: 'square',
      })
      return
    }

    if (kind === 'reward') {
      sequence([392, 523, 659, 784, 1047, 1319], {
        bus: 'event',
        step: 0.09,
        duration: 0.15,
        volume: 0.14,
        wave: 'square',
        panSpread: 0.42,
      })
      tone(196, now, 0.65, { bus: 'event', volume: 0.12, wave: 'triangle', slide: 392 })
      return
    }

    if (kind === 'competition') {
      sequence([196, 262, 330, 392, 523], {
        bus: 'event',
        step: 0.1,
        duration: 0.16,
        volume: 0.135,
        wave: 'square',
      })
      noise(now + 0.35, 0.18, { bus: 'event', volume: 0.08, frequency: 1900, filterType: 'highpass' })
      return
    }

    if (kind === 'error') {
      playUi('error')
      return
    }

    sequence([523, 659, 784], {
      bus: 'event',
      step: 0.06,
      duration: 0.1,
      volume: 0.11,
      wave: 'square',
    })
  }

  const setScene = (nextScene) => {
    // Every menu shares one playlist; only an explicit battle boundary pauses it.
    const nextActive = nextScene != null && nextScene !== 'battle'
    if (menuMusicActive === nextActive) return
    menuMusicActive = nextActive
    if (!nextActive) stopMusic()
    if (!context || !activated) return

    const now = context.currentTime
    musicGain.gain.cancelScheduledValues(now)
    musicGain.gain.setTargetAtTime(nextActive ? MUSIC_VOLUME * mix.music : 0, now, 0.018)
    if (nextActive && enabled) startMusic()
  }

  const setEnabled = (nextEnabled) => {
    const nextValue = Boolean(nextEnabled)
    if (enabled === nextValue) return
    enabled = nextValue
    if (!activated && !context) return
    const audio = enabled ? ensureContext() : context
    if (!audio || !masterGain) return

    masterGain.gain.cancelScheduledValues(audio.currentTime)
    masterGain.gain.setTargetAtTime(enabled ? MASTER_VOLUME * mix.master : 0, audio.currentTime, 0.018)
    if (enabled) {
      startMusic()
      playUi('confirm')
    } else {
      stopMusic()
    }
  }

  const setMix = (nextMix = {}) => {
    mix = mergeAudioMix(mix, nextMix)
    if (!context) return
    const now = context.currentTime
    masterGain.gain.setTargetAtTime(enabled ? MASTER_VOLUME * mix.master : 0, now, 0.025)
    musicGain.gain.setTargetAtTime(menuMusicActive ? MUSIC_VOLUME * mix.music : 0, now, 0.04)
    uiGain.gain.setTargetAtTime(UI_VOLUME * mix.ui, now, 0.025)
    eventGain.gain.setTargetAtTime(EVENT_VOLUME * mix.event, now, 0.025)
  }

  const destroy = () => {
    stopMusic()
    if (context && context.state !== 'closed') context.close().catch(() => {})
    context = null
    masterGain = null
    musicGain = null
    uiGain = null
    eventGain = null
    compressor = null
  }

  return {
    activate,
    destroy,
    playEvent,
    playUi,
    setEnabled,
    setMix,
    setScene,
  }
}
