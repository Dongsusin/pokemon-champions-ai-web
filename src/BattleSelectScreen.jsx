import { useMemo, useState } from 'react'
import {
  ArrowLeft,
  Boxes,
  Check,
  ChevronRight,
  Crown,
  Gem,
  Medal,
  Package,
  ShieldCheck,
  Sparkles,
  Swords,
  Trophy,
  UsersRound,
} from 'lucide-react'
import { BATTLE_ITEMS } from './data/shopData'
import { BATTLE_TEAM_SIZE } from './data/teamData'
import { typeClassName } from './data/trainingData'

const ITEM_BY_ID = new Map(BATTLE_ITEMS.map((item) => [item.id, item]))

const BATTLE_MODES = [
  {
    id: 'tournament',
    eyebrow: '128 TRAINER KNOCKOUT',
    title: '128강 토너먼트',
    description: '단 한 번의 패배도 허용되지 않는 7라운드 단판 승부입니다.',
    detail: '128명의 트레이너 중 마지막 한 명이 되어 챔피언 타이틀을 차지하세요.',
    meta: ['7 ROUNDS', 'SINGLE ELIMINATION', 'CHAMPION MATCH'],
    icon: Trophy,
    accent: 'lime',
  },
  {
    id: 'league',
    eyebrow: '8 TRAINER LEAGUE',
    title: '8인 리그전',
    description: '8명의 트레이너가 모두 맞붙는 7경기 순위 경쟁입니다.',
    detail: '승수와 득실을 쌓아 정규 리그 1위를 노리는 장기전 모드입니다.',
    meta: ['7 MATCHES', 'ROUND ROBIN', 'LEAGUE TABLE'],
    icon: UsersRound,
    accent: 'violet',
  },
]

function fallbackImageHandler(fallback) {
  return (event) => {
    if (!fallback || event.currentTarget.dataset.fallbackApplied) return
    event.currentTarget.dataset.fallbackApplied = 'true'
    event.currentTarget.src = fallback
  }
}

function BattleSelectScreen({
  pokemon,
  teams,
  activeTeamId,
  onBack,
  onOpenBox,
  onSelectTeam,
  onStartMode,
}) {
  const [selectedModeId, setSelectedModeId] = useState(BATTLE_MODES[0].id)
  const activeTeam = teams.find((team) => team.id === activeTeamId) ?? teams[0]
  const activeTeamPokemon = useMemo(() => (
    (activeTeam?.pokemonIds ?? [])
      .map((captureId) => pokemon.find((entry) => entry.captureId === captureId))
      .filter(Boolean)
  ), [activeTeam?.pokemonIds, pokemon])
  const selectedMode = BATTLE_MODES.find((mode) => mode.id === selectedModeId) ?? BATTLE_MODES[0]
  const partySlots = Array.from(
    { length: BATTLE_TEAM_SIZE },
    (_, index) => activeTeamPokemon[index] ?? null,
  )
  const isBattleReady = activeTeamPokemon.length === BATTLE_TEAM_SIZE

  return (
    <main className="battle-select-screen">
      <header className="battle-select-header">
        <button className="screen-back-button" type="button" aria-label="로비로 돌아가기" onClick={onBack}>
          <ArrowLeft size={19} />
          <span>로비</span>
        </button>

        <div className="battle-select-title">
          <span>BATTLE CHALLENGE</span>
          <h1>배틀 모드 선택</h1>
          <p>출전 팀을 확인하고 AI 트레이너와 겨룰 경기 방식을 선택하세요.</p>
        </div>

        <div className={`battle-ready-badge${isBattleReady ? ' ready' : ''}`}>
          <ShieldCheck size={18} />
          <span>{isBattleReady ? '출전 준비 완료' : '팀 편성 필요'}</span>
          <strong>{activeTeamPokemon.length}/{BATTLE_TEAM_SIZE}</strong>
        </div>
      </header>

      <section className="battle-select-workspace">
        <aside className="battle-party-preview-panel" aria-label="현재 출전 팀">
          <div className="battle-party-preview-heading">
            <div>
              <span>CURRENT BATTLE PARTY</span>
              <h2>{activeTeam?.name ?? '팀 1'}</h2>
            </div>
            <strong>{activeTeamPokemon.length}<em>/{BATTLE_TEAM_SIZE}</em></strong>
          </div>

          <div className="battle-team-switcher" aria-label="출전 팀 변경">
            {teams.map((team, index) => (
              <button
                className={team.id === activeTeam?.id ? 'selected' : ''}
                type="button"
                aria-label={`${team.name}, ${team.pokemonIds.length}마리`}
                aria-pressed={team.id === activeTeam?.id}
                key={team.id}
                onClick={() => onSelectTeam(team.id)}
              >
                <small>TEAM</small>
                <strong>{index + 1}</strong>
                <span>{team.pokemonIds.length}/{BATTLE_TEAM_SIZE}</span>
              </button>
            ))}
          </div>

          <div className="battle-party-preview-list">
            {partySlots.map((entry, index) => (
              entry ? (
                <article className={`battle-party-preview-card${entry.isShiny ? ' is-shiny' : ''}`} key={entry.captureId}>
                  <span className="battle-party-slot-number">{String(index + 1).padStart(2, '0')}</span>
                  {entry.isShiny && <span className="pokemon-shiny-mark" aria-label="이로치">★</span>}
                  <span className="pokemon-icon-frame battle-party-icon-frame" aria-hidden="true">
                    <img
                      className="pokemon-box-icon"
                      src={entry.icon}
                      alt=""
                      draggable="false"
                      onError={fallbackImageHandler(entry.iconFallback)}
                    />
                  </span>
                  <span className="battle-party-card-copy">
                    <strong>{entry.name}</strong>
                    <small>Lv.50 · {entry.types.join(' / ')}</small>
                    <span>
                      {entry.heldItemId && ITEM_BY_ID.has(entry.heldItemId) ? (
                        <em><Package size={10} /> {ITEM_BY_ID.get(entry.heldItemId).name}</em>
                      ) : (
                        <em className="empty"><Package size={10} /> 도구 없음</em>
                      )}
                      <b className={`type-${typeClassName(entry.teraType ?? entry.types[0])}`}>
                        <Gem size={9} /> {entry.teraType ?? entry.types[0]}
                      </b>
                    </span>
                  </span>
                </article>
              ) : (
                <article className="battle-party-preview-card empty" key={`battle-party-empty-${index}`}>
                  <span className="battle-party-slot-number">{String(index + 1).padStart(2, '0')}</span>
                  <Sparkles size={20} />
                  <span><strong>빈 슬롯</strong><small>포켓몬을 편성하세요</small></span>
                </article>
              )
            ))}
          </div>

          <footer className="battle-party-preview-footer">
            <span className={isBattleReady ? 'ready' : ''}>
              {isBattleReady ? <Check size={14} /> : <Sparkles size={14} />}
              {isBattleReady ? '6마리 출전 등록 완료' : `${BATTLE_TEAM_SIZE - activeTeamPokemon.length}마리를 더 편성하세요`}
            </span>
            <button type="button" onClick={onOpenBox}><Boxes size={16} /> 팀 편집</button>
          </footer>
        </aside>

        <section className="battle-mode-select-panel" aria-label="배틀 모드 선택">
          <div className="battle-mode-select-heading">
            <div>
              <span>SELECT COMPETITION</span>
              <h2>도전할 대회를 선택하세요</h2>
              <p>AI 트레이너 구성과 진행 방식이 모드마다 달라집니다.</p>
            </div>
            <span className="battle-mode-count"><Swords size={16} /> 2 MODES</span>
          </div>

          <div className="battle-mode-option-list">
            {BATTLE_MODES.map((mode) => {
              const ModeIcon = mode.icon
              const isSelected = mode.id === selectedMode.id

              return (
                <button
                  className={`battle-mode-option-card accent-${mode.accent}${isSelected ? ' selected' : ''}`}
                  type="button"
                  aria-pressed={isSelected}
                  key={mode.id}
                  onClick={() => setSelectedModeId(mode.id)}
                >
                  <span className="battle-mode-option-art">
                    <ModeIcon size={42} strokeWidth={1.8} />
                    <small>{mode.id === 'tournament' ? '128' : '8'}</small>
                  </span>
                  <span className="battle-mode-option-copy">
                    <small>{mode.eyebrow}</small>
                    <strong>{mode.title}</strong>
                    <span>{mode.description}</span>
                    <em>{mode.detail}</em>
                    <span className="battle-mode-meta-row">
                      {mode.meta.map((entry) => <b key={entry}>{entry}</b>)}
                    </span>
                  </span>
                  <span className="battle-mode-selection-state">
                    {isSelected ? <><Check size={17} /> 선택됨</> : <><ChevronRight size={18} /> 선택</>}
                  </span>
                </button>
              )
            })}
          </div>

          <footer className="battle-mode-confirm-bar">
            <span className={`battle-mode-confirm-icon accent-${selectedMode.accent}`}>
              {selectedMode.id === 'tournament' ? <Crown size={23} /> : <Medal size={23} />}
            </span>
            <span>
              <small>SELECTED COMPETITION</small>
              <strong>{selectedMode.title}</strong>
              <em>{activeTeam?.name ?? '팀 1'} · {activeTeamPokemon.length}/{BATTLE_TEAM_SIZE}마리</em>
            </span>
            <button
              type="button"
              disabled={!isBattleReady}
              onClick={() => onStartMode(selectedMode.id)}
            >
              <Swords size={18} />
              {isBattleReady ? '이 모드로 시작' : '팀 편성 후 참가'}
            </button>
          </footer>
        </section>
      </section>
    </main>
  )
}

export default BattleSelectScreen
