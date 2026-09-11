import assert from 'node:assert/strict'
import pokemonData from '../src/data/generatedPokemonData.json' with { type: 'json' }
import {
  chooseAiActionsForSide,
  createBattle,
  createBattleTurnTimeline,
  getBattleMovePreview,
  playBattleTurnWithActions,
} from '../src/data/battleEngine.js'
import { getLearnableMoves, getMoveById } from '../src/data/trainingData.js'

// Real selectable species, legal moves, neutral natures, and zero training points.
// Sleep, stages, and Substitute fixtures represent positions before an attack.
// Rules: https://github.com/smogon/pokemon-showdown/blob/master/data/moves.ts (terablast)
// STAB: https://github.com/smogon/pokemon-showdown/blob/master/sim/battle-actions.ts
const profiles = new Map([...pokemonData.species, ...pokemonData.forms].map((profile) => [profile.slug, profile]))
const trainingPoints = { hp: 0, attack: 0, defense: 0, specialAttack: 0, specialDefense: 0, speed: 0 }
const moveAction = { type: 'move', actorSlot: 0, targetSlot: 0, moveIndex: 0, gimmick: null }
const failures = []
let checked = 0
let fixtureId = 0

function pokemon(slug, moveIds = ['terablast'], overrides = {}) {
  const profile = profiles.get(slug)
  assert(profile, `Missing Pokemon fixture: ${slug}`)
  const legal = new Set(getLearnableMoves(profile.id).map((move) => move.id))
  for (const id of moveIds) assert(legal.has(id), `${slug} cannot learn ${id}`)
  return {
    captureId: `tera-blast-${++fixtureId}-${slug}`,
    speciesId: profile.id,
    slug,
    nature: '노력',
    trainingPoints: { ...trainingPoints },
    ability: profile.abilities[0],
    teraType: '물',
    moveIds,
    moves: moveIds.map((id) => getMoveById(id).name),
    ...overrides,
  }
}

function position({ user = 'mew', userMoves = ['terablast'], userOptions = {}, target = 'snorlax',
  targetMoves = ['substitute'], targetOptions = {}, bench = [] } = {}) {
  const state = createBattle({
    playerPokemon: [pokemon(user, userMoves, userOptions), ...bench],
    opponent: { name: 'TERA BLAST REGRESSION', tier: 'C' },
    opponentTeam: {
      pokemon: [pokemon(target, targetMoves, targetOptions)],
      battleGimmicks: [],
      strategy: {},
    },
  })
  sleepTarget(state)
  return state
}

function sleepTarget(state) {
  state.opponent.team[0].status = { id: 'sleep', label: '잠듦', counter: 3, toxicCounter: 0 }
}

function turn(state, userAction = {}, targetAction = {}, rng = () => 0.5) {
  return playBattleTurnWithActions(state, [{ ...moveAction, ...userAction }], [{ ...moveAction, ...targetAction }], rng)
}

function preview(state, gimmick = null, moveIndex = 0) {
  return getBattleMovePreview(state, 'player', moveIndex, 0, 0, gimmick)
}

function damage(before, after) {
  return before.opponent.team[0].hp - after.opponent.team[0].hp
}

// Deterministic noncritical single-target formula, with explicit expected category,
// power, STAB, and modifiers. The engine chooses none of these expectations.
function expectedDamage(state, { category = 'special', power = 80, stab = 1, effectiveness = 1,
  offenseMultiplier = 1, damageMultiplier = 1, rng = 0.5 } = {}) {
  const user = state.player.team[0]
  const target = state.opponent.team[0]
  const key = category === 'physical' ? 'attack' : 'specialAttack'
  const defenseKey = category === 'physical' ? 'defense' : 'specialDefense'
  const stage = user.statStages[key]
  const stageMultiplier = stage >= 0 ? (2 + stage) / 2 : 2 / (2 - stage)
  const offense = user.stats[key] * stageMultiplier * offenseMultiplier
  const base = ((2 * user.level / 5 + 2) * power * offense / target.stats[defenseKey]) / 50 + 2
  return Math.floor(base * stab * effectiveness * damageMultiplier * (0.85 + rng * 0.15))
}

function check(name, fn) {
  checked += 1
  try {
    fn()
  } catch (error) {
    failures.push(`${name}: ${error.stack ?? error.message}`)
  }
}

check('The selectable move has Normal / special / 80 power / 100 accuracy / 10 PP', () => {
  const move = getMoveById('terablast')
  assert.equal(move.name, '테라버스트')
  assert.equal(move.type, '노말')
  assert.equal(move.categoryId, 'special')
  assert.equal(move.power, 80)
  assert.equal(move.accuracy, 100)
  assert.equal(move.pp, 10)
})

check('Before Terastallization, higher Attack and Choice Band do not change special damage', () => {
  const before = position({ user: 'dragonite', userOptions: { heldItemId: 'choice-band' } })
  assert(before.player.team[0].stats.attack > before.player.team[0].stats.specialAttack)
  const after = turn(before)
  assert.equal(damage(before, after), expectedDamage(before))
  assert.equal(after.player.team[0].moves[0].currentPp, 9)
  assert.equal(preview(before).categoryId, 'special')
})

check('The tera activation turn changes type, grants STAB, and uses special on an exact tie', () => {
  const before = position()
  assert.equal(before.player.team[0].stats.attack, before.player.team[0].stats.specialAttack)
  const after = turn(before, { gimmick: 'tera' })
  assert.equal(after.player.team[0].teraActive, true)
  assert.deepEqual(after.player.team[0].types, ['물'])
  assert.equal(damage(before, after), expectedDamage(before, { stab: 1.5 }))
  assert.equal(after.player.team[0].moves[0].currentPp, 9)
  assert.equal(preview(before, 'tera').type, '물')
  assert.equal(preview(before, 'tera').categoryId, 'special')
})

check('Tera of an original type receives double STAB', () => {
  const before = position({ userOptions: { teraType: '에스퍼' } })
  assert.equal(damage(before, turn(before, { gimmick: 'tera' })), expectedDamage(before, { stab: 2 }))
})

check('Positive Attack stages select physical Tera Blast', () => {
  const before = position()
  before.player.team[0].statStages.attack = 1
  assert.equal(damage(before, turn(before, { gimmick: 'tera' })), expectedDamage(before, { category: 'physical', stab: 1.5 }))
  assert.equal(preview(before, 'tera').categoryId, 'physical')
})

check('Special Attack stages can override a naturally higher Attack', () => {
  const before = position({ user: 'dragonite' })
  before.player.team[0].statStages.specialAttack = 1
  assert.equal(damage(before, turn(before, { gimmick: 'tera' })), expectedDamage(before, { stab: 1.5 }))
  assert.equal(preview(before, 'tera').categoryId, 'special')
})

check('Choice Band cannot make a tied user select physical', () => {
  const before = position({ userOptions: { heldItemId: 'choice-band' } })
  assert.equal(damage(before, turn(before, { gimmick: 'tera' })), expectedDamage(before, { stab: 1.5 }))
  assert.equal(preview(before, 'tera').categoryId, 'special')
})

check('Choice Specs cannot make a physically stronger user select special', () => {
  const before = position({ user: 'dragonite', userOptions: { heldItemId: 'choice-specs' } })
  assert(before.player.team[0].stats.attack < before.player.team[0].stats.specialAttack * 1.5)
  assert.equal(damage(before, turn(before, { gimmick: 'tera' })), expectedDamage(before, { category: 'physical', stab: 1.5 }))
  assert.equal(preview(before, 'tera').categoryId, 'physical')
})

check('Huge Power is excluded from category selection', () => {
  const before = position({ user: 'azumarill', userOptions: { ability: '천하장사', teraType: '에스퍼' } })
  const user = before.player.team[0]
  assert(user.stats.attack < user.stats.specialAttack && user.stats.attack * 2 > user.stats.specialAttack)
  assert.equal(damage(before, turn(before, { gimmick: 'tera' })), expectedDamage(before, { stab: 1.5 }))
  assert.equal(preview(before, 'tera').categoryId, 'special')
})

check('The selected physical category still receives its item damage modifier', () => {
  const before = position({ user: 'dragonite', userOptions: { heldItemId: 'choice-band' } })
  assert.equal(damage(before, turn(before, { gimmick: 'tera' })), expectedDamage(before, {
    category: 'physical', stab: 1.5, offenseMultiplier: 1.5,
  }))
})

check('Galvanize changes ordinary Tera Blast, but cannot change its active tera type or boost its damage', () => {
  const before = position({ user: 'golem-alola', userOptions: { ability: '일렉트릭스킨' } })
  assert.equal(preview(before).type, '전기')
  assert.equal(damage(before, turn(before)), expectedDamage(before, { stab: 1.5, damageMultiplier: 1.2 }))
  assert.equal(preview(before, 'tera').type, '물')
  assert.equal(damage(before, turn(before, { gimmick: 'tera' })), expectedDamage(before, { category: 'physical', stab: 1.5 }))
})

check('Normalize acquired with Skill Swap cannot override an active Tera Blast', () => {
  const before = position({ userMoves: ['skillswap', 'terablast'], target: 'delcatty',
    targetMoves: ['protect'], targetOptions: { ability: '노말스킨' } })
  const swapped = turn(before)
  assert.equal(swapped.player.team[0].ability, '노말스킨')
  assert.equal(preview(swapped, 'tera', 1).type, '물')
  assert.equal(damage(swapped, turn(swapped, { moveIndex: 1, gimmick: 'tera' })),
    expectedDamage(swapped, { stab: 1.5 }))
})

check('A physical Tera Blast interacts with Ice Face as a physical move', () => {
  const before = position({ user: 'dragonite', target: 'eiscue' })
  const after = turn(before, { gimmick: 'tera' })
  assert.equal(damage(before, after), 0)
  assert.equal(after.opponent.team[0].iceFaceBroken, true)
})

check('Normal Ghost immunity disappears after Water Terastallization', () => {
  const before = position({ target: 'gengar' })
  assert.equal(damage(before, turn(before)), 0)
  assert.equal(damage(before, turn(before, { gimmick: 'tera' })), expectedDamage(before, { stab: 1.5 }))
})

check('Stellar uses 100 power, a first-use 1.2 bonus, and lowers both offenses', () => {
  const before = position({ userOptions: { teraType: '스텔라' } })
  const after = turn(before, { gimmick: 'tera' })
  assert.equal(damage(before, after), expectedDamage(before, { power: 100, stab: 1.2 }))
  assert.equal(after.player.team[0].statStages.attack, -1)
  assert.equal(after.player.team[0].statStages.specialAttack, -1)
  assert.equal(after.player.team[0].moves[0].currentPp, 9)
  assert.equal(preview(before, 'tera').type, '스텔라')
  assert.equal(preview(before, 'tera').power, 100)
  assert.deepEqual(after.player.team[0].types, before.player.team[0].types)
})

check('Stellar Tera Blast is super effective against a Terastallized target', () => {
  const before = position({ userOptions: { teraType: '스텔라' }, targetMoves: ['protect'],
    targetOptions: { teraType: '고스트', battleMechanics: ['terastallization'] } })
  before.opponent.team[0].status = null
  const activated = turn(before, { gimmick: 'tera' }, { gimmick: 'tera' })
  assert.equal(activated.opponent.team[0].teraActive, true)
  assert.equal(damage(before, activated), 0)
  sleepTarget(activated)
  assert.equal(damage(activated, turn(activated)), expectedDamage(activated, { power: 100, stab: 1.2, effectiveness: 2 }))
})

check('Repeating Stellar Tera Blast does not refresh its per-type bonus', () => {
  const before = position({ userOptions: { teraType: '스텔라' } })
  const first = turn(before, { gimmick: 'tera' })
  const second = turn(first)
  assert.equal(damage(first, second), expectedDamage(first, { power: 100, stab: 1 }))
  assert.equal(second.player.team[0].statStages.attack, -2)
  assert.equal(second.player.team[0].statStages.specialAttack, -2)
})

check('Protect blocks damage and stat drops without spending the Stellar bonus', () => {
  const before = position({ userOptions: { teraType: '스텔라' }, targetMoves: ['protect'] })
  before.opponent.team[0].status = null
  const blocked = turn(before, { gimmick: 'tera' })
  assert.equal(damage(before, blocked), 0)
  assert.equal(blocked.player.team[0].statStages.attack, 0)
  assert.equal(blocked.player.team[0].statStages.specialAttack, 0)
  assert.equal(blocked.player.team[0].moves[0].currentPp, 9)
  sleepTarget(blocked)
  assert.equal(damage(blocked, turn(blocked)), expectedDamage(blocked, { power: 100, stab: 1.2 }))
})

check('A miss does not lower offenses or spend the Stellar bonus', () => {
  const before = position({ userOptions: { teraType: '스텔라' } })
  before.player.team[0].statStages.accuracy = -6
  const missed = turn(before, { gimmick: 'tera' }, {}, () => 0.99)
  assert.equal(damage(before, missed), 0)
  assert.equal(missed.player.team[0].statStages.attack, 0)
  assert.equal(missed.player.team[0].statStages.specialAttack, 0)
  missed.player.team[0].statStages.accuracy = 0
  assert.equal(damage(missed, turn(missed)), expectedDamage(missed, { power: 100, stab: 1.2 }))
})

check('Hitting Substitute lowers the user offenses and spends the Stellar bonus', () => {
  const before = position({ userOptions: { teraType: '스텔라' } })
  const target = before.opponent.team[0]
  target.substituteHp = Math.floor(target.maxHp / 4)
  target.hp -= target.substituteHp
  const first = turn(before, { gimmick: 'tera' })
  assert.equal(damage(before, first), 0)
  assert.equal(target.substituteHp - first.opponent.team[0].substituteHp,
    Math.min(target.substituteHp, expectedDamage(before, { power: 100, stab: 1.2 })))
  assert.equal(first.player.team[0].statStages.attack, -1)
  assert.equal(first.player.team[0].statStages.specialAttack, -1)
  first.opponent.team[0].substituteHp = 0
  assert.equal(damage(first, turn(first)), expectedDamage(first, { power: 100, stab: 1 }))
})

check('Switching preserves Stellar bonus consumption while resetting ordinary stat stages', () => {
  const before = position({ userOptions: { teraType: '스텔라' }, bench: [pokemon('azumarill', ['splash'])] })
  const first = turn(before, { gimmick: 'tera' })
  const away = turn(first, { type: 'switch', targetIndex: 1 })
  sleepTarget(away)
  const back = turn(away, { type: 'switch', targetIndex: 0 })
  assert.equal(back.player.team[0].teraActive, true)
  assert.equal(back.player.team[0].statStages.attack, 0)
  assert.equal(back.player.team[0].statStages.specialAttack, 0)
  sleepTarget(back)
  assert.equal(damage(back, turn(back)), expectedDamage(back, { power: 100, stab: 1 }))
})

check('Stellar retains original defensive weaknesses', () => {
  const before = position({ userMoves: ['darkpulse'], target: 'mew', targetMoves: ['protect'],
    targetOptions: { teraType: '스텔라', battleMechanics: ['terastallization'] } })
  const normal = turn(before)
  before.opponent.team[0].status = null
  const activated = turn(before, {}, { gimmick: 'tera' })
  assert.equal(activated.opponent.team[0].teraActive, true)
  assert.equal(damage(before, activated), 0)
  sleepTarget(activated)
  const stellar = turn(activated)
  assert.deepEqual(stellar.opponent.team[0].types, ['에스퍼'])
  assert.equal(damage(before, normal), expectedDamage(before, { power: 80, effectiveness: 2 }))
  assert.equal(damage(before, stellar), damage(before, normal))
})

check('Each original-type Stellar boost is used once and then returns to ordinary STAB', () => {
  const before = position({ userMoves: ['psychic'], userOptions: { teraType: '스텔라' } })
  const first = turn(before, { gimmick: 'tera' })
  const second = turn(first)
  assert.equal(damage(before, first), expectedDamage(before, { power: 90, stab: 2 }))
  assert.equal(damage(first, second), expectedDamage(first, { power: 90, stab: 1.5 }))
  assert.equal(second.player.team[0].statStages.specialAttack, 0)
})

check('A different Stellar attack type has its own one-time bonus', () => {
  const before = position({ userMoves: ['psychic', 'waterpulse'], userOptions: { teraType: '스텔라' } })
  const first = turn(before, { gimmick: 'tera' })
  const water = turn(first, { moveIndex: 1 })
  sleepTarget(water)
  const repeated = turn(water, { moveIndex: 1 })
  assert.equal(damage(first, water), expectedDamage(first, { power: 60, stab: 1.2 }))
  assert.equal(damage(water, repeated), expectedDamage(water, { power: 60, stab: 1 }))
})

check('Triple Axel keeps the Stellar bonus for all three hits, then spends it for the next use', () => {
  const before = position({ user: 'tsareena', userMoves: ['tripleaxel'], userOptions: { teraType: '스텔라' } })
  const ordinary = turn(before)
  const first = turn(before, { gimmick: 'tera' })
  const second = turn(first)
  const perHitTotal = (stab) => [20, 40, 60].reduce((total, power) => (
    total + expectedDamage(before, { category: 'physical', power, stab })
  ), 0)

  // Triple Axel increases power each hit. Rounding each hit separately catches a
  // bonus applied only to the first hit, while the ordinary public battle run
  // independently anchors the damage of the later, already-consumed use.
  assert.equal(damage(before, ordinary), perHitTotal(1))
  assert.equal(damage(before, first), perHitTotal(4915 / 4096))
  assert.equal(first.player.team[0].teraActive, true)
  assert.equal(damage(first, second), damage(before, ordinary))
  assert(damage(before, first) > damage(first, second))
  assert.equal(first.player.team[0].moves[0].currentPp, before.player.team[0].moves[0].currentPp - 1)
  assert.equal(second.player.team[0].moves[0].currentPp, before.player.team[0].moves[0].currentPp - 2)
})

check('Stellar Terapagos keeps its per-type bonus for repeated attacks', () => {
  const before = position({ user: 'terapagos', userMoves: ['waterpulse'], userOptions: { teraType: '스텔라' } })
  const first = turn(before, { gimmick: 'tera' })
  assert.equal(first.player.team[0].slug, 'terapagos-stellar')
  const second = turn(first)
  sleepTarget(second)
  const third = turn(second)
  assert.equal(damage(first, second), expectedDamage(first, { power: 60, stab: 1.2 }))
  assert.equal(damage(second, third), expectedDamage(second, { power: 60, stab: 1.2 }))
})

check('Preview and AI planning never spend PP, activate tera, lower stages, or consume boosts', () => {
  const before = position({ userOptions: { teraType: '스텔라' } })
  const snapshot = structuredClone(before)
  for (let i = 0; i < 3; i += 1) preview(before, 'tera')
  chooseAiActionsForSide(before, 'player', () => 0.5)
  assert.deepEqual(before, snapshot)
  const active = turn(before, { gimmick: 'tera' })
  const activeSnapshot = structuredClone(active)
  preview(active)
  chooseAiActionsForSide(active, 'player', () => 0.5)
  assert.deepEqual(active, activeSnapshot)
})

check('The animation timeline announces the resolved tera type and preserves the source state', () => {
  const before = position({ userOptions: { teraType: '스텔라' } })
  const snapshot = structuredClone(before)
  const result = createBattleTurnTimeline(before, { ...moveAction, gimmick: 'tera' }, () => 0.5)
  const announce = result.timeline.find((step) => step.phase === 'announce' && step.sideId === 'player')
  assert.equal(announce?.moveId, 'terablast')
  assert.equal(announce?.moveType, '스텔라')
  assert.equal(result.state.player.team[0].statStages.attack, -1)
  assert.deepEqual(before, snapshot)
})

if (failures.length) {
  console.error(failures.join('\n\n'))
  console.error(`Tera Blast regression: ${checked - failures.length}/${checked} checks passed.`)
  process.exitCode = 1
} else {
  console.log(`Validated ${checked} Tera Blast and Stellar battle regressions with legal Pokemon fixtures.`)
}
