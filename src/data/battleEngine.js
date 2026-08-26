import {
  calculateStats,
  getBattleFormOptions,
  getEvolutionOptions,
  getGigantamaxProfile,
  getMove,
  getMoveById,
  getRelatedFormOptions,
  getSpeciesProfile,
  MOVE_CATALOG,
  NATURE_OPTIONS,
  normalizePokemon,
  resolveMoveForPokemon,
} from './trainingData.js'
import { TYPE_FORM_SLUG_BY_KO } from './pokemonFormData.js'
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
import { getBattleItem } from './shopData.js'
import { resolveMaxMove } from './maxMoveData.js'
import {
  CALL_MOVE_IDS,
  FIELD_EFFECT_MOVE_RULES,
  HAZARD_MOVE_RULES,
  HEAL_MOVE_IDS,
  MOVE_DAMAGE_STAT_RULES,
  NO_EFFECT_MOVE_IDS,
  PROTECT_CONTACT_EFFECTS,
  PROTECT_MOVE_IDS,
  SIDE_CONDITION_MOVE_RULES,
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
const PLEDGE_MOVE_IDS = new Set(['firepledge', 'grasspledge', 'waterpledge'])

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
const NEUTRALIZING_GAS_IMMUNE_ABILITIES = new Set([
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
  '절대안깸',
  '제로포밍',
  '테라체인지',
  '탈',
  '화학변화가스',
])
const RAIN_PERFECT_ACCURACY_MOVE_IDS = new Set([
  'bleakwindstorm',
  'hurricane',
  'sandsearstorm',
  'thunder',
  'wildboltstorm',
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
  skydrop: '상대를 붙잡고 하늘 높이 날아올랐다!',
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

const HELD_ITEM_FORM_RULES = Object.freeze({
  'adamant-crystal': { species: 'dialga', form: 'dialga-origin' },
  'burn-drive': { species: 'genesect', form: 'genesect-burn' },
  'chill-drive': { species: 'genesect', form: 'genesect-chill' },
  'cornerstone-mask': { species: 'ogerpon', form: 'ogerpon-cornerstone-mask' },
  'douse-drive': { species: 'genesect', form: 'genesect-douse' },
  'griseous-core': { species: 'giratina', form: 'giratina-origin' },
  'hearthflame-mask': { species: 'ogerpon', form: 'ogerpon-hearthflame-mask' },
  'lustrous-globe': { species: 'palkia', form: 'palkia-origin' },
  'rusted-shield': { species: 'zamazenta', form: 'zamazenta-crowned' },
  'rusted-sword': { species: 'zacian', form: 'zacian-crowned' },
  'shock-drive': { species: 'genesect', form: 'genesect-shock' },
  'wellspring-mask': { species: 'ogerpon', form: 'ogerpon-wellspring-mask' },
})

const OGERPON_TERA_FORM_RULES = Object.freeze({
  ogerpon: { form: 'ogerpon-teal-tera', teraType: '풀', boost: { speed: 1 } },
  'ogerpon-wellspring-mask': {
    form: 'ogerpon-wellspring-tera',
    teraType: '물',
    boost: { specialDefense: 1 },
  },
  'ogerpon-hearthflame-mask': {
    form: 'ogerpon-hearthflame-tera',
    teraType: '불꽃',
    boost: { attack: 1 },
  },
  'ogerpon-cornerstone-mask': {
    form: 'ogerpon-cornerstone-tera',
    teraType: '바위',
    boost: { defense: 1 },
  },
})

const ENTRY_BATTLE_MODE_FORM_RULES = Object.freeze({
  'koraidon-limited-build': 'koraidon',
  'koraidon-sprinting-build': 'koraidon',
  'koraidon-swimming-build': 'koraidon',
  'koraidon-gliding-build': 'koraidon',
  'miraidon-low-power-mode': 'miraidon',
  'miraidon-drive-mode': 'miraidon',
  'miraidon-aquatic-mode': 'miraidon',
  'miraidon-glide-mode': 'miraidon',
})

function showdownVisualForm(speciesId, slug, name) {
  return Object.freeze({
    speciesId,
    slug,
    name,
    spriteFront: `https://play.pokemonshowdown.com/sprites/gen5ani/${slug}.gif`,
    spriteBack: `https://play.pokemonshowdown.com/sprites/gen5ani-back/${slug}.gif`,
    spriteFrontFallback: `https://play.pokemonshowdown.com/sprites/gen5/${slug}.png`,
    spriteBackFallback: `https://play.pokemonshowdown.com/sprites/gen5-back/${slug}.png`,
  })
}

const VISUAL_BATTLE_FORM_OVERRIDES = Object.freeze({
  'cherrim-sunshine': showdownVisualForm(421, 'cherrim-sunshine', '체리꼬 포지폼'),
  'genesect-burn': showdownVisualForm(649, 'genesect-burn', '게노세크트'),
  'genesect-chill': showdownVisualForm(649, 'genesect-chill', '게노세크트'),
  'genesect-douse': showdownVisualForm(649, 'genesect-douse', '게노세크트'),
  'genesect-shock': showdownVisualForm(649, 'genesect-shock', '게노세크트'),
})

const FORM_TIMELINE_CONTEXTS = new WeakMap()

export function getConditionalBattleFormAssets(pokemon) {
  const baseSpeciesId = Number(
    pokemon?.battleBaseSpeciesId
    ?? pokemon?.originalSpeciesId
    ?? pokemon?.speciesId
    ?? pokemon,
  )
  return Object.values(VISUAL_BATTLE_FORM_OVERRIDES)
    .filter((form) => Number(form.speciesId) === baseSpeciesId)
    .flatMap((form) => [
      form.spriteFront,
      form.spriteBack,
      form.spriteFrontFallback,
      form.spriteBackFallback,
    ])
}

const CALL_MOVE_BLOCKLIST = new Set([
  'assist',
  'copycat',
  'instruct',
  'mefirst',
  'metronome',
  'mimic',
  'mirrormove',
  'sketch',
  'sleeptalk',
  'struggle',
  'transform',
])

const BERRY_HEALING_FRACTIONS = {
  'aguav-berry': [1, 3],
  'figy-berry': [1, 3],
  'iapapa-berry': [1, 3],
  'mago-berry': [1, 3],
  'oran-berry': [10, 1],
  'sitrus-berry': [1, 4],
  'wiki-berry': [1, 3],
}
const FLAVOR_BERRY_DISLIKED_STATS = {
  'aguav-berry': 'specialDefense',
  'figy-berry': 'attack',
  'iapapa-berry': 'defense',
  'mago-berry': 'speed',
  'wiki-berry': 'specialAttack',
}

const TYPE_BOOST_ITEM_IDS = {
  'black-belt': '격투',
  'black-glasses': '악',
  charcoal: '불꽃',
  'dragon-fang': '드래곤',
  'fairy-feather': '페어리',
  'hard-stone': '바위',
  magnet: '전기',
  'metal-coat': '강철',
  'miracle-seed': '풀',
  'mystic-water': '물',
  'never-melt-ice': '얼음',
  'poison-barb': '독',
  'sharp-beak': '비행',
  'silk-scarf': '노말',
  'silver-powder': '벌레',
  'soft-sand': '땅',
  'spell-tag': '고스트',
  'twisted-spoon': '에스퍼',
}

const GEM_ITEM_TYPES = Object.fromEntries(Object.entries(HELD_ITEM_TYPE_BY_ID)
  .filter(([itemId]) => itemId.endsWith('-gem')))

const TYPE_RESIST_BERRY_TYPES = {
  'babiri-berry': '강철',
  'charti-berry': '바위',
  'chilan-berry': '노말',
  'chople-berry': '격투',
  'coba-berry': '비행',
  'colbur-berry': '악',
  'haban-berry': '드래곤',
  'kasib-berry': '고스트',
  'kebia-berry': '독',
  'occa-berry': '불꽃',
  'passho-berry': '물',
  'payapa-berry': '에스퍼',
  'rindo-berry': '풀',
  'roseli-berry': '페어리',
  'shuca-berry': '땅',
  'tanga-berry': '벌레',
  'wacan-berry': '전기',
  'yache-berry': '얼음',
}

const CHOICE_ITEM_IDS = new Set(['choice-band', 'choice-scarf', 'choice-specs'])
const PARADOX_SPECIES_SLUGS = new Set([
  'brute-bonnet',
  'flutter-mane',
  'gouging-fire',
  'great-tusk',
  'iron-boulder',
  'iron-bundle',
  'iron-crown',
  'iron-hands',
  'iron-jugulis',
  'iron-leaves',
  'iron-moth',
  'iron-thorns',
  'iron-treads',
  'iron-valiant',
  'raging-bolt',
  'roaring-moon',
  'sandy-shocks',
  'scream-tail',
  'slither-wing',
  'walking-wake',
])

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
    gender: normalized.gender ?? entry.gender ?? null,
    yawnTurns: 0,
    perishCount: null,
    destinyBondActive: false,
    trappedTurns: 0,
    trapSourceName: null,
    trapSourceBattleId: null,
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
    skyDropSourceBattleId: null,
    skyDropTargetBattleId: null,
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
    switchingOut: false,
    truantLoafing: false,
    flashFireActive: false,
    chargeActive: false,
    defenseCurlActive: false,
    minimized: false,
    rageActive: false,
    uproarTurns: 0,
    bideState: null,
    roostedThisTurn: false,
    smackDownActive: false,
    tarShotActive: false,
    glaiveRushVulnerable: false,
    noRetreatActive: false,
    custapActive: false,
    micleActive: false,
    gorillaLockedMoveIndex: null,
    choiceLockedMoveIndex: null,
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
    substituteHp: 0,
    leechSeedSourceSideId: null,
    leechSeedSourceSlot: null,
    nightmareActive: false,
    cursedActive: false,
    stockpileCount: 0,
    stockpileBoosts: { defense: 0, specialDefense: 0 },
    encoredMoveIndex: null,
    encoreTurns: 0,
    tauntTurns: 0,
    embargoTurns: 0,
    ingrainActive: false,
    aquaRingActive: false,
    magnetRiseTurns: 0,
    telekinesisTurns: 0,
    abilitySuppressed: false,
    originalAbility: normalized.ability,
    magicCoatActive: false,
    snatchActive: false,
    imprisonActive: false,
    grudgeActive: false,
    ejectPackPending: false,
    helpingHandActive: false,
    powderActive: false,
    electrifyActive: false,
    laserFocusActive: false,
    octolockActive: false,
    dragonCheerTurns: 0,
    sureHitTargetBattleId: null,
    sureHitTurns: 0,
    foresightActive: false,
    miracleEyeActive: false,
    lastMoveId: null,
    lastDamageTaken: 0,
    lastDamageCategory: null,
    lastAttackerBattleId: null,
    damagedThisTurn: false,
    hitByPhysicalThisTurn: false,
    hitCountTaken: 0,
    moveFailedLastTurn: false,
    moveFailedThisTurn: false,
    consecutiveMoveId: null,
    consecutiveMoveCount: 0,
    usedMoveIds: [],
    ateBerry: false,
    statsLoweredThisTurn: false,
    plannedActionType: null,
    plannedMoveId: null,
    plannedMoveCategory: null,
    plannedMovePriority: null,
    beakBlastCharging: false,
    typeRemovedByMove: false,
    neutralizedAbility: null,
    pendingShedTailHp: 0,
    nextTurnOrderBias: 0,
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
    wishSlots: {},
    futureMoveSlots: {},
    pendingPledge: null,
    pledgeComboPlanned: false,
    firePledgeTurns: 0,
    grassPledgeTurns: 0,
    waterPledgeTurns: 0,
    roundUsedThisTurn: false,
    allyFaintedThisTurn: false,
    allyFaintedLastTurn: false,
    zHealReplacement: false,
    auroraVeilTurns: 0,
    lightScreenTurns: 0,
    reflectTurns: 0,
    safeguardTurns: 0,
    mistTurns: 0,
    tailwindTurns: 0,
    luckyChantTurns: 0,
    wideGuardTurns: 0,
    quickGuardTurns: 0,
    craftyShieldTurns: 0,
    matBlockTurns: 0,
    gmaxResidual: null,
    hazards: {
      stealthRock: false,
      steelsurge: false,
      toxicSpikes: 0,
      spikes: 0,
      stickyWeb: false,
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
    trickRoomTurns: 0,
    wonderRoomTurns: 0,
    magicRoomTurns: 0,
    mudSportTurns: 0,
    waterSportTurns: 0,
    fairyLockTurns: 0,
    ionDelugeTurns: 0,
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
    && pokemon.ability !== '서투름'
    && pokemon.embargoTurns <= 0
    && !pokemon.magicRoomSuppressed,
  )
}

function hasHeldItem(pokemon, itemId = null) {
  return Boolean(
    pokemon
    && pokemon.heldItemId
    && !pokemon.consumedItem
    && (itemId == null || pokemon.heldItemId === itemId),
  )
}

function hasActiveHeldItem(pokemon, itemId) {
  return heldItemEffectsActive(pokemon) && pokemon.heldItemId === itemId
}

function baseSpeciesProfile(pokemon) {
  const speciesId = Number(
    pokemon?.battleBaseSpeciesId
    ?? pokemon?.originalSpeciesId
    ?? pokemon?.speciesId,
  )
  return getSpeciesProfile(speciesId)
}

function pokemonMatchesSpecies(pokemon, speciesSlug) {
  const slug = baseSpeciesProfile(pokemon)?.slug ?? currentSpeciesSlug(pokemon)
  return slug === speciesSlug || slug.startsWith(`${speciesSlug}-`)
}

function megaStoneMatchesPokemon(item, pokemon) {
  if (!item || item.sourceCategory !== 'mega-stones' || !pokemon) return false
  const profile = baseSpeciesProfile(pokemon)
  if (!profile) return false
  if (item.compatiblePokemon) return item.compatiblePokemon === profile.name
  return String(item.description ?? '').includes(`${profile.name}에게`)
}

function itemCannotBeRemoved(holder, recipient = null) {
  if (!hasHeldItem(holder)) return false
  const itemId = holder.heldItemId
  const item = getBattleItem(itemId)
  const pokemon = [holder, recipient].filter(Boolean)
  const matchesAny = (speciesSlug) => pokemon.some((entry) => pokemonMatchesSpecies(entry, speciesSlug))

  if (item?.sourceCategory === 'z-crystals' || /ium-z(?:--held)?$/.test(itemId)) return true
  if (item?.sourceCategory === 'mega-stones') {
    return pokemon.some((entry) => megaStoneMatchesPokemon(item, entry))
  }
  if (itemId.endsWith('-plate') && matchesAny('arceus')) return true
  if (itemId.endsWith('-memory') && matchesAny('silvally')) return true
  if (itemId.endsWith('-drive') && matchesAny('genesect')) return true
  if (itemId.endsWith('-mask') && matchesAny('ogerpon')) return true
  if (itemId === 'blue-orb' && matchesAny('kyogre')) return true
  if (itemId === 'red-orb' && matchesAny('groudon')) return true
  if (['griseous-core'].includes(itemId) && matchesAny('giratina')) return true
  if (['adamant-crystal'].includes(itemId) && matchesAny('dialga')) return true
  if (['lustrous-globe'].includes(itemId) && matchesAny('palkia')) return true
  if (itemId === 'rusted-sword' && matchesAny('zacian')) return true
  if (itemId === 'rusted-shield' && matchesAny('zamazenta')) return true
  if (itemId === 'booster-energy') {
    return pokemon.some((entry) => PARADOX_SPECIES_SLUGS.has(baseSpeciesProfile(entry)?.slug))
  }
  return false
}

function canRemoveHeldItem(holder, recipient = null, { ignoreHolderAbility = false } = {}) {
  return hasHeldItem(holder)
    && (ignoreHolderAbility || holder.ability !== '점착')
    && !itemCannotBeRemoved(holder, recipient)
}

function isPokemonAsleep(pokemon) {
  return pokemon?.status?.id === 'sleep' || pokemon?.ability === '절대안깸'
}

function restSleepBlocked(state, pokemon) {
  return SLEEP_IMMUNE_ABILITIES.has(pokemon?.ability)
    || activeAllyHasAbility(state, pokemon, new Set(['스위트베일']))
    || isGrounded(pokemon, state) && state.rules?.terrain?.id === 'electric'
}

function moveIgnoresAbility(move, pokemon) {
  return Boolean(move?.ignoreAbility) && !hasActiveHeldItem(pokemon, 'ability-shield')
}

function clearHeldItem(pokemon) {
  pokemon.heldItemId = ''
  pokemon.heldItemName = ''
  pokemon.consumedItem = false
}

function activateSymbiosis(state, recipient) {
  if (!recipient || hasHeldItem(recipient)) return false
  const side = getPokemonSide(state, recipient)
  const donor = getActivePokemonList(state, side.id).find((ally) => (
    ally
    && ally.battleId !== recipient.battleId
    && !ally.fainted
    && ally.hp > 0
    && ally.ability === '공생'
    && canRemoveHeldItem(ally, recipient)
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
  if (berry) pokemon.ateBerry = true
  state.lastConsumedItem = consumedItem
  if (berry && pokemon.ability === '되새김질') {
    pokemon.cudChewReadyTurn = state.turn + 1
    pokemon.cudChewItemId = consumedItem.id
    pokemon.cudChewItemName = consumedItem.name
  }
  activateSymbiosis(state, pokemon)
  return true
}

function activateWhiteHerb(state, pokemon) {
  if (!hasActiveHeldItem(pokemon, 'white-herb')) return false
  if (!clearNegativeStatStages(pokemon)) return false
  consumeHeldItem(state, pokemon)
  appendLog(state, `${pokemon.name}은(는) 하양허브로 떨어진 능력을 되돌렸다!`, 'item')
  return true
}

function clearNegativeStatStages(pokemon) {
  const loweredStats = Object.keys(pokemon.statStages)
    .filter((statKey) => pokemon.statStages[statKey] < 0)
  loweredStats.forEach((statKey) => { pokemon.statStages[statKey] = 0 })
  return loweredStats.length > 0
}

function clearMentalHerbConditions(pokemon) {
  const affected = pokemon.infatuated
    || pokemon.tauntTurns > 0
    || pokemon.encoreTurns > 0
    || pokemon.tormented
    || pokemon.disabledMoveTurns > 0
    || pokemon.healBlockTurns > 0
  if (!affected) return false
  pokemon.infatuated = false
  pokemon.tauntTurns = 0
  pokemon.encoreTurns = 0
  pokemon.encoredMoveIndex = null
  pokemon.tormented = false
  pokemon.disabledMoveTurns = 0
  pokemon.disabledMoveIndex = null
  pokemon.healBlockTurns = 0
  return true
}

function activateMentalHerb(state, pokemon) {
  if (!hasActiveHeldItem(pokemon, 'mental-herb')) return false
  if (!clearMentalHerbConditions(pokemon)) return false
  consumeHeldItem(state, pokemon)
  appendLog(state, `${pokemon.name}은(는) 멘탈허브로 정신을 가다듬었다!`, 'item')
  return true
}

function restoreLeppaBerryPp(state, pokemon, move) {
  if (
    !move
    || move.currentPp > 0
    || !hasActiveHeldItem(pokemon, 'leppa-berry')
    || berriesSuppressed(state, pokemon)
  ) return false
  const restored = Math.min(move.maxPp - move.currentPp, 10 * berryEffectMultiplier(pokemon))
  if (restored <= 0) return false
  consumeHeldItem(state, pokemon, { berry: true })
  move.currentPp += restored
  appendLog(state, `${pokemon.name}은(는) 과사열매로 ${move.name}의 PP를 ${restored} 회복했다!`, 'item')
  applyCheekPouch(state, pokemon)
  return true
}

function stealHeldItem(state, thief, holder, sourceName, { ignoreHolderAbility = false } = {}) {
  if (
    !thief
    || !holder
    || hasHeldItem(thief)
    || !canRemoveHeldItem(holder, thief, { ignoreHolderAbility })
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
  return pokemon
    && !ABILITY_CHANGE_IMMUNE_NAMES.has(pokemon.ability)
    && !hasActiveHeldItem(pokemon, 'ability-shield')
}

function suppressPokemonAbility(state, pokemon, sourceName) {
  if (!abilityCanBeChanged(pokemon) || pokemon.abilitySuppressed || !pokemon.ability) return false
  pokemon.originalAbility = pokemon.ability
  pokemon.abilitySuppressed = true
  pokemon.ability = ''
  appendLog(state, `${pokemon.name}의 특성 효과가 사라졌다!`, sourceName === '화학변화가스' ? 'ability' : 'status')
  return true
}

function refreshNeutralizingGas(state, { reactivate = true } = {}) {
  if (!state || state.neutralizingGasRefreshActive) return false
  state.neutralizingGasRefreshActive = true
  const activeEntries = ['player', 'opponent'].flatMap((sideId) => (
    getActivePokemonList(state, sideId).map((pokemon, activeSlot) => ({ sideId, activeSlot, pokemon }))
  )).filter(({ pokemon }) => pokemon && !pokemon.fainted && pokemon.hp > 0)
  const gasActive = activeEntries.some(({ pokemon }) => pokemon.ability === '화학변화가스')
  const restoredEntries = []
  let changed = false

  activeEntries.forEach(({ sideId, activeSlot, pokemon }) => {
    if (gasActive) {
      if (pokemon.neutralizedAbility && hasActiveHeldItem(pokemon, 'ability-shield')) {
        pokemon.ability = pokemon.neutralizedAbility
        pokemon.neutralizedAbility = null
        appendLog(state, `${pokemon.name}의 특성이 특성가드로 보호되었다!`, 'item')
        restoredEntries.push({ sideId, activeSlot, pokemon })
        changed = true
        return
      }
      if (
        pokemon.neutralizedAbility
        || pokemon.abilitySuppressed
        || !pokemon.ability
        || NEUTRALIZING_GAS_IMMUNE_ABILITIES.has(pokemon.ability)
        || hasActiveHeldItem(pokemon, 'ability-shield')
      ) return
      pokemon.neutralizedAbility = pokemon.ability
      pokemon.ability = ''
      breakIllusion(state, pokemon)
      appendLog(state, `${pokemon.name}의 특성 효과가 화학변화가스에 의해 사라졌다!`, 'ability')
      changed = true
      return
    }

    if (!pokemon.neutralizedAbility) return
    pokemon.ability = pokemon.neutralizedAbility
    pokemon.neutralizedAbility = null
    appendLog(state, `${pokemon.name}의 ${pokemon.ability} 효과가 되돌아왔다!`, 'ability')
    restoredEntries.push({ sideId, activeSlot, pokemon })
    changed = true
  })

  state.neutralizingGasRefreshActive = false
  if (changed) {
    refreshStrongWeatherSource(state)
    refreshEnvironmentDependentAbilities(state)
  }
  if (reactivate) {
    restoredEntries.forEach(({ sideId, activeSlot, pokemon }) => {
      if (pokemon.hp > 0 && !pokemon.fainted) activateEntryAbility(state, sideId, activeSlot)
    })
  }
  return changed
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
  const previousSnapshot = mechanicPokemonSnapshot(pokemon)
  restoreIllusion(pokemon)
  appendLog(state, `${pokemon.name}의 일루전이 깨졌다!`, 'ability')
  emitFormChangeTimeline(state, pokemon, previousSnapshot, '일루전')
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
  const weatherId = pokemon?.ability === '메가솔라' ? 'sun' : effectiveWeatherId(state)
  return hasActiveHeldItem(pokemon, 'utility-umbrella')
    && ['sun', 'rain', 'desolateland', 'primordialsea'].includes(weatherId)
    ? 'clear'
    : weatherId
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
    stockpileBoosts: { ...(pokemon.stockpileBoosts ?? {}) },
    chargingMove: pokemon.chargingMove ? { ...pokemon.chargingMove } : null,
    lockedMove: pokemon.lockedMove ? { ...pokemon.lockedMove } : null,
    bideState: pokemon.bideState ? { ...pokemon.bideState } : null,
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
    wishSlots: Object.fromEntries(Object.entries(side.wishSlots ?? {})
      .map(([slot, wish]) => [slot, { ...wish }])),
    futureMoveSlots: Object.fromEntries(Object.entries(side.futureMoveSlots ?? {})
      .map(([slot, futureMove]) => [slot, {
        ...futureMove,
        move: { ...futureMove.move },
        sourceSnapshot: futureMove.sourceSnapshot ? clonePokemon(futureMove.sourceSnapshot) : null,
      }])),
    pendingPledge: side.pendingPledge ? { ...side.pendingPledge } : null,
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
    lastUsedMove: state.lastUsedMove ? { ...state.lastUsedMove } : null,
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

function activePokemonLocation(state, pokemon) {
  for (const sideId of ['player', 'opponent']) {
    const side = state[sideId]
    const activeSlot = (side.activeIndexes ?? [side.activeIndex])
      .findIndex((teamIndex) => side.team[teamIndex]?.battleId === pokemon?.battleId)
    if (activeSlot >= 0) return { sideId, activeSlot }
  }
  return null
}

function emitFormChangeTimeline(state, pokemon, previousSnapshot, sourceName, options = {}) {
  if (options.animate === false) return
  const context = FORM_TIMELINE_CONTEXTS.get(state)
  const location = context ? activePokemonLocation(state, pokemon) : null
  if (!context || !location) return

  const currentSnapshot = mechanicPokemonSnapshot(pokemon)
  const mechanicId = options.mechanicId ?? 'form'
  const fallbackMessage = `${previousSnapshot.name}이(가) ${sourceName || '폼체인지'}로 모습을 바꿨다!`
  const step = {
    phase: 'form',
    sideId: location.sideId,
    targetSideId: location.sideId,
    actorSlot: location.activeSlot,
    targetSlot: location.activeSlot,
    actorName: currentSnapshot.name,
    actorSpeciesId: currentSnapshot.speciesId,
    actorOriginalSpeciesId: currentSnapshot.originalSpeciesId,
    actorPreviousName: previousSnapshot.name,
    mechanicId,
    mechanicLabel: sourceName || '폼체인지',
    formSourceName: sourceName || '폼체인지',
    spriteBeforeFront: previousSnapshot.spriteFront,
    spriteBeforeBack: previousSnapshot.spriteBack,
    spriteBeforeFrontFallback: previousSnapshot.spriteFrontFallback,
    spriteBeforeBackFallback: previousSnapshot.spriteBackFallback,
    spriteAfterFront: currentSnapshot.spriteFront,
    spriteAfterBack: currentSnapshot.spriteBack,
    spriteAfterFrontFallback: currentSnapshot.spriteFrontFallback,
    spriteAfterBackFallback: currentSnapshot.spriteBackFallback,
    message: options.log === false ? fallbackMessage : latestLogMessage(state, fallbackMessage),
  }

  if (options.deferTimeline) context.deferred.push(step)
  else pushTimelineStep(context.timeline, state, step)
}

function flushDeferredFormTimeline(state) {
  const context = FORM_TIMELINE_CONTEXTS.get(state)
  if (!context?.deferred.length) return
  context.deferred.splice(0).forEach((step) => pushTimelineStep(context.timeline, state, step))
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

function secondaryEffectChance(state, attacker, effect) {
  const sereneGraceMultiplier = attacker.ability === '하늘의은총' ? 2 : 1
  const rainbowMultiplier = getPokemonSide(state, attacker).waterPledgeTurns > 0 ? 2 : 1
  const multiplier = effect?.volatileStatus === 'flinch'
    ? Math.max(sereneGraceMultiplier, rainbowMultiplier)
    : sereneGraceMultiplier * rainbowMultiplier
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

function canStillEvolve(pokemon) {
  const speciesId = Number(pokemon.battleBaseSpeciesId ?? pokemon.originalSpeciesId ?? pokemon.speciesId)
  return getEvolutionOptions(speciesId).some((profile) => Number(profile.evolvesFrom) === speciesId)
}

function effectiveStat(state, pokemon, statKey, { ignoreStages = false, stageOverride = null } = {}) {
  const resolvedStatKey = state.environment?.wonderRoomTurns > 0
    && statKey === 'defense'
    ? 'specialDefense'
    : state.environment?.wonderRoomTurns > 0 && statKey === 'specialDefense'
      ? 'defense'
      : statKey
  const stage = stageOverride == null ? pokemon.statStages[statKey] ?? 0 : stageOverride
  let value = pokemon.stats[resolvedStatKey]
    * (ignoreStages ? 1 : stageMultiplier(stage))
  const activeWeatherId = effectiveMoveWeatherId(state, pokemon)
  const weatherId = weatherFamilyId(activeWeatherId)
  const terrainId = state.rules?.terrain?.id

  if (statKey === 'speed' && pokemon.status?.id === 'paralysis' && pokemon.ability !== '속보') value *= 0.5
  if (statKey === 'speed' && hasActiveHeldItem(pokemon, 'choice-scarf')) value *= 1.5
  if (statKey === 'speed' && hasActiveHeldItem(pokemon, 'iron-ball')) value *= 0.5
  if (statKey === 'speed' && getPokemonSide(state, pokemon).grassPledgeTurns > 0) value *= 0.25
  if (
    statKey === 'speed'
    && hasActiveHeldItem(pokemon, 'quick-powder')
    && currentSpeciesSlug(pokemon) === 'ditto'
    && !pokemon.transformSnapshot
  ) value *= 2
  if (statKey === 'speed' && getPokemonSide(state, pokemon).tailwindTurns > 0) value *= 2
  if (statKey === 'speed' && weatherId === 'sun' && pokemon.ability === '엽록소') value *= 2
  if (statKey === 'speed' && weatherId === 'rain' && pokemon.ability === '쓱쓱') value *= 2
  if (statKey === 'speed' && weatherId === 'sandstorm' && pokemon.ability === '모래헤치기') value *= 2
  if (statKey === 'speed' && weatherId === 'snow' && pokemon.ability === '눈치우기') value *= 2
  if (statKey === 'speed' && terrainId === 'electric' && pokemon.ability === '서핑테일') value *= 2
  if (statKey === 'attack' && hasActiveHeldItem(pokemon, 'choice-band')) value *= 1.5
  if (
    statKey === 'attack'
    && hasActiveHeldItem(pokemon, 'thick-club')
    && ['cubone', 'marowak', 'marowak-alola'].includes(currentSpeciesSlug(pokemon))
  ) value *= 2
  if (
    ['attack', 'specialAttack'].includes(statKey)
    && hasActiveHeldItem(pokemon, 'light-ball')
    && currentSpeciesSlug(pokemon).startsWith('pikachu')
  ) value *= 2
  if (statKey === 'attack' && ['순수한힘', '천하장사'].includes(pokemon.ability)) value *= 2
  if (statKey === 'attack' && pokemon.ability === '무아지경' && !pokemon.dynamaxActive) value *= 1.5
  if (statKey === 'attack' && activeWeatherId === 'sun' && pokemon.ability === '진홍빛고동') value *= 4 / 3
  if (statKey === 'specialAttack' && hasActiveHeldItem(pokemon, 'choice-specs')) value *= 1.5
  if (
    statKey === 'specialAttack'
    && hasActiveHeldItem(pokemon, 'deep-sea-tooth')
    && currentSpeciesSlug(pokemon) === 'clamperl'
  ) value *= 2
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
  if (
    ['defense', 'specialDefense'].includes(statKey)
    && hasActiveHeldItem(pokemon, 'eviolite')
    && canStillEvolve(pokemon)
  ) value *= 1.5
  if (
    statKey === 'specialDefense'
    && hasActiveHeldItem(pokemon, 'deep-sea-scale')
    && currentSpeciesSlug(pokemon) === 'clamperl'
  ) value *= 2
  if (
    statKey === 'defense'
    && hasActiveHeldItem(pokemon, 'metal-powder')
    && currentSpeciesSlug(pokemon) === 'ditto'
    && !pokemon.transformSnapshot
  ) value *= 2
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
  if (move.id === 'struggle') return 1
  const bypassGhostImmunity = (['배짱', '심안'].includes(attacker.ability) || defender.foresightActive)
    && ['노말', '격투'].includes(move.type)
  const strongWinds = effectiveWeatherId(state) === 'deltastream'
  const defenderTypes = defender.roostedThisTurn
    ? defender.types.filter((type) => type !== '비행')
    : defender.types
  const standardMultiplier = defenderTypes.reduce((multiplier, defenderType) => {
    let typeMultiplier = TYPE_CHART[move.type]?.[defenderType] ?? 1
    if (move.id === 'freezedry' && defenderType === '물') typeMultiplier = 2
    if (bypassGhostImmunity && defenderType === '고스트' && typeMultiplier === 0) typeMultiplier = 1
    if (defender.miracleEyeActive && move.type === '에스퍼' && defenderType === '악' && typeMultiplier === 0) {
      typeMultiplier = 1
    }
    if (move.id === 'thousandarrows' && move.type === '땅' && defenderType === '비행' && typeMultiplier === 0) {
      typeMultiplier = 1
    }
    if (hasActiveHeldItem(defender, 'ring-target') && typeMultiplier === 0) typeMultiplier = 1
    if (strongWinds && defenderType === '비행' && typeMultiplier > 1) typeMultiplier = 1
    const flyingPressMultiplier = move.id === 'flyingpress'
      ? TYPE_CHART['비행']?.[defenderType] ?? 1
      : 1
    return multiplier * typeMultiplier * flyingPressMultiplier
  }, 1)
  const tarShotMultiplier = defender.tarShotActive && move.type === '불꽃' ? 2 : 1
  const resolvedMultiplier = standardMultiplier * tarShotMultiplier
  if (!state?.rules?.format?.inverse) return resolvedMultiplier
  if (resolvedMultiplier === 0) return 2
  return 1 / resolvedMultiplier
}

function isGrounded(pokemon, state = null) {
  if (state?.environment?.gravityTurns > 0) return true
  if (hasActiveHeldItem(pokemon, 'iron-ball')) return true
  if (pokemon.smackDownActive || pokemon.roostedThisTurn) return true
  if (pokemon.magnetRiseTurns > 0 || pokemon.telekinesisTurns > 0 || hasActiveHeldItem(pokemon, 'air-balloon')) {
    return false
  }
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
    ignoreAbility: moveIgnoresAbility(move, defender),
  })
  if (TARGET_WEIGHT_POWER_MOVE_IDS.has(move.id)) return targetWeightMovePower(defenderWeight)
  if (WEIGHT_RATIO_POWER_MOVE_IDS.has(move.id)) {
    return weightRatioMovePower(effectivePokemonWeight(attacker), defenderWeight)
  }
  return null
}

function positiveStageTotal(pokemon) {
  return Object.values(pokemon.statStages ?? {})
    .reduce((total, stage) => total + Math.max(0, Number(stage) || 0), 0)
}

function lowHpVariablePower(pokemon) {
  const ratio = 48 * pokemon.hp / Math.max(1, pokemon.maxHp)
  if (ratio <= 1) return 200
  if (ratio <= 4) return 150
  if (ratio <= 9) return 100
  if (ratio <= 16) return 80
  if (ratio <= 32) return 40
  return 20
}

function consecutiveMovePower(attacker, moveId, basePower, maximumMultiplier) {
  const count = attacker.consecutiveMoveId === moveId
    ? Math.max(1, (attacker.consecutiveMoveCount ?? 0) + 1)
    : 1
  return Math.min(basePower * maximumMultiplier, basePower * 2 ** (count - 1))
}

function variableMovePower(state, attacker, defender, move) {
  const attackerSpeed = effectiveStat(state, attacker, 'speed')
  const defenderSpeed = effectiveStat(state, defender, 'speed')
  const attackerSide = getPokemonSide(state, attacker)
  const faintedAllies = attackerSide.team.filter((pokemon) => pokemon.fainted || pokemon.hp <= 0).length

  if (['flail', 'reversal'].includes(move.id)) return lowHpVariablePower(attacker)
  if (['return', 'frustration', 'pikapapow', 'veeveevolley'].includes(move.id)) return 102
  if (['eruption', 'waterspout', 'dragonenergy'].includes(move.id)) {
    return Math.max(1, Math.floor(150 * attacker.hp / Math.max(1, attacker.maxHp)))
  }
  if (['crushgrip', 'wringout'].includes(move.id)) {
    return Math.max(1, Math.floor(120 * defender.hp / Math.max(1, defender.maxHp)) + 1)
  }
  if (move.id === 'hardpress') {
    return Math.max(1, Math.floor(100 * defender.hp / Math.max(1, defender.maxHp)))
  }
  if (move.id === 'gyroball') return Math.min(150, Math.max(1, Math.floor(25 * defenderSpeed / attackerSpeed) + 1))
  if (move.id === 'electroball') {
    const ratio = attackerSpeed / Math.max(1, defenderSpeed)
    if (ratio >= 4) return 150
    if (ratio >= 3) return 120
    if (ratio >= 2) return 80
    if (ratio >= 1) return 60
    return 40
  }
  if (move.id === 'punishment') return Math.min(200, 60 + 20 * positiveStageTotal(defender))
  if (['powertrip', 'storedpower'].includes(move.id)) return 20 + 20 * positiveStageTotal(attacker)
  if (move.id === 'lastrespects') return Math.min(5050, 50 + 50 * faintedAllies)
  if (move.id === 'ragefist') return Math.min(350, 50 + 50 * (attacker.hitCountTaken ?? 0))
  if (move.id === 'spitup') return Math.max(1, 100 * (attacker.stockpileCount ?? 0))
  if (move.id === 'trumpcard') {
    const remainingPp = Math.max(0, Number(move.currentPp) || 0)
    return remainingPp <= 1 ? 200 : remainingPp === 2 ? 80 : remainingPp === 3 ? 60 : remainingPp === 4 ? 50 : 40
  }
  if (move.id === 'acrobatics' && !hasHeldItem(attacker)) return 110
  if (move.id === 'assurance' && defender.damagedThisTurn) return 120
  if (move.id === 'pursuit' && defender.switchingOut) return 80
  if (['avalanche', 'revenge'].includes(move.id) && attacker.damagedThisTurn) return 120
  if (['boltbeak', 'fishiousrend'].includes(move.id) && !defender.actedThisTurn) return 170
  if (['hex', 'infernalparade'].includes(move.id) && (defender.status || defender.ability === '절대안깸')) {
    return Math.max(1, Number(move.power) || 65) * 2
  }
  if (move.id === 'facade' && attacker.status) return 140
  if (move.id === 'brine' && defender.hp <= defender.maxHp / 2) return 130
  if (move.id === 'barbbarrage' && ['poison', 'toxic'].includes(defender.status?.id)) return 120
  if (move.id === 'venoshock' && ['poison', 'toxic'].includes(defender.status?.id)) return 130
  if (move.id === 'knockoff' && canRemoveHeldItem(defender, attacker, {
    ignoreHolderAbility: moveIgnoresAbility(move, defender),
  })) return Math.floor(65 * 1.5)
  if (move.id === 'smellingsalts' && defender.status?.id === 'paralysis') return 140
  if (move.id === 'wakeupslap' && isPokemonAsleep(defender)) return 140
  if (['payback'].includes(move.id) && defender.actedThisTurn) return 100
  if (move.id === 'lashout' && attacker.statsLoweredThisTurn) return 150
  if (move.id === 'retaliate' && attackerSide.allyFaintedLastTurn) return 140
  if (move.id === 'gravapple' && state.environment?.gravityTurns > 0) return 120
  if (move.id === 'psyblade' && state.rules?.terrain?.id === 'electric') return 120
  if (
    move.id === 'fusionbolt' && state.lastUsedMove?.moveId === 'fusionflare'
    || move.id === 'fusionflare' && state.lastUsedMove?.moveId === 'fusionbolt'
  ) return 200
  if (
    ['collisioncourse', 'electrodrift'].includes(move.id)
    && getMoveTypeEffectiveness(state, attacker, defender, move) > 1
  ) return Math.max(1, Number(move.power) || 1) * 5461 / 4096
  if (['stompingtantrum', 'temperflare'].includes(move.id) && attacker.moveFailedLastTurn) return 150
  if (move.id === 'echoedvoice') return consecutiveMovePower(attacker, move.id, 40, 5)
  if (move.id === 'round' && getPokemonSide(state, attacker).roundUsedThisTurn) return 120
  if (move.id === 'furycutter') return consecutiveMovePower(attacker, move.id, 40, 4)
  if (['iceball', 'rollout'].includes(move.id)) {
    const defenseCurlMultiplier = attacker.defenseCurlActive ? 2 : 1
    return consecutiveMovePower(attacker, move.id, 30, 16) * defenseCurlMultiplier
  }
  if (
    defender.minimized
    && ['bodyslam', 'dragonrush', 'flyingpress', 'heatcrash', 'heavyslam', 'steamroller', 'stomp'].includes(move.id)
  ) return Math.max(1, Number(move.power) || 1) * 2
  if (move.id === 'beatup') return 10
  if (move.id === 'magnitude') return 70
  if (move.id === 'present') return 80
  if (move.id === 'naturalgift') {
    return heldItemEffectsActive(attacker)
      ? Number(getBattleItem(attacker.heldItemId)?.naturalGiftPower) || 1
      : 1
  }
  if (move.id === 'fling') {
    return heldItemEffectsActive(attacker)
      ? Number(getBattleItem(attacker.heldItemId)?.flingPower) || 1
      : 1
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
  if (attacker.electrifyActive) resolvedMove.type = '전기'
  if (state.environment?.ionDelugeTurns > 0 && resolvedMove.type === '노말') resolvedMove.type = '전기'
  if (move.id === 'naturalgift' && heldItemEffectsActive(attacker)) {
    resolvedMove.type = getBattleItem(attacker.heldItemId)?.naturalGiftType ?? resolvedMove.type
  }
  const weightPower = weightBasedMovePower(attacker, defender, resolvedMove)
  if (weightPower != null) resolvedMove.power = weightPower
  const variablePower = variableMovePower(state, attacker, defender, resolvedMove)
  if (variablePower != null) resolvedMove.power = variablePower
  if (move.id === 'beatup') {
    resolvedMove.multihit = Math.max(1, getPokemonSide(state, attacker).team
      .filter((pokemon) => !pokemon.fainted && pokemon.hp > 0 && !pokemon.status).length)
  }
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

  if (move.id === 'aurawheel' && currentSpeciesSlug(attacker).includes('morpeko-hangry')) {
    resolvedMove.type = '악'
  }

  if (move.id === 'secretpower') {
    const secretPowerEffects = {
      electric: { chance: 30, status: 'par' },
      grassy: { chance: 30, status: 'slp' },
      misty: { chance: 30, boosts: { spa: -1 } },
      psychic: { chance: 30, boosts: { spe: -1 } },
    }
    resolvedMove.secondary = secretPowerEffects[terrainId] ?? { chance: 30, status: 'par' }
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

  if (
    move.id === 'technoblast'
    && heldItemType
    && attacker.heldItemId?.endsWith('-drive')
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
  if (move.id === 'terastarstorm' && currentSpeciesSlug(attacker) === 'terapagos-stellar') {
    resolvedMove.type = '스텔라'
    resolvedMove.target = 'allAdjacentFoes'
  }
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

  if (state.environment?.waterSportTurns > 0 && move.type === '불꽃') multiplier *= 1 / 3
  if (state.environment?.mudSportTurns > 0 && move.type === '전기') multiplier *= 1 / 3

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

function getMoveStab(pokemon, moveType, forceStab = false) {
  if (forceStab) return 1.5
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
  if (moveIgnoresAbility(move, defender)) return null
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

function movePowerItemMultiplier(attacker, move) {
  if (!heldItemEffectsActive(attacker)) return 1
  let multiplier = 1
  if (TYPE_BOOST_ITEM_IDS[attacker.heldItemId] === move.type) multiplier *= 1.2
  if (GEM_ITEM_TYPES[attacker.heldItemId] === move.type) multiplier *= 1.3
  if (
    HELD_ITEM_TYPE_BY_ID[attacker.heldItemId] === move.type
    && (attacker.heldItemId.endsWith('-plate') || attacker.heldItemId.endsWith('-incense'))
  ) multiplier *= 1.2
  if (move.categoryId === 'physical' && hasActiveHeldItem(attacker, 'muscle-band')) multiplier *= 1.1
  if (move.categoryId === 'special' && hasActiveHeldItem(attacker, 'wise-glasses')) multiplier *= 1.1
  if (move.flags?.includes('punch') && hasActiveHeldItem(attacker, 'punching-glove')) multiplier *= 1.1
  if (hasActiveHeldItem(attacker, 'metronome')) {
    const useCount = attacker.consecutiveMoveId === move.id
      ? Math.min(5, (attacker.consecutiveMoveCount ?? 0) + 1)
      : 1
    multiplier *= 1 + 0.2 * useCount
  }
  if (
    ['latias', 'latios'].includes(currentSpeciesSlug(attacker))
    && hasActiveHeldItem(attacker, 'soul-dew')
    && ['에스퍼', '드래곤'].includes(move.type)
  ) multiplier *= 1.2
  if (
    currentSpeciesSlug(attacker).startsWith('dialga')
    && hasActiveHeldItem(attacker, 'adamant-orb')
    && ['강철', '드래곤'].includes(move.type)
  ) multiplier *= 1.2
  if (
    currentSpeciesSlug(attacker).startsWith('palkia')
    && hasActiveHeldItem(attacker, 'lustrous-orb')
    && ['물', '드래곤'].includes(move.type)
  ) multiplier *= 1.2
  if (
    currentSpeciesSlug(attacker).startsWith('giratina')
    && hasActiveHeldItem(attacker, 'griseous-orb')
    && ['고스트', '드래곤'].includes(move.type)
  ) multiplier *= 1.2
  if (
    currentSpeciesSlug(attacker).startsWith('dialga')
    && hasActiveHeldItem(attacker, 'adamant-crystal')
    && ['강철', '드래곤'].includes(move.type)
  ) multiplier *= 1.2
  if (
    currentSpeciesSlug(attacker).startsWith('palkia')
    && hasActiveHeldItem(attacker, 'lustrous-globe')
    && ['물', '드래곤'].includes(move.type)
  ) multiplier *= 1.2
  if (
    currentSpeciesSlug(attacker).startsWith('giratina')
    && hasActiveHeldItem(attacker, 'griseous-core')
    && ['고스트', '드래곤'].includes(move.type)
  ) multiplier *= 1.2
  const heldItemFormRule = HELD_ITEM_FORM_RULES[attacker.heldItemId]
  if (
    heldItemFormRule?.species === 'ogerpon'
    && heldItemFormRule.form === currentSpeciesSlug(attacker)
    && heldItemEffectsActive(attacker)
  ) multiplier *= 1.2
  return multiplier
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
  if (moveIgnoresAbility(move, defender) && !['스펙터가드', '프리즘아머'].includes(defender.ability)) return 1
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
  const standardEffectiveness = getMoveTypeEffectiveness(state, attacker, defender, move)
  const ignoresDefenderAbility = moveIgnoresAbility(move, defender)
  const effectiveness = !ignoresDefenderAbility
    && defender.ability === '테라셸'
    && defender.hp === defender.maxHp
    && standardEffectiveness > 0
    ? 0.5
    : standardEffectiveness
  const criticalRates = [1 / 24, 1 / 8, 1 / 2, 1]
  const criticalStage = Math.max(0, Math.min(
    3,
    Number(move.critRatio ?? 0)
      + (attacker.ability === '대운' ? 1 : 0)
      + (attacker.criticalStageBoost ?? 0)
      + (attacker.dragonCheerTurns > 0 ? attacker.types.includes('드래곤') ? 2 : 1 : 0)
      + (['scope-lens', 'razor-claw'].includes(attacker.heldItemId) && heldItemEffectsActive(attacker) ? 1 : 0)
      + (['stick', 'leek'].includes(attacker.heldItemId)
        && heldItemEffectsActive(attacker)
        && ['farfetchd', 'sirfetchd'].includes(currentSpeciesSlug(attacker)) ? 2 : 0)
      + (hasActiveHeldItem(attacker, 'lucky-punch') && currentSpeciesSlug(attacker) === 'chansey' ? 2 : 0),
  ))
  const mercilessCritical = attacker.ability === '무도한행동'
    && ['poison', 'toxic'].includes(defender.status?.id)
  let critical = Boolean(move.willCrit)
    || attacker.laserFocusActive
    || mercilessCritical
    || random() < criticalRates[criticalStage]
  if (!ignoresDefenderAbility && CRITICAL_HIT_IMMUNITY_ABILITIES.has(defender.ability)) critical = false
  if (getPokemonSide(state, defender).luckyChantTurns > 0) critical = false

  const attackStage = attackPokemon.statStages?.[attackKey] ?? 0
  const defenseStage = defender.statStages?.[defenseKey] ?? 0
  let attack = effectiveStat(state, attackPokemon, attackKey, {
    ignoreStages: !ignoresDefenderAbility && defender.ability === '천진' && attackPokemon !== defender,
    stageOverride: critical && attackStage < 0 ? 0 : null,
  })
  let defense = effectiveStat(state, defender, defenseKey, {
    ignoreStages: attacker.ability === '천진',
    stageOverride: move.ignoreDefensive || critical && defenseStage > 0 ? 0 : null,
  })

  if (category === 'physical' && attacker.status?.id === 'burn' && attacker.ability !== '근성') attack *= 0.5
  if (attacker.ability === '의욕' && attackPokemon === attacker && attackKey === 'attack') attack *= 1.5
  if (attacker.ability === '근성' && attacker.status && attackPokemon === attacker && attackKey === 'attack') attack *= 1.5
  if (effectiveMoveWeatherFamilyId(state, defender) === 'snow' && defenseKey === 'defense' && defender.types.includes('얼음')) defense *= 1.5
  if (effectiveMoveWeatherFamilyId(state, defender) === 'sandstorm' && defenseKey === 'specialDefense' && defender.types.includes('바위')) defense *= 1.5
  const baseDamage = (((2 * Number(attacker.level ?? 50)) / 5 + 2) * power * attack / defense) / 50 + 2
  const randomFactor = 0.85 + random() * 0.15
  let modifier = getMoveStab(attacker, move.type, move.pledgeStabOverride)
    * effectiveness
    * environmentMoveMultiplier(state, attacker, defender, move)
    * randomFactor
    * (critical ? 1.5 : 1)

  if (hasActiveHeldItem(attacker, 'life-orb')) modifier *= 1.3
  if (hasActiveHeldItem(attacker, 'expert-belt') && effectiveness > 1) modifier *= 1.2
  modifier *= movePowerItemMultiplier(attacker, move)
  if (attacker.ability === '우격다짐' && hasSheerForceEffect(move)) modifier *= 1.3
  modifier *= movePowerAbilityMultiplier(state, attacker, defender, move, effectiveness, critical)
  modifier *= lowHpMoveAbilityMultiplier(attacker, move)
  modifier *= supremeOverlordMultiplier(state, attacker)
  if (!ignoresDefenderAbility) {
    if (defender.ability === '멀티스케일' && defender.hp === defender.maxHp) modifier *= 0.5
    if (defender.ability === '두꺼운지방' && ['불꽃', '얼음'].includes(move.type)) modifier *= 0.5
    if (defender.ability === '건조피부' && move.type === '불꽃') modifier *= 1.25
  }
  modifier *= defenderAbilityDamageMultiplier(state, attacker, defender, move, effectiveness)

  const defenderSide = getPokemonSide(state, defender)
  if (defenderSide.auroraVeilTurns > 0 && !critical && attacker.ability !== '틈새포착') {
    modifier *= state.rules?.format?.activeSlots > 1 ? 2 / 3 : 0.5
  }
  if (
    category === 'physical'
    && defenderSide.reflectTurns > 0
    && !critical
    && attacker.ability !== '틈새포착'
  ) modifier *= state.rules?.format?.activeSlots > 1 ? 2 / 3 : 0.5
  if (
    category === 'special'
    && defenderSide.lightScreenTurns > 0
    && !critical
    && attacker.ability !== '틈새포착'
  ) modifier *= state.rules?.format?.activeSlots > 1 ? 2 / 3 : 0.5

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
  const curedConfusion = target.heldItemId === 'lum-berry' && target.confusionTurns > 0
  consumeHeldItem(state, target, { berry: true })
  target.status = null
  if (curedConfusion) target.confusionTurns = 0
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

function applyFlavorBerryConfusion(state, pokemon, itemId, random) {
  const dislikedStat = FLAVOR_BERRY_DISLIKED_STATS[itemId]
  const nature = NATURE_OPTIONS.find((option) => option.label === pokemon.nature)
  if (!dislikedStat || nature?.down !== dislikedStat) return false
  return applyVolatileEffect(state, pokemon, 'confusion', pokemon.heldItemName || itemId, random, itemId, {
    source: pokemon,
  })
}

function repeatCudChewBerry(state, pokemon, random) {
  const itemId = pokemon.cudChewItemId
  if (!itemId || pokemon.hp <= 0) return false
  appendLog(state, `${pokemon.name}의 되새김질! 먹었던 나무열매를 다시 되새겼다!`, 'ability')
  const applied = applyEatenBerryEffect(
    state,
    pokemon,
    itemId,
    pokemon.cudChewItemName || '되새김질',
    random,
  )

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
  if (itemId === 'oran-berry' && hpRatio <= 0.5 && pokemon.healBlockTurns <= 0) {
    consumeHeldItem(state, pokemon, { berry: true })
    healPokemon(state, pokemon, 10 * multiplier, '오랭열매')
    consumed = true
  } else if (itemId === 'sitrus-berry' && hpRatio <= 0.5 && pokemon.healBlockTurns <= 0) {
    consumeHeldItem(state, pokemon, { berry: true })
    healPokemon(state, pokemon, pokemon.maxHp * multiplier / 4, '자뭉열매')
    consumed = true
  } else {
    const pinchThreshold = pokemon.ability === '먹보' ? 0.5 : 0.25
    if (hpRatio > pinchThreshold) return false
    const statBoost = PINCH_STAT_BERRIES[itemId]
    if (BERRY_HEALING_FRACTIONS[itemId] && itemId !== 'oran-berry' && itemId !== 'sitrus-berry') {
      const [numerator, denominator] = BERRY_HEALING_FRACTIONS[itemId]
      consumeHeldItem(state, pokemon, { berry: true })
      healPokemon(state, pokemon, pokemon.maxHp * numerator * multiplier / denominator, pokemon.heldItemName || itemId)
      applyFlavorBerryConfusion(state, pokemon, itemId, random)
      consumed = true
    } else if (statBoost) {
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
    } else if (itemId === 'micle-berry') {
      consumeHeldItem(state, pokemon, { berry: true })
      pokemon.micleActive = true
      appendLog(state, `${pokemon.name}은(는) 미클열매로 다음 기술의 명중률을 높였다!`, 'item')
      consumed = true
    }
  }

  if (consumed) applyCheekPouch(state, pokemon)
  return consumed
}

function applyEatenBerryEffect(state, pokemon, itemId, itemName, random) {
  const multiplier = berryEffectMultiplier(pokemon)
  let applied = false
  if (itemId === 'lum-berry' && (pokemon.status || pokemon.confusionTurns > 0)) {
    pokemon.status = null
    pokemon.confusionTurns = 0
    applied = true
  } else if (STATUS_CURE_BERRIES[itemId]?.statuses.includes(pokemon.status?.id)) {
    pokemon.status = null
    applied = true
  } else if (['lum-berry', 'persim-berry'].includes(itemId) && pokemon.confusionTurns > 0) {
    pokemon.confusionTurns = 0
    applied = true
  } else if (itemId === 'leppa-berry') {
    const move = pokemon.moves.slice().sort((left, right) => left.currentPp - right.currentPp)[0]
    if (move) {
      move.currentPp = Math.min(move.maxPp, move.currentPp + 10 * multiplier)
      applied = true
    }
  } else if (itemId === 'oran-berry') {
    applied = healPokemon(state, pokemon, 10 * multiplier, itemName) > 0
  } else if (BERRY_HEALING_FRACTIONS[itemId]) {
    const [numerator, denominator] = BERRY_HEALING_FRACTIONS[itemId]
    applied = healPokemon(state, pokemon, pokemon.maxHp * numerator * multiplier / denominator, itemName) > 0
    applyFlavorBerryConfusion(state, pokemon, itemId, random)
  } else if (PINCH_STAT_BERRIES[itemId]) {
    changeStages(state, pokemon, Object.fromEntries(Object.entries(PINCH_STAT_BERRIES[itemId])
      .map(([stat, amount]) => [stat, amount * multiplier])))
    applied = true
  } else if (itemId === 'lansat-berry') {
    pokemon.criticalStageBoost = Math.min(3, (pokemon.criticalStageBoost ?? 0) + 2 * multiplier)
    applied = true
  } else if (itemId === 'starf-berry') {
    const stats = ['attack', 'defense', 'specialAttack', 'specialDefense', 'speed']
    changeStages(state, pokemon, { [stats[Math.floor(random() * stats.length)]]: 2 * multiplier })
    applied = true
  } else if (itemId === 'custap-berry') {
    pokemon.custapActive = true
    applied = true
  } else if (itemId === 'micle-berry') {
    pokemon.micleActive = true
    applied = true
  }
  return applied
}

function applyFlingItemEffect(state, attacker, defender, move, random) {
  const itemId = attacker.heldItemId
  const itemName = attacker.heldItemName || itemId
  const item = getBattleItem(itemId)
  if (!item?.flingPower || attacker.consumedItem) return false

  consumeHeldItem(state, attacker)
  appendLog(state, `${attacker.name}은(는) ${itemName}을(를) 내던졌다!`, 'item')
  if (item.category === 'berry' && attacker.ability === '되새김질') {
    attacker.cudChewReadyTurn = state.turn + 1
    attacker.cudChewItemId = itemId
    attacker.cudChewItemName = itemName
  }
  if (!defender || defender.fainted || defender.hp <= 0) return true

  if (item.category === 'berry') {
    defender.ateBerry = true
    state.lastConsumedItem = {
      id: itemId,
      name: itemName,
      turn: state.turn,
      consumerBattleId: defender.battleId,
    }
    if (defender.ability === '되새김질') {
      defender.cudChewReadyTurn = state.turn + 1
      defender.cudChewItemId = itemId
      defender.cudChewItemName = itemName
    }
    applyEatenBerryEffect(state, defender, itemId, itemName, random)
    appendLog(state, `${defender.name}은(는) 날아온 ${itemName}을(를) 먹었다!`, 'item')
    applyCheekPouch(state, defender)
    return true
  }

  if (item.flingEffect === 'herb-effect') {
    const applied = itemId === 'white-herb'
      ? clearNegativeStatStages(defender)
      : itemId === 'mental-herb' && clearMentalHerbConditions(defender)
    if (applied) appendLog(state, `${defender.name}에게 ${itemName}의 효과가 발동했다!`, 'item')
    return true
  }

  const targetEffectBlocked = (!moveIgnoresAbility(move, defender) && defender.ability === '인분')
    || hasActiveHeldItem(defender, 'covert-cloak')
  if (targetEffectBlocked) return true
  const statusId = {
    'badly-poison': 'toxic',
    burn: 'burn',
    paralyze: 'paralysis',
    poison: 'poison',
  }[item.flingEffect]
  if (statusId) {
    setStatus(state, defender, statusId, move.name, {
      source: attacker,
      ignoreAbility: Boolean(move.ignoreAbility),
      random,
    })
  } else if (item.flingEffect === 'flinch' && !defender.actedThisTurn) {
    applyVolatileEffect(state, defender, 'flinch', move.name, random, move.id, {
      source: attacker,
      ignoreAbility: Boolean(move.ignoreAbility),
    })
  }
  return true
}

function consumeBerryImmediately(state, pokemon, random = Math.random, { force = false } = {}) {
  if (!hasHeldItem(pokemon) || !pokemon.heldItemId.endsWith('-berry')) return false
  if (!force && !heldItemEffectsActive(pokemon)) return false
  const itemId = pokemon.heldItemId
  const itemName = pokemon.heldItemName || itemId
  consumeHeldItem(state, pokemon, { berry: true })
  const applied = applyEatenBerryEffect(state, pokemon, itemId, itemName, random)
  appendLog(state, `${pokemon.name}은(는) ${itemName}을(를) 먹었다!`, 'item')
  applyCheekPouch(state, pokemon)
  return applied
}

function consumeStolenBerry(state, pokemon, itemId, itemName, random = Math.random) {
  pokemon.ateBerry = true
  state.lastConsumedItem = {
    id: itemId,
    name: itemName,
    turn: state.turn,
    consumerBattleId: pokemon.battleId,
  }
  if (pokemon.ability === '되새김질') {
    pokemon.cudChewReadyTurn = state.turn + 1
    pokemon.cudChewItemId = itemId
    pokemon.cudChewItemName = itemName
  }
  const applied = applyEatenBerryEffect(state, pokemon, itemId, itemName, random)
  appendLog(state, `${pokemon.name}은(는) 빼앗은 ${itemName}을(를) 먹었다!`, 'item')
  applyCheekPouch(state, pokemon)
  return applied
}

function setStatus(
  state,
  target,
  statusId,
  sourceName,
  { source = null, ignoreAbility = false, synchronize = true, random = Math.random } = {},
) {
  if (!STATUS_LABELS[statusId] || target.status || target.fainted || target.hp <= 0) return false
  ignoreAbility = ignoreAbility && !hasActiveHeldItem(target, 'ability-shield')
  const targetSide = getPokemonSide(state, target)
  const sourceSide = source ? getPokemonSide(state, source) : null
  if (
    targetSide.safeguardTurns > 0
    && sourceSide
    && sourceSide.id !== targetSide.id
    && source?.ability !== '틈새포착'
  ) return false
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
    statusId === 'sleep'
    && target.ability !== '방음'
    && ['player', 'opponent'].some((sideId) => getActivePokemonList(state, sideId).some((pokemon) => (
      isAvailableFieldPokemon(pokemon) && pokemon.uproarTurns > 0
    )))
  ) return false
  if (
    !ignoreAbility
    && statusId === 'sleep'
    && getActivePokemonList(state, getPokemonSide(state, target).id).some((pokemon) => (
      pokemon && !pokemon.fainted && pokemon.hp > 0 && pokemon.ability === '스위트베일'
    ))
  ) return false
  if (isGrounded(target, state) && state.rules?.terrain?.id === 'misty') return false
  if (isGrounded(target, state) && state.rules?.terrain?.id === 'electric' && statusId === 'sleep') return false

  const sleepTurns = statusId === 'sleep' ? 1 + Math.floor(random() * 3) : 0
  const effectiveSleepTurns = target.ability === '일찍기상'
    ? Math.ceil(sleepTurns / 2)
    : sleepTurns
  target.status = {
    id: statusId,
    label: STATUS_LABELS[statusId],
    counter: statusId === 'sleep' ? effectiveSleepTurns + 1 : 0,
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
      random,
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
  ignoreAbility = ignoreAbility && !hasActiveHeldItem(pokemon, 'ability-shield')
  const messages = []
  const abilityMultiplier = !ignoreAbility && pokemon.ability === '단순' ? 2 : 1
  const abilityDirection = !ignoreAbility && pokemon.ability === '심술꾸러기' ? -1 : 1
  const sourceSide = source ? getPokemonSide(state, source) : null
  const targetSide = getPokemonSide(state, pokemon)
  const hostile = Boolean(source && source !== pokemon && sourceSide.id !== targetSide.id)
  const reflectedChanges = {}
  const appliedBoosts = {}
  const appliedDrops = {}
  let blockedByAbility = false
  let blockedByItem = false
  let loweredByOpponent = false

  Object.entries(normalizedStageChanges(changes)).forEach(([statKey, baseAmount]) => {
    const amount = baseAmount * abilityMultiplier * abilityDirection
    const abilityCanBeIgnored = ignoreAbility && pokemon.ability !== '메탈프로텍트'
    if (hostile && amount < 0 && !abilityCanBeIgnored) {
      const flowerVeilActive = pokemon.types.includes('풀')
        && getActivePokemonList(state, targetSide.id).some((ally) => (
          ally && !ally.fainted && ally.hp > 0 && ally.ability === '플라워베일'
        ))
      const protectedByItem = hasActiveHeldItem(pokemon, 'clear-amulet')
      const protectedByAbility = FULL_STAT_DROP_IMMUNITY_ABILITIES.has(pokemon.ability)
        || pokemon.ability === '부풀린가슴' && statKey === 'defense'
        || pokemon.ability === '괴력집게' && statKey === 'attack'
        || ['날카로운눈', '발광'].includes(pokemon.ability) && statKey === 'accuracy'
        || reason === INTIMIDATE_REASON && INTIMIDATE_IMMUNITY_ABILITIES.has(pokemon.ability)
        || flowerVeilActive
        || targetSide.mistTurns > 0 && source?.ability !== '틈새포착'
      if (protectedByItem || protectedByAbility) {
        blockedByItem = protectedByItem
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
      if (next < previous) appliedDrops[statKey] = previous - next
    }
  })

  if (Object.keys(appliedDrops).length > 0) pokemon.statsLoweredThisTurn = true
  if (messages.length > 0) appendLog(state, `${pokemon.name}의 ${messages.join(' · ')}!`, 'status')
  if (blockedByItem) appendLog(state, `${pokemon.name}의 클리어참! 능력이 떨어지지 않는다!`, 'item')
  else if (blockedByAbility) appendLog(state, `${pokemon.name}의 ${pokemon.ability}! 능력이 떨어지지 않는다!`, 'ability')
  if (Object.keys(reflectedChanges).length > 0) {
    appendLog(state, `${pokemon.name}의 미러아머가 능력 하락을 되받아쳤다!`, 'ability')
    changeStages(state, source, reflectedChanges, { source: pokemon, ignoreAbility: true })
  }
  if (triggerOpportunist && Object.keys(appliedBoosts).length > 0) {
    const opposingSide = getOtherSide(state, targetSide.id)
    getActivePokemonList(state, opposingSide.id)
      .filter((holder) => (
        holder
        && !holder.fainted
        && holder.hp > 0
        && hasActiveHeldItem(holder, 'mirror-herb')
      ))
      .forEach((holder) => {
        consumeHeldItem(state, holder)
        appendLog(state, `${holder.name}의 흉내허브가 상대의 능력 상승을 복사했다!`, 'item')
        changeStages(state, holder, appliedBoosts, {
          source: holder,
          triggerOpportunist: false,
        })
      })
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
  if (Object.keys(appliedDrops).length > 0 && hasActiveHeldItem(pokemon, 'eject-pack')) {
    pokemon.ejectPackPending = true
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
  if (reason === INTIMIDATE_REASON && hasActiveHeldItem(pokemon, 'adrenaline-orb')) {
    consumeHeldItem(state, pokemon)
    appendLog(state, `${pokemon.name}의 주눅구슬이 발동했다!`, 'item')
    changeStages(state, pokemon, { speed: 1 })
  }
  activateWhiteHerb(state, pokemon)
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

function drainingRecoveryMultiplier(pokemon) {
  return hasActiveHeldItem(pokemon, 'big-root') ? 5324 / 4096 : 1
}

function applyDrainingRecovery(
  state,
  recipient,
  drainedPokemon,
  amount,
  sourceName,
  { ignoreDrainedAbility = false } = {},
) {
  const recoveryAmount = amount * drainingRecoveryMultiplier(recipient)
  if (!ignoreDrainedAbility && drainedPokemon?.ability === '해감액') {
    if (recipient.ability === '매직가드') {
      appendLog(state, `${recipient.name}은(는) 매직가드로 해감액의 데미지를 받지 않았다!`, 'ability')
      return 0
    }
    return -loseHp(
      state,
      recipient,
      recoveryAmount,
      `${recipient.name}은(는) ${drainedPokemon.name}의 해감액 때문에 HP를 빼앗겼다!`,
      'ability',
    )
  }
  return healPokemon(state, recipient, recoveryAmount, sourceName)
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
  ignoreAbility = ignoreAbility && !hasActiveHeldItem(target, 'ability-shield')

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
    if (
      ['lum-berry', 'persim-berry'].includes(target.heldItemId)
      && heldItemEffectsActive(target)
      && !berriesSuppressed(state, target)
    ) {
      consumeBerryImmediately(state, target, random)
      target.confusionTurns = 0
      appendLog(state, `${target.name}의 혼란이 풀렸다!`, 'heal')
    }
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

  if (volatileStatus === 'disable') {
    if (target.lastMoveIndex == null || target.disabledMoveTurns > 0) return false
    target.disabledMoveIndex = target.lastMoveIndex
    target.disabledMoveTurns = 4
    appendLog(state, `${target.name}의 ${target.moves[target.lastMoveIndex]?.name ?? '기술'}을(를) 봉인했다!`, 'status')
    activateMentalHerb(state, target)
    return true
  }

  if (volatileStatus === 'encore') {
    const lastMove = target.moves[target.lastMoveIndex]
    if (
      target.lastMoveIndex == null
      || target.encoreTurns > 0
      || lastMove?.flags?.includes('failencore')
    ) return false
    target.encoredMoveIndex = target.lastMoveIndex
    target.encoreTurns = 3
    appendLog(state, `${target.name}은(는) 앵콜을 받아 같은 기술만 쓰게 되었다!`, 'status')
    activateMentalHerb(state, target)
    return true
  }

  if (volatileStatus === 'taunt') {
    if (target.tauntTurns > 0) return false
    target.tauntTurns = 3
    appendLog(state, `${target.name}은(는) 도발당해 변화 기술을 쓸 수 없다!`, 'status')
    activateMentalHerb(state, target)
    return true
  }

  if (volatileStatus === 'embargo') {
    if (target.embargoTurns > 0) return false
    target.embargoTurns = 5
    appendLog(state, `${target.name}은(는) 지닌물건을 사용할 수 없게 되었다!`, 'status')
    return true
  }

  if (['spiderweb', 'meanlook', 'block'].includes(volatileStatus)) {
    if (target.trappedTurns > 0) return false
    target.trappedTurns = 999
    target.trapSourceName = sourceName
    target.trapSourceBattleId = source?.battleId ?? null
    target.trapDamages = false
    appendLog(state, `${target.name}은(는) 도망치거나 교체할 수 없게 되었다!`, 'status')
    return true
  }

  if (['foresight', 'miracleeye'].includes(volatileStatus)) {
    const property = volatileStatus === 'foresight' ? 'foresightActive' : 'miracleEyeActive'
    if (target[property]) return false
    target[property] = true
    appendLog(state, `${target.name}의 정체를 꿰뚫어 보았다!`, 'status')
    return true
  }

  if (volatileStatus === 'focusenergy') {
    target.criticalStageBoost = Math.min(3, (target.criticalStageBoost ?? 0) + 2)
    appendLog(state, `${target.name}은(는) 기를 모아 급소를 노리고 있다!`, 'status')
    return true
  }

  if (volatileStatus === 'leechseed') {
    if (target.types.includes('풀') || target.leechSeedSourceSideId) return false
    const sourceSide = source ? getPokemonSide(state, source) : null
    target.leechSeedSourceSideId = sourceSide?.id ?? null
    target.leechSeedSourceSlot = sourceSide
      ? getActivePokemonList(state, sourceSide.id).findIndex((pokemon) => pokemon?.battleId === source.battleId)
      : null
    appendLog(state, `${target.name}에게 씨를 심었다!`, 'status')
    return true
  }

  if (volatileStatus === 'nightmare') {
    if (!isPokemonAsleep(target) || target.nightmareActive) return false
    target.nightmareActive = true
    appendLog(state, `${target.name}은(는) 악몽에 시달리기 시작했다!`, 'status')
    return true
  }

  if (volatileStatus === 'endure') {
    target.protected = true
    target.protectMode = 'endure'
    appendLog(state, `${target.name}은(는) 공격을 버틸 태세다!`, 'status')
    return true
  }

  if (volatileStatus === 'aquaring') {
    if (target.aquaRingActive) return false
    target.aquaRingActive = true
    appendLog(state, `${target.name}을(를) 아쿠아링이 감쌌다!`, 'status')
    return true
  }

  if (volatileStatus === 'ingrain') {
    if (target.ingrainActive) return false
    target.ingrainActive = true
    appendLog(state, `${target.name}은(는) 뿌리를 내렸다!`, 'status')
    return true
  }

  if (volatileStatus === 'magnetrise') {
    target.magnetRiseTurns = 5
    appendLog(state, `${target.name}은(는) 전자력으로 떠올랐다!`, 'status')
    return true
  }

  if (volatileStatus === 'telekinesis') {
    target.telekinesisTurns = 3
    appendLog(state, `${target.name}은(는) 염동력으로 공중에 떠올랐다!`, 'status')
    return true
  }

  if (volatileStatus === 'gastroacid') {
    return suppressPokemonAbility(state, target, sourceName)
  }

  if (volatileStatus === 'magiccoat') {
    target.magicCoatActive = true
    appendLog(state, `${target.name}은(는) 변화 기술을 되받아칠 준비를 했다!`, 'status')
    return true
  }

  if (volatileStatus === 'snatch') {
    target.snatchActive = true
    appendLog(state, `${target.name}은(는) 상대의 기술을 가로챌 준비를 했다!`, 'status')
    return true
  }

  if (volatileStatus === 'grudge') {
    target.grudgeActive = true
    appendLog(state, `${target.name}은(는) 원념을 품었다!`, 'status')
    return true
  }

  if (volatileStatus === 'helpinghand') {
    target.helpingHandActive = true
    appendLog(state, `${target.name}은(는) 도움을 받아 공격력이 강해졌다!`, 'status')
    return true
  }

  if (volatileStatus === 'powder') {
    target.powderActive = true
    appendLog(state, `${target.name}에게 분진이 달라붙었다!`, 'status')
    return true
  }

  if (volatileStatus === 'electrify') {
    target.electrifyActive = true
    appendLog(state, `${target.name}이(가) 사용할 기술이 전기타입으로 바뀐다!`, 'status')
    return true
  }

  if (volatileStatus === 'laserfocus') {
    target.laserFocusActive = true
    appendLog(state, `${target.name}은(는) 다음 공격을 급소에 맞힐 준비를 했다!`, 'status')
    return true
  }

  if (volatileStatus === 'octolock') {
    target.octolockActive = true
    target.trappedTurns = 999
    target.trapSourceName = sourceName
    target.trapSourceBattleId = source?.battleId ?? null
    target.trapDamages = false
    appendLog(state, `${target.name}은(는) 문어굳히기에 붙잡혔다!`, 'status')
    return true
  }

  if (volatileStatus === 'partiallytrapped') {
    target.trappedTurns = hasActiveHeldItem(source, 'grip-claw') ? 7 : 4 + Math.floor(random() * 2)
    target.trapSourceName = sourceName
    target.trapSourceBattleId = source?.battleId ?? null
    target.trapDamages = true
    appendLog(state, `${target.name}은(는) ${sourceName}에 갇혔다!`, 'status')
    return true
  }

  if (volatileStatus === 'dragoncheer') {
    target.dragonCheerTurns = 2
    appendLog(state, `${target.name}은(는) 용의 응원을 받아 급소율이 올랐다!`, 'status')
    return true
  }

  if (volatileStatus === 'charge') {
    target.chargeActive = true
    changeStages(state, target, { specialDefense: 1 })
    appendLog(state, `${target.name}은(는) 전기를 충전했다!`, 'status')
    return true
  }

  if (volatileStatus === 'defensecurl') {
    target.defenseCurlActive = true
    return true
  }

  if (volatileStatus === 'minimize') {
    target.minimized = true
    return true
  }

  if (volatileStatus === 'noretreat') {
    if (target.noRetreatActive) return false
    target.noRetreatActive = true
    target.trappedTurns = 999
    target.trapSourceName = sourceName
    changeStages(state, target, { attack: 1, defense: 1, specialAttack: 1, specialDefense: 1, speed: 1 })
    return true
  }

  if (volatileStatus === 'rage') {
    target.rageActive = true
    return true
  }

  if (volatileStatus === 'smackdown') {
    target.smackDownActive = true
    target.magnetRiseTurns = 0
    target.telekinesisTurns = 0
    appendLog(state, `${target.name}은(는) 땅에 떨어졌다!`, 'status')
    return true
  }

  if (volatileStatus === 'tarshot') {
    target.tarShotActive = true
    appendLog(state, `${target.name}은(는) 타르에 뒤덮였다!`, 'status')
    return true
  }

  if (volatileStatus === 'glaiverush') {
    target.glaiveRushVulnerable = true
    return true
  }

  if (volatileStatus === 'uproar') {
    if (target.uproarTurns > 0) return true
    target.uproarTurns = 3
    target.lockedMove = {
      moveIndex: target.lastMoveIndex ?? 0,
      moveId: sourceMoveId,
      remainingUses: 2,
    }
    ;['player', 'opponent'].flatMap((sideId) => getActivePokemonList(state, sideId))
      .filter((pokemon) => pokemon?.status?.id === 'sleep' && pokemon.ability !== '방음')
      .forEach((pokemon) => { pokemon.status = null })
    appendLog(state, '소란피기가 울려 퍼져 모두 잠들 수 없게 되었다!', 'status')
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
    if (hasActiveHeldItem(target, 'destiny-knot') && source && !source.infatuated) {
      source.infatuated = true
      appendLog(state, `${target.name}의 빨간실로 ${source.name}도 헤롱헤롱해졌다!`, 'item')
      activateMentalHerb(state, source)
    }
    activateMentalHerb(state, target)
    return true
  }

  if (volatileStatus === 'torment') {
    if (target.tormented) return false
    target.tormented = true
    appendLog(state, `${target.name}은(는) 같은 기술을 연속해서 쓸 수 없게 되었다!`, 'status')
    activateMentalHerb(state, target)
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
    activateMentalHerb(state, target)
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
      { source: attacker, ignoreAbility: Boolean(sourceMove?.ignoreAbility), random },
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
  const target = move.target === 'self'
    ? attacker
    : ['adjacentAlly', 'adjacentAllyOrSelf'].includes(move.target)
      ? activeAllies(state, attacker)[0] ?? attacker
      : defender
  const primaryEffect = {
    status: move.status,
    volatileStatus: move.volatileStatus,
    boosts: move.boosts,
  }
  const applied = applyEffectPayload(state, attacker, target, primaryEffect, random, move)
  let selfEffect = move.self
  if (Number(selfEffect?.chance) > 0) {
    selfEffect = attacker.ability !== '우격다짐'
      && random() * 100 < secondaryEffectChance(state, attacker, selfEffect)
      ? selfEffect
      : null
  }
  const selfApplied = applyEffectPayload(state, attacker, attacker, selfEffect, random, move)
  if (move.selfBoost?.boosts) {
    changeStages(state, attacker, move.selfBoost.boosts)
    return true
  }
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
        random,
      }) || applied
    ), false)
  }
  if (effect.kind === 'randomStatus') {
    return targets.reduce((applied, pokemon) => {
      const status = effect.statuses[Math.floor(random() * effect.statuses.length)]
      return setStatus(state, pokemon, status, move.name, { source: attacker, random }) || applied
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
      side.hazards = {
        stealthRock: false,
        steelsurge: false,
        toxicSpikes: 0,
        spikes: 0,
        stickyWeb: false,
      }
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

  if (move.pseudoWeather === 'iondeluge') {
    const environment = ensureEnvironmentState(state)
    environment.ionDelugeTurns = 1
    appendLog(state, '플라스마샤워가 전장에 펼쳐졌다!', 'field')
    applied = true
  }

  if (move.pledgeSideCondition) {
    const effectSide = move.pledgeAffectsOwnSide
      ? getPokemonSide(state, attacker)
      : getPokemonSide(state, defender)
    effectSide[move.pledgeSideCondition] = 4
    const pledgeLabels = {
      firePledgeTurns: '불바다',
      grassPledgeTurns: '습지초원',
      waterPledgeTurns: '무지개',
    }
    appendLog(state, `${effectSide.name} 진영에 ${pledgeLabels[move.pledgeSideCondition]}가 펼쳐졌다!`, 'field')
    applied = true
  }

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
  const previousSnapshot = mechanicPokemonSnapshot(attacker)

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
  emitFormChangeTimeline(state, attacker, previousSnapshot, '변신')
  return true
}

function allBattlePokemon(state) {
  return [...state.player.team, ...state.opponent.team]
}

function setSideConditionFromMove(state, attacker, move) {
  const rule = SIDE_CONDITION_MOVE_RULES[move.id]
  if (!rule) return false
  if (move.id === 'auroraveil' && effectiveWeatherFamilyId(state) !== 'snow') {
    appendLog(state, '싸라기눈이나 눈이 내리지 않아 오로라베일은 실패했다!', 'muted')
    return true
  }
  const side = getPokemonSide(state, attacker)
  const turns = hasActiveHeldItem(attacker, 'light-clay') && rule.turns > 1 ? 8 : rule.turns
  side[rule.key] = turns
  appendLog(state, `${side.name} 진영에 ${move.name}의 효과가 펼쳐졌다!`, 'field')
  return true
}

function setHazardFromMove(state, attacker, move) {
  const rule = HAZARD_MOVE_RULES[move.id]
  if (!rule) return false
  const targetSide = getOtherSide(state, getPokemonSide(state, attacker).id)
  const current = Number(targetSide.hazards[rule.key] ?? 0)
  if (current >= rule.maximum) {
    appendLog(state, `${move.name}은(는) 더 이상 설치할 수 없다!`, 'muted')
    return true
  }
  targetSide.hazards[rule.key] = rule.maximum === 1 ? true : current + 1
  appendLog(state, `${targetSide.name} 진영에 ${move.name}이(가) 설치되었다!`, 'field')
  return true
}

function updateMagicRoomSuppression(state, active) {
  allBattlePokemon(state).forEach((pokemon) => {
    pokemon.magicRoomSuppressed = active
  })
}

function setFieldEffectFromMove(state, move) {
  const rule = FIELD_EFFECT_MOVE_RULES[move.id]
  if (!rule) return false
  const environment = ensureEnvironmentState(state)
  if (rule.toggle && environment[rule.key] > 0) {
    environment[rule.key] = 0
    if (move.id === 'magicroom') updateMagicRoomSuppression(state, false)
    appendLog(state, `${move.name}의 효과가 해제되었다!`, 'field')
    return true
  }
  environment[rule.key] = rule.turns
  if (move.id === 'magicroom') updateMagicRoomSuppression(state, true)
  if (move.id === 'trickroom') {
    ;['player', 'opponent'].forEach((sideId) => {
      getActivePokemonList(state, sideId)
        .filter((pokemon) => pokemon?.hp > 0 && !pokemon.fainted && hasActiveHeldItem(pokemon, 'room-service'))
        .forEach((pokemon) => {
          consumeHeldItem(state, pokemon)
          appendLog(state, `${pokemon.name}의 룸서비스가 발동했다!`, 'item')
          changeStages(state, pokemon, { speed: -1 }, { source: pokemon })
        })
    })
  }
  if (move.id === 'gravity') {
    cancelGravityAffectedChargeMoves(state)
    allBattlePokemon(state).forEach((pokemon) => {
      pokemon.magnetRiseTurns = 0
      pokemon.telekinesisTurns = 0
      pokemon.semiInvulnerable = null
    })
  }
  appendLog(state, `${move.name}의 효과가 전장에 펼쳐졌다!`, 'field')
  return true
}

function swapStageGroups(first, second, statKeys) {
  statKeys.forEach((statKey) => {
    const previous = first.statStages[statKey]
    first.statStages[statKey] = second.statStages[statKey]
    second.statStages[statKey] = previous
  })
}

function swapHeldItems(state, first, second, sourceName, { ignoreSecondAbility = false } = {}) {
  const firstHasItem = hasHeldItem(first)
  const secondHasItem = hasHeldItem(second)
  if (!firstHasItem && !secondHasItem) {
    appendLog(state, '서로 바꿀 지닌물건이 없어 실패했다!', 'muted')
    return false
  }
  if (
    firstHasItem && !canRemoveHeldItem(first, second)
    || secondHasItem && !canRemoveHeldItem(second, first, {
      ignoreHolderAbility: ignoreSecondAbility,
    })
  ) {
    appendLog(state, '지닌물건을 바꿀 수 없어 실패했다!', 'ability')
    return false
  }
  const firstItem = {
    id: firstHasItem ? first.heldItemId : '',
    name: firstHasItem ? first.heldItemName : '',
  }
  first.heldItemId = secondHasItem ? second.heldItemId : ''
  first.heldItemName = secondHasItem ? second.heldItemName : ''
  first.consumedItem = false
  second.heldItemId = firstItem.id
  second.heldItemName = firstItem.name
  second.consumedItem = false
  first.hadHeldItem ||= Boolean(first.heldItemId)
  second.hadHeldItem ||= Boolean(second.heldItemId)
  appendLog(state, `${sourceName}으로 서로의 지닌물건을 바꿨다!`, 'item')
  return true
}

function copyTargetMoveIntoSlot(state, attacker, defender, move, permanent = false) {
  const targetMove = defender.moves[defender.lastMoveIndex]
  const sourceIndex = attacker.moves.findIndex((candidate) => candidate.id === move.id)
  const blockedByMoveFlag = permanent
    ? targetMove?.flags?.includes('nosketch')
    : targetMove?.flags?.includes('failmimic')
  if (!targetMove || sourceIndex < 0 || blockedByMoveFlag || CALL_MOVE_BLOCKLIST.has(targetMove.id)) {
    appendLog(state, `${move.name}은(는) 복사할 기술이 없어 실패했다!`, 'muted')
    return true
  }
  attacker.moves[sourceIndex] = {
    ...moveRuntime(targetMove, sourceIndex),
    maxPp: permanent ? targetMove.maxPp : Math.min(5, targetMove.maxPp),
    currentPp: permanent ? targetMove.maxPp : Math.min(5, targetMove.maxPp),
    copiedBy: move.id,
  }
  appendLog(state, `${attacker.name}은(는) ${targetMove.name}을(를) 기억했다!`, 'status')
  return true
}

function cureTeamStatuses(state, attacker, move) {
  const side = getPokemonSide(state, attacker)
  let cured = false
  side.team.forEach((pokemon) => {
    if (!pokemon.status) return
    pokemon.status = null
    cured = true
  })
  appendLog(state, cured ? `${side.name} 팀의 상태 이상이 회복되었다!` : '회복할 상태 이상이 없었다.', cured ? 'heal' : 'muted')
  return true
}

function addPokemonType(state, pokemon, type, sourceName) {
  if (pokemon.types.includes(type)) {
    appendLog(state, `${pokemon.name}은(는) 이미 ${type}타입이다!`, 'muted')
    return false
  }
  pokemon.types = [...pokemon.types, type].slice(-3)
  appendLog(state, `${pokemon.name}에게 ${type}타입이 추가되었다!`, 'status')
  state.lastEvent = { kind: 'type', targetId: pokemon.battleId, sourceName }
  return true
}

function applyAdvancedStatusMove(state, attacker, defender, move, random, context = {}) {
  if (setSideConditionFromMove(state, attacker, move)) return true
  if (setHazardFromMove(state, attacker, move)) return true
  if (setFieldEffectFromMove(state, move)) return true
  if (NO_EFFECT_MOVE_IDS.has(move.id)) {
    appendLog(state, `${move.name}! 하지만 배틀에는 아무 일도 일어나지 않았다.`, 'muted')
    return true
  }

  if (move.id === 'clangoroussoul') {
    const cost = Math.floor(attacker.maxHp / 3)
    if (attacker.hp <= cost) {
      appendLog(state, 'HP가 부족해 소울비트는 실패했다!', 'muted')
      attacker.moveFailedThisTurn = true
      return true
    }
    loseHp(state, attacker, cost, `${attacker.name}은(는) HP를 깎아 소울비트를 울렸다!`, 'status')
    changeStages(state, attacker, { attack: 1, defense: 1, specialAttack: 1, specialDefense: 1, speed: 1 })
    return true
  }

  if (move.id === 'filletaway') {
    const cost = Math.floor(attacker.maxHp / 2)
    if (attacker.hp <= cost) {
      appendLog(state, 'HP가 부족해 제살깎기는 실패했다!', 'muted')
      attacker.moveFailedThisTurn = true
      return true
    }
    loseHp(state, attacker, cost, `${attacker.name}은(는) 자신의 살을 깎아 힘을 끌어냈다!`, 'status')
    changeStages(state, attacker, { attack: 2, specialAttack: 2, speed: 2 })
    return true
  }

  if (move.id === 'shedtail') {
    const side = getPokemonSide(state, attacker)
    const cost = Math.floor(attacker.maxHp / 2)
    if (attacker.hp <= cost || availableBenchIndexes(side).length === 0) {
      appendLog(state, 'HP가 부족하거나 교대할 포켓몬이 없어 꼬리자르기는 실패했다!', 'muted')
      attacker.moveFailedThisTurn = true
      return true
    }
    loseHp(state, attacker, cost, `${attacker.name}은(는) 자신의 꼬리를 잘라 대타를 만들었다!`, 'status')
    attacker.pendingShedTailHp = Math.max(1, Math.floor(attacker.maxHp / 4))
    return true
  }

  if (move.id === 'batonpass') {
    if (availableBenchIndexes(getPokemonSide(state, attacker)).length === 0) {
      appendLog(state, '교대할 포켓몬이 없어 배턴터치는 실패했다!', 'muted')
      attacker.moveFailedThisTurn = true
    } else {
      appendLog(state, `${attacker.name}은(는) 능력 변화를 이어 넘긴다!`, 'status')
    }
    return true
  }

  if (['healbell', 'aromatherapy'].includes(move.id)) return cureTeamStatuses(state, attacker, move)
  if (move.id === 'haze') {
    ;['player', 'opponent'].forEach((sideId) => getActivePokemonList(state, sideId).forEach(resetPokemonStatStages))
    appendLog(state, '모든 능력 변화가 원래대로 돌아왔다!', 'field')
    return true
  }
  if (move.id === 'bellydrum') {
    if (attacker.hp <= attacker.maxHp / 2 || attacker.statStages.attack >= 6) {
      appendLog(state, '그러나 배북은 실패했다!', 'muted')
      return true
    }
    loseHp(state, attacker, attacker.maxHp / 2, `${attacker.name}은(는) HP를 크게 깎아 힘을 끌어냈다!`, 'status')
    attacker.statStages.attack = 6
    appendLog(state, `${attacker.name}의 공격이 최고로 올라갔다!`, 'status')
    return true
  }
  if (move.id === 'substitute') {
    const cost = Math.floor(attacker.maxHp / 4)
    if (attacker.substituteHp > 0 || attacker.hp <= cost) {
      appendLog(state, '그러나 대타출동은 실패했다!', 'muted')
      return true
    }
    attacker.hp -= cost
    attacker.substituteHp = cost
    appendLog(state, `${attacker.name}의 대타가 나타났다!`, 'status')
    return true
  }
  if (move.id === 'curse') {
    if (attacker.types.includes('고스트')) {
      if (defender.cursedActive || attacker.hp <= Math.floor(attacker.maxHp / 2)) {
        appendLog(state, '그러나 저주는 실패했다!', 'muted')
        return true
      }
      loseHp(state, attacker, attacker.maxHp / 2, `${attacker.name}은(는) 자신의 HP를 깎아 저주를 걸었다!`, 'status')
      defender.cursedActive = true
    } else {
      changeStages(state, attacker, { attack: 1, defense: 1, speed: -1 })
    }
    return true
  }
  if (move.id === 'stockpile') {
    if (attacker.stockpileCount >= 3) {
      appendLog(state, '더 이상 비축할 수 없다!', 'muted')
      return true
    }
    attacker.stockpileCount += 1
    const beforeDefense = attacker.statStages.defense
    const beforeSpecialDefense = attacker.statStages.specialDefense
    changeStages(state, attacker, { defense: 1, specialDefense: 1 })
    attacker.stockpileBoosts.defense += attacker.statStages.defense - beforeDefense
    attacker.stockpileBoosts.specialDefense += attacker.statStages.specialDefense - beforeSpecialDefense
    appendLog(state, `${attacker.name}은(는) ${attacker.stockpileCount}번 비축했다!`, 'status')
    return true
  }
  if (move.id === 'swallow') {
    const count = attacker.stockpileCount
    if (!count) {
      appendLog(state, '비축한 힘이 없어 꿀꺽은 실패했다!', 'muted')
      return true
    }
    const fractions = { 1: [1, 4], 2: [1, 2], 3: [1, 1] }
    const [numerator, denominator] = fractions[count]
    healPokemon(state, attacker, attacker.maxHp * numerator / denominator, move.name)
    changeStages(state, attacker, {
      defense: -attacker.stockpileBoosts.defense,
      specialDefense: -attacker.stockpileBoosts.specialDefense,
    })
    attacker.stockpileCount = 0
    attacker.stockpileBoosts = { defense: 0, specialDefense: 0 }
    return true
  }
  if (move.id === 'painsplit') {
    const sharedHp = Math.floor((attacker.hp + defender.hp) / 2)
    attacker.hp = Math.min(attacker.maxHp, sharedHp)
    defender.hp = Math.min(defender.maxHp, sharedHp)
    appendLog(state, '서로의 HP를 합쳐 똑같이 나눴다!', 'status')
    return true
  }
  if (move.id === 'wish') {
    const side = getPokemonSide(state, attacker)
    const slot = context.actorSlot ?? activeSlotIndex(state, side)
    side.wishSlots[slot] = { turns: 2, amount: Math.floor(attacker.maxHp / 2), sourceName: attacker.name }
    appendLog(state, `${attacker.name}은(는) 소원을 빌었다!`, 'heal')
    return true
  }
  if (['mindreader', 'lockon'].includes(move.id)) {
    attacker.sureHitTargetBattleId = defender.battleId
    attacker.sureHitTurns = 2
    appendLog(state, `${attacker.name}은(는) ${defender.name}에게 조준을 맞췄다!`, 'status')
    return true
  }
  if (move.id === 'spite') {
    const targetMove = defender.moves[defender.lastMoveIndex]
    if (!targetMove) appendLog(state, '원한을 품을 기술이 없어 실패했다!', 'muted')
    else {
      const loss = Math.min(4, targetMove.currentPp)
      targetMove.currentPp -= loss
      appendLog(state, `${targetMove.name}의 PP가 ${loss} 줄었다!`, 'status')
    }
    return true
  }
  if (move.id === 'psychoshift') {
    if (!attacker.status || defender.status) appendLog(state, '옮길 상태 이상이 없어 실패했다!', 'muted')
    else {
      const statusId = attacker.status.id
      if (setStatus(state, defender, statusId, move.name, { source: attacker })) attacker.status = null
    }
    return true
  }
  if (move.id === 'imprison') {
    attacker.imprisonActive = true
    appendLog(state, `${attacker.name}은(는) 자신이 아는 기술을 봉인했다!`, 'status')
    return true
  }
  if (move.id === 'afteryou') {
    if (Number(state.rules?.format?.activeSlots ?? 1) <= 1 || defender.actedThisTurn || !defender.plannedActionType) {
      appendLog(state, '행동 순서를 앞당길 수 없어 당신먼저는 실패했다!', 'muted')
      return true
    }
    defender.nextTurnOrderBias = 2
    appendLog(state, `${defender.name}은(는) 바로 다음에 행동하게 되었다!`, 'status')
    return true
  }
  if (move.id === 'quash') {
    if (Number(state.rules?.format?.activeSlots ?? 1) <= 1 || defender.actedThisTurn || !defender.plannedActionType) {
      appendLog(state, '행동 순서를 미룰 수 없어 순서는 실패했다!', 'muted')
      return true
    }
    defender.nextTurnOrderBias = -2
    appendLog(state, `${defender.name}의 행동 순서가 뒤로 밀렸다!`, 'status')
    return true
  }
  if (['refresh', 'takeheart'].includes(move.id)) {
    const recoverable = ['burn', 'paralysis', 'poison', 'toxic'].includes(attacker.status?.id)
    if (recoverable) attacker.status = null
    if (move.id === 'takeheart') changeStages(state, attacker, { specialAttack: 1, specialDefense: 1 })
    appendLog(state, recoverable ? `${attacker.name}의 상태 이상이 회복되었다!` : `${move.name}의 힘이 발동했다!`, recoverable ? 'heal' : 'status')
    return true
  }
  if (['trick', 'switcheroo'].includes(move.id)) {
    return swapHeldItems(state, attacker, defender, move.name, {
      ignoreSecondAbility: moveIgnoresAbility(move, defender),
    })
  }
  if (move.id === 'bestow') {
    if (!canRemoveHeldItem(attacker, defender) || hasHeldItem(defender)) {
      appendLog(state, '건넬 수 있는 지닌물건이 없어 실패했다!', 'muted')
      return true
    }
    defender.heldItemId = attacker.heldItemId
    defender.heldItemName = attacker.heldItemName
    defender.consumedItem = false
    clearHeldItem(attacker)
    appendLog(state, `${attacker.name}은(는) ${defender.name}에게 지닌물건을 건넸다!`, 'item')
    return true
  }
  if (move.id === 'recycle') {
    if (!attacker.consumedItem || !attacker.heldItemId) appendLog(state, '재생할 도구가 없어 실패했다!', 'muted')
    else {
      attacker.consumedItem = false
      appendLog(state, `${attacker.name}은(는) 사용한 도구를 재생했다!`, 'item')
    }
    return true
  }
  if (move.id === 'corrosivegas') {
    const targets = [...new Map([
      defender,
      ...activeAllies(state, attacker),
      ...activeAllies(state, defender),
    ].filter((pokemon) => pokemon?.battleId !== attacker.battleId)
      .map((pokemon) => [pokemon.battleId, pokemon])).values()]
    let removed = false
    targets.forEach((pokemon) => {
      if (!canRemoveHeldItem(pokemon, attacker, {
        ignoreHolderAbility: moveIgnoresAbility(move, pokemon),
      })) return
      clearHeldItem(pokemon)
      removed = true
    })
    appendLog(
      state,
      removed ? '부식가스가 주변 포켓몬의 지닌물건을 녹였다!' : '그러나 녹일 수 있는 지닌물건이 없었다!',
      removed ? 'item' : 'muted',
    )
    return true
  }
  if (['mimic', 'sketch'].includes(move.id)) return copyTargetMoveIntoSlot(state, attacker, defender, move, move.id === 'sketch')
  if (move.id === 'conversion') {
    const sourceMove = attacker.moves.find((candidate) => candidate.id !== 'conversion')
    if (sourceMove) attacker.types = [sourceMove.type]
    appendLog(state, `${attacker.name}은(는) ${sourceMove?.type ?? attacker.types[0]}타입으로 변했다!`, 'status')
    return true
  }
  if (move.id === 'conversion2') {
    const targetMove = defender.moves[defender.lastMoveIndex]
    const resistantType = Object.keys(TYPE_CHART).find((type) => (TYPE_CHART[targetMove?.type]?.[type] ?? 1) < 1)
    if (targetMove && resistantType) attacker.types = [resistantType]
    appendLog(state, targetMove && resistantType ? `${attacker.name}은(는) ${resistantType}타입으로 변했다!` : '그러나 실패했다!', targetMove && resistantType ? 'status' : 'muted')
    return true
  }
  if (move.id === 'camouflage') {
    const terrainTypes = { electric: '전기', grassy: '풀', misty: '페어리', psychic: '에스퍼', neutral: '노말' }
    attacker.types = [terrainTypes[state.rules?.terrain?.id] ?? '노말']
    appendLog(state, `${attacker.name}의 타입이 ${attacker.types[0]}타입으로 변했다!`, 'status')
    return true
  }
  if (move.id === 'reflecttype') {
    attacker.types = [...defender.types]
    appendLog(state, `${attacker.name}은(는) ${defender.name}의 타입을 따라 했다!`, 'status')
    return true
  }
  if (move.id === 'soak') {
    defender.types = ['물']
    appendLog(state, `${defender.name}은(는) 물타입이 되었다!`, 'status')
    return true
  }
  if (move.id === 'magicpowder') {
    defender.types = ['에스퍼']
    appendLog(state, `${defender.name}은(는) 에스퍼타입이 되었다!`, 'status')
    return true
  }
  if (move.id === 'trickortreat') return addPokemonType(state, defender, '고스트', move.name) || true
  if (move.id === 'forestscurse') return addPokemonType(state, defender, '풀', move.name) || true
  if (move.id === 'psychup') {
    attacker.statStages = { ...defender.statStages }
    appendLog(state, `${attacker.name}은(는) ${defender.name}의 능력 변화를 복사했다!`, 'status')
    return true
  }
  if (move.id === 'topsyturvy') {
    defender.statStages = Object.fromEntries(Object.entries(defender.statStages).map(([key, value]) => [key, -value]))
    appendLog(state, `${defender.name}의 능력 변화가 뒤집혔다!`, 'status')
    return true
  }
  if (move.id === 'powerswap') {
    swapStageGroups(attacker, defender, ['attack', 'specialAttack'])
    appendLog(state, '서로의 공격 능력 변화를 맞바꿨다!', 'status')
    return true
  }
  if (move.id === 'guardswap') {
    swapStageGroups(attacker, defender, ['defense', 'specialDefense'])
    appendLog(state, '서로의 방어 능력 변화를 맞바꿨다!', 'status')
    return true
  }
  if (move.id === 'heartswap') {
    swapStageGroups(attacker, defender, Object.keys(attacker.statStages))
    appendLog(state, '서로의 모든 능력 변화를 맞바꿨다!', 'status')
    return true
  }
  if (['guardsplit', 'powersplit'].includes(move.id)) {
    const keys = move.id === 'guardsplit' ? ['defense', 'specialDefense'] : ['attack', 'specialAttack']
    keys.forEach((key) => {
      const average = Math.floor((attacker.stats[key] + defender.stats[key]) / 2)
      attacker.stats[key] = average
      defender.stats[key] = average
    })
    appendLog(state, `${move.name}으로 서로의 능력을 평균화했다!`, 'status')
    return true
  }
  if (move.id === 'speedswap') {
    const speed = attacker.stats.speed
    attacker.stats.speed = defender.stats.speed
    defender.stats.speed = speed
    appendLog(state, '서로의 스피드를 맞바꿨다!', 'status')
    return true
  }
  if (['powertrick', 'powershift'].includes(move.id)) {
    const attack = attacker.stats.attack
    attacker.stats.attack = attacker.stats.defense
    attacker.stats.defense = attack
    appendLog(state, `${attacker.name}의 공격과 방어가 뒤바뀌었다!`, 'status')
    return true
  }
  if (move.id === 'skillswap') {
    if (!abilityCanBeChanged(attacker) || !abilityCanBeChanged(defender)) appendLog(state, '특성을 바꿀 수 없어 실패했다!', 'muted')
    else {
      const ability = attacker.ability
      attacker.ability = defender.ability
      defender.ability = ability
      appendLog(state, '서로의 특성을 맞바꿨다!', 'ability')
    }
    return true
  }
  if (move.id === 'roleplay') {
    if (abilityCanBeChanged(attacker) && !UNTRACEABLE_ABILITIES.has(defender.ability)) attacker.ability = defender.ability
    appendLog(state, `${attacker.name}은(는) ${defender.ability} 특성을 따라 했다!`, 'ability')
    return true
  }
  if (move.id === 'simplebeam') {
    if (abilityCanBeChanged(defender)) defender.ability = '단순'
    appendLog(state, `${defender.name}의 특성이 단순로 바뀌었다!`, 'ability')
    return true
  }
  if (move.id === 'worryseed') {
    if (abilityCanBeChanged(defender)) defender.ability = '불면'
    appendLog(state, `${defender.name}의 특성이 불면으로 바뀌었다!`, 'ability')
    return true
  }
  if (move.id === 'entrainment') {
    if (abilityCanBeChanged(defender)) defender.ability = attacker.ability
    appendLog(state, `${defender.name}의 특성이 ${attacker.ability}(으)로 바뀌었다!`, 'ability')
    return true
  }
  if (move.id === 'doodle') {
    const side = getPokemonSide(state, attacker)
    getActivePokemonList(state, side.id).forEach((pokemon) => {
      if (abilityCanBeChanged(pokemon)) pokemon.ability = defender.ability
    })
    appendLog(state, `${attacker.name} 진영이 ${defender.ability} 특성을 베껴 그렸다!`, 'ability')
    return true
  }
  if (move.id === 'floralhealing') {
    const fraction = state.rules?.terrain?.id === 'grassy' ? 2 / 3 : 1 / 2
    healPokemon(state, defender, defender.maxHp * fraction, move.name)
    return true
  }
  if (move.id === 'healpulse') {
    healPokemon(state, defender, defender.maxHp * (attacker.ability === '메가런처' ? 3 / 4 : 1 / 2), move.name)
    return true
  }
  if (move.id === 'strengthsap') {
    if (defender.statStages.attack <= -6) {
      appendLog(state, `${defender.name}의 공격은 더 이상 떨어지지 않는다!`, 'muted')
      return true
    }
    const drainAmount = effectiveStat(state, defender, 'attack')
    changeStages(state, defender, { attack: -1 }, {
      source: attacker,
      ignoreAbility: Boolean(move.ignoreAbility),
    })
    applyDrainingRecovery(state, attacker, defender, drainAmount, move.name, {
      ignoreDrainedAbility: moveIgnoresAbility(move, defender),
    })
    return true
  }
  if (move.id === 'purify') {
    if (defender.status) {
      defender.status = null
      healPokemon(state, attacker, attacker.maxHp / 2, move.name)
    } else appendLog(state, '회복할 상태 이상이 없어 실패했다!', 'muted')
    return true
  }
  if (['junglehealing', 'lunarblessing'].includes(move.id)) {
    const side = getPokemonSide(state, attacker)
    getActivePokemonList(state, side.id).forEach((pokemon) => {
      pokemon.status = null
      healPokemon(state, pokemon, pokemon.maxHp / 4, move.name)
    })
    return true
  }
  if (move.id === 'acupressure') {
    const target = move.target === 'adjacentAllyOrSelf' && defender ? defender : attacker
    const stats = Object.keys(target.statStages).filter((key) => target.statStages[key] < 6)
    const stat = stats[Math.floor(random() * stats.length)]
    if (stat) changeStages(state, target, { [stat]: 2 })
    else appendLog(state, '더 올릴 수 있는 능력이 없었다!', 'muted')
    return true
  }
  if (move.id === 'venomdrench') {
    getActivePokemonList(state, getPokemonSide(state, defender).id)
      .filter((pokemon) => ['poison', 'toxic'].includes(pokemon.status?.id))
      .forEach((pokemon) => changeStages(state, pokemon, { attack: -1, specialAttack: -1, speed: -1 }, { source: attacker }))
    return true
  }
  if (move.id === 'flowershield') {
    ;['player', 'opponent'].forEach((sideId) => getActivePokemonList(state, sideId)
      .filter((pokemon) => pokemon.types.includes('풀'))
      .forEach((pokemon) => changeStages(state, pokemon, { defense: 1 }, { source: attacker })))
    return true
  }
  if (['gearup', 'magneticflux'].includes(move.id)) {
    const boosts = move.id === 'gearup'
      ? { attack: 1, specialAttack: 1 }
      : { defense: 1, specialDefense: 1 }
    getActivePokemonList(state, getPokemonSide(state, attacker).id)
      .filter((pokemon) => PLUS_MINUS_ABILITIES.has(pokemon.ability))
      .forEach((pokemon) => changeStages(state, pokemon, boosts))
    return true
  }
  if (move.id === 'rototiller') {
    ;['player', 'opponent'].forEach((sideId) => getActivePokemonList(state, sideId)
      .filter((pokemon) => pokemon.types.includes('풀') && isGrounded(pokemon, state))
      .forEach((pokemon) => changeStages(state, pokemon, { attack: 1, specialAttack: 1 })))
    return true
  }
  if (move.id === 'teatime') {
    allBattlePokemon(state).filter((pokemon) => pokemon.heldItemId?.endsWith('-berry'))
      .forEach((pokemon) => consumeBerryImmediately(state, pokemon, random))
    appendLog(state, '모두가 티타임을 즐기며 나무열매를 먹었다!', 'item')
    return true
  }
  if (move.id === 'stuffcheeks') {
    if (!attacker.heldItemId?.endsWith('-berry') || attacker.consumedItem) appendLog(state, '먹을 나무열매가 없어 실패했다!', 'muted')
    else {
      consumeBerryImmediately(state, attacker, random)
      changeStages(state, attacker, { defense: 2 })
    }
    return true
  }
  if (move.id === 'tidyup') {
    ;[state.player, state.opponent].forEach((side) => {
      side.hazards.spikes = 0
      side.hazards.stealthRock = false
      side.hazards.stickyWeb = false
      side.hazards.toxicSpikes = 0
      side.team.forEach((pokemon) => { pokemon.substituteHp = 0 })
    })
    changeStages(state, attacker, { attack: 1, speed: 1 })
    appendLog(state, '전장의 함정과 대타가 모두 정리되었다!', 'field')
    return true
  }
  if (move.id === 'courtchange') {
    const first = state.player
    const second = state.opponent
    const keys = ['auroraVeilTurns', 'lightScreenTurns', 'reflectTurns', 'safeguardTurns', 'mistTurns', 'tailwindTurns']
    keys.forEach((key) => {
      const value = first[key]
      first[key] = second[key]
      second[key] = value
    })
    const hazards = first.hazards
    first.hazards = second.hazards
    second.hazards = hazards
    appendLog(state, '서로의 진영 효과가 뒤바뀌었다!', 'field')
    return true
  }
  if (move.id === 'allyswitch') {
    const side = getPokemonSide(state, attacker)
    if (side.activeIndexes.length < 2) appendLog(state, '자리를 바꿀 동료가 없어 실패했다!', 'muted')
    else {
      side.activeIndexes.reverse()
      appendLog(state, `${attacker.name} 진영의 위치가 뒤바뀌었다!`, 'status')
    }
    return true
  }
  return false
}

function lastMoveForPokemon(pokemon) {
  return pokemon?.moves?.[pokemon.lastMoveIndex] ?? null
}

function resolveCalledMove(state, attacker, defender, move, random, previousBattleMove) {
  let calledMove = null
  let user = attacker
  if (move.id === 'metronome') {
    const candidates = MOVE_CATALOG.filter((candidate) => (
      candidate.flags?.includes('metronome')
      && !CALL_MOVE_BLOCKLIST.has(candidate.id)
    ))
    calledMove = candidates[Math.floor(random() * candidates.length)]
  } else if (move.id === 'assist') {
    const side = getPokemonSide(state, attacker)
    const candidates = side.team.flatMap((pokemon) => pokemon.moves)
      .filter((candidate) => !CALL_MOVE_BLOCKLIST.has(candidate.id) && !candidate.flags?.includes('noassist'))
    calledMove = candidates[Math.floor(random() * candidates.length)]
  } else if (move.id === 'sleeptalk') {
    if (!isPokemonAsleep(attacker)) return null
    const candidates = attacker.moves.filter((candidate) => (
      candidate.id !== 'sleeptalk'
      && !candidate.flags?.includes('nosleeptalk')
      && !candidate.flags?.includes('charge')
      && !CALL_MOVE_BLOCKLIST.has(candidate.id)
    ))
    calledMove = candidates[Math.floor(random() * candidates.length)]
  } else if (move.id === 'naturepower') {
    const moveByTerrain = {
      electric: 'thunderbolt',
      grassy: 'energyball',
      misty: 'moonblast',
      psychic: 'psychic',
      neutral: 'triattack',
    }
    calledMove = getMoveById(moveByTerrain[state.rules?.terrain?.id] ?? 'triattack')
  } else if (move.id === 'copycat') {
    const previousMove = getMoveById(previousBattleMove?.moveId)
    calledMove = previousMove?.flags?.includes('failcopycat') ? null : previousMove
  } else if (move.id === 'mirrormove') {
    const mirroredMove = lastMoveForPokemon(defender)
    calledMove = mirroredMove?.flags?.includes('mirror') ? mirroredMove : null
  } else if (move.id === 'mefirst') {
    const targetMove = defender.moves.find((candidate) => candidate.id === defender.plannedMoveId)
      ?? getMoveById(defender.plannedMoveId)
    calledMove = !defender.actedThisTurn
      && defender.plannedActionType === 'move'
      && targetMove
      && !isStatusMove(targetMove)
      && !targetMove.flags?.includes('failmefirst')
      ? { ...targetMove, power: targetMove.power * 1.5 }
      : null
  } else if (move.id === 'instruct') {
    user = defender
    const instructedMove = lastMoveForPokemon(defender)
    calledMove = instructedMove?.flags?.includes('failinstruct') ? null : instructedMove
  }
  if (!calledMove || CALL_MOVE_BLOCKLIST.has(calledMove.id)) return null

  const userSide = getPokemonSide(state, user)
  const targetSide = getOtherSide(state, userSide.id)
  const actorSlot = getActivePokemonList(state, userSide.id).findIndex((pokemon) => pokemon?.battleId === user.battleId)
  const requestedTarget = user === attacker ? defender : attacker
  const targetSlot = getActivePokemonList(state, targetSide.id)
    .findIndex((pokemon) => pokemon?.battleId === requestedTarget.battleId)
  return {
    sideId: userSide.id,
    action: {
      type: 'move',
      actorSlot: Math.max(0, actorSlot),
      targetSlot: Math.max(0, targetSlot),
      moveIndex: user.lastMoveIndex ?? 0,
      gimmick: null,
      dancerCopy: true,
      copiedMove: { ...calledMove },
    },
  }
}

function applyStatusMove(state, attacker, defender, move, random, context = {}) {
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

  if (
    defender !== attacker
    && move.flags?.includes('powder')
    && (
      defender.types.includes('풀')
      || defender.ability === '방진'
      || hasActiveHeldItem(defender, 'safety-goggles')
    )
  ) {
    appendLog(state, `${defender.name}에게는 가루 기술이 통하지 않는다!`, 'muted')
    return true
  }

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
    if (!setStatus(state, attacker, 'sleep', move.name, { source: attacker, random })) {
      attacker.status = previousStatus
      appendLog(state, `${attacker.name}은(는) 잠들 수 없어 잠자기에 실패했다!`, 'muted')
      return true
    }
    if (attacker.status?.id === 'sleep') {
      attacker.status.counter = attacker.ability === '일찍기상' ? 2 : 3
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
    if (move.id === 'roost') attacker.roostedThisTurn = true
    const [numerator, denominator] = healingMoveFraction(state, attacker, move)
    healPokemon(state, attacker, attacker.maxHp * numerator / denominator, move.name)
    return true
  }

  if (move.id === 'autotomize') {
    attacker.weightReduction = Math.min(10000, (attacker.weightReduction ?? 0) + 1000)
    appendLog(state, `${attacker.name}은(는) 몸을 깎아 무게가 100kg 줄었다!`, 'status')
  }

  if (applyAdvancedStatusMove(state, attacker, defender, move, random, context)) return true

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

  const options = { source: attacker, ignoreAbility: Boolean(move.ignoreAbility), random }
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
  const targetEffectBlocked = (!moveIgnoresAbility(move, defender) && defender.ability === '인분')
    || hasActiveHeldItem(defender, 'covert-cloak')
  for (let attempt = 0; attempt < Math.max(1, attempts); attempt += 1) {
    effects.forEach((effect) => {
      if (random() * 100 >= secondaryEffectChance(state, attacker, effect)) return

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

  if (pokemon.skyDropSourceBattleId) {
    appendLog(state, `${pokemon.name}은(는) 프리폴에 붙잡혀 움직일 수 없다!`, 'status')
    return false
  }

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
      if (move?.sleepUsable) {
        appendLog(state, `${pokemon.name}은(는) 잠든 채 ${move.name}을(를) 사용한다!`, 'status')
        return true
      }
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
    if (random() < 1 / 3) {
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
  const relatedForm = getRelatedFormOptions(pokemon.originalSpeciesId)
    .find((form) => form.slug === slug)
  if (relatedForm) return relatedForm

  const visualOverride = VISUAL_BATTLE_FORM_OVERRIDES[slug]
  const baseSpeciesId = Number(pokemon.battleBaseSpeciesId ?? pokemon.originalSpeciesId)
  if (!visualOverride || Number(visualOverride.speciesId) !== baseSpeciesId) return null
  const baseProfile = getSpeciesProfile(visualOverride.speciesId)
  return baseProfile ? { ...baseProfile, ...visualOverride, id: baseProfile.id } : null
}

function changeBattleForm(state, pokemon, targetFormOrSlug, sourceName, options = {}) {
  const form = typeof targetFormOrSlug === 'string'
    ? relatedFormBySlug(pokemon, targetFormOrSlug)
    : targetFormOrSlug
  if (
    !form
    || Number(form.id) === Number(pokemon.speciesId) && form.slug === currentSpeciesSlug(pokemon)
  ) return false

  const previousSnapshot = mechanicPokemonSnapshot(pokemon)
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
  pokemon.originalTypes = [...form.types]
  pokemon.types = pokemon.teraActive ? [pokemon.teraType] : [...form.types]
  pokemon.ability = preservedAbility
  pokemon.stats = nextStats
  pokemon.originalMaxHp = nextBaseMaxHp
  pokemon.maxHp = nextMaxHp
  pokemon.hp = previousHp <= 0 ? 0 : Math.max(1, Math.min(nextMaxHp, Math.ceil(preservedHp)))
  pokemon.spriteFront = form.spriteFront ?? transformed.spriteFront
  pokemon.spriteBack = form.spriteBack ?? transformed.spriteBack
  pokemon.spriteFrontFallback = form.spriteFrontFallback ?? transformed.spriteFrontFallback
  pokemon.spriteBackFallback = form.spriteBackFallback ?? transformed.spriteBackFallback

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
  emitFormChangeTimeline(state, pokemon, previousSnapshot, sourceName, options)
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
  const baseProfile = getSpeciesProfile(pokemon.battleBaseSpeciesId ?? pokemon.originalSpeciesId)
  const typeFormSlug = TYPE_FORM_SLUG_BY_KO[itemType]
  const targetFormSlug = itemType === '노말' || !typeFormSlug
    ? baseProfile?.slug
    : `${baseProfile?.slug}-${typeFormSlug}`
  const formChanged = targetFormSlug
    ? changeBattleForm(state, pokemon, targetFormSlug, pokemon.ability, {
      hpMode: 'damage',
      log: false,
    })
    : false
  const typeChanged = pokemon.types.length !== 1 || pokemon.types[0] !== itemType
  if (!formChanged && !typeChanged) return false
  pokemon.types = [itemType]
  appendLog(state, `${pokemon.name}의 ${pokemon.ability}! ${itemType}타입이 되었다!`, 'ability')
  return true
}

function refreshHeldItemForm(state, pokemon) {
  const rule = HELD_ITEM_FORM_RULES[pokemon.heldItemId]
  if (!rule || !hasHeldItem(pokemon) || !pokemonMatchesSpecies(pokemon, rule.species)) return false
  return changeBattleForm(state, pokemon, rule.form, pokemon.heldItemName || pokemon.heldItemId, {
    hpMode: 'damage',
    log: false,
  })
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
    changeBattleForm(
      state,
      pokemon,
      active ? 'cherrim-sunshine' : 'cherrim',
      pokemon.ability,
      { log: false },
    )
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
  if (meteor) return color === 'red' ? 'minior-red-meteor' : `minior-${color}-meteor`
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
  const battleModeForm = ENTRY_BATTLE_MODE_FORM_RULES[currentSpeciesSlug(pokemon)]
  if (battleModeForm) {
    changeBattleForm(state, pokemon, battleModeForm, '배틀 모드', { hpMode: 'damage' })
  }
  refreshHeldItemForm(state, pokemon)
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

function releaseTrapsSourcedBy(state, sourcePokemon) {
  allBattlePokemon(state).forEach((pokemon) => {
    if (pokemon.trapSourceBattleId !== sourcePokemon?.battleId) return
    pokemon.trappedTurns = 0
    pokemon.trapSourceName = null
    pokemon.trapSourceBattleId = null
    pokemon.trapDamages = false
  })
}

function prepareSwitchOutForm(state, pokemon) {
  if (!pokemon || pokemon.fainted || pokemon.hp <= 0) return
  releaseSkyDropConnections(state, pokemon)
  releaseTrapsSourcedBy(state, pokemon)
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
    changeBattleForm(state, pokemon, 'palafin-hero', pokemon.ability, { animate: false })
  } else if (pokemon.ability === '배틀스위치' && slug === 'aegislash-blade') {
    changeBattleForm(state, pokemon, 'aegislash', pokemon.ability, { log: false, animate: false })
  } else if (slug === 'meloetta-pirouette') {
    changeBattleForm(state, pokemon, 'meloetta', '폼 복원', { log: false, animate: false })
  } else if (pokemon.ability === '기분파' && slug !== 'castform') {
    changeBattleForm(state, pokemon, 'castform', pokemon.ability, { log: false, animate: false })
  } else if (pokemon.ability === '플라워기프트' && slug === 'cherrim-sunshine') {
    changeBattleForm(state, pokemon, 'cherrim', pokemon.ability, { log: false, animate: false })
  } else if (pokemon.ability === '달마모드' && slug.includes('zen')) {
    changeBattleForm(
      state,
      pokemon,
      slug.includes('galar') ? 'darmanitan-galar-standard' : 'darmanitan',
      pokemon.ability,
      { log: false, animate: false },
    )
  } else if (pokemon.ability === '그대로꿀꺽미사일' && slug !== 'cramorant') {
    changeBattleForm(state, pokemon, 'cramorant', pokemon.ability, { log: false, animate: false })
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
  if (pokemon.typeRemovedByMove) {
    pokemon.typeRemovedByMove = false
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
  if (requestedDamage <= 0 || moveIgnoresAbility(move, defender)) return null
  const slug = currentSpeciesSlug(defender)
  if (defender.ability === '탈' && ['mimikyu', 'mimikyu-totem-disguised'].includes(slug)) {
    const targetSlug = slug === 'mimikyu-totem-disguised' ? 'mimikyu-totem-busted' : 'mimikyu-busted'
    changeBattleForm(state, defender, targetSlug, defender.ability, { deferTimeline: true })
    loseHp(state, defender, defender.maxHp / 8, `${defender.name}은(는) 탈이 벗겨져 HP가 줄었다.`, 'ability')
    return { damage: 0, effectiveness: 1 }
  }
  if (defender.ability === '아이스페이스' && slug === 'eiscue' && move.categoryId === 'physical') {
    defender.iceFaceBroken = true
    changeBattleForm(state, defender, 'eiscue-noice', defender.ability, { deferTimeline: true })
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
}

function applyKnockoutTriggeredFormAfterFaint(state, attacker, defender, directDamage) {
  if (
    directDamage <= 0
    || !defender.fainted
    || attacker.hp <= 0
    || attacker.fainted
    || attacker.transformSnapshot
    || attacker.ability !== '유대변화'
    || attacker.bondTriggered
    || currentSpeciesSlug(attacker) !== 'greninja-battle-bond'
    || remainingCount(getPokemonSide(state, defender)) <= 0
  ) return false

  attacker.bondTriggered = true
  return changeBattleForm(state, attacker, 'greninja-ash', attacker.ability, {
    mechanicId: 'battle-bond',
  })
}

function battleMechanicFormOptions(pokemon, mechanicId) {
  const formMarker = mechanicId === 'primal' ? '-primal' : '-mega'
  return getBattleFormOptions(pokemon.originalSpeciesId)
    .filter((option) => option.slug?.includes(formMarker))
}

function resolveBattleMechanicForm(pokemon, mechanicId, requestedFormId = null) {
  const candidates = battleMechanicFormOptions(pokemon, mechanicId)
  if (!candidates.length) return null

  const requestedForm = getSpeciesProfile(requestedFormId)
  if (requestedForm && candidates.some((candidate) => candidate.id === requestedForm.id)) {
    return requestedForm
  }

  if (mechanicId === 'mega') {
    const item = getBattleItem(pokemon.heldItemId)
    const configuredTarget = item?.targetFormSlugs?.find((slug) => (
      candidates.some((candidate) => candidate.slug === slug)
    ))
    if (configuredTarget) return candidates.find((candidate) => candidate.slug === configuredTarget)

    const variant = pokemon.heldItemId?.match(/-(x|y|z)$/)?.[1]
    if (variant) {
      const variantForm = candidates.find((candidate) => candidate.slug.endsWith(`-mega-${variant}`))
      if (variantForm) return variantForm
    }
  }

  return candidates[0]
}

function transformPokemon(state, pokemon, formId, mechanicId) {
  const form = mechanicId === 'ultra'
    ? getSpeciesProfile(formId)
    : resolveBattleMechanicForm(pokemon, mechanicId, formId)
  if (!form) return false

  if (!changeBattleForm(state, pokemon, form, MECHANIC_LABELS[mechanicId], { log: false, animate: false })) return false
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
  const compatibleForm = getGigantamaxProfile(pokemon.originalSpeciesId)
  const configuredForm = pokemon.gimmickFormId ? getSpeciesProfile(pokemon.gimmickFormId) : null
  const form = configuredForm?.slug?.includes('-gmax') && configuredForm.id === compatibleForm?.id
    ? configuredForm
    : compatibleForm
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

  const hasMegaForm = battleMechanicFormOptions(pokemon, 'mega').length > 0
  const hasPrimalForm = battleMechanicFormOptions(pokemon, 'primal').length > 0
  const rayquazaCanMegaEvolve = currentSpeciesSlug(pokemon) === 'rayquaza'
    && pokemon.moves.some((move) => move.id === 'dragonascent')
  const hasMegaStone = megaStoneMatchesPokemon(getBattleItem(pokemon.heldItemId), pokemon)
    || configured.includes('mega')
    || rayquazaCanMegaEvolve
  const hasPrimalOrb = hasHeldItem(pokemon, currentSpeciesSlug(pokemon) === 'groudon' ? 'red-orb' : 'blue-orb')
    || configured.includes('primal')
  const hasZCrystal = pokemon.heldItemId?.includes('-z') || pokemon.heldItemId?.includes('ium-z')
  const hasCompatibleZMove = hasZCrystal && hasCompatibleBattleZMove(pokemon)

  if (!side.usedMechanics.mega && allow('mega') && hasMegaForm && hasMegaStone) {
    available.push({ id: 'mega', label: '메가진화', shortLabel: 'MEGA' })
  }
  if (!side.usedMechanics.primal && allow('primal') && hasPrimalForm && hasPrimalOrb) {
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
    const ogerponTeraRule = pokemon.battleBaseSpeciesId === 1017
      ? OGERPON_TERA_FORM_RULES[currentSpeciesSlug(pokemon)] ?? OGERPON_TERA_FORM_RULES.ogerpon
      : null
    const terapagosStellar = pokemon.battleBaseSpeciesId === 1024
      ? relatedFormBySlug(pokemon, 'terapagos-stellar')
      : null
    if (terapagosStellar) {
      changeBattleForm(state, pokemon, terapagosStellar, '테라스탈', {
        hpMode: 'damage',
        log: false,
        animate: false,
      })
      pokemon.teraType = '스텔라'
    }
    if (ogerponTeraRule) {
      changeBattleForm(state, pokemon, ogerponTeraRule.form, '테라스탈', {
        hpMode: 'damage',
        log: false,
        animate: false,
      })
      pokemon.teraType = ogerponTeraRule.teraType
    }
    pokemon.teraActive = true
    pokemon.types = terapagosStellar ? [...terapagosStellar.types] : [pokemon.teraType]
    appendLog(state, `${trainerName}의 ${pokemon.name}이(가) ${pokemon.teraType}타입으로 테라스탈했다!`, 'gimmick')
    if (ogerponTeraRule) {
      appendLog(state, `${pokemon.name}의 초상투영! 가면에 담긴 힘이 넘쳐흐른다!`, 'ability')
      changeStages(state, pokemon, ogerponTeraRule.boost)
    }
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
      targetSlot: pokemon.chargingMove.targetSlot ?? 0,
      gimmick: null,
      forcedReason: 'charge',
    }
  }
  if (pokemon.bideState && pokemon.moves[pokemon.bideState.moveIndex]) {
    return {
      type: 'move',
      moveIndex: pokemon.bideState.moveIndex,
      gimmick: null,
      forcedReason: 'bide',
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
  if (pokemon.encoreTurns > 0 && pokemon.moves[pokemon.encoredMoveIndex]?.currentPp > 0) {
    return {
      type: 'move',
      moveIndex: pokemon.encoredMoveIndex,
      gimmick: null,
      forcedReason: 'encore',
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

function battlePokemonById(state, battleId) {
  if (!battleId) return null
  return allBattlePokemon(state).find((pokemon) => pokemon.battleId === battleId) ?? null
}

function releaseSkyDropTarget(state, attacker) {
  const target = battlePokemonById(
    state,
    attacker?.skyDropTargetBattleId ?? attacker?.chargingMove?.targetBattleId,
  )
  if (target?.skyDropSourceBattleId === attacker?.battleId) {
    target.skyDropSourceBattleId = null
    if (target.semiInvulnerable === 'airborne') target.semiInvulnerable = null
  }
  if (attacker) attacker.skyDropTargetBattleId = null
  return target
}

function releaseSkyDropConnections(state, pokemon) {
  if (!pokemon) return
  if (pokemon.skyDropTargetBattleId || pokemon.chargingMove?.moveId === 'skydrop') {
    releaseSkyDropTarget(state, pokemon)
  }
  if (pokemon.skyDropSourceBattleId) {
    const source = battlePokemonById(state, pokemon.skyDropSourceBattleId)
    if (source) {
      source.skyDropTargetBattleId = null
      if (source.chargingMove?.moveId === 'skydrop') {
        source.chargingMove = null
        if (source.semiInvulnerable === 'airborne') source.semiInvulnerable = null
      }
    }
    pokemon.skyDropSourceBattleId = null
    if (pokemon.semiInvulnerable === 'airborne') pokemon.semiInvulnerable = null
  }
}

function cancelGravityAffectedChargeMoves(state) {
  allBattlePokemon(state).forEach((pokemon) => {
    const chargingMove = pokemon.moves?.[pokemon.chargingMove?.moveIndex]
    if (!chargingMove?.flags?.includes('gravity')) return
    releaseSkyDropConnections(state, pokemon)
    pokemon.chargingMove = null
    pokemon.semiInvulnerable = null
  })
}

function clearChargeState(pokemon) {
  pokemon.chargingMove = null
  pokemon.semiInvulnerable = null
}

function beginChargeMove(state, attacker, defender, move, moveIndex, targetSideId, targetSlot) {
  attacker.chargingMove = {
    moveIndex,
    moveId: move.id,
    targetSideId,
    targetSlot,
    targetBattleId: defender?.battleId ?? null,
  }
  attacker.semiInvulnerable = SEMI_INVULNERABLE_MOVES[move.id] ?? null
  if (move.id === 'skydrop' && defender) {
    attacker.skyDropTargetBattleId = defender.battleId
    defender.skyDropSourceBattleId = attacker.battleId
    defender.semiInvulnerable = 'airborne'
  }
  if (CHARGE_TURN_BOOSTS[move.id]) changeStages(state, attacker, CHARGE_TURN_BOOSTS[move.id])
  appendLog(state, `${attacker.name}은(는) ${CHARGE_MESSAGES[move.id] ?? '힘을 모으고 있다!'}`, 'status')
}

function semiInvulnerableInteraction(defender, move, attacker = null) {
  if (!defender.semiInvulnerable || move.target === 'self') return { avoided: false, powerMultiplier: 1 }
  if (move.id === 'skydrop' && defender.skyDropSourceBattleId === attacker?.battleId) {
    return { avoided: false, powerMultiplier: 1 }
  }
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
  if (!moveIgnoresAbility(move, defender) && defender.ability === '갈지자걸음' && defender.confusionTurns > 0) multiplier *= 0.5
  return multiplier
}

function moveHits(state, attacker, defender, move, random) {
  if (move.ohko) {
    if (defender.dynamaxActive || Number(attacker.level ?? 50) < Number(defender.level ?? 50)) return false
    if (move.id === 'sheercold' && defender.types.includes('얼음')) return false
    if (attacker.ability === '노가드' || defender.ability === '노가드') return true
    const baseAccuracy = move.id === 'sheercold' && !attacker.types.includes('얼음') ? 20 : 30
    const levelBonus = Number(attacker.level ?? 50) - Number(defender.level ?? 50)
    return random() * 100 < baseAccuracy + levelBonus
  }
  if (move.accuracyLabel === '필중' || move.accuracy == null) return true
  if (attacker.ability === '노가드' || defender.ability === '노가드') return true
  if (
    defender.minimized
    && ['bodyslam', 'dragonrush', 'flyingpress', 'heatcrash', 'heavyslam', 'steamroller', 'stomp'].includes(move.id)
  ) return true
  if (attacker.sureHitTurns > 0 && attacker.sureHitTargetBattleId === defender.battleId) return true
  if (defender.telekinesisTurns > 0 && !move.ohko) return true
  const weatherId = effectiveMoveWeatherFamilyId(state, attacker)
  if (weatherId === 'rain' && RAIN_PERFECT_ACCURACY_MOVE_IDS.has(move.id)) return true
  if (weatherId === 'snow' && move.id === 'blizzard') return true

  const baseAccuracy = Number(move.accuracy) || 100
  const defenderEvasionStage = attacker.ability === '날카로운눈' || move.ignoreEvasion || defender.foresightActive
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
  const itemAccuracyModifier = hasActiveHeldItem(attacker, 'wide-lens')
    ? 1.1
    : hasActiveHeldItem(attacker, 'zoom-lens') && defender.actedThisTurn ? 1.2 : attacker.micleActive ? 1.2 : 1
  const defenderItemModifier = ['bright-powder', 'lax-incense'].some((itemId) => hasActiveHeldItem(defender, itemId))
    ? 0.9
    : 1
  const gravityModifier = state.environment?.gravityTurns > 0 ? 5 / 3 : 1
  const finalAccuracy = Math.min(
    100,
    baseAccuracy
      * stageModifier
      * hustleModifier
      * weatherModifier
      * abilityModifier
      * itemAccuracyModifier
      * defenderItemModifier
      * gravityModifier,
  )
  const wonderSkinAccuracy = !moveIgnoresAbility(move, defender) && defender.ability === '미라클스킨' && isStatusMove(move)
    ? Math.min(50, finalAccuracy)
    : finalAccuracy
  return random() * 100 < wonderSkinAccuracy
}

function chooseMultiHitCount(attacker, move, random) {
  if (parentalBondApplies(attacker, move)) return 2
  if (!move.multihit) return 1
  if (move.id === 'populationbomb' && hasActiveHeldItem(attacker, 'loaded-dice')) {
    return 10
  }
  if (typeof move.multihit === 'number') return move.multihit
  const [minimum, maximum] = move.multihit
  if (attacker.ability === '스킬링크') return maximum
  if (minimum === 2 && maximum === 5 && hasActiveHeldItem(attacker, 'loaded-dice')) {
    return random() < 0.5 ? 4 : 5
  }
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

function fixedDamageResult(state, attacker, defender, move, random) {
  const effectiveness = getMoveTypeEffectiveness(state, attacker, defender, move)
  if (effectiveness === 0) return { damage: 0, effectiveness, critical: false }
  if (move.id === 'endeavor') {
    return { damage: Math.max(0, defender.hp - attacker.hp), effectiveness, critical: false }
  }
  if (move.id === 'psywave') {
    return {
      damage: Math.max(1, Math.floor(50 * (0.5 + random()))),
      effectiveness,
      critical: false,
    }
  }
  if (move.id === 'counter') {
    const valid = attacker.lastDamageCategory === 'physical' && attacker.lastAttackerBattleId === defender.battleId
    return { damage: valid ? attacker.lastDamageTaken * 2 : 0, effectiveness, critical: false, failed: !valid }
  }
  if (move.id === 'mirrorcoat') {
    const valid = attacker.lastDamageCategory === 'special' && attacker.lastAttackerBattleId === defender.battleId
    return { damage: valid ? attacker.lastDamageTaken * 2 : 0, effectiveness, critical: false, failed: !valid }
  }
  if (['metalburst', 'comeuppance'].includes(move.id)) {
    const valid = attacker.lastDamageTaken > 0 && attacker.lastAttackerBattleId === defender.battleId
    return { damage: valid ? Math.floor(attacker.lastDamageTaken * 1.5) : 0, effectiveness, critical: false, failed: !valid }
  }
  if (move.id === 'bide') {
    const storedDamage = Number(move.bideReleaseDamage ?? 0)
    return { damage: storedDamage * 2, effectiveness, critical: false, failed: storedDamage <= 0 }
  }
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

function applySurvivalEffects(state, defender, requestedDamage, move, random) {
  let damage = Math.min(defender.hp, Math.max(0, Math.floor(requestedDamage)))
  if (damage < defender.hp) return damage

  if (['falseswipe', 'holdback'].includes(move.id)) return Math.max(0, defender.hp - 1)

  if (defender.protectMode === 'endure') {
    appendLog(state, `${defender.name}은(는) 공격을 견뎠다!`, 'status')
    return Math.max(0, defender.hp - 1)
  }
  if (hasActiveHeldItem(defender, 'focus-band') && random() < 0.1) {
    appendLog(state, `${defender.name}은(는) 기합의머리띠로 버텼다!`, 'item')
    return Math.max(0, defender.hp - 1)
  }
  if (defender.hp !== defender.maxHp) return damage

  if (!moveIgnoresAbility(move, defender) && defender.ability === '옹골참') {
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
  if (!moveMakesContact(attacker, move)) return false

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
    && !hasActiveHeldItem(attacker, 'punching-glove')
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
  const defenderAbilityActive = !moveIgnoresAbility(move, defender)
  const contact = moveMakesContact(attacker, move)

  if (contact && defender.beakBlastCharging && attacker.hp > 0) {
    applied = setStatus(state, attacker, 'burn', '부리캐논', { source: defender }) || applied
  }

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
      && stealHeldItem(state, defender, attacker, defender.ability)
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
      && (moveIgnoresAbility(move, defender) || defender.ability !== '인분')
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
      ignoreHolderAbility: moveIgnoresAbility(move, defender),
    })
  ) {
    applied = true
  }
  return applied
}

function applyDamagingHitItemEffects(
  state,
  sideId,
  actorSlot,
  targetSlot,
  attacker,
  defender,
  move,
  damage,
  effectiveness,
  random,
  timeline,
  actionOrder,
) {
  if (damage <= 0) return false
  let applied = false
  const contact = moveMakesContact(attacker, move)

  if (hasActiveHeldItem(defender, 'air-balloon')) {
    consumeHeldItem(state, defender)
    appendLog(state, `${defender.name}의 풍선이 터졌다!`, 'item')
    applied = true
  }
  if (defender.hp > 0 && effectiveness > 1 && hasActiveHeldItem(defender, 'weakness-policy')) {
    consumeHeldItem(state, defender)
    changeStages(state, defender, { attack: 2, specialAttack: 2 })
    appendLog(state, `${defender.name}의 약점보험이 발동했다!`, 'item')
    applied = true
  }

  const reactiveBoostItems = {
    'absorb-bulb': { type: '물', boosts: { specialAttack: 1 } },
    'cell-battery': { type: '전기', boosts: { attack: 1 } },
    'luminous-moss': { type: '물', boosts: { specialDefense: 1 } },
    snowball: { type: '얼음', boosts: { attack: 1 } },
  }
  const reactiveRule = reactiveBoostItems[defender.heldItemId]
  if (defender.hp > 0 && reactiveRule?.type === move.type && heldItemEffectsActive(defender)) {
    consumeHeldItem(state, defender)
    changeStages(state, defender, reactiveRule.boosts)
    appendLog(state, `${defender.name}의 ${defender.heldItemName || defender.heldItemId}이(가) 발동했다!`, 'item')
    applied = true
  }
  if (defender.hp > 0 && move.categoryId === 'physical' && hasActiveHeldItem(defender, 'kee-berry')) {
    consumeHeldItem(state, defender, { berry: true })
    changeStages(state, defender, { defense: berryEffectMultiplier(defender) })
    applyCheekPouch(state, defender)
    applied = true
  }
  if (defender.hp > 0 && move.categoryId === 'special' && hasActiveHeldItem(defender, 'maranga-berry')) {
    consumeHeldItem(state, defender, { berry: true })
    changeStages(state, defender, { specialDefense: berryEffectMultiplier(defender) })
    applyCheekPouch(state, defender)
    applied = true
  }
  if (defender.hp > 0 && effectiveness > 1 && hasActiveHeldItem(defender, 'enigma-berry')) {
    consumeHeldItem(state, defender, { berry: true })
    healPokemon(state, defender, defender.maxHp * berryEffectMultiplier(defender) / 4, '의문열매')
    applyCheekPouch(state, defender)
    applied = true
  }
  if (
    defender.hp > 0
    && (
      move.categoryId === 'physical' && hasActiveHeldItem(defender, 'jaboca-berry')
      || move.categoryId === 'special' && hasActiveHeldItem(defender, 'rowap-berry')
    )
  ) {
    consumeHeldItem(state, defender, { berry: true })
    if (attacker.ability !== '매직가드') {
      loseHp(state, attacker, attacker.maxHp / 8, `${attacker.name}은(는) 반응 열매에 데미지를 입었다!`, 'item')
    }
    applyCheekPouch(state, defender)
    applied = true
  }
  if (contact && hasActiveHeldItem(defender, 'rocky-helmet') && attacker.ability !== '매직가드') {
    loseHp(state, attacker, attacker.maxHp / 6, `${attacker.name}은(는) 울퉁불퉁멧에 데미지를 입었다!`, 'item')
    applied = true
  }
  if (
    contact
    && hasActiveHeldItem(defender, 'sticky-barb')
    && !hasHeldItem(attacker)
    && canRemoveHeldItem(defender, attacker)
  ) {
    attacker.heldItemId = defender.heldItemId
    attacker.heldItemName = defender.heldItemName
    attacker.consumedItem = false
    clearHeldItem(defender)
    appendLog(state, `${attacker.name}에게 끈적끈적바늘이 옮겨 붙었다!`, 'item')
    applied = true
  }
  if (
    ['kings-rock', 'razor-fang'].some((itemId) => hasActiveHeldItem(attacker, itemId))
    && !moveAlreadyFlinches(move)
    && !defender.actedThisTurn
    && defender.ability !== '인분'
    && !hasActiveHeldItem(defender, 'covert-cloak')
    && random() < 0.1
  ) {
    applied = applyVolatileEffect(state, defender, 'flinch', attacker.heldItemName || attacker.heldItemId, random, move.id, { source: attacker }) || applied
  }
  if (hasActiveHeldItem(attacker, 'shell-bell')) {
    applied = healPokemon(state, attacker, damage / 8, '조개껍질방울') > 0 || applied
  }

  if (defender.hp > 0 && hasActiveHeldItem(defender, 'red-card') && attacker.hp > 0) {
    const attackerSide = getSide(state, sideId)
    const replacements = availableBenchIndexes(attackerSide)
    if (replacements.length > 0) {
      consumeHeldItem(state, defender)
      performSwitch(
        state,
        sideId,
        replacements[Math.floor(random() * replacements.length)],
        true,
        timeline,
        actionOrder,
        actorSlot,
      )
      appendLog(state, `${defender.name}의 레드카드가 공격자를 돌려보냈다!`, 'item')
      applied = true
    }
  } else if (hasActiveHeldItem(defender, 'eject-button') && defender.hp > 0) {
    const defenderSide = getOtherSide(state, sideId)
    const replacements = availableBenchIndexes(defenderSide)
    if (replacements.length > 0) {
      consumeHeldItem(state, defender)
      performSwitch(
        state,
        defenderSide.id,
        replacements[Math.floor(random() * replacements.length)],
        true,
        timeline,
        actionOrder,
        targetSlot,
      )
      appendLog(state, `${defender.name}의 탈출버튼이 작동했다!`, 'item')
      applied = true
    }
  }
  return applied
}

function applyUniqueDamagingMoveEffects(state, attacker, defender, move, random) {
  if (['burnup', 'doubleshock'].includes(move.id)) {
    const removedType = move.id === 'burnup' ? '불꽃' : '전기'
    attacker.types = attacker.types.filter((type) => type !== removedType)
    attacker.typeRemovedByMove = true
    appendLog(state, `${attacker.name}에게서 ${removedType}타입이 사라졌다!`, 'status')
  }

  if (['ceaselessedge', 'stoneaxe'].includes(move.id)) setHazardFromMove(state, attacker, move)

  if (move.id === 'freezyfrost') {
    let changed = false
    allBattlePokemon(state).forEach((pokemon) => {
      changed = resetPokemonStatStages(pokemon) || changed
    })
    if (changed) appendLog(state, '꽁꽁프로스트가 모든 능력 변화를 원래대로 되돌렸다!', 'field')
  }

  if (move.id === 'sappyseed') {
    applyVolatileEffect(state, defender, 'leechseed', move.name, random, move.id, { source: attacker })
  }

  if (move.id === 'thousandwaves') {
    applyVolatileEffect(state, defender, 'block', move.name, random, move.id, { source: attacker })
  }

  if (move.id === 'jawlock') {
    applyVolatileEffect(state, defender, 'block', move.name, random, move.id, { source: attacker })
    applyVolatileEffect(state, attacker, 'block', move.name, random, move.id, { source: defender })
  }

  if (move.id === 'coreenforcer' && defender.hp > 0 && defender.actedThisTurn) {
    suppressPokemonAbility(state, defender, move.name)
  }

  if (move.id === 'fellstinger' && defender.hp <= 0) {
    changeStages(state, attacker, { attack: 3 }, { source: attacker })
  }

  if (move.id === 'orderup' && attacker.commandedByBattleId) {
    const side = getPokemonSide(state, attacker)
    const commander = side.team.find((pokemon) => pokemon.battleId === attacker.commandedByBattleId)
    const commanderSlug = currentSpeciesSlug(commander)
    const stat = commanderSlug.includes('droopy')
      ? 'defense'
      : commanderSlug.includes('stretchy') ? 'speed' : 'attack'
    changeStages(state, attacker, { [stat]: 1 }, { source: attacker })
  }

  if (move.id === 'flameburst') {
    activeAllies(state, defender).forEach((ally) => {
      if (ally.ability === '매직가드') return
      loseHp(state, ally, ally.maxHp / 16, `${ally.name}은(는) 불꽃튀기기의 불꽃에 휘말렸다!`)
    })
  }
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
  if (damageDealt <= 0) return 0
  if (move.struggleRecoil) {
    return loseHp(
      state,
      attacker,
      Math.floor(attacker.originalMaxHp / 4 + 0.5),
      `${attacker.name}은(는) 발버둥의 반동으로 {damage}의 데미지를 입었다.`,
    )
  }
  if (move.chloroblastRecoil) {
    if (RECOIL_IMMUNE_ABILITIES.has(attacker.ability)) return 0
    return loseHp(
      state,
      attacker,
      Math.floor(attacker.maxHp / 2 + 0.5),
      `${attacker.name}은(는) 클로로블라스트의 반동으로 {damage}의 데미지를 입었다.`,
    )
  }
  if (!move.recoil || RECOIL_IMMUNE_ABILITIES.has(attacker.ability)) return 0
  const [numerator, denominator] = move.recoil
  const amount = Math.floor(damageDealt * numerator / denominator + 0.5)
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
  attacker.moveFailedThisTurn = true
  attacker.consecutiveMoveId = null
  attacker.consecutiveMoveCount = 0
  applyCrashDamage(state, attacker, move)
  applyMindBlownRecoil(state, attacker, move)
  applySelfDestruct(state, attacker, move, false)
  if (attacker.lockedMove?.moveId === 'uproar') {
    attacker.lockedMove = null
    attacker.uproarTurns = 0
    appendLog(state, `${attacker.name}의 소란피기가 끝났다.`, 'status')
  }
}

function activateBlunderPolicy(state, pokemon) {
  if (!hasActiveHeldItem(pokemon, 'blunder-policy')) return false
  consumeHeldItem(state, pokemon)
  appendLog(state, `${pokemon.name}의 허탕보험이 발동했다!`, 'item')
  changeStages(state, pokemon, { speed: 2 }, { source: pokemon })
  return true
}

function activateThroatSpray(state, pokemon, move) {
  if (!move.flags?.includes('sound') || !hasActiveHeldItem(pokemon, 'throat-spray')) return false
  consumeHeldItem(state, pokemon)
  appendLog(state, `${pokemon.name}의 목스프레이가 발동했다!`, 'item')
  changeStages(state, pokemon, { specialAttack: 1 }, { source: pokemon })
  return true
}

function handleLockedMove(state, attacker, move, moveIndex, action, random) {
  if (move.self?.volatileStatus === 'uproar') {
    if (action.forcedReason === 'locked' && attacker.lockedMove) {
      attacker.lockedMove.remainingUses -= 1
      attacker.uproarTurns = Math.max(0, attacker.uproarTurns - 1)
      if (attacker.lockedMove.remainingUses <= 0) {
        attacker.lockedMove = null
        attacker.uproarTurns = 0
        appendLog(state, `${attacker.name}의 소란피기가 끝났다.`, 'status')
      }
    }
    return
  }
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

function batonPassSnapshot(pokemon) {
  return {
    statStages: { ...pokemon.statStages },
    substituteHp: pokemon.substituteHp,
    confusionTurns: pokemon.confusionTurns,
    criticalStageBoost: pokemon.criticalStageBoost,
    leechSeedSourceSideId: pokemon.leechSeedSourceSideId,
    leechSeedSourceSlot: pokemon.leechSeedSourceSlot,
    cursedActive: pokemon.cursedActive,
    ingrainActive: pokemon.ingrainActive,
    aquaRingActive: pokemon.aquaRingActive,
    magnetRiseTurns: pokemon.magnetRiseTurns,
    telekinesisTurns: pokemon.telekinesisTurns,
    chargeActive: pokemon.chargeActive,
    defenseCurlActive: pokemon.defenseCurlActive,
    minimized: pokemon.minimized,
    laserFocusActive: pokemon.laserFocusActive,
    octolockActive: pokemon.octolockActive,
  }
}

function applyBatonPassSnapshot(pokemon, snapshot) {
  Object.assign(pokemon, snapshot, { statStages: { ...snapshot.statStages } })
}

function applyMoveSwitching(state, sideId, move, random, timeline, actionOrder, actorSlot = 0, targetSlot = 0) {
  const side = getSide(state, sideId)
  const targetSide = getOtherSide(state, sideId)
  const attacker = getActivePokemon(state, sideId, actorSlot)
  const defender = getActivePokemon(state, targetSide.id, targetSlot)

  if (move.forceSwitch && defender?.hp > 0) {
    const forcedSwitchBlocked = defender.commandedByBattleId
      || !moveIgnoresAbility(move, defender) && FORCED_SWITCH_IMMUNE_ABILITIES.has(defender.ability)
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

  if (
    move.selfSwitch
    && move.id !== 'revivalblessing'
    && attacker?.hp > 0
    && !attacker.moveFailedThisTurn
  ) {
    const switchOptions = availableBenchIndexes(side)
    if (switchOptions.length > 0) {
      const passSnapshot = move.id === 'batonpass' ? batonPassSnapshot(attacker) : null
      const shedTailHp = move.id === 'shedtail' ? attacker.pendingShedTailHp : 0
      const targetIndex = switchOptions[Math.floor(random() * switchOptions.length)]
      if (performSwitch(state, sideId, targetIndex, true, timeline, actionOrder, actorSlot)) {
        const replacement = getActivePokemon(state, sideId, actorSlot)
        if (passSnapshot) {
          applyBatonPassSnapshot(replacement, passSnapshot)
          appendLog(state, `${replacement.name}은(는) 배턴터치로 능력 변화를 이어받았다!`, 'status')
        }
        if (shedTailHp > 0) {
          replacement.substituteHp = shedTailHp
          appendLog(state, `${replacement.name}의 앞에 대타가 이어졌다!`, 'status')
        }
      }
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

function resolvePledgeCombination(side, move) {
  if (!PLEDGE_MOVE_IDS.has(move.id) || !side.pledgeComboPlanned) return { move, waiting: false }
  if (!side.pendingPledge) {
    side.pendingPledge = { moveId: move.id, moveName: move.name }
    return { move, waiting: true }
  }

  const pair = new Set([side.pendingPledge.moveId, move.id])
  side.pendingPledge = null
  side.pledgeComboPlanned = false
  if (pair.size < 2) return { move, waiting: false }
  if (pair.has('firepledge') && pair.has('grasspledge')) {
    return {
      waiting: false,
      move: {
        ...move,
        power: 150,
        type: '불꽃',
        pledgeStabOverride: true,
        pledgeSideCondition: 'firePledgeTurns',
      },
    }
  }
  if (pair.has('grasspledge') && pair.has('waterpledge')) {
    return {
      waiting: false,
      move: {
        ...move,
        power: 150,
        type: '풀',
        pledgeStabOverride: true,
        pledgeSideCondition: 'grassPledgeTurns',
      },
    }
  }
  return {
    waiting: false,
    move: {
      ...move,
      power: 150,
      type: '물',
      pledgeStabOverride: true,
      pledgeSideCondition: 'waterPledgeTurns',
      pledgeAffectsOwnSide: true,
    },
  }
}

function specialMoveFailureReason(state, attacker, defender, move, { isChargeContinuation = false } = {}) {
  if (state.environment?.gravityTurns > 0 && move.flags?.includes('gravity')) {
    return '중력이 강해 기술을 사용할 수 없다!'
  }
  if (move.id === 'skydrop' && !isChargeContinuation) {
    if (defender.substituteHp > 0) return '대타가 있어 프리폴은 실패했다!'
    if (defender.skyDropSourceBattleId) return '상대가 이미 프리폴에 붙잡혀 있어 실패했다!'
    if (defender.dynamaxActive || effectivePokemonWeight(defender, {
      ignoreAbility: moveIgnoresAbility(move, defender),
    }) >= 2000) return '상대가 너무 무거워 프리폴은 실패했다!'
  }
  if (move.id === 'belch' && !attacker.ateBerry) return '나무열매를 먹은 적이 없어 트림은 실패했다!'
  if (move.id === 'darkvoid' && !currentSpeciesSlug(attacker).startsWith('darkrai')) {
    return '다크라이가 아니어서 다크홀은 실패했다!'
  }
  if (move.id === 'aurawheel' && !currentSpeciesSlug(attacker).startsWith('morpeko')) {
    return '모르페코가 아니어서 오라휠은 실패했다!'
  }
  if (move.id === 'hyperspacefury' && currentSpeciesSlug(attacker) !== 'hoopa-unbound') {
    return '굴레를 벗어난 후파가 아니어서 다른차원러시는 실패했다!'
  }
  if (move.id === 'dreameater' && !isPokemonAsleep(defender)) return '상대가 잠들어 있지 않아 꿈먹기는 실패했다!'
  if (['snore', 'sleeptalk'].includes(move.id) && !isPokemonAsleep(attacker)) {
    return '잠들어 있지 않아 기술은 실패했다!'
  }
  if (move.id === 'rest' && attacker.hp >= attacker.maxHp) return 'HP가 가득 차 있어 잠자기는 실패했다!'
  if (move.id === 'rest' && restSleepBlocked(state, attacker)) return '잠들 수 없어 잠자기는 실패했다!'
  if (move.id === 'captivate' && (!attacker.gender || !defender.gender || attacker.gender === defender.gender)) {
    return '상대를 유혹할 수 없어 기술은 실패했다!'
  }
  if (move.id === 'burnup' && !attacker.types.includes('불꽃')) return '불꽃타입이 아니어서 불사르기는 실패했다!'
  if (move.id === 'doubleshock' && !attacker.types.includes('전기')) return '전기타입이 아니어서 전광쌍격은 실패했다!'
  if (move.id === 'focuspunch' && attacker.damagedThisTurn) return '집중력이 흐트러져 힘껏펀치는 실패했다!'
  if (move.id === 'shelltrap' && !attacker.hitByPhysicalThisTurn) {
    return '물리공격을 받지 않아 트랩셸은 발동하지 않았다!'
  }
  if (move.id === 'poltergeist' && (!defender.heldItemId || defender.consumedItem)) {
    return '상대가 조종할 도구를 지니고 있지 않아 실패했다!'
  }
  if (move.id === 'fling' && (
    !heldItemEffectsActive(attacker)
    || !getBattleItem(attacker.heldItemId)?.flingPower
    || !canRemoveHeldItem(attacker)
  )) return '내던질 수 있는 지닌물건이 없어 실패했다!'
  if (
    move.id === 'naturalgift'
    && (
      !heldItemEffectsActive(attacker)
      || !getBattleItem(attacker.heldItemId)?.naturalGiftPower
    )
  ) return '자연의은혜를 끌어낼 나무열매가 없어 실패했다!'
  if (move.id === 'synchronoise' && !attacker.types.some((type) => defender.types.includes(type))) {
    return '서로 같은 타입이 없어 싱크로노이즈는 실패했다!'
  }
  if (['suckerpunch', 'thunderclap'].includes(move.id)) {
    if (
      defender.actedThisTurn
      || defender.plannedActionType !== 'move'
      || defender.plannedMoveCategory === 'status'
    ) return '상대가 공격하려 하지 않아 선제공격은 실패했다!'
  }
  if (move.id === 'upperhand') {
    if (
      defender.actedThisTurn
      || defender.plannedActionType !== 'move'
      || defender.plannedMoveCategory === 'status'
      || Number(defender.plannedMovePriority ?? 0) <= 0
    ) return '상대가 선제 기술을 준비하지 않아 기선제압은 실패했다!'
  }
  if (move.id === 'lastresort') {
    const otherMoveIds = [...new Set(attacker.moves.map((candidate) => candidate.id))]
      .filter((moveId) => moveId !== 'lastresort')
    if (otherMoveIds.length === 0 || otherMoveIds.some((moveId) => !attacker.usedMoveIds.includes(moveId))) {
      return '다른 기술을 모두 사용하지 않아 비장의무기는 실패했다!'
    }
  }
  return null
}

function executeMove(state, sideId, action, random, timeline = null, actionOrder = 0) {
  const side = getSide(state, sideId)
  let targetSide = getOtherSide(state, sideId)
  const actorSlot = Math.max(0, Math.min(side.activeIndexes.length - 1, Number(action.actorSlot) || 0))
  let targetSlot = Math.max(0, Math.min(targetSide.activeIndexes.length - 1, Number(action.targetSlot) || 0))
  const attacker = getActivePokemon(state, sideId, actorSlot)
  let defender = getActivePokemon(state, targetSide.id, targetSlot)
  let moveSlot = action.dancerCopy
    ? { ...action.copiedMove, maxPp: 1, currentPp: 1 }
    : attacker?.moves?.[action.moveIndex]
  if (!moveSlot || !isAvailableFieldPokemon(attacker)) return
  const isChargeContinuation = action.forcedReason === 'charge'
  const isSkyDropContinuation = isChargeContinuation && moveSlot.id === 'skydrop'
  if (isSkyDropContinuation && attacker.chargingMove?.targetBattleId) {
    const storedTargetSlot = getActivePokemonList(state, targetSide.id)
      .findIndex((pokemon) => pokemon?.battleId === attacker.chargingMove.targetBattleId)
    if (storedTargetSlot < 0) {
      releaseSkyDropConnections(state, attacker)
      clearChargeState(attacker)
      appendLog(state, '붙잡았던 상대가 없어 프리폴은 실패했다!', 'muted')
      return
    }
    targetSlot = storedTargetSlot
    defender = getActivePokemon(state, targetSide.id, targetSlot)
  }
  const allyTarget = moveSlot.id === 'pollenpuff'
    && (action.targetSideId === sideId || action.targetAllySlot != null)
  if (allyTarget) {
    targetSide = side
    targetSlot = Math.max(
      0,
      Math.min(side.activeIndexes.length - 1, Number(action.targetAllySlot ?? action.targetSlot) || 0),
    )
    defender = getActivePokemon(state, sideId, targetSlot)
    if (!isAvailableFieldPokemon(defender) || defender.battleId === attacker.battleId) return
  }
  const isBideContinuation = action.forcedReason === 'bide' && Boolean(attacker.bideState)
  const isBideRelease = isBideContinuation && attacker.bideState.remainingTurns <= 1
  if (isBideRelease) {
    const storedTargetSlot = getActivePokemonList(state, targetSide.id)
      .findIndex((pokemon) => pokemon?.battleId === attacker.bideState.lastAttackerBattleId)
    if (storedTargetSlot >= 0) {
      targetSlot = storedTargetSlot
      defender = getActivePokemon(state, targetSide.id, targetSlot)
    }
    moveSlot = {
      ...moveSlot,
      target: 'normal',
      ignoreImmunity: false,
      bideReleaseDamage: attacker.bideState.storedDamage,
    }
  }
  let targetRedirection = null
  const redirectedTarget = allyTarget
    ? { slot: targetSlot, pokemon: defender, reason: null }
    : isSkyDropContinuation
      ? { slot: targetSlot, pokemon: defender, reason: null }
      : redirectTargetForMove(state, attacker, targetSide, moveSlot, targetSlot)
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
  const previousBattleMove = state.lastUsedMove ? { ...state.lastUsedMove } : null
  let moveCategory = moveSlot?.categoryId
    ?? (moveSlot?.category === '물리' ? 'physical' : moveSlot?.category === '변화' ? 'status' : 'special')

  if (!isAvailableFieldPokemon(defender)) return
  attacker.actedThisTurn = true
  attacker.custapActive = false
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
    CHOICE_ITEM_IDS.has(attacker.heldItemId)
    && heldItemEffectsActive(attacker)
    && !action.dancerCopy
    && !attacker.dynamaxActive
    && attacker.choiceLockedMoveIndex != null
    && attacker.choiceLockedMoveIndex !== action.moveIndex
    && !['dynamax', 'zmove'].includes(action.gimmick)
  ) {
    appendLog(state, `${attacker.name}은(는) 구애 도구 때문에 다른 기술을 선택할 수 없다!`, 'item')
    attacker.moveFailedThisTurn = true
    return
  }
  if (
    attacker.disabledMoveTurns > 0
    && !action.dancerCopy
    && attacker.disabledMoveIndex === action.moveIndex
    && !isChargeContinuation
    && !isLockedContinuation
    && !isBideContinuation
  ) {
    appendLog(state, `${moveSlot.name}은(는) 저주받은바디로 봉인되어 있다!`, 'status')
    return
  }
  if (
    !isChargeContinuation
    && !isLockedContinuation
    && !isBideContinuation
    && moveSlot.flags?.includes('cantusetwice')
    && attacker.lastMoveId === moveSlot.id
  ) {
    appendLog(state, `${attacker.name}은(는) ${moveSlot.name}을(를) 연속해서 사용할 수 없다!`, 'status')
    attacker.moveFailedThisTurn = true
    return
  }
  if (
    !action.dancerCopy
    && attacker.tormented
    && attacker.lastMoveIndex === action.moveIndex
    && !isChargeContinuation
    && !isLockedContinuation
    && !isBideContinuation
  ) {
    appendLog(state, `${attacker.name}은(는) 같은 기술을 연속해서 사용할 수 없다!`, 'status')
    return
  }
  const isFirstMoveAction = (attacker.activeMoveActions ?? 0) === 0
  attacker.activeMoveActions = (attacker.activeMoveActions ?? 0) + 1
  if (attacker.destinyBondActive && move.id !== 'destinybond') attacker.destinyBondActive = false
  if (attacker.grudgeActive && move.id !== 'grudge') attacker.grudgeActive = false
  if (attacker.rageActive && move.id !== 'rage') attacker.rageActive = false
  if (move.id === 'beakblast') attacker.beakBlastCharging = false
  if (!canPokemonAct(state, attacker, random, move)) {
    if (isChargeContinuation) {
      if (isSkyDropContinuation) releaseSkyDropTarget(state, attacker)
      clearChargeState(attacker)
    }
    if (isBideContinuation) attacker.bideState = null
    if (isLockedContinuation && attacker.lockedMove?.moveId === 'uproar') {
      attacker.lockedMove = null
      attacker.uproarTurns = 0
    }
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

  if (hasActiveHeldItem(attacker, 'assault-vest') && isStatusMove(moveSlot)) {
    appendLog(state, `${attacker.name}은(는) 돌격조끼 때문에 변화 기술을 사용할 수 없다!`, 'item')
    attacker.moveFailedThisTurn = true
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
  let powerMultiplier = activateMechanic(state, sideId, resolvedGimmick, actorSlot)
  const environmentMove = resolveEnvironmentMove(state, attacker, defender, moveSlot)
  move = resolvedGimmick === 'zmove'
    ? resolveBattleZMove(attacker, environmentMove, moveSlot) ?? requestedZMove
    : resolveBattleMaxMove(attacker, environmentMove, false, moveSlot)
  moveCategory = move.categoryId
    ?? (move.category === '물리' ? 'physical' : move.category === '변화' ? 'status' : 'special')
  if (attacker.consecutiveMoveId && attacker.consecutiveMoveId !== move.id) {
    attacker.consecutiveMoveId = null
    attacker.consecutiveMoveCount = 0
  }
  if (
    attacker.ability === '무아지경'
    && !action.dancerCopy
    && !attacker.dynamaxActive
    && resolvedGimmick !== 'zmove'
    && attacker.gorillaLockedMoveIndex == null
    && move.id !== 'struggle'
  ) attacker.gorillaLockedMoveIndex = action.moveIndex
  if (attacker.tauntTurns > 0 && isStatusMove(move)) {
    appendLog(state, `${attacker.name}은(는) 도발당해 ${move.name}을(를) 쓸 수 없다!`, 'status')
    attacker.moveFailedThisTurn = true
    return
  }
  const imprisonSource = getActivePokemonList(state, targetSide.id).find((pokemon) => (
    pokemon?.imprisonActive
    && pokemon.moves.some((knownMove) => knownMove.id === move.id)
  ))
  if (imprisonSource) {
    appendLog(state, `${imprisonSource.name}의 봉인 때문에 ${move.name}을(를) 쓸 수 없다!`, 'status')
    attacker.moveFailedThisTurn = true
    return
  }
  if (attacker.powderActive && move.type === '불꽃') {
    attacker.powderActive = false
    loseHp(state, attacker, attacker.maxHp / 4, `${attacker.name}은(는) 분진에 불이 붙어 데미지를 입었다!`, 'status')
    attacker.moveFailedThisTurn = true
    markPokemonFaint(state, sideId, actorSlot, timeline, actionOrder)
    return
  }
  if (move.id === 'spitup' && attacker.stockpileCount <= 0) {
    appendLog(state, '비축한 힘이 없어 토해내기는 실패했다!', 'muted')
    attacker.moveFailedThisTurn = true
    return
  }
  if (
    move.id === 'fling'
    && (
      !heldItemEffectsActive(attacker)
      || !getBattleItem(attacker.heldItemId)?.flingPower
      || !canRemoveHeldItem(attacker)
    )
  ) {
    appendLog(state, '내던질 수 있는 지닌물건이 없어 실패했다!', 'muted')
    attacker.moveFailedThisTurn = true
    return
  }
  if (
    move.id === 'naturalgift'
    && (
      !heldItemEffectsActive(attacker)
      || !getBattleItem(attacker.heldItemId)?.naturalGiftPower
    )
  ) {
    appendLog(state, '자연의은혜를 끌어낼 나무열매가 없어 실패했다!', 'muted')
    attacker.moveFailedThisTurn = true
    return
  }
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

  if (isChargeContinuation) {
    if (isSkyDropContinuation) releaseSkyDropTarget(state, attacker)
    clearChargeState(attacker)
  }
  if (!action.dancerCopy && !isChargeContinuation && !isLockedContinuation && !isBideContinuation) {
    moveSlot.currentPp = Math.max(0, moveSlot.currentPp - movePpCost(state, attacker, defender, move))
    restoreLeppaBerryPp(state, attacker, moveSlot)
  }
  if (
    !action.dancerCopy
    && !attacker.dynamaxActive
    && resolvedGimmick !== 'zmove'
    && CHOICE_ITEM_IDS.has(attacker.heldItemId)
    && heldItemEffectsActive(attacker)
    && attacker.choiceLockedMoveIndex == null
    && move.id !== 'struggle'
  ) attacker.choiceLockedMoveIndex = action.moveIndex
  if (!action.dancerCopy) attacker.lastMoveIndex = action.moveIndex
  const pledgeResolution = resolvePledgeCombination(side, move)
  if (pledgeResolution.waiting) {
    attacker.lastMoveId = move.id
    state.lastUsedMove = {
      moveId: move.id,
      userBattleId: attacker.battleId,
      sideId,
      targetBattleId: defender.battleId,
    }
    appendLog(state, `${attacker.name}은(는) 동료의 맹세를 기다리고 있다!`, 'status')
    pushTimelineStep(timeline, state, {
      phase: 'status',
      actionOrder,
      sideId,
      targetSideId: sideId,
      actorSlot,
      actorName: attacker.name,
      moveId: move.id,
      moveName: move.name,
      result: 'waiting',
      message: `${attacker.name}은(는) 동료의 맹세를 기다리고 있다!`,
    })
    return
  }
  if (pledgeResolution.move !== move) {
    move = pledgeResolution.move
    moveCategory = move.categoryId
      ?? (move.category === '물리' ? 'physical' : move.category === '변화' ? 'status' : 'special')
    appendLog(state, '두 맹세가 하나로 합쳐졌다!', 'field')
  }
  if (move.id === 'round') side.roundUsedThisTurn = true
  if (action.quickDrawActivated) appendLog(state, `${attacker.name}의 퀵드로!`, 'ability')
  if (action.quickClawActivated) appendLog(state, `${attacker.name}의 선제공격손톱이 발동했다!`, 'item')
  appendLog(state, `${attacker.name}의 ${move.name}!`, sideId === 'player' ? 'player' : 'opponent')
  attacker.lastMoveId = move.id
  state.lastUsedMove = {
    moveId: move.id,
    userBattleId: attacker.battleId,
    sideId,
    targetBattleId: defender.battleId,
  }
  if (targetRedirection) {
    appendLog(state, `${defender.name}의 ${targetRedirection}! 공격을 자신에게 끌어모았다!`, 'ability')
  }
  const animationMetadata = moveAnimationMetadata(attacker, move, resolvedAction, moveCategory)
  const helpingHandMultiplier = attacker.helpingHandActive ? 1.5 : 1
  attacker.helpingHandActive = false
  attacker.electrifyActive = false

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

  if (!action.dancerCopy && !attacker.usedMoveIds.includes(move.id)) attacker.usedMoveIds.push(move.id)
  const failureReason = specialMoveFailureReason(state, attacker, defender, move, { isChargeContinuation })
  if (failureReason) {
    appendLog(state, failureReason, 'muted')
    applyFailedMoveConsequences(state, attacker, move)
    pushTimelineStep(timeline, state, {
      phase: 'resolve',
      ...moveStep,
      result: 'failed',
      message: failureReason,
    })
    return
  }

  if (move.id === 'ficklebeam' && random() < 0.3) {
    powerMultiplier *= 2
    appendLog(state, `${attacker.name}의 머리가 두 개 모두 협력했다!`, 'status')
  }

  if (allyTarget && move.id === 'pollenpuff') {
    healPokemon(state, defender, defender.maxHp / 2, move.name)
    pushTimelineStep(timeline, state, {
      phase: 'status',
      ...moveStep,
      result: 'heal',
      message: latestLogMessage(state, `${defender.name}의 HP가 회복되었다!`),
    })
    return
  }

  if (move.flags?.includes('futuremove')) {
    const futureMoveAlreadyScheduled = Boolean(targetSide.futureMoveSlots[targetSlot])
    if (futureMoveAlreadyScheduled) {
      appendLog(state, `${targetSide.name}의 그 위치에는 이미 미래의 공격이 예정되어 있다!`, 'muted')
      attacker.moveFailedThisTurn = true
    } else {
      targetSide.futureMoveSlots[targetSlot] = {
        turns: 3,
        move: { ...move, ignoreImmunity: false },
        sourceBattleId: attacker.battleId,
        sourceSideId: sideId,
        sourceSnapshot: clonePokemon(attacker),
      }
      appendLog(state, `${attacker.name}은(는) 미래의 공격을 예지했다!`, 'status')
      attacker.moveFailedThisTurn = false
    }
    pushTimelineStep(timeline, state, {
      phase: 'status',
      ...moveStep,
      result: futureMoveAlreadyScheduled ? 'failed' : 'scheduled',
      message: latestLogMessage(state, `${move.name}이(가) 미래에 발동한다!`),
    })
    return
  }

  if (move.id === 'bide' && !isBideRelease) {
    if (!isBideContinuation) {
      attacker.bideState = {
        moveIndex: action.moveIndex,
        remainingTurns: 2,
        storedDamage: 0,
        lastAttackerBattleId: null,
      }
      appendLog(state, `${attacker.name}은(는) 공격을 참고 있다!`, 'status')
    } else {
      attacker.bideState.remainingTurns -= 1
      appendLog(state, `${attacker.name}은(는) 계속해서 공격을 참고 있다!`, 'status')
    }
    pushTimelineStep(timeline, state, {
      phase: 'status',
      ...moveStep,
      result: 'charging',
      message: latestLogMessage(state, `${attacker.name}은(는) 공격을 참고 있다!`),
    })
    return
  }
  if (isBideRelease) {
    attacker.bideState = null
    appendLog(state, `${attacker.name}은(는) 참았던 힘을 해방했다!`, 'status')
  }

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
      beginChargeMove(state, attacker, defender, move, action.moveIndex, targetSide.id, targetSlot)
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

  if (isSkyDropContinuation && defender.types.includes('비행')) {
    appendLog(state, `${defender.name}은(는) 비행타입이라 프리폴의 데미지를 받지 않는다!`, 'muted')
    pushTimelineStep(timeline, state, {
      phase: 'resolve',
      ...moveStep,
      result: 'immune',
      message: latestLogMessage(state, `${defender.name}에게는 효과가 없다!`),
    })
    return
  }

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

  const priorityBlocked = targetSide.quickGuardTurns > 0
    && environmentMovePriority(state, attacker, move) > 0
    && move.target !== 'self'
  const spreadBlocked = targetSide.wideGuardTurns > 0
    && ['all', 'allAdjacent', 'allAdjacentFoes'].includes(move.target)
  const matBlocked = targetSide.matBlockTurns > 0 && !isStatusMove(move) && move.flags?.includes('protect')
  const craftyBlocked = targetSide.craftyShieldTurns > 0 && isStatusMove(move) && move.target !== 'self'
  if (priorityBlocked || spreadBlocked || matBlocked || craftyBlocked) {
    appendLog(state, `${targetSide.name} 진영이 ${move.name}을(를) 막아냈다!`, 'status')
    attacker.moveFailedThisTurn = true
    return
  }

  if (
    move.target !== 'self'
    && environmentMovePriority(state, attacker, move) > 0
    && getActivePokemonList(state, targetSide.id).some((pokemon) => (
      pokemon
      && !pokemon.fainted
      && pokemon.hp > 0
      && !moveIgnoresAbility(move, pokemon)
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

  const semiInvulnerable = semiInvulnerableInteraction(defender, move, attacker)
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

  const moveConnected = moveHits(state, attacker, defender, move, random)
  if (attacker.micleActive) attacker.micleActive = false
  if (!moveConnected) {
    appendLog(state, `${attacker.name}의 공격은 빗나갔다!`, 'muted')
    applyFailedMoveConsequences(state, attacker, move)
    activateBlunderPolicy(state, attacker)
    pushTimelineStep(timeline, state, {
      phase: 'resolve',
      ...moveStep,
      result: 'miss',
      message: `${attacker.name}의 공격은 빗나갔다!`,
    })
    return
  }

  if (isStatusMove(move)) {
    if (
      move.target !== 'self'
      && defender.substituteHp > 0
      && attacker.ability !== '틈새포착'
      && !move.flags?.includes('bypasssub')
      && !move.flags?.includes('sound')
    ) {
      appendLog(state, `${defender.name}의 대타가 변화 기술을 막아냈다!`, 'status')
      pushTimelineStep(timeline, state, {
        phase: 'resolve',
        ...moveStep,
        result: 'blocked',
        message: latestLogMessage(state, `${defender.name}의 대타가 기술을 막았다!`),
      })
      return
    }
    const statusMoveImmunity = abilityImmunity(state, attacker, defender, move)
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
    if (move.target !== 'self' && !moveIgnoresAbility(move, defender) && defender.ability === '황금몸') {
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
      && !moveIgnoresAbility(move, defender)
      && !move.reflectedByMagicBounce
      && (defender.ability === '매직미러' || defender.magicCoatActive)
      && move.flags?.includes('reflectable')
    ) {
      const reflector = defender.ability === '매직미러' ? '매직미러' : '매직코트'
      defender.magicCoatActive = false
      appendLog(state, `${defender.name}의 ${reflector}가 ${move.name}을(를) 되받아쳤다!`, defender.ability === '매직미러' ? 'ability' : 'status')
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
    if (CALL_MOVE_IDS.has(move.id)) {
      const called = resolveCalledMove(state, attacker, defender, move, random, previousBattleMove)
      if (!called) appendLog(state, `${move.name}으로 불러낼 기술이 없어 실패했다!`, 'muted')
      else executeMove(state, called.sideId, called.action, random, timeline, actionOrder)
      return
    }
    const snatcher = getActivePokemonList(state, targetSide.id).find((pokemon) => (
      pokemon?.snatchActive && move.flags?.includes('snatch')
    ))
    if (snatcher) {
      snatcher.snatchActive = false
      appendLog(state, `${snatcher.name}은(는) ${move.name}을(를) 가로챘다!`, 'status')
      applyStatusMove(state, snatcher, attacker, move, random, {
        sideId: targetSide.id,
        actorSlot: getActivePokemonList(state, targetSide.id).indexOf(snatcher),
        targetSlot: actorSlot,
        timeline,
        actionOrder,
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
      && !moveIgnoresAbility(move, defender)
      && defender.ability === '풍력발전'
      && move.flags?.includes('wind')
    ) {
      defender.chargeActive = true
      appendLog(state, `${defender.name}의 풍력발전! 전기를 충전했다!`, 'ability')
    }
    applyStatusMove(state, attacker, defender, move, random, {
      sideId,
      actorSlot,
      targetSlot,
      timeline,
      actionOrder,
    })
    activateThroatSpray(state, attacker, move)
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

  if (move.breaksProtect && defender.protected) {
    defender.protected = false
    defender.protectMode = null
    appendLog(state, `${move.name}이(가) 방어를 깨뜨렸다!`, 'status')
  }

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

  const immunity = abilityImmunity(state, attacker, defender, move)
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
  let directDamage = 0
  let landedHits = 0
  let hitSubstitute = false
  let multiHitMissed = false
  let result = null

  if (move.stealsBoosts && getMoveTypeEffectiveness(state, attacker, defender, move) > 0) {
    const stolenBoosts = Object.fromEntries(Object.entries(defender.statStages)
      .filter(([, stage]) => stage > 0))
    if (Object.keys(stolenBoosts).length > 0) {
      Object.keys(stolenBoosts).forEach((statKey) => { defender.statStages[statKey] = 0 })
      appendLog(state, `${attacker.name}은(는) ${defender.name}의 올라간 능력을 훔쳤다!`, 'status')
      changeStages(state, attacker, stolenBoosts, { source: attacker })
    }
  }

  for (let hitIndex = 0; hitIndex < hitCount && defender.hp > 0; hitIndex += 1) {
    if (
      hitIndex > 0
      && move.multiaccuracy
      && !hasActiveHeldItem(attacker, 'loaded-dice')
      && !moveHits(state, attacker, defender, move, random)
    ) {
      multiHitMissed = true
      break
    }
    const hitMove = ['tripleaxel', 'triplekick'].includes(move.id)
      ? { ...move, power: Math.max(1, Number(move.power) || 1) * (hitIndex + 1) }
      : move
    const hitResult = fixedDamageResult(state, attacker, defender, hitMove, random)
      ?? calculateDamage(
        state,
        attacker,
        defender,
        hitMove,
        random,
        powerMultiplier
          * semiInvulnerable.powerMultiplier
          * protectionMultiplier
          * helpingHandMultiplier
          * (parentalBondActive && hitIndex === 1 ? 0.25 : 1),
      )
    const formShield = applyFormDamageShield(state, defender, hitMove, hitResult.damage)
    if (formShield) {
      hitResult.effectiveness = formShield.effectiveness
      hitResult.critical = false
    }
    if (!result) result = hitResult
    const requestedHitDamage = formShield
      ? formShield.damage
      : applySurvivalEffects(state, defender, hitResult.damage, hitMove, random)
    const substituteBlocks = defender.substituteHp > 0
      && attacker.ability !== '틈새포착'
      && !move.flags?.includes('bypasssub')
      && !move.flags?.includes('sound')
    let adjustedHitDamage = requestedHitDamage
    const resistBerryType = TYPE_RESIST_BERRY_TYPES[defender.heldItemId]
    if (
      hitIndex === 0
      && heldItemEffectsActive(defender)
      && resistBerryType === move.type
      && (move.type === '노말' || hitResult.effectiveness > 1)
    ) {
      adjustedHitDamage = Math.max(1, Math.floor(adjustedHitDamage / 2))
      consumeHeldItem(state, defender, { berry: true })
      appendLog(state, `${defender.name}의 ${defender.heldItemName || defender.heldItemId}이(가) 데미지를 줄였다!`, 'item')
      applyCheekPouch(state, defender)
    }
    const hitDamage = substituteBlocks
      ? Math.min(defender.substituteHp, adjustedHitDamage)
      : adjustedHitDamage
    if (substituteBlocks) {
      defender.substituteHp = Math.max(0, defender.substituteHp - hitDamage)
      hitSubstitute = true
      if (defender.substituteHp === 0) appendLog(state, `${defender.name}의 대타는 사라졌다!`, 'status')
    } else {
      defender.hp = Math.max(0, defender.hp - hitDamage)
      directDamage += hitDamage
    }
    damage += hitDamage
    landedHits += 1
    result.critical = result.critical || hitResult.critical
    if (hitResult.effectiveness === 0 || hitDamage === 0 && move.ohko) break
  }

  if (multiHitMissed) activateBlunderPolicy(state, attacker)

  result ??= { damage: 0, effectiveness: getMoveTypeEffectiveness(state, attacker, defender, move), critical: false }
  if (landedHits > 0 && result.effectiveness > 0) {
    attacker.consecutiveMoveCount = attacker.consecutiveMoveId === move.id
      ? (attacker.consecutiveMoveCount ?? 0) + 1
      : 1
    attacker.consecutiveMoveId = move.id
    attacker.moveFailedThisTurn = false
    activateThroatSpray(state, attacker, move)
  } else {
    attacker.consecutiveMoveId = null
    attacker.consecutiveMoveCount = 0
    attacker.moveFailedThisTurn = true
  }
  if (result.failed) appendLog(state, `${move.name}은(는) 되받아칠 공격이 없어 실패했다!`, 'muted')
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
  flushDeferredFormTimeline(state)

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
  if (directDamage > 0 && move.drain) {
    const [numerator, denominator] = move.drain
    const drainAmount = directDamage * numerator / denominator
    applyDrainingRecovery(state, attacker, defender, drainAmount, move.name, {
      ignoreDrainedAbility: moveIgnoresAbility(move, defender),
    })
  }

  if (directDamage > 0) {
    defender.lastDamageTaken = directDamage
    defender.lastDamageCategory = moveCategory
    defender.lastAttackerBattleId = attacker.battleId
    defender.damagedThisTurn = true
    if (moveCategory === 'physical') defender.hitByPhysicalThisTurn = true
    defender.hitCountTaken = (defender.hitCountTaken ?? 0) + landedHits
    if (defender.bideState) {
      defender.bideState.storedDamage += directDamage
      defender.bideState.lastAttackerBattleId = attacker.battleId
    }
    if (defender.rageActive && defender.hp > 0) {
      changeStages(state, defender, { attack: landedHits }, { source: defender })
    }
    if (attacker.laserFocusActive) attacker.laserFocusActive = false
    breakIllusion(state, defender)
    if (attacker.chargeActive && move.type === '전기') attacker.chargeActive = false
    applyPrimaryMoveEffects(state, attacker, defender, move, random)
    if (move.id === 'fling') applyFlingItemEffect(state, attacker, defender, move, random)
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
    applyDamagingHitItemEffects(
      state,
      sideId,
      actorSlot,
      targetSlot,
      attacker,
      defender,
      move,
      directDamage,
      result.effectiveness,
      random,
      timeline,
      actionOrder,
    )
    applyUniqueDamagingMoveEffects(state, attacker, defender, move, random)
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

    if (move.thawsTarget && defender.status?.id === 'freeze') {
      defender.status = null
      appendLog(state, `${defender.name}의 얼음이 녹았다!`, 'heal')
    }
    if (move.id === 'smellingsalts' && defender.status?.id === 'paralysis') defender.status = null
    if (move.id === 'wakeupslap' && defender.status?.id === 'sleep') defender.status = null
    if (move.id === 'clearsmog') resetPokemonStatStages(defender)
    if (['brickbreak', 'psychicfangs', 'ragingbull'].includes(move.id)) {
      const sideToBreak = getPokemonSide(state, defender)
      sideToBreak.auroraVeilTurns = 0
      sideToBreak.lightScreenTurns = 0
      sideToBreak.reflectTurns = 0
      appendLog(state, `${defender.name} 진영의 장벽이 깨졌다!`, 'field')
    }
    if (['rapidspin', 'mortalspin'].includes(move.id)) {
      const ownSide = getPokemonSide(state, attacker)
      ownSide.hazards = {
        ...ownSide.hazards,
        spikes: 0,
        stealthRock: false,
        stickyWeb: false,
        toxicSpikes: 0,
      }
      attacker.leechSeedSourceSideId = null
      attacker.trappedTurns = 0
      attacker.trapSourceName = null
      attacker.trapSourceBattleId = null
      attacker.trapDamages = false
      appendLog(state, `${attacker.name} 진영의 함정이 제거되었다!`, 'field')
    }
    if (move.id === 'knockoff' && canRemoveHeldItem(defender, attacker, {
      ignoreHolderAbility: moveIgnoresAbility(move, defender),
    })) {
      const removedItem = defender.heldItemName || defender.heldItemId
      clearHeldItem(defender)
      appendLog(state, `${defender.name}의 ${removedItem}을(를) 떨어뜨렸다!`, 'item')
    }
    if (['thief', 'covet'].includes(move.id)) stealHeldItem(state, attacker, defender, move.name)
    if (
      move.id === 'incinerate'
      && (
        defender.heldItemId?.endsWith('-berry')
        || GEM_ITEM_TYPES[defender.heldItemId]
      )
      && canRemoveHeldItem(defender, attacker, {
        ignoreHolderAbility: moveIgnoresAbility(move, defender),
      })
    ) {
      const itemName = defender.heldItemName || defender.heldItemId
      clearHeldItem(defender)
      appendLog(state, `${defender.name}의 ${itemName}이(가) 타버렸다!`, 'item')
    }
    if (
      attacker.hp > 0
      && ['bugbite', 'pluck'].includes(move.id)
      && defender.heldItemId?.endsWith('-berry')
      && canRemoveHeldItem(defender, attacker, {
        ignoreHolderAbility: moveIgnoresAbility(move, defender),
      })
    ) {
      const stolenBerryId = defender.heldItemId
      const stolenBerryName = defender.heldItemName || stolenBerryId
      clearHeldItem(defender)
      consumeStolenBerry(state, attacker, stolenBerryId, stolenBerryName, random)
    }

    if (move.id === 'spitup') {
      changeStages(state, attacker, {
        defense: -attacker.stockpileBoosts.defense,
        specialDefense: -attacker.stockpileBoosts.specialDefense,
      })
      attacker.stockpileCount = 0
      attacker.stockpileBoosts = { defense: 0, specialDefense: 0 }
    }

    if (defender.hp <= 0 && defender.grudgeActive) {
      const grudgeMove = attacker.moves[action.moveIndex]
        ?? attacker.moves.find((candidate) => candidate.id === moveSlot.id)
      if (grudgeMove) {
        grudgeMove.currentPp = 0
        appendLog(state, `${defender.name}의 원념으로 ${grudgeMove.name}의 PP가 0이 되었다!`, 'status')
        restoreLeppaBerryPp(state, attacker, grudgeMove)
      }
      defender.grudgeActive = false
    }
    if (move.id === 'naturalgift' && heldItemEffectsActive(attacker)) {
      consumeHeldItem(state, attacker, { berry: true })
      appendLog(state, `${attacker.name}은(는) ${move.name}에 지닌물건을 사용했다!`, 'item')
    }

    if (
      hasActiveHeldItem(attacker, 'life-orb')
      && attacker.ability !== '매직가드'
      && !(attacker.ability === '우격다짐' && hasSheerForceEffect(move))
      && attacker.hp > 0
    ) {
      loseHp(state, attacker, attacker.maxHp / 10, `${attacker.name}은(는) 생명의구슬로 HP가 줄었다.`, 'item')
    }

    if (GEM_ITEM_TYPES[attacker.heldItemId] === move.type && heldItemEffectsActive(attacker)) {
      consumeHeldItem(state, attacker)
      appendLog(state, `${attacker.name}의 ${attacker.heldItemName || attacker.heldItemId}이(가) 힘을 다했다!`, 'item')
    }

    if (move.flags?.includes('recharge') && attacker.hp > 0) {
      attacker.rechargeTurns = 1
      appendLog(state, `${attacker.name}은(는) 다음 턴에 반동으로 움직일 수 없다!`, 'status')
    }
    if (!action.dancerCopy) handleLockedMove(state, attacker, move, action.moveIndex, action, random)
    applyMoveTriggeredFormAfterHit(state, attacker, defender, move, damage)
    if (defender.hp <= 0) applyKnockoutAbility(state, attacker)
  } else if (result.effectiveness === 0 && !hitSubstitute) {
    applyCrashDamage(state, attacker, move)
  }

  applyMindBlownRecoil(state, attacker, move)

  if (defender.hp <= 0 && defender.destinyBondActive && attacker.hp > 0 && directDamage > 0) {
    attacker.hp = 0
    appendLog(state, `${defender.name}의 길동무! ${attacker.name}도 함께 쓰러진다!`, 'status')
  }

  applySelfDestruct(state, attacker, move, damage > 0)

  const hasPostEffectLog = state.log.length > postEffectLogLength
  const postEffectMessage = latestLogMessage(state, `${move.name}의 추가 효과가 발동했다!`)
  const targetFainted = markPokemonFaint(state, targetSide.id, targetSlot, timeline, actionOrder)

  if (hasPostEffectLog) {
    pushTimelineStep(timeline, state, {
      phase: 'status',
      ...moveStep,
      targetSideId: sideId,
      message: postEffectMessage,
    })
  }

  markPokemonFaint(state, sideId, actorSlot, timeline, actionOrder)
  if (targetFainted) {
    applyKnockoutTriggeredFormAfterFaint(state, attacker, defender, directDamage)
  }
  markActiveFaints(state, timeline, actionOrder)

  if (damage > 0) applyMoveSwitching(state, sideId, move, random, timeline, actionOrder, actorSlot, targetSlot)
  activateDancerCopies(state, sideId, attacker, move, random, timeline, actionOrder, targetSlot)
}

function resolveFutureMoves(state, timeline, random) {
  ;['player', 'opponent'].forEach((targetSideId) => {
    const targetSide = getSide(state, targetSideId)
    Object.entries(targetSide.futureMoveSlots ?? {}).forEach(([slotKey, futureMove]) => {
      futureMove.turns -= 1
      if (futureMove.turns > 0) return
      delete targetSide.futureMoveSlots[slotKey]

      const targetSlot = Number(slotKey)
      const defender = getActivePokemon(state, targetSideId, targetSlot)
      if (!isAvailableFieldPokemon(defender)) return
      const sourceSide = getSide(state, futureMove.sourceSideId)
      const attacker = sourceSide.team.find((pokemon) => pokemon.battleId === futureMove.sourceBattleId)
        ?? futureMove.sourceSnapshot
      const move = { ...futureMove.move, ignoreImmunity: false }
      if (!attacker || !moveHits(state, attacker, defender, move, random)) {
        appendLog(state, `${move.name}의 미래 공격은 빗나갔다!`, 'muted')
        return
      }

      const immunity = abilityImmunity(state, attacker, defender, move)
      const effectiveness = getMoveTypeEffectiveness(state, attacker, defender, move)
      if (immunity || effectiveness === 0) {
        appendLog(state, immunity
          ? `${defender.name}의 ${immunity}! 미래의 공격을 무효화했다.`
          : `${defender.name}에게는 ${move.name}의 효과가 없다!`, immunity ? 'ability' : 'muted')
        return
      }

      const previousHp = defender.hp
      const result = calculateDamage(state, attacker, defender, move, random)
      const damage = applySurvivalEffects(state, defender, result.damage, move, random)
      defender.hp = Math.max(0, defender.hp - damage)
      defender.lastDamageTaken = damage
      defender.lastDamageCategory = move.categoryId
      defender.lastAttackerBattleId = attacker.battleId
      defender.damagedThisTurn = damage > 0
      defender.hitCountTaken = (defender.hitCountTaken ?? 0) + (damage > 0 ? 1 : 0)
      appendLog(state, `${move.name}의 미래 공격이 ${defender.name}을(를) 덮쳤다!`, 'damage')
      if (result.critical) appendLog(state, '급소에 맞았다!', 'critical')
      if (result.effectiveness > 1) appendLog(state, '효과가 굉장했다!', 'super')
      else if (result.effectiveness < 1) appendLog(state, '효과가 별로인 듯하다…', 'muted')
      applyHpCrossingAbility(state, defender, previousHp)
      breakIllusion(state, defender)
      pushTimelineStep(timeline, state, {
        phase: 'impact',
        sideId: futureMove.sourceSideId,
        targetSideId,
        targetSlot,
        actorName: attacker.name,
        actorSpeciesId: attacker.speciesId,
        targetName: defender.name,
        targetSpeciesId: defender.speciesId,
        moveId: move.id,
        moveName: move.name,
        moveType: move.type,
        moveCategory: move.categoryId,
        damage,
        effectiveness: result.effectiveness,
        critical: result.critical,
        message: `${move.name}이(가) ${defender.name}에게 명중했다!`,
      })
      markPokemonFaint(state, targetSideId, targetSlot, timeline)
    })
  })
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
  refreshNeutralizingGas(state, { reactivate: false })
  if (pokemon.neutralizedAbility) return

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
  if (pokemon.neutralizedAbility) {
    pokemon.ability = pokemon.neutralizedAbility
    pokemon.neutralizedAbility = null
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
  pokemon.trapSourceBattleId = null
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
  pokemon.skyDropSourceBattleId = null
  pokemon.skyDropTargetBattleId = null
  pokemon.proteanUsed = false
  if (pokemon.typeRemovedByMove) {
    pokemon.typeRemovedByMove = false
    restorePokemonOwnTypes(pokemon)
  }
  pokemon.activeTurnCount = 0
  pokemon.activeMoveActions = 0
  pokemon.actedThisTurn = false
  pokemon.switchedInThisTurn = false
  pokemon.truantLoafing = false
  pokemon.flashFireActive = false
  pokemon.chargeActive = false
  pokemon.defenseCurlActive = false
  pokemon.minimized = false
  pokemon.rageActive = false
  pokemon.uproarTurns = 0
  pokemon.bideState = null
  pokemon.roostedThisTurn = false
  pokemon.smackDownActive = false
  pokemon.tarShotActive = false
  pokemon.glaiveRushVulnerable = false
  pokemon.noRetreatActive = false
  pokemon.custapActive = false
  pokemon.gorillaLockedMoveIndex = null
  pokemon.choiceLockedMoveIndex = null
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
  pokemon.substituteHp = 0
  pokemon.leechSeedSourceSideId = null
  pokemon.leechSeedSourceSlot = null
  pokemon.nightmareActive = false
  pokemon.cursedActive = false
  pokemon.stockpileCount = 0
  pokemon.stockpileBoosts = { defense: 0, specialDefense: 0 }
  pokemon.encoredMoveIndex = null
  pokemon.encoreTurns = 0
  pokemon.tauntTurns = 0
  pokemon.embargoTurns = 0
  pokemon.ingrainActive = false
  pokemon.aquaRingActive = false
  pokemon.magnetRiseTurns = 0
  pokemon.telekinesisTurns = 0
  if (pokemon.abilitySuppressed) pokemon.ability = pokemon.originalAbility
  pokemon.abilitySuppressed = false
  pokemon.magicCoatActive = false
  pokemon.snatchActive = false
  pokemon.imprisonActive = false
  pokemon.grudgeActive = false
  pokemon.ejectPackPending = false
  pokemon.helpingHandActive = false
  pokemon.powderActive = false
  pokemon.electrifyActive = false
  pokemon.laserFocusActive = false
  pokemon.octolockActive = false
  pokemon.dragonCheerTurns = 0
  pokemon.sureHitTargetBattleId = null
  pokemon.sureHitTurns = 0
  pokemon.foresightActive = false
  pokemon.miracleEyeActive = false
  pokemon.lastDamageTaken = 0
  pokemon.lastDamageCategory = null
  pokemon.lastAttackerBattleId = null
  pokemon.damagedThisTurn = false
  pokemon.hitByPhysicalThisTurn = false
  pokemon.hitCountTaken = 0
  pokemon.moveFailedLastTurn = false
  pokemon.moveFailedThisTurn = false
  pokemon.consecutiveMoveId = null
  pokemon.consecutiveMoveCount = 0
  pokemon.usedMoveIds = []
  pokemon.statsLoweredThisTurn = false
  pokemon.plannedActionType = null
  pokemon.plannedMoveId = null
  pokemon.plannedMoveCategory = null
  pokemon.plannedMovePriority = null
  pokemon.beakBlastCharging = false
  pokemon.pendingShedTailHp = 0
  pokemon.nextTurnOrderBias = 0
  pokemon.switchingOut = false
  if (pokemon.status?.id === 'toxic') pokemon.status.toxicCounter = 1
}

function applyEntryHazards(state, side, pokemon) {
  if (!pokemon || pokemon.fainted || pokemon.hp <= 0) return
  const hazards = side.hazards ?? {}
  if (hasActiveHeldItem(pokemon, 'heavy-duty-boots')) return

  if (Number(hazards.spikes ?? 0) > 0 && isGrounded(pokemon, state) && pokemon.ability !== '매직가드') {
    const denominator = Number(hazards.spikes) >= 3 ? 4 : Number(hazards.spikes) === 2 ? 6 : 8
    loseHp(state, pokemon, pokemon.maxHp / denominator, `${pokemon.name}은(는) 압정에 데미지를 입었다!`, 'field')
  }
  if (hazards.stickyWeb && isGrounded(pokemon, state)) {
    changeStages(state, pokemon, { speed: -1 }, { source: pokemon })
    appendLog(state, `${pokemon.name}은(는) 끈적끈적네트에 걸렸다!`, 'field')
  }

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

  const terrainSeedRules = {
    'electric-seed': { terrain: 'electric', boosts: { defense: 1 } },
    'grassy-seed': { terrain: 'grassy', boosts: { defense: 1 } },
    'misty-seed': { terrain: 'misty', boosts: { specialDefense: 1 } },
    'psychic-seed': { terrain: 'psychic', boosts: { specialDefense: 1 } },
  }
  const seedRule = terrainSeedRules[pokemon.heldItemId]
  if (seedRule?.terrain === state.rules?.terrain?.id && heldItemEffectsActive(pokemon)) {
    consumeHeldItem(state, pokemon)
    changeStages(state, pokemon, seedRule.boosts)
    appendLog(state, `${pokemon.name}의 ${pokemon.heldItemName || pokemon.heldItemId}이(가) 발동했다!`, 'item')
  }
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
    if (current.trappedTurns > 0 || current.skyDropSourceBattleId || abilitySource) {
      appendLog(
        state,
        `${current.name}은(는) ${current.skyDropSourceBattleId ? '프리폴' : current.trapSourceName ?? abilitySource?.ability ?? '기술의 효과'} 때문에 교체할 수 없다!`,
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
  refreshNeutralizingGas(state)
  target.switchedInThisTurn = true
  applyPendingDifficultyBoost(target)
  activateIllusion(state, sideId, target)
  const switchMessage = sideId === 'player'
    ? `${target.name}! 부탁해!`
    : `${side.name}은(는) ${target.name}을(를) 내보냈다!`
  appendLog(state, switchMessage, isAutomatic ? 'switch' : sideId)

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
    message: switchMessage,
  })
  activateEntryAbility(state, sideId, resolvedSlot)
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

function resolvePendingEjectPacks(state, timeline = null, actionOrder = null) {
  let switched = false
  ;['player', 'opponent'].forEach((sideId) => {
    const side = getSide(state, sideId)
    getActivePokemonList(state, sideId).forEach((pokemon, activeSlot) => {
      if (!pokemon?.ejectPackPending) return
      pokemon.ejectPackPending = false
      if (pokemon.fainted || pokemon.hp <= 0 || !hasActiveHeldItem(pokemon, 'eject-pack')) return
      const replacements = availableBenchIndexes(side)
      if (replacements.length === 0) return
      consumeHeldItem(state, pokemon)
      appendLog(state, `${pokemon.name}의 탈출팩이 작동했다!`, 'item')
      const targetIndex = sideId === 'opponent'
        ? chooseAiReplacementIndex(state, sideId, activeSlot)
        : replacements[0]
      if (targetIndex != null) {
        switched = performSwitch(state, sideId, targetIndex, true, timeline, actionOrder, activeSlot) || switched
      }
    })
  })
  return switched
}

function residualEffects(state, sideId, timeline = null, activeSlot = null, random = Math.random) {
  const side = getSide(state, sideId)
  const pokemon = getActivePokemon(state, sideId, activeSlot)
  if (!pokemon || pokemon.fainted || pokemon.hp <= 0 || pokemon.commanding) return
  const previousHp = pokemon.hp
  const previousMaxHp = pokemon.maxHp
  const previousLogLength = state.log.length
  const weatherId = effectiveMoveWeatherFamilyId(state, pokemon)

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

  if (pokemon.hp > 0 && pokemon.nightmareActive) {
    if (!isPokemonAsleep(pokemon)) pokemon.nightmareActive = false
    else if (pokemon.ability !== '매직가드') {
      loseHp(state, pokemon, pokemon.maxHp / 4, `${pokemon.name}은(는) 악몽에 시달렸다!`, 'status')
    }
  }

  if (pokemon.hp > 0 && pokemon.cursedActive && pokemon.ability !== '매직가드') {
    loseHp(state, pokemon, pokemon.maxHp / 4, `${pokemon.name}은(는) 저주로 HP가 줄었다!`, 'status')
  }

  if (pokemon.hp > 0 && pokemon.leechSeedSourceSideId && pokemon.ability !== '매직가드') {
    const drained = loseHp(state, pokemon, pokemon.maxHp / 8, `${pokemon.name}은(는) 씨뿌리기에 HP를 빼앗겼다!`, 'status')
    const sourceActives = getActivePokemonList(state, pokemon.leechSeedSourceSideId)
    const recipient = Number.isInteger(pokemon.leechSeedSourceSlot) && pokemon.leechSeedSourceSlot >= 0
      ? sourceActives[pokemon.leechSeedSourceSlot]
      : sourceActives.find((candidate) => candidate && !candidate.fainted && candidate.hp > 0)
    if (recipient) {
      applyDrainingRecovery(state, recipient, pokemon, drained, '씨뿌리기')
    }
  }

  if (
    pokemon.hp > 0
    && isPokemonAsleep(pokemon)
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

  if (
    pokemon.hp > 0
    && side.firePledgeTurns > 0
    && !pokemon.types.includes('불꽃')
    && pokemon.ability !== '매직가드'
  ) {
    loseHp(state, pokemon, pokemon.maxHp / 8, `${pokemon.name}은(는) 불바다의 데미지를 입었다!`, 'field')
  }

  if (pokemon.hp > 0 && pokemon.trappedTurns > 0) {
    if (pokemon.trapDamages && pokemon.ability !== '매직가드') {
      const trapSource = allBattlePokemon(state)
        .find((candidate) => candidate.battleId === pokemon.trapSourceBattleId)
      const trapDamage = Math.max(1, Math.floor(pokemon.maxHp / (hasActiveHeldItem(trapSource, 'binding-band') ? 6 : 8)))
      pokemon.hp = Math.max(0, pokemon.hp - trapDamage)
      appendLog(state, `${pokemon.name}은(는) ${pokemon.trapSourceName}에 시달렸다!`, 'damage')
    }
    pokemon.trappedTurns -= 1
    if (pokemon.trappedTurns <= 0) {
      appendLog(state, `${pokemon.name}은(는) 구속에서 벗어났다!`, 'heal')
      pokemon.trapSourceName = null
      pokemon.trapSourceBattleId = null
      pokemon.trapDamages = false
    }
  }

  if (pokemon.hp > 0 && pokemon.octolockActive) {
    changeStages(state, pokemon, { defense: -1, specialDefense: -1 })
  }

  if (pokemon.hp > 0 && pokemon.yawnTurns > 0) {
    if (pokemon.status) {
      pokemon.yawnTurns = 0
    } else {
      pokemon.yawnTurns -= 1
      if (pokemon.yawnTurns === 0) setStatus(state, pokemon, 'sleep', '하품', { random })
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

  if (pokemon.encoreTurns > 0) {
    pokemon.encoreTurns -= 1
    if (pokemon.encoreTurns <= 0) {
      pokemon.encoredMoveIndex = null
      appendLog(state, `${pokemon.name}의 앵콜 효과가 끝났다.`, 'heal')
    }
  }

  if (pokemon.tauntTurns > 0) {
    pokemon.tauntTurns -= 1
    if (pokemon.tauntTurns <= 0) appendLog(state, `${pokemon.name}의 도발 효과가 끝났다.`, 'heal')
  }

  if (pokemon.embargoTurns > 0) {
    pokemon.embargoTurns -= 1
    if (pokemon.embargoTurns <= 0) appendLog(state, `${pokemon.name}은(는) 다시 지닌물건을 쓸 수 있다.`, 'heal')
  }

  if (pokemon.magnetRiseTurns > 0) pokemon.magnetRiseTurns -= 1
  if (pokemon.telekinesisTurns > 0) pokemon.telekinesisTurns -= 1
  if (pokemon.dragonCheerTurns > 0) pokemon.dragonCheerTurns -= 1
  if (pokemon.sureHitTurns > 0) {
    pokemon.sureHitTurns -= 1
    if (pokemon.sureHitTurns <= 0) pokemon.sureHitTargetBattleId = null
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
  if (pokemon.hp > 0 && pokemon.ingrainActive) {
    healPokemon(state, pokemon, pokemon.maxHp * (hasActiveHeldItem(pokemon, 'big-root') ? 1.3 : 1) / 16, '뿌리박기')
  }
  if (pokemon.hp > 0 && pokemon.aquaRingActive) {
    healPokemon(state, pokemon, pokemon.maxHp * (hasActiveHeldItem(pokemon, 'big-root') ? 1.3 : 1) / 16, '아쿠아링')
  }
  if (pokemon.hp > 0 && state.rules?.terrain?.id === 'grassy' && isGrounded(pokemon, state)) {
    healPokemon(state, pokemon, pokemon.maxHp / 16, '그래스필드')
  }
  if (pokemon.hp > 0 && hasActiveHeldItem(pokemon, 'black-sludge') && pokemon.types.includes('독')) {
    healPokemon(state, pokemon, pokemon.maxHp / 16, '검은오물')
  }
  if (
    pokemon.hp > 0
    && hasActiveHeldItem(pokemon, 'black-sludge')
    && !pokemon.types.includes('독')
    && pokemon.ability !== '매직가드'
  ) loseHp(state, pokemon, pokemon.maxHp / 8, `${pokemon.name}은(는) 검은오물로 HP가 줄었다.`, 'item')
  if (pokemon.hp > 0 && hasActiveHeldItem(pokemon, 'sticky-barb') && pokemon.ability !== '매직가드') {
    loseHp(state, pokemon, pokemon.maxHp / 8, `${pokemon.name}은(는) 끈적끈적바늘에 찔렸다!`, 'item')
  }
  if (pokemon.hp > 0 && hasActiveHeldItem(pokemon, 'toxic-orb') && !pokemon.status) {
    setStatus(state, pokemon, 'toxic', '맹독구슬', { source: pokemon })
  }
  if (pokemon.hp > 0 && hasActiveHeldItem(pokemon, 'flame-orb') && !pokemon.status) {
    setStatus(state, pokemon, 'burn', '화염구슬', { source: pokemon })
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
    const sideTimers = {
      auroraVeilTurns: '오로라베일',
      lightScreenTurns: '빛의장막',
      reflectTurns: '리플렉터',
      safeguardTurns: '신비의부적',
      mistTurns: '흰안개',
      tailwindTurns: '순풍',
      luckyChantTurns: '주술',
      wideGuardTurns: '와이드가드',
      quickGuardTurns: '퍼스트가드',
      craftyShieldTurns: '트릭가드',
      matBlockTurns: '매트블록',
      firePledgeTurns: '불바다',
      grassPledgeTurns: '습지초원',
      waterPledgeTurns: '무지개',
    }
    Object.entries(sideTimers).forEach(([key, label]) => {
      if (side[key] <= 0) return
      side[key] -= 1
      if (side[key] <= 0 && !['wideGuardTurns', 'quickGuardTurns', 'craftyShieldTurns', 'matBlockTurns'].includes(key)) {
        appendLog(state, `${side.name} 진영의 ${label} 효과가 사라졌다.`, 'field')
      }
    })
    Object.entries(side.wishSlots ?? {}).forEach(([slot, wish]) => {
      wish.turns -= 1
      if (wish.turns > 0) return
      const target = getActivePokemon(state, side.id, Number(slot))
      if (target && target.hp > 0 && !target.fainted) healPokemon(state, target, wish.amount, `${wish.sourceName}의 소원`)
      delete side.wishSlots[slot]
    })
  })

  const fieldTimers = {
    gravityTurns: '중력',
    trickRoomTurns: '트릭룸',
    wonderRoomTurns: '원더룸',
    magicRoomTurns: '매직룸',
    mudSportTurns: '흙놀이',
    waterSportTurns: '물놀이',
    fairyLockTurns: '페어리록',
    ionDelugeTurns: '플라스마샤워',
  }
  Object.entries(fieldTimers).forEach(([key, label]) => {
    if (state.environment[key] <= 0) return
    state.environment[key] -= 1
    if (state.environment[key] <= 0) {
      if (key === 'magicRoomTurns') updateMagicRoomSuppression(state, false)
      if (!['ionDelugeTurns'].includes(key)) appendLog(state, `${label}의 효과가 사라졌다.`, 'field')
    }
  })
}

function markPokemonFaint(state, sideId, activeSlot, timeline = null, actionOrder = null) {
  const pokemon = getActivePokemon(state, sideId, activeSlot)
  if (!pokemon || pokemon.hp > 0 || pokemon.fainted) return false

  pokemon.fainted = true
  getSide(state, sideId).allyFaintedThisTurn = true
  releaseSkyDropConnections(state, pokemon)
  releaseTrapsSourcedBy(state, pokemon)
  appendLog(state, `${pokemon.name}은(는) 쓰러졌다!`, 'faint')
  releaseCommanderForPokemon(state, pokemon)
  inheritFaintedAllyAbility(state, sideId, pokemon)
  refreshNeutralizingGas(state)
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
  if (move?.id === 'pursuit' && defender?.switchingOut) return 11
  const resolvedGimmick = resolveAvailableActionGimmick(state, sideId, action.actorSlot, action.gimmick)
  const environmentMove = defender ? resolveEnvironmentMove(state, pokemon, defender, move) : move
  const zMove = resolvedGimmick === 'zmove' ? resolveBattleZMove(pokemon, environmentMove, move) : null
  const resolvedMove = zMove ?? resolveBattleMaxMove(pokemon, environmentMove, resolvedGimmick === 'dynamax', move)
  return environmentMovePriority(state, pokemon, resolvedMove)
}

function recordPlannedActions(state, sideId, actions) {
  actions.forEach((action) => {
    const pokemon = getActivePokemon(state, sideId, action.actorSlot)
    if (!pokemon) return
    pokemon.plannedActionType = action.forcedReason === 'recharge' ? 'recharge' : action.type
    if (action.type !== 'move' || action.forcedReason === 'recharge') return
    const defender = getActivePokemon(
      state,
      sideId === 'player' ? 'opponent' : 'player',
      action.targetSlot,
    )
    const move = pokemon.moves[action.moveIndex]
    if (!move || !defender) return
    const resolvedGimmick = resolveAvailableActionGimmick(state, sideId, action.actorSlot, action.gimmick)
    const environmentMove = resolveEnvironmentMove(state, pokemon, defender, move)
    const zMove = resolvedGimmick === 'zmove' ? resolveBattleZMove(pokemon, environmentMove, move) : null
    const resolvedMove = zMove
      ?? resolveBattleMaxMove(pokemon, environmentMove, resolvedGimmick === 'dynamax', move)
    pokemon.plannedMoveId = resolvedMove.id
    pokemon.plannedMoveCategory = resolvedMove.categoryId
      ?? (resolvedMove.category === '변화' ? 'status' : resolvedMove.category === '물리' ? 'physical' : 'special')
    pokemon.plannedMovePriority = environmentMovePriority(state, pokemon, resolvedMove)
    pokemon.beakBlastCharging = resolvedMove.id === 'beakblast'
  })
}

function orderedActions(state, playerActions, opponentActions, random) {
  const createOrderedAction = (sideId, action) => {
    const pokemon = getActivePokemon(state, sideId, action.actorSlot)
    const quickDrawActivated = action.type === 'move'
      && pokemon?.ability === '퀵드로'
      && random() < 0.3
    const quickClawActivated = action.type === 'move'
      && hasActiveHeldItem(pokemon, 'quick-claw')
      && random() < 0.2
    return {
      sideId,
      action: quickDrawActivated || quickClawActivated
        ? { ...action, quickDrawActivated, quickClawActivated }
        : action,
      actorBattleId: pokemon?.battleId,
      quickDrawActivated,
      quickClawActivated,
      tieBreaker: random(),
    }
  }
  const actionOrderModifier = ({ sideId, action, quickDrawActivated, quickClawActivated }) => {
    if (action.type !== 'move') return 0
    const pokemon = getActivePokemon(state, sideId, action.actorSlot)
    if (quickDrawActivated || quickClawActivated || pokemon?.custapActive) return 10
    const laggingItem = hasActiveHeldItem(pokemon, 'lagging-tail') || hasActiveHeldItem(pokemon, 'full-incense')
    return pokemon?.ability === '시간벌기' || laggingItem ? -10 : 0
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
    const speedDifference = state.environment?.trickRoomTurns > 0
      ? firstSpeed - secondSpeed
      : secondSpeed - firstSpeed
    return speedDifference || first.tieBreaker - second.tieBreaker
  })
}

function applyPendingTurnOrderChanges(state, actions, completedIndex) {
  allBattlePokemon(state).forEach((pokemon) => {
    const orderBias = Number(pokemon.nextTurnOrderBias ?? 0)
    if (!orderBias) return
    pokemon.nextTurnOrderBias = 0
    const pendingIndex = actions.findIndex((entry, index) => (
      index > completedIndex && entry.actorBattleId === pokemon.battleId
    ))
    if (pendingIndex < 0) return
    const [pendingAction] = actions.splice(pendingIndex, 1)
    if (orderBias > 0) actions.splice(completedIndex + 1, 0, pendingAction)
    else actions.push(pendingAction)
  })
}

function prepareSideMoveCombinations(state, sideId, actions) {
  const side = getSide(state, sideId)
  side.pendingPledge = null
  side.roundUsedThisTurn = false
  const pledgeIds = actions.flatMap((action) => {
    if (action.type !== 'move' || action.gimmick) return []
    const pokemon = getActivePokemon(state, sideId, action.actorSlot)
    const move = pokemon?.moves?.[action.moveIndex]
    return PLEDGE_MOVE_IDS.has(move?.id) ? [move.id] : []
  })
  side.pledgeComboPlanned = new Set(pledgeIds).size >= 2
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
const AI_NON_HOSTILE_STATUS_TARGETS = new Set(['self', 'allySide', 'allyTeam', 'all'])
const AI_HAZARD_CLEAR_MOVE_IDS = new Set(['defog', 'rapidspin', 'mortalspin', 'tidyup'])
const AI_SPREAD_MOVE_TARGETS = new Set(['allAdjacent', 'allAdjacentFoes'])

function projectAiPokemonForMechanic(attacker, gimmick) {
  if (gimmick === 'tera' && attacker.teraType) {
    return {
      ...attacker,
      types: [attacker.teraType],
      teraActive: true,
    }
  }

  if (!['mega', 'primal'].includes(gimmick)) return attacker
  const form = resolveBattleMechanicForm(attacker, gimmick, attacker.gimmickFormId)
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
  if (move.ohko) {
    if (defender.dynamaxActive || Number(attacker.level ?? 50) < Number(defender.level ?? 50)) return 0
    if (move.id === 'sheercold' && defender.types.includes('얼음')) return 0
    if (attacker.ability === '노가드' || defender.ability === '노가드') return 1
    const baseAccuracy = move.id === 'sheercold' && !attacker.types.includes('얼음') ? 20 : 30
    return Math.max(0, Math.min(1, (baseAccuracy + Number(attacker.level ?? 50) - Number(defender.level ?? 50)) / 100))
  }
  if (move.accuracyLabel === '필중' || move.accuracy == null) return 1
  if (attacker.ability === '노가드' || defender.ability === '노가드') return 1
  const weatherId = effectiveMoveWeatherFamilyId(state, attacker)
  if (weatherId === 'rain' && RAIN_PERFECT_ACCURACY_MOVE_IDS.has(move.id)) return 1
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
  return !moveIgnoresAbility(move, defender) && defender.ability === '미라클스킨' && isStatusMove(move)
    ? Math.min(0.5, accuracy)
    : accuracy
}

function aiExpectedHitCount(attacker, move) {
  if (parentalBondApplies(attacker, move)) return 1.25
  if (!move.multihit) return 1
  if (typeof move.multihit === 'number') {
    if (move.multiaccuracy) {
      const accuracy = Math.max(0, Math.min(1, (Number(move.accuracy) || 100) / 100))
      return Array.from({ length: move.multihit })
        .reduce((total, _, hitIndex) => total + accuracy ** hitIndex, 0)
    }
    return move.multihit
  }
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
  const effectiveness = !moveIgnoresAbility(move, defender)
    && defender.ability === '테라셸'
    && defender.hp === defender.maxHp
    && standardEffectiveness > 0
    ? 0.5
    : standardEffectiveness
  const immunity = moveIgnoresAbility(move, defender) ? null : abilityImmunity(state, attacker, defender, move)
  const accuracy = aiMoveAccuracy(state, attacker, defender, move)
  const semiInvulnerable = semiInvulnerableInteraction(defender, move, attacker)
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
      ignoreStages: !moveIgnoresAbility(move, defender) && defender.ability === '천진' && attackPokemon !== defender,
    })
    let defense = effectiveStat(state, defender, defenseKey, {
      ignoreStages: attacker.ability === '천진',
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
    const criticalAllowed = moveIgnoresAbility(move, defender) || !CRITICAL_HIT_IMMUNITY_ABILITIES.has(defender.ability)
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
    if (!moveIgnoresAbility(move, defender)) {
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

function aiIncomingCategoryPressure(state, sideId, categoryId = null) {
  const defenders = getActivePokemonList(state, sideId)
    .filter((pokemon) => pokemon && pokemon.hp > 0 && !pokemon.fainted)
  const attackers = getActivePokemonList(state, getOtherSide(state, sideId).id)
    .filter((pokemon) => pokemon && pokemon.hp > 0 && !pokemon.fainted)
  return attackers.reduce((total, attacker) => {
    const highest = attacker.moves.reduce((best, move) => {
      if (
        move.currentPp <= 0
        || isStatusMove(move)
        || categoryId && move.categoryId !== categoryId
      ) return best
      return defenders.reduce((bestAgainstDefender, defender) => {
        const resolved = resolveAiMove(state, attacker, defender, move, null)
        if (!resolved) return bestAgainstDefender
        const estimate = estimateAiDamage(state, resolved.attacker, defender, resolved.move)
        return Math.max(
          bestAgainstDefender,
          estimate.expectedDamage / Math.max(1, defender.maxHp),
        )
      }, best)
    }, 0)
    return total + highest
  }, 0)
}

function aiSpeedControlSwingCount(state, sideId, tailwind = false) {
  const ownTeam = getActivePokemonList(state, sideId)
    .filter((pokemon) => pokemon && pokemon.hp > 0 && !pokemon.fainted)
  const opposingTeam = getActivePokemonList(state, getOtherSide(state, sideId).id)
    .filter((pokemon) => pokemon && pokemon.hp > 0 && !pokemon.fainted)
  return ownTeam.reduce((total, pokemon) => (
    total + opposingTeam.filter((opponent) => {
      const ownSpeed = effectiveStat(state, pokemon, 'speed') * (tailwind ? 2 : 1)
      const opponentSpeed = effectiveStat(state, opponent, 'speed')
      return tailwind
        ? ownSpeed > opponentSpeed && ownSpeed / 2 <= opponentSpeed
        : ownSpeed < opponentSpeed
    }).length
  ), 0)
}

function aiHazardSetupUtility(state, attacker, defender, move, damaging = false) {
  const rule = HAZARD_MOVE_RULES[move.id]
  if (!rule) return null
  const targetSide = getPokemonSide(state, defender)
  const currentValue = Number(targetSide.hazards?.[rule.key] ?? 0)
  if (currentValue >= rule.maximum) return damaging ? 0 : -Infinity
  const nextHazards = {
    ...targetSide.hazards,
    [rule.key]: rule.maximum === 1 ? true : currentValue + 1,
  }
  const livingTargets = targetSide.team.filter((pokemon) => pokemon.hp > 0 && !pokemon.fainted)
  const addedPressure = livingTargets.reduce((total, pokemon) => (
    total
      + aiHazardEntryPenaltyScore(state, targetSide, pokemon, nextHazards)
      - aiHazardEntryPenaltyScore(state, targetSide, pokemon)
  ), 0)
  const benchPressure = availableBenchIndexes(targetSide).length * 7
  return 24 + addedPressure * 0.85 + benchPressure
}

function aiHazardClearUtility(state, attacker, move) {
  if (!AI_HAZARD_CLEAR_MOVE_IDS.has(move.id)) return null
  const ownSide = getPokemonSide(state, attacker)
  const opposingSide = getOtherSide(state, ownSide.id)
  const ownPressure = ownSide.team
    .filter((pokemon) => pokemon.hp > 0 && !pokemon.fainted)
    .reduce((total, pokemon) => total + aiHazardEntryPenaltyScore(state, ownSide, pokemon), 0)
  const clearsBothSides = ['defog', 'tidyup'].includes(move.id)
  const opposingPressure = clearsBothSides
    ? opposingSide.team
      .filter((pokemon) => pokemon.hp > 0 && !pokemon.fainted)
      .reduce((total, pokemon) => total + aiHazardEntryPenaltyScore(state, opposingSide, pokemon), 0)
    : 0
  return ownPressure - opposingPressure * 0.72
}

function aiSideConditionMoveScore(state, attacker, move) {
  const rule = SIDE_CONDITION_MOVE_RULES[move.id]
  if (!rule) return null
  const side = getPokemonSide(state, attacker)
  if (move.id === 'auroraveil' && effectiveWeatherFamilyId(state) !== 'snow') return -Infinity
  if (Number(side[rule.key] ?? 0) > 1) return -Infinity

  const livingCount = side.team.filter((pokemon) => pokemon.hp > 0 && !pokemon.fainted).length
  const opponents = getActivePokemonList(state, getOtherSide(state, side.id).id)
    .filter((pokemon) => pokemon && pokemon.hp > 0 && !pokemon.fainted)
  const physicalPressure = aiIncomingCategoryPressure(state, side.id, 'physical')
  const specialPressure = aiIncomingCategoryPressure(state, side.id, 'special')

  if (move.id === 'reflect') return 28 + physicalPressure * 88 + livingCount * 4
  if (move.id === 'lightscreen') return 28 + specialPressure * 88 + livingCount * 4
  if (move.id === 'auroraveil') return 48 + (physicalPressure + specialPressure) * 72 + livingCount * 6
  if (move.id === 'tailwind') {
    const speedSwings = aiSpeedControlSwingCount(state, side.id, true)
    return 34 + speedSwings * 34 + livingCount * 4
  }
  if (move.id === 'wideguard') {
    if ((state.rules?.format?.activeSlots ?? 1) <= 1) return -Infinity
    const spreadThreats = opponents.flatMap((pokemon) => pokemon.moves)
      .filter((candidate) => candidate.currentPp > 0 && AI_SPREAD_MOVE_TARGETS.has(candidate.target)).length
    return spreadThreats > 0 ? 58 + spreadThreats * 24 : -Infinity
  }
  if (move.id === 'quickguard') {
    const priorityThreats = opponents.reduce((total, pokemon) => (
      total + pokemon.moves.filter((candidate) => (
        candidate.currentPp > 0 && environmentMovePriority(state, pokemon, candidate) > 0
      )).length
    ), 0)
    return priorityThreats > 0 ? 48 + priorityThreats * 22 : -Infinity
  }
  if (move.id === 'craftyshield') {
    const statusThreats = opponents.flatMap((pokemon) => pokemon.moves)
      .filter((candidate) => candidate.currentPp > 0 && isStatusMove(candidate) && candidate.target === 'normal').length
    return statusThreats > 0 ? 46 + statusThreats * 18 : -Infinity
  }
  if (move.id === 'matblock') {
    if ((attacker.activeMoveActions ?? 0) > 0) return -Infinity
    return 52 + (physicalPressure + specialPressure) * 72
  }
  if (move.id === 'safeguard') {
    const statusThreats = opponents.flatMap((pokemon) => pokemon.moves)
      .filter((candidate) => candidate.currentPp > 0 && isStatusMove(candidate)).length
    return statusThreats > 0 ? 34 + statusThreats * 13 + livingCount * 3 : 12
  }
  if (move.id === 'mist') {
    const dropThreats = opponents.flatMap((pokemon) => pokemon.moves)
      .filter((candidate) => (
        candidate.currentPp > 0
        && Object.values(normalizedStageChanges(candidate.boosts)).some((amount) => amount < 0)
      )).length
    return dropThreats > 0 ? 32 + dropThreats * 15 : 10
  }
  if (move.id === 'luckychant') return 20 + livingCount * 3
  return 20 + (physicalPressure + specialPressure) * 28
}

function aiFieldEffectMoveScore(state, attacker, move) {
  const rule = FIELD_EFFECT_MOVE_RULES[move.id]
  if (!rule) return null
  const side = getPokemonSide(state, attacker)
  const opposingSide = getOtherSide(state, side.id)
  if (move.id === 'trickroom') {
    const slowerPairs = aiSpeedControlSwingCount(state, side.id)
    const ownActiveCount = aiLivingActiveSlots(state, side.id).length
    const opposingActiveCount = aiLivingActiveSlots(state, opposingSide.id).length
    const totalPairs = Math.max(1, ownActiveCount * opposingActiveCount)
    const fasterPairs = Math.max(0, totalPairs - slowerPairs)
    const active = Number(state.environment?.trickRoomTurns ?? 0) > 0
    const advantage = slowerPairs - fasterPairs
    if (active) return advantage < 0 ? 62 + Math.abs(advantage) * 28 : -Infinity
    return advantage > 0 ? 58 + advantage * 30 : 8
  }
  if (move.id === 'magicroom') {
    const ownItems = side.team.filter((pokemon) => pokemon.hp > 0 && heldItemEffectsActive(pokemon)).length
    const opposingItems = opposingSide.team.filter((pokemon) => pokemon.hp > 0 && heldItemEffectsActive(pokemon)).length
    const active = Number(state.environment?.magicRoomTurns ?? 0) > 0
    const advantage = opposingItems - ownItems
    if (active) return advantage < 0 ? 48 + Math.abs(advantage) * 12 : -Infinity
    return advantage > 0 ? 42 + advantage * 12 : 4
  }
  if (move.id === 'gravity') {
    const inaccurateMoves = side.team.flatMap((pokemon) => pokemon.moves)
      .filter((candidate) => candidate.currentPp > 0 && Number(candidate.accuracy ?? 100) < 85).length
    return 30 + inaccurateMoves * 10
  }
  return 24
}

function aiStatusMoveScore(state, attacker, defender, move) {
  const hpRatio = attacker.hp / Math.max(1, attacker.maxHp)
  const missingHpRatio = 1 - hpRatio
  const accuracy = aiMoveAccuracy(state, attacker, defender, move)
  if (attacker.healBlockTurns > 0 && isHealingMove(move)) return -Infinity
  const hazardUtility = aiHazardSetupUtility(state, attacker, defender, move)
  if (hazardUtility != null) return hazardUtility * accuracy
  const sideConditionUtility = aiSideConditionMoveScore(state, attacker, move)
  if (sideConditionUtility != null) return sideConditionUtility * accuracy
  const fieldEffectUtility = aiFieldEffectMoveScore(state, attacker, move)
  if (fieldEffectUtility != null) return fieldEffectUtility * accuracy
  const hazardClearUtility = aiHazardClearUtility(state, attacker, move)
  if (hazardClearUtility != null) return hazardClearUtility > 0 ? 26 + hazardClearUtility : -Infinity
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
    if (isPokemonAsleep(attacker) || restSleepBlocked(state, attacker)) return -Infinity
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
    const chancePerHit = secondaryEffectChance(state, attacker, effect) / 100
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

function aiThreatMechanics(state, attacker) {
  const side = getPokemonSide(state, attacker)
  const teamIndex = side.team.indexOf(attacker)
  const activeSlot = (side.activeIndexes ?? [side.activeIndex]).indexOf(teamIndex)
  if (activeSlot < 0) return [null]
  return [
    null,
    ...getAvailableBattleMechanics(state, side.id, activeSlot).map((mechanic) => mechanic.id),
  ]
}

function aiIncomingThreatRatio(state, pokemon, attackers) {
  const threatRatios = attackers
    .filter((attacker) => attacker && attacker.hp > 0 && !attacker.fainted)
    .map((attacker) => {
      const mechanics = aiThreatMechanics(state, attacker)
      return attacker.moves.reduce((highest, move) => {
        if (move.currentPp <= 0 || isStatusMove(move)) return highest
        return mechanics.reduce((highestWithMechanic, gimmick) => {
          const resolved = resolveAiMove(state, attacker, pokemon, move, gimmick)
          if (!resolved) return highestWithMechanic
          const estimate = estimateAiDamage(state, resolved.attacker, pokemon, resolved.move)
          return Math.max(
            highestWithMechanic,
            estimate.expectedDamage / Math.max(1, pokemon.maxHp),
          )
        }, highest)
      }, 0)
    })
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
  if (
    CHOICE_ITEM_IDS.has(attacker.heldItemId)
    && heldItemEffectsActive(attacker)
    && !attacker.dynamaxActive
    && attacker.choiceLockedMoveIndex != null
    && attacker.moves[attacker.choiceLockedMoveIndex] !== move
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

  if (resolvedMove.id === 'aurawheel' && !currentSpeciesSlug(projectedAttacker).startsWith('morpeko')) {
    return { score: -Infinity, estimatedDamage: 0, rawDamage: 0, priority, resolvedMove }
  }
  if (resolvedMove.id === 'hyperspacefury' && currentSpeciesSlug(projectedAttacker) !== 'hoopa-unbound') {
    return { score: -Infinity, estimatedDamage: 0, rawDamage: 0, priority, resolvedMove }
  }
  if (resolvedMove.id === 'dreameater' && !isPokemonAsleep(defender)) {
    return { score: -Infinity, estimatedDamage: 0, rawDamage: 0, priority, resolvedMove }
  }
  if (['snore', 'sleeptalk'].includes(resolvedMove.id) && !isPokemonAsleep(projectedAttacker)) {
    return { score: -Infinity, estimatedDamage: 0, rawDamage: 0, priority, resolvedMove }
  }
  if (
    resolvedMove.id === 'rest'
    && (projectedAttacker.hp >= projectedAttacker.maxHp || restSleepBlocked(state, projectedAttacker))
  ) {
    return { score: -Infinity, estimatedDamage: 0, rawDamage: 0, priority, resolvedMove }
  }

  if (hasActiveHeldItem(attacker, 'assault-vest') && isStatusMove(resolvedMove)) {
    return { score: -Infinity, estimatedDamage: 0, rawDamage: 0, priority, resolvedMove }
  }

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
    const targetsOpponent = !AI_NON_HOSTILE_STATUS_TARGETS.has(resolvedMove.target)
    if (
      targetsOpponent
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
    if (context.targetReserved && targetsOpponent) score -= 60
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
    const drainAmount = estimate.expectedDamage * numerator / denominator * drainingRecoveryMultiplier(attacker)
    if (!moveIgnoresAbility(resolvedMove, defender) && defender.ability === '해감액') {
      if (attacker.ability !== '매직가드') score -= drainAmount / projectedAttacker.maxHp * 90
    } else {
      const missingHp = Math.max(0, projectedAttacker.maxHp - projectedAttacker.hp)
      score += Math.min(missingHp, drainAmount) / projectedAttacker.maxHp * 65
    }
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
  score += aiHazardSetupUtility(state, projectedAttacker, defender, resolvedMove, true) ?? 0
  score += Math.max(0, aiHazardClearUtility(state, projectedAttacker, resolvedMove) ?? 0)

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

function aiHazardDamageRatio(state, side, pokemon, hazards = side.hazards ?? {}) {
  if (hasActiveHeldItem(pokemon, 'heavy-duty-boots') || pokemon.ability === '매직가드') return 0
  let ratio = 0
  if (hazards.stealthRock) ratio += getBattleTypeEffectiveness(state, '바위', pokemon.types) / 8
  if (hazards.steelsurge) ratio += getBattleTypeEffectiveness(state, '강철', pokemon.types) / 8
  if (Number(hazards.spikes ?? 0) > 0 && isGrounded(pokemon, state)) {
    const denominator = Number(hazards.spikes) >= 3 ? 4 : Number(hazards.spikes) === 2 ? 6 : 8
    ratio += 1 / denominator
  }
  return ratio
}

function aiHazardEntryPenaltyScore(state, side, pokemon, hazards = side.hazards ?? {}) {
  if (hasActiveHeldItem(pokemon, 'heavy-duty-boots')) return 0
  let score = aiHazardDamageRatio(state, side, pokemon, hazards) * 100
  if (!isGrounded(pokemon, state)) return score
  if (hazards.stickyWeb && !['클리어바디', '하얀연기', '메탈프로텍트'].includes(pokemon.ability)) {
    score += 18
  }
  if (
    Number(hazards.toxicSpikes ?? 0) > 0
    && !pokemon.status
    && !pokemon.types.some((type) => ['독', '강철'].includes(type))
    && !['면역', '정화의소금'].includes(pokemon.ability)
  ) {
    score += Number(hazards.toxicSpikes) >= 2 ? 34 : 20
  }
  return score
}

function aiEntryAbilityUtility(pokemon) {
  if (pokemon.ability === '위협') return 24
  if (ENTRY_WEATHER_ABILITIES[pokemon.ability] || ENTRY_TERRAIN_ABILITIES[pokemon.ability]) return 18
  return 0
}

function aiPositiveStageTotal(pokemon) {
  const difficultyBaseline = Math.max(0, Number(pokemon.difficultyBoostStage ?? 0))
  return Object.entries(pokemon.statStages).reduce((total, [statKey, stage]) => {
    const baseline = AI_DIFFICULTY_STAGE_STATS.includes(statKey) ? difficultyBaseline : 0
    return total + Math.max(0, Number(stage ?? 0) - baseline)
  }, 0)
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
const AI_HARD_MAX_PLAN_COUNT = 160
const AI_HARD_MAX_RESPONSE_PLAN_COUNT = 18
const AI_HARD_CONTINUATION_RESPONSE_COUNT = 4
const AI_HARD_CONTINUATION_PLAN_COUNT = 4
const AI_HARD_ROBUST_ROOT_PLAN_COUNT = 4

function aiSearchSettings(state, sideId) {
  const hard = sideId === 'opponent' && state.rules?.aiDifficulty?.id === 'hard'
  const multiBattle = (state.rules?.format?.activeSlots ?? 1) > 1
  return {
    hard,
    ownDecisionLimit: multiBattle ? hard ? 6 : 5 : hard ? 10 : 8,
    responseDecisionLimit: multiBattle ? hard ? 5 : 4 : hard ? 8 : 6,
    maxPlanCount: hard ? AI_HARD_MAX_PLAN_COUNT : AI_MAX_PLAN_COUNT,
    maxResponsePlanCount: hard ? AI_HARD_MAX_RESPONSE_PLAN_COUNT : AI_MAX_RESPONSE_PLAN_COUNT,
    responseTemperature: hard ? 14 : AI_RESPONSE_TEMPERATURE,
    continuationWeight: hard ? 0.46 : AI_CONTINUATION_WEIGHT,
    continuationResponseCount: hard
      ? AI_HARD_CONTINUATION_RESPONSE_COUNT
      : AI_CONTINUATION_RESPONSE_COUNT,
  }
}

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
    const immunity = moveIgnoresAbility(move, defender) ? null : abilityImmunity(state, attacker, defender, move)
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

function aiSideConditionBoardScore(state, sideId) {
  const side = getSide(state, sideId)
  const livingCount = remainingCount(side)
  const turnValue = (turns, base, perTurn = 3) => (
    Number(turns ?? 0) > 0 ? base + Math.min(5, Number(turns)) * perTurn + livingCount * 2 : 0
  )
  return turnValue(side.auroraVeilTurns, 34, 5)
    + turnValue(side.reflectTurns, 20, 4)
    + turnValue(side.lightScreenTurns, 20, 4)
    + turnValue(side.tailwindTurns, 24, 5)
    + turnValue(side.safeguardTurns, 12, 2)
    + turnValue(side.mistTurns, 10, 2)
}

function aiTrickRoomBoardScore(state, sideId) {
  if (Number(state.environment?.trickRoomTurns ?? 0) <= 0) return 0
  const ownCount = aiLivingActiveSlots(state, sideId).length
  const opposingCount = aiLivingActiveSlots(state, getOtherSide(state, sideId).id).length
  const totalPairs = Math.max(1, ownCount * opposingCount)
  const slowerPairs = aiSpeedControlSwingCount(state, sideId)
  return (slowerPairs - Math.max(0, totalPairs - slowerPairs)) * 16
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
    return total + aiHazardEntryPenaltyScore(state, side, pokemon) * 0.9
  }, 0)
  const activePressure = getActivePokemonList(state, sideId).reduce((total, pokemon) => {
    if (!pokemon || pokemon.fainted || pokemon.hp <= 0) return total
    return total + (pokemon.protected ? 5 : 0) + (pokemon.destinyBondActive ? 8 : 0)
  }, 0)
  return pokemonValue
    + aiEnvironmentAffinityScore(state, sideId)
    + aiSideConditionBoardScore(state, sideId)
    + aiTrickRoomBoardScore(state, sideId)
    + aiTeamCoverageScore(state, sideId)
    + aiActiveTacticalValue(state, sideId)
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
  return roleUtility + moveUtility + itemUtility + (pokemon.name === preferredLeadName ? 52 : 0)
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
      const hazardPenalty = aiHazardEntryPenaltyScore(state, side, pokemon)
      const toxicSpikesAbsorption = Number(side.hazards?.toxicSpikes ?? 0) > 0
        && isGrounded(pokemon, state)
        && pokemon.types.includes('독')
        ? 28
        : 0
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
          + toxicSpikesAbsorption
          - hazardPenalty * 0.72
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
    const hazardPenalty = aiHazardEntryPenaltyScore(state, side, pokemon)
    const toxicSpikesAbsorption = Number(side.hazards?.toxicSpikes ?? 0) > 0
      && isGrounded(pokemon, state)
      && pokemon.types.includes('독')
      ? 28
      : 0
    const sacrificePenalty = incomingThreat >= remainingHpRatio ? 175 : 0
    return {
      targetIndex,
      score: Math.max(0, offense?.score ?? 0) * 0.58
        + remainingHpRatio * 65
        - incomingThreat * 88
        - sacrificePenalty
        + aiEntryAbilityUtility(pokemon)
        + aiRoleUtility(state, pokemon, sideId) * 0.35
        + aiRosterMatchupUtility(state, pokemon, opposingSide.team)
        + toxicSpikesAbsorption
        - hazardPenalty * 0.72,
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
    if (move.flags?.includes('cantusetwice') && attacker.lastMoveId === move.id && !forcedAction) return
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

function aiResponseWeights(responsePlans, temperature = AI_RESPONSE_TEMPERATURE) {
  if (responsePlans.length === 0) return []
  const bestScore = responsePlans[0].score
  const rawWeights = responsePlans.map((plan) => Math.exp(
    Math.max(-8, (plan.score - bestScore) / temperature),
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

function scoreAiRobustContinuation(state, sideId, searchSettings) {
  if (state.winner || state.rules?.format?.activeSlots !== 1 || state.rules?.format?.rotation) return 0
  const continuationState = cloneBattle(state)
  continuationState.turn += 1
  const responseSideId = getOtherSide(continuationState, sideId).id
  const ownGroups = createSideCandidateGroups(
    continuationState,
    sideId,
    () => 0,
    AI_HARD_CONTINUATION_PLAN_COUNT,
    null,
    false,
  )
  const responseGroups = createSideCandidateGroups(
    continuationState,
    responseSideId,
    () => 0,
    AI_HARD_CONTINUATION_PLAN_COUNT,
    null,
    true,
  )
  if (
    ownGroups.length === 0
    || responseGroups.length === 0
    || ownGroups.some((group) => group.length === 0)
    || responseGroups.some((group) => group.length === 0)
  ) return 0

  const ownPlans = buildAiActionPlans(
    continuationState,
    sideId,
    ownGroups,
    AI_HARD_CONTINUATION_PLAN_COUNT,
  )
  const responsePlans = buildAiActionPlans(
    continuationState,
    responseSideId,
    responseGroups,
    AI_HARD_CONTINUATION_PLAN_COUNT,
  )
  const responseWeights = aiResponseWeights(responsePlans, searchSettings.responseTemperature)
  const baseAdvantage = aiBoardAdvantage(continuationState, sideId)
  return ownPlans.reduce((bestScore, ownPlan) => {
    const outcomes = responsePlans.map((responsePlan, index) => ({
      score: aiBoardAdvantage(
        simulateAiActionPlans(continuationState, sideId, ownPlan.decisions, responsePlan.decisions),
        sideId,
      ) - baseAdvantage,
      weight: responseWeights[index] ?? 1,
    }))
    const expectedScore = outcomes.reduce((total, outcome) => total + outcome.score * outcome.weight, 0)
    const worstScore = outcomes.reduce((worst, outcome) => Math.min(worst, outcome.score), Infinity)
    const robustScore = expectedScore * 0.62
      + worstScore * 0.38
      + ownPlan.score * 0.05
      - aiPlanReliabilityPenalty(ownPlan) * 0.45
    return Math.max(bestScore, robustScore)
  }, -Infinity)
}

function scorePredictiveAiPlan(
  state,
  sideId,
  ownPlan,
  responsePlans,
  baseAdvantage,
  searchSettings,
  robustContinuation,
) {
  const resolvedResponses = responsePlans.length > 0 ? responsePlans : [{ decisions: [], score: 0 }]
  const responseWeights = aiResponseWeights(resolvedResponses, searchSettings.responseTemperature)
  const outcomes = resolvedResponses.map((responsePlan, index) => {
    const simulation = simulateAiActionPlans(state, sideId, ownPlan.decisions, responsePlan.decisions)
    const immediateScore = aiBoardAdvantage(simulation, sideId) - baseAdvantage
    let continuationScore = immediateScore
    if (index < searchSettings.continuationResponseCount) {
      if (searchSettings.hard && robustContinuation) {
        continuationScore += scoreAiRobustContinuation(simulation, sideId, searchSettings)
      } else {
        const continuation = simulateAiGreedyContinuation(simulation, sideId)
        continuationScore = aiBoardAdvantage(continuation, sideId) - baseAdvantage
      }
    }
    return {
      score: immediateScore * (1 - searchSettings.continuationWeight)
        + continuationScore * searchSettings.continuationWeight,
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
  return ownPlan.score * (searchSettings.hard ? 0.08 : 0.12)
    + expectedScore * (searchSettings.hard ? 0.58 : 0.64)
    + worstScore * (searchSettings.hard ? 0.27 : 0.2)
    + tailScore * (searchSettings.hard ? 0.19 : 0.16)
    - aiPlanReliabilityPenalty(ownPlan) * (searchSettings.hard ? 0.62 : 0.5)
}

function choosePredictiveAiPlan(state, sideId, random, restrictedSlots = null) {
  const responseSideId = getOtherSide(state, sideId).id
  const searchSettings = aiSearchSettings(state, sideId)
  const ownGroups = createSideCandidateGroups(
    state,
    sideId,
    random,
    searchSettings.ownDecisionLimit,
    restrictedSlots,
    false,
  )
  if (ownGroups.length === 0 || ownGroups.some((group) => group.length === 0)) return null
  const ownPlans = buildAiActionPlans(state, sideId, ownGroups, searchSettings.maxPlanCount)
  const responseGroups = createSideCandidateGroups(
    state,
    responseSideId,
    () => 0,
    searchSettings.responseDecisionLimit,
    null,
    true,
  )
  const responsePlans = responseGroups.length > 0
    ? buildAiActionPlans(state, responseSideId, responseGroups, searchSettings.maxResponsePlanCount)
    : []
  const baseAdvantage = aiBoardAdvantage(state, sideId)
  const sideNoise = sideId === 'opponent'
    ? AI_TIER_NOISE[String(state.opponentMeta?.tier ?? 'S').toUpperCase()] ?? 1.4
    : AI_TIER_NOISE.S
  const finalNoise = searchSettings.hard ? 0 : sideNoise * 0.1

  return ownPlans
    .map((plan, planIndex) => ({
      ...plan,
      predictiveScore: scorePredictiveAiPlan(
        state,
        sideId,
        plan,
        responsePlans,
        baseAdvantage,
        searchSettings,
        searchSettings.hard && planIndex < AI_HARD_ROBUST_ROOT_PLAN_COUNT,
      )
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
    lastUsedMove: null,
    neutralizingGasRefreshActive: false,
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
  resolvePendingEjectPacks(state)
  return state
}

function resolveBattleTurn(state, playerAction, random, captureTimeline, opponentActionOverride = null) {
  if (!state || state.winner || state.awaitingPlayerSwitch) {
    return { state, timeline: [] }
  }

  const nextState = cloneBattle(state)
  const timeline = captureTimeline ? [] : null
  if (timeline) FORM_TIMELINE_CONTEXTS.set(nextState, { timeline, deferred: [] })
  nextState.lastEvent = null
  ;['player', 'opponent'].forEach((sideId) => {
    const side = getSide(nextState, sideId)
    side.allyFaintedLastTurn = Boolean(side.allyFaintedThisTurn)
    side.allyFaintedThisTurn = false
    side.team.forEach((pokemon) => {
      pokemon.moveFailedLastTurn = Boolean(pokemon.moveFailedThisTurn)
      pokemon.moveFailedThisTurn = false
      pokemon.damagedThisTurn = false
      pokemon.hitByPhysicalThisTurn = false
      pokemon.lastDamageTaken = 0
      pokemon.lastDamageCategory = null
      pokemon.lastAttackerBattleId = null
      pokemon.protected = false
      pokemon.protectMode = null
      pokemon.flinched = false
      pokemon.actedThisTurn = false
      pokemon.switchedInThisTurn = false
      pokemon.switchingOut = false
      pokemon.redirectTurns = 0
      pokemon.redirectMode = null
      pokemon.magicCoatActive = false
      pokemon.snatchActive = false
      pokemon.helpingHandActive = false
      pokemon.powderActive = false
      pokemon.electrifyActive = false
      pokemon.roostedThisTurn = false
      pokemon.glaiveRushVulnerable = false
      pokemon.statsLoweredThisTurn = false
      pokemon.plannedActionType = null
      pokemon.plannedMoveId = null
      pokemon.plannedMoveCategory = null
      pokemon.plannedMovePriority = null
      pokemon.beakBlastCharging = false
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
  prepareSideMoveCombinations(nextState, 'player', resolvedPlayerActions)
  prepareSideMoveCombinations(nextState, 'opponent', opponentActions)
  recordPlannedActions(nextState, 'player', resolvedPlayerActions)
  recordPlannedActions(nextState, 'opponent', opponentActions)
  resolvedPlayerActions.filter((action) => action.type === 'switch').forEach((action) => {
    const pokemon = getActivePokemon(nextState, 'player', action.actorSlot)
    if (pokemon) pokemon.switchingOut = true
  })
  opponentActions.filter((action) => action.type === 'switch').forEach((action) => {
    const pokemon = getActivePokemon(nextState, 'opponent', action.actorSlot)
    if (pokemon) pokemon.switchingOut = true
  })
  const actions = orderedActions(nextState, resolvedPlayerActions, opponentActions, random)
  ;[...nextState.player.team, ...nextState.opponent.team].forEach((pokemon) => {
    pokemon.nextTurnOrderBias = 0
    pokemon.custapActive = false
  })

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
      applyPendingTurnOrderChanges(nextState, actions, actionOrder)
    }
    resolvePendingEjectPacks(nextState, timeline, actionOrder)
    markActiveFaints(nextState, timeline, actionOrder)
    refreshNeutralizingGas(nextState)
  }

  resolveFutureMoves(nextState, timeline, random)
  markActiveFaints(nextState, timeline)

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
  flushDeferredFormTimeline(nextState)
  FORM_TIMELINE_CONTEXTS.delete(nextState)
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
