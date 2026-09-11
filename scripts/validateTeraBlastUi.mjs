import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { createBattle, getBattleMovePreview } from '../src/data/battleEngine.js'
import { getLearnableMoves, getMoveById, SPECIES_PROFILES } from '../src/data/trainingData.js'
import { resolveChromiumExecutable } from '../promo/scripts/browserRuntime.mjs'

const require = createRequire(new URL('../promo/package.json', import.meta.url))
const { chromium } = require('playwright')
const root = fileURLToPath(new URL('../', import.meta.url))
const output = path.join(root, 'scripts/.cache/tera-blast-ui')
await fs.mkdir(output, { recursive: true })
const profileBySlug = new Map(Object.values(SPECIES_PROFILES).map(profile => [profile.slug, profile]))
function pokemon(slug, moveId, teraType) {
  const profile = profileBySlug.get(slug)
  assert(profile, `Missing ${slug}`)
  assert(getLearnableMoves(profile.id).some(move => move.id === moveId), `${slug} must actually learn ${moveId}`)
  return { captureId: `tera-ui-${slug}`, speciesId: profile.id, moves: [getMoveById(moveId).name], teraType }
}
function battle(playerPokemon, opponents, double = false) {
  return createBattle({
    playerPokemon,
    opponent: { name: '테라버스트 검증', tier: 'S' },
    opponentTeam: { pokemon: opponents, battleGimmicks: [], strategy: {} },
    rules: {
      weather: { id: 'clear', label: '맑음' }, terrain: { id: 'neutral', label: '일반 필드' },
      format: { id: double ? 'double' : 'single', label: double ? '더블배틀' : '싱글배틀', activeSlots: double ? 2 : 1, actionSlots: double ? 2 : 1 },
      teamRule: { id: 'full', label: '풀 배틀', battleSize: 6 }, disabledGimmickId: null,
    },
  })
}
const fire = battle([pokemon('gyarados', 'terablast', '불꽃')], [pokemon('bulbasaur', 'protect', '풀')])
const stellar = battle(
  [pokemon('gyarados', 'terablast', '스텔라'), pokemon('snorlax', 'protect', '노말')],
  [pokemon('bulbasaur', 'protect', '풀'), pokemon('squirtle', 'protect', '물')], true,
)
stellar.opponent.team[0].teraActive = true
stellar.opponent.team[0].types = ['풀']
// Preview must project Terapagos's species before resolving its form-dependent
// move, and must leave the live field, HP, stages and mechanic budget intact.
const terapagos = battle([pokemon('terapagos', 'terastarstorm', '노말')], [pokemon('snorlax', 'protect', '노말')])
const terapagosBefore = JSON.stringify(terapagos)
const storm = getBattleMovePreview(terapagos, 'player', 0, 0, 0, 'tera')
assert.equal(storm.type, '스텔라')
assert.equal(storm.target, 'allAdjacentFoes')
assert.equal(JSON.stringify(terapagos), terapagosBefore)

// These test exports are attached only to the intercepted local HTTP response.
// The browser renders the game's actual move and target selection components.
const entry = `
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {MoveMenu, MoveTargetMenu} from '/src/BattleScreen.jsx';
import '/src/styles.css'; import '/src/screenRedesign.css'; import '/src/battleGen5.css';
import '/src/mobileLandscape.css';
const fixtures=${JSON.stringify({ fire, stellar })};
function Harness(){
 const [fixture,setFixture]=useState('fire'); const [pendingGimmick,setPending]=useState(null);
 const [targets,setTargets]=useState(false); const state=fixtures[fixture];
 window.__teraUi={state,load:(id)=>{setFixture(id);setPending(null);setTargets(false);}};
 return React.createElement('main',{className:'app-shell battle-view'},
  React.createElement('div',{className:'battle-screen',style:{minHeight:'100vh',padding:'20px'}},
   React.createElement('div',{className:'battle-command-panel',style:{width:'100%',maxWidth:'1100px',margin:'auto'}},
    targets ? React.createElement(MoveTargetMenu,{battle:state,moveIndex:0,pendingGimmick,onSelect:()=>{},onBack:()=>setTargets(false)})
    : React.createElement(MoveMenu,{battle:state,pendingGimmick,onGimmick:setPending,onMove:()=>setTargets(true),onBack:()=>{},onOpenParty:()=>{}}))));
}
createRoot(document.getElementById('root')).render(React.createElement(Harness));
`
const server = await createServer({ root,
  plugins: [{ name: 'tera-blast-ui-entry', resolveId: id => id === '/tera-ui-entry.js' ? id : undefined,
    load: id => id === '/tera-ui-entry.js' ? entry : undefined }],
  server: { host: '127.0.0.1', port: 5205, strictPort: true, hmr: false }, logLevel: 'error',
})
await server.listen()
let browser
try {
  browser = await chromium.launch({ executablePath: await resolveChromiumExecutable(chromium), headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const html = await server.transformIndexHtml('/tera-ui.html', '<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body><div id="root"></div><script type="module" src="/tera-ui-entry.js"></script></body></html>')
  await context.route('**/tera-ui.html', route => route.fulfill({ contentType: 'text/html', body: html }))
  await context.route('**/src/BattleScreen.jsx', async route => {
    const response = await route.fetch()
    await route.fulfill({ response, body: `${await response.text()}\nexport { MoveMenu, MoveTargetMenu };\n` })
  })
  await page.goto('http://127.0.0.1:5205/tera-ui.html')
  const button = page.locator('.battle-move-button').first()
  await button.waitFor()
  const initialState = await page.evaluate(() => JSON.stringify(window.__teraUi.state))
  assert.equal(await button.locator('.battle-move-type').innerText(), '노말')
  assert.match(await button.locator('.battle-move-name').innerText(), /특수/)
  await page.locator('.mechanic-tera').click()
  assert.equal(await button.locator('.battle-move-type').innerText(), '불꽃')
  assert.match(await button.locator('.battle-move-name').innerText(), /물리/)
  assert.equal(await button.locator('.battle-move-power strong').innerText(), '80')
  assert.equal(await page.evaluate(() => JSON.stringify(window.__teraUi.state)), initialState, 'Preview must not alter live battle state')
  await button.hover()
  assert.match(await page.locator('.battle-move-tooltip.is-visible .battle-tooltip-eyebrow').innerText(), /불꽃타입 · 물리/)
  await page.screenshot({ path: path.join(output, 'fire-preview-desktop.png') })
  await button.click()
  assert.equal(await page.locator('.battle-target-move-summary span').innerText(), '불꽃')
  assert.match(await page.locator('.battle-target-effectiveness strong').first().innerText(), /2/)
  await page.getByRole('button', { name: '기술 선택', exact: true }).click()
  await page.locator('.mechanic-tera').click()
  assert.equal(await button.locator('.battle-move-type').innerText(), '노말')
  assert.match(await button.locator('.battle-move-name').innerText(), /특수/)
  await page.evaluate(() => window.__teraUi.load('stellar'))
  await page.locator('.mechanic-tera').click()
  assert.equal(await button.locator('.battle-move-type').innerText(), '스텔라')
  assert.equal(await button.locator('.battle-move-power strong').innerText(), '100')
  await button.click()
  const foeCards = page.locator('.battle-target-card[aria-label^="상대"]')
  assert.equal(await foeCards.count(), 2)
  assert.match(await page.getByRole('button', { name: '상대 이상해씨을 기술 대상으로 선택', exact: true }).locator('.battle-target-effectiveness strong').innerText(), /2/)
  assert.match(await page.getByRole('button', { name: '상대 꼬부기을 기술 대상으로 선택', exact: true }).locator('.battle-target-effectiveness strong').innerText(), /1/)
  await page.screenshot({ path: path.join(output, 'stellar-targets-desktop.png') })
  await page.setViewportSize({ width: 844, height: 390 })
  await page.getByRole('button', { name: '기술 선택', exact: true }).click()
  assert.equal(await button.locator('.battle-move-type').innerText(), '스텔라')
  await button.focus()
  await page.keyboard.press('Enter')
  await foeCards.first().waitFor()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)
  assert.equal(overflow, false, 'Mobile target selection must not overflow horizontally')
  await page.screenshot({ path: path.join(output, 'stellar-targets-mobile.png') })
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ ok: true, checks: ['learnable fixtures', 'Terapagos preview', 'first-turn Tera toggle', 'physical category', 'preview state isolation', 'tooltip', 'toggle cancellation', 'Stellar power', 'per-target Tera effectiveness', 'mobile keyboard selection'], screenshots: output }))
  await context.close()
} finally {
  await browser?.close()
  await server.close()
}
