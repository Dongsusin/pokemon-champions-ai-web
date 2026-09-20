// Cosmetic trainer titles. Each one is earned by a single achievement and is
// shown next to the trainer name in global chat.
//
// This module is imported by the account server, so it deliberately depends on
// nothing else: it maps title ids to achievement ids and never reaches into the
// achievement catalog, which would pull the whole trainer roster onto the server.

const title = (id, name, achievementId, description) => Object.freeze({ id, name, achievementId, description })

export const TRAINER_TITLES = Object.freeze([
  title('boss-first', '전설의 도전자', 'boss-first', '보스전을 처음 클리어한 트레이너에게 주어집니다.'),
  title('boss-mewtwo', '비밀 병기 파괴자', 'boss-mewtwo', '뮤츠 보스전을 클리어한 트레이너에게 주어집니다.'),
  title('boss-hooh', '무지개의 계승자', 'boss-hooh', '칠색조 보스전을 클리어한 트레이너에게 주어집니다.'),
  title('boss-lugia', '폭풍의 지배자', 'boss-lugia', '루기아 보스전을 클리어한 트레이너에게 주어집니다.'),
  title('boss-all', '전설의 정복자', 'boss-all', '세 보스전을 모두 클리어한 트레이너에게 주어집니다.'),
  // The four achievements that used to hand out a hidden Pokemon skin.
  title('unbeaten-commander', '불패의 지휘관', 'flawless-league', '리그 7경기를 기절 없이 전승 우승한 지휘관에게 주어집니다.'),
  title('flawless-champion', '무결의 토너먼트 왕', 'flawless-tournament', '128강부터 결승까지 기절 없이 우승한 트레이너에게 주어집니다.'),
  title('dex-master', '도감 마스터', 'collection-all', '획득 가능한 전국도감을 모두 채운 수집가에게 주어집니다.'),
  title('shiny-seeker', '빛깔의 수집가', 'collection-shiny-all', '획득 가능한 이로치를 모두 해금한 수집가에게 주어집니다.'),
  title('champion-proof', '챔피언의 증명', 'achievements-all', '모든 업적을 달성한 트레이너에게 주어집니다.'),

  // Milestones that already existed but had no cosmetic reward.
  title('hundred-wins', '백전의 챔피언', 'wins-100', '배틀에서 100회 승리한 트레이너에게 주어집니다.'),
  title('rival-conqueror', '모든 라이벌의 정복자', 'trainers-all', '모든 AI 트레이너에게 승리한 트레이너에게 주어집니다.'),
  title('world-stage', '세계 제패', 'regions-all', '모든 지역·무대의 트레이너에게 승리한 트레이너에게 주어집니다.'),
  title('perfect-league', '전승 우승자', 'league-perfect', '리그 7경기를 모두 승리하며 우승한 트레이너에게 주어집니다.'),
  title('unbeaten-run', '무패의 행진', 'streak-10', '10연승을 달성한 트레이너에게 주어집니다.'),

  // Battle Factory: one title per fifty floors, up to the hundredth.
  title('factory-50', '배팩 50층 정복자', 'factory-floor-50', '배틀팩토리 50층을 돌파한 트레이너에게 주어집니다.'),
  title('factory-100', '배팩 100층 정복자', 'factory-floor-100', '배틀팩토리 100층을 돌파한 트레이너에게 주어집니다.'),

  // Ranked: one title per ball tier above the starting tier.
  title('rank-greatball', '슈퍼볼', 'ranked-greatball', '레이팅 배틀에서 슈퍼볼 등급에 도달한 트레이너에게 주어집니다.'),
  title('rank-ultraball', '하이퍼볼', 'ranked-ultraball', '레이팅 배틀에서 하이퍼볼 등급에 도달한 트레이너에게 주어집니다.'),
  title('rank-masterball', '마스터볼', 'ranked-masterball', '레이팅 배틀에서 마스터볼 등급에 도달한 트레이너에게 주어집니다.'),
])

const TITLE_BY_ID = new Map(TRAINER_TITLES.map((entry) => [entry.id, entry]))
const TITLE_BY_ACHIEVEMENT = new Map(TRAINER_TITLES.map((entry) => [entry.achievementId, entry]))
export const TRAINER_TITLE_MAX_LENGTH = 32

export function getTrainerTitle(id) {
  return TITLE_BY_ID.get(id) ?? null
}

export function getTitleForAchievement(achievementId) {
  return TITLE_BY_ACHIEVEMENT.get(achievementId) ?? null
}

// An unlocked entry is a timestamp, matching the achievement record's shape.
const earned = (unlocked, achievementId) => Boolean(unlocked)
  && Object.hasOwn(unlocked, achievementId)
  && Number.isSafeInteger(unlocked[achievementId]) && unlocked[achievementId] >= 0

export function getEarnedTrainerTitles(progress) {
  const unlocked = progress?.unlocked
  return TRAINER_TITLES.filter((entry) => earned(unlocked, entry.achievementId))
}

export function hasTrainerTitle(progress, id) {
  const definition = getTrainerTitle(id)
  return Boolean(definition) && earned(progress?.unlocked, definition.achievementId)
}

/** '' means "show no title"; an unknown or unearned id is rejected. */
export function normalizeTrainerTitle(value) {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value !== 'string') throw new Error('칭호를 확인해 주세요.')
  const id = value.trim()
  if (id === '') return ''
  if (!TITLE_BY_ID.has(id)) throw new Error('존재하지 않는 칭호입니다.')
  return id
}

export function readTrainerTitle(value) {
  try { return normalizeTrainerTitle(value) } catch { return '' }
}
