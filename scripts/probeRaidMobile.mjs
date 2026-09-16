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

// Drives the real co-op boss raid through a landscape-phone browser and reports
// what leaves the frame. The page loads the same stylesheet set as main.jsx so
// the measurements match the shipped mobile build.
const root = fileURLToPath(new URL('../', import.meta.url))
const output = path.join(root, 'scripts/.cache/raid-mobile')
await fs.mkdir(output, { recursive: true })

const identities = ['alice', 'bob']
const loadout = ['psystrike', 'aurasphere', 'icebeam', 'shadowball']
const boxes = Object.fromEntries(identities.map(identity => [identity,
  [createRaidPreset({ speciesId: 150, moves: loadout }, `raid-mobile-${identity}-mewtwo`)]]))
const clock = Date.now()
let idSequence = 0
const report = []

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
    now: () => clock,
    newId: () => `raidm${++idSequence}`,
    makeSeed: () => 0x5a17 + idSequence,
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
  return { url, close: async () => { await runtime.close(); await store.close() } }
}

// Mirrors main.jsx so the probe sees the production cascade order.
const styles = ['styles', 'screenRedesign', 'battleGen5', 'titleCleanup', 'battleGimmicks', 'moveAnimationDirector',
  'settings', 'auth', 'mobileLandscape', 'gameTextScale', 'scaledBoxCards', 'scaledBattleCards', 'scaledTrainingEditor',
  'mobileTouch', 'mobileUiV2']

const entry = [
  `import React,{useMemo,useState} from 'react';import{createRoot}from'react-dom/client';`,
  `import RaidScreen from '/src/RaidScreen.jsx';import{createRaidClient}from'/src/raidClient.js';import'/src/mobileViewport.js';`,
  styles.map(name => `import '/src/${name}.css';`).join('\n'),
  `const fixture=window.__raidFixture;window.__raidEvents={requests:[]};`,
  `function Harness(){const[active,setActive]=useState(false);`,
  `const client=useMemo(()=>{const actual=createRaidClient({getIdToken:async()=>'ranked-test-'+fixture.identity,apiUrl:fixture.apiUrl});`,
  `const request=async(...args)=>{const record={action:args[0]};window.__raidEvents.requests.push(record);const value=await actual.request(...args);record.done=true;window.__lastRaidSnapshot=value;return value};`,
  `const exposed={request,catalog:(p,o)=>request('catalog',p,o),rooms:(p,o)=>request('rooms',p,o),status:(p,o)=>request('status',p,o)};window.__raidClient=exposed;return exposed},[]);`,
  `return React.createElement('div',{className:'app-shell raid-view'+(active?' battle-view':'')},`,
  `React.createElement('header',{className:'topbar'},React.createElement('div',{className:'brand'},React.createElement('strong',null,'CHAMPIONS ARENA'))),`,
  `React.createElement(RaidScreen,{enabled:true,client,user:{uid:'ranked-test-'+fixture.identity,displayName:'로컬 '+fixture.identity,isLocalGuest:false},boxPokemon:fixture.boxPokemon,onBack:()=>{},onBeforeJoin:async()=>true,onBattleActiveChange:value=>setActive(value),soundEnabled:false,audioSettings:{enabled:false},gameSettings:{attackAnimation:'normal',hpBarSpeed:'normal',showDamageNumbers:true},onReceiveVpRewards:async()=>{}}))}`,
  `createRoot(document.getElementById('root')).render(React.createElement(Harness));`,
].join('\n')

const html = '<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body><div id="root"></div><script type="module" src="/raid-mobile-entry.js"></script></body></html>'

async function startVite() {
  const server = await createViteServer({
    root,
    cacheDir: path.join(output, 'vite'),
    mode: 'raid-mobile-probe',
    logLevel: 'error',
    plugins: [{
      name: 'raid-mobile-entry',
      enforce: 'pre',
      configureServer(viteServer) {
        viteServer.middlewares.use(async (request, response, next) => {
          if (new URL(request.url, 'http://localhost').pathname !== '/raid-mobile.html') { next(); return }
          response.setHeader('Content-Type', 'text/html')
          response.end(await viteServer.transformIndexHtml('/raid-mobile.html', html))
        })
      },
      resolveId(source) {
        if (source === '/raid-mobile-entry.js') return source
        if (/firebaseClient(?:\.js)?$/.test(source)) return '\0raid-mobile-auth'
        return undefined
      },
      load(id) {
        if (id === '/raid-mobile-entry.js') return entry
        if (id === '\0raid-mobile-auth') return 'export const firebaseAuth=null;export const firebaseDb=null;export const isFirebaseConfigured=false;export const missingFirebaseEnvironmentVariables=[];'
        return undefined
      },
    }],
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
  })
  await server.listen()
  return server
}

// Everything below runs inside the page. It measures the live document rather
// than trusting the stylesheet, so a rule that only fails at one width is
// still caught.
function measure() {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const shell = document.querySelector('.app-shell') ?? document.body
  const label = node => {
    const classes = typeof node.className === 'string' ? node.className.trim().split(/\s+/).filter(Boolean) : []
    return node.tagName.toLowerCase() + (classes.length ? '.' + classes.slice(0, 3).join('.') : '')
  }
  const shown = node => {
    const style = getComputedStyle(node)
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false
    const box = node.getBoundingClientRect()
    return box.width > 1 && box.height > 1
  }
  const decorative = node => /glow|aura|sheen|particle|backdrop|spark|ring|halo|flash|beam|trail|blur/i.test(String(node.className))
  const scrollPane = node => {
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent)
      if (/(auto|scroll)/.test(style.overflowY + style.overflowX) && (parent.scrollHeight > parent.clientHeight + 2 || parent.scrollWidth > parent.clientWidth + 2)) return label(parent)
    }
    return null
  }
  const nodes = [...shell.querySelectorAll('*')].filter(shown)
  const outside = []
  const cut = []
  const small = []
  for (const node of nodes) {
    const box = node.getBoundingClientRect()
    const over = {
      left: Math.round(Math.max(0, -box.left)),
      right: Math.round(Math.max(0, box.right - vw)),
      top: Math.round(Math.max(0, -box.top)),
      bottom: Math.round(Math.max(0, box.bottom - vh)),
    }
    const worst = Math.max(over.left, over.right, over.top, over.bottom)
    if (worst > 2) {
      outside.push({ node: label(node), over, worst, decorative: decorative(node), pane: scrollPane(node),
        text: (node.textContent ?? '').trim().slice(0, 40) })
    }
    const style = getComputedStyle(node)
    const hiddenX = /(hidden|clip)/.test(style.overflowX)
    const hiddenY = /(hidden|clip)/.test(style.overflowY)
    if ((hiddenX && node.scrollWidth > node.clientWidth + 2) || (hiddenY && node.scrollHeight > node.clientHeight + 2)) {
      if ((node.textContent ?? '').trim()) {
        cut.push({ node: label(node), clientWidth: node.clientWidth, scrollWidth: node.scrollWidth,
          clientHeight: node.clientHeight, scrollHeight: node.scrollHeight, text: node.textContent.trim().slice(0, 40) })
      }
    }
    if (node.matches('button, [role="button"], a[href], input, select')) {
      if (box.height < 26 || box.width < 26) small.push({ node: label(node), w: Math.round(box.width), h: Math.round(box.height), text: (node.textContent ?? '').trim().slice(0, 24) })
    }
  }
  outside.sort((a, b) => b.worst - a.worst)
  cut.sort((a, b) => (b.scrollHeight - b.clientHeight + b.scrollWidth - b.clientWidth) - (a.scrollHeight - a.clientHeight + a.scrollWidth - a.clientWidth))
  const grid = document.querySelector('.battle-target-grid')
  const card = document.querySelector('.battle-target-card')
  const moveCards = [...document.querySelectorAll('.battle-move-button')].map(button => {
    const box = button.getBoundingClientRect()
    const style = getComputedStyle(button)
    const inner = [...button.children].map(child => {
      const childBox = child.getBoundingClientRect()
      return { name: String(child.className).split(' ')[0] || child.tagName, right: Math.round(childBox.right), bottom: Math.round(childBox.bottom), w: Math.round(childBox.width) }
    })
    return {
      right: Math.round(box.right), bottom: Math.round(box.bottom), w: Math.round(box.width), h: Math.round(box.height),
      padRight: style.paddingRight, cols: style.gridTemplateColumns,
      spill: inner.filter(child => child.right > box.right - 1 || child.bottom > box.bottom - 1),
    }
  })
  return {
    viewport: { width: vw, height: vh },
    layoutAttribute: document.documentElement.dataset.mobileLayout ?? null,
    targetGrid: grid ? (() => {
      const style = getComputedStyle(grid)
      const cardStyle = card ? getComputedStyle(card) : null
      return {
        rows: style.gridTemplateRows, autoRows: style.gridAutoRows, alignContent: style.alignContent,
        overflowY: style.overflowY, client: grid.clientHeight, scroll: grid.scrollHeight,
        cardRows: cardStyle?.gridTemplateRows, cardCols: cardStyle?.gridTemplateColumns, cardPadding: cardStyle?.padding,
        cardBox: card ? { h: Math.round(card.getBoundingClientRect().height), alignSelf: cardStyle?.alignSelf, height: cardStyle?.height } : null,
        children: card ? [...card.children].map(child => {
          const childStyle = getComputedStyle(child)
          return `${child.className || child.tagName}: r=${childStyle.gridRow} c=${childStyle.gridColumn} d=${childStyle.display} h=${Math.round(child.getBoundingClientRect().height)}`
        }) : null,
      }
    })() : null,
    pageScroll: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
    outside: outside.slice(0, 12),
    outsideCount: outside.length,
    moveCards,
    cut: cut.slice(0, 8),
    cutCount: cut.length,
    small: small.slice(0, 8),
    smallCount: small.length,
  }
}

async function audit(page, label) {
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(260)
  const result = await page.evaluate(measure)
  result.label = label
  report.push(result)
  await page.screenshot({ path: path.join(output, `${label}.png`) })
  const flags = []
  if (result.pageScroll.width > result.viewport.width + 1) flags.push(`page scrolls sideways ${result.pageScroll.width}>${result.viewport.width}`)
  if (result.pageScroll.height > result.viewport.height + 1) flags.push(`page scrolls down ${result.pageScroll.height}>${result.viewport.height}`)
  const real = result.outside.filter(item => !item.decorative && !item.pane)
  console.log(`\n--- ${label} (${result.viewport.width}x${result.viewport.height}, layout=${result.layoutAttribute}) ---`)
  if (flags.length) console.log('  ' + flags.join(' | '))
  console.log(`  offscreen ${result.outsideCount} (real ${real.length}) | clipped text ${result.cutCount} | small targets ${result.smallCount}`)
  for (const item of real.slice(0, 6)) console.log(`   OUT ${item.node} by ${JSON.stringify(item.over)} "${item.text}"`)
  for (const item of result.cut.slice(0, 5)) console.log(`   CUT ${item.node} ${item.clientWidth}x${item.clientHeight} < ${item.scrollWidth}x${item.scrollHeight} "${item.text}"`)
  for (const item of result.small.slice(0, 5)) console.log(`   TAP ${item.node} ${item.w}x${item.h} "${item.text}"`)
  if (result.targetGrid) console.log('   GRID', JSON.stringify(result.targetGrid))
  for (const move of result.moveCards ?? []) if (move.spill.length) console.log('   SPILL move card right=' + move.right + ' ->', JSON.stringify(move.spill), move.cols)
  return result
}

const require = createRequire(new URL('../promo/package.json', import.meta.url))
const { chromium } = require('playwright')
const PHONE_AGENT = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36'

// Each viewport gets its own raid service. Reusing one would drop the next
// player straight back into the previous run's live battle.
let api = null
const vite = await startVite()
const origin = vite.resolvedUrls.local[0].replace(/\/$/, '')
const browser = await chromium.launch({ headless: true, executablePath: await resolveChromiumExecutable(chromium) })
const errors = []

async function openPlayer(identity, viewport, { mobile = true } = {}) {
  const context = await browser.newContext({
    viewport,
    ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: PHONE_AGENT } : {}),
  })
  await context.addInitScript(fixture => { window.__raidFixture = fixture },
    { apiUrl: api.url, identity, boxPokemon: boxes[identity] })
  const page = await context.newPage()
  page.setDefaultTimeout(30_000)
  page.on('pageerror', error => errors.push({ identity, message: error.message }))
  await page.goto(`${origin}/raid-mobile.html`)
  await page.locator('.raid-lobby-screen').waitFor()
  return { identity, context, page }
}

// Reloading a room drops the local capture selection, so re-pick before the
// ready button can leave its disabled state.
async function ensureSelectedAndReady(page) {
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

async function settleCommands(page) {
  await page.waitForFunction(() => {
    const screen = document.querySelector('.raid-battle-screen')
    if (!screen) return true
    const commands = screen.querySelector('.raid-standard-commands')
    return Boolean(commands) && !commands.classList.contains('is-turn-locked') && commands.getAttribute('aria-busy') !== 'true'
  }, undefined, { timeout: 40_000 }).catch(() => {})
}

const sizes = (process.argv.slice(2).length ? process.argv.slice(2) : ['932x430', '844x390', '800x360'])
  .map(size => { const [width, height] = size.split('x').map(Number); return { width, height } })

try {
  for (const viewport of sizes) {
    const tag = `${viewport.width}x${viewport.height}`
    console.log(`\n========== ${tag} ==========`)
    api = await startRaidApi()
    // A wide viewport runs as a desktop browser so it serves as the control
    // run proving the phone rules leave the desktop raid untouched.
    const alice = await openPlayer('alice', viewport, { mobile: viewport.width < 1100 })
    const bob = await openPlayer('bob', { width: 1280, height: 720 }, { mobile: false })
    try {
      await audit(alice.page, `${tag}-1-boss-select`)

      await alice.page.locator('.raid-boss-grid .raid-boss-card').first().click()
      await alice.page.locator('.raid-room-list').waitFor()
      await audit(alice.page, `${tag}-2-room-list`)

      await alice.page.getByRole('button', { name: '방 만들기', exact: true }).click()
      const dialog = alice.page.getByRole('dialog', { name: '보스전 방 만들기', exact: true })
      await dialog.waitFor()
      await audit(alice.page, `${tag}-3-create-dialog`)
      await dialog.getByLabel('방 제목', { exact: true }).fill('모바일 점검')
      await dialog.getByRole('button', { name: '방 만들기', exact: true }).click()

      await alice.page.locator('.raid-pokemon-picker').waitFor()
      await audit(alice.page, `${tag}-4-pokemon-picker`)
      await alice.page.locator('.raid-owned-grid button').first().click()
      await alice.page.locator('.raid-room-screen').waitFor()
      await audit(alice.page, `${tag}-5-room-solo`)

      // The second player has been idling on the boss chooser while the room
      // was created, so reload before browsing for it.
      await bob.page.reload()
      await bob.page.locator('.raid-lobby-screen').waitFor()
      await bob.page.locator('.raid-boss-grid .raid-boss-card').first().click()
      await bob.page.locator('.raid-room-list').waitFor()
      await bob.page.locator('.raid-room-card').filter({ hasText: '모바일 점검' }).getByRole('button').first().click()
      await bob.page.getByRole('dialog', { name: '보스전 방 참가', exact: true }).getByRole('button', { name: '참가하기', exact: true }).click()
      await bob.page.locator('.raid-pokemon-picker').waitFor()
      await bob.page.locator('.raid-owned-grid button').first().click()
      await bob.page.locator('.raid-room-screen').waitFor()
      await ensureSelectedAndReady(bob.page)

      await alice.page.reload()
      await alice.page.locator('.raid-room-screen').waitFor()
      await audit(alice.page, `${tag}-6-room-two`)
      await ensureSelectedAndReady(alice.page)
      await audit(alice.page, `${tag}-6b-room-ready`)

      const start = alice.page.getByRole('button', { name: /보스전 시작|솔로로 시작/ })
      await start.waitFor()
      await start.click()
      await alice.page.locator('.raid-battle-screen').waitFor({ timeout: 40_000 })
      await settleCommands(alice.page)
      await audit(alice.page, `${tag}-7-battle-command`)

      const commands = alice.page.locator('.raid-standard-commands')
      await commands.locator('.battle-command-buttons > button.fight').click()
      await commands.locator('.battle-move-button').first().waitFor()
      await audit(alice.page, `${tag}-8-battle-moves`)

      const gimmick = commands.locator('.battle-gimmick-selector button:not(:disabled)')
      if (await gimmick.count()) await audit(alice.page, `${tag}-9-battle-gimmick`)

      await commands.locator('.battle-move-button:not(:disabled)').first().click()
      await alice.page.waitForTimeout(500)
      const targets = commands.locator('.battle-target-card:not(:disabled)')
      if (await targets.count()) {
        await audit(alice.page, `${tag}-10-battle-targets`)
        await targets.first().click()
      }
      await alice.page.waitForTimeout(900)
      await audit(alice.page, `${tag}-11-battle-waiting`)

      const withdraw = alice.page.locator('.raid-header-withdraw')
      if (await withdraw.count()) {
        await withdraw.first().click()
        await alice.page.locator('.raid-withdraw-dialog').waitFor()
        await audit(alice.page, `${tag}-12-withdraw-dialog`)
      }
    } catch (error) {
      console.log(`  !! flow stopped at ${tag}: ${error.message.split('\n')[0]}`)
      await alice.page.screenshot({ path: path.join(output, `${tag}-ERROR.png`) }).catch(() => {})
    } finally {
      await alice.context.close()
      await bob.context.close()
      await api.close()
      api = null
    }
  }
} finally {
  await browser.close()
  await vite.close()
  await api?.close()
}

await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
console.log('\n===== summary =====')
for (const item of report) {
  const real = item.outside.filter(entry => !entry.decorative && !entry.pane)
  console.log(`${item.label}: offscreen ${real.length}/${item.outsideCount}, clipped ${item.cutCount}, small ${item.smallCount}`)
}
if (errors.length) { console.log('\npage errors:'); for (const error of errors.slice(0, 10)) console.log(' ', error.identity, error.message.split('\n')[0]) }
console.log(`\nscreenshots: ${output}`)
