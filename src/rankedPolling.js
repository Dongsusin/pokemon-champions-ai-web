export const MIN_ACTIVE_POLL_INTERVAL = 3_500
export const HIDDEN_SESSION_INTERVAL = 12_000

export function hasRankedSession(snapshot) {
  return Boolean(snapshot?.queue || snapshot?.room
    || (snapshot?.match && snapshot.match.phase !== 'finished')
    || (snapshot?.spectator && snapshot.spectator.phase !== 'finished'))
}

// Polling never changes server deadlines. Hidden active sessions still renew
// their 30-second queue lease, including the 12-second request timeout.
// Explicit user actions still refresh immediately. Idle pages read once.
export function startRankedPolling({ refresh, getSnapshot, visibleInterval, keepPolling = () => hasRankedSession(getSnapshot()),
  documentRef = document, windowRef = window, navigatorRef = globalThis.navigator, setTimer = setTimeout, clearTimer = clearTimeout,
}) {
  let timer = null, running = false, stopped = false, failures = 0
  const clear = () => { if (timer !== null) clearTimer(timer); timer = null }
  const shouldPause = () => navigatorRef?.onLine === false
  const schedule = () => {
    clear()
    if (stopped || running || shouldPause() || !keepPolling()) return
    const base = documentRef.hidden ? HIDDEN_SESSION_INTERVAL : Math.max(MIN_ACTIVE_POLL_INTERVAL, visibleInterval())
    const maximum = HIDDEN_SESSION_INTERVAL
    const interval = failures ? Math.min(maximum, base * 2 ** Math.min(failures, 4)) : base
    timer = setTimer(() => { timer = null; void run() }, interval)
  }
  const run = async () => {
    clear()
    if (stopped || running || shouldPause()) return
    running = true
    // Passive read failures wait for manual retry; active sessions keep their lease.
    try {
      if (await refresh() !== false) { failures = 0 }
      else failures++
    } catch { failures++ }
    finally { running = false; schedule() }
  }
  const refreshNow = () => { void run() }
  const onVisibility = () => { if (keepPolling() && !documentRef.hidden) refreshNow(); else schedule() }
  const onOnline = () => { if (keepPolling()) refreshNow() }
  documentRef.addEventListener('visibilitychange', onVisibility)
  windowRef.addEventListener('online', onOnline)
  windowRef.addEventListener('offline', clear)
  refreshNow()
  return {
    refresh: refreshNow,
    stop() {
      stopped = true
      clear()
      documentRef.removeEventListener('visibilitychange', onVisibility)
      windowRef.removeEventListener('online', onOnline)
      windowRef.removeEventListener('offline', clear)
    },
  }
}
