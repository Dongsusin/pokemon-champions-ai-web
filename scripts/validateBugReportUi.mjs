import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { resolveChromiumExecutable } from '../promo/scripts/browserRuntime.mjs'
import { createBugReportHandler } from '../server/bugReports.js'

// Run the real game/settings form against intercepted API outcomes. All hooks
// exist only in local test HTTP responses; this test cannot send a real email.
const require = createRequire(new URL('../promo/package.json', import.meta.url))
const { chromium } = require(process.env.BUG_REPORT_PLAYWRIGHT_MODULE || 'playwright')
const root = fileURLToPath(new URL('../', import.meta.url))
const output = path.join(root, 'scripts/.cache/bug-report-ui')
await fs.mkdir(output, { recursive: true })
const styles = ['styles', 'screenRedesign', 'battleGen5', 'titleCleanup', 'battleGimmicks', 'moveAnimationDirector', 'settings', 'auth', 'mobileLandscape']
const entry = `import '/src/mobileViewport.js';
import React from 'react'; import {createRoot} from 'react-dom/client';
import {GameApp} from '/src/App.jsx';
${styles.map(name => `import '/src/${name}.css';`).join('\n')}
createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,
 React.createElement(GameApp,{user:{uid:'secret-account-identifier',displayName:'신고 검증',email:'reporter@example.com',isLocalGuest:true}})));
`
const serverRequests = []
let deliveryCalls = 0
const localHandler = createBugReportHandler({
  env: { BUG_REPORT_ENABLED: 'true', BUG_REPORT_PROVIDER: 'formsubmit', BUG_REPORT_TO: 'qa@example.com' },
  fetch: async () => {
    deliveryCalls += 1
    return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } })
  },
})
const server = await createServer({ root, plugins: [{ name: 'bug-report-ui-entry',
  resolveId: id => id === '/bug-report-ui-entry.js' ? id : undefined,
  load: id => id === '/bug-report-ui-entry.js' ? entry : undefined,
  configureServer(vite) {
    vite.middlewares.use((req, res, next) => {
      if (req.url !== '/api/bug-report-origin-check') return next()
      serverRequests.push({ method: req.method, origin: req.headers.origin, referer: req.headers.referer })
      localHandler(req, res)
    })
  },
}], server: { host: '127.0.0.1', port: 5201, strictPort: true, hmr: false }, logLevel: 'error' })
let browser, page
const errors = []
const results = []
const origin = 'http://127.0.0.1:5201'
const requests = []
const availabilityRequests = []
let availability = { status: 200, body: { enabled: true } }
let nextPost = Promise.resolve({ status: 200, body: { ok: true, reportId: 'BR-UI-DEFAULT' } })
const deferred = () => { let resolve; const promise = new Promise(accept => { resolve = accept }); return { promise, resolve } }
const respond = (status, body) => ({ status, body })
async function waitForCount(list, count) {
  const start = Date.now()
  while (list.length < count && Date.now() - start < 5000) await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(list.length, count, `Expected ${count} requests, received ${list.length}`)
}
const field = (name, target = page) => target.locator(`.bug-report-form [name="${name}"]`)
const submit = (target = page) => target.getByRole('button', { name: '버그 신고 보내기', exact: true })
async function visibleBounds(locator, target = page) {
  await locator.scrollIntoViewIfNeeded()
  const bounds = await locator.boundingBox()
  // The actual mobile entry scales a 1440px layout. Bounding boxes are CSS
  // pixels, so compare with the visual viewport rather than device pixels.
  const viewport = await target.evaluate(() => ({
    width: visualViewport?.width || innerWidth, height: visualViewport?.height || innerHeight,
    left: visualViewport?.offsetLeft || 0, top: visualViewport?.offsetTop || 0,
  }))
  const name = await locator.getAttribute('name') || await locator.innerText()
  const visible = bounds && bounds.x >= viewport.left - 1 && bounds.y >= viewport.top - 1 && bounds.x + bounds.width <= viewport.left + viewport.width + 1 && bounds.y + bounds.height <= viewport.top + viewport.height + 1
  if (!visible) await target.screenshot({ path: path.join(output, 'clipped-control.png') })
  assert(visible, `Control must remain reachable: ${JSON.stringify({ name, bounds, viewport })}`)
}
async function openReport(target = page, inBattle = false) {
  await target.getByRole('button', { name: inBattle ? '환경 설정' : '설정', exact: true }).click()
  await target.getByRole('tab', { name: '버그 신고', exact: true }).click()
  await target.locator('#settings-bug-report-panel:not([hidden])').waitFor()
  await target.waitForFunction(() => !document.querySelector('.bug-report-form') || !document.querySelector('.bug-report-submit')?.textContent.includes('연결 확인 중'))
}
async function validDraft(target = page, title = '더블배틀 기술 선택 오류') {
  await field('title', target).fill(title)
  await field('description', target).fill('더블배틀에서 포켓몬을 교대한 뒤 기술 버튼을 눌러도 다음 선택으로 넘어가지 않습니다.')
}
async function installHarness(context, html) {
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.fallback() : route.abort())
  await context.route('**/bug-report-ui.html*', route => route.fulfill({ contentType: 'text/html', body: html }))
  await context.route('**/src/App.jsx', async route => {
    const response = await route.fetch()
    let body = await response.text()
    assert(body.includes('const trainerInitial ='), 'GameApp test hook anchor changed')
    body = body.replace('const trainerInitial =', `window.__bugReportQA = { screen, vp, boxPokemon, battleMatch,
      start: mode => startBattleMode(mode), enter: () => startCompetitionBattle()
    }; const trainerInitial =`) + '\nexport {GameApp};\n'
    await route.fulfill({ response, body })
  })
  await context.route('**/src/BattleScreen.jsx', async route => {
    const response = await route.fetch()
    let body = await response.text()
    assert(body.includes('const currentLogEntry ='), 'BattleScreen test hook anchor changed')
    body = body.replace('const currentLogEntry =', `window.__bugBattleQA = {state:battle, instance:battleAudioRef.current,
      dismissIntro:()=>{setIntroVisible(false);setTrainerDialogue(null);}}; const currentLogEntry =`)
    await route.fulfill({ response, body })
  })
  await context.route('**/api/bug-report', async route => {
    const request = route.request()
    if (request.method() === 'GET') {
      availabilityRequests.push(request.url())
      const outcome = availability
      await route.fulfill({ status: outcome.status, contentType: 'application/json', body: JSON.stringify(outcome.body) })
      return
    }
    assert.equal(request.method(), 'POST')
    requests.push({ body: request.postDataJSON(), headers: await request.allHeaders() })
    const outcome = await nextPost
    await route.fulfill({ status: outcome.status, contentType: 'application/json', body: JSON.stringify(outcome.body) }).catch(() => {})
  })
  await context.addCookies([{ name: 'secret-auth-cookie', value: 'secret-cookie-value', url: origin }])
  await context.addInitScript(() => {
    if (sessionStorage.getItem('bug-report-qa-seeded')) return
    const collection = [6, 9, 3, 25, 448, 445].map(speciesId => ({ speciesId, directDrawCount: 1 }))
    localStorage.setItem('champions-dex-v2', JSON.stringify(collection))
    localStorage.setItem('champions-teams-v1', JSON.stringify({ version: 1, activeTeamId: 'qa-team', teams: [{ id: 'qa-team', name: '검증팀', pokemonIds: collection.map(({ speciesId }) => `dex-${speciesId}`) }] }))
    localStorage.setItem('champions-vp-v1', '5000')
    localStorage.setItem('champions-draw-tutorial-v1', 'complete')
    localStorage.setItem('champions-settings-v1', JSON.stringify({ game: { attackAnimation: 'skip', hpBarSpeed: 'instant' }, audio: { enabled: false } }))
    localStorage.setItem('secret-token', 'secret-local-storage-value')
    sessionStorage.setItem('secret-session-token', 'secret-session-storage-value')
    sessionStorage.setItem('bug-report-qa-seeded', 'yes')
  })
}

try {
  await server.listen()
  const html = await server.transformIndexHtml('/bug-report-ui.html', '<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/bug-report-ui-entry.js"></script></body></html>')
  browser = await chromium.launch({ executablePath: await resolveChromiumExecutable(chromium), headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await installHarness(context, html)
  page = await context.newPage()
  page.setDefaultTimeout(15000)
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`${origin}/bug-report-ui.html?token=secret-query-value#secret-fragment-value`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__bugReportQA?.screen === 'lobby')
  const actualHandlerResult = await page.evaluate(async () => {
    const client = await import('/src/bugReportClient.js')
    const originalFetch = window.fetch
    window.fetch = (input, options) => originalFetch(input === '/api/bug-report' ? '/api/bug-report-origin-check' : input, options)
    try {
      const enabled = await client.getBugReportAvailability()
      const draft = client.createBugReportDraft()
      draft.title = '로컬 서버 브라우저 연동 검증'
      draft.description = '실제 수신함에 전달하지 않는 로컬 메일 전송 모킹입니다.'
      const result = await client.sendBugReport(client.makeBugReportPayload(draft, { screen: 'lobby' }))
      return { enabled, ...result }
    } catch (error) { return { error: error.message, code: error.code } }
    finally { window.fetch = originalFetch }
  })
  assert.equal(actualHandlerResult.ok, true, `Actual browser/client/server origin validation failed: ${JSON.stringify({ actualHandlerResult, serverRequests })}`)
  assert.equal(actualHandlerResult.enabled, true)
  assert.equal(deliveryCalls, 1, 'Only the injected local mail fetch may run')
  assert.equal(serverRequests.find(request => request.method === 'POST').origin, origin)
  results.push('Actual browser client GET/POST reaches the real local server handler with an accepted Origin; delivery is replaced by an injected mock')
  const savedBefore = await page.evaluate(() => ({ vp: window.__bugReportQA.vp, collection: JSON.stringify(window.__bugReportQA.boxPokemon) }))
  await page.getByRole('button', { name: '설정', exact: true }).click()
  await page.getByRole('tab', { name: '게임', exact: true }).focus()
  await page.keyboard.press('End')
  await field('title').waitFor()
  await submit().waitFor()
  assert.equal(await page.getByRole('tab', { name: '버그 신고', exact: true }).getAttribute('aria-selected'), 'true')
  assert.equal(await field('replyTo').inputValue(), 'reporter@example.com')
  await submit().click()
  assert.equal(await field('title').getAttribute('aria-invalid'), 'true')
  assert.equal(await field('title').evaluate(element => document.activeElement === element), true)
  await field('title').fill('선택 오류')
  await field('description').fill('짧음')
  await submit().click()
  assert.equal(await field('description').getAttribute('aria-invalid'), 'true')
  assert.equal(await field('description').evaluate(element => document.activeElement === element), true)
  await validDraft()
  await field('replyTo').fill('invalid-email')
  await submit().click()
  assert.equal(await field('replyTo').getAttribute('aria-invalid'), 'true')
  assert.equal(requests.length, 0, 'Invalid forms must not reach the API')
  await field('replyTo').fill('reply@example.com')
  await field('category').selectOption('display')
  await field('steps').fill('1. 더블배틀 시작\n2. 포켓몬 교대\n3. 기술 선택')
  await field('expected').fill('다음 포켓몬의 기술을 선택할 수 있어야 합니다.')
  await page.getByRole('tab', { name: '오디오', exact: true }).click()
  await page.getByRole('tab', { name: '버그 신고', exact: true }).click()
  assert.equal(await field('title').inputValue(), '더블배틀 기술 선택 오류')
  assert.equal(await field('steps').inputValue(), '1. 더블배틀 시작\n2. 포켓몬 교대\n3. 기술 선택')
  await field('replyTo').focus()
  await page.keyboard.press('Tab')
  assert.equal(await page.evaluate(() => document.activeElement.type), 'checkbox')
  await page.keyboard.press('Tab')
  assert.equal(await submit().evaluate(element => document.activeElement === element), true, 'Honeypot must not receive keyboard focus')
  await visibleBounds(submit())
  await page.screenshot({ path: path.join(output, 'draft-desktop.png') })
  results.push('Required fields, length/email validation, focused errors, keyboard tab navigation and draft preservation across settings tabs')

  const failedSend = deferred()
  nextPost = failedSend.promise
  await submit().click({ clickCount: 2 })
  await waitForCount(requests, 1)
  assert.equal(await page.locator('.bug-report-submit').isDisabled(), true)
  assert.equal(await field('title').isDisabled(), true)
  await page.getByRole('tab', { name: '오디오', exact: true }).click()
  await page.getByRole('tab', { name: '버그 신고', exact: true }).click()
  assert.equal(await page.locator('.bug-report-submit').isDisabled(), true)
  assert.equal(requests.length, 1, 'Double clicking and tab switching must not duplicate a pending report')
  failedSend.resolve(respond(502, { ok: false, code: 'DELIVERY_FAILED', error: '테스트 메일 전송이 실패했습니다. 작성 내용은 유지됩니다.' }))
  await page.getByRole('alert').filter({ hasText: '테스트 메일 전송이 실패했습니다' }).waitFor()
  assert.equal(await field('title').inputValue(), '더블배틀 기술 선택 오류')
  nextPost = Promise.resolve(respond(200, { ok: true, reportId: 'BR-UI-RETRY' }))
  await submit().click()
  await page.getByRole('heading', { name: '버그 신고를 보냈습니다', exact: true }).waitFor()
  await waitForCount(requests, 2)
  assert.deepEqual(requests[1].body, requests[0].body, 'Unchanged retry must reuse the complete payload and idempotency UUID')
  assert.match(requests[0].body.requestId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  assert.equal(requests[0].body.diagnostics.page, '/bug-report-ui.html')
  assert.equal(requests[0].body.diagnostics.screen, 'lobby')
  assert.deepEqual(Object.keys(requests[0].body.diagnostics).sort(), ['language', 'page', 'screen', 'userAgent', 'viewport'])
  for (const request of requests) {
    const content = JSON.stringify(request)
    for (const secret of ['secret-query-value', 'secret-fragment-value', 'secret-account-identifier', 'secret-local-storage-value', 'secret-session-storage-value', 'secret-cookie-value', 'champions-dex-v2']) assert(!content.includes(secret), `Private context leaked: ${secret}`)
    assert(!request.headers.authorization && !request.headers.cookie && !request.headers.referer, 'Reports must omit authentication, cookies and referrer URL')
  }
  assert.equal(await page.locator('.bug-report-success').evaluate(element => document.activeElement === element), true)
  await page.screenshot({ path: path.join(output, 'success-desktop.png') })
  results.push('Single in-flight submission, failed-send draft retention, identical UUID retry, success focus and diagnostics excluding URL query/hash, account data, browser storage and credentials')

  await page.getByRole('button', { name: '새 신고 작성', exact: true }).click()
  assert.equal(await field('title').inputValue(), '')
  assert.equal(await field('description').inputValue(), '')
  assert.equal(await field('replyTo').inputValue(), 'reply@example.com')
  await validDraft(page, '진단 정보 없이 신고')
  await field('replyTo').fill('')
  await page.getByRole('checkbox', { name: /브라우저·현재 화면 정보 함께 보내기/ }).uncheck()
  nextPost = Promise.resolve(respond(200, { ok: true, reportId: 'BR-UI-NO-DIAGNOSTICS' }))
  await submit().click()
  await page.getByRole('heading', { name: '버그 신고를 보냈습니다', exact: true }).waitFor()
  await waitForCount(requests, 3)
  assert.equal(requests[2].body.diagnostics, null)
  assert.equal(requests[2].body.replyTo, '')
  assert.notEqual(requests[2].body.requestId, requests[1].body.requestId)
  results.push('New report resets fields, receives a new UUID, and permits omitted diagnostics and reply email')

  await page.getByRole('button', { name: '설정 닫기', exact: true }).click()
  availability = respond(200, { enabled: false })
  await openReport()
  await page.getByRole('status').filter({ hasText: '버그 신고 메일 서비스를 준비 중입니다' }).waitFor()
  await validDraft(page, '메일 연결 대기 중 초안')
  assert.equal(await submit().isDisabled(), true)
  assert.equal(requests.length, 3)
  availability = respond(200, { enabled: true })
  await page.getByRole('button', { name: '연결 재확인', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('.bug-report-submit')?.disabled)
  assert.equal(await field('title').inputValue(), '메일 연결 대기 중 초안')
  results.push('Disabled service honestly blocks sending while preserving editable drafts; explicit availability retry enables the same draft')

  const staleSend = deferred()
  nextPost = staleSend.promise
  await submit().click()
  await waitForCount(requests, 4)
  await page.keyboard.press('Escape')
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  await openReport()
  assert.equal(await field('title').inputValue(), '', 'Closing settings intentionally discards its draft as the UI states')
  await validDraft(page, '다시 연 설정의 새 신고')
  staleSend.resolve(respond(200, { ok: true, reportId: 'BR-STALE-MUST-NOT-SHOW' }))
  await page.waitForTimeout(100)
  assert.equal(await field('title').inputValue(), '다시 연 설정의 새 신고')
  assert.equal(await page.getByText('BR-STALE-MUST-NOT-SHOW', { exact: true }).count(), 0)
  nextPost = Promise.resolve(respond(503, { ok: false, code: 'NOT_CONFIGURED', error: '메일 서비스 연결이 필요합니다.' }))
  await submit().click()
  await waitForCount(requests, 5)
  await page.getByRole('alert').filter({ hasText: '메일 서비스 연결이 필요합니다.' }).waitFor()
  assert.equal(await submit().isDisabled(), true)
  assert.equal(await field('title').inputValue(), '다시 연 설정의 새 신고')
  results.push('Closing aborts an in-flight request and stale responses cannot overwrite a reopened form; server configuration failure retains the draft')

  await page.getByRole('button', { name: '설정 닫기', exact: true }).click()
  availability = respond(503, { error: 'Temporary availability check failure' })
  await openReport()
  await page.getByRole('status').filter({ hasText: '서버 연결 상태를 확인하지 못했습니다' }).waitFor()
  await validDraft(page, '상태 확인 실패 후 직접 신고')
  nextPost = Promise.resolve(respond(200, { ok: true, reportId: 'BR-UI-UNKNOWN-RECOVERED' }))
  await submit().click()
  await page.getByRole('heading', { name: '버그 신고를 보냈습니다', exact: true }).waitFor()
  await waitForCount(requests, 6)
  results.push('A failed availability request reports uncertainty and permits a successful actual send')
  await page.getByRole('button', { name: '설정 닫기', exact: true }).click()
  availability = respond(200, { enabled: true })
  await page.evaluate(() => window.__bugReportQA.start('league'))
  await page.waitForFunction(() => window.__bugReportQA.screen === 'competition')
  await page.evaluate(() => window.__bugReportQA.enter())
  await page.waitForFunction(() => window.__bugReportQA.screen === 'battle' && !!window.__bugBattleQA)
  await page.evaluate(() => { window.__bugBattleQA.dismissIntro(); window.__battleBeforeReport = window.__bugBattleQA.instance; window.__battleStateBeforeReport = JSON.stringify(window.__bugBattleQA.state) })
  await openReport(page, true)
  await validDraft(page, '진행 중 배틀 신고')
  await page.getByRole('tab', { name: '게임', exact: true }).click()
  await page.getByRole('tab', { name: '버그 신고', exact: true }).click()
  nextPost = Promise.resolve(respond(200, { ok: true, reportId: 'BR-UI-BATTLE' }))
  await submit().click()
  await page.getByRole('heading', { name: '버그 신고를 보냈습니다', exact: true }).waitFor()
  await waitForCount(requests, 7)
  assert.equal(requests[6].body.diagnostics.screen, 'battle')
  assert.equal(await page.evaluate(() => window.__battleBeforeReport === window.__bugBattleQA.instance && window.__battleStateBeforeReport === JSON.stringify(window.__bugBattleQA.state)), true, 'Reporting must not remount or alter the active battle')
  await page.getByRole('button', { name: '설정 닫기', exact: true }).click()
  assert.equal(await page.evaluate(() => window.__battleBeforeReport === window.__bugBattleQA.instance), true)
  assert.deepEqual(await page.evaluate(() => ({ vp: window.__bugReportQA.vp, collection: JSON.stringify(window.__bugReportQA.boxPokemon) })), savedBefore)
  results.push('Actual active battle survives settings/tab navigation and report submission without remount, turn mutation or account data changes')

  const mobileContext = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true })
  await installHarness(mobileContext, html)
  const mobile = await mobileContext.newPage()
  mobile.on('pageerror', error => errors.push(error.message))
  await mobile.goto(`${origin}/bug-report-ui.html`, { waitUntil: 'domcontentloaded' })
  await mobile.waitForFunction(() => window.__bugReportQA?.screen === 'lobby')
  await openReport(mobile)
  const modal = mobile.getByRole('dialog')
  assert.equal(await modal.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true, 'Landscape dialog must not overflow horizontally')
  await validDraft(mobile, '모바일 가로 화면 신고')
  for (const name of ['title', 'category', 'description', 'steps', 'expected', 'replyTo']) await visibleBounds(field(name, mobile), mobile)
  await visibleBounds(submit(mobile), mobile)
  await mobile.screenshot({ path: path.join(output, 'draft-touch-landscape.png') })
  await submit(mobile).focus()
  await mobile.keyboard.press('Tab')
  assert.equal(await mobile.getByRole('button', { name: '완료', exact: true }).evaluate(element => document.activeElement === element), true)
  await mobile.keyboard.press('Tab')
  assert.equal(await mobile.getByRole('button', { name: '설정 닫기', exact: true }).evaluate(element => document.activeElement === element), true, 'Keyboard focus must wrap within the modal')
  await mobile.keyboard.press('Shift+Tab')
  assert.equal(await mobile.getByRole('button', { name: '완료', exact: true }).evaluate(element => document.activeElement === element), true)
  await mobile.keyboard.press('Shift+Tab')
  assert.equal(await submit(mobile).evaluate(element => document.activeElement === element), true)
  nextPost = Promise.resolve(respond(200, { ok: true, reportId: 'BR-UI-MOBILE' }))
  await submit(mobile).click()
  await mobile.getByRole('heading', { name: '버그 신고를 보냈습니다', exact: true }).waitFor()
  await waitForCount(requests, 8)
  await visibleBounds(mobile.getByRole('button', { name: '새 신고 작성', exact: true }), mobile)
  await mobile.screenshot({ path: path.join(output, 'success-touch-landscape.png') })
  results.push('844×390 touch landscape fields, scrollable submit/success actions, no horizontal overflow and trapped keyboard focus')
  await mobileContext.close()
  assert.deepEqual(errors, [], 'The browser must not emit runtime errors')
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ passed: results, mockedPostRequests: requests.length, availabilityRequests: availabilityRequests.length, actualLocalServer: { requests: serverRequests, mockedDeliveries: deliveryCalls }, runtimeErrors: errors, realEmailsSent: 0 }, null, 2))
  console.log(`Bug report UI passed: ${results.length} scenario groups, ${requests.length} intercepted submissions, desktop and touch landscape, no real email sent.\n${results.map(result => `- ${result}`).join('\n')}\nEvidence: ${output}`)
} catch (error) {
  console.error('Browser errors:', errors)
  console.error('Visible page:', await page?.locator('body').innerText().catch(() => 'Unavailable'))
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {})
  throw error
} finally {
  await browser?.close()
  await server.close()
}
