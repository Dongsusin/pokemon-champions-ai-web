import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { createBattle, getBattleSummary, playBattleTurnWithActions } from '../src/data/battleEngine.js'
import { BATTLE_ITEMS } from '../src/data/shopData.js'
import { ACHIEVEMENTS, ACHIEVABLE_SPECIES_IDS, applyBattleAchievements, createAchievementState } from '../src/data/achievementData.js'
import { getRareReward, POKEMON_SKINS } from '../src/data/rareRewards.js'
import { AI_BATTLE_VP_REWARDS } from '../src/data/aiBattleRewards.js'
import { resolveChromiumExecutable } from '../promo/scripts/browserRuntime.mjs'

// An isolated browser account and intercepted test entry exercise the real app.
// Test hooks exist only in these HTTP responses, never in the production bundle.
const require = createRequire(new URL('../promo/package.json', import.meta.url))
const { chromium } = require(process.env.ACHIEVEMENT_PLAYWRIGHT_MODULE || 'playwright')
const root = fileURLToPath(new URL('../', import.meta.url))
const output = path.join(root, 'scripts/.cache/achievement-ui')
await fs.mkdir(output, { recursive: true })
const styles = ['styles', 'screenRedesign', 'battleGen5', 'titleCleanup', 'battleGimmicks', 'moveAnimationDirector', 'settings', 'auth', 'mobileLandscape', 'mobileTouch', 'mobileUiV2', 'mobileReferenceLayout']
const qaEntry = `
import '/src/mobileViewport.js';
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
async function installHarness(context, seed = {}) {
await context.route('**/achievement-qa.html', route => route.fulfill({ contentType: 'text/html', body: html }))
await context.route('**/src/App.jsx', async route => {
  const response = await route.fetch()
  let body = await response.text()
  assert(body.includes('const trainerInitial ='), 'App test hook anchor changed')
  body = body.replace('const trainerInitial =', `window.__achievementQA = {
    screen, vp, achievementProgress, battleMatch, competition, battleRewards, boxPokemon, itemInventory, achievementToasts, teams,
    resolvedCompetition: resolvedCompetitionRef.current,
    start: (...args) => startBattleMode(...args), enter: (...args) => startCompetitionBattle(...args),
    settle: (...args) => settleCompetitionBattle(...args), finish: (...args) => finishCompetitionBattle(...args),
    purchase: (...args) => purchaseBattleItem(...args), open: id => selectMode({id}),
    replaceCollection: value => setBoxPokemon(value)
  }; window.__firstAchievementRender ??= {
    pokemon: boxPokemon.map(({speciesId,skinId,heldItemId,captureId})=>({speciesId,skinId,heldItemId,captureId})),
    inventory: {...itemInventory}, vp
  }; const trainerInitial =`)
  await route.fulfill({ response, body })
})
await context.route('**/src/BattleScreen.jsx', async route => {
  const response = await route.fetch()
  let body = await response.text()
  assert(body.includes('const currentLogEntry ='), 'Battle test hook anchor changed')
  body = body.replace('const currentLogEntry =', `window.__achievementBattleQA = { summary, state:battle, instance:battleAudioRef.current,
    replace: value => { setBattle(value); setIntroVisible(false); setTrainerDialogue(null); }
  }; const currentLogEntry =`)
  await route.fulfill({ response, body })
})
await context.addInitScript(({ initialVp, speciesIds, seed }) => {
  if (!sessionStorage.getItem('achievement-qa-seeded')) {
    localStorage.clear()
    const collection = seed.collection ?? speciesIds.map(speciesId => ({ speciesId, directDrawCount: 1 }))
    localStorage.setItem('champions-dex-v2', JSON.stringify(collection))
    localStorage.setItem('champions-teams-v1', JSON.stringify({ version: 1, activeTeamId: 'qa-team', teams: [{
      id: 'qa-team', name: '업적 검증팀', pokemonIds: collection.slice(0, 6).map(entry => `dex-${entry.speciesId}`),
    }] }))
    localStorage.setItem('champions-vp-v1', String(seed.balance ?? initialVp))
    if (seed.progress) localStorage.setItem('champions-achievements-v1', JSON.stringify({ ...seed.progress, walletBalance: seed.balance ?? initialVp }))
    if (seed.inventory) localStorage.setItem('champions-battle-items-v1', JSON.stringify(seed.inventory))
    localStorage.setItem('champions-draw-tutorial-v1', 'complete')
    localStorage.setItem('champions-settings-v1', JSON.stringify({ game: { attackAnimation: 'skip', hpBarSpeed: 'instant' }, audio: { enabled: false } }))
    sessionStorage.setItem('achievement-qa-seeded', 'yes')
  }
  const originalSetItem = Storage.prototype.setItem
  window.__boxMirrorWrites = []
  Storage.prototype.setItem = function(key, value) {
    if (window.__failAchievementSave && key === 'champions-achievements-v1') throw new DOMException('QA storage failure', 'QuotaExceededError')
    if (key === 'champions-dex-v2') window.__boxMirrorWrites.push(JSON.parse(value).map(({speciesId,skinId,heldItemId,captureId})=>({speciesId,skinId,heldItemId,captureId})))
    return originalSetItem.call(this, key, value)
  }
}, { initialVp, speciesIds, seed })
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

async function waitScreen(screen, targetPage = page) {
  await targetPage.waitForFunction(value => window.__achievementQA?.screen === value, screen)
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

const secretAchievements = ACHIEVEMENTS.filter(entry => entry.secretReward)

async function validateSealedRewards(targetPage) {
  for (const definition of secretAchievements) {
    await targetPage.getByRole('searchbox', { name: '업적 또는 트레이너 검색' }).fill(definition.title)
    const card = targetPage.locator('.achievement-card').filter({ has: targetPage.getByRole('heading', { name: definition.title, exact: true }) })
    assert.equal(await card.count(), 1)
    assert.equal(await card.locator('.achievement-sealed-reward').count(), 1)
    assert.equal((await card.locator('.achievement-sealed-reward').innerText()).trim(), '?', 'Secret rewards must use the requested question-mark label')
    const dom = await card.innerHTML()
    const reward = getRareReward(definition.rewardId)
    for (const hiddenValue of [definition.rewardId, reward.name, String(definition.rewardVp), definition.rewardVp.toLocaleString('ko-KR'), reward.spriteFront, reward.sprite].filter(Boolean)) {
      assert(!dom.includes(hiddenValue), `Sealed reward leaked text, image or attribute: ${hiddenValue}`)
    }
  }
  assert.equal(await targetPage.locator('.achievement-reward-showcase').count(), 0)
  assert.match(await targetPage.locator('.achievement-earned-stat').innerText(), /0\s*VP/)
  for (const definition of secretAchievements) {
    await targetPage.getByRole('searchbox', { name: '업적 또는 트레이너 검색' }).fill(getRareReward(definition.rewardId).name)
    assert.equal(await targetPage.locator('.achievement-card').count(), 0, 'Unrevealed reward identity must not be searchable')
  }
  await targetPage.getByRole('searchbox', { name: '업적 또는 트레이너 검색' }).fill('')
}

async function openMode(targetPage, mode, expectedScreen = mode) {
  await targetPage.evaluate(id => window.__achievementQA.open(id), mode)
  await waitScreen(expectedScreen, targetPage)
}

async function openSettingsAchievements(targetPage = page, inBattle = false) {
  await targetPage.getByRole('button', { name: inBattle ? '환경 설정' : '설정', exact: true }).click()
  await targetPage.getByRole('tab', { name: '업적', exact: true }).click()
  await targetPage.locator('#settings-achievements-panel .achievement-embedded').waitFor()
  assert.equal(await targetPage.getByRole('dialog').count(), 1)
}

async function verifySettingsCatalog() {
  await openSettingsAchievements()
  assert.equal(await page.evaluate(() => window.__achievementQA.screen), 'lobby', 'Settings achievements must not navigate away from the current screen')
  assert.equal(await page.locator('#settings-achievements-panel .achievement-card').count(), 12)
  await page.getByRole('button', { name: '달성', exact: true }).click()
  assert.equal(await page.locator('.achievement-empty').count(), 1)
  await page.getByRole('button', { name: '미달성', exact: true }).click()
  assert.equal(await page.locator('.achievement-is-complete').count(), 0)
  await page.getByRole('combobox', { name: '업적 정렬' }).selectOption('name')
  const names = await page.locator('.achievement-card h3').allTextContents()
  assert.deepEqual(names, [...names].sort((left, right) => left.localeCompare(right, 'ko-KR')), 'Name sorting must order the visible achievements')
  await page.getByRole('combobox', { name: '업적 정렬' }).selectOption('progress')
  const ratios = await page.locator('.achievement-progress-track').evaluateAll(elements => elements.map(element => Number(element.getAttribute('aria-valuenow')) / Number(element.getAttribute('aria-valuemax'))))
  assert(ratios.every((ratio, index) => index === 0 || ratio <= ratios[index - 1]), 'Progress sorting must put the nearest goals first')
  await page.setViewportSize({ width: 844, height: 390 })
  await assertInViewport('.settings-close-button')
  await assertInViewport('#settings-achievements-panel .achievement-pagination')
  await page.screenshot({ path: path.join(output, 'settings-achievements-landscape.png') })
  await page.getByRole('button', { name: '설정 닫기', exact: true }).click()
  assert.equal(await page.locator('.settings-modal').count(), 0)
  assert.equal(await page.evaluate(() => window.__achievementQA.screen), 'lobby')
  await page.setViewportSize({ width: 1440, height: 900 })
  console.log('Browser QA: settings achievement tab, status filters, sorting and compact layout passed')
}

async function assertNonBlockingToast(targetPage, expectedCount) {
  await targetPage.locator('.achievement-toast').waitFor()
  assert.equal(await targetPage.locator('.achievement-toast').count(), 1, 'One transaction must appear as one compact notification')
  assert.equal(await targetPage.getByRole('status', { name: '업적 달성 알림' }).count(), 1)
  assert.equal(await targetPage.locator('.achievement-reveal-dialog').count(), 0, 'Achievement rewards must not open the old blocking dialog')
  const notification = await targetPage.evaluate(() => window.__achievementQA.achievementToasts[0])
  assert.equal(notification.unlocked.length, expectedCount)
  await targetPage.waitForFunction(() => {
    const bounds = document.querySelector('.achievement-toast')?.getBoundingClientRect()
    return bounds && bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight
  })
  await assertInViewport('.achievement-toast', targetPage)
  const position = await targetPage.locator('.achievement-toast').evaluate(element => {
    const bounds = element.getBoundingClientRect()
    return { left: bounds.left, top: bounds.top, right: bounds.right, width: innerWidth }
  })
  assert(position.right > position.width * .8 && position.top < 120, 'Notifications must appear near the upper-right corner')
  return notification
}

async function verifyEarnedRewardRecovery() {
  const earnedProgress = createAchievementState()
  secretAchievements.forEach(entry => { earnedProgress.unlocked[entry.id] = 1234567890 })
  const earnedBalance = 905000
  const earnedContext = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await installHarness(earnedContext, { collection: [{ speciesId: 493, directDrawCount: 1 }], progress: earnedProgress, balance: earnedBalance })
  const earnedPage = await earnedContext.newPage()
  earnedPage.on('pageerror', error => errors.push(error.message))
  try {
    await earnedPage.goto(`${origin}/achievement-qa.html`, { waitUntil: 'domcontentloaded' })
    await waitScreen('lobby', earnedPage)
    await earnedPage.waitForFunction(() => window.__boxMirrorWrites.length > 0)
    const initial = await earnedPage.evaluate(() => ({ first: window.__firstAchievementRender, mirror: window.__boxMirrorWrites[0], vp: window.__achievementQA.vp }))
    assert.equal(initial.vp, earnedBalance, 'Restoring an already earned reward must not pay again')
    for (const skin of POKEMON_SKINS) {
      assert(initial.first.pokemon.some(entry => entry.speciesId === skin.baseSpeciesId && entry.skinId === skin.id), 'Earned base Pokemon must exist on the first render')
      assert(initial.mirror.some(entry => entry.speciesId === skin.baseSpeciesId && entry.skinId === skin.id), 'The first box mirror must include the restored Pokemon')
      assert.equal(initial.first.pokemon.find(entry => entry.speciesId === skin.baseSpeciesId).captureId, `dex-${skin.baseSpeciesId}`, 'Gift Pokemon must use IDs that survive collection migration')
    }
    assert.equal(initial.first.inventory['legend-plate'], 1)
    assert.equal(await earnedPage.getByRole('dialog').count(), 0, 'Rehydrating an old achievement must not show a new reward notice')
    assert.equal(await earnedPage.locator('.achievement-toast').count(), 0, 'Previously paid rewards must not enqueue a fresh notification')

    await openMode(earnedPage, 'training')
    await earnedPage.getByRole('searchbox', { name: '포켓몬 이름 검색' }).fill('뮤츠')
    await earnedPage.locator('.training-roster-card').filter({ hasText: '뮤츠' }).first().click()
    const skinSelect = earnedPage.getByRole('combobox', { name: '획득한 특별 스킨 선택' })
    assert.deepEqual(await skinSelect.locator('option').evaluateAll(options => options.map(option => option.value)), ['', 'armored-mewtwo'])
    await skinSelect.selectOption('')
    await earnedPage.getByRole('button', { name: '설정 저장 · 무료', exact: true }).click()
    await earnedPage.waitForFunction(() => window.__achievementQA.boxPokemon.some(entry => entry.speciesId === 150 && !entry.skinId))
    await earnedPage.waitForFunction(() => JSON.parse(localStorage.getItem('champions-dex-v2')).some(entry => entry.speciesId === 150 && !entry.skinId))
    await earnedPage.reload()
    await waitScreen('lobby', earnedPage)
    assert.equal(await earnedPage.evaluate(() => window.__achievementQA.boxPokemon.find(entry => entry.speciesId === 150).skinId), null, 'Restoration must preserve a saved default appearance')
    await openMode(earnedPage, 'training')
    await earnedPage.getByRole('searchbox', { name: '포켓몬 이름 검색' }).fill('뮤츠')
    await earnedPage.locator('.training-roster-card').filter({ hasText: '뮤츠' }).first().click()
    await earnedPage.getByRole('combobox', { name: '획득한 특별 스킨 선택' }).selectOption('armored-mewtwo')
    await earnedPage.getByRole('button', { name: '설정 저장 · 무료', exact: true }).click()
    await earnedPage.waitForFunction(() => window.__achievementQA.boxPokemon.some(entry => entry.speciesId === 150 && entry.skinId === 'armored-mewtwo'))
    await earnedPage.waitForFunction(() => JSON.parse(localStorage.getItem('champions-dex-v2')).some(entry => entry.speciesId === 150 && entry.skinId === 'armored-mewtwo'))
    await earnedPage.screenshot({ path: path.join(output, 'rare-skin-training.png') })
    await earnedPage.reload()
    await waitScreen('lobby', earnedPage)
    assert.equal(await earnedPage.evaluate(() => window.__achievementQA.vp), earnedBalance)
    assert.equal(await earnedPage.evaluate(() => window.__achievementQA.boxPokemon.filter(entry => entry.speciesId === 150 && entry.skinId === 'armored-mewtwo').length), 1)

    await openMode(earnedPage, 'shop')
    await earnedPage.getByRole('button', { name: /업적 보상/ }).click()
    assert.equal(await earnedPage.locator('.shop-rare-reward').count(), 1)
    assert.match(await earnedPage.locator('.shop-rare-reward').innerText(), /레전드플레이트/)
    assert(await earnedPage.getByRole('button', { name: '획득 완료', exact: true }).isDisabled())
    await earnedPage.screenshot({ path: path.join(output, 'rare-item-shop.png') })
    await openMode(earnedPage, 'collection', 'box')
    await earnedPage.getByRole('searchbox', { name: '보유 포켓몬 검색' }).fill('뮤츠')
    await earnedPage.getByRole('button', { name: '뮤츠 팀에 추가', exact: true }).click()
    await earnedPage.waitForFunction(() => JSON.parse(localStorage.getItem('champions-teams-v1')).teams.some(team => team.pokemonIds.includes('dex-150')))
    await earnedPage.getByRole('searchbox', { name: '보유 포켓몬 검색' }).fill('아르세우스')
    await earnedPage.locator('.team-box-card-select').filter({ hasText: '아르세우스' }).first().click()
    await earnedPage.locator('.pokedex-held-item-button').click()
    await earnedPage.getByRole('option', { name: /레전드플레이트/ }).click()
    await earnedPage.waitForFunction(() => window.__achievementQA.boxPokemon.some(entry => entry.speciesId === 493 && entry.heldItemId === 'legend-plate'))
    await earnedPage.waitForFunction(() => JSON.parse(localStorage.getItem('champions-dex-v2')).some(entry => entry.speciesId === 493 && entry.heldItemId === 'legend-plate'))
    await earnedPage.reload()
    await waitScreen('lobby', earnedPage)
    assert.equal(await earnedPage.evaluate(() => window.__achievementQA.boxPokemon.find(entry => entry.speciesId === 493).heldItemId), 'legend-plate')
    assert(await earnedPage.evaluate(() => window.__achievementQA.teams.some(team => team.pokemonIds.includes('dex-150'))), 'A gifted Pokemon must retain team membership after reload')
    assert.equal(await earnedPage.evaluate(() => window.__achievementQA.vp), earnedBalance)
    await openMode(earnedPage, 'achievements')
    await earnedPage.locator('.achievement-reward-showcase').waitFor()
    assert.equal(await earnedPage.locator('.achievement-reward-showcase .achievement-revealed-reward').count(), 5)
    await earnedPage.screenshot({ path: path.join(output, 'rare-rewards-earned.png') })
    console.log('Browser QA: earned reward recovery, skin save and rare held item passed')
  } catch (error) {
    await earnedPage.screenshot({ path: path.join(output, 'rare-recovery-failure.png') }).catch(() => {})
    throw error
  } finally { await earnedContext.close() }
}

async function verifyCollectionRewardSettlement() {
  const collectionContext = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await installHarness(collectionContext, { collection: ACHIEVABLE_SPECIES_IDS.map(speciesId => ({ speciesId, directDrawCount: 1 })) })
  const collectionPage = await collectionContext.newPage()
  collectionPage.on('pageerror', error => errors.push(error.message))
  try {
    await collectionPage.goto(`${origin}/achievement-qa.html`, { waitUntil: 'domcontentloaded' })
    await assertNonBlockingToast(collectionPage, 1)
    const ordinaryReward = ACHIEVEMENTS.find(entry => entry.id === 'collection-all')
    const shinyReward = ACHIEVEMENTS.find(entry => entry.id === 'collection-shiny-all')
    const ordinaryBalance = initialVp + ordinaryReward.rewardVp
    await collectionPage.waitForFunction(balance => window.__achievementQA.vp === balance, ordinaryBalance)
    assert.match(await collectionPage.locator('.achievement-toast').innerText(), /전국도감의 완성/)
    assert.equal(await collectionPage.getByRole('dialog').count(), 0)
    assert.equal(await collectionPage.evaluate(() => JSON.parse(localStorage.getItem('champions-achievements-v1')).walletBalance), ordinaryBalance)
    await collectionPage.setViewportSize({ width: 844, height: 390 })
    await assertInViewport('.achievement-toast', collectionPage)
    await collectionPage.screenshot({ path: path.join(output, 'collection-reward-landscape.png') })
    await collectionPage.getByRole('button', { name: '업적 알림 닫기', exact: true }).click()
    await collectionPage.locator('.achievement-toast').waitFor({ state: 'detached' })
    await collectionPage.reload()
    await waitScreen('lobby', collectionPage)
    assert.equal(await collectionPage.evaluate(() => window.__achievementQA.vp), ordinaryBalance)
    assert.equal(await collectionPage.locator('.achievement-toast').count(), 0, 'Reload must not replay a paid collection reward')

    await openMode(collectionPage, 'hatch')
    await collectionPage.evaluate(() => window.__achievementQA.replaceCollection(
      window.__achievementQA.boxPokemon.map(entry => ({ ...entry, shinyObtained: true, isShiny: true })),
    ))
    await assertNonBlockingToast(collectionPage, 1)
    assert.equal(await collectionPage.evaluate(() => window.__achievementQA.screen), 'hatch', 'New collection achievements must notify immediately without leaving the draw screen')
    const shinyBalance = ordinaryBalance + shinyReward.rewardVp
    await collectionPage.waitForFunction(balance => window.__achievementQA.vp === balance, shinyBalance)
    assert.match(await collectionPage.locator('.achievement-toast').innerText(), /모든 빛깔의 발견/)
    await collectionPage.mouse.move(10, 200)
    await collectionPage.locator('.achievement-toast').waitFor({ state: 'detached', timeout: 9000 })
    assert.equal(await collectionPage.evaluate(() => window.__achievementQA.achievementToasts.length), 0, 'Notifications must dismiss automatically without user input')
    await collectionPage.reload()
    await waitScreen('lobby', collectionPage)
    assert.equal(await collectionPage.evaluate(() => window.__achievementQA.vp), shinyBalance)
    assert.equal(await collectionPage.locator('.achievement-toast').count(), 0)
    assert.equal(await collectionPage.evaluate(() => Object.keys(window.__achievementQA.achievementProgress.unlocked).length), 2)
    console.log('Browser QA: ordinary and shiny full-collection rewards paid once across reloads')
  } catch (error) {
    await collectionPage.screenshot({ path: path.join(output, 'collection-reward-failure.png') }).catch(() => {})
    throw error
  } finally { await collectionContext.close() }
}

async function verifyToastQueue() {
  const toastContext = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await installHarness(toastContext)
  const toastPage = await toastContext.newPage()
  toastPage.on('pageerror', error => errors.push(error.message))
  try {
    await toastPage.goto(`${origin}/achievement-qa.html`, { waitUntil: 'domcontentloaded' })
    await waitScreen('lobby', toastPage)
    await toastPage.evaluate(() => window.__achievementQA.start('league'))
    await waitScreen('competition', toastPage)
    await toastPage.evaluate(() => window.__achievementQA.enter())
    await waitScreen('battle', toastPage)
    const firstMatch = await toastPage.evaluate(() => window.__achievementQA.battleMatch)
    const firstBattle = completedBattle(firstMatch.opponent)
    await toastPage.evaluate(value => window.__achievementBattleQA.replace(value), firstBattle)
    await toastPage.locator('.achievement-toast').waitFor()
    await toastPage.locator('.achievement-toast').hover()
    const first = await toastPage.evaluate(() => ({
      notification: window.__achievementQA.achievementToasts[0],
      progress: window.__achievementQA.achievementProgress,
      balance: window.__achievementQA.vp,
    }))
    assert(first.notification.unlocked.length > 1)
    // Keep the current notification hovered while the next real battle finishes.
    // This exercises two separate successful transactions in the queue.
    await toastPage.evaluate(value => window.__achievementQA.finish(value), getBattleSummary(firstBattle))
    await waitScreen('competition', toastPage)
    await toastPage.evaluate(() => window.__achievementQA.enter())
    await waitScreen('battle', toastPage)
    const secondMatch = await toastPage.evaluate(() => window.__achievementQA.battleMatch)
    assert.notEqual(secondMatch.opponent.id, firstMatch.opponent.id)
    const secondBattle = completedBattle(secondMatch.opponent)
    const secondSummary = getBattleSummary(secondBattle)
    const secondExpected = applyBattleAchievements(first.progress, { battleId: secondMatch.id, summary: secondSummary, opponent: secondMatch.opponent })
    assert(secondExpected.unlocked.length > 0)
    await toastPage.evaluate(value => window.__achievementBattleQA.replace(value), secondBattle)
    await toastPage.waitForFunction(() => window.__achievementQA.achievementToasts.length === 2)
    assert.equal(await toastPage.locator('.achievement-toast').count(), 1)
    assert.equal(await toastPage.evaluate(() => window.__achievementQA.achievementToasts[0].id), first.notification.id)
    assert.equal(await toastPage.evaluate(() => window.__achievementQA.vp), first.balance + AI_BATTLE_VP_REWARDS.league + secondExpected.rewardVp)
    await toastPage.getByRole('button', { name: '업적 알림 닫기', exact: true }).click()
    await toastPage.waitForFunction(firstId => window.__achievementQA.achievementToasts.length === 1 && window.__achievementQA.achievementToasts[0].id !== firstId, first.notification.id)
    assert.equal(await toastPage.locator('.achievement-toast').count(), 1)
    const second = await toastPage.evaluate(() => window.__achievementQA.achievementToasts[0])
    assert.deepEqual(second.unlocked.map(entry => entry.id), secondExpected.unlocked.map(entry => entry.id))
    await toastPage.evaluate(value => { window.__achievementQA.settle(value); window.__achievementQA.settle(value) }, secondSummary)
    assert.equal(await toastPage.evaluate(() => window.__achievementQA.achievementToasts.length), 1)
    await toastPage.mouse.move(15, 400)
    await toastPage.locator('.achievement-toast').waitFor({ state: 'detached', timeout: 9000 })
    assert.equal(await toastPage.evaluate(() => window.__achievementQA.achievementToasts.length), 0)
    assert.equal(await toastPage.getByRole('dialog').count(), 0)
    await toastPage.getByRole('button', { name: '배틀 마치기', exact: false }).click()
    await waitScreen('competition', toastPage)
    console.log('Browser QA: realtime toast batches, queued transactions, manual dismissal, timeout and uninterrupted battle completion passed')
  } catch (error) {
    await toastPage.screenshot({ path: path.join(output, 'toast-queue-failure.png') }).catch(() => {})
    throw error
  } finally { await toastContext.close() }
}

try {
  console.log(`Browser QA server: ${origin}`)
  if (!process.argv.includes('--collection-only')) {
  await page.goto(`${origin}/achievement-qa.html`, { waitUntil: 'domcontentloaded' })
  await waitScreen('lobby')
  console.log('Browser QA: lobby loaded')
  await assertInViewport('.mode-achievements')
  await page.screenshot({ path: path.join(output, 'lobby-desktop.png') })
  await verifySettingsCatalog()
  await page.getByRole('button', { name: '업적 보기', exact: true }).click()
  await waitScreen('achievements')
  assert.equal(await page.locator('.achievement-card').count(), 12)
  assert.equal(ACHIEVEMENTS.length, 278)
  assert.match(await page.locator('.achievement-overview').innerText(), /278/)
  await validateSealedRewards(page)
  await page.getByRole('button', { name: '달성', exact: true }).click()
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

  await openMode(page, 'shop')
  assert.equal(await page.getByRole('button', { name: /업적 보상/ }).count(), 0)
  assert(!(await page.locator('.shop-screen').innerHTML()).includes('legend-plate'))
  assert(!(await page.locator('.shop-screen').innerText()).includes('레전드플레이트'))
  await openMode(page, 'training')
  assert.equal(await page.getByRole('combobox', { name: '획득한 특별 스킨 선택' }).count(), 0)
  await openMode(page, 'collection', 'box')
  await page.locator('.pokedex-held-item-button').click()
  assert.equal(await page.getByRole('option', { name: /레전드플레이트/ }).count(), 0)
  await page.getByRole('button', { name: '지닌 도구 선택창 닫기' }).click()

  const match = await startBattle()
  await page.evaluate(() => {
    window.__battleBeforeSettings = window.__achievementBattleQA.instance
    window.__achievementBattleQA.replace(window.__achievementBattleQA.state)
  })
  await openSettingsAchievements(page, true)
  assert.equal(await page.evaluate(() => window.__achievementQA.screen), 'battle')
  assert(await page.evaluate(() => window.__achievementBattleQA.instance === window.__battleBeforeSettings), 'Opening the settings achievement tab must keep the same battle mounted')
  const settingsSearch = page.getByRole('searchbox', { name: '업적 또는 트레이너 검색' })
  await settingsSearch.fill('승리')
  await settingsSearch.focus()
  const battle = completedBattle(match.opponent)
  const summary = getBattleSummary(battle)
  const expected = applyBattleAchievements(createAchievementState(), { battleId: match.id, summary, opponent: match.opponent })
  const paidVp = initialVp + AI_BATTLE_VP_REWARDS.league + expected.rewardVp
  await page.evaluate(value => window.__achievementBattleQA.replace(value), battle)
  await page.waitForFunction(value => window.__achievementQA.vp === value, paidVp)
  const notification = await assertNonBlockingToast(page, expected.unlocked.length)
  assert(expected.unlocked.length > 1, 'The battle fixture must exercise several simultaneous achievements')
  assert.equal(await page.getByRole('dialog').count(), 1, 'Only the already opened settings dialog may remain')
  assert(await settingsSearch.evaluate(element => document.activeElement === element), 'Realtime reward notifications must not steal keyboard focus')
  assert(await page.evaluate(() => window.__achievementBattleQA.instance === window.__battleBeforeSettings))
  await page.getByRole('button', { name: '달성', exact: true }).click()
  assert((await page.locator('#settings-achievements-panel .achievement-is-complete').count()) > 0, 'An open settings catalog must reflect newly achieved battle goals')
  await page.getByRole('button', { name: '설정 닫기', exact: true }).click()
  await page.locator('.achievement-battle-rewards').waitFor()
  assert.equal(await page.locator('.achievement-battle-rewards li').count(), expected.unlocked.length)
  const beforeDuplicate = await page.evaluate(() => JSON.stringify(window.__achievementQA.achievementProgress))
  await page.evaluate(value => { window.__achievementQA.settle(value); window.__achievementQA.settle(value) }, summary)
  assert.equal(await page.evaluate(() => window.__achievementQA.vp), paidVp)
  assert.equal(await page.evaluate(() => JSON.stringify(window.__achievementQA.achievementProgress)), beforeDuplicate)
  assert.equal(await page.evaluate(() => window.__achievementQA.achievementToasts.length), 1, 'Repeated settlement must not add a duplicate notification')
  assert.equal(await page.evaluate(() => window.__achievementQA.achievementToasts[0].id), notification.id)
  await page.getByRole('button', { name: '달성 업적 보기', exact: true }).click()
  await page.locator('#settings-achievements-panel .achievement-embedded').waitFor()
  assert.equal(await page.evaluate(() => window.__achievementQA.screen), 'battle', 'Notification action must open settings without navigating away from battle')
  assert(await page.evaluate(() => window.__achievementBattleQA.instance === window.__battleBeforeSettings))
  await page.getByRole('button', { name: '설정 닫기', exact: true }).click()
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
  await page.getByRole('button', { name: '달성', exact: true }).click()
  assert.equal(await page.locator('.achievement-is-complete').count(), expected.unlocked.length)
  await page.getByRole('combobox', { name: '업적 정렬' }).selectOption('recent')
  assert.equal(await page.locator('.achievement-is-complete').count(), expected.unlocked.length)
  await page.getByRole('button', { name: '미달성', exact: true }).click()
  assert.equal(await page.locator('.achievement-is-complete').count(), 0)
  await page.getByRole('button', { name: '달성', exact: true }).click()
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
  assert.equal(await page.locator('.achievement-toast').count(), 0, 'Reload must not announce already settled battle achievements')
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
  assert(afterRetry >= balanceBeforeFailure + AI_BATTLE_VP_REWARDS.league)
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
  await verifyEarnedRewardRecovery()
  await verifyToastQueue()
  }
  await verifyCollectionRewardSettlement()
  assert.deepEqual(errors, [], 'Browser must not emit runtime errors')
  console.log(process.argv.includes('--collection-only')
    ? 'Achievement collection UI passed: ordinary and shiny collection rewards, nonblocking toast dismissal/timeout, VP persistence and no repeat payment.'
    : 'Achievement UI passed: settings achievement tab without battle remount, status filters and sorting, 278 question-mark sealed rewards, realtime grouped toasts and queue/dismiss/timeout without focus theft, catalog/search/paging, real battle settlement, duplicate settlement/finish, mobile layout, reload/spending, failed-write retry, reward recovery before mirrors, saved skins, earned-only rare items, and once-only ordinary/shiny collection rewards.')
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
