import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { createBattle, getBattleMovePreview, getBattleMoveTargets, playBattleTurnWithActions } from '../src/data/battleEngine.js'
import { SPECIES_PROFILES, getLearnableMoves, getMoveById } from '../src/data/trainingData.js'
import { resolveChromiumExecutable } from '../promo/scripts/browserRuntime.mjs'

// Conditional targeting follows Showdown's original move definitions:
// https://github.com/smogon/pokemon-showdown/blob/master/data/moves.ts
// All fixture moves/abilities are real catalog data. Hooks are injected only
// into the local test HTTP response; production source has no testing globals.
const require = createRequire(new URL('../promo/package.json', import.meta.url))
const { chromium } = require('playwright')
const root = fileURLToPath(new URL('../', import.meta.url))
const output = path.join(root, 'scripts/.cache/battle-spread-ui')
await fs.mkdir(output, { recursive: true })
const profiles = new Map(Object.values(SPECIES_PROFILES).map(profile => [profile.slug, profile]))
let serial = 0
function pokemon(slug, moveId = 'splash', options = {}) {
  const profile = profiles.get(slug)
  assert(profile, `Unknown fixture species ${slug}`)
  assert(getLearnableMoves(profile.id).some(move => move.id === moveId), `${slug} cannot learn ${moveId}`)
  const ability = options.ability ?? profile.abilities[0]
  assert(profile.abilities.includes(ability), `${slug} cannot have ${ability}`)
  return { speciesId: profile.id, captureId: `spread-ui-${++serial}`, ability,
    moveIds: [moveId], moves: [getMoveById(moveId).name], ...options }
}
function fixture(slug, moveId, options = {}, terrain = 'neutral') {
  const state = createBattle({
    playerPokemon: [pokemon(slug, moveId, options), pokemon('wailord')],
    opponent: { name: '범위 기술 검증', tier: 'S' },
    opponentTeam: { pokemon: [pokemon('wailord'), pokemon('wailord')], battleGimmicks: [], strategy: {} },
    rules: { weather: { id: 'clear', label: '맑음' }, terrain: { id: terrain, label: terrain },
      format: { id: 'double', label: '더블배틀', activeSlots: 2, actionSlots: 2 },
      teamRule: { id: 'full', label: '풀 배틀', battleSize: 6 }, aiDifficulty: { id: 'normal' } },
  })
  // Remove automatically filled move slots so harmless AI cannot choose an
  // unrelated attack. Retained move records are unmodified catalog entries.
  for (const side of ['player', 'opponent']) state[side].team.forEach((member, index) => {
    member.moves = member.moves.filter(move => move.id === (side === 'player' && index === 0 ? moveId : 'splash'))
    assert.equal(member.moves.length, 1)
  })
  return state
}
const fixtures = {
  earthquake: fixture('garchomp', 'earthquake'),
  heatwave: fixture('charizard', 'heatwave'),
  psychic: fixture('mew', 'expandingforce', {}, 'psychic'),
  neutral: fixture('mew', 'expandingforce'),
  airborne: fixture('xatu', 'expandingforce', {}, 'psychic'),
  stellar: fixture('terapagos', 'terastarstorm', { teraType: '스텔라' }),
  max: fixture('charizard', 'heatwave'),
  zmove: fixture('charizard', 'heatwave', { heldItemId: 'firium-z' }),
  lifedew: fixture('mew', 'lifedew'),
  healbell: fixture('blissey', 'healbell'),
}
for (const member of fixtures.lifedew.player.team) member.hp -= 50
fixtures.healbell.opponent.team[0] = fixture('exploud', 'protect').player.team[0]
assert.equal(fixtures.healbell.opponent.team[0].ability, '방음')
for (const member of fixtures.healbell.player.team) member.status = { id: 'burn', label: '화상', counter: 0, toxicCounter: 0 }
assert.equal(getBattleMovePreview(fixtures.psychic).target, 'allAdjacentFoes')
assert.deepEqual(getBattleMoveTargets(fixtures.psychic), [])
for (const state of [fixtures.neutral, fixtures.airborne]) {
  assert.equal(getBattleMovePreview(state).target, 'normal', 'Expanding Force is single-target without both grounding and Psychic Terrain')
  assert(getBattleMoveTargets(state).length > 1)
}
assert.equal(getBattleMovePreview(fixtures.stellar).target, 'normal')
assert.equal(getBattleMovePreview(fixtures.stellar, 'player', 0, 0, 0, 'tera').target, 'allAdjacentFoes')
// Actual transformation on the first action also updates following previews.
const transformed = playBattleTurnWithActions(fixtures.stellar,
  [{ type: 'move', actorSlot: 0, moveIndex: 0, gimmick: 'tera' }], [], () => 0.5)
assert.equal(transformed.player.team[0].speciesId, profiles.get('terapagos-stellar').id)
assert.equal(getBattleMovePreview(transformed).target, 'allAdjacentFoes')

const styles = ['styles', 'screenRedesign', 'battleGen5', 'titleCleanup', 'battleGimmicks', 'moveAnimationDirector', 'mobileLandscape']
const initial = fixtures.earthquake
const props = { playerPokemon: [pokemon('garchomp', 'earthquake'), pokemon('wailord')],
  opponent: { name: '범위 기술 검증', tier: 'S' },
  opponentTeam: { pokemon: [pokemon('wailord'), pokemon('wailord')], battleGimmicks: [], strategy: {} }, rules: initial.rules }
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';import BattleScreen from '/src/BattleScreen.jsx';
${styles.map(name => `import '/src/${name}.css';`).join('\n')}
createRoot(document.getElementById('root')).render(React.createElement('div',{className:'app-shell battle-view'},
React.createElement(BattleScreen,{...${JSON.stringify(props)},soundEnabled:false,
gameSettings:{attackAnimation:'very-fast',hpBarSpeed:'instant'},onComplete:()=>{},onToggleSound:()=>{},onOpenSettings:()=>{}})));`
const port = Number(process.env.SPREAD_UI_PORT ?? 5212)
const server = await createServer({ root, plugins: [{ name: 'spread-ui-entry',
  resolveId: id => id === '/spread-ui-entry.js' ? id : undefined,
  load: id => id === '/spread-ui-entry.js' ? entry : undefined }],
  server: { host: '127.0.0.1', port, strictPort: true, hmr: false }, logLevel: 'error' })
await server.listen()
let browser
const results = []
try {
  browser = await chromium.launch({ executablePath: await resolveChromiumExecutable(chromium), headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await context.addInitScript(() => {
    Math.random = () => 0.5
    window.__spreadObservations = []
    setInterval(() => {
      const cue = window.__spreadUi?.cue
      if (!cue || window.__spreadObservations.at(-1)?.id === cue.id) return
      const effects = [...document.querySelectorAll('.battle-pixel-impact-animation, .battle-pixel-move-animation, .battle-pixel-scene-animation')].map(el => el.className)
      window.__spreadObservations.push({ id: cue.id, phase: cue.phase, side: cue.sideId, actorSlot: cue.actorSlot,
        targetSide: cue.targetSideId, targetSlot: cue.targetSlot, moveId: cue.moveId, effects })
    }, 15)
  })
  const page = await context.newPage()
  page.setDefaultTimeout(25000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const html = await server.transformIndexHtml('/spread-ui.html', '<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body><div id="root"></div><script type="module" src="/spread-ui-entry.js"></script></body></html>')
  await context.route('**/spread-ui.html', route => route.fulfill({ contentType: 'text/html', body: html }))
  await context.route('**/src/BattleScreen.jsx', async route => {
    const response = await route.fetch()
    let body = await response.text()
    assert(body.includes('const currentLogEntry ='), 'Battle UI hook anchor changed')
    body = body.replace('const currentLogEntry =', `window.__spreadUi={state:battle,cue:turnCue,animating:isTurnAnimating,menu,commandSlot,
      load:value=>{setBattle(value);setIntroVisible(false);setTrainerDialogue(null);setMenu('command');setCommandSlot(0);
      setPendingGimmick(null);setPendingMoveIndex(null);setQueuedActions([]);setMoveAssetsReady(true);window.__spreadObservations=[];}};
      const currentLogEntry =`)
    await route.fulfill({ response, body })
  })
  await page.goto(`http://127.0.0.1:${port}/spread-ui.html`)
  await page.waitForFunction(() => window.__spreadUi)
  const cases = [
    { id: 'earthquake-desktop', key: 'earthquake', attackScope: 'target-field', impacts: ['opponent:0', 'opponent:1', 'player:1'] },
    { id: 'heatwave-mobile', key: 'heatwave', attackScope: 'target-spread', mobile: true, impacts: ['opponent:0', 'opponent:1'] },
    { id: 'psychic-expanding-force', key: 'psychic', attackScope: 'target-spread', impacts: ['opponent:0', 'opponent:1'] },
    { id: 'neutral-expanding-force', key: 'neutral', select: true, impacts: ['opponent:0'] },
    { id: 'stellar-starstorm', key: 'stellar', attackScope: 'target-spread', gimmick: 'tera', impacts: ['opponent:0', 'opponent:1'] },
    { id: 'max-converts-single', key: 'max', gimmick: 'dynamax', select: true, impacts: ['opponent:0'] },
    { id: 'z-converts-single', key: 'zmove', gimmick: 'zmove', select: true, impacts: ['opponent:0'] },
    { id: 'life-dew-allies-mobile', key: 'lifedew', attackScope: 'target-spread', mobile: true, healing: true, impacts: [] },
    { id: 'heal-bell-ignores-opposing-soundproof', key: 'healbell', attackScope: 'target-spread', cure: true, impacts: [] },
  ]
  const selectedCases = process.env.SPREAD_UI_CASES?.split(',').filter(Boolean)
  if (selectedCases) assert(selectedCases.every(id => cases.some(scenario => scenario.id === id)), 'Unknown SPREAD_UI_CASES entry')
  for (const scenario of cases) {
    if (selectedCases && !selectedCases.includes(scenario.id)) continue
    const before = fixtures[scenario.key]
    try {
      await page.setViewportSize(scenario.mobile ? { width: 844, height: 390 } : { width: 1440, height: 900 })
      await page.evaluate(state => window.__spreadUi.load(state), before)
      await page.locator('.battle-command-buttons .fight').click()
      if (scenario.gimmick) await page.locator(`.battle-gimmick-selector .mechanic-${scenario.gimmick}`).click()
      await page.locator('.battle-move-button').first().click()
      if (scenario.select) {
        await page.locator('.battle-target-menu').waitFor()
        await page.locator('.battle-target-grid button').first().click()
      } else {
        assert.equal(await page.locator('.battle-target-menu').count(), 0, 'A spread action must not ask for a single target')
      }
      await page.waitForFunction(() => window.__spreadUi.commandSlot === 1)
      await page.locator('.battle-move-button').filter({ hasText: '튀어오르기' }).click()
      await page.waitForFunction(turn => !window.__spreadUi.animating && window.__spreadUi.state.turn > turn, before.turn)
      const { after, observations } = await page.evaluate(() => ({ after: window.__spreadUi.state, observations: window.__spreadObservations }))
      const own = observations.filter(cue => cue.side === 'player' && cue.actorSlot === 0)
      const impacts = own.filter(cue => cue.phase === 'impact')
      assert.deepEqual(impacts.map(cue => `${cue.targetSide}:${cue.targetSlot}`), scenario.impacts)
      for (const cue of impacts) assert(cue.effects.some(effect => effect.includes(`target-slot-${cue.targetSlot}`)),
        `The actual impact DOM must target slot ${cue.targetSlot}`)
      for (let index = 0; index < 2; index += 1) {
        const expectedHit = scenario.impacts.includes(`opponent:${index}`)
        assert.equal(after.opponent.team[index].hp < before.opponent.team[index].hp, expectedHit)
      }
      if (scenario.healing) for (let index = 0; index < 2; index += 1) assert(after.player.team[index].hp > before.player.team[index].hp)
      else assert.equal(after.player.team[1].hp < before.player.team[1].hp, scenario.impacts.includes('player:1'))
      if (scenario.cure) assert(after.player.team.every(member => member.status == null), 'An opposing Soundproof cannot block an ally-team cure')
      assert.equal(after.player.team[0].moves[0].currentPp, before.player.team[0].moves[0].currentPp - 1)
      assert.equal(own.filter(cue => cue.phase === 'attack').length, 1, 'One move should have one attack, followed by each target impact')
      if (scenario.attackScope) assert(own.find(cue => cue.phase === 'attack').effects.some(effect => effect.includes(scenario.attackScope)),
        `The visible attack must use the ${scenario.attackScope} scope`)
      await page.screenshot({ path: path.join(output, `${scenario.id}.png`) })
      results.push({ id: scenario.id, ok: true, impacts, observations: own,
        opponentDamage: before.opponent.team.map((member, index) => member.hp - after.opponent.team[index].hp),
        allyHpChange: after.player.team[1].hp - before.player.team[1].hp })
    } catch (error) {
      results.push({ id: scenario.id, ok: false, error: error.stack })
      await page.screenshot({ path: path.join(output, `${scenario.id}-failure.png`) }).catch(() => {})
      console.error(scenario.id, error.message)
    }
    await fs.writeFile(path.join(output, selectedCases ? 'results-filtered.json' : 'results.json'), JSON.stringify({ results, errors }, null, 2))
  }
  assert.deepEqual(errors, [])
  assert(results.every(result => result.ok), `${results.filter(result => !result.ok).length} spread UI cases failed; see ${output}`)
  console.log(JSON.stringify({ ok: true, cases: results.length, output }))
  await context.close()
} finally {
  await browser?.close()
  await server.close()
}
