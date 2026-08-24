export const STRONG_WEATHER_IDS = new Set([
  'desolateland',
  'primordialsea',
  'deltastream',
])

export const WEATHER_FAMILY_BY_ID = Object.freeze({
  desolateland: 'sun',
  primordialsea: 'rain',
})

export const ENTRY_WEATHER_ABILITY_RULES = Object.freeze({
  가뭄: { weatherId: 'sun' },
  끝의대지: { weatherId: 'desolateland', strong: true },
  눈퍼뜨리기: { weatherId: 'snow' },
  델타스트림: { weatherId: 'deltastream', strong: true },
  모래날림: { weatherId: 'sandstorm' },
  시작의바다: { weatherId: 'primordialsea', strong: true },
  잔비: { weatherId: 'rain' },
  진홍빛고동: { weatherId: 'sun' },
})

export const ENTRY_TERRAIN_ABILITY_RULES = Object.freeze({
  그래스메이커: { terrainId: 'grassy' },
  미스트메이커: { terrainId: 'misty' },
  사이코메이커: { terrainId: 'psychic' },
  일렉트릭메이커: { terrainId: 'electric' },
  하드론엔진: { terrainId: 'electric' },
})

export const WEATHER_FORM_RULES = Object.freeze({
  기분파: {
    baseSlug: 'castform',
    forms: {
      rain: 'castform-rainy',
      snow: 'castform-snowy',
      sun: 'castform-sunny',
    },
  },
})

export const TERRAIN_TYPE_BY_ID = Object.freeze({
  electric: '전기',
  grassy: '풀',
  misty: '페어리',
  psychic: '에스퍼',
})

export const HELD_ITEM_TYPE_BY_ID = Object.freeze({
  'bug-memory': '벌레',
  'dark-memory': '악',
  'draco-plate': '드래곤',
  'dragon-memory': '드래곤',
  'dread-plate': '악',
  'earth-plate': '땅',
  'electric-memory': '전기',
  'fairy-memory': '페어리',
  'fighting-memory': '격투',
  'fire-memory': '불꽃',
  'fist-plate': '격투',
  'flame-plate': '불꽃',
  'flying-memory': '비행',
  'ghost-memory': '고스트',
  'grass-memory': '풀',
  'ground-memory': '땅',
  'icicle-plate': '얼음',
  'ice-memory': '얼음',
  'insect-plate': '벌레',
  'iron-plate': '강철',
  'meadow-plate': '풀',
  'mind-plate': '에스퍼',
  'pixie-plate': '페어리',
  'poison-memory': '독',
  'psychic-memory': '에스퍼',
  'rock-memory': '바위',
  'sky-plate': '비행',
  'splash-plate': '물',
  'spooky-plate': '고스트',
  'steel-memory': '강철',
  'stone-plate': '바위',
  'toxic-plate': '독',
  'water-memory': '물',
  'zap-plate': '전기',
  'buginium-z--held': '벌레',
  'darkinium-z--held': '악',
  'dragonium-z--held': '드래곤',
  'electrium-z--held': '전기',
  'fairium-z--held': '페어리',
  'fightinium-z--held': '격투',
  'firium-z--held': '불꽃',
  'flyinium-z--held': '비행',
  'ghostium-z--held': '고스트',
  'grassium-z--held': '풀',
  'groundium-z--held': '땅',
  'icium-z--held': '얼음',
  'normalium-z--held': '노말',
  'poisonium-z--held': '독',
  'psychium-z--held': '에스퍼',
  'rockium-z--held': '바위',
  'steelium-z--held': '강철',
  'waterium-z--held': '물',
})

export const ENTRY_STAT_ABILITY_RULES = Object.freeze({
  불굴의방패: { boosts: { defense: 1 }, oncePerBattle: true },
  불요의검: { boosts: { attack: 1 }, oncePerBattle: true },
})

export const ENTRY_OPPONENT_STAT_ABILITY_RULES = Object.freeze({
  감미로운꿀: { boosts: { evasion: -1 }, oncePerBattle: true },
})

export const HP_CROSSING_ABILITY_RULES = Object.freeze({
  발끈: { boosts: { specialAttack: 1 } },
  분노의껍질: {
    boosts: {
      attack: 1,
      defense: -1,
      specialAttack: 1,
      specialDefense: -1,
      speed: 1,
    },
  },
})

export const LOW_HP_MOVE_ABILITY_TYPES = Object.freeze({
  급류: '물',
  맹화: '불꽃',
  벌레의알림: '벌레',
  심록: '풀',
})

export const KNOCKOUT_STAT_ABILITY_RULES = Object.freeze({
  Eelevate: { highestStat: true },
  백의울음: { boosts: { attack: 1 } },
  비스트부스트: { highestStat: true },
  자기과신: { boosts: { attack: 1 } },
  흑의울음: { boosts: { specialAttack: 1 } },
})

export const FORM_ABILITY_NAMES = new Set([
  '기분파',
  '꼬르륵스위치',
  '그대로꿀꺽미사일',
  '달마모드',
  '리밋실드',
  '마이티체인지',
  '배틀스위치',
  '스웜체인지',
  '아이스페이스',
  '어군',
  '유대변화',
  '제로포밍',
  '테라셸',
  '테라체인지',
  '탈',
  '플라워기프트',
])
