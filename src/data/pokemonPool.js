import {
  NATIONAL_DEX,
  NATIONAL_DEX_COUNT,
  getCanonicalPokemonFormProfile,
  getEvolutionSpeciesIds,
  getSpeciesProfile,
  isSavablePokemonForm,
  normalizePokemon,
  randomNature,
} from './trainingData.js'

export const BASE_SHINY_ODDS = 4096
export const LEGENDARY_DRAW_RATE = 0.001
export const PICKUP_ROTATION_MS = 60 * 60 * 1000

export const DRAW_BANNERS = {
  standard: {
    id: 'standard',
    eyebrow: 'CHAMPIONS SCOUT',
    title: '일반 뽑기',
    price: 1000,
    shinyOnly: false,
  },
  pickup: {
    id: 'pickup',
    eyebrow: 'LEGEND PICKUP',
    title: '전설 픽업 뽑기',
    price: 1800,
    shinyOnly: false,
  },
  shiny: {
    id: 'shiny',
    eyebrow: 'SHINY FESTIVAL',
    title: '이로치 뽑기',
    price: 3600,
    shinyOnly: true,
  },
}

export const DRAW_BANNER_ORDER = ['standard', 'pickup', 'shiny']

export const RARITY_META = {
  common: { label: 'C · 루키', stars: '★', rate: 0.5, minBaseStatTotal: 0, maxBaseStatTotal: 449 },
  rare: { label: 'B · 레어', stars: '★★', rate: 0.32, minBaseStatTotal: 450, maxBaseStatTotal: 499 },
  elite: { label: 'A · 엘리트', stars: '★★★', rate: 0.14, minBaseStatTotal: 500, maxBaseStatTotal: 549 },
  champion: { label: 'S · 챔피언', stars: '★★★★', rate: 0.039, minBaseStatTotal: 550, maxBaseStatTotal: Infinity },
  legend: { label: 'EX · 전설·환상', stars: '★★★★★', rate: LEGENDARY_DRAW_RATE, minBaseStatTotal: 0, maxBaseStatTotal: Infinity },
}

export const DRAW_RARITY_ORDER = ['common', 'rare', 'elite', 'champion', 'legend']

function classificationFor(profile) {
  if (profile.isMythical) return 'mythical'
  if (profile.isLegendary) return 'legendary'
  return 'standard'
}

export function getBaseStatTotal(profile) {
  return Array.isArray(profile?.stats)
    ? profile.stats.reduce((total, value) => total + (Number(value) || 0), 0)
    : 0
}

export function getPokemonRarity(profile) {
  if (profile?.isLegendary || profile?.isMythical) return 'legend'

  const baseStatTotal = getBaseStatTotal(profile)
  if (baseStatTotal <= RARITY_META.common.maxBaseStatTotal) return 'common'
  if (baseStatTotal <= RARITY_META.rare.maxBaseStatTotal) return 'rare'
  if (baseStatTotal <= RARITY_META.elite.maxBaseStatTotal) return 'elite'
  return 'champion'
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
  const classification = classificationFor(profile)
  return {
    ...profile,
    rarity: getPokemonRarity(profile),
    classification,
    baseStatTotal: getBaseStatTotal(profile),
    ability: profile.abilities[0],
    image: profile.spriteFront,
  }
})

export const LEGENDARY_MYTHICAL_POOL = POKEMON_POOL.filter((pokemon) => pokemon.rarity === 'legend')

export const DRAW_RARITY_POOLS = Object.fromEntries(
  DRAW_RARITY_ORDER.map((rarity) => [
    rarity,
    rarity === 'legend'
      ? LEGENDARY_MYTHICAL_POOL
      : POKEMON_POOL.filter((pokemon) => pokemon.rarity === rarity),
  ]),
)

function normalizedTimestamp(value = Date.now()) {
  const timestamp = value instanceof Date ? value.getTime() : Number(value)
  return Number.isFinite(timestamp) ? timestamp : Date.now()
}

export function getCurrentLegendaryPickup(now = Date.now()) {
  const rotation = Math.floor(normalizedTimestamp(now) / PICKUP_ROTATION_MS)
  const index = ((rotation % LEGENDARY_MYTHICAL_POOL.length) + LEGENDARY_MYTHICAL_POOL.length)
    % LEGENDARY_MYTHICAL_POOL.length
  return LEGENDARY_MYTHICAL_POOL[index]
}

export function getPickupRotationRemainingMs(now = Date.now()) {
  const timestamp = normalizedTimestamp(now)
  const elapsed = ((timestamp % PICKUP_ROTATION_MS) + PICKUP_ROTATION_MS) % PICKUP_ROTATION_MS
  return PICKUP_ROTATION_MS - elapsed
}

export function getDrawBanner(bannerId = 'standard', now = Date.now()) {
  const banner = DRAW_BANNERS[bannerId] ?? DRAW_BANNERS.standard
  return banner.id === 'pickup'
    ? { ...banner, pickup: getCurrentLegendaryPickup(now) }
    : banner
}

export function getShinyChance() {
  return 1 / BASE_SHINY_ODDS
}

export function getShinyOdds(directDrawCount = 0) {
  return Math.round(1 / getShinyChance(directDrawCount))
}

export function rollShiny(random = Math.random) {
  return random() < getShinyChance()
}

function collectionDrawCounts(collection) {
  return new Map(collection.map((pokemon) => [
    Number(pokemon.dexSpeciesId ?? pokemon.speciesId),
    Math.max(0, Number(pokemon.directDrawCount ?? 0)),
  ]))
}

function randomPoolEntry(pool, random) {
  const roll = Math.min(0.999999999, Math.max(0, Number(random()) || 0))
  return pool[Math.floor(roll * pool.length)]
}

function rollPokemonRarity(random) {
  const roll = Math.min(0.999999999, Math.max(0, Number(random()) || 0))
  let cumulativeRate = 0

  for (const rarity of DRAW_RARITY_ORDER) {
    cumulativeRate += RARITY_META[rarity].rate
    if (roll < cumulativeRate) return rarity
  }

  return 'legend'
}

function rollPokemonForBanner(bannerId, random, now) {
  const rarity = rollPokemonRarity(random)
  const pool = rarity === 'legend' && bannerId === 'pickup'
    ? [getCurrentLegendaryPickup(now)]
    : DRAW_RARITY_POOLS[rarity]
  return randomPoolEntry(pool, random)
}

export function createPokemonDraw(count = 10, collection = [], random = Math.random, options = {}) {
  if (typeof collection === 'function') {
    random = collection
    collection = []
  }

  if (typeof random !== 'function') {
    options = random ?? {}
    random = options.random ?? Math.random
  }

  const drawCounts = collectionDrawCounts(collection)
  const banner = getDrawBanner(options.bannerId, options.now)
  const drawTimestamp = normalizedTimestamp(options.now)

  return Array.from({ length: count }, (_, index) => {
    const pokemon = rollPokemonForBanner(banner.id, random, drawTimestamp)
    const previousDrawCount = drawCounts.get(pokemon.id) ?? 0
    const shinyChance = banner.shinyOnly ? 1 : getShinyChance()
    const isShiny = banner.shinyOnly || rollShiny(random)
    drawCounts.set(pokemon.id, previousDrawCount + 1)

    return {
      ...pokemon,
      bannerId: banner.id,
      pickupSpeciesId: banner.pickup?.id ?? null,
      isShiny,
      spriteFront: isShiny ? pokemon.spriteFrontShiny : pokemon.spriteFront,
      spriteBack: isShiny ? pokemon.spriteBackShiny : pokemon.spriteBack,
      spriteFrontFallback: isShiny ? pokemon.spriteFrontShinyFallback : pokemon.spriteFrontFallback,
      spriteBackFallback: isShiny ? pokemon.spriteBackShinyFallback : pokemon.spriteBackFallback,
      image: isShiny ? pokemon.spriteFrontShiny : pokemon.spriteFront,
      previousDrawCount,
      shinyChance,
      shinyOdds: Math.round(1 / shinyChance),
      slotId: `${drawTimestamp}-${index}-${random().toString(36).slice(2)}`,
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
    rarity: getPokemonRarity(species),
    classification: classificationFor(species),
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
        isShiny: Boolean(existing.isShiny || (rawPokemon.isShiny ?? shinyObtained)),
        lastDrawnAt: rawPokemon.lastDrawnAt ?? rawPokemon.obtainedAt ?? existing.lastDrawnAt,
      }))
    } else {
      const storedProfile = getSpeciesProfile(rawPokemon.speciesId)
      const canonicalProfile = getCanonicalPokemonFormProfile(storedProfile)
      const speciesId = Number(
        isSavablePokemonForm(canonicalProfile)
          ? canonicalProfile?.id ?? dexSpeciesId
          : canonicalProfile?.parentSpeciesId ?? canonicalProfile?.id ?? dexSpeciesId,
      )
      collectionMap.set(dexSpeciesId, normalizePokemon({
        ...rawPokemon,
        captureId: `dex-${dexSpeciesId}`,
        dexSpeciesId,
        speciesId,
        ability: rawPokemon.ability ?? storedProfile?.abilities?.[0],
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
    const isFirstShinyUnlock = !currentPokemon.shinyObtained && result.isShiny

    collectionMap.set(result.id, normalizePokemon({
      ...currentPokemon,
      captureId: `dex-${result.id}`,
      dexSpeciesId: result.id,
      directDrawCount: currentPokemon.directDrawCount + 1,
      shinyObtained,
      isShiny: isFirstShinyUnlock ? true : currentPokemon.isShiny,
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
