import assert from 'node:assert/strict'
import { createMemoryRankedStore } from '../server/rankedStore.js'
import { createAccountService } from '../server/accountService.js'
import { createAccountHttpHandler } from '../server/accountHttp.js'
import { createGuestIdentityRegistry } from '../server/guestIdentity.js'
import { normalizeTrainerNickname, readTrainerNickname, NICKNAME_MIN_LENGTH, NICKNAME_MAX_LENGTH } from '../src/data/trainerNickname.js'

const tests = []
const test = (name, run) => tests.push({ name, run })
const alice = { uid: 'nickname-alice', name: '김실제이름', isGuest: false,
  accountProfile: { displayName: '김실제이름', email: 'private-alice@example.test', providerIds: ['google.com'] } }
const bob = { ...alice, uid: 'nickname-bob', name: '이실제이름', accountProfile: { displayName: '이실제이름', providerIds: ['google.com'] } }
const guest = { uid: 'nickname-guest', name: 'forged-google-name', isGuest: true }
const ownerId = 'nickname-owner-1234567890'
const rejected = (promise, code) => assert.rejects(promise, error => error.code === code)
function environment() {
  const store = createMemoryRankedStore()
  const guestRegistry = createGuestIdentityRegistry({ store, chooseNumber: () => 123456 })
  let timestamp = 1000, version = 0
  const service = createAccountService({ store, guestRegistry, now: () => timestamp, newVersion: () => `nickname-version-${++version}` })
  const call = (identity, action, fields = {}) => service.execute(identity, { action, ownerId, ...fields })
  return { store, guestRegistry, service, call, advance: milliseconds => { timestamp += milliseconds } }
}

test('shared normalization handles limits, NFKC, Hangul and explicit clearing', () => {
  assert.equal(NICKNAME_MIN_LENGTH, 2)
  assert.equal(NICKNAME_MAX_LENGTH, 12)
  for (const [input, expected] of [
    ['  트레이너  ', '트레이너'], ['ＡＢ１２', 'AB12'], ['한글', '한글'], ['푸른 별_7', '푸른 별_7'],
    ['A-B', 'A-B'], ['', ''], ['   ', ''], ['가'.repeat(12), '가'.repeat(12)],
  ]) assert.equal(normalizeTrainerNickname(input), expected)
  for (const value of [null, undefined, {}, 123, '가', 'a'.repeat(13), '한😀글', '<관리자>', '두\n줄', '시\u200b발', 'a@example',
    '\u115f\u1160', '별\u3164명', '\uffa0별명', 'guest-000000', 'GUEST-123456', 'ｇｕｅｓｔ-１２３４５６']) {
    assert.throws(() => normalizeTrainerNickname(value))
    assert.equal(readTrainerNickname(value), '')
  }
})

test('Google nickname is saved only to its verified profile and survives service reconstruction', async () => {
  const env = environment()
  await env.call(alice, 'sessionAcquire')
  await env.call(bob, 'sessionAcquire')
  await env.call(bob, 'ensureProfile')
  const otherBefore = (await env.store.inspect()).collections.profiles[bob.uid]
  const result = await env.call(alice, 'setNickname', { nickname: ' Ａrena 7 ', uid: bob.uid, email: 'fake@example.test', name: '운영자', isGuest: true })
  assert.equal(result.profile.uid, alice.uid)
  assert.equal(result.profile.nickname, 'Arena 7')
  assert.equal(result.profile.displayName, alice.accountProfile.displayName)
  assert.equal(result.profile.email, alice.accountProfile.email)
  assert.deepEqual((await env.store.inspect()).collections.profiles[bob.uid], otherBefore)
  const restarted = createAccountService({ store: env.store, guestRegistry: env.guestRegistry, now: () => 1001 })
  assert.equal((await restarted.execute(alice, { action: 'ensureProfile', ownerId })).profile.nickname, 'Arena 7')
  assert.equal(alice.name, '김실제이름', 'Firebase identity must never be mutated')
})

test('ensureProfile preserves canonical nickname, ignores supplied names, and an empty update clears it', async () => {
  const env = environment()
  await env.call(alice, 'sessionAcquire')
  const saved = await env.call(alice, 'setNickname', { nickname: '밤하늘' })
  env.advance(1000)
  const ensured = await env.call(alice, 'ensureProfile', { nickname: '덮어쓰기', displayName: 'fake' })
  assert.equal(ensured.profile.nickname, '밤하늘')
  assert.equal(ensured.profile.createdAtMs, saved.profile.createdAtMs)
  assert.equal(ensured.profile.displayName, '김실제이름')
  const cleared = await env.call(alice, 'setNickname', { nickname: '  ' })
  assert.equal(cleared.profile.nickname, '')
  assert.equal((await env.call(alice, 'ensureProfile')).profile.nickname, '')
})

test('missing, wrong-window and expired leases cannot set another profile', async () => {
  const env = environment()
  await rejected(env.call(alice, 'setNickname', { nickname: '별빛' }), 'account-session/lost')
  await env.call(alice, 'sessionAcquire')
  await rejected(env.call(alice, 'setNickname', { nickname: '별빛', ownerId: 'another-owner-12345678' }), 'account-session/lost')
  await rejected(env.call(null, 'setNickname', { nickname: '별빛' }), 'UNAUTHENTICATED')
  env.advance(90_000)
  await rejected(env.call(alice, 'setNickname', { nickname: '별빛' }), 'account-session/lost')
  assert.equal((await env.store.inspect()).collections.profiles, undefined)
})

test('guest, local guest and non-Google identities cannot change nickname', async () => {
  const env = environment()
  await env.guestRegistry.create(guest)
  await env.call(guest, 'sessionAcquire')
  const before = (await env.call(guest, 'ensureProfile')).profile
  for (const identity of [guest, { ...alice, isLocalGuest: true }, { ...alice, accountProfile: { providerIds: ['password'] } }]) {
    await rejected(env.call(identity, 'setNickname', { nickname: '강제변경', providerIds: ['google.com'], isGuest: false }), 'NICKNAME_GOOGLE_ONLY')
  }
  const after = (await env.call(guest, 'ensureProfile')).profile
  assert.deepEqual(after, before)
  assert.equal(after.displayName, 'guest-123456')
  assert.equal(Object.hasOwn(after, 'nickname'), false)
})

test('invalid or profane nickname never changes profile, save data or lease', async () => {
  const env = environment()
  await env.call(alice, 'sessionAcquire')
  await env.call(alice, 'setNickname', { nickname: '좋은별명' })
  const before = await env.store.inspect()
  for (const nickname of ['가', 'abcdefghijklm', '<img>', 'A😀B', '\u115f\u1160', '별\u3164명', '\uffa0별명', 'guest-000000', 'GUEST-123456', 'ｇｕｅｓｔ-１２３４５６']) {
    await rejected(env.call(alice, 'setNickname', { nickname }), 'INVALID_NICKNAME')
  }
  for (const nickname of ['시발', 'ㅅㅂ', '병신', 'f u c k', 'SH1T']) {
    await assert.rejects(env.call(alice, 'setNickname', { nickname }), error => error.code === 'NICKNAME_PROFANITY'
      && error.status === 422 && !error.message.includes(nickname))
  }
  assert.deepEqual(await env.store.inspect(), before)
  assert.equal((await env.call(alice, 'setNickname', { nickname: '별빛챔피언' })).profile.nickname, '별빛챔피언')
})

test('HTTP applies authenticated lease, name validation and moderation without trusting payload identity', async () => {
  const env = environment()
  await env.call(alice, 'sessionAcquire')
  const handler = createAccountHttpHandler({ service: env.service, authenticate: async () => alice })
  const request = nickname => new Request('https://game.example.test/api/account', { method: 'POST',
    headers: { Origin: 'https://game.example.test', Authorization: 'Bearer verified-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'setNickname', ownerId, nickname, uid: bob.uid, nicknameApproved: true }) })
  const blocked = await handler(request('시발'))
  assert.equal(blocked.status, 422)
  assert.equal((await blocked.json()).error.code, 'NICKNAME_PROFANITY')
  const saved = await handler(request('해피배틀'))
  assert.equal(saved.status, 200)
  assert.equal((await saved.json()).profile.nickname, '해피배틀')
  assert.equal((await env.store.inspect()).collections.profiles[bob.uid], undefined)
})

for (const { name, run } of tests) { await run(); console.log(`PASS ${name}`) }
console.log(`Account nickname server: ${tests.length}/${tests.length} passed`)
