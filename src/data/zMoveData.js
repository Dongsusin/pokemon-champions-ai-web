const TYPE_LABELS = {
  normal: '노말',
  fire: '불꽃',
  water: '물',
  electric: '전기',
  grass: '풀',
  ice: '얼음',
  fighting: '격투',
  poison: '독',
  ground: '땅',
  flying: '비행',
  psychic: '에스퍼',
  bug: '벌레',
  rock: '바위',
  ghost: '고스트',
  dragon: '드래곤',
  dark: '악',
  steel: '강철',
  fairy: '페어리',
}

const TYPE_IDS = Object.fromEntries(Object.entries(TYPE_LABELS).map(([typeId, label]) => [label, typeId]))

const CATEGORY_LABELS = {
  physical: '물리',
  special: '특수',
  status: '변화',
}

const STANDARD_Z_MOVES = {
  normal: { crystalId: 'normaliumz', id: 'breakneckblitz', name: '울트라대시어택', englishName: 'Breakneck Blitz' },
  fire: { crystalId: 'firiumz', id: 'infernooverdrive', name: '다이내믹풀플레임', englishName: 'Inferno Overdrive' },
  water: { crystalId: 'wateriumz', id: 'hydrovortex', name: '슈퍼아쿠아토네이도', englishName: 'Hydro Vortex' },
  electric: { crystalId: 'electriumz', id: 'gigavolthavoc', name: '스파킹기가볼트', englishName: 'Gigavolt Havoc' },
  grass: { crystalId: 'grassiumz', id: 'bloomdoom', name: '블룸샤인엑스트라', englishName: 'Bloom Doom' },
  ice: { crystalId: 'iciumz', id: 'subzeroslammer', name: '레이징지오프리즈', englishName: 'Subzero Slammer' },
  fighting: { crystalId: 'fightiniumz', id: 'alloutpummeling', name: '전력무쌍격렬권', englishName: 'All-Out Pummeling' },
  poison: { crystalId: 'poisoniumz', id: 'aciddownpour', name: '애시드포이즌딜리트', englishName: 'Acid Downpour' },
  ground: { crystalId: 'groundiumz', id: 'tectonicrage', name: '라이징랜드오버', englishName: 'Tectonic Rage' },
  flying: { crystalId: 'flyiniumz', id: 'supersonicskystrike', name: '파이널다이브클래시', englishName: 'Supersonic Skystrike' },
  psychic: { crystalId: 'psychiumz', id: 'shatteredpsyche', name: '맥시멈사이브레이커', englishName: 'Shattered Psyche' },
  bug: { crystalId: 'buginiumz', id: 'savagespinout', name: '절대포식회전참', englishName: 'Savage Spin-Out' },
  rock: { crystalId: 'rockiumz', id: 'continentalcrush', name: '월즈엔드폴', englishName: 'Continental Crush' },
  ghost: { crystalId: 'ghostiumz', id: 'neverendingnightmare', name: '무한암야로의유인', englishName: 'Never-Ending Nightmare' },
  dragon: { crystalId: 'dragoniumz', id: 'devastatingdrake', name: '얼티메이트드래곤번', englishName: 'Devastating Drake' },
  dark: { crystalId: 'darkiniumz', id: 'blackholeeclipse', name: '블랙홀이클립스', englishName: 'Black Hole Eclipse' },
  steel: { crystalId: 'steeliumz', id: 'corkscrewcrash', name: '초월나선연격', englishName: 'Corkscrew Crash' },
  fairy: { crystalId: 'fairiumz', id: 'twinkletackle', name: '러블리스타임팩트', englishName: 'Twinkle Tackle' },
}

const SIGNATURE_Z_MOVES = {
  aloraichiumz: {
    species: ['raichu-alola'], baseMoveId: 'thunderbolt',
    id: 'stokedsparksurfer', name: '라이트닝서프라이드', englishName: 'Stoked Sparksurfer',
    typeId: 'electric', categoryId: 'special', power: 175,
    secondary: { chance: 100, status: 'par' },
    description: '상대를 공격하고 반드시 마비 상태로 만든다.',
  },
  decidiumz: {
    species: ['decidueye'], baseMoveId: 'spiritshackle',
    id: 'sinisterarrowraid', name: '섀도애로우즈스트라이크', englishName: 'Sinister Arrow Raid',
    typeId: 'ghost', categoryId: 'physical', power: 180,
  },
  eeviumz: {
    species: ['eevee'], baseMoveId: 'lastresort',
    id: 'extremeevoboost', name: '나인이볼부스트', englishName: 'Extreme Evoboost',
    typeId: 'normal', categoryId: 'status', power: 0, target: 'self', flags: [],
    boosts: { atk: 2, def: 2, spa: 2, spd: 2, spe: 2 },
    description: '공격, 방어, 특수공격, 특수방어, 스피드를 각각 2랭크 올린다.',
  },
  inciniumz: {
    species: ['incineroar'], baseMoveId: 'darkestlariat',
    id: 'maliciousmoonsault', name: '하이퍼다크크러셔', englishName: 'Malicious Moonsault',
    typeId: 'dark', categoryId: 'physical', power: 180, flags: ['contact', 'protect'],
  },
  kommoniumz: {
    species: ['kommo-o', 'kommo-o-totem'], baseMoveId: 'clangingscales',
    id: 'clangoroussoulblaze', name: '브레이징소울비트', englishName: 'Clangorous Soulblaze',
    typeId: 'dragon', categoryId: 'special', power: 185, target: 'allAdjacentFoes', flags: ['sound', 'bypasssub', 'protect'],
    secondary: { chance: 100, self: { boosts: { atk: 1, def: 1, spa: 1, spd: 1, spe: 1 } } },
    description: '상대 진영을 공격하고 자신의 모든 능력을 1랭크 올린다.',
  },
  lunaliumz: {
    species: ['lunala', 'necrozma-dawn'], baseMoveId: 'moongeistbeam',
    id: 'menacingmoonrazemaelstrom', name: '문라이트블래스터', englishName: 'Menacing Moonraze Maelstrom',
    typeId: 'ghost', categoryId: 'special', power: 200, ignoreAbility: true,
    description: '상대의 특성을 무시하고 공격한다.',
  },
  lycaniumz: {
    species: ['lycanroc', 'lycanroc-midnight', 'lycanroc-dusk'], baseMoveId: 'stoneedge',
    id: 'splinteredstormshards', name: '레이디얼에지스톰', englishName: 'Splintered Stormshards',
    typeId: 'rock', categoryId: 'physical', power: 190, zMoveEffect: { kind: 'clearTerrain' },
    description: '공격이 성공하면 현재 필드를 제거한다.',
  },
  marshadiumz: {
    species: ['marshadow'], baseMoveId: 'spectralthief',
    id: 'soulstealing7starstrike', name: '칠성탈혼퇴', englishName: 'Soul-Stealing 7-Star Strike',
    typeId: 'ghost', categoryId: 'physical', power: 195, flags: ['contact', 'protect'],
  },
  mewniumz: {
    species: ['mew'], baseMoveId: 'psychic',
    id: 'genesissupernova', name: '오리진즈슈퍼노바', englishName: 'Genesis Supernova',
    typeId: 'psychic', categoryId: 'special', power: 185, zMoveEffect: { kind: 'terrain', id: 'psychic' },
    description: '공격이 성공하면 사이코필드를 전개한다.',
  },
  mimikiumz: {
    species: ['mimikyu', 'mimikyu-busted', 'mimikyu-totem-disguised', 'mimikyu-totem-busted'], baseMoveId: 'playrough',
    id: 'letssnuggleforever', name: '투닥투닥프렌드타임', englishName: "Let's Snuggle Forever",
    typeId: 'fairy', categoryId: 'physical', power: 190, flags: ['contact', 'protect'],
  },
  pikaniumz: {
    species: ['pikachu'], baseMoveId: 'volttackle',
    id: 'catastropika', name: '필살피카슛', englishName: 'Catastropika',
    typeId: 'electric', categoryId: 'physical', power: 210, flags: ['contact', 'protect'],
  },
  pikashuniumz: {
    species: [
      'pikachu-original-cap', 'pikachu-hoenn-cap', 'pikachu-sinnoh-cap', 'pikachu-unova-cap',
      'pikachu-kalos-cap', 'pikachu-alola-cap', 'pikachu-partner-cap',
    ],
    baseMoveId: 'thunderbolt',
    id: '10000000voltthunderbolt', name: '1000만볼트', englishName: '10,000,000 Volt Thunderbolt',
    typeId: 'electric', categoryId: 'special', power: 195, critRatio: 3,
    description: '급소에 맞을 확률이 매우 높다.',
  },
  primariumz: {
    species: ['primarina'], baseMoveId: 'sparklingaria',
    id: 'oceanicoperetta', name: '바다의심포니', englishName: 'Oceanic Operetta',
    typeId: 'water', categoryId: 'special', power: 195,
  },
  snorliumz: {
    species: ['snorlax'], baseMoveId: 'gigaimpact',
    id: 'pulverizingpancake', name: '진심의공격', englishName: 'Pulverizing Pancake',
    typeId: 'normal', categoryId: 'physical', power: 210, flags: ['contact', 'protect'],
  },
  solganiumz: {
    species: ['solgaleo', 'necrozma-dusk'], baseMoveId: 'sunsteelstrike',
    id: 'searingsunrazesmash', name: '선샤인스매셔', englishName: 'Searing Sunraze Smash',
    typeId: 'steel', categoryId: 'physical', power: 200, flags: ['contact', 'protect'], ignoreAbility: true,
    description: '상대의 특성을 무시하고 공격한다.',
  },
  tapuniumz: {
    species: ['tapu-koko', 'tapu-lele', 'tapu-bulu', 'tapu-fini'], baseMoveId: 'naturesmadness',
    id: 'guardianofalola', name: '알로라의수호자', englishName: 'Guardian of Alola',
    typeId: 'fairy', categoryId: 'special', power: 0, currentHpFraction: [3, 4],
    description: '상대의 현재 HP 중 3/4만큼 데미지를 준다.',
  },
  ultranecroziumz: {
    species: ['necrozma-ultra'], baseMoveId: 'photongeyser',
    id: 'lightthatburnsthesky', name: '하늘을태우는멸망의빛', englishName: 'Light That Burns the Sky',
    typeId: 'psychic', categoryId: 'special', power: 200, ignoreAbility: true, adaptiveOffense: true,
    description: '공격과 특수공격 중 더 높은 능력으로 공격하며 상대의 특성을 무시한다.',
  },
}

function normalizeId(value = '') {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function normalizedSpeciesSlug(value = '') {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function moveTypeId(move) {
  return move?.typeId ?? TYPE_IDS[move?.type] ?? ''
}

function isStatusMove(move) {
  return move?.categoryId === 'status' || move?.category === '변화'
}

export function normalizeZCrystalId(heldItemId) {
  return normalizeId(String(heldItemId ?? '').replace(/--held$/i, ''))
}

export function getZMovePower(move) {
  const configuredPower = Number(move?.zMove?.basePower)
  if (configuredPower > 0) return configuredPower

  let basePower = Number(move?.power) || 0
  if (Array.isArray(move?.multihit)) basePower *= 3
  if (basePower >= 140) return 200
  if (basePower >= 130) return 195
  if (basePower >= 120) return 190
  if (basePower >= 110) return 185
  if (basePower >= 100) return 180
  if (basePower >= 90) return 175
  if (basePower >= 80) return 160
  if (basePower >= 70) return 140
  if (basePower >= 60) return 120
  return 100
}

function signatureDefinition(options, sourceMove) {
  const crystalId = normalizeZCrystalId(options.heldItemId)
  const definition = SIGNATURE_Z_MOVES[crystalId]
  if (!definition || normalizeId(sourceMove?.id) !== definition.baseMoveId) return null
  const speciesSlug = normalizedSpeciesSlug(options.speciesSlug)
  return definition.species.includes(speciesSlug) ? definition : null
}

function genericDefinition(options, sourceMove) {
  const sourceTypeId = moveTypeId(sourceMove)
  const definition = STANDARD_Z_MOVES[sourceTypeId]
  return definition?.crystalId === normalizeZCrystalId(options.heldItemId) ? definition : null
}

export function canUseZMove(move, options = {}) {
  if (!move || move.id === 'struggle' || Number(move.currentPp ?? move.pp ?? 1) <= 0) return false
  return Boolean(signatureDefinition(options, move) ?? genericDefinition(options, move))
}

function baseZMove(move, sourceMove, definition) {
  const categoryId = definition.categoryId ?? move.categoryId
  const typeId = definition.typeId ?? moveTypeId(move)
  return {
    ...move,
    id: definition.id,
    name: definition.name,
    englishName: definition.englishName,
    type: TYPE_LABELS[typeId] ?? move.type,
    typeId,
    category: CATEGORY_LABELS[categoryId] ?? move.category,
    categoryId,
    power: Number(definition.power) || 0,
    accuracy: null,
    accuracyLabel: '필중',
    priority: Number(definition.priority ?? move.priority) || 0,
    target: definition.target ?? 'adjacentFoe',
    moveTarget: definition.target ?? 'adjacentFoe',
    generation: 7,
    flags: definition.flags ?? ['protect'],
    secondary: definition.secondary ?? null,
    secondaries: null,
    status: definition.status ?? null,
    volatileStatus: definition.volatileStatus ?? null,
    boosts: definition.boosts ?? null,
    self: definition.self ?? null,
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
    willCrit: false,
    critRatio: Number(definition.critRatio) || 0,
    hasCrashDamage: false,
    mindBlownRecoil: false,
    ignoreAbility: Boolean(definition.ignoreAbility),
    adaptiveOffense: Boolean(definition.adaptiveOffense),
    currentHpFraction: definition.currentHpFraction ?? null,
    zMoveEffect: definition.zMoveEffect ?? null,
    zPower: null,
    isZMove: true,
    zMoveCompatible: true,
    baseMoveId: sourceMove.id,
    baseMoveName: sourceMove.name,
    animationReferenceKey: definition.id,
    description: definition.description ?? `Z파워를 해방한 ${TYPE_LABELS[typeId]}타입 필살기다. 원본 기술: ${sourceMove.name}.`,
  }
}

function resolveStatusZMove(move, sourceMove) {
  const zPower = sourceMove.zMove ?? null
  return {
    ...move,
    name: `Z-${sourceMove.name}`,
    englishName: `Z-${sourceMove.englishName ?? sourceMove.name}`,
    accuracy: null,
    accuracyLabel: '필중',
    isZMove: true,
    zMoveCompatible: true,
    baseMoveId: sourceMove.id,
    baseMoveName: sourceMove.name,
    zPower,
    animationReferenceKey: sourceMove.id,
    description: `Z파워를 해방한 뒤 ${sourceMove.name}의 효과를 사용한다. ${sourceMove.description ?? ''}`.trim(),
  }
}

export function resolveZMove(move, options = {}) {
  if (!move) return null
  const sourceMove = options.sourceMove ?? move
  const signature = signatureDefinition(options, sourceMove)
  if (signature) return baseZMove(move, sourceMove, signature)

  const generic = genericDefinition(options, sourceMove)
  if (!generic) return null
  if (isStatusMove(sourceMove)) return resolveStatusZMove(move, sourceMove)

  const transformedTypeId = moveTypeId(move) || moveTypeId(sourceMove)
  const transformedDefinition = STANDARD_Z_MOVES[transformedTypeId] ?? generic
  return baseZMove(move, sourceMove, {
    ...transformedDefinition,
    categoryId: sourceMove.categoryId,
    power: getZMovePower(sourceMove),
  })
}

export { SIGNATURE_Z_MOVES, STANDARD_Z_MOVES }
