import fs from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash, randomInt, randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { loadEnv } from 'vite'
import { createPostgresPool } from '../server/postgresStore.js'
import { normalizePokemon, getMoveById } from '../src/data/trainingData.js'
import { canonicalizeRankedTeam } from '../server/rankedBattle.js'

// Opt-in production smoke test. The caller must first verify that Vercel's
// Production deployment is Ready at --expected-commit. Only this run's newly
// created anonymous identities and password-protected friendly rooms are used.
// No ranked queue, usage report, factory result, or existing account is modified.
function assertGameSourcesMatch(commit, { cwd = process.cwd() } = {}) {
  const options = { cwd, windowsHide: true, stdio: 'ignore' }
  try { execFileSync('git', ['merge-base', '--is-ancestor', commit, 'HEAD'], options) }
  catch { fail('EXPECTED_COMMIT_NOT_ANCESTOR') }
  // Compare the deployed commit all the way through staged/unstaged files.
  // Later promo, documentation and verification-script commits are harmless,
  // but the build's resource generator is part of the deployed game inputs.
  const paths = ['src', 'api', 'server', 'public', 'patches', 'index.html', 'vercel.json', '.vercelignore',
    ':(top,glob)package*.json', ':(top,glob)vite.config.*', ':(top,glob)tsconfig*.json',
    'pnpm-lock.yaml', 'yarn.lock', 'npm-shrinkwrap.json', '.npmrc', '.node-version', '.nvmrc',
    'scripts/generateResourceManifest.mjs']
  try { execFileSync('git', ['diff', '--quiet', commit, '--', ...paths], options) }
  catch { fail('DEPLOYED_GAME_SOURCES_DIFFER') }
  const additions = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '--', ...paths], {
    ...options, stdio: 'pipe', encoding: 'utf8',
  })
  verify(!additions.trim(), 'UNTRACKED_DEPLOYMENT_SOURCE')
}

const args = process.argv.slice(2)
const parameters = new Map()
let target, expectedCommit, expectedCss
try {
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index]
    if (key === '--confirm-production') parameters.set(key, true)
    else {
      if (!['--url', '--expected-commit', '--expected-css'].includes(key) || parameters.has(key)) throw Error()
      parameters.set(key, args[++index])
    }
  }
  if (parameters.size !== 4 || parameters.get('--confirm-production') !== true || process.env.VERCEL) throw Error()
  target = new URL(parameters.get('--url'))
  if (target.protocol !== 'https:' || !['pokemon-champions-area-web.co.kr', 'pokemon-champions-ai-web.vercel.app'].includes(target.hostname)
    || target.port + target.username + target.password + target.search + target.hash || target.pathname !== '/') throw Error()
  expectedCommit = parameters.get('--expected-commit')
  expectedCss = parameters.get('--expected-css')
  if (!/^[a-f0-9]{40}$/.test(expectedCommit) || !/^\/assets\/index-[A-Za-z0-9_-]+\.css$/.test(expectedCss)) throw Error()
} catch {
  console.error('Usage: node scripts/validateDeployedBattleRooms.mjs --confirm-production --url https://pokemon-champions-area-web.co.kr --expected-commit FULL_SHA --expected-css /assets/index-HASH.css')
  process.exit(1)
}

const environment = loadEnv('storage', process.cwd(), '')
const runId = `deployed_rooms_${Date.now()}_${randomUUID().slice(0, 8)}`
const startedAt = Date.now()
const prefix = environment.RANKED_FIRESTORE_PREFIX || 'ranked'
const manifestPath = `scripts/.cache/room-live-validation/${runId}.json`
const users = []
const roomIds = new Set()
const matchIds = new Set()
const roomTitles = new Set()
const checks = []
let sql, stage = 'configuration', cleanupErrors = 0, deletedRows = 0, deletedAccounts = 0
const fail = code => { throw Object.assign(new Error('Production room validation failed'), { code }) }
const verify = (condition, code) => { if (!condition) fail(code) }
const safeCode = error => typeof error?.code === 'string' && /^[A-Za-z0-9_./-]{1,80}$/.test(error.code) ? error.code : 'VALIDATION_FAILED'
const report = message => { checks.push(message); console.log(`PASS ${message}`) }
const ownerKey = uid => createHash('sha256').update(`guest-owner:${uid}`).digest('hex')
const ownUid = uid => users.some(user => user.uid === uid && user.fresh)

async function manifest(complete = false) {
  await fs.mkdir('scripts/.cache/room-live-validation', { recursive: true })
  // Identifiers enable precise interrupted-run cleanup. No token, password,
  // SQL credential or private team is ever printed or written to the manifest.
  await fs.writeFile(manifestPath, JSON.stringify({ runId, origin: target.origin, expectedCommit, expectedCss,
    startedAt, stage, uids: users.map(user => user.uid), roomIds: [...roomIds], matchIds: [...matchIds],
    roomTitles: [...roomTitles], rankedNamespace: prefix, checks, complete, deletedRows, deletedAccounts, cleanupErrors }, null, 2))
}

async function json(url, options = {}, expectedStatus = 200) {
  const response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(30_000) })
  let body
  try { body = await response.json() } catch { fail('INVALID_API_JSON') }
  if (response.status !== expectedStatus) throw Object.assign(new Error('Unexpected API status'), { code: `HTTP_${response.status}`, apiCode: safeCode(body.error) })
  return body
}
const firebase = (action, body) => json(`https://identitytoolkit.googleapis.com/v1/accounts:${action}?key=${environment.VITE_FIREBASE_API_KEY}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})

async function call(user, action, data = {}, { account = false, expectedStatus = 200 } = {}) {
  verify(users.includes(user) && user.fresh, 'ONLY_CONFIRMED_FRESH_UIDS')
  const reads = ['rooms', 'status']
  const roomActions = ['guestProfile', 'roomCreate', 'roomJoin', 'roomStart', 'roomLeave', 'roomDismissResult', 'select', 'submit', 'forfeit']
  const accountActions = ['sessionAcquire', 'ensureProfile', 'save', 'load', 'sessionRelease']
  verify((account ? accountActions : [...reads, ...roomActions]).includes(action), 'ACTION_NOT_ALLOWED')
  if (data.roomId) verify(roomIds.has(data.roomId), 'ROOM_OUTSIDE_RUN')
  if (data.matchId) verify(matchIds.has(data.matchId), 'MATCH_OUTSIDE_RUN')
  if (data.spectateMatchId) verify(matchIds.has(data.spectateMatchId), 'SPECTATOR_MATCH_OUTSIDE_RUN')
  if (action === 'roomCreate') verify(roomTitles.has(data.title) && /^[0-9]{4}$/.test(data.password), 'UNPROTECTED_TEST_ROOM')
  const readOnly = !account && reads.includes(action)
  const url = new URL(account ? '/api/account' : '/api/ranked', target)
  if (readOnly) for (const [key, value] of Object.entries({ action, ...data })) url.searchParams.set(key, value)
  return json(url, {
    method: readOnly ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${user.idToken}`, 'Content-Type': 'application/json' },
    ...(!readOnly ? { body: JSON.stringify({ action, ...(account ? { ownerId: user.ownerId } : { requestId: randomUUID() }), ...data }) } : {}),
  }, expectedStatus)
}
const accountCall = (user, action, data) => call(user, action, data, { account: true })

async function assertAnonymous(user) {
  const account = (await firebase('lookup', { idToken: user.idToken })).users?.[0]
  verify(account?.localId === user.uid && !account.email && !account.providerUserInfo?.length && Number(account.createdAt) >= startedAt - 60_000, 'UID_NOT_FRESH_ANONYMOUS')
}

async function setupUser(number) {
  const signup = await firebase('signUp', { returnSecureToken: true })
  const user = { uid: signup.localId, idToken: signup.idToken, ownerId: `room-check-${randomUUID()}`, revision: randomUUID(), fresh: false }
  users.push(user)
  await manifest()
  verify(typeof user.uid === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(user.uid), 'INVALID_CREATED_UID')
  await assertAnonymous(user)
  const before = await sql.query('SELECT count(*) FROM champions.documents WHERE (namespace = $1 AND key = $2) OR (namespace = $3 AND ((collection = $4 AND key = $2) OR (collection = $5 AND key = $6)))', ['account', user.uid, prefix, 'players', 'guestProfiles', ownerKey(user.uid)])
  verify(Number(before.rows[0].count) === 0, 'FRESH_UID_ALREADY_HAS_DATA')
  user.fresh = true
  user.lease = await accountCall(user, 'sessionAcquire')
  const guest = await call(user, 'guestProfile')
  verify(guest.uid === user.uid && guest.isGuest === true && /^guest-\d{6}$/.test(guest.displayName), 'INVALID_GUEST_PROFILE')
  user.displayName = guest.displayName
  await accountCall(user, 'ensureProfile')
  const roster = [25, 6, 9, 143, 68, 131].map(speciesId => normalizePokemon({ speciesId,
    captureId: `room-smoke-${number}-${speciesId}`, moves: [getMoveById('protect').name], heldItemId: '' }))
  canonicalizeRankedTeam(roster)
  user.team = roster.map(pokemon => ({ captureId: pokemon.captureId }))
  user.payload = { 'champions-dex-v2': JSON.stringify(roster), 'champions-battle-items-v1': '{}', 'champions-vp-v1': '50000' }
  await accountCall(user, 'save', { revision: user.revision, saveSequence: 1, payload: user.payload })
  const saved = (await sql.query('SELECT payload FROM champions.documents WHERE namespace=$1 AND collection=$2 AND key=$3', ['account', 'gameData', user.uid])).rows[0]?.payload
  verify(saved?.revision === user.revision && isDeepStrictEqual(saved.payload, user.payload), 'DEPLOYMENT_STORAGE_MISMATCH')
  const snapshot = await call(user, 'rooms')
  verify(Array.isArray(snapshot.rooms) && snapshot.rooms.length <= 10 && snapshot.room === null && snapshot.match === null && snapshot.rankedConflict === false, 'ROOM_API_NOT_READY')
  verify(snapshot.rooms.length < 10, 'PRODUCTION_ROOMS_FULL')
  report(`fresh guest ${number + 1} authenticated; server-owned legal team saved and rooms API available`)
}

async function playRoom(mode, format) {
  stage = `${mode}-${format}`
  const title = `운영 점검 ${runId.slice(-8)} ${mode === 'tournament' ? 'T' : 'L'}`
  const password = String(randomInt(10_000)).padStart(4, '0')
  roomTitles.add(title)
  await manifest()
  const created = await call(users[0], 'roomCreate', { title, mode, format, password, team: users[0].team })
  verify(created.room?.title === title && created.room.hostUid === users[0].uid && created.room.locked === true, 'INVALID_CREATED_ROOM')
  roomIds.add(created.room.id)
  await manifest()
  verify(created.room.memberCount === 1 && created.room.capacity === 4 && created.room.startDeadlineAt - created.room.createdAt === 600_000, 'ROOM_LIMIT_OR_DEADLINE_INVALID')
  const listed = await call(users[1], 'rooms')
  verify(listed.rooms.some(room => room.id === created.room.id && room.locked), 'NEW_ROOM_NOT_LISTED')
  const wrong = await call(users[1], 'roomJoin', { roomId: created.room.id, password: password === '9999' ? '9998' : '9999', team: users[1].team }, { expectedStatus: 403 })
  verify(wrong.error?.code === 'WRONG_ROOM_PASSWORD', 'PASSWORD_NOT_ENFORCED')
  const joined = await call(users[1], 'roomJoin', { roomId: created.room.id, password, team: users[1].team })
  verify(joined.room.memberCount === 2 && joined.room.members.every(member => ownUid(member.uid)), 'UNEXPECTED_ROOM_MEMBER')
  const notHost = await call(users[1], 'roomStart', { roomId: created.room.id }, { expectedStatus: 403 })
  verify(notHost.error?.code === 'ROOM_HOST_ONLY', 'HOST_NOT_ENFORCED')
  const started = await call(users[0], 'roomStart', { roomId: created.room.id })
  verify(started.room?.phase === 'active' && started.match?.roomId === created.room.id && started.match.phase === 'select', 'ROOM_DID_NOT_START')
  verify(started.room.members.every(member => ownUid(member.uid)), 'NON_TEST_MEMBER_STARTED')
  matchIds.add(started.match.id)
  await manifest()
  const selection = format === 'single' ? [0, 1, 2] : [0, 1, 2, 3]
  let snapshot
  for (const user of users) snapshot = await call(user, 'select', { matchId: started.match.id, revision: started.match.revision, selection })
  verify(snapshot.match?.phase === 'battle' && snapshot.match.state?.rules?.pvp === true, 'GENUINE_BATTLE_NOT_STARTED')
  const revision = snapshot.match.revision
  const actions = Array.from({ length: format === 'single' ? 1 : 2 }, (_, actorSlot) => ({ type: 'move', actorSlot, moveIndex: 0, targetSideId: 'player', targetSlot: actorSlot }))
  for (const user of users) snapshot = await call(user, 'submit', { matchId: started.match.id, revision, actions })
  verify(snapshot.match?.state?.turn === 2 && snapshot.match.timeline.length > 0, 'SERVER_TURN_NOT_RESOLVED')
  const terminal = await call(users[1], 'forfeit', { matchId: started.match.id })
  verify(terminal.match?.phase === 'finished' && terminal.match.result.friendly === true && terminal.match.result.rewardVp === 0, 'ROOM_SETTLEMENT_INVALID')
  for (const user of users) {
    const current = await call(user, 'rooms')
    verify(current.room === null && current.match === null && current.roomResult?.roomId === created.room.id && current.roomResult.reason === 'completed', 'FINISHED_ROOM_NOT_REMOVED')
    verify(current.roomResult.standings.length === 2 && current.roomResult.standings.every(row => ownUid(row.uid)), 'INVALID_FINAL_STANDINGS')
    verify(current.vpRewards.total === 0 && Object.values(current.profile).every(profile => profile.played === 0), 'FRIENDLY_CHANGED_LADDER')
    await call(user, 'roomDismissResult')
  }
  const stored = (await sql.query('SELECT payload FROM champions.documents WHERE namespace=$1 AND collection=$2 AND key=$3', [prefix, 'matches', started.match.id])).rows[0]?.payload
  verify(stored?.roomId === created.room.id && stored.phase === 'finished' && stored.usageRecordedAt == null, 'FRIENDLY_USAGE_OR_STORAGE_INVALID')
  verify((await sql.query('SELECT key FROM champions.documents WHERE namespace=$1 AND collection=$2 AND key=$3', [prefix, 'battleRooms', created.room.id])).rows.length === 0, 'FINISHED_ROOM_STILL_STORED')
  report(`${mode}/${format}: password and host enforced, real turn resolved, result returned, room deleted without RP/VP/usage recording`)
}

function verifySpectatorPrivacy(view) {
  verify(view?.spectator === true && view.rules?.pvp === true, 'SPECTATOR_PUBLIC_STATE_MISSING')
  verify(Array.isArray(view.commandOptions) && view.commandOptions.length === 0
    && view.pendingTurn === null && view.pendingPlayerSwitch === null && view.awaitingPlayerSwitch === false, 'SPECTATOR_COMMANDS_EXPOSED')
  for (const sideId of ['player', 'opponent']) {
    const side = view[sideId]
    verify(side?.team?.length === 3 && side.activeIndexes?.length === 1, 'SPECTATOR_BOTH_SIDES_MISSING')
    const active = side.team[side.activeIndexes[0]]
    verify(active && !active.hidden && active.speciesId === 25, 'SPECTATOR_LEAD_NOT_PUBLIC')
    verify(side.team.filter(pokemon => pokemon.hidden).length === 2, 'SPECTATOR_BENCH_NOT_HIDDEN')
    for (const pokemon of side.team) {
      verify(Number.isInteger(pokemon.hp) && pokemon.hp >= 0 && pokemon.hp <= 100
        && pokemon.maxHp === 100 && pokemon.originalMaxHp === 100, 'SPECTATOR_EXACT_HP_EXPOSED')
      verify(Array.isArray(pokemon.moves) && pokemon.moves.length === 0 && isDeepStrictEqual(pokemon.stats, {})
        && pokemon.ability === '' && pokemon.heldItemId === '' && pokemon.heldItemName === '' && pokemon.teraType === null, 'SPECTATOR_LOADOUT_EXPOSED')
      verify(!pokemon.captureId && !pokemon.trainingPoints && !pokemon.nature, 'SPECTATOR_TRAINING_EXPOSED')
      if (pokemon.hidden) verify(pokemon.speciesId === 0 && pokemon.name === '미공개 포켓몬'
        && pokemon.status === null && pokemon.hp === 100, 'SPECTATOR_PRIVATE_BENCH_EXPOSED')
    }
  }
}

async function playSpectatedRoom() {
  stage = 'spectator-tournament-single'
  verify(users.length === 3 && users.every(user => user.fresh), 'SPECTATOR_REQUIRES_THREE_FRESH_USERS')
  const title = `운영 점검 ${runId.slice(-8)} S`
  const password = String(randomInt(10_000)).padStart(4, '0')
  roomTitles.add(title)
  await manifest()
  const created = await call(users[0], 'roomCreate', { title, mode: 'tournament', format: 'single', password, team: users[0].team })
  verify(created.room?.title === title && created.room.hostUid === users[0].uid && created.room.locked === true, 'INVALID_SPECTATOR_ROOM')
  roomIds.add(created.room.id)
  await manifest()
  for (const user of users.slice(1)) {
    const joined = await call(user, 'roomJoin', { roomId: created.room.id, password, team: user.team })
    verify(joined.room?.members.every(member => ownUid(member.uid)), 'SPECTATOR_ROOM_FOREIGN_MEMBER')
  }
  const started = await call(users[0], 'roomStart', { roomId: created.room.id })
  verify(started.room?.phase === 'active' && started.room.memberCount === 3
    && started.room.members.every(member => ownUid(member.uid)), 'SPECTATOR_ROOM_START_FAILED')
  const semifinal = started.room.matches.find(match => match.phase === 'select' && match.players.length === 2)
  const bye = started.room.matches.find(match => match.phase === 'bye' && match.players.length === 1)
  verify(semifinal && bye && started.room.matches.length === 2
    && semifinal.players.every(player => ownUid(player.uid)) && ownUid(bye.winnerUid), 'SPECTATOR_BYE_SCHEDULE_INVALID')
  matchIds.add(semifinal.id)
  await manifest()
  const observer = users.find(user => user.uid === bye.winnerUid)
  const participants = semifinal.players.map(player => users.find(user => user.uid === player.uid))
  const selecting = await call(observer, 'rooms', { spectateMatchId: semifinal.id })
  verify(selecting.match === null && selecting.spectator?.id === semifinal.id && selecting.spectator.phase === 'select'
    && selecting.spectator.state === null && selecting.spectator.timeline.length === 0
    && selecting.room.matches.find(match => match.id === semifinal.id)?.canSpectate === true, 'SPECTATOR_SELECTION_NOT_PRIVATE')
  for (const key of ['teamPreview', 'selections', 'selectedIndices', 'pendingActions', 'you', 'opponent']) {
    verify(selecting.spectator[key] === undefined, 'SPECTATOR_SELECTION_DETAILS_EXPOSED')
  }
  verify(selecting.spectator.players.length === 2 && selecting.spectator.players.every(player => player.isGuest === true
    && participants.some(user => user.displayName === player.name)), 'SPECTATOR_TRAINER_NAMES_INVALID')
  report('three-player private tournament: bye entrant observes selection without either private team')

  let battle
  for (const user of participants) {
    const current = await call(user, 'rooms')
    verify(current.match?.id === semifinal.id && current.match.phase === 'select', 'SPECTATOR_PARTICIPANT_MATCH_INVALID')
    battle = await call(user, 'select', { matchId: semifinal.id, revision: current.match.revision, selection: [0, 1, 2] })
  }
  verify(battle.match?.phase === 'battle' && battle.match.state?.turn === 1, 'SPECTATOR_GENUINE_BATTLE_NOT_STARTED')
  const revision = battle.match.revision
  const actions = [{ type: 'move', actorSlot: 0, moveIndex: 0, targetSideId: 'player', targetSlot: 0 }]
  for (const user of participants) battle = await call(user, 'submit', { matchId: semifinal.id, revision, actions })
  verify(battle.match?.state?.turn === 2 && battle.match.timeline.length > 0, 'SPECTATOR_REAL_TURN_NOT_RESOLVED')
  const ownSide = battle.match.state.player
  verify(ownSide.team[ownSide.activeIndexes[0]].maxHp !== 100, 'SPECTATOR_HP_TEST_NOT_DISTINCT')
  const viewed = await call(observer, 'rooms', { spectateMatchId: semifinal.id })
  verify(viewed.match === null && viewed.spectator?.phase === 'battle' && viewed.spectator.state?.turn === 2
    && viewed.spectator.timeline.length > 0, 'SPECTATOR_LIVE_TIMELINE_MISSING')
  verifySpectatorPrivacy(viewed.spectator.state)
  for (const step of viewed.spectator.timeline) {
    verifySpectatorPrivacy(step.state)
    verify(step.damage === undefined && step.movePower === undefined && step.pendingAction === undefined, 'SPECTATOR_TIMELINE_PRIVATE_DATA')
  }
  const unchanged = await call(observer, 'rooms', { spectateMatchId: semifinal.id, spectateTimelineRevision: viewed.spectator.timelineRevision })
  verify(unchanged.spectator?.id === semifinal.id && unchanged.spectator.timeline.length === 0
    && unchanged.spectator.timelineRevision === viewed.spectator.timelineRevision
    && isDeepStrictEqual(unchanged.spectator.state, viewed.spectator.state), 'SPECTATOR_REVISION_REPLAYED')
  report('spectator stream: real server turn, both public sides, percentage HP, hidden loadouts/benches and unchanged timeline omitted')

  const ended = await call(participants[1], 'forfeit', { matchId: semifinal.id })
  const final = ended.room?.matches.find(match => match.round === 2 && match.phase === 'select' && match.players.length === 2)
  verify(ended.match?.phase === 'finished' && final && final.id !== semifinal.id
    && final.players.every(player => ownUid(player.uid)) && final.players.some(player => player.uid === observer.uid), 'SPECTATOR_FINAL_NOT_SCHEDULED')
  matchIds.add(final.id)
  await manifest()
  const ownFinal = await call(observer, 'rooms', { spectateMatchId: semifinal.id })
  verify(ownFinal.spectator === null && ownFinal.match?.id === final.id && ownFinal.match.phase === 'select', 'SPECTATOR_OWN_MATCH_NOT_PRIORITIZED')
  const eliminated = participants[1]
  const finalView = await call(eliminated, 'rooms', { spectateMatchId: final.id })
  verify(finalView.match === null && finalView.spectator?.id === final.id && finalView.spectator.state === null, 'ELIMINATED_ENTRANT_CANNOT_SPECTATE')
  await call(observer, 'forfeit', { matchId: final.id })
  for (const user of users) {
    const current = await call(user, 'rooms', { spectateMatchId: user === eliminated ? final.id : semifinal.id })
    verify(current.spectator === null && current.room === null && current.match === null
      && current.roomResult?.roomId === created.room.id && current.roomResult.reason === 'completed', 'SPECTATOR_DELETED_ROOM_STREAM_REMAINED')
    verify(current.roomResult.standings.length === 3 && current.roomResult.standings.every(row => ownUid(row.uid)), 'SPECTATOR_FINAL_STANDINGS_INVALID')
    verify(current.vpRewards.total === 0 && Object.values(current.profile).every(profile => profile.played === 0), 'SPECTATOR_CHANGED_LADDER')
    await call(user, 'roomDismissResult')
  }
  for (const matchId of [semifinal.id, final.id]) {
    const stored = (await sql.query('SELECT payload FROM champions.documents WHERE namespace=$1 AND collection=$2 AND key=$3', [prefix, 'matches', matchId])).rows[0]?.payload
    verify(stored?.roomId === created.room.id && stored.phase === 'finished' && stored.usageRecordedAt == null, 'SPECTATOR_STORAGE_OR_USAGE_INVALID')
  }
  verify((await sql.query('SELECT key FROM champions.documents WHERE namespace=$1 AND collection=$2 AND key=$3', [prefix, 'battleRooms', created.room.id])).rows.length === 0, 'SPECTATOR_ROOM_STILL_STORED')
  report('spectator lifecycle: own final takes priority, eliminated entrant watches, completed room removes every stream and returns three-player results')
}

async function cleanupOwnedSql() {
  if (!sql || !users.some(user => user.fresh)) return
  const client = await sql.connect()
  try {
    await client.query('BEGIN')
    const confirmedRoomIds = new Set(roomIds)
    // Recover IDs only from this run's fresh players or their exact unique
    // room titles if a network response was lost. Never delete by broad prefix.
    const players = []
    for (const user of users.filter(entry => entry.fresh)) {
      const player = (await client.query('SELECT payload FROM champions.documents WHERE namespace=$1 AND collection=$2 AND key=$3 FOR UPDATE', [prefix, 'players', user.uid])).rows[0]?.payload
      if (player) {
        verify(player.uid === user.uid && player.isGuest === true && player.vpRewardTotal === 0 && !player.queueTicket && Object.values(player.profiles).every(profile => profile.played === 0), 'CLEANUP_PLAYER_NOT_ISOLATED')
        for (const id of [player.activeRoomId, player.lastRoomId, player.roomResult?.roomId].filter(Boolean)) roomIds.add(id)
        if (player.activeMatchId) matchIds.add(player.activeMatchId)
        players.push(player)
      }
      verify((await client.query('SELECT key FROM champions.documents WHERE namespace=$1 AND collection=$2 AND key=$3', [prefix, 'queue', user.uid])).rows.length === 0, 'CLEANUP_QUEUE_PRESENT')
    }
    for (const title of roomTitles) {
      const rows = (await client.query('SELECT key, payload FROM champions.documents WHERE namespace=$1 AND collection=$2 AND payload->>\'title\'=$3 FOR UPDATE', [prefix, 'battleRooms', title])).rows
      for (const row of rows) { verify(row.payload.createdAt >= startedAt && ownUid(row.payload.hostUid) && row.payload.members.every(member => ownUid(member.uid)), 'CLEANUP_ROOM_NOT_OWNED'); roomIds.add(row.key); confirmedRoomIds.add(row.key) }
    }
    for (const roomId of roomIds) {
      const room = (await client.query('SELECT payload FROM champions.documents WHERE namespace=$1 AND collection=$2 AND key=$3 FOR UPDATE', [prefix, 'battleRooms', roomId])).rows[0]?.payload
      if (room) { verify(room.id === roomId && roomTitles.has(room.title) && room.createdAt >= startedAt && room.members.every(member => ownUid(member.uid)), 'CLEANUP_FOREIGN_ROOM'); confirmedRoomIds.add(roomId) }
      const matches = (await client.query('SELECT key, payload FROM champions.documents WHERE namespace=$1 AND collection=$2 AND payload->>\'roomId\'=$3 FOR UPDATE', [prefix, 'matches', roomId])).rows
      for (const row of matches) { verify(row.payload.id === row.key && row.payload.createdAt >= startedAt && row.payload.players.length === 2 && row.payload.players.every(player => ownUid(player.uid)) && row.payload.usageRecordedAt == null, 'CLEANUP_FOREIGN_MATCH'); matchIds.add(row.key); confirmedRoomIds.add(roomId) }
    }
    for (const matchId of matchIds) {
      const match = (await client.query('SELECT payload FROM champions.documents WHERE namespace=$1 AND collection=$2 AND key=$3 FOR UPDATE', [prefix, 'matches', matchId])).rows[0]?.payload
      verify(match && roomIds.has(match.roomId) && match.createdAt >= startedAt && match.players.length === 2 && match.players.every(player => ownUid(player.uid)), 'CLEANUP_UNCONFIRMED_MATCH')
      // Enumerate only the exact chunks referred to by this confirmed match.
      const keys = Array.from({ length: match.timelineChunks ?? 0 }, (_, index) => `${match.id}_${match.timelineRevision}_${index}`)
      if (keys.length) deletedRows += (await client.query('DELETE FROM champions.documents WHERE namespace=$1 AND collection=$2 AND key=ANY($3::text[])', [prefix, 'timelines', keys])).rowCount
      deletedRows += (await client.query('DELETE FROM champions.documents WHERE namespace=$1 AND collection=$2 AND key=$3', [prefix, 'matches', matchId])).rowCount
    }
    for (const roomId of roomIds) {
      verify(confirmedRoomIds.has(roomId), 'CLEANUP_UNCONFIRMED_ROOM')
      deletedRows += (await client.query('DELETE FROM champions.documents WHERE namespace=$1 AND collection=ANY($2::text[]) AND key=$3', [prefix, ['battleRooms', 'roomPasswordAttempts'], roomId])).rowCount
    }
    for (const user of users.filter(entry => entry.fresh)) {
      const accountRows = (await client.query('SELECT collection,payload FROM champions.documents WHERE namespace=$1 AND key=$2 FOR UPDATE', ['account', user.uid])).rows
      verify(accountRows.length <= 3 && accountRows.every(row => ['sessions', 'profiles', 'gameData'].includes(row.collection)), 'CLEANUP_ACCOUNT_COLLECTION_MISMATCH')
      for (const row of accountRows) {
        if (row.collection === 'sessions') verify(row.payload.ownerId === user.ownerId, 'CLEANUP_OWNER_MISMATCH')
        if (row.collection === 'profiles') verify(row.payload.uid === user.uid && row.payload.isGuest === true, 'CLEANUP_PROFILE_MISMATCH')
        if (row.collection === 'gameData') verify(row.payload.revision === user.revision && isDeepStrictEqual(row.payload.payload, user.payload), 'CLEANUP_SAVE_MISMATCH')
      }
      const owner = ownerKey(user.uid)
      const guest = (await client.query('SELECT payload FROM champions.documents WHERE namespace=$1 AND collection=$2 AND key=$3 FOR UPDATE', [prefix, 'guestProfiles', owner])).rows[0]?.payload
      if (guest) {
        verify(guest.uid === user.uid && guest.createdAt >= startedAt && /^guest-\d{6}$/.test(guest.displayName), 'CLEANUP_GUEST_MISMATCH')
        const number = guest.displayName.slice(6)
        const reservation = (await client.query('SELECT payload FROM champions.documents WHERE namespace=$1 AND collection=$2 AND key=$3 FOR UPDATE', [prefix, 'guestNames', number])).rows[0]?.payload
        verify(reservation?.owner === owner && reservation.createdAt === guest.createdAt, 'CLEANUP_RESERVATION_MISMATCH')
        deletedRows += (await client.query('DELETE FROM champions.documents WHERE namespace=$1 AND collection=$2 AND key=$3 AND payload->>\'owner\'=$4', [prefix, 'guestNames', number, owner])).rowCount
      }
      deletedRows += (await client.query('DELETE FROM champions.documents WHERE namespace=$1 AND collection=$2 AND key=$3 AND payload->>\'uid\'=$4', [prefix, 'guestProfiles', owner, user.uid])).rowCount
      deletedRows += (await client.query('DELETE FROM champions.documents WHERE namespace=$1 AND collection=$2 AND key=$3', [prefix, 'players', user.uid])).rowCount
      deletedRows += (await client.query('DELETE FROM champions.documents WHERE namespace=$1 AND collection=ANY($2::text[]) AND key=$3', ['account', ['sessions', 'profiles', 'gameData'], user.uid])).rowCount
    }
    await client.query('COMMIT')
  } catch (error) { await client.query('ROLLBACK'); deletedRows = 0; throw error }
  finally { client.release() }
}

try {
  verify(environment.GAME_STORAGE_PROVIDER === 'supabase' && Boolean(environment.DATABASE_URL) && Boolean(environment.DATABASE_SSL_CA), 'SUPABASE_CONFIG_REQUIRED')
  verify(environment.VITE_FIREBASE_PROJECT_ID === 'pokemon-champions-arena-2026' && Boolean(environment.VITE_FIREBASE_API_KEY), 'FIREBASE_CONFIG_REQUIRED')
  verify(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(prefix), 'INVALID_NAMESPACE')
  const main = execFileSync('git', ['ls-remote', 'origin', 'refs/heads/main'], { encoding: 'utf8', windowsHide: true }).split(/\s/)[0]
  verify(main === expectedCommit, 'EXPECTED_MAIN_COMMIT_MISMATCH')
  assertGameSourcesMatch(expectedCommit)
  stage = 'public-deployment-preflight'
  const response = await fetch(new URL(`/?check=${runId}`, target), { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30_000) })
  const html = await response.text()
  verify(response.ok && html.includes(expectedCss), 'EXPECTED_DEPLOYED_CSS_MISSING')
  const css = await fetch(new URL(expectedCss, target), { redirect: 'error', signal: AbortSignal.timeout(30_000) })
  verify(css.ok && (await css.text()).includes('.rooms-screen'), 'ROOM_ASSET_MISSING')
  const denied = await json(new URL('/api/ranked?action=rooms', target), {}, 401)
  verify(denied.error?.code === 'UNAUTHENTICATED', 'UNAUTHENTICATED_ROOMS_ACCEPTED')
  report('expected main commit and deployed room CSS verified; unauthenticated rooms request rejected')
  sql = createPostgresPool({ connectionString: environment.DATABASE_URL, sslCa: environment.DATABASE_SSL_CA })
  await sql.query('SELECT 1 FROM champions.documents LIMIT 1')
  stage = 'fresh-guest-setup'
  await setupUser(0)
  await setupUser(1)
  await playRoom('tournament', 'single')
  await playRoom('league', 'double')
  await setupUser(2)
  await playSpectatedRoom()
  stage = 'verified'
} catch (error) {
  console.error(`FAIL deployed rooms: ${JSON.stringify({ stage, code: safeCode(error), apiCode: error.apiCode })}`)
  process.exitCode = 1
} finally {
  try { await cleanupOwnedSql() }
  catch (error) { cleanupErrors += 1; process.exitCode = 1; console.error(`FAIL isolated SQL cleanup: ${safeCode(error)}`) }
  for (const user of users) try {
    await assertAnonymous(user)
    await firebase('delete', { idToken: user.idToken })
    deletedAccounts += 1
  } catch (error) { cleanupErrors += 1; process.exitCode = 1; console.error(`FAIL isolated anonymous cleanup: ${safeCode(error)}`) }
  if (sql) await sql.end()
  if (users.length) {
    if (!cleanupErrors) report(`${deletedRows} isolated SQL rows and ${deletedAccounts}/${users.length} fresh anonymous identities cleaned up`)
    await manifest(stage === 'verified' && cleanupErrors === 0 && !process.exitCode)
  }
}
console.log(`Deployed battle rooms validation: ${checks.length} checks passed; no ranked queue or usage/factory report sent`)
