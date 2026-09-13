import { createServer } from 'vite'
import { startRankedDevServer } from './rankedDevServer.mjs'

if (process.env.NODE_ENV === 'production' || process.env.VERCEL) {
  throw new Error('The ranked test launcher is only available on a local development computer.')
}

// These flags belong to this process only. No .env.local or deployed setting is
// changed, and Vite builds do not enable the local test identities.
process.env.VITE_RANKED_ENABLED = 'true'
process.env.VITE_RANKED_LOCAL_TEST = 'true'
process.env.VITE_RANKED_API_URL = 'http://127.0.0.1:8787/api/ranked'

let backend
let frontend
let stopping = false
async function close() {
  if (stopping) return
  stopping = true
  await frontend?.close()
  await backend?.close()
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  close().then(() => process.exit(0), () => process.exit(1))
})

try {
  backend = await startRankedDevServer({ testAccounts: true, port: 8787 })
  frontend = await createServer({ mode: 'ranked-test', cacheDir: 'scripts/.cache/ranked-test/vite', server: { host: '127.0.0.1', port: 5185, strictPort: true } })
  await frontend.listen()
  console.log('\n레이팅 로컬 테스트: http://127.0.0.1:5185')
  console.log('두 브라우저 창에서 레이팅 배틀을 열고 Alice / Bob을 각각 선택하세요.')
  if (process.argv.includes('--rooms')) {
    console.log('대전방: 각 창에서 아래 주소 중 하나를 여세요. 최대 4명으로 로컬 대회를 진행합니다.')
    for (const identity of ['alice', 'bob', 'charlie', 'dave']) console.log(`http://127.0.0.1:5185/?roomPlayer=${identity}`)
  }
  console.log('테스트 데이터는 scripts/.cache/ranked-test/state.json에 저장됩니다. 종료: Ctrl+C\n')
} catch (error) {
  await close()
  console.error(error.message)
  process.exitCode = 1
}
