import { useCallback, useMemo, useState } from 'react'
import { createEmptyUsageSnapshot } from './data/pokemonUsage.js'
import { gameStorage } from './local/gameStorage.js'
import { createLocalUsageStore } from './local/localUsage.js'

export default function usePokemonUsage() {
  const store = useMemo(() => createLocalUsageStore(gameStorage), [])
  const initial = useMemo(() => {
    try { return { snapshot: store.read(), error: '' } }
    catch (failure) { return { snapshot: { ...createEmptyUsageSnapshot(), source: 'local' }, error: failure.message } }
  }, [store])
  const [error, setError] = useState(initial.error)
  const [snapshot, setSnapshot] = useState(initial.snapshot)
  const refresh = useCallback(async () => {
    try { setSnapshot(store.read()); setError('') } catch (failure) { setError(failure.message) }
  }, [store])
  const record = useCallback((report, mode) => {
    try { setSnapshot(store.record(report, mode)); setError(''); return true }
    catch (failure) { setError(`개인 기록을 저장하지 못했습니다. ${failure.message}`); return false }
  }, [store])
  const recordAiBattle = useCallback(report => record(report, 'ai'), [record])
  const recordRankedBattle = useCallback(report => record(report, 'ranked'), [record])
  return { snapshot, loading: false, error, refresh, recordAiBattle, recordRankedBattle }
}
