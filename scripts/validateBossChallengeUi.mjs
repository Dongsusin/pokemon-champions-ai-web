import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer, transformWithEsbuild } from 'vite'
import { resolveChromiumExecutable } from '../promo/scripts/browserRuntime.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const output = new URL('./.cache/boss-challenge-ui/', import.meta.url)
await fs.mkdir(output, { recursive: true })
const require = createRequire(new URL('../promo/package.json', import.meta.url))
const { chromium } = require('playwright')
const gameEntry = await fs.readFile(new URL('../src/gameEntry.jsx', import.meta.url), 'utf8')
const styles = [...gameEntry.matchAll(/import ['"]\.\/([^'"]+\.css)['"]/g)].map(match => `import '/src/${match[1]}';`).join('\n')
const entry = `import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import RaidScreen from '/src/RaidScreen.jsx';import {createBossOpponent} from '/src/data/bossChallenge.js';
import {GameApp} from '/src/App.jsx';import {createSavedTeams} from '/src/data/teamData.js';
import '/src/mobileViewport.js';
${styles}
const party=[6,9,3,25,94,149,150].map((speciesId,i)=>({...createBossOpponent({speciesId},'ui-'+i),directDrawCount:1}));
const teams=[{id:'team-1',name:'팀 1',pokemonIds:party.slice(0,6).map(p=>p.captureId)},{id:'team-2',name:'팀 2',pokemonIds:[]}];
function App(){
  const[active,setActive]=useState(false),[teamId,setTeamId]=useState('team-2'),[screen,setScreen]=useState('boss'),[exits,setExits]=useState(0);
  window.__bossUiState=()=>({active,screen,exits});
  const exit=()=>{setExits(value=>value+1);setScreen('lobby')};
  return <div className={'app-shell'+(active?' battle-view':screen==='boss'?' raid-view':'')}>
    {screen==='boss'?<RaidScreen boxPokemon={party} teams={teams} activeTeamId={teamId} onSelectTeam={setTeamId} onOpenBox={()=>{}} onBack={exit} onExit={exit} onBattleActiveChange={setActive} soundEnabled={false} gameSettings={{attackAnimation:'skip',hpBarSpeed:'instant'}} />:
      <main className="lobby-layout"><h1>플레이 메뉴</h1><button type="button" onClick={()=>setScreen('boss')}>보스전 입장</button></main>}
  </div>
};
const fullGame=new URLSearchParams(location.search).has('fullgame');
if(fullGame){
  const owned=party.map(p=>({...p,captureId:'dex-'+p.speciesId})),ids=owned.map(p=>p.captureId),team=ids.slice(0,6);
  localStorage.setItem('champions-dex-v2',JSON.stringify(owned));
  localStorage.setItem('champions-teams-v1',JSON.stringify({version:1,activeTeamId:'team-1',teams:createSavedTeams(team,ids)}));
  localStorage.setItem('champions-team-v2',JSON.stringify(team));
  localStorage.setItem('champions-vp-v1','100000');
  localStorage.setItem('champions-draw-tutorial-v1','complete');
  localStorage.setItem('champions-settings-v1',JSON.stringify({game:{textScale:1,attackAnimation:'skip',hpBarSpeed:'instant'},audio:{enabled:false}}));
}
createRoot(document.getElementById('root')).render(fullGame?<GameApp user={{uid:'boss-exit-ui',displayName:'보스전 테스트',isLocalGuest:true,isAnonymous:true,providerData:[]}} autoLogin={false} onPlayerDataChanged={()=>{}} onSyncBeforeRanked={async()=>false} onSignOut={()=>{}}/>:<App/>);`
// Compile the JSX fixture before returning a virtual module: Vite intentionally
// skips its usual esbuild transform for null-prefixed module IDs.
const compiledEntry = (await transformWithEsbuild(entry, 'boss-ui-entry.jsx', { loader: 'jsx', jsx: 'automatic' })).code
const server = await createServer({ root, configFile: false, logLevel: 'error', cacheDir: 'scripts/.cache/boss-ui-vite',
  plugins: [(await import('@vitejs/plugin-react')).default(), { name: 'boss-ui-fixture', enforce: 'pre',
    resolveId(id) {
      if (id === './gameEntry.jsx' || id.replaceAll('\\', '/').endsWith('/src/gameEntry.jsx')) return '\0boss-ui-entry'
      if (/\/auth\/firebaseClient(?:\.js)?$/.test(id) || id === './firebaseClient' || id === './firebaseClient.js') return '\0boss-ui-offline-auth'
    },
    load(id) {
      if (id === '\0boss-ui-entry') return compiledEntry
      if (id === '\0boss-ui-offline-auth') return 'export const firebaseAuth=null;export const firebaseDb=null;export const isFirebaseConfigured=false;export const missingFirebaseEnvironmentVariables=[];'
    },
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
async function watchResultPanels(frame) {
  await frame.evaluate(() => {
    window.__bossResultPanels = []
    window.__bossResultObserver?.disconnect()
    const selector = '.boss-challenge-result, .battle-result-overlay'
    window.__bossResultObserver = new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) {
        if (node.nodeType === 1 && (node.matches(selector) || node.querySelector(selector))) window.__bossResultPanels.push(node.textContent)
      }
    })
    window.__bossResultObserver.observe(document.body, { childList: true, subtree: true })
  })
}
async function assertMainLobby(frame, label, exits) {
  await frame.getByRole('heading', { name: '플레이 메뉴', exact: true }).waitFor({ timeout: 5000 })
  assert.equal(await frame.locator('.boss-challenge, .battle-game-screen, .battle-hub, .boss-challenge-result, .battle-result-overlay').count(), 0, `${label}: return directly to the main lobby`)
  assert.equal(await frame.locator('.app-shell.battle-view, .app-shell.raid-view').count(), 0, `${label}: clear battle layout state on exit`)
  assert.deepEqual(await frame.evaluate(() => window.__bossResultPanels), [], `${label}: a result panel must never be mounted, even briefly`)
  if (exits !== undefined) assert.deepEqual(await frame.evaluate(() => window.__bossUiState()), { active: false, screen: 'lobby', exits }, `${label}: notify the parent of exactly one terminal exit`)
}
async function freezeEnding(frame, page) {
  // With the game clock stopped, lobby arrival proves there is no result timer
  // or delayed transition to advance before the player can use the lobby.
  await page.clock.pauseAt(new Date(await frame.evaluate(() => Date.now()) + 100))
}
async function openFullGameBoss(frame, name) {
  await frame.getByRole('button', { name: /시작하기/ }).click()
  await frame.getByRole('tab', { name: '보스전', exact: true }).click()
  await frame.getByRole('button', { name: '보스전에 도전', exact: true }).click()
  await frame.locator('.boss-selection-workspace').waitFor()
  assert.equal(await frame.evaluate(() => window.__bossRun()), null, 're-entering the actual GameApp creates a fresh challenge')
  await frame.locator('.boss-challenge-choices > button').filter({ has: frame.getByText(name, { exact: true }) }).click()
  await frame.locator('.boss-start-footer button').click()
  await frame.waitForFunction(() => window.__bossRun()?.round === 1 && window.__bossRun()?.phase === 'battle')
  await assertHealthyRound(frame)
}
async function forfeitThroughUi(frame) {
  const intro = frame.getByRole('button', { name: '배틀 개시', exact: true })
  if (await intro.count()) await intro.click()
  const dialogue = frame.locator('.battle-trainer-dialogue-box')
  if (await dialogue.count()) await dialogue.click()
  await frame.locator('.battle-command-buttons .surrender').click()
  await frame.getByRole('dialog', { name: '대전 기권 확인', exact: true }).waitFor()
  await frame.getByRole('button', { name: '기권하기', exact: true }).click()
}
async function verifyRoundOpening(frame, page, bossName, round, viewport) {
  const expectedPortraits = round === 2 ? roundTwoSpeakers[bossName] : [bossName]
  const speaker = expectedPortraits.join(' / ')
  const dialogue = frame.locator('.battle-trainer-dialogue-layer')
  await dialogue.waitFor({ state: 'visible' })
  // Freeze the three-second timer while external portraits load and screenshots settle.
  await page.clock.runFor(450)
  assert.equal(await frame.locator('#battle-trainer-dialogue-speaker').innerText(), speaker)
  assert((await frame.locator('#battle-trainer-dialogue-message').innerText()).trim().length > 0)
  assert.equal(await frame.locator('.battle-intro-overlay, .battle-result-overlay').count(), 0)
  assert.equal(await frame.getByRole('button', { name: /^(다음 라운드|배틀 개시)$/ }).count(), 0)
  assert.equal(await frame.locator('.battle-command-buttons button:disabled').count(), 4, `${speaker}: commands lock during the opening scene`)
  assert.equal(await frame.evaluate(() => window.__bossBattle().turn), 1)
  const portraits = frame.locator('.battle-trainer-dialogue-sprite img')
  assert.equal(await portraits.count(), expectedPortraits.length)
  const expectedSpeciesIds = round === 2 ? { 칠색조: [244, 245, 243], 루기아: [146, 144, 145] }[bossName] : [{ 뮤츠: 150, 칠색조: 250, 루기아: 249 }[bossName]]
  const portraitNames = expectedSpeciesIds ? await frame.evaluate(async ids => {
    const { getSpeciesProfile } = await import('/src/data/trainingData.js')
    return ids.map(id => getSpeciesProfile(id).name)
  }, expectedSpeciesIds) : expectedPortraits
  assert.deepEqual(await portraits.evaluateAll(images => images.map(image => image.closest('[role="img"]').getAttribute('aria-label'))), portraitNames.map(name => `${name} 트레이너`))
  if (speaker === '비주기') assert.match(await portraits.first().getAttribute('src'), /giovanni/)
  else assert(await frame.evaluate(() => {
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
    await frame.locator('.battle-trainer-dialogue-box').click()
    await dialogue.waitFor({ state: 'hidden' })
  }
  assert.equal(await frame.locator('.battle-command-buttons button:enabled').count(), 4, `${speaker}: commands unlock after the scene`)
  assert.equal(await frame.evaluate(() => window.__bossRun().round), round, 'closing a dialogue must not advance another round')
  // A later turn updates this same battle instance; it must not replay the opening.
  await frame.evaluate(() => window.__setBossBattleFixture({ ...window.__bossBattle(), turn: 2 }))
  await page.clock.runFor(1)
  assert.equal(await frame.evaluate(() => window.__bossBattle().turn), 2)
  assert.equal(await dialogue.count(), 0, `${speaker}: later turns do not replay the opening`)
  assert.equal(await frame.locator('.battle-command-buttons button:enabled').count(), 4)
  if (!automatic && bossName === '칠색조' && round === 2 && viewport.width > 1000) {
    await page.clock.runFor(3100)
    assert.equal(await dialogue.count(), 0, 'the manually dismissed scene stays closed after its original timer')
    assert.equal(await frame.evaluate(() => window.__bossRun().round), round)
    assert.equal(await frame.locator('.battle-command-buttons button:enabled').count(), 4)
  }
  await page.clock.resume()
}

async function assertTacticalDifficultyLabel(frame) {
  assert.equal(await frame.locator('.rule-difficulty > strong').innerText(), '전술 하드')
  assert((await frame.locator('#battle-rule-difficulty-tooltip').textContent()).includes('전용 편성과 강화된 전술'))
}
async function assertHealthyRound(frame, round = 1) {
  await assertTacticalDifficultyLabel(frame)
  const state = await frame.evaluate(() => {
    const battle = window.__bossBattle()
    return { round: window.__bossRun().round, teamSize: battle.player.team.length,
      healthy: battle.player.team.every(pokemon => pokemon.hp === pokemon.maxHp && !pokemon.fainted),
      faintedCount: battle.player.team.filter(pokemon => pokemon.fainted || pokemon.hp <= 0).length,
      activeIndexes: battle.player.activeIndexes }
  })
  assert.deepEqual(state, { round, teamSize: 6, healthy: true, faintedCount: 0, activeIndexes: round === 1 ? [0, 1] : [0] }, `round ${round} heals all six Pokemon and restores the original lead`)
}
async function finishWoundedRound(frame, round) {
  return frame.evaluate(round => {
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
async function assertCarriedHealth(frame, expected, round) {
  await assertTacticalDifficultyLabel(frame)
  const state = await frame.evaluate(() => {
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
  assert.equal(await frame.locator('.battle-hp-panel.side-player header strong').innerText(), expected.leadName)
}

async function verifyHoOhRevivalWaves(frame, page, viewport) {
  const canvas = await frame.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  const wave = async gate => frame.evaluate(async gate => {
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
    const badge = frame.locator('.battle-hp-panel.is-boss.is-invulnerable .boss-invulnerability-badge')
    await badge.waitFor({ state: 'visible' })
    assert.equal(await badge.innerText(), '무적')
    assert.equal(await badge.getAttribute('role'), 'status')
    assert.equal(await frame.locator('.boss-invulnerability-badge').count(), 1, `${gate}%: only the primary boss is shielded`)
    assert.equal(await frame.locator('.battle-hp-panel:not(.is-boss) .boss-invulnerability-badge').count(), 0)
    const boxes = await frame.locator('.boss-summons .opponent-status-anchor').evaluateAll(nodes => nodes.map(node => {
      const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width }
    }))
    assert.equal(boxes.length, 2, `${gate}%: only Ho-Oh and the current beast occupy the arena`)
    assert(boxes.every(box => box.width > 0 && box.left >= 0 && box.right <= canvas.width && box.top >= 0 && box.bottom <= canvas.height), JSON.stringify(boxes))
    assert(boxes[0].right <= boxes[1].left, JSON.stringify(boxes))
    assert.equal(await frame.locator('.boss-summons .opponent-status-anchor.slot-2').count(), 0)
    await page.screenshot({ path: fileURLToPath(new URL(`hooh-shield-${gate}-${viewport.width}.png`, output)) })
  }
  const openTargets = async supportName => {
    await frame.getByRole('button', { name: /싸운다/ }).click()
    await frame.locator('.battle-move-button').first().click()
    await frame.locator('.battle-target-card').first().waitFor({ state: 'visible' })
    const targets = frame.locator('.battle-target-card')
    assert.equal(await targets.count(), 2)
    const primaryTarget = targets.filter({ has: frame.locator('.battle-target-info > strong', { hasText: '칠색조' }) })
    const supportTarget = targets.filter({ has: frame.locator('.battle-target-info > strong', { hasText: supportName }) })
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
    await frame.waitForFunction(previousTurn => window.__bossBattle().turn > previousTurn
      && document.querySelectorAll('.battle-command-buttons button:enabled').length === 4, previousTurn, { timeout: 60000 })
    assert.equal(await frame.locator('.battle-trainer-dialogue-layer').count(), 0, 'a resolved battle turn must not replay the opening')
  }
  const first = await wave(50)
  assert.deepEqual(first.gates, [75, 50])
  assert.equal(first.hp, Math.floor(first.maxHp / 2))
  assert.equal(first.living, 2)
  assert.equal(first.teamLength, 2)
  await assertShield(50)
  const firstTargets = await openTargets(first.supportName)
  await page.screenshot({ path: fileURLToPath(new URL(`hooh-shield-targets-${viewport.width}.png`, output)) })
  await finishUiTurn(firstTargets.primaryTarget, await frame.evaluate(() => window.__bossBattle().turn))
  const blocked = await frame.evaluate(() => {
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
  const firstDefeat = await frame.evaluate(async () => {
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
  await frame.locator('.boss-invulnerability-badge').waitFor({ state: 'detached' })
  const second = await wave(25)
  assert.deepEqual(second.gates, [75, 50, 25])
  assert.equal(second.hp, Math.floor(second.maxHp / 4))
  assert.notEqual(second.supportSpeciesId, first.supportSpeciesId)
  assert.notEqual(second.supportId, first.supportId)
  assert.equal(second.living, 2)
  assert.equal(second.teamLength, 3, 'the defeated first beast remains in roster history')
  assert.deepEqual(second.activeIndexes, [0, 2], 'the second beast reuses support slot 1')
  await assertShield(25)
  await frame.evaluate(() => {
    const battle = structuredClone(window.__bossBattle())
    battle.opponent.team[battle.opponent.activeIndexes[1]].hp = 1
    window.__setBossBattleFixture(battle)
  })
  const secondTargets = await openTargets(second.supportName)
  assert.equal(await frame.locator('.battle-target-card').filter({ has: frame.locator('.battle-target-info > strong', { hasText: first.supportName }) }).count(), 0, 'the defeated first beast is not targetable')
  await finishUiTurn(secondTargets.supportTarget, await frame.evaluate(() => window.__bossBattle().turn))
  await frame.locator('.boss-invulnerability-badge').waitFor({ state: 'detached' })
  const ended = await frame.evaluate(() => {
    const battle = window.__bossBattle()
    return { hp: battle.opponent.team[2].hp, fainted: battle.opponent.team[2].fainted, bossHp: battle.opponent.team[0].hp,
      living: battle.opponent.team.filter(pokemon => pokemon.hp > 0 && !pokemon.fainted).length }
  })
  assert.deepEqual(ended, { hp: 0, fainted: true, bossHp: second.hp, living: 1 })
}

try {
  const html = await server.transformIndexHtml('/boss-ui.html', '<html><head><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>')
  for (const viewport of process.argv.includes('--full-game-only') ? [] : [{ width: 1440, height: 900 }, { width: 844, height: 390 }]) {
    const page = await browser.newPage({ viewport, hasTouch: viewport.width < 1000, isMobile: viewport.width < 1000, reducedMotion: 'reduce' })
    page.on('pageerror', error => { errors.push(error.message); console.error(`Browser error: ${error.message}`) })
    await page.clock.install()
    await page.route('**/boss-ui.html', route => route.fulfill({ contentType: 'text/html', body: html }))
    await page.goto('http://127.0.0.1:5297/boss-ui.html')
    const frame = await (await page.locator('iframe[data-game-frame]').elementHandle()).contentFrame()
    assert(frame, 'The production fixed game frame is mounted')
    assert.deepEqual(await frame.evaluate(() => ({ width: innerWidth, height: innerHeight })), viewport.width < 1000 ? { width: 960, height: 540 } : { width: 1600, height: 900 })
    await frame.getByRole('heading', { name: '보스전', exact: true }).waitFor().catch(async error => {
      await page.screenshot({ path: fileURLToPath(new URL(`startup-failure-${viewport.width}.png`, output)) })
      throw error
    })
    await watchResultPanels(frame)
    let exits = 0
    const reenter = async () => {
      await page.clock.resume()
      const enter = frame.getByRole('button', { name: '보스전 입장', exact: true })
      if (viewport.width < 1000) await enter.tap()
      else await enter.click()
      await frame.locator('.boss-selection-workspace').waitFor()
      // The fixture's small lobby button can occupy the next screen's roster
      // coordinates. Clear the synthetic mouse hover before choosing a boss.
      await page.mouse.move(0, 0)
      await page.keyboard.press('Escape')
      await frame.getByRole('tooltip').waitFor({ state: 'hidden' })
      assert.equal(await frame.evaluate(() => window.__bossRun()), null, 're-entry must not resume the completed run')
    }
    assert.equal(await frame.getByText('방 만들기', { exact: true }).count(), 0)
    const start = frame.locator('.boss-start-footer button')
    assert(await start.isDisabled())
    await frame.locator('.boss-team-switcher button').first().click()
    assert.equal(await frame.locator('.boss-party-roster > .ranked-pokemon-card').count(), 6)
    assert.equal(await frame.locator('.boss-party-roster button').count(), 6)
    assert.equal(await frame.locator('.boss-party-loadout').count(), 6)
    const firstCard = frame.locator('.boss-party-roster button').first()
    if (viewport.width < 1000) await firstCard.tap()
    else await firstCard.hover()
    const tooltip = frame.getByRole('tooltip')
    await tooltip.waitFor({ state: 'visible' })
    const tooltipLabels = ['지닌 도구', '테라타입', '다이맥스', '특성', '성격', '배틀 기술']
    await frame.waitForFunction(labels => labels.every(label => document.querySelector('.ranked-pokemon-tooltip')?.innerText.includes(label)), tooltipLabels)
    const tooltipText = await tooltip.innerText()
    for (const label of tooltipLabels) assert(tooltipText.includes(label), `Missing tooltip label ${label}: ${tooltipText}`)
    const tipBounds = await tooltip.boundingBox()
    assert(tipBounds.x >= 0 && tipBounds.y >= 0 && tipBounds.x + tipBounds.width <= viewport.width && tipBounds.y + tipBounds.height <= viewport.height)
    await page.keyboard.press('Escape')
    await tooltip.waitFor({ state: 'hidden' })
    assert(!(await start.isDisabled()))
    assert.equal(await frame.locator('.boss-challenge-rules').count(), 0)
    const teamBounds = await frame.locator('.boss-challenge-party').boundingBox()
    const bossBounds = await frame.locator('.boss-selection-panel').boundingBox()
    const startBounds = await start.boundingBox()
    assert(teamBounds.x + teamBounds.width <= bossBounds.x, 'team and boss panels must not overlap')
    assert(startBounds.y + startBounds.height <= viewport.height, 'challenge button must be visible without scrolling')
    await page.screenshot({ path: fileURLToPath(new URL(`selection-${viewport.width}.png`, output)), fullPage: true })
    for (const name of ['뮤츠', '칠색조', '루기아']) {
      await frame.getByRole('button', { name: new RegExp(name) }).filter({ has: frame.locator('strong') }).first().click()
      await start.click()
      await frame.waitForFunction(() => window.__bossRun()?.phase === 'battle')
      const portrait = frame.locator('.battle-intro-trainer.opponent .battle-intro-trainer-sprite')
      await portrait.waitFor({ state: 'visible' })
      await frame.waitForFunction(() => {
        const images = [...document.querySelectorAll('.battle-intro-trainer.opponent .battle-intro-trainer-sprite img')]
        return images.length > 0 && images.every(img => img.complete && img.naturalWidth > 0)
      })
      assert.equal(await portrait.locator('img').count(), name === '뮤츠' ? 1 : 2)
      await page.screenshot({ path: fileURLToPath(new URL(`trainers-${name}-${viewport.width}.png`, output)) })
      await assertHealthyRound(frame)
      // Carry the resolved roster through the actual BattleScreen completion callback.
      await page.clock.pauseAt(new Date(await frame.evaluate(() => Date.now()) + 100))
      await finishWoundedRound(frame, 1)
      assert.equal(await frame.getByRole('button', { name: '다음 라운드' }).count(), 0)
      await frame.locator('.battle-trainer-dialogue-layer').waitFor({ state: 'visible' })
      assert.equal(await frame.evaluate(() => window.__bossRun().round), 2)
      assert.equal(await frame.evaluate(() => window.__bossBattle().opponent.team.length), name === '뮤츠' ? 6 : 3)
      await assertHealthyRound(frame, 2)
      await verifyRoundOpening(frame, page, name, 2, viewport)
      if (name === '뮤츠') await page.screenshot({ path: fileURLToPath(new URL(`healed-round-2-${viewport.width}.png`, output)) })
      await page.clock.pauseAt(new Date(await frame.evaluate(() => Date.now()) + 100))
      const afterRoundTwo = await finishWoundedRound(frame, 2)
      assert.equal(await frame.getByRole('button', { name: '다음 라운드' }).count(), 0)
      await frame.locator('.battle-trainer-dialogue-layer').waitFor({ state: 'visible' })
      assert.equal(await frame.evaluate(() => window.__bossBattle().raid.phase), 3)
      await assertCarriedHealth(frame, afterRoundTwo, 3)
      await verifyRoundOpening(frame, page, name, 3, viewport)
      if (name === '뮤츠') await page.screenshot({ path: fileURLToPath(new URL(`carryover-round-3-${viewport.width}.png`, output)) })
      assert.equal(await frame.locator('.boss-invulnerability-badge').count(), 0, 'a full-health final boss starts without a shield')
      if (name === '칠색조') await verifyHoOhRevivalWaves(frame, page, viewport)
      await freezeEnding(frame, page)
      await frame.evaluate(() => window.__setBossBattleFixture({ ...window.__bossBattle(), winner: 'player' }))
      await assertMainLobby(frame, `${name} victory`, ++exits)
      await page.screenshot({ path: fileURLToPath(new URL(`victory-lobby-${name}-${viewport.width}.png`, output)) })
      await reenter()
    }
    await start.click()
    await frame.waitForFunction(() => window.__bossRun()?.phase === 'battle')
    await assertHealthyRound(frame)
    await freezeEnding(frame, page)
    await frame.evaluate(() => {
      const battle = structuredClone(window.__bossBattle())
      for (const pokemon of battle.player.team) { pokemon.hp = 0; pokemon.fainted = true }
      window.__setBossBattleFixture({ ...battle, winner: 'opponent' })
    })
    await assertMainLobby(frame, 'defeat', ++exits)
    await reenter()
    await start.click()
    await frame.waitForFunction(() => window.__bossRun()?.phase === 'battle')
    await assertHealthyRound(frame)
    await freezeEnding(frame, page)
    await forfeitThroughUi(frame)
    await assertMainLobby(frame, 'confirmed forfeit', ++exits)
    await reenter()
    await start.click()
    await frame.waitForFunction(() => window.__bossRun()?.phase === 'battle')
    await assertHealthyRound(frame)
    console.log(`PASS ${viewport.width}x${viewport.height}: health carryover, dialogues, Ho-Oh shields; all three victories, defeat and confirmed forfeit return immediately to the lobby without any result panel; healthy round-one re-entry`)
    await page.close()
  }
  // Exercise the real App routing as well as the focused RaidScreen fixture.
  // Only local account startup/data are seeded; GameApp owns the actual lobby,
  // mode hub, RaidScreen onExit callback, and battle-layout state here.
  for (const viewport of [{ width: 1440, height: 900 }, { width: 844, height: 390 }]) {
    const page = await browser.newPage({ viewport, hasTouch: viewport.width < 1000, isMobile: viewport.width < 1000, reducedMotion: 'reduce' })
    page.on('pageerror', error => { errors.push(error.message); console.error(`Browser error: ${error.message}`) })
    await page.clock.install()
    await page.route('**/api/**', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'LOCAL_PREVIEW_OFFLINE', message: 'Local UI validation' } }) }))
    await page.route('**/boss-ui.html*', route => route.fulfill({ contentType: 'text/html', body: html }))
    await page.goto('http://127.0.0.1:5297/boss-ui.html?fullgame=1')
    const frame = await (await page.locator('iframe[data-game-frame]').elementHandle()).contentFrame()
    await frame.getByRole('heading', { name: '플레이 메뉴', exact: true }).waitFor()
    await watchResultPanels(frame)
    for (const name of ['뮤츠', '칠색조', '루기아']) {
      await openFullGameBoss(frame, name)
      await freezeEnding(frame, page)
      for (let round = 1; round <= 3; round++) {
        await frame.evaluate(() => window.__setBossBattleFixture({ ...window.__bossBattle(), winner: 'player' }))
        if (round < 3) {
          await frame.waitForFunction(next => window.__bossRun()?.round === next && window.__bossRun()?.phase === 'battle', round + 1)
          assert.equal(await frame.getByRole('heading', { name: '플레이 메뉴', exact: true }).count(), 0, 'an intermediate victory must continue the challenge')
        } else await assertMainLobby(frame, `actual GameApp ${name} victory`)
      }
      await page.clock.resume()
    }
    await openFullGameBoss(frame, '뮤츠')
    await freezeEnding(frame, page)
    await frame.evaluate(() => window.__setBossBattleFixture({ ...window.__bossBattle(), winner: 'opponent' }))
    await assertMainLobby(frame, 'actual GameApp defeat')
    await page.clock.resume()
    await openFullGameBoss(frame, '칠색조')
    await freezeEnding(frame, page)
    await forfeitThroughUi(frame)
    await assertMainLobby(frame, 'actual GameApp confirmed forfeit')
    await page.screenshot({ path: fileURLToPath(new URL(`actual-game-lobby-${viewport.width}.png`, output)) })
    await page.clock.resume()
    await openFullGameBoss(frame, '루기아')
    await assertHealthyRound(frame)
    console.log(`PASS actual GameApp ${viewport.width}x${viewport.height}: three final victories, defeat and confirmed forfeit return to the main lobby; intermediate wins continue; reopening starts a healthy round one`)
    await page.close()
  }
  assert.deepEqual(errors, [])
} finally { await browser.close(); await server.close() }
