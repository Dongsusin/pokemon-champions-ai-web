import assert from 'node:assert/strict'
import test from 'node:test'
import { createBattle, createBattleTurnTimeline, getBattleMovePreview } from '../src/data/battleEngine.js'
import { resolveMaxMove } from '../src/data/maxMoveData.js'
import { SPECIES_PROFILES, getLearnableMoves, getMoveById } from '../src/data/trainingData.js'

// Rule reference: Max Wyrmwind has its own Attack drop; Scale Shot/Clanging Scales selfBoost is not inherited.
// https://github.com/smogon/pokemon-showdown/blob/master/data/moves.ts
const profiles = new Map(Object.values(SPECIES_PROFILES).map(profile => [profile.slug, profile]))
const rng = () => 0.5
let serial = 0
function pokemon(slug, moveIds, extra = {}) {
  const profile = profiles.get(slug)
  assert(profile, `Missing species ${slug}`)
  const legal = new Set(getLearnableMoves(profile.id).map(move => move.id))
  for (const id of moveIds) assert(legal.has(id), `${slug} cannot learn ${id}`)
  return { speciesId: profile.id, captureId: `max-effects-${++serial}`, slug,
    ability: profile.abilities[0], moveIds, moves: moveIds.map(id => getMoveById(id).name),
    dynamaxMode: 'dynamax', ...extra }
}
const koraidon = () => pokemon('koraidon', ['scaleshot', 'protect'])
const whale = extra => pokemon('wailord', ['splash'], extra)
const kommoo = () => pokemon('kommo-o', ['clangingscales'])
function battle(player = [koraidon()], opponent = [whale()], double = false) {
  return createBattle({ playerPokemon: player, opponent: { name: 'MAX MOVE EFFECTS', tier: 'C' },
    opponentTeam: { pokemon: opponent, battleGimmicks: [], strategy: {} }, random: rng,
    rules: { pvp: true, weather: { id: 'clear' }, terrain: { id: 'neutral' },
      format: { id: double ? 'double' : 'single', activeSlots: double ? 2 : 1, actionSlots: double ? 2 : 1 },
      teamRule: { id: 'full', battleSize: Math.max(player.length, opponent.length) } } })
}
const action = (gimmick = null, actorSlot = 0, targetSlot = 0, moveIndex = 0) => ({
  type: 'move', actorSlot, targetSlot, moveIndex, gimmick,
})
const user = (state, side = 'player') => state[side].team[0]
const impacts = (timeline, side = 'player') => timeline.filter(step => step.sideId === side && step.phase === 'impact')
const stageLogs = (state, name) => state.log.filter(entry => entry.message.startsWith(name + '의 ')
  && /방어 (상승|하락)|스피드 (상승|하락)/.test(entry.message))
function assertNoSourceEffects(before, result, side = 'player') {
  const initial = user(before, side)
  const active = user(result.state, side)
  for (const key of ['defense', 'speed']) {
    assert.equal(active.statStages[key], initial.statStages[key], `Max Move inherited source ${key}`)
    for (const step of result.timeline) {
      assert.equal(user(step.state, side).statStages[key], initial.statStages[key],
        `Timeline ${step.phase} exposed source ${key}`)
    }
  }
  assert.deepEqual(stageLogs(result.state, active.name), [], 'Max Move emitted source self-stat logs')
}
const maxTurn = before => createBattleTurnTimeline(before, [action('dynamax')], rng, [action()])

test('Max conversion clears selfBoost for both real source records without changing the originals', () => {
  for (const id of ['scaleshot', 'clangingscales']) {
    const source = getMoveById(id), snapshot = structuredClone(source)
    assert(source.selfBoost?.boosts, 'The regression fixture must carry real selfBoost data')
    const converted = resolveMaxMove(source)
    assert.equal(converted.id, 'maxwyrmwind')
    assert.equal(converted.selfBoost, null)
    assert.equal(converted.multihit, null)
    assert.equal(converted.baseMoveId, id)
    assert.deepEqual(source, snapshot)
  }
})
test('Koraidon Max preview shows its own effects and preserves the original move for later turns', () => {
  const before = battle(), snapshot = structuredClone(before)
  const preview = getBattleMovePreview(before, 'player', 0, 0, 0, 'dynamax')
  assert.equal(preview.id, 'maxwyrmwind')
  assert.equal(preview.selfBoost, null)
  assert.equal(preview.multihit, null)
  assert.deepEqual(preview.maxMoveEffect.changes, { attack: -1 })
  assert.deepEqual(before, snapshot)
})
test('Koraidon Scale Shot-based Max Wyrmwind hits once and shows only the target Attack drop', () => {
  const before = battle(), snapshot = structuredClone(before)
  const result = maxTurn(before)
  assertNoSourceEffects(before, result)
  assert.equal(impacts(result.timeline).length, 1)
  assert(impacts(result.timeline).every(step => step.moveId === 'maxwyrmwind'))
  assert(result.state.opponent.team[0].hp > 0 && result.state.opponent.team[0].hp < before.opponent.team[0].hp)
  assert.equal(result.state.opponent.team[0].statStages.attack, -1)
  assert.equal(user(result.state).moves[0].currentPp, user(before).moves[0].currentPp - 1)
  assert.equal(user(result.state).moves[0].id, 'scaleshot')
  assert.deepEqual(user(result.state).moves[0].selfBoost, user(before).moves[0].selfBoost)
  assert(result.state.player.usedMechanics.dynamax)
  assert(result.state.log.some(entry => entry.message.includes(result.state.opponent.team[0].name + '의 공격 하락')))
  assert(result.timeline.some(step => step.phase === 'status' && step.moveId === 'maxwyrmwind'
    && step.state.opponent.team[0].statStages.attack === -1 && step.message.includes('공격 하락')))
  assert.deepEqual(before, snapshot)
})
test('Already active Dynamax also excludes source selfBoost on subsequent turns', () => {
  // A real opposing Dynamax keeps the target alive for both hits, so the
  // second Attack drop is observable rather than suppressed by a knockout.
  const initial = battle([koraidon()], [pokemon('wailord', ['watergun'])])
  const first = createBattleTurnTimeline(initial, [action('dynamax')], rng, [action('dynamax')]).state
  assert(user(first).dynamaxActive)
  const result = createBattleTurnTimeline(first, [action()], rng, [action()])
  assertNoSourceEffects(first, result)
  assert.equal(impacts(result.timeline).length, 1)
  assert(result.state.opponent.team[0].hp > 0, 'The target must survive both hits')
  assert.equal(result.state.opponent.team[0].statStages.attack, -2)
})
test('Opponent Koraidon follows the same converted effects as the player', () => {
  const before = battle([whale()], [koraidon()])
  const result = createBattleTurnTimeline(before, [action()], rng, [action('dynamax')])
  assertNoSourceEffects(before, result, 'opponent')
  assert.equal(impacts(result.timeline, 'opponent').length, 1)
  assert.equal(result.state.player.team[0].statStages.attack, -1)
})
test('Double battle Max Wyrmwind hits one target while lowering both opposing active Attack stages', () => {
  const before = battle([koraidon(), whale()], [whale(), whale()], true)
  const result = createBattleTurnTimeline(before, [action('dynamax', 0, 1), action(null, 1)], rng,
    [action(), action(null, 1)])
  assertNoSourceEffects(before, result)
  assert.equal(impacts(result.timeline).length, 1)
  assert.equal(impacts(result.timeline)[0].targetSlot, 1)
  assert.equal(result.state.opponent.team[0].hp, before.opponent.team[0].hp)
  assert(result.state.opponent.team[1].hp < before.opponent.team[1].hp)
  assert.deepEqual(result.state.opponent.team.map(member => member.statStages.attack), [-1, -1])
})
test('Ordinary Scale Shot remains multihit and changes user Defense and Speed once', () => {
  const before = battle()
  const result = createBattleTurnTimeline(before, [action()], rng, [action()])
  assert.equal(impacts(result.timeline).length, 3)
  assert.equal(user(result.state).statStages.defense, -1)
  assert.equal(user(result.state).statStages.speed, 1)
  assert.equal(result.state.opponent.team[0].statStages.attack, 0)
  assert.equal(stageLogs(result.state, user(result.state).name).length, 1)
  assert(result.timeline.some(step => step.phase === 'status'
    && user(step.state).statStages.defense === -1 && user(step.state).statStages.speed === 1))
  assert.equal(user(result.state).moves[0].currentPp, user(before).moves[0].currentPp - 1)
})
test('Clanging Scales-based special Max Wyrmwind does not lower the user Defense', () => {
  const before = battle([kommoo()])
  const result = maxTurn(before)
  assertNoSourceEffects(before, result)
  assert.equal(impacts(result.timeline).length, 1)
  assert.equal(result.state.opponent.team[0].statStages.attack, -1)
})
test('Ordinary Clanging Scales retains its user Defense drop', () => {
  const result = createBattleTurnTimeline(battle([kommoo()]), [action()], rng, [action()])
  assert.equal(user(result.state).statStages.defense, -1)
  assert.equal(result.state.opponent.team[0].statStages.attack, 0)
})
test('Gigantamax conversion also excludes inherited selfBoost', () => {
  const source = getMoveById('scaleshot'), snapshot = structuredClone(source)
  const converted = resolveMaxMove(source, { gigantamax: true, speciesSlug: 'duraludon' })
  assert.equal(converted.id, 'gmaxdepletion')
  assert.equal(converted.isGmaxMove, true)
  assert.equal(converted.selfBoost, null)
  assert.equal(converted.multihit, null)
  assert.deepEqual(source, snapshot)
})
test('Blocking the legitimate target stat drop does not reintroduce Scale Shot effects', () => {
  const before = battle([koraidon()], [whale({ heldItemId: 'clear-amulet' })])
  const result = maxTurn(before)
  assertNoSourceEffects(before, result)
  assert.equal(result.state.opponent.team[0].statStages.attack, 0)
  assert(result.state.log.some(entry => entry.message.includes('클리어참')))
})
