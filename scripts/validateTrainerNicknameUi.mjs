import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { createAccountService } from '../server/accountService.js'
import { createAccountHttpHandler } from '../server/accountHttp.js'
import { createMemoryRankedStore } from '../server/rankedStore.js'
import { createDefaultGameSettings, SETTINGS_STORAGE_KEY } from '../src/gameSettings.js'
import { normalizePokemon } from '../src/data/trainingData.js'
import { migratePokemonCollection } from '../src/data/pokemonPool.js'
import { createSavedTeams } from '../src/data/teamData.js'
import { resolveChromiumExecutable } from '../promo/scripts/browserRuntime.mjs'

// Production SettingsModal, shared validation and real account service/HTTP.
// All identities and storage live in this isolated process; no Firebase or
// production account is read or changed. One controlled 503 tests recovery.
const root = fileURLToPath(new URL('../', import.meta.url))
const output = path.join(root, 'scripts/.cache/trainer-nickname-ui')
await fs.mkdir(output, { recursive: true })
const require = createRequire(new URL('../promo/package.json', import.meta.url))
const { chromium } = require(process.env.NICKNAME_PLAYWRIGHT_MODULE ?? 'playwright')
const owned = migratePokemonCollection([6, 9, 3, 25, 94, 149].map(speciesId => normalizePokemon({ speciesId, captureId: `nickname-ui-${speciesId}`, directDrawCount: 1 })))
const teams = createSavedTeams(owned.map(pokemon => pokemon.captureId), owned.map(pokemon => pokemon.captureId))
process.env.VITE_POKEMON_USAGE_ENABLED = 'false'
process.env.VITE_POKEMON_USAGE_DEMO = 'false'
process.env.VITE_RANKED_LOCAL_TEST = 'false'
const store = createMemoryRankedStore(), fixtures = new Map(), identities = new Map()
const clock = Date.now()
const service = createAccountService({ store, now: () => clock })
const handler = createAccountHttpHandler({ service, now: () => clock, authenticate: async (_request, token) => {
  const identity = identities.get(token)
  assert(identity, 'Unknown local fixture identity')
  return identity
} })
const results = [], errors = [], unexpectedRequests = [], requests = []
let nextId = 0, gate = null, server, browser, origin
const styles = ['styles', 'screenRedesign', 'battleGen5', 'titleCleanup', 'battleGimmicks', 'moveAnimationDirector', 'settings', 'auth', 'mobileLandscape', 'gameTextScale', 'scaledBoxCards', 'scaledBattleCards', 'scaledTrainingEditor']
const entry = `import'/src/mobileViewport.js';import React from'react';import{createRoot}from'react-dom/client';
import SettingsModal from'/src/SettingsModal.jsx';import{createDefaultGameSettings}from'/src/gameSettings.js';import{applyGameTextScale}from'/src/gameTextScale.js';
${styles.map(name => `import'/src/${name}.css';`).join('\n')}
const fixture=JSON.parse(document.getElementById('nickname-fixture').textContent);applyGameTextScale(fixture.scale);
const{GameApp}=fixture.gameApp?await import('/src/App.jsx'):{};
function Harness(){const[user,setUser]=React.useState(fixture.user);const[open,setOpen]=React.useState(false);const[tab,setTab]=React.useState('account');
window.__nicknameUi={user,open,calls:window.__nicknameUi?.calls||[],loadTab:setTab};
async function save(nickname){window.__nicknameUi.calls.push(nickname);
const response=await fetch('/api/account',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+fixture.token},body:JSON.stringify({action:'setNickname',ownerId:fixture.ownerId,nickname})});
const data=await response.json();if(!response.ok)throw new Error(data.error?.message||'저장에 실패했습니다.');
setUser(current=>({...current,nickname:data.profile.nickname}));}
if(fixture.gameApp)return React.createElement(GameApp,{user,authBusy:false,autoLogin:true,onSetNickname:save,
onPlayerDataChanged:()=>{},onAutoLoginChange:()=>{},onConnectGoogle:()=>{},onDeleteAccount:()=>{},onSignOut:()=>{}});
return React.createElement('main',{className:'app-shell',style:{minHeight:'100vh'}},
React.createElement('button',{type:'button','aria-label':'환경 설정 열기',onClick:()=>setOpen(true)},'환경 설정'),
open&&React.createElement(SettingsModal,{user,initialTab:tab,settings:createDefaultGameSettings(),authBusy:false,autoLogin:true,
onSetNickname:save,onClose:()=>setOpen(false),onChange:()=>{},onReset:()=>{},onAutoLoginChange:()=>{},onConnectGoogle:()=>{},onDeleteAccount:()=>{},onSignOut:()=>{}}));}
createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement(Harness)));`

function holdNextRequest(fail = false) {
  let arrive, release
  gate = { fail, used: false, arrived: new Promise(resolve => { arrive = resolve }), wait: new Promise(resolve => { release = resolve }), arrive: () => arrive(), release: () => release() }
  return gate
}
async function seed({ nickname = '', guest = false, localGuest = false, scale = 1, gameApp = false } = {}) {
  const id = `nickname-ui-${++nextId}`, ownerId = `${id}-owner-0123456789`, token = `${id}-token`
  const identity = { uid: id, name: '김민수', isGuest: false, accountProfile: { displayName: '김민수', email: 'nickname-ui@example.invalid', providerIds: ['google.com'] } }
  identities.set(token, identity)
  await service.execute(identity, { action: 'sessionAcquire', ownerId })
  await service.execute(identity, { action: 'ensureProfile', ownerId })
  if (nickname && !guest) await service.execute(identity, { action: 'setNickname', ownerId, nickname })
  const fixture = { id, ownerId, token, scale, gameApp, user: { uid: id, displayName: guest ? '게스트_123456' : '김민수', email: guest ? null : identity.accountProfile.email,
    isAnonymous: guest, isLocalGuest: localGuest, nickname } }
  fixtures.set(id, fixture)
  return fixture
}
const input = page => page.getByRole('textbox', { name: '닉네임', exact: true })
const save = page => page.locator('.settings-nickname-save')
const name = page => page.locator('.settings-account-copy > strong')
const accountName = page => page.locator('.settings-nickname-current > strong')
async function displayed(page, expected) {
  await page.waitForFunction(value => document.querySelector('.settings-account-copy > strong')?.textContent === value, expected)
  assert.equal(await accountName(page).innerText(), expected)
}
async function submit(page, value) {
  await input(page).fill(value)
  await save(page).click()
  await page.waitForFunction(() => document.querySelector('.settings-nickname')?.getAttribute('aria-busy') === 'false')
}
async function profile(fixture) {
  return (await service.execute(identities.get(fixture.token), { action: 'ensureProfile', ownerId: fixture.ownerId })).profile
}

try {
  server = await createServer({ root, logLevel: 'error', plugins: [{ name: 'trainer-nickname-ui-entry',
    resolveId: id => id === '/nickname-ui-entry.js' ? id : /(?:\/|\.)firebaseClient(?:\.js)?$/.test(id) ? '\0nickname-ui-auth' : undefined,
    load: id => id === '/nickname-ui-entry.js' ? entry : id === '\0nickname-ui-auth'
      ? 'export const firebaseAuth=null;export const firebaseDb=null;export const isFirebaseConfigured=false;export const missingFirebaseEnvironmentVariables=[];' : undefined,
    configureServer(vite) {
      vite.middlewares.use(async (request, response, next) => {
        if (request.url?.split('?')[0] !== '/api/account') return next()
        try {
          const chunks = []
          for await (const chunk of request) chunks.push(chunk)
          const body = Buffer.concat(chunks), payload = JSON.parse(body.toString('utf8'))
          const observed = { action: payload.action, nickname: payload.nickname }
          requests.push(observed)
          const waiting = gate && !gate.used ? gate : null
          if (waiting) { waiting.used = true; waiting.arrive(); await waiting.wait }
          const result = waiting?.fail
            ? Response.json({ error: { code: 'TEST_UNAVAILABLE', message: '연결 오류로 저장하지 못했습니다. 다시 시도해 주세요.' } }, { status: 503 })
            : await handler(new Request(`${origin}/api/account`, { method: request.method, headers: request.headers, body }))
          const text = await result.text()
          Object.assign(observed, { status: result.status, code: JSON.parse(text).error?.code })
          response.writeHead(result.status, Object.fromEntries(result.headers)); response.end(text)
        } catch (error) {
          errors.push({ source: 'local-http', message: error.message })
          response.writeHead(500); response.end('{}')
        }
      })
    },
  }], server: { host: '127.0.0.1', port: 0, hmr: false } })
  await server.listen()
  origin = `http://127.0.0.1:${server.httpServer.address().port}`
  browser = await chromium.launch({ executablePath: await resolveChromiumExecutable(chromium), headless: true })
  async function client(options = {}, device = { id: 'desktop', viewport: { width: 1440, height: 900 } }) {
    const fixture = await seed(options)
    const context = await browser.newContext({ ...device, reducedMotion: 'reduce' })
    const settings = createDefaultGameSettings()
    settings.audio.enabled = false
    settings.game.textScale = fixture.scale
    await context.addInitScript(({ key, settings, owned, teams }) => {
      localStorage.setItem(key, JSON.stringify(settings))
      localStorage.setItem('champions-draw-tutorial-v1', 'complete')
      localStorage.setItem('champions-dex-v2', JSON.stringify(owned))
      localStorage.setItem('champions-teams-v1', JSON.stringify({ teams, activeTeamId: 'team-1' }))
    }, { key: SETTINGS_STORAGE_KEY, settings, owned, teams })
    await context.route('**/*', route => {
      const url = new URL(route.request().url())
      if (url.origin === origin) return route.continue()
      if (route.request().resourceType() !== 'image') unexpectedRequests.push(url.href)
      return route.abort()
    })
    await context.route('**/nickname-ui.html?*', async route => {
      const html = await server.transformIndexHtml('/nickname-ui.html', `<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script id="nickname-fixture" type="application/json">${JSON.stringify(fixture)}</script><script type="module" src="/nickname-ui-entry.js"></script></body></html>`)
      await route.fulfill({ contentType: 'text/html', body: html })
    })
    const page = await context.newPage()
    page.setDefaultTimeout(15_000)
    page.on('pageerror', error => errors.push({ source: fixture.id, message: error.message }))
    await page.goto(`${origin}/nickname-ui.html?id=${fixture.id}`)
    if (fixture.gameApp) {
      await page.getByRole('button', { name: '설정', exact: true }).click()
      await page.getByRole('tab', { name: '계정', exact: true }).click()
    } else await page.getByRole('button', { name: '환경 설정 열기', exact: true }).click()
    await page.locator('#settings-account-panel').waitFor()
    return { page, context, fixture }
  }
  async function check(id, options, run, device) {
    const { page, context, fixture } = await client(options, device)
    try {
      await run(page, fixture)
      await page.screenshot({ path: path.join(output, `${id}.png`) })
      results.push({ id, passed: true }); console.log(`PASS ${id}`)
    } catch (error) {
      results.push({ id, passed: false, error: error.stack })
      await page.screenshot({ path: path.join(output, `${id}-failure.png`) }).catch(() => {})
      console.error(`FAIL ${id}: ${error.message}`)
    } finally { gate?.release(); gate = null; await context.close() }
  }
  await check('save-waits-for-server-and-locks-duplicate-and-close', {}, async (page, fixture) => {
    await displayed(page, '김**')
    await input(page).fill('  새 이름_12  ')
    await displayed(page, '김**')
    const pending = holdNextRequest()
    await save(page).evaluate(button => { button.click(); button.click(); button.form.requestSubmit() })
    await pending.arrived
    assert.equal(await page.evaluate(() => window.__nicknameUi.calls.length), 1)
    assert(await input(page).isDisabled())
    assert(await page.getByRole('button', { name: '설정 닫기', exact: true }).isDisabled())
    assert(await page.getByRole('button', { name: '완료', exact: true }).isDisabled())
    assert(await page.getByRole('tab', { name: '게임', exact: true }).isDisabled())
    assert(await page.locator('.settings-sign-out-button').isDisabled())
    assert.match(await page.locator('.settings-sign-out-button').innerText(), /로그아웃하고 계정 전환/)
    assert(await page.locator('.settings-delete-account-button').isDisabled())
    await page.keyboard.press('Escape')
    await page.mouse.click(1, 1)
    await page.keyboard.press('Tab')
    assert.equal(await page.locator('[role="dialog"]').count(), 1)
    assert(await page.evaluate(() => document.querySelector('[role="dialog"]').contains(document.activeElement)))
    await displayed(page, '김**')
    assert.equal((await profile(fixture)).nickname, '')
    pending.release()
    await displayed(page, '새 이름_12')
    assert.equal((await profile(fixture)).nickname, '새 이름_12')
    assert.equal(await input(page).inputValue(), '새 이름_12')
    assert(await page.getByRole('button', { name: '설정 닫기', exact: true }).isEnabled())
    await page.keyboard.press('Escape')
    await page.locator('[role="dialog"]').waitFor({ state: 'hidden' })
    await page.getByRole('button', { name: '환경 설정 열기', exact: true }).click()
    await displayed(page, '새 이름_12')
  })
  await check('failed-save-keeps-old-name-and-draft-before-successful-retry', { nickname: '기존별명' }, async (page, fixture) => {
    const pending = holdNextRequest(true)
    await input(page).fill('새로운별명')
    await save(page).click(); await pending.arrived; pending.release()
    await page.locator('.settings-nickname-error[role="alert"]').waitFor()
    await displayed(page, '기존별명')
    assert.equal((await profile(fixture)).nickname, '기존별명')
    assert.equal(await input(page).inputValue(), '새로운별명')
    assert(await input(page).isEditable())
    assert(await page.getByRole('button', { name: '설정 닫기', exact: true }).isEnabled())
    await save(page).click()
    await displayed(page, '새로운별명')
    assert.equal((await profile(fixture)).nickname, '새로운별명')
  })
  await check('shared-validation-rejects-invalid-input-and-accepts-12-characters', {}, async page => {
    for (const value of ['가', '가나다라마바사아자차카타파', '별명😀']) {
      await input(page).fill(value); await save(page).click()
      await page.locator('.settings-nickname-error[role="alert"]').waitFor()
      assert.equal(await page.evaluate(() => window.__nicknameUi.calls.length), 0)
      await displayed(page, '김**')
    }
    await submit(page, '가나다라마바사아자차카타')
    await displayed(page, '가나다라마바사아자차카타')
  })
  await check('Korean-composition-enter-does-not-submit-until-completed', {}, async page => {
    await input(page).fill('한글별명')
    await input(page).evaluate(element => {
      element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
      element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, isComposing: true, bubbles: true, cancelable: true }))
      element.form.requestSubmit()
    })
    assert.equal(await page.evaluate(() => window.__nicknameUi.calls.length), 0)
    assert.equal(await input(page).inputValue(), '한글별명')
    await input(page).evaluate(element => element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })))
    await input(page).press('Enter')
    await displayed(page, '한글별명')
    assert.equal(await page.evaluate(() => window.__nicknameUi.calls.length), 1)
  })
  await check('clear-restores-masked-name-after-server-success', { nickname: '사용중별명' }, async (page, fixture) => {
    const pending = holdNextRequest()
    await page.getByRole('button', { name: '닉네임 해제', exact: true }).click(); await pending.arrived
    await displayed(page, '사용중별명')
    assert(await page.getByRole('button', { name: '닉네임 해제', exact: true }).isDisabled())
    pending.release()
    await displayed(page, '김**')
    assert.equal((await profile(fixture)).nickname, '')
    assert.equal(await input(page).inputValue(), '')
    assert.equal(await page.getByRole('button', { name: '닉네임 해제', exact: true }).count(), 0)
    assert.deepEqual(await page.evaluate(() => window.__nicknameUi.calls), [''])
  })
  await check('server-profanity-refusal-preserves-current-name-and-editable-draft', { nickname: '차분한별명' }, async (page, fixture) => {
    await submit(page, '시발')
    const alert = page.locator('.settings-nickname-error[role="alert"]')
    await alert.waitFor(); assert.match(await alert.innerText(), /욕설|비속어/)
    await displayed(page, '차분한별명')
    assert.equal(await input(page).inputValue(), '시발')
    assert.equal((await profile(fixture)).nickname, '차분한별명')
    assert(requests.some(request => request.code === 'NICKNAME_PROFANITY' && request.status === 422))
    await submit(page, '수정한별명')
    await displayed(page, '수정한별명')
  })
  await check('unsaved-draft-does-not-change-profile-on-close', { nickname: '유지할별명' }, async (page, fixture) => {
    await input(page).fill('미저장별명')
    await page.getByRole('button', { name: '완료', exact: true }).click()
    await page.getByRole('button', { name: '환경 설정 열기', exact: true }).click()
    await displayed(page, '유지할별명')
    assert.equal(await input(page).inputValue(), '유지할별명')
    assert.equal((await profile(fixture)).nickname, '유지할별명')
  })
  for (const localGuest of [false, true]) await check(`${localGuest ? 'local' : 'online'}-guest-cannot-edit-nickname`, { guest: true, localGuest, nickname: '무시할닉네임' }, async page => {
    assert.equal(await name(page).innerText(), '게스트_123456')
    assert.equal(await input(page).count(), 0)
    assert.equal(await page.locator('.settings-nickname-save, .settings-nickname-clear').count(), 0)
    assert.equal(await page.evaluate(() => window.__nicknameUi.calls.length), 0)
    assert.match(await page.locator('.settings-nickname-guest').innerText(), /Google/)
  })
  await check('real-GameApp-header-updates-only-after-nickname-save-and-clear', { gameApp: true }, async page => {
    const headerName = page.locator('.player-account-copy > strong')
    assert.equal(await headerName.innerText(), '김**')
    await input(page).fill('헤더검증별명')
    assert.equal(await headerName.innerText(), '김**')
    const pending = holdNextRequest()
    await save(page).click(); await pending.arrived
    assert.equal(await headerName.innerText(), '김**')
    pending.release()
    await page.waitForFunction(() => document.querySelector('.player-account-copy > strong')?.textContent === '헤더검증별명')
    await displayed(page, '헤더검증별명')
    await page.getByRole('button', { name: '완료', exact: true }).click()
    assert.equal(await headerName.innerText(), '헤더검증별명')
    await page.getByRole('button', { name: '설정', exact: true }).click()
    await page.getByRole('tab', { name: '계정', exact: true }).click()
    await page.getByRole('button', { name: '닉네임 해제', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('.player-account-copy > strong')?.textContent === '김**')
    await displayed(page, '김**')
  })
  for (const device of [{ id: 'desktop', viewport: { width: 1440, height: 900 } }, { id: 'mobile', viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true }]) {
    // Mobile is pinned to the 1x ramp; only desktop frames reach the 2x preset.
    for (const scale of device.isMobile ? [1] : [1, 2]) await check(`${device.id}-${scale}x-nickname-controls-remain-reachable`, { nickname: '가나다라마바사아자차카타', scale }, async page => {
      await displayed(page, '가나다라마바사아자차카타')
      assert(await name(page).evaluate(element => element.scrollWidth <= element.clientWidth + 1), 'The full 12-character nickname must remain readable')
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      for (const control of [input(page), save(page), page.getByRole('button', { name: '닉네임 해제', exact: true })]) {
        await control.scrollIntoViewIfNeeded()
        assert(await control.evaluate(element => {
          const r = element.getBoundingClientRect(), body = element.closest('.settings-modal-body').getBoundingClientRect()
          return r.width > 0 && r.height >= 40 && r.left >= 0 && r.right <= innerWidth + 1 && r.top >= body.top - 1 && r.bottom <= body.bottom + 1
        }), 'Nickname control must fit the scrollable settings viewport')
      }
      await input(page).fill('화면검증별명')
      await save(page).click()
      await displayed(page, '화면검증별명')
    }, device)
  }
} finally {
  gate?.release()
  await browser?.close()
  await server?.close()
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ results, errors, unexpectedRequests, requests }, null, 2))
}
assert.deepEqual(errors, [])
assert.deepEqual(unexpectedRequests, [])
assert.equal(results.length, 13)
assert(results.every(result => result.passed), `Nickname UI regression failed; see ${output}`)
console.log(`13/13 nickname UI checks passed; browser/server errors ${errors.length}; unexpected external requests ${unexpectedRequests.length}`)
