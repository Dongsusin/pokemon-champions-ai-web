import assert from 'node:assert/strict'
import {
  ACHIEVEMENTS,
  ACHIEVABLE_SPECIES_IDS,
  ACHIEVABLE_SHINY_SPECIES_IDS,
  applyBattleAchievements,
  applyCollectionAchievements,
  createAchievementState,
  getAchievementProgress,
  normalizeAchievementState,
} from '../src/data/achievementData.js'
import { createCompetition, getCurrentCompetitionMatch, resolveCompetitionMatch } from '../src/data/competitionData.js'
import { POKEMON_POOL, createCompletePokemonCollection, mergePokemonDraws } from '../src/data/pokemonPool.js'
import { NATIONAL_DEX, getEvolutionSpeciesIds } from '../src/data/trainingData.js'

let checks = 0
const check = (title, run) => { run(); checks += 1; console.log(`PASS ${title}`) }
const has = (result, id) => result.unlocked.some((entry) => entry.id === id)
const random = () => 0.4
const summary = (facts = {}, extra = {}) => ({
  winner: 'player', playerRemaining: 3, opponentRemaining: 0, turns: 8,
  achievementFacts: {
    version: 1, completed: true, playerTeamSize: 3, playerFaintCount: 0,
    playerUsedMechanics: ['tera'], formatId: 'single', playerHeldItemCountAtStart: 1,
    playerTeamTypes: [['불꽃'], ['물'], ['풀']], aiDifficultyId: 'normal', aiBoostStage: 0,
    ...facts,
  },
  ...extra,
})

function playCompetition(mode, changes = new Map(), difficulty = 'normal', mutateStart = null) {
  let competition = createCompetition(mode, [], '엘리트 업적 검증', difficulty, random)
  if (mutateStart) competition = mutateStart(competition)
  let progress = createAchievementState()
  const results = []
  for (let index = 0; index < 7 && competition.status === 'active'; index += 1) {
    const match = getCurrentCompetitionMatch(competition)
    const change = changes.get(index) ?? {}
    const battleSummary = summary({ aiDifficultyId: typeof difficulty === 'string' ? difficulty : difficulty.id, ...change.facts }, change.summary)
    if (change.removeFacts) delete battleSummary.achievementFacts
    const before = structuredClone(competition)
    const resolved = resolveCompetitionMatch(competition, battleSummary.winner === 'player', battleSummary, random)
    assert.deepEqual(competition, before, 'Competition resolver must not mutate previous run history')
    const event = {
      battleId: `${competition.id}:${competition.round}:${match.opponent.id}`,
      summary: battleSummary,
      opponent: match.opponent,
      competitionMode: mode,
      competitionChampion: resolved.status === 'complete' && resolved.championId === 'player',
      competitionPerfect: resolved.standings?.player?.wins === 7,
      competitionRun: resolved.achievementRun,
      forfeited: battleSummary.forfeited === true,
    }
    const result = applyBattleAchievements(progress, event, 1000 + index)
    results.push({ result, event })
    progress = result.state
    competition = resolved
  }
  return { competition, progress, results, last: results.at(-1) }
}

check('five elite definitions stay sealed and award the right title, item and VP', () => {
  assert.equal(ACHIEVEMENTS.length, 288)
  const secrets = ACHIEVEMENTS.filter((entry) => entry.secretReward)
  assert.equal(secrets.length, 5)
  assert.deepEqual(secrets.map((entry) => [entry.id, entry.titleId, entry.rewardId, entry.rewardVp]), [
    ['flawless-league', 'unbeaten-commander', null, 100000],
    ['flawless-tournament', 'flawless-champion', null, 100000],
    ['collection-all', 'dex-master', null, 200000],
    ['collection-shiny-all', 'shiny-seeker', null, 400000],
    ['achievements-all', 'champion-proof', 'legend-plate', 600000],
  ])
  const meta = ACHIEVEMENTS.find((entry) => entry.id === 'achievements-all')
  assert.equal(meta.target, ACHIEVEMENTS.length - 1)
  // A sealed goal must not name its own reward before it is earned.
  assert(secrets.every((entry) => [entry.titleId, entry.rewardId].filter(Boolean)
    .every((id) => !`${entry.title} ${entry.description}`.includes(id))))
})

check('normal league and hard tournament require all seven verified flawless rounds', () => {
  for (const [mode, difficulty, id] of [
    ['league', 'normal', 'flawless-league'],
    ['tournament', { id: 'hard', boostStage: 3 }, 'flawless-tournament'],
  ]) {
    const played = playCompetition(mode, new Map(), difficulty)
    assert.equal(played.results.length, 7)
    assert.equal(played.competition.status, 'complete')
    assert.equal(played.competition.championId, 'player')
    assert(played.results.slice(0, -1).every(({ result }) => !has(result, id)))
    assert(has(played.last.result, id))
    assert(played.last.result.rewardVp >= 100000)
    assert.equal(played.competition.achievementRun.completedRounds, 7)
    assert.equal(played.competition.achievementRun.wins, 7)
    assert.equal(played.competition.achievementRun.totalPlayerFaints, 0)
    const replay = applyBattleAchievements(played.progress, played.last.event, 2000)
    assert.equal(replay.processed, false)
    assert.equal(replay.rewardVp, 0)
  }
})

check('early or final fainting, including revival with every Pokemon alive, disqualifies the entire run', () => {
  for (const mode of ['league', 'tournament']) {
    for (const round of [0, 3, 6]) {
      const played = playCompetition(mode, new Map([[round, { facts: { playerFaintCount: 1 } }]]))
      assert.equal(played.competition.championId, 'player')
      assert.equal(played.last.event.summary.playerRemaining, 3)
      assert.equal(played.competition.achievementRun.totalPlayerFaints, 1)
      assert(!has(played.last.result, `flawless-${mode}`))
    }
  }
})

check('easy rounds, unknown history, malformed counters and forfeits cannot become a flawless title', () => {
  const variants = [
    () => playCompetition('league', new Map(), 'easy'),
    () => playCompetition('league', new Map([[0, { facts: { aiDifficultyId: 'easy' } }]])),
    () => playCompetition('league', new Map([[0, { removeFacts: true }]])),
    () => playCompetition('league', new Map([[0, { facts: { playerFaintCount: null } }]])),
    () => playCompetition('league', new Map([[0, { facts: { playerFaintCount: -1 } }]])),
    () => playCompetition('league', new Map([[0, { facts: { playerTeamSize: 0 } }]])),
    () => playCompetition('league', new Map([[0, { summary: { winner: 'opponent', playerRemaining: 0, opponentRemaining: 1, forfeited: true } }]])),
    () => playCompetition('league', new Map(), 'normal', (competition) => ({ ...competition, achievementRun: undefined })),
    () => playCompetition('league', new Map(), 'normal', (competition) => ({ ...competition, achievementRun: { ...competition.achievementRun, competitionId: 'another-league' } })),
  ]
  for (const run of variants) {
    const played = run()
    assert(played.results.every(({ result }) => !has(result, 'flawless-league')))
    assert.equal(played.progress.stats.flawlessLeagues, 0)
  }
})

check('winning a final alone or a shortened fake run never awards the full-run challenge', () => {
  const played = playCompetition('tournament')
  for (const run of [undefined, {}, {
    ...played.competition.achievementRun,
    rounds: played.competition.achievementRun.rounds.slice(-1),
    completedRounds: 1,
  }, {
    ...played.competition.achievementRun, totalPlayerFaints: 1,
  }, {
    ...played.competition.achievementRun, historyValid: false,
  }, {
    ...played.competition.achievementRun, mode: 'league',
  }]) {
    const result = applyBattleAchievements(createAchievementState(), { ...played.last.event, competitionRun: run })
    assert(!has(result, 'flawless-tournament'))
  }
})

const completeCollection = createCompletePokemonCollection()
const shinyDrawCollection = mergePokemonDraws([], POKEMON_POOL.map((entry) => ({ ...entry, isShiny: true }))).collection

check('obtainable national dex is reachable through actual draws and evolution unlocks', () => {
  assert.equal(ACHIEVABLE_SPECIES_IDS.length, NATIONAL_DEX.length)
  assert.equal(ACHIEVABLE_SPECIES_IDS.length, 1025)
  assert.equal(ACHIEVABLE_SHINY_SPECIES_IDS.length, 1025)
  assert.equal(POKEMON_POOL.length, NATIONAL_DEX.length)
  const input = createAchievementState()
  const before = structuredClone(completeCollection)
  const completed = applyCollectionAchievements(input, completeCollection, 3000)
  assert(has(completed, 'collection-all'))
  assert(!has(completed, 'collection-shiny-all'))
  assert.equal(completed.rewardVp, 200000)
  assert.equal(completed.state.stats.collectionSpeciesCount, 1025)
  assert.equal(input.stats.collectionSpeciesCount, 0)
  assert.deepEqual(completeCollection, before)
  const replay = applyCollectionAchievements(completed.state, completeCollection, 4000)
  assert.equal(replay.processed, false)
  assert.equal(replay.rewardVp, 0)
})

check('actual National Dex shiny draws cover baby and branching shiny forms', () => {
  const completed = applyCollectionAchievements(createAchievementState(), shinyDrawCollection, 3000)
  assert(has(completed, 'collection-all'))
  assert(has(completed, 'collection-shiny-all'))
  assert.equal(completed.rewardVp, 600000)
  assert.equal(completed.state.stats.shinySpeciesCount, 1025)
  const shinyEeveeFamily = applyCollectionAchievements(createAchievementState(), [{ speciesId: 134, shinyObtained: true, isShiny: false }])
  assert.equal(shinyEeveeFamily.state.stats.shinySpeciesCount, getEvolutionSpeciesIds(134).length)
  assert(shinyEeveeFamily.state.stats.shinySpeciesCount > 1)
  const missingFamily = new Set(getEvolutionSpeciesIds(3))
  const partialCollection = shinyDrawCollection.map((entry) => missingFamily.has(entry.dexSpeciesId)
    ? { ...entry, shinyObtained: false, isShiny: false } : entry)
  const partial = applyCollectionAchievements(createAchievementState(), partialCollection)
  assert(!has(partial, 'collection-shiny-all'))
  assert.equal(partial.state.stats.shinySpeciesCount, 1025 - missingFamily.size)
})

check('duplicate, form and malformed collection entries cannot inflate collection progress', () => {
  const result = applyCollectionAchievements(createAchievementState(), [
    { speciesId: 6, shinyObtained: false, isShiny: true },
    { speciesId: 6, shinyObtained: false },
    { dexSpeciesId: 6, speciesId: 10034, shinyObtained: false },
    { speciesId: 999999, shinyObtained: true },
    { speciesId: 'not-a-number', shinyObtained: true },
    { speciesId: 3, shinyObtained: 'true' },
    null, 6, [],
  ])
  assert.equal(result.state.stats.collectionSpeciesCount, 2)
  assert.equal(result.state.stats.shinySpeciesCount, 0)
  const unknown = applyCollectionAchievements(result.state, null)
  assert.equal(unknown.processed, false)
  assert.deepEqual(unknown.state, result.state)
  const legacy = applyCollectionAchievements(createAchievementState(), [{ speciesId: 3, isShiny: true }])
  assert.equal(legacy.state.stats.shinySpeciesCount, 3)
  const missingOne = applyCollectionAchievements(createAchievementState(), completeCollection.slice(1))
  assert(!has(missingOne, 'collection-all'))
  assert.equal(missingOne.state.stats.collectionSpeciesCount, 1024)
})

function allBut(lastId) {
  const state = createAchievementState()
  state.unlocked = Object.fromEntries(ACHIEVEMENTS
    .filter((entry) => !['achievements-all', lastId].includes(entry.id))
    .map((entry) => [entry.id, 1000]))
  return state
}

check('the meta goal excludes itself and unlocks in the same call as the last collection goal', () => {
  const state = allBut('collection-shiny-all')
  const meta = ACHIEVEMENTS.find((entry) => entry.id === 'achievements-all')
  const before = getAchievementProgress(meta, state)
  assert.equal(before.current, ACHIEVEMENTS.length - 2)
  assert.equal(before.target, ACHIEVEMENTS.length - 1)
  assert.equal(before.completed, false)
  const result = applyCollectionAchievements(state, shinyDrawCollection, 5000)
  assert.deepEqual(result.unlocked.map((entry) => entry.id), ['collection-shiny-all', 'achievements-all'])
  assert.equal(result.rewardVp, 1000000)
  assert.equal(getAchievementProgress(meta, result.state).current, ACHIEVEMENTS.length - 1)
  const replay = applyCollectionAchievements(result.state, shinyDrawCollection)
  assert.equal(replay.rewardVp, 0)
  assert.equal(replay.processed, false)
})

check('the meta goal also unlocks when the last battle achievement is awarded', () => {
  const state = allBut('wins-100')
  state.stats.wins = 99
  const result = applyBattleAchievements(state, { battleId: 'elite-final-battle', summary: summary() }, 6000)
  assert.deepEqual(result.unlocked.map((entry) => entry.id), ['wins-100', 'achievements-all'])
  assert.equal(result.rewardVp, 602400)
  const restored = normalizeAchievementState(JSON.parse(JSON.stringify(result.state)))
  assert.equal(restored.unlocked['achievements-all'], 6000)
  assert.equal(applyBattleAchievements(restored, { battleId: 'elite-final-battle', summary: summary() }).rewardVp, 0)
})

check('normalization retains elite entitlements and rejects impossible collection counters', () => {
  const state = normalizeAchievementState({
    stats: { collectionSpeciesCount: 9999, shinySpeciesCount: -1, flawlessLeagues: 1, flawlessTournaments: '1' },
    unlocked: { 'flawless-league': 1234, 'achievements-all': 5678, 'nonexistent-secret': 9000 },
  })
  assert.equal(state.stats.collectionSpeciesCount, 1025)
  assert.equal(state.stats.shinySpeciesCount, 0)
  assert.equal(state.stats.flawlessLeagues, 1)
  assert.equal(state.stats.flawlessTournaments, 0)
  assert.deepEqual(state.unlocked, { 'flawless-league': 1234, 'achievements-all': 5678 })
})

console.log(`Validated ${checks} elite achievement scenarios, 7-round competition history, 1025-species collection and sealed reward entitlements.`)
