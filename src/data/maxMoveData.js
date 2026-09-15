const STANDARD_MAX_MOVES = {
  노말: {
    id: 'maxstrike',
    name: '다이어택',
    englishName: 'Max Strike',
    effect: { kind: 'stages', side: 'opponents', changes: { speed: -1 } },
    description: '상대 진영의 스피드를 1랭크 떨어뜨린다.',
  },
  불꽃: {
    id: 'maxflare',
    name: '다이번',
    englishName: 'Max Flare',
    effect: { kind: 'weather', id: 'sun' },
    description: '5턴 동안 날씨를 쾌청으로 만든다.',
  },
  물: {
    id: 'maxgeyser',
    name: '다이스트림',
    englishName: 'Max Geyser',
    effect: { kind: 'weather', id: 'rain' },
    description: '5턴 동안 날씨를 비로 만든다.',
  },
  전기: {
    id: 'maxlightning',
    name: '다이썬더',
    englishName: 'Max Lightning',
    effect: { kind: 'terrain', id: 'electric' },
    description: '5턴 동안 일렉트릭필드를 전개한다.',
  },
  풀: {
    id: 'maxovergrowth',
    name: '다이그래스',
    englishName: 'Max Overgrowth',
    effect: { kind: 'terrain', id: 'grassy' },
    description: '5턴 동안 그래스필드를 전개한다.',
  },
  얼음: {
    id: 'maxhailstorm',
    name: '다이아이스',
    englishName: 'Max Hailstorm',
    effect: { kind: 'weather', id: 'snow' },
    description: '5턴 동안 날씨를 설경으로 만든다.',
  },
  격투: {
    id: 'maxknuckle',
    name: '다이너클',
    englishName: 'Max Knuckle',
    effect: { kind: 'stages', side: 'allies', changes: { attack: 1 } },
    description: '아군 진영의 공격을 1랭크 올린다.',
  },
  독: {
    id: 'maxooze',
    name: '다이애시드',
    englishName: 'Max Ooze',
    effect: { kind: 'stages', side: 'allies', changes: { specialAttack: 1 } },
    description: '아군 진영의 특수공격을 1랭크 올린다.',
  },
  땅: {
    id: 'maxquake',
    name: '다이어스',
    englishName: 'Max Quake',
    effect: { kind: 'stages', side: 'allies', changes: { specialDefense: 1 } },
    description: '아군 진영의 특수방어를 1랭크 올린다.',
  },
  비행: {
    id: 'maxairstream',
    name: '다이제트',
    englishName: 'Max Airstream',
    effect: { kind: 'stages', side: 'allies', changes: { speed: 1 } },
    description: '아군 진영의 스피드를 1랭크 올린다.',
  },
  에스퍼: {
    id: 'maxmindstorm',
    name: '다이사이코',
    englishName: 'Max Mindstorm',
    effect: { kind: 'terrain', id: 'psychic' },
    description: '5턴 동안 사이코필드를 전개한다.',
  },
  벌레: {
    id: 'maxflutterby',
    name: '다이웜',
    englishName: 'Max Flutterby',
    effect: { kind: 'stages', side: 'opponents', changes: { specialAttack: -1 } },
    description: '상대 진영의 특수공격을 1랭크 떨어뜨린다.',
  },
  바위: {
    id: 'maxrockfall',
    name: '다이록',
    englishName: 'Max Rockfall',
    effect: { kind: 'weather', id: 'sandstorm' },
    description: '5턴 동안 날씨를 모래바람으로 만든다.',
  },
  고스트: {
    id: 'maxphantasm',
    name: '다이할로우',
    englishName: 'Max Phantasm',
    effect: { kind: 'stages', side: 'opponents', changes: { defense: -1 } },
    description: '상대 진영의 방어를 1랭크 떨어뜨린다.',
  },
  드래곤: {
    id: 'maxwyrmwind',
    name: '다이드라군',
    englishName: 'Max Wyrmwind',
    effect: { kind: 'stages', side: 'opponents', changes: { attack: -1 } },
    description: '상대 진영의 공격을 1랭크 떨어뜨린다.',
  },
  악: {
    id: 'maxdarkness',
    name: '다이아크',
    englishName: 'Max Darkness',
    effect: { kind: 'stages', side: 'opponents', changes: { specialDefense: -1 } },
    description: '상대 진영의 특수방어를 1랭크 떨어뜨린다.',
  },
  강철: {
    id: 'maxsteelspike',
    name: '다이스틸',
    englishName: 'Max Steelspike',
    effect: { kind: 'stages', side: 'allies', changes: { defense: 1 } },
    description: '아군 진영의 방어를 1랭크 올린다.',
  },
  페어리: {
    id: 'maxstarfall',
    name: '다이페어리',
    englishName: 'Max Starfall',
    effect: { kind: 'terrain', id: 'misty' },
    description: '5턴 동안 미스트필드를 전개한다.',
  },
}

const GMAX_MOVES = [
  {
    species: ['urshifu-rapid-strike-gmax', 'urshifu-rapid-strike'],
    type: '물', id: 'gmaxrapidflow', name: '거다이연격', englishName: 'G-Max Rapid Flow',
    bypassProtect: true,
    effect: { kind: 'none' },
    description: '방어와 다이월을 무시하고 공격한다.',
  },
  {
    species: ['urshifu-single-strike-gmax', 'urshifu-single-strike', 'urshifu-gmax', 'urshifu'],
    type: '악', id: 'gmaxoneblow', name: '거다이일격', englishName: 'G-Max One Blow',
    bypassProtect: true,
    effect: { kind: 'none' },
    description: '방어와 다이월을 무시하고 공격한다.',
  },
  {
    species: ['charizard'], type: '불꽃', id: 'gmaxwildfire', name: '거다이옥염', englishName: 'G-Max Wildfire',
    effect: { kind: 'residual', immuneType: '불꽃' },
    description: '4턴 동안 불꽃타입이 아닌 상대에게 매 턴 최대 HP의 1/6 데미지를 준다.',
  },
  {
    species: ['butterfree'], type: '벌레', id: 'gmaxbefuddle', name: '거다이고혹', englishName: 'G-Max Befuddle',
    effect: { kind: 'randomStatus', statuses: ['poison', 'paralysis', 'sleep'] },
    description: '상대 진영을 독, 마비, 잠듦 중 하나의 상태로 만든다.',
  },
  {
    species: ['pikachu'], type: '전기', id: 'gmaxvoltcrash', name: '거다이만뢰', englishName: 'G-Max Volt Crash',
    effect: { kind: 'status', status: 'paralysis', side: 'opponents' },
    description: '상대 진영을 마비 상태로 만든다.',
  },
  {
    species: ['meowth'], type: '노말', id: 'gmaxgoldrush', name: '거다이금화', englishName: 'G-Max Gold Rush',
    effect: { kind: 'volatile', volatileStatus: 'confusion', side: 'opponents' },
    description: '상대 진영을 혼란 상태로 만든다.',
  },
  {
    species: ['machamp'], type: '격투', id: 'gmaxchistrike', name: '거다이회심격', englishName: 'G-Max Chi Strike',
    effect: { kind: 'critical', side: 'allies', amount: 1 },
    description: '아군 진영의 급소율을 1랭크 올린다.',
  },
  {
    species: ['gengar'], type: '고스트', id: 'gmaxterror', name: '거다이환영', englishName: 'G-Max Terror',
    effect: { kind: 'trap', side: 'opponents', duration: 4, damage: false },
    description: '상대 진영을 교체할 수 없게 만든다.',
  },
  {
    species: ['lapras'], type: '얼음', id: 'gmaxresonance', name: '거다이선율', englishName: 'G-Max Resonance',
    effect: { kind: 'auroraVeil', duration: 5 },
    description: '5턴 동안 아군 진영이 받는 물리·특수 데미지를 줄인다.',
  },
  {
    species: ['eevee'], type: '노말', id: 'gmaxcuddle', name: '거다이포옹', englishName: 'G-Max Cuddle',
    effect: { kind: 'infatuation', side: 'opponents' },
    description: '상대 진영을 헤롱헤롱 상태로 만든다.',
  },
  {
    species: ['snorlax'], type: '노말', id: 'gmaxreplenish', name: '거다이재생', englishName: 'G-Max Replenish',
    effect: { kind: 'restoreBerry', side: 'allies', chance: 50 },
    description: '50% 확률로 아군이 사용한 나무열매를 되돌린다.',
  },
  {
    species: ['garbodor'], type: '독', id: 'gmaxmalodor', name: '거다이악취', englishName: 'G-Max Malodor',
    effect: { kind: 'status', status: 'poison', side: 'opponents' },
    description: '상대 진영을 독 상태로 만든다.',
  },
  {
    species: ['drednaw'], type: '물', id: 'gmaxstonesurge', name: '거다이암진', englishName: 'G-Max Stonesurge',
    effect: { kind: 'hazard', hazard: 'stealthRock' },
    description: '상대 진영에 스텔스록을 설치한다.',
  },
  {
    species: ['corviknight'], type: '비행', id: 'gmaxwindrage', name: '거다이풍격', englishName: 'G-Max Wind Rage',
    effect: { kind: 'clearField' },
    description: '필드와 양쪽 진영의 장벽·설치물을 제거한다.',
  },
  {
    species: ['toxtricity'], type: '전기', id: 'gmaxstunshock', name: '거다이감전', englishName: 'G-Max Stun Shock',
    effect: { kind: 'randomStatus', statuses: ['poison', 'paralysis'] },
    description: '상대 진영을 독 또는 마비 상태로 만든다.',
  },
  {
    species: ['alcremie'], type: '페어리', id: 'gmaxfinale', name: '거다이단원', englishName: 'G-Max Finale',
    effect: { kind: 'heal', side: 'allies', fraction: [1, 6] },
    description: '아군 진영의 HP를 최대 HP의 1/6만큼 회복한다.',
  },
  {
    species: ['duraludon'], type: '드래곤', id: 'gmaxdepletion', name: '거다이감쇠', englishName: 'G-Max Depletion',
    effect: { kind: 'lastMovePp', side: 'opponents', amount: 2 },
    description: '상대 진영이 마지막으로 사용한 기술의 PP를 2씩 줄인다.',
  },
  {
    species: ['orbeetle'], type: '에스퍼', id: 'gmaxgravitas', name: '거다이천도', englishName: 'G-Max Gravitas',
    effect: { kind: 'gravity', duration: 5 },
    description: '5턴 동안 중력 상태로 만든다.',
  },
  {
    species: ['coalossal'], type: '바위', id: 'gmaxvolcalith', name: '거다이분석', englishName: 'G-Max Volcalith',
    effect: { kind: 'residual', immuneType: '바위' },
    description: '4턴 동안 바위타입이 아닌 상대에게 매 턴 최대 HP의 1/6 데미지를 준다.',
  },
  {
    species: ['sandaconda'], type: '땅', id: 'gmaxsandblast', name: '거다이사진', englishName: 'G-Max Sandblast',
    effect: { kind: 'trap', duration: 4, damage: true },
    description: '명중한 상대를 가두고 4턴 동안 매 턴 최대 HP의 1/8 데미지를 준다.',
  },
  {
    species: ['grimmsnarl'], type: '악', id: 'gmaxsnooze', name: '거다이수마', englishName: 'G-Max Snooze',
    effect: { kind: 'yawn', side: 'opponents', chance: 50 },
    description: '50% 확률로 상대 진영을 졸음 상태로 만든다.',
  },
  {
    species: ['flapple'], type: '풀', id: 'gmaxtartness', name: '거다이산격', englishName: 'G-Max Tartness',
    effect: { kind: 'stages', side: 'opponents', changes: { evasion: -1 } },
    description: '상대 진영의 회피율을 1랭크 떨어뜨린다.',
  },
  {
    species: ['appletun'], type: '풀', id: 'gmaxsweetness', name: '거다이감로', englishName: 'G-Max Sweetness',
    effect: { kind: 'cureStatus', side: 'allies' },
    description: '아군 진영의 상태 이상을 회복한다.',
  },
  {
    species: ['hatterene'], type: '페어리', id: 'gmaxsmite', name: '거다이천벌', englishName: 'G-Max Smite',
    effect: { kind: 'volatile', volatileStatus: 'confusion', side: 'opponents' },
    description: '상대 진영을 혼란 상태로 만든다.',
  },
  {
    species: ['copperajah'], type: '강철', id: 'gmaxsteelsurge', name: '거다이강철진', englishName: 'G-Max Steelsurge',
    effect: { kind: 'hazard', hazard: 'steelsurge' },
    description: '상대 진영에 강철 타입의 날카로운 설치물을 놓는다.',
  },
  {
    species: ['melmetal'], type: '강철', id: 'gmaxmeltdown', name: '거다이융격', englishName: 'G-Max Meltdown',
    effect: { kind: 'torment', side: 'opponents' },
    description: '상대 진영이 같은 기술을 연속해서 사용할 수 없게 만든다.',
  },
  {
    species: ['kingler'], type: '물', id: 'gmaxfoamburst', name: '거다이포말', englishName: 'G-Max Foam Burst',
    effect: { kind: 'stages', side: 'opponents', changes: { speed: -2 } },
    description: '상대 진영의 스피드를 2랭크 떨어뜨린다.',
  },
  {
    species: ['centiskorch'], type: '불꽃', id: 'gmaxcentiferno', name: '거다이백화', englishName: 'G-Max Centiferno',
    effect: { kind: 'trap', duration: 4, damage: true },
    description: '명중한 상대를 가두고 4턴 동안 매 턴 최대 HP의 1/8 데미지를 준다.',
  },
  {
    species: ['venusaur'], type: '풀', id: 'gmaxvinelash', name: '거다이편달', englishName: 'G-Max Vine Lash',
    effect: { kind: 'residual', immuneType: '풀' },
    description: '4턴 동안 풀타입이 아닌 상대에게 매 턴 최대 HP의 1/6 데미지를 준다.',
  },
  {
    species: ['blastoise'], type: '물', id: 'gmaxcannonade', name: '거다이포격', englishName: 'G-Max Cannonade',
    effect: { kind: 'residual', immuneType: '물' },
    description: '4턴 동안 물타입이 아닌 상대에게 매 턴 최대 HP의 1/6 데미지를 준다.',
  },
  {
    species: ['rillaboom'], type: '풀', id: 'gmaxdrumsolo', name: '거다이난타', englishName: 'G-Max Drum Solo',
    fixedPower: 160,
    ignoreAbility: true,
    effect: { kind: 'none' },
    description: '위력 160으로 공격하며 상대 특성의 방해를 받지 않는다.',
  },
  {
    species: ['cinderace'], type: '불꽃', id: 'gmaxfireball', name: '거다이화염구', englishName: 'G-Max Fireball',
    fixedPower: 160,
    ignoreAbility: true,
    effect: { kind: 'none' },
    description: '위력 160으로 공격하며 상대 특성의 방해를 받지 않는다.',
  },
  {
    species: ['inteleon'], type: '물', id: 'gmaxhydrosnipe', name: '거다이저격', englishName: 'G-Max Hydrosnipe',
    fixedPower: 160,
    ignoreAbility: true,
    effect: { kind: 'none' },
    description: '위력 160으로 공격하며 상대 특성의 방해를 받지 않는다.',
  },
]

const reducedPowerTypes = new Set(['격투', '독'])

function normalizeSpeciesSlug(value = '') {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-')
}

export function getMaxMovePower(move) {
  const basePower = Number(move?.power) || 0
  if (basePower <= 0 || move?.damage != null || move?.ohko) return 100

  if (reducedPowerTypes.has(move.type)) {
    if (basePower >= 150) return 100
    if (basePower >= 110) return 95
    if (basePower >= 75) return 90
    if (basePower >= 65) return 85
    if (basePower >= 55) return 80
    if (basePower >= 45) return 75
    return 70
  }

  if (basePower >= 150) return 150
  if (basePower >= 110) return 140
  if (basePower >= 75) return 130
  if (basePower >= 65) return 120
  if (basePower >= 55) return 110
  if (basePower >= 45) return 100
  return 90
}

export function getGmaxMoveDefinition(speciesSlug, moveType) {
  const normalizedSlug = normalizeSpeciesSlug(speciesSlug)
  return GMAX_MOVES.find((definition) => (
    definition.type === moveType
      && definition.species.some((species) => normalizedSlug.includes(species))
  )) ?? null
}

function maxMoveBase(move, definition, options) {
  const effectDescription = definition.description
  return {
    ...move,
    id: definition.id,
    name: definition.name,
    englishName: definition.englishName,
    power: definition.fixedPower ?? getMaxMovePower(options.powerSourceMove ?? move),
    accuracy: null,
    accuracyLabel: '필중',
    target: 'adjacentFoe',
    moveTarget: 'adjacentFoe',
    generation: 8,
    flags: ['protect'],
    // Max Moves do not inherit the source move's priority.  In particular,
    // a Quick Attack based Max Strike is an ordinary-priority move and must
    // not be stopped by Psychic Terrain's priority protection.
    priority: 0,
    secondary: null,
    secondaries: null,
    status: null,
    volatileStatus: null,
    boosts: null,
    self: null,
    heal: null,
    drain: null,
    recoil: null,
    multihit: null,
    damage: undefined,
    ohko: false,
    selfdestruct: false,
    forceSwitch: false,
    selfSwitch: false,
    willCrit: false,
    critRatio: 0,
    hasCrashDamage: false,
    mindBlownRecoil: false,
    weather: null,
    terrain: null,
    isMaxMove: true,
    isGmaxMove: Boolean(options.isGmax),
    maxMoveEffect: definition.effect,
    bypassesMaxGuard: Boolean(definition.bypassProtect),
    ignoreAbility: Boolean(definition.ignoreAbility),
    baseMoveId: move.id,
    baseMoveName: move.name,
    animationReferenceKey: definition.id,
    description: `${effectDescription} 원 기술: ${move.name}.`,
  }
}

export function resolveMaxMove(move, options = {}) {
  if (!move || move.id === 'struggle') return move

  if (move.categoryId === 'status' || move.category === '변화') {
    return {
      ...move,
      id: 'maxguard',
      name: '다이월',
      englishName: 'Max Guard',
      type: '노말',
      typeId: 'normal',
      category: '변화',
      categoryId: 'status',
      power: 0,
      accuracy: null,
      accuracyLabel: '필중',
      priority: 4,
      target: 'self',
      moveTarget: 'self',
      generation: 8,
      flags: [],
      secondary: null,
      secondaries: null,
      status: null,
      volatileStatus: 'maxguard',
      boosts: null,
      self: null,
      heal: null,
      drain: null,
      recoil: null,
      multihit: null,
      damage: undefined,
      ohko: false,
      selfdestruct: false,
      forceSwitch: false,
      selfSwitch: false,
      weather: null,
      terrain: null,
      isMaxMove: true,
      isGmaxMove: false,
      maxMoveEffect: { kind: 'guard' },
      baseMoveId: move.id,
      baseMoveName: move.name,
      animationReferenceKey: 'maxguard',
      description: `상대의 공격을 막는다. 연속해서 사용하면 실패하기 쉽다. 원 기술: ${move.name}.`,
    }
  }

  const standardDefinition = STANDARD_MAX_MOVES[move.type] ?? STANDARD_MAX_MOVES.노말
  const gmaxDefinition = options.gigantamax
    ? getGmaxMoveDefinition(options.speciesSlug, move.type)
    : null
  return maxMoveBase(move, gmaxDefinition ?? standardDefinition, {
    isGmax: Boolean(gmaxDefinition),
    powerSourceMove: options.powerSourceMove,
  })
}

export { GMAX_MOVES, STANDARD_MAX_MOVES }
