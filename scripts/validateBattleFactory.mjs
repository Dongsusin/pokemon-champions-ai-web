import assert from 'node:assert/strict'
import {
  advanceFactoryFloor,
  beginFactoryBattle,
  createFactoryRun,
  FACTORY_TRAINER,
  resolveFactoryBattle,
  selectFactoryLead,
  selectFactoryRentals,
} from '../src/data/battleFactory.js'
import {
  createBattle,
  createBattlePreviewPokemon,
  createBattleTurnTimeline,
  forcePlayerSwitch,
  getActivePokemonList,
  getAvailableBattleMechanics,
  getBattleMovePreview,
  getBattleMoveTargets,
  getBattleTeraType,
  playBattleTurn,
  playBattleTurnWithActions,
} from '../src/data/battleEngine.js'
import {
  canGigantamax, getGigantamaxProfile, getLearnableMoves, getMove,
  getSpeciesProfile, isSavablePokemonForm, resolveMoveForPokemon, SPECIES_PROFILES,
} from '../src/data/trainingData.js'
import { getBattleItem } from '../src/data/shopData.js'
import { TRAINERS } from '../src/data/trainerTeams.js'

let checks = 0
function check(name, fn) {
  fn()
  checks += 1
  console.log(`PASS ${name}`)
}
const rejected = (fn, code) => assert.throws(fn, (error) => error.code === code)
function readyRun(seed = 42) {
  const run = createFactoryRun({ seed, id: `factory-test-${seed}` })
  const selected = selectFactoryRentals(run, run.offers.slice(0, 3).map((entry) => entry.captureId))
  return selectFactoryLead(selected, selected.party[0].captureId)
}
// Existing engine smoke cases choose the first rental explicitly. Individual
// lead-selection tests below exercise the unselected and reordered states.
function startRun(run) {
  if (run.phase === 'battle') return run
  return beginFactoryBattle(run.leadCaptureId ? run : selectFactoryLead(run, run.party[0].captureId))
}
function victory(run) {
  const battleRun = startRun(run)
  return resolveFactoryBattle(battleRun, { battleId: battleRun.battleId, winner: 'player' })
}
function engineBattle(run) {
  run = startRun(run)
  return createBattle({
    playerPokemon: run.party,
    opponent: FACTORY_TRAINER,
    opponentTeam: run.opponentTeam,
    rules: run.rules,
    playerName: '팩토리 검증',
    random: () => 0.5,
  })
}
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze)
    Object.freeze(value)
  }
  return value
}

const rentalMoveTypes = (entry) => [...new Set(entry.moves.map((name) => resolveMoveForPokemon(getMove(name), entry).type))]
function intrinsicTeraType(entry) {
  if (entry.dexSpeciesId === 1024) return '스텔라'
  if (entry.dexSpeciesId !== 1017) return null
  return { 'ogerpon-wellspring-mask': '물', 'ogerpon-hearthflame-mask': '불꽃', 'ogerpon-cornerstone-mask': '바위' }[entry.slug] ?? '풀'
}
function assertRentalPreset(entry) {
  assert.equal(entry.dynamaxMode, canGigantamax(entry.speciesId) ? 'gigantamax' : 'dynamax', `${entry.slug}: incorrect default Dynamax mode`)
  const fixedType = intrinsicTeraType(entry)
  if (fixedType) assert.equal(entry.teraType, fixedType, `${entry.slug}: stored Tera type must match its intrinsic battle form rule`)
  else assert(rentalMoveTypes(entry).includes(entry.teraType), `${entry.slug}: Tera ${entry.teraType} is not one of its configured move types`)
  assert.deepEqual(entry.moveIds, entry.moves.map((name) => getMove(name).id))
  for (const mechanic of entry.battleMechanics.filter((mechanic) => ['dynamax', 'gigantamax'].includes(mechanic))) {
    assert.equal(mechanic, entry.dynamaxMode, 'AI mechanic tags must match the actual rental mode')
  }
  for (const gimmick of entry.factoryGimmicks) {
    if (gimmick.type === 'terastallization') assert.equal(gimmick.teraType, entry.teraType)
    if (['dynamax', 'gigantamax'].includes(gimmick.type)) assert.equal(gimmick.type, entry.dynamaxMode)
    if (gimmick.type === 'gigantamax') assert.equal(gimmick.targetFormId, getGigantamaxProfile(entry.speciesId).id)
  }
}

const gigantamaxRentals = new Map()
const intrinsicTeraRentals = new Map()

check('seeded six rentals are reproducible, diverse and legal level-50 loadouts', () => {
  const first = createFactoryRun({ seed: 123, id: 'same-run' })
  assert.deepEqual(first, createFactoryRun({ seed: 123, id: 'same-run' }))
  assert.notDeepEqual(first.offers, createFactoryRun({ seed: 124, id: 'same-run' }).offers)
  const species = new Set()
  const items = new Set()
  for (let seed = 0; seed < 100; seed += 1) {
    const run = readyRun(seed)
    assert.equal(run.offers.length, 6)
    assert.equal(new Set(run.offers.map((entry) => entry.dexSpeciesId)).size, 6)
    assert.equal(run.opponentTeam.pokemon.length, 3)
    assert.equal(new Set(run.opponentTeam.pokemon.map((entry) => entry.dexSpeciesId)).size, 3)
    for (const entry of [...run.offers, ...run.opponentTeam.pokemon]) {
      const profile = getSpeciesProfile(entry.speciesId)
      const learnset = new Set(getLearnableMoves(entry.speciesId).map((move) => move.name))
      assert(profile.abilities.includes(entry.ability))
      assert.equal(entry.level, 50)
      assert(entry.moves.length > 0 && entry.moves.length <= 4)
      assert.equal(new Set(entry.moves).size, entry.moves.length)
      assert(entry.moves.every((name) => learnset.has(name)))
      assert(!entry.heldItemId || getBattleItem(entry.heldItemId))
      assert.equal(entry.rental, true)
      species.add(entry.dexSpeciesId)
      items.add(entry.heldItemId)
    }
  }
  assert(species.size > 200, `Only ${species.size} distinct rental species`)
  assert(items.size > 20, `Only ${items.size} held items`)
  console.log(`  ${species.size} species / ${items.size} items sampled across 100 runs`)
})

check('all eligible rental species default to Gigantamax and both six offers and three opponents draw Tera types from their moves', () => {
  const sourceBefore = JSON.stringify(TRAINERS)
  const expectedGigantamax = new Set(TRAINERS.flatMap((trainer) => trainer.teams.flatMap((team) => team.pokemon))
    .filter((entry) => isSavablePokemonForm(entry.speciesId) && canGigantamax(entry.speciesId))
    .map((entry) => entry.speciesId))
  const selectedTypes = new Map()
  let nonGigantamax = 0
  let statusOnlyTeraExamples = 0
  // The rental pool roughly doubled when the trainer rosters widened, so the
  // seed budget has to grow with it for every Gigantamax species to come up.
  for (let seed = 0; seed < 1536; seed += 1) {
    const run = readyRun(seed)
    for (const entry of [...run.offers, ...run.opponentTeam.pokemon]) {
      assertRentalPreset(entry)
      if (intrinsicTeraType(entry)) intrinsicTeraRentals.set(entry.dexSpeciesId, entry)
      if (canGigantamax(entry.speciesId)) gigantamaxRentals.set(entry.speciesId, entry)
      else nonGigantamax += 1
      const signature = JSON.stringify([entry.speciesId, entry.moves, entry.heldItemId, entry.hiddenPowerType])
      if (!selectedTypes.has(signature)) selectedTypes.set(signature, new Set())
      selectedTypes.get(signature).add(entry.teraType)
      const moves = entry.moves.map((name) => resolveMoveForPokemon(getMove(name), entry))
      if (moves.some((move) => move.category === '변화' && move.type === entry.teraType)
        && !moves.some((move) => move.category !== '변화' && move.type === entry.teraType)) statusOnlyTeraExamples += 1
    }
  }
  assert.deepEqual([...gigantamaxRentals.keys()].sort((a, b) => a - b), [...expectedGigantamax].sort((a, b) => a - b), 'Seed coverage must include every Gigantamax-compatible species in the actual rental pool')
  assert(nonGigantamax > 100)
  assert(statusOnlyTeraExamples > 0, 'Status move types are owned move types too')
  const variedLoadouts = [...selectedTypes.values()].filter((types) => types.size > 1).length
  assert(variedLoadouts > 30, `Only ${variedLoadouts} identical loadouts received alternative random Tera types`)
  assert.equal(JSON.stringify(TRAINERS), sourceBefore, 'Factory-specific defaults must never mutate the ordinary AI trainer source')
  console.log(`  ${gigantamaxRentals.size} eligible species / ${variedLoadouts} loadouts with alternative Tera types / 13,824 generated rentals`)
})

check('Gigantamax compatibility distinguishes regional and special forms instead of matching only base species', () => {
  const profile = (slug) => {
    const entry = Object.values(SPECIES_PROFILES).find((entry) => entry.slug === slug)
    assert(entry, `${slug} is missing from species data`)
    return entry
  }
  for (const [slug, target] of [
    ['meowth', 'meowth-gmax'], ['pikachu', 'pikachu-gmax'],
    ['toxtricity', 'toxtricity-amped-gmax'], ['toxtricity-low-key', 'toxtricity-low-key-gmax'],
    ['urshifu', 'urshifu-single-strike-gmax'], ['urshifu-rapid-strike', 'urshifu-rapid-strike-gmax'],
  ]) assert.equal(getGigantamaxProfile(profile(slug).id)?.slug, target)
  for (const slug of ['meowth-alola', 'meowth-galar', 'pikachu-original-cap', 'pikachu-rock-star']) {
    assert.equal(canGigantamax(profile(slug).id), false, `${slug} cannot inherit the base species' Gigantamax form`)
  }
})

check('every eligible generated rental keeps its moves, held item and Gigantamax configuration in the real battle preview', () => {
  assert(gigantamaxRentals.size > 0)
  for (const entry of gigantamaxRentals.values()) {
    const before = JSON.stringify(entry)
    const preview = createBattlePreviewPokemon(entry)
    assert.equal(preview.dynamaxMode, 'gigantamax')
    assert.equal(preview.teraType, entry.teraType)
    assert.equal(preview.heldItemId, entry.heldItemId)
    assert.deepEqual(preview.moves.map((move) => move.id), entry.moveIds)
    assert(preview.moves.every((move) => move.currentPp === move.maxPp && move.currentPp > 0))
    assert.equal(getGigantamaxProfile(preview.originalSpeciesId).id, getGigantamaxProfile(entry.speciesId).id)
    assert.equal(JSON.stringify(entry), before)
  }
})

check('Ogerpon and Terapagos rentals show the same intrinsic Tera type that the battle will activate', () => {
  assert.deepEqual([...intrinsicTeraRentals.keys()].sort((a, b) => a - b), [1017, 1024])
  for (const entry of intrinsicTeraRentals.values()) {
    const preview = createBattlePreviewPokemon(entry)
    assert.equal(entry.teraType, intrinsicTeraType(entry))
    assert.equal(getBattleTeraType(preview), entry.teraType)
  }
})

check('selection requires exactly three offered unique Pokemon, preserves roster order and waits for a separate lead choice', () => {
  const run = deepFreeze(createFactoryRun({ seed: 3, id: 'selection' }))
  const ids = run.offers.map((entry) => entry.captureId)
  for (const selection of [[], ids.slice(0, 2), ids.slice(0, 4), [ids[0], ids[0], ids[1]], [ids[0], ids[1], 'box-pokemon']]) {
    rejected(() => selectFactoryRentals(run, selection), 'FACTORY_SELECTION')
  }
  const chosenIds = [ids[5], ids[3], ids[1]]
  const ready = selectFactoryRentals(run, chosenIds)
  ready.party.forEach(assertRentalPreset)
  assert.deepEqual(ready.party.map((entry) => entry.captureId), chosenIds)
  assert.equal(ready.leadCaptureId, null)
  rejected(() => beginFactoryBattle(ready), 'FACTORY_LEAD')
  assert.equal(run.phase, 'selection')
  assert.equal(run.party.length, 0)
  rejected(() => selectFactoryRentals(ready, chosenIds), 'FACTORY_PHASE')
})

check('lead selection rejects missing and foreign rentals, allows immutable changes, and starts the exact chosen Pokemon', () => {
  const selection = createFactoryRun({ seed: 37, id: 'lead-selection' })
  const ready = deepFreeze(selectFactoryRentals(selection, selection.offers.slice(0, 3).map(entry => entry.captureId)))
  const before = JSON.stringify(ready)
  for (const captureId of [null, undefined, '', 'box-pokemon', selection.offers[5].captureId, ready.opponentTeam.pokemon[0].captureId]) {
    rejected(() => selectFactoryLead(ready, captureId), 'FACTORY_LEAD')
    rejected(() => beginFactoryBattle({ ...ready, leadCaptureId: captureId }), 'FACTORY_LEAD')
  }
  rejected(() => selectFactoryLead(selection, ready.party[0].captureId), 'FACTORY_PHASE')
  const third = deepFreeze(selectFactoryLead(ready, ready.party[2].captureId))
  assert.equal(third.leadCaptureId, ready.party[2].captureId)
  assert.deepEqual(third.party, ready.party, 'Choosing a lead must not silently reorder the ready roster')
  const changed = selectFactoryLead(third, ready.party[1].captureId)
  assert.equal(changed.leadCaptureId, ready.party[1].captureId)
  assert.equal(third.leadCaptureId, ready.party[2].captureId)
  assert.equal(JSON.stringify(ready), before)
  for (const selected of [third, changed]) {
    const started = beginFactoryBattle(selected)
    const expectedIds = [selected.leadCaptureId, ...ready.party.filter(entry => entry.captureId !== selected.leadCaptureId).map(entry => entry.captureId)]
    assert.deepEqual(started.party.map(entry => entry.captureId), expectedIds)
    const battle = engineBattle(started)
    assert.equal(getActivePokemonList(battle, 'player')[0].captureId, selected.leadCaptureId)
    assert.deepEqual(battle.player.team.map(entry => entry.captureId), expectedIds)
    for (const entry of battle.player.team) {
      const rental = ready.party.find((rental) => rental.captureId === entry.captureId)
      assert.equal(entry.dynamaxMode, rental.dynamaxMode)
      assert.equal(getBattleTeraType(entry), rental.teraType)
      assert.equal(entry.heldItemId, rental.heldItemId)
    }
    rejected(() => selectFactoryLead(started, started.party[0].captureId), 'FACTORY_PHASE')
  }
})

check('one battle per floor, only completed matching results, and no duplicate/stale settlement', () => {
  const ready = deepFreeze(readyRun())
  const battle = beginFactoryBattle(ready)
  assert.equal(beginFactoryBattle(battle), battle)
  rejected(() => resolveFactoryBattle(ready, { battleId: 'x', winner: 'player' }), 'FACTORY_PHASE')
  rejected(() => resolveFactoryBattle(battle, { battleId: 'wrong', winner: 'player' }), 'FACTORY_BATTLE_ID')
  rejected(() => resolveFactoryBattle(battle, { battleId: battle.battleId, winner: null }), 'FACTORY_RESULT')
  const won = resolveFactoryBattle(battle, { battleId: battle.battleId, winner: 'player' })
  assert.equal(won.floor, 1)
  assert.equal(won.wins, 1)
  assert.equal(won.phase, 'exchange')
  assert.deepEqual(won.previousOpponent, ready.opponentTeam.pokemon)
  assert.equal(resolveFactoryBattle(won, { battleId: battle.battleId, winner: 'player' }), won)
  const next = startRun(advanceFactoryFloor(won))
  assert.equal(resolveFactoryBattle(next, { battleId: battle.battleId, winner: 'opponent' }), next)
  assert.notEqual(next.battleId, battle.battleId)
  assert.equal(next.phase, 'battle')
})

check('skipping keeps all three rentals; exchanging replaces exactly one slot from the last opponent', () => {
  const won = deepFreeze(victory(readyRun(8)))
  const skipped = advanceFactoryFloor(won)
  assert.equal(skipped.floor, 2)
  assert.equal(skipped.wins, 1)
  assert.deepEqual(skipped.party, won.party)
  assert.equal(skipped.previousOpponent.length, 0)
  assert.equal(skipped.leadCaptureId, null)
  rejected(() => beginFactoryBattle(skipped), 'FACTORY_LEAD')
  assert.notDeepEqual(skipped.opponentTeam, won.opponentTeam)
  const incoming = won.previousOpponent.find((entry) => !won.party.some((ally) => ally.dexSpeciesId === entry.dexSpeciesId))
  assert(incoming)
  const exchange = { giveCaptureId: won.party[1].captureId, takeCaptureId: incoming.captureId }
  const swapped = advanceFactoryFloor(won, exchange)
  assert.equal(swapped.party.length, 3)
  assert.deepEqual(swapped.party[0], won.party[0])
  assert.deepEqual(swapped.party[1], incoming)
  assert.deepEqual(swapped.party[2], won.party[2])
  for (const entry of [...skipped.party, ...swapped.party, ...swapped.opponentTeam.pokemon]) assertRentalPreset(entry)
  assert.deepEqual(swapped.lastExchange, exchange)
  assert.equal(swapped.leadCaptureId, null)
  rejected(() => beginFactoryBattle(swapped), 'FACTORY_LEAD')
  assert.equal(startRun(selectFactoryLead(swapped, swapped.party[1].captureId)).party[0].captureId, incoming.captureId)
  rejected(() => advanceFactoryFloor(swapped, exchange), 'FACTORY_PHASE')
  rejected(() => advanceFactoryFloor(won, { ...exchange, giveCaptureId: 'box-pokemon' }), 'FACTORY_EXCHANGE')
  rejected(() => advanceFactoryFloor(won, { ...exchange, takeCaptureId: won.offers[4].captureId }), 'FACTORY_EXCHANGE')
  const nextWin = victory(swapped)
  rejected(() => advanceFactoryFloor(nextWin, exchange), 'FACTORY_EXCHANGE')
})

check('exchange forbids duplicate species, including alternate forms, but allows replacing that species itself', () => {
  const won = victory(readyRun(10))
  const duplicate = { ...won.party[0], captureId: 'previous-foe-copy', speciesId: 10000, dexSpeciesId: won.party[0].dexSpeciesId }
  const fixture = { ...won, previousOpponent: [duplicate, ...won.previousOpponent.slice(1)] }
  rejected(() => advanceFactoryFloor(fixture, {
    giveCaptureId: won.party[1].captureId, takeCaptureId: duplicate.captureId,
  }), 'FACTORY_DUPLICATE_SPECIES')
  const swapped = advanceFactoryFloor(fixture, {
    giveCaptureId: won.party[0].captureId, takeCaptureId: duplicate.captureId,
  })
  assert.equal(swapped.party[0].captureId, duplicate.captureId)
})

check('defeat, draw, and forfeits end the run without a free floor or rental exchange', () => {
  for (const result of [
    { winner: 'opponent' }, { winner: 'draw' },
    { winner: 'opponent', forfeited: true }, { winner: 'player', forfeited: true },
  ]) {
    const battle = startRun(advanceFactoryFloor(victory(readyRun(21))))
    const ended = resolveFactoryBattle(battle, { ...result, battleId: battle.battleId })
    assert.equal(ended.phase, 'finished')
    assert.equal(ended.floor, 2)
    assert.equal(ended.wins, 1)
    assert.equal(ended.previousOpponent.length, 0)
    rejected(() => beginFactoryBattle(ended), 'FACTORY_PHASE')
    rejected(() => advanceFactoryFloor(ended), 'FACTORY_PHASE')
    const restart = createFactoryRun({ seed: 1 })
    assert.equal(restart.phase, 'selection')
    assert.equal(restart.floor, 1)
    assert.equal(restart.wins, 0)
  }
})

check('rental snapshots survive damaged HP, status, depleted PP, consumed items and gimmicks', () => {
  const run = deepFreeze(readyRun(42))
  const before = JSON.stringify(run)
  const damaged = engineBattle(run)
  for (const pokemon of [...damaged.player.team, ...damaged.opponent.team]) {
    pokemon.hp = 0
    pokemon.fainted = true
    pokemon.status = { id: 'toxic', toxicCounter: 8 }
    pokemon.moves.forEach((move) => { move.currentPp = 0 })
    pokemon.heldItemId = ''
    pokemon.consumedItem = true
    pokemon.teraActive = true
    pokemon.statStages.attack = -6
  }
  const next = advanceFactoryFloor(victory(run))
  const fresh = engineBattle(next)
  for (const pokemon of fresh.player.team) {
    assert.equal(pokemon.hp, pokemon.maxHp)
    assert.equal(pokemon.fainted, false)
    assert.equal(pokemon.status, null)
    assert(pokemon.moves.every((move) => move.currentPp === move.maxPp))
    assert.equal(pokemon.heldItemId, run.party.find((entry) => entry.captureId === pokemon.captureId).heldItemId)
    assert.equal(pokemon.teraActive, false)
  }
  assert.equal(JSON.stringify(run), before)
})

check('real hard-tactical AI turns accept factory parties without stat boosts or changing the stored run', () => {
  for (const seed of [4, 17, 42]) {
    const run = deepFreeze(readyRun(seed))
    const before = JSON.stringify(run)
    const battle = engineBattle(run)
    const result = playBattleTurn(battle, { type: 'move', moveIndex: 0, actorSlot: 0, targetSlot: 0 }, () => 0.5)
    assert(result.log.length > battle.log.length)
    assert.equal(result.player.team.length, 3)
    assert.equal(result.opponent.team.length, 3)
    assert.equal(result.rules.aiDifficulty.id, 'normal')
    assert.equal(result.rules.aiDecisionLevel, 'hard')
    assert.equal(result.rules.aiDifficulty.boostStage, 0)
    assert(result.turn > 1 || result.awaitingPlayerSwitch || result.winner)
    assert.equal(JSON.stringify(run), before)
    for (const pokemon of [...result.player.team, ...result.opponent.team]) {
      assert(Number.isInteger(pokemon.hp) && pokemon.hp >= 0 && pokemon.hp <= pokemon.maxHp)
    }
  }
})

check('borrowed opponents retain Mega, Z, Tera, Dynamax and Gigantamax as player rentals', () => {
  const examples = [
    { configured: 'terastallization', mechanic: 'tera' },
    { configured: 'gigantamax', mechanic: 'dynamax' },
    { configured: 'mega-evolution', mechanic: 'mega' },
    { configured: 'z-move', mechanic: 'zmove' },
    { configured: 'dynamax', mechanic: 'dynamax' },
  ]
  // Searched rather than hard-coded: which seed offers which gimmick shifts
  // whenever the rental roster changes, and a borrowed Pokemon that the next
  // floor's lead outspeeds and knocks out never gets to show its gimmick. So
  // walk seeds until one both offers the gimmick and survives to use it, and
  // only fail when the whole range cannot carry it over even once.
  for (const { configured, mechanic } of examples) {
    let activated = null
    for (let seed = 1; seed <= 400 && !activated; seed += 1) {
      const won = victory(readyRun(seed))
      const incoming = won.previousOpponent.find((pokemon) => pokemon.factoryGimmicks.some((entry) => entry.type === configured))
      if (!incoming) continue
      const next = advanceFactoryFloor(won, { giveCaptureId: won.party[0].captureId, takeCaptureId: incoming.captureId })
      const battle = engineBattle(next)
      const actor = battle.player.team[0]
      // Player createSide intentionally receives no teamGimmicks container: the
      // held item, species, Tera type and Dynamax mode must be sufficient.
      assert.equal(actor.gimmickFormId, null)
      if (!getAvailableBattleMechanics(battle).some((entry) => entry.id === mechanic)) continue
      const moveIndex = actor.moves.findIndex((move, index) => move.category !== '변화'
        && (mechanic !== 'zmove' || getBattleMovePreview(battle, 'player', index, 0, 0, mechanic)?.zMoveCompatible === true))
      if (moveIndex < 0) continue
      const result = createBattleTurnTimeline(battle, {
        type: 'move', moveIndex, actorSlot: 0, targetSlot: 0, gimmick: mechanic,
      }, () => 0.5, [{ type: 'move', moveIndex: 0, actorSlot: 0, targetSlot: 0 }])
      if (!result.timeline.some((step) => step.phase === 'gimmick' && step.sideId === 'player' && step.mechanicId === mechanic)) continue
      activated = { seed, incoming, next, result }
    }
    assert(activated, `No seed in 1..400 let a borrowed ${configured} rental use ${mechanic}`)
    const { incoming, next, result } = activated
    assert.equal(result.state.player.team[0].usedBattleMechanicId, mechanic)
    if (['gigantamax', 'mega-evolution'].includes(configured)) {
      const target = incoming.factoryGimmicks.find((entry) => entry.type === configured)
      assert.equal(result.state.player.team[0].speciesId, target.targetFormId)
    }
    assert.equal(next.party[0].heldItemId, incoming.heldItemId)
    assert.equal(next.party[0].speciesId, incoming.speciesId)
  }
})

check('a complete three-versus-three engine battle settles the tower from its actual result', () => {
  const run = beginFactoryBattle(readyRun(42))
  let battle = engineBattle(run)
  let steps = 0
  // Both sides use legal damage moves to keep this integration smoke bounded;
  // the preceding check exercises the normal production AI decision path.
  const actions = (sideId) => getActivePokemonList(battle, sideId).map((pokemon, actorSlot) => {
    const moveIndex = pokemon.moves.findIndex((move) => move.category !== '변화' && move.currentPp > 0)
    const chosen = Math.max(0, moveIndex)
    const target = getBattleMoveTargets(battle, sideId, chosen, actorSlot)[0]
    return { type: 'move', moveIndex: chosen, actorSlot, targetSlot: target?.slot ?? 0,
      ...(target ? { targetSideId: target.sideId } : {}) }
  })
  while (!battle.winner && steps < 100) {
    steps += 1
    if (battle.awaitingPlayerSwitch) {
      const index = battle.player.team.findIndex((pokemon, slot) => pokemon.hp > 0 && !pokemon.fainted && !battle.player.activeIndexes.includes(slot))
      assert(index >= 0)
      battle = forcePlayerSwitch(battle, index, () => 0.5)
    } else {
      battle = playBattleTurnWithActions(battle, actions('player'), actions('opponent'), () => 0.5)
    }
  }
  assert(battle.winner, `Factory battle did not finish after ${steps} decisions`)
  const result = resolveFactoryBattle(run, { battleId: run.battleId, winner: battle.winner })
  assert.equal(result.phase, battle.winner === 'player' ? 'exchange' : 'finished')
  assert.equal(result.wins, Number(battle.winner === 'player'))
  console.log(`  ${battle.turn} turns, ${steps} decisions, winner: ${battle.winner}`)
})

console.log(`Battle Factory validation passed: ${checks} checks`)
