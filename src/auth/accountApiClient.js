import { accountApiUrl } from './gameStorageConfig.js'

export class AccountRequestError extends Error {
  constructor(message, code = 'account/unavailable', status = 0) {
    super(message)
    this.name = 'AccountRequestError'
    this.code = code
    this.status = status
  }
}

export function createAccountApiClient({ getIdToken, isCurrent = () => true, fetchImpl = globalThis.fetch?.bind(globalThis),
  apiUrl = accountApiUrl } = {}) {
  const url = new URL(apiUrl)
  const loopback = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (url.protocol === 'http:' && !loopback)) {
    throw new AccountRequestError('계정 서버 주소가 올바르지 않습니다.', 'account/invalid-endpoint')
  }
  const assertCurrent = () => {
    if (!isCurrent()) throw new AccountRequestError('로그인 계정이 변경되었습니다.', 'account/identity-changed', 401)
  }
  return {
    async request(action, payload = {}, { signal, keepalive = false } = {}) {
      const controller = new AbortController()
      const abort = () => controller.abort()
      if (signal?.aborted) controller.abort()
      signal?.addEventListener('abort', abort, { once: true })
      const timeout = setTimeout(abort, 12_000)
      try {
        assertCurrent()
        const token = await getIdToken?.()
        assertCurrent()
        if (!token) throw new AccountRequestError('계정 인증이 필요합니다.', 'account/authentication-required', 401)
        if (controller.signal.aborted) throw new DOMException('Request aborted', 'AbortError')
        const response = await fetchImpl(url.href, {
          method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, action }), signal: controller.signal, keepalive,
          credentials: 'omit', cache: 'no-store', redirect: 'error',
        })
        const body = await response.json().catch(() => null)
        assertCurrent()
        if (!response.ok || body?.error) {
          throw new AccountRequestError(body?.error?.message ?? '계정 서버 요청을 처리하지 못했습니다.',
            body?.error?.code ?? 'account/unavailable', response.status)
        }
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          throw new AccountRequestError('계정 서버 응답이 올바르지 않습니다.', 'account/invalid-response')
        }
        return body
      } catch (error) {
        if (error instanceof AccountRequestError) throw error
        if (signal?.aborted) throw new DOMException('Request aborted', 'AbortError')
        throw new AccountRequestError(controller.signal.aborted
          ? '계정 서버 응답이 지연되고 있습니다. 다시 시도해주세요.'
          : '계정 서버에 연결하지 못했습니다. 저장 기록을 유지한 채 다시 시도해주세요.', 'account/unavailable')
      } finally {
        clearTimeout(timeout)
        signal?.removeEventListener('abort', abort)
      }
    },
  }
}
