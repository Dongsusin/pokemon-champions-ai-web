import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { resolveChromiumExecutable } from '../promo/scripts/browserRuntime.mjs'

// Run against the real local GameApp, including the topbar and PostCSS typography.
// Start it with npm run boss:test; each case gets an isolated browser context.
const baseUrl = process.env.BOSS_LAYOUT_TEST_URL || 'http://127.0.0.1:5198/'
const output = new URL('./.cache/boss-challenge-layout/', import.meta.url)
await fs.mkdir(output, { recursive: true })
const require = createRequire(new URL('../promo/package.json', import.meta.url))
const { chromium } = require('playwright')
const browser = await chromium.launch({ executablePath: await resolveChromiumExecutable(chromium), headless: true })
const cases = [
  { width: 1298, height: 698, scale: 1 },
  { width: 1615, height: 860, scale: 1 },
  { width: 844, height: 390, scale: 1 },
  { width: 1298, height: 698, scale: 1.5 },
  { width: 1298, height: 698, scale: 2 },
]
const failures = []
const metrics = []
try {
  for (const testCase of cases) {
    const { width, height, scale } = testCase
    const label = `${width}x${height}-${scale}x`
    const context = await browser.newContext({ viewport: { width, height }, screen: { width, height }, hasTouch: width < 1000, isMobile: width < 1000, reducedMotion: 'reduce' })
    await context.addInitScript(() => localStorage.setItem('champions-settings-v1', JSON.stringify({ game: { textScale: 1 }, audio: { enabled: false } })))
    const page = await context.newPage()
    page.setDefaultTimeout(20000)
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    try {
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
      await page.getByRole('button', { name: /시작하기/ }).click()
      await page.getByRole('tab', { name: '보스전', exact: true }).click()
      await page.getByRole('button', { name: '보스전에 도전', exact: true }).click()
      await page.locator('.boss-selection-workspace').waitFor()
      await page.evaluate(async scale => { const { applyGameTextScale } = await import('/src/gameTextScale.js'); applyGameTextScale(scale); await document.fonts.ready }, scale)
      await page.waitForFunction(scale => document.documentElement.dataset.gameTextScale === String(scale), scale)
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      assert.equal(await page.locator('.boss-party-roster > .ranked-pokemon-card').count(), 6)
      assert.equal(await page.locator('.boss-challenge-choices > button').count(), 3)
      const geometry = await page.evaluate(() => {
        const rect = node => { const r = node.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height } }
        const fits = (child, parent, tolerance = 2) => child.left >= parent.left - tolerance && child.top >= parent.top - tolerance && child.right <= parent.right + tolerance && child.bottom <= parent.bottom + tolerance
        const listSelectors = ['.boss-party-roster', '.boss-challenge-choices']
        const lists = listSelectors.map(selector => {
          const node = document.querySelector(selector)
          const bounds = rect(node)
          return { selector, ...bounds, clientHeight: node.clientHeight, scrollHeight: node.scrollHeight, clientWidth: node.clientWidth, scrollWidth: node.scrollWidth,
            outsideCards: [...node.children].filter(child => !fits(rect(child), bounds)).map(child => ({ text: child.textContent, bounds: rect(child) })) }
        })
        const cardSelectors = ['.boss-party-roster > .ranked-pokemon-card', '.boss-challenge-choices > button']
        const cardProblems = cardSelectors.flatMap(selector => [...document.querySelectorAll(selector)].flatMap(card => {
          const bounds = rect(card)
          return [...card.querySelectorAll('span,strong,small,img,svg')].filter(child => {
            const r = rect(child)
            return r.width > 0 && r.height > 0 && !fits(r, bounds)
          }).map(child => ({ card: card.textContent, child: child.textContent || child.tagName, bounds, childBounds: rect(child) }))
        }))
        const panels = ['.boss-challenge-party', '.boss-selection-panel'].map(selector => ({ selector, ...rect(document.querySelector(selector)) }))
        const overlaps = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2
        const overlappingCards = cardSelectors.flatMap(selector => {
          const cards = [...document.querySelectorAll(selector)].map(rect)
          return cards.flatMap((card, index) => cards.slice(index + 1).filter(other => overlaps(card, other)).map(other => ({ selector, card, other })))
        })
        return { viewport: { width: innerWidth, height: innerHeight }, topbar: rect(document.querySelector('.topbar')), main: rect(document.querySelector('.boss-challenge')), panels, panelOverlap: overlaps(...panels), lists, cardProblems, overlappingCards,
          pageHorizontalOverflow: document.documentElement.scrollWidth > innerWidth + 2, scale: getComputedStyle(document.documentElement).getPropertyValue('--game-text-scale').trim() }
      })
      metrics.push({ label, ...geometry })
      assert.equal(geometry.scale, String(scale))
      assert(geometry.topbar.height > 0 && geometry.topbar.top >= -2 && geometry.topbar.bottom <= height + 2, `${label}: topbar is not visible`)
      assert(!geometry.pageHorizontalOverflow, `${label}: document overflows horizontally`)
      assert(!geometry.panelOverlap, `${label}: team and boss panels overlap`)
      assert.deepEqual(geometry.overlappingCards, [], `${label}: cards overlap`)
      assert.equal(geometry.cardProblems.length, 0, `${label}: content protrudes outside its card; inspect metrics.json`)
      for (const list of geometry.lists) {
        if (width > 1000) assert(list.scrollHeight <= list.clientHeight + 2, `${label}: ${list.selector} requires internal vertical scrolling (${list.scrollHeight}/${list.clientHeight})`)
        assert(list.scrollWidth <= list.clientWidth + 2, `${label}: ${list.selector} overflows horizontally`)
        if (width > 1000) assert.deepEqual(list.outsideCards, [], `${label}: cards do not fit inside ${list.selector}`)
        if (scale === 1 && width > 1000) assert(list.top >= -2 && list.bottom <= height + 2, `${label}: desktop list is outside the viewport`)
      }
      if (width < 1000) {
        // Compact landscape may scroll its roster, but every card remains reachable.
        for (const card of await page.locator('.boss-party-roster > button, .boss-challenge-choices > button').all()) {
          await card.scrollIntoViewIfNeeded()
          const box = await card.boundingBox()
          assert(box && box.x >= -2 && box.y >= -2 && box.x + box.width <= width + 2 && box.y + box.height <= height + 2, `${label}: compact card is inaccessible`)
        }
      }
      const start = page.locator('.boss-start-footer button')
      const edit = page.locator('.boss-team-footer button')
      for (const control of [start, edit]) {
        await control.scrollIntoViewIfNeeded()
        const box = await control.boundingBox()
        assert(box && box.x >= -2 && box.y >= -2 && box.x + box.width <= width + 2 && box.y + box.height <= height + 2, `${label}: control is inaccessible`)
        assert(await control.isEnabled())
      }
      const firstCard = page.locator('.boss-party-roster > button').first()
      await firstCard.scrollIntoViewIfNeeded()
      if (width < 1000) await firstCard.tap()
      else await firstCard.hover()
      const tooltip = page.locator('.ranked-pokemon-tooltip[role=tooltip]')
      await tooltip.waitFor({ state: 'visible' })
      await page.waitForFunction(() => document.querySelector('.ranked-pokemon-tooltip')?.innerText.includes('지닌 도구'))
      for (const text of ['지닌 도구', '테라타입', '다이맥스', '특성', '배틀 기술']) assert((await tooltip.innerText()).includes(text), `${label}: missing tooltip ${text}`)
      const tip = await tooltip.boundingBox()
      assert(tip && tip.x >= -2 && tip.y >= -2 && tip.x + tip.width <= width + 2 && tip.y + tip.height <= height + 2, `${label}: tooltip extends outside viewport`)
      await page.keyboard.press('Escape')
      await tooltip.waitFor({ state: 'hidden' })
      await page.locator('.boss-challenge, .boss-party-roster, .boss-challenge-choices').evaluateAll(nodes => nodes.forEach(node => { node.scrollTop = 0 }))
      await page.screenshot({ path: fileURLToPath(new URL(`${label}.png`, output)) })
      assert.deepEqual(errors, [], `${label}: browser errors`)
      console.log(`PASS ${label}: full GameApp, all cards contained, controls and tooltip accessible`)
    } catch (error) {
      failures.push({ label, message: error.message.split('\n')[0] })
      await page.screenshot({ path: fileURLToPath(new URL(`${label}-failure.png`, output)) }).catch(() => {})
      console.error(`FAIL ${label}: ${error.message.split('\n')[0]}`)
    } finally { await context.close() }
  }
} finally {
  await browser.close()
  await fs.writeFile(new URL('metrics.json', output), JSON.stringify(metrics, null, 2))
}
assert.deepEqual(failures, [], 'Boss challenge full-game layout regression failed')
