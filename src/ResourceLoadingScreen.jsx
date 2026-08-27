import { Database, LoaderCircle, RefreshCw, ShieldCheck } from 'lucide-react'

function formatMegabytes(bytes) {
  return `${(Math.max(0, Number(bytes) || 0) / (1024 * 1024)).toFixed(1)} MB`
}

function ResourceLoadingScreen({ state }) {
  const isError = state.status === 'error'

  return (
    <main className="auth-shell resource-loading-screen" aria-live="polite">
      <div className="auth-ambient auth-ambient-one" aria-hidden="true" />
      <div className="auth-ambient auth-ambient-two" aria-hidden="true" />

      <header className="auth-brand resource-loading-brand" aria-label="Pokémon Champions Arena">
        <img src="/assets/brand/champions-arena-emblem.png" alt="" aria-hidden="true" />
        <span>
          <small>POKÉMON</small>
          <strong>CHAMPIONS ARENA</strong>
        </span>
      </header>

      <section className={`resource-loading-card${isError ? ' has-error' : ''}`}>
        <span className="resource-loading-glow" aria-hidden="true" />
        <div className="resource-loading-logo" aria-hidden="true">
          <img src="/assets/brand/champions-arena-emblem.png" alt="" />
          {!isError && <LoaderCircle size={30} />}
        </div>

        <div className="resource-loading-heading">
          <span>{isError ? 'RESOURCE CHECK FAILED' : 'BATTLE SYSTEM INITIALIZING'}</span>
          <h1>{isError ? '리소스 준비 오류' : '게임 리소스 준비 중'}</h1>
          <p>{isError ? state.error : state.currentGroupLabel}</p>
        </div>

        {!isError ? (
          <>
            <div className="resource-loading-progress" aria-label={`리소스 준비 ${state.percent}%`}>
              <span style={{ width: `${state.percent}%` }} />
            </div>
            <div className="resource-loading-metrics">
              <strong>{state.percent}%</strong>
              <span>{state.loaded.toLocaleString()} / {state.total.toLocaleString()}</span>
            </div>
            <div className="resource-loading-status">
              <span><Database size={15} /> {formatMegabytes(state.loadedBytes)} / {formatMegabytes(state.totalBytes)}</span>
              <span><ShieldCheck size={15} /> 캐시 {state.cached.toLocaleString()}</span>
            </div>
            <small className="resource-loading-note">
              첫 실행에서 배틀 이미지와 사운드를 저장합니다. 다음 접속부터 빠르게 시작됩니다.
            </small>
          </>
        ) : (
          <button className="resource-loading-retry" type="button" onClick={state.retry}>
            <RefreshCw size={18} /> 다시 준비하기
          </button>
        )}
      </section>
    </main>
  )
}

export default ResourceLoadingScreen
