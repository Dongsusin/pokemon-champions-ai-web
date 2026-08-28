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
