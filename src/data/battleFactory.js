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
import { getFactoryDifficulty, scoreFactorySet, scoreFactoryTeam } from './battleFactoryDifficulty.js'
import {
  BATTLE_FORMATS,
  BATTLE_GIMMICK_RESTRICTIONS,
  BATTLE_TERRAINS,
  BATTLE_WEATHERS,
  normalizeAiBattleDifficulty,
} from './battleRules.js'
import {
  FACTORY_DEFAULT_MODE, FACTORY_TP_ITEM_REROLL_COST, getFactoryHpRatio,
  getFactoryMode, getFactoryPartyHealCost, getFactorySwapCost, getFactoryTpAward,
  isFactoryChallengeMode, isFactoryPokemonFainted, rollFactoryHeldItem, withFactoryHpRatio,
  FACTORY_PARTY_COST_LIMIT, getFactoryPokemonCost, getFactoryPartyCost, hasFactoryCostLimit,
} from './battleFactoryChallenge.js'

export const FACTORY_TRAINER = Object.freeze({
  id: 'factory-clown',
  name: '팩토리 삐에로',
  tier: 'S',
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

function sampleRentals(seed, count, capturePrefix, chosenSets = null) {
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
    const rolledSet = sets[Math.floor(random() * sets.length)]
    const { pokemon, gimmicks } = chosenSets?.[index] ?? rolledSet
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

function createRules(id, floor = 1, mode = FACTORY_DEFAULT_MODE) {
  return {
    id,
    weather: { ...BATTLE_WEATHERS.find((entry) => entry.id === 'clear') },
    terrain: { ...BATTLE_TERRAINS.find((entry) => entry.id === 'neutral') },
    format: { ...BATTLE_FORMATS.find((entry) => entry.id === 'single') },
    teamRule: { id: 'full', label: '3대3', shortLabel: '3대3', battleSize: FACTORY_PARTY_SIZE },
    disabledGimmickId: null,
    gimmickRestriction: { ...BATTLE_GIMMICK_RESTRICTIONS.find((entry) => entry.id === null) },
    aiDifficulty: normalizeAiBattleDifficulty('normal'),
    aiDecisionLevel: 'hard',
    factoryDifficulty: getFactoryDifficulty(floor, mode),
  }
}

let opponentPool
function selectOpponentSets(run, floor) {
  if (!opponentPool) {
    opponentPool = getRentalPool().map(sets => sets.map(entry => ({
      ...entry,
      pokemon: { ...entry.pokemon, factoryGimmicks: entry.gimmicks },
      score: scoreFactorySet(entry.pokemon, entry.gimmicks),
    })).sort((left, right) => right.score - left.score))
      .sort((left, right) => left[0].score - right[0].score)
  }
  const difficulty = getFactoryDifficulty(floor, run.mode)
  const pool = opponentPool.slice(Math.min(opponentPool.length - FACTORY_PARTY_SIZE, Math.floor(opponentPool.length * difficulty.minPercentile)))
  const random = randomStream(seedValue(`${run.seed}:floor:${floor}:team-quality`))
  let bestTeam = null
  let bestScore = -Infinity
  for (let attempt = 0; attempt < difficulty.teamCandidates; attempt += 1) {
    const remaining = [...pool]
    const team = []
    for (let slot = 0; slot < FACTORY_PARTY_SIZE; slot += 1) {
      const [sets] = remaining.splice(Math.floor(random() * remaining.length), 1)
      // Keep several competitive builds per species, but exclude examples
      // substantially weaker than its best singles set even at low floors.
      const viable = sets.filter(set => set.score >= sets[0].score - 30).slice(0, difficulty.setCandidates)
      team.push(viable[Math.floor(random() * viable.length)])
    }
    const score = scoreFactoryTeam(team.map(set => set.pokemon))
    if (score > bestScore) { bestScore = score; bestTeam = team }
  }
  // Fast pressure or a weather setter leads; selection never reads the player party.
  return bestTeam.sort((left, right) => {
    const leadScore = entry => (getSpeciesProfile(entry.pokemon.speciesId)?.stats[5] ?? 0)
      + (['가뭄', '잔비', '모래날림', '눈퍼뜨리기', '일렉트릭메이커', '그래스메이커', '사이코메이커'].includes(entry.pokemon.ability) ? 100 : 0)
    return leadScore(right) - leadScore(left)
  })
}

function createOpponentTeam(run, floor) {
  const pokemon = sampleRentals(
    seedValue(`${run.seed}:floor:${floor}`),
    FACTORY_PARTY_SIZE,
    `${run.id}:floor:${floor}:opponent`,
    selectOpponentSets(run, floor),
  )
  return {
    number: floor,
    pokemon,
    battleGimmicks: pokemon.flatMap((entry) => clone(entry.factoryGimmicks)),
    strategy: { lead: pokemon[0].name, summary: `${getFactoryDifficulty(floor, run.mode).label} 렌탈 팀 · 층별 전력 강화 · 전술 하드` },
  }
}

function assertDistinctParty(party) {
  if (party.length !== FACTORY_PARTY_SIZE || new Set(party.map(speciesKey)).size !== FACTORY_PARTY_SIZE) {
    fail('FACTORY_DUPLICATE_SPECIES', '같은 도감 번호의 포켓몬은 함께 출전할 수 없습니다.')
  }
}

function assertPartyCost(run, party) {
  const cost = getFactoryPartyCost(party)
  if (hasFactoryCostLimit(run) && cost > FACTORY_PARTY_COST_LIMIT) {
    fail('FACTORY_COST', `팀 코스트 ${cost}/${FACTORY_PARTY_COST_LIMIT}: 상한 이하로 포켓몬을 선택해 주세요.`)
  }
}

function createRentalOffers(seed, prefix, mode) {
  const offers = sampleRentals(seed, FACTORY_RENTAL_COUNT, prefix)
  if (!isFactoryChallengeMode(mode)) return offers
  const affordable = () => [...offers].sort((a, b) => getFactoryPokemonCost(a) - getFactoryPokemonCost(b)).slice(0, FACTORY_PARTY_SIZE)
  if (getFactoryPartyCost(affordable()) <= FACTORY_PARTY_COST_LIMIT) return offers
  const random = randomStream(seedValue(`${seed}:budget`))
  const used = new Set(offers.map(speciesKey))
  const budgetPool = getRentalPool().filter(sets => !used.has(speciesKey(sets[0].pokemon)) && getFactoryPokemonCost(sets[0].pokemon) <= 3)
  // Bounded repair only when the six rolls have no legal trio. Keep the other
  // offers intact, including their IDs, and never duplicate a species.
  while (getFactoryPartyCost(affordable()) > FACTORY_PARTY_COST_LIMIT) {
    const [sets] = budgetPool.splice(Math.floor(random() * budgetPool.length), 1)
    if (!sets) fail('FACTORY_POOL', '코스트에 맞는 렌탈 후보를 준비하지 못했습니다.')
    const index = offers.reduce((best, entry, slot) => getFactoryPokemonCost(entry) > getFactoryPokemonCost(offers[best]) ? slot : best, 0)
    const replacement = sampleRentals(seedValue(`${seed}:budget:${index}`), 1, prefix, [sets[Math.floor(random() * sets.length)]])[0]
    offers[index] = { ...replacement, captureId: offers[index].captureId }
  }
  return offers
}

export function createFactoryRun({ seed = randomSeed(), id, mode = FACTORY_DEFAULT_MODE } = {}) {
  const normalizedSeed = seedValue(seed)
  const runId = id ?? `factory-${Date.now()}-${normalizedSeed.toString(36)}`
  return {
    version: 1,
    id: runId,
    seed: normalizedSeed,
    mode: getFactoryMode(mode).id,
    ...(isFactoryChallengeMode(mode) ? { costRulesVersion: 1 } : {}),
    // Challenge mode only. Tower Points are earned by winning and spent on
    // healing, swaps and item rerolls; they never outlive this run.
    towerPoints: 0,
    rerollCount: 0,
    phase: 'selection',
    floor: 1,
    wins: 0,
    offers: createRentalOffers(normalizedSeed, `${runId}:rental`, mode),
    party: [],
    leadCaptureId: null,
    opponentTeam: null,
    previousOpponent: [],
    rules: createRules(`${runId}:rules`, 1, mode),
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
  assertPartyCost(run, party)
  return { ...run, phase: 'ready', party: clone(party), leadCaptureId: null,
    rules: createRules(`${run.id}:rules`, run.floor, run.mode), opponentTeam: createOpponentTeam(run, run.floor) }
}

export function selectFactoryLead(run, captureId) {
  assertPhase(run, 'ready')
  const lead = run.party.find((pokemon) => pokemon.captureId === captureId)
  if (!lead) fail('FACTORY_LEAD', '현재 렌탈 팀에서 선봉 포켓몬 1마리를 선택해 주세요.')
  if (isFactoryChallengeMode(run.mode) && isFactoryPokemonFainted(lead)) {
    fail('FACTORY_LEAD', '기절한 포켓몬은 선봉으로 낼 수 없습니다. TP로 회복한 뒤 선택해 주세요.')
  }
  return run.leadCaptureId === captureId ? run : { ...run, leadCaptureId: captureId }
}

export function beginFactoryBattle(run) {
  if (run?.phase === 'battle') return run
  assertPhase(run, 'ready')
  assertDistinctParty(run.party)
  assertPartyCost(run, run.party)
  const lead = run.party.find((pokemon) => pokemon.captureId === run.leadCaptureId)
  if (!lead) fail('FACTORY_LEAD', '배틀을 시작하기 전에 선봉 포켓몬을 선택해 주세요.')
  if (isFactoryChallengeMode(run.mode) && isFactoryPokemonFainted(lead)) {
    fail('FACTORY_LEAD', '기절한 포켓몬은 선봉으로 낼 수 없습니다. TP로 회복한 뒤 선택해 주세요.')
  }
  if (run.opponentTeam?.pokemon?.length !== FACTORY_PARTY_SIZE) {
    fail('FACTORY_OPPONENT', '상대 포켓몬 3마리를 준비하지 못했습니다.')
  }
  return {
    ...run,
    phase: 'battle',
    rules: createRules(`${run.id}:rules`, run.floor, run.mode),
    party: clone([lead, ...run.party.filter((pokemon) => pokemon.captureId !== lead.captureId)]),
    battleId: `${run.id}:floor:${run.floor}`,
    battleState: null,
  }
}

// Challenge mode carries damage forward, so a win records where every Pokemon
// finished. A Pokemon the battle never reports keeps the health it started with.
function carryPartyHealth(party, playerTeamHp) {
  if (!Array.isArray(playerTeamHp)) return party
  const byCaptureId = new Map(playerTeamHp
    .filter((entry) => entry && typeof entry.captureId === 'string' && Number.isFinite(entry.hp) && entry.maxHp > 0)
    .map((entry) => [entry.captureId, Math.min(1, Math.max(0, entry.hp / entry.maxHp))]))
  return party.map((pokemon) => (
    byCaptureId.has(pokemon.captureId) ? withFactoryHpRatio(pokemon, byCaptureId.get(pokemon.captureId)) : pokemon
  ))
}

export function resolveFactoryBattle(run, { battleId, winner, forfeited = false, playerTeamHp = null } = {}) {
  // BattleScreen can deliver the same completed result again after a render.
  // An older floor's callback must never settle or stop the new floor's battle.
  if (battleId && run?.completedBattleIds.includes(battleId)) return run
  assertPhase(run, 'battle')
  if (!battleId || battleId !== run.battleId) fail('FACTORY_BATTLE_ID', '현재 층의 배틀 결과만 반영할 수 있습니다.')
  if (!['player', 'opponent', 'draw'].includes(winner)) fail('FACTORY_RESULT', '배틀이 끝난 뒤 다음 단계로 이동할 수 있습니다.')
  const won = winner === 'player' && !forfeited
  const challenge = isFactoryChallengeMode(run.mode)
  const award = challenge && won ? getFactoryTpAward(run.floor) : 0
  return {
    ...run,
    phase: won ? 'exchange' : 'finished',
    battleState: null,
    wins: run.wins + Number(won),
    // Losing ends the run, and its Tower Points end with it.
    towerPoints: won ? run.towerPoints + award : 0,
    party: challenge && won ? carryPartyHealth(run.party, playerTeamHp) : run.party,
    previousOpponent: won ? clone(run.opponentTeam.pokemon) : [],
    completedBattleIds: [...run.completedBattleIds, battleId],
    lastResult: {
      battleId, winner, forfeited: Boolean(forfeited), won, floor: run.floor,
      towerPointsEarned: award,
    },
  }
}

export function advanceFactoryFloor(run, exchange = null) {
  assertPhase(run, 'exchange')
  const challenge = isFactoryChallengeMode(run.mode)
  let party = run.party
  let towerPoints = run.towerPoints
  if (exchange !== null) {
    const giveIndex = party.findIndex((entry) => entry.captureId === exchange?.giveCaptureId)
    const incoming = run.previousOpponent.find((entry) => entry.captureId === exchange?.takeCaptureId)
    if (giveIndex < 0 || !incoming) {
      fail('FACTORY_EXCHANGE', '아군 1마리와 바로 이전 상대의 포켓몬 1마리를 선택해 주세요.')
    }
    let replacement = incoming
    if (challenge) {
      const cost = getFactorySwapCost(incoming)
      if (towerPoints < cost) {
        fail('FACTORY_TP', `이 포켓몬으로 교체하려면 TP ${cost}이 필요합니다. 현재 ${towerPoints} TP.`)
      }
      towerPoints -= cost
      // The slot's condition stays with the slot, so a swap is never a free heal.
      replacement = withFactoryHpRatio(incoming, getFactoryHpRatio(party[giveIndex]))
    }
    party = party.map((entry, index) => index === giveIndex ? replacement : entry)
  }
  assertDistinctParty(party)
  assertPartyCost(run, party)
  const floor = run.floor + 1
  return {
    ...run,
    phase: 'ready',
    floor,
    rules: createRules(`${run.id}:rules`, floor, run.mode),
    towerPoints,
    // These are original rental loadouts, never the mutable battle snapshots.
    // In standard mode createBattle restores HP, PP, status, items and gimmicks
    // for the new floor; in challenge mode each slot keeps its recorded health.
    party: clone(party),
    leadCaptureId: null,
    opponentTeam: createOpponentTeam(run, floor),
    previousOpponent: [],
    battleId: null,
    battleState: null,
    lastExchange: exchange === null ? null : { ...exchange },
  }
}

function assertChallengeStandby(run) {
  if (!isFactoryChallengeMode(run?.mode)) fail('FACTORY_MODE', '도전 모드에서만 사용할 수 있습니다.')
  if (!['ready', 'exchange'].includes(run.phase)) {
    fail('FACTORY_PHASE', '배틀 대기 중에만 TP를 사용할 수 있습니다.')
  }
}

function findPartyIndex(run, captureId) {
  const index = run.party.findIndex((entry) => entry.captureId === captureId)
  if (index < 0) fail('FACTORY_PARTY', '현재 렌탈 팀의 포켓몬을 선택해 주세요.')
  return index
}

/**
 * Restores the whole team to full health, fainted members included, for one
 * flat price.
 */
export function healFactoryParty(run) {
  assertChallengeStandby(run)
  const cost = getFactoryPartyHealCost(run.party)
  if (cost === 0) fail('FACTORY_HEAL', '이미 팀 전체의 체력이 가득 찼습니다.')
  if (run.towerPoints < cost) {
    fail('FACTORY_TP', `전체 회복에는 TP ${cost}이 필요합니다. 현재 ${run.towerPoints} TP.`)
  }
  return {
    ...run,
    towerPoints: run.towerPoints - cost,
    party: run.party.map((entry) => withFactoryHpRatio(entry, 1)),
  }
}

/** Trades the held item for a different random one. Health is untouched. */
export function rerollFactoryHeldItem(run, captureId) {
  assertChallengeStandby(run)
  const index = findPartyIndex(run, captureId)
  if (run.towerPoints < FACTORY_TP_ITEM_REROLL_COST) {
    fail('FACTORY_TP', `도구 변경에는 TP ${FACTORY_TP_ITEM_REROLL_COST}이 필요합니다. 현재 ${run.towerPoints} TP.`)
  }
  const random = randomStream(seedValue(`${run.id}:reroll:${run.rerollCount}:${captureId}`))
  const item = rollFactoryHeldItem(random, run.party[index].heldItemId)
  if (!item) fail('FACTORY_ITEM', '변경할 수 있는 도구가 없습니다.')
  return {
    ...run,
    towerPoints: run.towerPoints - FACTORY_TP_ITEM_REROLL_COST,
    rerollCount: run.rerollCount + 1,
    party: run.party.map((entry, entryIndex) => entryIndex === index
      ? { ...entry, heldItemId: item.id, heldItemName: item.name }
      : entry),
  }
}

/** A challenge run cannot start a floor with every Pokemon knocked out. */
export function getFactoryUsableParty(run) {
  if (!isFactoryChallengeMode(run?.mode)) return run?.party ?? []
  return (run.party ?? []).filter((pokemon) => !isFactoryPokemonFainted(pokemon))
}
