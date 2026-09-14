import { useEffect, useRef, useState } from 'react'
import { turnStepDuration } from './BattleScreen'
import { createRaidBattlePlayback } from './raidBattlePlayback'

export default function useRaidBattlePlayback(raid, gameSettings) {
  const [view, setView] = useState({ raidId: null, battle: null, events: [], cue: null, playing: false, readyVersion: null })
  const controller = useRef(null)
  const settings = useRef(gameSettings)
  settings.current = gameSettings
  useEffect(() => {
    const playback = createRaidBattlePlayback({ publish: setView, duration: cue => {
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      const mode = reduced ? 'skip' : settings.current?.attackAnimation ?? 'normal'
      return cue.phase === 'message' ? (mode === 'skip' ? 80 : 320) : turnStepDuration(cue, mode)
    } })
    controller.current = playback
    return () => { playback.dispose(); controller.current = null }
  }, [])
  useEffect(() => { controller.current?.receive(raid) }, [raid])
  return view
}
