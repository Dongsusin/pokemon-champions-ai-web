import { useEffect, useRef, useState } from 'react'
import { AlertCircle, Clock3, LoaderCircle, RefreshCw, Swords, Trophy, UsersRound } from 'lucide-react'
import { RANKED_FORMATS, getRankedTier } from './data/rankedRules'
import './rankedLeaderboard.css'

const numberText = value => (Number.isFinite(value) ? value : 0).toLocaleString('ko-KR')
const emptyState = client => ({ client, data: null, loading: true, error: '' })

export default function RankedLeaderboard({ client, initialFormat = 'single', queued = false }) {
  const [format, setFormat] = useState(initialFormat === 'double' ? 'double' : 'single')
  const [refresh, setRefresh] = useState(0)
  const [requestState, setRequestState] = useState(() => emptyState(client))
  const headingRef = useRef(null)
  const state = requestState.client === client ? requestState : emptyState(client)
  const currentFormat = RANKED_FORMATS.find(entry => entry.id === format)
  const board = state.data?.boards?.[format]
  const entries = (board?.entries ?? []).slice(0, 10)
  const updatedAt = Number.isFinite(state.data?.updatedAt) ? new Date(state.data.updatedAt) : null

  useEffect(() => { headingRef.current?.focus({ preventScroll: true }) }, [])
  useEffect(() => {
    const controller = new AbortController()
    let active = true
    setRequestState(previous => ({ client, data: previous.client === client ? previous.data : null, loading: true, error: '' }))
    void client.request('rankedLeaderboard', {}, { signal: controller.signal }).then(data => {
      if (!active) return
      if (!RANKED_FORMATS.every(entry => Array.isArray(data?.boards?.[entry.id]?.entries))) {
        throw new Error('랭킹 정보를 읽지 못했습니다. 새로고침해 주세요.')
      }
      setRequestState({ client, data, loading: false, error: '' })
    }).catch(error => {
      if (active && error.name !== 'AbortError') {
        setRequestState(previous => ({ ...previous, client, loading: false, error: error.message || '랭킹을 불러오지 못했습니다. 새로고침해 주세요.' }))
      }
    })
    return () => { active = false; controller.abort() }
  }, [client, refresh])

  return <section className="ranked-leaderboard" aria-label="레이팅 TOP 10 랭킹">
    <header className="ranked-leaderboard-toolbar">
      <div className="ranked-leaderboard-title"><Trophy size={22} aria-hidden="true" /><h2 ref={headingRef} tabIndex={-1}>TOP 10</h2>
        <span><UsersRound size={13} aria-hidden="true" /> {numberText(board?.participantCount)}명 참가</span></div>
      <div className="ranked-leaderboard-controls">
        <div className="ranked-format-tabs" role="group" aria-label="랭킹 배틀 형식">{RANKED_FORMATS.map(entry => <button type="button" key={entry.id} aria-pressed={format === entry.id} onClick={() => setFormat(entry.id)}><Swords size={15} aria-hidden="true" />{entry.label}</button>)}</div>
        <button type="button" className="ranked-leaderboard-refresh" aria-label="랭킹 새로고침" title="랭킹 새로고침" disabled={state.loading} onClick={() => setRefresh(value => value + 1)}><RefreshCw className={state.loading ? 'ranked-spin' : undefined} size={18} /></button>
      </div>
    </header>
    {queued && <p className="ranked-leaderboard-queue" role="status"><LoaderCircle className="ranked-spin" size={14} /> 매칭 진행 중 · 상대를 찾으면 선출 화면으로 이동합니다.</p>}
    {state.error && <div className="ranked-leaderboard-error" role="alert"><AlertCircle size={17} /><span>{state.error}{state.data && ' 마지막으로 불러온 순위를 표시합니다.'}</span></div>}
    <div className="ranked-leaderboard-content" aria-busy={state.loading}>
      {!state.data ? <div className="ranked-leaderboard-empty" role="status">{state.loading ? <><LoaderCircle className="ranked-spin" size={30} /><strong>랭킹을 불러오고 있습니다</strong></> : <><Trophy size={32} /><strong>랭킹을 불러오지 못했습니다</strong><p>상단의 새로고침 버튼으로 다시 시도해 주세요.</p></>}</div>
        : !entries.length ? <div className="ranked-leaderboard-empty" role="status"><Trophy size={32} /><strong>아직 완료된 대전이 없습니다</strong><p>{currentFormat.label}에 참가해 첫 순위에 도전하세요.</p></div>
          : <div className="ranked-leaderboard-scroll" tabIndex={0} role="region" aria-label={`${currentFormat.label} 순위 목록`}>
            <table className="ranked-leaderboard-table" aria-label={`${currentFormat.label} TOP 10 랭킹`}>
              <colgroup><col className="ranked-leaderboard-col-rank" /><col className="ranked-leaderboard-col-trainer" /><col className="ranked-leaderboard-col-tier" /><col className="ranked-leaderboard-col-score" /><col className="ranked-leaderboard-col-record" /></colgroup>
              <thead><tr><th scope="col">순위</th><th scope="col">트레이너</th><th scope="col">등급</th><th scope="col">점수</th><th scope="col">승 · 패 · 무</th></tr></thead>
              <tbody>{entries.map((entry, index) => {
                const tier = getRankedTier(entry.points)
                const rank = index + 1
                return <tr className={`ranked-leaderboard-row${entry.isOwn ? ' is-own' : ''}`} key={rank} data-rank={rank} style={{ '--rank-color': tier.color }}>
                  <td><span className={`ranked-leaderboard-position position-${rank}`}>{rank <= 3 && <Trophy size={14} aria-hidden="true" />}{String(rank).padStart(2, '0')}</span></td>
                  <th scope="row"><span className="ranked-leaderboard-trainer"><strong title={entry.trainerName}>{entry.trainerName}</strong>{entry.isOwn && <small>나</small>}</span></th>
                  <td><span className="ranked-leaderboard-tier"><i aria-hidden="true" />{tier.label}</span></td>
                  <td><span className="ranked-leaderboard-score"><strong>{numberText(tier.id === 'masterball' ? entry.rating : entry.points)}</strong><small>{tier.id === 'masterball' ? '레이팅' : 'RP'}</small></span></td>
                  <td><span className="ranked-leaderboard-record" aria-label={`${numberText(entry.wins)}승 ${numberText(entry.losses)}패 ${numberText(entry.draws)}무`}><b>{numberText(entry.wins)}</b><i>·</i>{numberText(entry.losses)}<i>·</i>{numberText(entry.draws)}</span></td>
                </tr>
              })}</tbody>
            </table>
          </div>}
    </div>
    <footer className="ranked-leaderboard-footer"><p>완료된 대전 기록으로 집계합니다. 등급·RP 순이며, 마스터볼은 레이팅 순입니다.<span>동점이면 나머지 점수, 승수 순으로 정렬합니다.</span></p>
      <span className="ranked-leaderboard-updated"><Clock3 size={12} aria-hidden="true" />{state.loading ? '갱신 중' : updatedAt ? `${updatedAt.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 기준` : '기록 확인 대기'}</span></footer>
  </section>
}
