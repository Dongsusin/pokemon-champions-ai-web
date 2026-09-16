import fs from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { resolveChromiumExecutable } from '../promo/scripts/browserRuntime.mjs'

// Serves the build and measures the login screen and the install affordance on
// landscape phones: whether the card fits without scrolling, where the install
// control sits, and whether the iOS guide is fully on screen.
const root = fileURLToPath(new URL('../', import.meta.url))
const dist = path.join(root, 'dist')
const require = createRequire(new URL('../promo/package.json', import.meta.url))
const { chromium } = require('playwright')

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.ogg': 'audio/ogg', '.woff2': 'font/woff2' }
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1')
  let file = path.join(dist, decodeURIComponent(url.pathname))
  const stats = await fs.stat(file).catch(() => null)
  if (!stats || stats.isDirectory()) file = path.join(dist, 'index.html')
  try {
    const body = await fs.readFile(file)
    response.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' })
    response.end(body)
  } catch { response.writeHead(404).end('not found') }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
const out = process.env.OUT ?? dist
const tag = process.env.TAG ?? 'x'

const browser = await chromium.launch({ executablePath: await resolveChromiumExecutable(chromium), headless: true })
try {
  for (const size of process.argv.slice(2)) {
    const [width, height] = size.split('x').map(Number)
    // Wide viewports run as a desktop browser so the control run proves the
    // desktop card is untouched.
    const phone = width < 1100
    const context = await browser.newContext({ viewport: { width, height }, ...(phone ? { isMobile: true, hasTouch: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' } : {}) })
    const page = await context.newPage()
    await page.goto(origin, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.auth-login-card', { timeout: 40000 })
    await page.waitForTimeout(1500)

    const login = await page.evaluate(() => {
      const r = (el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.x), r: Math.round(b.right), y: Math.round(b.y), b: Math.round(b.bottom), w: Math.round(b.width), h: Math.round(b.height) } }
      const shell = document.querySelector('.auth-shell')
      const card = document.querySelector('.auth-login-card')
      const install = document.querySelector('.install-app-option, .install-app-button')
      const below = [...document.querySelectorAll('.auth-shell *')]
        .filter(node => node.getBoundingClientRect().height > 0 && node.getBoundingClientRect().bottom > innerHeight + 1)
        .map(node => (node.className.toString().split(' ')[0] || node.tagName) + ':' + Math.round(node.getBoundingClientRect().bottom - innerHeight))
      return {
        viewport: { width: innerWidth, height: innerHeight },
        card: r(card),
        cardOverflowBelow: Math.max(0, r(card).b - innerHeight),
        pageScrolls: document.documentElement.scrollHeight > innerHeight + 1,
        scrollHeight: document.documentElement.scrollHeight,
        install: install ? r(install) : null,
        clippedBelowViewport: [...new Set(below)].slice(0, 8),
        brandOverlap: (() => {
          const brand = document.querySelector('.auth-brand')
          const card = document.querySelector('.auth-login-card')
          if (!brand || !card || getComputedStyle(brand).display === 'none') return 0
          const a = r(brand), b = r(card)
          return Math.max(0, Math.min(a.r, b.r) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.y, b.y))
        })(),
        actions: [...document.querySelectorAll('.auth-login-actions > button')].map(node => (node.className.toString().split(' ')[0] || node.tagName) + ' ' + JSON.stringify(r(node))),
      }
    })
    console.log(`\n=== ${size} login ===`)
    console.log('  card', JSON.stringify(login.card), 'overflowBelow=' + login.cardOverflowBelow)
    console.log('  page scrolls:', login.pageScrolls, '| scrollHeight', login.scrollHeight, 'vs', login.viewport.height)
    console.log('  install button:', JSON.stringify(login.install))
    console.log('  brand overlaps card:', login.brandOverlap, 'px2')
    console.log('  clipped below viewport:', login.clippedBelowViewport.join(', ') || 'none')
    for (const row of login.actions ?? []) console.log('  action:', row)
    await page.screenshot({ path: path.join(out, `login-${tag}-${size}.png`) })

    if (login.install) {
      await page.locator('.install-app-option, .install-app-button').first().click({ timeout: 8000 }).catch(() => {})
      await page.waitForTimeout(700)
      const guide = await page.evaluate(() => {
        const panel = document.querySelector('.install-guide')
        if (!panel) return null
        const b = panel.getBoundingClientRect()
        const previous = panel.style.pointerEvents
        panel.style.pointerEvents = 'auto'
        const probe = (x, y) => { const el = document.elementFromPoint(x, y); return Boolean(el && (el === panel || panel.contains(el))) }
        const corners = { tl: probe(b.x + 5, b.y + 5), tr: probe(b.right - 5, b.y + 5), bl: probe(b.x + 5, b.bottom - 5), br: probe(b.right - 5, b.bottom - 5) }
        panel.style.pointerEvents = previous
        return { box: { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) },
          onScreen: b.y >= 0 && b.bottom <= innerHeight && b.x >= 0 && b.right <= innerWidth,
          corners, hiddenCorners: Object.entries(corners).filter(([, ok]) => !ok).map(([k]) => k),
          text: panel.innerText.split(String.fromCharCode(10)).join(' ').slice(0, 150) }
      })
      console.log('  guide:', JSON.stringify(guide))
      await page.screenshot({ path: path.join(out, `guide-${tag}-${size}.png`) })
    }
    await context.close()
  }
} finally {
  await browser.close()
  server.close()
}
