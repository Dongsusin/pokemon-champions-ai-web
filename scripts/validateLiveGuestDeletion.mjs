import fs from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { isDeepStrictEqual, parseEnv } from 'node:util'

// No network or credential-file access without BOTH explicit opt-ins.
// PowerShell, only after deployment:
// $env:RUN_LIVE_GUEST_DELETION='true'
// $env:TARGET_ORIGIN='https://pokemon-champions-area-web.co.kr'
// node scripts/validateLiveGuestDeletion.mjs
function requireLiveGate() {
  if (process.env.RUN_LIVE_GUEST_DELETION !== 'true' || !process.env.TARGET_ORIGIN
    || process.env.VERCEL || process.env.FIREBASE_AUTH_EMULATOR_HOST) throw new Error('LIVE_GATE_REQUIRED')
  const target = new URL(process.env.TARGET_ORIGIN)
  if (target.protocol !== 'https:' || !['pokemon-champions-area-web.co.kr', 'pokemon-champions-ai-web.vercel.app'].includes(target.hostname)
    || target.username || target.password || target.port || target.search || target.hash || target.pathname !== '/') throw new Error('INVALID_TARGET_ORIGIN')
  return target.origin
}

let origin
try { origin = requireLiveGate() } catch {
  console.error('NOT RUN: RUN_LIVE_GUEST_DELETION=true and an approved HTTPS TARGET_ORIGIN are required.')
  process.exit(1)
}

const runId = `guest_delete_${Date.now()}_${randomUUID().slice(0, 8)}`
const recoveryDirectory = 'scripts/.cache/guest-live-validation'
const recoveryPath = `${recoveryDirectory}/${runId}.json`
const startedAt = Date.now()
const ownerId = `live-guest-delete-${randomUUID()}`
const revision = `live-save-${randomUUID()}`
const payload = { 'champions-vp-v1': '50000', 'champions-settings-v1': '{}' }
let stage = 'configuration', checks = 0, validationPassed = false
let app, auth, user, sql, namespace, sdk, lease, temporaryIdentityVerified = false, freshDatabaseConfirmed = false
let serverDeleted = false, authDeleted = false, sqlClean = false, cleanupFailed = false
const verify = (condition, code) => { if (!condition) throw Object.assign(new Error('Live validation check failed'), { code }) }
const safeCode = error => /^auth\/[a-z-]{1,60}$/.test(error?.code ?? '') || /^[A-Z][A-Z0-9_]{1,70}$/.test(error?.code ?? '')
  ? error.code : 'VALIDATION_FAILED'
const pass = label => { checks += 1; console.log(`PASS ${label}`) }
const guestKey = uid => createHash('sha256').update(`guest-owner:${uid}`).digest('hex')
const deletionKey = uid => createHash('sha256').update(`guest-delete:${uid}`).digest('hex')

async function writeRecovery() {
  await fs.mkdir(recoveryDirectory, { recursive: true })
  // A recovery record may contain this disposable user's refresh token. Refuse
  // to write unless Git explicitly ignores the path; never print its contents.
  try { execFileSync('git', ['check-ignore', '--quiet', recoveryPath], { stdio: 'ignore' }) }
  catch { throw Object.assign(new Error('Recovery path must be ignored'), { code: 'RECOVERY_PATH_NOT_IGNORED' }) }
  const complete = (!user || authDeleted) && (!temporaryIdentityVerified || sqlClean)
  const record = { version: 1, runId, startedAt, validationPassed, cleanupComplete: complete, checks,
    ...(complete ? {} : {
      origin, rankedNamespace: namespace, uid: user?.uid ?? null, ownerId, revision,
      payload, lease: lease ?? null, temporaryIdentityVerified, freshDatabaseConfirmed, serverDeleted, authDeleted, sqlClean,
      // Public Firebase configuration and the *temporary* user session are kept
      // locally only while recovery is required. No database/Admin key is saved.
      ...(!authDeleted && user ? { temporaryFirebaseUser: user.toJSON() } : {}),
      recovery: [
        'This file belongs only to the newly created anonymous account from this run. Never substitute another UID.',
        'If Auth remains, refresh this temporary session using its refreshToken, verify its anonymous identity and UID, then delete that Firebase user.',
        'Use .env.storage.local locally to inspect and remove only the exact UID/hashed-owner rows listed by this script. Keep deletion fences until Firebase deletion is confirmed.',
        'After both cleanups are verified, replace this file with a completion record without UID, tokens or lease secrets.',
      ],
    }) }
  const temporaryPath = `${recoveryPath}.tmp`
  await fs.writeFile(temporaryPath, JSON.stringify(record, null, 2), { mode: 0o600 })
  await fs.rename(temporaryPath, recoveryPath)
}

async function api(action, fields = {}, expectedStatus = 200) {
  verify(temporaryIdentityVerified && freshDatabaseConfirmed && user?.isAnonymous === true, 'TEMPORARY_IDENTITY_REQUIRED')
  const accountActions = ['sessionAcquire', 'sessionHeartbeat', 'ensureProfile', 'save', 'load', 'deleteGuestAccount']
  verify(accountActions.includes(action) || action === 'guestProfile', 'ACTION_NOT_ALLOWED')
  // The sole ranked action reserves this fresh guest's nickname. There is no
  // status/join/report endpoint here: queues, player rankings and usage cannot
  // receive test data even if someone extends the script incorrectly.
  const account = action !== 'guestProfile'
  const response = await fetch(`${origin}${account ? '/api/account' : '/api/ranked'}`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(25_000),
    headers: { Authorization: `Bearer ${await user.getIdToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...(account ? { ownerId } : {}), ...fields }),
  })
  let body
  try { body = await response.json() } catch { throw Object.assign(new Error('Invalid response'), { code: 'INVALID_API_RESPONSE' }) }
  verify(response.status === expectedStatus, `UNEXPECTED_HTTP_${response.status}`)
  verify(response.headers.get('cache-control')?.includes('no-store'), 'PRIVATE_RESPONSE_CACHEABLE')
  return body
}

async function readOwnRows(client = sql) {
  verify(temporaryIdentityVerified, 'TEMPORARY_IDENTITY_REQUIRED')
  const uid = user.uid
  const accounts = (await client.query(`SELECT collection, payload FROM champions.documents
    WHERE namespace = $1 AND collection = ANY($2::text[]) AND key = $3`, ['account', ['gameData', 'profiles', 'sessions'], uid])).rows
  const profile = (await client.query(`SELECT payload FROM champions.documents
    WHERE namespace = $1 AND collection = $2 AND key = $3`, [namespace, 'guestProfiles', guestKey(uid)])).rows[0]?.payload ?? null
  const names = (await client.query(`SELECT key, payload FROM champions.documents
    WHERE namespace = $1 AND collection = $2 AND payload->>'owner' = $3`, [namespace, 'guestNames', guestKey(uid)])).rows
  const marker = (await client.query(`SELECT payload FROM champions.documents
    WHERE namespace = $1 AND collection = $2 AND key = $3`, ['account', 'guestDeletions', deletionKey(uid)])).rows[0]?.payload ?? null
  return { accounts, profile, names, marker }
}

function checkDeletedRows(rows) {
  verify(rows.accounts.length === 0 && rows.names.length === 0, 'OWNED_ROWS_REMAIN')
  verify(rows.profile?.deleted === true && isDeepStrictEqual(Object.keys(rows.profile).sort(), ['deleted', 'deletedAt']), 'GUEST_FENCE_NOT_MINIMAL')
  verify(rows.marker?.status === 'deleted' && isDeepStrictEqual(Object.keys(rows.marker).sort(), ['deletedAt', 'status']), 'ACCOUNT_FENCE_NOT_MINIMAL')
}

async function removeDisposableRows() {
  if (!sql || !user || !temporaryIdentityVerified || !freshDatabaseConfirmed) return
  const client = await sql.connect()
  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE')
    const rows = await readOwnRows(client)
    for (const row of rows.accounts) {
      if (row.collection === 'sessions') verify(row.payload.ownerId === ownerId, 'CLEANUP_SESSION_MISMATCH')
      if (row.collection === 'profiles') verify(row.payload.uid === user.uid && row.payload.isGuest === true, 'CLEANUP_PROFILE_MISMATCH')
      if (row.collection === 'gameData') verify(row.payload.revision === revision && isDeepStrictEqual(row.payload.payload, payload), 'CLEANUP_SAVE_MISMATCH')
    }
    if (rows.profile && !rows.profile.deleted) verify(rows.profile.uid === user.uid
      && rows.profile.createdAt >= startedAt - 60_000, 'CLEANUP_GUEST_MISMATCH')
    verify(rows.names.length <= 1 && rows.names.every(row => row.payload.owner === guestKey(user.uid)
      && row.payload.createdAt >= startedAt - 60_000), 'CLEANUP_RESERVATION_MISMATCH')
    await client.query(`DELETE FROM champions.documents WHERE namespace = $1 AND collection = ANY($2::text[]) AND key = $3`,
      ['account', ['gameData', 'profiles', 'sessions'], user.uid])
    await client.query(`DELETE FROM champions.documents WHERE namespace = $1 AND collection = $2 AND payload->>'owner' = $3`,
      [namespace, 'guestNames', guestKey(user.uid)])
    // Only the verified Firebase deletion allows removing this temporary UID's
    // security fences. A failed Auth deletion must retain stale-token blocking.
    if (authDeleted) {
      await client.query(`DELETE FROM champions.documents WHERE namespace = $1 AND collection = $2 AND key = $3`, [namespace, 'guestProfiles', guestKey(user.uid)])
      await client.query(`DELETE FROM champions.documents WHERE namespace = $1 AND collection = $2 AND key = $3`, ['account', 'guestDeletions', deletionKey(user.uid)])
    }
    await client.query('COMMIT')
    const after = await readOwnRows()
    sqlClean = after.accounts.length === 0 && after.names.length === 0 && (authDeleted ? after.profile === null && after.marker === null : false)
    verify(sqlClean || !authDeleted, 'CLEANUP_ROWS_REMAIN')
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error }
  finally { client.release() }
}

try {
  const publicEnvironment = parseEnv(await fs.readFile('.env.local', 'utf8'))
  const storageEnvironment = parseEnv(await fs.readFile('.env.storage.local', 'utf8'))
  const configuration = Object.fromEntries(Object.entries({
    apiKey: 'API_KEY', authDomain: 'AUTH_DOMAIN', projectId: 'PROJECT_ID', appId: 'APP_ID',
    storageBucket: 'STORAGE_BUCKET', messagingSenderId: 'MESSAGING_SENDER_ID',
  }).map(([key, suffix]) => [key, publicEnvironment[`VITE_FIREBASE_${suffix}`]]).filter(([, value]) => value))
  verify(['apiKey', 'authDomain', 'projectId', 'appId'].every(key => Boolean(configuration[key]))
    && configuration.projectId === 'pokemon-champions-arena-2026', 'PUBLIC_FIREBASE_CONFIG_REQUIRED')
  verify(storageEnvironment.DATABASE_URL && storageEnvironment.GAME_STORAGE_PROVIDER === 'supabase', 'SUPABASE_CONFIG_REQUIRED')
  verify(!storageEnvironment.RANKED_FIREBASE_PROJECT_ID || storageEnvironment.RANKED_FIREBASE_PROJECT_ID === configuration.projectId, 'PROJECT_CONFIG_MISMATCH')
  namespace = storageEnvironment.RANKED_FIRESTORE_PREFIX || 'ranked'
  verify(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(namespace), 'INVALID_RANKED_NAMESPACE')
  await writeRecovery()
  const [{ initializeApp, deleteApp, setLogLevel }, authSdk, { createPostgresPool }] = await Promise.all([
    import('firebase/app'), import('firebase/auth'), import('../server/postgresStore.js'),
  ])
  sdk = { ...authSdk, deleteApp }
  setLogLevel('silent')
  sql = createPostgresPool({ connectionString: storageEnvironment.DATABASE_URL, sslCa: storageEnvironment.DATABASE_SSL_CA })
  stage = 'database-preflight'
  await sql.query('SELECT 1')
  app = initializeApp(configuration, runId)
  auth = sdk.initializeAuth(app, { persistence: sdk.inMemoryPersistence })
  stage = 'fresh-anonymous-account'
  const credential = await sdk.signInAnonymously(auth)
  user = credential.user
  verify(sdk.getAdditionalUserInfo(credential)?.isNewUser === true && user.isAnonymous === true
    && user.providerData.length === 0 && !user.email
    && Date.parse(user.metadata.creationTime) >= startedAt - 60_000
    && /^[a-zA-Z0-9_-]{1,128}$/.test(user.uid), 'FRESH_ANONYMOUS_IDENTITY_REQUIRED')
  temporaryIdentityVerified = true
  await writeRecovery()
  const before = await readOwnRows()
  verify(before.accounts.length === 0 && before.profile === null && before.names.length === 0 && before.marker === null, 'FRESH_UID_ALREADY_HAS_ROWS')
  freshDatabaseConfirmed = true
  await writeRecovery()
  pass('a new in-memory anonymous identity has no pre-existing account records')

  stage = 'deployed-acquire-and-profile'
  lease = await api('sessionAcquire')
  verify(lease.ownerId === ownerId && typeof lease.version === 'string' && lease.leaseMs === 90_000, 'INVALID_LEASE')
  await writeRecovery()
  const profile = await api('guestProfile')
  verify(profile.uid === user.uid && profile.isGuest === true && /^guest-\d{6}$/.test(profile.displayName), 'INVALID_RESERVED_PROFILE')
  const ensured = await api('ensureProfile')
  verify(ensured.profile?.uid === user.uid && ensured.profile?.isGuest === true, 'INVALID_ACCOUNT_PROFILE')
  stage = 'deployed-save'
  verify((await api('save', { revision, saveSequence: 1, payload })).revision === revision, 'SAVE_REJECTED')
  const saved = await readOwnRows()
  verify(saved.accounts.length === 3 && saved.profile?.uid === user.uid && saved.names.length === 1, 'DATABASE_SETUP_MISMATCH')
  const game = saved.accounts.find(row => row.collection === 'gameData')?.payload
  verify(game?.revision === revision && isDeepStrictEqual(game.payload, payload), 'DATABASE_SAVE_MISMATCH')
  pass('production session, reserved nickname, profile and minimal save exist only for the disposable identity')

  stage = 'deployed-delete'
  lease = await api('sessionHeartbeat', { version: lease.version })
  await writeRecovery()
  const deleted = await api('deleteGuestAccount', { version: lease.version })
  verify(deleted.deleted === true && deleted.uid === user.uid, 'DELETE_NOT_CONFIRMED')
  serverDeleted = true
  await writeRecovery()
  checkDeletedRows(await readOwnRows())
  pass('production deletion removed the save, profile, session and nickname reservation with minimal hashed fences')
  verify((await api('deleteGuestAccount', { version: lease.version })).deleted === true, 'DELETE_RETRY_FAILED')
  verify((await api('sessionAcquire', {}, 410)).error?.code === 'GUEST_ACCOUNT_DELETED', 'DELETED_ACCOUNT_REACQUIRED')
  verify((await api('guestProfile', {}, 410)).error?.code === 'GUEST_ACCOUNT_DELETED', 'DELETED_GUEST_RECREATED')
  checkDeletedRows(await readOwnRows())
  pass('a lost-response retry succeeds and stale guest credentials cannot recreate account data')
  validationPassed = true
} catch (error) {
  process.exitCode = 1
  console.error(`FAIL live guest deletion: ${stage} / ${safeCode(error)}`)
} finally {
  // Best-effort cleanup is confined to this SDK-created identity. A backend
  // outage never permits widening SQL predicates or substituting another user.
  if (temporaryIdentityVerified && user && !serverDeleted && lease) {
    try {
      const result = await api('deleteGuestAccount', { version: lease.version })
      serverDeleted = result.deleted === true && result.uid === user.uid
    } catch { /* Direct owned-row cleanup follows; preserve recovery if it fails. */ }
  }
  if (temporaryIdentityVerified && user && sdk) {
    try {
      await sdk.reload(user)
      verify(user.isAnonymous === true && !user.email && user.providerData.length === 0, 'CLEANUP_IDENTITY_CHANGED')
      await sdk.deleteUser(user)
      authDeleted = true
    } catch (error) {
      if (error?.code === 'auth/user-not-found') authDeleted = true
      else { cleanupFailed = true; console.error(`FAIL temporary Firebase cleanup: ${safeCode(error)}`) }
    }
  }
  try { await removeDisposableRows() }
  catch (error) { cleanupFailed = true; console.error(`FAIL temporary SQL cleanup: ${safeCode(error)}`) }
  try { await writeRecovery() }
  catch { cleanupFailed = true; console.error('FAIL recovery record: RECOVERY_WRITE_FAILED') }
  if (app && sdk) await sdk.deleteApp(app).catch(() => {})
  if (sql) await sql.end().catch(() => {})
  if (cleanupFailed || (user && (!authDeleted || !sqlClean))) {
    process.exitCode = 1
    console.error(`Recovery information is retained only in the ignored file: ${recoveryPath}`)
  } else if (user) pass('the disposable Firebase identity and its exact SQL rows were cleaned up')
}
console.log(`Live guest deletion validation: ${checks} checks; ${validationPassed ? 'verified' : 'not verified'}. No queue, battle, usage or leaderboard test data was submitted.`)
