// Local filming harness: shipped RaidScreen and its actual combat engine.
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import RaidScreen from '../../../src/RaidScreen.jsx'
import { createBossOpponent } from '../../../src/data/bossChallenge.js'
import '../../../src/mobileViewport.js'
import 'virtual:boss-capture-styles'

if (!import.meta.env.DEV || location.hostname !== '127.0.0.1') throw Error('Local capture only')
const entries = [
  { speciesId: 248, moves: ['crunch', 'stoneedge', 'earthquake', 'protect'], heldItemId: 'leftovers' },
  { speciesId: 445, moves: ['dragonclaw', 'earthquake', 'rockslide', 'protect'] },
  { speciesId: 6, moves: ['flamethrower', 'airslash', 'dragonpulse', 'roost'] },
  { speciesId: 448, moves: ['aurasphere', 'flashcannon', 'darkpulse', 'protect'] },
  { speciesId: 94, moves: ['shadowball', 'sludgebomb', 'thunderbolt', 'protect'] },
  { speciesId: 131, moves: ['surf', 'icebeam', 'thunderbolt', 'protect'] },
]
const party = entries.map((entry, i) => ({ ...createBossOpponent(entry, `boss-film-${i}`), directDrawCount: 1 }))
const teams = [
  { id: 'team-1', name: '보스 공략 팀', pokemonIds: party.map(p => p.captureId) },
  { id: 'team-2', name: '스페셜 어택 팀', pokemonIds: [party[4],party[3],party[5],party[2],party[1],party[0]].map(p => p.captureId) },
]
window.__captureParty = party
function CaptureApp() {
  const [active,setActive] = useState(false)
  const [teamId,setTeamId] = useState('team-1')
  return <div className={'app-shell ' + (active ? 'battle-view' : 'raid-view')}>
    <RaidScreen boxPokemon={party} teams={teams} activeTeamId={teamId} onSelectTeam={setTeamId}
      onOpenBox={() => {}} onBack={() => {}} onExit={() => {}} onBattleActiveChange={setActive}
      playerName="도전자" soundEnabled={false} gameSettings={{ attackAnimation:'normal', hpBarSpeed:'normal' }} />
  </div>
}
createRoot(document.getElementById('root')).render(<CaptureApp />)
