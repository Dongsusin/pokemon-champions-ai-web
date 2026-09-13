import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { normalizePokemon } from '../src/data/trainingData.js'
import { createSavedTeams } from '../src/data/teamData.js'
import { getBattleItem } from '../src/data/shopData.js'
import { resolveChromiumExecutable } from '../promo/scripts/browserRuntime.mjs'

// Full GameApp integration on an isolated loopback origin. Firebase is offline,
// all external requests and /api requests are blocked, and the account owns only
// one Pokemon. Observation and terminal-state fixture hooks exist solely in
// Playwright's intercepted HTTP responses; shipped application files are intact.
// The victory fixture checks controller/UI transitions, not battle correctness.
// validateBattleFactory.mjs separately exercises actual 3-v-3 engine outcomes.
const root = fileURLToPath(new URL('../', import.meta.url))
const output = path.join(root, 'scripts/.cache/battle-factory-ui')
await fs.mkdir(output, { recursive: true })
const port = Number(process.env.FACTORY_UI_PORT ?? 5283)
const origin = `http://127.0.0.1:${port}`
const owned = [normalizePokemon({ speciesId: 131, captureId: 'factory-ui-owned-lapras', directDrawCount: 1 })]
const teams = createSavedTeams(owned.map(pokemon => pokemon.captureId), owned.map(pokemon => pokemon.captureId))
const styles = ['styles', 'screenRedesign', 'battleGen5', 'titleCleanup', 'battleGimmicks', 'moveAnimationDirector', 'settings', 'auth', 'mobileLandscape']
const entry = `import React,{StrictMode} from 'react';import{createRoot}from'react-dom/client';import{GameApp}from'/src/App.jsx';import '/src/mobileViewport.js';
${styles.map(name => `import '/src/${name}.css';`).join('\n')}
createRoot(document.getElementById('root')).render(React.createElement(StrictMode,null,React.createElement(GameApp,{
user:{uid:'factory-ui-offline',displayName:'팩토리 검증',isLocalGuest:true},onPlayerDataChanged:()=>{window.__playerDataChanges=(window.__playerDataChanges??0)+1}
})));`
const checks = []
const browserErrors = []
const network = []
const seedStorage = {
  'champions-dex-v2': JSON.stringify(owned),
  'champions-teams-v1': JSON.stringify({ version: 1, activeTeamId: 'team-1', teams }),
  'champions-team-v2': JSON.stringify(owned.map(pokemon => pokemon.captureId)),
  'champions-vp-v1': '7777',
  'champions-battle-items-v1': JSON.stringify({ leftovers: 1 }),
  'champions-draw-tutorial-v1': 'complete',
  'champions-settings-v1': JSON.stringify({ audio: { enabled: false }, game: { attackAnimation: 'skip', hpBarSpeed: 'instant', playerGender: 'male' } }),
}

async function check(name, type, callback) {
  try {
    await callback()
    checks.push({ name, type, passed: true })
    console.log(`PASS [${type}] ${name}`)
  } catch (error) {
    checks.push({ name, type, passed: false, error: error.message })
    console.error(`FAIL [${type}] ${name}: ${error.message}`)
    throw error
  }
}

const server = await createServer({ root, mode: 'factory-ui-validation', logLevel: 'error',
  plugins: [{ name: 'factory-game-app-fixture', enforce: 'pre',
    resolveId(source) {
      if (source === '/factory-ui-entry.js') return source
      if (/\/auth\/firebaseClient(?:\.js)?$/.test(source) || source === './firebaseClient') return '\0factory-offline-auth'
    },
    load(id) {
      if (id === '/factory-ui-entry.js') return entry
      if (id === '\0factory-offline-auth') return 'export const firebaseAuth=null;export const firebaseDb=null;export const isFirebaseConfigured=false;export const missingFirebaseEnvironmentVariables=[];'
    },
  }], server: { host: '127.0.0.1', port, strictPort: true, hmr: false } })
await server.listen()
const require = createRequire(new URL('../promo/package.json', import.meta.url))
const { chromium } = require('playwright')
let browser
try {
  browser = await chromium.launch({ executablePath: await resolveChromiumExecutable(chromium), headless: true })
  const html = await server.transformIndexHtml('/factory-ui.html', '<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body><div id="root"></div><script type="module" src="/factory-ui-entry.js"></script></body></html>')

  for (const device of [
    { id: 'desktop', viewport: { width: 1440, height: 900 } },
    { id: 'mobile', viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true },
  ]) {
    const context = await browser.newContext(device)
    const hooks = { app: 0, battle: 0, factory: 0 }
    const deniedApis = []
    await context.addInitScript(storage => {
      if (!sessionStorage.getItem('factory-ui-initialized')) {
        localStorage.clear()
        for (const [key, value] of Object.entries(storage)) localStorage.setItem(key, value)
        sessionStorage.setItem('factory-ui-initialized', 'true')
      }
      window.__factoryFixtureWins = 0
    }, seedStorage)
    await context.route('**/*', async route => {
      const url = new URL(route.request().url())
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.pathname.startsWith('/api/')) {
        const request = { device: device.id, url: url.href, method: route.request().method() }
        network.push(request)
        if (url.pathname.startsWith('/api/')) deniedApis.push(request)
        await route.abort('blockedbyclient')
        return
      }
      await route.continue()
    })
    await context.route('**/factory-ui.html', route => route.fulfill({ contentType: 'text/html', body: html }))
    await context.route('**/src/App.jsx', async route => {
      const response = await route.fetch()
      const original = await response.text()
      const body = original.replace(/const \[factoryRun, setFactoryRun\] = useState\(null\);?/g,
        '$&\nwindow.__readFactoryRun = () => structuredClone(factoryRun);')
      assert.notEqual(body, original, 'The GameApp test observation hook must be installed')
      hooks.app++
      await route.fulfill({ response, body })
    })
    await context.route('**/src/BattleFactoryScreen.jsx', async route => {
      const response = await route.fetch()
      const original = await response.text()
      const body = original.replace(/createFactoryRun\(\)/g, 'createFactoryRun({seed:"integration-ui"})')
      assert.notEqual(body, original, 'The deterministic rental test seed must be installed')
      hooks.factory++
      await route.fulfill({ response, body })
    })
    await context.route('**/src/BattleScreen.jsx', async route => {
      const response = await route.fetch()
      const original = await response.text()
      const body = original.replace(/const \[introVisible, setIntroVisible\] = useState\(!online\);?/,
        `$&
window.__readFactoryBattle = () => structuredClone(battle);
window.__fixtureFactoryVictory = () => {
  window.__factoryFixtureWins++;
  setBattle(current => ({...current,phase:'complete',winner:'player',opponent:{...current.opponent,team:current.opponent.team.map(pokemon=>({...pokemon,hp:0,fainted:true}))}}));
};`)
      assert.notEqual(body, original, 'The BattleScreen observation and explicit victory-fixture hooks must be installed')
      hooks.battle++
      await route.fulfill({ response, body })
    })

    const page = await context.newPage()
    page.setDefaultTimeout(15_000)
    page.on('pageerror', error => browserErrors.push({ device: device.id, error: error.message }))
    const click = locator => device.hasTouch ? locator.tap() : locator.click()
    const readRun = () => page.evaluate(() => window.__readFactoryRun())
    const readBattle = () => page.evaluate(() => window.__readFactoryBattle())
    const checkTrainerCutout = async image => {
      await image.evaluate(element => element.decode())
      const visual = await image.evaluate(element => {
        const frame = getComputedStyle(element.parentElement)
        const canvas = document.createElement('canvas')
        canvas.width = element.naturalWidth
        canvas.height = element.naturalHeight
        const context = canvas.getContext('2d', { willReadFrequently: true })
        context.drawImage(element, 0, 0)
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
        let transparent = 0
        let opaque = 0
        for (let index = 3; index < pixels.length; index += 4) {
          if (pixels[index] === 0) transparent++
          if (pixels[index] === 255) opaque++
        }
        return {
          background: frame.backgroundColor, border: frame.borderTopWidth,
          transparent: transparent / (canvas.width * canvas.height),
          opaque: opaque / (canvas.width * canvas.height),
        }
      })
      assert.equal(visual.background, 'rgba(0, 0, 0, 0)', 'Trainer must stand directly on the scene without a photo-card background')
      assert.equal(visual.border, '0px', 'Trainer cutout must not retain the old picture-frame border')
      assert(visual.transparent > 0.15 && visual.opaque > 0.1, `Trainer PNG needs both transparent background and an opaque subject: ${JSON.stringify(visual)}`)
    }
    const snapshotProtectedStorage = () => page.evaluate(() => Object.fromEntries(
      Object.keys(localStorage).filter(key => key === 'champions-dex-v2' || key === 'champions-battle-items-v1'
        || key === 'champions-vp-v1' || key === 'champions-achievements-v1' || key.startsWith('champions-usage'))
        .sort().map(key => [key, localStorage.getItem(key)]),
    ))
    const waitCommands = async () => {
      await page.locator('.battle-trainer-dialogue-layer').waitFor({ state: 'hidden', timeout: 12_000 })
      await page.waitForFunction(() => {
        const fight = document.querySelector('.battle-command-buttons .fight')
        return fight && !fight.disabled
      }, undefined, { timeout: 15_000 })
    }
    const begin = async () => {
      let run = await readRun()
      if (!run.leadCaptureId) {
        assert(await page.getByRole('button', { name: `${run.floor}층 배틀 시작`, exact: true }).isDisabled())
        await click(page.getByRole('button', { name: `${run.party[0].name} 선봉 선택`, exact: true }))
        run = await readRun()
        assert.equal(run.leadCaptureId, run.party[0].captureId)
      }
      await click(page.getByRole('button', { name: `${run.floor}층 배틀 시작`, exact: true }))
      await page.locator('.battle-intro-overlay.is-ready').waitFor({ timeout: 30_000 })
      await click(page.getByRole('button', { name: '배틀 개시', exact: true }))
      await waitCommands()
    }
    const winFixture = async () => {
      await page.evaluate(() => window.__fixtureFactoryVictory())
      await page.locator('.battle-result-overlay.result-player').waitFor()
      assert.equal((await readRun()).phase, 'battle', 'Result screen must remain in battle until the real finish button is clicked')
      await click(page.getByRole('button', { name: '배틀 마치기', exact: true }))
      await page.locator('.battle-factory.phase-exchange').waitFor()
    }
    let protectedBefore
    let expectedBattleLead
    try {
      await page.goto(`${origin}/factory-ui.html`)
      await page.getByRole('button', { name: /시작하기/ }).waitFor()

      await check(`${device.id}: one-owned-Pokemon account enters the four-mode hub and receives six rentals`, 'real-ui', async () => {
        assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('champions-dex-v2')).length), 1)
        await click(page.getByRole('button', { name: /시작하기/ }))
        assert.equal(await page.locator('.battle-hub-card').count(), 4)
        await click(page.locator('.battle-hub-card.factory'))
        await page.getByLabel('렌탈 후보 6마리').waitFor()
        assert.equal(await page.locator('.factory-rental-select').count(), 6)
        assert(await page.getByRole('button', { name: /렌탈 팀 확정/ }).isDisabled())
        const run = await readRun()
        assert.equal(run.phase, 'selection')
        assert.equal(run.floor, 1)
        assert.equal(run.offers.length, 6)
        await checkTrainerCutout(page.locator('.factory-trainer-image img'))
        protectedBefore = await snapshotProtectedStorage()
        await page.screenshot({ path: path.join(output, `${device.id}-selection.png`) })
      })

      await check(`${device.id}: ready requires an explicit lead, preserves a third-Pokemon choice across hub re-entry and permits changing it`, 'real-ui', async () => {
        const choices = [2, 1, 0]
        const original = await readRun()
        for (const index of choices) await click(page.locator('.factory-rental-select').nth(index))
        assert.equal(await page.locator('.factory-rental-select:disabled').count(), 3)
        await click(page.getByRole('button', { name: /렌탈 팀 확정/ }))
        await page.locator('.battle-factory.phase-ready').waitFor()
        const ready = await readRun()
        assert.deepEqual(ready.party.map(pokemon => pokemon.captureId), choices.map(index => original.offers[index].captureId))
        assert.equal(ready.opponentTeam.pokemon.length, 3)
        assert.equal(ready.leadCaptureId, null)
        assert(await page.getByRole('button', { name: '1층 배틀 시작', exact: true }).isDisabled())
        await click(page.getByRole('button', { name: `${ready.party[2].name} 선봉 선택`, exact: true }))
        const selectedThird = await readRun()
        assert.equal(selectedThird.leadCaptureId, ready.party[2].captureId)
        assert.deepEqual(selectedThird.party, ready.party)
        assert.equal(await page.getByRole('button', { name: `${ready.party[2].name} 선봉 선택`, exact: true }).getAttribute('aria-pressed'), 'true')
        assert(!(await page.getByRole('button', { name: '1층 배틀 시작', exact: true }).isDisabled()))
        await click(page.locator('.factory-back'))
        await click(page.locator('.battle-hub-card.factory'))
        await page.locator('.battle-factory.phase-ready').waitFor()
        assert.deepEqual(await readRun(), selectedThird)
        await click(page.getByRole('button', { name: `${ready.party[1].name} 선봉 선택`, exact: true }))
        expectedBattleLead = ready.party[1].captureId
        assert.equal((await readRun()).leadCaptureId, expectedBattleLead)
        assert.deepEqual((await readRun()).party, ready.party)
        assert.equal(await page.getByRole('button', { name: `${ready.party[2].name} 선봉 선택`, exact: true }).getAttribute('aria-pressed'), 'false')
        await page.screenshot({ path: path.join(output, `${device.id}-ready.png`) })
      })

      await check(`${device.id}: real 3-v-3 BattleScreen uses the supplied trainer and full battle viewport`, 'real-battle', async () => {
        await click(page.getByRole('button', { name: '1층 배틀 시작', exact: true }))
        await page.locator('.battle-intro-overlay.is-ready').waitFor({ timeout: 30_000 })
        const image = page.locator('.battle-intro-trainer.opponent img[src$="/factory-clown-cutout.png"]')
        assert.equal(await image.count(), 1)
        assert(await image.evaluate(element => element.complete && element.naturalWidth > 0))
        await checkTrainerCutout(image)
        await page.locator('.battle-intro-trainer.opponent').evaluate(element => Promise.all(
          element.getAnimations().filter(animation => animation.effect.getTiming().iterations !== Infinity)
            .map(animation => animation.finished.catch(() => {})),
        ))
        await page.screenshot({ path: path.join(output, `${device.id}-battle-intro.png`) })
        assert(await page.locator('.topbar').isHidden())
        assert.equal((await readBattle()).player.team.length, 3)
        assert.equal((await readBattle()).opponent.team.length, 3)
        const actualBattle = await readBattle()
        assert.equal(actualBattle.player.team[actualBattle.player.activeIndexes[0]].captureId, expectedBattleLead)
        assert.equal((await readRun()).party[0].captureId, expectedBattleLead)
        await click(page.getByRole('button', { name: '배틀 개시', exact: true }))
        await waitCommands()
        const bounds = await page.locator('.battle-game-screen').boundingBox()
        // The game's mobile viewport scales a desktop-sized CSS canvas; compare
        // layout bounds with that CSS viewport, not physical screenshot pixels.
        const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
        assert(bounds.y >= -1 && bounds.y + bounds.height <= viewport.height + 1 && bounds.width <= viewport.width + 1, JSON.stringify({ bounds, viewport }))
        assert.equal(await page.locator('.app-shell.factory-view.battle-view').count(), 1)
        await page.screenshot({ path: path.join(output, `${device.id}-battle.png`) })
      })

      await check(`${device.id}: an actual selected move spends PP and advances a turn without modifying the rental loadout`, 'real-battle', async () => {
        const before = await readBattle()
        const partyBefore = (await readRun()).party
        await click(page.locator('.battle-command-buttons .fight'))
        await click(page.locator('.battle-move-button:not(:disabled)').first())
        await page.waitForFunction(turn => window.__readFactoryBattle().turn > turn, before.turn, { timeout: 20_000 })
        await page.waitForFunction(() => document.querySelector('.battle-command-panel')?.getAttribute('aria-busy') === 'false')
        const after = await readBattle()
        assert(after.player.team.some((pokemon, index) => pokemon.moves.some((move, moveIndex) => move.currentPp < before.player.team[index].moves[moveIndex].currentPp)))
        assert(after.log.length > before.log.length)
        assert.deepEqual((await readRun()).party, partyBefore)
        assert.equal(await page.evaluate(() => window.__factoryFixtureWins), 0)
      })

      await check(`${device.id}: opening settings preserves the mounted battle, turn and HP`, 'real-ui', async () => {
        const before = await readBattle()
        const runBefore = await readRun()
        await page.locator('.battle-game-screen').evaluate(element => { element.dataset.factoryMountMarker = 'preserved' })
        await click(page.getByRole('button', { name: '환경 설정', exact: true }))
        await page.getByRole('dialog', { name: '환경 설정', exact: true }).waitFor()
        assert.equal(await page.locator('.battle-game-screen').getAttribute('data-factory-mount-marker'), 'preserved')
        assert(await page.locator('.topbar').isHidden())
        await click(page.getByRole('button', { name: '설정 닫기', exact: true }))
        assert.deepEqual(await readBattle(), before)
        assert.deepEqual(await readRun(), runBefore)
      })

      await check(`${device.id}: real forfeit ends the run and restart returns to a fresh six-rental selection`, 'real-battle', async () => {
        // A rare critical hit can force a replacement before the forfeit menu.
        if ((await readBattle()).awaitingPlayerSwitch) {
          await click(page.locator('.battle-party-menu-grid > button:not(:disabled)').first())
        }
        await waitCommands()
        const oldId = (await readRun()).id
        await click(page.locator('.battle-command-buttons .surrender'))
        await page.locator('.battle-factory.phase-finished').waitFor()
        const finished = await readRun()
        assert.equal(finished.wins, 0)
        assert.equal(finished.lastResult.forfeited, true)
        assert(await page.locator('.topbar').isVisible())
        await click(page.getByRole('button', { name: 'TOP 10 랭킹', exact: true }))
        await page.locator('.factory-ranking-record').waitFor()
        assert.equal(await page.locator('.factory-ranking-record').count(), 1)
        assert.match(await page.locator('.factory-ranking-source').innerText(), /이 기기 랭킹/)
        await click(page.locator('.factory-ranking-row'))
        const finalCards = page.locator('.factory-ranking-pokemon')
        assert.equal(await finalCards.count(), 3)
        for (let index = 0; index < 3; index++) {
          const pokemon = finished.party[index]
          assert.equal(await finalCards.nth(index).locator('header strong').innerText(), pokemon.name)
          assert.equal(await finalCards.nth(index).locator('.factory-ranking-held-item strong').innerText(), getBattleItem(pokemon.heldItemId)?.name ?? '없음')
          assert.deepEqual(await finalCards.nth(index).locator('.factory-ranking-move-names > span').allTextContents(), pokemon.moves)
        }
        await click(finalCards.first().getByRole('button', { name: /능력치와 기술 정보/ }))
        await page.locator('dialog.factory-details[open]').waitFor()
        assert.match(await page.locator('.factory-details-meta').innerText(), new RegExp(finished.party[0].ability))
        await click(page.getByRole('button', { name: '포켓몬 정보 닫기', exact: true }))
        await page.screenshot({ path: path.join(output, `${device.id}-ranking.png`) })
        await click(page.locator('.factory-rankings .factory-back'))
        assert.deepEqual(await readRun(), finished)
        await click(page.getByRole('button', { name: '새 도전 시작', exact: true }))
        await page.locator('.battle-factory.phase-selection').waitFor()
        const restarted = await readRun()
        assert.notEqual(restarted.id, oldId)
        assert.equal(restarted.floor, 1)
        assert.equal(restarted.party.length, 0)
        assert.equal(restarted.offers.length, 6)
      })

      await check(`${device.id}: victory fixture uses the real result button, offers only the previous opponent and exchanges exactly one Pokemon`, 'victory-fixture', async () => {
        for (const index of [1, 0, 2]) await click(page.locator('.factory-rental-select').nth(index))
        await click(page.getByRole('button', { name: /렌탈 팀 확정/ }))
        await begin()
        const battleRun = await readRun()
        await winFixture()
        const won = await readRun()
        assert.equal(won.wins, 1)
        assert.deepEqual(won.previousOpponent, battleRun.opponentTeam.pokemon)
        assert.deepEqual(won.party, battleRun.party)
        assert.equal(await page.locator('.factory-exchange-groups .factory-rental-select').count(), 6)
        assert(await page.getByRole('button', { name: '교환하고 다음 층', exact: true }).isDisabled())
        const key = pokemon => Number(pokemon.dexSpeciesId ?? pokemon.speciesId)
        const takeIndex = won.previousOpponent.findIndex(incoming => !won.party.slice(1).some(pokemon => key(pokemon) === key(incoming)))
        assert(takeIndex >= 0)
        await click(page.locator('.factory-exchange-groups .factory-rental-select').nth(0))
        await click(page.locator('.factory-exchange-groups .factory-rental-select').nth(3 + takeIndex))
        await click(page.getByRole('button', { name: '교환하고 다음 층', exact: true }))
        await page.locator('.battle-factory.phase-ready').waitFor()
        const next = await readRun()
        assert.equal(next.floor, 2)
        assert.deepEqual(next.party, [won.previousOpponent[takeIndex], ...won.party.slice(1)])
        assert.equal(next.leadCaptureId, null)
        assert(await page.getByRole('button', { name: '2층 배틀 시작', exact: true }).isDisabled())
        assert.equal(next.previousOpponent.length, 0)
        assert.notDeepEqual(next.opponentTeam.pokemon.map(pokemon => pokemon.captureId), won.previousOpponent.map(pokemon => pokemon.captureId))
        await page.screenshot({ path: path.join(output, `${device.id}-floor-2.png`) })
      })

      await check(`${device.id}: second victory fixture can skip exchange, retain all three rentals and enter floor three`, 'victory-fixture', async () => {
        const partyBefore = (await readRun()).party
        await begin()
        const freshBattle = await readBattle()
        assert(freshBattle.player.team.every(pokemon => pokemon.hp === pokemon.maxHp && !pokemon.status && pokemon.moves.every(move => move.currentPp === move.maxPp)))
        await winFixture()
        await click(page.getByRole('button', { name: '교환 없이 다음 층', exact: true }))
        await page.locator('.battle-factory.phase-ready').waitFor()
        const next = await readRun()
        assert.equal(next.floor, 3)
        assert.equal(next.wins, 2)
        assert.deepEqual(next.party, partyBefore)
        assert.equal(next.lastExchange, null)
        assert.equal(next.leadCaptureId, null)
        assert(await page.getByRole('button', { name: '3층 배틀 시작', exact: true }).isDisabled())
        await click(page.getByRole('button', { name: `${next.party[2].name} 선봉 선택`, exact: true }))
        assert.equal((await readRun()).leadCaptureId, next.party[2].captureId)
        assert(!(await page.getByRole('button', { name: '3층 배틀 시작', exact: true }).isDisabled()))
        assert.equal(await page.evaluate(() => window.__factoryFixtureWins), 2)
      })

      await check(`${device.id}: factory leaves owned box, inventory, VP, achievements and usage unchanged without API calls or browser errors`, 'isolation', async () => {
        assert.deepEqual(await snapshotProtectedStorage(), protectedBefore)
        assert.deepEqual(deniedApis, [])
        assert.deepEqual(browserErrors.filter(error => error.device === device.id), [])
        assert(hooks.app > 0 && hooks.battle > 0 && hooks.factory > 0)
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false)
      })

      await check(`${device.id}: completed local ranking survives reload while an unfinished tower does not replace it`, 'ranking-persistence', async () => {
        const records = await page.evaluate(() => JSON.parse(localStorage.getItem('champions-factory-local-rankings-v1')))
        assert.equal(records.length, 1)
        assert.equal(records[0].floor, 1)
        assert.equal(records[0].wins, 0)
        await page.reload()
        await click(page.getByRole('button', { name: /시작하기/ }))
        await click(page.locator('.battle-hub-card.factory'))
        await click(page.getByRole('button', { name: 'TOP 10 랭킹', exact: true }))
        await page.locator('.factory-ranking-record').waitFor()
        assert.equal(await page.locator('.factory-ranking-record').count(), 1)
        assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('champions-factory-local-rankings-v1'))), records)
        assert.equal((await readRun()).phase, 'selection')
      })
    } catch (error) {
      if (!checks.some(result => !result.passed && result.name.startsWith(`${device.id}:`))) {
        checks.push({ name: `${device.id}: harness setup`, type: 'harness', passed: false, error: error.message })
      }
      await page.screenshot({ path: path.join(output, `${device.id}-failure.png`), fullPage: true }).catch(() => {})
    } finally {
      await context.close()
    }
  }
} finally {
  await browser?.close()
  await server.close()
}
const report = { checks, browserErrors, blockedRequests: network, note: 'Real battle cases use the unmodified engine; explicitly labelled victory-fixture cases inject terminal battle state solely in intercepted test HTTP responses.' }
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
const failures = checks.filter(check => !check.passed)
console.log(`\nBattle Factory GameApp UI: ${checks.length - failures.length}/${checks.length} checks passed; ${browserErrors.length} browser errors. Report: ${path.join(output, 'report.json')}`)
if (failures.length || browserErrors.length) process.exitCode = 1
