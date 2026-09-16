import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolveChromiumExecutable } from '../../scripts/browserRuntime.mjs'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
const base = process.env.PROMO_BASE_URL || 'http://127.0.0.1:5184'
const timeline = JSON.parse(await fs.readFile(new URL('../timeline.json', import.meta.url), 'utf8'))
const expectedDuration = timeline.reduce((sum, shot) => sum + shot.duration, 0)
let chapterStart = 0
const expectedChapters = timeline.map(shot => { const start = chapterStart; chapterStart += shot.duration; return start })
const browser = await chromium.launch({ executablePath: await resolveChromiumExecutable(chromium), headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] })
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
const errors = [], cancelledMediaRequests = []
page.on('pageerror', e => errors.push(e.message))
page.on('requestfailed', r => {
  const detail = `${r.url()}: ${r.failure()?.errorText}`
  // Seeking legitimately cancels the former MP4 range request.
  if (r.resourceType() === 'media' && r.failure()?.errorText === 'net::ERR_ABORTED') cancelledMediaRequests.push(detail)
  else errors.push(detail)
})
let report
try {
  await page.goto(`${base}/promo/mobile/preview.html`, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => document.querySelector('video').readyState >= 3)
  const metadata = await page.evaluate(() => {
    const v = document.querySelector('video')
    return { duration: v.duration, width: v.videoWidth, height: v.videoHeight, chapters: [...document.querySelectorAll('[data-time]')].map(b => Number(b.dataset.time)) }
  })
  await page.evaluate(async () => {
    const v = document.querySelector('video')
    window.__playback = { waiting: [], stalls: [], errors: [], ended: false, startedAt: performance.now() }
    v.addEventListener('waiting', () => window.__playback.waiting.push(v.currentTime))
    v.addEventListener('stalled', () => window.__playback.stalls.push(v.currentTime))
    v.addEventListener('error', () => window.__playback.errors.push(v.error?.message || String(v.error?.code)))
    v.addEventListener('ended', () => { window.__playback.ended = true; window.__playback.endedAt = performance.now() })
    v.muted = true
    v.currentTime = 0
    await v.play()
  })
  console.log(`Playing complete ${metadata.duration}s preview in Chromium`)
  await page.waitForFunction(() => window.__playback.ended, null, { timeout: 140000 })
  const playback = await page.evaluate(() => {
    const v = document.querySelector('video'), q = v.getVideoPlaybackQuality()
    return { ...window.__playback, currentTime: v.currentTime, quality: { totalVideoFrames: q.totalVideoFrames, droppedVideoFrames: q.droppedVideoFrames, corruptedVideoFrames: q.corruptedVideoFrames } }
  })
  // Exercise the actual preview's chapter controls after the uninterrupted run.
  const chapterChecks = []
  const sampled = [1, 3, 5, 7].map(index => metadata.chapters[index]).filter(Number.isFinite)
  for (const time of [...new Set([...sampled, metadata.chapters.at(-1)])]) {
    await page.locator(`[data-time="${time}"]`).click()
    await page.waitForFunction(t => Math.abs(document.querySelector('video').currentTime - t) < 1.5, time)
    await page.waitForFunction(() => { const v = document.querySelector('video'); return v.readyState >= 3 && !v.paused && !v.seeking })
    await page.evaluate(() => document.querySelector('video').pause())
    chapterChecks.push({ requested: time, actual: await page.locator('video').evaluate(v => v.currentTime) })
  }
  report = { generatedAt: new Date().toISOString(), expectedDuration, metadata, playback, chapterChecks, cancelledMediaRequests, errors,
    passed: metadata.duration === expectedDuration && JSON.stringify(metadata.chapters) === JSON.stringify(expectedChapters) && metadata.width === 1920 && metadata.height === 1080 && playback.ended && !playback.errors.length && !errors.length,
    scope: 'Complete muted video playback and chapter controls in an isolated Chromium browser. Human visual review is recorded separately; this does not claim subjective listening.' }
} catch (error) { report = { passed: false, errors: [...errors, error.message] } }
finally { await browser.close() }
await fs.writeFile(new URL('../output/playback-validation.json', import.meta.url), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
if (!report.passed) process.exitCode = 1
