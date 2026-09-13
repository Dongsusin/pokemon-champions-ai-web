import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { loadEnv } from 'vite'
import { createPostgresPool } from '../server/postgresStore.js'
import { createDefaultGameSettings } from '../src/gameSettings.js'

// Explicit opt-in production smoke test. The only writes belong to one fresh
// anonymous UID: its account session/profile/save, guest reservation and empty
// ranked profile. Never join a queue, play a battle or submit usage/factory data.
const args = process.argv.slice(2)
let target
try {
  assert.equal(args.length, 2)
  assert.equal(args[0], '--url')
  target = new URL(args[1])
  assert.equal(target.protocol, 'https:')
  assert(['pokemon-champions-area-web.co.kr', 'pokemon-champions-ai-web.vercel.app'].includes(target.hostname))
  assert.equal(target.port + target.username + target.password + target.search + target.hash, '')
  assert.equal(target.pathname, '/')
  assert(!process.env.VERCEL)
} catch {
  console.error('Usage: node scripts/validateDeployedStorage.mjs --url https://pokemon-champions-area-web.co.kr')
  process.exit(1)
}

const environment = loadEnv('storage', process.cwd(), '')
const runId = `deployed_storage_${Date.now()}_${randomUUID().slice(0, 8)}`
const manifestPath = `scripts/.cache/guest-live-validation/${runId}.json`
const startedAt = Date.now()
const checks = []
const ownerIds = new Set()
const prefix = environment.RANKED_FIRESTORE_PREFIX || 'ranked'
let sql, user, lease, guestProfile, freshUidConfirmed = false, stage = 'configuration'
let deletedSqlRows = 0, deletedAccounts = 0, cleanupErrors = 0
const report = message => { checks.push(message); console.log(`PASS ${message}`) }
const safeCode = error => typeof error?.code === 'string' && /^[a-zA-Z0-9_./-]{1,80}$/.test(error.code) ? error.code : 'VALIDATION_FAILED'
const guestOwner = () => createHash('sha256').update(`guest-owner:${user.uid}`).digest('hex')
const newOwner = () => { const owner = `deployment-check-${randomUUID()}`; ownerIds.add(owner); return owner }
const verify = (condition, code) => { if (!condition) throw Object.assign(new Error('Deployment validation assertion failed'), { code }) }
const payload = {
  'champions-vp-v1': '50000',
  'champions-settings-v1': JSON.stringify(createDefaultGameSettings()),
}
const revision = randomUUID()

async function manifest(complete = false) {
  await fs.mkdir('scripts/.cache/guest-live-validation', { recursive: true })
  // Only a fresh UID and cleanup status are recorded for interrupted-run recovery.
  // Tokens, SQL credentials, private saves and existing users never enter this file.
  await fs.writeFile(manifestPath, JSON.stringify({ runId, origin: target.origin,
    rankedNamespace: prefix, uids: user ? [user.uid] : [], startedAt, complete,
    deletedAccounts, deletedSqlRows, cleanupErrors }, null, 2))
}

async function fetchJson(url, options = {}, expectStatus = 200) {
  const response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(30_000) })
  let value
  try { value = await response.json() } catch { throw Object.assign(new Error('Invalid API JSON'), { code: 'INVALID_RESPONSE_JSON' }) }
  if (response.status !== expectStatus) throw Object.assign(new Error('Unexpected API status'), {
    code: `HTTP_${response.status}`, apiCode: safeCode(value.error),
  })
  return value
}

function firebase(action, data) {
  return fetchJson(`https://identitytoolkit.googleapis.com/v1/accounts:${action}?key=${environment.VITE_FIREBASE_API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  })
}

async function call(action, data = {}, { account = false, expectStatus = 200 } = {}) {
  // The allowlist makes it impossible for this smoke test to submit a battle or
  // aggregate report accidentally, even if a later caller passes a wrong action.
  const reads = ['status', 'usage', 'factoryLeaderboard']
  const accountActions = ['sessionAcquire', 'sessionHeartbeat', 'sessionRelease', 'ensureProfile', 'load', 'save']
  verify(account ? accountActions.includes(action) : [...reads, 'guestProfile'].includes(action), 'ACTION_NOT_ALLOWED')
  const readOnly = !account && reads.includes(action)
  const url = new URL(account ? '/api/account' : '/api/ranked', target)
  if (readOnly) url.searchParams.set('action', action)
  return fetchJson(url, {
    method: readOnly ? 'GET' : 'POST',
    // This is an authenticated CLI request; do not pretend it came from a browser.
    headers: { Authorization: `Bearer ${user.idToken}`, 'Content-Type': 'application/json' },
    ...(!readOnly ? { body: JSON.stringify({ action, ...(account ? { ownerId: user.ownerId } : {}), ...data }) } : {}),
  }, expectStatus)
}
const accountCall = (action, data, options) => call(action, data, { account: true, ...options })

async function cleanupSql() {
  if (!sql || !user || !freshUidConfirmed) return
  const client = await sql.connect()
  try {
    await client.query('BEGIN')
    const accountRows = (await client.query('SELECT collection, payload FROM champions.documents WHERE namespace = $1 AND key = $2 FOR UPDATE', ['account', user.uid])).rows
    verify(accountRows.length <= 3 && accountRows.every(row => ['sessions', 'profiles', 'gameData'].includes(row.collection)), 'UNEXPECTED_ACCOUNT_ROWS')
    for (const row of accountRows) {
      if (row.collection === 'profiles') verify(row.payload.uid === user.uid && row.payload.isGuest === true, 'CLEANUP_PROFILE_OWNER_MISMATCH')
      if (row.collection === 'sessions') verify(ownerIds.has(row.payload.ownerId), 'CLEANUP_SESSION_OWNER_MISMATCH')
      if (row.collection === 'gameData') verify(row.payload.revision === revision && isDeepStrictEqual(row.payload.payload, payload), 'CLEANUP_SAVE_MISMATCH')
    }
    const owner = guestOwner()
    const profile = (await client.query('SELECT payload FROM champions.documents WHERE namespace = $1 AND collection = $2 AND key = $3 FOR UPDATE', [prefix, 'guestProfiles', owner])).rows[0]?.payload
    let number
    if (profile) {
      verify(profile.uid === user.uid && /^guest-\d{6}$/.test(profile.displayName) && profile.createdAt >= startedAt - 60_000, 'CLEANUP_GUEST_OWNER_MISMATCH')
      number = profile.displayName.slice(6)
      const reservation = (await client.query('SELECT payload FROM champions.documents WHERE namespace = $1 AND collection = $2 AND key = $3 FOR UPDATE', [prefix, 'guestNames', number])).rows[0]?.payload
      verify(reservation?.owner === owner && reservation.createdAt === profile.createdAt, 'CLEANUP_NAME_OWNER_MISMATCH')
    }
    const player = (await client.query('SELECT payload FROM champions.documents WHERE namespace = $1 AND collection = $2 AND key = $3 FOR UPDATE', [prefix, 'players', user.uid])).rows[0]?.payload
    if (player) verify(player.uid === user.uid && player.isGuest === true && !player.activeMatchId && !player.queueTicket
      && player.vpRewardTotal === 0 && Object.values(player.profiles).every(value => value.wins === 0 && value.losses === 0 && value.draws === 0), 'CLEANUP_RANKED_NOT_EMPTY')
    verify((await client.query('SELECT key FROM champions.documents WHERE namespace = $1 AND collection = $2 AND key = $3', [prefix, 'queue', user.uid])).rows.length === 0, 'UNEXPECTED_QUEUE_ENTRY')
    let removed = 0
    removed += (await client.query('DELETE FROM champions.documents WHERE namespace = $1 AND collection = ANY($2::text[]) AND key = $3', ['account', ['sessions', 'profiles', 'gameData'], user.uid])).rowCount
    removed += (await client.query('DELETE FROM champions.documents WHERE namespace = $1 AND collection = $2 AND key = $3', [prefix, 'players', user.uid])).rowCount
    removed += (await client.query('DELETE FROM champions.documents WHERE namespace = $1 AND collection = $2 AND key = $3 AND payload->>\'uid\' = $4', [prefix, 'guestProfiles', owner, user.uid])).rowCount
    if (number) removed += (await client.query('DELETE FROM champions.documents WHERE namespace = $1 AND collection = $2 AND key = $3 AND payload->>\'owner\' = $4', [prefix, 'guestNames', number, owner])).rowCount
    await client.query('COMMIT')
    deletedSqlRows = removed
  } catch (error) { await client.query('ROLLBACK'); throw error }
  finally { client.release() }
}

try {
  verify(environment.GAME_STORAGE_PROVIDER === 'supabase' && Boolean(environment.DATABASE_URL), 'SUPABASE_CONFIG_REQUIRED')
  verify(environment.VITE_FIREBASE_PROJECT_ID === 'pokemon-champions-arena-2026' && Boolean(environment.VITE_FIREBASE_API_KEY), 'FIREBASE_CONFIG_REQUIRED')
  verify(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(prefix), 'INVALID_RANKED_NAMESPACE')
  stage = 'sql-preflight'
  sql = createPostgresPool({ connectionString: environment.DATABASE_URL, sslCa: environment.DATABASE_SSL_CA })
  await sql.query('SELECT 1 FROM champions.documents LIMIT 1')
  stage = 'fresh-anonymous-signup'
  const signup = await firebase('signUp', { returnSecureToken: true })
  user = { uid: signup.localId, idToken: signup.idToken, refreshToken: signup.refreshToken, ownerId: newOwner() }
  await manifest()
  verify(typeof user.uid === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(user.uid), 'INVALID_NEW_UID')
  const lookup = (await firebase('lookup', { idToken: user.idToken })).users?.[0]
  verify(lookup?.localId === user.uid && !lookup.email && !lookup.providerUserInfo?.length
    && Number(lookup.createdAt) >= startedAt - 60_000, 'ACCOUNT_IS_NOT_FRESH_ANONYMOUS')
  const before = await sql.query('SELECT count(*) FROM champions.documents WHERE (namespace = $1 AND key = $2) OR (namespace = $3 AND ((collection = $4 AND key = $2) OR (collection = $5 AND key = $6)))', ['account', user.uid, prefix, 'players', 'guestProfiles', guestOwner()])
  verify(Number(before.rows[0].count) === 0, 'NEW_UID_ALREADY_HAS_DATA')
  freshUidConfirmed = true

  stage = 'deployed-session'
  lease = await accountCall('sessionAcquire')
  verify(lease.ownerId === user.ownerId && lease.leaseMs === 90_000, 'INVALID_SESSION_LEASE')
  guestProfile = await call('guestProfile')
  verify(guestProfile.uid === user.uid && guestProfile.isGuest === true && /^guest-\d{6}$/.test(guestProfile.displayName), 'INVALID_GUEST_PROFILE')
  const ensured = await accountCall('ensureProfile')
  verify(ensured.profile?.displayName === guestProfile.displayName && ensured.profile?.isGuest === true, 'PROFILE_NAME_MISMATCH')
  verify((await accountCall('load')).gameData === null, 'FRESH_ACCOUNT_NOT_EMPTY')
  report('production API authenticates a fresh guest and creates its session and canonical nickname')

  stage = 'deployed-save'
  verify((await accountCall('save', { revision, saveSequence: 1, payload })).revision === revision, 'SAVE_REVISION_MISMATCH')
  const loaded = (await accountCall('load')).gameData
  verify(loaded?.revision === revision && isDeepStrictEqual(loaded?.payload, payload), 'SAVED_PAYLOAD_MISMATCH')
  const stored = (await sql.query('SELECT payload FROM champions.documents WHERE namespace = $1 AND collection = $2 AND key = $3', ['account', 'gameData', user.uid])).rows[0]?.payload
  verify(stored?.revision === revision && isDeepStrictEqual(stored?.payload, payload), 'DEPLOYMENT_NOT_USING_EXPECTED_SQL')
  report('VP/settings save and load agree with the actual Supabase row')

  stage = 'session-isolation'
  const duplicate = await accountCall('sessionAcquire', { ownerId: newOwner() }, { expectStatus: 409 })
  verify(duplicate.error?.code === 'account-session/occupied', 'DUPLICATE_WINDOW_NOT_BLOCKED')
  const denied = await accountCall('load', { ownerId: newOwner() }, { expectStatus: 409 })
  verify(denied.error?.code === 'account-session/lost', 'FOREIGN_OWNER_NOT_BLOCKED')
  lease = await accountCall('sessionHeartbeat', { version: lease.version })
  verify(lease.ownerId === user.ownerId && lease.leaseMs === 90_000, 'HEARTBEAT_FAILED')
  report('duplicate windows and wrong session owners are rejected; the valid lease renews')

  stage = 'read-only-mode-apis'
  const usage = await call('usage')
  verify(usage.buckets && ['ai-single', 'ai-double', 'ranked-single', 'ranked-double'].every(key => usage.buckets[key]), 'USAGE_BUCKETS_MISSING')
  const factory = await call('factoryLeaderboard')
  verify(Array.isArray(factory.entries) && factory.entries.length <= 10 && factory.ownBest === null, 'FACTORY_READ_INVALID')
  const status = await call('status')
  verify(status.match === null && status.queue === null && status.vpRewards?.uid === user.uid && status.vpRewards.total === 0, 'FRESH_RANKED_STATE_INVALID')
  report('ranked lobby, usage aggregates and factory TOP 10 are readable without joining or reporting')

  stage = 'reload-session'
  const refreshed = await fetchJson(`https://securetoken.googleapis.com/v1/token?key=${environment.VITE_FIREBASE_API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: user.refreshToken }),
  })
  user.idToken = refreshed.id_token
  verify(refreshed.user_id === user.uid, 'REFRESH_CHANGED_UID')
  verify((await accountCall('sessionRelease', { version: lease.version })).released === true, 'SESSION_RELEASE_FAILED')
  const oldOwner = user.ownerId, oldVersion = lease.version
  user.ownerId = newOwner()
  lease = await accountCall('sessionAcquire')
  verify((await accountCall('sessionRelease', { ownerId: oldOwner, version: oldVersion })).released === false, 'STALE_RELEASE_ACCEPTED')
  verify(isDeepStrictEqual(await call('guestProfile'), guestProfile), 'RELOAD_CHANGED_GUEST_NAME')
  const reloaded = (await accountCall('load')).gameData
  verify(reloaded?.revision === revision && isDeepStrictEqual(reloaded?.payload, payload), 'RELOAD_CHANGED_SAVE')
  verify((await accountCall('sessionRelease', { version: lease.version })).released === true, 'FINAL_RELEASE_FAILED')
  report('token refresh and a new window preserve UID, guest name and save; stale release cannot evict the new window')
} catch (error) {
  console.error(`FAIL deployed storage: ${JSON.stringify({ stage, code: safeCode(error), apiCode: error.apiCode })}`)
  process.exitCode = 1
} finally {
  try { await cleanupSql() }
  catch (error) { cleanupErrors += 1; process.exitCode = 1; console.error(`FAIL fresh-UID SQL cleanup: ${safeCode(error)}`) }
  if (user) try {
    const lookup = (await firebase('lookup', { idToken: user.idToken })).users?.[0]
    verify(lookup?.localId === user.uid && !lookup.email && !lookup.providerUserInfo?.length
      && Number(lookup.createdAt) >= startedAt - 60_000, 'CLEANUP_ACCOUNT_NOT_FRESH_ANONYMOUS')
    await firebase('delete', { idToken: user.idToken })
    deletedAccounts += 1
  } catch (error) { cleanupErrors += 1; process.exitCode = 1; console.error(`FAIL fresh anonymous identity cleanup: ${safeCode(error)}`) }
  if (sql) await sql.end()
  if (user) {
    await manifest(cleanupErrors === 0)
    if (!cleanupErrors) report(`${deletedSqlRows} fresh-UID SQL rows and ${deletedAccounts}/1 temporary anonymous account cleaned up`)
  }
}
console.log(`Deployed storage validation: ${checks.length} checks passed; no queue, battle, usage report or factory submission was sent`)
