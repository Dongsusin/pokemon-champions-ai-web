import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { resolveChromiumExecutable } from '../promo/scripts/browserRuntime.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const output = new URL('./.cache/boss-challenge-ui/', import.meta.url)
await fs.mkdir(output, { recursive: true })
const require = createRequire(new URL('../promo/package.json', import.meta.url))
const { chromium } = require('playwright')
const entry = `import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import RaidScreen from '/src/RaidScreen.jsx';import {createBossOpponent} from '/src/data/bossChallenge.js';
import '/src/mobileViewport.js';
${['styles', 'screenRedesign', 'battleGen5', 'titleCleanup', 'battleGimmicks', 'moveAnimationDirector', 'settings', 'mobileLandscape', 'mobileTouch', 'mobileUiV2'].map(name => `import '/src/${name}.css';`).join('\n')}
const party=[6,9,3,25,94,149,150].map((speciesId,i)=>createBossOpponent({speciesId},'ui-'+i));
function App(){const[active,setActive]=useState(false);return <div className={'app-shell'+(active?' battle-view':' raid-view')}><RaidScreen boxPokemon={party} onBack={()=>{}} onBattleActiveChange={setActive} soundEnabled={false} gameSettings={{attackAnimation:'skip',hpBarSpeed:'instant'}} /></div>};
createRoot(document.getElementById('root')).render(<App/>);`
const server = await createServer({ root, configFile: false, logLevel: 'error',
  plugins: [(await import('@vitejs/plugin-react')).default(), { name: 'boss-ui-fixture', enforce: 'pre',
    resolveId(id) { if (id === '/boss-ui-entry.jsx') return id },
    load(id) { if (id === '/boss-ui-entry.jsx') return entry },
    transform(code, id) {
      if (id.endsWith('/src/RaidScreen.jsx')) return code.replace('  const active = run?.phase', '  window.__bossRun = () => run; window.__completeBossRound = complete;\n  const active = run?.phase')
      if (id.endsWith('/src/BattleScreen.jsx')) return code.replace('  const [introVisible,', '  window.__bossBattle = () => battle; window.__setBossBattleFixture = setBattle;\n  const [introVisible,')
    },
  }], server: { host: '127.0.0.1', port: 5297, strictPort: true } })
await server.listen()
const browser = await chromium.launch({ executablePath: await resolveChromiumExecutable(chromium), headless: true })
const errors = []
try {
  const html = await server.transformIndexHtml('/boss-ui.html', '<html><head><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body><div id="root"></div><script type="module" src="/boss-ui-entry.jsx"></script></body></html>')
  for (const viewport of [{ width: 1440, height: 900 }, { width: 844, height: 390 }]) {
    const page = await browser.newPage({ viewport, hasTouch: viewport.width < 1000, isMobile: viewport.width < 1000 })
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/boss-ui.html', route => route.fulfill({ contentType: 'text/html', body: html }))
    await page.goto('http://127.0.0.1:5297/boss-ui.html')
    await page.getByRole('heading', { name: '전설의 보스에 도전' }).waitFor()
    assert.equal(await page.getByText('방 만들기', { exact: true }).count(), 0)
    const start = page.locator('footer button')
    assert(await start.isDisabled())
    for (let i = 0; i < 6; i++) await page.locator('.boss-challenge-party button').nth(i).click()
    assert(await page.locator('.boss-challenge-party button').nth(6).isDisabled())
    await page.screenshot({ path: fileURLToPath(new URL(`selection-${viewport.width}.png`, output)), fullPage: true })
    for (const name of ['뮤츠', '칠색조', '루기아']) {
      await page.getByRole('button', { name: new RegExp(name) }).filter({ has: page.locator('strong') }).first().click()
      await start.click()
      await page.waitForFunction(() => window.__bossRun()?.phase === 'battle')
      assert.equal(await page.evaluate(() => window.__bossBattle().player.team.length), 6)
      assert.equal(await page.evaluate(() => window.__bossBattle().player.activeIndexes.length), 2)
      // Test-only terminal callback checks the controller, not combat outcomes.
      await page.evaluate(() => window.__completeBossRound({ winner: 'player' }))
      await page.getByRole('button', { name: '다음 라운드' }).click()
      await page.waitForFunction(() => window.__bossRun()?.round === 2 && window.__bossRun()?.phase === 'battle')
      assert.equal(await page.evaluate(() => window.__bossBattle().opponent.team.length), name === '뮤츠' ? 6 : 3)
      await page.evaluate(() => window.__completeBossRound({ winner: 'player' }))
      await page.getByRole('button', { name: '다음 라운드' }).click()
      await page.waitForFunction(() => window.__bossBattle()?.raid?.phase === 3)
      if (name === '칠색조') {
        await page.getByRole('button', { name: '배틀 개시' }).click({ timeout: 60000 })
        const dialogue = page.locator('.battle-trainer-dialogue-box')
        if (await dialogue.count()) await dialogue.click()
        await page.locator('.battle-trainer-dialogue-layer').waitFor({ state: 'hidden' })
        await page.evaluate(async () => {
          const { beginRaidDamageRoot, applyBattleHpLoss, finishRaidDamageRoot } = await import('/src/data/raidPolicy.js')
          const battle = structuredClone(window.__bossBattle())
          for (let i = 0; i < 12 && !battle.raid.firedMechanics.includes(25); i++) {
            beginRaidDamageRoot(battle, 'ui-fixture-'+i)
            applyBattleHpLoss(battle, battle.opponent.team[0], 99999)
            finishRaidDamageRoot(battle)
          }
          window.__setBossBattleFixture(battle)
        })
        await page.locator('.boss-summons .opponent-status-anchor.slot-2').waitFor()
        const boxes = await page.locator('.boss-summons .opponent-status-anchor').evaluateAll(nodes => nodes.map(node => {
          const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width }
        }))
        assert.equal(boxes.length, 3)
        assert(boxes.every(b => b.width > 0 && b.left >= 0 && b.right <= viewport.width && b.top >= 0 && b.bottom <= viewport.height), JSON.stringify(boxes))
        assert(boxes[0].right <= boxes[1].left && boxes[1].right <= boxes[2].left, JSON.stringify(boxes))
        await page.screenshot({ path: fileURLToPath(new URL(`hooh-summons-${viewport.width}.png`, output)), fullPage: true })
        const targetMove = await page.evaluate(() => window.__bossBattle().player.team[0].moves.findIndex(move => move.target === 'normal' && move.power > 0))
        assert(targetMove >= 0)
        await page.getByRole('button', { name: /싸운다/ }).click()
        await page.locator('.battle-move-button').nth(targetMove).click()
        const summonName = await page.evaluate(() => window.__bossBattle().opponent.team[1].name)
        await page.locator('.battle-target-card').filter({ hasText: summonName }).click()
        await page.waitForFunction(() => window.__bossBattle().turn > 1, { timeout: 60000 })
      }
      await page.evaluate(() => window.__completeBossRound({ winner: 'player' }))
      await page.getByRole('heading', { name: `${name} 격파 성공!` }).waitFor()
      await page.getByRole('button', { name: '다시 준비하기' }).click()
    }
    await start.click()
    await page.waitForFunction(() => window.__bossRun()?.phase === 'battle')
    await page.evaluate(() => window.__completeBossRound({ winner: 'opponent' }))
    await page.getByRole('heading', { name: '도전 종료' }).waitFor()
    assert.equal(await page.getByRole('button', { name: '다음 라운드' }).count(), 0)
    console.log(`PASS ${viewport.width}x${viewport.height}: selection, all three round journeys, Ho-Oh layout, defeat`)
    await page.close()
  }
  assert.deepEqual(errors, [])
} finally { await browser.close(); await server.close() }
