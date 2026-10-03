import { useEffect, useState } from 'react'
import { HardDrive, LoaderCircle } from 'lucide-react'
import { getLocalSaveStatus } from './gameStorage.js'
import './localData.css'

export default function LocalSaveBadge({ onOpen }) {
  const [status, setStatus] = useState(getLocalSaveStatus)
  useEffect(() => {
    const changed = event => setStatus(event.detail)
    window.addEventListener('champions:local-save-status', changed)
    return () => window.removeEventListener('champions:local-save-status', changed)
  }, [])
  return <button type="button" className={`local-save-badge${status.error ? ' has-error' : ''}`} onClick={onOpen}
    aria-label="로컬 저장 관리" title={status.error || status.location}>
    {status.saving ? <LoaderCircle size={16} /> : <HardDrive size={16} />}
    <span role="status">{status.error ? '저장 오류' : status.saving || status.dirty ? '저장 중' : '로컬 저장'}</span>
  </button>
}
