import assert from 'node:assert/strict'
import test from 'node:test'
import { DISCORD_COMMANDS, createDiscordRest, prepareDiscordInteraction } from '../server/discordCommunity.js'

// All REST traffic is stubbed. This script never contacts Discord.
const app = '100000000000000001'
const guild = '100000000000000002'
const user = '100000000000000003'
const config = { applicationId: app, guildId: guild, botToken: 'not-a-real-token',
  freeChannelId: '100000000000000004', bugChannelId: '100000000000000005',
  ideaChannelId: '100000000000000006', updateChannelId: '100000000000000007',
  moderatorRoleId: '100000000000000008' }
const requestId = '100000000000000009'
const messageId = '100000000000000010'
const base = (type, data, overrides = {}) => ({ id: requestId, application_id: app, guild_id: guild,
  type, token: 'test-interaction-token', channel_id: config.freeChannelId,
  member: { user: { id: user, username: 'Test user' }, roles: [], permissions: '0' }, data, ...overrides })
const moderator = () => ({ user: { id: user }, roles: [config.moderatorRoleId], permissions: '32' })
const command = (name, overrides) => base(2, { name }, overrides)
const modal = (kind = 'bug', overrides = {}) => base(5, {
  custom_id: `community:submit:${kind}:${user}`,
  components: [
    { type: 18, component: { type: 4, custom_id: 'title', value: '배틀 오류' } },
    { type: 18, component: { type: 4, custom_id: 'details', value: '공격 버튼을 눌렀을 때 예상과 다른 결과가 발생했습니다.' } },
    ...(kind === 'update' ? [] : [{ type: 18, component: { type: 4, custom_id: 'environment', value: '모바일 Chrome' } }]),
  ],
}, overrides)
const status = (kind = 'bug', value = 'reviewing', overrides = {}) => base(3, {
  custom_id: `community:status:${kind}:${requestId}`, component_type: 3, values: [value],
}, { member: moderator(), channel_id: config[kind === 'bug' ? 'bugChannelId' : 'ideaChannelId'],
  message: { id: messageId }, ...overrides })

function harness({ fail, member = moderator(), roles, owner = '100000000000000099', wrongGuild = false, editMessage } = {}) {
  const calls = []
  let stored
  const rest = async (method, route, body) => {
    calls.push({ method, route, body: body && structuredClone(body) })
    if (fail?.(method, route, body)) throw Object.assign(new Error('Stub API failure'), { status: 403 })
    if (route.includes('/webhooks/')) return { id: 'reply' }
    if (method === 'GET' && route === `/guilds/${guild}/members/${user}`) return structuredClone(member)
    if (method === 'GET' && route === `/guilds/${guild}/roles`) return roles ?? [{ id: config.moderatorRoleId, permissions: '0' }]
    if (method === 'GET' && route === `/guilds/${guild}`) return { id: guild, owner_id: owner }
    const channel = /^\/channels\/(\d+)$/.exec(route)
    if (method === 'GET' && channel) return { id: channel[1], guild_id: wrongGuild ? '100000000000000099' : guild, type: 0 }
    if (method === 'POST' && route.endsWith('/messages')) {
      stored = { ...structuredClone(body), id: messageId, author: { id: app, bot: true } }
      return stored
    }
    if (route.endsWith('/threads')) return { id: messageId, type: 11 }
    if (method === 'GET' && route.endsWith(`/messages/${messageId}`)) {
      const message = stored ?? { id: messageId, author: { id: app, bot: true },
        embeds: [{ title: '원본 제목', description: '원본 내용', color: 1,
          fields: [{ name: '제보자', value: `<@${user}>` }, { name: '상태', value: '접수' }],
          footer: { text: `오류 제보 · ${requestId}` } }],
        components: [{ type: 1, components: [{ type: 3, custom_id: `community:status:bug:${requestId}` }] }],
      }
      return editMessage ? editMessage(structuredClone(message)) : message
    }
    if (method === 'PATCH' && route.endsWith(`/messages/${messageId}`)) return { id: messageId, ...body }
    throw new Error(`Unexpected stub request: ${method} ${route}`)
  }
  return { rest, calls, prepare: (interaction, options = {}) => prepareDiscordInteraction(interaction, { config, rest, ...options }),
    reply: () => calls.findLast(call => call.route.includes('/webhooks/'))?.body.content,
    publicWrites: () => calls.filter(call => ['POST', 'PATCH'].includes(call.method) && call.route.startsWith('/channels/')) }
}

test('Four guild commands include restricted moderator update permissions', () => {
  assert.deepEqual(DISCORD_COMMANDS.map(command => command.name), ['안내', '오류', '개선', '업데이트'])
  assert(DISCORD_COMMANDS.every(command => command.type === 1 && command.contexts.join() === '0'))
  assert.equal(DISCORD_COMMANDS.at(-1).default_member_permissions, '32')
})

test('Guide is immediate, private, contains four channels and the actual game URL', () => {
  const h = harness()
  const prepared = h.prepare(command('안내'))
  assert.equal(prepared.response.type, 4)
  assert.equal(prepared.response.data.flags, 64)
  assert.match(prepared.response.data.content, /https:\/\/pokemon-champions-area-web.co.kr/)
  for (const key of ['freeChannelId', 'bugChannelId', 'ideaChannelId', 'updateChannelId']) assert(prepared.response.data.content.includes(config[key]))
  assert.equal(prepared.run, undefined)
  assert.equal(h.calls.length, 0)
})

for (const [name, kind] of [['오류', 'bug'], ['개선', 'idea']]) test(`${name} opens a user-bound modal without REST`, () => {
  const h = harness()
  const prepared = h.prepare(command(name))
  assert.equal(prepared.response.type, 9)
  assert.equal(prepared.response.data.custom_id, `community:submit:${kind}:${user}`)
  assert.deepEqual(prepared.response.data.components.map(row => row.component.max_length), [80, 3000, 500])
  assert.equal(h.calls.length, 0)
})

for (const [name, changed] of [
  ['another application', { application_id: '100000000000000099' }],
  ['another guild', { guild_id: '100000000000000099' }],
  ['DM', { guild_id: undefined }],
  ['missing member', { member: undefined }],
  ['bot member', { member: { user: { id: user, bot: true } } }],
]) test(`${name} is denied without network calls`, () => {
  const h = harness()
  const p = h.prepare(modal('bug', changed))
  assert.equal(p.response.type, 4)
  assert.equal(p.run, undefined)
  assert.equal(h.calls.length, 0)
})

test('Ping is acknowledged and unknown commands are rejected', () => {
  const h = harness()
  assert.deepEqual(h.prepare(base(1)), { response: { type: 1 } })
  assert.match(h.prepare(command('delete')).response.data.content, /지원하지/)
})

for (const kind of ['bug', 'idea']) test(`${kind} submission defers before publishing one post and public thread`, async () => {
  const h = harness()
  const p = h.prepare(modal(kind))
  assert.deepEqual(p.response, { type: 5, data: { flags: 64 } })
  assert.equal(h.calls.length, 0)
  await p.run()
  const writes = h.publicWrites()
  assert.equal(writes.length, 2)
  const target = config[kind === 'bug' ? 'bugChannelId' : 'ideaChannelId']
  assert.equal(writes[0].route, `/channels/${target}/messages`)
  assert.equal(writes[0].body.nonce, requestId)
  assert.equal(writes[0].body.enforce_nonce, true)
  assert.equal(writes[1].route, `/channels/${target}/messages/${messageId}/threads`)
  assert.equal(writes[1].body.auto_archive_duration, 1440)
  assert.equal(writes[1].body.type, undefined) // Message endpoint determines PUBLIC_THREAD from GUILD_TEXT.
  assert.match(h.reply(), /공개 스레드/)
  assert(h.reply().includes(`${guild}/${messageId}/${messageId}`))
  assert.equal(h.calls.at(-1).route, `/webhooks/${app}/test-interaction-token/messages/@original`)
})

test('Mention attempts never enable notifications in post or original reply', async () => {
  const h = harness()
  const input = modal()
  input.data.components[1].component.value = `@everyone @here <@${user}> <@&${config.moderatorRoleId}>`
  await h.prepare(input).run()
  for (const call of h.calls.filter(call => call.body && !call.route.endsWith('/threads'))) {
    assert.deepEqual(call.body.allowed_mentions, { parse: [], users: [], roles: [], replied_user: false })
  }
})

test('Legacy action-row modal values remain compatible', async () => {
  const h = harness()
  const input = modal()
  input.data.components = input.data.components.map(row => ({ type: 1, components: [row.component] }))
  await h.prepare(input).run()
  assert.match(h.reply(), /접수했습니다/)
})

for (const invalid of ['too long', 'blank title', 'duplicate field', 'foreign user', 'unknown modal']) test(`Invalid submission: ${invalid}`, () => {
  const h = harness()
  const input = modal()
  if (invalid === 'too long') input.data.components[1].component.value = 'x'.repeat(3001)
  if (invalid === 'blank title') input.data.components[0].component.value = ' \u0000 '
  if (invalid === 'duplicate field') input.data.components.push(input.data.components[0])
  if (invalid === 'foreign user') input.data.custom_id = 'community:submit:bug:100000000000000099'
  if (invalid === 'unknown modal') input.data.custom_id = 'delete:everything'
  const p = h.prepare(input)
  assert.equal(p.run, undefined)
  assert.equal(p.response.type, 4)
  assert.equal(h.calls.length, 0)
})

test('Misconfigured cross-guild channel never receives a public write', async () => {
  const h = harness({ wrongGuild: true })
  await h.prepare(modal()).run()
  assert.equal(h.publicWrites().length, 0)
  assert.match(h.reply(), /게시하지 않았습니다/)
})

test('Public post failure gives an uncertain-result warning instead of a success or automatic retry', async () => {
  const h = harness({ fail: (method, route) => method === 'POST' && route.endsWith('/messages') })
  await h.prepare(modal()).run()
  assert.equal(h.publicWrites().length, 1)
  assert.match(h.reply(), /완료 여부를 확인하지 못했습니다/)
  assert.match(h.reply(), /먼저 확인/)
})

test('Successful post plus failed thread reports partial completion and discourages resubmission', async () => {
  const h = harness({ fail: (method, route) => method === 'POST' && route.endsWith('/threads') })
  await h.prepare(modal()).run()
  assert.match(h.reply(), /내용은 접수됐지만 스레드 생성은 확인하지 못했습니다/)
  assert.match(h.reply(), /다시 제출하지 말고/)
  assert(h.reply().includes(`${guild}/${config.bugChannelId}/${messageId}`))
})

test('Already-existing thread is recovered after a duplicate thread creation error', async () => {
  const h = harness({ fail: (method, route) => method === 'POST' && route.endsWith('/threads'),
    editMessage: message => ({ ...message, thread: { id: messageId } }) })
  await h.prepare(modal()).run()
  assert.match(h.reply(), /공개 스레드/)
})

test('Update command and direct modal submit deny ordinary members', () => {
  const h = harness()
  assert.equal(h.prepare(command('업데이트')).response.type, 4)
  assert.equal(h.prepare(modal('update')).run, undefined)
  assert.equal(h.calls.length, 0)
})

test('Update submission rechecks current membership and posts without a thread', async () => {
  const h = harness()
  const p = h.prepare(modal('update', { member: moderator() }))
  await p.run()
  assert.equal(h.publicWrites().length, 1)
  assert.equal(h.publicWrites()[0].route, `/channels/${config.updateChannelId}/messages`)
  assert(h.calls.some(call => call.route.endsWith(`/members/${user}`)))
  assert.match(h.reply(), /업데이트를 게시했습니다/)
})

test('A revoked moderator role cannot publish even with stale signed permissions', async () => {
  const h = harness({ member: { user: { id: user }, roles: [] }, roles: [{ id: guild, permissions: '0' }] })
  await h.prepare(modal('update', { member: moderator() })).run()
  assert.equal(h.publicWrites().length, 0)
  assert.match(h.reply(), /현재 운영진 권한/)
})

test('Guild owner is accepted on fresh verification even without an admin role', async () => {
  const h = harness({ owner: user, member: { user: { id: user }, roles: [] }, roles: [] })
  await h.prepare(modal('update', { member: moderator() })).run()
  assert.equal(h.publicWrites().length, 1)
})

test('Status changes require a moderator and preserve original report content', async () => {
  const h = harness()
  await h.prepare(status()).run()
  const patch = h.publicWrites()[0]
  assert.equal(patch.method, 'PATCH')
  assert.equal(patch.body.embeds[0].title, '원본 제목')
  assert.equal(patch.body.embeds[0].description, '원본 내용')
  assert.equal(patch.body.embeds[0].fields.find(field => field.name === '상태').value, '확인중')
  assert.equal(patch.body.components[0].components[0].options.find(option => option.default).value, 'reviewing')
  assert.deepEqual(patch.body.allowed_mentions.parse, [])
  assert.match(h.reply(), /변경했습니다/)
})

for (const invalid of ['member', 'foreign channel', 'unknown custom id', 'invalid status', 'button type']) test(`Invalid status action: ${invalid}`, () => {
  const h = harness()
  const input = status()
  if (invalid === 'member') input.member = base(2).member
  if (invalid === 'foreign channel') input.channel_id = config.freeChannelId
  if (invalid === 'unknown custom id') input.data.custom_id = 'community:delete:bug:100000000000000009'
  if (invalid === 'invalid status') input.data.values = ['delete']
  if (invalid === 'button type') input.data.component_type = 2
  assert.equal(h.prepare(input).run, undefined)
  assert.equal(h.calls.length, 0)
})

for (const field of ['author', 'footer', 'component', 'fields']) test(`Status re-fetch rejects a forged ${field}`, async () => {
  const h = harness({ editMessage: message => {
    if (field === 'author') message.author.id = user
    if (field === 'footer') message.embeds[0].footer.text = 'forged'
    if (field === 'component') message.components = []
    if (field === 'fields') delete message.embeds[0].fields
    return message
  } })
  await h.prepare(status()).run()
  assert.equal(h.publicWrites().length, 0)
  assert.match(h.reply(), /변경하지 않았습니다/)
})

test('Status cannot be changed after moderator role is revoked', async () => {
  const h = harness({ member: { user: { id: user }, roles: [] }, roles: [] })
  await h.prepare(status()).run()
  assert.equal(h.publicWrites().length, 0)
})

test('Status PATCH failure does not report success', async () => {
  const h = harness({ fail: (method, route) => method === 'PATCH' && route.startsWith('/channels/') })
  await h.prepare(status()).run()
  assert.match(h.reply(), /변경 완료 여부를 확인하지 못했습니다/)
})

test('Final private reply failure remains observable to the HTTP wrapper', async () => {
  const h = harness({ fail: (_method, route) => route.startsWith('/webhooks/') })
  await assert.rejects(h.prepare(modal()).run(), /Stub API failure/)
  assert.equal(h.publicWrites().length, 2)
})

test('REST uses v10 Bot authorization, supports setup routes, and leaves webhook tokens out of headers', async () => {
  const calls = []
  const rest = createDiscordRest({ token: 'secret-bot-token', fetchImpl: async (url, options) => {
    calls.push({ url, options }); return { ok: true, json: async () => ({ ok: true }) }
  } })
  for (const route of ['/users/@me', '/oauth2/applications/@me', `/guilds/${guild}/channels`]) await rest('GET', route)
  await rest('PUT', `/applications/${app}/guilds/${guild}/commands`, DISCORD_COMMANDS)
  await rest('PATCH', `/webhooks/${app}/interaction-token/messages/@original`, { content: 'done' })
  assert(calls.every(call => call.url.startsWith('https://discord.com/api/v10/')))
  assert.equal(calls[0].options.headers.Authorization, 'Bot secret-bot-token')
  assert.equal(calls[0].options.redirect, 'error')
  assert.equal(calls.at(-1).options.headers.Authorization, undefined)
  assert.equal(JSON.parse(calls[3].options.body).length, 4)
})

test('REST handles 204, HTTP failure metadata, and sanitizes network errors without retries', async () => {
  assert.equal(await createDiscordRest({ token: 'secret', fetchImpl: async () => ({ ok: true, json: async () => { throw new Error('empty') } }) })('DELETE', '/channels/100000000000000001'), null)
  const denied = createDiscordRest({ token: 'secret', fetchImpl: async () => ({ ok: false, status: 404, json: async () => ({ code: 10008 }) }) })
  await assert.rejects(denied('GET', '/channels/100000000000000001'), error => error.status === 404 && error.code === 10008)
  let count = 0
  const failed = createDiscordRest({ token: 'secret', fetchImpl: async () => { count++; throw new Error('secret URL interaction-token') } })
  await assert.rejects(failed('POST', '/channels/100000000000000001/messages', {}), error => !error.message.includes('secret') && !error.message.includes('interaction-token'))
  assert.equal(count, 1)
})

test('REST rejects non-Discord URLs and unsafe routes before accessing fetch', async () => {
  let calls = 0
  const rest = createDiscordRest({ token: 'secret', fetchImpl: async () => { calls++ } })
  for (const route of ['https://example.com', '//example.com', '/channels/../users', '/channels/1\n', '/channels/1#fragment']) {
    await assert.rejects(rest('GET', route), /Invalid Discord API/)
  }
  assert.equal(calls, 0)
})
