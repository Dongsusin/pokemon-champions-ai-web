import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, Clock3, Flag, LoaderCircle, RefreshCw, Shield, Swords, Trophy, UsersRound, Wifi, WifiOff } from 'lucide-react'
import BattleScreen from './BattleScreen'
import SpriteImage from './SpriteImage'
import { firebaseAuth } from './auth/firebaseClient'
import { RANKED_FORMATS, RANKED_TIERS, createRankedProfile, getRankedTier } from './data/rankedRules'
import { getSpeciesProfile } from './data/trainingData'
import { BATTLE_TEAM_SIZE, normalizeSavedTeamState } from './data/teamData'
import { createRankedClient, createRankedRequestId, isRankedEnabled, isRankedLocalTest } from './rankedClient'
import './ranked.css'

const EMPTY = { profile: null, queue: null, match: null }
const resultNames = { win: '승리', loss: '패배', draw: '무승부' }
const reasonNames = { forfeit: '기권으로 종료된 대전', timeout: '제한 시간 종료', 'selection-timeout': '선출 시간 종료', 'turn-timeout': '행동 제한 시간 종료',
  'replacement-timeout': '교대 선택 시간 종료', 'both-timeout': '양쪽의 행동 제한 시간 종료', 'both-selection-timeout': '양쪽의 선출 시간 종료', 'turn-limit': '최대 턴 수 도달', battle: '배틀 종료', complete: '배틀 종료' }
const timeValue = value => typeof value === 'number' ? value : Date.parse(value)
const clockText = seconds => `${Math.floor(Math.max(0, seconds) / 60)}:${String(Math.max(0, seconds) % 60).padStart(2, '0')}`
const LOCAL_IDENTITY_KEY = 'champions-ranked-test-identity-v1'
function initialIdentity() {
  if (!isRankedLocalTest) return 'alice'
  try { return window.sessionStorage.getItem(LOCAL_IDENTITY_KEY) === 'bob' ? 'bob' : 'alice' } catch { return 'alice' }
}

function PokemonCard({ pokemon, index, order, disabled, onClick }) {
  const profile = getSpeciesProfile(pokemon.speciesId ?? pokemon.id)
  const name = pokemon.name ?? profile?.name ?? '포켓몬'
  const contents = <>
    <span className="ranked-pokemon-number">{order ? <><Check size={13} /> {order}번 출전</> : String(index + 1).padStart(2, '0')}</span>
    <SpriteImage src={pokemon.icon ?? profile?.icon} fallbackSrc={pokemon.iconFallback ?? profile?.iconFallback} alt="" draggable="false" />
    <strong>{name}</strong>
    <small>{(pokemon.types ?? profile?.types ?? []).join(' · ')}</small>
  </>
  return onClick ? <button type="button" className={`ranked-pokemon-card${order ? ' selected' : ''}`} disabled={disabled}
    aria-label={`${name}${order ? `, ${order}번 출전 선택됨` : ', 출전 선택'}`} aria-pressed={Boolean(order)} onClick={onClick}>{contents}</button>
    : <div className="ranked-pokemon-card">{contents}</div>
}

function RankBadge({ record, compact = false }) {
  const tier = getRankedTier(record?.points ?? 0)
  return <div className={`ranked-rank-badge tier-${tier.id}${compact ? ' compact' : ''}`} style={{ '--rank-color': tier.color }}>
    <span className="ranked-ball" aria-hidden="true"><i /></span>
    <div><small>{tier.id === 'masterball' ? 'MASTER RATING' : 'CURRENT RANK'}</small><strong>{tier.label}</strong>
      <span>{tier.id === 'masterball' ? `레이팅 ${record?.rating ?? 1000}` : `${record?.points ?? 0} RP`}</span></div>
  </div>
}

export default function RankedBattleScreen({
  user, teams = [], boxPokemon = [], activeTeamId, onSelectTeam, onOpenBox, onBack, onBeforeJoin,
  soundEnabled = true, gameSettings = {}, playerGender = 'male', audioSettings = {},
  onToggleSound, onOpenSettings, onBattleActiveChange,
}) {
  const [identity, setIdentity] = useState(initialIdentity)
  const [format, setFormat] = useState('single')
  const [snapshot, setSnapshot] = useState(EMPTY)
  const [fixtures, setFixtures] = useState([])
  const [fixtureTeamId, setFixtureTeamId] = useState(null)
  const [selection, setSelection] = useState([])
  const [busy, setBusy] = useState(false)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState('')
  const [refreshError, setRefreshError] = useState('')
  const [now, setNow] = useState(Date.now())
  const [serverOffset, setServerOffset] = useState(0)
  const [dismissedMatch, setDismissedMatch] = useState(null)
  const [playedRevision, setPlayedRevision] = useState(null)
  const [confirmForfeit, setConfirmForfeit] = useState(false)
  const snapshotRef = useRef(snapshot)
  snapshotRef.current = snapshot
  const operationRef = useRef(false)
  const mountedRef = useRef(true)
  const generationRef = useRef(0)
  const refreshRef = useRef(null)
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; generationRef.current += 1 } }, [])
  useEffect(() => {
    if (!isRankedLocalTest) return
    try { window.sessionStorage.setItem(LOCAL_IDENTITY_KEY, identity) } catch { /* Storage is optional in local tests. */ }
  }, [identity])
  const canAuthenticate = isRankedLocalTest || Boolean(user && !user.isLocalGuest)
  const client = useMemo(() => createRankedClient({
    localTestIdentity: isRankedLocalTest ? identity : undefined,
    getIdToken: async () => {
      const current = firebaseAuth?.currentUser
      if (!current || current.uid !== user?.uid) return null
      return current.getIdToken()
    },
  }), [identity, user?.uid])
  const accept = useCallback(value => {
    if (Number.isFinite(value.serverTime)) setServerOffset(value.serverTime - Date.now())
    setSnapshot(previous => {
      if (previous.match?.id === value.match?.id && previous.match?.revision > value.match?.revision) return previous
      if (previous.match?.id === value.match?.id && previous.match?.timelineRevision === value.match?.timelineRevision
        && previous.match?.timeline?.length && !value.match?.timeline?.length) {
        return { ...EMPTY, ...value, match: { ...value.match, timeline: previous.match.timeline } }
      }
      return { ...EMPTY, ...value }
    })
    setConnected(true)
    setRefreshError('')
  }, [])

  useEffect(() => {
    if (!isRankedEnabled || !canAuthenticate) return
    const controller = new AbortController()
    let timer, running = false, active = true
    generationRef.current += 1
    setSnapshot(EMPTY)
    setConnected(false)
    setError('')
    setRefreshError('')
    setFixtures([])
    const refresh = async () => {
      if (running || !active) return
      running = true
      const generation = generationRef.current
      try {
        const known = snapshotRef.current.match
        const value = await client.status(known ? { matchId: known.id, timelineRevision: known.timelineRevision } : {}, { signal: controller.signal })
        if (active && generation === generationRef.current) accept(value)
      } catch (failure) {
        if (active && failure.name !== 'AbortError' && generation === generationRef.current) { setConnected(false); setRefreshError(failure.message) }
      } finally {
        running = false
        if (active) timer = setTimeout(refresh, 1500)
      }
    }
    refreshRef.current = () => { clearTimeout(timer); void refresh() }
    const reconnect = () => { if (!document.hidden) refreshRef.current?.() }
    window.addEventListener('online', reconnect)
    document.addEventListener('visibilitychange', reconnect)
    void refresh()
    if (isRankedLocalTest) client.request('fixtures', {}, { signal: controller.signal }).then(value => {
      if (active) { setFixtures(value.teams ?? []); setFixtureTeamId(value.teams?.[0]?.id ?? null) }
    }).catch(failure => { if (active && failure.name !== 'AbortError') setError(failure.message) })
    return () => {
      active = false
      generationRef.current += 1
      controller.abort()
      clearTimeout(timer)
      refreshRef.current = null
      window.removeEventListener('online', reconnect)
      document.removeEventListener('visibilitychange', reconnect)
    }
  }, [client, canAuthenticate, accept])

  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [])
  const match = snapshot.match
  useEffect(() => { setSelection([]); setPlayedRevision(null); setConfirmForfeit(false) }, [match?.id])
  const resultReady = match?.phase === 'finished' && (!match.state || !match.timeline?.length
    || playedRevision === (match.timelineRevision ?? match.revision))
  const battleVisible = Boolean(match?.state && match.id !== dismissedMatch && !resultReady)
  useEffect(() => { onBattleActiveChange?.(battleVisible); return () => onBattleActiveChange?.(false) }, [battleVisible, onBattleActiveChange])

  const mutate = async (action, payload, before) => {
    if (operationRef.current) throw new Error('요청을 처리하고 있습니다.')
    operationRef.current = true
    const generation = ++generationRef.current
    setBusy(true)
    setError('')
    try {
      if (before && await before() === false) throw new Error('팀을 계정에 저장하지 못했습니다. 저장 상태를 확인한 뒤 다시 참가해 주세요.')
      if (!mountedRef.current || generation !== generationRef.current) return null
      const value = await client.request(action, payload, { requestId: createRankedRequestId() })
      if (mountedRef.current && generation === generationRef.current) accept(value)
      return value
    } catch (failure) {
      if (mountedRef.current && generation === generationRef.current) {
        setError(failure.message)
        if (failure.code === 'network-error') setConnected(false)
        refreshRef.current?.()
      }
      throw failure
    } finally { operationRef.current = false; if (mountedRef.current) setBusy(false) }
  }
  const fire = async (action, payload) => { try { await mutate(action, payload) } catch { /* Visible error belongs to the request panel. */ } }
  const savedTeamOptions = useMemo(() => normalizeSavedTeamState({ teams, activeTeamId }, boxPokemon.map(pokemon => pokemon.captureId)).teams,
    [teams, activeTeamId, boxPokemon])
  const teamOptions = isRankedLocalTest ? fixtures : savedTeamOptions
  const selectedTeam = teamOptions.find(team => team.id === (isRankedLocalTest ? fixtureTeamId : activeTeamId)) ?? teamOptions[0]
  const roster = isRankedLocalTest ? selectedTeam?.pokemon ?? []
    : (selectedTeam?.pokemonIds ?? []).map(id => boxPokemon.find(pokemon => pokemon.captureId === id)).filter(Boolean)
  const teamSelectionLocked = busy || Boolean(snapshot.queue) || Boolean(match && match.phase !== 'finished')
  const teamReady = roster.length === BATTLE_TEAM_SIZE
  const shownMatchFormat = match && match.id !== dismissedMatch ? match.format : null
  const currentFormat = RANKED_FORMATS.find(entry => entry.id === (shownMatchFormat ?? snapshot.queue?.format ?? format)) ?? RANKED_FORMATS[0]
  const record = snapshot.profile?.[format] ?? createRankedProfile(format)
  const deadline = timeValue(match?.deadlineAt)
  const secondsLeft = Number.isFinite(deadline) ? Math.max(0, Math.ceil((deadline - now - serverOffset) / 1000)) : null
  const canAct = Boolean(connected && !busy && match?.phase === 'battle' && !match.actionSubmitted
    && !match.state?.rankedWaitingForOpponent && (secondsLeft === null || secondsLeft > 0))
  const waitingMessage = !connected ? '연결 복구 중 · 서버의 대전 상태를 확인하고 있습니다.'
    : busy ? '명령을 전송하고 있습니다.' : match?.state?.rankedWaitingForOpponent ? '상대가 교대할 포켓몬을 고르고 있습니다.'
    : match?.actionSubmitted ? '명령 전송 완료 · 상대의 선택을 기다리고 있습니다.'
    : secondsLeft === 0 ? '제한 시간 종료 · 서버 판정을 확인하고 있습니다.' : match?.state?.awaitingPlayerSwitch ? '다음 포켓몬을 선택하세요.' : '이번 턴의 행동을 선택하세요.'

  async function join() {
    if (busy || operationRef.current) return
    try {
      setDismissedMatch(null)
      await mutate('join', { format, team: roster }, onBeforeJoin)
    } catch { /* Errors are shown inline. */ }
  }
  async function leave() {
    if (snapshot.queue) {
      try { const value = await mutate('cancel', { queueTicket: snapshot.queue.ticket }); if (!value || (value.match && value.match.phase !== 'finished')) return } catch { return }
    }
    onBack?.()
  }
  const visibleError = refreshError || error
  const connectionNotice = visibleError && <div className="ranked-error" role="alert"><WifiOff size={17} /><span>{visibleError}</span>
    <button type="button" onClick={() => refreshRef.current?.()}><RefreshCw size={14} /> 다시 연결</button></div>

  if (battleVisible) return <div className="ranked-live-battle">
    <div className="ranked-battle-connection" role="status"><span>{connected ? <Wifi size={14} /> : <WifiOff size={14} />}{waitingMessage}</span>
      <span className={secondsLeft !== null && secondsLeft <= 15 ? 'is-urgent' : ''}><Clock3 size={14} />{secondsLeft === null ? '—' : clockText(secondsLeft)}</span>
      <button type="button" disabled={busy || match.phase === 'finished'} onClick={() => setConfirmForfeit(true)}><Flag size={14} /> 기권</button></div>
    {connectionNotice}
    <BattleScreen key={match.id} competitionLabel={`${currentFormat.label} · 레이팅${isRankedLocalTest ? ' 테스트' : ''}`} playerPokemon={match.state.player.team}
      opponent={match.opponent} opponentTeam={{ pokemon: match.state.opponent.team }} rules={match.state.rules}
      soundEnabled={soundEnabled} gameSettings={gameSettings} playerGender={playerGender} audioSettings={audioSettings}
      onToggleSound={onToggleSound} onOpenSettings={onOpenSettings}
      online={{ state: match.state, timeline: match.timeline ?? [], revision: match.revision, timelineRevision: match.timelineRevision,
        playerName: match.you?.name, canAct, waitingMessage,
        onSubmit: actions => mutate('submit', { matchId: match.id, revision: match.revision, actions }),
        onReplace: targetIndex => mutate('replace', { matchId: match.id, revision: match.revision, targetIndex }),
        onForfeit: () => setConfirmForfeit(true), onPlaybackComplete: setPlayedRevision }} />
    {confirmForfeit && <div className="ranked-confirm-backdrop"><section className="ranked-confirm" role="dialog" aria-modal="true" aria-label="레이팅 대전 기권">
      <Flag size={28} /><h2>이번 대전을 기권할까요?</h2><p>서버가 패배로 기록합니다.</p><div>
        <button type="button" disabled={busy} onClick={() => setConfirmForfeit(false)}>계속 대전</button>
        <button type="button" disabled={busy} onClick={async () => { await fire('forfeit', { matchId: match.id }); setConfirmForfeit(false) }}>기권하기</button>
      </div></section></div>}
  </div>

  return <main className="ranked-screen">
    <header className="ranked-header"><button className="screen-back-button" type="button" disabled={busy || Boolean(match && match.phase !== 'finished')} onClick={leave}><ArrowLeft size={18} /> 배틀 선택</button>
      <div><span>TRAINER VS TRAINER</span><h1>레이팅 배틀</h1></div><span className="ranked-mode-tag">{isRankedLocalTest ? '로컬 테스트' : '온라인 대전'}</span></header>
    {connectionNotice}
    {!isRankedEnabled ? <section className="ranked-empty"><Shield size={40} /><h2>레이팅 배틀을 준비하고 있습니다</h2><p>현재 환경에서는 참가할 수 없습니다.</p></section>
      : !canAuthenticate ? <section className="ranked-empty"><UsersRound size={40} /><h2>Google 계정으로 참가하세요</h2><p>레이팅과 경기 기록은 로그인한 계정에 저장됩니다.</p></section>
      : resultReady && match.id !== dismissedMatch ? <section className={`ranked-result outcome-${match.result?.outcome}`}>
        <Trophy size={48} /><span>{currentFormat.label} · 결과 확정</span><h2>{resultNames[match.result?.outcome] ?? '대전 종료'}</h2>
        <p>{reasonNames[match.result?.reason] ?? '서버에서 대전 결과를 확정했습니다.'}</p>
        <RankBadge record={snapshot.profile?.[match.format]} />
        <div className="ranked-result-rating"><span>레이팅</span><strong>{match.result?.ratingBefore ?? '—'} <ArrowRight size={18} /> {match.result?.ratingAfter ?? '—'}</strong>
          <b>{Number.isFinite(match.result?.ratingDelta) ? `${match.result.ratingDelta > 0 ? '+' : ''}${match.result.ratingDelta}` : '정산 확인 중'}</b></div>
        <button className="ranked-primary" type="button" onClick={() => { setDismissedMatch(match.id); setFormat(match.format) }}>레이팅 로비로</button>
      </section>
      : match?.phase === 'select' ? <section className="ranked-selection">
        <div className="ranked-selection-heading"><div><span>TEAM PREVIEW</span><h2>{currentFormat.battleSize}마리를 출전 순서대로 선택하세요</h2><p>앞의 {currentFormat.activeSlots}마리가 선봉입니다. 상대의 선출은 배틀 시작 후 공개됩니다.</p></div>
          <strong className={secondsLeft !== null && secondsLeft <= 15 ? 'is-urgent' : ''}><Clock3 size={19} />{secondsLeft === null ? '—' : clockText(secondsLeft)}</strong></div>
        <div className="ranked-team-preview"><header><strong>{match.opponent?.name ?? '상대 트레이너'}</strong><span>{match.opponentSelectionSubmitted ? '상대 선출 완료' : '상대 선출 중'}</span></header>
          <div className="ranked-six-grid">{(match.teamPreview?.opponent ?? []).map((pokemon, index) => <PokemonCard key={index} pokemon={pokemon} index={index} />)}</div></div>
        <div className="ranked-team-preview"><header><strong>나의 출전 팀</strong><span>{match.selectionSubmitted ? '선출 전송 완료' : `${selection.length} / ${currentFormat.battleSize}`}</span></header>
          <div className="ranked-six-grid">{(match.teamPreview?.you ?? []).map((pokemon, index) => <PokemonCard key={index} pokemon={pokemon} index={index} order={(match.selectionSubmitted ? match.selectedIndices ?? selection : selection).indexOf(index) + 1}
            disabled={busy || match.selectionSubmitted || !connected || secondsLeft === 0 || (!selection.includes(index) && selection.length >= currentFormat.battleSize)}
            onClick={() => setSelection(current => current.includes(index) ? current.filter(value => value !== index) : current.length < currentFormat.battleSize ? [...current, index] : current)} />)}</div></div>
        <div className="ranked-selection-actions"><p role="status">{match.selectionSubmitted ? '상대가 준비되면 배틀이 시작됩니다.' : '선택한 포켓몬을 다시 누르면 선출에서 제외합니다.'}</p>
          <button className="ranked-primary" type="button" disabled={busy || !connected || match.selectionSubmitted || selection.length !== currentFormat.battleSize || secondsLeft === 0}
            onClick={() => fire('select', { matchId: match.id, revision: match.revision, selection })}>{match.selectionSubmitted ? <><Check size={17} /> 선출 완료</> : '선출 확정'}</button>
          <button className="ranked-quiet" type="button" disabled={busy} onClick={() => fire('forfeit', { matchId: match.id })}>선출 포기</button></div>
      </section>
      : <div className="ranked-lobby-grid"><section className="ranked-ladder-panel">
        <div className="ranked-format-tabs" role="group" aria-label="레이팅 형식">{RANKED_FORMATS.map(entry => <button type="button" key={entry.id} aria-pressed={format === entry.id} disabled={busy || Boolean(snapshot.queue)} onClick={() => setFormat(entry.id)}><Swords size={17} />{entry.label}</button>)}</div>
        <RankBadge record={record} />
        <div className="ranked-progress"><span style={{ width: `${getRankedTier(record.points).progress * 100}%` }} /></div>
        <p className="ranked-progress-label">{getRankedTier(record.points).nextPoints == null ? `마스터볼 레이팅 ${record.rating}` : `다음 등급까지 ${getRankedTier(record.points).nextPoints - record.points} RP`}</p>
        <div className="ranked-record"><span><strong>{record.wins}</strong>승</span><span><strong>{record.losses}</strong>패</span><span><strong>{record.draws}</strong>무</span></div>
        <div className="ranked-tier-path">{RANKED_TIERS.map(tier => <span className={getRankedTier(record.points).id === tier.id ? 'current' : ''} key={tier.id} style={{ '--rank-color': tier.color }}><i />{tier.name}</span>)}</div>
        <p className="ranked-ladder-note">몬스터볼·슈퍼볼·하이퍼볼 IV → I<br />마스터볼부터 레이팅 점수로 경쟁합니다.<br />싱글과 더블 기록은 각각 저장됩니다.</p>
      </section><section className="ranked-entry-panel">
        {isRankedLocalTest && <div className="ranked-test-identity"><span>독립 로컬 테스트 계정</span><label>트레이너<select aria-label="로컬 테스트 계정" value={identity} disabled={busy || Boolean(snapshot.queue) || Boolean(match && match.phase !== 'finished')}
          onChange={event => { setDismissedMatch(null); setIdentity(event.target.value) }}><option value="alice">Alice</option><option value="bob">Bob</option></select></label></div>}
        <div className="ranked-team-heading"><div><span>REGISTERED TEAM</span><h2>출전 팀 선택</h2></div>
          {isRankedLocalTest && <select aria-label="레이팅 출전 팀" value={selectedTeam?.id ?? ''} disabled={teamSelectionLocked} onChange={event => setFixtureTeamId(event.target.value)}>
            {!teamOptions.length && <option value="">팀 불러오는 중</option>}{teamOptions.map(team => <option value={team.id} key={team.id}>{team.name}</option>)}</select>}</div>
        {!isRankedLocalTest && <div className="ranked-team-slots" role="group" aria-label="저장된 출전 팀 선택">{teamOptions.map((team, index) => <button type="button" key={team.id}
          aria-label={`팀 ${index + 1}, ${team.pokemonIds.length}마리 편성`} aria-pressed={selectedTeam?.id === team.id} disabled={teamSelectionLocked}
          onClick={() => onSelectTeam?.(team.id)}><strong>팀 {index + 1}</strong><span>{team.pokemonIds.length} / {BATTLE_TEAM_SIZE}</span></button>)}</div>}
        <div className="ranked-roster-heading"><strong>{selectedTeam?.name ?? '출전 팀'}</strong><span className={teamReady ? 'ready' : ''}>{teamReady ? <><Check size={14} /> 편성 완료</> : `${roster.length} / ${BATTLE_TEAM_SIZE}마리 편성`}</span></div>
        <div className="ranked-six-grid" aria-label="선택한 팀 포켓몬">{Array.from({ length: BATTLE_TEAM_SIZE }, (_, index) => roster[index] ? <PokemonCard pokemon={roster[index]} index={index} key={index} /> : <div className="ranked-pokemon-card empty" key={index}><span>+</span><small>팀 편성 필요</small></div>)}</div>
        {!teamReady && <p className="ranked-team-help" role="status">{selectedTeam?.name ?? '선택한 팀'}에 포켓몬 {BATTLE_TEAM_SIZE - roster.length}마리를 더 편성하면 참가할 수 있습니다.</p>}
        <div className="ranked-rule-summary"><Shield size={19} /><p>6마리 등록 · {currentFormat.battleSize}마리 선출 · Lv.50<br /><span>상대와 동시에 명령을 선택하는 실제 유저 대전</span></p></div>
        {snapshot.queue ? <div className="ranked-queue" role="status"><LoaderCircle className="ranked-spin" size={31} /><div><h2>대전 상대를 찾고 있습니다</h2><p>참가한 다른 트레이너를 기다리는 중입니다.</p><strong>{clockText(Math.floor((now + serverOffset - timeValue(snapshot.queue.queuedAt)) / 1000) || 0)}</strong></div>
          <button type="button" disabled={busy} onClick={() => fire('cancel', { queueTicket: snapshot.queue.ticket })}>매칭 취소</button></div>
          : <div className="ranked-entry-actions"><button className="ranked-primary" type="button" disabled={busy || !connected || !teamReady} onClick={join}>{busy ? <LoaderCircle className="ranked-spin" size={19} /> : <Swords size={19} />} {busy ? '참가 준비 중' : '대전 상대 찾기'}</button>
            {!isRankedLocalTest && <button className="ranked-quiet" type="button" disabled={teamSelectionLocked} onClick={onOpenBox}>선택한 팀 편성하기</button>}</div>}
        <p className="ranked-match-note">{snapshot.queue ? '매칭 중에는 출전 팀이 고정됩니다. 팀을 변경하려면 매칭을 취소해 주세요.' : '저장된 팀으로 참가합니다. 같은 배틀 형식의 트레이너가 참가하면 대전을 시작합니다.'}</p>
      </section></div>}
  </main>
}
