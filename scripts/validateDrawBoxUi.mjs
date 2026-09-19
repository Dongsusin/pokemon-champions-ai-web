import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createServer } from 'vite'
const { chromium } = createRequire(new URL('../promo/package.json', import.meta.url))('playwright')
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';
import Box from '/src/BoxScreen.jsx';import Training from '/src/TrainingScreen.jsx';
import {POKEMON_POOL,mergePokemonDraws,migratePokemonCollection} from '/src/data/pokemonPool';
import '/src/styles.css';import '/src/screenRedesign.css';
const collection=mergePokemonDraws([], [133,134,135,792].map(id=>({...POKEMON_POOL.find(p=>p.id===id),isShiny:id===135}))).collection;
const pokemon=migratePokemonCollection(JSON.parse(JSON.stringify(collection)));
const teams=[{id:'one',name:'Team 1',pokemonIds:['dex-133']}];
const training=location.search.includes('training');
createRoot(document.getElementById('root')).render(<div className={'app-shell '+(training?'training-view':'box-view')}>
{training?<Training pokemon={pokemon} teams={teams} activeTeamId="one"/>:<Box pokemon={pokemon} teams={teams} activeTeamId="one" teamIds={['dex-133']}/>}</div>);`
const server = await createServer({
  plugins: [{ name: 'draw-box-test', resolveId: id => id === '/draw-box.jsx' ? id : undefined,
    load: id => id === '/draw-box.jsx' ? entry : undefined }],
  server: { host: '127.0.0.1', port: 5219, strictPort: true }, logLevel: 'error',
})
await server.listen()
let browser
try {
  browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/test.html*', async route => route.fulfill({ contentType: 'text/html',
    body: await server.transformIndexHtml('/test.html', '<html><body><div id="root"></div><script type="module" src="/draw-box.jsx"></script></body></html>') }))
  await page.goto('http://127.0.0.1:5219/test.html')
  await page.locator('.team-box-card').first().waitFor()
  assert.equal(await page.locator('.team-box-card').count(), 4)
  const vaporeon = page.locator('.team-box-card-select').filter({ hasText: '샤미드' })
  await vaporeon.click()
  assert.equal(await page.locator('.team-box-card.selected').count(), 1)
  assert.match(await page.locator('.team-box-selection').innerText(), /샤미드/)
  assert.equal(await page.locator('.team-box-card.in-team').count(), 1)
  await page.goto('http://127.0.0.1:5219/test.html?training')
  await page.locator('.training-roster-card').first().waitFor()
  assert.equal(await page.locator('.training-roster-card').count(), 4)
  assert.equal(await page.locator('.training-roster-card.in-active-team').count(), 1)
  assert.deepEqual(errors, [])
  console.log('PASS: directly drawn family members visible in box and training; independent selection; exact team membership')
} finally {
  await browser?.close()
  await server.close()
}
