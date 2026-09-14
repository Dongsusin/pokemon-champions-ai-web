const environment = import.meta.env ?? {}
const pageUrl = typeof window === 'undefined' ? 'http://localhost/' : window.location.href
export const globalChatApiUrl = new URL(environment.VITE_CHAT_API_URL || '/api/chat', pageUrl).href
export const CHAT_MAX_MESSAGES = 30
export const CHAT_MAX_CHARACTERS = 200

export class GlobalChatError extends Error {
  constructor(message, code = 'CHAT_UNAVAILABLE', status = 0) {
    super(message)
    this.name = 'GlobalChatError'
    this.code = code
    this.status = status
  }
}

function messageValid(message) {
  return message && typeof message === 'object'
    && typeof message.id === 'string' && message.id.length > 0 && message.id.length <= 128
    && typeof message.name === 'string' && [...message.name].length <= 64
    && typeof message.text === 'string' && [...message.text].length <= CHAT_MAX_CHARACTERS
    && Number.isSafeInteger(message.createdAt) && message.createdAt >= 0 && message.createdAt <= 8_640_000_000_000_000
    && typeof message.isOwn === 'boolean'
}

export function validateChatSnapshot(body) {
  if (!body || !Number.isSafeInteger(body.revision) || body.revision < 0
    || !(body.latest === null || messageValid(body.latest))
    || (body.messages !== undefined && (!Array.isArray(body.messages) || body.messages.length > CHAT_MAX_MESSAGES
      || !body.messages.every(messageValid) || new Set(body.messages.map(message => message.id)).size !== body.messages.length))) {
    throw new GlobalChatError('채팅 응답을 읽지 못했습니다. 다시 시도해주세요.', 'CHAT_INVALID_RESPONSE')
  }
  return body
}

export function createGlobalChatClient({ getIdToken, isCurrent = () => true,
  fetchImpl = globalThis.fetch?.bind(globalThis), apiUrl = globalChatApiUrl } = {}) {
  const endpoint = new URL(apiUrl, pageUrl)
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password
    || (endpoint.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]', '::1'].includes(endpoint.hostname))) {
    throw new GlobalChatError('채팅 서버 주소가 올바르지 않습니다.', 'CHAT_INVALID_ENDPOINT')
  }
  const assertCurrent = () => {
    if (!isCurrent()) throw new GlobalChatError('로그인 계정이 변경되었습니다.', 'CHAT_IDENTITY_CHANGED', 401)
  }
  return {
    async request(action, payload = {}, { signal } = {}) {
      const controller = new AbortController()
      const abort = () => controller.abort()
      if (signal?.aborted) abort()
      signal?.addEventListener('abort', abort, { once: true })
      const timeout = setTimeout(abort, 12_000)
      try {
        assertCurrent()
        const token = await getIdToken?.()
        assertCurrent()
        if (!token) throw new GlobalChatError('온라인 로그인 후 채팅을 이용해주세요.', 'UNAUTHENTICATED', 401)
        if (controller.signal.aborted) throw new DOMException('Request aborted', 'AbortError')
        const response = await fetchImpl(endpoint.href, {
          method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, action }), signal: controller.signal,
          credentials: 'omit', cache: 'no-store', redirect: 'error',
        })
        const body = await response.json().catch(() => null)
        assertCurrent()
        if (!response.ok || body?.error) throw new GlobalChatError(body?.error?.message || '채팅에 연결하지 못했습니다. 다시 시도해주세요.', body?.error?.code, response.status)
        return validateChatSnapshot(body)
      } catch (error) {
        if (signal?.aborted) throw new DOMException('Request aborted', 'AbortError')
        if (error instanceof GlobalChatError) throw error
        throw new GlobalChatError(controller.signal.aborted
          ? '채팅 응답이 지연되고 있습니다. 잠시 후 다시 시도해주세요.'
          : '채팅 서버에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.')
      } finally {
        clearTimeout(timeout)
        signal?.removeEventListener('abort', abort)
      }
    },
  }
}
