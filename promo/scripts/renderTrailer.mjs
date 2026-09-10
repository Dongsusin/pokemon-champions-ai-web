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
const transitionDuration = .4
const deterministicKinds = new Set(['title', 'cinematic', 'wall'])
if (!Number.isFinite(totalDuration) || totalDuration < 60 || totalDuration > 180 || shots.some(shot => !Number.isFinite(shot.duration) || shot.duration <= 0)) throw new Error('Trailer must have valid clips and last 60–180 seconds')
const reuseClips = process.argv.includes('--reuse-clips')
const audioOnly = process.argv.includes('--audio-only')
const onlyClips = process.argv.find(argument => argument.startsWith('--only-clips='))?.split('=')[1].split(',').filter(Boolean)
if (audioOnly && onlyClips) throw new Error('--audio-only cannot be combined with --only-clips')
if (onlyClips?.some(id => !shots.some(shot => shot.id === id))) throw new Error('Unknown clip in --only-clips')
const renderShots = audioOnly ? [] : onlyClips ? shots.filter(shot => onlyClips.includes(shot.id)) : shots
const rendererSource = await fs.readFile(fileURLToPath(import.meta.url))
const editFingerprint = crypto.createHash('sha256').update(rendererSource).update(JSON.stringify(shots)).digest('hex')
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
if (!audioOnly) {
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
}

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
async function encode({ id, source = id, start, length, overlay, audio = false, audioSource = source, audioOffset = 0, output = id, smoothSource = null }) {
  if (smoothSource) {
    const args = ['-i', smoothSource]
    if (audio) args.push('-ss',String(audioOffset),'-i',`promo/raw/${audioSource}-audio.webm`)
    else args.push('-f','lavfi','-i','anullsrc=r=48000:cl=stereo')
    args.push('-map','0:v:0','-map','1:a:0','-c:v','copy','-af',`asetpts=PTS-STARTPTS,apad,atrim=duration=${length}`,
      '-c:a','aac','-b:a','192k','-ar','48000','-ac','2','-t',String(length),'-movflags','+faststart',`promo/generated/${output}.mp4`)
    await run(args)
    return
  }
  const args = ['-ss',String(start),'-i',`promo/raw/${source}.webm`]
  const layers = overlay ? JSON.parse(await fs.readFile(`promo/generated/${overlay}-overlay.json`, 'utf8')) : []
  for (const layer of layers) args.push('-framerate','30','-loop','1','-i',layer.file)
  const ai = 1 + layers.length
  if (audio) args.push('-ss',String(audioOffset),'-i',`promo/raw/${audioSource}-audio.webm`)
  else args.push('-f','lavfi','-i','anullsrc=r=48000:cl=stereo')
  let filters = `[0:v]setpts=PTS-STARTPTS,fps=30,setsar=1,tpad=stop_mode=clone:stop_duration=${transitionDuration},eq=contrast=1.015:saturation=1.06[scene];`
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
  filters += `[${previous}]null[v]`
  filters += `;[${ai}:a]asetpts=PTS-STARTPTS,atrim=duration=${length},apad,afade=t=out:st=${length-.09}:d=0.09[a]`
  args.push('-filter_complex',filters,'-map','[v]','-map','[a]','-t',String(length),...encoding,`promo/generated/${output}.mp4`)
  await run(args)
}

for (const shot of renderShots) {
  const capture = JSON.parse(await fs.readFile(`promo/raw/${shot.id}.json`, 'utf8'))
  const rawVideo = await fs.stat(`promo/raw/${shot.id}.webm`)
  const rawAudio = shot.kind === 'battle' || shot.audioSource ? await fs.stat(`promo/raw/${shot.audioSource || shot.id}-audio.webm`) : null
  const stamp = stat => stat ? [stat.size, stat.mtimeMs] : null
  const fingerprintHash = crypto.createHash('sha256').update(rendererSource)
    .update(JSON.stringify({ shot, capture, rawVideo: stamp(rawVideo), rawAudio: stamp(rawAudio) }))
  const length = shot.duration + (shot === shots.at(-1) ? 0 : transitionDuration)
  const smoothSource = deterministicKinds.has(shot.kind) ? `promo/generated/smooth/${shot.id}.mp4` : null
  if (smoothSource) {
    const smoothReport = await fs.readFile(`promo/generated/smooth/${shot.id}.json`, 'utf8').then(JSON.parse)
    if (smoothReport.fps !== 30 || smoothReport.frames !== Math.round(length * 30) || smoothReport.errors.length) throw new Error(`Render deterministic frames for ${shot.id} first`)
    fingerprintHash.update(JSON.stringify(smoothReport)).update(JSON.stringify(stamp(await fs.stat(smoothSource))))
  }
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
  await encode({ id:shot.id, start:smoothSource ? 0 : await sourceStart(shot.id)+offset, length, overlay:shot.overlay ? shot.id : null, audio:shot.kind==='battle'||Boolean(shot.audioSource),audioSource:shot.audioSource||shot.id,audioOffset:offset,smoothSource })
  await fs.writeFile(`promo/generated/${shot.id}.render.json`, JSON.stringify({ fingerprint }))
  console.log(`Rendered ${shot.id}: ${shot.duration}s`)
}
if (onlyClips) process.exit(0)
const pictureSourceFiles = shots.flatMap(shot => [
  `promo/generated/${shot.id}.mp4`, `promo/generated/${shot.id}.render.json`,
  `promo/raw/${shot.id}.webm`, `promo/raw/${shot.id}.json`,
  ...(deterministicKinds.has(shot.kind) ? [`promo/generated/smooth/${shot.id}.mp4`,`promo/generated/smooth/${shot.id}.json`] : []),
  ...(shot.kind === 'battle' || shot.audioSource ? [`promo/raw/${shot.audioSource || shot.id}-audio.webm`] : []),
])
const pictureSourceHashes = Object.fromEntries(await Promise.all(pictureSourceFiles.map(async file => [file,crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex')])))
if (!audioOnly) {
  // Outgoing shots carry a 12-frame handle. Crossfades start at the existing
  // chapter boundary, so every action, subtitle and the 110-second BGM stay aligned.
  const args = shots.flatMap(shot => ['-threads','2','-i',`promo/generated/${shot.id}.mp4`])
  const filters = []
  for (const [index,shot] of shots.entries()) {
    const length = shot.duration + (index === shots.length - 1 ? 0 : transitionDuration)
    filters.push(`[${index}:v]settb=AVTB,setpts=PTS-STARTPTS,setsar=1[v${index}]`)
    filters.push(`[${index}:a]asetpts=PTS-STARTPTS,apad,atrim=duration=${length}[a${index}]`)
  }
  let boundary = 0, video = 'v0', audio = 'a0'
  for (let index=1;index<shots.length;index++) {
    boundary += shots[index-1].duration
    filters.push(`[${video}][v${index}]xfade=transition=fade:duration=${transitionDuration}:offset=${boundary}[blend${index}]`)
    filters.push(`[${audio}][a${index}]acrossfade=d=${transitionDuration}:c1=tri:c2=tri[sound${index}]`)
    video = `blend${index}`; audio = `sound${index}`
  }
  filters.push(`[${video}]fade=t=in:st=0:d=0.18,fade=t=out:st=${totalDuration-.65}:d=0.65,format=yuv420p[picture]`)
  console.log(`Compositing ${shots.length-1} continuous ${transitionDuration}s transitions…`)
  await run([...args,'-filter_complex_threads','1','-filter_complex',filters.join(';'),'-map','[picture]','-map',`[${audio}]`,'-t',String(totalDuration),...encoding,'promo/generated/picture-lock.mp4'])
  await fs.writeFile('promo/generated/picture-lock.render.json',JSON.stringify({
    editFingerprint, sourceHashes:pictureSourceHashes, transitionDuration, transitions: shots.length-1, duration: totalDuration,
    method: 'overlapping video dissolve and audio crossfade with outgoing handles',
  },null,2))
} else {
  const pictureEdit = await fs.readFile('promo/generated/picture-lock.render.json','utf8').then(JSON.parse,()=>null)
  if (pictureEdit?.editFingerprint !== editFingerprint) throw new Error('Picture renderer or timeline changed; run a full render before --audio-only')
  if (JSON.stringify(pictureEdit.sourceHashes) !== JSON.stringify(pictureSourceHashes)) throw new Error('Picture sources changed; run a full render before --audio-only')
  const previous = JSON.parse(await fs.readFile('promo/output/validation.json', 'utf8'))
  if (previous.timelineDurationSeconds !== totalDuration || JSON.stringify(previous.shots.map(({id, kind, duration}) => ({id, kind, duration}))) !== JSON.stringify(shots.map(({id, kind, duration}) => ({id, kind, duration})))) throw new Error('Picture edit changed; run a full render before --audio-only')
  if (Math.abs(await duration('promo/generated/picture-lock.mp4') - totalDuration) > .1) throw new Error('Picture-lock duration differs from the timeline; run a full render')
}
let at = 0
const stamp = seconds => `${String(Math.floor(seconds/3600)).padStart(2,'0')}:${String(Math.floor(seconds/60)%60).padStart(2,'0')}:${String(Math.floor(seconds)%60).padStart(2,'0')},000`
const captions = shots.map((s,i)=>{ const start=at; at+=s.duration; const wording=s.caption || s.overlay; const copy=wording ? [wording.title, wording.description].filter(Boolean).join('\n') : '다음 챔피언은, 당신.\n당신의 팀으로 도전하세요.'; return `${i+1}\n${stamp(start)} --> ${stamp(at)}\n${copy}\n` }).join('\n')
await fs.writeFile('promo/output/champions-arena-promo-ko.srt',captions)
if (at !== totalDuration) throw new Error(`Unexpected timeline duration ${at}`)
const musicDuration = await duration('promo/generated/soundtrack.wav')
if (Math.abs(musicDuration-totalDuration) > .1) throw new Error(`Music length ${musicDuration}s does not match timeline ${totalDuration}s; regenerate soundtrack`)
const score = JSON.parse(await fs.readFile('promo/generated/soundtrack.json', 'utf8'))
const hashFile = async file => crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex')
if (score.kind !== 'web-battle-bgm' || score.sourcePath !== 'public/assets/audio/battle/battle-theme.ogg' || score.sourceSha256 !== await hashFile(score.sourcePath) || score.outputSha256 !== await hashFile('promo/generated/soundtrack.wav')) throw new Error('Prepare the current web battle BGM with prepareWebSoundtrack.mjs before rendering')
const musicCredit = `Music: ${score.title} by ${score.artist}. ${score.license} (${score.licenseUrl}). Source: ${score.sourceUrl}. ${score.modifications}`
const mix = '[0:a]volume=1.05,asplit=2[sfx][key];[1:a]volume=0.92[music];[music][key]sidechaincompress=threshold=0.035:ratio=2.4:attack=8:release=140:makeup=1[bed];[bed][sfx]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.92'
const mixInputs = ['-i','promo/generated/picture-lock.mp4','-i','promo/generated/soundtrack.wav']
// Leave extra peak headroom for AAC encoding of the dense battle track.
const target = 'I=-16:TP=-2.5:LRA=11'
const analysis = await run([...mixInputs,'-filter_complex',`${mix},loudnorm=${target}:print_format=json[a]`,'-map','[a]','-t',String(totalDuration),'-f','null',process.platform === 'win32' ? 'NUL' : '/dev/null'])
const measured = JSON.parse(analysis.match(/\{\s*"input_i"[\s\S]*?\}/)?.[0] || 'null')
if (!measured || !Number.isFinite(Number(measured.input_i))) throw new Error('Cannot measure the final soundtrack mix')
const normalize = `loudnorm=${target}:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}:offset=${measured.target_offset}:linear=true`
await run([...mixInputs,'-i','promo/output/champions-arena-promo-ko.srt','-filter_complex',`${mix},${normalize}[a]`,'-map','0:v','-map','[a]','-map','2:0','-c:v','copy','-c:a','aac','-b:a','256k','-ar','48000','-c:s','mov_text','-metadata:s:s:0','language=kor','-disposition:s:0','0','-metadata','title=Pokémon Champions Arena — Break the Limit','-metadata',`comment=Unofficial fan game. In-game Pokemon, trainer and item montage, actual gameplay. ${musicCredit}`,'-metadata',`copyright=${musicCredit}`,'-t',String(totalDuration),'-movflags','+faststart','promo/output/champions-arena-promo-1080p.mp4'])
await run(['-ss','3','-i','promo/output/champions-arena-promo-1080p.mp4','-frames:v','1','-q:v','2','promo/output/champions-arena-promo-poster.jpg'])
const probe = await run(['-i','promo/output/champions-arena-promo-1080p.mp4','-af','loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json','-f','null','NUL'])
await fs.writeFile('promo/generated/final-audio-analysis.txt',probe)
const stat = await fs.stat('promo/output/champions-arena-promo-1080p.mp4')
console.log(JSON.stringify({ output:'promo/output/champions-arena-promo-1080p.mp4', duration:await duration('promo/output/champions-arena-promo-1080p.mp4'), bytes:stat.size, audio:probe.slice(probe.lastIndexOf('{')) },null,2))
