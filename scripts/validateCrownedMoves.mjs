import assert from 'node:assert/strict'
import {
  createBattle, createBattlePreviewPokemon, getBattleMovePreview, playBattleTurnWithActions,
} from '../src/data/battleEngine.js'
import { getLearnableMoves, getMoveById, normalizePokemon, SPECIES_PROFILES } from '../src/data/trainingData.js'

// Source: Showdown data/conditions.ts, Zacian/Zamazenta onBattleStart and
// Dynamax onSourceModifyDamage. Saved loadouts retain Iron Head; battle slots
// use Behemoth Blade/Bash with their own metadata and PP.
const profiles = new Map(Object.values(SPECIES_PROFILES).map(profile => [profile.slug, profile]))
let fixtureId = 0, passed = 0
function pokemon(slug, ids = ['protect'], extra = {}) {
  const profile = profiles.get(slug)
  assert(profile, `Missing species: ${slug}`)
  const learnable = new Set(getLearnableMoves(profile.id).map(move => move.id))
  assert(ids.every(id => learnable.has(id)), `Illegal fixture move for ${slug}: ${ids}`)
  return { captureId: `crowned-${++fixtureId}`, speciesId: profile.id, moves: ids.map(id => getMoveById(id).name), ...extra }
}
function battle(player, opponent = [pokemon('registeel', ['flashcannon'])]) {
  return createBattle({ playerPokemon: player, opponent: { name: 'CROWNED VALIDATION', tier: 'S' },
    opponentTeam: { pokemon: opponent, battleGimmicks: [], strategy: {} },
    rules: { weather: { id: 'clear', label: '맑음' }, terrain: { id: 'neutral', label: '일반 필드' },
      format: { id: 'single', label: '싱글배틀', activeSlots: 1, actionSlots: 1 },
      teamRule: { battleSize: player.length }, pvp: true }, random: () => 0.5,
  })
}
function turn(state, action, opposing = { type: 'move', moveIndex: 0 }) {
  return playBattleTurnWithActions(state, [{ actorSlot: 0, targetSlot: 0, ...action }],
    [{ actorSlot: 0, targetSlot: 0, ...opposing }], () => 0.5)
}
function test(label, run) { run(); passed++; console.log(`PASS ${label}`) }

for (const [slug, item, signature] of [['zacian', 'rusted-sword', 'behemothblade'], ['zamazenta', 'rusted-shield', 'behemothbash']]) {
  test(`${slug}: held-item transformation replaces the complete battle move and preserves the saved loadout`, () => {
    const entry = pokemon(slug, ['protect', 'ironhead'], { heldItemId: item })
    const before = structuredClone(entry)
    const state = battle([entry])
    const active = state.player.team[0]
    assert.equal(active.slug, `${slug}-crowned`)
    assert.deepEqual(active.moves.map(move => move.id), ['protect', signature])
    const move = active.moves[1]
    assert.equal(move.name, getMoveById(signature).name)
    assert.equal(move.power, 100)
    assert.equal(move.currentPp, 5)
    assert.equal(move.maxPp, 5)
    assert.equal(move.secondary, undefined, 'Iron Head flinch must not carry over')
    assert.equal(move.description, getMoveById(signature).description)
    assert.equal(getBattleMovePreview(state, 'player', 1).id, signature)
    assert.deepEqual(entry, before)
    assert.deepEqual(normalizePokemon(entry).moves, before.moves)
  })
  test(`${slug}: direct Crowned battle entries use the signature move`, () => {
    const runtime = createBattlePreviewPokemon(pokemon(`${slug}-crowned`, ['ironhead'], { heldItemId: item }))
    assert.equal(runtime.moves[0].id, signature)
    assert.equal(runtime.moves[0].currentPp, 5)
  })
  test(`${slug}: switching in converts its original slot and switching out/in never refills PP`, () => {
    let state = battle([pokemon('snorlax'), pokemon(slug, ['ironhead'], { heldItemId: item })], [pokemon('registeel')])
    state = turn(state, { type: 'switch', targetIndex: 1 })
    assert.equal(state.player.team[1].moves[0].id, signature)
    state = turn(state, { type: 'move', moveIndex: 0 })
    assert.equal(state.player.team[1].moves[0].currentPp, 4)
    assert(state.log.some(entry => entry.message.includes(getMoveById(signature).name)))
    state = turn(state, { type: 'switch', targetIndex: 0 })
    state = turn(state, { type: 'switch', targetIndex: 1 })
    assert.equal(state.player.team[1].moves[0].id, signature)
    assert.equal(state.player.team[1].moves[0].currentPp, 4)
    assert.equal(state.player.team[1].moves[0].maxPp, 5)
  })
  test(`${slug}: wrong/missing item leaves Iron Head; a move is not added to an empty slot`, () => {
    for (const heldItemId of ['', item === 'rusted-sword' ? 'rusted-shield' : 'rusted-sword']) {
      const state = battle([pokemon(slug, ['ironhead'], { heldItemId })])
      assert.equal(state.player.team[0].slug, slug)
      assert.equal(state.player.team[0].moves[0].id, 'ironhead')
      assert.equal(state.player.team[0].moves[0].maxPp, 15)
    }
    const state = battle([pokemon(slug, ['protect'], { heldItemId: item })])
    assert.deepEqual(state.player.team[0].moves.map(move => move.id), ['protect'])
  })
}

for (const [slug, moveId, item] of [['zacian', 'ironhead', 'rusted-sword'], ['zamazenta', 'ironhead', 'rusted-shield'], ['eternatus', 'dynamaxcannon', '']]) {
  test(`${slug}: signature damage doubles against Dynamax without changing normal-target damage`, () => {
    const normal = battle([pokemon(slug, [moveId], { heldItemId: item })])
    const dynamax = structuredClone(normal)
    const target = dynamax.opponent.team[0]
    target.dynamaxActive = true
    target.dynamaxTurns = 3
    target.hp *= 2
    target.maxHp *= 2
    const baseDamage = normal.opponent.team[0].hp - turn(normal, { type: 'move', moveIndex: 0 }).opponent.team[0].hp
    const doubledDamage = target.hp - turn(dynamax, { type: 'move', moveIndex: 0 }).opponent.team[0].hp
    assert(baseDamage > 0)
    assert(Math.abs(doubledDamage - 2 * baseDamage) <= 1, `Expected twice ${baseDamage}, got ${doubledDamage}`)
  })
}

test('an ordinary Iron Head retains its normal damage against a Dynamax target', () => {
  const normal = battle([pokemon('metagross', ['ironhead'])])
  // Keep the attacker faster in both otherwise identical positions so the
  // defender's later Max Steelspike cannot alter the first hit's Defense.
  normal.player.team[0].stats.speed = 999
  const dynamax = structuredClone(normal)
  const target = dynamax.opponent.team[0]
  target.dynamaxActive = true; target.dynamaxTurns = 3; target.hp *= 2; target.maxHp *= 2
  const baseDamage = normal.opponent.team[0].hp - turn(normal, { type: 'move', moveIndex: 0 }).opponent.team[0].hp
  const dynamaxDamage = target.hp - turn(dynamax, { type: 'move', moveIndex: 0 }).opponent.team[0].hp
  assert.equal(dynamaxDamage, baseDamage)
})

console.log(`Crowned move validation passed: ${passed}/${passed}`)
