import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DATA_PATH = resolve(ROOT_DIR, 'src/data/generatedPokemonData.json')
const OUTPUT_PATH = resolve(ROOT_DIR, 'src/data/generatedGen5SpriteManifest.json')
const SPRITE_ROOT = 'https://play.pokemonshowdown.com/sprites'
const POKEAPI_SPRITE_ROOT = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon'

const DIRECTORIES = {
  staticFront: 'gen5',
  staticBack: 'gen5-back',
  staticFrontShiny: 'gen5-shiny',
  staticBackShiny: 'gen5-back-shiny',
  animatedFront: 'gen5ani',
  animatedBack: 'gen5ani-back',
  animatedFrontShiny: 'gen5ani-shiny',
  animatedBackShiny: 'gen5ani-back-shiny',
}

const ANIMATION_BITS = {
  animatedFront: 1,
  animatedBack: 2,
  animatedFrontShiny: 4,
  animatedBackShiny: 8,
}

const FALLBACK_PATHS = {
  staticFront: (id) => `${POKEAPI_SPRITE_ROOT}/${id}.png`,
  staticBack: (id) => `${POKEAPI_SPRITE_ROOT}/back/${id}.png`,
  staticFrontShiny: (id) => `${POKEAPI_SPRITE_ROOT}/shiny/${id}.png`,
  staticBackShiny: (id) => `${POKEAPI_SPRITE_ROOT}/back/shiny/${id}.png`,
}

const PROFILE_SPRITE_ALIASES = {
  'raticate-totem-alola': 'raticate-alola',
  'pikachu-original-cap': 'pikachu-original',
  'pikachu-hoenn-cap': 'pikachu-hoenn',
  'pikachu-sinnoh-cap': 'pikachu-sinnoh',
  'pikachu-unova-cap': 'pikachu-unova',
  'pikachu-kalos-cap': 'pikachu-kalos',
  'pikachu-alola-cap': 'pikachu-alola',
  'pikachu-partner-cap': 'pikachu-partner',
  'pikachu-world-cap': 'pikachu-world',
  'marowak-totem': 'marowak-alola',
  'tauros-paldea-combat-breed': 'tauros-paldeacombat',
  'tauros-paldea-blaze-breed': 'tauros-paldeablaze',
  'tauros-paldea-aqua-breed': 'tauros-paldeaaqua',
  'darmanitan-galar-standard': 'darmanitan-galar',
  'greninja-battle-bond': 'greninja',
  'meowstic-female': 'meowstic-f',
  'meowstic-male-mega': 'meowstic-mmega',
  'meowstic-female-mega': 'meowstic-fmega',
  'zygarde-10-power-construct': 'zygarde-10',
  'zygarde-50-power-construct': 'zygarde',
  'zygarde-mega': 'zygarde-complete',
  'gumshoos-totem': 'gumshoos',
  'vikavolt-totem': 'vikavolt',
  'ribombee-totem': 'ribombee',
  'rockruff-own-tempo': 'rockruff',
  'araquanid-totem': 'araquanid',
  'lurantis-totem': 'lurantis',
  'salazzle-totem': 'salazzle',
  'minior-orange-meteor': 'minior-meteor',
  'minior-yellow-meteor': 'minior-meteor',
  'minior-green-meteor': 'minior-meteor',
  'minior-blue-meteor': 'minior-meteor',
  'minior-indigo-meteor': 'minior-meteor',
  'minior-violet-meteor': 'minior-meteor',
  'minior-red': 'minior',
  'togedemaru-totem': 'togedemaru',
  'mimikyu-totem-disguised': 'mimikyu',
  'mimikyu-totem-busted': 'mimikyu-busted',
  'kommo-o-totem': 'kommoo',
  'necrozma-dusk': 'necrozma-duskmane',
  'necrozma-dawn': 'necrozma-dawnwings',
  'toxtricity-amped-gmax': 'toxtricity-gmax',
  'toxtricity-low-key-gmax': 'toxtricity-gmax',
  'indeedee-female': 'indeedee-f',
  'urshifu-single-strike-gmax': 'urshifu-gmax',
  'basculegion-female': 'basculegion-f',
  'oinkologne-female': 'oinkologne-f',
  'maushold-family-of-three': 'maushold',
  'squawkabilly-blue-plumage': 'squawkabilly-blue',
  'squawkabilly-yellow-plumage': 'squawkabilly-yellow',
  'squawkabilly-white-plumage': 'squawkabilly-white',
  'koraidon-limited-build': 'koraidon',
  'koraidon-sprinting-build': 'koraidon',
  'koraidon-swimming-build': 'koraidon',
  'koraidon-gliding-build': 'koraidon',
  'miraidon-low-power-mode': 'miraidon',
  'miraidon-drive-mode': 'miraidon',
  'miraidon-aquatic-mode': 'miraidon',
  'miraidon-glide-mode': 'miraidon',
  'ogerpon-wellspring-mask': 'ogerpon-wellspring',
  'ogerpon-hearthflame-mask': 'ogerpon-hearthflame',
  'ogerpon-cornerstone-mask': 'ogerpon-cornerstone',
}

function normalizeSpriteName(value) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

async function fetchDirectory(directory) {
  const response = await fetch(`${SPRITE_ROOT}/${directory}/`)
  if (!response.ok) throw new Error(`Failed to load ${directory}: ${response.status}`)

  const html = await response.text()
  return new Set(
    [...html.matchAll(/href="([^"?]+\.(?:gif|png))"/gi)]
      .map((match) => decodeURIComponent(match[1]).split('/').pop().replace(/\.(?:gif|png)$/i, '')),
  )
}

function normalizedIndex(names) {
  const index = new Map()
  for (const name of names) {
    const normalizedName = normalizeSpriteName(name)
    const matches = index.get(normalizedName) ?? []
    matches.push(name)
    index.set(normalizedName, matches)
  }
  return index
}

function resolveSpriteKey(profile, staticFrontNames, staticFrontIndex) {
  if (staticFrontNames.has(profile.slug)) return profile.slug

  const normalizedMatches = staticFrontIndex.get(normalizeSpriteName(profile.slug)) ?? []
  if (normalizedMatches.length === 1) return normalizedMatches[0]

  const alias = PROFILE_SPRITE_ALIASES[profile.slug]
  return alias && staticFrontNames.has(alias) ? alias : null
}

async function verifyFallbackProfile(profile) {
  await Promise.all(
    Object.entries(FALLBACK_PATHS).map(async ([variant, createUrl]) => {
      const url = createUrl(profile.id)
      const response = await fetch(url, { method: 'HEAD' })
      if (!response.ok) {
        throw new Error(`${profile.slug} is missing ${variant} fallback: ${url} (${response.status})`)
      }
    }),
  )
}

async function verifyFallbackProfiles(profiles) {
  const batchSize = 6
  for (let index = 0; index < profiles.length; index += batchSize) {
    await Promise.all(profiles.slice(index, index + batchSize).map(verifyFallbackProfile))
  }
}

async function main() {
  const pokemonData = JSON.parse(await readFile(DATA_PATH, 'utf8'))
  const formSelection = process.argv.find((argument) => argument.startsWith('--forms='))
  const selectedFormSlugs = formSelection
    ? new Set(formSelection.slice('--forms='.length).split(',').map((slug) => slug.trim()).filter(Boolean))
    : null
  const previous = selectedFormSlugs ? JSON.parse(await readFile(OUTPUT_PATH, 'utf8')) : null
  if (selectedFormSlugs) {
    for (const slug of selectedFormSlugs) {
      if (!pokemonData.forms.some((profile) => profile.slug === slug)) throw new Error(`Unknown form: ${slug}`)
    }
  }
  const directoryEntries = await Promise.all(
    Object.entries(DIRECTORIES).map(async ([key, directory]) => [key, await fetchDirectory(directory)]),
  )
  const spriteNames = Object.fromEntries(directoryEntries)
  const staticFrontIndex = normalizedIndex(spriteNames.staticFront)
  const profiles = [...pokemonData.species, ...pokemonData.forms]
  const profilesToRefresh = selectedFormSlugs ? profiles.filter((profile) => selectedFormSlugs.has(profile.slug)) : profiles
  const refreshedIds = new Set(profilesToRefresh.map((profile) => profile.id))
  const profileManifest = { ...previous?.profiles }
  const fallbackProfiles = (previous?.fallbackProfiles ?? []).filter((profile) => !refreshedIds.has(profile.id))
  const fallbacksToVerify = []

  for (const profile of profilesToRefresh) {
    delete profileManifest[profile.id]
    const spriteKey = resolveSpriteKey(profile, spriteNames.staticFront, staticFrontIndex)
    if (!spriteKey) {
      fallbackProfiles.push({ id: profile.id, slug: profile.slug })
      fallbacksToVerify.push({ id: profile.id, slug: profile.slug })
      continue
    }

    for (const variant of ['staticFront', 'staticBack', 'staticFrontShiny', 'staticBackShiny']) {
      if (!spriteNames[variant].has(spriteKey)) {
        throw new Error(`${profile.slug} is missing ${DIRECTORIES[variant]}/${spriteKey}.png`)
      }
    }

    const animationMask = Object.entries(ANIMATION_BITS).reduce(
      (mask, [variant, bit]) => mask | (spriteNames[variant].has(spriteKey) ? bit : 0),
      0,
    )
    profileManifest[profile.id] = [spriteKey, animationMask]
  }

  const speciesCoverage = pokemonData.species.filter((profile) => profileManifest[profile.id]).length
  if (speciesCoverage !== pokemonData.species.length) {
    throw new Error(`National Pokédex coverage is incomplete: ${speciesCoverage}/${pokemonData.species.length}`)
  }

  await verifyFallbackProfiles(fallbacksToVerify)

  const output = {
    generatedAt: new Date().toISOString(),
    source: SPRITE_ROOT,
    profileCount: profiles.length,
    mappedProfileCount: Object.keys(profileManifest).length,
    verifiedFallbackProfileCount: fallbackProfiles.length,
    speciesCoverage,
    fallbackProfiles,
    profiles: profileManifest,
  }

  await mkdir(dirname(OUTPUT_PATH), { recursive: true })
  await writeFile(OUTPUT_PATH, `${JSON.stringify(output)}\n`, 'utf8')
  process.stdout.write(
    `Mapped ${output.mappedProfileCount}/${output.profileCount} profiles, verified ${output.verifiedFallbackProfileCount} fallbacks, and covered ${speciesCoverage}/${pokemonData.species.length} Pokédex species.\n`,
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
