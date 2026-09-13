import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { createDefaultGameSettings, SETTINGS_STORAGE_KEY } from '../src/gameSettings.js'
import { resolveChromiumExecutable } from '../promo/scripts/browserRuntime.mjs'

// Actual GameApp header and navigation, actual online-count external store.
// Isolated sample publication only: no auth, presence, or production writes.
const root = fileURLToPath(new URL('../', import.meta.url))
const output = path.join(root, 'scripts/.cache/online-players-ui')
await fs.mkdir(output, { recursive: true })
const styles = ['styles', 'screenRedesign', 'battleGen5', 'titleCleanup', 'battleGimmicks', 'moveAnimationDirector', 'settings', 'auth', 'mobileLandscape', 'gameTextScale']
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
  }], server: { host: '127.0.0.1', port, strictPort: true, hmr: false } })
await server.listen()
const require = createRequire(new URL('../promo/package.json', import.meta.url))
const { chromium } = require('playwright')
const checks = [], errors = [], requests = [], metrics = []
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
      brand: box('.brand'), badge: box('.online-players-badge'), status: box('.top-status'),
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
  geometry.controls.forEach((first, index) => geometry.controls.slice(index + 1).forEach(second => assert(!overlaps(first, second), `Controls overlap: ${first.label} / ${second.label}`)))
}
let browser
try {
  browser = await chromium.launch({ executablePath: await resolveChromiumExecutable(chromium), headless: true })
  const html = await server.transformIndexHtml('/online-players.html', '<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body><div id="root"></div><script type="module" src="/online-players-entry.js"></script></body></html>')
  for (const device of [{ id: 'desktop', viewport: { width: 1920, height: 900 } }, { id: 'laptop', viewport: { width: 1366, height: 768 } }, { id: 'mobile', viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true }]) {
    const context = await browser.newContext({ ...device, reducedMotion: 'reduce' })
    const settings = createDefaultGameSettings()
    settings.audio.enabled = false
    await context.addInitScript(({ key, settings }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(settings))
      localStorage.setItem('champions-draw-tutorial-v1', 'complete')
    }, { key: SETTINGS_STORAGE_KEY, settings })
    await context.route(/^https:\/\//, route => { requests.push(route.request().url()); return route.abort() })
    await context.route('**/api/**', route => { requests.push(route.request().url()); return route.abort() })
    await context.route('**/online-players.html', route => route.fulfill({ contentType: 'text/html', body: html }))
    const page = await context.newPage()
    page.setDefaultTimeout(10_000)
    page.on('pageerror', error => errors.push({ device: device.id, message: error.message }))
    const click = locator => device.hasTouch ? locator.tap() : locator.click()
    await page.goto(`http://127.0.0.1:${port}/online-players.html`)
    await page.getByRole('heading', { name: '플레이 메뉴', exact: true }).waitFor()
    const badge = page.locator('.online-players-badge')
    await test(`${device.id}: lobby shows an unknown count until a verified sample arrives`, async () => {
      await badge.waitFor()
      assert.match(await badge.innerText(), /확인 중|--|—/)
      assert.doesNotMatch(await badge.innerText(), /(?:^|\s)0\s*명/)
      assert.equal(await badge.locator('button').count(), 0)
    })
    await test(`${device.id}: confirmed 1,234 players appear beside the logo with usable header controls`, async () => {
      await page.evaluate(() => window.__onlinePlayersUi.publish(1234))
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
    await test(`${device.id}: leaving the main lobby hides the count and returning restores it`, async () => {
      await click(page.locator('.mode-card.mode-start'))
      await page.getByRole('heading', { name: '어떤 배틀에 도전할까요?', exact: true }).waitFor()
      assert.equal(await badge.count(), 0)
      await click(page.getByRole('button', { name: '로비', exact: true }))
      await badge.getByText(/1,234/).waitFor()
    })
    if (device.id === 'desktop') {
      await test('cleared or unavailable samples never masquerade as zero connected players', async () => {
        await page.evaluate(() => window.__onlinePlayersUi.clear())
        await page.waitForFunction(() => !document.querySelector('.online-players-badge').textContent.includes('1,234'))
        assert.match(await badge.innerText(), /확인 중|--|—/)
        assert.doesNotMatch(await badge.innerText(), /(?:^|\s)0\s*명/)
        await page.evaluate(() => window.__onlinePlayersUi.publish(0))
        await badge.getByText(/^0명$/).waitFor()
      })
      await test('switching accounts hides the previous account sample until refreshed', async () => {
        await page.evaluate(() => window.__onlinePlayersUi.publish(1234))
        await badge.getByText(/1,234/).waitFor()
        await page.evaluate(() => window.__onlinePlayersUi.switchUser())
        await page.waitForFunction(() => !document.querySelector('.online-players-badge').textContent.includes('1,234'))
        assert.match(await badge.innerText(), /확인 중|--|—/)
        await page.evaluate(() => window.__onlinePlayersUi.publish(42))
        await badge.getByText(/^42명$/).waitFor()
      })
    }
    await context.close()
  }
} finally {
  await browser?.close()
  await server.close()
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ checks, errors, requests, metrics }, null, 2))
}
assert.equal(errors.length, 0, JSON.stringify(errors))
assert.equal(requests.length, 0, `The isolated header must not fetch presence or production data: ${JSON.stringify(requests)}`)
assert(checks.every(check => check.passed), 'Online-player header UI regression failed')
console.log(`${checks.length}/${checks.length} passed; browser errors ${errors.length}; external/API requests ${requests.length}`)
