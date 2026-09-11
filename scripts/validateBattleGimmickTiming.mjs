import assert from 'node:assert/strict'
import * as engine from '../src/data/battleEngine.js'
import { getLearnableMoves, getMoveById, SPECIES_PROFILES } from '../src/data/trainingData.js'

// Transformations are separate queue actions after switches, before moves:
// https://github.com/smogon/pokemon-showdown/blob/master/sim/battle-queue.ts
// https://github.com/smogon/pokemon-showdown/blob/master/sim/battle.ts
const profiles = new Map(Object.values(SPECIES_PROFILES).map(profile => [profile.slug, profile]))
const trainingPoints = { hp: 0, attack: 0, defense: 0, specialAttack: 0, specialDefense: 0, speed: 0 }
const failures = []
let checked = 0
let fixtureId = 0
const rng = () => 0.5
function pokemon(slug, moveIds, options = {}) {
  const profile = profiles.get(slug)
  assert(profile, `Missing ${slug}`)
  const legal = new Set(getLearnableMoves(profile.id).map(move => move.id))
  for (const id of moveIds) assert(legal.has(id), `${slug} cannot learn ${id}`)
  return {
    captureId: `gimmick-timing-${++fixtureId}`, speciesId: profile.id, slug,
    ability: profile.abilities[0], nature: '노력', trainingPoints: { ...trainingPoints },
    teraType: '땅', dynamaxMode: 'dynamax',
    moveIds, moves: moveIds.map(id => getMoveById(id).name), ...options,
  }
}
function battle(player, opponent, double = false) {
  const state = engine.createBattle({
    playerPokemon: player, opponent: { name: 'GIMMICK TIMING', tier: 'C' },
    opponentTeam: { pokemon: opponent, battleGimmicks: [], strategy: {} },
    rules: {
      weather: { id: 'clear', label: '맑음' }, terrain: { id: 'neutral', label: '일반' },
      format: { id: double ? 'double' : 'single', activeSlots: double ? 2 : 1, actionSlots: double ? 2 : 1 },
      teamRule: { id: 'full', battleSize: Math.max(player.length, opponent.length) },
    },
  })
  // Normalization fills empty move slots; keep only the legal supplied moves so
  // AI cannot silently choose generated Protect instead of the intended attack.
  for (const [sideId, entries] of [['player', player], ['opponent', opponent]]) {
    state[sideId].team.forEach((p, index) => { p.moves = p.moves.slice(0, entries[index].moveIds.length) })
  }
  return state
}
const action = (gimmick = null, actorSlot = 0, extra = {}) => ({ type: 'move', moveIndex: 0, actorSlot, targetSlot: 0, gimmick, ...extra })
const turn = (state, player = [action()], opponent = [action()], random = rng) => engine.playBattleTurnWithActions(state, player, opponent, random)
const sleep = p => { p.status = { id: 'sleep', label: '잠듦', counter: 3, toxicCounter: 0 } }
function check(name, fn) {
  checked += 1
  try { fn() } catch (error) { failures.push(`${name}: ${error.stack}`) }
}
function assertBeforeMoves(result, count = 1) {
  const mechanics = result.timeline.filter(step => step.phase === 'gimmick')
  assert.equal(mechanics.length, count)
  const firstMove = result.timeline.findIndex(step => ['announce', 'attack', 'impact'].includes(step.phase))
  assert(firstMove >= 0, 'Fixture must execute an actual move')
  assert(result.timeline.indexOf(mechanics.at(-1)) < firstMove, 'All transformations must precede the first move')
}

check('Slow Ground Tera is immune to faster Thunderbolt on its activation turn', () => {
  const state = battle([pokemon('snorlax', ['tackle'])], [pokemon('jolteon', ['thunderbolt'])])
  assert(state.player.team[0].stats.speed < state.opponent.team[0].stats.speed)
  const result = engine.createBattleTurnTimeline(state, action('tera'), rng)
  assertBeforeMoves(result)
  assert.equal(result.state.player.team[0].hp, state.player.team[0].hp)
  assert.deepEqual(result.state.player.team[0].types, ['땅'])
})
check('Opponent Tera has the same pre-move defensive timing', () => {
  const state = battle([pokemon('jolteon', ['thunderbolt'])], [pokemon('snorlax', ['tackle'], { battleMechanics: ['terastallization'] })])
  const after = turn(state, [action()], [action('tera')])
  assert.equal(after.opponent.team[0].hp, state.opponent.team[0].hp)
  assert(after.opponent.team[0].teraActive)
})
check('Dynamax HP doubles before a faster opponent deals damage', () => {
  const state = battle([pokemon('snorlax', ['tackle'])], [pokemon('lucario', ['closecombat'])])
  const result = engine.createBattleTurnTimeline(state, action('dynamax'), rng)
  assertBeforeMoves(result)
  const hit = result.timeline.find(step => step.phase === 'impact' && step.sideId === 'opponent')
  assert(hit)
  assert.equal(hit.state.player.team[0].maxHp, state.player.team[0].maxHp * 2)
  assert(hit.state.player.team[0].dynamaxActive)
  assert.equal(result.state.player.team[0].dynamaxTurns, 2)
})
for (const gimmick of ['tera', 'dynamax', 'mega']) {
  check(`${gimmick} still activates while asleep without consuming move PP`, () => {
    const state = battle([pokemon('charizard', ['flamethrower'], { heldItemId: 'charizardite-y' })], [pokemon('magikarp', ['splash'])])
    sleep(state.player.team[0])
    const pp = state.player.team[0].moves[0].currentPp
    const result = engine.createBattleTurnTimeline(state, action(gimmick), rng)
    assertBeforeMoves(result)
    assert.equal(result.state.player.team[0].usedBattleMechanicId, gimmick)
    assert.equal(result.state.player.team[0].moves[0].currentPp, pp)
  })
}
check('Full paralysis cannot cancel an already selected transformation', () => {
  const state = battle([pokemon('snorlax', ['tackle'])], [pokemon('magikarp', ['splash'])])
  state.player.team[0].status = { id: 'paralysis', label: '마비', counter: 0 }
  const after = turn(state, [action('tera')], [action()], () => 0)
  assert(after.player.team[0].teraActive)
  assert.equal(after.player.team[0].moves[0].currentPp, state.player.team[0].moves[0].currentPp)
})
check('Tera happens before Fake Out, even if the user then flinches', () => {
  const state = battle([pokemon('snorlax', ['tackle'])], [pokemon('persian', ['fakeout'])])
  const after = turn(state, [action('tera')])
  assert(after.player.team[0].teraActive)
  assert.equal(after.player.team[0].moves[0].currentPp, state.player.team[0].moves[0].currentPp)
})
check('Priority Protect still occurs after the transformation animation', () => {
  const state = battle([pokemon('snorlax', ['protect'])], [pokemon('jolteon', ['thunderbolt'])])
  assertBeforeMoves(engine.createBattleTurnTimeline(state, action('tera'), rng))
})
check('Mega Beedrill uses its new Speed on the same turn', () => {
  const state = battle([pokemon('beedrill', ['xscissor'], { heldItemId: 'beedrillite' })], [pokemon('gengar', ['shadowball'])])
  assert(state.player.team[0].stats.speed < state.opponent.team[0].stats.speed)
  const result = engine.createBattleTurnTimeline(state, action('mega'), rng)
  assertBeforeMoves(result)
  assert.equal(result.timeline.find(step => step.phase === 'announce')?.sideId, 'player')
  assert(result.state.player.team[0].stats.speed > state.opponent.team[0].stats.speed)
})
check('New Mega Speed also obeys Trick Room immediately', () => {
  const state = battle([pokemon('beedrill', ['xscissor'], { heldItemId: 'beedrillite' })], [pokemon('gengar', ['shadowball'])])
  state.environment.trickRoomTurns = 3
  const result = engine.createBattleTurnTimeline(state, action('mega'), rng)
  assertBeforeMoves(result)
  assert.equal(result.timeline.find(step => step.phase === 'announce')?.sideId, 'opponent')
})
check('Ogerpon Embody Aspect Speed boost changes the first-turn order', () => {
  const state = battle([pokemon('ogerpon', ['ivycudgel'])], [pokemon('jolteon', ['thunderbolt'])])
  assert(state.player.team[0].stats.speed < state.opponent.team[0].stats.speed)
  const result = engine.createBattleTurnTimeline(state, action('tera'), rng)
  assert.equal(result.state.player.team[0].statStages.speed, 1)
  assert.equal(result.timeline.find(step => step.phase === 'announce')?.sideId, 'player')
})
check('Mega entry ability is active before faster opposing attacks', () => {
  const state = battle([pokemon('charizard', ['flamethrower'], { heldItemId: 'charizardite-y' })], [pokemon('jolteon', ['thunderbolt'])])
  const result = engine.createBattleTurnTimeline(state, action('mega'), rng)
  const firstMove = result.timeline.find(step => step.phase === 'announce')
  assert.equal(firstMove.sideId, 'opponent')
  assert.equal(firstMove.state.rules.weather.id, 'sun')
  assert.equal(firstMove.state.player.team[0].ability, '가뭄')
})
check('Ordinary switching finishes before opposing Tera', () => {
  const state = battle([pokemon('jolteon', ['thunderbolt']), pokemon('mew', ['protect'])], [pokemon('snorlax', ['tackle'], { battleMechanics: ['terastallization'] })])
  const after = turn(state, [{ type: 'switch', actorSlot: 0, targetIndex: 1 }], [action('tera')])
  const logs = after.log.slice(state.log.length)
  const teraIndex = logs.findIndex(entry => entry.message.includes('테라스탈했다'))
  assert(teraIndex > 0)
  assert(logs.slice(0, teraIndex).some(entry => entry.message.includes('뮤')))
  assert.equal(after.player.activeIndex, 1)
})
check('Both sides transform before either side attacks in doubles', () => {
  const state = battle(
    [pokemon('snorlax', ['tackle']), pokemon('charizard', ['flamethrower'])],
    [pokemon('jolteon', ['thunderbolt'], { battleMechanics: ['terastallization'] }), pokemon('mew', ['psychic'], { battleMechanics: ['dynamax'] })], true,
  )
  const after = turn(state, [action('tera'), action('dynamax', 1)], [action('tera'), action('dynamax', 1)])
  const logs = after.log.slice(state.log.length)
  const firstAttack = logs.findIndex(entry => entry.kind === 'move' || /의 (몸통박치기|화염방사|10만볼트|사이코키네시스|다이번|다이사이코)/.test(entry.message))
  assert(firstAttack >= 0)
  assert.equal(logs.slice(0, firstAttack).filter(entry => entry.tone === 'gimmick').length, 4)
  assert(after.player.team[0].teraActive && after.opponent.team[0].teraActive)
  assert(after.player.team[1].dynamaxActive && after.opponent.team[1].dynamaxActive)
})
check('A pivot pause/resume neither delays nor repeats opponent Dynamax', () => {
  const state = battle([pokemon('jolteon', ['voltswitch']), pokemon('mew', ['protect'])], [pokemon('snorlax', ['tackle'], { battleMechanics: ['dynamax'] })])
  const paused = turn(state, [action('tera')], [action('dynamax')])
  assert(paused.awaitingPlayerSwitch)
  assert(paused.opponent.team[0].dynamaxActive)
  assert.equal(paused.opponent.team[0].maxHp, state.opponent.team[0].maxHp * 2)
  const resumed = engine.resumeBattleTurnTimeline(paused, 1, rng)
  assert.equal(resumed.state.opponent.team[0].maxHp, state.opponent.team[0].maxHp * 2)
  assert.equal(resumed.state.opponent.team[0].dynamaxTurns, 2)
  assert(!resumed.timeline.some(step => step.phase === 'gimmick'))
  assert.equal(resumed.state.turn, state.turn + 1)
})
check('A rejected or already used gimmick cannot transform again', () => {
  const state = battle([pokemon('snorlax', ['tackle'])], [pokemon('magikarp', ['splash'])])
  const first = turn(state, [action('tera')])
  const after = turn(first, [action('dynamax')])
  assert.equal(after.player.team[0].usedBattleMechanicId, 'tera')
  assert(!after.player.team[0].dynamaxActive)
  assert.equal(after.player.team[0].maxHp, state.player.team[0].maxHp)
})
check('Z-Move power is released at the attack, after faster ordinary moves', () => {
  const state = battle([pokemon('snorlax', ['tackle'], { heldItemId: 'normalium-z' })], [pokemon('jolteon', ['thunderbolt'])])
  const result = engine.createBattleTurnTimeline(state, action('zmove'), rng)
  const zIndex = result.timeline.findIndex(step => step.phase === 'gimmick' && step.mechanicId === 'zmove')
  const foeAttack = result.timeline.findIndex(step => step.phase === 'announce' && step.sideId === 'opponent')
  assert(foeAttack >= 0 && zIndex > foeAttack)
})
check('Tera type helper exposes actual fixed forms without mutating the battle', () => {
  const state = battle([pokemon('terapagos', ['terastarstorm']), pokemon('ogerpon-hearthflame-mask', ['ivycudgel'])], [pokemon('magikarp', ['splash'])])
  const before = structuredClone(state)
  assert.equal(engine.getBattleTeraType(state.player.team[0]), '스텔라')
  assert.equal(engine.getBattleTeraType(state.player.team[1]), '불꽃')
  assert.deepEqual(state, before)
})
check('The Ogerpon mask Tera type stays correct after changing to its Tera form', () => {
  const state = battle([pokemon('ogerpon-hearthflame-mask', ['ivycudgel'])], [pokemon('magikarp', ['splash'])])
  const after = turn(state, [action('tera')])
  assert(after.player.team[0].teraActive)
  assert.equal(engine.getBattleTeraType(after.player.team[0]), '불꽃')
  assert.deepEqual(after.player.team[0].types, ['불꽃'])
})

if (failures.length) {
  console.error(failures.join('\n\n'))
  process.exitCode = 1
} else console.log(`Validated ${checked} pre-move gimmick timing and Tera display regressions with legal Pokemon fixtures.`)
