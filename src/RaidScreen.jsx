import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Boxes, Crown, Play, RotateCcw } from 'lucide-react'
import BattleScreen from './BattleScreen'
import PokemonSprite from './PokemonSprite'
import { BOSS_CHALLENGES, createBossChallengeBattle } from './data/bossChallenge'
import { getSpeciesProfile } from './data/trainingData'
import { getBattleItem } from './data/shopData'
import './bossChallenge.css'

const MECHANICS = {
  mewtwo: ['50%: 아머드 뮤츠로 폼체인지', '25%: 메가뮤츠 X / Y 중 랜덤 메가진화'],
  hooh: ['50%: 엔테이·스이쿤·라이코 중 1마리 부활', '25%: 중복 없이 1마리 추가 부활 · 살아 있는 부활 포켓몬을 모두 처치할 때까지 칠색조 무적'],
  lugia: ['50%: 다크루기아로 폼체인지', '25%: 전투가 끝날 때까지 변경 불가능한 비'],
}

export default function RaidScreen({ boxPokemon, teams = [], activeTeamId, onSelectTeam, onOpenBox,
  selectedBossId, onSelectBoss, onBack, onBattleActiveChange, playerName = '트레이너',
  soundEnabled, gameSettings, audioSettings, onToggleSound, onOpenSettings }) {
  const [localBossId, setLocalBossId] = useState('mewtwo')
  const bossId = selectedBossId ?? localBossId
  const setBossId = onSelectBoss ?? setLocalBossId
  const team = teams.find(entry => entry.id === activeTeamId) ?? teams[0]
  const party = (team?.pokemonIds ?? []).map(id => boxPokemon.find(pokemon => pokemon.captureId === id)).filter(Boolean)
  const teamReady = party.length === 6 && new Set(party.map(pokemon => pokemon.captureId)).size === 6
  const [run, setRun] = useState(null)
  const [error, setError] = useState('')
  const current = useRef(run)
  current.current = run
  const boss = BOSS_CHALLENGES.find(b => b.id === (run?.bossId ?? bossId))
  const active = run?.phase === 'battle'
  useEffect(() => { onBattleActiveChange?.(active); return () => onBattleActiveChange?.(false) }, [active, onBattleActiveChange])

  function startRound(party, round, id) {
    try {
      const battle = createBossChallengeBattle({ bossId: id, round, party, playerName })
      const next = { bossId: id, party: structuredClone(party), round, phase: 'battle', battle }
      current.current = next; setRun(next); setError('')
    } catch (cause) { setError(cause.message) }
  }
  function complete(summary) {
    if (current.current !== run || run.phase !== 'battle') return
    const next = { ...run, phase: summary.winner !== 'player' ? 'lost' : run.round === 3 ? 'won' : 'interval' }
    current.current = next; setRun(next)
  }
  if (active) return <BattleScreen key={`${run.bossId}-${run.round}`}
    initialBattle={run.battle} playerPokemon={run.party} playerName={playerName}
    opponent={run.battle.opponentMeta} opponentTeam={{ pokemon: run.battle.opponent.team }} rules={run.battle.rules}
    competitionLabel={`${boss.name} 보스전 · ROUND ${run.round} / 3`}
    soundEnabled={soundEnabled} gameSettings={gameSettings} playerGender={gameSettings?.playerGender}
    audioSettings={audioSettings} onToggleSound={onToggleSound} onOpenSettings={onOpenSettings} onComplete={complete} />

  return <main className="boss-challenge">
    <header><button type="button" onClick={onBack}><ArrowLeft size={18} /> 배틀 모드</button><span>BOSS CHALLENGE · 3 ROUNDS</span></header>
    {run ? <section className="boss-challenge-result">
      <Crown size={44} /><h1>{run.phase === 'won' ? `${boss.name} 격파 성공!` : run.phase === 'lost' ? '도전 종료' : `라운드 ${run.round} 클리어!`}</h1>
      <p>{run.phase === 'interval' ? `팀의 HP·PP·상태·배틀 기믹을 회복하고 ${boss.rounds[run.round].name}에게 도전합니다.` : `${boss.name} 보스전 · ${run.round} / 3 라운드`}</p>
      {error && <p role="alert">{error}</p>}
      {run.phase === 'interval' ? <button type="button" className="boss-primary" onClick={() => {
        if (current.current === run) startRound(run.party, run.round + 1, run.bossId)
      }}><Play size={18} /> 다음 라운드</button> : <button type="button" onClick={() => { setRun(null); setError('') }}><RotateCcw size={18} /> 다시 준비하기</button>}
    </section> : <>
      <div className="boss-challenge-title"><Crown size={30} /><h1>전설의 보스에 도전</h1><p>내 포켓몬 6마리로 3라운드를 돌파하세요.</p></div>
      <section className="boss-challenge-party" aria-label="저장된 출전 팀">
        <header><h2>{team?.name ?? '출전 팀'} <span>{party.length} / 6</span></h2>
          <button type="button" onClick={onOpenBox}><Boxes size={18} /> 팀 편성</button></header>
        <nav className="boss-team-switcher" aria-label="출전 팀 변경">{teams.map((entry, index) => <button
          type="button" key={entry.id} aria-pressed={entry.id === team?.id} onClick={() => onSelectTeam?.(entry.id)}>
          <strong>{entry.name || `팀 ${index + 1}`}</strong><small>{entry.pokemonIds.filter(id => boxPokemon.some(p => p.captureId === id)).length} / 6</small>
        </button>)}</nav>
        <p>저장된 팀의 편성 순서대로 출전합니다. 처음 2마리가 더블배틀 선봉입니다.</p>
        <ol className="boss-party-slots">{Array.from({ length: 6 }, (_, index) => {
          const pokemon = party[index]
          return <li key={index}><small>{index + 1}번{index < 2 ? ' · 선봉' : ''}</small>{pokemon ? <>
            <PokemonSprite animatedSrc={pokemon.spriteFront} fallbackSrc={pokemon.spriteFrontFallback} alt={pokemon.name} />
            <strong>{pokemon.name}</strong><small>{pokemon.heldItemId ? getBattleItem(pokemon.heldItemId).name : '도구 없음'}</small>
          </> : <span>빈 슬롯</span>}</li>
        })}</ol>
        {!teamReady && <p role="status">팀 편성에서 포켓몬 6마리를 등록해주세요.</p>}
      </section>
      <section className="boss-challenge-choices" aria-label="보스 선택">{BOSS_CHALLENGES.map(candidate => {
        const profile = getSpeciesProfile(candidate.speciesId)
        return <button type="button" aria-pressed={candidate.id === bossId} key={candidate.id} onClick={() => setBossId(candidate.id)}>
          <PokemonSprite animatedSrc={profile.spriteFront} fallbackSrc={profile.spriteFrontFallback} alt={candidate.name} />
          <strong>{candidate.name}</strong><small>{candidate.subtitle}</small>
        </button>
      })}</section>
      <section className="boss-challenge-rules" aria-label="라운드와 보스 기믹">
        <ol>{boss.rounds.map((round, i) => <li key={round.name}><span>ROUND {i + 1}</span><strong>{round.name}</strong><small>6대{round.pokemon.length} {round.format === 'double' ? '더블배틀' : '싱글배틀'}</small></li>)}</ol>
        <p>보스 시작 HP·능력치 1배 · 한 번의 공격 전체 피해는 최대 HP의 25%까지 · HP 구간을 건너뛰는 피해 차단</p>
        <ul><li>75%: HP·공격·방어·특공·특방·스피드 1단계 상승</li>{MECHANICS[bossId].map(text => <li key={text}>{text}</li>)}</ul>
        <small>HP 1단계는 최대 HP 1.5배이며 현재 HP 비율을 유지합니다. 라운드 사이에는 팀을 전부 회복합니다.</small>
      </section>
      {error && <p role="alert">{error}</p>}
      <footer><button type="button" className="boss-primary" disabled={!teamReady} onClick={() => {
        if (current.current) return
        startRound(party, 1, bossId)
      }}><Play size={18} /> {boss.name}에게 도전</button></footer>
    </>}
  </main>
}
