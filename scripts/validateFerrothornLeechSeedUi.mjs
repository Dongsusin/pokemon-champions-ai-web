import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { normalizePokemon } from '../src/data/trainingData.js'
import { migratePokemonCollection, getTrainingRosterPokemon } from '../src/data/pokemonPool.js'
import { createDefaultGameSettings, SETTINGS_STORAGE_KEY } from '../src/gameSettings.js'
import { resolveChromiumExecutable } from '../promo/scripts/browserRuntime.mjs'

// The actual GameApp and TrainingScreen exercise learned-move selection and
// collection persistence. Only local fixtures and local browser storage change.
const root = fileURLToPath(new URL('../', import.meta.url))
const output = path.join(root, 'scripts/.cache/ferrothorn-leech-seed-ui')
await fs.mkdir(output, { recursive: true })
const collection = migratePokemonCollection([normalizePokemon({
  speciesId: 598, captureId: 'dex-598', directDrawCount: 1,
  moves: ['방어', '자이로볼', '파워휩', '철벽'],
})])
const pokemon = getTrainingRosterPokemon(collection).find(entry => entry.speciesId === 598)
assert(pokemon && !pokemon.moves.includes('씨뿌리기'))
const styles = ['styles', 'screenRedesign', 'battleGen5', 'titleCleanup', 'battleGimmicks', 'moveAnimationDirector', 'settings', 'auth', 'mobileLandscape', 'gameTextScale', 'scaledBoxCards', 'scaledBattleCards', 'scaledTrainingEditor']
const entry = `import'/src/mobileViewport.js';import React,{StrictMode}from'react';import{createRoot}from'react-dom/client';import{GameApp}from'/src/App.jsx';
${styles.map(name => `import'/src/${name}.css';`).join('\n')}
createRoot(document.getElementById('root')).render(React.createElement(StrictMode,null,React.createElement(GameApp,{user:{uid:'ferrothorn-ui',displayName:'너트령 검증',isAnonymous:true,isLocalGuest:false},autoLogin:false,onPlayerDataChanged:()=>{},onSignOut:()=>{}})));`
process.env.VITE_POKEMON_USAGE_ENABLED = 'false'
process.env.VITE_POKEMON_USAGE_DEMO = 'false'
process.env.VITE_RANKED_LOCAL_TEST = 'false'
const port = Number(process.env.FERROTHORN_LEECH_SEED_UI_PORT ?? 5258)
const server = await createServer({ root, mode: 'ferrothorn-leech-seed-validation', logLevel: 'error',
  plugins: [{ name: 'ferrothorn-leech-seed-fixture', enforce: 'pre',
    resolveId(source) {
      if (source === '/ferrothorn-leech-seed-entry.js') return source
      if (source.endsWith('/auth/firebaseClient') || source.endsWith('/auth/firebaseClient.js') || source === './firebaseClient' || source === './firebaseClient.js') return '\0ferrothorn-leech-seed-auth'
    },
    load(id) {
      if (id === '/ferrothorn-leech-seed-entry.js') return entry
      if (id === '\0ferrothorn-leech-seed-auth') return 'export const firebaseAuth=null;export const firebaseDb=null;export const isFirebaseConfigured=false;export const missingFirebaseEnvironmentVariables=[];'
    },
  }], server: { host: '127.0.0.1', port, strictPort: true, hmr: false } })
await server.listen()
const require = createRequire(new URL('../promo/package.json', import.meta.url))
const { chromium } = require('playwright')
const sprite = await fs.readFile(path.join(root, 'public/assets/pokemon/skins/armored-mewtwo-front.gif'))
const checks = [], errors = [], blockedRequests = []
async function check(name, run) {
  try { await run(); checks.push({ name, passed: true }); console.log(`PASS ${name}`) }
  catch (error) { checks.push({ name, passed: false, error: error.message }); throw error }
}
let browser
try {
  browser = await chromium.launch({ executablePath: await resolveChromiumExecutable(chromium), headless: true })
  const html = await server.transformIndexHtml('/ferrothorn-leech-seed.html', '<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body><div id="root"></div><script type="module" src="/ferrothorn-leech-seed-entry.js"></script></body></html>')
  for (const device of [
    { id: 'desktop', viewport: { width: 1920, height: 900 }, scale: 1 },
    { id: 'mobile', viewport: { width: 844, height: 390 }, scale: 2, hasTouch: true, isMobile: true },
  ]) {
    const context = await browser.newContext({ ...device, reducedMotion: 'reduce' })
    const settings = createDefaultGameSettings(); settings.audio.enabled = false; settings.game.textScale = device.scale
    await context.addInitScript(({ settings, collection, settingsKey }) => {
      if (sessionStorage.getItem('ferrothorn-leech-seed-initialized')) return
      localStorage.setItem(settingsKey, JSON.stringify(settings))
      localStorage.setItem('champions-dex-v2', JSON.stringify(collection))
      localStorage.setItem('champions-draw-tutorial-v1', 'complete')
      localStorage.setItem('champions-vp-v1', '50000')
      sessionStorage.setItem('ferrothorn-leech-seed-initialized', 'true')
    }, { settings, collection, settingsKey: SETTINGS_STORAGE_KEY })
    await context.route(/^https:\/\//, route => {
      if (route.request().resourceType() === 'image') return route.fulfill({ contentType: 'image/gif', body: sprite })
      blockedRequests.push(route.request().url()); return route.abort()
    })
    await context.route('**/api/**', route => { blockedRequests.push(route.request().url()); return route.abort() })
    await context.route('**/ferrothorn-leech-seed.html', route => route.fulfill({ contentType: 'text/html', body: html }))
    const page = await context.newPage()
    page.setDefaultTimeout(10_000)
    page.on('pageerror', error => errors.push({ device: device.id, message: error.message }))
    const activate = async locator => {
      await locator.scrollIntoViewIfNeeded()
      if (device.hasTouch) await locator.tap()
      else await locator.click()
    }
    const savedMoves = () => page.evaluate(id => JSON.parse(localStorage.getItem('champions-dex-v2')).find(entry => entry.captureId === id).moves, pokemon.captureId)
    const cards = page.locator('.training-move-card')
    const save = page.locator('.training-editor-actions > button.primary')
    const dialog = page.getByRole('dialog', { name: '배울 수 있는 기술', exact: true })
    const option = dialog.locator('.move-picker-choice').filter({ has: page.locator('.move-picker-choice-name > strong', { hasText: /^씨뿌리기$/ }) })
    const openTraining = async () => {
      await page.getByRole('heading', { name: '플레이 메뉴', exact: true }).waitFor()
      await activate(page.locator('.mode-card.mode-training'))
      await cards.first().waitFor()
      assert.equal(await page.locator('.training-editor-name h2').innerText(), '너트령')
    }
    const searchSeed = async slot => {
      await activate(cards.nth(slot).locator('.training-move-select-button'))
      await dialog.waitFor()
      await dialog.getByRole('searchbox', { name: '기술 이름 검색', exact: true }).fill('씨뿌리기')
      await option.waitFor()
      assert.equal(await option.count(), 1)
    }
    await page.goto(`http://127.0.0.1:${port}/ferrothorn-leech-seed.html`)
    await openTraining()
    await check(`${device.id}: search and select Ferrothorn Leech Seed without mutating the saved collection`, async () => {
      await searchSeed(0)
      assert(await option.isEnabled())
      assert.match(await option.innerText(), /씨뿌리기/)
      assert.match(await option.innerText(), /변화/)
      await page.screenshot({ path: path.join(output, `${device.id}-leech-seed-search.png`) })
      await activate(option)
      await dialog.waitFor({ state: 'hidden' })
      assert.match(await cards.first().innerText(), /씨뿌리기/)
      assert.deepEqual(await savedMoves(), pokemon.moves)
    })
    const expected = ['씨뿌리기', ...pokemon.moves.slice(1)]
    await check(`${device.id}: saving and reopening training preserve Leech Seed and reject duplicate selection`, async () => {
      await activate(save)
      await page.waitForFunction(id => JSON.parse(localStorage.getItem('champions-dex-v2')).find(entry => entry.captureId === id).moves[0] === '씨뿌리기', pokemon.captureId)
      assert.deepEqual(await savedMoves(), expected)
      await activate(page.getByRole('button', { name: '로비로 돌아가기', exact: true }))
      await openTraining()
      assert.match(await cards.first().innerText(), /씨뿌리기/)
      await searchSeed(1)
      assert(await option.isDisabled(), 'A move already present in another slot must not be duplicated')
      await activate(dialog.getByRole('button', { name: '기술 목록 닫기', exact: true }))
      await dialog.waitFor({ state: 'hidden' })
    })
    await check(`${device.id}: browser reload retains the saved four moves including Leech Seed`, async () => {
      await page.reload()
      await openTraining()
      assert.deepEqual(await savedMoves(), expected)
      assert.equal(await cards.count(), 4)
      assert.match(await cards.first().innerText(), /씨뿌리기/)
      await page.screenshot({ path: path.join(output, `${device.id}-saved-after-reload.png`) })
    })
    await context.close()
  }
} finally {
  await browser?.close()
  await server.close()
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ checks, errors, blockedRequests }, null, 2))
}
assert.equal(errors.length, 0, JSON.stringify(errors))
assert.equal(blockedRequests.length, 0, JSON.stringify(blockedRequests))
assert(checks.every(check => check.passed))
console.log(`${checks.length}/${checks.length} passed; browser errors ${errors.length}; external/API requests ${blockedRequests.length}`)
