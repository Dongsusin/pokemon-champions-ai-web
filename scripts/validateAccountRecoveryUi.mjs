import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { resolveChromiumExecutable } from '../promo/scripts/browserRuntime.mjs'

// Exercise the real account boundary and settings UI with controlled network
// outcomes. No production account, Firestore request or test hook is shipped.
const require = createRequire(new URL('../promo/package.json', import.meta.url))
const { chromium } = require(process.env.ACHIEVEMENT_PLAYWRIGHT_MODULE || 'playwright')
const root = fileURLToPath(new URL('../', import.meta.url))
const output = path.join(root, 'scripts/.cache/account-recovery-ui')
await fs.mkdir(output, { recursive: true })
const styles = ['styles', 'screenRedesign', 'battleGen5', 'titleCleanup', 'battleGimmicks', 'moveAnimationDirector', 'settings', 'auth', 'mobileLandscape']
const entry = `import '/src/mobileViewport.js';
import React from 'react';import {createRoot} from 'react-dom/client';
import {AccountGameApp} from '/src/App.jsx';
${styles.map(name => `import '/src/${name}.css';`).join('\n')}
function Harness(){
 const [accountError,setAccountError]=React.useState('');
 return React.createElement(AccountGameApp,{user:{uid:'recovery-ui',displayName:'복구 검증'},accountError,
 onSignOut:async()=>{window.__signOutCalls=(window.__signOutCalls||0)+1;
 if(window.__failSignOut)setAccountError('로그아웃 요청이 실패했습니다. 다시 시도해 주세요.');
 }});
}
createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement(Harness)));
`
const mockHook = `import {useState} from 'react';
export function useAccountGameData(){
 const [state,setState]=useState({ready:false,syncError:'계정 데이터를 불러오지 못했습니다. 저장 기록을 보호하기 위해 게임을 잠시 중단했습니다. 연결을 확인한 뒤 다시 시도해주세요.'});
 return {...state,scheduleSave(){},retry(){window.__retryCalls=(window.__retryCalls||0)+1;setState({ready:true,syncError:''})},
 async flush(){window.__flushCalls=(window.__flushCalls||0)+1;return new Promise(resolve=>{
  window.__resolveSave=success=>{setState({ready:true,syncError:success?'':'게임 데이터를 저장하지 못했습니다.'});resolve(success)}
 })}};
}`
const server = await createServer({ root, plugins: [{ name: 'account-recovery-ui',
  resolveId: id => ['/account-recovery-entry.js','/account-recovery-hook.js'].includes(id) ? id : undefined,
  load: id => id === '/account-recovery-entry.js' ? entry : id === '/account-recovery-hook.js' ? mockHook : undefined,
}], server: { host: '127.0.0.1', port: 5198, strictPort: true, hmr: false }, logLevel: 'error' })
let browser, page
const errors = []
try {
  await server.listen()
  const origin = 'http://127.0.0.1:5198'
  const html = await server.transformIndexHtml('/account-recovery.html', '<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/account-recovery-entry.js"></script></body></html>')
  browser = await chromium.launch({ executablePath: await resolveChromiumExecutable(chromium), headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await context.route('**/account-recovery.html', route => route.fulfill({ contentType: 'text/html', body: html }))
  await context.route('**/src/App.jsx', async route => {
    const response = await route.fetch()
    await route.fulfill({ response, body: await response.text() + '\nexport {AccountGameApp};\n' })
  })
  await context.route('**/src/auth/useAccountGameData.js', route => route.fulfill({ contentType: 'text/javascript', body: "export {useAccountGameData} from '/account-recovery-hook.js';" }))
  await context.addInitScript(() => {
    if (sessionStorage.getItem('recovery-ui-seeded')) return
    localStorage.setItem('champions-vp-v1', '5000')
    localStorage.setItem('champions-dex-v2', JSON.stringify([6,9,3,25,448,445].map(speciesId => ({speciesId,directDrawCount:1}))))
    localStorage.setItem('champions-draw-tutorial-v1', 'complete')
    localStorage.setItem('champions-settings-v1', JSON.stringify({audio:{enabled:false}}))
    sessionStorage.setItem('recovery-ui-seeded','yes')
  })
  page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`${origin}/account-recovery.html`, { waitUntil: 'domcontentloaded' })
  const retry = page.getByRole('button', { name: '다시 불러오기', exact: true })
  await retry.waitFor()
  assert.equal(await page.locator('.app-shell').count(), 0, 'The game must not mount before cloud recovery')
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('champions-dex-v2')).length), 6)
  await page.screenshot({path:path.join(output,'load-failure-desktop.png')})
  await retry.click()
  await page.locator('.app-shell').waitFor()
  assert.equal(await page.evaluate(() => window.__retryCalls), 1)
  await page.getByRole('button', { name: '설정', exact:true }).click()
  await page.getByRole('tab', { name: '계정', exact:true }).click()
  const logout = page.locator('.settings-sign-out-button')
  await logout.click()
  assert(await logout.isDisabled(), 'Logout must stay disabled while the save is pending')
  assert.equal(await page.evaluate(() => window.__signOutCalls || 0), 0)
  assert.equal(await page.evaluate(() => window.__flushCalls), 1)
  await page.evaluate(() => window.__resolveSave(false))
  await page.waitForFunction(() => !document.querySelector('.settings-sign-out-button').disabled)
  assert.equal(await page.evaluate(() => window.__signOutCalls || 0), 0, 'Failed cloud save must block logout')
  assert((await page.locator('.settings-account-error').innerText()).includes('저장하지 못했습니다'))
  await page.screenshot({path:path.join(output,'save-failure-before-logout.png')})
  await logout.click()
  await page.evaluate(() => window.__resolveSave(true))
  await page.waitForFunction(() => window.__signOutCalls === 1)
  assert.equal(await page.evaluate(() => window.__flushCalls), 2)
  await page.setViewportSize({width:844,height:390})
  await page.reload({waitUntil:'domcontentloaded'})
  await retry.waitFor()
  await retry.scrollIntoViewIfNeeded()
  const bounds = await retry.boundingBox()
  assert(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x+bounds.width<=845 && bounds.y+bounds.height<=391)
  await page.screenshot({path:path.join(output,'load-failure-landscape.png')})
  await page.getByRole('button',{name:'로그인 화면으로 돌아가기',exact:true}).click()
  await page.waitForFunction(() => window.__signOutCalls===1)
  assert.equal(await page.evaluate(() => window.__flushCalls || 0),0,'Unloaded accounts may leave without uploading unverified local data')
  await page.evaluate(() => {window.__failSignOut=true})
  await page.getByRole('button',{name:'로그인 화면으로 돌아가기',exact:true}).click()
  await page.getByRole('alert').filter({hasText:'로그아웃 요청이 실패했습니다.'}).waitFor()
  assert.equal(await page.locator('.app-shell').count(),0)
  await page.setViewportSize({width:844,height:240})
  const card = page.locator('.auth-data-error-card')
  assert.equal(await card.evaluate(element => getComputedStyle(element).overflowY),'auto','Recovery must remain scrollable under shared login CSS')
  assert(await card.evaluate(element => element.scrollHeight>element.clientHeight),'Short viewport must exercise overflow')
  const exit = page.getByRole('button',{name:'로그인 화면으로 돌아가기',exact:true})
  await exit.scrollIntoViewIfNeeded()
  const exitBounds = await exit.boundingBox()
  assert(exitBounds && exitBounds.y>=0 && exitBounds.y+exitBounds.height<=241,'Recovery exit must remain reachable in short viewports')
  await page.screenshot({path:path.join(output,'provider-error-short-viewport.png')})
  assert.deepEqual(errors,[])
  console.log('Account recovery UI passed: failed bootstrap blocks game mount, retry, retained local collection, pending-save logout guard, failed-save retry, successful logout, landscape recovery, exit without upload, provider logout failure and short-viewport scrolling.')
} catch(error) {
  await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{})
  console.error('Browser errors:',errors)
  throw error
} finally {
  await browser?.close()
  await server.close()
}
