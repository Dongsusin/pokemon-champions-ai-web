import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { createBattle, getActivePokemon, getBattleMoveTargets, playBattleTurnWithActions } from '../src/data/battleEngine.js'
import { canPokemonLearnMove, getLearnableMoves, getMoveById, normalizePokemon, SPECIES_PROFILES } from '../src/data/trainingData.js'
import { canonicalizeRankedTeam, createRankedBattle, getRankedBattleView } from '../server/rankedBattle.js'
import { resolveChromiumExecutable } from '../promo/scripts/browserRuntime.mjs'

// Mount the production BattleScreen against local engine-created states. The
// browser cannot reach accounts, remote matches or production API endpoints.
// Observation/seed hooks exist only in the intercepted development response.
const root = fileURLToPath(new URL('../', import.meta.url))
const output = path.join(root, 'scripts/.cache/dynamax-strength-sap-ui')
await fs.mkdir(output, { recursive: true })
const require = createRequire(new URL('../promo/package.json', import.meta.url))
const { chromium } = require(process.env.DYNAMAX_SAP_PLAYWRIGHT_MODULE ?? 'playwright')
const profiles = new Map(Object.values(SPECIES_PROFILES).map(profile => [profile.slug, profile]))
let serial = 0
function pokemon(slug, moveIds, extra = {}) {
  const profile = profiles.get(slug)
  assert(profile, `Missing real fixture species ${slug}`)
  for (const id of moveIds) {
    assert(getLearnableMoves(profile.id).some(move => move.id === id), `${slug} must legally learn ${id}`)
    assert(canPokemonLearnMove(profile.id, getMoveById(id).name), `${slug} must retain ${id} through move legality checks`)
  }
  const saved = { captureId: `dynamax-sap-ui-${++serial}`, speciesId: profile.id,
    ability: profile.abilities[0], moveIds, moves: moveIds.map(id => getMoveById(id).name), ...extra }
  const normalized = normalizePokemon(saved)
  for (const id of moveIds) assert(normalized.moves.includes(getMoveById(id).name), `Normalization replaced ${slug}'s ${id}`)
  return saved
}
const magikarp = () => pokemon('magikarp', ['splash'])
function fixture(id, format, playerPokemon, opponentPokemon) {
  const slots = format === 'double' ? 2 : 1
  const props = { id, competitionLabel: `다이맥스·힘흡수 검증 ${id}`, playerPokemon,
    opponent: { name: '로컬 배틀 검증', tier: 'B' },
    opponentTeam: { pokemon: opponentPokemon, battleGimmicks: [], strategy: {} },
    rules: { weather: { id: 'clear', label: '맑음' }, terrain: { id: 'neutral', label: '일반 필드' },
      format: { id: format, label: slots === 2 ? '더블배틀' : '싱글배틀', activeSlots: slots, actionSlots: slots },
      teamRule: { id: 'full', label: '풀 배틀', battleSize: playerPokemon.length },
      aiDifficulty: { id: 'normal', label: '보통', boostStage: 0 }, disabledGimmickId: null },
  }
  const state = createBattle(props)
  for (const side of [state.player, state.opponent]) for (const member of side.team) {
    assert(member.moves.every(move => canPokemonLearnMove(member.speciesId, move.name)), 'Runtime fixture moves must remain legal')
  }
  return { props, state }
}

const dynamaxCases = []
for (const format of ['single', 'double']) {
  for (const specimen of [
    { id: 'zacian-hero', slug: 'zacian', expectedSlug: 'zacian' },
    { id: 'zacian-crowned', slug: 'zacian', expectedSlug: 'zacian-crowned', item: 'rusted-sword' },
    { id: 'zamazenta-hero', slug: 'zamazenta', expectedSlug: 'zamazenta' },
    { id: 'zamazenta-crowned', slug: 'zamazenta', expectedSlug: 'zamazenta-crowned', item: 'rusted-shield' },
    { id: 'charizard-control', slug: 'charizard', expectedSlug: 'charizard', allowed: true },
  ]) {
    const lead = pokemon(specimen.slug, ['protect'], { ...(specimen.item ? { heldItemId: specimen.item } : {}), dynamaxMode: 'dynamax' })
    const chosen = fixture(`${format}-${specimen.id}`, format,
      format === 'double' ? [lead, magikarp()] : [lead],
      format === 'double' ? [magikarp(), magikarp()] : [magikarp()])
    assert.equal(getActivePokemon(chosen.state, 'player').speciesId, profiles.get(specimen.expectedSlug).id, 'The menu must render the intended active form')
    dynamaxCases.push({ ...chosen, format, specimen })
  }
}

function strengthSapFixture(format) {
  const double = format === 'double'
  const targetSlot = double ? 1 : 0
  const jelly = pokemon('jellicent', ['strengthsap', 'recover'], { ability: '저주받은바디', nature: '겁쟁이',
    trainingPoints: { hp: 32, attack: 0, defense: 2, specialAttack: 0, specialDefense: 0, speed: 32 } })
  const whale = pokemon('wailord', ['watergun', 'splash'], { ability: '수의베일', nature: '냉정',
    trainingPoints: { hp: 32, attack: 32, defense: 2, specialAttack: 0, specialDefense: 0, speed: 0 } })
  const chosen = fixture(`${format}-strength-sap-full-target`, format,
    double ? [jelly, magikarp()] : [jelly], double ? [magikarp(), whale] : [whale])
  if (double) {
    // Pin only the initial legal field positions: AI lead scoring otherwise
    // puts Wailord first and would stop this case from testing target slot 1.
    chosen.state.opponent.activeIndexes = [0, 1]
    chosen.state.opponent.activeIndex = 0
  }
  const moveIndex = (member, id) => {
    const index = member.moves.findIndex(move => move.id === id)
    assert(index >= 0, `The real runtime move ${id} must be present`)
    return index
  }
  const user = getActivePokemon(chosen.state, 'player')
  const target = getActivePokemon(chosen.state, 'opponent', targetSlot)
  assert(user.stats.speed > target.stats.speed, 'The legal training spreads must make Recover happen before Water Gun')
  const actions = [{ type: 'move', actorSlot: 0, moveIndex: moveIndex(user, 'recover') }]
  if (double) actions.push({ type: 'move', actorSlot: 1, moveIndex: moveIndex(getActivePokemon(chosen.state, 'player', 1), 'splash') })
  const foes = [{ type: 'move', actorSlot: targetSlot, moveIndex: moveIndex(target, 'watergun'), targetSideId: 'player', targetSlot: 0 }]
  if (double) foes.unshift({ type: 'move', actorSlot: 0, moveIndex: moveIndex(getActivePokemon(chosen.state, 'opponent', 0), 'splash') })
  // An actual Water Gun hit establishes the damaged user. No HP or move-effect
  // replacement is injected, and the opponent remains at full health.
  chosen.state = playBattleTurnWithActions(chosen.state, actions, foes, () => 0.5)
  const damaged = getActivePokemon(chosen.state, 'player')
  const fullTarget = getActivePokemon(chosen.state, 'opponent', targetSlot)
  assert(damaged.hp > 0 && damaged.hp < damaged.maxHp, 'Preparation must deal real damage to Jellicent')
  assert.equal(fullTarget.hp, fullTarget.maxHp, 'Strength Sap must work against a full-HP opponent')
  assert.equal(fullTarget.statStages.attack, 0)
  assert(chosen.state.log.some(entry => entry.message.includes('물대포')), 'Preparation must execute the real Water Gun')
  // Restrict the legal enemy repertoire to Splash for the observed turn so no
  // later damage can obscure the HP restored by the submitted Strength Sap.
  for (const member of chosen.state.opponent.team) {
    member.moves = member.moves.filter(move => move.id === 'splash')
    assert.equal(member.moves.length, 1)
  }
  const sapIndex = moveIndex(damaged, 'strengthsap')
  assert(getBattleMoveTargets(chosen.state, 'player', sapIndex).some(option => option.sideId === 'opponent' && option.slot === targetSlot))
  return { ...chosen, format, targetSlot, sapIndex }
}
const sapCases = ['single', 'double'].map(strengthSapFixture)
const wireChecks = []
for (const slug of ['jellicent', 'jellicent-f']) for (const format of ['single', 'double']) {
  const registered = canonicalizeRankedTeam([
    pokemon(slug, ['strengthsap', 'recover']), magikarp(), pokemon('charizard', ['protect']),
    pokemon('blastoise', ['protect']), pokemon('snorlax', ['protect']), pokemon('eevee', ['protect']),
  ], { format, requireRegisteredTeam: true })
  assert(registered[0].moveIds.includes('strengthsap'), 'Real PvP team registration must retain Strength Sap')
  const size = format === 'double' ? 4 : 3
  const ranked = createRankedBattle({ format, playerTeam: registered.slice(0, size),
    opponentTeam: [pokemon('wailord', ['splash']), magikarp(), pokemon('snorlax', ['protect']), pokemon('blastoise', ['protect'])].slice(0, size),
    random: () => 0.5,
  })
  const view = getRankedBattleView(ranked, 'player')
  assert.equal(view.player.team[0].moves[0].id, 'strengthsap')
  assert.equal(view.commandOptions[0].moves[0].preview.id, 'strengthsap')
  assert.equal(view.commandOptions[0].moves[0].disabled, false)
  wireChecks.push(`${slug}:${format}:registration,runtime,command-preview`)
}

const styles = ['styles', 'screenRedesign', 'battleGen5', 'titleCleanup', 'battleGimmicks', 'moveAnimationDirector', 'mobileLandscape']
const entry = `import '/src/mobileViewport.js';import React from 'react';import{createRoot}from'react-dom/client';import BattleScreen from'/src/BattleScreen.jsx';
${styles.map(name => `import '/src/${name}.css';`).join('\n')}
function Harness(){const[fixture,setFixture]=React.useState(null);window.__mountDynamaxSapFixture=setFixture;
return fixture?React.createElement('div',{className:'app-shell battle-view'},React.createElement(BattleScreen,{...fixture,key:fixture.id,soundEnabled:false,
gameSettings:{attackAnimation:'skip',hpBarSpeed:'instant'},onComplete:()=>{},onToggleSound:()=>{},onOpenSettings:()=>{}})):null;}
createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement(Harness)));`
const results = [], errors = [], unexpectedRequests = []
let server, browser
try {
  server = await createServer({ root, logLevel: 'error', plugins: [{ name: 'dynamax-strength-sap-ui-entry',
    resolveId: id => id === '/dynamax-sap-entry.js' ? id : undefined,
    load: id => id === '/dynamax-sap-entry.js' ? entry : undefined,
  }], server: { host: '127.0.0.1', port: Number(process.env.DYNAMAX_SAP_UI_PORT ?? 0), hmr: false } })
  await server.listen()
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`
  const html = await server.transformIndexHtml('/dynamax-sap.html', '<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body><div id="root"></div><script type="module" src="/dynamax-sap-entry.js"></script></body></html>')
  browser = await chromium.launch({ executablePath: await resolveChromiumExecutable(chromium), headless: true })
  for (const device of [
    { id: 'desktop', viewport: { width: 1440, height: 900 }, hasTouch: false },
    { id: 'mobile', viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true },
  ]) {
    const context = await browser.newContext({ ...device, reducedMotion: 'reduce' })
    await context.addInitScript(() => { Math.random = () => 0.5 })
    await context.route('**/*', route => {
      const url = new URL(route.request().url())
      if (url.origin === origin && !url.pathname.startsWith('/api/')) return route.continue()
      if (route.request().resourceType() !== 'image' && !url.pathname.includes('/cries/')) unexpectedRequests.push(url.href)
      return route.abort()
    })
    await context.route('**/dynamax-sap.html', route => route.fulfill({ contentType: 'text/html', body: html }))
    await context.route('**/src/BattleScreen.jsx', async route => {
      const response = await route.fetch()
      const source = await response.text()
      assert(source.includes('const currentLogEntry ='), 'BattleScreen observation anchor changed')
      const body = source.replace('const currentLogEntry =', `window.__dynamaxSapUi={fixtureId:competitionLabel,state:battle,menu,commandSlot,queuedActions,animating:isTurnAnimating,
        load:value=>{setBattle(value);setIntroVisible(false);setTrainerDialogue(null);setMenu('command');setCommandSlot(0);setTargetSlot(0);
          setPendingGimmick(null);setPendingMoveIndex(null);setQueuedActions([]);setMoveAssetsReady(true);}};const currentLogEntry =`)
      await route.fulfill({ response, body })
    })
    const page = await context.newPage()
    page.setDefaultTimeout(20_000)
    page.on('pageerror', error => errors.push({ device: device.id, message: error.message }))
    await page.goto(`${origin}/dynamax-sap.html`)
    await page.waitForFunction(() => window.__mountDynamaxSapFixture)
    const activate = locator => device.hasTouch ? locator.tap() : locator.click()
    const stateOf = () => page.evaluate(() => window.__dynamaxSapUi.state)
    async function load(chosen) {
      await page.evaluate(props => window.__mountDynamaxSapFixture(props), chosen.props)
      await page.waitForFunction(id => window.__dynamaxSapUi?.fixtureId === id, chosen.props.competitionLabel)
      await page.evaluate(state => window.__dynamaxSapUi.load(state), chosen.state)
      await page.locator('.battle-intro-overlay').waitFor({ state: 'detached' })
      await page.waitForFunction(() => !document.querySelector('button.fight')?.disabled)
      await activate(page.locator('button.fight'))
      await page.locator('.battle-move-menu').waitFor()
    }
    async function check(chosen, run) {
      const id = `${device.id}-${chosen.props.id}`
      try {
        await load(chosen)
        const details = await run()
        await page.screenshot({ path: path.join(output, `${id}.png`) })
        results.push({ id, passed: true, ...details })
        console.log(`PASS ${id}`)
      } catch (error) {
        const state = await stateOf().catch(() => null)
        results.push({ id, passed: false, error: error.stack, logs: state?.log?.slice(-15) })
        await page.screenshot({ path: path.join(output, `${id}-failure.png`) }).catch(() => {})
        console.error(`FAIL ${id}: ${error.message}`)
      }
    }
    for (const chosen of dynamaxCases) await check(chosen, async () => {
      const button = page.locator('.battle-gimmick-selector .mechanic-dynamax')
      assert.equal(await button.count(), chosen.specimen.allowed ? 1 : 0, `${chosen.specimen.id} Dynamax availability must match its species restriction`)
      assert.equal(await page.locator('.battle-gimmick-selector .mechanic-tera').count(), 1, 'The restriction must not remove unrelated mechanics')
      if (chosen.specimen.allowed) {
        assert(await button.isEnabled())
        await activate(button)
        assert.equal(await button.getAttribute('aria-pressed'), 'true')
        assert.equal(await page.locator('.battle-move-name strong').first().innerText(), '다이월')
        assert.equal((await stateOf()).turn, chosen.state.turn, 'Selecting a mechanic must not submit a turn')
      }
      return { activeSpeciesId: getActivePokemon(await stateOf(), 'player').speciesId, dynamaxVisible: Boolean(chosen.specimen.allowed) }
    })
    for (const chosen of sapCases) await check(chosen, async () => {
      const before = await stateOf()
      const userBefore = getActivePokemon(before, 'player')
      const targetBefore = getActivePokemon(before, 'opponent', chosen.targetSlot)
      const userPanel = page.locator('.battle-hp-panel.side-player').filter({ has: page.locator('header strong').filter({ hasText: /^탱탱겔$/ }) })
      const meterBefore = await userPanel.locator('.battle-hp-meter > i').evaluate(element => Number.parseFloat(element.style.width))
      assert(meterBefore < 100, 'The visible user HP meter must start damaged')
      const button = page.locator('.battle-move-button').filter({ has: page.locator('.battle-move-name strong').filter({ hasText: /^힘흡수$/ }) })
      assert(await button.isEnabled(), 'Legal Jellicent Strength Sap must be selectable')
      await activate(button)
      if (chosen.format === 'double') {
        await page.locator('.battle-target-menu').waitFor()
        const targetButton = page.locator('.battle-target-card').filter({ hasText: `상대 0${chosen.targetSlot + 1}` })
        assert.match(await targetButton.innerText(), /HP 100%/, 'A full-HP opponent must be offered as a valid target')
        await page.screenshot({ path: path.join(output, `${device.id}-strength-sap-target.png`) })
        await activate(targetButton)
        await page.waitForFunction(() => window.__dynamaxSapUi.commandSlot === 1 && window.__dynamaxSapUi.menu === 'fight')
        const action = await page.evaluate(() => window.__dynamaxSapUi.queuedActions[0])
        assert.equal(action.moveIndex, chosen.sapIndex)
        assert.equal(action.targetSideId, 'opponent')
        assert.equal(action.targetSlot, chosen.targetSlot)
        await activate(page.locator('.battle-move-button').filter({ has: page.locator('.battle-move-name strong').filter({ hasText: /^튀어오르기$/ }) }))
      }
      await page.waitForFunction(turn => !window.__dynamaxSapUi.animating && window.__dynamaxSapUi.state.turn === turn + 1, before.turn)
      const after = await stateOf()
      const userAfter = getActivePokemon(after, 'player')
      const targetAfter = getActivePokemon(after, 'opponent', chosen.targetSlot)
      const healed = Math.min(userBefore.maxHp - userBefore.hp, targetBefore.stats.attack)
      assert.equal(userAfter.hp, userBefore.hp + healed)
      assert(userAfter.hp > userBefore.hp, 'The damaged user must recover HP')
      assert.equal(targetAfter.hp, targetBefore.hp, 'Strength Sap must not heal or damage its full-HP target')
      assert.equal(targetAfter.statStages.attack, -1)
      assert.equal(userAfter.moves[chosen.sapIndex].currentPp, userBefore.moves[chosen.sapIndex].currentPp - 1)
      const logs = after.log.slice(before.log.length).map(entry => entry.message)
      assert(logs.some(message => message.includes('힘흡수') && /HP를 \d+ 회복/.test(message)), 'The engine must report the actual Strength Sap recovery')
      assert(logs.some(message => message.includes(targetBefore.name) && message.includes('공격 하락')), 'The selected target must receive an Attack-drop log')
      const visibleLog = await page.locator('.battle-log-scroll').innerText()
      assert.match(visibleLog, /힘흡수.*HP를 \d+ 회복/)
      assert.match(visibleLog, /공격 하락/)
      const meterAfter = await userPanel.locator('.battle-hp-meter > i').evaluate(element => Number.parseFloat(element.style.width))
      assert(meterAfter > meterBefore && Math.abs(meterAfter - userAfter.hp / userAfter.maxHp * 100) < 0.01,
        'The visible Jellicent HP meter must reflect the recovered health')
      if (chosen.format === 'double') {
        assert.equal(getActivePokemon(after, 'opponent', 0).statStages.attack, getActivePokemon(before, 'opponent', 0).statStages.attack)
        assert.equal(getActivePokemon(after, 'player', 1).hp, getActivePokemon(before, 'player', 1).hp)
      }
      return { beforeHp: userBefore.hp, afterHp: userAfter.hp, healed, targetAttackStage: targetAfter.statStages.attack, targetSlot: chosen.targetSlot, logs }
    })
    await context.close()
  }
} finally {
  await browser?.close()
  await server?.close()
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ wireChecks, results, errors, unexpectedRequests }, null, 2))
}
assert.deepEqual(errors, [], 'No browser runtime errors are allowed')
assert.deepEqual(unexpectedRequests, [], 'The harness must not call external services or production APIs')
assert(results.length === 24 && results.every(result => result.passed), `Battle UI regression failed; see ${output}`)
assert.equal(wireChecks.length, 4)
console.log(`24/24 UI and 4/4 PvP registration checks passed; browser errors ${errors.length}; unexpected external/API requests ${unexpectedRequests.length}`)
