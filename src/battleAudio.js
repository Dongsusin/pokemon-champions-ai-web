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

function audioContextConstructor() {
  if (typeof window === 'undefined') return null
  return window.AudioContext ?? window.webkitAudioContext ?? null
}

export function createBattleAudio(initialEnabled = true) {
  let context = null
  let masterGain = null
  let effectsGain = null
  let musicGain = null
  let musicTimer = null
  let lowHpTimer = null
  let musicPatternIndex = 0
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
    masterGain.gain.value = enabled ? 0.72 : 0
    effectsGain.gain.value = 0.24
    musicGain.gain.value = 0.085
    effectsGain.connect(masterGain)
    musicGain.connect(masterGain)
    masterGain.connect(context.destination)
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
    oscillator.connect(gain)
    gain.connect(output)
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
    gain.connect(effectsGain)
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
    const notes = MUSIC_PATTERN[musicPatternIndex % MUSIC_PATTERN.length]
    const start = audio.currentTime + 0.05
    const step = 0.19

    notes.forEach((frequency, index) => {
      tone(frequency, start + index * step, 0.12, {
        music: true,
        volume: index % 4 === 0 ? 0.18 : 0.12,
        wave: 'square',
      })
      if (index % 2 === 0) {
        tone(frequency / 2, start + index * step, 0.15, {
          music: true,
          volume: 0.1,
          wave: 'triangle',
        })
      }
    })

    musicPatternIndex += 1
  }

  const startMusic = () => {
    if (musicTimer || !battleStarted || !enabled) return
    scheduleMusicPattern()
    musicTimer = window.setInterval(scheduleMusicPattern, 1520)
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

  const playMove = (cue) => {
    const audio = ensureContext()
    if (!audio || !enabled) return
    const now = audio.currentTime + 0.01
    const root = TYPE_FREQUENCIES[cue.moveType] ?? 220

    if (cue.moveCategory === 'physical') {
      tone(root * 0.72, now, 0.18, { volume: 0.21, slide: root * 1.7, wave: 'sawtooth' })
      noise(now + 0.09, 0.14, { volume: 0.16, frequency: 680 })
      return
    }
    if (cue.moveCategory === 'status') {
      sequence([root, root * 1.25, root * 1.5, root * 2], {
        step: 0.075,
        duration: 0.1,
        volume: 0.11,
        wave: 'triangle',
      })
      return
    }

    tone(root, now, 0.36, { volume: 0.16, slide: root * 2.2, wave: 'sawtooth' })
    tone(root * 1.5, now + 0.08, 0.3, { volume: 0.11, slide: root * 0.9, wave: 'square' })
  }

  const playImpact = (cue) => {
    const audio = ensureContext()
    if (!audio || !enabled) return
    const now = audio.currentTime + 0.005
    const strength = cue.effectiveness >= 2 ? 1.25 : cue.effectiveness > 0 && cue.effectiveness < 1 ? 0.72 : 1
    noise(now, 0.16, { volume: 0.2 * strength, frequency: 720 * strength, q: 0.8 })
    tone(120 * strength, now, 0.16, { volume: 0.17, slide: 58, wave: 'square' })
    if (cue.critical) tone(880, now + 0.04, 0.16, { volume: 0.12, slide: 1760 })
  }

  const duckMusicForGimmick = (now, duration) => {
    if (!musicGain) return
    const restoredVolume = lowHpActive ? 0.058 : 0.085
    musicGain.gain.cancelScheduledValues(now)
    musicGain.gain.setTargetAtTime(0.018, now, 0.035)
    musicGain.gain.setTargetAtTime(restoredVolume, now + duration * 0.78, 0.11)
  }

  const playGimmick = (cue) => {
    const audio = ensureContext()
    if (!audio || !enabled) return
    const now = audio.currentTime + 0.01

    if (cue.mechanicId === 'mega') {
      duckMusicForGimmick(now, 2.3)
      tone(98, now, 0.72, { volume: 0.13, slide: 392, wave: 'sawtooth' })
      sequence([262, 330, 392, 523, 659, 784, 1047], {
        delay: 0.12,
        step: 0.12,
        duration: 0.17,
        volume: 0.11,
        wave: 'triangle',
      })
      noise(now + 0.78, 0.34, { volume: 0.11, frequency: 1800, q: 2.4 })
      tone(1047, now + 0.96, 0.52, { volume: 0.14, slide: 2093, wave: 'sine' })
      tone(523, now + 1.08, 0.48, { volume: 0.11, slide: 1047, wave: 'square' })
      return
    }

    if (cue.mechanicId === 'zmove') {
      duckMusicForGimmick(now, 1.95)
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
      tone(130, now + 0.62, 0.62, { volume: 0.16, slide: 1047, wave: 'sawtooth' })
      noise(now + 0.9, 0.3, { volume: 0.13, frequency: 1400, q: 1.8 })
      tone(1568, now + 1.02, 0.26, { volume: 0.13, slide: 784, wave: 'sine' })
      return
    }

    if (cue.mechanicId === 'dynamax') {
      duckMusicForGimmick(now, 2.45)
      tone(48, now, 1.45, { volume: 0.2, slide: 92, wave: 'sawtooth' })
      tone(73, now + 0.12, 1.2, { volume: 0.14, slide: 147, wave: 'triangle' })
      noise(now + 0.08, 1.24, { volume: 0.12, frequency: 210, q: 0.7, filterType: 'lowpass' })
      sequence([110, 147, 196], {
        delay: 0.72,
        step: 0.24,
        duration: 0.3,
        volume: 0.15,
        wave: 'square',
      })
      tone(55, now + 1.22, 0.62, { volume: 0.2, slide: 220, wave: 'sawtooth' })
      noise(now + 1.28, 0.48, { volume: 0.15, frequency: 520, q: 0.9 })
      return
    }

    if (cue.mechanicId === 'tera') {
      duckMusicForGimmick(now, 2.2)
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
      noise(now + 0.58, 0.5, { volume: 0.075, frequency: 3600, q: 3.2, filterType: 'highpass' })
      tone(2093, now + 0.9, 0.42, { volume: 0.12, slide: 1047, wave: 'sine' })
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
      tone(cue.sideId === 'player' ? 523 : 392, now, 0.055, { volume: 0.1 })
    } else if (cue.phase === 'attack') {
      playMove(cue)
    } else if (cue.phase === 'impact') {
      playImpact(cue)
    } else if (cue.phase === 'resolve') {
      if (cue.result === 'miss') sequence([330, 294, 262], { step: 0.07, duration: 0.08, volume: 0.09 })
      if (cue.result === 'blocked') noise(now, 0.12, { volume: 0.11, frequency: 1700 })
    } else if (cue.phase === 'status' || cue.phase === 'residual') {
      sequence([196, 185, 174], { step: 0.1, duration: 0.12, volume: 0.09, wave: 'triangle' })
    } else if (cue.phase === 'switch-out') {
      tone(880, now, 0.34, { volume: 0.15, slide: 110, wave: 'sine' })
      noise(now + 0.04, 0.2, { volume: 0.08, frequency: 1500 })
    } else if (cue.phase === 'switch') {
      tone(165, now, 0.32, { volume: 0.15, slide: 990, wave: 'sine' })
      sequence([523, 659, 784], { delay: 0.2, step: 0.06, duration: 0.08, volume: 0.08 })
    } else if (cue.phase === 'faint') {
      sequence([392, 330, 262, 196, 147], { step: 0.12, duration: 0.15, volume: 0.13, wave: 'square' })
    } else if (cue.phase === 'prompt') {
      sequence([330, 440], { step: 0.1, duration: 0.12, volume: 0.1 })
    } else if (cue.phase === 'result') {
      stopMusic()
      const victory = cue.sideId === 'player'
      sequence(victory ? [262, 330, 392, 523, 659] : [330, 294, 247, 196, 147], {
        step: 0.16,
        duration: 0.2,
        volume: 0.16,
      })
    }
  }

  const start = () => {
    battleStarted = true
    const audio = ensureContext()
    if (!audio || !enabled) return
    sequence([196, 262, 330, 392, 523], { step: 0.085, duration: 0.11, volume: 0.13 })
    window.setTimeout(startMusic, 520)
  }

  const setEnabled = (nextEnabled) => {
    enabled = Boolean(nextEnabled)
    const audio = enabled ? ensureContext() : context
    if (audio && masterGain) {
      masterGain.gain.cancelScheduledValues(audio.currentTime)
      masterGain.gain.setTargetAtTime(enabled ? 0.72 : 0, audio.currentTime, 0.015)
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
      musicGain.gain.setTargetAtTime(lowHpActive ? 0.058 : 0.085, audio.currentTime, 0.05)
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
