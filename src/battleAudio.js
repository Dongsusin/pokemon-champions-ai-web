import { getMoveAnimationProfile } from './data/moveAnimationData'

const TYPE_FREQUENCIES = {
  노말: 220,
  불꽃: 277,
  물: 196,
  전기: 370,
  풀: 247,
  얼음: 330,
  격투: 165,
  독: 185,
  땅: 147,
  비행: 294,
  에스퍼: 349,
  벌레: 208,
  바위: 131,
  고스트: 175,
  드래곤: 233,
  악: 156,
  강철: 262,
  페어리: 392,
}

const MUSIC_PATTERN = [
  [196, 247, 294, 392, 294, 247, 220, 277],
  [174, 220, 262, 349, 262, 220, 196, 247],
  [147, 196, 247, 294, 247, 196, 165, 220],
  [165, 208, 262, 330, 294, 247, 208, 247],
]

const BATTLE_MASTER_VOLUME = 0.96
const BATTLE_EFFECTS_VOLUME = 0.46
const BATTLE_MUSIC_VOLUME = 0.145
const LOW_HP_MUSIC_VOLUME = 0.105

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
  let musicTimer = null
  let lowHpTimer = null
  let musicPatternIndex = 0
  let nextMusicPatternTime = 0
  let enabled = Boolean(initialEnabled)
  let battleStarted = false
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
    return context
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

  const sequence = (notes, options = {}) => {
    const audio = ensureContext()
    if (!audio || !enabled) return
    const start = audio.currentTime + (options.delay ?? 0.01)
    const step = options.step ?? 0.085
    notes.forEach((frequency, index) => {
      tone(frequency, start + index * step, options.duration ?? step * 0.82, options)
    })
  }

  const scheduleMusicPattern = () => {
    if (!battleStarted || !enabled) return
    const audio = ensureContext()
    if (!audio) return
    if (nextMusicPatternTime > audio.currentTime + 0.42) return
    const notes = MUSIC_PATTERN[musicPatternIndex % MUSIC_PATTERN.length]
    const start = Math.max(audio.currentTime + 0.035, nextMusicPatternTime)
    const step = 0.19

    notes.forEach((frequency, index) => {
      tone(frequency, start + index * step, 0.12, {
        music: true,
        volume: index % 4 === 0 ? 0.17 : 0.115,
        wave: 'square',
        pan: index % 2 === 0 ? -0.13 : 0.13,
        filter: { frequency: 2500, q: 0.45 },
      })
      if (index % 2 === 0) {
        tone(frequency / 2, start + index * step, 0.15, {
          music: true,
          volume: 0.115,
          wave: 'triangle',
          pan: -0.2,
          filter: { frequency: 620, q: 0.5 },
        })
      }
      if (index % 4 === 0) {
        tone(72, start + index * step, 0.1, {
          music: true,
          volume: 0.15,
          wave: 'sine',
          slide: 42,
        })
      } else if (index % 4 === 2) {
        noise(start + index * step, 0.075, {
          music: true,
          volume: 0.07,
          frequency: 1900,
          filterType: 'highpass',
          pan: 0.18,
        })
      }
      if (index % 4 === 3) {
        tone(frequency * 1.5, start + index * step + 0.055, 0.07, {
          music: true,
          volume: 0.045,
          wave: 'square',
          pan: 0.3,
        })
      }
    })

    musicPatternIndex += 1
    nextMusicPatternTime = start + notes.length * step
  }

  const startMusic = () => {
    if (musicTimer || !battleStarted || !enabled) return
    const audio = ensureContext()
    if (!audio) return
    nextMusicPatternTime = audio.currentTime + 0.05
    scheduleMusicPattern()
    musicTimer = window.setInterval(scheduleMusicPattern, 160)
  }

  const stopMusic = () => {
    if (!musicTimer) return
    window.clearInterval(musicTimer)
    musicTimer = null
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
      tone(330, now, 0.05, { volume: 0.12 })
      tone(220, now + 0.055, 0.07, { volume: 0.11 })
      return
    }
    if (kind === 'cursor') {
      tone(392, now, 0.035, { volume: 0.09 })
      return
    }
    tone(440, now, 0.045, { volume: 0.12 })
    tone(660, now + 0.045, 0.065, { volume: 0.1 })
  }

  const sidePan = (sideId) => sideId === 'player' ? -0.32 : 0.32

  const hashName = (value = '') => [...String(value)].reduce(
    (hash, character) => ((hash << 5) - hash + character.charCodeAt(0)) | 0,
    0,
  )

  const playCry = (name, sideId, delay = 0) => {
    const audio = ensureContext()
    if (!audio || !enabled || !name) return
    const seed = Math.abs(hashName(name))
    const start = audio.currentTime + delay
    const pan = sidePan(sideId)
    const root = 145 + (seed % 170)
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

  const playMove = (cue) => {
    const audio = ensureContext()
    if (!audio || !enabled) return
    const now = audio.currentTime + 0.01
    const profile = getMoveAnimationProfile(cue)
    const pan = sidePan(cue.sideId)
    const variation = 1 + ((profile.seed % 9) - 4) * 0.018
    const root = (TYPE_FREQUENCIES[profile.type] ?? 220) * variation
    const intensity = Math.max(1, profile.intensity ?? 1)
    const volumeBoost = 1 + (intensity - 1) * 0.12
    const effectOptions = { pan, volume: 0.15 * volumeBoost }

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
    const strength = cue.effectiveness >= 2 ? 1.25 : cue.effectiveness > 0 && cue.effectiveness < 1 ? 0.72 : 1
    noise(now, 0.17, { volume: 0.2 * strength, frequency: 720 * strength, q: 0.8, pan })
    tone(120 * strength, now, 0.17, { volume: 0.18, slide: 58, wave: 'square', pan })
    if (cue.effectiveness === 0) {
      tone(220, now, 0.18, { volume: 0.1, wave: 'triangle', slide: 110, pan })
      return
    }
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
    } else if (cue.phase === 'announce') {
      const pan = sidePan(cue.sideId)
      const root = TYPE_FREQUENCIES[cue.moveType] ?? (cue.sideId === 'player' ? 523 : 392)
      tone(root * 1.5, now, 0.055, { volume: 0.11, pan })
      tone(root * 2, now + 0.045, 0.07, { volume: 0.085, pan: -pan })
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
        const root = TYPE_FREQUENCIES[cue.moveType] ?? 196
        tone(root * 0.55, now, 0.52, { volume: 0.14, wave: 'sawtooth', slide: root * 2.2, pan })
        sequence([root, root * 1.25, root * 1.5], { delay: 0.14, step: 0.11, duration: 0.15, volume: 0.1, wave: 'triangle', pan })
      } else if (cue.phase === 'residual') {
        tone(174, now, 0.22, { volume: 0.115, wave: 'sawtooth', slide: 98, pan })
        noise(now + 0.04, 0.16, { volume: 0.08, frequency: 540, q: 1.4, pan })
      } else {
        sequence([220, 196, 174], { step: 0.1, duration: 0.13, volume: 0.1, wave: 'triangle', pan })
      }
    } else if (cue.phase === 'switch-out') {
      const pan = sidePan(cue.sideId)
      tone(1047, now, 0.36, { volume: 0.16, slide: 110, wave: 'sine', pan })
      noise(now + 0.04, 0.22, { volume: 0.09, frequency: 1800, pan })
    } else if (cue.phase === 'switch') {
      const pan = sidePan(cue.sideId)
      tone(165, now, 0.34, { volume: 0.16, slide: 990, wave: 'sine', pan })
      noise(now + 0.04, 0.16, { volume: 0.075, frequency: 2400, q: 2, pan })
      sequence([523, 659, 784], { delay: 0.2, step: 0.06, duration: 0.085, volume: 0.09, pan })
      playCry(cue.actorName, cue.sideId, 0.32)
    } else if (cue.phase === 'faint') {
      const pan = sidePan(cue.sideId)
      playCry(cue.actorName, cue.sideId)
      sequence([392, 330, 262, 196, 147, 110], { delay: 0.12, step: 0.105, duration: 0.15, volume: 0.135, wave: 'square', pan })
    } else if (cue.phase === 'prompt') {
      sequence([392, 523], { step: 0.1, duration: 0.13, volume: 0.115 })
    } else if (cue.phase === 'result') {
      stopMusic()
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
    sequence([196, 262, 330, 392, 523, 659], { step: 0.075, duration: 0.115, volume: 0.145 })
    noise(audio.currentTime + 0.08, 0.22, { volume: 0.085, frequency: 1900, filterType: 'highpass' })
    playCry(encounter.opponent?.name, 'opponent', 0.48)
    playCry(encounter.player?.name, 'player', 0.86)
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
    stopMusic()
    stopLowHpWarning()
    if (context && context.state !== 'closed') context.close().catch(() => {})
    context = null
    compressor = null
  }

  return {
    destroy,
    playCue,
    playMenu,
    setEnabled,
    setLowHpWarning,
    start,
  }
}
