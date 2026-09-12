import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { normalizePokemon } from '../src/data/trainingData.js'
import { createSavedTeams } from '../src/data/teamData.js'
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
const checks = [], errors = []
async function test(name, run) {
  try { await run(); checks.push({ name, passed: true }); console.log(`PASS ${name}`) }
  catch (error) { checks.push({ name, passed: false, error: error.message }); console.error(`FAIL ${name}: ${error.message}`) }
}
const entry = `import React,{StrictMode,useState} from 'react';import{createRoot}from'react-dom/client';import RankedBattleScreen from '/src/RankedBattleScreen.jsx';
import '/src/styles.css';import '/src/screenRedesign.css';import '/src/battleHub.css';
window.__savedTeamEvents={selected:[],opened:[],saved:0};window.__saveResult=true;
function Harness(){const[activeTeamId,setActiveTeamId]=useState('team-1');return React.createElement('div',{className:'app-shell ranked-view'},React.createElement(RankedBattleScreen,{
user:{uid:'saved-team-ui',displayName:'테스트 트레이너'},teams:window.__fixture.teams,boxPokemon:window.__fixture.boxPokemon,activeTeamId,soundEnabled:false,
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
    const requests = []
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
      } else if (statusFailure) {
        await route.fulfill({ status: statusFailure.status, contentType: 'application/json', body: JSON.stringify({ error: statusFailure.error }) })
        return
      }
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ...snapshot, serverTime: Date.now() }) })
    })
    const page = await context.newPage()
    page.setDefaultTimeout(10_000)
    page.on('pageerror', error => errors.push({ device: device.id, message: error.message }))
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
