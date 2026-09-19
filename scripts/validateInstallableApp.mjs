import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { resolveChromiumExecutable } from '../promo/scripts/browserRuntime.mjs'

// Serves the production build over loopback and checks the things a browser
// actually requires before it offers to install the game: a parsable manifest
// with 192px and 512px icons that resolve, a controlling service worker, and a
// launch that still works with the network switched off.
const root = fileURLToPath(new URL('../', import.meta.url))
const dist = path.join(root, 'dist')
const require = createRequire(new URL('../promo/package.json', import.meta.url))
const { chromium } = require('playwright')

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2', '.woff': 'font/woff',
}
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1')
  let file = path.join(dist, decodeURIComponent(url.pathname))
  try {
    const stats = await fs.stat(file).catch(() => null)
    if (!stats || stats.isDirectory()) file = path.join(dist, 'index.html')
    const body = await fs.readFile(file)
    response.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' })
    response.end(body)
  } catch {
    response.writeHead(404).end('not found')
  }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`

async function isolateNetwork(context) {
  // PWA checks must never log in or call the production API. All game assets
  // are served by the isolated production build above.
  await context.route('**/*', route => new URL(route.request().url()).origin === origin
    ? route.continue() : route.abort())
}

async function gameDocument(page) {
  const element = await page.waitForSelector('iframe[data-game-frame]', { timeout: 30000 })
  const frame = await element.contentFrame()
  assert(frame, 'the game iframe did not create its document')
  return frame
}

const report = { origin, checks: {}, failures: [] }
const browser = await chromium.launch({ executablePath: await resolveChromiumExecutable(chromium), headless: true })
const context = await browser.newContext({ viewport: { width: 932, height: 430 }, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Mobile Safari/537.36' })
await isolateNetwork(context)
await context.addInitScript(() => {
  if (window !== window.top) return
  // A synthetic event checks the parent/child bridge without opening a native
  // installation prompt or changing anything on the tester's machine.
  window.__installTestCalls = 0
  const observer = new MutationObserver(() => {
    if (!document.querySelector('iframe[data-game-frame]')) return
    observer.disconnect()
    const event = new Event('beforeinstallprompt', { cancelable: true })
    event.prompt = () => { window.__installTestCalls += 1 }
    event.userChoice = Promise.resolve({ outcome: 'accepted' })
    window.dispatchEvent(event)
  })
  observer.observe(document, { childList: true, subtree: true })
})
const page = await context.newPage()
const failures = []
const consoleErrors = []
const failedRequests = []
let recording = false
page.on('console', message => { if (recording && message.type() === 'error') consoleErrors.push(message.text().slice(0, 200)) })
page.on('pageerror', error => { if (recording) consoleErrors.push(error.message.slice(0, 200)) })
page.on('requestfailed', request => {
  if (recording) failedRequests.push(`${request.url().replace(origin, '')} ${request.failure()?.errorText ?? ''}`.trim())
})
try {
  await page.goto(origin, { waitUntil: 'domcontentloaded' })
  const onlineGame = await gameDocument(page)
  await onlineGame.waitForSelector('.auth-login-card, .app-shell', { timeout: 30000 })
  await onlineGame.locator('.install-app-option').click({ timeout: 10000 })
  await onlineGame.waitForSelector('.install-app-option', { state: 'detached' })
  const promptCalls = await page.evaluate(() => window.__installTestCalls)
  assert.equal(promptCalls, 1, 'child install button did not invoke the retained parent prompt once')
  report.checks.parentInstallPrompt = { synthetic: true, calls: promptCalls }

  // 1. The document links a manifest and it parses.
  const manifestHref = await page.getAttribute('link[rel="manifest"]', 'href')
  assert(manifestHref, 'index.html does not link a web app manifest')
  const manifest = await (await fetch(new URL(manifestHref, origin))).json()
  report.checks.manifest = { href: manifestHref, name: manifest.name, display: manifest.display, orientation: manifest.orientation, startUrl: manifest.start_url }

  // 2. Chrome requires a 192px and a 512px icon, and each must really load.
  const sizes = new Set(manifest.icons.flatMap(icon => icon.sizes.split(' ')))
  for (const required of ['192x192', '512x512']) {
    if (!sizes.has(required)) failures.push(`manifest is missing a ${required} icon`)
  }
  const maskable = manifest.icons.filter(icon => (icon.purpose ?? '').split(' ').includes('maskable'))
  if (!maskable.length) failures.push('manifest has no maskable icon')
  const icons = []
  for (const icon of manifest.icons) {
    const response = await fetch(new URL(icon.src, origin))
    const bytes = Buffer.from(await response.arrayBuffer())
    const actual = response.ok && bytes.length > 8 ? `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}` : 'unreadable'
    if (!response.ok) failures.push(`icon ${icon.src} returned ${response.status}`)
    else if (actual !== icon.sizes) failures.push(`icon ${icon.src} declares ${icon.sizes} but is ${actual}`)
    icons.push({ src: icon.src, declared: icon.sizes, actual, purpose: icon.purpose ?? 'any' })
  }
  report.checks.icons = icons

  // 3. A service worker has to control the page for an install to be offered.
  const controlled = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready
    if (!navigator.serviceWorker.controller) {
      await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }))
    }
    return { scope: registration.scope, controller: Boolean(navigator.serviceWorker.controller) }
  })
  report.checks.serviceWorker = controlled
  if (!controlled.controller) failures.push('no service worker controls the page')

  // 4. Let the shell and its build files land in the cache, then relaunch with
  // the network cut to prove the installed app opens offline.
  const buildFiles = (await fs.readdir(path.join(dist, 'assets')))
    .filter(file => /-[\w-]{8}\.(?:m?js|css)$/.test(file)).map(file => `/assets/${file}`)
  await page.waitForFunction(async required => {
    const cache = await caches.open('champions-arena-shell-cache-v1')
    return (await Promise.all(required.map(url => cache.match(url)))).every(Boolean)
  }, buildFiles, { timeout: 30000 })
  const cached = await page.evaluate(async () => {
    const out = {}
    for (const name of await caches.keys()) out[name] = (await (await caches.open(name)).keys()).length
    return out
  })
  report.checks.cacheEntries = cached
  report.checks.precachedBuildFiles = buildFiles
  recording = true
  await context.setOffline(true)
  await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => undefined)
  const offlineGame = await gameDocument(page)
  await offlineGame.waitForSelector('.auth-login-card, .app-shell', { timeout: 30000 })
  const offline = await offlineGame.evaluate(() => ({
    title: document.title,
    hasRoot: Boolean(document.querySelector('#root')),
    rootChildren: document.querySelector('#root')?.childElementCount ?? 0,
    bodyText: document.body.innerText.slice(0, 120),
    appReady: Boolean(document.querySelector('.auth-login-card, .app-shell')),
    resourceError: Boolean(document.querySelector('.resource-loading-card.has-error')),
    logicalViewport: { width: innerWidth, height: innerHeight },
  }))
  report.checks.offlineLaunch = { ...offline, consoleErrors, failedRequests: failedRequests.slice(0, 12) }
  if (!offline.hasRoot || !offline.title) failures.push('the document did not load from the cache while offline')
  if (!offline.rootChildren || !offline.appReady || offline.resourceError) failures.push('the child game did not finish booting while offline')
  if (failedRequests.some(request => /\/assets\/[^/]+-[\w-]{8}\.(?:m?js|css)/.test(request))) failures.push('a lazy build file failed to load while offline')
  await context.setOffline(false)

  // 5. The install affordance: iOS has no beforeinstallprompt, so there the
  // button opens the Share-menu guide instead, and neither appears once the
  // game is already running as an installed app.
  const applePage = await browser.newPage({ viewport: { width: 932, height: 430 }, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' })
  await isolateNetwork(applePage.context())
  try {
    await applePage.goto(origin, { waitUntil: 'domcontentloaded' })
    const appleGame = await gameDocument(applePage)
    await appleGame.waitForSelector('.install-app-option', { timeout: 30000 })
    const box = await appleGame.locator('.install-app-option').boundingBox()
    const blocker = await appleGame.evaluate(() => {
      const el = document.querySelector('.install-app-option')
      const r = el.getBoundingClientRect()
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
      const style = getComputedStyle(el)
      return { rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        display: style.display, visibility: style.visibility, opacity: style.opacity, pointerEvents: style.pointerEvents,
        hit: hit ? (hit.className.toString().split(' ')[0] || hit.tagName) : 'none', covered: !(hit === el || el.contains(hit)) }
    })
    report.checks.installButtonBox = { box, ...blocker }
    await appleGame.locator('.install-app-option').click({ timeout: 8000 })
    await appleGame.waitForSelector('.install-guide', { timeout: 10000 })
    const guide = (await appleGame.locator('.install-guide').innerText()).replace(/\s+/g, ' ').trim()
    await applePage.screenshot({ path: path.join(dist, 'install-guide.png') })
    report.checks.installAffordance = { appleOption: true, guide: guide.slice(0, 120), screenshot: 'dist/install-guide.png' }
    if (!guide.includes('홈 화면에 추가')) failures.push('the iOS install guide does not mention the Add to Home Screen step')
    await applePage.evaluate(() => window.dispatchEvent(new Event('appinstalled')))
    await appleGame.waitForSelector('.install-app-option', { state: 'detached' })
    await appleGame.waitForSelector('.install-guide', { state: 'detached' })
    await applePage.addInitScript(() => {
      if (window === window.top) Object.defineProperty(navigator, 'standalone', { configurable: true, value: true })
    })
    await applePage.reload({ waitUntil: 'domcontentloaded' })
    const installedGame = await gameDocument(applePage)
    await installedGame.waitForSelector('.auth-login-card, .app-shell', { timeout: 30000 })
    assert.equal(await installedGame.locator('.install-app-option, .install-app-button').count(), 0,
      'child game offered installation despite the parent standalone state')
    report.checks.parentInstallState = { appInstalledEvent: true, standaloneSuppressesButton: true }
  } catch (error) {
    failures.push('install affordance: ' + error.message.split(String.fromCharCode(10))[0])
  } finally { await applePage.close() }
} catch (error) {
  failures.push(error.message)
} finally {
  await browser.close()
  server.close()
}

report.failures = failures
report.passed = failures.length === 0
await fs.writeFile(path.join(root, 'dist/install-validation.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
if (!report.passed) process.exitCode = 1
