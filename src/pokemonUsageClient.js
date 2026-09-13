import { createRankedClient, isRankedLocalTest, rankedApiUrl } from './rankedClient'

const env = import.meta.env ?? {}
const loopback = host => ['localhost', '127.0.0.1', '[::1]', '::1'].includes(host)
export const isPokemonUsageDemo = Boolean(env.DEV && env.VITE_POKEMON_USAGE_DEMO === 'true'
  && isRankedLocalTest && typeof window !== 'undefined' && loopback(window.location.hostname)
  && loopback(new URL(rankedApiUrl).hostname))
// The existing demo flag gates the offline test app, not synthetic statistics.
// Only the automated fixture runner opts into seeded data and its demo label.
export const isPokemonUsageSeededTest = isPokemonUsageDemo && env.VITE_POKEMON_USAGE_SEEDED_TEST === 'true'
export const pokemonUsageSource = isPokemonUsageSeededTest ? 'demo' : isPokemonUsageDemo ? 'local' : 'live'
export const isPokemonUsageEnabled = env.VITE_POKEMON_USAGE_ENABLED === 'true'

export function createPokemonUsageClient(getIdToken) {
  return createRankedClient(isPokemonUsageDemo ? { localTestIdentity: 'alice' } : { getIdToken })
}

// A report is saved before transmission. The server's permanent battle receipt
// makes a retry after an interrupted response safe, including after a reload.
export function createUsageOutbox({ uid, storage, send, onSnapshot = () => {}, keyPrefix = 'champions-usage-outbox-v1' }) {
  const key = `${keyPrefix}:${uid}`
  let running = null
  let stopped = false
  const controller = new AbortController()
  const read = () => {
    const entries = JSON.parse(storage.getItem(key) ?? '[]')
    if (!Array.isArray(entries)) throw new Error('사용률 전송 대기 기록을 읽지 못했습니다.')
    return entries
  }
  const write = entries => storage.setItem(key, JSON.stringify(entries))
  const api = {
    enqueue(report) {
      if (stopped) return false
      const entries = read()
      if (entries.some(entry => entry.battleId === report.battleId)) return true
      if (entries.length >= 200) throw new Error('사용률 전송 대기 기록이 가득 찼습니다. 연결 후 다시 시도해주세요.')
      const selected = { battleId: report.battleId, format: report.format, speciesIds: [...report.speciesIds] }
      if (report.team !== undefined) selected.team = report.team.map(member => ({ speciesId: member.speciesId, heldItemId: member.heldItemId }))
      write([...entries, selected])
      return true
    },
    flush() {
      if (stopped) return Promise.resolve()
      if (running) return running
      running = (async () => {
        while (!stopped) {
          const report = read()[0]
          if (!report) return
          const result = await send(report, controller.signal)
          if (stopped) return
          // Re-read so a newly queued battle is not lost while a request waits.
          write(read().filter(entry => entry.battleId !== report.battleId))
          onSnapshot(result.usage)
        }
      })().finally(() => { running = null })
      return running
    },
    stop() { stopped = true; controller.abort() },
  }
  return api
}
