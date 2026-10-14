import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { createDefaultGameSettings, SETTINGS_STORAGE_KEY } from '../src/gameSettings.js'
import { normalizePokemon } from '../src/data/trainingData.js'
import { migratePokemonCollection } from '../src/data/pokemonPool.js'
import { createSavedTeams } from '../src/data/teamData.js'
import { resolveChromiumExecutable } from '../promo/scripts/browserRuntime.mjs'

// Real GameApp, chat component/client, and isolated local chat service/HTTP
// adapter. No production credentials, chat writes, Firebase, or external calls.
const root = fileURLToPath(new URL('../', import.meta.url))
const output = path.join(root, 'scripts/.cache/global-chat-ui')
await fs.mkdir(output, { recursive: true })
const port = Number(process.env.GLOBAL_CHAT_UI_PORT ?? 5254)
const origin = `http://127.0.0.1:${port}`
const styles = ['styles', 'screenRedesign', 'battleGen5', 'titleCleanup', 'battleGimmicks', 'moveAnimationDirector', 'settings', 'auth', 'mobileLandscape', 'gameTextScale', 'scaledBoxCards', 'scaledBattleCards', 'scaledTrainingEditor']
const owned = migratePokemonCollection([6, 9, 3, 25, 94, 149].map(speciesId => normalizePokemon({ speciesId, captureId: `chat-ui-${speciesId}`, directDrawCount: 1 })))
const teams = createSavedTeams(owned.map(pokemon => pokemon.captureId), owned.map(pokemon => pokemon.captureId))
const identities = {
  'global-chat-ui-a-token': { uid: 'global-chat-ui-a', name: '가람트레이너', isGuest: false, title: 'dex-master' },
  'global-chat-ui-b-token': { uid: 'global-chat-ui-b', name: '나래트레이너', isGuest: false },
}
const entry = `import'/src/mobileViewport.js';import React,{StrictMode}from'react';import{createRoot}from'react-dom/client';import{GameApp}from'/src/App.jsx';
import{updateOnlinePlayers}from'/src/auth/onlinePlayers.js';
${styles.map(name => `import'/src/${name}.css';`).join('\n')}
const letter=new URL(location.href).searchParams.get('client')||'a';
const user={uid:'global-chat-ui-'+letter,displayName:letter==='a'?'매우긴트레이너닉네임을사용하는헤더공간검증용사용자1234567890':'채팅검증나',isAnonymous:true,isLocalGuest:false,getIdToken:async()=>'global-chat-ui-'+letter+'-token'};
updateOnlinePlayers(user.uid,'global-chat-ui',{count:1234,sampledAt:Date.now(),staleAfterMs:60000});
createRoot(document.getElementById('root')).render(React.createElement(StrictMode,null,React.createElement(GameApp,{user,autoLogin:false,onPlayerDataChanged:()=>{},onSignOut:()=>{}})));`
process.env.VITE_POKEMON_USAGE_ENABLED = 'false'
process.env.VITE_POKEMON_USAGE_DEMO = 'false'
process.env.VITE_RANKED_LOCAL_TEST = 'false'
const checks = [], errors = [], unexpectedRequests = [], requests = [], metrics = []
let service, handler, serviceClock = Date.now() - 240_000, rejectNextSendUid = null
const advance = (ms = 6000) => { serviceClock += ms }
async function setupService() {
  // Instantiate the same public adapters as production with a private memory
  // store and authenticated fixture identities, never response-shaped stubs.
  const { createMemoryRankedStore } = await import('../server/rankedStore.js')
  const { createGlobalChatService } = await import('../server/globalChatService.js')
  const { createGlobalChatHttpHandler } = await import('../server/globalChatHttp.js')
  service = createGlobalChatService({ store: createMemoryRankedStore(), now: () => serviceClock })
  handler = createGlobalChatHttpHandler({ service, now: () => serviceClock, authenticate: async (_request, token) => {
    const identity = identities[token]
    if (!identity) throw Object.assign(new Error('Unknown isolated test account'), { status: 401, code: 'UNAUTHENTICATED' })
    return { ...identity, displayName: identity.name }
  } })
}
async function localRequest(token, payload) {
  const response = await handler(new Request(`${origin}/api/chat`, { method: 'POST', headers: {
    'Content-Type': 'application/json', Authorization: `Bearer ${token}`, Origin: origin,
  }, body: JSON.stringify(payload) }))
  const body = await response.json()
  assert.equal(response.status, 200, JSON.stringify(body))
  return body
}
async function test(name, run) {
  try { await run(); checks.push({ name, passed: true }); console.log(`PASS ${name}`) }
  catch (error) { checks.push({ name, passed: false, error: error.stack }); console.error(`FAIL ${name}: ${error.message}`) }
}
const selectors = { trigger: '.global-chat-trigger', dialog: '.global-chat-dialog', messages: '.global-chat-messages', message: '.global-chat-message', text: '.global-chat-message-text' }
const trigger = page => page.locator(selectors.trigger)
const input = page => page.getByRole('textbox', { name: '전체 채팅 메시지', exact: true })
const sendButton = page => page.getByRole('button', { name: '메시지 보내기', exact: true })
async function expanded(page, wanted = true) {
  const current = await trigger(page).getAttribute('aria-expanded') === 'true'
  if (current !== wanted) {
    if (wanted) await trigger(page).click()
    else await page.getByRole('button', { name: '전체 채팅 닫기', exact: true }).click()
  }
  if (wanted) await page.locator(selectors.dialog).waitFor({ state: 'visible' })
  else await page.locator(selectors.dialog).waitFor({ state: 'hidden' })
}
async function send(page, text) {
  advance()
  await expanded(page)
  await input(page).fill(text)
  await sendButton(page).click()
  await page.waitForFunction(() => document.querySelector('textarea[aria-label="전체 채팅 메시지"]')?.value === '')
  await page.locator(selectors.text).filter({ hasText: text }).last().waitFor()
}
function overlaps(a, b) {
  return Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1
}
async function geometry(page) {
  return page.evaluate(() => {
    const rect = selector => {
      const element = document.querySelector(selector)
      if (!element) throw new Error(`Missing ${selector}`)
      const r = element.getBoundingClientRect()
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }
    }
    const dialog = document.querySelector('.global-chat-dialog[open]')
    return { width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth,
      header: rect('.topbar'), main: rect('.app-shell > main'), brand: rect('.brand'), badge: rect('.online-players-badge'), status: rect('.top-status'), chat: rect('.global-chat-trigger'),
      controls: [...document.querySelectorAll('.top-status > *')].map(element => {
        const r = element.getBoundingClientRect(); return { label: element.getAttribute('aria-label') || element.textContent, left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }
      }),
      ...(dialog ? { dialog: rect('.global-chat-dialog'), input: rect('textarea[aria-label="전체 채팅 메시지"]'), send: rect('button[aria-label="메시지 보내기"]'), list: rect('.global-chat-messages') } : {}),
    }
  })
}
function assertFits(g) {
  assert(g.documentWidth <= g.width + 1, `Page overflows horizontally: ${JSON.stringify(g)}`)
  for (const [name, r] of [['brand', g.brand], ['online count', g.badge], ['chat', g.chat], ...g.controls.map(c => [c.label, c])]) {
    assert(r.width > 0 && r.height > 0 && r.left >= -1 && r.right <= g.width + 1 && r.top >= -1 && r.bottom <= g.height + 1, `${name} is clipped: ${JSON.stringify(g)}`)
    assert(r.top >= g.header.top - 1 && r.bottom <= g.header.bottom + 1, `${name} exceeds its header`)
  }
  assert(g.main.top >= g.header.bottom - 1, `Main overlaps header: ${JSON.stringify(g)}`)
  assert(!overlaps(g.brand, g.chat), 'Chat overlaps logo')
  assert(!overlaps(g.badge, g.chat), 'Chat overlaps online count')
  g.controls.forEach((a, i) => g.controls.slice(i + 1).forEach(b => assert(!overlaps(a, b), `${a.label} overlaps ${b.label}`)))
  if (g.dialog) {
    for (const key of ['dialog', 'input', 'send', 'list']) {
      const r = g[key]
      assert(r.width > 0 && r.height > 0 && r.left >= -1 && r.right <= g.width + 1 && r.top >= -1 && r.bottom <= g.height + 1, `${key} is outside the viewport: ${JSON.stringify(g)}`)
    }
    assert(!overlaps(g.input, g.send), 'Message input and send button overlap')
  }
}

let server, browser
try {
  await setupService()
  for (let n = 1; n <= 35; n += 1) {
    advance()
    await localRequest('global-chat-ui-a-token', { action: 'send', text: `보관 검증 메시지 ${String(n).padStart(2, '0')}`, requestId: `global-chat-ui-seed-${n}` })
  }
  advance(30_000)
  server = await createServer({ root, mode: 'global-chat-validation', logLevel: 'error', plugins: [{
    name: 'global-chat-ui-fixture', enforce: 'pre',
    resolveId(source) {
      if (source === '/global-chat-entry.js') return source
      if (source.endsWith('/auth/firebaseClient') || source.endsWith('/auth/firebaseClient.js') || source === './firebaseClient' || source === './firebaseClient.js') return '\0global-chat-ui-auth'
    },
    load(id) {
      if (id === '/global-chat-entry.js') return entry
      if (id === '\0global-chat-ui-auth') return 'export const firebaseAuth=null;export const firebaseDb=null;export const isFirebaseConfigured=false;export const missingFirebaseEnvironmentVariables=[];'
    },
    configureServer(vite) {
      vite.middlewares.use(async (request, response, next) => {
        if (request.url?.split('?')[0] !== '/api/chat') return next()
        try {
          const chunks = []
          for await (const chunk of request) chunks.push(chunk)
          const body = Buffer.concat(chunks)
          const payload = JSON.parse(body.toString('utf8'))
          const uid = identities[String(request.headers.authorization ?? '').replace(/^Bearer /, '')]?.uid
          const observed = { uid, action: payload.action, expanded: payload.expanded, requestId: payload.requestId }
          requests.push(observed)
          let result
          if (payload.action === 'send' && rejectNextSendUid === uid) {
            rejectNextSendUid = null
            result = Response.json({ error: { code: 'UNAVAILABLE', message: '테스트 연결 오류입니다. 다시 시도해주세요.' } }, { status: 503 })
          } else result = await handler(new Request(`${origin}/api/chat`, { method: request.method, headers: request.headers, body }))
          const resultText = await result.text()
          const parsed = JSON.parse(resultText)
          Object.assign(observed, { status: result.status, errorCode: parsed.error?.code, hasMessages: Array.isArray(parsed.messages), messageCount: parsed.messages?.length, revision: parsed.revision })
          response.writeHead(result.status, Object.fromEntries(result.headers))
          response.end(resultText)
        } catch (error) {
          errors.push({ source: 'local-http', message: error.message })
          response.writeHead(500, { 'Content-Type': 'application/json' })
          response.end(JSON.stringify({ error: { code: 'TEST_HTTP_FAILURE', message: 'Local test adapter failed' } }))
        }
      })
    },
  }], server: { host: '127.0.0.1', port, strictPort: true, hmr: false } })
  await server.listen()
  const require = createRequire(new URL('../promo/package.json', import.meta.url))
  const { chromium } = require(process.env.GLOBAL_CHAT_PLAYWRIGHT_MODULE ?? 'playwright')
  browser = await chromium.launch({ executablePath: await resolveChromiumExecutable(chromium), headless: true })
  const html = await server.transformIndexHtml('/global-chat.html', '<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body><div id="root"></div><script type="module" src="/global-chat-entry.js"></script></body></html>')
  // Any external image request is answered with this 1x1 GIF, so the test does
  // not depend on a particular sprite shipping with the game.
  const sprite = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')
  async function client(letter, device = { id: 'desktop', viewport: { width: 1920, height: 900 } }, scale = 1) {
    const context = await browser.newContext({ viewport: device.viewport, hasTouch: Boolean(device.hasTouch), isMobile: Boolean(device.hasTouch), reducedMotion: 'reduce' })
    const settings = createDefaultGameSettings()
    settings.audio.enabled = false
    settings.game.textScale = scale
    await context.addInitScript(({ key, settings, owned, teams }) => {
      localStorage.setItem(key, JSON.stringify(settings))
      localStorage.setItem('champions-draw-tutorial-v1', 'complete')
      localStorage.setItem('champions-dex-v2', JSON.stringify(owned))
      localStorage.setItem('champions-teams-v1', JSON.stringify({ teams, activeTeamId: 'team-1' }))
    }, { key: SETTINGS_STORAGE_KEY, settings, owned, teams })
    await context.route(/^https:\/\//, route => {
      if (route.request().resourceType() === 'image') return route.fulfill({ contentType: 'image/gif', body: sprite })
      if (/^https:\/\/raw\.githubusercontent\.com\/PokeAPI\/cries\//.test(route.request().url())) return route.abort()
      unexpectedRequests.push(route.request().url()); return route.abort()
    })
    await context.route('**/api/**', route => {
      if (route.request().url() === `${origin}/api/chat`) return route.continue()
      unexpectedRequests.push(route.request().url()); return route.abort()
    })
    await context.route('**/global-chat.html?*', route => route.fulfill({ contentType: 'text/html', body: html }))
    const page = await context.newPage()
    // Idle open chat may wait up to 30 seconds between unchanged snapshots.
    page.setDefaultTimeout(40_000)
    page.on('pageerror', error => errors.push({ source: `${device.id}-${scale}x-${letter}`, message: error.message }))
    await page.clock.install()
    await page.goto(`${origin}/global-chat.html?client=${letter}`)
    await page.getByRole('heading', { name: '플레이 메뉴', exact: true }).waitFor()
    await trigger(page).waitFor()
    return { page, context }
  }
  const a = await client('a'), b = await client('b')
  await test('collapsed chat shows the real latest message without fetching the message history', async () => {
    await trigger(a.page).getByText(/보관 검증 메시지 35/).waitFor()
    await trigger(b.page).getByText(/보관 검증 메시지 35/).waitFor()
    assert.equal(await trigger(a.page).getAttribute('aria-expanded'), 'false')
    const reads = requests.filter(r => r.action === 'read' && !r.expanded && r.status === 200)
    assert(reads.length >= 2)
    assert(reads.every(r => !r.hasMessages), JSON.stringify(reads))
  })
  await test('closed chat waits two minutes between reads and offline tabs issue none', async () => {
    const uid = identities['global-chat-ui-a-token'].uid
    const reads = () => requests.filter(r => r.uid === uid && r.action === 'read').length
    const initial = reads()
    await a.page.clock.fastForward(60_000)
    assert.equal(reads(), initial)
    const response = a.page.waitForResponse(r => r.url() === origin + '/api/chat' && r.request().postDataJSON()?.action === 'read')
    await a.page.clock.fastForward(60_100)
    await response
    assert.equal(reads(), initial + 1)
    await a.page.evaluate(() => { Object.defineProperty(navigator, 'onLine', { configurable:true, get:()=>false }); window.dispatchEvent(new Event('offline')) })
    await a.page.clock.fastForward(180_000)
    assert.equal(reads(), initial + 1)
    const resumed = a.page.waitForResponse(r => r.url() === origin + '/api/chat' && r.request().postDataJSON()?.action === 'read')
    await a.page.evaluate(() => { delete navigator.onLine; window.dispatchEvent(new Event('online')) })
    await resumed
  })
  await test('expansion keeps only the latest 30 of 35 messages with server names and times', async () => {
    await expanded(a.page)
    await a.page.locator(selectors.text).filter({ hasText: '보관 검증 메시지 35' }).waitFor()
    assert.equal(await a.page.locator(selectors.message).count(), 30)
    assert.equal(await a.page.locator(selectors.text).first().innerText(), '보관 검증 메시지 06')
    const last = a.page.locator(selectors.message).last()
    assert.equal(await last.locator('.global-chat-message-name').innerText(), '가**')
    assert.match(await last.locator('time').innerText(), /\d{1,2}:\d{2}/)
    assert(Number.isFinite(Date.parse(await last.locator('time').getAttribute('datetime'))))
  })
  await test('two isolated browser users exchange authenticated messages and update the collapsed preview', async () => {
    await send(a.page, '두 브라우저 실시간 전달 확인')
    await b.page.evaluate(() => window.dispatchEvent(new Event('online')))
    await trigger(b.page).getByText(/두 브라우저 실시간 전달 확인/).waitFor()
    await expanded(b.page)
    const received = b.page.locator(selectors.message).filter({ hasText: '두 브라우저 실시간 전달 확인' })
    await received.waitFor()
    assert.equal(await received.locator('.global-chat-message-name').innerText(), '가**')
    await send(b.page, '다른 트레이너의 응답 확인')
    await a.page.evaluate(() => window.dispatchEvent(new Event('online')))
    await a.page.locator(selectors.message).filter({ hasText: '다른 트레이너의 응답 확인' }).waitFor()
  })
  await test('Korean IME composition Enter does not send or lose the draft; final Enter sends once', async () => {
    advance()
    await input(a.page).fill('한글 조합 중')
    const before = requests.filter(r => r.action === 'send' && r.uid === identities['global-chat-ui-a-token'].uid).length
    await input(a.page).evaluate(element => {
      element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }))
      element.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: '중' }))
      element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 229, isComposing: true, bubbles: true, cancelable: true }))
    })
    await a.page.waitForTimeout(250)
    assert.equal(requests.filter(r => r.action === 'send' && r.uid === identities['global-chat-ui-a-token'].uid).length, before)
    assert.equal(await input(a.page).inputValue(), '한글 조합 중')
    await input(a.page).evaluate(element => element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '중' })))
    await input(a.page).press('Enter')
    await a.page.waitForFunction(() => document.querySelector('textarea[aria-label="전체 채팅 메시지"]')?.value === '')
    assert.equal(requests.filter(r => r.action === 'send' && r.uid === identities['global-chat-ui-a-token'].uid).length, before + 1)
  })
  await test('a failed send preserves the draft and a retry posts one message', async () => {
    advance()
    rejectNextSendUid = identities['global-chat-ui-a-token'].uid
    await input(a.page).fill('연결 오류 후에도 남아야 하는 초안')
    await sendButton(a.page).click()
    await a.page.locator('.global-chat-error[role="alert"]').waitFor()
    assert.equal(await input(a.page).inputValue(), '연결 오류 후에도 남아야 하는 초안')
    assert.equal(await input(a.page).isEditable(), true)
    await sendButton(a.page).click()
    await a.page.waitForFunction(() => document.querySelector('textarea[aria-label="전체 채팅 메시지"]')?.value === '')
    assert.equal(await a.page.locator(selectors.text).filter({ hasText: '연결 오류 후에도 남아야 하는 초안' }).count(), 1)
  })
  await test('server rejects profanity at the 200-codepoint boundary, keeps the draft and guidance through polling, and accepts an edited message', async () => {
    advance()
    await expanded(a.page)
    await expanded(b.page)
    const before = await localRequest('global-chat-ui-b-token', { action: 'read', expanded: true })
    const blockedText = `${'😀'.repeat(197)} 시발`
    assert.equal([...blockedText].length, 200)
    // The UI must count codepoints, retaining the final Korean word after 197
    // surrogate-pair emoji; truncating at 200 UTF-16 units would hide the test.
    await input(a.page).fill(`${blockedText}초과`)
    assert.equal(await input(a.page).inputValue(), blockedText)
    assert.match(await a.page.locator('.global-chat-counter').innerText(), /^200\s*\/\s*200$/)
    const refused = a.page.waitForResponse(response => response.url() === `${origin}/api/chat`
      && response.request().method() === 'POST' && response.request().postDataJSON()?.action === 'send')
    await sendButton(a.page).click()
    const refusal = await refused
    assert.equal(refusal.status(), 422)
    assert.equal((await refusal.json()).error?.code, 'CHAT_PROFANITY')
    const alert = a.page.locator('.global-chat-error[role="alert"]')
    await alert.waitFor()
    assert.match(await alert.innerText(), /욕설|비속어/)
    assert.equal(await input(a.page).inputValue(), blockedText)
    assert.equal(await input(a.page).isEditable(), true)

    // Exercise the hook's normal read path in both browsers after rejection.
    // A successful poll must not silently erase the sending user's guidance.
    const readCompleted = [a.page, b.page].map(page => page.waitForResponse(response => response.url() === `${origin}/api/chat`
      && response.request().method() === 'POST' && response.request().postDataJSON()?.action === 'read'))
    await Promise.all([a.page, b.page].map(page => page.evaluate(() => window.dispatchEvent(new Event('online')))))
    for (const response of await Promise.all(readCompleted)) {
      assert.equal(response.status(), 200)
      await response.finished()
    }
    await a.page.waitForTimeout(250)
    assert.match(await alert.innerText(), /욕설|비속어/)
    assert.equal(await input(a.page).inputValue(), blockedText)
    for (const page of [a.page, b.page]) {
      assert.equal(await page.locator(selectors.text).filter({ hasText: blockedText }).count(), 0)
      assert(!(await trigger(page).innerText()).includes('시발'), 'Rejected text reached the latest-message preview')
    }
    const after = await localRequest('global-chat-ui-b-token', { action: 'read', expanded: true })
    assert.equal(after.revision, before.revision, 'Rejection mutated the public feed')
    assert.equal(after.latest?.id, before.latest?.id)
    assert(after.messages.every(message => message.text !== blockedText), 'Rejected text was persisted in the shared history')
    await a.page.screenshot({ path: path.join(output, 'profanity-rejection-draft.png') })

    const correctedText = '내용을 수정한 정상 채팅입니다 😀'
    await input(a.page).fill(correctedText)
    await alert.waitFor({ state: 'hidden' })
    await sendButton(a.page).click()
    await a.page.waitForFunction(() => document.querySelector('textarea[aria-label="전체 채팅 메시지"]')?.value === '')
    await b.page.evaluate(() => window.dispatchEvent(new Event('online')))
    await b.page.locator(selectors.text).filter({ hasText: correctedText }).waitFor()
    assert.equal(await b.page.locator(selectors.text).filter({ hasText: correctedText }).count(), 1)
    assert.equal(await b.page.locator(selectors.text).filter({ hasText: blockedText }).count(), 0)
    assert.equal((await localRequest('global-chat-ui-b-token', { action: 'read' })).latest?.text, correctedText)
  })
  await test('an earned trainer title renders beside the sender name and an unset one renders nothing', async () => {
    await send(a.page, '칭호가 보이는 메시지')
    await b.page.evaluate(() => window.dispatchEvent(new Event('online')))
    const titled = b.page.locator(selectors.message).filter({ hasText: '칭호가 보이는 메시지' }).last()
    await titled.locator('.global-chat-title-tag').waitFor()
    assert.equal(await titled.locator('.global-chat-title-tag').innerText(), '도감 마스터')
    await send(b.page, '칭호가 없는 메시지')
    await a.page.evaluate(() => window.dispatchEvent(new Event('online')))
    const plain = a.page.locator(selectors.message).filter({ hasText: '칭호가 없는 메시지' }).last()
    await plain.waitFor()
    assert.equal(await plain.locator('.global-chat-title-tag').count(), 0)
    // The tag belongs to the author, not to whoever is reading the room.
    const ownView = a.page.locator(selectors.message).filter({ hasText: '칭호가 보이는 메시지' }).last()
    assert.equal(await ownView.locator('.global-chat-title-tag').innerText(), '도감 마스터')
  })
  await test('message markup stays literal text and never creates executable HTML', async () => {
    const text = '<img src=x onerror="window.__chatXss=1"> & <script>window.__chatXss=1</script>'
    await send(a.page, text)
    await b.page.evaluate(() => window.dispatchEvent(new Event('online')))
    await b.page.locator(selectors.text).filter({ hasText: text }).waitFor()
    assert.equal(await b.page.locator(selectors.messages).locator('img, script, iframe').count(), 0)
    assert.equal(await b.page.evaluate(() => window.__chatXss), undefined)
    assert.equal(await b.page.locator(selectors.text).last().innerText(), text)
  })
  await test('reading older messages preserves scroll position until Latest is chosen', async () => {
    const list = a.page.locator(selectors.messages)
    await list.evaluate(element => { element.scrollTop = 0; element.dispatchEvent(new Event('scroll')) })
    assert(await list.evaluate(element => element.scrollHeight > element.clientHeight + 50))
    await send(b.page, '이전 대화를 읽는 동안 도착한 새 메시지')
    await a.page.evaluate(() => window.dispatchEvent(new Event('online')))
    await a.page.locator(selectors.text).filter({ hasText: '이전 대화를 읽는 동안 도착한 새 메시지' }).waitFor()
    assert(await list.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop > 50), 'New messages pulled the reader to the bottom')
    await a.page.locator('.global-chat-jump').click()
    await a.page.waitForFunction(() => { const e = document.querySelector('.global-chat-messages'); return e && e.scrollHeight - e.clientHeight - e.scrollTop < 5 })
  })
  await test('native dialog excludes background controls and Escape restores the opening button', async () => {
    await expanded(a.page)
    let focusedInside = 0
    for (let n = 0; n < 9; n += 1) {
      await a.page.keyboard.press('Tab')
      const focus = await a.page.evaluate(() => ({ inside: document.querySelector('.global-chat-dialog').contains(document.activeElement), tag: document.activeElement.tagName, html: document.activeElement.outerHTML.slice(0, 300) }))
      // Chromium may expose BODY while keyboard focus passes through browser
      // chrome. Background page controls must still be inert under showModal.
      assert(focus.inside || focus.tag === 'BODY', JSON.stringify({ tab: n, ...focus }))
      if (focus.inside) focusedInside += 1
    }
    assert(focusedInside > 0)
    assert(await a.page.evaluate(() => { const background = document.querySelector('.top-status button'); background.focus(); return document.activeElement !== background }))
    await a.page.getByRole('button', { name: '전체 채팅 닫기', exact: true }).focus()
    await a.page.keyboard.press('Escape')
    await a.page.locator(selectors.dialog).waitFor({ state: 'hidden' })
    assert(await trigger(a.page).evaluate(element => element === document.activeElement))
  })
  await a.context.close(); await b.context.close()
  for (const device of [{ id: 'desktop', viewport: { width: 1920, height: 900 } }, { id: 'laptop', viewport: { width: 1366, height: 768 } }, { id: 'mobile', viewport: { width: 844, height: 390 }, hasTouch: true }]) {
    for (const scale of [1, 2]) {
      const { page, context } = await client('a', device, scale)
      await test(`${device.id} ${scale}x: header and expanded chat controls fit the real app viewport`, async () => {
        await trigger(page).getByText(/이전 대화를 읽는 동안 도착한 새 메시지/).waitFor()
        const closed = await geometry(page)
        metrics.push({ device: device.id, scale, open: false, ...closed }); assertFits(closed)
        await page.screenshot({ path: path.join(output, `${device.id}-${scale}x-header.png`) })
        await expanded(page)
        await page.locator(selectors.message).last().waitFor()
        const open = await geometry(page)
        metrics.push({ device: device.id, scale, open: true, ...open }); assertFits(open)
        await page.screenshot({ path: path.join(output, `${device.id}-${scale}x-chat.png`) })
        await expanded(page, false)
      })
      await context.close()
    }
  }
} finally {
  await browser?.close()
  await server?.close()
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ checks, errors, unexpectedRequests, requests, metrics }, null, 2))
}
assert.equal(errors.length, 0, JSON.stringify(errors))
assert.equal(unexpectedRequests.length, 0, `Unexpected external/API calls: ${JSON.stringify(unexpectedRequests)}`)
assert(checks.every(check => check.passed), 'Global chat UI regression failed')
console.log(`${checks.length}/${checks.length} passed; browser/server errors ${errors.length}; unexpected external/API requests ${unexpectedRequests.length}`)
