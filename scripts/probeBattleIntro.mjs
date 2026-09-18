import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { normalizePokemon } from '../src/data/trainingData.js'
import { createSavedTeams } from '../src/data/teamData.js'
import { resolveChromiumExecutable } from '../promo/scripts/browserRuntime.mjs'

// Walks the real AI battle entry the way a player does - pick three Pokemon,
// press start - and reports whether the intro overlay's start button is on
// screen and pressable. Players reported it sitting below the frame on phones.
const root = fileURLToPath(new URL('../', import.meta.url))
const output = path.join(root, 'scripts/.cache/battle-intro')
await fs.mkdir(output, { recursive: true })
const port = Number(process.env.BATTLE_INTRO_PORT ?? 5293)
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
user:{uid:'battle-intro-offline',displayName:'인트로 검증',isLocalGuest:true},onPlayerDataChanged:()=>{}
}));`
const storage = {
  'champions-dex-v2': JSON.stringify(owned),
  'champions-teams-v1': JSON.stringify({ version: 1, activeTeamId: 'team-1', teams }),
  'champions-team-v2': JSON.stringify(ids),
  'champions-vp-v1': '7777',
  'champions-draw-tutorial-v1': 'complete',
  // A player on a larger text scale gets a taller intro, which is one way the
  // start button can fall out of the frame.
  'champions-settings-v1': JSON.stringify({ audio: { enabled: false }, game: { attackAnimation: 'skip', hpBarSpeed: 'instant', playerGender: 'male', textScale: Number(process.env.TEXT_SCALE ?? 1) } }),
}

const server = await createServer({
  root,
  mode: 'battle-intro-probe',
  logLevel: 'error',
  plugins: [{
    name: 'battle-intro-fixture',
    enforce: 'pre',
    resolveId(source) {
      if (source === '/battle-intro-entry.js') return source
      if (/firebaseClient(?:\.js)?$/.test(source)) return '\0battle-intro-offline-auth'
      return undefined
    },
    load(id) {
      if (id === '/battle-intro-entry.js') return entry
      if (id === '\0battle-intro-offline-auth') return 'export const firebaseAuth=null;export const firebaseDb=null;export const isFirebaseConfigured=false;export const missingFirebaseEnvironmentVariables=[];'
      return undefined
    },
  }],
  server: { host: '127.0.0.1', port, strictPort: true, hmr: false },
})
await server.listen()
const html = await server.transformIndexHtml('/battle-intro.html', '<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body><div id="root"></div><script type="module" src="/battle-intro-entry.js"></script></body></html>')

// Runs in the page. The button is only usable when it is inside the frame AND
// the point a finger lands on actually belongs to it.
const inspect = () => {
  const overlay = document.querySelector('.battle-intro-overlay')
  if (!overlay) return { overlay: null, viewport: { width: innerWidth, height: innerHeight } }
  const style = getComputedStyle(overlay)
  const box = overlay.getBoundingClientRect()
  const button = overlay.querySelector(':scope > button')
  const label = node => node.tagName.toLowerCase() + (String(node.className) ? '.' + String(node.className).trim().split(/\s+/).slice(0, 2).join('.') : '')
  const rect = node => {
    const bounds = node.getBoundingClientRect()
    return { x: Math.round(bounds.x), y: Math.round(bounds.y), w: Math.round(bounds.width), h: Math.round(bounds.height), bottom: Math.round(bounds.bottom) }
  }
  let hit = null
  if (button) {
    const bounds = button.getBoundingClientRect()
    const x = Math.round(bounds.x + bounds.width / 2)
    const y = Math.round(bounds.y + bounds.height / 2)
    if (x >= 0 && x <= innerWidth && y >= 0 && y <= innerHeight) {
      const element = document.elementFromPoint(x, y)
      hit = element ? label(element) : 'none'
    } else hit = 'offscreen'
  }
  const toast = document.querySelector('.toast.visible')
  const shell = document.querySelector('.app-shell')
  const screen = document.querySelector('.battle-game-screen')
  return {
    viewport: { width: innerWidth, height: innerHeight },
    layout: document.documentElement.dataset.mobileLayout ?? null,
    // The overlay is absolute inside the battle screen, so a screen taller than
    // the frame carries the button below the fold with it.
    shell: shell ? { ...rect(shell), overflow: getComputedStyle(shell).overflow } : null,
    screen: screen ? { ...rect(screen), minHeight: getComputedStyle(screen).minHeight, height: getComputedStyle(screen).height,
      rows: getComputedStyle(screen).gridTemplateRows } : null,
    overlay: {
      ...rect(overlay),
      rows: style.gridTemplateRows,
      columns: style.gridTemplateColumns,
      padding: style.padding,
      overflow: style.overflow,
      client: overlay.clientHeight,
      scroll: overlay.scrollHeight,
    },
    children: [...overlay.children]
      .filter(child => getComputedStyle(child).position !== 'absolute')
      .map(child => ({ node: label(child), ...rect(child), row: getComputedStyle(child).gridRow })),
    // The app toast is fixed to the bottom centre, exactly where the start
    // button sits, and covering it reads as a missing button.
    toast: toast && button ? (() => {
      const t = toast.getBoundingClientRect()
      const b = button.getBoundingClientRect()
      const overlap = Math.min(t.bottom, b.bottom) - Math.max(t.top, b.top)
      return { ...rect(toast), coversButton: overlap > 0 ? Math.round(overlap) : 0 }
    })() : null,
    button: button ? {
      ...rect(button),
      top: style.getPropertyValue('top') && getComputedStyle(button).top,
      inFrame: button.getBoundingClientRect().y >= -1 && button.getBoundingClientRect().bottom <= innerHeight + 1,
      belowOverlay: Math.round(button.getBoundingClientRect().bottom - box.bottom),
      clipped: overlay.scrollHeight > overlay.clientHeight + 2,
      disabled: button.disabled,
      hit,
      text: button.textContent.trim().slice(0, 24),
    } : null,
  }
}

const require = createRequire(new URL('../promo/package.json', import.meta.url))
const { chromium } = require('playwright')
const browser = await chromium.launch({ headless: true, executablePath: await resolveChromiumExecutable(chromium) })
const sizes = (process.argv.slice(2).length ? process.argv.slice(2) : ['390x844', '360x640', '412x915', '344x882', '844x390', '932x430', '1440x900'])
  .map(size => { const [width, height] = size.split('x').map(Number); return { width, height } })
const failures = []
const flow = process.env.FLOW ?? 'ai'

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
      const allowed = ['127.0.0.1', 'localhost', '[::1]', 'play.pokemonshowdown.com', 'raw.githubusercontent.com']
      if (!allowed.includes(url.hostname) || url.pathname.startsWith('/api/')) { await route.abort('blockedbyclient'); return }
      await route.continue()
    })
    await context.route('**/battle-intro.html', route => route.fulfill({ contentType: 'text/html', body: html }))
    const page = await context.newPage()
    page.setDefaultTimeout(25_000)
    const click = locator => (phone ? locator.tap() : locator.click())
    try {
      await page.goto(`${origin}/battle-intro.html`)
      await click(page.getByRole('button', { name: /시작하기/ }))
      if (flow === 'factory') {
        // Players reported the same missing start button in the battle factory,
        // which reaches the very same intro through its own lobby.
        await click(page.locator('.battle-hub-card.factory'))
        await page.locator('.battle-factory').waitFor()
        await page.waitForTimeout(600)
        if (process.env.STOP === 'lobby') {
          const lobby = await page.evaluate(() => {
            const root = document.querySelector('.battle-factory')
            const box = node => { const r = node.getBoundingClientRect(); return `${Math.round(r.y)}..${Math.round(r.bottom)} h=${Math.round(r.height)}` }
            const name = node => node.tagName.toLowerCase() + (String(node.className) ? '.' + String(node.className).trim().split(/\s+/)[0] : '')
            const shell = document.querySelector('.app-shell')
            return {
              viewport: innerHeight,
              shell: `${box(shell)} overflow=${getComputedStyle(shell).overflow}`,
              root: `${box(root)} client=${root.clientHeight} scroll=${root.scrollHeight} overflow=${getComputedStyle(root).overflowY}`,
              rows: getComputedStyle(root).gridTemplateRows,
              children: [...root.children].map(child => `${name(child)} ${box(child)} scroll=${child.scrollHeight} overflowY=${getComputedStyle(child).overflowY}`),
              belowFold: [...root.querySelectorAll('button, .factory-rental-select')]
                .filter(node => node.getBoundingClientRect().top > innerHeight)
                .map(node => `${name(node)} ${box(node)}`).slice(0, 6),
            }
          })
          console.log(`
--- factory lobby ${tag} ---`)
          console.log(JSON.stringify(lobby, null, 2))
          await page.screenshot({ path: path.join(output, `factory-lobby-${tag}.png`) })
          await context.close()
          continue
        }
        await page.locator('.factory-rental-select').first().waitFor()
        const rentals = page.locator('.factory-rental-select')
        for (let index = 0; index < 3; index += 1) await click(rentals.nth(index))
        await click(page.locator('.factory-primary').first())
        // The floor will not start until a lead is picked from the rental team.
        await page.locator('.factory-rental-select').first().waitFor()
        await click(page.locator('.factory-rental-select').first())
        const startFloor = page.locator('.factory-primary').first()
        await page.waitForFunction(() => {
          const button = document.querySelector('.factory-primary')
          return button && !button.disabled
        }, undefined, { timeout: 20_000 })
        await click(startFloor)
      } else {
        await click(page.locator('.battle-hub-card.ai'))
        await page.locator('.ai-battle-format-options').waitFor()
        await click(page.locator('.ai-battle-format-options button').filter({ hasText: '싱글배틀' }))
        await click(page.locator('.battle-mode-option-card').filter({ hasText: '8인 리그전' }))
        await click(page.getByRole('button', { name: '이 모드로 시작', exact: true }))
        await page.locator('.competition-screen').waitFor()
        await page.locator('.competition-team-selection').waitFor({ state: 'attached' })
        const party = page.locator('.competition-team-selection > div > button')
        for (let index = 0; index < 3; index += 1) await click(party.nth(index))
        const useFixtures = await page.locator('.competition-fixtures-start').isVisible()
        await click(useFixtures ? page.locator('.competition-fixtures-start') : page.locator('.competition-current-match-panel > footer > button'))
      }

      await page.locator('.battle-intro-overlay').waitFor({ timeout: 30_000 })
      await page.evaluate(() => document.fonts.ready)
      await page.waitForTimeout(700)
      const loading = await page.evaluate(inspect)
      await page.screenshot({ path: path.join(output, `${flow}-${tag}-loading.png`) })

      // The ready state is the one the player has to press.
      await page.locator('.battle-intro-overlay.is-ready').waitFor({ timeout: 40_000 }).catch(() => {})
      await page.waitForTimeout(400)
      const ready = await page.evaluate(inspect)
      await page.screenshot({ path: path.join(output, `${flow}-${tag}-ready.png`) })

      console.log(`\n=== ${tag} (layout=${ready.layout}) ===`)
      console.log('  shell:', JSON.stringify(ready.shell))
      console.log('  screen:', JSON.stringify(ready.screen))
      console.log('  overlay:', JSON.stringify(ready.overlay))
      for (const child of ready.children) console.log(`   child ${child.node} y=${child.y} h=${child.h} bottom=${child.bottom} row=${child.row}`)
      console.log('  loading button:', JSON.stringify(loading.button))
      console.log('  READY  button:', JSON.stringify(ready.button))
      console.log('  toast:', JSON.stringify(ready.toast))

      const broken = !ready.button || !ready.button.inFrame || ready.button.hit === 'offscreen' || (ready.toast?.coversButton ?? 0) > 0
        || (ready.button.hit && !ready.button.hit.startsWith('button') && !ready.button.hit.startsWith('svg'))
      if (broken) {
        failures.push({ tag, button: ready.button })
        console.log('  >> START BUTTON UNREACHABLE')
      } else {
        // Prove it actually starts the battle from this frame.
        await click(page.getByRole('button', { name: /배틀 개시/ }).first())
        const started = await page.locator('.battle-intro-overlay').waitFor({ state: 'detached', timeout: 15_000 }).then(() => true, () => false)
        console.log(`  pressed 배틀 개시 -> battle started: ${started}`)
        if (!started) failures.push({ tag, button: ready.button, note: 'press did not start the battle' })
      }
    } catch (error) {
      failures.push({ tag, note: String(error.message).split('\n')[0] })
      console.log(`  !! flow stopped at ${tag}: ${String(error.message).split('\n')[0]}`)
      await page.screenshot({ path: path.join(output, `${flow}-${tag}-ERROR.png`) }).catch(() => {})
    } finally {
      await context.close()
    }
  }
} finally {
  await browser.close()
  await server.close()
}

console.log('\n===== summary =====')
if (!failures.length) console.log('start button reachable at every size')
for (const failure of failures) console.log(' ', failure.tag, JSON.stringify(failure.button ?? failure.note))
console.log(`screenshots: ${output}`)
