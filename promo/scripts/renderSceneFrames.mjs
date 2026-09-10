import { createRequire } from 'node:module'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import os from 'node:os'
import crypto from 'node:crypto'
import { resolveChromiumExecutable } from './browserRuntime.mjs'
import { BATTLE_ITEMS } from '../../src/data/shopData.js'
import { TRAINERS } from '../../src/data/trainerTeams.js'
import { getTrainerSpriteCandidates } from '../../src/data/trainerSprites.js'
import { NATIONAL_DEX } from '../../src/data/trainingData.js'

// Render each animation time explicitly. Browser/video recording can repeat a
// frame when the full sprite atlas or nine videos exceed a real-time deadline.
// Offline screenshots never skip an animation time, even on a busy computer.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(import.meta.url)
const ffmpeg = process.env.FFMPEG_PATH || require('ffmpeg-static')
const runtimeModules = process.env.PROMO_NODE_MODULES || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules')
let chromium
try { ({ chromium } = require('playwright')) } catch { ({ chromium } = require(path.join(runtimeModules, 'playwright'))) }
const base = process.env.PROMO_BASE_URL || 'http://127.0.0.1:5184'
const args = process.argv.slice(2)
const option = name => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3)
const workers = Number(option('workers') || 1)
const sampleFrames = option('sample-frames') === undefined ? null : Number(option('sample-frames'))
const sampleStart = Number(option('start') || 0)
const reuse = args.includes('--reuse')
const fps = 30
const transitionTail = .4
const timeline = JSON.parse(await fs.readFile(path.join(root, 'promo/timeline.json'), 'utf8'))
const supported = timeline.filter(shot => ['title', 'cinematic', 'wall'].includes(shot.kind))
const ids = args.filter(arg => !arg.startsWith('--'))
if (!Number.isInteger(workers) || workers < 1 || workers > 2) throw new Error('--workers must be 1 or 2')
if (sampleFrames !== null && (!Number.isInteger(sampleFrames) || sampleFrames < 1)) throw new Error('--sample-frames must be a positive integer')
if (!Number.isFinite(sampleStart) || sampleStart < 0 || (sampleStart && sampleFrames === null)) throw new Error('--start requires --sample-frames and a nonnegative time')
if (args.some(arg => arg.startsWith('--') && !/^--(?:reuse|workers=\d+|sample-frames=\d+|start=\d+(?:\.\d+)?)$/.test(arg))) throw new Error('Unknown frame-rendering option')
if (ids.some(id => !supported.some(shot => shot.id === id))) throw new Error('Unknown title/cinematic/wall scene ID')
const selected = supported.filter(shot => !ids.length || ids.includes(shot.id))
const outDir = path.join(root, 'promo/generated/smooth')
await fs.mkdir(outDir, { recursive: true })
const hash = value => crypto.createHash('sha256').update(value).digest('hex')
const hashFile = async file => hash(await fs.readFile(file))
const relative = file => path.relative(root, file).split(path.sep).join('/')

async function dependencies(shot) {
  const files = new Set([
    fileURLToPath(import.meta.url), path.join(root, 'promo/scripts/browserRuntime.mjs'),
    path.join(root, 'promo/timeline.json'),
  ])
  function addLocalAsset(value) {
    if (typeof value !== 'string' || !value) return
    const url = new URL(value, base)
    if (url.origin !== new URL(base).origin) return
    const pathname = decodeURIComponent(url.pathname)
    const assetRoot = pathname.startsWith('/assets/') ? path.join(root, 'public') : pathname.startsWith('/promo/assets/') ? root : null
    if (!assetRoot) return
    const file = path.resolve(assetRoot, pathname.slice(1))
    if (!file.startsWith(assetRoot + path.sep)) throw new Error(`Asset is outside its source directory: ${value}`)
    files.add(file)
  }
  // Follow local source imports so a data change also invalidates the cache.
  async function addSource(file) {
    if (files.has(file)) return
    files.add(file)
    const source = await fs.readFile(file, 'utf8')
    // Local image bytes matter as well as the JS/CSS that names them. This also
    // covers literal CSS backgrounds without waiting for a browser cache hit.
    for (const match of source.matchAll(/["'(](\/(?:assets|promo\/assets)\/[^"')?#\s]+)/g)) addLocalAsset(match[1])
    if (/\.[cm]?jsx?$/.test(file)) {
      for (const match of source.matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g)) {
        const dependency = path.resolve(path.dirname(file), match[1])
        if (/\.(?:[cm]?jsx?|json)$/.test(dependency)) await addSource(dependency)
      }
    }
  }
  if (shot.kind === 'title') {
    await addSource(path.join(root, 'promo/title.html'))
    files.add(path.join(root, 'public/assets/brand/champions-arena-emblem.png'))
    files.add(path.join(root, 'public/assets/champions-lobby-bg.jpg'))
  } else if (shot.kind === 'cinematic') {
    for (const suffix of ['html', 'css', 'js']) await addSource(path.join(root, `promo/cinematic.${suffix}`))
    const sceneId = new URL(shot.url, base).searchParams.get('scene')
    if (sceneId === 'trainers') {
      for (const candidate of TRAINERS.flatMap(getTrainerSpriteCandidates)) addLocalAsset(candidate)
    } else if (sceneId === 'items') {
      // Include the complete catalog of local sprite and sprite-sheet sources;
      // selection changes are already covered by cinematic.js's source hash.
      for (const item of BATTLE_ITEMS) addLocalAsset(item.sprite)
    } else if (sceneId === 'pokemon') {
      for (const candidate of NATIONAL_DEX.flatMap(pokemon => [pokemon.spriteFrontFallback].flat(Infinity))) addLocalAsset(candidate)
    }
  } else {
    for (const suffix of ['html', 'css', 'js']) await addSource(path.join(root, `promo/gimmickWall.${suffix}`))
    const manifestFile = path.join(root, 'promo/generated/gimmick-clips.json')
    files.add(manifestFile)
    const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'))
    const sceneId = new URL(shot.url, base).searchParams.get('scene')
    const tiles = manifest.groups?.[sceneId]?.tiles
    if (tiles?.length !== 9) throw new Error(`${shot.id} requires nine prepared battle clips`)
    for (const tile of tiles) {
      if (!tile.url.startsWith('/promo/generated/gimmicks/')) throw new Error(`Unexpected battle clip path: ${tile.url}`)
      const file = path.resolve(root, tile.url.slice(1))
      if (!file.startsWith(path.join(root, 'promo/generated/gimmicks') + path.sep)) throw new Error('Battle clip is outside the generated directory')
      files.add(file)
    }
  }
  const pairs = await Promise.all([...files].sort().map(async file => [relative(file), await hashFile(file)]))
  return Object.fromEntries(pairs)
}

function encoder(output, frames) {
  const child = spawn(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-f', 'image2pipe', '-vcodec', 'mjpeg', '-framerate', String(fps), '-i', 'pipe:0',
    '-an', '-frames:v', String(frames), '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
    '-pix_fmt', 'yuv420p', '-r', String(fps), '-video_track_timescale', '15360',
    '-threads', '2', '-movflags', '+faststart', '-f', 'mp4', output,
  ], { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] })
  let stderr = '', failure = null
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-16000) })
  child.stdin.on('error', error => { failure ||= error })
  const done = new Promise((resolve, reject) => {
    child.on('error', error => { failure = error; reject(error) })
    child.on('close', code => {
      if (code === 0 && !failure) resolve()
      else { failure ||= new Error(`FFmpeg exited ${code}: ${stderr}`); reject(failure) }
    })
  })
  // Attach rejection immediately; the encoder may fail while a page is seeking.
  done.catch(() => {})
  return {
    async write(buffer) {
      if (failure) throw failure
      if (!child.stdin.write(buffer)) await Promise.race([once(child.stdin, 'drain'), done.then(() => { throw new Error('Encoder closed before the final frame') })])
      if (failure) throw failure
    },
    async finish() { child.stdin.end(); await done },
    async abort() { child.stdin.destroy(); child.kill(); await done.catch(() => {}) },
  }
}

const timingMethod = 'Explicit frameIndex/30 scene seek, paused Web Animations, seeked video frames, two requestAnimationFrame paint barriers, JPEG 95 screenshot; no wall-clock recording'
const browser = await chromium.launch({
  executablePath: await resolveChromiumExecutable(chromium), headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
})

async function renderShot(shot) {
  const extra = shot.id === timeline.at(-1).id ? 0 : transitionTail
  const frames = sampleFrames ?? Math.round((shot.duration + extra) * fps)
  const duration = frames / fps
  const start = sampleFrames === null ? 0 : sampleStart
  if (start + duration > shot.duration + extra + 1 / fps) throw new Error(`Sample exceeds ${shot.id}'s duration and transition tail`)
  const suffix = sampleFrames === null ? '' : `.sample-${start}-${frames}`
  const output = path.join(outDir, `${shot.id}${suffix}.mp4`)
  const metadataPath = path.join(outDir, `${shot.id}${suffix}.json`)
  const partial = path.join(outDir, `${shot.id}${suffix}.partial.mp4`)
  const sourceHashes = await dependencies(shot)
  const fingerprint = hash(JSON.stringify({ shot, sourceHashes, fps, frames, start, width: 1920, height: 1080, transitionTail: extra, timingMethod }))
  if (reuse) {
    const cached = await fs.readFile(metadataPath, 'utf8').then(JSON.parse).catch(() => null)
    if (cached?.fingerprint === fingerprint && cached.errors?.length === 0 && cached.sha256 === await hashFile(output).catch(() => null)) {
      console.log(JSON.stringify({ shotId: shot.id, reused: true, frames, duration, output: relative(output) })); return
    }
  }
  const began = performance.now()
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, reducedMotion: 'no-preference' })
  const page = await context.newPage()
  const errors = [], samples = []
  page.on('pageerror', error => errors.push(error.message))
  let sink = null
  try {
    await page.goto(new URL(shot.url, base).href, { waitUntil: 'domcontentloaded', timeout: 90000 })
    await page.evaluate(async kind => {
      await document.fonts.ready
      if (kind === 'title') await window.titleReady
      else if (kind === 'cinematic') await window.promoCinematic.ready
      else await window.promoWall.ready
      // Background CSS assets are not covered by document.images or titleReady.
      const backgrounds = new Set()
      for (const element of document.querySelectorAll('*')) {
        for (const match of getComputedStyle(element).backgroundImage.matchAll(/url\(["']?([^"')]+)["']?\)/g)) backgrounds.add(match[1])
      }
      await Promise.all([...backgrounds].map(async url => { const image = new Image(); image.src = url; await image.decode() }))
      document.getAnimations().forEach(animation => { animation.pause(); animation.currentTime = 0 })
    }, shot.kind)
    const loadedAt = performance.now()
    sink = encoder(partial, frames)
    let lastHash = null, identicalRun = 0, maxIdenticalRun = 0, consecutiveIdenticalFrames = 0
    let initialStatus = null, finalStatus = null
    for (let index = 0; index < frames; index++) {
      const time = start + index / fps
      const sample = index === 0 || index === frames - 1 || index % 15 === 0
      const result = await page.evaluate(async ({ kind, time, sample }) => {
        if (kind === 'cinematic') window.promoCinematic.setTime(time)
        else if (kind === 'wall') await window.promoWall.setTime(time)
        document.getAnimations().forEach(animation => { animation.pause(); animation.currentTime = time * 1000 })
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        const status = sample ? (window.promoCinematic?.status() || window.promoWall?.status() || window.promoTitle?.status()) : null
        if (kind === 'wall' && [...document.querySelectorAll('video')].some(video => video.seeking || video.readyState < 2)) throw new Error('Wall screenshot reached an undecoded video seek')
        return {
          status,
          cameraTransform: sample ? getComputedStyle(document.querySelector('.video-grid,.pokemon-wall,.stage') || document.body).transform : null,
          animationTime: time,
        }
      }, { kind: shot.kind, time, sample })
      if (errors.length) throw new Error(`${shot.id}: ${errors.join('; ')}`)
      const pixels = await page.screenshot({ type: 'jpeg', quality: 95, animations: 'allow', caret: 'hide', timeout: 90000 })
      const digest = hash(pixels)
      if (digest === lastHash) { identicalRun++; consecutiveIdenticalFrames++ } else identicalRun = 0
      maxIdenticalRun = Math.max(maxIdenticalRun, identicalRun)
      lastHash = digest
      await sink.write(pixels)
      if (index === 0) initialStatus = result.status
      if (index === frames - 1) finalStatus = result.status
      if (sample) {
        const status = result.status || {}
        samples.push({ frame: index, time, cameraTransform: result.cameraTransform,
          currentTime: status.currentTime, visibleCount: status.visibleCount,
          visiblePokemonCount: status.visiblePokemonCount, pokemonCameraScale: status.pokemonCameraScale,
          videos: status.videos, sha256: digest })
      }
      if ((index + 1) % 60 === 0 || index === frames - 1) {
        console.log(JSON.stringify({ shotId: shot.id, capturedFrames: index + 1, frames, framesPerSecond: Number(((index + 1) / ((performance.now() - loadedAt) / 1000)).toFixed(2)) }))
      }
    }
    await sink.finish(); sink = null
    if (finalStatus?.errors?.length || finalStatus?.failedAssets?.length) throw new Error(`${shot.id} has failed scene assets or playback errors`)
    await fs.rename(partial, output)
    const elapsedSeconds = (performance.now() - began) / 1000
    const metadata = {
      revision: 1, shotId: shot.id, kind: shot.kind, url: shot.url, output: relative(output),
      width: 1920, height: 1080, fps, frames, duration, durationSeconds: duration, sourceDuration: shot.duration,
      transitionTail: sampleFrames === null ? extra : 0, start, sample: sampleFrames !== null,
      timingMethod, frameTimes: { first: start, last: start + (frames - 1) / fps, step: 1 / fps },
      codec: 'h264', pixelFormat: 'yuv420p', audio: false, screenshotFormat: 'jpeg', screenshotQuality: 95,
      fingerprint, sourceHashes, sha256: await hashFile(output),
      loadingSeconds: (loadedAt - began) / 1000, elapsedSeconds,
      framesPerSecond: frames / ((performance.now() - loadedAt) / 1000),
      consecutiveIdenticalFrames, maxIdenticalRun,
      initialStatus, status: finalStatus, samples, errors, generatedAt: new Date().toISOString(),
    }
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2) + '\n')
    console.log(JSON.stringify({ shotId: shot.id, rendered: true, frames, duration, elapsedSeconds: Number(elapsedSeconds.toFixed(2)), maxIdenticalRun, output: relative(output) }))
  } finally {
    if (sink) await sink.abort()
    await context.close()
  }
}

try {
  let next = 0
  const worker = async () => { while (next < selected.length) await renderShot(selected[next++]) }
  const results = await Promise.allSettled(Array.from({ length: Math.min(workers, selected.length) }, worker))
  const failures = results.filter(result => result.status === 'rejected')
  if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Deterministic scene rendering failed')
} finally { await browser.close() }
