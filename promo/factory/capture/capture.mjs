import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer } from 'vite'
import { createMemoryRankedStore } from '../../../server/rankedStore.js'
import { createRankedService } from '../../../server/rankedService.js'
import { createRankedHttpHandler } from '../../../server/rankedHttp.js'
import { normalizePokemon } from '../../../src/data/trainingData.js'
import { chooseAiActionsForSide, chooseAiReplacementIndex, getBattleSummary } from '../../../src/data/battleEngine.js'
import { resolveChromiumExecutable } from '../../scripts/browserRuntime.mjs'

if (process.env.NODE_ENV === 'production' || process.env.VERCEL) throw Error('Local capture only')
const root = fileURLToPath(new URL('../../../', import.meta.url))
const output = path.join(root, 'promo/factory/generated/footage')
const trainerImage = '/assets/trainers/factory-clown-cutout.png'
const sourcePaths = [
  'src/App.jsx', 'src/BattleFactoryScreen.jsx', 'src/BattleFactoryLobby.jsx',
  'src/BattleFactoryRankings.jsx', 'src/TrainerSprite.jsx', 'src/BattleScreen.jsx',
  'src/data/trainerSprites.js', 'src/data/battleFactory.js', 'src/data/battleEngine.js',
  'src/battleFactory.css', 'src/styles.css', 'src/screenRedesign.css', 'src/battleGen5.css',
  'src/battleGimmicks.css', 'src/mobileLandscape.css',
  `public${trainerImage}`, 'promo/factory/capture/entry.jsx',
]
const gitCommit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, windowsHide: true, encoding: 'utf8' })
assert.equal(gitCommit.status, 0, gitCommit.stderr)
const sourceGameCommit = gitCommit.stdout.trim()
const sourceGameFiles = await Promise.all(sourcePaths.map(async relativePath => {
  const content = await fs.readFile(path.join(root, relativePath))
  return { path: relativePath, bytes: content.length, sha256: createHash('sha256').update(content).digest('hex') }
}))
const sourceStatus = spawnSync('git', ['status', '--porcelain', '--', ...sourcePaths], { cwd: root, windowsHide: true, encoding: 'utf8' })
assert.equal(sourceStatus.status, 0, sourceStatus.stderr)
const sourceWorkingTreeChanged = Boolean(sourceStatus.stdout.trim())
await fs.mkdir(output, { recursive: true })
const require = createRequire(new URL('../../package.json', import.meta.url))
const { chromium } = require('playwright')
const ffmpeg = require('ffmpeg-static')
const store = createMemoryRankedStore()
const service = createRankedService({ store, usageEnabled: false })
const user = { uid: 'factory-promo-viewer', displayName: '도전자', isLocalGuest: false }
const handler = createRankedHttpHandler({ service, enabled: true, allowLocalOrigins: true,
  authenticate: async (request, token) => {
    assert.equal(new URL(request.url).hostname, '127.0.0.1')
    assert.equal(token, 'factory-promo-local-token')
    return { uid: user.uid, name: user.displayName }
  },
})
const shots = [], errors = [], blocked = new Set(), actions = [], battles = [], apiAudit = []
let frontend, browser, page, phase = 'setup'
const pause = seconds => page.waitForTimeout(seconds * 1000)
async function loaded() {
  await page.evaluate(() => document.fonts.ready)
  await page.evaluate(() => document.querySelectorAll('img').forEach(image => { image.loading = 'eager' }))
  await page.waitForFunction(() => [...document.images].filter(image => image.getBoundingClientRect().width > 0).every(image => image.complete && image.naturalWidth > 0), null, { timeout: 60000 })
  await pause(.3)
  return page.evaluate(() => [...document.images].filter(image => image.getBoundingClientRect().width > 0).map(image => ({ src: image.currentSrc, loaded: image.complete && image.naturalWidth > 0 })))
}
async function shot(id, duration, action = async () => {}) {
  phase = `capture ${id}`
  const visibleImages = await loaded(); await page.mouse.move(1910, 1070)
  await page.evaluate(() => { const marker = document.createElement('div'); marker.id = 'capture-marker'; marker.style.cssText = 'position:fixed;inset:0;background:rgb(0,255,0);z-index:2147483647'; document.body.append(marker) })
  await pause(.6)
  await page.evaluate(() => document.getElementById('capture-marker').remove())
  const start = Date.now()
  const item = { id, duration, viewport: { width: 1920, height: 1080 }, image: path.join(output, `${id}.png`), wallStart: start, visibleImages }
  shots.push(item)
  await page.screenshot({ path: item.image })
  await action()
  await pause(Math.max(0, duration + 1 - (Date.now() - start) / 1000))
  item.recordedDuration = (Date.now() - start) / 1000
  item.visibleText = await page.locator('body').innerText()
  await page.screenshot({ path: path.join(output, `${id}-end.png`) })
  console.log('SHOT', id, item.recordedDuration.toFixed(1))
}
async function dismissDialogue() {
  const dialogue = page.locator('.battle-trainer-dialogue-box')
  if (await dialogue.count()) { await dialogue.click(); await pause(.25) }
  const intro = page.locator('.battle-intro-overlay button')
  if (await intro.count()) { await intro.last().click(); await pause(.25) }
}
async function ready() {
  await page.locator('.battle-game-screen').waitFor()
  for (let i = 0; i < 25; i++) {
    await dismissDialogue()
    if (await page.evaluate(() => window.__captureBattle && !window.__captureBattle.introVisible && !window.__captureBattle.isTurnAnimating)) break
    await pause(.4)
  }
  await loaded()
}
async function command() {
  await dismissDialogue()
  const state = await page.evaluate(() => window.__captureBattle)
  if (!state || state.isTurnAnimating || state.introVisible || state.battle.winner) return false
  const replacements = page.locator('.battle-party-menu-grid button')
  if (await replacements.count()) {
    const chosen = chooseAiReplacementIndex(state.battle, 'player', 0)
    const target = chosen === null ? replacements.locator(':not(:disabled)').first() : replacements.nth(chosen)
    if (await target.isEnabled()) { await target.click(); actions.push({ floor: (await page.evaluate(() => window.__factoryRun.floor)), turn: state.battle.turn, type: 'replacement', targetIndex: chosen }); return true }
  }
  const fight = page.locator('.battle-command-buttons .fight:not(:disabled)')
  if (!await fight.count()) return false
  const action = chooseAiActionsForSide(state.battle, 'player', () => .5)[0] ?? { type: 'move', moveIndex: 0 }
  actions.push({ floor: await page.evaluate(() => window.__factoryRun.floor), turn: state.battle.turn, wallTime: Date.now(), ...action })
  console.log('ACTION', JSON.stringify(actions.at(-1)))
  if (action.type === 'switch') {
    await page.locator('.battle-command-buttons .pokemon').click()
    await page.locator('.battle-party-menu-grid button').nth(action.targetIndex).click()
  } else {
    await fight.click()
    if (action.gimmick) {
      const gimmick = page.locator(`.battle-gimmick-selector button.mechanic-${action.gimmick}`)
      if (await gimmick.count()) await gimmick.click()
    }
    const moves = page.locator('.battle-move-button')
    const target = moves.nth(Math.max(0, action.moveIndex))
    await target.waitFor()
    if (await target.isEnabled()) await target.click()
    else await page.locator('.battle-move-button:not(:disabled)').first().click()
    const targets = page.locator('.battle-target-grid button:not(:disabled)')
    if (await targets.count()) await targets.first().click()
  }
  await page.mouse.move(1910, 1070)
  return true
}
async function finishFloor() {
  phase = 'play real floor'
  const deadline = Date.now() + 720000
  while (Date.now() < deadline) {
    await dismissDialogue()
    if (await page.locator('.battle-result-overlay').count()) break
    await command(); await pause(.35)
  }
  await page.locator('.battle-result-overlay.result-player').waitFor({ timeout: 5000 })
  const state = await page.evaluate(() => window.__captureBattle.battle)
  const summary = getBattleSummary(state)
  assert.equal(summary.winner, 'player'); assert.equal(summary.opponentRemaining, 0)
  battles.push({ floor: await page.evaluate(() => window.__factoryRun.floor), ...summary, log: state.log })
  await page.screenshot({ path: path.join(output, `victory-${battles.length}.png`) })
  await pause(1.2)
  await page.getByRole('button', { name: '배틀 마치기' }).click()
  await page.locator('.battle-factory.phase-exchange').waitFor()
  console.log('WIN', JSON.stringify(summary))
}

try {
  Object.assign(process.env, { VITE_GAME_STORAGE_PROVIDER: 'firestore', VITE_FACTORY_LOCAL_TEST: 'false', VITE_RANKED_ENABLED: 'true', VITE_RANKED_LOCAL_TEST: 'false', VITE_RANKED_API_URL: '/api/ranked', VITE_POKEMON_USAGE_ENABLED: 'false', VITE_POKEMON_USAGE_DEMO: 'false', VITE_POKEMON_USAGE_SEEDED_TEST: 'false' })
  frontend = await createServer({ root, mode: 'factory-capture', plugins: [{ name: 'factory-isolated-auth', enforce: 'pre',
    resolveId(source) { if (/\/auth\/firebaseClient(?:\.js)?$/.test(source) || source === './firebaseClient') return '\0capture-auth' },
    load(id) { if (id === '\0capture-auth') return 'export const firebaseAuth={currentUser:window.__captureUser};export const firebaseDb=null;export const isFirebaseConfigured=false;export const missingFirebaseEnvironmentVariables=[];' },
  }], server: { host: '127.0.0.1', port: 5279, strictPort: false, hmr: false }, logLevel: 'error' })
  await frontend.listen()
  const url = `http://127.0.0.1:${frontend.httpServer.address().port}`
  const html = await frontend.transformIndexHtml('/capture.html', `<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><link rel="preload" as="image" href="${trainerImage}"></head><body><div id="root"></div><script type="module" src="/promo/factory/capture/entry.jsx"></script></body></html>`)
  browser = await chromium.launch({ executablePath: await resolveChromiumExecutable(chromium), headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] })
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, serviceWorkers: 'block', recordVideo: { dir: output, size: { width: 1920, height: 1080 } } })
  await context.addInitScript(({ user, owned }) => {
    window.__captureUser = { ...user, getIdToken: async () => 'factory-promo-local-token' }
    localStorage.setItem('champions-dex-v2', JSON.stringify(owned))
    localStorage.setItem('champions-draw-tutorial-v1', 'complete')
    localStorage.setItem('champions-settings-v1', JSON.stringify({ audio: { enabled: false }, game: { attackAnimation: 'normal', hpBarSpeed: 'normal' } }))
  }, { user, owned: [normalizePokemon({ speciesId: 25, captureId: 'factory-promo-owned-25', directDrawCount: 1 })] })
  await context.route('**/*', async route => {
    const request = route.request(), target = new URL(request.url())
    if (target.origin !== url) {
      if (request.method() === 'GET' && ['raw.githubusercontent.com', 'play.pokemonshowdown.com'].includes(target.hostname)) return route.continue()
      blocked.add(`${request.method()} ${target.origin}`); return route.abort('blockedbyclient')
    }
    if (target.pathname === '/capture.html') return route.fulfill({ contentType: 'text/html', body: html })
    if (target.pathname === '/api/ranked') {
      const payload = JSON.parse(request.postData() ?? '{}')
      const result = await handler(new Request(request.url(), { method: request.method(), headers: request.headers(), ...(!['GET', 'HEAD'].includes(request.method()) ? { body: request.postData() } : {}) }))
      apiAudit.push({ action: payload.action ?? target.searchParams.get('action'), method: request.method(), status: result.status })
      return route.fulfill({ status: result.status, headers: Object.fromEntries(result.headers), body: await result.text() })
    }
    if (target.pathname.startsWith('/api/')) throw Error(`Unexpected API ${target.pathname}`)
    if (target.pathname === '/src/BattleScreen.jsx') {
      const response = await route.fetch(); let body = await response.text()
      assert(body.includes('const currentLogEntry ='))
      body = body.replace('const currentLogEntry =', 'window.__captureBattle={battle,menu,commandSlot,isTurnAnimating,introVisible}; const currentLogEntry =')
      return route.fulfill({ response, body })
    }
    if (target.pathname === '/src/BattleFactoryScreen.jsx') {
      const response = await route.fetch(); let body = await response.text()
      body = body.replace('const currentRun =', 'window.__factoryRun=run; const currentRun =').replaceAll('createFactoryRun()', 'createFactoryRun({seed:"factory-promo-10"})')
      return route.fulfill({ response, body })
    }
    return route.continue()
  })
  page = await context.newPage(); page.setDefaultTimeout(30000)
  page.on('pageerror', error => { errors.push(error.message); console.log('BROWSER ERROR', error.message) })
  await page.goto(`${url}/capture.html`)
  await page.locator('.mode-start').click()
  await page.locator('.battle-hub-card.factory').click()
  await page.locator('.factory-rental-grid').waitFor(); await loaded()
  const initial = await page.evaluate(() => window.__factoryRun)
  await fs.writeFile(path.join(output, 'initial-run.json'), JSON.stringify(initial, null, 2))
  assert.equal(initial.offers.length, 6)
  console.log('RENTALS', initial.offers.map(pokemon => pokemon.name).join(', '))
  await shot('rentals', 12, async () => {
    await pause(4)
    await page.locator('.factory-rental-info').nth(2).click(); await pause(3)
    await page.getByRole('button', { name: '포켓몬 정보 닫기', exact: true }).click()
    for (const index of [0, 2, 3]) { await pause(.8); await page.locator('.factory-rental-grid .factory-rental-select').nth(index).click() }
    await page.mouse.move(1910, 1070)
  })
  await page.getByRole('button', { name: /렌탈 팀 확정/ }).click()
  await page.locator('.battle-factory.phase-ready').waitFor()
  await shot('lead', 8, async () => {
    await pause(4)
    await page.getByRole('button', { name: '한카리아스 선봉 선택', exact: true }).click()
    await pause(2); await page.mouse.move(1910, 1070)
  })
  await page.getByRole('button', { name: '1층 배틀 시작', exact: true }).click(); await ready()
  await shot('battle', 14, async () => {
    await pause(4)
    const end = Date.now() + 9000
    while (Date.now() < end) { await command(); await pause(.3) }
  })
  await finishFloor()
  await shot('swap', 12, async () => {
    await pause(4)
    await page.locator('.factory-exchange-groups .factory-team-grid').first().locator('.factory-rental-select').nth(1).click()
    await pause(2)
    await page.locator('.factory-exchange-groups .factory-team-grid').last().locator('.factory-rental-select').nth(1).click()
    await pause(2); await page.mouse.move(1910, 1070)
    await page.getByRole('button', { name: '교환하고 다음 층', exact: true }).click()
    await page.locator('.battle-factory.phase-ready').waitFor()
  })
  assert.equal(await page.evaluate(() => window.__factoryRun.floor), 2)
  await page.getByRole('button', { name: '한카리아스 선봉 선택', exact: true }).click()
  await page.getByRole('button', { name: '2층 배틀 시작', exact: true }).click(); await ready()
  await finishFloor()
  await shot('climb', 9, async () => {
    await pause(4)
    await page.getByRole('button', { name: '교환 없이 다음 층', exact: true }).click()
    await page.locator('.battle-factory.phase-ready').waitFor(); await pause(2)
    await page.getByRole('button', { name: '칠색조 선봉 선택', exact: true }).click(); await page.mouse.move(1910, 1070)
  })
  await page.getByRole('button', { name: '3층 배틀 시작', exact: true }).click(); await ready()
  await page.locator('.battle-command-buttons .surrender').click()
  await page.locator('.battle-factory.phase-finished').waitFor()
  const completed = await page.evaluate(() => window.__factoryRun)
  assert.equal(completed.wins, 2); assert.equal(completed.floor, 3); assert.equal(completed.lastResult.forfeited, true)
  await page.getByRole('button', { name: 'TOP 10 랭킹', exact: true }).click()
  await page.locator('.factory-ranking-row').waitFor()
  await shot('rankings', 12, async () => {
    await pause(4)
    await page.locator('.factory-ranking-row').first().click(); await pause(3.8)
    await page.locator('.factory-ranking-pokemon button').last().click(); await pause(3.5)
    await page.getByRole('button', { name: '포켓몬 정보 닫기', exact: true }).click(); await page.mouse.move(1910, 1070)
  })
  await fs.writeFile(path.join(output, 'completed-run.json'), JSON.stringify(completed, null, 2))
  assert.equal(errors.length, 0, JSON.stringify(errors)); assert.equal(blocked.size, 0, [...blocked].join('\n'))
  assert(apiAudit.some(request => request.action === 'reportFactoryRun' && request.status === 200))
} catch (error) {
  errors.push({ phase, message: error.stack }); console.error('FAIL', phase, error.stack)
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {})
  await fs.writeFile(path.join(output, 'failure.txt'), await page?.locator('body').innerText().catch(() => '') ?? '')
  process.exitCode = 1
} finally {
  await fs.writeFile(path.join(output, 'local-api-state.json'), JSON.stringify(await store.inspect(), null, 2))
  if (page) {
    const video = page.video(); await page.context().close()
    const file = path.join(output, 'session.webm'); await video.saveAs(file); await video.delete()
    const raw = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', file, '-vf', 'fps=25,scale=4:4:flags=neighbor,format=rgb24', '-f', 'rawvideo', 'pipe:1'], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 })
    assert.equal(raw.status, 0, raw.stderr.toString())
    const ends = []; let wasGreen = false
    for (let frame = 0; frame < raw.stdout.length; frame += 48) {
      let greenPixels = 0
      for (let pixel = frame; pixel < frame + 48; pixel += 3) if (raw.stdout[pixel] < 30 && raw.stdout[pixel + 1] > 220 && raw.stdout[pixel + 2] < 30) greenPixels++
      const green = greenPixels >= 15
      if (wasGreen && !green) ends.push(frame / 48 / 25)
      wasGreen = green
    }
    for (const [index, item] of shots.entries()) {
      item.sourceVideo = file; item.cleanStartSeconds = ends[index]; item.usableDuration = item.recordedDuration; item.recommendedTrimOffset = 0
      if (ends[index] === undefined) { errors.push(`Missing recording marker for ${item.id}`); continue }
      // Preserve a continuous real second-turn action, rather than spending the
      // battle insert on opening dialogue or the first setup move.
      if (item.id === 'battle') {
        const secondTurn = actions.find(action => action.floor === 1 && action.turn === 2 && action.wallTime)
        if (secondTurn) {
          item.markerStartSeconds = item.cleanStartSeconds
          item.cleanStartSeconds += (secondTurn.wallTime - item.wallStart) / 1000 - .25
          item.usableDuration = item.recordedDuration = 15
          item.editorialSelection = 'Continuous second-turn command, Dynamax, actual attack and HP loss.'
        }
      }
      item.video = path.join(output, `${item.id}.mp4`)
      const cut = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(item.cleanStartSeconds), '-i', file, '-t', String(item.recordedDuration), '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', item.video], { windowsHide: true, maxBuffer: 1024 * 1024 })
      assert.equal(cut.status, 0, cut.stderr.toString())
      if (item.id === 'battle') {
        const still = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', item.video, '-frames:v', '1', item.image], { windowsHide: true, maxBuffer: 1024 * 1024 })
        assert.equal(still.status, 0, still.stderr.toString())
      }
    }
  }
  const changedSourceFiles = []
  for (const item of sourceGameFiles) {
    const content = await fs.readFile(path.join(root, item.path))
    if (createHash('sha256').update(content).digest('hex') !== item.sha256) changedSourceFiles.push(item.path)
  }
  if (changedSourceFiles.length) {
    errors.push(`Source files changed during capture: ${changedSourceFiles.join(', ')}`)
    process.exitCode = 1
  }
  await fs.writeFile(path.join(output, 'manifest.json'), JSON.stringify({
    shots, errors, blocked: [...blocked], apiAudit, actions, battles,
    sourceGameCommit, sourceWorkingTreeChanged, sourceGameFiles, sourceGameFilesUnchangedDuringCapture: changedSourceFiles.length === 0,
    sourceGameCommitMeaning: 'Git base at capture start; sourceGameFiles contains the actual captured working-tree SHA-256 values, including the transparent trainer and current UI changes.',
    imageVerification: { allVisibleImagesLoaded: shots.every(item => item.visibleImages.every(image => image.loaded)), countsRecorded: true },
    provenance: 'Actual working-tree GameApp, Factory UI and battle engine, identified by sourceGameFiles SHA-256. Read-only state instrumentation; authentic rental generation seeded factory-promo-10. Every command is clicked in the game UI. Two actual wins, one real exchange, one skip and a voluntary floor-three retirement produce the sole local TOP 10 record via the real API handler and isolated in-memory store. No production data or cloud authentication.',
  }, null, 2))
  await browser?.close(); await frontend?.close(); await store.close()
}
