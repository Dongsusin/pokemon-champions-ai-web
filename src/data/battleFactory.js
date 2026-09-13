import { TRAINERS } from './trainerTeams.js'
import {
  getGigantamaxProfile,
  getMove,
  getSpeciesProfile,
  isSavablePokemonForm,
  normalizePokemon,
  resolveMoveForPokemon,
} from './trainingData.js'
import { getBattleTeraType } from './battleEngine.js'
import { getBattleItem } from './shopData.js'
import {
  BATTLE_FORMATS,
  BATTLE_GIMMICK_RESTRICTIONS,
  BATTLE_TERRAINS,
  BATTLE_WEATHERS,
  normalizeAiBattleDifficulty,
} from './battleRules.js'

export const FACTORY_TRAINER = Object.freeze({
  id: 'factory-clown',
  name: '팩토리 삐에로',
  tier: 'B',
  region: 'battle-factory',
  specialties: [],
})

export const FACTORY_RENTAL_COUNT = 6
export const FACTORY_PARTY_SIZE = 3

const clone = (value) => structuredClone(value)
const speciesKey = (pokemon) => Number(pokemon.dexSpeciesId ?? pokemon.speciesId)
const fail = (code, message) => {
  const error = new Error(message)
  error.code = code
  throw error
}

function assertPhase(run, phase) {
  if (!run || run.phase !== phase) fail('FACTORY_PHASE', '현재 단계에서는 이 행동을 할 수 없습니다.')
}

function seedValue(seed) {
  const text = String(seed)
  let value = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    value = Math.imul(value ^ text.charCodeAt(index), 16777619) >>> 0
  }
  return value
}

function randomSeed() {
  const values = new Uint32Array(1)
  if (globalThis.crypto?.getRandomValues) return globalThis.crypto.getRandomValues(values)[0]
  return Math.floor(Math.random() * 4294967296)
}

function randomStream(seed) {
  let value = seed >>> 0
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0
    return value / 4294967296
  }
}

// Species are sampled uniformly; trainers with many repeated teams do not make
// their signature Pokemon disproportionately common in the rental selection.
let rentalPool
function getRentalPool() {
  if (rentalPool) return rentalPool
  const bySpecies = new Map()
  for (const trainer of TRAINERS) {
    for (const team of trainer.teams) {
      for (const pokemon of team.pokemon) {
        const profile = getSpeciesProfile(pokemon.speciesId)
        if (!profile || !isSavablePokemonForm(profile)) continue
        const key = Number(profile.parentSpeciesId ?? profile.id)
        if (!bySpecies.has(key)) bySpecies.set(key, new Map())
        const signature = JSON.stringify([
          pokemon.speciesId, pokemon.ability, pokemon.nature,
          pokemon.moves, pokemon.heldItemId, pokemon.teraType,
          pokemon.trainingPoints, pokemon.dynamaxMode,
        ])
        if (bySpecies.get(key).has(signature)) continue
        bySpecies.get(key).set(signature, {
          pokemon,
          gimmicks: (team.battleGimmicks ?? []).filter((gimmick) => (
            gimmick.pokemonSlug === pokemon.slug
              || gimmick.pokemonName === pokemon.name
          )),
        })
      }
    }
  }
  rentalPool = [...bySpecies.values()].map((sets) => [...sets.values()])
  return rentalPool
}

function sampleRentals(seed, count, capturePrefix) {
  const random = randomStream(seed)
  // Keep type rolls independent of species/set rolls and stable for this rental.
  const teraRandom = randomStream(seedValue(`${seed}:tera`))
  const pool = [...getRentalPool()]
  if (pool.length < count) fail('FACTORY_POOL', '렌탈 포켓몬을 준비하지 못했습니다.')
  const selected = []
  for (let index = 0; index < count; index += 1) {
    const chosenIndex = index + Math.floor(random() * (pool.length - index))
    ;[pool[index], pool[chosenIndex]] = [pool[chosenIndex], pool[index]]
    const sets = pool[index]
    const { pokemon, gimmicks } = sets[Math.floor(random() * sets.length)]
    const item = getBattleItem(pokemon.heldItemId)
    const entry = normalizePokemon({
      captureId: `${capturePrefix}:${index + 1}`,
      speciesId: pokemon.speciesId,
      ability: pokemon.ability,
      nature: pokemon.nature,
      moves: [...pokemon.moves],
      hiddenPowerType: pokemon.hiddenPowerType,
      hiddenPowerTypeConfigured: pokemon.hiddenPowerTypeConfigured,
      trainingPoints: { ...pokemon.trainingPoints },
      heldItemId: item?.id ?? '',
      heldItemName: item?.name ?? '',
      teraType: pokemon.teraType,
      dynamaxMode: pokemon.dynamaxMode,
      battleMechanics: [...(pokemon.battleMechanics ?? [])],
      role: pokemon.role ?? '',
    })
    const moveTypes = [...new Set(entry.moves.map((name) => resolveMoveForPokemon(getMove(name), entry).type))]
    const teraType = getBattleTeraType({
      ...entry,
      teraType: moveTypes[Math.floor(teraRandom() * moveTypes.length)],
      // Dedicated species keep the same fixed Tera type as the battle engine.
      battleBaseSpeciesId: entry.dexSpeciesId,
    })
    const gigantamaxForm = getGigantamaxProfile(entry.speciesId)
    const dynamaxMode = gigantamaxForm ? 'gigantamax' : 'dynamax'
    selected.push({
      ...entry,
      teraType,
      dynamaxMode,
      battleMechanics: entry.battleMechanics.map((mechanic) => (
        mechanic === 'gigantamax' || mechanic === 'dynamax' ? dynamaxMode : mechanic
      )),
      // Rebuild IDs after normalization so an illegal source slot cannot take
      // precedence over the corrected move names inside the battle engine.
      moveIds: entry.moves.map((name) => getMove(name).id),
      factoryGimmicks: clone(gimmicks).map((gimmick) => {
        if (gimmick.type === 'terastallization') return { ...gimmick, teraType }
        if (gigantamaxForm && (gimmick.type === 'dynamax' || gimmick.type === 'gigantamax')) {
          return {
            ...gimmick,
            type: 'gigantamax',
            label: '거다이맥스',
            targetFormId: gigantamaxForm.id,
            targetFormSlug: gigantamaxForm.slug,
            targetFormName: gigantamaxForm.formName ?? gigantamaxForm.name,
          }
        }
        return gimmick
      }),
      rental: true,
    })
  }
  return selected
}

function createRules(id) {
  return {
    id,
    weather: { ...BATTLE_WEATHERS.find((entry) => entry.id === 'clear') },
    terrain: { ...BATTLE_TERRAINS.find((entry) => entry.id === 'neutral') },
    format: { ...BATTLE_FORMATS.find((entry) => entry.id === 'single') },
    teamRule: { id: 'full', label: '3대3', shortLabel: '3대3', battleSize: FACTORY_PARTY_SIZE },
    disabledGimmickId: null,
    gimmickRestriction: { ...BATTLE_GIMMICK_RESTRICTIONS.find((entry) => entry.id === null) },
    aiDifficulty: normalizeAiBattleDifficulty('normal'),
  }
}

function createOpponentTeam(run, floor) {
  const pokemon = sampleRentals(
    seedValue(`${run.seed}:floor:${floor}`),
    FACTORY_PARTY_SIZE,
    `${run.id}:floor:${floor}:opponent`,
  )
  return {
    number: floor,
    pokemon,
    battleGimmicks: pokemon.flatMap((entry) => clone(entry.factoryGimmicks)),
    strategy: { lead: pokemon[0].name, summary: '렌탈 포켓몬 3마리로 도전자에게 맞섭니다.' },
  }
}

function assertDistinctParty(party) {
  if (party.length !== FACTORY_PARTY_SIZE || new Set(party.map(speciesKey)).size !== FACTORY_PARTY_SIZE) {
    fail('FACTORY_DUPLICATE_SPECIES', '같은 도감 번호의 포켓몬은 함께 출전할 수 없습니다.')
  }
}

export function createFactoryRun({ seed = randomSeed(), id } = {}) {
  const normalizedSeed = seedValue(seed)
  const runId = id ?? `factory-${Date.now()}-${normalizedSeed.toString(36)}`
  return {
    version: 1,
    id: runId,
    seed: normalizedSeed,
    phase: 'selection',
    floor: 1,
    wins: 0,
    offers: sampleRentals(normalizedSeed, FACTORY_RENTAL_COUNT, `${runId}:rental`),
    party: [],
    leadCaptureId: null,
    opponentTeam: null,
    previousOpponent: [],
    rules: createRules(`${runId}:rules`),
    battleId: null,
    completedBattleIds: [],
    lastResult: null,
    lastExchange: null,
  }
}

export function selectFactoryRentals(run, captureIds) {
  assertPhase(run, 'selection')
  if (!Array.isArray(captureIds) || captureIds.length !== FACTORY_PARTY_SIZE
    || new Set(captureIds).size !== FACTORY_PARTY_SIZE) {
    fail('FACTORY_SELECTION', '렌탈 포켓몬 6마리 중 서로 다른 3마리를 선택해 주세요.')
  }
  const party = captureIds.map((captureId) => run.offers.find((entry) => entry.captureId === captureId))
  if (party.some((entry) => !entry)) fail('FACTORY_SELECTION', '이번 도전에서 제시된 포켓몬만 선택할 수 있습니다.')
  assertDistinctParty(party)
  return { ...run, phase: 'ready', party: clone(party), leadCaptureId: null, opponentTeam: createOpponentTeam(run, run.floor) }
}

export function selectFactoryLead(run, captureId) {
  assertPhase(run, 'ready')
  if (!run.party.some((pokemon) => pokemon.captureId === captureId)) {
    fail('FACTORY_LEAD', '현재 렌탈 팀에서 선봉 포켓몬 1마리를 선택해 주세요.')
  }
  return run.leadCaptureId === captureId ? run : { ...run, leadCaptureId: captureId }
}

export function beginFactoryBattle(run) {
  if (run?.phase === 'battle') return run
  assertPhase(run, 'ready')
  assertDistinctParty(run.party)
  const lead = run.party.find((pokemon) => pokemon.captureId === run.leadCaptureId)
  if (!lead) fail('FACTORY_LEAD', '배틀을 시작하기 전에 선봉 포켓몬을 선택해 주세요.')
  if (run.opponentTeam?.pokemon?.length !== FACTORY_PARTY_SIZE) {
    fail('FACTORY_OPPONENT', '상대 포켓몬 3마리를 준비하지 못했습니다.')
  }
  return {
    ...run,
    phase: 'battle',
    party: clone([lead, ...run.party.filter((pokemon) => pokemon.captureId !== lead.captureId)]),
    battleId: `${run.id}:floor:${run.floor}`,
  }
}

export function resolveFactoryBattle(run, { battleId, winner, forfeited = false } = {}) {
  // BattleScreen can deliver the same completed result again after a render.
  // An older floor's callback must never settle or stop the new floor's battle.
  if (battleId && run?.completedBattleIds.includes(battleId)) return run
  assertPhase(run, 'battle')
  if (!battleId || battleId !== run.battleId) fail('FACTORY_BATTLE_ID', '현재 층의 배틀 결과만 반영할 수 있습니다.')
  if (!['player', 'opponent', 'draw'].includes(winner)) fail('FACTORY_RESULT', '배틀이 끝난 뒤 다음 단계로 이동할 수 있습니다.')
  const won = winner === 'player' && !forfeited
  return {
    ...run,
    phase: won ? 'exchange' : 'finished',
    wins: run.wins + Number(won),
    previousOpponent: won ? clone(run.opponentTeam.pokemon) : [],
    completedBattleIds: [...run.completedBattleIds, battleId],
    lastResult: { battleId, winner, forfeited: Boolean(forfeited), won, floor: run.floor },
  }
}

export function advanceFactoryFloor(run, exchange = null) {
  assertPhase(run, 'exchange')
  let party = run.party
  if (exchange !== null) {
    const giveIndex = party.findIndex((entry) => entry.captureId === exchange?.giveCaptureId)
    const incoming = run.previousOpponent.find((entry) => entry.captureId === exchange?.takeCaptureId)
    if (giveIndex < 0 || !incoming) {
      fail('FACTORY_EXCHANGE', '아군 1마리와 바로 이전 상대의 포켓몬 1마리를 선택해 주세요.')
    }
    party = party.map((entry, index) => index === giveIndex ? incoming : entry)
  }
  assertDistinctParty(party)
  const floor = run.floor + 1
  return {
    ...run,
    phase: 'ready',
    floor,
    // These are original rental loadouts, never the mutable battle snapshots.
    // createBattle restores HP, PP, status, items and gimmicks for the new floor.
    party: clone(party),
    leadCaptureId: null,
    opponentTeam: createOpponentTeam(run, floor),
    previousOpponent: [],
    battleId: null,
    lastExchange: exchange === null ? null : { ...exchange },
  }
}
