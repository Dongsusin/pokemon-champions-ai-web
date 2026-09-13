import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { resolveChromiumExecutable } from '../../scripts/browserRuntime.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
process.chdir(root)
const require = createRequire(import.meta.url)
const ffmpeg = process.env.FFMPEG_PATH || require('ffmpeg-static')
const { chromium } = require('playwright')
const base = process.env.PROMO_BASE_URL || 'http://127.0.0.1:5184'
const project = 'promo/factory'
const generated = `${project}/generated`
const output = `${project}/output`
const timeline = JSON.parse(await fs.readFile(`${project}/timeline.json`, 'utf8'))
const total = timeline.reduce((sum, shot) => sum + shot.duration, 0)
const transition = .4
const fps = 30
const args = process.argv.slice(2)
const onlyMotion = args.includes('--motion-only')
const onlyFootage = args.includes('--footage-only')
const onlyFinal = args.includes('--final-only')
const reuse = args.includes('--reuse')
const ids = args.find(arg => arg.startsWith('--ids='))?.slice(6).split(',')
const accepted = new Set(['fade', 'smoothup', 'smoothleft', 'smoothright'])
if (total < 60 || total > 120 || timeline.some(s => !Number.isInteger(s.duration * fps) || !accepted.has(s.transition))) throw new Error('Invalid 60–120 second update timeline')
if (ids?.some(id => !timeline.some(s => s.id === id))) throw new Error('Unknown scene')
for (const dir of [generated, `${generated}/scenes`, `${generated}/overlays`, output]) await fs.mkdir(dir, { recursive: true })
const hash = data => crypto.createHash('sha256').update(data).digest('hex')
const hashFile = async file => hash(await fs.readFile(file))
const readJson = async file => JSON.parse(await fs.readFile(file, 'utf8'))
const has = file => fs.access(file).then(() => true, () => false)
const sourceHash = await hashFile(fileURLToPath(import.meta.url))
const relative = file => path.relative(root, file).replaceAll('\\', '/')
const sink = process.platform === 'win32' ? 'NUL' : '/dev/null'
const encoding = ['-c:v', 'libx264', '-preset', 'fast', '-crf', '21', '-pix_fmt', 'yuv420p', '-r', String(fps), '-video_track_timescale', '15360', '-threads', '2', '-movflags', '+faststart']
function run(arguments_, allowFailure = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, ['-hide_banner', '-nostdin', '-y', ...arguments_], { windowsHide: true })
    let stderr = ''
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-500000) })
    child.on('error', reject)
    child.on('close', code => code === 0 || allowFailure ? resolve(stderr) : reject(new Error(stderr.slice(-12000))))
  })
}
function encoder(file, frames) {
  const child = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-framerate', String(fps), '-i', 'pipe:0', '-an', '-frames:v', String(frames), ...encoding, file], { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] })
  let stderr = '', failure
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-12000) })
  child.stdin.on('error', error => { failure = error })
  const done = new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('close', code => code === 0 && !failure ? resolve() : reject(failure || new Error(stderr)))
  })
  done.catch(() => {})
  return {
    async write(bytes) { if (failure) throw failure; if (!child.stdin.write(bytes)) await Promise.race([once(child.stdin, 'drain'), done.then(() => { throw new Error('Encoder ended early') })]) },
    async close() { child.stdin.end(); await done },
    async abort() { child.stdin.destroy(); child.kill(); await done.catch(() => {}) },
  }
}
const lengthOf = shot => shot.duration + (shot === timeline.at(-1) ? 0 : transition)
const sceneFile = shot => `${generated}/scenes/${shot.id}.mp4`
let browser
async function getBrowser() {
  if (!browser) browser = await chromium.launch({ executablePath: await resolveChromiumExecutable(chromium), headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] })
  return browser
}
async function renderMotion(shot) {
  const frames = Math.round(lengthOf(shot) * fps)
  const dependencies = Object.fromEntries(await Promise.all(['motion.html', 'motion.css', 'motion.js'].map(async name => [name, await hashFile(`${project}/${name}`)])))
  const assets = await fs.readdir(`${project}/assets`).catch(() => [])
  for (const name of assets.sort()) dependencies[`assets/${name}`] = await hashFile(`${project}/assets/${name}`)
  if (shot.scene === 'factory') dependencies['public/assets/trainers/factory-clown-cutout.png'] = await hashFile('public/assets/trainers/factory-clown-cutout.png')
  const fingerprint = hash(JSON.stringify({ sourceHash, shot, frames, dependencies }))
  const meta = `${generated}/scenes/${shot.id}.json`
  const cached = await readJson(meta).catch(() => null)
  if (reuse && cached?.fingerprint === fingerprint && cached.sha256 === await hashFile(sceneFile(shot)).catch(() => null)) { console.log(`Reused ${shot.id}`); return }
  const context = await (await getBrowser()).newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, reducedMotion: 'no-preference' })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  let stream
  try {
    await page.goto(`${base}/${project}/motion.html?scene=${shot.scene}`, { waitUntil: 'networkidle', timeout: 90000 })
    await page.evaluate(async () => { await window.updateMotion.ready; await document.fonts.ready })
    stream = encoder(sceneFile(shot), frames)
    for (let frame = 0; frame < frames; frame++) {
      await page.evaluate(async time => { await window.updateMotion.seek(time); await new Promise(resolve => requestAnimationFrame(resolve)) }, frame / fps)
      if (errors.length) throw new Error(errors.join('; '))
      const bytes = await page.screenshot({ type: 'jpeg', quality: 95, timeout: 90000 })
      await stream.write(bytes)
      if (frame === Math.min(frames - 1, 90)) await fs.writeFile(`${generated}/scenes/${shot.id}-sample.jpg`, bytes)
      if (frame % 90 === 0) console.log(`${shot.id}: ${frame}/${frames} frames`)
    }
    await stream.close(); stream = null
    await fs.writeFile(meta, JSON.stringify({ fingerprint, dependencies, id: shot.id, frames, fps, duration: frames / fps, errors, sha256: await hashFile(sceneFile(shot)) }, null, 2))
  } finally { if (stream) await stream.abort(); await context.close() }
  console.log(`Rendered motion ${shot.id}: ${frames} frames`)
}
async function createOverlay(shot) {
  const page = await (await getBrowser()).newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
  try {
    await page.goto(`${base}/${project}/overlay.html?data=${encodeURIComponent(JSON.stringify(shot))}`)
    await page.evaluate(() => window.updateOverlay.ready)
    const layers = await page.evaluate(() => window.updateOverlay.layers)
    const manifest = []
    for (const name of layers) {
      const bounds = await page.evaluate(name => { window.updateOverlay.setLayer(name); return window.updateOverlay.bounds(name) }, name)
      const file = `${generated}/overlays/${shot.id}-${name}.png`
      await page.screenshot({ path: file, clip: bounds, omitBackground: true })
      manifest.push({ name, file, ...bounds })
    }
    return manifest
  } finally { await page.close() }
}
async function renderFootage(shot, manifest) {
  const take = manifest.shots.find(s => s.id === shot.id)
  if (!take || take.errors?.length) throw new Error(`Missing or invalid footage: ${shot.id}`)
  const source = take.video || take.file
  const start = take.video ? (take.recommendedTrimOffset || 0) : take.cleanStartSeconds || 0
  const length = lengthOf(shot)
  if (take.usableDuration + .05 < start + length) throw new Error(`Footage too short: ${shot.id}, need ${start + length}, have ${take.usableDuration}`)
  const fingerprint = hash(JSON.stringify({ sourceHash, shot, take, sourceSha256: await hashFile(source), overlay: await hashFile(`${project}/overlay.html`) }))
  const meta = `${generated}/scenes/${shot.id}.json`
  const cached = await readJson(meta).catch(() => null)
  if (reuse && cached?.fingerprint === fingerprint && cached.sha256 === await hashFile(sceneFile(shot)).catch(() => null)) { console.log(`Reused ${shot.id}`); return }
  const layers = await createOverlay(shot)
  const inputs = ['-ss', String(start), '-i', source, ...layers.flatMap(l => ['-loop', '1', '-framerate', String(fps), '-i', l.file])]
  const camera = shot.camera
  const hold = shot.sourceCutoff ? `,trim=duration=${shot.sourceCutoff},tpad=stop_mode=clone:stop_duration=${length-shot.sourceCutoff}` : ''
  if (camera && (!Number.isFinite(camera.scale) || camera.scale < 1 || camera.scale > 2)) throw new Error(`Invalid fixed framing: ${shot.id}`)
  // A single scale/crop keeps UI edges at identical pixel coordinates every frame.
  // Animated zoompan rounds its crop origin, which made fine text visibly jitter.
  const width = camera ? Math.round(1920 * camera.scale / 2) * 2 : 1920
  const height = camera ? Math.round(1080 * camera.scale / 2) * 2 : 1080
  const x = Math.round((width - 1920) / 4) * 2
  const y = Math.max(0, Math.min(height - 1080, Math.round((height * (camera?.centerY ?? .5) - 540) / 2) * 2))
  const framing = `scale=${width}:${height}:flags=lanczos,crop=1920:1080:${x}:${y}`
  const filters = []
  filters.push(`[0:v]setpts=PTS-STARTPTS,fps=30${hold},${framing},setsar=1,format=yuv420p[raw]`)
  let previous = 'raw'
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i]
    const delay = layer.name === 'line-1' ? .42 : layer.name === 'line-0' ? .18 : .08
    const exitAt = Math.min(3.35, shot.duration - 1.1)
    const ease = `(1-pow(1-min(1,max(0,(t-${delay})/0.5)),3))`
    const shiftX = layer.name.startsWith('line') ? `-42*(1-${ease})` : '+0'
    const shiftY = layer.name.startsWith('line') ? `+12*(1-${ease})` : '+0'
    filters.push(`[${i+1}:v]format=rgba,fade=t=in:st=${delay}:d=0.35:alpha=1,fade=t=out:st=${exitAt}:d=0.4:alpha=1[caption${i}]`)
    filters.push(`[${previous}][caption${i}]overlay=x='${layer.x}${shiftX}':y='${layer.y}${shiftY}':eval=frame:shortest=1[overlay${i}]`)
    previous = `overlay${i}`
  }
  await run([...inputs, '-filter_complex_threads', '1', '-filter_complex', filters.join(';'), '-map', `[${previous}]`, '-an', '-t', String(length), ...encoding, sceneFile(shot)])
  await fs.writeFile(meta, JSON.stringify({ fingerprint, id: shot.id, source, start, duration: length, frames: Math.round(length * fps), fps, sha256: await hashFile(sceneFile(shot)), errors: [] }, null, 2))
  await run(['-ss', '4', '-i', sceneFile(shot), '-frames:v', '1', '-q:v', '2', `${generated}/scenes/${shot.id}-sample.jpg`])
  console.log(`Rendered footage ${shot.id}: ${length}s`)
}
try {
  const selected = timeline.filter(s => !ids || ids.includes(s.id))
  if (!onlyFinal && !onlyFootage) for (const shot of selected.filter(s => s.kind === 'motion')) await renderMotion(shot)
  if (!onlyFinal && !onlyMotion) {
    const manifest = await readJson(`${generated}/footage/manifest.json`)
    for (const shot of selected.filter(s => s.kind === 'footage')) await renderFootage(shot, manifest)
  }
} finally { await browser?.close() }
if (onlyMotion || onlyFootage || ids) process.exit(0)

const sourceHashes = {}
for (const shot of timeline) {
  const report = await readJson(`${generated}/scenes/${shot.id}.json`)
  if (report.frames !== Math.round(lengthOf(shot) * fps) || report.errors?.length) throw new Error(`Invalid rendered scene ${shot.id}`)
  sourceHashes[shot.id] = await hashFile(sceneFile(shot))
  if (report.sha256 !== sourceHashes[shot.id]) throw new Error(`Scene fingerprint mismatch: ${shot.id}`)
}
const picture = `${generated}/picture-lock.mp4`
const pictureFingerprint = hash(JSON.stringify({ sourceHash, timeline, sourceHashes }))
const oldPicture = await readJson(`${generated}/picture-lock.json`).catch(() => null)
if (!reuse || oldPicture?.fingerprint !== pictureFingerprint || oldPicture.sha256 !== await hashFile(picture).catch(() => null)) {
  const inputs = timeline.flatMap(s => ['-threads', '1', '-i', sceneFile(s)])
  const filters = timeline.map((s,i) => `[${i}:v]fps=30,settb=AVTB,setpts=PTS-STARTPTS,setsar=1[v${i}]`)
  let previous = 'v0', boundary = 0
  const transitions = []
  for (let i=1; i<timeline.length; i++) {
    boundary += timeline[i-1].duration
    filters.push(`[${previous}][v${i}]xfade=transition=${timeline[i].transition}:duration=${transition}:offset=${boundary}[blend${i}]`)
    transitions.push({ at: boundary, duration: transition, type: timeline[i].transition, from: timeline[i-1].id, to: timeline[i].id })
    previous = `blend${i}`
  }
  filters.push(`[${previous}]fade=t=in:st=0:d=0.2,fade=t=out:st=${total-.8}:d=0.8,format=yuv420p[picture]`)
  console.log(`Compositing ${total}s / ${transitions.length} continuous transitions`)
  await run([...inputs, '-filter_complex_threads', '1', '-filter_complex', filters.join(';'), '-map', '[picture]', '-an', '-t', String(total), ...encoding, picture])
  await fs.writeFile(`${generated}/picture-lock.json`, JSON.stringify({ fingerprint: pictureFingerprint, sha256: await hashFile(picture), sourceHashes, totalDuration: total, fps, transitions }, null, 2))
}

const cues = []
const soundTakes = (await readJson(`${generated}/footage/manifest.json`)).shots
let at = 0
for (const shot of timeline) {
  if (at > 0 && await has(`${generated}/whoosh.wav`)) cues.push({ file: `${generated}/whoosh.wav`, at: Math.max(0, at-.08), volume: .4 })
  if (['factory', 'battle', 'swap'].includes(shot.id) && await has(`${generated}/impact.wav`)) cues.push({ file: `${generated}/impact.wav`, at: at+.5, volume: .35 })
  if (['rankings', 'outro'].includes(shot.id) && await has(`${generated}/chime.wav`)) cues.push({ file: `${generated}/chime.wav`, at: at+1.1, volume: .5 })
  for (const cue of soundTakes.find(take => take.id === shot.id)?.suggestedSoundCues ?? []) {
    if (!Number.isFinite(cue.seconds) || cue.seconds < 0 || cue.seconds >= shot.duration) continue
    const effect = cue.type === 'ground-impact' ? 'impact' : cue.type === 'gimmick-charge' ? 'whoosh' : null
    if (effect && await has(`${generated}/${effect}.wav`)) cues.push({ file: `${generated}/${effect}.wav`, at: at+cue.seconds, volume: .55, basis: cue.basis })
  }
  at += shot.duration
}
const audioInputs = ['-i', `${generated}/music.wav`, ...cues.flatMap(cue => ['-i', cue.file])]
const audioFilters = ['[0:a]volume=1[music]', ...cues.map((cue,i) => `[${i+1}:a]volume=${cue.volume},adelay=${Math.round(cue.at*1000)}|${Math.round(cue.at*1000)}[cue${i}]`)]
audioFilters.push(`[music]${cues.map((_,i)=>`[cue${i}]`).join('')}amix=inputs=${cues.length+1}:duration=first:normalize=0,alimiter=limit=0.9[mix]`)
const target = 'I=-16:TP=-2.5:LRA=11'
const analysis = await run([...audioInputs, '-filter_complex', `${audioFilters.join(';')};[mix]loudnorm=${target}:print_format=json[a]`, '-map', '[a]', '-t', String(total), '-f', 'null', sink])
const measure = JSON.parse(analysis.match(/\{\s*"input_i"[\s\S]*?\}/)?.[0] || 'null')
if (!measure || !Number.isFinite(Number(measure.input_i))) throw new Error('Audio mastering failed')
const normalize = `loudnorm=${target}:measured_I=${measure.input_i}:measured_TP=${measure.input_tp}:measured_LRA=${measure.input_lra}:measured_thresh=${measure.input_thresh}:offset=${measure.target_offset}:linear=true`
const mastered = `${generated}/mastered.wav`
await run([...audioInputs, '-filter_complex', `${audioFilters.join(';')};[mix]${normalize}[a]`, '-map', '[a]', '-t', String(total), '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', mastered])
const encodedAudio = `${generated}/mastered.m4a`
// Measure the actual AAC: the default two-loop coder produced isolated overshoots
// in this score even though the PCM master had more than 5 dB of peak headroom.
await run(['-i', mastered, '-c:a', 'aac', '-aac_coder', 'fast', '-b:a', '256k', '-ar', '48000', '-ac', '2', '-t', String(total), encodedAudio])
const encodedAnalysis = await run(['-i', encodedAudio, '-af', `loudnorm=${target}:print_format=json`, '-f', 'null', sink])
const encodedMeasure = JSON.parse(encodedAnalysis.match(/\{\s*"input_i"[\s\S]*?\}/)?.[0] || 'null')
if (!encodedMeasure || !Number.isFinite(Number(encodedMeasure.input_i)) || Number(encodedMeasure.input_i) < -18 || Number(encodedMeasure.input_i) > -14 || !Number.isFinite(Number(encodedMeasure.input_tp)) || Number(encodedMeasure.input_tp) >= -1) throw new Error('Encoded AAC failed the loudness or true-peak gate')
const stamp = seconds => `${String(Math.floor(seconds/3600)).padStart(2,'0')}:${String(Math.floor(seconds/60)%60).padStart(2,'0')}:${String(Math.floor(seconds)%60).padStart(2,'0')},000`
let start = 0
const captions = timeline.map((shot,i) => { const current=start; start+=shot.duration; return `${i+1}\n${stamp(current)} --> ${stamp(start)}\n${[shot.title,shot.description].filter(Boolean).join('\n')}\n` }).join('\n')
const srt = `${output}/champions-arena-battle-factory-update-ko.srt`
await fs.writeFile(srt, captions)
const final = `${output}/champions-arena-battle-factory-update-1080p.mp4`
await run(['-i', picture, '-i', encodedAudio, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'copy', '-metadata', 'title=Pokémon Champions Arena — Battle Factory Update', '-metadata', 'comment=Unofficial fan-made game. Actual game components and locally played matches; recording data is separate from live player statistics. See accompanying CREDITS.md for music attribution.', '-t', String(total), '-movflags', '+faststart', final])
await run(['-ss', '7.5', '-i', final, '-frames:v', '1', '-q:v', '2', `${output}/champions-arena-battle-factory-update-poster.jpg`])
await fs.copyFile(`${project}/CREDITS.md`, `${output}/champions-arena-battle-factory-update-credits.txt`)
const capture = await readJson(`${generated}/footage/manifest.json`)
await fs.writeFile(`${output}/source-audit.json`, JSON.stringify({ provenance: capture.provenance,
  sourceGameCommit: capture.sourceGameCommit,
  sourceWorkingTreeChanged: capture.sourceWorkingTreeChanged,
  sourceGameFiles: capture.sourceGameFiles,
  scenes: capture.shots.map(take => ({ id: take.id, usableDuration: take.usableDuration,
    visibleImages: take.visibleImages?.length ?? null,
    allVisibleImagesLoaded: take.visibleImages?.length ? take.visibleImages.every(i => i.loaded) : null,
    sourceVideo: take.video, cleanStartSeconds: take.cleanStartSeconds, recommendedTrimOffset: take.recommendedTrimOffset,
  })),
  captureErrors: capture.errors, blockedExternalRequests: capture.blocked,
  imageVerification: capture.imageVerification,
  battleEvidence: capture.battles, rankingEvidence: capture.apiAudit, recordedActions: capture.actions,
  music: await readJson(`${generated}/music.json`), timeline,
}, null, 2))
await fs.writeFile(`${output}/render.json`, JSON.stringify({ output: final, duration: total, fps, sourceHashes, cues, audioMeasuredBeforeMastering: measure, audioMeasuredAfterEncoding: encodedMeasure, audioEncoder: 'aac-fast-256k', sha256: await hashFile(final), bytes: (await fs.stat(final)).size }, null, 2))
console.log(JSON.stringify({ output: final, seconds: total, bytes: (await fs.stat(final)).size }, null, 2))
