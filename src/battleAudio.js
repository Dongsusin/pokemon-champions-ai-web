import { getMoveSoundProfile } from './data/moveSoundData.js'

const BATTLE_AUDIO_ROOT = '/assets/audio/battle'
const BATTLE_MOVE_AUDIO_ROOT = `${BATTLE_AUDIO_ROOT}/moves`
const BATTLE_MUSIC_PATH = `${BATTLE_AUDIO_ROOT}/battle-theme.ogg`
const POKEMON_CRY_ROOT = 'https://raw.githubusercontent.com/PokeAPI/cries/main/cries/pokemon'
export const BATTLE_SAMPLE_PATHS = {
  cursor: `${BATTLE_AUDIO_ROOT}/ui-cursor.ogg`,
  select: `${BATTLE_AUDIO_ROOT}/ui-select.ogg`,
  cancel: `${BATTLE_AUDIO_ROOT}/ui-cancel.ogg`,
  hit: `${BATTLE_AUDIO_ROOT}/hit.wav`,
  punch: `${BATTLE_AUDIO_ROOT}/punch.ogg`,
  hurt: `${BATTLE_AUDIO_ROOT}/hurt.ogg`,
  explosion: `${BATTLE_AUDIO_ROOT}/explosion.ogg`,
  explosionHeavy: `${BATTLE_AUDIO_ROOT}/explosion-heavy.ogg`,
  item: `${BATTLE_AUDIO_ROOT}/item.ogg`,
  blade1: `${BATTLE_MOVE_AUDIO_ROOT}/blade-1.ogg`,
  blade2: `${BATTLE_MOVE_AUDIO_ROOT}/blade-2.ogg`,
  blade3: `${BATTLE_MOVE_AUDIO_ROOT}/blade-3.ogg`,
  chain1: `${BATTLE_MOVE_AUDIO_ROOT}/chain-1.ogg`,
  chain2: `${BATTLE_MOVE_AUDIO_ROOT}/chain-2.ogg`,
  electricCrackle: `${BATTLE_MOVE_AUDIO_ROOT}/electric-crackle.wav`,
  electricGround: `${BATTLE_MOVE_AUDIO_ROOT}/electric-ground.wav`,
  electricHit: `${BATTLE_MOVE_AUDIO_ROOT}/electric-hit.wav`,
  fire1: `${BATTLE_MOVE_AUDIO_ROOT}/fire-1.ogg`,
  fire2: `${BATTLE_MOVE_AUDIO_ROOT}/fire-2.ogg`,
  fire3: `${BATTLE_MOVE_AUDIO_ROOT}/fire-3.ogg`,
  gem1: `${BATTLE_MOVE_AUDIO_ROOT}/gem-1.ogg`,
  gem2: `${BATTLE_MOVE_AUDIO_ROOT}/gem-2.ogg`,
  ice1: `${BATTLE_MOVE_AUDIO_ROOT}/ice-1.ogg`,
  ice2: `${BATTLE_MOVE_AUDIO_ROOT}/ice-2.ogg`,
  ice3: `${BATTLE_MOVE_AUDIO_ROOT}/ice-3.ogg`,
  magic1: `${BATTLE_MOVE_AUDIO_ROOT}/magic-1.ogg`,
  magic2: `${BATTLE_MOVE_AUDIO_ROOT}/magic-2.ogg`,
  magic3: `${BATTLE_MOVE_AUDIO_ROOT}/magic-3.ogg`,
  magic4: `${BATTLE_MOVE_AUDIO_ROOT}/magic-4.ogg`,
  magic5: `${BATTLE_MOVE_AUDIO_ROOT}/magic-5.ogg`,
  magic6: `${BATTLE_MOVE_AUDIO_ROOT}/magic-6.ogg`,
  magic7: `${BATTLE_MOVE_AUDIO_ROOT}/magic-7.ogg`,
  metal1: `${BATTLE_MOVE_AUDIO_ROOT}/metal-1.ogg`,
  metal2: `${BATTLE_MOVE_AUDIO_ROOT}/metal-2.ogg`,
  slime1: `${BATTLE_MOVE_AUDIO_ROOT}/slime-1.ogg`,
  slime2: `${BATTLE_MOVE_AUDIO_ROOT}/slime-2.ogg`,
  spell1: `${BATTLE_MOVE_AUDIO_ROOT}/spell-1.ogg`,
  spell2: `${BATTLE_MOVE_AUDIO_ROOT}/spell-2.ogg`,
  stone1: `${BATTLE_MOVE_AUDIO_ROOT}/stone-1.ogg`,
  stone2: `${BATTLE_MOVE_AUDIO_ROOT}/stone-2.ogg`,
  waterBubbles: `${BATTLE_MOVE_AUDIO_ROOT}/water-bubbles.ogg`,
  waterImpact: `${BATTLE_MOVE_AUDIO_ROOT}/water-impact.ogg`,
  wind: `${BATTLE_MOVE_AUDIO_ROOT}/wind.ogg`,
  wood1: `${BATTLE_MOVE_AUDIO_ROOT}/wood-1.ogg`,
  wood2: `${BATTLE_MOVE_AUDIO_ROOT}/wood-2.ogg`,
}

const BATTLE_MASTER_VOLUME = 0.96
const BATTLE_EFFECTS_VOLUME = 0.56
const BATTLE_MUSIC_VOLUME = 0.19
const LOW_HP_MUSIC_VOLUME = 0.13

function audioContextConstructor() {
  if (typeof window === 'undefined') return null
  return window.AudioContext ?? window.webkitAudioContext ?? null
}

export function createBattleAudio(initialEnabled = true) {
  let context = null
  let masterGain = null
  let effectsGain = null
  let musicGain = null
  let compressor = null
  let musicElement = null
  let musicSource = null
  let lowHpTimer = null
  let sampleLoadPromise = null
  const sampleBuffers = new Map()
  const cryBuffers = new Map()
  const cryLoadPromises = new Map()
  const failedCryIds = new Set()
  let enabled = Boolean(initialEnabled)
  let battleStarted = false
  let musicStarted = false
  let lowHpActive = false
  let lastCueId = null

  const ensureContext = () => {
    if (context) {
      if (context.state === 'suspended') context.resume().catch(() => {})
      return context
    }

    const AudioContext = audioContextConstructor()
    if (!AudioContext) return null

    context = new AudioContext()
    masterGain = context.createGain()
    effectsGain = context.createGain()
    musicGain = context.createGain()
    compressor = context.createDynamicsCompressor()
    masterGain.gain.value = enabled ? BATTLE_MASTER_VOLUME : 0
    effectsGain.gain.value = BATTLE_EFFECTS_VOLUME
    musicGain.gain.value = BATTLE_MUSIC_VOLUME
    compressor.threshold.value = -19
    compressor.knee.value = 18
    compressor.ratio.value = 7
    compressor.attack.value = 0.003
    compressor.release.value = 0.2
    effectsGain.connect(masterGain)
    musicGain.connect(masterGain)
    masterGain.connect(compressor)
    compressor.connect(context.destination)

    musicElement = new Audio(BATTLE_MUSIC_PATH)
    musicElement.loop = true
    musicElement.preload = 'auto'
    musicElement.volume = 1
    musicSource = context.createMediaElementSource(musicElement)
    musicSource.connect(musicGain)
    return context
  }

  const pokemonCryIds = (pokemon = {}) => [...new Set([
    pokemon.speciesId,
    pokemon.originalSpeciesId,
  ].map(Number).filter((speciesId) => Number.isInteger(speciesId) && speciesId > 0))]

  const preloadCry = (speciesId) => {
    const audio = ensureContext()
    const normalizedId = Number(speciesId)
    if (!audio || !Number.isInteger(normalizedId) || normalizedId <= 0 || failedCryIds.has(normalizedId)) {
      return Promise.resolve(null)
    }
    if (cryBuffers.has(normalizedId)) return Promise.resolve(cryBuffers.get(normalizedId))
    if (cryLoadPromises.has(normalizedId)) return cryLoadPromises.get(normalizedId)

    const loadPromise = (async () => {
      for (const collection of ['legacy', 'latest']) {
        try {
          const response = await fetch(`${POKEMON_CRY_ROOT}/${collection}/${normalizedId}.ogg`, { cache: 'force-cache' })
          if (!response.ok) continue
          const encodedAudio = await response.arrayBuffer()
          const decodedAudio = await audio.decodeAudioData(encodedAudio)
          cryBuffers.set(normalizedId, decodedAudio)
          return decodedAudio
        } catch {}
      }
      failedCryIds.add(normalizedId)
      return null
    })().finally(() => cryLoadPromises.delete(normalizedId))

    cryLoadPromises.set(normalizedId, loadPromise)
    return loadPromise
  }

  const preload = (pokemonList = []) => {
    const audio = ensureContext()
    if (!audio) return Promise.resolve()
    musicElement?.load()
    if (!sampleLoadPromise) {
      sampleLoadPromise = Promise.all(Object.entries(BATTLE_SAMPLE_PATHS).map(async ([name, path]) => {
        try {
          const response = await fetch(path)
          if (!response.ok) throw new Error(`Failed to load ${path}`)
          const encodedAudio = await response.arrayBuffer()
          const decodedAudio = await audio.decodeAudioData(encodedAudio)
          sampleBuffers.set(name, decodedAudio)
        } catch {
          sampleBuffers.delete(name)
        }
      }))
    }

    const cryIds = pokemonList.flatMap(pokemonCryIds)
    return Promise.all([sampleLoadPromise, ...cryIds.map(preloadCry)]).then(() => undefined)
  }

  const tone = (frequency, start, duration, options = {}) => {
    if (!context || !enabled) return
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    const output = options.music ? musicGain : effectsGain
    const volume = Math.max(0.0001, options.volume ?? 0.22)
    const end = start + duration

    oscillator.type = options.wave ?? 'square'
    oscillator.frequency.setValueAtTime(Math.max(32, frequency), start)
    if (options.slide) {
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(32, options.slide), end)
    }
    oscillator.detune.value = options.detune ?? 0
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(volume, start + Math.min(0.018, duration * 0.2))
    gain.gain.exponentialRampToValueAtTime(0.0001, end)
    let lastNode = gain
    oscillator.connect(gain)

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
      panner.pan.value = Math.max(-1, Math.min(1, options.pan))
      lastNode.connect(panner)
      lastNode = panner
    }

    lastNode.connect(output)
    oscillator.start(start)
    oscillator.stop(end + 0.02)
  }

  const noise = (start, duration, options = {}) => {
    if (!context || !enabled) return
    const frameCount = Math.max(1, Math.floor(context.sampleRate * duration))
    const buffer = context.createBuffer(1, frameCount, context.sampleRate)
    const data = buffer.getChannelData(0)
    const source = context.createBufferSource()
    const filter = context.createBiquadFilter()
    const gain = context.createGain()
    const volume = Math.max(0.0001, options.volume ?? 0.12)

    for (let index = 0; index < frameCount; index += 1) {
      data[index] = Math.random() * 2 - 1
    }

    source.buffer = buffer
    filter.type = options.filterType ?? 'bandpass'
    filter.frequency.value = options.frequency ?? 900
    filter.Q.value = options.q ?? 1.2
    gain.gain.setValueAtTime(volume, start)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
    source.connect(filter)
    filter.connect(gain)
    const output = options.music ? musicGain : effectsGain
    if (context.createStereoPanner && options.pan !== undefined) {
      const panner = context.createStereoPanner()
      panner.pan.value = Math.max(-1, Math.min(1, options.pan))
      gain.connect(panner)
      panner.connect(output)
    } else {
      gain.connect(output)
    }
    source.start(start)
    source.stop(start + duration + 0.02)
  }

  const playSample = (name, start, options = {}) => {
    if (!context || !enabled) return false
    const buffer = sampleBuffers.get(name)
    if (!buffer) return false
    const source = context.createBufferSource()
    const gain = context.createGain()
    let lastNode = gain
    const playbackRate = Math.max(0.45, Math.min(2.25, options.rate ?? 1))
    const volume = Math.max(0.0001, options.volume ?? 0.72)
    const playAt = Math.max(context.currentTime, start)
    const offset = Math.max(0, Math.min(buffer.duration - 0.01, options.offset ?? 0))
    const availableDuration = Math.max(0.01, buffer.duration - offset)
    const requestedDuration = Math.max(0.01, options.duration ?? availableDuration / playbackRate)
    const sourceDuration = Math.min(availableDuration, requestedDuration * playbackRate)
    const outputDuration = sourceDuration / playbackRate
    const fadeIn = Math.min(options.fadeIn ?? 0.008, outputDuration * 0.2)
    const fadeOut = Math.min(options.fadeOut ?? 0.025, outputDuration * 0.3)

    source.buffer = buffer
    source.playbackRate.value = playbackRate
    gain.gain.setValueAtTime(0.0001, playAt)
    gain.gain.exponentialRampToValueAtTime(volume, playAt + fadeIn)
    gain.gain.setValueAtTime(volume, Math.max(playAt + fadeIn, playAt + outputDuration - fadeOut))
    gain.gain.exponentialRampToValueAtTime(0.0001, playAt + outputDuration)
    source.connect(gain)

    if (options.filter) {
      const filter = context.createBiquadFilter()
      filter.type = options.filter.type ?? 'lowpass'
      filter.frequency.value = options.filter.frequency ?? 2600
      filter.Q.value = options.filter.q ?? 0.7
      lastNode.connect(filter)
      lastNode = filter
    }

    if (context.createStereoPanner && options.pan !== undefined) {
      const panner = context.createStereoPanner()
      panner.pan.value = Math.max(-1, Math.min(1, options.pan))
      lastNode.connect(panner)
      lastNode = panner
    }

    lastNode.connect(effectsGain)
    source.start(playAt, offset, sourceDuration)
    return true
  }

  const playCryBuffer = (buffer, start, sideId, options = {}) => {
    if (!context || !enabled || !buffer) return false
    const source = context.createBufferSource()
    const gain = context.createGain()
    const highpass = context.createBiquadFilter()
    const playbackRate = Math.max(0.55, Math.min(1.35, options.rate ?? 1))
    const volume = Math.max(0.0001, options.volume ?? 0.58)
    const playAt = Math.max(context.currentTime, start)
    const endAt = playAt + buffer.duration / playbackRate

    source.buffer = buffer
    source.playbackRate.value = playbackRate
    highpass.type = 'highpass'
    highpass.frequency.value = 72
    highpass.Q.value = 0.4
    gain.gain.setValueAtTime(0.0001, playAt)
    gain.gain.exponentialRampToValueAtTime(volume, playAt + 0.012)
    gain.gain.setValueAtTime(volume, Math.max(playAt + 0.012, endAt - 0.055))
    gain.gain.exponentialRampToValueAtTime(0.0001, endAt)
    source.connect(highpass)
    highpass.connect(gain)

    if (context.createStereoPanner) {
      const panner = context.createStereoPanner()
      panner.pan.value = sidePan(sideId)
      gain.connect(panner)
      panner.connect(effectsGain)
    } else {
      gain.connect(effectsGain)
    }

    source.start(playAt)
    source.stop(endAt + 0.02)
    return true
  }

  const sequence = (notes, options = {}) => {
    const audio = ensureContext()
    if (!audio || !enabled) return
    const start = audio.currentTime + (options.delay ?? 0.01)
    const step = options.step ?? 0.085
    notes.forEach((frequency, index) => {
      tone(frequency, start + index * step, options.duration ?? step * 0.82, options)
    })
  }

  const startMusic = () => {
    if (!battleStarted || !enabled) return
    const audio = ensureContext()
    if (!audio || !musicElement) return
    if (!musicStarted) {
      musicElement.currentTime = 0
      musicStarted = true
    }
    musicElement.play().catch(() => {})
  }

  const stopMusic = (reset = false) => {
    if (!musicElement) return
    musicElement.pause()
    if (reset) {
      musicElement.currentTime = 0
      musicStarted = false
    }
  }

  const playLowHpPulse = () => {
    if (!battleStarted || !enabled || !lowHpActive) return
    const audio = ensureContext()
    if (!audio) return
    const now = audio.currentTime + 0.01
    tone(880, now, 0.075, { volume: 0.105, wave: 'square' })
    tone(659, now + 0.105, 0.09, { volume: 0.09, wave: 'square' })
  }

  const startLowHpWarning = () => {
    if (lowHpTimer || !battleStarted || !enabled || !lowHpActive) return
    playLowHpPulse()
    lowHpTimer = window.setInterval(playLowHpPulse, 820)
  }

  const stopLowHpWarning = () => {
    if (!lowHpTimer) return
    window.clearInterval(lowHpTimer)
    lowHpTimer = null
  }

  const playMenu = (kind = 'select') => {
    const audio = ensureContext()
    if (!audio || !enabled) return
    const now = audio.currentTime + 0.005
    if (kind === 'cancel') {
      if (playSample('cancel', now, { volume: 0.82 })) return
      tone(330, now, 0.05, { volume: 0.12 })
      tone(220, now + 0.055, 0.07, { volume: 0.11 })
      return
    }
    if (kind === 'cursor') {
      if (playSample('cursor', now, { volume: 0.62, rate: 1.04 })) return
      tone(392, now, 0.035, { volume: 0.09 })
      return
    }
    if (playSample('select', now, { volume: 0.74 })) return
    tone(440, now, 0.045, { volume: 0.12 })
    tone(660, now + 0.045, 0.065, { volume: 0.1 })
  }

  const sidePan = (sideId) => sideId === 'player' ? -0.32 : 0.32

  const hashName = (value = '') => [...String(value)].reduce(
    (hash, character) => ((hash << 5) - hash + character.charCodeAt(0)) | 0,
    0,
  )

  const playSynthCry = (name, sideId, delay = 0, rate = 1) => {
    const audio = ensureContext()
    if (!audio || !enabled || !name) return
    const seed = Math.abs(hashName(name))
    const start = audio.currentTime + delay
    const pan = sidePan(sideId)
    const root = (145 + (seed % 170)) * rate
    const upper = root * (1.35 + (seed % 9) * 0.04)
    const length = 0.2 + (seed % 5) * 0.035

    tone(root, start, length, {
      volume: 0.16,
      wave: seed % 2 === 0 ? 'sawtooth' : 'square',
      slide: upper,
      pan,
      filter: { frequency: 1150 + (seed % 900), q: 1.4 },
    })
    tone(upper * 0.76, start + length * 0.34, length * 0.82, {
      volume: 0.11,
      wave: 'triangle',
      slide: root * 0.82,
      pan: pan * 0.8,
    })
    noise(start + 0.02, length * 0.72, {
      volume: 0.045,
      frequency: 800 + (seed % 1200),
      q: 2.2,
      pan,
    })
  }

  const playCry = ({
    speciesId,
    originalSpeciesId,
    name,
    sideId,
    delay = 0,
    rate = 1,
    volume = 0.58,
  }) => {
    const audio = ensureContext()
    if (!audio || !enabled) return
    const cryIds = pokemonCryIds({ speciesId, originalSpeciesId })
    const requestedAt = audio.currentTime
    const scheduledAt = requestedAt + delay
    const playLoadedCry = (start) => {
      const buffer = cryIds.map((cryId) => cryBuffers.get(cryId)).find(Boolean)
      return playCryBuffer(buffer, start, sideId, { rate, volume })
    }

    if (playLoadedCry(scheduledAt)) return
    if (cryIds.length === 0 || cryIds.every((cryId) => failedCryIds.has(cryId))) {
      playSynthCry(name, sideId, delay, rate)
      return
    }

    Promise.all(cryIds.map(preloadCry)).then(() => {
      if (!context || context !== audio || !enabled || audio.currentTime - requestedAt > 1.6) return
      if (!playLoadedCry(Math.max(scheduledAt, audio.currentTime + 0.01))) {
        playSynthCry(name, sideId, Math.max(0, scheduledAt - audio.currentTime), rate)
      }
    })
  }

  const playMove = (cue) => {
    const audio = ensureContext()
    if (!audio || !enabled) return
    const now = audio.currentTime + 0.01
    const profile = getMoveSoundProfile(cue)
    const pan = sidePan(cue.sideId)
    const variation = 1 + ((profile.seed % 9) - 4) * 0.018
    const root = profile.root * variation
    const intensity = Math.max(1, profile.intensity ?? 1)
    const volumeBoost = 1 + (intensity - 1) * 0.12
    const effectOptions = { pan, volume: 0.15 * volumeBoost }
    const brightTexture = ['전기', '얼음', '강철', '페어리', '스텔라'].includes(profile.type)

    playSample(profile.launchSample, now + 0.012, {
      volume: (0.42 + intensity * 0.07) * volumeBoost,
      rate: profile.sampleRate,
      duration: profile.sampleDuration,
      pan,
    })
    if (profile.textureSample && profile.textureSample !== profile.launchSample) {
      playSample(profile.textureSample, now + profile.textureDelay, {
        volume: 0.24 + intensity * 0.035,
        rate: profile.textureRate,
        duration: profile.textureDuration,
        pan: -pan * 0.58,
        filter: {
          type: brightTexture ? 'highpass' : 'lowpass',
          frequency: brightTexture ? profile.highpass : profile.lowpass,
          q: 0.65,
        },
      })
    }
    profile.signatureFrequencies.forEach((frequency, index) => {
      tone(frequency, now + index * profile.signatureCadence, profile.signatureDuration, {
        volume: profile.signatureVolume,
        wave: profile.wave,
        pan: index % 2 === 0 ? pan : -pan * 0.5,
        filter: { frequency: profile.lowpass, q: 0.55 },
      })
    })
    for (let pulseIndex = 1; pulseIndex < profile.pulseCount; pulseIndex += 1) {
      playSample(profile.launchSample, now + 0.1 + pulseIndex * profile.pulseGap, {
        volume: Math.max(0.18, 0.36 - pulseIndex * 0.045),
        rate: profile.sampleRate * (1 + pulseIndex * 0.035),
        duration: Math.min(0.2, profile.sampleDuration),
        pan: pulseIndex % 2 === 0 ? pan : -pan * 0.7,
      })
    }

    if (['punch', 'kick', 'strike', 'dash', 'barrage', 'bite'].includes(profile.archetype)) {
      tone(root * 0.58, now, 0.16, { ...effectOptions, wave: 'sawtooth', slide: root * 1.9 })
      noise(now + 0.055, 0.13, { volume: 0.16 * volumeBoost, frequency: 640 + intensity * 180, pan })
      tone(92, now + 0.07, 0.13, { volume: 0.14 * volumeBoost, wave: 'square', slide: 48, pan: -pan })
      if (profile.archetype === 'barrage') {
        noise(now + 0.18, 0.1, { volume: 0.13, frequency: 1100, pan: -pan })
        noise(now + 0.3, 0.1, { volume: 0.12, frequency: 1350, pan })
      }
      return
    }

    if (['slash', 'whip', 'aerial', 'spin'].includes(profile.archetype)) {
      noise(now, 0.22, { volume: 0.13 * volumeBoost, frequency: 2600, q: 1.5, filterType: 'highpass', pan })
      tone(root * 0.8, now, 0.2, { ...effectOptions, wave: 'sawtooth', slide: root * 2.8 })
      tone(root * 2.4, now + 0.09, 0.12, { volume: 0.09, wave: 'triangle', slide: root * 0.95, pan: -pan })
      return
    }

    if (['explosion', 'eruption', 'quake', 'meteor'].includes(profile.archetype)) {
      tone(54 + intensity * 8, now, 0.48, { volume: 0.2, wave: 'sawtooth', slide: 34, pan })
      noise(now + 0.04, 0.42, { volume: 0.18 * volumeBoost, frequency: profile.archetype === 'quake' ? 190 : 520, q: 0.6, filterType: 'lowpass', pan })
      noise(now + 0.12, 0.25, { volume: 0.13, frequency: 1450, q: 0.8, pan: -pan })
      return
    }

    if (profile.archetype === 'lightning') {
      sequence([root * 2.4, root * 3.1, root * 1.8, root * 3.7], {
        step: 0.038,
        duration: 0.065,
        volume: 0.13 * volumeBoost,
        wave: 'square',
        pan,
      })
      noise(now + 0.06, 0.26, { volume: 0.15, frequency: 3600, q: 2.6, filterType: 'highpass', pan })
      tone(root, now + 0.11, 0.22, { volume: 0.14, wave: 'sawtooth', slide: root * 0.45, pan: -pan })
      return
    }

    if (['beam', 'stream', 'wave', 'pulse', 'orb', 'blast'].includes(profile.archetype)) {
      tone(root * 0.72, now, 0.38, { ...effectOptions, wave: 'sawtooth', slide: root * (2.1 + intensity * 0.3), filter: { frequency: 2400, q: 1.1 } })
      tone(root * 1.7, now + 0.07, 0.31, { volume: 0.105 * volumeBoost, wave: 'square', slide: root * 0.9, pan: -pan })
      noise(now + 0.09, 0.27, { volume: 0.08 * volumeBoost, frequency: profile.type === '물' ? 950 : 2100, q: 1.4, pan })
      return
    }

    if (['psychic', 'prism', 'spectral', 'crystal'].includes(profile.archetype)) {
      sequence([root, root * 1.25, root * 1.6, root * 2, root * 2.5], {
        step: 0.065,
        duration: 0.13,
        volume: 0.105 * volumeBoost,
        wave: profile.archetype === 'crystal' ? 'sine' : 'triangle',
        pan,
      })
      tone(root * 2.7, now + 0.15, 0.34, { volume: 0.1, wave: 'sine', slide: root * 1.15, pan: -pan })
      noise(now + 0.14, 0.22, { volume: 0.055, frequency: 3900, q: 3.1, filterType: 'highpass', pan })
      return
    }

    if (['sound'].includes(profile.archetype) || cue.moveFlags?.includes('sound')) {
      tone(root, now, 0.42, { volume: 0.145, wave: 'sine', slide: root * 1.5, pan })
      tone(root * 1.5, now + 0.035, 0.42, { volume: 0.115, wave: 'triangle', slide: root * 0.8, pan: -pan })
      sequence([root * 2, root * 1.75, root * 2.25], { step: 0.085, duration: 0.16, volume: 0.08, wave: 'sine', pan })
      return
    }

    if (cue.moveCategory === 'status' || ['barrier', 'boost', 'dance', 'restore', 'sleep', 'terrain', 'weather', 'hazard'].includes(profile.archetype)) {
      sequence([root, root * 1.25, root * 1.5, root * 2], {
        step: 0.075,
        duration: 0.12,
        volume: 0.115,
        wave: profile.archetype === 'sleep' ? 'sine' : 'triangle',
        pan,
      })
      if (profile.archetype === 'restore') tone(root * 2.5, now + 0.26, 0.3, { volume: 0.09, wave: 'sine', slide: root * 3.2, pan: -pan })
      return
    }

    if (['sludge', 'drain', 'leaves', 'web'].includes(profile.archetype)) {
      tone(root * 0.8, now, 0.31, { ...effectOptions, wave: 'triangle', slide: root * 1.55 })
      noise(now + 0.08, 0.25, { volume: 0.1, frequency: profile.archetype === 'sludge' ? 520 : 1350, q: 1.6, pan })
      return
    }

    tone(root, now, 0.32, { ...effectOptions, wave: cue.moveCategory === 'physical' ? 'sawtooth' : 'square', slide: root * 1.9 })
    noise(now + 0.09, 0.16, { volume: 0.11, frequency: 980, pan })
  }

  const playImpact = (cue) => {
    const audio = ensureContext()
    if (!audio || !enabled) return
    const now = audio.currentTime + 0.005
    const pan = sidePan(cue.targetSideId)
    const profile = getMoveSoundProfile(cue)
    const strength = cue.effectiveness >= 2 ? 1.25 : cue.effectiveness > 0 && cue.effectiveness < 1 ? 0.72 : 1
    if (cue.effectiveness === 0) {
      playSample('metal1', now, { volume: 0.28, rate: 1.24, duration: 0.2, pan })
      tone(220, now, 0.18, { volume: 0.1, wave: 'triangle', slide: 110, pan })
      return
    }
    const impactPulseCount = Math.min(4, Math.max(1, profile.pulseCount))
    for (let pulseIndex = 0; pulseIndex < impactPulseCount; pulseIndex += 1) {
      playSample(profile.impactSample, now + pulseIndex * profile.pulseGap, {
        volume: Math.max(0.2, (0.48 - pulseIndex * 0.055) * strength),
        rate: profile.impactRate * (cue.effectiveness >= 2 ? 0.92 : cue.effectiveness < 1 ? 1.12 : 1) * (1 + pulseIndex * 0.025),
        duration: Math.min(profile.impactDuration, impactPulseCount > 1 ? 0.24 : profile.impactDuration),
        pan: pulseIndex % 2 === 0 ? pan : -pan * 0.52,
      })
    }
    if (cue.critical || cue.effectiveness >= 2) {
      playSample('hurt', now + 0.035, { volume: cue.critical ? 0.42 : 0.28, rate: cue.critical ? 0.86 : 1.08, pan })
    }
    noise(now, 0.17, { volume: 0.2 * strength, frequency: 720 * strength, q: 0.8, pan })
    tone(profile.root * 0.55 * strength, now, 0.17, { volume: 0.14, slide: profile.root * 0.24, wave: profile.wave, pan })
    if (cue.effectiveness >= 2) tone(1047, now + 0.045, 0.14, { volume: 0.105, wave: 'square', slide: 1568, pan: -pan })
    if (cue.critical) tone(880, now + 0.04, 0.18, { volume: 0.13, slide: 1760, pan: -pan })
  }

  const duckMusicForGimmick = (now, duration) => {
    if (!musicGain) return
    const restoredVolume = lowHpActive ? LOW_HP_MUSIC_VOLUME : BATTLE_MUSIC_VOLUME
    musicGain.gain.cancelScheduledValues(now)
    musicGain.gain.setTargetAtTime(0.018, now, 0.035)
    musicGain.gain.setTargetAtTime(restoredVolume, now + duration * 0.78, 0.11)
  }

  const playGimmick = (cue) => {
    const audio = ensureContext()
    if (!audio || !enabled) return
    const now = audio.currentTime + 0.01

    if (cue.mechanicId === 'mega') {
      duckMusicForGimmick(now, 3)
      playSample('item', now + 0.12, { volume: 0.52, rate: 0.9, pan: sidePan(cue.sideId) })
      tone(98, now, 0.92, { volume: 0.13, slide: 392, wave: 'sawtooth' })
      sequence([262, 330, 392, 523, 659, 784, 1047], {
        delay: 0.12,
        step: 0.12,
        duration: 0.17,
        volume: 0.11,
        wave: 'triangle',
      })
      noise(now + 0.9, 0.42, { volume: 0.11, frequency: 1800, q: 2.4 })
      tone(1047, now + 1.16, 0.62, { volume: 0.14, slide: 2093, wave: 'sine' })
      tone(523, now + 1.3, 0.56, { volume: 0.11, slide: 1047, wave: 'square' })
      sequence([784, 1047, 1319, 1568, 2093], {
        delay: 1.62,
        step: 0.11,
        duration: 0.2,
        volume: 0.1,
        wave: 'sine',
      })
      noise(now + 2.14, 0.36, { volume: 0.1, frequency: 2600, q: 2.8 })
      return
    }

    if (cue.mechanicId === 'zmove') {
      duckMusicForGimmick(now, 2.7)
      playSample('item', now + 0.08, { volume: 0.55, rate: 1.15, pan: sidePan(cue.sideId) })
      sequence([196, 247, 294, 392], {
        step: 0.09,
        duration: 0.12,
        volume: 0.13,
        wave: 'square',
      })
      sequence([523, 659, 784, 988], {
        delay: 0.42,
        step: 0.085,
        duration: 0.13,
        volume: 0.12,
        wave: 'triangle',
      })
      tone(130, now + 0.62, 0.82, { volume: 0.16, slide: 1047, wave: 'sawtooth' })
      noise(now + 0.92, 0.38, { volume: 0.13, frequency: 1400, q: 1.8 })
      tone(1568, now + 1.08, 0.34, { volume: 0.13, slide: 784, wave: 'sine' })
      sequence([392, 523, 659, 784, 988, 1319], {
        delay: 1.34,
        step: 0.095,
        duration: 0.16,
        volume: 0.11,
        wave: 'square',
      })
      tone(196, now + 1.88, 0.48, { volume: 0.14, slide: 1568, wave: 'sawtooth' })
      return
    }

    if (cue.mechanicId === 'dynamax') {
      duckMusicForGimmick(now, 3.3)
      playSample('explosionHeavy', now + 1.28, { volume: 0.6, rate: 0.62, pan: sidePan(cue.sideId), filter: { type: 'lowpass', frequency: 1700 } })
      tone(48, now, 1.85, { volume: 0.2, slide: 92, wave: 'sawtooth' })
      tone(73, now + 0.12, 1.6, { volume: 0.14, slide: 147, wave: 'triangle' })
      noise(now + 0.08, 1.62, { volume: 0.12, frequency: 210, q: 0.7, filterType: 'lowpass' })
      sequence([110, 147, 196], {
        delay: 0.72,
        step: 0.24,
        duration: 0.3,
        volume: 0.15,
        wave: 'square',
      })
      tone(55, now + 1.35, 0.88, { volume: 0.2, slide: 220, wave: 'sawtooth' })
      noise(now + 1.42, 0.64, { volume: 0.15, frequency: 520, q: 0.9 })
      tone(92, now + 2.02, 0.72, { volume: 0.18, slide: 294, wave: 'sawtooth' })
      noise(now + 2.08, 0.56, { volume: 0.13, frequency: 760, q: 0.8 })
      sequence([147, 196, 294], {
        delay: 2.3,
        step: 0.18,
        duration: 0.26,
        volume: 0.12,
        wave: 'square',
      })
      return
    }

    if (cue.mechanicId === 'tera') {
      duckMusicForGimmick(now, 3.05)
      playSample('item', now + 0.48, { volume: 0.52, rate: 1.34, pan: sidePan(cue.sideId) })
      sequence([523, 659, 784, 988, 1175, 1568], {
        step: 0.105,
        duration: 0.18,
        volume: 0.105,
        wave: 'sine',
      })
      sequence([784, 1047, 1319, 2093], {
        delay: 0.54,
        step: 0.09,
        duration: 0.22,
        volume: 0.1,
        wave: 'triangle',
      })
      noise(now + 0.58, 0.58, { volume: 0.075, frequency: 3600, q: 3.2, filterType: 'highpass' })
      tone(2093, now + 0.9, 0.5, { volume: 0.12, slide: 1047, wave: 'sine' })
      sequence([659, 988, 1319, 1760, 2349], {
        delay: 1.34,
        step: 0.12,
        duration: 0.22,
        volume: 0.1,
        wave: 'sine',
      })
      noise(now + 1.7, 0.62, { volume: 0.07, frequency: 4200, q: 3.6, filterType: 'highpass' })
      tone(2637, now + 2.08, 0.34, { volume: 0.1, slide: 1319, wave: 'triangle' })
      return
    }

    if (cue.mechanicId === 'primal') {
      duckMusicForGimmick(now, 2.35)
      playSample('explosion', now + 0.42, { volume: 0.58, rate: 0.72, pan: sidePan(cue.sideId), filter: { type: 'lowpass', frequency: 1900 } })
      tone(65, now, 1.05, { volume: 0.19, slide: 196, wave: 'sawtooth' })
      tone(78, now + 0.08, 1.05, { volume: 0.16, slide: 233, wave: 'triangle' })
      noise(now + 0.16, 0.82, { volume: 0.13, frequency: 340, q: 0.8 })
      sequence([196, 262, 330, 392, 523], {
        delay: 0.58,
        step: 0.13,
        duration: 0.2,
        volume: 0.12,
        wave: 'square',
      })
      tone(1047, now + 1.12, 0.42, { volume: 0.12, slide: 523, wave: 'sine' })
      return
    }

    sequence([262, 330, 392, 523, 659, 784], { step: 0.09, duration: 0.13, volume: 0.13 })
  }

  const playCue = (cue) => {
    if (!cue || cue.id === lastCueId) return
    lastCueId = cue.id
    const audio = ensureContext()
    if (!audio || !enabled) return
    const now = audio.currentTime + 0.01

    if (cue.phase === 'gimmick') {
      playGimmick(cue)
      if (cue.mechanicId !== 'zmove') {
        playCry({
          speciesId: cue.actorSpeciesId,
          originalSpeciesId: cue.actorOriginalSpeciesId,
          name: cue.actorName,
          sideId: cue.sideId,
          delay: cue.mechanicId === 'dynamax' ? 1.45 : 1.05,
          rate: cue.mechanicId === 'dynamax' ? 0.78 : 0.96,
          volume: cue.mechanicId === 'dynamax' ? 0.68 : 0.54,
        })
      }
    } else if (cue.phase === 'announce') {
      const pan = sidePan(cue.sideId)
      const profile = getMoveSoundProfile(cue)
      const firstNote = profile.signatureFrequencies[0] ?? profile.root
      const secondNote = profile.signatureFrequencies[1] ?? profile.root * 1.5
      tone(firstNote, now, 0.055, { volume: 0.085, wave: profile.wave, pan })
      tone(secondNote, now + 0.045, 0.07, { volume: 0.065, wave: profile.wave, pan: -pan })
    } else if (cue.phase === 'attack') {
      playMove(cue)
    } else if (cue.phase === 'impact') {
      playImpact(cue)
    } else if (cue.phase === 'resolve') {
      const pan = sidePan(cue.targetSideId)
      if (cue.result === 'miss') sequence([392, 330, 262], { step: 0.07, duration: 0.09, volume: 0.1, pan })
      if (cue.result === 'blocked') {
        tone(880, now, 0.15, { volume: 0.13, wave: 'triangle', slide: 440, pan })
        noise(now, 0.14, { volume: 0.12, frequency: 2200, pan })
      }
      if (cue.result === 'immune') sequence([330, 247, 165], { step: 0.08, duration: 0.11, volume: 0.1, wave: 'triangle', pan })
    } else if (cue.phase === 'status' || cue.phase === 'residual') {
      const pan = sidePan(cue.targetSideId ?? cue.sideId)
      if (cue.result === 'charging') {
        const profile = getMoveSoundProfile(cue)
        playSample(profile.textureSample, now + 0.02, {
          volume: 0.34,
          rate: profile.textureRate * 0.82,
          duration: Math.min(0.78, profile.textureDuration + 0.18),
          pan,
        })
        tone(profile.root * 0.55, now, 0.52, { volume: 0.14, wave: profile.wave, slide: profile.root * 2.2, pan })
        sequence(profile.signatureFrequencies.slice(0, 3), { delay: 0.14, step: 0.11, duration: 0.15, volume: 0.1, wave: profile.wave, pan })
      } else if (cue.phase === 'residual') {
        tone(174, now, 0.22, { volume: 0.115, wave: 'sawtooth', slide: 98, pan })
        noise(now + 0.04, 0.16, { volume: 0.08, frequency: 540, q: 1.4, pan })
      } else {
        sequence([220, 196, 174], { step: 0.1, duration: 0.13, volume: 0.1, wave: 'triangle', pan })
      }
    } else if (cue.phase === 'switch-out') {
      const pan = sidePan(cue.sideId)
      playSample('item', now, { volume: 0.42, rate: 0.72, pan })
      tone(1047, now, 0.36, { volume: 0.16, slide: 110, wave: 'sine', pan })
      noise(now + 0.04, 0.22, { volume: 0.09, frequency: 1800, pan })
    } else if (cue.phase === 'switch') {
      const pan = sidePan(cue.sideId)
      playSample('item', now + 0.035, { volume: 0.55, rate: 1.08, pan })
      tone(165, now, 0.34, { volume: 0.16, slide: 990, wave: 'sine', pan })
      noise(now + 0.04, 0.16, { volume: 0.075, frequency: 2400, q: 2, pan })
      sequence([523, 659, 784], { delay: 0.2, step: 0.06, duration: 0.085, volume: 0.09, pan })
      playCry({
        speciesId: cue.actorSpeciesId,
        originalSpeciesId: cue.actorOriginalSpeciesId,
        name: cue.actorName,
        sideId: cue.sideId,
        delay: 0.32,
        volume: 0.6,
      })
    } else if (cue.phase === 'faint') {
      const faintedSideId = cue.targetSideId ?? cue.sideId
      const pan = sidePan(faintedSideId)
      playSample('hurt', now, { volume: 0.36, rate: 0.68, pan })
      playCry({
        speciesId: cue.actorSpeciesId,
        originalSpeciesId: cue.actorOriginalSpeciesId,
        name: cue.actorName,
        sideId: faintedSideId,
        rate: 0.72,
        volume: 0.52,
      })
      sequence([392, 330, 262, 196, 147, 110], { delay: 0.12, step: 0.105, duration: 0.15, volume: 0.135, wave: 'square', pan })
    } else if (cue.phase === 'prompt') {
      sequence([392, 523], { step: 0.1, duration: 0.13, volume: 0.115 })
    } else if (cue.phase === 'result') {
      battleStarted = false
      stopMusic(true)
      const victory = cue.sideId === 'player'
      sequence(victory
        ? [262, 330, 392, 523, 659, 784, 1047]
        : [392, 349, 294, 247, 196, 147, 110], {
        step: 0.145,
        duration: 0.22,
        volume: 0.17,
        wave: victory ? 'square' : 'triangle',
      })
    }
  }

  const start = (encounter = {}) => {
    battleStarted = true
    const audio = ensureContext()
    if (!audio || !enabled) return
    preload([encounter.player, encounter.opponent])
    stopMusic(true)
    sequence([196, 262, 330, 392, 523, 659], { step: 0.075, duration: 0.115, volume: 0.145 })
    playSample('select', audio.currentTime + 0.02, { volume: 0.62 })
    noise(audio.currentTime + 0.08, 0.22, { volume: 0.085, frequency: 1900, filterType: 'highpass' })
    playCry({ ...encounter.opponent, sideId: 'opponent', delay: 0.48, volume: 0.62 })
    playCry({ ...encounter.player, sideId: 'player', delay: 0.86, volume: 0.62 })
    window.setTimeout(startMusic, 760)
  }

  const setEnabled = (nextEnabled) => {
    enabled = Boolean(nextEnabled)
    const audio = enabled ? ensureContext() : context
    if (audio && masterGain) {
      masterGain.gain.cancelScheduledValues(audio.currentTime)
      masterGain.gain.setTargetAtTime(enabled ? BATTLE_MASTER_VOLUME : 0, audio.currentTime, 0.015)
    }
    if (enabled && battleStarted) {
      startMusic()
      startLowHpWarning()
    }
    if (!enabled) {
      stopMusic()
      stopLowHpWarning()
    }
  }

  const setLowHpWarning = (active) => {
    lowHpActive = Boolean(active)
    const audio = context
    if (audio && musicGain) {
      musicGain.gain.cancelScheduledValues(audio.currentTime)
      musicGain.gain.setTargetAtTime(lowHpActive ? LOW_HP_MUSIC_VOLUME : BATTLE_MUSIC_VOLUME, audio.currentTime, 0.05)
    }
    if (lowHpActive) startLowHpWarning()
    else stopLowHpWarning()
  }

  const destroy = () => {
    battleStarted = false
    stopMusic(true)
    stopLowHpWarning()
    if (context && context.state !== 'closed') context.close().catch(() => {})
    context = null
    compressor = null
    musicElement = null
    musicSource = null
    sampleBuffers.clear()
    cryBuffers.clear()
    cryLoadPromises.clear()
    failedCryIds.clear()
    sampleLoadPromise = null
  }

  return {
    destroy,
    preload,
    playCue,
    playMenu,
    setEnabled,
    setLowHpWarning,
    start,
  }
}
