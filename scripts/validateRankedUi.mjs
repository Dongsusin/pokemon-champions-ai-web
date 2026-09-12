import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { createRankedClient, isRankedLocalTest } from '../src/rankedClient.js'
import { createRankedBattle, getRankedBattleView, getRankedTimelineView, resolveRankedTurn } from '../server/rankedBattle.js'
import { normalizePokemon, getMoveById, getLearnableMoves } from '../src/data/trainingData.js'
import { resolveChromiumExecutable } from '../promo/scripts/browserRuntime.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const output = path.join(root, 'scripts/.cache/ranked-ui')
await fs.mkdir(output, { recursive: true })
const checks = []
async function test(name, run) {
  if (process.env.RANKED_UI_CASES && !name.includes(process.env.RANKED_UI_CASES)) return
  try { await run(); checks.push({ name, passed: true }); console.log(`PASS ${name}`) }
  catch (error) { checks.push({ name, passed: false, error: error.message }); console.error(`FAIL ${name}: ${error.message}`) }
}
await test('client keeps local test tokens unavailable outside explicit browser test mode', async () => {
  assert.equal(isRankedLocalTest, false)
  assert.throws(() => createRankedClient({ localTestIdentity: 'alice' }), /로컬 테스트/)
  assert.throws(() => createRankedClient({ apiUrl: 'https://user:pass@example.invalid' }), /주소/)
})
await test('client uses fresh credentials, read-only status and stable mutation request ID', async () => {
  let token = 0
  const calls = []
  const client = createRankedClient({ apiUrl: 'https://fixture.invalid/api/ranked', getIdToken: async () => `fixture-${++token}`,
    fetchImpl: async (url, options) => { calls.push({ url, ...options }); return Response.json({ profile: {}, queue: null, match: null }) } })
  await client.status({ matchId: 'known', timelineRevision: 2 })
  await client.request('submit', { matchId: 'known', revision: 2, actions: [{ type: 'move', moveIndex: 0 }] }, { requestId: 'same-retry-id' })
  assert.equal(calls[0].method, 'GET')
  assert(new URL(calls[0].url).searchParams.get('matchId') === 'known')
  assert.equal(new URL(calls[0].url).searchParams.get('timelineRevision'), '2')
  assert.equal(calls[1].headers.Authorization, 'Bearer fixture-2')
  assert.equal(JSON.parse(calls[1].body).requestId, 'same-retry-id')
  assert.equal(calls[1].redirect, 'error')
})
await test('client shows structured server errors and never sends without authentication', async () => {
  let calls = 0
  const unauthenticated = createRankedClient({ fetchImpl: async () => { calls++ } })
  await assert.rejects(unauthenticated.status(), /로그인/)
  assert.equal(calls, 0)
  const denied = createRankedClient({ getIdToken: async () => 'fixture', fetchImpl: async () => Response.json({ error: { code: 'STALE_REVISION', message: '이전 턴의 요청입니다.' } }, { status: 409 }) })
  await assert.rejects(denied.request('submit'), error => error.status === 409 && error.code === 'STALE_REVISION')
})

function mon(speciesId, ids) {
  const learnable = new Set(getLearnableMoves(speciesId).map(move => move.id))
  ids.forEach(id => assert(learnable.has(id), `${speciesId} cannot learn ${id}`))
  return normalizePokemon({ speciesId, captureId: `ui-${speciesId}`, moves: ids.map(id => getMoveById(id).name) })
}
const playerTeam = [mon(25, ['thunderbolt', 'voltswitch', 'protect']), mon(6, ['flamethrower', 'protect']), mon(9, ['surf', 'protect']), mon(3, ['energyball', 'protect'])]
const opponentTeam = [mon(143, ['tackle', 'protect']), mon(68, ['protect']), mon(131, ['protect']), mon(94, ['protect'])]
const make = format => createRankedBattle({ playerTeam: playerTeam.slice(0, format === 'single' ? 3 : 4), opponentTeam: opponentTeam.slice(0, format === 'single' ? 3 : 4), format, playerName: 'Alice', opponentName: 'Bob' })
const single = make('single'), double = make('double')
const commander = createRankedBattle({ format: 'double',
  playerTeam: [mon(977, ['protect']), { ...mon(978, ['protect']), ability: '사령탑' }, playerTeam[1], playerTeam[2]], opponentTeam })
assert(commander.player.team[1].commanding)
const action = (state, side, id, actorSlot = 0) => ({ type: 'move', actorSlot, moveIndex: state[side].team[state[side].activeIndexes[actorSlot]].moves.findIndex(move => move.id === id), targetSlot: id === 'protect' ? actorSlot : 0, targetSideId: id === 'protect' ? side : side === 'player' ? 'opponent' : 'player' })
const pending = resolveRankedTurn(single, { player: [action(single, 'player', 'voltswitch')], opponent: [action(single, 'opponent', 'tackle')] }, () => .5)
assert(pending.state.pendingHumanSwitch)
const resolved = resolveRankedTurn(single, { player: [action(single, 'player', 'thunderbolt')], opponent: [action(single, 'opponent', 'tackle')] }, () => .5)
const fixtures = {
  single: getRankedBattleView(single, 'player'), double: getRankedBattleView(double, 'player'),
  commander: getRankedBattleView(commander, 'player'),
  pending: getRankedBattleView(pending.state, 'player'), pendingTimeline: getRankedTimelineView(pending.timeline, 'player'),
  resolved: getRankedBattleView(resolved.state, 'player'), resolvedTimeline: getRankedTimelineView(resolved.timeline, 'player'),
}
const styles = ['styles', 'screenRedesign', 'battleGen5', 'titleCleanup', 'battleGimmicks', 'moveAnimationDirector', 'mobileLandscape', 'ranked']
const entry = `import React,{StrictMode,useState} from 'react';import {createRoot} from 'react-dom/client';import BattleScreen from '/src/BattleScreen.jsx';
${styles.map(name => `import '/src/${name}.css';`).join('\n')}
const fixture=window.__fixture;window.__events={submits:[],replaces:[],played:[],forfeits:0};
function Harness(){const [version,setVersion]=useState(0);const [online,setOnline]=useState({state:fixture.pending,timeline:fixture.pendingTimeline,revision:3,timelineRevision:3,canAct:true});
window.__rankedHarness={load:(value,remount=true)=>{setOnline(value);if(remount)setVersion(v=>v+1)},poll:()=>setOnline(value=>({...value,state:structuredClone(value.state)}))};
return React.createElement('div',{className:'app-shell battle-view'},React.createElement('div',{className:'ranked-live-battle'},React.createElement(BattleScreen,{key:version,
opponent:{name:'Bob'},playerPokemon:online.state.player.team,opponentTeam:{pokemon:online.state.opponent.team},rules:online.state.rules,soundEnabled:false,gameSettings:{attackAnimation:'skip',hpBarSpeed:'instant'},
online:{...online,onSubmit:async actions=>{window.__events.submits.push(actions);setOnline(value=>({...value,canAct:false}))},onReplace:async index=>{window.__events.replaces.push(index);setOnline(value=>({...value,canAct:false}))},onForfeit:()=>window.__events.forfeits++,onPlaybackComplete:revision=>window.__events.played.push(revision)}})))}
createRoot(document.getElementById('root')).render(React.createElement(StrictMode,null,React.createElement(Harness)));`
const port = Number(process.env.RANKED_UI_PORT ?? 5221)
const server = await createServer({ root, plugins: [{ name: 'ranked-ui-entry', resolveId: id => id === '/ranked-ui-entry.js' ? id : undefined, load: id => id === '/ranked-ui-entry.js' ? entry : undefined }], server: { host: '127.0.0.1', port, strictPort: true, hmr: false }, logLevel: 'error' })
await server.listen()
const require = createRequire(new URL('../promo/package.json', import.meta.url))
const { chromium } = require('playwright')
let browser
const errors = []
try {
  browser = await chromium.launch({ executablePath: await resolveChromiumExecutable(chromium), headless: true })
  const html = await server.transformIndexHtml('/ranked-ui.html', '<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body><div id="root"></div><script type="module" src="/ranked-ui-entry.js"></script></body></html>')
  for (const device of [{ id: 'desktop', viewport: { width: 1440, height: 900 } }, { id: 'mobile', viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true }]) {
    const context = await browser.newContext(device)
    await context.addInitScript(value => { window.__fixture = value }, fixtures)
    const page = await context.newPage()
    page.setDefaultTimeout(15_000)
    page.on('pageerror', error => errors.push({ device: device.id, message: error.message }))
    await context.route('**/ranked-ui.html', route => route.fulfill({ contentType: 'text/html', body: html }))
    await context.route('**/src/BattleScreen.jsx', async route => {
      const response = await route.fetch()
      const body = (await response.text()).replace('const currentLogEntry =', 'window.__rankedObserved={battle,menu,isTurnAnimating,commandSlot}; const currentLogEntry =')
      await route.fulfill({ response, body })
    })
    await page.goto(`http://127.0.0.1:${port}/ranked-ui.html`)
    const click = locator => device.hasTouch ? locator.tap() : locator.click()
    const waitIdle = () => page.waitForFunction(() => window.__rankedObserved && !window.__rankedObserved.isTurnAnimating)
    const load = async (state, revision = 1) => {
      await page.evaluate(({ state, revision }) => { window.__events={submits:[],replaces:[],played:[],forfeits:0}; window.__rankedHarness.load({ state, revision, timelineRevision: revision, timeline: [], canAct: true }) }, { state, revision })
      await waitIdle()
    }
    await test(`${device.id}: StrictMode reconnect replays a pending pivot once then accepts a server replacement`, async () => {
      await page.locator('.battle-party-menu').waitFor()
      await waitIdle()
      const allowed = fixtures.pending.replacementIndexes[0]
      await click(page.locator('.battle-party-menu-grid button').nth(allowed))
      await page.waitForFunction(() => window.__events.replaces.length === 1)
      assert.deepEqual(await page.evaluate(() => window.__events.replaces), [allowed])
      assert.deepEqual(await page.evaluate(() => window.__rankedObserved.battle.player.activeIndexes), fixtures.pending.player.activeIndexes)
      assert.deepEqual(await page.evaluate(() => window.__events.played), [3])
    })
    await test(`${device.id}: move submission waits for server without local AI, HP or PP changes`, async () => {
      await load(fixtures.single)
      await click(page.locator('.battle-command-buttons .fight'))
      await click(page.locator('.battle-move-button').filter({ hasText: '10만볼트' }))
      await page.waitForFunction(() => window.__events.submits.length === 1)
      await page.waitForTimeout(400)
      const observed = await page.evaluate(() => ({ state:window.__rankedObserved.battle, actions:window.__events.submits }))
      assert.equal(observed.state.turn, fixtures.single.turn)
      assert.deepEqual(observed.state.player.team.map(mon => [mon.hp, mon.moves.map(move => move.currentPp)]), fixtures.single.player.team.map(mon => [mon.hp, mon.moves.map(move => move.currentPp)]))
      assert.equal(observed.actions[0][0].moveIndex, action(single, 'player', 'thunderbolt').moveIndex)
      assert(await page.locator('.battle-command-buttons .fight').isDisabled())
    })
    await test(`${device.id}: authoritative timeline applies once and same-revision polls preserve selection`, async () => {
      const before = await page.evaluate(() => window.__events.played.length)
      await page.evaluate(value => window.__rankedHarness.load(value, false), { state:fixtures.resolved,timeline:fixtures.resolvedTimeline,revision:2,timelineRevision:2,canAct:true })
      await page.waitForFunction(() => window.__rankedObserved.isTurnAnimating)
      await page.evaluate(() => window.__rankedHarness.poll())
      await waitIdle()
      assert.equal(await page.evaluate(() => window.__events.played.length), before + 1)
      assert.equal(await page.evaluate(() => window.__rankedObserved.battle.opponent.team[0].hp), fixtures.resolved.opponent.team[0].hp)
      await click(page.locator('.battle-command-buttons .fight'))
      await page.evaluate(() => window.__rankedHarness.poll())
      await page.waitForTimeout(100)
      assert.equal(await page.evaluate(() => window.__rankedObserved.menu), 'fight')
      assert.equal(await page.evaluate(() => window.__events.played.length), before + 1)
    })
    await test(`${device.id}: doubles queue a voluntary switch and second human command in one submission`, async () => {
      await load(fixtures.double, 4)
      await click(page.locator('.battle-command-buttons .fight'))
      await click(page.locator('.battle-slot-switch-button'))
      await click(page.locator('.battle-party-menu-grid button').nth(2))
      assert.equal(await page.evaluate(() => window.__rankedObserved.commandSlot), 1)
      assert.equal(await page.evaluate(() => window.__events.submits.length), 0)
      await click(page.locator('.battle-move-button').filter({ hasText: '화염방사' }))
      await click(page.locator('.battle-target-grid button').filter({ hasText: '상대 01' }))
      await page.waitForFunction(() => window.__events.submits.length === 1)
      const actions = await page.evaluate(() => window.__events.submits[0])
      assert.equal(actions.length, 2)
      assert.equal(actions[0].type, 'switch')
      assert.equal(actions[0].targetIndex, 2)
      assert.equal(actions[1].actorSlot, 1)
      assert.equal(actions[1].targetSideId, 'opponent')
      assert.deepEqual(await page.evaluate(() => window.__rankedObserved.battle.player.activeIndexes), fixtures.double.player.activeIndexes)
    })
    await test(`${device.id}: forfeit is sent upstream and never settles a local AI reward`, async () => {
      await load(fixtures.single, 5)
      await click(page.locator('.battle-command-buttons .surrender'))
      assert.equal(await page.evaluate(() => window.__events.forfeits), 1)
      assert.equal(await page.locator('.battle-result-overlay').count(), 0)
      await page.screenshot({ path: path.join(output, `${device.id}.png`) })
    })
    await test(`${device.id}: Commander sends only the acting human Pokemon command`, async () => {
      await load(fixtures.commander, 6)
      await click(page.locator('.battle-command-buttons .fight'))
      await click(page.locator('.battle-move-button').filter({ hasText: '방어' }))
      await page.waitForFunction(() => window.__events.submits.length === 1, undefined, { timeout: 2500 })
      const submitted = await page.evaluate(() => window.__events.submits[0])
      assert.equal(submitted.length, 1)
      assert.equal(submitted[0].actorSlot, 0)
    })
    await context.close()
  }
} finally {
  await browser?.close()
  await server.close()
  await fs.writeFile(path.join(output, process.env.RANKED_UI_CASES ? 'results-filtered.json' : 'results.json'), JSON.stringify({ checks, errors }, null, 2))
}
assert.equal(errors.length, 0, JSON.stringify(errors))
assert(checks.every(check => check.passed), 'Ranked UI regression failed')
console.log(`${checks.length}/${checks.length} passed; browser errors ${errors.length}`)
