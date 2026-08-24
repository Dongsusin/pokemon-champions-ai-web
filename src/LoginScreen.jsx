import { LoaderCircle, LockKeyhole, ShieldCheck, Sparkles } from 'lucide-react'

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

function LoginScreen({ configured, busy, error, missingConfiguration, onGoogleSignIn }) {
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
          <p>Google 계정으로 트레이너 데이터를 연결합니다.</p>
        </div>

        <button
          className="google-login-button"
          type="button"
          disabled={!configured || busy}
          onClick={onGoogleSignIn}
        >
          <span className="google-login-mark"><GoogleMark /></span>
          <strong>{busy ? 'Google 로그인 연결 중' : 'Google 계정으로 계속'}</strong>
          {busy ? <LoaderCircle className="google-login-spinner" size={20} /> : <span aria-hidden="true">›</span>}
        </button>

        {!configured ? (
          <div className="auth-setup-message" role="alert">
            <LockKeyhole size={17} aria-hidden="true" />
            <span>
              <strong>Firebase 연결 설정이 필요합니다.</strong>
              <small>{missingConfiguration.join(', ')}</small>
            </span>
          </div>
        ) : error ? (
          <div className="auth-error-message" role="alert">{error}</div>
        ) : null}

        <footer className="auth-login-footer">
          <ShieldCheck size={16} aria-hidden="true" />
          <span>Firebase Authentication 보안 연결</span>
        </footer>
      </section>
    </main>
  )
}

export default LoginScreen
