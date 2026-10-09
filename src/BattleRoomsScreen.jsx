import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, ChevronRight, Clock3, Crown, Eye, Flag, LoaderCircle, LockKeyhole, Plus, RefreshCw, Shield, Swords, Trophy, UsersRound, Wifi, WifiOff, X } from 'lucide-react'
import BattleScreen from './BattleScreen'
import RankedTeamRoster from './RankedTeamRoster'
import SpriteImage from './SpriteImage'
import { firebaseAuth } from './auth/firebaseClient'
import { RANKED_FORMATS } from './data/rankedRules'
import { maskRankedMatch } from './data/rankedPrivacy'
import { BATTLE_TEAM_SIZE, normalizeSavedTeamState } from './data/teamData'
import { getSpeciesProfile } from './data/trainingData'
import { createRankedClient, createRankedRequestId, isRankedEnabled } from './rankedClient'
import { startRankedPolling } from './rankedPolling'
import { roomPollDelay } from './requestCadence.js'
import { knownMatchRevision, mergeRankedMatchSnapshot } from './rankedSnapshot'
import './ranked.css'
import './battleRooms.css'

const EMPTY = { rooms: [], room: null, roomResult: null, match: null, spectator: null }
const modeName = mode => mode === 'league' ? '리그전' : '토너먼트'
const clockText = seconds => `${Math.floor(Math.max(0, seconds) / 60)}:${String(Math.max(0, seconds) % 60).padStart(2, '0')}`
const timeValue = value => typeof value === 'number' ? value : Date.parse(value)
const resultNames = { win: '승리', loss: '패배', draw: '무승부' }
const closeReasons = { completed: '모든 경기가 끝나 방이 자동으로 삭제되었습니다.', 'idle-timeout': '생성 후 10분 동안 시작하지 않아 방이 삭제되었습니다.', 'full-timeout': '4명이 모인 뒤 1분 동안 시작하지 않아 방이 삭제되었습니다.', 'all-withdrawn': '참가자가 모두 나가 방이 삭제되었습니다.' }

function Dialog({ title, label, children, onClose, busy = false }) {
  const ref = useRef(null)
  const closeRef = useRef(onClose)
  const busyRef = useRef(busy)
  closeRef.current = onClose
  busyRef.current = busy
  useEffect(() => {
    const previous = document.activeElement
    const root = ref.current
    const focusables = () => [...root.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]')]
    ;(root.querySelector('input') ?? focusables()[0] ?? root).focus()
    const keydown = event => {
      if (event.key === 'Escape' && !busyRef.current) { event.preventDefault(); closeRef.current?.() }
      if (event.key !== 'Tab') return
      const targets = focusables()
      if (!targets.length) { event.preventDefault(); root.focus(); return }
      if (event.shiftKey && (document.activeElement === targets[0] || document.activeElement === root)) { event.preventDefault(); targets.at(-1).focus() }
      else if (!event.shiftKey && document.activeElement === targets.at(-1)) { event.preventDefault(); targets[0].focus() }
    }
    root.addEventListener('keydown', keydown)
    return () => { root.removeEventListener('keydown', keydown); if (previous?.isConnected) previous.focus() }
  }, [])
  return <div className="rooms-dialog-backdrop" onClick={event => { if (!busy && event.target === event.currentTarget) onClose?.() }}>
    <section ref={ref} className="rooms-dialog" role="dialog" aria-modal="true" aria-label={label ?? title} tabIndex={-1}>
      <header><h2>{title}</h2><button type="button" className="rooms-icon-button" aria-label="닫기" disabled={busy} onClick={onClose}><X size={19} /></button></header>
      {children}
    </section>
  </div>
}

function SelectionCard({ pokemon, index, order = 0, disabled, onClick }) {
  const species = getSpeciesProfile(pokemon.speciesId ?? pokemon.id)
  const name = pokemon.name ?? species?.name ?? '포켓몬'
  const children = <><span className="ranked-pokemon-number">{order ? <><Check size={12} /> {order}번 출전</> : String(index + 1).padStart(2, '0')}</span>
    <SpriteImage src={pokemon.icon ?? species?.icon} fallbackSrc={pokemon.iconFallback ?? species?.iconFallback} alt="" draggable="false" />
    <strong>{name}</strong><small>{(pokemon.types ?? species?.types ?? []).join(' · ')}</small></>
  return onClick ? <button className={`ranked-pokemon-card${order ? ' selected' : ''}`} type="button" disabled={disabled} aria-label={`${name}, ${order ? `${order}번 출전 선택됨` : '출전 선택'}`} aria-pressed={Boolean(order)} onClick={onClick}>{children}</button>
    : <div className="ranked-pokemon-card">{children}</div>
}

function Standings({ rows = [], userId }) {
  return <div className="rooms-standings" role="table" aria-label="대회 순위">
    <div className="rooms-standing-head" role="row"><span role="columnheader">순위 / 트레이너</span><span role="columnheader">승 · 무 · 패</span><span role="columnheader">승점</span></div>
    {rows.map((row, index) => <div key={row.uid} className={row.uid === userId ? 'is-me' : ''} role="row">
      <span role="cell"><b>{row.rank ?? index + 1}</b><strong>{row.name}</strong>{row.uid === userId && <small>나</small>}{row.withdrawn && <small>이탈</small>}</span>
      <span role="cell">{row.wins ?? 0} · {row.draws ?? 0} · {row.losses ?? 0}</span><strong role="cell">{row.points ?? 0}</strong>
    </div>)}
  </div>
}

export default function BattleRoomsScreen({
  user, teams = [], boxPokemon = [], activeTeamId, onSelectTeam, onOpenBox, onBack, onBeforeJoin,
  soundEnabled = true, gameSettings = {}, playerGender = 'male', audioSettings = {},
  onToggleSound, onOpenSettings, onBattleActiveChange, client: suppliedClient, enabled = isRankedEnabled,
}) {
  const [snapshot, setSnapshot] = useState(EMPTY)
  const [busy, setBusy] = useState(false)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState('')
  const [refreshError, setRefreshError] = useState('')
  const [now, setNow] = useState(Date.now())
  const [serverOffset, setServerOffset] = useState(0)
  const [dialog, setDialog] = useState(null)
  const [title, setTitle] = useState('')
  const [mode, setMode] = useState('tournament')
  const [format, setFormat] = useState('single')
  const [password, setPassword] = useState('')
  const [selection, setSelection] = useState([])
  const [playedRevision, setPlayedRevision] = useState(null)
  const [returnSeconds, setReturnSeconds] = useState(null)
  const [spectateTarget, setSpectateTarget] = useState(null)
  const spectateRef = useRef(null)
  const snapshotRef = useRef(EMPTY)
  const operationRef = useRef(false)
  const generationRef = useRef(0)
  const mountedRef = useRef(false)
  const refreshRef = useRef(null)
  const match = snapshot.match
  const room = snapshot.room
  const canAuthenticate = Boolean(suppliedClient || (user?.uid && !user.isLocalGuest))
  const client = useMemo(() => suppliedClient ?? createRankedClient({ getIdToken: async () => {
    const current = firebaseAuth?.currentUser
    if (!current || current.uid !== user?.uid) return null
    const token = await current.getIdToken()
    return firebaseAuth?.currentUser?.uid === user?.uid ? token : null
  } }), [suppliedClient, user?.uid])
  const accept = useCallback(value => {
    if (Number.isFinite(value.serverTime)) setServerOffset(value.serverTime - Date.now())
    const previous = snapshotRef.current
    let next = { ...EMPTY, ...value, match: maskRankedMatch(value.match), spectator: maskRankedMatch(value.spectator) }
    next.match = mergeRankedMatchSnapshot(previous.match, next.match)
    const target = spectateRef.current
    const watchable = target && next.room?.phase === 'active' && !next.roomResult
      && !(next.match && next.match.phase !== 'finished')
      && next.room.matches?.some(entry => entry.id === target && entry.canSpectate && ['select', 'battle'].includes(entry.phase))
    if (!watchable || next.spectator?.id !== target || !['select', 'battle'].includes(next.spectator?.phase)) {
      next.spectator = null
      if (target) { spectateRef.current = null; setSpectateTarget(null) }
    } else if (previous.spectator?.id === next.spectator.id) {
      // Lightweight room polls omit an already received timeline. Keep it for
      // the current playback; BattleScreen uses timelineRevision to play once.
      if (previous.spectator.revision > next.spectator.revision) next.spectator = previous.spectator
      else if (previous.spectator.timelineRevision === next.spectator.timelineRevision
        && previous.spectator.timeline?.length && !next.spectator.timeline?.length) {
        next.spectator = { ...next.spectator, timeline: previous.spectator.timeline }
      }
    }
    snapshotRef.current = next
    setSnapshot(next)
    setConnected(true)
    setRefreshError('')
  }, [])
  useEffect(() => {
    mountedRef.current = true
    generationRef.current += 1
    snapshotRef.current = EMPTY
    spectateRef.current = null
    setSnapshot(EMPTY)
    setSpectateTarget(null)
    setConnected(false)
    setDialog(null)
    setPassword('')
    setError('')
    setRefreshError('')
    if (!enabled || !canAuthenticate) return () => { mountedRef.current = false; generationRef.current += 1 }
    const controller = new AbortController()
    let active = true
    const refresh = async () => {
      if (!active || operationRef.current) return false
      const generation = generationRef.current
      try {
        const known = snapshotRef.current.match
        const target = spectateRef.current
        const spectator = snapshotRef.current.spectator
        const value = await client.request('rooms', {
          ...(!target && known ? { matchId: known.id, timelineRevision: known.timelineRevision,
            ...(knownMatchRevision(known) !== null ? { matchRevision: known.revision } : {}) } : {}),
          ...(target ? { spectateMatchId: target,
            ...(spectator?.id === target ? { spectateTimelineRevision: spectator.timelineRevision } : {}) } : {}),
        }, { signal: controller.signal })
        if (active && generation === generationRef.current) accept(value)
        return active && generation === generationRef.current
      } catch (failure) {
        if (active && failure.name !== 'AbortError' && generation === generationRef.current) {
          setConnected(false)
          setRefreshError(failure.message)
          // A revoked room membership or invalid stream is terminal for this
          // target. Resume ordinary room polling instead of retaining a frozen
          // spectator view or retrying the same unauthorized match forever.
          if (spectateRef.current && ([401, 403, 404].includes(failure.status)
            || ['SPECTATOR_FORBIDDEN', 'INVALID_SPECTATOR_MATCH', 'INVALID_SPECTATOR_REVISION', 'ROOM_NOT_FOUND'].includes(failure.code))) {
            generationRef.current += 1
            spectateRef.current = null
            setSpectateTarget(null)
            const next = { ...snapshotRef.current, spectator: null }
            snapshotRef.current = next
            setSnapshot(next)
          }
        }
        return false
      }
    }
    const polling = startRankedPolling({ refresh, getSnapshot: () => snapshotRef.current,
      visibleInterval: () => roomPollDelay(snapshotRef.current, operationRef.current),
    })
    refreshRef.current = polling.refresh
    return () => { active = false; mountedRef.current = false; generationRef.current += 1; controller.abort(); polling.stop(); refreshRef.current = null }
  }, [client, enabled, canAuthenticate, accept])
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [])
  useEffect(() => { setSelection([]); setPlayedRevision(null); setDialog(null) }, [match?.id])
  const resultReady = match?.phase === 'finished' && (!match.state || !match.timeline?.length || playedRevision === (match.timelineRevision ?? match.revision))
  const battleVisible = Boolean(match?.state && !resultReady)
  const ownMatchActive = Boolean(match && match.phase !== 'finished')
  const spectating = Boolean(spectateTarget && !ownMatchActive)
  const arenaVisible = battleVisible || spectating
  useEffect(() => { onBattleActiveChange?.(arenaVisible); return () => onBattleActiveChange?.(false) }, [arenaVisible, onBattleActiveChange])

  const mutate = async (action, payload = {}, before) => {
    if (operationRef.current) throw new Error('요청을 처리하고 있습니다.')
    operationRef.current = true
    const generation = ++generationRef.current
    setBusy(true)
    setError('')
    try {
      if (before && await before() === false) throw new Error('팀을 저장하지 못했습니다. 저장 상태를 확인한 뒤 다시 참가해 주세요.')
      if (!mountedRef.current || generation !== generationRef.current) return null
      const value = await client.request(action, payload, { requestId: createRankedRequestId() })
      if (mountedRef.current && generation === generationRef.current) accept(value)
      return value
    } catch (failure) {
      if (mountedRef.current && generation === generationRef.current) { setError(failure.message); if (failure.code === 'network-error') setConnected(false) }
      throw failure
    } finally {
      operationRef.current = false
      if (mountedRef.current) { setBusy(false); refreshRef.current?.() }
    }
  }
  const fire = async (action, payload, before) => {
    try { const value = await mutate(action, payload, before); if (value) { setDialog(null); setPassword('') }; return Boolean(value) }
    catch { return false }
  }
  const savedTeams = useMemo(() => normalizeSavedTeamState({ teams, activeTeamId }, boxPokemon.map(pokemon => pokemon.captureId)).teams, [teams, activeTeamId, boxPokemon])
  const selectedTeam = savedTeams.find(team => team.id === activeTeamId) ?? savedTeams[0]
  const roster = (selectedTeam?.pokemonIds ?? []).map(id => boxPokemon.find(pokemon => pokemon.captureId === id)).filter(Boolean)
  const teamReady = roster.length === BATTLE_TEAM_SIZE
  const joinBlocked = Boolean(snapshot.rankedConflict || snapshot.queue)
  const currentFormat = RANKED_FORMATS.find(entry => entry.id === (match?.format ?? room?.format ?? format)) ?? RANKED_FORMATS[0]
  const secondsUntil = value => { const at = timeValue(value); return Number.isFinite(at) ? Math.max(0, Math.ceil((at - now - serverOffset) / 1000)) : null }
  const secondsLeft = secondsUntil(match?.deadlineAt)
  const roomSeconds = secondsUntil(room?.startDeadlineAt)
  const canAct = Boolean(connected && !busy && match?.phase === 'battle' && !match.actionSubmitted && !match.state?.rankedWaitingForOpponent && secondsLeft !== 0)
  const waitingMessage = !connected ? '연결 복구 중 · 대전 상태를 확인하고 있습니다.' : busy ? '명령을 전송하고 있습니다.'
    : match?.state?.rankedWaitingForOpponent ? '상대가 교대할 포켓몬을 고르고 있습니다.' : match?.actionSubmitted ? '명령 전송 완료 · 상대의 선택을 기다리고 있습니다.'
    : secondsLeft === 0 ? '제한 시간 종료 · 서버 판정을 확인하고 있습니다.' : match?.state?.awaitingPlayerSwitch ? '다음 포켓몬을 선택하세요.' : '이번 턴의 행동을 선택하세요.'
  const openDialog = next => { setError(''); setPassword(''); setDialog(next) }
  const closeDialog = () => { if (!busy) { setDialog(null); setPassword(''); setError('') } }
  const changeSpectator = useCallback(target => {
    const current = snapshotRef.current
    if (operationRef.current) return
    if (target && (!current.room?.matches?.some(entry => entry.id === target && entry.canSpectate)
      || current.room.phase !== 'active' || (current.match && current.match.phase !== 'finished'))) return
    // Invalidate any poll sent for the former target before changing the
    // observed match. This also protects leave/re-enter of the same target.
    generationRef.current += 1
    spectateRef.current = target
    setSpectateTarget(target)
    const next = { ...current, spectator: null, ...(target && current.match?.phase === 'finished' ? { match: null } : {}) }
    snapshotRef.current = next
    setSnapshot(next)
    setError('')
    setRefreshError('')
    refreshRef.current?.()
  }, [])
  const closeMatchResult = useCallback(() => {
    generationRef.current += 1
    const next = { ...snapshotRef.current, match: null }
    snapshotRef.current = next
    setSnapshot(next)
    setError('')
    refreshRef.current?.()
  }, [])
  useEffect(() => {
    if (!resultReady || room?.phase !== 'active') { setReturnSeconds(null); return }
    const deadline = Date.now() + 8000
    setReturnSeconds(8)
    const timer = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
      setReturnSeconds(remaining)
      if (remaining === 0) { clearInterval(timer); closeMatchResult() }
    }, 250)
    return () => clearInterval(timer)
  }, [resultReady, room?.phase, match?.id, closeMatchResult])
  const visibleError = error || refreshError
  const notice = visibleError && <div className="ranked-error" role="alert"><WifiOff size={16} /><span>{visibleError}</span><button type="button" disabled={busy} onClick={() => refreshRef.current?.()}><RefreshCw size={14} /> 다시 확인</button></div>
  const forfeitDialog = dialog?.type === 'forfeit' && <Dialog title="이번 대전을 기권할까요?" busy={busy} onClose={closeDialog}>
    <div className="rooms-forfeit-copy"><Flag size={30} /><p>이번 경기는 패배로 기록됩니다.<br />리그전의 남은 경기는 계속 진행합니다.</p></div>{notice}
    <div className="rooms-dialog-actions"><button type="button" className="ranked-quiet" disabled={busy} onClick={closeDialog}>계속 대전</button><button type="button" className="rooms-danger" disabled={busy} onClick={() => fire('forfeit', { matchId: match.id })}>기권하기</button></div>
  </Dialog>

  if (spectating) {
    const spectator = snapshot.spectator
    const fixture = room?.matches?.find(entry => entry.id === spectateTarget)
    const players = spectator?.players ?? fixture?.players ?? []
    const names = players.map(player => player.name).join(' vs ')
    const spectatorFormat = RANKED_FORMATS.find(entry => entry.id === (spectator?.format ?? room?.format)) ?? RANKED_FORMATS[0]
    const spectatorStatus = !connected ? '연결 복구 중 · 관전 상태를 확인하고 있습니다.'
      : !spectator ? '경기를 불러오고 있습니다.' : spectator.phase === 'select' ? '두 트레이너가 출전 포켓몬을 고르고 있습니다.' : '실시간 관전 중'
    return <div className="ranked-live-battle rooms-live-battle rooms-spectator-view">
      <header className="rooms-spectator-bar"><div><span><Eye size={16} /> 관전 중 · {fixture?.round ?? room?.round ?? 1}라운드</span><strong>{names || '대전 정보 확인 중'}</strong></div>
        <button type="button" className="ranked-quiet" onClick={() => changeSpectator(null)}><ArrowLeft size={15} /> 대기실로 돌아가기</button></header>
      {notice && <div className="ranked-notices">{notice}</div>}
      {spectator?.state ? <BattleScreen key={`spectator-${spectator.id}`} competitionLabel={`${spectatorFormat.label} · ${modeName(room?.mode)} 관전`}
        playerPokemon={spectator.state.player.team} opponent={players[1] ?? spectator.state.opponentMeta}
        opponentTeam={{ pokemon: spectator.state.opponent.team }} rules={spectator.state.rules}
        soundEnabled={soundEnabled} gameSettings={gameSettings} playerGender={playerGender} audioSettings={audioSettings} onToggleSound={onToggleSound} onOpenSettings={onOpenSettings}
        online={{ spectator: true, state: spectator.state, timeline: spectator.timeline ?? [], revision: spectator.revision, timelineRevision: spectator.timelineRevision,
          playerName: players[0]?.name, canAct: false, waitingMessage: spectatorStatus }} />
        : <section className="rooms-spectator-waiting" role="status"><Eye size={44} /><span>{spectatorFormat.label} · {modeName(room?.mode)}</span>
          <h2>{spectator?.phase === 'select' ? '두 트레이너가 출전 포켓몬을 고르고 있습니다' : '관전할 경기를 불러오고 있습니다'}</h2>
          <p>선출이 끝나면 배틀이 자동으로 표시됩니다.</p><LoaderCircle className="ranked-spin" size={25} /></section>}
    </div>
  }

  if (battleVisible) return <div className="ranked-live-battle rooms-live-battle">
    <div className="ranked-battle-connection" role="status"><span>{connected ? <Wifi size={14} /> : <WifiOff size={14} />}{waitingMessage}</span><span className={secondsLeft !== null && secondsLeft <= 15 ? 'is-urgent' : ''}><Clock3 size={14} />{secondsLeft === null ? '—' : clockText(secondsLeft)}</span>
      <button type="button" disabled={busy || match.phase === 'finished'} onClick={() => openDialog({ type: 'forfeit' })}><Flag size={14} /> 기권</button></div>
    {notice && <div className="ranked-notices">{notice}</div>}
    <BattleScreen key={match.id} competitionLabel={`${currentFormat.label} · 친선 ${modeName(room?.mode ?? snapshot.roomResult?.mode)}`} playerPokemon={match.state.player.team}
      opponent={match.opponent} opponentTeam={{ pokemon: match.state.opponent.team }} rules={match.state.rules}
      soundEnabled={soundEnabled} gameSettings={gameSettings} playerGender={playerGender} audioSettings={audioSettings} onToggleSound={onToggleSound} onOpenSettings={onOpenSettings}
      online={{ state: match.state, timeline: match.timeline ?? [], revision: match.revision, timelineRevision: match.timelineRevision, playerName: match.you?.name, canAct, waitingMessage,
        onSubmit: actions => mutate('submit', { matchId: match.id, revision: match.revision, actions }), onReplace: targetIndex => mutate('replace', { matchId: match.id, revision: match.revision, targetIndex }),
        onForfeit: () => openDialog({ type: 'forfeit' }), onPlaybackComplete: setPlayedRevision }} />{forfeitDialog}
  </div>

  return <main className="rooms-screen">
    <header className="rooms-header"><button type="button" className="screen-back-button" disabled={busy || Boolean(match && match.phase !== 'finished')} onClick={onBack}><ArrowLeft size={17} /> 배틀 선택</button>
      <div><span>FRIENDLY COMPETITION</span><h1>대전방</h1></div><span className="rooms-mode-badge"><UsersRound size={16} /> 최대 4명</span></header>
    {!dialog && notice}
    {joinBlocked && <div className="rooms-conflict" role="status"><Shield size={18} /><span>{snapshot.rankedConflict ? '진행 중인 레이팅 배틀을 마친 뒤 방에 참가할 수 있습니다.' : '레이팅 상대 검색을 먼저 취소한 뒤 방에 참가할 수 있습니다.'} 배틀 선택에서 레이팅으로 돌아가 주세요.</span></div>}
    {!enabled || !canAuthenticate ? <section className="rooms-empty"><Shield size={40} /><h2>{!enabled ? '친선 대전을 준비하고 있습니다' : '온라인 계정으로 참가하세요'}</h2><p>{!enabled ? '현재 환경에서는 참가할 수 없습니다.' : '게스트 또는 Google 로그인 연결이 필요합니다.'}</p></section>
      : resultReady ? <section className={`rooms-match-result outcome-${match.result?.outcome}`}><Trophy size={45} /><span>친선 대전 · 결과 확정</span><h2>{resultNames[match.result?.outcome] ?? '경기 종료'}</h2><p>{match.result?.reason === 'forfeit' ? '기권으로 종료된 경기입니다.' : '이번 경기 결과를 대회에 반영했습니다.'}</p><button className="ranked-primary" type="button" onClick={closeMatchResult}>{snapshot.roomResult ? '대회 최종 결과' : '대회 진행 확인'}<ArrowRight size={17} /></button>{returnSeconds !== null && <small className="rooms-result-countdown">{returnSeconds}초 후 대회로 이동</small>}</section>
      : match?.phase === 'select' ? <section className="rooms-selection ranked-selection">
        <div className="ranked-selection-heading"><div><span>{modeName(room?.mode)} · {currentFormat.label}</span><h2>{currentFormat.battleSize}마리를 출전 순서대로 선택하세요</h2><p>앞의 {currentFormat.activeSlots}마리가 선봉입니다. 매 경기 새로 선출합니다.</p></div><strong className={secondsLeft !== null && secondsLeft <= 15 ? 'is-urgent' : ''}><Clock3 size={19} />{secondsLeft === null ? '—' : clockText(secondsLeft)}</strong></div>
        <div className="ranked-team-preview"><header><strong>{match.opponent?.name ?? '상대 트레이너'}</strong><span>{match.opponentSelectionSubmitted ? '상대 선출 완료' : '상대 선출 중'}</span></header><div className="ranked-six-grid">{(match.teamPreview?.opponent ?? []).map((pokemon, index) => <SelectionCard key={index} pokemon={pokemon} index={index} />)}</div></div>
        <div className="ranked-team-preview"><header><strong>나의 출전 팀</strong><span>{match.selectionSubmitted ? '선출 전송 완료' : `${selection.length} / ${currentFormat.battleSize}`}</span></header><div className="ranked-six-grid">{(match.teamPreview?.you ?? []).map((pokemon, index) => <SelectionCard key={index} pokemon={pokemon} index={index} order={(match.selectionSubmitted ? match.selectedIndices ?? selection : selection).indexOf(index) + 1}
          disabled={busy || !connected || match.selectionSubmitted || secondsLeft === 0 || (!selection.includes(index) && selection.length >= currentFormat.battleSize)} onClick={() => setSelection(current => current.includes(index) ? current.filter(value => value !== index) : current.length < currentFormat.battleSize ? [...current, index] : current)} />)}</div></div>
        <div className="ranked-selection-actions"><p role="status">{match.selectionSubmitted ? '상대가 준비되면 배틀이 시작됩니다.' : '선택한 포켓몬을 다시 누르면 선출에서 제외합니다.'}</p><button className="ranked-primary" type="button" disabled={busy || !connected || match.selectionSubmitted || selection.length !== currentFormat.battleSize || secondsLeft === 0} onClick={() => fire('select', { matchId: match.id, revision: match.revision, selection })}>{match.selectionSubmitted ? '선출 완료' : '선출 확정'}</button><button className="ranked-quiet" type="button" disabled={busy} onClick={() => openDialog({ type: 'forfeit' })}>선출 포기</button></div>
      </section>
      : snapshot.roomResult ? <section className="rooms-final rooms-panel"><Trophy size={42} /><span>COMPETITION RESULT</span><h2>{snapshot.roomResult.reason === 'completed' ? `${modeName(snapshot.roomResult.mode)} 종료` : '방이 종료되었습니다'}</h2>
        {snapshot.roomResult.championName && <p className="rooms-champion"><Crown size={19} /> 우승 · {snapshot.roomResult.championName}</p>}<p>{closeReasons[snapshot.roomResult.reason] ?? '방이 삭제되었습니다.'}</p>
        {snapshot.roomResult.reason === 'completed' && <Standings rows={snapshot.roomResult.standings} userId={user?.uid} />}<button className="ranked-primary" type="button" disabled={busy} onClick={() => fire('roomDismissResult', { roomId: snapshot.roomResult.roomId })}>방 목록으로<ArrowRight size={17} /></button>
      </section>
      : room ? <div className="rooms-competition-grid"><section className="rooms-panel rooms-members-panel">
        <div className="rooms-members-heading">
        <div className="rooms-panel-title"><span>{room.locked ? <LockKeyhole size={17} /> : <UsersRound size={17} />}{room.phase === 'waiting' ? '참가자 대기실' : '대회 참가자'}</span><b>{room.members?.length ?? 0} / 4</b></div>
        <h2 title={room.title}>{room.title}</h2><div className="rooms-tags"><span>{modeName(room.mode)}</span><span>{currentFormat.label}</span><span>{room.phase === 'waiting' ? '시작 대기' : `${room.round ?? 1}라운드 진행`}</span></div>
        </div>
        <div className="rooms-member-list">{Array.from({ length: 4 }, (_, index) => { const member = room.members?.[index]; return <div key={member?.uid ?? index} className={`rooms-member${member?.uid === user?.uid ? ' is-me' : ''}${!member ? ' empty' : ''}`}><span className="rooms-member-avatar">{member ? <UsersRound size={20} /> : <Plus size={18} />}</span><div><strong>{member?.name ?? '빈 자리'}</strong><small>{!member ? '트레이너를 기다리는 중' : member.withdrawn ? '대회에서 나감' : member.uid === room.hostUid ? '방장' : '참가자'}{member?.uid === user?.uid ? ' · 나' : ''}</small></div>{member?.uid === room.hostUid && <Crown size={17} />}</div> })}</div>
        <div className="rooms-members-footer">
        {room.phase === 'waiting' ? <><div className={`rooms-deadline${roomSeconds !== null && roomSeconds <= 60 ? ' is-urgent' : ''}`}><Clock3 size={17} /><span>자동 삭제까지</span><strong>{roomSeconds === null ? '—' : clockText(roomSeconds)}</strong></div><p className="rooms-help">생성 후 10분 · 만원 후 1분 이내 시작<br />먼저 도달하는 시간에 방이 삭제됩니다.</p></>
          : <p className="rooms-waiting" role="status"><LoaderCircle size={18} className="ranked-spin" />{room.members?.find(member => member.uid === user?.uid)?.withdrawn ? '남은 경기 결과를 확인하고 있습니다.' : (room.matches ?? []).some(entry => entry.canSpectate) ? '대진표의 관전하기를 눌러 다른 경기를 볼 수 있습니다. 부전승도 관전하며 기다리세요.' : '다른 경기 종료 후 다음 대진이 시작됩니다.'}</p>}
        <div className="rooms-member-actions">
        {room.phase === 'waiting' && room.hostUid === user?.uid && <button className="ranked-primary" type="button" disabled={busy || !connected || (room.members?.length ?? 0) < 2 || roomSeconds === 0} onClick={() => fire('roomStart', { roomId: room.id })}><Swords size={18} />{(room.members?.length ?? 0) < 2 ? '2명부터 시작 가능' : '대회 시작'}</button>}
        {room.phase === 'waiting' && room.hostUid !== user?.uid && <p className="rooms-waiting" role="status"><LoaderCircle size={18} className="ranked-spin" />방장이 시작하기를 기다립니다.</p>}
        <button className="ranked-quiet" type="button" disabled={busy} onClick={() => room.phase === 'waiting' ? fire('roomLeave', { roomId: room.id }) : openDialog({ type: 'leave' })}>방 나가기</button>
        </div></div>
      </section><section className="rooms-panel rooms-progress-panel"><div className="rooms-panel-title"><span><Trophy size={18} />{room.phase === 'waiting' ? '대회 진행 안내' : '대진 및 순위'}</span><span>{modeName(room.mode)}</span></div>
        {room.phase === 'waiting' ? <div className="rooms-rules"><Swords size={44} /><h2>{room.mode === 'league' ? '리그전을' : '토너먼트를'} 준비하세요</h2><p>{room.mode === 'league' ? '모든 참가자와 한 번씩 대전합니다. 승점으로 최종 순위를 결정합니다.' : '승리한 트레이너가 다음 라운드에 진출합니다. 3명이 참가하면 첫 라운드에서 1명은 부전승하며, 무승부는 추첨으로 진출자를 결정합니다.'}</p><div><span>참가 인원<strong>2–4명</strong></span><span>대전 형식<strong>{currentFormat.label}</strong></span><span>출전 선출<strong>6마리 중 {currentFormat.battleSize}마리</strong></span></div><p className="rooms-help">팀은 참가할 때 고정됩니다. 맑음 · 일반 필드 · Lv.50으로 시작하며, 대회가 끝나면 방이 자동으로 삭제됩니다.</p></div>
          : <><div className="rooms-match-list">{(room.matches ?? []).map((entry, index) => <article key={entry.id ?? index} className={`rooms-match phase-${entry.phase}`}><header><span>{entry.round}라운드</span><b>{entry.phase === 'bye' ? '부전승' : entry.phase === 'finished' ? '경기 종료' : entry.phase === 'pending' ? '대기' : '대전 중'}</b></header><div>{(entry.players ?? []).map((player, playerIndex) => <span key={player.uid}>{playerIndex > 0 && <small>VS</small>}<strong className={entry.winnerUid === player.uid ? 'winner' : ''}>{player.name}{entry.winnerUid === player.uid && <Crown size={13} />}</strong></span>)}</div>{entry.phase === 'bye' && <p>다음 라운드 자동 진출</p>}{entry.reason === 'draw-tiebreak-lottery' && <p>무승부 · 추첨으로 다음 라운드 진출</p>}{entry.canSpectate && !ownMatchActive && <button type="button" className="rooms-spectate-button" disabled={busy || !connected} aria-label={`관전하기: ${(entry.players ?? []).map(player => player.name).join(' vs ')}`} onClick={() => changeSpectator(entry.id)}><Eye size={15} /> 관전하기</button>}</article>)}</div><Standings rows={room.standings} userId={user?.uid} /></>}
      </section></div>
      : <div className="rooms-lobby-grid"><section className="rooms-panel rooms-list-panel"><div className="rooms-panel-title"><span><UsersRound size={19} />참가할 방</span><span>{snapshot.rooms.length} / 10개<button className="rooms-icon-button" type="button" aria-label="방 목록 새로고침" disabled={busy} onClick={() => refreshRef.current?.()}><RefreshCw size={16} /></button></span></div>
        <div className="rooms-list">{snapshot.rooms.length ? snapshot.rooms.map(entry => { const left = secondsUntil(entry.startDeadlineAt); return <article key={entry.id} className="rooms-room-card"><div className="rooms-room-heading"><span className="rooms-room-icon">{entry.locked ? <LockKeyhole size={19} /> : <Swords size={19} />}</span><div><h2>{entry.title}</h2><div className="rooms-tags"><span>{modeName(entry.mode)}</span><span>{entry.format === 'double' ? '더블배틀' : '싱글배틀'}</span><span>{entry.phase === 'waiting' ? '참가 가능' : '대전 중'}</span></div></div><b>{entry.memberCount} / 4</b></div><footer><span><Clock3 size={13} />{entry.phase === 'waiting' ? `${left === null ? '—' : clockText(left)} 후 삭제` : '대회 종료 후 삭제'}</span><button className="ranked-quiet" type="button" disabled={busy || !connected || !teamReady || joinBlocked || entry.phase !== 'waiting' || entry.memberCount >= 4 || left === 0} onClick={() => entry.locked ? openDialog({ type: 'join', room: entry }) : fire('roomJoin', { roomId: entry.id, password: '', team: roster }, onBeforeJoin)}>참가하기<ChevronRight size={14} /></button></footer></article> })
          : <div className="rooms-list-empty"><UsersRound size={38} /><h2>{connected ? '아직 만들어진 방이 없습니다' : '방 목록을 불러오고 있습니다'}</h2><p>방을 만들고 함께 대전할 트레이너를 기다려 보세요.</p></div>}</div>
        <button className="ranked-primary" type="button" disabled={busy || !connected || !teamReady || joinBlocked || snapshot.rooms.length >= 10} onClick={() => openDialog({ type: 'create' })}><Plus size={18} />{snapshot.rooms.length >= 10 ? '현재 방이 가득 찼습니다' : '방 만들기'}</button>
        <p className="rooms-help">방은 최대 10개 · 방마다 최대 4명 · 대회 종료 시 자동 삭제</p>
      </section><section className="rooms-panel rooms-team-panel"><div className="rooms-panel-title"><span><Shield size={18} />참가할 팀 선택</span><span>6마리 등록</span></div><div className="ranked-team-slots" role="group" aria-label="친선 대전 출전 팀 선택">{savedTeams.map((team, index) => <button key={team.id} type="button" disabled={busy} aria-pressed={selectedTeam?.id === team.id} aria-label={`팀 ${index + 1}, ${team.pokemonIds.length}마리 편성`} onClick={() => onSelectTeam?.(team.id)}><strong>팀 {index + 1}</strong><span>{team.pokemonIds.length} / 6</span></button>)}</div>
        <div className="ranked-roster-heading"><strong>{selectedTeam?.name ?? '출전 팀'}</strong><span className={teamReady ? 'ready' : ''}>{teamReady ? <><Check size={14} /> 편성 완료</> : `${roster.length} / 6마리`}</span></div><RankedTeamRoster key={selectedTeam?.id ?? 'roster'} pokemon={roster} />
        {!teamReady && <p className="rooms-help" role="status">선택한 팀에 포켓몬 {BATTLE_TEAM_SIZE - roster.length}마리를 더 편성하면 방을 만들거나 참가할 수 있습니다.</p>}
        <button className="ranked-quiet" type="button" disabled={busy} onClick={onOpenBox}>선택한 팀 편성하기</button><div className="rooms-team-note"><Swords size={22} /><p>싱글은 3마리, 더블은 4마리를 선출합니다.<br /><span>방에 참가하면 등록한 팀으로 대회를 진행합니다.</span></p></div>
      </section></div>}

    {dialog?.type === 'create' && <Dialog title="방 만들기" busy={busy} onClose={closeDialog}><form onSubmit={event => { event.preventDefault(); void fire('roomCreate', { title: title.trim(), mode, format, password, team: roster }, onBeforeJoin) }}>
      <label className="rooms-field">방 이름<input value={title} onChange={event => setTitle(event.target.value)} maxLength={32} required placeholder="함께 배틀해요!" disabled={busy} /></label>
      <fieldset><legend>대회 방식</legend><div className="rooms-choice-tabs">{[['tournament', '토너먼트'], ['league', '리그전']].map(([id, label]) => <button type="button" key={id} aria-pressed={mode === id} disabled={busy} onClick={() => setMode(id)}>{label}</button>)}</div></fieldset>
      <fieldset><legend>대전 형식</legend><div className="rooms-choice-tabs">{RANKED_FORMATS.map(entry => <button type="button" key={entry.id} aria-pressed={format === entry.id} disabled={busy} onClick={() => setFormat(entry.id)}>{entry.label}</button>)}</div></fieldset>
      <label className="rooms-field">비밀번호 <small>선택 · 숫자 최대 4자리</small><input type="password" inputMode="numeric" pattern="[0-9]{0,4}" maxLength={4} autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value.replace(/[^0-9]/g, '').slice(0, 4))} placeholder="비워 두면 누구나 참가할 수 있어요" disabled={busy} /></label>
      <p className="rooms-help">2명부터 시작할 수 있습니다. 생성 후 10분 또는 만원 후 1분 안에 시작하지 않으면 방이 삭제됩니다.</p>{notice}<button type="submit" className="ranked-primary" disabled={busy || !connected || !teamReady || joinBlocked || !title.trim()}>{busy ? <LoaderCircle size={18} className="ranked-spin" /> : <Plus size={18} />}방 만들기</button>
    </form></Dialog>}
    {dialog?.type === 'join' && <Dialog title="비밀번호 입력" busy={busy} onClose={closeDialog}><form onSubmit={event => { event.preventDefault(); void fire('roomJoin', { roomId: dialog.room.id, password, team: roster }, onBeforeJoin) }}><p>{dialog.room.title}</p><label className="rooms-field">방 비밀번호<input type="password" inputMode="numeric" pattern="[0-9]{1,4}" maxLength={4} autoComplete="off" required value={password} onChange={event => setPassword(event.target.value.replace(/[^0-9]/g, '').slice(0, 4))} disabled={busy} placeholder="숫자 최대 4자리" /></label>{notice}<button type="submit" className="ranked-primary" disabled={busy || !connected || !teamReady || joinBlocked || !password}>참가하기<ArrowRight size={17} /></button></form></Dialog>}
    {dialog?.type === 'leave' && <Dialog title="대회에서 나갈까요?" busy={busy} onClose={closeDialog}><p>남은 본인의 경기는 기권 처리됩니다.<br />다른 참가자들은 대회를 계속 진행합니다.</p>{notice}<div className="rooms-dialog-actions"><button className="ranked-quiet" type="button" disabled={busy} onClick={closeDialog}>계속 참가</button><button className="rooms-danger" type="button" disabled={busy} onClick={() => fire('roomLeave', { roomId: room.id })}>대회 나가기</button></div></Dialog>}
    {forfeitDialog}
  </main>
}
