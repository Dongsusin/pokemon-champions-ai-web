import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { normalizePokemon } from '../src/data/trainingData.js'
import { migratePokemonCollection } from '../src/data/pokemonPool.js'
import { createDefaultGameSettings, SETTINGS_STORAGE_KEY } from '../src/gameSettings.js'
import { resolveChromiumExecutable } from '../promo/scripts/browserRuntime.mjs'

// Exercise the real training editor, save path, local persistence, battle
// normalization, and battle command menu on an isolated loopback origin.
const root = fileURLToPath(new URL('../', import.meta.url))
const output = path.join(root, 'scripts/.cache/training-move-reorder-ui')
await fs.mkdir(output, { recursive: true })

const pokemon = normalizePokemon({
  speciesId: 6, captureId: 'move-reorder-charizard', directDrawCount: 1,
})
assert.equal(pokemon.moves.length, 4)
assert.equal(new Set(pokemon.moves).size, 4)
const original = [...pokemon.moves]
const collection = migratePokemonCollection([pokemon])
const captureId = collection.find(entry => entry.speciesId === pokemon.speciesId)?.captureId
assert(captureId)
const settings = createDefaultGameSettings()
settings.audio.enabled = false
const storage = {
  [SETTINGS_STORAGE_KEY]: settings,
  'champions-dex-v2': collection,
  'champions-teams-v1': {
    activeTeamId: 'team-1',
    teams: [{ id: 'team-1', name: '팀 1', pokemonIds: [captureId] }],
  },
}
const styles = [
  'styles', 'screenRedesign', 'battleGen5', 'titleCleanup', 'battleGimmicks',
  'moveAnimationDirector', 'settings', 'auth', 'mobileLandscape',
  'gameTextScale', 'scaledBoxCards', 'scaledBattleCards',
  'scaledTrainingEditor', 'mobileTouch', 'mobileUiV2',
  'mobileReferenceLayout', 'trainingEmptyMoves',
]
const entry = [
  "import '/src/mobileViewport.js';",
  "import React, { StrictMode } from 'react';",
  "import { createRoot } from 'react-dom/client';",
  "import { GameApp } from '/src/App.jsx';",
  "import BattleScreen from '/src/BattleScreen.jsx';",
  "import { createBattle } from '/src/data/battleEngine.js';",
  "import { normalizePokemon } from '/src/data/trainingData.js';",
  "import { TRAINERS } from '/src/data/trainerTeams.js';",
  ...styles.map(name => "import '/src/" + name + ".css';"),
  'function Harness() {',
  "  const [battleFixture, setBattleFixture] = React.useState(null);",
  '  window.__mountSavedBattle = () => {',
  "    const saved = JSON.parse(localStorage.getItem('champions-dex-v2')).find(entry => entry.captureId === " + JSON.stringify(captureId) + ");",
  "    const opponent = normalizePokemon({ speciesId: 129, captureId: 'move-reorder-opponent' });",
  '    const props = { competitionLabel: "기술 순서 검증", playerPokemon: [saved],',
  '      opponent: TRAINERS[0], opponentTeam: { pokemon: [opponent], battleGimmicks: [], strategy: {} } };',
  '    const state = createBattle(props);',
  '    window.__savedMoveBattleState = state;',
  '    setBattleFixture({ props, state });',
  '  };',
  '  if (battleFixture) return React.createElement("div", { className: "app-shell battle-view" },',
  '    React.createElement(BattleScreen, { ...battleFixture.props, initialBattle: battleFixture.state,',
  '      skipIntro: true, soundEnabled: false, gameSettings: { attackAnimation: "skip", hpBarSpeed: "instant" },',
  '      onComplete: () => {} }));',
  '  return React.createElement(GameApp, {',
  "    user: { uid: 'move-reorder-ui', displayName: '기술 순서 검증', isAnonymous: true, isLocalGuest: false },",
  '    autoLogin: false, onPlayerDataChanged: () => {}, onSignOut: () => {},',
  '  });',
  '}',
  "createRoot(document.getElementById('root')).render(React.createElement(StrictMode, null, React.createElement(Harness)));",
].join('\n')

process.env.VITE_POKEMON_USAGE_ENABLED = 'false'
process.env.VITE_POKEMON_USAGE_DEMO = 'false'
process.env.VITE_RANKED_LOCAL_TEST = 'false'
const port = Number(process.env.TRAINING_MOVE_REORDER_UI_PORT ?? 5255)
const server = await createServer({
  root, mode: 'training-move-reorder-validation', logLevel: 'error',
  plugins: [{
    name: 'training-move-reorder-ui-fixture', enforce: 'pre',
    resolveId(source) {
      if (source === '/training-move-reorder-entry.js') return source
      if (source.endsWith('/auth/firebaseClient') || source.endsWith('/auth/firebaseClient.js')
        || source === './firebaseClient' || source === './firebaseClient.js') return '\0move-reorder-auth'
    },
    load(id) {
      if (id === '/training-move-reorder-entry.js') return entry
      if (id === '\0move-reorder-auth') {
        return 'export const firebaseAuth=null;export const firebaseDb=null;export const isFirebaseConfigured=false;export const missingFirebaseEnvironmentVariables=[];'
      }
    },
  }],
  server: { host: '127.0.0.1', port, strictPort: true, hmr: false },
})
await server.listen()
const { chromium } = createRequire(new URL('../promo/package.json', import.meta.url))('playwright')
const sprite = await fs.readFile(path.join(root, 'scripts/fixtures/test-sprite-96.gif'))
const html = await server.transformIndexHtml(
  '/training-move-reorder.html',
  '<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body><div id="root"></div><script type="module" src="/training-move-reorder-entry.js"></script></body></html>',
)
const checks = []
const failures = []
const pageErrors = []

async function storedMoves(page) {
  return page.evaluate(id => JSON.parse(localStorage.getItem('champions-dex-v2'))
    .find(entry => entry.captureId === id).moves, captureId)
}

async function shownMoves(page) {
  return (await page.locator('.training-move-card:not(.is-empty) .training-move-select-button > span').allTextContents())
    .map(name => name.trim())
}

async function waitForShownMoves(page, expected) {
  await page.waitForFunction(names => {
    const current = [...document.querySelectorAll('.training-move-card:not(.is-empty) .training-move-select-button > span')]
      .map(node => node.textContent.trim())
    return JSON.stringify(current) === JSON.stringify(names)
  }, expected)
  assert.deepEqual(await shownMoves(page), expected)
}

async function dragWithMouse(page, source, target) {
  await source.scrollIntoViewIfNeeded()
  await target.scrollIntoViewIfNeeded()
  const from = await source.boundingBox()
  const to = await target.boundingBox()
  assert(from && to, 'desktop drag handles must be visible')
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 })
  await page.mouse.up()
}

async function dragWithTouch(page, source, target) {
  await source.scrollIntoViewIfNeeded()
  await target.scrollIntoViewIfNeeded()
  const from = await source.boundingBox()
  const to = await target.boundingBox()
  assert(from && to, 'mobile drag handles must be visible')
  const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 }
  const end = { x: to.x + to.width / 2, y: to.y + to.height / 2 }
  const session = await page.context().newCDPSession(page)
  try {
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, ...start }] })
    await page.waitForTimeout(180)
    for (let step = 1; step <= 12; step++) {
      const fraction = step / 12
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{
        id: 1, x: start.x + (end.x - start.x) * fraction,
        y: start.y + (end.y - start.y) * fraction,
      }] })
      await page.waitForTimeout(16)
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  } finally {
    await session.detach()
  }
}

let browser
try {
  browser = await chromium.launch({ executablePath: await resolveChromiumExecutable(chromium), headless: true })
  for (const device of [
    { id: 'desktop', viewport: { width: 1440, height: 900 } },
    { id: 'mobile', viewport: { width: 844, height: 390 }, screen: { width: 844, height: 390 }, hasTouch: true, isMobile: true },
  ]) {
    const mobile = device.id === 'mobile'
    const context = await browser.newContext({ ...device, reducedMotion: 'reduce' })
    let page
    try {
      await context.addInitScript(initial => {
        for (const [key, value] of Object.entries(initial)) {
          if (localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify(value))
        }
        if (localStorage.getItem('champions-vp-v1') === null) localStorage.setItem('champions-vp-v1', '0')
        if (localStorage.getItem('champions-draw-tutorial-v1') === null) {
          localStorage.setItem('champions-draw-tutorial-v1', 'complete')
        }
      }, storage)
      await context.route(/^https:\/\//, route => route.request().resourceType() === 'image'
        ? route.fulfill({ contentType: 'image/gif', body: sprite }) : route.abort())
      await context.route('**/api/**', route => route.abort())
      await context.route('**/training-move-reorder.html', route => route.fulfill({ contentType: 'text/html', body: html }))
      page = await context.newPage()
      page.setDefaultTimeout(12_000)
      page.on('pageerror', error => pageErrors.push({ device: device.id, message: error.message }))
      await page.goto('http://127.0.0.1:' + port + '/training-move-reorder.html')
      await page.getByRole('heading', { name: '플레이 메뉴', exact: true }).waitFor()
      const training = page.locator('.mode-card.mode-training')
      if (mobile) await training.tap()
      else await training.click()
      if (mobile) {
        const movePage = page.locator('.training-mobile-pages button').nth(2)
        if (await movePage.isVisible()) await movePage.tap()
      }
      await page.locator('.training-move-card').first().waitFor()
      assert.equal(await page.locator('.training-editor-name h2').innerText(), pokemon.name)
      await waitForShownMoves(page, original)
      assert.deepEqual(await storedMoves(page), original)

      const handles = page.locator('.training-move-card .training-move-reorder-handle')
      assert.equal(await handles.count(), 4, 'each configured move must have a reorder handle')
      if (mobile) await dragWithTouch(page, handles.nth(0), handles.nth(2))
      else await dragWithMouse(page, handles.nth(0), handles.nth(2))
      let expected = [original[1], original[2], original[0], original[3]]
      await waitForShownMoves(page, expected)
      assert.deepEqual(await storedMoves(page), original, 'drag changes the draft only')
      assert.equal(await page.getByRole('dialog', { name: '배울 수 있는 기술' }).count(), 0,
        'dragging a handle must not open the move picker')
      checks.push(device.id + ': pointer drag changes draft without opening picker or saving')
      console.log('PASS ' + checks.at(-1))

      if (!mobile) {
        await handles.nth(2).focus()
        await handles.nth(2).press('ArrowUp')
        expected = [original[1], original[0], original[2], original[3]]
        await waitForShownMoves(page, expected)
        await handles.nth(1).focus()
        await handles.nth(1).press('Home')
        expected = [...original]
        await waitForShownMoves(page, expected)
        await handles.nth(0).focus()
        await handles.nth(0).press('End')
        expected = [original[1], original[2], original[3], original[0]]
        await waitForShownMoves(page, expected)
        assert.deepEqual(await storedMoves(page), original)
        checks.push(device.id + ': ArrowUp, Home, and End reorder without saving')
        console.log('PASS ' + checks.at(-1))
      }

      const save = page.locator('.training-editor-actions > button.primary')
      assert(await save.isEnabled(), 'a pure reorder must be saveable')
      assert.match(await save.innerText(), /무료/, 'a pure reorder must cost 0 VP')
      assert.equal(await page.evaluate(() => localStorage.getItem('champions-vp-v1')), '0')
      await page.screenshot({ path: path.join(output, device.id + '-draft.png') })
      if (mobile) await save.tap()
      else await save.click()
      await page.waitForFunction(([id, names]) => {
        const saved = JSON.parse(localStorage.getItem('champions-dex-v2')).find(entry => entry.captureId === id)
        return JSON.stringify(saved?.moves) === JSON.stringify(names)
      }, [captureId, expected])
      assert.deepEqual(await storedMoves(page), expected)
      assert.equal(await page.evaluate(() => localStorage.getItem('champions-vp-v1')), '0')
      await page.reload()
      await page.getByRole('heading', { name: '플레이 메뉴', exact: true }).waitFor()
      if (mobile) await training.tap()
      else await training.click()
      if (mobile) {
        const movePage = page.locator('.training-mobile-pages button').nth(2)
        if (await movePage.isVisible()) await movePage.tap()
      }
      await waitForShownMoves(page, expected)
      assert.deepEqual(await storedMoves(page), expected)
      checks.push(device.id + ': free save persists reordered moves through reload')
      console.log('PASS ' + checks.at(-1))

      await page.evaluate(() => window.__mountSavedBattle())
      await page.waitForFunction(() => Boolean(window.__savedMoveBattleState))
      const battleMoves = await page.evaluate(() => window.__savedMoveBattleState.player.team[0].moves.map(move => move.name))
      assert.deepEqual(battleMoves, expected, 'the battle engine must preserve saved order')
      const fight = page.locator('button.fight')
      await fight.waitFor()
      if (mobile) await fight.tap()
      else await fight.click()
      await page.locator('.battle-move-button').first().waitFor()
      const menuMoves = await page.locator('.battle-move-button .battle-move-name strong').allTextContents()
      assert.deepEqual(menuMoves, expected, 'battle command buttons must follow saved order')
      await page.screenshot({ path: path.join(output, device.id + '-battle.png') })
      checks.push(device.id + ': battle engine and command menu preserve saved order')
      console.log('PASS ' + checks.at(-1))
    } catch (error) {
      failures.push({ device: device.id, error: error.stack ?? error.message })
      console.error('FAIL ' + device.id + ': ' + (error.stack ?? error.message))
      await page?.screenshot({ path: path.join(output, device.id + '-failure.png') }).catch(() => {})
    } finally {
      await context.close()
    }
  }
} finally {
  await browser?.close()
  await server.close()
  await fs.writeFile(path.join(output, 'report.json'),
    JSON.stringify({ checks, failures, pageErrors }, null, 2) + '\n')
}
assert.deepEqual(pageErrors, [], 'the browser must have no uncaught errors')
assert.deepEqual(failures, [], 'all training move reorder UI checks must pass')
console.log(checks.length + '/' + checks.length + ' checks passed')
