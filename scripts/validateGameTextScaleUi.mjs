import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { createRankedBattle, getRankedBattleView } from '../server/rankedBattle.js'
import { normalizePokemon, getMoveById } from '../src/data/trainingData.js'
import { SETTINGS_STORAGE_KEY } from '../src/gameSettings.js'
import { resolveChromiumExecutable } from '../promo/scripts/browserRuntime.mjs'

// Real battle/settings/ranking components, CSS pipeline, settings model and scale
// applicator. The small harness mirrors App's local settings persistence effect;
// auth, production data, network matchmaking and account storage are not involved.
const root = fileURLToPath(new URL('../', import.meta.url))
const output = path.join(root, 'scripts/.cache/game-text-scale-ui')
await fs.mkdir(output, { recursive: true })
const mon = (speciesId, moves) => normalizePokemon({ speciesId, captureId: `text-scale-${speciesId}`, moves: moves.map(id => getMoveById(id).name) })
const playerTeam = [mon(25, ['thunderbolt', 'voltswitch', 'protect', 'thunderwave']), mon(6, ['flamethrower', 'protect']), mon(9, ['surf', 'protect'])]
const opponentTeam = [mon(143, ['tackle', 'protect']), mon(68, ['protect']), mon(131, ['protect'])]
const battle = getRankedBattleView(createRankedBattle({ playerTeam, opponentTeam, format: 'single', playerName: '테스트', opponentName: '상대' }), 'player')
// Local animated artwork makes sprite-size checks independent of external CDNs.
for (const side of [battle.player, battle.opponent]) for (const pokemon of side.team) {
  pokemon.spriteFront = '/test-sprite-96.gif'
  pokemon.spriteBack = '/test-sprite-96.gif'
  pokemon.spriteFrontFallback = pokemon.spriteFront
  pokemon.spriteBackFallback = pokemon.spriteBack
}
const entries = Array.from({ length: 10 }, (_, index) => ({ rank: index + 1, trainerName: index === 2 ? 'guest-123456' : `${String.fromCharCode(65 + index)}**`, isOwn: index === 2,
  points: 1300 - index * 100, rating: 1500 - index * 20, wins: 50 - index, losses: 10, draws: 0, played: 60 - index }))
const board = { boards: { single: { entries, participantCount: 20 }, double: { entries: [], participantCount: 0 } }, updatedAt: Date.now() }
const styles = ['styles', 'screenRedesign', 'battleGen5', 'titleCleanup', 'battleGimmicks', 'moveAnimationDirector', 'settings', 'mobileLandscape', 'ranked', 'gameTextScale', 'mobileTouch', 'mobileUiV2']
const entry = `import'/src/mobileViewport.js';import React,{StrictMode,useEffect,useLayoutEffect,useState}from'react';import{createRoot}from'react-dom/client';
import BattleScreen from'/src/BattleScreen.jsx';import SettingsModal from'/src/SettingsModal.jsx';import RankedLeaderboard from'/src/RankedLeaderboard.jsx';
import{loadGameSettings,normalizeGameSettings,createDefaultGameSettings,SETTINGS_STORAGE_KEY}from'/src/gameSettings.js';import{applyGameTextScale}from'/src/gameTextScale.js';
${styles.map(name => `import'/src/${name}.css';`).join('\n')}
const fixture=window.__fixture;const client={request:async()=>fixture.board};applyGameTextScale(loadGameSettings().game.textScale);
function Harness(){const[settings,setSettings]=useState(loadGameSettings);const[open,setOpen]=useState(false);const[view,setView]=useState('battle');
useLayoutEffect(()=>{applyGameTextScale(settings.game.textScale)},[settings.game.textScale]);useEffect(()=>{localStorage.setItem(SETTINGS_STORAGE_KEY,JSON.stringify(settings))},[settings]);
window.__textScaleHarness={view:setView,open:()=>setOpen(true)};
return React.createElement('div',{className:'app-shell ranked-view'+(view==='battle'?' battle-view':'')},view==='battle'?React.createElement('div',{className:'ranked-live-battle'},
React.createElement(BattleScreen,{opponent:{name:'상대'},playerPokemon:fixture.battle.player.team,opponentTeam:{pokemon:fixture.battle.opponent.team},rules:fixture.battle.rules,soundEnabled:false,
gameSettings:{...settings.game,attackAnimation:'skip',hpBarSpeed:'instant'},onOpenSettings:()=>setOpen(true),online:{state:fixture.battle,timeline:[],revision:1,timelineRevision:1,canAct:true,onSubmit:async()=>{},onForfeit:()=>{},onPlaybackComplete:()=>{}}})):
React.createElement('main',{className:'ranked-screen'},React.createElement('header',{className:'ranked-header'},React.createElement('button',{className:'screen-back-button',onClick:()=>setView('battle')},'배틀'),React.createElement('h1',null,'레이팅 랭킹'),React.createElement('button',{className:'screen-back-button','aria-label':'환경 설정',onClick:()=>setOpen(true)},'설정')),React.createElement(RankedLeaderboard,{client})),
open&&React.createElement(SettingsModal,{settings,onChange:(section,key,value)=>setSettings(current=>normalizeGameSettings({...current,[section]:{...current[section],[key]:value}})),onClose:()=>setOpen(false),onReset:()=>setSettings(createDefaultGameSettings())}))}
createRoot(document.getElementById('root')).render(React.createElement(StrictMode,null,React.createElement(Harness)));`
const port = Number(process.env.GAME_TEXT_SCALE_UI_PORT ?? 5242)
const server = await createServer({ root, logLevel: 'error', plugins: [{ name: 'text-scale-fixture', resolveId: id => id === '/text-scale-entry.js' ? id : undefined, load: id => id === '/text-scale-entry.js' ? entry : undefined }], server: { host: '127.0.0.1', port, strictPort: true, hmr: false } })
await server.listen()
const require = createRequire(new URL('../promo/package.json', import.meta.url))
const { chromium } = require('playwright')
const checks = [], errors = [], metrics = []
async function test(name, run) {
  try { await run(); checks.push({ name, passed: true }); console.log(`PASS ${name}`) }
  catch (error) { checks.push({ name, passed: false, error: error.message }); console.error(`FAIL ${name}: ${error.message}`) }
}
const commonSelectors = { log: '.battle-log-current-message', hpName: '.battle-hp-panel.side-player header strong', hpValue: '.battle-hp-panel.side-player footer b' }
const commandSelectors = { ...commonSelectors, command: '.battle-command-buttons .fight strong', commandHint: '.battle-command-buttons .fight small' }
const moveSelectors = { ...commonSelectors, move: '.battle-move-name strong', pp: '.battle-move-pp strong' }
const rankedSelectors = { heading: '.ranked-header h1', name: '.ranked-leaderboard-trainer strong', score: '.ranked-leaderboard-score strong', tier: '.ranked-leaderboard-tier' }
async function measurements(page, selectors) {
  return page.evaluate(selectors => ({ fonts: Object.fromEntries(Object.entries(selectors).map(([key, selector]) => {
    const element = document.querySelector(selector)
    if (!element) throw new Error(`Missing ${selector}`)
    return [key, parseFloat(getComputedStyle(element).fontSize)]
  })), images: [...document.querySelectorAll('.battle-live-sprite')].map(element => {
    const rect = element.getBoundingClientRect(); return { width: rect.width, height: rect.height }
  }), viewport: { width: innerWidth, height: innerHeight, scale: visualViewport?.scale ?? 1, zoom: getComputedStyle(document.documentElement).zoom },
  rootScale: document.documentElement.dataset.gameTextScale }), selectors)
}
function assertRatio(current, baseline, scale) {
  for (const [key, value] of Object.entries(baseline.fonts)) {
    assert(Math.abs(current.fonts[key] - value * scale) <= Math.max(.13, value * scale * .01), `${key}: expected ${value * scale}px (${scale}x ${value}), got ${current.fonts[key]}px`)
  }
  assert.deepEqual(current.viewport, baseline.viewport, 'Page/viewport zoom changed')
  if (baseline.images.length) current.images.forEach((image, index) => {
    assert(Math.abs(image.width - baseline.images[index].width) < 1 && Math.abs(image.height - baseline.images[index].height) < 1,
      `Sprite size changed: ${JSON.stringify({ baseline: baseline.images[index], current: image })}`)
  })
}
async function controlGeometry(page, selector, textSelector = 'strong') {
  return page.locator(selector).evaluateAll((elements, textSelector) => elements.map(element => {
    const r = element.getBoundingClientRect()
    const texts = [...element.querySelectorAll(textSelector)].map(text => {
      const range = document.createRange(); range.selectNodeContents(text)
      const rect = range.getBoundingClientRect()
      return { text: text.textContent, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }
    })
    return { text: element.textContent, left: r.left, right: r.right, top: r.top, bottom: r.bottom, texts }
  }), textSelector)
}
function assertControlsFit(controls, viewport) {
  for (const control of controls) {
    assert(control.left >= -1 && control.right <= viewport.width + 1 && control.top >= -1 && control.bottom <= viewport.height + 1, `Control outside viewport: ${JSON.stringify(control)}`)
    for (const text of control.texts.filter(text => text.right > text.left && text.bottom > text.top)) assert(text.left >= control.left - 2 && text.right <= control.right + 2 && text.top >= control.top - 2 && text.bottom <= control.bottom + 2,
      `Text outside control: ${JSON.stringify({ control, text })}`)
  }
  controls.forEach((first, index) => controls.slice(index + 1).forEach(second => {
    assert(Math.min(first.right, second.right) - Math.max(first.left, second.left) <= 1 || Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top) <= 1,
      `Controls overlap: ${first.text} / ${second.text}`)
  }))
}
async function textColumnCollisions(page, selector) {
  return page.locator(selector).evaluateAll(elements => elements.flatMap(element => {
    const columns = [...element.children].map(column => {
      const walker = document.createTreeWalker(column, NodeFilter.SHOW_TEXT)
      const rectangles = []
      while (walker.nextNode()) {
        const node = walker.currentNode
        if (!node.textContent.trim()) continue
        const range = document.createRange(); range.selectNodeContents(node)
        for (const r of range.getClientRects()) if (r.width && r.height) rectangles.push({ text: node.textContent, left: r.left, right: r.right, top: r.top, bottom: r.bottom })
      }
      return rectangles
    })
    return columns.flatMap((column, index) => columns.slice(index + 1).flatMap(other => column.flatMap(first => other.filter(second =>
      Math.min(first.right, second.right) - Math.max(first.left, second.left) > 1 && Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top) > 1
    ).map(second => ({ first, second })))))
  }))
}
let browser
try {
  browser = await chromium.launch({ executablePath: await resolveChromiumExecutable(chromium), headless: true })
  // Local animated artwork keeps sprite sizing independent of external CDNs.
  const testSprite = await fs.readFile(path.join(root, 'scripts/fixtures/test-sprite-96.gif'))
  const html = await server.transformIndexHtml('/text-scale.html', '<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body><div id="root"></div><script type="module" src="/text-scale-entry.js"></script></body></html>')
  for (const device of [{ id: 'desktop', viewport: { width: 1920, height: 900 } }, { id: 'laptop', viewport: { width: 1366, height: 768 } }, { id: 'mobile', viewport: { width: 844, height: 390 }, screen: { width: 844, height: 390 }, hasTouch: true, isMobile: true }]) {
    const context = await browser.newContext({ ...device, reducedMotion: 'reduce' })
    await context.addInitScript(value => { window.__fixture = value }, { battle, board })
    await context.route(/^https:\/\//, route => route.abort())
    await context.route('**/text-scale.html', route => route.fulfill({ contentType: 'text/html', body: html }))
    await context.route('**/test-sprite-96.gif', route => route.fulfill({ contentType: 'image/gif', body: testSprite }))
    const page = await context.newPage()
    page.setDefaultTimeout(10_000)
    page.on('pageerror', error => errors.push({ device: device.id, message: error.message }))
    await page.goto(`http://127.0.0.1:${port}/text-scale.html`)
    await page.locator('.battle-command-buttons .fight').waitFor()
    await page.waitForFunction(() => [...document.querySelectorAll('.battle-live-sprite')].length === 2 && [...document.querySelectorAll('.battle-live-sprite')].every(element => element.getBoundingClientRect().width > 0 && (element.tagName !== 'IMG' || element.complete && element.naturalWidth > 0)))
    const click = locator => device.hasTouch ? locator.tap() : locator.click()
    async function chooseScale(scale, keepOpen = false) {
      if (!await page.getByRole('dialog', { name: '환경 설정' }).count()) await click(page.getByRole('button', { name: '환경 설정', exact: true }))
      await click(page.getByRole('group', { name: '글자 크기', exact: true }).getByRole('button', { name: `${scale}배`, exact: true }))
      await page.waitForFunction(scale => document.documentElement.dataset.gameTextScale === String(scale), scale)
      await page.waitForTimeout(220)
      assert.equal(await page.getByRole('group', { name: '글자 크기', exact: true }).getByRole('button', { name: `${scale}배`, exact: true }).getAttribute('aria-pressed'), 'true')
      if (!keepOpen) await click(page.getByRole('button', { name: '설정 닫기', exact: true }))
    }
    // Phones and tablets are pinned to the 1x ramp, so the presets are not
    // offered there and a stored desktop choice must not follow the player in.
    if (device.isMobile) {
      await test(`${device.id}: text size stays at 1x and the preset control is hidden`, async () => {
        assert.equal(await page.locator('html').getAttribute('data-mobile-layout'), 'landscape')
        await click(page.getByRole('button', { name: '환경 설정', exact: true }))
        await page.getByRole('dialog', { name: '환경 설정' }).waitFor()
        assert.equal(await page.getByRole('group', { name: '글자 크기', exact: true }).count(), 0)
        assert.equal(await page.locator('.settings-text-scale-preview').count(), 0)
        await click(page.getByRole('button', { name: '설정 닫기', exact: true }))
        await page.evaluate(key => {
          const stored = JSON.parse(localStorage.getItem(key))
          localStorage.setItem(key, JSON.stringify({ ...stored, game: { ...stored.game, textScale: 2 } }))
        }, SETTINGS_STORAGE_KEY)
        await page.reload()
        await page.locator('.battle-command-buttons .fight').waitFor()
        assert.equal(await page.locator('html').getAttribute('data-game-text-scale'), '1')
      })
      await context.close()
      continue
    }
    await test(`${device.id}: default is 1x and settings expose all four readable sizes`, async () => {
      assert.equal(await page.locator('html').getAttribute('data-game-text-scale'), '1')
      await chooseScale(1, true)
      assert.deepEqual(await page.getByRole('group', { name: '글자 크기', exact: true }).getByRole('button').allTextContents(), ['0.5배', '1배', '1.5배', '2배'])
      await click(page.getByRole('button', { name: '설정 닫기', exact: true }))
    })
    const commandBaseline = await measurements(page, commandSelectors)
    assert.equal(commandBaseline.images.length, 2)
    for (const scale of [.5, 1, 1.5, 2]) await test(`${device.id}: command, HP and log fonts are exactly ${scale}x without zooming sprites`, async () => {
      await chooseScale(scale)
      const current = await measurements(page, commandSelectors)
      metrics.push({ device: device.id, view: 'command', scale, ...current })
      assertRatio(current, commandBaseline, scale)
      if (scale === 2) {
        await page.screenshot({ path: path.join(output, `${device.id}-commands-2x.png`) })
        assertControlsFit(await controlGeometry(page, '.battle-command-buttons button'), current.viewport)
        assert.deepEqual(await textColumnCollisions(page, '.battle-log-current'), [], 'Battle log marker overlaps current message')
      }
    })
    await chooseScale(1)
    await click(page.locator('.battle-command-buttons .fight'))
    await page.locator('.battle-move-button').first().waitFor()
    const moveBaseline = await measurements(page, moveSelectors)
    for (const scale of [.5, 1, 1.5, 2]) await test(`${device.id}: move names and PP are exactly ${scale}x with usable move choices`, async () => {
      await chooseScale(scale)
      const current = await measurements(page, moveSelectors)
      metrics.push({ device: device.id, view: 'moves', scale, ...current })
      assertRatio(current, moveBaseline, scale)
      if (scale === 2) {
        await page.screenshot({ path: path.join(output, `${device.id}-moves-2x.png`) })
        const moveButtons = await page.locator('.battle-move-button').all()
        for (const [index, button] of moveButtons.entries()) {
          await button.scrollIntoViewIfNeeded()
          assertControlsFit([(await controlGeometry(page, '.battle-move-button'))[index]], current.viewport)
        }
        assert.deepEqual(await textColumnCollisions(page, '.battle-move-button'), [], 'Move name/PP/power/effectiveness columns overlap')
      }
    })
    if (!device.hasTouch) await test(`${device.id}: 2x move tooltip stays visible above the scrollable move choices`, async () => {
      await page.locator('.battle-move-button').first().scrollIntoViewIfNeeded()
      await page.locator('.battle-move-button').first().hover()
      const tooltip = page.locator('.battle-move-tooltip.is-visible')
      await tooltip.waitFor()
      const result = await tooltip.evaluate(element => {
        const r = element.getBoundingClientRect()
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
        return { width: innerWidth, height: innerHeight, left: r.left, right: r.right, top: r.top, bottom: r.bottom, receivesPointer: hit === element || element.contains(hit) }
      })
      assert(result.left >= 0 && result.right <= result.width + 1 && result.top >= 0 && result.bottom <= result.height + 1, JSON.stringify(result))
      assert(result.receivesPointer, `Tooltip clipped or covered: ${JSON.stringify(result)}`)
      await page.screenshot({ path: path.join(output, `${device.id}-tooltip-2x.png`) })
      await page.mouse.move(0, 0)
    })
    await chooseScale(1, true)
    const previewBaseline = await measurements(page, { preview: '.settings-text-scale-preview', option: '[aria-label="글자 크기"] button' })
    for (const scale of [.5, 1, 1.5, 2]) await test(`${device.id}: settings preview and controls follow ${scale}x and remain reachable`, async () => {
      await chooseScale(scale, true)
      const current = await measurements(page, { preview: '.settings-text-scale-preview', option: '[aria-label="글자 크기"] button' })
      assertRatio(current, previewBaseline, scale)
      if (scale === 2) {
        const buttons = page.getByRole('group', { name: '글자 크기', exact: true }).getByRole('button')
        const viewport = current.viewport
        await buttons.first().scrollIntoViewIfNeeded()
        for (const button of await buttons.all()) {
          const box = await button.boundingBox()
          assert(box && box.x >= 0 && box.x + box.width <= viewport.width + 1 && box.y >= 0 && box.y + box.height <= viewport.height + 1, JSON.stringify(box))
          assert(await button.isVisible())
        }
        for (const label of ['기본값 복원', '완료', '설정 닫기']) {
          const button = page.getByRole('button', { name: label, exact: true })
          await button.scrollIntoViewIfNeeded()
          const box = await button.boundingBox()
          assert(box && box.y >= 0 && box.y + box.height <= viewport.height + 1, `${label} ${JSON.stringify(box)}`)
        }
        await page.screenshot({ path: path.join(output, `${device.id}-settings-2x.png`) })
      }
    })
    await click(page.getByRole('button', { name: '설정 닫기', exact: true }))
    await test(`${device.id}: chosen size persists across reload and default reset restores 1x`, async () => {
      await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).game.textScale === 2, SETTINGS_STORAGE_KEY)
      await page.reload()
      await page.locator('.battle-command-buttons .fight').waitFor()
      assert.equal(await page.locator('html').getAttribute('data-game-text-scale'), '2')
      assertRatio(await measurements(page, commandSelectors), commandBaseline, 2)
      await click(page.getByRole('button', { name: '환경 설정', exact: true }))
      await click(page.getByRole('button', { name: '기본값 복원', exact: true }))
      await page.waitForFunction(() => document.documentElement.dataset.gameTextScale === '1')
      await click(page.getByRole('button', { name: '완료', exact: true }))
      assertRatio(await measurements(page, commandSelectors), commandBaseline, 1)
    })
    await page.evaluate(() => window.__textScaleHarness.view('ranked'))
    await page.locator('.ranked-leaderboard-row').last().waitFor()
    const rankedBaseline = await measurements(page, rankedSelectors)
    for (const scale of [.5, 1, 1.5, 2]) await test(`${device.id}: ranking header and rows follow ${scale}x`, async () => {
      await chooseScale(scale)
      const current = await measurements(page, rankedSelectors)
      metrics.push({ device: device.id, view: 'ranked', scale, ...current })
      assertRatio(current, rankedBaseline, scale)
      await page.locator('.ranked-leaderboard-row').last().scrollIntoViewIfNeeded()
      const overflow = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth, documentHeight: document.documentElement.scrollHeight }))
      assert(overflow.documentWidth <= overflow.width + 1 && overflow.documentHeight <= overflow.height + 1, JSON.stringify(overflow))
      if (scale === 2) await page.screenshot({ path: path.join(output, `${device.id}-ranked-2x.png`) })
    })
    await context.close()
  }
} finally {
  await browser?.close()
  await server.close()
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ checks, errors, metrics }, null, 2))
}
assert.equal(errors.length, 0, JSON.stringify(errors))
assert(checks.every(check => check.passed), 'Game text-scale UI regression failed')
console.log(`${checks.length}/${checks.length} passed; browser errors ${errors.length}`)
