export const PLAYER_STORAGE_KEYS = [
  'champions-dex-v2',
  'champions-box-v1',
  'champions-teams-v1',
  'champions-team-v2',
  'champions-team-v1',
  'champions-vp-v1',
  'champions-battle-items-v1',
  'champions-draw-tutorial-v1',
  'champions-settings-v1',
]

export const PLAYER_SYNC_STORAGE_KEY = 'champions-cloud-sync-v1'
export const PENDING_GOOGLE_MIGRATION_STORAGE_KEY = 'champions-google-migration-v1'

function readJsonStorage(key) {
  if (typeof window === 'undefined') return null
  try {
    const value = window.localStorage.getItem(key)
    return value ? JSON.parse(value) : null
  } catch {
    return null
  }
}

function writeJsonStorage(key, value) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {}
}

function parseStoredJson(payload, key, fallback) {
  try {
    return payload?.[key] ? JSON.parse(payload[key]) : fallback
  } catch {
    return fallback
  }
}

export function readLocalPlayerData() {
  if (typeof window === 'undefined') return {}

  return PLAYER_STORAGE_KEYS.reduce((payload, key) => {
    try {
      const value = window.localStorage.getItem(key)
      if (typeof value === 'string') payload[key] = value
    } catch {}
    return payload
  }, {})
}

export function replaceLocalPlayerData(payload = {}) {
  if (typeof window === 'undefined') return

  for (const key of PLAYER_STORAGE_KEYS) {
    try {
      window.localStorage.removeItem(key)
    } catch {}
  }

  for (const [key, value] of Object.entries(payload)) {
    if (!PLAYER_STORAGE_KEYS.includes(key) || typeof value !== 'string') continue
    try {
      window.localStorage.setItem(key, value)
    } catch {}
  }
}

export function getPlayerDataProgressScore(payload = {}) {
  const collection = parseStoredJson(
    payload,
    payload['champions-dex-v2'] ? 'champions-dex-v2' : 'champions-box-v1',
    [],
  )
  const teamState = parseStoredJson(payload, 'champions-teams-v1', null)
  const legacyTeam = parseStoredJson(
    payload,
    payload['champions-team-v2'] ? 'champions-team-v2' : 'champions-team-v1',
    [],
  )
  const itemInventory = parseStoredJson(payload, 'champions-battle-items-v1', {})
  const pokemonScore = Array.isArray(collection)
    ? collection.reduce((score, pokemon) => (
        score
        + 1000
        + Math.max(0, Number(pokemon?.directDrawCount) || 0) * 10
        + (pokemon?.isShiny ? 25 : 0)
      ), 0)
    : 0
  const teamPokemonCount = Array.isArray(teamState?.teams)
    ? teamState.teams.reduce((count, team) => count + (Array.isArray(team?.pokemonIds) ? team.pokemonIds.length : 0), 0)
    : (Array.isArray(legacyTeam) ? legacyTeam.length : 0)
  const ownedItemCount = Object.values(itemInventory ?? {}).filter(Boolean).length
  const tutorialScore = payload['champions-draw-tutorial-v1'] === 'complete' ? 10 : 0
  const settingsScore = payload['champions-settings-v1'] ? 1 : 0

  return pokemonScore + teamPokemonCount * 100 + ownedItemCount * 50 + tutorialScore + settingsScore
}

export function readPlayerSyncState() {
  const value = readJsonStorage(PLAYER_SYNC_STORAGE_KEY)
  if (!value || value.version !== 1 || typeof value.ownerUid !== 'string') return null
  return {
    version: 1,
    ownerUid: value.ownerUid,
    revision: typeof value.revision === 'string' ? value.revision : '',
    dirty: value.dirty === true,
    localUpdatedAt: Math.max(0, Number(value.localUpdatedAt) || 0),
  }
}

export function claimLocalPlayerData(ownerUid) {
  if (!ownerUid) return
  const current = readPlayerSyncState()
  writeJsonStorage(PLAYER_SYNC_STORAGE_KEY, {
    version: 1,
    ownerUid,
    revision: current?.ownerUid === ownerUid ? current.revision : '',
    dirty: current?.ownerUid === ownerUid ? current.dirty : false,
    localUpdatedAt: current?.ownerUid === ownerUid ? current.localUpdatedAt : Date.now(),
  })
}

export function markLocalPlayerDataDirty(ownerUid) {
  if (!ownerUid) return
  const current = readPlayerSyncState()
  writeJsonStorage(PLAYER_SYNC_STORAGE_KEY, {
    version: 1,
    ownerUid,
    revision: current?.ownerUid === ownerUid ? current.revision : '',
    dirty: true,
    localUpdatedAt: Date.now(),
  })
}

export function markLocalPlayerDataSynced(ownerUid, revision = '') {
  if (!ownerUid) return
  writeJsonStorage(PLAYER_SYNC_STORAGE_KEY, {
    version: 1,
    ownerUid,
    revision,
    dirty: false,
    localUpdatedAt: Date.now(),
  })
}

export function markPendingGoogleMigration(sourceUid) {
  if (!sourceUid) return
  writeJsonStorage(PENDING_GOOGLE_MIGRATION_STORAGE_KEY, {
    version: 1,
    sourceUid,
    createdAt: Date.now(),
  })
}

export function readPendingGoogleMigration() {
  const value = readJsonStorage(PENDING_GOOGLE_MIGRATION_STORAGE_KEY)
  if (!value || value.version !== 1 || typeof value.sourceUid !== 'string') return null
  return value
}

export function clearPendingGoogleMigration() {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(PENDING_GOOGLE_MIGRATION_STORAGE_KEY)
  } catch {}
}

export function clearLocalPlayerData() {
  if (typeof window === 'undefined') return

  for (const storage of [window.localStorage, window.sessionStorage]) {
    for (const key of [
      ...PLAYER_STORAGE_KEYS,
      PLAYER_SYNC_STORAGE_KEY,
      PENDING_GOOGLE_MIGRATION_STORAGE_KEY,
    ]) {
      try {
        storage.removeItem(key)
      } catch {}
    }
  }
}
