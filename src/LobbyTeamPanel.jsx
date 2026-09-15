import SpriteImage from './SpriteImage'
import {
  Boxes,
  ChevronLeft,
  ChevronRight,
  Crown,
  Gem,
  Maximize2,
  Package,
  Sparkles,
} from 'lucide-react'
import { ALL_BATTLE_ITEMS as BATTLE_ITEMS } from './data/shopData'
import { BATTLE_TEAM_SIZE } from './data/teamData'
import { typeClassName } from './data/trainingData'

const ITEM_BY_ID = new Map(BATTLE_ITEMS.map((item) => [item.id, item]))

function moveName(move) {
  return typeof move === 'string' ? move : move?.name
}

function LobbyTeamPanel({ pokemon, teams, activeTeamId, selectedCaptureId, onSelectPokemon, onSelectTeam, onOpenBox }) {
  const requestedTeamIndex = teams.findIndex((team) => team.id === activeTeamId)
  const activeTeamIndex = requestedTeamIndex >= 0 ? requestedTeamIndex : 0
  const activeTeam = teams[activeTeamIndex]
  const activeTeamPokemon = (activeTeam?.pokemonIds ?? [])
    .map((captureId) => pokemon.find((entry) => entry.captureId === captureId))
    .filter(Boolean)
  const partySlots = Array.from(
    { length: BATTLE_TEAM_SIZE },
    (_, index) => activeTeamPokemon[index] ?? null,
  )

  const cycleTeam = (direction) => {
    if (!teams.length) return
    const nextTeamIndex = (activeTeamIndex + direction + teams.length) % teams.length
    onSelectTeam(teams[nextTeamIndex].id)
  }

  return (
    <aside className="lobby-team-panel glass-panel" aria-label="저장 팀 미리보기">
      <header className="lobby-team-heading">
        <span>
          <small>MY BATTLE TEAMS</small>
          <strong>팀 세팅</strong>
        </span>
        <b>{activeTeamPokemon.length}<em>/{BATTLE_TEAM_SIZE}</em></b>
      </header>

      <div className="lobby-team-navigation">
        <button type="button" aria-label="이전 팀" onClick={() => cycleTeam(-1)} disabled={!teams.length}>
          <ChevronLeft size={19} />
        </button>
        <span>
          <small>TEAM {String(activeTeamIndex + 1).padStart(2, '0')} / {String(teams.length).padStart(2, '0')}</small>
          <strong>{activeTeam?.name ?? '팀 1'}</strong>
        </span>
        <button type="button" aria-label="다음 팀" onClick={() => cycleTeam(1)} disabled={!teams.length}>
          <ChevronRight size={19} />
        </button>
      </div>

      <div className="lobby-team-list">
        {partySlots.map((entry, index) => {
          if (!entry) {
            return (
              <article className="lobby-team-card empty" key={`lobby-team-empty-${index}`}>
                <span className="lobby-team-slot-number">{String(index + 1).padStart(2, '0')}</span>
                <span className="lobby-team-icon-frame"><Sparkles size={19} /></span>
                <span className="lobby-team-card-copy">
                  <strong>빈 슬롯</strong>
                  <small>포켓몬을 편성하세요</small>
                </span>
              </article>
            )
          }

          const heldItem = ITEM_BY_ID.get(entry.heldItemId)
          const teraType = entry.teraType ?? entry.types?.[0] ?? '노말'
          const isGigantamax = entry.dynamaxMode === 'gigantamax'
          const moves = (entry.moves ?? []).map(moveName).filter(Boolean).slice(0, 4)

          return (
            <article
              className={`lobby-team-card${entry.isShiny ? ' is-shiny' : ''}${entry.captureId === selectedCaptureId ? ' selected' : ''}`}
              key={entry.captureId}
              role={onSelectPokemon ? 'button' : undefined}
              tabIndex={onSelectPokemon ? 0 : undefined}
              aria-pressed={onSelectPokemon ? entry.captureId === selectedCaptureId : undefined}
              aria-label={`${entry.name} 세팅`}
              onClick={() => onSelectPokemon?.(entry.captureId)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                onSelectPokemon?.(entry.captureId)
              }}
            >
              <span className="lobby-team-slot-number">{String(index + 1).padStart(2, '0')}</span>
              {entry.isShiny && <span className="lobby-team-shiny" aria-label="이로치">★</span>}
              <span className="lobby-team-icon-frame" aria-hidden="true">
                <SpriteImage
                  src={entry.icon}
                  alt=""
                  draggable="false"
                  fallbackSrc={entry.iconFallback}
                />
              </span>
              <span className="lobby-team-card-copy">
                <span className="lobby-team-name-row">
                  <strong>{entry.name}</strong>
                  <em>Lv.{entry.level ?? 50}</em>
                </span>
                <small>{entry.nature ?? '노력'} · {entry.ability ?? '특성 미설정'}</small>
                <span className="lobby-team-loadout">
                  <em title={heldItem?.name ?? '도구 없음'}>
                    <Package size={9} /> {heldItem?.name ?? '도구 없음'}
                  </em>
                  <b className={`type-${typeClassName(teraType)}`} title={`${teraType} 테라스탈`}>
                    <Gem size={9} /> {teraType}
                  </b>
                  <i className={isGigantamax ? 'gigantamax' : 'dynamax'}>
                    {isGigantamax ? <Crown size={8} /> : <Maximize2 size={8} />}
                    {isGigantamax ? '거다이맥스' : '다이맥스'}
                  </i>
                </span>
              </span>
              <span className="lobby-team-moves" aria-label={`기술 ${moves.join(', ')}`}>
                {Array.from({ length: 4 }, (_, moveIndex) => (
                  <small key={`${entry.captureId}-move-${moveIndex}`}>
                    {moves[moveIndex] ?? '—'}
                  </small>
                ))}
              </span>
            </article>
          )
        })}
      </div>

      <footer className="lobby-team-footer">
        <div className="lobby-team-pages" aria-label="저장 팀 바로 선택">
          {teams.map((team, index) => (
            <button
              className={team.id === activeTeam?.id ? 'selected' : ''}
              type="button"
              aria-label={`${team.name} 선택`}
              aria-pressed={team.id === activeTeam?.id}
              key={team.id}
              onClick={() => onSelectTeam(team.id)}
            >
              {index + 1}
            </button>
          ))}
        </div>
        <button className="lobby-team-edit" type="button" onClick={onOpenBox}>
          <Boxes size={14} /> 팀 편집
        </button>
      </footer>
    </aside>
  )
}

export default LobbyTeamPanel
