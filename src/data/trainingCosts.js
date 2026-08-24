import { STAT_META } from './trainingData.js'

export const TRAINING_COSTS = Object.freeze({
  trainingPoint: 2,
  move: 100,
  nature: 200,
  ability: 400,
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
  const moveSlotCount = Math.max(savedMoves.length, draftMoves.length)
  const changedMoveSlots = Array.from({ length: moveSlotCount }, (value, moveIndex) => moveIndex)
    .filter((moveIndex) => savedMoves[moveIndex] !== draftMoves[moveIndex])

  const hiddenPowerConfigurationChanged = (
    savedPokemon.hiddenPowerType !== draftPokemon.hiddenPowerType
    || Boolean(savedPokemon.hiddenPowerTypeConfigured) !== Boolean(draftPokemon.hiddenPowerTypeConfigured)
  )
  const hiddenPowerMoveAlreadyChanged = changedMoveSlots.some((moveIndex) => (
    isHiddenPower(savedMoves[moveIndex]) || isHiddenPower(draftMoves[moveIndex])
  ))
  const moveUnits = changedMoveSlots.length + Number(
    hiddenPowerConfigurationChanged && !hiddenPowerMoveAlreadyChanged,
  )

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
      id: 'evolution',
      label: '진화',
      units: Number(savedPokemon.speciesId !== draftPokemon.speciesId),
      unitLabel: '회',
      unitCost: TRAINING_COSTS.evolution,
      cost: savedPokemon.speciesId !== draftPokemon.speciesId ? TRAINING_COSTS.evolution : 0,
    },
  ].filter((item) => item.cost > 0)

  return {
    items,
    total: items.reduce((total, item) => total + item.cost, 0),
  }
}
