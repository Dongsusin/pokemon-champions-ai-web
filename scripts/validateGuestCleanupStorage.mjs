import assert from 'node:assert/strict'
import {
  PLAYER_STORAGE_KEYS, PLAYER_SYNC_STORAGE_KEY, GUEST_MIGRATION_BACKUP_PREFIX,
  PENDING_GOOGLE_MIGRATION_STORAGE_KEY, GUEST_DELETION_PREFIX,
  clearGuestPlayerData, writeGuestDeletion, readGuestDeletion, clearGuestDeletion,
  clearCompletedGuestDeletions,
} from '../src/auth/accountStorage.js'

const guest = 'guest:/target'
const google = 'google-preserved'
const storage = () => {
  const values = new Map()
  return { values, get length() { return values.size }, key: index => [...values.keys()][index] ?? null, getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) }
}
const guestKeys = uid => [
  `${GUEST_MIGRATION_BACKUP_PREFIX}${encodeURIComponent(uid)}`,
  ...['global','guest','test'].map(scope => `champions-factory-outbox-v1-${scope}:${encodeURIComponent(uid)}`),
  ...['','-live','-local','-demo'].map(suffix => `champions-usage-outbox-v1${suffix}:${uid}`),
]
function fixture(owner = guest) {
  globalThis.window = { localStorage: storage(), sessionStorage: storage() }
  for (const storage of [window.localStorage, window.sessionStorage]) {
    for (const key of PLAYER_STORAGE_KEYS) storage.setItem(key, 'owned-save')
    storage.setItem(PLAYER_SYNC_STORAGE_KEY, JSON.stringify({ version: 1, ownerUid: owner }))
    for (const uid of [guest, google, `${guest}-other`]) {
      for (const key of guestKeys(uid)) storage.setItem(key, JSON.stringify({ uid }))
    }
    storage.setItem('champions-local-guest-v1', JSON.stringify({ version: 1, uid: guest }))
    storage.setItem(PENDING_GOOGLE_MIGRATION_STORAGE_KEY, JSON.stringify({ version: 1, sourceUid: guest, targetUid: google }))
    storage.setItem('champions-factory-local-rankings-v1', JSON.stringify([
      { id: `local:${encodeURIComponent(guest)}`, trainerName: 'guest-111111' },
      { id: `local:${encodeURIComponent(google)}`, trainerName: '유지할 계정' },
    ]))
    storage.setItem('champions-auto-login-v1', 'false')
    storage.setItem('champions-arena-resource-cache-v1', 'public-sprite-cache')
  }
}

fixture()
writeGuestDeletion(guest, { lease: { ownerId: 'owner', version: 'revision' }, serverDeleted: true })
clearGuestPlayerData(guest)
for (const storage of [window.localStorage, window.sessionStorage]) {
  for (const key of [...PLAYER_STORAGE_KEYS, PLAYER_SYNC_STORAGE_KEY, ...guestKeys(guest),
    PENDING_GOOGLE_MIGRATION_STORAGE_KEY, 'champions-local-guest-v1']) assert.equal(storage.getItem(key), null, key)
  for (const uid of [google, `${guest}-other`]) for (const key of guestKeys(uid)) assert.notEqual(storage.getItem(key), null, key)
  assert.deepEqual(JSON.parse(storage.getItem('champions-factory-local-rankings-v1')), [{ id: `local:${encodeURIComponent(google)}`, trainerName: '유지할 계정' }])
  assert.equal(storage.getItem('champions-auto-login-v1'), 'false')
  assert.equal(storage.getItem('champions-arena-resource-cache-v1'), 'public-sprite-cache')
}
assert.equal(readGuestDeletion(guest).serverDeleted, true)
clearGuestDeletion(guest)
assert.equal(window.localStorage.getItem(`${GUEST_DELETION_PREFIX}${encodeURIComponent(guest)}`), null)
console.log('PASS guest saves, outboxes, ranking and migration records deleted; other UIDs, public cache and retry marker isolated')

fixture(google)
clearGuestPlayerData(guest)
for (const key of PLAYER_STORAGE_KEYS) assert.equal(window.localStorage.getItem(key), 'owned-save')
assert.equal(JSON.parse(window.localStorage.getItem(PLAYER_SYNC_STORAGE_KEY)).ownerUid, google)
console.log('PASS guest cleanup preserves shared save currently owned by Google')

fixture(google)
writeGuestDeletion(guest, { lease: { ownerId: 'old-owner', version: 'old-version' }, serverDeleted: true, authDeleted: true })
writeGuestDeletion('incomplete', { lease: { ownerId: 'keep-owner', version: 'keep-version' }, serverDeleted: true })
clearCompletedGuestDeletions()
assert.equal(readGuestDeletion(guest), null)
assert.equal(readGuestDeletion('incomplete').serverDeleted, true)
assert.equal(JSON.parse(window.localStorage.getItem(PLAYER_SYNC_STORAGE_KEY)).ownerUid, google)
console.log('PASS reload can finish confirmed Firebase-deletion cleanup without clearing pending credentials or another account')

fixture()
const originalRemove = window.localStorage.removeItem
window.localStorage.removeItem = key => { if (key === PLAYER_STORAGE_KEYS[2]) throw Error('storage blocked'); return originalRemove(key) }
assert.throws(() => clearGuestPlayerData(guest), /storage blocked/)
assert.equal(JSON.parse(window.localStorage.getItem(PLAYER_SYNC_STORAGE_KEY)).ownerUid, guest)
window.localStorage.removeItem = originalRemove
clearGuestPlayerData(guest)
for (const key of PLAYER_STORAGE_KEYS) assert.equal(window.localStorage.getItem(key), null)
fixture()
window.localStorage.getItem = () => { throw Error('read blocked') }
assert.throws(() => clearGuestPlayerData(guest), /read blocked/)
console.log('PASS partial removal and unreadable ownership fail visibly and permit safe retry')
delete globalThis.window
