import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { getSpeciesProfile, normalizePokemon } from '../src/data/trainingData.js'
import { createSavedTeams } from '../src/data/teamData.js'
import { getPokemonRarity, RARITY_META } from '../src/data/pokemonPool.js'
import { resolveChromiumExecutable } from '../promo/scripts/browserRuntime.mjs'

// Drives the real box screen and checks the grade filter players asked for:
// picking "EX · 전설·환상" must leave exactly the legendaries the account owns.
const root = fileURLToPath(new URL('../', import.meta.url))
const output = path.join(root, 'scripts/.cache/box-rarity')
await fs.mkdir(output, { recursive: true })
const port = Number(process.env.BOX_RARITY_PORT ?? 5294)
const origin = `http://127.0.0.1:${port}`

// A spread across every grade the table defines, so the filter has something to
// separate: two rookies, an elite pair, a champion and two legendaries.
const speciesIds = [1, 25, 6, 94, 149, 150, 151]
const owned = speciesIds.map(speciesId => normalizePokemon({ speciesId, captureId: `dex-${speciesId}`, directDrawCount: 1 }))
const expected = new Map()
for (const entry of owned) {
  const rarity = getPokemonRarity(getSpeciesProfile(entry.speciesId))
  if (!expected.has(rarity)) expected.set(rarity, [])
  expected.get(rarity).push(entry.name)
}
console.log('fixture roster by grade:')
for (const [rarity, names] of expected) console.log(`  ${RARITY_META[rarity].label}: ${names.join(', ')}`)

const ids = owned.map(pokemon => pokemon.captureId)
const teams = createSavedTeams(ids, ids)
const styles = ['styles', 'screenRedesign', 'battleGen5', 'titleCleanup', 'battleGimmicks', 'moveAnimationDirector',
  'settings', 'auth', 'mobileLandscape', 'gameTextScale', 'scaledBoxCards', 'scaledBattleCards', 'scaledTrainingEditor',
  'mobileTouch', 'mobileUiV2', 'mobileReferenceLayout', 'installApp']
const entry = `import React from 'react';import{createRoot}from'react-dom/client';import{GameApp}from'/src/App.jsx';import '/src/mobileViewport.js';
${styles.map(name => `import '/src/${name}.css';`).join('\n')}
createRoot(document.getElementById('root')).render(React.createElement(GameApp,{
user:{uid:'box-rarity-offline',displayName:'등급 검증',isLocalGuest:true},onPlayerDataChanged:()=>{}
}));`
const storage = {
  'champions-dex-v2': JSON.stringify(owned),
  'champions-teams-v1': JSON.stringify({ version: 1, activeTeamId: 'team-1', teams }),
  'champions-team-v2': JSON.stringify(ids.slice(0, 3)),
  'champions-vp-v1': '7777',
  'champions-draw-tutorial-v1': 'complete',
  'champions-settings-v1': JSON.stringify({ audio: { enabled: false }, game: { attackAnimation: 'skip', hpBarSpeed: 'instant', playerGender: 'male' } }),
}

const server = await createServer({
  root,
  mode: 'box-rarity-probe',
  logLevel: 'error',
  plugins: [{
    name: 'box-rarity-fixture',
    enforce: 'pre',
    resolveId(source) {
      if (source === '/box-rarity-entry.js') return source
      if (/firebaseClient(?:\.js)?$/.test(source)) return '\0box-rarity-offline-auth'
      return undefined
    },
    load(id) {
      if (id === '/box-rarity-entry.js') return entry
      if (id === '\0box-rarity-offline-auth') return 'export const firebaseAuth=null;export const firebaseDb=null;export const isFirebaseConfigured=false;export const missingFirebaseEnvironmentVariables=[];'
      return undefined
    },
  }],
  server: { host: '127.0.0.1', port, strictPort: true, hmr: false },
})
await server.listen()
const html = await server.transformIndexHtml('/box-rarity.html', '<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body><div id="root"></div><script type="module" src="/box-rarity-entry.js"></script></body></html>')

// Runs in the page: what the grade picker offers and which cards survive it.
const readBox = () => {
  const select = document.querySelector('.team-box-rarity-filter select')
  const cards = [...document.querySelectorAll('.team-box-card .team-box-card-select')]
  const box = node => {
    const rect = node.getBoundingClientRect()
    return { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height), bottom: Math.round(rect.bottom) }
  }
  return {
    viewport: { width: innerWidth, height: innerHeight },
    layout: document.documentElement.dataset.mobileLayout ?? null,
    select: select ? {
      ...box(select.closest('label') ?? select),
      inFrame: (select.closest('label') ?? select).getBoundingClientRect().right <= innerWidth + 1,
      value: select.value,
      options: [...select.options].map(option => `${option.value}=${option.textContent.trim()}`),
    } : null,
    count: Number(document.querySelector('.team-box-grid')?.getAttribute('aria-label')?.match(/(\d+)/)?.[1] ?? cards.length),
    names: cards.map(card => (card.getAttribute('aria-label') ?? '').replace(/^이로치 /, '').split(',')[0].trim()),
  }
}

const require = createRequire(new URL('../promo/package.json', import.meta.url))
const { chromium } = require('playwright')
const browser = await chromium.launch({ headless: true, executablePath: await resolveChromiumExecutable(chromium) })
const sizes = (process.argv.slice(2).length ? process.argv.slice(2) : ['1440x900', '390x844', '844x390'])
  .map(size => { const [width, height] = size.split('x').map(Number); return { width, height } })
const failures = []

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
    await context.route('**/box-rarity.html', route => route.fulfill({ contentType: 'text/html', body: html }))
    const page = await context.newPage()
    page.setDefaultTimeout(25_000)
    const click = locator => (phone ? locator.tap() : locator.click())
    try {
      await page.goto(`${origin}/box-rarity.html`)
      // The app boots into the lobby: phones use the bottom tab bar, wider
      // frames use the lobby's mode cards.
      await page.locator('.lobby-layout, .mobile-tabbar').first().waitFor()
      const tab = page.locator('.mobile-tabbar-item').filter({ hasText: '박스' }).first()
      if (await tab.count() && await tab.isVisible()) await click(tab)
      else await click(page.locator('.mode-card.mode-collection').first())
      await page.locator('.team-box-grid').waitFor()
      await page.evaluate(() => document.fonts.ready)
      await page.waitForTimeout(500)

      const all = await page.evaluate(readBox)
      console.log(`\n=== ${tag} (layout=${all.layout}) ===`)
      console.log('  grade picker:', JSON.stringify(all.select))
      console.log(`  전체 등급: ${all.count}마리 · ${all.names.join(', ')}`)
      if (!all.select) { failures.push({ tag, note: 'grade filter missing' }); await context.close(); continue }
      if (!all.select.inFrame) failures.push({ tag, note: 'grade filter runs past the frame' })
      await page.screenshot({ path: path.join(output, `${tag}-all.png`) })

      for (const [rarity, names] of expected) {
        await page.selectOption('.team-box-rarity-filter select', rarity)
        await page.waitForTimeout(260)
        const filtered = await page.evaluate(readBox)
        const shown = [...filtered.names].sort()
        const want = [...names].sort()
        const ok = filtered.count === names.length && shown.join('|') === want.join('|')
        console.log(`  ${RARITY_META[rarity].label}: ${filtered.count}마리 · ${filtered.names.join(', ')} ${ok ? 'OK' : `MISMATCH (expected ${want.join(', ')})`}`)
        if (!ok) failures.push({ tag, rarity, shown, want })
        if (rarity === 'legend') await page.screenshot({ path: path.join(output, `${tag}-legend.png`) })
      }

      // Back to every grade: the filter must not strand the roster.
      await page.selectOption('.team-box-rarity-filter select', 'all')
      await page.waitForTimeout(260)
      const restored = await page.evaluate(readBox)
      if (restored.count !== owned.length) failures.push({ tag, note: `reset showed ${restored.count} of ${owned.length}` })
      console.log(`  reset to 전체 등급: ${restored.count}마리`)
    } catch (error) {
      failures.push({ tag, note: String(error.message).split('\n')[0] })
      console.log(`  !! stopped at ${tag}: ${String(error.message).split('\n')[0]}`)
      await page.screenshot({ path: path.join(output, `${tag}-ERROR.png`) }).catch(() => {})
    } finally {
      await context.close()
    }
  }
} finally {
  await browser.close()
  await server.close()
}

console.log('\n===== summary =====')
if (!failures.length) console.log('grade filter returns exactly the owned Pokemon of each grade at every size')
for (const failure of failures) console.log(' ', JSON.stringify(failure))
console.log(`screenshots: ${output}`)
if (failures.length) process.exitCode = 1
