import assert from 'node:assert/strict'
import { resolveGuestIdentity } from '../src/auth/guestIdentityClient.js'

const requests = []
let tokenVersion = 0
const firebaseUser = {
  uid: 'anonymous-client-validation', isAnonymous: true, providerData: [],
  getIdToken() { assert.equal(this, firebaseUser); return Promise.resolve(`fresh-token-${++tokenVersion}`) },
}
let response = { uid: firebaseUser.uid, displayName: 'guest-004201', isGuest: true }
const options = { apiUrl: 'http://127.0.0.1:9876/api/ranked', fetchImpl: async (url, init) => {
  requests.push({ url, ...init })
  return { ok: true, status: 200, json: async () => response }
} }
const guest = await resolveGuestIdentity(firebaseUser, options)
assert.equal(guest.displayName, 'guest-004201')
assert.equal(guest.isAnonymous, true)
assert.equal(guest.isLocalGuest, false)
assert.equal(requests[0].method, 'POST')
assert.equal(requests[0].headers.Authorization, 'Bearer fresh-token-1')
const payload = JSON.parse(requests[0].body)
assert.equal(payload.action, 'guestProfile')
assert.ok(payload.requestId)
assert.deepEqual(Object.keys(payload).sort(), ['action', 'requestId'])
assert.equal(await guest.getIdToken(), 'fresh-token-2', 'Mapped guests retain bound, fresh Firebase token access')
assert.equal(guest.uid, firebaseUser.uid)
console.log('PASS anonymous guest reservation uses authenticated POST and bound fresh tokens')

for (const invalid of [
  { ...response, uid: 'another-owner' },
  { ...response, displayName: 'guest-12345' },
  { ...response, displayName: 'guest-1234567' },
  { ...response, displayName: 'admin' },
  { ...response, isGuest: false },
]) {
  response = invalid
  await assert.rejects(resolveGuestIdentity(firebaseUser, options), error => error.code === 'guest/invalid-profile')
}
await assert.rejects(resolveGuestIdentity({ ...firebaseUser, isAnonymous: false }, options), error => error.code === 'guest/invalid-user')
await assert.rejects(resolveGuestIdentity({ uid: firebaseUser.uid, isAnonymous: true }, options), error => error.code === 'guest/invalid-user')
console.log('PASS invalid identity, malformed names, missing tokens and Google identities are rejected')

await assert.rejects(resolveGuestIdentity(firebaseUser, { ...options, fetchImpl: async () => ({
  ok: false, status: 503, json: async () => ({ error: { code: 'SERVICE_UNAVAILABLE', message: 'retry later' } }),
}) }), error => error.code === 'SERVICE_UNAVAILABLE')
console.log('PASS failed guest registration stays failed without local random nickname fallback')
