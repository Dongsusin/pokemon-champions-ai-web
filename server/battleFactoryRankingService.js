import { createHash, randomUUID } from 'node:crypto'
import { maskRankedTrainerName } from '../src/data/rankedPrivacy.js'
import { readTrainerNickname } from '../src/data/trainerNickname.js'
import { sortFactoryRankingEntries, validateFactoryRankingSubmission } from '../src/data/battleFactoryRanking.js'
import { FACTORY_DEFAULT_MODE, getFactoryMode } from '../src/data/battleFactoryChallenge.js'

const LEADERBOARD_COLLECTION = 'factoryRanking'
const BEST_COLLECTION = 'factoryPersonalBest'
// Each mode keeps its own board and its own personal bests. Standard runs stay
// on the original keys so records set before the split are not orphaned.
const readMode = value => getFactoryMode(value).id
// Storage keys allow only word characters and dashes, so the mode is suffixed with one.
const leaderboardKey = mode => (readMode(mode) === FACTORY_DEFAULT_MODE ? 'top10' : `top10-${readMode(mode)}`)
const ownerSeed = (uid, mode) => (readMode(mode) === FACTORY_DEFAULT_MODE
  ? `factory-owner:${uid}`
  : `factory-owner:${readMode(mode)}:${uid}`)
const ownerKey = (uid, mode) => createHash('sha256').update(ownerSeed(uid, mode)).digest('hex')
const copy = value => structuredClone(value)
const publicEntry = entry => entry ? Object.fromEntries([
  'id', 'runId', 'trainerName', 'isGuest', 'floor', 'wins', 'recordedAt', 'party',
].map(key => [key, copy(entry[key])])) : null

function view(board, best) {
  return { entries: (board?.entries ?? []).map(publicEntry), ownBest: publicEntry(best) }
}

function refreshOwnName(tx, board, best, identity, mode) {
  const nickname = identity?.isGuest === true ? '' : readTrainerNickname(identity?.nickname)
  if (!best || !identity || best.owner !== ownerKey(identity.uid, mode) || readTrainerNickname(best.nickname) === nickname) return { board, best }
  const renamed = { ...best, nickname, trainerName: maskRankedTrainerName(identity.name, identity.isGuest, nickname) }
  const nextBoard = board ? { ...board, entries: (board.entries ?? []).map(entry => entry.owner === best.owner
    ? { ...entry, nickname, trainerName: renamed.trainerName } : entry) } : board
  tx.set(BEST_COLLECTION, best.owner, renamed)
  if (nextBoard?.entries.some(entry => entry.owner === best.owner)) tx.set(LEADERBOARD_COLLECTION, leaderboardKey(mode), nextBoard)
  return { board: nextBoard, best: renamed }
}

export async function readFactoryLeaderboard(tx, uid, identity = null, mode = FACTORY_DEFAULT_MODE) {
  let [board, best] = await Promise.all([
    tx.get(LEADERBOARD_COLLECTION, leaderboardKey(mode)), tx.get(BEST_COLLECTION, ownerKey(uid, mode)),
  ])
  if (identity?.uid === uid) ({ board, best } = refreshOwnName(tx, board, best, identity, mode))
  return view(board, best)
}

export function validateFactoryRankingReport(report) {
  return validateFactoryRankingSubmission(report)
}

export async function reportFactoryRun(tx, identity, report, timestamp, entryId = randomUUID()) {
  const mode = readMode(report.mode)
  const owner = ownerKey(identity.uid, mode)
  let [board, best] = await Promise.all([
    tx.get(LEADERBOARD_COLLECTION, leaderboardKey(mode)), tx.get(BEST_COLLECTION, owner),
  ])
  ;({ board, best } = refreshOwnName(tx, board, best, identity, mode))
  // Identity is authenticated, but factory battles currently run in the browser.
  // These bounded, legal loadouts are client reports, not replay-verified wins.
  // A tie or worse run cannot change the first achievement time or final team.
  if (best?.runId === report.runId || (best && report.floor <= best.floor)) return view(board, best)
  const entry = {
    id: best?.id ?? entryId,
    owner,
    runId: report.runId,
    trainerName: maskRankedTrainerName(identity.name, identity.isGuest, identity.nickname),
    nickname: identity.isGuest === true ? '' : readTrainerNickname(identity.nickname),
    isGuest: identity.isGuest === true,
    floor: report.floor,
    wins: report.wins,
    recordedAt: Math.max(timestamp, board?.updatedAt ?? 0),
    party: copy(report.party),
  }
  const nextBoard = {
    version: 1,
    updatedAt: entry.recordedAt,
    entries: sortFactoryRankingEntries([...(board?.entries ?? []).filter(record => record.owner !== owner), entry]),
  }
  tx.set(BEST_COLLECTION, owner, entry)
  tx.set(LEADERBOARD_COLLECTION, leaderboardKey(mode), nextBoard)
  return view(nextBoard, entry)
}
