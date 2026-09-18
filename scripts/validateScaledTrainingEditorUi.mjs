import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { normalizePokemon } from '../src/data/trainingData.js'
import { migratePokemonCollection, getTrainingRosterPokemon } from '../src/data/pokemonPool.js'
import { ALL_BATTLE_ITEMS } from '../src/data/shopData.js'
import { createSavedTeams } from '../src/data/teamData.js'
import { createDefaultGameSettings, SETTINGS_STORAGE_KEY } from '../src/gameSettings.js'
import { resolveChromiumExecutable } from '../promo/scripts/browserRuntime.mjs'

// Actual GameApp navigation, collection/model and TrainingScreen editor.
// All account/presence APIs are isolated; external image URLs receive local art.
const root = fileURLToPath(new URL('../', import.meta.url))
const output = path.join(root, 'scripts/.cache/scaled-training-editor-ui')
await fs.mkdir(output, { recursive: true })
const heldItem = ALL_BATTLE_ITEMS.find(item => item.name === '먹다남은음식')
assert(heldItem)
const speciesIds = [695, 937, 956, 987, 988, 1009, 10177, 10104, 376, 407, 625, 823, 812, 818, 849, 861, 892, 911, 923, 934, 959, 968, 973, 982, 995, 1006, 1005, 1010, 1018, 1021, 1022, 1023, 1024, 1025, 357, 219]
const collection = migratePokemonCollection(speciesIds.map((speciesId, index) => normalizePokemon({ speciesId, captureId: `cards-ui-${speciesId}`, directDrawCount: 1,
  obtainedAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(), heldItemId: index < 6 ? heldItem.id : null, isShiny: index === 2, shinyObtained: index === 2 })))
const roster = getTrainingRosterPokemon(collection)
assert(roster.length >= 30)
const teams = createSavedTeams(roster.slice(0, 6).map(pokemon => pokemon.captureId), collection.map(pokemon => pokemon.captureId))
const settings = createDefaultGameSettings()
settings.audio.enabled = false
const storage = { [SETTINGS_STORAGE_KEY]: settings, 'champions-dex-v2': collection,
  'champions-teams-v1': { teams, activeTeamId: 'team-1' }, 'champions-battle-items-v1': { [heldItem.id]: 6 } }
const styles = ['styles', 'screenRedesign', 'battleGen5', 'titleCleanup', 'battleGimmicks', 'moveAnimationDirector', 'settings', 'auth', 'mobileLandscape', 'gameTextScale', 'scaledBoxCards', 'scaledBattleCards', 'scaledTrainingEditor', 'mobileTouch', 'mobileUiV2', 'mobileReferenceLayout']
const entry = `import'/src/mobileViewport.js';import React,{StrictMode}from'react';import{createRoot}from'react-dom/client';import{GameApp}from'/src/App.jsx';
${styles.map(name => `import'/src/${name}.css';`).join('\n')}
createRoot(document.getElementById('root')).render(React.createElement(StrictMode,null,React.createElement(GameApp,{user:{uid:'cards-ui',displayName:'guest-123456',isAnonymous:true,isLocalGuest:false},autoLogin:false,onPlayerDataChanged:()=>{},onSignOut:()=>{}})));`
process.env.VITE_POKEMON_USAGE_ENABLED = 'false'
process.env.VITE_POKEMON_USAGE_DEMO = 'false'
process.env.VITE_RANKED_LOCAL_TEST = 'false'
const port = Number(process.env.SCALED_TRAINING_EDITOR_UI_PORT ?? 5249)
const server = await createServer({ root, mode: 'scaled-card-validation', logLevel: 'error',
  plugins: [{ name: 'scaled-card-ui-fixture', enforce: 'pre',
    resolveId(source) {
      if (source === '/scaled-cards-entry.js') return source
      if (source.endsWith('/auth/firebaseClient') || source.endsWith('/auth/firebaseClient.js') || source === './firebaseClient' || source === './firebaseClient.js') return '\0scaled-card-ui-auth'
    },
    load(id) {
      if (id === '/scaled-cards-entry.js') return entry
      if (id === '\0scaled-card-ui-auth') return `export const firebaseAuth=null;export const firebaseDb=null;export const isFirebaseConfigured=false;export const missingFirebaseEnvironmentVariables=[];`
    },
  }], server: { host: '127.0.0.1', port, strictPort: true, hmr: false } })
await server.listen()
const require = createRequire(new URL('../promo/package.json', import.meta.url))
const { chromium } = require('playwright')
const localSprite = await fs.readFile(path.join(root, 'scripts/fixtures/test-sprite-96.gif'))
const checks = [], errors = [], apiRequests = [], metrics = []
async function test(name, run) {
  try { await run(); checks.push({ name, passed: true }); console.log(`PASS ${name}`) }
  catch (error) { checks.push({ name, passed: false, error: error.message }); console.error(`FAIL ${name}: ${error.message}`) }
}
async function checkTextInContainer(locator, selector) {
  return locator.evaluate((container, selector) => {
    const rect = element => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom } }
    const bounds = rect(container), issues = [], text = []
    for (const element of container.querySelectorAll(selector)) {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
      while (walker.nextNode()) {
        const node = walker.currentNode
        if (!node.textContent.trim()) continue
        const range = document.createRange(); range.selectNodeContents(node)
        for (const r of range.getClientRects()) {
          const glyph = { left: r.left, right: r.right, top: r.top, bottom: r.bottom }
          text.push({ text: node.textContent, glyph })
          if (glyph.left < bounds.left - 1 || glyph.right > bounds.right + 1 || glyph.top < bounds.top - 1 || glyph.bottom > bounds.bottom + 1) issues.push({ kind: 'outside-container', text: node.textContent, glyph, bounds })
          for (let ancestor = node.parentElement; ancestor && ancestor !== container.parentElement; ancestor = ancestor.parentElement) {
            const style = getComputedStyle(ancestor), clip = rect(ancestor)
            if (['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowY) && (glyph.top < clip.top - 1 || glyph.bottom > clip.bottom + 1)) issues.push({ kind: 'vertical-clip', text: node.textContent, ancestor: ancestor.className, glyph, clip })
            if (['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowX) && (glyph.left < clip.left - 1 || glyph.right > clip.right + 1)) issues.push({ kind: 'horizontal-clip', text: node.textContent, ancestor: ancestor.className, glyph, clip })
          }
        }
      }
    }
    for (let i = 0; i < text.length; i++) for (let j = i + 1; j < text.length; j++) {
      const a = text[i].glyph, b = text[j].glyph
      if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) issues.push({ kind: 'overlap', a: text[i], b: text[j] })
    }
    return { bounds, text, issues }
  }, selector)
}
async function reachable(locator) {
  await locator.scrollIntoViewIfNeeded()
  const result = await locator.evaluate(element => {
    const r = element.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: innerWidth, height: innerHeight, hit: hit === element || element.contains(hit) }
  })
  assert(result.left >= -1 && result.right <= result.width + 1 && result.top >= -1 && result.bottom <= result.height + 1 && result.hit, JSON.stringify(result))
}
let browser
try {
  browser = await chromium.launch({ executablePath: await resolveChromiumExecutable(chromium), headless: true })
  const html = await server.transformIndexHtml('/scaled-cards.html', '<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body><div id="root"></div><script type="module" src="/scaled-cards-entry.js"></script></body></html>')
  const devices = [{ id: 'desktop', viewport: { width: 1920, height: 900 }, scales: [1.5, 2] }, { id: 'laptop', viewport: { width: 1366, height: 768 }, scales: [1.5, 2] }, { id: 'mobile', viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, scales: [1] }]
  for (const { scales, ...device } of devices) {
    const context = await browser.newContext({ ...device, reducedMotion: 'reduce' })
    await context.addInitScript(storage => { for (const [key, value] of Object.entries(storage)) localStorage.setItem(key, JSON.stringify(value)); localStorage.setItem('champions-draw-tutorial-v1', 'complete') }, storage)
    await context.route(/^https:\/\//, route => route.request().resourceType() === 'image' ? route.fulfill({ contentType: 'image/gif', body: localSprite }) : route.abort())
    await context.route('**/api/**', route => { apiRequests.push(route.request().url()); return route.abort() })
    await context.route('**/scaled-cards.html', route => route.fulfill({ contentType: 'text/html', body: html }))
    const page = await context.newPage()
    page.setDefaultTimeout(10_000)
    page.on('pageerror', error => errors.push({ device: device.id, message: error.message }))
    const click = locator => device.hasTouch ? locator.tap().catch(() => locator.evaluate(element => element.click())) : locator.click()
    await page.goto(`http://127.0.0.1:${port}/scaled-cards.html`)
    await click(page.locator('.mode-card.mode-training'))
    await click(page.locator('.training-roster-card').first())
    const base = await page.locator('.training-stat-value').first().evaluate(element => parseFloat(getComputedStyle(element).fontSize))
    for (const scale of scales) {
      // Mobile is pinned to the 1x ramp, so it has no preset control to drive.
      if (device.isMobile) {
        assert.equal(await page.locator('html').getAttribute('data-game-text-scale'), '1')
      } else {
        await click(page.getByRole('button', { name: '설정', exact: true }))
        await click(page.getByRole('group', { name: '글자 크기', exact: true }).getByRole('button', { name: `${scale}배`, exact: true }))
        await click(page.getByRole('button', { name: '설정 닫기', exact: true }))
      }
      // The compact landscape editor pages its sections, so each assertion has
      // to open the page it is about before measuring it.
      const openEditorPage = async index => {
        const tabs = page.locator('.training-mobile-pages button')
        if (!await tabs.count() || !await tabs.nth(index).isVisible()) return
        await click(tabs.nth(index))
        await page.waitForTimeout(160)
      }
      await openEditorPage(1)
      await test(`${device.id} ${scale}x: all six stat rows retain glyphs and separate controls`, async () => {
        assert(Math.abs(await page.locator('.training-stat-value').first().evaluate(element => parseFloat(getComputedStyle(element).fontSize)) - base * scale) < .1)
        const rows = page.locator('.training-stat-row')
        assert.equal(await rows.count(), 6)
        for (const row of await rows.all()) {
          await row.scrollIntoViewIfNeeded()
          const value = await checkTextInContainer(row, '.training-stat-name, .training-stat-value, .training-stat-controls em')
          metrics.push({ device: device.id, scale, section: 'stat', value })
          assert.equal(value.issues.length, 0, JSON.stringify(value.issues.slice(0, 3)))
          await reachable(row.locator('input'))
          await reachable(row.locator('button').last())
        }
        await page.screenshot({ path: path.join(output, `${device.id}-${scale}x-stats.png`) })
      })
      await openEditorPage(2)
      await test(`${device.id} ${scale}x: four full move names and PP/type/category fit and picker opens`, async () => {
        const cards = page.locator('.training-move-card')
        assert.equal(await cards.count(), 4)
        for (const card of await cards.all()) {
          await card.scrollIntoViewIfNeeded()
          await page.mouse.move(0, 0)
          const value = await checkTextInContainer(card, '.training-move-slot, .training-move-type, .training-move-select small, .training-move-select-button > span, .training-move-metrics')
          metrics.push({ device: device.id, scale, section: 'move', value })
          assert.equal(value.issues.length, 0, JSON.stringify(value.issues.slice(0, 3)))
          // The landscape card keeps only the type, the name and the category
          // chip; 위력/명중/PP belong to the picker, which lists them per option.
          assert.equal(value.text.some(item => item.text === 'PP'), !device.isMobile)
          await reachable(card.locator('.training-move-select-button'))
        }
        await page.screenshot({ path: path.join(output, `${device.id}-${scale}x-moves.png`) })
        await click(cards.last().locator('.training-move-select-button'))
        await page.locator('.move-picker-panel').waitFor()
        assert.match(await page.locator('.move-picker-choice-stats').first().innerText(), /위력[\s\S]*명중[\s\S]*PP/)
        await page.keyboard.press('Escape')
        await page.locator('.move-picker-panel').waitFor({ state: 'hidden' })
      })
      await openEditorPage(1)
      await test(`${device.id} ${scale}x: stat edit, reset and save remain usable`, async () => {
        // Generated battle-ready partners may already spend all 66 points;
        // choose an allocated stat so the actual decrement is enabled.
        const controls = page.locator('.training-stat-controls').filter({ has: page.locator('button[aria-label$="감소"]:enabled') }).first()
        const range = controls.locator('input')
        const initial = Number(await range.inputValue())
        const direction = '감소'
        const adjust = controls.getByRole('button', { name: new RegExp(direction) })
        await reachable(adjust)
        await click(adjust)
        assert.equal(Number(await range.inputValue()), initial + (direction === '감소' ? -1 : 1))
        const footer = page.locator('.training-editor-actions'), reset = footer.getByRole('button', { name: '저장값으로 초기화', exact: true }), save = footer.locator('button.primary')
        await reachable(reset)
        await reachable(save)
        const value = await checkTextInContainer(footer, '.training-save-state, .training-cost-breakdown small, .training-cost-breakdown strong, :scope > button')
        metrics.push({ device: device.id, scale, section: 'footer', value })
        assert.equal(value.issues.length, 0, JSON.stringify(value.issues.slice(0, 3)))
        await click(reset)
        assert.equal(Number(await range.inputValue()), initial)
        await click(adjust)
        assert.equal(await save.isEnabled(), true)
        await page.screenshot({ path: path.join(output, `${device.id}-${scale}x-save.png`) })
        await click(save)
        assert.equal(await save.isEnabled(), false)
        assert.equal(await reset.isEnabled(), false)
        const width = await page.evaluate(() => ({ actual: document.documentElement.scrollWidth, viewport: innerWidth }))
        assert(width.actual <= width.viewport + 1, JSON.stringify(width))
      })
    }
    await context.close()
  }
} finally {
  await browser?.close()
  await server.close()
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ checks, errors, apiRequests, metrics }, null, 2))
}
assert.equal(errors.length, 0, JSON.stringify(errors))
assert.equal(apiRequests.length, 0, JSON.stringify(apiRequests))
assert(checks.every(check => check.passed), 'Scaled training editor UI regression failed')
console.log(`${checks.filter(check => check.passed).length}/${checks.length} passed; browser errors ${errors.length}; API requests ${apiRequests.length}`)
