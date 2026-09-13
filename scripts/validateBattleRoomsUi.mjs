import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { createMemoryRankedStore } from '../server/rankedStore.js'
import { createRankedProfile } from '../src/data/rankedRules.js'
import { normalizePokemon } from '../src/data/trainingData.js'
import { createSavedTeams } from '../src/data/teamData.js'
import { startRankedDevServer, createRankedTestTeams } from './rankedDevServer.mjs'
import { resolveChromiumExecutable } from '../promo/scripts/browserRuntime.mjs'

// The production room UI and client talk to the production HTTP/service/battle
// engine on loopback, with four explicitly isolated local identities and an
// ephemeral memory store. No response stubs, production accounts or remote API.
// One paired turn per format is played normally; later matches deliberately use
// the real forfeit action to keep competition navigation verification bounded.
const root = fileURLToPath(new URL('../', import.meta.url))
const output = path.join(root, 'scripts/.cache/battle-rooms-ui')
await fs.mkdir(output, { recursive: true })
const identities = ['alice', 'bob', 'charlie', 'dave']
const boxPokemon = createRankedTestTeams()[0].pokemon.map(normalizePokemon)
const ids = boxPokemon.map(pokemon => pokemon.captureId)
const teams = createSavedTeams(ids, ids)
teams[1].pokemonIds = ids.slice(0, 5)
const checks = [], browserErrors = [], httpFailures = [], layouts = [], blockedRequests = []
async function check(name, run) {
  try { await run(); checks.push({ name, passed: true }); console.log(`PASS ${name}`) }
  catch (error) { checks.push({ name, passed: false, error: error.message }); console.error(`FAIL ${name}: ${error.message}`); throw error }
}
const styles = ['styles', 'screenRedesign', 'battleGen5', 'titleCleanup', 'battleGimmicks', 'moveAnimationDirector', 'mobileLandscape', 'ranked']
const entry = `import React,{useMemo,useState} from 'react';import{createRoot}from'react-dom/client';
import BattleRoomsScreen from '/src/BattleRoomsScreen.jsx';import BattleHub from '/src/BattleHub.jsx';import{createRankedClient}from'/src/rankedClient.js';import'/src/mobileViewport.js';
${styles.map(name => `import '/src/${name}.css';`).join('\n')}
const fixture=window.__roomsFixture;window.__roomEvents={requests:[],opened:0,saved:0};
function Harness(){const[activeTeamId,setActiveTeamId]=useState('team-1');const[battleActive,setBattleActive]=useState(false);const[inRooms,setInRooms]=useState(!fixture.startAtHub);
const client=useMemo(()=>{const actual=createRankedClient({getIdToken:async()=>'ranked-test-'+fixture.identity,apiUrl:fixture.apiUrl});
const request=async(...args)=>{window.__roomEvents.requests.push({action:args[0],payload:args[1]});const value=await actual.request(...args);window.__lastRoomsSnapshot=value;return value};
const result={request,status:(payload,options)=>request('status',payload,options)};window.__roomsClient=result;return result},[]);
return React.createElement('div',{className:'app-shell'+(inRooms?' rooms-view':'')+(battleActive?' battle-view':'')},
React.createElement('header',{className:'topbar'},React.createElement('div',{className:'brand'},React.createElement('span',{className:'brand-mark'},React.createElement('img',{src:'/assets/brand/champions-arena-emblem.png',alt:''})),React.createElement('strong',null,'CHAMPIONS ARENA · 대전 방'))),
inRooms?React.createElement(BattleRoomsScreen,{user:{uid:'ranked-test-'+fixture.identity,displayName:'로컬 '+fixture.identity},enabled:true,client,
boxPokemon:fixture.boxPokemon,teams:fixture.teams,activeTeamId,onSelectTeam:setActiveTeamId,onOpenBox:()=>window.__roomEvents.opened++,
onBeforeJoin:async()=>{window.__roomEvents.saved++;return true},onBack:()=>setInRooms(false),soundEnabled:false,gameSettings:{attackAnimation:'skip',hpBarSpeed:'instant'},onBattleActiveChange:setBattleActive})
:React.createElement(BattleHub,{onBack:()=>{},onSelectAi:()=>{},onSelectRanked:()=>{},onSelectFactory:()=>{},onSelectRooms:()=>setInRooms(true)}))}
createRoot(document.getElementById('root')).render(React.createElement(Harness));`
const htmlTemplate = '<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body><div id="root"></div><script type="module" src="/battle-rooms-ui-entry.js"></script></body></html>'
const server = await createServer({ root, cacheDir: path.join(output, 'vite'), mode: 'battle-rooms-ui-validation', logLevel: 'error',
  plugins: [{ name: 'battle-rooms-ui-entry', enforce: 'pre',
    configureServer(viteServer) {
      viteServer.middlewares.use(async (request, response, next) => {
        if (new URL(request.url, 'http://localhost').pathname !== '/battle-rooms-ui.html') { next(); return }
        response.setHeader('Content-Type', 'text/html')
        response.end(await viteServer.transformIndexHtml('/battle-rooms-ui.html', htmlTemplate))
      })
    },
    resolveId(source) {
      if (source === '/battle-rooms-ui-entry.js') return source
      if (/\/auth\/firebaseClient(?:\.js)?$/.test(source) || source === './firebaseClient') return '\0battle-rooms-offline-auth'
    },
    load(id) {
      if (id === '/battle-rooms-ui-entry.js') return entry
      if (id === '\0battle-rooms-offline-auth') return 'export const firebaseAuth=null;export const firebaseDb=null;export const isFirebaseConfigured=false;export const missingFirebaseEnvironmentVariables=[];'
    },
  }], server: { host: '127.0.0.1', port: Number(process.env.BATTLE_ROOMS_UI_PORT ?? 5293), strictPort: true, hmr: false } })
await server.listen()
const origin = server.resolvedUrls.local[0].replace(/\/$/, '')
const require = createRequire(new URL('../promo/package.json', import.meta.url))
const { chromium } = require('playwright')

async function openPlayer(browser, api, scenario, identity) {
  const context = await browser.newContext({ viewport: scenario.viewport, hasTouch: Boolean(scenario.mobile), isMobile: Boolean(scenario.mobile) })
  await context.addInitScript(fixture => { window.__roomsFixture = fixture }, { apiUrl: api.url, identity, boxPokemon, teams, startAtHub: identity === 'alice' })
  await context.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
      blockedRequests.push({ scenario: scenario.id, identity, url: url.href }); await route.abort('blockedbyclient'); return
    }
    await route.continue()
  })
  const page = await context.newPage()
  page.setDefaultTimeout(20_000)
  page.on('pageerror', error => { browserErrors.push({ scenario: scenario.id, identity, message: error.message }); console.error(`BROWSER ${identity}: ${error.message}`) })
  page.on('requestfailed', request => { if (request.url().includes('/api/ranked')) console.error(`NETWORK ${identity}: ${request.url()} ${request.failure()?.errorText}`) })
  page.on('console', message => { if (message.type() === 'error' && message.text().includes('/api/ranked')) console.error(`CONSOLE ${identity}: ${message.text()}`) })
  page.on('response', async response => {
    if (response.url().includes('/api/ranked') && response.status() >= 400) {
      httpFailures.push({ scenario: scenario.id, identity, status: response.status(), body: await response.json().catch(() => ({})) })
    }
  })
  await page.goto(`${origin}/battle-rooms-ui.html`)
  return { identity, context, page, click: async locator => {
    if (scenario.mobile) return locator.tap()
    // Moving off a roster tooltip is a normal pointer action; it also avoids a
    // previous screen's mouse position accidentally hovering a newly shown card.
    if (await page.locator('.ranked-pokemon-tooltip').isVisible()) { await page.mouse.move(5, 5); await page.waitForTimeout(180) }
    return locator.click()
  } }
}

async function snapshot(player) { return player.page.evaluate(() => window.__lastRoomsSnapshot) }
async function waitSnapshot(player, predicate) { await player.page.waitForFunction(predicate); return snapshot(player) }
async function request(player, action, payload = {}) {
  return player.page.evaluate(({ action, payload }) => window.__roomsClient.request(action, payload), { action, payload })
}
async function assertFriendlyRecords(store, participantCount, matchCount) {
  const database = await store.inspect()
  assert.equal(Object.keys(database.collections.battleRooms ?? {}).length, 0, 'Completed competition must delete its room')
  const matches = Object.values(database.collections.matches ?? {}).filter(match => match.roomId)
  assert.equal(matches.length, matchCount)
  assert(matches.every(match => match.phase === 'finished'), 'Every scheduled real match must finish')
  for (const identity of identities.slice(0, participantCount)) {
    const player = database.collections.players[`ranked-test-${identity}`]
    assert(player, `Missing local player ${identity}`)
    assert.deepEqual(player.profiles, { single: createRankedProfile('single'), double: createRankedProfile('double') }, 'Friendly competition must not change the ladder')
    assert.equal(player.vpRewardTotal, 0, 'Friendly competition must not issue ranked VP')
    assert.equal(player.activeRoomId, null)
    assert.equal(player.activeMatchId, null)
    assert.equal(player.roomResult?.reason, 'completed')
    assert.equal(player.roomResult.standings.length, participantCount)
  }
}
async function assertViewport(player, label, selectors) {
  const geometry = await player.page.evaluate(selectors => {
    const viewport = { width: innerWidth, height: innerHeight }
    const elements = selectors.flatMap(selector => [...document.querySelectorAll(selector)].filter(element => element.getClientRects().length).map(element => {
      const bounds = element.getBoundingClientRect()
      return { selector, text: element.textContent.trim().slice(0, 60), left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom }
    }))
    return { viewport, scroll: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }, elements }
  }, selectors)
  layouts.push({ label, ...geometry })
  assert(geometry.scroll.width <= geometry.viewport.width + 1, `${label}: document X overflow`)
  assert(geometry.scroll.height <= geometry.viewport.height + 1, `${label}: document Y overflow`)
  for (const bounds of geometry.elements) assert(bounds.left >= -1 && bounds.top >= -1 && bounds.right <= geometry.viewport.width + 1 && bounds.bottom <= geometry.viewport.height + 1, `${label}: clipped ${bounds.selector} ${bounds.text}`)
}

async function runScenario(browser, scenario) {
  const store = createMemoryRankedStore()
  const api = await startRankedDevServer({ port: 0, testAccounts: true, store })
  const players = []
  const title = `${scenario.mobile ? '모바일' : 'PC'} ${scenario.mode === 'league' ? '리그' : '토너먼트'} 검증`
  try {
    for (const identity of identities.slice(0, scenario.participantCount)) players.push(await openPlayer(browser, api, scenario, identity))
    const host = players[0]
    await check(`${scenario.id}: actual four-card battle hub enters rooms within viewport`, async () => {
      assert.equal(await host.page.locator('.battle-hub-card').count(), 4)
      await assertViewport(host, `${scenario.id}-hub`, ['.battle-hub-heading', '.battle-hub-card'])
      await host.page.screenshot({ path: path.join(output, `${scenario.id}-hub.png`) })
      await host.click(host.page.locator('.battle-hub-card.rooms'))
      for (const player of players) await waitSnapshot(player, () => Boolean(window.__lastRoomsSnapshot?.rooms))
      await host.page.locator('.rooms-list-panel').waitFor()
      await assertViewport(host, `${scenario.id}-list`, ['.rooms-screen', '.rooms-header', '.rooms-list-panel > .ranked-primary'])
    })
    await check(`${scenario.id}: real saved-team picker gates five-Pokemon rosters`, async () => {
      await host.click(host.page.getByRole('button', { name: '팀 2, 5마리 편성', exact: true }))
      assert(await host.page.getByRole('button', { name: '방 만들기', exact: true }).isDisabled())
      assert.equal((await host.page.evaluate(() => window.__roomEvents.requests)).filter(value => value.action === 'roomCreate').length, 0)
      await host.click(host.page.getByRole('button', { name: '팀 1, 6마리 편성', exact: true }))
      assert(await host.page.getByRole('button', { name: '방 만들기', exact: true }).isEnabled())
    })
    await check(`${scenario.id}: numeric PIN create form preserves format and uses real server countdown`, async () => {
      await host.click(host.page.getByRole('button', { name: '방 만들기', exact: true }))
      const dialog = host.page.getByRole('dialog', { name: '방 만들기', exact: true })
      await dialog.getByLabel('방 이름', { exact: true }).fill(title)
      await host.click(dialog.getByRole('button', { name: scenario.mode === 'league' ? '리그전' : '토너먼트', exact: true }))
      await host.click(dialog.getByRole('button', { name: scenario.format === 'double' ? '더블배틀' : '싱글배틀', exact: true }))
      const password = dialog.locator('input[type="password"]')
      await password.fill('1a23')
      assert.equal(await password.inputValue(), '123', 'PIN input must remove non-ASCII digits')
      await password.fill('0042')
      await assertViewport(host, `${scenario.id}-create-dialog`, ['.rooms-dialog'])
      await dialog.screenshot({ path: path.join(output, `${scenario.id}-create.png`) })
      await host.click(dialog.getByRole('button', { name: '방 만들기', exact: true }))
      const value = await waitSnapshot(host, () => window.__lastRoomsSnapshot?.room?.members?.length === 1)
      assert.equal(value.room.mode, scenario.mode)
      assert.equal(value.room.format, scenario.format)
      assert.equal(value.room.locked, true)
      assert(value.room.startDeadlineAt - value.serverTime <= 600_000 && value.room.startDeadlineAt - value.serverTime > 580_000)
      assert(await host.page.getByRole('button', { name: '2명부터 시작할 수 있습니다', exact: true }).isDisabled())
      const before = await host.page.locator('.rooms-deadline strong').textContent()
      await host.page.waitForFunction(before => document.querySelector('.rooms-deadline strong')?.textContent !== before, before, { timeout: 3000 })
    })
    await check(`${scenario.id}: wrong PIN stays outside, correct PIN joins and host controls stay private`, async () => {
      for (const [index, player] of players.slice(1).entries()) {
        await player.click(player.page.getByRole('button', { name: '방 목록 새로고침', exact: true }))
        const card = player.page.locator('.rooms-room-card').filter({ has: player.page.getByRole('heading', { name: title, exact: true }) })
        await card.waitFor()
        await player.click(card.getByRole('button', { name: '참가하기', exact: true }))
        const dialog = player.page.getByRole('dialog', { name: '비밀번호 입력', exact: true })
        if (index === 0) {
          await dialog.getByLabel('방 비밀번호', { exact: true }).fill('9999')
          await player.click(dialog.getByRole('button', { name: '참가하기', exact: true }))
          await dialog.getByRole('alert').filter({ hasText: '방 비밀번호가 일치하지 않습니다.' }).waitFor()
          assert.equal((await store.inspect()).collections.battleRooms[(await snapshot(host)).room.id].members.length, 1)
        }
        await dialog.getByLabel('방 비밀번호', { exact: true }).fill('0042')
        await player.click(dialog.getByRole('button', { name: '참가하기', exact: true }))
        await waitSnapshot(player, () => Boolean(window.__lastRoomsSnapshot?.room))
        assert.equal(await player.page.getByRole('button', { name: '대회 시작', exact: true }).count(), 0)
        await player.page.getByText('방장이 시작하기를 기다립니다.', { exact: true }).waitFor()
      }
      await host.page.waitForFunction(count => window.__lastRoomsSnapshot?.room?.members?.length === count, scenario.participantCount)
      const room = (await snapshot(host)).room
      if (scenario.participantCount === 4) assert(room.startDeadlineAt - (await snapshot(host)).serverTime <= 60_000, 'Fourth join must shorten the server deadline')
      await host.page.screenshot({ path: path.join(output, `${scenario.id}-waiting.png`) })
      await host.click(host.page.getByRole('button', { name: '대회 시작', exact: true }))
      await waitSnapshot(host, () => window.__lastRoomsSnapshot?.room?.phase === 'active')
      const active = (await snapshot(host)).room
      if (scenario.participantCount === 3) {
        assert.equal(active.matches.filter(match => match.phase === 'bye').length, 1)
        const bye = active.matches.find(match => match.phase === 'bye')
        const waiting = players.find(player => `ranked-test-${player.identity}` === bye.players[0].uid)
        await waiting.page.getByText('부전승', { exact: true }).waitFor()
        await waiting.page.screenshot({ path: path.join(output, `${scenario.id}-bye.png`) })
      }
    })
    const initialRoom = (await snapshot(host)).room
    const firstMatch = initialRoom.matches.find(match => ['select', 'battle'].includes(match.phase))
    assert(firstMatch)
    const pair = firstMatch.players.map(member => players.find(player => `ranked-test-${player.identity}` === member.uid))
    const selectedIndices = scenario.format === 'double' ? [2, 0, 4, 1] : [2, 0, 4]
    await check(`${scenario.id}: real online team selection sends exactly ${selectedIndices.length} Pokemon in lead order`, async () => {
      for (const player of pair) {
        await player.page.waitForFunction(id => window.__lastRoomsSnapshot?.match?.id === id && window.__lastRoomsSnapshot.match.phase === 'select', firstMatch.id)
        const buttons = player.page.locator('.rooms-selection button.ranked-pokemon-card')
        assert.equal(await buttons.count(), 6)
        assert(await player.page.getByRole('button', { name: '선출 확정', exact: true }).isDisabled())
        for (const [order, index] of selectedIndices.entries()) {
          await player.click(buttons.nth(index))
          assert.match(await buttons.nth(index).getAttribute('aria-label'), new RegExp(`${order + 1}번 출전 선택됨`))
          if (order < selectedIndices.length - 1) assert(await player.page.getByRole('button', { name: '선출 확정', exact: true }).isDisabled())
        }
        await player.page.screenshot({ path: path.join(output, `${scenario.id}-${player.identity}-selection.png`) })
        await player.click(player.page.getByRole('button', { name: '선출 확정', exact: true }))
      }
      for (const player of pair) {
        const value = await waitSnapshot(player, () => window.__lastRoomsSnapshot?.match?.phase === 'battle')
        assert.equal(value.match.state.player.team.length, selectedIndices.length)
        assert.equal(value.match.state.player.activeIndexes.length, scenario.format === 'double' ? 2 : 1)
        assert.deepEqual(value.match.state.player.team.map(mon => mon.speciesId), selectedIndices.map(index => boxPokemon[index].speciesId))
        await player.page.locator('.rooms-live-battle .battle-command-buttons .fight').waitFor()
      }
    })
    await check(`${scenario.id}: paired Protect commands resolve a real authoritative turn and UI forfeit ends the match`, async () => {
      const before = (await snapshot(pair[0])).match.state
      const originalPp = before.player.team[0].moves.find(move => move.id === 'protect').currentPp
      for (const player of pair) {
        const fight = player.page.locator('.battle-command-buttons .fight')
        await player.click(fight)
        for (let slot = 0; slot < (scenario.format === 'double' ? 2 : 1); slot++) await player.click(player.page.locator('.battle-move-button').filter({ hasText: '방어' }))
      }
      for (const player of pair) {
        const value = await waitSnapshot(player, () => window.__lastRoomsSnapshot?.match?.state?.turn >= 2)
        assert.equal(value.match.state.player.team[0].moves.find(move => move.id === 'protect').currentPp, originalPp - 1)
      }
      await assertViewport(pair[0], `${scenario.id}-live`, ['.rooms-live-battle', '.battle-command-panel'])
      await pair[0].page.screenshot({ path: path.join(output, `${scenario.id}-live.png`) })
      await pair[0].click(pair[0].page.locator('.ranked-battle-connection').getByRole('button', { name: '기권', exact: true }))
      const dialog = pair[0].page.getByRole('dialog', { name: '이번 대전을 기권할까요?', exact: true })
      await assertViewport(pair[0], `${scenario.id}-forfeit`, ['.rooms-dialog'])
      await pair[0].click(dialog.getByRole('button', { name: '기권하기', exact: true }))
      await pair[0].page.locator('.rooms-match-result').waitFor()
      assert.equal((await snapshot(pair[0])).match?.result?.reason, 'forfeit')
    })
    await check(`${scenario.id}: remaining real HTTP forfeits complete every scheduled match and delete the room`, async () => {
      // Deliberate test forfeits, not fabricated victories: exercise the real
      // service settlement, standings and round advancement for all fixtures.
      for (let step = 0; step < 8; step++) {
        const database = await store.inspect()
        if (!Object.keys(database.collections.battleRooms ?? {}).length) break
        const matches = Object.values(database.collections.matches ?? {}).filter(match => match.roomId && match.phase !== 'finished')
        assert(matches.length > 0, 'An active room must have an actionable match')
        for (const match of matches) {
          const player = players.find(player => `ranked-test-${player.identity}` === match.players[0].uid)
          await request(player, 'forfeit', { matchId: match.id })
        }
      }
      await assertFriendlyRecords(store, scenario.participantCount, scenario.mode === 'league' ? 6 : 2)
      for (const player of players) {
        await player.page.waitForFunction(() => window.__lastRoomsSnapshot?.roomResult?.reason === 'completed')
        await player.page.waitForFunction(() => document.querySelector('.rooms-match-result, .rooms-final'))
        if (await player.page.locator('.rooms-match-result').isVisible()) await player.click(player.page.locator('.rooms-match-result > button'))
        await player.page.locator('.rooms-final').waitFor()
        assert.equal(await player.page.locator('.rooms-final .rooms-standings [role="row"]').count(), scenario.participantCount + 1)
      }
      await host.page.screenshot({ path: path.join(output, `${scenario.id}-final.png`) })
      await host.click(host.page.getByRole('button', { name: '방 목록으로', exact: true }))
      await waitSnapshot(host, () => window.__lastRoomsSnapshot?.roomResult === null && window.__lastRoomsSnapshot?.room === null)
      assert.equal(await host.page.locator('.rooms-room-card').count(), 0)
      assert.equal((await store.inspect()).collections.players['ranked-test-alice'].roomResult, null)
    })
  } catch (error) {
    if (!checks.at(-1) || checks.at(-1).passed) checks.push({ name: `${scenario.id}: scenario initialization`, passed: false, error: error.message })
    for (const player of players) await player.page.screenshot({ path: path.join(output, `${scenario.id}-${player.identity}-failure.png`) }).catch(() => {})
    for (const player of players) console.error(`DEBUG ${scenario.id}/${player.identity}: ${JSON.stringify(await player.page.evaluate(() => ({ body: document.body.textContent.slice(-900), actions: window.__roomEvents?.requests.map(request => request.action), room: window.__lastRoomsSnapshot?.room?.phase, match: window.__lastRoomsSnapshot?.match?.phase })).catch(() => null))}`)
    console.error(`Scenario stopped: ${scenario.id}: ${error.message}`)
  } finally {
    for (const player of players) await player.context.close()
    await api.close()
  }
}

let browser
try {
  browser = await chromium.launch({ executablePath: await resolveChromiumExecutable(chromium), headless: true })
  for (const scenario of [
    { id: 'desktop-single-tournament', mode: 'tournament', format: 'single', participantCount: 3, viewport: { width: 1440, height: 900 } },
    { id: 'mobile-double-league', mode: 'league', format: 'double', participantCount: 4, mobile: true, viewport: { width: 844, height: 390 } },
  ]) {
    if (process.env.BATTLE_ROOMS_UI_SCENARIO && process.env.BATTLE_ROOMS_UI_SCENARIO !== scenario.id) continue
    await runScenario(browser, scenario)
  }
} finally {
  await browser?.close()
  await server.close()
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ checks, browserErrors, httpFailures, layouts, blockedRequests }, null, 2))
}
assert(checks.length > 0, 'Room UI scenarios were not executed')
assert.equal(browserErrors.length, 0, 'Room UI must not raise browser exceptions')
assert(httpFailures.every(failure => failure.status === 403 && failure.body?.error?.code === 'WRONG_ROOM_PASSWORD'), 'Only the deliberately wrong PIN may fail over HTTP')
assert(checks.every(check => check.passed), 'Room UI validation failed')
console.log(`Battle room UI validation passed: ${checks.length} checks`)
