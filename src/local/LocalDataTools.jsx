import { useEffect, useRef, useState } from 'react'
import { Download, HardDrive, RefreshCw, Upload } from 'lucide-react'
import { flushLocalSave, getLocalSave, getLocalSaveStatus, replaceLocalSave } from './gameStorage.js'
import { MAX_SAVE_BYTES, parseBackup, PROFILE_KEY } from './saveSchema.js'
import { getGameHostWindow } from '../fixedGameViewport.js'
import './localData.css'

export default function LocalDataTools() {
  const [status, setStatus] = useState(getLocalSaveStatus)
  const [pendingImport, setPendingImport] = useState(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const input = useRef(null)
  useEffect(() => {
    const changed = event => setStatus(event.detail)
    window.addEventListener('champions:local-save-status', changed)
    return () => window.removeEventListener('champions:local-save-status', changed)
  }, [])
  async function run(action) {
    if (busy) return
    setBusy(true); setError(''); setMessage('')
    try { await action() } catch (failure) { setError(failure.message) }
    finally { setBusy(false) }
  }
  async function exportSave() {
    await flushLocalSave()
    const blob = new Blob([JSON.stringify(getLocalSave(), null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `champions-arena-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 30_000)
    setMessage('백업 파일을 내보냈습니다. 다른 기기나 런처에서 1회 가져올 수 있습니다.')
  }
  async function chooseFile(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setPendingImport(null)
    await run(async () => {
      if (file.size > MAX_SAVE_BYTES) throw new Error('백업 파일의 최대 크기(32 MiB)를 초과했습니다.')
      const save = parseBackup(await file.text())
      if (!save.values[PROFILE_KEY]) save.values[PROFILE_KEY] = getLocalSave().values[PROFILE_KEY]
      const collection = JSON.parse(save.values['champions-dex-v2'] ?? save.values['champions-box-v1'] ?? '[]')
      const teams = JSON.parse(save.values['champions-teams-v1'] ?? '{}')
      const wallet = JSON.parse(save.values['champions-achievements-v1'] ?? '{}')
      const ownedCount = collection.filter(pokemon => pokemon.directDrawCount === undefined || Number(pokemon.directDrawCount) > 0).length
      setPendingImport({ save, filename: file.name, pokemonCount: ownedCount,
        teamCount: teams.teams?.length ?? 0, vp: wallet.walletBalance ?? Number(save.values['champions-vp-v1'] ?? 0) })
    })
  }
  async function applyImport() {
    await replaceLocalSave(pendingImport.save)
    // Restore React, wallet, team and factory state from the same new snapshot.
    getGameHostWindow().location.reload()
  }
  return <section className="local-data-tools" aria-label="로컬 저장 관리">
    <h3><HardDrive size={19} /> 로컬 저장 관리</h3>
    <p>포켓몬·팀·아이템·VP·업적·팩토리 진행·설정·개인 통계를 함께 저장합니다.</p>
    <dl><div><dt>저장 위치</dt><dd>{status.location}</dd></div><div><dt>저장 상태</dt>
      <dd role="status">{status.error ? '저장 실패 · 다시 저장해주세요' : status.dirty || status.saving ? '저장 중' : '저장 완료'}</dd></div>
      {status.updatedAt > 0 && <div><dt>마지막 저장</dt><dd>{new Date(status.updatedAt).toLocaleString('ko-KR')}</dd></div>}</dl>
    <div className="local-data-actions"><button type="button" disabled={busy} onClick={() => void run(exportSave)}><Download size={17} /> 백업 내보내기</button>
      <button type="button" disabled={busy} onClick={() => input.current?.click()}><Upload size={17} /> 데이터 1회 가져오기</button>
      <button type="button" disabled={busy} onClick={() => void run(async () => { await flushLocalSave(); setMessage('로컬 저장을 완료했습니다.') })}><RefreshCw size={17} /> 지금 저장</button></div>
    <input ref={input} className="local-backup-input" type="file" accept=".json,application/json" aria-label="게임 데이터 백업 파일" onChange={chooseFile} />
    <small>가져오기는 선택한 파일을 한 번 복원합니다. 이후 자동 동기화하지 않습니다. 서버에만 남아 있는 기록은 별도의 백업 파일이 필요합니다.</small>
    {pendingImport && <div className="local-import-preview" role="region" aria-label="가져올 데이터 확인">
      <strong>{pendingImport.filename}</strong><p>포켓몬 {pendingImport.pokemonCount}마리 · 팀 {pendingImport.teamCount}개 · {pendingImport.vp.toLocaleString()} VP</p>
      <p>현재 기록을 이 파일의 기록으로 교체합니다. 현재 기록은 로컬 저장소에 자동 백업됩니다. 필요하면 먼저 백업 파일을 내보내세요.</p>
      <div className="local-data-actions"><button type="button" disabled={busy} onClick={() => setPendingImport(null)}>취소</button>
        <button type="button" disabled={busy} onClick={() => void run(applyImport)}>이 데이터 가져오기</button></div></div>}
    {(error || status.error) && <p className="settings-account-error" role="alert">{error || status.error}</p>}
    {message && <p className="settings-nickname-notice" role="status">{message}</p>}
  </section>
}
