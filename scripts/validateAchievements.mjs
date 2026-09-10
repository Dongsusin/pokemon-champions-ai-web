import assert from 'node:assert/strict'
import {
  ACHIEVEMENTS,
  ACHIEVEMENT_CATEGORIES,
  applyBattleAchievements,
  createAchievementState,
  getAchievementProgress,
  normalizeAchievementState,
} from '../src/data/achievementData.js'
import { TRAINERS } from '../src/data/trainerTeams.js'
import { createCompetition, resolveCompetitionMatch } from '../src/data/competitionData.js'

let sequence = 0
let checks = 0
const check = (description, test) => { test(); checks += 1; console.log(`PASS ${description}`) }
const has = (result, id) => result.unlocked.some((entry) => entry.id === id)
const event = (facts = {}, overrides = {}) => ({
  battleId: `achievement-test-${++sequence}`,
  opponent: TRAINERS[0],
  competitionMode: null,
  summary: {
    winner: 'player', playerRemaining: 3, opponentRemaining: 0, turns: 7,
    achievementFacts: {
      version: 1, completed: true, playerTeamSize: 3, playerFaintCount: 0,
      playerUsedMechanics: [], formatId: 'single', teamRuleId: 'full',
      aiDifficultyId: 'normal', aiBoostStage: 0, playerHeldItemCountAtStart: 1,
      playerTeamTypes: [['불꽃', '비행'], ['물'], ['풀', '독']],
      playerTeamSpeciesIds: [6, 9, 3], opponentTeamSize: 3,
      playerRemainingHpRatio: 0.7, opponentId: TRAINERS[0].id,
      opponentTier: TRAINERS[0].tier, opponentRegion: TRAINERS[0].region,
      ...facts,
    },
  },
  ...overrides,
})

check('catalog has 35 general goals plus one stable first-win goal per AI', () => {
  assert.equal(ACHIEVEMENTS.length, 35 + TRAINERS.length)
  assert.equal(new Set(ACHIEVEMENTS.map((entry) => entry.id)).size, ACHIEVEMENTS.length)
  assert.equal(ACHIEVEMENTS.filter((entry) => entry.trainerId).length, TRAINERS.length)
  assert(ACHIEVEMENTS.every((entry) => ACHIEVEMENT_CATEGORIES.some((category) => category.id === entry.category)))
  assert(ACHIEVEMENTS.every((entry) => Number.isInteger(entry.rewardVp) && entry.rewardVp > 0))
})

check('empty and malformed saves normalize without inheriting old battle history', () => {
  assert.deepEqual(normalizeAchievementState(null), createAchievementState())
  assert.deepEqual(normalizeAchievementState({ history: Array(100).fill({ winner: 'player' }) }), createAchievementState())
  const normalized = normalizeAchievementState({
    version: 100, walletBalance: 1234,
    stats: { wins: -4, flawlessWins: '10', quickWins: Infinity, currentStreak: 3, bestStreak: 1,
      trainerWins: { [TRAINERS[0].id]: 2, 'unknown-id': 100 }, mechanicWins: { mega: NaN, primal: 1 } },
    unlocked: { 'wins-1': 42, 'wins-10': 'yesterday', 'unknown-goal': 77 },
    processedBattleIds: [null, '', ' valid-id ', 'a', 'a', {}, 'b'],
  })
  assert.equal(normalized.stats.wins, 0)
  assert.equal(normalized.stats.flawlessWins, 0)
  assert.equal(normalized.stats.quickWins, 0)
  assert.equal(normalized.stats.bestStreak, 3)
  assert.deepEqual(normalized.stats.trainerWins, { [TRAINERS[0].id]: 2 })
  assert.deepEqual(normalized.unlocked, { 'wins-1': 42 })
  assert.deepEqual(normalized.processedBattleIds, ['a', 'b'])
  assert(!Object.hasOwn(normalized, 'walletBalance'))
})

check('first victory grants each newly completed reward once without mutating inputs', () => {
  const input = createAchievementState()
  const battle = event()
  const oldState = structuredClone(input)
  const oldBattle = structuredClone(battle)
  const first = applyBattleAchievements(input, battle, 1000)
  assert(first.processed)
  assert(has(first, 'wins-1'))
  assert(has(first, `trainer-${TRAINERS[0].id}`))
  assert(has(first, 'flawless-1'))
  assert(has(first, 'no-gimmick-1'))
  assert(has(first, 'pure-flawless'))
  assert.equal(first.rewardVp, first.unlocked.reduce((sum, def) => sum + def.rewardVp, 0))
  assert(first.unlocked.every((entry) => first.state.unlocked[entry.id] === 1000))
  assert.deepEqual(input, oldState)
  assert.deepEqual(battle, oldBattle)
  const duplicate = applyBattleAchievements(first.state, battle, 2000)
  assert.equal(duplicate.processed, false)
  assert.equal(duplicate.rewardVp, 0)
  assert.deepEqual(duplicate.state, first.state)
  const again = applyBattleAchievements(first.state, event(), 2000)
  assert.equal(again.state.stats.wins, 2)
  assert(!has(again, `trainer-${TRAINERS[0].id}`))
  assert.equal(again.rewardVp, 0)
})

check('unfinished, legacy, malformed and impossible victories grant nothing', () => {
  const cases = [
    event({ completed: false }),
    event({ playerTeamSize: null, playerFaintCount: null, playerHeldItemCountAtStart: null, playerTeamTypes: [] }),
    event({ playerTeamSize: 2 }),
    event({ playerFaintCount: -1 }),
    event({}, { battleId: '' }),
    event({}, { summary: { winner: 'player', playerRemaining: 3, opponentRemaining: 0, turns: 7 } }),
    event({}, { summary: { ...event().summary, achievementFacts: null } }),
    event({}, { summary: { ...event().summary, winner: 'unknown' } }),
    event({}, { summary: { ...event().summary, playerRemaining: 0 } }),
    event({}, { summary: { ...event().summary, opponentRemaining: 1 } }),
    event({}, { summary: { ...event().summary, turns: 0 } }),
  ]
  for (const battle of cases) {
    const result = applyBattleAchievements(createAchievementState(), battle)
    assert.equal(result.processed, false)
    assert.equal(result.rewardVp, 0)
    assert.equal(result.state.stats.wins, 0)
  }
})

check('defeat, draw and explicit surrender reset the streak without rewards', () => {
  const start = applyBattleAchievements(createAchievementState(), event()).state
  for (const winner of ['opponent', 'draw']) {
    const battle = event()
    battle.summary.winner = winner
    const result = applyBattleAchievements(start, battle)
    assert(result.processed)
    assert.equal(result.rewardVp, 0)
    assert.equal(result.state.stats.wins, 1)
    assert.equal(result.state.stats.currentStreak, 0)
    assert.equal(result.state.stats.bestStreak, 1)
  }
  const surrendered = applyBattleAchievements(start, event({ completed: false }, { forfeited: true }))
  assert(surrendered.processed)
  assert.equal(surrendered.state.stats.currentStreak, 0)
  assert.equal(surrendered.state.stats.wins, 1)
  assert.equal(surrendered.rewardVp, 0)
  const fakeWin = applyBattleAchievements(createAchievementState(), event({}, { resultReason: 'forfeit' }))
  assert.equal(fakeWin.rewardVp, 0)
  assert.equal(fakeWin.state.stats.wins, 0)
})

check('fainting and revival never count as a flawless win', () => {
  const result = applyBattleAchievements(createAchievementState(), event({ playerFaintCount: 1 }))
  assert(!has(result, 'flawless-1'))
  assert(!has(result, 'pure-flawless'))
  assert.equal(result.state.stats.flawlessWins, 0)
})

check('actual mechanic use awards the matching goal and blocks no-gimmick goals', () => {
  for (const mechanic of ['mega', 'zmove', 'dynamax', 'tera', 'primal']) {
    const result = applyBattleAchievements(createAchievementState(), event({ playerUsedMechanics: [mechanic, mechanic] }))
    assert(has(result, `mechanic-${mechanic}`))
    assert(!has(result, 'no-gimmick-1'))
    assert(!has(result, 'pure-flawless'))
    assert.equal(result.state.stats.mechanicWins[mechanic], 1)
  }
  for (const playerUsedMechanics of [null, undefined, 'mega', ['unknown']]) {
    const result = applyBattleAchievements(createAchievementState(), event({ playerUsedMechanics }))
    assert(!has(result, 'no-gimmick-1'))
    assert.equal(Object.values(result.state.stats.mechanicWins).reduce((sum, value) => sum + value, 0), 0)
  }
})

check('item and type challenges use the initial lineup rather than final battle forms', () => {
  const success = applyBattleAchievements(createAchievementState(), event({
    playerHeldItemCountAtStart: 0,
    playerTeamTypes: [['불꽃', '비행'], ['불꽃'], ['불꽃', '격투']],
  }))
  assert(has(success, 'no-held-items'))
  assert(has(success, 'monotype-victory'))
  const consumed = applyBattleAchievements(createAchievementState(), event({ playerHeldItemCountAtStart: 1 }))
  assert(!has(consumed, 'no-held-items'))
  for (const facts of [
    { playerHeldItemCountAtStart: undefined, playerTeamTypes: undefined },
    { playerHeldItemCountAtStart: -1, playerTeamTypes: [[], [], []] },
    { playerTeamTypes: [['불꽃'], ['물'], ['불꽃']] },
    { playerTeamTypes: [['불꽃'], ['불꽃']] },
  ]) {
    const result = applyBattleAchievements(createAchievementState(), event(facts))
    assert(!has(result, 'monotype-victory'))
    assert(!has(result, 'no-held-items'))
  }
  const one = event({ playerTeamSize: 1, playerTeamTypes: [['불꽃']] })
  one.summary.playerRemaining = 1
  const solo = applyBattleAchievements(createAchievementState(), one)
  assert(!has(solo, 'monotype-victory'))
  assert(!has(solo, 'last-standing'))
})

check('quick victory and last-standing boundaries follow final battle facts', () => {
  const battle = event({ playerFaintCount: 2 })
  battle.summary.turns = 5
  battle.summary.playerRemaining = 1
  const result = applyBattleAchievements(createAchievementState(), battle)
  assert(has(result, 'quick-victory'))
  assert(has(result, 'last-standing'))
  battle.battleId = `achievement-test-${++sequence}`
  battle.summary.turns = 6
  assert(!has(applyBattleAchievements(createAchievementState(), battle), 'quick-victory'))
})

check('format and difficulty goals require the corresponding rule values', () => {
  const result = applyBattleAchievements(createAchievementState(), event({
    formatId: 'double', aiDifficultyId: 'hard', aiBoostStage: 3,
  }))
  assert(has(result, 'format-double'))
  assert(!has(result, 'format-single'))
  assert(has(result, 'hard-victory'))
  assert(has(result, 'boost-three-victory'))
  assert(!has(applyBattleAchievements(createAchievementState(), event({ aiDifficultyId: 'hard', aiBoostStage: 2 })), 'boost-three-victory'))
  assert(!has(applyBattleAchievements(createAchievementState(), event({ aiDifficultyId: 'normal', aiBoostStage: 3 })), 'boost-three-victory'))
})

check('championship goals follow the resolved competition and perfect leagues require a win', () => {
  const league = applyBattleAchievements(createAchievementState(), event({}, {
    competitionMode: 'league', competitionChampion: true, competitionPerfect: true,
  }))
  assert(has(league, 'league-champion'))
  assert(has(league, 'league-perfect'))
  assert(!has(league, 'tournament-champion'))
  const tournament = applyBattleAchievements(createAchievementState(), event({}, {
    competitionMode: 'tournament', competitionChampion: true, competitionPerfect: true,
  }))
  assert(has(tournament, 'tournament-champion'))
  assert(!has(tournament, 'league-perfect'))
  const unfinished = applyBattleAchievements(createAchievementState(), event({}, {
    competitionMode: 'league', competitionChampion: false, competitionPerfect: true,
  }))
  assert(!has(unfinished, 'league-champion'))
  assert(!has(unfinished, 'league-perfect'))
  const loss = event({}, { competitionMode: 'tournament', competitionChampion: true, competitionPerfect: true })
  loss.summary.winner = 'opponent'
  assert.equal(applyBattleAchievements(createAchievementState(), loss).rewardVp, 0)
})

check('a league champion who loses the last round receives only the title reward, once', () => {
  let league = createCompetition('league', [], '업적 검증 팀', () => 0.4)
  for (let round = 0; round < 6; round += 1) {
    league = resolveCompetitionMatch(league, true, { playerRemaining: 6, opponentRemaining: 0 }, () => 0.4)
  }
  const completedLeague = resolveCompetitionMatch(league, false, { playerRemaining: 0, opponentRemaining: 1 }, () => 0.4)
  assert.equal(completedLeague.status, 'complete')
  assert.equal(completedLeague.championId, 'player')
  assert.equal(completedLeague.standings.player.wins, 6)
  assert.equal(completedLeague.standings.player.losses, 1)
  const start = createAchievementState()
  start.stats.wins = 6
  start.stats.currentStreak = 6
  start.stats.bestStreak = 6
  for (const winner of ['opponent', 'draw']) {
    const finalRound = event({}, {
      competitionMode: completedLeague.mode,
      competitionChampion: completedLeague.status === 'complete' && completedLeague.championId === 'player',
      competitionPerfect: completedLeague.standings.player.wins === 7,
    })
    finalRound.summary.winner = winner
    finalRound.summary.playerRemaining = 0
    finalRound.summary.opponentRemaining = winner === 'draw' ? 0 : 1
    const result = applyBattleAchievements(start, finalRound, 1234)
    assert(result.processed)
    assert.deepEqual(result.unlocked.map((def) => def.id), ['league-champion'])
    assert.equal(result.rewardVp, 1000)
    assert.equal(result.state.stats.wins, 6)
    assert.equal(result.state.stats.currentStreak, 0)
    assert.equal(result.state.stats.bestStreak, 6)
    assert.equal(result.state.stats.leagueChampionships, 1)
    assert.equal(result.state.stats.perfectLeagues, 0)
    const replay = applyBattleAchievements(result.state, finalRound, 4567)
    assert.equal(replay.processed, false)
    assert.equal(replay.rewardVp, 0)
    assert.equal(replay.state.stats.leagueChampionships, 1)
    finalRound.battleId = `achievement-test-${++sequence}`
    finalRound.forfeited = true
    const forfeited = applyBattleAchievements(start, finalRound)
    assert.equal(forfeited.rewardVp, 0)
    assert.equal(forfeited.state.stats.leagueChampionships, 0)
  }
})

check('win milestones and repeated challenge counters unlock at their boundaries', () => {
  let state = createAchievementState()
  for (let wins = 1; wins <= 100; wins += 1) {
    const result = applyBattleAchievements(state, event())
    state = result.state
    assert.equal(has(result, 'wins-10'), wins === 10)
    assert.equal(has(result, 'wins-50'), wins === 50)
    assert.equal(has(result, 'wins-100'), wins === 100)
    assert.equal(has(result, 'flawless-10'), wins === 10)
    assert.equal(has(result, 'no-gimmick-10'), wins === 10)
    for (const target of [3, 5, 10]) assert.equal(has(result, `streak-${target}`), wins === target)
  }
  assert.equal(state.stats.wins, 100)
  const progress = getAchievementProgress(ACHIEVEMENTS.find((def) => def.id === 'wins-10'), state)
  assert.equal(progress.current, 10)
  assert(progress.completed)
  assert(Number.isSafeInteger(progress.completedAt))
})

check('trainer and region achievements follow stable catalog IDs, never display text', () => {
  let state = createAchievementState()
  for (const [index, trainer] of TRAINERS.entries()) {
    const result = applyBattleAchievements(state, event({ opponentId: trainer.id, opponentRegion: 'fake-region' }, {
      opponent: { ...trainer, name: '이름이 바뀐 트레이너', region: 'fake-region' },
    }))
    state = result.state
    assert(has(result, `trainer-${trainer.id}`))
    for (const target of [5, 25, 100]) assert.equal(has(result, `trainers-${target}`), index + 1 === target)
    assert.equal(has(result, 'trainers-all'), index === TRAINERS.length - 1)
  }
  assert.equal(Object.keys(state.stats.trainerWins).length, TRAINERS.length)
  assert(Object.hasOwn(state.unlocked, 'regions-3'))
  assert(Object.hasOwn(state.unlocked, 'regions-8'))
  assert(Object.hasOwn(state.unlocked, 'regions-all'))
  const custom = applyBattleAchievements(createAchievementState(), event({ opponentId: 'custom-id' }, { opponent: { name: TRAINERS[0].name } }))
  assert.equal(custom.state.stats.wins, 1)
  assert.equal(Object.keys(custom.state.stats.trainerWins).length, 0)
  assert(!custom.unlocked.some((def) => def.trainerId))
})

check('processed battle cache stays bounded and reward flags survive reloading', () => {
  let state = createAchievementState()
  for (let i = 0; i < 280; i += 1) state = applyBattleAchievements(state, event()).state
  assert.equal(state.processedBattleIds.length, 256)
  const restored = normalizeAchievementState(JSON.parse(JSON.stringify(state)))
  assert.deepEqual(restored, state)
  const result = applyBattleAchievements(restored, event())
  assert.equal(result.rewardVp, 0)
  const recent = applyBattleAchievements(restored, event({}, { battleId: restored.processedBattleIds.at(-1) }))
  assert.equal(recent.processed, false)
})

console.log(`Validated ${ACHIEVEMENTS.length} achievements across ${checks} settlement scenarios.`)
