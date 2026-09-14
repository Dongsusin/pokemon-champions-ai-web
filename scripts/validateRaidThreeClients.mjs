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

// Three independent browser contexts exercise the shipped RaidScreen through
// its browser client and the real loopback HTTP handler.  Test fixtures only
// provide owned captures; no route, store, or battle HP is ever patched.
const root = fileURLToPath(new URL('../', import.meta.url))
const output = path.join(root, 'scripts/.cache/raid-three-clients')
const identities = ['alice', 'bob', 'charlie']
const uidFor = identity => `ranked-test-${identity}`
const styles = ['styles', 'screenRedesign', 'battleGen5', 'titleCleanup', 'battleGimmicks', 'moveAnimationDirector', 'mobileLandscape', 'battleHub']

const scenarios = Object.freeze([
  // Spiritomb is naturally immune to Mewtwo's Psychic/Fighting pressure, so
  // the live three-player run can demonstrate the 50% armored gate without
  // any artificial HP setup.
  { id: 'mewtwo', speciesId: 442, moves: ['darkpulse', 'shadowball', 'calmmind', 'nastyplot'], expectedForm: 'armored' },
  { id: 'hooh', speciesId: 382, moves: ['originpulse', 'waterspout', 'icebeam', 'thunder'], expectedSummon: true },
  { id: 'lugia', speciesId: 1008, moves: ['electrodrift', 'thunderbolt', 'calmmind', 'protect'], expectedForm: 'dark' },
])

const captureIdFor = (identity, bossId) => `three-${identity}-${bossId}`
const boxes = Object.fromEntries(identities.map(identity => [identity, scenarios.map(scenario => (
  createRaidPreset({ speciesId: scenario.speciesId, moves: scenario.moves }, captureIdFor(identity, scenario.id))
))]))

const checks = []
const reports = []
const browserErrors = []
const httpFailures = []
const diagnostics = []
const captures = []
const players = []
let clock = Date.now()
let idSequence = 0
let seedSequence = 0
let activeSeed = 'raid-three-clients'
let api
let vite
let browser

async function check(name, callback) {
  try {
    await callback()
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
    const owner = String(identity?.uid ?? '').replace(/^ranked-test-/, '')
    const pokemon = boxes[owner]?.find(entry => entry.captureId === selected?.captureId)
    if (!pokemon) {
      const error = new Error('Fixture does not own the requested Pokémon')
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
    newId: () => `raidthree${++idSequence}`,
    makeSeed: () => `${activeSeed}:${++seedSequence}`,
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
  return { url: await runtime.listen(), store, close: async () => { await runtime.close(); await store.close() } }
}

// This intentionally mounts the real component instead of a hand-built DOM.
// It also exposes only the same browser client that RaidScreen receives, so
// direct turn progression still traverses fetch -> raidHttp -> raidService.
const entry = `import React,{useMemo,useState} from 'react';import{createRoot}from'react-dom/client';
import RaidScreen from '/src/RaidScreen.jsx';import{createRaidClient}from'/src/raidClient.js';import'/src/mobileViewport.js';
${styles.map(name => `import '/src/${name}.css';`).join('\n')}
const fixture=window.__raidFixture;window.__raidEvents={requests:[],rewards:[],battleActive:false};
function Harness(){const[active,setActive]=useState(false);const client=useMemo(()=>{const actual=createRaidClient({getIdToken:async()=>'ranked-test-'+fixture.identity,apiUrl:fixture.apiUrl});const request=async(...args)=>{const record={action:args[0],payload:args[1]};window.__raidEvents.requests.push(record);try{const value=await actual.request(...args);record.response={raidId:value?.raid?.id??value?.result?.raidId??null,lifecycle:value?.raid?.lifecycle??null};window.__lastRaidSnapshot=value;return value}catch(error){record.error={code:error?.code,message:error?.message,status:error?.status};throw error}};const exposed={request,catalog:(payload,options)=>request('catalog',payload,options),rooms:(payload,options)=>request('rooms',payload,options),status:(payload,options)=>request('status',payload,options)};window.__raidClient=exposed;return exposed},[]);return React.createElement('div',{className:'app-shell raid-view'+(active?' battle-view':'')},React.createElement(RaidScreen,{enabled:true,client,user:{uid:'ranked-test-'+fixture.identity,displayName:'로컬 '+fixture.identity,isLocalGuest:false},boxPokemon:fixture.boxPokemon,onBack:()=>{},onBeforeJoin:async()=>true,onBattleActiveChange:value=>{setActive(value);window.__raidEvents.battleActive=value},soundEnabled:false,audioSettings:{enabled:false},onReceiveVpRewards:async rewards=>window.__raidEvents.rewards.push(rewards)}))}
createRoot(document.getElementById('root')).render(React.createElement(Harness));`
const html = '<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body><div id="root"></div><script type="module" src="/raid-three-clients-entry.js"></script></body></html>'

async function startVite() {
  const server = await createViteServer({
    root,
    cacheDir: path.join(output, 'vite'),
    mode: 'raid-three-clients',
    logLevel: 'error',
    plugins: [{
      name: 'raid-three-clients-entry', enforce: 'pre',
      configureServer(viteServer) {
        viteServer.middlewares.use(async (request, response, next) => {
          if (new URL(request.url, 'http://localhost').pathname !== '/raid-three-clients.html') { next(); return }
          response.setHeader('Content-Type', 'text/html')
          response.end(await viteServer.transformIndexHtml('/raid-three-clients.html', html))
        })
      },
      resolveId(source) {
        if (source === '/raid-three-clients-entry.js') return source
        if (/\/auth\/firebaseClient(?:\.js)?$/.test(source) || source === './firebaseClient') return '\0raid-three-clients-offline-auth'
      },
      load(id) {
        if (id === '/raid-three-clients-entry.js') return entry
        if (id === '\0raid-three-clients-offline-auth') return 'export const firebaseAuth=null;export const firebaseDb=null;export const isFirebaseConfigured=false;export const missingFirebaseEnvironmentVariables=[];'
      },
    }],
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
  })
  await server.listen()
  return server
}

async function openPlayer(identity, viewport) {
  const context = await browser.newContext({ viewport, hasTouch: false, isMobile: false })
  await context.addInitScript(fixture => { window.__raidFixture = fixture }, {
    apiUrl: api.url,
    identity,
    boxPokemon: boxes[identity],
  })
  await context.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (!['127.0.0.1', 'localhost', '[::1]', 'play.pokemonshowdown.com', 'raw.githubusercontent.com'].includes(url.hostname)) {
      await route.abort('blockedbyclient')
      return
    }
    await route.continue()
  })
  const page = await context.newPage()
  page.setDefaultTimeout(30_000)
  page.on('pageerror', error => browserErrors.push({ identity, message: error.message }))
  page.on('response', async response => {
    if (response.url().includes('/api/raid') && response.status() >= 400) {
      httpFailures.push({ identity, status: response.status(), body: await response.json().catch(() => ({})) })
    }
  })
  await page.goto(`${vite.resolvedUrls.local[0].replace(/\/$/, '')}/raid-three-clients.html`)
  await page.locator('.raid-lobby-screen').waitFor()
  return { identity, context, page }
}

async function request(player, action, payload = {}) {
  return player.page.evaluate(({ action, payload }) => window.__raidClient.request(action, payload), { action, payload })
}

async function status(player) { return request(player, 'status') }

async function reloadScreen(player, expected) {
  await player.page.reload()
  await player.page.locator(expected).waitFor()
  await waitForRaidPlayback(player)
}

// A RaidScreen can show a public event queue after the HTTP projection has
// changed. Keep browser inspection and physical command clicks behind the
// same completion fence rather than interacting with an old turn.
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
  await player.page.waitForTimeout(150)
  if (await player.page.locator('.raid-battle-screen').count()) {
    selectors = [...new Set([...selectors,
      '.battle-pokemon-stage.player',
      '.battle-pokemon-stage.opponent',
      '.raid-standard-commands',
    ])]
  }
  const geometry = await player.page.evaluate(selectors => ({
    viewport: { width: innerWidth, height: innerHeight },
    scroll: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
    screen: document.querySelector('.raid-lobby-screen,.raid-room-screen,.raid-intermission-screen,.raid-battle-screen,.raid-result-screen')?.className ?? '',
    elements: selectors.flatMap(selector => [...document.querySelectorAll(selector)].filter(node => node.getClientRects().length).map(node => ({
      selector, text: node.textContent.trim().slice(0, 120), box: (() => { const rect = node.getBoundingClientRect(); return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } })(),
    }))),
  }), selectors)
  await player.page.screenshot({ path: path.join(output, `${label}.png`) })
  captures.push({ label, identity: player.identity, ...geometry })
  assert.equal(geometry.screen.includes('raid-'), true, `${label}: the real RaidScreen did not mount`)
  assert(geometry.scroll.width <= geometry.viewport.width + 1, `${label}: horizontal page overflow`)
  assert(geometry.scroll.height <= geometry.viewport.height + 1, `${label}: battle controls pushed below the viewport`)
  for (const { selector, box } of geometry.elements) {
    assert(box.left >= -1 && box.right <= geometry.viewport.width + 1, `${label}: horizontal clipping (${selector})`)
    assert(box.top >= -1 && box.bottom <= geometry.viewport.height + 1, `${label}: vertical clipping (${selector})`)
  }
  const actors = geometry.elements.filter(entry => entry.selector === '.battle-pokemon-stage.player' || entry.selector === '.battle-pokemon-stage.opponent')
  for (let i = 0; i < actors.length; i += 1) for (let j = i + 1; j < actors.length; j += 1) {
    const a = actors[i].box, b = actors[j].box
    const overlaps = Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1
      && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1
    assert(!overlaps, `${label}: Pokémon cards ${i} and ${j} overlap`)
  }
  return geometry
}

function primaryBoss(snapshot) {
  const battle = snapshot?.raid?.battle
  return battle?.opponent?.team?.find(actor => actor.actorId === battle?.raid?.primaryBossId) ?? battle?.opponent?.team?.[0] ?? null
}

function compactActor(actor) {
  if (!actor) return null
  return {
    actorId: actor.actorId ?? null,
    speciesId: actor.speciesId ?? null,
    hp: actor.hp ?? null,
    maxHp: actor.maxHp ?? null,
    fainted: Boolean(actor.fainted),
    status: actor.status ?? null,
    raidForm: actor.raidForm ?? null,
    raidVitalityStage: actor.raidVitalityStage ?? null,
  }
}

// Excludes viewer-specific move lists and own flags.  The remaining values are
// exactly the shared battle state every RaidScreen should render.
function sharedProjection(snapshot) {
  const raid = snapshot?.raid
  const battle = raid?.battle
  return {
    raidId: raid?.id ?? snapshot?.result?.raidId ?? null,
    bossId: raid?.bossId ?? snapshot?.result?.bossId ?? null,
    lifecycle: raid?.lifecycle ?? null,
    phase: raid?.phase ?? null,
    turn: raid?.turnNumber ?? null,
    boss: compactActor(primaryBoss(snapshot)),
    enemies: (battle?.opponent?.team ?? []).map(compactActor),
    allies: (battle?.player?.team ?? []).map(compactActor),
    gates: [...(battle?.raid?.firedMechanics ?? [])],
    crossedGates: [...(battle?.raid?.crossedGates ?? [])],
    result: snapshot?.result ? {
      raidId: snapshot.result.raidId,
      bossId: snapshot.result.bossId,
      outcome: snapshot.result.outcome,
      raidOutcome: snapshot.result.raidOutcome,
      rewardVp: snapshot.result.rewardVp,
      firstClearVp: snapshot.result.firstClearVp,
      humanCount: snapshot.result.humanCount,
      npcCount: snapshot.result.npcCount,
    } : null,
    vp: snapshot?.rewards?.total ?? null,
  }
}

async function sharedViews(label) {
  await Promise.all(players.map(waitForRaidPlayback))
  const views = await Promise.all(players.map(status))
  const expected = sharedProjection(views[0])
  for (const [index, view] of views.entries()) {
    assert.deepEqual(sharedProjection(view), expected, `${label}: ${players[index].identity} received different HP/form/turn/result/VP`)
  }
  return views
}

async function storedRun(raidId) {
  return api.store.transaction(tx => tx.get('raidRuns', raidId))
}

function chooseNaturalCommand(run, view, ownerId, seed) {
  assert(run?.battle, 'Expected an authoritative persisted battle for a live raid')
  const command = raidEngine.chooseRaidCommand(run.battle, ownerId, { seed })
  if (!command) return null
  // This only validates the engine's ordinary AI choice. The command still
  // crosses the browser's `createRaidClient` and server validation path below.
  const canonical = raidEngine.validateRaidCommand(run.battle, ownerId, command)
  assert.equal(canonical.actorId, view.raid.ownActorId, 'The natural command must belong to the current browser identity')
  return canonical
}

async function submitUiCommand(player) {
  const page = player.page
  await waitForRaidPlayback(player)
  const commands = page.locator('.raid-standard-commands')
  await commands.waitFor()
  const before = await page.evaluate(() => window.__raidEvents.requests.filter(entry => entry.action === 'raidSubmit').length)
  await commands.locator('.battle-command-buttons > button.fight').click()
  const move = commands.locator('.battle-move-button:not(:disabled)').first()
  if (!await move.count()) return false
  await move.click()
  await page.waitForFunction(beforeCount => {
    const submitted = window.__raidEvents.requests.filter(entry => entry.action === 'raidSubmit').length > beforeCount
    return submitted || Boolean(document.querySelector('.raid-standard-commands .battle-target-card:not(:disabled)'))
  }, before)
  const target = commands.locator('.battle-target-card:not(:disabled)').first()
  if (await target.count()) await target.click()
  await page.waitForFunction(count => window.__raidEvents.requests.filter(entry => entry.action === 'raidSubmit').length > count, before)
  return true
}

async function openRoomForScenario(scenario) {
  activeSeed = `journey-${scenario.id}-3-v1`
  seedSequence = 0
  const [host, ...guests] = players
  let snapshot = await request(host, 'roomCreate', { bossId: scenario.id, visibility: 'public', title: `세 화면 ${scenario.id}` })
  const roomId = snapshot.room.id
  for (const player of guests) {
    const listed = await status(player)
    const room = listed.rooms.find(entry => entry.id === roomId)
    assert(room, `${scenario.id}: public room must be listed to a separate browser`)
    await request(player, 'roomJoin', { roomId, roomRevision: room.roomRevision })
  }
  for (const player of players) {
    snapshot = await status(player)
    await request(player, 'roomReady', {
      roomId,
      roomRevision: snapshot.room.roomRevision,
      ready: true,
      pokemon: { captureId: captureIdFor(player.identity, scenario.id) },
    })
  }
  snapshot = await status(host)
  snapshot = await request(host, 'roomStart', { roomId, roomRevision: snapshot.room.roomRevision })
  assert(snapshot.raid?.id, `${scenario.id}: the host must receive a live raid after start`)
  const raidId = snapshot.raid.id
  await Promise.all(players.map(player => reloadScreen(player, '.raid-battle-screen')))
  await sharedViews(`${scenario.id} initial battle`)
  return { roomId, raidId }
}

// A fainted owner legitimately has no selectable move.  We always refetch
// before submitting each command and let the server advance after its real
// deadline only when no active human can act. This is intentionally not a
// local auto-win shortcut or a direct battle mutation.
async function advanceNaturalTurn(raidId, scenario, turnSeed) {
  let hostView = await status(players[0])
  if (!hostView.raid) return hostView
  if (hostView.raid.lifecycle === 'intermission') {
    return request(players[0], 'raidAdvance', { raidId, decisionToken: hostView.raid.decisionToken })
  }
  if (hostView.raid.lifecycle !== 'input') {
    clock += 46_000
    return request(players[0], 'raidAdvance', { raidId, decisionToken: hostView.raid.decisionToken })
  }
  const turn = hostView.raid.turnNumber
  for (const player of players) {
    const view = await status(player)
    if (!view.raid || view.raid.lifecycle !== 'input' || view.raid.turnNumber !== turn) break
    const run = await storedRun(raidId)
    const command = chooseNaturalCommand(run, view, uidFor(player.identity), `${scenario.id}:${turnSeed}:${turn}:${player.identity}`)
    if (!command) continue
    try {
      await request(player, 'raidSubmit', {
        raidId,
        decisionToken: view.raid.decisionToken,
        commandVersion: Number(view.raid.ownCommandVersion ?? 0) + 1,
        command,
      })
    } catch (error) {
      // A teammate may have ended the phase while this browser was fetching.
      // Re-reading is correct here; retrying an obsolete command is not.
      if (error?.code !== 'STALE_DECISION') throw error
    }
  }
  hostView = await status(players[0])
  if (hostView.raid?.lifecycle === 'input' && hostView.raid.turnNumber === turn) {
    clock += 46_000
    hostView = await request(players[0], 'raidAdvance', { raidId, decisionToken: hostView.raid.decisionToken })
  }
  return hostView
}

async function playScenario(scenario) {
  const { raidId } = await openRoomForScenario(scenario)
  let uiSubmitted = false
  let sawStageTwo = false
  let sawExpectedForm = false
  let sawHoohSummon = false
  let latest = await status(players[0])
  for (let step = 0; step < 140 && latest.raid; step += 1) {
    const views = await sharedViews(`${scenario.id} turn ${step}`)
    latest = views[0]
    const boss = primaryBoss(latest)
    if (latest.raid.phase === 2) sawStageTwo = true
    if (scenario.expectedForm && boss?.raidForm === scenario.expectedForm) {
      sawExpectedForm = true
      if (!captures.some(entry => entry.label === `${scenario.id}-${scenario.expectedForm}`)) {
        await Promise.all(players.map(player => reloadScreen(player, '.raid-battle-screen')))
        await capture(players[2], `${scenario.id}-${scenario.expectedForm}`, ['.battle-game-header', '.raid-standard-boss-hud .raid-boss-hp', `.battle-pokemon-stage.opponent.raid-form-${scenario.expectedForm}`])
      }
    }
    if (scenario.id === 'hooh' && latest.raid.phase === 2 && (latest.raid.battle?.opponent?.team?.length ?? 0) > 1) {
      sawHoohSummon = true
      if (!captures.some(entry => entry.label === 'hooh-summoned')) {
        await Promise.all(players.map(player => reloadScreen(player, '.raid-battle-screen')))
        await capture(players[1], 'hooh-summoned', ['.battle-game-header', '.raid-standard-boss-hud .raid-boss-hp', '.battle-pokemon-stage.opponent', '.raid-standard-commands'])
      }
    }
    if (!uiSubmitted && scenario.id === 'mewtwo' && latest.raid.lifecycle === 'input') {
      // One full first round is clicked through the actual command panel; the
      // later rounds use the engine's legal selection only to keep a long
      // deterministic browser test bounded.
      const worked = await Promise.all(players.map(submitUiCommand))
      assert(worked.every(Boolean), 'The real RaidScreen must submit a legal first-round move for every browser')
      uiSubmitted = true
      latest = await status(players[0])
    } else {
      clock += 10_001
      latest = await advanceNaturalTurn(raidId, scenario, step)
    }
  }
  assert(!latest.raid, `${scenario.id}: natural three-client raid did not reach a terminal result`)
  assert(sawStageTwo, `${scenario.id}: the real run did not enter phase two`)
  if (scenario.expectedForm) assert(sawExpectedForm, `${scenario.id}: expected ${scenario.expectedForm} form was not reached naturally`)
  // Ho-Oh's revival formation depends on natural hit rolls and survives only
  // while summons remain active. It is captured if reached, and reported if
  // this fixed legal run ends before that presentation can occur.
  if (scenario.expectedSummon && sawHoohSummon) assert(captures.some(entry => entry.label === 'hooh-summoned'), 'Ho-Oh summoned layout must be captured when naturally reached')

  const terminalViews = await sharedViews(`${scenario.id} terminal result`)
  const result = terminalViews[0].result
  assert(result?.raidId === raidId, `${scenario.id}: terminal result must retain its raid id`)
  assert(['win', 'loss'].includes(result.outcome), `${scenario.id}: terminal result must have a valid outcome`)
  assert.equal(result.humanCount, 3, `${scenario.id}: result must preserve three human participants`)
  assert.equal(result.npcCount, 0, `${scenario.id}: result must not invent NPC participants`)

  const receiptsBeforeReload = Object.values((await api.store.inspect()).collections.raidRewardReceipts ?? {})
    .filter(receipt => receipt.raidId === raidId).length
  const vp = terminalViews[0].rewards.total
  const expectedReceipts = result.outcome === 'win' ? 6 : 0
  assert.equal(receiptsBeforeReload, expectedReceipts, `${scenario.id}: settlement must issue clear + first-clear receipts once per winner`)

  // Reloading drops every React state cache and forces result-only recovery
  // from the server's compact terminal projection in three separate contexts.
  await Promise.all(players.map(player => reloadScreen(player, '.raid-result-screen')))
  for (const player of players) {
    const text = await player.page.locator('.raid-result-screen').innerText()
    assert(text.includes('VP'), `${scenario.id}: result-only RaidScreen must render VP for ${player.identity}`)
    const resultGeometry = await player.page.evaluate(() => ({
      scrollHeight: document.documentElement.scrollHeight,
      viewportHeight: innerHeight,
      box: (() => { const node = document.querySelector('.raid-result-screen'); const rect = node?.getBoundingClientRect(); return rect ? { top: rect.top, bottom: rect.bottom } : null })(),
    }))
    assert(resultGeometry.scrollHeight <= resultGeometry.viewportHeight + 1,
      `${scenario.id}: result-only screen must not create a vertical page scroll for ${player.identity}`)
    assert(resultGeometry.box?.top >= -1 && resultGeometry.box?.bottom <= resultGeometry.viewportHeight + 1,
      `${scenario.id}: result panel must fit its actual browser viewport for ${player.identity}`)
  }
  await capture(players[0], `${scenario.id}-result-only`, ['.raid-result-screen', '.raid-result-vp'])
  const afterReload = await sharedViews(`${scenario.id} result-only reload`)
  assert.equal(afterReload[0].result.raidId, raidId, `${scenario.id}: result-only reload lost dismissal id`)
  assert.equal(afterReload[0].rewards.total, vp, `${scenario.id}: result-only reload changed VP`)
  const receiptsAfterReload = Object.values((await api.store.inspect()).collections.raidRewardReceipts ?? {})
    .filter(receipt => receipt.raidId === raidId).length
  assert.equal(receiptsAfterReload, receiptsBeforeReload, `${scenario.id}: reload must not grant duplicated VP`)

  // Dismiss through the component's real button rather than an API shortcut.
  for (const player of players) {
    await player.page.getByRole('button', { name: '보스전 로비로', exact: true }).click()
    await player.page.locator('.raid-lobby-screen').waitFor()
  }
  const receiptsAfterDismiss = Object.values((await api.store.inspect()).collections.raidRewardReceipts ?? {})
    .filter(receipt => receipt.raidId === raidId).length
  assert.equal(receiptsAfterDismiss, receiptsBeforeReload, `${scenario.id}: dismiss must not grant duplicated VP`)
  for (const player of players) {
    const afterDismiss = await status(player)
    assert.equal(afterDismiss.result, null, `${scenario.id}: result must clear only after its own UI dismissal`)
    assert.equal(afterDismiss.conflicts.activeRaidId, null, `${scenario.id}: completed raid must not remain active`)
  }

  reports.push({
    bossId: scenario.id,
    raidId,
    outcome: result.outcome,
    vp,
    phaseTwo: sawStageTwo,
    expectedForm: scenario.expectedForm ?? null,
    expectedFormReached: sawExpectedForm,
    hoohSummoned: sawHoohSummon,
    rewardReceipts: receiptsBeforeReload,
  })
}

try {
  await fs.mkdir(output, { recursive: true })
  api = await startRaidApi()
  vite = await startVite()
  const require = createRequire(new URL('../promo/package.json', import.meta.url))
  const { chromium } = require('playwright')
  browser = await chromium.launch({ headless: true, executablePath: await resolveChromiumExecutable(chromium) })
  players.push(
    await openPlayer('alice', { width: 1440, height: 900 }),
    await openPlayer('bob', { width: 1280, height: 800 }),
    await openPlayer('charlie', { width: 1120, height: 760 }),
  )

  await check('three isolated actual RaidScreen clients complete Mewtwo through phase two and armored form', async () => playScenario(scenarios[0]))
  await check('three isolated actual RaidScreen clients complete Ho-Oh through phase two and record its natural summon state', async () => playScenario(scenarios[1]))
  await check('three isolated actual RaidScreen clients complete Lugia through phase two and Dark Lugia form', async () => playScenario(scenarios[2]))
  await check('three-browser loopback run has no browser errors or failed raid requests', async () => {
    assert.deepEqual(browserErrors, [])
    assert.deepEqual(httpFailures, [])
  })
} finally {
  for (const player of players) {
    try {
      diagnostics.push({
        identity: player.identity,
        url: player.page.url(),
        screen: await player.page.evaluate(() => document.querySelector('.raid-lobby-screen,.raid-room-screen,.raid-intermission-screen,.raid-battle-screen,.raid-result-screen')?.className ?? ''),
        events: await player.page.evaluate(() => window.__raidEvents),
      })
      await player.page.screenshot({ path: path.join(output, `debug-${player.identity}.png`) })
    } catch {}
  }
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({
    environment: `Node ${process.version}; local loopback HTTP; three isolated Playwright browser contexts; synthetic ranked-test identities only`,
    checks, reports, browserErrors, httpFailures, captures, diagnostics,
  }, null, 2))
  await Promise.allSettled(players.map(player => player.context.close()))
  await browser?.close()
  await vite?.close()
  await api?.close()
}
