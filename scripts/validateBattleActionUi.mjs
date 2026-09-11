import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import {
  createBattle,
  getActivePokemon,
  getBattleMoveTargets,
  getBattleStruggleAction,
  getForcedBattleAction,
  playBattleTurnWithActions,
} from '../src/data/battleEngine.js'
import { canPokemonLearnMove, getMoveById } from '../src/data/trainingData.js'
import { TRAINERS } from '../src/data/trainerTeams.js'
import { resolveChromiumExecutable } from '../promo/scripts/browserRuntime.mjs'

// A fresh, local BattleScreen per scenario. State injection and observation exist
// only in intercepted HTTP test responses, never in the production component.
const require = createRequire(new URL('../promo/package.json', import.meta.url))
const { chromium } = require(process.env.BATTLE_ACTION_PLAYWRIGHT_MODULE || process.env.ACHIEVEMENT_PLAYWRIGHT_MODULE || 'playwright')
const root = fileURLToPath(new URL('../', import.meta.url))
const output = path.join(root, 'scripts/.cache/battle-action-ui')
await fs.mkdir(output, { recursive: true })
const styles = ['styles', 'screenRedesign', 'battleGen5', 'titleCleanup', 'battleGimmicks', 'moveAnimationDirector', 'settings', 'auth', 'mobileLandscape']
const entry = `
import '/src/mobileViewport.js';
import React from 'react';
import {createRoot} from 'react-dom/client';
import BattleScreen from '/src/BattleScreen.jsx';
${styles.map(name => `import '/src/${name}.css';`).join('\n')}
function Harness() {
  const [fixture,setFixture]=React.useState(null);
  window.__mountActionFixture=setFixture;
  return fixture ? React.createElement('div',{className:'app-shell battle-view'},
    React.createElement(BattleScreen,{...fixture,key:fixture.id,soundEnabled:false,
      gameSettings:{attackAnimation:'skip',hpBarSpeed:'instant'},onComplete:()=>{}})) : null;
}
createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement(Harness)));
`

function pokemon(speciesId, moveIds, captureId, ability) {
  for (const moveId of moveIds) {
    const move = getMoveById(moveId)
    assert(move, `Missing real move ${moveId}`)
    assert(canPokemonLearnMove(speciesId, move.name), `${speciesId} cannot legally learn ${moveId}`)
  }
  return { speciesId, moveIds, captureId, ...(ability ? { ability } : {}) }
}

function fixture(id, format, playerPokemon, opponentPokemon) {
  const activeSlots = format === 'double' ? 2 : 1
  const props = {
    id, competitionLabel: '배틀 행동 회귀 검증', playerPokemon,
    opponent: TRAINERS[0],
    opponentTeam: { pokemon: opponentPokemon, battleGimmicks: [], strategy: {} },
    rules: {
      weather: { id: 'clear', label: '맑음' }, terrain: { id: 'neutral', label: '일반 필드' },
      format: { id: format, label: format === 'double' ? '더블배틀' : '싱글배틀', activeSlots, actionSlots: activeSlots },
      teamRule: { id: 'full', label: '풀 배틀', battleSize: playerPokemon.length },
      aiDifficulty: { id: 'normal' },
    },
  }
  const state = createBattle(props)
  for (const side of [state.player, state.opponent]) {
    for (const member of side.team) {
      assert(member.moves.every(move => canPokemonLearnMove(member.speciesId, move.name)), 'Normalized fixture moves must remain legal')
    }
  }
  return { props, state }
}

const magikarp = () => pokemon(129, ['splash', 'tackle', 'hydropump', 'bounce'], 'action-magikarp')
const eevee = () => pokemon(133, ['tackle', 'growl', 'tailwhip', 'helpinghand'], 'action-eevee')
// All opponent moves are legal status moves, so HP loss in the Struggle cases
// can be attributed to the actual Struggle recoil rather than an enemy attack.
const wailmer = () => pokemon(320, ['splash', 'growl', 'rest', 'amnesia'], 'action-wailmer')
const wobbuffet = () => pokemon(202, ['encore', 'splash', 'safeguard', 'destinybond'], 'action-wobbuffet', '텔레파시')

function encoreFixture() {
  const result = fixture('encore', 'single', [magikarp(), eevee()], [wobbuffet()])
  result.state = playBattleTurnWithActions(result.state,
    [{ type: 'move', actorSlot: 0, moveIndex: 0 }],
    [{ type: 'move', actorSlot: 0, moveIndex: 0, targetSlot: 0 }], () => 0.5)
  const active = getActivePokemon(result.state, 'player')
  assert.equal(active.lastMoveId, 'splash')
  assert(active.encoreTurns > 0, 'The real Encore move must establish the tested restriction')
  assert.equal(active.encoredMoveIndex, 0)
  assert.equal(getForcedBattleAction(result.state, 'player'), null, 'Encore must not become a forced turn')
  return result
}

function exhaustedFixture(double = false) {
  const result = fixture(double ? 'double-struggle' : 'single-struggle', double ? 'double' : 'single',
    double ? [eevee(), magikarp()] : [eevee()], double ? [wailmer(), wobbuffet()] : [wailmer()])
  // A normal, reachable PP-depleted state. Preserve the actual move metadata,
  // learnsets and PP maxima instead of inventing a synthetic Struggle move.
  for (const move of result.state.player.team[0].moves) move.currentPp = 0
  assert.equal(getBattleStruggleAction(result.state, 'player')?.moveIndex, -1)
  assert.equal(getMoveById('struggle').target, 'randomNormal')
  assert.deepEqual(getBattleMoveTargets(result.state, 'player', -1), [], 'Struggle chooses a random opponent during execution')
  return result
}

const fixtures = { encore: encoreFixture(), single: exhaustedFixture(), double: exhaustedFixture(true) }
const server = await createServer({ root,
  plugins: [{ name: 'battle-action-ui-entry',
    resolveId: id => id === '/battle-action-ui-entry.js' ? id : undefined,
    load: id => id === '/battle-action-ui-entry.js' ? entry : undefined,
  }], server: { host: '127.0.0.1', port: 5199, strictPort: true, hmr: false }, logLevel: 'error',
})
await server.listen()
const html = await server.transformIndexHtml('/battle-action-ui.html', '<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/battle-action-ui-entry.js"></script></body></html>')
const results = []
let browser

async function install(context) {
  await context.route('**/battle-action-ui.html', route => route.fulfill({ contentType: 'text/html', body: html }))
  await context.route('**/src/BattleScreen.jsx', async route => {
    const response = await route.fetch()
    const source = await response.text()
    assert(source.includes('const currentLogEntry ='), 'BattleScreen observation anchor changed')
    const body = source.replace('const currentLogEntry =', `window.__battleActionQA={battle,menu,commandSlot,queuedActions,isTurnAnimating,
      seed:value=>{setBattle(value);setIntroVisible(false);setTrainerDialogue(null);setMenu('command')}
    }; const currentLogEntry =`)
    await route.fulfill({ response, body })
  })
  await context.addInitScript(() => { Math.random = () => 0.5 })
}

async function load(page, chosen) {
  await page.goto('http://127.0.0.1:5199/battle-action-ui.html', { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => Boolean(window.__mountActionFixture))
  await page.evaluate(value => window.__mountActionFixture(value), chosen.props)
  await page.waitForFunction(() => Boolean(window.__battleActionQA))
  await page.evaluate(value => window.__battleActionQA.seed(value), chosen.state)
  await page.locator('.battle-intro-overlay').waitFor({ state: 'detached' })
  await page.waitForFunction(() => !document.querySelector('button.fight')?.disabled)
}

const stateOf = page => page.evaluate(() => window.__battleActionQA.battle)
const use = (locator, mobile) => mobile ? locator.tap() : locator.click()
const moveButton = (page, moveId) => page.locator('.battle-move-button').filter({ has: page.locator('strong').filter({ hasText: new RegExp(`^${getMoveById(moveId).name}$`) }) })
async function finishTurn(page, previousTurn) {
  await page.waitForFunction(turn => window.__battleActionQA.battle.turn === turn + 1 && !window.__battleActionQA.isTurnAnimating, previousTurn, { timeout: 20000 })
  const state = await stateOf(page)
  assert.equal(state.turn, previousTurn + 1, 'A single submitted command set must advance exactly one turn')
  assert.equal(state.winner, null, 'The fixture must remain a live battle')
  assert([...state.player.team, ...state.opponent.team].every(member => member.moves.every(move => move.currentPp >= 0)), 'No stored move PP may become negative')
  return state
}

async function visibleStruggle(page) {
  const button = moveButton(page, 'struggle')
  assert(await button.isEnabled(), 'Struggle must be enabled when all moves are unusable')
  assert.equal(await page.locator('.battle-move-button').count(), 1, 'The menu must offer Struggle instead of four dead PP buttons')
  assert.equal((await button.locator('.battle-move-pp strong').innerText()).trim(), '—')
  const bounds = await button.evaluate(element => {
    const r = element.getBoundingClientRect()
    return { x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height,viewportWidth:innerWidth,viewportHeight:innerHeight }
  })
  assert(bounds.width > 20 && bounds.height > 20 && bounds.x >= -1 && bounds.y >= -1 && bounds.right <= bounds.viewportWidth + 1 && bounds.bottom <= bounds.viewportHeight + 1,
    `Struggle button must stay inside the visible landscape viewport: ${JSON.stringify(bounds)}`)
  return { button, bounds }
}

async function check(name, mobile, chosen, run) {
  const context = await browser.newContext({ viewport: mobile ? { width:844,height:390 } : { width:1440,height:900 }, ...(mobile ? {isMobile:true,hasTouch:true} : {}) })
  const errors = []
  let page
  try {
    await install(context)
    page = await context.newPage()
    page.setDefaultTimeout(15000)
    page.on('pageerror', error => errors.push(error.message))
    await load(page, chosen)
    const details = await run(page, mobile)
    assert.deepEqual(errors, [], 'Battle actions must not produce browser runtime errors')
    await page.screenshot({ path:path.join(output, `${name}-complete.png`) })
    results.push({ name, passed:true, details, pageErrors:errors })
    console.log(`PASS ${name}`)
  } catch (error) {
    await page?.screenshot({ path:path.join(output, `${name}-failure.png`) }).catch(() => {})
    results.push({ name, passed:false, error:String(error.stack), pageErrors:errors })
    console.error(`FAIL ${name}: ${error.message}`)
  } finally {
    await fs.writeFile(path.join(output, 'results.json'), `${JSON.stringify(results, null, 2)}\n`)
    await context.close()
  }
}

try {
  browser = await chromium.launch({ executablePath:await resolveChromiumExecutable(chromium), headless:true })
  await check('encore-allowed-move', false, fixtures.encore, async page => {
    const before = await stateOf(page)
    // Longer than the old 320 ms forced-turn timer; commands must remain manual.
    await page.waitForTimeout(650)
    assert.equal((await stateOf(page)).turn, before.turn)
    assert.equal(await page.evaluate(() => window.__battleActionQA.isTurnAnimating), false)
    await page.locator('button.fight').click()
    const allowed = moveButton(page, 'splash')
    assert(await allowed.isEnabled())
    for (const move of before.player.team[0].moves.filter(move => move.id !== 'splash')) {
      const blocked = moveButton(page, move.id)
      assert(await blocked.isDisabled(), `${move.name} must be blocked by Encore`)
      assert.match(await blocked.getAttribute('aria-label'), /앵콜로 같은 기술만 사용할 수 있습니다/)
      assert.match(await blocked.getAttribute('title'), /앵콜/)
    }
    assert(await page.locator('.battle-slot-switch-button').isEnabled(), 'Encore must leave the switch action available')
    await page.screenshot({ path:path.join(output,'encore-disabled-reasons.png') })
    await allowed.click()
    const after = await finishTurn(page, before.turn)
    assert.equal(after.player.team[0].lastMoveId, 'splash')
    assert.equal(after.player.team[0].moves[0].currentPp, before.player.team[0].moves[0].currentPp - 1)
    assert.deepEqual(after.player.team[0].moves.slice(1).map(move => move.currentPp), before.player.team[0].moves.slice(1).map(move => move.currentPp))
    assert(after.log.slice(before.log.length).some(entry => /잉어킹의 튀어오르기/.test(entry.message)))
    return { beforeTurn:before.turn, afterTurn:after.turn, disabledMoves:before.player.team[0].moves.length - 1 }
  })

  await check('encore-manual-switch', false, fixtures.encore, async page => {
    const before = await stateOf(page)
    await page.waitForTimeout(650)
    assert.equal((await stateOf(page)).turn, before.turn)
    await page.locator('button.fight').click()
    await page.locator('.battle-slot-switch-button').click()
    await page.locator('.battle-party-menu-grid button').filter({hasText:'이브이'}).click()
    const after = await finishTurn(page, before.turn)
    assert.equal(getActivePokemon(after,'player').speciesId, 133)
    assert.equal(after.player.team[0].encoreTurns, 0, 'Switching clears the outgoing Pokemon Encore restriction')
    assert.deepEqual(after.player.team[0].moves.map(move => move.currentPp), before.player.team[0].moves.map(move => move.currentPp))
    return { beforeTurn:before.turn, afterTurn:after.turn, activeSpeciesId:getActivePokemon(after,'player').speciesId }
  })

  for (const mobile of [false, true]) {
    const viewport = mobile ? 'touch-844x390' : 'desktop-1440x900'
    await check(`single-struggle-${viewport}`, mobile, fixtures.single, async (page,touch) => {
      const before = await stateOf(page)
      await use(page.locator('button.fight'),touch)
      const {button,bounds} = await visibleStruggle(page)
      await page.screenshot({path:path.join(output,`single-struggle-${viewport}-button.png`)})
      await use(button,touch)
      const after = await finishTurn(page,before.turn)
      const expectedRecoil = Math.floor(before.player.team[0].originalMaxHp / 4 + 0.5)
      assert.equal(after.player.team[0].lastMoveId,'struggle')
      assert.equal(before.player.team[0].hp-after.player.team[0].hp,expectedRecoil)
      assert(after.opponent.team[0].hp < before.opponent.team[0].hp, 'Struggle must damage the opponent')
      assert(after.player.team[0].moves.every(move=>move.currentPp===0))
      assert(after.log.slice(before.log.length).some(entry=>entry.message.includes('발버둥의 반동')))
      return { beforeTurn:before.turn,afterTurn:after.turn,recoil:expectedRecoil,bounds }
    })

    await check(`double-struggle-${viewport}`, mobile, fixtures.double, async (page,touch) => {
      const before = await stateOf(page)
      await use(page.locator('button.fight'),touch)
      const {button,bounds} = await visibleStruggle(page)
      await use(button,touch)
      await page.waitForFunction(()=>window.__battleActionQA.commandSlot===1 && window.__battleActionQA.menu==='fight')
      assert.equal((await stateOf(page)).turn,before.turn,'Struggle waits for the second active Pokemon command')
      assert.equal(await page.locator('.battle-target-menu').count(),0,'randomNormal Struggle must not request a manual target')
      assert.deepEqual(await page.evaluate(()=>window.__battleActionQA.queuedActions.map(({moveIndex,actorSlot})=>({moveIndex,actorSlot}))),[{moveIndex:-1,actorSlot:0}])
      await use(moveButton(page,'tackle'),touch)
      await page.locator('.battle-target-menu').waitFor({state:'visible'})
      await use(page.getByRole('button',{name:'상대 고래왕자을 기술 대상으로 선택',exact:true}),touch)
      const after = await finishTurn(page,before.turn)
      assert.equal(after.player.team[0].lastMoveId,'struggle')
      assert.equal(after.player.team[1].lastMoveId,'tackle')
      assert(after.player.team[0].moves.every(move=>move.currentPp===0))
      const beforeTackle=before.player.team[1].moves.find(move=>move.id==='tackle')
      assert.equal(after.player.team[1].moves.find(move=>move.id==='tackle').currentPp,beforeTackle.currentPp-1)
      const expectedRecoil=Math.floor(before.player.team[0].originalMaxHp/4+0.5)
      assert.equal(before.player.team[0].hp-after.player.team[0].hp,expectedRecoil)
      const log=after.log.slice(before.log.length).map(entry=>entry.message).join('\n')
      assert.match(log,/이브이의 발버둥/)
      assert.match(log,/잉어킹의 몸통박치기/)
      return { beforeTurn:before.turn,afterTurn:after.turn,recoil:expectedRecoil,bounds,secondMove:'tackle' }
    })
  }
} finally {
  await browser?.close()
  await server.close()
}
const failures=results.filter(result=>!result.passed)
console.log(`Battle action UI: ${results.length-failures.length} passed, ${failures.length} failed. Evidence: ${output}`)
if(failures.length) process.exitCode=1
