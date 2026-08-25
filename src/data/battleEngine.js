import {
  calculateStats,
  getBattleFormOptions,
  getMove,
  getMoveById,
  getRelatedFormOptions,
  getSpeciesProfile,
  normalizePokemon,
  resolveMoveForPokemon,
} from './trainingData.js'
import {
  ABILITY_BYPASS_NAMES,
  CONTACT_HIT_ABILITY_RULES,
  CRITICAL_HIT_IMMUNITY_ABILITIES,
  DAMAGING_HIT_ABILITY_RULES,
  ENTRY_OPPONENT_STAT_ABILITY_RULES,
  ENTRY_STAT_ABILITY_RULES,
  ENTRY_TERRAIN_ABILITY_RULES,
  ENTRY_WEATHER_ABILITY_RULES,
  FULL_STAT_DROP_IMMUNITY_ABILITIES,
  HELD_ITEM_TYPE_BY_ID,
  HP_CROSSING_ABILITY_RULES,
  INTIMIDATE_IMMUNITY_ABILITIES,
  KNOCKOUT_STAT_ABILITY_RULES,
  LOW_HP_MOVE_ABILITY_TYPES,
  MOVE_POWER_ABILITY_RULES,
  MOVE_TYPE_CHANGE_ABILITY_RULES,
  STAT_DROP_REACTION_ABILITY_RULES,
  STRONG_WEATHER_IDS,
  SUPER_EFFECTIVE_DAMAGE_REDUCTION_ABILITIES,
  TERRAIN_TYPE_BY_ID,
  TYPE_IMMUNITY_ABILITY_RULES,
  WEATHER_FAMILY_BY_ID,
  WEATHER_FORM_RULES,
} from './abilitySupportData.js'
import {
  BATTLE_TERRAINS,
  BATTLE_WEATHER_DEFINITIONS,
  normalizeAiBattleDifficulty,
} from './battleRules.js'
import { resolveMaxMove } from './maxMoveData.js'
import {
  HEAL_MOVE_IDS,
  MOVE_DAMAGE_STAT_RULES,
  PROTECT_CONTACT_EFFECTS,
  PROTECT_MOVE_IDS,
  STATUS_CURE_BERRIES,
  STATUS_MOVE_EFFECTS,
} from './moveSupportData.js'
import { canUseZMove, normalizeZCrystalId, resolveZMove } from './zMoveData.js'

const TYPE_CHART = {
  노말: { 바위: 0.5, 고스트: 0, 강철: 0.5 },
  불꽃: { 불꽃: 0.5, 물: 0.5, 풀: 2, 얼음: 2, 벌레: 2, 바위: 0.5, 드래곤: 0.5, 강철: 2 },
  물: { 불꽃: 2, 물: 0.5, 풀: 0.5, 땅: 2, 바위: 2, 드래곤: 0.5 },
  전기: { 물: 2, 전기: 0.5, 풀: 0.5, 땅: 0, 비행: 2, 드래곤: 0.5 },
  풀: { 불꽃: 0.5, 물: 2, 풀: 0.5, 독: 0.5, 땅: 2, 비행: 0.5, 벌레: 0.5, 바위: 2, 드래곤: 0.5, 강철: 0.5 },
  얼음: { 불꽃: 0.5, 물: 0.5, 풀: 2, 얼음: 0.5, 땅: 2, 비행: 2, 드래곤: 2, 강철: 0.5 },
  격투: { 노말: 2, 얼음: 2, 독: 0.5, 비행: 0.5, 에스퍼: 0.5, 벌레: 0.5, 바위: 2, 고스트: 0, 악: 2, 강철: 2, 페어리: 0.5 },
  독: { 풀: 2, 독: 0.5, 땅: 0.5, 바위: 0.5, 고스트: 0.5, 강철: 0, 페어리: 2 },
  땅: { 불꽃: 2, 전기: 2, 풀: 0.5, 독: 2, 비행: 0, 벌레: 0.5, 바위: 2, 강철: 2 },
  비행: { 전기: 0.5, 풀: 2, 격투: 2, 벌레: 2, 바위: 0.5, 강철: 0.5 },
  에스퍼: { 격투: 2, 독: 2, 에스퍼: 0.5, 악: 0, 강철: 0.5 },
  벌레: { 불꽃: 0.5, 풀: 2, 격투: 0.5, 독: 0.5, 비행: 0.5, 에스퍼: 2, 고스트: 0.5, 악: 2, 강철: 0.5, 페어리: 0.5 },
  바위: { 불꽃: 2, 얼음: 2, 격투: 0.5, 땅: 0.5, 비행: 2, 벌레: 2, 강철: 0.5 },
  고스트: { 노말: 0, 에스퍼: 2, 고스트: 2, 악: 0.5 },
  드래곤: { 드래곤: 2, 강철: 0.5, 페어리: 0 },
  악: { 격투: 0.5, 에스퍼: 2, 고스트: 2, 악: 0.5, 페어리: 0.5 },
  강철: { 불꽃: 0.5, 물: 0.5, 전기: 0.5, 얼음: 2, 바위: 2, 강철: 0.5, 페어리: 2 },
  페어리: { 불꽃: 0.5, 격투: 2, 독: 0.5, 드래곤: 2, 악: 2, 강철: 0.5 },
  스텔라: {},
}

const STATUS_LABELS = {
  burn: '화상',
  paralysis: '마비',
  poison: '독',
  toxic: '맹독',
  sleep: '잠듦',
  freeze: '얼음',
}

const SHOWDOWN_STATUS_IDS = {
  brn: 'burn',
  par: 'paralysis',
  psn: 'poison',
  tox: 'toxic',
  slp: 'sleep',
  frz: 'freeze',
}

const STAT_LABELS = {
  attack: '공격',
  defense: '방어',
  specialAttack: '특수공격',
  specialDefense: '특수방어',
  speed: '스피드',
  accuracy: '명중률',
  evasion: '회피율',
}

const AI_DIFFICULTY_STAGE_STATS = [
  'attack',
  'defense',
  'specialAttack',
  'specialDefense',
  'speed',
]

const SHOWDOWN_STAT_IDS = {
  atk: 'attack',
  def: 'defense',
  spa: 'specialAttack',
  spd: 'specialDefense',
  spe: 'speed',
  accuracy: 'accuracy',
  evasion: 'evasion',
}

const DAMP_BLOCKED_MOVE_IDS = new Set([
  'explosion',
  'selfdestruct',
  'mistyexplosion',
  'mindblown',
])

const TYPE_CHANGE_EXCLUDED_MOVE_IDS = new Set([
  'judgment',
  'multiattack',
  'naturalgift',
  'revelationdance',
  'struggle',
  'technoblast',
  'terrainpulse',
  'weatherball',
])

const TARGET_WEIGHT_POWER_MOVE_IDS = new Set(['grassknot', 'lowkick'])
const WEIGHT_RATIO_POWER_MOVE_IDS = new Set(['heatcrash', 'heavyslam'])
const WEIGHT_BASED_MOVE_IDS = new Set([
  ...TARGET_WEIGHT_POWER_MOVE_IDS,
  ...WEIGHT_RATIO_POWER_MOVE_IDS,
])

const INTIMIDATE_REASON = 'intimidate'
const BERRY_SUPPRESSING_ABILITIES = new Set(['긴장감', '혼연일체'])
const EMERGENCY_SWITCH_ABILITIES = new Set(['도망태세', '위기회피'])
const PASTEL_VEIL_ABILITIES = new Set(['파스텔베일'])
const REDIRECTION_IMMUNE_ABILITIES = new Set(['굳건한신념', '스크루지느러미'])
const FORCED_SWITCH_IMMUNE_ABILITIES = new Set(['사령탑', '파수견', '흡반'])
const RECEIVER_ABILITIES = new Set(['과학의힘', '리시버'])
const PLUS_MINUS_ABILITIES = new Set(['마이너스', '플러스'])
const ALLY_DAMAGE_IMMUNITY_ABILITIES = new Set(['텔레파시'])
const SINGLE_TARGET_MOVE_TARGETS = new Set(['adjacentFoe', 'any', 'normal', 'randomNormal'])
const PINCH_STAT_BERRIES = Object.freeze({
  'apicot-berry': { specialDefense: 1 },
  'ganlon-berry': { defense: 1 },
  'liechi-berry': { attack: 1 },
  'petaya-berry': { specialAttack: 1 },
  'salac-berry': { speed: 1 },
})

const RECOIL_IMMUNE_ABILITIES = new Set(['돌머리', '매직가드'])
const SLEEP_IMMUNE_ABILITIES = new Set(['불면', '의기양양', '절대안깸'])
const WEATHER_SUPPRESSING_ABILITIES = new Set(['날씨부정', '에어록'])
const UNTRACEABLE_ABILITIES = new Set([
  'AR시스템',
  '기분파',
  '꼬르륵스위치',
  '달마모드',
  '리밋실드',
  '마이티체인지',
  '멀티타입',
  '배틀스위치',
  '스웜체인지',
  '사령탑',
  '아이스페이스',
  '어군',
  '유대변화',
  '제로포밍',
  '테라셸',
  '테라체인지',
  '트레이스',
  '탈',
])
const ABILITY_CHANGE_IMMUNE_NAMES = new Set([
  ...UNTRACEABLE_ABILITIES,
  '절대안깸',
  '화학변화가스',
])
const SANDSTORM_IMMUNE_ABILITIES = new Set(['매직가드', '방진', '모래숨기', '모래헤치기', '모래의힘'])
const WEATHER_ENVIRONMENTS = new Map(BATTLE_WEATHER_DEFINITIONS.map((weather) => [weather.id, weather]))
const TERRAIN_ENVIRONMENTS = new Map(BATTLE_TERRAINS.map((terrain) => [terrain.id, terrain]))
const SHOWDOWN_WEATHER_IDS = {
  hail: 'snow',
  raindance: 'rain',
  sandstorm: 'sandstorm',
  snowscape: 'snow',
  sunnyday: 'sun',
}
const SHOWDOWN_TERRAIN_IDS = {
  electricterrain: 'electric',
  grassyterrain: 'grassy',
  mistyterrain: 'misty',
  psychicterrain: 'psychic',
}
const ENTRY_WEATHER_ABILITIES = Object.fromEntries(Object.entries(ENTRY_WEATHER_ABILITY_RULES)
  .map(([ability, rule]) => [ability, rule.weatherId]))
const ENTRY_TERRAIN_ABILITIES = Object.fromEntries(Object.entries(ENTRY_TERRAIN_ABILITY_RULES)
  .map(([ability, rule]) => [ability, rule.terrainId]))
const WEATHER_DURATION_ITEMS = {
  rain: 'damp-rock',
  sandstorm: 'smooth-rock',
  snow: 'icy-rock',
  sun: 'heat-rock',
}
const WEATHER_BALL_TYPES = {
  desolateland: '불꽃',
  primordialsea: '물',
  rain: '물',
  sandstorm: '바위',
  snow: '얼음',
  sun: '불꽃',
}
const TERRAIN_PULSE_TYPES = {
  electric: '전기',
  grassy: '풀',
  misty: '페어리',
  psychic: '에스퍼',
}
const WEATHER_HEAL_MOVE_IDS = new Set(['morningsun', 'moonlight', 'synthesis'])
const TERRAIN_CLEARING_MOVE_IDS = new Set(['icespinner', 'steelroller'])
const SEMI_INVULNERABLE_MOVES = {
  dig: 'underground',
  dive: 'underwater',
  fly: 'airborne',
  bounce: 'airborne',
  skydrop: 'airborne',
  phantomforce: 'vanished',
  shadowforce: 'vanished',
}
const SEMI_INVULNERABLE_HITS = {
  underground: {
    doubled: new Set(['earthquake', 'magnitude']),
    normal: new Set(['fissure']),
  },
  underwater: {
    doubled: new Set(['surf', 'whirlpool']),
    normal: new Set(),
  },
  airborne: {
    doubled: new Set(['gust', 'twister']),
    normal: new Set(['hurricane', 'skyuppercut', 'smackdown', 'thunder']),
  },
  vanished: {
    doubled: new Set(),
    normal: new Set(),
  },
}
const CHARGE_TURN_BOOSTS = {
  electroshot: { specialAttack: 1 },
  meteorbeam: { specialAttack: 1 },
  skullbash: { defense: 1 },
}
const CHARGE_MESSAGES = {
  bounce: '높이 뛰어올랐다!',
  dig: '땅속으로 파고들었다!',
  dive: '물속 깊이 몸을 숨겼다!',
  fly: '하늘 높이 날아올랐다!',
  geomancy: '대지의 에너지를 모으고 있다!',
  phantomforce: '모습을 감췄다!',
  shadowforce: '그림자 속으로 모습을 감췄다!',
  solarbeam: '빛을 한가득 모았다!',
  solarblade: '빛의 힘을 모았다!',
}

const MECHANIC_LABELS = {
  tera: '테라스탈',
  dynamax: '다이맥스',
  mega: '메가진화',
  zmove: 'Z기술',
  primal: '원시회귀',
}

const IVY_CUDGEL_VARIANTS = {
  'hearthflame-mask': { key: 'HEARTHFLAME_MASK', type: '불꽃' },
  'wellspring-mask': { key: 'WELLSPRING_MASK', type: '물' },
  'cornerstone-mask': { key: 'CORNERSTONE_MASK', type: '바위' },
}

function moveAnimationMetadata(attacker, move, action, moveCategory) {
  let animationType = move.type
  let animationVariant = null
  let animationVariantKey = null

  if (action.gimmick === 'zmove') {
    animationVariant = moveCategory === 'physical' ? 'Z_GENERIC_PHYSICAL' : 'Z_GENERIC_SPECIAL'
  } else if (attacker.dynamaxActive) {
    animationVariant = move.isGmaxMove ? 'GMAX_MOVE' : 'MAX_MOVE'
  } else if (move.id === 'terablast') {
    animationVariant = 'TERA_TYPE_VARIANTS'
    animationType = attacker.teraActive ? attacker.teraType : move.type
    animationVariantKey = animationType
  } else if (move.id === 'ivycudgel') {
    const maskVariant = IVY_CUDGEL_VARIANTS[attacker.heldItemId]
    animationVariant = 'FORM_TYPE_VARIANTS'
    animationVariantKey = maskVariant?.key ?? 'TEAL_MASK'
    animationType = maskVariant?.type ?? move.type
  }

  return {
    animationType,
    animationVariant,
    animationVariantKey,
    animationReferenceKey: move.animationReferenceKey ?? null,
    actorSpeciesSlug: attacker.slug ?? '',
    actorHeldItemId: attacker.heldItemId ?? '',
  }
}

function statObject(pokemon) {
  return Object.fromEntries(calculateStats(pokemon).map((stat) => [stat.key, stat.value]))
}

function moveRuntime(move, fallbackIndex) {
  return {
    ...move,
    id: move.id ?? `move-${fallbackIndex}`,
    maxPp: Math.max(1, Number(move.pp) || 1),
    currentPp: Math.max(1, Number(move.pp) || 1),
  }
}

function buildBattlePokemon(entry, index, teamGimmicks = []) {
  const configuredMoveCount = Math.min(4, Math.max(
    entry.moveIds?.length ?? 0,
    entry.moves?.length ?? 0,
  ))
  const resolvedMoves = Array.from({ length: configuredMoveCount }, (_, moveIndex) => (
    getMoveById(entry.moveIds?.[moveIndex])
      ?? getMove(entry.moves?.[moveIndex])
  ))
  const normalized = normalizePokemon({
    ...entry,
    captureId: entry.captureId ?? `ai-${entry.speciesId}-${index}`,
    moves: resolvedMoves.map((move) => move.name),
  })
  const normalizedMoves = normalized.moves.map((moveName) => (
    resolveMoveForPokemon(getMove(moveName), normalized)
  ))
  const profile = getSpeciesProfile(normalized.speciesId)
  const stats = statObject(normalized)
  const matchingGimmick = teamGimmicks.find((gimmick) => (
    gimmick.pokemonSlug === entry.slug
      || gimmick.pokemonName === normalized.name
      || Number(gimmick.pokemonSpeciesId) === Number(normalized.dexSpeciesId)
  ))

  return {
    ...normalized,
    battleId: `${normalized.captureId}-${index}`,
    originalSpeciesId: normalized.speciesId,
    battleBaseSpeciesId: profile?.parentSpeciesId ?? normalized.speciesId,
    originalTypes: [...normalized.types],
    types: [...normalized.types],
    stats,
    maxHp: stats.hp,
    originalMaxHp: stats.hp,
    hp: stats.hp,
    moves: normalizedMoves.map(moveRuntime),
    fainted: false,
    status: null,
    statStages: {
      attack: 0,
      defense: 0,
      specialAttack: 0,
      specialDefense: 0,
      speed: 0,
      accuracy: 0,
      evasion: 0,
    },
    protected: false,
    protectMode: null,
    protectChain: 0,
    flinched: false,
    confusionTurns: 0,
    infatuated: false,
    gender: entry.gender ?? null,
    yawnTurns: 0,
    perishCount: null,
    destinyBondActive: false,
    trappedTurns: 0,
    trapSourceName: null,
    trapDamages: false,
    tormented: false,
    lastMoveIndex: null,
    criticalStageBoost: 0,
    redirectTurns: 0,
    redirectMode: null,
    rechargeTurns: 0,
    chargingMove: null,
    lockedMove: null,
    semiInvulnerable: null,
    teraActive: false,
    dynamaxActive: false,
    dynamaxTurns: 0,
    dynamaxOriginalForm: null,
    megaActive: false,
    primalActive: false,
    ultraActive: false,
    usedBattleMechanicId: null,
    transformSnapshot: null,
    illusionSnapshot: null,
    tracedAbilityBase: null,
    proteanUsed: false,
    bondTriggered: false,
    iceFaceBroken: profile?.slug === 'eiscue-noice',
    flowerGiftActive: false,
    mimicryActive: false,
    paradoxBoosterActive: false,
    activeTurnCount: 0,
    activeMoveActions: 0,
    actedThisTurn: false,
    switchedInThisTurn: false,
    truantLoafing: false,
    flashFireActive: false,
    chargeActive: false,
    custapActive: false,
    gorillaLockedMoveIndex: null,
    weightReduction: 0,
    cudChewReadyTurn: null,
    cudChewItemId: '',
    cudChewItemName: '',
    commanding: false,
    commanderHostBattleId: null,
    commandedByBattleId: null,
    disabledMoveIndex: null,
    disabledMoveTurns: 0,
    saltCureActive: false,
    syrupBombTurns: 0,
    healBlockTurns: 0,
    entryAbilityActivations: {},
    hadHeldItem: Boolean(entry.heldItemId),
    consumedItem: false,
    battleMechanics: [...(entry.battleMechanics ?? [])],
    gimmickFormId: matchingGimmick?.targetFormId ?? null,
    heldItemName: entry.heldItemName ?? '',
    role: entry.role ?? '',
    spriteFront: normalized.spriteFront ?? profile?.spriteFront,
    spriteBack: normalized.spriteBack ?? profile?.spriteBack,
  }
}

export function createBattlePreviewPokemon(entry, index = 0, teamGimmicks = []) {
  return buildBattlePokemon(entry, index, teamGimmicks)
}

function reorderForLead(entries, leadName) {
  if (!leadName) return entries
  const leadIndex = entries.findIndex((entry) => entry.name === leadName)
  if (leadIndex <= 0) return entries
  return [entries[leadIndex], ...entries.slice(0, leadIndex), ...entries.slice(leadIndex + 1)]
}

function createSide(id, name, entries, teamGimmicks = [], leadName = '', activeSlots = 1) {
  const team = reorderForLead(
    entries.map((entry, index) => buildBattlePokemon(entry, index, teamGimmicks)),
    leadName,
  )
  const activeIndexes = team.slice(0, Math.min(activeSlots, team.length)).map((_, index) => index)

  return {
    id,
    name,
    team,
    activeIndex: activeIndexes[0] ?? 0,
    activeIndexes,
    rotationSlot: 0,
    usedMechanics: {
      tera: false,
      dynamax: false,
      mega: false,
      zmove: false,
      primal: false,
    },
    healingWishPending: null,
    zHealReplacement: false,
    auroraVeilTurns: 0,
    gmaxResidual: null,
    hazards: {
      stealthRock: false,
      steelsurge: false,
      toxicSpikes: 0,
    },
  }
}

function applyOpponentAiDifficulty(side, difficultyValue) {
  const difficulty = normalizeAiBattleDifficulty(difficultyValue)

  if (difficulty.id === 'easy') {
    side.team.forEach((pokemon) => {
      pokemon.heldItemId = ''
      pokemon.heldItemName = ''
      pokemon.hadHeldItem = false
      pokemon.consumedItem = false
      pokemon.battleMechanics = []
      pokemon.gimmickFormId = null
    })
  }

  if (difficulty.id === 'hard') {
    side.team.forEach((pokemon) => {
      const hpMultiplier = stageMultiplier(difficulty.boostStage)
      const boostedMaxHp = Math.max(1, Math.floor(pokemon.maxHp * hpMultiplier))
      pokemon.difficultyHpMultiplier = hpMultiplier
      pokemon.stats.hp = boostedMaxHp
      pokemon.maxHp = boostedMaxHp
      pokemon.originalMaxHp = boostedMaxHp
      pokemon.hp = boostedMaxHp
      AI_DIFFICULTY_STAGE_STATS.forEach((statKey) => {
        pokemon.statStages[statKey] = difficulty.boostStage
      })
      pokemon.difficultyBoostStage = difficulty.boostStage
      pokemon.difficultyBoostPending = true
    })
  }
}

function applyPendingDifficultyBoost(pokemon) {
  if (!pokemon?.difficultyBoostPending || !pokemon.difficultyBoostStage) return
  AI_DIFFICULTY_STAGE_STATS.forEach((statKey) => {
    pokemon.statStages[statKey] = pokemon.difficultyBoostStage
  })
  pokemon.difficultyBoostPending = false
}

function appendLog(state, message, tone = 'normal') {
  state.log.push({
    id: `${state.turn}-${state.log.length}-${message}`,
    message,
    tone,
  })
  if (state.log.length > 80) state.log.splice(0, state.log.length - 80)
}

function cloneBattleRules(rules) {
  return {
    ...rules,
    weather: { ...rules.weather },
    terrain: { ...rules.terrain },
    format: { ...rules.format },
    teamRule: { ...rules.teamRule },
    gimmickRestriction: { ...rules.gimmickRestriction },
    aiDifficulty: normalizeAiBattleDifficulty(rules.aiDifficulty),
  }
}

function createEnvironmentState(rules) {
  return {
    baseWeather: { ...rules.weather },
    baseTerrain: { ...rules.terrain },
    weatherTurns: null,
    terrainTurns: null,
    weatherSource: null,
    weatherSourceBattleId: null,
    weatherSourceAbility: null,
    weatherStrong: false,
    terrainSource: null,
    gravityTurns: 0,
  }
}

function ensureEnvironmentState(state) {
  if (!state.environment) state.environment = createEnvironmentState(state.rules)
  return state.environment
}

function activePokemonHaveAbility(state, abilities) {
  return ['player', 'opponent'].some((sideId) => (
    getActivePokemonList(state, sideId).some((pokemon) => (
      pokemon && !pokemon.fainted && pokemon.hp > 0 && abilities.has(pokemon.ability)
    ))
  ))
}

function activePokemonWithAbility(state, ability) {
  return ['player', 'opponent'].flatMap((sideId) => getActivePokemonList(state, sideId))
    .filter((pokemon) => pokemon && !pokemon.fainted && pokemon.hp > 0 && pokemon.ability === ability)
}

function opposingActiveHasAbility(state, pokemon, abilities) {
  const side = getPokemonSide(state, pokemon)
  return getActivePokemonList(state, side.id === 'player' ? 'opponent' : 'player')
    .some((opponent) => (
      opponent
      && !opponent.fainted
      && opponent.hp > 0
      && abilities.has(opponent.ability)
    ))
}

function berriesSuppressed(state, pokemon) {
  return opposingActiveHasAbility(state, pokemon, BERRY_SUPPRESSING_ABILITIES)
}

function heldItemEffectsActive(pokemon) {
  return Boolean(
    pokemon
    && pokemon.heldItemId
    && !pokemon.consumedItem
    && pokemon.ability !== '서투름',
  )
}

function hasActiveHeldItem(pokemon, itemId) {
  return heldItemEffectsActive(pokemon) && pokemon.heldItemId === itemId
}

function clearHeldItem(pokemon) {
  pokemon.heldItemId = ''
  pokemon.heldItemName = ''
  pokemon.consumedItem = false
}

function activateSymbiosis(state, recipient) {
  if (!recipient || recipient.heldItemId && !recipient.consumedItem) return false
  const side = getPokemonSide(state, recipient)
  const donor = getActivePokemonList(state, side.id).find((ally) => (
    ally
    && ally.battleId !== recipient.battleId
    && !ally.fainted
    && ally.hp > 0
    && ally.ability === '공생'
    && heldItemEffectsActive(ally)
  ))
  if (!donor) return false

  recipient.heldItemId = donor.heldItemId
  recipient.heldItemName = donor.heldItemName
  recipient.consumedItem = false
  recipient.hadHeldItem = true
  clearHeldItem(donor)
  appendLog(state, `${donor.name}의 공생! ${recipient.name}에게 지닌물건을 건넸다!`, 'ability')
  return true
}

function consumeHeldItem(state, pokemon, { berry = false } = {}) {
  if (!pokemon?.heldItemId || pokemon.consumedItem) return false
  const consumedItem = {
    id: pokemon.heldItemId,
    name: pokemon.heldItemName,
    turn: state.turn,
    consumerBattleId: pokemon.battleId,
  }
  pokemon.consumedItem = true
  state.lastConsumedItem = consumedItem
  if (berry && pokemon.ability === '되새김질') {
    pokemon.cudChewReadyTurn = state.turn + 1
    pokemon.cudChewItemId = consumedItem.id
    pokemon.cudChewItemName = consumedItem.name
  }
  activateSymbiosis(state, pokemon)
  return true
}

function stealHeldItem(state, thief, holder, sourceName, { ignoreHolderAbility = false } = {}) {
  if (
    !thief
    || !holder
    || thief.heldItemId && !thief.consumedItem
    || !holder.heldItemId
    || holder.consumedItem
    || !ignoreHolderAbility && holder.ability === '점착'
  ) return false

  thief.heldItemId = holder.heldItemId
  thief.heldItemName = holder.heldItemName
  thief.consumedItem = false
  thief.hadHeldItem = true
  clearHeldItem(holder)
  appendLog(state, `${thief.name}의 ${sourceName}! 상대의 지닌물건을 빼앗았다!`, 'ability')
  activateSymbiosis(state, holder)
  return true
}

function activeAllyHasAbility(state, pokemon, abilities) {
  const side = getPokemonSide(state, pokemon)
  return getActivePokemonList(state, side.id).some((ally) => (
    ally
    && !ally.fainted
    && ally.hp > 0
    && abilities.has(ally.ability)
  ))
}

function isAvailableFieldPokemon(pokemon) {
  return Boolean(pokemon && !pokemon.fainted && pokemon.hp > 0 && !pokemon.commanding)
}

function activeAllies(state, pokemon) {
  const side = getPokemonSide(state, pokemon)
  return getActivePokemonList(state, side.id).filter((ally) => (
    isAvailableFieldPokemon(ally) && ally.battleId !== pokemon.battleId
  ))
}

function moveAlreadyFlinches(move) {
  return moveSecondaryEffects(move).some((effect) => effect.volatileStatus === 'flinch')
}

function redirectTargetForMove(state, attacker, targetSide, move, requestedSlot) {
  const requested = getActivePokemon(state, targetSide.id, requestedSlot)
  if (
    state.rules?.format?.activeSlots <= 1
    || !SINGLE_TARGET_MOVE_TARGETS.has(move.target)
    || REDIRECTION_IMMUNE_ABILITIES.has(attacker.ability)
  ) return { slot: requestedSlot, pokemon: requested, reason: null }

  const resolvedMove = requested ? resolveEnvironmentMove(state, attacker, requested, move) : move
  const candidates = getActivePokemonList(state, targetSide.id)
    .map((pokemon, slot) => ({ pokemon, slot }))
    .filter(({ pokemon }) => isAvailableFieldPokemon(pokemon))
  const moveRedirectors = candidates
    .filter(({ pokemon }) => pokemon.redirectTurns > 0)
    .filter(({ pokemon }) => !(
      pokemon.redirectMode === 'ragepowder'
      && (
        attacker.types.includes('풀')
        || attacker.ability === '방진'
        || hasActiveHeldItem(attacker, 'safety-goggles')
      )
    ))
    .sort((first, second) => (
      effectiveStat(state, second.pokemon, 'speed') - effectiveStat(state, first.pokemon, 'speed')
    ))
  const abilityRedirector = candidates.find(({ pokemon }) => (
    resolvedMove.type === '전기' && pokemon.ability === '피뢰침'
      || resolvedMove.type === '물' && pokemon.ability === '마중물'
  ))
  const redirector = moveRedirectors[0] ?? abilityRedirector
  if (!redirector || redirector.slot === requestedSlot) {
    return { slot: requestedSlot, pokemon: requested, reason: null }
  }
  return {
    ...redirector,
    reason: redirector.pokemon.redirectTurns > 0 ? '기술' : redirector.pokemon.ability,
  }
}

function aromaVeilProtects(state, pokemon) {
  const side = getPokemonSide(state, pokemon)
  return getActivePokemonList(state, side.id).some((ally) => (
    ally && !ally.fainted && ally.hp > 0 && ally.ability === '아로마베일'
  ))
}

function trappingAbilitySource(state, pokemon) {
  if (pokemon.types.includes('고스트') || hasActiveHeldItem(pokemon, 'shed-shell')) return null
  const side = getPokemonSide(state, pokemon)
  return getActivePokemonList(state, side.id === 'player' ? 'opponent' : 'player').find((opponent) => {
    if (!opponent || opponent.fainted || opponent.hp <= 0) return false
    if (opponent.ability === '그림자밟기') return pokemon.ability !== '그림자밟기'
    if (opponent.ability === '자력') return pokemon.types.includes('강철')
    return opponent.ability === '개미지옥' && isGrounded(pokemon, state)
  }) ?? null
}

function abilityCanBeChanged(pokemon) {
  return pokemon && !ABILITY_CHANGE_IMMUNE_NAMES.has(pokemon.ability)
}

function restoreIllusion(pokemon) {
  if (!pokemon?.illusionSnapshot) return false
  Object.assign(pokemon, pokemon.illusionSnapshot)
  pokemon.illusionSnapshot = null
  return true
}

function activateIllusion(state, sideId, pokemon) {
  if (!pokemon || pokemon.ability !== '일루전' || pokemon.illusionSnapshot) return false
  const side = getSide(state, sideId)
  const disguise = [...side.team].reverse().find((candidate) => (
    candidate
    && candidate.battleId !== pokemon.battleId
    && !candidate.fainted
    && candidate.hp > 0
  ))
  if (!disguise) return false

  pokemon.illusionSnapshot = {
    name: pokemon.name,
    spriteFront: pokemon.spriteFront,
    spriteBack: pokemon.spriteBack,
    spriteFrontFallback: pokemon.spriteFrontFallback,
    spriteBackFallback: pokemon.spriteBackFallback,
  }
  pokemon.name = disguise.name
  pokemon.spriteFront = disguise.spriteFront
  pokemon.spriteBack = disguise.spriteBack
  pokemon.spriteFrontFallback = disguise.spriteFrontFallback
  pokemon.spriteBackFallback = disguise.spriteBackFallback
  return true
}

function breakIllusion(state, pokemon) {
  if (!pokemon?.illusionSnapshot) return false
  restoreIllusion(pokemon)
  appendLog(state, `${pokemon.name}의 일루전이 깨졌다!`, 'ability')
  return true
}

function analyticBoostActive(state, attacker) {
  return ['player', 'opponent']
    .flatMap((sideId) => getActivePokemonList(state, sideId))
    .filter((pokemon) => pokemon && pokemon.battleId !== attacker.battleId && !pokemon.fainted && pokemon.hp > 0)
    .every((pokemon) => pokemon.actedThisTurn || pokemon.switchedInThisTurn)
}

function effectiveWeatherId(state) {
  if (activePokemonHaveAbility(state, WEATHER_SUPPRESSING_ABILITIES)) return 'clear'
  return state.rules?.weather?.id ?? 'clear'
}

function weatherFamilyId(weatherId) {
  return WEATHER_FAMILY_BY_ID[weatherId] ?? weatherId
}

function effectiveWeatherFamilyId(state) {
  return weatherFamilyId(effectiveWeatherId(state))
}

function effectiveMoveWeatherId(state, pokemon) {
  return pokemon?.ability === '메가솔라' ? 'sun' : effectiveWeatherId(state)
}

function effectiveMoveWeatherFamilyId(state, pokemon) {
  return weatherFamilyId(effectiveMoveWeatherId(state, pokemon))
}

function environmentDuration(kind, environmentId, sourcePokemon) {
  if (kind === 'terrain') return hasActiveHeldItem(sourcePokemon, 'terrain-extender') ? 8 : 5
  return hasActiveHeldItem(sourcePokemon, WEATHER_DURATION_ITEMS[environmentId]) ? 8 : 5
}

function environmentDefinition(kind, environmentId) {
  const environments = kind === 'weather' ? WEATHER_ENVIRONMENTS : TERRAIN_ENVIRONMENTS
  return environments.get(environmentId) ?? null
}

function setTemporaryEnvironment(state, kind, environmentId, sourceName, sourcePokemon, options = {}) {
  const environment = environmentDefinition(kind, environmentId)
  if (!environment) return false
  const environmentState = ensureEnvironmentState(state)
  const strongWeather = kind === 'weather'
    && (options.strong || STRONG_WEATHER_IDS.has(environmentId))
  if (
    kind === 'weather'
    && STRONG_WEATHER_IDS.has(state.rules?.weather?.id)
    && !strongWeather
  ) {
    appendLog(state, `${state.rules.weather.label} 때문에 ${environment.label} 날씨로 바꿀 수 없다!`, 'field')
    return false
  }
  const duration = strongWeather ? null : environmentDuration(kind, environmentId, sourcePokemon)
  const turnsKey = kind === 'weather' ? 'weatherTurns' : 'terrainTurns'
  const sourceKey = kind === 'weather' ? 'weatherSource' : 'terrainSource'

  state.rules[kind] = { ...environment }
  environmentState[turnsKey] = duration
  environmentState[sourceKey] = sourceName
  if (kind === 'weather') {
    environmentState.weatherSourceBattleId = strongWeather ? sourcePokemon?.battleId ?? null : null
    environmentState.weatherSourceAbility = strongWeather ? sourcePokemon?.ability ?? sourceName : null
    environmentState.weatherStrong = strongWeather
  }
  appendLog(
    state,
    kind === 'weather'
      ? strongWeather
        ? `${sourceName}의 효과로 ${environment.label}이(가) 계속된다!`
        : `${sourceName}의 효과로 날씨가 ${environment.label} 상태가 되었다! (${duration}턴)`
      : `${sourceName}의 효과로 ${environment.label}가 펼쳐졌다! (${duration}턴)`,
    'field',
  )
  state.lastEvent = {
    kind: 'environment',
    environmentKind: kind,
    environmentId,
    nonce: state.eventNonce += 1,
  }
  refreshEnvironmentDependentAbilities(state, kind)
  return true
}

function restoreBaseEnvironment(state, kind, sourceName = '') {
  const environmentState = ensureEnvironmentState(state)
  const baseKey = kind === 'weather' ? 'baseWeather' : 'baseTerrain'
  const turnsKey = kind === 'weather' ? 'weatherTurns' : 'terrainTurns'
  const sourceKey = kind === 'weather' ? 'weatherSource' : 'terrainSource'
  const baseEnvironment = environmentState[baseKey]
  const previousEnvironment = state.rules[kind]

  state.rules[kind] = { ...baseEnvironment }
  environmentState[turnsKey] = null
  environmentState[sourceKey] = null
  if (kind === 'weather') {
    environmentState.weatherSourceBattleId = null
    environmentState.weatherSourceAbility = null
    environmentState.weatherStrong = false
  }
  const restored = previousEnvironment?.id !== baseEnvironment.id
  appendLog(
    state,
    sourceName
      ? restored
        ? `${sourceName}의 효과로 ${baseEnvironment.label} 상태로 돌아왔다.`
        : `${sourceName}이(가) 환경 변화 효과를 해제했다.`
      : restored
        ? `임시 ${kind === 'weather' ? '날씨' : '필드'}가 끝나 ${baseEnvironment.label} 상태로 돌아왔다.`
        : `${previousEnvironment?.label ?? baseEnvironment.label}의 임시 효과가 끝났다.`,
    'field',
  )
  state.lastEvent = {
    kind: 'environment',
    environmentKind: kind,
    environmentId: baseEnvironment.id,
    nonce: state.eventNonce += 1,
  }
  refreshEnvironmentDependentAbilities(state, kind)
}

function clearBattleEnvironment(state, kind, sourceName) {
  const environmentState = ensureEnvironmentState(state)
  const environmentId = kind === 'weather' ? 'clear' : 'neutral'
  const environment = environmentDefinition(kind, environmentId)
  const baseKey = kind === 'weather' ? 'baseWeather' : 'baseTerrain'
  const turnsKey = kind === 'weather' ? 'weatherTurns' : 'terrainTurns'
  const sourceKey = kind === 'weather' ? 'weatherSource' : 'terrainSource'
  if (!environment) return false

  state.rules[kind] = { ...environment }
  environmentState[baseKey] = { ...environment }
  environmentState[turnsKey] = null
  environmentState[sourceKey] = null
  if (kind === 'weather') {
    environmentState.weatherSourceBattleId = null
    environmentState.weatherSourceAbility = null
    environmentState.weatherStrong = false
  }
  appendLog(state, `${sourceName}이(가) ${kind === 'weather' ? '날씨' : '필드'}의 효과를 지웠다!`, 'ability')
  refreshEnvironmentDependentAbilities(state, kind)
  return true
}

function refreshStrongWeatherSource(state) {
  const environmentState = ensureEnvironmentState(state)
  const weatherId = state.rules?.weather?.id
  if (!STRONG_WEATHER_IDS.has(weatherId)) return false

  const replacement = ['player', 'opponent']
    .flatMap((sideId) => getActivePokemonList(state, sideId))
    .find((pokemon) => (
      pokemon
      && !pokemon.fainted
      && pokemon.hp > 0
      && ENTRY_WEATHER_ABILITY_RULES[pokemon.ability]?.weatherId === weatherId
    ))
  if (replacement) {
    environmentState.weatherSourceBattleId = replacement.battleId
    environmentState.weatherSourceAbility = replacement.ability
    return false
  }

  restoreBaseEnvironment(state, 'weather', environmentState.weatherSourceAbility ?? '')
  return true
}

function advanceEnvironmentTimers(state, timeline = null) {
  const environmentState = ensureEnvironmentState(state)

  ;['weather', 'terrain'].forEach((kind) => {
    const turnsKey = kind === 'weather' ? 'weatherTurns' : 'terrainTurns'
    if (!Number.isFinite(environmentState[turnsKey])) return
    environmentState[turnsKey] -= 1
    if (environmentState[turnsKey] > 0) return

    restoreBaseEnvironment(state, kind)
    pushTimelineStep(timeline, state, {
      phase: 'status',
      message: latestLogMessage(state, '배틀 환경이 원래 상태로 돌아왔다.'),
    })
  })
}

function clonePokemon(pokemon) {
  return {
    ...pokemon,
    types: [...pokemon.types],
    originalTypes: [...pokemon.originalTypes],
    stats: { ...pokemon.stats },
    moves: pokemon.moves.map((move) => ({ ...move })),
    statStages: { ...pokemon.statStages },
    status: pokemon.status ? { ...pokemon.status } : null,
    chargingMove: pokemon.chargingMove ? { ...pokemon.chargingMove } : null,
    lockedMove: pokemon.lockedMove ? { ...pokemon.lockedMove } : null,
    entryAbilityActivations: { ...(pokemon.entryAbilityActivations ?? {}) },
    transformSnapshot: pokemon.transformSnapshot ? {
      ...pokemon.transformSnapshot,
      types: [...pokemon.transformSnapshot.types],
      originalTypes: [...pokemon.transformSnapshot.originalTypes],
      stats: { ...pokemon.transformSnapshot.stats },
      moves: pokemon.transformSnapshot.moves.map((move) => ({ ...move })),
      statStages: { ...pokemon.transformSnapshot.statStages },
    } : null,
    battleMechanics: [...pokemon.battleMechanics],
    dynamaxOriginalForm: pokemon.dynamaxOriginalForm ? { ...pokemon.dynamaxOriginalForm } : null,
  }
}

function cloneSide(side) {
  return {
    ...side,
    team: side.team.map(clonePokemon),
    usedMechanics: { ...side.usedMechanics },
    activeIndexes: [...(side.activeIndexes ?? [side.activeIndex])],
    gmaxResidual: side.gmaxResidual ? { ...side.gmaxResidual } : null,
    hazards: { ...(side.hazards ?? {}) },
  }
}

function cloneBattle(state) {
  return {
    ...state,
    rules: cloneBattleRules(state.rules),
    environment: state.environment ? {
      ...state.environment,
      baseWeather: { ...state.environment.baseWeather },
      baseTerrain: { ...state.environment.baseTerrain },
    } : null,
    player: cloneSide(state.player),
    opponent: cloneSide(state.opponent),
    log: [...state.log],
    awaitingPlayerSwitchSlots: [...(state.awaitingPlayerSwitchSlots ?? [])],
    lastEvent: state.lastEvent ? { ...state.lastEvent } : null,
    lastConsumedItem: state.lastConsumedItem ? { ...state.lastConsumedItem } : null,
  }
}

function pushTimelineStep(timeline, state, step) {
  if (!timeline) return
  timeline.push({
    id: `${state.turn}-${timeline.length}-${step.phase}`,
    ...step,
    state: cloneBattle(state),
  })
}

function latestLogMessage(state, fallback) {
  return state.log[state.log.length - 1]?.message ?? fallback
}

function mechanicPokemonSnapshot(pokemon) {
  return {
    speciesId: pokemon.speciesId,
    originalSpeciesId: pokemon.originalSpeciesId,
    name: pokemon.name,
    types: [...pokemon.types],
    spriteFront: pokemon.spriteFront,
    spriteBack: pokemon.spriteBack,
    spriteFrontFallback: pokemon.spriteFrontFallback,
    spriteBackFallback: pokemon.spriteBackFallback,
  }
}

function getSide(state, sideId) {
  return sideId === 'player' ? state.player : state.opponent
}

function getOtherSide(state, sideId) {
  return sideId === 'player' ? state.opponent : state.player
}

function getPokemonSide(state, pokemon) {
  if (state.player.team.some((entry) => entry === pokemon || entry.battleId === pokemon?.battleId)) {
    return state.player
  }
  return state.opponent
}

function activeSlotIndex(state, side, requestedSlot) {
  if (requestedSlot != null) return Math.max(0, Math.min(side.activeIndexes.length - 1, requestedSlot))
  return state?.rules?.format?.rotation ? side.rotationSlot ?? 0 : 0
}

export function getActivePokemon(state, sideId, requestedSlot) {
  const side = getSide(state, sideId)
  const slot = activeSlotIndex(state, side, requestedSlot)
  return side.team[side.activeIndexes?.[slot] ?? side.activeIndex]
}

export function getActivePokemonList(state, sideId) {
  const side = getSide(state, sideId)
  return (side.activeIndexes ?? [side.activeIndex]).map((teamIndex) => side.team[teamIndex]).filter(Boolean)
}

function availableIndexes(side) {
  return side.team
    .map((pokemon, index) => (!pokemon.fainted && pokemon.hp > 0 ? index : -1))
    .filter((index) => index >= 0)
}

function availableBenchIndexes(side) {
  const activeIndexes = new Set(side.activeIndexes ?? [side.activeIndex])
  return availableIndexes(side).filter((index) => !activeIndexes.has(index))
}

function remainingCount(side) {
  return availableIndexes(side).length
}

function stageMultiplier(stage) {
  return stage >= 0 ? (2 + stage) / 2 : 2 / (2 - stage)
}

function accuracyStageMultiplier(stage) {
  return stage >= 0 ? (3 + stage) / 3 : 3 / (3 - stage)
}

function isStatusMove(move) {
  return move?.categoryId === 'status' || move?.category === '변화'
}

function moveSecondaryEffects(move) {
  return move?.secondaries ?? (move?.secondary ? [move.secondary] : [])
}

function hasSheerForceEffect(move) {
  return moveSecondaryEffects(move).length > 0 || Number(move?.self?.chance) > 0
}

function secondaryEffectChance(attacker, effect) {
  const multiplier = attacker.ability === '하늘의은총' ? 2 : 1
  return Math.min(100, Number(effect?.chance ?? 100) * multiplier)
}

function isHealingMove(move) {
  return Boolean(
    move?.heal
    || move?.drain
    || move?.id === 'rest'
    || HEAL_MOVE_IDS.has(move?.id)
    || move?.flags?.includes('heal'),
  )
}

function normalizedStageChanges(boosts = {}) {
  return Object.fromEntries(Object.entries(boosts).flatMap(([statId, amount]) => {
    const statKey = SHOWDOWN_STAT_IDS[statId] ?? statId
    return STAT_LABELS[statKey] && Number(amount) ? [[statKey, Number(amount)]] : []
  }))
}

function effectiveStat(state, pokemon, statKey, { ignoreStages = false } = {}) {
  let value = pokemon.stats[statKey] * (ignoreStages ? 1 : stageMultiplier(pokemon.statStages[statKey] ?? 0))
  const activeWeatherId = effectiveWeatherId(state)
  const weatherId = effectiveWeatherFamilyId(state)
  const terrainId = state.rules?.terrain?.id

  if (statKey === 'speed' && pokemon.status?.id === 'paralysis' && pokemon.ability !== '속보') value *= 0.5
  if (statKey === 'speed' && hasActiveHeldItem(pokemon, 'choice-scarf')) value *= 1.5
  if (statKey === 'speed' && weatherId === 'sun' && pokemon.ability === '엽록소') value *= 2
  if (statKey === 'speed' && weatherId === 'rain' && pokemon.ability === '쓱쓱') value *= 2
  if (statKey === 'speed' && weatherId === 'sandstorm' && pokemon.ability === '모래헤치기') value *= 2
  if (statKey === 'speed' && weatherId === 'snow' && pokemon.ability === '눈치우기') value *= 2
  if (statKey === 'speed' && terrainId === 'electric' && pokemon.ability === '서핑테일') value *= 2
  if (statKey === 'attack' && hasActiveHeldItem(pokemon, 'choice-band')) value *= 1.5
  if (statKey === 'attack' && ['순수한힘', '천하장사'].includes(pokemon.ability)) value *= 2
  if (statKey === 'attack' && pokemon.ability === '무아지경' && !pokemon.dynamaxActive) value *= 1.5
  if (statKey === 'attack' && activeWeatherId === 'sun' && pokemon.ability === '진홍빛고동') value *= 4 / 3
  if (statKey === 'specialAttack' && hasActiveHeldItem(pokemon, 'choice-specs')) value *= 1.5
  if (
    statKey === 'specialAttack'
    && PLUS_MINUS_ABILITIES.has(pokemon.ability)
    && getActivePokemonList(state, getPokemonSide(state, pokemon).id).some((ally) => (
      ally
      && ally.battleId !== pokemon.battleId
      && !ally.fainted
      && ally.hp > 0
      && PLUS_MINUS_ABILITIES.has(ally.ability)
    ))
  ) value *= 1.5
  if (statKey === 'specialAttack' && weatherId === 'sun' && pokemon.ability === '선파워') value *= 1.5
  if (statKey === 'specialAttack' && terrainId === 'electric' && pokemon.ability === '하드론엔진') value *= 4 / 3
  if (statKey === 'specialDefense' && hasActiveHeldItem(pokemon, 'assault-vest')) value *= 1.5
  if (statKey === 'defense' && terrainId === 'grassy' && pokemon.ability === '풀모피') value *= 1.5
  if (statKey === 'defense' && pokemon.ability === '퍼코트') value *= 2
  if (statKey === 'speed' && pokemon.status && pokemon.ability === '속보') value *= 1.5
  if (statKey === 'defense' && pokemon.status && pokemon.ability === '이상한비늘') value *= 1.5
  if (
    statKey === 'attack'
    && ['poison', 'toxic'].includes(pokemon.status?.id)
    && pokemon.ability === '독폭주'
  ) value *= 1.5
  if (statKey === 'specialAttack' && pokemon.status?.id === 'burn' && pokemon.ability === '열폭주') value *= 1.5
  if (
    ['attack', 'specialAttack'].includes(statKey)
    && pokemon.ability === '무기력'
    && pokemon.hp <= pokemon.maxHp / 2
  ) value *= 0.5
  if (
    ['attack', 'speed'].includes(statKey)
    && pokemon.ability === '슬로스타트'
    && (pokemon.activeTurnCount ?? 0) < 5
  ) value *= 0.5
  if (
    statKey === 'speed'
    && pokemon.ability === '곡예'
    && pokemon.hadHeldItem
    && pokemon.consumedItem
  ) value *= 2

  const paradoxActive = pokemon.paradoxBoosterActive
    || pokemon.ability === '고대활성' && activeWeatherId === 'sun'
    || pokemon.ability === '쿼크차지' && terrainId === 'electric'
  if (paradoxActive && ['고대활성', '쿼크차지'].includes(pokemon.ability)) {
    const bestStat = ['attack', 'defense', 'specialAttack', 'specialDefense', 'speed']
      .reduce((best, key) => pokemon.stats[key] > pokemon.stats[best] ? key : best, 'attack')
    if (statKey === bestStat) value *= statKey === 'speed' ? 1.5 : 1.3
  }

  if (['attack', 'specialDefense'].includes(statKey) && weatherId === 'sun') {
    const side = getPokemonSide(state, pokemon)
    const flowerGiftCount = getActivePokemonList(state, side.id).filter((ally) => (
      ally && !ally.fainted && ally.hp > 0 && ally.ability === '플라워기프트'
    )).length
    value *= 1.5 ** flowerGiftCount
  }

  const ruinAbilityByStat = {
    attack: '재앙의목간',
    defense: '재앙의검',
    specialAttack: '재앙의그릇',
    specialDefense: '재앙의구슬',
  }
  const ruinAbility = ruinAbilityByStat[statKey]
  if (
    ruinAbility
    && pokemon.ability !== ruinAbility
    && activePokemonWithAbility(state, ruinAbility).length > 0
  ) value *= 0.75

  return Math.max(1, value)
}

export function getEffectiveBattleStat(state, pokemon, statKey) {
  return effectiveStat(state, pokemon, statKey)
}

export function getTypeEffectiveness(moveType, defenderTypes) {
  return defenderTypes.reduce((multiplier, defenderType) => (
    multiplier * (TYPE_CHART[moveType]?.[defenderType] ?? 1)
  ), 1)
}

export function getBattleTypeEffectiveness(state, moveType, defenderTypes) {
  const strongWinds = effectiveWeatherId(state) === 'deltastream'
  const standardMultiplier = defenderTypes.reduce((multiplier, defenderType) => {
    const typeMultiplier = TYPE_CHART[moveType]?.[defenderType] ?? 1
    return multiplier * (strongWinds && defenderType === '비행' && typeMultiplier > 1 ? 1 : typeMultiplier)
  }, 1)
  if (!state?.rules?.format?.inverse) return standardMultiplier
  if (standardMultiplier === 0) return 2
  return 1 / standardMultiplier
}

function getMoveTypeEffectiveness(state, attacker, defender, move) {
  const bypassGhostImmunity = ['배짱', '심안'].includes(attacker.ability)
    && ['노말', '격투'].includes(move.type)
  const strongWinds = effectiveWeatherId(state) === 'deltastream'
  const standardMultiplier = defender.types.reduce((multiplier, defenderType) => {
    let typeMultiplier = TYPE_CHART[move.type]?.[defenderType] ?? 1
    if (bypassGhostImmunity && defenderType === '고스트' && typeMultiplier === 0) typeMultiplier = 1
    if (strongWinds && defenderType === '비행' && typeMultiplier > 1) typeMultiplier = 1
    return multiplier * typeMultiplier
  }, 1)
  if (!state?.rules?.format?.inverse) return standardMultiplier
  if (standardMultiplier === 0) return 2
  return 1 / standardMultiplier
}

function isGrounded(pokemon, state = null) {
  if (state?.environment?.gravityTurns > 0) return true
  return !pokemon.semiInvulnerable && !pokemon.types.includes('비행') && pokemon.ability !== '부유'
}

function effectivePokemonWeight(pokemon, { ignoreAbility = false } = {}) {
  const profileWeight = getSpeciesProfile(pokemon?.speciesId)?.weight
  let weight = Math.max(1, Number(profileWeight ?? pokemon?.weight) || 1)
  weight = Math.max(1, weight - Math.max(0, Number(pokemon?.weightReduction) || 0))
  if (hasActiveHeldItem(pokemon, 'float-stone')) weight = Math.max(1, Math.floor(weight / 2))
  if (!ignoreAbility && pokemon?.ability === '라이트메탈') weight = Math.max(1, Math.floor(weight / 2))
  if (!ignoreAbility && pokemon?.ability === '헤비메탈') weight *= 2
  return weight
}

function targetWeightMovePower(defenderWeight) {
  if (defenderWeight >= 2000) return 120
  if (defenderWeight >= 1000) return 100
  if (defenderWeight >= 500) return 80
  if (defenderWeight >= 250) return 60
  if (defenderWeight >= 100) return 40
  return 20
}

function weightRatioMovePower(attackerWeight, defenderWeight) {
  const ratio = attackerWeight / Math.max(1, defenderWeight)
  if (ratio >= 5) return 120
  if (ratio >= 4) return 100
  if (ratio >= 3) return 80
  if (ratio >= 2) return 60
  return 40
}

function weightBasedMovePower(attacker, defender, move) {
  const defenderWeight = effectivePokemonWeight(defender, {
    ignoreAbility: Boolean(move.ignoreAbility),
  })
  if (TARGET_WEIGHT_POWER_MOVE_IDS.has(move.id)) return targetWeightMovePower(defenderWeight)
  if (WEIGHT_RATIO_POWER_MOVE_IDS.has(move.id)) {
    return weightRatioMovePower(effectivePokemonWeight(attacker), defenderWeight)
  }
  return null
}

function resolveEnvironmentMove(state, attacker, defender, move) {
  const resolvedMove = { ...move }
  const activeWeatherId = effectiveMoveWeatherId(state, attacker)
  const weatherId = weatherFamilyId(activeWeatherId)
  const terrainId = state.rules?.terrain?.id
  const heldItemType = HELD_ITEM_TYPE_BY_ID[attacker.heldItemId]
  const typeChangeRule = MOVE_TYPE_CHANGE_ABILITY_RULES[attacker.ability]

  if (ABILITY_BYPASS_NAMES.has(attacker.ability)) resolvedMove.ignoreAbility = true
  if (attacker.ability === '균사의힘' && isStatusMove(move)) resolvedMove.ignoreAbility = true
  const weightPower = weightBasedMovePower(attacker, defender, resolvedMove)
  if (weightPower != null) resolvedMove.power = weightPower
  if (
    typeChangeRule
    && !TYPE_CHANGE_EXCLUDED_MOVE_IDS.has(move.id)
    && (typeChangeRule.allTypes || move.type === typeChangeRule.sourceType || move.flags?.includes(typeChangeRule.flag))
  ) {
    resolvedMove.type = typeChangeRule.targetType
    resolvedMove.abilityPowerMultiplier = typeChangeRule.multiplier
  }

  if (move.id === 'weatherball' && WEATHER_BALL_TYPES[activeWeatherId]) {
    resolvedMove.type = WEATHER_BALL_TYPES[activeWeatherId]
    resolvedMove.power = Math.max(1, Number(move.power) || 50) * 2
  }

  if (move.id === 'terrainpulse' && isGrounded(attacker, state) && TERRAIN_PULSE_TYPES[terrainId]) {
    resolvedMove.type = TERRAIN_PULSE_TYPES[terrainId]
    resolvedMove.power = Math.max(1, Number(move.power) || 50) * 2
  }

  if (
    move.id === 'judgment'
    && heldItemType
    && /(?:-plate|ium-z--held)$/.test(attacker.heldItemId ?? '')
  ) resolvedMove.type = heldItemType

  if (
    move.id === 'multiattack'
    && heldItemType
    && attacker.heldItemId?.endsWith('-memory')
  ) resolvedMove.type = heldItemType

  if (['solarbeam', 'solarblade'].includes(move.id) && !['clear', 'sun'].includes(weatherId)) {
    resolvedMove.power = Math.max(1, Number(move.power) || 1) * 0.5
  }
  if (move.id === 'risingvoltage' && terrainId === 'electric' && isGrounded(defender, state)) {
    resolvedMove.power = Math.max(1, Number(move.power) || 1) * 2
  }
  if (move.id === 'expandingforce' && terrainId === 'psychic' && isGrounded(attacker, state)) {
    resolvedMove.power = Math.max(1, Number(move.power) || 1) * 1.5
  }
  if (move.id === 'mistyexplosion' && terrainId === 'misty' && isGrounded(attacker, state)) {
    resolvedMove.power = Math.max(1, Number(move.power) || 1) * 1.5
  }
  if (move.id === 'growth' && weatherId === 'sun') {
    resolvedMove.boosts = { atk: 2, spa: 2 }
  }
  if (move.id === 'terablast' && attacker.teraActive) resolvedMove.type = attacker.teraType
  if (move.id === 'watershuriken' && currentSpeciesSlug(attacker) === 'greninja-ash') {
    resolvedMove.multihit = 3
    resolvedMove.power = 20
  }

  if (!isStatusMove(resolvedMove)) {
    const damageProfile = moveDamageStatProfile(state, attacker, defender, resolvedMove)
    resolvedMove.categoryId = damageProfile.category
    resolvedMove.category = damageProfile.category === 'physical' ? '물리' : '특수'
  }

  return resolvedMove
}

function maxMoveSpeciesSlug(pokemon) {
  const currentSlug = getSpeciesProfile(pokemon.speciesId)?.slug ?? pokemon.slug ?? ''
  if (currentSlug.includes('-gmax')) return currentSlug
  return getSpeciesProfile(pokemon.gimmickFormId)?.slug ?? currentSlug
}

function resolveBattleMaxMove(pokemon, move, forceDynamax = false, powerSourceMove = move) {
  if (!pokemon?.dynamaxActive && !forceDynamax) return move
  return resolveMaxMove(move, {
    gigantamax: pokemon.dynamaxMode === 'gigantamax',
    speciesSlug: maxMoveSpeciesSlug(pokemon),
    powerSourceMove,
  })
}

function currentSpeciesSlug(pokemon) {
  return getSpeciesProfile(pokemon?.speciesId)?.slug ?? pokemon?.slug ?? ''
}

function battleZMoveOptions(pokemon, sourceMove = null) {
  return {
    heldItemId: pokemon?.heldItemId,
    speciesSlug: currentSpeciesSlug(pokemon),
    sourceMove,
  }
}

function resolveBattleZMove(pokemon, move, sourceMove = move) {
  return resolveZMove(move, battleZMoveOptions(pokemon, sourceMove))
}

function hasCompatibleBattleZMove(pokemon) {
  return pokemon?.moves?.some((move) => canUseZMove(move, battleZMoveOptions(pokemon))) ?? false
}

function environmentMovePriority(state, attacker, move) {
  let priority = Number(move?.priority ?? 0)
  if (attacker.ability === '짓궂은마음' && isStatusMove(move)) priority += 1
  if (attacker.ability === '질풍날개' && attacker.hp === attacker.maxHp && move.type === '비행') priority += 1
  if (attacker.ability === '힐링시프트' && isHealingMove(move)) priority += 3
  if (attacker.ability === '균사의힘' && isStatusMove(move)) priority -= 0.1
  if (move?.id === 'grassyglide' && state.rules?.terrain?.id === 'grassy' && isGrounded(attacker, state)) {
    priority += 1
  }
  return priority
}

function environmentMoveMultiplier(state, attacker, defender, move) {
  let multiplier = 1
  const weatherId = effectiveMoveWeatherFamilyId(state, attacker)
  const terrainId = state.rules?.terrain?.id

  if (weatherId === 'sun') {
    if (move.type === '불꽃') multiplier *= 1.5
    if (move.type === '물') multiplier *= move.id === 'hydrosteam' ? 1.5 : 0.5
  } else if (weatherId === 'rain') {
    if (move.type === '물') multiplier *= 1.5
    if (move.type === '불꽃') multiplier *= 0.5
  }

  if (isGrounded(attacker, state)) {
    if (terrainId === 'electric' && move.type === '전기') multiplier *= 1.3
    if (terrainId === 'grassy' && move.type === '풀') multiplier *= 1.3
    if (terrainId === 'psychic' && move.type === '에스퍼') multiplier *= 1.3
  }
  if (isGrounded(defender, state) && terrainId === 'misty' && move.type === '드래곤') multiplier *= 0.5
  if (isGrounded(defender, state) && terrainId === 'grassy' && ['earthquake', 'bulldoze', 'magnitude'].includes(move.id)) multiplier *= 0.5
  if (
    weatherId === 'sandstorm'
    && attacker.ability === '모래의힘'
    && ['바위', '땅', '강철'].includes(move.type)
  ) multiplier *= 1.3
  return multiplier
}

function getMoveStab(pokemon, moveType) {
  if (!pokemon.teraActive) {
    return pokemon.types.includes(moveType)
      ? (pokemon.ability === '적응력' ? 2 : 1.5)
      : 1
  }

  if (pokemon.teraType === moveType) {
    if (pokemon.originalTypes.includes(moveType)) return pokemon.ability === '적응력' ? 2.25 : 2
    return pokemon.ability === '적응력' ? 2 : 1.5
  }

  return pokemon.originalTypes.includes(moveType) ? 1.5 : 1
}

function abilityImmunity(state, attacker, defender, move) {
  if (
    ALLY_DAMAGE_IMMUNITY_ABILITIES.has(defender.ability)
    && getPokemonSide(state, attacker).id === getPokemonSide(state, defender).id
    && !isStatusMove(move)
    && ['all', 'allAdjacent'].includes(move.target)
  ) return defender.ability
  const rule = TYPE_IMMUNITY_ABILITY_RULES[defender.ability]
  if (
    rule
    && (rule.type === move.type || rule.flag && move.flags?.includes(rule.flag))
  ) return defender.ability
  if (
    defender.ability === '불가사의부적'
    && !isStatusMove(move)
    && getMoveTypeEffectiveness(state, attacker, defender, move) <= 1
  ) return defender.ability
  return null
}

function applyAbilityImmunityEffect(state, defender, ability) {
  const rule = TYPE_IMMUNITY_ABILITY_RULES[ability]
  if (!rule) return false
  let applied = false
  if (rule.heal) {
    const [numerator, denominator] = rule.heal
    applied = healPokemon(state, defender, defender.maxHp * numerator / denominator, ability) > 0 || applied
  }
  if (rule.boosts) {
    applied = changeStages(state, defender, rule.boosts) || applied
  }
  if (rule.volatile) {
    defender[rule.volatile] = true
    appendLog(state, `${defender.name}은(는) ${ability}의 힘을 모았다!`, 'ability')
    applied = true
  }
  return applied
}

function moveDamageStatProfile(state, attacker, defender, move) {
  const rule = MOVE_DAMAGE_STAT_RULES[move.id]
  let category = move.categoryId ?? (move.category === '물리' ? 'physical' : 'special')
  const adaptiveMode = rule?.adaptive ?? (move.adaptiveOffense ? 'higher-offense' : null)

  if (adaptiveMode === 'higher-offense' || adaptiveMode === 'tera-only' && attacker.teraActive) {
    category = effectiveStat(state, attacker, 'attack') > effectiveStat(state, attacker, 'specialAttack')
      ? 'physical'
      : 'special'
  } else if (adaptiveMode === 'best-damage') {
    const physicalPressure = effectiveStat(state, attacker, 'attack')
      / Math.max(1, effectiveStat(state, defender, 'defense'))
    const specialPressure = effectiveStat(state, attacker, 'specialAttack')
      / Math.max(1, effectiveStat(state, defender, 'specialDefense'))
    category = physicalPressure > specialPressure ? 'physical' : 'special'
  }

  return {
    category,
    attackPokemon: rule?.attackSource === 'defender' ? defender : attacker,
    attackKey: rule?.attackStat ?? (category === 'physical' ? 'attack' : 'specialAttack'),
    defenseKey: rule?.defenseStat ?? (category === 'physical' ? 'defense' : 'specialDefense'),
  }
}

function lowHpMoveAbilityMultiplier(attacker, move) {
  const boostedType = LOW_HP_MOVE_ABILITY_TYPES[attacker.ability]
  return boostedType === move.type && attacker.hp <= attacker.maxHp / 3 ? 1.5 : 1
}

function supremeOverlordMultiplier(state, attacker) {
  if (attacker.ability !== '총대장') return 1
  const side = getPokemonSide(state, attacker)
  const faintedAllies = side.team.filter((pokemon) => (
    pokemon.battleId !== attacker.battleId && (pokemon.fainted || pokemon.hp <= 0)
  )).length
  return 1 + Math.min(5, faintedAllies) * 0.1
}

function movePowerAbilityMultiplier(state, attacker, defender, move, effectiveness, critical = false) {
  let multiplier = Number(move.abilityPowerMultiplier ?? 1)
  const rule = MOVE_POWER_ABILITY_RULES[attacker.ability]
  const ruleMatches = rule && (
    rule.type === move.type
    || rule.flag && move.flags?.includes(rule.flag)
    || rule.maxPower && Number(move.power) <= rule.maxPower
    || rule.recoil && (Boolean(move.recoil) || Boolean(move.hasCrashDamage))
  )
  if (ruleMatches) multiplier *= rule.multiplier
  if (attacker.flashFireActive && move.type === '불꽃') multiplier *= 1.5
  if (attacker.chargeActive && move.type === '전기') multiplier *= 2
  if (attacker.ability === '애널라이즈' && analyticBoostActive(state, attacker)) multiplier *= 1.3
  if (attacker.ability === '잠복' && defender.switchedInThisTurn) multiplier *= 2
  if (attacker.ability === '투쟁심' && attacker.gender && defender.gender) {
    multiplier *= attacker.gender === defender.gender ? 1.25 : 0.75
  }
  if (attacker.ability === '색안경' && effectiveness > 0 && effectiveness < 1) multiplier *= 2
  if (attacker.ability === '브레인포스' && effectiveness > 1) multiplier *= 1.25
  if (attacker.ability === '스나이퍼' && critical) multiplier *= 1.5

  const auraAbility = move.type === '페어리'
    ? '페어리오라'
    : move.type === '악' ? '다크오라' : null
  if (auraAbility && activePokemonWithAbility(state, auraAbility).length > 0) {
    multiplier *= activePokemonWithAbility(state, '오라브레이크').length > 0 ? 0.75 : 4 / 3
  }

  const side = getPokemonSide(state, attacker)
  const activeAllies = getActivePokemonList(state, side.id).filter((pokemon) => (
    pokemon
    && pokemon.battleId !== attacker.battleId
    && !pokemon.fainted
    && pokemon.hp > 0
  ))
  if (move.categoryId === 'special') {
    multiplier *= 1.3 ** activeAllies.filter((pokemon) => pokemon.ability === '배터리').length
  }
  multiplier *= 1.3 ** activeAllies.filter((pokemon) => pokemon.ability === '파워스폿').length
  if (move.type === '강철') {
    multiplier *= 1.5 ** activeAllies.filter((pokemon) => pokemon.ability === '강철정신').length
  }
  return multiplier
}

function defenderAbilityDamageMultiplier(state, attacker, defender, move, effectiveness) {
  if (move.ignoreAbility && !['스펙터가드', '프리즘아머'].includes(defender.ability)) return 1
  let multiplier = 1
  if (SUPER_EFFECTIVE_DAMAGE_REDUCTION_ABILITIES.has(defender.ability) && effectiveness > 1) multiplier *= 0.75
  if (defender.ability === '스펙터가드' && defender.hp === defender.maxHp) multiplier *= 0.5
  if (defender.ability === '복슬복슬') {
    if (move.flags?.includes('contact')) multiplier *= 0.5
    if (move.type === '불꽃') multiplier *= 2
  }
  if (defender.ability === '얼음인분' && move.categoryId === 'special') multiplier *= 0.5
  if (defender.ability === '내열' && move.type === '불꽃') multiplier *= 0.5
  if (defender.ability === '펑크록' && move.flags?.includes('sound')) multiplier *= 0.5
  if (defender.ability === '정화의소금' && move.type === '고스트') multiplier *= 0.5
  if (defender.ability === '수포' && move.type === '불꽃') multiplier *= 0.5

  const side = getPokemonSide(state, defender)
  const friendGuardCount = getActivePokemonList(state, side.id).filter((pokemon) => (
    pokemon
    && pokemon.battleId !== defender.battleId
    && !pokemon.fainted
    && pokemon.hp > 0
    && pokemon.ability === '프렌드가드'
  )).length
  return multiplier * 0.75 ** friendGuardCount
}

function calculateDamage(state, attacker, defender, move, random, powerMultiplier = 1) {
  const { category, attackPokemon, attackKey, defenseKey } = moveDamageStatProfile(
    state,
    attacker,
    defender,
    move,
  )
  const power = Math.max(1, Number(move.power) || 1) * powerMultiplier
  let attack = effectiveStat(state, attackPokemon, attackKey, {
    ignoreStages: !move.ignoreAbility && defender.ability === '천진' && attackPokemon !== defender,
  })
  let defense = effectiveStat(state, defender, defenseKey, {
    ignoreStages: !move.ignoreAbility && attacker.ability === '천진',
  })

  if (category === 'physical' && attacker.status?.id === 'burn' && attacker.ability !== '근성') attack *= 0.5
  if (attacker.ability === '의욕' && attackPokemon === attacker && attackKey === 'attack') attack *= 1.5
  if (attacker.ability === '근성' && attacker.status && attackPokemon === attacker && attackKey === 'attack') attack *= 1.5
  if (effectiveWeatherFamilyId(state) === 'snow' && defenseKey === 'defense' && defender.types.includes('얼음')) defense *= 1.5
  if (effectiveWeatherFamilyId(state) === 'sandstorm' && defenseKey === 'specialDefense' && defender.types.includes('바위')) defense *= 1.5
  const baseDamage = (((2 * 50) / 5 + 2) * power * attack / defense) / 50 + 2
  const standardEffectiveness = getMoveTypeEffectiveness(state, attacker, defender, move)
  const effectiveness = !move.ignoreAbility
    && defender.ability === '테라셸'
    && defender.hp === defender.maxHp
    && standardEffectiveness > 0
    ? 0.5
    : standardEffectiveness
  const criticalRates = [1 / 24, 1 / 8, 1 / 2, 1]
  const criticalStage = Math.max(0, Math.min(
    3,
    Number(move.critRatio ?? 0) + (attacker.ability === '대운' ? 1 : 0) + (attacker.criticalStageBoost ?? 0),
  ))
  const mercilessCritical = attacker.ability === '무도한행동'
    && ['poison', 'toxic'].includes(defender.status?.id)
  let critical = Boolean(move.willCrit) || mercilessCritical || random() < criticalRates[criticalStage]
  if (!move.ignoreAbility && CRITICAL_HIT_IMMUNITY_ABILITIES.has(defender.ability)) critical = false
  const randomFactor = 0.85 + random() * 0.15
  let modifier = getMoveStab(attacker, move.type)
    * effectiveness
    * environmentMoveMultiplier(state, attacker, defender, move)
    * randomFactor
    * (critical ? 1.5 : 1)

  if (hasActiveHeldItem(attacker, 'life-orb')) modifier *= 1.3
  if (hasActiveHeldItem(attacker, 'expert-belt') && effectiveness > 1) modifier *= 1.2
  if (attacker.ability === '우격다짐' && hasSheerForceEffect(move)) modifier *= 1.3
  modifier *= movePowerAbilityMultiplier(state, attacker, defender, move, effectiveness, critical)
  modifier *= lowHpMoveAbilityMultiplier(attacker, move)
  modifier *= supremeOverlordMultiplier(state, attacker)
  if (!move.ignoreAbility) {
    if (defender.ability === '멀티스케일' && defender.hp === defender.maxHp) modifier *= 0.5
    if (defender.ability === '두꺼운지방' && ['불꽃', '얼음'].includes(move.type)) modifier *= 0.5
    if (defender.ability === '건조피부' && move.type === '불꽃') modifier *= 1.25
  }
  modifier *= defenderAbilityDamageMultiplier(state, attacker, defender, move, effectiveness)

  const defenderSide = getPokemonSide(state, defender)
  if (defenderSide.auroraVeilTurns > 0 && !critical && attacker.ability !== '틈새포착') {
    modifier *= state.rules?.format?.activeSlots > 1 ? 2 / 3 : 0.5
  }

  return {
    damage: effectiveness === 0 ? 0 : Math.max(1, Math.floor(baseDamage * modifier)),
    effectiveness,
    critical,
  }
}

function matchingStatusCureBerry(state, target, statusId) {
  if (!heldItemEffectsActive(target) || berriesSuppressed(state, target)) return null
  const berry = STATUS_CURE_BERRIES[target.heldItemId]
  return berry?.statuses.includes(statusId) ? berry : null
}

function consumeStatusCureBerry(state, target) {
  const berry = matchingStatusCureBerry(state, target, target.status?.id)
  if (!berry) return false
  const statusLabel = target.status.label
  consumeHeldItem(state, target, { berry: true })
  target.status = null
  appendLog(state, `${target.name}은(는) ${berry.name}로 ${statusLabel} 상태를 회복했다!`, 'item')
  applyCheekPouch(state, target)
  return true
}

function applyCheekPouch(state, pokemon) {
  if (pokemon.ability !== '볼주머니' || pokemon.hp <= 0) return false
  appendLog(state, `${pokemon.name}의 볼주머니!`, 'ability')
  return healPokemon(state, pokemon, pokemon.maxHp / 3, '볼주머니') > 0
}

function berryEffectMultiplier(pokemon) {
  return pokemon.ability === '숙성' ? 2 : 1
}

function repeatCudChewBerry(state, pokemon, random) {
  const itemId = pokemon.cudChewItemId
  if (!itemId || pokemon.hp <= 0) return false
  const multiplier = berryEffectMultiplier(pokemon)
  let applied = false

  appendLog(state, `${pokemon.name}의 되새김질! 먹었던 나무열매를 다시 되새겼다!`, 'ability')
  if (itemId === 'sitrus-berry' && pokemon.healBlockTurns <= 0) {
    applied = healPokemon(state, pokemon, pokemon.maxHp * multiplier / 4, '되새김질') > 0
  } else if (PINCH_STAT_BERRIES[itemId]) {
    changeStages(state, pokemon, Object.fromEntries(
      Object.entries(PINCH_STAT_BERRIES[itemId]).map(([stat, amount]) => [stat, amount * multiplier]),
    ))
    applied = true
  } else if (itemId === 'lansat-berry') {
    pokemon.criticalStageBoost = Math.min(3, (pokemon.criticalStageBoost ?? 0) + 2 * multiplier)
    applied = true
  } else if (itemId === 'starf-berry') {
    const stats = ['attack', 'defense', 'specialAttack', 'specialDefense', 'speed']
    const stat = stats[Math.floor(random() * stats.length)]
    changeStages(state, pokemon, { [stat]: 2 * multiplier })
    applied = true
  } else if (itemId === 'custap-berry') {
    pokemon.custapActive = true
    applied = true
  } else {
    const berry = STATUS_CURE_BERRIES[itemId]
    if (berry?.statuses.includes(pokemon.status?.id)) {
      const statusLabel = pokemon.status.label
      pokemon.status = null
      appendLog(state, `${pokemon.name}은(는) 되새긴 ${berry.name}로 ${statusLabel} 상태를 회복했다!`, 'item')
      applied = true
    }
  }

  pokemon.cudChewReadyTurn = null
  pokemon.cudChewItemId = ''
  pokemon.cudChewItemName = ''
  if (applied) applyCheekPouch(state, pokemon)
  return applied
}

function consumeLowHpBerry(state, pokemon, random = Math.random) {
  if (
    !pokemon
    || pokemon.hp <= 0
    || !heldItemEffectsActive(pokemon)
    || berriesSuppressed(state, pokemon)
  ) return false

  const hpRatio = pokemon.hp / pokemon.maxHp
  const itemId = pokemon.heldItemId
  const itemName = pokemon.heldItemName || itemId
  const multiplier = berryEffectMultiplier(pokemon)
  let consumed = false
  if (itemId === 'sitrus-berry' && hpRatio <= 0.5 && pokemon.healBlockTurns <= 0) {
    consumeHeldItem(state, pokemon, { berry: true })
    healPokemon(state, pokemon, pokemon.maxHp * multiplier / 4, '자뭉열매')
    consumed = true
  } else {
    const pinchThreshold = pokemon.ability === '먹보' ? 0.5 : 0.25
    if (hpRatio > pinchThreshold) return false
    const statBoost = PINCH_STAT_BERRIES[itemId]
    if (statBoost) {
      consumeHeldItem(state, pokemon, { berry: true })
      appendLog(state, `${pokemon.name}은(는) ${itemName}을(를) 먹었다!`, 'item')
      changeStages(state, pokemon, Object.fromEntries(
        Object.entries(statBoost).map(([stat, amount]) => [stat, amount * multiplier]),
      ))
      consumed = true
    } else if (itemId === 'lansat-berry') {
      consumeHeldItem(state, pokemon, { berry: true })
      pokemon.criticalStageBoost = Math.min(3, (pokemon.criticalStageBoost ?? 0) + 2 * multiplier)
      appendLog(state, `${pokemon.name}은(는) 랑사열매로 급소율이 크게 올라갔다!`, 'item')
      consumed = true
    } else if (itemId === 'starf-berry') {
      const stats = ['attack', 'defense', 'specialAttack', 'specialDefense', 'speed']
      const stat = stats[Math.floor(random() * stats.length)]
      consumeHeldItem(state, pokemon, { berry: true })
      appendLog(state, `${pokemon.name}은(는) 스타열매를 먹었다!`, 'item')
      changeStages(state, pokemon, { [stat]: 2 * multiplier })
      consumed = true
    } else if (itemId === 'custap-berry') {
      consumeHeldItem(state, pokemon, { berry: true })
      pokemon.custapActive = true
      appendLog(state, `${pokemon.name}은(는) 애슈열매로 재빠르게 움직일 준비를 했다!`, 'item')
      consumed = true
    }
  }

  if (consumed) applyCheekPouch(state, pokemon)
  return consumed
}

function setStatus(
  state,
  target,
  statusId,
  sourceName,
  { source = null, ignoreAbility = false, synchronize = true } = {},
) {
  if (!STATUS_LABELS[statusId] || target.status || target.fainted || target.hp <= 0) return false
  if (!ignoreAbility && target.ability === '정화의소금') return false
  if (!ignoreAbility && target.ability === '리프가드' && effectiveWeatherFamilyId(state) === 'sun') return false
  if (
    !ignoreAbility
    && ['poison', 'toxic'].includes(statusId)
    && activeAllyHasAbility(state, target, PASTEL_VEIL_ABILITIES)
  ) return false
  if (
    !ignoreAbility
    && target.types.includes('풀')
    && getActivePokemonList(state, getPokemonSide(state, target).id).some((pokemon) => (
      pokemon && !pokemon.fainted && pokemon.hp > 0 && pokemon.ability === '플라워베일'
    ))
  ) return false
  if (statusId === 'burn' && target.types.includes('불꽃')) return false
  if (!ignoreAbility && statusId === 'burn' && ['수의베일', '수포', '열교환'].includes(target.ability)) return false
  if (
    (statusId === 'poison' || statusId === 'toxic')
    && target.types.some((type) => ['독', '강철'].includes(type))
    && source?.ability !== '부식'
  ) return false
  if (!ignoreAbility && (statusId === 'poison' || statusId === 'toxic') && target.ability === '면역') return false
  if (statusId === 'paralysis' && target.types.includes('전기')) return false
  if (!ignoreAbility && statusId === 'paralysis' && target.ability === '유연') return false
  if (statusId === 'freeze' && target.types.includes('얼음')) return false
  if (!ignoreAbility && statusId === 'freeze' && target.ability === '마그마의무장') return false
  if (statusId === 'freeze' && effectiveWeatherFamilyId(state) === 'sun') return false
  if (
    !ignoreAbility
    && target.ability === '리밋실드'
    && (currentSpeciesSlug(target) === 'minior' || currentSpeciesSlug(target).includes('meteor'))
  ) return false
  if (!ignoreAbility && statusId === 'sleep' && SLEEP_IMMUNE_ABILITIES.has(target.ability)) return false
  if (!ignoreAbility && target.ability === '절대안깸') return false
  if (
    !ignoreAbility
    && statusId === 'sleep'
    && getActivePokemonList(state, getPokemonSide(state, target).id).some((pokemon) => (
      pokemon && !pokemon.fainted && pokemon.hp > 0 && pokemon.ability === '스위트베일'
    ))
  ) return false
  if (isGrounded(target, state) && state.rules?.terrain?.id === 'misty') return false
  if (isGrounded(target, state) && state.rules?.terrain?.id === 'electric' && statusId === 'sleep') return false

  target.status = {
    id: statusId,
    label: STATUS_LABELS[statusId],
    counter: statusId === 'sleep' ? (target.ability === '일찍기상' ? 1 : 2) : 0,
    toxicCounter: statusId === 'toxic' ? 1 : 0,
  }
  appendLog(state, `${target.name}은(는) ${STATUS_LABELS[statusId]} 상태가 되었다!`, 'status')
  state.lastEvent = { kind: 'status', targetId: target.battleId, sourceName }
  if (
    source
    && source !== target
    && source.ability === '독조종'
    && ['poison', 'toxic'].includes(statusId)
  ) {
    appendLog(state, `${source.name}의 독조종!`, 'ability')
    applyVolatileEffect(state, target, 'confusion', source.ability, () => 0.5, '', { source })
  }
  consumeStatusCureBerry(state, target)
  if (
    synchronize
    && !ignoreAbility
    && target.ability === '싱크로'
    && source
    && source !== target
    && source.hp > 0
    && ['burn', 'paralysis', 'poison', 'toxic'].includes(statusId)
  ) {
    setStatus(state, source, statusId, target.ability, {
      source: target,
      synchronize: false,
    })
  }
  return true
}

function changeStages(
  state,
  pokemon,
  changes,
  { source = pokemon, ignoreAbility = false, reason = '', triggerOpportunist = true } = {},
) {
  const messages = []
  const abilityMultiplier = !ignoreAbility && pokemon.ability === '단순' ? 2 : 1
  const abilityDirection = !ignoreAbility && pokemon.ability === '심술꾸러기' ? -1 : 1
  const sourceSide = source ? getPokemonSide(state, source) : null
  const targetSide = getPokemonSide(state, pokemon)
  const hostile = Boolean(source && source !== pokemon && sourceSide.id !== targetSide.id)
  const reflectedChanges = {}
  const appliedBoosts = {}
  let blockedByAbility = false
  let loweredByOpponent = false

  Object.entries(normalizedStageChanges(changes)).forEach(([statKey, baseAmount]) => {
    const amount = baseAmount * abilityMultiplier * abilityDirection
    const abilityCanBeIgnored = ignoreAbility && pokemon.ability !== '메탈프로텍트'
    if (hostile && amount < 0 && !abilityCanBeIgnored) {
      const flowerVeilActive = pokemon.types.includes('풀')
        && getActivePokemonList(state, targetSide.id).some((ally) => (
          ally && !ally.fainted && ally.hp > 0 && ally.ability === '플라워베일'
        ))
      const protectedByAbility = FULL_STAT_DROP_IMMUNITY_ABILITIES.has(pokemon.ability)
        || pokemon.ability === '부풀린가슴' && statKey === 'defense'
        || pokemon.ability === '괴력집게' && statKey === 'attack'
        || ['날카로운눈', '발광'].includes(pokemon.ability) && statKey === 'accuracy'
        || reason === INTIMIDATE_REASON && INTIMIDATE_IMMUNITY_ABILITIES.has(pokemon.ability)
        || flowerVeilActive
      if (protectedByAbility) {
        blockedByAbility = true
        return
      }
      if (pokemon.ability === '미러아머' && source.hp > 0) {
        reflectedChanges[statKey] = (reflectedChanges[statKey] ?? 0) + amount
        return
      }
    }
    const previous = pokemon.statStages[statKey] ?? 0
    const next = Math.max(-6, Math.min(6, previous + amount))
    pokemon.statStages[statKey] = next
    if (next !== previous) {
      messages.push(`${STAT_LABELS[statKey]}${amount > 0 ? ' 상승' : ' 하락'}`)
      if (hostile && amount < 0) loweredByOpponent = true
      if (next > previous) appliedBoosts[statKey] = next - previous
    }
  })

  if (messages.length > 0) appendLog(state, `${pokemon.name}의 ${messages.join(' · ')}!`, 'status')
  if (blockedByAbility) appendLog(state, `${pokemon.name}의 ${pokemon.ability}! 능력이 떨어지지 않는다!`, 'ability')
  if (Object.keys(reflectedChanges).length > 0) {
    appendLog(state, `${pokemon.name}의 미러아머가 능력 하락을 되받아쳤다!`, 'ability')
    changeStages(state, source, reflectedChanges, { source: pokemon, ignoreAbility: true })
  }
  if (triggerOpportunist && Object.keys(appliedBoosts).length > 0) {
    const opposingSide = getOtherSide(state, targetSide.id)
    getActivePokemonList(state, opposingSide.id)
      .filter((opportunist) => (
        opportunist
        && !opportunist.fainted
        && opportunist.hp > 0
        && opportunist.ability === '편승'
      ))
      .forEach((opportunist) => {
        appendLog(state, `${opportunist.name}의 편승! 능력 상승에 올라탔다!`, 'ability')
        changeStages(state, opportunist, appliedBoosts, {
          source: opportunist,
          triggerOpportunist: false,
        })
      })
  }
  const reactionRule = loweredByOpponent ? STAT_DROP_REACTION_ABILITY_RULES[pokemon.ability] : null
  if (reactionRule) {
    appendLog(state, `${pokemon.name}의 ${pokemon.ability}!`, 'ability')
    changeStages(state, pokemon, reactionRule.boosts)
  }
  if (reason === INTIMIDATE_REASON && pokemon.ability === '주눅') {
    appendLog(state, `${pokemon.name}의 주눅!`, 'ability')
    changeStages(state, pokemon, { speed: 1 })
  }
  if (reason === INTIMIDATE_REASON && pokemon.ability === '파수견') {
    appendLog(state, `${pokemon.name}의 파수견!`, 'ability')
    changeStages(state, pokemon, { attack: 1 })
  }
  return messages.length > 0
}

function healPokemon(state, pokemon, amount, source, { bypassHealBlock = false } = {}) {
  if (!bypassHealBlock && pokemon.healBlockTurns > 0) {
    appendLog(state, `${pokemon.name}은(는) 회복봉인 때문에 HP를 회복할 수 없다!`, 'status')
    return 0
  }
  const healed = Math.min(Math.max(0, Math.floor(amount)), pokemon.maxHp - pokemon.hp)
  if (healed <= 0) return 0
  pokemon.hp += healed
  appendLog(state, `${pokemon.name}은(는) ${source}으로 HP를 ${healed} 회복했다.`, 'heal')
  return healed
}

function applyVolatileEffect(
  state,
  target,
  volatileStatus,
  sourceName,
  random,
  sourceMoveId = '',
  { source = null, ignoreAbility = false } = {},
) {
  if (!target || target.fainted || target.hp <= 0) return false

  if (
    !ignoreAbility
    && ['attract', 'disable', 'encore', 'healblock', 'infatuation', 'taunt', 'torment'].includes(volatileStatus)
    && aromaVeilProtects(state, target)
  ) {
    appendLog(state, `${target.name}은(는) 아로마베일에 보호받고 있다!`, 'ability')
    return false
  }

  if (
    !ignoreAbility
    && target.ability === '둔감'
    && ['attract', 'infatuation', 'taunt'].includes(volatileStatus)
  ) {
    appendLog(state, `${target.name}의 둔감! ${sourceName}의 효과를 받지 않는다!`, 'ability')
    return false
  }

  if (volatileStatus === 'confusion') {
    if (target.confusionTurns > 0 || !ignoreAbility && target.ability === '마이페이스') return false
    if (isGrounded(target, state) && state.rules?.terrain?.id === 'misty') return false
    target.confusionTurns = 2 + Math.floor(random() * 4)
    appendLog(state, `${target.name}은(는) 혼란에 빠졌다!`, 'status')
    return true
  }

  if (volatileStatus === 'flinch') {
    if (target.flinched || !ignoreAbility && target.ability === '정신력') return false
    target.flinched = true
    appendLog(state, `${target.name}은(는) 풀죽었다!`, 'status')
    if (!ignoreAbility && target.ability === '불굴의마음') {
      appendLog(state, `${target.name}의 불굴의마음!`, 'ability')
      changeStages(state, target, { speed: 1 })
    }
    return true
  }

  if (['followme', 'ragepowder', 'spotlight'].includes(volatileStatus)) {
    target.redirectTurns = 1
    target.redirectMode = volatileStatus
    appendLog(state, `${target.name}이(가) 공격을 자신에게 끌어모은다!`, 'status')
    return true
  }

  if (['attract', 'infatuation'].includes(volatileStatus)) {
    if (target.infatuated) return false
    if (!source?.gender || !target.gender || source.gender === target.gender) return false
    target.infatuated = true
    appendLog(state, `${target.name}은(는) 헤롱헤롱 상태가 되었다!`, 'status')
    return true
  }

  if (volatileStatus === 'torment') {
    if (target.tormented) return false
    target.tormented = true
    appendLog(state, `${target.name}은(는) 같은 기술을 연속해서 쓸 수 없게 되었다!`, 'status')
    return true
  }

  if (volatileStatus === 'yawn') {
    if (
      target.status
      || target.yawnTurns > 0
      || !ignoreAbility && SLEEP_IMMUNE_ABILITIES.has(target.ability)
    ) return false
    if (isGrounded(target, state) && ['electric', 'misty'].includes(state.rules?.terrain?.id)) return false
    target.yawnTurns = 2
    appendLog(state, `${target.name}은(는) 졸음이 쏟아지기 시작했다!`, 'status')
    return true
  }

  if (volatileStatus === 'destinybond') {
    target.destinyBondActive = true
    appendLog(state, `${target.name}은(는) 상대를 길동무로 삼으려 한다!`, 'status')
    return true
  }

  if (volatileStatus === 'sparklingaria') {
    if (target.status?.id !== 'burn') return false
    target.status = null
    appendLog(state, `${target.name}의 화상이 ${sourceName}으로 나았다!`, 'heal')
    return true
  }

  if (volatileStatus === 'saltcure') {
    if (target.saltCureActive) return false
    target.saltCureActive = true
    appendLog(state, `${target.name}은(는) 소금절이가 되어 버렸다!`, 'status')
    return true
  }

  if (volatileStatus === 'syrupbomb') {
    if (target.syrupBombTurns > 0) return false
    target.syrupBombTurns = 3
    appendLog(state, `${target.name}은(는) 끈적끈적한 시럽에 뒤덮였다!`, 'status')
    return true
  }

  if (volatileStatus === 'healblock') {
    if (target.healBlockTurns > 0) return false
    target.healBlockTurns = sourceMoveId === 'psychicnoise' ? 2 : 5
    appendLog(state, `${target.name}은(는) HP를 회복할 수 없게 되었다!`, 'status')
    return true
  }

  return false
}

function applyEffectPayload(state, attacker, defender, effect, random, sourceMove) {
  if (!effect) return false
  const sourceName = sourceMove?.name ?? String(sourceMove ?? '')
  const sourceMoveId = sourceMove?.id ?? ''
  let applied = false

  if (effect.status) {
    applied = setStatus(
      state,
      defender,
      SHOWDOWN_STATUS_IDS[effect.status] ?? effect.status,
      sourceName,
      { source: attacker, ignoreAbility: Boolean(sourceMove?.ignoreAbility) },
    ) || applied
  }
  if (effect.volatileStatus && !['lockedmove', 'mustrecharge'].includes(effect.volatileStatus)) {
    applied = applyVolatileEffect(
      state,
      defender,
      effect.volatileStatus,
      sourceName,
      random,
      sourceMoveId,
      { source: attacker, ignoreAbility: Boolean(sourceMove?.ignoreAbility) },
    ) || applied
  }
  if (effect.boosts && defender.hp > 0) {
    changeStages(state, defender, effect.boosts, {
      source: attacker,
      ignoreAbility: Boolean(sourceMove?.ignoreAbility),
    })
    applied = true
  }
  if (effect.self) {
    applied = applyEffectPayload(state, attacker, attacker, effect.self, random, sourceMove) || applied
  }

  return applied
}

function applyPrimaryMoveEffects(state, attacker, defender, move, random) {
  const target = move.target === 'self' ? attacker : defender
  const primaryEffect = {
    status: move.status,
    volatileStatus: move.volatileStatus,
    boosts: move.boosts,
  }
  const applied = applyEffectPayload(state, attacker, target, primaryEffect, random, move)
  let selfEffect = move.self
  if (Number(selfEffect?.chance) > 0) {
    selfEffect = attacker.ability !== '우격다짐'
      && random() * 100 < secondaryEffectChance(attacker, selfEffect)
      ? selfEffect
      : null
  }
  const selfApplied = applyEffectPayload(state, attacker, attacker, selfEffect, random, move)
  return applied || selfApplied
}

function applyEnvironmentFromMove(state, attacker, move) {
  const weatherId = SHOWDOWN_WEATHER_IDS[String(move.weather ?? move.id).toLowerCase()]
  const terrainId = SHOWDOWN_TERRAIN_IDS[String(move.terrain ?? move.id).toLowerCase()]
  const environmentMove = Boolean(weatherId || terrainId)
  let applied = false

  if (weatherId) applied = setTemporaryEnvironment(state, 'weather', weatherId, move.name, attacker) || applied
  if (terrainId) applied = setTemporaryEnvironment(state, 'terrain', terrainId, move.name, attacker) || applied

  if (move.id === 'defog') {
    const environmentState = ensureEnvironmentState(state)
    if (state.rules?.terrain?.id !== 'neutral' || environmentState.terrainTurns != null) {
      restoreBaseEnvironment(state, 'terrain', move.name)
      applied = true
    }
    if (state.rules?.weather?.id === 'fog' || environmentState.weatherTurns != null && effectiveWeatherId(state) === 'fog') {
      restoreBaseEnvironment(state, 'weather', move.name)
      applied = true
    }
  }

  return environmentMove || applied
}

function applyZPower(state, sideId, attacker, move) {
  if (!move.isZMove || !move.zPower) return false
  const { boost, effect } = move.zPower

  if (boost) {
    changeStages(state, attacker, boost)
    return true
  }
  if (effect === 'heal') {
    return healPokemon(state, attacker, attacker.maxHp, 'Z파워') > 0
  }
  if (effect === 'healreplacement') {
    getSide(state, sideId).zHealReplacement = true
    appendLog(state, 'Z파워가 다음에 교체될 포켓몬을 회복시킨다!', 'gimmick')
    return true
  }
  if (effect === 'clearnegativeboost') {
    let cleared = false
    Object.keys(attacker.statStages).forEach((statKey) => {
      if (attacker.statStages[statKey] >= 0) return
      attacker.statStages[statKey] = 0
      cleared = true
    })
    if (cleared) appendLog(state, `${attacker.name}의 떨어진 능력이 원래대로 돌아왔다!`, 'gimmick')
    return cleared
  }
  if (effect === 'redirect') {
    attacker.redirectTurns = 1
    attacker.redirectMode = 'followme'
    appendLog(state, `${attacker.name}이(가) 공격을 자신에게 끌어모은다!`, 'gimmick')
    return true
  }
  if (effect === 'crit2') {
    attacker.criticalStageBoost = Math.min(3, (attacker.criticalStageBoost ?? 0) + 2)
    appendLog(state, `${attacker.name}이(가) 급소를 노리고 있다!`, 'gimmick')
    return true
  }
  if (effect === 'curse') {
    if (attacker.types.includes('고스트')) return healPokemon(state, attacker, attacker.maxHp, 'Z파워') > 0
    changeStages(state, attacker, { attack: 1 })
    return true
  }
  return false
}

function applyZMoveEffect(state, attacker, move) {
  const effect = move.zMoveEffect
  if (!move.isZMove || !effect) return false
  if (effect.kind === 'terrain') {
    return setTemporaryEnvironment(state, 'terrain', effect.id, move.name, attacker)
  }
  if (effect.kind === 'clearTerrain') {
    const environmentState = ensureEnvironmentState(state)
    if (state.rules?.terrain?.id === 'neutral' && environmentState.terrainTurns == null) return false
    restoreBaseEnvironment(state, 'terrain', move.name)
    return true
  }
  return false
}

function maxMoveEffectTargets(state, sideId, effect, defender) {
  if (effect.side === 'allies') return getActivePokemonList(state, sideId)
  if (effect.side === 'opponents') return getActivePokemonList(state, getOtherSide(state, sideId).id)
  return [defender]
}

function applyMaxMoveEffect(state, sideId, attacker, defender, move, random) {
  const effect = move.maxMoveEffect
  if (!move.isMaxMove || !effect || effect.kind === 'none' || effect.kind === 'guard') return false

  const sourceSide = getSide(state, sideId)
  const targetSide = getOtherSide(state, sideId)
  const targets = maxMoveEffectTargets(state, sideId, effect, defender)
    .filter((pokemon) => pokemon && !pokemon.fainted && pokemon.hp > 0)

  if (effect.kind === 'weather') {
    return setTemporaryEnvironment(state, 'weather', effect.id, move.name, attacker)
  }
  if (effect.kind === 'terrain') {
    return setTemporaryEnvironment(state, 'terrain', effect.id, move.name, attacker)
  }
  if (effect.kind === 'stages') {
    targets.forEach((pokemon) => changeStages(state, pokemon, effect.changes, {
      source: attacker,
      ignoreAbility: Boolean(move.ignoreAbility),
    }))
    return targets.length > 0
  }
  if (effect.kind === 'status') {
    return targets.reduce((applied, pokemon) => (
      setStatus(state, pokemon, effect.status, move.name, {
        source: attacker,
        ignoreAbility: Boolean(move.ignoreAbility),
      }) || applied
    ), false)
  }
  if (effect.kind === 'randomStatus') {
    return targets.reduce((applied, pokemon) => {
      const status = effect.statuses[Math.floor(random() * effect.statuses.length)]
      return setStatus(state, pokemon, status, move.name) || applied
    }, false)
  }
  if (effect.kind === 'volatile') {
    return targets.reduce((applied, pokemon) => (
      applyVolatileEffect(
        state,
        pokemon,
        effect.volatileStatus,
        move.name,
        random,
        move.id,
        { source: attacker, ignoreAbility: Boolean(move.ignoreAbility) },
      ) || applied
    ), false)
  }
  if (effect.kind === 'critical') {
    targets.forEach((pokemon) => {
      pokemon.criticalStageBoost = Math.min(3, (pokemon.criticalStageBoost ?? 0) + effect.amount)
      appendLog(state, `${pokemon.name}의 급소율이 올라갔다!`, 'status')
    })
    return targets.length > 0
  }
  if (effect.kind === 'trap') {
    targets.forEach((pokemon) => {
      pokemon.trappedTurns = effect.duration
      pokemon.trapSourceName = move.name
      pokemon.trapDamages = Boolean(effect.damage)
      appendLog(state, `${pokemon.name}은(는) ${move.name}에 갇혔다!`, 'status')
    })
    return targets.length > 0
  }
  if (effect.kind === 'auroraVeil') {
    sourceSide.auroraVeilTurns = effect.duration
    appendLog(state, '아군 진영이 오로라베일에 둘러싸였다!', 'field')
    return true
  }
  if (effect.kind === 'infatuation') {
    return targets.reduce((applied, pokemon) => (
      applyVolatileEffect(
        state,
        pokemon,
        'infatuation',
        move.name,
        random,
        move.id,
        { source: attacker, ignoreAbility: Boolean(move.ignoreAbility) },
      ) || applied
    ), false)
  }
  if (effect.kind === 'restoreBerry') {
    return targets.reduce((restored, pokemon) => {
      if (!pokemon.consumedItem || !pokemon.heldItemId?.endsWith('-berry') || random() * 100 >= effect.chance) {
        return restored
      }
      pokemon.consumedItem = false
      appendLog(state, `${pokemon.name}의 나무열매가 되살아났다!`, 'item')
      return true
    }, false)
  }
  if (effect.kind === 'hazard') {
    targetSide.hazards[effect.hazard] = true
    appendLog(
      state,
      effect.hazard === 'stealthRock'
        ? '상대 진영에 뾰족한 바위가 떠다니기 시작했다!'
        : '상대 진영에 날카로운 강철이 흩뿌려졌다!',
      'field',
    )
    return true
  }
  if (effect.kind === 'clearField') {
    restoreBaseEnvironment(state, 'terrain', move.name)
    ;[sourceSide, targetSide].forEach((side) => {
      side.auroraVeilTurns = 0
      side.gmaxResidual = null
      side.hazards = { stealthRock: false, steelsurge: false, toxicSpikes: 0 }
    })
    appendLog(state, `${move.name}이(가) 필드와 진영의 효과를 날려버렸다!`, 'field')
    return true
  }
  if (effect.kind === 'heal') {
    const [numerator, denominator] = effect.fraction
    return targets.reduce((healed, pokemon) => (
      healPokemon(state, pokemon, pokemon.maxHp * numerator / denominator, move.name) > 0 || healed
    ), false)
  }
  if (effect.kind === 'lastMovePp') {
    return targets.reduce((deducted, pokemon) => {
      const lastMove = pokemon.moves[pokemon.lastMoveIndex]
      if (!lastMove || lastMove.currentPp <= 0) return deducted
      const amount = Math.min(effect.amount, lastMove.currentPp)
      lastMove.currentPp -= amount
      appendLog(state, `${pokemon.name}의 ${lastMove.name} PP가 ${amount} 줄었다!`, 'status')
      return true
    }, false)
  }
  if (effect.kind === 'gravity') {
    state.environment.gravityTurns = effect.duration
    appendLog(state, '중력이 강해져 모두가 땅에 붙들렸다!', 'field')
    return true
  }
  if (effect.kind === 'residual') {
    targetSide.gmaxResidual = {
      moveId: move.id,
      moveName: move.name,
      immuneType: effect.immuneType,
      turns: 4,
    }
    appendLog(state, `${move.name}의 여파가 상대 진영을 감쌌다!`, 'field')
    return true
  }
  if (effect.kind === 'yawn') {
    return targets.reduce((applied, pokemon) => (
      random() * 100 < effect.chance
        ? applyVolatileEffect(
          state,
          pokemon,
          'yawn',
          move.name,
          random,
          move.id,
          { source: attacker, ignoreAbility: Boolean(move.ignoreAbility) },
        ) || applied
        : applied
    ), false)
  }
  if (effect.kind === 'cureStatus') {
    return targets.reduce((cured, pokemon) => {
      if (!pokemon.status) return cured
      pokemon.status = null
      appendLog(state, `${pokemon.name}의 상태 이상이 회복되었다!`, 'heal')
      return true
    }, false)
  }
  if (effect.kind === 'torment') {
    return targets.reduce((applied, pokemon) => (
      applyVolatileEffect(
        state,
        pokemon,
        'torment',
        move.name,
        random,
        move.id,
        { source: attacker, ignoreAbility: Boolean(move.ignoreAbility) },
      ) || applied
    ), false)
  }

  return false
}

function applyEnvironmentAfterDamagingMove(state, sideId, attacker, defender, move, random) {
  let applied = false

  applied = applyZMoveEffect(state, attacker, move) || applied
  applied = applyMaxMoveEffect(state, sideId, attacker, defender, move, random) || applied

  if (!defender.fainted && defender.ability === '모래뿜기') {
    appendLog(state, `${defender.name}의 모래뿜기!`, 'ability')
    applied = setTemporaryEnvironment(state, 'weather', 'sandstorm', '모래뿜기', defender) || applied
  }
  if (!defender.fainted && defender.ability === '넘치는씨') {
    appendLog(state, `${defender.name}의 넘치는씨!`, 'ability')
    applied = setTemporaryEnvironment(state, 'terrain', 'grassy', '넘치는씨', defender) || applied
  }

  return applied
}

function healingMoveFraction(state, pokemon, move) {
  const activeWeatherId = effectiveMoveWeatherId(state, pokemon)
  const weatherId = weatherFamilyId(activeWeatherId)
  if (WEATHER_HEAL_MOVE_IDS.has(move.id)) {
    if (weatherId === 'sun') return [2, 3]
    if (activeWeatherId !== 'clear') return [1, 4]
    return [1, 2]
  }
  if (move.id === 'shoreup') return weatherId === 'sandstorm' ? [2, 3] : [1, 2]
  return move.heal ?? [1, 2]
}

function applyTransform(state, attacker, defender) {
  if (!defender || defender.fainted || defender.hp <= 0 || attacker === defender) return false

  if (!attacker.transformSnapshot) {
    attacker.transformSnapshot = {
      speciesId: attacker.speciesId,
      name: attacker.name,
      types: [...attacker.types],
      originalTypes: [...attacker.originalTypes],
      ability: attacker.ability,
      stats: { ...attacker.stats },
      moves: attacker.moves.map((move) => ({ ...move })),
      spriteFront: attacker.spriteFront,
      spriteBack: attacker.spriteBack,
      spriteFrontFallback: attacker.spriteFrontFallback,
      spriteBackFallback: attacker.spriteBackFallback,
    }
  }

  const originalHpStat = attacker.stats.hp
  attacker.speciesId = defender.speciesId
  attacker.name = defender.name
  attacker.types = [...defender.types]
  attacker.originalTypes = [...defender.types]
  attacker.ability = defender.ability
  attacker.stats = { ...defender.stats, hp: originalHpStat }
  attacker.moves = defender.moves.map((move, index) => ({
    ...moveRuntime(move, index),
    maxPp: 5,
    currentPp: 5,
  }))
  attacker.spriteFront = defender.spriteFront
  attacker.spriteBack = defender.spriteBack
  attacker.spriteFrontFallback = defender.spriteFrontFallback
  attacker.spriteBackFallback = defender.spriteBackFallback
  appendLog(state, `${attacker.transformSnapshot.name}은(는) ${defender.name}의 모습으로 변신했다!`, 'status')
  return true
}

function applyStatusMove(state, attacker, defender, move, random) {
  if (PROTECT_MOVE_IDS.has(move.id)) {
    const successRate = 1 / Math.max(1, 3 ** attacker.protectChain)
    if (random() <= successRate) {
      attacker.protected = true
      attacker.protectMode = move.id
      attacker.protectChain += 1
      appendLog(state, `${attacker.name}은(는) 몸을 지키고 있다!`, 'status')
    } else {
      attacker.protectMode = null
      attacker.protectChain = 0
      appendLog(state, '그러나 실패하고 말았다!', 'muted')
    }
    return true
  }

  attacker.protectChain = 0
  const environmentApplied = applyEnvironmentFromMove(state, attacker, move)

  if (move.id === 'transform') {
    if (!applyTransform(state, attacker, defender)) appendLog(state, '그러나 변신에 실패했다!', 'muted')
    return true
  }

  if (move.id === 'revivalblessing') {
    const side = getPokemonSide(state, attacker)
    const target = side.team
      .filter((pokemon) => pokemon.fainted || pokemon.hp <= 0)
      .sort((first, second) => {
        const firstStats = Object.values(first.stats).reduce((total, value) => total + Number(value || 0), 0)
        const secondStats = Object.values(second.stats).reduce((total, value) => total + Number(value || 0), 0)
        return secondStats - firstStats || second.maxHp - first.maxHp
      })[0]
    if (!target) {
      appendLog(state, '그러나 되살릴 포켓몬이 없었다!', 'muted')
      return true
    }
    target.fainted = false
    target.hp = Math.max(1, Math.floor(target.maxHp / 2))
    target.status = null
    clearSwitchVolatiles(target)
    appendLog(state, `${target.name}은(는) 회생의기도로 다시 일어났다!`, 'heal')
    return true
  }

  if (move.id === 'rest') {
    const previousStatus = attacker.status
    attacker.status = null
    if (!setStatus(state, attacker, 'sleep', move.name)) {
      attacker.status = previousStatus
      appendLog(state, `${attacker.name}은(는) 잠들 수 없어 잠자기에 실패했다!`, 'muted')
      return true
    }
    attacker.hp = attacker.maxHp
    appendLog(state, `${attacker.name}은(는) 푹 잠들어 HP를 모두 회복했다.`, 'heal')
    return true
  }

  if (move.id === 'perishsong') {
    ;[attacker, defender].forEach((pokemon) => {
      if (pokemon.hp > 0 && pokemon.perishCount == null) pokemon.perishCount = 4
    })
    appendLog(state, '두 포켓몬 모두 멸망의노래를 들었다!', 'status')
    return true
  }

  if (['healingwish', 'lunardance'].includes(move.id)) {
    const side = state.player.team.includes(attacker) ? state.player : state.opponent
    side.healingWishPending = move.id
    appendLog(state, `${attacker.name}은(는) 뒤이어 나올 포켓몬에게 소원을 맡겼다!`, 'heal')
    return true
  }

  if (move.heal || HEAL_MOVE_IDS.has(move.id)) {
    const [numerator, denominator] = healingMoveFraction(state, attacker, move)
    healPokemon(state, attacker, attacker.maxHp * numerator / denominator, move.name)
    return true
  }

  if (move.id === 'autotomize') {
    attacker.weightReduction = Math.min(10000, (attacker.weightReduction ?? 0) + 1000)
    appendLog(state, `${attacker.name}은(는) 몸을 깎아 무게가 100kg 줄었다!`, 'status')
  }

  if (applyPrimaryMoveEffects(state, attacker, defender, move, random)) return true

  const scriptedEffect = STATUS_MOVE_EFFECTS[move.id]
  if (scriptedEffect?.self) changeStages(state, attacker, scriptedEffect.self)
  if (scriptedEffect?.target) {
    changeStages(state, defender, scriptedEffect.target, {
      source: attacker,
      ignoreAbility: Boolean(move.ignoreAbility),
    })
  }
  if (scriptedEffect) return true
  if (environmentApplied) return true

  appendLog(state, `${move.name}의 전술 효과가 전개되었다.`, 'status')
  return true
}

function secondaryStatusFromDescription(state, attacker, defender, move, random) {
  const description = move.description ?? ''
  const percent = Number(description.match(/(\d+)%/)?.[1] ?? 0)
  if (!percent || random() * 100 >= percent) return false

  const options = { source: attacker, ignoreAbility: Boolean(move.ignoreAbility) }
  if (description.includes('화상')) return setStatus(state, defender, 'burn', move.name, options)
  if (description.includes('마비')) return setStatus(state, defender, 'paralysis', move.name, options)
  if (description.includes('얼음 상태')) return setStatus(state, defender, 'freeze', move.name, options)
  if (description.includes('독 상태')) return setStatus(state, defender, 'poison', move.name, options)
  if (description.includes('풀죽')) {
    return applyVolatileEffect(state, defender, 'flinch', move.name, random, move.id, options)
  }
  return false
}

function applyMoveSecondaries(state, attacker, defender, move, random, attempts = 1) {
  const effects = moveSecondaryEffects(move)
  if (effects.length === 0) return secondaryStatusFromDescription(state, attacker, defender, move, random)
  if (attacker.ability === '우격다짐') return false

  let applied = false
  const targetEffectBlocked = (!move.ignoreAbility && defender.ability === '인분')
    || hasActiveHeldItem(defender, 'covert-cloak')
  for (let attempt = 0; attempt < Math.max(1, attempts); attempt += 1) {
    effects.forEach((effect) => {
      if (random() * 100 >= secondaryEffectChance(attacker, effect)) return

      if (targetEffectBlocked) {
        if (effect.self) {
          applied = applyEffectPayload(state, attacker, attacker, effect.self, random, move) || applied
        }
        return
      }
      applied = applyEffectPayload(state, attacker, defender, effect, random, move) || applied
    })
  }
  return applied
}

function applyHpCrossingAbility(state, pokemon, previousHp) {
  const rule = HP_CROSSING_ABILITY_RULES[pokemon.ability]
  if (
    !rule
    || pokemon.fainted
    || pokemon.hp <= 0
    || previousHp <= pokemon.maxHp / 2
    || pokemon.hp > pokemon.maxHp / 2
  ) return false

  appendLog(state, `${pokemon.name}의 ${pokemon.ability}!`, 'ability')
  changeStages(state, pokemon, rule.boosts)
  return true
}

function highestBattleStatKey(pokemon) {
  return ['attack', 'defense', 'specialAttack', 'specialDefense', 'speed']
    .reduce((best, key) => pokemon.stats[key] > pokemon.stats[best] ? key : best, 'attack')
}

function applyKnockoutAbility(state, attacker) {
  const rule = KNOCKOUT_STAT_ABILITY_RULES[attacker.ability]
  if (!rule || attacker.fainted || attacker.hp <= 0) return false
  const boosts = rule.highestStat ? { [highestBattleStatKey(attacker)]: 1 } : rule.boosts
  appendLog(state, `${attacker.name}의 ${attacker.ability}!`, 'ability')
  changeStages(state, attacker, boosts)
  return true
}

function confusionSelfDamage(state, pokemon, random) {
  const attack = effectiveStat(state, pokemon, 'attack')
  const defense = effectiveStat(state, pokemon, 'defense')
  const baseDamage = (((2 * 50) / 5 + 2) * 40 * attack / defense) / 50 + 2
  return Math.max(1, Math.floor(baseDamage * (0.85 + random() * 0.15)))
}

function canPokemonAct(state, pokemon, random, move) {
  if (pokemon.commanding) return false

  if (pokemon.rechargeTurns > 0) {
    pokemon.rechargeTurns -= 1
    pokemon.truantLoafing = false
    appendLog(state, `${pokemon.name}은(는) 공격의 반동으로 움직일 수 없다!`, 'status')
    return false
  }

  if (pokemon.status?.id === 'sleep') {
    pokemon.truantLoafing = false
    pokemon.status.counter -= 1
    if (pokemon.status.counter > 0) {
      appendLog(state, `${pokemon.name}은(는) 쿨쿨 잠들어 있다.`, 'status')
      return false
    }
    pokemon.status = null
    appendLog(state, `${pokemon.name}은(는) 잠에서 깨어났다!`, 'heal')
  }

  if (pokemon.status?.id === 'freeze') {
    if (move?.flags?.includes('defrost')) {
      pokemon.status = null
      appendLog(state, `${pokemon.name}은(는) 기술의 열기로 얼음을 녹였다!`, 'heal')
    } else if (random() >= 0.2) {
      appendLog(state, `${pokemon.name}은(는) 얼어붙어 움직일 수 없다!`, 'status')
      return false
    } else {
      pokemon.status = null
      appendLog(state, `${pokemon.name}의 얼음이 녹았다!`, 'heal')
    }
  }

  if (pokemon.ability === '게으름') {
    if (pokemon.truantLoafing) {
      pokemon.truantLoafing = false
      appendLog(state, `${pokemon.name}은(는) 게으름 때문에 농땡이를 피우고 있다!`, 'ability')
      return false
    }
    pokemon.truantLoafing = true
  }

  if (pokemon.flinched) {
    pokemon.flinched = false
    appendLog(state, `${pokemon.name}은(는) 풀죽어서 움직일 수 없다!`, 'status')
    return false
  }

  if (pokemon.status?.id === 'paralysis' && random() < 0.25) {
    appendLog(state, `${pokemon.name}은(는) 몸이 저려 움직일 수 없다!`, 'status')
    return false
  }

  if (pokemon.infatuated && random() < 0.5) {
    appendLog(state, `${pokemon.name}은(는) 헤롱헤롱해서 기술을 쓸 수 없다!`, 'status')
    return false
  }

  if (pokemon.confusionTurns > 0) {
    appendLog(state, `${pokemon.name}은(는) 혼란에 빠져 있다!`, 'status')
    const finalConfusionTurn = pokemon.confusionTurns === 1
    pokemon.confusionTurns -= 1
    if (random() < 0.5) {
      const damage = Math.min(pokemon.hp, confusionSelfDamage(state, pokemon, random))
      pokemon.hp = Math.max(0, pokemon.hp - damage)
      appendLog(state, `${pokemon.name}은(는) 영문도 모른 채 자신을 공격했다!`, 'damage')
      return false
    }
    if (finalConfusionTurn) appendLog(state, `${pokemon.name}은(는) 혼란이 풀렸다!`, 'heal')
  }

  return true
}

function relatedFormBySlug(pokemon, slug) {
  return getRelatedFormOptions(pokemon.originalSpeciesId)
    .find((form) => form.slug === slug) ?? null
}

function changeBattleForm(state, pokemon, targetFormOrSlug, sourceName, options = {}) {
  const form = typeof targetFormOrSlug === 'string'
    ? relatedFormBySlug(pokemon, targetFormOrSlug)
    : targetFormOrSlug
  if (!form || Number(form.id) === Number(pokemon.speciesId)) return false

  const previousName = pokemon.name
  const previousHp = pokemon.hp
  const previousMaxHp = pokemon.maxHp
  const preservedAbility = form.abilities.includes(pokemon.ability)
    ? pokemon.ability
    : form.abilities[0]
  const transformed = normalizePokemon({
    ...pokemon,
    speciesId: form.id,
    ability: preservedAbility,
    moves: pokemon.moves.map((move) => move.name),
  })
  const nextStats = statObject(transformed)
  const nextBaseMaxHp = Math.max(
    1,
    Math.floor(nextStats.hp * (pokemon.difficultyHpMultiplier ?? 1)),
  )
  nextStats.hp = nextBaseMaxHp
  const nextMaxHp = pokemon.dynamaxActive ? nextBaseMaxHp * 2 : nextBaseMaxHp
  const preservedHp = options.hpMode === 'damage'
    ? nextMaxHp - Math.max(0, previousMaxHp - previousHp)
    : nextMaxHp * (previousHp / Math.max(1, previousMaxHp))

  pokemon.speciesId = form.id
  pokemon.dexSpeciesId = transformed.dexSpeciesId
  pokemon.slug = form.slug
  pokemon.name = form.name
  pokemon.types = pokemon.teraActive ? [pokemon.teraType] : [...form.types]
  pokemon.ability = preservedAbility
  pokemon.stats = nextStats
  pokemon.originalMaxHp = nextBaseMaxHp
  pokemon.maxHp = nextMaxHp
  pokemon.hp = previousHp <= 0 ? 0 : Math.max(1, Math.min(nextMaxHp, Math.ceil(preservedHp)))
  pokemon.spriteFront = transformed.spriteFront
  pokemon.spriteBack = transformed.spriteBack
  pokemon.spriteFrontFallback = transformed.spriteFrontFallback
  pokemon.spriteBackFallback = transformed.spriteBackFallback

  if (options.log !== false) {
    appendLog(state, `${pokemon.name}의 ${sourceName}! ${previousName}에서 모습이 변했다!`, 'ability')
  }
  state.lastEvent = {
    kind: 'form',
    pokemonId: pokemon.battleId,
    sourceName,
    speciesId: form.id,
    nonce: state.eventNonce += 1,
  }
  return true
}

function restorePokemonOwnTypes(pokemon) {
  if (pokemon.teraActive) {
    pokemon.types = [pokemon.teraType]
    return
  }
  const profile = getSpeciesProfile(pokemon.speciesId)
  pokemon.types = [...(profile?.types ?? pokemon.originalTypes)]
}

function refreshHeldItemTypeAbility(state, pokemon) {
  if (pokemon.teraActive || !['멀티타입', 'AR시스템'].includes(pokemon.ability)) return false
  const itemMatchesAbility = pokemon.ability === '멀티타입'
    ? /(?:-plate|ium-z--held)$/.test(pokemon.heldItemId ?? '')
    : pokemon.heldItemId?.endsWith('-memory')
  const itemType = itemMatchesAbility ? HELD_ITEM_TYPE_BY_ID[pokemon.heldItemId] ?? '노말' : '노말'
  if (pokemon.types.length === 1 && pokemon.types[0] === itemType) return false
  pokemon.types = [itemType]
  appendLog(state, `${pokemon.name}의 ${pokemon.ability}! ${itemType}타입이 되었다!`, 'ability')
  return true
}

function refreshParadoxAbility(state, pokemon) {
  if (!['고대활성', '쿼크차지'].includes(pokemon.ability)) return false
  const environmentActive = pokemon.ability === '고대활성'
    ? effectiveWeatherId(state) === 'sun'
    : state.rules?.terrain?.id === 'electric'
  const wasEnvironmentActive = Boolean(pokemon.paradoxEnvironmentActive)
  pokemon.paradoxEnvironmentActive = environmentActive

  if (!environmentActive && !pokemon.paradoxBoosterActive && hasActiveHeldItem(pokemon, 'booster-energy')) {
    consumeHeldItem(state, pokemon)
    pokemon.paradoxBoosterActive = true
    appendLog(state, `${pokemon.name}은(는) 부스트에너지를 소모해 ${pokemon.ability}을(를) 발동했다!`, 'ability')
    return true
  }
  if (environmentActive !== wasEnvironmentActive) {
    appendLog(
      state,
      environmentActive
        ? `${pokemon.name}의 ${pokemon.ability}이(가) 환경의 에너지에 반응했다!`
        : `${pokemon.name}의 ${pokemon.ability} 환경 효과가 사라졌다.`,
      'ability',
    )
    return true
  }
  return false
}

function refreshWeatherFormAbility(state, pokemon) {
  const rule = WEATHER_FORM_RULES[pokemon.ability]
  if (rule) {
    const targetSlug = rule.forms[effectiveWeatherFamilyId(state)] ?? rule.baseSlug
    changeBattleForm(state, pokemon, targetSlug, pokemon.ability)
  }

  if (pokemon.ability === '플라워기프트') {
    const active = effectiveWeatherFamilyId(state) === 'sun'
    if (active !== pokemon.flowerGiftActive) {
      pokemon.flowerGiftActive = active
      appendLog(state, `${pokemon.name}의 플라워기프트가 ${active ? '발동했다!' : '해제되었다.'}`, 'ability')
    }
  }

  if (
    pokemon.ability === '아이스페이스'
    && pokemon.iceFaceBroken
    && effectiveWeatherFamilyId(state) === 'snow'
    && currentSpeciesSlug(pokemon) === 'eiscue-noice'
  ) {
    if (changeBattleForm(state, pokemon, 'eiscue', pokemon.ability)) pokemon.iceFaceBroken = false
  }
  refreshParadoxAbility(state, pokemon)
}

function refreshTerrainTypeAbility(state, pokemon) {
  if (pokemon.ability !== '의태' || pokemon.teraActive) return
  const terrainType = TERRAIN_TYPE_BY_ID[state.rules?.terrain?.id]
  if (terrainType) {
    if (!pokemon.mimicryActive || pokemon.types[0] !== terrainType || pokemon.types.length !== 1) {
      pokemon.types = [terrainType]
      pokemon.mimicryActive = true
      appendLog(state, `${pokemon.name}의 의태! ${terrainType}타입이 되었다!`, 'ability')
    }
  } else if (pokemon.mimicryActive) {
    pokemon.mimicryActive = false
    restorePokemonOwnTypes(pokemon)
    appendLog(state, `${pokemon.name}의 타입이 원래대로 돌아왔다.`, 'ability')
  }
  refreshParadoxAbility(state, pokemon)
}

function refreshEnvironmentDependentAbilities(state, kind = null) {
  ;['player', 'opponent'].forEach((sideId) => {
    getActivePokemonList(state, sideId)
      .filter((pokemon) => pokemon && !pokemon.fainted && pokemon.hp > 0)
      .forEach((pokemon) => {
        if (!kind || kind === 'weather') refreshWeatherFormAbility(state, pokemon)
        if (!kind || kind === 'terrain') refreshTerrainTypeAbility(state, pokemon)
      })
  })
}

function miniorFormSlug(pokemon, meteor) {
  const slug = currentSpeciesSlug(pokemon)
  const color = slug.match(/^minior-(orange|yellow|green|blue|indigo|violet)/)?.[1] ?? 'red'
  if (meteor) return color === 'red' ? 'minior' : `minior-${color}-meteor`
  return `minior-${color}`
}

function refreshHpFormAbility(state, pokemon, trigger = 'residual') {
  if (!pokemon || pokemon.fainted || pokemon.hp <= 0) return false
  const hpRatio = pokemon.hp / Math.max(1, pokemon.maxHp)
  const slug = currentSpeciesSlug(pokemon)

  if (pokemon.ability === '어군' && Number(pokemon.level ?? 100) >= 20) {
    return changeBattleForm(state, pokemon, hpRatio > 0.25 ? 'wishiwashi-school' : 'wishiwashi', pokemon.ability)
  }
  if (pokemon.ability === '리밋실드') {
    return changeBattleForm(state, pokemon, miniorFormSlug(pokemon, hpRatio > 0.5), pokemon.ability)
  }
  if (pokemon.ability === '달마모드') {
    const galar = slug.includes('galar')
    const targetSlug = hpRatio <= 0.5
      ? galar ? 'darmanitan-galar-zen' : 'darmanitan-zen'
      : galar ? 'darmanitan-galar-standard' : 'darmanitan'
    return changeBattleForm(state, pokemon, targetSlug, pokemon.ability)
  }
  if (
    trigger === 'residual'
    && pokemon.ability === '스웜체인지'
    && hpRatio <= 0.5
    && slug !== 'zygarde-complete'
  ) {
    return changeBattleForm(state, pokemon, 'zygarde-complete', pokemon.ability, { hpMode: 'damage' })
  }
  if (pokemon.ability === '꼬르륵스위치' && trigger === 'residual' && !pokemon.teraActive) {
    const targetSlug = slug === 'morpeko-hangry' ? 'morpeko' : 'morpeko-hangry'
    return changeBattleForm(state, pokemon, targetSlug, pokemon.ability)
  }
  return false
}

function activateFormEntryAbility(state, sideId, activeSlot, pokemon) {
  if (pokemon.ability === '테라체인지' && currentSpeciesSlug(pokemon) === 'terapagos') {
    changeBattleForm(state, pokemon, 'terapagos-terastal', pokemon.ability, { hpMode: 'damage' })
  }
  refreshHpFormAbility(state, pokemon, 'entry')
  refreshHeldItemTypeAbility(state, pokemon)
  refreshWeatherFormAbility(state, pokemon)
  refreshTerrainTypeAbility(state, pokemon)

  if (pokemon.ability === '괴짜' && !pokemon.transformSnapshot) {
    const opposing = getActivePokemon(state, sideId === 'player' ? 'opponent' : 'player', activeSlot)
      ?? getActivePokemon(state, sideId === 'player' ? 'opponent' : 'player', 0)
    if (opposing && applyTransform(state, pokemon, opposing)) {
      appendLog(state, `${pokemon.name}의 괴짜! 상대의 모습으로 변신했다!`, 'ability')
    }
  }
}

function activateTraceAbility(state, sideId, activeSlot, pokemon) {
  if (pokemon.ability !== '트레이스') return false
  const opposing = getActivePokemonList(state, sideId === 'player' ? 'opponent' : 'player')
    .filter((target) => (
      target
      && !target.fainted
      && target.hp > 0
      && !UNTRACEABLE_ABILITIES.has(target.ability)
    ))
  const target = opposing[activeSlot] ?? opposing[0]
  if (!target) return false

  pokemon.tracedAbilityBase = '트레이스'
  pokemon.ability = target.ability
  appendLog(state, `${pokemon.name}의 트레이스! ${target.name}의 ${target.ability}을(를) 복사했다!`, 'ability')
  return true
}

function prepareSwitchOutForm(state, pokemon) {
  if (!pokemon || pokemon.fainted || pokemon.hp <= 0) return
  if (pokemon.ability === '재생력') {
    healPokemon(state, pokemon, pokemon.maxHp / 3, pokemon.ability, { bypassHealBlock: true })
  }
  if (pokemon.ability === '자연회복' && pokemon.status) {
    const statusLabel = pokemon.status.label
    pokemon.status = null
    appendLog(state, `${pokemon.name}의 자연회복! ${statusLabel} 상태가 회복되었다.`, 'ability')
  }
  const slug = currentSpeciesSlug(pokemon)
  if (pokemon.ability === '마이티체인지' && slug === 'palafin') {
    changeBattleForm(state, pokemon, 'palafin-hero', pokemon.ability)
  } else if (pokemon.ability === '배틀스위치' && slug === 'aegislash-blade') {
    changeBattleForm(state, pokemon, 'aegislash', pokemon.ability, { log: false })
  } else if (slug === 'meloetta-pirouette') {
    changeBattleForm(state, pokemon, 'meloetta', '폼 복원', { log: false })
  } else if (pokemon.ability === '기분파' && slug !== 'castform') {
    changeBattleForm(state, pokemon, 'castform', pokemon.ability, { log: false })
  } else if (pokemon.ability === '달마모드' && slug.includes('zen')) {
    changeBattleForm(
      state,
      pokemon,
      slug.includes('galar') ? 'darmanitan-galar-standard' : 'darmanitan',
      pokemon.ability,
      { log: false },
    )
  } else if (pokemon.ability === '그대로꿀꺽미사일' && slug !== 'cramorant') {
    changeBattleForm(state, pokemon, 'cramorant', pokemon.ability, { log: false })
  }

  pokemon.flowerGiftActive = false
  pokemon.paradoxEnvironmentActive = false
  pokemon.paradoxBoosterActive = false
  if (pokemon.mimicryActive) {
    pokemon.mimicryActive = false
    restorePokemonOwnTypes(pokemon)
  }
  if (pokemon.proteanUsed) {
    pokemon.proteanUsed = false
    restorePokemonOwnTypes(pokemon)
  }
}

function applyMoveTriggeredFormBefore(state, pokemon, move) {
  if (pokemon.ability === '배틀스위치' && currentSpeciesSlug(pokemon).startsWith('aegislash')) {
    const targetSlug = move.id === 'kingsshield'
      ? 'aegislash'
      : isStatusMove(move) ? null : 'aegislash-blade'
    if (targetSlug) changeBattleForm(state, pokemon, targetSlug, pokemon.ability)
  }

  if (
    ['변환자재', '리베로'].includes(pokemon.ability)
    && !pokemon.proteanUsed
    && !pokemon.teraActive
    && move.type
    && move.type !== '???'
  ) {
    pokemon.types = [move.type]
    pokemon.proteanUsed = true
    appendLog(state, `${pokemon.name}의 ${pokemon.ability}! ${move.type}타입으로 변했다!`, 'ability')
  }

  if (
    pokemon.ability === '그대로꿀꺽미사일'
    && currentSpeciesSlug(pokemon) === 'cramorant'
    && ['surf', 'dive'].includes(move.id)
  ) {
    changeBattleForm(
      state,
      pokemon,
      pokemon.hp <= pokemon.maxHp / 2 ? 'cramorant-gorging' : 'cramorant-gulping',
      pokemon.ability,
    )
  }
}

function applyFormDamageShield(state, defender, move, requestedDamage) {
  if (requestedDamage <= 0 || move.ignoreAbility) return null
  const slug = currentSpeciesSlug(defender)
  if (defender.ability === '탈' && ['mimikyu', 'mimikyu-totem-disguised'].includes(slug)) {
    const targetSlug = slug === 'mimikyu-totem-disguised' ? 'mimikyu-totem-busted' : 'mimikyu-busted'
    changeBattleForm(state, defender, targetSlug, defender.ability)
    loseHp(state, defender, defender.maxHp / 8, `${defender.name}은(는) 탈이 벗겨져 HP가 줄었다.`, 'ability')
    return { damage: 0, effectiveness: 1 }
  }
  if (defender.ability === '아이스페이스' && slug === 'eiscue' && move.categoryId === 'physical') {
    defender.iceFaceBroken = true
    changeBattleForm(state, defender, 'eiscue-noice', defender.ability)
    return { damage: 0, effectiveness: 1 }
  }
  return null
}

function applyReactiveFormAbility(state, attacker, defender, move, damage) {
  if (damage <= 0 || attacker.hp <= 0 || defender.ability !== '그대로꿀꺽미사일') return false
  const slug = currentSpeciesSlug(defender)
  if (!['cramorant-gulping', 'cramorant-gorging'].includes(slug)) return false

  loseHp(state, attacker, attacker.maxHp / 4, `${attacker.name}은(는) 그대로꿀꺽미사일에 맞았다!`, 'ability')
  if (slug === 'cramorant-gulping') {
    changeStages(state, attacker, { defense: -1 }, { source: defender })
  }
  else setStatus(state, attacker, 'paralysis', defender.ability)
  changeBattleForm(state, defender, 'cramorant', defender.ability, { log: false })
  return true
}

function applyMoveTriggeredFormAfterHit(state, attacker, defender, move, damage) {
  if (damage > 0 && move.id === 'relicsong') {
    const slug = currentSpeciesSlug(attacker)
    if (['meloetta', 'meloetta-pirouette'].includes(slug)) {
      changeBattleForm(
        state,
        attacker,
        slug === 'meloetta' ? 'meloetta-pirouette' : 'meloetta',
        move.name,
      )
    }
  }

  if (
    damage > 0
    && defender.hp <= 0
    && attacker.hp > 0
    && attacker.ability === '유대변화'
    && !attacker.bondTriggered
    && currentSpeciesSlug(attacker) === 'greninja-battle-bond'
    && remainingCount(getPokemonSide(state, defender)) > 0
  ) {
    attacker.bondTriggered = true
    changeBattleForm(state, attacker, 'greninja-ash', attacker.ability)
  }
}

function transformPokemon(state, pokemon, formId, mechanicId) {
  const fallbackOptions = getBattleFormOptions(pokemon.originalSpeciesId)
  const form = getSpeciesProfile(formId)
    ?? fallbackOptions.find((option) => (
      mechanicId === 'primal' ? option.slug.includes('-primal') : option.slug.includes('-mega')
    ))
  if (!form) return false

  if (!changeBattleForm(state, pokemon, form, MECHANIC_LABELS[mechanicId], { log: false })) return false
  pokemon.megaActive = mechanicId === 'mega'
  pokemon.primalActive = mechanicId === 'primal'
  pokemon.ultraActive = mechanicId === 'ultra'
  return true
}

function activateUltraBurst(state, pokemon) {
  if (normalizeZCrystalId(pokemon.heldItemId) !== 'ultranecroziumz') return false
  if (!['necrozma-dusk', 'necrozma-dawn'].includes(currentSpeciesSlug(pokemon))) return false

  const ultraForm = getBattleFormOptions(pokemon.originalSpeciesId)
    .find((form) => form.slug === 'necrozma-ultra')
  if (!ultraForm) return false

  const originalName = pokemon.name
  if (!transformPokemon(state, pokemon, ultraForm.id, 'ultra')) return false
  appendLog(state, `${originalName}이(가) 울트라버스트했다!`, 'gimmick')
  return true
}

function transformGigantamax(pokemon) {
  const formOptions = getBattleFormOptions(pokemon.originalSpeciesId)
  const configuredForm = pokemon.gimmickFormId ? getSpeciesProfile(pokemon.gimmickFormId) : null
  const form = configuredForm?.slug?.includes('-gmax')
    ? configuredForm
    : formOptions.find((option) => option.slug.includes('-gmax'))
  if (!form) return false

  pokemon.dynamaxOriginalForm = {
    speciesId: pokemon.speciesId,
    name: pokemon.name,
    spriteFront: pokemon.spriteFront,
    spriteBack: pokemon.spriteBack,
    spriteFrontFallback: pokemon.spriteFrontFallback,
    spriteBackFallback: pokemon.spriteBackFallback,
  }
  pokemon.speciesId = form.id
  pokemon.name = form.name
  pokemon.spriteFront = form.spriteFront
  pokemon.spriteBack = form.spriteBack
  pokemon.spriteFrontFallback = form.spriteFrontFallback
  pokemon.spriteBackFallback = form.spriteBackFallback
  return true
}

function inferConfiguredMechanics(pokemon) {
  return pokemon.battleMechanics.map((mechanic) => {
    if (mechanic === 'terastallization') return 'tera'
    if (mechanic === 'mega-evolution') return 'mega'
    if (mechanic === 'z-move') return 'zmove'
    if (mechanic === 'primal-reversion') return 'primal'
    if (mechanic === 'gigantamax' || mechanic === 'dynamax') return 'dynamax'
    return null
  }).filter(Boolean)
}

export function getAvailableBattleMechanics(state, sideId = 'player', activeSlot = null) {
  if (!state || state.winner) return []
  if (sideId === 'opponent' && state.rules?.aiDifficulty?.id === 'easy') return []
  const side = getSide(state, sideId)
  const pokemon = getActivePokemon(state, sideId, activeSlot)
  if (!pokemon || pokemon.fainted) return []
  if (pokemon.usedBattleMechanicId) return []
  const configured = sideId === 'opponent' ? inferConfiguredMechanics(pokemon) : []
  const available = []
  const allow = (mechanicId) => sideId === 'player' || configured.includes(mechanicId)

  if (!side.usedMechanics.tera && allow('tera')) {
    available.push({ id: 'tera', label: `테라스탈 · ${pokemon.teraType}`, shortLabel: 'TERA' })
  }

  if (!side.usedMechanics.dynamax && allow('dynamax')) {
    available.push({
      id: 'dynamax',
      label: pokemon.dynamaxMode === 'gigantamax' ? '거다이맥스' : '다이맥스',
      shortLabel: pokemon.dynamaxMode === 'gigantamax' ? '거다이맥스' : '다이맥스',
    })
  }

  const formOptions = getBattleFormOptions(pokemon.originalSpeciesId)
  const hasMegaForm = Boolean(pokemon.gimmickFormId || formOptions.some((form) => form.slug.includes('-mega')))
  const hasPrimalForm = Boolean(pokemon.gimmickFormId || formOptions.some((form) => form.slug.includes('-primal')))
  const rayquazaCanMegaEvolve = currentSpeciesSlug(pokemon) === 'rayquaza'
    && pokemon.moves.some((move) => move.id === 'dragonascent')
  const hasMegaStone = pokemon.heldItemId?.includes('ite') || configured.includes('mega') || rayquazaCanMegaEvolve
  const hasZCrystal = pokemon.heldItemId?.includes('-z') || pokemon.heldItemId?.includes('ium-z')
  const hasCompatibleZMove = hasZCrystal && hasCompatibleBattleZMove(pokemon)

  if (!side.usedMechanics.mega && allow('mega') && hasMegaForm && hasMegaStone) {
    available.push({ id: 'mega', label: '메가진화', shortLabel: 'MEGA' })
  }
  if (!side.usedMechanics.primal && allow('primal') && hasPrimalForm) {
    available.push({ id: 'primal', label: '원시회귀', shortLabel: 'PRIMAL' })
  }
  if (!side.usedMechanics.zmove && allow('zmove') && hasCompatibleZMove) {
    available.push({ id: 'zmove', label: 'Z기술', shortLabel: 'Z-MOVE' })
  }

  return available.filter((mechanic) => mechanic.id !== state.rules?.disabledGimmickId)
}

function resolveAvailableActionGimmick(state, sideId, activeSlot, gimmickId) {
  if (!gimmickId) return null
  return getAvailableBattleMechanics(state, sideId, activeSlot)
    .some((mechanic) => mechanic.id === gimmickId)
    ? gimmickId
    : null
}

function activateMechanic(state, sideId, mechanicId, activeSlot = null) {
  if (!mechanicId) return 1
  const available = getAvailableBattleMechanics(state, sideId, activeSlot)
  if (!available.some((mechanic) => mechanic.id === mechanicId)) return 1
  const side = getSide(state, sideId)
  const pokemon = getActivePokemon(state, sideId, activeSlot)
  const trainerName = sideId === 'player' ? '플레이어' : side.name
  let activated = false

  if (mechanicId === 'tera') {
    side.usedMechanics.tera = true
    const terapagosStellar = pokemon.battleBaseSpeciesId === 1024
      ? relatedFormBySlug(pokemon, 'terapagos-stellar')
      : null
    if (terapagosStellar) {
      changeBattleForm(state, pokemon, terapagosStellar, '테라스탈', { hpMode: 'damage', log: false })
      pokemon.teraType = '스텔라'
    }
    pokemon.teraActive = true
    pokemon.types = terapagosStellar ? [...terapagosStellar.types] : [pokemon.teraType]
    appendLog(state, `${trainerName}의 ${pokemon.name}이(가) ${pokemon.teraType}타입으로 테라스탈했다!`, 'gimmick')
    if (pokemon.ability === '제로포밍') {
      clearBattleEnvironment(state, 'weather', pokemon.ability)
      clearBattleEnvironment(state, 'terrain', pokemon.ability)
    }
    activated = true
  } else if (mechanicId === 'dynamax') {
    const originalName = pokemon.name
    side.usedMechanics.dynamax = true
    if (pokemon.dynamaxMode === 'gigantamax') transformGigantamax(pokemon)
    pokemon.dynamaxActive = true
    pokemon.dynamaxTurns = 3
    pokemon.hp += pokemon.maxHp
    pokemon.maxHp *= 2
    appendLog(
      state,
      `${trainerName}의 ${originalName}이(가) ${pokemon.dynamaxMode === 'gigantamax' ? '거다이맥스' : '다이맥스'}했다!`,
      'gimmick',
    )
    activated = true
  } else if (mechanicId === 'mega' || mechanicId === 'primal') {
    if (transformPokemon(state, pokemon, pokemon.gimmickFormId, mechanicId)) {
      side.usedMechanics[mechanicId] = true
      appendLog(state, `${trainerName}의 ${pokemon.name}! ${MECHANIC_LABELS[mechanicId]} 성공!`, 'gimmick')
      activateEntryAbility(state, sideId, activeSlot)
      activated = true
    }
  } else if (mechanicId === 'zmove') {
    activateUltraBurst(state, pokemon)
    side.usedMechanics.zmove = true
    appendLog(state, `${trainerName}와 ${pokemon.name}의 전력! Z파워가 기술에 모인다!`, 'gimmick')
    activated = true
  }

  if (!activated) return 1
  pokemon.usedBattleMechanicId = mechanicId
  state.lastEvent = {
    kind: 'gimmick',
    sideId,
    mechanicId,
    nonce: state.eventNonce += 1,
  }
  return 1
}

function forcedActionForPokemon(pokemon) {
  if (!pokemon || pokemon.fainted || pokemon.hp <= 0) return null
  if (pokemon.rechargeTurns > 0) {
    return { type: 'move', moveIndex: 0, gimmick: null, forcedReason: 'recharge' }
  }
  if (pokemon.chargingMove && pokemon.moves[pokemon.chargingMove.moveIndex]) {
    return {
      type: 'move',
      moveIndex: pokemon.chargingMove.moveIndex,
      gimmick: null,
      forcedReason: 'charge',
    }
  }
  if (pokemon.lockedMove && pokemon.moves[pokemon.lockedMove.moveIndex]) {
    return {
      type: 'move',
      moveIndex: pokemon.lockedMove.moveIndex,
      gimmick: null,
      forcedReason: 'locked',
    }
  }
  return null
}

export function getForcedBattleAction(state, sideId = 'player', activeSlot = null) {
  if (!state || state.winner || state.awaitingPlayerSwitch) return null
  return forcedActionForPokemon(getActivePokemon(state, sideId, activeSlot))
}

export function getBattleMovePreview(
  state,
  sideId = 'player',
  moveIndex = 0,
  activeSlot = 0,
  targetSlot = 0,
  gimmick = null,
) {
  if (!state) return null
  const attacker = getActivePokemon(state, sideId, activeSlot)
  const defender = getActivePokemon(state, sideId === 'player' ? 'opponent' : 'player', targetSlot)
  const move = attacker?.moves?.[moveIndex]
  if (!attacker || !defender || !move) return move ?? null
  const resolvedGimmick = resolveAvailableActionGimmick(state, sideId, activeSlot, gimmick)
  const environmentMove = resolveEnvironmentMove(state, attacker, defender, move)
  const zMove = resolvedGimmick === 'zmove' ? resolveBattleZMove(attacker, environmentMove, move) : null
  const resolvedMove = resolvedGimmick === 'zmove'
    ? zMove ?? { ...environmentMove, zMoveCompatible: false }
    : resolveBattleMaxMove(attacker, environmentMove, resolvedGimmick === 'dynamax', move)
  return {
    ...resolvedMove,
    priority: environmentMovePriority(state, attacker, resolvedMove),
  }
}

function clearChargeState(pokemon) {
  pokemon.chargingMove = null
  pokemon.semiInvulnerable = null
}

function beginChargeMove(state, attacker, move, moveIndex) {
  attacker.chargingMove = { moveIndex, moveId: move.id }
  attacker.semiInvulnerable = SEMI_INVULNERABLE_MOVES[move.id] ?? null
  if (CHARGE_TURN_BOOSTS[move.id]) changeStages(state, attacker, CHARGE_TURN_BOOSTS[move.id])
  appendLog(state, `${attacker.name}은(는) ${CHARGE_MESSAGES[move.id] ?? '힘을 모으고 있다!'}`, 'status')
}

function semiInvulnerableInteraction(defender, move) {
  if (!defender.semiInvulnerable || move.target === 'self') return { avoided: false, powerMultiplier: 1 }
  const rules = SEMI_INVULNERABLE_HITS[defender.semiInvulnerable]
  if (rules?.doubled.has(move.id)) return { avoided: false, powerMultiplier: 2 }
  if (rules?.normal.has(move.id)) return { avoided: false, powerMultiplier: 1 }
  return { avoided: true, powerMultiplier: 1 }
}

function moveAccuracyAbilityMultiplier(state, attacker, defender, move) {
  let multiplier = attacker.ability === '복안' ? 1.3 : 1
  const side = getPokemonSide(state, attacker)
  const victoryStarCount = getActivePokemonList(state, side.id).filter((pokemon) => (
    pokemon && !pokemon.fainted && pokemon.hp > 0 && pokemon.ability === '승리의별'
  )).length
  multiplier *= 1.1 ** victoryStarCount
  if (!move.ignoreAbility && defender.ability === '갈지자걸음' && defender.confusionTurns > 0) multiplier *= 0.5
  return multiplier
}

function moveHits(state, attacker, defender, move, random) {
  if (move.accuracyLabel === '필중' || move.accuracy == null) return true
  if (attacker.ability === '노가드' || defender.ability === '노가드') return true
  const weatherId = effectiveMoveWeatherFamilyId(state, attacker)
  if (weatherId === 'rain' && ['thunder', 'hurricane'].includes(move.id)) return true
  if (weatherId === 'snow' && move.id === 'blizzard') return true

  const baseAccuracy = Number(move.accuracy) || 100
  const defenderEvasionStage = attacker.ability === '날카로운눈'
    ? 0
    : defender.statStages.evasion ?? 0
  const stageModifier = accuracyStageMultiplier(attacker.statStages.accuracy ?? 0)
    / accuracyStageMultiplier(defenderEvasionStage)
  const hustleModifier = attacker.ability === '의욕' && move.categoryId === 'physical' ? 0.8 : 1
  let weatherModifier = weatherId === 'fog' ? 0.6 : 1
  if (weatherId === 'sun' && ['thunder', 'hurricane'].includes(move.id)) weatherModifier *= 0.5
  if (weatherId === 'sandstorm' && defender.ability === '모래숨기') weatherModifier *= 0.8
  if (weatherId === 'snow' && defender.ability === '눈숨기') weatherModifier *= 0.8
  const abilityModifier = moveAccuracyAbilityMultiplier(state, attacker, defender, move)
  const finalAccuracy = Math.min(
    100,
    baseAccuracy * stageModifier * hustleModifier * weatherModifier * abilityModifier,
  )
  const wonderSkinAccuracy = !move.ignoreAbility && defender.ability === '미라클스킨' && isStatusMove(move)
    ? Math.min(50, finalAccuracy)
    : finalAccuracy
  return random() * 100 < wonderSkinAccuracy
}

function chooseMultiHitCount(attacker, move, random) {
  if (parentalBondApplies(attacker, move)) return 2
  if (!move.multihit) return 1
  if (typeof move.multihit === 'number') return move.multihit
  const [minimum, maximum] = move.multihit
  if (attacker.ability === '스킬링크') return maximum
  if (minimum === 2 && maximum === 5) {
    const roll = random()
    if (roll < 3 / 8) return 2
    if (roll < 6 / 8) return 3
    if (roll < 7 / 8) return 4
    return 5
  }
  return minimum + Math.floor(random() * (maximum - minimum + 1))
}

function parentalBondApplies(attacker, move) {
  return attacker.ability === '부자유친'
    && !isStatusMove(move)
    && !move.multihit
    && !move.isZMove
    && !move.isMaxMove
    && !move.ohko
    && move.damage === undefined
    && !move.currentHpFraction
    && !move.flags?.includes('charge')
    && !move.flags?.includes('futuremove')
    && !move.flags?.includes('noparentalbond')
    && !['all', 'allAdjacent', 'allAdjacentFoes'].includes(move.target)
}

function fixedDamageResult(state, attacker, defender, move) {
  const effectiveness = getMoveTypeEffectiveness(state, attacker, defender, move)
  if (effectiveness === 0) return { damage: 0, effectiveness, critical: false }
  if (move.currentHpFraction) {
    const [numerator, denominator] = move.currentHpFraction
    return {
      damage: Math.max(1, Math.floor(defender.hp * numerator / denominator)),
      effectiveness,
      critical: false,
    }
  }
  if (move.id === 'finalgambit') return { damage: attacker.hp, effectiveness, critical: false }
  if (move.ohko) return { damage: defender.hp, effectiveness, critical: false, ohko: true }
  if (move.damage !== undefined) {
    return {
      damage: move.damage === 'level' ? 50 : Number(move.damage),
      effectiveness,
      critical: false,
    }
  }
  return null
}

function applySurvivalEffects(state, defender, requestedDamage, move) {
  let damage = Math.min(defender.hp, Math.max(0, Math.floor(requestedDamage)))
  if (damage < defender.hp || defender.hp !== defender.maxHp) return damage

  if (defender.ability === '옹골참') {
    if (move.ohko) {
      appendLog(state, `${defender.name}은(는) 옹골참으로 일격필살기를 막았다!`, 'ability')
      return 0
    }
    appendLog(state, `${defender.name}은(는) 옹골참으로 버텼다!`, 'ability')
    return Math.max(0, defender.hp - 1)
  }
  if (hasActiveHeldItem(defender, 'focus-sash')) {
    consumeHeldItem(state, defender)
    appendLog(state, `${defender.name}은(는) 기합의띠로 버텼다!`, 'item')
    damage = Math.max(0, defender.hp - 1)
  }
  return damage
}

function applyProtectContactEffect(state, attacker, defender, move) {
  if (!move.flags?.includes('contact')) return false
  if (attacker.ability === '원격' || hasActiveHeldItem(attacker, 'protective-pads')) return false

  const effect = PROTECT_CONTACT_EFFECTS[defender.protectMode]
  if (!effect) return false

  if (effect.damageFraction) {
    const [numerator, denominator] = effect.damageFraction
    loseHp(
      state,
      attacker,
      attacker.maxHp * numerator / denominator,
      `${attacker.name}은(는) ${defender.name}의 방어에 닿아 데미지를 입었다!`,
    )
  }
  if (effect.stages) changeStages(state, attacker, effect.stages, { source: defender })
  if (effect.status) setStatus(state, attacker, effect.status, defender.protectMode)
  return true
}

function moveMakesContact(attacker, move) {
  return move.flags?.includes('contact')
    && attacker.ability !== '원격'
    && !hasActiveHeldItem(attacker, 'protective-pads')
}

function moveBypassesProtection(attacker, defender, move) {
  return defender.protectMode !== 'maxguard'
    && attacker.ability === '보이지않는주먹'
    && moveMakesContact(attacker, move)
}

function applyDamagingHitAbilityEffects(
  state,
  attacker,
  defender,
  move,
  damage,
  defenderHpBeforeMove,
  landedHits,
  critical,
  random,
) {
  if (damage <= 0 || landedHits <= 0) return false
  let applied = false
  const defenderAbilityActive = !move.ignoreAbility
  const contact = moveMakesContact(attacker, move)

  if (defenderAbilityActive) {
    const damagingRule = DAMAGING_HIT_ABILITY_RULES[defender.ability]
    const matchingDamagingRule = damagingRule && (
      !damagingRule.type && !damagingRule.types && !damagingRule.category
      || damagingRule.type === move.type
      || damagingRule.types?.includes(move.type)
      || damagingRule.category === move.categoryId
    )
    if (matchingDamagingRule && defender.hp > 0) {
      for (let hitIndex = 0; hitIndex < landedHits; hitIndex += 1) {
        appendLog(state, `${defender.name}의 ${defender.ability}!`, 'ability')
        changeStages(state, defender, damagingRule.boosts)
      }
      applied = true
    }

    if (contact) {
      const contactRule = CONTACT_HIT_ABILITY_RULES[defender.ability]
      if (contactRule) {
        for (let hitIndex = 0; hitIndex < landedHits && attacker.hp > 0; hitIndex += 1) {
          if (contactRule.damage) {
            const [numerator, denominator] = contactRule.damage
            loseHp(
              state,
              attacker,
              attacker.maxHp * numerator / denominator,
              `${attacker.name}은(는) ${defender.ability}에 상처를 입었다!`,
              'ability',
            )
            applied = true
          }
          if (contactRule.boosts) {
            appendLog(state, `${defender.name}의 ${defender.ability}!`, 'ability')
            changeStages(state, attacker, contactRule.boosts, { source: defender })
            applied = true
          }
          if (contactRule.chance && random() * 100 < contactRule.chance) {
            let statusId = contactRule.status
            if (contactRule.randomStatuses) {
              if (
                attacker.types.includes('풀')
                || attacker.ability === '방진'
                || hasActiveHeldItem(attacker, 'safety-goggles')
              ) continue
              statusId = contactRule.randomStatuses[Math.floor(random() * contactRule.randomStatuses.length)]
            }
            if (statusId) {
              applied = setStatus(state, attacker, statusId, defender.ability, { source: defender }) || applied
            }
            if (
              contactRule.volatile
              && (!contactRule.oppositeGender
                || attacker.gender && defender.gender && attacker.gender !== defender.gender)
            ) {
              applied = applyVolatileEffect(
                state,
                attacker,
                contactRule.volatile,
                defender.ability,
                random,
                move.id,
                { source: defender },
              ) || applied
            }
          }
        }
      }
    }

    if (
      contact
      && defender.ability === '떠도는영혼'
      && attacker.ability !== defender.ability
      && abilityCanBeChanged(attacker)
      && abilityCanBeChanged(defender)
    ) {
      const attackerAbility = attacker.ability
      attacker.ability = defender.ability
      defender.ability = attackerAbility
      appendLog(state, `${defender.name}의 떠도는영혼! 서로의 특성이 뒤바뀌었다!`, 'ability')
      applied = true
    } else if (
      contact
      && ['가시지않는향기', '미라'].includes(defender.ability)
      && attacker.ability !== defender.ability
      && abilityCanBeChanged(attacker)
    ) {
      attacker.ability = defender.ability
      appendLog(state, `${attacker.name}의 특성이 ${defender.ability}(으)로 바뀌었다!`, 'ability')
      applied = true
    }

    if (
      contact
      && defender.ability === '나쁜손버릇'
      && defender.hp > 0
      && stealHeldItem(state, defender, attacker, defender.ability, {
        ignoreHolderAbility: Boolean(move.ignoreAbility),
      })
    ) applied = true

    if (defender.ability === '독치장' && move.categoryId === 'physical') {
      const attackerSide = getPokemonSide(state, attacker)
      attackerSide.hazards.toxicSpikes = Math.min(
        2,
        Number(attackerSide.hazards.toxicSpikes ?? 0) + landedHits,
      )
      appendLog(state, `${defender.name}의 독치장! 상대 진영에 독압정이 흩뿌려졌다!`, 'ability')
      applied = true
    }
    if (
      defender.ability === '저주받은바디'
      && attacker.hp > 0
      && attacker.lastMoveIndex != null
      && !aromaVeilProtects(state, attacker)
      && random() < 0.3
    ) {
      attacker.disabledMoveIndex = attacker.lastMoveIndex
      attacker.disabledMoveTurns = 4
      appendLog(state, `${defender.name}의 저주받은바디! ${move.name}을(를) 봉인했다!`, 'ability')
      applied = true
    }
    if (defender.ability === '솜털') {
      appendLog(state, `${defender.name}의 솜털이 흩날렸다!`, 'ability')
      ;['player', 'opponent'].forEach((sideId) => {
        getActivePokemonList(state, sideId)
          .filter((pokemon) => pokemon && pokemon.battleId !== defender.battleId && pokemon.hp > 0)
          .forEach((pokemon) => changeStages(state, pokemon, { speed: -1 }, { source: defender }))
      })
      applied = true
    }
    if (defender.ability === '변색' && defender.hp > 0 && !defender.teraActive && !defender.types.includes(move.type)) {
      defender.types = [move.type]
      appendLog(state, `${defender.name}의 변색! ${move.type}타입으로 변했다!`, 'ability')
      applied = true
    }
    if (defender.ability === '분노의경혈' && defender.hp > 0 && critical) {
      const previous = defender.statStages.attack
      defender.statStages.attack = 6
      if (previous < 6) appendLog(state, `${defender.name}의 분노의경혈! 공격이 최고로 올라갔다!`, 'ability')
      applied = previous < 6 || applied
    }
    if (defender.ability === '하바네로분출' && attacker.hp > 0) {
      applied = setStatus(state, attacker, 'burn', defender.ability, { source: defender }) || applied
    }
    if (defender.ability === '전기로바꾸기' && defender.hp > 0) {
      defender.chargeActive = true
      appendLog(state, `${defender.name}의 전기로바꾸기! 전기를 충전했다!`, 'ability')
      applied = true
    }
    if (defender.ability === '풍력발전' && move.flags?.includes('wind') && defender.hp > 0) {
      defender.chargeActive = true
      appendLog(state, `${defender.name}의 풍력발전! 전기를 충전했다!`, 'ability')
      applied = true
    }
    if (defender.ability === '멸망의바디' && contact && attacker.hp > 0 && attacker.perishCount == null) {
      attacker.perishCount = 4
      if (defender.hp > 0) defender.perishCount = 4
      appendLog(state, `${defender.name}의 멸망의바디! 양쪽의 멸망 카운트가 시작됐다!`, 'ability')
      applied = true
    }
    if (
      defender.ability === '유폭'
      && defender.hp <= 0
      && contact
      && attacker.hp > 0
      && activePokemonWithAbility(state, '습기').length === 0
    ) {
      loseHp(
        state,
        attacker,
        attacker.maxHp / 4,
        `${attacker.name}은(는) ${defender.name}의 유폭에 휘말렸다!`,
        'ability',
      )
      applied = true
    }
    if (defender.ability === '내용물분출' && defender.hp <= 0 && attacker.hp > 0) {
      loseHp(
        state,
        attacker,
        Math.min(defenderHpBeforeMove, attacker.hp),
        `${attacker.name}은(는) ${defender.name}의 내용물분출에 휘말렸다!`,
        'ability',
      )
      applied = true
    }
  }

  if (contact && attacker.ability === '독수' && defender.hp > 0 && random() < 0.3) {
    applied = setStatus(state, defender, 'poison', attacker.ability, { source: attacker }) || applied
  }
  if (attacker.ability === '독사슬' && defender.hp > 0 && random() < 0.3) {
    applied = setStatus(state, defender, 'toxic', attacker.ability, { source: attacker }) || applied
  }
  if (
    attacker.ability === '악취'
    && defender.hp > 0
    && !defender.actedThisTurn
    && !moveAlreadyFlinches(move)
    && (move.ignoreAbility || defender.ability !== '인분')
    && !hasActiveHeldItem(defender, 'covert-cloak')
    && random() < 0.1
  ) {
    applied = applyVolatileEffect(
      state,
      defender,
      'flinch',
      attacker.ability,
      random,
      move.id,
      { source: attacker, ignoreAbility: Boolean(move.ignoreAbility) },
    ) || applied
  }
  if (
    attacker.ability === '매지션'
    && damage > 0
    && stealHeldItem(state, attacker, defender, attacker.ability, {
      ignoreHolderAbility: Boolean(move.ignoreAbility),
    })
  ) {
    applied = true
  }
  return applied
}

function loseHp(state, pokemon, amount, message, tone = 'damage') {
  if (!pokemon || pokemon.hp <= 0) return 0
  const damage = Math.min(pokemon.hp, Math.max(1, Math.floor(amount)))
  pokemon.hp = Math.max(0, pokemon.hp - damage)
  appendLog(state, message.replace('{damage}', damage), tone)
  return damage
}

function applyCrashDamage(state, attacker, move) {
  if (!move.hasCrashDamage || attacker.ability === '매직가드') return 0
  return loseHp(
    state,
    attacker,
    Math.floor(attacker.maxHp / 2),
    `${attacker.name}은(는) 기세가 남아 바닥에 부딪혔다!`,
  )
}

function applyMindBlownRecoil(state, attacker, move) {
  if (!move.mindBlownRecoil || attacker.ability === '매직가드') return 0
  return loseHp(
    state,
    attacker,
    Math.ceil(attacker.maxHp / 2),
    `${attacker.name}은(는) 자신의 HP를 크게 소모했다!`,
  )
}

function applyMoveRecoil(state, attacker, move, damageDealt) {
  if (!move.recoil || damageDealt <= 0 || RECOIL_IMMUNE_ABILITIES.has(attacker.ability)) return 0
  const [numerator, denominator] = move.recoil
  const amount = move.id === 'struggle'
    ? Math.floor(attacker.maxHp * numerator / denominator)
    : Math.floor(damageDealt * numerator / denominator)
  return loseHp(
    state,
    attacker,
    amount,
    `${attacker.name}은(는) 반동으로 {damage}의 데미지를 입었다.`,
  )
}

function applySelfDestruct(state, attacker, move, didHit) {
  if (!move.selfdestruct || (move.selfdestruct === 'ifHit' && !didHit) || attacker.hp <= 0) return false
  attacker.hp = 0
  appendLog(state, `${attacker.name}은(는) 모든 힘을 다 써버렸다!`, 'damage')
  return true
}

function applyFailedMoveConsequences(state, attacker, move) {
  applyCrashDamage(state, attacker, move)
  applyMindBlownRecoil(state, attacker, move)
  applySelfDestruct(state, attacker, move, false)
}

function handleLockedMove(state, attacker, move, moveIndex, action, random) {
  if (move.self?.volatileStatus !== 'lockedmove' || attacker.hp <= 0) return

  if (action.forcedReason === 'locked' && attacker.lockedMove) {
    attacker.lockedMove.remainingUses -= 1
    if (attacker.lockedMove.remainingUses <= 0) {
      attacker.lockedMove = null
      applyVolatileEffect(state, attacker, 'confusion', move.name, random)
    }
    return
  }

  attacker.lockedMove = {
    moveIndex,
    moveId: move.id,
    remainingUses: 1 + Math.floor(random() * 2),
  }
  appendLog(state, `${attacker.name}은(는) ${move.name}을(를) 계속 사용한다!`, 'status')
}

function applyMoveSwitching(state, sideId, move, random, timeline, actionOrder, actorSlot = 0, targetSlot = 0) {
  const side = getSide(state, sideId)
  const targetSide = getOtherSide(state, sideId)
  const attacker = getActivePokemon(state, sideId, actorSlot)
  const defender = getActivePokemon(state, targetSide.id, targetSlot)

  if (move.forceSwitch && defender?.hp > 0) {
    const forcedSwitchBlocked = defender.commandedByBattleId
      || !move.ignoreAbility && FORCED_SWITCH_IMMUNE_ABILITIES.has(defender.ability)
    if (forcedSwitchBlocked) {
      appendLog(state, `${defender.name}의 ${defender.commandedByBattleId ? '사령탑' : defender.ability}! 강제 교체를 막아냈다!`, 'ability')
    } else {
      const switchOptions = availableBenchIndexes(targetSide)
      if (switchOptions.length > 0) {
        const targetIndex = switchOptions[Math.floor(random() * switchOptions.length)]
        performSwitch(state, targetSide.id, targetIndex, true, timeline, actionOrder, targetSlot)
      }
    }
  }

  if (move.selfSwitch && move.id !== 'revivalblessing' && attacker?.hp > 0) {
    const switchOptions = availableBenchIndexes(side)
    if (switchOptions.length > 0) {
      const targetIndex = switchOptions[Math.floor(random() * switchOptions.length)]
      performSwitch(state, sideId, targetIndex, true, timeline, actionOrder, actorSlot)
    }
  }
}

function movePpCost(state, attacker, defender, move) {
  if (['self', 'allySide', 'allyTeam'].includes(move.target)) return 1
  const targetSide = getPokemonSide(state, defender)
  const pressureTargets = ['all', 'allAdjacent', 'allAdjacentFoes', 'foeSide'].includes(move.target)
    || move.flags?.includes('mustpressure')
    ? getActivePokemonList(state, targetSide.id)
    : [defender]
  const pressureCount = pressureTargets.filter((pokemon) => (
    pokemon && !pokemon.fainted && pokemon.hp > 0 && pokemon.ability === '프레셔'
  )).length
  return 1 + pressureCount
}

function activateDancerCopies(
  state,
  sourceSideId,
  sourcePokemon,
  move,
  random,
  timeline,
  actionOrder,
  sourceTargetSlot,
) {
  if (!move.flags?.includes('dance') || move.isZMove || move.isMaxMove || move.dancerCopy) return false
  const dancers = ['player', 'opponent'].flatMap((sideId) => (
    getActivePokemonList(state, sideId).map((pokemon, actorSlot) => ({ sideId, actorSlot, pokemon }))
  )).filter(({ pokemon }) => (
    pokemon
    && pokemon.battleId !== sourcePokemon.battleId
    && !pokemon.fainted
    && pokemon.hp > 0
    && pokemon.ability === '무희'
  )).sort((first, second) => (
    effectiveStat(state, second.pokemon, 'speed') - effectiveStat(state, first.pokemon, 'speed')
  ))

  dancers.forEach(({ sideId, actorSlot, pokemon }) => {
    const targetSideId = sideId === 'player' ? 'opponent' : 'player'
    const targetSlot = sideId === sourceSideId
      ? sourceTargetSlot
      : getActivePokemonList(state, targetSideId).findIndex((target) => target.hp > 0 && !target.fainted)
    if (targetSlot < 0) return
    appendLog(state, `${pokemon.name}의 무희! ${move.name}을(를) 따라 한다!`, 'ability')
    executeMove(
      state,
      sideId,
      {
        type: 'move',
        moveIndex: 0,
        actorSlot,
        targetSlot,
        gimmick: null,
        dancerCopy: true,
        copiedMove: { ...move, dancerCopy: true },
      },
      random,
      timeline,
      actionOrder,
    )
  })
  return dancers.length > 0
}

function executeMove(state, sideId, action, random, timeline = null, actionOrder = 0) {
  const side = getSide(state, sideId)
  const targetSide = getOtherSide(state, sideId)
  const actorSlot = Math.max(0, Math.min(side.activeIndexes.length - 1, Number(action.actorSlot) || 0))
  let targetSlot = Math.max(0, Math.min(targetSide.activeIndexes.length - 1, Number(action.targetSlot) || 0))
  const attacker = getActivePokemon(state, sideId, actorSlot)
  let defender = getActivePokemon(state, targetSide.id, targetSlot)
  const moveSlot = action.dancerCopy
    ? { ...action.copiedMove, maxPp: 1, currentPp: 1 }
    : attacker?.moves?.[action.moveIndex]
  if (!moveSlot || !isAvailableFieldPokemon(attacker)) return
  let targetRedirection = null
  const redirectedTarget = redirectTargetForMove(state, attacker, targetSide, moveSlot, targetSlot)
  if (redirectedTarget.pokemon) {
    targetSlot = redirectedTarget.slot
    defender = redirectedTarget.pokemon
    targetRedirection = redirectedTarget.reason
  }
  if (!isAvailableFieldPokemon(defender)) {
    targetSlot = getActivePokemonList(state, targetSide.id).findIndex(isAvailableFieldPokemon)
    defender = getActivePokemon(state, targetSide.id, Math.max(0, targetSlot))
  }
  let move = moveSlot
  let moveCategory = moveSlot?.categoryId
    ?? (moveSlot?.category === '물리' ? 'physical' : moveSlot?.category === '변화' ? 'status' : 'special')

  if (!isAvailableFieldPokemon(defender)) return
  attacker.actedThisTurn = true
  attacker.custapActive = false
  const isChargeContinuation = action.forcedReason === 'charge'
  const isLockedContinuation = action.forcedReason === 'locked'
  if (
    attacker.ability === '무아지경'
    && !action.dancerCopy
    && !attacker.dynamaxActive
    && attacker.gorillaLockedMoveIndex != null
    && attacker.gorillaLockedMoveIndex !== action.moveIndex
    && !['dynamax', 'zmove'].includes(action.gimmick)
  ) {
    appendLog(state, `${attacker.name}은(는) 무아지경 때문에 다른 기술을 선택할 수 없다!`, 'ability')
    return
  }
  if (
    attacker.disabledMoveTurns > 0
    && !action.dancerCopy
    && attacker.disabledMoveIndex === action.moveIndex
    && !isChargeContinuation
    && !isLockedContinuation
  ) {
    appendLog(state, `${moveSlot.name}은(는) 저주받은바디로 봉인되어 있다!`, 'status')
    return
  }
  if (
    !action.dancerCopy
    && attacker.tormented
    && attacker.lastMoveIndex === action.moveIndex
    && !isChargeContinuation
    && !isLockedContinuation
  ) {
    appendLog(state, `${attacker.name}은(는) 같은 기술을 연속해서 사용할 수 없다!`, 'status')
    return
  }
  const isFirstMoveAction = (attacker.activeMoveActions ?? 0) === 0
  attacker.activeMoveActions = (attacker.activeMoveActions ?? 0) + 1
  if (attacker.destinyBondActive && move.id !== 'destinybond') attacker.destinyBondActive = false
  if (!canPokemonAct(state, attacker, random, move)) {
    if (isChargeContinuation) clearChargeState(attacker)
    pushTimelineStep(timeline, state, {
      phase: 'status',
      actionOrder,
      sideId,
      targetSideId: sideId,
      actorName: attacker.name,
      moveName: move.name,
      moveType: move.type,
      moveCategory,
      message: latestLogMessage(state, `${attacker.name}은(는) 움직일 수 없다!`),
    })
    return
  }

  if (!action.dancerCopy && !isChargeContinuation && !isLockedContinuation && moveSlot.currentPp <= 0) {
    appendLog(state, `${moveSlot.name}의 PP가 남아 있지 않다!`, 'muted')
    return
  }

  const requestedGimmick = action.gimmick
  const resolvedGimmick = resolveAvailableActionGimmick(state, sideId, actorSlot, requestedGimmick)
  const resolvedAction = resolvedGimmick === requestedGimmick
    ? action
    : { ...action, gimmick: resolvedGimmick }
  if (requestedGimmick && !resolvedGimmick) {
    const message = attacker.usedBattleMechanicId
      ? `${attacker.name}은(는) 이미 ${MECHANIC_LABELS[attacker.usedBattleMechanicId]} 기믹을 사용해 다른 배틀 기믹을 사용할 수 없다!`
      : '선택한 배틀 기믹은 더 이상 사용할 수 없다!'
    appendLog(state, message, 'muted')
  }
  const mechanicWasUsed = resolvedGimmick ? side.usedMechanics[resolvedGimmick] : false
  const mechanicBefore = resolvedGimmick ? mechanicPokemonSnapshot(attacker) : null
  const previewEnvironmentMove = resolveEnvironmentMove(state, attacker, defender, moveSlot)
  const requestedZMove = resolvedGimmick === 'zmove'
    ? resolveBattleZMove(attacker, previewEnvironmentMove, moveSlot)
    : null
  if (resolvedGimmick === 'zmove' && !requestedZMove) {
    appendLog(state, `${moveSlot.name}에는 현재 Z크리스탈의 힘을 담을 수 없다!`, 'muted')
    return
  }
  const powerMultiplier = activateMechanic(state, sideId, resolvedGimmick, actorSlot)
  const environmentMove = resolveEnvironmentMove(state, attacker, defender, moveSlot)
  move = resolvedGimmick === 'zmove'
    ? resolveBattleZMove(attacker, environmentMove, moveSlot) ?? requestedZMove
    : resolveBattleMaxMove(attacker, environmentMove, false, moveSlot)
  moveCategory = move.categoryId
    ?? (move.category === '물리' ? 'physical' : move.category === '변화' ? 'status' : 'special')
  if (
    attacker.ability === '무아지경'
    && !action.dancerCopy
    && !attacker.dynamaxActive
    && resolvedGimmick !== 'zmove'
    && attacker.gorillaLockedMoveIndex == null
    && move.id !== 'struggle'
  ) attacker.gorillaLockedMoveIndex = action.moveIndex
  if (resolvedGimmick && !mechanicWasUsed && side.usedMechanics[resolvedGimmick]) {
    const mechanicAfter = mechanicPokemonSnapshot(attacker)
    pushTimelineStep(timeline, state, {
      phase: 'gimmick',
      actionOrder,
      sideId,
      targetSideId: sideId,
      actorSlot,
      targetSlot: actorSlot,
      actorName: mechanicAfter.name,
      actorSpeciesId: mechanicAfter.speciesId,
      actorOriginalSpeciesId: mechanicAfter.originalSpeciesId,
      actorPreviousName: mechanicBefore.name,
      mechanicId: resolvedGimmick,
      mechanicLabel: MECHANIC_LABELS[resolvedGimmick],
      mechanicType: resolvedGimmick === 'tera' ? attacker.teraType : null,
      mechanicMode: resolvedGimmick === 'dynamax' ? attacker.dynamaxMode : null,
      chargedMoveName: resolvedGimmick === 'zmove' ? move.name : null,
      spriteBeforeFront: mechanicBefore.spriteFront,
      spriteBeforeBack: mechanicBefore.spriteBack,
      spriteBeforeFrontFallback: mechanicBefore.spriteFrontFallback,
      spriteBeforeBackFallback: mechanicBefore.spriteBackFallback,
      spriteAfterFront: mechanicAfter.spriteFront,
      spriteAfterBack: mechanicAfter.spriteBack,
      spriteAfterFrontFallback: mechanicAfter.spriteFrontFallback,
      spriteAfterBackFallback: mechanicAfter.spriteBackFallback,
      message: `${attacker.name}의 ${MECHANIC_LABELS[resolvedGimmick]}이(가) 발동했다!`,
    })
  }

  applyMoveTriggeredFormBefore(state, attacker, move)

  if (isChargeContinuation) clearChargeState(attacker)
  if (!action.dancerCopy && !isChargeContinuation && !isLockedContinuation) {
    moveSlot.currentPp = Math.max(0, moveSlot.currentPp - movePpCost(state, attacker, defender, move))
  }
  if (!action.dancerCopy) attacker.lastMoveIndex = action.moveIndex
  if (action.quickDrawActivated) appendLog(state, `${attacker.name}의 퀵드로!`, 'ability')
  appendLog(state, `${attacker.name}의 ${move.name}!`, sideId === 'player' ? 'player' : 'opponent')
  if (targetRedirection) {
    appendLog(state, `${defender.name}의 ${targetRedirection}! 공격을 자신에게 끌어모았다!`, 'ability')
  }
  const animationMetadata = moveAnimationMetadata(attacker, move, resolvedAction, moveCategory)

  const moveStep = {
    actionOrder,
    sideId,
    targetSideId: move.target === 'self' ? sideId : targetSide.id,
    actorSlot,
    targetSlot: move.target === 'self' ? actorSlot : targetSlot,
    actorName: attacker.name,
    actorSpeciesId: attacker.speciesId,
    actorOriginalSpeciesId: attacker.originalSpeciesId,
    targetName: move.target === 'self' ? attacker.name : defender.name,
    targetSpeciesId: move.target === 'self' ? attacker.speciesId : defender.speciesId,
    targetOriginalSpeciesId: move.target === 'self' ? attacker.originalSpeciesId : defender.originalSpeciesId,
    moveId: move.id,
    moveName: move.name,
    moveType: move.type,
    moveCategory,
    moveGeneration: move.generation,
    movePower: Number(move.power) || 0,
    movePriority: environmentMovePriority(state, attacker, move),
    moveMultihit: Array.isArray(move.multihit) ? [...move.multihit] : move.multihit ?? null,
    moveDrain: Array.isArray(move.drain) ? [...move.drain] : move.drain ?? null,
    moveRecoil: Array.isArray(move.recoil) ? [...move.recoil] : move.recoil ?? null,
    moveStatus: move.status ?? null,
    moveSelfdestruct: Boolean(move.selfdestruct),
    moveTarget: move.target,
    moveFlags: [...(move.flags ?? [])],
    moveDescription: move.description ?? '',
    ...animationMetadata,
    message: `${attacker.name}의 ${move.name}!`,
  }
  pushTimelineStep(timeline, state, { phase: 'announce', ...moveStep })

  if (moveSlot.firstTurnOnly && !isFirstMoveAction && move.id === moveSlot.id) {
    appendLog(state, `${move.name}은(는) 실패했다!`, 'muted')
    pushTimelineStep(timeline, state, {
      phase: 'resolve',
      ...moveStep,
      result: 'failed',
      message: latestLogMessage(state, `${move.name}은(는) 실패했다!`),
    })
    return
  }

  if (attacker.healBlockTurns > 0 && isHealingMove(move)) {
    appendLog(state, `${attacker.name}은(는) 회복봉인 때문에 ${move.name}을(를) 사용할 수 없다!`, 'status')
    pushTimelineStep(timeline, state, {
      phase: 'resolve',
      ...moveStep,
      result: 'failed',
      message: latestLogMessage(state, `${move.name}은(는) 실패했다!`),
    })
    return
  }

  const requiresCharge = move.flags?.includes('charge')
    && !isChargeContinuation
    && resolvedGimmick !== 'zmove'
    && !attacker.dynamaxActive
    && !(effectiveMoveWeatherFamilyId(state, attacker) === 'sun' && ['solarbeam', 'solarblade'].includes(move.id))
    && !(effectiveMoveWeatherFamilyId(state, attacker) === 'rain' && move.id === 'electroshot')
  if (requiresCharge) {
    if (hasActiveHeldItem(attacker, 'power-herb')) {
      consumeHeldItem(state, attacker)
      if (CHARGE_TURN_BOOSTS[move.id]) changeStages(state, attacker, CHARGE_TURN_BOOSTS[move.id])
      appendLog(state, `${attacker.name}은(는) 파워풀허브로 단숨에 힘을 모았다!`, 'item')
      pushTimelineStep(timeline, state, {
        phase: 'status',
        ...moveStep,
        targetSideId: sideId,
        message: latestLogMessage(state, `${attacker.name}은(는) 단숨에 힘을 모았다!`),
      })
    } else {
      beginChargeMove(state, attacker, move, action.moveIndex)
      pushTimelineStep(timeline, state, {
        phase: 'status',
        ...moveStep,
        targetSideId: sideId,
        result: 'charging',
        message: latestLogMessage(state, `${attacker.name}은(는) 힘을 모으고 있다!`),
      })
      return
    }
  }

  pushTimelineStep(timeline, state, { phase: 'attack', ...moveStep })
  applyZPower(state, sideId, attacker, move)

  const strongWeatherId = effectiveWeatherId(state)
  const strongWeatherBlocked = !isStatusMove(move) && (
    strongWeatherId === 'desolateland' && move.type === '물'
    || strongWeatherId === 'primordialsea' && move.type === '불꽃'
  )
  if (strongWeatherBlocked) {
    appendLog(
      state,
      `${state.rules.weather.label} 때문에 ${move.name}은(는) 사라져 버렸다!`,
      'field',
    )
    pushTimelineStep(timeline, state, {
      phase: 'resolve',
      ...moveStep,
      result: 'blocked',
      message: latestLogMessage(state, `${move.name}은(는) 날씨에 막혔다!`),
    })
    return
  }

  if (WEIGHT_BASED_MOVE_IDS.has(move.id) && defender.dynamaxActive) {
    appendLog(state, `${defender.name}은(는) 거대해져서 ${move.name}의 영향을 받지 않는다!`, 'gimmick')
    pushTimelineStep(timeline, state, {
      phase: 'resolve',
      ...moveStep,
      result: 'failed',
      message: latestLogMessage(state, `${move.name}은(는) 실패했다!`),
    })
    return
  }

  if (DAMP_BLOCKED_MOVE_IDS.has(move.id)) {
    const dampPokemon = [attacker, defender].find((pokemon) => pokemon.ability === '습기')
    if (dampPokemon) {
      appendLog(state, `${dampPokemon.name}의 습기 때문에 ${move.name}은(는) 실패했다!`, 'ability')
      pushTimelineStep(timeline, state, {
        phase: 'resolve',
        ...moveStep,
        result: 'blocked',
        message: latestLogMessage(state, `${move.name}은(는) 실패했다!`),
      })
      return
    }
  }

  if (move.id === 'steelroller' && state.rules?.terrain?.id === 'neutral') {
    appendLog(state, '필드가 펼쳐져 있지 않아 아이언롤러는 실패했다!', 'muted')
    pushTimelineStep(timeline, state, {
      phase: 'resolve',
      ...moveStep,
      result: 'failed',
      message: latestLogMessage(state, '아이언롤러는 실패했다!'),
    })
    return
  }

  if (
    state.rules?.terrain?.id === 'psychic'
    && move.target !== 'self'
    && environmentMovePriority(state, attacker, move) > 0
    && isGrounded(defender, state)
  ) {
    appendLog(state, `사이코필드가 ${defender.name}을(를) 우선도 기술로부터 지켰다!`, 'field')
    pushTimelineStep(timeline, state, {
      phase: 'resolve',
      ...moveStep,
      result: 'blocked',
      message: latestLogMessage(state, `${move.name}은(는) 사이코필드에 막혔다!`),
    })
    return
  }

  if (
    move.target !== 'self'
    && environmentMovePriority(state, attacker, move) > 0
    && !move.ignoreAbility
    && getActivePokemonList(state, targetSide.id).some((pokemon) => (
      pokemon
      && !pokemon.fainted
      && pokemon.hp > 0
      && ['비비드바디', '여왕의위엄', '테일아머'].includes(pokemon.ability)
    ))
  ) {
    appendLog(state, `${defender.name} 진영의 특성이 선제 기술을 막아냈다!`, 'ability')
    pushTimelineStep(timeline, state, {
      phase: 'resolve',
      ...moveStep,
      result: 'blocked',
      message: latestLogMessage(state, `${move.name}은(는) 특성에 막혔다!`),
    })
    return
  }

  const semiInvulnerable = semiInvulnerableInteraction(defender, move)
  if (semiInvulnerable.avoided) {
    appendLog(state, `${defender.name}은(는) 공격이 닿지 않는 곳에 있다!`, 'muted')
    applyFailedMoveConsequences(state, attacker, move)
    pushTimelineStep(timeline, state, {
      phase: 'resolve',
      ...moveStep,
      result: 'miss',
      message: `${defender.name}은(는) 공격을 피했다!`,
    })
    return
  }

  if (!moveHits(state, attacker, defender, move, random)) {
    appendLog(state, `${attacker.name}의 공격은 빗나갔다!`, 'muted')
    applyFailedMoveConsequences(state, attacker, move)
    pushTimelineStep(timeline, state, {
      phase: 'resolve',
      ...moveStep,
      result: 'miss',
      message: `${attacker.name}의 공격은 빗나갔다!`,
    })
    return
  }

  if (isStatusMove(move)) {
    const statusMoveImmunity = move.ignoreAbility ? null : abilityImmunity(state, attacker, defender, move)
    if (move.target !== 'self' && statusMoveImmunity) {
      appendLog(state, `${defender.name}의 ${statusMoveImmunity}! 기술을 무효화했다.`, 'ability')
      applyAbilityImmunityEffect(state, defender, statusMoveImmunity)
      pushTimelineStep(timeline, state, {
        phase: 'resolve',
        ...moveStep,
        result: 'immune',
        message: latestLogMessage(state, `${defender.name}에게는 효과가 없다!`),
      })
      return
    }
    if (
      move.target !== 'self'
      && attacker.ability === '짓궂은마음'
      && defender.types.includes('악')
    ) {
      appendLog(state, `${defender.name}에게는 짓궂은마음으로 강화된 기술이 통하지 않는다!`, 'ability')
      pushTimelineStep(timeline, state, {
        phase: 'resolve',
        ...moveStep,
        result: 'immune',
        message: latestLogMessage(state, `${defender.name}에게는 효과가 없다!`),
      })
      return
    }
    if (move.target !== 'self' && !move.ignoreAbility && defender.ability === '황금몸') {
      appendLog(state, `${defender.name}의 황금몸! 변화 기술을 막아냈다!`, 'ability')
      pushTimelineStep(timeline, state, {
        phase: 'resolve',
        ...moveStep,
        result: 'immune',
        message: latestLogMessage(state, `${defender.name}에게는 효과가 없다!`),
      })
      return
    }
    if (
      move.target !== 'self'
      && !move.ignoreAbility
      && !move.reflectedByMagicBounce
      && defender.ability === '매직미러'
      && move.flags?.includes('reflectable')
    ) {
      appendLog(state, `${defender.name}의 매직미러가 ${move.name}을(를) 되받아쳤다!`, 'ability')
      applyStatusMove(state, defender, attacker, { ...move, reflectedByMagicBounce: true }, random)
      pushTimelineStep(timeline, state, {
        phase: 'status',
        ...moveStep,
        sideId: targetSide.id,
        targetSideId: sideId,
        actorName: defender.name,
        targetName: attacker.name,
        result: 'reflected',
        message: latestLogMessage(state, `${move.name}이(가) 되받아쳐졌다!`),
      })
      return
    }
    if (
      move.target !== 'self'
      && defender.protected
      && move.flags?.includes('protect')
      && !moveBypassesProtection(attacker, defender, move)
    ) {
      appendLog(state, `${defender.name}은(는) 공격을 막아냈다!`, 'muted')
      applyFailedMoveConsequences(state, attacker, move)
      pushTimelineStep(timeline, state, {
        phase: 'resolve',
        ...moveStep,
        result: 'blocked',
        message: latestLogMessage(state, `${defender.name}은(는) 공격을 막아냈다!`),
      })
      return
    }
    if (
      move.target !== 'self'
      && !move.ignoreAbility
      && defender.ability === '풍력발전'
      && move.flags?.includes('wind')
    ) {
      defender.chargeActive = true
      appendLog(state, `${defender.name}의 풍력발전! 전기를 충전했다!`, 'ability')
    }
    applyStatusMove(state, attacker, defender, move, random)
    applyMindBlownRecoil(state, attacker, move)
    applySelfDestruct(state, attacker, move, true)
    pushTimelineStep(timeline, state, {
      phase: 'status',
      ...moveStep,
      message: latestLogMessage(state, `${move.name}의 효과가 발동했다!`),
    })
    markPokemonFaint(state, targetSide.id, targetSlot, timeline, actionOrder)
    markPokemonFaint(state, sideId, actorSlot, timeline, actionOrder)
    markActiveFaints(state, timeline, actionOrder)
    applyMoveSwitching(state, sideId, move, random, timeline, actionOrder, actorSlot, targetSlot)
    activateDancerCopies(state, sideId, attacker, move, random, timeline, actionOrder, targetSlot)
    return
  }

  attacker.protectChain = 0

  let protectionMultiplier = 1
  if (
    defender.protected
    && move.flags?.includes('protect')
    && !move.bypassesMaxGuard
    && !moveBypassesProtection(attacker, defender, move)
  ) {
    const piercingDrill = defender.protectMode !== 'maxguard'
      && attacker.ability === '관통드릴'
      && moveMakesContact(attacker, move)
    if (defender.protectMode === 'maxguard' || !move.isMaxMove && !move.isZMove && !piercingDrill) {
      appendLog(state, `${defender.name}은(는) 공격을 막아냈다!`, 'muted')
      pushTimelineStep(timeline, state, {
        phase: 'resolve',
        ...moveStep,
        result: 'blocked',
        message: latestLogMessage(state, `${defender.name}은(는) 공격을 막아냈다!`),
      })
      if (applyProtectContactEffect(state, attacker, defender, move)) {
        pushTimelineStep(timeline, state, {
          phase: 'status',
          ...moveStep,
          result: 'protect-contact',
          message: latestLogMessage(state, `${attacker.name}에게 방어의 접촉 효과가 발동했다!`),
        })
      }
      applyFailedMoveConsequences(state, attacker, move)
      markActiveFaints(state, timeline, actionOrder)
      return
    }
    protectionMultiplier = 0.25
    appendLog(
      state,
      `${defender.name}은(는) 방어했지만 ${piercingDrill ? '관통드릴' : move.isZMove ? 'Z기술' : '맥스 기술'}의 충격을 완전히 막지 못했다!`,
      'muted',
    )
  }

  const immunity = move.ignoreAbility ? null : abilityImmunity(state, attacker, defender, move)
  if (immunity) {
    appendLog(state, `${defender.name}의 ${immunity}! 공격을 무효화했다.`, 'ability')
    applyAbilityImmunityEffect(state, defender, immunity)
    applyFailedMoveConsequences(state, attacker, move)
    pushTimelineStep(timeline, state, {
      phase: 'resolve',
      ...moveStep,
      result: 'immune',
      effectiveness: 0,
      message: latestLogMessage(state, `${defender.name}에게는 효과가 없다!`),
    })
    return
  }

  const parentalBondActive = parentalBondApplies(attacker, move)
  const hitCount = chooseMultiHitCount(attacker, move, random)
  const defenderHpBeforeMove = defender.hp
  let damage = 0
  let landedHits = 0
  let result = null

  for (let hitIndex = 0; hitIndex < hitCount && defender.hp > 0; hitIndex += 1) {
    const hitResult = fixedDamageResult(state, attacker, defender, move)
      ?? calculateDamage(
        state,
        attacker,
        defender,
        move,
        random,
        powerMultiplier
          * semiInvulnerable.powerMultiplier
          * protectionMultiplier
          * (parentalBondActive && hitIndex === 1 ? 0.25 : 1),
      )
    const formShield = applyFormDamageShield(state, defender, move, hitResult.damage)
    if (formShield) {
      hitResult.effectiveness = formShield.effectiveness
      hitResult.critical = false
    }
    if (!result) result = hitResult
    const hitDamage = formShield
      ? formShield.damage
      : applySurvivalEffects(state, defender, hitResult.damage, move)
    defender.hp = Math.max(0, defender.hp - hitDamage)
    damage += hitDamage
    landedHits += 1
    result.critical = result.critical || hitResult.critical
    if (hitResult.effectiveness === 0 || hitDamage === 0 && move.ohko) break
  }

  result ??= { damage: 0, effectiveness: getMoveTypeEffectiveness(state, attacker, defender, move), critical: false }
  state.lastEvent = {
    kind: 'hit',
    sideId,
    targetSideId: targetSide.id,
    damage,
    hitCount: landedHits,
    effectiveness: result.effectiveness,
    nonce: state.eventNonce += 1,
  }

  if (result.critical) appendLog(state, '급소에 맞았다!', 'critical')
  if (result.effectiveness > 1) appendLog(state, '효과가 굉장했다!', 'super')
  if (result.effectiveness === 0) appendLog(state, `${defender.name}에게는 효과가 없는 것 같다…`, 'muted')
  else if (result.effectiveness < 1) appendLog(state, '효과가 별로인 듯하다…', 'muted')

  if (landedHits > 1) appendLog(state, `${landedHits}번 맞았다!`, 'damage')

  pushTimelineStep(timeline, state, {
    phase: 'impact',
    ...moveStep,
    damage,
    effectiveness: result.effectiveness,
    critical: result.critical,
    message: damage > 0
      ? `${defender.name}에게 ${damage}의 데미지!`
      : `${defender.name}에게는 효과가 없는 것 같다…`,
  })

  const postEffectLogLength = state.log.length
  if (landedHits > 0 && result.effectiveness > 0) {
    applyEnvironmentAfterDamagingMove(state, sideId, attacker, defender, move, random)
  }
  if (landedHits > 0 && !attacker.dynamaxActive && TERRAIN_CLEARING_MOVE_IDS.has(move.id)) {
    const environmentState = ensureEnvironmentState(state)
    if (state.rules?.terrain?.id !== 'neutral' || environmentState.terrainTurns != null) {
      restoreBaseEnvironment(state, 'terrain', move.name)
    }
  }
  if (damage > 0 && move.drain) {
    const [numerator, denominator] = move.drain
    const drainAmount = damage * numerator / denominator
    if (defender.ability === '해감액') {
      loseHp(
        state,
        attacker,
        drainAmount,
        `${attacker.name}은(는) ${defender.name}의 해감액 때문에 HP를 빼앗겼다!`,
        'ability',
      )
    } else {
      healPokemon(state, attacker, drainAmount, move.name)
    }
  }

  if (damage > 0) {
    breakIllusion(state, defender)
    if (attacker.chargeActive && move.type === '전기') attacker.chargeActive = false
    applyPrimaryMoveEffects(state, attacker, defender, move, random)
    applyMoveSecondaries(state, attacker, defender, move, random, landedHits)
    applyDamagingHitAbilityEffects(
      state,
      attacker,
      defender,
      move,
      damage,
      defenderHpBeforeMove,
      landedHits,
      result.critical,
      random,
    )
    applyHpCrossingAbility(state, defender, defenderHpBeforeMove)
    applyReactiveFormAbility(state, attacker, defender, move, damage)
    applyEmergencySwitch(
      state,
      targetSide.id,
      defender,
      defenderHpBeforeMove,
      targetSlot,
      timeline,
      actionOrder,
    )
    applyMoveRecoil(state, attacker, move, damage)

    if (
      hasActiveHeldItem(attacker, 'life-orb')
      && attacker.ability !== '매직가드'
      && !(attacker.ability === '우격다짐' && hasSheerForceEffect(move))
      && attacker.hp > 0
    ) {
      loseHp(state, attacker, attacker.maxHp / 10, `${attacker.name}은(는) 생명의구슬로 HP가 줄었다.`, 'item')
    }

    if (move.flags?.includes('recharge') && attacker.hp > 0) {
      attacker.rechargeTurns = 1
      appendLog(state, `${attacker.name}은(는) 다음 턴에 반동으로 움직일 수 없다!`, 'status')
    }
    if (!action.dancerCopy) handleLockedMove(state, attacker, move, action.moveIndex, action, random)
    applyMoveTriggeredFormAfterHit(state, attacker, defender, move, damage)
    if (defender.hp <= 0) applyKnockoutAbility(state, attacker)
  } else if (result.effectiveness === 0) {
    applyCrashDamage(state, attacker, move)
  }

  applyMindBlownRecoil(state, attacker, move)

  if (defender.hp <= 0 && defender.destinyBondActive && attacker.hp > 0 && damage > 0) {
    attacker.hp = 0
    appendLog(state, `${defender.name}의 길동무! ${attacker.name}도 함께 쓰러진다!`, 'status')
  }

  applySelfDestruct(state, attacker, move, damage > 0)

  const hasPostEffectLog = state.log.length > postEffectLogLength
  const postEffectMessage = latestLogMessage(state, `${move.name}의 추가 효과가 발동했다!`)
  markPokemonFaint(state, targetSide.id, targetSlot, timeline, actionOrder)

  if (hasPostEffectLog) {
    pushTimelineStep(timeline, state, {
      phase: 'status',
      ...moveStep,
      targetSideId: sideId,
      message: postEffectMessage,
    })
  }

  markPokemonFaint(state, sideId, actorSlot, timeline, actionOrder)
  markActiveFaints(state, timeline, actionOrder)

  if (damage > 0) applyMoveSwitching(state, sideId, move, random, timeline, actionOrder, actorSlot, targetSlot)
  activateDancerCopies(state, sideId, attacker, move, random, timeline, actionOrder, targetSlot)
}

function endDynamax(state, pokemon) {
  if (!pokemon.dynamaxActive) return
  pokemon.dynamaxActive = false
  pokemon.dynamaxTurns = 0
  pokemon.hp = pokemon.hp > 0 ? Math.max(1, Math.ceil(pokemon.hp / 2)) : 0
  pokemon.maxHp = pokemon.originalMaxHp
  if (pokemon.dynamaxOriginalForm) {
    pokemon.speciesId = pokemon.dynamaxOriginalForm.speciesId
    pokemon.name = pokemon.dynamaxOriginalForm.name
    pokemon.spriteFront = pokemon.dynamaxOriginalForm.spriteFront
    pokemon.spriteBack = pokemon.dynamaxOriginalForm.spriteBack
    pokemon.spriteFrontFallback = pokemon.dynamaxOriginalForm.spriteFrontFallback
    pokemon.spriteBackFallback = pokemon.dynamaxOriginalForm.spriteBackFallback
    pokemon.dynamaxOriginalForm = null
  }
  appendLog(state, `${pokemon.name}의 다이맥스가 풀렸다.`, 'muted')
}

function resetPokemonStatStages(pokemon) {
  let changed = false
  Object.keys(pokemon.statStages).forEach((statKey) => {
    if (pokemon.statStages[statKey] !== 0) changed = true
    pokemon.statStages[statKey] = 0
  })
  return changed
}

function forewarnMoveScore(move) {
  if (move.ohko) return 160
  if (['counter', 'metalburst', 'mirrorcoat'].includes(move.id)) return 120
  return Math.max(0, Number(move.power) || 0)
}

function activateCommanderPair(state, sideId) {
  if ((state.rules?.format?.activeSlots ?? 1) < 2) return false
  const activePokemon = getActivePokemonList(state, sideId).filter((pokemon) => (
    pokemon && !pokemon.fainted && pokemon.hp > 0
  ))
  const commander = activePokemon.find((pokemon) => (
    pokemon.ability === '사령탑' && !pokemon.commanding
  ))
  const host = activePokemon.find((pokemon) => (
    pokemon.battleId !== commander?.battleId
    && String(pokemon.slug ?? '').startsWith('dondozo')
    && !pokemon.commandedByBattleId
  ))
  if (!commander || !host) return false

  commander.commanding = true
  commander.commanderHostBattleId = host.battleId
  host.commandedByBattleId = commander.battleId
  appendLog(state, `${commander.name}의 사령탑! ${host.name}의 입속으로 들어갔다!`, 'ability')
  changeStages(state, host, {
    attack: 2,
    defense: 2,
    specialAttack: 2,
    specialDefense: 2,
    speed: 2,
  })
  return true
}

function releaseCommander(state, host) {
  if (!host?.commandedByBattleId) return false
  const side = getPokemonSide(state, host)
  const commander = side.team.find((pokemon) => pokemon.battleId === host.commandedByBattleId)
  if (commander) {
    commander.commanding = false
    commander.commanderHostBattleId = null
    appendLog(state, `${commander.name}이(가) ${host.name}에게서 빠져나왔다!`, 'ability')
  }
  host.commandedByBattleId = null
  return Boolean(commander)
}

function releaseCommanderForPokemon(state, pokemon) {
  if (!pokemon) return false
  if (pokemon.commandedByBattleId) return releaseCommander(state, pokemon)
  if (!pokemon.commanderHostBattleId) return false
  const side = getPokemonSide(state, pokemon)
  const host = side.team.find((ally) => ally.battleId === pokemon.commanderHostBattleId)
  if (host) host.commandedByBattleId = null
  pokemon.commanding = false
  pokemon.commanderHostBattleId = null
  return Boolean(host)
}

function inheritFaintedAllyAbility(state, sideId, faintedPokemon) {
  if (
    !faintedPokemon?.ability
    || UNTRACEABLE_ABILITIES.has(faintedPokemon.ability)
    || RECEIVER_ABILITIES.has(faintedPokemon.ability)
  ) return false
  let inherited = false
  getActivePokemonList(state, sideId)
    .filter((pokemon) => (
      pokemon
      && pokemon.battleId !== faintedPokemon.battleId
      && !pokemon.fainted
      && pokemon.hp > 0
      && RECEIVER_ABILITIES.has(pokemon.ability)
    ))
    .forEach((pokemon) => {
      const receiverAbility = pokemon.ability
      pokemon.ability = faintedPokemon.ability
      appendLog(state, `${pokemon.name}의 ${receiverAbility}! ${faintedPokemon.name}의 ${pokemon.ability}을(를) 이어받았다!`, 'ability')
      inherited = true
    })
  return inherited
}

function activateEntrySupportAbilities(state, sideId, pokemon, opponents) {
  const allies = activeAllies(state, pokemon)

  if (pokemon.ability === '기묘한약') {
    const resetAllies = allies.filter(resetPokemonStatStages)
    if (resetAllies.length > 0) {
      appendLog(state, `${pokemon.name}의 기묘한약! 아군의 능력 변화가 원래대로 돌아왔다!`, 'ability')
    }
  }

  if (pokemon.ability === '대접') {
    const healed = allies.reduce((total, ally) => (
      total + healPokemon(state, ally, ally.maxHp / 4, '대접')
    ), 0)
    if (healed > 0) appendLog(state, `${pokemon.name}의 대접! 아군을 대접했다!`, 'ability')
  }

  if (pokemon.ability === '협연') {
    const source = allies[0]
    if (source) {
      pokemon.statStages = { ...source.statStages }
      appendLog(state, `${pokemon.name}의 협연! ${source.name}의 능력 변화를 따라 했다!`, 'ability')
    }
  }

  if (pokemon.ability === '예지몽') {
    const revealedMove = opponents
      .flatMap((target) => target.moves)
      .filter(Boolean)
      .sort((first, second) => forewarnMoveScore(second) - forewarnMoveScore(first))[0]
    if (revealedMove) {
      appendLog(state, `${pokemon.name}의 예지몽! 상대의 ${revealedMove.name}을(를) 꿰뚫어 봤다!`, 'ability')
    }
  }
}

function activateEntryAbility(state, sideId, activeSlot = null) {
  const pokemon = getActivePokemon(state, sideId, activeSlot)
  if (!pokemon || pokemon.fainted || pokemon.hp <= 0) return

  activateIllusion(state, sideId, pokemon)
  activateTraceAbility(state, sideId, activeSlot, pokemon)
  activateFormEntryAbility(state, sideId, activeSlot, pokemon)
  const weatherRule = ENTRY_WEATHER_ABILITY_RULES[pokemon.ability]
  const terrainRule = ENTRY_TERRAIN_ABILITY_RULES[pokemon.ability]
  const weatherId = weatherRule?.weatherId
  const terrainId = terrainRule?.terrainId
  if (weatherId || terrainId) appendLog(state, `${pokemon.name}의 ${pokemon.ability}!`, 'ability')
  if (weatherId) setTemporaryEnvironment(state, 'weather', weatherId, pokemon.ability, pokemon, weatherRule)
  if (terrainId) setTemporaryEnvironment(state, 'terrain', terrainId, pokemon.ability, pokemon)
  if (['프레셔', '긴장감', '틀깨기', '터보블레이즈', '테라볼티지'].includes(pokemon.ability)) {
    appendLog(state, `${pokemon.name}의 ${pokemon.ability}!`, 'ability')
  }

  const opposingSideId = sideId === 'player' ? 'opponent' : 'player'
  const opponents = getActivePokemonList(state, opposingSideId)
    .filter((target) => target && !target.fainted && target.hp > 0)
  activateEntrySupportAbilities(state, sideId, pokemon, opponents)
  activateCommanderPair(state, sideId)

  if (pokemon.ability === '통찰') {
    opponents
      .filter((target) => target.heldItemId && !target.consumedItem)
      .forEach((target) => {
        appendLog(
          state,
          `${pokemon.name}의 통찰! ${target.name}의 ${target.heldItemName || target.heldItemId}을(를) 꿰뚫어 봤다!`,
          'ability',
        )
      })
  }

  if (pokemon.ability === '위험예지') {
    const dangerDetected = opponents.some((target) => target.moves.some((move) => {
      if (!move || isStatusMove(move)) return false
      const resolvedMove = resolveEnvironmentMove(state, target, pokemon, move)
      return Boolean(resolvedMove.ohko)
        || getMoveTypeEffectiveness(state, target, pokemon, resolvedMove) > 1
    }))
    if (dangerDetected) appendLog(state, `${pokemon.name}은(는) 위험을 예지하고 몸을 떨었다!`, 'ability')
  }

  if (pokemon.ability === '파스텔베일') {
    const curedAllies = getActivePokemonList(state, sideId).filter((ally) => {
      if (!['poison', 'toxic'].includes(ally.status?.id)) return false
      ally.status = null
      return true
    })
    if (curedAllies.length > 0) {
      appendLog(state, `${pokemon.name}의 파스텔베일! 아군의 독 상태가 치유되었다!`, 'ability')
    }
  }

  if (pokemon.ability === '배리어프리') {
    const screensRemoved = [state.player, state.opponent].some((side) => side.auroraVeilTurns > 0)
    if (screensRemoved) {
      state.player.auroraVeilTurns = 0
      state.opponent.auroraVeilTurns = 0
      appendLog(state, `${pokemon.name}의 배리어프리! 양쪽 진영의 장벽이 사라졌다!`, 'ability')
    }
  }

  if (pokemon.ability === '위협') {
    opponents
      .filter((target) => target && !target.fainted && target.hp > 0)
      .forEach((target) => changeStages(state, target, { attack: -1 }, {
        source: pokemon,
        reason: INTIMIDATE_REASON,
      }))
    appendLog(state, `${pokemon.name}의 위협!`, 'ability')
  }

  const entryStatRule = ENTRY_STAT_ABILITY_RULES[pokemon.ability]
  if (
    entryStatRule
    && (!entryStatRule.oncePerBattle || !pokemon.entryAbilityActivations[pokemon.ability])
  ) {
    pokemon.entryAbilityActivations[pokemon.ability] = (
      pokemon.entryAbilityActivations[pokemon.ability] ?? 0
    ) + 1
    appendLog(state, `${pokemon.name}의 ${pokemon.ability}!`, 'ability')
    changeStages(state, pokemon, entryStatRule.boosts)
  }

  const opponentEntryStatRule = ENTRY_OPPONENT_STAT_ABILITY_RULES[pokemon.ability]
  if (
    opponentEntryStatRule
    && (!opponentEntryStatRule.oncePerBattle || !pokemon.entryAbilityActivations[pokemon.ability])
  ) {
    pokemon.entryAbilityActivations[pokemon.ability] = (
      pokemon.entryAbilityActivations[pokemon.ability] ?? 0
    ) + 1
    appendLog(state, `${pokemon.name}의 ${pokemon.ability}!`, 'ability')
    getActivePokemonList(state, sideId === 'player' ? 'opponent' : 'player')
      .filter((target) => target && !target.fainted && target.hp > 0)
      .forEach((target) => changeStages(state, target, opponentEntryStatRule.boosts, { source: pokemon }))
  }

  if (pokemon.ability === '다운로드') {
    const opponents = getActivePokemonList(state, sideId === 'player' ? 'opponent' : 'player')
      .filter((target) => target && !target.fainted && target.hp > 0)
    if (opponents.length > 0) {
      const defenseTotal = opponents.reduce((total, target) => (
        total + effectiveStat(state, target, 'defense')
      ), 0)
      const specialDefenseTotal = opponents.reduce((total, target) => (
        total + effectiveStat(state, target, 'specialDefense')
      ), 0)
      appendLog(state, `${pokemon.name}의 다운로드!`, 'ability')
      changeStages(
        state,
        pokemon,
        defenseTotal < specialDefenseTotal ? { attack: 1 } : { specialAttack: 1 },
      )
    }
  }
  refreshEnvironmentDependentAbilities(state)
}

function clearSwitchVolatiles(pokemon) {
  restoreIllusion(pokemon)
  if (pokemon.transformSnapshot) {
    Object.assign(pokemon, pokemon.transformSnapshot)
    pokemon.transformSnapshot = null
  }
  if (pokemon.tracedAbilityBase) {
    pokemon.ability = pokemon.tracedAbilityBase
    pokemon.tracedAbilityBase = null
  }
  pokemon.statStages = Object.fromEntries(Object.keys(pokemon.statStages).map((key) => [key, 0]))
  pokemon.protected = false
  pokemon.protectMode = null
  pokemon.protectChain = 0
  pokemon.flinched = false
  pokemon.confusionTurns = 0
  pokemon.infatuated = false
  pokemon.yawnTurns = 0
  pokemon.perishCount = null
  pokemon.destinyBondActive = false
  pokemon.trappedTurns = 0
  pokemon.trapSourceName = null
  pokemon.trapDamages = false
  pokemon.tormented = false
  pokemon.lastMoveIndex = null
  pokemon.criticalStageBoost = 0
  pokemon.redirectTurns = 0
  pokemon.redirectMode = null
  pokemon.rechargeTurns = 0
  pokemon.chargingMove = null
  pokemon.lockedMove = null
  pokemon.semiInvulnerable = null
  pokemon.proteanUsed = false
  pokemon.activeTurnCount = 0
  pokemon.activeMoveActions = 0
  pokemon.actedThisTurn = false
  pokemon.switchedInThisTurn = false
  pokemon.truantLoafing = false
  pokemon.flashFireActive = false
  pokemon.chargeActive = false
  pokemon.custapActive = false
  pokemon.gorillaLockedMoveIndex = null
  pokemon.weightReduction = 0
  pokemon.cudChewReadyTurn = null
  pokemon.cudChewItemId = ''
  pokemon.cudChewItemName = ''
  pokemon.commanding = false
  pokemon.commanderHostBattleId = null
  pokemon.commandedByBattleId = null
  pokemon.disabledMoveIndex = null
  pokemon.disabledMoveTurns = 0
  pokemon.saltCureActive = false
  pokemon.syrupBombTurns = 0
  pokemon.healBlockTurns = 0
  if (pokemon.status?.id === 'toxic') pokemon.status.toxicCounter = 1
}

function applyEntryHazards(state, side, pokemon) {
  if (!pokemon || pokemon.fainted || pokemon.hp <= 0) return
  const hazards = side.hazards ?? {}
  if (hasActiveHeldItem(pokemon, 'heavy-duty-boots')) return

  if (Number(hazards.toxicSpikes ?? 0) > 0 && isGrounded(pokemon, state)) {
    if (pokemon.types.includes('독')) {
      hazards.toxicSpikes = 0
      appendLog(state, `${pokemon.name}이(가) 진영의 독압정을 흡수했다!`, 'field')
    } else {
      setStatus(
        state,
        pokemon,
        Number(hazards.toxicSpikes) >= 2 ? 'toxic' : 'poison',
        '독압정',
      )
    }
  }

  if (pokemon.ability === '매직가드') return
  const hazardTypes = []
  if (hazards.stealthRock) hazardTypes.push({ type: '바위', name: '스텔스록' })
  if (hazards.steelsurge) hazardTypes.push({ type: '강철', name: '거다이강철진' })

  hazardTypes.forEach(({ type, name }) => {
    if (pokemon.hp <= 0) return
    const effectiveness = getBattleTypeEffectiveness(state, type, pokemon.types)
    const damage = Math.max(1, Math.floor(pokemon.maxHp * effectiveness / 8))
    pokemon.hp = Math.max(0, pokemon.hp - damage)
    appendLog(state, `${pokemon.name}은(는) ${name}에 데미지를 입었다!`, 'damage')
  })
}

function performSwitch(
  state,
  sideId,
  targetIndex,
  isAutomatic = false,
  timeline = null,
  actionOrder = null,
  activeSlot = null,
) {
  const side = getSide(state, sideId)
  const resolvedSlot = activeSlot == null ? activeSlotIndex(state, side) : activeSlot
  const currentTeamIndex = side.activeIndexes[resolvedSlot] ?? side.activeIndex
  const current = side.team[currentTeamIndex]
  const target = side.team[targetIndex]
  if (!target || target.fainted || target.hp <= 0 || side.activeIndexes.includes(targetIndex)) return false
  if (current.hp > 0 && !current.fainted && (current.commanding || current.commandedByBattleId)) {
    appendLog(state, `${current.name}은(는) 사령탑의 효과로 교체할 수 없다!`, 'ability')
    return false
  }
  if (!isAutomatic && current.hp > 0 && !current.fainted) {
    const abilitySource = trappingAbilitySource(state, current)
    if (current.trappedTurns > 0 || abilitySource) {
      appendLog(
        state,
        `${current.name}은(는) ${current.trapSourceName ?? abilitySource?.ability ?? '기술의 효과'} 때문에 교체할 수 없다!`,
        abilitySource ? 'ability' : 'status',
      )
      return false
    }
  }

  pushTimelineStep(timeline, state, {
    phase: 'switch-out',
    actionOrder,
    sideId,
    targetSideId: sideId,
    actorSlot: resolvedSlot,
    targetSlot: resolvedSlot,
    actorName: current.name,
    actorSpeciesId: current.speciesId,
    actorOriginalSpeciesId: current.originalSpeciesId,
    targetName: target.name,
    message: sideId === 'player'
      ? `${current.name}, 돌아와!`
      : `${side.name}은(는) ${current.name}을(를) 불러들였다!`,
  })

  if (current.dynamaxActive) endDynamax(state, current)
  releaseCommander(state, current)
  prepareSwitchOutForm(state, current)
  clearSwitchVolatiles(current)
  side.activeIndexes[resolvedSlot] = targetIndex
  side.activeIndex = side.activeIndexes[state.rules?.format?.rotation ? side.rotationSlot : 0] ?? targetIndex
  refreshStrongWeatherSource(state)
  clearSwitchVolatiles(target)
  target.switchedInThisTurn = true
  applyPendingDifficultyBoost(target)
  activateIllusion(state, sideId, target)
  appendLog(
    state,
    sideId === 'player'
      ? `${target.name}! 부탁해!`
      : `${side.name}은(는) ${target.name}을(를) 내보냈다!`,
    isAutomatic ? 'switch' : sideId,
  )

  if (side.healingWishPending) {
    target.hp = target.maxHp
    target.status = null
    if (side.healingWishPending === 'lunardance') {
      target.moves.forEach((move) => { move.currentPp = move.maxPp })
    }
    appendLog(
      state,
      `${target.name}은(는) ${side.healingWishPending === 'lunardance' ? '초승달춤' : '치유소원'}으로 완전히 회복했다!`,
      'heal',
    )
    side.healingWishPending = null
  }
  if (side.zHealReplacement) {
    target.hp = target.maxHp
    appendLog(state, `${target.name}은(는) Z파워로 완전히 회복했다!`, 'heal')
    side.zHealReplacement = false
  }
  applyEntryHazards(state, side, target)
  activateEntryAbility(state, sideId, resolvedSlot)
  state.lastEvent = { kind: 'switch', sideId, nonce: state.eventNonce += 1 }
  pushTimelineStep(timeline, state, {
    phase: 'switch',
    actionOrder,
    sideId,
    targetSideId: sideId,
    actorSlot: resolvedSlot,
    targetSlot: resolvedSlot,
    actorName: target.name,
    actorSpeciesId: target.speciesId,
    actorOriginalSpeciesId: target.originalSpeciesId,
    message: latestLogMessage(state, `${target.name}이(가) 배틀에 나왔다!`),
  })
  return true
}

function applyEmergencySwitch(
  state,
  sideId,
  pokemon,
  previousHp,
  activeSlot,
  timeline = null,
  actionOrder = null,
) {
  if (
    !pokemon
    || pokemon.fainted
    || pokemon.hp <= 0
    || !EMERGENCY_SWITCH_ABILITIES.has(pokemon.ability)
    || previousHp <= pokemon.maxHp / 2
    || pokemon.hp > pokemon.maxHp / 2
  ) return false

  const side = getSide(state, sideId)
  if (availableBenchIndexes(side).length === 0) return false
  const targetIndex = chooseAiReplacementIndex(state, sideId, activeSlot)
  if (targetIndex == null) return false

  appendLog(state, `${pokemon.name}의 ${pokemon.ability}! 위험을 피해 돌아간다!`, 'ability')
  return performSwitch(state, sideId, targetIndex, true, timeline, actionOrder, activeSlot)
}

function residualEffects(state, sideId, timeline = null, activeSlot = null, random = Math.random) {
  const side = getSide(state, sideId)
  const pokemon = getActivePokemon(state, sideId, activeSlot)
  if (!pokemon || pokemon.fainted || pokemon.hp <= 0 || pokemon.commanding) return
  const previousHp = pokemon.hp
  const previousMaxHp = pokemon.maxHp
  const previousLogLength = state.log.length
  const weatherId = effectiveWeatherFamilyId(state)

  if (pokemon.hp > 0 && weatherId === 'rain' && pokemon.ability === '촉촉바디' && pokemon.status) {
    pokemon.status = null
    appendLog(state, `${pokemon.name}의 촉촉바디가 상태 이상을 회복했다!`, 'ability')
  }

  if (pokemon.hp > 0 && pokemon.ability === '탈피' && pokemon.status && random() < 1 / 3) {
    const statusLabel = pokemon.status.label
    pokemon.status = null
    appendLog(state, `${pokemon.name}의 탈피! ${statusLabel} 상태가 회복되었다.`, 'ability')
  }

  let damage = 0
  if (pokemon.status?.id === 'burn') damage = Math.max(1, Math.floor(pokemon.maxHp / 16))
  if (pokemon.status?.id === 'poison' && pokemon.ability !== '포이즌힐') {
    damage = Math.max(1, Math.floor(pokemon.maxHp / 8))
  }
  if (pokemon.status?.id === 'toxic' && pokemon.ability !== '포이즌힐') {
    damage = Math.max(1, Math.floor((pokemon.maxHp * pokemon.status.toxicCounter) / 16))
    pokemon.status.toxicCounter += 1
  }

  if (damage > 0 && pokemon.ability !== '매직가드') {
    pokemon.hp = Math.max(0, pokemon.hp - damage)
    appendLog(state, `${pokemon.name}은(는) ${pokemon.status.label}의 데미지를 입었다.`, 'damage')
  }

  if (pokemon.hp > 0 && pokemon.saltCureActive && pokemon.ability !== '매직가드') {
    const saltCureDenominator = pokemon.types.some((type) => ['물', '강철'].includes(type)) ? 4 : 8
    const saltCureDamage = Math.max(1, Math.floor(pokemon.maxHp / saltCureDenominator))
    pokemon.hp = Math.max(0, pokemon.hp - saltCureDamage)
    appendLog(state, `${pokemon.name}은(는) 소금절이의 데미지를 입었다!`, 'damage')
  }

  if (
    pokemon.hp > 0
    && pokemon.status?.id === 'sleep'
    && getActivePokemonList(state, sideId === 'player' ? 'opponent' : 'player')
      .some((opponent) => opponent && !opponent.fainted && opponent.hp > 0 && opponent.ability === '나이트메어')
    && pokemon.ability !== '매직가드'
  ) {
    loseHp(state, pokemon, pokemon.maxHp / 8, `${pokemon.name}은(는) 나이트메어에 시달렸다!`, 'ability')
  }

  if (
    pokemon.hp > 0
    && weatherId === 'sandstorm'
    && !pokemon.types.some((type) => ['바위', '땅', '강철'].includes(type))
    && !SANDSTORM_IMMUNE_ABILITIES.has(pokemon.ability)
  ) {
    const weatherDamage = Math.max(1, Math.floor(pokemon.maxHp / 16))
    pokemon.hp = Math.max(0, pokemon.hp - weatherDamage)
    appendLog(state, `${pokemon.name}은(는) 모래바람에 시달렸다.`, 'damage')
  }

  if (pokemon.hp > 0 && weatherId === 'rain' && pokemon.ability === '젖은접시') {
    healPokemon(state, pokemon, pokemon.maxHp / 16, '젖은접시')
  }
  if (pokemon.hp > 0 && weatherId === 'rain' && pokemon.ability === '건조피부') {
    healPokemon(state, pokemon, pokemon.maxHp / 8, '건조피부')
  }
  if (pokemon.hp > 0 && weatherId === 'snow' && pokemon.ability === '아이스바디') {
    healPokemon(state, pokemon, pokemon.maxHp / 16, '아이스바디')
  }
  if (
    pokemon.hp > 0
    && ['poison', 'toxic'].includes(pokemon.status?.id)
    && pokemon.ability === '포이즌힐'
  ) {
    healPokemon(state, pokemon, pokemon.maxHp / 8, '포이즌힐')
  }
  if (
    pokemon.hp > 0
    && weatherId === 'sun'
    && ['건조피부', '선파워'].includes(pokemon.ability)
  ) {
    const weatherDamage = Math.max(1, Math.floor(pokemon.maxHp / 8))
    pokemon.hp = Math.max(0, pokemon.hp - weatherDamage)
    appendLog(state, `${pokemon.name}은(는) 강한 햇살에 HP가 줄었다.`, 'ability')
  }

  if (
    pokemon.hp > 0
    && side.gmaxResidual?.turns > 0
    && !pokemon.types.includes(side.gmaxResidual.immuneType)
    && pokemon.ability !== '매직가드'
  ) {
    const residualDamage = Math.max(1, Math.floor(pokemon.maxHp / 6))
    pokemon.hp = Math.max(0, pokemon.hp - residualDamage)
    appendLog(state, `${pokemon.name}은(는) ${side.gmaxResidual.moveName}의 여파로 데미지를 입었다!`, 'damage')
  }

  if (pokemon.hp > 0 && pokemon.trappedTurns > 0) {
    if (pokemon.trapDamages && pokemon.ability !== '매직가드') {
      const trapDamage = Math.max(1, Math.floor(pokemon.maxHp / 8))
      pokemon.hp = Math.max(0, pokemon.hp - trapDamage)
      appendLog(state, `${pokemon.name}은(는) ${pokemon.trapSourceName}에 시달렸다!`, 'damage')
    }
    pokemon.trappedTurns -= 1
    if (pokemon.trappedTurns <= 0) {
      appendLog(state, `${pokemon.name}은(는) 구속에서 벗어났다!`, 'heal')
      pokemon.trapSourceName = null
      pokemon.trapDamages = false
    }
  }

  if (pokemon.hp > 0 && pokemon.yawnTurns > 0) {
    if (pokemon.status) {
      pokemon.yawnTurns = 0
    } else {
      pokemon.yawnTurns -= 1
      if (pokemon.yawnTurns === 0) setStatus(state, pokemon, 'sleep', '하품')
    }
  }

  if (pokemon.hp > 0 && pokemon.syrupBombTurns > 0) {
    changeStages(state, pokemon, { speed: -1 })
    pokemon.syrupBombTurns -= 1
    if (pokemon.syrupBombTurns <= 0) {
      appendLog(state, `${pokemon.name}을(를) 뒤덮은 시럽의 효과가 사라졌다.`, 'heal')
    }
  }

  if (pokemon.healBlockTurns > 0) {
    pokemon.healBlockTurns -= 1
    if (pokemon.healBlockTurns <= 0) {
      appendLog(state, `${pokemon.name}은(는) 다시 HP를 회복할 수 있게 되었다.`, 'heal')
    }
  }

  if (pokemon.disabledMoveTurns > 0) {
    pokemon.disabledMoveTurns -= 1
    if (pokemon.disabledMoveTurns <= 0) {
      const disabledMove = pokemon.moves[pokemon.disabledMoveIndex]
      appendLog(state, `${pokemon.name}은(는) ${disabledMove?.name ?? '기술'}을(를) 다시 쓸 수 있게 되었다!`, 'heal')
      pokemon.disabledMoveIndex = null
    }
  }

  if (pokemon.hp > 0 && pokemon.perishCount != null) {
    pokemon.perishCount -= 1
    if (pokemon.perishCount <= 0) {
      pokemon.hp = 0
      pokemon.perishCount = null
      appendLog(state, `${pokemon.name}의 멸망 카운트가 0이 되었다!`, 'damage')
    } else {
      appendLog(state, `${pokemon.name}의 멸망 카운트는 ${pokemon.perishCount}!`, 'status')
    }
  }

  if (pokemon.hp > 0 && hasActiveHeldItem(pokemon, 'leftovers')) {
    healPokemon(state, pokemon, pokemon.maxHp / 16, '먹다남은음식')
  }
  if (pokemon.hp > 0 && state.rules?.terrain?.id === 'grassy' && isGrounded(pokemon, state)) {
    healPokemon(state, pokemon, pokemon.maxHp / 16, '그래스필드')
  }
  if (pokemon.hp > 0 && hasActiveHeldItem(pokemon, 'black-sludge') && pokemon.types.includes('독')) {
    healPokemon(state, pokemon, pokemon.maxHp / 16, '검은오물')
  }
  consumeLowHpBerry(state, pokemon, random)
  if (pokemon.hp > 0 && pokemon.cudChewReadyTurn != null && state.turn >= pokemon.cudChewReadyTurn) {
    repeatCudChewBerry(state, pokemon, random)
  }
  if (
    pokemon.hp > 0
    && pokemon.ability === '수확'
    && pokemon.consumedItem
    && pokemon.heldItemId?.endsWith('-berry')
    && (weatherId === 'sun' || random() < 0.5)
  ) {
    pokemon.consumedItem = false
    if (
      state.lastConsumedItem?.consumerBattleId === pokemon.battleId
      && state.lastConsumedItem.id === pokemon.heldItemId
    ) state.lastConsumedItem = null
    appendLog(state, `${pokemon.name}의 수확! 사용한 나무열매를 다시 만들었다!`, 'ability')
  }

  if (pokemon.hp > 0 && pokemon.ability === '치유의마음' && random() < 0.3) {
    const statusAllies = activeAllies(state, pokemon).filter((ally) => ally.status)
    const ally = statusAllies[Math.floor(random() * statusAllies.length)]
    if (ally) {
      const statusLabel = ally.status.label
      ally.status = null
      appendLog(state, `${pokemon.name}의 치유의마음! ${ally.name}의 ${statusLabel} 상태가 회복되었다!`, 'ability')
    }
  }

  if (
    pokemon.hp > 0
    && pokemon.ability === '픽업'
    && (!pokemon.heldItemId || pokemon.consumedItem)
    && state.lastConsumedItem?.turn === state.turn
    && state.lastConsumedItem.consumerBattleId !== pokemon.battleId
  ) {
    pokemon.heldItemId = state.lastConsumedItem.id
    pokemon.heldItemName = state.lastConsumedItem.name
    pokemon.consumedItem = false
    pokemon.hadHeldItem = true
    appendLog(state, `${pokemon.name}의 픽업! ${pokemon.heldItemName || pokemon.heldItemId}을(를) 주웠다!`, 'ability')
    state.lastConsumedItem = null
  }

  if (pokemon.dynamaxActive) {
    pokemon.dynamaxTurns -= 1
    if (pokemon.dynamaxTurns <= 0) endDynamax(state, pokemon)
  }

  if (pokemon.hp > 0) refreshHpFormAbility(state, pokemon, 'residual')
  if (pokemon.hp > 0 && pokemon.ability === '가속') {
    appendLog(state, `${pokemon.name}의 가속!`, 'ability')
    changeStages(state, pokemon, { speed: 1 })
  }
  if (pokemon.hp > 0 && pokemon.ability === '변덕쟁이') {
    const statKeys = ['attack', 'defense', 'specialAttack', 'specialDefense', 'speed', 'accuracy', 'evasion']
    const boostable = statKeys.filter((statKey) => pokemon.statStages[statKey] < 6)
    const boostedStat = boostable[Math.floor(random() * boostable.length)]
    const droppable = statKeys.filter((statKey) => (
      statKey !== boostedStat && pokemon.statStages[statKey] > -6
    ))
    const droppedStat = droppable[Math.floor(random() * droppable.length)]
    appendLog(state, `${pokemon.name}의 변덕쟁이!`, 'ability')
    changeStages(state, pokemon, {
      ...(boostedStat ? { [boostedStat]: 2 } : {}),
      ...(droppedStat ? { [droppedStat]: -1 } : {}),
    })
  }
  if (pokemon.hp > 0) pokemon.activeTurnCount = (pokemon.activeTurnCount ?? 0) + 1

  if (state.log.length > previousLogLength || pokemon.hp !== previousHp || pokemon.maxHp !== previousMaxHp) {
    pushTimelineStep(timeline, state, {
      phase: 'residual',
      sideId,
      targetSideId: sideId,
      actorSlot: activeSlot ?? activeSlotIndex(state, getSide(state, sideId)),
      targetSlot: activeSlot ?? activeSlotIndex(state, getSide(state, sideId)),
      actorName: pokemon.name,
      damage: Math.max(0, previousHp - pokemon.hp),
      message: latestLogMessage(state, `${pokemon.name}에게 턴 종료 효과가 적용되었다.`),
    })
  }
}

function advanceSideConditionTimers(state) {
  ;[state.player, state.opponent].forEach((side) => {
    if (side.gmaxResidual?.turns > 0) {
      side.gmaxResidual.turns -= 1
      if (side.gmaxResidual.turns <= 0) {
        appendLog(state, `${side.gmaxResidual.moveName}의 여파가 사라졌다.`, 'field')
        side.gmaxResidual = null
      }
    }
    if (side.auroraVeilTurns > 0) {
      side.auroraVeilTurns -= 1
      if (side.auroraVeilTurns <= 0) appendLog(state, '오로라베일의 효과가 사라졌다.', 'field')
    }
  })

  if (state.environment.gravityTurns > 0) {
    state.environment.gravityTurns -= 1
    if (state.environment.gravityTurns <= 0) appendLog(state, '중력이 원래대로 돌아왔다.', 'field')
  }
}

function markPokemonFaint(state, sideId, activeSlot, timeline = null, actionOrder = null) {
  const pokemon = getActivePokemon(state, sideId, activeSlot)
  if (!pokemon || pokemon.hp > 0 || pokemon.fainted) return false

  pokemon.fainted = true
  appendLog(state, `${pokemon.name}은(는) 쓰러졌다!`, 'faint')
  releaseCommanderForPokemon(state, pokemon)
  inheritFaintedAllyAbility(state, sideId, pokemon)
  ;['player', 'opponent'].forEach((activeSideId) => {
    getActivePokemonList(state, activeSideId)
      .filter((activePokemon) => (
        activePokemon
        && !activePokemon.fainted
        && activePokemon.hp > 0
        && activePokemon.ability === '소울하트'
      ))
      .forEach((activePokemon) => {
        appendLog(state, `${activePokemon.name}의 소울하트!`, 'ability')
        changeStages(state, activePokemon, { specialAttack: 1 })
      })
  })
  refreshStrongWeatherSource(state)
  if (WEATHER_SUPPRESSING_ABILITIES.has(pokemon.ability)) {
    refreshEnvironmentDependentAbilities(state, 'weather')
  }
  pushTimelineStep(timeline, state, {
    phase: 'faint',
    ...(actionOrder == null ? {} : { actionOrder }),
    sideId: sideId === 'player' ? 'opponent' : 'player',
    targetSideId: sideId,
    targetSlot: activeSlot,
    actorName: pokemon.name,
    actorSpeciesId: pokemon.speciesId,
    actorOriginalSpeciesId: pokemon.originalSpeciesId,
    message: `${pokemon.name}은(는) 쓰러졌다!`,
  })
  return true
}

function markActiveFaints(state, timeline = null, actionOrder = null) {
  let markedFaint = false
  ;['player', 'opponent'].forEach((sideId) => {
    getActivePokemonList(state, sideId).forEach((_, activeSlot) => {
      if (markPokemonFaint(state, sideId, activeSlot, timeline, actionOrder)) markedFaint = true
    })
  })
  return markedFaint
}

function settleFaints(state, timeline = null) {
  markActiveFaints(state, timeline)

  const playerRemaining = remainingCount(state.player)
  const opponentRemaining = remainingCount(state.opponent)

  if (playerRemaining === 0 || opponentRemaining === 0) {
    state.winner = playerRemaining > 0 ? 'player' : 'opponent'
    state.phase = 'complete'
    appendLog(
      state,
      state.winner === 'player' ? `${state.opponent.name}과의 승부에서 이겼다!` : `${state.opponent.name}에게 패배했다…`,
      state.winner === 'player' ? 'victory' : 'defeat',
    )
    pushTimelineStep(timeline, state, {
      phase: 'result',
      sideId: state.winner,
      message: latestLogMessage(state, '배틀이 끝났다!'),
    })
    return
  }

  const opponentFaintedSlots = getActivePokemonList(state, 'opponent')
    .map((pokemon, slot) => (pokemon.fainted ? slot : -1))
    .filter((slot) => slot >= 0)
  opponentFaintedSlots.forEach((slot) => {
    const nextIndex = chooseAiReplacementIndex(state, 'opponent', slot)
    if (nextIndex != null) performSwitch(state, 'opponent', nextIndex, true, timeline, null, slot)
  })

  const playerFaintedSlots = getActivePokemonList(state, 'player')
    .map((pokemon, slot) => (pokemon.fainted ? slot : -1))
    .filter((slot) => slot >= 0)
    .slice(0, availableBenchIndexes(state.player).length)
  state.awaitingPlayerSwitchSlots = playerFaintedSlots
  state.awaitingPlayerSwitch = playerFaintedSlots.length > 0
  if (state.awaitingPlayerSwitch) {
    appendLog(state, '다음 포켓몬을 선택해 주세요.', 'prompt')
    pushTimelineStep(timeline, state, {
      phase: 'prompt',
      sideId: 'player',
      targetSideId: 'player',
      message: '다음 포켓몬을 선택해 주세요.',
    })
  }
}

function actionPriority(state, sideId, action) {
  if (action.type === 'switch') return 10
  if (action.forcedReason === 'recharge') return 0
  const pokemon = getActivePokemon(state, sideId, action.actorSlot)
  const defender = getActivePokemon(
    state,
    sideId === 'player' ? 'opponent' : 'player',
    action.targetSlot,
  )
  const move = pokemon.moves[action.moveIndex]
  const resolvedGimmick = resolveAvailableActionGimmick(state, sideId, action.actorSlot, action.gimmick)
  const environmentMove = defender ? resolveEnvironmentMove(state, pokemon, defender, move) : move
  const zMove = resolvedGimmick === 'zmove' ? resolveBattleZMove(pokemon, environmentMove, move) : null
  const resolvedMove = zMove ?? resolveBattleMaxMove(pokemon, environmentMove, resolvedGimmick === 'dynamax', move)
  return environmentMovePriority(state, pokemon, resolvedMove)
}

function orderedActions(state, playerActions, opponentActions, random) {
  const createOrderedAction = (sideId, action) => {
    const pokemon = getActivePokemon(state, sideId, action.actorSlot)
    const quickDrawActivated = action.type === 'move'
      && pokemon?.ability === '퀵드로'
      && random() < 0.3
    return {
      sideId,
      action: quickDrawActivated ? { ...action, quickDrawActivated: true } : action,
      actorBattleId: pokemon?.battleId,
      quickDrawActivated,
      tieBreaker: random(),
    }
  }
  const actionOrderModifier = ({ sideId, action, quickDrawActivated }) => {
    if (action.type !== 'move') return 0
    const pokemon = getActivePokemon(state, sideId, action.actorSlot)
    if (quickDrawActivated || pokemon?.custapActive) return 1
    if (pokemon?.ability === '시간벌기') return -1
    return 0
  }
  return [
    ...playerActions.map((action) => createOrderedAction('player', action)),
    ...opponentActions.map((action) => createOrderedAction('opponent', action)),
  ].sort((first, second) => {
    const priorityDifference = actionPriority(state, second.sideId, second.action)
      - actionPriority(state, first.sideId, first.action)
    if (priorityDifference) return priorityDifference
    const orderModifierDifference = actionOrderModifier(second) - actionOrderModifier(first)
    if (orderModifierDifference) return orderModifierDifference
    const firstSpeed = effectiveStat(state, getActivePokemon(state, first.sideId, first.action.actorSlot), 'speed')
    const secondSpeed = effectiveStat(state, getActivePokemon(state, second.sideId, second.action.actorSlot), 'speed')
    return secondSpeed - firstSpeed || first.tieBreaker - second.tieBreaker
  })
}

const AI_TIER_NOISE = {
  S: 0,
  A: 0.25,
  B: 0.55,
  C: 0.9,
  D: 1.35,
}

const AI_STAGE_WEIGHTS = {
  attack: 28,
  defense: 20,
  specialAttack: 28,
  specialDefense: 20,
  speed: 30,
  accuracy: 14,
  evasion: 16,
}

const AI_NON_TARGETED_MOVE_TARGETS = new Set(['self', 'allySide', 'allyTeam', 'foeSide', 'all'])

function projectAiPokemonForMechanic(attacker, gimmick) {
  if (gimmick === 'tera' && attacker.teraType) {
    return {
      ...attacker,
      types: [attacker.teraType],
      teraActive: true,
    }
  }

  if (!['mega', 'primal'].includes(gimmick)) return attacker
  const formOptions = getBattleFormOptions(attacker.originalSpeciesId)
  const form = getSpeciesProfile(attacker.gimmickFormId)
    ?? formOptions.find((option) => (
      gimmick === 'primal' ? option.slug.includes('-primal') : option.slug.includes('-mega')
    ))
  if (!form) return attacker
  const transformed = normalizePokemon({
    ...attacker,
    speciesId: form.id,
    ability: form.abilities[0],
    moves: attacker.moves.map((move) => move.name),
  })

  return {
    ...attacker,
    speciesId: form.id,
    types: [...form.types],
    ability: form.abilities[0],
    stats: statObject(transformed),
  }
}

function resolveAiMove(state, attacker, defender, move, gimmick) {
  const projectedAttacker = projectAiPokemonForMechanic(attacker, gimmick)
  const environmentMove = resolveEnvironmentMove(state, projectedAttacker, defender, move)
  const zMove = gimmick === 'zmove'
    ? resolveBattleZMove(projectedAttacker, environmentMove, move)
    : null
  if (gimmick === 'zmove' && !zMove) return null

  return {
    attacker: projectedAttacker,
    move: zMove ?? resolveBattleMaxMove(
      projectedAttacker,
      environmentMove,
      gimmick === 'dynamax',
      move,
    ),
  }
}

function aiMoveAccuracy(state, attacker, defender, move) {
  if (move.accuracyLabel === '필중' || move.accuracy == null) return 1
  if (attacker.ability === '노가드' || defender.ability === '노가드') return 1
  const weatherId = effectiveMoveWeatherFamilyId(state, attacker)
  if (weatherId === 'rain' && ['thunder', 'hurricane'].includes(move.id)) return 1
  if (weatherId === 'snow' && move.id === 'blizzard') return 1

  const defenderEvasionStage = attacker.ability === '날카로운눈'
    ? 0
    : defender.statStages.evasion ?? 0
  const stageModifier = accuracyStageMultiplier(attacker.statStages.accuracy ?? 0)
    / accuracyStageMultiplier(defenderEvasionStage)
  const hustleModifier = attacker.ability === '의욕' && move.categoryId === 'physical' ? 0.8 : 1
  let weatherModifier = weatherId === 'fog' ? 0.6 : 1
  if (weatherId === 'sun' && ['thunder', 'hurricane'].includes(move.id)) weatherModifier *= 0.5
  if (weatherId === 'sandstorm' && defender.ability === '모래숨기') weatherModifier *= 0.8
  if (weatherId === 'snow' && defender.ability === '눈숨기') weatherModifier *= 0.8
  const abilityModifier = moveAccuracyAbilityMultiplier(state, attacker, defender, move)
  const accuracy = Math.max(0, Math.min(
    1,
    (Number(move.accuracy) || 100) * stageModifier * hustleModifier * weatherModifier * abilityModifier / 100,
  ))
  return !move.ignoreAbility && defender.ability === '미라클스킨' && isStatusMove(move)
    ? Math.min(0.5, accuracy)
    : accuracy
}

function aiExpectedHitCount(attacker, move) {
  if (parentalBondApplies(attacker, move)) return 1.25
  if (!move.multihit) return 1
  if (typeof move.multihit === 'number') return move.multihit
  const [minimum, maximum] = move.multihit
  if (attacker.ability === '스킬링크') return maximum
  if (minimum === 2 && maximum === 5) return 3
  return (minimum + maximum) / 2
}

function aiKnownSurvivalDamage(defender, move, damage) {
  if (damage < defender.hp || defender.hp !== defender.maxHp) return damage
  if (defender.ability === '옹골참') return move.ohko ? 0 : Math.max(0, defender.hp - 1)
  if (hasActiveHeldItem(defender, 'focus-sash')) {
    return Math.max(0, defender.hp - 1)
  }
  return damage
}

function estimateAiDamage(state, attacker, defender, move, targetHp = defender.hp) {
  if (WEIGHT_BASED_MOVE_IDS.has(move.id) && defender.dynamaxActive) {
    return { rawDamage: 0, expectedDamage: 0, effectiveness: 0, accuracy: 1 }
  }
  const strongWeatherId = effectiveWeatherId(state)
  if (
    !isStatusMove(move)
    && (strongWeatherId === 'desolateland' && move.type === '물'
      || strongWeatherId === 'primordialsea' && move.type === '불꽃')
  ) {
    return { rawDamage: 0, expectedDamage: 0, effectiveness: 0, accuracy: 1 }
  }
  const standardEffectiveness = getMoveTypeEffectiveness(state, attacker, defender, move)
  const effectiveness = !move.ignoreAbility
    && defender.ability === '테라셸'
    && defender.hp === defender.maxHp
    && standardEffectiveness > 0
    ? 0.5
    : standardEffectiveness
  const immunity = move.ignoreAbility ? null : abilityImmunity(state, attacker, defender, move)
  const accuracy = aiMoveAccuracy(state, attacker, defender, move)
  const semiInvulnerable = semiInvulnerableInteraction(defender, move)
  if (effectiveness === 0 || immunity || semiInvulnerable.avoided || accuracy <= 0) {
    return { rawDamage: 0, expectedDamage: 0, effectiveness: 0, accuracy }
  }

  let rawDamage
  if (move.currentHpFraction) {
    const [numerator, denominator] = move.currentHpFraction
    rawDamage = Math.max(1, Math.floor(targetHp * numerator / denominator))
  } else if (move.id === 'finalgambit') {
    rawDamage = attacker.hp
  } else if (move.ohko) {
    rawDamage = targetHp
  } else if (move.damage !== undefined) {
    rawDamage = move.damage === 'level' ? 50 : Number(move.damage)
  } else {
    const { category, attackPokemon, attackKey, defenseKey } = moveDamageStatProfile(
      state,
      attacker,
      defender,
      move,
    )
    let attack = effectiveStat(state, attackPokemon, attackKey, {
      ignoreStages: !move.ignoreAbility && defender.ability === '천진' && attackPokemon !== defender,
    })
    let defense = effectiveStat(state, defender, defenseKey, {
      ignoreStages: !move.ignoreAbility && attacker.ability === '천진',
    })

    if (category === 'physical' && attacker.status?.id === 'burn' && attacker.ability !== '근성') attack *= 0.5
    if (attacker.ability === '의욕' && attackPokemon === attacker && attackKey === 'attack') attack *= 1.5
    if (attacker.ability === '근성' && attacker.status && attackPokemon === attacker && attackKey === 'attack') attack *= 1.5
    if (effectiveWeatherFamilyId(state) === 'snow' && defenseKey === 'defense' && defender.types.includes('얼음')) defense *= 1.5
    if (effectiveWeatherFamilyId(state) === 'sandstorm' && defenseKey === 'specialDefense' && defender.types.includes('바위')) defense *= 1.5

    const baseDamage = (((2 * 50) / 5 + 2) * Math.max(1, Number(move.power) || 1) * attack / defense) / 50 + 2
    const criticalRates = [1 / 24, 1 / 8, 1 / 2, 1]
    const criticalStage = Math.max(0, Math.min(
      3,
      Number(move.critRatio ?? 0) + (attacker.ability === '대운' ? 1 : 0) + (attacker.criticalStageBoost ?? 0),
    ))
    const criticalAllowed = move.ignoreAbility || !CRITICAL_HIT_IMMUNITY_ABILITIES.has(defender.ability)
    const mercilessCritical = attacker.ability === '무도한행동'
      && ['poison', 'toxic'].includes(defender.status?.id)
    const criticalChance = criticalAllowed
      ? (move.willCrit || mercilessCritical ? 1 : criticalRates[criticalStage])
      : 0
    const expectedCriticalMultiplier = 1 + criticalChance * (attacker.ability === '스나이퍼' ? 1.25 : 0.5)
    let modifier = getMoveStab(attacker, move.type)
      * effectiveness
      * environmentMoveMultiplier(state, attacker, defender, move)
      * 0.925
      * expectedCriticalMultiplier
      * semiInvulnerable.powerMultiplier

    if (hasActiveHeldItem(attacker, 'life-orb')) modifier *= 1.3
    if (hasActiveHeldItem(attacker, 'expert-belt') && effectiveness > 1) modifier *= 1.2
    if (attacker.ability === '우격다짐' && hasSheerForceEffect(move)) modifier *= 1.3
    modifier *= movePowerAbilityMultiplier(state, attacker, defender, move, effectiveness)
    modifier *= lowHpMoveAbilityMultiplier(attacker, move)
    modifier *= supremeOverlordMultiplier(state, attacker)
    if (!move.ignoreAbility) {
      if (defender.ability === '멀티스케일' && defender.hp === defender.maxHp) modifier *= 0.5
      if (defender.ability === '두꺼운지방' && ['불꽃', '얼음'].includes(move.type)) modifier *= 0.5
      if (defender.ability === '건조피부' && move.type === '불꽃') modifier *= 1.25
    }
    modifier *= defenderAbilityDamageMultiplier(state, attacker, defender, move, effectiveness)

    const defenderSide = getPokemonSide(state, defender)
    if (defenderSide.auroraVeilTurns > 0 && attacker.ability !== '틈새포착') {
      modifier *= state.rules?.format?.activeSlots > 1 ? 2 / 3 : 0.5
    }
    rawDamage = Math.max(1, Math.floor(baseDamage * modifier * aiExpectedHitCount(attacker, move)))
  }

  rawDamage = aiKnownSurvivalDamage(defender, move, Math.max(0, Number(rawDamage) || 0))
  return {
    rawDamage,
    expectedDamage: rawDamage * accuracy,
    effectiveness,
    accuracy,
  }
}

function aiCanApplyStatus(state, target, statusId, source = null) {
  if (!STATUS_LABELS[statusId] || target.status || target.fainted || target.hp <= 0) return false
  if (target.ability === '정화의소금') return false
  if (target.ability === '리프가드' && effectiveWeatherFamilyId(state) === 'sun') return false
  if (['poison', 'toxic'].includes(statusId) && activeAllyHasAbility(state, target, PASTEL_VEIL_ABILITIES)) {
    return false
  }
  if (
    target.types.includes('풀')
    && activeAllyHasAbility(state, target, new Set(['플라워베일']))
  ) return false
  if (statusId === 'burn' && (target.types.includes('불꽃') || ['수의베일', '수포', '열교환'].includes(target.ability))) return false
  if (
    ['poison', 'toxic'].includes(statusId)
    && target.types.some((type) => ['독', '강철'].includes(type))
    && source?.ability !== '부식'
  ) return false
  if (['poison', 'toxic'].includes(statusId) && target.ability === '면역') return false
  if (statusId === 'paralysis' && (target.types.includes('전기') || target.ability === '유연')) return false
  if (statusId === 'freeze' && (target.types.includes('얼음') || target.ability === '마그마의무장')) return false
  if (statusId === 'freeze' && effectiveWeatherFamilyId(state) === 'sun') return false
  if (
    target.ability === '리밋실드'
    && (currentSpeciesSlug(target) === 'minior' || currentSpeciesSlug(target).includes('meteor'))
  ) return false
  if (statusId === 'sleep' && SLEEP_IMMUNE_ABILITIES.has(target.ability)) return false
  if (statusId === 'sleep' && activeAllyHasAbility(state, target, new Set(['스위트베일']))) return false
  if (isGrounded(target, state) && state.rules?.terrain?.id === 'misty') return false
  if (isGrounded(target, state) && state.rules?.terrain?.id === 'electric' && statusId === 'sleep') return false
  return true
}

function aiStageUtility(pokemon, changes, favorsIncrease) {
  return Object.entries(normalizedStageChanges(changes)).reduce((total, [statKey, amount]) => {
    const favorableAmount = favorsIncrease ? amount : -amount
    if (favorableAmount <= 0) return total
    const currentStage = pokemon.statStages[statKey] ?? 0
    const availableStages = favorsIncrease ? 6 - currentStage : currentStage + 6
    return total + Math.min(favorableAmount, availableStages) * (AI_STAGE_WEIGHTS[statKey] ?? 14)
  }, 0)
}

function aiEnvironmentUtility(state, attacker, kind, environmentId) {
  const turnsKey = kind === 'weather' ? 'weatherTurns' : 'terrainTurns'
  const sameEnvironmentHasTime = state.rules?.[kind]?.id === environmentId
    && (state.environment?.[turnsKey] ?? 5) > 1
  if (sameEnvironmentHasTime) return 6

  const side = getPokemonSide(state, attacker)
  const livingTeam = side.team.filter((pokemon) => pokemon.hp > 0 && !pokemon.fainted)
  const affinity = kind === 'weather'
    ? {
        sun: ['불꽃', '엽록소', '선파워', '진홍빛고동'],
        rain: ['물', '쓱쓱', '급류'],
        sandstorm: ['바위', '땅', '강철', '모래헤치기', '모래의힘'],
        snow: ['얼음', '눈치우기'],
      }[environmentId] ?? []
    : {
        electric: ['전기', '서핑테일', '하드론엔진'],
        grassy: ['풀', '풀모피'],
        psychic: ['에스퍼'],
        misty: ['페어리'],
      }[environmentId] ?? []
  const synergyCount = livingTeam.filter((pokemon) => (
    pokemon.types.some((type) => affinity.includes(type)) || affinity.includes(pokemon.ability)
  )).length
  return 58 + synergyCount * 7
}

function aiStatusMoveScore(state, attacker, defender, move) {
  const hpRatio = attacker.hp / Math.max(1, attacker.maxHp)
  const missingHpRatio = 1 - hpRatio
  const accuracy = aiMoveAccuracy(state, attacker, defender, move)
  if (attacker.healBlockTurns > 0 && isHealingMove(move)) return -Infinity
  const weatherId = SHOWDOWN_WEATHER_IDS[String(move.weather ?? move.id).toLowerCase()]
  const terrainId = SHOWDOWN_TERRAIN_IDS[String(move.terrain ?? move.id).toLowerCase()]
  if (weatherId) return aiEnvironmentUtility(state, attacker, 'weather', weatherId)
  if (terrainId) return aiEnvironmentUtility(state, attacker, 'terrain', terrainId)

  if (PROTECT_MOVE_IDS.has(move.id)) {
    const chainPenalty = Math.max(1, 3 ** (attacker.protectChain ?? 0))
    const residualPressure = attacker.status || attacker.perishCount != null || defender.dynamaxActive ? 22 : 0
    const contactMoves = defender.moves.filter((candidate) => (
      candidate.currentPp > 0 && !isStatusMove(candidate) && candidate.flags?.includes('contact')
    ))
    const contactRatio = contactMoves.length / Math.max(1, defender.moves.filter((candidate) => (
      candidate.currentPp > 0 && !isStatusMove(candidate)
    )).length)
    const contactEffect = PROTECT_CONTACT_EFFECTS[move.id]
    let contactUtility = 0
    if (contactEffect?.damageFraction) contactUtility += 24 * contactRatio
    if (contactEffect?.stages?.attack && effectiveStat(state, defender, 'attack') >= effectiveStat(state, defender, 'specialAttack')) {
      contactUtility += Math.abs(contactEffect.stages.attack) * 18 * contactRatio
    }
    if (contactEffect?.stages?.defense) contactUtility += Math.abs(contactEffect.stages.defense) * 12 * contactRatio
    if (contactEffect?.stages?.speed) contactUtility += Math.abs(contactEffect.stages.speed) * 14 * contactRatio
    if (contactEffect?.status && aiCanApplyStatus(state, defender, contactEffect.status, attacker)) contactUtility += 28 * contactRatio
    return (34 + residualPressure + (hpRatio < 0.45 ? 28 : 0) + contactUtility) / chainPenalty
  }

  if (move.id === 'revivalblessing') {
    const side = getPokemonSide(state, attacker)
    const faintedTargets = side.team.filter((pokemon) => pokemon.fainted || pokemon.hp <= 0)
    if (faintedTargets.length === 0) return -Infinity
    const strongestTarget = faintedTargets.reduce((strongest, pokemon) => {
      const strength = Object.values(pokemon.stats).reduce((total, value) => total + Number(value || 0), 0)
      return Math.max(strongest, strength)
    }, 0)
    return 170 + Math.min(60, strongestTarget / 12)
  }

  if (move.id === 'rest') {
    if (attacker.status?.id === 'sleep') return -Infinity
    if (missingHpRatio < 0.18 && !attacker.status) return -Infinity
    const instantWake = matchingStatusCureBerry(state, attacker, 'sleep') ? 38 : 0
    const canActWhileAsleep = attacker.moves.some((candidate) => ['sleeptalk', 'snore'].includes(candidate.id))
    const sleepCost = instantWake > 0 ? 0 : canActWhileAsleep ? 12 : 48
    return 58 + missingHpRatio * 105 + (attacker.status ? 25 : 0) + instantWake - sleepCost
  }

  if (['healingwish', 'lunardance'].includes(move.id)) {
    const side = getPokemonSide(state, attacker)
    const hasRecoveryTarget = availableBenchIndexes(side).some((index) => {
      const pokemon = side.team[index]
      return pokemon.hp < pokemon.maxHp * 0.65 || pokemon.status
    })
    if (!hasRecoveryTarget) return -Infinity
    return hpRatio < 0.35 ? 118 : 32
  }

  if (move.heal || HEAL_MOVE_IDS.has(move.id) || move.flags?.includes('heal')) {
    if (missingHpRatio < 0.15) return -Infinity
    return 42 + missingHpRatio * 125
  }

  if (move.id === 'perishsong') {
    if (defender.perishCount != null) return 4
    const ownBench = availableBenchIndexes(getPokemonSide(state, attacker)).length
    const opposingBench = availableBenchIndexes(getPokemonSide(state, defender)).length
    return 48 + Math.max(0, ownBench - opposingBench) * 12
  }

  if (move.id === 'stealthrock') {
    const targetSide = getPokemonSide(state, defender)
    if (targetSide.hazards?.stealthRock) return 3
    return 48 + availableBenchIndexes(targetSide).length * 12
  }

  let utility = 0
  const statusId = SHOWDOWN_STATUS_IDS[move.status] ?? move.status
  if (statusId) {
    if (!aiCanApplyStatus(state, defender, statusId, attacker)) return -Infinity
    const cureMultiplier = matchingStatusCureBerry(state, defender, statusId) ? 0.2 : 1
    if (statusId === 'sleep') utility += 105 * cureMultiplier
    else if (statusId === 'toxic') utility += 82 * cureMultiplier
    else if (statusId === 'burn') {
      utility += (effectiveStat(state, defender, 'attack') >= effectiveStat(state, defender, 'specialAttack') ? 88 : 55) * cureMultiplier
    } else if (statusId === 'paralysis') {
      utility += (effectiveStat(state, defender, 'speed') > effectiveStat(state, attacker, 'speed') ? 82 : 58) * cureMultiplier
    } else utility += 56 * cureMultiplier
  }

  const target = move.target === 'self' ? attacker : defender
  if (move.volatileStatus === 'confusion' && target.confusionTurns <= 0 && target.ability !== '마이페이스') utility += 55
  if (move.volatileStatus === 'yawn' && !target.status && target.yawnTurns <= 0) utility += 82
  if (move.volatileStatus === 'destinybond' && hpRatio < 0.4) utility += 76
  if (move.volatileStatus === 'healblock') {
    if (target.healBlockTurns > 0) return -Infinity
    utility += 58
  }

  const scriptedEffect = STATUS_MOVE_EFFECTS[move.id]
  if (move.target === 'self') {
    utility += aiStageUtility(attacker, move.boosts ?? scriptedEffect?.self, true)
  } else {
    utility += aiStageUtility(defender, move.boosts ?? scriptedEffect?.target, false)
  }
  utility += aiStageUtility(attacker, move.self?.boosts, true)

  if (utility <= 0) utility = scriptedEffect ? 38 : 22
  if (move.target === 'self') utility *= hpRatio < 0.3 ? 0.55 : hpRatio > 0.7 ? 1.15 : 1
  return utility * accuracy
}

function aiSecondaryUtility(state, attacker, defender, move) {
  const effects = moveSecondaryEffects(move)
  if (attacker.ability === '우격다짐') return 0
  const targetEffectBlocked = defender.ability === '인분'
    || hasActiveHeldItem(defender, 'covert-cloak')
  const expectedHitCount = move.multihit ? aiExpectedHitCount(attacker, move) : 1
  return effects.reduce((total, effect) => {
    const chancePerHit = secondaryEffectChance(attacker, effect) / 100
    const chance = 1 - (1 - chancePerHit) ** expectedHitCount
    let utility = 0
    const statusId = SHOWDOWN_STATUS_IDS[effect.status] ?? effect.status
    if (!targetEffectBlocked && statusId && aiCanApplyStatus(state, defender, statusId, attacker)) {
      const cureMultiplier = matchingStatusCureBerry(state, defender, statusId) ? 0.2 : 1
      utility += (statusId === 'sleep' ? 52 : 30) * cureMultiplier
    }
    if (!targetEffectBlocked && effect.volatileStatus === 'flinch' && effectiveStat(state, attacker, 'speed') > effectiveStat(state, defender, 'speed')) utility += 34
    if (!targetEffectBlocked && effect.volatileStatus === 'confusion' && defender.confusionTurns <= 0) utility += 24
    if (!targetEffectBlocked && effect.volatileStatus === 'saltcure' && !defender.saltCureActive) utility += 52
    if (!targetEffectBlocked && effect.volatileStatus === 'syrupbomb' && defender.syrupBombTurns <= 0) utility += 34
    if (!targetEffectBlocked && effect.volatileStatus === 'healblock' && defender.healBlockTurns <= 0) utility += 38
    if (!targetEffectBlocked && effect.volatileStatus === 'sparklingaria' && defender.status?.id === 'burn') utility -= 24
    if (!targetEffectBlocked) utility += aiStageUtility(defender, effect.boosts, false) * 0.55
    utility += aiStageUtility(attacker, effect.self?.boosts, true) * 0.55
    return total + utility * chance
  }, 0)
}

function aiIncomingThreatRatio(state, pokemon, attackers) {
  const threatRatios = attackers
    .filter((attacker) => attacker && attacker.hp > 0 && !attacker.fainted)
    .map((attacker) => attacker.moves.reduce((highest, move) => {
      if (move.currentPp <= 0 || isStatusMove(move)) return highest
      const resolved = resolveAiMove(state, attacker, pokemon, move, null)
      if (!resolved) return highest
      const estimate = estimateAiDamage(state, resolved.attacker, pokemon, resolved.move)
      return Math.max(highest, estimate.expectedDamage / Math.max(1, pokemon.maxHp))
    }, 0))
    .sort((first, second) => second - first)
  if (threatRatios.length === 0) return 0
  return Math.min(2, threatRatios[0] + threatRatios.slice(1).reduce((total, ratio) => total + ratio * 0.4, 0))
}

function aiDefensiveTeraUtility(state, attacker, defender) {
  if (!attacker.teraType) return 0
  const damagingMoves = defender.moves.filter((move) => move.currentPp > 0 && !isStatusMove(move))
  const before = damagingMoves.reduce((highest, move) => (
    Math.max(highest, getBattleTypeEffectiveness(state, move.type, attacker.types))
  ), 0)
  const after = damagingMoves.reduce((highest, move) => (
    Math.max(highest, getBattleTypeEffectiveness(state, move.type, [attacker.teraType]))
  ), 0)
  return Math.max(-28, Math.min(42, (before - after) * 22))
}

function aiMechanicUtility(state, attacker, defender, move, gimmick, evaluation) {
  if (!gimmick) return 0
  const side = getPokemonSide(state, attacker)
  const opposingSide = getOtherSide(state, side.id)
  const urgency = (state.turn >= 3 ? 8 : 0)
    + (attacker.hp < attacker.maxHp * 0.55 ? 10 : 0)
    + (remainingCount(opposingSide) <= 2 ? 12 : 0)
  if (gimmick === 'mega' || gimmick === 'primal') return 48 + urgency
  if (gimmick === 'dynamax') return 24 + urgency + (attacker.hp < attacker.maxHp * 0.6 ? 14 : 0)
  if (gimmick === 'tera') {
    const offensiveUtility = move.type === attacker.teraType ? 18 : -14
    return offensiveUtility + aiDefensiveTeraUtility(state, attacker, defender) + urgency - 8
  }
  if (gimmick === 'zmove') return (evaluation.knockout ? 32 : -8) + urgency
  return 0
}

function evaluateAiMove(state, attacker, defender, move, gimmick = null, context = {}) {
  if (!move || move.currentPp <= 0) return { score: -Infinity, estimatedDamage: 0, rawDamage: 0 }
  if (attacker.disabledMoveTurns > 0 && attacker.moves[attacker.disabledMoveIndex] === move) {
    return { score: -Infinity, estimatedDamage: 0, rawDamage: 0 }
  }
  if (
    attacker.ability === '무아지경'
    && !attacker.dynamaxActive
    && attacker.gorillaLockedMoveIndex != null
    && attacker.moves[attacker.gorillaLockedMoveIndex] !== move
    && !['dynamax', 'zmove'].includes(gimmick)
  ) {
    return { score: -Infinity, estimatedDamage: 0, rawDamage: 0 }
  }
  if (attacker.ability === '게으름' && attacker.truantLoafing) {
    return { score: -Infinity, estimatedDamage: 0, rawDamage: 0 }
  }
  const resolved = resolveAiMove(state, attacker, defender, move, gimmick)
  if (!resolved) return { score: -Infinity, estimatedDamage: 0, rawDamage: 0 }
  const resolvedMove = resolved.move
  const projectedAttacker = resolved.attacker
  const targetHp = Math.max(1, Number(context.targetHp ?? defender.hp) || defender.hp)
  const priority = environmentMovePriority(state, projectedAttacker, resolvedMove)

  if (
    move.firstTurnOnly
    && (attacker.activeMoveActions ?? 0) > 0
    && resolvedMove.id === move.id
  ) {
    return { score: -Infinity, estimatedDamage: 0, rawDamage: 0, priority, resolvedMove }
  }
  if (attacker.healBlockTurns > 0 && isHealingMove(resolvedMove)) {
    return { score: -Infinity, estimatedDamage: 0, rawDamage: 0, priority, resolvedMove }
  }

  if (isStatusMove(resolvedMove)) {
    if (
      resolvedMove.target !== 'self'
      && (
        !resolvedMove.ignoreAbility && abilityImmunity(
          state,
          projectedAttacker,
          defender,
          resolvedMove,
        )
        ||
        projectedAttacker.ability === '짓궂은마음' && defender.types.includes('악')
        || !resolvedMove.ignoreAbility && defender.ability === '황금몸'
        || !resolvedMove.ignoreAbility
          && defender.ability === '매직미러'
          && resolvedMove.flags?.includes('reflectable')
      )
    ) {
      return { score: -Infinity, estimatedDamage: 0, rawDamage: 0, priority, resolvedMove }
    }
    const accuracy = aiMoveAccuracy(state, projectedAttacker, defender, resolvedMove)
    let score = aiStatusMoveScore(state, attacker, defender, resolvedMove)
    const evaluation = {
      score,
      estimatedDamage: 0,
      rawDamage: 0,
      effectiveness: 1,
      accuracy,
      knockout: false,
      priority,
      resolvedMove,
    }
    score += aiMechanicUtility(state, attacker, defender, resolvedMove, gimmick, evaluation)
    if (context.targetReserved && resolvedMove.target !== 'self') score -= 60
    return { ...evaluation, score }
  }

  if (resolvedMove.id === 'steelroller' && state.rules?.terrain?.id === 'neutral') {
    return { score: -Infinity, estimatedDamage: 0, rawDamage: 0 }
  }

  const estimate = estimateAiDamage(state, projectedAttacker, defender, resolvedMove, targetHp)
  if (estimate.effectiveness === 0 || estimate.rawDamage <= 0) {
    return { score: -Infinity, estimatedDamage: 0, rawDamage: 0, effectiveness: 0, priority }
  }

  const knockout = estimate.rawDamage >= targetHp
  const damageRatio = estimate.expectedDamage / Math.max(1, defender.maxHp)
  let score = Math.min(1.5, damageRatio) * 190
  if (knockout) score += 130 * estimate.accuracy
  if (knockout && priority > 0) score += 42
  if (estimate.effectiveness > 1) score += 12
  if (context.targetReserved) score -= 105

  const attackerIsSlower = effectiveStat(state, projectedAttacker, 'speed') < effectiveStat(state, defender, 'speed')
  const incomingThreat = aiIncomingThreatRatio(state, projectedAttacker, [defender])
  if (attackerIsSlower && priority <= 0 && incomingThreat * projectedAttacker.maxHp >= projectedAttacker.hp) {
    score *= knockout ? 0.82 : 0.62
  }

  const skipsCharge = effectiveMoveWeatherFamilyId(state, projectedAttacker) === 'sun'
      && ['solarbeam', 'solarblade'].includes(resolvedMove.id)
    || effectiveMoveWeatherFamilyId(state, projectedAttacker) === 'rain' && resolvedMove.id === 'electroshot'
  if (resolvedMove.flags?.includes('charge') && !hasActiveHeldItem(attacker, 'power-herb') && !skipsCharge && !resolvedMove.isZMove && !resolvedMove.isMaxMove) {
    score *= 0.68
  }
  if (resolvedMove.flags?.includes('recharge') && !resolvedMove.isZMove && !resolvedMove.isMaxMove) score -= 24

  if (resolvedMove.drain && estimate.expectedDamage > 0) {
    const [numerator, denominator] = resolvedMove.drain
    const missingHp = Math.max(0, projectedAttacker.maxHp - projectedAttacker.hp)
    score += Math.min(missingHp, estimate.expectedDamage * numerator / denominator) / projectedAttacker.maxHp * 65
  }
  if (resolvedMove.recoil && estimate.expectedDamage > 0) {
    const [numerator, denominator] = resolvedMove.recoil
    const recoil = estimate.expectedDamage * numerator / denominator
    score -= recoil / projectedAttacker.maxHp * 72
    if (recoil >= projectedAttacker.hp && !knockout) score -= 95
  }
  if (resolvedMove.selfdestruct) {
    const attackerSide = getPokemonSide(state, attacker)
    const defenderSide = getOtherSide(state, attackerSide.id)
    const lastPokemon = remainingCount(attackerSide) <= 1
    if (!knockout) score -= 180
    if (lastPokemon && remainingCount(defenderSide) > 1) score -= 240
    if (knockout && projectedAttacker.hp < projectedAttacker.maxHp * 0.3) score += 25
  }
  const attackerSide = getPokemonSide(state, attacker)
  const defenderSide = getOtherSide(state, attackerSide.id)
  if (resolvedMove.selfSwitch && availableBenchIndexes(attackerSide).length > 0) score += 16
  if (resolvedMove.forceSwitch && availableBenchIndexes(defenderSide).length > 0) score += 12
  score += aiSecondaryUtility(state, projectedAttacker, defender, resolvedMove)

  const evaluation = {
    score,
    estimatedDamage: Math.min(targetHp, estimate.expectedDamage),
    rawDamage: estimate.rawDamage,
    effectiveness: estimate.effectiveness,
    accuracy: estimate.accuracy,
    knockout,
    priority,
    resolvedMove,
  }
  score += aiMechanicUtility(state, attacker, defender, resolvedMove, gimmick, evaluation)
  return { ...evaluation, score }
}

function aiHazardDamageRatio(state, side, pokemon) {
  if (pokemon.ability === '매직가드') return 0
  let ratio = 0
  if (side.hazards?.stealthRock) ratio += getBattleTypeEffectiveness(state, '바위', pokemon.types) / 8
  if (side.hazards?.steelsurge) ratio += getBattleTypeEffectiveness(state, '강철', pokemon.types) / 8
  return ratio
}

function aiEntryAbilityUtility(pokemon) {
  if (pokemon.ability === '위협') return 24
  if (ENTRY_WEATHER_ABILITIES[pokemon.ability] || ENTRY_TERRAIN_ABILITIES[pokemon.ability]) return 18
  return 0
}

function aiPositiveStageTotal(pokemon) {
  return Object.values(pokemon.statStages).reduce((total, stage) => total + Math.max(0, stage), 0)
}

const AI_ROLE_KEYWORDS = ['에이스', '스위퍼', '피니셔', '승리', '전개', '날씨', '필드', '트릭룸']
const AI_LEAD_ROLE_KEYWORDS = ['선봉', '전개', '교대', '필드', '날씨', '벽']
const AI_LEAD_MOVE_IDS = new Set([
  'fakeout',
  'uturn',
  'voltswitch',
  'flipturn',
  'partingshot',
  'sunnyday',
  'raindance',
  'sandstorm',
  'snowscape',
  'electricterrain',
  'grassyterrain',
  'psychicterrain',
  'mistyterrain',
])
const AI_MAX_PLAN_COUNT = 128
const AI_MAX_RESPONSE_PLAN_COUNT = 12
const AI_RESPONSE_TEMPERATURE = 18
const AI_SIMULATION_RANDOM = () => 0.5
const AI_CONTINUATION_WEIGHT = 0.38
const AI_CONTINUATION_RESPONSE_COUNT = AI_MAX_RESPONSE_PLAN_COUNT
const AI_MAX_SWITCH_CANDIDATES = 3

function aiRoleUtility(state, pokemon, sideId) {
  const role = String(pokemon.role ?? '')
  const roleScore = AI_ROLE_KEYWORDS.reduce((total, keyword) => (
    total + (role.includes(keyword) ? 8 : 0)
  ), 0)
  const winConditions = sideId === 'opponent' ? state.opponentStrategy?.winConditions ?? [] : []
  const winConditionScore = winConditions.some((condition) => String(condition).includes(pokemon.name)) ? 20 : 0
  const side = getSide(state, sideId)
  const unusedMechanicScore = inferConfiguredMechanics(pokemon).some((mechanicId) => !side.usedMechanics[mechanicId])
    ? 16
    : 0
  return roleScore + winConditionScore + unusedMechanicScore
}

function aiStatusPenalty(pokemon) {
  if (!pokemon.status) return 0
  if (pokemon.status.id === 'sleep' || pokemon.status.id === 'freeze') return 34
  if (pokemon.status.id === 'toxic') return 30
  if (pokemon.status.id === 'burn' || pokemon.status.id === 'paralysis') return 24
  return 18
}

function aiTypePressure(state, attacker, defender) {
  const damagingMoves = attacker.moves.filter((move) => move.currentPp > 0 && !isStatusMove(move))
  if (damagingMoves.length === 0) return -18
  const bestEffectiveness = damagingMoves.reduce((best, move) => {
    const immunity = move.ignoreAbility ? null : abilityImmunity(state, attacker, defender, move)
    if (immunity) return best
    return Math.max(best, getMoveTypeEffectiveness(state, attacker, defender, move))
  }, 0)
  if (bestEffectiveness <= 0) return -18
  return Math.max(-18, Math.min(24, Math.log2(bestEffectiveness) * 14 + 4))
}

function aiRosterMatchupUtility(state, pokemon, opposingTeam) {
  const opponents = opposingTeam.filter((opponent) => opponent.hp > 0 && !opponent.fainted)
  if (opponents.length === 0) return 0
  return opponents.reduce((total, opponent) => (
    total + aiTypePressure(state, pokemon, opponent) - aiTypePressure(state, opponent, pokemon) * 0.65
  ), 0) / opponents.length
}

function aiTeamCoverageScore(state, sideId) {
  const side = getSide(state, sideId)
  const opposingSide = getOtherSide(state, sideId)
  const livingTeam = side.team.filter((pokemon) => pokemon.hp > 0 && !pokemon.fainted)
  const livingOpponents = opposingSide.team.filter((pokemon) => pokemon.hp > 0 && !pokemon.fainted)
  if (livingTeam.length === 0 || livingOpponents.length === 0) return 0
  return livingOpponents.reduce((total, opponent) => {
    const bestCounterScore = livingTeam.reduce((best, pokemon) => (
      Math.max(best, aiTypePressure(state, pokemon, opponent) - aiTypePressure(state, opponent, pokemon) * 0.55)
    ), -36)
    return total + bestCounterScore
  }, 0) / livingOpponents.length
}

function aiEnvironmentAffinityScore(state, sideId) {
  const side = getSide(state, sideId)
  const livingTeam = side.team.filter((pokemon) => pokemon.hp > 0 && !pokemon.fainted)
  const weatherId = effectiveWeatherFamilyId(state)
  const terrainId = state.rules?.terrain?.id
  const weatherAffinity = {
    sun: ['불꽃', '엽록소', '선파워', '진홍빛고동'],
    rain: ['물', '쓱쓱', '급류', '젖은접시', '촉촉바디'],
    sandstorm: ['바위', '땅', '강철', '모래헤치기', '모래의힘'],
    snow: ['얼음', '눈치우기', '아이스바디'],
  }[weatherId] ?? []
  const terrainAffinity = {
    electric: ['전기', '서핑테일', '하드론엔진'],
    grassy: ['풀', '풀모피'],
    psychic: ['에스퍼'],
    misty: ['페어리'],
  }[terrainId] ?? []

  return livingTeam.reduce((total, pokemon) => {
    const weatherMatch = pokemon.types.some((type) => weatherAffinity.includes(type))
      || weatherAffinity.includes(pokemon.ability)
    const terrainMatch = pokemon.types.some((type) => terrainAffinity.includes(type))
      || terrainAffinity.includes(pokemon.ability)
    const matchingMoveCount = pokemon.moves.filter((move) => (
      weatherAffinity.includes(move.type) || terrainAffinity.includes(move.type)
    )).length
    return total + (weatherMatch ? 10 : 0) + (terrainMatch ? 10 : 0) + matchingMoveCount * 2
  }, 0)
}

function aiPokemonBoardValue(state, pokemon, sideId, active) {
  if (!pokemon || pokemon.fainted || pokemon.hp <= 0) return 0
  const hpRatio = pokemon.hp / Math.max(1, pokemon.maxHp)
  const statTotal = Object.values(pokemon.stats).reduce((total, value) => total + Number(value || 0), 0)
  const positiveStages = Object.values(pokemon.statStages).reduce((total, stage) => total + Math.max(0, stage), 0)
  const negativeStages = Object.values(pokemon.statStages).reduce((total, stage) => total + Math.min(0, stage), 0)
  const volatilePenalty = (pokemon.yawnTurns > 0 ? 16 : 0)
    + (pokemon.perishCount != null ? Math.max(12, 50 - pokemon.perishCount * 10) : 0)
    + (pokemon.rechargeTurns > 0 ? 18 : 0)
  return 118
    + hpRatio * 142
    + Math.min(72, statTotal / 11)
    + aiRoleUtility(state, pokemon, sideId)
    + (heldItemEffectsActive(pokemon) ? 8 : 0)
    + (active ? positiveStages * 11 + negativeStages * 9 : 0)
    + (pokemon.dynamaxActive ? 20 : 0)
    + (pokemon.teraActive || pokemon.megaActive || pokemon.primalActive ? 12 : 0)
    - aiStatusPenalty(pokemon)
    - volatilePenalty
}

function aiActiveTacticalValue(state, sideId) {
  const targetSideId = getOtherSide(state, sideId).id
  const targetSlots = aiLivingActiveSlots(state, targetSideId)
  if (targetSlots.length === 0) return 0

  return aiLivingActiveSlots(state, sideId).reduce((total, activeSlot) => {
    const attacker = getActivePokemon(state, sideId, activeSlot)
    if (!attacker) return total
    const bestMove = bestAiMoveForPokemon(state, attacker, targetSlots)
    const defenders = targetSlots.map((slot) => getActivePokemon(state, targetSideId, slot)).filter(Boolean)
    const incomingThreat = aiIncomingThreatRatio(state, attacker, defenders)
    const fastestDefender = defenders.reduce((fastest, defender) => (
      effectiveStat(state, defender, 'speed') > effectiveStat(state, fastest, 'speed') ? defender : fastest
    ), defenders[0])
    const speedAdvantage = fastestDefender
      && effectiveStat(state, attacker, 'speed') > effectiveStat(state, fastestDefender, 'speed')
      ? 10
      : 0
    const knockoutPressure = bestMove?.knockout ? 28 * (bestMove.accuracy ?? 1) : 0
    const offensivePressure = Number.isFinite(bestMove?.score)
      ? Math.max(-12, Math.min(42, bestMove.score * 0.16))
      : -24
    const survivalPressure = Math.max(-72, Math.min(18, (0.55 - incomingThreat) * 58))
    return total + offensivePressure + knockoutPressure + speedAdvantage + survivalPressure
  }, 0)
}

function aiSideBoardValue(state, sideId) {
  const side = getSide(state, sideId)
  const activeIndexes = new Set(side.activeIndexes ?? [side.activeIndex])
  const livingCount = remainingCount(side)
  if (livingCount <= 0) return -2400
  const pokemonValue = side.team.reduce((total, pokemon, index) => (
    total + aiPokemonBoardValue(state, pokemon, sideId, activeIndexes.has(index))
  ), 0)
  const hazardPenalty = side.team.reduce((total, pokemon, index) => {
    if (activeIndexes.has(index) || pokemon.fainted || pokemon.hp <= 0) return total
    return total + aiHazardDamageRatio(state, side, pokemon) * 86
  }, 0)
  const activePressure = getActivePokemonList(state, sideId).reduce((total, pokemon) => {
    if (!pokemon || pokemon.fainted || pokemon.hp <= 0) return total
    return total + (pokemon.protected ? 5 : 0) + (pokemon.destinyBondActive ? 8 : 0)
  }, 0)
  return pokemonValue
    + aiEnvironmentAffinityScore(state, sideId)
    + aiTeamCoverageScore(state, sideId)
    + aiActiveTacticalValue(state, sideId)
    + (side.auroraVeilTurns > 0 ? 24 : 0)
    + activePressure
    - hazardPenalty
}

function aiBoardAdvantage(state, sideId = 'opponent') {
  const opposingSideId = getOtherSide(state, sideId).id
  return aiSideBoardValue(state, sideId) - aiSideBoardValue(state, opposingSideId)
}

function aiLivingActiveSlots(state, sideId) {
  return getActivePokemonList(state, sideId)
    .map((pokemon, slot) => (isAvailableFieldPokemon(pokemon) ? slot : -1))
    .filter((slot) => slot >= 0)
}

function aiTargetSlotsForSide(state, sideId, fallbackTargetSlot = 0) {
  const targetSideId = getOtherSide(state, sideId).id
  const slots = aiLivingActiveSlots(state, targetSideId)
  return slots.length > 0 ? slots : [fallbackTargetSlot]
}

function bestAiMoveForPokemon(state, attacker, targetSlots) {
  const attackerSide = getPokemonSide(state, attacker)
  const targetSideId = getOtherSide(state, attackerSide.id).id
  let best = null
  attacker.moves.forEach((move, moveIndex) => {
    const moveTargetSlots = AI_NON_TARGETED_MOVE_TARGETS.has(move.target) ? targetSlots.slice(0, 1) : targetSlots
    moveTargetSlots.forEach((targetSlot) => {
      const defender = getActivePokemon(state, targetSideId, targetSlot)
      if (!defender || defender.hp <= 0 || defender.fainted) return
      const evaluation = evaluateAiMove(state, attacker, defender, move)
      if (!best || evaluation.score > best.score) best = { ...evaluation, moveIndex, targetSlot }
    })
  })
  return best
}

function aiLeadUtility(pokemon, preferredLeadName = '') {
  const role = String(pokemon.role ?? '')
  const roleUtility = AI_LEAD_ROLE_KEYWORDS.reduce((total, keyword) => (
    total + (role.includes(keyword) ? 11 : 0)
  ), 0)
  const moveUtility = pokemon.moves.reduce((total, move) => (
    total + (AI_LEAD_MOVE_IDS.has(move.id) || move.selfSwitch ? 8 : 0)
  ), 0)
  const itemUtility = heldItemEffectsActive(pokemon)
    && ['focus-sash', 'mental-herb', 'light-clay'].includes(pokemon.heldItemId)
    ? 10
    : 0
  return roleUtility + moveUtility + itemUtility + (pokemon.name === preferredLeadName ? 18 : 0)
}

function aiLeadCandidateScore(state, sideId, pokemon, targetSlots, preferredLeadName) {
  const opposingSide = getOtherSide(state, sideId)
  const opposingAttackers = targetSlots.map((slot) => getActivePokemon(state, opposingSide.id, slot)).filter(Boolean)
  const offense = bestAiMoveForPokemon(state, pokemon, targetSlots)
  const incomingThreat = aiIncomingThreatRatio(state, pokemon, opposingAttackers)
  const speedEdges = opposingAttackers.filter((opponent) => (
    effectiveStat(state, pokemon, 'speed') > effectiveStat(state, opponent, 'speed')
  )).length
  return Math.max(0, offense?.score ?? 0) * 0.5
    - incomingThreat * 82
    + speedEdges * 10
    + aiEntryAbilityUtility(pokemon)
    + aiLeadUtility(pokemon, preferredLeadName)
    + aiRosterMatchupUtility(state, pokemon, opposingSide.team)
}

function chooseAiLeadIndexes(state, sideId, count, preferredLeadName = '') {
  const side = getSide(state, sideId)
  const targetSlots = aiLivingActiveSlots(state, getOtherSide(state, sideId).id)
  const selected = []
  const candidateIndexes = side.team.map((pokemon, index) => (
    pokemon.hp > 0 && !pokemon.fainted ? index : -1
  )).filter((index) => index >= 0)

  while (selected.length < Math.min(count, candidateIndexes.length)) {
    const next = candidateIndexes
      .filter((index) => !selected.includes(index))
      .map((index) => {
        const pokemon = side.team[index]
        const overlapPenalty = selected.reduce((penalty, selectedIndex) => {
          const selectedPokemon = side.team[selectedIndex]
          return penalty + pokemon.types.filter((type) => selectedPokemon.types.includes(type)).length * 8
        }, 0)
        return {
          index,
          score: aiLeadCandidateScore(state, sideId, pokemon, targetSlots, preferredLeadName) - overlapPenalty,
        }
      })
      .sort((first, second) => second.score - first.score || first.index - second.index)[0]
    if (!next) break
    selected.push(next.index)
  }
  return selected
}

function aiReplacementCandidates(state, sideId, activeSlot = 0) {
  const side = getSide(state, sideId)
  const opposingSide = getOtherSide(state, sideId)
  const targetSlots = aiLivingActiveSlots(state, opposingSide.id)
  const opposingAttackers = targetSlots.map((slot) => getActivePokemon(state, opposingSide.id, slot)).filter(Boolean)

  return availableBenchIndexes(side)
    .map((targetIndex) => {
      const pokemon = side.team[targetIndex]
      const hazardRatio = aiHazardDamageRatio(state, side, pokemon)
      if (hazardRatio * pokemon.maxHp >= pokemon.hp) return { targetIndex, score: -Infinity }
      const offense = bestAiMoveForPokemon(state, pokemon, targetSlots)
      const incomingThreat = aiIncomingThreatRatio(state, pokemon, opposingAttackers)
      const remainingHpRatio = Math.max(0, pokemon.hp / Math.max(1, pokemon.maxHp) - hazardRatio)
      const speedEdges = opposingAttackers.filter((opponent) => (
        effectiveStat(state, pokemon, 'speed') > effectiveStat(state, opponent, 'speed')
      )).length
      const partnerTypePenalty = (side.activeIndexes ?? [])
        .filter((_, slot) => slot !== activeSlot)
        .map((index) => side.team[index])
        .filter((partner) => partner && partner.hp > 0 && !partner.fainted)
        .reduce((penalty, partner) => (
          penalty + pokemon.types.filter((type) => partner.types.includes(type)).length * 6
        ), 0)
      return {
        targetIndex,
        score: Math.max(0, offense?.score ?? 0) * 0.56
          + remainingHpRatio * 78
          - incomingThreat * 102
          + speedEdges * 9
          + aiEntryAbilityUtility(pokemon)
          + aiRoleUtility(state, pokemon, sideId) * 0.4
          + aiRosterMatchupUtility(state, pokemon, opposingSide.team)
          - partnerTypePenalty,
      }
    })
    .sort((first, second) => second.score - first.score || first.targetIndex - second.targetIndex)
}

export function chooseAiReplacementIndex(state, sideId = 'opponent', activeSlot = 0) {
  return aiReplacementCandidates(state, sideId, activeSlot)
    .find((candidate) => Number.isFinite(candidate.score))?.targetIndex ?? null
}

function chooseStrategicSwitches(
  state,
  sideId,
  attacker,
  activeSlot,
  moveDecision,
  targetSlots,
  planning,
  prediction = false,
) {
  if (attacker.trappedTurns > 0 || trappingAbilitySource(state, attacker) || attacker.dynamaxActive) return []
  const side = getSide(state, sideId)
  const opposingSide = getOtherSide(state, sideId)
  const switchOptions = availableBenchIndexes(side)
    .filter((index) => !planning.reservedBenchIndexes?.has(index))
  if (switchOptions.length === 0) return []

  const opposingAttackers = targetSlots.map((slot) => getActivePokemon(state, opposingSide.id, slot)).filter(Boolean)
  const candidates = switchOptions.map((targetIndex) => {
    const pokemon = side.team[targetIndex]
    const hazardRatio = aiHazardDamageRatio(state, side, pokemon)
    if (hazardRatio * pokemon.maxHp >= pokemon.hp) return { targetIndex, score: -Infinity }
    const offense = bestAiMoveForPokemon(state, pokemon, targetSlots)
    const incomingThreat = aiIncomingThreatRatio(state, pokemon, opposingAttackers)
    const remainingHpRatio = Math.max(0, pokemon.hp / pokemon.maxHp - hazardRatio)
    const sacrificePenalty = incomingThreat >= remainingHpRatio ? 175 : 0
    return {
      targetIndex,
      score: Math.max(0, offense?.score ?? 0) * 0.58
        + remainingHpRatio * 65
        - incomingThreat * 88
        - sacrificePenalty
        + aiEntryAbilityUtility(pokemon)
        + aiRoleUtility(state, pokemon, sideId) * 0.35
        + aiRosterMatchupUtility(state, pokemon, opposingSide.team),
    }
  }).sort((first, second) => second.score - first.score)
  if (!candidates.some((candidate) => Number.isFinite(candidate.score))) return []

  const currentThreat = aiIncomingThreatRatio(state, attacker, opposingAttackers)
  const currentHpRatio = attacker.hp / Math.max(1, attacker.maxHp)
  const stayScore = Math.max(0, moveDecision?.score ?? 0) * 0.62
    + currentHpRatio * 48
    - currentThreat * 82
    + aiPositiveStageTotal(attacker) * 13
    + aiRoleUtility(state, attacker, sideId) * 0.35
  const projectedTargetHp = planning.projectedTargetHp?.get(moveDecision?.action?.targetSlot)
    ?? getActivePokemon(state, opposingSide.id, moveDecision?.action?.targetSlot)?.hp
    ?? Infinity
  const canKnockOutBeforeHit = opposingAttackers.length === 1
    && moveDecision?.knockout
    && (moveDecision.accuracy ?? 0) >= 0.85
    && (() => {
      const defender = opposingAttackers[0]
      const attackerPriority = Number(moveDecision.priority ?? 0)
      const defenderPriority = defender.moves.reduce((highest, move) => {
        if (!move || move.currentPp <= 0 || isStatusMove(move)) return highest
        return Math.max(highest, environmentMovePriority(state, defender, move))
      }, -Infinity)
      return attackerPriority > defenderPriority
        || (
          attackerPriority === defenderPriority
          && effectiveStat(state, attacker, 'speed') > effectiveStat(state, defender, 'speed')
        )
    })()
  const urgentSwitch = attacker.perishCount === 1 || attacker.yawnTurns === 1
  const expectedKnockout = currentThreat * attacker.maxHp >= attacker.hp && !canKnockOutBeforeHit
  const badMatchup = !Number.isFinite(moveDecision?.score) || moveDecision.score < (prediction ? 58 : 48)
  if (!urgentSwitch && canKnockOutBeforeHit) return []
  if (!urgentSwitch && aiPositiveStageTotal(attacker) >= 3) return []
  if (!urgentSwitch && !expectedKnockout && !badMatchup) return []

  const minimumAdvantage = expectedKnockout ? 12 : prediction ? 10 : 18
  return candidates
    .filter((candidate) => (
      Number.isFinite(candidate.score)
      && (urgentSwitch || candidate.score - stayScore >= minimumAdvantage)
    ))
    .slice(0, AI_MAX_SWITCH_CANDIDATES)
    .map((candidate) => ({
      action: {
        type: 'switch',
        actorSlot: activeSlot,
        targetIndex: candidate.targetIndex,
      },
      score: candidate.score
        + (urgentSwitch ? 100 : 0)
        + (expectedKnockout ? 96 : 0)
        + (badMatchup ? 18 : 0),
      estimatedDamage: 0,
      rawDamage: 0,
      priority: 10,
    }))
}

function aiDecisionKey(decision) {
  const action = decision.action
  if (action.type === 'switch') return `switch:${action.actorSlot}:${action.targetIndex}`
  return `move:${action.actorSlot}:${action.moveIndex}:${action.targetSlot}:${action.gimmick ?? 'none'}`
}

function selectDiverseAiDecisions(candidates, limit) {
  const selected = []
  const seen = new Set()
  const tacticCounts = new Map()
  candidates.forEach((candidate) => {
    if (selected.length >= limit) return
    const key = aiDecisionKey(candidate)
    if (seen.has(key)) return
    const action = candidate.action
    const tacticKey = action.type === 'switch'
      ? `switch:${action.targetIndex}`
      : `move:${action.moveIndex}:${action.targetSlot}`
    const tacticCount = tacticCounts.get(tacticKey) ?? 0
    if (tacticCount >= 2) return
    seen.add(key)
    tacticCounts.set(tacticKey, tacticCount + 1)
    selected.push(candidate)
  })
  const requiredCandidates = [
    candidates.find((candidate) => candidate.action.type === 'move' && !candidate.action.gimmick),
    ...candidates
      .filter((candidate) => candidate.action.type === 'switch')
      .slice(0, AI_MAX_SWITCH_CANDIDATES),
  ].filter(Boolean)
  const requiredKeys = new Set(requiredCandidates.map(aiDecisionKey))
  requiredCandidates.forEach((candidate) => {
    const key = aiDecisionKey(candidate)
    if (selected.some((selectedCandidate) => aiDecisionKey(selectedCandidate) === key)) return
    if (selected.length >= limit) {
      const replaceIndex = selected.findLastIndex((selectedCandidate) => (
        !requiredKeys.has(aiDecisionKey(selectedCandidate))
      ))
      if (replaceIndex >= 0) selected.splice(replaceIndex, 1)
      else selected.pop()
    }
    selected.push(candidate)
  })
  return selected.sort((first, second) => second.score - first.score)
}

function rankSideDecisions(
  state,
  sideId,
  activeSlot,
  fallbackTargetSlot,
  planning,
  random,
  limit = 6,
  prediction = false,
) {
  const attacker = getActivePokemon(state, sideId, activeSlot)
  const targetSideId = getOtherSide(state, sideId).id
  const targetSlots = aiTargetSlotsForSide(state, sideId, fallbackTargetSlot)
  if (!attacker) {
    return [{
      action: { type: 'move', actorSlot: activeSlot, targetSlot: targetSlots[0] ?? 0, moveIndex: 0, gimmick: null },
      score: -Infinity,
      estimatedDamage: 0,
      rawDamage: 0,
      priority: 0,
    }]
  }

  const forcedAction = forcedActionForPokemon(attacker)
  const availableMechanics = forcedAction
    ? []
    : getAvailableBattleMechanics(state, sideId, activeSlot)
      .filter((mechanic) => !planning.reservedMechanics?.has(mechanic.id))
  const gimmicks = [null, ...availableMechanics.map((mechanic) => mechanic.id)]
  const moveEntries = forcedAction
    ? [{ move: attacker.moves[forcedAction.moveIndex], moveIndex: forcedAction.moveIndex }]
    : attacker.moves.map((move, moveIndex) => ({ move, moveIndex }))
  const noiseRange = sideId === 'opponent'
    ? AI_TIER_NOISE[String(state.opponentMeta?.tier ?? 'S').toUpperCase()] ?? 1.4
    : 0
  const candidates = []

  moveEntries.forEach(({ move, moveIndex }) => {
    if (!move) return
    if (attacker.tormented && attacker.lastMoveIndex === moveIndex && !forcedAction) return
    const moveTargetSlots = AI_NON_TARGETED_MOVE_TARGETS.has(move.target) ? targetSlots.slice(0, 1) : targetSlots
    moveTargetSlots.forEach((targetSlot) => {
      const defender = getActivePokemon(state, targetSideId, targetSlot)
      if (!defender) return
      const projectedHp = planning.projectedTargetHp?.get(targetSlot) ?? defender.hp
      const targetReserved = targetSlots.length > 1 && projectedHp <= 0
      gimmicks.forEach((gimmick) => {
        const evaluation = evaluateAiMove(state, attacker, defender, move, gimmick, {
          targetHp: Math.max(1, projectedHp),
          targetReserved,
        })
        const repeatPredictionBias = prediction && attacker.lastMoveIndex === moveIndex ? 16 : 0
        const score = evaluation.score + repeatPredictionBias
          + (Number.isFinite(evaluation.score) && noiseRange > 0 ? random() * noiseRange : 0)
        candidates.push({
          action: {
            ...(forcedAction ?? { type: 'move', moveIndex }),
            actorSlot: activeSlot,
            targetSlot,
            gimmick,
          },
          ...evaluation,
          score,
        })
      })
    })
  })

  candidates.sort((first, second) => second.score - first.score)
  const moveDecision = candidates[0] ?? {
    action: { type: 'move', actorSlot: activeSlot, targetSlot: targetSlots[0] ?? 0, moveIndex: 0, gimmick: null },
    score: -Infinity,
    estimatedDamage: 0,
    rawDamage: 0,
    priority: 0,
  }
  if (forcedAction) return [moveDecision]

  const switchDecisions = chooseStrategicSwitches(
    state,
    sideId,
    attacker,
    activeSlot,
    moveDecision,
    targetSlots,
    planning,
    prediction,
  )
  candidates.push(...switchDecisions)
  candidates.sort((first, second) => second.score - first.score)
  return selectDiverseAiDecisions(candidates, limit)
}

function aiPlanningState(state, sideId) {
  const targetSideId = getOtherSide(state, sideId).id
  return {
    reservedMechanics: new Set(),
    reservedBenchIndexes: new Set(),
    projectedTargetHp: new Map(aiLivingActiveSlots(state, targetSideId).map((slot) => [
      slot,
      getActivePokemon(state, targetSideId, slot).hp,
    ])),
  }
}

function aiPlanCoordinationScore(state, sideId, decisions) {
  const targetSideId = getOtherSide(state, sideId).id
  const projectedDamage = new Map()
  let score = 0
  decisions.forEach((decision) => {
    if (decision.action.type !== 'move' || decision.estimatedDamage <= 0) return
    const targetSlot = decision.action.targetSlot
    const target = getActivePokemon(state, targetSideId, targetSlot)
    if (!target) return
    const previousDamage = projectedDamage.get(targetSlot) ?? 0
    const nextDamage = previousDamage + decision.estimatedDamage
    const previousExcess = Math.max(0, previousDamage - target.hp)
    const nextExcess = Math.max(0, nextDamage - target.hp)
    score -= (nextExcess - previousExcess) / Math.max(1, target.maxHp) * 72
    projectedDamage.set(targetSlot, nextDamage)
  })
  return score
}

function buildAiActionPlans(state, sideId, candidateGroups, limit) {
  let plans = [{ decisions: [], score: 0, mechanics: new Set(), benchIndexes: new Set() }]
  candidateGroups.forEach((candidates) => {
    const expanded = []
    plans.forEach((plan) => {
      candidates.forEach((decision) => {
        const { action } = decision
        if (action.gimmick && plan.mechanics.has(action.gimmick)) return
        if (action.type === 'switch' && plan.benchIndexes.has(action.targetIndex)) return
        const mechanics = new Set(plan.mechanics)
        const benchIndexes = new Set(plan.benchIndexes)
        if (action.gimmick) mechanics.add(action.gimmick)
        if (action.type === 'switch') benchIndexes.add(action.targetIndex)
        const decisions = [...plan.decisions, decision]
        const coordinationDelta = aiPlanCoordinationScore(state, sideId, decisions)
          - aiPlanCoordinationScore(state, sideId, plan.decisions)
        expanded.push({
          decisions,
          mechanics,
          benchIndexes,
          score: plan.score + decision.score + coordinationDelta,
        })
      })
    })
    plans = expanded.sort((first, second) => second.score - first.score).slice(0, limit)
  })
  return plans
}

function createSideCandidateGroups(
  state,
  sideId,
  random,
  decisionLimit,
  restrictedSlots = null,
  prediction = false,
) {
  const fallbackTargetSlots = aiLivingActiveSlots(state, getOtherSide(state, sideId).id)
  const activeSlots = (restrictedSlots ?? aiLivingActiveSlots(state, sideId))
  const planning = aiPlanningState(state, sideId)
  const groups = activeSlots.map((activeSlot, index) => rankSideDecisions(
    state,
    sideId,
    activeSlot,
    fallbackTargetSlots[index % Math.max(1, fallbackTargetSlots.length)] ?? 0,
    planning,
    random,
    decisionLimit,
    prediction,
  ))
  if (!state.rules?.format?.rotation) return groups
  const rotationCandidates = groups.flat()
    .sort((first, second) => second.score - first.score)
    .slice(0, decisionLimit + 2)
  return rotationCandidates.length > 0 ? [rotationCandidates] : []
}

function prepareAiSimulationState(state) {
  const simulation = cloneBattle(state)
  ;['player', 'opponent'].forEach((sideId) => {
    getActivePokemonList(simulation, sideId).forEach((pokemon) => {
      pokemon.protected = false
      pokemon.protectMode = null
      pokemon.flinched = false
      pokemon.actedThisTurn = false
      pokemon.switchedInThisTurn = false
      pokemon.redirectTurns = 0
      pokemon.redirectMode = null
    })
  })
  return simulation
}

function settleAiSimulationFaints(state) {
  settleFaints(state)
  while (!state.winner && state.awaitingPlayerSwitchSlots.length > 0) {
    const activeSlot = state.awaitingPlayerSwitchSlots[0]
    const targetIndex = chooseAiReplacementIndex(state, 'player', activeSlot)
    if (targetIndex == null) break
    performSwitch(state, 'player', targetIndex, true, null, null, activeSlot)
    state.awaitingPlayerSwitchSlots = state.awaitingPlayerSwitchSlots.slice(1)
  }
  state.awaitingPlayerSwitch = state.awaitingPlayerSwitchSlots.length > 0
}

function simulateAiActionPlans(state, sideId, ownDecisions, responseDecisions) {
  const simulation = prepareAiSimulationState(state)
  const ownActions = ownDecisions.map((decision) => decision.action)
  const responseActions = responseDecisions.map((decision) => decision.action)
  const playerActions = sideId === 'player' ? ownActions : responseActions
  const opponentActions = sideId === 'opponent' ? ownActions : responseActions
  const actions = orderedActions(simulation, playerActions, opponentActions, AI_SIMULATION_RANDOM)

  actions.forEach(({ sideId, action, actorBattleId }) => {
    const actor = getActivePokemon(simulation, sideId, action.actorSlot)
    if (!actor || actor.battleId !== actorBattleId || actor.fainted || actor.hp <= 0) return
    const actingSide = getSide(simulation, sideId)
    if (simulation.rules?.format?.rotation) {
      actingSide.rotationSlot = action.actorSlot ?? actingSide.rotationSlot
      actingSide.activeIndex = actingSide.activeIndexes[actingSide.rotationSlot] ?? actingSide.activeIndex
    }
    if (action.type === 'switch') {
      performSwitch(simulation, sideId, action.targetIndex, false, null, null, action.actorSlot)
    } else {
      executeMove(simulation, sideId, action, AI_SIMULATION_RANDOM)
    }
    markActiveFaints(simulation)
  })

  const playerResidualSlots = simulation.rules?.format?.rotation
    ? [simulation.player.rotationSlot]
    : aiLivingActiveSlots(simulation, 'player')
  const opponentResidualSlots = simulation.rules?.format?.rotation
    ? [simulation.opponent.rotationSlot]
    : aiLivingActiveSlots(simulation, 'opponent')
  playerResidualSlots.forEach((slot) => {
    residualEffects(simulation, 'player', null, slot, AI_SIMULATION_RANDOM)
    markActiveFaints(simulation)
  })
  opponentResidualSlots.forEach((slot) => {
    residualEffects(simulation, 'opponent', null, slot, AI_SIMULATION_RANDOM)
    markActiveFaints(simulation)
  })
  advanceSideConditionTimers(simulation)
  advanceEnvironmentTimers(simulation)
  settleAiSimulationFaints(simulation)
  return simulation
}

function simulateAiGreedyContinuation(state, sideId) {
  if (state.winner || state.rules?.format?.activeSlots !== 1 || state.rules?.format?.rotation) return state
  const responseSideId = getOtherSide(state, sideId).id
  const ownGroups = createSideCandidateGroups(state, sideId, () => 0, 5, null, false)
  const responseGroups = createSideCandidateGroups(state, responseSideId, () => 0, 5, null, true)
  if (
    ownGroups.length === 0
    || responseGroups.length === 0
    || ownGroups.some((group) => group.length === 0)
    || responseGroups.some((group) => group.length === 0)
  ) return state
  const ownPlan = buildAiActionPlans(state, sideId, ownGroups, 1)[0]
  const responsePlan = buildAiActionPlans(state, responseSideId, responseGroups, 1)[0]
  if (!ownPlan || !responsePlan) return state
  const continuation = cloneBattle(state)
  continuation.turn += 1
  return simulateAiActionPlans(continuation, sideId, ownPlan.decisions, responsePlan.decisions)
}

function aiResponseWeights(responsePlans) {
  if (responsePlans.length === 0) return []
  const bestScore = responsePlans[0].score
  const rawWeights = responsePlans.map((plan) => Math.exp(
    Math.max(-8, (plan.score - bestScore) / AI_RESPONSE_TEMPERATURE),
  ))
  const total = rawWeights.reduce((sum, weight) => sum + weight, 0)
  return rawWeights.map((weight) => weight / Math.max(1, total))
}

function aiPlanReliabilityPenalty(plan) {
  return plan.decisions.reduce((total, decision) => {
    if (decision.action.type !== 'move') return total
    const accuracy = Math.max(0, Math.min(1, Number(decision.accuracy ?? 1)))
    if (accuracy >= 1) return total
    const impact = (decision.knockout ? 105 : 36)
      + Math.min(80, Math.max(0, Number(decision.rawDamage ?? 0)) * 0.35)
    return total + (1 - accuracy) * impact
  }, 0)
}

function scorePredictiveAiPlan(state, sideId, ownPlan, responsePlans, baseAdvantage) {
  const resolvedResponses = responsePlans.length > 0 ? responsePlans : [{ decisions: [], score: 0 }]
  const responseWeights = aiResponseWeights(resolvedResponses)
  const outcomes = resolvedResponses.map((responsePlan, index) => {
    const simulation = simulateAiActionPlans(state, sideId, ownPlan.decisions, responsePlan.decisions)
    const immediateScore = aiBoardAdvantage(simulation, sideId) - baseAdvantage
    const continuation = index < AI_CONTINUATION_RESPONSE_COUNT
      ? simulateAiGreedyContinuation(simulation, sideId)
      : simulation
    const continuationScore = aiBoardAdvantage(continuation, sideId) - baseAdvantage
    return {
      score: immediateScore * (1 - AI_CONTINUATION_WEIGHT)
        + continuationScore * AI_CONTINUATION_WEIGHT,
      weight: responseWeights[index] ?? 1,
    }
  })
  const expectedScore = outcomes.reduce((total, outcome) => total + outcome.score * outcome.weight, 0)
  const worstScore = outcomes.reduce((worst, outcome) => Math.min(worst, outcome.score), Infinity)
  const tailCount = Math.max(1, Math.ceil(outcomes.length * 0.35))
  const tailScore = outcomes
    .map((outcome) => outcome.score)
    .sort((first, second) => first - second)
    .slice(0, tailCount)
    .reduce((total, score) => total + score, 0) / tailCount
  return ownPlan.score * 0.12
    + expectedScore * 0.64
    + worstScore * 0.2
    + tailScore * 0.16
    - aiPlanReliabilityPenalty(ownPlan) * 0.5
}

function choosePredictiveAiPlan(state, sideId, random, restrictedSlots = null) {
  const responseSideId = getOtherSide(state, sideId).id
  const ownGroups = createSideCandidateGroups(
    state,
    sideId,
    random,
    state.rules?.format?.activeSlots > 1 ? 5 : 8,
    restrictedSlots,
    false,
  )
  if (ownGroups.length === 0 || ownGroups.some((group) => group.length === 0)) return null
  const ownPlans = buildAiActionPlans(state, sideId, ownGroups, AI_MAX_PLAN_COUNT)
  const responseGroups = createSideCandidateGroups(
    state,
    responseSideId,
    () => 0,
    state.rules?.format?.activeSlots > 1 ? 4 : 6,
    null,
    true,
  )
  const responsePlans = responseGroups.length > 0
    ? buildAiActionPlans(state, responseSideId, responseGroups, AI_MAX_RESPONSE_PLAN_COUNT)
    : []
  const baseAdvantage = aiBoardAdvantage(state, sideId)
  const sideNoise = sideId === 'opponent'
    ? AI_TIER_NOISE[String(state.opponentMeta?.tier ?? 'S').toUpperCase()] ?? 1.4
    : AI_TIER_NOISE.S
  const finalNoise = sideNoise * 0.1

  return ownPlans
    .map((plan) => ({
      ...plan,
      predictiveScore: scorePredictiveAiPlan(state, sideId, plan, responsePlans, baseAdvantage)
        + (finalNoise > 0 ? random() * finalNoise : 0),
    }))
    .sort((first, second) => second.predictiveScore - first.predictiveScore)[0] ?? null
}

export function chooseAiAction(state, random = Math.random, activeSlot = 0, targetSlot = 0) {
  const plan = choosePredictiveAiPlan(state, 'opponent', random, [activeSlot])
  return plan?.decisions[0]?.action ?? {
    type: 'move',
    actorSlot: activeSlot,
    targetSlot,
    moveIndex: 0,
    gimmick: null,
  }
}

export function chooseAiActionsForSide(state, sideId = 'opponent', random = Math.random) {
  const plan = choosePredictiveAiPlan(state, sideId, random)
  return plan?.decisions.map((decision) => decision.action) ?? []
}

function chooseAiActions(state, random) {
  return chooseAiActionsForSide(state, 'opponent', random)
}

export function createBattle({ playerPokemon, opponent, opponentTeam, rules = null }) {
  const battleRules = rules ?? {
    weather: { id: 'clear', label: '맑음' },
    terrain: { id: 'neutral', label: '일반 필드' },
    format: { id: 'single', label: '싱글배틀', activeSlots: 1, actionSlots: 1 },
    teamRule: { id: 'full', label: '6대6', battleSize: playerPokemon.length },
    disabledGimmickId: null,
    gimmickRestriction: { id: null, label: '제한 없음' },
    aiDifficulty: normalizeAiBattleDifficulty(),
  }
  const resolvedRules = cloneBattleRules(battleRules)
  const activeSlots = Math.max(1, Math.min(
    resolvedRules.format.activeSlots ?? 1,
    playerPokemon.length,
    opponentTeam.pokemon.length,
  ))
  const player = createSide('player', 'PLAYER_01', playerPokemon, [], '', activeSlots)
  const opponentSide = createSide(
    'opponent',
    opponent.name,
    opponentTeam.pokemon,
    opponentTeam.battleGimmicks,
    opponentTeam.strategy?.lead,
    activeSlots,
  )
  applyOpponentAiDifficulty(opponentSide, resolvedRules.aiDifficulty)
  const state = {
    turn: 1,
    phase: 'command',
    player,
    opponent: opponentSide,
    opponentMeta: opponent,
    opponentStrategy: opponentTeam.strategy,
    rules: resolvedRules,
    environment: createEnvironmentState(resolvedRules),
    awaitingPlayerSwitch: false,
    awaitingPlayerSwitchSlots: [],
    winner: null,
    log: [],
    lastEvent: null,
    lastConsumedItem: null,
    eventNonce: 0,
  }

  const opponentLeadIndexes = chooseAiLeadIndexes(
    state,
    'opponent',
    activeSlots,
    opponentTeam.strategy?.lead,
  )
  if (opponentLeadIndexes.length > 0) {
    state.opponent.activeIndexes = opponentLeadIndexes
    state.opponent.activeIndex = opponentLeadIndexes[0]
    state.opponent.rotationSlot = 0
  }
  getActivePokemonList(state, 'opponent').forEach((pokemon) => {
    pokemon.difficultyBoostPending = false
  })
  getActivePokemonList(state, 'opponent').forEach((pokemon) => activateIllusion(state, 'opponent', pokemon))
  getActivePokemonList(state, 'player').forEach((pokemon) => activateIllusion(state, 'player', pokemon))

  appendLog(state, `${opponent.name}이(가) 승부를 걸어왔다!`, 'opponent')
  appendLog(state, `${resolvedRules.weather.label} · ${resolvedRules.terrain.label} · ${resolvedRules.format.label}`, 'field')
  if (resolvedRules.aiDifficulty.id === 'easy') {
    appendLog(state, '이지 난이도: 상대 포켓몬은 지닌 도구와 배틀 기믹을 사용하지 않는다.', 'field')
  } else if (resolvedRules.aiDifficulty.id === 'hard') {
    appendLog(
      state,
      `하드 난이도: 상대 포켓몬의 HP와 주요 능력이 ${resolvedRules.aiDifficulty.boostStage}단계 강화된 상태로 시작한다!`,
      'status',
    )
  }
  appendLog(
    state,
    `${opponent.name}은(는) ${getActivePokemonList(state, 'opponent').map((pokemon) => pokemon.name).join(', ')}을(를) 내보냈다!`,
    'opponent',
  )
  appendLog(state, `${getActivePokemonList(state, 'player').map((pokemon) => pokemon.name).join(', ')}! 너희로 정했다!`, 'player')
  getActivePokemonList(state, 'opponent').forEach((_, slot) => activateEntryAbility(state, 'opponent', slot))
  getActivePokemonList(state, 'player').forEach((_, slot) => activateEntryAbility(state, 'player', slot))
  return state
}

function resolveBattleTurn(state, playerAction, random, captureTimeline, opponentActionOverride = null) {
  if (!state || state.winner || state.awaitingPlayerSwitch) {
    return { state, timeline: [] }
  }

  const nextState = cloneBattle(state)
  const timeline = captureTimeline ? [] : null
  nextState.lastEvent = null
  ;['player', 'opponent'].forEach((sideId) => {
    getActivePokemonList(nextState, sideId).forEach((pokemon) => {
      pokemon.protected = false
      pokemon.protectMode = null
      pokemon.flinched = false
      pokemon.actedThisTurn = false
      pokemon.switchedInThisTurn = false
      pokemon.redirectTurns = 0
      pokemon.redirectMode = null
    })
  })
  const requestedPlayerActions = (Array.isArray(playerAction) ? playerAction : [playerAction]).filter(Boolean)
  const livingPlayerSlots = getActivePokemonList(nextState, 'player')
    .map((pokemon, slot) => (isAvailableFieldPokemon(pokemon) ? slot : -1))
    .filter((slot) => slot >= 0)
  const playerActorSlots = nextState.rules?.format?.rotation
    ? [requestedPlayerActions[0]?.actorSlot ?? nextState.player.rotationSlot ?? 0]
    : livingPlayerSlots
  const resolvedPlayerActions = playerActorSlots.map((actorSlot) => {
    const forcedAction = forcedActionForPokemon(getActivePokemon(nextState, 'player', actorSlot))
    const requestedAction = requestedPlayerActions.find((action) => (action.actorSlot ?? 0) === actorSlot)
    return { ...(forcedAction ?? requestedAction ?? { type: 'move', moveIndex: 0 }), actorSlot }
  })
  const requestedOpponentActions = opponentActionOverride == null
    ? chooseAiActions(nextState, random)
    : (Array.isArray(opponentActionOverride) ? opponentActionOverride : [opponentActionOverride]).filter(Boolean)
  const opponentActions = requestedOpponentActions.map((action) => {
    const forcedAction = forcedActionForPokemon(getActivePokemon(nextState, 'opponent', action.actorSlot))
    return forcedAction ? { ...forcedAction, actorSlot: action.actorSlot, targetSlot: action.targetSlot } : action
  })
  const actions = orderedActions(nextState, resolvedPlayerActions, opponentActions, random)

  for (const [actionOrder, { sideId, action, actorBattleId }] of actions.entries()) {
    if (nextState.winner) break
    const actor = getActivePokemon(nextState, sideId, action.actorSlot)
    if (!actor || actor.battleId !== actorBattleId || actor.fainted || actor.hp <= 0) continue
    const actingSide = getSide(nextState, sideId)
    if (nextState.rules?.format?.rotation) {
      actingSide.rotationSlot = action.actorSlot ?? actingSide.rotationSlot
      actingSide.activeIndex = actingSide.activeIndexes[actingSide.rotationSlot] ?? actingSide.activeIndex
    }

    if (action.type === 'switch') {
      performSwitch(nextState, sideId, action.targetIndex, false, timeline, actionOrder, action.actorSlot)
    } else {
      executeMove(nextState, sideId, action, random, timeline, actionOrder)
    }
    markActiveFaints(nextState, timeline, actionOrder)
  }

  const playerResidualSlots = nextState.rules?.format?.rotation
    ? [nextState.player.rotationSlot]
    : getActivePokemonList(nextState, 'player').map((_, slot) => slot)
  const opponentResidualSlots = nextState.rules?.format?.rotation
    ? [nextState.opponent.rotationSlot]
    : getActivePokemonList(nextState, 'opponent').map((_, slot) => slot)
  playerResidualSlots.forEach((slot) => {
    residualEffects(nextState, 'player', timeline, slot, random)
    markActiveFaints(nextState, timeline)
  })
  opponentResidualSlots.forEach((slot) => {
    residualEffects(nextState, 'opponent', timeline, slot, random)
    markActiveFaints(nextState, timeline)
  })
  advanceSideConditionTimers(nextState)
  advanceEnvironmentTimers(nextState, timeline)
  settleFaints(nextState, timeline)
  nextState.turn += 1
  return { state: nextState, timeline: timeline ?? [] }
}

export function createBattleTurnTimeline(state, playerAction, random = Math.random) {
  return resolveBattleTurn(state, playerAction, random, true)
}

export function playBattleTurn(state, playerAction, random = Math.random) {
  return resolveBattleTurn(state, playerAction, random, false).state
}

export function playBattleTurnWithActions(
  state,
  playerActions,
  opponentActions,
  random = Math.random,
) {
  return resolveBattleTurn(state, playerActions, random, false, opponentActions).state
}

export function forcePlayerSwitch(state, targetIndex) {
  if (!state || state.winner || !state.awaitingPlayerSwitch) return state
  const nextState = cloneBattle(state)
  const activeSlot = nextState.awaitingPlayerSwitchSlots?.[0] ?? 0
  if (!performSwitch(nextState, 'player', targetIndex, true, null, null, activeSlot)) return state
  nextState.awaitingPlayerSwitchSlots = nextState.awaitingPlayerSwitchSlots.slice(1)
  nextState.awaitingPlayerSwitch = nextState.awaitingPlayerSwitchSlots.length > 0
  return nextState
}

export function getBattleSummary(state) {
  return {
    winner: state.winner,
    playerRemaining: remainingCount(state.player),
    opponentRemaining: remainingCount(state.opponent),
    turns: Math.max(1, state.turn - 1),
  }
}

export { MECHANIC_LABELS, STATUS_LABELS }
