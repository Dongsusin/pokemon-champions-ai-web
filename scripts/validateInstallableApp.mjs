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

const report = { origin, checks: {}, failures: [] }
const browser = await chromium.launch({ executablePath: await resolveChromiumExecutable(chromium), headless: true })
const context = await browser.newContext({ viewport: { width: 932, height: 430 }, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Mobile Safari/537.36' })
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
  await page.waitForTimeout(2500)
  const cached = await page.evaluate(async () => {
    const out = {}
    for (const name of await caches.keys()) out[name] = (await (await caches.open(name)).keys()).length
    return out
  })
  report.checks.cacheEntries = cached
  recording = true
  await context.setOffline(true)
  await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => undefined)
  await page.waitForTimeout(1500)
  const offline = await page.evaluate(() => ({
    title: document.title,
    hasRoot: Boolean(document.querySelector('#root')),
    rootChildren: document.querySelector('#root')?.childElementCount ?? 0,
    bodyText: document.body.innerText.slice(0, 120),
  }))
  report.checks.offlineLaunch = { ...offline, consoleErrors, failedRequests: failedRequests.slice(0, 12) }
  if (!offline.hasRoot || !offline.title) failures.push('the document did not load from the cache while offline')
  if (!offline.rootChildren) failures.push('the app rendered nothing while offline')
  await context.setOffline(false)

  // 5. The install affordance: iOS has no beforeinstallprompt, so there the
  // button opens the Share-menu guide instead, and neither appears once the
  // game is already running as an installed app.
  const applePage = await browser.newPage({ viewport: { width: 932, height: 430 }, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' })
  try {
    await applePage.goto(origin, { waitUntil: 'domcontentloaded' })
    await applePage.waitForSelector('.install-app-option', { timeout: 30000 })
    const box = await applePage.locator('.install-app-option').boundingBox()
    const blocker = await applePage.evaluate(() => {
      const el = document.querySelector('.install-app-option')
      const r = el.getBoundingClientRect()
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
      const style = getComputedStyle(el)
      return { rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        display: style.display, visibility: style.visibility, opacity: style.opacity, pointerEvents: style.pointerEvents,
        hit: hit ? (hit.className.toString().split(' ')[0] || hit.tagName) : 'none', covered: !(hit === el || el.contains(hit)) }
    })
    report.checks.installButtonBox = { box, ...blocker }
    await applePage.locator('.install-app-option').click({ timeout: 8000 })
    await applePage.waitForSelector('.install-guide', { timeout: 10000 })
    const guide = (await applePage.locator('.install-guide').innerText()).replace(/\s+/g, ' ').trim()
    await applePage.screenshot({ path: path.join(dist, 'install-guide.png') })
    report.checks.installAffordance = { appleOption: true, guide: guide.slice(0, 120), screenshot: 'dist/install-guide.png' }
    if (!guide.includes('홈 화면에 추가')) failures.push('the iOS install guide does not mention the Add to Home Screen step')
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
