import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { normalizePokemon, getMoveById } from '../src/data/trainingData.js'
import { createSavedTeams } from '../src/data/teamData.js'
import { createRankedProfile } from '../src/data/rankedRules.js'
import { createRankedBattle, getRankedBattleView, getRankedTimelineView, resolveRankedTurn } from '../server/rankedBattle.js'
import { resolveChromiumExecutable } from '../promo/scripts/browserRuntime.mjs'

// Exercise the production team picker with saved-team props and intercepted HTTP.
// Firebase and the API use fixtures here; no real account or ranking is modified.
const root = fileURLToPath(new URL('../', import.meta.url))
const output = path.join(root, 'scripts/.cache/ranked-saved-teams-ui')
await fs.mkdir(output, { recursive: true })
const boxPokemon = [25, 6, 9, 3, 143, 94, 149, 448, 445, 248, 131, 59]
  .map(speciesId => normalizePokemon({ speciesId, captureId: `saved-team-ui-${speciesId}` }))
const teams = createSavedTeams(boxPokemon.slice(0, 6).map(pokemon => pokemon.captureId), boxPokemon.map(pokemon => pokemon.captureId))
teams[2].name = '비바라기 팀'
teams[2].pokemonIds = boxPokemon.slice(0, 6).reverse().map(pokemon => pokemon.captureId)
teams[3].pokemonIds = [boxPokemon[0].captureId, 'removed-pokemon']
teams[4].pokemonIds = boxPokemon.slice(6).map(pokemon => pokemon.captureId)
const finalTurnStart = createRankedBattle({ format: 'single', playerName: '테스트 트레이너', opponentName: '상대 트레이너',
  playerTeam: [25, 6, 9].map((speciesId, index) => normalizePokemon({ speciesId, captureId: `finish-player-${index}`,
    moves: [getMoveById(index === 0 ? 'thunderbolt' : 'protect').name] })),
  opponentTeam: [143, 94, 149].map((speciesId, index) => normalizePokemon({ speciesId, captureId: `finish-opponent-${index}`,
    moves: [getMoveById(index === 0 ? 'tackle' : 'protect').name] })),
})
finalTurnStart.opponent.team.forEach((pokemon, index) => { pokemon.hp = index === 0 ? 1 : 0; pokemon.fainted = index !== 0 })
const finalTurn = resolveRankedTurn(finalTurnStart, {
  player: [{ type: 'move', actorSlot: 0, moveIndex: 0, targetSideId: 'opponent', targetSlot: 0 }],
  opponent: [{ type: 'move', actorSlot: 0, moveIndex: 0, targetSideId: 'player', targetSlot: 0 }],
}, () => .5)
assert.equal(finalTurn.state.winner, 'player')
const settledProfile = { single: { ...createRankedProfile('single'), points: 30, rating: 1016, wins: 1, played: 1, streak: 1 }, double: createRankedProfile('double') }
const observedMatch = { id: 'saved-team-finished-match', format: 'single', phase: 'battle', revision: 7, timelineRevision: 7,
  you: { name: '테스트 트레이너' }, opponent: { name: '상대 트레이너' }, state: getRankedBattleView(finalTurnStart, 'player'), timeline: [] }
const finishedMatch = { ...observedMatch, phase: 'finished', revision: 8, timelineRevision: 8,
  state: getRankedBattleView(finalTurn.state, 'player'), timeline: getRankedTimelineView(finalTurn.timeline, 'player'),
  result: { outcome: 'win', reason: 'battle', ratingBefore: 1000, ratingAfter: 1016, ratingDelta: 16 } }
const checks = [], errors = []
async function test(name, run) {
  try { await run(); checks.push({ name, passed: true }); console.log(`PASS ${name}`) }
  catch (error) { checks.push({ name, passed: false, error: error.message }); console.error(`FAIL ${name}: ${error.message}`) }
}
const entry = `import React,{StrictMode,useState} from 'react';import{createRoot}from'react-dom/client';import RankedBattleScreen from '/src/RankedBattleScreen.jsx';
import '/src/styles.css';import '/src/screenRedesign.css';import '/src/battleHub.css';
window.__savedTeamEvents={selected:[],opened:[],saved:0,played:[],battleActive:[],results:0};window.__saveResult=true;
let resultVisible=false;new MutationObserver(()=>{const visible=Boolean(document.querySelector('.ranked-result'));if(visible&&!resultVisible)window.__savedTeamEvents.results++;resultVisible=visible}).observe(document.documentElement,{childList:true,subtree:true});
function Harness(){const[activeTeamId,setActiveTeamId]=useState('team-1');return React.createElement('div',{className:'app-shell ranked-view'},React.createElement(RankedBattleScreen,{
user:{uid:'saved-team-ui',displayName:'테스트 트레이너'},teams:window.__fixture.teams,boxPokemon:window.__fixture.boxPokemon,activeTeamId,soundEnabled:false,
gameSettings:{attackAnimation:'skip',hpBarSpeed:'instant'},onBattleActiveChange:active=>window.__savedTeamEvents.battleActive.push(active),
onSelectTeam:id=>{window.__savedTeamEvents.selected.push(id);setActiveTeamId(id)},onOpenBox:()=>window.__savedTeamEvents.opened.push(activeTeamId),
onBeforeJoin:async()=>{window.__savedTeamEvents.saved++;return window.__saveResult},onBack:()=>{}}))}
createRoot(document.getElementById('root')).render(React.createElement(StrictMode,null,React.createElement(Harness)));`
process.env.VITE_RANKED_ENABLED = 'true'
process.env.VITE_RANKED_LOCAL_TEST = 'false'
process.env.VITE_RANKED_API_URL = '/api/ranked'
const port = Number(process.env.RANKED_SAVED_TEAMS_UI_PORT ?? 5226)
const server = await createServer({ root, mode: 'saved-team-validation', logLevel: 'error',
  plugins: [{ name: 'ranked-saved-teams-fixture', enforce: 'pre',
    resolveId(source) {
      if (source === '/ranked-saved-teams-entry.js') return source
      if (source.endsWith('/auth/firebaseClient') || source.endsWith('/auth/firebaseClient.js')) return '\0ranked-fixture-auth'
    },
    load(id) {
      if (id === '/ranked-saved-teams-entry.js') return entry
      if (id === '\0ranked-fixture-auth') return `export const firebaseAuth={currentUser:{uid:'saved-team-ui',getIdToken:async()=>'saved-team-ui-fixture'}};export const firebaseDb=null;export const isFirebaseConfigured=false;export const missingFirebaseEnvironmentVariables=[];`
    },
  }], server: { host: '127.0.0.1', port, strictPort: true, hmr: false } })
await server.listen()
const require = createRequire(new URL('../promo/package.json', import.meta.url))
const { chromium } = require('playwright')
let browser
try {
  browser = await chromium.launch({ executablePath: await resolveChromiumExecutable(chromium), headless: true })
  const html = await server.transformIndexHtml('/ranked-saved-teams.html', '<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body><div id="root"></div><script type="module" src="/ranked-saved-teams-entry.js"></script></body></html>')
  for (const device of [{ id: 'desktop', viewport: { width: 1440, height: 1000 } }, { id: 'mobile', viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true }]) {
    const context = await browser.newContext(device)
    await context.addInitScript(value => { window.__fixture = value }, { teams, boxPokemon })
    await context.route('**/ranked-saved-teams.html', route => route.fulfill({ contentType: 'text/html', body: html }))
    let snapshot = { profile: null, queue: null, match: null }
    let statusFailure = null, commandFailure = null
    const requests = [], statusRequests = []
    let deferredStatus = null
    await context.route('**/api/ranked*', async route => {
      const request = route.request()
      if (request.method() === 'POST') {
        const payload = request.postDataJSON()
        requests.push({ ...payload, authorization: request.headers().authorization })
        if (commandFailure) {
          await route.fulfill({ status: commandFailure.status, contentType: 'application/json', body: JSON.stringify({ error: commandFailure.error }) })
          return
        }
        if (payload.action === 'join') snapshot = { ...snapshot, queue: { ticket: 'saved-team-ticket', format: payload.format, queuedAt: Date.now() } }
        if (payload.action === 'cancel') snapshot = { ...snapshot, queue: null }
      } else {
        statusRequests.push(Object.fromEntries(new URL(request.url()).searchParams))
        if (deferredStatus) {
          const deferred = deferredStatus
          deferredStatus = null
          deferred.started()
          await deferred.wait
          await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ...deferred.snapshot, serverTime: Date.now() }) })
          return
        }
        if (statusFailure) {
          await route.fulfill({ status: statusFailure.status, contentType: 'application/json', body: JSON.stringify({ error: statusFailure.error }) })
          return
        }
      }
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ...snapshot, serverTime: Date.now() }) })
    })
    const page = await context.newPage()
    page.setDefaultTimeout(10_000)
    page.on('pageerror', error => errors.push({ device: device.id, message: error.message }))
    await context.route('**/src/BattleScreen.jsx', async route => {
      const response = await route.fetch()
      const original = await response.text()
      const body = original.replace(/(onlineRef\.current\??\.onPlaybackComplete\?\.\(resolution\.remoteRevision\))/g,
        'window.__savedTeamEvents.played.push(resolution.remoteRevision); $1')
      assert.notEqual(body, original, 'BattleScreen playback observation hook was not installed')
      await route.fulfill({ response, body })
    })
    await page.goto(`http://127.0.0.1:${port}/ranked-saved-teams.html`)
    const click = locator => device.hasTouch ? locator.tap() : locator.click()
    const slot = number => page.getByRole('button', { name: new RegExp(`^팀 ${number},`) })
    const findOpponent = page.getByRole('button', { name: '대전 상대 찾기', exact: true })
    const roster = page.getByLabel('선택한 팀 포켓몬')
    await test(`${device.id}: production lobby exposes all five saved teams without local identities`, async () => {
      await page.getByRole('group', { name: '저장된 출전 팀 선택' }).waitFor()
      assert.equal(await page.locator('.ranked-team-slots button').count(), 5)
      assert.equal(await slot(1).getAttribute('aria-pressed'), 'true')
      assert.equal(await page.getByLabel('로컬 테스트 계정').count(), 0)
      assert(!/Alice|Bob|테스트 운영|레이팅 테스트|로컬 테스트/.test(await page.locator('main').innerText()))
      assert.deepEqual(await roster.locator('strong').allTextContents(), boxPokemon.slice(0, 6).map(pokemon => pokemon.name))
    })
    await test(`${device.id}: status 503 warning clears after a successful reconnect regardless of message prefix`, async () => {
      const message = '대전 서버에 일시적인 문제가 있습니다. 잠시 후 다시 연결해주세요.'
      statusFailure = { status: 503, error: { code: 'RANKED_UNAVAILABLE', message } }
      await page.evaluate(() => window.dispatchEvent(new Event('online')))
      await page.getByRole('alert').waitFor()
      assert.match(await page.getByRole('alert').innerText(), /대전 서버에 일시적인 문제가/)
      assert(await findOpponent.isDisabled())
      statusFailure = null
      await click(page.getByRole('button', { name: '다시 연결', exact: true }))
      await page.getByRole('alert').waitFor({ state: 'hidden' })
      assert(!(await findOpponent.isDisabled()))
    })
    await test(`${device.id}: empty and deleted-member teams explain the shortage and prevent matchmaking`, async () => {
      await click(slot(2))
      assert(await findOpponent.isDisabled())
      assert.equal(await roster.locator('.empty').count(), 6)
      assert.match(await page.locator('.ranked-team-help').innerText(), /6마리를 더 편성/)
      await click(slot(4))
      assert(await findOpponent.isDisabled())
      assert.equal(await roster.locator('.empty').count(), 5)
      assert.match(await page.locator('.ranked-team-help').innerText(), /5마리를 더 편성/)
    })
    await test(`${device.id}: renamed saved team preserves member order and opens that team for editing`, async () => {
      await click(slot(3))
      assert.equal(await page.locator('.ranked-roster-heading > strong').innerText(), '비바라기 팀')
      assert.deepEqual(await roster.locator('strong').allTextContents(), boxPokemon.slice(0, 6).reverse().map(pokemon => pokemon.name))
      await click(page.getByRole('button', { name: '선택한 팀 편성하기' }))
      assert.deepEqual(await page.evaluate(() => window.__savedTeamEvents.opened), ['team-3'])
    })
    await test(`${device.id}: failed cloud save blocks team registration`, async () => {
      await page.evaluate(() => { window.__saveResult = false })
      await click(findOpponent)
      await page.getByRole('alert').waitFor()
      assert.match(await page.getByRole('alert').innerText(), /팀을 계정에 저장하지 못했습니다/)
      assert.equal(requests.filter(request => request.action === 'join').length, 0)
    })
    await test(`${device.id}: Team 5 saves and submits its own six Pokemon then locks team and format changes`, async () => {
      await page.evaluate(() => { window.__saveResult = true })
      await click(slot(5))
      await click(page.getByRole('button', { name: '더블배틀', exact: true }))
      await click(findOpponent)
      await page.getByRole('heading', { name: '대전 상대를 찾고 있습니다' }).waitFor()
      const joined = requests.filter(request => request.action === 'join')
      assert.equal(joined.length, 1)
      assert.equal(joined[0].authorization, 'Bearer saved-team-ui-fixture')
      assert.equal(joined[0].format, 'double')
      assert.deepEqual(joined[0].team.map(pokemon => pokemon.captureId), teams[4].pokemonIds)
      assert.equal(await page.evaluate(() => window.__savedTeamEvents.saved), 2)
      assert.deepEqual(await roster.locator('strong').allTextContents(), boxPokemon.slice(6).map(pokemon => pokemon.name))
      for (let index = 1; index <= 5; index++) assert(await slot(index).isDisabled())
      assert(await page.getByRole('button', { name: '싱글배틀', exact: true }).isDisabled())
      assert.equal(await page.getByRole('button', { name: '선택한 팀 편성하기' }).count(), 0)
      assert.match(await page.locator('.ranked-match-note').innerText(), /매칭 중에는 출전 팀이 고정/)
    })
    await test(`${device.id}: cancelling matching preserves Team 5 and permits selecting another saved team`, async () => {
      await click(page.getByRole('button', { name: '매칭 취소' }))
      await findOpponent.waitFor()
      assert.equal(await slot(5).getAttribute('aria-pressed'), 'true')
      assert(!(await slot(1).isDisabled()))
      await click(slot(1))
      assert.equal(await slot(1).getAttribute('aria-pressed'), 'true')
      assert.equal(requests.filter(request => request.action === 'cancel')[0].queueTicket, 'saved-team-ticket')
      const overflow = await page.evaluate(() => ({ width: window.innerWidth, documentWidth: document.documentElement.scrollWidth,
        slots: [...document.querySelectorAll('.ranked-team-slots button')].map(element => { const bounds = element.getBoundingClientRect(); return { left: bounds.left, right: bounds.right } }) }))
      assert(overflow.documentWidth <= overflow.width + 1, JSON.stringify(overflow))
      assert(overflow.slots.every(bounds => bounds.left >= 0 && bounds.right <= overflow.width + 1), JSON.stringify(overflow))
      await page.screenshot({ path: path.join(output, `${device.id}.png`), fullPage: true })
    })
    await test(`${device.id}: successful status refresh preserves command validation errors independently of their wording`, async () => {
      const message = '서버와 동기화된 팀을 다시 편성해 주세요.'
      commandFailure = { status: 409, error: { code: 'INVALID_TEAM', message } }
      await click(findOpponent)
      await page.getByRole('alert').waitFor()
      assert.match(await page.getByRole('alert').innerText(), /서버와 동기화된 팀/)
      await Promise.all([
        page.waitForResponse(response => response.url().includes('/api/ranked') && response.request().method() === 'GET' && response.status() === 200),
        click(page.getByRole('button', { name: '다시 연결', exact: true })),
      ])
      await page.waitForTimeout(100)
      assert.match(await page.getByRole('alert').innerText(), /서버와 동기화된 팀/)
      assert(!(await findOpponent.isDisabled()))
      commandFailure = null
    })
    const refreshStatus = async () => {
      await Promise.all([
        page.waitForResponse(response => response.url().includes('/api/ranked') && response.request().method() === 'GET' && response.status() === 200),
        page.evaluate(() => window.dispatchEvent(new Event('online'))),
      ])
    }
    const assertSettledLobby = async () => {
      await findOpponent.waitFor()
      assert.equal(await page.locator('.ranked-result, .ranked-live-battle').count(), 0)
      assert.match(await page.locator('.ranked-rank-badge').innerText(), /30 RP/)
      assert.equal(await page.locator('.ranked-record strong').first().innerText(), '1')
    }
    await test(`${device.id}: reopening a completed battle keeps its score without replaying a legacy finished response`, async () => {
      snapshot = { profile: settledProfile, queue: null, match: finishedMatch }
      statusRequests.length = 0
      await page.reload()
      await assertSettledLobby()
      await refreshStatus()
      await assertSettledLobby()
      assert.deepEqual(await page.evaluate(() => window.__savedTeamEvents.played), [])
      assert(!(await page.evaluate(() => window.__savedTeamEvents.battleActive)).includes(true))
      assert.equal(await page.evaluate(() => window.__savedTeamEvents.results), 0)
      assert(statusRequests.length >= 2)
      assert(statusRequests.every(request => !request.matchId), JSON.stringify(statusRequests))
    })
    await test(`${device.id}: reopening an unfinished battle still restores its server state`, async () => {
      snapshot = { profile: { single: createRankedProfile('single'), double: createRankedProfile('double') }, queue: null, match: observedMatch }
      await page.reload()
      await page.locator('.ranked-live-battle').waitFor()
      await page.waitForFunction(() => window.__savedTeamEvents.played.includes(7))
      assert((await page.evaluate(() => window.__savedTeamEvents.battleActive)).includes(true))
      await refreshStatus()
      assert.equal(statusRequests.at(-1).matchId, observedMatch.id)
      assert.equal(await page.locator('.ranked-result').count(), 0)
    })
    await test(`${device.id}: a watched battle plays its final turn and shows the settled result exactly once`, async () => {
      snapshot = { profile: settledProfile, queue: null, match: finishedMatch }
      await refreshStatus()
      await page.locator('.ranked-result').waitFor()
      assert.match(await page.locator('.ranked-result h2').innerText(), /승리/)
      assert.match(await page.locator('.ranked-result-rating').innerText(), /1016/)
      assert.equal(await page.evaluate(() => window.__savedTeamEvents.played.filter(revision => revision === 8).length), 1)
      assert.equal(await page.evaluate(() => window.__savedTeamEvents.results), 1)
      await refreshStatus()
      assert.equal(await page.evaluate(() => window.__savedTeamEvents.played.filter(revision => revision === 8).length), 1)
      assert.equal(await page.evaluate(() => window.__savedTeamEvents.results), 1)
    })
    await test(`${device.id}: leaving results clears match context and ignores an in-flight stale battle response`, async () => {
      let release
      const wait = new Promise(resolve => { release = resolve })
      let started
      const requestStarted = new Promise(resolve => { started = resolve })
      // This request began while the result was visible. Its response arrives only
      // after the player leaves, so it must not revive even an older battle phase.
      deferredStatus = { wait, started, snapshot: { profile: settledProfile, queue: null, match: observedMatch } }
      try {
        await page.evaluate(() => window.dispatchEvent(new Event('online')))
        await requestStarted
        assert.equal(statusRequests.at(-1).matchId, finishedMatch.id)
        const requestCount = statusRequests.length
        await click(page.getByRole('button', { name: '레이팅 로비로', exact: true }))
        await assertSettledLobby()
        release()
        await refreshStatus()
        await assertSettledLobby()
        await refreshStatus()
        await assertSettledLobby()
        const afterExit = statusRequests.slice(requestCount)
        assert(afterExit.length > 0)
        assert(afterExit.every(request => !request.matchId && !request.timelineRevision), JSON.stringify(afterExit))
        assert.equal(await page.evaluate(() => window.__savedTeamEvents.played.filter(revision => revision === 8).length), 1)
        assert.equal(await page.evaluate(() => window.__savedTeamEvents.results), 1)
      } finally { release(); deferredStatus = null }
    })
    await test(`${device.id}: closing and reopening the lobby retains only the settled rating`, async () => {
      snapshot = { profile: settledProfile, queue: null, match: null }
      await page.reload()
      await assertSettledLobby()
      await refreshStatus()
      await assertSettledLobby()
      assert.deepEqual(await page.evaluate(() => window.__savedTeamEvents.played), [])
      assert.equal(await page.evaluate(() => window.__savedTeamEvents.results), 0)
      assert(!statusRequests.at(-1).matchId)
    })
    await context.close()
  }
} finally {
  await browser?.close()
  await server.close()
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ checks, errors }, null, 2))
}
assert.equal(errors.length, 0, JSON.stringify(errors))
assert(checks.every(check => check.passed), 'Ranked saved-team UI regression failed')
console.log(`${checks.length}/${checks.length} passed; browser errors ${errors.length}`)
