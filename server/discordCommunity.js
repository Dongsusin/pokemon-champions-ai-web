// Server-only HTTP interactions; no Gateway connection or privileged intents.
// Official API references:
// https://docs.discord.com/developers/interactions/receiving-and-responding
// https://docs.discord.com/developers/resources/message
// https://docs.discord.com/developers/resources/channel#start-thread-from-message
// https://docs.discord.com/developers/topics/permissions
const API = 'https://discord.com/api/v10'
const GAME_URL = 'https://pokemon-champions-area-web.co.kr'
const EPHEMERAL = 64
const MODERATOR_PERMISSIONS = 8n | 32n // Administrator or Manage Guild.
const snowflake = (value) => typeof value === 'string' && /^[0-9]{16,22}$/.test(value)
const noMentions = () => ({ parse: [], users: [], roles: [], replied_user: false })
const permissions = (value) => {
  try { return BigInt(value ?? 0) } catch { return 0n }
}

export const DISCORD_COMMANDS = [
  { name: '안내', description: '게임 링크와 커뮤니티 채널 이용 방법을 확인합니다.' },
  { name: '오류', description: '게임 오류를 제보하고 스크린샷을 올릴 스레드를 만듭니다.' },
  { name: '개선', description: '게임 개선 의견을 남기고 함께 이야기할 스레드를 만듭니다.' },
  { name: '업데이트', description: '운영진이 업데이트 소식을 게시합니다.', default_member_permissions: '32' },
].map((command) => ({ type: 1, contexts: [0], integration_types: [0], ...command }))

const kinds = {
  bug: { name: '오류 제보', channel: 'bugChannelId', color: 0xe46b62, final: '해결' },
  idea: { name: '개선 제안', channel: 'ideaChannelId', color: 0x65b8db, final: '반영' },
  update: { name: '업데이트', channel: 'updateChannelId', color: 0x7ab978 },
}
const labels = (kind) => ({ received: '접수', reviewing: kind === 'bug' ? '확인중' : '검토중', resolved: kinds[kind].final, hold: '보류' })
const statusId = (kind, id) => `community:status:${kind}:${id}`
const submissionId = (kind, userId) => `community:submit:${kind}:${userId}`
const messageLink = (guildId, channelId, messageId) => `https://discord.com/channels/${guildId}/${channelId}/${messageId}`
const privateReply = (content) => ({ response: { type: 4, data: { flags: EPHEMERAL, content, allowed_mentions: noMentions() } } })

export function createDiscordRest({ token, fetchImpl = fetch }) {
  if (typeof token !== 'string' || !token.trim()) throw new Error('Discord bot token is missing')
  return async (method, route, body) => {
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
      || typeof route !== 'string' || !/^\/[A-Za-z0-9_@./-]+(?:[?][^#\s]*)?$/.test(route)
      || route.includes('..') || route.includes('//')) throw new Error('Invalid Discord API request')
    let response
    try {
      response = await fetchImpl(`${API}${route}`, {
        method, redirect: 'error', signal: AbortSignal.timeout(10_000),
        headers: { 'Content-Type': 'application/json', ...(route.startsWith('/webhooks/') ? {} : { Authorization: `Bot ${token}` }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    } catch {
      // Never expose the interaction token, Authorization header, or fetch URL.
      throw new Error('Discord API response could not be confirmed')
    }
    let data = null
    try { data = await response.json() } catch { /* 204 responses have no body. */ }
    if (!response.ok) {
      const error = new Error(`Discord API request failed (${response.status})`)
      error.status = response.status
      error.code = data?.code
      throw error
    }
    return data
  }
}

function signedModerator(interaction, config) {
  return Boolean(permissions(interaction.member?.permissions) & MODERATOR_PERMISSIONS)
    || Boolean(config.moderatorRoleId && interaction.member?.roles?.includes(config.moderatorRoleId))
}

async function requireCurrentModerator(interaction, config, rest) {
  const userId = interaction.member.user.id
  const [member, roles, guild] = await Promise.all([
    rest('GET', `/guilds/${config.guildId}/members/${userId}`),
    rest('GET', `/guilds/${config.guildId}/roles`),
    rest('GET', `/guilds/${config.guildId}`),
  ])
  if (member?.user?.id !== userId || !Array.isArray(member.roles) || !Array.isArray(roles) || guild?.id !== config.guildId) {
    throw new Error('Moderator membership could not be verified')
  }
  const currentRoles = new Set([config.guildId, ...member.roles])
  const allowed = guild.owner_id === userId || roles.some((role) => currentRoles.has(role.id)
    && (Boolean(permissions(role.permissions) & MODERATOR_PERMISSIONS) || role.id === config.moderatorRoleId))
  if (!allowed) throw new Error('Moderator permission is no longer available')
}

async function requireTextChannel(config, channelId, rest) {
  const channel = await rest('GET', `/channels/${channelId}`)
  if (channel?.id !== channelId || channel.guild_id !== config.guildId || channel.type !== 0) {
    throw new Error('Configured community channel is not a text channel in this server')
  }
}

function modal(kind, userId) {
  const input = (id, label, style, maxLength, required = true, description) => ({
    type: 18, label, ...(description ? { description } : {}),
    component: { type: 4, custom_id: id, style, required, max_length: maxLength, ...(required ? { min_length: 1 } : {}) },
  })
  return { response: { type: 9, data: {
    custom_id: submissionId(kind, userId), title: kinds[kind].name,
    components: [
      input('title', '제목', 1, 80),
      input('details', kind === 'bug' ? '재현 순서와 실제로 일어난 일' : kind === 'idea' ? '제안 내용과 기대하는 변화' : '업데이트 내용', 2, 3000),
      ...(kind === 'update' ? [] : [input('environment', '환경 또는 참고 사항 (선택)', 2, 500, false,
        '기기·브라우저·배틀 상황 등을 적어 주세요. 스크린샷은 접수 후 스레드에 올릴 수 있습니다.')]),
    ],
  } } }
}

function readSubmission(data, kind) {
  const values = new Map()
  const visit = (component) => {
    if (component.type === 4) {
      if (!['title', 'details', ...(kind === 'update' ? [] : ['environment'])].includes(component.custom_id)
        || values.has(component.custom_id) || typeof component.value !== 'string') throw new Error('Invalid field')
      values.set(component.custom_id, component.value)
    } else if (component.type === 18 && component.component) visit(component.component)
    else if (component.type === 1 && Array.isArray(component.components)) component.components.forEach(visit)
    else throw new Error('Invalid modal component')
  }
  if (!Array.isArray(data.components) || data.components.length > 5) throw new Error('Invalid modal')
  data.components.forEach(visit)
  const result = {}
  for (const [id, maxLength] of [['title', 80], ['details', 3000], ['environment', 500]]) {
    const raw = values.get(id) ?? ''
    if (raw.length > maxLength) throw new Error('Field too long')
    result[id] = raw.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim()
    if (id !== 'environment' && !result[id]) throw new Error('Required field is missing')
  }
  return result
}

function statusComponents(kind, id, current = 'received') {
  return [{ type: 1, components: [{ type: 3, custom_id: statusId(kind, id),
    placeholder: '운영진: 처리 상태 변경', min_values: 1, max_values: 1,
    options: Object.entries(labels(kind)).map(([value, label]) => ({ value, label, default: value === current })),
  }] }]
}

function postBody(interaction, kind, fields) {
  const reporter = interaction.member.user.id
  return {
    allowed_mentions: noMentions(), nonce: interaction.id, enforce_nonce: true,
    embeds: [{ title: fields.title, description: fields.details, color: kinds[kind].color,
      fields: [
        { name: kind === 'update' ? '작성자' : '제보자', value: `<@${reporter}>`, inline: true },
        ...(kind === 'update' ? [] : [{ name: '상태', value: '접수', inline: true }]),
        ...(fields.environment ? [{ name: '환경 · 참고', value: fields.environment }] : []),
      ], footer: { text: `${kinds[kind].name} · ${interaction.id}` },
    }],
    ...(kind === 'update' ? {} : { components: statusComponents(kind, interaction.id) }),
  }
}

function deferred(interaction, config, rest, work) {
  // Run only after the HTTP wrapper has returned this ACK. Surface reply delivery
  // failures to the wrapper rather than claiming the user was notified.
  return { response: { type: 5, data: { flags: EPHEMERAL } }, run: async () => {
    const content = await work()
    await rest('PATCH', `/webhooks/${config.applicationId}/${interaction.token}/messages/@original`, {
      content, allowed_mentions: noMentions(),
    })
  } }
}

async function publishSubmission(interaction, config, rest, kind, fields) {
  const channelId = config[kinds[kind].channel]
  let message
  try {
    if (kind === 'update') await requireCurrentModerator(interaction, config, rest)
    await requireTextChannel(config, channelId, rest)
  } catch {
    return kind === 'update'
      ? '현재 운영진 권한 또는 게시 채널을 확인하지 못했습니다. 업데이트는 게시하지 않았습니다. 운영진에게 설정 확인을 요청해 주세요.'
      : '접수 채널을 확인하지 못해 게시하지 않았습니다. 운영진에게 채널 설정 확인을 요청해 주세요.'
  }
  try {
    message = await rest('POST', `/channels/${channelId}/messages`, postBody(interaction, kind, fields))
    if (!snowflake(message?.id)) throw new Error('Missing created message')
  } catch {
    return `게시 완료 여부를 확인하지 못했습니다. 중복 게시를 피하려면 <#${channelId}>을 먼저 확인한 뒤 다시 시도해 주세요.`
  }
  const link = messageLink(config.guildId, channelId, message.id)
  if (kind === 'update') return `업데이트를 게시했습니다. ${link}`
  let thread
  try {
    // A message has exactly one thread. Replayed message creation uses the same
    // nonce; an existing thread can be recovered without creating a second post.
    thread = message.thread ?? await rest('POST', `/channels/${channelId}/messages/${message.id}/threads`, {
      name: `[${kinds[kind].name}] ${fields.title}`.slice(0, 100), auto_archive_duration: 1440,
    })
    if (!snowflake(thread?.id)) throw new Error('Missing created thread')
  } catch {
    try {
      const existing = await rest('GET', `/channels/${channelId}/messages/${message.id}`)
      if (snowflake(existing?.thread?.id)) thread = existing.thread
    } catch { /* The public post still exists even when thread recovery fails. */ }
    if (!thread?.id) return `내용은 접수됐지만 스레드 생성은 확인하지 못했습니다. ${link}\n다시 제출하지 말고, 이 게시물을 운영진에게 알려 스레드 생성을 요청해 주세요.`
  }
  return `${kinds[kind].name}을 접수했습니다. 스크린샷과 추가 설명은 아래 공개 스레드에 올려 주세요.\n${messageLink(config.guildId, thread.id, thread.id)}`
}

async function updateStatus(interaction, config, rest, kind, requestId, status) {
  const channelId = config[kinds[kind].channel]
  let message
  try {
    await requireCurrentModerator(interaction, config, rest)
    await requireTextChannel(config, channelId, rest)
    message = await rest('GET', `/channels/${channelId}/messages/${interaction.message.id}`)
    if (message?.id !== interaction.message.id || message.author?.id !== config.applicationId || !message.author?.bot
      || message.embeds?.length !== 1 || !Array.isArray(message.embeds[0].fields)
      || !message.embeds[0].fields.some((field) => field.name === '상태')
      || message.embeds[0].footer?.text !== `${kinds[kind].name} · ${requestId}`
      || !message.components?.some((row) => row.components?.some((component) => component.custom_id === statusId(kind, requestId)))) {
      throw new Error('This is not an original community report')
    }
  } catch {
    return '현재 운영진 권한 또는 원본 접수 게시물을 확인하지 못해 상태를 변경하지 않았습니다.'
  }
  const existing = message.embeds[0]
  const embed = { title: existing.title, description: existing.description, color: existing.color,
    fields: existing.fields.map((field) => field.name === '상태' ? { name: '상태', value: labels(kind)[status], inline: true } : field),
    footer: { text: existing.footer.text },
  }
  try {
    await rest('PATCH', `/channels/${channelId}/messages/${message.id}`, {
      embeds: [embed], components: statusComponents(kind, requestId, status), allowed_mentions: noMentions(),
    })
  } catch {
    return `상태 변경 완료 여부를 확인하지 못했습니다. 원본 게시물의 상태를 확인해 주세요. ${messageLink(config.guildId, channelId, message.id)}`
  }
  return `상태를 '${labels(kind)[status]}'로 변경했습니다. ${messageLink(config.guildId, channelId, message.id)}`
}

export function prepareDiscordInteraction(interaction, { config, rest }) {
  if (!interaction || !config || interaction.application_id !== config.applicationId || !snowflake(config.applicationId)) {
    return privateReply('이 애플리케이션에서 처리할 수 없는 요청입니다.')
  }
  if (interaction.type === 1) return { response: { type: 1 } }
  if (interaction.guild_id !== config.guildId || !snowflake(config.guildId)
    || !snowflake(interaction.member?.user?.id) || !snowflake(interaction.id)) {
    return privateReply('이 명령은 지정된 게임 커뮤니티 서버에서만 사용할 수 있습니다.')
  }
  if (interaction.member.user.bot) return privateReply('봇 계정은 이 명령을 사용할 수 없습니다.')
  const userId = interaction.member.user.id
  const data = interaction.data ?? {}
  if (interaction.type === 2) {
    if (data.name === '안내') {
      const channel = (id) => snowflake(id) ? `<#${id}>` : '채널 설정 확인 필요'
      return privateReply(`**Pokémon Champions Arena**\n게임: ${GAME_URL}\n\n자유 대화: ${channel(config.freeChannelId)}\n오류 제보: ${channel(config.bugChannelId)} — /오류\n개선 제안: ${channel(config.ideaChannelId)} — /개선\n업데이트: ${channel(config.updateChannelId)}\n\n오류와 개선 의견은 모달로 접수하며, 후속 스크린샷과 설명은 생성된 공개 스레드에 남겨 주세요. 개인정보와 비밀번호는 작성하지 마세요.`)
    }
    const kind = { 오류: 'bug', 개선: 'idea', 업데이트: 'update' }[data.name]
    if (!kind) return privateReply('지원하지 않는 명령입니다. /안내에서 사용 가능한 명령을 확인해 주세요.')
    if (!snowflake(config[kinds[kind].channel])) return privateReply('접수 채널이 아직 설정되지 않았습니다. 운영진에게 알려 주세요.')
    if (kind === 'update' && !signedModerator(interaction, config)) return privateReply('업데이트는 운영진만 게시할 수 있습니다.')
    return modal(kind, userId)
  }
  if (typeof rest !== 'function' || typeof interaction.token !== 'string' || !/^[A-Za-z0-9._-]{1,512}$/.test(interaction.token)) {
    return privateReply('요청을 처리할 연결 정보가 없습니다. 명령을 다시 실행해 주세요.')
  }
  if (interaction.type === 5) {
    const match = /^community:submit:(bug|idea|update):([0-9]{16,22})$/.exec(data.custom_id ?? '')
    if (!match || match[2] !== userId) return privateReply('유효하지 않은 입력 창입니다. 명령을 다시 실행해 주세요.')
    const kind = match[1]
    if (!snowflake(config[kinds[kind].channel])) return privateReply('접수 채널이 아직 설정되지 않았습니다.')
    if (kind === 'update' && !signedModerator(interaction, config)) return privateReply('업데이트는 운영진만 게시할 수 있습니다.')
    let fields
    try { fields = readSubmission(data, kind) } catch { return privateReply('입력 내용을 확인해 주세요. 제목 80자, 내용 3,000자, 참고 사항 500자까지 입력할 수 있습니다.') }
    return deferred(interaction, config, rest, () => publishSubmission(interaction, config, rest, kind, fields))
  }
  if (interaction.type === 3) {
    const match = /^community:status:(bug|idea):([0-9]{16,22})$/.exec(data.custom_id ?? '')
    if (!match || data.component_type !== 3 || data.values?.length !== 1
      || !Object.hasOwn(labels(match[1]), data.values[0]) || !snowflake(interaction.message?.id)
      || interaction.channel_id !== config[kinds[match[1]].channel]) return privateReply('유효하지 않은 상태 변경 요청입니다.')
    if (!signedModerator(interaction, config)) return privateReply('접수 상태는 운영진만 변경할 수 있습니다.')
    return deferred(interaction, config, rest, () => updateStatus(interaction, config, rest, match[1], match[2], data.values[0]))
  }
  return privateReply('지원하지 않는 요청입니다. /안내를 사용해 주세요.')
}
