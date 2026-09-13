const MAX_SAMPLE_AGE_MS = 60_000

// This is a read-only view of the existing account heartbeat, not another
// presence connection. Never persist it or carry a count across accounts.
export function createOnlinePlayersStore({ setTimeoutImpl = globalThis.setTimeout.bind(globalThis),
  clearTimeoutImpl = globalThis.clearTimeout.bind(globalThis) } = {}) {
  let snapshot = null
  let timer = null
  const listeners = new Set()
  function emit() {
    for (const listener of listeners) {
      // A display subscriber must never interrupt lease renewal or login.
      try { listener() } catch {}
    }
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    update(userId, ownerId, sample) {
      clearTimeoutImpl(timer)
      const valid = Number.isSafeInteger(sample?.count) && sample.count >= 0
        && Number.isSafeInteger(sample.sampledAt) && sample.sampledAt > 0
        && Number.isFinite(sample.staleAfterMs) && sample.staleAfterMs > 0
        && sample.staleAfterMs <= MAX_SAMPLE_AGE_MS
      snapshot = { userId, ownerId, count: valid ? sample.count : null }
      if (valid) {
        const current = snapshot
        timer = setTimeoutImpl(() => {
          if (snapshot !== current) return
          snapshot = { userId, ownerId, count: null }
          emit()
        }, sample.staleAfterMs)
        timer?.unref?.()
      }
      emit()
    },
    clear(userId, ownerId) {
      if (snapshot?.userId !== userId || snapshot?.ownerId !== ownerId) return
      clearTimeoutImpl(timer)
      timer = null
      snapshot = null
      emit()
    },
  }
}

const store = createOnlinePlayersStore()
export const getOnlinePlayersSnapshot = store.getSnapshot
export const getServerOnlinePlayersSnapshot = () => null
export const subscribeOnlinePlayers = store.subscribe
export const updateOnlinePlayers = store.update
export const clearOnlinePlayers = store.clear
