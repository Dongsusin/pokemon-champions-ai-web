import { ArrowLeft, ArrowLeftRight, Building2, ChevronRight, Crown, Swords, Trophy, UsersRound } from 'lucide-react'
import './battleHub.css'

export default function BattleHub({ onBack, onSelectAi, onSelectRanked, onSelectFactory, onSelectRooms, onSelectRaid }) {
  const modes = [
    { id: 'ranked', Icon: Trophy, label: 'RANKED BATTLE', title: '레이팅 배틀', description: '실제 유저와 승부를 펼치고 몬스터볼부터 마스터볼까지 올라가세요.', tags: ['실제 유저 대전', '싱글 · 더블'], action: '레이팅에 도전', onSelect: onSelectRanked },
    { id: 'ai', Icon: Swords, label: 'AI TRAINER BATTLE', title: 'AI 대전', description: '개성 있는 AI 트레이너와 대결하고 토너먼트·리그전의 챔피언에 도전하세요.', tags: ['128강 토너먼트', '8인 리그전'], action: '경기 방식 선택', onSelect: onSelectAi },
    { id: 'factory', Icon: Building2, label: 'BATTLE FACTORY', title: '배틀팩토리', description: '랜덤 파트너를 선택하고 승리한 상대와 교환하며 다음 층에 도전하세요.', tags: ['3 대 3 AI 대전', '승리 후 교환'], action: '팩토리에 도전', onSelect: onSelectFactory },
    { id: 'rooms', Icon: UsersRound, label: 'FRIENDLY COMPETITION', title: '대전방', description: '친구들과 모여 토너먼트 또는 리그전으로 승부를 겨루세요.', tags: ['2~4인 대회', '비밀번호 설정'], action: '방 찾기 · 만들기', onSelect: onSelectRooms },
    ...(onSelectRaid ? [{ id: 'raid', Icon: Crown, label: 'CO-OP BOSS RAID', title: '협동 보스전', description: '한 마리씩 출전해 힘을 모으고 전설의 보스와 두 단계 전투를 펼치세요.', tags: ['1~3인 협동', '전설 보스 3종'], action: '보스전에 도전', onSelect: onSelectRaid }] : []),
  ]
  return (
    <main className="battle-hub">
      <header className="battle-hub-heading">
        <button className="screen-back-button" onClick={onBack} type="button"><ArrowLeft size={19} /> 로비</button>
        <div><span>BATTLE ARENA</span><h1>어떤 배틀에 도전할까요?</h1><p>혼자 도전하거나 함께 승부를 펼치세요. 원하는 배틀을 선택하세요.</p></div>
      </header>
      <section className={`battle-hub-options${onSelectRaid ? ' has-raid' : ''}`} aria-label="배틀 종류">
        {modes.map(({ id, Icon, label, title, description, tags, action, onSelect }) => <button key={id} type="button" className={`battle-hub-card ${id}`} onClick={onSelect}>
          <div className="battle-hub-card-heading"><span className="battle-hub-emblem"><Icon size={34} /></span><div><small>{label}</small><h2>{title}</h2></div></div>
          <p>{description}</p>
          <span className="battle-hub-tags">{tags.map(tag => <span key={tag}>{tag === '승리 후 교환' && <ArrowLeftRight size={14} />}{tag}</span>)}</span>
          <strong>{action}<ChevronRight size={19} /></strong>
        </button>)}
      </section>
    </main>
  )
}
