import { createHash, randomUUID } from 'node:crypto'
import { maskRankedTrainerName } from '../src/data/rankedPrivacy.js'
import { sortFactoryRankingEntries, validateFactoryRankingSubmission } from '../src/data/battleFactoryRanking.js'

const LEADERBOARD_COLLECTION = 'factoryRanking'
const LEADERBOARD_KEY = 'top10'
const BEST_COLLECTION = 'factoryPersonalBest'
const ownerKey = uid => createHash('sha256').update(`factory-owner:${uid}`).digest('hex')
const copy = value => structuredClone(value)
const publicEntry = entry => entry ? Object.fromEntries([
  'id', 'runId', 'trainerName', 'floor', 'wins', 'recordedAt', 'party',
].map(key => [key, copy(entry[key])])) : null

function view(board, best) {
  return { entries: (board?.entries ?? []).map(publicEntry), ownBest: publicEntry(best) }
}

export async function readFactoryLeaderboard(tx, uid) {
  const [board, best] = await Promise.all([
    tx.get(LEADERBOARD_COLLECTION, LEADERBOARD_KEY), tx.get(BEST_COLLECTION, ownerKey(uid)),
  ])
  return view(board, best)
}

export function validateFactoryRankingReport(report) {
  return validateFactoryRankingSubmission(report)
}

export async function reportFactoryRun(tx, identity, report, timestamp, entryId = randomUUID()) {
  const owner = ownerKey(identity.uid)
  const [board, best] = await Promise.all([
    tx.get(LEADERBOARD_COLLECTION, LEADERBOARD_KEY), tx.get(BEST_COLLECTION, owner),
  ])
  // Identity is authenticated, but factory battles currently run in the browser.
  // These bounded, legal loadouts are client reports, not replay-verified wins.
  // A tie or worse run cannot change the first achievement time or final team.
  if (best?.runId === report.runId || (best && report.floor <= best.floor)) return view(board, best)
  const entry = {
    id: best?.id ?? entryId,
    owner,
    runId: report.runId,
    trainerName: maskRankedTrainerName(identity.name),
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
  tx.set(LEADERBOARD_COLLECTION, LEADERBOARD_KEY, nextBoard)
  return view(nextBoard, entry)
}
