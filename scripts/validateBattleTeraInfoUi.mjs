import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { createBattle } from '../src/data/battleEngine.js'
import { getMoveById } from '../src/data/trainingData.js'
import { resolveChromiumExecutable } from '../promo/scripts/browserRuntime.mjs'

const require = createRequire(new URL('../promo/package.json', import.meta.url))
const { chromium } = require('playwright')
const root = fileURLToPath(new URL('../', import.meta.url))
const output = path.join(root, 'scripts/.cache/battle-tera-info-ui')
await fs.mkdir(output, { recursive: true })
function pokemon(speciesId, teraType, moveId = 'protect') {
  return { captureId: `tera-info-${speciesId}`, speciesId, teraType, moves: [getMoveById(moveId).name] }
}
const props = {
  competitionLabel: '테라타입 확인',
  playerPokemon: [pokemon(130, '불꽃', 'terablast'), pokemon(6, '드래곤'), pokemon(445, '강철'), pokemon(197, '독'), pokemon(1024, '노말'), pokemon(1017, '노말')],
  opponent: { name: '테라타입 검증 AI', tier: 'S' },
  opponentTeam: { pokemon: [pokemon(1, '페어리'), pokemon(7, '격투')], battleGimmicks: [], strategy: {} },
  rules: {
    weather: { id: 'clear', label: '맑음' }, terrain: { id: 'neutral', label: '일반 필드' },
    format: { id: 'single', label: '싱글배틀', activeSlots: 1, actionSlots: 1 },
    teamRule: { id: 'full', label: '풀 배틀', battleSize: 6 }, disabledGimmickId: null,
  },
}
const single = createBattle(props)
// AI setup may recommend a Tera type; use a known unrevealed value in this visibility fixture.
single.opponent.activeIndex = 0
single.opponent.activeIndexes = [0]
single.opponent.team[0].teraType = '페어리'
const double = createBattle({ ...props, rules: { ...props.rules, format: { id: 'double', label: '더블배틀', activeSlots: 2, actionSlots: 2 } } })
double.opponent.activeIndex = 0
double.opponent.activeIndexes = [0, 1]
double.opponent.team[0].teraType = '페어리'
const activated = structuredClone(single)
activated.player.team[0].teraActive = true
activated.player.team[0].types = ['불꽃']
activated.opponent.team[0].teraActive = true
activated.opponent.team[0].types = ['페어리']
const terapagos = createBattle({ ...props, playerPokemon: [pokemon(1024, '노말', 'terastarstorm')] })
const slowTera = structuredClone(single)
slowTera.opponent.team = [slowTera.opponent.team[0]]
slowTera.player.team[0].stats.speed = 1
slowTera.opponent.team[0].stats.speed = 500
slowTera.opponent.team[0].moves = [{ ...getMoveById('tackle'), currentPp: 35, maxPp: 35 }]
slowTera.opponent.team[0].hp = slowTera.opponent.team[0].maxHp = 500
const styles = ['styles', 'screenRedesign', 'battleGen5', 'titleCleanup', 'battleGimmicks', 'moveAnimationDirector', 'mobileLandscape']
const entry = `import React from 'react'; import {createRoot} from 'react-dom/client';
import BattleScreen from '/src/BattleScreen.jsx';
${styles.map(name => `import '/src/${name}.css';`).join('\n')}
createRoot(document.getElementById('root')).render(React.createElement('div',{className:'app-shell battle-view'},
 React.createElement(BattleScreen,{...${JSON.stringify(props)},soundEnabled:false,
 gameSettings:{attackAnimation:'skip',hpBarSpeed:'instant'},onComplete:()=>{},onToggleSound:()=>{},onOpenSettings:()=>{}})));`
const server = await createServer({ root,
  plugins: [{ name: 'tera-info-ui-entry', resolveId: id => id === '/tera-info-entry.js' ? id : undefined,
    load: id => id === '/tera-info-entry.js' ? entry : undefined }],
  server: { host: '127.0.0.1', port: 5207, strictPort: true, hmr: false }, logLevel: 'error',
})
await server.listen()
let browser
let checks = 0
try {
  browser = await chromium.launch({ executablePath: await resolveChromiumExecutable(chromium), headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  page.setDefaultTimeout(20000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const html = await server.transformIndexHtml('/tera-info.html', '<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body><div id="root"></div><script type="module" src="/tera-info-entry.js"></script></body></html>')
  await context.route('**/tera-info.html', route => route.fulfill({ contentType: 'text/html', body: html }))
  await context.route('**/src/BattleScreen.jsx', async route => {
    const response = await route.fetch()
    let body = await response.text()
    assert(body.includes('const currentLogEntry ='), 'Battle UI test hook anchor changed')
    // Fixture loader is injected only into this local test response, never source or build.
    body = body.replace('const currentLogEntry =', `window.__teraInfoHistory?.push({phase:turnCue?.phase,side:turnCue?.sideId,
      teraActive:battle.player.team[0].teraActive,types:[...battle.player.team[0].types]});
      window.__teraInfoUi={state:battle,animating:isTurnAnimating,
      load:value=>{setBattle(value);setIntroVisible(false);setTrainerDialogue(null);setMenu('command');
        setPendingGimmick(null);setPendingMoveIndex(null);setQueuedActions([]);setMoveAssetsReady(true);
        setFocusedPokemonSide(null);setPinnedPokemonSide(null);setHoveredPokemonSide(null);}};
      const currentLogEntry =`)
    await route.fulfill({ response, body })
  })
  await page.goto('http://127.0.0.1:5207/tera-info.html')
  await page.waitForFunction(() => window.__teraInfoUi)
  async function load(state) {
    await page.evaluate(value => window.__teraInfoUi.load(value), state)
    await page.waitForFunction(() => !window.__teraInfoUi.animating)
    await page.locator('.battle-command-buttons .fight').waitFor()
  }
  async function checkOwnPanel(type, currentTypes) {
    const panel = page.locator('.battle-hp-panel.side-player').first()
    assert.equal(await panel.locator('.battle-tera-badge b').innerText(), type)
    assert.equal(await panel.locator('.battle-current-types b').innerText(), currentTypes)
    assert(await panel.locator('.battle-tera-badge').isVisible())
  }
  async function checkContained(selector) {
    const clipped = await page.locator(selector).evaluateAll(elements => elements.filter(element => {
      const rect = element.getBoundingClientRect()
      const panel = element.closest('.battle-hp-panel, .battle-party-menu-grid button, .battle-gimmick-selector')
      const parent = panel.getBoundingClientRect()
      return rect.left < parent.left - 1 || rect.right > parent.right + 1 || rect.top < parent.top - 1
        || rect.bottom > parent.bottom + 1 || element.scrollWidth > element.clientWidth + 1
    }).map(element => element.textContent))
    assert.deepEqual(clipped, [], `Tera information must fit its container: ${selector}`)
  }
  for (const viewport of [{ width: 1440, height: 900, name: 'desktop' }, { width: 844, height: 390, name: 'mobile' }]) {
    await page.setViewportSize(viewport)
    for (const [format, fixture] of [['single', single], ['double', double]]) {
      await load(fixture)
      await checkOwnPanel('불꽃', '물 / 비행')
      assert.equal(await page.locator('.battle-hp-panel.side-opponent .battle-tera-badge').count(), 0, 'Unrevealed opponent Tera types remain hidden')
      assert.equal(await page.locator('.battle-inspector-revealed-tera').count(), 0)
      assert(!(await page.locator('.battle-pokemon-inspector.side-opponent').first().innerHTML()).includes('페어리'), 'Hidden tooltip DOM cannot disclose an unused Tera type')
      await checkContained('.battle-hp-panel .battle-tera-badge')
      await page.screenshot({ path: path.join(output, `${viewport.name}-${format}-field.png`) })
      checks++
      await page.locator('.battle-command-buttons .fight').click()
      const teraButton = page.locator('.battle-gimmick-selector .mechanic-tera')
      assert.match(await teraButton.innerText(), /TERA · 불꽃/)
      assert.equal(await teraButton.getAttribute('aria-label'), '테라스탈 · 불꽃타입')
      await teraButton.click()
      assert.equal(await teraButton.getAttribute('aria-pressed'), 'true')
      await checkOwnPanel('불꽃', '물 / 비행')
      assert.equal(await page.locator('.battle-hp-panel.side-player .battle-tera-badge.is-active').count(), 0, 'Selection alone is not activation')
      await checkContained('.battle-gimmick-selector .mechanic-tera')
      await page.screenshot({ path: path.join(output, `${viewport.name}-${format}-move.png`) })
      checks++
      await load(fixture)
      await page.locator('.battle-command-buttons .pokemon').click()
      assert.equal(await page.locator('.battle-party-menu-grid .battle-tera-badge').count(), 6)
      assert.deepEqual(await page.locator('.battle-party-menu-grid .battle-tera-badge b').allTextContents(), ['불꽃', '드래곤', '강철', '독', '스텔라', '풀'])
      await page.screenshot({ path: path.join(output, `${viewport.name}-${format}-party.png`) })
      await checkContained('.battle-party-menu-grid .battle-tera-badge')
      checks++
    }
    await load(activated)
    await checkOwnPanel('불꽃', '불꽃')
    assert.equal(await page.locator('.battle-hp-panel.side-player .battle-tera-badge.is-active small').innerText(), '테라 중')
    assert.equal(await page.locator('.battle-hp-panel.side-opponent .battle-tera-badge b').innerText(), '페어리')
    assert.match(await page.locator('.battle-inspector-revealed-tera').textContent(), /테라타입 · 사용 중페어리/)
    checks++
    await load(terapagos)
    await checkOwnPanel('스텔라', '노말')
    await page.locator('.battle-command-buttons .fight').click()
    assert.match(await page.locator('.battle-gimmick-selector .mechanic-tera').innerText(), /TERA · 스텔라/)
    await page.locator('.battle-gimmick-selector .mechanic-tera').click()
    assert.equal(await page.locator('.battle-move-type').first().innerText(), '스텔라')
    checks++
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await load(single)
  await page.locator('.battle-pokemon-stage.player').first().focus()
  await page.locator('.battle-pokemon-stage.player').first().press('Enter')
  const tooltip = page.locator('.battle-pokemon-inspector.side-player.is-visible')
  await tooltip.waitFor()
  await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.battle-pokemon-inspector.side-player.is-visible')).opacity) >= 0.99)
  assert.equal(await tooltip.locator('.battle-inspector-type-label').innerText(), '현재 타입')
  assert.equal(await tooltip.locator('.battle-inspector-tera-value').innerText(), '불꽃')
  await page.screenshot({ path: path.join(output, 'desktop-status-tooltip.png') })
  checks++
  await load(slowTera)
  await page.evaluate(() => { window.__teraInfoHistory = [] })
  await page.locator('.battle-command-buttons .fight').click()
  await page.locator('.battle-gimmick-selector .mechanic-tera').click()
  await page.locator('.battle-move-button').first().click()
  await page.locator('.battle-gimmick-sequence.mechanic-tera.side-player').waitFor()
  await checkOwnPanel('불꽃', '불꽃')
  assert.equal(await page.locator('.battle-hp-panel.side-player .battle-tera-badge.is-active').count(), 1)
  const beforeAttack = await page.evaluate(() => window.__teraInfoHistory)
  assert(!beforeAttack.some(step => step.phase === 'attack'), 'The visible Tera animation and HP type must precede all attacks')
  await page.screenshot({ path: path.join(output, 'slow-tera-before-enemy-attack.png') })
  await page.waitForFunction(turn => !window.__teraInfoUi.animating && window.__teraInfoUi.state.turn > turn, slowTera.turn)
  const playback = await page.evaluate(() => window.__teraInfoHistory)
  const firstAttackIndex = playback.findIndex(step => step.phase === 'attack')
  const teraIndex = playback.findIndex(step => step.phase === 'gimmick' && step.side === 'player')
  assert(firstAttackIndex > teraIndex && teraIndex >= 0)
  assert.equal(playback[firstAttackIndex].side, 'opponent', 'The faster opponent still attacks first')
  assert.equal(playback[firstAttackIndex].teraActive, true)
  assert.deepEqual(playback[firstAttackIndex].types, ['불꽃'])
  checks++
  assert.deepEqual(errors, [], 'No runtime errors')
  console.log(`Battle Tera information UI: ${checks} checks passed. Screenshots: ${output}`)
} finally {
  await browser?.close()
  await server.close()
}
