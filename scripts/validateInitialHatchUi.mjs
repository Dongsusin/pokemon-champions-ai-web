import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { getDrawBanner } from '../src/data/pokemonPool.js'
import { resolveChromiumExecutable } from '../promo/scripts/browserRuntime.mjs'

const require = createRequire(new URL('../promo/package.json', import.meta.url))
const { chromium } = require(process.env.ACHIEVEMENT_PLAYWRIGHT_MODULE || 'playwright')
const root = fileURLToPath(new URL('../', import.meta.url))
const output = path.join(root, 'scripts/.cache/initial-hatch-ui')
await fs.mkdir(output, { recursive: true })
const styles = ['styles', 'screenRedesign', 'battleGen5', 'titleCleanup', 'battleGimmicks', 'moveAnimationDirector', 'settings', 'auth', 'mobileLandscape']
const entry = `
import '/src/mobileViewport.js';
import React from 'react';
import {createRoot} from 'react-dom/client';
import {GameApp} from '/src/App.jsx';
${styles.map(name => `import '/src/${name}.css';`).join('\n')}
createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,
 React.createElement(GameApp,{user:{uid:'initial-hatch-qa',displayName:'부화 검증',isLocalGuest:true},onPlayerDataChanged:()=>{}})));
`
const server = await createServer({ root,
  plugins: [{ name: 'initial-hatch-qa-entry',
    resolveId: id => id === '/initial-hatch-entry.js' ? id : undefined,
    load: id => id === '/initial-hatch-entry.js' ? entry : undefined,
  }], server: { host: '127.0.0.1', port: 5193, strictPort: true, hmr: false }, logLevel: 'error',
})
await server.listen()
const origin = 'http://127.0.0.1:5193'
const html = await server.transformIndexHtml('/initial-hatch.html', '<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body><div id="root"></div><script type="module" src="/initial-hatch-entry.js"></script></body></html>')
const initialBalance = 10000
let browser
let activePage
const errors = []
async function inventorySnapshot(page) {
  return page.evaluate(() => ({
    balance: window.__hatchQA.vp,
    collection: window.__hatchQA.boxPokemon.map(({ captureId, speciesId, directDrawCount, shinyDrawCount, shinyObtained }) => ({
      captureId, speciesId, directDrawCount, shinyDrawCount, shinyObtained,
    })),
  }))
}
async function runCase(name, tutorial, individualFirst, mobile = false) {
  const context = await browser.newContext({ viewport: mobile ? { width: 844, height: 390 } : { width: 1440, height: 900 },
    ...(mobile ? { isMobile: true, hasTouch: true } : {}),
  })
  await context.route('**/initial-hatch.html', route => route.fulfill({ contentType: 'text/html', body: html }))
  await context.route('**/src/App.jsx', async route => {
    const response = await route.fetch()
    let source = await response.text()
    assert(source.includes('const trainerInitial =') && source.includes('const completeDrawTutorial = (pokemon) => {'))
    source = source.replace('const trainerInitial =', `window.__hatchQA={screen,vp,drawResults,drawTutorialStep,boxPokemon,open:()=>selectMode({id:'hatch'})}; const trainerInitial =`)
      .replace('const completeDrawTutorial = (pokemon) => {', 'const completeDrawTutorial = (pokemon) => { window.__tutorialCompleteCalls=(window.__tutorialCompleteCalls||0)+1;')
    await route.fulfill({ response, body: source })
  })
  await context.addInitScript(({ tutorial, initialBalance }) => {
    if (sessionStorage.getItem('initial-hatch-seeded')) return
    localStorage.clear()
    localStorage.setItem('champions-vp-v1', String(initialBalance))
    localStorage.setItem('champions-settings-v1', JSON.stringify({ audio: { enabled: false } }))
    if (!tutorial) localStorage.setItem('champions-draw-tutorial-v1', 'complete')
    sessionStorage.setItem('initial-hatch-seeded', 'yes')
  }, { tutorial, initialBalance })
  const page = await context.newPage()
  activePage = page
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`${origin}/initial-hatch.html`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => Boolean(window.__hatchQA))
  if (tutorial) {
    assert.equal(await page.evaluate(() => window.__hatchQA.screen), 'hatch')
    assert.equal(await page.evaluate(() => window.__hatchQA.drawTutorialStep), 'draw')
  } else await page.evaluate(() => window.__hatchQA.open())
  await page.getByText('10회 중 미보유 최소 3종 확정', { exact: true }).waitFor()
  assert(await page.getByText('남은 미보유가 3종 미만이면 남은 포켓몬 모두 보장', { exact: true }).isVisible())
  assert(await page.getByLabel('등급별 기본 등장 확률', { exact: true }).isVisible())
  if (!tutorial) {
    for (const bannerId of ['pickup', 'shiny']) {
      await page.getByRole('button', { name: getDrawBanner(bannerId).title, exact: true }).click()
      assert.equal(await page.locator('.draw-standard-guarantee').count(), 0, 'Other draw types must not advertise the standard-only guarantee')
      assert.equal(await page.locator('.draw-standard-guarantee-note').count(), 0)
      assert((await page.locator('.draw-banner-price').innerText()).includes(getDrawBanner(bannerId).price.toLocaleString()))
    }
    await page.getByRole('button', { name: getDrawBanner('standard').title, exact: true }).click()
  }
  await page.locator('.draw-banner-card').evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)))
  const guaranteeBounds = await page.locator('.draw-standard-guarantee, .draw-standard-guarantee-note').evaluateAll(elements => elements.map(element => {
    const rect = element.getBoundingClientRect()
    const card = element.closest('.draw-banner-card').getBoundingClientRect()
    return rect.left >= card.left && rect.right <= card.right + 1 && rect.top >= card.top && rect.bottom <= card.bottom + 1
  }))
  assert(guaranteeBounds.every(Boolean), 'Standard guarantee and its exception must fit inside the banner')
  await page.screenshot({ path: path.join(output, `${name}-banner.png`) })
  await page.getByRole('button', { name: '10회 뽑기', exact: true }).click()
  await page.waitForFunction(() => window.__hatchQA.drawResults.length === 10)
  const afterDraw = await inventorySnapshot(page)
  assert(await page.evaluate(() => new Set(window.__hatchQA.drawResults.filter(result => !result.isDuplicate).map(result => result.id)).size >= 3), 'The actual standard draw must grant at least three distinct new species')
  const refund = await page.evaluate(() => window.__hatchQA.drawResults.reduce((sum, result) => sum + (result.duplicateRefundVp || 0), 0))
  assert.equal(afterDraw.balance, initialBalance - getDrawBanner('standard').price + refund)
  assert.equal(afterDraw.collection.reduce((sum, pokemon) => sum + pokemon.directDrawCount, 0), 10, 'The draw must grant exactly ten results before reveal')
  assert.equal(await page.locator('.draw-slot.revealed').count(), 0)
  if (tutorial) assert.equal(await page.evaluate(() => window.__hatchQA.drawTutorialStep), 'hatch')
  const bulk = page.getByRole('button', { name: '전체 부화', exact: true })
  assert(await bulk.isVisible() && await bulk.isEnabled(), 'Bulk hatch must be available even for the first-login tutorial')
  const rect = await bulk.evaluate(element => {
    const box = element.getBoundingClientRect()
    return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: innerWidth, height: innerHeight }
  })
  assert(rect.left >= 0 && rect.right <= rect.width + 1 && rect.top >= 0 && rect.bottom <= rect.height + 1, 'Bulk hatch must remain on screen')
  await page.screenshot({ path: path.join(output, `${name}-before.png`) })
  if (individualFirst) {
    await page.locator('.draw-egg-reveal').click()
    await page.waitForFunction(() => document.querySelectorAll('.draw-slot.revealed').length === 1)
    assert.equal(await page.evaluate(() => window.__tutorialCompleteCalls), 1)
    assert.deepEqual(await inventorySnapshot(page), afterDraw)
  }
  await bulk.evaluate(button => { button.click(); button.click(); button.click() })
  assert(await bulk.isDisabled(), 'Repeated clicks must not start concurrent hatch animations')
  await page.waitForFunction(() => document.querySelectorAll('.draw-slot.revealed').length === 10)
  assert.equal(await page.locator('.draw-slot.sealed').count(), 0)
  assert(await bulk.isDisabled(), 'Bulk hatch must disable after revealing every egg')
  assert.deepEqual(await inventorySnapshot(page), afterDraw, 'Revealing eggs must not grant Pokemon or refund VP again')
  assert.equal(await page.evaluate(() => window.__tutorialCompleteCalls || 0), tutorial ? 1 : 0, 'Tutorial completion must fire exactly once across individual and bulk reveal')
  assert.equal(await page.evaluate(() => window.__hatchQA.drawTutorialStep), null)
  assert.equal(await page.evaluate(() => localStorage.getItem('champions-draw-tutorial-v1')), 'complete')
  await page.screenshot({ path: path.join(output, `${name}-after.png`) })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__hatchQA?.screen === 'lobby')
  assert.deepEqual(await inventorySnapshot(page), afterDraw, 'Saved Pokemon and VP must survive reload without another grant')
  assert.equal(await page.evaluate(() => window.__hatchQA.drawTutorialStep), null, 'Completed onboarding must not restart')
  await context.close()
  activePage = null
  console.log(`Initial hatch UI passed: ${name}`)
}
try {
  browser = await chromium.launch({ executablePath: await resolveChromiumExecutable(chromium), headless: true })
  await runCase('onboarding-all', true, false)
  await runCase('onboarding-individual-then-all', true, true)
  await runCase('ordinary-all', false, false)
  await runCase('onboarding-touch-landscape', true, false, true)
  assert.deepEqual(errors, [])
  console.log('Initial and ordinary hatch QA passed: ten reveals, one tutorial completion, repeated-click protection, no duplicate Pokemon/VP, reload persistence, and mobile button visibility.')
  console.log(`Screenshots: ${output}`)
} catch (error) {
  console.error('Browser errors:', errors)
  await activePage?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {})
  throw error
} finally {
  await browser?.close()
  await server.close()
}
