import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { createBattle } from '../src/data/battleEngine.js'
import { getLearnableMoves, getMoveById } from '../src/data/trainingData.js'
import { resolveChromiumExecutable } from '../promo/scripts/browserRuntime.mjs'

const require = createRequire(new URL('../promo/package.json', import.meta.url))
const { chromium } = require('playwright')
const root = fileURLToPath(new URL('../', import.meta.url))
const output = path.join(root, 'scripts/.cache/battle-pivot-ui')
await fs.mkdir(output, { recursive: true })
function pokemon(speciesId, moveId, captureId) {
  assert(getLearnableMoves(speciesId).some(move => move.id === moveId), `Fixture ${speciesId} cannot learn ${moveId}`)
  return { captureId, speciesId, moves: [getMoveById(moveId).name] }
}
const props = {
  competitionLabel: '교대 기술 검증',
  playerPokemon: [pokemon(135, 'voltswitch', 'pivot-jolteon'), pokemon(134, 'protect', 'pivot-vaporeon'), pokemon(143, 'protect', 'pivot-snorlax')],
  opponent: { name: '교대 검증 AI', tier: 'S' },
  opponentTeam: { pokemon: [pokemon(1, 'tackle', 'pivot-target')], battleGimmicks: [], strategy: {} },
  rules: {
    weather: { id: 'clear', label: '맑음' }, terrain: { id: 'neutral', label: '일반 필드' },
    format: { id: 'single', label: '싱글배틀', activeSlots: 1, actionSlots: 1 },
    teamRule: { id: 'full', label: '풀 배틀', battleSize: 6 }, disabledGimmickId: null,
  },
}
const initial = createBattle(props)
// Stabilize only execution order. The actual engine resolves the move, damage,
// choice request and the opponent's remaining action through the mounted UI.
initial.player.team[0].stats.speed = 500
initial.opponent.team[0].stats.speed = 10
initial.opponent.team[0].hp = 500
initial.opponent.team[0].maxHp = 500
initial.opponent.team[0].moves = initial.opponent.team[0].moves.filter(move => move.id === 'tackle')
assert.equal(initial.opponent.team[0].moves.length, 1, 'Use one legal enemy attack after automatic AI loadout enrichment')
const fainted = structuredClone(initial)
fainted.player.team[0].hp = 0
fainted.player.team[0].fainted = true
fainted.awaitingPlayerSwitch = true
fainted.awaitingPlayerSwitchSlots = [0]
const revival = createBattle({ ...props, playerPokemon: [
  pokemon(923, 'revivalblessing', 'revival-pawmot'),
  pokemon(134, 'protect', 'revival-vaporeon'),
  pokemon(143, 'protect', 'revival-snorlax'),
  pokemon(135, 'protect', 'revival-jolteon'),
] })
revival.player.team[0].stats.speed = 500
revival.opponent.team[0].stats.speed = 10
revival.opponent.team[0].moves = revival.opponent.team[0].moves.filter(move => move.id === 'tackle')
for (const index of [1, 2]) {
  revival.player.team[index].hp = 0
  revival.player.team[index].fainted = true
}
const activeRevival = createBattle({
  ...props,
  playerPokemon: [pokemon(923, 'revivalblessing', 'active-revival-pawmot'), pokemon(143, 'tackle', 'active-revival-snorlax'), pokemon(135, 'protect', 'active-revival-jolteon')],
  opponentTeam: { pokemon: [pokemon(1, 'tackle', 'active-revival-foe1'), pokemon(7, 'tackle', 'active-revival-foe2')], battleGimmicks: [], strategy: {} },
  rules: { ...props.rules, format: { id: 'double', label: '더블배틀', activeSlots: 2, actionSlots: 2 } },
})
activeRevival.player.team[0].stats.speed = 500
activeRevival.player.team[1].hp = 0
activeRevival.player.team[1].fainted = true
for (const foe of activeRevival.opponent.team) {
  foe.stats.speed = 10
  foe.moves = foe.moves.filter(move => move.id === 'tackle')
}

const styles = ['styles', 'screenRedesign', 'battleGen5', 'titleCleanup', 'battleGimmicks', 'moveAnimationDirector', 'mobileLandscape']
const entry = `
import React from 'react'; import {createRoot} from 'react-dom/client';
import BattleScreen from '/src/BattleScreen.jsx';
${styles.map(name => `import '/src/${name}.css';`).join('\n')}
createRoot(document.getElementById('root')).render(React.createElement('div',{className:'app-shell battle-view'},
 React.createElement(BattleScreen,{...${JSON.stringify(props)},soundEnabled:false,
 gameSettings:{attackAnimation:'skip',hpBarSpeed:'instant'},onComplete:()=>{},onToggleSound:()=>{},onOpenSettings:()=>{}})));
`
const server = await createServer({ root,
  plugins: [{ name: 'pivot-ui-entry', resolveId: id => id === '/pivot-ui-entry.js' ? id : undefined,
    load: id => id === '/pivot-ui-entry.js' ? entry : undefined }],
  server: { host: '127.0.0.1', port: 5206, strictPort: true, hmr: false }, logLevel: 'error',
})
await server.listen()
let browser
try {
  browser = await chromium.launch({ executablePath: await resolveChromiumExecutable(chromium), headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  page.setDefaultTimeout(20000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const html = await server.transformIndexHtml('/pivot-ui.html', '<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body><div id="root"></div><script type="module" src="/pivot-ui-entry.js"></script></body></html>')
  await context.route('**/pivot-ui.html', route => route.fulfill({ contentType: 'text/html', body: html }))
  await context.route('**/src/BattleScreen.jsx', async route => {
    const response = await route.fetch()
    let body = await response.text()
    assert(body.includes('const currentLogEntry ='), 'Battle UI test hook anchor changed')
    // Test hooks exist only in this intercepted HTTP response, not source or build.
    body = body.replace('const currentLogEntry =', `window.__pivotUi = {state:battle,animating:isTurnAnimating,
      load:value=>{setBattle(value);setIntroVisible(false);setTrainerDialogue(null);setMenu('command');
        setPendingGimmick(null);setPendingMoveIndex(null);setQueuedActions([]);setMoveAssetsReady(true);}};
      const currentLogEntry =`)
    await route.fulfill({ response, body })
  })
  await page.goto('http://127.0.0.1:5206/pivot-ui.html')
  await page.waitForFunction(() => window.__pivotUi)
  async function load(state) {
    await page.evaluate(value => window.__pivotUi.load(value), state)
    await page.waitForFunction(() => !window.__pivotUi.animating)
  }
  async function beginPivot() {
    await load(initial)
    await page.locator('.battle-command-buttons .fight').click()
    await page.locator('.battle-move-button').filter({ hasText: '볼트체인지' }).click()
    await page.locator('.battle-party-menu').waitFor()
    await page.waitForFunction(() => window.__pivotUi.state.awaitingPlayerSwitch && !window.__pivotUi.animating)
    const state = await page.evaluate(() => window.__pivotUi.state)
    assert.equal(state.turn, initial.turn, 'Choosing a pivot replacement must pause the current turn')
    assert.equal(state.player.activeIndex, 0, 'No reserve may be chosen automatically')
    assert.equal(state.player.team[0].moves[0].currentPp, initial.player.team[0].moves[0].currentPp - 1)
    assert.equal(state.opponent.team[0].moves[0].currentPp, initial.opponent.team[0].moves[0].currentPp, 'The later enemy action must wait')
    assert.match(await page.locator('.battle-party-menu header').innerText(), /볼트체인지/)
    assert.equal(await page.locator('.battle-party-menu header button').count(), 0, 'A mandatory replacement cannot be cancelled')
    assert.equal(await page.locator('.battle-party-menu-grid button').nth(0).isDisabled(), true)
    await page.waitForTimeout(300)
    assert.equal(await page.evaluate(() => window.__pivotUi.state.player.activeIndex), 0)
    return state
  }
  async function verifyResumed(before, selectedIndex) {
    await page.waitForFunction(turn => !window.__pivotUi.animating && !window.__pivotUi.state.awaitingPlayerSwitch && window.__pivotUi.state.turn > turn, before.turn)
    const state = await page.evaluate(() => window.__pivotUi.state)
    assert.equal(state.turn, before.turn + 1, 'The suspended turn must complete exactly once')
    assert.equal(state.player.activeIndex, selectedIndex)
    assert.equal(state.player.team[0].hp, before.player.team[0].hp, 'The departing Pokemon must not take the later enemy attack')
    assert(state.player.team[selectedIndex].hp < before.player.team[selectedIndex].hp, 'The selected replacement must take the remaining enemy attack')
    assert.equal(state.opponent.team[0].moves[0].currentPp, before.opponent.team[0].moves[0].currentPp - 1,
      `Enemy action must resolve exactly once: ${JSON.stringify(state.log.slice(-12).map(entry => entry.message))}`)
    assert.equal(state.player.team[0].moves[0].currentPp, before.player.team[0].moves[0].currentPp, 'Resuming cannot repeat the pivot move')
  }
  const paused = await beginPivot()
  await page.screenshot({ path: path.join(output, 'pivot-choice-desktop.png') })
  const snorlax = page.locator('.battle-party-menu-grid button').filter({ hasText: '잠만보' })
  await snorlax.evaluate(button => { button.click(); button.click() })
  await verifyResumed(paused, 2)
  await page.screenshot({ path: path.join(output, 'pivot-resumed-desktop.png') })
  await page.setViewportSize({ width: 844, height: 390 })
  const mobilePaused = await beginPivot()
  const clippedNames = await page.locator('.battle-party-menu-grid button > span:nth-child(2) strong').evaluateAll(names =>
    names.filter(name => name.scrollWidth > name.clientWidth + 1).map(name => name.textContent))
  assert.deepEqual(clippedNames, [], 'The mobile replacement names must remain readable')
  await page.screenshot({ path: path.join(output, 'pivot-choice-mobile.png') })
  const vaporeon = page.locator('.battle-party-menu-grid button').filter({ hasText: '샤미드' })
  await vaporeon.focus()
  await page.keyboard.press('Enter')
  await verifyResumed(mobilePaused, 1)
  await load(fainted)
  await page.locator('.battle-party-menu').waitFor()
  assert.match(await page.locator('.battle-party-menu header').innerText(), /다음 포켓몬을 선택하세요/)
  assert.equal(await page.locator('.battle-party-menu-grid button').nth(0).isDisabled(), true)
  await page.locator('.battle-party-menu-grid button').filter({ hasText: '잠만보' }).click()
  await page.waitForFunction(() => !window.__pivotUi.animating && !window.__pivotUi.state.awaitingPlayerSwitch)
  assert.equal(await page.evaluate(() => window.__pivotUi.state.player.activeIndex), 2)
  assert.equal(await page.evaluate(() => window.__pivotUi.state.turn), fainted.turn, 'A between-turn faint replacement cannot consume another turn')
  await load(revival)
  await page.locator('.battle-command-buttons .fight').click()
  await page.locator('.battle-move-button').filter({ hasText: '회생의기도' }).click()
  await page.locator('.battle-party-menu').waitFor()
  await page.waitForFunction(() => window.__pivotUi.state.pendingPlayerSwitch?.kind === 'revival' && !window.__pivotUi.animating)
  assert.match(await page.locator('.battle-party-menu header').innerText(), /회생의기도 · 되살릴 포켓몬을 선택하세요/)
  const revivalChoices = page.locator('.battle-party-menu-grid button')
  assert.equal(await revivalChoices.nth(0).isDisabled(), true, 'The active user is not a revival target')
  assert.equal(await revivalChoices.nth(1).isEnabled(), true)
  assert.equal(await revivalChoices.nth(2).isEnabled(), true)
  assert.equal(await revivalChoices.nth(3).isDisabled(), true, 'Living reserves cannot be revived')
  assert.equal(await page.evaluate(() => window.__pivotUi.state.player.team[2].hp), 0, 'No Pokemon may be revived before the choice')
  await page.screenshot({ path: path.join(output, 'revival-choice-mobile.png') })
  await revivalChoices.nth(2).click()
  await page.waitForFunction(turn => !window.__pivotUi.animating && !window.__pivotUi.state.awaitingPlayerSwitch && window.__pivotUi.state.turn > turn, revival.turn)
  const revived = await page.evaluate(() => window.__pivotUi.state)
  assert.equal(revived.player.activeIndex, 0, 'Revival must not switch out the user')
  assert.equal(revived.player.team[2].fainted, false)
  assert.equal(revived.player.team[2].hp, Math.max(1, Math.floor(revived.player.team[2].maxHp / 2)))
  assert.equal(revived.player.team[1].fainted, true, 'Only the selected fainted reserve must be revived')
  assert(revived.player.team[0].hp < revival.player.team[0].hp, 'The original user must receive the remaining enemy attack')
  await load(activeRevival)
  await page.locator('.battle-command-buttons .fight').click()
  await page.locator('.battle-move-button').filter({ hasText: '회생의기도' }).click()
  await page.locator('.battle-party-menu').waitFor()
  await page.waitForFunction(() => window.__pivotUi.state.pendingPlayerSwitch?.kind === 'revival' && !window.__pivotUi.animating)
  const activeFaintedAlly = page.locator('.battle-party-menu-grid button').filter({ hasText: '잠만보' })
  assert.equal(await activeFaintedAlly.isEnabled(), true, 'A fainted ally still occupying a field slot is a legal revival target')
  assert.equal(await page.locator('.battle-party-menu-grid button').filter({ hasText: '쥬피썬더' }).isDisabled(), true)
  await page.screenshot({ path: path.join(output, 'revival-active-ally-mobile.png') })
  await activeFaintedAlly.click()
  await page.waitForFunction(turn => !window.__pivotUi.animating && !window.__pivotUi.state.awaitingPlayerSwitch && window.__pivotUi.state.turn > turn, activeRevival.turn)
  const activeRevived = await page.evaluate(() => window.__pivotUi.state)
  assert.equal(activeRevived.player.activeIndexes[1], 1)
  assert.equal(activeRevived.player.team[1].fainted, false)
  assert(activeRevived.player.team[1].hp > 0)
  assert.equal(activeRevived.player.team[1].moves[0].currentPp, activeRevival.player.team[1].moves[0].currentPp, 'The revived ally cannot gain an extra action during the suspended turn')
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ ok: true, checks: ['actual Volt Switch UI', 'pause without automatic replacement', 'move source prompt', 'active member disabled', 'uncancellable choice', 'non-default replacement', 'remaining attack hits chosen Pokemon', 'no PP or turn duplication', 'duplicate click guard', 'mobile keyboard selection', 'ordinary faint replacement', 'Revival Blessing chooses one fainted reserve', 'revival keeps active user and resumes turn', 'fainted field ally can be revived without an extra action'], screenshots: output }))
  await context.close()
} finally {
  await browser?.close()
  await server.close()
}
