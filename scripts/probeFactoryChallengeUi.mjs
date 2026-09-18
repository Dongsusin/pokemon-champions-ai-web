import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { resolveChromiumExecutable } from '../promo/scripts/browserRuntime.mjs'

// Drives the real lobby with a seeded challenge run so the standby screen — the
// one that only appears after a won floor — can be checked without playing one.
const root = fileURLToPath(new URL('../', import.meta.url))
const output = path.join(root, 'scripts/.cache/factory-challenge')
await fs.mkdir(output, { recursive: true })
const port = Number(process.env.FACTORY_CHALLENGE_PORT ?? 5291)
const origin = `http://127.0.0.1:${port}`

const entry = `import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import BattleFactoryLobby from '/src/BattleFactoryLobby.jsx'
import {
  advanceFactoryFloor, beginFactoryBattle, createFactoryRun, healFactoryPokemon,
  rerollFactoryHeldItem, resolveFactoryBattle, selectFactoryLead, selectFactoryRentals,
} from '/src/data/battleFactory.js'
import '/src/mobileViewport.js'
import '/src/styles.css'
import '/src/screenRedesign.css'
import '/src/battleGen5.css'
import '/src/titleCleanup.css'
import '/src/battleGimmicks.css'
import '/src/moveAnimationDirector.css'
import '/src/settings.css'
import '/src/auth.css'
import '/src/mobileLandscape.css'
import '/src/gameTextScale.css'
import '/src/scaledBoxCards.css'
import '/src/scaledBattleCards.css'
import '/src/scaledTrainingEditor.css'
import '/src/mobileTouch.css'
import '/src/mobileUiV2.css'
import '/src/mobileReferenceLayout.css'
import '/src/installApp.css'

// One won floor, ending with a hurt lead, a fainted ally and an untouched third.
function seededRun() {
  let run = createFactoryRun({ seed: 42, id: 'probe-challenge', mode: 'challenge' })
  run = selectFactoryRentals(run, run.offers.slice(0, 3).map(entry => entry.captureId))
  run = selectFactoryLead(run, run.party[0].captureId)
  run = beginFactoryBattle(run)
  run = resolveFactoryBattle(run, {
    battleId: run.battleId, winner: 'player',
    playerTeamHp: run.party.map((pokemon, index) => ({
      captureId: pokemon.captureId, hp: [31, 0, 100][index], maxHp: 100,
    })),
  })
  return { ...run, towerPoints: 120 }
}

function Harness() {
  const [run, setRun] = useState(seededRun)
  const [error, setError] = useState('')
  const act = update => {
    try { setRun(update(run)); setError('') }
    catch (cause) { setError(cause.message) }
  }
  window.__probe = { run, setRun }
  // The lobby sizes itself against the app shell, so the harness reproduces it.
  return React.createElement('div', { className: 'app-shell factory-view' }, React.createElement(BattleFactoryLobby, {
    run, error,
    onChooseRentals: () => {}, onChooseLead: id => act(current => selectFactoryLead(current, id)),
    onStartBattle: () => {},
    onAdvanceFloor: exchange => act(current => advanceFactoryFloor(current, exchange)),
    onHeal: id => act(current => healFactoryPokemon(current, id)),
    onRerollItem: id => act(current => rerollFactoryHeldItem(current, id)),
    onRestart: () => {}, onBack: () => {},
  }))
}
createRoot(document.getElementById('root')).render(React.createElement(Harness))`

const server = await createServer({
  root, mode: 'factory-challenge-probe', logLevel: 'error',
  plugins: [{
    name: 'factory-challenge-fixture', enforce: 'pre',
    resolveId: source => source === '/factory-challenge-entry.js' ? source : undefined,
    load: id => id === '/factory-challenge-entry.js' ? entry : undefined,
  }],
  server: { host: '127.0.0.1', port, strictPort: true, hmr: false },
})
await server.listen()
const html = await server.transformIndexHtml('/factory-challenge.html',
  '<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body><div id="root"></div><script type="module" src="/factory-challenge-entry.js"></script></body></html>')

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
    await context.route('**/factory-challenge.html', route => route.fulfill({ contentType: 'text/html', body: html }))
    await context.route(/^https:\/\//, route => route.abort())
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(`${size}: ${error.message}`))
    page.setDefaultTimeout(20_000)
    const tap = locator => (phone ? locator.tap() : locator.click())
    try {
      await page.goto(`${origin}/factory-challenge.html`)
      await page.locator('.factory-tp-panel').waitFor()

      const balance = await page.locator('.factory-tp-balance strong').innerText()
      const meters = await page.locator('.factory-tp-panel .factory-card-health b').allInnerTexts()
      console.log(`\n=== ${size} ===`)
      console.log(`  TP ${balance} · 팀 상태 ${meters.join(' / ')}`)
      if (balance !== '120') failures.push({ size, note: `TP balance showed ${balance}` })
      if (!meters.includes('기절')) failures.push({ size, note: 'A fainted ally must be labelled' })
      if (!meters.some(text => text === '31%')) failures.push({ size, note: `carried HP missing: ${meters.join(',')}` })

      const swapCosts = await page.locator('.factory-card-cost').allInnerTexts()
      console.log(`  교체 비용 배지: ${swapCosts.join(' / ')}`)
      if (swapCosts.length !== 3) failures.push({ size, note: `expected 3 swap prices, saw ${swapCosts.length}` })
      await page.screenshot({ path: path.join(output, `${size}-exchange.png`), fullPage: true })

      // Healing the fainted ally must spend exactly its listed price.
      const healButtons = page.locator('.factory-tp-buttons button', { hasText: '회복' })
      const faintedRow = page.locator('.factory-tp-panel li').filter({ hasText: '기절' })
      const healLabel = await faintedRow.locator('button', { hasText: '회복' }).innerText()
      const price = Number(healLabel.match(/(\d+)/)?.[1] ?? 0)
      await tap(faintedRow.locator('button', { hasText: '회복' }))
      await page.waitForFunction(value => document.querySelector('.factory-tp-balance strong')?.textContent === value, String(120 - price))
      const afterHeal = await page.locator('.factory-tp-panel .factory-card-health b').allInnerTexts()
      console.log(`  회복 ${price} TP 사용 → 잔액 ${await page.locator('.factory-tp-balance strong').innerText()} · ${afterHeal.join(' / ')}`)
      if (afterHeal.includes('기절')) failures.push({ size, note: 'Healing left the ally fainted' })

      // An item reroll changes the item and charges the flat price.
      const itemBefore = await page.locator('.factory-team-grid .factory-card-item').first().innerText()
      const balanceBefore = Number(await page.locator('.factory-tp-balance strong').innerText())
      await tap(page.locator('.factory-tp-buttons button', { hasText: '도구 변경' }).first())
      await page.waitForFunction(value => document.querySelector('.factory-tp-balance strong')?.textContent !== value, String(balanceBefore))
      const itemAfter = await page.locator('.factory-team-grid .factory-card-item').first().innerText()
      const balanceAfter = Number(await page.locator('.factory-tp-balance strong').innerText())
      console.log(`  도구 변경: ${itemBefore.trim()} → ${itemAfter.trim()} · 잔액 ${balanceAfter}`)
      if (balanceBefore - balanceAfter !== 25) failures.push({ size, note: `reroll charged ${balanceBefore - balanceAfter}` })

      // Everything the panel offers must sit inside the frame.
      const clipped = await page.locator('.factory-tp-panel').evaluate(element => {
        const bounds = element.getBoundingClientRect()
        return bounds.left < -1 || bounds.right > innerWidth + 1
      })
      if (clipped) failures.push({ size, note: 'The Tower Point panel runs past the frame' })
      await page.screenshot({ path: path.join(output, `${size}-after-spending.png`), fullPage: true })
      console.log(`  패널 프레임 안: ${clipped ? 'NO' : 'yes'}`)
    } catch (error) {
      failures.push({ size, note: String(error.message).split('\n')[0] })
      // What actually sits under the button tells us whether it is off-screen or covered.
      const diagnosis = await page.evaluate(() => {
        const button = [...document.querySelectorAll('.factory-tp-buttons button')].find(entry => entry.textContent.includes('회복'))
        if (!button) return { button: null }
        const rect = button.getBoundingClientRect()
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
        const scroller = document.querySelector('.factory-panel-scroll')
        return {
          viewport: { width: innerWidth, height: innerHeight },
          button: { x: Math.round(rect.x), y: Math.round(rect.y), bottom: Math.round(rect.bottom) },
          scroller: scroller ? { h: Math.round(scroller.getBoundingClientRect().height), overflowY: getComputedStyle(scroller).overflowY } : null,
          covering: hit ? (hit.tagName.toLowerCase() + '.' + hit.className).slice(0, 80) : null,
        }
      }).catch(() => null)
      if (diagnosis) console.log('  진단:', JSON.stringify(diagnosis))
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
if (failures.length === 0 && errors.length === 0) console.log('challenge standby screen shows carried HP, prices and spends TP correctly')
console.log(`screenshots: ${output}`)
if (failures.length || errors.length) process.exitCode = 1
