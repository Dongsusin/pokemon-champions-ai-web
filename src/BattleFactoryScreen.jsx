import { useEffect, useRef, useState } from 'react'
import BattleScreen from './BattleScreen'
import BattleFactoryLobby from './BattleFactoryLobby'
import BattleFactoryRankings from './BattleFactoryRankings'
import useBattleFactoryRankings from './useBattleFactoryRankings'
import {
  FACTORY_TRAINER,
  createFactoryRun,
  selectFactoryRentals,
  selectFactoryLead,
  beginFactoryBattle,
  resolveFactoryBattle,
  advanceFactoryFloor,
  healFactoryParty,
  rerollFactoryHeldItem,
} from './data/battleFactory'
import { getFactoryMode } from './data/battleFactoryChallenge'
import { checkpointFactoryBattle } from './data/battleFactoryStorage.js'

export default function BattleFactoryScreen({
  run, onRunChange, onBack, user, restoreError = '', soundEnabled = true, gameSettings = {},
  playerGender = 'male', playerName, audioSettings = {}, onToggleSound, onOpenSettings, onVpReward,
  onFactoryBestFloor,
}) {
  const currentRun = useRef(run)
  currentRun.current = run
  const initialRun = useRef(null)
  const [error, setError] = useState('')
  const [mode, setMode] = useState('standard')
  const [showRankings, setShowRankings] = useState(false)
  // The rankings view can browse either board; it opens on the mode being played.
  const [rankingMode, setRankingMode] = useState(mode)
  const ranking = useBattleFactoryRankings(user, rankingMode)
  const active = run?.phase === 'battle'

  useEffect(() => {
    // Each mode has its own board, so a finished run is only recorded while that
    // board is the one loaded.
    if (run?.phase === 'finished' && getFactoryMode(run.mode).id === rankingMode) ranking.recordRun(run)
  }, [run, rankingMode, ranking.recordRun])

  // Playing a mode switches the board that a finished run will be recorded to.
  useEffect(() => { setRankingMode(getFactoryMode(run?.mode ?? mode).id) }, [run?.mode, mode])

  // A record set before titles existed still counts: report the stored personal
  // best once the leaderboard loads so its achievement settles retroactively.
  const bestFloor = ranking.ownBest?.floor ?? 0
  useEffect(() => {
    if (bestFloor > 0) onFactoryBestFloor?.(bestFloor, rankingMode)
  }, [bestFloor, rankingMode, onFactoryBestFloor])

  useEffect(() => {
    if (run || restoreError) return
    try {
      initialRun.current ??= createFactoryRun({ mode })
      onRunChange(initialRun.current)
      currentRun.current = initialRun.current
    } catch (cause) {
      setError(cause.message || '대여 포켓몬을 준비하지 못했습니다.')
    }
  }, [run, onRunChange, restoreError])

  // Both a newly reached floor and a restored active run count before the next battle.
  useEffect(() => {
    if (run?.floor > 0) onFactoryBestFloor?.(run.floor, run.mode ?? 'standard')
  }, [run?.floor, run?.mode, onFactoryBestFloor])

  function transition(update) {
    // A button from the previous render can still receive a queued second click.
    if (currentRun.current !== run) return
    try {
      const next = update(currentRun.current)
      // Guard repeated clicks and callbacks before React paints the next phase.
      onRunChange(next)
      currentRun.current = next
      setError('')
    } catch (cause) {
      setError(cause.message || '선택 내용을 다시 확인해주세요.')
    }
  }

  if (!run) return <main className="battle-factory" aria-busy={!error && !restoreError}>
    <p role="status">{restoreError || error || '배틀팩토리의 대여 포켓몬을 준비하고 있습니다.'}</p>
    {error && !restoreError && <button type="button" onClick={() => transition(() => createFactoryRun({ mode }))}>다시 준비하기</button>}
    {(error || restoreError) && <button type="button" onClick={onBack}>배틀 선택</button>}
  </main>

  if (active) return <>
    {error && <div role="alert" style={{ position: 'fixed', top: 80, left: '10%', right: '10%', zIndex: 100, background: '#562d36', color: 'white', padding: 12 }}>{error}</div>}
    <BattleScreen
    key={run.battleId}
    initialBattle={run.battleState ?? null}
    skipIntro={Boolean(run.battleState)}
    onCheckpoint={state => {
      const next = checkpointFactoryBattle(currentRun.current, run.battleId, state)
      if (next === currentRun.current) return
      try {
        onRunChange(next)
        currentRun.current = next
        setError('')
      } catch {
        setError('팩토리 진행을 저장하지 못했습니다. 저장 공간을 확인하고 페이지를 닫지 마세요.')
      }
    }}
    competitionLabel={`배틀팩토리 · ${run.floor}층`}
    playerPokemon={run.party}
    playerName={playerName}
    opponent={{ ...FACTORY_TRAINER, teamNumber: run.floor }}
    opponentTeam={run.opponentTeam}
    rules={run.rules}
    soundEnabled={soundEnabled}
    gameSettings={gameSettings}
    playerGender={playerGender}
    audioSettings={audioSettings}
    onToggleSound={onToggleSound}
    onOpenSettings={onOpenSettings}
    onComplete={summary => transition(current => {
      const next = resolveFactoryBattle(current, { ...summary, battleId: run.battleId,
        playerTeamHp: summary.playerTeamHp })
      if (next !== current && next.lastResult?.won) onVpReward?.({
        runId: next.id, battleId: next.battleId, floor: next.floor, mode: next.mode,
        winner: next.lastResult.winner, forfeited: next.lastResult.forfeited,
      })
      return next
    })}
  /></>

  if (showRankings) return <BattleFactoryRankings ranking={ranking} mode={rankingMode} onSelectMode={setRankingMode}
    onBack={() => { setRankingMode(getFactoryMode(run?.mode ?? mode).id); setShowRankings(false) }} />

  return <BattleFactoryLobby
    key={`${run.id}:${run.phase}:${run.floor}`}
    run={run}
    error={error}
    onChooseRentals={ids => transition(current => selectFactoryRentals(current, ids))}
    onChooseLead={id => transition(current => selectFactoryLead(current, id))}
    onStartBattle={() => transition(beginFactoryBattle)}
    onAdvanceFloor={exchange => transition(current => advanceFactoryFloor(current, exchange))}
    onHealParty={() => transition(healFactoryParty)}
    onRerollItem={captureId => transition(current => rerollFactoryHeldItem(current, captureId))}
    onRestart={nextMode => transition(() => {
      const chosen = nextMode ?? mode
      setMode(chosen)
      return createFactoryRun({ mode: chosen })
    })}
    onBack={onBack}
    onOpenRankings={() => setShowRankings(true)}
    rankingError={ranking.recordError}
    onRetryRanking={ranking.retry}
  />
}
