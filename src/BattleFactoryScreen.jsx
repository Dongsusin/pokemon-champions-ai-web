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
  healFactoryPokemon,
  rerollFactoryHeldItem,
} from './data/battleFactory'
import { isFactoryChallengeMode } from './data/battleFactoryChallenge'

export default function BattleFactoryScreen({
  run, onRunChange, onBack, user, soundEnabled = true, gameSettings = {},
  playerGender = 'male', playerName, audioSettings = {}, onToggleSound, onOpenSettings, onVpReward,
  onFactoryBestFloor,
}) {
  const currentRun = useRef(run)
  currentRun.current = run
  const initialRun = useRef(null)
  const [error, setError] = useState('')
  const [mode, setMode] = useState('standard')
  const [showRankings, setShowRankings] = useState(false)
  const ranking = useBattleFactoryRankings(user)
  const active = run?.phase === 'battle'

  useEffect(() => {
    // Challenge runs carry damage between floors, so their floor numbers are not
    // comparable with standard runs and stay off the shared leaderboard.
    if (run?.phase === 'finished' && !isFactoryChallengeMode(run.mode)) ranking.recordRun(run)
  }, [run, ranking.recordRun])

  // A record set before titles existed still counts: report the stored personal
  // best once the leaderboard loads so its achievement settles retroactively.
  const bestFloor = ranking.ownBest?.floor ?? 0
  useEffect(() => {
    if (bestFloor > 0) onFactoryBestFloor?.(bestFloor)
  }, [bestFloor, onFactoryBestFloor])

  useEffect(() => {
    if (run) return
    try {
      initialRun.current ??= createFactoryRun({ mode })
      currentRun.current = initialRun.current
      onRunChange(initialRun.current)
    } catch (cause) {
      setError(cause.message || '대여 포켓몬을 준비하지 못했습니다.')
    }
  }, [run, onRunChange])

  function transition(update) {
    // A button from the previous render can still receive a queued second click.
    if (currentRun.current !== run) return
    try {
      const next = update(currentRun.current)
      // Guard repeated clicks and callbacks before React paints the next phase.
      currentRun.current = next
      onRunChange(next)
      setError('')
    } catch (cause) {
      setError(cause.message || '선택 내용을 다시 확인해주세요.')
    }
  }

  if (!run) return <main className="battle-factory" aria-busy={!error}>
    <p role="status">{error || '배틀팩토리의 대여 포켓몬을 준비하고 있습니다.'}</p>
    {error && <button type="button" onClick={() => transition(() => createFactoryRun({ mode }))}>다시 준비하기</button>}
  </main>

  if (active) return <BattleScreen
    key={run.battleId}
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
        runId: next.id, battleId: next.battleId, floor: next.floor,
        winner: next.lastResult.winner, forfeited: next.lastResult.forfeited,
      })
      return next
    })}
  />

  if (showRankings) return <BattleFactoryRankings ranking={ranking} onBack={() => setShowRankings(false)} />

  return <BattleFactoryLobby
    key={`${run.id}:${run.phase}:${run.floor}`}
    run={run}
    error={error}
    onChooseRentals={ids => transition(current => selectFactoryRentals(current, ids))}
    onChooseLead={id => transition(current => selectFactoryLead(current, id))}
    onStartBattle={() => transition(beginFactoryBattle)}
    onAdvanceFloor={exchange => transition(current => advanceFactoryFloor(current, exchange))}
    onHeal={captureId => transition(current => healFactoryPokemon(current, captureId))}
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
