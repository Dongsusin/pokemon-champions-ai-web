import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Original, reproducible battle effects: no recordings, sound fonts, or dependencies.
// Layered chip voices and filtered noise give every type a recognizable short motif.
const SAMPLE_RATE = 22050
const OUTPUT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/assets/audio/battle/retro')
const TAU = Math.PI * 2

const tone = (frequency, start, duration, options = {}) => ({ frequency, start, duration, ...options })
const noise = (start, duration, options = {}) => ({ noise: true, start, duration, ...options })
const notes = (frequencies, step, duration, options = {}) => frequencies.map((frequency, index) => tone(frequency, index * step, duration, options))

const RECIPES = {
  'retro-normal': [tone(230, 0, 0.2, { to: 78, wave: 'square' }), noise(0.025, 0.14, { cutoff: 1400, volume: 0.4 })],
  'retro-fire': [noise(0, 0.46, { cutoff: 1900, volume: 0.58 }), tone(145, 0, 0.37, { to: 390, wave: 'saw', volume: 0.22 }), tone(460, 0.07, 0.24, { to: 170, tremolo: 29, volume: 0.16 })],
  'retro-water': [tone(780, 0, 0.13, { to: 260 }), tone(950, 0.08, 0.15, { to: 340 }), tone(1100, 0.18, 0.17, { to: 390 }), noise(0.03, 0.35, { cutoff: 800, volume: 0.28 })],
  'retro-electric': [...notes([590, 1180, 790, 1580, 590, 1180], 0.048, 0.075, { wave: 'square', volume: 0.23 }), noise(0.02, 0.3, { cutoff: 4800, highpass: true, volume: 0.28, tremolo: 47 })],
  'retro-grass': [...notes([330, 440, 660, 880], 0.07, 0.12, { wave: 'triangle', volume: 0.35 }), noise(0.025, 0.32, { cutoff: 2100, highpass: true, volume: 0.19 })],
  'retro-ice': [...notes([1047, 1568, 2093, 1319], 0.07, 0.19, { volume: 0.27 }), noise(0.015, 0.21, { cutoff: 3200, highpass: true, volume: 0.24 })],
  'retro-fighting': [tone(210, 0, 0.12, { to: 52, wave: 'square', volume: 0.4 }), noise(0.025, 0.08, { cutoff: 1400, volume: 0.4 }), tone(170, 0.17, 0.14, { to: 44, wave: 'triangle', volume: 0.5 }), noise(0.175, 0.11, { cutoff: 1700, volume: 0.35 })],
  'retro-poison': [tone(240, 0, 0.21, { to: 130, vibrato: 19, vibratoDepth: 0.09 }), tone(370, 0.12, 0.22, { to: 180, vibrato: 16, vibratoDepth: 0.1 }), noise(0.06, 0.29, { cutoff: 540, volume: 0.3 })],
  'retro-ground': [tone(100, 0, 0.45, { to: 38, wave: 'triangle', volume: 0.5 }), noise(0.02, 0.4, { cutoff: 370, volume: 0.6, tremolo: 17 }), tone(150, 0.12, 0.22, { to: 45, volume: 0.2 })],
  'retro-flying': [noise(0, 0.36, { cutoff: 1700, highpass: true, volume: 0.45 }), tone(280, 0.025, 0.3, { to: 1260, wave: 'triangle', volume: 0.23 })],
  'retro-psychic': [...notes([349, 494, 698, 988], 0.075, 0.24, { vibrato: 11, vibratoDepth: 0.025, volume: 0.23 }), tone(370, 0.1, 0.35, { to: 740, volume: 0.15 })],
  'retro-bug': [tone(240, 0, 0.3, { to: 380, wave: 'saw', tremolo: 42, volume: 0.32 }), tone(490, 0.05, 0.29, { to: 740, wave: 'triangle', tremolo: 36, volume: 0.22 }), noise(0.03, 0.29, { cutoff: 2800, highpass: true, tremolo: 38, volume: 0.15 })],
  'retro-rock': [noise(0, 0.16, { cutoff: 950, volume: 0.6 }), tone(160, 0, 0.2, { to: 50, wave: 'square', volume: 0.32 }), noise(0.16, 0.2, { cutoff: 1600, volume: 0.42 }), tone(120, 0.16, 0.2, { to: 40, volume: 0.3 })],
  'retro-ghost': [tone(175, 0, 0.47, { to: 440, vibrato: 7, vibratoDepth: 0.05, volume: 0.3 }), tone(360, 0.05, 0.42, { to: 120, vibrato: 9, vibratoDepth: 0.035, volume: 0.24 }), noise(0.04, 0.38, { cutoff: 900, volume: 0.12 })],
  'retro-dragon': [tone(110, 0, 0.46, { to: 390, wave: 'saw', tremolo: 23, volume: 0.32 }), tone(233, 0.06, 0.39, { to: 700, wave: 'triangle', volume: 0.25 }), noise(0.1, 0.34, { cutoff: 1250, volume: 0.4 })],
  'retro-dark': [...notes([311, 294, 185, 78], 0.07, 0.2, { wave: 'triangle', volume: 0.31 }), noise(0.035, 0.34, { cutoff: 650, volume: 0.35 })],
  'retro-steel': [tone(740, 0, 0.3, { volume: 0.3 }), tone(1171, 0, 0.26, { volume: 0.2 }), tone(1983, 0, 0.2, { volume: 0.16 }), noise(0, 0.09, { cutoff: 3400, highpass: true, volume: 0.3 })],
  'retro-fairy': [...notes([784, 988, 1175, 1568], 0.07, 0.22, { volume: 0.24 }), tone(196, 0, 0.42, { to: 392, wave: 'triangle', volume: 0.1 })],
  'retro-stellar': [...notes([523, 784, 1047, 1319, 1568, 2093], 0.055, 0.2, { volume: 0.24 }), noise(0.025, 0.39, { cutoff: 3600, highpass: true, volume: 0.13 })],
  'ball-throw': [noise(0, 0.2, { cutoff: 1600, highpass: true, volume: 0.38 }), tone(330, 0, 0.2, { to: 990, wave: 'triangle', volume: 0.33 })],
  'ball-open': [tone(190, 0, 0.085, { to: 60, wave: 'square', volume: 0.28 }), noise(0, 0.09, { cutoff: 2800, volume: 0.32 }), ...notes([523, 784, 1047, 1568], 0.045, 0.18, { wave: 'triangle', volume: 0.28 }).map((voice) => ({ ...voice, start: voice.start + 0.04 }))],
  recall: [tone(1175, 0, 0.31, { to: 147, wave: 'triangle', volume: 0.36 }), tone(784, 0.04, 0.28, { to: 98, volume: 0.25 }), noise(0.025, 0.25, { cutoff: 1900, highpass: true, volume: 0.14 })],
  faint: [...notes([392, 311, 233, 147, 73], 0.08, 0.18, { wave: 'triangle', volume: 0.32 }), tone(120, 0.35, 0.21, { to: 38, volume: 0.35 }), noise(0.4, 0.17, { cutoff: 450, volume: 0.3 })],
  heal: [...notes([523, 659, 784, 1047, 1319], 0.08, 0.21, { volume: 0.29 }), tone(262, 0, 0.53, { wave: 'triangle', volume: 0.12 })],
  'status-up': [...notes([262, 330, 392, 523], 0.065, 0.15, { wave: 'triangle', volume: 0.3 }), tone(131, 0, 0.33, { to: 524, volume: 0.13 })],
  'status-down': [...notes([523, 392, 330, 196], 0.065, 0.15, { wave: 'triangle', volume: 0.3 }), tone(262, 0, 0.33, { to: 98, volume: 0.13 })],
  'status-ailment': [...notes([440, 415, 311, 294], 0.07, 0.16, { wave: 'square', volume: 0.24, vibrato: 18, vibratoDepth: 0.025 })],
  barrier: [tone(523, 0, 0.35, { to: 1047, volume: 0.3 }), tone(784, 0.025, 0.31, { to: 1568, volume: 0.2 }), tone(2093, 0.2, 0.22, { volume: 0.2 })],
  miss: [noise(0, 0.18, { cutoff: 2100, highpass: true, volume: 0.36 }), tone(660, 0, 0.15, { to: 165, wave: 'triangle', volume: 0.15 })],
}

function seedForName(name) {
  let seed = 2166136261
  for (const character of name) seed = Math.imul(seed ^ character.charCodeAt(0), 16777619)
  return seed >>> 0
}

function waveform(phase, wave) {
  if (wave === 'triangle') return (Math.sin(phase) - Math.sin(phase * 3) / 9 + Math.sin(phase * 5) / 25) * 0.86
  if (wave === 'square') return (Math.sin(phase) + Math.sin(phase * 3) / 3 + Math.sin(phase * 5) / 5) * 0.7
  if (wave === 'saw') return (Math.sin(phase) - Math.sin(phase * 2) / 2 + Math.sin(phase * 3) / 3 - Math.sin(phase * 4) / 4) * 0.68
  return Math.sin(phase)
}

function render(name, voices) {
  const length = Math.ceil((Math.max(...voices.map((voice) => voice.start + voice.duration)) + 0.045) * SAMPLE_RATE)
  const samples = new Float64Array(length)
  let seed = seedForName(name)
  for (const voice of voices) {
    let phase = 0
    let filteredNoise = 0
    const cutoffCoefficient = 1 - Math.exp(-TAU * (voice.cutoff ?? 1200) / SAMPLE_RATE)
    const start = Math.round(voice.start * SAMPLE_RATE)
    const voiceLength = Math.round(voice.duration * SAMPLE_RATE)
    for (let index = 0; index < voiceLength; index += 1) {
      const time = index / SAMPLE_RATE
      const progress = index / voiceLength
      const attack = Math.min(1, time / 0.008)
      const release = Math.min(1, (voice.duration - time) / 0.04)
      const envelope = attack * release * Math.exp(-2.3 * progress)
      const tremolo = voice.tremolo ? 0.66 + 0.34 * Math.sin(TAU * voice.tremolo * time) : 1
      let sample
      if (voice.noise) {
        seed ^= seed << 13
        seed ^= seed >>> 17
        seed ^= seed << 5
        const whiteNoise = (seed >>> 0) / 2147483648 - 1
        filteredNoise += cutoffCoefficient * (whiteNoise - filteredNoise)
        sample = voice.highpass ? whiteNoise - filteredNoise : filteredNoise
      } else {
        const frequency = voice.frequency * ((voice.to ?? voice.frequency) / voice.frequency) ** progress
        const vibrato = voice.vibrato ? 1 + (voice.vibratoDepth ?? 0.02) * Math.sin(TAU * voice.vibrato * time) : 1
        phase += TAU * frequency * vibrato / SAMPLE_RATE
        sample = waveform(phase, voice.wave)
      }
      samples[start + index] += sample * envelope * tremolo * (voice.volume ?? 0.36)
    }
  }
  const peak = samples.reduce((maximum, sample) => Math.max(maximum, Math.abs(sample)), 0)
  const output = Buffer.alloc(44 + length * 2)
  output.write('RIFF', 0)
  output.writeUInt32LE(output.length - 8, 4)
  output.write('WAVEfmt ', 8)
  output.writeUInt32LE(16, 16)
  output.writeUInt16LE(1, 20)
  output.writeUInt16LE(1, 22)
  output.writeUInt32LE(SAMPLE_RATE, 24)
  output.writeUInt32LE(SAMPLE_RATE * 2, 28)
  output.writeUInt16LE(2, 32)
  output.writeUInt16LE(16, 34)
  output.write('data', 36)
  output.writeUInt32LE(length * 2, 40)
  for (let index = 0; index < length; index += 1) {
    output.writeInt16LE(Math.round(samples[index] / Math.max(peak, 0.001) * 0.82 * 32767), 44 + index * 2)
  }
  return output
}

fs.mkdirSync(OUTPUT_ROOT, { recursive: true })
let totalBytes = 0
for (const [name, voices] of Object.entries(RECIPES)) {
  const wave = render(name, voices)
  fs.writeFileSync(path.join(OUTPUT_ROOT, `${name}.wav`), wave)
  totalBytes += wave.length
}
console.log(`Generated ${Object.keys(RECIPES).length} original battle samples (${Math.round(totalBytes / 1024)} KiB) in public/assets/audio/battle/retro.`)
