import { useEffect, useRef, useState } from 'react'
import BattleScreen from './BattleScreen'
import BattleFactoryLobby from './BattleFactoryLobby'
import {
  FACTORY_TRAINER,
  createFactoryRun,
  selectFactoryRentals,
  beginFactoryBattle,
  resolveFactoryBattle,
  advanceFactoryFloor,
} from './data/battleFactory'

export default function BattleFactoryScreen({
  run, onRunChange, onBack, soundEnabled = true, gameSettings = {},
  playerGender = 'male', audioSettings = {}, onToggleSound, onOpenSettings,
}) {
  const currentRun = useRef(run)
  currentRun.current = run
  const initialRun = useRef(null)
  const [error, setError] = useState('')
  const active = run?.phase === 'battle'

  useEffect(() => {
    if (run) return
    try {
      initialRun.current ??= createFactoryRun()
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
    {error && <button type="button" onClick={() => transition(() => createFactoryRun())}>다시 준비하기</button>}
  </main>

  if (active) return <BattleScreen
    key={run.battleId}
    competitionLabel={`배틀팩토리 · ${run.floor}층`}
    playerPokemon={run.party}
    opponent={{ ...FACTORY_TRAINER, teamNumber: run.floor }}
    opponentTeam={run.opponentTeam}
    rules={run.rules}
    soundEnabled={soundEnabled}
    gameSettings={gameSettings}
    playerGender={playerGender}
    audioSettings={audioSettings}
    onToggleSound={onToggleSound}
    onOpenSettings={onOpenSettings}
    onComplete={summary => transition(current => resolveFactoryBattle(current, { ...summary, battleId: run.battleId }))}
  />

  return <BattleFactoryLobby
    key={`${run.id}:${run.phase}:${run.floor}`}
    run={run}
    error={error}
    onChooseRentals={ids => transition(current => selectFactoryRentals(current, ids))}
    onStartBattle={() => transition(beginFactoryBattle)}
    onAdvanceFloor={exchange => transition(current => advanceFactoryFloor(current, exchange))}
    onRestart={() => transition(() => createFactoryRun())}
    onBack={onBack}
  />
}
