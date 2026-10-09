// Passive counters can age; match deadlines and account leases cannot.
export const QUEUE_COUNT_POLL_MS = 60_000

export function chatPollDelay(expanded, failures = 0) {
  const interval = expanded ? 8_000 : 120_000
  return Math.min(300_000, interval * 2 ** Math.min(failures, 4))
}

export function rankedPollDelay(snapshot) {
  return snapshot?.queue || (snapshot?.match && snapshot.match.phase !== 'finished') ? 1500 : 60_000
}

export function roomPollDelay(snapshot, busy = false) {
  if (busy) return 500
  if (snapshot?.room?.phase === 'active' || snapshot?.match) return 1500
  return snapshot?.room || snapshot?.queue ? 5000 : 60_000
}
