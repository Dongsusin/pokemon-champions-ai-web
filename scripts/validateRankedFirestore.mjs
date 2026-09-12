import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createMemoryRankedStore, createFirestoreRankedStore } from '../server/rankedStore.js'
import { createRankedService } from '../server/rankedService.js'
import * as engine from '../server/rankedBattle.js'
import { createRankedTestTeams } from './rankedDevServer.mjs'

const COLLECTIONS = Object.freeze(['players', 'queue', 'matches', 'timelines', 'meta'])
const NAMESPACE_PATTERN = /^ranked_validation_[0-9]{13}_[a-f0-9]{8}$/
const usage = `Usage:
  node scripts/validateRankedFirestore.mjs --dry-run
  node scripts/validateRankedFirestore.mjs --credentials <service-account-json> [--project-id <expected-project>]
  node scripts/validateRankedFirestore.mjs  (uses GOOGLE_APPLICATION_CREDENTIALS)

Uses two synthetic service identities, NOT Firebase Authentication users.
Validates the real battle service and Firestore adapter, NOT two real users over the public API.
Only a newly generated ranked_validation_<timestamp>_<uuid> namespace is written.
Its five collections are cleaned and verified empty in finally; real players/ and production ranked collections are never written.
--dry-run reads no credentials and uses only an in-memory store.`

function fail(code) { throw Object.assign(new Error(code), { validationCode: code }) }

async function settledTogether(operations) {
  // Await every concurrent transaction before cleanup can start, including when
  // one fails. Otherwise a late transaction could recreate an already deleted doc.
  const results = await Promise.allSettled(operations)
  const failure = results.find(result => result.status === 'rejected')
  if (failure) throw failure.reason
  return results.map(result => result.value)
}

function optionsFrom(args) {
  const options = { dryRun: false, help: false }
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index]
    if (flag === '--dry-run') options.dryRun = true
    else if (flag === '--help') options.help = true
    else if (flag === '--credentials' || flag === '--project-id') {
      const value = args[++index]
      if (!value || value.startsWith('--')) fail('MISSING_ARGUMENT')
      const key = flag === '--credentials' ? 'credentials' : 'projectId'
      if (options[key]) fail('DUPLICATE_ARGUMENT')
      options[key] = value
    } else fail('UNSUPPORTED_ARGUMENT')
  }
  return options
}

function namespaceCollections(firestore, prefix) {
  if (!NAMESPACE_PATTERN.test(prefix) || prefix === 'ranked') fail('UNSAFE_NAMESPACE')
  return COLLECTIONS.map(kind => firestore.collection(`${prefix}_${kind}`))
}

async function assertEmptyNamespace(firestore, prefix) {
  const collections = namespaceCollections(firestore, prefix)
  const snapshots = await settledTogether(collections.map(collection => collection.limit(1).get()))
  if (snapshots.some(snapshot => !snapshot.empty)) fail('NAMESPACE_NOT_EMPTY')
}

async function cleanNamespace(firestore, prefix) {
  let deleted = 0
  for (const collection of namespaceCollections(firestore, prefix)) {
    // No recursive collection/project deletion. References must be direct children
    // of this run's exact collection, whose emptiness was checked before writing.
    for (let page = 0; page < 20; page += 1) {
      const snapshot = await collection.limit(200).get()
      if (snapshot.empty) break
      const batch = firestore.batch()
      for (const document of snapshot.docs) {
        if (document.ref.parent.path !== collection.path || document.ref.path.split('/').length !== 2) fail('UNSAFE_CLEANUP_REFERENCE')
        batch.delete(document.ref)
      }
      await batch.commit()
      deleted += snapshot.size
      if (page === 19) fail('CLEANUP_LIMIT_REACHED')
    }
  }
  await assertEmptyNamespace(firestore, prefix)
  return deleted
}

function attackingActions(state) {
  return state.commandOptions.map(option => {
    if (option.forcedAction) return { ...option.forcedAction, actorSlot: option.actorSlot }
    const move = option.moves.find(candidate => !candidate.disabled && candidate.preview.power > 0)
    assert.ok(move, 'fixture requires an available damaging move')
    const target = move.targets.find(candidate => candidate.sideId === 'opponent') ?? move.targets[0]
    return {
      type: 'move', actorSlot: option.actorSlot, moveIndex: move.moveIndex,
      ...(target ? { targetSideId: target.sideId, targetSlot: target.slot } : {}),
    }
  })
}

async function exerciseBattleService(makeStore, report, checkpoint = () => {}) {
  const identities = [
    { uid: 'validation-synthetic-a', name: 'Synthetic service fixture A' },
    { uid: 'validation-synthetic-b', name: 'Synthetic service fixture B' },
  ]
  const fixtures = createRankedTestTeams().map(team => engine.canonicalizeRankedTeam(team.pokemon))
  const fixtureByUid = new Map(identities.map((identity, index) => [identity.uid, fixtures[index]]))
  const createService = () => createRankedService({
    store: makeStore(), engine,
    // Deliberately no production ownership resolver: these service-only fixture
    // identities have no Firebase Auth users and no players/{uid} save records.
    resolveTeam: async identity => structuredClone(fixtureByUid.get(identity.uid)),
    makeSeed: () => 123456,
  })
  let service = createService()
  const call = async (index, action, body = {}) => {
    checkpoint()
    return service.execute(identities[index], {
      action, ...(action === 'status' ? {} : { requestId: `validation-${randomUUID()}` }), ...body,
    })
  }

  for (const format of ['single', 'double']) {
    const queued = await call(0, 'join', { format, team: fixtures[0] })
    assert.equal(queued.match, null)
    assert.equal(queued.queue.format, format)
    let match = (await call(1, 'join', { format, team: fixtures[1] })).match
    assert.equal(match.phase, 'select')
    assert.equal(match.you.name, identities[1].name)
    assert.equal(match.opponent.name, identities[0].name)
    report(`${format}: queue and two-sided match`)

    const selection = format === 'single' ? [0, 1, 2] : [0, 1, 2, 3]
    const chosen = { matchId: match.id, revision: match.revision, selection }
    await settledTogether([call(0, 'select', chosen), call(1, 'select', chosen)])
    let snapshots = await settledTogether([call(0, 'status'), call(1, 'status')])
    match = snapshots[0].match
    assert.equal(match.phase, 'battle')
    for (const snapshot of snapshots) {
      assert.equal(snapshot.match.state.player.team.length, selection.length)
      assert.equal(snapshot.match.state.commandOptions.length, format === 'single' ? 1 : 2)
    }
    const submitted = snapshots.map(snapshot => ({
      matchId: match.id, revision: match.revision, actions: attackingActions(snapshot.match.state),
    }))
    await settledTogether([call(0, 'submit', submitted[0]), call(1, 'submit', submitted[1])])
    snapshots = await settledTogether([call(0, 'status'), call(1, 'status')])
    assert.ok(snapshots.some(snapshot => snapshot.match.state.player.team.some(pokemon => pokemon.hp < pokemon.maxHp)), 'real moves must cause damage')
    assert.ok(snapshots[0].match.timeline.length > 0, 'real timeline must survive persistence')
    report(`${format}: concurrent selections/actions and real-engine damage`)

    for (let safety = 0; safety < 8; safety += 1) {
      const awaiting = snapshots.findIndex(snapshot => snapshot.match.state.awaitingPlayerSwitch)
      if (awaiting < 0) break
      const pending = snapshots[awaiting].match
      assert.ok(pending.state.replacementIndexes.length > 0)
      await call(awaiting, 'replace', { matchId: pending.id, revision: pending.revision, targetIndex: pending.state.replacementIndexes[0] })
      snapshots = await settledTogether([call(0, 'status'), call(1, 'status')])
    }
    assert.ok(snapshots.every(snapshot => !snapshot.match.state.awaitingPlayerSwitch))
    const persisted = snapshots.map(snapshot => ({ id: snapshot.match.id, revision: snapshot.match.revision, state: snapshot.match.state }))
    service = createService()
    snapshots = await settledTogether([call(0, 'status'), call(1, 'status')])
    assert.deepEqual(snapshots.map(snapshot => ({ id: snapshot.match.id, revision: snapshot.match.revision, state: snapshot.match.state })), persisted)
    report(`${format}: a fresh service/adapter restores the persisted match`)

    const retryBody = { matchId: match.id, requestId: `validation-forfeit-${randomUUID()}` }
    await settledTogether([call(0, 'forfeit', retryBody), call(0, 'forfeit', retryBody)])
    await call(0, 'forfeit', { matchId: match.id })
    service = createService()
    const [loser, winner] = await settledTogether([call(0, 'status'), call(1, 'status')])
    assert.equal(loser.match.result.outcome, 'loss')
    assert.equal(winner.match.result.outcome, 'win')
    assert.equal(loser.profile[format].played, 1)
    assert.equal(loser.profile[format].losses, 1)
    assert.equal(loser.profile[format].points, 0)
    assert.equal(winner.profile[format].played, 1)
    assert.equal(winner.profile[format].wins, 1)
    assert.equal(winner.profile[format].points, 30)
    assert.equal(loser.profile[format].rating, 984)
    assert.equal(winner.profile[format].rating, 1016)
    const otherFormat = format === 'single' ? 'double' : 'single'
    assert.equal(winner.profile[otherFormat].played, format === 'single' ? 0 : 1)
    report(`${format}: duplicate forfeit settles both ratings exactly once`)
  }

  const store = makeStore()
  checkpoint()
  await store.transaction(async tx => {
    const players = await tx.list('players')
    const matches = await tx.list('matches')
    assert.equal(players.length, 2)
    assert.equal(matches.length, 2)
    assert.equal((await tx.list('queue')).length, 0)
    for (const player of players) assert.ok(identities.some(identity => identity.uid === player.uid))
    for (const match of matches) {
      assert.equal(match.phase, 'finished')
      assert.ok(Buffer.byteLength(JSON.stringify(match), 'utf8') < 850_000)
      for (let index = 0; index < match.timelineChunks; index += 1) {
        const chunk = await tx.get('timelines', `${match.id}_${match.timelineRevision}_${index}`)
        assert.ok(chunk?.frames.length > 0)
        assert.ok(Buffer.byteLength(JSON.stringify(chunk), 'utf8') < 850_000)
      }
    }
  })
  report('isolated documents, empty queues and bounded timeline storage')
}

function safeErrorCode(error) {
  if (/^[A-Z_]{3,50}$/.test(error?.validationCode ?? '')) return error.validationCode
  if (error?.code === 'ERR_ASSERTION') return 'ASSERTION_FAILED'
  if (Number.isInteger(error?.code) && error.code >= 0 && error.code <= 16) return `GRPC_${error.code}`
  if (['app/invalid-credential', 'app/network-error', 'app/network-timeout'].includes(error?.code)) return error.code
  return 'VALIDATION_FAILED'
}

async function main() {
  const options = optionsFrom(process.argv.slice(2))
  if (options.help) { console.log(usage); return }
  if (process.env.VERCEL) fail('LOCAL_RUNNER_REQUIRED')
  let passed = 0
  const report = message => { passed += 1; console.log(`PASS ${message}`) }
  console.log('Scope: synthetic service identities, not Firebase Auth accounts or public-API user tests.')
  if (options.dryRun) {
    console.log('DRY RUN: memory only; credentials are not read; no network or Firestore writes.')
    const store = createMemoryRankedStore()
    try { await exerciseBattleService(() => store, report) } finally { await store.close() }
    console.log(`Dry validation passed: ${passed} checks; remote Firestore was not tested.`)
    return
  }

  const credentialPath = options.credentials ?? process.env.GOOGLE_APPLICATION_CREDENTIALS
  if (!credentialPath) fail('CREDENTIALS_REQUIRED')
  let credential
  try { credential = JSON.parse(await readFile(credentialPath, 'utf8')) } catch { fail('CREDENTIAL_FILE_UNREADABLE') }
  if (credential?.type !== 'service_account' || !/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(credential.project_id ?? '')
    || typeof credential.private_key !== 'string' || typeof credential.client_email !== 'string') fail('INVALID_SERVICE_ACCOUNT')
  const expectedProject = options.projectId ?? process.env.RANKED_FIREBASE_PROJECT_ID
  if (expectedProject && credential.project_id !== expectedProject) fail('PROJECT_MISMATCH')
  const prefix = `ranked_validation_${Date.now()}_${randomUUID().replaceAll('-', '').slice(0, 8)}`
  if (!NAMESPACE_PATTERN.test(prefix)) fail('UNSAFE_NAMESPACE')
  console.log(`Isolated namespace: ${prefix}`)

  let app, firestore, deleteApp, namespaceOwned = false, successful = false, interrupted = false
  const onSignal = () => { interrupted = true; console.error('INTERRUPTED: waiting for in-flight operations before validation cleanup.') }
  const checkpoint = () => { if (interrupted) fail('INTERRUPTED') }
  process.on('SIGINT', onSignal)
  process.on('SIGTERM', onSignal)
  try {
    const sdk = await import('firebase-admin/app')
    deleteApp = sdk.deleteApp
    app = sdk.initializeApp({ projectId: credential.project_id, credential: sdk.cert(credential) }, prefix)
    credential = null
    const { getFirestore } = await import('firebase-admin/firestore')
    firestore = getFirestore(app)
    await assertEmptyNamespace(firestore, prefix)
    namespaceOwned = true
    checkpoint()
    const makeStore = () => createFirestoreRankedStore(firestore, { prefix })
    await exerciseBattleService(makeStore, report, checkpoint)
    successful = true
  } finally {
    let cleanupError
    if (firestore && namespaceOwned) {
      try {
        const deleted = await cleanNamespace(firestore, prefix)
        console.log(`PASS cleanup: ${deleted} validation documents removed; all five collections verified empty.`)
      } catch (error) {
        cleanupError = error
        console.error(`CLEANUP_FAILED namespace=${prefix} code=${safeErrorCode(error)}`)
      }
    }
    if (app && deleteApp) {
      try { await deleteApp(app) } catch (error) { cleanupError ??= error }
    }
    process.removeListener('SIGINT', onSignal)
    process.removeListener('SIGTERM', onSignal)
    if (cleanupError) fail('CLEANUP_OR_SHUTDOWN_FAILED')
  }
  if (successful) console.log(`Firestore integration passed: ${passed} checks plus verified cleanup. No real account profiles or scores were modified.`)
}

main().catch(error => {
  // Never print SDK error messages, stack traces, credentials or token material.
  console.error(`Firestore validation failed: ${safeErrorCode(error)}`)
  process.exitCode = 1
})
