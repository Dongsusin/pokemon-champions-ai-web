import { useId, useRef, useState } from 'react'
import { ArrowLeft, Building2, Check, ChevronRight, Crown, Swords, Trophy, UsersRound } from 'lucide-react'
import SpriteImage from './SpriteImage'
import TrainerSprite from './TrainerSprite'
import RankedQueueCounts from './RankedQueueCounts'
import { getSpeciesProfile } from './data/trainingData'
import './battleHub.css'

const SELECTION_KEY = 'champions-battle-hub-mode-v1'

function initialMode() {
  try { return sessionStorage.getItem(SELECTION_KEY) || 'ranked' } catch { return 'ranked' }
}

function ModeArtwork({ mode }) {
  return <div className="battle-hub-art" aria-hidden="true">
    <div className="battle-hub-art-orbit" />
    <div className="battle-hub-art-platform" />
    {mode.art.map((actor, index) => <div key={`${mode.id}-${index}`} className={`battle-hub-actor actor-${index}`}>
      {actor.pokemon ? (() => {
        const profile = getSpeciesProfile(actor.pokemon)
        return <SpriteImage src={profile?.spriteFront} fallbackSrc={profile?.spriteFrontFallback} alt="" draggable="false" />
      })() : <TrainerSprite trainer={actor.trainer} isPlayer={!!actor.gender} playerGender={actor.gender} alt="" />}
    </div>)}
    <div className="battle-hub-art-caption"><mode.Icon size={16} /><span>{mode.visualLabel}</span></div>
  </div>
}

export default function BattleHub({ user, onBack, onSelectAi, onSelectRanked, onSelectFactory, onSelectRooms, onSelectRaid }) {
  const [selectedId, setSelectedId] = useState(initialMode)
  const tabRefs = useRef([])
  const panelId = useId()
  const modes = [
    {
      id: 'ranked', Icon: Trophy, label: 'RANKED BATTLE', title: '레이팅 배틀', subtitle: '실력으로 올라가는 챔피언의 자리',
      description: '실제 유저와 승부를 펼치고 나만의 전략을 증명하세요. 몬스터볼부터 마스터볼까지, 승리할수록 더 높은 등급에 도전할 수 있습니다.',
      facts: [['대전 상대', '실제 유저'], ['배틀 형식', '싱글 · 더블'], ['도전 목표', '마스터볼 등급']],
      action: '레이팅에 도전', onSelect: onSelectRanked, background: 'neutral', visualLabel: 'TRAINER VS TRAINER',
      art: [{ pokemon: 6 }, { pokemon: 445 }, { pokemon: 448 }],
    },
    {
      id: 'ai', Icon: Swords, label: 'AI TRAINER BATTLE', title: 'AI 대전', subtitle: '다양한 트레이너, 끝없는 전략 대결',
      description: '개성 있는 AI 트레이너를 상대로 팀의 가능성을 시험하세요. 원하는 배틀 형식과 난이도를 고르고 토너먼트 또는 리그전의 챔피언에 도전하세요.',
      facts: [['토너먼트', '128강 도전'], ['리그전', '8인 리그'], ['배틀 형식', '싱글 · 더블']],
      action: '경기 방식 선택', onSelect: onSelectAi, background: 'grassy', visualLabel: 'CHALLENGE THE CHAMPIONS',
      art: [{ trainer: { name: '레드' } }, { trainer: { name: '난천' } }, { trainer: { name: '단델' } }],
    },
    {
      id: 'factory', Icon: Building2, label: 'BATTLE FACTORY', title: '배틀팩토리', subtitle: '새로운 파트너와 더 높은 층으로',
      description: '랜덤으로 준비된 6마리 중 3마리를 골라 도전을 시작하세요. 승리 후 상대 포켓몬 한 마리와 교환하며 다음 층을 공략할 수 있습니다.',
      facts: [['출전 포켓몬', '6마리 중 3마리'], ['승리 후', '교환 또는 유지'], ['도전 목표', '최고층 도달']],
      action: '팩토리에 도전', onSelect: onSelectFactory, background: 'electric', visualLabel: 'RENT · BATTLE · EXCHANGE',
      art: [{ pokemon: 376 }, { trainer: { id: 'factory-clown', name: '팩토리 삐에로' } }, { pokemon: 254 }],
    },
    {
      id: 'rooms', Icon: UsersRound, label: 'FRIENDLY COMPETITION', title: '대전방', subtitle: '함께 모여 만드는 우리만의 대회',
      description: '친구들과 한 방에 모여 토너먼트 또는 리그전을 즐기세요. 비밀번호로 방을 보호하고, 먼저 경기가 끝났다면 다른 참가자의 대전을 관전할 수 있습니다.',
      facts: [['참가 인원', '2~4명'], ['대회 방식', '토너먼트 · 리그'], ['방 설정', '비밀번호 지원']],
      action: '방 찾기 · 만들기', onSelect: onSelectRooms, background: 'misty', visualLabel: 'BATTLE WITH FRIENDS',
      art: [{ gender: 'male' }, { pokemon: 25 }, { gender: 'female' }],
    },
    ...(onSelectRaid ? [{
      id: 'raid', Icon: Crown, label: 'CO-OP BOSS RAID', title: '협동 보스전', subtitle: '전설에 맞서는 하나의 팀',
      description: '각자 한 마리의 파트너를 데리고 힘을 모으세요. 전초전부터 본체전까지, 함께 전설의 포켓몬에 도전하세요.',
      facts: [['협동 인원', '1~3명'], ['출전 포켓몬', '각자 1마리'], ['전설의 보스', '뮤츠 · 칠색조 · 루기아']],
      action: '보스전에 도전', onSelect: onSelectRaid, background: 'psychic', visualLabel: 'TOGETHER AGAINST LEGENDS',
      art: [{ pokemon: 249 }, { pokemon: 150 }, { pokemon: 250 }],
    }] : []),
  ]
  // A remembered raid selection must never expose a disabled mode.
  const selected = modes.find(mode => mode.id === selectedId) ?? modes[0]
  const selectedIndex = modes.indexOf(selected)

  function selectMode(index, focus = false) {
    const mode = modes[index]
    setSelectedId(mode.id)
    try { sessionStorage.setItem(SELECTION_KEY, mode.id) } catch { /* Selection still works without storage. */ }
    if (focus) tabRefs.current[index]?.focus()
  }

  function handleTabKey(event, index) {
    let next
    if (event.key === 'ArrowRight') next = (index + 1) % modes.length
    else if (event.key === 'ArrowLeft') next = (index - 1 + modes.length) % modes.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = modes.length - 1
    else return
    event.preventDefault()
    selectMode(next, true)
  }

  return (
    <main className={`battle-hub hub-theme-${selected.id}`}>
      <header className="battle-hub-heading">
        <button className="screen-back-button" onClick={onBack} type="button"><ArrowLeft size={18} /> 로비</button>
        <div><span>BATTLE ARENA</span><h1>모드 선택</h1></div>
        <RankedQueueCounts user={user} />
        <span className="battle-hub-position"><strong>{String(selectedIndex + 1).padStart(2, '0')}</strong> / {String(modes.length).padStart(2, '0')}</span>
      </header>
      <nav className="battle-hub-dock" aria-label="배틀 모드 선택">
        <div className="battle-hub-options" role="tablist" aria-label="배틀 종류" aria-orientation="horizontal" style={{ '--hub-mode-count': modes.length }}>
          {modes.map((mode, index) => <button key={mode.id} ref={element => { tabRefs.current[index] = element }} type="button"
            id={`${panelId}-${mode.id}`} role="tab" aria-selected={selected.id === mode.id} aria-controls={panelId}
            tabIndex={selected.id === mode.id ? 0 : -1} className={`battle-hub-card ${mode.id} hub-theme-${mode.id}`}
            onClick={() => selectMode(index)} onKeyDown={event => handleTabKey(event, index)}>
            <mode.Icon className="battle-hub-tab-icon" size={27} />
            <span>{mode.title}</span>
            {selected.id === mode.id && <Check className="battle-hub-tab-check" size={13} aria-hidden="true" />}
          </button>)}
        </div>
      </nav>
      <section id={panelId} role="tabpanel" aria-labelledby={`${panelId}-${selected.id}`} className="battle-hub-feature">
        <div key={selected.id} className="battle-hub-feature-scene" style={{ backgroundImage: `url('/assets/battle-fields/${selected.background}-stadium.jpg')` }} />
        <div className="battle-hub-feature-content" key={`content-${selected.id}`}>
          <div className="battle-hub-copy">
            <div className="battle-hub-overview" role="region" tabIndex={0} aria-label={`${selected.title} 설명`}>
              <span className="battle-hub-mode-label"><selected.Icon size={18} />{selected.label}</span>
              <h2>{selected.title}</h2>
              <h3>{selected.subtitle}</h3>
              <p>{selected.description}</p>
              <dl className="battle-hub-facts">{selected.facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
            </div>
            <button className="battle-hub-enter" type="button" onClick={selected.onSelect}>{selected.action}<ChevronRight size={22} /></button>
          </div>
          <ModeArtwork mode={selected} />
        </div>
      </section>
    </main>
  )
}
