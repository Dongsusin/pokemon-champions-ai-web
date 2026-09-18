import pokemonData from './generatedPokemonData.json' with { type: 'json' }
import pokemonGenderData from './generatedPokemonGenderData.json' with { type: 'json' }
import gen5SpriteManifest from './generatedGen5SpriteManifest.json' with { type: 'json' }
import battleMoveData from './generatedBattleMoves.json' with { type: 'json' }
import { isBattleMoveSupported } from './moveSupportData.js'
import {
  createVirtualPokemonFormProfiles,
  decorateGeneratedPokemonProfile,
  getPokemonFormMetadata,
  isSavablePokemonForm as isSavableFormProfile,
} from './pokemonFormData.js'

const POKEAPI_SPRITE_ROOT = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon'
const SHOWDOWN_SPRITE_ROOT = 'https://play.pokemonshowdown.com/sprites'
const ANIMATED_FRONT = 1
const ANIMATED_BACK = 2
const ANIMATED_FRONT_SHINY = 4
const ANIMATED_BACK_SHINY = 8
const MIRRORED_SHOWDOWN_BACK_KEYS = new Set(['koraidon', 'miraidon'])

const uniqueSpriteSources = (...sources) => [...new Set(sources.filter(Boolean))]

const spriteSetFor = (entry) => {
  const [manifestSpriteKey, manifestAnimationMask = 0] = gen5SpriteManifest.profiles[entry.id] ?? []
  const spriteKey = entry.spriteKey ?? manifestSpriteKey
  const animationMask = Number(entry.animationMask ?? manifestAnimationMask)
  const isVirtualProfile = Boolean(entry.spriteKey && !gen5SpriteManifest.profiles[entry.id])
  const staticFront = spriteKey
    ? `${SHOWDOWN_SPRITE_ROOT}/gen5/${spriteKey}.png`
    : `${POKEAPI_SPRITE_ROOT}/${entry.id}.png`
  const pokeApiBack = isVirtualProfile ? '' : `${POKEAPI_SPRITE_ROOT}/back/${entry.id}.png`
  const showdownBack = spriteKey ? `${SHOWDOWN_SPRITE_ROOT}/gen5-back/${spriteKey}.png` : ''
  const parentBack = entry.parentSpeciesId
    ? `${POKEAPI_SPRITE_ROOT}/back/${entry.parentSpeciesId}.png`
    : ''
  const staticBackSources = MIRRORED_SHOWDOWN_BACK_KEYS.has(spriteKey)
    ? uniqueSpriteSources(pokeApiBack, parentBack, showdownBack)
    : uniqueSpriteSources(pokeApiBack, showdownBack, parentBack)
  const staticBack = staticBackSources[0]
  const staticFrontShiny = entry.shinyUnavailable
    ? staticFront
    : spriteKey
    ? `${SHOWDOWN_SPRITE_ROOT}/gen5-shiny/${spriteKey}.png`
    : `${POKEAPI_SPRITE_ROOT}/shiny/${entry.id}.png`
  const pokeApiBackShiny = isVirtualProfile || entry.shinyUnavailable
    ? ''
    : `${POKEAPI_SPRITE_ROOT}/back/shiny/${entry.id}.png`
  const showdownBackShiny = spriteKey ? `${SHOWDOWN_SPRITE_ROOT}/gen5-back-shiny/${spriteKey}.png` : ''
  const parentBackShiny = entry.parentSpeciesId
    ? `${POKEAPI_SPRITE_ROOT}/back/shiny/${entry.parentSpeciesId}.png`
    : ''
  const staticBackShinySources = entry.shinyUnavailable
    ? staticBackSources
    : MIRRORED_SHOWDOWN_BACK_KEYS.has(spriteKey)
    ? uniqueSpriteSources(pokeApiBackShiny, parentBackShiny, showdownBackShiny)
    : uniqueSpriteSources(pokeApiBackShiny, showdownBackShiny, parentBackShiny)
  const staticBackShiny = staticBackShinySources[0]

  return {
    icon: isVirtualProfile
      ? staticFront
      : `${POKEAPI_SPRITE_ROOT}/versions/generation-viii/icons/${entry.id}.png`,
    iconFallback: staticFront,
    spriteFront: animationMask & ANIMATED_FRONT
      ? `${SHOWDOWN_SPRITE_ROOT}/gen5ani/${spriteKey}.gif`
      : staticFront,
    spriteBack: animationMask & ANIMATED_BACK
      ? `${SHOWDOWN_SPRITE_ROOT}/gen5ani-back/${spriteKey}.gif`
      : staticBack,
    spriteFrontShiny: entry.shinyUnavailable
      ? animationMask & ANIMATED_FRONT
        ? `${SHOWDOWN_SPRITE_ROOT}/gen5ani/${spriteKey}.gif`
        : staticFront
      : animationMask & ANIMATED_FRONT_SHINY
      ? `${SHOWDOWN_SPRITE_ROOT}/gen5ani-shiny/${spriteKey}.gif`
      : staticFrontShiny,
    spriteBackShiny: entry.shinyUnavailable
      ? animationMask & ANIMATED_BACK
        ? `${SHOWDOWN_SPRITE_ROOT}/gen5ani-back/${spriteKey}.gif`
        : staticBack
      : animationMask & ANIMATED_BACK_SHINY
      ? `${SHOWDOWN_SPRITE_ROOT}/gen5ani-back-shiny/${spriteKey}.gif`
      : staticBackShiny,
    spriteFrontFallback: staticFront,
    spriteBackFallback: staticBackSources,
    spriteFrontShinyFallback: staticFrontShiny,
    spriteBackShinyFallback: staticBackShinySources,
  }
}

export const TYPE_CLASS = {
  노말: 'normal',
  불꽃: 'fire',
  물: 'water',
  전기: 'electric',
  풀: 'grass',
  얼음: 'ice',
  격투: 'fighting',
  독: 'poison',
  땅: 'ground',
  비행: 'flying',
  에스퍼: 'psychic',
  벌레: 'bug',
  바위: 'rock',
  고스트: 'ghost',
  드래곤: 'dragon',
  악: 'dark',
  강철: 'steel',
  페어리: 'fairy',
  스텔라: 'stellar',
}

export const TERA_TYPES = [
  '노말',
  '불꽃',
  '물',
  '전기',
  '풀',
  '얼음',
  '격투',
  '독',
  '땅',
  '비행',
  '에스퍼',
  '벌레',
  '바위',
  '고스트',
  '드래곤',
  '악',
  '강철',
  '페어리',
  '스텔라',
]

export const HIDDEN_POWER_TYPES = TERA_TYPES.filter((type) => (
  !['페어리', '스텔라'].includes(type)
))

export const DYNAMAX_MODES = [
  {
    id: 'dynamax',
    label: '다이맥스',
    shortLabel: '다이맥스',
    description: '포켓몬이 거대해지며 기술이 다이맥스 기술로 변화합니다.',
  },
  {
    id: 'gigantamax',
    label: '거다이맥스',
    shortLabel: '거다이맥스',
    description: '고유한 모습으로 거대해지며 전용 거다이맥스 기술을 사용할 수 있습니다.',
  },
]

export function typeClassName(type) {
  return TYPE_CLASS[type] ?? 'normal'
}

export function normalizeTeraType(teraType, fallbackType = '노말') {
  if (TERA_TYPES.includes(teraType)) return teraType
  return TERA_TYPES.includes(fallbackType) ? fallbackType : '노말'
}

export function normalizeHiddenPowerType(type) {
  return HIDDEN_POWER_TYPES.includes(type) ? type : '노말'
}

function resolveHiddenPowerConfiguration(pokemon = {}) {
  const hasConfigurationMarker = typeof pokemon.hiddenPowerTypeConfigured === 'boolean'
  const hiddenPowerTypeConfigured = hasConfigurationMarker
    ? pokemon.hiddenPowerTypeConfigured
    : Boolean(pokemon.hiddenPowerType && pokemon.hiddenPowerType !== '얼음')

  return {
    hiddenPowerType: normalizeHiddenPowerType(
      hiddenPowerTypeConfigured ? pokemon.hiddenPowerType : undefined,
    ),
    hiddenPowerTypeConfigured,
  }
}

export function normalizeDynamaxMode(dynamaxMode, speciesId) {
  return dynamaxMode === 'gigantamax' && canGigantamax(speciesId)
    ? 'gigantamax'
    : 'dynamax'
}

export const STAT_META = [
  { key: 'hp', label: 'HP', shortLabel: 'HP' },
  { key: 'attack', label: '공격', shortLabel: '공격' },
  { key: 'defense', label: '방어', shortLabel: '방어' },
  { key: 'specialAttack', label: '특수공격', shortLabel: '특공' },
  { key: 'specialDefense', label: '특수방어', shortLabel: '특방' },
  { key: 'speed', label: '스피드', shortLabel: '스피드' },
]

export const BATTLE_LEVEL = 50
export const STAT_POINT_TOTAL = 66
export const STAT_POINT_PER_STAT = 32

export const NATURE_OPTIONS = [
  { label: '노력', up: null, down: null },
  { label: '외로움', up: 'attack', down: 'defense' },
  { label: '용감', up: 'attack', down: 'speed' },
  { label: '고집', up: 'attack', down: 'specialAttack' },
  { label: '개구쟁이', up: 'attack', down: 'specialDefense' },
  { label: '대담', up: 'defense', down: 'attack' },
  { label: '온순', up: null, down: null },
  { label: '무사태평', up: 'defense', down: 'speed' },
  { label: '장난꾸러기', up: 'defense', down: 'specialAttack' },
  { label: '촐랑', up: 'defense', down: 'specialDefense' },
  { label: '겁쟁이', up: 'speed', down: 'attack' },
  { label: '성급', up: 'speed', down: 'defense' },
  { label: '성실', up: null, down: null },
  { label: '명랑', up: 'speed', down: 'specialAttack' },
  { label: '천진난만', up: 'speed', down: 'specialDefense' },
  { label: '조심', up: 'specialAttack', down: 'attack' },
  { label: '의젓', up: 'specialAttack', down: 'defense' },
  { label: '냉정', up: 'specialAttack', down: 'speed' },
  { label: '수줍음', up: null, down: null },
  { label: '덜렁', up: 'specialAttack', down: 'specialDefense' },
  { label: '차분', up: 'specialDefense', down: 'attack' },
  { label: '얌전', up: 'specialDefense', down: 'defense' },
  { label: '건방', up: 'specialDefense', down: 'speed' },
  { label: '신중', up: 'specialDefense', down: 'specialAttack' },
  { label: '변덕', up: null, down: null },
]

const BASE_MOVE_CATALOG = [
  { name: '몸통박치기', type: '노말', category: '물리', power: 40, pp: 35 },
  { name: '전광석화', type: '노말', category: '물리', power: 40, pp: 30 },
  { name: '누르기', type: '노말', category: '물리', power: 85, pp: 15 },
  { name: '파괴광선', type: '노말', category: '특수', power: 150, pp: 5 },
  { name: '방어', type: '노말', category: '변화', power: 0, pp: 10 },
  { name: '덩굴채찍', type: '풀', category: '물리', power: 45, pp: 25 },
  { name: '잎날가르기', type: '풀', category: '물리', power: 55, pp: 25 },
  { name: '에너지볼', type: '풀', category: '특수', power: 90, pp: 10 },
  { name: '리프블레이드', type: '풀', category: '물리', power: 90, pp: 15 },
  { name: '불꽃세례', type: '불꽃', category: '특수', power: 40, pp: 25 },
  { name: '불꽃엄니', type: '불꽃', category: '물리', power: 65, pp: 15 },
  { name: '화염방사', type: '불꽃', category: '특수', power: 90, pp: 15 },
  { name: '플레어드라이브', type: '불꽃', category: '물리', power: 120, pp: 15 },
  { name: '물대포', type: '물', category: '특수', power: 40, pp: 25 },
  { name: '아쿠아제트', type: '물', category: '물리', power: 40, pp: 20 },
  { name: '파도타기', type: '물', category: '특수', power: 90, pp: 15 },
  { name: '하이드로펌프', type: '물', category: '특수', power: 110, pp: 5 },
  { name: '전기쇼크', type: '전기', category: '특수', power: 40, pp: 30 },
  { name: '볼트체인지', type: '전기', category: '특수', power: 70, pp: 20 },
  { name: '10만볼트', type: '전기', category: '특수', power: 90, pp: 15 },
  { name: '볼트태클', type: '전기', category: '물리', power: 120, pp: 15 },
  { name: '독침', type: '독', category: '물리', power: 15, pp: 35 },
  { name: '베놈쇼크', type: '독', category: '특수', power: 65, pp: 10 },
  { name: '오물폭탄', type: '독', category: '특수', power: 90, pp: 10 },
  { name: '염동력', type: '에스퍼', category: '특수', power: 50, pp: 25 },
  { name: '사이코쇼크', type: '에스퍼', category: '특수', power: 80, pp: 10 },
  { name: '사이코키네시스', type: '에스퍼', category: '특수', power: 90, pp: 10 },
  { name: '발경', type: '격투', category: '물리', power: 60, pp: 10 },
  { name: '파동탄', type: '격투', category: '특수', power: 80, pp: 20 },
  { name: '인파이트', type: '격투', category: '물리', power: 120, pp: 5 },
  { name: '용의숨결', type: '드래곤', category: '특수', power: 60, pp: 20 },
  { name: '드래곤클로', type: '드래곤', category: '물리', power: 80, pp: 15 },
  { name: '용성군', type: '드래곤', category: '특수', power: 130, pp: 5 },
  { name: '애교부리기', type: '페어리', category: '변화', power: 0, pp: 20 },
  { name: '매지컬샤인', type: '페어리', category: '특수', power: 80, pp: 10 },
  { name: '문포스', type: '페어리', category: '특수', power: 95, pp: 15 },
  { name: '제비반환', type: '비행', category: '물리', power: 60, pp: 20 },
  { name: '에어슬래시', type: '비행', category: '특수', power: 75, pp: 15 },
  { name: '폭풍', type: '비행', category: '특수', power: 110, pp: 10 },
  { name: '물기', type: '악', category: '물리', power: 60, pp: 25 },
  { name: '깜짝베기', type: '악', category: '물리', power: 70, pp: 15 },
  { name: '악의파동', type: '악', category: '특수', power: 80, pp: 15 },
  { name: '섀도볼', type: '고스트', category: '특수', power: 80, pp: 15 },
  { name: '고스트다이브', type: '고스트', category: '물리', power: 90, pp: 10 },
  { name: '메탈클로', type: '강철', category: '물리', power: 50, pp: 35 },
  { name: '러스터캐논', type: '강철', category: '특수', power: 80, pp: 10 },
  { name: '냉동빔', type: '얼음', category: '특수', power: 90, pp: 10 },
  { name: '지진', type: '땅', category: '물리', power: 100, pp: 10 },
]

const MOVE_DETAILS = {
  몸통박치기: { accuracy: 100, description: '온몸으로 상대에게 부딪쳐 공격한다. 특별한 추가 효과는 없다.' },
  전광석화: { accuracy: 100, description: '눈에 보이지 않는 굉장한 속도로 돌진한다. 우선도가 높아 먼저 행동하기 쉽다.' },
  누르기: { accuracy: 100, description: '큰 몸으로 상대를 눌러 공격한다. 30% 확률로 상대를 마비 상태로 만든다.' },
  파괴광선: { accuracy: 90, description: '강력한 광선을 발사한다. 사용한 다음 턴에는 반동으로 움직일 수 없다.' },
  방어: { accuracy: null, accuracyLabel: '—', description: '그 턴에 받는 대부분의 기술을 막는다. 연속으로 사용하면 실패하기 쉬워진다.' },
  덩굴채찍: { accuracy: 100, description: '채찍처럼 휘어지는 가느다란 덩굴로 상대를 힘껏 때린다.' },
  잎날가르기: { accuracy: 95, description: '잎사귀를 날려 상대를 베어 공격한다. 급소에 맞을 확률이 높다.' },
  에너지볼: { accuracy: 100, description: '자연의 생명력을 모아 발사한다. 10% 확률로 상대의 특수방어를 1랭크 낮춘다.' },
  리프블레이드: { accuracy: 100, description: '날카로운 잎으로 상대를 베어 가른다. 급소에 맞을 확률이 높다.' },
  불꽃세례: { accuracy: 100, description: '작은 불꽃을 발사한다. 10% 확률로 상대를 화상 상태로 만든다.' },
  불꽃엄니: { accuracy: 95, description: '불꽃을 두른 이빨로 문다. 각각 10% 확률로 화상 또는 풀죽음 효과를 준다.' },
  화염방사: { accuracy: 100, description: '세찬 불꽃을 발사한다. 10% 확률로 상대를 화상 상태로 만든다.' },
  플레어드라이브: { accuracy: 100, description: '불꽃을 두르고 돌진한다. 준 피해의 일부를 반동으로 받고 10% 확률로 화상을 입힌다.' },
  물대포: { accuracy: 100, description: '물을 세차게 발사해 상대를 공격한다. 특별한 추가 효과는 없다.' },
  아쿠아제트: { accuracy: 100, description: '물을 두르고 굉장한 속도로 돌진한다. 우선도가 높아 먼저 행동하기 쉽다.' },
  파도타기: { accuracy: 100, description: '큰 파도로 주위의 포켓몬을 덮친다. 더블배틀에서는 자신 이외의 인접 포켓몬을 공격한다.' },
  하이드로펌프: { accuracy: 80, description: '대량의 물을 세찬 기세로 발사하는 고위력 물 기술이다.' },
  전기쇼크: { accuracy: 100, description: '약한 전격을 날린다. 10% 확률로 상대를 마비 상태로 만든다.' },
  볼트체인지: { accuracy: 100, description: '공격한 뒤 대기 포켓몬과 교대한다. 교대할 포켓몬이 없으면 그대로 남는다.' },
  '10만볼트': { accuracy: 100, description: '강한 전격을 발사한다. 10% 확률로 상대를 마비 상태로 만든다.' },
  볼트태클: { accuracy: 100, description: '전기를 두르고 돌진한다. 준 피해의 일부를 반동으로 받고 10% 확률로 마비시킨다.' },
  독침: { accuracy: 100, description: '독이 있는 침을 찌른다. 30% 확률로 상대를 독 상태로 만든다.' },
  베놈쇼크: { accuracy: 100, description: '특수한 독액을 끼얹는다. 상대가 독 또는 맹독 상태라면 위력이 2배가 된다.' },
  오물폭탄: { accuracy: 100, description: '더러운 오물을 던진다. 30% 확률로 상대를 독 상태로 만든다.' },
  염동력: { accuracy: 100, description: '약한 염동력을 보낸다. 10% 확률로 상대를 혼란 상태로 만든다.' },
  사이코쇼크: { accuracy: 100, description: '이상한 염파를 실체화해 공격한다. 특수 기술이지만 상대의 방어로 피해를 계산한다.' },
  사이코키네시스: { accuracy: 100, description: '강한 염동력으로 공격한다. 10% 확률로 상대의 특수방어를 1랭크 낮춘다.' },
  발경: { accuracy: 100, description: '충격파를 몸에 전달한다. 30% 확률로 상대를 마비 상태로 만든다.' },
  파동탄: { accuracy: null, accuracyLabel: '필중', description: '몸속의 파동을 탄환처럼 발사한다. 명중률과 회피율 변화에 관계없이 반드시 맞는다.' },
  인파이트: { accuracy: 100, description: '방어를 버리고 접근해서 공격한다. 사용 후 자신의 방어와 특수방어가 1랭크씩 내려간다.' },
  용의숨결: { accuracy: 100, description: '강한 숨결을 내뿜는다. 30% 확률로 상대를 마비 상태로 만든다.' },
  드래곤클로: { accuracy: 100, description: '날카로운 큰 발톱으로 상대를 할퀸다. 특별한 추가 효과는 없다.' },
  용성군: { accuracy: 90, description: '하늘에서 운석을 떨어뜨린다. 사용 후 자신의 특수공격이 2랭크 내려간다.' },
  애교부리기: { accuracy: 100, description: '귀엽게 바라보며 방심시켜 상대의 공격을 2랭크 낮춘다.' },
  매지컬샤인: { accuracy: 100, description: '강력한 빛을 내어 공격한다. 더블배틀에서는 상대편 두 포켓몬을 모두 공격한다.' },
  문포스: { accuracy: 100, description: '달의 힘을 빌려 공격한다. 30% 확률로 상대의 특수공격을 1랭크 낮춘다.' },
  제비반환: { accuracy: null, accuracyLabel: '필중', description: '재빠른 움직임으로 상대를 농락해 벤다. 명중률과 회피율 변화에 관계없이 반드시 맞는다.' },
  에어슬래시: { accuracy: 95, description: '하늘을 가르는 공기의 칼날을 날린다. 30% 확률로 상대를 풀죽게 만든다.' },
  폭풍: { accuracy: 70, description: '강렬한 바람으로 공격한다. 30% 확률로 혼란시키며 비가 오면 반드시 명중한다.' },
  물기: { accuracy: 100, description: '날카로운 이빨로 문다. 30% 확률로 상대를 풀죽게 만든다.' },
  깜짝베기: { accuracy: 100, description: '순간의 틈을 노려 상대를 벤다. 급소에 맞을 확률이 높다.' },
  악의파동: { accuracy: 100, description: '악의로 가득 찬 오라를 발산한다. 20% 확률로 상대를 풀죽게 만든다.' },
  섀도볼: { accuracy: 100, description: '검은 그림자 덩어리를 던진다. 20% 확률로 상대의 특수방어를 1랭크 낮춘다.' },
  고스트다이브: { accuracy: 100, description: '첫 턴에 모습을 감추고 다음 턴에 공격한다. 방어 계열 기술의 효과를 무시한다.' },
  메탈클로: { accuracy: 95, description: '강철 발톱으로 할퀸다. 10% 확률로 자신의 공격이 1랭크 올라간다.' },
  러스터캐논: { accuracy: 100, description: '몸의 빛을 모아 발사한다. 10% 확률로 상대의 특수방어를 1랭크 낮춘다.' },
  냉동빔: { accuracy: 100, description: '차가운 빔을 발사한다. 10% 확률로 상대를 얼음 상태로 만든다.' },
  지진: { accuracy: 100, description: '지면을 흔들어 주위의 포켓몬을 공격한다. 땅속에 숨은 상대에게는 위력이 2배가 된다.' },
}

export const BATTLE_MOVE_META = {
  generatedAt: battleMoveData.generatedAt,
  source: battleMoveData.source,
  moveCount: battleMoveData.moveCount,
}

export const MOVE_CATALOG = battleMoveData.moves

const CURATED_ABILITY_CATALOG = {
  심록: { trigger: 'HP 1/3 이하', description: 'HP가 최대 HP의 1/3 이하일 때 풀타입 기술의 위력이 1.5배가 된다.' },
  엽록소: { trigger: '쾌청', description: '날씨가 쾌청일 때 스피드가 2배가 된다.' },
  맹화: { trigger: 'HP 1/3 이하', description: 'HP가 최대 HP의 1/3 이하일 때 불꽃타입 기술의 위력이 1.5배가 된다.' },
  선파워: { trigger: '쾌청', description: '날씨가 쾌청일 때 특수공격이 1.5배가 되지만 매 턴 HP가 감소한다.' },
  급류: { trigger: 'HP 1/3 이하', description: 'HP가 최대 HP의 1/3 이하일 때 물타입 기술의 위력이 1.5배가 된다.' },
  젖은접시: { trigger: '비', description: '날씨가 비일 때 매 턴 최대 HP의 1/16을 회복한다.' },
  정전기: { trigger: '접촉 공격', description: '접촉 기술로 공격받으면 30% 확률로 상대를 마비 상태로 만든다.' },
  피뢰침: { trigger: '전기 기술', description: '전기 기술을 자신에게 끌어와 무효화하고 특수공격을 1랭크 올린다.' },
  타오르는불꽃: { trigger: '불꽃 기술', description: '불꽃 기술을 무효화한다. 발동 후 자신이 사용하는 불꽃 기술의 위력이 1.5배가 된다.' },
  가뭄: { trigger: '등장 시', description: '배틀에 나오면 날씨를 쾌청으로 만든다.' },
  습기: { trigger: '항상', description: '배틀에 있는 동안 자폭·대폭발 등 폭발하는 기술을 사용할 수 없게 한다.' },
  날씨부정: { trigger: '항상', description: '배틀에 있는 동안 날씨가 기술과 특성에 주는 효과를 무효화한다.' },
  쓱쓱: { trigger: '비', description: '날씨가 비일 때 스피드가 2배가 된다.' },
  위협: { trigger: '등장 시', description: '배틀에 나오면 상대 포켓몬의 공격을 1랭크 낮춘다.' },
  총대장: { trigger: '등장 시 · 아군의 누적 기절', description: '등장 시점까지 아군이 기절한 누적 횟수당 기술 위력이 10%씩 증가한다(최대 50%, 1.5배). 부활 후 다시 기절한 횟수도 포함하며, 배율은 교대할 때까지 유지되고 재등장 시 갱신된다. 능력치 랭크는 변하지 않는다.' },
  오기: { trigger: '상대에 의한 능력치 하락', description: '상대에 의해 자신의 능력치 랭크가 내려갈 때마다 공격이 2랭크 올라간다. 자신이나 아군의 효과로 내려가면 발동하지 않는다.' },
  프레셔: { trigger: '상대 기술의 대상', description: '자신을 대상으로 기술을 사용하는 상대는 PP를 1 더 소모한다. 여러 프레셔 포켓몬을 대상으로 하면 각각 추가 소모하며, 아군의 기술에는 적용되지 않는다.' },
  정의의마음: { trigger: '악 기술 피격', description: '악타입 기술로 공격받으면 공격이 1랭크 올라간다.' },
  도주: { trigger: '야생 배틀', description: '야생 포켓몬과의 배틀에서 반드시 도망칠 수 있다. 트레이너 배틀에서는 효과가 없다.' },
  적응력: { trigger: '같은 타입 기술', description: '자신과 같은 타입인 기술의 위력 보정이 1.5배에서 2배로 강화된다.' },
  위험예지: { trigger: '등장 시', description: '상대가 효과가 굉장한 기술이나 일격필살기를 가지고 있으면 몸을 떤다.' },
  저수: { trigger: '물 기술', description: '물타입 기술을 무효화하고 최대 HP의 1/4을 회복한다.' },
  촉촉바디: { trigger: '비', description: '날씨가 비일 때 턴이 끝날 때마다 자신의 상태 이상을 회복한다.' },
  축전: { trigger: '전기 기술', description: '전기타입 기술을 무효화하고 최대 HP의 1/4을 회복한다.' },
  속보: { trigger: '상태 이상', description: '상태 이상일 때 스피드가 1.5배가 되며 마비의 스피드 감소 효과를 무시한다.' },
  근성: { trigger: '상태 이상', description: '상태 이상일 때 공격이 1.5배가 되며 화상의 공격 감소 효과를 무시한다.' },
  싱크로: { trigger: '상태 이상', description: '상대에게 독·마비·화상을 받으면 가능한 경우 상대도 같은 상태 이상으로 만든다.' },
  매직미러: { trigger: '변화 기술', description: '자신을 대상으로 한 대부분의 변화 기술을 사용한 상대에게 되돌려준다.' },
  정신력: { trigger: '항상', description: '풀죽지 않으며 위협으로 공격이 떨어지지 않는다.' },
  리프가드: { trigger: '쾌청', description: '날씨가 쾌청일 때 상태 이상이 되지 않는다.' },
  눈숨기: { trigger: '설경', description: '날씨가 설경일 때 상대 기술의 명중률이 낮아진다.' },
  아이스바디: { trigger: '설경', description: '날씨가 설경일 때 매 턴 최대 HP의 1/16을 회복한다.' },
  헤롱헤롱바디: { trigger: '접촉 공격', description: '접촉 기술로 공격받으면 30% 확률로 성별이 다른 상대를 헤롱헤롱 상태로 만든다.' },
  페어리스킨: { trigger: '노말 기술', description: '노말타입 기술이 페어리타입으로 바뀌고 위력이 1.2배가 된다.' },
  면역: { trigger: '항상', description: '독 또는 맹독 상태가 되지 않는다.' },
  두꺼운지방: { trigger: '피격 시', description: '불꽃타입과 얼음타입 기술로 받는 피해를 절반으로 줄인다.' },
  먹보: { trigger: '나무열매', description: '보통 HP가 1/4 이하일 때 먹는 나무열매를 HP가 절반 이하일 때 미리 먹는다.' },
  탈피: { trigger: '턴 종료', description: '턴이 끝날 때마다 30% 확률로 자신의 상태 이상을 회복한다.' },
  이상한비늘: { trigger: '상태 이상', description: '상태 이상일 때 방어가 1.5배가 된다.' },
  멀티스케일: { trigger: 'HP 최대', description: 'HP가 가득 차 있을 때 공격으로 받는 피해를 절반으로 줄인다.' },
  의욕: { trigger: '물리 기술', description: '공격이 1.5배가 되지만 물리 기술의 명중률이 0.8배가 된다.' },
  하늘의은총: { trigger: '추가 효과', description: '자신이 사용하는 기술의 추가 효과 발생 확률이 2배가 된다.' },
  대운: { trigger: '항상', description: '자신이 사용하는 기술이 급소에 맞을 확률이 1단계 올라간다.' },
  트레이스: { trigger: '등장 시', description: '배틀에 나오면 상대 포켓몬 중 하나의 특성을 복사한다.' },
  텔레파시: { trigger: '아군 기술', description: '더블배틀에서 아군이 사용한 공격 기술의 피해를 받지 않는다.' },
  불굴의마음: { trigger: '풀죽음', description: '풀죽을 때마다 스피드가 1랭크 올라간다.' },
  예리함: { trigger: '베기 기술', description: '칼이나 잎으로 베는 기술의 위력이 1.5배가 된다.' },
  짓궂은마음: { trigger: '변화 기술', description: '변화 기술의 우선도가 1 올라간다. 악타입 상대에게 사용한 변화 기술은 실패한다.' },
  변환자재: { trigger: '기술 사용', description: '배틀에 나온 뒤 처음 사용하는 기술과 같은 타입으로 자신의 타입이 변한다.' },
  천진: { trigger: '능력 변화', description: '공격하거나 공격받을 때 상대의 관련 능력 랭크 변화를 무시한다.' },
  자기과신: { trigger: '상대 쓰러뜨림', description: '자신의 공격으로 상대를 쓰러뜨리면 공격이 1랭크 올라간다.' },
  초상투영: { trigger: '테라스탈', description: '테라스탈하면 가면에 담긴 기억을 비추어 모습이 변하고 가면에 대응하는 능력이 1랭크 올라간다.' },
}

export const ABILITY_CATALOG = {
  ...pokemonData.abilities,
  ...CURATED_ABILITY_CATALOG,
}

const MOVE_BY_NAME = Object.fromEntries(MOVE_CATALOG.map((move) => [move.name, move]))
const MOVE_BY_ID = Object.fromEntries(MOVE_CATALOG.map((move) => [move.id, move]))
const MOVE_BY_NUMBER = Object.fromEntries(MOVE_CATALOG.map((move) => [move.number, move]))

const TYPE_DEFAULT_MOVES = {
  노말: ['몸통박치기', '전광석화', '누르기', '파괴광선'],
  풀: ['덩굴채찍', '잎날가르기', '에너지볼', '리프블레이드'],
  불꽃: ['불꽃세례', '불꽃엄니', '화염방사', '플레어드라이브'],
  물: ['물대포', '아쿠아제트', '파도타기', '하이드로펌프'],
  전기: ['전기쇼크', '볼트체인지', '10만볼트', '볼트태클'],
  독: ['독침', '베놈쇼크', '오물폭탄', '방어'],
  에스퍼: ['염동력', '사이코쇼크', '사이코키네시스', '섀도볼'],
  격투: ['발경', '파동탄', '인파이트', '방어'],
  드래곤: ['용의숨결', '드래곤클로', '용성군', '폭풍'],
  페어리: ['애교부리기', '매지컬샤인', '문포스', '사이코키네시스'],
  비행: ['제비반환', '에어슬래시', '폭풍', '방어'],
  악: ['물기', '깜짝베기', '악의파동', '방어'],
  고스트: ['섀도볼', '고스트다이브', '악의파동', '방어'],
  강철: ['메탈클로', '러스터캐논', '인파이트', '방어'],
  얼음: ['냉동빔', '물대포', '방어', '파괴광선'],
}

const profile = (entry) => ({
  ...entry,
  ...spriteSetFor(entry),
})

const GENERATED_PROFILE_LIST = [...pokemonData.species, ...pokemonData.forms]
  .map(decorateGeneratedPokemonProfile)
const VIRTUAL_FORM_PROFILES = createVirtualPokemonFormProfiles(GENERATED_PROFILE_LIST)
const PROFILE_LIST_WITH_SPRITES = [...GENERATED_PROFILE_LIST, ...VIRTUAL_FORM_PROFILES].map(profile)
const SOURCE_PROFILE_BY_ID = new Map(PROFILE_LIST_WITH_SPRITES.map((entry) => [Number(entry.id), entry]))
const SOURCE_PROFILE_BY_SLUG = new Map(PROFILE_LIST_WITH_SPRITES.map((entry) => [entry.slug, entry]))

function battleGimmickProfileName(entry) {
  const sourceName = SOURCE_PROFILE_BY_ID.get(Number(entry.parentSpeciesId))?.name ?? entry.name
  const megaVariant = entry.slug.match(/-mega(?:-?([xyz]))?$/)?.[1]?.toUpperCase() ?? ''

  if (megaVariant || entry.slug.endsWith('-mega')) {
    return entry.name.startsWith('메가') ? entry.name : `메가${sourceName}${megaVariant}`
  }
  if (entry.slug.endsWith('-gmax')) return `거다이맥스 ${sourceName}`
  if (entry.slug.endsWith('-primal')) return `원시${sourceName}`
  return entry.name
}

function pokemonProfileDisplayName(entry) {
  if (getPokemonFormMetadata(entry).formKind === 'gimmick') {
    return battleGimmickProfileName(entry)
  }

  const baseProfile = SOURCE_PROFILE_BY_ID.get(Number(entry.parentSpeciesId))
  if (baseProfile) return baseProfile.name

  const sourceProfile = entry.sourceSlug
    ? SOURCE_PROFILE_BY_SLUG.get(entry.sourceSlug)
    : null
  return sourceProfile?.name ?? entry.name
}

const PROFILE_LIST = PROFILE_LIST_WITH_SPRITES.map((entry) => ({
  ...entry,
  formName: entry.name,
  name: pokemonProfileDisplayName(entry),
}))
const PROFILE_BY_SLUG = new Map(PROFILE_LIST.map((entry) => [entry.slug, entry]))
const RELATED_PROFILE_OPTIONS_BY_BASE_ID = new Map()

const BATTLE_FORM_SOURCE_SLUGS = Object.freeze({
  'darmanitan-zen': ['darmanitan'],
  'darmanitan-galar-zen': ['darmanitan-galar-standard'],
  'eevee-gmax': ['eevee'],
  'floette-mega': ['floette-eternal'],
  'greninja-ash': ['greninja'],
  'greninja-mega': ['greninja'],
  'meowstic-male-mega': ['meowstic'],
  'meowstic-female-mega': ['meowstic-female'],
  'meowth-gmax': ['meowth'],
  'mimikyu-busted': ['mimikyu'],
  'mimikyu-totem-busted': ['mimikyu-totem-disguised'],
  'necrozma-ultra': ['necrozma-dusk', 'necrozma-dawn'],
  'pikachu-gmax': ['pikachu', 'pikachu-f'],
  'raichu-mega-x': ['raichu', 'raichu-f'],
  'raichu-mega-y': ['raichu', 'raichu-f'],
  'slowbro-mega': ['slowbro'],
  'toxtricity-amped-gmax': ['toxtricity'],
  'toxtricity-low-key-gmax': ['toxtricity-low-key'],
  'urshifu-single-strike-gmax': ['urshifu'],
  'urshifu-rapid-strike-gmax': ['urshifu-rapid-strike'],
  'zygarde-complete': ['zygarde'],
})

PROFILE_LIST.forEach((option) => {
  const baseSpeciesId = Number(option.parentSpeciesId ?? option.id)
  const relatedOptions = RELATED_PROFILE_OPTIONS_BY_BASE_ID.get(baseSpeciesId) ?? []
  relatedOptions.push(option)
  RELATED_PROFILE_OPTIONS_BY_BASE_ID.set(baseSpeciesId, relatedOptions)
})

export const SPECIES_PROFILES = Object.fromEntries(PROFILE_LIST.map((entry) => [entry.id, entry]))
export const NATIONAL_DEX = pokemonData.species.map((entry) => SPECIES_PROFILES[entry.id])
export const NATIONAL_DEX_COUNT = pokemonData.speciesCount

const EVOLUTION_ROUTE_BY_ID = new Map()

pokemonData.routes.forEach((route) => {
  route.profileIds.forEach((profileId) => EVOLUTION_ROUTE_BY_ID.set(profileId, route))
})

VIRTUAL_FORM_PROFILES.forEach((form) => {
  const route = EVOLUTION_ROUTE_BY_ID.get(Number(form.parentSpeciesId))
  if (route) EVOLUTION_ROUTE_BY_ID.set(form.id, route)
})

export function getSpeciesProfile(speciesId) {
  return SPECIES_PROFILES[speciesId] ?? null
}

export function getCanonicalPokemonFormProfile(speciesOrProfile) {
  const profile = typeof speciesOrProfile === 'object'
    ? speciesOrProfile
    : getSpeciesProfile(speciesOrProfile)
  const canonicalFormSlug = getPokemonFormMetadata(profile).canonicalFormSlug
  return canonicalFormSlug ? PROFILE_BY_SLUG.get(canonicalFormSlug) ?? profile : profile
}

export function getEvolutionOptions(speciesId) {
  const route = EVOLUTION_ROUTE_BY_ID.get(Number(speciesId))
  const speciesIds = route?.speciesIds ?? [Number(speciesId)]
  return speciesIds.map((id) => getSpeciesProfile(id)).filter(Boolean)
}

export function getRelatedFormOptions(speciesId) {
  const profile = getSpeciesProfile(speciesId)
  const baseSpeciesId = Number(profile?.parentSpeciesId ?? profile?.id ?? speciesId)
  return RELATED_PROFILE_OPTIONS_BY_BASE_ID.get(baseSpeciesId) ?? []
}

function normalizePokemonGender(gender) {
  const normalizedGender = String(gender ?? '').trim().toLowerCase()
  if (normalizedGender === 'm' || normalizedGender === 'male' || normalizedGender === '수컷') return 'M'
  if (normalizedGender === 'f' || normalizedGender === 'female' || normalizedGender === '암컷') return 'F'
  return null
}

function getPokemonSpeciesGenderData(speciesOrProfile) {
  const profile = typeof speciesOrProfile === 'object'
    ? speciesOrProfile
    : getSpeciesProfile(speciesOrProfile)
  const baseSpeciesId = Number(profile?.parentSpeciesId ?? profile?.id)
  return pokemonGenderData.species[String(baseSpeciesId)] ?? null
}

export function getPokemonGenderOptions(speciesOrProfile) {
  const profile = typeof speciesOrProfile === 'object'
    ? speciesOrProfile
    : getSpeciesProfile(speciesOrProfile)
  if (!profile) return []

  const metadata = getPokemonFormMetadata(profile)
  const fixedGender = metadata.genderLocked
    ? normalizePokemonGender(metadata.gender ?? profile.gender)
    : null
  if (fixedGender) return [fixedGender]

  const genderRate = Number(getPokemonSpeciesGenderData(profile)?.genderRate)
  if (genderRate === -1) return []
  if (genderRate === 0) return ['M']
  if (genderRate === 8) return ['F']
  if (genderRate >= 1 && genderRate <= 7) return ['M', 'F']

  const profileGender = normalizePokemonGender(profile.gender)
  if (metadata.formKind === 'gender') return ['M', 'F']
  return profileGender ? [profileGender] : []
}

export function resolvePokemonGenderProfile(speciesOrProfile, requestedGender) {
  const profile = typeof speciesOrProfile === 'object'
    ? speciesOrProfile
    : getSpeciesProfile(speciesOrProfile)
  if (!profile) return null

  const genderOptions = getPokemonGenderOptions(profile)
  const normalizedGender = normalizePokemonGender(requestedGender)
  const targetGender = genderOptions.includes(normalizedGender)
    ? normalizedGender
    : genderOptions[0] ?? null
  const metadata = getPokemonFormMetadata(profile)

  if (!targetGender || metadata.genderLocked || genderOptions.length < 2) return profile
  if (normalizePokemonGender(profile.gender) === targetGender) return profile

  if (targetGender === 'M' && metadata.formKind === 'gender') {
    if (profile.sourceSlug) return PROFILE_BY_SLUG.get(profile.sourceSlug) ?? profile
    return getSpeciesProfile(profile.parentSpeciesId) ?? profile
  }

  if (targetGender === 'F') {
    const femaleOptions = getRelatedFormOptions(profile.id).filter((option) => (
      getPokemonFormMetadata(option).formKind === 'gender'
      && normalizePokemonGender(option.gender) === 'F'
    ))
    return femaleOptions.find((option) => option.sourceSlug === profile.slug)
      ?? femaleOptions.find((option) => option.slug === `${profile.slug}-female`)
      ?? femaleOptions.find((option) => option.slug === `${profile.slug}-f`)
      ?? profile
  }

  return profile
}

export function arePokemonGenderCounterparts(firstSpeciesOrProfile, secondSpeciesOrProfile) {
  const firstProfile = typeof firstSpeciesOrProfile === 'object'
    ? firstSpeciesOrProfile
    : getSpeciesProfile(firstSpeciesOrProfile)
  const secondProfile = typeof secondSpeciesOrProfile === 'object'
    ? secondSpeciesOrProfile
    : getSpeciesProfile(secondSpeciesOrProfile)
  if (!firstProfile || !secondProfile || firstProfile.id === secondProfile.id) return false

  const firstBaseSpeciesId = Number(firstProfile.parentSpeciesId ?? firstProfile.id)
  const secondBaseSpeciesId = Number(secondProfile.parentSpeciesId ?? secondProfile.id)
  if (firstBaseSpeciesId !== secondBaseSpeciesId) return false

  const secondGender = normalizePokemonGender(secondProfile.gender)
  return Boolean(
    secondGender
    && resolvePokemonGenderProfile(firstProfile, secondGender)?.id === secondProfile.id,
  )
}

function miniorColorFromSlug(slug) {
  if (slug === 'minior') return 'red'
  return slug?.match(/^minior-(red|orange|yellow|green|blue|indigo|violet)(?:-meteor)?$/)?.[1] ?? null
}

export function isBattleFormCompatible(sourceSpeciesOrProfile, formSpeciesOrProfile) {
  const requestedSource = typeof sourceSpeciesOrProfile === 'object'
    ? sourceSpeciesOrProfile
    : getSpeciesProfile(sourceSpeciesOrProfile)
  const source = getCanonicalPokemonFormProfile(requestedSource)
  const form = typeof formSpeciesOrProfile === 'object'
    ? formSpeciesOrProfile
    : getSpeciesProfile(formSpeciesOrProfile)
  if (!source || !form) return false

  const sourceBaseSpeciesId = Number(source.parentSpeciesId ?? source.id)
  const formBaseSpeciesId = Number(form.parentSpeciesId ?? form.id)
  if (sourceBaseSpeciesId !== formBaseSpeciesId) return false

  const allowedSourceSlugs = BATTLE_FORM_SOURCE_SLUGS[form.slug]
  if (allowedSourceSlugs) return allowedSourceSlugs.includes(source.slug)

  if (form.slug?.startsWith('minior-') && form.slug.endsWith('-meteor')) {
    return miniorColorFromSlug(source.slug) === miniorColorFromSlug(form.slug)
  }

  const sourceMetadata = getPokemonFormMetadata(source)
  const formMetadata = getPokemonFormMetadata(form)
  if (sourceMetadata.formKind === 'regional' && formMetadata.formKind === 'gimmick') return false
  return true
}

export function getPersistentFormOptions(speciesId) {
  return getRelatedFormOptions(speciesId)
    .filter((option) => (
      isSavableFormProfile(option)
      && getPokemonFormMetadata(option).formKind !== 'gender'
      && !getPokemonFormMetadata(option).hiddenFromFormPicker
    ))
}

export function resolveMoveTriggeredFormSpeciesId(speciesId, moveNames = []) {
  const profile = getSpeciesProfile(speciesId)
  if (!profile) return Number(speciesId)
  const selectedMoves = new Set(moveNames)
  const matchingForm = getPersistentFormOptions(speciesId).find((option) => {
    const requiredMove = getPokemonFormMetadata(option).requiredMove
    return requiredMove && selectedMoves.has(requiredMove)
  })

  if (matchingForm) return matchingForm.id
  const currentRequiredMove = getPokemonFormMetadata(profile).requiredMove
  if (currentRequiredMove && !selectedMoves.has(currentRequiredMove)) {
    return Number(profile.parentSpeciesId ?? profile.id)
  }
  return profile.id
}

export function getFormMetadata(speciesOrProfile) {
  const profile = typeof speciesOrProfile === 'object'
    ? speciesOrProfile
    : getSpeciesProfile(speciesOrProfile)
  return getPokemonFormMetadata(profile)
}

export function isSavablePokemonForm(speciesOrProfile) {
  const profile = typeof speciesOrProfile === 'object'
    ? speciesOrProfile
    : getSpeciesProfile(speciesOrProfile)
  return isSavableFormProfile(profile)
}

export function getBattleFormOptions(speciesId) {
  const source = getSpeciesProfile(speciesId)
  return getRelatedFormOptions(speciesId)
    .filter((option) => (
      option?.parentSpeciesId
      && !isSavableFormProfile(option)
      && !getPokemonFormMetadata(option).hiddenFromFormPicker
      && isBattleFormCompatible(source, option)
    ))
}

export function getGigantamaxProfile(speciesId) {
  return getBattleFormOptions(speciesId)
    .find((option) => option.slug?.includes('-gmax')) ?? null
}

export function canGigantamax(speciesId) {
  return Boolean(getGigantamaxProfile(speciesId))
}

export function getEvolutionSpeciesIds(speciesId) {
  const profile = getSpeciesProfile(speciesId)
  const route = EVOLUTION_ROUTE_BY_ID.get(Number(speciesId))
    ?? EVOLUTION_ROUTE_BY_ID.get(profile?.parentSpeciesId)
  return route?.speciesIds ?? [profile?.parentSpeciesId ?? Number(speciesId)]
}

export function getMove(moveName) {
  return MOVE_BY_NAME[moveName] ?? MOVE_CATALOG[0]
}

export function getMoveById(moveId) {
  return MOVE_BY_ID[moveId] ?? null
}

export function resolveMoveForPokemon(move, pokemon) {
  if (!move || move.id !== 'hiddenpower') return move

  const { hiddenPowerType: type } = resolveHiddenPowerConfiguration(pokemon)
  return {
    ...move,
    type,
    typeId: TYPE_CLASS[type],
    description: `개체의 잠재력에 따라 타입이 달라지는 위력 60의 특수 기술이다. 현재 설정은 ${type}타입이다.`,
  }
}

const LEARNABLE_MOVES_BY_PROFILE_ID = new Map()
const SUPPLEMENTAL_LEARNSET_MOVE_IDS = new Map([
  // Deoxys retains Extreme Speed when changing from Speed Forme. PokeAPI
  // lists it only for that forme; Showdown's shared Deoxys learnset has 9L73.
  // Source: pokemon-showdown/data/learnsets.ts, deoxys.extremespeed.
  [386, ['extremespeed']],
  // Jellicent retains Frillish's Gen 8 egg move after evolution. PokeAPI's
  // per-species move lists omit it from Jellicent, including its female form.
  // Source: pokemon-showdown/data/learnsets.ts, frillish.strengthsap (8E).
  [593, ['strengthsap']],
  // Ferrothorn likewise retains Ferroseed's egg move after evolution.
  // Source: pokemon-showdown/data/learnsets.ts, ferroseed.leechseed (5E–8E).
  [598, ['leechseed']],
  // Pokémon Champions promotes Night Slash to a Sirfetch'd machine move.
  // Source: pokemon-showdown/data/mods/champions/learnsets.ts, sirfetchd.nightslash (9M).
  [865, ['nightslash']],
  [10155, ['sunsteelstrike']],
  [10156, ['moongeistbeam']],
])

export function getLearnableMoves(speciesId) {
  const profileId = Number(speciesId)
  if (LEARNABLE_MOVES_BY_PROFILE_ID.has(profileId)) {
    return LEARNABLE_MOVES_BY_PROFILE_ID.get(profileId)
  }

  const species = getSpeciesProfile(profileId)
  if (!species) return []

  if (species.slug === 'smeargle') {
    const sketchableMoves = MOVE_CATALOG.filter((move) => (
      isBattleMoveSupported(move)
      && !move.flags?.includes('nosketch')
      && move.id !== 'struggle'
    ))
    LEARNABLE_MOVES_BY_PROFILE_ID.set(profileId, sketchableMoves)
    return sketchableMoves
  }

  const fallbackSpecies = species.parentSpeciesId
    ? getSpeciesProfile(species.parentSpeciesId)
    : null
  const learnsetMoveIds = species.learnsetMoveIds?.length > 0
    ? species.learnsetMoveIds
    : fallbackSpecies?.learnsetMoveIds ?? []
  const learnableMoves = [
    ...learnsetMoveIds.map((moveNumber) => MOVE_BY_NUMBER[moveNumber]),
    ...(SUPPLEMENTAL_LEARNSET_MOVE_IDS.get(profileId)
      ?? SUPPLEMENTAL_LEARNSET_MOVE_IDS.get(fallbackSpecies?.id)
      ?? []).map((moveId) => MOVE_BY_ID[moveId]),
  ].filter((move, index, moves) => (
    isBattleMoveSupported(move)
      && moves.findIndex((candidate) => candidate?.id === move.id) === index
  ))

  LEARNABLE_MOVES_BY_PROFILE_ID.set(profileId, learnableMoves)
  return learnableMoves
}

export function canPokemonLearnMove(speciesId, moveName) {
  const move = MOVE_BY_NAME[moveName]
  if (!move) return false
  return getLearnableMoves(speciesId).some((learnableMove) => learnableMove.id === move.id)
}

export function getAbility(abilityName) {
  return ABILITY_CATALOG[abilityName] ?? {
    trigger: '배틀 중',
    description: '배틀 중 조건을 만족하면 효과가 발동하는 특성이다.',
  }
}

export function getDefaultMoves(speciesId) {
  const species = getSpeciesProfile(speciesId)
  const learnableMoves = getLearnableMoves(speciesId)
  const learnableMoveNames = new Set(learnableMoves.map((move) => move.name))
  const primaryMoves = TYPE_DEFAULT_MOVES[species?.types[0]] ?? TYPE_DEFAULT_MOVES.노말
  const secondaryMoves = TYPE_DEFAULT_MOVES[species?.types[1]] ?? []
  const preferredMoves = [
    primaryMoves[0],
    primaryMoves[1],
    secondaryMoves[1],
    primaryMoves[2],
    secondaryMoves[2],
    primaryMoves[3],
    '방어',
  ].filter((moveName) => learnableMoveNames.has(moveName))
  const rankedMoves = learnableMoves.slice().sort((firstMove, secondMove) => {
    const scoreMove = (move) => {
      const sameTypeBonus = species?.types.includes(move.type) ? 1000 : 0
      const damagingBonus = move.category === '변화' ? 0 : 300
      const powerScore = Math.max(0, Number(move.power) || 0)
      const accuracyScore = typeof move.accuracy === 'number' ? move.accuracy / 10 : 10
      return sameTypeBonus + damagingBonus + powerScore + accuracyScore
    }

    return scoreMove(secondMove) - scoreMove(firstMove)
      || secondMove.number - firstMove.number
  })

  return [...new Set([
    ...preferredMoves,
    ...rankedMoves.map((move) => move.name),
  ])].slice(0, Math.min(4, learnableMoves.length))
}

function getDefaultTrainingPoints(species) {
  const stats = species.stats
  const offenseKey = stats[1] >= stats[3] ? 'attack' : 'specialAttack'
  const secondaryKey = stats[5] >= 70 ? 'speed' : 'hp'
  const points = Object.fromEntries(STAT_META.map(({ key }) => [key, 0]))

  points[offenseKey] = 32
  points[secondaryKey] = 32
  points.specialDefense = points.specialDefense || 2
  return points
}

export function normalizePokemon(pokemon) {
  const requestedSpecies = getSpeciesProfile(pokemon.speciesId)
  const canonicalSpecies = getCanonicalPokemonFormProfile(requestedSpecies)

  if (!canonicalSpecies) return { ...pokemon, level: BATTLE_LEVEL }

  const genderOptions = getPokemonGenderOptions(canonicalSpecies)
  const requestedGender = normalizePokemonGender(pokemon.gender)
  const profileGender = normalizePokemonGender(canonicalSpecies.gender)
  const gender = genderOptions.includes(requestedGender)
    ? requestedGender
    : genderOptions.includes(profileGender)
    ? profileGender
    : genderOptions[0] ?? null
  const species = resolvePokemonGenderProfile(canonicalSpecies, gender) ?? canonicalSpecies

  const defaultMoves = getDefaultMoves(species.id)
  const learnableMoveNames = new Set(getLearnableMoves(species.id).map((move) => move.name))
  const hasConfiguredMoves = Array.isArray(pokemon.moves)
  const requestedMoves = hasConfiguredMoves ? pokemon.moves : []
  const requestedLearnableMoves = [...new Set(
    requestedMoves.filter((moveName) => learnableMoveNames.has(moveName)),
  )].slice(0, 4)
  const requiredMove = getPokemonFormMetadata(species).requiredMove
  if (requiredMove && !requestedLearnableMoves.includes(requiredMove)) {
    if (requestedLearnableMoves.length < 4) requestedLearnableMoves.push(requiredMove)
    else requestedLearnableMoves[requestedLearnableMoves.length - 1] = requiredMove
  }
  // A compact array is an intentional 1–4-move loadout. Only legacy entries
  // without an array receive the generated full loadout. Damaged/empty saved
  // arrays recover one legal move, rather than creating an unusable Pokemon.
  const moves = hasConfiguredMoves
    ? requestedLearnableMoves.length > 0 ? requestedLearnableMoves : defaultMoves.slice(0, 1)
    : [...new Set([...requestedLearnableMoves, ...defaultMoves])].slice(0, 4)
  const defaultTrainingPoints = getDefaultTrainingPoints(species)
  const trainingPoints = Object.fromEntries(STAT_META.map(({ key }) => [
    key,
    Math.max(0, Math.min(STAT_POINT_PER_STAT, Number(pokemon.trainingPoints?.[key] ?? defaultTrainingPoints[key]))),
  ]))
  let pointOverflow = Object.values(trainingPoints).reduce((total, value) => total + value, 0) - STAT_POINT_TOTAL

  for (let index = STAT_META.length - 1; index >= 0 && pointOverflow > 0; index -= 1) {
    const statKey = STAT_META[index].key
    const reduction = Math.min(trainingPoints[statKey], pointOverflow)
    trainingPoints[statKey] -= reduction
    pointOverflow -= reduction
  }
  const nature = NATURE_OPTIONS.some((option) => option.label === pokemon.nature) ? pokemon.nature : '노력'
  const requestedAbility = pokemon.ability ?? requestedSpecies?.abilities?.[0]
  const ability = species.abilities.includes(requestedAbility) ? requestedAbility : species.abilities[0]
  const teraType = normalizeTeraType(pokemon.teraType, species.types[0])
  const dynamaxMode = normalizeDynamaxMode(pokemon.dynamaxMode, species.id)
  const { hiddenPowerType, hiddenPowerTypeConfigured } = resolveHiddenPowerConfiguration(pokemon)
  const isShiny = Boolean(pokemon.isShiny)
  const shinyObtained = Boolean(pokemon.shinyObtained ?? pokemon.isShiny)
  const spriteFront = isShiny ? species.spriteFrontShiny : species.spriteFront
  const spriteBack = isShiny ? species.spriteBackShiny : species.spriteBack
  const spriteFrontFallback = isShiny ? species.spriteFrontShinyFallback : species.spriteFrontFallback
  const spriteBackFallback = isShiny ? species.spriteBackShinyFallback : species.spriteBackFallback

  return {
    ...pokemon,
    speciesId: species.id,
    dexSpeciesId: Number(pokemon.dexSpeciesId ?? species.parentSpeciesId ?? species.id),
    slug: species.slug,
    name: species.name,
    formName: species.formName ?? species.name,
    isShiny,
    shinyObtained,
    directDrawCount: Math.max(0, Number(pokemon.directDrawCount ?? 0)),
    icon: species.icon,
    iconFallback: species.iconFallback,
    spriteFront,
    spriteBack,
    spriteFrontFallback,
    spriteBackFallback,
    image: spriteFront,
    types: species.types,
    teraType,
    dynamaxMode,
    hiddenPowerType,
    hiddenPowerTypeConfigured,
    ability,
    gender,
    nature,
    moves,
    ...(Array.isArray(pokemon.moveIds) ? { moveIds: moves.map((name) => MOVE_BY_NAME[name].id) } : {}),
    trainingPoints,
    level: BATTLE_LEVEL,
  }
}

export function calculateStats(pokemon) {
  const normalizedPokemon = normalizePokemon(pokemon)
  const species = getSpeciesProfile(normalizedPokemon.speciesId)
  const nature = NATURE_OPTIONS.find((option) => option.label === normalizedPokemon.nature) ?? NATURE_OPTIONS[0]

  if (!species) return []

  return STAT_META.map((stat, index) => {
    const baseStat = species.stats[index]
    const trainingPoint = normalizedPokemon.trainingPoints[stat.key]
    const natureMultiplier = nature.up === stat.key ? 1.1 : nature.down === stat.key ? 0.9 : 1
    const value = stat.key === 'hp'
      ? Number(species.id) === 292 ? 1 : baseStat + trainingPoint + 75
      : Math.floor((baseStat + trainingPoint + 20) * natureMultiplier)

    return {
      ...stat,
      value,
      trainingPoint,
      trend: nature.up === stat.key ? 'up' : nature.down === stat.key ? 'down' : 'neutral',
      ratio: Math.min(1, value / (stat.key === 'hp' ? 300 : 220)),
    }
  })
}

export function randomNature() {
  return NATURE_OPTIONS[Math.floor(Math.random() * NATURE_OPTIONS.length)].label
}
