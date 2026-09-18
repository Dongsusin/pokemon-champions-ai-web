import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { normalizePokemon, canPokemonLearnMove } from '../src/data/trainingData.js'
import { migratePokemonCollection, getTrainingRosterPokemon } from '../src/data/pokemonPool.js'
import { createDefaultGameSettings, SETTINGS_STORAGE_KEY } from '../src/gameSettings.js'
import { resolveChromiumExecutable } from '../promo/scripts/browserRuntime.mjs'

// Real GameApp, TrainingScreen, normalization and local persistence. Fixtures
// supply one owned Pokemon and local sprite responses, never server records.
const root = fileURLToPath(new URL('../', import.meta.url))
const output = path.join(root, 'scripts/.cache/empty-training-moves-ui')
await fs.mkdir(output, { recursive: true })
const collection = migratePokemonCollection([
  normalizePokemon({ speciesId: 6, captureId: 'dex-6', directDrawCount: 1 }),
  normalizePokemon({ speciesId: 9, captureId: 'dex-9', directDrawCount: 1 }),
])
const pokemon = getTrainingRosterPokemon(collection).find(entry => entry.speciesId === 6)
const teamState = {
  activeTeamId: 'team-1',
  teams: [{ id: 'team-1', name: '팀 1', pokemonIds: [pokemon.captureId] }],
}
assert.equal(pokemon.moves.length, 4)
const styles = ['styles', 'screenRedesign', 'battleGen5', 'titleCleanup', 'battleGimmicks', 'moveAnimationDirector', 'settings', 'auth', 'mobileLandscape', 'gameTextScale', 'scaledBoxCards', 'scaledBattleCards', 'scaledTrainingEditor', 'mobileTouch', 'mobileUiV2', 'mobileReferenceLayout']
const entry = `import'/src/mobileViewport.js';import React,{StrictMode}from'react';import{createRoot}from'react-dom/client';import{GameApp}from'/src/App.jsx';
${styles.map(name => `import'/src/${name}.css';`).join('\n')}
createRoot(document.getElementById('root')).render(React.createElement(StrictMode,null,React.createElement(GameApp,{user:{uid:'empty-moves-ui',displayName:'기술 비우기 검증',isAnonymous:true,isLocalGuest:false},autoLogin:false,onPlayerDataChanged:()=>{},onSignOut:()=>{}})));`
process.env.VITE_POKEMON_USAGE_ENABLED = 'false'
process.env.VITE_POKEMON_USAGE_DEMO = 'false'
process.env.VITE_RANKED_LOCAL_TEST = 'false'
const port = Number(process.env.EMPTY_TRAINING_MOVES_UI_PORT ?? 5251)
const server = await createServer({ root, mode: 'empty-training-moves-validation', logLevel: 'error',
  plugins: [{ name: 'empty-training-moves-fixture', enforce: 'pre',
    resolveId(source) {
      if (source === '/empty-training-moves-entry.js') return source
      if (source.endsWith('/auth/firebaseClient') || source.endsWith('/auth/firebaseClient.js') || source === './firebaseClient' || source === './firebaseClient.js') return '\0empty-training-moves-auth'
    },
    load(id) {
      if (id === '/empty-training-moves-entry.js') return entry
      if (id === '\0empty-training-moves-auth') return 'export const firebaseAuth=null;export const firebaseDb=null;export const isFirebaseConfigured=false;export const missingFirebaseEnvironmentVariables=[];'
    },
  }], server: { host: '127.0.0.1', port, strictPort: true, hmr: false } })
await server.listen()
const require = createRequire(new URL('../promo/package.json', import.meta.url))
const { chromium } = require('playwright')
const sprite = await fs.readFile(path.join(root, 'scripts/fixtures/test-sprite-96.gif'))
const checks = [], errors = [], blockedRequests = [], metrics = []
async function check(name, run) {
  try { await run(); checks.push({ name, passed: true }); console.log(`PASS ${name}`) }
  catch (error) { checks.push({ name, passed: false, error: error.message }); throw error }
}
async function bounds(locator) {
  await locator.scrollIntoViewIfNeeded()
  return locator.evaluate(element => {
    const r = element.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: innerWidth, height: innerHeight, hit: hit === element || element.contains(hit) }
  })
}
function assertAccessible(r) {
  assert(r.left >= -1 && r.right <= r.width + 1 && r.top >= -1 && r.bottom <= r.height + 1 && r.hit, JSON.stringify(r))
}
let browser
try {
  browser = await chromium.launch({ executablePath: await resolveChromiumExecutable(chromium), headless: true })
  const html = await server.transformIndexHtml('/empty-training-moves.html', '<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body><div id="root"></div><script type="module" src="/empty-training-moves-entry.js"></script></body></html>')
  for (const device of [
    { id: 'desktop', viewport: { width: 1920, height: 900 }, scale: 1 },
    { id: 'mobile', viewport: { width: 844, height: 390 }, scale: 2, hasTouch: true, isMobile: true },
  ]) {
    const context = await browser.newContext({ ...device, reducedMotion: 'reduce' })
    const settings = createDefaultGameSettings(); settings.audio.enabled = false; settings.game.textScale = device.scale
    await context.addInitScript(({ settings, collection, settingsKey, teamState }) => {
      if (sessionStorage.getItem('empty-training-moves-initialized')) return
      localStorage.setItem(settingsKey, JSON.stringify(settings))
      localStorage.setItem('champions-dex-v2', JSON.stringify(collection))
      localStorage.setItem('champions-teams-v1', JSON.stringify(teamState))
      localStorage.setItem('champions-draw-tutorial-v1', 'complete')
      localStorage.setItem('champions-vp-v1', '50000')
      sessionStorage.setItem('empty-training-moves-initialized', 'true')
    }, { settings, collection, settingsKey: SETTINGS_STORAGE_KEY, teamState })
    await context.route(/^https:\/\//, route => {
      if (route.request().resourceType() === 'image') return route.fulfill({ contentType: 'image/gif', body: sprite })
      blockedRequests.push(route.request().url()); return route.abort()
    })
    await context.route('**/api/**', route => { blockedRequests.push(route.request().url()); return route.abort() })
    await context.route('**/empty-training-moves.html', route => route.fulfill({ contentType: 'text/html', body: html }))
    const page = await context.newPage()
    page.setDefaultTimeout(10_000)
    page.on('pageerror', error => errors.push({ device: device.id, message: error.message }))
    const activate = async locator => {
      assertAccessible(await bounds(locator))
      if (device.hasTouch) await locator.tap()
      else { await locator.focus(); await locator.press('Enter') }
    }
    const savedMoves = () => page.evaluate(id => JSON.parse(localStorage.getItem('champions-dex-v2')).find(entry => entry.captureId === id).moves, pokemon.captureId)
    const cards = page.locator('.training-move-card')
    const save = page.locator('.training-editor-actions > button.primary')
    const openTraining = async () => {
      await page.getByRole('heading', { name: '플레이 메뉴', exact: true }).waitFor()
      await activate(page.locator('.mode-card.mode-training'))
      // The compact landscape editor pages its sections; the move slots live
      // on the third page, so open it before waiting on the cards.
      const movePage = page.locator('.training-mobile-pages button').nth(2)
      if (await movePage.count() && await movePage.isVisible()) {
        await activate(movePage)
        await page.waitForTimeout(160)
      }
      await cards.first().waitFor()
      assert.equal(await page.locator('.training-editor-name h2').innerText(), pokemon.name)
      assert.equal(await cards.count(), 4)
    }
    await page.goto(`http://127.0.0.1:${port}/empty-training-moves.html`)
    await openTraining()

    await check(`${device.id}: ${device.isMobile ? 'the roster is the active team, with no filter controls' : "current-team filter shows only the active team's Pokemon"}`, async () => {
      const rosterCards = page.locator('.training-roster-card')
      const teamFilter = page.getByRole('button', { name: '팀 1에 편성된 포켓몬만 보기', exact: true })
      if (device.isMobile) {
        // Compact layouts train the battle party, so the roster is already
        // filtered and the sort/search row is not rendered at all.
        assert.equal(await rosterCards.count(), 1)
        assert.match(await rosterCards.first().getAttribute('aria-label'), /리자몽/)
        assert.equal(await teamFilter.count(), 0)
        assert.equal(await page.locator('.training-filter-row').count(), 0)
        return
      }
      assert.equal(await rosterCards.count(), 2)
      await activate(teamFilter)
      assert.equal(await rosterCards.count(), 1)
      assert.match(await rosterCards.first().getAttribute('aria-label'), /리자몽/)
      assert.equal(await teamFilter.getAttribute('aria-pressed'), 'true')
      await activate(teamFilter)
      assert.equal(await rosterCards.count(), 2)
    })

    const dialog = page.getByRole('dialog', { name: '배울 수 있는 기술', exact: true })
    const clearChoice = () => dialog.getByRole('button', { name: '빈 기술로 설정', exact: true })
    const checkLastMoveGuard = async () => {
      await activate(cards.first().locator('.training-move-select-button'))
      await dialog.waitFor()
      assert(await clearChoice().isDisabled())
      assert(await dialog.getByText(/최소 1개의 기술은 반드시 설정해야 합니다\./).isVisible())
      if (device.hasTouch) await activate(dialog.getByRole('button', { name: '기술 목록 닫기', exact: true }))
      else await page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'hidden' })
    }
    await check(`${device.id}: clear three moves, keep four visible slots and prevent clearing the last move`, async () => {
      assert.deepEqual(await savedMoves(), pokemon.moves)
      for (const slot of [4, 3, 2]) {
        await activate(cards.nth(slot - 1).locator('.training-move-select-button'))
        await dialog.waitFor()
        await activate(clearChoice())
        await dialog.waitFor({ state: 'hidden' })
        assert.equal(await cards.count(), 4)
      }
      await checkLastMoveGuard()
      assert.equal(await page.locator('.training-move-card.is-empty').count(), 3)
      assert.deepEqual(await savedMoves(), pokemon.moves, 'Draft changes must not overwrite the saved Pokemon')
      await page.screenshot({ path: path.join(output, `${device.id}-one-move-draft.png`) })
    })
    await check(`${device.id}: save and reload preserve one move and three empty choices`, async () => {
      await activate(save)
      await page.waitForFunction(id => JSON.parse(localStorage.getItem('champions-dex-v2')).find(entry => entry.captureId === id).moves.length === 1, pokemon.captureId)
      assert.deepEqual(await savedMoves(), pokemon.moves.slice(0, 1))
      await page.reload()
      await openTraining()
      assert.equal(await page.locator('.training-move-card.is-empty').count(), 3)
      await checkLastMoveGuard()
      assert.deepEqual(await savedMoves(), pokemon.moves.slice(0, 1))
    })
    await check(`${device.id}: an empty slot accepts a learned move and persists without restoring defaults`, async () => {
      const empty = cards.nth(1).locator('.training-move-select-button')
      await activate(empty)
      await dialog.waitFor()
      assert(await clearChoice().isDisabled(), 'An already empty slot cannot remove the last remaining move')
      const option = dialog.locator('.move-picker-choice:not([disabled])').filter({ has: page.locator('.move-picker-choice-name > strong') }).first()
      const moveName = await option.locator('.move-picker-choice-name > strong').innerText()
      assert(canPokemonLearnMove(pokemon.speciesId, moveName))
      assert.notEqual(moveName, pokemon.moves[0])
      await activate(option)
      await dialog.waitFor({ state: 'hidden' })
      await activate(save)
      await page.waitForFunction(id => JSON.parse(localStorage.getItem('champions-dex-v2')).find(entry => entry.captureId === id).moves.length === 2, pokemon.captureId)
      const expected = [pokemon.moves[0], moveName]
      assert.deepEqual(await savedMoves(), expected)
      await page.reload(); await openTraining()
      assert.deepEqual(await savedMoves(), expected)
      assert.equal(await page.locator('.training-move-card.is-empty').count(), 2)
      metrics.push({ device: device.id, scale: device.scale, storedMoves: await savedMoves(), cardCount: await cards.count() })
      await page.screenshot({ path: path.join(output, `${device.id}-two-moves-saved.png`) })
    })
    await context.close()
  }
} finally {
  await browser?.close()
  await server.close()
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ checks, errors, blockedRequests, metrics }, null, 2))
}
assert.equal(errors.length, 0, JSON.stringify(errors))
assert.equal(blockedRequests.length, 0, JSON.stringify(blockedRequests))
assert(checks.every(check => check.passed))
console.log(`${checks.length}/${checks.length} passed; browser errors ${errors.length}; external/API requests ${blockedRequests.length}`)
