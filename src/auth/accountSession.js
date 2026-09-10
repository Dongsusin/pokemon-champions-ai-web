export const ACCOUNT_SESSION_LEASE_MS = 90_000
export const ACCOUNT_SESSION_HEARTBEAT_MS = 20_000
export const ACCOUNT_SESSION_ERROR_CODES = {
  occupied: 'account-session/occupied',
  unavailable: 'account-session/unavailable',
  lost: 'account-session/lost',
}

const REQUEST_TIMEOUT_MS = 10_000
const LEASE_SAFETY_MS = 2_000
// All accounts in this origin share the same local game-data keys.
const PLAYER_DATA_LOCK = 'champions-player-data'
const activeSessions = new Map()

function createLeaseClock() {
  const wallStart = Date.now()
  const monotonicStart = globalThis.performance?.now?.() ?? 0
  let elapsed = 0
  return () => {
    // Wall time includes OS sleep; monotonic time prevents clock rollback from
    // extending ownership. Never let a previously observed elapsed time recede.
    elapsed = Math.max(elapsed, Date.now() - wallStart,
      (globalThis.performance?.now?.() ?? monotonicStart) - monotonicStart)
    return elapsed
  }
}

function sessionError(code, cause) {
  const error = new Error(code, cause ? { cause } : undefined)
  error.code = code
  return error
}

export function hasActiveAccountSession(userId) {
  return Boolean(activeSessions.get(userId)?.isActive())
}

export function getActiveAccountSessionOwnerId(userId) {
  const session = activeSessions.get(userId)
  return session?.isActive() ? session.ownerId : null
}

function acquireBrowserLock(navigatorObject, required) {
  if (!navigatorObject?.locks?.request) {
    if (required) return Promise.reject(sessionError(ACCOUNT_SESSION_ERROR_CODES.unavailable))
    return Promise.resolve(() => {})
  }

  return new Promise((resolve, reject) => {
    const request = navigatorObject.locks.request(PLAYER_DATA_LOCK, { ifAvailable: true }, async (lock) => {
      if (!lock) {
        reject(sessionError(ACCOUNT_SESSION_ERROR_CODES.occupied))
        return
      }
      await new Promise((unlock) => resolve(unlock))
    })
    Promise.resolve(request).catch((error) => {
      reject(sessionError(ACCOUNT_SESSION_ERROR_CODES.unavailable, error))
    })
  })
}

/** Admit one game window, independently of Firebase's shared authentication state. */
export async function acquireAccountSession(user, options = {}) {
  const {
    onLost = () => {},
    projectId = user?.auth?.app?.options?.projectId,
    fetchImpl = globalThis.fetch?.bind(globalThis),
    windowObject = globalThis.window,
    documentObject = globalThis.document,
    navigatorObject = globalThis.navigator,
    now = createLeaseClock(),
    setTimeoutImpl = globalThis.setTimeout.bind(globalThis),
    clearTimeoutImpl = globalThis.clearTimeout.bind(globalThis),
  } = options
  if (!user?.uid || (!user.isLocalGuest && (!projectId || !fetchImpl || !user.getIdToken))) {
    throw sessionError(ACCOUNT_SESSION_ERROR_CODES.unavailable)
  }

  // Never persist this ID: duplicated tabs can inherit sessionStorage.
  const ownerId = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
  const documentName = `projects/${projectId}/databases/(default)/documents/accountSessions/${user.uid}`
  const documentUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/accountSessions/${encodeURIComponent(user.uid)}`
  const commitUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents:commit`
  let ended = false
  let admitted = false
  let unlockBrowser = () => {}
  let token = ''
  let version = null
  let deadline = 0
  let heartbeatTimer = null
  let expiryTimer = null
  let heartbeatPromise = null
  let releasePromise = null

  const isActive = () => !ended && admitted && (user.isLocalGuest || now() < deadline)
  const handle = { ownerId, isActive, release }

  async function request(url, init, { keepalive = false } = {}) {
    const abortController = new AbortController()
    const timeout = setTimeoutImpl(() => abortController.abort(), REQUEST_TIMEOUT_MS)
    try {
      const response = await fetchImpl(url, {
        ...init,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init?.headers },
        signal: abortController.signal,
        keepalive,
      })
      let data = null
      if (init?.method !== 'DELETE') data = await response.json().catch(() => null)
      return { response, data }
    } finally {
      clearTimeoutImpl(timeout)
    }
  }

  async function deleteVersion(expectedVersion, keepalive) {
    if (!expectedVersion || !token || user.isLocalGuest) return
    try {
      // A delayed close request must never remove a replacement session.
      await request(`${documentUrl}?currentDocument.updateTime=${encodeURIComponent(expectedVersion)}`, {
        method: 'DELETE',
      }, { keepalive })
    } catch {
      // An unreachable/crashed client is recovered by the server-enforced lease.
    }
  }

  function detach() {
    clearTimeoutImpl(heartbeatTimer)
    clearTimeoutImpl(expiryTimer)
    windowObject?.removeEventListener('pagehide', onPageHide)
    windowObject?.removeEventListener('offline', onOffline)
    documentObject?.removeEventListener('visibilitychange', onVisibilityChange)
  }

  function release({ keepalive = false } = {}) {
    if (!ended) {
      ended = true
      admitted = false
      detach()
      if (activeSessions.get(user.uid) === handle) activeSessions.delete(user.uid)
      unlockBrowser()
    }
    if (!releasePromise) releasePromise = deleteVersion(version, keepalive)
    return releasePromise
  }

  function lose(code, cause) {
    if (ended) return
    // Stop account/UI access synchronously, before any network cleanup.
    admitted = false
    try {
      onLost(sessionError(code, cause))
    } finally {
      void release({ keepalive: true })
    }
  }

  function onPageHide() {
    void release({ keepalive: true })
  }

  function onOffline() {
    if (!user.isLocalGuest) lose(ACCOUNT_SESSION_ERROR_CODES.unavailable)
  }

  function onVisibilityChange() {
    if (documentObject?.visibilityState !== 'visible' || ended || !admitted || user.isLocalGuest) return
    if (now() >= deadline) lose(ACCOUNT_SESSION_ERROR_CODES.lost)
    else void heartbeat()
  }

  function scheduleLeaseChecks(requestStartedAt) {
    deadline = requestStartedAt + ACCOUNT_SESSION_LEASE_MS - LEASE_SAFETY_MS
    clearTimeoutImpl(heartbeatTimer)
    clearTimeoutImpl(expiryTimer)
    expiryTimer = setTimeoutImpl(() => lose(ACCOUNT_SESSION_ERROR_CODES.lost), Math.max(0, deadline - now()))
    heartbeatTimer = setTimeoutImpl(() => void heartbeat(), ACCOUNT_SESSION_HEARTBEAT_MS)
  }

  async function writeLease(expectedVersion) {
    const requestStartedAt = now()
    const { response, data } = await request(commitUrl, {
      method: 'POST',
      body: JSON.stringify({ writes: [{
        update: { name: documentName, fields: { ownerId: { stringValue: ownerId } } },
        updateTransforms: [{ fieldPath: 'heartbeatAt', setToServerValue: 'REQUEST_TIME' }],
        currentDocument: expectedVersion ? { updateTime: expectedVersion } : { exists: false },
      }] }),
    })
    if (!response.ok) {
      const occupied = response.status === 409
        || response.status === 412
        || data?.error?.status === 'FAILED_PRECONDITION'
        || data?.error?.status === 'ABORTED'
        || (response.status === 403 && expectedVersion)
      throw sessionError(occupied ? ACCOUNT_SESSION_ERROR_CODES.occupied : ACCOUNT_SESSION_ERROR_CODES.unavailable)
    }
    const nextVersion = data?.writeResults?.[0]?.updateTime
    if (!nextVersion) throw sessionError(ACCOUNT_SESSION_ERROR_CODES.unavailable)
    version = nextVersion
    if (ended) {
      await deleteVersion(nextVersion, true)
      throw sessionError(ACCOUNT_SESSION_ERROR_CODES.lost)
    }
    scheduleLeaseChecks(requestStartedAt)
  }

  function heartbeat() {
    if (ended || user.isLocalGuest) return Promise.resolve()
    if (heartbeatPromise) return heartbeatPromise
    if (now() >= deadline) {
      lose(ACCOUNT_SESSION_ERROR_CODES.lost)
      return Promise.resolve()
    }
    heartbeatPromise = (async () => {
      try {
        token = await user.getIdToken()
        if (ended) return
        await writeLease(version)
      } catch (error) {
        lose(error.code === ACCOUNT_SESSION_ERROR_CODES.occupied
          ? ACCOUNT_SESSION_ERROR_CODES.lost
          : ACCOUNT_SESSION_ERROR_CODES.unavailable, error)
      } finally {
        heartbeatPromise = null
      }
    })()
    return heartbeatPromise
  }

  windowObject?.addEventListener('pagehide', onPageHide)
  windowObject?.addEventListener('offline', onOffline)
  documentObject?.addEventListener('visibilitychange', onVisibilityChange)

  try {
    unlockBrowser = await acquireBrowserLock(navigatorObject, Boolean(user.isLocalGuest))
    if (ended) {
      unlockBrowser()
      throw sessionError(ACCOUNT_SESSION_ERROR_CODES.lost)
    }
    if (!user.isLocalGuest) {
      if (navigatorObject?.onLine === false) throw sessionError(ACCOUNT_SESSION_ERROR_CODES.unavailable)
      token = await user.getIdToken()
      if (ended) throw sessionError(ACCOUNT_SESSION_ERROR_CODES.lost)
      const { response, data } = await request(documentUrl, { method: 'GET' })
      if (!response.ok && response.status !== 404) throw sessionError(ACCOUNT_SESSION_ERROR_CODES.unavailable)
      if (ended) throw sessionError(ACCOUNT_SESSION_ERROR_CODES.lost)
      // Always let server rules determine expiry, regardless of the local clock.
      await writeLease(response.ok ? data?.updateTime : null)
      if (now() >= deadline) throw sessionError(ACCOUNT_SESSION_ERROR_CODES.unavailable)
    }
    admitted = true
    activeSessions.set(user.uid, handle)
    return handle
  } catch (error) {
    await release()
    throw error?.code?.startsWith('account-session/')
      ? error
      : sessionError(ACCOUNT_SESSION_ERROR_CODES.unavailable, error)
  }
}
