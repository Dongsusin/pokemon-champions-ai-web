import SpriteImage from './SpriteImage'
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
import { ALL_BATTLE_ITEMS as BATTLE_ITEMS } from './data/shopData'
import { BATTLE_TEAM_SIZE } from './data/teamData'
import { getRankedFormat, RANKED_FORMATS } from './data/rankedRules'
import './aiBattleFormat.css'
import { typeClassName } from './data/trainingData'
import {
  AI_BATTLE_DIFFICULTIES,
  HARD_AI_BOOST_STAGES,
  getAiBattleDifficultyLabel,
  normalizeAiBattleDifficulty,
} from './data/battleRules'

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
  const [selectedFormatId, setSelectedFormatId] = useState('single')
  const [selectedDifficultyId, setSelectedDifficultyId] = useState('normal')
  const [hardBoostStage, setHardBoostStage] = useState(HARD_AI_BOOST_STAGES[0])
  const activeTeam = teams.find((team) => team.id === activeTeamId) ?? teams[0]
  const activeTeamPokemon = useMemo(() => (
    (activeTeam?.pokemonIds ?? [])
      .map((captureId) => pokemon.find((entry) => entry.captureId === captureId))
      .filter(Boolean)
  ), [activeTeam?.pokemonIds, pokemon])
  const selectedMode = BATTLE_MODES.find((mode) => mode.id === selectedModeId) ?? BATTLE_MODES[0]
  const selectedFormat = getRankedFormat(selectedFormatId)
  const selectedDifficulty = normalizeAiBattleDifficulty({
    id: selectedDifficultyId,
    boostStage: hardBoostStage,
  })
  const partySlots = Array.from(
    { length: BATTLE_TEAM_SIZE },
    (_, index) => activeTeamPokemon[index] ?? null,
  )
  const isBattleReady = activeTeamPokemon.length === BATTLE_TEAM_SIZE

  return (
    <main className="battle-select-screen ai-format-selection-screen">
      <header className="battle-select-header">
        <button className="screen-back-button" type="button" aria-label="배틀 종류 선택으로 돌아가기" onClick={onBack}>
          <ArrowLeft size={19} />
          <span>배틀 선택</span>
        </button>

        <div className="battle-select-title">
          <span>BATTLE CHALLENGE</span>
          <h1>AI 대전</h1>
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
                    <SpriteImage
                      className="pokemon-box-icon"
                      src={entry.icon}
                      alt=""
                      draggable="false"
                      fallbackSrc={entry.iconFallback}
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

          <section className="ai-battle-format-selector" aria-label="AI 대전 배틀 형식 선택">
            <div className="ai-battle-format-options" role="group" aria-label="싱글 또는 더블 선택">
              {RANKED_FORMATS.map((format) => (
                <button
                  type="button"
                  key={format.id}
                  aria-pressed={selectedFormatId === format.id}
                  onClick={() => setSelectedFormatId(format.id)}
                >
                  {format.id === 'single' ? <Swords size={18} /> : <UsersRound size={18} />}
                  <strong>{format.label}</strong>
                  <span>{format.registeredSize}마리 중 {format.battleSize}마리 선출</span>
                </button>
              ))}
            </div>
            <div className="ai-battle-format-rules">
              <strong>Lv.50 · 맑음 · 일반 필드 · 기믹별 1회</strong>
              <span>선택한 형식으로 대회 끝까지 진행합니다. 기술·특성으로 생긴 날씨와 필드는 정상 지속시간을 따릅니다.</span>
            </div>
          </section>

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

          <section className={`battle-ai-difficulty difficulty-${selectedDifficulty.id}`} aria-label="AI 난이도 선택">
            <header>
              <span>
                <small>AI DIFFICULTY</small>
                <strong>{getAiBattleDifficultyLabel(selectedDifficulty)}</strong>
              </span>
              <em>{selectedDifficulty.description}</em>
            </header>
            <div className="battle-ai-difficulty-controls">
              <div className="battle-ai-difficulty-options">
                {AI_BATTLE_DIFFICULTIES.map((difficulty) => (
                  <button
                    className={difficulty.id === selectedDifficulty.id ? 'selected' : ''}
                    type="button"
                    aria-pressed={difficulty.id === selectedDifficulty.id}
                    key={difficulty.id}
                    onClick={() => setSelectedDifficultyId(difficulty.id)}
                  >
                    <small>{difficulty.shortLabel}</small>
                    <strong>{difficulty.label}</strong>
                  </button>
                ))}
              </div>
              <div className={`battle-hard-boost-selector${selectedDifficulty.id === 'hard' ? ' visible' : ''}`}>
                <span>시작 능력 단계</span>
                <div>
                  {HARD_AI_BOOST_STAGES.map((stage) => (
                    <button
                      className={stage === hardBoostStage ? 'selected' : ''}
                      type="button"
                      disabled={selectedDifficulty.id !== 'hard'}
                      aria-label={`하드 난이도 시작 능력 ${stage}단계`}
                      aria-pressed={stage === hardBoostStage}
                      key={stage}
                      onClick={() => setHardBoostStage(stage)}
                    >
                      +{stage}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <footer className="battle-mode-confirm-bar">
            <span className={`battle-mode-confirm-icon accent-${selectedMode.accent}`}>
              {selectedMode.id === 'tournament' ? <Crown size={23} /> : <Medal size={23} />}
            </span>
            <span>
              <small>SELECTED COMPETITION</small>
              <strong>{selectedMode.title}</strong>
              <em>
                {activeTeam?.name ?? '팀 1'} · {selectedFormat.label} · {selectedFormat.battleSize}마리 선출 · AI {getAiBattleDifficultyLabel(selectedDifficulty)}
              </em>
            </span>
            <button
              type="button"
              disabled={!isBattleReady}
              onClick={() => onStartMode(selectedMode.id, selectedDifficulty, selectedFormatId)}
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
