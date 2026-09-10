import { createRequire } from 'node:module'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import crypto from 'node:crypto'
import { resolveChromiumExecutable } from './browserRuntime.mjs'
import { PROMO_GIMMICK_GROUPS } from '../fixtures.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(import.meta.url)
const ffmpeg = process.env.FFMPEG_PATH || require('ffmpeg-static')
const runtimeModules = process.env.PROMO_NODE_MODULES || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules')
let chromium
try { ({ chromium } = require('playwright')) } catch { ({ chromium } = require(path.join(runtimeModules, 'playwright'))) }
const base = process.env.PROMO_BASE_URL || 'http://127.0.0.1:5184'
const raw = path.join(root, 'promo/raw')
await fs.mkdir(raw, { recursive: true })
const battleSourceFiles = ['src/BattleScreen.jsx', 'src/battleGen5.css', 'promo/capture.jsx', 'promo/capture.css']
const battleSourceHashes = Object.fromEntries(await Promise.all(battleSourceFiles.map(async file =>
  [file, crypto.createHash('sha256').update(await fs.readFile(path.join(root, file))).digest('hex')],
)))
const variants = process.argv.includes('--variants')
const shots = variants
  ? PROMO_GIMMICK_GROUPS.flatMap(group => group.variants.map(variant => ({ id: `take-${variant.sceneId}`, kind: 'battle', url: variant.url, duration: group.captureDuration })))
  : JSON.parse(await fs.readFile(path.join(root, 'promo/timeline.json'), 'utf8'))
const only = process.argv.slice(2).filter(arg => !arg.startsWith('--'))
const browser = await chromium.launch({
  executablePath: await resolveChromiumExecutable(chromium),
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
})

try {
  const captureShot = async shot => {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, reducedMotion: 'no-preference', recordVideo: { dir: raw, size: { width: 1920, height: 1080 } } })
    await context.addInitScript(() => {
      // Capture the game's actual Web Audio output without altering its synthesis.
      const originalConnect = AudioNode.prototype.connect
      const outputs = new Map()
      AudioNode.prototype.connect = function(destination, ...args) {
        const result = originalConnect.call(this, destination, ...args)
        if (destination instanceof AudioDestinationNode) {
          let tap = outputs.get(this.context)
          if (!tap) { tap = this.context.createMediaStreamDestination(); outputs.set(this.context, tap) }
          originalConnect.call(this, tap)
        }
        return result
      }
      window.promoAudio = {
        start() {
          const tap = [...outputs.values()].at(-1)
          if (!tap) return false
          const chunks = []
          const recorder = new MediaRecorder(tap.stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 160000 })
          recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
          this.recorder = recorder; this.chunks = chunks; recorder.start(); return true
        },
        async stop() {
          if (!this.recorder) return null
          const done = new Promise(resolve => { this.recorder.onstop = resolve })
          this.recorder.stop(); await done
          const bytes = new Uint8Array(await new Blob(this.chunks).arrayBuffer())
          let binary = ''; for (let i=0;i<bytes.length;i+=8192) binary += String.fromCharCode(...bytes.subarray(i,i+8192))
          return btoa(binary)
        },
      }
    })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto(base + shot.url, { waitUntil: 'domcontentloaded', timeout: 90000 })
    await page.evaluate(() => document.fonts.ready)
    if (shot.kind === 'battle') {
      await page.evaluate(() => window.promo.ready)
      await page.evaluate(() => window.promo.start())
    }
    if (shot.kind === 'showcase') await page.evaluate(() => window.promoShowcase?.ready)
    if (shot.kind === 'cinematic') await page.evaluate(() => window.promoCinematic.ready)
    if (shot.kind === 'wall') await page.evaluate(() => window.promoWall.ready)
    if (shot.kind === 'title') await page.evaluate(() => window.titleReady)
    await page.waitForTimeout(1600)
    const battleLayout = shot.kind === 'battle' ? await page.evaluate(() => {
      const camera = document.querySelector('.battle-field-camera')
      return {
        width: camera.clientWidth, height: camera.clientHeight,
        stages: [...camera.querySelectorAll('.battle-pokemon-stage')].map(stage => ({
          side: stage.classList.contains('player') ? 'player' : 'opponent',
          width: stage.offsetWidth, height: stage.offsetHeight,
          centerX: (stage.offsetLeft + stage.offsetWidth / 2) / camera.clientWidth,
          bottom: (camera.clientHeight - stage.offsetTop - stage.offsetHeight) / camera.clientHeight,
        })),
      }
    }) : undefined
    await page.screenshot({ path: path.join(raw, `${shot.id}-before.png`), timeout: 90000 })
    // A removed solid-color marker gives the video an exact audio sync origin.
    // Browser recording may stop before page.close returns, so wall-clock tail
    // subtraction alone is not precise enough for move impact sound effects.
    await page.evaluate(() => {
      const marker = document.createElement('div'); marker.id = 'promo-sync-marker'
      marker.style.cssText = 'position:fixed;inset:0;background:rgb(0,255,0);z-index:2147483647'
      document.body.append(marker)
    })
    // Commit the marker to a painted frame before timing its hold. Under load,
    // a timer alone can elapse before the compositor presents the green frame.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await page.screenshot({ timeout: 90000 })
    await page.waitForTimeout(650)
    const start = Date.now()
    const audio = await page.evaluate(async kind => {
      document.getElementById('promo-sync-marker').remove()
      const recording = window.promoAudio.start()
      if (kind === 'battle') window.promo.play()
      if (kind === 'showcase') window.promoShowcase?.play?.()
      if (kind === 'cinematic') window.promoCinematic.play()
      if (kind === 'wall') await window.promoWall.play()
      if (kind === 'title') document.getAnimations().forEach(a => { a.currentTime = 0; a.play() })
      return recording
    }, shot.kind)
    const captureDuration = shot.captureDuration ?? shot.duration
    await page.waitForTimeout((captureDuration + .25) * 1000)
    const audioData = await page.evaluate(() => window.promoAudio.stop())
    if (audioData) await fs.writeFile(path.join(raw, `${shot.id}-audio.webm`), Buffer.from(audioData, 'base64'))
    await page.screenshot({ path: path.join(raw, `${shot.id}-after.png`), timeout: 90000 })
    const status = await page.evaluate(() => window.promo?.status?.() || window.promoShowcase?.status?.() || window.promoCinematic?.status?.() || window.promoWall?.status?.() || window.promoTitle?.status?.() || null)
    const productionLabels = await page.evaluate(() => {
      const labels = new Set()
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      while (walker.nextNode()) {
        const node = walker.currentNode, parent = node.parentElement
        if (!parent || parent.closest('script,style')) continue
        const text = node.textContent.trim()
        if (/실제 게임 화면|프로모션 연출|홍보용 연출|실제 배틀 촬영/.test(text)) labels.add(text)
      }
      return [...labels]
    })
    const events = await page.evaluate(() => {
      const events = window.promo?.events || []
      const origin = events.find(event => event.event === 'play')?.time
      return Number.isFinite(origin) ? events.filter(event => event.time >= origin).map(({time,...event}) => ({...event,seconds:(time-origin)/1000})) : []
    })
    const video = page.video()
    const videoTailSeconds = (Date.now()-start)/1000
    await page.close()
    await context.close()
    await video.saveAs(path.join(raw, `${shot.id}.webm`))
    await video.delete()
    const pixels = spawnSync(ffmpeg, ['-hide_banner','-loglevel','error','-i',path.join(raw,`${shot.id}.webm`),'-vf','fps=25,scale=4:4:flags=neighbor,format=rgb24','-f','rawvideo','pipe:1'], { windowsHide:true, maxBuffer:1024*1024 })
    if (pixels.status !== 0) throw new Error(pixels.stderr.toString())
    let markerEnd = -1
    const frameBytes = 4 * 4 * 3
    for (let frame=0;frame<pixels.stdout.length;frame+=frameBytes) {
      let greenPixels = 0
      for (let i=frame;i<frame+frameBytes;i+=3) if(pixels.stdout[i]<30 && pixels.stdout[i+1]>220 && pixels.stdout[i+2]<30) greenPixels++
      if (greenPixels >= 15) markerEnd=frame/frameBytes
    }
    if (markerEnd < 0) throw new Error(`Missing video/audio sync marker in ${shot.id}`)
    const syncStartSeconds = (markerEnd+1)/25
    const metadata = { id: shot.id, duration: shot.duration, captureDuration, syncStartSeconds, videoTailSeconds, recordedActionMs: Date.now()-start, audio, status, events, errors, productionLabels, ...(battleLayout ? { battleLayout, battleSourceHashes } : {}) }
    await fs.writeFile(path.join(raw, `${shot.id}.json`), JSON.stringify(metadata, null, 2))
    console.log(JSON.stringify({ id: shot.id, captureDuration, audio, errors, ...(battleLayout ? { battleLayout } : {}), status }))
  }
  const selected = shots.filter(s => !only.length || only.includes(s.id))
  if (only.some(id => !shots.some(shot => shot.id === id))) throw new Error('Unknown capture ID')
  let next = 0
  const failures = []
  const worker = async () => {
    while (next < selected.length) {
      const shot = selected[next++]
      try { await captureShot(shot) }
      catch (error) {
        failures.push({ id: shot.id, error: error.stack || String(error) })
        console.error(`Capture failed: ${shot.id}: ${error.message}`)
      }
    }
  }
  await Promise.all(Array.from({ length: variants && !process.argv.includes('--serial') ? 2 : 1 }, worker))
  await fs.writeFile(path.join(raw, 'capture-failures.json'), JSON.stringify(failures, null, 2))
  if (failures.length) throw new Error(`Failed captures (retry these IDs): ${failures.map(failure => failure.id).join(', ')}. See promo/raw/capture-failures.json`)
} finally { await browser.close() }
