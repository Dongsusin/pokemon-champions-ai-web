import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { POKEMON_SKINS } from '../src/data/rareRewards.js'
import { resolveChromiumExecutable } from '../promo/scripts/browserRuntime.mjs'

const require = createRequire(new URL('../promo/package.json', import.meta.url))
const { chromium } = require(process.env.ACHIEVEMENT_PLAYWRIGHT_MODULE || 'playwright')
const root = fileURLToPath(new URL('../', import.meta.url))
const output = path.join(root, 'scripts/.cache/achievement-ui')
await fs.mkdir(output, { recursive: true })
const styles = ['styles', 'screenRedesign', 'battleGen5', 'titleCleanup', 'battleGimmicks', 'moveAnimationDirector', 'settings', 'auth', 'mobileLandscape']
const entry = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import SpriteImage from '/src/SpriteImage.jsx';
import BattleScreen from '/src/BattleScreen.jsx';
import { POKEMON_SKINS } from '/src/data/rareRewards.js';
import { TRAINERS } from '/src/data/trainerTeams.js';
${styles.map(name => `import '/src/${name}.css';`).join('\n')}
const h=React.createElement;
window.__loadedSkins=[];
function App(){
 const [active,setActive]=React.useState(null);
 window.__showSkinBattle=setActive;
 if(active!==null){
  const chosen=POKEMON_SKINS[active];
  const roster=[chosen,...POKEMON_SKINS.filter(skin=>skin.id!==chosen.id)].map(skin=>({speciesId:skin.baseSpeciesId,skinId:skin.id,captureId:'dex-'+skin.baseSpeciesId}));
  return h('div',{className:'app-shell battle-view'},h(BattleScreen,{key:active,competitionLabel:'특별 외형 배틀 검증',
   playerPokemon:roster,opponent:TRAINERS[0],opponentTeam:{pokemon:roster.slice(0,1),battleGimmicks:[],strategy:{}},
   soundEnabled:false,gameSettings:{attackAnimation:'skip',hpBarSpeed:'instant'}}));
 }
 return h('main',{className:'qa-gallery'},
  h('h1',null,'특별 외형 · 앞모습 / 뒷모습'),
  h('div',{className:'qa-gallery-grid'},POKEMON_SKINS.flatMap(skin=>['Front','Back'].map(facing=>h('article',{key:skin.id+facing},
   h('h2',null,skin.name+' · '+(facing==='Front'?'앞':'뒤')),
   h(SpriteImage,{src:skin['sprite'+facing],alt:skin.name+' '+facing,'data-testid':skin.id+facing,
     onLoad:()=>window.__loadedSkins.push(skin.id+facing),style:{width:192,height:180,objectFit:'contain'}}),
   skin.artCredit&&h('small',null,'스프라이트: '+skin.artCredit))))),
  h('div',{className:'qa-clip-tests'},['Front','Back'].map(facing=>h(SpriteImage,{key:facing,
   src:POKEMON_SKINS[1]['sprite'+facing],alt:'시트 여백 검증','data-testid':'clip'+facing,
   style:{display:'block',width:192,height:240,background:'#1b2848'}}))),
  h(SpriteImage,{src:POKEMON_SKINS[1].spriteFront,fallbackSrc:POKEMON_SKINS[0].spriteFront,
   alt:'대체 이미지 검증','data-testid':'fallback',style:{width:48,height:48}}));
}
createRoot(document.getElementById('root')).render(h(App));
`
const server = await createServer({ root, plugins: [{ name: 'skin-ui-entry',
  resolveId: id => id === '/skin-ui-entry.js' ? id : undefined,
  load: id => id === '/skin-ui-entry.js' ? entry : undefined,
}], server: { host: '127.0.0.1', port: 5191, strictPort: true, hmr: false }, logLevel: 'error' })
await server.listen()
const origin = 'http://127.0.0.1:5191'
let browser
let page
const errors = []
const failures = []
try {
  browser = await chromium.launch({ executablePath: await resolveChromiumExecutable(chromium), headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const html = await server.transformIndexHtml('/skin-ui.html', `<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><style>.qa-gallery{height:100vh;overflow:auto;padding:24px;color:#eefaff;background:#071322}.qa-gallery h1{margin:0 0 20px}.qa-gallery-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}.qa-gallery article{display:grid;justify-items:center;padding:12px;border:1px solid #34536d;border-radius:16px;background:linear-gradient(#15273a,#0b1726)}.qa-gallery h2{font-size:16px}.qa-gallery small{font-size:11px;color:#9aaabd}.qa-clip-tests{display:flex;gap:20px;margin-top:20px}</style><script type="module" src="/skin-ui-entry.js"></script></body></html>`)
  async function install(target) {
    await target.route('**/skin-ui.html', route => route.fulfill({ contentType: 'text/html', body: html }))
    await target.route('**/src/BattleScreen.jsx', async route => {
      const response = await route.fetch()
      const source = await response.text()
      assert(source.includes('const currentLogEntry ='))
      const body = source.replace('const currentLogEntry =', `window.__skinBattleQA={ready:!introVisible,
        skip:()=>{setIntroVisible(false);setTrainerDialogue(null)},
        tera:()=>setBattle({...battle,player:{...battle.player,team:battle.player.team.map((p,i)=>i? p:{...p,teraActive:true})}})
      }; const currentLogEntry =`)
      await route.fulfill({ response, body })
    })
  }
  await install(context)
  page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  page.on('response', response => { if (response.url().includes('/assets/pokemon/skins/') && response.status() >= 400) failures.push(response.url()) })
  await page.goto(`${origin}/skin-ui.html`)
  await page.waitForFunction(() => new Set(window.__loadedSkins).size === 8)
  assert.equal(await page.locator('.qa-gallery-grid svg.sprite-image-viewport').count(), 2, 'Both Lugia views must load through SVG')
  assert.equal(await page.locator('.qa-gallery-grid img').count(), 6, 'The six GIF views must retain native animation elements')
  for (const skin of POKEMON_SKINS.filter(entry => entry.filter)) {
    for (const facing of ['Front', 'Back']) assert.notEqual(await page.getByTestId(skin.id + facing).evaluate(element => getComputedStyle(element).filter), 'none')
  }
  await page.locator('.qa-gallery-grid').screenshot({ path: path.join(output, 'rare-sprite-gallery.png') })
  // A tall viewport exposes letterboxes. No neighboring sheet pixels may leak
  // into those bands, including when the browser composites SVG on the GPU.
  for (const facing of ['Front', 'Back']) {
    const bytes = await page.getByTestId('clip' + facing).screenshot()
    const bleed = await page.evaluate(async encoded => {
      const image = new Image()
      image.src = 'data:image/png;base64,' + encoded
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = image.width; canvas.height = image.height
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0)
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data
      let wrong = 0
      // Element screenshots round fractional CSS edges to device pixels.
      for (let y = 1; y < canvas.height - 1; y++) {
        if (y >= 29 && y < canvas.height - 29) continue
        for (let x = 0; x < canvas.width; x++) {
          const i = (y * canvas.width + x) * 4
          if (pixels[i] !== 27 || pixels[i + 1] !== 40 || pixels[i + 2] !== 72) wrong++
        }
      }
      return wrong
    }, bytes.toString('base64'))
    assert.equal(bleed, 0, `${facing} sheet must not bleed into letterboxes`)
  }
  for (const [index, skin] of POKEMON_SKINS.entries()) {
    await page.evaluate(value => window.__showSkinBattle(value), index)
    await page.waitForFunction(() => Boolean(window.__skinBattleQA))
    await page.evaluate(() => window.__skinBattleQA.skip())
    await page.locator('.battle-intro-overlay').waitFor({ state: 'detached' })
    for (const [side, source] of [['player', skin.spriteBack], ['opponent', skin.spriteFront]]) {
      const locator = page.locator(`.battle-pokemon-stage.${side} .battle-live-sprite`)
      await locator.waitFor()
      assert.equal(await locator.getAttribute('data-sprite-source'), source)
      const box = await locator.boundingBox()
      assert(box.width > 60 && box.height > 60 && box.x >= 0 && box.y >= 0, 'Battle sprite must have a visible stage viewport')
      assert(box.x + box.width <= 1441 && box.y + box.height <= 901, 'Battle sprite must stay inside the viewport')
      if (skin.id === 'shadow-lugia') assert.equal(await locator.getAttribute('preserveAspectRatio'), 'xMidYMax meet')
      else await locator.evaluate(image => image.decode())
    }
    await page.screenshot({ path: path.join(output, `rare-battle-${skin.id}.png`) })
    if (skin.filter) {
      await page.evaluate(() => window.__skinBattleQA.tera())
      await page.locator('.battle-pokemon-stage.player.is-terastal').waitFor()
      const composed = await page.locator('.battle-pokemon-stage.player .battle-live-sprite').evaluate(element => getComputedStyle(element).filter)
      assert(composed.includes(skin.id === 'crystal-ho-oh' ? 'grayscale' : 'hue-rotate'), 'Terastal light must preserve the cosmetic palette')
    }
  }
  const fallbackContext = await browser.newContext()
  await install(fallbackContext)
  await fallbackContext.route('**/assets/pokemon/skins/shadow-lugia-sheet.png', route => route.abort())
  const fallbackPage = await fallbackContext.newPage()
  await fallbackPage.goto(`${origin}/skin-ui.html`)
  await fallbackPage.waitForFunction(() => document.querySelector('img[data-testid="fallback"]')?.naturalWidth > 0)
  assert.equal(await fallbackPage.getByTestId('fallback').getAttribute('data-sprite-source'), POKEMON_SKINS[0].spriteFront)
  await fallbackContext.close()
  assert.deepEqual(errors, [])
  assert.deepEqual(failures, [])
  console.log('Skin sprite browser QA passed: 8 loaded views, SVG letterbox clipping, sheet fallback, 4 real battle front/back scenes, and Terastal palette composition.')
  console.log(`Screenshots: ${output}`)
} catch (error) {
  if (page) await page.screenshot({ path: path.join(output, 'rare-sprite-failure.png') }).catch(() => {})
  throw error
} finally {
  await browser?.close()
  await server.close()
}
