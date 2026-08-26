import fs from 'node:fs/promises'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'
import generatedBattleItems from '../src/data/generatedBattleItems.js'
import { isBattleMoveSupported } from '../src/data/moveSupportData.js'
import { isBattleFormCompatible } from '../src/data/trainingData.js'
import { canUseZMove } from '../src/data/zMoveData.js'
import { getZaMegaStoneByFormSlug, isZaMegaForm } from '../src/data/zaMegaData.js'
import { mechanicPreferencesFor } from './trainerBattleRules.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const cacheDir = path.join(__dirname, '.cache')
const pokemonDataPath = path.join(rootDir, 'src', 'data', 'generatedPokemonData.json')
const moveDataPath = path.join(rootDir, 'src', 'data', 'generatedBattleMoves.json')
const trainerDataPath = path.join(rootDir, 'src', 'data', 'generatedTrainerTeams.json')

const STAT_SOURCES = [
  { id: 'champions-1630', label: 'Champions OU 1630', url: 'https://www.smogon.com/stats/2026-07/chaos/gen9championsou-1630.json.gz' },
  { id: 'champions-0', label: 'Champions OU 전체', url: 'https://www.smogon.com/stats/2026-07/chaos/gen9championsou-0.json.gz' },
  { id: 'nationaldex-1630', label: 'National Dex 1630', url: 'https://www.smogon.com/stats/2026-07/chaos/gen9nationaldex-1630.json.gz' },
  { id: 'nationaldex-0', label: 'National Dex 전체', url: 'https://www.smogon.com/stats/2026-07/chaos/gen9nationaldex-0.json.gz' },
  { id: 'ubers-0', label: 'Ubers 전체', url: 'https://www.smogon.com/stats/2026-07/chaos/gen9ubers-0.json.gz' },
  { id: 'nationaldexubers-0', label: 'National Dex Ubers 전체', url: 'https://www.smogon.com/stats/2026-07/chaos/gen9nationaldexubers-0.json.gz' },
  { id: 'anythinggoes-0', label: 'Anything Goes 전체', url: 'https://www.smogon.com/stats/2026-07/chaos/gen9anythinggoes-0.json.gz' },
]

const SHOWDOWN_SOURCES = [
  { file: 'showdown-pokedex.json', url: 'https://play.pokemonshowdown.com/data/pokedex.json' },
  { file: 'showdown-learnsets.json', url: 'https://play.pokemonshowdown.com/data/learnsets.json' },
]

const TYPE_LABELS = {
  normal: '노말',
  fire: '불꽃',
  water: '물',
  electric: '전기',
  grass: '풀',
  ice: '얼음',
  fighting: '격투',
  poison: '독',
  ground: '땅',
  flying: '비행',
  psychic: '에스퍼',
  bug: '벌레',
  rock: '바위',
  ghost: '고스트',
  dragon: '드래곤',
  dark: '악',
  steel: '강철',
  fairy: '페어리',
  stellar: '스텔라',
}

const NATURE_LABELS = {
  Hardy: '노력',
  Lonely: '외로움',
  Brave: '용감',
  Adamant: '고집',
  Naughty: '개구쟁이',
  Bold: '대담',
  Docile: '온순',
  Relaxed: '무사태평',
  Impish: '장난꾸러기',
  Lax: '촐랑',
  Timid: '겁쟁이',
  Hasty: '성급',
  Serious: '성실',
  Jolly: '명랑',
  Naive: '천진난만',
  Modest: '조심',
  Mild: '의젓',
  Quiet: '냉정',
  Bashful: '수줍음',
  Rash: '덜렁',
  Calm: '차분',
  Gentle: '얌전',
  Sassy: '건방',
  Careful: '신중',
  Quirky: '변덕',
}

const STAT_KEYS = ['hp', 'attack', 'defense', 'specialAttack', 'specialDefense', 'speed']
const SHOWDOWN_ALIASES = {
  darmanitanstandard: 'darmanitan',
  darmanitangalarstandard: 'darmanitangalar',
  palafin: 'palafinhero',
  urshifu: 'urshifu',
  zygarde: 'zygarde',
}

const HAZARD_MOVES = new Set(['stealthrock', 'spikes', 'toxicspikes', 'stickyweb', 'stoneaxe', 'ceaselessedge'])
const REMOVAL_MOVES = new Set(['defog', 'rapidspin', 'mortalspin', 'tidyup', 'courtchange'])
const RECOVERY_MOVES = new Set(['recover', 'roost', 'slackoff', 'softboiled', 'moonlight', 'synthesis', 'shoreup', 'strengthsap', 'milkdrink', 'wish', 'rest', 'lifedew', 'junglehealing'])
const SETUP_MOVES = new Set(['swordsdance', 'nastyplot', 'dragondance', 'calmmind', 'bulkup', 'quiverdance', 'shellsmash', 'agility', 'rockpolish', 'irondefense', 'amnesia', 'coil', 'curse', 'bellydrum', 'tailglow', 'shiftgear', 'geomancy', 'victorydance', 'filletaway'])
const PIVOT_MOVES = new Set(['uturn', 'voltswitch', 'flipturn', 'partingshot', 'teleport', 'chillyreception'])
const PHAZING_MOVES = new Set(['dragontail', 'circlethrow', 'roar', 'whirlwind'])
const CHOICE_ITEM_IDS = new Set(['choiceband', 'choicespecs', 'choicescarf'])
const STATUS_LOCK_ITEM_IDS = new Set([...CHOICE_ITEM_IDS, 'assaultvest'])
const NON_DYNAMAX_DEX_IDS = new Set([888, 889, 890])
const MECHANIC_LABELS = {
  'mega-evolution': '메가진화',
  'z-move': 'Z기술',
  dynamax: '다이맥스',
  gigantamax: '거다이맥스',
  terastallization: '테라스탈',
  'primal-reversion': '원시회귀',
}
const Z_CRYSTAL_ITEM_IDS = {
  normal: 'normalium-z--held',
  fire: 'firium-z--held',
  water: 'waterium-z--held',
  electric: 'electrium-z--held',
  grass: 'grassium-z--held',
  ice: 'icium-z--held',
  fighting: 'fightinium-z--held',
  poison: 'poisonium-z--held',
  ground: 'groundium-z--held',
  flying: 'flyinium-z--held',
  psychic: 'psychium-z--held',
  bug: 'buginium-z--held',
  rock: 'rockium-z--held',
  ghost: 'ghostium-z--held',
  dragon: 'dragonium-z--held',
  dark: 'darkinium-z--held',
  steel: 'steelium-z--held',
  fairy: 'fairium-z--held',
}
const SIGNATURE_Z_CONFIGS = {
  decidueye: { itemId: 'decidium-z--held', moveId: 'spiritshackle' },
  incineroar: { itemId: 'incinium-z--held', moveId: 'darkestlariat' },
  primarina: { itemId: 'primarium-z--held', moveId: 'sparklingaria' },
  mimikyu: { itemId: 'mimikium-z--held', moveId: 'playrough' },
  lycanroc: { itemId: 'lycanium-z--held', moveId: 'stoneedge' },
  'lycanroc-midnight': { itemId: 'lycanium-z--held', moveId: 'stoneedge' },
  'lycanroc-dusk': { itemId: 'lycanium-z--held', moveId: 'stoneedge' },
  lunala: { itemId: 'lunalium-z--held', moveId: 'moongeistbeam' },
  marshadow: { itemId: 'marshadium-z--held', moveId: 'spectralthief' },
  mew: { itemId: 'mewnium-z--held', moveId: 'psychic' },
  solgaleo: { itemId: 'solganium-z--held', moveId: 'sunsteelstrike' },
  'raichu-alola': { itemId: 'aloraichium-z--held', moveId: 'thunderbolt' },
  eevee: { itemId: 'eevium-z--held', moveId: 'lastresort' },
  snorlax: { itemId: 'snorlium-z--held', moveId: 'gigaimpact' },
  pikachu: { itemId: 'pikanium-z--held', moveId: 'volttackle' },
  'kommo-o': { itemId: 'kommonium-z--held', moveId: 'clangingscales' },
  'necrozma-dusk': { itemId: 'ultranecrozium-z--held', moveId: 'photongeyser' },
  'necrozma-dawn': { itemId: 'ultranecrozium-z--held', moveId: 'photongeyser' },
  'tapu-koko': { itemId: 'tapunium-z--held', moveId: 'naturesmadness' },
  'tapu-lele': { itemId: 'tapunium-z--held', moveId: 'naturesmadness' },
  'tapu-bulu': { itemId: 'tapunium-z--held', moveId: 'naturesmadness' },
  'tapu-fini': { itemId: 'tapunium-z--held', moveId: 'naturesmadness' },
}
const WEATHER_CONFIGS = [
  { moveId: 'sunnyday', setterAbilities: new Set(['drought', 'orichalcumpulse']), beneficiaryAbilities: new Set(['chlorophyll', 'solarpower', 'protosynthesis', 'harvest']) },
  { moveId: 'raindance', setterAbilities: new Set(['drizzle', 'primordialsea']), beneficiaryAbilities: new Set(['swiftswim', 'raindish', 'hydration']) },
  { moveId: 'sandstorm', setterAbilities: new Set(['sandstream']), beneficiaryAbilities: new Set(['sandrush', 'sandforce', 'sandveil']) },
  { moveId: 'snowscape', setterAbilities: new Set(['snowwarning']), beneficiaryAbilities: new Set(['slushrush', 'icebody']) },
]
const ABILITY_PRIORITY = ['regenerator', 'intimidate', 'multiscale', 'magicguard', 'unaware', 'prankster', 'protosynthesis', 'quarkdrive', 'speedboost', 'technician', 'adaptability', 'levitate', 'waterabsorb', 'flashfire']
const UTILITY_PRIORITY = [
  'stealthrock', 'spikes', 'stickyweb', 'toxicspikes', 'defog', 'rapidspin', 'mortalspin',
  'recover', 'roost', 'slackoff', 'softboiled', 'strengthsap', 'synthesis', 'moonlight',
  'swordsdance', 'nastyplot', 'dragondance', 'calmmind', 'bulkup', 'quiverdance', 'shellsmash',
  'uturn', 'voltswitch', 'flipturn', 'partingshot', 'willowisp', 'thunderwave', 'toxic',
  'protect', 'substitute', 'encore', 'taunt', 'trick', 'knockoff', 'leechseed',
]
const UTILITY_SCORE = new Map(UTILITY_PRIORITY.map((moveId, index) => [moveId, 160 - index * 2]))

const toId = (value = '') => value.toLowerCase().replace(/[^a-z0-9]+/g, '')
const unique = (values) => [...new Set(values.filter(Boolean))]

function signatureZConfigFor(trainerName, pokemonSlug) {
  if (trainerName === '지우' && pokemonSlug === 'pikachu') {
    return { itemId: 'pikashunium-z--held', moveId: 'thunderbolt' }
  }
  return SIGNATURE_Z_CONFIGS[pokemonSlug]
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'))
}

async function ensureRemoteFile(filePath, url) {
  try {
    await fs.access(filePath)
    return
  } catch {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`)
    await fs.writeFile(filePath, Buffer.from(await response.arrayBuffer()))
  }
}

function sortedWeights(values = {}) {
  return Object.entries(values)
    .filter(([, weight]) => Number(weight) > 0)
    .sort((left, right) => Number(right[1]) - Number(left[1]))
}

function hashText(value) {
  let hash = 2166136261
  for (const character of value) {
    hash ^= character.codePointAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function normalizeTrainingPoints(rawValues) {
  const source = rawValues.map((value) => Math.max(0, Number(value) || 0))
  const isStandardEvSpread = Math.max(...source) > 32 || source.reduce((total, value) => total + value, 0) > 66
  const points = isStandardEvSpread
    ? source.map((value) => Math.min(32, Math.round(value * 32 / 252)))
    : source.map((value) => Math.min(32, Math.round(value)))
  const sourceOrder = source
    .map((value, index) => ({ value, index }))
    .sort((left, right) => right.value - left.value || left.index - right.index)
    .map(({ index }) => index)
  const nonZeroOrder = sourceOrder.filter((index) => source[index] > 0)
  const fillOrder = unique([...nonZeroOrder, ...sourceOrder, 0, 1, 3, 5, 2, 4])
  let total = points.reduce((sum, value) => sum + value, 0)

  while (total > 66) {
    const index = [...fillOrder].reverse().find((candidate) => points[candidate] > 0)
    if (index === undefined) break
    points[index] -= 1
    total -= 1
  }

  while (total < 66) {
    const index = fillOrder.find((candidate) => points[candidate] < 32)
    if (index === undefined) break
    points[index] += 1
    total += 1
  }

  return Object.fromEntries(STAT_KEYS.map((key, index) => [key, points[index]]))
}

function parseSpread(spreadKey, species) {
  const [natureId, valuesText] = String(spreadKey ?? '').split(':')
  const values = valuesText?.split('/').map(Number)
  if (!NATURE_LABELS[natureId] || values?.length !== 6 || values.some((value) => !Number.isFinite(value))) return null

  return {
    natureId,
    nature: NATURE_LABELS[natureId],
    trainingPoints: normalizeTrainingPoints(values),
  }
}

function fallbackSpread(species) {
  const [hp, attack, defense, specialAttack, specialDefense, speed] = species.stats
  const physical = attack >= specialAttack
  const fast = speed >= 80
  const bulky = hp + defense + specialDefense >= 270
  let natureId
  let values

  if (bulky && !fast) {
    natureId = defense >= specialDefense ? 'Impish' : 'Careful'
    values = defense >= specialDefense ? [32, 0, 32, 0, 2, 0] : [32, 0, 2, 0, 32, 0]
  } else if (physical) {
    natureId = fast ? 'Jolly' : 'Adamant'
    values = fast ? [2, 32, 0, 0, 0, 32] : [32, 32, 2, 0, 0, 0]
  } else {
    natureId = fast ? 'Timid' : 'Modest'
    values = fast ? [2, 0, 0, 32, 0, 32] : [32, 0, 2, 32, 0, 0]
  }

  return {
    natureId,
    nature: NATURE_LABELS[natureId],
    trainingPoints: normalizeTrainingPoints(values),
  }
}

function offenseStyle(species) {
  if (species.stats[1] >= species.stats[3] + 15) return 'physical'
  if (species.stats[3] >= species.stats[1] + 15) return 'special'
  return 'mixed'
}

function inferRole(moveIds, species, trainingPoints) {
  const moves = moveIds.map((moveId) => moveById.get(moveId)).filter(Boolean)
  const physicalCount = moves.filter((move) => move.categoryId === 'physical' && move.power > 0).length
  const specialCount = moves.filter((move) => move.categoryId === 'special' && move.power > 0).length
  const statusCount = moves.filter((move) => move.categoryId === 'status').length

  if (moveIds.some((moveId) => HAZARD_MOVES.has(moveId))) return '선봉·필드 전개'
  if (moveIds.some((moveId) => SETUP_MOVES.has(moveId))) return physicalCount >= specialCount ? '물리 스위퍼' : '특수 스위퍼'
  if (moveIds.some((moveId) => RECOVERY_MOVES.has(moveId)) && statusCount >= 2) return '내구·지원'
  if (moveIds.some((moveId) => PIVOT_MOVES.has(moveId))) return '대면 조작·교대'
  if (physicalCount >= 3 || trainingPoints.attack >= 30) return '물리 어태커'
  if (specialCount >= 3 || trainingPoints.specialAttack >= 30) return '특수 어태커'
  if (statusCount >= 2 || species.stats[0] + species.stats[2] + species.stats[4] >= 300) return '서포터'
  return '밸런스'
}

await fs.mkdir(cacheDir, { recursive: true })

for (const source of STAT_SOURCES) {
  await ensureRemoteFile(path.join(cacheDir, `${source.id}.json.gz`), source.url)
}
for (const source of SHOWDOWN_SOURCES) {
  await ensureRemoteFile(path.join(cacheDir, source.file), source.url)
}

const [pokemonData, moveData, trainerData, showdownPokedex, showdownLearnsets] = await Promise.all([
  readJson(pokemonDataPath),
  readJson(moveDataPath),
  readJson(trainerDataPath),
  readJson(path.join(cacheDir, 'showdown-pokedex.json')),
  readJson(path.join(cacheDir, 'showdown-learnsets.json')),
])

const localProfiles = [...pokemonData.species, ...pokemonData.forms]
const profileById = new Map(localProfiles.map((profile) => [profile.id, profile]))
const moveById = new Map(moveData.moves.map((move) => [move.id, move]))
const itemById = new Map(generatedBattleItems.map((item) => [item.id, item]))
const itemByShowdownId = new Map()
for (const item of generatedBattleItems) {
  itemByShowdownId.set(toId(item.id), item)
  itemByShowdownId.set(toId(item.englishName), item)
}

const megaOptionsByDexId = new Map()
for (const form of pokemonData.forms.filter((profile) => profile.slug.includes('-mega'))) {
  const showdownProfile = showdownPokedex[toId(form.slug)]
  const zaMegaStone = getZaMegaStoneByFormSlug(form.slug)
  const heldItem = zaMegaStone
    ? itemById.get(zaMegaStone.id)
    : itemByShowdownId.get(toId(showdownProfile?.requiredItem))
  const requiredMoveId = toId(showdownProfile?.requiredMove)
  if (zaMegaStone && !heldItem) throw new Error(`Unavailable Z-A Mega Stone: ${zaMegaStone.id}`)
  if (!heldItem && (!requiredMoveId || !moveById.has(requiredMoveId))) continue

  const options = megaOptionsByDexId.get(form.parentSpeciesId) ?? []
  options.push({
    type: 'mega-evolution',
    targetForm: form,
    heldItem,
    requiredMoveId: requiredMoveId || null,
    isZaMega: isZaMegaForm(form.slug),
  })
  megaOptionsByDexId.set(form.parentSpeciesId, options)
}
for (const options of megaOptionsByDexId.values()) {
  options.sort((left, right) => left.targetForm.slug.localeCompare(right.targetForm.slug))
}
const megaStoneItemIds = new Set(
  [...megaOptionsByDexId.values()]
    .flat()
    .map((option) => option.heldItem?.id)
    .filter(Boolean),
)
const zCrystalItemIds = new Set(
  generatedBattleItems
    .filter((item) => item.sourceCategory === 'z-crystals')
    .map((item) => item.id),
)

const gmaxOptionByBaseSlug = new Map()
for (const form of pokemonData.forms.filter((profile) => profile.slug.endsWith('-gmax'))) {
  let baseSlug = form.slug.slice(0, -'-gmax'.length)
  if (baseSlug === 'toxtricity-amped') baseSlug = 'toxtricity'
  if (baseSlug === 'urshifu-single-strike') baseSlug = 'urshifu'
  gmaxOptionByBaseSlug.set(baseSlug, { type: 'gigantamax', targetForm: form })
}

const primalOptionByBaseSlug = new Map([
  ['groudon', {
    type: 'primal-reversion',
    targetForm: profileById.get(10078),
    heldItem: itemById.get('red-orb'),
  }],
  ['kyogre', {
    type: 'primal-reversion',
    targetForm: profileById.get(10077),
    heldItem: itemById.get('blue-orb'),
  }],
])

const showdownIdsByNumber = new Map()
for (const [showdownId, profile] of Object.entries(showdownPokedex)) {
  const ids = showdownIdsByNumber.get(profile.num) ?? []
  ids.push(showdownId)
  showdownIdsByNumber.set(profile.num, ids)
}

const loadedStats = await Promise.all(STAT_SOURCES.map(async (source) => {
  const compressed = await fs.readFile(path.join(cacheDir, `${source.id}.json.gz`))
  const data = JSON.parse(zlib.gunzipSync(compressed))
  return {
    ...source,
    entries: new Map(Object.entries(data.data).map(([name, entry]) => [toId(name), entry])),
  }
}))

function showdownCandidates(slot) {
  const localProfile = profileById.get(slot.speciesId)
  const exactId = toId(localProfile?.slug ?? slot.slug)
  const sameNumber = showdownIdsByNumber.get(slot.dexSpeciesId) ?? []
  const rankedSameNumber = [...sameNumber].sort((left, right) => (
    Number(right === exactId) - Number(left === exactId)
    || Number(toId(showdownPokedex[right]?.name) === exactId) - Number(toId(showdownPokedex[left]?.name) === exactId)
  ))

  return unique([
    exactId,
    toId(slot.slug),
    SHOWDOWN_ALIASES[exactId],
    ...rankedSameNumber,
  ])
}

function findStats(slot) {
  const candidates = showdownCandidates(slot)

  for (const source of loadedStats) {
    for (const showdownId of candidates) {
      const entry = source.entries.get(showdownId)
      if (entry) return { source, showdownId, entry }
    }
  }

  return null
}

function findExactStats(slot) {
  const localProfile = profileById.get(slot.speciesId)
  const exactId = toId(localProfile?.slug ?? slot.slug)

  for (const source of loadedStats) {
    const entry = source.entries.get(exactId)
    if (entry) return { source, showdownId: exactId, entry }
  }

  return null
}

function addLearnsetMoves(moveIds, showdownId) {
  const entry = showdownLearnsets[showdownId]
  for (const moveId of Object.keys(entry?.learnset ?? {})) {
    if (moveById.has(moveId)) moveIds.add(moveId)
  }

  const baseSpeciesId = toId(showdownPokedex[showdownId]?.baseSpecies)
  if (baseSpeciesId && baseSpeciesId !== showdownId) {
    for (const moveId of Object.keys(showdownLearnsets[baseSpeciesId]?.learnset ?? {})) {
      if (moveById.has(moveId)) moveIds.add(moveId)
    }
  }
}

function legalMovesFor(slot) {
  if (toId(slot.slug) === 'smeargle') {
    return new Set([...moveById.keys()].filter((moveId) => isBattleMoveSupported(moveById.get(moveId))))
  }
  const legalMoveIds = new Set()
  for (const showdownId of showdownCandidates(slot)) addLearnsetMoves(legalMoveIds, showdownId)
  return new Set([...legalMoveIds].filter((moveId) => isBattleMoveSupported(moveById.get(moveId))))
}

function abilityFor(species, statsResult) {
  const exactShowdownId = toId(species.slug)
  const showdownId = showdownPokedex[exactShowdownId]
    ? exactShowdownId
    : statsResult?.showdownId
  const showdownProfile = showdownPokedex[showdownId]
  const englishAbilities = Object.values(showdownProfile?.abilities ?? {})
  const usageAbilityIds = sortedWeights(statsResult?.entry?.Abilities).map(([abilityId]) => abilityId)
  const fallbackAbilityIds = [...ABILITY_PRIORITY, ...englishAbilities.map(toId)]
  const abilityId = [...usageAbilityIds, ...fallbackAbilityIds].find((candidate) => (
    englishAbilities.some((abilityName) => toId(abilityName) === candidate)
  )) ?? toId(englishAbilities[0])
  const abilityIndex = Math.max(0, englishAbilities.findIndex((abilityName) => toId(abilityName) === abilityId))

  return {
    abilityId,
    ability: species.abilities[abilityIndex] ?? species.abilities[0],
  }
}

function spreadFor(species, statsResult) {
  for (const [spreadKey] of sortedWeights(statsResult?.entry?.Spreads)) {
    const spread = parseSpread(spreadKey, species)
    if (spread) return spread
  }
  return fallbackSpread(species)
}

function fallbackItemIds(species) {
  const style = offenseStyle(species)
  const bulky = species.stats[0] + species.stats[2] + species.stats[4] >= 285
  if (bulky) return ['leftovers', 'rockyhelmet', 'sitrusberry', 'assaultvest', 'airballoon', 'lumberry']
  if (style === 'physical') return ['lifeorb', 'choiceband', 'choicescarf', 'focussash', 'expertbelt', 'lumberry']
  if (style === 'special') return ['lifeorb', 'choicespecs', 'choicescarf', 'focussash', 'expertbelt', 'airballoon']
  return ['lifeorb', 'focussash', 'leftovers', 'choicescarf', 'expertbelt', 'sitrusberry']
}

function itemFor(species, statsResult, usedItems, forcedItem = null) {
  if (forcedItem) {
    if (!itemById.has(forcedItem.id)) throw new Error(`Unavailable forced item: ${forcedItem.id}`)
    if (usedItems.has(forcedItem.id)) throw new Error(`Duplicate forced item: ${forcedItem.id}`)
    usedItems.add(forcedItem.id)
    return forcedItem
  }

  const usageIds = sortedWeights(statsResult?.entry?.Items)
    .map(([itemId]) => itemId)
    .filter((itemId) => itemId !== 'nothing')
  const candidateIds = unique([...usageIds, ...fallbackItemIds(species), ...itemByShowdownId.keys()])

  for (const candidateId of candidateIds) {
    const item = itemByShowdownId.get(candidateId)
    if (!item || usedItems.has(item.id) || megaStoneItemIds.has(item.id) || zCrystalItemIds.has(item.id)) continue
    usedItems.add(item.id)
    return item
  }

  throw new Error(`No held item available for ${species.slug}`)
}

function fallbackMoveScore(move, species, style) {
  const stabBonus = species.types.includes(move.type) ? 65 : 0
  const styleBonus = move.categoryId === style ? 30 : style === 'mixed' && move.categoryId !== 'status' ? 15 : 0
  const accuracyPenalty = typeof move.accuracy === 'number' ? Math.max(0, 100 - move.accuracy) : 0
  const priorityBonus = Math.max(0, move.priority) * 10
  if (move.categoryId === 'status') return UTILITY_SCORE.get(move.id) ?? 35
  return move.power + stabBonus + styleBonus + priorityBonus - accuracyPenalty
}

function preferredStyle(species, trainingPoints) {
  if (trainingPoints.attack >= trainingPoints.specialAttack + 12) return 'physical'
  if (trainingPoints.specialAttack >= trainingPoints.attack + 12) return 'special'
  return offenseStyle(species)
}

function usageMoveMultiplier(move, itemKey, style) {
  if (!move) return 0
  let multiplier = 1
  const isOppositeDamage = move.categoryId !== 'status'
    && !PIVOT_MOVES.has(move.id)
    && style !== 'mixed'
    && move.categoryId !== style
  if (isOppositeDamage) multiplier *= 0.22

  if (itemKey === 'lifeorb') {
    if (HAZARD_MOVES.has(move.id) || RECOVERY_MOVES.has(move.id) || PHAZING_MOVES.has(move.id)) multiplier *= 0.08
    if (SETUP_MOVES.has(move.id)) multiplier *= 1.35
  }

  if (CHOICE_ITEM_IDS.has(itemKey) || itemKey === 'assaultvest') {
    if (isOppositeDamage) multiplier *= 0.2
  }

  if (itemKey === 'focussash' || itemKey === 'mentalherb') {
    if (HAZARD_MOVES.has(move.id)) multiplier *= 1.4
  }

  if (['leftovers', 'rockyhelmet', 'blacksludge', 'sitrusberry'].includes(itemKey)) {
    if (RECOVERY_MOVES.has(move.id) || HAZARD_MOVES.has(move.id)) multiplier *= 1.2
  }

  return multiplier
}

function moveCandidates(species, statsResult, legalMoveIds, itemKey, trainingPoints) {
  const style = preferredStyle(species, trainingPoints)
  const usageMoves = sortedWeights(statsResult?.entry?.Moves)
    .map(([moveId, weight]) => ({
      moveId,
      weight: Number(weight) * usageMoveMultiplier(moveById.get(moveId), itemKey, style),
      fromUsage: true,
    }))
    .filter(({ moveId }) => moveId !== 'nothing' && moveById.has(moveId) && legalMoveIds.has(moveId))
    .sort((left, right) => right.weight - left.weight)
  const fallbackMoves = [...legalMoveIds]
    .map((moveId) => ({
      moveId,
      weight: fallbackMoveScore(moveById.get(moveId), species, style),
      fromUsage: false,
    }))
    .sort((left, right) => right.weight - left.weight)

  return [...usageMoves, ...fallbackMoves]
}

function chooseMoves(species, statsResult, legalMoveIds, item, trainingPoints) {
  const selected = []
  const itemKey = toId(item.englishName || item.id)
  const style = preferredStyle(species, trainingPoints)
  const candidates = moveCandidates(species, statsResult, legalMoveIds, itemKey, trainingPoints)
  const statusLocked = STATUS_LOCK_ITEM_IDS.has(itemKey)
  const strictOffense = statusLocked || itemKey === 'lifeorb'
  const preferredDamageCount = candidates.filter(({ moveId }) => moveById.get(moveId)?.categoryId === style).length
  let setupCount = 0
  let recoveryCount = 0
  let hazardCount = 0
  const damagingTypes = new Set()

  for (const candidate of candidates) {
    if (selected.includes(candidate.moveId)) continue
    const move = moveById.get(candidate.moveId)
    if (!move) continue
    if (statusLocked && move.categoryId === 'status' && !['trick', 'switcheroo'].includes(move.id)) continue
    if (itemKey === 'lifeorb' && (HAZARD_MOVES.has(move.id) || RECOVERY_MOVES.has(move.id) || PHAZING_MOVES.has(move.id))) continue
    if (strictOffense && style !== 'mixed' && move.categoryId !== 'status' && !PIVOT_MOVES.has(move.id) && move.categoryId !== style && preferredDamageCount >= 4) continue
    if (SETUP_MOVES.has(move.id) && setupCount >= 1) continue
    if (RECOVERY_MOVES.has(move.id) && recoveryCount >= 1) continue
    if (HAZARD_MOVES.has(move.id) && hazardCount >= 2) continue
    if (
      move.power > 0
      && damagingTypes.has(move.typeId)
      && !PIVOT_MOVES.has(move.id)
      && move.priority <= 0
      && candidates.some(({ moveId }) => {
        const alternative = moveById.get(moveId)
        return alternative?.power > 0 && !damagingTypes.has(alternative.typeId)
      })
    ) continue

    selected.push(move.id)
    if (move.power > 0 && !PIVOT_MOVES.has(move.id)) damagingTypes.add(move.typeId)
    if (SETUP_MOVES.has(move.id)) setupCount += 1
    if (RECOVERY_MOVES.has(move.id)) recoveryCount += 1
    if (HAZARD_MOVES.has(move.id)) hazardCount += 1
    if (selected.length === 4) break
  }

  for (const candidate of candidates) {
    if (selected.length === 4) break
    if (!selected.includes(candidate.moveId)) selected.push(candidate.moveId)
  }

  const damagingMoves = candidates.filter(({ moveId }) => {
    const move = moveById.get(moveId)
    return move && move.categoryId !== 'status' && move.power > 0
  })
  if (!selected.some((moveId) => moveById.get(moveId)?.power > 0) && damagingMoves.length > 0) {
    selected[selected.length - 1] = damagingMoves[0].moveId
  }

  if (selected.length !== 4) throw new Error(`Could not assign four moves to ${species.slug}`)
  return unique(selected).slice(0, 4)
}

function teraTypeFor(species, statsResult) {
  const usageTeraType = sortedWeights(statsResult?.entry?.['Tera Types'])
    .map(([typeId]) => typeId)
    .find((typeId) => typeId !== 'nothing' && TYPE_LABELS[typeId])
  return TYPE_LABELS[usageTeraType] ?? species.types[0]
}

function orderedMechanicContexts(trainer, contexts, usedTargetIndexes) {
  return contexts
    .filter((context) => !usedTargetIndexes.has(context.index))
    .sort((left, right) => (
      Number(right.slot.slug === trainer.ace?.slug) - Number(left.slot.slug === trainer.ace?.slug)
      || left.index - right.index
    ))
}

function transitionPlan(option, context) {
  return {
    type: option.type,
    label: MECHANIC_LABELS[option.type],
    targetIndex: context.index,
    pokemonSlug: context.slot.slug,
    pokemonName: context.slot.name,
    targetFormId: option.targetForm.id,
    targetFormSlug: option.targetForm.slug,
    targetFormName: option.targetForm.name,
    targetAbility: option.targetForm.abilities[0],
    ...(option.heldItem ? {
      heldItemId: option.heldItem.id,
      heldItemName: option.heldItem.name,
    } : {}),
    ...(option.requiredMoveId ? {
      requiredMoveId: option.requiredMoveId,
      requiredMoveName: moveById.get(option.requiredMoveId).name,
    } : {}),
    _forcedItem: option.heldItem ?? null,
    _requiredMoveId: option.requiredMoveId ?? null,
  }
}

function megaPlanFor(trainer, team, contexts, usedTargetIndexes) {
  for (const context of orderedMechanicContexts(trainer, contexts, usedTargetIndexes)) {
    const options = (megaOptionsByDexId.get(context.slot.dexSpeciesId) ?? [])
      .filter((option) => isBattleFormCompatible(context.species, option.targetForm))
      .filter((option) => !option.requiredMoveId || context.legalMoveIds.has(option.requiredMoveId))
      .sort((left, right) => (
        trainer.region === 'za'
          ? Number(right.isZaMega) - Number(left.isZaMega)
          : 0
      ) || left.targetForm.slug.localeCompare(right.targetForm.slug))
    if (options.length === 0) continue
    return transitionPlan(options[(team.number - 1) % options.length], context)
  }
  return null
}

function primalPlanFor(trainer, contexts, usedTargetIndexes) {
  for (const context of orderedMechanicContexts(trainer, contexts, usedTargetIndexes)) {
    const option = primalOptionByBaseSlug.get(context.slot.slug)
    if (option?.targetForm && option.heldItem) return transitionPlan(option, context)
  }
  return null
}

function zMovePlanFor(trainer, contexts, usedTargetIndexes) {
  const orderedContexts = orderedMechanicContexts(trainer, contexts, usedTargetIndexes)
    .sort((left, right) => (
      Number(Boolean(signatureZConfigFor(trainer.name, right.slot.slug)))
      - Number(Boolean(signatureZConfigFor(trainer.name, left.slot.slug)))
    ))

  for (const context of orderedContexts) {
    const configuredSignature = signatureZConfigFor(trainer.name, context.slot.slug)
    if (
      configuredSignature
      && itemById.has(configuredSignature.itemId)
      && moveById.has(configuredSignature.moveId)
      && context.legalMoveIds.has(configuredSignature.moveId)
    ) {
      const heldItem = itemById.get(configuredSignature.itemId)
      const move = moveById.get(configuredSignature.moveId)
      return {
        type: 'z-move',
        label: MECHANIC_LABELS['z-move'],
        targetIndex: context.index,
        pokemonSlug: context.slot.slug,
        pokemonName: context.slot.name,
        heldItemId: heldItem.id,
        heldItemName: heldItem.name,
        baseMoveId: move.id,
        baseMoveName: move.name,
        moveType: move.type,
        signatureZ: true,
        _forcedItem: heldItem,
        _requiredMoveId: move.id,
      }
    }

    const style = preferredStyle(context.species, context.spread.trainingPoints)
    const candidate = moveCandidates(
      context.species,
      context.statsResult,
      context.legalMoveIds,
      'zcrystal',
      context.spread.trainingPoints,
    )
      .map((entry, index) => {
        const move = moveById.get(entry.moveId)
        const stabBonus = context.species.types.includes(move?.type) ? 220 : 0
        const styleBonus = move?.categoryId === style || style === 'mixed' ? 60 : 0
        const accuracyPenalty = typeof move?.accuracy === 'number' ? Math.max(0, 100 - move.accuracy) : 0
        return {
          ...entry,
          move,
          score: (move?.power ?? 0) * 4 + stabBonus + styleBonus - accuracyPenalty + Math.max(0, 100 - index),
        }
      })
      .filter(({ move }) => move?.power > 0 && itemById.has(Z_CRYSTAL_ITEM_IDS[move.typeId]))
      .sort((left, right) => right.score - left.score)[0]
    if (!candidate) continue

    const move = candidate.move
    const heldItem = itemById.get(Z_CRYSTAL_ITEM_IDS[move.typeId])
    return {
      type: 'z-move',
      label: MECHANIC_LABELS['z-move'],
      targetIndex: context.index,
      pokemonSlug: context.slot.slug,
      pokemonName: context.slot.name,
      heldItemId: heldItem.id,
      heldItemName: heldItem.name,
      baseMoveId: move.id,
      baseMoveName: move.name,
      moveType: move.type,
      _forcedItem: heldItem,
      _requiredMoveId: move.id,
    }
  }
  return null
}

function dynamaxPlanFor(trainer, contexts, usedTargetIndexes) {
  const candidates = orderedMechanicContexts(trainer, contexts, usedTargetIndexes)
    .filter((context) => !NON_DYNAMAX_DEX_IDS.has(context.slot.dexSpeciesId))
  const gmaxContext = candidates.find((context) => gmaxOptionByBaseSlug.has(context.slot.slug))

  if (gmaxContext) {
    const option = gmaxOptionByBaseSlug.get(gmaxContext.slot.slug)
    return {
      type: 'gigantamax',
      label: MECHANIC_LABELS.gigantamax,
      targetIndex: gmaxContext.index,
      pokemonSlug: gmaxContext.slot.slug,
      pokemonName: gmaxContext.slot.name,
      targetFormId: option.targetForm.id,
      targetFormSlug: option.targetForm.slug,
      targetFormName: option.targetForm.name,
      targetAbility: option.targetForm.abilities[0],
      _forcedItem: null,
      _requiredMoveId: null,
    }
  }

  const context = candidates[0]
  if (!context) return null
  return {
    type: 'dynamax',
    label: MECHANIC_LABELS.dynamax,
    targetIndex: context.index,
    pokemonSlug: context.slot.slug,
    pokemonName: context.slot.name,
    _forcedItem: null,
    _requiredMoveId: null,
  }
}

function teraPlanFor(trainer, contexts, usedTargetIndexes) {
  const context = orderedMechanicContexts(trainer, contexts, usedTargetIndexes)[0]
    ?? orderedMechanicContexts(trainer, contexts, new Set())[0]
  if (!context) return null
  return {
    type: 'terastallization',
    label: MECHANIC_LABELS.terastallization,
    targetIndex: context.index,
    pokemonSlug: context.slot.slug,
    pokemonName: context.slot.name,
    teraType: context.teraType,
    _forcedItem: null,
    _requiredMoveId: null,
  }
}

function planBattleMechanics(trainer, team, contexts) {
  const preferences = unique(
    trainer.mechanicPreferences?.length
      ? trainer.mechanicPreferences
      : mechanicPreferencesFor(trainer.name, trainer.region),
  )
  const plans = []
  const usedTargetIndexes = new Set()

  for (const preference of preferences) {
    let plan = null
    if (preference === 'mega-evolution') plan = megaPlanFor(trainer, team, contexts, usedTargetIndexes)
    if (preference === 'primal-reversion') plan = primalPlanFor(trainer, contexts, usedTargetIndexes)
    if (preference === 'z-move') plan = zMovePlanFor(trainer, contexts, usedTargetIndexes)
    if (preference === 'dynamax') plan = dynamaxPlanFor(trainer, contexts, usedTargetIndexes)
    if (preference === 'terastallization') plan = teraPlanFor(trainer, contexts, usedTargetIndexes)
    if (!plan) continue
    plans.push(plan)
    usedTargetIndexes.add(plan.targetIndex)
  }

  if (plans.length === 0) {
    const fallbackPlan = teraPlanFor(trainer, contexts, usedTargetIndexes)
    if (fallbackPlan) plans.push(fallbackPlan)
  }

  return plans
}

function ensureRequiredMoves(loadout) {
  for (const requiredMoveId of loadout._requiredMoveIds) {
    if (loadout.moveIds.includes(requiredMoveId)) continue
    if (!loadout._legalMoveIds.has(requiredMoveId)) {
      throw new Error(`${loadout.slug} cannot learn required move ${requiredMoveId}`)
    }

    const replaceIndex = loadout.moveIds
      .map((moveId, index) => ({
        index,
        move: moveById.get(moveId),
        required: loadout._requiredMoveIds.has(moveId),
        protected: HAZARD_MOVES.has(moveId) || REMOVAL_MOVES.has(moveId) || RECOVERY_MOVES.has(moveId) || SETUP_MOVES.has(moveId),
      }))
      .filter(({ required }) => !required)
      .sort((left, right) => Number(left.protected) - Number(right.protected) || (left.move?.power ?? 0) - (right.move?.power ?? 0))[0]?.index
    if (replaceIndex === undefined) throw new Error(`No move slot available for ${loadout.slug}`)
    loadout.moveIds[replaceIndex] = requiredMoveId
    loadout.moves[replaceIndex] = moveById.get(requiredMoveId).name
  }
}

function serializeBattleGimmick(plan) {
  return Object.fromEntries(Object.entries(plan).filter(([key]) => !key.startsWith('_') && key !== 'targetIndex'))
}

function strategyFor(loadouts, battleGimmicks) {
  const lead = loadouts.find((loadout) => loadout.role === '선봉·필드 전개')
    ?? loadouts.find((loadout) => loadout.role === '대면 조작·교대')
    ?? loadouts[0]
  const remover = loadouts.find((loadout) => loadout.moveIds.some((moveId) => REMOVAL_MOVES.has(moveId)))
  const finishers = battleGimmicks.map((gimmick) => `${gimmick.pokemonName}의 ${gimmick.label}`)
  const supportText = remover && remover.slug !== lead.slug
    ? `${remover.name}의 필드 정리로 전개를 유지하고, `
    : ''

  return {
    lead: lead.name,
    winConditions: finishers,
    summary: `${lead.name}로 초반 주도권을 잡고, ${supportText}${finishers.join('·')}을 승리 수단으로 운용합니다.`,
  }
}

function replaceMove(loadout, moveId) {
  if (loadout.moveIds.includes(moveId) || !loadout._legalMoveIds.has(moveId)) return false
  if (STATUS_LOCK_ITEM_IDS.has(loadout._itemKey)) return false
  const replaceIndex = loadout.moveIds
    .map((currentMoveId, index) => ({
      index,
      move: moveById.get(currentMoveId),
      protected: HAZARD_MOVES.has(currentMoveId) || REMOVAL_MOVES.has(currentMoveId) || RECOVERY_MOVES.has(currentMoveId) || SETUP_MOVES.has(currentMoveId),
      required: loadout._requiredMoveIds?.has(currentMoveId),
    }))
    .filter(({ required }) => !required)
    .sort((left, right) => Number(left.protected) - Number(right.protected) || (left.move?.power ?? 0) - (right.move?.power ?? 0))[0]?.index
  if (replaceIndex === undefined) return false
  loadout.moveIds[replaceIndex] = moveId
  loadout.moves[replaceIndex] = moveById.get(moveId).name
  return true
}

function replaceMoveAt(loadout, replaceIndex, moveId) {
  if (loadout.moveIds.includes(moveId) || !loadout._legalMoveIds.has(moveId)) return false
  if (loadout._requiredMoveIds?.has(loadout.moveIds[replaceIndex])) return false
  const move = moveById.get(moveId)
  if (!move) return false
  if (STATUS_LOCK_ITEM_IDS.has(loadout._itemKey) && move.categoryId === 'status' && !['trick', 'switcheroo'].includes(moveId)) return false
  loadout.moveIds[replaceIndex] = moveId
  loadout.moves[replaceIndex] = move.name
  return true
}

function reduceRepeatedHazards(loadouts) {
  for (const hazardMoveId of HAZARD_MOVES) {
    const users = loadouts
      .filter((loadout) => loadout.moveIds.includes(hazardMoveId))
      .sort((left, right) => (
        (Number(right._statsEntry?.Moves?.[hazardMoveId]) || 0)
        - (Number(left._statsEntry?.Moves?.[hazardMoveId]) || 0)
      ))

    for (const loadout of users.slice(1)) {
      const replaceIndex = loadout.moveIds.indexOf(hazardMoveId)
      const alternative = loadout._candidateMoveIds.find((moveId) => (
        moveId !== hazardMoveId
        && !loadout.moveIds.includes(moveId)
        && !HAZARD_MOVES.has(moveId)
        && (!SETUP_MOVES.has(moveId) || !loadout.moveIds.some((currentMoveId) => SETUP_MOVES.has(currentMoveId)))
        && (!RECOVERY_MOVES.has(moveId) || !loadout.moveIds.some((currentMoveId) => RECOVERY_MOVES.has(currentMoveId)))
      ))
      if (alternative) replaceMoveAt(loadout, replaceIndex, alternative)
    }
  }
}

function utilityCandidate(loadouts, moveSet, excludedMoveIds = new Set()) {
  return loadouts
    .flatMap((loadout) => [...moveSet]
      .filter((moveId) => !excludedMoveIds.has(moveId) && loadout._legalMoveIds.has(moveId) && !loadout.moveIds.includes(moveId))
      .map((moveId) => ({
        loadout,
        moveId,
        usage: Number(loadout._statsEntry?.Moves?.[moveId]) || 0,
      })))
    .sort((left, right) => right.usage - left.usage || hashText(`${left.loadout.slug}:${left.moveId}`) - hashText(`${right.loadout.slug}:${right.moveId}`))[0]
}

function tuneTeamUtility(loadouts) {
  reduceRepeatedHazards(loadouts)

  if (!loadouts.some((loadout) => loadout.moveIds.some((moveId) => HAZARD_MOVES.has(moveId)))) {
    const candidate = utilityCandidate(loadouts, HAZARD_MOVES)
    if (candidate) replaceMove(candidate.loadout, candidate.moveId)
  }

  if (!loadouts.some((loadout) => loadout.moveIds.some((moveId) => REMOVAL_MOVES.has(moveId)))) {
    const candidate = utilityCandidate(loadouts, REMOVAL_MOVES, new Set(['defog']))
      ?? utilityCandidate(loadouts, REMOVAL_MOVES)
    if (candidate) replaceMove(candidate.loadout, candidate.moveId)
  }

  for (const weather of WEATHER_CONFIGS) {
    const hasSetter = loadouts.some((loadout) => (
      weather.setterAbilities.has(loadout.abilityId) || loadout.moveIds.includes(weather.moveId)
    ))
    const beneficiaries = loadouts.filter((loadout) => weather.beneficiaryAbilities.has(loadout.abilityId))
    if (hasSetter || beneficiaries.length < 2) continue

    const candidate = beneficiaries.find((loadout) => (
      loadout._legalMoveIds.has(weather.moveId) && !STATUS_LOCK_ITEM_IDS.has(loadout._itemKey)
    )) ?? loadouts.find((loadout) => (
      loadout._legalMoveIds.has(weather.moveId) && !STATUS_LOCK_ITEM_IDS.has(loadout._itemKey)
    ))
    if (candidate) replaceMove(candidate, weather.moveId)
  }

  for (const loadout of loadouts) {
    loadout.role = inferRole(loadout.moveIds, loadout._species, loadout.trainingPoints)
  }
}

function stripInternalFields(loadout) {
  return Object.fromEntries(Object.entries(loadout).filter(([key]) => !key.startsWith('_')))
}

function validateTrainerLoadouts(data) {
  const validNatureLabels = new Set(Object.values(NATURE_LABELS))
  const validTeraTypes = new Set(Object.values(TYPE_LABELS))
  const validSources = new Set([...STAT_SOURCES.map((source) => source.id), 'fallback'])
  const validMechanicTypes = new Set(Object.keys(MECHANIC_LABELS))
  const validatedGimmickCounts = Object.fromEntries([...validMechanicTypes].map((type) => [type, 0]))
  let slotCount = 0
  let teamCount = 0
  let legendaryTeamCount = 0

  for (const trainer of data.trainers) {
    if (trainer.teams.length !== 3) throw new Error(`${trainer.name}: expected three teams`)

    for (const team of trainer.teams) {
      teamCount += 1
      if (team.pokemon.length !== 6) throw new Error(`${trainer.name} team ${team.number}: expected six Pokemon`)
      if (!Array.isArray(team.battleGimmicks) || team.battleGimmicks.length === 0) {
        throw new Error(`${trainer.name} team ${team.number}: no battle gimmick`)
      }
      if (!team.strategy?.summary || team.strategy.winConditions?.length !== team.battleGimmicks.length) {
        throw new Error(`${trainer.name} team ${team.number}: invalid strategy`)
      }

      const legendaryPokemon = team.pokemon.filter((slot) => {
        const species = profileById.get(slot.speciesId)
        return species?.isLegendary || species?.isMythical
      })
      if (trainer.legendaryAssociation) {
        legendaryTeamCount += 1
        const associatedSlugs = new Set(trainer.legendaryAssociation.pokemon.map((pokemon) => pokemon.slug))
        if (legendaryPokemon.length !== 1 || !associatedSlugs.has(legendaryPokemon[0].slug)) {
          throw new Error(`${trainer.name} team ${team.number}: invalid associated legendary Pokemon`)
        }
      } else if (legendaryPokemon.length !== 0) {
        throw new Error(`${trainer.name} team ${team.number}: unexpected legendary Pokemon`)
      }

      const usedItems = new Set()

      for (const slot of team.pokemon) {
        slotCount += 1
        const species = profileById.get(slot.speciesId)
        const item = itemById.get(slot.heldItemId)
        const legalMoveIds = legalMovesFor(slot)
        const transformationGimmick = team.battleGimmicks.find((gimmick) => (
          gimmick.pokemonSlug === slot.slug
          && ['mega-evolution', 'primal-reversion'].includes(gimmick.type)
        ))
        const abilitySpecies = transformationGimmick
          ? profileById.get(transformationGimmick.targetFormId) ?? species
          : species
        if (!species) throw new Error(`${trainer.name}: unknown species ${slot.speciesId}`)
        if (!item || item.name !== slot.heldItemName) throw new Error(`${trainer.name} ${slot.name}: invalid held item`)
        if (usedItems.has(item.id)) throw new Error(`${trainer.name} team ${team.number}: duplicate held item ${item.name}`)
        usedItems.add(item.id)
        if (megaStoneItemIds.has(item.id) && !slot.battleMechanics.includes('mega-evolution')) {
          throw new Error(`${trainer.name} ${slot.name}: Mega Stone without Mega Evolution`)
        }
        if (zCrystalItemIds.has(item.id)) {
          const hasCompatibleZMove = slot.moveIds.some((moveId) => canUseZMove(moveById.get(moveId), {
            heldItemId: item.id,
            speciesSlug: slot.slug,
          }))
          if (!slot.battleMechanics.includes('z-move') || !hasCompatibleZMove) {
            throw new Error(`${trainer.name} ${slot.name}: Z-Crystal without compatible Z-Move`)
          }
        }
        if (!abilitySpecies.abilities.includes(slot.ability)) throw new Error(`${trainer.name} ${slot.name}: invalid ability ${slot.ability}`)
        if (!validNatureLabels.has(slot.nature) || NATURE_LABELS[slot.natureId] !== slot.nature) {
          throw new Error(`${trainer.name} ${slot.name}: invalid nature ${slot.nature}`)
        }
        if (!validTeraTypes.has(slot.teraType)) throw new Error(`${trainer.name} ${slot.name}: invalid Tera type`)
        const canDynamax = !NON_DYNAMAX_DEX_IDS.has(slot.dexSpeciesId)
        if (slot.canDynamax !== canDynamax) throw new Error(`${trainer.name} ${slot.name}: invalid Dynamax availability`)
        if (canDynamax && !['dynamax', 'gigantamax'].includes(slot.dynamaxMode)) {
          throw new Error(`${trainer.name} ${slot.name}: invalid Dynamax mode`)
        }
        if (!canDynamax && slot.dynamaxMode !== null) throw new Error(`${trainer.name} ${slot.name}: forbidden Dynamax mode`)
        if (!Array.isArray(slot.battleMechanics) || slot.battleMechanics.some((type) => !validMechanicTypes.has(type))) {
          throw new Error(`${trainer.name} ${slot.name}: invalid battle mechanic markers`)
        }
        if (!validSources.has(slot.setSource)) throw new Error(`${trainer.name} ${slot.name}: invalid set source`)
        if (slot.level !== 50) throw new Error(`${trainer.name} ${slot.name}: invalid level`)
        if (slot.moveIds.length !== 4 || new Set(slot.moveIds).size !== 4 || slot.moves.length !== 4) {
          throw new Error(`${trainer.name} ${slot.name}: invalid move count`)
        }

        slot.moveIds.forEach((moveId, index) => {
          const move = moveById.get(moveId)
          if (!move || move.name !== slot.moves[index]) throw new Error(`${trainer.name} ${slot.name}: invalid move ${moveId}`)
          if (!isBattleMoveSupported(move)) throw new Error(`${trainer.name} ${slot.name}: unsupported move ${moveId}`)
          if (!legalMoveIds.has(moveId) && toId(slot.slug) !== 'smeargle') {
            throw new Error(`${trainer.name} ${slot.name}: illegal move ${moveId}`)
          }
        })

        const trainingValues = STAT_KEYS.map((key) => Number(slot.trainingPoints[key]))
        if (trainingValues.some((value) => !Number.isInteger(value) || value < 0 || value > 32)) {
          throw new Error(`${trainer.name} ${slot.name}: invalid training points`)
        }
        if (trainingValues.reduce((total, value) => total + value, 0) !== 66) {
          throw new Error(`${trainer.name} ${slot.name}: training point total is not 66`)
        }

        const itemKey = toId(item.englishName || item.id)
        if (STATUS_LOCK_ITEM_IDS.has(itemKey) && slot.moveIds.some((moveId) => (
          moveById.get(moveId)?.categoryId === 'status' && !['trick', 'switcheroo'].includes(moveId)
        ))) {
          throw new Error(`${trainer.name} ${slot.name}: held item conflicts with status move`)
        }
      }

      const usedGimmickTargets = new Set()
      for (const gimmick of team.battleGimmicks) {
        const target = team.pokemon.find((slot) => slot.slug === gimmick.pokemonSlug)
        if (!target || target.name !== gimmick.pokemonName) {
          throw new Error(`${trainer.name} team ${team.number}: invalid ${gimmick.type} target`)
        }
        if (!validMechanicTypes.has(gimmick.type) || gimmick.label !== MECHANIC_LABELS[gimmick.type]) {
          throw new Error(`${trainer.name} team ${team.number}: invalid gimmick type ${gimmick.type}`)
        }
        if (usedGimmickTargets.has(target.slug)) {
          throw new Error(`${trainer.name} team ${team.number}: repeated gimmick target ${target.name}`)
        }
        usedGimmickTargets.add(target.slug)
        validatedGimmickCounts[gimmick.type] += 1

        if (gimmick.type === 'mega-evolution') {
          const option = (megaOptionsByDexId.get(target.dexSpeciesId) ?? [])
            .find((candidate) => candidate.targetForm.id === gimmick.targetFormId)
          if (!option || !isBattleFormCompatible(profileById.get(target.speciesId), option.targetForm)) {
            throw new Error(`${trainer.name} ${target.name}: invalid Mega Evolution form`)
          }
          if (option.heldItem && target.heldItemId !== option.heldItem.id) {
            throw new Error(`${trainer.name} ${target.name}: missing Mega Stone`)
          }
          if (option.requiredMoveId && !target.moveIds.includes(option.requiredMoveId)) {
            throw new Error(`${trainer.name} ${target.name}: missing Mega Evolution move`)
          }
        }

        if (gimmick.type === 'primal-reversion') {
          const option = primalOptionByBaseSlug.get(target.slug)
          if (!option || option.targetForm.id !== gimmick.targetFormId || target.heldItemId !== option.heldItem.id) {
            throw new Error(`${trainer.name} ${target.name}: invalid Primal Reversion`)
          }
        }

        if (gimmick.type === 'z-move') {
          const baseMove = moveById.get(gimmick.baseMoveId)
          const signatureConfig = signatureZConfigFor(trainer.name, target.slug)
          const expectedItemId = gimmick.signatureZ
            ? signatureConfig?.itemId
            : Z_CRYSTAL_ITEM_IDS[baseMove?.typeId]
          const validBaseMove = gimmick.signatureZ
            ? signatureConfig?.moveId === baseMove?.id
            : baseMove?.power > 0
          if (
            !baseMove
            || !validBaseMove
            || !target.moveIds.includes(baseMove.id)
            || target.heldItemId !== expectedItemId
            || gimmick.heldItemId !== expectedItemId
            || !canUseZMove(baseMove, { heldItemId: expectedItemId, speciesSlug: target.slug })
          ) {
            throw new Error(`${trainer.name} ${target.name}: invalid Z-Move setup`)
          }
        }

        if (gimmick.type === 'dynamax') {
          if (!target.canDynamax || target.dynamaxMode !== 'dynamax') {
            throw new Error(`${trainer.name} ${target.name}: invalid Dynamax setup`)
          }
        }

        if (gimmick.type === 'gigantamax') {
          const option = gmaxOptionByBaseSlug.get(target.slug)
          if (!option || option.targetForm.id !== gimmick.targetFormId || target.dynamaxMode !== 'gigantamax') {
            throw new Error(`${trainer.name} ${target.name}: invalid Gigantamax setup`)
          }
        }

        if (gimmick.type === 'terastallization' && target.teraType !== gimmick.teraType) {
          throw new Error(`${trainer.name} ${target.name}: invalid Terastallization setup`)
        }
      }

      for (const slot of team.pokemon) {
        const expectedMechanics = team.battleGimmicks
          .filter((gimmick) => gimmick.pokemonSlug === slot.slug)
          .map((gimmick) => gimmick.type)
          .sort()
        if (JSON.stringify([...slot.battleMechanics].sort()) !== JSON.stringify(expectedMechanics)) {
          throw new Error(`${trainer.name} ${slot.name}: battle mechanic marker mismatch`)
        }
      }
    }
  }

  if (slotCount !== data.slotCount) throw new Error(`Expected ${data.slotCount} slots, validated ${slotCount}`)
  if (teamCount !== data.teamCount || data.battleGimmickTeamCount !== teamCount) {
    throw new Error(`Battle gimmick team count mismatch: ${teamCount}`)
  }
  if (legendaryTeamCount !== data.legendaryTeamCount) {
    throw new Error(`Legendary team count mismatch: ${legendaryTeamCount}`)
  }
  if (JSON.stringify(validatedGimmickCounts) !== JSON.stringify(data.battleGimmickCounts)) {
    throw new Error('Battle gimmick count mismatch')
  }
  const coverageTotal = Object.values(coverage).reduce((total, count) => total + count, 0)
  if (coverageTotal !== data.slotCount) throw new Error(`Coverage total mismatch: ${coverageTotal}`)
}

const coverage = Object.fromEntries(STAT_SOURCES.map((source) => [source.id, 0]))
coverage.fallback = 0

for (const trainer of trainerData.trainers) {
  for (const team of trainer.teams) {
    const contexts = team.pokemon.map((slot, index) => {
      const species = profileById.get(slot.speciesId)
      if (!species) throw new Error(`Unknown species id: ${slot.speciesId}`)
      const statsResult = findStats(slot)
      const legalMoveIds = legalMovesFor(slot)
      const spread = spreadFor(species, statsResult)

      return {
        index,
        slot,
        species,
        statsResult,
        legalMoveIds,
        spread,
        ability: abilityFor(species, statsResult),
        teraType: teraTypeFor(species, statsResult),
      }
    })
    const mechanicPlans = planBattleMechanics(trainer, team, contexts)
    const usedItems = new Set()
    const loadouts = contexts.map((context) => {
      const { index, slot, species, statsResult, legalMoveIds, teraType } = context
      const targetPlans = mechanicPlans.filter((plan) => plan.targetIndex === index)
      const transformationPlan = targetPlans.find((plan) => ['mega-evolution', 'primal-reversion'].includes(plan.type))
      const strategySpecies = transformationPlan ? profileById.get(transformationPlan.targetFormId) ?? species : species
      const strategyStatsResult = transformationPlan
        ? findExactStats({
            ...slot,
            speciesId: transformationPlan.targetFormId,
            slug: transformationPlan.targetFormSlug,
          }) ?? findStats({
            ...slot,
            speciesId: transformationPlan.targetFormId,
            slug: transformationPlan.targetFormSlug,
          }) ?? statsResult
        : statsResult
      const spread = spreadFor(strategySpecies, strategyStatsResult)
      const ability = abilityFor(strategySpecies, strategyStatsResult)
      const forcedItem = targetPlans.find((plan) => plan._forcedItem)?._forcedItem ?? null
      const item = itemFor(strategySpecies, strategyStatsResult, usedItems, forcedItem)
      const moveIds = chooseMoves(strategySpecies, strategyStatsResult, legalMoveIds, item, spread.trainingPoints)
      const itemKey = toId(item.englishName || item.id)
      const sourceId = strategyStatsResult?.source.id ?? 'fallback'
      coverage[sourceId] += 1

      return {
        ...slot,
        level: 50,
        role: inferRole(moveIds, strategySpecies, spread.trainingPoints),
        ability: ability.ability,
        abilityId: ability.abilityId,
        nature: spread.nature,
        natureId: spread.natureId,
        trainingPoints: spread.trainingPoints,
        heldItemId: item.id,
        heldItemName: item.name,
        moves: moveIds.map((moveId) => moveById.get(moveId).name),
        moveIds,
        teraType,
        canDynamax: !NON_DYNAMAX_DEX_IDS.has(slot.dexSpeciesId),
        dynamaxMode: NON_DYNAMAX_DEX_IDS.has(slot.dexSpeciesId)
          ? null
          : targetPlans.some((plan) => plan.type === 'gigantamax') ? 'gigantamax' : 'dynamax',
        battleMechanics: targetPlans.map((plan) => plan.type),
        setSource: sourceId,
        _species: strategySpecies,
        _statsEntry: strategyStatsResult?.entry,
        _legalMoveIds: legalMoveIds,
        _itemKey: itemKey,
        _requiredMoveIds: new Set(targetPlans.map((plan) => plan._requiredMoveId).filter(Boolean)),
        _candidateMoveIds: moveCandidates(strategySpecies, strategyStatsResult, legalMoveIds, itemKey, spread.trainingPoints).map(({ moveId }) => moveId),
      }
    })

    loadouts.forEach(ensureRequiredMoves)
    tuneTeamUtility(loadouts)
    loadouts.forEach(ensureRequiredMoves)
    const battleGimmicks = mechanicPlans.map(serializeBattleGimmick)
    team.battleGimmicks = battleGimmicks
    team.strategy = strategyFor(loadouts, battleGimmicks)
    team.pokemon = loadouts.map(stripInternalFields)
  }
}

const battleGimmickCounts = Object.fromEntries(Object.keys(MECHANIC_LABELS).map((type) => [type, 0]))
for (const trainer of trainerData.trainers) {
  for (const team of trainer.teams) {
    for (const gimmick of team.battleGimmicks) battleGimmickCounts[gimmick.type] += 1
  }
}

trainerData.generatedAt = new Date().toISOString()
trainerData.loadoutMethod = ['실전 사용률 상위 세팅', '포켓몬별 합법 기술', '팀 내 도구 중복 방지', '필드 전개와 제거기 보완', '배틀 기믹 중심 승리 조건']
trainerData.loadoutSources = STAT_SOURCES.map(({ id, label, url }) => ({ id, label, url }))
trainerData.loadoutCoverage = coverage
trainerData.moveCatalogSource = moveData.source
trainerData.battleGimmickRule = '모든 트레이너 팀은 메가진화, Z기술, 다이맥스·거다이맥스, 테라스탈, 원시회귀 중 하나 이상을 사용한다.'
trainerData.battleGimmickTeamCount = trainerData.trainers.reduce((total, trainer) => total + trainer.teams.filter((team) => team.battleGimmicks.length > 0).length, 0)
trainerData.battleGimmickCounts = battleGimmickCounts
trainerData.battleGimmickSources = [
  { mechanic: '메가진화', url: 'https://mega.pokemon.com/en-us/' },
  { mechanic: 'Z기술', url: 'https://www.pokemon.com/uk/pokemon-video-games/pokemon-sun-and-pokemon-moon' },
  { mechanic: '다이맥스', url: 'https://swordshield.pokemon.com/en-ca/gameplay/pokemon-become-huge-dynamax/' },
  { mechanic: '거다이맥스', url: 'https://swordshield.pokemon.com/en-us/gameplay/gigantamax/' },
]

validateTrainerLoadouts(trainerData)
await fs.writeFile(trainerDataPath, `${JSON.stringify(trainerData, null, 2)}\n`, 'utf8')
console.log(`Generated competitive loadouts for ${trainerData.slotCount} Pokemon slots.`)
console.log(`Coverage: ${Object.entries(coverage).map(([source, count]) => `${source}=${count}`).join(', ')}`)
console.log(`Battle gimmicks: ${Object.entries(battleGimmickCounts).map(([type, count]) => `${type}=${count}`).join(', ')}`)
