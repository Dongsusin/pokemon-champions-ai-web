import { createRankedClient, rankedApiUrl } from './rankedClient.js'
import { maskRankedTrainerName } from './data/rankedPrivacy.js'
import {
  chooseFactoryPersonalBest,
  createFactoryRankingSubmission,
  sortFactoryRankingEntries,
  validateFactoryRankingSubmission,
} from './data/battleFactoryRanking.js'
import { FACTORY_DEFAULT_MODE, getFactoryMode } from './data/battleFactoryChallenge.js'

const env = import.meta.env ?? {}
const loopback = host => ['localhost', '127.0.0.1', '[::1]', '::1'].includes(host)
export const isFactoryRankingLocalTest = Boolean(env.DEV && env.MODE === 'factory-test'
  && env.VITE_FACTORY_LOCAL_TEST === 'true' && typeof window !== 'undefined'
  && loopback(window.location.hostname) && loopback(new URL(rankedApiUrl).hostname))
const testIdentities = Object.freeze({ 'factory-local': 'alice', 'factory-local-b': 'bob' })
export const FACTORY_RANKING_PENDING_LIMIT = 20
export const FACTORY_LOCAL_RANKINGS_KEY = 'champions-factory-local-rankings-v1'
const clone = value => structuredClone(value)
const uidKey = uid => {
  if (typeof uid !== 'string' || !uid.trim()) throw new Error('순위를 기록할 트레이너를 확인하지 못했습니다.')
  return encodeURIComponent(uid)
}

export function normalizeFactoryRankingSnapshot(value) {
  const validEntry = entry => entry && typeof entry.id === 'string' && typeof entry.runId === 'string'
    && (entry.mode === undefined || getFactoryMode(entry.mode).id === entry.mode)
    && typeof entry.trainerName === 'string' && Number.isSafeInteger(entry.floor) && entry.floor >= 1
    && entry.wins === entry.floor - 1 && Number.isFinite(entry.recordedAt) && entry.recordedAt >= 0
    && Array.isArray(entry.party) && entry.party.length === 3
  if (!value || !Array.isArray(value.entries) || value.entries.length > 10
    || value.entries.some(entry => !validEntry(entry))
    || (value.ownBest !== null && !validEntry(value.ownBest))) {
    throw new Error('배틀팩토리 순위 응답을 확인하지 못했습니다. 다시 불러와주세요.')
  }
  return clone({ entries: value.entries, ownBest: value.ownBest })
}

export function createFactoryRankingClient({ uid, getIdToken, fetchImpl, apiUrl = rankedApiUrl, mode = FACTORY_DEFAULT_MODE } = {}) {
  uidKey(uid)
  if (isFactoryRankingLocalTest && (!loopback(new URL(apiUrl).hostname) || !testIdentities[uid])) {
    throw new Error('팩토리 테스트 계정은 지정된 로컬 서버에서만 사용할 수 있습니다.')
  }
  const client = createRankedClient({ apiUrl, ...(fetchImpl ? { fetchImpl } : {}),
    getIdToken: isFactoryRankingLocalTest ? async () => `ranked-test-${testIdentities[uid]}` : getIdToken,
  })
  return {
    async read(signal) {
      return normalizeFactoryRankingSnapshot(await client.request('factoryLeaderboard', { mode: getFactoryMode(mode).id }, { signal }))
    },
    async report(report, signal) {
      const validated = validateFactoryRankingSubmission(report)
      return normalizeFactoryRankingSnapshot(await client.request('reportFactoryRun', { report: validated }, { signal }))
    },
  }
}

// Persist the report before attempting any request. A receipt from a lost
// response is retried with the same run ID; successful IDs also suppress React
// StrictMode replays and repeated completion callbacks after a remount.
export function createFactoryRankingOutbox({ uid, storage, send, onSnapshot = () => {}, isCurrent = () => true, scope = 'global', mode = FACTORY_DEFAULT_MODE }) {
  const boardMode = getFactoryMode(mode).id
  const key = boardMode === FACTORY_DEFAULT_MODE
    ? `champions-factory-outbox-v1-${scope}:${uidKey(uid)}`
    : `champions-factory-outbox-v1-${scope}:${boardMode}:${uidKey(uid)}`
  let stopped = false
  let running = null
  const controller = new AbortController()
  const current = () => !stopped && isCurrent()
  const read = () => {
    const value = JSON.parse(storage.getItem(key) ?? '{"pending":[],"completed":[]}')
    if (!value || !Array.isArray(value.pending) || !Array.isArray(value.completed)
      || value.pending.length > FACTORY_RANKING_PENDING_LIMIT || value.completed.length > 200
      || value.completed.some(id => typeof id !== 'string')) throw new Error('팩토리 순위 전송 대기 기록을 읽지 못했습니다.')
    return { pending: value.pending.map(validateFactoryRankingSubmission), completed: value.completed }
  }
  const write = value => storage.setItem(key, JSON.stringify(value))
  return {
    enqueue(report) {
      if (!current()) return false
      const validated = validateFactoryRankingSubmission(report)
      const value = read()
      if (value.completed.includes(validated.runId) || value.pending.some(entry => entry.runId === validated.runId)) return true
      if (value.pending.length >= FACTORY_RANKING_PENDING_LIMIT) throw new Error('전송 대기 중인 팩토리 기록이 가득 찼습니다. 순위에서 다시 시도해주세요.')
      write({ ...value, pending: [...value.pending, clone(validated)] })
      return true
    },
    flush() {
      if (!current()) return Promise.resolve()
      if (running) return running
      running = (async () => {
        while (current()) {
          const report = read().pending[0]
          if (!report) return
          const result = normalizeFactoryRankingSnapshot(await send(report, controller.signal))
          if (!current()) return
          const latest = read()
          write({ pending: latest.pending.filter(entry => entry.runId !== report.runId),
            completed: [...latest.completed.filter(id => id !== report.runId), report.runId].slice(-200) })
          onSnapshot(result)
        }
      })().finally(() => { running = null })
      return running
    },
    pendingCount() { return read().pending.length },
    stop() { stopped = true; controller.abort() },
  }
}

// Guest rankings stay on this browser and are explicitly labelled local. Keep
// every local user's personal best so their own record survives falling outside
// the displayed top ten. The same comparison rules are used by the server.
export function createLocalFactoryRankingClient({ uid, trainerName, nickname, isGuest = false, storage, now = Date.now, mode = FACTORY_DEFAULT_MODE }) {
  uidKey(uid)
  const boardMode = getFactoryMode(mode).id
  // One browser store holds every mode, so a record carries the mode it was set
  // in and each board reads only its own. An entry saved before the split has
  // no mode and belongs to the standard board.
  const id = boardMode === FACTORY_DEFAULT_MODE ? `local:${uidKey(uid)}` : `local:${boardMode}:${uidKey(uid)}`
  const entryMode = entry => getFactoryMode(entry?.mode).id
  const readAll = () => {
    const entries = JSON.parse(storage.getItem(FACTORY_LOCAL_RANKINGS_KEY) ?? '[]')
    if (!Array.isArray(entries)) throw new Error('이 브라우저에 저장된 팩토리 순위를 읽지 못했습니다.')
    for (const entry of entries) normalizeFactoryRankingSnapshot({ entries: [entry], ownBest: null })
    return entries
  }
  const readEntries = () => readAll().filter(entry => entryMode(entry) === boardMode)
  const snapshot = entries => ({ entries: sortFactoryRankingEntries(entries), ownBest: entries.find(entry => entry.id === id) ?? null })
  return {
    async read() { return normalizeFactoryRankingSnapshot(snapshot(readEntries())) },
    async report(report) {
      const validated = validateFactoryRankingSubmission(report)
      const all = readAll()
      const mine = all.filter(entry => entryMode(entry) === boardMode)
      const previous = mine.find(entry => entry.id === id) ?? null
      const candidate = { id, runId: validated.runId, trainerName: maskRankedTrainerName(trainerName, isGuest, nickname),
        floor: validated.floor, wins: validated.wins, party: clone(validated.party), recordedAt: now(), mode: validated.mode }
      const best = chooseFactoryPersonalBest(previous, candidate)
      if (best === previous) return normalizeFactoryRankingSnapshot(snapshot(mine))
      const next = [...all.filter(entry => entry.id !== id), best]
      storage.setItem(FACTORY_LOCAL_RANKINGS_KEY, JSON.stringify(next))
      return normalizeFactoryRankingSnapshot(snapshot(next.filter(entry => entryMode(entry) === boardMode)))
    },
  }
}

// This testable session owns asynchronous lifetimes. The React hook only chooses
// account/source and renders callbacks, so a late response can never overwrite
// a different account's leaderboard or remove its pending reports.
export function createFactoryRankingSession({ uid, storage, client, scope = 'global', mode = FACTORY_DEFAULT_MODE,
  isCurrent = () => true,
  onSnapshot = () => {}, onLoading = () => {}, onError = () => {}, onRecordError = () => {} }) {
  let stopped = false
  let refreshing = null
  let revision = 0
  let unsavedRun = null
  const controller = new AbortController()
  const current = () => !stopped && isCurrent()
  const accept = snapshot => {
    if (!current()) return
    revision++
    onSnapshot(normalizeFactoryRankingSnapshot(snapshot))
  }
  const outbox = createFactoryRankingOutbox({ uid, storage, scope, mode, isCurrent: current,
    send: (report, signal) => client.report(report, signal), onSnapshot: accept })
  const flush = async () => {
    if (!current()) return false
    try {
      await outbox.flush()
      if (current() && !unsavedRun) onRecordError('')
      return current()
    } catch (failure) {
      if (current()) onRecordError(`팩토리 기록은 전송 대기 중입니다. 다시 시도하면 이어서 반영합니다. ${failure.message}`)
      return false
    }
  }
  const refresh = () => {
    if (!current()) return Promise.resolve()
    if (refreshing) return refreshing
    refreshing = (async () => {
      onLoading(true)
      try {
        await flush()
        if (!current()) return
        const before = revision
        const snapshot = await client.read(controller.signal)
        if (current()) {
          if (before === revision) accept(snapshot)
          onError('')
        }
      } catch (failure) {
        if (current()) onError(`팩토리 순위를 불러오지 못했습니다. ${failure.message}`)
      } finally {
        if (current()) onLoading(false)
        refreshing = null
      }
    })()
    return refreshing
  }
  const recordRun = run => {
    if (!current()) return false
    try {
      const recorded = outbox.enqueue(createFactoryRankingSubmission(run))
      if (recorded) { unsavedRun = null; onRecordError(''); void flush() }
      return recorded
    } catch (failure) {
      unsavedRun = run
      if (current()) onRecordError(`팩토리 기록을 저장하지 못했습니다. ${failure.message}`)
      return false
    }
  }
  return {
    flush, refresh, recordRun,
    async retry() {
      if (unsavedRun && !recordRun(unsavedRun)) return
      await refresh()
    },
    stop() { stopped = true; controller.abort(); outbox.stop() },
  }
}
