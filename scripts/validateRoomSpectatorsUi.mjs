import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createHash, randomUUID } from 'node:crypto'
import { createServer } from 'vite'
import { createMemoryRankedStore } from '../server/rankedStore.js'
import { normalizePokemon } from '../src/data/trainingData.js'
import { createSavedTeams } from '../src/data/teamData.js'
import { startRankedDevServer, createRankedTestTeams } from './rankedDevServer.mjs'
import { resolveChromiumExecutable } from '../promo/scripts/browserRuntime.mjs'

// Real room UI, HTTP authentication, service and battle engine. Only loopback
// APIs and public static sprite CDNs are reachable; no production connections.
if (process.env.NODE_ENV === 'production' || process.env.VERCEL) throw Error('Local validation only')
const root = fileURLToPath(new URL('../', import.meta.url))
const output = path.join(root, 'scripts/.cache/room-spectators-ui')
await fs.mkdir(output, { recursive: true })
const require = createRequire(new URL('../promo/package.json', import.meta.url))
const { chromium } = require('playwright')
const identities = ['alice', 'bob', 'charlie', 'dave']
const boxPokemon = createRankedTestTeams()[0].pokemon.map(normalizePokemon)
const ids = boxPokemon.map(pokemon => pokemon.captureId)
const teams = createSavedTeams(ids, ids)
const checks = [], errors = [], failures = [], blocked = [], layouts = [], imageAudits = [], apiAudit = []
const sourcePaths = ['src/BattleRoomsScreen.jsx', 'src/BattleScreen.jsx', 'src/battleRooms.css', 'server/battleRoomService.js', 'server/rankedBattle.js', 'server/rankedHttp.js', 'server/rankedService.js']
const sourceHashes = await Promise.all(sourcePaths.map(async file => ({ file, sha256: createHash('sha256').update(await fs.readFile(path.join(root, file))).digest('hex') })))
let apiUrl, browser
const entry = `import React,{useMemo,useState}from'react';import{createRoot}from'react-dom/client';
import BattleRoomsScreen from '/src/BattleRoomsScreen.jsx';import{createRankedClient}from'/src/rankedClient.js';import'/src/mobileViewport.js';
${['styles', 'screenRedesign', 'battleGen5', 'titleCleanup', 'battleGimmicks', 'moveAnimationDirector', 'mobileLandscape', 'ranked', 'auth'].map(name => `import'/src/${name}.css';`).join('\n')}
const fixture=window.__spectatorFixture;window.__spectatorRequests=[];
function Harness(){const[battleActive,setBattleActive]=useState(false);const client=useMemo(()=>{const real=createRankedClient({getIdToken:async()=>'ranked-test-'+fixture.identity,apiUrl:'/api/ranked'});return{request:async(...args)=>{window.__spectatorRequests.push({action:args[0],payload:args[1]});const value=await real.request(...args);window.__spectatorSnapshot=value;return value}}},[]);
return React.createElement('div',{className:'app-shell rooms-view'+(battleActive?' battle-view':'')},React.createElement('header',{className:'topbar'},React.createElement('div',{className:'brand'},React.createElement('span',{className:'brand-mark'},React.createElement('img',{src:'/assets/brand/champions-arena-emblem.png',alt:''})),React.createElement('strong',null,'CHAMPIONS ARENA'))),React.createElement(BattleRoomsScreen,{user:{uid:'ranked-test-'+fixture.identity,displayName:fixture.identity},enabled:true,client,boxPokemon:fixture.boxPokemon,teams:fixture.teams,activeTeamId:'team-1',onSelectTeam:()=>{},onOpenBox:()=>{},onBack:()=>{},onBeforeJoin:async()=>true,soundEnabled:false,gameSettings:{attackAnimation:'normal',hpBarSpeed:'instant'},onBattleActiveChange:setBattleActive}))}
createRoot(document.getElementById('root')).render(React.createElement(Harness));`
const html = '<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body><div id="root"></div><script type="module" src="/room-spectators-entry.js"></script></body></html>'
const frontend = await createServer({ root, cacheDir: path.join(output, 'vite'), mode: 'room-spectators-validation', logLevel: 'error',
  plugins: [{ name: 'room-spectators-validation', enforce: 'pre',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const url = new URL(request.url, 'http://localhost')
        if (url.pathname === '/room-spectators.html') { response.setHeader('Content-Type', 'text/html'); response.end(await server.transformIndexHtml(url.pathname, html)); return }
        if (url.pathname !== '/api/ranked') { next(); return }
        const chunks = []; for await (const chunk of request) chunks.push(chunk)
        const body = Buffer.concat(chunks)
        const result = await fetch(`${apiUrl}${url.search}`, { method: request.method, headers: { authorization: request.headers.authorization ?? '', 'content-type': 'application/json' }, ...(!['GET', 'HEAD'].includes(request.method) ? { body } : {}) })
        response.writeHead(result.status, Object.fromEntries(result.headers)); response.end(Buffer.from(await result.arrayBuffer()))
      })
    },
    resolveId(source) {
      if (source === '/room-spectators-entry.js') return source
      if (/\/auth\/firebaseClient(?:\.js)?$/.test(source) || source === './firebaseClient') return '\0room-spectators-offline-auth'
    },
    load(id) {
      if (id === '/room-spectators-entry.js') return entry
      if (id === '\0room-spectators-offline-auth') return 'export const firebaseAuth=null;export const firebaseDb=null;export const isFirebaseConfigured=false;export const missingFirebaseEnvironmentVariables=[];'
    },
  }], server: { host: '127.0.0.1', port: Number(process.env.ROOM_SPECTATORS_UI_PORT ?? 5296), strictPort: true, hmr: false } })
await frontend.listen()
const origin = frontend.resolvedUrls.local[0].replace(/\/$/, '')
const uid = identity => `ranked-test-${identity}`
const identityFor = id => identities.find(identity => uid(identity) === id)
async function check(name, run) {
  try { await run(); checks.push({ name, passed: true }); console.log(`PASS ${name}`) }
  catch (error) { checks.push({ name, passed: false, error: error.message }); throw error }
}
async function api(identity, action, payload = {}) {
  const read = action === 'rooms'
  const query = new URLSearchParams({ action, ...Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, String(value)])) })
  const response = await fetch(`${apiUrl}${read ? `?${query}` : ''}`, { method: read ? 'GET' : 'POST', headers: { Authorization: `Bearer ${uid(identity)}`, 'Content-Type': 'application/json' }, ...(!read ? { body: JSON.stringify({ action, requestId: randomUUID(), ...payload }) } : {}) })
  const value = await response.json(); apiAudit.push({ identity, action, status: response.status, matchId: payload.matchId ?? null })
  assert.equal(response.status, 200, `${action}: ${JSON.stringify(value.error)}`)
  return value
}
async function openObserver(scenario, identity) {
  const context = await browser.newContext({ viewport: scenario.viewport, isMobile: Boolean(scenario.mobile), hasTouch: Boolean(scenario.mobile), serviceWorkers: 'block' })
  await context.addInitScript(fixture => { window.__spectatorFixture = fixture }, { identity, boxPokemon, teams })
  await context.route('**/*', async route => {
    const request = route.request(), target = new URL(request.url())
    if (target.origin !== origin && !(request.method() === 'GET' && ['raw.githubusercontent.com', 'play.pokemonshowdown.com'].includes(target.hostname))) {
      blocked.push({ scenario: scenario.id, url: target.href }); return route.abort('blockedbyclient')
    }
    if (target.pathname === '/src/BattleScreen.jsx') {
      const response = await route.fetch(); let body = await response.text()
      assert(body.includes('const currentLogEntry ='))
      body = body.replace('const currentLogEntry =', 'window.__spectatorBattle={battle,isTurnAnimating,introVisible,menu}; const currentLogEntry =')
      return route.fulfill({ response, body })
    }
    return route.continue()
  })
  const page = await context.newPage(); page.setDefaultTimeout(30_000)
  page.on('pageerror', error => errors.push({ scenario: scenario.id, message: error.message }))
  page.on('response', response => { if (response.url().includes('/api/ranked') && response.status() >= 400) failures.push({ scenario: scenario.id, status: response.status() }) })
  await page.goto(`${origin}/room-spectators.html`)
  await page.waitForFunction(() => Boolean(window.__spectatorSnapshot?.room))
  await page.evaluate(() => {
    window.__sawSpectatorAttack = false
    new MutationObserver(() => { if (document.querySelector('.rooms-spectator-view .battle-pokemon-stage.is-attacking')) window.__sawSpectatorAttack = true }).observe(document.body, { subtree: true, attributes: true })
  })
  return { identity, context, page, click: locator => scenario.mobile ? locator.tap() : locator.click() }
}
async function refresh(player) { await player.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))) }
async function spectatorReady(player) {
  await player.page.locator('.rooms-spectator-view .battle-game-screen').waitFor()
  await player.page.waitForFunction(() => window.__spectatorBattle && !window.__spectatorBattle.isTurnAnimating && !window.__spectatorBattle.introVisible)
}
async function assertReadOnly(player, label) {
  const commands = player.page.locator('.rooms-spectator-view .battle-command-buttons .fight, .rooms-spectator-view .battle-command-buttons .pokemon, .rooms-spectator-view .battle-command-buttons .give-up, .rooms-spectator-view .battle-move-button, .rooms-spectator-view .battle-gimmick-selector')
  assert.equal(await commands.count(), 0, 'Spectators must not receive battle command controls')
  assert.equal(await player.page.locator('.rooms-spectator-view').getByRole('button', { name: /^(기권|기권하기|싸운다|교체)$/ }).count(), 0)
  assert((await player.page.evaluate(() => window.__spectatorRequests)).every(request => request.action === 'rooms'), 'Spectator UI must only make read requests')
  const geometry = await player.page.evaluate(() => {
    const selectors = ['.rooms-spectator-view', '.rooms-spectator-bar', '.rooms-spectator-bar button']
    return { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight, elements: selectors.flatMap(selector => [...document.querySelectorAll(selector)].filter(node => node.getClientRects().length).map(node => { const r = node.getBoundingClientRect(); return { selector, left: r.left, top: r.top, right: r.right, bottom: r.bottom } })) }
  })
  layouts.push({ label, ...geometry })
  assert(geometry.scrollWidth <= geometry.width + 1 && geometry.scrollHeight <= geometry.height + 1, `${label}: page overflow`)
  assert(geometry.elements.every(r => r.left >= -1 && r.top >= -1 && r.right <= geometry.width + 1 && r.bottom <= geometry.height + 1), `${label}: spectator controls clipped`)
}
async function assertSprites(player, activePerSide, label) {
  for (const side of ['player', 'opponent']) assert.equal(await player.page.locator(`.rooms-spectator-view .battle-pokemon-stage.${side}`).count(), activePerSide)
  const images = await player.page.evaluate(async () => {
    const nodes = [...document.querySelectorAll('.rooms-spectator-view img, .rooms-spectator-view image')].filter(node => node.getBoundingClientRect().width > 0)
    const urls = [...new Set(nodes.map(node => node.currentSrc || node.src || node.href?.baseVal).filter(value => typeof value === 'string' && value))]
    return Promise.all(urls.map(src => new Promise(resolve => { const image = new Image(); const timer = setTimeout(() => resolve({ src, loaded: false }), 20_000); image.onload = () => { clearTimeout(timer); resolve({ src, loaded: image.naturalWidth > 0 }) }; image.onerror = () => { clearTimeout(timer); resolve({ src, loaded: false }) }; image.src = src })))
  })
  imageAudits.push({ label, images }); assert(images.length >= 2 && images.every(image => image.loaded), `${label}: visible sprites must load`)
}
async function selectPair(match, format) {
  for (const member of match.players) {
    const identity = identityFor(member.uid), value = await api(identity, 'rooms')
    await api(identity, 'select', { matchId: match.id, revision: value.match.revision, selection: format === 'double' ? [2, 5, 1, 4] : [2, 1, 4] })
  }
}
async function playDamageTurn(match) {
  for (const member of match.players) {
    const identity = identityFor(member.uid), value = await api(identity, 'rooms')
    const actions = value.match.state.player.activeIndexes.map((index, actorSlot) => ({ type: 'move', actorSlot, moveIndex: 0, targetSideId: 'opponent', targetSlot: actorSlot }))
    await api(identity, 'submit', { matchId: match.id, revision: value.match.revision, actions })
  }
}
async function finishRoom(store) {
  for (let i = 0; i < 8; i++) {
    const database = await store.inspect()
    if (!Object.keys(database.collections.battleRooms ?? {}).length) return
    for (const match of Object.values(database.collections.matches ?? {}).filter(match => match.roomId && match.phase !== 'finished')) await api(identityFor(match.players[0].uid), 'forfeit', { matchId: match.id })
  }
  assert.fail('Room did not finish through actual forfeits')
}
async function runScenario(scenario) {
  const store = createMemoryRankedStore()
  const server = await startRankedDevServer({ port: 0, testAccounts: true, store, timeouts: { selection: 180_000, turn: 180_000 } })
  apiUrl = server.url
  let observer
  try {
    const created = await api('alice', 'roomCreate', { title: scenario.id, mode: scenario.mode, format: scenario.format, team: boxPokemon })
    for (const identity of identities.slice(1, scenario.count)) await api(identity, 'roomJoin', { roomId: created.room.id, team: boxPokemon })
    const started = await api('alice', 'roomStart', { roomId: created.room.id })
    const matches = started.room.matches.filter(match => match.phase === 'select')
    let watched, observerIdentity
    if (scenario.mode === 'tournament') {
      observerIdentity = identityFor(started.room.matches.find(match => match.phase === 'bye').players[0].uid); watched = matches[0]
    } else {
      const early = matches[0]; observerIdentity = identityFor(early.players[0].uid)
      await api(observerIdentity, 'forfeit', { matchId: early.id }); watched = matches[1]
    }
    observer = await openObserver(scenario, observerIdentity)
    if (await observer.page.locator('.rooms-match-result').isVisible()) await observer.click(observer.page.locator('.rooms-match-result > button'))
    await check(`${scenario.id}: waiting entrant opens a live fixture during selection`, async () => {
      const button = observer.page.getByRole('button', { name: /^관전하기:/ }).first()
      await button.waitFor(); await observer.click(button)
      await observer.page.locator('.rooms-spectator-waiting').waitFor()
      await observer.page.getByText('두 트레이너가 출전 포켓몬을 고르고 있습니다', { exact: true }).waitFor()
      await assertReadOnly(observer, `${scenario.id}-waiting`)
      await selectPair(watched, scenario.format)
      await spectatorReady(observer)
      await assertSprites(observer, scenario.format === 'double' ? 2 : 1, `${scenario.id}-battle`)
      await observer.page.screenshot({ path: path.join(output, `${scenario.id}-spectator-before.png`) })
    })
    await check(`${scenario.id}: public timeline shows actual damage with no spectator action requests`, async () => {
      const before = await observer.page.evaluate(() => window.__spectatorBattle.battle)
      await playDamageTurn(watched)
      await observer.page.waitForFunction(() => window.__spectatorSnapshot?.spectator?.state?.turn >= 2)
      await observer.page.waitForFunction(() => window.__sawSpectatorAttack === true)
      await spectatorReady(observer)
      const after = await observer.page.evaluate(() => window.__spectatorBattle.battle)
      assert(after.player.team.some((mon, index) => mon.hp < before.player.team[index].hp) || after.opponent.team.some((mon, index) => mon.hp < before.opponent.team[index].hp), 'Rendered spectator HP must change after a real damaging turn')
      await assertReadOnly(observer, `${scenario.id}-after-turn`)
      await observer.page.screenshot({ path: path.join(output, `${scenario.id}-spectator-after.png`) })
    })
    await check(`${scenario.id}: spectator returns to the board and re-enters without losing the live match`, async () => {
      await observer.click(observer.page.getByRole('button', { name: '대기실로 돌아가기', exact: true }))
      await observer.page.locator('.rooms-progress-panel').waitFor()
      assert.equal(await observer.page.locator('.rooms-spectator-view').count(), 0)
      await observer.click(observer.page.getByRole('button', { name: /^관전하기:/ }).first())
      await spectatorReady(observer)
      await assertReadOnly(observer, `${scenario.id}-reentered`)
    })
    await check(`${scenario.id}: next own match automatically replaces spectating and completed rooms clean up`, async () => {
      await api(identityFor(watched.players[0].uid), 'forfeit', { matchId: watched.id })
      await observer.page.locator('.rooms-selection').waitFor()
      assert.equal(await observer.page.locator('.rooms-spectator-view').count(), 0)
      assert.equal(await observer.page.locator('.rooms-selection button.ranked-pokemon-card').count(), 6)
      assert.equal((await observer.page.evaluate(() => window.__spectatorSnapshot)).spectator, null)
      if (scenario.mode === 'league') {
        // Reach the final round with real forfeits, then finish our fixture
        // first so room deletion happens while the other final match is viewed.
        const secondRound = Object.values((await store.inspect()).collections.matches).filter(match => match.roomId && match.phase !== 'finished')
        for (const match of secondRound) await api(identityFor(match.players[0].uid), 'forfeit', { matchId: match.id })
        const finalRound = Object.values((await store.inspect()).collections.matches).filter(match => match.roomId && match.phase !== 'finished')
        assert.equal(finalRound.length, 2)
        const ownFinal = finalRound.find(match => match.players.some(member => member.uid === uid(observerIdentity)))
        const otherFinal = finalRound.find(match => match.id !== ownFinal.id)
        await api(observerIdentity, 'forfeit', { matchId: ownFinal.id }); await refresh(observer)
        await observer.page.locator('.rooms-match-result').waitFor()
        await observer.click(observer.page.locator('.rooms-match-result > button'))
        await observer.click(observer.page.getByRole('button', { name: /^관전하기:/ }).first())
        await observer.page.locator('.rooms-spectator-waiting').waitFor()
        await selectPair(otherFinal, scenario.format); await spectatorReady(observer)
        await assertReadOnly(observer, `${scenario.id}-final-match`)
        await observer.page.screenshot({ path: path.join(output, `${scenario.id}-final-spectating.png`) })
        await api(identityFor(otherFinal.players[0].uid), 'forfeit', { matchId: otherFinal.id })
      }
      // Finish remaining fixtures through genuine forfeits; this is navigation
      // setup, not invented results or a repeated full room-system test suite.
      await finishRoom(store); await refresh(observer)
      await observer.page.waitForFunction(() => window.__spectatorSnapshot?.roomResult?.reason === 'completed')
      await observer.page.waitForFunction(() => document.querySelector('.rooms-match-result, .rooms-final'))
      if (await observer.page.locator('.rooms-match-result').isVisible()) await observer.click(observer.page.locator('.rooms-match-result > button'))
      await observer.page.locator('.rooms-final').waitFor()
      await observer.click(observer.page.getByRole('button', { name: '방 목록으로', exact: true }))
      await observer.page.locator('.rooms-list-panel').waitFor()
      assert.equal(await observer.page.locator('.rooms-spectator-view').count(), 0)
      assert.equal(Object.keys((await store.inspect()).collections.battleRooms ?? {}).length, 0)
      await observer.page.screenshot({ path: path.join(output, `${scenario.id}-cleanup.png`) })
    })
  } catch (error) {
    if (!checks.length || checks.at(-1).passed) checks.push({ name: `${scenario.id}: setup`, passed: false, error: error.message })
    console.error(`FAIL ${scenario.id}: ${error.stack}`)
    if (observer) {
      await observer.page.screenshot({ path: path.join(output, `${scenario.id}-failure.png`) }).catch(() => {})
      await fs.writeFile(path.join(output, `${scenario.id}-debug.json`), JSON.stringify(await observer.page.evaluate(() => ({ body: document.body.innerText, requests: window.__spectatorRequests, snapshot: window.__spectatorSnapshot })).catch(() => null), null, 2))
    }
  } finally { await observer?.context.close(); await server.close() }
}
try {
  browser = await chromium.launch({ executablePath: await resolveChromiumExecutable(chromium), headless: true })
  for (const scenario of [
    { id: 'desktop-single-bye', mode: 'tournament', format: 'single', count: 3, viewport: { width: 1440, height: 900 } },
    { id: 'mobile-double-waiting', mode: 'league', format: 'double', count: 4, mobile: true, viewport: { width: 844, height: 390 } },
  ]) {
    if (process.env.ROOM_SPECTATORS_UI_SCENARIO && process.env.ROOM_SPECTATORS_UI_SCENARIO !== scenario.id) continue
    await runScenario(scenario)
  }
} finally {
  await browser?.close(); await frontend.close()
  const changedSources = []
  for (const item of sourceHashes) if (createHash('sha256').update(await fs.readFile(path.join(root, item.file))).digest('hex') !== item.sha256) changedSources.push(item.file)
  if (changedSources.length) errors.push({ message: 'Source changed during validation', files: changedSources })
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ checks, errors, failures, blocked, layouts, imageAudits, apiAudit, sourceHashes, changedSources }, null, 2))
}
assert(checks.length > 0 && checks.every(check => check.passed), 'Spectator UI integration failed')
assert.equal(errors.length, 0, 'Browser exceptions')
assert.equal(failures.length, 0, 'Unexpected HTTP failures')
assert.equal(blocked.length, 0, 'Unexpected external requests')
console.log(`Room spectator UI validation passed: ${checks.length} checks`)
