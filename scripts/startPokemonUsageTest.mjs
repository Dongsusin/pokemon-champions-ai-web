import { createServer } from 'vite'
import { createFileRankedStore } from '../server/rankedStore.js'
import { assertUsageBucket, createDemoUsageSnapshot } from '../src/data/pokemonUsage.js'
import { startRankedDevServer } from './rankedDevServer.mjs'

if (process.env.NODE_ENV === 'production' || process.env.VERCEL) {
  throw new Error('Usage demo data is only available on an explicit local test server.')
}

// Process-local flags, never written to .env or to a cloud configuration.
process.env.VITE_POKEMON_USAGE_ENABLED = 'true'
process.env.VITE_POKEMON_USAGE_DEMO = 'true'
process.env.VITE_RANKED_ENABLED = 'true'
process.env.VITE_RANKED_LOCAL_TEST = 'true'
process.env.VITE_RANKED_API_URL = 'http://127.0.0.1:8788/api/ranked'

let frontend, backend, store, closing
async function close() {
  if (closing) return closing
  closing = (async () => { await frontend?.close(); if (backend) await backend.close(); else await store?.close() })()
  return closing
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  close().then(() => process.exit(0), () => process.exit(1))
})
try {
  store = await createFileRankedStore('scripts/.cache/pokemon-usage-test/state.json')
  await store.transaction(async tx => {
    const seeded = await tx.get('pokemonUsageDemo', 'seed-v1')
    const itemsSeeded = await tx.get('pokemonUsageDemo', 'items-v1')
    if (seeded && itemsSeeded) return
    for (const [key, bucket] of Object.entries(createDemoUsageSnapshot().buckets)) {
      const current = await tx.get('pokemonUsage', key)
      if (!current) tx.set('pokemonUsage', key, bucket)
      else if (seeded && !itemsSeeded && current.itemSamples === undefined && current.itemCounts === undefined
        && current.teamCount >= bucket.teamCount
        && Object.entries(bucket.counts).every(([id, count]) => (current.counts[id] ?? 0) >= count)) {
        // Enrich only the known synthetic seed. Existing played teams/counts
        // remain unchanged, and their historical items remain unknown.
        const enriched = { ...current, itemSamples: bucket.itemSamples, itemCounts: bucket.itemCounts }
        assertUsageBucket(enriched)
        tx.set('pokemonUsage', key, enriched)
      }
    }
    tx.set('pokemonUsageDemo', 'seed-v1', { seeded: true })
    tx.set('pokemonUsageDemo', 'items-v1', { seeded: true })
  })
  backend = await startRankedDevServer({ port: 8788, store, testAccounts: true, usageEnabled: true })
  frontend = await createServer({ mode: 'ranked-test', plugins: [{ name: 'usage-demo-offline-auth', enforce: 'pre',
    resolveId(source) { if (/\/auth\/firebaseClient(?:\.js)?$/.test(source)) return '\0usage-demo-auth' },
    load(id) { if (id === '\0usage-demo-auth') return 'export const firebaseAuth=null; export const firebaseDb=null; export const isFirebaseConfigured=false; export const missingFirebaseEnvironmentVariables=[];' },
  }], server: { host: '127.0.0.1', port: 5186, strictPort: true } })
  await frontend.listen()
  console.log('사용률 로컬 테스트: http://127.0.0.1:5186')
  console.log('업적 아래 포켓몬 사용률 → AI/레이팅 · 싱글/더블 TOP 100')
  console.log('각 분류에 임의 표본 298팀을 1회 생성했습니다. 플레이한 출전팀은 여기에 누적됩니다.')
  console.log('AI: 시작하기 → AI 대전 → 리그/토너먼트 참가 → 배틀 시작 후 사용률 확인')
  console.log('레이팅: 두 창에서 테스트 트레이너 A/B로 매칭 → 양쪽 선출 완료 후 집계 +2팀')
  console.log('운영 계정·서버는 사용하지 않습니다. 종료: Ctrl+C')
} catch (error) { await close(); console.error(error.message); process.exitCode = 1 }
