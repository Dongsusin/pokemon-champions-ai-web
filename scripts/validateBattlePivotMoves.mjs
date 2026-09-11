import assert from 'node:assert/strict'
import * as engine from '../src/data/battleEngine.js'
import { getLearnableMoves, getMoveById, SPECIES_PROFILES } from '../src/data/trainingData.js'

// Modern move and switch semantics, checked against the primary simulator source:
// https://github.com/smogon/pokemon-showdown/blob/master/data/moves.ts
// https://github.com/smogon/pokemon-showdown/blob/master/sim/battle-actions.ts
// https://github.com/smogon/pokemon-showdown/blob/master/sim/battle.ts
// Fixtures use real selectable species, legal moves and ordinary training values.
const profiles = new Map(Object.values(SPECIES_PROFILES).map((profile) => [profile.slug, profile]))
const trainingPoints = { hp: 0, attack: 0, defense: 0, specialAttack: 0, specialDefense: 0, speed: 0 }
const random = () => 0.5
const failures = []
let checked = 0
let nextId = 0

function pokemon(slug, ids, extra = {}) {
  const profile = profiles.get(slug)
  assert(profile, `Missing species ${slug}`)
  const legal = new Set(getLearnableMoves(profile.id).map((move) => move.id))
  for (const id of ids) assert(legal.has(id), `${slug} cannot learn ${id}`)
  return {
    captureId: `pivot-${++nextId}-${slug}`, speciesId: profile.id, slug,
    ability: profile.abilities[0], nature: '노력', trainingPoints: { ...trainingPoints },
    moves: ids.map((id) => getMoveById(id).name), moveIds: ids, ...extra,
  }
}

const action = (moveIndex = 0, actorSlot = 0, extra = {}) => ({
  type: 'move', moveIndex, actorSlot, targetSlot: 0, gimmick: null, ...extra,
})
const bench = () => [pokemon('mew', ['protect']), pokemon('ninetales', ['protect'], { ability: '가뭄' })]

function battle(players, opponents = [pokemon('snorlax', ['tackle'])], { double = false, terrain = 'neutral' } = {}) {
  return engine.createBattle({
    playerPokemon: players, opponent: { name: 'PIVOT MOVE AUDIT', tier: 'C' },
    opponentTeam: { pokemon: opponents, battleGimmicks: [], strategy: {} },
    rules: {
      weather: { id: 'clear', label: '맑음' }, terrain: { id: terrain, label: terrain },
      format: { id: double ? 'double' : 'single', activeSlots: double ? 2 : 1, actionSlots: double ? 2 : 1 },
      teamRule: { id: 'full', battleSize: Math.max(players.length, opponents.length) },
    },
  })
}

function turn(state, players = [action()], opponents = [action()], rng = random) {
  return engine.playBattleTurnWithActions(state, players, opponents, rng)
}

function quiet(state, sideId = 'opponent') {
  for (const target of state[sideId].team) {
    target.status = { id: 'sleep', label: '잠듦', counter: 3, toxicCounter: 0 }
  }
  return state
}

function resume(state, index, rng = random) {
  assert.equal(typeof engine.resumeBattleTurnTimeline, 'function', 'The public mid-turn resume API must exist')
  return engine.resumeBattleTurnTimeline(state, index, rng)
}

function expectPivot(state, slot = 0) {
  assert.equal(state.awaitingPlayerSwitch, true, 'The turn must wait for the player replacement choice')
  assert.deepEqual(state.awaitingPlayerSwitchSlots, [slot])
  assert.equal(state.pendingPlayerSwitch?.kind, 'pivot')
  assert.equal(state.pendingPlayerSwitch?.actorSlot, slot)
  assert(state.pendingTurn, 'The unfinished turn must retain its remaining actions')
}

function check(name, fn) {
  checked += 1
  try { fn() } catch (error) { failures.push(`${name}: ${error.stack ?? error.message}`) }
}

check('Volt Switch pauses before the next attack and resumes with the exact chosen replacement', () => {
  const before = battle([pokemon('raichu', ['voltswitch']), ...bench()])
  const snapshot = structuredClone(before)
  const waiting = turn(before)
  expectPivot(waiting)
  assert.equal(waiting.turn, before.turn)
  assert.equal(waiting.player.activeIndexes[0], 0)
  assert(waiting.opponent.team[0].hp < before.opponent.team[0].hp)
  assert.equal(waiting.opponent.team[0].moves[0].currentPp, before.opponent.team[0].moves[0].currentPp)
  assert.equal(waiting.player.team[0].hp, before.player.team[0].hp)
  assert.equal(waiting.player.team[0].moves[0].currentPp, before.player.team[0].moves[0].currentPp - 1)
  assert.deepEqual(before, snapshot)

  const waitingSnapshot = structuredClone(waiting)
  const result = resume(waiting, 2)
  const after = result.state
  assert.deepEqual(waiting, waitingSnapshot)
  assert.equal(after.player.activeIndexes[0], 2)
  assert(after.player.team[2].hp < before.player.team[2].hp, 'The pending enemy attack must hit the chosen Pokemon')
  assert.equal(after.player.team[0].hp, before.player.team[0].hp)
  assert.equal(after.player.team[1].hp, before.player.team[1].hp)
  assert.equal(after.opponent.team[0].moves[0].currentPp, before.opponent.team[0].moves[0].currentPp - 1)
  assert.equal(after.turn, before.turn + 1)
  assert.equal(after.awaitingPlayerSwitch, false)
  const entry = result.timeline.findIndex((step) => step.phase === 'switch' && step.sideId === 'player')
  const attack = result.timeline.findIndex((step) => step.phase === 'announce' && step.sideId === 'opponent')
  assert(entry >= 0 && attack > entry, 'Replacement entry must occur before the remaining opponent action')
  const drought = after.log.findIndex((entry) => entry.message.includes('가뭄'))
  const tackle = after.log.findIndex((entry) => entry.message.includes('몸통박치기'))
  assert(drought >= 0 && tackle > drought, 'The incoming ability must run before the remaining opponent move')
})

check('A waiting pivot rejects active, fainted, invalid, and duplicate choices without advancing', () => {
  const before = battle([pokemon('raichu', ['voltswitch']), ...bench()])
  before.player.team[1].hp = 0
  before.player.team[1].fainted = true
  const waiting = turn(before)
  expectPivot(waiting)
  for (const index of [0, 1, -1, 99]) assert.deepEqual(resume(waiting, index).state, waiting)
  assert.deepEqual(turn(waiting), waiting, 'A new command cannot overwrite a paused turn')
  const after = resume(waiting, 2).state
  assert.deepEqual(resume(after, 1).state, after, 'An already completed choice cannot execute the turn twice')
})

check('Residual damage and recovery wait until the entire resumed turn completes exactly once', () => {
  const before = quiet(battle([pokemon('raichu', ['voltswitch']),
    pokemon('mew', ['protect'], { heldItemId: 'leftovers' })]))
  before.player.team[1].hp -= 50
  before.opponent.team[0].status = { id: 'poison', label: '독', toxicCounter: 0 }
  const waiting = turn(before)
  expectPivot(waiting)
  assert.equal(waiting.player.team[1].hp, before.player.team[1].hp)
  const after = resume(waiting, 1).state
  const withoutRecovery = structuredClone(waiting)
  withoutRecovery.player.team[1].heldItemId = null
  withoutRecovery.player.team[1].heldItemName = null
  const control = resume(withoutRecovery, 1).state
  const poisonDamage = Math.floor(before.opponent.team[0].maxHp / 8)
  assert.equal(waiting.opponent.team[0].hp - after.opponent.team[0].hp, poisonDamage)
  assert.equal(after.player.team[1].hp - control.player.team[1].hp, Math.floor(before.player.team[1].maxHp / 16))
  const recovered = after.log.filter((entry) => entry.message.includes('먹다남은음식'))
  assert.equal(recovered.length, 1)
  assert.equal(after.turn, before.turn + 1)
})

for (const [slug, moveId] of [['scizor', 'uturn'], ['palafin', 'flipturn']]) {
  check(`${moveId} still requests a choice when damage is absorbed by Substitute`, () => {
    const before = quiet(battle([pokemon(slug, [moveId]), ...bench()]))
    const target = before.opponent.team[0]
    target.substituteHp = Math.floor(target.maxHp / 4)
    target.hp -= target.substituteHp
    const waiting = turn(before)
    expectPivot(waiting)
    assert.equal(waiting.opponent.team[0].hp, target.hp)
    assert(waiting.opponent.team[0].substituteHp < target.substituteHp)
    assert.equal(resume(waiting, 1).state.player.activeIndexes[0], 1)
  })
}

for (const [target, ability] of [['garchomp', '모래숨기'], ['raichu', '피뢰침'], ['electivire', '전기엔진']]) {
  check(`Volt Switch cannot pivot through ${target} / ${ability} immunity`, () => {
    const before = quiet(battle([pokemon('raichu', ['voltswitch']), ...bench()], [pokemon(target, ['protect'], { ability })]))
    const after = turn(before)
    assert.equal(after.awaitingPlayerSwitch, false)
    assert.equal(after.player.activeIndexes[0], 0)
    assert.equal(after.opponent.team[0].hp, before.opponent.team[0].hp)
  })
}

check('Flip Turn cannot pivot through Water Absorb', () => {
  const before = quiet(battle([pokemon('palafin', ['flipturn']), ...bench()], [pokemon('vaporeon', ['protect'], { ability: '저수' })]))
  before.opponent.team[0].hp -= 50
  const after = turn(before)
  assert.equal(after.awaitingPlayerSwitch, false)
  assert.equal(after.player.activeIndexes[0], 0)
  assert(after.opponent.team[0].hp > before.opponent.team[0].hp)
})

check('A miss or Protect never opens a pivot choice', () => {
  const before = battle([pokemon('raichu', ['voltswitch']), ...bench()], [pokemon('snorlax', ['protect'])])
  const protectedState = turn(before)
  assert.equal(protectedState.awaitingPlayerSwitch, false)
  assert.equal(protectedState.player.activeIndexes[0], 0)
  quiet(before)
  before.player.team[0].statStages.accuracy = -6
  const missed = turn(before, [action()], [action()], () => 0.99)
  assert.equal(missed.awaitingPlayerSwitch, false)
  assert.equal(missed.player.activeIndexes[0], 0)
})

check('An attacking pivot without a living bench still deals damage and finishes the turn', () => {
  const before = quiet(battle([pokemon('raichu', ['voltswitch'])]))
  const after = turn(before)
  assert(after.opponent.team[0].hp < before.opponent.team[0].hp)
  assert.equal(after.awaitingPlayerSwitch, false)
  assert.equal(after.turn, before.turn + 1)
})

check('Defeating the last enemy finishes the battle without a redundant pivot choice', () => {
  const before = quiet(battle([pokemon('raichu', ['voltswitch']), ...bench()]))
  before.opponent.team[0].hp = 1
  const after = turn(before)
  assert.equal(after.winner, 'player')
  assert.equal(after.awaitingPlayerSwitch, false)
})

check('Baton Pass carries stages and Substitute before entry items activate', () => {
  const before = quiet(battle([pokemon('mew', ['batonpass']),
    pokemon('snorlax', ['protect'], { heldItemId: 'electric-seed' })], undefined, { terrain: 'electric' }))
  const user = before.player.team[0]
  user.statStages.defense = 2
  user.statStages.speed = 1
  user.substituteHp = Math.floor(user.maxHp / 4)
  user.hp -= user.substituteHp
  const waiting = turn(before)
  expectPivot(waiting)
  const after = resume(waiting, 1).state
  assert.equal(after.player.team[1].statStages.defense, 3, 'The entry seed adds to the passed stages')
  assert.equal(after.player.team[1].statStages.speed, 1)
  assert.equal(after.player.team[1].substituteHp, user.substituteHp)
  assert.equal(after.player.team[1].consumedItem, true)
  assert.equal(after.player.team[0].substituteHp, 0)
  assert.equal(after.player.team[0].statStages.defense, 0)
})

check('Baton Pass fails with no replacement, while Teleport retains its -6 priority', () => {
  const failed = turn(quiet(battle([pokemon('mew', ['batonpass'])])))
  assert.equal(failed.awaitingPlayerSwitch, false)
  assert.equal(failed.player.team[0].moveFailedThisTurn, true)
  const before = battle([pokemon('mew', ['teleport']), ...bench()])
  const waiting = turn(before)
  expectPivot(waiting)
  assert(waiting.player.team[0].hp < before.player.team[0].hp, 'The faster teleport user still takes the earlier ordinary move')
  assert.equal(waiting.opponent.team[0].moves[0].currentPp, before.opponent.team[0].moves[0].currentPp - 1)
  const after = resume(waiting, 1).state
  assert.equal(after.player.team[1].hp, before.player.team[1].hp)
  assert.equal(after.turn, before.turn + 1)
})

check('Shed Tail pays rounded-up half HP and passes a quarter-HP Substitute after a choice', () => {
  const before = quiet(battle([pokemon('cyclizar', ['shedtail'], { ability: '탈피' }), ...bench()]))
  const user = before.player.team[0]
  assert.equal(user.maxHp % 2, 1, 'This fixture must distinguish floor from ceil')
  const waiting = turn(before)
  expectPivot(waiting)
  assert.equal(waiting.player.team[0].hp, user.hp - Math.ceil(user.maxHp / 2))
  const after = resume(waiting, 1).state
  assert.equal(after.player.team[1].substituteHp, Math.floor(user.maxHp / 4))
  assert.equal(after.player.team[1].hp, before.player.team[1].hp)
})

check('Shed Tail fails at half-HP rounded up, with an existing Substitute, or without a bench', () => {
  for (const condition of ['threshold', 'substitute', 'no-bench']) {
    const before = quiet(battle([pokemon('cyclizar', ['shedtail'], { ability: '탈피' }), ...(condition === 'no-bench' ? [] : bench())]))
    if (condition === 'threshold') before.player.team[0].hp = Math.ceil(before.player.team[0].maxHp / 2)
    if (condition === 'substitute') before.player.team[0].substituteHp = 20
    const after = turn(before)
    assert.equal(after.awaitingPlayerSwitch, false, condition)
    assert.equal(after.player.team[0].hp, before.player.team[0].hp, condition)
    assert.equal(after.player.team[0].moveFailedThisTurn, true, condition)
  }
})

check('Chilly Reception sets snow before the choice and can pivot again when snow already exists', () => {
  const before = quiet(battle([pokemon('slowking', ['chillyreception']), ...bench()]))
  const first = turn(before)
  expectPivot(first)
  assert(['snow', 'snowscape'].includes(first.rules.weather.id))
  const finished = resume(first, 1).state
  const returned = turn(quiet(finished), [{ type: 'switch', actorSlot: 0, targetIndex: 0 }])
  const second = turn(quiet(returned))
  expectPivot(second)
  const withoutBench = turn(quiet(battle([pokemon('slowking', ['chillyreception'])])))
  assert(['snow', 'snowscape'].includes(withoutBench.rules.weather.id))
  assert.equal(withoutBench.awaitingPlayerSwitch, false)
})

check('Parting Shot lowers both target offenses before requesting a replacement, bypassing Substitute', () => {
  const before = quiet(battle([pokemon('incineroar', ['partingshot'], { ability: '맹화' }), ...bench()]))
  before.opponent.team[0].substituteHp = 30
  const waiting = turn(before)
  expectPivot(waiting)
  assert.equal(waiting.opponent.team[0].statStages.attack, -1)
  assert.equal(waiting.opponent.team[0].statStages.specialAttack, -1)
  assert.equal(waiting.opponent.team[0].substituteHp, 30)
})

check('Parting Shot fails to pivot when neither target offense can change', () => {
  for (const condition of ['both-minimum', 'clear-body', 'clear-amulet', 'soundproof']) {
    const target = condition === 'clear-body' ? pokemon('metagross', ['protect'], { ability: '클리어바디' })
      : condition === 'soundproof' ? pokemon('exploud', ['protect'], { ability: '방음' })
        : pokemon('snorlax', ['protect'], condition === 'clear-amulet' ? { heldItemId: 'clear-amulet' } : {})
    const before = quiet(battle([pokemon('incineroar', ['partingshot'], { ability: '맹화' }), ...bench()], [target]))
    if (condition === 'both-minimum') {
      before.opponent.team[0].statStages.attack = -6
      before.opponent.team[0].statStages.specialAttack = -6
    }
    const after = turn(before)
    assert.equal(after.awaitingPlayerSwitch, false, condition)
    assert.equal(after.player.activeIndexes[0], 0, condition)
    assert.equal(after.opponent.team[0].statStages.attack, before.opponent.team[0].statStages.attack, condition)
    assert.equal(after.opponent.team[0].statStages.specialAttack, before.opponent.team[0].statStages.specialAttack, condition)
  }
})

check('Parting Shot can pivot when only one offense changes', () => {
  const before = quiet(battle([pokemon('incineroar', ['partingshot'], { ability: '맹화' }), ...bench()]))
  before.opponent.team[0].statStages.attack = -6
  const waiting = turn(before)
  expectPivot(waiting)
  assert.equal(waiting.opponent.team[0].statStages.attack, -6)
  assert.equal(waiting.opponent.team[0].statStages.specialAttack, -1)
})

check('Mirror Armor reflects Parting Shot drops while retaining the original user pivot', () => {
  const before = quiet(battle([pokemon('incineroar', ['partingshot'], { ability: '맹화' }), ...bench()],
    [pokemon('corviknight', ['protect'], { ability: '미러아머' })]))
  const waiting = turn(before)
  expectPivot(waiting)
  assert.equal(waiting.opponent.team[0].statStages.attack, 0)
  assert.equal(waiting.opponent.team[0].statStages.specialAttack, 0)
  assert.equal(waiting.player.team[0].statStages.attack, -1)
  assert.equal(waiting.player.team[0].statStages.specialAttack, -1)
})

check('A target White Herb restores Parting Shot drops without canceling the successful pivot', () => {
  const before = quiet(battle([pokemon('incineroar', ['partingshot'], { ability: '맹화' }), ...bench()],
    [pokemon('snorlax', ['protect'], { heldItemId: 'white-herb' })]))
  const waiting = turn(before)
  expectPivot(waiting)
  assert.equal(waiting.opponent.team[0].consumedItem, true)
  assert.equal(waiting.opponent.team[0].statStages.attack, 0)
  assert.equal(waiting.opponent.team[0].statStages.specialAttack, 0)
})

check('White Herb restores both Mirror Armor reflected drops while the original user can still pivot', () => {
  const before = quiet(battle([
    pokemon('incineroar', ['partingshot'], { ability: '맹화', heldItemId: 'white-herb' }), ...bench(),
  ], [pokemon('corviknight', ['protect'], { ability: '미러아머' })]))
  const waiting = turn(before)
  expectPivot(waiting)
  assert.equal(waiting.player.team[0].consumedItem, true)
  assert.equal(waiting.player.team[0].statStages.attack, 0)
  assert.equal(waiting.player.team[0].statStages.specialAttack, 0)
  assert.equal(waiting.opponent.team[0].statStages.attack, 0)
  assert.equal(waiting.opponent.team[0].statStages.specialAttack, 0)
})

check('Mirror Armor still allows Parting Shot to pivot when reflected stat drops cannot apply', () => {
  for (const condition of ['clear-amulet', 'both-minimum']) {
    const before = quiet(battle([
      pokemon('incineroar', ['partingshot'], { ability: '맹화', ...(condition === 'clear-amulet' ? { heldItemId: 'clear-amulet' } : {}) }),
      ...bench(),
    ], [pokemon('corviknight', ['protect'], { ability: '미러아머' })]))
    if (condition === 'both-minimum') {
      before.player.team[0].statStages.attack = -6
      before.player.team[0].statStages.specialAttack = -6
    }
    const waiting = turn(before)
    expectPivot(waiting)
    assert.equal(waiting.player.team[0].statStages.attack, before.player.team[0].statStages.attack, condition)
    assert.equal(waiting.player.team[0].statStages.specialAttack, before.player.team[0].statStages.specialAttack, condition)
    assert.equal(waiting.opponent.team[0].statStages.attack, 0)
    assert.equal(waiting.opponent.team[0].statStages.specialAttack, 0)
  }
})

check('Magic Bounce makes the reflecting opponent pivot instead of opening a player choice', () => {
  const before = quiet(battle([pokemon('incineroar', ['partingshot'], { ability: '맹화' }), ...bench()],
    [pokemon('espeon', ['protect'], { ability: '매직미러' }), pokemon('snorlax', ['protect'])]))
  // Explicitly use the reflector as the starting active Pokemon if AI lead scoring differs.
  before.opponent.activeIndexes = [0]
  before.opponent.activeIndex = 0
  const after = turn(before)
  assert.equal(after.awaitingPlayerSwitch, false)
  assert.equal(after.player.activeIndexes[0], 0)
  assert.equal(after.opponent.activeIndexes[0], 1)
  assert.equal(after.player.team[0].statStages.attack, -1)
  assert.equal(after.player.team[0].statStages.specialAttack, -1)
})

check('Two allied pivots in doubles each pause independently without replaying either move', () => {
  const before = quiet(battle([
    pokemon('raichu', ['voltswitch']), pokemon('cyclizar', ['uturn']),
    pokemon('mew', ['protect']), pokemon('ninetales', ['protect']),
  ], [pokemon('snorlax', ['tackle']), pokemon('slowking', ['tackle'])], { double: true }))
  const waiting = turn(before, [action(0, 0), action(0, 1, { targetSlot: 1 })], [action(0, 0), action(0, 1)])
  expectPivot(waiting, 1)
  assert.equal(waiting.player.team[0].moves[0].currentPp, before.player.team[0].moves[0].currentPp)
  const second = resume(waiting, 2).state
  expectPivot(second, 0)
  assert.deepEqual(second.player.activeIndexes, [0, 2])
  assert.deepEqual(resume(second, 2).state, second, 'A doubles ally currently on the field cannot be selected')
  const after = resume(second, 3).state
  assert.deepEqual(after.player.activeIndexes, [3, 2])
  assert.equal(after.player.team[0].moves[0].currentPp, before.player.team[0].moves[0].currentPp - 1)
  assert.equal(after.player.team[1].moves[0].currentPp, before.player.team[1].moves[0].currentPp - 1)
  assert.equal(after.turn, before.turn + 1)
  assert.equal(after.awaitingPlayerSwitch, false)
})

check('A doubles ally fainted before the pivot keeps its own later replacement slot', () => {
  const before = battle([
    pokemon('raichu', ['voltswitch']), pokemon('mew', ['confusion']),
    pokemon('snorlax', ['protect']), pokemon('ninetales', ['protect']),
  ], [pokemon('dragonite', ['extremespeed']), pokemon('snorlax', ['tackle'])], { double: true })
  before.player.team[1].hp = 1
  const waiting = turn(before,
    [action(0, 0, { targetSlot: 1 }), action(0, 1)],
    [action(0, 0, { targetSlot: 1 }), action(0, 1)])
  expectPivot(waiting, 0)
  assert.equal(waiting.player.team[1].fainted, true)
  const faintChoice = resume(waiting, 2).state
  assert.deepEqual(faintChoice.player.activeIndexes, [2, 1])
  assert.equal(faintChoice.awaitingPlayerSwitch, true)
  assert.deepEqual(faintChoice.awaitingPlayerSwitchSlots, [1])
  assert.equal(faintChoice.turn, before.turn + 1)
  const after = resume(faintChoice, 3).state
  assert.deepEqual(after.player.activeIndexes, [2, 3])
  assert.equal(after.awaitingPlayerSwitch, false)
  assert.equal(after.turn, before.turn + 1, 'The later faint replacement must not run another residual phase')
})

check('AI pivots finish automatically and predictive planning leaves the real battle unchanged', () => {
  const before = battle([pokemon('snorlax', ['tackle']), ...bench()],
    [pokemon('raichu', ['voltswitch']), pokemon('mew', ['protect'])])
  before.opponent.activeIndexes = [0]
  before.opponent.activeIndex = 0
  const snapshot = structuredClone(before)
  engine.chooseAiActionsForSide(before, 'opponent', random)
  assert.deepEqual(before, snapshot)
  const after = turn(before)
  assert.equal(after.awaitingPlayerSwitch, false)
  assert.equal(after.opponent.activeIndexes[0], 1)
  assert.equal(after.turn, before.turn + 1)
})

check('Eject Button requests the holder replacement and cancels the attacking opponent pivot', () => {
  const before = battle([pokemon('snorlax', ['tackle'], { heldItemId: 'eject-button' }), ...bench()],
    [pokemon('mew', ['uturn']), pokemon('snorlax', ['protect'])])
  before.opponent.activeIndexes = [0]
  before.opponent.activeIndex = 0
  const waiting = turn(before)
  assert.equal(waiting.awaitingPlayerSwitch, true)
  assert.equal(waiting.pendingPlayerSwitch?.kind, 'item')
  assert.equal(waiting.player.team[0].consumedItem, true)
  assert.equal(waiting.player.team[0].moves[0].currentPp, before.player.team[0].moves[0].currentPp)
  assert.equal(waiting.opponent.activeIndexes[0], 0)
  const after = resume(waiting, 1).state
  assert.equal(after.player.activeIndexes[0], 1)
  assert.equal(after.opponent.activeIndexes[0], 0)
  assert.equal(after.player.team[0].moves[0].currentPp, before.player.team[0].moves[0].currentPp,
    'The outgoing holder must not execute its original queued action')
  assert.equal(after.turn, before.turn + 1)
})

check('Eject Pack triggered by Close Combat offers a replacement after the move finishes', () => {
  const before = quiet(battle([pokemon('lucario', ['closecombat'], { heldItemId: 'eject-pack' }), ...bench()],
    [pokemon('mew', ['protect'])]))
  const waiting = turn(before)
  assert.equal(waiting.awaitingPlayerSwitch, true)
  assert.equal(waiting.pendingPlayerSwitch?.kind, 'item')
  assert.equal(waiting.player.team[0].statStages.defense, -1)
  assert.equal(waiting.player.team[0].statStages.specialDefense, -1)
  assert.equal(waiting.player.team[0].consumedItem, true)
  assert(waiting.opponent.team[0].hp < before.opponent.team[0].hp)
  const after = resume(waiting, 1).state
  assert.equal(after.player.activeIndexes[0], 1)
  assert.equal(after.player.team[0].moves[0].currentPp, before.player.team[0].moves[0].currentPp - 1)
  assert.equal(after.turn, before.turn + 1)
})

check('Emergency Exit pauses for a replacement and cancels the outgoing Pokemon queued attack', () => {
  const before = battle([pokemon('golisopod', ['liquidation']), ...bench()], [pokemon('mew', ['psychic'])])
  before.player.team[0].hp = Math.floor(before.player.team[0].maxHp / 2) + 15
  const waiting = turn(before)
  assert.equal(waiting.awaitingPlayerSwitch, true)
  assert.equal(waiting.pendingPlayerSwitch?.kind, 'ability')
  assert(waiting.player.team[0].hp > 0 && waiting.player.team[0].hp <= waiting.player.team[0].maxHp / 2)
  assert.equal(waiting.player.team[0].moves[0].currentPp, before.player.team[0].moves[0].currentPp)
  const after = resume(waiting, 1).state
  assert.equal(after.player.activeIndexes[0], 1)
  assert.equal(after.player.team[0].moves[0].currentPp, before.player.team[0].moves[0].currentPp)
  assert.equal(after.turn, before.turn + 1)
})

check('An opposing Emergency Exit cancels the U-turn user pivot', () => {
  const before = quiet(battle([pokemon('scizor', ['uturn']), ...bench()],
    [pokemon('golisopod', ['protect']), pokemon('snorlax', ['protect'])]))
  before.opponent.activeIndexes = [0]
  before.opponent.activeIndex = 0
  before.opponent.team[0].hp = Math.floor(before.opponent.team[0].maxHp / 2) + 15
  const after = turn(before)
  assert(after.opponent.team[0].hp > 0 && after.opponent.team[0].hp <= after.opponent.team[0].maxHp / 2)
  assert.equal(after.opponent.activeIndexes[0], 1)
  assert.equal(after.player.activeIndexes[0], 0)
  assert.equal(after.awaitingPlayerSwitch, false)
})

check('A Red Card replaces the attacker forcibly without a second pivot or voluntary prompt', () => {
  const before = quiet(battle([pokemon('raichu', ['voltswitch']), ...bench()],
    [pokemon('snorlax', ['protect'], { heldItemId: 'red-card' })]))
  const after = turn(before)
  assert.equal(after.awaitingPlayerSwitch, false)
  assert.equal(after.opponent.team[0].consumedItem, true)
  assert.notEqual(after.player.activeIndexes[0], 0)
  assert.equal(after.player.team[0].moves[0].currentPp, before.player.team[0].moves[0].currentPp - 1)
  assert.equal(after.log.filter((entry) => /부탁해!/.test(entry.message)).length, 1)
})

check('Contact recoil that faints a U-turn user never opens a living-user pivot request', () => {
  const before = quiet(battle([pokemon('scizor', ['uturn']), ...bench()],
    [pokemon('garchomp', ['protect'], { ability: '까칠한피부', heldItemId: 'rocky-helmet' })]))
  before.player.team[0].hp = 1
  const after = turn(before)
  assert.equal(after.player.team[0].hp, 0)
  assert.equal(after.player.team[0].fainted, true)
  assert.equal(after.awaitingPlayerSwitch, true)
  assert.notEqual(after.pendingPlayerSwitch?.kind, 'pivot')
})

check('A replacement fainting to entry hazards requests another choice before the pending attack', () => {
  const before = battle([pokemon('raichu', ['voltswitch']), pokemon('shedinja', ['protect']), pokemon('mew', ['protect'])])
  before.player.hazards.spikes = 1
  const waiting = turn(before)
  expectPivot(waiting)
  const fallen = resume(waiting, 1).state
  assert.equal(fallen.player.team[1].hp, 0)
  assert.equal(fallen.player.team[1].fainted, true)
  assert.equal(fallen.awaitingPlayerSwitch, true)
  assert.equal(fallen.opponent.team[0].moves[0].currentPp, before.opponent.team[0].moves[0].currentPp)
  assert.equal(fallen.turn, before.turn)
  const after = resume(fallen, 2).state
  assert.equal(after.player.activeIndexes[0], 2)
  assert(after.player.team[2].hp < before.player.team[2].hp)
  assert.equal(after.opponent.team[0].moves[0].currentPp, before.opponent.team[0].moves[0].currentPp - 1)
  assert.equal(after.turn, before.turn + 1)
})

check('Doubles stops requesting impossible faint replacements after hazards consume the last bench', () => {
  const before = battle([
    pokemon('mew', ['confusion']), pokemon('raichu', ['voltswitch']),
    pokemon('mew', ['protect']), pokemon('snorlax', ['protect']),
  ], [pokemon('dragonite', ['extremespeed']), pokemon('arcanine', ['extremespeed'])], { double: true })
  before.player.team[0].hp = 1
  before.player.team[1].hp = 1
  before.player.team[2].hp = 1
  before.player.hazards.spikes = 3
  const waiting = turn(before, [action(0, 0), action(0, 1)],
    [action(0, 0), action(0, 1, { targetSlot: 1 })])
  assert.equal(waiting.player.team[0].fainted, true)
  assert.equal(waiting.player.team[1].fainted, true)
  assert.deepEqual(waiting.awaitingPlayerSwitchSlots, [0, 1])
  const fallen = resume(waiting, 2).state
  assert.equal(fallen.player.team[2].fainted, true)
  assert.equal(fallen.awaitingPlayerSwitch, true)
  assert.equal(fallen.awaitingPlayerSwitchSlots[0], 0, 'The hazard-fainted slot must be filled first')
  const after = resume(fallen, 3).state
  assert(after.player.team[3].hp > 0)
  assert.deepEqual(after.player.activeIndexes, [3, 1])
  assert.equal(after.awaitingPlayerSwitch, false, 'An empty second slot cannot demand a nonexistent bench Pokemon')
  assert.deepEqual(after.awaitingPlayerSwitchSlots, [])
  assert.equal(after.turn, waiting.turn)
  const next = turn(after, [action(0, 0)], [action(0, 0), action(0, 1)])
  assert.equal(next.turn, after.turn + 1, 'The surviving Pokemon must be able to continue playing')
})

check('Revival Blessing waits for the chosen fainted teammate, spends one PP and resumes without switching its user', () => {
  const before = battle([
    pokemon('pawmot', ['revivalblessing']), pokemon('mew', ['protect']),
    pokemon('snorlax', ['protect']), pokemon('ninetales', ['protect']),
  ])
  for (const index of [1, 2]) {
    before.player.team[index].hp = 0
    before.player.team[index].fainted = true
  }
  const waiting = turn(before)
  assert.equal(waiting.awaitingPlayerSwitch, true)
  assert.equal(waiting.pendingPlayerSwitch?.kind, 'revival')
  assert.equal(waiting.player.activeIndexes[0], 0)
  assert.equal(waiting.player.team[0].moves[0].currentPp, 0)
  assert.equal(before.player.team[0].moves[0].currentPp, 1)
  assert.equal(waiting.opponent.team[0].moves[0].currentPp, before.opponent.team[0].moves[0].currentPp)
  for (const index of [0, 3, -1, 99]) assert.deepEqual(resume(waiting, index).state, waiting)
  const result = resume(waiting, 2)
  const after = result.state
  assert.equal(after.player.team[2].fainted, false)
  assert.equal(after.player.team[2].hp, Math.floor(before.player.team[2].maxHp / 2))
  assert.equal(after.player.team[1].fainted, true, 'The unselected fainted teammate remains fainted')
  assert.equal(after.player.team[1].hp, 0)
  assert.equal(after.player.activeIndexes[0], 0, 'Reviving a teammate does not replace the move user')
  assert(after.player.team[0].hp < before.player.team[0].hp, 'The remaining enemy move must hit the original user')
  assert.equal(after.player.team[0].moves[0].currentPp, 0)
  assert.equal(after.opponent.team[0].moves[0].currentPp, before.opponent.team[0].moves[0].currentPp - 1)
  assert.equal(after.awaitingPlayerSwitch, false)
  assert.equal(after.turn, before.turn + 1)
  assert(!result.timeline.some((step) => step.sideId === 'player' && ['switch', 'switch-out'].includes(step.phase)))
})

check('Revival Blessing can revive the only fainted active doubles ally and cancels its old queued action', () => {
  const before = battle([pokemon('pawmot', ['revivalblessing']), pokemon('mew', ['confusion'])],
    [pokemon('dragonite', ['extremespeed']), pokemon('snorlax', ['tackle'])], { double: true })
  before.player.team[1].hp = 1
  before.player.hazards.spikes = 3
  const waiting = turn(before, [action(0, 0), action(0, 1)],
    [action(0, 0, { targetSlot: 1 }), action(0, 1, { targetSlot: 1 })])
  assert.equal(waiting.awaitingPlayerSwitch, true)
  assert.equal(waiting.pendingPlayerSwitch?.kind, 'revival')
  assert.equal(waiting.player.team[1].fainted, true)
  assert.deepEqual(waiting.player.activeIndexes, [0, 1])
  assert.equal(waiting.player.team.length, 2, 'No inactive fainted teammate is available to hide an active-target soft lock')
  assert.deepEqual(resume(waiting, 0).state, waiting, 'The living active user remains an invalid revive target')
  const withoutHazards = structuredClone(waiting)
  withoutHazards.player.hazards.spikes = 0
  const control = resume(withoutHazards, 1).state
  const after = resume(waiting, 1).state
  assert.equal(after.awaitingPlayerSwitch, false)
  assert.deepEqual(after.player.activeIndexes, [0, 1])
  assert.equal(after.player.team[1].fainted, false)
  assert(after.player.team[1].hp > 0)
  assert.equal(control.player.team[1].hp - after.player.team[1].hp, Math.floor(before.player.team[1].maxHp / 4),
    'The revived active ally re-enters and takes entry hazards before the remaining attack')
  assert(control.player.team[1].hp < Math.floor(before.player.team[1].maxHp / 2), 'The pending enemy attack hits the revived ally')
  assert.equal(after.player.team[1].moves[0].currentPp, before.player.team[1].moves[0].currentPp,
    'Reviving an active ally must not resurrect the action it selected before fainting')
  assert.equal(after.opponent.team[0].hp, before.opponent.team[0].hp)
  assert.equal(after.player.team[0].moves[0].currentPp, 0)
  assert.equal(after.turn, before.turn + 1)
})

check('Phazing moves remain forced random replacements rather than voluntary player choices', () => {
  const before = battle([pokemon('snorlax', ['tackle']), ...bench()], [pokemon('skarmory', ['whirlwind'])])
  const after = turn(before)
  assert.equal(after.awaitingPlayerSwitch, false)
  assert.notEqual(after.player.activeIndexes[0], 0)
  assert.equal(after.turn, before.turn + 1)
})

for (const [slug, moveId] of [['dragonite', 'dragontail'], ['poliwrath', 'circlethrow']]) {
  check(`${moveId} damages a Substitute without forcing its owner to switch`, () => {
    const before = quiet(battle([pokemon(slug, [moveId]), ...bench()],
      [pokemon('snorlax', ['protect']), pokemon('mew', ['protect'])]))
    before.opponent.activeIndexes = [0]
    before.opponent.activeIndex = 0
    const target = before.opponent.team[0]
    target.substituteHp = Math.floor(target.maxHp / 4)
    target.hp -= target.substituteHp
    const after = turn(before)
    assert(after.opponent.team[0].substituteHp < target.substituteHp)
    assert.equal(after.opponent.team[0].hp, target.hp)
    assert.equal(after.opponent.activeIndexes[0], 0)
    assert.equal(after.awaitingPlayerSwitch, false)
  })
}

if (failures.length) {
  console.error(failures.join('\n\n'))
  console.error(`Pivot move regression: ${checked - failures.length}/${checked} checks passed.`)
  process.exitCode = 1
} else {
  console.log(`Validated ${checked} pivot move rules, player choices, and mid-turn resumption scenarios.`)
}
