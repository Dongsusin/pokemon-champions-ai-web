import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolveChromiumExecutable } from '../promo/scripts/browserRuntime.mjs'

// Real GameApp only: each isolated context enters the production 16:9 iframe.
// The local boss server supplies a guest roster; no online match or room is created.
const baseUrl = process.env.BOSS_RELEASE_TEST_URL || 'http://127.0.0.1:5208/'
const output = new URL('./.cache/boss-release-hub/', import.meta.url)
await fs.mkdir(output, { recursive: true })
const require = createRequire(new URL('../promo/package.json', import.meta.url))
const { chromium } = require('playwright')
const browser = await chromium.launch({ executablePath: await resolveChromiumExecutable(chromium), headless: true })
const cases = [{ id: 'desktop', width: 1600, height: 900 }, { id: 'mobile', width: 844, height: 390 }]
const modes = [
  { id: 'ranked', title: '레이팅 배틀', screen: '.ranked-screen', back: '.ranked-header .screen-back-button' },
  { id: 'ai', title: 'AI 대전', screen: '.ai-format-selection-screen', back: '.battle-select-header .screen-back-button' },
  { id: 'factory', title: '배틀팩토리', screen: '.battle-factory', back: '.factory-back' },
  { id: 'rooms', title: '대전방', screen: '.rooms-screen', back: '.rooms-header .screen-back-button' },
  { id: 'raid', title: '보스전', screen: '.boss-challenge', back: '.boss-page-header > button' },
]
const metrics = [], failures = []
try {
  for (const device of cases) {
    const context = await browser.newContext({ viewport: { width: device.width, height: device.height }, screen: { width: device.width, height: device.height }, hasTouch: device.id === 'mobile', isMobile: device.id === 'mobile', reducedMotion: 'reduce' })
    await context.addInitScript(() => localStorage.setItem('champions-settings-v1', JSON.stringify({ game: { textScale: 1 }, audio: { enabled: false } })))
    const page = await context.newPage()
    page.setDefaultTimeout(20_000)
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    try {
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
      const iframe = page.locator('iframe[data-game-frame]')
      await iframe.waitFor()
      const frame = await (await iframe.elementHandle()).contentFrame()
      assert(frame, `${device.id}: actual game iframe`)
      await frame.getByRole('button', { name: /시작하기/ }).click()
      await frame.locator('.battle-hub.mode-hub').waitFor()
      await frame.evaluate(() => document.fonts.ready)
      assert.equal(await frame.getByRole('tab').count(), 5)
      const tabs = frame.getByRole('tab')
      await tabs.first().focus()
      for (const [key, expected] of [['End', 4], ['ArrowRight', 0], ['ArrowLeft', 4], ['Home', 0], ['ArrowRight', 1]]) {
        await page.keyboard.press(key)
        assert.equal(await tabs.nth(expected).getAttribute('aria-selected'), 'true', `${device.id}: ${key} selects expected tab`)
        assert(await tabs.nth(expected).evaluate(node => node === document.activeElement), `${device.id}: keyboard focus follows selected tab`)
        assert.equal(await frame.locator('[role=tab][tabindex="0"]').count(), 1)
      }
      await page.keyboard.press('Tab')
      assert(await frame.locator('.battle-hub-overview').evaluate(node => node === document.activeElement), `${device.id}: Tab reaches selected panel`)
      await page.keyboard.press('Tab')
      assert(await frame.locator('.battle-hub-enter').evaluate(node => node === document.activeElement), `${device.id}: Tab reaches mode action`)
      for (const mode of modes) {
        await frame.getByRole('tab', { name: mode.title, exact: true }).click()
        await frame.locator('.battle-hub-overview h2').filter({ hasText: mode.title }).waitFor()
        assert(await frame.locator('.battle-hub-overview p').isVisible(), `${device.id}/${mode.id}: mode description visible`)
        await frame.waitForFunction(() => [...document.querySelectorAll('.battle-hub-art img')].every(img => img.complete && img.naturalWidth > 0))
        const layout = await frame.evaluate(() => {
          const rect = node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom } }
          const selectors = ['.topbar', '.battle-hub.mode-hub', '.battle-hub-header', '.battle-hub-feature', '.battle-hub-dock', '.battle-hub-enter', ...Array.from({ length: 5 }, (_, i) => `.battle-hub-tab:nth-child(${i + 1})`)]
          const boxes = selectors.map(selector => ({ selector, ...rect(document.querySelector(selector)) }))
          const tabOverflow = [...document.querySelectorAll('.battle-hub-tab')].flatMap(tab => {
            const r = rect(tab)
            return [...tab.children].filter(child => { const c = rect(child); return c.width > 0 && c.height > 0 && (c.x < r.x - 2 || c.y < r.y - 2 || c.right > r.right + 2 || c.bottom > r.bottom + 2) }).map(child => ({ tab: tab.textContent, child: child.textContent || child.tagName }))
          })
          const overview = document.querySelector('.battle-hub-overview')
          const action = document.querySelector('.battle-hub-enter'), a = rect(action)
          const target = document.elementFromPoint(a.x + a.width / 2, a.y + a.height / 2)
          return { viewport: { width: innerWidth, height: innerHeight }, scroll: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }, boxes, tabOverflow,
            overview: { ...rect(overview), clientWidth: overview.clientWidth, scrollWidth: overview.scrollWidth }, actionHit: action.contains(target),
            visibleImages: [...document.querySelectorAll('.battle-hub-art img')].map(img => ({ src: img.currentSrc, loaded: img.complete && img.naturalWidth > 0 })) }
        })
        const host = await page.evaluate(() => { const f = document.querySelector('iframe[data-game-frame]'), r = f.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight } })
        metrics.push({ device: device.id, mode: mode.id, host, ...layout })
        assert.deepEqual(layout.viewport, device.id === 'mobile' ? { width: 960, height: 540 } : { width: 1600, height: 900 })
        assert(Math.abs(host.width / host.height - 16 / 9) < .002)
        assert(host.x >= -1 && host.y >= -1 && host.right <= device.width + 1 && host.bottom <= device.height + 1, `${device.id}: game iframe cropped`)
        assert(host.scrollWidth <= device.width && host.scrollHeight <= device.height, `${device.id}: host scroll`)
        assert(layout.scroll.width <= layout.viewport.width + 1 && layout.scroll.height <= layout.viewport.height + 1, `${device.id}/${mode.id}: game page scroll`)
        for (const box of layout.boxes) assert(box.width > 0 && box.height > 0 && box.x >= -2 && box.y >= -2 && box.right <= layout.viewport.width + 2 && box.bottom <= layout.viewport.height + 2, `${device.id}/${mode.id}: ${box.selector} outside viewport ${JSON.stringify(box)}`)
        assert.deepEqual(layout.tabOverflow, [], `${device.id}/${mode.id}: tab child overflow`)
        assert(layout.overview.scrollWidth <= layout.overview.clientWidth + 2, `${device.id}/${mode.id}: description horizontal overflow`)
        assert(layout.actionHit, `${device.id}/${mode.id}: action obscured`)
        const bySelector = Object.fromEntries(layout.boxes.map(box => [box.selector, box]))
        const feature = bySelector['.battle-hub-feature'], dock = bySelector['.battle-hub-dock'], header = bySelector['.battle-hub-header']
        assert(header.bottom <= feature.y + 1 && feature.bottom <= dock.y + 1, `${device.id}/${mode.id}: header/feature/tabs overlap`)
        await page.screenshot({ path: new URL(`${device.id}-${mode.id}-hub.png`, output).pathname.replace(/^\/(.:)/, '$1') })
        await frame.locator('.battle-hub-enter').click()
        await frame.locator(mode.screen).waitFor()
        if (mode.id === 'factory') {
          assert.equal(await frame.getByRole('radiogroup', { name: '배틀팩토리 모드 선택' }).count(), 1)
          assert.equal(await frame.getByRole('radio').count(), 2)
          const challenge = frame.getByRole('radio').filter({ hasText: '도전 모드' })
          await challenge.click()
          assert.equal(await challenge.getAttribute('aria-checked'), 'true', 'Latest main challenge choice still works')
          await page.screenshot({ path: new URL(`${device.id}-factory-challenge.png`, output).pathname.replace(/^\/(.:)/, '$1') })
        }
        await frame.locator(mode.back).first().click()
        await frame.locator('.battle-hub.mode-hub').waitFor()
        assert.equal(await frame.getByRole('tab', { name: mode.title, exact: true }).getAttribute('aria-selected'), 'true', `${device.id}/${mode.id}: remembered selection after back`)
        console.log(`PASS ${device.id}: ${mode.title} layout, entry, return`)
      }
      assert.deepEqual(errors, [], `${device.id}: browser exceptions`)
    } catch (error) {
      failures.push({ device: device.id, message: error.stack, errors })
      await page.screenshot({ path: new URL(`${device.id}-failure.png`, output).pathname.replace(/^\/(.:)/, '$1') }).catch(() => {})
      console.error(`FAIL ${device.id}: ${error.message}`)
    } finally { await context.close() }
  }
} finally {
  await browser.close()
  await fs.writeFile(new URL('metrics.json', output), JSON.stringify({ baseUrl, metrics, failures }, null, 2))
}
assert.equal(failures.length, 0, JSON.stringify(failures, null, 2))
console.log('PASS: 10 real GameApp mode entries/returns, keyboard navigation, viewport and CTA checks, factory challenge preserved')
