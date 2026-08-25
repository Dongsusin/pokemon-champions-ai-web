import {
  ChevronRight,
  Clock3,
  LoaderCircle,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
  UserRound,
} from 'lucide-react'

function GoogleMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.92h5.38a4.6 4.6 0 0 1-2 3.02v2.54h3.24c1.9-1.75 2.98-4.33 2.98-7.41Z" />
      <path fill="#34A853" d="M12 22c2.7 0 4.98-.9 6.63-2.36l-3.24-2.54c-.9.6-2.05.96-3.39.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.62A10 10 0 0 0 12 22Z" />
      <path fill="#FBBC05" d="M6.39 13.93A6 6 0 0 1 6.08 12c0-.67.11-1.32.31-1.93V7.45H3.04A10 10 0 0 0 2 12c0 1.61.38 3.14 1.04 4.55l3.35-2.62Z" />
      <path fill="#EA4335" d="M12 5.94c1.47 0 2.79.5 3.82 1.5l2.88-2.88A9.66 9.66 0 0 0 12 2a10 10 0 0 0-8.96 5.45l3.35 2.62C7.18 7.7 9.39 5.94 12 5.94Z" />
    </svg>
  )
}

export function AuthLoadingScreen() {
  return (
    <main className="auth-shell auth-loading-screen" aria-label="로그인 상태 확인 중">
      <div className="auth-ambient auth-ambient-one" aria-hidden="true" />
      <div className="auth-ambient auth-ambient-two" aria-hidden="true" />
      <div className="auth-loading-emblem">
        <img src="/assets/brand/champions-arena-emblem.png" alt="" />
        <LoaderCircle className="auth-loading-spinner" size={34} aria-hidden="true" />
      </div>
    </main>
  )
}

function LoginScreen({
  configured,
  busy,
  error,
  missingConfiguration,
  autoLogin,
  onAutoLoginChange,
  onGoogleSignIn,
  onGuestSignIn,
}) {
  return (
    <main className="auth-shell">
      <div className="auth-ambient auth-ambient-one" aria-hidden="true" />
      <div className="auth-ambient auth-ambient-two" aria-hidden="true" />

      <header className="auth-brand" aria-label="Pokémon Champions Arena">
        <img src="/assets/brand/champions-arena-emblem.png" alt="" aria-hidden="true" />
        <span>
          <small>POKÉMON</small>
          <strong>CHAMPIONS ARENA</strong>
        </span>
      </header>

      <section className="auth-login-card" aria-labelledby="auth-login-title">
        <span className="auth-card-glow" aria-hidden="true" />
        <div className="auth-login-emblem">
          <Sparkles size={28} aria-hidden="true" />
        </div>
        <div className="auth-login-heading">
          <span>TRAINER ACCESS</span>
          <h1 id="auth-login-title">챔피언스 아레나</h1>
          <p>Google 계정을 연결하거나 게스트 트레이너로 시작하세요.</p>
        </div>

        <div className="auth-login-actions">
          <button
            className="google-login-button"
            type="button"
            disabled={!configured || busy}
            aria-busy={busy}
            onClick={onGoogleSignIn}
          >
            <span className="google-login-mark"><GoogleMark /></span>
            <strong>{busy ? '로그인 처리 중' : 'Google 계정으로 계속'}</strong>
            {busy ? <LoaderCircle className="google-login-spinner" size={20} /> : <ChevronRight size={21} aria-hidden="true" />}
          </button>

          <button
            className="guest-login-button"
            type="button"
            disabled={busy}
            aria-busy={busy}
            onClick={onGuestSignIn}
          >
            <span className="guest-login-mark"><UserRound size={22} aria-hidden="true" /></span>
            <span>
              <strong>{busy ? '로그인 처리 중' : '게스트로 시작'}</strong>
              <small>이 PC 브라우저에만 임시 저장</small>
            </span>
            <ChevronRight size={21} aria-hidden="true" />
          </button>
        </div>

        <div className="auth-auto-login-row">
          <span className="auth-auto-login-copy">
            <Clock3 size={18} aria-hidden="true" />
            <span>
              <strong>자동 로그인</strong>
              <small>다음 방문에도 현재 계정을 유지합니다.</small>
            </span>
          </span>
          <button
            className={autoLogin ? 'enabled' : ''}
            type="button"
            role="switch"
            aria-checked={autoLogin}
            disabled={busy}
            onClick={() => onAutoLoginChange(!autoLogin)}
          >
            <i aria-hidden="true" />
            <span>{autoLogin ? 'ON' : 'OFF'}</span>
          </button>
        </div>

        {!configured ? (
          <div className="auth-setup-message" role="alert">
            <LockKeyhole size={17} aria-hidden="true" />
            <span>
              <strong>Google 로그인에 Firebase 연결 설정이 필요합니다.</strong>
              <small>{missingConfiguration.join(', ')}</small>
            </span>
          </div>
        ) : error ? (
          <div className="auth-error-message" role="alert">{error}</div>
        ) : null}

        <footer className="auth-login-footer">
          <ShieldCheck size={16} aria-hidden="true" />
          <span>Google은 Firebase 연결 · 게스트는 이 PC에만 저장</span>
        </footer>
      </section>
    </main>
  )
}

export default LoginScreen
