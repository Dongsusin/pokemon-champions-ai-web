import { createRankedService, RankedError } from './rankedService.js'
import { getProductionServices } from './productionServices.js'
import { createAccountRankedTeamResolver } from './accountService.js'

const MAX_BODY = 128 * 1024
const localHost = hostname => ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)
const response = (body, status = 200, headers = {}) => Response.json(body, {
  status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers },
})
const TEST_IDENTITIES = Object.freeze({
  'ranked-test-alice': { uid: 'ranked-test-alice', name: '테스트 트레이너 A' },
  'ranked-test-bob': { uid: 'ranked-test-bob', name: '테스트 트레이너 B' },
  'ranked-test-charlie': { uid: 'ranked-test-charlie', name: '테스트 트레이너 C' },
  'ranked-test-dave': { uid: 'ranked-test-dave', name: '테스트 트레이너 D' },
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
  'ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND', 'ERR_REQUIRE_ESM',
  'ERR_PACKAGE_PATH_NOT_EXPORTED', 'ERR_REQUIRE_ASYNC_MODULE',
])
const STARTUP_STEPS = new Set(['firebase-app', 'firebase-auth', 'firebase-firestore', 'battle-engine', 'credential-json', 'credential', 'firebase-client', 'store', 'postgres-store'])

function logFailure(stage, error) {
  // SDK error messages/stacks may contain credentials, tokens, or private paths.
  // Log only our stage and a known SDK / gRPC status code.
  const code = DIAGNOSTIC_CODES.has(error?.code) ? error.code
    : Number.isInteger(error?.code) && error.code >= 0 && error.code <= 16 ? `grpc/${error.code}` : 'unknown'
  const step = STARTUP_STEPS.has(error?.rankedStartupStep) ? error.rankedStartupStep : undefined
  const type = ['SyntaxError', 'TypeError', 'ReferenceError'].includes(error?.name) ? error.name : undefined
  console.error('Ranked server failure', { stage, code, ...(step ? { step } : {}), ...(type ? { type } : {}) })
}

async function startupModule(step, promise) {
  try { return await promise } catch (error) { error.rankedStartupStep = step; throw error }
}

export function createLocalRankedAuthenticator({ enabled, production = process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL) } = {}) {
  if (enabled !== true || production) throw new Error('Test accounts require an explicit loopback-only development server')
  return async (request, token) => {
    const url = new URL(request.url)
    if (!localHost(url.hostname) || url.protocol !== 'http:') throw new RankedError('LOCAL_ONLY', '로컬 테스트 계정은 이 컴퓨터에서만 사용할 수 있습니다.', 403)
    const identity = TEST_IDENTITIES[token]
    if (!identity) throw new RankedError('UNAUTHENTICATED', '테스트 계정을 선택해주세요.', 401)
    return identity
  }
}

async function readPayload(request) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new RankedError('INVALID_CONTENT_TYPE', 'JSON 형식의 요청이 필요합니다.', 415)
  const length = Number(request.headers.get('content-length'))
  if (Number.isFinite(length) && length > MAX_BODY) throw new RankedError('BODY_TOO_LARGE', '요청 내용이 너무 큽니다.', 413)
  const reader = request.body?.getReader()
  if (!reader) throw new RankedError('INVALID_JSON', '요청 내용이 비어 있습니다.')
  const chunks = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_BODY) { await reader.cancel(); throw new RankedError('BODY_TOO_LARGE', '요청 내용이 너무 큽니다.', 413) }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  let payload
  try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new RankedError('INVALID_JSON', '요청 내용을 읽을 수 없습니다.') }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new RankedError('INVALID_JSON', '요청 형식이 올바르지 않습니다.')
  return payload
}

export function createRankedHttpHandler({ service, authenticate, enabled = false, unavailable = false, allowLocalOrigins = false, now = Date.now } = {}) {
  const buckets = new Map()
  function limit(uid, mutation) {
    const timestamp = now()
    const previous = buckets.get(uid)
    const bucket = !previous || previous.expiresAt <= timestamp ? { count: 0, expiresAt: timestamp + 10_000 } : previous
    bucket.count += mutation ? 3 : 1
    buckets.set(uid, bucket)
    if (buckets.size > 2000) for (const [key, value] of buckets) if (value.expiresAt <= timestamp) buckets.delete(key)
    if (bucket.count > 60) throw new RankedError('RATE_LIMITED', '요청이 너무 빠릅니다. 잠시 후 다시 시도해주세요.', 429)
  }
  return async request => {
    const headers = {}
    try {
      const url = new URL(request.url)
      const origin = request.headers.get('origin')
      if (origin && origin !== url.origin) {
        let source
        try { source = new URL(origin) } catch { throw new RankedError('ORIGIN_FORBIDDEN', '허용되지 않은 접속 주소입니다.', 403) }
        if (!allowLocalOrigins || !localHost(url.hostname) || !localHost(source.hostname) || source.protocol !== 'http:') throw new RankedError('ORIGIN_FORBIDDEN', '허용되지 않은 접속 주소입니다.', 403)
        headers['Access-Control-Allow-Origin'] = origin
        headers.Vary = 'Origin'
      }
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: {
        ...headers, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '600',
      } })
      if (!['GET', 'POST'].includes(request.method)) return response({ error: { code: 'METHOD_NOT_ALLOWED', message: '허용되지 않은 요청 방식입니다.' } }, 405, { ...headers, Allow: 'GET, POST, OPTIONS' })
      if (unavailable) throw new RankedError('RANKED_UNAVAILABLE', '대전 서버에 일시적인 문제가 있습니다. 잠시 후 다시 연결해주세요.', 503)
      if (!enabled || !service || !authenticate) throw new RankedError('RANKED_DISABLED', '레이팅 배틀은 현재 테스트 준비 중입니다.', 503)
      const authorization = request.headers.get('authorization') ?? ''
      const match = /^Bearer ([^\s]{8,4096})$/.exec(authorization)
      if (!match) throw new RankedError('UNAUTHENTICATED', '로그인이 필요합니다.', 401)
      const payload = request.method === 'GET'
        ? { action: url.searchParams.get('action') || 'status', ...(url.searchParams.has('matchId') ? { matchId: url.searchParams.get('matchId') } : {}), ...(url.searchParams.has('timelineRevision') ? { timelineRevision: url.searchParams.get('timelineRevision') } : {}),
          ...(url.searchParams.has('matchRevision') ? { matchRevision: url.searchParams.get('matchRevision') } : {}),
          ...(url.searchParams.has('spectateMatchId') ? { spectateMatchId: url.searchParams.get('spectateMatchId') } : {}),
          ...(url.searchParams.has('mode') ? { mode: url.searchParams.get('mode') } : {}),
          ...(url.searchParams.has('spectateTimelineRevision') ? { spectateTimelineRevision: url.searchParams.get('spectateTimelineRevision') } : {}),
        }
        : await readPayload(request)
      if (request.method === 'GET' && !['status', 'queueCounts', 'rooms', 'fixtures', 'usage', 'factoryLeaderboard', 'rankedLeaderboard'].includes(payload.action)) throw new RankedError('METHOD_NOT_ALLOWED', '상태 변경은 POST 요청만 허용됩니다.', 405)
      let identity
      try { identity = await authenticate(request, match[1], { includePublicLabels: payload.action !== 'queueCounts', freshNickname: [
        'join', 'roomCreate', 'roomJoin', 'reportFactoryRun', 'factoryLeaderboard', 'rankedLeaderboard',
      ].includes(payload.action) }) } catch (error) {
        if (error instanceof RankedError) throw error
        if (AUTH_REJECTION_CODES.has(error?.code)) throw new RankedError('UNAUTHENTICATED', '로그인이 만료됐습니다. 다시 로그인해주세요.', 401)
        logFailure('authentication', error)
        throw new RankedError('RANKED_UNAVAILABLE', '로그인 확인 서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.', 503)
      }
      limit(identity.uid, request.method === 'POST')
      return response(await service.execute(identity, payload), 200, headers)
    } catch (error) {
      if (error instanceof RankedError || (Number.isInteger(error?.status) && error.status >= 400 && error.status < 500)) {
        return response({ error: { code: error.code ?? 'INVALID_COMMAND', message: error.message } }, error.status, headers)
      }
      // Never include request bodies, ID tokens, private teams, or Admin SDK errors.
      logFailure('request', error)
      return response({ error: { code: 'RANKED_UNAVAILABLE', message: '대전 서버에 일시적인 문제가 있습니다. 잠시 후 다시 연결해주세요.' } }, 503, headers)
    }
  }
}

export function createFirebaseRankedTeamResolver(firestore) {
  return async (identity, entries) => {
    if (!Array.isArray(entries) || entries.length !== 6) throw new RankedError('INVALID_TEAM', '등록할 포켓몬 6마리를 선택해주세요.')
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
    } catch { throw new RankedError('ACCOUNT_SYNC_REQUIRED', '보유 포켓몬 정보를 서버에 동기화한 뒤 다시 시도해주세요.', 409) }
    if (!Array.isArray(owned) || !inventory || typeof inventory !== 'object' || Array.isArray(inventory)) throw new RankedError('ACCOUNT_SYNC_REQUIRED', '보유 포켓몬 정보를 먼저 동기화해주세요.', 409)
    return entries.map(entry => {
      const pokemon = owned.find(candidate => candidate && typeof candidate === 'object' && candidate.captureId === entry?.captureId)
      if (!pokemon) throw new RankedError('POKEMON_NOT_OWNED', '서버에 저장된 보유 포켓몬만 레이팅에 등록할 수 있습니다.', 403)
      if (pokemon.heldItemId && !(Number(inventory[pokemon.heldItemId]) > 0)) throw new RankedError('ITEM_NOT_OWNED', '보유 도구 정보를 동기화한 뒤 다시 시도해주세요.', 409)
      // Loadouts and species come from the account save, never the join body.
      return structuredClone(pokemon)
    })
  }
}

let productionHandler
let productionBattleEngine
function getProductionBattleEngine() {
  if (!productionBattleEngine) productionBattleEngine = startupModule('battle-engine', import('./rankedBattle.js'))
    .catch(error => { productionBattleEngine = null; throw error })
  return productionBattleEngine
}
export async function handleProductionRankedRequest(request) {
  if (process.env.RANKED_ENABLED !== 'true') return createRankedHttpHandler()(request)
  if (!productionHandler) {
    productionHandler = (async () => {
      const services = await getProductionServices()
      const { rankedStore: store, accountStore, guestRegistry, firestore, authenticate } = services
      const resolveTeam = accountStore ? createAccountRankedTeamResolver(accountStore) : createFirebaseRankedTeamResolver(firestore)
      // Passive polls never need the battle catalog, which is substantially
      // larger than the queue, profile and leaderboard service modules.
      const service = createRankedService({ store, loadEngine: getProductionBattleEngine, guestRegistry, resolveTeam,
        usageEnabled: process.env.POKEMON_USAGE_ENABLED === 'true' })
      return createRankedHttpHandler({ enabled: true, service, authenticate })
    })().catch(error => {
      logFailure('initialization', error)
      productionHandler = null
      return createRankedHttpHandler({ unavailable: true })
    })
  }
  return (await productionHandler)(request)
}
