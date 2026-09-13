import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { createBattle, getActivePokemon } from '../src/data/battleEngine.js'
import { getLearnableMoves, getMoveById, SPECIES_PROFILES } from '../src/data/trainingData.js'
import { createRankedBattle, getRankedBattleView, getRankedTimelineView, resolveRankedTurn } from '../server/rankedBattle.js'
import { resolveChromiumExecutable } from '../promo/scripts/browserRuntime.mjs'

// No remote matches or accounts are used. The browser renders the actual move
// menu and tooltip against local engine states and server-generated PvP views.
const require = createRequire(new URL('../promo/package.json', import.meta.url))
const { chromium } = require('playwright')
const root = fileURLToPath(new URL('../', import.meta.url))
const output = path.join(root, 'scripts/.cache/crowned-moves-ui')
await fs.mkdir(output, { recursive: true })
const profiles = new Map(Object.values(SPECIES_PROFILES).map(profile => [profile.slug, profile]))
let serial = 0
function pokemon(slug, moveId = 'protect', extra = {}) {
  const profile = profiles.get(slug)
  assert(profile, `Missing fixture species: ${slug}`)
  assert(getLearnableMoves(profile.id).some(move => move.id === moveId), `${slug} must learn ${moveId}`)
  return {
    captureId: `crowned-ui-${++serial}`, speciesId: profile.id,
    moveIds: [moveId], moves: [getMoveById(moveId).name], ...extra,
  }
}
const rules = {
  weather: { id: 'clear', label: '맑음' }, terrain: { id: 'neutral', label: '일반 필드' },
  format: { id: 'single', label: '싱글배틀', activeSlots: 1, actionSlots: 1 },
  teamRule: { id: 'full', label: '풀 배틀', battleSize: 6 },
  aiDifficulty: { id: 'normal', label: '보통', boostStage: 0 }, disabledGimmickId: null,
}
function localBattle(lead) {
  return createBattle({
    playerPokemon: [lead], opponent: { name: '왕의 모습 기술 검증', tier: 'S' },
    opponentTeam: { pokemon: [pokemon('wailord', 'splash')], battleGimmicks: [], strategy: {} }, rules,
  })
}
const fixtures = {}
const scenarios = []
const speciesCases = [
  { slug: 'zacian', item: 'rusted-sword', moveId: 'behemothblade' },
  { slug: 'zamazenta', item: 'rusted-shield', moveId: 'behemothbash' },
]
const wireChecks = []
for (const { slug, item, moveId } of speciesCases) {
  const catalog = getMoveById(moveId)
  const lead = pokemon(slug, 'ironhead', { heldItemId: item })
  const savedBefore = JSON.stringify(lead)
  const opening = localBattle(lead)
  assert.equal(JSON.stringify(lead), savedBefore, 'Entering a battle must not rewrite the saved team')
  assert.equal(getActivePokemon(opening, 'player').moves[0].id, moveId)
  fixtures[`${slug}-local`] = opening
  scenarios.push({ id: `${slug}-local`, moveId, ppUsed: 0 })

  const base = localBattle(pokemon(slug, 'ironhead'))
  assert.equal(getActivePokemon(base, 'player').moves[0].id, 'ironhead')
  fixtures[`${slug}-base`] = base
  scenarios.push({ id: `${slug}-base`, moveId: 'ironhead', ppUsed: 0, screenshot: false })

  // Select this species on either assigned server side. Both resulting player
  // perspectives must expose the transformed runtime slot and command preview.
  for (const sideId of ['player', 'opponent']) {
    const own = [lead, pokemon('snorlax'), pokemon('blastoise')]
    const foes = [pokemon('wailord', 'splash'), pokemon('machamp'), pokemon('lapras')]
    const ranked = createRankedBattle({
      playerTeam: sideId === 'player' ? own : foes,
      opponentTeam: sideId === 'player' ? foes : own,
      playerName: '로컬 검증 A', opponentName: '로컬 검증 B', random: () => 0.5,
    })
    const wire = getRankedBattleView(ranked, sideId)
    assert.equal(wire.player.team[0].moves[0].id, moveId)
    assert.equal(wire.commandOptions[0].moves[0].preview.id, moveId)
    assert.equal(wire.commandOptions[0].moves[0].preview.description, catalog.description)
    const other = sideId === 'player' ? 'opponent' : 'player'
    // Keep the local target alive so the result is a normal next-turn menu.
    ranked[other].team[0].hp = ranked[other].team[0].maxHp = 5000
    const result = resolveRankedTurn(ranked, {
      [sideId]: { type: 'move', actorSlot: 0, moveIndex: 0, targetSideId: other, targetSlot: 0 },
      [other]: { type: 'move', actorSlot: 0, moveIndex: 0, targetSideId: other, targetSlot: 0 },
    }, () => 0.5)
    const timeline = getRankedTimelineView(result.timeline, sideId)
    const announced = timeline.find(step => step.sideId === 'player' && step.phase === 'announce')
    assert(announced, 'The server must include the transformed attack in its timeline')
    assert.equal(announced.moveId, moveId)
    assert.equal(announced.moveName, catalog.name)
    assert.equal(announced.moveDescription, catalog.description)
    assert.equal(announced.state.player.team[0].moves[0].id, moveId)
    const after = getRankedBattleView(result.state, sideId)
    assert.equal(after.player.team[0].moves[0].currentPp, catalog.pp - 1)
    assert.equal(after.commandOptions[0].moves[0].preview.currentPp, catalog.pp - 1)
    wireChecks.push(`${slug}:${sideId}:opening,preview,timeline,next-turn`)
    if (sideId === 'opponent') {
      fixtures[`${slug}-ranked`] = wire
      fixtures[`${slug}-ranked-used`] = after
      scenarios.push({ id: `${slug}-ranked`, moveId, ppUsed: 0 })
      scenarios.push({ id: `${slug}-ranked-used`, moveId, ppUsed: 1 })
    }
  }
}

const styles = ['styles', 'screenRedesign', 'battleGen5', 'titleCleanup', 'battleGimmicks', 'mobileLandscape']
const entry = `
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {MoveMenu} from '/src/BattleScreen.jsx';
${styles.map(name => `import '/src/${name}.css';`).join('\n')}
const fixtures = ${JSON.stringify(fixtures)};
function Harness() {
 const [fixture,setFixture] = useState(${JSON.stringify(scenarios[0].id)});
 const [selected,setSelected] = useState(null);
 const state = fixtures[fixture];
 window.__crownedUi = {fixture,state,selected,load:id=>{setSelected(null);setFixture(id);}};
 return React.createElement('main',{className:'app-shell battle-view'},
  React.createElement('div',{className:'battle-screen',style:{minHeight:'100vh',position:'relative'}},
   React.createElement('div',{className:'battle-command-panel',style:{position:'absolute',left:'20px',right:'20px',bottom:'20px',width:'calc(100% - 40px)',maxWidth:'1100px',margin:'0 auto'}},
    React.createElement(MoveMenu,{key:fixture,battle:state,pendingGimmick:null,
     onGimmick:()=>{},onMove:setSelected,onBack:()=>{},onOpenParty:()=>{}}))));
}
createRoot(document.getElementById('root')).render(React.createElement(Harness));
`
const port = Number(process.env.CROWNED_UI_PORT ?? 5224)
const server = await createServer({ root,
  plugins: [{ name: 'crowned-moves-ui-entry',
    resolveId: id => id === '/crowned-ui-entry.js' ? id : undefined,
    load: id => id === '/crowned-ui-entry.js' ? entry : undefined }],
  server: { host: '127.0.0.1', port, strictPort: true, hmr: false }, logLevel: 'error',
})
await server.listen()
let browser
const results = []
try {
  browser = await chromium.launch({ executablePath: await resolveChromiumExecutable(chromium), headless: true })
  const context = await browser.newContext()
  const errors = []
  // Keep every browser request local; the fixtures have no authentication or
  // production API route and cannot join a live battle.
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    return url.hostname === '127.0.0.1' ? route.continue() : route.abort()
  })
  const html = await server.transformIndexHtml('/crowned-ui.html', '<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body><div id="root"></div><script type="module" src="/crowned-ui-entry.js"></script></body></html>')
  await context.route('**/crowned-ui.html', route => route.fulfill({ contentType: 'text/html', body: html }))
  await context.route('**/src/BattleScreen.jsx', async route => {
    const response = await route.fetch()
    // Export a private presentation component only in the intercepted test
    // response; no production source or bundle receives a test hook.
    await route.fulfill({ response, body: `${await response.text()}\nexport { MoveMenu };\n` })
  })
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  page.setDefaultTimeout(20_000)
  await page.goto(`http://127.0.0.1:${port}/crowned-ui.html`)
  await page.waitForFunction(() => window.__crownedUi)
  for (const viewport of [
    { id: 'desktop', width: 1440, height: 900 },
    { id: 'mobile', width: 844, height: 390 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    for (const scenario of scenarios) {
      const catalog = getMoveById(scenario.moveId)
      const expectedPp = `${catalog.pp - scenario.ppUsed}/${catalog.pp}`
      await page.evaluate(id => window.__crownedUi.load(id), scenario.id)
      await page.waitForFunction(id => window.__crownedUi.fixture === id, scenario.id)
      const button = page.locator('.battle-move-button').first()
      assert.equal(await button.locator('.battle-move-name strong').innerText(), catalog.name)
      assert.equal(await button.locator('.battle-move-name small').innerText(), catalog.category)
      assert.equal(await button.locator('.battle-move-type').innerText(), catalog.type)
      assert.equal(await button.locator('.battle-move-power strong').innerText(), String(catalog.power))
      assert.equal(await button.locator('.battle-move-pp strong').innerText(), expectedPp)
      assert.equal(await button.isEnabled(), true)
      if (viewport.id === 'desktop') await button.hover()
      else await button.focus()
      const tooltip = page.locator('.battle-move-tooltip.is-visible')
      assert.equal(await tooltip.locator(':scope > strong').innerText(), catalog.name)
      assert.equal(await tooltip.locator('.battle-tooltip-description').first().innerText(), catalog.description)
      assert.equal(await tooltip.locator('.battle-tooltip-meta span').filter({ hasText: 'PP' }).locator('b').innerText(), expectedPp)
      const tooltipInsideViewport = await tooltip.evaluate(element => {
        const rect = element.getBoundingClientRect()
        return rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight
      })
      assert.equal(tooltipInsideViewport, true, `${scenario.id} tooltip must be visible on ${viewport.id}`)
      const clipped = await button.locator('.battle-move-name strong').evaluate(element => element.scrollWidth > element.clientWidth + 1)
      assert.equal(clipped, false, `${scenario.id} move name must remain readable on ${viewport.id}`)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false,
        `${scenario.id} must not overflow horizontally on ${viewport.id}`)
      if (scenario.screenshot !== false) await page.screenshot({ path: path.join(output, `${scenario.id}-${viewport.id}.png`) })
      await button.click()
      assert.equal(await page.evaluate(() => window.__crownedUi.selected), 0, 'The converted move keeps the submitted slot index')
      results.push({ case: scenario.id, viewport: viewport.id, name: catalog.name, pp: expectedPp, description: catalog.description })
    }
  }
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ ok: true, wireChecks, uiChecks: results, screenshots: output }, null, 2))
  await context.close()
} finally {
  await browser?.close()
  await server.close()
}
