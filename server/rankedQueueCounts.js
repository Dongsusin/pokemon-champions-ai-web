const CACHE_MS = 10_000
const validCount = value => Number.isSafeInteger(value) && value >= 0

// One reader is shared by every authenticated visitor on a warm server. Only
// aggregate numbers leave the store; viewing the hub never renews queue leases.
export function createRankedQueueCountsReader({ store, now = Date.now }) {
  let cached = null
  let expiresAt = 0
  let pending = null
  let failure = null
  let failedAt = 0

  async function aggregate(timestamp) {
    if (typeof store.countRankedQueue === 'function') return store.countRankedQueue(timestamp)
    // Local/file stores and the legacy Firestore adapter retain the same rules.
    return store.transaction(async tx => {
      const result = { single: 0, double: 0, nextExpiry: null }
      const queues = await tx.list('queue')
      for (const queue of queues) {
        if (!['single', 'double'].includes(queue.format) || !Number.isSafeInteger(queue.expiresAt)
          || queue.expiresAt <= timestamp || queue.uid !== queue.id || typeof queue.ticket !== 'string' || !queue.ticket) continue
        const player = await tx.get('players', queue.uid)
        if (!player || player.queueTicket !== queue.ticket || player.activeMatchId) continue
        result[queue.format] += 1
        result.nextExpiry = Math.min(result.nextExpiry ?? queue.expiresAt, queue.expiresAt)
      }
      return result
    })
  }

  return async function readQueueCounts() {
    const timestamp = now()
    if (cached && timestamp >= cached.updatedAt && timestamp < expiresAt) return { ...cached }
    if (failure && timestamp >= failedAt && timestamp < failedAt + CACHE_MS) throw failure
    if (!pending) {
      pending = aggregate(timestamp).then(result => {
        if (!validCount(result.single) || !validCount(result.double)
          || !validCount(result.single + result.double)) throw new Error('Invalid ranked queue aggregate')
        cached = { single: result.single, double: result.double, total: result.single + result.double, updatedAt: timestamp }
        failure = null
        // An idle waiting player must drop out when their lease expires even
        // when nobody joins/cancels and the ordinary cache TTL has not elapsed.
        expiresAt = Math.min(timestamp + CACHE_MS,
          Number.isSafeInteger(result.nextExpiry) && result.nextExpiry > timestamp ? result.nextExpiry : timestamp + CACHE_MS)
        return cached
      }).catch(error => {
        // Do not turn an outage into a fabricated zero or a request storm.
        failure = error
        failedAt = timestamp
        throw error
      }).finally(() => { pending = null })
    }
    return { ...await pending }
  }
}
