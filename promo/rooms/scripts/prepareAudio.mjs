import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
process.chdir(root)
const require = createRequire(import.meta.url)
const ffmpeg = process.env.FFMPEG_PATH || require('ffmpeg-static')
const sink = process.platform === 'win32' ? 'NUL' : '/dev/null'
const source = 'public/assets/audio/battle/battle-theme.ogg'
const output = 'promo/rooms/generated/music.wav'
const args = process.argv.slice(2)
const argument = name => {
  const equals = args.find(arg => arg.startsWith(`${name}=`))
  if (equals) return equals.slice(name.length + 1)
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}
const durationOverride = argument('--duration')
let durationSeconds
if (durationOverride !== undefined) durationSeconds = Number(durationOverride)
else {
  const timeline = JSON.parse(await fs.readFile(argument('--timeline') || 'promo/rooms/timeline.json', 'utf8'))
  const shots = Array.isArray(timeline) ? timeline : timeline.shots || timeline.scenes
  if (!Array.isArray(shots)) throw new Error('Timeline must be an array or contain a shots/scenes array')
  durationSeconds = shots.reduce((sum, shot) => sum + Number(shot.duration), 0)
}
if (!Number.isFinite(durationSeconds) || durationSeconds < 60 || durationSeconds > 120) {
  throw new Error(`The update trailer must be 60–120 seconds; received ${durationSeconds}`)
}

function run(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpeg, ['-hide_banner', '-nostdin', '-y', '-threads', '2', ...args], { windowsHide: true })
    let stderr = ''
    proc.stderr.on('data', chunk => { stderr += chunk })
    proc.on('error', reject)
    proc.on('close', code => code === 0 ? resolve(stderr) : reject(new Error(stderr)))
  })
}
const readLoudness = text => {
  const block = text.match(/\{\s*"input_i"[\s\S]*?\}/)?.[0]
  if (!block) throw new Error('FFmpeg did not return loudness measurements')
  const measurement = JSON.parse(block)
  if (!Number.isFinite(Number(measurement.input_i))) throw new Error('The music is silent or unreadable')
  return measurement
}

// Small transition cues, synthesized locally without sampled recordings or sound fonts.
async function synthesizeTransitionEffects() {
  const sampleRate = 48000
  let seed = 0x6ad92731
  const noise = () => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5
    return (seed >>> 0) / 0xffffffff * 2 - 1
  }
  const writeCue = async (name, duration, sample) => {
    const count = Math.round(duration * sampleRate)
    const samples = new Float64Array(count * 2)
    let peak = 0
    for (let frame = 0; frame < count; frame++) {
      const pair = sample(frame / sampleRate, frame)
      for (let channel = 0; channel < 2; channel++) {
        samples[frame * 2 + channel] = pair[channel]
        peak = Math.max(peak, Math.abs(pair[channel]))
      }
    }
    // -14 dBFS maximum leaves headroom for the music and final mix.
    const gain = Math.pow(10, -14 / 20) / Math.max(peak, .000001)
    const pcmBytes = count * 2 * 2
    const buffer = Buffer.alloc(44 + pcmBytes)
    buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + pcmBytes, 4)
    buffer.write('WAVEfmt ', 8); buffer.writeUInt32LE(16, 16)
    buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(2, 22)
    buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 4, 28)
    buffer.writeUInt16LE(4, 32); buffer.writeUInt16LE(16, 34)
    buffer.write('data', 36); buffer.writeUInt32LE(pcmBytes, 40)
    for (let index = 0; index < samples.length; index++) buffer.writeInt16LE(Math.round(samples[index] * gain * 32767), 44 + index * 2)
    const file = `promo/rooms/generated/${name}.wav`
    await fs.writeFile(file, buffer)
    return { name, file, durationSeconds: duration, sampleRate, channels: 2, peakDbFS: -14, source: 'Project-generated procedural synthesis; no external samples or sound fonts.' }
  }
  let smoothLeft = 0, smoothRight = 0
  const whoosh = await writeCue('whoosh', .42, t => {
    const phase = t / .42
    const cutoff = 420 + 3300 * Math.sin(Math.PI * phase) ** 2
    const alpha = 1 - Math.exp(-2 * Math.PI * cutoff / sampleRate)
    smoothLeft += alpha * (noise() - smoothLeft)
    smoothRight += alpha * (noise() - smoothRight)
    const envelope = Math.sin(Math.PI * phase) ** 2
    const center = (smoothLeft + smoothRight) * .3
    return [(smoothLeft * .7 + center) * envelope, (smoothRight * .7 + center) * envelope]
  })
  let kickPhase = 0, kickNoise = 0
  const impact = await writeCue('impact', .42, t => {
    kickPhase += 2 * Math.PI * (48 + 110 * Math.exp(-28 * t)) / sampleRate
    kickNoise += .07 * (noise() - kickNoise)
    const envelope = Math.min(1, t / .006) * Math.exp(-13 * t) * Math.min(1, (.42 - t) / .04)
    const body = (Math.sin(kickPhase) * .8 + kickNoise * Math.exp(-45 * t) * 1.5) * envelope
    return [body, body]
  })
  const chime = await writeCue('chime', .85, t => {
    const frequencies = [880, 1174.659, 1479.978]
    const stereo = [0, 0]
    for (let note = 0; note < frequencies.length; note++) {
      const local = t - note * .055
      if (local < 0) continue
      const envelope = Math.min(1, local / .007) * Math.exp(-6.4 * local) * Math.min(1, (.85 - t) / .06)
      const voice = (Math.sin(2 * Math.PI * frequencies[note] * local) + .14 * Math.sin(2 * Math.PI * frequencies[note] * 2.003 * local)) * envelope
      stereo[0] += voice * [.7, .55, .4][note]
      stereo[1] += voice * [.4, .55, .7][note]
    }
    return stereo
  })
  return [whoosh, impact, chime]
}

await fs.mkdir(path.dirname(output), { recursive: true })
const soundEffects = await synthesizeTransitionEffects()
const fadeInSeconds = .2, fadeOutSeconds = 1.6
const edit = `atrim=start=0:duration=${durationSeconds},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=${fadeInSeconds},afade=t=out:st=${durationSeconds - fadeOutSeconds}:d=${fadeOutSeconds}`
const target = 'I=-18:TP=-3:LRA=11'
const analysis = await run(['-i', source, '-af', `${edit},loudnorm=${target}:print_format=json`, '-f', 'null', sink])
const measured = readLoudness(analysis)
const normalize = `loudnorm=${target}:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}:offset=${measured.target_offset}:linear=true`
await run(['-i', source, '-af', `${edit},${normalize}`, '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', output])
const finalMeasurement = readLoudness(await run(['-i', output, '-af', `loudnorm=${target}:print_format=json`, '-f', 'null', sink]))
const hash = async file => crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex')
const report = {
  title: 'Face The Champion!', creator: 'Spring Spring',
  attribution: 'Produced by Julie Damsgaard / Spring Spring / Spring Enterprises',
  sourceUrl: 'https://opengameart.org/content/face-the-champion',
  creatorUrl: 'https://spring-enterprises.neocities.org',
  license: 'CC BY 3.0', licenseUrl: 'https://creativecommons.org/licenses/by/3.0/',
  source, sourceSha256: await hash(source), output, outputSha256: await hash(output),
  sourceStartSeconds: 0, durationSeconds, fadeInSeconds, fadeOutSeconds,
  sampleRate: 48000, channels: 2, targetIntegratedLUFS: -18,
  measuredIntegratedLUFS: Number(finalMeasurement.input_i),
  measuredTruePeakDbTP: Number(finalMeasurement.input_tp),
  soundEffects,
  modifications: 'Excerpted from the existing web-game BGM, faded in/out, normalized, and resampled. Final trailer may mix game effects over this music.',
}
await fs.writeFile('promo/rooms/generated/music.json', JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
