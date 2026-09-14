import assert from 'node:assert/strict'
import {
  chooseAiAction, createBattle, createBattleTurnTimeline, getAvailableBattleMechanics,
  getBattleMovePreview, playBattleTurnWithActions,
} from '../src/data/battleEngine.js'
import { getLearnableMoves, getMoveById, SPECIES_PROFILES } from '../src/data/trainingData.js'
import { createRankedBattle, validateRankedAction } from '../server/rankedBattle.js'

// Showdown checks the current species (including Transform), rather than the
// original party species: sim/pokemon.ts#getDynamaxRequest. All six forms have
// cannotDynamax in data/pokedex.ts. Eternamax is tested as a battle-only entry;
// it is never registered in a ranked team or used as a legal Transform target.
// https://github.com/smogon/pokemon-showdown/blob/master/sim/pokemon.ts#L983-L995
// https://github.com/smogon/pokemon-showdown/blob/master/data/pokedex.ts#L17167-L17265
const profiles = new Map(Object.values(SPECIES_PROFILES).map(profile => [profile.slug, profile]))
const rng = () => 0.5
const cases = []
let fixtureId = 0
function pokemon(slug, moveIds, options = {}) {
  const profile = profiles.get(slug)
  assert(profile, `Missing species ${slug}`)
  const legal = new Set(getLearnableMoves(profile.id).map(move => move.id))
  for (const id of moveIds) assert(legal.has(id), `${slug} cannot learn ${id}`)
  const ability = options.ability ?? profile.abilities[0]
  assert(profile.abilities.includes(ability), `${slug} cannot have ${ability}`)
  return {
    speciesId: profile.id, captureId: `dynamax-eligibility-${++fixtureId}`,
    ability, moveIds, moves: moveIds.map(id => getMoveById(id).name),
    dynamaxMode: 'dynamax', ...options,
  }
}
const quiet = () => pokemon('wailord', ['splash'])
function battle(player, opponent = [quiet()], { double = false, ai = false } = {}) {
  return createBattle({
    playerPokemon: player, opponent: { name: 'DYNAMAX ELIGIBILITY', tier: 'C' },
    opponentTeam: { pokemon: opponent, battleGimmicks: [], strategy: {} }, random: rng,
    rules: {
      pvp: !ai, weather: { id: 'clear' }, terrain: { id: 'neutral' },
      format: { id: double ? 'double' : 'single', activeSlots: double ? 2 : 1, actionSlots: double ? 2 : 1 },
      teamRule: { id: 'full', battleSize: Math.max(player.length, opponent.length) },
      aiDifficulty: { id: 'normal', boostStage: 0 },
    },
  })
}
const action = (gimmick = null, actorSlot = 0, extra = {}) => ({
  type: 'move', actorSlot, targetSlot: 0, moveIndex: 0, gimmick, ...extra,
})
const hasDynamax = (state, sideId = 'player', slot = 0) => getAvailableBattleMechanics(state, sideId, slot).some(m => m.id === 'dynamax')
function check(name, fn) {
  try { fn(); cases.push({ name, passed: true }); console.log(`PASS ${name}`) }
  catch (error) { cases.push({ name, passed: false, error: error.stack }); console.error(`FAIL ${name}\n${error.stack}`) }
}
const forms = [
  { slug: 'zacian', source: 'zacian', move: 'ironhead' },
  { slug: 'zacian-crowned', source: 'zacian', move: 'ironhead', item: 'rusted-sword' },
  { slug: 'zamazenta', source: 'zamazenta', move: 'ironhead' },
  { slug: 'zamazenta-crowned', source: 'zamazenta', move: 'ironhead', item: 'rusted-shield' },
  { slug: 'eternatus', source: 'eternatus', move: 'dynamaxcannon' },
  { slug: 'eternatus-eternamax', source: 'eternatus-eternamax', move: 'dynamaxcannon' },
]
const forbidden = form => pokemon(form.source, [form.move], {
  heldItemId: form.item ?? '', battleMechanics: ['dynamax'],
})

for (const form of forms) {
  check(`${form.slug}: both sides hide Dynamax and reject Max previews`, () => {
    const state = battle([forbidden(form)], [forbidden(form)])
    for (const side of ['player', 'opponent']) {
      const active = state[side].team[0]
      assert.equal(active.speciesId, profiles.get(form.slug).id)
      assert.equal(hasDynamax(state, side), false)
      assert.equal(getBattleMovePreview(state, side, 0, 0, 0, 'dynamax').id, active.moves[0].id)
      assert(getAvailableBattleMechanics(state, side).some(m => m.id === 'tera'), 'Unrelated mechanic must stay available')
    }
  })
  check(`${form.slug}: forged commands cannot double HP, spend Dynamax, or emit its animation`, () => {
    for (const side of ['player', 'opponent']) {
      const before = side === 'player' ? battle([forbidden(form)]) : battle([quiet()], [forbidden(form)])
      const result = createBattleTurnTimeline(before, side === 'player' ? [action('dynamax')] : [action()], rng,
        side === 'opponent' ? [action('dynamax')] : [])
      const original = before[side].team[0], active = result.state[side].team[0]
      assert.equal(active.dynamaxActive, false)
      assert.equal(active.hp, original.hp)
      assert.equal(active.maxHp, original.maxHp)
      assert.equal(Boolean(result.state[side].usedMechanics.dynamax), false)
      assert.equal(Boolean(active.usedBattleMechanicId), false)
      assert.equal(active.moves[0].currentPp, original.moves[0].currentPp - 1)
      assert.equal(active.lastMoveId, original.moves[0].id, 'The base move remains executable')
      assert.equal(result.timeline.some(step => step.phase === 'gimmick' && step.sideId === side), false)
    }
  })
  check(`${form.slug}: configured AI never chooses unavailable Dynamax`, () => {
    const state = battle([quiet()], [forbidden(form)], { ai: true })
    assert(state.opponent.team[0].battleMechanics.includes('dynamax'))
    const snapshot = structuredClone(state)
    assert.equal(hasDynamax(state, 'opponent'), false)
    assert.notEqual(chooseAiAction(state, rng).gimmick, 'dynamax')
    assert.deepEqual(state, snapshot, 'AI forecasting must not mutate the battle')
  })
}

for (const form of forms.filter(form => form.slug !== 'eternatus-eternamax')) {
  check(`Ditto transformed into ${form.slug} uses the copied current species restriction`, () => {
    let state = battle([pokemon('ditto', ['transform'], { ability: '유연' }), quiet()], [forbidden(form)])
    assert(hasDynamax(state), 'Original Ditto is eligible')
    state = playBattleTurnWithActions(state, [action()], [], rng)
    const copied = state.player.team[0]
    assert(copied.transformSnapshot)
    assert.equal(copied.speciesId, profiles.get(form.slug).id)
    assert.equal(copied.battleBaseSpeciesId, 132)
    assert.equal(copied.originalSpeciesId, 132)
    assert.equal(hasDynamax(state), false)
    const after = playBattleTurnWithActions(state, [action('dynamax')], [], rng)
    assert.equal(after.player.team[0].maxHp, copied.maxHp)
    assert.equal(Boolean(after.player.usedMechanics.dynamax), false)
    state = playBattleTurnWithActions(state, [{ type: 'switch', actorSlot: 0, targetIndex: 1 }], [], rng)
    state = playBattleTurnWithActions(state, [{ type: 'switch', actorSlot: 0, targetIndex: 0 }], [], rng)
    assert.equal(state.player.team[0].speciesId, 132)
    assert.equal(state.player.team[0].transformSnapshot, null)
    assert(hasDynamax(state), 'Switching restores Ditto and eligibility')
  })
}

check('Imposter also denies Dynamax after copying Crowned Zacian at entry', () => {
  const state = battle([pokemon('ditto', ['transform'], { ability: '괴짜' })], [forbidden(forms[1])])
  assert.equal(state.player.team[0].speciesId, profiles.get('zacian-crowned').id)
  assert(state.player.team[0].transformSnapshot)
  assert.equal(hasDynamax(state), false)
})

for (const form of forms.filter(form => form.slug !== 'eternatus-eternamax')) {
  check(`Illusion as ${form.slug} blocks Dynamax until broken and is reapplied on re-entry`, () => {
    let state = battle([quiet(), pokemon('zoroark', ['scratch']), forbidden(form)], [pokemon('wailord', ['watergun'])])
    // A Crowned disguise must have actually entered and transformed first;
    // a held-item Hero sitting on the initial bench is still its Hero form.
    state = playBattleTurnWithActions(state, [{ type: 'switch', actorSlot: 0, targetIndex: 2 }], [], rng)
    state = playBattleTurnWithActions(state, [{ type: 'switch', actorSlot: 0, targetIndex: 1 }], [], rng)
    const disguised = state.player.team[1]
    assert.equal(disguised.speciesId, profiles.get('zoroark').id, 'Illusion does not change the actual species')
    assert(disguised.illusionSnapshot)
    assert.equal(disguised.illusionSpeciesId, profiles.get(form.slug).id)
    assert.equal(hasDynamax(state), false)
    state = playBattleTurnWithActions(state, [action('dynamax')], [action()], rng)
    const exposed = state.player.team[1]
    assert(exposed.hp > 0 && exposed.hp < disguised.hp, 'A surviving direct hit must break Illusion')
    assert.equal(exposed.illusionSnapshot, null)
    assert.equal(exposed.illusionSpeciesId, null)
    assert.equal(exposed.maxHp, disguised.maxHp)
    assert.equal(Boolean(state.player.usedMechanics.dynamax), false)
    assert(hasDynamax(state), 'Exposed Zoroark regains its normal eligibility')
    state = playBattleTurnWithActions(state, [{ type: 'switch', actorSlot: 0, targetIndex: 0 }], [], rng)
    state = playBattleTurnWithActions(state, [{ type: 'switch', actorSlot: 0, targetIndex: 1 }], [], rng)
    assert.equal(state.player.team[1].illusionSpeciesId, profiles.get(form.slug).id)
    assert.equal(hasDynamax(state), false)
  })
}
check('Illusion as an ordinary species leaves Zoroark eligible', () => {
  const state = battle([pokemon('zoroark', ['scratch']), quiet()])
  assert(state.player.team[0].illusionSnapshot)
  assert.equal(state.player.team[0].illusionSpeciesId, profiles.get('wailord').id)
  assert(hasDynamax(state))
})

for (const [slug, move, mode] of [['charizard', 'flamethrower', 'dynamax'], ['charizard', 'flamethrower', 'gigantamax'], ['wailord', 'splash', 'dynamax']]) {
  check(`${slug} ${mode}: ordinary eligible Pokemon still activate and double HP`, () => {
    const before = battle([pokemon(slug, [move], { dynamaxMode: mode })])
    assert(hasDynamax(before))
    const result = createBattleTurnTimeline(before, [action('dynamax')], rng, [])
    const active = result.state.player.team[0]
    assert(active.dynamaxActive)
    assert.equal(active.hp, before.player.team[0].hp * 2)
    assert.equal(active.maxHp, before.player.team[0].maxHp * 2)
    assert.equal(active.usedBattleMechanicId, 'dynamax')
    assert(result.state.player.usedMechanics.dynamax)
    assert.equal(result.timeline.filter(step => step.phase === 'gimmick' && step.sideId === 'player').length, 1)
    if (mode === 'gigantamax') assert.equal(profiles.get('charizard-gmax').id, active.speciesId)
  })
}
check('Ditto transformed into ordinary Charizard remains eligible', () => {
  let state = battle([pokemon('ditto', ['transform'], { ability: '유연' })], [pokemon('charizard', ['flamethrower'])])
  state = playBattleTurnWithActions(state, [action()], [], rng)
  assert.equal(state.player.team[0].speciesId, profiles.get('charizard').id)
  assert(hasDynamax(state))
  const after = playBattleTurnWithActions(state, [action('dynamax')], [], rng)
  assert(after.player.team[0].dynamaxActive)
  assert.equal(after.player.team[0].maxHp, state.player.team[0].maxHp * 2)
})
check('Double battle: invalid Zacian request does not consume its eligible ally\'s Dynamax', () => {
  const before = battle([forbidden(forms[1]), pokemon('charizard', ['flamethrower'])], [quiet(), quiet()], { double: true })
  assert.equal(hasDynamax(before, 'player', 0), false)
  assert.equal(hasDynamax(before, 'player', 1), true)
  const result = createBattleTurnTimeline(before, [action('dynamax'), action('dynamax', 1, { targetSlot: 1 })], rng, [])
  assert.equal(result.state.player.team[0].maxHp, before.player.team[0].maxHp)
  assert.equal(result.state.player.team[0].dynamaxActive, false)
  assert(result.state.player.team[1].dynamaxActive)
  assert.equal(result.state.player.team[1].maxHp, before.player.team[1].maxHp * 2)
  assert.equal(result.timeline.filter(step => step.phase === 'gimmick').length, 1)
})

function ranked(entry) {
  return createRankedBattle({
    playerTeam: [entry, pokemon('wailord', ['splash']), pokemon('snorlax', ['tackle'])],
    opponentTeam: [pokemon('blissey', ['pound']), pokemon('vaporeon', ['watergun']), pokemon('pikachu', ['thundershock'])],
    random: rng,
  })
}
for (const form of forms.filter(form => form.slug !== 'eternatus-eternamax')) {
  check(`Ranked server rejects ${form.slug} Dynamax while accepting its base action`, () => {
    const state = ranked(forbidden(form))
    assert.equal(state.player.team[0].speciesId, profiles.get(form.slug).id)
    assert.throws(() => validateRankedAction(state, 'player', [action('dynamax')]),
      error => error.status === 400 && error.code === 'invalid-battle-action' && /기믹/.test(error.message))
    assert.equal(validateRankedAction(state, 'player', [action()])[0].gimmick, null)
  })
}
check('Ranked server still accepts eligible Charizard Dynamax', () => {
  const state = ranked(pokemon('charizard', ['flamethrower']))
  assert.equal(validateRankedAction(state, 'player', [action('dynamax')])[0].gimmick, 'dynamax')
})

const failed = cases.filter(result => !result.passed)
console.log(JSON.stringify({ validation: 'Dynamax species eligibility', checked: cases.length, passed: cases.length - failed.length, failed: failed.length }))
if (failed.length) process.exitCode = 1
