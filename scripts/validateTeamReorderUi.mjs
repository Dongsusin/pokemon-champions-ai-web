import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { normalizePokemon } from '../src/data/trainingData.js'
import { migratePokemonCollection } from '../src/data/pokemonPool.js'
import { createSavedTeams } from '../src/data/teamData.js'
import { createDefaultGameSettings, SETTINGS_STORAGE_KEY } from '../src/gameSettings.js'
import { resolveChromiumExecutable } from '../promo/scripts/browserRuntime.mjs'

// Drive the real GameApp, including its saved-team state and local persistence.
// The test uses an isolated loopback origin and never signs in to an account.
const root = fileURLToPath(new URL('../', import.meta.url))
const output = path.join(root, 'scripts/.cache/team-reorder-ui')
await fs.mkdir(output, { recursive: true })

const speciesIds = [25, 6, 9, 143, 94, 149]
const collection = migratePokemonCollection(speciesIds.map((speciesId, index) => normalizePokemon({
  speciesId,
  captureId: `reorder-ui-${speciesId}`,
  directDrawCount: 1,
  obtainedAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
})))
const teamOne = speciesIds.map(speciesId => `dex-${speciesId}`)
const teamTwo = [teamOne[5], teamOne[4], teamOne[3]]
const names = new Map(collection.map(pokemon => [pokemon.captureId, pokemon.name]))
assert(teamOne.every(captureId => names.has(captureId)))
const teams = createSavedTeams(teamOne, collection.map(pokemon => pokemon.captureId))
teams[1].pokemonIds = teamTwo
const settings = createDefaultGameSettings()
settings.audio.enabled = false
const storage = {
  [SETTINGS_STORAGE_KEY]: settings,
  'champions-dex-v2': collection,
  'champions-teams-v1': { version: 1, activeTeamId: 'team-1', teams },
}

const styles = [
  'styles', 'screenRedesign', 'battleGen5', 'titleCleanup', 'battleGimmicks',
  'moveAnimationDirector', 'settings', 'auth', 'mobileLandscape', 'gameTextScale',
  'scaledBoxCards', 'scaledBattleCards', 'scaledTrainingEditor', 'mobileTouch',
  'mobileUiV2', 'mobileReferenceLayout', 'teamReorder',
]
const entry = `import '/src/mobileViewport.js';
import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { GameApp } from '/src/App.jsx';
${styles.map(name => `import '/src/${name}.css';`).join('\n')}
createRoot(document.getElementById('root')).render(React.createElement(StrictMode, null,
  React.createElement(GameApp, {
    user: { uid: 'team-reorder-ui', displayName: '순서 검증', isAnonymous: true, isLocalGuest: true },
    autoLogin: false, onPlayerDataChanged: () => {}, onSignOut: () => {},
  })));`
process.env.VITE_POKEMON_USAGE_ENABLED = 'false'
process.env.VITE_POKEMON_USAGE_DEMO = 'false'
process.env.VITE_RANKED_LOCAL_TEST = 'false'
const port = Number(process.env.TEAM_REORDER_UI_PORT ?? 5254)
const server = await createServer({
  root,
  mode: 'team-reorder-validation',
  logLevel: 'error',
  plugins: [{
    name: 'team-reorder-ui-fixture',
    enforce: 'pre',
    resolveId(source) {
      if (source === '/team-reorder-entry.js') return source
      if (source.endsWith('/auth/firebaseClient') || source.endsWith('/auth/firebaseClient.js')
        || source === './firebaseClient' || source === './firebaseClient.js') return '\0team-reorder-ui-auth'
    },
    load(id) {
      if (id === '/team-reorder-entry.js') return entry
      if (id === '\0team-reorder-ui-auth') return 'export const firebaseAuth=null;export const firebaseDb=null;export const isFirebaseConfigured=false;export const missingFirebaseEnvironmentVariables=[];'
    },
  }],
  server: { host: '127.0.0.1', port, strictPort: true, hmr: false },
})
await server.listen()
const { chromium } = createRequire(new URL('../promo/package.json', import.meta.url))('playwright')
const localSprite = await fs.readFile(path.join(root, 'scripts/fixtures/test-sprite-96.gif'))
const html = await server.transformIndexHtml('/team-reorder.html', '<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body><div id="root"></div><script type="module" src="/team-reorder-entry.js"></script></body></html>')
const failures = []
const pageErrors = []
const diagnostics = []

async function readSavedTeams(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('champions-teams-v1')))
}

async function expectSavedOrder(page, expected) {
  await page.waitForFunction(ids => {
    const state = JSON.parse(localStorage.getItem('champions-teams-v1') || 'null')
    return JSON.stringify(state?.teams?.[0]?.pokemonIds) === JSON.stringify(ids)
  }, expected)
  const saved = await readSavedTeams(page)
  assert.equal(saved.activeTeamId, 'team-1')
  assert.deepEqual(saved.teams[0].pokemonIds, expected)
  assert.deepEqual(saved.teams[1].pokemonIds, teamTwo, 'reordering Team 1 must leave Team 2 unchanged')
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('champions-team-v2'))), expected,
    'the legacy active-party key must follow the reordered team')
}

async function partyNames(page, mobile) {
  return mobile
    ? page.locator('.team-box-reorder-dialog .team-box-mobile-party-card .team-box-mobile-party-select strong').allTextContents()
    : page.locator('.pc-party-list > .pc-party-card:not(.empty) > button:not(.pc-party-remove) strong').allTextContents()
}

async function expectParty(page, expected, mobile) {
  assert.deepEqual(await partyNames(page, mobile), expected.map(id => names.get(id)))
  assert.equal(await page.locator('.pc-party-remove').count(), expected.length,
    'a reorder must keep every existing party member')
}

async function dragWithMouse(page, source, target) {
  await source.scrollIntoViewIfNeeded()
  await target.scrollIntoViewIfNeeded()
  const from = await source.boundingBox()
  const to = await target.boundingBox()
  assert(from && to, 'drag handles must be visible')
  const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 }
  const end = { x: to.x + to.width / 2, y: to.y + to.height / 2 }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 12 })
  await page.mouse.up()
}

async function dragWithTouch(page, source, target) {
  await source.scrollIntoViewIfNeeded()
  await target.scrollIntoViewIfNeeded()
  const from = await source.boundingBox()
  const to = await target.boundingBox()
  assert(from && to, 'touch drag handles must be visible')
  const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 }
  const end = { x: to.x + to.width / 2, y: to.y + to.height / 2 }
  const session = await page.context().newCDPSession(page)
  try {
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, ...start }] })
    await page.waitForTimeout(180)
    for (let step = 1; step <= 12; step++) {
      const fraction = step / 12
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{
        id: 1,
        x: start.x + (end.x - start.x) * fraction,
        y: start.y + (end.y - start.y) * fraction,
      }] })
      await page.waitForTimeout(16)
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  } finally {
    await session.detach()
  }
}

let browser
try {
  let executablePath
  try {
    executablePath = await resolveChromiumExecutable(chromium)
  } catch (error) {
    const installedChrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
    if (process.platform !== 'win32' || !await fs.access(installedChrome).then(() => true, () => false)) throw error
    executablePath = installedChrome
  }
  browser = await chromium.launch({ executablePath, headless: true })
  for (const device of [
    { id: 'desktop', viewport: { width: 1440, height: 900 } },
    { id: 'mobile', viewport: { width: 844, height: 390 }, screen: { width: 844, height: 390 }, hasTouch: true, isMobile: true },
  ]) {
    const mobile = device.id === 'mobile'
    const context = await browser.newContext({ ...device, reducedMotion: 'reduce' })
    let page
    try {
      await context.addInitScript(initial => {
        for (const [key, value] of Object.entries(initial)) {
          if (localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify(value))
        }
        if (localStorage.getItem('champions-draw-tutorial-v1') === null) localStorage.setItem('champions-draw-tutorial-v1', 'complete')
      }, storage)
      await context.route(/^https:\/\//, route => route.request().resourceType() === 'image'
        ? route.fulfill({ contentType: 'image/gif', body: localSprite }) : route.abort())
      await context.route('**/api/**', route => route.abort())
      await context.route('**/team-reorder.html', route => route.fulfill({ contentType: 'text/html', body: html }))
      page = await context.newPage()
      page.setDefaultTimeout(12_000)
      page.on('pageerror', error => pageErrors.push({ device: device.id, message: error.message }))
      await page.goto(`http://127.0.0.1:${port}/team-reorder.html`)
      await page.getByRole('heading', { name: '플레이 메뉴', exact: true }).waitFor()
      if (mobile) await page.getByRole('navigation', { name: '주요 화면 바로가기' }).getByRole('button', { name: '박스' }).tap()
      else await page.locator('.mode-card.mode-collection').click()
      await page.getByRole('heading', { name: '박스 · 팀 편성' }).waitFor()
      if (mobile) await page.getByRole('button', { name: '순서 변경', exact: true }).tap()
      await expectParty(page, teamOne, mobile)

      if (mobile) {
        const handles = page.locator('.team-box-reorder-dialog .team-box-mobile-party .pc-party-drag-handle')
        assert.equal(await handles.count(), teamOne.length)
        await page.evaluate(() => {
          window.__reorderPointerEvents = []
          for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
            document.addEventListener(type, event => {
              window.__reorderPointerEvents.push({ type, target: event.target?.className?.baseVal ?? event.target?.className,
                at: document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-party-slot]')?.dataset.partySlot,
                x: event.clientX, y: event.clientY })
            }, true)
          }
        })
        await dragWithTouch(page, handles.nth(0), handles.nth(3))
      } else {
        const handles = page.locator('.pc-party-list .pc-party-drag-handle')
        assert.equal(await handles.count(), teamOne.length)
        await dragWithMouse(page, handles.nth(0), handles.nth(3))
      }

      const reordered = [...teamOne.slice(1, 4), teamOne[0], ...teamOne.slice(4)]
      await page.waitForFunction(([first, mobile]) => {
        const selector = mobile ? '.team-box-reorder-dialog .team-box-mobile-party-card .team-box-mobile-party-select strong' : '.pc-party-list > .pc-party-card:not(.empty) > button:not(.pc-party-remove) strong'
        return document.querySelector(selector)?.textContent === first
      }, [names.get(reordered[0]), mobile])
      await expectParty(page, reordered, mobile)
      await expectSavedOrder(page, reordered)

      const preset = mobile ? '.team-box-mobile-presets button' : '.pc-team-presets button'
      const click = locator => mobile ? locator.tap() : locator.click()
      if (mobile) {
        // Chromium may suppress the click synthesized by an immediate tap after a CDP touch drag.
        await page.waitForTimeout(400)
        await click(page.getByRole('button', { name: '순서 변경 닫기', exact: true }))
        await page.locator('.team-box-reorder-overlay').waitFor({ state: 'detached' })
      }
      await click(page.locator(preset).nth(1))
      if (mobile) await click(page.getByRole('button', { name: '순서 변경', exact: true }))
      await expectParty(page, teamTwo, mobile)
      if (mobile) {
        await click(page.getByRole('button', { name: '순서 변경 닫기', exact: true }))
        await page.locator('.team-box-reorder-overlay').waitFor({ state: 'detached' })
      }
      await click(page.locator(preset).nth(0))
      if (mobile) await click(page.getByRole('button', { name: '순서 변경', exact: true }))
      await expectParty(page, reordered, mobile)
      if (mobile) {
        await click(page.getByRole('button', { name: '순서 변경 닫기', exact: true }))
        await page.locator('.team-box-reorder-overlay').waitFor({ state: 'detached' })
      }

      if (mobile) await page.getByRole('navigation', { name: '주요 화면 바로가기' }).getByRole('button', { name: '메인' }).tap()
      else await page.getByRole('button', { name: '로비 화면으로 돌아가기' }).click()
      await page.getByRole('heading', { name: '플레이 메뉴', exact: true }).waitFor()
      assert.deepEqual(await page.locator('.lobby-team-card:not(.empty) .lobby-team-name-row strong').allTextContents(),
        reordered.map(id => names.get(id)), 'the lobby must show the new lead Pokemon and full order')

      await page.reload()
      await page.getByRole('heading', { name: '플레이 메뉴', exact: true }).waitFor()
      await expectSavedOrder(page, reordered)
      assert.deepEqual(await page.locator('.lobby-team-card:not(.empty) .lobby-team-name-row strong').allTextContents(),
        reordered.map(id => names.get(id)), 'the order must survive a new GameApp mount')
      console.log(`PASS ${device.id}: drag, team isolation, lobby preview and reload persistence`)
    } catch (error) {
      failures.push({ device: device.id, message: error.stack ?? error.message })
      console.error(`FAIL ${device.id}: ${error.stack ?? error.message}`)
      if (page && !page.isClosed()) {
        diagnostics.push({ device: device.id, state: await page.evaluate(() => ({
          names: [...document.querySelectorAll('.team-box-reorder-dialog .team-box-mobile-party-card strong')].map(node => node.textContent),
          pointerEvents: window.__reorderPointerEvents ?? [],
          stored: JSON.parse(localStorage.getItem('champions-teams-v1') || 'null')?.teams?.[0]?.pokemonIds,
        })).catch(error => error.message) })
        await page.screenshot({ path: path.join(output, `${device.id}-failure.png`) }).catch(() => {})
      }
    } finally {
      await context.close()
    }
  }
} finally {
  await browser?.close()
  await server.close()
}

await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ failures, pageErrors, diagnostics }, null, 2))
assert.deepEqual(pageErrors, [], 'the browser must have no uncaught errors')
assert.deepEqual(failures, [], 'all team reorder UI checks must pass')
