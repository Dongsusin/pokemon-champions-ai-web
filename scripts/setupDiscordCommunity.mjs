import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const RESULT_PATH = path.join(ROOT, 'scripts/.cache/discord-community/setup-result.json')
const ID = /^\d{17,20}$/
const CHANNEL_ENV = Object.freeze({ free: 'DISCORD_FREE_CHANNEL_ID', bug: 'DISCORD_BUG_CHANNEL_ID', idea: 'DISCORD_IDEA_CHANNEL_ID', update: 'DISCORD_UPDATE_CHANNEL_ID' })
export const SETUP_PERMISSIONS = Object.freeze({
  MANAGE_CHANNELS: 1n << 4n, MANAGE_GUILD: 1n << 5n,
  VIEW_CHANNEL: 1n << 10n, SEND_MESSAGES: 1n << 11n, EMBED_LINKS: 1n << 14n,
  READ_MESSAGE_HISTORY: 1n << 16n, CREATE_PUBLIC_THREADS: 1n << 35n,
  CREATE_PRIVATE_THREADS: 1n << 36n, SEND_MESSAGES_IN_THREADS: 1n << 38n,
  PIN_MESSAGES: 1n << 51n,
})
const ADMINISTRATOR = 1n << 3n
const VIEW = SETUP_PERMISSIONS.VIEW_CHANNEL | SETUP_PERMISSIONS.READ_MESSAGE_HISTORY
const WRITE = SETUP_PERMISSIONS.SEND_MESSAGES | SETUP_PERMISSIONS.CREATE_PUBLIC_THREADS | SETUP_PERMISSIONS.CREATE_PRIVATE_THREADS | SETUP_PERMISSIONS.SEND_MESSAGES_IN_THREADS
const DISCUSS = VIEW | SETUP_PERMISSIONS.SEND_MESSAGES | SETUP_PERMISSIONS.CREATE_PUBLIC_THREADS | SETUP_PERMISSIONS.SEND_MESSAGES_IN_THREADS
const BOT_CHANNEL = VIEW | WRITE | SETUP_PERMISSIONS.EMBED_LINKS | SETUP_PERMISSIONS.PIN_MESSAGES
export const SETUP_PERMISSION_VALUE = Object.values(SETUP_PERMISSIONS).reduce((value, bit) => value | bit, 0n).toString()

export class DiscordSetupError extends Error {
  constructor(message) { super(message); this.name = 'DiscordSetupError' }
}
const requireId = (value, label) => {
  if (typeof value !== 'string' || !ID.test(value)) throw new DiscordSetupError(`${label}에 정확한 Discord ID를 설정해 주세요.`)
  return value
}
const bits = value => BigInt(value ?? '0')
const same = (first, second) => JSON.stringify(first) === JSON.stringify(second)

export function readDiscordSetupConfig(env = process.env) {
  const token = env.DISCORD_BOT_TOKEN?.trim()
  if (!token || /[\r\n]/.test(token) || /^(Bot|Bearer)\s/i.test(token)) {
    throw new DiscordSetupError('DISCORD_BOT_TOKEN에 접두어 없는 봇 토큰을 설정해 주세요. 사용자 계정 토큰은 사용할 수 없습니다.')
  }
  const guildId = requireId(env.DISCORD_GUILD_ID, 'DISCORD_GUILD_ID')
  const applicationId = requireId(env.DISCORD_APPLICATION_ID, 'DISCORD_APPLICATION_ID')
  const moderatorRoleId = env.DISCORD_MODERATOR_ROLE_ID ? requireId(env.DISCORD_MODERATOR_ROLE_ID, 'DISCORD_MODERATOR_ROLE_ID') : null
  if (moderatorRoleId === guildId) throw new DiscordSetupError('@everyone을 운영자 역할로 사용할 수 없습니다.')
  const channelIds = Object.fromEntries(Object.entries(CHANNEL_ENV).map(([key, name]) => [key, env[name] ? requireId(env[name], name) : null]))
  const configuredIds = Object.values(channelIds).filter(Boolean)
  if (new Set(configuredIds).size !== configuredIds.length) throw new DiscordSetupError('각 커뮤니티 채널에는 서로 다른 채널 ID가 필요합니다.')
  return { token, guildId, applicationId, moderatorRoleId, channelIds }
}

function basePermissions(guild, roleIds) {
  return guild.roles.filter(role => role.id === guild.id || roleIds.includes(role.id))
    .reduce((value, role) => value | bits(role.permissions), 0n)
}

function effectivePermissions(guild, channel, roleIds, memberId) {
  let value = basePermissions(guild, roleIds)
  if (memberId === guild.owner_id || (value & ADMINISTRATOR)) return (1n << 64n) - 1n
  const overwrites = channel.permission_overwrites || []
  const everyone = overwrites.find(entry => entry.type === 0 && entry.id === guild.id)
  if (everyone) value = (value & ~bits(everyone.deny)) | bits(everyone.allow)
  const roles = overwrites.filter(entry => entry.type === 0 && roleIds.includes(entry.id) && entry.id !== guild.id)
  const deny = roles.reduce((mask, entry) => mask | bits(entry.deny), 0n)
  const allow = roles.reduce((mask, entry) => mask | bits(entry.allow), 0n)
  value = (value & ~deny) | allow
  const member = overwrites.find(entry => entry.type === 1 && entry.id === memberId)
  if (member) value = (value & ~bits(member.deny)) | bits(member.allow)
  return value
}

export function communityChannelOverwrites(key, { guildId, botId, moderatorRoleId }) {
  const overwrites = [
    { id: guildId, type: 0, allow: (key === 'update' ? VIEW : DISCUSS).toString(), deny: (key === 'update' ? WRITE : 0n).toString() },
    { id: botId, type: 1, allow: BOT_CHANNEL.toString(), deny: '0' },
  ]
  if (key === 'update' && moderatorRoleId) overwrites.push({ id: moderatorRoleId, type: 0, allow: (VIEW | WRITE).toString(), deny: '0' })
  return overwrites
}

function resolveChannels(config, channels, definitions) {
  const selected = {}
  for (const definition of definitions) {
    const explicitId = config.channelIds[definition.key]
    const matches = explicitId ? channels.filter(channel => channel.id === explicitId) : channels.filter(channel => channel.name === definition.name)
    if (matches.length > 1) throw new DiscordSetupError(`${definition.name} 채널 이름이 중복됩니다. ${CHANNEL_ENV[definition.key]}로 하나를 지정해 주세요.`)
    if (explicitId && !matches.length) throw new DiscordSetupError(`${CHANNEL_ENV[definition.key]} 채널이 지정한 서버에 없거나 봇이 볼 수 없습니다.`)
    const found = matches[0] || null
    if (found && (found.type !== 0 || (found.guild_id && found.guild_id !== config.guildId))) {
      throw new DiscordSetupError(`${definition.name}에는 지정 서버의 일반 텍스트 채널만 사용할 수 있습니다.`)
    }
    selected[definition.key] = found
  }
  const ids = Object.values(selected).filter(Boolean).map(channel => channel.id)
  if (new Set(ids).size !== ids.length) throw new DiscordSetupError('한 채널을 두 커뮤니티 용도로 함께 사용할 수 없습니다.')
  return selected
}

function channelPermissionProblems(guild, selected, member, botId, moderatorRoleId) {
  const problems = []
  for (const [key, channel] of Object.entries(selected)) {
    if (!channel) continue
    const botPermissions = effectivePermissions(guild, channel, member.roles, botId)
    const requiredBot = BOT_CHANNEL & ~SETUP_PERMISSIONS.CREATE_PRIVATE_THREADS
    if ((botPermissions & requiredBot) !== requiredBot) problems.push(`${CHANNEL_ENV[key]}(${channel.id}): 봇의 보기·발송·링크·기록·스레드·메시지 고정 권한을 확인해 주세요.`)
    const everyonePermissions = effectivePermissions(guild, channel, [], null)
    const requiredEveryone = key === 'update' ? VIEW : DISCUSS
    if ((everyonePermissions & requiredEveryone) !== requiredEveryone) problems.push(`${CHANNEL_ENV[key]}(${channel.id}): @everyone의 채널 보기·기록 읽기${key === 'update' ? '' : '·메시지·공개 스레드 만들기 및 답글'} 권한이 필요합니다.`)
    if (key !== 'update') continue
    const everyone = (channel.permission_overwrites || []).find(entry => entry.type === 0 && entry.id === guild.id)
    if (!everyone || (bits(everyone.deny) & WRITE) !== WRITE || (bits(everyone.allow) & WRITE)) {
      problems.push(`${CHANNEL_ENV[key]}(${channel.id}): @everyone의 메시지 보내기·공개/비공개 스레드 만들기·스레드 답글을 채널에서 거부해야 합니다.`)
    }
    const writableOthers = (channel.permission_overwrites || []).filter(entry => {
      if (!(bits(entry.allow) & WRITE)) return false
      if (entry.type === 1 && [botId, guild.owner_id].includes(entry.id)) return false
      if (entry.type === 0 && entry.id === moderatorRoleId) return false
      const role = guild.roles.find(candidate => candidate.id === entry.id)
      if (entry.type === 0 && role?.tags?.bot_id === botId) return false
      return !(entry.type === 0 && role && (bits(role.permissions) & ADMINISTRATOR))
    })
    if (writableOthers.length) problems.push(`${CHANNEL_ENV[key]}(${channel.id}): 다른 역할/멤버의 쓰기 허용이 공지 전용 권한과 충돌합니다. 서버 소유자가 확인해 주세요.`)
  }
  return problems
}

function commandShape(command) {
  const option = value => ({
    type: value.type, name: value.name, description: value.description || '', required: Boolean(value.required),
    autocomplete: Boolean(value.autocomplete), choices: (value.choices || []).map(choice => ({ name: choice.name, value: choice.value })),
    options: (value.options || []).map(option), channel_types: value.channel_types || [],
    min_value: value.min_value ?? null, max_value: value.max_value ?? null,
    min_length: value.min_length ?? null, max_length: value.max_length ?? null,
  })
  return { type: command.type ?? 1, name: command.name, description: command.description || '',
    options: (command.options || []).map(option), default_member_permissions: command.default_member_permissions ?? null,
    nsfw: Boolean(command.nsfw) }
}

function embedShape(embed) {
  return { title: embed.title || '', description: embed.description || '', url: embed.url || '', color: embed.color ?? null,
    timestamp: embed.timestamp || '', fields: (embed.fields || []).map(field => ({ name: field.name, value: field.value, inline: Boolean(field.inline) })),
    footer: { text: embed.footer?.text || '', icon_url: embed.footer?.icon_url || '' },
    image: embed.image?.url || '', thumbnail: embed.thumbnail?.url || '',
    author: { name: embed.author?.name || '', url: embed.author?.url || '', icon_url: embed.author?.icon_url || '' } }
}
const messageShape = message => ({ content: message.content || '', embeds: (message.embeds || []).map(embedShape) })
const markerOf = message => message.embeds?.find(embed => embed.footer?.text?.startsWith('champions-community:'))?.footer?.text
function messageBody(message, marker, channelId) {
  if (!marker || !/^champions-community:[a-z0-9:-]+$/.test(marker)) throw new DiscordSetupError('커뮤니티 안내 메시지에 유효한 고유 마커가 필요합니다.')
  return { ...structuredClone(message), allowed_mentions: { parse: [], replied_user: false },
    nonce: createHash('sha256').update(`${channelId}:${marker}`).digest('hex').slice(0, 24), enforce_nonce: true }
}

async function findManagedMessages(rest, channelId, botId, markers) {
  const found = new Map()
  const pins = new Set()
  function remember(message, pinned = false) {
    if (pinned) pins.add(message.id)
    if (message.author?.id !== botId || !message.author?.bot) return
    const marker = markerOf(message)
    if (!markers.includes(marker)) return
    const prior = found.get(marker)
    if (prior && prior.id !== message.id) throw new DiscordSetupError(`채널 ${channelId}에서 같은 안내 마커를 가진 봇 메시지가 중복됩니다.`)
    found.set(marker, message)
  }
  let beforePin = ''
  for (let page = 0; page < 25; page++) {
    const response = await rest('GET', `/channels/${channelId}/messages/pins?limit=50${beforePin ? `&before=${encodeURIComponent(beforePin)}` : ''}`)
    if (!Array.isArray(response.items)) throw new DiscordSetupError('Discord 고정 메시지 응답 형식을 확인하지 못했습니다.')
    for (const pin of response.items) if (pin.message) remember(pin.message, true)
    if (!response.has_more) break
    const next = response.items.at(-1)?.pinned_at
    if (!next || next === beforePin || page === 24) throw new DiscordSetupError(`채널 ${channelId}의 고정 메시지가 많아 안전한 중복 확인을 완료하지 못했습니다.`)
    beforePin = next
  }
  if (markers.every(marker => found.has(marker))) return { found, pins }
  let before = ''
  for (let page = 0; page < 25; page++) {
    const messages = await rest('GET', `/channels/${channelId}/messages?limit=100${before ? `&before=${before}` : ''}`)
    if (!Array.isArray(messages)) throw new DiscordSetupError('Discord 메시지 응답 형식을 확인하지 못했습니다.')
    messages.forEach(message => remember(message, Boolean(message.pinned)))
    if (markers.every(marker => found.has(marker)) || messages.length < 100) return { found, pins }
    const next = messages.at(-1)?.id
    if (!ID.test(next || '') || next === before) throw new DiscordSetupError(`채널 ${channelId}의 메시지 페이지를 확인하지 못했습니다.`)
    before = next
  }
  throw new DiscordSetupError(`채널 ${channelId}의 최근 2,500개 메시지에서 안내 중복 확인을 완료하지 못했습니다. 자동 게시를 중단합니다.`)
}

/** No work occurs on import. Default mode performs REST reads only. */
export async function setupDiscordCommunity({ env = process.env, apply = false, rest, commands, definitions, buildGuides, initialUpdate, now = () => new Date(), persistResult } = {}) {
  if (typeof apply !== 'boolean') throw new DiscordSetupError('apply는 명시적인 boolean 값이어야 합니다.')
  const config = readDiscordSetupConfig(env)
  if (!rest || !commands) {
    const module = await import('../server/discordCommunity.js')
    rest ??= module.createDiscordRest({ token: config.token })
    commands ??= module.DISCORD_COMMANDS
  }
  if (!definitions || !buildGuides || !initialUpdate) {
    const content = await import('../server/discordCommunityContent.js')
    definitions ??= content.COMMUNITY_CHANNELS
    buildGuides ??= content.buildCommunityGuides
    initialUpdate ??= content.INITIAL_UPDATE
  }
  if (!Array.isArray(definitions) || !same([...definitions.map(item => item.key)].sort(), ['bug', 'free', 'idea', 'update'])) throw new DiscordSetupError('커뮤니티 채널 4개의 콘텐츠 설정을 확인해 주세요.')
  const bot = await rest('GET', '/users/@me')
  if (!bot?.bot || !ID.test(bot.id || '')) throw new DiscordSetupError('이 설정에는 Discord 봇 계정만 사용할 수 있습니다.')
  const application = await rest('GET', '/oauth2/applications/@me')
  if (application.id !== config.applicationId) throw new DiscordSetupError('봇 토큰과 DISCORD_APPLICATION_ID가 서로 다른 앱입니다.')
  const guild = await rest('GET', `/guilds/${config.guildId}`)
  if (guild.id !== config.guildId || !Array.isArray(guild.roles)) throw new DiscordSetupError('지정한 Discord 서버를 확인하지 못했습니다.')
  if (config.moderatorRoleId && !guild.roles.some(role => role.id === config.moderatorRoleId)) throw new DiscordSetupError('DISCORD_MODERATOR_ROLE_ID가 지정한 서버에 없습니다.')
  const member = await rest('GET', `/guilds/${config.guildId}/members/${bot.id}`)
  if (!Array.isArray(member.roles)) throw new DiscordSetupError('봇의 서버 역할을 확인하지 못했습니다.')
  const allChannels = await rest('GET', `/guilds/${config.guildId}/channels`)
  if (!Array.isArray(allChannels)) throw new DiscordSetupError('Discord 채널 목록을 확인하지 못했습니다.')
  const selected = resolveChannels(config, allChannels, definitions)
  const commandsRoute = `/applications/${config.applicationId}/guilds/${config.guildId}/commands`
  const existingCommands = await rest('GET', commandsRoute)
  if (!Array.isArray(existingCommands)) throw new DiscordSetupError('Discord 서버 명령 목록을 확인하지 못했습니다.')
  const globalPermissions = basePermissions(guild, member.roles)
  const blockers = []
  if (!(globalPermissions & ADMINISTRATOR)) {
    const missing = Object.entries(SETUP_PERMISSIONS).filter(([, value]) => !(globalPermissions & value)).map(([name]) => name)
    if (missing.length) blockers.push(`봇의 최초 설정 권한이 부족합니다: ${missing.join(', ')}`)
  }
  blockers.push(...channelPermissionProblems(guild, selected, member, bot.id, config.moderatorRoleId))
  const plannedIds = Object.fromEntries(definitions.map(({ key }) => [key, selected[key]?.id || null]))
  const actions = []
  for (const definition of definitions) {
    const channel = selected[definition.key]
    if (!channel) actions.push({ type: 'create-channel', key: definition.key, name: definition.name })
    else if ((channel.topic || '') !== definition.topic) actions.push({ type: 'update-topic', key: definition.key, channelId: channel.id })
  }
  const desiredFlags = Number(BigInt(guild.system_channel_flags ?? 0) & ~1n)
  if (!plannedIds.free || guild.system_channel_id !== plannedIds.free || guild.system_channel_flags !== desiredFlags) actions.push({ type: 'native-welcome', key: 'free', systemChannelFlags: desiredFlags })
  const commandPlans = commands.map(command => {
    const matches = existingCommands.filter(existing => existing.name === command.name && (existing.type ?? 1) === (command.type ?? 1))
    if (matches.length > 1) throw new DiscordSetupError(`/${command.name} 서버 명령이 중복돼 있습니다.`)
    const existing = matches[0]
    const changed = !existing || !same(commandShape(existing), commandShape(command))
    if (changed) actions.push({ type: existing ? 'update-command' : 'create-command', name: command.name, ...(existing ? { commandId: existing.id } : {}) })
    return { command, existing, changed }
  })
  const guides = buildGuides(plannedIds)
  const managed = {}
  for (const definition of definitions) {
    const key = definition.key
    const expected = [guides[key], ...(key === 'update' ? [initialUpdate] : [])]
    const markers = expected.map(markerOf)
    expected.forEach((message, index) => messageBody(message, markers[index], plannedIds[key] || key))
    managed[key] = selected[key] && !blockers.length ? await findManagedMessages(rest, selected[key].id, bot.id, markers) : { found: new Map(), pins: new Set() }
    for (let index = 0; index < expected.length; index++) {
      const existing = managed[key].found.get(markers[index])
      if (!existing) actions.push({ type: 'publish-message', key, marker: markers[index], pin: index === 0 })
      else {
        if (!same(messageShape(existing), messageShape(expected[index]))) actions.push({ type: 'update-message', key, marker: markers[index], messageId: existing.id })
        if (index === 0 && !managed[key].pins.has(existing.id)) actions.push({ type: 'pin-guide', key, messageId: existing.id })
      }
    }
  }
  const plan = { mode: apply ? 'apply' : 'dry-run', guildId: config.guildId, applicationId: config.applicationId, botId: bot.id, channelIds: plannedIds, blockers, actions }
  if (!apply) return plan
  if (blockers.length) throw new DiscordSetupError(`적용 전에 서버 소유자가 권한을 확인해야 합니다.\n${blockers.join('\n')}\n이 도구는 관리자 권한을 추가하거나 기존 채널 권한을 덮어쓰지 않습니다.`)

  for (const definition of definitions) {
    const key = definition.key
    if (!selected[key]) {
      selected[key] = await rest('POST', `/guilds/${config.guildId}/channels`, { name: definition.name, type: 0, topic: definition.topic,
        permission_overwrites: communityChannelOverwrites(key, { ...config, botId: bot.id }) })
      requireId(selected[key]?.id, '생성된 채널 ID')
    } else if ((selected[key].topic || '') !== definition.topic) {
      await rest('PATCH', `/channels/${selected[key].id}`, { topic: definition.topic })
    }
  }
  const channelIds = Object.fromEntries(definitions.map(({ key }) => [key, selected[key].id]))
  if (guild.system_channel_id !== channelIds.free || guild.system_channel_flags !== desiredFlags) await rest('PATCH', `/guilds/${config.guildId}`, { system_channel_id: channelIds.free, system_channel_flags: desiredFlags })
  const commandIds = {}
  for (const { command, existing, changed } of commandPlans) {
    const saved = changed ? await rest(existing ? 'PATCH' : 'POST', existing ? `${commandsRoute}/${existing.id}` : commandsRoute, command) : existing
    commandIds[command.name] = requireId(saved?.id, '등록된 명령 ID')
  }
  const actualGuides = buildGuides(channelIds)
  const messageIds = {}
  for (const definition of definitions) {
    const key = definition.key
    const expected = [actualGuides[key], ...(key === 'update' ? [initialUpdate] : [])]
    for (let index = 0; index < expected.length; index++) {
      const marker = markerOf(expected[index])
      const body = messageBody(expected[index], marker, channelIds[key])
      let message = managed[key].found.get(marker)
      if (!message) message = await rest('POST', `/channels/${channelIds[key]}/messages`, body)
      else if (!same(messageShape(message), messageShape(body))) {
        const { nonce, enforce_nonce, ...editBody } = body
        await rest('PATCH', `/channels/${channelIds[key]}/messages/${message.id}`, editBody)
      }
      const messageId = requireId(message?.id, '게시된 메시지 ID')
      if (index === 0 && !managed[key].pins.has(messageId)) await rest('PUT', `/channels/${channelIds[key]}/messages/pins/${messageId}`)
      messageIds[marker] = messageId
    }
  }
  const result = { ...plan, channelIds, commandIds, messageIds, configuredAt: now().toISOString(), environment: {
    DISCORD_GUILD_ID: config.guildId, DISCORD_APPLICATION_ID: config.applicationId,
    ...Object.fromEntries(Object.entries(CHANNEL_ENV).map(([key, name]) => [name, channelIds[key]])),
    ...(config.moderatorRoleId ? { DISCORD_MODERATOR_ROLE_ID: config.moderatorRoleId } : {}),
  } }
  if (persistResult) await persistResult(result)
  return result
}

export async function runDiscordSetupCli({ argv = process.argv.slice(2), env = process.env, stdout = console.log, stderr = console.error, setup = setupDiscordCommunity } = {}) {
  if (argv.includes('--help')) {
    stdout(`Discord 커뮤니티 설정\n기본: dry-run(조회만)\n적용: --apply\n설정: docs/discord-bot-setup.md\n최초 설치 권한 비트: ${SETUP_PERMISSION_VALUE}`)
    return 0
  }
  if (argv.some(argument => !['--apply', '--dry-run'].includes(argument)) || (argv.includes('--apply') && argv.includes('--dry-run'))) {
    stderr('지원 옵션: --dry-run(기본), --apply, --help')
    return 1
  }
  try {
    const result = await setup({ env, apply: argv.includes('--apply'), persistResult: async data => {
      await fs.mkdir(path.dirname(RESULT_PATH), { recursive: true })
      await fs.writeFile(RESULT_PATH, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
    } })
    stdout(JSON.stringify(result, null, 2))
    if (result.mode === 'apply') stdout('설정 ID 저장: scripts/.cache/discord-community/setup-result.json')
    return result.blockers.length ? 1 : 0
  } catch (error) {
    if (error instanceof DiscordSetupError) stderr(error.message)
    else stderr(`Discord 요청을 완료하지 못했습니다${Number.isInteger(error?.status) ? ` (HTTP ${error.status})` : ''}. 토큰을 출력하지 않고 앱·서버 ID와 봇 권한을 확인해 주세요.`)
    return 1
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) process.exitCode = await runDiscordSetupCli()
