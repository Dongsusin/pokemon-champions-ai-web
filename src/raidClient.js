const environment = import.meta.env ?? {}
const loopback = hostname => ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)
const pageUrl = typeof window === 'undefined' ? 'http://localhost' : window.location.href
const configuredEndpoint = new URL(environment.VITE_RAID_API_URL || '/api/raid', pageUrl)
if (configuredEndpoint.pathname === '/') configuredEndpoint.pathname = '/api/raid'

export const raidApiUrl = configuredEndpoint.href
// The feature stays hidden unless a deployment deliberately opts in. Local
// raid-test is intentionally separate so production settings cannot be
// bypassed with a query string or a guest name.
export const isRaidEnabled = environment.VITE_RAID_ENABLED === 'true'
export const isRaidLocalTest = Boolean(environment.DEV && environment.MODE === 'raid-test'
  && environment.VITE_RAID_LOCAL_TEST === 'true' && typeof window !== 'undefined'
  && loopback(window.location.hostname) && loopback(new URL(raidApiUrl).hostname))

export class RaidRequestError extends Error {
  constructor(message, code = 'network-error', status = 0) {
    super(message)
    this.name = 'RaidRequestError'
    this.code = code
    this.status = status
  }
}

export function createRaidRequestId() {
  return globalThis.crypto?.randomUUID?.() ?? `raid-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

// Authentication is resolved for every request so Firebase token refreshes
// and a changed guest session cannot leak an old identity into a raid.
export function createRaidClient({ getIdToken, localTestIdentity, fetchImpl = fetch, apiUrl = raidApiUrl } = {}) {
  const endpoint = new URL(apiUrl, pageUrl)
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password
    || (endpoint.protocol === 'http:' && !loopback(endpoint.hostname))) {
    throw new RaidRequestError('보스전 서버 주소가 올바르지 않습니다.', 'invalid-endpoint')
  }
  if (localTestIdentity && (!isRaidLocalTest || !loopback(endpoint.hostname)
    || !['alice', 'bob', 'charlie'].includes(localTestIdentity))) {
    throw new RaidRequestError('로컬 보스전 계정은 지정된 로컬 테스트 모드에서만 사용할 수 있습니다.', 'local-test-only')
  }

  async function request(action, payload = {}, { signal, requestId } = {}) {
    const controller = new AbortController()
    const abort = () => controller.abort()
    if (signal?.aborted) controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    const timeout = setTimeout(abort, 12_000)
    try {
      const token = localTestIdentity ? `ranked-test-${localTestIdentity}` : await getIdToken?.()
      if (!token) throw new RaidRequestError('게스트 또는 Google 로그인 연결을 확인한 뒤 다시 시도해주세요.', 'authentication-required', 401)

      const url = new URL(endpoint)
      const readOnly = action === 'catalog' || action === 'rooms' || action === 'status'
      if (readOnly) {
        url.searchParams.set('action', action)
        if (payload.raidId) url.searchParams.set('raidId', payload.raidId)
        const revision = Number.isSafeInteger(payload.sinceRevision) ? payload.sinceRevision : payload.revision
        if (Number.isSafeInteger(revision)) {
          // `revision` remains for deployed handlers while `sinceRevision`
          // enables compact unchanged headers on the raid-run head store.
          url.searchParams.set('revision', String(revision))
          url.searchParams.set('sinceRevision', String(revision))
        }
        if (payload.eventCursor != null) url.searchParams.set('eventCursor', String(payload.eventCursor))
      }

      const response = await fetchImpl(url.href, {
        method: readOnly ? 'GET' : 'POST', signal: controller.signal, credentials: 'omit', cache: 'no-store', redirect: 'error',
        headers: { Authorization: `Bearer ${token}`, ...(readOnly ? {} : { 'Content-Type': 'application/json' }) },
        ...(readOnly ? {} : { body: JSON.stringify({ ...payload, action, requestId: requestId ?? createRaidRequestId() }) }),
      })
      let body
      try {
        body = await response.json()
      } catch {
        throw new RaidRequestError('보스전 서버 응답을 읽지 못했습니다. 연결을 다시 확인해 주세요.', 'invalid-response', response.status)
      }
      if (!response.ok || body?.error) {
        throw new RaidRequestError(
          body?.error?.message ?? body?.message ?? '요청을 처리하지 못했습니다. 보스전 상태를 다시 확인해 주세요.',
          body?.error?.code ?? body?.code ?? 'request-failed',
          response.status,
        )
      }
      if (!body || typeof body !== 'object') throw new RaidRequestError('보스전 상태가 올바르지 않습니다.', 'invalid-response')
      return body
    } catch (error) {
      if (signal?.aborted) throw new DOMException('Request cancelled', 'AbortError')
      if (error instanceof RaidRequestError) throw error
      throw new RaidRequestError(controller.signal.aborted
        ? '응답이 지연되고 있습니다. 보스전 상태를 다시 확인합니다.'
        : '서버와 연결되지 않았습니다. 연결이 복구되면 현재 보스전으로 돌아갑니다.', 'network-error')
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
    }
  }

  return {
    request,
    catalog: (payload, options) => request('catalog', payload, options),
    rooms: (payload, options) => request('rooms', payload, options),
    status: (payload, options) => request('status', payload, options),
  }
}
