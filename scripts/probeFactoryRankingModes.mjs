import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { resolveChromiumExecutable } from '../promo/scripts/browserRuntime.mjs'

// Drives the real rankings screen with one board per mode so the split can be
// checked without playing two runs.
const root = fileURLToPath(new URL('../', import.meta.url))
const output = path.join(root, 'scripts/.cache/factory-ranking-modes')
await fs.mkdir(output, { recursive: true })
const port = Number(process.env.FACTORY_RANKING_PORT ?? 5292)
const origin = `http://127.0.0.1:${port}`

const entry = `import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import BattleFactoryRankings from '/src/BattleFactoryRankings.jsx'
import { createFactoryRun, selectFactoryRentals, selectFactoryLead, beginFactoryBattle, resolveFactoryBattle } from '/src/data/battleFactory.js'
import { createFactoryRankingSubmission } from '/src/data/battleFactoryRanking.js'
import '/src/mobileViewport.js'
import '/src/styles.css'
import '/src/screenRedesign.css'
import '/src/battleGen5.css'
import '/src/titleCleanup.css'
import '/src/settings.css'
import '/src/mobileLandscape.css'
import '/src/gameTextScale.css'
import '/src/mobileTouch.css'
import '/src/mobileUiV2.css'
import '/src/mobileReferenceLayout.css'

function record(mode, floor, seed, name) {
  let run = createFactoryRun({ seed, id: 'probe-' + mode, mode })
  run = selectFactoryRentals(run, run.offers.slice(0, 3).map(offer => offer.captureId))
  run = beginFactoryBattle(selectFactoryLead(run, run.party[0].captureId))
  run = resolveFactoryBattle(run, { battleId: run.battleId, winner: 'opponent' })
  const report = createFactoryRankingSubmission(run)
  return { ...report, id: mode + '-row', floor, wins: floor - 1, trainerName: name, recordedAt: 1758000000000 }
}

// Deliberately different depths so a mismatched board is obvious on screen.
const boards = {
  standard: { source: 'global', entries: [record('standard', 42, 7, '일**')], ownBest: record('standard', 31, 7, '나') },
  challenge: { source: 'global', entries: [record('challenge', 12, 9, '도**')], ownBest: record('challenge', 8, 9, '나') },
}

function Harness() {
  const [mode, setMode] = useState('standard')
  window.__probe = { mode }
  return React.createElement('div', { className: 'app-shell factory-view' },
    React.createElement(BattleFactoryRankings, { ranking: boards[mode], mode, onSelectMode: setMode, onBack: () => {} }))
}
createRoot(document.getElementById('root')).render(React.createElement(Harness))`

const server = await createServer({
  root, mode: 'factory-ranking-probe', logLevel: 'error',
  plugins: [{
    name: 'factory-ranking-fixture', enforce: 'pre',
    resolveId: source => source === '/factory-ranking-entry.js' ? source : undefined,
    load: id => id === '/factory-ranking-entry.js' ? entry : undefined,
  }],
  server: { host: '127.0.0.1', port, strictPort: true, hmr: false },
})
await server.listen()
const html = await server.transformIndexHtml('/factory-ranking.html',
  '<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body><div id="root"></div><script type="module" src="/factory-ranking-entry.js"></script></body></html>')

const require = createRequire(new URL('../promo/package.json', import.meta.url))
const { chromium } = require('playwright')
const browser = await chromium.launch({ headless: true, executablePath: await resolveChromiumExecutable(chromium) })
const failures = []
const errors = []

try {
  for (const size of (process.argv.slice(2).length ? process.argv.slice(2) : ['1440x900', '390x844'])) {
    const [width, height] = size.split('x').map(Number)
    const phone = width < 900
    const context = await browser.newContext({ viewport: { width, height }, ...(phone ? { isMobile: true, hasTouch: true } : {}) })
    await context.route('**/factory-ranking.html', route => route.fulfill({ contentType: 'text/html', body: html }))
    await context.route(/^https:\/\//, route => route.abort())
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(`${size}: ${error.message}`))
    page.setDefaultTimeout(20_000)
    const tap = locator => (phone ? locator.tap() : locator.click())
    try {
      await page.goto(`${origin}/factory-ranking.html`)
      const tabs = page.locator('.factory-ranking-mode')
      await tabs.first().waitFor()
      const labels = await tabs.allInnerTexts()
      console.log(`\n=== ${size} ===`)
      console.log(`  탭: ${labels.map(text => text.replace(/\n/g, ' ')).join(' | ')}`)
      if (await tabs.count() !== 2) failures.push({ size, note: `expected 2 mode tabs, saw ${await tabs.count()}` })

      const floors = () => page.locator('.factory-ranking-floor strong').allInnerTexts()
      const selected = () => page.locator('.factory-ranking-mode.selected strong').innerText()
      const before = await floors()
      console.log(`  ${await selected()} → ${before.join(' / ')}`)
      if (!before.some(text => text.startsWith('42'))) failures.push({ size, note: `standard board missing 42F: ${before.join(',')}` })
      if (before.some(text => text.startsWith('12'))) failures.push({ size, note: 'challenge record leaked into the standard board' })
      await page.screenshot({ path: path.join(output, `${size}-standard.png`), fullPage: true })

      await tap(tabs.nth(1))
      await page.waitForFunction(() => document.querySelector('.factory-ranking-mode.selected strong')?.textContent === '도전 모드')
      const after = await floors()
      console.log(`  ${await selected()} → ${after.join(' / ')}`)
      if (!after.some(text => text.startsWith('12'))) failures.push({ size, note: `challenge board missing 12F: ${after.join(',')}` })
      if (after.some(text => text.startsWith('42'))) failures.push({ size, note: 'standard record leaked into the challenge board' })
      if (await page.locator('.factory-ranking-mode[aria-selected="true"]').count() !== 1) {
        failures.push({ size, note: 'exactly one tab must report itself selected' })
      }
      await page.screenshot({ path: path.join(output, `${size}-challenge.png`), fullPage: true })

      // The strip must not push the board off-screen or scroll the page sideways.
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)
      if (overflow) failures.push({ size, note: 'the mode strip forces horizontal page scroll' })
      console.log(`  가로 스크롤 없음: ${overflow ? 'NO' : 'yes'}`)
    } catch (error) {
      failures.push({ size, note: String(error.message).split('\n')[0] })
      await page.screenshot({ path: path.join(output, `${size}-ERROR.png`) }).catch(() => {})
    } finally {
      await context.close()
    }
  }
} finally {
  await browser.close()
  await server.close()
}

console.log('\n===== summary =====')
for (const error of errors) console.log('  page error:', error)
for (const failure of failures) console.log('  ', JSON.stringify(failure))
if (failures.length === 0 && errors.length === 0) console.log('the two ranking boards stay separate and switch cleanly')
console.log(`screenshots: ${output}`)
if (failures.length || errors.length) process.exitCode = 1
