import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { resolveChromiumExecutable } from '../promo/scripts/browserRuntime.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const output = new URL('./.cache/boss-challenge-ui/', import.meta.url)
await fs.mkdir(output, { recursive: true })
const require = createRequire(new URL('../promo/package.json', import.meta.url))
const { chromium } = require('playwright')
const entry = `import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import RaidScreen from '/src/RaidScreen.jsx';import {createBossOpponent} from '/src/data/bossChallenge.js';
import '/src/mobileViewport.js';
${['styles', 'screenRedesign', 'battleGen5', 'titleCleanup', 'battleGimmicks', 'moveAnimationDirector', 'settings', 'mobileLandscape', 'mobileTouch', 'mobileUiV2'].map(name => `import '/src/${name}.css';`).join('\n')}
const party=[6,9,3,25,94,149,150].map((speciesId,i)=>createBossOpponent({speciesId},'ui-'+i));
const teams=[{id:'team-1',name:'팀 1',pokemonIds:party.slice(0,6).map(p=>p.captureId)},{id:'team-2',name:'팀 2',pokemonIds:[]}];
function App(){const[active,setActive]=useState(false);const[teamId,setTeamId]=useState('team-2');return <div className={'app-shell'+(active?' battle-view':' raid-view')}><RaidScreen boxPokemon={party} teams={teams} activeTeamId={teamId} onSelectTeam={setTeamId} onOpenBox={()=>{}} onBack={()=>{}} onBattleActiveChange={setActive} soundEnabled={false} gameSettings={{attackAnimation:'skip',hpBarSpeed:'instant'}} /></div>};
createRoot(document.getElementById('root')).render(<App/>);`
const server = await createServer({ root, configFile: false, logLevel: 'error',
  plugins: [(await import('@vitejs/plugin-react')).default(), { name: 'boss-ui-fixture', enforce: 'pre',
    resolveId(id) { if (id === '/boss-ui-entry.jsx') return id },
    load(id) { if (id === '/boss-ui-entry.jsx') return entry },
    transform(code, id) {
      if (id.endsWith('/src/RaidScreen.jsx')) return code.replace('  const active = run?.phase', '  window.__bossRun = () => run; window.__completeBossRound = complete;\n  const active = run?.phase')
      if (id.endsWith('/src/BattleScreen.jsx')) return code.replace('  const [introVisible,', '  window.__bossBattle = () => battle; window.__setBossBattleFixture = setBattle;\n  const [introVisible,')
    },
  }], server: { host: '127.0.0.1', port: 5297, strictPort: true } })
await server.listen()
const browser = await chromium.launch({ executablePath: await resolveChromiumExecutable(chromium), headless: true })
const errors = []
const roundTwoSpeakers = {
  뮤츠: ['비주기'],
  칠색조: ['엔테이', '스이쿤', '라이코'],
  루기아: ['파이어', '프리저', '썬더'],
}
async function verifyRoundOpening(page, bossName, round, viewport) {
  const expectedPortraits = round === 2 ? roundTwoSpeakers[bossName] : [bossName]
  const speaker = expectedPortraits.join(' / ')
  const dialogue = page.locator('.battle-trainer-dialogue-layer')
  await dialogue.waitFor({ state: 'visible' })
  // Freeze the three-second timer while external portraits load and screenshots settle.
  await page.clock.runFor(450)
  assert.equal(await page.locator('#battle-trainer-dialogue-speaker').innerText(), speaker)
  assert((await page.locator('#battle-trainer-dialogue-message').innerText()).trim().length > 0)
  assert.equal(await page.locator('.battle-intro-overlay, .battle-result-overlay').count(), 0)
  assert.equal(await page.getByRole('button', { name: /^(다음 라운드|배틀 개시)$/ }).count(), 0)
  assert.equal(await page.locator('.battle-command-buttons button:disabled').count(), 4, `${speaker}: commands lock during the opening scene`)
  assert.equal(await page.evaluate(() => window.__bossBattle().turn), 1)
  const portraits = page.locator('.battle-trainer-dialogue-sprite img')
  assert.equal(await portraits.count(), expectedPortraits.length)
  const expectedSpeciesIds = round === 2 ? { 칠색조: [244, 245, 243], 루기아: [146, 144, 145] }[bossName] : [{ 뮤츠: 150, 칠색조: 250, 루기아: 249 }[bossName]]
  const portraitNames = expectedSpeciesIds ? await page.evaluate(async ids => {
    const { getSpeciesProfile } = await import('/src/data/trainingData.js')
    return ids.map(id => getSpeciesProfile(id).name)
  }, expectedSpeciesIds) : expectedPortraits
  assert.deepEqual(await portraits.evaluateAll(images => images.map(image => image.closest('[role="img"]').getAttribute('aria-label'))), portraitNames.map(name => `${name} 트레이너`))
  if (speaker === '비주기') assert.match(await portraits.first().getAttribute('src'), /giovanni/)
  else assert(await page.evaluate(() => {
    const members = window.__bossBattle().opponentMeta.portraitMembers
    const images = [...document.querySelectorAll('.battle-trainer-dialogue-sprite img')]
    return images.every((image, index) => members[index].spriteSources.some(source => image.src === new URL(source, location.href).href))
  }), `${speaker}: portraits use the current round's Pokemon sprites`)
  let portraitsLoaded = false
  for (let attempt = 0; attempt < 100 && !portraitsLoaded; attempt++) {
    portraitsLoaded = await portraits.evaluateAll(images => images.length > 0 && images.every(image => image.complete && image.naturalWidth > 0))
    if (!portraitsLoaded) await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert(portraitsLoaded, `${speaker}: all dialogue portraits load`)
  await page.screenshot({ path: fileURLToPath(new URL(`dialogue-${bossName}-${round}-${viewport.width}.png`, output)) })
  const automatic = bossName === '뮤츠' && round === 2 && viewport.width > 1000
  if (automatic) {
    await page.clock.runFor(3000)
    await dialogue.waitFor({ state: 'hidden' })
  } else {
    await page.locator('.battle-trainer-dialogue-box').click()
    await dialogue.waitFor({ state: 'hidden' })
  }
  assert.equal(await page.locator('.battle-command-buttons button:enabled').count(), 4, `${speaker}: commands unlock after the scene`)
  assert.equal(await page.evaluate(() => window.__bossRun().round), round, 'closing a dialogue must not advance another round')
  // A later turn updates this same battle instance; it must not replay the opening.
  await page.evaluate(() => window.__setBossBattleFixture({ ...window.__bossBattle(), turn: 2 }))
  await page.clock.runFor(1)
  assert.equal(await page.evaluate(() => window.__bossBattle().turn), 2)
  assert.equal(await dialogue.count(), 0, `${speaker}: later turns do not replay the opening`)
  assert.equal(await page.locator('.battle-command-buttons button:enabled').count(), 4)
  if (!automatic && bossName === '칠색조' && round === 2 && viewport.width > 1000) {
    await page.clock.runFor(3100)
    assert.equal(await dialogue.count(), 0, 'the manually dismissed scene stays closed after its original timer')
    assert.equal(await page.evaluate(() => window.__bossRun().round), round)
    assert.equal(await page.locator('.battle-command-buttons button:enabled').count(), 4)
  }
  await page.clock.resume()
}

async function assertTacticalDifficultyLabel(page) {
  assert.equal(await page.locator('.rule-difficulty > strong').innerText(), '전술 하드')
  assert((await page.locator('#battle-rule-difficulty-tooltip').textContent()).includes('전용 편성과 강화된 전술'))
}
async function assertHealthyRound(page, round = 1) {
  await assertTacticalDifficultyLabel(page)
  const state = await page.evaluate(() => {
    const battle = window.__bossBattle()
    return { round: window.__bossRun().round, teamSize: battle.player.team.length,
      healthy: battle.player.team.every(pokemon => pokemon.hp === pokemon.maxHp && !pokemon.fainted),
      faintedCount: battle.player.team.filter(pokemon => pokemon.fainted || pokemon.hp <= 0).length,
      activeIndexes: battle.player.activeIndexes }
  })
  assert.deepEqual(state, { round, teamSize: 6, healthy: true, faintedCount: 0, activeIndexes: round === 1 ? [0, 1] : [0] }, `round ${round} heals all six Pokemon and restores the original lead`)
}
async function finishWoundedRound(page, round) {
  return page.evaluate(round => {
    const battle = structuredClone(window.__bossBattle())
    const party = battle.player.team
    // Each round starts with a newly wounded roster: one faint in round 1,
    // then two fresh faints in the fully healed round 2 plus surviving damage.
    for (let index = 0; index < round; index++) {
      party[index].hp = 0
      party[index].fainted = true
    }
    if (round === 1) party[1].hp = Math.ceil(party[1].maxHp * .6)
    party[2].hp = Math.ceil(party[2].maxHp * (round === 1 ? .85 : .6))
    party[4].hp = party[4].maxHp - round * 13
    const health = party.map(({ captureId, hp, maxHp, fainted }) => ({ captureId, hp, maxHp, fainted }))
    const lead = party.find(pokemon => pokemon.hp > 0 && !pokemon.fainted)
    window.__setBossBattleFixture({ ...battle, winner: 'player' })
    return { health, leadCaptureId: lead.captureId, leadName: lead.name }
  }, round)
}
async function assertCarriedHealth(page, expected, round) {
  await assertTacticalDifficultyLabel(page)
  const state = await page.evaluate(() => {
    const battle = window.__bossBattle()
    const lead = battle.player.team[battle.player.activeIndexes[0]]
    return { health: battle.player.team.map(({ captureId, hp, maxHp, fainted }) => ({ captureId, hp, maxHp, fainted })),
      leadCaptureId: lead.captureId, leadName: lead.name, activeCount: battle.player.activeIndexes.length,
      healthyLead: lead.hp > 0 && !lead.fainted, awaitingSwitch: Boolean(battle.awaitingPlayerSwitch) }
  })
  assert.deepEqual(state.health, expected.health, `round ${round}: every owned Pokemon keeps its resolved HP and fainted state`)
  assert.equal(state.leadCaptureId, expected.leadCaptureId, `round ${round}: the next living Pokemon leads`)
  assert.equal(state.leadName, expected.leadName)
  assert.equal(state.activeCount, 1)
  assert.equal(state.healthyLead, true)
  assert.equal(state.awaitingSwitch, false, 'the next round must not open with a forced switch for a fainted lead')
  assert.equal(await page.locator('.battle-hp-panel.side-player header strong').innerText(), expected.leadName)
}

async function verifyHoOhRevivalWaves(page, viewport) {
  const wave = async gate => page.evaluate(async gate => {
    const { beginRaidDamageRoot, applyBattleHpLoss, finishRaidDamageRoot } = await import('/src/data/raidPolicy.js')
    const { getMoveById } = await import('/src/data/trainingData.js')
    const battle = structuredClone(window.__bossBattle())
    const primary = battle.opponent.team.find(pokemon => pokemon.battleId === battle.raid.primaryBossId)
    for (let index = 0; index < 12 && !battle.raid.firedMechanics.includes(gate); index++) {
      beginRaidDamageRoot(battle, `ui-wave-${gate}-${index}`)
      applyBattleHpLoss(battle, primary, 99999)
      finishRaidDamageRoot(battle)
    }
    // Isolate the shield UI from accuracy, opponent damage, and passive item recovery.
    battle.player.team[battle.player.activeIndexes[0]].moves[0] = {
      ...getMoveById('tackle'), currentPp: 20, maxPp: 20, power: 200, accuracy: 100,
    }
    for (const pokemon of battle.opponent.team) {
      pokemon.moves = [{ ...getMoveById('splash'), currentPp: 40, maxPp: 40 }]
      Object.assign(pokemon, { heldItemId: '', heldItemName: '', hadHeldItem: false })
    }
    window.__setBossBattleFixture(battle)
    const support = battle.opponent.team[battle.opponent.activeIndexes[1]]
    return {
      gates: battle.raid.firedMechanics, hp: primary.hp, maxHp: primary.maxHp,
      supportId: support.battleId, supportSpeciesId: support.speciesId, supportName: support.name,
      activeIndexes: battle.opponent.activeIndexes,
      living: battle.opponent.team.filter(pokemon => pokemon.hp > 0 && !pokemon.fainted).length,
      teamLength: battle.opponent.team.length,
    }
  }, gate)
  const assertShield = async gate => {
    const badge = page.locator('.battle-hp-panel.is-boss.is-invulnerable .boss-invulnerability-badge')
    await badge.waitFor({ state: 'visible' })
    assert.equal(await badge.innerText(), '무적')
    assert.equal(await badge.getAttribute('role'), 'status')
    assert.equal(await page.locator('.boss-invulnerability-badge').count(), 1, `${gate}%: only the primary boss is shielded`)
    assert.equal(await page.locator('.battle-hp-panel:not(.is-boss) .boss-invulnerability-badge').count(), 0)
    const boxes = await page.locator('.boss-summons .opponent-status-anchor').evaluateAll(nodes => nodes.map(node => {
      const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width }
    }))
    assert.equal(boxes.length, 2, `${gate}%: only Ho-Oh and the current beast occupy the arena`)
    assert(boxes.every(box => box.width > 0 && box.left >= 0 && box.right <= viewport.width && box.top >= 0 && box.bottom <= viewport.height), JSON.stringify(boxes))
    assert(boxes[0].right <= boxes[1].left, JSON.stringify(boxes))
    assert.equal(await page.locator('.boss-summons .opponent-status-anchor.slot-2').count(), 0)
    await page.screenshot({ path: fileURLToPath(new URL(`hooh-shield-${gate}-${viewport.width}.png`, output)) })
  }
  const openTargets = async supportName => {
    await page.getByRole('button', { name: /싸운다/ }).click()
    await page.locator('.battle-move-button').first().click()
    await page.locator('.battle-target-card').first().waitFor({ state: 'visible' })
    const targets = page.locator('.battle-target-card')
    assert.equal(await targets.count(), 2)
    const primaryTarget = targets.filter({ has: page.locator('.battle-target-info > strong', { hasText: '칠색조' }) })
    const supportTarget = targets.filter({ has: page.locator('.battle-target-info > strong', { hasText: supportName }) })
    assert.equal(await primaryTarget.count(), 1)
    assert.equal(await supportTarget.count(), 1)
    const shield = primaryTarget.locator('.battle-target-effectiveness.is-shielded')
    for (const label of ['보호', '무적', '부활 포켓몬 처치 후 해제']) assert((await shield.innerText()).includes(label))
    assert.match(await primaryTarget.getAttribute('aria-label'), /무적 상태/)
    assert.equal(await supportTarget.locator('.is-shielded').count(), 0)
    assert(!(await supportTarget.getAttribute('aria-label')).includes('무적 상태'))
    return { primaryTarget, supportTarget }
  }
  const finishUiTurn = async (target, previousTurn) => {
    await target.click({ timeout: 60000 })
    await page.waitForFunction(previousTurn => window.__bossBattle().turn > previousTurn
      && document.querySelectorAll('.battle-command-buttons button:enabled').length === 4, previousTurn, { timeout: 60000 })
    assert.equal(await page.locator('.battle-trainer-dialogue-layer').count(), 0, 'a resolved battle turn must not replay the opening')
  }
  const first = await wave(50)
  assert.deepEqual(first.gates, [75, 50])
  assert.equal(first.hp, Math.floor(first.maxHp / 2))
  assert.equal(first.living, 2)
  assert.equal(first.teamLength, 2)
  await assertShield(50)
  const firstTargets = await openTargets(first.supportName)
  await page.screenshot({ path: fileURLToPath(new URL(`hooh-shield-targets-${viewport.width}.png`, output)) })
  await finishUiTurn(firstTargets.primaryTarget, await page.evaluate(() => window.__bossBattle().turn))
  const blocked = await page.evaluate(() => {
    const battle = window.__bossBattle()
    return { hp: battle.opponent.team[0].hp, gates: battle.raid.firedMechanics, crossed: battle.raid.crossedGates,
      protected: battle.raid.events.some(event => event.kind === 'damage-protection' && event.message.includes('부활한')),
      log: battle.log.slice(-8).map(entry => entry.message) }
  })
  assert.equal(blocked.hp, first.hp, 'an actual attack against the 50% shield deals no HP damage')
  assert.deepEqual(blocked.gates, [75, 50], 'the first beast must be defeated before the 25% wave')
  assert(!blocked.crossed.includes(25))
  assert(blocked.protected, `the real attack passes through raid damage protection: ${JSON.stringify(blocked)}`)
  // Resolve an actual engine attack to remove the first beast, retaining faint history.
  const firstDefeat = await page.evaluate(async () => {
    const { playBattleTurnWithActions } = await import('/src/data/battleEngine.js')
    const { isBossShielded } = await import('/src/data/raidPolicy.js')
    const battle = structuredClone(window.__bossBattle())
    const index = battle.opponent.activeIndexes[1]
    battle.opponent.team[index].hp = 1
    const next = playBattleTurnWithActions(battle, [{ type: 'move', actorSlot: 0, moveIndex: 0, targetSideId: 'opponent', targetSlot: 1 }], [], () => .1)
    window.__setBossBattleFixture(next)
    return { hp: next.opponent.team[index].hp, fainted: next.opponent.team[index].fainted, shielded: isBossShielded(next), bossHp: next.opponent.team[0].hp }
  })
  assert.deepEqual(firstDefeat, { hp: 0, fainted: true, shielded: false, bossHp: first.hp })
  await page.locator('.boss-invulnerability-badge').waitFor({ state: 'detached' })
  const second = await wave(25)
  assert.deepEqual(second.gates, [75, 50, 25])
  assert.equal(second.hp, Math.floor(second.maxHp / 4))
  assert.notEqual(second.supportSpeciesId, first.supportSpeciesId)
  assert.notEqual(second.supportId, first.supportId)
  assert.equal(second.living, 2)
  assert.equal(second.teamLength, 3, 'the defeated first beast remains in roster history')
  assert.deepEqual(second.activeIndexes, [0, 2], 'the second beast reuses support slot 1')
  await assertShield(25)
  await page.evaluate(() => {
    const battle = structuredClone(window.__bossBattle())
    battle.opponent.team[battle.opponent.activeIndexes[1]].hp = 1
    window.__setBossBattleFixture(battle)
  })
  const secondTargets = await openTargets(second.supportName)
  assert.equal(await page.locator('.battle-target-card').filter({ has: page.locator('.battle-target-info > strong', { hasText: first.supportName }) }).count(), 0, 'the defeated first beast is not targetable')
  await finishUiTurn(secondTargets.supportTarget, await page.evaluate(() => window.__bossBattle().turn))
  await page.locator('.boss-invulnerability-badge').waitFor({ state: 'detached' })
  const ended = await page.evaluate(() => {
    const battle = window.__bossBattle()
    return { hp: battle.opponent.team[2].hp, fainted: battle.opponent.team[2].fainted, bossHp: battle.opponent.team[0].hp,
      living: battle.opponent.team.filter(pokemon => pokemon.hp > 0 && !pokemon.fainted).length }
  })
  assert.deepEqual(ended, { hp: 0, fainted: true, bossHp: second.hp, living: 1 })
}

try {
  const html = await server.transformIndexHtml('/boss-ui.html', '<html><head><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body><div id="root"></div><script type="module" src="/boss-ui-entry.jsx"></script></body></html>')
  for (const viewport of [{ width: 1440, height: 900 }, { width: 844, height: 390 }]) {
    const page = await browser.newPage({ viewport, hasTouch: viewport.width < 1000, isMobile: viewport.width < 1000 })
    page.on('pageerror', error => errors.push(error.message))
    await page.clock.install()
    await page.route('**/boss-ui.html', route => route.fulfill({ contentType: 'text/html', body: html }))
    await page.goto('http://127.0.0.1:5297/boss-ui.html')
    await page.getByRole('heading', { name: '보스전', exact: true }).waitFor()
    assert.equal(await page.getByText('방 만들기', { exact: true }).count(), 0)
    const start = page.locator('.boss-start-footer button')
    assert(await start.isDisabled())
    await page.locator('.boss-team-switcher button').first().click()
    assert.equal(await page.locator('.boss-party-roster > .ranked-pokemon-card').count(), 6)
    assert.equal(await page.locator('.boss-party-roster button').count(), 6)
    assert.equal(await page.locator('.boss-party-loadout').count(), 6)
    const firstCard = page.locator('.boss-party-roster button').first()
    if (viewport.width < 1000) await firstCard.tap()
    else await firstCard.hover()
    const tooltip = page.getByRole('tooltip')
    await tooltip.waitFor({ state: 'visible' })
    for (const label of ['지닌 도구', '테라타입', '다이맥스', '특성', '성격', '배틀 기술']) assert((await tooltip.innerText()).includes(label))
    const tipBounds = await tooltip.boundingBox()
    assert(tipBounds.x >= 0 && tipBounds.y >= 0 && tipBounds.x + tipBounds.width <= viewport.width && tipBounds.y + tipBounds.height <= viewport.height)
    await page.keyboard.press('Escape')
    await tooltip.waitFor({ state: 'hidden' })
    assert(!(await start.isDisabled()))
    assert.equal(await page.locator('.boss-challenge-rules').count(), 0)
    const teamBounds = await page.locator('.boss-challenge-party').boundingBox()
    const bossBounds = await page.locator('.boss-selection-panel').boundingBox()
    const startBounds = await start.boundingBox()
    assert(teamBounds.x + teamBounds.width <= bossBounds.x, 'team and boss panels must not overlap')
    assert(startBounds.y + startBounds.height <= viewport.height, 'challenge button must be visible without scrolling')
    await page.screenshot({ path: fileURLToPath(new URL(`selection-${viewport.width}.png`, output)), fullPage: true })
    for (const name of ['뮤츠', '칠색조', '루기아']) {
      await page.getByRole('button', { name: new RegExp(name) }).filter({ has: page.locator('strong') }).first().click()
      await start.click()
      await page.waitForFunction(() => window.__bossRun()?.phase === 'battle')
      const portrait = page.locator('.battle-intro-trainer.opponent .battle-intro-trainer-sprite')
      await portrait.waitFor({ state: 'visible' })
      await page.waitForFunction(() => {
        const images = [...document.querySelectorAll('.battle-intro-trainer.opponent .battle-intro-trainer-sprite img')]
        return images.length > 0 && images.every(img => img.complete && img.naturalWidth > 0)
      })
      assert.equal(await portrait.locator('img').count(), name === '뮤츠' ? 1 : 2)
      await page.screenshot({ path: fileURLToPath(new URL(`trainers-${name}-${viewport.width}.png`, output)) })
      await assertHealthyRound(page)
      // Carry the resolved roster through the actual BattleScreen completion callback.
      await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now()) + 100))
      await finishWoundedRound(page, 1)
      assert.equal(await page.getByRole('button', { name: '다음 라운드' }).count(), 0)
      await page.locator('.battle-trainer-dialogue-layer').waitFor({ state: 'visible' })
      assert.equal(await page.evaluate(() => window.__bossRun().round), 2)
      assert.equal(await page.evaluate(() => window.__bossBattle().opponent.team.length), name === '뮤츠' ? 6 : 3)
      await assertHealthyRound(page, 2)
      await verifyRoundOpening(page, name, 2, viewport)
      if (name === '뮤츠') await page.screenshot({ path: fileURLToPath(new URL(`healed-round-2-${viewport.width}.png`, output)) })
      await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now()) + 100))
      const afterRoundTwo = await finishWoundedRound(page, 2)
      assert.equal(await page.getByRole('button', { name: '다음 라운드' }).count(), 0)
      await page.locator('.battle-trainer-dialogue-layer').waitFor({ state: 'visible' })
      assert.equal(await page.evaluate(() => window.__bossBattle().raid.phase), 3)
      await assertCarriedHealth(page, afterRoundTwo, 3)
      await verifyRoundOpening(page, name, 3, viewport)
      if (name === '뮤츠') await page.screenshot({ path: fileURLToPath(new URL(`carryover-round-3-${viewport.width}.png`, output)) })
      assert.equal(await page.locator('.boss-invulnerability-badge').count(), 0, 'a full-health final boss starts without a shield')
      if (name === '칠색조') await verifyHoOhRevivalWaves(page, viewport)
      await page.evaluate(() => window.__setBossBattleFixture({ ...window.__bossBattle(), winner: 'player' }))
      await page.getByRole('heading', { name: `${name} 격파 성공!` }).waitFor()
      await page.getByRole('button', { name: '다시 준비하기' }).click()
    }
    await start.click()
    await page.waitForFunction(() => window.__bossRun()?.phase === 'battle')
    await assertHealthyRound(page)
    await page.evaluate(() => {
      const battle = structuredClone(window.__bossBattle())
      for (const pokemon of battle.player.team) { pokemon.hp = 0; pokemon.fainted = true }
      window.__setBossBattleFixture({ ...battle, winner: 'opponent' })
    })
    await page.getByRole('heading', { name: '도전 종료' }).waitFor()
    assert.equal(await page.getByRole('button', { name: '다음 라운드' }).count(), 0)
    await page.getByRole('button', { name: '다시 준비하기' }).click()
    await start.click()
    await page.waitForFunction(() => window.__bossRun()?.phase === 'battle')
    await assertHealthyRound(page)
    console.log(`PASS ${viewport.width}x${viewport.height}: healthy starts/retry, full healing at 1→2, HP and faint carryover at 2→3, living leads, all opponent dialogues, sequential Ho-Oh shields/target selection, defeat`)
    await page.close()
  }
  assert.deepEqual(errors, [])
} finally { await browser.close(); await server.close() }
