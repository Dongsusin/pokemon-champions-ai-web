import { createHash } from 'node:crypto'

const MAX_BODY_BYTES = 32 * 1024
const SEND_TIMEOUT_MS = 8_000
const CACHE_TTL_MS = 30 * 60_000
const RATE_WINDOW_MS = 10 * 60_000
const COOLDOWN_MS = 30_000
const MAX_ATTEMPTS = 5
const MAX_REPORTS = 1_000
const MAX_CLIENTS = 2_000
const FETCH_FAILURE_CODES = new Set([
  'ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ERR_NETWORK',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET',
  'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'DEPTH_ZERO_SELF_SIGNED_CERT',
  'ERR_TLS_CERT_ALTNAME_INVALID', 'ABORT_ERR',
])
const CATEGORIES = Object.freeze({
  battle: '배틀', account: '로그인·저장', collection: '포켓몬·아이템',
  display: '화면·조작', sound: '음악·효과음', other: '기타',
})
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const EMAIL = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i

class ReportError extends Error {
  constructor(status, code, message, retryAfter) {
    super(message)
    Object.assign(this, { status, code, retryAfter })
  }
}

function validEmail(value) {
  return typeof value === 'string' && value.length <= 254 && EMAIL.test(value)
}

function header(req, name) {
  const value = req.headers?.[name]
  return typeof value === 'string' ? value : ''
}

function configuration(env) {
  const provider = (env.BUG_REPORT_PROVIDER || 'formsubmit').toLowerCase()
  const recipient = env.BUG_REPORT_TO?.trim() || ''
  const from = env.BUG_REPORT_FROM?.trim() || ''
  const senderAddress = from.match(/^[^<>\r\n]+<([^<>]+)>$/)?.[1] || from
  const configured = validEmail(recipient) && (provider === 'formsubmit'
    || (provider === 'resend' && Boolean(env.RESEND_API_KEY) && validEmail(senderAddress)))
  return { provider, recipient, from, enabled: env.BUG_REPORT_ENABLED === 'true' && configured }
}

function sendJson(res, status, payload, retryAfter) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  if (retryAfter) res.setHeader('Retry-After', String(retryAfter))
  res.end(JSON.stringify(payload))
}

function requestOrigin(req, env) {
  const rawOrigin = header(req, 'origin')
  let origin
  try {
    origin = new URL(rawOrigin)
    if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== rawOrigin) throw new Error()
  } catch {
    throw new ReportError(403, 'ORIGIN_REJECTED', '게임 페이지에서 다시 신고해 주세요.')
  }
  const allowed = new Set((env.BUG_REPORT_ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean))
  const host = header(req, 'host')
  const protocol = header(req, 'x-forwarded-proto').split(',')[0].trim()
    || (req.socket?.encrypted ? 'https' : 'http')
  if (host && ['http', 'https'].includes(protocol)) allowed.add(`${protocol}://${host}`)
  if (!allowed.has(origin.origin)) throw new ReportError(403, 'ORIGIN_REJECTED', '게임 페이지에서 다시 신고해 주세요.')
  return origin.origin
}

async function readBody(req) {
  const rawLength = header(req, 'content-length')
  if (rawLength && (!/^\d+$/.test(rawLength) || Number(rawLength) > MAX_BODY_BYTES)) {
    throw new ReportError(413, 'BODY_TOO_LARGE', '신고 내용이 너무 깁니다. 내용을 줄여 주세요.')
  }
  if (!/^application\/json(?:\s*;|$)/i.test(header(req, 'content-type'))) {
    throw new ReportError(415, 'JSON_REQUIRED', '신고 내용을 JSON 형식으로 보내 주세요.')
  }
  let body = req.body
  if (body === undefined) {
    const chunks = []
    let size = 0
    for await (const chunk of req) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += bytes.length
      if (size > MAX_BODY_BYTES) throw new ReportError(413, 'BODY_TOO_LARGE', '신고 내용이 너무 깁니다. 내용을 줄여 주세요.')
      chunks.push(bytes)
    }
    body = Buffer.concat(chunks).toString('utf8')
  } else if (Buffer.isBuffer(body)) {
    if (body.length > MAX_BODY_BYTES) throw new ReportError(413, 'BODY_TOO_LARGE', '신고 내용이 너무 깁니다. 내용을 줄여 주세요.')
    body = body.toString('utf8')
  }
  try {
    const serialized = typeof body === 'string' ? body : JSON.stringify(body)
    if (Buffer.byteLength(serialized || '', 'utf8') > MAX_BODY_BYTES) {
      throw new ReportError(413, 'BODY_TOO_LARGE', '신고 내용이 너무 깁니다. 내용을 줄여 주세요.')
    }
    const parsed = typeof body === 'string' ? JSON.parse(body) : body
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error()
    return parsed
  } catch (error) {
    if (error instanceof ReportError) throw error
    throw new ReportError(400, 'INVALID_JSON', '신고 내용을 읽지 못했습니다. 다시 작성해 주세요.')
  }
}

function field(body, name, max, min = 0, singleLine = false) {
  const value = body[name] ?? ''
  if (typeof value !== 'string' || value.length > max || value.trim().length < min
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
    || (singleLine && /[\r\n]/.test(value))) {
    throw new ReportError(400, 'INVALID_REPORT', '입력 항목의 길이와 내용을 확인해 주세요.')
  }
  return value.trim()
}

function safeDiagnosticText(value, max) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max).trim() : ''
}

function dimensions(value) {
  if (!value || typeof value !== 'object') return null
  const width = Number(value.width)
  const height = Number(value.height)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1 || width > 32_768 || height > 32_768) return null
  return { width: Math.round(width), height: Math.round(height) }
}

function diagnostics(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const page = typeof value.page === 'string' && /^\/(?!\/)/.test(value.page)
    ? value.page.split(/[?#]/)[0].replace(/[\u0000-\u0020\u007f]/g, '').slice(0, 160) : ''
  const viewport = dimensions(value.viewport)
  const screen = dimensions(value.screen)
  return {
    page,
    viewport: viewport ? `${viewport.width} × ${viewport.height}` : '',
    screen: screen ? `${screen.width} × ${screen.height}` : safeDiagnosticText(value.screen, 80),
    userAgent: safeDiagnosticText(value.userAgent, 400),
    language: safeDiagnosticText(value.language, 35),
    build: safeDiagnosticText(value.build, 80),
  }
}

function validateReport(body) {
  if (typeof body.requestId !== 'string' || !UUID.test(body.requestId) || !Object.hasOwn(CATEGORIES, body.category)) {
    throw new ReportError(400, 'INVALID_REPORT', '신고 항목을 확인한 뒤 다시 보내 주세요.')
  }
  if (body.website !== undefined && body.website !== '') {
    throw new ReportError(400, 'INVALID_REPORT', '신고 항목을 확인한 뒤 다시 보내 주세요.')
  }
  const replyTo = field(body, 'replyTo', 254, 0, true)
  if (replyTo && !validEmail(replyTo)) throw new ReportError(400, 'INVALID_EMAIL', '답변받을 이메일 주소를 확인해 주세요.')
  return {
    requestId: body.requestId.toLowerCase(),
    title: field(body, 'title', 100, 1, true),
    category: body.category,
    description: field(body, 'description', 4_000, 10),
    steps: field(body, 'steps', 2_000),
    expected: field(body, 'expected', 1_000),
    replyTo,
    diagnostics: diagnostics(body.diagnostics),
  }
}

function messageText(report, reportId, origin) {
  const lines = [
    '챔피언스 아레나 버그 신고', `신고 번호: ${reportId}`, `게임: ${origin}`,
    `분류: ${CATEGORIES[report.category]}`, `제목: ${report.title}`,
    `답변받을 이메일: ${report.replyTo || '입력하지 않음'}`,
    '', '[문제 내용]', report.description,
    '', '[재현 방법]', report.steps || '입력하지 않음',
    '', '[기대한 결과]', report.expected || '입력하지 않음',
  ]
  if (report.diagnostics) {
    const labels = { page: '페이지', viewport: '화면 크기', screen: '현재 게임 화면', userAgent: '브라우저', language: '언어', build: '빌드' }
    lines.push('', '[사용자가 동의한 진단 정보]')
    for (const [key, value] of Object.entries(report.diagnostics)) if (value) lines.push(`${labels[key]}: ${value}`)
  }
  return lines.join('\n')
}

function logDeliveryFailure(logger, provider, context, error) {
  const causeCode = error instanceof ReportError ? undefined : error?.cause?.code ?? error?.code
  const transportCode = typeof causeCode !== 'string' ? null
    : FETCH_FAILURE_CODES.has(causeCode) ? causeCode : 'OTHER'
  try {
    // All fields are local enums or a bounded HTTP status. Never log an Error,
    // provider body, URL, email address, request ID, submitted text, or headers.
    logger({ event: 'bug_report_delivery_failed', provider, ...context, transportCode })
  } catch {
    // A logger failure must not change a send result or trigger another email.
  }
}

async function deliver({ report, reportId, origin, config, env, fetchImpl, timeoutMs, logger }) {
  const subject = `[챔피언스 아레나 버그 신고] ${report.title}`
  const text = messageText(report, reportId, origin)
  const resend = config.provider === 'resend'
  const url = resend ? 'https://api.resend.com/emails' : `https://formsubmit.co/ajax/${encodeURIComponent(config.recipient)}`
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' }
  let body
  if (resend) {
    headers.Authorization = `Bearer ${env.RESEND_API_KEY}`
    headers['Idempotency-Key'] = report.requestId
    body = { from: config.from, to: [config.recipient], subject, text, ...(report.replyTo ? { reply_to: report.replyTo } : {}) }
  } else {
    headers.Origin = origin
    headers.Referer = `${origin}/`
    body = { _subject: subject, _template: 'table', _captcha: 'false', _url: `${origin}/`, message: text, ...(report.replyTo ? { email: report.replyTo, _replyto: report.replyTo } : {}) }
  }
  const controller = new AbortController()
  const failureContext = { stage: 'fetch', httpStatus: null, mediaType: 'missing' }
  let timer
  try {
    const response = await Promise.race([
      (async () => {
        const upstream = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal, redirect: 'error' })
        failureContext.httpStatus = Number.isInteger(upstream.status) && upstream.status >= 100 && upstream.status <= 599 ? upstream.status : null
        const mediaType = (upstream.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
        failureContext.mediaType = !mediaType ? 'missing'
          : ['application/json', 'text/html', 'text/plain'].includes(mediaType) ? mediaType : 'other'
        // FormSubmit currently returns JSON with text/html on its AJAX endpoint.
        // Parse and validate the body; an HTML page is never a successful send.
        failureContext.stage = 'http'
        if (!upstream.ok) {
          throw new ReportError(502, 'DELIVERY_FAILED', '신고를 전송하지 못했습니다. 잠시 후 다시 시도해 주세요.')
        }
        failureContext.stage = 'content-type'
        if (mediaType !== 'application/json' && (resend || mediaType !== 'text/html')) {
          throw new ReportError(502, 'DELIVERY_FAILED', '신고를 전송하지 못했습니다. 잠시 후 다시 시도해 주세요.')
        }
        failureContext.stage = 'body'
        const raw = await upstream.text()
        if (raw.length > 65_536) throw new Error('Unexpected response size')
        failureContext.stage = 'json'
        return JSON.parse(raw)
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          failureContext.stage = 'timeout'
          controller.abort()
          reject(new ReportError(504, 'DELIVERY_TIMEOUT', '전송 시간이 초과됐습니다. 잠시 후 같은 신고를 다시 보내 주세요.'))
        }, timeoutMs)
      }),
    ])
    failureContext.stage = 'provider-schema'
    if (resend) {
      if (!response || typeof response.id !== 'string' || !response.id || response.error) throw new Error('Email not accepted')
    } else {
      if (!response || typeof response !== 'object' || Array.isArray(response)
        || !['boolean', 'string'].includes(typeof response.success)
        || (response.message !== undefined && typeof response.message !== 'string')) throw new Error('Unexpected provider reply')
      const message = typeof response?.message === 'string' ? response.message : ''
      if (/activat|confirm.{0,50}(email|mail|address)|verif.{0,50}(email|mail|address)|check.{0,50}(inbox|mail)/i.test(message)) {
        failureContext.stage = 'activation'
        throw new ReportError(503, 'ACTIVATION_REQUIRED', '버그 신고 수신함을 준비하고 있습니다. 잠시 후 다시 시도해 주세요.')
      }
      if (response?.success !== true && response?.success !== 'true') {
        failureContext.stage = /web server|HTML files/i.test(message) ? 'provider-origin' : 'provider-rejected'
        throw new Error('Email not accepted')
      }
    }
  } catch (error) {
    logDeliveryFailure(logger, config.provider, failureContext, error)
    if (error instanceof ReportError) throw error
    throw new ReportError(502, 'DELIVERY_FAILED', '신고를 전송하지 못했습니다. 잠시 후 다시 시도해 주세요.')
  } finally {
    clearTimeout(timer)
  }
}

/** Node/Vercel handler. Rate limits and duplicate suppression are best effort per server instance. */
export function createBugReportHandler({
  env = process.env, fetch: fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = SEND_TIMEOUT_MS,
  logger = entry => console.warn('[bug-report]', JSON.stringify(entry)),
} = {}) {
  const reports = new Map()
  const clients = new Map()

  function prune(time) {
    for (const [id, record] of reports) if (!record.pending && time - record.createdAt >= CACHE_TTL_MS) reports.delete(id)
    for (const [id, record] of clients) if (time - record.lastAttempt >= RATE_WINDOW_MS) clients.delete(id)
  }

  function checkRate(req, time) {
    const address = header(req, 'x-vercel-forwarded-for') || header(req, 'x-forwarded-for').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown'
    const key = createHash('sha256').update(address).digest('hex')
    const record = clients.get(key) || { attempts: [], lastAttempt: -Infinity }
    record.attempts = record.attempts.filter(value => time - value < RATE_WINDOW_MS)
    const until = Math.max(record.lastAttempt + COOLDOWN_MS, record.attempts.length >= MAX_ATTEMPTS ? record.attempts[0] + RATE_WINDOW_MS : 0)
    if (until > time) {
      const retryAfter = Math.ceil((until - time) / 1_000)
      throw new ReportError(429, 'RATE_LIMITED', `${retryAfter}초 후 다시 신고해 주세요.`, retryAfter)
    }
    if (!clients.has(key) && clients.size >= MAX_CLIENTS) clients.delete(clients.keys().next().value)
    record.lastAttempt = time
    record.attempts.push(time)
    clients.set(key, record)
  }

  return async function bugReportHandler(req, res) {
    try {
      const config = configuration(env)
      if (req.method === 'GET') return sendJson(res, 200, { enabled: config.enabled })
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'GET, POST')
        throw new ReportError(405, 'METHOD_NOT_ALLOWED', '지원하지 않는 요청입니다.')
      }
      if (!config.enabled) throw new ReportError(503, 'NOT_CONFIGURED', '버그 신고 수신함을 준비하고 있습니다. 잠시 후 다시 시도해 주세요.')
      const origin = requestOrigin(req, env)
      const report = validateReport(await readBody(req))
      const fingerprint = createHash('sha256').update(JSON.stringify({ origin, report })).digest('hex')
      const time = now()
      prune(time)
      const prior = reports.get(report.requestId)
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new ReportError(409, 'REQUEST_CONFLICT', '신고 내용이 변경되었습니다. 새 신고로 다시 보내 주세요.')
        if (!prior.failed) {
          await prior.promise
          return sendJson(res, 200, { ok: true, reportId: prior.reportId })
        }
      }
      checkRate(req, time)
      if (reports.size >= MAX_REPORTS) {
        const completed = [...reports.entries()].find(([, value]) => !value.pending)
        if (completed) reports.delete(completed[0])
        else throw new ReportError(503, 'BUSY', '신고가 많아 전송이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.')
      }
      const reportId = prior?.reportId || `BR-${new Date(time).toISOString().slice(0, 10).replaceAll('-', '')}-${report.requestId}`
      const record = { fingerprint, reportId, createdAt: time, pending: true, promise: null }
      record.promise = deliver({ report, reportId, origin, config, env, fetchImpl, timeoutMs, logger })
      reports.set(report.requestId, record)
      try {
        await record.promise
        record.pending = false
      } catch (error) {
        record.pending = false
        record.failed = true
        throw error
      }
      sendJson(res, 200, { ok: true, reportId })
    } catch (error) {
      const failure = error instanceof ReportError ? error : new ReportError(500, 'INTERNAL_ERROR', '신고를 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.')
      sendJson(res, failure.status, { ok: false, error: failure.message, code: failure.code, ...(failure.retryAfter ? { retryAfter: failure.retryAfter } : {}) }, failure.retryAfter)
    }
  }
}
