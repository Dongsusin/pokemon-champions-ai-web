import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { resolveChromiumExecutable } from '../../scripts/browserRuntime.mjs'

// Films the shipped game in a landscape phone viewport. The local usage-test
// launcher supplies offline auth and a loopback ranked backend, so no production
// account, database or save data is touched.
if (process.env.NODE_ENV === 'production' || process.env.VERCEL) throw Error('Local capture only')
const root = fileURLToPath(new URL('../../../', import.meta.url))
const output = path.join(root, 'promo/mobile/generated/footage')
await fs.mkdir(output, { recursive: true })

const VIEWPORT = { width: 932, height: 430 }
const ORIGIN = 'http://127.0.0.1:5186'
const PHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
const sourcePaths = [
  'src/mobileViewport.js', 'src/mobileReferenceLayout.css', 'src/mobileLandscape.css', 'src/mobileTouch.css', 'src/mobileUiV2.css',
  'src/HatchScreen.jsx', 'src/BoxScreen.jsx', 'src/TrainingScreen.jsx', 'src/BattleSelectScreen.jsx', 'src/CompetitionScreen.jsx',
  'src/BattleScreen.jsx', 'src/screenRedesign.css', 'src/battleGen5.css', 'src/styles.css', 'promo/mobile/capture/capture.mjs',
]
const sourceGameCommit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, windowsHide: true, encoding: 'utf8' }).stdout.trim()
const sourceGameFiles = await Promise.all(sourcePaths.map(async relativePath => {
  const content = await fs.readFile(path.join(root, relativePath))
  return { path: relativePath, bytes: content.length, sha256: createHash('sha256').update(content).digest('hex') }
}))
const sourceWorkingTreeChanged = Boolean(spawnSync('git', ['status', '--porcelain', '--', ...sourcePaths], { cwd: root, windowsHide: true, encoding: 'utf8' }).stdout.trim())

const require = createRequire(new URL('../../package.json', import.meta.url))
const { chromium } = require('playwright')
const ffmpeg = require('ffmpeg-static')
const shots = [], errors = [], offOrigin = new Set()
let server, browser, context, page, phase = 'setup'

const pause = seconds => page.waitForTimeout(seconds * 1000)
const reachable = async () => fetch(ORIGIN).then(response => response.ok, () => false)

async function startServer() {
  if (await reachable()) { console.log('Reusing the local usage-test server already on 5186'); return null }
  const child = spawn(process.execPath, ['scripts/startPokemonUsageTest.mjs'], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', chunk => process.stdout.write(`[server] ${chunk}`))
  child.stderr.on('data', chunk => process.stderr.write(`[server] ${chunk}`))
  for (let attempt = 0; attempt < 80; attempt++) {
    if (await reachable()) return child
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  throw new Error('The local usage-test server did not start on 5186')
}

async function loaded() {
  await page.evaluate(() => document.fonts.ready)
  let verified
  for (let attempt = 0; attempt < 5; attempt++) {
    verified = await page.evaluate(async () => {
      const nodes = [...document.querySelectorAll('img,image')].filter(node => {
        const bounds = node.getBoundingClientRect()
        return bounds.width > 0 && bounds.height > 0 && getComputedStyle(node).visibility !== 'hidden'
      })
      const urls = [...new Set(nodes.map(node => node.currentSrc || node.src || node.href?.baseVal).filter(value => typeof value === 'string' && value))]
      return Promise.all(urls.map(src => new Promise(resolve => {
        const image = new Image()
        const timeout = setTimeout(() => resolve({ src, loaded: false }), 12000)
        image.onload = () => { clearTimeout(timeout); resolve({ src, loaded: image.naturalWidth > 0 }) }
        image.onerror = () => { clearTimeout(timeout); resolve({ src, loaded: false }) }
        image.src = src
      })))
    })
    if (verified.every(image => image.loaded)) break
    await pause(1)
  }
  await pause(.4)
  return verified
}

// A full-viewport green frame marks the clean start of every take inside the
// single continuous session recording.
async function shot(id, duration, action = async () => {}) {
  phase = `capture ${id}`
  const visibleImages = await loaded()
  await page.mouse.move(VIEWPORT.width - 2, VIEWPORT.height - 2)
  await page.evaluate(() => {
    const marker = document.createElement('div')
    marker.id = 'capture-marker'
    marker.style.cssText = 'position:fixed;inset:0;background:rgb(0,255,0);z-index:2147483647'
    document.body.append(marker)
  })
  await pause(.65)
  await page.evaluate(() => document.getElementById('capture-marker').remove())
  const start = Date.now()
  const item = { id, duration, viewport: VIEWPORT, image: path.join(output, `${id}.png`), wallStart: start, visibleImages, mobileLayout: await page.evaluate(() => document.documentElement.dataset.mobileLayout) }
  shots.push(item)
  await page.screenshot({ path: item.image })
  await action()
  await pause(Math.max(0, duration + 1.2 - (Date.now() - start) / 1000))
  item.recordedDuration = (Date.now() - start) / 1000
  item.visibleText = await page.locator('body').innerText()
  item.visibleImagesEnd = await loaded()
  await page.screenshot({ path: path.join(output, `${id}-end.png`) })
  if (item.mobileLayout !== 'landscape') errors.push(`${id} filmed outside the landscape mobile layout: ${item.mobileLayout}`)
  console.log('SHOT', id, item.recordedDuration.toFixed(1), item.mobileLayout)
}

const tap = async (locator, settle = .55) => { await locator.click(); await pause(settle) }
const button = name => page.getByRole('button', { name, exact: false }).first()
async function tapButton(name, settle = .55, timeout = 25000) {
  const target = button(name)
  await target.waitFor({ state: 'visible', timeout })
  await tap(target, settle)
}
async function tapIf(locator, settle = .55) {
  if (await locator.count() && await locator.first().isVisible().catch(() => false)) { await tap(locator.first(), settle); return true }
  return false
}
// The landscape lobby is the landing screen and the bottom tab bar returns to it.
async function toLobby() {
  for (let attempt = 0; attempt < 5; attempt++) {
    if (await page.locator('.mode-grid').count()) return
    if (await tapIf(page.getByRole('button', { name: /^메인$/ }), 1)) continue
    if (await tapIf(page.getByRole('button', { name: /로비|뒤로|돌아/ }), 1)) continue
    await page.goto(ORIGIN, { waitUntil: 'domcontentloaded' })
    await pause(2.5)
  }
}

try {
  server = await startServer()
  browser = await chromium.launch({ executablePath: await resolveChromiumExecutable(chromium), headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] })
  context = await browser.newContext({
    viewport: VIEWPORT, deviceScaleFactor: 1, isMobile: true, hasTouch: true, userAgent: PHONE,
    recordVideo: { dir: output, size: VIEWPORT },
  })
  page = await context.newPage()
  // The game preloads its own assets, so requests are audited rather than
  // aborted; every off-origin host reached during the take is recorded.
  page.on('request', request => {
    const target = new URL(request.url())
    if (target.origin !== ORIGIN && target.origin !== 'http://127.0.0.1:8788') offOrigin.add(target.origin)
  })
  page.setDefaultTimeout(45000)
  page.on('pageerror', error => { errors.push(error.message); console.error('BROWSER', error.message) })
  await page.goto(ORIGIN, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.mode-grid', { timeout: 60000 })
  await pause(2.6)
  await loaded()

  // 1. Lobby: the landscape home with the team panel and the play menu.
  await shot('lobby', 8, async () => {
    await pause(3)
    await page.mouse.move(466, 215); await pause(1)
  })

  // 2. Draw: the rate table moved behind its own button on phones.
  await tapButton(/포켓몬 뽑기/, 2)
  await loaded()
  await shot('draw', 12, async () => {
    await pause(3.2)
    await tapIf(page.locator('.draw-rate-toggle'), 3)
    await tapIf(page.locator('.draw-banner-card, .draw-banner-select button').nth(1), 1.6)
  })
  await toLobby()

  // 3. Box: the list and the per-Pokemon setting panel side by side.
  await tapButton(/박스/, 2)
  await loaded()
  await shot('box', 10, async () => {
    await pause(3)
    const cards = page.locator('.team-box-card-select')
    for (const index of [2, 5]) await tapIf(cards.nth(index), 2.1)
  })
  await toLobby()

  // 4. Training: move names and types lead the compact layout.
  await tapButton(/^트레이닝$/, 2)
  await loaded()
  await shot('training', 10, async () => {
    await pause(3)
    await tapIf(page.locator('.training-roster button, .training-pokemon-card, .training-party-card').nth(1), 2.2)
    await tapIf(page.locator('.training-move-option, .training-move-slot, .training-move-row').first(), 1.8)
  })
  await toLobby()

  // 5. Mode select: format, competition and difficulty without overlap.
  await tapButton(/시작하기/, 1.8)
  await tapButton(/AI 대전/, 1.8)
  await tapIf(page.getByRole('button', { name: /경기 방식 선택/ }), 1.4)
  await page.waitForSelector('.battle-mode-option-card', { timeout: 30000 })
  await loaded()
  await shot('modes', 9, async () => {
    await pause(2.4)
    await tapIf(page.getByRole('button', { name: /더블배틀/ }), 1.5)
    await tapIf(page.getByRole('button', { name: /리그전/ }), 1.5)
    // End on the tournament so the next screen is the match briefing.
    await tapIf(page.getByRole('button', { name: /토너먼트/ }), 1.2)
  })

  // 6. Match briefing: opponent, rules and the entry picker on one screen.
  await tapButton(/이 모드로 시작/, 1.8)
  await page.waitForSelector('.competition-team-selection', { timeout: 30000 })
  await loaded()
  await shot('prep', 9, async () => {
    await pause(2.6)
    const picks = page.locator('.competition-team-selection button')
    const total = await picks.count()
    for (let index = 0; index < Math.min(4, total); index++) {
      await picks.nth(index).click({ force: true }).catch(() => {})
      await pause(.8)
    }
  })

  // 7 & 8. Real battles: the shrunken HP cards and the 2x2 command menu.
  await tap(page.locator('.competition-current-match-panel > footer > button'), 1.2)
  await page.waitForSelector('.battle-intro-overlay', { timeout: 40000 })
  await pause(1.4)
  await tap(page.locator('.battle-intro-overlay > button'), 1.2)
  await page.waitForSelector('.battle-command-buttons', { timeout: 60000 })
  await pause(2.6)
  await loaded()
  await shot('double', 13, async () => {
    await pause(3)
    await tap(page.locator('.battle-command-buttons button').first(), 1.5)
    const moves = page.locator('.battle-move-button')
    if (await moves.count()) await tap(moves.first(), 1.4)
    const targets = page.locator('.battle-target-grid button:not(:disabled)')
    if (await targets.count()) await tap(targets.first(), 1.6)
  })
  await pause(2)
  await loaded()
  await shot('single', 13, async () => {
    await pause(3)
    const fight = page.locator('.battle-command-buttons button').first()
    if (await fight.count()) await tap(fight, 1.6)
    const moves = page.locator('.battle-move-button')
    if (await moves.count()) await tap(moves.nth(1), 1.6)
    const targets = page.locator('.battle-target-grid button:not(:disabled)')
    if (await targets.count()) await tap(targets.first(), 1.6)
  })
} catch (error) {
  errors.push({ phase, message: error.stack })
  console.error('FAIL', phase, error.stack)
  process.exitCode = 1
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {})
} finally {
  if (context) {
    const video = page?.video()
    await context.close()
    if (video) {
      const sourceVideo = path.join(output, 'session.webm')
      await video.saveAs(sourceVideo); await video.delete()
      // Locate each green marker to find the first clean frame of every take.
      const raw = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', sourceVideo, '-vf', 'fps=25,scale=4:4:flags=neighbor,format=rgb24', '-f', 'rawvideo', 'pipe:1'], { windowsHide: true, maxBuffer: 64 * 1024 * 1024 })
      if (raw.status !== 0) errors.push(raw.stderr.toString())
      const ends = []
      let wasGreen = false
      for (let frame = 0; frame + 48 <= raw.stdout.length; frame += 48) {
        let pixels = 0
        for (let pixel = frame; pixel < frame + 48; pixel += 3) if (raw.stdout[pixel] < 30 && raw.stdout[pixel + 1] > 220 && raw.stdout[pixel + 2] < 30) pixels++
        const green = pixels >= 15
        if (wasGreen && !green) ends.push(frame / 48 / 25)
        wasGreen = green
      }
      console.log('markers', ends.length, 'shots', shots.length)
      for (const [index, item] of shots.entries()) {
        item.sourceVideo = sourceVideo
        item.cleanStartSeconds = ends[index] + .08
        item.usableDuration = item.recordedDuration - .12
        item.recommendedTrimOffset = 0
        if (!Number.isFinite(item.cleanStartSeconds)) { errors.push(`Missing marker for ${item.id}`); continue }
        item.video = path.join(output, `${item.id}.mp4`)
        const cut = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(item.cleanStartSeconds), '-i', sourceVideo, '-t', String(item.usableDuration), '-an', '-r', '30', '-c:v', 'libx264', '-preset', 'fast', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', item.video], { windowsHide: true, maxBuffer: 1024 * 1024 })
        if (cut.status !== 0) errors.push(`${item.id}: ${cut.stderr.toString()}`)
      }
    }
  }
  const changed = []
  for (const item of sourceGameFiles) {
    const content = await fs.readFile(path.join(root, item.path))
    if (createHash('sha256').update(content).digest('hex') !== item.sha256) changed.push(item.path)
  }
  if (changed.length) { errors.push(`Game source changed during capture: ${changed.join(', ')}`); process.exitCode = 1 }
  await fs.writeFile(path.join(output, 'manifest.json'), JSON.stringify({
    shots, errors, offOriginHosts: [...offOrigin], viewport: VIEWPORT, sourceGameCommit, sourceWorkingTreeChanged, sourceGameFiles,
    sourceGameFilesUnchangedDuringCapture: changed.length === 0,
    imageVerification: { allVisibleImagesLoaded: shots.every(item => [...item.visibleImages, ...(item.visibleImagesEnd ?? [])].every(image => image.loaded)) },
    provenance: 'The shipped screens rendered in a 932x430 landscape phone viewport with touch emulation, served by the local usage-test launcher (offline auth, loopback ranked backend, file-backed test store). Battle outcomes come from the real engine. No production account, database or game source edit.',
  }, null, 2))
  await browser?.close()
  if (server) { server.kill(); await new Promise(resolve => server.on('close', resolve)) }
}
