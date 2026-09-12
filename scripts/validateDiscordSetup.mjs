import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { setupDiscordCommunity, runDiscordSetupCli, SETUP_PERMISSIONS, SETUP_PERMISSION_VALUE } from './setupDiscordCommunity.mjs'
import { DISCORD_COMMANDS } from '../server/discordCommunity.js'
import { COMMUNITY_CHANNELS, buildCommunityGuides, INITIAL_UPDATE } from '../server/discordCommunityContent.js'

const GUILD = '10000000000000001', APP = '10000000000000002', BOT = '10000000000000003', ROLE = '10000000000000004', OWNER = '10000000000000005'
const TOKEN = 'test-only-secret-never-print'
const ENV = { DISCORD_GUILD_ID: GUILD, DISCORD_APPLICATION_ID: APP, DISCORD_BOT_TOKEN: TOKEN }
const DISCUSS = SETUP_PERMISSIONS.VIEW_CHANNEL | SETUP_PERMISSIONS.READ_MESSAGE_HISTORY | SETUP_PERMISSIONS.SEND_MESSAGES | SETUP_PERMISSIONS.CREATE_PUBLIC_THREADS | SETUP_PERMISSIONS.SEND_MESSAGES_IN_THREADS
const clone = value => structuredClone(value)
const mutates = calls => calls.filter(call => call.method !== 'GET')

function fixture() {
  let next = 10000000000000100n
  const id = () => (next++).toString()
  const state = {
    bot: { id: BOT, bot: true }, application: { id: APP },
    guild: { id: GUILD, owner_id: OWNER, system_channel_id: null, system_channel_flags: 63,
      roles: [{ id: GUILD, permissions: DISCUSS.toString() }, { id: ROLE, permissions: SETUP_PERMISSION_VALUE, tags: { bot_id: BOT } }] },
    member: { roles: [ROLE] }, channels: [], commands: [{ id: id(), type: 1, name: '기존명령', description: '보존할 명령' }],
    messages: new Map(), pins: new Set(), calls: [], failPinOnce: false,
  }
  const commandsRoute = `/applications/${APP}/guilds/${GUILD}/commands`
  const rest = async (method, route, body) => {
    state.calls.push({ method, route, ...(body ? { body: clone(body) } : {}) })
    if (method === 'GET' && route === '/users/@me') return clone(state.bot)
    if (method === 'GET' && route === '/oauth2/applications/@me') return clone(state.application)
    if (method === 'GET' && route === `/guilds/${GUILD}`) return clone(state.guild)
    if (method === 'GET' && route === `/guilds/${GUILD}/members/${BOT}`) return clone(state.member)
    if (method === 'GET' && route === `/guilds/${GUILD}/channels`) return clone(state.channels)
    if (method === 'GET' && route === commandsRoute) return clone(state.commands)
    if (method === 'POST' && route === `/guilds/${GUILD}/channels`) {
      const channel = { id: id(), guild_id: GUILD, ...clone(body) }
      state.channels.push(channel); state.messages.set(channel.id, [])
      return clone(channel)
    }
    if (method === 'PATCH' && route === `/guilds/${GUILD}`) { Object.assign(state.guild, clone(body)); return clone(state.guild) }
    if (method === 'POST' && route === commandsRoute) { const command = { id: id(), ...clone(body) }; state.commands.push(command); return clone(command) }
    if (method === 'PATCH' && route.startsWith(`${commandsRoute}/`)) {
      const command = state.commands.find(item => item.id === route.split('/').at(-1))
      assert.ok(command); Object.assign(command, clone(body)); return clone(command)
    }
    const channelPath = route.match(/^\/channels\/(\d+)(.*)$/)
    if (channelPath) {
      const [, channelId, suffix] = channelPath
      const messages = state.messages.get(channelId) || []
      if (method === 'PATCH' && suffix === '') { const channel = state.channels.find(item => item.id === channelId); Object.assign(channel, clone(body)); return clone(channel) }
      if (method === 'GET' && suffix.startsWith('/messages/pins?')) return { items: clone(messages.filter(message => state.pins.has(message.id)).map(message => ({ message, pinned_at: '2026-09-12T00:00:00.000Z' }))), has_more: false }
      if (method === 'GET' && suffix.startsWith('/messages?')) {
        const before = new URLSearchParams(suffix.split('?')[1]).get('before')
        const start = before ? messages.findIndex(message => message.id === before) + 1 : 0
        return clone(messages.slice(start, start + 100))
      }
      if (method === 'POST' && suffix === '/messages') {
        const message = { id: id(), author: clone(state.bot), ...clone(body) }
        messages.unshift(message); state.messages.set(channelId, messages); return clone(message)
      }
      const pin = suffix.match(/^\/messages\/pins\/(\d+)$/)
      if (method === 'PUT' && pin) {
        if (state.failPinOnce) { state.failPinOnce = false; throw Object.assign(new Error('temporary failure'), { status: 503 }) }
        state.pins.add(pin[1]); messages.find(message => message.id === pin[1]).pinned = true; return null
      }
      const messagePath = suffix.match(/^\/messages\/(\d+)$/)
      if (method === 'PATCH' && messagePath) {
        const message = messages.find(item => item.id === messagePath[1]); assert.ok(message)
        Object.assign(message, clone(body)); return clone(message)
      }
    }
    throw new Error(`Unhandled mock route: ${method} ${route}`)
  }
  const run = options => setupDiscordCommunity({ env: ENV, rest, commands: DISCORD_COMMANDS, definitions: COMMUNITY_CHANNELS,
    buildGuides: buildCommunityGuides, initialUpdate: INITIAL_UPDATE, now: () => new Date('2026-09-12T00:00:00Z'), ...options })
  return { state, rest, run, id }
}

export async function validateDiscordSetup() {
  let checks = 0
  const check = async (name, fn) => { await fn(); checks++; console.log(`PASS ${name}`) }
  await check('dry-run reads only and never persists', async () => {
    const { state, run } = fixture(); let persisted = false
    const plan = await run({ persistResult: () => { persisted = true } })
    assert.equal(plan.mode, 'dry-run'); assert.equal(plan.blockers.length, 0)
    assert.equal(plan.actions.filter(action => action.type === 'publish-message').length, 5)
    assert.equal(mutates(state.calls).length, 0); assert.equal(persisted, false)
    assert.equal(JSON.stringify(plan).includes(TOKEN), false)
  })
  await check('apply creates four channels/five messages/four pins and preserves unrelated commands', async () => {
    const { state, run } = fixture(); let saved
    const result = await run({ apply: true, persistResult: value => { saved = clone(value) } })
    assert.equal(state.channels.length, 4); assert.equal([...state.messages.values()].flat().length, 5); assert.equal(state.pins.size, 4)
    assert.equal(state.commands.length, 5); assert.ok(state.commands.find(command => command.name === '기존명령'))
    assert.equal(state.guild.system_channel_id, result.channelIds.free); assert.equal(state.guild.system_channel_flags, 62)
    assert.equal(saved.configuredAt, '2026-09-12T00:00:00.000Z'); assert.equal(JSON.stringify(saved).includes(TOKEN), false)
    for (const message of [...state.messages.values()].flat()) {
      assert.deepEqual(message.allowed_mentions.parse, []); assert.equal(message.enforce_nonce, true); assert.equal(message.nonce.length, 24)
    }
    assert.equal(state.calls.some(call => call.method === 'DELETE' || call.method === 'PUT' && call.route.includes('/commands')), false)
    const everyone = state.channels.find(channel => channel.id === result.channelIds.update).permission_overwrites.find(overwrite => overwrite.id === GUILD)
    for (const name of ['SEND_MESSAGES', 'CREATE_PUBLIC_THREADS', 'CREATE_PRIVATE_THREADS', 'SEND_MESSAGES_IN_THREADS']) assert.ok(BigInt(everyone.deny) & SETUP_PERMISSIONS[name])
    assert.equal(BigInt(SETUP_PERMISSION_VALUE) & ((1n << 3n) | (1n << 28n) | (1n << 13n)), 0n)
  })
  await check('reapplying changes nothing, including Discord response embed/default metadata', async () => {
    const { state, run } = fixture(); await run({ apply: true })
    for (const message of [...state.messages.values()].flat()) for (const embed of message.embeds) { embed.type = 'rich'; embed.provider = { name: 'Discord' } }
    state.calls.length = 0; const result = await run({ apply: true })
    assert.equal(result.actions.length, 0); assert.equal(mutates(state.calls).length, 0)
  })
  await check('preexisting public channels work without explicit overwrites', async () => {
    const { state, run } = fixture(); await run({ apply: true })
    state.channels.filter(channel => channel.name !== '업데이트내역').forEach(channel => { channel.permission_overwrites = [] })
    state.calls.length = 0; const plan = await run()
    assert.deepEqual(plan.blockers, []); assert.equal(mutates(state.calls).length, 0)
  })
  await check('existing update channel can allow the managed bot role instead of a member overwrite', async () => {
    const { state, run } = fixture(); await run({ apply: true })
    const channel = state.channels.find(item => item.name === '업데이트내역')
    const overwrite = channel.permission_overwrites.find(item => item.id === BOT)
    overwrite.id = ROLE; overwrite.type = 0
    state.calls.length = 0; const plan = await run()
    assert.deepEqual(plan.blockers, []); assert.equal(mutates(state.calls).length, 0)
  })
  await check('exact channel ID wins over duplicate names; ambiguity otherwise stops before writes', async () => {
    const { state, run, id } = fixture(); const result = await run({ apply: true })
    state.channels.push({ id: id(), type: 0, name: '자유게시판', permission_overwrites: [] })
    state.calls.length = 0; await assert.rejects(run({ apply: true }), /이름이 중복/); assert.equal(mutates(state.calls).length, 0)
    const plan = await run({ env: { ...ENV, DISCORD_FREE_CHANNEL_ID: result.channelIds.free } })
    assert.deepEqual(plan.blockers, []); assert.equal(plan.channelIds.free, result.channelIds.free)
  })
  await check('wrong server channel IDs and non-text channels are rejected before writes', async () => {
    const { state, run, id } = fixture()
    await assert.rejects(run({ apply: true, env: { ...ENV, DISCORD_FREE_CHANNEL_ID: id() } }), /채널이 지정한 서버에/)
    state.channels.push({ id: id(), type: 2, name: '자유게시판' })
    await assert.rejects(run({ apply: true }), /일반 텍스트 채널/); assert.equal(mutates(state.calls).length, 0)
  })
  await check('user tokens and mismatched applications never reach writes', async () => {
    const { state, run } = fixture(); state.bot.bot = false
    await assert.rejects(run({ apply: true }), /봇 계정만/)
    state.bot.bot = true; state.application.id = OWNER
    await assert.rejects(run({ apply: true }), /서로 다른 앱/); assert.equal(mutates(state.calls).length, 0)
  })
  await check('unsafe update permissions block before any mutation', async () => {
    const { state, run } = fixture(); await run({ apply: true })
    state.channels.find(channel => channel.name === '업데이트내역').permission_overwrites = []
    state.calls.length = 0; const plan = await run(); assert.ok(plan.blockers.some(message => message.includes('채널에서 거부')))
    await assert.rejects(run({ apply: true }), /적용 전에/); assert.equal(mutates(state.calls).length, 0)
  })
  await check('other member update write overrides block publication', async () => {
    const { state, run, id } = fixture(); await run({ apply: true })
    state.channels.find(channel => channel.name === '업데이트내역').permission_overwrites.push({ id: id(), type: 1, allow: SETUP_PERMISSIONS.SEND_MESSAGES.toString(), deny: '0' })
    state.calls.length = 0; await assert.rejects(run({ apply: true }), /쓰기 허용이 공지 전용/); assert.equal(mutates(state.calls).length, 0)
  })
  await check('pin permission is required separately from Manage Messages', async () => {
    const { state, run } = fixture()
    state.guild.roles.find(role => role.id === ROLE).permissions = ((BigInt(SETUP_PERMISSION_VALUE) & ~SETUP_PERMISSIONS.PIN_MESSAGES) | (1n << 13n)).toString()
    const plan = await run(); assert.ok(plan.blockers.some(message => message.includes('PIN_MESSAGES')))
    await assert.rejects(run({ apply: true }), /PIN_MESSAGES/); assert.equal(mutates(state.calls).length, 0)
  })
  await check('user-authored marker messages are preserved and never reused', async () => {
    const { state, run, id } = fixture(); const initial = await run({ apply: true })
    const own = state.messages.get(initial.channelIds.free)[0]; state.pins.delete(own.id)
    own.author = { id: OWNER, bot: false }; own.pinned = false
    state.calls.length = 0; await run({ apply: true })
    assert.equal(state.messages.get(initial.channelIds.free).length, 2); assert.equal(own.author.id, OWNER)
    assert.equal(mutates(state.calls).filter(call => call.method === 'POST' && call.route.endsWith('/messages')).length, 1)
    assert.equal(state.calls.some(call => call.route.endsWith(`/messages/${own.id}`)), false)
    const duplicate = { ...clone(state.messages.get(initial.channelIds.free)[0]), id: id() }
    state.messages.get(initial.channelIds.free).push(duplicate); state.pins.add(duplicate.id)
    state.calls.length = 0; await assert.rejects(run({ apply: true }), /같은 안내 마커/); assert.equal(mutates(state.calls).length, 0)
  })
  await check('changed guides are edited in place and command updates preserve other commands', async () => {
    const { state, run } = fixture(); const initial = await run({ apply: true }); state.calls.length = 0
    const changedGuides = ids => { const guides = buildCommunityGuides(ids); guides.free.embeds[0].description += '\n추가 안내'; return guides }
    const commands = clone(DISCORD_COMMANDS); commands[0].description += ' 수정'
    await run({ apply: true, buildGuides: changedGuides, commands })
    assert.equal([...state.messages.values()].flat().length, 5); assert.ok(state.commands.find(command => command.name === '기존명령'))
    assert.equal(mutates(state.calls).length, 2)
    assert.ok(state.calls.find(call => call.method === 'PATCH' && call.route.endsWith(`/messages/${initial.messageIds['champions-community:free:v1']}`)))
  })
  await check('rerun after pin failure reuses published message and completes setup', async () => {
    const { state, run } = fixture(); state.failPinOnce = true
    await assert.rejects(run({ apply: true }), /temporary failure/)
    assert.equal([...state.messages.values()].flat().length, 1)
    await run({ apply: true }); assert.equal([...state.messages.values()].flat().length, 5); assert.equal(state.pins.size, 4)
  })
  await check('CLI defaults to read-only, --apply is explicit, and errors never print secrets', async () => {
    const output = [], errors = [], requests = []
    const setup = async options => { requests.push(options); return { mode: options.apply ? 'apply' : 'dry-run', blockers: [] } }
    assert.equal(await runDiscordSetupCli({ argv: [], env: ENV, setup, stdout: value => output.push(value), stderr: value => errors.push(value) }), 0)
    assert.equal(requests[0].apply, false)
    assert.equal(await runDiscordSetupCli({ argv: ['--apply'], env: ENV, setup, stdout: value => output.push(value), stderr: value => errors.push(value) }), 0)
    assert.equal(requests[1].apply, true)
    assert.equal(await runDiscordSetupCli({ argv: ['--apply', '--dry-run'], setup, stdout: value => output.push(value), stderr: value => errors.push(value) }), 1)
    assert.equal(requests.length, 2)
    await runDiscordSetupCli({ argv: [], env: ENV, setup: () => { throw Object.assign(new Error(TOKEN), { status: 403 }) }, stdout: value => output.push(value), stderr: value => errors.push(value) })
    assert.equal(JSON.stringify({ output, errors }).includes(TOKEN), false); assert.ok(errors.some(value => value.includes('HTTP 403')))
  })
  return { ok: true, checks }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { console.log(JSON.stringify(await validateDiscordSetup())) }
  catch (error) { console.error(error); process.exitCode = 1 }
}
