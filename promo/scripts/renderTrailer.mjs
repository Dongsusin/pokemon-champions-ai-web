import { createRequire } from 'node:module'
import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import crypto from 'node:crypto'
import { resolveChromiumExecutable } from './browserRuntime.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
process.chdir(root)
const require = createRequire(import.meta.url)
const ffmpeg = process.env.FFMPEG_PATH || require('ffmpeg-static')
const runtimeModules = process.env.PROMO_NODE_MODULES || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules')
let chromium
try { ({ chromium } = require('playwright')) } catch { ({ chromium } = require(path.join(runtimeModules, 'playwright'))) }
const base = process.env.PROMO_BASE_URL || 'http://127.0.0.1:5184'
const shots = JSON.parse(await fs.readFile('promo/timeline.json', 'utf8'))
const totalDuration = shots.reduce((seconds, shot) => seconds + shot.duration, 0)
if (!Number.isFinite(totalDuration) || totalDuration < 60 || totalDuration > 180 || shots.some(shot => !Number.isFinite(shot.duration) || shot.duration <= 0)) throw new Error('Trailer must have valid clips and last 60–180 seconds')
const reuseClips = process.argv.includes('--reuse-clips')
const onlyClips = process.argv.find(argument => argument.startsWith('--only-clips='))?.split('=')[1].split(',').filter(Boolean)
if (onlyClips?.some(id => !shots.some(shot => shot.id === id))) throw new Error('Unknown clip in --only-clips')
const renderShots = onlyClips ? shots.filter(shot => onlyClips.includes(shot.id)) : shots
const rendererSource = await fs.readFile(fileURLToPath(import.meta.url))
await fs.mkdir('promo/generated', { recursive: true })
await fs.mkdir('promo/output', { recursive: true })

function run(args, allowFailure = false) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpeg, ['-hide_banner', '-nostdin', '-y', ...args], { windowsHide: true })
    let err = ''; proc.stderr.on('data', chunk => { err += chunk; if (err.length > 100000) err = err.slice(-80000) })
    proc.on('error', reject)
    proc.on('close', code => code === 0 || allowFailure ? resolve(err) : reject(new Error(err.slice(-12000))))
  })
}
async function duration(file) {
  const result = await run(['-i', file], true)
  const m = result.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/)
  if (!m) throw new Error(`Cannot read video duration: ${file}`)
  return Number(m[1])*3600+Number(m[2])*60+Number(m[3])
}
async function sourceStart(id) {
  const metadata = JSON.parse(await fs.readFile(`promo/raw/${id}.json`, 'utf8'))
  if (!metadata.videoTailSeconds) throw new Error(`Recapture ${id}: missing videoTailSeconds`)
  if (metadata.errors.length) throw new Error(`Capture ${id} has browser errors`)
  if (metadata.status && metadata.status.playing === false) throw new Error(`Capture ${id} did not play`)
  if (Number.isFinite(metadata.syncStartSeconds)) return metadata.syncStartSeconds
  return Math.max(0, await duration(`promo/raw/${id}.webm`) - metadata.videoTailSeconds)
}
const browser = await chromium.launch({ executablePath: await resolveChromiumExecutable(chromium), headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
  for (const shot of renderShots.filter(s => s.overlay)) {
    await page.goto(`${base}/promo/overlay.html?data=${encodeURIComponent(JSON.stringify(shot.overlay))}`)
    await page.evaluate(() => window.overlayReady)
    const layers = await page.evaluate(() => window.promoOverlay.layers)
    const manifest = []
    for (const name of layers) {
      const bounds = await page.evaluate(name => {
        window.promoOverlay.setLayer(name)
        return window.promoOverlay.bounds(name)
      }, name)
      const file = `promo/generated/${shot.id}-overlay-${name}.png`
      await page.screenshot({ path: file, clip: bounds, omitBackground: true })
      manifest.push({ name, file, ...bounds })
    }
    await fs.writeFile(`promo/generated/${shot.id}-overlay.json`, JSON.stringify(manifest, null, 2))
  }
} finally { await browser.close() }

const encoding = ['-c:v','libx264','-preset','fast','-crf','20','-pix_fmt','yuv420p','-r','30','-video_track_timescale','15360','-threads','4','-c:a','aac','-b:a','192k','-ar','48000','-ac','2','-movflags','+faststart']
// Text arrives once, settles for reading, then leaves just before the cut.
// The cubic easing expression is bounded so frames before/after the move stay stable.
const clamp = expression => `min(1,max(0,${expression}))`
const rise = (time, duration) => `(1-pow(1-${clamp(`(t-${time})/${duration}`)},3))`
const motions = {
  eyebrow: { at: .06, duration: .30, dx: -32, dy: 0 },
  title: { at: .14, duration: .42, dx: -46, dy: 20 },
  description: { at: .34, duration: .34, dx: 0, dy: 20 },
  tag: { at: .43, duration: .30, dx: 32, dy: 0 },
}
async function encode({ id, source = id, start, length, overlay, audio = false, audioOffset = 0, fade = true, output = id }) {
  const args = ['-ss',String(start),'-i',`promo/raw/${source}.webm`]
  const layers = overlay ? JSON.parse(await fs.readFile(`promo/generated/${overlay}-overlay.json`, 'utf8')) : []
  for (const layer of layers) args.push('-framerate','30','-loop','1','-i',layer.file)
  const ai = 1 + layers.length
  if (audio) args.push('-ss',String(audioOffset),'-i',`promo/raw/${source}-audio.webm`)
  else args.push('-f','lavfi','-i','anullsrc=r=48000:cl=stereo')
  const fadeFilters = fade ? `,fade=t=in:st=0:d=0.10,fade=t=out:st=${length-.12}:d=0.12` : ''
  let filters = '[0:v]setpts=PTS-STARTPTS,fps=30,setsar=1,eq=contrast=1.015:saturation=1.06[scene];'
  let previous = 'scene'
  for (const [index, layer] of layers.entries()) {
    let x = String(layer.x), y = String(layer.y), alpha = ''
    const motion = motions[layer.name]
    if (motion) {
      const incoming = `(1-${rise(motion.at, motion.duration)})`
      const outgoing = rise(length - .30, .22)
      x += `+${motion.dx}*${incoming}-10*${outgoing}`
      y += `+${motion.dy}*${incoming}-6*${outgoing}`
      alpha = `,fade=t=in:st=${motion.at}:d=${Math.min(.22, motion.duration)}:alpha=1,fade=t=out:st=${length-.30}:d=0.22:alpha=1`
    } else if (layer.name === 'sweep') {
      // A brief highlight travels under the eyebrow; it never crosses battle action.
      x += `+250*${rise(.24, .50)}`
      alpha = ',fade=t=in:st=0.24:d=0.10:alpha=1,fade=t=out:st=0.42:d=0.30:alpha=1'
    } else {
      alpha = ',fade=t=in:st=0:d=0.16:alpha=1'
    }
    filters += `[${index+1}:v]setpts=PTS-STARTPTS,format=rgba${alpha}[caption${index}];[${previous}][caption${index}]overlay=x='${x}':y='${y}':eval=frame:shortest=1[composite${index}];`
    previous = `composite${index}`
  }
  filters += `[${previous}]null${fadeFilters}[v]`
  filters += `;[${ai}:a]asetpts=PTS-STARTPTS,atrim=duration=${length},apad,afade=t=out:st=${length-.09}:d=0.09[a]`
  args.push('-filter_complex',filters,'-map','[v]','-map','[a]','-t',String(length),...encoding,`promo/generated/${output}.mp4`)
  await run(args)
}

for (const shot of renderShots) {
  const capture = JSON.parse(await fs.readFile(`promo/raw/${shot.id}.json`, 'utf8'))
  const rawVideo = await fs.stat(`promo/raw/${shot.id}.webm`)
  const rawAudio = shot.kind === 'battle' ? await fs.stat(`promo/raw/${shot.id}-audio.webm`) : null
  const stamp = stat => stat ? [stat.size, stat.mtimeMs] : null
  const fingerprintHash = crypto.createHash('sha256').update(rendererSource)
    .update(JSON.stringify({ shot, capture, rawVideo: stamp(rawVideo), rawAudio: stamp(rawAudio) }))
  if (shot.overlay) {
    const manifest = await fs.readFile(`promo/generated/${shot.id}-overlay.json`)
    fingerprintHash.update(manifest)
    for (const layer of JSON.parse(manifest)) fingerprintHash.update(await fs.readFile(layer.file))
  }
  const fingerprint = fingerprintHash.digest('hex')
  if (reuseClips) {
    const previous = await fs.readFile(`promo/generated/${shot.id}.render.json`, 'utf8').then(JSON.parse, () => null)
    const exists = await fs.access(`promo/generated/${shot.id}.mp4`).then(() => true, () => false)
    if (exists && previous?.fingerprint === fingerprint) continue
  }
  const offset = shot.sourceOffset ?? 0
  await encode({ id:shot.id, start:await sourceStart(shot.id)+offset, length:shot.duration, overlay:shot.overlay ? shot.id : null, audio:shot.kind==='battle',audioOffset:offset })
  await fs.writeFile(`promo/generated/${shot.id}.render.json`, JSON.stringify({ fingerprint }))
  console.log(`Rendered ${shot.id}: ${shot.duration}s`)
}
if (onlyClips) process.exit(0)
await fs.writeFile('promo/generated/concat.txt', shots.map(s=>`file '${s.id}.mp4'`).join('\n'))
await run(['-f','concat','-safe','0','-i','promo/generated/concat.txt','-c','copy','promo/generated/picture-lock.mp4'])
let at = 0
const stamp = seconds => `${String(Math.floor(seconds/3600)).padStart(2,'0')}:${String(Math.floor(seconds/60)%60).padStart(2,'0')}:${String(Math.floor(seconds)%60).padStart(2,'0')},000`
const captions = shots.map((s,i)=>{ const start=at; at+=s.duration; const wording=s.caption || s.overlay; const copy=wording ? [wording.title, wording.description].filter(Boolean).join('\n') : '다음 챔피언은, 당신.\n당신의 팀으로 도전하세요.'; return `${i+1}\n${stamp(start)} --> ${stamp(at)}\n${copy}\n` }).join('\n')
await fs.writeFile('promo/output/champions-arena-promo-ko.srt',captions)
if (at !== totalDuration) throw new Error(`Unexpected timeline duration ${at}`)
const musicDuration = await duration('promo/generated/soundtrack.wav')
if (Math.abs(musicDuration-totalDuration) > .1) throw new Error(`Music length ${musicDuration}s does not match timeline ${totalDuration}s; regenerate soundtrack`)
const mix = '[0:a]volume=1.05,asplit=2[sfx][key];[1:a]volume=0.92[music];[music][key]sidechaincompress=threshold=0.035:ratio=2.4:attack=8:release=140:makeup=1[bed];[bed][sfx]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.92,loudnorm=I=-16:TP=-1.5:LRA=11[a]'
await run(['-i','promo/generated/picture-lock.mp4','-i','promo/generated/soundtrack.wav','-i','promo/output/champions-arena-promo-ko.srt','-filter_complex',mix,'-map','0:v','-map','[a]','-map','2:0','-c:v','copy','-c:a','aac','-b:a','256k','-ar','48000','-c:s','mov_text','-metadata:s:s:0','language=kor','-disposition:s:0','0','-metadata','title=Pokémon Champions Arena — Break the Limit','-metadata','comment=Unofficial fan game. In-game trainer and item sprite montage, actual gameplay and original battle soundtrack.','-t',String(totalDuration),'-movflags','+faststart','promo/output/champions-arena-promo-1080p.mp4'])
await run(['-ss','3','-i','promo/output/champions-arena-promo-1080p.mp4','-frames:v','1','-q:v','2','promo/output/champions-arena-promo-poster.jpg'])
const probe = await run(['-i','promo/output/champions-arena-promo-1080p.mp4','-af','loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json','-f','null','NUL'])
await fs.writeFile('promo/generated/final-audio-analysis.txt',probe)
const stat = await fs.stat('promo/output/champions-arena-promo-1080p.mp4')
console.log(JSON.stringify({ output:'promo/output/champions-arena-promo-1080p.mp4', duration:await duration('promo/output/champions-arena-promo-1080p.mp4'), bytes:stat.size, audio:probe.slice(probe.lastIndexOf('{')) },null,2))
