// Passive displays trade freshness for fewer authenticated server invocations.
// Queue leases, active battles and explicit player actions keep their own cadence.
export const RANKED_IDLE_POLL_MS = 60_000
export const ROOM_LOBBY_POLL_MS = 15_000
export const QUEUE_COUNTS_POLL_MS = 60_000
export function chatPollDelay({ expanded, unchanged = 0, failures = 0 }) {
  const normal = expanded ? Math.min(30_000, 4_000 * 2 ** Math.min(3, unchanged)) : 120_000
  return Math.min(120_000, normal * 2 ** Math.min(4, failures))
}
