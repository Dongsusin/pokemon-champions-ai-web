import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { normalizePokemon } from '../src/data/trainingData.js'
import { createSavedTeams } from '../src/data/teamData.js'
import { resolveChromiumExecutable } from '../promo/scripts/browserRuntime.mjs'

// Actual GameApp, local storage and battle engine on an isolated loopback origin.
// All external/API requests and Firebase are blocked. Observation hooks and the
// explicitly labelled terminal victory fixture exist only in intercepted test
// HTTP responses. The victory fixture validates round navigation, not combat.
const root = fileURLToPath(new URL('../', import.meta.url))
const output = path.join(root, 'scripts/.cache/ai-battle-format-ui')
await fs.mkdir(output, { recursive: true })
const port = Number(process.env.AI_FORMAT_UI_PORT ?? 5288)
const origin = `http://127.0.0.1:${port}`
const owned = [6, 9, 3, 25, 94, 149].map(speciesId => normalizePokemon({ speciesId, captureId: `dex-${speciesId}`, directDrawCount: 1 }))
const ids = owned.map(pokemon => pokemon.captureId)
const teams = createSavedTeams(ids, ids)
const styles = ['styles', 'screenRedesign', 'battleGen5', 'titleCleanup', 'battleGimmicks', 'moveAnimationDirector', 'settings', 'auth', 'mobileLandscape']
const entry = `import React,{StrictMode} from 'react';import{createRoot}from'react-dom/client';import{GameApp}from'/src/App.jsx';import '/src/mobileViewport.js';
${styles.map(name => `import '/src/${name}.css';`).join('\n')}
createRoot(document.getElementById('root')).render(React.createElement(StrictMode,null,React.createElement(GameApp,{
user:{uid:'ai-format-ui-offline',displayName:'AI 형식 검증',isLocalGuest:true},onPlayerDataChanged:()=>{}
})));`
const storage = {
  'champions-dex-v2': JSON.stringify(owned),
  'champions-teams-v1': JSON.stringify({ version: 1, activeTeamId: 'team-1', teams }),
  'champions-team-v2': JSON.stringify(ids),
  'champions-vp-v1': '7777',
  'champions-draw-tutorial-v1': 'complete',
  'champions-settings-v1': JSON.stringify({ audio: { enabled: false }, game: { attackAnimation: 'skip', hpBarSpeed: 'instant', playerGender: 'male' } }),
}
const checks = []
const browserErrors = []
const blockedRequests = []
const layouts = []
async function check(name, type, callback) {
  try { await callback(); checks.push({ name, type, passed: true }); console.log(`PASS [${type}] ${name}`) }
  catch (error) { checks.push({ name, type, passed: false, error: error.message }); console.error(`FAIL [${type}] ${name}: ${error.message}`); throw error }
}
const server = await createServer({ root, mode: 'ai-format-ui-validation', logLevel: 'error',
  plugins: [{ name: 'ai-format-game-app-fixture', enforce: 'pre',
    resolveId(source) {
      if (source === '/ai-format-ui-entry.js') return source
      if (/\/auth\/firebaseClient(?:\.js)?$/.test(source) || source === './firebaseClient') return '\0ai-format-offline-auth'
    },
    load(id) {
      if (id === '/ai-format-ui-entry.js') return entry
      if (id === '\0ai-format-offline-auth') return 'export const firebaseAuth=null;export const firebaseDb=null;export const isFirebaseConfigured=false;export const missingFirebaseEnvironmentVariables=[];'
    },
  }], server: { host: '127.0.0.1', port, strictPort: true, hmr: false } })
await server.listen()
const require = createRequire(new URL('../promo/package.json', import.meta.url))
const { chromium } = require('playwright')
let browser
try {
  browser = await chromium.launch({ executablePath: await resolveChromiumExecutable(chromium), headless: true })
  const html = await server.transformIndexHtml('/ai-format-ui.html', '<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body><div id="root"></div><script type="module" src="/ai-format-ui-entry.js"></script></body></html>')
  // Pairwise matrix exercises both competition kinds and both battle formats on
  // each viewport while keeping this focused controller/UI regression bounded.
  for (const scenario of [
    { id: 'desktop-single-tournament', format: 'single', mode: 'tournament', viewport: { width: 1440, height: 900 } },
    { id: 'desktop-double-league', format: 'double', mode: 'league', viewport: { width: 1440, height: 900 } },
    { id: 'mobile-single-league', format: 'single', mode: 'league', viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true },
    { id: 'mobile-double-tournament', format: 'double', mode: 'tournament', viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true },
  ]) {
    const { id, format, mode, viewport, hasTouch, isMobile } = scenario
    if (process.env.AI_FORMAT_UI_SCENARIO && id !== process.env.AI_FORMAT_UI_SCENARIO) continue
    const context = await browser.newContext({ viewport, hasTouch, isMobile })
    const hooks = { app: 0, battle: 0 }
    await context.addInitScript(seed => {
      localStorage.clear()
      for (const [key, value] of Object.entries(seed)) localStorage.setItem(key, value)
      window.__aiFormatFixtureWins = 0
    }, storage)
    await context.route('**/*', async route => {
      const url = new URL(route.request().url())
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.pathname.startsWith('/api/')) {
        blockedRequests.push({ scenario: id, url: url.href, method: route.request().method() })
        await route.abort('blockedbyclient'); return
      }
      await route.continue()
    })
    await context.route('**/ai-format-ui.html', route => route.fulfill({ contentType: 'text/html', body: html }))
    await context.route('**/src/App.jsx', async route => {
      const response = await route.fetch()
      const original = await response.text()
      const body = original.replace(/const \[competition, setCompetition\] = useState\(null\);?/,
        '$&\nwindow.__readAiCompetition = () => structuredClone(competition);')
      assert.notEqual(body, original, 'GameApp competition observer must be installed')
      hooks.app++
      await route.fulfill({ response, body })
    })
    await context.route('**/src/BattleScreen.jsx', async route => {
      const response = await route.fetch()
      const original = await response.text()
      const body = original.replace(/const \[introVisible, setIntroVisible\] = useState\(!online\);?/,
        `$&
window.__readAiBattle = () => structuredClone(battle);
window.__fixtureAiVictory = () => {
  window.__aiFormatFixtureWins++;
  setBattle(current => ({...current,phase:'complete',winner:'player',opponent:{...current.opponent,team:current.opponent.team.map(pokemon=>({...pokemon,hp:0,fainted:true}))}}));
};`)
      assert.notEqual(body, original, 'BattleScreen observation and explicit victory-fixture hooks must be installed')
      hooks.battle++
      await route.fulfill({ response, body })
    })
    const page = await context.newPage()
    page.setDefaultTimeout(20_000)
    page.on('pageerror', error => browserErrors.push({ scenario: id, error: error.message }))
    const click = locator => hasTouch ? locator.tap() : locator.click()
    const readCompetition = () => page.evaluate(() => window.__readAiCompetition())
    const readBattle = () => page.evaluate(() => window.__readAiBattle())
    const count = format === 'double' ? 4 : 3
    const slots = format === 'double' ? 2 : 1
    const party = page.locator('.competition-team-selection > div > button')
    const start = page.locator('.competition-current-match-panel > footer > button')
    const layout = async (stage, selectors) => {
      const state = await page.evaluate(selectors => ({
        viewport: { width: innerWidth, height: innerHeight },
        body: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
        containers: ['.app-shell', '.topbar', 'main'].map(selector => {
          const element = document.querySelector(selector)
          if (!element) return { selector, missing: true }
          const rect = element.getBoundingClientRect()
          const style = getComputedStyle(element)
          return { selector, rect: rect.toJSON(), display: style.display, height: style.height, minHeight: style.minHeight }
        }),
        controls: selectors.flatMap(selector => [...document.querySelectorAll(selector)].map(element => {
          const rect = element.getBoundingClientRect()
          return { selector, text: element.textContent, x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom }
        })),
      }), selectors)
      layouts.push({ scenario: id, stage, ...state })
      assert(state.body.width <= state.viewport.width + 1, `Unexpected page horizontal overflow: ${JSON.stringify(state)}`)
      assert(state.body.height <= state.viewport.height + 1, `Unexpected body vertical overflow: ${JSON.stringify(state)}`)
      assert(state.controls.length > 0)
      for (const control of state.controls) {
        assert(control.width > 0 && control.height > 0 && control.x >= -1 && control.y >= -1 && control.right <= state.viewport.width + 1 && control.bottom <= state.viewport.height + 1,
          `Required control must be inside viewport: ${JSON.stringify(control)}`)
      }
    }
    const assertBattle = async order => {
      const battle = await readBattle()
      assert.equal(battle.rules.format.id, format)
      assert.equal(battle.rules.format.activeSlots, slots)
      assert.equal(battle.player.team.length, count)
      assert.equal(battle.opponent.team.length, count)
      assert.equal(battle.player.activeIndexes.length, slots)
      assert.equal(battle.opponent.activeIndexes.length, slots)
      assert.deepEqual(battle.player.team.map(pokemon => pokemon.captureId), order.map(index => ids[index]))
      assert.deepEqual(battle.player.activeIndexes.map(index => battle.player.team[index].captureId), order.slice(0, slots).map(index => ids[index]))
      assert(battle.player.team.every(pokemon => pokemon.level === 50))
      assert.equal(battle.environment.baseWeather.id, 'clear', 'Pre-ability weather must be clear')
      assert.equal(battle.environment.baseTerrain.id, 'neutral', 'Pre-ability terrain must be neutral')
      assert.equal(battle.rules.disabledGimmickId, null)
    }
    const begin = async () => {
      await click(start)
      await page.locator('.battle-intro-overlay.is-ready').waitFor({ timeout: 30_000 })
      await click(page.getByRole('button', { name: '배틀 개시', exact: true }))
      await page.locator('.battle-trainer-dialogue-layer').waitFor({ state: 'hidden', timeout: 15_000 })
      await page.waitForFunction(() => {
        const fight = document.querySelector('.battle-command-buttons .fight')
        return fight && !fight.disabled
      })
    }
    try {
      await page.goto(`${origin}/ai-format-ui.html`)
      await click(page.getByRole('button', { name: /시작하기/ }))
      await click(page.locator('.battle-hub-card.ai'))
      await check(`${id}: choose single/double before the competition and keep controls in view`, 'real-ui', async () => {
        await page.locator('.ai-battle-format-options').waitFor()
        assert.equal(await page.locator('.ai-battle-format-options button').count(), 2)
        await click(page.locator('.ai-battle-format-options button').filter({ hasText: format === 'single' ? '싱글배틀' : '더블배틀' }))
        await click(page.locator('.battle-mode-option-card').filter({ hasText: mode === 'league' ? '8인 리그전' : '128강 토너먼트' }))
        const selected = page.locator('.ai-battle-format-options button[aria-pressed="true"]')
        assert((await selected.innerText()).includes(`${count}마리 선출`))
        await layout('format-selection', ['.ai-battle-format-options button', '.battle-mode-confirm-bar > button'])
        await page.screenshot({ path: path.join(output, `${id}-format.png`) })
        await click(page.getByRole('button', { name: '이 모드로 시작', exact: true }))
        await page.locator('.competition-team-selection').waitFor()
        const competition = await readCompetition()
        assert.equal(competition.mode, mode)
        assert.equal(competition.battleFormat, format)
        assert.equal(competition.currentMatchRules.weather.id, 'clear')
        assert.equal(competition.currentMatchRules.terrain.id, 'neutral')
        assert.equal(competition.currentMatchRules.disabledGimmickId, null)
      })
      const order = [2, 0, 5, 3].slice(0, count)
      await check(`${id}: require exactly ${count} of six and assign lead slots in click order`, 'real-ui', async () => {
        assert.equal(await party.count(), 6)
        assert(await start.isDisabled())
        for (const index of order.slice(0, -1)) await click(party.nth(index))
        assert(await start.isDisabled())
        await click(party.nth(order.at(-1)))
        assert(!(await start.isDisabled()))
        assert.equal(await page.locator('.competition-team-selection button[aria-pressed="true"]').count(), count)
        assert.equal(await page.locator('.competition-team-selection .ai-selection-lead').count(), slots)
        const unselected = party.nth([0, 1, 2, 3, 4, 5].find(index => !order.includes(index)))
        assert.equal(await unselected.getAttribute('aria-disabled'), 'true')
        await click(party.nth(order.at(-1)))
        assert(await start.isDisabled(), 'Deselecting must disable start again')
        await click(party.nth(order.at(-1)))
        for (const [position, index] of order.entries()) assert.equal(await party.nth(index).getAttribute('aria-label'), `${owned[index].name}, ${position + 1}번 ${position < slots ? '선봉' : '출전'}`)
        await page.mouse.move(0, 0)
        await layout('party-selection', ['.competition-team-selection > div > button', '.competition-current-match-panel > footer > button'])
        await page.screenshot({ path: path.join(output, `${id}-party.png`) })
        await begin()
        await assertBattle(order)
        await page.screenshot({ path: path.join(output, `${id}-battle.png`) })
      })
      await check(`${id}: next round preserves format and resets all previous selections`, 'victory-fixture', async () => {
        await page.evaluate(() => window.__fixtureAiVictory())
        await page.locator('.battle-result-overlay.result-player').waitFor()
        await click(page.getByRole('button', { name: '배틀 마치기', exact: true }))
        await page.locator('.competition-team-selection').waitFor()
        const next = await readCompetition()
        assert.equal(next.round, 1)
        assert.equal(next.battleFormat, format)
        assert.equal(next.currentMatchRules.format.id, format)
        assert.equal(next.currentMatchRules.teamRule.battleSize, count)
        assert.equal(next.currentMatchRules.weather.id, 'clear')
        assert.equal(next.currentMatchRules.terrain.id, 'neutral')
        assert.equal(await page.locator('.competition-team-selection button[aria-pressed="true"]').count(), 0)
        assert(await start.isDisabled())
        const nextOrder = [4, 1, 3, 0].slice(0, count)
        for (const index of nextOrder) await click(party.nth(index))
        await begin()
        await assertBattle(nextOrder)
        assert.equal(await page.evaluate(() => window.__aiFormatFixtureWins), 1)
      })
      await check(`${id}: no browser errors and all test observations remain isolated`, 'isolation', async () => {
        assert(hooks.app > 0 && hooks.battle > 0)
        assert.deepEqual(browserErrors.filter(error => error.scenario === id), [])
        assert.deepEqual(blockedRequests.filter(request => request.scenario === id && new URL(request.url).pathname.startsWith('/api/')), [])
      })
    } catch (error) {
      if (!checks.some(result => !result.passed && result.name.startsWith(`${id}:`))) checks.push({ name: `${id}: harness setup`, type: 'harness', passed: false, error: error.message })
      await page.screenshot({ path: path.join(output, `${id}-failure.png`), fullPage: true }).catch(() => {})
    } finally { await context.close() }
  }
} finally { await browser?.close(); await server.close() }
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ checks, layouts, browserErrors, blockedRequests,
  note: 'GameApp and engine are unmodified. Terminal victory is an explicit intercepted-response fixture used only for next-round UI transitions; baseWeather/baseTerrain checks happen before legitimate entry-ability effects.' }, null, 2))
const failed = checks.filter(check => !check.passed)
console.log(`\nAI battle format GameApp UI: ${checks.length - failed.length}/${checks.length} checks passed; ${browserErrors.length} browser errors. Report: ${path.join(output, 'report.json')}`)
if (failed.length || browserErrors.length) process.exitCode = 1
