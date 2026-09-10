// Auth-free recording fixtures. Battle stats, eligible moves, item effects, AI,
// transformations, turn resolution and the presentation all remain game code.
import pokemonData from '../src/data/generatedPokemonData.json' with { type: 'json' }
import { getLearnableMoves, getMoveById, normalizePokemon } from '../src/data/trainingData.js'
import { getTrainer, getTrainerTeam } from '../src/data/trainerTeams.js'
import { BATTLE_FORMATS, BATTLE_TERRAINS, BATTLE_WEATHERS } from '../src/data/battleRules.js'
import { resolveZMove } from '../src/data/zMoveData.js'
import { resolveMaxMove } from '../src/data/maxMoveData.js'
import { PROMO_GIMMICK_DEFINITIONS } from './gimmickVariants.mjs'

const profiles = new Map([...pokemonData.species, ...pokemonData.forms].map((profile) => [profile.slug, profile]))

function pokemon(slug, moveIds, overrides = {}) {
  const profile = profiles.get(slug)
  if (!profile) throw new Error(`Unknown showcase Pokémon: ${slug}`)
  const learnable = new Set(getLearnableMoves(profile.id).map((move) => move.id))
  moveIds.forEach((id) => {
    if (!learnable.has(id)) throw new Error(`${slug} cannot learn ${id}`)
  })
  return normalizePokemon({
    captureId: `promo-${slug}`,
    speciesId: profile.id,
    ability: profile.abilities[0],
    moveIds,
    moves: moveIds.map((id) => getMoveById(id).name),
    nature: '겁쟁이',
    trainingPoints: { hp: 2, attack: 0, defense: 0, specialAttack: 32, specialDefense: 0, speed: 32 },
    ...overrides,
  })
}

export const PROMO_SCENES = {
  mega: {
    title: '메가진화', mechanic: 'mega', trainer: '난천', opponentSlugs: ['spiritomb'],
    roster: [['charizard', ['fireblast', 'dragonpulse', 'flamethrower', 'airslash'], { heldItemId: 'charizardite-x', teraType: '불꽃' }]],
  },
  zmove: {
    title: 'Z기술', mechanic: 'zmove', trainer: '레드', opponentSlugs: ['blastoise'],
    roster: [['pikachu', ['thunderbolt', 'surf', 'grassknot', 'quickattack'], { heldItemId: 'electrium-z', teraType: '전기' }]],
  },
  dynamax: {
    title: '거다이맥스', mechanic: 'dynamax', trainer: '성호', opponentSlugs: ['aggron'],
    roster: [['gengar', ['shadowball', 'sludgebomb', 'darkpulse', 'thunderbolt'], { heldItemId: 'life-orb', dynamaxMode: 'gigantamax', teraType: '고스트' }]],
  },
  tera: {
    title: '테라스탈', mechanic: 'tera', trainer: '목호', opponentSlugs: ['gyarados'],
    roster: [['gardevoir', ['moonblast', 'psychic', 'shadowball', 'energyball'], { heldItemId: 'wise-glasses', teraType: '페어리' }]],
  },
  battle: {
    title: '기술 연출', trainer: '성호', opponentSlugs: ['skarmory'],
    roster: [['charizard', ['fireblast', 'dragonpulse', 'flamethrower', 'airslash'], { heldItemId: 'charcoal' }]],
  },
  double: {
    title: '더블배틀', trainer: '난천', opponentSlugs: ['milotic', 'spiritomb'], format: 'double',
    roster: [
      ['garchomp', ['rockslide', 'dragonclaw', 'earthquake', 'swordsdance'], { heldItemId: 'clear-amulet', nature: '명랑', trainingPoints: { hp: 2, attack: 32, defense: 0, specialAttack: 0, specialDefense: 0, speed: 32 } }],
      ['greninja', ['icebeam', 'waterpulse', 'darkpulse', 'watershuriken'], { heldItemId: 'mystic-water' }],
    ],
  },
}

// Keep the established hero shots above and add eight independent battles for
// each pullback. Secondary moves are also taken from the real learnset.
for (const group of PROMO_GIMMICK_DEFINITIONS) {
  for (const [slug, moveId, heldItemId, trainer, opponentSlug, requestedTeraType] of group.variants) {
    const profile = profiles.get(slug)
    const firstMove = getMoveById(moveId)
    if (!profile || !firstMove) throw new Error(`Incomplete promo variant: ${group.id}/${slug}`)
    const alternatives = getLearnableMoves(profile.id)
      .filter((move) => move.id !== moveId && move.category !== '변화' && Number(move.power) > 0)
      .slice(0, 3)
      .map((move) => move.id)
    const physical = firstMove.category === '물리'
    PROMO_SCENES[`${group.id}-${slug}`] = {
      title: group.label,
      mechanic: group.id,
      trainer,
      opponentSlugs: [opponentSlug],
      roster: [[slug, [moveId, ...alternatives], {
        heldItemId,
        teraType: requestedTeraType ?? firstMove.type,
        ...(group.id === 'dynamax' ? { dynamaxMode: 'gigantamax' } : {}),
        ...(physical ? {
          nature: '명랑',
          trainingPoints: { hp: 2, attack: 32, defense: 0, specialAttack: 0, specialDefense: 0, speed: 32 },
        } : {}),
      }]],
    }
  }
}

// Shared by capture, composition and validation so labels always describe the
// actual Pokémon and selected move visible in each recorded panel.
export const PROMO_GIMMICK_GROUPS = PROMO_GIMMICK_DEFINITIONS.map((group) => ({
  id: group.id,
  mechanic: group.id,
  label: group.label,
  captureDuration: 10,
  variants: [group.id, ...group.variants.map(([slug]) => `${group.id}-${slug}`)].map((sceneId) => {
    const scene = PROMO_SCENES[sceneId]
    const [slug, moveIds, overrides] = scene.roster[0]
    const profile = profiles.get(slug)
    const move = getMoveById(moveIds[0])
    const resolvedMove = group.id === 'zmove'
      ? resolveZMove(move, { heldItemId: overrides.heldItemId, speciesSlug: slug })
      : group.id === 'dynamax'
        ? resolveMaxMove(move, { gigantamax: true, speciesSlug: slug })
        : move
    if (!resolvedMove) throw new Error(`First move cannot activate ${sceneId}`)
    return {
      id: sceneId,
      sceneId,
      url: `/promo/capture.html?scene=${sceneId}`,
      duration: 10,
      captureDuration: 10,
      pokemonSlug: slug,
      pokemonName: profile.name,
      speciesId: profile.id,
      moveId: move.id,
      moveName: move.name,
      type: move.type,
      resolvedMoveId: resolvedMove.id,
      resolvedMoveName: resolvedMove.name,
      resolvedMoveType: resolvedMove.type,
      teraType: overrides.teraType,
      mechanicLabel: group.label,
    }
  }),
}))

export function createPromoFixture(sceneId = 'mega') {
  const scene = PROMO_SCENES[sceneId]
  if (!scene) throw new Error(`Unknown scene: ${sceneId}`)
  const trainer = getTrainer(scene.trainer)
  const sourceTeam = getTrainerTeam(scene.trainer, 1)
  const opponentPokemon = scene.opponentSlugs.map((slug, index) => {
    const entry = sourceTeam.pokemon.find((candidate) => candidate.slug === slug)
    if (!entry) throw new Error(`${scene.trainer}'s roster does not include ${slug}`)
    return { ...entry, captureId: `promo-opponent-${index}-${slug}` }
  })
  const size = scene.roster.length
  return {
    scene,
    competitionLabel: 'POKÉMON CHAMPIONS AI',
    playerPokemon: scene.roster.map((entry) => pokemon(...entry)),
    opponent: { ...trainer, teamNumber: 1 },
    opponentTeam: {
      ...sourceTeam,
      pokemon: opponentPokemon,
      battleGimmicks: sourceTeam.battleGimmicks ?? [],
      strategy: { ...sourceTeam.strategy, lead: opponentPokemon[0].name },
    },
    rules: {
      weather: BATTLE_WEATHERS.find((entry) => entry.id === 'clear'),
      terrain: BATTLE_TERRAINS.find((entry) => entry.id === 'neutral'),
      format: BATTLE_FORMATS.find((entry) => entry.id === (scene.format ?? 'single')),
      teamRule: { id: 'full', label: `${size}대${size}`, shortLabel: `${size}대${size}`, battleSize: size },
      disabledGimmickId: null,
      gimmickRestriction: { id: null, label: '제한 없음' },
      aiDifficulty: 'normal',
    },
  }
}
