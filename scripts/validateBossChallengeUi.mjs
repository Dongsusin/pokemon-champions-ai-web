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
const teams=[{id:'team-1',name:'팀 1',pokemonIds:party.slice(0,6).map(p=>p.captureId)},{id:'team-2',name:'팀 2',pokemonIds:[]}];
function App(){const[active,setActive]=useState(false);const[teamId,setTeamId]=useState('team-2');return <div className={'app-shell'+(active?' battle-view':' raid-view')}><RaidScreen boxPokemon={party} teams={teams} activeTeamId={teamId} onSelectTeam={setTeamId} onOpenBox={()=>{}} onBack={()=>{}} onBattleActiveChange={setActive} soundEnabled={false} gameSettings={{attackAnimation:'skip',hpBarSpeed:'instant'}} /></div>};
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
const roundTwoSpeakers = {
  뮤츠: ['비주기'],
  칠색조: ['엔테이', '스이쿤', '라이코'],
  루기아: ['파이어', '프리저', '썬더'],
}
async function verifyRoundOpening(page, bossName, round, viewport) {
  const expectedPortraits = round === 2 ? roundTwoSpeakers[bossName] : [bossName]
  const speaker = expectedPortraits.join(' / ')
  const dialogue = page.locator('.battle-trainer-dialogue-layer')
  await dialogue.waitFor({ state: 'visible' })
  // Freeze the three-second timer while external portraits load and screenshots settle.
  await page.clock.runFor(450)
  assert.equal(await page.locator('#battle-trainer-dialogue-speaker').innerText(), speaker)
  assert((await page.locator('#battle-trainer-dialogue-message').innerText()).trim().length > 0)
  assert.equal(await page.locator('.battle-intro-overlay, .battle-result-overlay').count(), 0)
  assert.equal(await page.getByRole('button', { name: /^(다음 라운드|배틀 개시)$/ }).count(), 0)
  assert.equal(await page.locator('.battle-command-buttons button:disabled').count(), 4, `${speaker}: commands lock during the opening scene`)
  assert.equal(await page.evaluate(() => window.__bossBattle().turn), 1)
  const portraits = page.locator('.battle-trainer-dialogue-sprite img')
  assert.equal(await portraits.count(), expectedPortraits.length)
  const expectedSpeciesIds = round === 2 ? { 칠색조: [244, 245, 243], 루기아: [146, 144, 145] }[bossName] : [{ 뮤츠: 150, 칠색조: 250, 루기아: 249 }[bossName]]
  const portraitNames = expectedSpeciesIds ? await page.evaluate(async ids => {
    const { getSpeciesProfile } = await import('/src/data/trainingData.js')
    return ids.map(id => getSpeciesProfile(id).name)
  }, expectedSpeciesIds) : expectedPortraits
  assert.deepEqual(await portraits.evaluateAll(images => images.map(image => image.closest('[role="img"]').getAttribute('aria-label'))), portraitNames.map(name => `${name} 트레이너`))
  if (speaker === '비주기') assert.match(await portraits.first().getAttribute('src'), /giovanni/)
  else assert(await page.evaluate(() => {
    const members = window.__bossBattle().opponentMeta.portraitMembers
    const images = [...document.querySelectorAll('.battle-trainer-dialogue-sprite img')]
    return images.every((image, index) => members[index].spriteSources.some(source => image.src === new URL(source, location.href).href))
  }), `${speaker}: portraits use the current round's Pokemon sprites`)
  let portraitsLoaded = false
  for (let attempt = 0; attempt < 100 && !portraitsLoaded; attempt++) {
    portraitsLoaded = await portraits.evaluateAll(images => images.length > 0 && images.every(image => image.complete && image.naturalWidth > 0))
    if (!portraitsLoaded) await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert(portraitsLoaded, `${speaker}: all dialogue portraits load`)
  await page.screenshot({ path: fileURLToPath(new URL(`dialogue-${bossName}-${round}-${viewport.width}.png`, output)) })
  const automatic = bossName === '뮤츠' && round === 2 && viewport.width > 1000
  if (automatic) {
    await page.clock.runFor(3000)
    await dialogue.waitFor({ state: 'hidden' })
  } else {
    await page.locator('.battle-trainer-dialogue-box').click()
    await dialogue.waitFor({ state: 'hidden' })
  }
  assert.equal(await page.locator('.battle-command-buttons button:enabled').count(), 4, `${speaker}: commands unlock after the scene`)
  assert.equal(await page.evaluate(() => window.__bossRun().round), round, 'closing a dialogue must not advance another round')
  // A later turn updates this same battle instance; it must not replay the opening.
  await page.evaluate(() => window.__setBossBattleFixture({ ...window.__bossBattle(), turn: 2 }))
  await page.clock.runFor(1)
  assert.equal(await page.evaluate(() => window.__bossBattle().turn), 2)
  assert.equal(await dialogue.count(), 0, `${speaker}: later turns do not replay the opening`)
  assert.equal(await page.locator('.battle-command-buttons button:enabled').count(), 4)
  if (!automatic && bossName === '칠색조' && round === 2 && viewport.width > 1000) {
    await page.clock.runFor(3100)
    assert.equal(await dialogue.count(), 0, 'the manually dismissed scene stays closed after its original timer')
    assert.equal(await page.evaluate(() => window.__bossRun().round), round)
    assert.equal(await page.locator('.battle-command-buttons button:enabled').count(), 4)
  }
  await page.clock.resume()
}
try {
  const html = await server.transformIndexHtml('/boss-ui.html', '<html><head><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body><div id="root"></div><script type="module" src="/boss-ui-entry.jsx"></script></body></html>')
  for (const viewport of [{ width: 1440, height: 900 }, { width: 844, height: 390 }]) {
    const page = await browser.newPage({ viewport, hasTouch: viewport.width < 1000, isMobile: viewport.width < 1000 })
    page.on('pageerror', error => errors.push(error.message))
    await page.clock.install()
    await page.route('**/boss-ui.html', route => route.fulfill({ contentType: 'text/html', body: html }))
    await page.goto('http://127.0.0.1:5297/boss-ui.html')
    await page.getByRole('heading', { name: '보스전', exact: true }).waitFor()
    assert.equal(await page.getByText('방 만들기', { exact: true }).count(), 0)
    const start = page.locator('.boss-start-footer button')
    assert(await start.isDisabled())
    await page.locator('.boss-team-switcher button').first().click()
    assert.equal(await page.locator('.boss-party-roster > .ranked-pokemon-card').count(), 6)
    assert.equal(await page.locator('.boss-party-roster button').count(), 6)
    assert.equal(await page.locator('.boss-party-loadout').count(), 6)
    const firstCard = page.locator('.boss-party-roster button').first()
    if (viewport.width < 1000) await firstCard.tap()
    else await firstCard.hover()
    const tooltip = page.getByRole('tooltip')
    await tooltip.waitFor({ state: 'visible' })
    for (const label of ['지닌 도구', '테라타입', '다이맥스', '특성', '성격', '배틀 기술']) assert((await tooltip.innerText()).includes(label))
    const tipBounds = await tooltip.boundingBox()
    assert(tipBounds.x >= 0 && tipBounds.y >= 0 && tipBounds.x + tipBounds.width <= viewport.width && tipBounds.y + tipBounds.height <= viewport.height)
    await page.keyboard.press('Escape')
    await tooltip.waitFor({ state: 'hidden' })
    assert(!(await start.isDisabled()))
    assert.equal(await page.locator('.boss-challenge-rules').count(), 0)
    const teamBounds = await page.locator('.boss-challenge-party').boundingBox()
    const bossBounds = await page.locator('.boss-selection-panel').boundingBox()
    const startBounds = await start.boundingBox()
    assert(teamBounds.x + teamBounds.width <= bossBounds.x, 'team and boss panels must not overlap')
    assert(startBounds.y + startBounds.height <= viewport.height, 'challenge button must be visible without scrolling')
    await page.screenshot({ path: fileURLToPath(new URL(`selection-${viewport.width}.png`, output)), fullPage: true })
    for (const name of ['뮤츠', '칠색조', '루기아']) {
      await page.getByRole('button', { name: new RegExp(name) }).filter({ has: page.locator('strong') }).first().click()
      await start.click()
      await page.waitForFunction(() => window.__bossRun()?.phase === 'battle')
      const portrait = page.locator('.battle-intro-trainer.opponent .battle-intro-trainer-sprite')
      await portrait.waitFor({ state: 'visible' })
      await page.waitForFunction(() => {
        const images = [...document.querySelectorAll('.battle-intro-trainer.opponent .battle-intro-trainer-sprite img')]
        return images.length > 0 && images.every(img => img.complete && img.naturalWidth > 0)
      })
      assert.equal(await portrait.locator('img').count(), name === '뮤츠' ? 1 : 2)
      await page.screenshot({ path: fileURLToPath(new URL(`trainers-${name}-${viewport.width}.png`, output)) })
      assert.equal(await page.evaluate(() => window.__bossBattle().player.team.length), 6)
      assert.equal(await page.evaluate(() => window.__bossBattle().player.activeIndexes.length), 2)
      // Inject terminal battle state to verify automatic resolution, not combat outcomes.
      await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now()) + 100))
      await page.evaluate(() => window.__setBossBattleFixture({ ...window.__bossBattle(), winner: 'player' }))
      assert.equal(await page.getByRole('button', { name: '다음 라운드' }).count(), 0)
      await page.locator('.battle-trainer-dialogue-layer').waitFor({ state: 'visible' })
      assert.equal(await page.evaluate(() => window.__bossRun().round), 2)
      assert.equal(await page.evaluate(() => window.__bossBattle().opponent.team.length), name === '뮤츠' ? 6 : 3)
      await verifyRoundOpening(page, name, 2, viewport)
      await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now()) + 100))
      await page.evaluate(() => window.__setBossBattleFixture({ ...window.__bossBattle(), winner: 'player' }))
      assert.equal(await page.getByRole('button', { name: '다음 라운드' }).count(), 0)
      await page.locator('.battle-trainer-dialogue-layer').waitFor({ state: 'visible' })
      assert.equal(await page.evaluate(() => window.__bossBattle().raid.phase), 3)
      await verifyRoundOpening(page, name, 3, viewport)
      if (name === '칠색조') {
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
        await page.locator('.battle-target-card').filter({ hasText: summonName }).click({ timeout: 60000 })
        await page.waitForFunction(() => window.__bossBattle().turn > 2, null, { timeout: 60000 })
        assert.equal(await page.locator('.battle-trainer-dialogue-layer').count(), 0, 'an actual resolved battle turn must not replay the opening')
      }
      await page.evaluate(() => window.__setBossBattleFixture({ ...window.__bossBattle(), winner: 'player' }))
      await page.getByRole('heading', { name: `${name} 격파 성공!` }).waitFor()
      await page.getByRole('button', { name: '다시 준비하기' }).click()
    }
    await start.click()
    await page.waitForFunction(() => window.__bossRun()?.phase === 'battle')
    await page.evaluate(() => window.__completeBossRound({ winner: 'opponent' }))
    await page.getByRole('heading', { name: '도전 종료' }).waitFor()
    assert.equal(await page.getByRole('button', { name: '다음 라운드' }).count(), 0)
    console.log(`PASS ${viewport.width}x${viewport.height}: selection, all three automatic round journeys with opponent dialogue, locked/unlocked commands, Ho-Oh layout, defeat`)
    await page.close()
  }
  assert.deepEqual(errors, [])
} finally { await browser.close(); await server.close() }
