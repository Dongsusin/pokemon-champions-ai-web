import { useState } from 'react'
import { GameApp } from './App'
import { normalizePokemon } from './data/trainingData'
import { createSavedTeams } from './data/teamData'
import { isPokemonUsageDemo } from './pokemonUsageClient'

// Only the explicit loopback test launcher selects this entry. It bypasses
// Firebase login entirely and stores its party on a separate localhost origin.
export default function UsageTestApp() {
  const [ready] = useState(() => {
    if (!isPokemonUsageDemo) return false
    if (localStorage.getItem('champions-usage-demo-party-v2') === 'ready') return true
    const pokemon = [25, 6, 9, 3, 94, 143, 149, 445, 448, 248, 131, 59]
      .map(speciesId => normalizePokemon({ speciesId, captureId: `dex-${speciesId}`, directDrawCount: 1 }))
    const teams = createSavedTeams(pokemon.slice(0, 6).map(entry => entry.captureId), pokemon.map(entry => entry.captureId))
    teams[1].pokemonIds = pokemon.slice(6).map(entry => entry.captureId)
    localStorage.setItem('champions-dex-v2', JSON.stringify(pokemon))
    localStorage.setItem('champions-teams-v1', JSON.stringify({ activeTeamId: 'team-1', teams }))
    localStorage.setItem('champions-vp-v1', '30000')
    localStorage.setItem('champions-draw-tutorial-v1', 'complete')
    localStorage.setItem('champions-settings-v1', JSON.stringify({ audio: { enabled: false }, game: { attackAnimation: 'fast', hpBarSpeed: 'fast' } }))
    localStorage.setItem('champions-usage-demo-party-v2', 'ready')
    return true
  })
  if (!ready) return null
  return <GameApp user={{ uid: 'pokemon-usage-local', displayName: '사용률 테스트', isLocalGuest: true }} />
}
