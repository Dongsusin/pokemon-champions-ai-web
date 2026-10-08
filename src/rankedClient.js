const environment = import.meta.env ?? {}
const loopback = hostname => ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)
const pageUrl = typeof window === 'undefined' ? 'http://localhost' : window.location.href
const configuredEndpoint = new URL(environment.VITE_RANKED_API_URL || '/api/ranked', pageUrl)
if (configuredEndpoint.pathname === '/') configuredEndpoint.pathname = '/api/ranked'
export const rankedApiUrl = configuredEndpoint.href
export const isRankedEnabled = environment.VITE_RANKED_ENABLED === 'true'
export const isRankedLocalTest = Boolean(environment.DEV && environment.MODE === 'ranked-test'
  && environment.VITE_RANKED_LOCAL_TEST === 'true' && typeof window !== 'undefined'
  && loopback(window.location.hostname) && loopback(new URL(rankedApiUrl).hostname))

export class RankedRequestError extends Error {
  constructor(message, code = 'network-error', status = 0) {
    super(message)
    this.name = 'RankedRequestError'
    this.code = code
    this.status = status
  }
}

export function createRankedRequestId() {
  return globalThis.crypto?.randomUUID?.() ?? `ranked-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

// Authentication is supplied at request time, so refreshed Firebase credentials
// and identity changes never reuse a captured ID token.
export function createRankedClient({ getIdToken, localTestIdentity, fetchImpl = fetch, apiUrl = rankedApiUrl } = {}) {
  const endpoint = new URL(apiUrl, pageUrl)
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password
    || (endpoint.protocol === 'http:' && !loopback(endpoint.hostname))) {
    throw new RankedRequestError('레이팅 서버 주소가 올바르지 않습니다.', 'invalid-endpoint')
  }
  if (localTestIdentity && (!isRankedLocalTest || !loopback(endpoint.hostname)
    || !['alice', 'bob'].includes(localTestIdentity))) {
    throw new RankedRequestError('로컬 테스트 계정은 지정된 로컬 테스트 모드에서만 사용할 수 있습니다.', 'local-test-only')
  }
  async function request(action, payload = {}, { signal, requestId } = {}) {
    const controller = new AbortController()
    const abort = () => controller.abort()
    if (signal?.aborted) controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    const timeout = setTimeout(abort, 12_000)
    try {
      const token = localTestIdentity ? `ranked-test-${localTestIdentity}` : await getIdToken?.()
      if (!token) throw new RankedRequestError('게스트 또는 Google 로그인 연결을 확인한 뒤 다시 시도해주세요.', 'authentication-required', 401)
      const url = new URL(endpoint)
      const readOnly = action === 'status' || action === 'rooms' || action === 'fixtures' || action === 'usage' || action === 'factoryLeaderboard' || action === 'rankedLeaderboard' || action === 'queueCounts'
      if (readOnly) {
        url.searchParams.set('action', action)
        if (action === 'factoryLeaderboard' && payload.mode) url.searchParams.set('mode', payload.mode)
        if (payload.matchId) url.searchParams.set('matchId', payload.matchId)
        if (Number.isSafeInteger(payload.timelineRevision)) url.searchParams.set('timelineRevision', String(payload.timelineRevision))
        if (Number.isSafeInteger(payload.matchRevision) && payload.matchRevision >= 0) {
          url.searchParams.set('matchRevision', String(payload.matchRevision))
        }
        if (action === 'rooms' && payload.spectateMatchId) {
          url.searchParams.set('spectateMatchId', payload.spectateMatchId)
          if (Number.isSafeInteger(payload.spectateTimelineRevision) && payload.spectateTimelineRevision >= 0) {
            url.searchParams.set('spectateTimelineRevision', String(payload.spectateTimelineRevision))
          }
        }
      }
      const response = await fetchImpl(url.href, {
        method: readOnly ? 'GET' : 'POST', signal: controller.signal, credentials: 'omit', cache: 'no-store', redirect: 'error',
        headers: { Authorization: `Bearer ${token}`, ...(readOnly ? {} : { 'Content-Type': 'application/json' }) },
        ...(readOnly ? {} : { body: JSON.stringify({ ...payload, action, requestId: requestId ?? createRankedRequestId() }) }),
      })
      let body
      try { body = await response.json() } catch { throw new RankedRequestError('레이팅 서버 응답을 읽지 못했습니다. 연결을 다시 확인해 주세요.', 'invalid-response', response.status) }
      if (!response.ok || body?.error) {
        throw new RankedRequestError(body?.error?.message ?? body?.message ?? '요청을 처리하지 못했습니다. 현재 대전 상태를 다시 확인해 주세요.',
          body?.error?.code ?? body?.code ?? 'request-failed', response.status)
      }
      if (!body || typeof body !== 'object') throw new RankedRequestError('대전 상태가 올바르지 않습니다.', 'invalid-response')
      return body
    } catch (error) {
      if (signal?.aborted) throw new DOMException('Request cancelled', 'AbortError')
      if (error instanceof RankedRequestError) throw error
      throw new RankedRequestError(controller.signal.aborted
        ? '응답이 지연되고 있습니다. 대전 상태를 다시 확인합니다.'
        : '서버와 연결되지 않았습니다. 연결이 복구되면 현재 대전으로 돌아갑니다.', 'network-error')
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
    }
  }
  return { request, status: (payload, options) => request('status', payload, options) }
}
