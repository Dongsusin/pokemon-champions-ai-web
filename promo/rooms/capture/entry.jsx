// Isolated filming entry: shipped room/battle components, real authenticated
// loopback HTTP and engine. No production account, fixtures toolbar or debug UI.
import React, { useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { UsersRound, VolumeX } from 'lucide-react'
import BattleRoomsScreen from '../../../src/BattleRoomsScreen'
import { createRankedClient } from '../../../src/rankedClient'
import '../../../src/styles.css'
import '../../../src/screenRedesign.css'
import '../../../src/battleGen5.css'
import '../../../src/titleCleanup.css'
import '../../../src/battleGimmicks.css'
import '../../../src/moveAnimationDirector.css'
import '../../../src/mobileLandscape.css'
import '../../../src/auth.css'

if (!import.meta.env.DEV || location.hostname !== '127.0.0.1') throw Error('Local filming only')
const fixture = window.__roomsCaptureFixture
function Capture() {
  const [activeTeamId, setActiveTeamId] = useState('team-1')
  const [battleActive, setBattleActive] = useState(false)
  const client = useMemo(() => {
    const actual = createRankedClient({ apiUrl: `${location.origin}/api/ranked`, getIdToken: async () => fixture.token })
    const request = async (...args) => {
      const value = await actual.request(...args)
      window.__roomsCaptureSnapshot = value
      return value
    }
    const result = { request, status: (payload, options) => request('status', payload, options) }
    window.__roomsCaptureClient = result
    return result
  }, [])
  return <div className={`app-shell rooms-view${battleActive ? ' battle-view' : ''}`}>
    <header className="topbar">
      <div className="brand"><span className="brand-mark"><img src="/assets/brand/champions-arena-emblem.png" alt="" /></span><span className="brand-title"><small>POKÉMON</small><strong>CHAMPIONS ARENA</strong></span></div>
      <div className="top-status"><span className="player-account"><span className="player-account-avatar"><UsersRound size={22} /></span><span className="player-account-copy"><small>TRAINER</small><strong>{fixture.user.displayName}</strong></span></span><button type="button" className="icon-button" aria-label="배경음악 꺼짐"><VolumeX size={22} /></button></div>
    </header>
    <BattleRoomsScreen user={fixture.user} enabled client={client} teams={fixture.teams} boxPokemon={fixture.pokemon} activeTeamId={activeTeamId}
      onSelectTeam={setActiveTeamId} onOpenBox={() => {}} onBack={() => {}} onBeforeJoin={async () => true}
      soundEnabled={false} gameSettings={{ attackAnimation: 'normal', hpBarSpeed: 'normal' }} onBattleActiveChange={setBattleActive} />
  </div>
}
createRoot(document.getElementById('root')).render(<Capture />)
