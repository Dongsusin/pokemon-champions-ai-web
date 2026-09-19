import { getRankedFormat } from './rankedRules.js'

export const BATTLE_WEATHERS = [
  { id: 'clear', label: '맑음', shortLabel: '맑음', description: '특별한 날씨 보정이 적용되지 않는 기본 상태입니다.' },
  { id: 'sun', label: '쾌청', shortLabel: '쾌청', description: '불꽃타입 기술은 1.5배, 물타입 기술은 0.5배가 됩니다. 솔라빔과 솔라블레이드는 즉시 발동합니다.' },
  { id: 'rain', label: '비', shortLabel: '비', description: '물타입 기술은 1.5배, 불꽃타입 기술은 0.5배가 됩니다. 번개와 폭풍은 반드시 명중합니다.' },
  { id: 'sandstorm', label: '모래바람', shortLabel: '모래바람', description: '바위타입의 특수방어가 1.5배가 되며, 바위·땅·강철타입 이외의 포켓몬은 매 턴 피해를 입습니다.' },
  { id: 'snow', label: '설경', shortLabel: '눈', description: '얼음타입의 방어가 1.5배가 되며, 눈보라는 반드시 명중합니다.' },
  { id: 'fog', label: '안개', shortLabel: '안개', description: '대부분 기술의 명중률이 크게 낮아집니다.' },
]

export const STRONG_BATTLE_WEATHERS = [
  {
    id: 'desolateland',
    label: '강한 햇살',
    shortLabel: '강한 햇살',
    description: '끝의대지가 만든 강한 햇살입니다. 불꽃타입 기술은 강해지고 공격하는 물타입 기술은 실패하며, 일반 날씨로 덮어쓸 수 없습니다.',
  },
  {
    id: 'primordialsea',
    label: '강한 비',
    shortLabel: '강한 비',
    description: '시작의바다가 만든 강한 비입니다. 물타입 기술은 강해지고 공격하는 불꽃타입 기술은 실패하며, 일반 날씨로 덮어쓸 수 없습니다.',
  },
  {
    id: 'deltastream',
    label: '난기류',
    shortLabel: '난기류',
    description: '델타스트림이 만든 난기류입니다. 비행타입 포켓몬의 약점이 되는 타입 상성을 중화하며, 일반 날씨로 덮어쓸 수 없습니다.',
  },
]

export const BATTLE_WEATHER_DEFINITIONS = [
  ...BATTLE_WEATHERS,
  ...STRONG_BATTLE_WEATHERS,
]

export const BATTLE_TERRAINS = [
  { id: 'neutral', label: '일반 필드', shortLabel: '일반', description: '특별한 필드 보정이 적용되지 않는 기본 상태입니다.' },
  { id: 'grassy', label: '그래스필드', shortLabel: '그래스', description: '땅에 있는 포켓몬의 풀타입 기술이 1.3배가 되고 매 턴 HP를 회복합니다. 일부 땅 기술의 위력은 절반이 됩니다.' },
  { id: 'electric', label: '일렉트릭필드', shortLabel: '일렉트릭', description: '땅에 있는 포켓몬의 전기타입 기술이 1.3배가 되며 잠들지 않습니다.' },
  { id: 'psychic', label: '사이코필드', shortLabel: '사이코', description: '땅에 있는 포켓몬의 에스퍼타입 기술이 1.3배가 되며 상대의 우선도 기술을 받지 않습니다.' },
  { id: 'misty', label: '미스트필드', shortLabel: '미스트', description: '땅에 있는 포켓몬은 상태이상과 혼란에 걸리지 않으며 드래곤타입 기술의 피해를 절반만 받습니다.' },
]

export const BATTLE_FORMATS = [
  { id: 'single', label: '싱글배틀', shortLabel: '싱글', activeSlots: 1, actionSlots: 1, description: '서로 포켓몬 1마리씩 내보내 대전합니다.' },
  { id: 'double', label: '더블배틀', shortLabel: '더블', activeSlots: 2, actionSlots: 2, description: '서로 포켓몬 2마리씩 내보내며, 각 포켓몬의 행동과 대상을 선택합니다.' },
]

export const BATTLE_TEAM_RULES = [
  { id: 'full', label: '6대6', shortLabel: '6대6', battleSize: 6, description: '등록한 포켓몬 6마리를 모두 사용합니다.' },
  { id: 'pick3', label: '3대3', shortLabel: '3대3', battleSize: 3, description: '등록한 포켓몬 6마리 중 대전에 참가할 3마리를 선택합니다.' },
  { id: 'pick4', label: '4대4', shortLabel: '4대4', battleSize: 4, description: '등록한 포켓몬 6마리 중 대전에 참가할 4마리를 선택합니다. 먼저 고른 2마리가 선봉으로 나갑니다.' },
]

export const BATTLE_GIMMICK_RESTRICTIONS = [
  { id: null, label: '제한 없음', shortLabel: '기믹 제한 없음', description: '이번 대전에서는 준비한 모든 배틀 기믹을 사용할 수 있습니다.' },
  { id: 'mega', label: '메가진화 사용 불가', shortLabel: '메가진화 금지', description: '이번 대전에서는 메가진화를 사용할 수 없습니다. 다른 배틀 기믹은 사용할 수 있습니다.' },
  { id: 'zmove', label: 'Z기술 사용 불가', shortLabel: 'Z기술 금지', description: '이번 대전에서는 Z기술을 사용할 수 없습니다. 다른 배틀 기믹은 사용할 수 있습니다.' },
  { id: 'dynamax', label: '다이맥스 사용 불가', shortLabel: '다이맥스 금지', description: '이번 대전에서는 다이맥스와 거다이맥스를 사용할 수 없습니다. 다른 배틀 기믹은 사용할 수 있습니다.' },
  { id: 'tera', label: '테라스탈 사용 불가', shortLabel: '테라스탈 금지', description: '이번 대전에서는 테라스탈을 사용할 수 없습니다. 다른 배틀 기믹은 사용할 수 있습니다.' },
  { id: 'primal', label: '원시회귀 사용 불가', shortLabel: '원시회귀 금지', description: '이번 대전에서는 원시회귀를 사용할 수 없습니다. 다른 배틀 기믹은 사용할 수 있습니다.' },
]

export const AI_BATTLE_DIFFICULTIES = [
  {
    id: 'easy',
    label: '이지',
    shortLabel: 'EASY',
    description: '상대 포켓몬은 지닌 도구 없이 출전하며 모든 배틀 기믹을 사용하지 않습니다.',
  },
  {
    id: 'normal',
    label: '노말',
    shortLabel: 'NORMAL',
    description: '상대 팀과 AI가 현재 설정 그대로 대전합니다.',
  },
  {
    id: 'hard',
    label: '하드',
    shortLabel: 'HARD',
    description: '상대의 모든 포켓몬은 HP와 공격·방어·특수공격·특수방어·스피드가 강화된 상태로 시작합니다. 명중률과 회피율은 변하지 않습니다.',
  },
]

export const HARD_AI_BOOST_STAGES = [1, 2, 3]

export function normalizeAiBattleDifficulty(value = 'normal') {
  const requestedId = typeof value === 'string' ? value : value?.id
  const definition = AI_BATTLE_DIFFICULTIES.find((entry) => entry.id === requestedId)
    ?? AI_BATTLE_DIFFICULTIES.find((entry) => entry.id === 'normal')
  const requestedBoostStage = Number(value?.boostStage)
  const boostStage = definition.id === 'hard'
    ? Math.max(1, Math.min(3, Number.isFinite(requestedBoostStage) ? Math.floor(requestedBoostStage) : 1))
    : 0

  return {
    ...definition,
    boostStage,
    description: definition.id === 'hard'
      ? `상대의 모든 포켓몬은 HP와 공격·방어·특수공격·특수방어·스피드가 ${boostStage}단계 강화된 상태로 시작합니다. 명중률과 회피율은 기술·특성으로만 변합니다.`
      : definition.description,
  }
}

export function getAiBattleDifficultyLabel(value, decisionLevel = null) {
  const difficulty = normalizeAiBattleDifficulty(value)
  if (difficulty.id === 'normal' && decisionLevel === 'hard') return '전술 하드'
  return difficulty.id === 'hard'
    ? `${difficulty.label} · +${difficulty.boostStage}단계`
    : difficulty.label
}

const BATTLE_RULE_COLLECTIONS = {
  weather: BATTLE_WEATHER_DEFINITIONS,
  terrain: BATTLE_TERRAINS,
  format: BATTLE_FORMATS,
  team: BATTLE_TEAM_RULES,
  gimmick: BATTLE_GIMMICK_RESTRICTIONS,
  difficulty: AI_BATTLE_DIFFICULTIES,
}

export function getBattleRuleDescription(kind, rule) {
  if (!rule) return ''
  if (rule.description) return rule.description
  return BATTLE_RULE_COLLECTIONS[kind]?.find((entry) => entry.id === rule.id)?.description ?? ''
}

function stableShuffle(entries, seed) {
  const shuffled = [...entries]
  let value = Math.max(1, Number(seed) || 1) >>> 0
  const nextRandom = () => {
    value += 0x6d2b79f5
    let mixed = value
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1)
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const targetIndex = Math.floor(nextRandom() * (index + 1))
    ;[shuffled[index], shuffled[targetIndex]] = [shuffled[targetIndex], shuffled[index]]
  }
  return shuffled
}

export function createBattleMatchRules(random = Math.random, aiDifficulty = 'normal', formatId = 'single') {
  const registeredFormat = getRankedFormat(formatId) ?? getRankedFormat('single')
  const weather = BATTLE_WEATHERS.find(entry => entry.id === 'clear')
  const terrain = BATTLE_TERRAINS.find(entry => entry.id === 'neutral')
  const format = BATTLE_FORMATS.find(entry => entry.id === registeredFormat.id)
  const teamRule = BATTLE_TEAM_RULES.find(entry => entry.id === `pick${registeredFormat.battleSize}`)
  const gimmickRestriction = {
    ...BATTLE_GIMMICK_RESTRICTIONS[0],
    label: '기믹별 1회',
    shortLabel: '기믹별 1회',
    description: '메가진화·Z기술·다이맥스·테라스탈·원시회귀를 각각 대전당 1회 사용할 수 있습니다.',
  }

  return {
    id: `rules-${Date.now()}-${Math.floor(random() * 1_000_000)}`,
    weather: { ...weather },
    terrain: { ...terrain },
    format: { ...format },
    teamRule: { ...teamRule },
    disabledGimmickId: gimmickRestriction.id,
    gimmickRestriction,
    aiDifficulty: normalizeAiBattleDifficulty(aiDifficulty),
    opponentSelectionSeed: Math.floor(random() * 2_147_483_647),
  }
}

export function getBattleRuleSummary(rules) {
  if (!rules) return []
  return [
    { id: 'environment', label: `${rules.weather.label} · ${rules.terrain.label}` },
    { id: 'format', label: rules.format.label },
    { id: 'gimmick', label: rules.gimmickRestriction.label },
    { id: 'team', label: rules.teamRule.label },
    { id: 'difficulty', label: getAiBattleDifficultyLabel(rules.aiDifficulty) },
  ]
}

export function selectOpponentBattlePokemon(pokemon, rules) {
  if (!rules || rules.teamRule.id === 'full') return [...pokemon]
  const [lead, ...reserves] = pokemon
  return [lead, ...stableShuffle(reserves, rules.opponentSelectionSeed)]
    .filter(Boolean)
    .slice(0, rules.teamRule.battleSize)
}

export function getPlayerBattleSelectionCount(rules, pokemonCount = 0) {
  const rosterSize = Math.max(0, Math.floor(Number(pokemonCount) || 0))
  const battleSize = Math.min(
    rosterSize,
    Math.max(0, Math.floor(Number(rules?.teamRule?.battleSize) || rosterSize)),
  )
  if (rules?.teamRule && rules.teamRule.id !== 'full') return battleSize
  return Math.min(
    battleSize,
    Math.max(1, Math.floor(Number(rules?.format?.activeSlots) || 1)),
  )
}

export function selectPlayerBattlePokemon(pokemon, rules, selectedCaptureIds = []) {
  if (!rules) return [...pokemon]
  const pokemonByCaptureId = new Map(pokemon.map((entry) => [entry.captureId, entry]))
  const selected = [...new Set(selectedCaptureIds)]
    .map((captureId) => pokemonByCaptureId.get(captureId))
    .filter(Boolean)
  const requiredCount = getPlayerBattleSelectionCount(rules, pokemon.length)

  if (rules.teamRule.id === 'full') {
    if (selected.length !== requiredCount) return [...pokemon]
    const selectedIds = new Set(selected.map((entry) => entry.captureId))
    return [...selected, ...pokemon.filter((entry) => !selectedIds.has(entry.captureId))]
  }

  return selected.length === requiredCount ? selected : pokemon.slice(0, rules.teamRule.battleSize)
}
