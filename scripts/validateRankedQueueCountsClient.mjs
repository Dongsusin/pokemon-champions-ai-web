import assert from 'node:assert/strict'
import { createRankedClient } from '../src/rankedClient.js'
import { readRankedQueueCounts } from '../src/rankedQueueCountData.js'

const counts = { single: 2, double: 3, total: 5, updatedAt: 1_800_000_000_000 }
assert.deepEqual(readRankedQueueCounts({ ...counts, players: ['private'] }), counts)
assert.deepEqual(readRankedQueueCounts({ single: 0, double: 0, total: 0, updatedAt: 0 }), { single: 0, double: 0, total: 0, updatedAt: 0 })
for (const invalid of [null, {}, { ...counts, total: 4 }, { ...counts, single: -1 }, { ...counts, double: '3' }, { ...counts, total: Infinity }, { ...counts, updatedAt: NaN }]) {
  assert.throws(() => readRankedQueueCounts(invalid))
}
let calls = 0, tokenCalls = 0
const client = createRankedClient({ apiUrl: 'https://example.com/api/ranked',
  getIdToken: async () => `fresh-token-${++tokenCalls}`,
  fetchImpl: async (url, options) => {
    calls++
    assert.equal(new URL(url).search, '?action=queueCounts')
    assert.equal(options.method, 'GET')
    assert.equal(options.body, undefined)
    assert.equal(options.headers.Authorization, `Bearer fresh-token-${calls}`)
    assert.equal(options.cache, 'no-store')
    return Response.json(counts)
  },
})
assert.deepEqual(readRankedQueueCounts(await client.request('queueCounts')), counts)
await client.request('queueCounts')
assert.equal(calls, 2)
const unauthenticated = createRankedClient({ getIdToken: async () => null, fetchImpl: async () => { throw new Error('Unexpected network request') } })
await assert.rejects(() => unauthenticated.request('queueCounts'), { code: 'authentication-required' })
const unavailable = createRankedClient({ getIdToken: async () => 'valid-token', fetchImpl: async () => Response.json({ error: { code: 'RANKED_UNAVAILABLE', message: 'Unavailable' } }, { status: 503 }) })
await assert.rejects(() => unavailable.request('queueCounts'), { code: 'RANKED_UNAVAILABLE' })
console.log('PASS ranked queue counts: valid zero, invalid/inconsistent responses, private field stripping, authenticated GET, fresh tokens, and errors')
