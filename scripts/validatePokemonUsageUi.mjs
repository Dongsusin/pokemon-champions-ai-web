import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { createMemoryRankedStore } from '../server/rankedStore.js'
import { createRankedTestTeams, startRankedDevServer } from './rankedDevServer.mjs'
import { canonicalUsageSpeciesId, createEmptyUsageSnapshot, getCombinedPokemonItemUsage, getUsageRanking, recordUsageTeams } from '../src/data/pokemonUsage.js'
import { createDemoUsageSnapshot } from './fixtures/pokemonUsageDemo.mjs'
import { getBattleItem, getVisibleBattleItems } from '../src/data/shopData.js'
import { resolveChromiumExecutable } from '../promo/scripts/browserRuntime.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const seededTest = !process.argv.includes('--fresh')
const layoutOnly = process.argv.includes('--layout-only')
const expectedSource = seededTest ? 'demo' : 'local'
const output = path.join(root, `${seededTest ? 'scripts/.cache/pokemon-usage-ui' : 'scripts/.cache/pokemon-usage-fresh-ui'}${layoutOnly ? '-layout' : ''}`)
await fs.mkdir(output, { recursive: true })
const require = createRequire(new URL('../promo/package.json', import.meta.url))
const { chromium } = require('playwright')
const checks = []
const pageErrors = []
const blockedExternal = new Set()
const aiReports = []
const envNames = ['VITE_POKEMON_USAGE_ENABLED', 'VITE_POKEMON_USAGE_DEMO', 'VITE_POKEMON_USAGE_SEEDED_TEST', 'VITE_RANKED_ENABLED', 'VITE_RANKED_LOCAL_TEST', 'VITE_RANKED_API_URL']
const originalEnv = Object.fromEntries(envNames.map(name => [name, process.env[name]]))
const store = createMemoryRankedStore()
const seed = seededTest ? createDemoUsageSnapshot() : createEmptyUsageSnapshot()
if (seededTest) await store.transaction(async tx => {
  for (const [key, bucket] of Object.entries(seed.buckets)) tx.set('pokemonUsage', key, bucket)
})
let backend
let frontend
let browser
const pages = []
let step = 'setup'

const log = (name, evidence = {}) => {
  checks.push({ name, passed: true, ...evidence })
  console.log(`PASS ${name}${Object.keys(evidence).length ? ` ${JSON.stringify(evidence)}` : ''}`)
}
const live = async () => backend.service.execute({ uid: 'ranked-test-alice', name: 'Alice' }, { action: 'usage' })

async function waitBucket(key, expected) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const snapshot = await live()
    if (snapshot.buckets[key].teamCount === expected) return snapshot
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert.equal((await live()).buckets[key].teamCount, expected, `Timed out waiting for ${key} team count`)
}

async function chooseUsage(page, mode, format) {
  await page.getByRole('tab', { name: mode === 'ai' ? 'AI 대전' : '레이팅 배틀', exact: true }).click()
  await page.locator('.pokemon-usage-formats').getByRole('button', { name: format === 'single' ? '싱글배틀' : '더블배틀', exact: true }).click()
}

async function verifyRows(page, bucket, label) {
  assert.equal(await page.locator('.pokemon-usage-sample strong').textContent(), bucket.teamCount.toLocaleString('ko-KR'))
  const expected = getUsageRanking(bucket)
  const actual = []
  for (let index = 0; index < 5; index += 1) {
    await page.getByRole('button', { name: `${index * 20 + 1}~${(index + 1) * 20}위 보기`, exact: true }).click()
    const rows = await page.locator('.pokemon-usage-row').evaluateAll(elements => elements.map(element => ({
      rank: Number(element.dataset.usageRank), speciesId: Number(element.dataset.speciesId),
      count: Number(element.querySelector('.pokemon-usage-count strong').textContent.replaceAll(',', '')),
      rate: element.querySelector('.pokemon-usage-rate > strong').textContent,
      delta: element.querySelector('.pokemon-usage-change .pokemon-usage-rate-change').getAttribute('aria-label'),
      rankChange: element.querySelector('.pokemon-usage-rank-change').getAttribute('aria-label'),
      items: [...element.querySelectorAll('.pokemon-usage-item-column [data-item-rank]')].map(item => ({
        itemId: item.dataset.itemId, rank: Number(item.dataset.itemRank),
        rate: item.querySelector('.pokemon-usage-item-copy > span').textContent,
      })),
    })))
    assert.equal(rows.length, 20)
    actual.push(...rows)
  }
  assert.equal(actual.length, 100)
  assert.equal(new Set(actual.map(row => row.speciesId)).size, 100)
  expected.forEach((row, index) => {
    assert.equal(actual[index].rank, row.rank, `${label}: rank`)
    assert.equal(actual[index].speciesId, row.speciesId, `${label}: species order`)
    assert.equal(actual[index].count, row.count, `${label}: usage count`)
    assert.equal(actual[index].rate, `${row.rate.toFixed(1)}%`, `${label}: usage percentage`)
    const delta = Number(row.rateDelta.toFixed(1))
    assert.equal(actual[index].delta, `직전 집계 대비 사용률 ${delta > 0 ? '+' : ''}${delta.toFixed(1)} 퍼센트포인트`)
    assert.equal(actual[index].rankChange, row.isNew ? '직전 집계에 없던 신규 사용'
      : row.rankDelta ? `직전 집계 대비 ${Math.abs(row.rankDelta)}위 ${row.rankDelta > 0 ? '상승' : '하락'}` : '직전 집계 대비 순위 유지')
    assert.deepEqual(actual[index].items, row.itemUsage.items.map(item => ({ itemId: item.itemId, rank: item.rank, rate: `${item.rate.toFixed(1)}%` })), `${label}: per-Pokémon item ranking and percentages`)
  })
  await page.getByRole('button', { name: '1~20위 보기', exact: true }).click()
}

async function openUsage(page) {
  await page.locator('.mode-usage').click()
  await page.locator(`.pokemon-usage-screen[data-usage-source="${expectedSource}"]`).waitFor()
  await page.waitForFunction(() => document.querySelector('.pokemon-usage-panel')?.getAttribute('aria-busy') === 'false')
  assert.equal(await page.locator('.pokemon-usage-error').count(), 0)
}

async function verifyLeaderCollapse(page, screen, label) {
  const toggle = screen.getByRole('button', { name: /^TOP 3 (접기|펼치기)$/ })
  await toggle.waitFor()
  const regionId = await toggle.getAttribute('aria-controls')
  assert(regionId, `${label}: the TOP 3 toggle identifies its controlled region`)
  assert.equal(await screen.locator(`[id="${regionId}"]`).count(), 1)
  const settle = async () => {
    await screen.evaluate(async element => {
      await Promise.all(element.getAnimations({ subtree: true })
        .filter(animation => animation.effect?.getTiming().iterations !== Infinity)
        .map(animation => animation.finished.catch(() => {})))
    })
  }
  const bounds = () => screen.evaluate(element => {
    const rect = node => { const r = node.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: r.height, left: r.left, right: r.right } }
    const button = element.querySelector('button[aria-expanded][aria-controls]')
    const b = button.getBoundingClientRect()
    return { list: rect(element.querySelector('.pokemon-usage-list-scroll')),
      row: rect(element.querySelector('.pokemon-usage-row')),
      pagination: rect(element.querySelector('.pokemon-usage-pagination')),
      region: rect(document.getElementById(button.getAttribute('aria-controls'))),
      button: rect(button), buttonReceivesPointer: button.contains(document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)),
      viewport: { width: innerWidth, height: innerHeight } }
  })
  if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click()
  await settle()
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true')
  assert.equal(await screen.getByRole('article').count(), 3, `${label}: expanded leaders are available to assistive technology`)
  const expanded = await bounds()
  assert(expanded.region.height > 0, `${label}: TOP 3 is visible when expanded`)
  assert(expanded.list.height >= expanded.row.height - 1, `${label}: expanded TOP 3 must still leave a complete detailed ranking row visible: ${JSON.stringify(expanded)}`)
  assert(expanded.buttonReceivesPointer, `${label}: expanded toggle is reachable`)
  await page.screenshot({ path: path.join(output, `${label}-top3-expanded.png`) })
  await toggle.focus()
  await toggle.press('Enter')
  await settle()
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false')
  assert.equal(await toggle.getAttribute('aria-label'), 'TOP 3 펼치기')
  assert.equal(await screen.getByRole('article').count(), 0, `${label}: collapsed leaders are excluded from accessibility navigation`)
  const collapsed = await bounds()
  assert(collapsed.list.height > expanded.list.height + 30, `${label}: collapsing TOP 3 must transfer its space to the ranking list: ${JSON.stringify({ expanded, collapsed })}`)
  assert(collapsed.region.height <= 1, `${label}: hidden TOP 3 leaves no card-sized gap`)
  assert(collapsed.buttonReceivesPointer, `${label}: collapsed toggle stays reachable`)
  assert(collapsed.pagination.bottom <= collapsed.viewport.height + 1, `${label}: pagination stays on screen`)
  await screen.getByRole('button', { name: '81~100위 보기', exact: true }).click()
  assert.equal(await screen.locator('.pokemon-usage-row').first().getAttribute('data-usage-rank'), '81')
  await toggle.press('Space')
  await settle()
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true')
  assert.equal(await screen.locator('.pokemon-usage-row').first().getAttribute('data-usage-rank'), '81', `${label}: expanding preserves the selected ranking page`)
  assert(Math.abs((await bounds()).list.height - expanded.list.height) <= 2, `${label}: expanding restores the ranking height`)
  await toggle.click()
  await settle()
  const search = screen.getByRole('searchbox', { name: '포켓몬 이름 또는 타입 검색', exact: true })
  await search.fill('피카츄')
  assert((await screen.locator('.pokemon-usage-pokemon > div > strong').allTextContents()).every(name => name.includes('피카츄')))
  assert(await screen.locator('.pokemon-usage-row').count() > 0, `${label}: search still returns Pokémon while TOP 3 is hidden`)
  await screen.getByRole('button', { name: '사용률 검색어 지우기', exact: true }).click()
  for (const mode of ['AI 대전', '레이팅 배틀']) {
    await screen.getByRole('tab', { name: mode, exact: true }).click()
    await screen.locator('.pokemon-usage-formats').getByRole('button', { name: '더블배틀', exact: true }).click()
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false', `${label}: mode and format changes preserve the user's collapsed view`)
    assert.equal(await screen.locator('.pokemon-usage-row').first().getAttribute('data-usage-rank'), '1')
    assert.match(await screen.locator('.pokemon-usage-toolbar h3').textContent(), new RegExp(`${mode}.*더블배틀`))
  }
  await screen.locator('.pokemon-usage-formats').getByRole('button', { name: '싱글배틀', exact: true }).click()
  await page.screenshot({ path: path.join(output, `${label}-top3-collapsed.png`) })
  log(`${label}: TOP 3 keyboard toggle reallocates space and preserves ranking navigation`, { expanded, collapsed })
}

async function dismissDialogue(page) {
  for (let index = 0; index < 5; index += 1) {
    const button = page.locator('.battle-trainer-dialogue-box')
    if (!await button.count()) break
    await button.click()
    await page.waitForTimeout(80)
  }
}

async function waitBattleReady(page) {
  await page.locator('.battle-game-screen').waitFor()
  await page.waitForFunction(() => window.__usageBattle)
  if (await page.locator('.battle-intro-overlay button').count()) {
    await page.locator('.battle-intro-overlay button').last().click()
  }
  await dismissDialogue(page)
  await page.waitForFunction(() => window.__usageBattle && !window.__usageBattle.introVisible && !window.__usageBattle.isTurnAnimating)
}

async function submitMove(page) {
  await dismissDialogue(page)
  await page.locator('.battle-command-buttons .fight').click()
  const slots = await page.evaluate(() => window.__usageBattle.battle.player.activeIndexes.length)
  for (let slot = 0; slot < slots; slot += 1) {
    const moves = page.locator('.battle-move-button:not(:disabled)')
    await moves.first().waitFor()
    // Prefer Protect in ranked fixtures so both real players can complete a
    // deterministic turn without a forced replacement interrupting the check.
    const protect = moves.filter({ hasText: '방어' })
    await (await protect.count() ? protect.first() : moves.first()).click()
    if (await page.locator('.battle-target-grid button:not(:disabled)').count()) {
      await page.locator('.battle-target-grid button:not(:disabled)').first().click()
    }
  }
}

try {
  const rankedItems = [['focus-sash', 'life-orb', 'assault-vest', '', '', ''], ['leftovers', 'sitrus-berry', '', 'choice-specs', '', '']]
  const rankedFixtures = createRankedTestTeams().map((team, side) => ({ ...team,
    pokemon: team.pokemon.map((member, index) => ({ ...member, heldItemId: rankedItems[side][index] })) }))
  backend = await startRankedDevServer({ port: 0, store, testAccounts: true, usageEnabled: true,
    fixtures: rankedFixtures,
    timeouts: { selection: 180_000, turn: 180_000, playbackGrace: 0 } })
  Object.assign(process.env, { VITE_POKEMON_USAGE_ENABLED: 'true', VITE_POKEMON_USAGE_DEMO: 'true',
    VITE_POKEMON_USAGE_SEEDED_TEST: seededTest ? 'true' : 'false',
    VITE_RANKED_ENABLED: 'true', VITE_RANKED_LOCAL_TEST: 'true', VITE_RANKED_API_URL: backend.url })
  frontend = await createServer({ root, mode: 'ranked-test', plugins: [{ name: 'usage-ui-offline-auth', enforce: 'pre',
    resolveId(source) { if (/\/auth\/firebaseClient(?:\.js)?$/.test(source)) return '\0usage-ui-auth' },
    load(id) { if (id === '\0usage-ui-auth') return 'export const firebaseAuth=null; export const firebaseDb=null; export const isFirebaseConfigured=false; export const missingFirebaseEnvironmentVariables=[];' },
  }], server: { host: '127.0.0.1', port: Number(process.env.POKEMON_USAGE_UI_PORT ?? 5196), strictPort: false, hmr: false }, logLevel: 'error' })
  await frontend.listen()
  const address = frontend.httpServer.address()
  const frontendUrl = `http://127.0.0.1:${address.port}`
  const allowedOrigins = new Set([frontendUrl, new URL(backend.url).origin])
  browser = await chromium.launch({ executablePath: await resolveChromiumExecutable(chromium), headless: true })

  async function makePage(identity) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, serviceWorkers: 'block' })
    await context.addInitScript(value => {
      window.sessionStorage.setItem('champions-ranked-test-identity-v1', value)
      // Blocking workers keeps every request visible to the isolation guard.
      // Chromium may otherwise resolve register() but leave ready pending.
      if (navigator.serviceWorker) navigator.serviceWorker.register = async () => { throw new Error('Service workers disabled for isolated usage validation') }
      let seed = 47321
      Math.random = () => { seed = seed * 16807 % 2147483647; return (seed - 1) / 2147483646 }
    }, identity)
    await context.route('**/*', async route => {
      const url = new URL(route.request().url())
      if (!allowedOrigins.has(url.origin)) { blockedExternal.add(url.origin); return route.abort('blockedbyclient') }
      if (url.pathname === '/src/BattleScreen.jsx') {
        const response = await route.fetch()
        let body = await response.text()
        assert(body.includes('const currentLogEntry ='), 'BattleScreen observation anchor changed')
        body = body.replace('const currentLogEntry =', 'window.__usageBattle={battle,menu,commandSlot,isTurnAnimating,introVisible}; const currentLogEntry =')
        return route.fulfill({ response, body })
      }
      if (url.href === backend.url && route.request().method() === 'POST') {
        const body = route.request().postDataJSON()
        if (body?.action === 'reportAiUsage') aiReports.push(body)
      }
      return route.continue()
    })
    const page = await context.newPage()
    pages.push(page)
    page.setDefaultTimeout(20_000)
    page.on('pageerror', error => pageErrors.push({ identity, message: error.message }))
    await page.goto(frontendUrl)
    await page.locator('.mode-usage').waitFor()
    return page
  }

  step = 'open integrated GameApp and inspect all four rankings'
  const alice = await makePage('alice')
  assert.equal(await alice.locator('.mode-usage').evaluate(element => element.previousElementSibling?.classList.contains('mode-achievements')), true)
  await openUsage(alice)
  for (const mode of ['ai', 'ranked']) {
    for (const format of ['single', 'double']) {
      await chooseUsage(alice, mode, format)
      await verifyRows(alice, seed.buckets[`${mode}-${format}`], `${mode}-${format} seed`)
    }
  }
  await alice.screenshot({ path: path.join(output, '01-four-filter-ranked-double.png') })
  if (!seededTest) {
    const initial = await live()
    assert(Object.values(initial.buckets).every(bucket => bucket.teamCount === 0 && Object.keys(bucket.itemCounts).length === 0))
    assert.match(await alice.locator('.pokemon-usage-source').textContent(), /로컬 플레이 집계/)
    assert.equal(await alice.locator('.pokemon-usage-item-column [data-item-rank]').count(), 0)
    assert(!await alice.getByText('임의 표본 포함', { exact: false }).count())
    assert.equal(await alice.getByRole('button', { name: /^TOP 3 (접기|펼치기)$/ }).count(), 0, 'An empty sample does not offer a TOP 3 toggle')
    assert.equal(await alice.locator('.pokemon-usage-leaders-collapse').count(), 0)
  }
  log('real lobby menu directly below achievements opens all 400 correctly calculated rows', { teamsPerBucket: seed.buckets['ai-single'].teamCount, source: expectedSource })

  if (seededTest) {
    step = 'desktop TOP 3 collapse and ranking navigation'
    await verifyLeaderCollapse(alice, alice.locator('.pokemon-usage-screen'), '07-desktop-1440x960')
    assert.equal(await alice.evaluate(() => localStorage.getItem('champions-usage-top-three-collapsed-v1')), 'true')
    await alice.reload()
    await alice.locator('.mode-usage').waitFor()
    await openUsage(alice)
    assert.equal(await alice.getByRole('button', { name: 'TOP 3 펼치기', exact: true }).getAttribute('aria-expanded'), 'false')
    log('the selected TOP 3 collapsed view survives a reload and reopening usage')
    step = 'landscape TOP 3 collapse and ranking navigation'
    await alice.setViewportSize({ width: 844, height: 390 })
    await alice.evaluate(() => localStorage.removeItem('champions-usage-top-three-collapsed-v1'))
    await alice.locator('.pokemon-usage-back').click()
    await openUsage(alice)
    assert.equal(await alice.getByRole('button', { name: 'TOP 3 펼치기', exact: true }).getAttribute('aria-expanded'), 'false', 'Short landscape screens initially prioritize the detailed ranking when no preference is saved')
    await verifyLeaderCollapse(alice, alice.locator('.pokemon-usage-screen'), '08-landscape-844x390')
    step = 'narrow landscape TOP 3 controls remain reachable'
    await alice.setViewportSize({ width: 667, height: 375 })
    const narrowStates = []
    for (const expanded of [false, true]) {
      const toggle = alice.getByRole('button', { name: /^TOP 3 (접기|펼치기)$/ })
      if (await toggle.getAttribute('aria-expanded') !== String(expanded)) await toggle.click()
      await alice.locator('.pokemon-usage-screen').evaluate(async element => {
        await Promise.all(element.getAnimations({ subtree: true }).filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})))
      })
      const narrow = await alice.locator('.pokemon-usage-screen').evaluate(element => {
        const button = element.querySelector('.pokemon-usage-leaders-toggle')
        const rect = button.getBoundingClientRect()
        return { viewport: { width: innerWidth, height: innerHeight }, expanded: button.getAttribute('aria-expanded'),
          button: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right },
          receivesPointer: button.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)),
          listHeight: element.querySelector('.pokemon-usage-list-scroll').getBoundingClientRect().height,
          rowHeight: element.querySelector('.pokemon-usage-row').getBoundingClientRect().height }
      })
      assert(narrow.button.left >= 0 && narrow.button.right <= 667 && narrow.button.top >= 0 && narrow.button.bottom <= 375 && narrow.receivesPointer, `Narrow TOP 3 toggle must fit and remain clickable: ${JSON.stringify(narrow)}`)
      assert(narrow.listHeight > 0, 'The expanded narrow screen keeps a scrollable ranking region')
      narrowStates.push(narrow)
      await alice.screenshot({ path: path.join(output, `10-narrow-667x375-top3-${expanded ? 'expanded' : 'collapsed'}.png`) })
    }
    await alice.getByRole('button', { name: 'TOP 3 접기', exact: true }).click()
    log('TOP 3 controls remain on screen in both states at 667x375', { states: narrowStates })
    await alice.setViewportSize({ width: 1440, height: 960 })
  }

  if (!layoutOnly) {
  step = 'start and play actual AI competition battle'
  await alice.locator('.pokemon-usage-back').click()
  await alice.locator('.mode-collection').click()
  await alice.locator('.pc-party-card').filter({ hasText: '피카츄' }).locator('button').first().click()
  await alice.locator('.pokedex-held-item-button').click()
  await alice.locator('.item-recommendations').waitFor()
  await alice.waitForFunction(() => document.querySelector('.item-recommendations')?.getAttribute('aria-busy') === 'false')
  const demoInventory = await alice.evaluate(() => JSON.parse(localStorage.getItem('champions-battle-items-v1')))
  const pikaRecommended = getCombinedPokemonItemUsage(seed, 25, { allowedItemIds: getVisibleBattleItems(demoInventory).map(item => item.id) })
  const recommendationCards = alice.locator('.item-recommendation-card')
  assert.deepEqual(await recommendationCards.evaluateAll(cards => cards.map(card => card.dataset.itemId)), pikaRecommended.items.map(item => item.itemId))
  if (seededTest) {
    assert.deepEqual(await alice.locator('.item-equip-card[data-item-id]').evaluateAll(cards => cards.slice(0, 3).map(card => card.dataset.itemId)), pikaRecommended.items.map(item => item.itemId), 'Recommended owned items stay first in the inventory')
    const berryCard = alice.locator('.item-recommendation-card[data-item-id="sitrus-berry"]')
    assert.equal(await berryCard.isDisabled(), true, 'An item used by another Pokémon must not become equippable through recommendations')
  } else {
    assert.equal(pikaRecommended.sampleCount, 0)
    assert.equal(await recommendationCards.count(), 0, 'Fresh statistics must never invent item recommendations')
    assert.match(await alice.locator('.item-recommendations').textContent(), /로컬 플레이 집계/)
  }
  await alice.getByRole('searchbox', { name: '보유 아이템 검색', exact: true }).fill('구애')
  assert.equal(await recommendationCards.count(), pikaRecommended.items.length, 'Search does not displace or invent pinned recommendations')
  assert(await alice.locator('.item-equip-card[data-item-id]').count() > 0)
  assert((await alice.locator('.item-equip-card[data-item-id]').allTextContents()).every(text => text.includes('구애')))
  await alice.getByRole('searchbox', { name: '보유 아이템 검색', exact: true }).fill('')
  await alice.screenshot({ path: path.join(output, '00-item-recommendations-before-equip.png') })
  if (seededTest) assert(pikaRecommended.items.find(item => item.itemId === 'life-orb'))
  await alice.locator(`${seededTest ? '.item-recommendation-card' : '.item-equip-card'}[data-item-id="life-orb"]`).click()
  await alice.locator('.item-equip-panel').waitFor({ state: 'hidden' })
  assert.match(await alice.locator('.pokedex-held-item-button').textContent(), new RegExp(getBattleItem('life-orb').name))
  assert.equal(await alice.evaluate(() => JSON.parse(localStorage.getItem('champions-dex-v2')).find(member => member.speciesId === 25).heldItemId), 'life-orb')
  await alice.setViewportSize({ width: 844, height: 390 })
  await alice.locator('.pokedex-held-item-button').click()
  await alice.locator('.item-recommendations').waitFor()
  const equipMobile = await alice.locator('.item-equip-panel').evaluate(panel => {
    const rect = element => { const r = element.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height } }
    const cards = [...panel.querySelectorAll('.item-recommendation-card')].map(card => {
      const r = card.getBoundingClientRect()
      return { ...rect(card), receivesPointer: card.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)) }
    })
    return { panel: rect(panel), list: rect(panel.querySelector('.item-equip-grid')), cards }
  })
  assert(equipMobile.panel.top >= 0 && equipMobile.panel.bottom <= 390 && equipMobile.panel.left >= 0 && equipMobile.panel.right <= 844, `Item picker fits landscape: ${JSON.stringify(equipMobile)}`)
  assert(equipMobile.list.height >= 40, `Owned items retain a scrollable area: ${JSON.stringify(equipMobile)}`)
  assert(equipMobile.cards.every(card => card.top >= 0 && card.bottom <= 390 && card.receivesPointer), `Recommendations stay visible and reachable: ${JSON.stringify(equipMobile)}`)
  await alice.screenshot({ path: path.join(output, '00-item-recommendations-mobile.png') })
  await alice.getByRole('button', { name: '지닌 도구 선택창 닫기', exact: true }).click()
  await alice.setViewportSize({ width: 1440, height: 960 })
  await alice.locator('.pc-party-card').filter({ hasText: '거북왕' }).locator('button').first().click()
  await alice.locator('.pokedex-held-item-button').click()
  await alice.locator('.item-equip-current').getByRole('button', { name: '장착 해제', exact: true }).click()
  await alice.locator('.item-equip-panel').waitFor({ state: 'hidden' })
  assert.equal(await alice.evaluate(() => JSON.parse(localStorage.getItem('champions-dex-v2')).find(member => member.speciesId === 9).heldItemId || null), null)
  assert.match(await alice.locator('.pokedex-held-item-button').textContent(), /지닌 도구 없음/)
  await alice.locator('.pc-header .screen-back-button').click()
  log(seededTest ? 'item recommendations match weighted usage, stay first during search and equip through the real inventory' : 'fresh usage has no invented recommendations and an owned item equips through the real inventory', { speciesId: 25, topItems: pikaRecommended.items, equippedItemId: 'life-orb', equipMobile })
  await alice.locator('.mode-start').click()
  await alice.locator('.battle-hub-card.ai').click()
  await alice.locator('.battle-mode-option-card').filter({ hasText: '128강 토너먼트' }).click()
  await alice.getByRole('button', { name: '이 모드로 시작', exact: true }).click()
  const selections = alice.locator('.competition-team-selection button')
  if (await selections.count()) {
    const required = Number((await alice.locator('.competition-team-selection header strong').textContent()).split('/')[1].trim())
    const selected = await selections.evaluateAll(elements => elements.flatMap((element, index) => element.getAttribute('aria-pressed') === 'true' ? [index] : []))
    for (let index = 0; index < required; index += 1) if (!selected.includes(index)) await selections.nth(index).click()
  }
  const beforeAi = await live()
  await alice.getByRole('button', { name: /배틀 시작/ }).click()
  await alice.waitForFunction(() => window.__usageBattle)
  const aiState = await alice.evaluate(() => window.__usageBattle.battle)
  const aiKey = `ai-${aiState.rules.format.id}`
  const selectedIds = aiState.player.team.map(member => canonicalUsageSpeciesId(member.speciesId))
  const aiSelectedTeam = aiState.player.team.map(member => ({ speciesId: member.speciesId, heldItemId: member.heldItemId || null }))
  assert.equal(aiSelectedTeam.find(member => member.speciesId === 25).heldItemId, 'life-orb')
  assert.equal(aiSelectedTeam.find(member => member.speciesId === 9).heldItemId, null)
  const afterAi = await waitBucket(aiKey, beforeAi.buckets[aiKey].teamCount + 1)
  assert.deepEqual(afterAi.buckets[aiKey], recordUsageTeams(beforeAi.buckets[aiKey], [aiSelectedTeam], afterAi.buckets[aiKey].updatedAt))
  for (const key of Object.keys(beforeAi.buckets)) if (key !== aiKey) assert.deepEqual(afterAi.buckets[key], beforeAi.buckets[key])
  await waitBattleReady(alice)
  await submitMove(alice)
  await alice.waitForFunction(turn => window.__usageBattle.battle.turn > turn && !window.__usageBattle.isTurnAnimating, aiState.turn, { timeout: 45_000 })
  await dismissDialogue(alice)
  await alice.screenshot({ path: path.join(output, '02-ai-actual-turn.png') })
  await alice.locator('.battle-command-buttons .surrender').click()
  await dismissDialogue(alice)
  if (await alice.locator('.battle-result-overlay').count()) await alice.getByRole('button', { name: '배틀 마치기' }).click()
  await alice.locator('.mode-usage').waitFor()
  await openUsage(alice)
  await chooseUsage(alice, 'ai', aiState.rules.format.id)
  await verifyRows(alice, afterAi.buckets[aiKey], 'after actual AI battle')
  await alice.screenshot({ path: path.join(output, '03-ai-usage-after-battle.png') })
  const firstReport = aiReports.find(entry => entry.format === aiState.rules.format.id)
  assert(firstReport, 'The actual GameApp must report its selected AI team')
  assert.deepEqual(firstReport.speciesIds.map(canonicalUsageSpeciesId), selectedIds)
  assert.deepEqual(firstReport.team, aiSelectedTeam)
  log('actual AI move, forfeit and report produce exactly one selected human team', { bucket: aiKey, before: beforeAi.buckets[aiKey].teamCount, after: afterAi.buckets[aiKey].teamCount, selectedIds })

  if (!seededTest) {
    assert.equal(afterAi.buckets[aiKey].teamCount, 1)
    assert.deepEqual(afterAi.buckets[aiKey].itemCounts[25], { 'life-orb': 1 })
    assert.equal(afterAi.buckets[aiKey].itemSamples[25], 1)
    assert.equal(afterAi.buckets[aiKey].itemSamples[9], 1)
    assert.equal(afterAi.buckets[aiKey].itemCounts[9], undefined, 'An unequipped Pokémon must not acquire a fabricated item')
    await alice.locator('.pokemon-usage-back').click()
    await alice.locator('.mode-collection').click()
    await alice.locator('.pc-party-card').filter({ hasText: '피카츄' }).locator('button').first().click()
    await alice.locator('.pokedex-held-item-button').click()
    await alice.locator('.item-recommendation-card[data-item-id="life-orb"]').waitFor()
    assert.equal(await alice.locator('.item-recommendation-card').count(), 1)
    assert.match(await alice.locator('.item-recommendation-card').textContent(), /100\.0\s*%/)
    assert.equal(await alice.locator('.item-equip-card[data-item-id]').first().getAttribute('data-item-id'), 'life-orb')
    await alice.screenshot({ path: path.join(output, '03-first-play-item-recommendation.png') })
    await alice.getByRole('button', { name: '지닌 도구 선택창 닫기', exact: true }).click()
    await alice.locator('.pc-header .screen-back-button').click()
    await openUsage(alice)
    log('a fresh empty database gains its first real Pokémon/item sample and one 100-percent recommendation after playing', { speciesId: 25, itemId: 'life-orb', beforeTeams: 0, afterTeams: 1, itemSamples: 1 })
  }

  step = 'verify reload and result revisit do not report the same AI battle again'
  const reportsBeforeReload = aiReports.length
  await alice.reload()
  await alice.locator('.mode-usage').waitFor()
  await openUsage(alice)
  await chooseUsage(alice, 'ai', aiState.rules.format.id)
  await verifyRows(alice, afterAi.buckets[aiKey], 'AI reload')
  assert.deepEqual((await live()).buckets[aiKey], afterAi.buckets[aiKey])
  assert.equal(aiReports.length, reportsBeforeReload)
  log('reload and usage refresh preserve the AI count with no duplicate report')

  step = 'prepare second real browser account for ranked matches'
  const bob = await makePage('bob')
  await alice.locator('.pokemon-usage-back').click()
  for (const page of [alice, bob]) {
    await page.locator('.mode-start').click()
    await page.locator('.battle-hub-card.ranked').click()
    await page.getByRole('button', { name: '대전 상대 찾기', exact: true }).waitFor()
  }
  assert.equal(await alice.getByLabel('로컬 테스트 계정').inputValue(), 'alice')
  assert.equal(await bob.getByLabel('로컬 테스트 계정').inputValue(), 'bob')
  await alice.getByLabel('레이팅 출전 팀').selectOption('ranked-test-team-1')
  await bob.getByLabel('레이팅 출전 팀').selectOption('ranked-test-team-2')

  for (const format of ['single', 'double']) {
    step = `actual two-player ${format} ranked selection and first turn`
    const rankedKey = `ranked-${format}`
    const beforeRanked = await live()
    for (const page of [alice, bob]) {
      await page.locator('.ranked-format-tabs').getByRole('button', { name: format === 'single' ? '싱글배틀' : '더블배틀', exact: true }).click()
      await page.getByRole('button', { name: '대전 상대 찾기', exact: true }).click()
    }
    await Promise.all([alice, bob].map(page => page.locator('.ranked-selection-heading').waitFor()))
    assert.deepEqual((await live()).buckets[rankedKey], beforeRanked.buckets[rankedKey], 'Queue and incomplete selection are not samples')
    const count = format === 'single' ? 3 : 4
    for (const page of [alice, bob]) {
      const cards = page.locator('button.ranked-pokemon-card')
      for (let index = 0; index < count; index += 1) await cards.nth(index).click()
      await page.getByRole('button', { name: '선출 확정', exact: true }).click()
      if (page === alice) assert.deepEqual((await live()).buckets[rankedKey], beforeRanked.buckets[rankedKey], 'One selection alone is not a sample')
    }
    await Promise.all([alice, bob].map(waitBattleReady))
    const states = await Promise.all([alice, bob].map(page => page.evaluate(() => window.__usageBattle.battle)))
    const teams = states.map(state => state.player.team.map(member => ({ speciesId: member.speciesId, heldItemId: member.heldItemId || null })))
    const afterRanked = await waitBucket(rankedKey, beforeRanked.buckets[rankedKey].teamCount + 2)
    assert.deepEqual(afterRanked.buckets[rankedKey], recordUsageTeams(beforeRanked.buckets[rankedKey], teams, afterRanked.buckets[rankedKey].updatedAt))
    for (const key of Object.keys(beforeRanked.buckets)) if (key !== rankedKey) assert.deepEqual(afterRanked.buckets[key], beforeRanked.buckets[key])
    await submitMove(alice)
    await submitMove(bob)
    await Promise.all([alice, bob].map((page, index) => page.waitForFunction(turn => window.__usageBattle.battle.turn > turn && !window.__usageBattle.isTurnAnimating, states[index].turn, { timeout: 45_000 })))
    await alice.screenshot({ path: path.join(output, `04-ranked-${format}-actual-turn.png`) })
    await alice.locator('.ranked-battle-connection').getByRole('button', { name: '기권', exact: true }).click()
    await alice.getByRole('button', { name: '기권하기', exact: true }).click()
    await Promise.all([alice, bob].map(page => page.getByRole('button', { name: '레이팅 로비로', exact: true }).waitFor()))
    await Promise.all([alice, bob].map(page => page.getByRole('button', { name: '레이팅 로비로', exact: true }).click()))
    assert.deepEqual((await live()).buckets[rankedKey], afterRanked.buckets[rankedKey], 'Result settlement must not count a team again')
    await alice.locator('.ranked-header .screen-back-button').click()
    await alice.locator('.battle-hub-heading .screen-back-button').click()
    await openUsage(alice)
    await chooseUsage(alice, 'ranked', format)
    await verifyRows(alice, afterRanked.buckets[rankedKey], `ranked ${format} actual play`)
    await alice.screenshot({ path: path.join(output, `05-ranked-${format}-usage-after-battle.png`) })
    log(`real ${format} ranked match, two selections, one turn and result count exactly two teams`, { before: beforeRanked.buckets[rankedKey].teamCount, after: afterRanked.buckets[rankedKey].teamCount, selectedTeams: teams })
    if (format === 'single') {
      await alice.locator('.pokemon-usage-back').click()
      await alice.locator('.mode-start').click()
      await alice.locator('.battle-hub-card.ranked').click()
    }
  }

  }

  step = 'actual settings usage tab stays usable at 844 by 390'
  await alice.locator('.pokemon-usage-back').click()
  await alice.setViewportSize({ width: 844, height: 390 })
  await alice.getByRole('button', { name: '설정', exact: true }).click()
  await alice.getByRole('tab', { name: '사용률', exact: true }).click()
  const embedded = alice.locator('.settings-usage-open .pokemon-usage-screen')
  await embedded.waitFor()
  await alice.waitForFunction(() => document.querySelector('.settings-usage-open .pokemon-usage-panel')?.getAttribute('aria-busy') === 'false')
  if (seededTest) await verifyLeaderCollapse(alice, embedded, '09-settings-844x390')
  await embedded.getByRole('button', { name: '81~100위 보기', exact: true }).click()
  assert.equal(await embedded.locator('.pokemon-usage-row').first().getAttribute('data-usage-rank'), '81')
  assert.equal(await embedded.locator('.pokemon-usage-row').last().getAttribute('data-usage-rank'), '100')
  await embedded.locator('.pokemon-usage-list-scroll').evaluate(element => { element.scrollTop = element.scrollHeight })
  const mobileBounds = await embedded.evaluate(element => {
    const rect = selector => {
      const box = element.querySelector(selector).getBoundingClientRect()
      return { top: box.top, bottom: box.bottom, left: box.left, right: box.right, height: box.height }
    }
    const pageButton = element.querySelector('.pokemon-usage-pagination button[aria-current="page"]')
    const buttonBounds = pageButton.getBoundingClientRect()
    const hit = document.elementFromPoint(buttonBounds.left + buttonBounds.width / 2, buttonBounds.top + buttonBounds.height / 2)
    const modal = element.closest('.settings-modal')
    const modalButton = selector => {
      const button = modal.querySelector(selector)
      const bounds = button.getBoundingClientRect()
      const hitElement = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2)
      return { top: bounds.top, bottom: bounds.bottom, receivesPointer: Boolean(hitElement && button.contains(hitElement)) }
    }
    return { list: rect('.pokemon-usage-list-scroll'), lastRow: rect('[data-usage-rank="100"]'), pagination: rect('.pokemon-usage-pagination'),
      closeButton: modalButton('.settings-close-button'), doneButton: modalButton('.settings-modal-footer button'),
      viewport: { width: innerWidth, height: innerHeight }, pageButtonReceivesPointer: Boolean(hit && pageButton.contains(hit)) }
  })
  assert(mobileBounds.list.height >= mobileBounds.lastRow.height, `The embedded ranking must fit a complete Pokémon row with its items: ${JSON.stringify(mobileBounds)}`)
  assert(mobileBounds.lastRow.top >= mobileBounds.list.top - 1 && mobileBounds.lastRow.bottom <= mobileBounds.list.bottom + 1, `The last ranked row must be reachable within the list: ${JSON.stringify(mobileBounds)}`)
  assert(mobileBounds.pagination.top >= 0 && mobileBounds.pagination.bottom <= 390, `Pagination must be visible without leaving the modal: ${JSON.stringify(mobileBounds)}`)
  assert(mobileBounds.pageButtonReceivesPointer, 'The page buttons must not be covered by another element')
  for (const button of [mobileBounds.closeButton, mobileBounds.doneButton]) {
    assert(button.top >= 0 && button.bottom <= 390 && button.receivesPointer, `Modal close/done buttons must remain on screen and reachable: ${JSON.stringify(mobileBounds)}`)
  }
  await alice.screenshot({ path: path.join(output, '06-mobile-settings-usage-844x390.png') })
  log('actual settings usage tab exposes scrollable rows and reachable bottom pagination at 844x390', mobileBounds)

  assert.equal(pageErrors.length, 0, JSON.stringify(pageErrors))
  log('all game and statistics requests stayed on the isolated loopback servers', { blockedExternalOrigins: [...blockedExternal] })
} catch (error) {
  checks.push({ name: step, passed: false, error: error.stack })
  for (let index = 0; index < pages.length; index += 1) {
    await pages[index].screenshot({ path: path.join(output, `failure-${index}.png`) }).catch(() => {})
    await fs.writeFile(path.join(output, `failure-${index}.txt`), await pages[index].locator('body').innerText().catch(() => '')).catch(() => {})
  }
  console.error(`FAIL ${step}: ${error.stack}`)
  process.exitCode = 1
} finally {
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ validationScope: layoutOnly ? 'layout-and-navigation' : 'real-play-and-layout', checks, pageErrors, aiReports, blockedExternalOrigins: [...blockedExternal], finalUsage: backend ? await live().catch(() => null) : null }, null, 2))
  await browser?.close()
  await frontend?.close()
  if (backend) await backend.close()
  else await store.close()
  for (const name of envNames) if (originalEnv[name] === undefined) delete process.env[name]; else process.env[name] = originalEnv[name]
}
console.log(`Pokémon usage ${layoutOnly ? 'layout' : 'real-play'} UI: ${checks.filter(check => check.passed).length}/${checks.length} checks passed; artifacts: ${output}`)
