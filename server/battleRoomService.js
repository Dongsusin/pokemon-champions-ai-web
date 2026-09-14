import { createHash, scryptSync, timingSafeEqual } from 'node:crypto'
import { maskRankedTrainerName } from '../src/data/rankedPrivacy.js'
import { readTrainerNickname } from '../src/data/trainerNickname.js'

const ROOM_LIMIT = 10
const WAIT_TIMEOUT = 10 * 60_000
const FULL_TIMEOUT = 60_000
const copy = value => structuredClone(value)
const publicMember = member => ({ uid: member.uid, name: maskRankedTrainerName(member.name, member.isGuest, member.nickname), isGuest: member.isGuest === true, joinedAt: member.joinedAt, withdrawn: member.withdrawn === true })
const roomDeadline = room => Math.min(room.createdAt + WAIT_TIMEOUT, room.firstFullAt === null ? Infinity : room.firstFullAt + FULL_TIMEOUT)
const passwordKey = (password, salt) => scryptSync(password, salt, 32).toString('hex')
const hashId = value => createHash('sha256').update(value).digest('hex').slice(0, 40)

export function validateRoomPassword(password, fail) {
  if (password === undefined || password === '') return ''
  if (typeof password !== 'string' || !/^[0-9]{1,4}$/.test(password)) fail('INVALID_ROOM_PASSWORD', '비밀번호는 숫자만 1~4자리로 설정해주세요.')
  return password
}

// Rooms orchestrate the same authenticated match/engine flow as ranked play.
// Only small schedules live here; hidden teams and battle timelines stay server-side.
export function createBattleRoomService({ fail, loadPlayer, expireMatch, settleMatch, createMatch, now, selectionTimeout }) {
  async function lock(tx) {
    const meta = await tx.get('meta', 'battleRooms') ?? { version: 0 }
    tx.set('meta', 'battleRooms', { version: meta.version + 1 })
  }

  function standings(room) {
    const rows = room.members.map(member => ({ ...publicMember(member), wins: 0, losses: 0, draws: 0, played: 0, points: 0 }))
    for (const fixture of room.fixtures) {
      if (fixture.phase !== 'finished') continue
      for (const uid of fixture.uids) {
        const row = rows.find(entry => entry.uid === uid)
        row.played += 1
        if (fixture.winnerUid === uid) { row.wins += 1; row.points += 3 }
        else if (fixture.winnerUid || fixture.reason?.startsWith('both-')) row.losses += 1
        else { row.draws += 1; row.points += 1 }
      }
    }
    rows.sort((a, b) => Number(b.uid === room.championUid) - Number(a.uid === room.championUid) || b.points - a.points || b.wins - a.wins || a.losses - b.losses || a.joinedAt - b.joinedAt || a.uid.localeCompare(b.uid))
    let rank = 0
    return rows.map((row, index) => {
      const previous = rows[index - 1]
      if (!previous || row.points !== previous.points || row.wins !== previous.wins || row.losses !== previous.losses || row.uid === room.championUid || previous.uid === room.championUid) rank = index + 1
      return { ...row, rank }
    })
  }

  async function removeRoom(tx, room, reason, timestamp) {
    await lock(tx)
    const table = standings(room)
    const champion = room.members.find(member => member.uid === room.championUid)
    const receipt = { roomId: room.id, title: room.title, mode: room.mode, format: room.format, standings: table, championName: champion ? publicMember(champion).name : null, reason, finishedAt: timestamp }
    for (const member of room.members) {
      const player = await tx.get('players', member.uid)
      if (!player) continue
      let changed = false
      const ownsRoom = player.activeRoomId === room.id
      if (ownsRoom) { player.activeRoomId = null; changed = true }
      const active = player.activeMatchId ? await tx.get('matches', player.activeMatchId) : null
      if (active?.roomId === room.id) { player.activeMatchId = null; changed = true }
      // An entrant may withdraw, then join and even finish a newer room before
      // this old competition ends. Never let its late receipt hide that session
      // or overwrite the newer result after its active pointer has been cleared.
      const latestSession = !player.lastRoomId || player.lastRoomId === room.id
      const compatibleReceipt = !player.roomResult || player.roomResult.roomId === room.id
      if (ownsRoom || (!player.activeRoomId && latestSession && compatibleReceipt)) { player.roomResult = receipt; changed = true }
      if (changed) tx.set('players', player.uid, player)
    }
    tx.delete('battleRooms', room.id)
    // Attempts have a room-scoped lifetime; deletion also bounds their storage.
    tx.delete('roomPasswordAttempts', room.id)
  }

  function fixture(room, round, uids) {
    return { id: `room_${hashId(`${room.id}:${round}:${uids.join(':')}`)}`, round, uids, phase: uids.length === 1 ? 'bye' : 'pending', winnerUid: uids.length === 1 ? uids[0] : null, reason: uids.length === 1 ? 'tournament-bye' : null }
  }

  function firstSchedule(room, seed) {
    const ordered = [...room.members].sort((a, b) => hashId(`${seed}:${a.uid}`).localeCompare(hashId(`${seed}:${b.uid}`))).map(member => member.uid)
    room.round = 1
    room.fixtures = []
    if (room.mode === 'tournament') {
      room.totalRounds = ordered.length === 2 ? 1 : 2
      room.fixtures.push(fixture(room, 1, ordered.slice(0, 2)))
      if (ordered.length > 2) room.fixtures.push(fixture(room, 1, ordered.slice(2)))
      return
    }
    const circle = [...ordered]
    if (circle.length % 2) circle.push(null)
    room.totalRounds = circle.length - 1
    for (let round = 1; round <= room.totalRounds; round += 1) {
      for (let index = 0; index < circle.length / 2; index += 1) {
        const pair = [circle[index], circle[circle.length - 1 - index]]
        if (pair.every(Boolean)) room.fixtures.push(fixture(room, round, pair))
      }
      circle.splice(1, 0, circle.pop())
    }
  }

  async function advance(tx, room, timestamp) {
    const previous = JSON.stringify(await tx.get('battleRooms', room.id))
    // Four entrants require at most three rounds. This loop also resolves
    // withdrawal walkovers without leaving a room waiting on an absent player.
    for (let pass = 0; pass < 8; pass += 1) {
      const current = room.fixtures.filter(entry => entry.round === room.round)
      for (const entry of current) {
        if (entry.phase === 'bye') {
          if (room.members.find(member => member.uid === entry.winnerUid)?.withdrawn) entry.winnerUid = null
          continue
        }
        if (entry.phase === 'finished') continue
        let match = await tx.get('matches', entry.id)
        const available = entry.uids.filter(uid => !room.members.find(member => member.uid === uid)?.withdrawn)
        if (!match) {
          match = await createMatch(tx, room, entry, timestamp, selectionTimeout)
          entry.phase = match.phase
        }
        if (available.length < 2 && match.phase !== 'finished') {
          const winner = available.length === 0 ? 'draw' : entry.uids[0] === available[0] ? 'player' : 'opponent'
          await settleMatch(tx, match, winner, available.length === 0 ? 'both-withdrawn' : 'room-withdrawal', timestamp)
        } else await expireMatch(tx, match, timestamp)
        entry.phase = match.phase
        entry.deadlineAt = match.deadlineAt
        if (match.phase === 'finished') {
          entry.reason = match.reason
          if (match.winner === 'draw' && room.mode === 'tournament' && !match.reason.startsWith('both-')) {
            entry.winnerUid = entry.uids[Number.parseInt(hashId(`${room.seed}:${entry.id}`)[0], 16) % 2]
            entry.reason = 'draw-tiebreak-lottery'
          } else entry.winnerUid = match.winner === 'draw' ? null : entry.uids[match.winner === 'player' ? 0 : 1]
          if (match.reason.startsWith('both-')) {
            for (const uid of entry.uids) room.members.find(member => member.uid === uid).withdrawn = true
          }
        }
      }
      if (current.some(entry => !['finished', 'bye'].includes(entry.phase))) {
        room.nextDeadlineAt = Math.min(...current.filter(entry => !['finished', 'bye'].includes(entry.phase)).map(entry => entry.deadlineAt))
        if (JSON.stringify(room) !== previous) tx.set('battleRooms', room.id, room)
        return
      }
      if (room.mode === 'tournament') {
        const winners = current.map(entry => entry.winnerUid).filter(uid => uid && !room.members.find(member => member.uid === uid)?.withdrawn)
        if (winners.length < 2) {
          room.championUid = winners[0] ?? null
          await removeRoom(tx, room, room.championUid ? 'completed' : 'all-withdrawn', timestamp)
          return
        }
        room.round += 1
        room.fixtures.push(fixture(room, room.round, winners))
      } else {
        if (room.round >= room.totalRounds) {
          const table = standings(room)
          room.championUid = table.filter(row => row.rank === 1).length === 1 ? table[0].uid : null
          await removeRoom(tx, room, room.members.every(member => member.withdrawn) ? 'all-withdrawn' : 'completed', timestamp)
          return
        }
        room.round += 1
      }
    }
    throw new Error('Battle room schedule exceeded its bounded round count')
  }

  async function cleanup(tx, timestamp, preferredRoomId = null) {
    for (const room of await tx.list('battleRooms')) {
      if (room.phase === 'waiting' && timestamp >= roomDeadline(room)) await removeRoom(tx, room, room.firstFullAt !== null && room.firstFullAt + FULL_TIMEOUT <= room.createdAt + WAIT_TIMEOUT ? 'full-timeout' : 'idle-timeout', timestamp)
      else if (room.phase === 'active' && (room.id === preferredRoomId || !room.nextDeadlineAt || room.nextDeadlineAt <= timestamp)) await advance(tx, room, timestamp)
    }
  }

  function summary(room) {
    return { id: room.id, title: room.title, mode: room.mode, format: room.format, memberCount: room.members.length, capacity: 4, locked: Boolean(room.passwordHash), phase: room.phase, createdAt: room.createdAt, startDeadlineAt: room.phase === 'waiting' ? roomDeadline(room) : null }
  }

  async function context(tx, uid) {
    const all = await tx.list('battleRooms')
    const player = await tx.get('players', uid)
    const room = all.find(entry => entry.id === player?.activeRoomId)
    const member = room?.members.find(entry => entry.uid === uid && !entry.withdrawn)
    if (member && readTrainerNickname(member.nickname) !== readTrainerNickname(player.nickname)) {
      Object.assign(member, { name: player.name, nickname: readTrainerNickname(player.nickname), isGuest: player.isGuest === true })
      tx.set('battleRooms', room.id, room)
    }
    const ownMatch = player?.activeMatchId ? await tx.get('matches', player.activeMatchId) : null
    const waitingMember = room?.phase === 'active' && room.members.some(member => member.uid === uid && !member.withdrawn) && (!ownMatch || ownMatch.phase === 'finished')
    return {
      rooms: all.map(summary).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)),
      room: room ? { ...summary(room), hostUid: room.hostUid, members: room.members.map(publicMember), round: room.round ?? 0, totalRounds: room.totalRounds ?? 0, standings: standings(room), matches: room.fixtures.map(entry => ({ id: entry.id, round: entry.round, players: entry.uids.map(memberUid => publicMember(room.members.find(member => member.uid === memberUid))), phase: entry.phase, winnerUid: entry.winnerUid, winnerName: entry.winnerUid ? publicMember(room.members.find(member => member.uid === entry.winnerUid)).name : null, reason: entry.reason,
        canSpectate: Boolean(waitingMember && ['select', 'battle'].includes(entry.phase) && !entry.uids.includes(uid)),
      })) } : null,
      roomResult: copy(player?.roomResult ?? null), serverTime: now(),
    }
  }

  async function assertAvailable(tx, player, timestamp) {
    // Raid rooms reserve the same player record plus a dedicated pointer.  Read
    // the dedicated pointer here so an older ranked profile cannot bypass the
    // mutual-exclusion rule during a room-create/join race.
    const raid = await tx.get('raidPlayers', player.uid)
    const roomReference = raid?.activeRoomId ?? (typeof player.activeRaidId === 'string' ? player.activeRaidId : null)
    const raidRoom = roomReference ? await tx.get('raidRooms', roomReference) : null
    const runReference = raid?.activeRaidId ?? raidRoom?.activeRaidId ?? (typeof player.activeRaidId === 'string' ? player.activeRaidId : null)
    const raidRun = runReference ? await tx.get('raidRuns', runReference) : null
    const activeRun = Boolean(raidRun && !['finished', 'abandoned'].includes(raidRun.lifecycle))
    const activeRoom = Boolean(raidRoom && (raidRoom.status === 'waiting' || (raidRoom.status === 'active' && activeRun)))
    if (activeRoom || activeRun) {
      fail('ALREADY_IN_RAID', '참가 중인 보스전을 먼저 나가거나 끝내주세요.', 409)
    }
    // A terminal run/expired-room cleanup may have completed while an old
    // player document was still cached.  Clear only this stale reservation;
    // never touch an active pointer discovered above.
    if (raid?.activeRoomId || raid?.activeRaidId) {
      raid.activeRoomId = null
      raid.activeRaidId = null
      tx.set('raidPlayers', player.uid, raid)
    }
    if (player.activeRaidId) player.activeRaidId = null
    if (player.activeRoomId && await tx.get('battleRooms', player.activeRoomId)) fail('ALREADY_IN_ROOM', '이미 참가 중인 방을 먼저 나가주세요.', 409)
    const queue = await tx.get('queue', player.uid)
    if (queue?.expiresAt > timestamp) fail('ALREADY_QUEUED', '레이팅 상대 검색을 먼저 취소해주세요.', 409)
    if (queue) { tx.delete('queue', player.uid); player.queueTicket = null }
    const match = player.activeMatchId ? await tx.get('matches', player.activeMatchId) : null
    if (match) await expireMatch(tx, match, timestamp)
    if (match && match.phase !== 'finished') fail('ALREADY_IN_MATCH', '진행 중인 대전을 먼저 마쳐주세요.', 409)
  }

  async function operate(tx, identity, payload, { timestamp, id, seed, team, salt }) {
    let player = await loadPlayer(tx, identity)
    if (payload.action === 'roomDismissResult') {
      player.roomResult = null
      tx.set('players', player.uid, player)
      return
    }
    if (payload.action === 'roomCreate') {
      await lock(tx)
      await assertAvailable(tx, player, timestamp)
      player = await tx.get('players', identity.uid) ?? player
      if ((await tx.list('battleRooms')).length >= ROOM_LIMIT) fail('ROOM_LIMIT', '방은 전체 10개까지 열 수 있습니다. 빈자리가 생기면 다시 시도해주세요.', 409)
      const password = validateRoomPassword(payload.password, fail)
      const room = { id, title: payload.title, mode: payload.mode, format: payload.format, phase: 'waiting', hostUid: player.uid, members: [{ uid: player.uid, name: identity.name, nickname: identity.nickname, isGuest: identity.isGuest, team, joinedAt: timestamp, withdrawn: false }], createdAt: timestamp, firstFullAt: null, fixtures: [], passwordHash: password ? passwordKey(password, salt) : null, passwordSalt: password ? salt : null }
      player.activeRoomId = room.id
      player.lastRoomId = room.id
      player.activeMatchId = null
      player.queueTicket = null
      player.roomResult = null
      tx.set('battleRooms', room.id, room)
      tx.set('players', player.uid, player)
      return
    }
    const room = await tx.get('battleRooms', payload.roomId)
    if (!room) fail('ROOM_NOT_FOUND', '방이 종료되었거나 삭제되었습니다.', 404)
    if (payload.action === 'roomJoin') {
      if (room.phase !== 'waiting') fail('ROOM_STARTED', '이미 시작한 방에는 참가할 수 없습니다.', 409)
      if (room.members.length >= 4) fail('ROOM_FULL', '방이 가득 찼습니다.', 409)
      await assertAvailable(tx, player, timestamp)
      player = await tx.get('players', identity.uid) ?? player
      const password = validateRoomPassword(payload.password, fail)
      if (room.passwordHash) {
        const attempts = await tx.get('roomPasswordAttempts', room.id) ?? { total: 0, users: {} }
        const uidKey = hashId(identity.uid)
        if (attempts.total >= 30 || (attempts.users[uidKey] ?? 0) >= 5) return { roomError: { code: 'ROOM_PASSWORD_LIMIT', message: '비밀번호 확인 횟수를 초과했습니다. 방장에게 문의해주세요.', status: 429 } }
        const provided = Buffer.from(passwordKey(password, room.passwordSalt), 'hex')
        if (!timingSafeEqual(provided, Buffer.from(room.passwordHash, 'hex'))) {
          attempts.total += 1
          attempts.users[uidKey] = (attempts.users[uidKey] ?? 0) + 1
          tx.set('roomPasswordAttempts', room.id, attempts)
          // Return instead of throwing: the transaction must commit failed
          // attempts, including when a caller repeatedly retries a request ID.
          return { roomError: { code: 'WRONG_ROOM_PASSWORD', message: '방 비밀번호가 일치하지 않습니다.', status: 403 } }
        }
      }
      room.members.push({ uid: identity.uid, name: identity.name, nickname: identity.nickname, isGuest: identity.isGuest, team, joinedAt: timestamp, withdrawn: false })
      if (room.members.length === 4 && room.firstFullAt === null) room.firstFullAt = timestamp
      player.activeRoomId = room.id
      player.lastRoomId = room.id
      player.activeMatchId = null
      player.queueTicket = null
      player.roomResult = null
      tx.set('players', player.uid, player)
      tx.set('battleRooms', room.id, room)
      return
    }
    const member = room.members.find(entry => entry.uid === identity.uid)
    if (!member || player.activeRoomId !== room.id) fail('ROOM_FORBIDDEN', '이 방에 참가한 계정만 요청할 수 있습니다.', 403)
    if (payload.action === 'roomStart') {
      if (room.hostUid !== identity.uid) fail('ROOM_HOST_ONLY', '방장만 대회를 시작할 수 있습니다.', 403)
      if (room.phase !== 'waiting') fail('ROOM_STARTED', '이미 시작한 방입니다.', 409)
      if (room.members.length < 2) fail('ROOM_NEEDS_PLAYERS', '최소 2명이 모여야 시작할 수 있습니다.', 409)
      room.phase = 'active'
      room.seed = seed
      firstSchedule(room, seed)
      await advance(tx, room, timestamp)
      return
    }
    if (payload.action === 'roomLeave') {
      if (room.phase === 'waiting') {
        room.members = room.members.filter(entry => entry.uid !== identity.uid)
        player.activeRoomId = null
        tx.set('players', player.uid, player)
        if (!room.members.length) { await removeRoom(tx, room, 'empty', timestamp); return }
        if (room.hostUid === identity.uid) room.hostUid = room.members[0].uid
        tx.set('battleRooms', room.id, room)
      } else {
        member.withdrawn = true
        const match = player.activeMatchId ? await tx.get('matches', player.activeMatchId) : null
        if (match?.roomId === room.id && match.phase !== 'finished') await settleMatch(tx, match, match.players[0].uid === identity.uid ? 'opponent' : 'player', 'room-withdrawal', timestamp)
        player = await tx.get('players', identity.uid) ?? player
        player.activeRoomId = null
        player.activeMatchId = null
        tx.set('players', player.uid, player)
        await advance(tx, room, timestamp)
      }
    }
  }

  async function eraseGuest(tx, uid, surrogate, timestamp) {
    await lock(tx)
    for (const room of await tx.list('battleRooms')) {
      const attempts = await tx.get('roomPasswordAttempts', room.id)
      if (attempts?.users && Object.hasOwn(attempts.users, hashId(uid))) {
        delete attempts.users[hashId(uid)]
        tx.set('roomPasswordAttempts', room.id, attempts)
      }
      const member = room.members.find(entry => entry.uid === uid)
      if (!member) continue
      if (room.phase === 'waiting') {
        room.members = room.members.filter(entry => entry.uid !== uid)
        if (!room.members.length) { await removeRoom(tx, room, 'empty', timestamp); continue }
        if (room.hostUid === uid) room.hostUid = room.members[0].uid
        tx.set('battleRooms', room.id, room)
        continue
      }
      // Withdraw using the existing schedule rules before removing the identity.
      // Other participants keep their current match, points and later rounds.
      member.withdrawn = true
      for (const fixture of room.fixtures.filter(entry => entry.uids.includes(uid))) {
        const match = await tx.get('matches', fixture.id)
        if (match && match.phase !== 'finished') {
          await settleMatch(tx, match, match.players[0].uid === uid ? 'opponent' : 'player', 'room-withdrawal', timestamp)
        }
      }
      await advance(tx, room, timestamp)
      const remaining = await tx.get('battleRooms', room.id)
      if (!remaining) continue
      remaining.members = remaining.members.map(entry => entry.uid === uid
        ? { uid: surrogate, name: '탈퇴한 게스트', isGuest: false, team: [], joinedAt: entry.joinedAt, withdrawn: true } : entry)
      if (remaining.hostUid === uid) remaining.hostUid = remaining.members.find(entry => !entry.withdrawn)?.uid ?? surrogate
      if (remaining.championUid === uid) remaining.championUid = surrogate
      remaining.fixtures = remaining.fixtures.map(fixture => ({ ...fixture,
        uids: fixture.uids.map(entrant => entrant === uid ? surrogate : entrant),
        winnerUid: fixture.winnerUid === uid ? surrogate : fixture.winnerUid,
      }))
      tx.set('battleRooms', remaining.id, remaining)
    }
  }

  return { cleanup, context, operate, eraseGuest }
}
