import { ArrowLeft, ArrowLeftRight, Building2, ChevronRight, Swords, Trophy, UsersRound } from 'lucide-react'
import './battleHub.css'

export default function BattleHub({ onBack, onSelectAi, onSelectRanked, onSelectFactory }) {
  return (
    <main className="battle-hub">
      <header className="battle-hub-heading">
        <button className="screen-back-button" onClick={onBack} type="button"><ArrowLeft size={19} /> 로비</button>
        <div><span>BATTLE ARENA</span><h1>어떤 배틀에 도전할까요?</h1><p>유저와의 승부, AI 챔피언 도전, 랜덤 팀으로 오르는 배틀팩토리.</p></div>
      </header>
      <section className="battle-hub-options" aria-label="배틀 종류">
        <button type="button" className="battle-hub-card ranked" onClick={onSelectRanked}>
          <span className="battle-hub-emblem"><Trophy size={48} /></span>
          <small>RANKED BATTLE</small><h2>레이팅 배틀</h2>
          <p>실제 유저와 매칭해 승부를 펼치고{' '}<br />몬스터볼부터 마스터볼까지 올라가세요.</p>
          <span className="battle-hub-tags"><span><UsersRound size={15} /> 실제 유저 대전</span><span>싱글 · 더블</span></span>
          <strong>레이팅에 도전 <ChevronRight size={20} /></strong>
        </button>
        <button type="button" className="battle-hub-card ai" onClick={onSelectAi}>
          <span className="battle-hub-emblem"><Swords size={48} /></span>
          <small>AI TRAINER BATTLE</small><h2>AI 대전</h2>
          <p>개성 있는 AI 트레이너와 대결하며{' '}<br />토너먼트와 리그전의 챔피언에 도전하세요.</p>
          <span className="battle-hub-tags"><span>128강 토너먼트</span><span>8인 리그전</span></span>
          <strong>경기 방식 선택 <ChevronRight size={20} /></strong>
        </button>
        <button type="button" className="battle-hub-card factory" onClick={onSelectFactory}>
          <span className="battle-hub-emblem"><Building2 size={48} /></span>
          <small>BATTLE FACTORY</small><h2>배틀팩토리</h2>
          <p>랜덤 포켓몬 6마리 중 3마리를 선택하고{' '}<br />승리한 상대와 교환하며 다음 층에 도전하세요.</p>
          <span className="battle-hub-tags"><span>3 대 3 AI 대전</span><span><ArrowLeftRight size={15} /> 승리 후 교환</span></span>
          <strong>팩토리에 도전 <ChevronRight size={20} /></strong>
        </button>
      </section>
    </main>
  )
}
