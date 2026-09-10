// Independent entitlement registry: do not import achievements or training data here.
const skin = (id, name, baseSpeciesId, achievementId, description, options = {}) => {
  const spriteFront = options.front ?? `/assets/pokemon/skins/${id}-front.gif`
  return Object.freeze({
    id, name, kind: 'skin', baseSpeciesId, speciesId: baseSpeciesId, achievementId, description,
    spriteFront,
    spriteBack: options.back ?? `/assets/pokemon/skins/${id}-back.gif`,
    image: spriteFront,
    filter: options.filter ?? null,
    artCredit: options.artCredit ?? null,
  })
}

export const POKEMON_SKINS = Object.freeze([
  skin('armored-mewtwo', '아머드 뮤츠', 150, 'flawless-league', '빈틈없는 리그 지휘관에게 주어지는 특수 장갑 외형입니다.', {
    artCredit: 'Othienka · DarkwarePX',
  }),
  skin('shadow-lugia', '다크루기아', 249, 'flawless-tournament', '완벽한 토너먼트의 승자에게 주어지는 어둠의 날개 외형입니다.', {
    front: '/assets/pokemon/skins/shadow-lugia-sheet.png#front',
    back: '/assets/pokemon/skins/shadow-lugia-sheet.png#back',
    artCredit: 'Shadowgate31',
  }),
  skin('crystal-ho-oh', '크리스털 칠색조', 250, 'collection-all', '전국도감을 완성한 수집가에게 주어지는 수정빛 색상과 은은한 광채의 외형입니다.', {
    filter: 'grayscale(1) sepia(0.7) saturate(1.8) hue-rotate(140deg) brightness(1.15) drop-shadow(0 0 2px #72e8ff88)',
  }),
  skin('astral-rayquaza', '아스트랄 레쿠쟈', 384, 'collection-shiny-all', '모든 색이 다른 포켓몬을 모은 수집가에게 주어지는 짙은 별빛 색상의 외형입니다.', {
    filter: 'hue-rotate(105deg) saturate(1.5) brightness(0.75) drop-shadow(0 0 2px #d4b36b99)',
  }),
])

export const RARE_BATTLE_ITEMS = Object.freeze([Object.freeze({
  id: 'legend-plate', name: '레전드플레이트', englishName: 'Legend Plate', kind: 'item',
  category: 'held', categoryLabel: '지닌 도구', rarity: 'mythic',
  price: 0, sprite: '/assets/items/legend-plate-la.png', image: '/assets/items/legend-plate-la.png',
  grade: '신화', effect: '심판의뭉치 타입 자동 선택', sourceCategory: 'plates',
  description: '아르세우스가 지니면 심판의뭉치가 상대에게 가장 효과적인 타입으로 바뀌고, 아르세우스도 그 타입이 됩니다. 테라스탈 중에는 몸의 타입이 유지됩니다.',
  effectId: 'legend-plate-judgment', compatibleBaseSpeciesIds: Object.freeze([493]),
  rewardOnly: true, rewardAchievementId: 'achievements-all',
  flingPower: 0,
})])

const SKIN_BY_ID = new Map(POKEMON_SKINS.map((entry) => [entry.id, entry]))

// Render original animation files and sprite-sheet viewports directly. Cosmetic
// palettes are runtime effects, so the source artwork and animation stay intact.
export function getSkinSpritePresentation(src) {
  const definition = POKEMON_SKINS.find((entry) => entry.spriteFront === src || entry.spriteBack === src)
  if (!definition) return null
  if (definition.id === 'shadow-lugia') {
    const isBack = src === definition.spriteBack
    return {
      source: '/assets/pokemon/skins/shadow-lugia-sheet.png',
      frame: { x: isBack ? 129 : 172, y: isBack ? 90 : 0, width: 96, height: 90, sheetWidth: 270, sheetHeight: 376 },
    }
  }
  return { source: src, filter: definition.filter }
}

const earned = (progress, achievementId) => {
  const unlocked = progress?.unlocked
  return unlocked && Object.hasOwn(unlocked, achievementId)
    && Number.isSafeInteger(unlocked[achievementId]) && unlocked[achievementId] >= 0
}
const baseSpeciesId = (pokemon) => Number(typeof pokemon === 'number'
  ? pokemon
  : pokemon?.parentSpeciesId ?? pokemon?.battleBaseSpeciesId ?? pokemon?.dexSpeciesId ?? pokemon?.speciesId ?? pokemon?.id)

export function getPokemonSkin(id) {
  return SKIN_BY_ID.get(id) ?? null
}

export function getRareReward(id) {
  return getPokemonSkin(id) ?? RARE_BATTLE_ITEMS.find((entry) => entry.id === id) ?? null
}

export function isPokemonSkinCompatible(id, pokemon) {
  const definition = getPokemonSkin(id)
  return Boolean(definition && definition.baseSpeciesId === baseSpeciesId(pokemon))
}

export function getUnlockedPokemonSkins(progress, pokemon) {
  return POKEMON_SKINS.filter((entry) => earned(progress, entry.achievementId)
    && (pokemon == null || isPokemonSkinCompatible(entry.id, pokemon)))
}

export function getUnlockedRareItems(progress) {
  return RARE_BATTLE_ITEMS.filter((entry) => earned(progress, entry.rewardAchievementId))
}

export function deriveRareRewardEntitlements(progress) {
  return {
    skinIds: getUnlockedPokemonSkins(progress).map((entry) => entry.id),
    itemIds: getUnlockedRareItems(progress).map((entry) => entry.id),
  }
}

// Return minimal owned Pokemon records. The caller normalizes them and restores
// missing grants from persisted achievement entitlements after reload.
export function fulfillRareRewardCollection(progress, value = []) {
  let collection = Array.isArray(value) ? value : []
  const grantedPokemon = []
  for (const definition of getUnlockedPokemonSkins(progress)) {
    if (collection.some((entry) => baseSpeciesId(entry) === definition.baseSpeciesId)) continue
    const pokemon = {
      captureId: `dex-${definition.baseSpeciesId}`,
      speciesId: definition.baseSpeciesId,
      dexSpeciesId: definition.baseSpeciesId,
      skinId: definition.id,
      isShiny: false,
      shinyObtained: false,
      directDrawCount: 0,
      rewardOrigin: definition.achievementId,
    }
    collection = [...collection, pokemon]
    grantedPokemon.push(pokemon)
  }
  return { collection, grantedPokemon }
}
