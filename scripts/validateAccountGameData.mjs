import assert from 'node:assert/strict'

class MemoryStorage {
  constructor() {
    this.values = new Map()
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null
  }

  setItem(key, value) {
    this.values.set(key, String(value))
  }

  removeItem(key) {
    this.values.delete(key)
  }
}

globalThis.window = {
  localStorage: new MemoryStorage(),
  sessionStorage: new MemoryStorage(),
}

const {
  claimLocalPlayerData,
  clearLocalPlayerData,
  clearPendingGoogleMigration,
  getPlayerDataProgressScore,
  markLocalPlayerDataDirty,
  markLocalPlayerDataSynced,
  markPendingGoogleMigration,
  readLocalPlayerData,
  readPendingGoogleMigration,
  readPlayerSyncState,
  replaceLocalPlayerData,
} = await import('../src/auth/accountStorage.js')

const payload = {
  'champions-dex-v2': JSON.stringify([
    { captureId: 'dex-6', speciesId: 6, directDrawCount: 2 },
    { captureId: 'dex-25', speciesId: 25, directDrawCount: 1, isShiny: true },
  ]),
  'champions-teams-v1': JSON.stringify({
    version: 1,
    activeTeamId: 'team-1',
    teams: [{ id: 'team-1', pokemonIds: ['dex-6', 'dex-25'] }],
  }),
  'champions-vp-v1': '27500',
  'champions-battle-items-v1': JSON.stringify({ leftovers: 1 }),
  'champions-settings-v1': JSON.stringify({ game: { playerGender: 'female' } }),
}

replaceLocalPlayerData(payload)
assert.deepEqual(readLocalPlayerData(), payload)
assert.ok(getPlayerDataProgressScore(payload) > getPlayerDataProgressScore({}))

claimLocalPlayerData('google-user-1')
assert.equal(readPlayerSyncState()?.ownerUid, 'google-user-1')
assert.equal(readPlayerSyncState()?.dirty, false)

markLocalPlayerDataDirty('google-user-1')
assert.equal(readPlayerSyncState()?.dirty, true)

markLocalPlayerDataSynced('google-user-1', 'revision-1')
assert.equal(readPlayerSyncState()?.dirty, false)
assert.equal(readPlayerSyncState()?.revision, 'revision-1')

markPendingGoogleMigration('local-guest-1')
assert.equal(readPendingGoogleMigration()?.sourceUid, 'local-guest-1')
clearPendingGoogleMigration()
assert.equal(readPendingGoogleMigration(), null)

window.localStorage.setItem('unrelated-key', 'keep')
replaceLocalPlayerData({ 'champions-vp-v1': '30000' })
assert.deepEqual(readLocalPlayerData(), { 'champions-vp-v1': '30000' })
assert.equal(window.localStorage.getItem('unrelated-key'), 'keep')

clearLocalPlayerData()
assert.deepEqual(readLocalPlayerData(), {})
assert.equal(readPlayerSyncState(), null)
assert.equal(window.localStorage.getItem('unrelated-key'), 'keep')

console.log('Account game data storage validation passed.')

replaceLocalPlayerData(payload)
const prior = readLocalPlayerData()
const realSet = window.localStorage.setItem.bind(window.localStorage)
let shouldFail = true
window.localStorage.setItem = (key, value) => {
  if (key === 'champions-vp-v1' && shouldFail) {
    shouldFail = false
    throw Object.assign(new Error('quota exceeded'), { name: 'QuotaExceededError' })
  }
  realSet(key, value)
}
assert.throws(() => replaceLocalPlayerData({
  'champions-dex-v2': JSON.stringify([{ captureId:'dex-9',speciesId:9 }]),
  'champions-vp-v1': '99999',
}), /계정 데이터를/)
assert.deepEqual(readLocalPlayerData(), prior, 'A failed replacement restores every original account value')
assert.equal(window.localStorage.getItem('unrelated-key'), 'keep')
window.localStorage.setItem = realSet
console.log('PASS quota failure restores original account data and preserves unrelated storage')

const realGet = window.localStorage.getItem.bind(window.localStorage)
window.localStorage.getItem = key => { if (key === 'champions-dex-v2') throw new Error('storage denied'); return realGet(key) }
assert.throws(() => readLocalPlayerData(), /storage denied/, 'Blocked reads must not produce a partial cloud payload')
window.localStorage.getItem = realGet
console.log('PASS blocked local reads cannot silently produce partial account payloads')

window.localStorage.setItem = () => { throw new Error('storage denied') }
assert.throws(() => markLocalPlayerDataSynced('google-user-1','not-persisted'), /storage denied/)
window.localStorage.setItem = realSet
console.log('PASS failed sync metadata persistence is reported rather than marked successful')

clearLocalPlayerData()
replaceLocalPlayerData({ 'champions-dex-v2': 'a'.repeat(80), 'champions-vp-v1': '1' })
const quotaOriginal = readLocalPlayerData()
window.localStorage.setItem = (key, value) => {
  const next = new Map(window.localStorage.values)
  next.set(key,String(value))
  const used = [...next].filter(([entry])=>entry!=='unrelated-key').reduce((total,[,stored])=>total+stored.length,0)
  if (used>100) throw new Error('quota exceeded')
  realSet(key,value)
}
assert.throws(()=>replaceLocalPlayerData({
  'champions-dex-v2':'b', 'champions-vp-v1':'9'.repeat(80), 'champions-battle-items-v1':'x'.repeat(40),
}), /계정 데이터를/)
assert.deepEqual(readLocalPlayerData(),quotaOriginal,'Quota rollback must free changed values before restoring larger originals')
window.localStorage.setItem=realSet
console.log('PASS quota rollback restores original values when payload space moved between keys')
