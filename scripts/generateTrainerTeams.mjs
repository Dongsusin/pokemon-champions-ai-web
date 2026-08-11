import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  EXPECTED_TRAINERS_BY_TIER,
  TRAINER_BLUEPRINTS,
} from './trainerTeamBlueprints.mjs'
import {
  LEGENDARY_ASSOCIATIONS,
  mechanicPreferencesFor,
} from './trainerBattleRules.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const pokemonDataPath = path.join(rootDir, 'src', 'data', 'generatedPokemonData.json')
const outputPath = path.join(rootDir, 'src', 'data', 'generatedTrainerTeams.json')
const pokemonData = JSON.parse(fs.readFileSync(pokemonDataPath, 'utf8'))

const words = (value = '') => Array.isArray(value) ? value : value.trim().split(/\s+/).filter(Boolean)
const unique = (values) => [...new Set(values.filter(Boolean))]

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

const CURRENT_USAGE_ORDER = words(`
  garchomp corviknight samurott-hisui slowking-galar kingambit rotom-wash dragapult
  excadrill glimmora hatterene meowscarada archaludon pelipper aegislash annihilape
  dragonite volcarona ceruledge hippowdon sneasler hydreigon blaziken basculegion
  clefable primarina quaquaval scizor toxapex skeledirge gholdengo great-tusk
  iron-hands baxcalibur ninetales-alola rillaboom amoonguss heatran zapdos
`)

const TYPE_POOLS = {
  normal: words('snorlax blissey ursaluna maushold porygon2 ditto staraptor cyclizar dudunsparce tauros lopunny miltank'),
  fire: words('volcarona ceruledge skeledirge torkoal arcanine blaziken incineroar cinderace talonflame rotom-heat charizard heatran'),
  water: words('samurott-hisui rotom-wash pelipper swampert araquanid basculegion primarina quaquaval toxapex slowking greninja gyarados milotic gastrodon azumarill dondozo'),
  electric: words('raichu rotom-wash iron-hands raging-bolt bellibolt kilowattrel magnezone eelektross toxtricity zapdos electivire ampharos'),
  grass: words('meowscarada rillaboom venusaur serperior amoonguss whimsicott sinistcha hydrapple tsareena breloom ferrothorn decidueye ogerpon'),
  ice: words('baxcalibur chien-pao kyurem ninetales-alola mamoswine weavile cloyster froslass cetitan arctozolt glaceon darmanitan-galar-standard'),
  fighting: words('annihilape sneasler great-tusk iron-hands hawlucha kommo-o lucario urshifu breloom gallade conkeldurr quaquaval blaziken'),
  poison: words('glimmora slowking-galar toxapex sneasler clodsire amoonguss salazzle toxicroak dragalge overqwil nidoking venusaur revavroom'),
  ground: words('garchomp great-tusk excadrill gliscor hippowdon ursaluna landorus-therian ting-lu clodsire gastrodon swampert krookodile mamoswine'),
  flying: words('corviknight dragonite zapdos tornadus landorus-therian gliscor pelipper talonflame hawlucha staraptor kilowattrel skarmory'),
  psychic: words('slowking hatterene iron-crown indeedee armarouge cresselia latios gardevoir alakazam reuniclus farigiraf espathra metagross'),
  bug: words('volcarona scizor araquanid ribombee kleavor lokix heracross forretress slither-wing scolipede galvantula yanmega'),
  rock: words('glimmora tyranitar garganacl iron-thorns lycanroc-dusk aerodactyl rhyperior diancie coalossal tyrantrum crustle archeops'),
  ghost: words('dragapult aegislash annihilape ceruledge gholdengo skeledirge sinistcha mimikyu gengar chandelure sableye spiritomb basculegion'),
  dragon: words('garchomp dragapult archaludon dragonite roaring-moon raging-bolt baxcalibur hydreigon kommo-o goodra salamence latios'),
  dark: words('kingambit samurott-hisui meowscarada roaring-moon ting-lu chien-pao greninja mandibuzz weavile hydreigon grimmsnarl krookodile incineroar'),
  steel: words('corviknight kingambit excadrill archaludon aegislash gholdengo iron-treads heatran scizor skarmory metagross magnezone tinkaton ferrothorn'),
  fairy: words('hatterene clefable primarina iron-valiant enamorus flutter-mane ninetales-alola grimmsnarl sylveon gardevoir tinkaton azumarill diancie'),
}

const REGION_POOLS = {
  kanto: words('venusaur charizard blastoise pikachu raichu clefable ninetales alakazam machamp gengar exeggutor gyarados lapras snorlax dragonite'),
  johto: words('meganium typhlosion feraligatr crobat ampharos azumarill umbreon scizor heracross kingdra donphan tyranitar'),
  hoenn: words('sceptile blaziken swampert gardevoir breloom aggron manectric flygon altaria milotic salamence metagross'),
  sinnoh: words('torterra infernape empoleon staraptor luxray roserade gastrodon mismagius honchkrow garchomp lucario togekiss'),
  unova: words('serperior emboar samurott excadrill krookodile darmanitan scrafty cofagrigus galvantula chandelure haxorus hydreigon volcarona'),
  kalos: words('chesnaught delphox greninja talonflame vivillon florges pangoro aegislash dragalge tyrantrum sylveon goodra'),
  alola: words('decidueye incineroar primarina vikavolt lycanroc toxapex mudsdale araquanid lurantis salazzle mimikyu kommo-o'),
  galar: words('rillaboom cinderace inteleon corviknight orbeetle drednaw coalossal flapple sandaconda toxtricity centiskorch hatterene grimmsnarl dragapult'),
  hisui: words('wyrdeer kleavor ursaluna basculegion sneasler overqwil enamorus arcanine-hisui decidueye-hisui samurott-hisui typhlosion-hisui goodra-hisui'),
  paldea: words('meowscarada skeledirge quaquaval pawmot arboliva garganacl ceruledge bellibolt mabosstiff tinkaton palafin cyclizar baxcalibur gholdengo'),
  za: words('meganium emboar feraligatr talonflame pyroar floette pangoro aegislash dragalge tyrantrum sylveon goodra hawlucha zygarde'),
  anime: words('pikachu charizard sceptile infernape greninja lucario dragonite gengar corviknight garchomp rotom-wash sylveon'),
  international: words('arcanine lucario crobat alakazam rotom-wash corviknight garchomp umbreon snorlax dragonite'),
}

const SYNERGY_POOLS = {
  normal: words('corviknight gholdengo rotom-wash clefable garchomp dragapult'),
  fire: words('torkoal venusaur great-tusk walking-wake roaring-moon hatterene'),
  water: words('pelipper archaludon basculegion ferrothorn zapdos amoonguss'),
  electric: words('pelipper iron-hands garchomp corviknight ferrothorn dragapult'),
  grass: words('torkoal heatran sneasler rotom-wash corviknight garchomp'),
  ice: words('ninetales-alola baxcalibur slowking corviknight rotom-wash heatran'),
  fighting: words('gholdengo corviknight rotom-wash dragapult glimmora clefable'),
  poison: words('corviknight kingambit rotom-wash garchomp dragapult clefable'),
  ground: words('tyranitar excadrill corviknight rotom-wash gastrodon garchomp'),
  flying: words('rotom-wash garchomp kingambit clefable gholdengo dragonite'),
  psychic: words('indeedee hatterene ursaluna torkoal amoonguss kingambit'),
  bug: words('glimmora gholdengo rotom-wash corviknight garchomp clefable'),
  rock: words('tyranitar excadrill corviknight rotom-wash gastrodon garchomp'),
  ghost: words('kingambit glimmora corviknight rotom-wash clefable garchomp'),
  dragon: words('corviknight gholdengo primarina rotom-wash glimmora kingambit'),
  dark: words('glimmora corviknight rotom-wash clefable garchomp dragapult'),
  steel: words('rotom-wash garchomp dragapult clefable glimmora amoonguss'),
  fairy: words('indeedee hatterene ursaluna torkoal amoonguss corviknight'),
}

const DEFAULT_SYNERGY_POOL = words('corviknight rotom-wash garchomp clefable kingambit dragapult glimmora hatterene amoonguss')
const allPokemon = [...pokemonData.species, ...pokemonData.forms]
const pokemonBySlug = new Map(allPokemon.map((pokemon) => [pokemon.slug, pokemon]))

function hashText(value) {
  let hash = 2166136261

  for (const character of value) {
    hash ^= character.codePointAt(0)
    hash = Math.imul(hash, 16777619)
  }

  return hash >>> 0
}

function rotate(values, amount) {
  if (values.length === 0) return []
  const offset = ((amount % values.length) + values.length) % values.length
  return [...values.slice(offset), ...values.slice(0, offset)]
}

function resolvePokemon(slug) {
  const pokemon = pokemonBySlug.get(slug)
  if (!pokemon) throw new Error(`Unknown Pokemon slug: ${slug}`)
  return pokemon
}

function pokemonDexId(pokemon) {
  return pokemon.parentSpeciesId ?? pokemon.id
}

function hasProfileType(slug, profileTypes) {
  if (profileTypes.length === 0) return true
  const pokemon = resolvePokemon(slug)
  const desiredTypes = profileTypes.map((type) => TYPE_LABELS[type])
  return pokemon.types.some((type) => desiredTypes.includes(type))
}

function competitivePool(profile) {
  if (profile.types.length === 0) return CURRENT_USAGE_ORDER
  return CURRENT_USAGE_ORDER.filter((slug) => hasProfileType(slug, profile.types))
}

function specialistPool(profile) {
  return unique(profile.types.flatMap((type) => TYPE_POOLS[type] ?? []))
}

function synergyPool(profile) {
  return unique([
    ...profile.support,
    ...profile.types.flatMap((type) => SYNERGY_POOLS[type] ?? []),
    ...DEFAULT_SYNERGY_POOL,
  ])
}

function addPokemon(team, usedDexIds, slug) {
  const pokemon = resolvePokemon(slug)
  const dexId = pokemonDexId(pokemon)
  if (usedDexIds.has(dexId)) return
  usedDexIds.add(dexId)
  team.push(pokemon)
}

function assembleTeam(candidates) {
  const team = []
  const usedDexIds = new Set()

  for (const slug of candidates) {
    addPokemon(team, usedDexIds, slug)
    if (team.length === 6) break
  }

  if (team.length !== 6) {
    throw new Error(`Could not assemble a six-Pokemon team from: ${candidates.join(', ')}`)
  }

  return team
}

function isLegendaryPokemon(pokemon) {
  return pokemon.isLegendary || pokemon.isMythical
}

function applyLegendaryRule(profile, variant, team, candidates) {
  const association = LEGENDARY_ASSOCIATIONS[profile.name]
  const selectedLegendary = association
    ? resolvePokemon(association.pokemon[variant % association.pokemon.length])
    : null
  const adjustedTeam = []
  const usedDexIds = new Set()
  const addResolvedPokemon = (pokemon) => {
    if (adjustedTeam.length >= 6) return
    const dexId = pokemonDexId(pokemon)
    if (usedDexIds.has(dexId)) return
    usedDexIds.add(dexId)
    adjustedTeam.push(pokemon)
  }
  const regularPokemon = (pokemon) => !isLegendaryPokemon(pokemon)

  if (team[0] && regularPokemon(team[0])) addResolvedPokemon(team[0])
  if (selectedLegendary) addResolvedPokemon(selectedLegendary)
  team.filter(regularPokemon).forEach(addResolvedPokemon)

  for (const slug of candidates) {
    const pokemon = resolvePokemon(slug)
    if (regularPokemon(pokemon)) addResolvedPokemon(pokemon)
    if (adjustedTeam.length >= 6) break
  }

  for (const pokemon of pokemonData.species) {
    if (regularPokemon(pokemon)) addResolvedPokemon(pokemon)
    if (adjustedTeam.length >= 6) break
  }

  if (adjustedTeam.length !== 6) {
    throw new Error(`Could not apply the legendary rule to ${profile.name} team ${variant + 1}.`)
  }

  return adjustedTeam
}

function buildTrainerTeam(profile, variant) {
  const seed = hashText(`${profile.tier}:${profile.name}`)
  const ace = profile.ace
  const canon = profile.canon.filter((slug) => slug !== ace)
  const rotatedCanon = rotate(canon, seed + variant * 2)
  const competitive = rotate(competitivePool(profile), seed + variant * 3)
  const specialist = rotate(specialistPool(profile), seed + variant * 5)
  const regional = rotate(REGION_POOLS[profile.region] ?? REGION_POOLS.international, seed + variant * 7)
  const synergy = rotate(synergyPool(profile), seed + variant * 11)
  let candidates

  if (variant === 0) {
    candidates = [ace, ...rotatedCanon, ...competitive, ...specialist, ...profile.support, ...regional, ...DEFAULT_SYNERGY_POOL]
  } else if (variant === 1) {
    candidates = [ace, ...rotatedCanon.slice(0, 2), ...competitive, ...specialist, ...profile.support, ...regional, ...synergy]
  } else {
    candidates = [ace, ...rotatedCanon.slice(2, 4), ...profile.support, ...synergy, ...competitive, ...specialist, ...regional]
  }

  return applyLegendaryRule(profile, variant, assembleTeam(candidates), candidates)
}

function toPokemonSlot(pokemon) {
  return {
    dexSpeciesId: pokemonDexId(pokemon),
    speciesId: pokemon.id,
    slug: pokemon.slug,
    name: pokemon.name,
  }
}

function validateBlueprints() {
  const seenNames = new Set()

  for (const [tier, expectedNames] of Object.entries(EXPECTED_TRAINERS_BY_TIER)) {
    const actualNames = TRAINER_BLUEPRINTS.filter((profile) => profile.tier === tier).map((profile) => profile.name)
    if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
      throw new Error(`${tier} tier trainer order does not match the requested roster.`)
    }
  }

  for (const profile of TRAINER_BLUEPRINTS) {
    if (seenNames.has(profile.name)) throw new Error(`Duplicate trainer: ${profile.name}`)
    seenNames.add(profile.name)

    if (!profile.ace) throw new Error(`Trainer has no ace: ${profile.name}`)
    if (profile.types.some((type) => !TYPE_LABELS[type])) {
      throw new Error(`Trainer has an unknown type: ${profile.name}`)
    }

    for (const slug of unique([profile.ace, ...profile.canon, ...profile.support])) {
      resolvePokemon(slug)
    }

    const association = LEGENDARY_ASSOCIATIONS[profile.name]
    if (association) {
      if (!association.relation || association.pokemon.length === 0) {
        throw new Error(`Trainer has an incomplete legendary association: ${profile.name}`)
      }

      for (const slug of association.pokemon) {
        const pokemon = resolvePokemon(slug)
        if (!isLegendaryPokemon(pokemon)) {
          throw new Error(`${profile.name} is associated with a non-legendary Pokemon: ${slug}`)
        }
      }
    }
  }

  const trainerNames = new Set(TRAINER_BLUEPRINTS.map((profile) => profile.name))
  for (const trainerName of Object.keys(LEGENDARY_ASSOCIATIONS)) {
    if (!trainerNames.has(trainerName)) throw new Error(`Unknown legendary association trainer: ${trainerName}`)
  }

  const sharedPools = [
    CURRENT_USAGE_ORDER,
    ...Object.values(TYPE_POOLS),
    ...Object.values(REGION_POOLS),
    ...Object.values(SYNERGY_POOLS),
    DEFAULT_SYNERGY_POOL,
  ]

  for (const slug of unique(sharedPools.flat())) resolvePokemon(slug)
}

function validateGeneratedData(data) {
  if (data.trainers.length !== 238) throw new Error(`Expected 238 trainers, received ${data.trainers.length}`)

  const teamSignatures = new Set()
  for (const trainerEntry of data.trainers) {
    if (trainerEntry.teams.length !== 3) throw new Error(`${trainerEntry.name} does not have three teams.`)

    for (const team of trainerEntry.teams) {
      if (team.pokemon.length !== 6) throw new Error(`${trainerEntry.name} team ${team.number} is not full.`)
      if (new Set(team.pokemon.map((pokemon) => pokemon.dexSpeciesId)).size !== 6) {
        throw new Error(`${trainerEntry.name} team ${team.number} contains a duplicate species.`)
      }

      const signature = team.pokemon.map((pokemon) => pokemon.slug).sort().join('|')
      const trainerSignature = `${trainerEntry.name}:${signature}`
      if (teamSignatures.has(trainerSignature)) {
        throw new Error(`${trainerEntry.name} has duplicate team compositions.`)
      }
      teamSignatures.add(trainerSignature)

      const association = LEGENDARY_ASSOCIATIONS[trainerEntry.name]
      const legendaryPokemon = team.pokemon.filter((slot) => isLegendaryPokemon(resolvePokemon(slot.slug)))
      if (association) {
        if (legendaryPokemon.length !== 1) {
          throw new Error(`${trainerEntry.name} team ${team.number} must contain exactly one legendary or mythical Pokemon.`)
        }
        if (!association.pokemon.includes(legendaryPokemon[0].slug)) {
          throw new Error(`${trainerEntry.name} team ${team.number} contains an unrelated legendary Pokemon.`)
        }
      } else if (legendaryPokemon.length !== 0) {
        throw new Error(`${trainerEntry.name} team ${team.number} contains a legendary Pokemon without an association.`)
      }
    }
  }
}

validateBlueprints()

const trainers = TRAINER_BLUEPRINTS.map((profile, trainerIndex) => {
  const association = LEGENDARY_ASSOCIATIONS[profile.name]
  const ace = resolvePokemon(profile.ace)

  return {
    id: `${profile.tier.toLowerCase()}-${String(trainerIndex + 1).padStart(3, '0')}`,
    name: profile.name,
    alias: profile.alias,
    tier: profile.tier,
    region: profile.region,
    specialties: profile.types.map((type) => TYPE_LABELS[type]),
    ace: toPokemonSlot(ace),
    mechanicPreferences: mechanicPreferencesFor(profile.name, profile.region),
    legendaryAssociation: association
      ? {
          relation: association.relation,
          pokemon: association.pokemon.map((slug) => toPokemonSlot(resolvePokemon(slug))),
        }
      : null,
    teams: [0, 1, 2].map((variant) => ({
      number: variant + 1,
      pokemon: buildTrainerTeam(profile, variant).map(toPokemonSlot),
    })),
  }
})

const tierCounts = Object.fromEntries(Object.keys(EXPECTED_TRAINERS_BY_TIER).map((tier) => [
  tier,
  trainers.filter((trainerEntry) => trainerEntry.tier === tier).length,
]))

const output = {
  generatedAt: new Date().toISOString(),
  method: ['작중 사용 포켓몬', '전문 타입의 대전 사용률', '팀 시너지'],
  competitiveUsageSource: 'https://www.smogon.com/stats/2026-07/gen9championsou-1630.txt',
  trainerCount: trainers.length,
  teamCount: trainers.length * 3,
  slotCount: trainers.length * 3 * 6,
  legendaryTrainerCount: trainers.filter((trainer) => trainer.legendaryAssociation).length,
  legendaryTeamCount: trainers.filter((trainer) => trainer.legendaryAssociation).length * 3,
  tierCounts,
  trainers,
}

validateGeneratedData(output)
fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8')

console.log(`Generated ${output.trainerCount} trainers, ${output.teamCount} teams, and ${output.slotCount} Pokemon slots.`)
console.log(`Wrote ${path.relative(rootDir, outputPath)}`)
