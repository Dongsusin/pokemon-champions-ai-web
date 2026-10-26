import assert from 'node:assert/strict'
import { setImmediate as nextTurn } from 'node:timers/promises'
import {
  ACCOUNT_SESSION_ERROR_CODES,
  ACCOUNT_SESSION_HEARTBEAT_MS,
  ACCOUNT_SESSION_LEASE_MS,
  acquireAccountSession,
  hasActiveAccountSession,
} from '../src/auth/accountSession.js'

// Exercise the actual session client against an atomic in-memory Firestore REST
// model. Separate browser objects model devices without shared client storage.
const epoch = Date.parse('2026-01-01T00:00:00.000Z')
const checks = []
const useCloudflare = process.argv.includes('--cloudflare')
const useAccountApi = useCloudflare || process.argv.includes('--supabase')
const isReleaseRequest = request => useAccountApi
  ? JSON.parse(request.body ?? '{}').action === 'sessionRelease' : request.method === 'DELETE'

async function settle() {
  for (let index = 0; index < 4; index += 1) await nextTurn()
}

class MemoryStorage {
  values = new Map()
  getItem(key) { return this.values.get(key) ?? null }
  setItem(key, value) { this.values.set(key, String(value)) }
  removeItem(key) { this.values.delete(key) }
}

class FakeTimers {
  now = epoch
  sequence = 0
  tasks = new Map()

  setTimeout = (callback, delay) => {
    const id = ++this.sequence
    this.tasks.set(id, { callback, at: this.now + delay })
    return id
  }

  clearTimeout = (id) => { this.tasks.delete(id) }

  async advance(duration) {
    const target = this.now + duration
    while (true) {
      const entry = [...this.tasks].filter(([, task]) => task.at <= target)
        .sort((left, right) => left[1].at - right[1].at)[0]
      if (!entry) break
      this.now = entry[1].at
      this.tasks.delete(entry[0])
      entry[1].callback()
      await settle()
    }
    this.now = target
    await settle()
  }
}

class Browser {
  window = new EventTarget()
  document = new EventTarget()

  constructor({ locks } = {}) {
    this.window.localStorage = new MemoryStorage()
    this.window.sessionStorage = new MemoryStorage()
    this.document.visibilityState = 'visible'
    this.navigator = { onLine: true, ...(locks ? { locks } : {}) }
  }

  hide() {
    this.document.visibilityState = 'hidden'
    this.document.dispatchEvent(new Event('visibilitychange'))
  }

  show() {
    this.document.visibilityState = 'visible'
    this.document.dispatchEvent(new Event('visibilitychange'))
  }

  close() { this.window.dispatchEvent(new Event('pagehide')) }
  offline() {
    this.navigator.onLine = false
    this.window.dispatchEvent(new Event('offline'))
  }
}

class WebLocks {
  held = new Set()

  request = async (name, options, callback) => {
    assert.equal(options.ifAvailable, true, 'a second window must not wait indefinitely')
    if (this.held.has(name)) return callback(null)
    this.held.add(name)
    try { return await callback({ name }) } finally { this.held.delete(name) }
  }
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

class FirestoreServer {
  documents = new Map()
  requests = []
  revision = 0
  unavailable = false
  delayedCommitResponse = null
  delayedDelete = null

  constructor(timers) { this.timers = timers }

  nextVersion() {
    this.revision += 1
    return new Date(epoch + this.revision).toISOString()
  }

  error(status, code) {
    return jsonResponse(status, { error: { code: status, status: code, message: code } })
  }

  fetch = async (input, options = {}) => {
    const url = new URL(input)
    const method = options.method ?? 'GET'
    this.requests.push({ url: url.href, method, keepalive: options.keepalive, body: options.body })
    if (this.unavailable) throw new TypeError('Simulated network failure')
    assert.match(options.headers.Authorization ?? options.headers.authorization, /^Bearer test-token-/)

    if (method === 'POST' && url.pathname.endsWith('/documents:commit')) {
      const body = JSON.parse(options.body)
      assert.equal(body.writes.length, 1)
      const write = body.writes[0]
      const key = write.update.name
      const current = this.documents.get(key)
      if (write.currentDocument?.exists === false && current) return this.error(409, 'ALREADY_EXISTS')
      if (write.currentDocument?.updateTime && write.currentDocument.updateTime !== current?.updateTime) {
        return this.error(400, 'FAILED_PRECONDITION')
      }
      if (current && current.fields.ownerId.stringValue !== write.update.fields.ownerId.stringValue
        && Date.parse(current.fields.heartbeatAt.timestampValue) + ACCOUNT_SESSION_LEASE_MS > this.timers.now) {
        return this.error(403, 'PERMISSION_DENIED')
      }
      const heartbeatAt = new Date(this.timers.now).toISOString()
      const updateTime = this.nextVersion()
      const fields = structuredClone(write.update.fields)
      assert.ok(write.updateTransforms.some((transform) => (
        transform.fieldPath === 'heartbeatAt' && transform.setToServerValue === 'REQUEST_TIME'
      )), 'lease timestamps must be assigned by Firestore')
      fields.heartbeatAt = { timestampValue: heartbeatAt }
      this.documents.set(key, { name: key, fields, updateTime })
      const response = jsonResponse(200, {
        commitTime: heartbeatAt,
        writeResults: [{ updateTime, transformResults: [{ timestampValue: heartbeatAt }] }],
      })
      if (this.delayedCommitResponse) {
        const pending = this.delayedCommitResponse
        this.delayedCommitResponse = null
        pending.started.resolve()
        await pending.resume.promise
      }
      return response
    }

    const key = decodeURIComponent(url.pathname.replace(/^\/v1\//, ''))
    if (method === 'GET') {
      const current = this.documents.get(key)
      return current ? jsonResponse(200, current) : this.error(404, 'NOT_FOUND')
    }
    if (method === 'DELETE') {
      if (this.delayedDelete) {
        const pending = this.delayedDelete
        this.delayedDelete = null
        pending.started.resolve()
        await pending.resume.promise
      }
      const current = this.documents.get(key)
      if (!current) return this.error(404, 'NOT_FOUND')
      const version = url.searchParams.get('currentDocument.updateTime')
      assert.ok(version, 'release must carry the exact owned document version')
      if (version !== current.updateTime) return this.error(400, 'FAILED_PRECONDITION')
      this.documents.delete(key)
      return jsonResponse(200, {})
    }
    throw new Error(`Unexpected Firestore request: ${method} ${url}`)
  }

  seedExpired(uid, ownerId = 'old-device-owner') {
    const key = `projects/test-project/databases/(default)/documents/accountSessions/${uid}`
    this.documents.set(key, {
      name: key,
      fields: {
        ownerId: { stringValue: ownerId },
        heartbeatAt: { timestampValue: new Date(this.timers.now - ACCOUNT_SESSION_LEASE_MS - 1).toISOString() },
      },
      updateTime: this.nextVersion(),
    })
  }
}

class AccountApiServer extends FirestoreServer {
  nextVersion() { this.revision += 1; return `account-version-${String(this.revision).padStart(10, '0')}` }
  fetch = async (input, options = {}) => {
    assert.equal(new URL(input).pathname, '/api/account', 'Supabase mode must never contact Firestore')
    assert.equal(options.method, 'POST')
    assert.equal(options.credentials, 'omit')
    const token = options.headers.Authorization
    assert.match(token, /^Bearer test-token-/)
    this.requests.push({ url: input, method: options.method, keepalive: options.keepalive, body: options.body })
    if (this.unavailable) throw new TypeError('Simulated account API failure')
    const uid = token.replace('Bearer test-token-', '')
    const key = `projects/test-project/databases/(default)/documents/accountSessions/${uid}`
    const body = JSON.parse(options.body)
    assert.ok(body.ownerId)
    if (body.action === 'sessionRelease') {
      if (this.delayedDelete) {
        const pending = this.delayedDelete
        this.delayedDelete = null
        pending.started.resolve()
        await pending.resume.promise
      }
      const current = this.documents.get(key)
      const released = Boolean(current && current.updateTime === body.version && current.fields.ownerId.stringValue === body.ownerId)
      if (released) this.documents.delete(key)
      return jsonResponse(200, { released })
    }
    assert.ok(['sessionAcquire', 'sessionHeartbeat'].includes(body.action))
    const current = this.documents.get(key)
    const live = Boolean(current && Date.parse(current.fields.heartbeatAt.timestampValue) + ACCOUNT_SESSION_LEASE_MS > this.timers.now)
    if (body.action === 'sessionAcquire' && live && current.fields.ownerId.stringValue !== body.ownerId) {
      return jsonResponse(409, { error: { code: ACCOUNT_SESSION_ERROR_CODES.occupied } })
    }
    if (body.action === 'sessionHeartbeat' && (!live || current.updateTime !== body.version || current.fields.ownerId.stringValue !== body.ownerId)) {
      return jsonResponse(409, { error: { code: ACCOUNT_SESSION_ERROR_CODES.lost } })
    }
    const version = this.nextVersion()
    this.documents.set(key, { name: key, updateTime: version, fields: {
      ownerId: { stringValue: body.ownerId }, heartbeatAt: { timestampValue: new Date(this.timers.now).toISOString() },
    } })
    const response = jsonResponse(200, { ownerId: body.ownerId, version, leaseMs: ACCOUNT_SESSION_LEASE_MS,
      expiresAt: this.timers.now + ACCOUNT_SESSION_LEASE_MS })
    if (this.delayedCommitResponse) {
      const pending = this.delayedCommitResponse
      this.delayedCommitResponse = null
      pending.started.resolve()
      await pending.resume.promise
    }
    return response
  }
}

function fixture() {
  const timers = new FakeTimers()
  const server = useAccountApi ? new AccountApiServer(timers) : new FirestoreServer(timers)
  const handles = []
  const user = (uid = 'google-user') => ({
    uid,
    auth: { app: { options: { projectId: 'test-project' } } },
    getIdToken: async () => `test-token-${uid}`,
  })
  const options = (browser = new Browser(), extra = {}) => ({
    projectId: 'test-project',
    fetchImpl: server.fetch,
    windowObject: browser.window,
    documentObject: browser.document,
    navigatorObject: browser.navigator,
    now: () => timers.now,
    setTimeoutImpl: timers.setTimeout,
    clearTimeoutImpl: timers.clearTimeout,
    storageProvider: useCloudflare ? 'cloudflare' : useAccountApi ? 'supabase' : 'firestore',
    apiUrl: 'http://127.0.0.1:9999/api/account',
    ...extra,
  })
  const acquire = async (account = user(), browser, extra) => {
    const handle = await acquireAccountSession(account, options(browser, extra))
    handles.push(handle)
    return handle
  }
  const clean = async () => {
    server.unavailable = false
    await Promise.all(handles.map((handle) => handle.release()))
    await settle()
    assert.equal(timers.tasks.size, 0, 'session cleanup must remove all timers')
  }
  return { timers, server, user, options, acquire, clean }
}

async function check(name, run) {
  const context = fixture()
  try {
    await run(context)
    checks.push(name)
    console.log(`PASS ${name}`)
  } finally { await context.clean() }
}

await check('simultaneous sign-ins from separate devices admit exactly one owner', async (test) => {
  const results = await Promise.allSettled([test.acquire(), test.acquire()])
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
  const rejected = results.find((result) => result.status === 'rejected')
  assert.equal(rejected.reason.code, ACCOUNT_SESSION_ERROR_CODES.occupied)
  assert.equal(test.server.documents.size, 1)
  assert.equal(hasActiveAccountSession('google-user'), true)
})

await check('closing the active window releases its lease and permits another device', async (test) => {
  const firstBrowser = new Browser()
  const first = await test.acquire(test.user(), firstBrowser)
  firstBrowser.close()
  await settle()
  assert.equal(first.isActive(), false)
  assert.equal(test.server.documents.size, 0)
  assert.ok(test.server.requests.some((request) => isReleaseRequest(request) && request.keepalive === true))
  const next = await test.acquire()
  assert.equal(next.isActive(), true)
  assert.notEqual(next.ownerId, first.ownerId)
})

await check('hiding a window keeps the owner and blocks concurrent login', async (test) => {
  const browser = new Browser()
  const session = await test.acquire(test.user(), browser)
  browser.hide()
  await settle()
  assert.equal(session.isActive(), true)
  assert.equal(test.server.requests.filter(isReleaseRequest).length, 0)
  await assert.rejects(test.acquire(), { code: ACCOUNT_SESSION_ERROR_CODES.occupied })
})

await check('heartbeat extends ownership while the window remains active', async (test) => {
  const first = await test.acquire()
  await test.timers.advance(ACCOUNT_SESSION_HEARTBEAT_MS)
  assert.equal(first.isActive(), true)
  assert.ok(test.server.requests.filter((request) => request.method === 'POST').length >= 2)
  const document = [...test.server.documents.values()][0]
  assert.equal(Date.parse(document.fields.heartbeatAt.timestampValue), test.timers.now)
  await assert.rejects(test.acquire(), { code: ACCOUNT_SESSION_ERROR_CODES.occupied })
})

await check('an expired crashed-device lease can be claimed by a new device', async (test) => {
  test.server.seedExpired('google-user')
  const session = await test.acquire()
  assert.equal(session.isActive(), true)
  assert.equal([...test.server.documents.values()][0].fields.ownerId.stringValue, session.ownerId)
})

await check('simultaneous recovery of one expired lease admits exactly one replacement', async (test) => {
  test.server.seedExpired('google-user')
  const results = await Promise.allSettled([test.acquire(), test.acquire()])
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
  assert.equal(results.find((result) => result.status === 'rejected').reason.code, ACCOUNT_SESSION_ERROR_CODES.occupied)
  assert.equal(test.server.documents.size, 1)
})

await check('a device clock far ahead cannot steal a server-valid session', async (test) => {
  const owner = await test.acquire()
  await assert.rejects(test.acquire(test.user(), new Browser(), {
    now: () => test.timers.now + ACCOUNT_SESSION_LEASE_MS * 100,
  }), { code: ACCOUNT_SESSION_ERROR_CODES.occupied })
  assert.equal(owner.isActive(), true)
  assert.equal([...test.server.documents.values()][0].fields.ownerId.stringValue, owner.ownerId)
})

await check('a delayed old release cannot delete a replacement owner', async (test) => {
  const old = await test.acquire()
  const pending = { started: deferred(), resume: deferred() }
  test.server.delayedDelete = pending
  const release = old.release()
  await pending.started.promise
  test.timers.now += ACCOUNT_SESSION_LEASE_MS + 1
  const replacement = await test.acquire()
  pending.resume.resolve()
  await release
  assert.equal(replacement.isActive(), true)
  assert.equal([...test.server.documents.values()][0].fields.ownerId.stringValue, replacement.ownerId)
  await assert.rejects(test.acquire(), { code: ACCOUNT_SESSION_ERROR_CODES.occupied })
})

await check('a refused window cannot release the active window on close', async (test) => {
  const owner = await test.acquire()
  const refusedBrowser = new Browser()
  await assert.rejects(test.acquire(test.user(), refusedBrowser), { code: ACCOUNT_SESSION_ERROR_CODES.occupied })
  refusedBrowser.close()
  await settle()
  assert.equal(owner.isActive(), true)
  assert.equal([...test.server.documents.values()][0].fields.ownerId.stringValue, owner.ownerId)
})

await check('a network error denies admission without granting an offline session', async (test) => {
  test.server.unavailable = true
  await assert.rejects(test.acquire(), { code: ACCOUNT_SESSION_ERROR_CODES.unavailable })
  assert.equal(hasActiveAccountSession('google-user'), false)
})

await check('heartbeat network loss revokes local access and cleans up timers', async (test) => {
  const lost = []
  const session = await test.acquire(test.user(), new Browser(), { onLost: (error) => lost.push(error) })
  test.server.unavailable = true
  await test.timers.advance(ACCOUNT_SESSION_HEARTBEAT_MS)
  assert.equal(session.isActive(), false)
  assert.equal(lost.length, 1)
  assert.equal(lost[0].code, ACCOUNT_SESSION_ERROR_CODES.unavailable)
  assert.equal(hasActiveAccountSession('google-user'), false)
})

await check('offline notification immediately revokes local access', async (test) => {
  const browser = new Browser()
  const lost = []
  const session = await test.acquire(test.user(), browser, { onLost: (error) => lost.push(error) })
  browser.offline()
  assert.equal(session.isActive(), false)
  assert.equal(lost.length, 1)
})

await check('a suspended window loses access before resuming after its lease deadline', async (test) => {
  const browser = new Browser()
  const lost = []
  const session = await test.acquire(test.user(), browser, { onLost: (error) => lost.push(error) })
  browser.hide()
  test.timers.now += ACCOUNT_SESSION_LEASE_MS + 1
  browser.show()
  assert.equal(session.isActive(), false)
  assert.equal(lost.length, 1)
})

await check('closing during a pending claim cleans up the late successful claim', async (test) => {
  const browser = new Browser()
  const pending = { started: deferred(), resume: deferred() }
  test.server.delayedCommitResponse = pending
  const acquisition = test.acquire(test.user(), browser)
  // Observe rejection immediately so a cleanup race cannot create an unhandled rejection.
  const outcome = acquisition.then((value) => ({ value }), (error) => ({ error }))
  await pending.started.promise
  browser.close()
  pending.resume.resolve()
  const result = await outcome
  assert.ok(result.error || result.value?.isActive() === false)
  await settle()
  assert.equal(test.server.documents.size, 0)
  assert.equal(hasActiveAccountSession('google-user'), false)
  assert.equal((await test.acquire()).isActive(), true)
})

await check('closing during heartbeat cleans up its late updated document version', async (test) => {
  const browser = new Browser()
  const owner = await test.acquire(test.user(), browser)
  const pending = { started: deferred(), resume: deferred() }
  test.server.delayedCommitResponse = pending
  // Showing the visible page asks the client to verify its current lease.
  browser.show()
  await pending.started.promise
  browser.close()
  pending.resume.resolve()
  await settle()
  assert.equal(owner.isActive(), false)
  assert.equal(test.server.documents.size, 0)
  assert.equal((await test.acquire()).isActive(), true)
})

await check('a superseded owner loses access without deleting the replacement lease', async (test) => {
  const lost = []
  const old = await test.acquire(test.user(), new Browser(), { onLost: (error) => lost.push(error) })
  const [key, document] = [...test.server.documents][0]
  // Model a server lease replaced while this device was paused.
  test.server.documents.set(key, {
    ...document,
    fields: { ...document.fields, ownerId: { stringValue: 'replacement-device' } },
    updateTime: test.server.nextVersion(),
  })
  await test.timers.advance(ACCOUNT_SESSION_HEARTBEAT_MS)
  assert.equal(old.isActive(), false)
  assert.equal(lost.length, 1)
  assert.equal(lost[0].code, ACCOUNT_SESSION_ERROR_CODES.lost)
  assert.equal(test.server.documents.get(key).fields.ownerId.stringValue, 'replacement-device')
})

await check('copied window storage cannot reuse the active owner identity', async (test) => {
  const firstBrowser = new Browser()
  const copiedBrowser = new Browser()
  firstBrowser.window.sessionStorage.setItem('champions-session-id', 'copied-tab-id')
  copiedBrowser.window.sessionStorage.setItem('champions-session-id', 'copied-tab-id')
  const first = await test.acquire(test.user(), firstBrowser)
  await assert.rejects(test.acquire(test.user(), copiedBrowser), { code: ACCOUNT_SESSION_ERROR_CODES.occupied })
  await first.release()
  const next = await test.acquire(test.user(), copiedBrowser)
  assert.notEqual(next.ownerId, first.ownerId)
})

await check('shared guest windows contend atomically and can reopen after close', async (test) => {
  const locks = new WebLocks()
  const firstBrowser = new Browser({ locks })
  const nextBrowser = new Browser({ locks })
  const guest = { uid: 'local-guest-1', isLocalGuest: true }
  const first = await test.acquire(guest, firstBrowser)
  await assert.rejects(test.acquire(guest, nextBrowser), { code: ACCOUNT_SESSION_ERROR_CODES.occupied })
  firstBrowser.close()
  await settle()
  const next = await test.acquire(guest, nextBrowser)
  assert.equal(first.isActive(), false)
  assert.equal(next.isActive(), true)
  await first.release()
  await assert.rejects(test.acquire(guest, new Browser({ locks })), { code: ACCOUNT_SESSION_ERROR_CODES.occupied })
  assert.equal(test.server.requests.length, 0, 'local guests do not have Firestore accounts')
})

await check('local guest admission fails safely when Web Locks are unsupported', async (test) => {
  await assert.rejects(test.acquire({ uid: 'local-guest-unsupported', isLocalGuest: true }), {
    code: ACCOUNT_SESSION_ERROR_CODES.unavailable,
  })
})

await check('different local accounts cannot concurrently edit shared browser game storage', async (test) => {
  const locks = new WebLocks()
  const owner = await test.acquire(test.user(), new Browser({ locks }))
  await assert.rejects(test.acquire({ uid: 'local-guest-other', isLocalGuest: true }, new Browser({ locks })), {
    code: ACCOUNT_SESSION_ERROR_CODES.occupied,
  })
  await assert.rejects(test.acquire(test.user('google-other'), new Browser({ locks })), {
    code: ACCOUNT_SESSION_ERROR_CODES.occupied,
  })
  await owner.release()
  await settle()
  assert.equal((await test.acquire({ uid: 'local-guest-other', isLocalGuest: true }, new Browser({ locks }))).isActive(), true)
})

if (useAccountApi) await check('unsafe account API addresses are rejected before credentials leave the browser', async test => {
  for (const apiUrl of ['http://example.invalid/api/account', 'https://user:pass@example.invalid/api/account', 'file:///api/account']) {
    await assert.rejects(test.acquire(test.user(), new Browser(), { apiUrl }), { code: ACCOUNT_SESSION_ERROR_CODES.unavailable })
  }
  assert.equal(test.server.requests.length, 0)
})

await check('guest deletion pauses renewals after an in-flight heartbeat and returns its newest lease version', async test => {
  const browser = new Browser()
  const guest = { ...test.user('delete-guest'), isAnonymous: true }
  const handle = await test.acquire(guest, browser)
  const pending = { started: deferred(), resume: deferred() }
  test.server.delayedCommitResponse = pending
  browser.show()
  await pending.started.promise
  let done = false
  const pausing = handle.pauseForGuestDeletion().then(result => { done = true; return result })
  await settle()
  assert.equal(done, false)
  pending.resume.resolve()
  const lease = await pausing
  assert.equal(lease.ownerId, handle.ownerId)
  assert.equal(lease.version, [...test.server.documents.values()][0].updateTime)
  const requestCount = test.server.requests.length
  browser.show()
  await test.timers.advance(ACCOUNT_SESSION_HEARTBEAT_MS)
  assert.equal(test.server.requests.length, requestCount)
  assert.equal(handle.isActive(), true)
})


if (useAccountApi) await check('reload waits for a delayed close without reusing the old owner identity', async test => {
  const oldBrowser = new Browser(); const old = await test.acquire(test.user(), oldBrowser);
  const delayed = { started: deferred(), resume: deferred() }; test.server.delayedDelete = delayed;
  oldBrowser.close(); await delayed.started.promise;
  const reload = new Browser(); reload.window.performance = { getEntriesByType: () => [{ type: 'reload' }] };
  const pending = test.acquire(test.user(), reload).then(value => ({value}), error => ({error}));
  await settle(); delayed.resume.resolve(); await settle(); await test.timers.advance(4000);
  const result = await pending; assert.equal(result.error, undefined); assert.equal(result.value.isActive(), true);
  assert.notEqual(result.value.ownerId, old.ownerId);
});
if (useAccountApi) await check('reload retries stay bounded and cannot take over an active other device', async test => {
  const owner = await test.acquire(); const reload = new Browser();
  reload.window.performance = { getEntriesByType: () => [{ type: 'reload' }] };
  const pending = test.acquire(test.user(), reload).then(value => ({value}), error => ({error}));
  await settle(); await test.timers.advance(4000); const result = await pending;
  assert.equal(result.error.code, ACCOUNT_SESSION_ERROR_CODES.occupied); assert.equal(owner.isActive(), true);
  assert.ok(test.server.requests.filter(r => JSON.parse(r.body).action === 'sessionAcquire').length <= 5);
});

console.log(`Account session validation passed (${checks.length} checks, ${useCloudflare ? 'Cloudflare account API' : useAccountApi ? 'Supabase account API' : 'Firestore'}).`)
