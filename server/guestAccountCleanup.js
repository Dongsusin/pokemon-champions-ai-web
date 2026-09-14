import { createHash, randomUUID } from 'node:crypto'
import { sortFactoryRankingEntries } from '../src/data/battleFactoryRanking.js'
import { eraseGuestGlobalChat } from './globalChatService.js'
import { eraseGuestRaidData } from './raidService.js'

const hashOwner = (prefix, uid) => createHash('sha256').update(`${prefix}:${uid}`).digest('hex')
const deletedName = '탈퇴한 게스트'

// This runs only after the account service has authenticated an anonymous user
// and committed its deletion fence. Results shared with opponents retain their
// outcome, but never the deleted user's identity, team, actions or battle state.
export async function eraseGuestRankedData({ store, guestRegistry, rooms, settlement, lobbyLock, now }, identity) {
  if (identity?.isGuest !== true) throw Object.assign(new Error('게스트 계정만 삭제할 수 있습니다.'), { code: 'GUEST_ONLY', status: 403 })
  const uid = identity.uid
  const surrogate = `deleted_${randomUUID().replaceAll('-', '')}`
  const timestamp = now()
  await guestRegistry.beginDeletion(identity)
  return store.transaction(async tx => {
    await guestRegistry.erase(identity, tx)
    await eraseGuestGlobalChat(tx, uid)
    // Keep all ranked-namespace cleanup in this transaction.  The raid helper
    // does not touch the guest registry because the deletion fence above is
    // already committed before this larger cleanup begins.
    await eraseGuestRaidData({ now }, identity, tx)
    await lobbyLock(tx)
    tx.delete('queue', uid)
    await rooms.eraseGuest(tx, uid, surrogate, timestamp)
    const matches = typeof tx.listGuestMatches === 'function' ? await tx.listGuestMatches(uid)
      : (await tx.list('matches')).filter(match => match.players?.some(player => player.uid === uid))
    for (const match of matches) {
      if (match.phase !== 'finished') {
        // The Postgres cleanup projection does not download the large state.
        // Settlement only needs its existence to decide the opponent's reward.
        if (match.hadBattleState) match.state = {}
        await settlement(tx, match, match.players[0].uid === uid ? 'opponent' : 'player', 'forfeit', timestamp)
      }
      for (let index = 0; index < (match.timelineChunks ?? 0); index += 1) {
        tx.delete('timelines', `${match.id}_${match.timelineRevision}_${index}`)
      }
      tx.set('matches', match.id, {
        id: match.id, ...(match.roomId ? { roomId: match.roomId } : {}),
        format: match.format, phase: 'finished', revision: match.revision + 1,
        timelineRevision: (match.timelineRevision ?? 0) + 1,
        createdAt: match.createdAt, deadlineAt: null, finishedAt: match.finishedAt,
        winner: match.winner, reason: match.reason,
        result: match.result?.map((result, index) => match.players[index].uid === uid
          ? { outcome: result.outcome, reason: result.reason, ...(result.friendly ? { friendly: true } : {}) } : result),
        players: match.players.map(player => ({
          uid: player.uid === uid ? surrogate : player.uid,
          name: player.uid === uid ? deletedName : player.name,
          isGuest: player.uid === uid ? false : player.isGuest === true,
          rating: player.uid === uid ? 0 : player.rating ?? 0, team: [],
        })),
        selections: {}, pendingActions: {}, state: null, requests: [], timelineChunks: 0,
      })
    }
    const relatedPlayers = typeof tx.listGuestRelatedPlayers === 'function' ? await tx.listGuestRelatedPlayers(uid)
      : (await tx.list('players')).filter(player => player.roomResult?.standings?.some(row => row.uid === uid))
    for (const player of relatedPlayers) {
      if (player.uid === uid) continue
      const former = player.roomResult.standings.find(row => row.uid === uid)
      player.roomResult.standings = player.roomResult.standings.map(row => row.uid === uid
        ? { ...row, uid: surrogate, name: deletedName, isGuest: false } : row)
      if (player.roomResult.championName === former.name) player.roomResult.championName = deletedName
      tx.set('players', player.uid, player)
    }
    const factoryOwner = hashOwner('factory-owner', uid)
    tx.delete('factoryPersonalBest', factoryOwner)
    const board = await tx.get('factoryRanking', 'top10')
    if (board?.entries?.some(entry => entry.owner === factoryOwner)) {
      const candidates = typeof tx.listFactoryBestCandidates === 'function' ? await tx.listFactoryBestCandidates(factoryOwner)
        : await tx.list('factoryPersonalBest')
      const unique = new Map()
      // Existing accepted ties stay in their current order; fill the vacated
      // position from the remaining personal bests rather than leaving nine.
      for (const entry of [...board.entries, ...candidates]) {
        if (entry.owner !== factoryOwner && !unique.has(entry.owner)) unique.set(entry.owner, entry)
      }
      tx.set('factoryRanking', 'top10', { ...board, updatedAt: Math.max(timestamp, board.updatedAt ?? 0), entries: sortFactoryRankingEntries([...unique.values()]) })
    }
    const usageOwner = hashOwner('usage-owner', uid)
    if (typeof tx.deleteGuestUsageEvents === 'function') await tx.deleteGuestUsageEvents(usageOwner)
    else for (const event of await tx.list('pokemonUsageEvents')) if (event.owner === usageOwner) tx.delete('pokemonUsageEvents', event.id)
    tx.delete('players', uid)
    return { deleted: true }
  })
}
