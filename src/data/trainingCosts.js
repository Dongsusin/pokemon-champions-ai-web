import { arePokemonGenderCounterparts, getMove, getMovePpTrainingCount, getSpeciesProfile, STAT_META } from './trainingData.js'

export const TRAINING_COSTS = Object.freeze({
  trainingPoint: 2,
  move: 100,
  movePp: 100,
  nature: 200,
  ability: 400,
  shiny: 0,
  form: 250,
  evolution: 400,
})

function pokemonMoves(pokemon) {
  return Array.isArray(pokemon?.moves) ? pokemon.moves : []
}

function isHiddenPower(moveName) {
  return /잠재파워|hidden\s*power/i.test(String(moveName ?? ''))
}

export function getTrainingCostBreakdown(savedPokemon, draftPokemon) {
  if (!savedPokemon || !draftPokemon) {
    return { items: [], total: 0 }
  }

  const trainingPointUnits = STAT_META.reduce((total, { key }) => (
    total + Math.abs(
      Number(draftPokemon.trainingPoints?.[key] ?? 0)
      - Number(savedPokemon.trainingPoints?.[key] ?? 0),
    )
  ), 0)

  const savedMoves = pokemonMoves(savedPokemon)
  const draftMoves = pokemonMoves(draftPokemon)
  // Removing a move compacts the remaining slots. Charge for changed moves,
  // not for the unchanged moves that simply shift up to fill the gap.
  const removedMoves = savedMoves.filter((move) => !draftMoves.includes(move))
  const addedMoves = draftMoves.filter((move) => !savedMoves.includes(move))
  const changedMoveCount = Math.max(removedMoves.length, addedMoves.length)
  const movePpUnits = draftMoves.reduce((total, name) => {
    const move = getMove(name)
    const savedCount = savedMoves.includes(name) ? getMovePpTrainingCount(move, savedPokemon) : 0
    return total + Math.max(0, getMovePpTrainingCount(move, draftPokemon) - savedCount)
  }, 0)

  const hiddenPowerConfigurationChanged = (
    savedPokemon.hiddenPowerType !== draftPokemon.hiddenPowerType
    || Boolean(savedPokemon.hiddenPowerTypeConfigured) !== Boolean(draftPokemon.hiddenPowerTypeConfigured)
  )
  const hiddenPowerMoveAlreadyChanged = [...removedMoves, ...addedMoves].some(isHiddenPower)
  const moveUnits = changedMoveCount + Number(
    hiddenPowerConfigurationChanged && !hiddenPowerMoveAlreadyChanged,
  )
  const savedProfile = getSpeciesProfile(savedPokemon.speciesId)
  const draftProfile = getSpeciesProfile(draftPokemon.speciesId)
  const savedBaseSpeciesId = Number(savedProfile?.parentSpeciesId ?? savedProfile?.id ?? savedPokemon.speciesId)
  const draftBaseSpeciesId = Number(draftProfile?.parentSpeciesId ?? draftProfile?.id ?? draftPokemon.speciesId)
  const speciesChanged = Number(savedPokemon.speciesId) !== Number(draftPokemon.speciesId)
  const genderProfileChanged = speciesChanged && arePokemonGenderCounterparts(savedProfile, draftProfile)
  const formChanged = speciesChanged && savedBaseSpeciesId === draftBaseSpeciesId && !genderProfileChanged
  const evolutionChanged = speciesChanged && savedBaseSpeciesId !== draftBaseSpeciesId
  const shinyChanged = Boolean(savedPokemon.isShiny) !== Boolean(draftPokemon.isShiny)

  const items = [
    {
      id: 'training-points',
      label: '능력',
      units: trainingPointUnits,
      unitLabel: 'P',
      unitCost: TRAINING_COSTS.trainingPoint,
      cost: trainingPointUnits * TRAINING_COSTS.trainingPoint,
    },
    {
      id: 'moves',
      label: '기술',
      units: moveUnits,
      unitLabel: '개',
      unitCost: TRAINING_COSTS.move,
      cost: moveUnits * TRAINING_COSTS.move,
    },
    {
      id: 'move-pp',
      label: 'PP 강화',
      units: movePpUnits,
      unitLabel: '회',
      unitCost: TRAINING_COSTS.movePp,
      cost: movePpUnits * TRAINING_COSTS.movePp,
    },
    {
      id: 'nature',
      label: '성격',
      units: Number(savedPokemon.nature !== draftPokemon.nature),
      unitLabel: '회',
      unitCost: TRAINING_COSTS.nature,
      cost: savedPokemon.nature !== draftPokemon.nature ? TRAINING_COSTS.nature : 0,
    },
    {
      id: 'ability',
      label: '특성',
      units: Number(savedPokemon.ability !== draftPokemon.ability),
      unitLabel: '회',
      unitCost: TRAINING_COSTS.ability,
      cost: savedPokemon.ability !== draftPokemon.ability ? TRAINING_COSTS.ability : 0,
    },
    {
      id: 'shiny',
      label: '이로치',
      units: Number(shinyChanged),
      unitLabel: '회',
      unitCost: TRAINING_COSTS.shiny,
      cost: 0,
      free: true,
    },
    {
      id: 'form',
      label: '폼',
      units: Number(formChanged),
      unitLabel: '회',
      unitCost: TRAINING_COSTS.form,
      cost: formChanged ? TRAINING_COSTS.form : 0,
    },
    {
      id: 'evolution',
      label: '진화',
      units: Number(evolutionChanged),
      unitLabel: '회',
      unitCost: TRAINING_COSTS.evolution,
      cost: evolutionChanged ? TRAINING_COSTS.evolution : 0,
    },
  ].filter((item) => item.cost > 0 || (item.free && item.units > 0))

  return {
    items,
    total: items.reduce((total, item) => total + item.cost, 0),
  }
}
