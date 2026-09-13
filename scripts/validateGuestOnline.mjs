import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { loadEnv } from 'vite'
import { getApp, deleteApp } from 'firebase-admin/app'
import { initializeProductionServices } from '../server/productionServices.js'
import { createPostgresPool } from '../server/postgresStore.js'
import { createRankedService } from '../server/rankedService.js'
import { createRankedHttpHandler } from '../server/rankedHttp.js'
import { createAccountService, createAccountRankedTeamResolver } from '../server/accountService.js'
import { createAccountHttpHandler } from '../server/accountHttp.js'
import * as engine from '../server/rankedBattle.js'
import { createRankedTestTeams } from './rankedDevServer.mjs'
import { normalizePokemon } from '../src/data/trainingData.js'
import { createFactoryRun, selectFactoryRentals, selectFactoryLead, beginFactoryBattle, resolveFactoryBattle } from '../src/data/battleFactory.js'
import { createFactoryRankingSubmission } from '../src/data/battleFactoryRanking.js'

// Opt-in live validation: fresh Firebase anonymous identities, real HTTP/API/SQL,
// one unique ranked namespace and account rows belonging only to those fresh UIDs.
// Existing players, production queues and rehearsal namespaces remain untouched.
const args = process.argv.slice(2)
const credentialPath = args[args.indexOf('--credentials') + 1]
if (!args.includes('--credentials') || !credentialPath || process.env.VERCEL) {
  console.error('Usage: node scripts/validateGuestOnline.mjs --credentials <service-account-json>')
  process.exit(1)
}
const environment = loadEnv('storage', process.cwd(), '')
const credential = JSON.parse(await fs.readFile(credentialPath, 'utf8'))
assert.equal(environment.GAME_STORAGE_PROVIDER, 'supabase')
assert(environment.DATABASE_URL && environment.VITE_FIREBASE_PROJECT_ID === credential.project_id)
const prefix = `guest_validation_${Date.now()}_${randomUUID().slice(0, 8)}`
const manifestPath = `scripts/.cache/guest-live-validation/${prefix}.json`
const users = [], checks = []
const freshAccountUids = new Set()
const report = message => { checks.push(message); console.log(`PASS ${message}`) }
let stage = 'initialization', services, sql, httpServer, baseUrl
let deletedAccounts = 0, deletedSqlRows = 0, cleanupErrors = 0
let ownsRankedNamespace = false

async function manifest(complete = false) {
  await fs.mkdir('scripts/.cache/guest-live-validation', { recursive: true })
  await fs.writeFile(manifestPath, JSON.stringify({ prefix, uids: users.map(user => user.uid), complete,
    deletedAccounts, deletedSqlRows, cleanupErrors }, null, 2))
}
async function jsonFetch(url, options) {
  const response = await fetch(url, options)
  const value = await response.json()
  if (!response.ok) throw Object.assign(new Error('Remote validation request failed'), {
    code: value.error?.status ?? value.error?.code ?? response.status, service: new URL(url).hostname,
  })
  return value
}
async function call(index, action, payload = {}, { account = false, expectStatus = 200 } = {}) {
  const readOnly = !account && ['status', 'usage', 'factoryLeaderboard'].includes(action)
  const url = new URL(account ? '/api/account' : '/api/ranked', baseUrl)
  if (readOnly) for (const [key, value] of Object.entries({ action, ...payload })) url.searchParams.set(key, value)
  const response = await fetch(url, { method: readOnly ? 'GET' : 'POST', headers: {
    Authorization: `Bearer ${users[index].idToken}`, 'Content-Type': 'application/json',
  }, ...(!readOnly ? { body: JSON.stringify({ action, ...(!account ? { requestId: randomUUID() } : {}), ...payload }) } : {}) })
  const value = await response.json()
  assert.equal(response.status, expectStatus, `${action}: ${value.error?.code ?? response.status}`)
  return value
}
const accountCall = (index, action, payload = {}, options) => call(index, action, {
  ownerId: users[index].ownerId, ...payload,
}, { account: true, ...options })

try {
  stage = 'postgres-preflight'
  sql = createPostgresPool({ connectionString: environment.DATABASE_URL, sslCa: environment.DATABASE_SSL_CA })
  assert.equal(Number((await sql.query('SELECT count(*) FROM champions.documents WHERE namespace = $1', [prefix])).rows[0].count), 0)
  ownsRankedNamespace = true
  services = await initializeProductionServices({ env: { ...environment, GAME_STORAGE_PROVIDER: 'supabase',
    RANKED_FIRESTORE_PREFIX: prefix, RANKED_FIREBASE_PROJECT_ID: credential.project_id,
    RANKED_FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(credential) } })
  assert.equal(services.firestore, null)
  assert.equal(services.provider, 'supabase')
  const rankedService = createRankedService({ store: services.rankedStore, engine,
    resolveTeam: createAccountRankedTeamResolver(services.accountStore), usageEnabled: true, guestRegistry: services.guestRegistry })
  const rankedHandler = createRankedHttpHandler({ service: rankedService, enabled: true, authenticate: services.authenticate })
  const accountHandler = createAccountHttpHandler({ service: createAccountService({ store: services.accountStore,
    guestRegistry: services.guestRegistry }), authenticate: services.authenticate })
  httpServer = createServer(async (incoming, outgoing) => {
    try {
      const chunks = []
      for await (const chunk of incoming) chunks.push(chunk)
      const body = Buffer.concat(chunks)
      const request = new Request(new URL(incoming.url, baseUrl), { method: incoming.method,
        headers: incoming.headers, ...(body.length ? { body } : {}) })
      const result = await (new URL(request.url).pathname === '/api/account' ? accountHandler(request) : rankedHandler(request))
      outgoing.writeHead(result.status, Object.fromEntries(result.headers))
      outgoing.end(Buffer.from(await result.arrayBuffer()))
    } catch { outgoing.writeHead(500); outgoing.end('{"error":{"code":"TEST_HTTP_FAILURE"}}') }
  })
  await new Promise(resolve => httpServer.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${httpServer.address().port}`
  const teams = createRankedTestTeams().map(team => engine.canonicalizeRankedTeam(team.pokemon, { format: 'single' }).map(normalizePokemon))
  for (let index = 0; index < 2; index++) {
    stage = `create-anonymous-${index}`
    const account = await jsonFetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${environment.VITE_FIREBASE_API_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }),
    })
    users.push({ uid: account.localId, idToken: account.idToken, refreshToken: account.refreshToken, ownerId: `guest-validation-${randomUUID()}` })
    await manifest()
    stage = `verify-anonymous-${index}`
    const identity = await services.authenticate(null, account.idToken)
    assert.equal(identity.isGuest, true)
    assert.equal(identity.uid, account.localId)
    assert.equal(Number((await sql.query('SELECT count(*) FROM champions.documents WHERE namespace = $1 AND key = $2', ['account', account.localId])).rows[0].count), 0)
    freshAccountUids.add(account.localId)
    stage = `session-${index}`
    users[index].lease = await accountCall(index, 'sessionAcquire')
    assert.equal(users[index].lease.leaseMs, 90_000)
  }
  report('two real Firebase anonymous tokens acquire authenticated SQL-backed sessions over HTTP')
  stage = 'guest-profiles'
  const profiles = await Promise.all([call(0, 'guestProfile'), call(1, 'guestProfile')])
  profiles.forEach(profile => assert.match(profile.displayName, /^guest-\d{6}$/))
  assert.notEqual(profiles[0].displayName, profiles[1].displayName)
  assert.deepEqual(await call(0, 'guestProfile'), profiles[0])
  report('real anonymous accounts receive distinct persistent SQL-reserved guest names')
  for (let index = 0; index < 2; index++) {
    stage = `save-account-${index}`
    await accountCall(index, 'ensureProfile')
    const inventory = Object.fromEntries(teams[index].filter(pokemon => pokemon.heldItemId).map(pokemon => [pokemon.heldItemId, 1]))
    const payload = { 'champions-dex-v2': JSON.stringify(teams[index]), 'champions-battle-items-v1': JSON.stringify(inventory),
      'champions-vp-v1': '50000', 'champions-draw-tutorial-v1': 'complete' }
    const revision = randomUUID()
    assert.equal((await accountCall(index, 'save', { revision, payload, saveSequence: 1 })).revision, revision)
    assert.deepEqual((await accountCall(index, 'load')).gameData.payload, payload)
    const denied = await accountCall(index, 'load', { ownerId: `foreign-session-${randomUUID()}` }, { expectStatus: 409 })
    assert.equal(denied.error.code, 'account-session/lost')
    const duplicate = await accountCall(index, 'sessionAcquire', { ownerId: `other-window-${randomUUID()}` }, { expectStatus: 409 })
    assert.equal(duplicate.error.code, 'account-session/occupied')
    users[index].lease = await accountCall(index, 'sessionHeartbeat', { version: users[index].lease.version })
    if (index === 0) {
      const newerRevision = randomUUID()
      const newerPayload = { ...payload, 'champions-vp-v1': '50001' }
      await accountCall(index, 'save', { revision: newerRevision, payload: newerPayload, saveSequence: 3 })
      const stale = await accountCall(index, 'save', { revision: randomUUID(), payload, saveSequence: 2 }, { expectStatus: 409 })
      assert.equal(stale.error.code, 'STALE_SAVE')
      assert.equal((await accountCall(index, 'load')).gameData.payload['champions-vp-v1'], '50001')
      // PostgreSQL JSONB reorders object keys; equivalent retry payloads must
      // remain idempotent regardless of their serialized property order.
      const reordered = Object.fromEntries(Object.entries(newerPayload).reverse())
      assert.equal((await accountCall(index, 'save', { revision: newerRevision, payload: reordered, saveSequence: 3 })).revision, newerRevision)
      await accountCall(index, 'save', { revision: randomUUID(), payload, saveSequence: 4 })
    }
  }
  report('actual SQL profile/save/load works; wrong owners and simultaneous windows are rejected')
  report('real SQL rejects a delayed older save and accepts equivalent JSONB retry payloads')
  for (const format of ['single', 'double']) {
    stage = `match-${format}`
    await call(0, 'join', { format, team: teams[0] })
    const match = (await call(1, 'join', { format, team: teams[1] })).match
    assert.equal(match.phase, 'select')
    assert.equal(match.you.name, profiles[1].displayName)
    assert.equal(match.opponent.name, profiles[0].displayName)
    const selected = { matchId: match.id, revision: match.revision, selection: format === 'single' ? [0, 1, 2] : [0, 1, 2, 3] }
    await Promise.all([call(0, 'select', selected), call(1, 'select', selected)])
    const snapshots = await Promise.all([call(0, 'status'), call(1, 'status')])
    assert.equal(snapshots[0].match.phase, 'battle')
    assert.equal(snapshots[0].match.state.player.name, profiles[0].displayName)
    assert.equal(snapshots[0].match.state.opponent.name, profiles[1].displayName)
    await call(0, 'forfeit', { matchId: match.id })
    const winner = await call(1, 'status', { matchId: match.id })
    assert.equal(winner.match.result.outcome, 'win')
    assert.equal(winner.profile[format].wins, 1)
    assert.equal(winner.vpRewards.total, format === 'single' ? 600 : 1200)
    assert.equal((await call(1, 'status')).match, null)
    const usage = await call(0, 'usage')
    assert.equal(usage.buckets[`ranked-${format}`].teamCount, 2)
    report(`${format}: real guest owned-team matchmaking, forfeit, VP settlement and usage aggregation`)
  }
  stage = 'factory-leaderboard'
  let run = createFactoryRun({ seed: 'guest-online-validation', id: `guest-factory-${randomUUID()}` })
  run = selectFactoryRentals(run, run.offers.slice(0, 3).map(pokemon => pokemon.captureId))
  run = selectFactoryLead(run, run.party[0].captureId)
  run = beginFactoryBattle(run)
  run = resolveFactoryBattle(run, { battleId: run.battleId, winner: 'opponent', forfeited: true })
  const submission = createFactoryRankingSubmission(run)
  const saved = await call(0, 'reportFactoryRun', { report: submission })
  assert.equal(saved.entries.length, 1)
  assert.equal(saved.entries[0].trainerName, profiles[0].displayName)
  assert.deepEqual(saved.entries[0].party, submission.party)
  assert.deepEqual((await call(1, 'factoryLeaderboard')).entries, saved.entries)
  report('factory final team, held items and moves persist and are shared through the real SQL leaderboard')
  stage = 'refresh-credentials'
  const refreshed = await jsonFetch(`https://securetoken.googleapis.com/v1/token?key=${environment.VITE_FIREBASE_API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: users[0].refreshToken }),
  })
  users[0].idToken = refreshed.id_token
  assert.equal(refreshed.user_id, users[0].uid)
  assert.deepEqual(await call(0, 'guestProfile'), profiles[0])
  await accountCall(0, 'sessionRelease', { version: users[0].lease.version })
  const oldOwner = users[0].ownerId
  users[0].ownerId = `reloaded-window-${randomUUID()}`
  users[0].lease = await accountCall(0, 'sessionAcquire')
  const staleRelease = await accountCall(0, 'sessionRelease', { ownerId: oldOwner, version: 'stale-old-version' })
  assert.equal(staleRelease.released, false)
  assert.equal((await accountCall(0, 'load')).gameData.payload['champions-vp-v1'], '50000')
  assert.deepEqual((await call(0, 'factoryLeaderboard')).entries, saved.entries)
  report('credential refresh and new-window session preserve UID, nickname, saved team and factory record')
} catch (error) {
  console.error(`FAIL guest live validation: ${JSON.stringify({ stage, code: error.code ?? 'VALIDATION_FAILED', service: error.service,
    createdUsers: users.length, assertion: error.code === 'ERR_ASSERTION' ? error.message : undefined })}`)
  process.exitCode = 1
} finally {
  if (httpServer) await new Promise(resolve => httpServer.close(resolve))
  // Cleanup operations are independent: still remove every fresh identity when
  // a database cleanup fails, and report the actual number created and removed.
  if (sql && ownsRankedNamespace) try {
    assert.match(prefix, /^guest_validation_\d{13}_[a-f0-9]{8}$/)
    const total = Number((await sql.query('SELECT count(*) FROM champions.documents WHERE namespace = $1', [prefix])).rows[0].count)
    assert(total <= 100, 'Unexpected validation namespace size')
    deletedSqlRows += (await sql.query('DELETE FROM champions.documents WHERE namespace = $1', [prefix])).rowCount
    if (freshAccountUids.size) {
      const uids = [...freshAccountUids]
      assert(uids.every(uid => users.some(user => user.uid === uid)))
      deletedSqlRows += (await sql.query('DELETE FROM champions.documents WHERE namespace = $1 AND key = ANY($2::text[])', ['account', uids])).rowCount
      assert.equal(Number((await sql.query('SELECT count(*) FROM champions.documents WHERE namespace = $1 AND key = ANY($2::text[])', ['account', uids])).rows[0].count), 0)
    }
    assert.equal(Number((await sql.query('SELECT count(*) FROM champions.documents WHERE namespace = $1', [prefix])).rows[0].count), 0)
  } catch (error) { cleanupErrors += 1; console.error(`FAIL SQL cleanup: ${error.code ?? 'CLEANUP_FAILED'}`); process.exitCode = 1 }
  for (const user of users) try {
    const info = await jsonFetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${environment.VITE_FIREBASE_API_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: user.idToken }),
    })
    assert.equal(info.users[0].localId, user.uid)
    assert.equal(info.users[0].providerUserInfo?.length ?? 0, 0, 'Never delete a linked account')
    await jsonFetch(`https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${environment.VITE_FIREBASE_API_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: user.idToken }),
    })
    deletedAccounts += 1
  } catch (error) { cleanupErrors += 1; console.error(`FAIL temporary account cleanup: ${error.code ?? 'CLEANUP_FAILED'}`); process.exitCode = 1 }
  if (services) await services.close()
  if (sql) await sql.end()
  try { await deleteApp(getApp('ranked-server')) } catch {}
  await manifest(cleanupErrors === 0)
  if (!cleanupErrors) report(`${deletedSqlRows} isolated SQL records and ${deletedAccounts}/${users.length} created temporary anonymous accounts cleaned up`)
}
console.log(`Guest live validation: ${checks.length} checks passed; production matchmaking was not used`)
