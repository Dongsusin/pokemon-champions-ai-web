export const BATTLE_WEATHERS = [
  { id: 'clear', label: '맑음', shortLabel: '맑음' },
  { id: 'sun', label: '쾌청', shortLabel: '쾌청' },
  { id: 'rain', label: '비', shortLabel: '비' },
  { id: 'sandstorm', label: '모래바람', shortLabel: '모래바람' },
  { id: 'snow', label: '설경', shortLabel: '눈' },
  { id: 'fog', label: '안개', shortLabel: '안개' },
]

export const BATTLE_TERRAINS = [
  { id: 'neutral', label: '일반 필드', shortLabel: '일반' },
  { id: 'grassy', label: '그래스필드', shortLabel: '그래스' },
  { id: 'electric', label: '일렉트릭필드', shortLabel: '일렉트릭' },
  { id: 'psychic', label: '사이코필드', shortLabel: '사이코' },
  { id: 'misty', label: '미스트필드', shortLabel: '미스트' },
]

export const BATTLE_FORMATS = [
  { id: 'single', label: '싱글배틀', shortLabel: '싱글', activeSlots: 1, actionSlots: 1 },
  { id: 'double', label: '더블배틀', shortLabel: '더블', activeSlots: 2, actionSlots: 2 },
  { id: 'triple', label: '트리플배틀', shortLabel: '트리플', activeSlots: 3, actionSlots: 3 },
  { id: 'rotation', label: '로테이션배틀', shortLabel: '로테이션', activeSlots: 3, actionSlots: 1, rotation: true },
  { id: 'inverse', label: '거꾸로배틀', shortLabel: '거꾸로', activeSlots: 1, actionSlots: 1, inverse: true },
]

export const BATTLE_TEAM_RULES = [
  { id: 'full', label: '6마리 전원전', shortLabel: '6 VS 6', battleSize: 6 },
  { id: 'pick3', label: '6마리 중 3마리 선출', shortLabel: '6→3', battleSize: 3 },
]

export const BATTLE_GIMMICK_RESTRICTIONS = [
  { id: null, label: '제한 없음', shortLabel: '기믹 제한 없음' },
  { id: 'mega', label: '메가진화 사용 불가', shortLabel: '메가진화 금지' },
  { id: 'zmove', label: 'Z기술 사용 불가', shortLabel: 'Z기술 금지' },
  { id: 'dynamax', label: '다이맥스 사용 불가', shortLabel: '다이맥스 금지' },
  { id: 'tera', label: '테라스탈 사용 불가', shortLabel: '테라스탈 금지' },
  { id: 'primal', label: '원시회귀 사용 불가', shortLabel: '원시회귀 금지' },
]

function randomEntry(entries, random) {
  return entries[Math.floor(random() * entries.length)]
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

export function createBattleMatchRules(random = Math.random) {
  const weather = randomEntry(BATTLE_WEATHERS, random)
  const terrain = randomEntry(BATTLE_TERRAINS, random)
  const format = randomEntry(BATTLE_FORMATS, random)
  const teamRule = randomEntry(BATTLE_TEAM_RULES, random)
  const gimmickRestriction = randomEntry(BATTLE_GIMMICK_RESTRICTIONS, random)

  return {
    id: `rules-${Date.now()}-${Math.floor(random() * 1_000_000)}`,
    weather,
    terrain,
    format,
    teamRule,
    disabledGimmickId: gimmickRestriction.id,
    gimmickRestriction,
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
  ]
}

export function selectOpponentBattlePokemon(pokemon, rules) {
  if (!rules || rules.teamRule.id === 'full') return [...pokemon]
  const [lead, ...reserves] = pokemon
  return [lead, ...stableShuffle(reserves, rules.opponentSelectionSeed)]
    .filter(Boolean)
    .slice(0, rules.teamRule.battleSize)
}

export function selectPlayerBattlePokemon(pokemon, rules, selectedCaptureIds = []) {
  if (!rules || rules.teamRule.id === 'full') return [...pokemon]
  const pokemonByCaptureId = new Map(pokemon.map((entry) => [entry.captureId, entry]))
  const selected = selectedCaptureIds.map((captureId) => pokemonByCaptureId.get(captureId)).filter(Boolean)
  return selected.length === rules.teamRule.battleSize ? selected : pokemon.slice(0, rules.teamRule.battleSize)
}
