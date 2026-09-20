import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Boxes, Check, Crown, Gem, ShieldCheck, Package, Play } from 'lucide-react'
import BattleScreen from './BattleScreen'
import PokemonSprite from './PokemonSprite'
import SpriteImage from './SpriteImage'
import RankedTeamRoster from './RankedTeamRoster'
import './ranked.css'
import { BOSS_CHALLENGES, createBossChallengeBattle } from './data/bossChallenge'
import { getSpeciesProfile, typeClassName } from './data/trainingData'
import { getBattleItem } from './data/shopData'
import './bossChallenge.css'

export default function RaidScreen({ boxPokemon, teams = [], activeTeamId, onSelectTeam, onOpenBox,
  onBossClear, selectedBossId, onSelectBoss, onBack, onExit, onBattleActiveChange, playerName = '트레이너',
  soundEnabled, gameSettings, audioSettings, onToggleSound, onOpenSettings }) {
  const [localBossId, setLocalBossId] = useState('mewtwo')
  const bossId = selectedBossId ?? localBossId
  const setBossId = onSelectBoss ?? setLocalBossId
  const team = teams.find(entry => entry.id === activeTeamId) ?? teams[0]
  const party = (team?.pokemonIds ?? []).map(id => boxPokemon.find(pokemon => pokemon.captureId === id)).filter(Boolean)
  const teamReady = party.length === 6 && new Set(party.map(pokemon => pokemon.captureId)).size === 6
  const [run, setRun] = useState(null)
  const [error, setError] = useState('')
  const [rewardRetry, setRewardRetry] = useState(null)
  const current = useRef(run)
  current.current = run
  const boss = BOSS_CHALLENGES.find(b => b.id === (run?.bossId ?? bossId))
  const active = run?.phase === 'battle'
  useEffect(() => { onBattleActiveChange?.(active); return () => onBattleActiveChange?.(false) }, [active, onBattleActiveChange])
  useEffect(() => {
    // Warm every round during team selection so automatic transitions keep their scenery.
    boss.rounds.forEach(encounter => {
      const image = new Image()
      image.decoding = 'async'
      image.src = encounter.background.src
      image.decode?.().catch(() => {})
    })
  }, [boss])

  function startRound(party, round, id, previousPlayerTeam = null) {
    try {
      const battle = createBossChallengeBattle({ bossId: id, round, party, playerName, previousPlayerTeam })
      const next = { bossId: id, party: structuredClone(party), round, phase: 'battle', battle }
      current.current = next; setRun(next); setError('')
    } catch (cause) { setError(cause.message) }
  }
  function complete(summary, finishedBattle) {
    if (current.current !== run || run?.phase !== 'battle') return
    if (summary.winner === 'player' && run.round < 3) {
      startRound(run.party, run.round + 1, run.bossId, finishedBattle.player.team)
      return
    }
    if (summary.winner === 'player' && run.round === 3) {
      if (onBossClear?.({ bossId: run.bossId, round: run.round, winner: summary.winner, forfeited: summary.forfeited }) === false) {
        setRewardRetry({ summary, finishedBattle }); return
      }
    }
    setRewardRetry(null)
    current.current = null
    setRun(null)
    onBattleActiveChange?.(false)
    onExit?.()
  }
  if (active) return <><BattleScreen key={`${run.bossId}-${run.round}`}
    initialBattle={run.battle} skipIntro={run.round > 1} startWithDialogue={run.round > 1} hideResult onResolved={complete}
    battleBackground={boss.rounds[run.round - 1].background}
    playerPokemon={run.party} playerName={playerName}
    opponent={run.battle.opponentMeta} opponentTeam={{ pokemon: run.battle.opponent.team }} rules={run.battle.rules}
    competitionLabel={`${boss.name} 보스전 · ROUND ${run.round} / 3`}
    soundEnabled={soundEnabled} gameSettings={gameSettings} playerGender={gameSettings?.playerGender}
    audioSettings={audioSettings} onToggleSound={onToggleSound} onOpenSettings={onOpenSettings} onComplete={complete} />
    {rewardRetry && <div role="alert" style={{ position: 'fixed', zIndex: 1000, inset: '40% 20% auto', padding: 24, background: '#102e42', border: '1px solid #82dce0', borderRadius: 12 }}>
      <p>승리 보상을 저장하지 못했습니다. 저장을 다시 시도해 주세요.</p>
      <button type="button" onClick={() => complete(rewardRetry.summary, rewardRetry.finishedBattle)}>보상 저장 다시 시도</button>
    </div>}</>

  return <main className="boss-challenge">
    <header className="boss-page-header"><button type="button" onClick={onBack}><ArrowLeft size={18} /> 배틀 모드</button><div><span>BOSS CHALLENGE</span><h1>보스전</h1></div><div className="boss-ready-badge"><ShieldCheck size={22} /><span><small>{teamReady ? '출전 준비 완료' : '팀 편성 필요'}</small><strong>{party.length}/6</strong></span></div></header>
      <div className="boss-selection-workspace">
      <section className="boss-challenge-party" aria-label="저장된 출전 팀">
        <header><div><small>CURRENT BATTLE PARTY</small><h2>{team?.name ?? '출전 팀'}</h2></div><strong>{party.length}<small>/6</small></strong></header>
        <nav className="boss-team-switcher" aria-label="출전 팀 변경">{teams.map((entry, index) => <button
          type="button" key={entry.id} aria-pressed={entry.id === team?.id} onClick={() => onSelectTeam?.(entry.id)}>
          <span><small>TEAM</small><strong>{index + 1}</strong></span><small>{entry.pokemonIds.filter(id => boxPokemon.some(p => p.captureId === id)).length} / 6</small>
        </button>)}</nav>

        <RankedTeamRoster pokemon={party} className="boss-party-roster" showDynamax renderCard={(pokemon, index, profile) => {
          const teraType = pokemon.teraType ?? profile.types[0]
          return <>
            <small className="boss-slot-number">{String(index + 1).padStart(2, '0')}</small><SpriteImage className="boss-party-icon" src={pokemon.icon ?? profile.icon} fallbackSrc={pokemon.iconFallback ?? profile.iconFallback} alt="" />
            <span className="boss-party-copy">

              <strong>{pokemon.name}</strong><small>Lv.{pokemon.level ?? 50} · {(pokemon.types ?? profile.types).join(' / ')}</small>
              <span className="boss-party-loadout">
                <span><Package size={11} />{getBattleItem(pokemon.heldItemId)?.name ?? '도구 없음'}</span>
                <span className={`type-${typeClassName(teraType)}`}><Gem size={11} />테라 {teraType}</span>
              </span>
            </span>
          </>
        }} />
<footer className="boss-team-footer"><span><Check size={14} />{teamReady ? '6마리 출전 등록 완료' : '포켓몬 6마리를 편성하세요'}</span><button type="button" onClick={onOpenBox}><Boxes size={16} /> 팀 편성</button></footer>
      </section>
      <section className="boss-selection-panel"><header><div><small>SELECT BOSS CHALLENGE</small><h2>도전할 보스를 선택하세요</h2></div><span className="boss-round-badge"><Crown size={18} /> 3 ROUNDS</span></header><section className="boss-challenge-choices" aria-label="보스 선택">{BOSS_CHALLENGES.map(candidate => {
        const profile = getSpeciesProfile(candidate.speciesId)
        return <button type="button" aria-pressed={candidate.id === bossId} key={candidate.id} onClick={() => setBossId(candidate.id)}>
          <PokemonSprite animatedSrc={profile.spriteFront} fallbackSrc={profile.spriteFrontFallback} alt={candidate.name} />
          <span className="boss-choice-copy"><small>BOSS CHALLENGE</small><strong>{candidate.name}</strong><small>{candidate.subtitle}</small></span><span className="boss-choice-status">{candidate.id === bossId ? <><Check size={18} /> 선택됨</> : '선택'}</span>
        </button>
      })}</section>
      {error && <p role="alert">{error}</p>}
      <footer className="boss-start-footer"><span><Crown size={26} /><span><small>SELECTED BOSS</small><strong>{boss.name} · 3라운드 연속 배틀</strong></span></span><button type="button" className="boss-primary" disabled={!teamReady} onClick={() => {
        if (current.current) return
        startRound(party, 1, bossId)
      }}><Play size={18} /> {boss.name}에게 도전</button></footer></section></div>
  </main>
}
