import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ZA_MEGA_ABILITY_OVERRIDES,
  ZA_MEGA_FORM_SLUGS,
  ZA_MEGA_UNAVAILABLE_FORM_SLUGS,
  getZaMegaForm,
} from '../src/data/zaMegaData.js'

const API_ROOT = 'https://pokeapi.co/api/v2'
const CONCURRENCY = 24
const OUTPUT_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../src/data/generatedPokemonData.json',
)

const TYPE_NAMES = {
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
  stellar: '스텔라',
  unknown: '미지',
}

const GENERATION_NUMBERS = {
  'generation-i': 1,
  'generation-ii': 2,
  'generation-iii': 3,
  'generation-iv': 4,
  'generation-v': 5,
  'generation-vi': 6,
  'generation-vii': 7,
  'generation-viii': 8,
  'generation-ix': 9,
}

const FORM_NAME_OVERRIDES = {
  'deoxys-attack': '테오키스 어택폼',
  'deoxys-defense': '테오키스 디펜스폼',
  'deoxys-speed': '테오키스 스피드폼',
  'wormadam-sandy': '도롱마담 모래땅도롱',
  'wormadam-trash': '도롱마담 슈레도롱',
  'shaymin-sky': '쉐이미 스카이폼',
  'giratina-origin': '기라티나 오리진폼',
  'rotom-heat': '히트로토무',
  'rotom-wash': '워시로토무',
  'rotom-frost': '프로스트로토무',
  'rotom-fan': '스핀로토무',
  'rotom-mow': '커트로토무',
  'kyurem-black': '블랙큐레무',
  'kyurem-white': '화이트큐레무',
  'keldeo-resolute': '케르디오 각오의모습',
  'meloetta-pirouette': '메로엣타 스텝폼',
  'aegislash-blade': '킬가르도 블레이드폼',
  'hoopa-unbound': '후파 굴레를벗어난모습',
  'zygarde-10': '지가르데 10%폼',
  'zygarde-complete': '지가르데 퍼펙트폼',
  'wishiwashi-school': '약어리 군집의모습',
  'necrozma-dusk': '황혼의갈기 네크로즈마',
  'necrozma-dawn': '새벽의날개 네크로즈마',
  'necrozma-ultra': '울트라네크로즈마',
  'toxtricity-low-key': '스트린더 로우한모습',
  'eiscue-noice': '빙큐보 나이스페이스',
  'morpeko-hangry': '모르페코 배고픈모양',
  'zacian-crowned': '자시안 검왕',
  'zamazenta-crowned': '자마젠타 방패왕',
  'urshifu-rapid-strike': '우라오스 연격의태세',
  'calyrex-ice': '버드렉스 백마 탄 모습',
  'calyrex-shadow': '버드렉스 흑마 탄 모습',
  'ursaluna-bloodmoon': '다투곰 붉은달',
  'ogerpon-wellspring-mask': '오거폰 우물의가면',
  'ogerpon-hearthflame-mask': '오거폰 화덕의가면',
  'ogerpon-cornerstone-mask': '오거폰 주춧돌의가면',
  'terapagos-terastal': '테라파고스 테라스탈폼',
  'terapagos-stellar': '테라파고스 스텔라폼',
}

const FORM_TOKEN_NAMES = {
  alola: '알로라의 모습',
  galar: '가라르의 모습',
  hisui: '히스이의 모습',
  paldea: '팔데아의 모습',
  mega: '메가진화',
  x: 'X',
  y: 'Y',
  gmax: '거다이맥스',
  female: '암컷',
  male: '수컷',
  origin: '오리진폼',
  therian: '영물폼',
  incarnate: '화신폼',
  school: '군집의 모습',
  zen: '달마모드',
  blade: '블레이드폼',
  shield: '실드폼',
  complete: '퍼펙트폼',
  unbound: '굴레를 벗어난 모습',
  crowned: '왕의 모습',
  rapid: '연격',
  strike: '태세',
  ice: '백마',
  shadow: '흑마',
  combat: '컴뱃종',
  blaze: '블레이즈종',
  aqua: '아쿠아종',
  droopy: '늘어진 모습',
  stretchy: '뻗은 모습',
  curly: '젖힌 모습',
  three: '세 마리 가족',
  segment: '마디',
  artisan: '진품폼',
  masterpiece: '걸작폼',
}

const cleanText = (value = '') => value.replace(/[\n\f\r]+/g, ' ').replace(/\s+/g, ' ').trim()

function idFromUrl(url) {
  return Number(url.match(/\/(\d+)\/?$/)?.[1])
}

function localizedName(names, fallback) {
  return names.find((entry) => entry.language.name === 'ko')?.name
    ?? names.find((entry) => entry.language.name === 'en')?.name
    ?? fallback
}

function formatFallbackName(value) {
  return value
    .split('-')
    .map((token) => FORM_TOKEN_NAMES[token] ?? token.toUpperCase())
    .join(' ')
}

function formDisplayName(species, varietyName) {
  if (FORM_NAME_OVERRIDES[varietyName]) return FORM_NAME_OVERRIDES[varietyName]

  const megaVariant = varietyName.match(/-mega(?:-?([xyz]))?$/)?.[1]?.toUpperCase() ?? ''
  if (megaVariant || varietyName.endsWith('-mega')) return `메가${species.koreanName}${megaVariant}`
  if (varietyName.endsWith('-gmax')) return `거다이맥스 ${species.koreanName}`
  if (varietyName.endsWith('-primal')) return `원시${species.koreanName}`

  const suffix = varietyName.startsWith(`${species.name}-`)
    ? varietyName.slice(species.name.length + 1)
    : varietyName

  return `${species.koreanName} ${formatFallbackName(suffix)}`
}

async function fetchJson(url, attempt = 0) {
  const response = await fetch(url, { headers: { accept: 'application/json' } })

  if (response.ok) return response.json()

  if ((response.status === 429 || response.status >= 500) && attempt < 5) {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 400 * 2 ** attempt))
    return fetchJson(url, attempt + 1)
  }

  throw new Error(`${response.status} ${response.statusText}: ${url}`)
}

async function mapConcurrent(items, worker, concurrency = CONCURRENCY) {
  const results = new Array(items.length)
  let nextIndex = 0

  async function runWorker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex
      nextIndex += 1
      results[currentIndex] = await worker(items[currentIndex], currentIndex)
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runWorker))
  return results
}

function pokemonProfile(pokemon, abilityNames) {
  const statsByName = Object.fromEntries(pokemon.stats.map((entry) => [entry.stat.name, entry.base_stat]))
  const learnsetMoveIds = [...new Set(
    pokemon.moves
      .map((entry) => idFromUrl(entry.move.url))
      .filter(Number.isFinite),
  )].sort((left, right) => left - right)

  return {
    weight: Math.max(1, Number(pokemon.weight) || 1),
    types: pokemon.types
      .slice()
      .sort((left, right) => left.slot - right.slot)
      .map((entry) => TYPE_NAMES[entry.type.name] ?? entry.type.name),
    abilities: pokemon.abilities
      .slice()
      .sort((left, right) => left.slot - right.slot)
      .map((entry) => abilityNames.get(entry.ability.name) ?? entry.ability.name),
    stats: [
      statsByName.hp,
      statsByName.attack,
      statsByName.defense,
      statsByName['special-attack'],
      statsByName['special-defense'],
      statsByName.speed,
    ],
    learnsetMoveIds,
  }
}

function buildRoutes(species, forms) {
  const childrenByParent = new Map()
  const speciesById = new Map(species.map((entry) => [entry.id, entry]))

  for (const entry of species) {
    if (!entry.evolvesFrom) continue
    const children = childrenByParent.get(entry.evolvesFrom) ?? []
    children.push(entry.id)
    childrenByParent.set(entry.evolvesFrom, children)
  }

  const formsBySpecies = forms.reduce((map, form) => {
    const entries = map.get(form.parentSpeciesId) ?? []
    entries.push(form.id)
    map.set(form.parentSpeciesId, entries)
    return map
  }, new Map())

  const orderedSpeciesIds = (rootId) => {
    const ordered = []
    const visit = (speciesId) => {
      ordered.push(speciesId)
      const children = (childrenByParent.get(speciesId) ?? []).slice().sort((left, right) => left - right)
      children.forEach(visit)
    }
    visit(rootId)
    return ordered
  }

  return species
    .filter((entry) => !entry.evolvesFrom || !speciesById.has(entry.evolvesFrom))
    .map((root) => {
      const speciesIds = orderedSpeciesIds(root.id)
      const profileIds = speciesIds.flatMap((speciesId) => [
        speciesId,
        ...(formsBySpecies.get(speciesId) ?? []).slice().sort((left, right) => left - right),
      ])
      return { speciesIds, profileIds }
    })
}

async function main() {
  const speciesResource = await fetchJson(`${API_ROOT}/pokemon-species?limit=2000`)
  const speciesDetails = await mapConcurrent(
    speciesResource.results,
    (entry) => fetchJson(entry.url),
  )

  const pokemonUrls = [...new Set(speciesDetails.flatMap((entry) => entry.varieties.map((variety) => variety.pokemon.url)))]
  const pokemonDetails = await mapConcurrent(pokemonUrls, fetchJson)
  const pokemonByUrl = new Map(pokemonUrls.map((url, index) => [url, pokemonDetails[index]]))
  const abilityUrls = [...new Set(pokemonDetails.flatMap((pokemon) => pokemon.abilities.map((entry) => entry.ability.url)))]
  const abilityDetails = await mapConcurrent(abilityUrls, fetchJson)
  const abilityNames = new Map()
  const abilities = {}

  for (const ability of abilityDetails) {
    const name = localizedName(ability.names, ability.name)
    const flavorEntries = ability.flavor_text_entries.filter((entry) => entry.language.name === 'ko')
    const description = cleanText(flavorEntries.at(-1)?.flavor_text)
      || `${name}의 조건을 만족하면 배틀 중 효과가 발동한다.`
    abilityNames.set(ability.name, name)
    abilities[name] = { trigger: '조건 충족 시', description }
  }

  for (const ability of Object.values(ZA_MEGA_ABILITY_OVERRIDES)) {
    abilities[ability.name] = {
      trigger: ability.trigger,
      description: ability.description,
    }
  }
  const species = speciesDetails.map((entry) => {
    const defaultVariety = entry.varieties.find((variety) => variety.is_default) ?? entry.varieties[0]
    const pokemon = pokemonByUrl.get(defaultVariety.pokemon.url)
    const koreanName = localizedName(entry.names, entry.name)

    return {
      id: entry.id,
      slug: entry.name,
      name: koreanName,
      generation: GENERATION_NUMBERS[entry.generation.name] ?? null,
      evolvesFrom: entry.evolves_from_species ? idFromUrl(entry.evolves_from_species.url) : null,
      isLegendary: entry.is_legendary,
      isMythical: entry.is_mythical,
      ...pokemonProfile(pokemon, abilityNames),
    }
  })

  const speciesById = new Map(species.map((entry) => [entry.id, entry]))
  const forms = speciesDetails.flatMap((entry) => {
    const baseSpecies = speciesById.get(entry.id)

    return entry.varieties
      .filter((variety) => (
        !variety.is_default
        && !ZA_MEGA_UNAVAILABLE_FORM_SLUGS.has(variety.pokemon.name)
      ))
      .map((variety) => {
        const pokemon = pokemonByUrl.get(variety.pokemon.url)
        const zaMegaForm = getZaMegaForm(pokemon.name)
        const zaAbilityOverride = ZA_MEGA_ABILITY_OVERRIDES[pokemon.name]
        const profile = pokemonProfile(pokemon, abilityNames)

        if (zaAbilityOverride) {
          profile.abilities = [zaAbilityOverride.name]
        }

        return {
          id: pokemon.id,
          parentSpeciesId: entry.id,
          slug: pokemon.name,
          name: zaMegaForm?.name
            ?? formDisplayName({ name: entry.name, koreanName: baseSpecies.name }, pokemon.name),
          generation: baseSpecies.generation,
          isLegendary: baseSpecies.isLegendary,
          isMythical: baseSpecies.isMythical,
          ...profile,
          ...(zaMegaForm ? {
            isZaMega: true,
            introducedIn: 'Pokémon Legends: Z-A',
            requiredItemId: zaMegaForm.stone.id,
          } : {}),
        }
      })
  })

  const generatedZaMegaForms = new Set(forms.filter((entry) => entry.isZaMega).map((entry) => entry.slug))
  const missingZaMegaForms = [...ZA_MEGA_FORM_SLUGS].filter((slug) => !generatedZaMegaForms.has(slug))
  if (missingZaMegaForms.length > 0) {
    throw new Error(`Missing Pokémon Legends: Z-A Mega forms: ${missingZaMegaForms.join(', ')}`)
  }

  const output = {
    generatedAt: new Date().toISOString(),
    learnsetSource: `${API_ROOT}/pokemon`,
    learnsetScope: 'all-version-groups',
    speciesCount: species.length,
    formCount: forms.length,
    species,
    forms,
    routes: buildRoutes(species, forms),
    abilities,
  }

  await mkdir(dirname(OUTPUT_PATH), { recursive: true })
  await writeFile(OUTPUT_PATH, `${JSON.stringify(output)}\n`, 'utf8')
  process.stdout.write(`Generated ${species.length} species, ${forms.length} forms, and ${Object.keys(abilities).length} abilities.\n`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
