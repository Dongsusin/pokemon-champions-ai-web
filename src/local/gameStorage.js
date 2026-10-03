import { AUTO_START_KEY, createSave, isLocalSaveKey, PROFILE_KEY, validateSave, validateSaveValues } from './saveSchema.js'
import { createIndexedDbBackend } from './indexedDbBackend.js'

const JOURNAL_KEY = 'champions-local-journal-v1'
let activeStore = null
let initialization = null

// Game systems retain the synchronous Storage contract. The launcher or the
// local runtime owns the durable file, and each commit saves one full snapshot.
export function createLocalGameStore({ backend, journal, debounceMs = 80, onStatus = () => {} }) {
  let values = {}, revision = 0, changed = 0, committed = 0, timer, saving, paused = false
  let status = { ready: false, saving: false, dirty: false, error: '', kind: backend.kind, location: backend.location, updatedAt: 0 }
  const publish = update => { status = { ...status, ...update }; onStatus({ ...status }) }
  const journalSave = next => {
    // The small synchronous journal protects changes if the renderer exits
    // before its asynchronous disk write finishes. Never silently drop it.
    journal?.setItem(JOURNAL_KEY, JSON.stringify({ revision, values: next }))
  }
  const mutate = next => {
    if (!status.ready || paused) throw new Error('로컬 저장소가 준비되지 않았습니다.')
    try { journalSave(next) } catch (error) {
      publish({ error: '변경 기록을 임시 보관하지 못했습니다. 이 창을 닫지 말고 저장 공간을 확인해주세요.' })
      throw error
    }
    values = next
    changed++
    publish({ dirty: true })
    clearTimeout(timer)
    timer = setTimeout(() => { void api.flush().catch(() => {}) }, debounceMs)
  }
  const api = {
    async initialize(legacyValues = {}) {
      const durable = await backend.read()
      let recovered = null
      const raw = journal?.getItem(JOURNAL_KEY)
      if (raw) {
        const entry = JSON.parse(raw)
        if (entry?.revision === (durable?.revision ?? 0)) recovered = validateSaveValues(entry.values)
      }
      revision = durable?.revision ?? 0
      values = recovered ?? durable?.values ?? validateSaveValues(legacyValues)
      publish({ ready: true, updatedAt: durable?.updatedAt ?? 0 })
      if (recovered || (!durable && Object.keys(values).length)) { changed++; await api.flush() }
      return api
    },
    get length() { return Object.keys(values).length },
    key(index) { return Object.keys(values)[index] ?? null },
    getItem(key) { return Object.hasOwn(values, key) ? values[key] : null },
    setItem(key, value) {
      if (!isLocalSaveKey(key)) throw new Error(`로컬 저장 대상이 아닌 항목입니다: ${key}`)
      value = String(value)
      if (values[key] === value) return
      mutate({ ...values, [key]: value })
    },
    removeItem(key) { if (Object.hasOwn(values, key)) { const next = { ...values }; delete next[key]; mutate(next) } },
    snapshot() { return createSave(values, revision, status.updatedAt || Date.now()) },
    status() { return { ...status } },
    async flush() {
      clearTimeout(timer)
      if (!status.ready) throw new Error('로컬 저장소가 준비되지 않았습니다.')
      if (saving) return saving
      if (changed === committed) return true
      saving = (async () => {
        publish({ saving: true, error: '' })
        try {
          while (changed !== committed) {
            const generation = changed
            const next = validateSave(await backend.write(createSave(values, revision), revision))
            revision = next.revision
            committed = generation
            // A stale journal has the previous revision and is ignored on the
            // next startup. Cleanup failure cannot undo a completed disk save.
            try { if (changed === committed) journal?.removeItem(JOURNAL_KEY); else journalSave(values) } catch {}
            publish({ dirty: changed !== committed, updatedAt: next.updatedAt })
          }
          return true
        } catch (error) {
          publish({ dirty: true, error: error?.message ?? '로컬 기록을 저장하지 못했습니다.' })
          throw error
        } finally { publish({ saving: false }); saving = null }
      })()
      return saving
    },
    async replace(save) {
      const next = validateSave(save)
      if (paused) throw new Error('다른 저장 작업이 진행 중입니다.')
      paused = true
      try {
        await api.flush()
        // Back up the current save before import; a rejected disk write must
        // leave both the displayed game and the durable save unchanged.
        const written = validateSave(await backend.write({ ...next, revision }, revision, { reason: 'import' }))
        values = written.values
        revision = written.revision
        changed = committed = 0
        try { journal?.removeItem(JOURNAL_KEY) } catch { /* The old revision cannot supersede the committed import. */ }
        publish({ error: '', dirty: false, updatedAt: written.updatedAt })
      } finally { paused = false }
    },
    close() { clearTimeout(timer); backend.close?.() },
  }
  return api
}

export const gameStorage = {
  get length() { return storage().length }, key(index) { return storage().key(index) },
  getItem(key) { return storage().getItem(key) },
  setItem(key, value) { return storage().setItem(key, value) },
  removeItem(key) { return storage().removeItem(key) },
}
function storage() {
  // Existing pure gameplay validators supply their own in-memory Storage.
  if (activeStore) return activeStore
  return globalThis.window?.localStorage ?? globalThis.localStorage
}
function hostWindow() {
  try { return window.frameElement?.hasAttribute('data-game-frame') ? window.parent : window } catch { return window }
}
export async function initializeGameStorage() {
  if (initialization) return initialization
  initialization = (async () => {
    const launcher = hostWindow().championsLauncher
    let backend
    if (launcher) {
      if (launcher.version !== 1 || typeof launcher.readSave !== 'function' || typeof launcher.writeSave !== 'function') {
        throw new Error('런처 저장 연결 규격이 일치하지 않습니다. 런처를 업데이트해주세요.')
      }
      const info = await launcher.getInfo?.()
      backend = { kind: 'launcher', location: info?.saveLocation ?? '런처의 로컬 저장 폴더',
        read: () => launcher.readSave(), write: (save, expectedRevision, options = {}) => launcher.writeSave(save, { expectedRevision, ...options }) }
    } else backend = await createIndexedDbBackend()
    let journal
    try { journal = window.localStorage } catch { /* A native backend can operate without the optional browser journal. */ }
    const legacy = {}
    if (journal) for (let index = 0; index < journal.length; index++) {
      const key = journal.key(index)
      if (isLocalSaveKey(key)) legacy[key] = journal.getItem(key)
    }
    // Preserve the old owner's identity for reward receipts, without keeping
    // any Firebase credentials or contacting the old account server.
    if (!legacy[PROFILE_KEY]) {
      let old
      try { old = JSON.parse(journal?.getItem('champions-local-guest-v1') ?? 'null')
        ?? JSON.parse(journal?.getItem('champions-cloud-sync-v1') ?? 'null') } catch {}
      if (old?.uid || old?.ownerUid) legacy[PROFILE_KEY] = JSON.stringify({ uid: old.uid ?? old.ownerUid,
        displayName: old.displayName ?? '로컬 트레이너', nickname: '', title: '', isLocal: true })
    }
    const nextStore = createLocalGameStore({ backend, journal,
      onStatus: status => window.dispatchEvent(new CustomEvent('champions:local-save-status', { detail: status })) })
    await nextStore.initialize(legacy)
    activeStore = nextStore
    launcher?.onBeforeClose?.(() => nextStore.flush())
    const flush = () => { void nextStore.flush().catch(() => {}) }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush() })
    window.addEventListener('beforeunload', event => {
      if (nextStore.status().dirty) { event.preventDefault(); event.returnValue = ''; flush() }
    })
    return nextStore
  })().catch(error => { initialization = null; throw error })
  return initialization
}
export function getLocalSaveStatus() { return activeStore?.status() ?? { ready: false, error: '' } }
export function flushLocalSave() { return activeStore?.flush() ?? Promise.resolve(true) }
export function getLocalSave() { if (!activeStore) throw new Error('로컬 저장소가 준비되지 않았습니다.'); return activeStore.snapshot() }
export async function replaceLocalSave(save) { if (!activeStore) throw new Error('로컬 저장소가 준비되지 않았습니다.'); await activeStore.replace(save) }
