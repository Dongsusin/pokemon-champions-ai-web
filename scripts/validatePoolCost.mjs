import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createPostgresPool } from '../server/postgresStore.js'

class PoolFixture extends EventEmitter { constructor(options) { super(); this.options = options } }
const savedEnv = Object.fromEntries(['VERCEL', 'VERCEL_URL', 'VERCEL_REGION'].map(key => [key, process.env[key]]))
const contextKey = Symbol.for('@vercel/request-context')
const originalContext = globalThis[contextKey], originalTimer = globalThis.setTimeout
const waits = [], timers = []
try {
  process.env.VERCEL = '1'; process.env.VERCEL_URL = 'pool-cost.test'; process.env.VERCEL_REGION = 'icn1'
  globalThis[contextKey] = { get: () => ({ waitUntil: promise => waits.push(promise) }) }
  const pool = createPostgresPool({ connectionString: 'postgresql://test:unused@db.invalid/postgres', PoolClass: PoolFixture })
  globalThis.setTimeout = (callback, delay) => { timers.push({ callback, delay }); return 0 }
  pool.emit('release')
  globalThis.setTimeout = originalTimer
  assert.equal(waits.length, 1, 'The real Vercel adapter must still manage pool release')
  assert.equal(timers.length, 1)
  timers[0].callback(); await waits[0]
  assert(timers[0].delay <= 600, `Database cleanup holds the function for ${timers[0].delay}ms after release`)
  assert.equal(pool.options.max, 3)
  assert.equal(pool.options.ssl.rejectUnauthorized, true)
  console.log(JSON.stringify({ passed: true, cleanupHoldMs: timers[0].delay, connections: pool.options.max }))
} finally {
  globalThis.setTimeout = originalTimer
  if (originalContext === undefined) delete globalThis[contextKey]; else globalThis[contextKey] = originalContext
  for (const [key, value] of Object.entries(savedEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
}
