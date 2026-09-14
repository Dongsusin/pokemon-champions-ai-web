import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer as createHttpServer } from 'node:http'
import { Readable } from 'node:stream'
import { createServer as createViteServer } from 'vite'
import { createMemoryRankedStore } from '../server/rankedStore.js'
import { createRaidPreset } from '../server/raidBattle.js'
import * as raidEngine from '../server/raidBattle.js'
import { createRaidHttpHandler, createLocalRaidAuthenticator } from '../server/raidHttp.js'
import { createRaidService } from '../server/raidService.js'
import { resolveChromiumExecutable } from '../promo/scripts/browserRuntime.mjs'

// This is intentionally an end-to-end local test.  The browser receives no
// fabricated raid snapshot: three isolated browser contexts call the real
// HTTP handler, room service, and raid engine over loopback.
const root = fileURLToPath(new URL('../', import.meta.url))
const output = path.join(root, 'scripts/.cache/raid-ui')
await fs.mkdir(output, { recursive: true })

const identities = ['alice', 'bob', 'charlie']
const uidFor = identity => `ranked-test-${identity}`
const loadout = ['psystrike', 'aurasphere', 'icebeam', 'shadowball']
const boxes = Object.fromEntries(identities.map(identity => [identity, [createRaidPreset({ speciesId: 150, moves: loadout }, `raid-ui-${identity}-mewtwo`)]]))
const checks = []
const browserErrors = []
const httpFailures = []
const expectedHttpConflicts = []
const layouts = []
const blockedRequests = []
const diagnostics = []
const viewAgreements = []
let clock = Date.now()
let idSequence = 0
let api
let vite
let browser
const players = []

async function check(name, run) {
  try {
    await run()
    checks.push({ name, passed: true })
    console.log(`PASS ${name}`)
  } catch (error) {
    checks.push({ name, passed: false, error: error.message })
    console.error(`FAIL ${name}: ${error.message}`)
    throw error
  }
}

function loopbackServer(handler) {
  let origin = ''
  const server = createHttpServer(async (incoming, outgoing) => {
    try {
      const url = new URL(incoming.url, origin)
      if (url.pathname !== '/api/raid') {
        outgoing.writeHead(404, { 'Content-Type': 'application/json' })
        outgoing.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not found' } }))
        return
      }
      const request = new Request(url, {
        method: incoming.method,
        headers: incoming.headers,
        ...(!['GET', 'HEAD'].includes(incoming.method ?? 'GET') ? { body: Readable.toWeb(incoming), duplex: 'half' } : {}),
      })
      const response = await handler(request)
      outgoing.writeHead(response.status, Object.fromEntries(response.headers))
      outgoing.end(Buffer.from(await response.arrayBuffer()))
    } catch (error) {
      outgoing.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      outgoing.end(JSON.stringify({ error: { code: 'LOCAL_SERVER_ERROR', message: '로컬 보스전 서버 요청에 실패했습니다.' } }))
    }
  })
  return {
    server,
    async listen() {
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
      const address = server.address()
      origin = `http://127.0.0.1:${address.port}`
      return `${origin}/api/raid`
    },
    async close() { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) },
  }
}

async function startRaidApi() {
  const store = createMemoryRankedStore()
  const resolvePokemon = async (identity, selected) => {
    const pokemon = boxes[identity.uid.replace('ranked-test-', '')]?.find(entry => entry.captureId === selected?.captureId)
    if (!pokemon) {
      const error = new Error('Fixture does not own the requested Pokemon')
      error.code = 'POKEMON_NOT_OWNED'
      error.status = 403
      throw error
    }
    return structuredClone(pokemon)
  }
  const service = createRaidService({
    store,
    engine: raidEngine,
    resolvePokemon,
    now: () => clock,
    newId: () => `raidui${++idSequence}`,
    makeSeed: () => 0x5a17 + idSequence,
    // The real engine still determines the turn; a shorter deadline only keeps
    // accidental test waits bounded.
    timeouts: { command: 45_000 },
  })
  const handler = createRaidHttpHandler({
    enabled: true,
    service,
    authenticate: createLocalRaidAuthenticator({ enabled: true, production: false }),
    allowLocalOrigins: true,
    now: () => clock,
  })
  const runtime = loopbackServer(handler)
  const url = await runtime.listen()
  return { url, store, service, close: async () => { await runtime.close(); await store.close() } }
}

const styles = ['styles', 'screenRedesign', 'battleGen5', 'titleCleanup', 'battleGimmicks', 'moveAnimationDirector', 'mobileLandscape', 'battleHub', 'gameTextScale']
const entry = `import React,{useMemo,useState} from 'react';import{createRoot}from'react-dom/client';
import RaidScreen from '/src/RaidScreen.jsx';import BattleHub from '/src/BattleHub.jsx';import{createRaidClient}from'/src/raidClient.js';import{applyGameTextScale}from'/src/gameTextScale.js';import'/src/mobileViewport.js';
${styles.map(name => `import '/src/${name}.css';`).join('\n')}
const fixture=window.__raidFixture;window.__raidEvents={requests:[],rewards:[],battleActive:false};window.__raidRace={};window.__applyRaidTextScale=applyGameTextScale;
function Harness(){const[inRaid,setInRaid]=useState(!fixture.startAtHub);const[active,setActive]=useState(false);
const client=useMemo(()=>{const actual=createRaidClient({getIdToken:async()=>'ranked-test-'+fixture.identity,apiUrl:fixture.apiUrl});
const request=async(...args)=>{const entry={action:args[0],payload:args[1]};window.__raidEvents.requests.push(entry);try{const value=await actual.request(...args);const race=window.__raidRace;if(args[0]==='status'&&race?.holdNextStatus){race.holdNextStatus=false;race.statusFetched=true;race.statusRevision=value?.raid?.revision??null;race.statusLifecycle=value?.raid?.lifecycle??null;await new Promise(resolve=>{race.release=resolve})}entry.response={roomId:value?.room?.id,raidId:value?.raid?.id,room:value?.room?.status,raid:value?.raid?.lifecycle,revision:value?.raid?.revision??null,turn:value?.raid?.turnNumber??null,result:Boolean(value?.result??value?.raid?.result)};window.__lastRaidSnapshot=value;return value}catch(error){entry.error={message:error?.message,code:error?.code,status:error?.status};throw error}};
const exposed={request,catalog:(payload,options)=>request('catalog',payload,options),rooms:(payload,options)=>request('rooms',payload,options),status:(payload,options)=>request('status',payload,options)};window.__raidClient=exposed;return exposed},[]);
return React.createElement('div',{className:'app-shell raid-view'+(active?' battle-view':'')},
React.createElement('header',{className:'topbar'},React.createElement('div',{className:'brand'},React.createElement('strong',null,'POKÉMON CHAMPIONS ARENA')),React.createElement('span',null,'LOCAL RAID UI VALIDATION')),
inRaid?React.createElement(RaidScreen,{enabled:true,client,user:{uid:'ranked-test-'+fixture.identity,displayName:'로컬 '+fixture.identity,isLocalGuest:false},boxPokemon:fixture.boxPokemon,onBack:()=>setInRaid(false),onBeforeJoin:async()=>true,onBattleActiveChange:value=>{setActive(value);window.__raidEvents.battleActive=value},soundEnabled:false,audioSettings:{enabled:false},gameSettings:{attackAnimation:'normal',hpBarSpeed:'normal',showDamageNumbers:true},onReceiveVpRewards:async rewards=>window.__raidEvents.rewards.push(rewards)})
:React.createElement(BattleHub,{onBack:()=>{},onSelectAi:()=>{},onSelectRanked:()=>{},onSelectFactory:()=>{},onSelectRooms:()=>{},onSelectRaid:()=>setInRaid(true)}))}
createRoot(document.getElementById('root')).render(React.createElement(Harness));`
const html = '<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body><div id="root"></div><script type="module" src="/raid-ui-entry.js"></script></body></html>'

async function startVite() {
  const server = await createViteServer({
    root,
    cacheDir: path.join(output, 'vite'),
    mode: 'raid-ui-validation',
    logLevel: 'error',
    plugins: [{
      name: 'raid-ui-entry', enforce: 'pre',
      configureServer(viteServer) {
        viteServer.middlewares.use(async (request, response, next) => {
          if (new URL(request.url, 'http://localhost').pathname !== '/raid-ui.html') { next(); return }
          response.setHeader('Content-Type', 'text/html')
          response.end(await viteServer.transformIndexHtml('/raid-ui.html', html))
        })
      },
      resolveId(source) {
        if (source === '/raid-ui-entry.js') return source
        if (/\/auth\/firebaseClient(?:\.js)?$/.test(source) || source === './firebaseClient') return '\0raid-ui-offline-auth'
      },
      load(id) {
        if (id === '/raid-ui-entry.js') return entry
        if (id === '\0raid-ui-offline-auth') return 'export const firebaseAuth=null;export const firebaseDb=null;export const isFirebaseConfigured=false;export const missingFirebaseEnvironmentVariables=[];'
      },
    }],
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
  })
  await server.listen()
  return server
}

async function openPlayer(identity, viewport, { startAtHub = false } = {}) {
  const context = await browser.newContext({ viewport, hasTouch: false, isMobile: false })
  await context.addInitScript(fixture => { window.__raidFixture = fixture }, { apiUrl: api.url, identity, boxPokemon: boxes[identity], startAtHub })
  await context.route('**/*', async route => {
    const url = new URL(route.request().url())
    // Sprite artwork is part of the shipped game presentation. Permit its
    // known static CDNs while all APIs remain restricted to this test's
    // loopback raid service.
    if (!['127.0.0.1', 'localhost', '[::1]', 'play.pokemonshowdown.com', 'raw.githubusercontent.com'].includes(url.hostname)) {
      blockedRequests.push({ identity, url: url.href })
      await route.abort('blockedbyclient')
      return
    }
    await route.continue()
  })
  const page = await context.newPage()
  page.setDefaultTimeout(25_000)
  page.on('pageerror', error => browserErrors.push({ identity, message: error.message }))
  page.on('response', async response => {
    if (response.url().includes('/api/raid') && response.status() >= 400) {
      const body = await response.json().catch(() => ({}))
      const code = body?.error?.code ?? body?.code
      // A peer may resolve an input turn between this player's fresh read and
      // POST. The harness deliberately retries that server-authoritative
      // transition, so retain it as diagnostic evidence rather than mixing it
      // with transport or UI failures.
      if (code === 'STALE_DECISION' || code === 'WRONG_PHASE') expectedHttpConflicts.push({ identity, status: response.status(), body })
      else httpFailures.push({ identity, status: response.status(), body })
    }
  })
  await page.goto(`${vite.resolvedUrls.local[0].replace(/\/$/, '')}/raid-ui.html`)
  await page.locator('.raid-lobby-screen, .battle-hub').waitFor()
  return { identity, context, page }
}

async function apiRequest(player, action, payload = {}) {
  return player.page.evaluate(({ action, payload }) => window.__raidClient.request(action, payload), { action, payload })
}

async function reopenRaid(player) {
  await player.page.reload()
  await player.page.locator('.raid-lobby-screen, .raid-room-screen, .raid-battle-screen, .raid-intermission-screen, .raid-result-screen, .battle-hub').waitFor()
  if (await player.page.locator('.battle-hub-card.raid').count()) {
    await player.page.locator('.battle-hub-card.raid').click()
    await player.page.locator('.battle-hub-enter').click()
    await player.page.locator('.raid-lobby-screen, .raid-room-screen, .raid-battle-screen, .raid-intermission-screen, .raid-result-screen').waitFor()
  }
}

async function reloadIntoLatestRaid(player) {
  await reopenRaid(player)
  await player.page.locator('.raid-battle-screen, .raid-intermission-screen, .raid-result-screen').waitFor()
  await waitForRaidPlayback(player)
}

// RaidScreen presents newly received public events before enabling commands.
// Do not inspect a transient frame or click through the menu while that queue
// is still applying a server turn.
async function waitForRaidPlayback(player) {
  await player.page.waitForFunction(() => {
    const screen = document.querySelector('.raid-battle-screen')
    if (!screen) return true
    const commands = screen.querySelector('.raid-standard-commands')
    return Boolean(commands)
      && !commands.classList.contains('is-turn-locked')
      && commands.getAttribute('aria-busy') !== 'true'
  })
}

async function capture(player, label, selectors) {
  await waitForRaidPlayback(player)
  await player.page.evaluate(() => document.fonts.ready)
  await player.page.waitForTimeout(200)
  const geometry = await player.page.evaluate(selectors => ({
    viewport: { width: innerWidth, height: innerHeight },
    scroll: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
    roomViewport: (() => {
      const app = document.querySelector('.app-shell')
      const room = document.querySelector('.raid-room-screen')
      const layout = document.querySelector('.raid-room-layout')
      const value = node => node ? getComputedStyle(node) : null
      const appStyle = value(app)
      const roomStyle = value(room)
      const layoutStyle = value(layout)
      return {
        tabletRule: matchMedia('(min-width: 721px) and (max-width: 1050px)').matches,
        appHasDirectRoom: Boolean(app?.matches('.app-shell.raid-view:not(.battle-view):has(> .raid-room-screen)')),
        app: appStyle && { display: appStyle.display, height: appStyle.height, minHeight: appStyle.minHeight, overflow: appStyle.overflow },
        room: roomStyle && { display: roomStyle.display, height: roomStyle.height, minHeight: roomStyle.minHeight, overflow: roomStyle.overflow },
        layout: layoutStyle && { display: layoutStyle.display, height: layoutStyle.height, minHeight: layoutStyle.minHeight, gridTemplateColumns: layoutStyle.gridTemplateColumns },
      }
    })(),
    elements: selectors.flatMap(selector => [...document.querySelectorAll(selector)].filter(node => node.getClientRects().length).map(node => {
      const box = node.getBoundingClientRect()
      return { selector, text: node.textContent.trim().slice(0, 80), left: box.left, top: box.top, right: box.right, bottom: box.bottom }
    })),
  }), selectors)
  layouts.push({ label, ...geometry })
  // Keep failing viewports for visual review too; geometry assertions run
  // after this capture rather than discarding the useful evidence.
  await player.page.screenshot({ path: path.join(output, `${label}.png`) })
  assert(geometry.scroll.width <= geometry.viewport.width + 1, `${label}: horizontal overflow`)
  for (const box of geometry.elements) {
    assert(box.left >= -1 && box.right <= geometry.viewport.width + 1, `${label}: horizontal clipping (${box.selector})`)
    assert(box.top >= -1 && box.bottom <= geometry.viewport.height + 1, `${label}: vertical clipping (${box.selector})`)
  }
}

async function captureReachableRoomActions(player, label) {
  const before = await player.page.locator('.raid-room-entry').evaluate(node => ({
    clientHeight: node.clientHeight,
    scrollHeight: node.scrollHeight,
    scrollTop: node.scrollTop,
    overflowY: getComputedStyle(node).overflowY,
  }))
  // At a 2× game-text scale the room deliberately keeps its main viewport
  // fixed and moves long loadout content into its own scroll pane. The ready
  // controls are still a critical action, so prove they can reach the visible
  // area instead of falsely requiring every child of that pane at scrollTop 0.
  assert(before.scrollHeight > before.clientHeight, `${label}: expected a scrollable room-entry pane at 2× text scale`)
  await player.page.locator('.raid-room-entry').evaluate(node => { node.scrollTop = node.scrollHeight })
  await player.page.waitForTimeout(80)
  const after = await player.page.locator('.raid-room-entry').evaluate(node => ({
    clientHeight: node.clientHeight,
    scrollHeight: node.scrollHeight,
    scrollTop: node.scrollTop,
  }))
  assert(after.scrollTop > 0, `${label}: room-entry controls cannot be reached by its scroll pane`)
  await capture(player, label, ['.raid-room-members', '.raid-room-entry', '.raid-room-actions'])
  await player.page.locator('.raid-room-entry').evaluate(node => { node.scrollTop = 0 })
}

async function choosePokemonAndReady(player) {
  await player.page.locator('.raid-owned-grid button').first().click()
  await player.page.locator('.raid-room-screen').waitFor()
  await player.page.getByRole('button', { name: '준비 완료', exact: true }).click()
  await player.page.locator('.raid-member-slot.own.ready').waitFor()
}

async function chooseBoss(player, index = 0) {
  await player.page.locator('.raid-boss-grid .raid-boss-card').nth(index).click()
  await player.page.locator('.raid-room-list').waitFor()
}

async function leaveRoomFromUi(player) {
  await player.page.getByRole('button', { name: '나가기', exact: true }).click()
  await player.page.locator('.raid-lobby-screen').waitFor()
}

async function roomEnter(player) {
  await chooseBoss(player)
  await player.page.locator('.raid-room-card button').first().click()
  // Public rooms show a confirmation dialog before the server reserves a
  // participant slot. The browser journey must exercise that real join
  // mutation rather than assuming the card click itself joins.
  await player.page.getByRole('dialog', { name: '보스전 방 참가' }).getByRole('button', { name: '참가하기', exact: true }).click()
  await player.page.locator('.raid-pokemon-picker').waitFor()
  await choosePokemonAndReady(player)
}

async function clickUiCommand(player, useGimmick = false) {
  const page = player.page
  await waitForRaidPlayback(player)
  const commands = page.locator('.raid-standard-commands')
  await commands.waitFor()
  const before = await page.evaluate(() => window.__raidEvents.requests.filter(entry => entry.action === 'raidSubmit').length)
  await commands.locator('.battle-command-buttons > button.fight').click()
  const moves = commands.locator('.battle-move-button:not(:disabled)')
  await moves.first().waitFor()
  const gimmicks = commands.locator('.battle-gimmick-selector button:not(:disabled)')
  if (useGimmick && await gimmicks.count()) await gimmicks.first().click()
  await moves.first().click()
  await page.waitForFunction(beforeCount => {
    const submitted = window.__raidEvents.requests.filter(entry => entry.action === 'raidSubmit').length > beforeCount
    return submitted || Boolean(document.querySelector('.raid-standard-commands .battle-target-card:not(:disabled)'))
  }, before)
  const targets = commands.locator('.battle-target-card:not(:disabled)')
  if (await targets.count()) await targets.first().click()
  await page.waitForFunction(beforeCount => window.__raidEvents.requests.filter(entry => entry.action === 'raidSubmit').length > beforeCount, before)
  await page.waitForFunction(beforeCount => {
    const entry = window.__raidEvents.requests.filter(item => item.action === 'raidSubmit')[beforeCount]
    return Boolean(entry?.response || entry?.error)
  }, before)
}

function bestCommand(snapshot) {
  const raid = snapshot?.raid
  const battle = raid?.battle
  assert(raid?.id && battle, 'Expected a live server raid projection')
  const moves = (battle.moves ?? []).filter(move => !move.disabled && Number(move.currentPp ?? 1) > 0)
    .map(move => ({ ...move, target: (move.targets ?? []).find(target => target.sideId === 'opponent') }))
    .filter(move => move.target?.actorId)
    .sort((a, b) => Number(b.power ?? 0) - Number(a.power ?? 0))
  // A fainted ally intentionally has no legal action. It still occupies a
  // human raid slot until the server deadline, where the authoritative engine
  // resolves the turn without a command for that actor.
  if (!moves.length) return null
  const move = moves[0]
  return {
    raidId: raid.id,
    revision: raid.revision,
    decisionToken: raid.decisionToken,
    commandVersion: Number(raid.ownCommandVersion ?? 0) + 1,
    command: { actorId: raid.ownActorId, type: 'move', moveIndex: move.moveIndex, targetActorId: move.target.actorId },
  }
}

async function advanceOneServerTurn() {
  let latest = null
  for (const player of players) {
    const snapshot = await apiRequest(player, 'status')
    if (snapshot.raid?.lifecycle !== 'input') return snapshot
    if (snapshot.raid?.submitted) {
      latest = snapshot
      continue
    }
    const command = bestCommand(snapshot)
    if (!command) {
      latest = snapshot
      continue
    }
    try {
      latest = await apiRequest(player, 'raidSubmit', command)
    } catch (error) {
      // A teammate can resolve the turn between this fresh read and POST. The
      // server is authoritative, so re-read rather than treating the stale
      // decision as a client failure.
      if (error?.code === 'STALE_DECISION' || error?.code === 'WRONG_PHASE') {
        latest = await apiRequest(player, 'status')
        if (latest.raid?.lifecycle !== 'input') return latest
        continue
      }
      throw error
    }
  }
  const current = latest?.raid?.lifecycle === 'input' ? latest : await apiRequest(players[0], 'status')
  if (current.raid?.lifecycle !== 'input') return current
  const deadline = Number(current.raid?.deadlineAt)
  if (Number.isFinite(deadline)) clock = Math.max(clock, deadline + 1)
  // No fake command is invented for a fainted trainer. If a prior request
  // raced a phase change or an actor has no enabled move, a real heartbeat
  // claims the now-expired server turn and lets the engine apply its
  // deterministic timeout policy.
  return apiRequest(players[0], 'raidHeartbeat', { raidId: current.raid.id })
}

async function status(player = players[0]) { return apiRequest(player, 'status') }

async function playUntil(predicate, label, maxTurns = 16) {
  for (let turn = 0; turn < maxTurns; turn += 1) {
    const current = await status()
    if (predicate(current)) return current
    if (current.raid?.lifecycle === 'intermission') {
      try {
        const next = await apiRequest(players[0], 'raidAdvance', {
          raidId: current.raid.id,
          decisionToken: current.raid.decisionToken,
        })
        if (predicate(next)) return next
      } catch (error) {
        if (error?.code !== 'STALE_DECISION' && error?.code !== 'WRONG_PHASE') throw error
      }
      continue
    }
    // Reset the HTTP test bucket between full server-authoritative turns while
    // staying well inside the real command deadline.
    clock += 10_001
    const next = await advanceOneServerTurn()
    if (predicate(next)) return next
  }
  const final = await status()
  assert(predicate(final), `${label}: expected state was not reached`)
  return final
}

function bossActor(snapshot) {
  const battle = snapshot?.raid?.battle
  return battle?.opponent?.team?.find(actor => actor.actorId === battle?.raid?.primaryBossId) ?? battle?.opponent?.team?.[0]
}

function resultOf(snapshot) { return snapshot?.result ?? snapshot?.raid?.result ?? null }

function publicBattleState(snapshot) {
  const raid = snapshot?.raid
  const boss = bossActor(snapshot)
  assert(raid?.id && raid?.battle, 'Expected a full active raid projection for view agreement')
  return {
    raidId: raid.id,
    revision: Number(raid.revision),
    lifecycle: raid.lifecycle,
    stage: Number(raid.stage ?? raid.phase),
    phase: Number(raid.phase ?? raid.stage),
    turn: Number(raid.turnNumber ?? raid.battle?.turn),
    boss: boss ? {
      actorId: boss.actorId,
      hp: Math.ceil(Number(boss.hp)),
      maxHp: Math.ceil(Number(boss.maxHp)),
      form: boss.raidForm ?? boss.form ?? boss.raidFormId ?? null,
    } : null,
  }
}

async function reloadAndCompareBattleViews(label) {
  const serverViews = await Promise.all(players.map(player => status(player)))
  const expected = publicBattleState(serverViews[0])
  for (const view of serverViews.slice(1)) assert.deepEqual(publicBattleState(view), expected, `${label}: server projections disagree`)

  await Promise.all(players.map(player => reloadIntoLatestRaid(player)))
  await Promise.all(players.map(waitForRaidPlayback))
  const rendered = []
  for (const player of players) {
    const value = await player.page.evaluate(() => {
      const turnText = document.querySelector('.battle-game-turn strong')?.textContent ?? ''
      const hpText = document.querySelector('.raid-standard-boss-hud .raid-boss-hp footer span')?.textContent ?? ''
      const numbers = [...hpText.matchAll(/\d[\d,]*/g)].map(match => Number(match[0].replaceAll(',', '')))
      return {
        turn: Number((turnText.match(/\d+/) ?? [])[0] ?? NaN),
        hp: numbers[0] ?? null,
        maxHp: numbers[1] ?? null,
        form: document.querySelector('.battle-pokemon-stage.opponent.raid-form-armored') ? 'armored'
          : document.querySelector('.battle-pokemon-stage.opponent.raid-form-dark') ? 'dark' : null,
      }
    })
    assert.equal(value.turn, expected.turn, `${label}: ${player.identity} rendered stale turn`)
    assert.equal(value.hp, expected.boss?.hp ?? null, `${label}: ${player.identity} rendered stale boss HP`)
    assert.equal(value.maxHp, expected.boss?.maxHp ?? null, `${label}: ${player.identity} rendered stale boss max HP`)
    assert.equal(value.form, expected.boss?.form ?? null, `${label}: ${player.identity} rendered stale boss form`)
    rendered.push({ identity: player.identity, ...value })
  }
  viewAgreements.push({ label, expected, rendered })
  return expected
}

try {
  api = await startRaidApi()
  vite = await startVite()
  const require = createRequire(new URL('../promo/package.json', import.meta.url))
  const { chromium } = require('playwright')
  browser = await chromium.launch({ headless: true, executablePath: await resolveChromiumExecutable(chromium) })
  players.push(
    await openPlayer('alice', { width: 1440, height: 900 }, { startAtHub: true }),
    await openPlayer('bob', { width: 1280, height: 720 }),
    await openPlayer('charlie', { width: 932, height: 430 }),
  )
  const [host, bob, charlie] = players

  await check('feature gate hides raid card without an explicit callback and displays it in the enabled harness', async () => {
    assert.equal(await host.page.locator('.battle-hub-card').count(), 5)
    assert.equal(await host.page.locator('.battle-hub-card.raid').count(), 1)
    await capture(host, '1440x900-hub', ['.battle-hub-heading', '.battle-hub-card.raid'])
    await host.page.locator('.battle-hub-card.raid').click()
    await host.page.locator('.battle-hub-enter').click()
    await host.page.locator('.raid-boss-grid').waitFor()
    assert.equal(await host.page.locator('.raid-boss-grid .raid-boss-card').count(), 3)
    await capture(host, '1440x900-bosses', ['.raid-page-header', '.raid-boss-grid'])
  })

  await check('a private invite code is shown once, stays out of public listings, and admits a code-only join', async () => {
    await chooseBoss(host)
    await host.page.getByRole('button', { name: '방 만들기', exact: true }).click()
    const dialog = host.page.getByRole('dialog', { name: '보스전 방 만들기', exact: true })
    await dialog.getByLabel('방 제목', { exact: true }).fill('UI 비공개 초대 검증')
    await dialog.getByLabel('비공개 방', { exact: true }).check()
    await dialog.getByRole('button', { name: '방 만들기', exact: true }).click()
    const invite = host.page.getByRole('dialog', { name: '초대 코드를 공유하세요', exact: true })
    await invite.waitFor()
    const inviteCode = (await invite.locator('.raid-invite-code').textContent()).trim()
    assert.match(inviteCode, /^[A-HJ-NP-Z2-9]{8}$/)
    await capture(host, '1440x900-private-invite', ['.raid-invite-dialog', '.raid-invite-code'])

    const hostPrivate = await status(host)
    const privateRoomId = hostPrivate.room?.id
    assert(privateRoomId, 'Private host must receive its own waiting-room projection')
    const outsiderView = await status(charlie)
    assert.equal(outsiderView.rooms.some(room => room.id === privateRoomId), false, 'Private room must not appear in a public room list')
    assert.equal(JSON.stringify(outsiderView.rooms).includes(inviteCode), false, 'Invite code must not leak through the public room list')

    await invite.getByRole('button', { name: '초대 코드 닫기', exact: true }).click()
    await host.page.locator('.raid-pokemon-picker').waitFor()
    await reopenRaid(bob)
    await chooseBoss(bob)
    await bob.page.getByRole('button', { name: '초대 코드 참가', exact: true }).click()
    const joinDialog = bob.page.getByRole('dialog', { name: '초대 코드로 보스전 참가', exact: true })
    await joinDialog.getByLabel('8자리 초대 코드', { exact: true }).fill(inviteCode)
    await capture(bob, '1280x720-private-join', ['.raid-room-dialog'])
    await joinDialog.getByRole('button', { name: '참가하기', exact: true }).click()
    await bob.page.locator('.raid-pokemon-picker').waitFor()

    await host.page.locator('.raid-owned-grid button').first().click()
    await host.page.locator('.raid-room-screen').waitFor()
    await host.page.setViewportSize({ width: 1024, height: 768 })
    await host.page.evaluate(() => window.__applyRaidTextScale(2))
    assert.equal(await host.page.evaluate(() => document.documentElement.dataset.gameTextScale), '2')
    assert.equal(await host.page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--game-text-scale').trim()), '2')
    await capture(host, '1024x768-text-scale-2-private-room', ['.raid-room-members', '.raid-room-entry'])
    await captureReachableRoomActions(host, '1024x768-text-scale-2-private-room-actions')
    await host.page.evaluate(() => window.__applyRaidTextScale(1))
    await host.page.setViewportSize({ width: 1440, height: 900 })
    await bob.page.locator('.raid-owned-grid button').first().click()
    await bob.page.locator('.raid-room-screen').waitFor()
    await leaveRoomFromUi(bob)
    // Bob's departure increments the room revision. Reload before leaving as
    // host so this browser journey uses the current server revision instead
    // of treating a stale lobby snapshot as a successful exit.
    await reopenRaid(host)
    await host.page.locator('.raid-room-screen').waitFor()
    await leaveRoomFromUi(host)
    const cleared = await status(host)
    assert.equal(cleared.room, null, 'Leaving the private test lobby clears the host membership')
    assert.equal(cleared.rooms.some(room => room.id === privateRoomId), false, 'The private room is removed when its host leaves')
  })

  await check('three real users create a room, select one owned Pokemon each, and ready through HTTP', async () => {
    await chooseBoss(host)
    await host.page.getByRole('button', { name: '방 만들기', exact: true }).click()
    const dialog = host.page.getByRole('dialog', { name: '보스전 방 만들기', exact: true })
    await dialog.getByLabel('방 제목', { exact: true }).fill('UI 협동 레이드')
    await dialog.getByRole('button', { name: '방 만들기', exact: true }).click()
    await host.page.locator('.raid-pokemon-picker').waitFor()
    await choosePokemonAndReady(host)

    for (const player of [bob, charlie]) {
      await reopenRaid(player)
      await player.page.locator('.raid-lobby-screen').waitFor()
      await roomEnter(player)
    }
    // Every new entrant clears ready state, so reload all isolated views and
    // submit a fresh owned capture selection for every player. Earlier
    // iterations of this loop can already make a later player ready, so only
    // issue a mutation where the server projection still requires it.
    for (const player of players) {
      await reopenRaid(player)
      await player.page.locator('.raid-room-screen').waitFor()
      const ownReady = player.page.locator('.raid-member-slot.own.ready')
      if (!await ownReady.count()) {
        const readyButton = player.page.getByRole('button', { name: '준비 완료', exact: true })
        if (await readyButton.isEnabled()) await readyButton.click()
      }
      await ownReady.waitFor()
    }
    await reopenRaid(host)
    await host.page.locator('.raid-room-screen').waitFor()
    assert(await host.page.getByRole('button', { name: '보스전 시작', exact: true }).isEnabled())
    const snapshot = await status(host)
    assert.equal(snapshot.room.memberCount, 3)
    assert(snapshot.room.members.every(member => !member.isOwn || member.selectedPokemon.captureId), 'Only the owner receives a capture id')
    assert(snapshot.room.members.filter(member => !member.isOwn).every(member => !('captureId' in (member.selectedPokemon ?? {}))), 'Other player capture ids stay private')
  })

  await check('a delayed pre-command status response cannot overwrite the submitted local action', async () => {
    await host.page.getByRole('button', { name: '보스전 시작', exact: true }).click()
    for (const player of [bob, charlie]) await reloadIntoLatestRaid(player)
    await host.page.locator('.raid-battle-screen').waitFor()
    await capture(bob, '1280x720-stage-one', ['.battle-game-header', '.raid-standard-battle-arena', '.raid-standard-commands'])

    await host.page.evaluate(() => { window.__raidRace = { holdNextStatus: true, statusFetched: false } })
    let released = false
    try {
      // The normal 1.5s real UI poll reads the pre-command projection, then
      // waits inside the test-only wrapper. The next local mutation must fence
      // that completed-but-late read before it reaches RaidScreen.accept().
      await host.page.waitForFunction(() => window.__raidRace?.statusFetched === true)
      const staleRevision = await host.page.evaluate(() => window.__raidRace?.statusRevision)
      assert(Number.isInteger(staleRevision), 'The held status response must be a real raid projection')
      await clickUiCommand(host, true)
      await host.page.getByRole('button', { name: '선택 취소', exact: true }).waitFor()
      await host.page.evaluate(() => window.__raidRace?.release?.())
      released = true
      await host.page.waitForTimeout(150)
      assert.equal(await host.page.getByRole('button', { name: '선택 취소', exact: true }).count(), 1, 'Late status must not remove the locally submitted action')
      assert.equal(await host.page.locator('.raid-standard-commands .battle-move-button:not(:disabled)').count(), 0, 'Late status must not re-enable moves after submit')
      const latest = await status(host)
      assert(latest.raid?.revision > staleRevision, 'The server command revision must remain newer than the held status response')
      assert.equal(latest.raid?.submitted, true)
    } finally {
      if (!released) await host.page.evaluate(() => window.__raidRace?.release?.()).catch(() => {})
    }
  })

  await check('stage one action submits an owned actor, a real target, and a legal gimmick when offered', async () => {
    await clickUiCommand(bob)
    await clickUiCommand(charlie)
    const commands = (await Promise.all(players.map(player => player.page.evaluate(() => window.__raidEvents.requests
      .filter(entry => entry.action === 'raidSubmit').map(entry => entry.payload.command))))).flat()
    assert.equal(commands.length, 3)
    assert(typeof commands[0].actorId === 'string' && typeof commands[0].targetActorId === 'string')
    assert.equal(commands[0].type, 'move')
    assert(Number.isInteger(commands[0].moveIndex))
  })

  await check('the real server reaches the stage-two gate and the UI advances it', async () => {
    const intermission = await playUntil(snapshot => snapshot.raid?.lifecycle === 'intermission', 'stage one intermission')
    assert.equal(intermission.raid.stage, 1)
    await host.page.setViewportSize({ width: 844, height: 390 })
    await reopenRaid(host)
    await host.page.locator('.raid-intermission-screen').waitFor()
    await capture(host, '844x390-intermission', ['.raid-intermission-screen > section', '.raid-intermission-party', '.raid-intermission-screen .raid-primary'])
    await host.page.getByRole('button', { name: '본 보스전 시작', exact: true }).click()
    await host.page.locator('.raid-battle-screen').waitFor()
    const afterAdvance = await status(host)
    assert.equal(afterAdvance.raid.stage, 2)
    assert.equal(afterAdvance.raid.lifecycle, 'input')
  })

  await check('stage-two 50 percent form and four-segment boss HP render from the safe engine projection', async () => {
    const armored = await playUntil(snapshot => bossActor(snapshot)?.raidForm === 'armored', 'armored Mewtwo 50% gate', 18)
    assert.equal(armored.raid.battle.raid.phase, 2)
    const agreed = await reloadAndCompareBattleViews('armored-mewtwo-refresh')
    assert.equal(agreed.boss?.form, 'armored')
    await capture(host, '844x390-armored-gate', ['.battle-game-header', '.raid-standard-battle-arena', '.raid-standard-commands'])
    await charlie.page.locator('.battle-pokemon-stage.opponent.raid-form-armored').waitFor()
    await capture(charlie, '932x430-armored-gate', ['.raid-standard-boss-hud .raid-boss-hp', '.battle-pokemon-stage.opponent.raid-form-armored', '.raid-standard-commands'])
    assert.equal(await charlie.page.locator('.raid-boss-hp-track > b').count(), 3)
  })

  await check('a terminal result survives reconnect, displays the server VP, and dismisses without restoring the old raid', async () => {
    const finished = await playUntil(snapshot => Boolean(resultOf(snapshot)), 'terminal raid result', 40)
    const expectedResult = resultOf(finished)
    assert(expectedResult?.raidId && expectedResult?.bossId, 'Terminal result must retain its raid and boss ids for reconnect dismissal')
    await host.page.setViewportSize({ width: 1440, height: 900 })
    await Promise.all(players.map(player => reloadIntoLatestRaid(player)))
    for (const player of players) await player.page.locator('.raid-result-screen').waitFor()
    await capture(host, '1440x900-terminal-result', ['.raid-result-screen > section', '.raid-result-vp'])

    const resultViews = await Promise.all(players.map(player => status(player)))
    for (const view of resultViews) {
      const receipt = resultOf(view)
      assert.equal(receipt?.raidId, expectedResult.raidId)
      assert.equal(receipt?.bossId, expectedResult.bossId)
    }
    for (const player of players) {
      const expectedView = resultViews[players.indexOf(player)]
      const expectedVp = ['win', 'won', 'victory', 'cleared', 'success'].includes(String(resultOf(expectedView)?.outcome ?? '').toLowerCase())
        ? Number(expectedView.rewards?.vp ?? expectedView.rewards?.vpGranted ?? resultOf(expectedView)?.rewardVp ?? 0) : 0
      const renderedVp = await player.page.evaluate(() => {
        const text = document.querySelector('.raid-result-vp strong')?.textContent ?? ''
        return Number((text.match(/[\d,]+/) ?? ['0'])[0].replaceAll(',', ''))
      })
      assert.equal(renderedVp, expectedVp, `${player.identity} must render its server-settled VP receipt`)
    }

    // The first reload above commonly receives a compact result-only header.
    // Dismissing through that screen proves the UI uses result.raidId rather
    // than a retained full battle object.
    await host.page.getByRole('button', { name: '보스전 로비로', exact: true }).click()
    await host.page.locator('.raid-lobby-screen').waitFor()
    assert.equal(resultOf(await status(host)), null, 'Dismissal clears only the current player result pointer')
    await reopenRaid(host)
    await host.page.locator('.raid-lobby-screen').waitFor()
    assert.equal(await host.page.locator('.raid-result-screen').count(), 0, 'Reconnect after dismissal must not restore the old result screen')

    for (const player of [bob, charlie]) {
      await player.page.getByRole('button', { name: '보스전 로비로', exact: true }).click()
      await player.page.locator('.raid-lobby-screen').waitFor()
      assert.equal(resultOf(await status(player)), null, `${player.identity} dismissal clears its own result pointer`)
    }
  })

  await check('no application errors or failed raid HTTP requests were emitted', async () => {
    assert.deepEqual(browserErrors, [])
    assert.deepEqual(httpFailures, [])
  })
} finally {
  for (const player of players) {
    try {
      diagnostics.push({
        identity: player.identity,
        url: player.page.url(),
        page: await player.page.evaluate(() => ({
          screen: document.querySelector('.raid-battle-screen,.raid-room-screen,.raid-lobby-screen,.raid-result-screen,.battle-hub')?.className ?? '',
          text: document.body.innerText.slice(0, 1_500),
          events: window.__raidEvents,
          snapshot: window.__lastRaidSnapshot,
        })),
      })
      await player.page.screenshot({ path: path.join(output, `debug-${player.identity}.png`) })
    } catch {}
  }
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ checks, browserErrors, httpFailures, expectedHttpConflicts, blockedRequests, layouts, viewAgreements, diagnostics }, null, 2))
  await Promise.allSettled(players.map(player => player.context.close()))
  await browser?.close()
  await vite?.close()
  await api?.close()
}
