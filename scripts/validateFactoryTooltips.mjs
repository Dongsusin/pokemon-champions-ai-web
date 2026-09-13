import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { createFactoryRun } from '../src/data/battleFactory.js'
import { createBattlePreviewPokemon } from '../src/data/battleEngine.js'
import { getAbility, getMove } from '../src/data/trainingData.js'
import { getBattleItem } from '../src/data/shopData.js'
import { resolveChromiumExecutable } from '../promo/scripts/browserRuntime.mjs'

// Actual Factory components on an isolated origin. Deterministic rental and
// ranking fixtures exercise tooltip interactions, not battle outcomes or APIs.
const root = fileURLToPath(new URL('../', import.meta.url))
const output = path.join(root, 'scripts/.cache/factory-tooltips')
await fs.mkdir(output, { recursive: true })
const run = createFactoryRun({ seed: 'tooltip-check', id: 'tooltip-check' })
run.offers[0].nature = '고집'
run.offers[1].nature = '노력'
run.offers[0].moves[0] = '테라버스트'
run.offers[0].moveIds[0] = 'terablast'
const preview = createBattlePreviewPokemon(run.offers[0])
const ranking = { source: 'local', entries: [{ id: 'tooltip-ranking', runId: run.id,
  trainerName: '툴팁 검증', floor: 8, wins: 7, recordedAt: '2026-09-13T00:00:00Z', party: run.offers.slice(0, 3) }] }
const styles = ['styles', 'screenRedesign', 'battleGen5', 'titleCleanup', 'battleGimmicks', 'moveAnimationDirector', 'settings', 'auth', 'mobileLandscape']
const entry = `import React from 'react';import{createRoot}from'react-dom/client';
import BattleFactoryLobby from '/src/BattleFactoryLobby.jsx';import BattleFactoryRankings from '/src/BattleFactoryRankings.jsx';
${styles.map(name => `import '/src/${name}.css';`).join('\n')}
const run=${JSON.stringify(run)};const ranking=${JSON.stringify(ranking)};const noop=()=>{};
const screen=new URLSearchParams(location.search).get('view')==='rankings'
?React.createElement(BattleFactoryRankings,{ranking,onBack:noop})
:React.createElement(BattleFactoryLobby,{run,onBack:noop,onChooseRentals:noop,onChooseLead:noop,onStartBattle:noop,onAdvanceFloor:noop,onRestart:noop,onOpenRankings:noop});
createRoot(document.getElementById('root')).render(React.createElement('div',{className:'app-shell'},screen));`
const server = await createServer({ root, mode: 'factory-tooltip-validation', logLevel: 'error',
  plugins: [{ name: 'factory-tooltip-component-fixture', enforce: 'pre',
    resolveId(source) { if (source === '/factory-tooltip-entry.js') return source },
    load(id) { if (id === '/factory-tooltip-entry.js') return entry },
  }], server: { host: '127.0.0.1', port: 0, hmr: false } })
await server.listen()
const origin = `http://127.0.0.1:${server.httpServer.address().port}`
const html = await server.transformIndexHtml('/factory-tooltips.html', '<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body><div id="root"></div><script type="module" src="/factory-tooltip-entry.js"></script></body></html>')
const require = createRequire(new URL('../promo/package.json', import.meta.url))
const { chromium } = require('playwright')
const checks = []
const errors = []
const blocked = []
let browser
let page

async function check(name, action) {
  try {
    await action()
    checks.push({ name, passed: true })
    console.log(`PASS ${name}`)
  } catch (error) {
    checks.push({ name, passed: false, error: error.message })
    if (page) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {})
    throw error
  }
}

async function dismissTooltip() {
  if (await page.getByRole('tooltip').count()) {
    await page.keyboard.press('Escape')
    await page.getByRole('tooltip').waitFor({ state: 'detached' })
  }
}

async function showTooltip(anchor, description, { focus = false, tap = false } = {}) {
  await dismissTooltip()
  await anchor.scrollIntoViewIfNeeded()
  if (focus) await anchor.focus()
  else if (tap) await anchor.tap()
  else await anchor.hover()
  const tooltip = page.getByRole('tooltip')
  await tooltip.waitFor({ state: 'visible' })
  assert.equal(await tooltip.locator('.factory-info-tooltip-description').innerText(), description)
  assert.equal(await anchor.getAttribute('aria-describedby'), await tooltip.getAttribute('id'))
  const box = await tooltip.boundingBox()
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  assert.ok(box.x >= 11 && box.y >= 11 && box.x + box.width <= viewport.width - 11 && box.y + box.height <= viewport.height - 11,
    `Tooltip must stay within viewport: ${JSON.stringify({ box, viewport })}`)
  assert.ok(await tooltip.evaluate(element => {
    const bounds = element.getBoundingClientRect()
    return element.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2))
  }), 'Tooltip must be on the visible layer at its center')
  return tooltip
}

try {
  browser = await chromium.launch({ executablePath: await resolveChromiumExecutable(chromium), headless: true })
  for (const device of [
    { name: 'desktop', viewport: { width: 1440, height: 900 } },
    { name: 'mobile', viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true },
  ]) {
    const { name, ...options } = device
    const context = await browser.newContext(options)
    await context.route('**/*', async route => {
      const url = new URL(route.request().url())
      if (url.origin !== origin || url.pathname.startsWith('/api/')) {
        blocked.push({ device: name, url: url.href })
        return route.abort('blockedbyclient')
      }
      if (url.pathname === '/factory-tooltips.html') return route.fulfill({ contentType: 'text/html', body: html })
      return route.continue()
    })
    page = await context.newPage()
    page.on('pageerror', error => errors.push({ device: name, message: error.message }))
    await page.goto(`${origin}/factory-tooltips.html`)
    await page.locator('.factory-rental-card').first().waitFor()
    const firstItem = getBattleItem(run.offers[0].heldItemId)
    await check(`${name}: rental item source text, focus and viewport`, async () => {
      await showTooltip(page.locator('.factory-card-item').first(), firstItem.description ?? firstItem.effect)
      await page.screenshot({ path: path.join(output, `${name}-rental-item.png`) })
      await page.mouse.move(0, 0)
      await dismissTooltip()
      await showTooltip(page.locator('.factory-card-item').first(), firstItem.description ?? firstItem.effect, { focus: true })
      assert.equal(await page.locator('.factory-rental-select[aria-pressed="true"]').count(), 0)
    })
    await check(`${name}: disabled candidate still exposes item without changing selection`, async () => {
      await dismissTooltip()
      for (let index = 0; index < 3; index++) await page.locator('.factory-rental-select').nth(index).click()
      assert.ok(await page.locator('.factory-rental-select').nth(3).isDisabled())
      const item = getBattleItem(run.offers[3].heldItemId)
      await showTooltip(page.locator('.factory-card-item').nth(3), item.description ?? item.effect)
      await dismissTooltip()
      if (device.hasTouch) await showTooltip(page.locator('.factory-card-item').nth(3), item.description ?? item.effect, { tap: true })
      else await page.locator('.factory-card-item').nth(3).click()
      assert.equal(await page.locator('.factory-rental-select[aria-pressed="true"]').count(), 3)
    })
    await dismissTooltip()
    await page.locator('.factory-rental-info').first().click()
    const dialog = page.getByRole('dialog')
    await dialog.waitFor({ state: 'visible' })
    const meta = label => dialog.locator('.factory-details-meta > div').filter({ has: page.locator('dt', { hasText: label }) })
    await check(`${name}: ability description, top layer and Escape keeps details open`, async () => {
      const ability = getAbility(preview.ability)
      const tip = await showTooltip(meta('특성').locator('.factory-tooltip-anchor'), ability.description)
      assert.equal(await tip.locator('.factory-info-tooltip-meta').innerText(), `발동 조건 · ${ability.trigger}`)
      assert.ok(await tip.evaluate(element => element.parentElement.matches('dialog[open]')))
      await page.screenshot({ path: path.join(output, `${name}-ability.png`) })
      await page.keyboard.press('Escape')
      await page.getByRole('tooltip').waitFor({ state: 'detached' })
      assert.ok(await dialog.isVisible(), 'First Escape should dismiss only the tooltip')
    })
    await check(`${name}: modified nature and detail held item`, async () => {
      await showTooltip(meta('성격').locator('.factory-tooltip-anchor'), '공격 10% 상승 · 특수공격 10% 하락')
      await showTooltip(meta('지닌 도구').locator('.factory-tooltip-anchor'), firstItem.description ?? firstItem.effect)
    })
    await check(`${name}: all move descriptions including long Tera Blast`, async () => {
      for (let index = 0; index < preview.moves.length; index++) {
        const tip = await showTooltip(dialog.locator('.factory-move-list > .factory-tooltip-anchor').nth(index), preview.moves[index].description)
        assert.ok((await tip.locator('.factory-info-tooltip-meta').innerText()).includes(`PP ${preview.moves[index].maxPp}`))
        if (index === 0) {
          assert.equal(preview.moves[index].description, getMove('테라버스트').description)
          assert.ok(preview.moves[index].description.length > 100)
          await page.screenshot({ path: path.join(output, `${name}-long-move.png`) })
        }
      }
    })
    await check(`${name}: dialog scroll dismisses tooltip`, async () => {
      await dialog.evaluate(element => {
        element.scrollTop = element.scrollTop > 0 ? 0 : element.scrollHeight
        // Desktop content fits; dispatch the same native event to cover cleanup.
        element.dispatchEvent(new Event('scroll'))
      })
      await page.getByRole('tooltip').waitFor({ state: 'detached' })
      assert.ok(await dialog.isVisible())
    })
    await dialog.getByRole('button', { name: '포켓몬 정보 닫기' }).click()
    await page.locator('.factory-rental-info').nth(1).click()
    await check(`${name}: neutral nature description`, async () => {
      await showTooltip(meta('성격').locator('.factory-tooltip-anchor'), '올라가거나 내려가는 능력치 없이 모든 능력치가 그대로 적용됩니다.')
      await dismissTooltip()
      await page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'detached' })
    })
    await page.goto(`${origin}/factory-tooltips.html?view=rankings`)
    await page.locator('.factory-ranking-row').waitFor()
    await check(`${name}: ranking mini item and expanded item descriptions`, async () => {
      const miniTooltip = await showTooltip(page.locator('.factory-ranking-mini-item').first(), firstItem.description ?? firstItem.effect)
      await miniTooltip.hover()
      if (device.hasTouch) await miniTooltip.tap()
      else await miniTooltip.click()
      assert.equal(await page.locator('.factory-ranking-row').getAttribute('aria-expanded'), 'false', 'Tooltip content must not toggle its React ancestor ranking row')
      await dismissTooltip()
      await page.locator('.factory-ranking-mini-item').first().click()
      assert.equal(await page.locator('.factory-ranking-row').getAttribute('aria-expanded'), 'false', 'Item tap must not expand the ranking row')
      await dismissTooltip()
      await page.locator('.factory-ranking-expand').click()
      await showTooltip(page.locator('.factory-ranking-held-item .factory-tooltip-anchor').first(), firstItem.description ?? firstItem.effect)
      await page.screenshot({ path: path.join(output, `${name}-ranking-item.png`) })
      await dismissTooltip()
      await page.locator('.factory-ranking-pokemon button').first().click()
      await showTooltip(page.locator('.factory-details-meta > div').filter({ has: page.locator('dt', { hasText: '특성' }) }).locator('.factory-tooltip-anchor'), getAbility(preview.ability).description)
    })
    await context.close()
    page = null
  }
  await check('No browser exceptions or API requests', async () => {
    assert.deepEqual(errors, [])
    assert.equal(blocked.filter(request => new URL(request.url).pathname.startsWith('/api/')).length, 0)
  })
} finally {
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ checks, errors, blocked }, null, 2))
  await browser?.close()
  await server.close()
}
console.log(`Factory tooltip validation passed (${checks.length} checks). Evidence: ${output}`)
