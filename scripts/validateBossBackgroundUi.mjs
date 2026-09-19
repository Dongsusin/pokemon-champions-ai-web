import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { BOSS_CHALLENGES } from '../src/data/bossChallenge.js'
import { BATTLE_TERRAINS, BATTLE_WEATHER_DEFINITIONS } from '../src/data/battleRules.js'
import { resolveChromiumExecutable } from '../promo/scripts/browserRuntime.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const output = new URL('./.cache/boss-background-ui/', import.meta.url)
await fs.mkdir(output, { recursive: true })
const scenes = BOSS_CHALLENGES.flatMap(boss => boss.rounds.map((round, index) => {
  const id = `${boss.id}-round-${index + 1}`
  assert.deepEqual(round.background, { id, src: `/assets/boss-backgrounds/${id}.webp` })
  return round.background
}))
assert.equal(scenes.length, 9)
const assets = await Promise.all(scenes.map(async scene => {
  const bytes = await fs.readFile(new URL(`../public${scene.src}`, import.meta.url))
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF', `${scene.id}: expected WebP asset`)
  assert.equal(bytes.toString('ascii', 8, 12), 'WEBP', `${scene.id}: expected WebP asset`)
  return createHash('sha256').update(bytes).digest('hex')
}))
assert.equal(new Set(assets).size, 9, 'Every boss round must have its own distinct image')

const require = createRequire(new URL('../promo/package.json', import.meta.url))
const { chromium } = require('playwright')
const main = await fs.readFile(new URL('../src/main.jsx', import.meta.url), 'utf8')
const styles = [...main.matchAll(/import ['"]\.\/([^'"]+\.css)['"]/g)].map(match => `import '/src/${match[1]}';`).join('\n')
const entry = `import React,{useState}from'react';import{createRoot}from'react-dom/client';
import RaidScreen from '/src/RaidScreen.jsx';import BattleScreen from '/src/BattleScreen.jsx';
import {createBossOpponent}from'/src/data/bossChallenge.js';import{createBattle}from'/src/data/battleEngine.js';
import '/src/mobileViewport.js';${styles}
const party=[6,9,3,25,94,149].map((speciesId,i)=>createBossOpponent({speciesId},'background-party-'+i));
const teams=[{id:'team-1',name:'팀 1',pokemonIds:party.map(p=>p.captureId)}];
const ordinary=createBattle({playerPokemon:party,opponent:{name:'레드',tier:'C'},opponentTeam:{pokemon:party.slice(0,1),battleGimmicks:[],strategy:{}}});
function App(){const[active,setActive]=useState(false);const[mode,setMode]=useState('boss');window.__showOrdinaryBackground=()=>setMode('ai');window.__showBossBackground=()=>setMode('boss');return <div className={'app-shell'+(active||mode==='ai'?' battle-view':' raid-view')}>
{mode==='boss'?<RaidScreen boxPokemon={party} teams={teams} activeTeamId="team-1" onBack={()=>{}} onBattleActiveChange={setActive} soundEnabled={false} gameSettings={{attackAnimation:'skip',hpBarSpeed:'instant'}}/>:
<BattleScreen initialBattle={ordinary} playerPokemon={party} opponent={ordinary.opponentMeta} opponentTeam={{pokemon:ordinary.opponent.team}} rules={ordinary.rules} skipIntro soundEnabled={false} gameSettings={{attackAnimation:'skip',hpBarSpeed:'instant'}}/>}</div>}
createRoot(document.getElementById('root')).render(<App/>);`
const server = await createServer({ root, configFile: false, logLevel: 'error', plugins: [
  (await import('@vitejs/plugin-react')).default(), { name: 'boss-background-fixture', enforce: 'pre',
    resolveId(id) { if (id === '/boss-background-entry.jsx') return id },
    load(id) { if (id === '/boss-background-entry.jsx') return entry },
    transform(code, id) {
      if (id.endsWith('/src/BattleScreen.jsx')) return code.replace('  const [introVisible,', '  window.__backgroundBattle = () => battle; window.__setBackgroundBattle = setBattle;\n  const [introVisible,')
    },
  },
], server: { host: '127.0.0.1', port: 5299, strictPort: true, hmr: false } })
await server.listen()
const browser = await chromium.launch({ executablePath: await resolveChromiumExecutable(chromium), headless: true })
const errors = []
let page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
page.on('pageerror', error => errors.push(error.message))
async function setEnvironment(terrain, weather) {
  await page.evaluate(({ terrain, weather }) => {
    const state = structuredClone(window.__backgroundBattle())
    state.rules.terrain = terrain
    state.rules.weather = weather
    state.environment.terrainTurns = terrain.id === 'neutral' ? null : 5
    state.environment.weatherTurns = ['clear', 'desolateland', 'primordialsea', 'deltastream'].includes(weather.id) ? null : 5
    window.__setBackgroundBattle(state)
  }, { terrain, weather })
  await page.waitForFunction(({ terrain, weather }) => document.querySelector('.battle-game-screen')?.classList.contains(`terrain-${terrain}`) && document.querySelector('.battle-game-screen')?.classList.contains(`weather-${weather}`), { terrain: terrain.id, weather: weather.id })
  const expectedTerrain = `${terrain.label}${terrain.id === 'neutral' ? '' : ' · 5T'}`
  const expectedWeather = `${weather.label}${['clear', 'desolateland', 'primordialsea', 'deltastream'].includes(weather.id) ? '' : ' · 5T'}`
  assert.equal(await page.locator('.rule-terrain > strong').innerText(), expectedTerrain)
  assert.equal(await page.locator('.rule-weather > strong').innerText(), expectedWeather)
  const field = page.locator(`.battle-field-effects.field-effect-${terrain.id}`)
  assert.equal(await field.count(), 1)
  assert(await field.locator('.battle-field-particles > i').count() > 0)
  assert(await field.evaluate(element => getComputedStyle(element).display !== 'none'))
  const weatherLayers = page.locator(`.battle-weather-layer.weather-effect-${weather.id}`)
  assert.equal(await weatherLayers.count(), 2)
  for (const layer of await weatherLayers.all()) {
    assert(await layer.locator('.battle-weather-particles > i').count() > 0)
    assert(await layer.evaluate(element => getComputedStyle(element).display !== 'none'))
  }
}
async function checkBackground(expected) {
  await page.waitForFunction(expected => getComputedStyle(document.querySelector('.battle-environment-backdrop')).backgroundImage.includes(expected), expected, { timeout: 5000 })
  const background = await page.locator('.battle-environment-backdrop').evaluate(element => getComputedStyle(element).backgroundImage)
  assert(background.includes(expected), `Wrong story background: expected ${expected}, got ${background}`)
}
async function dismissOpening() {
  const intro = page.locator('.battle-intro-overlay')
  if (await intro.count()) await page.getByRole('button', { name: '배틀 개시', exact: true }).click({ timeout: 60000 })
  const dialogue = page.locator('.battle-trainer-dialogue-box')
  if (await dialogue.count()) await dialogue.click()
  await page.locator('.battle-trainer-dialogue-layer').waitFor({ state: 'hidden' })
}
async function finishRound() {
  await page.evaluate(() => window.__setBackgroundBattle({ ...window.__backgroundBattle(), winner: 'player' }))
}
try {
  const html = await server.transformIndexHtml('/boss-background.html', '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/boss-background-entry.jsx"></script></body></html>')
  await page.route('**/boss-background.html', route => route.fulfill({ contentType: 'text/html', body: html }))
  await page.goto('http://127.0.0.1:5299/boss-background.html')
  const loaded = await page.evaluate(async scenes => Promise.all(scenes.map(scene => new Promise(resolve => {
    const image = new Image()
    image.onload = () => resolve({ id: scene.id, width: image.naturalWidth, height: image.naturalHeight })
    image.onerror = () => resolve({ id: scene.id, width: 0, height: 0 })
    image.src = scene.src
  }))), scenes)
  assert(loaded.every(image => image.width > 0 && image.height > 0), JSON.stringify(loaded))
  for (const boss of BOSS_CHALLENGES) {
    await page.locator('.boss-challenge-choices > button').filter({ has: page.getByText(boss.name, { exact: true }) }).click()
    await page.locator('.boss-start-footer button').click()
    for (const [index, round] of boss.rounds.entries()) {
      await page.locator(`.battle-game-screen[data-battle-background="${round.background.id}"]`).waitFor()
      await dismissOpening()
      await checkBackground(round.background.src)
      for (const [terrainIndex, terrain] of BATTLE_TERRAINS.entries()) {
        await setEnvironment(terrain, BATTLE_WEATHER_DEFINITIONS[terrainIndex])
        await checkBackground(round.background.src)
      }
      for (const weather of BATTLE_WEATHER_DEFINITIONS) {
        await setEnvironment(BATTLE_TERRAINS[0], weather)
        await checkBackground(round.background.src)
      }
      await setEnvironment(BATTLE_TERRAINS[0], BATTLE_WEATHER_DEFINITIONS[0])
      await page.screenshot({ path: fileURLToPath(new URL(`${round.background.id}.png`, output)) })
      await finishRound()
      if (index === 2) {
        await page.getByRole('heading', { name: `${boss.name} 격파 성공!` }).waitFor()
        await page.getByRole('button', { name: '다시 준비하기' }).click()
      }
      console.log(`PASS ${round.background.id}: local image, five terrain states, all weather states, rule HUD and field VFX`)
    }
  }
  await page.evaluate(() => window.__showOrdinaryBackground())
  await page.locator('.battle-game-screen').waitFor()
  assert.equal(await page.locator('.battle-game-screen').getAttribute('data-battle-background'), null)
  for (const terrain of BATTLE_TERRAINS) {
    await setEnvironment(terrain, BATTLE_WEATHER_DEFINITIONS[0])
    await checkBackground(`/assets/battle-fields/${terrain.id}-stadium.jpg`)
  }
  console.log('PASS ordinary AI: terrain continues to select the standard stadium background')
  // Device layout is initialized on page load; use a fresh touch context instead
  // of carrying desktop screen metrics and scroll offsets into the mobile proof.
  await page.close()
  page = await browser.newPage({ viewport: { width: 844, height: 390 }, screen: { width: 844, height: 390 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' })
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/boss-background.html', route => route.fulfill({ contentType: 'text/html', body: html }))
  await page.goto('http://127.0.0.1:5299/boss-background.html')
  await page.waitForFunction(() => document.documentElement.dataset.mobileLayout === 'landscape')
  const mobileGeometry = []
  await page.locator('.boss-challenge-choices > button').filter({ has: page.getByText('루기아', { exact: true }) }).click()
  await page.locator('.boss-start-footer button').click()
  for (let round = 1; round <= 3; round++) {
    const id = `lugia-round-${round}`
    await page.locator(`.battle-game-screen[data-battle-background="${id}"]`).waitFor()
    await dismissOpening()
    await setEnvironment(BATTLE_TERRAINS.find(terrain => terrain.id === 'psychic'), BATTLE_WEATHER_DEFINITIONS.find(weather => weather.id === 'rain'))
    await checkBackground(`/assets/boss-backgrounds/${id}.webp`)
    const bounds = await page.locator('.battle-environment-backdrop').boundingBox()
    assert(bounds && bounds.width > 0 && bounds.height > 0)
    await page.evaluate(() => {
      window.scrollTo(0, 0)
      for (const node of document.querySelectorAll('html, body, #root, .app-shell, .battle-game-screen, .battle-arena')) {
        node.scrollTop = 0
        node.scrollLeft = 0
      }
    })
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const geometry = await page.evaluate(() => {
      const bounds = selector => [...document.querySelectorAll(selector)].map(node => {
        const rect = node.getBoundingClientRect()
        return { selector, top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right }
      })
      return { viewport: { width: innerWidth, height: innerHeight }, scroll: { x: scrollX, y: scrollY }, layout: document.documentElement.dataset.mobileLayout,
        rectangles: [...bounds('.battle-game-header'), ...bounds('.battle-arena'), ...bounds('.opponent-status-anchor')] }
    })
    mobileGeometry.push({ round, ...geometry })
    await fs.writeFile(new URL('mobile-geometry.json', output), JSON.stringify(mobileGeometry, null, 2))
    assert.deepEqual(geometry.viewport, { width: 844, height: 390 })
    assert.equal(geometry.scroll.y, 0)
    for (const rect of geometry.rectangles) assert(rect.top >= -1 && rect.bottom <= 391 && rect.left >= -1 && rect.right <= 845, `Mobile frame clips ${rect.selector}: ${JSON.stringify(rect)}`)
    if (round === 3) await page.screenshot({ path: fileURLToPath(new URL('lugia-rain-mobile.png', output)) })
    else await finishRound()
  }
  console.log('PASS mobile landscape: fixed Lugia scenes, Psychic Terrain VFX and rain coexist')
  assert.deepEqual(errors, [])
} finally { await browser.close(); await server.close() }
