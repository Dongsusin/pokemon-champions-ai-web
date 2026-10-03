import { useCallback, useEffect, useState } from 'react'
import { flushLocalSave, getLocalSaveStatus } from '../local/gameStorage.js'

export function useAccountGameData() {
  const [status, setStatus] = useState(getLocalSaveStatus)
  useEffect(() => {
    const changed = event => setStatus(event.detail)
    window.addEventListener('champions:local-save-status', changed)
    return () => window.removeEventListener('champions:local-save-status', changed)
  }, [])
  const flush = useCallback(async () => {
    try { await flushLocalSave(); return true } catch { return false }
  }, [])
  return { ready: status.ready, syncError: status.error, flush,
    scheduleSave: () => {}, retry: flush }
}
