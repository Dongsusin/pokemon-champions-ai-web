import {
  calculateStats,
  getBattleFormOptions,
  getMove,
  getMoveById,
  getSpeciesProfile,
  normalizePokemon,
} from './trainingData.js'
import { BATTLE_TERRAINS, BATTLE_WEATHERS } from './battleRules.js'
import { resolveMaxMove } from './maxMoveData.js'
import { canUseZMove, resolveZMove } from './zMoveData.js'

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

const STATUS_MOVE_EFFECTS = {
  swordsdance: { self: { attack: 2 } },
  nastyplot: { self: { specialAttack: 2 } },
  dragondance: { self: { attack: 1, speed: 1 } },
  quiverdance: { self: { specialAttack: 1, specialDefense: 1, speed: 1 } },
  irondefense: { self: { defense: 2 } },
  agility: { self: { speed: 2 } },
  rockpolish: { self: { speed: 2 } },
  bulkup: { self: { attack: 1, defense: 1 } },
  workup: { self: { attack: 1, specialAttack: 1 } },
  amnesia: { self: { specialDefense: 2 } },
  calmmind: { self: { specialAttack: 1, specialDefense: 1 } },
  shellsmash: {
    self: { attack: 2, specialAttack: 2, speed: 2, defense: -1, specialDefense: -1 },
  },
  growl: { target: { attack: -1 } },
  charm: { target: { attack: -2 } },
  screech: { target: { defense: -2 } },
  faketears: { target: { specialDefense: -2 } },
  fakeout: {},
}

const PROTECT_MOVE_IDS = new Set([
  'protect',
  'detect',
  'spikyshield',
  'kingsshield',
  'banefulbunker',
  'silktrap',
  'burningbulwark',
  'maxguard',
])

const HEAL_MOVE_IDS = new Set([
  'recover',
  'roost',
  'softboiled',
  'slackoff',
  'moonlight',
  'synthesis',
  'morningsun',
  'milkdrink',
  'shoreup',
  'lifedew',
])

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

const RECOIL_IMMUNE_ABILITIES = new Set(['돌머리', '매직가드'])
const SLEEP_IMMUNE_ABILITIES = new Set(['불면', '의기양양', '절대안깸'])
const WEATHER_SUPPRESSING_ABILITIES = new Set(['날씨부정', '에어록'])
const SANDSTORM_IMMUNE_ABILITIES = new Set(['매직가드', '방진', '모래숨기', '모래헤치기', '모래의힘'])
const WEATHER_ENVIRONMENTS = new Map(BATTLE_WEATHERS.map((weather) => [weather.id, weather]))
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
const ENTRY_WEATHER_ABILITIES = {
  가뭄: 'sun',
  끝의대지: 'sun',
  눈퍼뜨리기: 'snow',
  모래날림: 'sandstorm',
  시작의바다: 'rain',
  잔비: 'rain',
  진홍빛고동: 'sun',
}
const ENTRY_TERRAIN_ABILITIES = {
  그래스메이커: 'grassy',
  미스트메이커: 'misty',
  사이코메이커: 'psychic',
  일렉트릭메이커: 'electric',
  하드론엔진: 'electric',
}
const WEATHER_DURATION_ITEMS = {
  rain: 'damp-rock',
  sandstorm: 'smooth-rock',
  snow: 'icy-rock',
  sun: 'heat-rock',
}
const WEATHER_BALL_TYPES = {
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
  const normalizedMoves = normalized.moves.map((moveName) => getMove(moveName))
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
    },
  }
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
  }
}

function createEnvironmentState(rules) {
  return {
    baseWeather: { ...rules.weather },
    baseTerrain: { ...rules.terrain },
    weatherTurns: null,
    terrainTurns: null,
    weatherSource: null,
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

function effectiveWeatherId(state) {
  if (activePokemonHaveAbility(state, WEATHER_SUPPRESSING_ABILITIES)) return 'clear'
  return state.rules?.weather?.id ?? 'clear'
}

function environmentDuration(kind, environmentId, sourcePokemon) {
  if (kind === 'terrain') return sourcePokemon?.heldItemId === 'terrain-extender' ? 8 : 5
  return WEATHER_DURATION_ITEMS[environmentId] === sourcePokemon?.heldItemId ? 8 : 5
}

function environmentDefinition(kind, environmentId) {
  const environments = kind === 'weather' ? WEATHER_ENVIRONMENTS : TERRAIN_ENVIRONMENTS
  return environments.get(environmentId) ?? null
}

function setTemporaryEnvironment(state, kind, environmentId, sourceName, sourcePokemon) {
  const environment = environmentDefinition(kind, environmentId)
  if (!environment) return false
  const environmentState = ensureEnvironmentState(state)
  const duration = environmentDuration(kind, environmentId, sourcePokemon)
  const turnsKey = kind === 'weather' ? 'weatherTurns' : 'terrainTurns'
  const sourceKey = kind === 'weather' ? 'weatherSource' : 'terrainSource'

  state.rules[kind] = { ...environment }
  environmentState[turnsKey] = duration
  environmentState[sourceKey] = sourceName
  appendLog(
    state,
    kind === 'weather'
      ? `${sourceName}의 효과로 날씨가 ${environment.label} 상태가 되었다! (${duration}턴)`
      : `${sourceName}의 효과로 ${environment.label}가 펼쳐졌다! (${duration}턴)`,
    'field',
  )
  state.lastEvent = {
    kind: 'environment',
    environmentKind: kind,
    environmentId,
    nonce: state.eventNonce += 1,
  }
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
  return state.player.team.includes(pokemon) ? state.player : state.opponent
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

function normalizedStageChanges(boosts = {}) {
  return Object.fromEntries(Object.entries(boosts).flatMap(([statId, amount]) => {
    const statKey = SHOWDOWN_STAT_IDS[statId] ?? statId
    return STAT_LABELS[statKey] && Number(amount) ? [[statKey, Number(amount)]] : []
  }))
}

function effectiveStat(state, pokemon, statKey) {
  let value = pokemon.stats[statKey] * stageMultiplier(pokemon.statStages[statKey] ?? 0)
  const weatherId = effectiveWeatherId(state)
  const terrainId = state.rules?.terrain?.id

  if (statKey === 'speed' && pokemon.status?.id === 'paralysis') value *= 0.5
  if (statKey === 'speed' && pokemon.heldItemId === 'choice-scarf') value *= 1.5
  if (statKey === 'speed' && weatherId === 'sun' && pokemon.ability === '엽록소') value *= 2
  if (statKey === 'speed' && weatherId === 'rain' && pokemon.ability === '쓱쓱') value *= 2
  if (statKey === 'speed' && weatherId === 'sandstorm' && pokemon.ability === '모래헤치기') value *= 2
  if (statKey === 'speed' && weatherId === 'snow' && pokemon.ability === '눈치우기') value *= 2
  if (statKey === 'speed' && terrainId === 'electric' && pokemon.ability === '서핑테일') value *= 2
  if (statKey === 'attack' && pokemon.heldItemId === 'choice-band') value *= 1.5
  if (statKey === 'attack' && weatherId === 'sun' && pokemon.ability === '진홍빛고동') value *= 4 / 3
  if (statKey === 'specialAttack' && pokemon.heldItemId === 'choice-specs') value *= 1.5
  if (statKey === 'specialAttack' && weatherId === 'sun' && pokemon.ability === '선파워') value *= 1.5
  if (statKey === 'specialAttack' && terrainId === 'electric' && pokemon.ability === '하드론엔진') value *= 4 / 3
  if (statKey === 'specialDefense' && pokemon.heldItemId === 'assault-vest') value *= 1.5
  if (statKey === 'defense' && terrainId === 'grassy' && pokemon.ability === '풀모피') value *= 1.5

  return Math.max(1, value)
}

export function getTypeEffectiveness(moveType, defenderTypes) {
  return defenderTypes.reduce((multiplier, defenderType) => (
    multiplier * (TYPE_CHART[moveType]?.[defenderType] ?? 1)
  ), 1)
}

export function getBattleTypeEffectiveness(state, moveType, defenderTypes) {
  const standardMultiplier = getTypeEffectiveness(moveType, defenderTypes)
  if (!state?.rules?.format?.inverse) return standardMultiplier
  if (standardMultiplier === 0) return 2
  return 1 / standardMultiplier
}

function isGrounded(pokemon, state = null) {
  if (state?.environment?.gravityTurns > 0) return true
  return !pokemon.semiInvulnerable && !pokemon.types.includes('비행') && pokemon.ability !== '부유'
}

function resolveEnvironmentMove(state, attacker, defender, move) {
  const resolvedMove = { ...move }
  const weatherId = effectiveWeatherId(state)
  const terrainId = state.rules?.terrain?.id

  if (move.id === 'weatherball' && WEATHER_BALL_TYPES[weatherId]) {
    resolvedMove.type = WEATHER_BALL_TYPES[weatherId]
    resolvedMove.power = Math.max(1, Number(move.power) || 50) * 2
  }

  if (move.id === 'terrainpulse' && isGrounded(attacker, state) && TERRAIN_PULSE_TYPES[terrainId]) {
    resolvedMove.type = TERRAIN_PULSE_TYPES[terrainId]
    resolvedMove.power = Math.max(1, Number(move.power) || 50) * 2
  }

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
  if (move?.id === 'grassyglide' && state.rules?.terrain?.id === 'grassy' && isGrounded(attacker, state)) {
    priority += 1
  }
  return priority
}

function environmentMoveMultiplier(state, attacker, defender, move) {
  let multiplier = 1
  const weatherId = effectiveWeatherId(state)
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

function abilityImmunity(defender, moveType) {
  if (moveType === '땅' && defender.ability === '부유') return '부유'
  if (moveType === '물' && ['저수', '마중물', '건조피부'].includes(defender.ability)) return defender.ability
  if (moveType === '전기' && ['축전', '피뢰침', '전기엔진'].includes(defender.ability)) return defender.ability
  if (moveType === '불꽃' && defender.ability === '타오르는불꽃') return defender.ability
  return null
}

function calculateDamage(state, attacker, defender, move, random, powerMultiplier = 1) {
  const category = move.adaptiveOffense
    ? (effectiveStat(state, attacker, 'attack') > effectiveStat(state, attacker, 'specialAttack') ? 'physical' : 'special')
    : move.categoryId ?? (move.category === '물리' ? 'physical' : 'special')
  const attackKey = category === 'physical' ? 'attack' : 'specialAttack'
  const defenseKey = category === 'physical' ? 'defense' : 'specialDefense'
  const power = Math.max(1, Number(move.power) || 1) * powerMultiplier
  let attack = effectiveStat(state, attacker, attackKey)
  let defense = effectiveStat(state, defender, defenseKey)

  if (category === 'physical' && attacker.status?.id === 'burn' && attacker.ability !== '근성') attack *= 0.5
  if (attacker.ability === '의욕' && category === 'physical') attack *= 1.5
  if (attacker.ability === '근성' && attacker.status) attack *= 1.5
  if (effectiveWeatherId(state) === 'snow' && category === 'physical' && defender.types.includes('얼음')) defense *= 1.5
  if (effectiveWeatherId(state) === 'sandstorm' && category === 'special' && defender.types.includes('바위')) defense *= 1.5
  const baseDamage = (((2 * 50) / 5 + 2) * power * attack / defense) / 50 + 2
  const effectiveness = getBattleTypeEffectiveness(state, move.type, defender.types)
  const criticalRates = [1 / 24, 1 / 8, 1 / 2, 1]
  const criticalStage = Math.max(0, Math.min(
    3,
    Number(move.critRatio ?? 0) + (attacker.ability === '대운' ? 1 : 0) + (attacker.criticalStageBoost ?? 0),
  ))
  const critical = Boolean(move.willCrit) || random() < criticalRates[criticalStage]
  const randomFactor = 0.85 + random() * 0.15
  let modifier = getMoveStab(attacker, move.type)
    * effectiveness
    * environmentMoveMultiplier(state, attacker, defender, move)
    * randomFactor
    * (critical ? 1.5 : 1)

  if (attacker.heldItemId === 'life-orb') modifier *= 1.3
  if (attacker.heldItemId === 'expert-belt' && effectiveness > 1) modifier *= 1.2
  if (attacker.ability === '심록' && attacker.hp <= attacker.maxHp / 3 && move.type === '풀') modifier *= 1.5
  if (attacker.ability === '맹화' && attacker.hp <= attacker.maxHp / 3 && move.type === '불꽃') modifier *= 1.5
  if (attacker.ability === '급류' && attacker.hp <= attacker.maxHp / 3 && move.type === '물') modifier *= 1.5
  if (!move.ignoreAbility) {
    if (defender.ability === '멀티스케일' && defender.hp === defender.maxHp) modifier *= 0.5
    if (defender.ability === '두꺼운지방' && ['불꽃', '얼음'].includes(move.type)) modifier *= 0.5
    if (defender.ability === '건조피부' && move.type === '불꽃') modifier *= 1.25
  }

  const defenderSide = getPokemonSide(state, defender)
  if (defenderSide.auroraVeilTurns > 0 && !critical) {
    modifier *= state.rules?.format?.activeSlots > 1 ? 2 / 3 : 0.5
  }

  return {
    damage: effectiveness === 0 ? 0 : Math.max(1, Math.floor(baseDamage * modifier)),
    effectiveness,
    critical,
  }
}

function setStatus(state, target, statusId, sourceName) {
  if (!STATUS_LABELS[statusId] || target.status || target.fainted || target.hp <= 0) return false
  if (target.ability === '정화의소금') return false
  if (target.ability === '리프가드' && effectiveWeatherId(state) === 'sun') return false
  if (statusId === 'burn' && target.types.includes('불꽃')) return false
  if (statusId === 'burn' && ['수의베일', '수포'].includes(target.ability)) return false
  if ((statusId === 'poison' || statusId === 'toxic') && target.types.some((type) => ['독', '강철'].includes(type))) return false
  if ((statusId === 'poison' || statusId === 'toxic') && target.ability === '면역') return false
  if (statusId === 'paralysis' && target.types.includes('전기')) return false
  if (statusId === 'paralysis' && target.ability === '유연') return false
  if (statusId === 'freeze' && target.types.includes('얼음')) return false
  if (statusId === 'freeze' && target.ability === '마그마의무장') return false
  if (statusId === 'freeze' && effectiveWeatherId(state) === 'sun') return false
  if (statusId === 'sleep' && SLEEP_IMMUNE_ABILITIES.has(target.ability)) return false
  if (isGrounded(target, state) && state.rules?.terrain?.id === 'misty') return false
  if (isGrounded(target, state) && state.rules?.terrain?.id === 'electric' && statusId === 'sleep') return false

  target.status = {
    id: statusId,
    label: STATUS_LABELS[statusId],
    counter: statusId === 'sleep' ? 2 : 0,
    toxicCounter: statusId === 'toxic' ? 1 : 0,
  }
  appendLog(state, `${target.name}은(는) ${STATUS_LABELS[statusId]} 상태가 되었다!`, 'status')
  state.lastEvent = { kind: 'status', targetId: target.battleId, sourceName }
  return true
}

function changeStages(state, pokemon, changes) {
  const messages = []

  Object.entries(normalizedStageChanges(changes)).forEach(([statKey, amount]) => {
    const previous = pokemon.statStages[statKey] ?? 0
    const next = Math.max(-6, Math.min(6, previous + amount))
    pokemon.statStages[statKey] = next
    if (next !== previous) {
      messages.push(`${STAT_LABELS[statKey]}${amount > 0 ? ' 상승' : ' 하락'}`)
    }
  })

  if (messages.length > 0) appendLog(state, `${pokemon.name}의 ${messages.join(' · ')}!`, 'status')
}

function healPokemon(state, pokemon, amount, source) {
  const healed = Math.min(Math.max(0, Math.floor(amount)), pokemon.maxHp - pokemon.hp)
  if (healed <= 0) return 0
  pokemon.hp += healed
  appendLog(state, `${pokemon.name}은(는) ${source}으로 HP를 ${healed} 회복했다.`, 'heal')
  return healed
}

function applyVolatileEffect(state, target, volatileStatus, sourceName, random) {
  if (!target || target.fainted || target.hp <= 0) return false

  if (volatileStatus === 'confusion') {
    if (target.confusionTurns > 0 || target.ability === '마이페이스') return false
    if (isGrounded(target, state) && state.rules?.terrain?.id === 'misty') return false
    target.confusionTurns = 2 + Math.floor(random() * 4)
    appendLog(state, `${target.name}은(는) 혼란에 빠졌다!`, 'status')
    return true
  }

  if (volatileStatus === 'flinch') {
    if (target.ability === '정신력') return false
    target.flinched = true
    appendLog(state, `${target.name}은(는) 풀죽었다!`, 'status')
    return true
  }

  if (volatileStatus === 'yawn') {
    if (target.status || target.yawnTurns > 0 || SLEEP_IMMUNE_ABILITIES.has(target.ability)) return false
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

  return false
}

function applyEffectPayload(state, attacker, defender, effect, random, sourceName) {
  if (!effect) return false
  let applied = false

  if (effect.status) {
    applied = setStatus(state, defender, SHOWDOWN_STATUS_IDS[effect.status] ?? effect.status, sourceName) || applied
  }
  if (effect.volatileStatus && !['lockedmove', 'mustrecharge'].includes(effect.volatileStatus)) {
    applied = applyVolatileEffect(state, defender, effect.volatileStatus, sourceName, random) || applied
  }
  if (effect.boosts && defender.hp > 0) {
    changeStages(state, defender, effect.boosts)
    applied = true
  }
  if (effect.self) {
    applied = applyEffectPayload(state, attacker, attacker, effect.self, random, sourceName) || applied
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
  const applied = applyEffectPayload(state, attacker, target, primaryEffect, random, move.name)
  const selfApplied = applyEffectPayload(state, attacker, attacker, move.self, random, move.name)
  return applied || selfApplied
}

function applyEnvironmentFromMove(state, attacker, move) {
  const weatherId = SHOWDOWN_WEATHER_IDS[String(move.weather ?? move.id).toLowerCase()]
  const terrainId = SHOWDOWN_TERRAIN_IDS[String(move.terrain ?? move.id).toLowerCase()]
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

  return applied
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
    targets.forEach((pokemon) => changeStages(state, pokemon, effect.changes))
    return targets.length > 0
  }
  if (effect.kind === 'status') {
    return targets.reduce((applied, pokemon) => (
      setStatus(state, pokemon, effect.status, move.name) || applied
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
      applyVolatileEffect(state, pokemon, effect.volatileStatus, move.name, random) || applied
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
    targets.forEach((pokemon) => {
      pokemon.infatuated = true
      appendLog(state, `${pokemon.name}은(는) 헤롱헤롱 상태가 되었다!`, 'status')
    })
    return targets.length > 0
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
      side.hazards = { stealthRock: false, steelsurge: false }
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
        ? applyVolatileEffect(state, pokemon, 'yawn', move.name, random) || applied
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
    targets.forEach((pokemon) => {
      pokemon.tormented = true
      appendLog(state, `${pokemon.name}은(는) 같은 기술을 연속해서 쓸 수 없게 되었다!`, 'status')
    })
    return targets.length > 0
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

function healingMoveFraction(state, move) {
  const weatherId = effectiveWeatherId(state)
  if (WEATHER_HEAL_MOVE_IDS.has(move.id)) {
    if (weatherId === 'sun') return [2, 3]
    if (weatherId !== 'clear') return [1, 4]
    return [1, 2]
  }
  if (move.id === 'shoreup') return weatherId === 'sandstorm' ? [2, 3] : [1, 2]
  return move.heal ?? [1, 2]
}

function applyStatusMove(state, attacker, defender, move, random) {
  if (PROTECT_MOVE_IDS.has(move.id)) {
    const successRate = 1 / Math.max(1, 3 ** attacker.protectChain)
    if (random() <= successRate) {
      attacker.protected = true
      attacker.protectMode = move.id === 'maxguard' ? 'maxguard' : 'protect'
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
    const [numerator, denominator] = healingMoveFraction(state, move)
    healPokemon(state, attacker, attacker.maxHp * numerator / denominator, move.name)
    return true
  }

  if (applyPrimaryMoveEffects(state, attacker, defender, move, random)) return true

  const scriptedEffect = STATUS_MOVE_EFFECTS[move.id]
  if (scriptedEffect?.self) changeStages(state, attacker, scriptedEffect.self)
  if (scriptedEffect?.target) changeStages(state, defender, scriptedEffect.target)
  if (scriptedEffect) return true
  if (environmentApplied) return true

  appendLog(state, `${move.name}의 전술 효과가 전개되었다.`, 'status')
  return true
}

function secondaryStatusFromDescription(state, defender, move, random) {
  const description = move.description ?? ''
  const percent = Number(description.match(/(\d+)%/)?.[1] ?? 0)
  if (!percent || random() * 100 >= percent) return false

  if (description.includes('화상')) return setStatus(state, defender, 'burn', move.name)
  if (description.includes('마비')) return setStatus(state, defender, 'paralysis', move.name)
  if (description.includes('얼음 상태')) return setStatus(state, defender, 'freeze', move.name)
  if (description.includes('독 상태')) return setStatus(state, defender, 'poison', move.name)
  if (description.includes('풀죽')) return applyVolatileEffect(state, defender, 'flinch', move.name, random)
  return false
}

function applyMoveSecondaries(state, attacker, defender, move, random) {
  const effects = move.secondaries ?? (move.secondary ? [move.secondary] : [])
  if (effects.length === 0) return secondaryStatusFromDescription(state, defender, move, random)

  let applied = false
  effects.forEach((effect) => {
    const baseChance = Number(effect.chance ?? 100)
    const chance = Math.min(100, baseChance * (attacker.ability === '하늘의은총' ? 2 : 1))
    if (random() * 100 >= chance) return

    if (defender.ability === '인분') {
      if (effect.self) applied = applyEffectPayload(state, attacker, attacker, effect.self, random, move.name) || applied
      return
    }
    applied = applyEffectPayload(state, attacker, defender, effect, random, move.name) || applied
  })
  return applied
}

function confusionSelfDamage(state, pokemon, random) {
  const attack = effectiveStat(state, pokemon, 'attack')
  const defense = effectiveStat(state, pokemon, 'defense')
  const baseDamage = (((2 * 50) / 5 + 2) * 40 * attack / defense) / 50 + 2
  return Math.max(1, Math.floor(baseDamage * (0.85 + random() * 0.15)))
}

function canPokemonAct(state, pokemon, random, move) {
  if (pokemon.rechargeTurns > 0) {
    pokemon.rechargeTurns -= 1
    appendLog(state, `${pokemon.name}은(는) 공격의 반동으로 움직일 수 없다!`, 'status')
    return false
  }

  if (pokemon.flinched) {
    pokemon.flinched = false
    appendLog(state, `${pokemon.name}은(는) 풀죽어서 움직일 수 없다!`, 'status')
    return false
  }

  if (pokemon.status?.id === 'sleep') {
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

function transformPokemon(state, pokemon, formId, mechanicId) {
  const fallbackOptions = getBattleFormOptions(pokemon.originalSpeciesId)
  const form = getSpeciesProfile(formId)
    ?? fallbackOptions.find((option) => (
      mechanicId === 'primal' ? option.slug.includes('-primal') : option.slug.includes('-mega')
    ))
  if (!form) return false

  const hpRatio = pokemon.hp / pokemon.maxHp
  const transformed = normalizePokemon({
    ...pokemon,
    speciesId: form.id,
    ability: form.abilities[0],
    moves: pokemon.moves.map((move) => move.name),
  })
  const nextStats = statObject(transformed)
  pokemon.speciesId = form.id
  pokemon.name = form.name
  pokemon.types = [...form.types]
  pokemon.ability = form.abilities[0]
  pokemon.stats = nextStats
  pokemon.maxHp = nextStats.hp
  pokemon.originalMaxHp = nextStats.hp
  pokemon.hp = Math.max(1, Math.ceil(pokemon.maxHp * hpRatio))
  pokemon.spriteFront = transformed.spriteFront
  pokemon.spriteBack = transformed.spriteBack
  pokemon.spriteFrontFallback = transformed.spriteFrontFallback
  pokemon.spriteBackFallback = transformed.spriteBackFallback
  pokemon.megaActive = mechanicId === 'mega'
  pokemon.primalActive = mechanicId === 'primal'
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
  const side = getSide(state, sideId)
  const pokemon = getActivePokemon(state, sideId, activeSlot)
  if (!pokemon || pokemon.fainted) return []
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
      shortLabel: pokemon.dynamaxMode === 'gigantamax' ? 'G-MAX' : 'D-MAX',
    })
  }

  const formOptions = getBattleFormOptions(pokemon.originalSpeciesId)
  const hasMegaForm = Boolean(pokemon.gimmickFormId || formOptions.some((form) => form.slug.includes('-mega')))
  const hasPrimalForm = Boolean(pokemon.gimmickFormId || formOptions.some((form) => form.slug.includes('-primal')))
  const hasMegaStone = pokemon.heldItemId?.includes('ite') || configured.includes('mega')
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

function activateMechanic(state, sideId, mechanicId, activeSlot = null) {
  if (!mechanicId) return 1
  const available = getAvailableBattleMechanics(state, sideId, activeSlot)
  if (!available.some((mechanic) => mechanic.id === mechanicId)) return 1
  const side = getSide(state, sideId)
  const pokemon = getActivePokemon(state, sideId, activeSlot)
  const trainerName = sideId === 'player' ? '플레이어' : side.name

  if (mechanicId === 'tera') {
    side.usedMechanics.tera = true
    pokemon.teraActive = true
    pokemon.types = [pokemon.teraType]
    appendLog(state, `${trainerName}의 ${pokemon.name}이(가) ${pokemon.teraType}타입으로 테라스탈했다!`, 'gimmick')
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
  } else if (mechanicId === 'mega' || mechanicId === 'primal') {
    if (transformPokemon(state, pokemon, pokemon.gimmickFormId, mechanicId)) {
      side.usedMechanics[mechanicId] = true
      appendLog(state, `${trainerName}의 ${pokemon.name}! ${MECHANIC_LABELS[mechanicId]} 성공!`, 'gimmick')
      activateEntryAbility(state, sideId, activeSlot)
    }
  } else if (mechanicId === 'zmove') {
    side.usedMechanics.zmove = true
    appendLog(state, `${trainerName}와 ${pokemon.name}의 전력! Z파워가 기술에 모인다!`, 'gimmick')
  }

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
  const environmentMove = resolveEnvironmentMove(state, attacker, defender, move)
  const zMove = gimmick === 'zmove' ? resolveBattleZMove(attacker, environmentMove, move) : null
  const resolvedMove = gimmick === 'zmove'
    ? zMove ?? { ...environmentMove, zMoveCompatible: false }
    : resolveBattleMaxMove(attacker, environmentMove, gimmick === 'dynamax', move)
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

function moveHits(state, attacker, defender, move, random) {
  if (move.accuracyLabel === '필중' || move.accuracy == null) return true
  if (attacker.ability === '노가드' || defender.ability === '노가드') return true
  const weatherId = effectiveWeatherId(state)
  if (weatherId === 'rain' && ['thunder', 'hurricane'].includes(move.id)) return true
  if (weatherId === 'snow' && move.id === 'blizzard') return true

  const baseAccuracy = Number(move.accuracy) || 100
  const stageModifier = accuracyStageMultiplier(attacker.statStages.accuracy ?? 0)
    / accuracyStageMultiplier(defender.statStages.evasion ?? 0)
  const hustleModifier = attacker.ability === '의욕' && move.categoryId === 'physical' ? 0.8 : 1
  let weatherModifier = weatherId === 'fog' ? 0.6 : 1
  if (weatherId === 'sun' && ['thunder', 'hurricane'].includes(move.id)) weatherModifier *= 0.5
  if (weatherId === 'sandstorm' && defender.ability === '모래숨기') weatherModifier *= 0.8
  if (weatherId === 'snow' && defender.ability === '눈숨기') weatherModifier *= 0.8
  return random() * 100 < Math.min(100, baseAccuracy * stageModifier * hustleModifier * weatherModifier)
}

function chooseMultiHitCount(attacker, move, random) {
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

function fixedDamageResult(state, attacker, defender, move) {
  const effectiveness = getBattleTypeEffectiveness(state, move.type, defender.types)
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
  if (defender.heldItemId === 'focus-sash' && !defender.consumedItem) {
    defender.consumedItem = true
    appendLog(state, `${defender.name}은(는) 기합의띠로 버텼다!`, 'item')
    damage = Math.max(0, defender.hp - 1)
  }
  return damage
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
    const switchOptions = availableBenchIndexes(targetSide)
    if (switchOptions.length > 0) {
      const targetIndex = switchOptions[Math.floor(random() * switchOptions.length)]
      performSwitch(state, targetSide.id, targetIndex, true, timeline, actionOrder, targetSlot)
    }
  }

  if (move.selfSwitch && attacker?.hp > 0) {
    const switchOptions = availableBenchIndexes(side)
    if (switchOptions.length > 0) {
      const targetIndex = switchOptions[Math.floor(random() * switchOptions.length)]
      performSwitch(state, sideId, targetIndex, true, timeline, actionOrder, actorSlot)
    }
  }
}

function executeMove(state, sideId, action, random, timeline = null, actionOrder = 0) {
  const side = getSide(state, sideId)
  const targetSide = getOtherSide(state, sideId)
  const actorSlot = Math.max(0, Math.min(side.activeIndexes.length - 1, Number(action.actorSlot) || 0))
  let targetSlot = Math.max(0, Math.min(targetSide.activeIndexes.length - 1, Number(action.targetSlot) || 0))
  const attacker = getActivePokemon(state, sideId, actorSlot)
  let defender = getActivePokemon(state, targetSide.id, targetSlot)
  if (!defender || defender.fainted || defender.hp <= 0) {
    targetSlot = getActivePokemonList(state, targetSide.id).findIndex((pokemon) => pokemon.hp > 0 && !pokemon.fainted)
    defender = getActivePokemon(state, targetSide.id, Math.max(0, targetSlot))
  }
  const moveSlot = attacker.moves[action.moveIndex]
  let move = moveSlot
  let moveCategory = moveSlot?.categoryId
    ?? (moveSlot?.category === '물리' ? 'physical' : moveSlot?.category === '변화' ? 'status' : 'special')

  if (!moveSlot || attacker.fainted || attacker.hp <= 0 || defender.fainted || defender.hp <= 0) return
  const isChargeContinuation = action.forcedReason === 'charge'
  const isLockedContinuation = action.forcedReason === 'locked'
  if (attacker.tormented && attacker.lastMoveIndex === action.moveIndex && !isChargeContinuation && !isLockedContinuation) {
    appendLog(state, `${attacker.name}은(는) 같은 기술을 연속해서 사용할 수 없다!`, 'status')
    return
  }
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

  if (!isChargeContinuation && !isLockedContinuation && moveSlot.currentPp <= 0) {
    appendLog(state, `${moveSlot.name}의 PP가 남아 있지 않다!`, 'muted')
    return
  }

  const mechanicWasUsed = action.gimmick ? side.usedMechanics[action.gimmick] : false
  const mechanicBefore = action.gimmick ? mechanicPokemonSnapshot(attacker) : null
  const environmentMove = resolveEnvironmentMove(state, attacker, defender, moveSlot)
  const requestedZMove = action.gimmick === 'zmove'
    ? resolveBattleZMove(attacker, environmentMove, moveSlot)
    : null
  if (action.gimmick === 'zmove' && !requestedZMove) {
    appendLog(state, `${moveSlot.name}에는 현재 Z크리스탈의 힘을 담을 수 없다!`, 'muted')
    return
  }
  const powerMultiplier = activateMechanic(state, sideId, action.gimmick, actorSlot)
  move = requestedZMove ?? resolveBattleMaxMove(attacker, environmentMove, false, moveSlot)
  moveCategory = move.categoryId
    ?? (move.category === '물리' ? 'physical' : move.category === '변화' ? 'status' : 'special')
  if (action.gimmick && !mechanicWasUsed && side.usedMechanics[action.gimmick]) {
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
      mechanicId: action.gimmick,
      mechanicLabel: MECHANIC_LABELS[action.gimmick],
      mechanicType: action.gimmick === 'tera' ? attacker.teraType : null,
      mechanicMode: action.gimmick === 'dynamax' ? attacker.dynamaxMode : null,
      chargedMoveName: action.gimmick === 'zmove' ? move.name : null,
      spriteBeforeFront: mechanicBefore.spriteFront,
      spriteBeforeBack: mechanicBefore.spriteBack,
      spriteBeforeFrontFallback: mechanicBefore.spriteFrontFallback,
      spriteBeforeBackFallback: mechanicBefore.spriteBackFallback,
      spriteAfterFront: mechanicAfter.spriteFront,
      spriteAfterBack: mechanicAfter.spriteBack,
      spriteAfterFrontFallback: mechanicAfter.spriteFrontFallback,
      spriteAfterBackFallback: mechanicAfter.spriteBackFallback,
      message: `${attacker.name}의 ${MECHANIC_LABELS[action.gimmick]}이(가) 발동했다!`,
    })
  }

  if (isChargeContinuation) clearChargeState(attacker)
  if (!isChargeContinuation && !isLockedContinuation) moveSlot.currentPp = Math.max(0, moveSlot.currentPp - 1)
  attacker.lastMoveIndex = action.moveIndex
  appendLog(state, `${attacker.name}의 ${move.name}!`, sideId === 'player' ? 'player' : 'opponent')
  const animationMetadata = moveAnimationMetadata(attacker, move, action, moveCategory)

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

  const requiresCharge = move.flags?.includes('charge')
    && !isChargeContinuation
    && action.gimmick !== 'zmove'
    && !attacker.dynamaxActive
    && !(effectiveWeatherId(state) === 'sun' && ['solarbeam', 'solarblade'].includes(move.id))
    && !(effectiveWeatherId(state) === 'rain' && move.id === 'electroshot')
  if (requiresCharge) {
    if (attacker.heldItemId === 'power-herb' && !attacker.consumedItem) {
      attacker.consumedItem = true
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
    if (move.target !== 'self' && defender.protected && move.flags?.includes('protect')) {
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
    return
  }

  attacker.protectChain = 0

  let protectionMultiplier = 1
  if (defender.protected && move.flags?.includes('protect') && !move.bypassesMaxGuard) {
    if (defender.protectMode === 'maxguard' || !move.isMaxMove && !move.isZMove) {
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
    protectionMultiplier = 0.25
    appendLog(
      state,
      `${defender.name}은(는) 방어했지만 ${move.isZMove ? 'Z기술' : '맥스 기술'}의 충격을 완전히 막지 못했다!`,
      'muted',
    )
  }

  const immunity = move.ignoreAbility ? null : abilityImmunity(defender, move.type)
  if (immunity) {
    appendLog(state, `${defender.name}의 ${immunity}! 공격을 무효화했다.`, 'ability')
    if (['저수', '축전'].includes(immunity)) healPokemon(state, defender, defender.maxHp / 4, immunity)
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

  const hitCount = chooseMultiHitCount(attacker, move, random)
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
        powerMultiplier * semiInvulnerable.powerMultiplier * protectionMultiplier,
      )
    if (!result) result = hitResult
    const hitDamage = applySurvivalEffects(state, defender, hitResult.damage, move)
    defender.hp = Math.max(0, defender.hp - hitDamage)
    damage += hitDamage
    landedHits += 1
    result.critical = result.critical || hitResult.critical
    if (hitResult.effectiveness === 0 || hitDamage === 0 && move.ohko) break
  }

  result ??= { damage: 0, effectiveness: getBattleTypeEffectiveness(state, move.type, defender.types), critical: false }
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
    healPokemon(state, attacker, damage * numerator / denominator, move.name)
  }

  if (damage > 0) {
    applyPrimaryMoveEffects(state, attacker, defender, move, random)
    applyMoveSecondaries(state, attacker, defender, move, random)
    applyMoveRecoil(state, attacker, move, damage)

    if (attacker.heldItemId === 'life-orb' && attacker.ability !== '매직가드' && attacker.hp > 0) {
      loseHp(state, attacker, attacker.maxHp / 10, `${attacker.name}은(는) 생명의구슬로 HP가 줄었다.`, 'item')
    }

    if (move.flags?.includes('recharge') && attacker.hp > 0) {
      attacker.rechargeTurns = 1
      appendLog(state, `${attacker.name}은(는) 다음 턴에 반동으로 움직일 수 없다!`, 'status')
    }
    handleLockedMove(state, attacker, move, action.moveIndex, action, random)
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

function activateEntryAbility(state, sideId, activeSlot = null) {
  const pokemon = getActivePokemon(state, sideId, activeSlot)
  if (!pokemon || pokemon.fainted || pokemon.hp <= 0) return

  const weatherId = ENTRY_WEATHER_ABILITIES[pokemon.ability]
  const terrainId = ENTRY_TERRAIN_ABILITIES[pokemon.ability]
  if (weatherId || terrainId) appendLog(state, `${pokemon.name}의 ${pokemon.ability}!`, 'ability')
  if (weatherId) setTemporaryEnvironment(state, 'weather', weatherId, pokemon.ability, pokemon)
  if (terrainId) setTemporaryEnvironment(state, 'terrain', terrainId, pokemon.ability, pokemon)

  if (pokemon.ability === '위협') {
    getActivePokemonList(state, sideId === 'player' ? 'opponent' : 'player')
      .filter((target) => target && !target.fainted && target.hp > 0)
      .forEach((target) => changeStages(state, target, { attack: -1 }))
    appendLog(state, `${pokemon.name}의 위협!`, 'ability')
  }
}

function clearSwitchVolatiles(pokemon) {
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
  pokemon.rechargeTurns = 0
  pokemon.chargingMove = null
  pokemon.lockedMove = null
  pokemon.semiInvulnerable = null
  if (pokemon.status?.id === 'toxic') pokemon.status.toxicCounter = 1
}

function applyEntryHazards(state, side, pokemon) {
  if (!pokemon || pokemon.fainted || pokemon.hp <= 0 || pokemon.ability === '매직가드') return
  const hazards = side.hazards ?? {}
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
  if (current.hp > 0 && !current.fainted && current.trappedTurns > 0) {
    appendLog(state, `${current.name}은(는) ${current.trapSourceName ?? '기술의 효과'} 때문에 교체할 수 없다!`, 'status')
    return false
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
  clearSwitchVolatiles(current)
  side.activeIndexes[resolvedSlot] = targetIndex
  side.activeIndex = side.activeIndexes[state.rules?.format?.rotation ? side.rotationSlot : 0] ?? targetIndex
  clearSwitchVolatiles(target)
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

function residualEffects(state, sideId, timeline = null, activeSlot = null) {
  const side = getSide(state, sideId)
  const pokemon = getActivePokemon(state, sideId, activeSlot)
  if (!pokemon || pokemon.fainted || pokemon.hp <= 0) return
  const previousHp = pokemon.hp
  const previousMaxHp = pokemon.maxHp
  const previousLogLength = state.log.length
  const weatherId = effectiveWeatherId(state)

  if (pokemon.hp > 0 && weatherId === 'rain' && pokemon.ability === '촉촉바디' && pokemon.status) {
    pokemon.status = null
    appendLog(state, `${pokemon.name}의 촉촉바디가 상태 이상을 회복했다!`, 'ability')
  }

  let damage = 0
  if (pokemon.status?.id === 'burn') damage = Math.max(1, Math.floor(pokemon.maxHp / 16))
  if (pokemon.status?.id === 'poison') damage = Math.max(1, Math.floor(pokemon.maxHp / 8))
  if (pokemon.status?.id === 'toxic') {
    damage = Math.max(1, Math.floor((pokemon.maxHp * pokemon.status.toxicCounter) / 16))
    pokemon.status.toxicCounter += 1
  }

  if (damage > 0 && pokemon.ability !== '매직가드') {
    pokemon.hp = Math.max(0, pokemon.hp - damage)
    appendLog(state, `${pokemon.name}은(는) ${pokemon.status.label}의 데미지를 입었다.`, 'damage')
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

  if (pokemon.hp > 0 && pokemon.heldItemId === 'leftovers') {
    healPokemon(state, pokemon, pokemon.maxHp / 16, '먹다남은음식')
  }
  if (pokemon.hp > 0 && state.rules?.terrain?.id === 'grassy' && isGrounded(pokemon, state)) {
    healPokemon(state, pokemon, pokemon.maxHp / 16, '그래스필드')
  }
  if (pokemon.hp > 0 && pokemon.heldItemId === 'black-sludge' && pokemon.types.includes('독')) {
    healPokemon(state, pokemon, pokemon.maxHp / 16, '검은오물')
  }
  if (
    pokemon.hp > 0
    && pokemon.hp <= pokemon.maxHp / 2
    && pokemon.heldItemId === 'sitrus-berry'
    && !pokemon.consumedItem
  ) {
    pokemon.consumedItem = true
    healPokemon(state, pokemon, pokemon.maxHp / 4, '자뭉열매')
  }

  if (pokemon.dynamaxActive) {
    pokemon.dynamaxTurns -= 1
    if (pokemon.dynamaxTurns <= 0) endDynamax(state, pokemon)
  }

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
    const nextIndex = availableBenchIndexes(state.opponent)[0]
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
  const environmentMove = defender ? resolveEnvironmentMove(state, pokemon, defender, move) : move
  const zMove = action.gimmick === 'zmove' ? resolveBattleZMove(pokemon, environmentMove, move) : null
  const resolvedMove = zMove ?? resolveBattleMaxMove(pokemon, environmentMove, action.gimmick === 'dynamax', move)
  return environmentMovePriority(state, pokemon, resolvedMove)
}

function orderedActions(state, playerActions, opponentActions, random) {
  return [
    ...playerActions.map((action) => ({ sideId: 'player', action, tieBreaker: random() })),
    ...opponentActions.map((action) => ({ sideId: 'opponent', action, tieBreaker: random() })),
  ].sort((first, second) => {
    const priorityDifference = actionPriority(state, second.sideId, second.action)
      - actionPriority(state, first.sideId, first.action)
    if (priorityDifference) return priorityDifference
    const firstSpeed = effectiveStat(state, getActivePokemon(state, first.sideId, first.action.actorSlot), 'speed')
    const secondSpeed = effectiveStat(state, getActivePokemon(state, second.sideId, second.action.actorSlot), 'speed')
    return secondSpeed - firstSpeed || first.tieBreaker - second.tieBreaker
  })
}

const AI_TIER_NOISE = {
  S: 0.4,
  A: 0.8,
  B: 1.4,
  C: 2,
  D: 2.8,
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
  const weatherId = effectiveWeatherId(state)
  if (weatherId === 'rain' && ['thunder', 'hurricane'].includes(move.id)) return 1
  if (weatherId === 'snow' && move.id === 'blizzard') return 1

  const stageModifier = accuracyStageMultiplier(attacker.statStages.accuracy ?? 0)
    / accuracyStageMultiplier(defender.statStages.evasion ?? 0)
  const hustleModifier = attacker.ability === '의욕' && move.categoryId === 'physical' ? 0.8 : 1
  let weatherModifier = weatherId === 'fog' ? 0.6 : 1
  if (weatherId === 'sun' && ['thunder', 'hurricane'].includes(move.id)) weatherModifier *= 0.5
  if (weatherId === 'sandstorm' && defender.ability === '모래숨기') weatherModifier *= 0.8
  if (weatherId === 'snow' && defender.ability === '눈숨기') weatherModifier *= 0.8
  return Math.max(0, Math.min(1, (Number(move.accuracy) || 100) * stageModifier * hustleModifier * weatherModifier / 100))
}

function aiExpectedHitCount(attacker, move) {
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
  if (defender.heldItemId === 'focus-sash' && !defender.consumedItem) {
    return Math.max(0, defender.hp - 1)
  }
  return damage
}

function estimateAiDamage(state, attacker, defender, move, targetHp = defender.hp) {
  const effectiveness = getBattleTypeEffectiveness(state, move.type, defender.types)
  const immunity = move.ignoreAbility ? null : abilityImmunity(defender, move.type)
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
    const category = move.adaptiveOffense
      ? (effectiveStat(state, attacker, 'attack') > effectiveStat(state, attacker, 'specialAttack') ? 'physical' : 'special')
      : move.categoryId ?? (move.category === '물리' ? 'physical' : 'special')
    const attackKey = category === 'physical' ? 'attack' : 'specialAttack'
    const defenseKey = category === 'physical' ? 'defense' : 'specialDefense'
    let attack = effectiveStat(state, attacker, attackKey)
    let defense = effectiveStat(state, defender, defenseKey)

    if (category === 'physical' && attacker.status?.id === 'burn' && attacker.ability !== '근성') attack *= 0.5
    if (attacker.ability === '의욕' && category === 'physical') attack *= 1.5
    if (attacker.ability === '근성' && attacker.status) attack *= 1.5
    if (effectiveWeatherId(state) === 'snow' && category === 'physical' && defender.types.includes('얼음')) defense *= 1.5
    if (effectiveWeatherId(state) === 'sandstorm' && category === 'special' && defender.types.includes('바위')) defense *= 1.5

    const baseDamage = (((2 * 50) / 5 + 2) * Math.max(1, Number(move.power) || 1) * attack / defense) / 50 + 2
    const criticalRates = [1 / 24, 1 / 8, 1 / 2, 1]
    const criticalStage = Math.max(0, Math.min(
      3,
      Number(move.critRatio ?? 0) + (attacker.ability === '대운' ? 1 : 0) + (attacker.criticalStageBoost ?? 0),
    ))
    const expectedCriticalMultiplier = move.willCrit ? 1.5 : 1 + criticalRates[criticalStage] * 0.5
    let modifier = getMoveStab(attacker, move.type)
      * effectiveness
      * environmentMoveMultiplier(state, attacker, defender, move)
      * 0.925
      * expectedCriticalMultiplier
      * semiInvulnerable.powerMultiplier

    if (attacker.heldItemId === 'life-orb') modifier *= 1.3
    if (attacker.heldItemId === 'expert-belt' && effectiveness > 1) modifier *= 1.2
    if (attacker.ability === '심록' && attacker.hp <= attacker.maxHp / 3 && move.type === '풀') modifier *= 1.5
    if (attacker.ability === '맹화' && attacker.hp <= attacker.maxHp / 3 && move.type === '불꽃') modifier *= 1.5
    if (attacker.ability === '급류' && attacker.hp <= attacker.maxHp / 3 && move.type === '물') modifier *= 1.5
    if (!move.ignoreAbility) {
      if (defender.ability === '멀티스케일' && defender.hp === defender.maxHp) modifier *= 0.5
      if (defender.ability === '두꺼운지방' && ['불꽃', '얼음'].includes(move.type)) modifier *= 0.5
      if (defender.ability === '건조피부' && move.type === '불꽃') modifier *= 1.25
    }

    const defenderSide = getPokemonSide(state, defender)
    if (defenderSide.auroraVeilTurns > 0) {
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

function aiCanApplyStatus(state, target, statusId) {
  if (!STATUS_LABELS[statusId] || target.status || target.fainted || target.hp <= 0) return false
  if (target.ability === '정화의소금') return false
  if (target.ability === '리프가드' && effectiveWeatherId(state) === 'sun') return false
  if (statusId === 'burn' && (target.types.includes('불꽃') || ['수의베일', '수포'].includes(target.ability))) return false
  if (['poison', 'toxic'].includes(statusId) && target.types.some((type) => ['독', '강철'].includes(type))) return false
  if (['poison', 'toxic'].includes(statusId) && target.ability === '면역') return false
  if (statusId === 'paralysis' && (target.types.includes('전기') || target.ability === '유연')) return false
  if (statusId === 'freeze' && (target.types.includes('얼음') || target.ability === '마그마의무장')) return false
  if (statusId === 'freeze' && effectiveWeatherId(state) === 'sun') return false
  if (statusId === 'sleep' && SLEEP_IMMUNE_ABILITIES.has(target.ability)) return false
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
  const weatherId = SHOWDOWN_WEATHER_IDS[String(move.weather ?? move.id).toLowerCase()]
  const terrainId = SHOWDOWN_TERRAIN_IDS[String(move.terrain ?? move.id).toLowerCase()]
  if (weatherId) return aiEnvironmentUtility(state, attacker, 'weather', weatherId)
  if (terrainId) return aiEnvironmentUtility(state, attacker, 'terrain', terrainId)

  if (PROTECT_MOVE_IDS.has(move.id)) {
    const chainPenalty = Math.max(1, 3 ** (attacker.protectChain ?? 0))
    const residualPressure = attacker.status || attacker.perishCount != null || defender.dynamaxActive ? 22 : 0
    return (34 + residualPressure + (hpRatio < 0.45 ? 28 : 0)) / chainPenalty
  }

  if (move.id === 'rest') {
    if (missingHpRatio < 0.18 && !attacker.status) return -Infinity
    return 70 + missingHpRatio * 90 + (attacker.status ? 25 : 0)
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
    if (!aiCanApplyStatus(state, defender, statusId)) return -Infinity
    if (statusId === 'sleep') utility += 105
    else if (statusId === 'toxic') utility += 82
    else if (statusId === 'burn') {
      utility += effectiveStat(state, defender, 'attack') >= effectiveStat(state, defender, 'specialAttack') ? 88 : 55
    } else if (statusId === 'paralysis') {
      utility += effectiveStat(state, defender, 'speed') > effectiveStat(state, attacker, 'speed') ? 82 : 58
    } else utility += 56
  }

  const target = move.target === 'self' ? attacker : defender
  if (move.volatileStatus === 'confusion' && target.confusionTurns <= 0 && target.ability !== '마이페이스') utility += 55
  if (move.volatileStatus === 'yawn' && !target.status && target.yawnTurns <= 0) utility += 82
  if (move.volatileStatus === 'destinybond' && hpRatio < 0.4) utility += 76

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
  const effects = move.secondaries ?? (move.secondary ? [move.secondary] : [])
  return effects.reduce((total, effect) => {
    const chance = Math.min(100, Number(effect.chance ?? 100) * (attacker.ability === '하늘의은총' ? 2 : 1)) / 100
    let utility = 0
    const statusId = SHOWDOWN_STATUS_IDS[effect.status] ?? effect.status
    if (statusId && aiCanApplyStatus(state, defender, statusId)) utility += statusId === 'sleep' ? 52 : 30
    if (effect.volatileStatus === 'flinch' && effectiveStat(state, attacker, 'speed') > effectiveStat(state, defender, 'speed')) utility += 34
    if (effect.volatileStatus === 'confusion' && defender.confusionTurns <= 0) utility += 24
    utility += aiStageUtility(defender, effect.boosts, false) * 0.55
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
  const urgency = (state.turn >= 3 ? 8 : 0)
    + (attacker.hp < attacker.maxHp * 0.55 ? 10 : 0)
    + (remainingCount(state.player) <= 2 ? 12 : 0)
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
  const resolved = resolveAiMove(state, attacker, defender, move, gimmick)
  if (!resolved) return { score: -Infinity, estimatedDamage: 0, rawDamage: 0 }
  const resolvedMove = resolved.move
  const projectedAttacker = resolved.attacker
  const targetHp = Math.max(1, Number(context.targetHp ?? defender.hp) || defender.hp)
  const priority = environmentMovePriority(state, projectedAttacker, resolvedMove)

  if (isStatusMove(resolvedMove)) {
    let score = aiStatusMoveScore(state, projectedAttacker, defender, resolvedMove)
    const evaluation = {
      score,
      estimatedDamage: 0,
      rawDamage: 0,
      effectiveness: 1,
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

  const skipsCharge = effectiveWeatherId(state) === 'sun' && ['solarbeam', 'solarblade'].includes(resolvedMove.id)
    || effectiveWeatherId(state) === 'rain' && resolvedMove.id === 'electroshot'
  if (resolvedMove.flags?.includes('charge') && attacker.heldItemId !== 'power-herb' && !skipsCharge && !resolvedMove.isZMove && !resolvedMove.isMaxMove) {
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
    const lastPokemon = remainingCount(state.opponent) <= 1
    if (!knockout) score -= 180
    if (lastPokemon && remainingCount(state.player) > 1) score -= 240
    if (knockout && projectedAttacker.hp < projectedAttacker.maxHp * 0.3) score += 25
  }
  if (resolvedMove.selfSwitch && availableBenchIndexes(state.opponent).length > 0) score += 16
  if (resolvedMove.forceSwitch && availableBenchIndexes(state.player).length > 0) score += 12
  score += aiSecondaryUtility(state, projectedAttacker, defender, resolvedMove)

  const evaluation = {
    score,
    estimatedDamage: Math.min(targetHp, estimate.expectedDamage),
    rawDamage: estimate.rawDamage,
    effectiveness: estimate.effectiveness,
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

function bestAiMoveForPokemon(state, attacker, targetSlots) {
  let best = null
  attacker.moves.forEach((move, moveIndex) => {
    const moveTargetSlots = AI_NON_TARGETED_MOVE_TARGETS.has(move.target) ? targetSlots.slice(0, 1) : targetSlots
    moveTargetSlots.forEach((targetSlot) => {
      const defender = getActivePokemon(state, 'player', targetSlot)
      if (!defender || defender.hp <= 0 || defender.fainted) return
      const evaluation = evaluateAiMove(state, attacker, defender, move)
      if (!best || evaluation.score > best.score) best = { ...evaluation, moveIndex, targetSlot }
    })
  })
  return best
}

function chooseAiSwitch(state, attacker, activeSlot, moveDecision, targetSlots, planning) {
  if (attacker.trappedTurns > 0 || attacker.dynamaxActive) return null
  const switchOptions = availableBenchIndexes(state.opponent)
    .filter((index) => !planning.reservedBenchIndexes?.has(index))
  if (switchOptions.length === 0) return null

  const playerAttackers = targetSlots.map((slot) => getActivePokemon(state, 'player', slot)).filter(Boolean)
  const candidates = switchOptions.map((targetIndex) => {
    const pokemon = state.opponent.team[targetIndex]
    const hazardRatio = aiHazardDamageRatio(state, state.opponent, pokemon)
    if (hazardRatio * pokemon.maxHp >= pokemon.hp) return { targetIndex, score: -Infinity }
    const offense = bestAiMoveForPokemon(state, pokemon, targetSlots)
    const incomingThreat = aiIncomingThreatRatio(state, pokemon, playerAttackers)
    const remainingHpRatio = Math.max(0, pokemon.hp / pokemon.maxHp - hazardRatio)
    return {
      targetIndex,
      score: Math.max(0, offense?.score ?? 0) * 0.58
        + remainingHpRatio * 65
        - incomingThreat * 88
        + aiEntryAbilityUtility(pokemon),
    }
  }).sort((first, second) => second.score - first.score)
  const bestSwitch = candidates[0]
  if (!bestSwitch || !Number.isFinite(bestSwitch.score)) return null

  const currentThreat = aiIncomingThreatRatio(state, attacker, playerAttackers)
  const currentHpRatio = attacker.hp / Math.max(1, attacker.maxHp)
  const stayScore = Math.max(0, moveDecision?.score ?? 0) * 0.62
    + currentHpRatio * 48
    - currentThreat * 82
    + aiPositiveStageTotal(attacker) * 13
  const projectedTargetHp = planning.projectedTargetHp?.get(moveDecision?.action?.targetSlot)
    ?? getActivePokemon(state, 'player', moveDecision?.action?.targetSlot)?.hp
    ?? Infinity
  const canKnockOutBeforeHit = moveDecision?.priority > 0 && moveDecision.rawDamage >= projectedTargetHp
  const urgentSwitch = attacker.perishCount === 1 || attacker.yawnTurns === 1
  const expectedKnockout = currentThreat * attacker.maxHp >= attacker.hp && !canKnockOutBeforeHit
  const badMatchup = !Number.isFinite(moveDecision?.score) || moveDecision.score < 48
  const lowHp = currentHpRatio < 0.34
  const advantage = bestSwitch.score - stayScore

  if (!urgentSwitch && aiPositiveStageTotal(attacker) >= 3) return null
  if (!urgentSwitch && !expectedKnockout && !badMatchup && !lowHp) return null
  if (!urgentSwitch && advantage < (expectedKnockout ? -12 : 12)) return null
  return {
    action: {
      type: 'switch',
      actorSlot: activeSlot,
      targetIndex: bestSwitch.targetIndex,
    },
    score: bestSwitch.score + (urgentSwitch ? 100 : 0),
    estimatedDamage: 0,
    rawDamage: 0,
    priority: 10,
  }
}

function aiTargetSlots(state, fallbackTargetSlot) {
  const slots = getActivePokemonList(state, 'player')
    .map((pokemon, slot) => (pokemon.hp > 0 && !pokemon.fainted ? slot : -1))
    .filter((slot) => slot >= 0)
  return slots.length > 0 ? slots : [fallbackTargetSlot]
}

function chooseAiDecision(state, random, activeSlot, fallbackTargetSlot, planning) {
  const attacker = getActivePokemon(state, 'opponent', activeSlot)
  const targetSlots = aiTargetSlots(state, fallbackTargetSlot)
  if (!attacker) {
    return {
      action: { type: 'move', actorSlot: activeSlot, targetSlot: targetSlots[0] ?? 0, moveIndex: 0, gimmick: null },
      score: -Infinity,
      estimatedDamage: 0,
      rawDamage: 0,
      priority: 0,
    }
  }

  const forcedAction = forcedActionForPokemon(attacker)
  const availableMechanics = forcedAction
    ? []
    : getAvailableBattleMechanics(state, 'opponent', activeSlot)
      .filter((mechanic) => !planning.reservedMechanics?.has(mechanic.id))
  const gimmicks = [null, ...availableMechanics.map((mechanic) => mechanic.id)]
  const moveEntries = forcedAction
    ? [{ move: attacker.moves[forcedAction.moveIndex], moveIndex: forcedAction.moveIndex }]
    : attacker.moves.map((move, moveIndex) => ({ move, moveIndex }))
  const noiseRange = AI_TIER_NOISE[String(state.opponentMeta?.tier ?? 'S').toUpperCase()] ?? 1.4
  const candidates = []

  moveEntries.forEach(({ move, moveIndex }) => {
    if (!move) return
    const moveTargetSlots = AI_NON_TARGETED_MOVE_TARGETS.has(move.target) ? targetSlots.slice(0, 1) : targetSlots
    moveTargetSlots.forEach((targetSlot) => {
      const defender = getActivePokemon(state, 'player', targetSlot)
      if (!defender) return
      const projectedHp = planning.projectedTargetHp?.get(targetSlot) ?? defender.hp
      const targetReserved = targetSlots.length > 1 && projectedHp <= 0
      gimmicks.forEach((gimmick) => {
        const evaluation = evaluateAiMove(state, attacker, defender, move, gimmick, {
          targetHp: Math.max(1, projectedHp),
          targetReserved,
        })
        const score = evaluation.score + (Number.isFinite(evaluation.score) ? random() * noiseRange : 0)
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
  if (forcedAction) return moveDecision

  const switchDecision = chooseAiSwitch(state, attacker, activeSlot, moveDecision, targetSlots, planning)
  return switchDecision ?? moveDecision
}

export function chooseAiAction(state, random = Math.random, activeSlot = 0, targetSlot = 0) {
  return chooseAiDecision(state, random, activeSlot, targetSlot, {
    reservedMechanics: new Set(),
    reservedBenchIndexes: new Set(),
    projectedTargetHp: new Map(),
  }).action
}

function chooseAiActions(state, random) {
  const opponentActive = getActivePokemonList(state, 'opponent')
  const playerActive = getActivePokemonList(state, 'player')
  const livingOpponentSlots = opponentActive
    .map((pokemon, slot) => (pokemon.hp > 0 && !pokemon.fainted ? slot : -1))
    .filter((slot) => slot >= 0)
  const livingPlayerSlots = playerActive
    .map((pokemon, slot) => (pokemon.hp > 0 && !pokemon.fainted ? slot : -1))
    .filter((slot) => slot >= 0)
  const planning = {
    reservedMechanics: new Set(),
    reservedBenchIndexes: new Set(),
    projectedTargetHp: new Map(livingPlayerSlots.map((slot) => [slot, playerActive[slot].hp])),
  }
  const commitDecision = (decision) => {
    if (decision.action.type === 'switch') {
      planning.reservedBenchIndexes.add(decision.action.targetIndex)
      return
    }
    if (decision.action.gimmick) planning.reservedMechanics.add(decision.action.gimmick)
    if (decision.estimatedDamage <= 0) return
    const currentHp = planning.projectedTargetHp.get(decision.action.targetSlot) ?? 0
    planning.projectedTargetHp.set(decision.action.targetSlot, Math.max(0, currentHp - decision.estimatedDamage))
  }

  if (state.rules?.format?.rotation) {
    const decisions = livingOpponentSlots
      .map((activeSlot) => chooseAiDecision(state, random, activeSlot, livingPlayerSlots[0] ?? 0, planning))
      .sort((first, second) => second.score - first.score)
    const decision = decisions[0]
    if (!decision) return []
    commitDecision(decision)
    return [decision.action]
  }

  return livingOpponentSlots.map((activeSlot, index) => {
    const decision = chooseAiDecision(
      state,
      random,
      activeSlot,
      livingPlayerSlots[index % Math.max(1, livingPlayerSlots.length)] ?? 0,
      planning,
    )
    commitDecision(decision)
    return decision.action
  })
}

export function createBattle({ playerPokemon, opponent, opponentTeam, rules = null }) {
  const battleRules = rules ?? {
    weather: { id: 'clear', label: '맑음' },
    terrain: { id: 'neutral', label: '일반 필드' },
    format: { id: 'single', label: '싱글배틀', activeSlots: 1, actionSlots: 1 },
    teamRule: { id: 'full', label: '6대6', battleSize: playerPokemon.length },
    disabledGimmickId: null,
    gimmickRestriction: { id: null, label: '제한 없음' },
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
    eventNonce: 0,
  }

  appendLog(state, `${opponent.name}이(가) 승부를 걸어왔다!`, 'opponent')
  appendLog(state, `${resolvedRules.weather.label} · ${resolvedRules.terrain.label} · ${resolvedRules.format.label}`, 'field')
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

function resolveBattleTurn(state, playerAction, random, captureTimeline) {
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
    })
  })
  const requestedPlayerActions = (Array.isArray(playerAction) ? playerAction : [playerAction]).filter(Boolean)
  const livingPlayerSlots = getActivePokemonList(nextState, 'player')
    .map((pokemon, slot) => (pokemon.hp > 0 && !pokemon.fainted ? slot : -1))
    .filter((slot) => slot >= 0)
  const playerActorSlots = nextState.rules?.format?.rotation
    ? [requestedPlayerActions[0]?.actorSlot ?? nextState.player.rotationSlot ?? 0]
    : livingPlayerSlots
  const resolvedPlayerActions = playerActorSlots.map((actorSlot) => {
    const forcedAction = forcedActionForPokemon(getActivePokemon(nextState, 'player', actorSlot))
    const requestedAction = requestedPlayerActions.find((action) => (action.actorSlot ?? 0) === actorSlot)
    return { ...(forcedAction ?? requestedAction ?? { type: 'move', moveIndex: 0 }), actorSlot }
  })
  const opponentActions = chooseAiActions(nextState, random).map((action) => {
    const forcedAction = forcedActionForPokemon(getActivePokemon(nextState, 'opponent', action.actorSlot))
    return forcedAction ? { ...forcedAction, actorSlot: action.actorSlot, targetSlot: action.targetSlot } : action
  })
  const actions = orderedActions(nextState, resolvedPlayerActions, opponentActions, random)

  for (const [actionOrder, { sideId, action }] of actions.entries()) {
    if (nextState.winner) break
    const actor = getActivePokemon(nextState, sideId, action.actorSlot)
    if (!actor || actor.fainted || actor.hp <= 0) continue
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
    residualEffects(nextState, 'player', timeline, slot)
    markActiveFaints(nextState, timeline)
  })
  opponentResidualSlots.forEach((slot) => {
    residualEffects(nextState, 'opponent', timeline, slot)
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
