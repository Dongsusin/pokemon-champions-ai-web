import { TRAINERS } from './trainerTeams.js'

export const ACHIEVEMENT_STORAGE_KEY = 'champions-achievements-v1'
export const ACHIEVEMENT_CATEGORIES = Object.freeze([
  { id: 'victory', label: '승리 기록' },
  { id: 'challenge', label: '배틀 도전' },
  { id: 'gimmick', label: '기믹 마스터' },
  { id: 'exploration', label: '무대 정복' },
  { id: 'competition', label: '대회 업적' },
  { id: 'trainers', label: 'AI 첫 승리' },
])

const MECHANICS = ['mega', 'zmove', 'dynamax', 'tera', 'primal']
const TRAINER_BY_ID = new Map(TRAINERS.map((trainer) => [trainer.id, trainer]))
const REGION_COUNT = new Set(TRAINERS.map((trainer) => trainer.region).filter(Boolean)).size
const definition = (id, title, description, category, rewardVp, metric, target = 1) => (
  { id, title, description, category, rewardVp, metric, target }
)

export const ACHIEVEMENTS = Object.freeze([
  definition('wins-1', '승리의 첫걸음', '배틀에서 처음 승리하세요.', 'victory', 200, 'wins'),
  definition('wins-10', '승부의 감각', '배틀에서 10회 승리하세요.', 'victory', 300, 'wins', 10),
  definition('wins-50', '숙련된 승부사', '배틀에서 50회 승리하세요.', 'victory', 700, 'wins', 50),
  definition('wins-100', '백전의 챔피언', '배틀에서 100회 승리하세요.', 'victory', 1200, 'wins', 100),
  definition('flawless-1', '모두 함께 돌아가자', '포켓몬이 한 번도 기절하지 않고 승리하세요.', 'challenge', 200, 'flawlessWins'),
  definition('flawless-10', '빈틈없는 지휘', '포켓몬이 한 번도 기절하지 않은 승리를 10회 달성하세요.', 'challenge', 600, 'flawlessWins', 10),
  definition('no-gimmick-1', '기본기의 힘', '기믹을 사용하지 않고 승리하세요. 자동 발동한 원시회귀도 기믹에 포함됩니다.', 'challenge', 200, 'noGimmickWins'),
  definition('no-gimmick-10', '실력으로 증명', '기믹 없이 10회 승리하세요.', 'challenge', 500, 'noGimmickWins', 10),
  definition('pure-flawless', '완벽한 기본기', '기믹을 사용하지 않고, 포켓몬이 한 번도 기절하지 않은 채 승리하세요.', 'challenge', 500, 'pureFlawlessWins'),
  definition('quick-victory', '속전속결', '5턴 이내에 승리하세요.', 'challenge', 300, 'quickWins'),
  definition('last-standing', '마지막 희망', '3마리 이상으로 시작해 마지막 1마리만 남은 상태로 승리하세요.', 'challenge', 300, 'lastStandingWins'),
  definition('no-held-items', '도구 없이도 충분해', '출전한 모든 포켓몬에게 지닌 도구가 없는 상태로 시작해 승리하세요.', 'challenge', 300, 'noItemWins'),
  definition('monotype-victory', '한 타입의 가능성', '3마리 이상이 모두 같은 타입 하나를 공유하는 팀으로 시작해 승리하세요.', 'challenge', 400, 'monotypeWins'),
  definition('mechanic-mega', '한계를 넘는 진화', '메가진화를 사용한 배틀에서 승리하세요.', 'gimmick', 300, 'mechanic:mega'),
  definition('mechanic-zmove', '전력의 한 방', 'Z기술을 사용한 배틀에서 승리하세요.', 'gimmick', 300, 'mechanic:zmove'),
  definition('mechanic-dynamax', '거대한 승리', '다이맥스 또는 거다이맥스를 사용한 배틀에서 승리하세요.', 'gimmick', 300, 'mechanic:dynamax'),
  definition('mechanic-tera', '빛나는 역전', '테라스탈을 사용한 배틀에서 승리하세요.', 'gimmick', 300, 'mechanic:tera'),
  definition('mechanic-primal', '태초의 힘', '원시회귀가 발동한 배틀에서 승리하세요.', 'gimmick', 300, 'mechanic:primal'),
  definition('format-single', '일대일의 정석', '싱글배틀에서 승리하세요.', 'victory', 200, 'singleWins'),
  definition('format-double', '둘이 만드는 승리', '더블배틀에서 승리하세요.', 'victory', 300, 'doubleWins'),
  definition('hard-victory', '강적을 넘어', '하드 난이도 AI를 상대로 승리하세요.', 'challenge', 400, 'hardWins'),
  definition('boost-three-victory', '불리함을 뒤집다', '하드 난이도에서 상대 강화가 +3단계 이상인 배틀에 승리하세요.', 'challenge', 500, 'boostedWins'),
  definition('trainers-5', '새로운 라이벌', '서로 다른 AI 트레이너 5명에게 승리하세요.', 'exploration', 500, 'uniqueTrainers', 5),
  definition('trainers-25', '도전은 계속된다', '서로 다른 AI 트레이너 25명에게 승리하세요.', 'exploration', 800, 'uniqueTrainers', 25),
  definition('trainers-100', '백 명의 라이벌', '서로 다른 AI 트레이너 100명에게 승리하세요.', 'exploration', 1200, 'uniqueTrainers', 100),
  definition('trainers-all', '모든 라이벌을 넘어', `전체 AI 트레이너 ${TRAINERS.length}명에게 각각 승리하세요.`, 'exploration', 2000, 'uniqueTrainers', TRAINERS.length),
  definition('regions-3', '무대를 넓혀라', '서로 다른 지역·무대 3곳의 AI 트레이너에게 승리하세요.', 'exploration', 400, 'uniqueRegions', 3),
  definition('regions-8', '세계로 향하는 도전', '서로 다른 지역·무대 8곳의 AI 트레이너에게 승리하세요.', 'exploration', 800, 'uniqueRegions', 8),
  definition('regions-all', '모든 무대의 승자', `전체 ${REGION_COUNT}개 지역·무대의 AI 트레이너에게 승리하세요.`, 'exploration', 1500, 'uniqueRegions', REGION_COUNT),
  definition('league-champion', '리그의 정상', '리그에서 우승하세요.', 'competition', 1000, 'leagueChampionships'),
  definition('tournament-champion', '토너먼트 챔피언', '토너먼트에서 우승하세요.', 'competition', 800, 'tournamentChampionships'),
  definition('league-perfect', '전승 우승', '리그의 7경기를 모두 승리하며 우승하세요.', 'competition', 1500, 'perfectLeagues'),
  definition('streak-3', '멈추지 않는 기세', '패배·무승부·기권 없이 3연승을 달성하세요.', 'victory', 300, 'bestStreak', 3),
  definition('streak-5', '승리의 흐름', '패배·무승부·기권 없이 5연승을 달성하세요.', 'victory', 600, 'bestStreak', 5),
  definition('streak-10', '무패의 행진', '패배·무승부·기권 없이 10연승을 달성하세요.', 'victory', 1000, 'bestStreak', 10),
  ...TRAINERS.map((trainer) => ({
    ...definition(`trainer-${trainer.id}`, `${trainer.name}에게 첫 승리`, `${trainer.name}에게 처음 승리하세요.`, 'trainers', 100, 'trainer'),
    trainerId: trainer.id,
  })),
].map((entry) => Object.freeze(entry)))

const ACHIEVEMENT_IDS = new Set(ACHIEVEMENTS.map((entry) => entry.id))
const COUNTERS = [
  'wins', 'flawlessWins', 'noGimmickWins', 'pureFlawlessWins', 'quickWins',
  'lastStandingWins', 'noItemWins', 'monotypeWins', 'singleWins', 'doubleWins',
  'hardWins', 'boostedWins', 'leagueChampionships', 'tournamentChampionships',
  'perfectLeagues', 'currentStreak', 'bestStreak',
]
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
const count = (value) => Number.isSafeInteger(value) && value >= 0 ? value : 0
const validBattleId = (value) => typeof value === 'string' && value.length > 0 && value.length <= 200 && value.trim() === value
const increment = (value) => Math.min(Number.MAX_SAFE_INTEGER, count(value) + 1)

export function createAchievementState() {
  return {
    version: 1,
    unlocked: {},
    stats: {
      ...Object.fromEntries(COUNTERS.map((key) => [key, 0])),
      mechanicWins: Object.fromEntries(MECHANICS.map((key) => [key, 0])),
      trainerWins: {},
    },
    processedBattleIds: [],
  }
}

export function normalizeAchievementState(value) {
  const source = record(value)
  const state = createAchievementState()
  const stats = record(source.stats)
  for (const key of COUNTERS) state.stats[key] = count(stats[key])
  state.stats.bestStreak = Math.max(state.stats.bestStreak, state.stats.currentStreak)
  const mechanicWins = record(stats.mechanicWins)
  for (const mechanic of MECHANICS) state.stats.mechanicWins[mechanic] = count(mechanicWins[mechanic])
  for (const [id, wins] of Object.entries(record(stats.trainerWins))) {
    if (TRAINER_BY_ID.has(id) && count(wins) > 0) state.stats.trainerWins[id] = count(wins)
  }
  for (const [id, timestamp] of Object.entries(record(source.unlocked))) {
    if (ACHIEVEMENT_IDS.has(id) && Number.isSafeInteger(timestamp) && timestamp >= 0) state.unlocked[id] = timestamp
  }
  if (Array.isArray(source.processedBattleIds)) {
    state.processedBattleIds = [...new Set(source.processedBattleIds.filter(validBattleId))].slice(-256)
  }
  return state
}

function metricValue(def, stats) {
  if (def.metric === 'trainer') return count(stats.trainerWins?.[def.trainerId])
  if (def.metric === 'uniqueTrainers') return Object.values(record(stats.trainerWins)).filter((value) => count(value) > 0).length
  if (def.metric === 'uniqueRegions') {
    return new Set(Object.keys(record(stats.trainerWins))
      .filter((id) => count(stats.trainerWins[id]) > 0)
      .map((id) => TRAINER_BY_ID.get(id)?.region).filter(Boolean)).size
  }
  if (def.metric?.startsWith('mechanic:')) return count(stats.mechanicWins?.[def.metric.slice(9)])
  return count(stats[def.metric])
}

export function getAchievementProgress(def, value) {
  const state = record(value)
  const unlocked = record(state.unlocked)
  const completed = Object.hasOwn(unlocked, def.id) && Number.isSafeInteger(unlocked[def.id]) && unlocked[def.id] >= 0
  const target = Math.max(1, count(def.target))
  return {
    current: completed ? target : Math.min(target, metricValue(def, record(state.stats))),
    target,
    completed,
    completedAt: completed ? unlocked[def.id] : null,
  }
}

function isMonotypeTeam(facts) {
  const types = facts.playerTeamTypes
  if (facts.playerTeamSize < 3 || !Array.isArray(types) || types.length !== facts.playerTeamSize) return false
  if (!types.every((entry) => Array.isArray(entry) && entry.length > 0 && entry.every((type) => typeof type === 'string' && type.length > 0))) return false
  return types[0].some((type) => types.every((entry) => entry.includes(type)))
}

function unlockEligible(result, now, definitions = ACHIEVEMENTS) {
  const timestamp = Number.isSafeInteger(now) && now >= 0 ? now : Date.now()
  for (const def of definitions) {
    if (Object.hasOwn(result.state.unlocked, def.id) || metricValue(def, result.state.stats) < def.target) continue
    result.state.unlocked[def.id] = timestamp
    result.unlocked.push(def)
    result.rewardVp += def.rewardVp
  }
}

/** Pure settlement: the caller persists this state and its VP balance together. */
export function applyBattleAchievements(value, event, now = Date.now()) {
  const state = normalizeAchievementState(value)
  const result = { state, unlocked: [], rewardVp: 0, processed: false }
  const input = record(event)
  if (!validBattleId(input.battleId) || state.processedBattleIds.includes(input.battleId)) return result
  const summary = record(input.summary)
  const facts = record(summary.achievementFacts)
  const forfeited = input.forfeited === true || input.resultReason === 'forfeit'
  // An unfinished battle, an old summary without tracked facts, or a malformed
  // winner cannot award progress. Explicit surrender still ends a win streak.
  if (!forfeited && (facts.version !== 1 || facts.completed !== true || !['player', 'opponent', 'draw'].includes(summary.winner))) return result
  const won = !forfeited && summary.winner === 'player'
  if (won && (!Number.isSafeInteger(summary.playerRemaining) || summary.playerRemaining < 1
    || summary.opponentRemaining !== 0 || !Number.isSafeInteger(summary.turns) || summary.turns < 1
    || !Number.isSafeInteger(facts.playerTeamSize) || facts.playerTeamSize < summary.playerRemaining
    || !Number.isSafeInteger(facts.playerFaintCount) || facts.playerFaintCount < 0)) return result
  state.processedBattleIds = [...state.processedBattleIds, input.battleId].slice(-256)
  result.processed = true
  if (!won) {
    state.stats.currentStreak = 0
    // League standings can still crown a player who loses the final round.
    // Award that competition title alone; it is not a won battle or a streak.
    if (!forfeited && input.competitionMode === 'league' && input.competitionChampion === true) {
      state.stats.leagueChampionships = increment(state.stats.leagueChampionships)
      unlockEligible(result, now, ACHIEVEMENTS.filter((def) => def.id === 'league-champion'))
    }
    return result
  }

  const stats = state.stats
  const bump = (key) => { stats[key] = increment(stats[key]) }
  bump('wins')
  bump('currentStreak')
  stats.bestStreak = Math.max(stats.bestStreak, stats.currentStreak)

  const hasTeamFacts = Number.isSafeInteger(facts.playerTeamSize) && facts.playerTeamSize >= summary.playerRemaining
  const flawless = hasTeamFacts && facts.playerFaintCount === 0
  const knownMechanics = Array.isArray(facts.playerUsedMechanics)
    && facts.playerUsedMechanics.every((mechanic) => MECHANICS.includes(mechanic))
  const noGimmick = knownMechanics && facts.playerUsedMechanics.length === 0
  if (flawless) bump('flawlessWins')
  if (noGimmick) bump('noGimmickWins')
  if (flawless && noGimmick) bump('pureFlawlessWins')
  if (summary.turns <= 5) bump('quickWins')
  if (hasTeamFacts && facts.playerTeamSize >= 3 && summary.playerRemaining === 1) bump('lastStandingWins')
  if (hasTeamFacts && facts.playerHeldItemCountAtStart === 0) bump('noItemWins')
  if (hasTeamFacts && isMonotypeTeam(facts)) bump('monotypeWins')
  if (knownMechanics) {
    for (const mechanic of new Set(facts.playerUsedMechanics)) stats.mechanicWins[mechanic] = increment(stats.mechanicWins[mechanic])
  }
  if (facts.formatId === 'single') bump('singleWins')
  if (facts.formatId === 'double') bump('doubleWins')
  if (facts.aiDifficultyId === 'hard') {
    bump('hardWins')
    if (Number.isInteger(facts.aiBoostStage) && facts.aiBoostStage >= 3) bump('boostedWins')
  }

  // Catalog identity, not a mutable display name or supplied region, identifies
  // a trainer and their region. Unknown/custom opponents only count general wins.
  const trainerId = typeof facts.opponentId === 'string' ? facts.opponentId : record(input.opponent).id
  if (TRAINER_BY_ID.has(trainerId)) stats.trainerWins[trainerId] = increment(stats.trainerWins[trainerId])
  if (input.competitionChampion === true) {
    if (input.competitionMode === 'league') {
      bump('leagueChampionships')
      if (input.competitionPerfect === true) bump('perfectLeagues')
    }
    if (input.competitionMode === 'tournament') bump('tournamentChampionships')
  }

  unlockEligible(result, now)
  return result
}
