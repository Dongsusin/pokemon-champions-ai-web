import { AccountError, ACCOUNT_PAYLOAD_MAX_BYTES, createAccountService } from './accountService.js'
import { getProductionServices } from './productionServices.js'
import { createRaidRewardTotalResolver } from './raidWallet.js'
import { createRankedService } from './rankedService.js'

export const ACCOUNT_HTTP_MAX_BYTES = ACCOUNT_PAYLOAD_MAX_BYTES + 8192
const localHost = hostname => ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)
const response = (body, status = 200, headers = {}) => Response.json(body, {
  status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers },
})
const authRejected = new Set(['auth/argument-error', 'auth/invalid-argument', 'auth/invalid-id-token', 'auth/id-token-expired', 'auth/id-token-revoked', 'auth/user-disabled', 'auth/user-not-found'])
const unavailable = (headers = {}) => response({ error: { code: 'account-session/unavailable', message: '게임 저장 서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.' } }, 503, headers)
const startupCodes = new Set(['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND', 'ERR_REQUIRE_ESM', 'ERR_PACKAGE_PATH_NOT_EXPORTED', 'ERR_REQUIRE_ASYNC_MODULE', 'ranked/configuration-incomplete', 'ranked/project-mismatch', 'app/invalid-credential'])
const startupSteps = new Set(['firebase-app', 'firebase-auth', 'firebase-firestore', 'postgres-store', 'credential-json'])

async function readPayload(request) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new AccountError('INVALID_CONTENT_TYPE', 'JSON 형식의 요청이 필요합니다.', 415)
  const length = Number(request.headers.get('content-length'))
  if (Number.isFinite(length) && length > ACCOUNT_HTTP_MAX_BYTES) throw new AccountError('BODY_TOO_LARGE', '요청 내용이 너무 큽니다.', 413)
  const reader = request.body?.getReader()
  if (!reader) throw new AccountError('INVALID_JSON', '요청 내용이 비어 있습니다.')
  let size = 0
  const chunks = []
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > ACCOUNT_HTTP_MAX_BYTES) { await reader.cancel(); throw new AccountError('BODY_TOO_LARGE', '요청 내용이 너무 큽니다.', 413) }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  let payload
  try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new AccountError('INVALID_JSON', '요청 내용을 읽을 수 없습니다.') }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new AccountError('INVALID_JSON', '요청 형식이 올바르지 않습니다.')
  return payload
}

export function createAccountHttpHandler({ service, authenticate, allowLocalOrigins = false, now = Date.now } = {}) {
  const limits = new Map()
  return async request => {
    const headers = {}
    try {
      const url = new URL(request.url)
      const origin = request.headers.get('origin')
      if (origin && origin !== url.origin) {
        let source
        try { source = new URL(origin) } catch { throw new AccountError('ORIGIN_FORBIDDEN', '허용되지 않은 접속 주소입니다.', 403) }
        if (!allowLocalOrigins || !localHost(url.hostname) || !localHost(source.hostname) || source.protocol !== 'http:') throw new AccountError('ORIGIN_FORBIDDEN', '허용되지 않은 접속 주소입니다.', 403)
        headers['Access-Control-Allow-Origin'] = origin
        headers.Vary = 'Origin'
      }
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...headers, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' } })
      if (request.method !== 'POST') return response({ error: { code: 'METHOD_NOT_ALLOWED', message: 'POST 요청만 허용됩니다.' } }, 405, { ...headers, Allow: 'POST, OPTIONS' })
      if (!service || !authenticate) return unavailable(headers)
      const match = /^Bearer ([^\s]{8,4096})$/.exec(request.headers.get('authorization') ?? '')
      if (!match) throw new AccountError('UNAUTHENTICATED', '로그인이 필요합니다.', 401)
      let identity
      try { identity = await authenticate(request, match[1]) } catch (error) {
        if (authRejected.has(error?.code) || (error?.status === 401 && error?.code === 'UNAUTHENTICATED')) throw new AccountError('UNAUTHENTICATED', '로그인이 만료됐습니다. 다시 로그인해주세요.', 401)
        return unavailable(headers)
      }
      const timestamp = now()
      const previous = limits.get(identity?.uid)
      const bucket = previous && previous.expiresAt > timestamp ? previous : { count: 0, expiresAt: timestamp + 10_000 }
      bucket.count += 1
      limits.set(identity?.uid, bucket)
      if (limits.size > 2000) for (const [key, value] of limits) if (value.expiresAt <= timestamp) limits.delete(key)
      if (bucket.count > 40) throw new AccountError('RATE_LIMITED', '요청이 너무 빠릅니다. 잠시 후 다시 시도해주세요.', 429)
      return response(await service.execute(identity, await readPayload(request)), 200, headers)
    } catch (error) {
      if (error instanceof AccountError || (Number.isInteger(error?.status) && error.status >= 400 && error.status < 500)) {
        return response({ error: { code: error.code ?? 'INVALID_COMMAND', message: error.message } }, error.status, headers)
      }
      // SDK/SQL error messages can include credentials, queries or private save
      // data. Do not include them in a browser response or server logs.
      return unavailable(headers)
    }
  }
}

let productionHandler
export async function handleProductionAccountRequest(request) {
  if (process.env.GAME_STORAGE_PROVIDER !== 'supabase') return unavailable()
  if (!productionHandler) productionHandler = getProductionServices().then(({ accountStore, rankedStore, guestRegistry, authenticate }) => {
    if (!accountStore) throw new Error('Account storage is unavailable')
    const ranked = createRankedService({ store: rankedStore, guestRegistry })
    return createAccountHttpHandler({ service: createAccountService({ store: accountStore, guestRegistry, deleteGuestData: ranked.deleteGuestAccount, resolveRaidRewardTotal: createRaidRewardTotalResolver(rankedStore) }), authenticate })
  }).catch(error => {
    // Restrict diagnostics to known labels; never log SDK messages or secrets.
    console.error('Account server initialization failed', {
      code: startupCodes.has(error?.code) ? error.code : 'unknown',
      step: startupSteps.has(error?.rankedStartupStep) ? error.rankedStartupStep : 'configuration',
    })
    productionHandler = null
    return () => unavailable()
  })
  return (await productionHandler)(request)
}
