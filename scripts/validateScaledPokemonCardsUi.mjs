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

// Actual GameApp navigation, collection/model, TrainingScreen and BoxScreen.
// All account/presence APIs are isolated; external image URLs receive local art.
const root = fileURLToPath(new URL('../', import.meta.url))
const output = path.join(root, 'scripts/.cache/scaled-pokemon-cards-ui/current')
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
const styles = ['styles', 'screenRedesign', 'battleGen5', 'titleCleanup', 'battleGimmicks', 'moveAnimationDirector', 'settings', 'auth', 'mobileLandscape', 'gameTextScale', 'scaledBoxCards', 'scaledBattleCards', 'scaledTrainingEditor', 'mobileTouch', 'mobileUiV2']
const entry = `import'/src/mobileViewport.js';import React,{StrictMode}from'react';import{createRoot}from'react-dom/client';import{GameApp}from'/src/App.jsx';
${styles.map(name => `import'/src/${name}.css';`).join('\n')}
createRoot(document.getElementById('root')).render(React.createElement(StrictMode,null,React.createElement(GameApp,{user:{uid:'cards-ui',displayName:'guest-123456',isAnonymous:true,isLocalGuest:false},autoLogin:false,onPlayerDataChanged:()=>{},onSignOut:()=>{}})));`
process.env.VITE_POKEMON_USAGE_ENABLED = 'false'
process.env.VITE_POKEMON_USAGE_DEMO = 'false'
process.env.VITE_RANKED_LOCAL_TEST = 'false'
const port = Number(process.env.SCALED_POKEMON_CARDS_UI_PORT ?? 5248)
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
const localSprite = await fs.readFile(path.join(root, 'public/assets/pokemon/skins/armored-mewtwo-front.gif'))
const checks = [], errors = [], apiRequests = [], metrics = []
async function test(name, run) {
  try { await run(); checks.push({ name, passed: true }); console.log(`PASS ${name}`) }
  catch (error) { checks.push({ name, passed: false, error: error.message }); console.error(`FAIL ${name}: ${error.message}`) }
}
async function inspectCards(page, selector) {
  return page.locator(selector).evaluateAll(cards => cards.map(card => {
    const plain = r => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height })
    const bounds = plain(card.getBoundingClientRect()), name = card.querySelector(':scope > strong'), types = card.querySelector(':scope > .training-card-types')
    const frame = card.querySelector('.pokemon-icon-frame'), image = card.querySelector('.pokemon-box-icon')
    const issues = [], rectangles = []
    for (const target of [name, types].filter(Boolean)) {
      const range = document.createRange(); range.selectNodeContents(target)
      const glyphs = [...range.getClientRects()].filter(r => r.width && r.height).map(plain)
      rectangles.push({ field: target === name ? 'name' : 'types', text: target.textContent, glyphs })
      for (const glyph of glyphs) {
        if (glyph.left < bounds.left - 1 || glyph.right > bounds.right + 1 || glyph.top < bounds.top - 1 || glyph.bottom > bounds.bottom + 1) issues.push({ kind: 'outside-card', text: target.textContent, glyph, bounds })
        for (let ancestor = target; ancestor && ancestor !== card.parentElement; ancestor = ancestor.parentElement) {
          const style = getComputedStyle(ancestor), r = ancestor.getBoundingClientRect()
          if (['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowY) && (glyph.top < r.top - 1 || glyph.bottom > r.bottom + 1)) issues.push({ kind: 'vertical-glyph-clip', text: target.textContent, ancestor: ancestor.className || ancestor.tagName, glyph, clip: plain(r) })
          if (['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowX) && (glyph.left < r.left - 1 || glyph.right > r.right + 1)) issues.push({ kind: 'horizontal-glyph-clip', text: target.textContent, ancestor: ancestor.className || ancestor.tagName, glyph, clip: plain(r) })
        }
      }
    }
    if (rectangles.length === 2) for (const a of rectangles[0].glyphs) for (const b of rectangles[1].glyphs) {
      if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) issues.push({ kind: 'name-type-overlap', name: name.textContent, a, b })
    }
    const cardStyle = getComputedStyle(card), gridStyle = getComputedStyle(card.parentElement)
    return { name: name?.textContent, types: types?.textContent, bounds, rectangles, issues, layout: { display: cardStyle.display, height: cardStyle.height, minHeight: cardStyle.minHeight, maxHeight: cardStyle.maxHeight, boxSizing: cardStyle.boxSizing, alignSelf: cardStyle.alignSelf, padding: cardStyle.padding, gridAutoRows: gridStyle.gridAutoRows, gridTemplateRows: gridStyle.gridTemplateRows, children: [...card.children].map(child => { const s = getComputedStyle(child); return { node: child.className || child.tagName, height: s.height, flex: s.flex } }) }, sprite: frame ? plain(frame.getBoundingClientRect()) : null,
      imageLoaded: Boolean(image && (image.tagName !== 'IMG' || image.complete && image.naturalWidth > 0)), nameFont: name ? parseFloat(getComputedStyle(name).fontSize) : null }
  }))
}
async function controlWithinViewport(locator) {
  await locator.scrollIntoViewIfNeeded()
  return locator.evaluate(element => {
    const r = element.getBoundingClientRect()
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: innerWidth, height: innerHeight, hit: hit === element || element.contains(hit) }
  })
}
function assertControl(result) {
  assert(result.left >= -1 && result.right <= result.width + 1 && result.top >= -1 && result.bottom <= result.height + 1 && result.hit, JSON.stringify(result))
}
async function inspectSelectedBar(page) {
  const bar = page.locator('.team-box-selection.has-selection')
  assertControl(await controlWithinViewport(bar))
  return bar.evaluate(element => {
    const plain = r => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom })
    const bounds = plain(element.getBoundingClientRect()), issues = [], text = []
    const nodes = element.querySelectorAll('.pc-selection-name > *, .type-chip-list > *, .pc-selection-meta > span, button small, button strong')
    for (const target of nodes) {
      const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT)
      while (walker.nextNode()) {
        if (!walker.currentNode.textContent.trim()) continue
        const range = document.createRange(); range.selectNodeContents(walker.currentNode)
        for (const r of range.getClientRects()) {
          const glyph = plain(r)
          text.push({ text: walker.currentNode.textContent, glyph })
          if (r.left < bounds.left - 1 || r.right > bounds.right + 1 || r.top < bounds.top - 1 || r.bottom > bounds.bottom + 1) issues.push({ kind: 'outside-selection', text: target.textContent, glyph, bounds })
          for (let ancestor = target; ancestor && ancestor !== element.parentElement; ancestor = ancestor.parentElement) {
            const style = getComputedStyle(ancestor), clip = ancestor.getBoundingClientRect()
            if (['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowY) && (r.top < clip.top - 1 || r.bottom > clip.bottom + 1)) issues.push({ kind: 'selection-vertical-clip', text: target.textContent, ancestor: ancestor.className || ancestor.tagName, glyph, clip: plain(clip) })
            if (['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowX) && (r.left < clip.left - 1 || r.right > clip.right + 1)) issues.push({ kind: 'selection-horizontal-clip', text: target.textContent, ancestor: ancestor.className || ancestor.tagName, glyph, clip: plain(clip) })
          }
        }
      }
    }
    return { bounds, text, issues }
  })
}
let browser
try {
  browser = await chromium.launch({ executablePath: await resolveChromiumExecutable(chromium), headless: true })
  const html = await server.transformIndexHtml('/scaled-cards.html', '<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body><div id="root"></div><script type="module" src="/scaled-cards-entry.js"></script></body></html>')
  const devices = [{ id: 'desktop', viewport: { width: 1920, height: 900 } }, { id: 'laptop', viewport: { width: 1366, height: 768 } }, { id: 'mobile', viewport: { width: 844, height: 390 }, screen: { width: 844, height: 390 }, hasTouch: true, isMobile: true }]
  for (const device of devices) {
    const context = await browser.newContext({ ...device, reducedMotion: 'reduce' })
    await context.addInitScript(storage => { for (const [key, value] of Object.entries(storage)) localStorage.setItem(key, JSON.stringify(value)); localStorage.setItem('champions-draw-tutorial-v1', 'complete') }, storage)
    await context.route(/^https:\/\//, route => route.request().resourceType() === 'image' ? route.fulfill({ contentType: 'image/gif', body: localSprite }) : route.abort())
    await context.route('**/api/**', route => { apiRequests.push(route.request().url()); return route.abort() })
    await context.route('**/scaled-cards.html', route => route.fulfill({ contentType: 'text/html', body: html }))
    const page = await context.newPage()
    page.setDefaultTimeout(10_000)
    page.on('pageerror', error => errors.push({ device: device.id, message: error.message }))
    const click = locator => device.hasTouch ? locator.tap().catch(() => locator.click({ force: true })) : locator.click()
    await page.goto(`http://127.0.0.1:${port}/scaled-cards.html`)
    await page.getByRole('heading', { name: '플레이 메뉴', exact: true }).waitFor()
    async function chooseScale(scale) {
      await click(page.getByRole('button', { name: '설정', exact: true }))
      await click(page.getByRole('group', { name: '글자 크기', exact: true }).getByRole('button', { name: `${scale}배`, exact: true }))
      await click(page.getByRole('button', { name: '설정 닫기', exact: true }))
      await page.waitForTimeout(180)
    }
    for (const view of ['training', 'box']) {
      await chooseScale(1)
      await click(page.locator(view === 'training' ? '.mode-card.mode-training' : '.mode-card.mode-collection'))
      const selector = view === 'training' ? '.training-roster-card' : '.team-box-card-select'
      const cards = page.locator(selector)
      await cards.first().waitFor()
      await page.waitForFunction(selector => [...document.querySelectorAll(selector)].every(card => { const image = card.querySelector('.pokemon-box-icon'); return image && (image.tagName !== 'IMG' || image.complete && image.naturalWidth > 0) }), selector)
      const atOne = await inspectCards(page, selector)
      assert(atOne.length >= 30)
      const scales = device.id === 'desktop' ? [.5, 1, 1.5, 2] : [1.5, 2]
      for (const scale of scales) await test(`${device.id}: ${view} ${scale}x full names/types fit their cards without glyph clipping`, async () => {
        await chooseScale(scale)
        await cards.first().scrollIntoViewIfNeeded()
        const values = await inspectCards(page, selector)
        metrics.push({ device: device.id, view, scale, cards: values })
        await page.screenshot({ path: path.join(output, `${device.id}-${view}-${scale}x.png`) })
        const failures = values.flatMap(card => card.issues)
        assert.equal(failures.length, 0, JSON.stringify(failures.slice(0, 4)))
        values.forEach((first, index) => values.slice(index + 1).forEach(second => {
          assert(Math.min(first.bounds.right, second.bounds.right) - Math.max(first.bounds.left, second.bounds.left) <= 1 || Math.min(first.bounds.bottom, second.bounds.bottom) - Math.max(first.bounds.top, second.bounds.top) <= 1,
            `Cards overlap: ${JSON.stringify({ first: { name: first.name, bounds: first.bounds }, second: { name: second.name, bounds: second.bounds } })}`)
        }))
        assert(values.every(card => card.imageLoaded && card.sprite?.width > 0 && card.sprite?.height > 0))
        for (const [index, card] of values.entries()) {
          assert(Math.abs(card.nameFont - atOne[index].nameFont * scale) < .15, `Font scale changed for ${card.name}`)
          assert(Math.abs(card.sprite.width - atOne[index].sprite.width) < 1 && Math.abs(card.sprite.height - atOne[index].sprite.height) < 1, `Sprite changed for ${card.name}`)
        }
      })
      await test(`${device.id}: ${view} at 2x retains search, sorting, selection and final-card access`, async () => {
        const search = page.getByRole('searchbox', { name: view === 'training' ? '포켓몬 이름 검색' : '보유 포켓몬 검색', exact: true })
        const searchControl = await controlWithinViewport(search)
        if (device.id === 'mobile' && view === 'training') {
          assert(searchControl.left >= -1 && searchControl.right <= searchControl.width + 1 && searchControl.top >= -1 && searchControl.bottom <= searchControl.height + 1, JSON.stringify(searchControl))
        } else assertControl(searchControl)
        const firstName = await cards.first().locator(':scope > strong').innerText()
        await search.fill(firstName)
        assert(await cards.count() >= 1)
        await click(cards.first())
        assert.equal(await cards.first().getAttribute('aria-pressed'), 'true')
        if (view === 'box') {
          const selectedBar = await inspectSelectedBar(page)
          metrics.push({ device: device.id, view, scale: 2, selectedBar })
          await page.screenshot({ path: path.join(output, `${device.id}-box-2x-selected.png`) })
          assert.equal(selectedBar.issues.length, 0, JSON.stringify(selectedBar.issues.slice(0, 4)))
          assert.equal(await page.locator('.team-box-selection .pc-selection-name > strong').innerText(), firstName)
          assert(selectedBar.text.some(entry => entry.text.includes('HELD ITEM')))
        }
        await search.fill('')
        const sortGroupName = view === 'training' ? '포켓몬 목록 보기 및 정렬 기준' : '포켓몬 정렬 기준'
        await click(page.getByRole('group', { name: sortGroupName, exact: true }).getByRole('button', { name: '번호순', exact: true }))
        const last = cards.last()
        const lastControl = await controlWithinViewport(last)
        if (device.id === 'mobile' && view === 'training') {
          assert(lastControl.left >= -1 && lastControl.right <= lastControl.width + 1 && lastControl.top >= -1 && lastControl.bottom <= lastControl.height + 1, JSON.stringify(lastControl))
        } else assertControl(lastControl)
        await click(last)
        assert.equal(await last.getAttribute('aria-pressed'), 'true')
        if (view === 'training') assert.equal(await page.locator('.training-editor-name h2').innerText(), await last.locator(':scope > strong').innerText())
        const backControl = await controlWithinViewport(page.getByRole('button', { name: view === 'training' ? '로비로 돌아가기' : '로비 화면으로 돌아가기', exact: true }))
        if (device.id === 'mobile' && view === 'training') {
          assert(backControl.left >= -1 && backControl.right <= backControl.width + 1 && backControl.top >= -1 && backControl.bottom <= backControl.height + 1, JSON.stringify(backControl))
        } else assertControl(backControl)
        const documentWidth = await page.evaluate(() => ({ actual: document.documentElement.scrollWidth, viewport: innerWidth }))
        assert(documentWidth.actual <= documentWidth.viewport + 1, JSON.stringify(documentWidth))
      })
      await click(page.getByRole('button', { name: view === 'training' ? '로비로 돌아가기' : '로비 화면으로 돌아가기', exact: true }))
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
assert(checks.every(check => check.passed), 'Scaled Pokémon cards UI regression failed')
console.log(`${checks.filter(check => check.passed).length}/${checks.length} passed; browser errors ${errors.length}; API requests ${apiRequests.length}`)
