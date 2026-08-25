import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { ZA_MEGA_STONES } from '../src/data/zaMegaData.js'

const API_BASE = 'https://pokeapi.co/api/v2'
const OUTPUT_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../src/data/generatedBattleItems.js',
)

const SHOWDOWN_ITEM_SPRITE_SHEET = 'https://play.pokemonshowdown.com/sprites/itemicons-sheet.png?v1'
const SHOWDOWN_ITEM_DATA = 'https://play.pokemonshowdown.com/data/items.js'

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

const CATEGORY_GROUPS = [
  {
    id: 'berry',
    categories: ['medicine', 'other', 'in-a-pinch', 'picky-healing', 'type-protection'],
  },
  {
    id: 'held',
    categories: [
      'held-items',
      'choice',
      'bad-held-items',
      'species-specific',
      'type-enhancement',
      'jewels',
    ],
  },
  {
    id: 'gimmick',
    categories: ['plates', 'mega-stones', 'memories', 'z-crystals'],
  },
]

const EXTRA_ITEMS = [
  { id: 'blue-orb', category: 'gimmick', sourceCategory: 'form-battle-gear' },
  { id: 'red-orb', category: 'gimmick', sourceCategory: 'form-battle-gear' },
  { id: 'solganium-z--held', category: 'gimmick', sourceCategory: 'z-crystals' },
  { id: 'lunalium-z--held', category: 'gimmick', sourceCategory: 'z-crystals' },
  { id: 'ultranecrozium-z--held', category: 'gimmick', sourceCategory: 'z-crystals' },
  { id: 'kommonium-z--held', category: 'gimmick', sourceCategory: 'z-crystals' },
  { id: 'lycanium-z--held', category: 'gimmick', sourceCategory: 'z-crystals' },
  { id: 'mimikium-z--held', category: 'gimmick', sourceCategory: 'z-crystals' },
]

const TRAINER_EQUIPMENT_ITEM_IDS = [
  'mega-ring',
  'mega-charm',
  'mega-glove',
  'mega-bracelet',
  'mega-pendant',
  'mega-glasses',
  'mega-anchor',
  'mega-stickpin',
  'mega-tiara',
  'mega-anklet',
  'mega-cuff',
  'key-stone',
  'z-ring',
  'z-power-ring',
  'dynamax-band',
  'tera-orb',
]

const OUT_OF_BATTLE_FORM_ITEM_IDS = [
  'red-nectar',
  'yellow-nectar',
  'pink-nectar',
  'purple-nectar',
  'gracidea',
  'meteorite',
  'meteorite--2',
  'meteorite--3',
  'meteorite--4',
  'dna-splicers',
  'dna-splicers--merge',
  'dna-splicers--split',
  'reveal-glass',
  'prison-bottle',
  'zygarde-cube',
  'n-solarizer--merge',
  'n-solarizer--split',
  'n-lunarizer--merge',
  'n-lunarizer--split',
  'rotom-catalog',
  'reins-of-unity',
  'reins-of-unity--merge',
  'reins-of-unity--split',
  'teal-mask',
  'griseous-core',
  'adamant-crystal',
  'lustrous-globe',
]

const EXCLUDED_ITEM_IDS = new Set([
  ...TRAINER_EQUIPMENT_ITEM_IDS,
  ...OUT_OF_BATTLE_FORM_ITEM_IDS,
  'pass-orb',
  'smoke-ball',
])

const LEGACY_ITEMS = [
  {
    id: 'berry',
    name: 'Berry',
    description: '2세대에서 등장한 나무열매입니다. 지닌 포켓몬의 HP가 절반 이하가 되면 HP를 10 회복합니다.',
    effect: 'HP 10 자동 회복',
    category: 'berry',
  },
  {
    id: 'berserk-gene',
    name: 'Berserk Gene',
    description: '2세대 전용 지닌 도구입니다. 배틀에 나오면 공격이 크게 오르지만 혼란 상태가 됩니다.',
    effect: '공격 2단계 상승·혼란',
    category: 'held',
  },
  {
    id: 'bitter-berry',
    name: 'Bitter Berry',
    description: '2세대에서 지닌 포켓몬의 혼란을 회복하는 나무열매입니다.',
    effect: '혼란 자동 회복',
    category: 'berry',
  },
  {
    id: 'burnt-berry',
    name: 'Burnt Berry',
    description: '2세대에서 지닌 포켓몬의 얼음 상태를 회복하는 나무열매입니다.',
    effect: '얼음 상태 자동 회복',
    category: 'berry',
  },
  {
    id: 'gold-berry',
    name: 'Gold Berry',
    description: '2세대에서 지닌 포켓몬의 HP가 절반 이하가 되면 HP를 30 회복하는 나무열매입니다.',
    effect: 'HP 30 자동 회복',
    category: 'berry',
  },
  {
    id: 'ice-berry',
    name: 'Ice Berry',
    description: '2세대에서 지닌 포켓몬의 화상 상태를 회복하는 나무열매입니다.',
    effect: '화상 자동 회복',
    category: 'berry',
  },
  {
    id: 'mint-berry',
    name: 'Mint Berry',
    description: '2세대에서 지닌 포켓몬의 잠듦 상태를 회복하는 나무열매입니다.',
    effect: '잠듦 자동 회복',
    category: 'berry',
  },
  {
    id: 'miracle-berry',
    name: 'Miracle Berry',
    description: '2세대에서 지닌 포켓몬의 모든 주요 상태 이상을 회복하는 나무열매입니다.',
    effect: '상태 이상 자동 회복',
    category: 'berry',
  },
  {
    id: 'mystery-berry',
    name: 'Mystery Berry',
    description: '2세대에서 기술의 PP가 0이 되면 해당 기술의 PP를 5 회복하는 나무열매입니다.',
    effect: 'PP 5 자동 회복',
    category: 'berry',
  },
  {
    id: 'pink-bow',
    name: 'Pink Bow',
    description: '2세대에서 노말타입 기술의 위력을 높이는 지닌 도구입니다.',
    effect: '노말타입 기술 위력 1.1배',
    category: 'held',
  },
  {
    id: 'polkadot-bow',
    name: 'Polkadot Bow',
    description: '2세대에서 노말타입 기술의 위력을 높이는 지닌 도구입니다.',
    effect: '노말타입 기술 위력 1.1배',
    category: 'held',
  },
  {
    id: 'prz-cure-berry',
    name: 'PRZ Cure Berry',
    description: '2세대에서 지닌 포켓몬의 마비 상태를 회복하는 나무열매입니다.',
    effect: '마비 자동 회복',
    category: 'berry',
  },
  {
    id: 'psn-cure-berry',
    name: 'PSN Cure Berry',
    description: '2세대에서 지닌 포켓몬의 독 상태를 회복하는 나무열매입니다.',
    effect: '독 자동 회복',
    category: 'berry',
  },
  {
    id: 'leek',
    name: 'Leek',
    description: '8세대에서 파오리와 창파나이트가 지니면 급소율이 크게 오르는 전용 도구입니다.',
    effect: '파오리 계열 급소율 2단계 상승',
    category: 'held',
  },
].map((item, index) => ({
  ...item,
  englishName: item.name,
  sourceCategory: 'historical-battle-item',
  price: 180 + ((index % 7) * 10),
  grade: '역대',
  generation: item.id === 'leek' ? 8 : 2,
  sprite: '',
}))

const MANUAL_BATTLE_ITEMS = [
  {
    id: 'adamant-crystal',
    name: '큰금강옥',
    englishName: 'Adamant Crystal',
    description: '디아루가가 지니면 오리진폼이 되고 강철타입과 드래곤타입 기술의 위력이 올라간다.',
    effect: '디아루가 오리진폼·강철/드래곤 위력 상승',
    generation: 8,
    spriteSheetIndex: 741,
    category: 'gimmick',
    sourceCategory: 'form-battle-gear',
  },
  {
    id: 'ability-shield',
    name: '특성가드',
    englishName: 'Ability Shield',
    description: '지닌 포켓몬의 특성이 다른 포켓몬이나 기술에 의해 바뀌거나 무효화되는 것을 막는다.',
    effect: '특성 변경·무효화 방지',
    generation: 9,
    spriteSheetIndex: 746,
  },
  {
    id: 'blunder-policy',
    name: '허탕보험',
    englishName: 'Blunder Policy',
    description: '명중률 때문에 기술이 빗나가면 소모되어 스피드가 2단계 올라간다.',
    effect: '빗나가면 스피드 2단계 상승',
    generation: 8,
    spriteSheetIndex: 716,
  },
  {
    id: 'booster-energy',
    name: '부스트에너지',
    englishName: 'Booster Energy',
    description: '고대활성 또는 쿼크차지를 가진 포켓몬이 지니면 조건이 맞지 않을 때 소모되어 가장 높은 능력을 강화한다.',
    effect: '패러독스 특성 발동',
    generation: 9,
    spriteSheetIndex: 745,
  },
  {
    id: 'cornerstone-mask',
    name: '주춧돌의가면',
    englishName: 'Cornerstone Mask',
    description: '오거폰이 지니면 주춧돌의가면 모습이 되고 사용하는 기술의 위력이 올라간다.',
    effect: '오거폰 주춧돌폼·기술 위력 상승',
    generation: 9,
    spriteSheetIndex: 758,
    category: 'gimmick',
    sourceCategory: 'form-battle-gear',
  },
  {
    id: 'clear-amulet',
    name: '클리어참',
    englishName: 'Clear Amulet',
    description: '상대의 기술이나 특성으로 지닌 포켓몬의 능력이 떨어지는 것을 막는다.',
    effect: '상대가 일으키는 능력 하락 방지',
    generation: 9,
    spriteSheetIndex: 747,
  },
  {
    id: 'covert-cloak',
    name: '은밀망토',
    englishName: 'Covert Cloak',
    description: '상대 기술의 데미지 이외 추가 효과를 받지 않게 한다.',
    effect: '상대 기술의 추가 효과 방지',
    generation: 9,
    spriteSheetIndex: 750,
  },
  {
    id: 'eject-pack',
    name: '탈출팩',
    englishName: 'Eject Pack',
    description: '지닌 포켓몬의 능력이 떨어지면 소모되어 교대한다.',
    effect: '능력 하락 시 교대',
    generation: 8,
    spriteSheetIndex: 714,
  },
  {
    id: 'fairy-feather',
    name: '요정의깃털',
    englishName: 'Fairy Feather',
    description: '지니게 하면 페어리타입 기술의 위력이 올라간다.',
    effect: '페어리타입 기술 위력 1.2배',
    generation: 9,
    spriteSheetIndex: 754,
  },
  {
    id: 'griseous-core',
    name: '큰백금옥',
    englishName: 'Griseous Core',
    description: '기라티나가 지니면 오리진폼이 되고 고스트타입과 드래곤타입 기술의 위력이 올라간다.',
    effect: '기라티나 오리진폼·고스트/드래곤 위력 상승',
    generation: 8,
    spriteSheetIndex: 743,
    category: 'gimmick',
    sourceCategory: 'form-battle-gear',
  },
  {
    id: 'heavy-duty-boots',
    name: '통굽부츠',
    englishName: 'Heavy-Duty Boots',
    description: '교대하여 나올 때 진영에 설치된 함정의 효과를 받지 않는다.',
    effect: '설치기 효과 무시',
    generation: 8,
    spriteSheetIndex: 715,
  },
  {
    id: 'hearthflame-mask',
    name: '화덕의가면',
    englishName: 'Hearthflame Mask',
    description: '오거폰이 지니면 화덕의가면 모습이 되고 사용하는 기술의 위력이 올라간다.',
    effect: '오거폰 화덕폼·기술 위력 상승',
    generation: 9,
    spriteSheetIndex: 760,
    category: 'gimmick',
    sourceCategory: 'form-battle-gear',
  },
  {
    id: 'loaded-dice',
    name: '속임수주사위',
    englishName: 'Loaded Dice',
    description: '연속 기술의 공격 횟수가 많아지고 연속 명중 기술이 안정적으로 명중한다.',
    effect: '연속 기술 강화',
    generation: 9,
    spriteSheetIndex: 751,
  },
  {
    id: 'lustrous-globe',
    name: '큰백옥',
    englishName: 'Lustrous Globe',
    description: '펄기아가 지니면 오리진폼이 되고 물타입과 드래곤타입 기술의 위력이 올라간다.',
    effect: '펄기아 오리진폼·물/드래곤 위력 상승',
    generation: 8,
    spriteSheetIndex: 742,
    category: 'gimmick',
    sourceCategory: 'form-battle-gear',
  },
  {
    id: 'mirror-herb',
    name: '흉내허브',
    englishName: 'Mirror Herb',
    description: '상대의 능력이 올라가면 한 번만 소모되어 같은 능력 상승을 복사한다.',
    effect: '상대의 능력 상승 복사',
    generation: 9,
    spriteSheetIndex: 748,
  },
  {
    id: 'punching-glove',
    name: '펀치글러브',
    englishName: 'Punching Glove',
    description: '펀치 기술의 위력을 높이고 접촉 효과를 받지 않게 한다.',
    effect: '펀치 기술 위력 상승·비접촉화',
    generation: 9,
    spriteSheetIndex: 749,
  },
  {
    id: 'room-service',
    name: '룸서비스',
    englishName: 'Room Service',
    description: '트릭룸이 시작되면 소모되어 스피드가 1단계 떨어진다.',
    effect: '트릭룸에서 스피드 하락',
    generation: 8,
    spriteSheetIndex: 717,
  },
  {
    id: 'rusted-shield',
    name: '녹슨방패',
    englishName: 'Rusted Shield',
    description: '자마젠타가 지니면 배틀에서 방패왕의 모습이 된다.',
    effect: '자마젠타 방패왕폼',
    generation: 8,
    spriteSheetIndex: 699,
    category: 'gimmick',
    sourceCategory: 'form-battle-gear',
  },
  {
    id: 'rusted-sword',
    name: '녹슨검',
    englishName: 'Rusted Sword',
    description: '자시안이 지니면 배틀에서 검왕의 모습이 된다.',
    effect: '자시안 검왕폼',
    generation: 8,
    spriteSheetIndex: 698,
    category: 'gimmick',
    sourceCategory: 'form-battle-gear',
  },
  {
    id: 'throat-spray',
    name: '목스프레이',
    englishName: 'Throat Spray',
    description: '소리 기술을 사용하면 소모되어 특수공격이 1단계 올라간다.',
    effect: '소리 기술 사용 시 특수공격 상승',
    generation: 8,
    spriteSheetIndex: 713,
  },
  {
    id: 'utility-umbrella',
    name: '만능우산',
    englishName: 'Utility Umbrella',
    description: '지닌 포켓몬이 비와 강한 햇살의 영향을 받지 않게 한다.',
    effect: '비·강한 햇살 영향 무시',
    generation: 8,
    spriteSheetIndex: 718,
  },
  {
    id: 'wellspring-mask',
    name: '우물의가면',
    englishName: 'Wellspring Mask',
    description: '오거폰이 지니면 우물의가면 모습이 되고 사용하는 기술의 위력이 올라간다.',
    effect: '오거폰 우물폼·기술 위력 상승',
    generation: 9,
    spriteSheetIndex: 759,
    category: 'gimmick',
    sourceCategory: 'form-battle-gear',
  },
].map((item) => ({
  ...item,
  category: item.category ?? 'held',
  sourceCategory: item.sourceCategory ?? 'held-items',
  price: item.category === 'gimmick' ? 520 : 320,
  grade: item.category === 'gimmick' ? '기믹' : '고급',
  sprite: SHOWDOWN_ITEM_SPRITE_SHEET,
}))

const CATEGORY_DESCRIPTION = {
  berry: '포켓몬에게 지니게 하면 조건에 따라 효과가 발동하는 나무열매입니다.',
  held: '포켓몬에게 지니게 하여 배틀 효과를 얻는 도구입니다.',
  gimmick: '특정 포켓몬이나 배틀 기믹을 활성화하는 전용 도구입니다.',
}

const CATEGORY_EFFECT = {
  berry: '조건 충족 시 자동 발동',
  held: '포켓몬에게 지니게 하여 사용',
  gimmick: '배틀 기믹·전용 효과',
}

const BASE_PRICE = {
  berry: 50,
  held: 180,
  gimmick: 420,
}

const PRICE_OVERRIDES = {
  potion: 30,
  'super-potion': 60,
  'hyper-potion': 100,
  'max-potion': 160,
  'full-restore': 220,
  'full-heal': 70,
  revive: 150,
  'max-revive': 300,
  'x-attack': 60,
  'x-defense': 60,
  'x-sp-atk': 60,
  'x-sp-def': 60,
  'x-speed': 60,
  'dire-hit': 80,
  'guard-spec': 90,
  'sitrus-berry': 100,
  leftovers: 240,
  'focus-sash': 260,
  'life-orb': 280,
  'choice-scarf': 260,
  'master-ball': 1000,
}

const ROMAN_GENERATIONS = {
  i: 1,
  ii: 2,
  iii: 3,
  iv: 4,
  v: 5,
  vi: 6,
  vii: 7,
  viii: 8,
  ix: 9,
}

async function fetchJson(url, attempts = 3) {
  let lastError

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
      return await response.json()
    } catch (error) {
      lastError = error
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 350))
    }
  }

  throw lastError
}

async function fetchText(url, attempts = 3) {
  let lastError

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
      return await response.text()
    } catch (error) {
      lastError = error
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 350))
    }
  }

  throw lastError
}

async function loadShowdownItems() {
  const context = { exports: {} }
  runInNewContext(await fetchText(SHOWDOWN_ITEM_DATA), context, { timeout: 2000 })
  return context.exports.BattleItems ?? {}
}

async function mapWithConcurrency(values, limit, callback) {
  const results = new Array(values.length)
  let nextIndex = 0

  async function worker() {
    while (nextIndex < values.length) {
      const currentIndex = nextIndex
      nextIndex += 1
      results[currentIndex] = await callback(values[currentIndex], currentIndex)
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => worker()))
  return results
}

function cleanText(value) {
  return String(value ?? '')
    .replace(/\[([^\]]+)]\{[^}]+}/g, '$1')
    .replace(/\{[^}]+}/g, '')
    .replace(/[\n\r\f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function formatIdentifier(identifier) {
  return identifier
    .replace(/--held$/, '')
    .split('-')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function toShowdownId(identifier) {
  return String(identifier ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function localizedName(item, language) {
  return item.names?.find((entry) => entry.language.name === language)?.name ?? ''
}

function latestFlavorText(item, language) {
  const matches = item.flavor_text_entries?.filter((entry) => entry.language.name === language) ?? []
  const latest = matches.at(-1)
  return cleanText(latest?.text ?? latest?.flavor_text)
}

function getGeneration(item, sourceCategory) {
  const generations = (item.game_indices ?? []).map((entry) => {
    const roman = entry.generation.name.replace('generation-', '')
    return ROMAN_GENERATIONS[roman]
  }).filter(Boolean)

  if (generations.length > 0) return Math.min(...generations)
  if (sourceCategory === 'mega-stones') return 9
  return 9
}

function hashIdentifier(identifier) {
  return [...identifier].reduce((total, character) => ((total * 31) + character.charCodeAt(0)) >>> 0, 0)
}

function getPrice(item, category, sourceCategory) {
  if (PRICE_OVERRIDES[item.name]) return PRICE_OVERRIDES[item.name]

  let basePrice = BASE_PRICE[category]
  if (sourceCategory === 'mega-stones') basePrice = 560
  if (sourceCategory === 'z-crystals') basePrice = 500
  if (sourceCategory === 'battle-gear') basePrice = 650
  if (sourceCategory === 'form-battle-gear') basePrice = 520
  if (sourceCategory === 'tera-shard') basePrice = 300
  if (sourceCategory === 'jewels') basePrice = 220

  return basePrice + ((hashIdentifier(item.name) % 8) * 10)
}

function getGrade(price, sourceCategory) {
  if (['mega-stones', 'z-crystals', 'battle-gear', 'form-battle-gear'].includes(sourceCategory)) return '기믹'
  if (price >= 600) return '최고급'
  if (price >= 350) return '희귀'
  if (price >= 180) return '고급'
  return '일반'
}

async function main() {
  const assignments = new Map()
  const sourceCategories = CATEGORY_GROUPS.flatMap((group) => group.categories)
  const [categoryDetails, showdownItems] = await Promise.all([
    Promise.all(sourceCategories.map((category) => fetchJson(`${API_BASE}/item-category/${category}`))),
    loadShowdownItems(),
  ])

  for (const group of CATEGORY_GROUPS) {
    for (const sourceCategory of group.categories) {
      const detail = categoryDetails.find((entry) => entry.name === sourceCategory)
      for (const item of detail.items) {
        if (EXCLUDED_ITEM_IDS.has(item.name)) continue
        if (!assignments.has(item.name)) {
          assignments.set(item.name, { category: group.id, sourceCategory, url: item.url })
        }
      }
    }
  }

  for (const extra of EXTRA_ITEMS) {
    if (EXCLUDED_ITEM_IDS.has(extra.id)) continue
    assignments.set(extra.id, {
      category: extra.category,
      sourceCategory: extra.sourceCategory,
      url: `${API_BASE}/item/${extra.id}`,
    })
  }

  const assignmentEntries = [...assignments.entries()]
  const fetchedItemDetails = (await mapWithConcurrency(assignmentEntries, 16, async ([id, assignment], index) => {
    if (index % 50 === 0) process.stdout.write(`Fetching ${index + 1}/${assignmentEntries.length}\r`)
    const item = await fetchJson(assignment.url)
    const englishName = localizedName(item, 'en') || formatIdentifier(id)
    const koreanName = localizedName(item, 'ko')
    const koreanDescription = latestFlavorText(item, 'ko')
    const sprite = item.sprites?.default || ''
    const effectEntry = item.effect_entries?.find((entry) => entry.language.name === 'en')
      ?? item.effect_entries?.[0]
    const mechanicalEffect = cleanText(effectEntry?.short_effect ?? effectEntry?.effect)
    const showdownItem = showdownItems[toShowdownId(id)]
    const berry = assignment.category === 'berry' && id.endsWith('-berry')
      ? await fetchJson(`${API_BASE}/berry/${id.replace(/-berry$/, '')}`)
      : null
    const naturalGiftPower = showdownItem?.naturalGift?.basePower ?? berry?.natural_gift_power
    const naturalGiftTypeId = showdownItem?.naturalGift?.type?.toLowerCase()
      ?? berry?.natural_gift_type?.name
    const flingPower = showdownItem?.fling?.basePower ?? item.fling_power

    if (!/[가-힣]/.test(koreanName) || !sprite || !koreanDescription || !mechanicalEffect) return null

    const price = getPrice(item, assignment.category, assignment.sourceCategory)

    return {
      id,
      name: koreanName || englishName,
      englishName,
      category: assignment.category,
      sourceCategory: assignment.sourceCategory,
      price,
      description: koreanDescription,
      effect: CATEGORY_EFFECT[assignment.category],
      grade: getGrade(price, assignment.sourceCategory),
      generation: getGeneration(item, assignment.sourceCategory),
      sprite,
      ...(flingPower ? { flingPower } : {}),
      ...(assignment.category === 'berry'
        ? { flingEffect: 'berry-effect' }
        : item.fling_effect?.name ? { flingEffect: item.fling_effect.name } : {}),
      ...(naturalGiftPower && TYPE_LABELS[naturalGiftTypeId] ? {
        naturalGiftPower,
        naturalGiftType: TYPE_LABELS[naturalGiftTypeId],
      } : {}),
    }
  })).filter(Boolean)

  const itemById = new Map(fetchedItemDetails.map((item) => [item.id, item]))
  MANUAL_BATTLE_ITEMS.forEach((item) => itemById.set(item.id, {
    ...itemById.get(item.id),
    ...item,
  }))
  for (const megaStone of ZA_MEGA_STONES) {
    const targetFormNames = megaStone.forms.map((entry) => entry.name)
    const price = getPrice({ name: megaStone.id }, 'gimmick', 'mega-stones')
    itemById.set(megaStone.id, {
      id: megaStone.id,
      name: megaStone.name,
      englishName: megaStone.englishName,
      category: 'gimmick',
      sourceCategory: 'mega-stones',
      price,
      description: `${megaStone.basePokemonName}에게 지니게 하면 배틀 중 ${targetFormNames.join(' 또는 ')}로 메가진화할 수 있다.`,
      effect: '메가진화',
      grade: getGrade(price, 'mega-stones'),
      generation: 9,
      sprite: megaStone.sprite,
      compatiblePokemon: megaStone.basePokemonName,
      targetFormSlugs: megaStone.forms.map((entry) => entry.slug),
    })
  }

  const showdownFlingStatus = {
    brn: 'burn',
    par: 'paralyze',
    psn: 'poison',
    tox: 'badly-poison',
  }
  for (const [itemId, item] of itemById) {
    const showdownItem = showdownItems[toShowdownId(itemId)]
    const naturalGiftTypeId = showdownItem?.naturalGift?.type?.toLowerCase()
    itemById.set(itemId, {
      ...item,
      ...(showdownItem?.fling?.basePower ? { flingPower: showdownItem.fling.basePower } : {}),
      ...(showdownFlingStatus[showdownItem?.fling?.status] ? {
        flingEffect: showdownFlingStatus[showdownItem.fling.status],
      } : {}),
      ...(showdownItem?.fling?.volatileStatus === 'flinch' ? { flingEffect: 'flinch' } : {}),
      ...(showdownItem?.naturalGift?.basePower && TYPE_LABELS[naturalGiftTypeId] ? {
        naturalGiftPower: showdownItem.naturalGift.basePower,
        naturalGiftType: TYPE_LABELS[naturalGiftTypeId],
      } : {}),
    })
  }

  const itemDetails = [...itemById.values()]

  const categoryOrder = new Map(CATEGORY_GROUPS.map((group, index) => [group.id, index]))
  itemDetails.sort((left, right) => (
    categoryOrder.get(left.category) - categoryOrder.get(right.category)
    || left.generation - right.generation
    || left.name.localeCompare(right.name, 'ko')
    || left.id.localeCompare(right.id)
  ))

  const duplicateIds = itemDetails.filter((item, index) => itemDetails.findIndex((entry) => entry.id === item.id) !== index)
  if (duplicateIds.length > 0) throw new Error(`Duplicate item ids: ${duplicateIds.map((item) => item.id).join(', ')}`)

  const generatedModule = `// Generated by scripts/generateBattleItemData.mjs from PokéAPI v2.\n`
    + `// Held battle effects, battle berries, and battle gimmick items are included.\n`
    + `// Pokémon Legends: Z-A Mega Stones use locally stored game sprites.\n\n`
    + `export const GENERATED_BATTLE_ITEM_META = ${JSON.stringify({
      count: itemDetails.length,
      source: ['https://pokeapi.co/api/v2', SHOWDOWN_ITEM_DATA, 'https://www.serebii.net/itemdex/'],
      includedSourceCategories: sourceCategories,
    }, null, 2)}\n\n`
    + `export default ${JSON.stringify(itemDetails, null, 2)}\n`

  await writeFile(OUTPUT_PATH, generatedModule, 'utf8')
  process.stdout.write(`Generated ${itemDetails.length} battle items at ${OUTPUT_PATH}\n`)

  const counts = Object.fromEntries(CATEGORY_GROUPS.map((group) => [
    group.id,
    itemDetails.filter((item) => item.category === group.id).length,
  ]))
  console.log(counts)
}

await main()
