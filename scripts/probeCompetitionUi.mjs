import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { normalizePokemon } from '../src/data/trainingData.js'
import { createSavedTeams } from '../src/data/teamData.js'
import { resolveChromiumExecutable } from '../promo/scripts/browserRuntime.mjs'

// Boots the real GameApp on a loopback origin, walks into an AI competition and
// reports what the competition screen actually lays out - which is how the
// league start control was found to be unreachable on a desktop window.
const root = fileURLToPath(new URL('../', import.meta.url))
const output = path.join(root, 'scripts/.cache/competition-ui')
await fs.mkdir(output, { recursive: true })
const port = Number(process.env.COMPETITION_UI_PORT ?? 5291)
const origin = `http://127.0.0.1:${port}`
const owned = [6, 9, 3, 25, 94, 149].map(speciesId => normalizePokemon({ speciesId, captureId: `dex-${speciesId}`, directDrawCount: 1 }))
const ids = owned.map(pokemon => pokemon.captureId)
const teams = createSavedTeams(ids, ids)
const styles = ['styles', 'screenRedesign', 'battleGen5', 'titleCleanup', 'battleGimmicks', 'moveAnimationDirector',
  'settings', 'auth', 'mobileLandscape', 'gameTextScale', 'scaledBoxCards', 'scaledBattleCards', 'scaledTrainingEditor',
  'mobileTouch', 'mobileUiV2', 'mobileReferenceLayout', 'installApp']
const entry = `import React from 'react';import{createRoot}from'react-dom/client';import{GameApp}from'/src/App.jsx';import '/src/mobileViewport.js';
${styles.map(name => `import '/src/${name}.css';`).join('\n')}
createRoot(document.getElementById('root')).render(React.createElement(GameApp,{
user:{uid:'competition-ui-offline',displayName:'리그 검증',isLocalGuest:true},onPlayerDataChanged:()=>{}
}));`
const storage = {
  'champions-dex-v2': JSON.stringify(owned),
  'champions-teams-v1': JSON.stringify({ version: 1, activeTeamId: 'team-1', teams }),
  'champions-team-v2': JSON.stringify(ids),
  'champions-vp-v1': '7777',
  'champions-draw-tutorial-v1': 'complete',
  'champions-settings-v1': JSON.stringify({ audio: { enabled: false }, game: { attackAnimation: 'skip', hpBarSpeed: 'instant', playerGender: 'male' } }),
}

const server = await createServer({
  root,
  mode: 'competition-ui-probe',
  logLevel: 'error',
  plugins: [{
    name: 'competition-ui-fixture',
    enforce: 'pre',
    resolveId(source) {
      if (source === '/competition-ui-entry.js') return source
      if (/firebaseClient(?:\.js)?$/.test(source)) return '\0competition-ui-offline-auth'
      return undefined
    },
    load(id) {
      if (id === '/competition-ui-entry.js') return entry
      if (id === '\0competition-ui-offline-auth') return 'export const firebaseAuth=null;export const firebaseDb=null;export const isFirebaseConfigured=false;export const missingFirebaseEnvironmentVariables=[];'
      return undefined
    },
  }],
  server: { host: '127.0.0.1', port, strictPort: true, hmr: false },
})
await server.listen()
const html = await server.transformIndexHtml('/competition-ui.html', '<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body><div id="root"></div><script type="module" src="/competition-ui-entry.js"></script></body></html>')

// Runs in the page. Reports the competition grid and every control the player
// needs, including ones a clipped ancestor has hidden.
function inspect() {
  const box = node => { const rect = node.getBoundingClientRect(); return { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height), bottom: Math.round(rect.bottom) } }
  const label = node => node.tagName.toLowerCase() + (typeof node.className === 'string' && node.className.trim() ? '.' + node.className.trim().split(/\s+/).slice(0, 2).join('.') : '')
  const screen = document.querySelector('.competition-screen')
  const panel = document.querySelector('.competition-current-match-panel')
  const start = document.querySelector('.competition-current-match-panel > footer > button')
  const fixturesStart = document.querySelector('.competition-fixtures-start')
  const standingsToggle = document.querySelector('.competition-standings-toggle')
  const standingsPopover = document.querySelector('.competition-standings-popover')
  const selection = document.querySelector('.competition-team-selection')
  const reachable = node => {
    if (!node) return null
    const rect = node.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) return { visible: false, why: 'zero size' }
    if (rect.bottom <= 0 || rect.y >= innerHeight) return { visible: false, why: 'outside viewport' }
    const x = Math.round(rect.x + rect.width / 2)
    const y = Math.round(rect.y + rect.height / 2)
    const hit = document.elementFromPoint(x, y)
    return { visible: Boolean(hit && (hit === node || node.contains(hit) || hit.contains(node))), why: hit ? label(hit) : 'nothing at point' }
  }
  return {
    viewport: { width: innerWidth, height: innerHeight },
    layoutAttribute: document.documentElement.dataset.mobileLayout ?? null,
    screen: screen ? { ...box(screen), rows: getComputedStyle(screen).gridTemplateRows, height: getComputedStyle(screen).height } : null,
    children: screen ? [...screen.children].map(child => ({ node: label(child), ...box(child), display: getComputedStyle(child).display })) : [],
    panel: panel ? { ...box(panel), overflow: getComputedStyle(panel).overflow, minHeight: getComputedStyle(panel).minHeight, scrollHeight: panel.scrollHeight, clientHeight: panel.clientHeight } : null,
    selection: selection ? { ...box(selection), reachable: reachable(selection) } : null,
    start: start ? { ...box(start), disabled: start.disabled, text: start.textContent.trim(), reachable: reachable(start) } : null,
    fixturesStart: fixturesStart ? { ...box(fixturesStart), disabled: fixturesStart.disabled, text: fixturesStart.textContent.trim(), reachable: reachable(fixturesStart) } : null,
    standingsToggle: standingsToggle ? { ...box(standingsToggle), display: getComputedStyle(standingsToggle).display, reachable: reachable(standingsToggle) } : null,
    standingsPopover: standingsPopover ? { ...box(standingsPopover), scrollHeight: standingsPopover.scrollHeight, clientHeight: standingsPopover.clientHeight } : null,
    pageScroll: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
  }
}

const require = createRequire(new URL('../promo/package.json', import.meta.url))
const { chromium } = require('playwright')
const browser = await chromium.launch({ headless: true, executablePath: await resolveChromiumExecutable(chromium) })
const findings = []

const sizes = (process.argv.slice(2).length ? process.argv.slice(2) : ['1920x900', '1600x900', '1440x900', '844x390'])
  .map(size => { const [width, height] = size.split('x').map(Number); return { width, height } })
const mode = process.env.COMPETITION_MODE ?? 'league'
const format = process.env.COMPETITION_FORMAT ?? 'single'

try {
  for (const viewport of sizes) {
    const tag = `${viewport.width}x${viewport.height}`
    const phone = viewport.width < 1100
    const context = await browser.newContext({ viewport, ...(phone ? { isMobile: true, hasTouch: true } : {}) })
    await context.addInitScript(seed => {
      localStorage.clear()
      for (const [key, value] of Object.entries(seed)) localStorage.setItem(key, value)
    }, storage)
    await context.route('**/*', async route => {
      const url = new URL(route.request().url())
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.pathname.startsWith('/api/')) { await route.abort('blockedbyclient'); return }
      await route.continue()
    })
    await context.route('**/competition-ui.html', route => route.fulfill({ contentType: 'text/html', body: html }))
    const page = await context.newPage()
    page.setDefaultTimeout(25_000)
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    const click = locator => (phone ? locator.tap() : locator.click())
    try {
      await page.goto(`${origin}/competition-ui.html`)
      await click(page.getByRole('button', { name: /시작하기/ }))
      await click(page.locator('.battle-hub-card.ai'))
      await page.locator('.ai-battle-format-options').waitFor()
      await click(page.locator('.ai-battle-format-options button').filter({ hasText: format === 'single' ? '싱글배틀' : '더블배틀' }))
      await click(page.locator('.battle-mode-option-card').filter({ hasText: mode === 'league' ? '8인 리그전' : '128강 토너먼트' }))
      await click(page.getByRole('button', { name: '이 모드로 시작', exact: true }))
      await page.locator('.competition-screen').waitFor()
      await page.locator('.competition-team-selection').waitFor({ state: 'attached' })
      await page.evaluate(() => document.fonts.ready)
      await page.waitForTimeout(500)

      const result = await page.evaluate(inspect)
      result.tag = tag
      findings.push(result)
      await page.screenshot({ path: path.join(output, `${mode}-${tag}.png`) })
      console.log(`\n=== ${tag} (${mode}/${format}, layout=${result.layoutAttribute}) ===`)
      console.log('  screen rows:', result.screen?.rows, '| height', result.screen?.height)
      for (const child of result.children) console.log(`   child ${child.node} y=${child.y} h=${child.h}`)
      console.log('  match panel:', JSON.stringify(result.panel))
      console.log('  team selection:', JSON.stringify(result.selection))
      console.log('  START button:', JSON.stringify(result.start))
      console.log('  FIXTURES start:', JSON.stringify(result.fixturesStart))
      console.log('  standings toggle:', JSON.stringify(result.standingsToggle))
      if (result.pageScroll.height > result.viewport.height + 1) console.log(`  page scrolls: ${result.pageScroll.height} > ${result.viewport.height}`)

      // The phone opens the league table from the header instead of the
      // workspace, so prove that popover opens and fits the frame.
      const toggle = page.locator('.competition-standings-toggle')
      if (await toggle.isVisible()) {
        await click(toggle)
        await page.locator('.competition-standings-popover').waitFor()
        await page.waitForTimeout(320)
        const popover = await page.evaluate(inspect)
        const fits = popover.standingsPopover.y >= 0 && popover.standingsPopover.bottom <= popover.viewport.height + 1
        console.log('  standings popover:', JSON.stringify(popover.standingsPopover), fits ? 'FITS' : 'OVERFLOWS')
        await page.screenshot({ path: path.join(output, `${mode}-${tag}-standings.png`) })
        const closer = await page.evaluate(() => {
          const button = document.querySelector('.competition-standings-popover > header button')
          if (!button) return null
          const rect = button.getBoundingClientRect()
          const hit = document.elementFromPoint(Math.round(rect.x + rect.width / 2), Math.round(rect.y + rect.height / 2))
          return { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height),
            hit: hit ? hit.tagName.toLowerCase() + '.' + String(hit.className).split(' ')[0] : null }
        })
        console.log('  popover close button:', JSON.stringify(closer))
        const stack = await page.evaluate(() => {
          const layer = document.querySelector('.competition-standings-popover-layer')
          const panel = document.querySelector('.competition-standings-popover')
          const rect = panel.getBoundingClientRect()
          const at = (x, y) => { const el = document.elementFromPoint(x, y); return el ? el.tagName.toLowerCase() + '.' + String(el.className).split(' ')[0] : 'none' }
          return {
            parent: layer.parentElement.tagName.toLowerCase(),
            layerStyle: { position: getComputedStyle(layer).position, zIndex: getComputedStyle(layer).zIndex },
            title: at(Math.round(rect.x + 80), Math.round(rect.y + 30)),
            middle: at(Math.round(rect.x + rect.width / 2), Math.round(rect.y + rect.height / 2)),
            low: at(Math.round(rect.x + rect.width / 2), Math.round(rect.bottom - 20)),
          }
        })
        console.log('  popover stacking:', JSON.stringify(stack))
        await click(page.locator('.competition-standings-popover > header button'))
        await page.locator('.competition-standings-popover').waitFor({ state: 'detached' })
        console.log('  popover closed')
      }

      // Selecting the round's team must enable whichever start control this
      // layout exposes, and pressing it must actually open the battle.
      const party = page.locator('.competition-team-selection > div > button')
      const required = await page.evaluate(() => document.querySelectorAll('.competition-team-selection .ai-selection-lead').length
        || Number(document.querySelector('.competition-team-selection')?.getAttribute('data-required') ?? 0))
      const count = required || 3
      for (let index = 0; index < count; index += 1) await click(party.nth(index))
      const useFixtures = await page.locator('.competition-fixtures-start').isVisible()
      const starter = useFixtures ? page.locator('.competition-fixtures-start') : page.locator('.competition-current-match-panel > footer > button')
      console.log('  starting via:', useFixtures ? '대결 진행하기 (fixtures)' : '배틀 시작 (match panel)', '| enabled:', !(await starter.isDisabled()))
      await click(starter)
      await page.locator('.battle-intro-overlay').waitFor({ timeout: 30_000 })
      console.log('  battle started: yes')
      await page.screenshot({ path: path.join(output, `${mode}-${tag}-battle.png`) })
      if (errors.length) console.log('  page errors:', errors.slice(0, 3))
    } catch (error) {
      console.log(`  !! ${tag} stopped: ${error.message.split('\n')[0]}`)
      await page.screenshot({ path: path.join(output, `${mode}-${tag}-ERROR.png`) }).catch(() => {})
    } finally {
      await context.close()
    }
  }
} finally {
  await browser.close()
  await server.close()
}

await fs.writeFile(path.join(output, `report-${mode}.json`), JSON.stringify(findings, null, 2))
console.log(`\nscreenshots: ${output}`)
