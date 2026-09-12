import { createPublicKey, verify } from 'node:crypto'
import { createDiscordRest, prepareDiscordInteraction } from './discordCommunity.js'

const MAX_BODY_BYTES = 64 * 1024
const SNOWFLAKE = /^\d{16,22}$/
const json = (body, status = 200, headers = {}) => Response.json(body, {
  status, headers: { 'Cache-Control': 'no-store', ...headers },
})
const ephemeral = content => ({ type: 4, data: { content, flags: 64, allowed_mentions: { parse: [] } } })

export function readDiscordConfig(env = process.env) {
  const value = name => String(env[name] ?? '').trim()
  return {
    applicationId: value('DISCORD_APPLICATION_ID'),
    publicKey: value('DISCORD_PUBLIC_KEY'),
    botToken: value('DISCORD_BOT_TOKEN'),
    guildId: value('DISCORD_GUILD_ID'),
    freeChannelId: value('DISCORD_FREE_CHANNEL_ID'),
    bugChannelId: value('DISCORD_BUG_CHANNEL_ID'),
    ideaChannelId: value('DISCORD_IDEA_CHANNEL_ID'),
    updateChannelId: value('DISCORD_UPDATE_CHANNEL_ID'),
    moderatorRoleId: value('DISCORD_MODERATOR_ROLE_ID'),
  }
}

function ready(config) {
  return ['applicationId', 'guildId', 'freeChannelId', 'bugChannelId', 'ideaChannelId', 'updateChannelId']
    .every(name => SNOWFLAKE.test(config[name]))
    && Boolean(config.botToken) && !/[\s]/.test(config.botToken)
    && (!config.moderatorRoleId || SNOWFLAKE.test(config.moderatorRoleId))
}

// Discord signs timestamp + the original UTF-8 bytes. Do not parse/re-serialize
// JSON before verification. No user-account token or browser session is used.
export function verifyDiscordSignature({ body, signature, timestamp, publicKey, now = Date.now() }) {
  if (!/^[a-f\d]{64}$/i.test(publicKey ?? '')
    || !/^[a-f\d]{128}$/i.test(signature ?? '')
    || !/^\d{1,12}$/.test(timestamp ?? '')
    || Math.abs(now / 1000 - Number(timestamp)) > 300) return false
  try {
    const key = createPublicKey({ key: Buffer.concat([
      Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(publicKey, 'hex'),
    ]), format: 'der', type: 'spki' })
    return verify(null, Buffer.concat([Buffer.from(timestamp), body]), key, Buffer.from(signature, 'hex'))
  } catch { return false }
}

async function readBody(request) {
  if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) return null
  if (!request.body) return Buffer.alloc(0)
  const reader = request.body.getReader()
  const chunks = []
  let length = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > MAX_BODY_BYTES) {
        await reader.cancel()
        return null
      }
      chunks.push(Buffer.from(value))
    }
    return Buffer.concat(chunks)
  } finally { reader.releaseLock() }
}

export function createDiscordInteractionHandler({
  env = process.env,
  schedule,
  now = () => Date.now(),
  prepare = prepareDiscordInteraction,
  restFactory = createDiscordRest,
  onBackgroundError = () => console.error('Discord community interaction background operation failed.'),
} = {}) {
  // Limits duplicate dispatch within a warm instance; Discord message nonces in
  // the service provide the cross-instance duplicate-message protection.
  const recent = new Map()
  return async function handle(request) {
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, { Allow: 'POST' })
    const config = readDiscordConfig(env)
    if (!/^[a-f\d]{64}$/i.test(config.publicKey)) return json({ error: 'Discord integration is not configured' }, 503)
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) {
      return json({ error: 'Content-Type must be application/json' }, 415)
    }
    let body
    try { body = await readBody(request) } catch { return json({ error: 'Unable to read request' }, 400) }
    if (!body) return json({ error: 'Request is too large' }, 413)
    if (!verifyDiscordSignature({ body, publicKey: config.publicKey,
      signature: request.headers.get('x-signature-ed25519'),
      timestamp: request.headers.get('x-signature-timestamp'), now: now() })) {
      return json({ error: 'Invalid request signature' }, 401)
    }
    let interaction
    try { interaction = JSON.parse(body.toString('utf8')) } catch { return json({ error: 'Invalid JSON' }, 400) }
    if (!interaction || typeof interaction !== 'object' || Array.isArray(interaction)) return json({ error: 'Invalid interaction' }, 400)
    if (interaction.type === 1) return json({ type: 1 })
    if (!ready(config)) return json(ephemeral('커뮤니티 봇 연결을 준비하고 있습니다. 지금은 각 채널에 직접 글을 남겨 주세요.'))
    if (interaction.application_id !== config.applicationId || interaction.guild_id !== config.guildId) {
      return json(ephemeral('이 봇은 지정된 게임 커뮤니티 서버에서 사용할 수 있습니다.'))
    }
    if (!SNOWFLAKE.test(interaction.id ?? '') || !SNOWFLAKE.test(interaction.member?.user?.id ?? '')
      || typeof interaction.token !== 'string' || interaction.token.length < 1 || interaction.token.length > 512
      || /[\s]/.test(interaction.token)) return json({ error: 'Invalid interaction' }, 400)
    const time = now()
    for (const [id, entry] of recent) if (time - entry.time > 300_000) recent.delete(id)
    const cached = recent.get(interaction.id)
    if (cached) return json(cached.response)
    let result
    try { result = prepare(interaction, { config, rest: restFactory({ token: config.botToken }) }) }
    catch { return json(ephemeral('요청을 열지 못했습니다. 잠시 후 다시 시도해 주세요.')) }
    if (!result?.response) return json({ error: 'Invalid interaction response' }, 500)
    if (result.run && typeof schedule !== 'function') return json({ error: 'Background runtime is unavailable' }, 503)
    if (recent.size >= 1000) recent.delete(recent.keys().next().value)
    recent.set(interaction.id, { time, response: result.response })
    if (result.run) {
      let start
      const task = new Promise(resolve => { start = resolve })
        .then(proceed => proceed ? result.run() : undefined)
        .catch(() => onBackgroundError())
      try {
        schedule(task)
        start(true)
      } catch {
        start(false)
        recent.delete(interaction.id)
        return json({ error: 'Background runtime is unavailable' }, 503)
      }
    }
    return json(result.response)
  }
}
