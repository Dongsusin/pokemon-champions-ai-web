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

const root = fileURLToPath(new URL('../', import.meta.url))
const output = path.join(root, 'scripts/.cache/move-pp-training-ui')
await fs.mkdir(output, { recursive: true })
const pokemon = normalizePokemon({
  speciesId: 6, captureId: 'pp-training-charizard', directDrawCount: 1,
  moves: ['불꽃세례', '화염방사', '불대문자', '방어'],
})
assert.equal(pokemon.moves.length, 4)
const collection = migratePokemonCollection([pokemon])
const captureId = collection.find(entry => entry.speciesId === 6).captureId
const settings = createDefaultGameSettings()
settings.audio.enabled = false
const storage = {
  [SETTINGS_STORAGE_KEY]: settings,
  'champions-dex-v2': collection,
  'champions-teams-v1': {
    activeTeamId: 'team-1', teams: [{ id: 'team-1', name: '팀 1', pokemonIds: [captureId] }],
  },
}
const styles = [
  'styles', 'screenRedesign', 'battleGen5', 'titleCleanup', 'battleGimmicks',
  'moveAnimationDirector', 'settings', 'auth', 'mobileLandscape', 'gameTextScale',
  'scaledBoxCards', 'scaledBattleCards', 'scaledTrainingEditor', 'mobileTouch',
  'mobileUiV2', 'mobileReferenceLayout', 'trainingEmptyMoves',
]
const entry = [
  "import '/src/mobileViewport.js';",
  "import React from 'react';",
  "import { createRoot } from 'react-dom/client';",
  "import { GameApp } from '/src/App.jsx';",
  "import BattleScreen from '/src/BattleScreen.jsx';",
  "import { createBattle } from '/src/data/battleEngine.js';",
  "import { normalizePokemon } from '/src/data/trainingData.js';",
  "import { TRAINERS } from '/src/data/trainerTeams.js';",
  ...styles.map(name => "import '/src/" + name + ".css';"),
  'function Harness() {',
  ' const [fixture, setFixture] = React.useState(null);',
  ' window.__mountSavedBattle = () => {',
  "  const saved = JSON.parse(localStorage.getItem('champions-dex-v2')).find(p => p.captureId === " + JSON.stringify(captureId) + ');',
  "  const opponent = normalizePokemon({ speciesId: 129, captureId: 'pp-opponent' });",
  '  const props = { competitionLabel: "PP 강화 검증", playerPokemon: [saved], opponent: TRAINERS[0],',
  '   opponentTeam: { pokemon: [opponent], battleGimmicks: [], strategy: {} } };',
  '  const state = createBattle(props); window.__savedPpBattle = state; setFixture({props, state});',
  ' };',
  ' if (fixture) return React.createElement("div", {className: "app-shell battle-view"},',
  '  React.createElement(BattleScreen, {...fixture.props, initialBattle: fixture.state, skipIntro: true,',
  '   soundEnabled: false, gameSettings: {attackAnimation: "skip", hpBarSpeed: "instant"}, onComplete: () => {}}));',
  ' return React.createElement(GameApp, {',
  "  user: {uid: 'pp-training-ui', displayName: 'PP 강화 검증', isAnonymous: true, isLocalGuest: false},",
  '  autoLogin: false, onPlayerDataChanged: () => {}, onSignOut: () => {} });',
  '}',
  'createRoot(document.getElementById("root")).render(React.createElement(Harness));',
].join('\n')
process.env.VITE_POKEMON_USAGE_ENABLED = 'false'
process.env.VITE_POKEMON_USAGE_DEMO = 'false'
process.env.VITE_RANKED_LOCAL_TEST = 'false'
const port = Number(process.env.MOVE_PP_TRAINING_UI_PORT ?? 5257)
const server = await createServer({
  root, mode: 'move-pp-training-validation', logLevel: 'error',
  plugins: [{
    name: 'move-pp-training-fixture', enforce: 'pre',
    resolveId(source) {
      if (source === '/move-pp-training-entry.js') return source
      if (source.endsWith('/auth/firebaseClient') || source.endsWith('/auth/firebaseClient.js')
        || source === './firebaseClient' || source === './firebaseClient.js') return '\0pp-training-auth'
    },
    load(id) {
      if (id === '/move-pp-training-entry.js') return entry
      if (id === '\0pp-training-auth') return 'export const firebaseAuth=null;export const firebaseDb=null;export const isFirebaseConfigured=false;export const missingFirebaseEnvironmentVariables=[];'
    },
  }],
  server: {host: '127.0.0.1', port, strictPort: true, hmr: false},
})
await server.listen()
const { chromium } = createRequire(new URL('../promo/package.json', import.meta.url))('playwright')
const sprite = await fs.readFile(path.join(root, 'scripts/fixtures/test-sprite-96.gif'))
const html = await server.transformIndexHtml('/move-pp-training.html',
  '<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body><div id="root"></div><script type="module" src="/move-pp-training-entry.js"></script></body></html>')
const checks = [], failures = [], pageErrors = []
const pass = name => { checks.push(name); console.log('PASS ' + name) }
const stored = page => page.evaluate(id => ({
  pokemon: JSON.parse(localStorage.getItem('champions-dex-v2')).find(p => p.captureId === id),
  vp: Number(localStorage.getItem('champions-vp-v1')),
}), captureId)
let browser
try {
  browser = await chromium.launch({executablePath: await resolveChromiumExecutable(chromium), headless: true})
  for (const device of [
    {id: 'desktop', viewport: {width: 1440, height: 900}},
    {id: 'mobile', viewport: {width: 844, height: 390}, screen: {width: 844, height: 390}, hasTouch: true, isMobile: true},
  ]) {
    const mobile = device.id === 'mobile'
    const context = await browser.newContext({...device, reducedMotion: 'reduce'})
    let page
    try {
      await context.addInitScript(initial => {
        for (const [key, value] of Object.entries(initial)) {
          if (localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify(value))
        }
        if (localStorage.getItem('champions-vp-v1') === null) localStorage.setItem('champions-vp-v1', '900')
        if (localStorage.getItem('champions-draw-tutorial-v1') === null) localStorage.setItem('champions-draw-tutorial-v1', 'complete')
      }, storage)
      await context.route(/^https:\/\//, route => route.request().resourceType() === 'image'
        ? route.fulfill({contentType: 'image/gif', body: sprite}) : route.abort())
      await context.route('**/api/**', route => route.abort())
      await context.route('**/move-pp-training.html', route => route.fulfill({contentType: 'text/html', body: html}))
      page = await context.newPage()
      page.setDefaultTimeout(12_000)
      page.on('pageerror', error => pageErrors.push({device: device.id, message: error.message}))
      const activate = async locator => mobile ? locator.tap() : locator.click()
      const openTraining = async () => {
        await page.getByRole('heading', {name: '플레이 메뉴', exact: true}).waitFor()
        await activate(page.locator('.mode-card.mode-training'))
        if (mobile) {
          const tab = page.locator('.training-mobile-pages button').nth(2)
          if (await tab.isVisible()) await activate(tab)
        }
        await page.locator('.training-move-card').first().waitFor()
      }
      const plus = name => page.getByRole('button', {name: name + ' PP 강화', exact: true})
      const minus = name => page.getByRole('button', {name: name + ' PP 강화 취소', exact: true})
      const card = name => page.locator('.training-move-card').filter({has: plus(name)})
      const save = page.locator('.training-editor-actions > button.primary')
      const reset = page.locator('.training-editor-actions > button:not(.primary)')
      await page.goto('http://127.0.0.1:' + port + '/move-pp-training.html')
      await openTraining()
      assert.equal((await stored(page)).vp, 900)
      assert(await minus('화염방사').isDisabled())
      await activate(plus('화염방사'))
      assert.match(await card('화염방사').innerText(), /16/)
      assert.match(await save.innerText(), /100/)
      assert.deepEqual((await stored(page)).pokemon.movePpUps, {})
      await activate(minus('화염방사'))
      assert(await save.isDisabled())
      assert(await minus('화염방사').isDisabled())
      pass(device.id + ': PP +1 preview and undo leave saved data and VP unchanged')
      for (const [name, cap] of [['불꽃세례', 5], ['화염방사', 4], ['불대문자', 3]]) {
        for (let i = 0; i < cap; i++) await activate(plus(name))
        assert(await plus(name).isDisabled(), name + ' stops at ' + cap)
        assert.match(await card(name).innerText(), new RegExp(cap + '\\s*/\\s*' + cap))
      }
      assert(await save.isDisabled(), '1200 VP draft cannot save with 900 VP')
      assert.match(await save.innerText(), /300/)
      assert.equal((await stored(page)).vp, 900)
      await page.screenshot({path: path.join(output, device.id + '-limits.png')})
      pass(device.id + ': 3/4/5 caps and insufficient VP block saving')
      await activate(reset)
      assert(await save.isDisabled())
      for (const name of ['불꽃세례', '화염방사', '불대문자']) assert(await minus(name).isDisabled())
      for (let i = 0; i < 3; i++) await activate(plus('불대문자'))
      assert(await save.isEnabled())
      await activate(save)
      await page.waitForFunction(id => JSON.parse(localStorage.getItem('champions-dex-v2')).find(p => p.captureId === id)?.movePpUps?.fireblast === 3, captureId)
      assert.equal((await stored(page)).vp, 600)
      assert(await minus('불대문자').isDisabled(), 'paid upgrades cannot be undone')
      await page.reload()
      await openTraining()
      assert.match(await card('불대문자').innerText(), /8/)
      assert(await plus('불대문자').isDisabled())
      assert(await minus('불대문자').isDisabled())
      assert(await save.isDisabled())
      pass(device.id + ': reset, exact VP debit, and trained PP persist through reload')
      await activate(plus('화염방사'))
      await activate(save)
      await page.waitForFunction(id => JSON.parse(localStorage.getItem('champions-dex-v2')).find(p => p.captureId === id)?.movePpUps?.flamethrower === 1, captureId)
      assert.equal((await stored(page)).vp, 500)
      await page.screenshot({path: path.join(output, device.id + '-saved.png')})
      await page.evaluate(() => window.__mountSavedBattle())
      await page.waitForFunction(() => Boolean(window.__savedPpBattle))
      const moves = await page.evaluate(() => window.__savedPpBattle.player.team[0].moves.map(m => ({id: m.id, maxPp: m.maxPp, currentPp: m.currentPp})))
      assert.deepEqual(moves.find(m => m.id === 'fireblast'), {id: 'fireblast', maxPp: 8, currentPp: 8})
      assert.deepEqual(moves.find(m => m.id === 'flamethrower'), {id: 'flamethrower', maxPp: 16, currentPp: 16})
      await activate(page.locator('button.fight'))
      await page.locator('.battle-move-button').first().waitFor()
      assert.match(await page.locator('.battle-move-button').filter({hasText: '불대문자'}).innerText(), /8\s*\/\s*8/)
      assert.match(await page.locator('.battle-move-button').filter({hasText: '화염방사'}).innerText(), /16\s*\/\s*16/)
      await page.screenshot({path: path.join(output, device.id + '-battle.png')})
      pass(device.id + ': saved upgrades appear in real battle engine and command menu')
    } catch (error) {
      failures.push({device: device.id, error: error.stack ?? error.message})
      console.error('FAIL ' + device.id + ': ' + (error.stack ?? error.message))
      await page?.screenshot({path: path.join(output, device.id + '-failure.png')}).catch(() => {})
    } finally { await context.close() }
  }
} finally {
  await browser?.close()
  await server.close()
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({checks, failures, pageErrors}, null, 2) + '\n')
}
assert.deepEqual(pageErrors, [], 'no browser runtime errors')
assert.deepEqual(failures, [], 'PP training UI checks pass')
console.log(checks.length + '/' + checks.length + ' checks passed')
