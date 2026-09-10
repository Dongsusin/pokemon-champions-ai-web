import assert from 'node:assert/strict'
import pokemonData from '../src/data/generatedPokemonData.json' with { type: 'json' }
import { createBattle, getBattleMoveTargets, getBattleMovePreview, getForcedBattleAction, playBattleTurnWithActions, chooseAiActionsForSide } from '../src/data/battleEngine.js'
import { getLearnableMoves, getMoveById } from '../src/data/trainingData.js'

// Legal moves in deterministic, reachable doubles positions. Target rules and
// ally Pollen Puff behavior follow Pokemon Showdown data/moves.ts.
const profiles = new Map([...pokemonData.species, ...pokemonData.forms].map((profile) => [profile.slug, profile]))
const random = () => 0.5
const action = { type: 'move', actorSlot: 0, targetSlot: 0, moveIndex: 0, gimmick: null }
let checked = 0
const failures = []

function pokemon(slug, moveIds, overrides = {}) {
  const profile = profiles.get(slug)
  assert(profile, `Missing fixture ${slug}`)
  const legal = new Set(getLearnableMoves(profile.id).map((move) => move.id))
  moveIds.forEach((id) => assert(legal.has(id), `${slug} cannot learn ${id}`))
  return { captureId: `target-audit-${slug}`, speciesId: profile.id, slug, ability: profile.abilities[0],
    moveIds, moves: moveIds.map((id) => getMoveById(id).name), ...overrides }
}

function position(slug, moveIds, ally = pokemon('snorlax', ['tackle', 'protect'])) {
  const state = createBattle({
    playerPokemon: [pokemon(slug, moveIds), ally],
    opponent: { name: 'TARGETING AUDIT' },
    opponentTeam: { pokemon: [pokemon('blissey', ['substitute']), pokemon('chansey', ['substitute'])], battleGimmicks: [], strategy: {} },
    rules: {
      weather: { id: 'clear', label: '맑음' }, terrain: { id: 'neutral', label: '일반 필드' },
      format: { id: 'double', label: '더블배틀', activeSlots: 2, actionSlots: 2 },
      teamRule: { id: 'full', label: '전체', battleSize: 2 },
    },
  })
  state.opponent.activeIndexes = [0, 1]
  state.opponent.activeIndex = 0
  for (const entry of [...state.opponent.team, state.player.team[1]]) {
    entry.status = { id: 'sleep', label: '잠듦', counter: 5, toxicCounter: 0 }
  }
  return state
}

function turn(state, selected = { targetSideId: 'player', targetSlot: 1 }, allyAction = {}) {
  return playBattleTurnWithActions(state,
    [{ ...action, ...selected }, { ...action, actorSlot: 1, ...allyAction }],
    [action, { ...action, actorSlot: 1 }], random)
}

function check(name, fn) {
  checked += 1
  try { fn() } catch (error) { failures.push(`${name}: ${error.message}`) }
}

check('Heal Pulse offers both foes and the ally, excluding the user', () => {
  const state = position('slowbro', ['healpulse'])
  assert.deepEqual(getBattleMoveTargets(state).map(({ sideId, slot }) => `${sideId}:${slot}`),
    ['opponent:0', 'opponent:1', 'player:1'])
})

check('Helping Hand offers only the ally; Acupressure offers self and ally', () => {
  assert.deepEqual(getBattleMoveTargets(position('clefairy', ['helpinghand'])).map(({ sideId, slot }) => `${sideId}:${slot}`), ['player:1'])
  assert.deepEqual(getBattleMoveTargets(position('shuckle', ['acupressure'])).map(({ sideId, slot }) => `${sideId}:${slot}`), ['player:0', 'player:1'])
})

for (const [slug, moveId] of [['slowbro', 'healpulse'], ['comfey', 'floralhealing'], ['ribombee', 'pollenpuff']]) {
  check(`${moveId} heals the selected ally`, () => {
    const state = position(slug, [moveId])
    state.player.team[1].hp = 1
    const after = turn(state)
    const expected = moveId === 'pollenpuff' ? Math.floor(state.player.team[1].maxHp / 2) : Math.ceil(state.player.team[1].maxHp / 2)
    assert.equal(after.player.team[1].hp, 1 + expected)
    assert.equal(after.player.team[0].hp, state.player.team[0].hp)
    assert.deepEqual(after.opponent.team.map((entry) => entry.hp), state.opponent.team.map((entry) => entry.hp))
  })
}

check('Pollen Puff preview distinguishes ally recovery from opponent damage', () => {
  const state = position('ribombee', ['pollenpuff'])
  const ally = getBattleMovePreview(state, 'player', 0, 0, 1, null, 'player')
  const foe = getBattleMovePreview(state, 'player', 0, 0, 0)
  assert.equal(ally.healsTarget, true)
  assert.equal(ally.power, 0)
  assert.equal(foe.power, 90)
})

check('Ally Pollen Puff passes Substitute, but Heal Pulse does not', () => {
  for (const [slug, moveId, shouldHeal] of [['ribombee', 'pollenpuff', true], ['slowbro', 'healpulse', false]]) {
    const state = position(slug, [moveId])
    state.player.team[1].hp = 1
    state.player.team[1].substituteHp = Math.floor(state.player.team[1].maxHp / 4)
    const after = turn(state)
    assert.equal(after.player.team[1].hp > 1, shouldHeal)
    assert.equal(after.player.team[1].substituteHp, state.player.team[1].substituteHp)
  }
})

check('Ally Pollen Puff respects Protect', () => {
  const state = position('ribombee', ['pollenpuff'])
  state.player.team[1].hp = 1
  state.player.team[1].status = null
  const after = turn(state, undefined, { moveIndex: 1 })
  assert.equal(after.player.team[1].hp, 1)
})

check('Ally Pollen Puff respects Bulletproof and user Heal Block', () => {
  const shielded = position('ribombee', ['pollenpuff'], pokemon('chesnaught', ['protect'], { ability: '방탄' }))
  shielded.player.team[1].hp = 1
  assert.equal(turn(shielded).player.team[1].hp, 1)
  const sealed = position('ribombee', ['pollenpuff'])
  sealed.player.team[1].hp = 1
  sealed.player.team[0].healBlockTurns = 2
  assert.equal(turn(sealed).player.team[1].hp, 1)
})

check('Acupressure boosts the selected ally and can target its user behind Substitute', () => {
  const allyState = position('shuckle', ['acupressure'])
  const allyAfter = turn(allyState)
  assert.equal(Object.values(allyAfter.player.team[1].statStages).reduce((a, b) => a + b, 0), 2)
  assert.equal(Object.values(allyAfter.player.team[0].statStages).reduce((a, b) => a + b, 0), 0)
  const selfState = position('shuckle', ['acupressure'])
  selfState.player.team[0].substituteHp = Math.floor(selfState.player.team[0].maxHp / 4)
  selfState.player.team[0].hp -= selfState.player.team[0].substituteHp
  const selfAfter = turn(selfState, { targetSideId: 'player', targetSlot: 0 })
  assert.equal(Object.values(selfAfter.player.team[0].statStages).reduce((a, b) => a + b, 0), 2)
})

check('Helping Hand boosts the chosen ally attack', () => {
  const state = position('clefairy', ['helpinghand', 'protect'])
  state.player.team[1].status = null
  const after = turn(state)
  const control = turn(state, { moveIndex: 1, targetSideId: 'player', targetSlot: 0 })
  const dealt = state.opponent.team[0].hp - after.opponent.team[0].hp
  const controlDamage = state.opponent.team[0].hp - control.opponent.team[0].hp
  assert(dealt > controlDamage * 1.4, `helped ${dealt}, control ${controlDamage}`)
})

check('Normal attacks can target an ally but cannot target their user', () => {
  const state = position('pikachu', ['thunderbolt'])
  const after = turn(state)
  assert(after.player.team[1].hp < state.player.team[1].hp)
  assert.equal(after.opponent.team[0].hp, state.opponent.team[0].hp)
  const invalid = turn(state, { targetSideId: 'player', targetSlot: 0 })
  assert.equal(invalid.player.team[0].hp, state.player.team[0].hp)
  assert.equal(invalid.opponent.team[0].hp, state.opponent.team[0].hp)
  assert.equal(invalid.player.team[0].moveFailedThisTurn, true)
})

check('Priority support reaches an ally on Psychic Terrain with Armor Tail', () => {
  const state = position('clefairy', ['helpinghand'], pokemon('farigiraf', ['tackle'], { ability: '테일아머' }))
  state.rules.terrain = { id: 'psychic', label: '사이코필드', turns: 5 }
  state.player.team[1].status = null
  const after = turn(state)
  assert(after.log.some((entry) => entry.message.includes('도움을 받아')))
})

check('AI selects its injured ally for Heal Pulse', () => {
  const state = position('slowbro', ['healpulse'])
  state.player.team[1].hp = 1
  state.player.team[0].moves.slice(1).forEach((move) => { move.currentPp = 0 })
  const selected = chooseAiActionsForSide(state, 'player', random).find((entry) => entry.actorSlot === 0)
  assert.equal(selected.targetSideId, 'player')
  assert.equal(selected.targetSlot, 1)
})

check('A charged attack preserves its ally side and slot during AI continuation', () => {
  const state = position('charizard', ['fly'])
  const charged = turn(state)
  const forced = getForcedBattleAction(charged, 'player', 0)
  assert.equal(forced.targetSideId, 'player')
  assert.equal(forced.targetSlot, 1)
  const selected = chooseAiActionsForSide(charged, 'player', random).find((entry) => entry.actorSlot === 0)
  assert.equal(selected.targetSideId, 'player')
  assert.equal(selected.targetSlot, 1)
  const after = turn(charged, selected)
  assert(after.player.team[1].hp < charged.player.team[1].hp)
  assert.equal(after.opponent.team[1].hp, charged.opponent.team[1].hp)
})

if (failures.length) {
  console.error(failures.join('\n'))
  assert.fail(`${failures.length}/${checked} targeting audit scenarios failed`)
}
console.log(`Validated ${checked} legal targeting audit scenarios.`)
