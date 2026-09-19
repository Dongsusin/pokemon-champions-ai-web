import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { normalizePokemon } from '../src/data/trainingData.js'
import { migratePokemonCollection, getTrainingRosterPokemon } from '../src/data/pokemonPool.js'
import { createSavedTeams } from '../src/data/teamData.js'
import { createDefaultGameSettings, SETTINGS_STORAGE_KEY } from '../src/gameSettings.js'
import { resolveChromiumExecutable } from '../promo/scripts/browserRuntime.mjs'

// Boot the actual main.jsx host and its iframe. Only account startup is replaced
// with a seeded, real GameApp; no production account or API receives test data.
const root = fileURLToPath(new URL('../', import.meta.url))
const browserName = process.env.VIEWPORT_BROWSER ?? 'chromium'
const output = path.join(root, 'scripts/.cache/fixed-game-viewport', browserName)
await fs.mkdir(output, { recursive: true })
const collection = migratePokemonCollection([695, 937, 956, 987, 988, 1009, 376, 407, 625, 823, 812, 818, 849, 861, 911, 923, 934, 959, 968, 973, 982, 995, 1006, 1005].map((speciesId, index) => normalizePokemon({ speciesId, captureId: `viewport-${speciesId}`, directDrawCount: 1, obtainedAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString() })))
const roster = getTrainingRosterPokemon(collection)
const teams = createSavedTeams(roster.slice(0, 6).map(pokemon => pokemon.captureId), collection.map(pokemon => pokemon.captureId))
const settings = createDefaultGameSettings()
settings.audio.enabled = false
const storage = { [SETTINGS_STORAGE_KEY]: settings, 'champions-dex-v2': collection, 'champions-teams-v1': { teams, activeTeamId: 'team-1' } }
const gameEntry = await fs.readFile(path.join(root, 'src/gameEntry.jsx'), 'utf8')
const cssImports = [...gameEntry.matchAll(/^import ['"](.+\.css)['"]/gm)].map(match => `import ${JSON.stringify(`/src/${match[1].replace(/^\.\//, '')}`)};`).join('\n')
assert(cssImports.includes('mobileReferenceLayout.css') && cssImports.includes('installApp.css'), 'Use the complete application CSS order')
const entry = `import'/src/mobileViewport.js';import React,{StrictMode}from'react';import{createRoot}from'react-dom/client';import{GameApp}from'/src/App.jsx';
${cssImports}
createRoot(document.getElementById('root')).render(React.createElement(StrictMode,null,React.createElement(GameApp,{user:{uid:'viewport-ui',displayName:'guest-123456',isAnonymous:true,isLocalGuest:false},autoLogin:false,onPlayerDataChanged:()=>{},onSignOut:()=>{}})));`
process.env.VITE_POKEMON_USAGE_ENABLED = 'false'
process.env.VITE_POKEMON_USAGE_DEMO = 'false'
process.env.VITE_RANKED_LOCAL_TEST = 'false'
process.env.VITE_RANKED_ENABLED = 'true'
const port = Number(process.env.FIXED_VIEWPORT_UI_PORT ?? (browserName === 'webkit' ? 5257 : 5256))
const server = await createServer({ root, mode: 'fixed-viewport-validation', logLevel: 'error',
  plugins: [{ name: 'fixed-viewport-ui-fixture', enforce: 'pre',
    resolveId(source) {
      if (source === './gameEntry.jsx' || source.replaceAll('\\', '/').endsWith('/src/gameEntry.jsx')) return '\0fixed-viewport-game-entry'
      if (source.endsWith('/auth/firebaseClient') || source.endsWith('/auth/firebaseClient.js') || source === './firebaseClient' || source === './firebaseClient.js') return '\0fixed-viewport-auth'
    },
    load(id) {
      if (id === '\0fixed-viewport-game-entry') return entry
      if (id === '\0fixed-viewport-auth') return 'export const firebaseAuth=null;export const firebaseDb=null;export const isFirebaseConfigured=false;export const missingFirebaseEnvironmentVariables=[];'
    },
  }], server: { host: '127.0.0.1', port, strictPort: true, hmr: false } })
await server.listen()
const require = createRequire(new URL('../promo/package.json', import.meta.url))
const engines = require('playwright')
const localSprite = await fs.readFile(path.join(root, 'scripts/fixtures/test-sprite-96.gif'))
const checks = [], errors = [], blockedRequests = [], metrics = []
async function test(name, action) {
  try { await action(); checks.push({ name, passed: true }); console.log(`PASS ${name}`) }
  catch (error) { checks.push({ name, passed: false, error: error.message }); console.error(`FAIL ${name}: ${error.message}`) }
}
async function geometry(page, frame, label) {
  const host = await page.evaluate(() => {
    const frame = document.querySelector('[data-game-frame]'), r = frame.getBoundingClientRect()
    return { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight, x: r.x, y: r.y, w: r.width, h: r.height, nested: document.querySelectorAll('iframe').length }
  })
  const child = await frame.evaluate(() => ({ width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight, layout: document.documentElement.dataset.mobileLayout, frames: document.querySelectorAll('iframe[data-game-frame]').length,
    overflow: [...document.querySelectorAll('#root, .app-shell, .app-shell > *, .lobby-screen > *')].map(element => { const r = element.getBoundingClientRect(), css = getComputedStyle(element); return { className: element.className || element.id, top: r.top, bottom: r.bottom, h: r.height, minHeight: css.minHeight, padding: css.padding, margin: css.margin } }).filter(r => r.bottom > innerHeight) }))
  metrics.push({ label, host, child })
  assert.equal(host.nested, 1); assert.equal(child.frames, 0)
  assert(Math.abs(host.w / host.h - 16 / 9) < .002, `Wrong ratio: ${JSON.stringify(host)}`)
  assert(host.x >= -.5 && host.y >= -.5 && host.x + host.w <= host.width + 1 && host.y + host.h <= host.height + 1, `Host crops frame: ${JSON.stringify(host)}`)
  assert(host.scrollWidth <= host.width && host.scrollHeight <= host.height, `Host scrolls: ${JSON.stringify(host)}`)
  assert(child.scrollWidth <= child.width + 1 && child.scrollHeight <= child.height + 1, `Game document scrolls: ${JSON.stringify(child)}`)
}
async function control(locator) {
  assert.equal(await locator.count(), 1, 'Exactly one control required')
  assert(await locator.isVisible(), 'Control must be visible')
  const bounds = await locator.evaluate(element => {
    const r = element.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
    return { text: element.innerText, className: element.className, x: r.x, y: r.y, w: r.width, h: r.height, vw: innerWidth, vh: innerHeight, hit: hit === element || element.contains(hit), hitNode: hit?.className, hitText: hit?.textContent?.slice(0, 100) }
  })
  assert(bounds.x >= -1 && bounds.y >= -1 && bounds.x + bounds.w <= bounds.vw + 1 && bounds.y + bounds.h <= bounds.vh + 1 && bounds.hit, `Clipped or covered control: ${JSON.stringify(bounds)}`)
}
let browser
try {
  browser = await engines[browserName].launch(browserName === 'chromium' ? { executablePath: await resolveChromiumExecutable(engines.chromium), headless: true } : { headless: true })
  const devices = [
    { id: 'phone-667', width: 667, height: 375, touch: true },
    { id: 'phone-844', width: 844, height: 390, touch: true },
    { id: 'phone-915', width: 915, height: 412, touch: true },
    { id: 'tablet-1024', width: 1024, height: 768, touch: true },
    { id: 'tablet-1366', width: 1366, height: 1024, touch: true },
    { id: 'desktop-1920', width: 1920, height: 1080 },
    { id: 'desktop-window', width: 1536, height: 730 },
    { id: 'ultrawide-2560', width: 2560, height: 1080 },
  ].filter(device => !process.env.VIEWPORT_DEVICE || device.id === process.env.VIEWPORT_DEVICE)
  for (const device of devices) {
    const context = await browser.newContext({ viewport: { width: device.width, height: device.height }, screen: { width: device.width, height: device.height }, hasTouch: Boolean(device.touch), isMobile: Boolean(device.touch), reducedMotion: 'reduce' })
    await context.addInitScript(storage => { for (const [key, value] of Object.entries(storage)) localStorage.setItem(key, JSON.stringify(value)); localStorage.setItem('champions-draw-tutorial-v1', 'complete') }, storage)
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url())
      if (url.hostname !== '127.0.0.1' || url.pathname.startsWith('/api/')) {
        blockedRequests.push({ device: device.id, url: url.origin + url.pathname, type: request.resourceType() })
        return request.resourceType() === 'image' ? route.fulfill({ contentType: 'image/gif', body: localSprite }) : route.abort()
      }
      return route.continue()
    })
    const page = await context.newPage()
    page.setDefaultTimeout(12_000)
    page.on('pageerror', error => errors.push({ device: device.id, message: error.message }))
    await page.goto(`http://127.0.0.1:${port}/`)
    const iframe = page.locator('iframe[data-game-frame]')
    const frame = await (await iframe.elementHandle()).contentFrame()
    const click = locator => device.touch ? locator.tap() : locator.click()
    await frame.getByRole('heading', { name: '플레이 메뉴', exact: true }).waitFor()
    const shot = name => page.screenshot({ path: path.join(output, `${device.id}-${name}.png`) })
    const back = async selector => { await click(frame.locator(selector)); await frame.locator('.mode-card.mode-training').waitFor() }
    await test(`${device.id}: lobby maintains 16:9 without cropping or document scroll`, async () => {
      await shot('lobby')
      await geometry(page, frame, `${device.id}/lobby`)
      await control(frame.getByRole('button', { name: '설정', exact: true }))
      await control(frame.locator('.mode-card.mode-training'))
    })
    if (device.id === 'desktop-window') await test(`${device.id}: desktop ignores visual viewport offsets and recenters after resize`, async () => {
      const token = await frame.evaluate(() => { window.__desktopFrameToken = Math.random(); return window.__desktopFrameToken })
      const original = await iframe.boundingBox()
      try {
        await page.evaluate(() => {
          const viewport = window.visualViewport
          for (const [key, value] of Object.entries({ width: 1800, height: 1100, offsetLeft: 80, offsetTop: 260, scale: 1 })) Object.defineProperty(viewport, key, { configurable: true, value })
          viewport.dispatchEvent(new Event('scroll'))
        })
        await page.waitForTimeout(150)
        const fit = await iframe.boundingBox()
        assert(Math.abs(fit.x - original.x) < 1 && Math.abs(fit.y - original.y) < 1, `Desktop displaced: ${JSON.stringify(fit)}`)
        for (const viewport of [{ width: 1366, height: 657 }, { width: 1920, height: 945 }, { width: 1280, height: 1024 }, { width: device.width, height: device.height }]) {
          await page.setViewportSize(viewport)
          await page.waitForFunction(() => {
            const r = document.querySelector('iframe[data-game-frame]').getBoundingClientRect()
            return Math.abs(r.width - Math.min(innerWidth, innerHeight * 16 / 9)) < 1 && Math.abs(r.height - Math.min(innerHeight, innerWidth * 9 / 16)) < 1
          })
          await geometry(page, frame, `desktop-resize/${viewport.width}x${viewport.height}`)
          const bounds = await iframe.boundingBox()
          assert(Math.abs(bounds.x - (viewport.width - bounds.width) / 2) < 1 && Math.abs(bounds.y - (viewport.height - bounds.height) / 2) < 1)
          assert.equal(await frame.evaluate(() => window.__desktopFrameToken), token)
        }
      } finally {
        await page.evaluate(() => {
          for (const key of ['width', 'height', 'offsetLeft', 'offsetTop', 'scale']) delete window.visualViewport[key]
          window.visualViewport.dispatchEvent(new Event('resize'))
        })
      }
    })
    await test(`${device.id}: settings portal opens and closes at real pointer coordinates`, async () => {
      const settingsButton = frame.getByRole('button', { name: '설정', exact: true })
      const bounds = await settingsButton.boundingBox()
      assert(bounds)
      if (device.touch) await page.touchscreen.tap(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
      else await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
      await frame.getByRole('dialog').waitFor()
      try {
        await control(frame.getByRole('button', { name: '설정 닫기', exact: true }))
        await shot('settings')
        await geometry(page, frame, `${device.id}/settings`)
      } finally { await click(frame.getByRole('button', { name: '설정 닫기', exact: true })) }
      assert.equal(await frame.getByRole('dialog').count(), 0)
    })
    await test(`${device.id}: box selection and save remain reachable`, async () => {
      await click(frame.locator('.mode-card.mode-collection'))
      const card = frame.locator('.team-box-card-select').first()
      await control(card); await click(card)
      assert.equal(await card.getAttribute('aria-pressed'), 'true')
      const save = frame.getByRole('button', { name: '팀 저장', exact: true }).filter({ visible: true })
      await control(save)
      await geometry(page, frame, `${device.id}/box`)
      await shot('box')
    })
    if (await frame.locator('.team-box-screen, .box-screen, .pc-view').count()) await click(frame.getByRole('button', { name: '로비 화면으로 돌아가기', exact: true }))
    await test(`${device.id}: training pages and save remain reachable`, async () => {
      await click(frame.locator('.mode-card.mode-training'))
      const cards = frame.locator('.training-roster-card')
      await click(cards.first())
      const nav = frame.locator('.training-mobile-pages')
      if (await nav.isVisible()) for (const button of await nav.getByRole('button').all()) {
        await control(button); await click(button)
        await geometry(page, frame, `${device.id}/training/${await button.innerText()}`)
      }
      await control(frame.getByRole('button', { name: '설정 저장', exact: true }))
      await shot('training')
    })
    if (await frame.locator('.training-screen').count()) await click(frame.getByRole('button', { name: '로비로 돌아가기', exact: true }))
    await test(`${device.id}: usage filters and pagination fit`, async () => {
      await click(frame.locator('.mode-card.mode-usage'))
      await control(frame.locator('.pokemon-usage-back'))
      await click(frame.getByRole('tab', { name: '레이팅 배틀', exact: true }))
      await click(frame.getByRole('button', { name: '더블배틀', exact: true }))
      await geometry(page, frame, `${device.id}/usage`)
      await shot('usage')
    })
    if (await frame.locator('.pokemon-usage-back').count()) await back('.pokemon-usage-back')
    await test(`${device.id}: ranked, room and AI setup controls fit the frame`, async () => {
      await click(frame.locator('.mode-card.mode-start'))
      for (const mode of ['ranked', 'rooms', 'ai']) {
        await click(frame.locator(`.battle-hub-card.${mode}`))
        const main = frame.locator(mode === 'ranked' ? '.ranked-screen' : mode === 'rooms' ? '.rooms-screen' : '.battle-select-screen')
        await main.waitFor()
        await control(main.locator('.screen-back-button'))
        if (mode === 'ranked') {
          await control(frame.locator('.ranked-format-tabs button').last())
          await click(frame.locator('.ranked-format-tabs button').last())
        } else if (mode === 'rooms') {
          await control(frame.getByRole('button', { name: '선택한 팀 편성하기', exact: true }))
        } else {
          await control(frame.getByRole('button', { name: '이 모드로 시작', exact: true }))
          await click(frame.getByRole('group', { name: '싱글 또는 더블 선택', exact: true }).getByRole('button').last())
        }
        await geometry(page, frame, `${device.id}/${mode}-setup`)
        await shot(`${mode}-setup`)
        await click(main.locator('.screen-back-button'))
      }
      await click(frame.locator('.battle-hub .screen-back-button'))
    })
    await test(`${device.id}: modes, factory selection, details portal and battle controls fit`, async () => {
      await click(frame.locator('.mode-card.mode-start'))
      await frame.locator('.battle-hub').waitFor()
      await shot('modes')
      for (const card of await frame.locator('.battle-hub-card').all()) await control(card)
      await geometry(page, frame, `${device.id}/modes`)
      await click(frame.locator('.battle-hub-card.factory'))
      await frame.locator('.factory-rental-select').first().waitFor()
      await geometry(page, frame, `${device.id}/factory`)
      await shot('factory')
      await click(frame.locator('.factory-rental-info').first())
      await frame.locator('.factory-details').waitFor()
      await control(frame.getByRole('button', { name: '포켓몬 정보 닫기', exact: true }))
      await click(frame.getByRole('button', { name: '포켓몬 정보 닫기', exact: true }))
      for (let i = 0; i < 3; i++) await click(frame.locator('.factory-rental-select').nth(i))
      await control(frame.locator('.factory-primary')); await click(frame.locator('.factory-primary'))
      await frame.getByRole('button', { name: '1층 배틀 시작', exact: true }).waitFor()
      await click(frame.locator('.factory-rental-select').first())
      await control(frame.getByRole('button', { name: '1층 배틀 시작', exact: true }))
      await click(frame.getByRole('button', { name: '1층 배틀 시작', exact: true }))
      await frame.locator('.battle-command-buttons').waitFor({ timeout: 20_000 })
      await frame.getByRole('button', { name: '배틀 개시', exact: true }).waitFor({ timeout: 30_000 })
      await control(frame.getByRole('button', { name: '배틀 개시', exact: true }))
      await click(frame.getByRole('button', { name: '배틀 개시', exact: true }))
      await frame.locator('.battle-intro-overlay').waitFor({ state: 'hidden', timeout: 30_000 })
      await frame.locator('.battle-trainer-dialogue-layer').waitFor({ state: 'hidden', timeout: 10_000 })
      for (const button of await frame.locator('.battle-command-buttons button').all()) await control(button)
      await geometry(page, frame, `${device.id}/battle`)
      await shot('battle')
      await click(frame.locator('.battle-command-buttons .fight'))
      for (const button of await frame.locator('.battle-move-button').all()) await control(button)
      await shot('moves')
    })
    if (device.touch) await test(`${device.id}: portrait gate and return retain game document and React state`, async () => {
      const token = await frame.evaluate(() => { window.__viewportStateToken = Math.random(); return window.__viewportStateToken })
      const screen = await frame.locator('.app-shell').getAttribute('class')
      await page.setViewportSize({ width: device.height, height: device.width })
      await page.getByRole('heading', { name: '기기를 가로로 돌려주세요' }).waitFor()
      assert.equal(await iframe.evaluate(element => element.inert), true)
      await shot('portrait')
      await page.setViewportSize({ width: device.width, height: device.height })
      await page.locator('.game-viewport-rotate').waitFor({ state: 'hidden' })
      assert.equal(await frame.evaluate(() => window.__viewportStateToken), token)
      assert.equal(await frame.locator('.app-shell').getAttribute('class'), screen)
      await geometry(page, frame, `${device.id}/restored`)
    })
    if (device.id === 'phone-844') await test(`${device.id}: simulated safe insets and keyboard resize keep the complete frame and app state`, async () => {
      const token = await frame.evaluate(() => window.__viewportStateToken)
      await page.evaluate(() => {
        document.querySelector('.game-viewport-stage').style.padding = '12px 28px'
        const viewport = window.visualViewport
        for (const [key, value] of Object.entries({ width: innerWidth, height: 240, offsetLeft: 0, offsetTop: 15, scale: 1 })) Object.defineProperty(viewport, key, { configurable: true, value })
        viewport.dispatchEvent(new Event('resize'))
      })
      await page.waitForTimeout(150)
      const fit = await iframe.boundingBox()
      assert(fit.x >= 28 && fit.y >= 27 && fit.x + fit.width <= 844 - 28 + 1 && fit.y + fit.height <= 15 + 240 - 12 + 1, JSON.stringify(fit))
      assert(Math.abs(fit.width / fit.height - 16 / 9) < .002)
      assert.equal(await frame.evaluate(() => window.__viewportStateToken), token)
      assert.equal(await page.locator('.game-viewport-rotate').isVisible(), false)
      await shot('keyboard-simulation')
      await page.evaluate(() => {
        document.querySelector('.game-viewport-stage').style.padding = ''
        for (const key of ['width', 'height', 'offsetLeft', 'offsetTop', 'scale']) delete window.visualViewport[key]
        window.visualViewport.dispatchEvent(new Event('resize'))
      })
      await page.waitForTimeout(150)
      await geometry(page, frame, `${device.id}/keyboard-restored`)
    })
    await context.close()
  }
} finally {
  await browser?.close()
  await server.close()
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ browserName, checks, errors, blockedRequests, metrics }, null, 2))
}
assert.equal(errors.length, 0, JSON.stringify(errors))
assert(checks.length && checks.every(check => check.passed), 'Fixed viewport UI regression failed; inspect results.json')
console.log(`${checks.length}/${checks.length} passed; browser errors ${errors.length}; production requests blocked by route isolation`)
