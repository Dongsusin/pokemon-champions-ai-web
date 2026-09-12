import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { createBattle } from '../src/data/battleEngine.js'
import { SPECIES_PROFILES, getLearnableMoves, getMoveById } from '../src/data/trainingData.js'
import { resolveChromiumExecutable } from '../promo/scripts/browserRuntime.mjs'

const require = createRequire(new URL('../promo/package.json', import.meta.url))
const { chromium } = require('playwright')
const root = fileURLToPath(new URL('../', import.meta.url))
const output = path.join(root, 'scripts/.cache/double-battle-commands-ui')
await fs.mkdir(output, { recursive: true })
const profiles = new Map(Object.values(SPECIES_PROFILES).map(profile => [profile.slug, profile]))
let serial = 0
function pokemon(slug, moveId) {
  const profile = profiles.get(slug)
  assert(profile, slug)
  assert(getLearnableMoves(profile.id).some(move => move.id === moveId), `${slug} cannot learn ${moveId}`)
  return { speciesId: profile.id, captureId: `double-command-${++serial}`, ability: profile.abilities[0],
    moveIds: [moveId], moves: [getMoveById(moveId).name] }
}
const props = {
  playerPokemon: [pokemon('jolteon', 'thunderbolt'), pokemon('vaporeon', 'watergun'), pokemon('snorlax', 'tackle'), pokemon('arcanine', 'flamethrower')],
  opponent: { name: '더블 명령 검증', tier: 'S' },
  opponentTeam: { pokemon: [pokemon('wailord', 'splash'), pokemon('wailord', 'splash')], battleGimmicks: [], strategy: {} },
  rules: { weather: { id: 'clear', label: '맑음' }, terrain: { id: 'neutral', label: '일반 필드' },
    format: { id: 'double', label: '더블배틀', activeSlots: 2, actionSlots: 2 },
    teamRule: { id: 'full', label: '풀 배틀', battleSize: 6 }, aiDifficulty: { id: 'normal' } },
}
const initial = createBattle(props)
for (const side of ['player', 'opponent']) initial[side].team.forEach((member, index) => {
  const moveId = side === 'opponent' ? 'splash' : ['thunderbolt', 'watergun', 'tackle', 'flamethrower'][index]
  member.moves = member.moves.filter(move => move.id === moveId)
  assert.equal(member.moves.length, 1)
})
const focusFire = structuredClone(initial)
focusFire.opponent.team[0].hp = 1
const styles = ['styles', 'screenRedesign', 'battleGen5', 'titleCleanup', 'battleGimmicks', 'moveAnimationDirector', 'mobileLandscape']
const entry = `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import BattleScreen from '/src/BattleScreen.jsx';
import SettingsModal from '/src/SettingsModal.jsx';import {DEFAULT_GAME_SETTINGS} from '/src/gameSettings.js';
${styles.map(name => `import '/src/${name}.css';`).join('\n')}
function Harness(){const [settingsOpen,setSettingsOpen]=useState(false);return React.createElement('div',{className:'app-shell battle-view'},
React.createElement('button',{onClick:()=>setSettingsOpen(true),style:{position:'fixed',top:0,right:0,zIndex:9999},'aria-label':'검증 설정 열기'},'설정'),
React.createElement(BattleScreen,{...${JSON.stringify(props)},soundEnabled:false,gameSettings:{attackAnimation:'skip',hpBarSpeed:'instant'},
onComplete:()=>{},onToggleSound:()=>{},onOpenSettings:()=>setSettingsOpen(true)}),
settingsOpen&&React.createElement(SettingsModal,{settings:DEFAULT_GAME_SETTINGS,onChange:()=>{},onClose:()=>setSettingsOpen(false),onReset:()=>{},onSignOut:()=>{}}));}
createRoot(document.getElementById('root')).render(React.createElement(Harness));`
const port = Number(process.env.DOUBLE_COMMAND_UI_PORT ?? 5214)
const server = await createServer({ root, plugins: [{ name: 'double-command-ui-entry',
  resolveId: id => id === '/double-command-ui-entry.js' ? id : undefined,
  load: id => id === '/double-command-ui-entry.js' ? entry : undefined }],
  server: { host: '127.0.0.1', port, strictPort: true, hmr: false }, logLevel: 'error' })
await server.listen()
let browser
const results = []
const errors = []
try {
  browser = await chromium.launch({ executablePath: await resolveChromiumExecutable(chromium), headless: true })
  const html = await server.transformIndexHtml('/double-command-ui.html', '<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body><div id="root"></div><script type="module" src="/double-command-ui-entry.js"></script></body></html>')
  for (const device of [
    { id: 'desktop', viewport: { width: 1440, height: 900 }, hasTouch: false },
    { id: 'mobile', viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true },
  ]) {
  const context = await browser.newContext(device)
  await context.addInitScript(() => { Math.random = () => 0.5 })
  const page = await context.newPage()
  page.setDefaultTimeout(12000)
  page.on('pageerror', error => errors.push(error.message))
  await context.route('**/double-command-ui.html', route => route.fulfill({ contentType: 'text/html', body: html }))
  await context.route('**/src/BattleScreen.jsx', async route => {
    const response = await route.fetch()
    let body = await response.text()
    assert(body.includes('const currentLogEntry ='), 'BattleScreen test hook anchor changed')
    // Hooks exist only in this intercepted test response, never production.
    body = body.replace('const currentLogEntry =', `window.__doubleUi={state:battle,menu,commandSlot,queuedActions,animating:isTurnAnimating,
      load:value=>{setBattle(value);setIntroVisible(false);setTrainerDialogue(null);setMenu('command');setCommandSlot(0);
      setPendingGimmick(null);setPendingMoveIndex(null);setQueuedActions([]);setMoveAssetsReady(true);}};
      const currentLogEntry =`)
    await route.fulfill({ response, body })
  })
  await page.goto(`http://127.0.0.1:${port}/double-command-ui.html`)
  await page.waitForFunction(() => window.__doubleUi)
  const activate = locator => device.hasTouch ? locator.tap() : locator.click()
  const pp = state => state.player.team.map(member => member.moves.map(move => move.currentPp))
  async function load(state = initial) {
    await page.waitForFunction(() => !window.__doubleUi.animating)
    await page.evaluate(value => window.__doubleUi.load(value), state)
    await page.locator('.battle-command-buttons .fight').waitFor()
  }
  async function begin() { await activate(page.locator('.battle-command-buttons .fight')) }
  async function openParty() { await activate(page.locator('.battle-slot-switch-button')); await page.locator('.battle-party-menu').waitFor() }
  async function reserve(index) { await openParty(); await activate(page.locator('.battle-party-menu-grid button').nth(index)) }
  async function move(targetSlot = 0) {
    await activate(page.locator('.battle-move-button').first())
    await page.locator('.battle-target-menu').waitFor()
    await activate(page.locator('.battle-target-grid button').filter({ hasText: `상대 ${String(targetSlot + 1).padStart(2, '0')}` }))
  }
  async function settled(before = initial) {
    await page.waitForFunction(turn => !window.__doubleUi.animating && window.__doubleUi.state.turn > turn, before.turn)
    const state = await page.evaluate(() => window.__doubleUi.state)
    assert.equal(state.turn, before.turn + 1)
    return state
  }
  async function firstSwitchQueued() {
    await begin(); await reserve(2)
    const snapshot = await page.evaluate(() => ({ menu: window.__doubleUi.menu, slot: window.__doubleUi.commandSlot,
      actions: window.__doubleUi.queuedActions, state: window.__doubleUi.state }))
    assert.equal(snapshot.menu, 'fight', 'A queued switch must keep the next ally move menu open')
    assert.equal(snapshot.slot, 1)
    assert.deepEqual(snapshot.actions.map(({type,actorSlot,targetIndex}) => ({type,actorSlot,targetIndex})), [{type:'switch',actorSlot:0,targetIndex:2}])
    assert.deepEqual(snapshot.state.player.activeIndexes, [0, 1], 'A reservation cannot switch before both commands exist')
    assert.deepEqual(pp(snapshot.state), pp(initial))
    await page.waitForTimeout(350)
    assert.equal(await page.evaluate(() => window.__doubleUi.commandSlot), 1, 'The next slot must stay selected without a forced timer')
  }
  async function check(id, callback) {
    if (process.env.DOUBLE_COMMAND_UI_CASES && !process.env.DOUBLE_COMMAND_UI_CASES.split(',').includes(id)) return
    try {
      await load()
      await callback()
      await page.screenshot({ path: path.join(output, `${device.id}-${id}.png`) })
      results.push({ device: device.id, id, ok: true })
    } catch (error) {
      const snapshot = await page.evaluate(() => ({ menu: window.__doubleUi.menu, slot: window.__doubleUi.commandSlot, actions: window.__doubleUi.queuedActions,
        turn: window.__doubleUi.state.turn, activeIndexes: window.__doubleUi.state.player.activeIndexes })).catch(() => null)
      results.push({ device: device.id, id, ok: false, error: error.stack, snapshot })
      await page.screenshot({ path: path.join(output, `${device.id}-${id}-failure.png`) }).catch(() => {})
      console.error(device.id, id, error.message)
    }
    await fs.writeFile(path.join(output, process.env.DOUBLE_COMMAND_UI_CASES ? 'results-filtered.json' : 'results.json'), JSON.stringify({ results, errors }, null, 2))
  }
  await check('first-slot-switch-then-partner-move', async () => {
    await firstSwitchQueued(); await move()
    const after = await settled()
    assert.deepEqual(after.player.activeIndexes, [2, 1])
    assert.equal(after.player.team[1].moves[0].currentPp, initial.player.team[1].moves[0].currentPp - 1)
    for (const index of [0, 2, 3]) assert.deepEqual(pp(after)[index], pp(initial)[index])
    assert(after.opponent.team[0].hp < initial.opponent.team[0].hp)
  })
  await check('second-slot-switch-after-partner-move', async () => {
    await begin(); await move()
    assert.equal(await page.evaluate(() => window.__doubleUi.commandSlot), 1)
    await reserve(3)
    const after = await settled()
    assert.deepEqual(after.player.activeIndexes, [0, 3])
    assert.equal(after.player.team[0].moves[0].currentPp, initial.player.team[0].moves[0].currentPp - 1)
    for (const index of [1, 2, 3]) assert.deepEqual(pp(after)[index], pp(initial)[index])
  })
  await check('simultaneous-switch-reservations', async () => {
    await firstSwitchQueued(); await openParty()
    const reserved = page.locator('.battle-party-menu-grid button').nth(2)
    assert.equal(await reserved.isDisabled(), true, 'The partner cannot reserve the same bench Pokemon')
    assert.match(await reserved.innerText(), /교대 예약/)
    await reserved.evaluate(button => button.click())
    assert.equal(await page.evaluate(() => window.__doubleUi.queuedActions.length), 1)
    await activate(page.locator('.battle-party-menu-grid button').nth(3))
    const after = await settled()
    assert.deepEqual(after.player.activeIndexes, [2, 3])
    assert.deepEqual(pp(after), pp(initial), 'Neither replacement receives an extra attack on the switching turn')
  })
  await check('cancel-reservations-without-consuming-turn', async () => {
    await firstSwitchQueued(); await openParty()
    await activate(page.locator('.battle-party-menu header button'))
    const snapshot = await page.evaluate(() => ({menu:window.__doubleUi.menu,actions:window.__doubleUi.queuedActions,state:window.__doubleUi.state}))
    assert.equal(snapshot.menu, 'command')
    assert.deepEqual(snapshot.actions, [])
    assert.deepEqual(snapshot.state.player.activeIndexes, [0, 1])
    assert.deepEqual(pp(snapshot.state), pp(initial))
    assert.equal(snapshot.state.turn, initial.turn)
    await begin()
    assert.equal(await page.evaluate(() => window.__doubleUi.commandSlot), 0)
    await move(); await move()
    const after = await settled()
    assert.deepEqual(after.player.activeIndexes, [0, 1], 'A cancelled reservation cannot execute later')
  })
  await check('duplicate-bench-click-does-not-double-submit', async () => {
    await begin(); await openParty()
    await page.locator('.battle-party-menu-grid button').nth(2).evaluate(button => { button.click(); button.click() })
    assert.equal(await page.evaluate(() => window.__doubleUi.commandSlot), 1)
    assert.equal(await page.evaluate(() => window.__doubleUi.queuedActions.length), 1)
    await move(); const after = await settled()
    assert.deepEqual(after.player.activeIndexes, [2, 1])
    assert.equal(after.player.team[1].moves[0].currentPp, initial.player.team[1].moves[0].currentPp - 1)
  })
  await check('next-turn-commands-use-the-new-field-member', async () => {
    await firstSwitchQueued(); await move(); const first = await settled()
    await begin()
    assert.equal(await page.evaluate(() => window.__doubleUi.commandSlot), 0)
    assert.match(await page.locator('.battle-move-button').first().innerText(), /몸통박치기/)
    await move(); await move(); const second = await settled(first)
    assert.deepEqual(second.player.activeIndexes, [2, 1])
    assert.equal(second.player.team[2].moves[0].currentPp, initial.player.team[2].moves[0].currentPp - 1)
    assert.equal(second.player.team[1].moves[0].currentPp, initial.player.team[1].moves[0].currentPp - 2)
  })
  await check('focus-fire-retargets-after-first-enemy-faints', async () => {
    await load(focusFire); await begin(); await move(0); await move(0)
    const after = await settled(focusFire)
    assert.equal(after.opponent.team[0].hp, 0)
    assert(after.opponent.team[1].hp < focusFire.opponent.team[1].hp, 'The second queued attack must reach the other living enemy')
    for (const index of [0, 1]) assert.equal(after.player.team[index].moves[0].currentPp, focusFire.player.team[index].moves[0].currentPp - 1)
  })
  await check('settings-has-no-bug-report-entry', async () => {
    await activate(page.getByRole('button', { name: '검증 설정 열기' }))
    assert.equal(await page.getByRole('tab', { name: /버그/ }).count(), 0)
    assert.equal(await page.locator('#settings-bug-report-tab, #settings-bug-report-panel').count(), 0)
    assert.deepEqual(await page.getByRole('tab').allTextContents(), [' 게임', ' 오디오', ' 업적', ' 계정'])
    await page.getByRole('tab', { name: '게임', exact: true }).focus()
    for (const id of ['audio', 'achievements', 'account', 'game']) {
      await page.keyboard.press('ArrowRight')
      assert.equal(await page.locator('[role="tab"][aria-selected="true"]').getAttribute('id'), `settings-${id}-tab`)
    }
    await activate(page.getByRole('button', { name: '설정 닫기', exact: true }))
    assert.equal(await page.evaluate(() => window.__doubleUi.state.turn), initial.turn)
  })
  await context.close()
  }
  assert.deepEqual(errors, [])
  assert(results.length > 0 && results.every(result => result.ok), `${results.filter(result => !result.ok).length} double command UI cases failed; see ${output}`)
  console.log(JSON.stringify({ ok: true, cases: results.length, output }))
} finally {
  await browser?.close()
  await server.close()
}
