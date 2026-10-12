import assert from 'node:assert/strict'
import {
  getDefaultMoves, getLearnableMoves, getMove, getMoveById,
  getMovePpTrainingCount, getMovePpTrainingLimit, normalizePokemon,
  resolveMoveForPokemon, SPECIES_PROFILES,
} from '../src/data/trainingData.js'
import { TRAINING_COSTS, getTrainingCostBreakdown } from '../src/data/trainingCosts.js'
import { migratePokemonCollection } from '../src/data/pokemonPool.js'
import {
  createBattle, createBattlePreviewPokemon, getBattleMoveSelectionState,
  getBattleStruggleAction, playBattleTurnWithActions,
} from '../src/data/battleEngine.js'
import { canonicalizeRankedTeam, createRankedBattle } from '../server/rankedBattle.js'

const tests = []
const test = (name, run) => tests.push({ name, run })
const profiles = new Map(Object.values(SPECIES_PROFILES).map(profile => [profile.slug, profile]))
let fixtureId = 0
function pokemon(slug, ids = ['protect'], extra = {}) {
  const profile = profiles.get(slug)
  assert(profile, 'Missing fixture species: ' + slug)
  const legal = new Set(getLearnableMoves(profile.id).map(move => move.id))
  assert(ids.every(id => legal.has(id)), 'Illegal fixture move for ' + slug + ': ' + ids)
  return normalizePokemon({
    speciesId: profile.id, captureId: 'pp-training-' + (++fixtureId),
    moves: ids.map(id => getMoveById(id).name), ...extra,
  })
}
function battle(player, opponent = pokemon('snorlax')) {
  return createBattle({
    playerPokemon: [player], opponent: { name: 'PP TRAINING VALIDATION' },
    opponentTeam: { pokemon: [opponent], battleGimmicks: [], strategy: {} },
    rules: {
      weather: { id: 'clear', label: '맑음' },
      terrain: { id: 'neutral', label: '일반 필드' },
      format: { id: 'single', label: '싱글배틀', activeSlots: 1, actionSlots: 1 },
      teamRule: { battleSize: 1 }, pvp: true,
    }, random: () => 0.5,
  })
}
const action = { type: 'move', actorSlot: 0, targetSlot: 0, moveIndex: 0 }
const turn = state => playBattleTurnWithActions(state, [action], [action], () => 0.5)
const moves = ['hyperbeam', 'flamethrower', 'tackle', 'protect']
const trained = (ups = { hyperbeam: 3, flamethrower: 4, tackle: 5, protect: 3 }) => (
  pokemon('snorlax', moves, { movePpUps: ups })
)

test('power and original PP classify strong, ordinary and weak moves with limits 3/4/5', () => {
  for (const [id, expected] of [
    ['hyperbeam', 3], ['closecombat', 3], ['protect', 3],
    ['flamethrower', 4], ['tackle', 5], ['swordsdance', 5],
  ]) assert.equal(getMovePpTrainingLimit(getMoveById(id)), expected, id)
  assert.equal(getMovePpTrainingLimit({ pp: 30, power: 100 }), 3, 'Power 100 overrides plentiful PP')
  assert.equal(getMovePpTrainingLimit({ pp: 10, power: 40 }), 3, 'Low original PP overrides weak power')
  assert.equal(getMovePpTrainingLimit({ pp: 20, power: 60 }), 5, 'Weak-move thresholds are inclusive')
  assert.equal(getMovePpTrainingLimit({ pp: 20, power: 61 }), 4)
  assert.equal(getMovePpTrainingLimit({ pp: 15, power: 60 }), 4)
})

test('legacy Pokemon keep original PP and gain no implicit training', () => {
  const saved = pokemon('snorlax', moves)
  assert.deepEqual(saved.movePpUps, {})
  const preview = createBattlePreviewPokemon(saved)
  preview.moves.forEach(move => {
    assert.equal(move.maxPp, getMoveById(move.id).pp)
    assert.equal(move.currentPp, move.maxPp)
    assert.equal(getMovePpTrainingCount(getMoveById(move.id), saved), 0)
  })
})

test('normalization clamps valid counts, rejects damaged values and removes unrelated keys', () => {
  assert.deepEqual(trained({ hyperbeam: 100, flamethrower: 100, tackle: 100, protect: 0 }).movePpUps, {
    hyperbeam: 3, flamethrower: 4, tackle: 5,
  })
  const saved = trained({ hyperbeam: 2, flamethrower: 1, tackle: 5, protect: 3, thunderbolt: 4, unknown: 9 })
  assert.deepEqual(saved.movePpUps, { hyperbeam: 2, flamethrower: 1, tackle: 5, protect: 3 })
  for (const invalid of [null, [], 'damaged-map']) assert.deepEqual(trained(invalid).movePpUps, {})
  for (const invalid of [-1, 1.5, NaN, Infinity, -Infinity, null, {}, []]) {
    assert.equal(getMovePpTrainingCount(getMoveById('hyperbeam'), trained({ hyperbeam: invalid })), 0, String(invalid))
  }
  assert.deepEqual(normalizePokemon(JSON.parse(JSON.stringify(saved))).movePpUps, saved.movePpUps)
})

test('move resolution adds exactly one PP per training and never accumulates on repeated resolution', () => {
  const saved = trained()
  for (const id of moves) {
    const catalogMove = getMoveById(id)
    const original = structuredClone(catalogMove)
    const count = saved.movePpUps[id]
    const resolved = resolveMoveForPokemon(catalogMove, saved)
    assert.equal(resolved.basePp, catalogMove.pp, id)
    assert.equal(resolved.ppTrainingCount, count, id)
    assert.equal(resolved.ppTrainingLimit, getMovePpTrainingLimit(catalogMove), id)
    assert.equal(resolved.pp, catalogMove.pp + count, id)
    const again = resolveMoveForPokemon(resolved, saved)
    assert.equal(again.pp, resolved.pp, id + ' must not add PP twice')
    assert.equal(getMovePpTrainingLimit(resolved), getMovePpTrainingLimit(catalogMove), id)
    assert.deepEqual(catalogMove, original, id + ' catalog definition must stay immutable')
  }
})

test('reordering keeps move-specific training and replacing or clearing a move removes its training', () => {
  const saved = trained()
  const reordered = normalizePokemon({ ...saved, moves: [...saved.moves].reverse() })
  assert.deepEqual(reordered.movePpUps, saved.movePpUps)
  const replacement = getLearnableMoves(saved.speciesId).find(move => !saved.moves.includes(move.name))
  assert(replacement)
  const changed = normalizePokemon({ ...saved, moves: [replacement.name, ...saved.moves.slice(1)] })
  assert.equal(changed.movePpUps.hyperbeam, undefined)
  assert.equal(getMovePpTrainingCount(replacement, changed), 0)
  const removed = normalizePokemon({ ...saved, moves: saved.moves.slice(1) })
  assert.equal(removed.movePpUps.hyperbeam, undefined)
  const relearned = normalizePokemon({ ...removed, moves: saved.moves })
  assert.equal(getMovePpTrainingCount(getMoveById('hyperbeam'), relearned), 0)
})

test('training charges only positive PP increases at 100 VP each and never charges reordering', () => {
  assert.equal(TRAINING_COSTS.movePp, 100)
  const saved = trained({ hyperbeam: 1, flamethrower: 2, tackle: 3 })
  const raised = normalizePokemon({ ...saved, movePpUps: { hyperbeam: 3, flamethrower: 3, tackle: 3 } })
  const breakdown = getTrainingCostBreakdown(saved, raised)
  assert.equal(breakdown.total, 3 * TRAINING_COSTS.movePp)
  const ppItem = breakdown.items.find(item => item.units === 3 && item.unitCost === TRAINING_COSTS.movePp)
  assert(ppItem, 'PP training needs an explicit three-unit cost item')
  assert.equal(getTrainingCostBreakdown(saved, { ...saved, moves: [...saved.moves].reverse() }).total, 0)
  assert.equal(getTrainingCostBreakdown(saved, { ...saved, movePpUps: {} }).total, 0)
  const changed = normalizePokemon({ ...saved, moves: saved.moves.slice(1) })
  assert.equal(getTrainingCostBreakdown(saved, changed).total, TRAINING_COSTS.move)
  const mixed = normalizePokemon({ ...raised, movePpUps: { hyperbeam: 0, flamethrower: 4, tackle: 3 } })
  assert.equal(getTrainingCostBreakdown(raised, mixed).total, TRAINING_COSTS.movePp, 'Decreases cannot offset another move increase')
})

test('battle starts with trained maximum PP and spends one PP on an ordinary attack', () => {
  const saved = pokemon('snorlax', ['tackle'], { movePpUps: { tackle: 5 } })
  const state = battle(saved)
  assert.equal(state.player.team[0].moves[0].maxPp, getMoveById('tackle').pp + 5)
  assert.equal(state.player.team[0].moves[0].currentPp, state.player.team[0].moves[0].maxPp)
  const after = turn(state)
  assert.equal(after.player.team[0].moves[0].currentPp, state.player.team[0].moves[0].maxPp - 1)
  assert.equal(after.player.team[0].moves[0].maxPp, state.player.team[0].moves[0].maxPp)
})

test('Pressure spends two PP from the increased pool without changing its maximum', () => {
  const state = battle(
    pokemon('snorlax', ['tackle'], { movePpUps: { tackle: 5 } }),
    pokemon('dusclops', ['protect'], { ability: '프레셔' }),
  )
  const maximum = state.player.team[0].moves[0].maxPp
  const after = turn(state)
  assert.equal(after.player.team[0].moves[0].currentPp, maximum - 2)
  assert.equal(after.player.team[0].moves[0].maxPp, maximum)
})

test('Leppa Berry restores PP up to the trained maximum instead of the catalog maximum', () => {
  const state = battle(pokemon('lucario', ['closecombat'], {
    movePpUps: { closecombat: 3 }, heldItemId: 'leppa-berry',
  }))
  const maximum = getMoveById('closecombat').pp + 3
  assert.equal(state.player.team[0].moves[0].maxPp, maximum)
  assert(maximum < 10, 'This fixture must exercise the recovery ceiling')
  state.player.team[0].moves[0].currentPp = 1
  const after = turn(state)
  assert.equal(after.player.team[0].moves[0].currentPp, maximum)
  assert.equal(after.player.team[0].moves[0].maxPp, maximum)
  assert.equal(after.player.team[0].consumedItem, true)
})

test('zero trained PP disables the move and permits Struggle', () => {
  const state = battle(pokemon('snorlax', ['tackle'], { movePpUps: { tackle: 5 } }))
  state.player.team[0].moves[0].currentPp = 0
  assert.equal(getBattleMoveSelectionState(state, 'player', 0, 0).disabled, true)
  assert.equal(getBattleStruggleAction(state, 'player', 0)?.moveIndex, -1)
})

test('Crowned signature replacement carries training within the stronger move limit', () => {
  for (const [slug, heldItemId, signatureId] of [
    ['zacian', 'rusted-sword', 'behemothblade'],
    ['zamazenta', 'rusted-shield', 'behemothbash'],
  ]) {
    const saved = pokemon(slug, ['ironhead'], { heldItemId, movePpUps: { ironhead: 4 } })
    const state = battle(saved)
    const slot = state.player.team[0].moves[0]
    assert.equal(slot.id, signatureId)
    assert.equal(slot.maxPp, getMoveById(signatureId).pp + 3)
    assert.equal(slot.currentPp, slot.maxPp)
    assert.equal(saved.movePpUps.ironhead, 4, 'Battle form conversion must not alter the saved loadout')
  }
})

test('collection JSON save/load and migration preserve trained PP', () => {
  const saved = trained()
  const restored = migratePokemonCollection(JSON.parse(JSON.stringify([saved])))
    .find(entry => entry.dexSpeciesId === saved.dexSpeciesId)
  assert(restored)
  assert.deepEqual(restored.movePpUps, saved.movePpUps)
  assert.deepEqual(createBattlePreviewPokemon(restored).moves.map(move => move.maxPp),
    saved.moves.map(name => getMove(name).pp + saved.movePpUps[getMove(name).id]))
})

test('online canonicalization and ranked singles/doubles preserve training on both sides', () => {
  const team = [3, 6, 9, 25, 94, 149].map((speciesId, index) => {
    const move = getMove(getDefaultMoves(speciesId)[0])
    return normalizePokemon({
      speciesId, captureId: 'pp-ranked-' + index, moves: [move.name],
      movePpUps: { [move.id]: getMovePpTrainingLimit(move) },
    })
  })
  const canonical = canonicalizeRankedTeam(team)
  assert.deepEqual(canonical.map(entry => entry.movePpUps), team.map(entry => entry.movePpUps))
  for (const format of ['single', 'double']) {
    const size = format === 'single' ? 3 : 4
    const state = createRankedBattle({
      playerTeam: canonical.slice(0, size), opponentTeam: canonical.slice(0, size),
      format, random: () => 0.5,
    })
    for (const side of [state.player, state.opponent]) side.team.forEach(entry => {
      const slot = entry.moves[0]
      assert.equal(slot.maxPp, getMoveById(slot.id).pp + getMovePpTrainingLimit(getMoveById(slot.id)))
      assert.equal(slot.currentPp, slot.maxPp)
    })
  }
})

for (const { name, run } of tests) {
  await run()
  console.log('PASS ' + name)
}
console.log('Move PP training validation passed: ' + tests.length + '/' + tests.length)
