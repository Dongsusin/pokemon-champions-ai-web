import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { normalizePokemon } from '../src/data/trainingData.js'
import { resolveChromiumExecutable } from '../promo/scripts/browserRuntime.mjs'

// Real ranked, room and factory components with a local in-memory transport.
// No accounts, match servers or production records are read or written.
const root = fileURLToPath(new URL('../', import.meta.url))
const output = path.join(root, 'scripts/.cache/scaled-battle-cards-ui')
await fs.mkdir(output, { recursive: true })
const pokemon = [25, 6, 9, 143, 1009, 1021].map((speciesId, index) => ({
  ...normalizePokemon({ speciesId, captureId: `scaled-card-${index}`, heldItemId: 'assault-vest' }),
  icon: '/test-sprite-96.gif', iconFallback: '/test-sprite-96.gif',
}))
const teams = Array.from({ length: 5 }, (_, index) => ({ id: `team-${index + 1}`, name: `팀 ${index + 1}`, pokemonIds: index ? [] : pokemon.map(entry => entry.captureId) }))
const styles = ['styles', 'screenRedesign', 'battleGen5', 'titleCleanup', 'battleGimmicks', 'settings', 'mobileLandscape', 'ranked', 'battleRooms', 'battleFactory', 'gameTextScale', 'scaledBattleCards']
const transport = `export const isRankedEnabled=true,isRankedLocalTest=false;export const createRankedRequestId=()=>crypto.randomUUID();export class RankedRequestError extends Error{};
export function createRankedClient(){return{status:async()=>window.__snapshot,request:async(action,payload)=>{if(action==='select')window.__lastSelection={action,payload};return window.__snapshot}}}`
const entry = `import'/src/mobileViewport.js';import React,{useState,useLayoutEffect}from'react';import{createRoot}from'react-dom/client';
import RankedBattleScreen from'/src/RankedBattleScreen.jsx';import BattleRoomsScreen from'/src/BattleRoomsScreen.jsx';import BattleFactoryLobby from'/src/BattleFactoryLobby.jsx';import{applyGameTextScale}from'/src/gameTextScale.js';
${styles.map(name => `import'/src/${name}.css';`).join('\n')}
const fixture=window.__fixture;const user={uid:'card-ui-test',displayName:'테스트'};function Harness(){const[view,setView]=useState('ranked');const[scale,setScale]=useState(1);const[nonce,setNonce]=useState(0);
window.__cards={show:(next,snapshot)=>{window.__snapshot=snapshot;setView(next);setNonce(n=>n+1)},scale:setScale};useLayoutEffect(()=>{applyGameTextScale(scale)},[scale]);
return React.createElement('div',{className:'app-shell ranked-view'+(view==='rooms'?' rooms-view':view==='factory'?' factory-view':'')},view==='factory'?React.createElement(BattleFactoryLobby,{key:nonce,run:fixture.run,onBack:()=>{},onChooseRentals:ids=>{window.__rentals=ids},onChooseLead:()=>{},onStartBattle:()=>{},onAdvanceFloor:()=>{}}):React.createElement(view==='rooms'?BattleRoomsScreen:RankedBattleScreen,{key:nonce,user,teams:fixture.teams,boxPokemon:fixture.pokemon,activeTeamId:'team-1',soundEnabled:false,onBack:()=>{},onSelectTeam:()=>{},onOpenBox:()=>{}}))}
createRoot(document.getElementById('root')).render(React.createElement(Harness));`
const server = await createServer({ root, logLevel: 'error', plugins: [{ name: 'scaled-cards-fixture', enforce: 'pre',
  resolveId: id => id === '/scaled-cards-entry.js' ? id : undefined,
  load(id) { if (id === '/scaled-cards-entry.js') return entry; if (id.replaceAll('\\', '/').endsWith('/src/rankedClient.js')) return transport },
}], server: { host: '127.0.0.1', port: Number(process.env.SCALED_CARDS_UI_PORT ?? 5245), strictPort: true, hmr: false } })
await server.listen()
const require = createRequire(new URL('../promo/package.json', import.meta.url))
const { chromium } = require('playwright')
const checks = [], errors = []
async function test(name, run) { try { await run(); checks.push({ name, passed: true }); console.log(`PASS ${name}`) } catch (error) { checks.push({ name, passed: false, error: error.message }); console.error(`FAIL ${name}: ${error.message}`) } }
const initial = () => ({ profile: { single: { points: 0, rating: 1000, wins: 0, losses: 0, draws: 0 }, double: { points: 0, rating: 1000, wins: 0, losses: 0, draws: 0 } }, rooms: [], match: null, serverTime: Date.now() })
function selection(format) { return { ...initial(), match: { id: `fixture-${format}`, phase: 'select', format, revision: 1, deadline: Date.now() + 600_000, opponent: { name: '상대' }, teamPreview: { you: pokemon, opponent: pokemon }, selectedIndices: [], selectionSubmitted: false } } }
async function verifyCardText(page, selector, nameSelector = ':scope > strong, :scope > small, :scope > .ranked-pokemon-number') {
  const cards = page.locator(selector)
  assert.equal(await cards.count(), 6)
  for (const card of await cards.all()) {
    await card.scrollIntoViewIfNeeded()
    const data = await card.evaluate((element, selector) => {
      const card = element.getBoundingClientRect()
      const failures = [...element.querySelectorAll(selector)].flatMap(text => {
        const range = document.createRange(); range.selectNodeContents(text)
        const rects = [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0)
        return rects.filter(rect => rect.left < card.left - 2 || rect.right > card.right + 2 || rect.top < card.top - 2 || rect.bottom > card.bottom + 2)
          .map(rect => ({ text: text.textContent, card: { left: card.left, top: card.top, right: card.right, bottom: card.bottom }, rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } }))
      })
      let visibleTop = Math.max(0, card.top), visibleBottom = Math.min(innerHeight, card.bottom)
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        if (!/(auto|scroll|hidden|clip)/.test(getComputedStyle(parent).overflowY)) continue
        const rect = parent.getBoundingClientRect(); visibleTop = Math.max(visibleTop, rect.top); visibleBottom = Math.min(visibleBottom, rect.bottom)
      }
      return { failures, viewport: { width: innerWidth, height: innerHeight }, horizontal: card.left >= -1 && card.right <= innerWidth + 1,
        visibleHeight: visibleBottom - visibleTop, cardHeight: card.height }
    }, nameSelector)
    assert.deepEqual(data.failures, [], `Card text cropped: ${JSON.stringify(data.failures)}`)
    assert(data.horizontal, 'Card extends outside horizontal viewport')
    assert(data.visibleHeight >= Math.min(48, data.cardHeight * .5), `Card list collapsed and hides its choices: ${JSON.stringify(data)}`)
  }
}
let browser
try {
  browser = await chromium.launch({ executablePath: await resolveChromiumExecutable(chromium), headless: true })
  // Local animated artwork keeps sprite sizing independent of external CDNs.
  const testSprite = await fs.readFile(path.join(root, 'scripts/fixtures/test-sprite-96.gif'))
  const html = await server.transformIndexHtml('/scaled-cards.html', '<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body><div id="root"></div><script type="module" src="/scaled-cards-entry.js"></script></body></html>')
  for (const device of [{ id: 'laptop', viewport: { width: 1366, height: 768 } }, { id: 'mobile', viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true }].filter(device => !process.env.SCALED_CARDS_UI_DEVICE || device.id === process.env.SCALED_CARDS_UI_DEVICE)) {
    const context = await browser.newContext({ ...device, reducedMotion: 'reduce' })
    await context.addInitScript(fixture => { window.__fixture = fixture; window.__snapshot = fixture.snapshot }, { pokemon, teams, snapshot: initial(), run: { id: 'card-ui-factory', phase: 'selection', floor: 1, offers: pokemon, party: [] } })
    await context.route(/^https:\/\//, route => route.abort())
    await context.route('**/scaled-cards.html', route => route.fulfill({ contentType: 'text/html', body: html }))
    await context.route('**/test-sprite-96.gif', route => route.fulfill({ contentType: 'image/gif', body: testSprite }))
    const page = await context.newPage()
    const click = locator => device.hasTouch ? locator.tap() : locator.click()
    page.setDefaultTimeout(8000)
    page.on('pageerror', error => { errors.push({ device: device.id, error: error.message }); console.error(`BROWSER ${error.message}`) })
    await page.goto(`http://127.0.0.1:${server.config.server.port}/scaled-cards.html`)
    await page.waitForFunction(() => window.__cards)
    // Mobile is pinned to the 1x ramp, so only desktop-class frames sweep the
    // enlarged presets.
    const deviceScales = device.isMobile ? [1] : [1.5, 2]
    for (const scale of deviceScales.filter(scale => !process.env.SCALED_CARDS_UI_SCALE || scale === Number(process.env.SCALED_CARDS_UI_SCALE))) {
      await page.evaluate(scale => window.__cards.scale(scale), scale)
      for (const view of ['ranked', 'rooms']) {
        await test(`${device.id} ${scale}x ${view}: all six registered names/types fit their cards`, async () => {
          await page.evaluate(({ view, snapshot }) => window.__cards.show(view, snapshot), { view, snapshot: initial() })
          await page.locator('.ranked-roster-card').first().waitFor()
          await verifyCardText(page, '.ranked-roster-card')
          const cards = page.locator('.ranked-roster-card')
          for (const card of await cards.all()) {
            if (device.hasTouch) await card.tap(); else await card.focus()
            await page.locator('.ranked-pokemon-tooltip').waitFor(); await page.keyboard.press('Escape')
          }
          await page.screenshot({ path: path.join(output, `${device.id}-${view}-${scale}x.png`) })
        })
        for (const format of ['single', 'double']) await test(`${device.id} ${scale}x ${view} ${format}: all six choices remain readable and ${format === 'single' ? 3 : 4} can be selected`, async () => {
          await page.evaluate(({ view, snapshot }) => window.__cards.show(view, snapshot), { view, snapshot: selection(format) })
          await page.mouse.move(0, 0)
          const choices = '.ranked-team-preview button.ranked-pokemon-card'
          await page.locator(choices).first().waitFor()
          await verifyCardText(page, choices)
          const cards = page.locator(choices)
          for (let index = 0; index < (format === 'single' ? 3 : 4); index++) await click(cards.nth(index))
          assert.equal(await page.locator(`${choices}[aria-pressed="true"]`).count(), format === 'single' ? 3 : 4)
          await page.evaluate(() => { window.__lastSelection = null })
          await click(page.getByRole('button', { name: '선출 확정', exact: true }))
          const submission = await page.evaluate(() => window.__lastSelection)
          assert.equal(submission.action, 'select')
          assert.deepEqual(submission.payload.selection, format === 'single' ? [0, 1, 2] : [0, 1, 2, 3])
          while (await page.locator(`${choices}[aria-pressed="true"]`).count()) await click(page.locator(`${choices}[aria-pressed="true"]`).first())
          await click(cards.last())
          assert.equal(await cards.last().getAttribute('aria-pressed'), 'true', 'Last registered choice remains reachable')
          await page.screenshot({ path: path.join(output, `${device.id}-${view}-${format}-${scale}x.png`) })
        })
      }
      await test(`${device.id} ${scale}x factory: all six rental names/items fit and selection remains usable`, async () => {
        await page.evaluate(() => window.__cards.show('factory', null))
        await page.locator('.factory-rental-card').first().waitFor()
        await verifyCardText(page, '.factory-rental-card', '.factory-rental-select > strong, .factory-card-types, .factory-card-item')
        const choices = page.locator('.factory-rental-select')
        for (const index of [0, 2, 5]) await click(choices.nth(index))
        assert.equal(await page.locator('.factory-rental-select[aria-pressed="true"]').count(), 3)
        await page.screenshot({ path: path.join(output, `${device.id}-factory-${scale}x.png`) })
      })
    }
    await context.close()
  }
  assert.deepEqual(errors, [], 'Unexpected browser errors')
} finally {
  await browser?.close()
  await server.close()
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ checks, errors }, null, 2))
}
if (checks.some(check => !check.passed)) process.exitCode = 1
console.log(`Scaled battle cards UI: ${checks.filter(check => check.passed).length}/${checks.length}`)
