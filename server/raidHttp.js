import { createAccountRaidPokemonResolver } from './accountService.js'
import { getProductionServices } from './productionServices.js'
import { createLocalRankedAuthenticator } from './rankedHttp.js'
import { createRaidService, RaidError } from './raidService.js'

const MAX_BODY = 128 * 1024
const localHost = hostname => ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)
const response = (body, status = 200, headers = {}) => Response.json(body, {
  status,
  headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers },
})
const AUTH_REJECTION_CODES = new Set([
  'auth/argument-error', 'auth/invalid-argument', 'auth/invalid-id-token',
  'auth/id-token-expired', 'auth/id-token-revoked', 'auth/user-disabled', 'auth/user-not-found',
])
const DIAGNOSTIC_CODES = new Set([
  ...AUTH_REJECTION_CODES, 'auth/internal-error', 'auth/invalid-credential',
  'auth/insufficient-permission', 'auth/certificate-fetch-failed',
  'app/invalid-credential', 'app/network-error', 'app/network-timeout',
  'ranked/configuration-incomplete', 'ranked/project-mismatch',
  'ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND', 'ERR_REQUIRE_ESM', 'ERR_PACKAGE_PATH_NOT_EXPORTED', 'ERR_REQUIRE_ASYNC_MODULE',
])
const STARTUP_STEPS = new Set(['firebase-app', 'firebase-auth', 'firebase-firestore', 'raid-engine', 'credential-json', 'credential', 'postgres-store'])

function logFailure(stage, error) {
  // Keep state, body, code and bearer credentials out of server diagnostics.
  const code = DIAGNOSTIC_CODES.has(error?.code) ? error.code
    : Number.isInteger(error?.code) && error.code >= 0 && error.code <= 16 ? `grpc/${error.code}` : 'unknown'
  const step = STARTUP_STEPS.has(error?.rankedStartupStep) ? error.rankedStartupStep : undefined
  const type = ['SyntaxError', 'TypeError', 'ReferenceError'].includes(error?.name) ? error.name : undefined
  console.error('Raid server failure', { stage, code, ...(step ? { step } : {}), ...(type ? { type } : {}) })
}

async function startupModule(step, promise) {
  try { return await promise } catch (error) { error.rankedStartupStep = step; throw error }
}

async function readPayload(request) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new RaidError('INVALID_CONTENT_TYPE', 'JSON 형식의 요청이 필요합니다.', 415)
  const length = Number(request.headers.get('content-length'))
  if (Number.isFinite(length) && length > MAX_BODY) throw new RaidError('BODY_TOO_LARGE', '요청 내용이 너무 큽니다.', 413)
  const reader = request.body?.getReader()
  if (!reader) throw new RaidError('INVALID_JSON', '요청 내용이 비어 있습니다.')
  const chunks = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_BODY) { await reader.cancel(); throw new RaidError('BODY_TOO_LARGE', '요청 내용이 너무 큽니다.', 413) }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  let payload
  try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new RaidError('INVALID_JSON', '요청 내용을 읽을 수 없습니다.') }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new RaidError('INVALID_JSON', '요청 형식이 올바르지 않습니다.')
  return payload
}

export function createRaidHttpHandler({ service, authenticate, enabled = false, unavailable = false, allowLocalOrigins = false, legacyMatching = true, now = Date.now } = {}) {
  const buckets = new Map()
  function limit(uid, mutation) {
    const timestamp = now()
    const previous = buckets.get(uid)
    const bucket = !previous || previous.expiresAt <= timestamp ? { count: 0, expiresAt: timestamp + 10_000 } : previous
    bucket.count += mutation ? 3 : 1
    if (buckets.size >= 2000) for (const [key, value] of buckets) if (value.expiresAt <= timestamp) buckets.delete(key)
    if (buckets.size < 2000 || buckets.has(uid)) buckets.set(uid, bucket)
    else throw new RaidError('RATE_LIMITED', '요청이 많습니다. 잠시 후 다시 시도해주세요.', 429)
    if (bucket.count > 60) throw new RaidError('RATE_LIMITED', '요청이 너무 빠릅니다. 잠시 후 다시 시도해주세요.', 429)
  }
  return async request => {
    const headers = {}
    try {
      const url = new URL(request.url)
      const origin = request.headers.get('origin')
      if (origin && origin !== url.origin) {
        let source
        try { source = new URL(origin) } catch { throw new RaidError('ORIGIN_FORBIDDEN', '허용되지 않은 접속 주소입니다.', 403) }
        if (!allowLocalOrigins || !localHost(url.hostname) || !localHost(source.hostname) || source.protocol !== 'http:') throw new RaidError('ORIGIN_FORBIDDEN', '허용되지 않은 접속 주소입니다.', 403)
        headers['Access-Control-Allow-Origin'] = origin
        headers.Vary = 'Origin'
      }
      if (!origin && request.headers.get('sec-fetch-site') === 'cross-site') throw new RaidError('ORIGIN_FORBIDDEN', '허용되지 않은 접속 주소입니다.', 403)
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: {
        ...headers,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Max-Age': '600',
      } })
      if (!['GET', 'POST'].includes(request.method)) return response({ error: { code: 'METHOD_NOT_ALLOWED', message: '허용되지 않은 요청 방식입니다.' } }, 405, { ...headers, Allow: 'GET, POST, OPTIONS' })
      if (unavailable) throw new RaidError('RAID_UNAVAILABLE', '보스전 서버에 일시적인 문제가 있습니다. 잠시 후 다시 연결해주세요.', 503)
      if (!enabled || !service || !authenticate) throw new RaidError('RAID_DISABLED', '협동 보스전은 현재 준비 중입니다.', 503)
      const bearer = /^Bearer ([^\s]{8,4096})$/.exec(request.headers.get('authorization') ?? '')
      if (!bearer) throw new RaidError('UNAUTHENTICATED', '로그인이 필요합니다.', 401)
      const payload = request.method === 'GET'
        ? {
            action: url.searchParams.get('action') || 'status',
            ...(url.searchParams.has('raidId') ? { raidId: url.searchParams.get('raidId') } : {}),
            ...(url.searchParams.has('sinceRevision') ? { sinceRevision: url.searchParams.get('sinceRevision') } : {}),
            ...(url.searchParams.has('revision') ? { revision: url.searchParams.get('revision') } : {}),
            ...(url.searchParams.has('eventCursor') ? { eventCursor: url.searchParams.get('eventCursor') } : {}),
          }
        : await readPayload(request)
      if (request.method === 'GET' && !['catalog', 'rooms', 'raidList', 'status'].includes(payload.action)) throw new RaidError('METHOD_NOT_ALLOWED', '상태 변경은 POST 요청만 허용됩니다.', 405)
      if (!legacyMatching && ['rooms', 'roomCreate', 'roomJoin', 'roomReady', 'roomStart', 'roomHeartbeat'].includes(payload.action)) {
        throw new RaidError('MATCHING_RETIRED', '보스전 매칭이 종료되었습니다. 6마리의 팀으로 솔로 보스전에 도전해주세요.', 410)
      }
      let identity
      try {
        identity = await authenticate(request, bearer[1], { freshNickname: ['roomCreate', 'roomJoin'].includes(payload.action) })
      } catch (error) {
        if (error instanceof RaidError) throw error
        if (AUTH_REJECTION_CODES.has(error?.code) || (error?.status === 401 && error?.code === 'UNAUTHENTICATED')) throw new RaidError('UNAUTHENTICATED', '로그인이 만료됐습니다. 다시 로그인해주세요.', 401)
        logFailure('authentication', error)
        throw new RaidError('RAID_UNAVAILABLE', '로그인 확인 서버에 연결할 수 없습니다. 잠시 후 다시 연결해주세요.', 503)
      }
      limit(identity.uid, request.method === 'POST')
      return response(await service.execute(identity, payload), 200, headers)
    } catch (error) {
      if (error instanceof RaidError || (Number.isInteger(error?.status) && error.status >= 400 && error.status < 500)) {
        return response({ error: { code: error.code ?? 'INVALID_COMMAND', message: error.message } }, error.status, headers)
      }
      logFailure('request', error)
      return response({ error: { code: 'RAID_UNAVAILABLE', message: '보스전 서버에 일시적인 문제가 있습니다. 잠시 후 다시 연결해주세요.' } }, 503, headers)
    }
  }
}

// Firebase deployments retain account payloads in the original documents.
// The resolver returns only the server-saved owned entry; client-supplied
// species, moves, stats and item data are ignored.
export function createFirebaseRaidPokemonResolver(firestore) {
  return async (identity, entry) => {
    const captureId = entry?.captureId
    if (typeof captureId !== 'string' || !/^[A-Za-z0-9_.:-]{1,96}$/.test(captureId)) throw new RaidError('INVALID_POKEMON', '보유 포켓몬 한 마리를 선택해주세요.')
    const [collection, progress] = await Promise.all([
      firestore.doc(`players/${identity.uid}/gameData/collection`).get(),
      firestore.doc(`players/${identity.uid}/gameData/progress`).get(),
    ])
    let owned, inventory
    try {
      if (collection.data()?.revision !== progress.data()?.revision) throw new Error('Account snapshot is changing')
      const payload = collection.data()?.payload ?? {}
      owned = JSON.parse(payload['champions-dex-v2'] ?? payload['champions-box-v1'] ?? '[]')
      inventory = JSON.parse(progress.data()?.payload?.['champions-battle-items-v1'] ?? '{}')
    } catch { throw new RaidError('ACCOUNT_SYNC_REQUIRED', '보유 포켓몬 정보를 서버에 동기화한 뒤 다시 시도해주세요.', 409) }
    if (!Array.isArray(owned) || !inventory || typeof inventory !== 'object' || Array.isArray(inventory)) throw new RaidError('ACCOUNT_SYNC_REQUIRED', '보유 포켓몬 정보를 먼저 동기화해주세요.', 409)
    const pokemon = owned.find(candidate => candidate && typeof candidate === 'object' && candidate.captureId === captureId)
    if (!pokemon) throw new RaidError('POKEMON_NOT_OWNED', '서버에 저장된 보유 포켓몬만 보스전에 참가할 수 있습니다.', 403)
    if (pokemon.heldItemId && !(Number(inventory[pokemon.heldItemId]) > 0)) throw new RaidError('ITEM_NOT_OWNED', '보유 도구 정보를 동기화한 뒤 다시 시도해주세요.', 409)
    return structuredClone(pokemon)
  }
}

export function createLocalRaidAuthenticator(options = {}) {
  return createLocalRankedAuthenticator(options)
}

let productionHandler
export async function handleProductionRaidRequest(request) {
  if (process.env.RAID_ENABLED !== 'true') return createRaidHttpHandler()(request)
  if (!productionHandler) {
    productionHandler = (async () => {
      const [services, engine] = await Promise.all([
        getProductionServices(),
        startupModule('raid-engine', import('./raidBattle.js')),
      ])
      const { rankedStore: store, accountStore, guestRegistry, firestore, authenticate } = services
      const resolvePokemon = accountStore ? createAccountRaidPokemonResolver(accountStore) : createFirebaseRaidPokemonResolver(firestore)
      const service = createRaidService({ store, engine, guestRegistry, resolvePokemon })
      return createRaidHttpHandler({ enabled: true, service, authenticate, legacyMatching: false })
    })().catch(error => {
      logFailure('initialization', error)
      productionHandler = null
      return createRaidHttpHandler({ unavailable: true })
    })
  }
  return (await productionHandler)(request)
}
