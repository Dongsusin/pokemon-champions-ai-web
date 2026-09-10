import { createRequire } from 'node:module'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import { resolveChromiumExecutable } from './browserRuntime.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(import.meta.url)
const ffmpeg = process.env.FFMPEG_PATH || require('ffmpeg-static')
const runtimeModules = process.env.PROMO_NODE_MODULES || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules')
let chromium
try { ({ chromium } = require('playwright')) } catch { ({ chromium } = require(path.join(runtimeModules, 'playwright'))) }
const base = process.env.PROMO_BASE_URL || 'http://127.0.0.1:5184'
const raw = path.join(root, 'promo/raw')
await fs.mkdir(raw, { recursive: true })
const shots = JSON.parse(await fs.readFile(path.join(root, 'promo/timeline.json'), 'utf8'))
const only = process.argv.slice(2)
const browser = await chromium.launch({
  executablePath: await resolveChromiumExecutable(chromium),
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
})

try {
  for (const shot of shots.filter(s => !only.length || only.includes(s.id))) {
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
    await page.goto(base + shot.url, { waitUntil: 'networkidle', timeout: 90000 })
    await page.evaluate(() => document.fonts.ready)
    if (shot.kind === 'battle') {
      await page.evaluate(() => window.promo.ready)
      await page.evaluate(() => window.promo.start())
    }
    if (shot.kind === 'showcase') await page.evaluate(() => window.promoShowcase?.ready)
    await page.waitForTimeout(1600)
    await page.screenshot({ path: path.join(raw, `${shot.id}-before.png`) })
    // A removed solid-color marker gives the video an exact audio sync origin.
    // Browser recording may stop before page.close returns, so wall-clock tail
    // subtraction alone is not precise enough for move impact sound effects.
    await page.evaluate(() => {
      const marker = document.createElement('div'); marker.id = 'promo-sync-marker'
      marker.style.cssText = 'position:fixed;inset:0;background:rgb(0,255,0);z-index:2147483647'
      document.body.append(marker)
    })
    await page.waitForTimeout(650)
    const start = Date.now()
    const audio = await page.evaluate(kind => {
      document.getElementById('promo-sync-marker').remove()
      const recording = window.promoAudio.start()
      if (kind === 'battle') window.promo.play()
      if (kind === 'showcase') window.promoShowcase?.play?.()
      if (kind === 'title') document.getAnimations().forEach(a => { a.currentTime = 0; a.play() })
      return recording
    }, shot.kind)
    await page.waitForTimeout((shot.duration + .25) * 1000)
    const audioData = await page.evaluate(() => window.promoAudio.stop())
    if (audioData) await fs.writeFile(path.join(raw, `${shot.id}-audio.webm`), Buffer.from(audioData, 'base64'))
    await page.screenshot({ path: path.join(raw, `${shot.id}-after.png`) })
    const status = await page.evaluate(() => window.promo?.status?.() || window.promoShowcase?.status?.() || null)
    const video = page.video()
    const videoTailSeconds = (Date.now()-start)/1000
    await page.close()
    await context.close()
    await video.saveAs(path.join(raw, `${shot.id}.webm`))
    await video.delete()
    const pixels = spawnSync(ffmpeg, ['-hide_banner','-loglevel','error','-i',path.join(raw,`${shot.id}.webm`),'-vf','fps=25,scale=1:1:flags=neighbor,format=rgb24','-f','rawvideo','pipe:1'], { windowsHide:true, maxBuffer:1024*1024 })
    if (pixels.status !== 0) throw new Error(pixels.stderr.toString())
    let markerEnd = -1
    for (let i=0;i<pixels.stdout.length;i+=3) if(pixels.stdout[i]<30 && pixels.stdout[i+1]>220 && pixels.stdout[i+2]<30) markerEnd=i/3
    if (markerEnd < 0) throw new Error(`Missing video/audio sync marker in ${shot.id}`)
    const syncStartSeconds = (markerEnd+1)/25
    const metadata = { id: shot.id, duration: shot.duration, syncStartSeconds, videoTailSeconds, recordedActionMs: Date.now()-start, audio, status, errors }
    await fs.writeFile(path.join(raw, `${shot.id}.json`), JSON.stringify(metadata, null, 2))
    console.log(JSON.stringify(metadata))
  }
} finally { await browser.close() }
