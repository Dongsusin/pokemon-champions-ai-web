import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { createDefaultGameSettings, SETTINGS_STORAGE_KEY } from '../src/gameSettings.js'
import { normalizePokemon } from '../src/data/trainingData.js'
import { migratePokemonCollection } from '../src/data/pokemonPool.js'
import { createSavedTeams } from '../src/data/teamData.js'
import { resolveChromiumExecutable } from '../promo/scripts/browserRuntime.mjs'

// Actual GameApp header and navigation, actual online-count external store.
// Isolated sample publication only: no auth, presence, or production writes.
const root = fileURLToPath(new URL('../', import.meta.url))
const output = path.join(root, 'scripts/.cache/online-players-ui')
await fs.mkdir(output, { recursive: true })
const styles = ['styles', 'screenRedesign', 'battleGen5', 'titleCleanup', 'battleGimmicks', 'moveAnimationDirector', 'settings', 'auth', 'mobileLandscape', 'gameTextScale', 'scaledBoxCards', 'scaledBattleCards', 'scaledTrainingEditor']
const owned = migratePokemonCollection([6, 9, 3, 25, 94, 149].map(speciesId => normalizePokemon({ speciesId, captureId: `online-header-${speciesId}`, directDrawCount: 1 })))
const ownedIds = [6, 9, 3, 25, 94, 149].map(speciesId => owned.find(pokemon => pokemon.speciesId === speciesId).captureId)
const teams = createSavedTeams(ownedIds, owned.map(pokemon => pokemon.captureId))
const entry = `import'/src/mobileViewport.js';import React,{StrictMode,useState}from'react';import{createRoot}from'react-dom/client';import{GameApp}from'/src/App.jsx';
import{updateOnlinePlayers,clearOnlinePlayers}from'/src/auth/onlinePlayers.js';
${styles.map(name => `import'/src/${name}.css';`).join('\n')}
const firstUser={uid:'online-count-ui',displayName:'매우긴트레이너닉네임을사용하는헤더공간검증용사용자1234567890',isAnonymous:true,isLocalGuest:false};const owner='online-count-ui-owner';
function Harness(){const[user,setUser]=useState(firstUser);window.__onlinePlayersUi={publish:(count,staleAfterMs=60000)=>updateOnlinePlayers(user.uid,owner,{count,sampledAt:Date.now(),staleAfterMs}),clear:()=>clearOnlinePlayers(user.uid,owner),switchUser:()=>setUser({...firstUser,uid:'online-count-second-ui'})};
return React.createElement(GameApp,{key:user.uid,user,autoLogin:false,onPlayerDataChanged:()=>{},onSignOut:()=>{}})}
createRoot(document.getElementById('root')).render(React.createElement(StrictMode,null,React.createElement(Harness)));`
process.env.VITE_POKEMON_USAGE_ENABLED = 'false'
process.env.VITE_POKEMON_USAGE_DEMO = 'false'
process.env.VITE_RANKED_LOCAL_TEST = 'false'
const port = Number(process.env.ONLINE_PLAYERS_UI_PORT ?? 5246)
const server = await createServer({ root, mode: 'online-count-validation', logLevel: 'error',
  plugins: [{ name: 'online-count-ui-fixture', enforce: 'pre',
    resolveId(source) {
      if (source === '/online-players-entry.js') return source
      if (source.endsWith('/auth/firebaseClient') || source.endsWith('/auth/firebaseClient.js') || source === './firebaseClient' || source === './firebaseClient.js') return '\0online-count-ui-auth'
    },
    load(id) {
      if (id === '/online-players-entry.js') return entry
      if (id === '\0online-count-ui-auth') return `export const firebaseAuth=null;export const firebaseDb=null;export const isFirebaseConfigured=false;export const missingFirebaseEnvironmentVariables=[];`
    },
    transform(source, id) {
      if (!/\/(RankedBattleScreen|BattleRoomsScreen)\.jsx$/.test(id.replaceAll('\\', '/'))) return
      // Expose the existing parent notification only in this isolated fixture.
      // The assertions cover header callback wiring, not a server battle result.
      assert(source.includes('const battleVisible ='))
      return source.replace('const battleVisible =', 'window.__onlineBattleCallback = onBattleActiveChange;\n  const battleVisible =')
    },
  }], server: { host: '127.0.0.1', port, strictPort: true, hmr: false } })
await server.listen()
const require = createRequire(new URL('../promo/package.json', import.meta.url))
const { chromium } = require(process.env.GLOBAL_CHAT_PLAYWRIGHT_MODULE ?? 'playwright')
const localSprite = await fs.readFile(path.join(root, 'scripts/fixtures/test-sprite-96.gif'))
const checks = [], errors = [], requests = [], blockedMedia = [], metrics = []
async function test(name, run) {
  try { await run(); checks.push({ name, passed: true }); console.log(`PASS ${name}`) }
  catch (error) { checks.push({ name, passed: false, error: error.message }); console.error(`FAIL ${name}: ${error.message}`) }
}
async function headerGeometry(page) {
  return page.evaluate(() => {
    const box = selector => {
      const element = document.querySelector(selector)
      if (!element) throw new Error(`Missing ${selector}`)
      const r = element.getBoundingClientRect()
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }
    }
    return { width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth, viewportScale: visualViewport?.scale ?? 1,
      header: box('.topbar'), main: box('.app-shell > main'), fixedMain: Boolean(document.querySelector('.app-shell > main:is(.draw-screen, .pc-screen, .training-screen, .shop-screen, .achievement-screen, .pokemon-usage-screen, .battle-select-screen, .competition-screen, .ranked-screen, .rooms-screen, .battle-factory)')), brand: box('.brand'), badge: box('.online-players-badge'), status: box('.top-status'),
      controls: [...document.querySelectorAll('.top-status > *')].map(element => {
        const r = element.getBoundingClientRect(); return { label: element.getAttribute('aria-label') || element.textContent, left: r.left, right: r.right, top: r.top, bottom: r.bottom }
      }) }
  })
}
function overlaps(a, b) {
  return Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1
}
function assertHeaderFits(geometry) {
  assert(geometry.documentWidth <= geometry.width + 1, JSON.stringify(geometry))
  for (const [name, rect] of [['brand', geometry.brand], ['badge', geometry.badge], ['status', geometry.status], ...geometry.controls.map(control => [control.label, control])]) {
    assert(rect.width !== 0 && rect.right > rect.left && rect.left >= -1 && rect.right <= geometry.width + 1 && rect.top >= -1 && rect.bottom <= geometry.height + 1, `${name}: ${JSON.stringify(rect)}`)
  }
  assert(geometry.badge.left >= geometry.brand.right - 1, `Badge must sit to the logo's right: ${JSON.stringify(geometry)}`)
  assert(!overlaps(geometry.badge, geometry.status), `Badge/status overlap: ${JSON.stringify(geometry)}`)
  assert(!overlaps(geometry.brand, geometry.status), `Logo/status overlap: ${JSON.stringify(geometry)}`)
  for (const rect of [geometry.brand, geometry.badge, geometry.status]) assert(rect.top >= geometry.header.top - 1 && rect.bottom <= geometry.header.bottom + 1, `Header child extends outside its header: ${JSON.stringify(geometry)}`)
  assert(geometry.main.top >= geometry.header.bottom - 1, `Page content overlaps header: ${JSON.stringify(geometry)}`)
  if (geometry.fixedMain) assert(geometry.main.bottom <= geometry.height + 1, `Fixed viewport page extends beyond available height: ${JSON.stringify(geometry)}`)
  geometry.controls.forEach((first, index) => geometry.controls.slice(index + 1).forEach(second => assert(!overlaps(first, second), `Controls overlap: ${first.label} / ${second.label}`)))
}
let browser
try {
  browser = await chromium.launch({ executablePath: await resolveChromiumExecutable(chromium), headless: true })
  const html = await server.transformIndexHtml('/online-players.html', '<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body><div id="root"></div><script type="module" src="/online-players-entry.js"></script></body></html>')
  // The current compact mobile header hides presence; real mobile chat/layout
  // coverage lives in validateGlobalChatUi with the production CSS import list.
  for (const device of [{ id: 'desktop', viewport: { width: 1920, height: 900 } }, { id: 'laptop', viewport: { width: 1366, height: 768 } }]) {
    const context = await browser.newContext({ ...device, reducedMotion: 'reduce' })
    const settings = createDefaultGameSettings()
    settings.audio.enabled = false
    await context.addInitScript(({ key, settings, owned, teams }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(settings))
      localStorage.setItem('champions-draw-tutorial-v1', 'complete')
      localStorage.setItem('champions-dex-v2', JSON.stringify(owned))
      localStorage.setItem('champions-teams-v1', JSON.stringify({ teams, activeTeamId: 'team-1' }))
    }, { key: SETTINGS_STORAGE_KEY, settings, owned, teams })
    await context.route(/^https:\/\//, route => {
      if (route.request().resourceType() === 'image') return route.fulfill({ contentType: 'image/gif', body: localSprite })
      if (/^https:\/\/raw\.githubusercontent\.com\/PokeAPI\/cries\/main\/cries\/pokemon\/(latest|legacy)\/\d+\.ogg$/.test(route.request().url())) {
        blockedMedia.push(route.request().url()); return route.abort()
      }
      requests.push(route.request().url()); return route.abort()
    })
    await context.route('**/api/**', route => { requests.push(route.request().url()); return route.abort() })
    await context.route('**/online-players.html', route => route.fulfill({ contentType: 'text/html', body: html }))
    const page = await context.newPage()
    page.setDefaultTimeout(10_000)
    page.on('pageerror', error => errors.push({ device: device.id, message: error.message }))
    const click = locator => device.hasTouch ? locator.tap() : locator.click()
    await page.goto(`http://127.0.0.1:${port}/online-players.html`)
    await page.getByRole('heading', { name: '플레이 메뉴', exact: true }).waitFor()
    const enterBattleMode = async mode => {
      await click(page.locator('.battle-hub-tab.' + mode))
      await click(page.locator('.battle-hub-enter'))
    }
    const badge = page.locator('.online-players-badge')
    const revisit = async () => {
      await click(page.locator('.mode-shop'))
      await click(page.getByRole('button', { name: '로비로 돌아가기', exact: true }))
    }
    const chooseScale = async scale => {
      await click(page.getByRole('button', { name: '설정', exact: true }))
      await click(page.getByRole('group', { name: '글자 크기', exact: true }).getByRole('button', { name: `${scale}배`, exact: true }))
      await click(page.getByRole('button', { name: '설정 닫기', exact: true }))
    }
    const assertPageHeader = async (screen, scale) => {
      await badge.getByText(/^1,234명$/).waitFor()
      const geometry = await headerGeometry(page)
      metrics.push({ device: device.id, screen, scale, ...geometry })
      assertHeaderFits(geometry)
    }
    await test(`${device.id}: lobby shows an unknown count when no verified entry sample exists`, async () => {
      await badge.waitFor()
      assert.match(await badge.innerText(), /확인 중|--|—/)
      assert.doesNotMatch(await badge.innerText(), /(?:^|\s)0\s*명/)
      assert.equal(await badge.locator('button').count(), 0)
    })
    await test(`${device.id}: next page entry shows 1,234 players beside the logo with usable controls`, async () => {
      await page.evaluate(() => window.__onlinePlayersUi.publish(1234))
      await revisit()
      await badge.getByText(/1,234/).waitFor()
      const geometry = await headerGeometry(page)
      metrics.push({ device: device.id, scale: 1, ...geometry })
      assertHeaderFits(geometry)
      await page.screenshot({ path: path.join(output, `${device.id}-1x.png`) })
    })
    await test(`${device.id}: 2x font size keeps badge, long trainer name and all header controls separated`, async () => {
      await click(page.getByRole('button', { name: '설정', exact: true }))
      await click(page.getByRole('group', { name: '글자 크기', exact: true }).getByRole('button', { name: '2배', exact: true }))
      await click(page.getByRole('button', { name: '설정 닫기', exact: true }))
      const geometry = await headerGeometry(page)
      metrics.push({ device: device.id, scale: 2, ...geometry })
      assertHeaderFits(geometry)
      await page.screenshot({ path: path.join(output, `${device.id}-2x.png`) })
      await click(page.getByRole('button', { name: '설정', exact: true }))
      await click(page.getByRole('group', { name: '글자 크기', exact: true }).getByRole('button', { name: '1배', exact: true }))
      await click(page.getByRole('button', { name: '설정 닫기', exact: true }))
    })
    await test(`${device.id}: battle selection retains the same count outside the main lobby`, async () => {
      await click(page.locator('.mode-card.mode-start'))
      await page.getByRole('heading', { name: '모드 선택', exact: true }).waitFor()
      await assertPageHeader('battle-hub', 1)
      await click(page.getByRole('button', { name: '로비', exact: true }))
      await badge.getByText(/1,234/).waitFor()
    })
    await test(`${device.id}: main pages retain the shared count and fit the expanded header at 2x`, async () => {
      await page.evaluate(() => window.__onlinePlayersUi.publish(1234))
      for (const [mode, ready, back] of [
        ['training', '.training-roster-panel', '로비로 돌아가기'],
        ['collection', '.team-box-screen', '로비 화면으로 돌아가기'],
        ['shop', '.shop-screen', '로비로 돌아가기'],
        ['hatch', '.app-shell.draw-view', '로비로 돌아가기'],
        ['achievements', '.achievement-screen', '돌아가기'],
        ['usage', '.pokemon-usage-screen', '돌아가기'],
      ]) {
        await click(page.locator(`.mode-card.mode-${mode}`))
        await page.locator(ready).waitFor()
        await chooseScale(2)
        await assertPageHeader(mode, 2)
        await chooseScale(1)
        await click(page.getByRole('button', { name: back, exact: true }))
      }
    })
    await test(`${device.id}: online and factory lobbies retain count at 1x and 2x; battle callbacks exclude it`, async () => {
      await page.evaluate(() => window.__onlinePlayersUi.publish(1234))
      await click(page.locator('.mode-card.mode-start'))
      for (const mode of ['ranked', 'rooms', 'factory', 'ai']) {
        await enterBattleMode(mode)
        const back = mode === 'ai' ? page.getByRole('button', { name: '배틀 종류 선택으로 돌아가기', exact: true }) : page.getByRole('button', { name: '배틀 선택', exact: true })
        await back.waitFor()
        await assertPageHeader(mode, 1)
        await chooseScale(2)
        await assertPageHeader(mode, 2)
        if (['ranked', 'rooms'].includes(mode)) {
          await page.evaluate(() => window.__onlineBattleCallback(true))
          await page.locator('.app-shell.battle-view').waitFor()
          assert.equal(await badge.count(), 0)
          assert.equal(await page.locator('.topbar.has-online-players').count(), 0)
          await page.evaluate(() => window.__onlineBattleCallback(false))
          await assertPageHeader(`${mode}-after-battle-callback`, 2)
        }
        await page.screenshot({ path: path.join(output, `${device.id}-${mode}-2x.png`) })
        await chooseScale(1)
        await click(back)
      }
      await click(page.getByRole('button', { name: '로비', exact: true }))
    })
    if (device.id === 'desktop') {
      await test('AI and factory actual battle entry remove the badge and returning to lobby restores it', async () => {
        for (const mode of ['ai', 'factory']) {
          await page.evaluate(() => window.__onlinePlayersUi.publish(1234))
          await click(page.locator('.mode-card.mode-start'))
          await enterBattleMode(mode)
          if (mode === 'ai') {
            await click(page.locator('.ai-battle-format-options button').filter({ hasText: '싱글배틀' }))
            await click(page.locator('.battle-mode-option-card').filter({ hasText: '128강 토너먼트' }))
            await click(page.getByRole('button', { name: '이 모드로 시작', exact: true }))
            await page.locator('.competition-team-selection').waitFor()
            await assertPageHeader('ai-competition-preparation', 1)
            for (const index of [0, 1, 2]) await click(page.locator('.competition-team-selection > div > button').nth(index))
            await click(page.locator('.competition-current-match-panel > footer > button'))
          } else {
            await page.getByLabel('렌탈 후보 6마리').waitFor()
            for (const index of [0, 1, 2]) await click(page.locator('.factory-rental-select').nth(index))
            await click(page.getByRole('button', { name: /렌탈 팀 확정/ }))
            await page.locator('.battle-factory.phase-ready').waitFor()
            await assertPageHeader('factory-preparation', 1)
            await click(page.getByRole('button', { name: /선봉 선택$/ }).first())
            await click(page.getByRole('button', { name: '1층 배틀 시작', exact: true }))
          }
          await page.locator('.app-shell.battle-view').waitFor()
          assert.equal(await badge.count(), 0)
          assert.equal(await page.locator('.topbar.has-online-players').count(), 0)
          await page.screenshot({ path: path.join(output, `${device.id}-${mode}-battle.png`) })
          await page.reload()
          await page.getByRole('heading', { name: '플레이 메뉴', exact: true }).waitFor()
          await page.evaluate(() => window.__onlinePlayersUi.publish(1234))
          await revisit()
          await assertPageHeader(`${mode}-reload-lobby`, 1)
        }
      })
      await test('counts remain page snapshots; next entry with an unavailable sample never fabricates zero', async () => {
        await page.evaluate(() => window.__onlinePlayersUi.clear())
        assert.match(await badge.innerText(), /1,234/)
        await revisit()
        await page.waitForFunction(() => !document.querySelector('.online-players-badge').textContent.includes('1,234'))
        assert.match(await badge.innerText(), /확인 중|--|—/)
        assert.doesNotMatch(await badge.innerText(), /(?:^|\s)0\s*명/)
        await page.evaluate(() => window.__onlinePlayersUi.publish(0))
        await revisit()
        await badge.getByText(/^0명$/).waitFor()
      })
      await test('switching accounts hides the previous account sample until refreshed', async () => {
        await page.evaluate(() => window.__onlinePlayersUi.publish(1234))
        await revisit()
        await badge.getByText(/1,234/).waitFor()
        await page.evaluate(() => window.__onlinePlayersUi.switchUser())
        await page.waitForFunction(() => !document.querySelector('.online-players-badge').textContent.includes('1,234'))
        assert.match(await badge.innerText(), /확인 중|--|—/)
        await page.evaluate(() => window.__onlinePlayersUi.publish(42))
        await revisit()
        await badge.getByText(/^42명$/).waitFor()
      })
    }
    await context.close()
  }
} finally {
  await browser?.close()
  await server.close()
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ checks, errors, requests, blockedMedia, metrics }, null, 2))
}
assert.equal(errors.length, 0, JSON.stringify(errors))
assert.equal(requests.length, 0, `The isolated header must not fetch presence or production data: ${JSON.stringify(requests)}`)
assert(checks.every(check => check.passed), 'Online-player header UI regression failed')
console.log(`${checks.length}/${checks.length} passed; browser errors ${errors.length}; external/API requests ${requests.length}`)
