export const LOCAL_SAVE_FORMAT = 'champions-arena-local'
export const LOCAL_SAVE_VERSION = 1
export const MAX_SAVE_BYTES = 32 * 1024 * 1024
export const PROFILE_KEY = 'champions-local-profile-v1'
export const AUTO_START_KEY = 'champions-local-auto-start-v1'
export const LOCAL_USAGE_KEY = 'champions-local-usage-v1'
export const PLAYER_STORAGE_KEYS = Object.freeze([
  'champions-dex-v2', 'champions-box-v1', 'champions-teams-v1',
  'champions-team-v2', 'champions-team-v1', 'champions-vp-v1',
  'champions-battle-items-v1', 'champions-draw-tutorial-v1',
  'champions-settings-v1', 'champions-achievements-v1', 'champions-factory-run-v1',
])
const localKeys = new Set([...PLAYER_STORAGE_KEYS, PROFILE_KEY, AUTO_START_KEY, LOCAL_USAGE_KEY,
  'champions-factory-local-rankings-v1', 'champions-battle-hub-mode-v1',
  'champions-usage-top-three-collapsed-v1'])
export function isLocalSaveKey(key) {
  return localKeys.has(key) || /^champions-factory-outbox-v1-(local|guest|test):/.test(key)
}
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const nonnegative = value => Number.isSafeInteger(value) && value >= 0
const pokemonId = value => Number.isSafeInteger(value) && value > 0
const captureId = value => typeof value === 'string' && value.length > 0
function validateContents(key, parsed) {
  let valid = true
  if (['champions-dex-v2', 'champions-box-v1'].includes(key)) {
    valid = parsed.every(entry => object(entry) && pokemonId(entry.speciesId ?? entry.id)
      && (entry.captureId === undefined || captureId(entry.captureId)))
  } else if (key === 'champions-teams-v1') {
    valid = Array.isArray(parsed.teams) && parsed.teams.every(team => object(team) && captureId(team.id)
      && Array.isArray(team.pokemonIds) && team.pokemonIds.every(captureId))
  } else if (['champions-team-v2', 'champions-team-v1'].includes(key)) {
    valid = parsed.every(id => captureId(id) || pokemonId(id))
  } else if (key === 'champions-achievements-v1') {
    valid = parsed.walletBalance === undefined || nonnegative(parsed.walletBalance)
  } else if (key === 'champions-battle-items-v1') {
    valid = Object.values(parsed).every(nonnegative)
  } else if (key === PROFILE_KEY) {
    valid = captureId(parsed.uid) && typeof parsed.displayName === 'string' && parsed.displayName.trim()
      && (parsed.nickname === undefined || typeof parsed.nickname === 'string')
      && (parsed.title === undefined || typeof parsed.title === 'string')
  }
  if (!valid) throw new Error(`저장 항목의 내용이 올바르지 않습니다: ${key}`)
}

// Credentials, cloud session leases and queued cloud requests are never saves.
export function validateSaveValues(values) {
  if (!object(values)) throw new Error('저장 파일의 데이터 형식이 올바르지 않습니다.')
  const result = {}
  for (const [key, value] of Object.entries(values)) {
    if (!isLocalSaveKey(key) || typeof value !== 'string') throw new Error(`지원하지 않는 저장 항목입니다: ${key}`)
    if (key === 'champions-vp-v1') {
      if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error('VP 기록이 올바르지 않습니다.')
    } else if (![AUTO_START_KEY, 'champions-draw-tutorial-v1', 'champions-battle-hub-mode-v1',
      'champions-usage-top-three-collapsed-v1'].includes(key)) {
      let parsed
      try { parsed = JSON.parse(value) } catch { throw new Error(`손상된 저장 항목입니다: ${key}`) }
      const array = ['champions-dex-v2', 'champions-box-v1', 'champions-team-v2',
        'champions-team-v1', 'champions-factory-local-rankings-v1'].includes(key)
      if (array ? !Array.isArray(parsed) : !object(parsed)) throw new Error(`저장 항목의 형식이 올바르지 않습니다: ${key}`)
      validateContents(key, parsed)
    }
    result[key] = value
  }
  if (new TextEncoder().encode(JSON.stringify(result)).length > MAX_SAVE_BYTES) throw new Error('저장 파일의 최대 크기를 초과했습니다.')
  return result
}

export function createSave(values = {}, revision = 0, updatedAt = Date.now()) {
  const save = { format: LOCAL_SAVE_FORMAT, version: LOCAL_SAVE_VERSION, revision, updatedAt, values: validateSaveValues(values) }
  if (new TextEncoder().encode(JSON.stringify(save)).length > MAX_SAVE_BYTES) throw new Error('저장 파일의 최대 크기를 초과했습니다.')
  return save
}

export function validateSave(value) {
  if (!object(value) || value.format !== LOCAL_SAVE_FORMAT || value.version !== LOCAL_SAVE_VERSION ||
    !Number.isSafeInteger(value.revision) || value.revision < 0 ||
    !Number.isSafeInteger(value.updatedAt) || value.updatedAt < 0) {
    throw new Error('지원하지 않거나 손상된 저장 파일입니다. 기존 기록은 변경하지 않았습니다.')
  }
  return createSave(value.values, value.revision, value.updatedAt)
}

export function parseBackup(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_SAVE_BYTES) throw new Error('백업 파일의 크기가 올바르지 않습니다.')
  let value
  try { value = JSON.parse(text) } catch { throw new Error('백업 파일을 읽지 못했습니다. JSON 파일을 선택해주세요.') }
  if (value?.format) return validateSave(value)
  // Earlier manually exported browser saves may contain a payload wrapper.
  const payload = value?.payload ?? value
  if (!object(payload) || !PLAYER_STORAGE_KEYS.some(key => Object.hasOwn(payload, key))) throw new Error('게임 백업 파일이 아닙니다.')
  return createSave(Object.fromEntries(Object.entries(payload).filter(([key]) => isLocalSaveKey(key))))
}
