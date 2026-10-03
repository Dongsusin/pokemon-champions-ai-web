import { useState } from 'react'
import { ChevronRight, Clock3, HardDrive, LoaderCircle, RotateCw, ShieldCheck, Sparkles, UserRound } from 'lucide-react'

export function AuthLoadingScreen() {
  return <main className="auth-shell auth-loading-screen" aria-label="로컬 저장 기록 준비 중">
    <div className="auth-loading-emblem"><img src="/assets/brand/champions-arena-emblem.png" alt="" />
      <LoaderCircle className="auth-loading-spinner" size={34} aria-hidden="true" /></div>
  </main>
}
export function AccountDataErrorScreen({ message, busy, onRetry }) {
  return <main className="auth-shell"><section className="auth-login-card auth-data-error-card">
    <img className="auth-data-error-emblem" src="/assets/brand/champions-arena-emblem.png" alt="" />
    <h1>로컬 저장 기록을 준비하지 못했습니다</h1>
    <p className="auth-error-message" role="alert">{message}</p>
    <p>기존 기록은 보존했습니다. 저장 폴더와 권한을 확인한 뒤 다시 시도해주세요.</p>
    <button className="guest-login-button" type="button" disabled={busy} onClick={onRetry}><RotateCw size={20} /> 다시 불러오기</button>
  </section></main>
}
export default function LoginScreen({ busy, error, autoLogin, onAutoLoginChange, onGuestSignIn, savedProfile }) {
  const [name, setName] = useState('')
  const submit = event => { event.preventDefault(); void onGuestSignIn(name).catch(() => {}) }
  return <main className="auth-shell">
    <div className="auth-ambient auth-ambient-one" aria-hidden="true" /><div className="auth-ambient auth-ambient-two" aria-hidden="true" />
    <header className="auth-brand" aria-label="Pokémon Champions Arena"><img src="/assets/brand/champions-arena-emblem.png" alt="" />
      <span><small>POKÉMON</small><strong>CHAMPIONS ARENA</strong></span></header>
    <section className="auth-login-card" aria-labelledby="auth-login-title">
      <span className="auth-card-glow" aria-hidden="true" />
      <div className="auth-login-intro"><div className="auth-login-emblem"><Sparkles size={28} /></div>
        <div className="auth-login-heading"><span>LOCAL TRAINER</span><h1 id="auth-login-title">챔피언스 아레나</h1>
          <p>게스트 트레이너의 모든 진행 기록을 이 기기에 저장합니다.</p></div></div>
      <form className="auth-login-panel" onSubmit={submit}>
        {!savedProfile && <label className="local-trainer-name">트레이너 이름
          <input aria-label="트레이너 이름" placeholder="로컬 트레이너" value={name} maxLength={12} disabled={busy} onChange={event => setName(event.target.value)} /></label>}
        <div className="auth-login-actions"><button className="guest-login-button" type="submit" disabled={busy} aria-busy={busy}>
          <span className="guest-login-mark"><UserRound size={22} /></span><span>
            <strong>{busy ? '저장 기록 준비 중' : savedProfile ? `${savedProfile.nickname || savedProfile.displayName} · 이어서 플레이` : '게스트로 시작'}</strong>
            <small>구글 계정 없이 플레이 · 종료해도 기록 유지</small></span>
          {busy ? <LoaderCircle size={20} /> : <ChevronRight size={21} />}</button></div>
        <div className="auth-auto-login-row"><span className="auth-auto-login-copy"><Clock3 size={18} /><span><strong>자동으로 이어서 시작</strong><small>다음 실행에서 이 트레이너로 계속합니다.</small></span></span>
          <button className={autoLogin ? 'enabled' : ''} type="button" role="switch" aria-label="자동으로 이어서 시작" aria-checked={autoLogin} disabled={busy}
            onClick={() => { void onAutoLoginChange(!autoLogin).catch(() => {}) }}><span>{autoLogin ? 'ON' : 'OFF'}</span></button></div>
        {error && <p className="auth-error-message" role="alert">{error}</p>}
        <div className="auth-feature-list"><span><HardDrive size={16} /> 로컬 자동 저장</span><span><ShieldCheck size={16} /> 백업 파일로 기록 이동</span></div>
      </form>
    </section>
  </main>
}
