import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer as createHttpServer } from 'node:http'
import { spawnSync } from 'node:child_process'
import { Readable } from 'node:stream'
import { createServer as createViteServer } from 'vite'
import { createMemoryRankedStore } from '../../server/rankedStore.js'
import { createRaidPreset } from '../../server/raidBattle.js'
import * as raidEngine from '../../server/raidBattle.js'
import { createRaidHttpHandler, createLocalRaidAuthenticator } from '../../server/raidHttp.js'
import { createRaidService } from '../../server/raidService.js'
import { resolveChromiumExecutable } from './browserRuntime.mjs'

// Records one real co-op boss raid at 1080p: boss select, room, the 전초전
// stage and the boss stage, plus the game's own Web Audio effects. The run
// drives the shipped RaidScreen against an in-memory raid service, so every
// HP number, gimmick and turn order comes from the real engine. Scene marks are
// written next to the footage so renderRaidVideo.mjs can cut without guessing.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const raw = path.join(root, 'promo/raw')
const cache = path.join(root, 'promo/generated/raid-capture')
await fs.mkdir(raw, { recursive: true })
await fs.mkdir(cache, { recursive: true })

const require = createRequire(import.meta.url)
const ffmpeg = process.env.FFMPEG_PATH || require('ffmpeg-static')
const runtimeModules = process.env.PROMO_NODE_MODULES || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules')
let chromium
try { ({ chromium } = require('playwright')) } catch { ({ chromium } = require(path.join(runtimeModules, 'playwright'))) }

// Raced against the raid engine first: this trio clears the poison prelude
// quickly and still lands several turns on the boss's 8x HP pool, which is the
// footage the video needs.
const squads = {
  alice: { speciesId: 491, moves: ['darkpulse', 'shadowball', 'icebeam', 'thunderbolt'] },
  bob: { speciesId: 483, moves: ['dracometeor', 'flashcannon', 'earthpower', 'thunderbolt'] },
  charlie: { speciesId: 445, moves: ['earthquake', 'dragonclaw', 'stoneedge', 'crunch'] },
}
const identities = Object.keys(squads)
const boxes = Object.fromEntries(identities.map(identity =>
  [identity, [createRaidPreset(squads[identity], `raid-promo-${identity}`)]]))

let idSequence = 0
const marks = []
let playStart = 0
let audioStart = null
const mark = (label, detail) => {
  const seconds = playStart ? (Date.now() - playStart) / 1000 : 0
  marks.push({ label, seconds: Number(seconds.toFixed(2)), ...(detail ? { detail } : {}) })
  console.log(`  [${seconds.toFixed(1).padStart(6)}s] ${label}${detail ? ` (${detail})` : ''}`)
}

function loopbackServer(handler) {
  let origin = ''
  const server = createHttpServer(async (incoming, outgoing) => {
    try {
      const url = new URL(incoming.url, origin)
      if (url.pathname !== '/api/raid') { outgoing.writeHead(404, { 'Content-Type': 'application/json' }); outgoing.end('{}'); return }
      const request = new Request(url, {
        method: incoming.method,
        headers: incoming.headers,
        ...(!['GET', 'HEAD'].includes(incoming.method ?? 'GET') ? { body: Readable.toWeb(incoming), duplex: 'half' } : {}),
      })
      const response = await handler(request)
      outgoing.writeHead(response.status, Object.fromEntries(response.headers))
      outgoing.end(Buffer.from(await response.arrayBuffer()))
    } catch {
      outgoing.writeHead(503, { 'Content-Type': 'application/json' })
      outgoing.end('{}')
    }
  })
  return {
    async listen() {
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
      origin = `http://127.0.0.1:${server.address().port}`
      return `${origin}/api/raid`
    },
    async close() { await new Promise(resolve => server.close(resolve)) },
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
    now: () => Date.now(),
    newId: () => `raidp${++idSequence}`,
    makeSeed: () => 0x9e37 + idSequence,
    timeouts: { command: 45_000 },
  })
  const handler = createRaidHttpHandler({
    enabled: true,
    service,
    authenticate: createLocalRaidAuthenticator({ enabled: true, production: false }),
    allowLocalOrigins: true,
    now: () => Date.now(),
  })
  const runtime = loopbackServer(handler)
  const url = await runtime.listen()
  return { url, close: async () => { await runtime.close(); await store.close() } }
}

// Mirrors main.jsx so the recording uses the shipped cascade order.
const styles = ['styles', 'screenRedesign', 'battleGen5', 'titleCleanup', 'battleGimmicks', 'moveAnimationDirector',
  'settings', 'auth', 'mobileLandscape', 'gameTextScale', 'scaledBoxCards', 'scaledBattleCards', 'scaledTrainingEditor',
  'mobileTouch', 'mobileUiV2']

const entry = [
  `import React,{useMemo,useState} from 'react';import{createRoot}from'react-dom/client';`,
  `import RaidScreen from '/src/RaidScreen.jsx';import{createRaidClient}from'/src/raidClient.js';import'/src/mobileViewport.js';`,
  styles.map(name => `import '/src/${name}.css';`).join('\n'),
  `const fixture=window.__raidFixture;`,
  `function Harness(){const[active,setActive]=useState(false);`,
  `const client=useMemo(()=>createRaidClient({getIdToken:async()=>'ranked-test-'+fixture.identity,apiUrl:fixture.apiUrl}),[]);`,
  `return React.createElement('div',{className:'app-shell raid-view'+(active?' battle-view':'')},`,
  `React.createElement('header',{className:'topbar'},React.createElement('div',{className:'brand'},React.createElement('strong',null,'CHAMPIONS ARENA'))),`,
  `React.createElement(RaidScreen,{enabled:true,client,user:{uid:'ranked-test-'+fixture.identity,displayName:fixture.displayName,isLocalGuest:false},boxPokemon:fixture.boxPokemon,onBack:()=>{},onBeforeJoin:async()=>true,onBattleActiveChange:value=>setActive(value),soundEnabled:fixture.sound,audioSettings:{master:100,music:0,effects:100,cries:90,ui:0},gameSettings:{attackAnimation:'normal',hpBarSpeed:'normal',showDamageNumbers:true},onReceiveVpRewards:async()=>{}}))}`,
  `createRoot(document.getElementById('root')).render(React.createElement(Harness));`,
].join('\n')

const html = '<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body><div id="root"></div><script type="module" src="/raid-promo-entry.js"></script></body></html>'

async function startVite() {
  const server = await createViteServer({
    root,
    cacheDir: path.join(cache, 'vite'),
    mode: 'raid-promo-capture',
    logLevel: 'error',
    plugins: [{
      name: 'raid-promo-entry',
      enforce: 'pre',
      configureServer(viteServer) {
        viteServer.middlewares.use(async (request, response, next) => {
          if (new URL(request.url, 'http://localhost').pathname !== '/raid-promo.html') { next(); return }
          response.setHeader('Content-Type', 'text/html')
          response.end(await viteServer.transformIndexHtml('/raid-promo.html', html))
        })
      },
      resolveId(source) {
        if (source === '/raid-promo-entry.js') return source
        if (/firebaseClient(?:\.js)?$/.test(source)) return '\0raid-promo-auth'
        return undefined
      },
      load(id) {
        if (id === '/raid-promo-entry.js') return entry
        if (id === '\0raid-promo-auth') return 'export const firebaseAuth=null;export const firebaseDb=null;export const isFirebaseConfigured=false;export const missingFirebaseEnvironmentVariables=[];'
        return undefined
      },
    }],
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
  })
  await server.listen()
  return server
}

// Taps the game's own Web Audio graph. The page keeps rendering through its
// normal destination; the extra branch only mirrors it into a recorder.
const audioTap = () => {
  const originalConnect = AudioNode.prototype.connect
  const outputs = new Map()
  AudioNode.prototype.connect = function(destination, ...args) {
    const result = originalConnect.call(this, destination, ...args)
    if (destination instanceof AudioDestinationNode) {
      let tap = outputs.get(this.context)
      if (!tap) { tap = this.context.createMediaStreamDestination(); outputs.set(this.context, tap) }
      originalConnect.call(this, tap)
    }
    return result
  }
  window.promoAudio = {
    start() {
      const tap = [...outputs.values()].at(-1)
      if (!tap) return false
      const chunks = []
      const recorder = new MediaRecorder(tap.stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 160000 })
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data) }
      this.recorder = recorder; this.chunks = chunks; recorder.start(); return true
    },
    async stop() {
      if (!this.recorder) return null
      const done = new Promise(resolve => { this.recorder.onstop = resolve })
      this.recorder.stop(); await done
      const bytes = new Uint8Array(await new Blob(this.chunks).arrayBuffer())
      let binary = ''
      for (let index = 0; index < bytes.length; index += 8192) binary += String.fromCharCode(...bytes.subarray(index, index + 8192))
      return btoa(binary)
    },
  }
}

const api = await startRaidApi()
const vite = await startVite()
const origin = vite.resolvedUrls.local[0].replace(/\/$/, '')
const browser = await chromium.launch({
  executablePath: await resolveChromiumExecutable(chromium),
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
})
const errors = []

async function openPlayer(identity, { record = false, displayName } = {}) {
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    reducedMotion: 'no-preference',
    ...(record ? { recordVideo: { dir: raw, size: { width: 1920, height: 1080 } } } : {}),
  })
  if (record) await context.addInitScript(audioTap)
  await context.addInitScript(fixture => { window.__raidFixture = fixture },
    { apiUrl: api.url, identity, boxPokemon: boxes[identity], displayName, sound: record })
  const page = await context.newPage()
  page.setDefaultTimeout(45_000)
  page.on('pageerror', error => errors.push({ identity, message: error.message }))
  await page.goto(`${origin}/raid-promo.html`)
  await page.locator('.raid-lobby-screen').waitFor()
  await page.evaluate(() => document.fonts.ready)
  return { identity, context, page }
}

async function selectAndReady(page) {
  const picker = page.locator('.raid-pokemon-picker')
  if (!await page.locator('.raid-member-slot.own.ready').count()) {
    const select = page.locator('.raid-select-pokemon, .raid-change-pokemon').first()
    if (await select.count() && !await picker.count()) {
      await select.click()
      await picker.waitFor()
    }
    if (await picker.count()) {
      await page.locator('.raid-owned-grid button').first().click()
      await page.locator('.raid-room-screen').waitFor()
    }
    const ready = page.getByRole('button', { name: '준비 완료', exact: true })
    await ready.waitFor()
    if (await ready.isEnabled()) await ready.click()
  }
  await page.locator('.raid-member-slot.own.ready').waitFor()
}

// A raider joining after someone else clears that member's ready flag, so the
// room only starts once every client has been re-readied.
async function ensureReady(page, attempts = 5) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (await page.locator('.raid-member-slot.own.ready').count()) return true
    const ready = page.getByRole('button', { name: '준비 완료', exact: true })
    if (await ready.count() && await ready.isEnabled().catch(() => false)) await ready.click().catch(() => {})
    await page.waitForTimeout(900)
  }
  return Boolean(await page.locator('.raid-member-slot.own.ready').count())
}

const commandsIdle = page => page.waitForFunction(() => {
  const screen = document.querySelector('.raid-battle-screen')
  if (!screen) return true
  const commands = screen.querySelector('.raid-standard-commands')
  return Boolean(commands) && !commands.classList.contains('is-turn-locked') && commands.getAttribute('aria-busy') !== 'true'
}, undefined, { timeout: 60_000 }).catch(() => {})

// Reads the live battle through the rendered HUD so the recording and the
// scene marks describe the same frame the viewer sees.
const readBattle = page => page.evaluate(() => {
  const text = selector => document.querySelector(selector)?.textContent?.trim() ?? null
  const bossBar = document.querySelector('.raid-boss-hp')
  return {
    // The boss HUD wrapper also carries the participant strip during the
    // prelude, so the boss HP bar itself is the phase-2 signal.
    phase: document.querySelector('.raid-standard-boss-hud .raid-boss-hp') ? 'boss' : 'prelude',
    stageName: text('.raid-standard-battle-header .raid-standard-battle-title, .raid-standard-battle-header strong'),
    turn: text('.raid-standard-battle-header .battle-turn-counter, .raid-turn-counter'),
    bossHp: bossBar?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
    enemies: [...document.querySelectorAll('.raid-opponent-status-row .battle-hp-panel')].length,
    log: [...document.querySelectorAll('.battle-log li, .raid-battle-log li')].slice(-2).map(node => node.textContent.trim()),
    finished: Boolean(document.querySelector('.raid-result-screen')),
    won: Boolean(document.querySelector('.raid-result-screen.won')),
  }
})

async function submitTurn(page, { label }) {
  const commands = page.locator('.raid-standard-commands')
  await commandsIdle(page)
  const fight = commands.locator('.battle-command-buttons > button.fight')
  if (!await fight.count() || !await fight.first().isEnabled()) {
    const state = await page.evaluate(() => {
      const deck = document.querySelector('.raid-standard-commands')
      if (!deck) return { deck: 'missing' }
      return {
        classes: deck.className,
        busy: deck.getAttribute('aria-busy'),
        buttons: [...deck.querySelectorAll('button')].slice(0, 6).map(button =>
          `${String(button.className).split(' ')[0] || 'button'}:${button.disabled ? 'off' : 'on'}:${button.textContent.trim().slice(0, 10)}`),
        notice: deck.textContent.replace(/\s+/g, ' ').trim().slice(0, 120),
      }
    })
    mark(`idle:${label}`, JSON.stringify(state).slice(0, 260))
    return false
  }
  await fight.first().click()
  // A raid gimmick is once per stage per raider, and it is the most watchable
  // moment in the fight, so take it as soon as the battle offers one.
  const gimmick = commands.locator('.battle-gimmick-selector button:not(:disabled)').first()
  if (await gimmick.count()) {
    await page.waitForTimeout(320)
    await gimmick.click().catch(() => {})
    await page.waitForTimeout(260)
  }
  const move = commands.locator('.battle-move-button:not(:disabled)').first()
  await move.waitFor({ timeout: 20_000 })
  await page.waitForTimeout(420)
  await move.click()
  await page.waitForTimeout(360)
  const superTarget = commands.locator('.battle-target-card.effectiveness-super:not(:disabled)').first()
  const target = await superTarget.count() ? superTarget : commands.locator('.battle-target-card:not(:disabled)').first()
  if (await target.count()) {
    await page.waitForTimeout(320)
    await target.click()
  }
  mark(`command:${label}`)
  return true
}

const deadline = Date.now() + 9 * 60_000
let video = null
let outcome = null
const videoPath = path.join(raw, 'raid-session.webm')
let audioData = null
let session = null

try {
  const alice = await openPlayer('alice', { record: true, displayName: '레드' })
  const helpers = []

  // A removed solid-color frame gives the edit an exact video/audio origin.
  await alice.page.evaluate(() => {
    const marker = document.createElement('div')
    marker.id = 'promo-sync-marker'
    marker.style.cssText = 'position:fixed;inset:0;background:rgb(0,255,0);z-index:2147483647'
    document.body.append(marker)
  })
  await alice.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await alice.page.screenshot({ timeout: 60_000 })
  await alice.page.waitForTimeout(650)

  playStart = Date.now()
  await alice.page.evaluate(() => { document.getElementById('promo-sync-marker').remove() })
  mark('start')

  // 1. Boss select
  await alice.page.waitForTimeout(3200)
  mark('scene:boss-select')
  // The lobby shots are the video's opening, so hold each screen long enough
  // for a cut to sit on it.
  await alice.page.waitForTimeout(1800)
  await alice.page.locator('.raid-boss-grid .raid-boss-card').first().hover()
  await alice.page.waitForTimeout(2600)
  await alice.page.locator('.raid-boss-grid .raid-boss-card').first().click()
  await alice.page.locator('.raid-room-list').waitFor()
  mark('scene:room-list')
  await alice.page.waitForTimeout(3600)

  // 2. Create the room
  await alice.page.getByRole('button', { name: '방 만들기', exact: true }).click()
  const dialog = alice.page.getByRole('dialog', { name: '보스전 방 만들기', exact: true })
  await dialog.waitFor()
  mark('scene:create-dialog')
  await dialog.getByLabel('방 제목', { exact: true }).fill('같이 잡자 뮤츠')
  await alice.page.waitForTimeout(1200)
  await dialog.getByRole('button', { name: '방 만들기', exact: true }).click()

  // 3. Pick the raid Pokemon
  await alice.page.locator('.raid-pokemon-picker').waitFor()
  mark('scene:pokemon-picker')
  await alice.page.waitForTimeout(3800)
  await alice.page.locator('.raid-owned-grid button').first().click()
  await alice.page.locator('.raid-room-screen').waitFor()
  mark('scene:room-solo')
  await alice.page.waitForTimeout(2600)

  // 4. The other raiders join. A failed join must not cost the whole take: the
  // room simply starts with whoever made it in, and NPC partners fill the rest.
  for (const [identity, displayName] of [['bob', '블루'], ['charlie', '그린']]) {
    let raider = null
    try {
      raider = await openPlayer(identity, { displayName })
      await raider.page.locator('.raid-boss-grid .raid-boss-card').first().click()
      await raider.page.locator('.raid-room-list').waitFor()
      await raider.page.locator('.raid-room-card').filter({ hasText: '같이 잡자 뮤츠' }).getByRole('button').first().click()
      await raider.page.getByRole('dialog', { name: '보스전 방 참가', exact: true }).getByRole('button', { name: '참가하기', exact: true }).click()
      await raider.page.locator('.raid-pokemon-picker, .raid-room-screen').first().waitFor({ timeout: 20_000 })
      if (await raider.page.locator('.raid-pokemon-picker').count()) {
        await raider.page.locator('.raid-owned-grid button').first().click()
        await raider.page.locator('.raid-room-screen').waitFor()
      }
      await selectAndReady(raider.page)
      helpers.push({ ...raider, displayName })
      mark(`scene:room-join-${identity}`)
      await alice.page.waitForTimeout(1500)
    } catch (error) {
      mark(`warn:join-failed-${identity}`, String(error.message).slice(0, 140))
      await raider?.context.close().catch(() => {})
    }
  }
  mark('scene:room-two')
  await alice.page.waitForTimeout(2600)
  await selectAndReady(alice.page)
  mark('scene:room-ready')
  await alice.page.waitForTimeout(2000)

  // 5. Into the raid
  const start = alice.page.locator('.raid-start-button')
  await start.waitFor()
  for (let attempt = 0; attempt < 8 && !await start.isEnabled(); attempt++) {
    for (const raider of helpers) await ensureReady(raider.page)
    await ensureReady(alice.page)
    await alice.page.waitForTimeout(1200)
  }
  mark('scene:room-all-ready')
  await start.click({ timeout: 30_000 })
  await alice.page.locator('.raid-battle-screen').waitFor({ timeout: 60_000 })
  mark('scene:battle-open')
  // The raid builds its audio graph when the battle mounts, so the tap only has
  // something to record from here on.
  let recordingAudio = false
  for (let attempt = 0; attempt < 12 && !recordingAudio; attempt++) {
    recordingAudio = await alice.page.evaluate(() => window.promoAudio.start())
    if (!recordingAudio) await alice.page.waitForTimeout(400)
  }
  audioStart = (Date.now() - playStart) / 1000
  mark('audio:start', String(recordingAudio))
  await commandsIdle(alice.page)
  await alice.page.waitForTimeout(1500)

  let turn = 0
  let sawBossStage = false
  // Each raider picks in turn. A client that has not reached the battle yet, or
  // that is still showing the resolution, simply gets waited for: the raid only
  // advances once every participant has submitted.
  const raiders = () => [{ page: alice.page, label: 'alice' },
    ...helpers.map((raider, index) => ({ page: raider.page, label: `ally${index + 1}` }))]
  while (turn < 30 && Date.now() < deadline) {
    turn += 1
    const before = await readBattle(alice.page)
    if (before.phase === 'boss' && !sawBossStage) {
      sawBossStage = true
      mark('scene:boss-stage', before.bossHp ?? '')
    }
    let submitted = 0
    for (const raider of raiders()) {
      const ready = raider.page.locator('.raid-standard-commands .battle-command-buttons > button.fight:not([disabled])')
      try {
        // A raider whose Pokemon is down never gets a fight button; the server
        // resolves the turn on its own timeout, so stop waiting early.
        await ready.waitFor({ timeout: 15_000 })
      } catch {
        mark(`skip:${raider.label}-t${turn}`)
        continue
      }
      if (await submitTurn(raider.page, { label: `${raider.label}-t${turn}` })) submitted += 1
    }
    if (!submitted) {
      const finishedNow = await readBattle(alice.page)
      if (finishedNow.finished) { mark('scene:result'); break }
      mark(`stall:${turn}`)
      await alice.page.waitForTimeout(2500)
      continue
    }
    // Wait for the engine to play the turn out rather than for a fixed pause,
    // so the recording keeps the whole animation.
    await alice.page.waitForFunction(() => {
      if (document.querySelector('.raid-result-screen')) return true
      const fight = document.querySelector('.raid-standard-commands .battle-command-buttons > button.fight')
      return Boolean(fight) && !fight.disabled
    }, undefined, { timeout: 90_000 }).catch(() => {})
    const after = await readBattle(alice.page)
    mark(`turn:${turn}`, `${after.phase} ${after.bossHp ?? after.enemies + ' enemies'}${after.won ? ' WON' : ''}`)
    if (after.finished) { mark('scene:result'); break }
    await alice.page.waitForTimeout(600)
  }

  const finished = await readBattle(alice.page)
  outcome = finished.finished ? (finished.won ? 'won' : 'lost') : 'unfinished'
  mark(`outcome:${outcome}`)
  if (!finished.finished) mark('scene:timeout', `turn ${turn}`)
  await alice.page.waitForTimeout(4000)
  mark('scene:end')

  audioData = await alice.page.evaluate(() => window.promoAudio.stop())
  await alice.page.screenshot({ path: path.join(raw, 'raid-session-last.png'), timeout: 60_000 })
  session = { marks, errors, audioStartSeconds: audioStart, recordedSeconds: (Date.now() - playStart) / 1000, outcome }
  video = alice.page.video()
  await alice.page.close()
  await alice.context.close()
  // Playwright can only export the recording while the browser is still up.
  await video.saveAs(videoPath)
  await video.delete()
  video = 'saved'
  for (const raider of helpers) await raider.context.close()
} finally {
  await browser.close()
  await vite.close()
  await api.close()
}

if (!video) throw new Error('Raid capture produced no video')
if (audioData) await fs.writeFile(path.join(raw, 'raid-session-audio.webm'), Buffer.from(audioData, 'base64'))

// Locate the green sync frame so the edit can align effects with the picture.
const pixels = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', videoPath,
  '-vf', 'fps=25,scale=4:4:flags=neighbor,format=rgb24', '-f', 'rawvideo', 'pipe:1'],
{ windowsHide: true, maxBuffer: 256 * 1024 * 1024 })
if (pixels.status !== 0) throw new Error(pixels.stderr.toString())
let markerEnd = -1
const frameBytes = 4 * 4 * 3
for (let frame = 0; frame < pixels.stdout.length; frame += frameBytes) {
  let green = 0
  for (let index = frame; index < frame + frameBytes; index += 3) {
    if (pixels.stdout[index] < 30 && pixels.stdout[index + 1] > 220 && pixels.stdout[index + 2] < 30) green++
  }
  if (green >= 15) markerEnd = frame / frameBytes
}
if (markerEnd < 0) throw new Error('Missing video sync marker in the raid capture')
session.syncStartSeconds = (markerEnd + 1) / 25
await fs.writeFile(path.join(raw, 'raid-session.json'), JSON.stringify(session, null, 2))

console.log(`\nvideo: ${videoPath}`)
console.log(`sync start: ${session.syncStartSeconds.toFixed(2)}s | recorded: ${session.recordedSeconds.toFixed(1)}s | marks: ${marks.length}`)
if (errors.length) { console.log('page errors:'); for (const error of errors.slice(0, 8)) console.log(' ', error.identity, error.message.split('\n')[0]) }
