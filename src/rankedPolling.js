const HIDDEN_SESSION_INTERVAL = 5_000

export function hasRankedSession(snapshot) {
  return Boolean(snapshot?.queue || snapshot?.room
    || (snapshot?.match && snapshot.match.phase !== 'finished')
    || (snapshot?.spectator && snapshot.spectator.phase !== 'finished'))
}

// Polling never changes server deadlines. Hidden active sessions still renew
// their 30-second queue lease; an idle hidden lobby waits for visibility again.
export function startRankedPolling({ refresh, getSnapshot, visibleInterval,
  documentRef = document, windowRef = window, setTimer = setTimeout, clearTimer = clearTimeout,
}) {
  let timer = null, running = false, stopped = false, initialized = false
  const clear = () => { if (timer !== null) clearTimer(timer); timer = null }
  const shouldPause = () => initialized && documentRef.hidden && !hasRankedSession(getSnapshot())
  const schedule = () => {
    clear()
    if (stopped || running || shouldPause()) return
    timer = setTimer(() => { timer = null; void run() }, documentRef.hidden ? HIDDEN_SESSION_INTERVAL : visibleInterval())
  }
  const run = async () => {
    clear()
    if (stopped || running || shouldPause()) return
    running = true
    // A failed bootstrap cannot establish that the account has no active
    // queue. Keep its paced retry until a successful snapshot is available.
    try { if (await refresh() !== false) initialized = true }
    catch { /* Refresh callbacks report errors; preserve retries if one rejects. */ }
    finally { running = false; schedule() }
  }
  const refreshNow = () => { void run() }
  const onVisibility = () => { if (documentRef.hidden) schedule(); else refreshNow() }
  const onOnline = () => { if (!documentRef.hidden) refreshNow() }
  documentRef.addEventListener('visibilitychange', onVisibility)
  windowRef.addEventListener('online', onOnline)
  refreshNow()
  return {
    refresh: refreshNow,
    stop() {
      stopped = true
      clear()
      documentRef.removeEventListener('visibilitychange', onVisibility)
      windowRef.removeEventListener('online', onOnline)
    },
  }
}
