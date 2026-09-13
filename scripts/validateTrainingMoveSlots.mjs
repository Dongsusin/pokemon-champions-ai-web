import assert from 'node:assert/strict'
import {
  getDefaultMoves, getFormMetadata, getLearnableMoves, getMove, normalizePokemon,
  resolveMoveTriggeredFormSpeciesId, SPECIES_PROFILES,
} from '../src/data/trainingData.js'
import { migratePokemonCollection } from '../src/data/pokemonPool.js'
import { getTrainingCostBreakdown } from '../src/data/trainingCosts.js'
import { createBattlePreviewPokemon, getBattleMoveSelectionState, getBattleStruggleAction } from '../src/data/battleEngine.js'
import { canonicalizeRankedTeam, createRankedBattle, validateRankedAction, resolveRankedTurn } from '../server/rankedBattle.js'
import { createAccountService, createAccountRankedTeamResolver } from '../server/accountService.js'
import { createMemoryRankedStore } from '../server/rankedStore.js'

const tests = []
const test = (name, run) => tests.push({ name, run })
const defaults = getDefaultMoves(25)
const counts = [1, 2, 3, 1, 2, 3]
const team = () => [3, 6, 9, 25, 94, 149].map((speciesId, index) => normalizePokemon({
  speciesId, captureId: `dex-${speciesId}`, dexSpeciesId: speciesId,
  directDrawCount: 1, moves: getDefaultMoves(speciesId).slice(0, counts[index]),
}))

test('intentional one-to-four move arrays preserve their order and length through repeated normalization', () => {
  assert.equal(defaults.length, 4)
  for (const count of [1, 2, 3, 4]) {
    const configured = defaults.slice(0, count)
    const first = normalizePokemon({ speciesId: 25, moves: configured })
    assert.deepEqual(first.moves, configured)
    assert.deepEqual(normalizePokemon(JSON.parse(JSON.stringify(first))).moves, configured)
    const preview = createBattlePreviewPokemon(first)
    assert.deepEqual(preview.moves.map(move => move.name), configured)
    assert(preview.moves.every(move => move.currentPp > 0 && move.maxPp === move.currentPp))
  }
})

test('unspecified legacy loadouts keep their defaults while damaged arrays recover one legal move', () => {
  for (const value of [undefined, null, 'not-an-array']) {
    assert.deepEqual(normalizePokemon({ speciesId: 25, moves: value }).moves, defaults)
    assert.deepEqual(createBattlePreviewPokemon({ speciesId: 25, moves: value }).moves.map(move => move.name), defaults)
  }
  for (const moves of [[], [null, '', undefined], ['missing-move'], ['화염방사'], new Array(4)]) {
    const normalized = normalizePokemon({ speciesId: 25, moves })
    assert.deepEqual(normalized.moves, defaults.slice(0, 1))
  }
  assert.deepEqual(normalizePokemon({ speciesId: 25, moves: ['', defaults[2], null, defaults[2], defaults[0], 'missing'] }).moves, [defaults[2], defaults[0]])
  assert.equal(normalizePokemon({ speciesId: 25, moves: getLearnableMoves(25).slice(0, 8).map(move => move.name) }).moves.length, 4)
  for (const profile of Object.values(SPECIES_PROFILES)) {
    const normalized = normalizePokemon({ speciesId: profile.id, moves: [] })
    assert(normalized.moves.length >= 1 && normalized.moves.length <= 4, `${profile.name} must retain a usable move`)
    const legal = new Set(getLearnableMoves(normalized.speciesId).map(move => move.name))
    assert(normalized.moves.every(name => legal.has(name)), `${profile.name} fallback must be learnable`)
  }
})

test('cleared or invalid battle slots never become an implicit catalog fallback attack', () => {
  const preview = createBattlePreviewPokemon({ speciesId: 151, moves: ['방어', null, '', '10만볼트'] })
  assert.deepEqual(preview.moves.map(move => move.name), ['방어', '10만볼트'])
  const byId = createBattlePreviewPokemon({ speciesId: 151, moveIds: ['protect', null, 'missing-id', 'thunderbolt'] })
  assert.deepEqual(byId.moves.map(move => move.id), ['protect', 'thunderbolt'])
  assert(!preview.moves.some(move => move.id === 'pound'))
  const recovered = createBattlePreviewPokemon({ speciesId: 151, moves: [null, '', 'missing-move'] })
  assert.deepEqual(recovered.moves.map(move => move.name), getDefaultMoves(151).slice(0, 1))
})

test('normalizing a changed loadout updates any serialized move IDs before battle or ranked validation', () => {
  const saved = normalizePokemon({ speciesId: 25, captureId: 'dex-25', moves: defaults, moveIds: defaults.map(name => getMove(name).id) })
  const reduced = normalizePokemon({ ...saved, moves: [defaults[2]] })
  assert.deepEqual(reduced.moveIds, [getMove(defaults[2]).id])
  assert.deepEqual(createBattlePreviewPokemon(reduced).moves.map(move => move.name), [defaults[2]])
})

test('species and required-move form transitions preserve short loadouts without filling empty slots', () => {
  const evolving = normalizePokemon({ speciesId: 1, moves: ['방어'] })
  assert.deepEqual(normalizePokemon({ ...evolving, speciesId: 2 }).moves, ['방어'])
  const resolute = Object.values(SPECIES_PROFILES).find(profile => profile.slug === 'keldeo-resolute')
  const required = getFormMetadata(resolute).requiredMove
  const transformed = normalizePokemon({ speciesId: resolveMoveTriggeredFormSpeciesId(647, ['방어', required]), moves: ['방어', required] })
  assert.equal(transformed.speciesId, resolute.id)
  assert.deepEqual(transformed.moves, ['방어', required])
  const ordinary = normalizePokemon({ ...transformed, speciesId: resolveMoveTriggeredFormSpeciesId(transformed.speciesId, ['방어']), moves: ['방어'] })
  assert.equal(ordinary.speciesId, 647)
  assert.deepEqual(ordinary.moves, ['방어'])
  assert.deepEqual(normalizePokemon({ speciesId: resolute.id, moves: ['방어'] }).moves, ['방어', required])
  assert.deepEqual(normalizePokemon({ speciesId: resolute.id, moves: [] }).moves, [required])
})

test('collection migration and authenticated account save/load retain one-to-three moves for ranked registration', async () => {
  const original = team()
  const migrated = migratePokemonCollection(JSON.parse(JSON.stringify(original)))
  const savedTeam = original.map(pokemon => migrated.find(entry => entry.captureId === pokemon.captureId))
  assert.deepEqual(savedTeam.map(pokemon => pokemon.moves.length), counts)
  const store = createMemoryRankedStore()
  const account = createAccountService({ store, now: () => 1000, newVersion: () => 'move-slots-version' })
  const identity = { uid: 'move-slots-owner', name: 'Move slots test' }
  const ownerId = 'move-slots-window-owner'
  const command = (action, values = {}) => account.execute(identity, { action, ownerId, ...values })
  await command('sessionAcquire')
  await command('save', { revision: 'move-slots-save', saveSequence: 1, payload: {
    'champions-dex-v2': JSON.stringify(migrated), 'champions-battle-items-v1': '{}',
  } })
  const loaded = await command('load')
  const restored = migratePokemonCollection(JSON.parse(loaded.gameData.payload['champions-dex-v2']))
  assert.deepEqual(original.map(pokemon => restored.find(entry => entry.captureId === pokemon.captureId).moves.length), counts)
  const resolveTeam = createAccountRankedTeamResolver(store)
  const authoritative = await resolveTeam(identity, savedTeam.map(({ captureId }) => ({ captureId, moves: defaults })))
  assert.deepEqual(authoritative.map(pokemon => pokemon.moves.length), counts)
  const registered = canonicalizeRankedTeam(authoritative)
  assert.deepEqual(registered.map(pokemon => pokemon.moves.length), counts)
  assert.deepEqual(registered.map(pokemon => pokemon.moveIds.length), counts)
})

test('ranked singles and doubles expose only configured attacks and reject selecting an empty slot', () => {
  for (const format of ['single', 'double']) {
    const size = format === 'single' ? 3 : 4
    const registered = canonicalizeRankedTeam(team(), { format })
    const battle = createRankedBattle({ playerTeam: registered.slice(0, size), opponentTeam: registered.slice(0, size), format, random: () => .5 })
    assert.deepEqual(battle.player.team.map(pokemon => pokemon.moves.length), counts.slice(0, size))
    assert.deepEqual(battle.opponent.team.map(pokemon => pokemon.moves.length), counts.slice(0, size))
    assert.equal(getBattleMoveSelectionState(battle, 'player', 1, 0).disabled, true)
    const valid = format === 'single' ? [{ type: 'move', moveIndex: 0, actorSlot: 0 }] : [
      { type: 'move', moveIndex: 0, actorSlot: 0 }, { type: 'move', moveIndex: 0, actorSlot: 1 },
    ]
    assert.equal(validateRankedAction(battle, 'player', valid).length, valid.length)
    assert.throws(() => validateRankedAction(battle, 'player', valid.map((action, index) => index ? action : { ...action, moveIndex: 1 })), error => error.status === 400)
    const result = resolveRankedTurn(battle, { player: valid, opponent: valid }, () => .5)
    assert.deepEqual(result.state.player.team.map(pokemon => pokemon.moves.length), counts.slice(0, size))
    battle.player.team[0].moves[0].currentPp = 0
    assert.equal(getBattleStruggleAction(battle, 'player', 0)?.moveIndex, -1, 'No fabricated extra moves may prevent Struggle when the only move is exhausted')
  }
})

test('ranked registration still rejects zero, duplicate, unlearnable and placeholder attacks', () => {
  for (const moves of [[], [null], [''], ['missing-move'], ['화염방사'], [defaults[0], defaults[0]]]) {
    const entries = team()
    entries[3] = { ...entries[3], moves }
    assert.throws(() => canonicalizeRankedTeam(entries), error => error.status === 400)
  }
})

test('training charges for actual removed or added moves without charging for shifted retained slots', () => {
  const saved = normalizePokemon({ speciesId: 25, moves: defaults })
  const costOf = (moves, previous = saved) => getTrainingCostBreakdown(previous, { ...previous, moves }).total
  assert.equal(costOf(defaults.slice(1)), 100, 'Removing the first move must not charge for the three moves that shift up')
  assert.equal(costOf(defaults.slice(0, 1)), 300, 'Removing three moves leaves one usable move')
  assert.equal(costOf(defaults.slice(0, 2), { ...saved, moves: defaults.slice(0, 1) }), 100)
  const replacement = getLearnableMoves(25).find(move => !defaults.includes(move.name)).name
  assert.equal(costOf([replacement, ...defaults.slice(1)]), 100)
  assert.equal(costOf([...defaults].reverse()), 0, 'Reordering retained moves does not change the learned loadout')
})

test('a retained Hidden Power type change is charged even when another removal shifts its slot', () => {
  const saved = normalizePokemon({
    speciesId: 151, moves: ['방어', '잠재파워', '10만볼트'],
    hiddenPowerType: '불꽃', hiddenPowerTypeConfigured: true,
  })
  const shifted = { ...saved, moves: ['잠재파워', '10만볼트'] }
  assert.equal(getTrainingCostBreakdown(saved, shifted).total, 100)
  assert.equal(getTrainingCostBreakdown(saved, { ...shifted, hiddenPowerType: '얼음' }).total, 200)
  assert.equal(getTrainingCostBreakdown(saved, {
    ...saved, moves: ['방어', '10만볼트'], hiddenPowerType: '얼음',
  }).total, 100, 'Removing Hidden Power already pays for that move change')
})

for (const { name, run } of tests) { await run(); console.log(`PASS ${name}`) }
console.log(`Training move-slot validation passed: ${tests.length}/${tests.length}`)
