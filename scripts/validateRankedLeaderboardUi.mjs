import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { normalizePokemon } from '../src/data/trainingData.js'
import { createSavedTeams } from '../src/data/teamData.js'
import { createRankedProfile } from '../src/data/rankedRules.js'
import { maskRankedTrainerName } from '../src/data/rankedPrivacy.js'
import { resolveChromiumExecutable } from '../promo/scripts/browserRuntime.mjs'

// Production React screen and HTTP client, isolated auth/HTTP fixtures only.
// This script never contacts the production API or writes ranking records.
const root = fileURLToPath(new URL('../', import.meta.url))
const output = path.join(root, 'scripts/.cache/ranked-leaderboard-ui')
await fs.mkdir(output, { recursive: true })
const boxPokemon = [25, 6, 9, 3, 143, 94].map(speciesId => normalizePokemon({ speciesId, captureId: `leaderboard-ui-${speciesId}` }))
const teams = createSavedTeams(boxPokemon.map(pokemon => pokemon.captureId), boxPokemon.map(pokemon => pokemon.captureId))
const profile = { single: { ...createRankedProfile('single'), points: 900, rating: 1120, wins: 40, losses: 20, played: 60 }, double: createRankedProfile('double') }
function fixtureBoard(format) {
  const initials = format === 'single' ? ['가', '나', '다', '라', '마', '바', '사', '아', '자', '차'] : ['하', '파', '타', '카', '차', '자', '아', '사', '바', '마']
  return { participantCount: 23, entries: initials.map((initial, index) => ({
    rank: index + 1, trainerName: index === 3 ? 'guest-123456' : maskRankedTrainerName(`${initial}나다`),
    isGuest: index === 3, isOwn: index === 3,
    points: index < 3 ? 1200 + (3 - index) * 30 : 1200 - index * 100,
    rating: 1600 - index * 40, wins: 90 - index * 5, losses: 20 + index, draws: index % 3,
    played: 110 - index * 4 + index % 3,
  })) }
}
const populated = { boards: { single: fixtureBoard('single'), double: fixtureBoard('double') }, updatedAt: Date.now() }
const checks = [], errors = [], metrics = []
async function test(name, run) {
  try { await run(); checks.push({ name, passed: true }); console.log(`PASS ${name}`) }
  catch (error) { checks.push({ name, passed: false, error: error.message }); console.error(`FAIL ${name}: ${error.message}`) }
}
const entry = `import React,{StrictMode,useState}from'react';import{createRoot}from'react-dom/client';import RankedBattleScreen from'/src/RankedBattleScreen.jsx';
import'/src/styles.css';import'/src/screenRedesign.css';import'/src/battleHub.css';
function Harness(){const[activeTeamId,setActiveTeamId]=useState('team-1');return React.createElement('div',{className:'app-shell ranked-view'},
React.createElement('header',{className:'topbar'},React.createElement('div',{className:'brand-title'},React.createElement('small',null,'POKÉMON'),React.createElement('strong',null,'CHAMPIONS ARENA'))),
React.createElement(RankedBattleScreen,{user:{uid:'leaderboard-ui',displayName:'guest-123456',isGuest:true,isLocalGuest:false},teams:window.__fixture.teams,boxPokemon:window.__fixture.boxPokemon,activeTeamId,
soundEnabled:false,onSelectTeam:setActiveTeamId,onOpenBox:()=>{},onBack:()=>{}}))}createRoot(document.getElementById('root')).render(React.createElement(StrictMode,null,React.createElement(Harness)));`
process.env.VITE_RANKED_ENABLED = 'true'
process.env.VITE_RANKED_LOCAL_TEST = 'false'
process.env.VITE_RANKED_API_URL = '/api/ranked'
const port = Number(process.env.RANKED_LEADERBOARD_UI_PORT ?? 5238)
const server = await createServer({ root, mode: 'leaderboard-validation', logLevel: 'error',
  plugins: [{ name: 'ranked-leaderboard-fixture', enforce: 'pre',
    resolveId(source) {
      if (source === '/ranked-leaderboard-entry.js') return source
      if (source.endsWith('/auth/firebaseClient') || source.endsWith('/auth/firebaseClient.js')) return '\0leaderboard-fixture-auth'
    },
    load(id) {
      if (id === '/ranked-leaderboard-entry.js') return entry
      if (id === '\0leaderboard-fixture-auth') return `export const firebaseAuth={currentUser:{uid:'leaderboard-ui',getIdToken:async()=>'leaderboard-ui-fixture'}};export const firebaseDb=null;export const isFirebaseConfigured=false;export const missingFirebaseEnvironmentVariables=[];`
    },
  }], server: { host: '127.0.0.1', port, strictPort: true, hmr: false } })
await server.listen()
const require = createRequire(new URL('../promo/package.json', import.meta.url))
const { chromium } = require('playwright')
let browser
try {
  browser = await chromium.launch({ executablePath: await resolveChromiumExecutable(chromium), headless: true })
  const html = await server.transformIndexHtml('/ranked-leaderboard.html', '<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body><div id="root"></div><script type="module" src="/ranked-leaderboard-entry.js"></script></body></html>')
  for (const device of [
    { id: 'desktop', viewport: { width: 1920, height: 900 } },
    { id: 'laptop', viewport: { width: 1366, height: 768 } },
    { id: 'mobile-landscape', viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true },
  ]) {
    const context = await browser.newContext(device)
    await context.addInitScript(value => { window.__fixture = value }, { teams, boxPokemon })
    await context.route('**/ranked-leaderboard.html', route => route.fulfill({ contentType: 'text/html', body: html }))
    // Remote sprite/CDN requests are irrelevant to this test and must not slow it down.
    await context.route(/^https:\/\//, route => route.abort())
    let snapshot = { profile, queue: null, match: null }
    let board = structuredClone(populated), failure = null, deferred = null
    const requests = []
    await context.route('**/api/ranked*', async route => {
      const request = route.request()
      const action = new URL(request.url()).searchParams.get('action') ?? request.postDataJSON()?.action
      requests.push({ action, method: request.method(), authorization: request.headers().authorization })
      if (action === 'rankedLeaderboard') {
        if (deferred) {
          const pending = deferred
          deferred = null
          pending.started()
          await pending.wait
          try { await route.fulfill({ contentType: 'application/json', body: JSON.stringify(pending.board) }) } catch { /* Closing the view aborts this request. */ }
          return
        }
        if (failure) { await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'RANKED_UNAVAILABLE', message: failure } }) }); return }
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify(board) })
        return
      }
      assert.equal(action, 'status', `Unexpected mutation/API action: ${action}`)
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ...snapshot, serverTime: Date.now() }) })
    })
    const page = await context.newPage()
    page.setDefaultTimeout(10_000)
    page.on('pageerror', error => errors.push({ device: device.id, message: error.message }))
    await page.goto(`http://127.0.0.1:${port}/ranked-leaderboard.html`)
    const click = locator => device.hasTouch ? locator.tap() : locator.click()
    const open = () => click(page.getByRole('button', { name: '랭킹 TOP 10', exact: true }))
    const close = () => click(page.getByRole('button', { name: '레이팅 로비', exact: true }))
    const panel = page.getByLabel('레이팅 TOP 10 랭킹', { exact: true })
    const rows = panel.locator('.ranked-leaderboard-row')
    const tabs = page.getByRole('group', { name: '랭킹 배틀 형식', exact: true })
    const refreshButton = page.getByRole('button', { name: '랭킹 새로고침', exact: true })
    const boardCount = () => requests.filter(request => request.action === 'rankedLeaderboard').length
    const statusCount = () => requests.filter(request => request.action === 'status').length
    async function refresh() {
      await Promise.all([
        page.waitForResponse(response => new URL(response.url()).searchParams.get('action') === 'rankedLeaderboard'),
        click(refreshButton),
      ])
    }
    await test(`${device.id}: authenticated guest opens real lobby leaderboard without eager ranking requests`, async () => {
      await page.getByRole('group', { name: '저장된 출전 팀 선택' }).waitFor()
      assert.equal(boardCount(), 0)
      await open()
      await rows.nth(9).waitFor()
      assert.equal(await rows.count(), 10)
      assert.match(await rows.first().innerText(), /가\*\*/)
      assert.equal(await panel.locator('.ranked-leaderboard-row.is-own').count(), 1)
      assert.match(await panel.locator('.ranked-leaderboard-row.is-own').innerText(), /guest-123456/)
      assert(!/가나다|나나다/.test(await panel.innerText()))
      const rankingRequests = requests.filter(request => request.action === 'rankedLeaderboard')
      assert(rankingRequests.length > 0)
      assert(rankingRequests.every(request => request.method === 'GET' && request.authorization === 'Bearer leaderboard-ui-fixture'))
    })
    await test(`${device.id}: switching single/double shows separate top ten without additional requests`, async () => {
      const before = boardCount()
      await click(tabs.getByRole('button', { name: '더블배틀', exact: true }))
      assert.equal(await rows.count(), 10)
      assert.match(await rows.first().innerText(), /하\*\*/)
      assert.equal(await tabs.getByRole('button', { name: '더블배틀', exact: true }).getAttribute('aria-pressed'), 'true')
      await click(tabs.getByRole('button', { name: '싱글배틀', exact: true }))
      assert.match(await rows.first().innerText(), /가\*\*/)
      assert.equal(boardCount(), before)
    })
    await test(`${device.id}: viewport stays fixed and all ten ranks remain reachable`, async () => {
      await rows.last().scrollIntoViewIfNeeded()
      const geometry = await page.evaluate(() => {
        const last = document.querySelector('.ranked-leaderboard-row:last-child').getBoundingClientRect()
        const first = document.querySelector('.ranked-leaderboard-row').getBoundingClientRect()
        return { width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth,
          documentHeight: document.documentElement.scrollHeight, last: { top: last.top, bottom: last.bottom, left: last.left, right: last.right }, firstTop: first.top }
      })
      metrics.push({ device: device.id, ...geometry })
      assert(geometry.documentWidth <= geometry.width + 1, JSON.stringify(geometry))
      assert(geometry.documentHeight <= geometry.height + 1, JSON.stringify(geometry))
      assert(geometry.last.top >= 0 && geometry.last.bottom <= geometry.height + 1, JSON.stringify(geometry))
      assert(geometry.last.left >= 0 && geometry.last.right <= geometry.width + 1, JSON.stringify(geometry))
      if (!device.hasTouch) assert(geometry.firstTop >= 0, JSON.stringify(geometry))
      await rows.first().scrollIntoViewIfNeeded()
      await page.screenshot({ path: path.join(output, `${device.id}.png`), fullPage: true })
    })
    if (device.id === 'desktop') {
      await test('leaderboard remains independent of 1.5-second match status polling', async () => {
        const beforeBoard = boardCount(), beforeStatus = statusCount()
        await page.waitForTimeout(3400)
        assert(statusCount() >= beforeStatus + 2)
        assert.equal(boardCount(), beforeBoard)
      })
      await test('manual refresh replaces rankings after a newly settled result', async () => {
        board.boards.single.entries[0].trainerName = '새**'
        board.boards.single.entries[0].rating = 1800
        const before = boardCount()
        await refresh()
        await rows.first().filter({ hasText: '새**' }).waitFor()
        assert.match(await rows.first().innerText(), /1,800|1800/)
        assert.equal(boardCount(), before + 1)
      })
      await test('empty board has a clear state and remains isolated from the other format', async () => {
        board.boards.single = { entries: [], participantCount: 0 }
        await refresh()
        await panel.getByText('아직 완료된 대전이 없습니다', { exact: true }).waitFor()
        assert.equal(await rows.count(), 0)
        await click(tabs.getByRole('button', { name: '더블배틀', exact: true }))
        assert.equal(await rows.count(), 10)
        await click(tabs.getByRole('button', { name: '싱글배틀', exact: true }))
      })
      await test('server error is visible and retry restores actual response data', async () => {
        failure = '랭킹 서버 연결을 확인해 주세요.'
        await refresh()
        await panel.getByRole('alert').waitFor()
        assert.match(await panel.getByRole('alert').innerText(), /랭킹 서버 연결/)
        failure = null
        board = structuredClone(populated)
        await refresh()
        await rows.nth(9).waitFor()
        assert.equal(await panel.getByRole('alert').count(), 0)
      })
      await test('closing and reopening requests fresh rankings and ignores a stale request', async () => {
        let started, release
        const startedPromise = new Promise(resolve => { started = resolve })
        const wait = new Promise(resolve => { release = resolve })
        const oldBoard = structuredClone(board)
        oldBoard.boards.single.entries[0].trainerName = '옛**'
        deferred = { board: oldBoard, started, wait }
        await click(refreshButton)
        await startedPromise
        await close()
        await panel.waitFor({ state: 'hidden' })
        board.boards.single.entries[0].trainerName = '최**'
        await open()
        await rows.first().filter({ hasText: '최**' }).waitFor()
        release()
        await page.waitForTimeout(100)
        assert(!/옛\*\*/.test(await panel.innerText()))
      })
      await test('a match found while viewing rankings immediately opens team selection', async () => {
        snapshot = { profile, queue: null, match: { id: 'leaderboard-select-fixture', format: 'single', phase: 'select', revision: 1,
          deadlineAt: Date.now() + 90_000, you: { name: 'guest-123456', isGuest: true }, opponent: { name: '상대 트레이너' },
          teamPreview: { you: boxPokemon, opponent: boxPokemon }, selectionSubmitted: false, opponentSelectionSubmitted: false } }
        await page.evaluate(() => window.dispatchEvent(new Event('online')))
        await page.getByRole('heading', { name: '3마리를 출전 순서대로 선택하세요', exact: true }).waitFor()
        assert.equal(await panel.count(), 0)
        assert.equal(await page.getByRole('button', { name: '랭킹 TOP 10', exact: true }).count(), 0)
        assert.equal(await page.locator('.ranked-selection').getByRole('button', { name: /출전 선택$/ }).count(), 6)
      })
    } else {
      await close()
      await page.getByRole('group', { name: '저장된 출전 팀 선택' }).waitFor()
    }
    await context.close()
  }
} finally {
  await browser?.close()
  await server.close()
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ checks, errors, metrics }, null, 2))
}
assert.equal(errors.length, 0, JSON.stringify(errors))
assert(checks.every(check => check.passed), 'Ranked leaderboard UI regression failed')
console.log(`${checks.length}/${checks.length} passed; browser errors ${errors.length}`)
