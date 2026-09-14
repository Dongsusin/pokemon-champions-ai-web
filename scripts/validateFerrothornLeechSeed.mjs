import assert from 'node:assert/strict'
import test from 'node:test'
import { createBattle, playBattleTurnWithActions } from '../src/data/battleEngine.js'
import { canPokemonLearnMove, getMoveById, normalizePokemon } from '../src/data/trainingData.js'
import { canonicalizeRankedTeam, createRankedBattle } from '../server/rankedBattle.js'

// Ferroseed's inherited egg move: pokemon-showdown/data/learnsets.ts (5E–8E).
// Leech Seed rules: pokemon-showdown/data/moves.ts, leechseed.condition.
const pokemon = (speciesId, ids) => {
  const moves = ids.map(id => getMoveById(id).name)
  for (const move of moves) assert(canPokemonLearnMove(speciesId, move), `${speciesId}: illegal ${move}`)
  return normalizePokemon({ speciesId, captureId: `leech-seed-${speciesId}`, moves })
}
function battle({ double = false, targetId = 143, targetMove = 'defensecurl' } = {}) {
  const opponents = [pokemon(targetId, [targetMove])]
  if (double) opponents.unshift(pokemon(129, ['splash']))
  return createBattle({
    playerPokemon: [pokemon(598, ['leechseed', 'protect']), pokemon(129, ['splash'])],
    opponent: { name: '씨뿌리기 검증' },
    opponentTeam: { pokemon: opponents, battleGimmicks: [] },
    rules: { weather: { id: 'clear' }, terrain: { id: 'neutral' },
      format: { id: double ? 'double' : 'single', activeSlots: double ? 2 : 1, actionSlots: double ? 2 : 1 },
      teamRule: { id: 'full', battleSize: 2 } },
  })
}
function turn(state, { moveIndex = 0, switchUser = false } = {}) {
  const double = state.rules.format.id === 'double'
  const player = [switchUser ? { type: 'switch', actorSlot: 0, targetIndex: 1 }
    : { type: 'move', actorSlot: 0, moveIndex, targetSlot: double ? 1 : 0, targetSideId: 'opponent' }]
  const opponent = [{ type: 'move', actorSlot: 0, moveIndex: 0, targetSlot: 0 }]
  if (double) {
    player.push({ type: 'move', actorSlot: 1, moveIndex: 0, targetSlot: 0 })
    opponent.push({ type: 'move', actorSlot: 1, moveIndex: 0, targetSlot: 0 })
  }
  return playBattleTurnWithActions(state, player, opponent, () => 0.5)
}

for (const double of [false, true]) {
  test(`${double ? 'double selected target' : 'single'}: Ferrothorn consumes PP and drains 1/8 HP at successive turn ends`, () => {
    const before = battle({ double })
    before.player.team[0].hp = 1
    const targetIndex = double ? 1 : 0
    const target = before.opponent.team[targetIndex]
    const damage = Math.floor(target.maxHp / 8)
    const original = JSON.stringify(before)
    const after = turn(before)
    assert.equal(JSON.stringify(before), original)
    assert.equal(after.player.team[0].moves[0].id, 'leechseed')
    assert.equal(after.player.team[0].moves[0].currentPp, before.player.team[0].moves[0].currentPp - 1)
    assert.equal(after.opponent.team[targetIndex].hp, target.hp - damage)
    assert.equal(after.player.team[0].hp, 1 + damage)
    assert.equal(after.opponent.team[targetIndex].leechSeedSourceSlot, 0)
    if (double) assert.equal(after.opponent.team[0].hp, before.opponent.team[0].hp)
    const second = turn(after, { moveIndex: 1 })
    assert.equal(second.opponent.team[targetIndex].hp, target.hp - 2 * damage)
    assert.equal(second.player.team[0].hp, 1 + 2 * damage)
  })
}

test('a teammate replacing Ferrothorn receives the existing seed recovery', () => {
  const before = battle()
  before.player.team[1].hp = 1
  const seeded = turn(before)
  const after = turn(seeded, { switchUser: true })
  const damage = Math.floor(before.opponent.team[0].maxHp / 8)
  assert.equal(after.player.activeIndex, 1)
  assert.equal(after.player.team[1].hp, 1 + damage)
  assert.equal(after.opponent.team[0].hp, before.opponent.team[0].hp - 2 * damage)
})

for (const options of [{ targetId: 1, targetMove: 'growth' }, { targetMove: 'protect' }]) {
  test(`${options.targetId === 1 ? 'Grass typing' : 'Protect'} still blocks Ferrothorn Leech Seed`, () => {
    const before = battle(options)
    before.player.team[0].hp = 1
    const after = turn(before)
    assert.equal(after.player.team[0].hp, 1)
    assert.equal(after.opponent.team[0].hp, before.opponent.team[0].hp)
    assert(!after.opponent.team[0].leechSeedSourceSideId)
  })
}

test('ranked registration and battle creation preserve the move while rejecting it on unrelated species', () => {
  const registered = [598, 25, 6, 9, 143, 130].map(id => pokemon(id, id === 598 ? ['leechseed', 'protect'] : ['protect']))
  const team = canonicalizeRankedTeam(JSON.parse(JSON.stringify(registered)))
  assert.deepEqual(team[0].moveIds, ['leechseed', 'protect'])
  for (const format of ['single', 'double']) {
    const size = format === 'single' ? 3 : 4
    const state = createRankedBattle({ playerTeam: team.slice(0, size), opponentTeam: team.slice(0, size), format, random: () => 0.5 })
    assert.equal(state.player.team[0].moves[0].id, 'leechseed')
    assert.equal(state.opponent.team[0].moves[0].id, 'leechseed')
  }
  const injected = structuredClone(registered)
  injected[1].moves = ['씨뿌리기']
  assert.throws(() => canonicalizeRankedTeam(injected), /배울 수 없거나/)
})
