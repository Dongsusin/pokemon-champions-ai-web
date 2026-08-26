const VIRTUAL_FORM_ID_START = 20_000

export const FORM_KIND_META = Object.freeze({
  base: { label: '기본', eyebrow: 'BASE FORM' },
  standard: { label: '일반 폼', eyebrow: 'STANDARD FORM' },
  regional: { label: '리전 폼', eyebrow: 'REGIONAL FORM' },
  cosmetic: { label: '외형', eyebrow: 'APPEARANCE' },
  gender: { label: '성별', eyebrow: 'GENDER FORM' },
  ability: { label: '특성', eyebrow: 'ABILITY FORM' },
  move: { label: '기술', eyebrow: 'MOVE FORM' },
  item: { label: '지닌 도구', eyebrow: 'ITEM FORM' },
  battle: { label: '배틀 중', eyebrow: 'BATTLE FORM' },
  gimmick: { label: '배틀 기믹', eyebrow: 'BATTLE GIMMICK' },
})

const TYPE_FORMS = Object.freeze({
  bug: '벌레',
  dark: '악',
  dragon: '드래곤',
  electric: '전기',
  fairy: '페어리',
  fighting: '격투',
  fire: '불꽃',
  flying: '비행',
  ghost: '고스트',
  grass: '풀',
  ground: '땅',
  ice: '얼음',
  poison: '독',
  psychic: '에스퍼',
  rock: '바위',
  steel: '강철',
  water: '물',
})

export const TYPE_FORM_SLUG_BY_KO = Object.freeze(
  Object.fromEntries(Object.entries(TYPE_FORMS).map(([slug, type]) => [type, slug])),
)

const STATIC_ONLY_SPRITES = new Set([
  'eevee-starter-f',
  'floette-blue',
  'floette-orange',
  'floette-white',
  'floette-yellow',
  'florges-blue',
  'florges-orange',
  'florges-white',
  'florges-yellow',
  'furfrou-dandy',
  'furfrou-debutante',
  'furfrou-diamond',
  'furfrou-heart',
  'furfrou-kabuki',
  'furfrou-lareine',
  'furfrou-matron',
  'furfrou-pharaoh',
  'furfrou-star',
  'ogerpon-cornerstonetera',
  'ogerpon-hearthflametera',
  'ogerpon-tealtera',
  'ogerpon-wellspringtera',
  'pichu-spikyeared',
  'poltchageist-artisan',
  'polteageist-antique',
  'sinistcha-masterpiece',
  'sinistea-antique',
  'sneasel-hisui-f',
  'xerneas-neutral',
])

const FRONT_ONLY_ANIMATED_SPRITES = new Set([
  'flabebe-blue',
  'flabebe-orange',
  'flabebe-white',
  'flabebe-yellow',
])

function animationMaskFor(spriteKey) {
  if (STATIC_ONLY_SPRITES.has(spriteKey)) return 0
  if (FRONT_ONLY_ANIMATED_SPRITES.has(spriteKey)) return 5
  return 15
}

function formSeries(parentSpeciesId, entries, defaults = {}) {
  return entries.map(([slug, label, overrides = {}]) => ({
    parentSpeciesId,
    slug,
    label,
    spriteKey: slug,
    formKind: 'cosmetic',
    saveable: true,
    ...defaults,
    ...overrides,
  }))
}

const UNOWN_FORMS = [
  ...'BCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((letter) => [
    `unown-${letter.toLowerCase()}`,
    `${letter} 형태`,
  ]),
  ['unown-exclamation', '! 형태'],
  ['unown-question', '? 형태'],
]

const COSMETIC_FORM_DEFINITIONS = [
  ...formSeries(201, UNOWN_FORMS),
  ...formSeries(412, [
    ['burmy-sandy', '모래땅도롱'],
    ['burmy-trash', '슈레도롱'],
  ]),
  ...formSeries(422, [['shellos-east', '동쪽바다의 모습']]),
  ...formSeries(423, [['gastrodon-east', '동쪽바다의 모습']]),
  ...formSeries(585, [
    ['deerling-summer', '여름의 모습'],
    ['deerling-autumn', '가을의 모습'],
    ['deerling-winter', '겨울의 모습'],
  ]),
  ...formSeries(586, [
    ['sawsbuck-summer', '여름의 모습'],
    ['sawsbuck-autumn', '가을의 모습'],
    ['sawsbuck-winter', '겨울의 모습'],
  ]),
  ...formSeries(666, [
    ['vivillon-archipelago', '군도무늬'],
    ['vivillon-continental', '대륙무늬'],
    ['vivillon-elegant', '우아무늬'],
    ['vivillon-garden', '정원무늬'],
    ['vivillon-highplains', '황야무늬'],
    ['vivillon-icysnow', '설국무늬'],
    ['vivillon-jungle', '정글무늬'],
    ['vivillon-marine', '마린무늬'],
    ['vivillon-modern', '모던무늬'],
    ['vivillon-monsoon', '스콜무늬'],
    ['vivillon-ocean', '대양무늬'],
    ['vivillon-polar', '빙설무늬'],
    ['vivillon-river', '큰강무늬'],
    ['vivillon-sandstorm', '사진무늬'],
    ['vivillon-savanna', '사바나무늬'],
    ['vivillon-sun', '태양무늬'],
    ['vivillon-tundra', '설원무늬'],
    ['vivillon-fancy', '팬시한무늬', { formKind: 'standard' }],
    ['vivillon-pokeball', '볼무늬', { formKind: 'standard' }],
  ]),
  ...formSeries(669, [
    ['flabebe-blue', '파란꽃'],
    ['flabebe-orange', '주황꽃'],
    ['flabebe-white', '하얀꽃'],
    ['flabebe-yellow', '노란꽃'],
  ]),
  ...formSeries(670, [
    ['floette-blue', '파란꽃'],
    ['floette-orange', '주황꽃'],
    ['floette-white', '하얀꽃'],
    ['floette-yellow', '노란꽃'],
  ]),
  ...formSeries(671, [
    ['florges-blue', '파란꽃'],
    ['florges-orange', '주황꽃'],
    ['florges-white', '하얀꽃'],
    ['florges-yellow', '노란꽃'],
  ]),
  ...formSeries(676, [
    ['furfrou-dandy', '젠틀컷'],
    ['furfrou-debutante', '레이디컷'],
    ['furfrou-diamond', '다이아컷'],
    ['furfrou-heart', '하트컷'],
    ['furfrou-kabuki', '가부키컷'],
    ['furfrou-lareine', '퀸컷'],
    ['furfrou-matron', '마담컷'],
    ['furfrou-pharaoh', '킹덤컷'],
    ['furfrou-star', '스타컷'],
  ]),
  ...formSeries(869, [
    ['alcremie-rubycream', '루비믹스'],
    ['alcremie-matchacream', '말차밀키'],
    ['alcremie-mintcream', '민트밀키'],
    ['alcremie-lemoncream', '레몬밀키'],
    ['alcremie-saltedcream', '솔트밀키'],
    ['alcremie-rubyswirl', '루비솔트'],
    ['alcremie-caramelswirl', '캐러멜믹스'],
    ['alcremie-rainbowswirl', '트리플믹스'],
  ]),
]

const FEMALE_SPRITE_SOURCE_SLUGS = `
  abomasnow aipom alakazam ambipom beautifly bibarel bidoof blaziken butterfree
  cacturne camerupt combee combusken croagunk dodrio doduo donphan dustox
  eevee-starter finneon frillish gabite garchomp gible girafarig gligar gloom
  golbat goldeen gulpin gyarados heracross hippopotas hippowdon houndoom hypno
  jellicent kadabra kricketot kricketune ledian ledyba ludicolo lumineon luxio
  luxray magikarp mamoswine medicham meditite meganium milotic murkrow numel
  nuzleaf octillery pachirisu pikachu pikachu-starter piloswine politoed pyroar
  quagsire raichu raticate rattata relicanth rhydon rhyhorn rhyperior roselia
  roserade scizor scyther seaking shiftry shinx sneasel sneasel-hisui snover
  staraptor staravia starly steelix sudowoodo swalot tangrowth toxicroak
  unfezant ursaring venusaur vileplume weavile wobbuffet wooper xatu zubat
`.trim().split(/\s+/)

const EXPLICIT_VIRTUAL_FORMS = [
  {
    parentSpeciesId: 172,
    slug: 'pichu-spiky-eared',
    label: '삐죽귀',
    name: '삐죽귀 피츄',
    spriteKey: 'pichu-spikyeared',
    formKind: 'standard',
    saveable: true,
    gender: 'F',
    abilities: ['정전기'],
    extraLearnsetMoveIds: [220],
    shinyUnavailable: true,
    evolutionLocked: true,
    requirement: '암컷 고정 · 진화 불가',
  },
  {
    parentSpeciesId: 421,
    slug: 'cherrim-sunshine',
    label: '포지폼',
    name: '체리꼬 포지폼',
    spriteKey: 'cherrim-sunshine',
    formKind: 'ability',
    saveable: false,
    requiredAbility: '플라워기프트',
    requirement: '특성 · 쾌청일 때',
  },
  {
    parentSpeciesId: 774,
    sourceSlug: 'minior',
    slug: 'minior-red-meteor',
    label: '빨강 유성의 모습',
    name: '메테노 빨강 유성의 모습',
    spriteKey: 'minior-meteor',
    formKind: 'ability',
    saveable: false,
    requiredAbility: '리밋실드',
    requirement: '특성 · HP가 절반보다 높을 때',
  },
  {
    parentSpeciesId: 716,
    slug: 'xerneas-neutral',
    label: '릴랙스모드',
    name: '제르네아스 릴랙스모드',
    spriteKey: 'xerneas-neutral',
    formKind: 'battle',
    saveable: false,
    requirement: '배틀 밖의 모습',
  },
  {
    parentSpeciesId: 854,
    slug: 'sinistea-antique',
    label: '진품폼',
    name: '데인차 진품폼',
    spriteKey: 'sinistea-antique',
    formKind: 'standard',
    saveable: true,
  },
  {
    parentSpeciesId: 855,
    slug: 'polteageist-antique',
    label: '진품폼',
    name: '포트데스 진품폼',
    spriteKey: 'polteageist-antique',
    formKind: 'standard',
    saveable: true,
  },
  {
    parentSpeciesId: 1012,
    slug: 'poltchageist-artisan',
    label: '진품폼',
    name: '차데스 진품폼',
    spriteKey: 'poltchageist-artisan',
    formKind: 'standard',
    saveable: true,
  },
  {
    parentSpeciesId: 1013,
    slug: 'sinistcha-masterpiece',
    label: '걸작폼',
    name: '그우린차 걸작폼',
    spriteKey: 'sinistcha-masterpiece',
    formKind: 'standard',
    saveable: true,
  },
  ...Object.entries(TYPE_FORMS).flatMap(([typeSlug, type]) => ([
    {
      parentSpeciesId: 493,
      slug: `arceus-${typeSlug}`,
      label: `${type}타입`,
      name: `아르세우스 ${type}타입`,
      spriteKey: `arceus-${typeSlug}`,
      formKind: 'item',
      saveable: false,
      types: [type],
      requiredAbility: '멀티타입',
      requirement: `${type}타입 플레이트 또는 Z크리스탈`,
    },
    {
      parentSpeciesId: 773,
      slug: `silvally-${typeSlug}`,
      label: `${type}타입`,
      name: `실버디 ${type}타입`,
      spriteKey: `silvally-${typeSlug}`,
      formKind: 'item',
      saveable: false,
      types: [type],
      requiredAbility: 'AR시스템',
      requirement: `${type}메모리`,
    },
  ])),
  ...[
    ['burn', '블레이즈카세트'],
    ['chill', '프리즈카세트'],
    ['douse', '아쿠아카세트'],
    ['shock', '번개카세트'],
  ].map(([drive, item]) => ({
    parentSpeciesId: 649,
    slug: `genesect-${drive}`,
    label: item,
    name: `게노세크트 ${item}`,
    spriteKey: `genesect-${drive}`,
    formKind: 'item',
    saveable: false,
    requirement: item,
  })),
  ...[
    ['ogerpon-tealtera', '벽록의가면 테라스탈', 'ogerpon', '스피드'],
    ['ogerpon-wellspringtera', '우물의가면 테라스탈', 'ogerpon-wellspring-mask', '특수방어'],
    ['ogerpon-hearthflametera', '화덕의가면 테라스탈', 'ogerpon-hearthflame-mask', '공격'],
    ['ogerpon-cornerstonetera', '주춧돌의가면 테라스탈', 'ogerpon-cornerstone-mask', '방어'],
  ].map(([spriteKey, label, sourceSlug, boostedStat]) => ({
    parentSpeciesId: 1017,
    sourceSlug,
    slug: spriteKey.replace('tera', '-tera'),
    label,
    name: `오거폰 ${label}`,
    spriteKey,
    formKind: 'gimmick',
    saveable: false,
    abilities: ['초상투영'],
    requirement: `테라스탈 · ${boostedStat} 1랭크 상승`,
  })),
]

const FORM_METADATA_BY_SLUG = Object.freeze({
  'aegislash-blade': { formKind: 'ability', saveable: false, requirement: '특성 · 공격 기술 사용' },
  'castform-sunny': { formKind: 'ability', saveable: false, requirement: '특성 · 쾌청' },
  'castform-rainy': { formKind: 'ability', saveable: false, requirement: '특성 · 비' },
  'castform-snowy': { formKind: 'ability', saveable: false, requirement: '특성 · 설경' },
  'cramorant-gulping': { formKind: 'ability', saveable: false, requirement: '특성 · 파도타기/다이빙' },
  'cramorant-gorging': { formKind: 'ability', saveable: false, requirement: '특성 · HP 절반 이하에서 파도타기/다이빙' },
  'darmanitan-zen': { formKind: 'ability', saveable: false, requirement: '특성 · HP 절반 이하' },
  'darmanitan-galar-zen': { formKind: 'ability', saveable: false, requirement: '특성 · HP 절반 이하' },
  'eiscue-noice': { formKind: 'ability', saveable: false, requirement: '특성 · 아이스페이스 파괴' },
  greninja: { additionalAbilities: ['유대변화'] },
  'greninja-battle-bond': {
    formKind: 'ability',
    saveable: false,
    hiddenFromFormPicker: true,
    canonicalFormSlug: 'greninja',
    requirement: '이전 저장 데이터 · 특성 유대변화',
  },
  'pikachu-rock-star': { formKind: 'standard', saveable: true, gender: 'F', evolutionLocked: true },
  'pikachu-belle': { formKind: 'standard', saveable: true, gender: 'F', evolutionLocked: true },
  'pikachu-pop-star': { formKind: 'standard', saveable: true, gender: 'F', evolutionLocked: true },
  'pikachu-phd': { formKind: 'standard', saveable: true, gender: 'F', evolutionLocked: true },
  'pikachu-libre': { formKind: 'standard', saveable: true, gender: 'F', evolutionLocked: true },
  'pikachu-cosplay': { formKind: 'standard', saveable: true, gender: 'F', evolutionLocked: true },
  'pikachu-original-cap': { formKind: 'standard', saveable: true, gender: 'M', evolutionLocked: true },
  'pikachu-hoenn-cap': { formKind: 'standard', saveable: true, gender: 'M', evolutionLocked: true },
  'pikachu-sinnoh-cap': { formKind: 'standard', saveable: true, gender: 'M', evolutionLocked: true },
  'pikachu-unova-cap': { formKind: 'standard', saveable: true, gender: 'M', evolutionLocked: true },
  'pikachu-kalos-cap': { formKind: 'standard', saveable: true, gender: 'M', evolutionLocked: true },
  'pikachu-alola-cap': { formKind: 'standard', saveable: true, gender: 'M', evolutionLocked: true },
  'pikachu-partner-cap': { formKind: 'standard', saveable: true, gender: 'M', evolutionLocked: true },
  'pikachu-world-cap': { formKind: 'standard', saveable: true, gender: 'M', evolutionLocked: true },
  'pikachu-starter': { formKind: 'standard', saveable: true, evolutionLocked: true },
  'eevee-starter': { formKind: 'standard', saveable: true, evolutionLocked: true },
  'greninja-ash': {
    formKind: 'ability',
    saveable: false,
    requiredAbility: '유대변화',
    requirement: '유대변화 · 직접 공격으로 상대를 쓰러뜨렸을 때',
    name: '지우개굴닌자',
    gender: 'M',
  },
  'keldeo-resolute': {
    formKind: 'move',
    saveable: true,
    requiredMove: '신비의칼',
    requirement: '기술 · 신비의칼',
  },
  'meloetta-pirouette': { formKind: 'move', saveable: false, requirement: '기술 · 옛노래 명중' },
  'mimikyu-busted': { formKind: 'ability', saveable: false, requirement: '특성 · 탈 파괴' },
  'mimikyu-totem-busted': { formKind: 'ability', saveable: false, requirement: '특성 · 탈 파괴' },
  ...Object.fromEntries(
    ['orange', 'yellow', 'green', 'blue', 'indigo', 'violet'].map((color) => [
      `minior-${color}-meteor`,
      {
        formKind: 'ability',
        saveable: false,
        requiredAbility: '리밋실드',
        requirement: '특성 · HP가 절반보다 높을 때',
      },
    ]),
  ),
  'morpeko-hangry': { formKind: 'ability', saveable: false, requirement: '특성 · 턴 종료' },
  'palafin-hero': { formKind: 'ability', saveable: false, requirement: '특성 · 교대 후 재등장' },
  'terapagos-terastal': { formKind: 'ability', saveable: false, requirement: '특성 · 등장 시' },
  'terapagos-stellar': { formKind: 'gimmick', saveable: false, requirement: '테라스탈' },
  'wishiwashi-school': { formKind: 'ability', saveable: false, requirement: '특성 · 레벨 20 이상, HP 25% 초과' },
  zygarde: { additionalAbilities: ['스웜체인지'] },
  'zygarde-10-power-construct': {
    formKind: 'ability',
    saveable: false,
    hiddenFromFormPicker: true,
    canonicalFormSlug: 'zygarde-10',
    requirement: '10%폼 · 특성 스웜체인지',
    name: '지가르데 10%폼 · 스웜체인지',
  },
  'zygarde-50-power-construct': {
    formKind: 'ability',
    saveable: false,
    hiddenFromFormPicker: true,
    canonicalFormSlug: 'zygarde',
    requirement: '50%폼 · 특성 스웜체인지',
    name: '지가르데 50%폼 · 스웜체인지',
  },
  'zygarde-10': {
    formKind: 'standard',
    saveable: true,
    requirement: '10%폼',
    additionalAbilities: ['스웜체인지'],
  },
  'zygarde-complete': { formKind: 'ability', saveable: false, requirement: '스웜체인지 · HP 절반 이하' },
  'floette-eternal': {
    formKind: 'standard',
    saveable: true,
    requirement: '영원의꽃',
    name: '플라엣테 영원의꽃',
    evolutionLocked: true,
  },
  'koraidon-limited-build': {
    formKind: 'cosmetic',
    saveable: false,
    hiddenFromFormPicker: true,
    canonicalFormSlug: 'koraidon',
    label: '제한형태',
    name: '코라이돈 제한형태',
    requirement: '라이드 모드 · 배틀 시 완전체로 전환',
  },
  'koraidon-sprinting-build': {
    formKind: 'cosmetic',
    saveable: false,
    hiddenFromFormPicker: true,
    canonicalFormSlug: 'koraidon',
    label: '질주형태',
    name: '코라이돈 질주형태',
    requirement: '라이드 모드 · 배틀 시 완전체로 전환',
  },
  'koraidon-swimming-build': {
    formKind: 'cosmetic',
    saveable: false,
    hiddenFromFormPicker: true,
    canonicalFormSlug: 'koraidon',
    label: '유영형태',
    name: '코라이돈 유영형태',
    requirement: '라이드 모드 · 배틀 시 완전체로 전환',
  },
  'koraidon-gliding-build': {
    formKind: 'cosmetic',
    saveable: false,
    hiddenFromFormPicker: true,
    canonicalFormSlug: 'koraidon',
    label: '활공형태',
    name: '코라이돈 활공형태',
    requirement: '라이드 모드 · 배틀 시 완전체로 전환',
  },
  'miraidon-low-power-mode': {
    formKind: 'cosmetic',
    saveable: false,
    hiddenFromFormPicker: true,
    canonicalFormSlug: 'miraidon',
    label: '저전력모드',
    name: '미라이돈 저전력모드',
    requirement: '라이드 모드 · 배틀 시 컴플리트모드로 전환',
  },
  'miraidon-drive-mode': {
    formKind: 'cosmetic',
    saveable: false,
    hiddenFromFormPicker: true,
    canonicalFormSlug: 'miraidon',
    label: '드라이브모드',
    name: '미라이돈 드라이브모드',
    requirement: '라이드 모드 · 배틀 시 컴플리트모드로 전환',
  },
  'miraidon-aquatic-mode': {
    formKind: 'cosmetic',
    saveable: false,
    hiddenFromFormPicker: true,
    canonicalFormSlug: 'miraidon',
    label: '플로트모드',
    name: '미라이돈 플로트모드',
    requirement: '라이드 모드 · 배틀 시 컴플리트모드로 전환',
  },
  'miraidon-glide-mode': {
    formKind: 'cosmetic',
    saveable: false,
    hiddenFromFormPicker: true,
    canonicalFormSlug: 'miraidon',
    label: '글라이드모드',
    name: '미라이돈 글라이드모드',
    requirement: '라이드 모드 · 배틀 시 컴플리트모드로 전환',
  },
  'giratina-origin': { formKind: 'item', saveable: false, requirement: '큰백금옥' },
  'dialga-origin': { formKind: 'item', saveable: false, requirement: '큰금강옥' },
  'palkia-origin': { formKind: 'item', saveable: false, requirement: '큰백옥' },
  'zacian-crowned': { formKind: 'item', saveable: false, requirement: '녹슨검' },
  'zamazenta-crowned': { formKind: 'item', saveable: false, requirement: '녹슨방패' },
  'ogerpon-wellspring-mask': { formKind: 'item', saveable: false, requirement: '우물의가면' },
  'ogerpon-hearthflame-mask': { formKind: 'item', saveable: false, requirement: '화덕의가면' },
  'ogerpon-cornerstone-mask': { formKind: 'item', saveable: false, requirement: '주춧돌의가면' },
})

const BATTLE_ONLY_SLUGS = new Set([
  'eternatus-eternamax',
  'necrozma-ultra',
])

const GENDER_FORM_SLUG_PATTERN = /(?:-female|-f)$/
const FEMALE_FORM_SLUG_PATTERN = /(?:^|-)(?:female|f)(?:-|$)/
const MALE_FORM_SLUG_PATTERN = /(?:^|-)(?:male|m)(?:-|$)/
const REGIONAL_FORM_SLUG_PATTERN = /-(?:alola|galar|hisui|paldea)(?:-|$)/
const GIMMICK_FORM_SLUG_PATTERN = /(?:-mega(?:-x|-y|x|y)?|-gmax|-primal)$/
const DEFAULT_MALE_FORM_SPECIES = new Set(['basculegion', 'indeedee', 'meowstic', 'oinkologne'])

export function getPokemonFormMetadata(profile) {
  if (!profile) return { ...FORM_KIND_META.base, formKind: 'base', saveable: true, requirement: '' }

  const explicit = profile.formMetadata ?? FORM_METADATA_BY_SLUG[profile.slug]
  let formKind = explicit?.formKind ?? profile.formKind
  let saveable = explicit?.saveable ?? profile.saveable
  let requirement = explicit?.requirement ?? profile.requirement ?? ''

  if (!profile.parentSpeciesId && !formKind) formKind = 'base'
  if (!formKind && GIMMICK_FORM_SLUG_PATTERN.test(profile.slug)) formKind = 'gimmick'
  if (!formKind && BATTLE_ONLY_SLUGS.has(profile.slug)) formKind = 'battle'
  if (!formKind && /(?:-busted|-meteor)$/.test(profile.slug)) formKind = 'ability'
  if (!formKind && GENDER_FORM_SLUG_PATTERN.test(profile.slug)) formKind = 'gender'
  if (!formKind && REGIONAL_FORM_SLUG_PATTERN.test(profile.slug)) formKind = 'regional'
  if (!formKind) formKind = profile.parentSpeciesId ? 'standard' : 'base'

  if (saveable == null) {
    saveable = !['ability', 'battle', 'gimmick', 'item'].includes(formKind)
      || Boolean(explicit?.saveable)
  }
  if (BATTLE_ONLY_SLUGS.has(profile.slug) || GIMMICK_FORM_SLUG_PATTERN.test(profile.slug)) {
    saveable = false
  }

  const kindMeta = FORM_KIND_META[formKind] ?? FORM_KIND_META.standard
  return {
    ...kindMeta,
    ...explicit,
    formKind,
    saveable,
    requirement,
    hiddenFromFormPicker: Boolean(explicit?.hiddenFromFormPicker ?? profile.hiddenFromFormPicker),
    requiredAbility: explicit?.requiredAbility ?? profile.requiredAbility,
    requiredMove: explicit?.requiredMove ?? profile.requiredMove,
    evolutionLocked: Boolean(explicit?.evolutionLocked ?? profile.evolutionLocked),
  }
}

export function isSavablePokemonForm(profile) {
  return Boolean(profile && getPokemonFormMetadata(profile).saveable)
}

export function defaultGenderForProfile(profile) {
  if (!profile) return null
  if (profile.gender) return profile.gender
  const explicitGender = FORM_METADATA_BY_SLUG[profile.slug]?.gender
  if (explicitGender) return explicitGender
  if (FEMALE_FORM_SLUG_PATTERN.test(profile.slug)) return 'F'
  if (MALE_FORM_SLUG_PATTERN.test(profile.slug)) return 'M'
  if (profile.slug === 'nidoran-f') return 'F'
  if (profile.slug === 'nidoran-m') return 'M'
  if (DEFAULT_MALE_FORM_SPECIES.has(profile.slug)) return 'M'
  if (FEMALE_SPRITE_SOURCE_SLUGS.includes(profile.slug)) return 'M'
  return null
}

export function decorateGeneratedPokemonProfile(entry) {
  const metadata = getPokemonFormMetadata(entry)
  const explicit = FORM_METADATA_BY_SLUG[entry.slug] ?? {}
  return {
    ...entry,
    name: explicit.name ?? entry.name,
    abilities: [...new Set([...(entry.abilities ?? []), ...(explicit.additionalAbilities ?? [])])],
    gender: explicit.gender ?? defaultGenderForProfile(entry),
    formMetadata: metadata,
  }
}

export function createVirtualPokemonFormProfiles(generatedProfiles) {
  const profileBySlug = new Map(generatedProfiles.map((profile) => [profile.slug, profile]))
  const profileById = new Map(generatedProfiles.map((profile) => [Number(profile.id), profile]))
  const definitions = [
    ...COSMETIC_FORM_DEFINITIONS,
    ...FEMALE_SPRITE_SOURCE_SLUGS.map((sourceSlug) => ({
      sourceSlug,
      slug: `${sourceSlug}-f`,
      label: '암컷',
      spriteKey: `${sourceSlug}-f`,
      formKind: 'gender',
      saveable: true,
      hiddenFromFormPicker: true,
      gender: 'F',
    })),
    ...EXPLICIT_VIRTUAL_FORMS,
  ]

  return definitions.flatMap((definition, index) => {
    if (profileBySlug.has(definition.slug)) return []
    const source = profileBySlug.get(definition.sourceSlug)
      ?? profileById.get(Number(definition.parentSpeciesId))
    if (!source) return []

    const parentSpeciesId = Number(definition.parentSpeciesId ?? source.parentSpeciesId ?? source.id)
    const learnsetMoveIds = [...new Set([
      ...(source.learnsetMoveIds ?? []),
      ...(definition.extraLearnsetMoveIds ?? []),
    ])].sort((left, right) => left - right)
    const formMetadata = getPokemonFormMetadata({
      ...definition,
      parentSpeciesId,
    })

    return [{
      ...source,
      ...definition,
      id: VIRTUAL_FORM_ID_START + index,
      parentSpeciesId,
      name: definition.name ?? `${source.name} ${definition.label}`,
      animationMask: definition.animationMask ?? animationMaskFor(definition.spriteKey),
      learnsetMoveIds,
      formMetadata,
    }]
  })
}

export const VIRTUAL_FORM_SOURCE = Object.freeze({
  metadata: 'Pokémon Showdown data/pokedex.ts',
  sprites: 'Pokémon Showdown gen5 sprite directories',
})
