import assert from 'node:assert/strict'
import test from 'node:test'
import { createBattle, playBattleTurnWithActions } from '../src/data/battleEngine.js'
import { SPECIES_PROFILES, getLearnableMoves, getMoveById } from '../src/data/trainingData.js'

// Showdown data/moves.ts and sim/pokemon.ts#getMoveTargets, checked 2026-09-11:
// target "allies" includes every active teammate and the user, unlike
// "allAdjacent". The four current moves are Life Dew, Howl, Jungle Healing,
// and Lunar Blessing. All fixtures validate their real learnsets and abilities.
// https://github.com/smogon/pokemon-showdown/blob/master/data/moves.ts
// https://github.com/smogon/pokemon-showdown/blob/master/sim/pokemon.ts
const profiles = new Map(Object.values(SPECIES_PROFILES).map(p => [p.slug, p]))
let serial = 0
function pokemon(slug, moveIds = ['protect'], options = {}) {
  const profile = profiles.get(slug)
  assert(profile)
  const learnable = new Set(getLearnableMoves(profile.id).map(m => m.id))
  for (const id of moveIds) assert(learnable.has(id), `${slug} cannot learn ${id}`)
  const ability = options.ability ?? profile.abilities[0]
  assert(profile.abilities.includes(ability))
  return { speciesId: profile.id, captureId: `allies-${++serial}`, ability, moveIds,
    moves: moveIds.map(id => getMoveById(id).name), ...options }
}
function battle(players, opponents = [pokemon('snorlax'), pokemon('snorlax')], activeSlots = 2) {
  const state = createBattle({ playerPokemon: players, opponent: { name: 'Allies move audit', tier: 'S' },
    opponentTeam: { pokemon: opponents, battleGimmicks: [] }, rules: {
      weather: { id: 'clear' }, terrain: { id: 'neutral' },
      format: { id: activeSlots === 1 ? 'single' : activeSlots === 2 ? 'double' : 'triple', activeSlots, actionSlots: activeSlots },
      teamRule: { id: 'full', battleSize: 6 }, aiDifficulty: { id: 'normal' },
    } })
  // Fix the legal opening order instead of allowing the AI lead optimizer to
  // move the named opponent away from the slot under test.
  state.opponent.activeIndexes = opponents.slice(0, activeSlots).map((_, index) => index)
  state.opponent.activeIndex = 0
  return state
}
const action = (actorSlot = 0, moveIndex = 0) => ({ type: 'move', actorSlot, moveIndex, targetSlot: 0 })
const turn = (state, actorSlot = 0, moveIndex = 0, opponents = []) => playBattleTurnWithActions(state,
  state.player.activeIndexes.map((_, slot) => action(slot, slot === actorSlot ? moveIndex : 0)), opponents, () => 0.5)
function hurtAll(state, amount = 80) {
  for (const side of ['player', 'opponent']) for (const p of state[side].team) p.hp -= Math.min(amount, p.hp - 1)
}
function assertQuarter(before, after, index) {
  const p = before.player.team[index]
  assert.equal(after.player.team[index].hp, Math.min(p.maxHp, p.hp + Math.floor(p.maxHp / 4)))
}
function assertOneUse(before, after, actorSlot = 0, moveIndex = 0) {
  const source = before.player.team[actorSlot]
  assert.equal(after.player.team[actorSlot].moves[moveIndex].currentPp, source.moves[moveIndex].currentPp - 1)
  assert.equal(after.log.slice(before.log.length).filter(e => e.message === `${source.name}의 ${source.moves[moveIndex].name}!`).length, 1)
}

test('Life Dew heals self and ally once while excluding opponents and the bench', () => {
  const before = battle([pokemon('mew', ['lifedew']), pokemon('wailord', ['splash']), pokemon('snorlax')])
  hurtAll(before)
  const original = structuredClone(before)
  const after = turn(before)
  for (const index of [0, 1]) assertQuarter(before, after, index)
  assert.equal(after.player.team[2].hp, before.player.team[2].hp)
  assert.deepEqual(after.opponent.team.map(p => p.hp), before.opponent.team.map(p => p.hp))
  assertOneUse(before, after)
  assert.deepEqual(before, original)
})

test('Life Dew in triples reaches even the ally at the far end of the field', () => {
  const before = battle([pokemon('mew', ['lifedew']), pokemon('wailord', ['splash']), pokemon('wailord', ['splash'])],
    [pokemon('snorlax'), pokemon('snorlax'), pokemon('snorlax')], 3)
  hurtAll(before)
  const after = turn(before)
  for (const index of [0, 1, 2]) assertQuarter(before, after, index)
  assertOneUse(before, after)
})

test('Howl raises only the user and every active ally by one Attack stage', () => {
  const before = battle([pokemon('arcanine', ['howl'], { ability: '타오르는불꽃' }), pokemon('wailord', ['splash']), pokemon('snorlax')])
  const after = turn(before)
  assert.deepEqual(after.player.team.map(p => p.statStages.attack), [1, 1, 0])
  assert.deepEqual(after.opponent.team.map(p => p.statStages.attack), before.opponent.team.map(p => p.statStages.attack))
  assertOneUse(before, after)
})

test('Howl in triples also reaches the far ally without affecting an opponent', () => {
  const before = battle([pokemon('arcanine', ['howl'], { ability: '타오르는불꽃' }), pokemon('wailord', ['splash']), pokemon('wailord', ['splash'])],
    [pokemon('snorlax'), pokemon('snorlax'), pokemon('snorlax')], 3)
  const after = turn(before)
  assert.deepEqual(after.player.team.map(p => p.statStages.attack), [1, 1, 1])
  assert.deepEqual(after.opponent.team.map(p => p.statStages.attack), before.opponent.team.map(p => p.statStages.attack))
})

for (const [slug, moveId] of [['zarude', 'junglehealing'], ['cresselia', 'lunarblessing']]) {
  test(`${moveId} heals and cures every teammate exactly once, with no duplicate group loop`, () => {
    const before = battle([pokemon(slug, [moveId]), pokemon('wailord', ['splash']), pokemon('snorlax')])
    hurtAll(before)
    for (const p of before.player.team) p.status = { id: 'burn' }
    const after = turn(before)
    for (const index of [0, 1]) {
      assertQuarter(before, after, index)
      assert.equal(after.player.team[index].status, null)
    }
    assert.equal(after.player.team[2].status.id, 'burn')
    assert.equal(after.player.team[2].hp, before.player.team[2].hp)
    assertOneUse(before, after)
  })
}

test('Life Dew bypasses allied Substitute and Protect according to its move flags', () => {
  const initial = battle([pokemon('mew', ['lifedew', 'protect']), pokemon('wailord', ['substitute', 'protect'])])
  const prepared = playBattleTurnWithActions(initial, [action(0, 1), action(1)], [], () => 0.5)
  assert(prepared.player.team[1].substituteHp > 0)
  prepared.player.team[0].hp -= 60
  const after = playBattleTurnWithActions(prepared, [action(0), action(1, 1)], [], () => 0.5)
  for (const index of [0, 1]) assertQuarter(prepared, after, index)
  assert.equal(after.player.team[1].substituteHp, prepared.player.team[1].substituteHp)
})

test('Life Dew applies each target ability: Storm Drain raises ally SpA instead of healing it', () => {
  const before = battle([pokemon('mew', ['lifedew']), pokemon('gastrodon', ['protect'], { ability: '마중물' })])
  hurtAll(before)
  const after = turn(before)
  assertQuarter(before, after, 0)
  assert.equal(after.player.team[1].hp, before.player.team[1].hp)
  assert.equal(after.player.team[1].statStages.specialAttack, 1)
  assert.equal(after.player.team[0].moveFailedThisTurn, false)
})

test('Howl skips a Soundproof ally while still boosting its user', () => {
  const before = battle([pokemon('arcanine', ['howl'], { ability: '타오르는불꽃' }), pokemon('exploud', ['protect'], { ability: '방음' })])
  const after = turn(before)
  assert.equal(after.player.team[0].statStages.attack, 1)
  assert.equal(after.player.team[1].statStages.attack, 0)
  assert.equal(after.player.team[0].moveFailedThisTurn, false)
})

test('A full-health Life Dew user still heals its ally and records overall success', () => {
  const before = battle([pokemon('mew', ['lifedew']), pokemon('wailord', ['splash'])])
  before.player.team[1].hp -= 70
  const after = turn(before)
  assertQuarter(before, after, 1)
  assert.equal(after.player.team[0].moveFailedThisTurn, false)
})

test('Life Dew fails only when no recipient can recover HP', () => {
  const before = battle([pokemon('mew', ['lifedew']), pokemon('wailord', ['splash'])])
  const after = turn(before)
  assert.equal(after.player.team[0].moveFailedThisTurn, true)
  assertOneUse(before, after)
})

test('Single-battle Life Dew and an ordinary self heal retain their own healing amount', () => {
  for (const [slug, moveId, denominator] of [['mew', 'lifedew', 4], ['alakazam', 'recover', 2]]) {
    const before = battle([pokemon(slug, [moveId])], [pokemon('snorlax')], 1)
    before.player.team[0].hp = 1
    const after = turn(before)
    assert.equal(after.player.team[0].hp, 1 + Math.floor(before.player.team[0].maxHp / denominator))
    assertOneUse(before, after)
  }
})

test('Opposing Pressure does not add PP cost to ally-only moves', () => {
  const before = battle([pokemon('mew', ['lifedew']), pokemon('wailord', ['splash'])],
    [pokemon('dusclops', ['protect'], { ability: '프레셔' }), pokemon('dusclops', ['protect'], { ability: '프레셔' })])
  hurtAll(before)
  const after = turn(before)
  assertOneUse(before, after)
})

test('Opposing Soundproof cannot block Heal Bell from curing the user, ally, and bench', () => {
  const before = battle([pokemon('blissey', ['healbell']), pokemon('wailord', ['splash']), pokemon('snorlax')],
    [pokemon('exploud', ['protect'], { ability: '방음' }), pokemon('wailord', ['splash'])])
  for (const p of before.player.team) p.status = { id: 'burn' }
  const after = turn(before)
  assert(after.player.team.every(p => p.status === null))
  assertOneUse(before, after)
})

test('Heal Bell individually skips allied Soundproof and Good as Gold without blocking others', () => {
  const before = battle([pokemon('blissey', ['healbell']), pokemon('exploud', ['protect'], { ability: '방음' }),
    pokemon('gholdengo', ['protect']), pokemon('snorlax')])
  for (const p of before.player.team) p.status = { id: 'burn' }
  const after = turn(before)
  assert.equal(after.player.team[0].status, null)
  assert.equal(after.player.team[1].status.id, 'burn')
  assert.equal(after.player.team[2].status.id, 'burn')
  assert.equal(after.player.team[3].status, null)
})

test('A Heal Bell user that copied Soundproof can cure itself and the rest of its team', () => {
  const initial = battle([pokemon('smeargle', ['roleplay', 'healbell']), pokemon('wailord', ['splash'])],
    [pokemon('exploud', ['protect'], { ability: '방음' }), pokemon('snorlax')])
  const before = turn(initial)
  assert.equal(before.player.team[0].ability, '방음')
  for (const p of before.player.team) p.status = { id: 'burn' }
  const after = turn(before, 0, 1)
  assert(after.player.team.every(p => p.status === null))
})

for (const [slug, moveId] of [['mew', 'lifedew'], ['cresselia', 'lunarblessing'], ['arcanine', 'howl']]) {
  test(`Snatch takes ${moveId} for the whole snatcher team without duplicate effects or PP`, () => {
    const before = battle([pokemon(slug, [moveId]), pokemon('wailord', ['splash'])],
      [pokemon('sableye', ['snatch'], { ability: '짓궂은마음' }), pokemon('wailord', ['splash'])])
    hurtAll(before)
    const after = turn(before, 0, 0, [action(0), action(1)])
    if (moveId === 'howl') {
      assert.deepEqual(after.player.team.map(p => p.statStages.attack), before.player.team.map(p => p.statStages.attack))
      assert.deepEqual(after.opponent.team.map(p => p.statStages.attack), before.opponent.team.map(p => p.statStages.attack + 1))
    } else {
      assert.deepEqual(after.player.team.map(p => p.hp), before.player.team.map(p => p.hp))
      for (const [index, p] of before.opponent.team.entries()) {
        assert.equal(after.opponent.team[index].hp, Math.min(p.maxHp, p.hp + Math.floor(p.maxHp / 4)))
      }
    }
    assertOneUse(before, after)
    assert.equal(after.opponent.team[0].moves[0].currentPp, before.opponent.team[0].moves[0].currentPp - 1)
    assert.equal(after.log.slice(before.log.length).filter(e => e.message.includes('가로챘다')).length, 1)
  })
}
