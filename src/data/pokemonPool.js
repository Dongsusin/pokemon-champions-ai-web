import {
  NATIONAL_DEX,
  NATIONAL_DEX_COUNT,
  getEvolutionSpeciesIds,
  getSpeciesProfile,
  normalizePokemon,
  randomNature,
} from './trainingData.js'

export const BASE_SHINY_ODDS = 4096
export const SHINY_COPY_BONUS = 0.01
export const MAX_SHINY_MULTIPLIER = 4

export const RARITY_META = {
  standard: { label: '전국도감', stars: 'ALL' },
  legendary: { label: '전설의 포켓몬', stars: 'LEGEND' },
  mythical: { label: '환상의 포켓몬', stars: 'MYTHICAL' },
}

function classificationFor(profile) {
  if (profile.isMythical) return 'mythical'
  if (profile.isLegendary) return 'legendary'
  return 'standard'
}

const NATIONAL_DEX_IDS = new Set(NATIONAL_DEX.map((profile) => profile.id))
const EVOLUTION_PARENT_IDS = new Set(
  NATIONAL_DEX
    .map((profile) => profile.evolvesFrom)
    .filter((speciesId) => Number.isInteger(speciesId) && speciesId > 0),
)

export function isFinalEvolutionSpecies(speciesId) {
  const normalizedSpeciesId = Number(speciesId)
  return NATIONAL_DEX_IDS.has(normalizedSpeciesId)
    && !EVOLUTION_PARENT_IDS.has(normalizedSpeciesId)
}

export const POKEMON_POOL = NATIONAL_DEX.filter((profile) => (
  isFinalEvolutionSpecies(profile.id)
)).map((profile) => {
  const rarity = classificationFor(profile)
  return {
    ...profile,
    rarity,
    classification: rarity,
    ability: profile.abilities[0],
    image: profile.spriteFront,
  }
})

export function getShinyChance(directDrawCount = 0) {
  const multiplier = Math.min(
    MAX_SHINY_MULTIPLIER,
    1 + Math.max(0, Number(directDrawCount) || 0) * SHINY_COPY_BONUS,
  )
  return Math.min(1, multiplier / BASE_SHINY_ODDS)
}

export function getShinyOdds(directDrawCount = 0) {
  return Math.round(1 / getShinyChance(directDrawCount))
}

export function rollShiny(random = Math.random, directDrawCount = 0) {
  return random() < getShinyChance(directDrawCount)
}

function collectionDrawCounts(collection) {
  return new Map(collection.map((pokemon) => [
    Number(pokemon.dexSpeciesId ?? pokemon.speciesId),
    Math.max(0, Number(pokemon.directDrawCount ?? 0)),
  ]))
}

export function createPokemonDraw(count = 10, collection = [], random = Math.random) {
  if (typeof collection === 'function') {
    random = collection
    collection = []
  }

  const drawCounts = collectionDrawCounts(collection)

  return Array.from({ length: count }, (_, index) => {
    const pokemon = POKEMON_POOL[Math.floor(random() * POKEMON_POOL.length)]
    const previousDrawCount = drawCounts.get(pokemon.id) ?? 0
    const shinyChance = getShinyChance(previousDrawCount)
    const isShiny = random() < shinyChance
    drawCounts.set(pokemon.id, previousDrawCount + 1)

    return {
      ...pokemon,
      isShiny,
      spriteFront: isShiny ? pokemon.spriteFrontShiny : pokemon.spriteFront,
      spriteBack: isShiny ? pokemon.spriteBackShiny : pokemon.spriteBack,
      spriteFrontFallback: isShiny ? pokemon.spriteFrontShinyFallback : pokemon.spriteFrontFallback,
      spriteBackFallback: isShiny ? pokemon.spriteBackShinyFallback : pokemon.spriteBackFallback,
      image: isShiny ? pokemon.spriteFrontShiny : pokemon.spriteFront,
      previousDrawCount,
      shinyChance,
      shinyOdds: Math.round(1 / shinyChance),
      slotId: `${Date.now()}-${index}-${random().toString(36).slice(2)}`,
      status: 'revealed',
    }
  })
}

function createCollectionPokemon(speciesId, overrides = {}) {
  const species = getSpeciesProfile(speciesId)

  return normalizePokemon({
    captureId: `dex-${speciesId}`,
    dexSpeciesId: speciesId,
    speciesId,
    rarity: classificationFor(species),
    isShiny: false,
    shinyObtained: false,
    directDrawCount: 0,
    ability: species.abilities[0],
    level: 50,
    nature: randomNature(),
    obtainedAt: new Date().toISOString(),
    ...overrides,
  })
}

export function createBoxPokemon(result) {
  return createCollectionPokemon(result.id, {
    captureId: `dex-${result.id}`,
    isShiny: result.isShiny,
    shinyObtained: result.isShiny,
    directDrawCount: 1,
    ability: result.ability,
    obtainedAt: new Date().toISOString(),
    lastDrawnAt: new Date().toISOString(),
  })
}

function normalizedDexId(pokemon) {
  const requestedId = Number(pokemon.dexSpeciesId ?? pokemon.speciesId)
  const profile = getSpeciesProfile(requestedId)
  const dexId = Number(profile?.parentSpeciesId ?? requestedId)
  return dexId >= 1 && dexId <= NATIONAL_DEX_COUNT ? dexId : null
}

function obtainedTime(pokemon) {
  const timestamp = Date.parse(pokemon.obtainedAt)
  return Number.isNaN(timestamp) ? Number.POSITIVE_INFINITY : timestamp
}

function shouldUseAsFamilyRepresentative(candidate, current) {
  const candidateDexId = normalizedDexId(candidate)
  const currentDexId = normalizedDexId(current)
  const candidateIsUnlockSource = Number(candidate.unlockSourceSpeciesId) === candidateDexId
  const currentIsUnlockSource = Number(current.unlockSourceSpeciesId) === currentDexId

  if (candidateIsUnlockSource !== currentIsUnlockSource) return candidateIsUnlockSource

  const candidateWasDirectlyDrawn = Number(candidate.directDrawCount ?? 0) > 0
  const currentWasDirectlyDrawn = Number(current.directDrawCount ?? 0) > 0

  if (candidateWasDirectlyDrawn !== currentWasDirectlyDrawn) return candidateWasDirectlyDrawn

  return obtainedTime(candidate) < obtainedTime(current)
}

export function getPokemonEvolutionFamilyKey(pokemon) {
  const dexSpeciesId = normalizedDexId(pokemon)
  const familySpeciesIds = dexSpeciesId
    ? getEvolutionSpeciesIds(dexSpeciesId)
      .map(Number)
      .filter(Number.isFinite)
      .sort((left, right) => left - right)
    : []

  return familySpeciesIds.length > 0
    ? familySpeciesIds.join(':')
    : `capture:${pokemon.captureId}`
}

export function getTrainingRosterPokemon(collection = []) {
  const familyRepresentatives = new Map()

  for (const pokemon of Array.isArray(collection) ? collection : []) {
    const familyKey = getPokemonEvolutionFamilyKey(pokemon)
    const currentRepresentative = familyRepresentatives.get(familyKey)

    if (!currentRepresentative || shouldUseAsFamilyRepresentative(pokemon, currentRepresentative)) {
      familyRepresentatives.set(familyKey, pokemon)
    }
  }

  return [...familyRepresentatives.values()].sort((left, right) => {
    const leftObtainedTime = obtainedTime(left)
    const rightObtainedTime = obtainedTime(right)
    if (leftObtainedTime !== rightObtainedTime) return leftObtainedTime < rightObtainedTime ? -1 : 1
    return (normalizedDexId(left) ?? 0) - (normalizedDexId(right) ?? 0)
  })
}

function ensureEvolutionRoute(collectionMap, sourceSpeciesId, obtainedAt = new Date().toISOString()) {
  for (const speciesId of getEvolutionSpeciesIds(sourceSpeciesId)) {
    if (collectionMap.has(speciesId)) continue
    collectionMap.set(speciesId, createCollectionPokemon(speciesId, {
      unlockSourceSpeciesId: sourceSpeciesId,
      obtainedAt,
    }))
  }
}

export function migratePokemonCollection(storedPokemon = []) {
  const collectionMap = new Map()
  const directSpeciesIds = new Set()

  for (const rawPokemon of Array.isArray(storedPokemon) ? storedPokemon : []) {
    const dexSpeciesId = normalizedDexId(rawPokemon)
    if (!dexSpeciesId) continue

    const oldFormat = rawPokemon.directDrawCount === undefined
    const directDrawCount = oldFormat ? 1 : Math.max(0, Number(rawPokemon.directDrawCount) || 0)
    const shinyObtained = Boolean(rawPokemon.shinyObtained ?? rawPokemon.isShiny)
    const existing = collectionMap.get(dexSpeciesId)

    if (existing) {
      collectionMap.set(dexSpeciesId, normalizePokemon({
        ...existing,
        directDrawCount: existing.directDrawCount + directDrawCount,
        shinyObtained: existing.shinyObtained || shinyObtained,
        isShiny: existing.isShiny || shinyObtained,
        lastDrawnAt: rawPokemon.lastDrawnAt ?? rawPokemon.obtainedAt ?? existing.lastDrawnAt,
      }))
    } else {
      const storedProfile = getSpeciesProfile(rawPokemon.speciesId)
      const speciesId = Number(storedProfile?.parentSpeciesId ?? storedProfile?.id ?? dexSpeciesId)
      collectionMap.set(dexSpeciesId, normalizePokemon({
        ...rawPokemon,
        captureId: `dex-${dexSpeciesId}`,
        dexSpeciesId,
        speciesId,
        directDrawCount,
        shinyObtained,
        isShiny: shinyObtained && Boolean(rawPokemon.isShiny ?? true),
      }))
    }

    if (directDrawCount > 0) directSpeciesIds.add(dexSpeciesId)
  }

  for (const speciesId of directSpeciesIds) {
    const source = collectionMap.get(speciesId)
    ensureEvolutionRoute(collectionMap, speciesId, source?.obtainedAt)
  }

  return [...collectionMap.values()].sort((left, right) => left.dexSpeciesId - right.dexSpeciesId)
}

export function createCompletePokemonCollection(collection = []) {
  const currentCollection = migratePokemonCollection(collection)
  const collectionMap = new Map(currentCollection.map((pokemon) => [pokemon.dexSpeciesId, pokemon]))
  const obtainedAt = new Date().toISOString()

  for (const pokemon of POKEMON_POOL) {
    ensureEvolutionRoute(collectionMap, pokemon.id, obtainedAt)
  }

  return [...collectionMap.values()]
    .sort((left, right) => left.dexSpeciesId - right.dexSpeciesId)
}

export function mergePokemonDraws(collection, results) {
  const currentCollection = migratePokemonCollection(collection)
  const collectionMap = new Map(currentCollection.map((pokemon) => [pokemon.dexSpeciesId, pokemon]))
  const previouslyUnlocked = new Set(collectionMap.keys())
  const directlySeenThisDraw = new Set(previouslyUnlocked)
  let duplicateCount = 0

  for (const result of results) {
    if (directlySeenThisDraw.has(result.id)) duplicateCount += 1
    directlySeenThisDraw.add(result.id)
    const obtainedAt = new Date().toISOString()
    ensureEvolutionRoute(collectionMap, result.id, obtainedAt)
    const currentPokemon = collectionMap.get(result.id) ?? createCollectionPokemon(result.id)
    const shinyObtained = currentPokemon.shinyObtained || result.isShiny

    collectionMap.set(result.id, normalizePokemon({
      ...currentPokemon,
      captureId: `dex-${result.id}`,
      dexSpeciesId: result.id,
      directDrawCount: currentPokemon.directDrawCount + 1,
      shinyObtained,
      isShiny: shinyObtained,
      lastDrawnAt: obtainedAt,
    }))
  }

  const nextCollection = [...collectionMap.values()]
    .sort((left, right) => left.dexSpeciesId - right.dexSpeciesId)
  const newlyUnlockedCount = nextCollection.reduce(
    (count, pokemon) => count + (previouslyUnlocked.has(pokemon.dexSpeciesId) ? 0 : 1),
    0,
  )

  return {
    collection: nextCollection,
    newlyUnlockedCount,
    duplicateCount,
    shinyCount: results.filter((result) => result.isShiny).length,
  }
}
