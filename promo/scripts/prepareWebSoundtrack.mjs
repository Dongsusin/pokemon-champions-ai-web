import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
process.chdir(root)
const require = createRequire(import.meta.url)
const ffmpeg = process.env.FFMPEG_PATH || require('ffmpeg-static')
const sourcePath = 'public/assets/audio/battle/battle-theme.ogg'
const output = 'promo/generated/soundtrack.wav'
const sink = process.platform === 'win32' ? 'NUL' : '/dev/null'
const shots = JSON.parse(await fs.readFile('promo/timeline.json', 'utf8'))
const durationSeconds = shots.reduce((sum, shot) => sum + shot.duration, 0)
if (!Number.isFinite(durationSeconds) || durationSeconds < 60 || durationSeconds > 180) throw new Error('Invalid trailer duration')
const fadeInSeconds = .25, fadeOutSeconds = 1.75
const edit = `atrim=start=0:duration=${durationSeconds},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=${fadeInSeconds},afade=t=out:st=${durationSeconds-fadeOutSeconds}:d=${fadeOutSeconds}`
const target = 'I=-18:TP=-3:LRA=11'

function run(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpeg, ['-hide_banner', '-nostdin', '-y', ...args], { windowsHide: true })
    let stderr = ''
    proc.stderr.on('data', chunk => { stderr += chunk })
    proc.on('error', reject)
    proc.on('close', code => code === 0 ? resolve(stderr) : reject(new Error(stderr)))
  })
}

await fs.mkdir('promo/generated', { recursive: true })
const analysis = await run(['-i', sourcePath, '-af', `${edit},loudnorm=${target}:print_format=json`, '-f', 'null', sink])
const measured = JSON.parse(analysis.match(/\{\s*"input_i"[\s\S]*?\}/)?.[0] || 'null')
if (!measured || !Number.isFinite(Number(measured.input_i))) throw new Error('Web battle music is silent or unreadable')
const normalize = `loudnorm=${target}:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}:offset=${measured.target_offset}:linear=true`
await run(['-i', sourcePath, '-af', `${edit},${normalize}`, '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', output])
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const report = {
  kind: 'web-battle-bgm',
  title: 'Face The Champion!', artist: 'Spring Spring',
  license: 'CC BY 3.0', licenseUrl: 'https://creativecommons.org/licenses/by/3.0/',
  sourceUrl: 'https://opengameart.org/content/face-the-champion',
  sourcePath, sourceSha256: sha256(await fs.readFile(sourcePath)),
  output, outputSha256: sha256(await fs.readFile(output)),
  durationSeconds, sourceStartSeconds: 0, sampleRate: 48000, channels: 2,
  fadeInSeconds, fadeOutSeconds, targetIntegratedLUFS: -18,
  modifications: 'Excerpt from the web game battle music; fades, loudness adjustment and gameplay-effects mix.',
}
await fs.writeFile('promo/generated/soundtrack.json', JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
