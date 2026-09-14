import { createGlobalChatService, GlobalChatError } from './globalChatService.js'
import { getProductionServices } from './productionServices.js'

export const GLOBAL_CHAT_HTTP_MAX_BYTES = 4096
const localHost = hostname => ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)
const response = (body, status = 200, headers = {}) => Response.json(body, {
  status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers },
})
const authRejected = new Set(['auth/argument-error', 'auth/invalid-argument', 'auth/invalid-id-token', 'auth/id-token-expired', 'auth/id-token-revoked', 'auth/user-disabled', 'auth/user-not-found'])
const unavailable = (headers = {}) => response({ error: {
  code: 'CHAT_UNAVAILABLE', message: '채팅 서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.',
} }, 503, headers)

async function readPayload(request) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new GlobalChatError('INVALID_CONTENT_TYPE', 'JSON 형식의 요청이 필요합니다.', 415)
  if (Number(request.headers.get('content-length')) > GLOBAL_CHAT_HTTP_MAX_BYTES) throw new GlobalChatError('BODY_TOO_LARGE', '요청 내용이 너무 큽니다.', 413)
  const reader = request.body?.getReader()
  if (!reader) throw new GlobalChatError('INVALID_JSON', '요청 내용이 비어 있습니다.')
  const chunks = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > GLOBAL_CHAT_HTTP_MAX_BYTES) { await reader.cancel(); throw new GlobalChatError('BODY_TOO_LARGE', '요청 내용이 너무 큽니다.', 413) }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  let payload
  try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new GlobalChatError('INVALID_JSON', '요청 내용을 읽을 수 없습니다.') }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new GlobalChatError('INVALID_JSON', '요청 형식이 올바르지 않습니다.')
  return payload
}

export function createGlobalChatHttpHandler({ service, authenticate, allowLocalOrigins = false, now = Date.now } = {}) {
  const limits = new Map()
  return async request => {
    const headers = {}
    try {
      const url = new URL(request.url)
      const origin = request.headers.get('origin')
      if (origin && origin !== url.origin) {
        let source
        try { source = new URL(origin) } catch { throw new GlobalChatError('ORIGIN_FORBIDDEN', '허용되지 않은 접속 주소입니다.', 403) }
        if (!allowLocalOrigins || !localHost(url.hostname) || !localHost(source.hostname) || source.protocol !== 'http:') throw new GlobalChatError('ORIGIN_FORBIDDEN', '허용되지 않은 접속 주소입니다.', 403)
        headers['Access-Control-Allow-Origin'] = origin
        headers.Vary = 'Origin'
      }
      if (!origin && request.headers.get('sec-fetch-site') === 'cross-site') throw new GlobalChatError('ORIGIN_FORBIDDEN', '허용되지 않은 접속 주소입니다.', 403)
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: {
        ...headers, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      } })
      if (request.method !== 'POST') return response({ error: { code: 'METHOD_NOT_ALLOWED', message: 'POST 요청만 허용됩니다.' } }, 405, { ...headers, Allow: 'POST, OPTIONS' })
      const token = /^Bearer ([^\s]{8,4096})$/.exec(request.headers.get('authorization') ?? '')?.[1]
      if (!token) throw new GlobalChatError('UNAUTHENTICATED', '로그인이 필요합니다.', 401)
      const payload = await readPayload(request)
      if (!service || !authenticate) return unavailable(headers)
      let identity
      try { identity = await authenticate(request, token, { freshNickname: payload.action === 'send' }) } catch (error) {
        if (authRejected.has(error?.code) || (error?.status === 401 && error?.code === 'UNAUTHENTICATED')) throw new GlobalChatError('UNAUTHENTICATED', '로그인이 만료됐습니다. 다시 로그인해주세요.', 401)
        return unavailable(headers)
      }
      if (!identity?.uid || typeof identity.uid !== 'string') throw new GlobalChatError('UNAUTHENTICATED', '로그인이 필요합니다.', 401)
      const timestamp = now()
      const previous = limits.get(identity.uid)
      const bucket = previous && previous.expiresAt > timestamp ? previous : { count: 0, expiresAt: timestamp + 10_000 }
      bucket.count += 1
      // Best-effort HTTP throttling is bounded per warm function. The actual
      // send cooldown is transactional and shared by every server instance.
      if (limits.size >= 2000) for (const [key, value] of limits) if (value.expiresAt <= timestamp) limits.delete(key)
      if (limits.size < 2000 || limits.has(identity.uid)) limits.set(identity.uid, bucket)
      else throw new GlobalChatError('RATE_LIMITED', '요청이 많습니다. 잠시 후 다시 시도해주세요.', 429, 10_000)
      if (bucket.count > 30) throw new GlobalChatError('RATE_LIMITED', '요청이 너무 빠릅니다. 잠시 후 다시 시도해주세요.', 429, bucket.expiresAt - timestamp)
      return response(await service.execute(identity, payload), 200, headers)
    } catch (error) {
      if (error instanceof GlobalChatError || (Number.isInteger(error?.status) && error.status >= 400 && error.status < 500 && /^GUEST_/.test(error?.code ?? ''))) {
        const retryAfterMs = Number.isFinite(error.retryAfterMs) ? Math.max(1, Math.ceil(error.retryAfterMs)) : undefined
        return response({ error: { code: error.code, message: error.message, ...(retryAfterMs ? { retryAfterMs } : {}) } }, error.status,
          { ...headers, ...(retryAfterMs ? { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) } : {}) })
      }
      // Neither SDK errors, private messages, tokens nor database queries leave
      // this boundary through the browser response or server logs.
      return unavailable(headers)
    }
  }
}

let productionHandler
export async function handleProductionGlobalChatRequest(request) {
  if (!productionHandler) productionHandler = getProductionServices().then(({ rankedStore, guestRegistry, authenticate }) => {
    return createGlobalChatHttpHandler({ service: createGlobalChatService({ store: rankedStore, guestRegistry }), authenticate })
  }).catch(() => { productionHandler = null; return () => unavailable() })
  return (await productionHandler)(request)
}
