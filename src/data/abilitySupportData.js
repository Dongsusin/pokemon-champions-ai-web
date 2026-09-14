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
  'burn-drive': '불꽃',
  'bug-memory': '벌레',
  'chill-drive': '얼음',
  'dark-memory': '악',
  'draco-plate': '드래곤',
  'dragon-memory': '드래곤',
  'douse-drive': '물',
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
  'shock-drive': '전기',
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
  'bug-gem': '벌레',
  'dark-gem': '악',
  'dragon-gem': '드래곤',
  'electric-gem': '전기',
  'fairy-gem': '페어리',
  'fighting-gem': '격투',
  'fire-gem': '불꽃',
  'flying-gem': '비행',
  'ghost-gem': '고스트',
  'grass-gem': '풀',
  'ground-gem': '땅',
  'ice-gem': '얼음',
  'normal-gem': '노말',
  'poison-gem': '독',
  'psychic-gem': '에스퍼',
  'rock-gem': '바위',
  'steel-gem': '강철',
  'water-gem': '물',
  'odd-incense': '에스퍼',
  'rock-incense': '바위',
  'rose-incense': '풀',
  'sea-incense': '물',
  'wave-incense': '물',
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
  // Both rider forms share the Korean name, but have different KO boosts.
  혼연일체: { forms: {
    'calyrex-ice': { boosts: { attack: 1 }, activationName: '백의울음' },
    'calyrex-shadow': { boosts: { specialAttack: 1 }, activationName: '흑의울음' },
  } },
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

export const ABILITY_BYPASS_NAMES = new Set([
  '틀깨기',
  '터보블레이즈',
  '테라볼티지',
])

// Showdown's cantsuppress flags differ from Trace and Skill Swap restrictions.
export const ABILITY_SUPPRESSION_IMMUNE_NAMES = new Set([
  'AR시스템', '그대로꿀꺽미사일', '달마모드', '리밋실드', '마이티체인지',
  '멀티타입', '배틀스위치', '스웜체인지', '아이스페이스', '어군',
  '유대변화', '절대안깸', '테라체인지', '탈', '혼연일체',
])

export const MOVE_TYPE_CHANGE_ABILITY_RULES = Object.freeze({
  노말스킨: { targetType: '노말', multiplier: 1.2, allTypes: true },
  드래곤스킨: { sourceType: '노말', targetType: '드래곤', multiplier: 1.2 },
  스카이스킨: { sourceType: '노말', targetType: '비행', multiplier: 1.2 },
  일렉트릭스킨: { sourceType: '노말', targetType: '전기', multiplier: 1.2 },
  페어리스킨: { sourceType: '노말', targetType: '페어리', multiplier: 1.2 },
  프리즈스킨: { sourceType: '노말', targetType: '얼음', multiplier: 1.2 },
  촉촉보이스: { flag: 'sound', targetType: '물', multiplier: 1 },
})

export const MOVE_POWER_ABILITY_RULES = Object.freeze({
  'Fire Mane': { type: '불꽃', multiplier: 1.5 },
  강철술사: { type: '강철', multiplier: 1.5 },
  단단한발톱: { flag: 'contact', multiplier: 1.3 },
  메가런처: { flag: 'pulse', multiplier: 1.5 },
  바위나르기: { type: '바위', multiplier: 1.5 },
  수포: { type: '물', multiplier: 2 },
  예리함: { flag: 'slicing', multiplier: 1.5 },
  옹골찬턱: { flag: 'bite', multiplier: 1.5 },
  용의턱: { type: '드래곤', multiplier: 1.5 },
  철주먹: { flag: 'punch', multiplier: 1.2 },
  테크니션: { maxPower: 60, multiplier: 1.5 },
  트랜지스터: { type: '전기', multiplier: 1.3 },
  펑크록: { flag: 'sound', multiplier: 1.3 },
  이판사판: { recoil: true, multiplier: 1.2 },
})

export const MOVE_DAMAGE_REDUCTION_ABILITY_RULES = Object.freeze({
  파동의방호: { flag: 'contact', multiplier: 0.5 },
})

export const TYPE_IMMUNITY_ABILITY_RULES = Object.freeze({
  Eelevate: { type: '땅' },
  건조피부: { type: '물', heal: [1, 4] },
  노릇노릇바디: { type: '불꽃', boosts: { defense: 2 } },
  마중물: { type: '물', boosts: { specialAttack: 1 } },
  바람타기: { flag: 'wind', boosts: { attack: 1 } },
  방음: { flag: 'sound' },
  방탄: { flag: 'bullet' },
  부유: { type: '땅' },
  저수: { type: '물', heal: [1, 4] },
  전기엔진: { type: '전기', boosts: { speed: 1 } },
  초식: { type: '풀', boosts: { attack: 1 } },
  축전: { type: '전기', heal: [1, 4] },
  타오르는불꽃: { type: '불꽃', volatile: 'flashFireActive' },
  피뢰침: { type: '전기', boosts: { specialAttack: 1 } },
  흙먹기: { type: '땅', heal: [1, 4] },
})

export const FULL_STAT_DROP_IMMUNITY_ABILITIES = new Set([
  '클리어바디',
  '하얀연기',
  '메탈프로텍트',
])

export const INTIMIDATE_IMMUNITY_ABILITIES = new Set([
  '마이페이스',
  '배짱',
  '둔감',
  '파수견',
  '정신력',
])

export const STAT_DROP_REACTION_ABILITY_RULES = Object.freeze({
  오기: { boosts: { attack: 2 } },
  승기: { boosts: { specialAttack: 2 } },
})

export const CRITICAL_HIT_IMMUNITY_ABILITIES = new Set([
  '전투무장',
  '조가비갑옷',
])

export const SUPER_EFFECTIVE_DAMAGE_REDUCTION_ABILITIES = new Set([
  '필터',
  '하드록',
  '프리즘아머',
])

export const DAMAGING_HIT_ABILITY_RULES = Object.freeze({
  꾸덕꾸덕굳기: { type: '물', boosts: { defense: 2 } },
  깨어진갑옷: { category: 'physical', boosts: { defense: -1, speed: 2 } },
  열교환: { type: '불꽃', boosts: { attack: 1 }, breakable: true },
  주눅: { types: ['악', '벌레', '고스트'], boosts: { speed: 1 } },
  정의의마음: { type: '악', boosts: { attack: 1 } },
  증기기관: { types: ['물', '불꽃'], boosts: { speed: 6 } },
  지구력: { boosts: { defense: 1 } },
})

export const CONTACT_HIT_ABILITY_RULES = Object.freeze({
  까칠한피부: { damage: [1, 8] },
  독가시: { chance: 30, status: 'poison' },
  미끈미끈: { boosts: { speed: -1 } },
  불꽃몸: { chance: 30, status: 'burn' },
  정전기: { chance: 30, status: 'paralysis' },
  철가시: { damage: [1, 8] },
  컬리헤어: { boosts: { speed: -1 } },
  헤롱헤롱바디: { chance: 30, volatile: 'infatuation', oppositeGender: true },
  포자: { chance: 30, randomStatuses: ['paralysis', 'poison', 'sleep'] },
})
