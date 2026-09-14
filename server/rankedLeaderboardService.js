import { normalizeRankedProfile, RANKED_FORMATS, RANKED_TIERS } from '../src/data/rankedRules.js'
import { maskRankedTrainerName } from '../src/data/rankedPrivacy.js'
import { readTrainerNickname } from '../src/data/trainerNickname.js'

const LEADERBOARD_LIMIT = 10
const MASTER_POINTS = RANKED_TIERS.find(tier => tier.id === 'masterball').minPoints
const PUBLIC_STATS = ['points', 'rating', 'wins', 'losses', 'draws', 'played']

function compareEntrants(first, second) {
  const firstMaster = first.profile.points >= MASTER_POINTS
  const secondMaster = second.profile.points >= MASTER_POINTS
  if (firstMaster !== secondMaster) return firstMaster ? -1 : 1
  const primary = firstMaster ? 'rating' : 'points'
  const secondary = firstMaster ? 'points' : 'rating'
  return second.profile[primary] - first.profile[primary]
    || second.profile[secondary] - first.profile[secondary]
    || second.profile.wins - first.profile.wins
    // The private key makes tied results stable without exposing account IDs.
    || (first.uid < second.uid ? -1 : first.uid > second.uid ? 1 : 0)
}

export async function readRankedLeaderboard(tx, viewerUid, timestamp = Date.now(), identity = null) {
  // One snapshot includes historical players and both formats. PostgreSQL can
  // project just these fields, avoiding transfer of private teams and history.
  const players = typeof tx.listRankedProfiles === 'function'
    ? await tx.listRankedProfiles()
    : await tx.list('players')
  // The authenticated viewer may refresh their public name without changing
  // ratings or scanning account profiles for everyone on the board.
  const own = players.find(player => (player.uid ?? player.id) === viewerUid)
  if (own && identity?.uid === viewerUid) {
    const nickname = identity.isGuest === true ? '' : readTrainerNickname(identity.nickname)
    if (readTrainerNickname(own.nickname) !== nickname) {
      const stored = await tx.get('players', viewerUid)
      if (stored) {
        Object.assign(own, { name: identity.name, nickname, isGuest: identity.isGuest === true })
        tx.set('players', viewerUid, { ...stored, name: own.name, nickname, isGuest: own.isGuest })
      }
    }
  }
  const boards = Object.fromEntries(RANKED_FORMATS.map(({ id: format }) => {
    const entrants = players.flatMap(player => {
      const uid = player.uid ?? player.id
      const profile = player.profiles?.[format]
      if (typeof uid !== 'string' || !uid || !Number.isSafeInteger(profile?.played) || profile.played <= 0) return []
      return [{ uid, name: player.name, nickname: player.nickname, isGuest: player.isGuest === true, profile: normalizeRankedProfile(profile, format) }]
    }).sort(compareEntrants)
    return [format, {
      participantCount: entrants.length,
      entries: entrants.slice(0, LEADERBOARD_LIMIT).map((entrant, index) => ({
        rank: index + 1,
        trainerName: maskRankedTrainerName(entrant.name, entrant.isGuest, entrant.nickname),
        isGuest: entrant.isGuest,
        isOwn: entrant.uid === viewerUid,
        ...Object.fromEntries(PUBLIC_STATS.map(key => [key, entrant.profile[key]])),
      })),
    }]
  }))
  return { boards, updatedAt: timestamp }
}
