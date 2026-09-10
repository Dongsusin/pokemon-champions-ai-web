import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { createBattle, getBattleSummary, playBattleTurnWithActions } from '../src/data/battleEngine.js'
import { BATTLE_ITEMS } from '../src/data/shopData.js'
import { applyBattleAchievements, createAchievementState } from '../src/data/achievementData.js'
import { resolveChromiumExecutable } from '../promo/scripts/browserRuntime.mjs'

// An isolated browser account and intercepted test entry exercise the real app.
// Test hooks exist only in these HTTP responses, never in the production bundle.
const require = createRequire(new URL('../promo/package.json', import.meta.url))
const { chromium } = require(process.env.ACHIEVEMENT_PLAYWRIGHT_MODULE || 'playwright')
const root = fileURLToPath(new URL('../', import.meta.url))
const output = path.join(root, 'scripts/.cache/achievement-ui')
await fs.mkdir(output, { recursive: true })
const styles = ['styles', 'screenRedesign', 'battleGen5', 'titleCleanup', 'battleGimmicks', 'moveAnimationDirector', 'settings', 'auth', 'mobileLandscape']
const qaEntry = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {GameApp} from '/src/App.jsx';
${styles.map(name => `import '/src/${name}.css';`).join('\n')}
createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode, null,
 React.createElement(GameApp, {user:{uid:'achievement-qa',displayName:'업적 검증',isLocalGuest:true},
 onPlayerDataChanged:()=>{window.__saveNotifications=(window.__saveNotifications||0)+1;}})));
`
const server = await createServer({ root,
  plugins: [{ name: 'achievement-qa-entry',
    resolveId: id => id === '/achievement-qa-entry.js' ? id : undefined,
    load: id => id === '/achievement-qa-entry.js' ? qaEntry : undefined,
  }],
  server: { host: '127.0.0.1', port: 5185, strictPort: true, hmr: false }, logLevel: 'error',
})
await server.listen()
const origin = `http://127.0.0.1:${server.httpServer.address().port}`
let browser
try {
  browser = await chromium.launch({ executablePath: await resolveChromiumExecutable(chromium), headless: true })
} catch (error) {
  await server.close()
  throw error
}
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const errors = []
const page = await context.newPage()
page.setDefaultTimeout(20000)
page.on('pageerror', error => errors.push(error.message))
const initialVp = 5000
const speciesIds = [6, 9, 3, 25, 448, 445]
const html = await server.transformIndexHtml('/achievement-qa.html', `<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body><div id="root"></div><script type="module" src="/achievement-qa-entry.js"></script></body></html>`)
async function installHarness(context) {
await context.route('**/achievement-qa.html', route => route.fulfill({ contentType: 'text/html', body: html }))
await context.route('**/src/App.jsx', async route => {
  const response = await route.fetch()
  let body = await response.text()
  assert(body.includes('const trainerInitial ='), 'App test hook anchor changed')
  body = body.replace('const trainerInitial =', `window.__achievementQA = {
    screen, vp, achievementProgress, battleMatch, competition, battleRewards,
    resolvedCompetition: resolvedCompetitionRef.current,
    start: (...args) => startBattleMode(...args), enter: (...args) => startCompetitionBattle(...args),
    settle: (...args) => settleCompetitionBattle(...args), finish: (...args) => finishCompetitionBattle(...args),
    purchase: (...args) => purchaseBattleItem(...args)
  }; const trainerInitial =`) + '\nexport { GameApp };\n'
  await route.fulfill({ response, body })
})
await context.route('**/src/BattleScreen.jsx', async route => {
  const response = await route.fetch()
  let body = await response.text()
  assert(body.includes('const currentLogEntry ='), 'Battle test hook anchor changed')
  body = body.replace('const currentLogEntry =', `window.__achievementBattleQA = { summary,
    replace: value => { setBattle(value); setIntroVisible(false); setTrainerDialogue(null); }
  }; const currentLogEntry =`)
  await route.fulfill({ response, body })
})
await context.addInitScript(({ initialVp, speciesIds }) => {
  if (!sessionStorage.getItem('achievement-qa-seeded')) {
    localStorage.clear()
    localStorage.setItem('champions-dex-v2', JSON.stringify(speciesIds.map(speciesId => ({ speciesId, directDrawCount: 1 }))))
    localStorage.setItem('champions-teams-v1', JSON.stringify({ version: 1, activeTeamId: 'qa-team', teams: [{
      id: 'qa-team', name: '업적 검증팀', pokemonIds: speciesIds.map(id => `dex-${id}`),
    }] }))
    localStorage.setItem('champions-vp-v1', String(initialVp))
    localStorage.setItem('champions-draw-tutorial-v1', 'complete')
    localStorage.setItem('champions-settings-v1', JSON.stringify({ game: { attackAnimation: 'skip', hpBarSpeed: 'instant' }, audio: { enabled: false } }))
    sessionStorage.setItem('achievement-qa-seeded', 'yes')
  }
  const originalSetItem = Storage.prototype.setItem
  Storage.prototype.setItem = function(key, value) {
    if (window.__failAchievementSave && key === 'champions-achievements-v1') throw new DOMException('QA storage failure', 'QuotaExceededError')
    return originalSetItem.call(this, key, value)
  }
}, { initialVp, speciesIds })
}
await installHarness(context)

function completedBattle(opponent) {
  const battle = createBattle({
    playerPokemon: [{ speciesId: 6, captureId: 'dex-6', ability: '맹화', moveIds: ['flamethrower'], moves: ['화염방사'] }],
    opponent,
    opponentTeam: { pokemon: [{ speciesId: 129, captureId: 'qa-magikarp', moveIds: ['splash'], moves: ['튀어오르기'] }], battleGimmicks: [], strategy: {} },
    rules: { weather: { id: 'clear', label: '맑음' }, terrain: { id: 'neutral', label: '일반 필드' }, format: { id: 'single', label: '싱글배틀', activeSlots: 1, actionSlots: 1 }, teamRule: { id: 'full', label: '풀 배틀', battleSize: 1 }, aiDifficulty: { id: 'normal' } },
  })
  battle.opponent.team[0].hp = 1
  const result = playBattleTurnWithActions(battle, [{ type: 'move', moveIndex: 0, actorSlot: 0, targetSlot: 0 }], [], () => .5)
  assert.equal(result.winner, 'player', 'Real battle engine must produce the completed fixture')
  return result
}

async function waitScreen(screen) {
  await page.waitForFunction(value => window.__achievementQA?.screen === value, screen)
}
async function startBattle() {
  await page.evaluate(() => window.__achievementQA.start('league'))
  await waitScreen('competition')
  await page.evaluate(() => window.__achievementQA.enter())
  await waitScreen('battle')
  return page.evaluate(() => window.__achievementQA.battleMatch)
}
async function assertInViewport(selector, targetPage = page) {
  const result = await targetPage.locator(selector).evaluate(element => {
    const rect = element.getBoundingClientRect()
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: innerWidth, height: innerHeight }
  })
  assert(result.left >= -1 && result.right <= result.width + 1 && result.top >= -1 && result.bottom <= result.height + 1, `${selector} is clipped: ${JSON.stringify(result)}`)
}

try {
  console.log(`Browser QA server: ${origin}`)
  await page.goto(`${origin}/achievement-qa.html`, { waitUntil: 'domcontentloaded' })
  await waitScreen('lobby')
  console.log('Browser QA: lobby loaded')
  await assertInViewport('.mode-achievements')
  await page.screenshot({ path: path.join(output, 'lobby-desktop.png') })
  await page.getByRole('button', { name: '업적 보기', exact: true }).click()
  await waitScreen('achievements')
  assert.equal(await page.locator('.achievement-card').count(), 12)
  assert.match(await page.locator('.achievement-overview').innerText(), /273/)
  await page.getByRole('button', { name: '달성 완료', exact: true }).click()
  assert.equal(await page.locator('.achievement-empty').count(), 1)
  await page.getByRole('button', { name: '전체 업적 보기', exact: false }).click()
  await page.getByRole('button', { name: /AI 첫 승리/ }).click()
  assert.match(await page.locator('.achievement-pagination').innerText(), /238/)
  await page.getByRole('button', { name: '다음 업적 페이지' }).click()
  assert.match(await page.locator('.achievement-pagination').innerText(), /13–24/)
  await page.getByRole('searchbox', { name: '업적 또는 트레이너 검색' }).fill('난천')
  assert((await page.locator('.achievement-card').count()) > 0)
  assert.match(await page.locator('.achievement-grid').innerText(), /난천/)
  // A shipped local portrait makes rendering validation independent of the
  // external sprite host's availability; name search is checked separately.
  await page.getByRole('searchbox', { name: '업적 또는 트레이너 검색' }).fill('택트')
  await page.waitForFunction(() => document.querySelector('.achievement-trainer-sprite img')?.naturalWidth > 0)
  await page.screenshot({ path: path.join(output, 'trainers-desktop.png') })
  await page.getByRole('button', { name: '돌아가기', exact: true }).click()

  const match = await startBattle()
  const battle = completedBattle(match.opponent)
  const summary = getBattleSummary(battle)
  const expected = applyBattleAchievements(createAchievementState(), { battleId: match.id, summary, opponent: match.opponent })
  const paidVp = initialVp + 100 + expected.rewardVp
  await page.evaluate(value => window.__achievementBattleQA.replace(value), battle)
  await page.waitForFunction(value => window.__achievementQA.vp === value, paidVp)
  await page.locator('.achievement-battle-rewards').waitFor()
  assert.equal(await page.locator('.achievement-battle-rewards li').count(), expected.unlocked.length)
  const beforeDuplicate = await page.evaluate(() => JSON.stringify(window.__achievementQA.achievementProgress))
  await page.evaluate(value => { window.__achievementQA.settle(value); window.__achievementQA.settle(value) }, summary)
  assert.equal(await page.evaluate(() => window.__achievementQA.vp), paidVp)
  assert.equal(await page.evaluate(() => JSON.stringify(window.__achievementQA.achievementProgress)), beforeDuplicate)
  await assertInViewport('.battle-result-overlay > button')
  await page.screenshot({ path: path.join(output, 'rewards-desktop.png') })
  await page.setViewportSize({ width: 844, height: 390 })
  await assertInViewport('.battle-result-overlay > button')
  await page.screenshot({ path: path.join(output, 'rewards-landscape.png') })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByRole('button', { name: '배틀 마치기', exact: false }).click()
  await waitScreen('competition')
  const round = await page.evaluate(() => window.__achievementQA.competition.round)
  await page.evaluate(value => { window.__achievementQA.finish(value); window.__achievementQA.finish(value) }, summary)
  assert.equal(await page.evaluate(() => window.__achievementQA.competition.round), round)
  await page.getByRole('button', { name: '업적 보기', exact: true }).click()
  await page.getByRole('button', { name: '달성 완료', exact: true }).click()
  assert.equal(await page.locator('.achievement-is-complete').count(), expected.unlocked.length)
  await page.screenshot({ path: path.join(output, 'achievements-desktop.png') })
  await page.setViewportSize({ width: 844, height: 390 })
  await assertInViewport('.achievement-pagination')
  await assertInViewport('.achievement-catalog')
  assert((await page.locator('.achievement-catalog-scroll').evaluate(el => el.clientHeight)) >= 120)
  await page.screenshot({ path: path.join(output, 'achievements-landscape.png') })
  await page.getByRole('button', { name: '돌아가기', exact: true }).click()
  await waitScreen('competition')

  await page.reload()
  await waitScreen('lobby')
  assert.equal(await page.evaluate(() => window.__achievementQA.vp), paidVp)
  assert.equal(await page.evaluate(() => Object.keys(window.__achievementQA.achievementProgress.unlocked).length), expected.unlocked.length)
  const item = BATTLE_ITEMS.find(entry => entry.price > 0 && entry.price < paidVp)
  await page.evaluate(id => window.__achievementQA.purchase(id), item.id)
  await page.waitForFunction(value => window.__achievementQA.vp === value, paidVp - item.price)
  await page.reload()
  await waitScreen('lobby')
  assert.equal(await page.evaluate(() => window.__achievementQA.vp), paidVp - item.price, 'Spending must update canonical wallet across reload')

  // Failed writes must preserve both rewards and randomized AI competition results.
  const retryMatch = await startBattle()
  const retryBattle = completedBattle(retryMatch.opponent)
  const retrySummary = getBattleSummary(retryBattle)
  const balanceBeforeFailure = await page.evaluate(() => window.__achievementQA.vp)
  await page.evaluate(value => { window.__failAchievementSave = true; window.__achievementBattleQA.replace(value) }, retryBattle)
  await page.waitForFunction(() => window.__achievementQA.resolvedCompetition !== null)
  const resolvedBeforeRetry = await page.evaluate(() => JSON.stringify(window.__achievementQA.resolvedCompetition.nextCompetition))
  assert.equal(await page.evaluate(() => window.__achievementQA.vp), balanceBeforeFailure)
  assert.equal(await page.locator('.achievement-battle-rewards').count(), 0)
  await page.evaluate(() => { window.__failAchievementSave = false })
  await page.getByRole('button', { name: '배틀 마치기', exact: false }).click()
  await waitScreen('competition')
  assert.equal(await page.evaluate(() => JSON.stringify(window.__achievementQA.battleRewards.nextCompetition)), resolvedBeforeRetry)
  const afterRetry = await page.evaluate(() => window.__achievementQA.vp)
  assert(afterRetry >= balanceBeforeFailure + 100)
  await page.evaluate(value => window.__achievementQA.settle(value), retrySummary)
  assert.equal(await page.evaluate(() => window.__achievementQA.vp), afterRetry)

  const mobileContext = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true })
  await installHarness(mobileContext)
  const mobile = await mobileContext.newPage()
  mobile.on('pageerror', error => errors.push(error.message))
  await mobile.goto(`${origin}/achievement-qa.html`, { waitUntil: 'domcontentloaded' })
  await mobile.waitForFunction(() => window.__achievementQA?.screen === 'lobby')
  await mobile.getByRole('button', { name: '업적 보기', exact: true }).click()
  await mobile.locator('.achievement-catalog').waitFor()
  await assertInViewport('.achievement-pagination', mobile)
  assert.equal(await mobile.locator('.achievement-grid').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length), 3)
  assert((await mobile.locator('.achievement-card-description').first().evaluate(el => parseFloat(getComputedStyle(el).fontSize))) >= 16)
  await mobile.screenshot({ path: path.join(output, 'achievements-touch-landscape.png') })
  await mobile.getByRole('button', { name: '돌아가기', exact: true }).click()
  await mobile.evaluate(() => window.__achievementQA.start('league'))
  await mobile.waitForFunction(() => window.__achievementQA.screen === 'competition')
  await mobile.evaluate(() => window.__achievementQA.enter())
  await mobile.waitForFunction(() => window.__achievementQA.screen === 'battle')
  const mobileOpponent = await mobile.evaluate(() => window.__achievementQA.battleMatch.opponent)
  await mobile.evaluate(value => window.__achievementBattleQA.replace(value), completedBattle(mobileOpponent))
  await mobile.locator('.achievement-battle-rewards').waitFor()
  await assertInViewport('.battle-result-overlay > button', mobile)
  await mobile.screenshot({ path: path.join(output, 'rewards-touch-landscape.png') })
  await mobileContext.close()
  assert.deepEqual(errors, [], 'Browser must not emit runtime errors')
  console.log('Achievement UI passed: catalog/search/paging, real completed battle callback, all rewards, duplicate settlement/finish, mobile layout, reload/spending, failed-write retry without AI reroll.')
  console.log(`Screenshots: ${output}`)
} catch (error) {
  console.error('Browser errors:', errors)
  console.error('Page state:', await page.locator('body').innerText().catch(() => 'Unavailable'))
  await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {})
  throw error
} finally {
  await browser.close()
  await server.close()
}
