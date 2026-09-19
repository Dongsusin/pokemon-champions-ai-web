import { ACHIEVEMENT_STORAGE_KEY, normalizeAchievementState } from '../data/achievementData.js'
import { FACTORY_RUN_STORAGE_KEY } from '../data/battleFactoryStorage.js'

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
  ACHIEVEMENT_STORAGE_KEY,
  FACTORY_RUN_STORAGE_KEY,
]

export const PLAYER_SYNC_STORAGE_KEY = 'champions-cloud-sync-v1'
export const PENDING_GOOGLE_MIGRATION_STORAGE_KEY = 'champions-google-migration-v1'
export const GUEST_MIGRATION_BACKUP_PREFIX = 'champions-guest-migration-backup-v1-'
export const GUEST_DELETION_PREFIX = 'champions-guest-deletion-v1-'

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
  window.localStorage.setItem(key, JSON.stringify(value))
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
    // A partial snapshot must never replace a complete cloud save.
    const value = window.localStorage.getItem(key)
    if (typeof value === 'string') payload[key] = value
    return payload
  }, {})
}

export function replaceLocalPlayerData(payload = {}) {
  if (typeof window === 'undefined') return
  const storage = window.localStorage
  const previous = new Map(PLAYER_STORAGE_KEYS.map(key => [key, storage.getItem(key)]))
  const next = new Map(Object.entries(payload).filter(([key, value]) => (
    PLAYER_STORAGE_KEYS.includes(key) && typeof value === 'string'
  )))
  try {
    for (const [key, value] of next) storage.setItem(key, value)
    for (const key of PLAYER_STORAGE_KEYS) if (!next.has(key)) storage.removeItem(key)
  } catch (cause) {
    // A replacement may redistribute quota between keys. Free changed values
    // before restoring the snapshot, which already fit in storage beforehand.
    for (const [key, value] of previous) {
      try { if (storage.getItem(key) !== value) storage.removeItem(key) } catch {}
    }
    for (const [key, value] of previous) if (value !== null) {
      try { storage.setItem(key, value) } catch {}
    }
    throw new Error('계정 데이터를 이 기기에 저장하지 못했습니다.', { cause })
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
  const achievements = normalizeAchievementState(parseStoredJson(payload, ACHIEVEMENT_STORAGE_KEY, null))
  const achievementScore = Object.keys(achievements.unlocked).length * 100 + achievements.stats.wins * 10

  return pokemonScore + teamPokemonCount * 100 + ownedItemCount * 50 + tutorialScore + settingsScore + achievementScore
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

export function backupGuestPlayerData(sourceUid) {
  const syncState = readPlayerSyncState()
  if (!sourceUid || syncState?.ownerUid !== sourceUid) return false
  writeJsonStorage(`${GUEST_MIGRATION_BACKUP_PREFIX}${encodeURIComponent(sourceUid)}`, {
    version: 1, sourceUid, payload: readLocalPlayerData(), syncState, createdAt: Date.now(),
  })
  return true
}

export function markPendingGoogleMigration(sourceUid, targetUid = '', { preserveExistingCloud = false } = {}) {
  if (!sourceUid) return
  writeJsonStorage(PENDING_GOOGLE_MIGRATION_STORAGE_KEY, {
    version: 1,
    sourceUid,
    ...(targetUid ? { targetUid } : {}),
    ...(preserveExistingCloud ? { preserveExistingCloud: true } : {}),
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

// A failed deletion must resume the same operation after a reload, instead of
// admitting the retired guest again. This contains no authentication token.
export function readGuestDeletion(uid) {
  const value = readJsonStorage(`${GUEST_DELETION_PREFIX}${encodeURIComponent(uid)}`)
  return value?.version === 1 && value.uid === uid && value.lease
    && typeof value.lease.ownerId === 'string' && typeof value.lease.version === 'string'
    ? value : null
}

export function writeGuestDeletion(uid, record) {
  writeJsonStorage(`${GUEST_DELETION_PREFIX}${encodeURIComponent(uid)}`, { ...record, version: 1, uid })
}

export function clearGuestDeletion(uid) {
  window.localStorage.removeItem(`${GUEST_DELETION_PREFIX}${encodeURIComponent(uid)}`)
}

export function clearCompletedGuestDeletions() {
  if (typeof window === 'undefined') return
  const storage = window.localStorage
  const completed = []
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (!key?.startsWith(GUEST_DELETION_PREFIX)) continue
    let record
    const raw = storage.getItem(key)
    try { record = JSON.parse(raw) } catch { continue }
    if (record?.version === 1 && record.serverDeleted === true && record.authDeleted === true
      && key === `${GUEST_DELETION_PREFIX}${encodeURIComponent(record.uid)}`) completed.push(record.uid)
  }
  for (const uid of completed) {
    clearGuestPlayerData(uid)
    clearGuestDeletion(uid)
  }
}

export function clearGuestPlayerData(uid) {
  if (!uid || typeof window === 'undefined') return
  const encoded = encodeURIComponent(uid)
  const json = (storage, key) => {
    const raw = storage.getItem(key) // Storage access failures must block completion.
    try { return JSON.parse(raw) } catch { return null }
  }
  const owner = json(window.localStorage, PLAYER_SYNC_STORAGE_KEY)?.ownerUid
  for (const storage of [window.localStorage, window.sessionStorage]) {
    // Shared save keys belong to the admitted owner, never every account that
    // previously used this browser. Delete the ownership marker last for retry.
    if (owner === uid) for (const key of PLAYER_STORAGE_KEYS) storage.removeItem(key)
    storage.removeItem(`${GUEST_MIGRATION_BACKUP_PREFIX}${encoded}`)
    for (const scope of ['global', 'guest', 'test']) storage.removeItem(`champions-factory-outbox-v1-${scope}:${encoded}`)
    for (const suffix of ['', '-live', '-local', '-demo']) storage.removeItem(`champions-usage-outbox-v1${suffix}:${uid}`)
    const migration = json(storage, PENDING_GOOGLE_MIGRATION_STORAGE_KEY)
    if (migration?.sourceUid === uid || migration?.targetUid === uid) storage.removeItem(PENDING_GOOGLE_MIGRATION_STORAGE_KEY)
    if (json(storage, 'champions-local-guest-v1')?.uid === uid) storage.removeItem('champions-local-guest-v1')
    const rankingsKey = 'champions-factory-local-rankings-v1'
    const rankings = json(storage, rankingsKey)
    if (Array.isArray(rankings)) {
      const remaining = rankings.filter(entry => entry?.id !== `local:${encoded}` && entry?.uid !== uid)
      if (remaining.length !== rankings.length) {
        if (remaining.length) storage.setItem(rankingsKey, JSON.stringify(remaining))
        else storage.removeItem(rankingsKey)
      }
    }
  }
  if (owner === uid) {
    window.sessionStorage.removeItem(PLAYER_SYNC_STORAGE_KEY)
    window.localStorage.removeItem(PLAYER_SYNC_STORAGE_KEY)
  }
}
