import { useEffect, useMemo, useState } from 'react'
import BattleRoomsScreen from './BattleRoomsScreen'
import { createRankedClient, isRankedLocalTest } from './rankedClient'

// This launcher uses only the explicitly enabled loopback test server. Production
// authentication never accepts these identities, and real account saves are unused.
export default function BattleRoomsTestLobby(props) {
  const [identity, setIdentity] = useState(() => {
    const candidate = new URLSearchParams(window.location.search).get('roomPlayer')
    return ['alice', 'bob', 'charlie', 'dave'].includes(candidate) ? candidate : 'alice'
  })
  const [fixtures, setFixtures] = useState([])
  const [teamId, setTeamId] = useState(null)
  const [error, setError] = useState('')
  const client = useMemo(() => isRankedLocalTest ? createRankedClient({
    getIdToken: async () => `ranked-test-${identity}`,
  }) : null, [identity])
  useEffect(() => {
    if (!client) return undefined
    const controller = new AbortController()
    client.request('fixtures', {}, { signal: controller.signal }).then(result => {
      setFixtures(result.teams ?? [])
      setTeamId(result.teams?.[0]?.id ?? null)
      setError('')
    }).catch(failure => { if (!controller.signal.aborted) setError(failure.message) })
    return () => controller.abort()
  }, [client])
  if (!client) return null
  const boxPokemon = fixtures.flatMap(team => team.pokemon)
  const teams = fixtures.map(team => ({ ...team, pokemonIds: team.pokemon.map(pokemon => pokemon.captureId) }))
  return <>
    <nav className="rooms-local-controls" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 20px', background: '#102536' }}>
      <strong>로컬 전용 대전방 테스트</strong>
      <label>테스트 참가자 <select aria-label="테스트 참가자" value={identity} onChange={event => setIdentity(event.target.value)}>
        {['alice', 'bob', 'charlie', 'dave'].map(name => <option key={name} value={name}>{name}</option>)}
      </select></label>
      <small>각 창에서 서로 다른 참가자를 선택하세요.</small>
    </nav>
    {error ? <p role="alert">{error}</p> : fixtures.length > 0 ? <BattleRoomsScreen {...props} key={identity}
      enabled client={client} user={{ uid: `ranked-test-${identity}` }}
      teams={teams} boxPokemon={boxPokemon} activeTeamId={teamId} onSelectTeam={setTeamId}
      onBeforeJoin={async () => true} /> : <p role="status">로컬 테스트 팀을 불러오는 중입니다.</p>}
  </>
}
