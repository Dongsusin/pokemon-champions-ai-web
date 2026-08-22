import pokemonData from '../src/data/generatedPokemonData.json' with { type: 'json' }
import trainerData from '../src/data/generatedTrainerTeams.json' with { type: 'json' }
import generatedBattleItems from '../src/data/generatedBattleItems.js'
import generatedBattleMoves from '../src/data/generatedBattleMoves.json' with { type: 'json' }
import {
  createBattle,
  createBattleTurnTimeline,
  getAvailableBattleMechanics,
} from '../src/data/battleEngine.js'
import { getLearnableMoves, getMoveById } from '../src/data/trainingData.js'
import {
  canUseZMove,
  normalizeZCrystalId,
  SIGNATURE_Z_MOVES,
} from '../src/data/zMoveData.js'

const profiles = [...pokemonData.species, ...pokemonData.forms]
const profileBySlug = new Map(profiles.map((profile) => [profile.slug, profile]))
const itemByCrystal = new Map(
  generatedBattleItems.map((item) => [normalizeZCrystalId(item.id), item]),
)
const itemById = new Map(generatedBattleItems.map((item) => [item.id, item]))
const moveById = new Map(generatedBattleMoves.moves.map((move) => [move.id, move]))
const opponentProfile = profileBySlug.get('magikarp')
const opponentMove = getMoveById('splash')
const failures = []
let scenarioCount = 0

for (const [crystalId, definition] of Object.entries(SIGNATURE_Z_MOVES)) {
  for (const speciesSlug of definition.species) {
    scenarioCount += 1
    const profile = profileBySlug.get(speciesSlug)
    const item = itemByCrystal.get(crystalId)
    const move = getMoveById(definition.baseMoveId)
    const canLearnMove = profile && getLearnableMoves(profile.id)
      .some((candidate) => candidate.id === definition.baseMoveId)

    if (!profile || !item || !move || !canLearnMove) {
      failures.push(`${crystalId}/${speciesSlug}: validation fixture is incomplete`)
      continue
    }

    const state = createBattle({
      playerPokemon: [{
        captureId: `signature-z-${crystalId}-${speciesSlug}`,
        speciesId: profile.id,
        slug: profile.slug,
        ability: profile.abilities[0],
        heldItemId: item.id,
        heldItemName: item.name,
        moves: [move.name],
        moveIds: [move.id],
        battleMechanics: ['z-move'],
      }],
      opponent: { name: 'Z-MOVE TEST' },
      opponentTeam: {
        pokemon: [{
          captureId: 'signature-z-target',
          speciesId: opponentProfile.id,
          slug: opponentProfile.slug,
          ability: opponentProfile.abilities[0],
          moves: [opponentMove.name],
          moveIds: [opponentMove.id],
        }],
        battleGimmicks: [],
        strategy: {},
      },
    })
    const available = getAvailableBattleMechanics(state, 'player', 0)
      .some((mechanic) => mechanic.id === 'zmove')
    const result = createBattleTurnTimeline(state, {
      type: 'move',
      actorSlot: 0,
      targetSlot: 0,
      moveIndex: 0,
      gimmick: 'zmove',
    }, () => 0.5)
    const moveStep = result.timeline.find((step) => (
      step.phase === 'announce' && step.sideId === 'player'
    ))
    const shouldUltraBurst = crystalId === 'ultranecroziumz'
      && ['necrozma-dusk', 'necrozma-dawn'].includes(speciesSlug)
    const transformedCorrectly = !shouldUltraBurst
      || result.state.player.team[0].speciesId === 10157

    if (
      !available
      || !result.state.player.usedMechanics.zmove
      || moveStep?.moveId !== definition.id
      || !transformedCorrectly
    ) {
      failures.push(`${crystalId}/${speciesSlug}: battle execution failed`)
    }
  }
}

let trainerZMoveCount = 0
for (const trainer of trainerData.trainers) {
  for (const team of trainer.teams) {
    for (const pokemon of team.pokemon) {
      const item = itemById.get(pokemon.heldItemId)
      if (item?.sourceCategory !== 'z-crystals') continue
      trainerZMoveCount += 1
      const compatible = pokemon.moveIds.some((moveId) => canUseZMove(moveById.get(moveId), {
        heldItemId: pokemon.heldItemId,
        speciesSlug: pokemon.slug,
      }))
      if (!pokemon.battleMechanics.includes('z-move') || !compatible) {
        failures.push(`${trainer.name} team ${team.number}/${pokemon.slug}: invalid trainer Z-Move`)
      }
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'))
  process.exit(1)
}

console.log(`Validated ${scenarioCount} signature Z-Move form combinations and ${trainerZMoveCount} trainer Z-Move sets.`)
