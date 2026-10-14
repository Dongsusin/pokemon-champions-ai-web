const HIDDEN_SESSION_INTERVAL = 5_000

export function hasRankedSession(snapshot) {
  return Boolean(snapshot?.queue || snapshot?.room
    || (snapshot?.match && snapshot.match.phase !== 'finished')
    || (snapshot?.spectator && snapshot.spectator.phase !== 'finished'))
}

// Polling never changes server deadlines. Hidden active sessions still renew
// their 30-second queue lease; an idle hidden lobby waits for visibility again.
export function startRankedPolling({ refresh, getSnapshot, visibleInterval,
  documentRef = document, windowRef = window, navigatorRef = globalThis.navigator, setTimer = setTimeout, clearTimer = clearTimeout,
}) {
  let timer = null, running = false, stopped = false, initialized = false, failures = 0
  const clear = () => { if (timer !== null) clearTimer(timer); timer = null }
  const shouldPause = () => navigatorRef?.onLine === false || (initialized && documentRef.hidden && !hasRankedSession(getSnapshot()))
  const schedule = () => {
    clear()
    if (stopped || running || shouldPause()) return
    const base = documentRef.hidden ? HIDDEN_SESSION_INTERVAL : visibleInterval()
    const maximum = !initialized || hasRankedSession(getSnapshot()) ? HIDDEN_SESSION_INTERVAL : 120_000
    const interval = failures ? Math.min(maximum, base * 2 ** Math.min(failures, 4)) : base
    timer = setTimer(() => { timer = null; void run() }, interval)
  }
  const run = async () => {
    clear()
    if (stopped || running || shouldPause()) return
    running = true
    // A failed bootstrap cannot establish that the account has no active
    // queue. Keep its paced retry until a successful snapshot is available.
    try {
      if (await refresh() !== false) { initialized = true; failures = 0 }
      else failures++
    } catch { failures++ }
    finally { running = false; schedule() }
  }
  const refreshNow = () => { void run() }
  const onVisibility = () => { if (documentRef.hidden) schedule(); else refreshNow() }
  const onOnline = () => { refreshNow() }
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
