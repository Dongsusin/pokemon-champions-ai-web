import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  ChevronRight,
  Crown,
  Medal,
  MoveHorizontal,
  Shield,
  Sparkles,
  Swords,
  Trophy,
  UsersRound,
} from 'lucide-react'
import TrainerSprite from './TrainerSprite'
import {
  PLAYER_PARTICIPANT_ID,
  getCompetitionParticipant,
  getCompetitionRoundLabel,
  getCurrentCompetitionMatch,
  getSortedLeagueStandings,
} from './data/competitionData'
import { getTrainerTeam } from './data/trainerTeams'
import { getSpeciesProfile } from './data/trainingData'
import { getBattleRuleSummary } from './data/battleRules'

function pokemonIconSources(slot) {
  const profile = getSpeciesProfile(slot.speciesId)
  return {
    primary: slot.icon ?? profile?.icon ?? profile?.iconFallback,
    fallback: slot.iconFallback ?? profile?.iconFallback,
  }
}

function fallbackImageHandler(fallback) {
  return (event) => {
    if (!fallback || event.currentTarget.dataset.fallbackApplied) return
    event.currentTarget.dataset.fallbackApplied = 'true'
    event.currentTarget.src = fallback
  }
}

function ParticipantCard({ participant, state, isOpponent = false, compact = false }) {
  return (
    <article
      className={`competition-participant-card state-${state}${isOpponent ? ' current-opponent' : ''}${compact ? ' compact' : ''}`}
      title={`${participant.name} · ${participant.tier} TIER`}
    >
      <TrainerSprite trainer={participant} isPlayer={participant.isPlayer} />
      <span>
        <small>{participant.isPlayer ? 'PLAYER' : `${participant.tier} TIER`}</small>
        <strong>{participant.name}</strong>
      </span>
      {participant.isPlayer && <Shield size={13} />}
      {isOpponent && <Swords size={13} />}
    </article>
  )
}

function MatchTrainer({ participant, side, team }) {
  return (
    <article className={`competition-match-trainer side-${side}`}>
      <span className="competition-match-trainer-tier">
        {participant.isPlayer ? 'YOUR TEAM' : `${participant.tier} TIER · TEAM ${participant.teamNumber}`}
      </span>
      <TrainerSprite
        trainer={participant}
        isPlayer={participant.isPlayer}
        className="competition-match-trainer-sprite"
      />
      <div>
        <small>{participant.isPlayer ? participant.teamName : participant.region.toUpperCase()}</small>
        <h2>{participant.name}</h2>
      </div>
      <div className="competition-match-party" aria-label={`${participant.name} 포켓몬 팀`}>
        {team.map((pokemon, index) => (
          <span key={`${participant.id}-${pokemon.captureId ?? pokemon.speciesId}-${index}`}>
            <img
              src={pokemonIconSources(pokemon).primary}
              alt={pokemon.name}
              draggable="false"
              onError={fallbackImageHandler(pokemonIconSources(pokemon).fallback)}
            />
          </span>
        ))}
      </div>
    </article>
  )
}

function BattleRuleBoard({ rules }) {
  return (
    <div className="competition-battle-rules" aria-label="이번 경기 규칙">
      {getBattleRuleSummary(rules).map((rule) => (
        <span className={`rule-${rule.id}`} key={rule.id}>
          <small>{rule.id === 'environment' ? 'FIELD' : rule.id === 'format' ? 'FORMAT' : rule.id === 'gimmick' ? 'LIMIT' : 'ROSTER'}</small>
          <strong>{rule.label}</strong>
        </span>
      ))}
    </div>
  )
}

function BattleTeamSelection({ pokemon, selectedCaptureIds, requiredCount, onToggle }) {
  return (
    <section className="competition-team-selection">
      <header>
        <span>SELECT BATTLE TEAM</span>
        <strong>{selectedCaptureIds.length} / {requiredCount}</strong>
      </header>
      <div>
        {pokemon.map((entry, index) => {
          const selectedIndex = selectedCaptureIds.indexOf(entry.captureId)
          const selected = selectedIndex >= 0
          const sources = pokemonIconSources(entry)
          return (
            <button
              className={selected ? 'selected' : ''}
              type="button"
              key={entry.captureId}
              aria-pressed={selected}
              onClick={() => onToggle(entry.captureId)}
            >
              <small>{String(index + 1).padStart(2, '0')}</small>
              <img src={sources.primary} alt="" draggable="false" onError={fallbackImageHandler(sources.fallback)} />
              <span>{entry.name}</span>
              {selected && <b>{selectedIndex + 1}</b>}
            </button>
          )
        })}
      </div>
    </section>
  )
}

const TOURNAMENT_BRACKET_SIZE = 128
const TOURNAMENT_BRACKET_TRACK_WIDTH = 110
const TOURNAMENT_BRACKET_LABELS = ['128강', '64강', '32강', '16강', '8강', '준결승', '결승', '우승']

function createTournamentBracketLevels(competition) {
  const participantsById = new Map(
    competition.participants.map((participant) => [participant.id, participant]),
  )
  const historyByRound = new Map(
    competition.roundHistory.map((roundResult) => [roundResult.round, roundResult]),
  )

  return TOURNAMENT_BRACKET_LABELS.map((label, levelIndex) => {
    const slotSpan = 2 ** levelIndex
    const slotCount = TOURNAMENT_BRACKET_SIZE / slotSpan
    const sourceResult = historyByRound.get(levelIndex - 1)
    const participantIds = levelIndex === 0
      ? competition.participants.map((participant) => participant.id)
      : sourceResult?.matches.map((match) => match.winnerId) ?? []
    const levelResult = historyByRound.get(levelIndex)

    return {
      label,
      levelIndex,
      slotSpan,
      status: levelIndex < competition.roundHistory.length
        || (levelIndex === TOURNAMENT_BRACKET_LABELS.length - 1 && Boolean(sourceResult))
        ? 'complete'
        : levelIndex === competition.round && competition.status === 'active'
          ? 'current'
          : 'future',
      entries: Array.from({ length: slotCount }, (_, slotIndex) => {
        const participantId = participantIds[slotIndex]
        const participant = participantsById.get(participantId) ?? null
        const match = participantId
          ? levelResult?.matches.find((roundMatch) => (
            roundMatch.firstId === participantId || roundMatch.secondId === participantId
          ))
          : null

        return {
          participant,
          slotIndex,
          isAdvanced: match?.winnerId === participantId,
          isEliminated: match?.loserId === participantId,
        }
      }),
    }
  })
}

function TournamentOverview({ competition, currentMatch }) {
  const bracketViewportRef = useRef(null)
  const dragStateRef = useRef({ active: false, pointerId: null, startX: 0, scrollLeft: 0 })
  const hasCenteredRef = useRef(false)
  const opponentId = currentMatch?.opponent?.id
  const activeCount = competition.activeParticipantIds.length
  const bracketLevels = useMemo(
    () => createTournamentBracketLevels(competition),
    [competition.participants, competition.roundHistory, competition.round, competition.status],
  )

  useEffect(() => {
    const viewport = bracketViewportRef.current
    if (!viewport) return undefined

    const animationFrame = requestAnimationFrame(() => {
      const playerNodes = [...viewport.querySelectorAll('[data-player-path="true"]')]
      const playerNode = playerNodes.sort((first, second) => (
        Number(second.dataset.bracketLevel) - Number(first.dataset.bracketLevel)
      ))[0]

      if (!playerNode) return

      const viewportRect = viewport.getBoundingClientRect()
      const playerRect = playerNode.getBoundingClientRect()
      const nextScrollLeft = viewport.scrollLeft
        + playerRect.left
        - viewportRect.left
        - ((viewportRect.width - playerRect.width) / 2)
      const nextScrollTop = viewport.scrollTop
        + playerRect.top
        - viewportRect.top
        - ((viewportRect.height - playerRect.height) / 2)

      viewport.scrollTo({
        left: Math.max(0, nextScrollLeft),
        top: viewport.scrollHeight > viewport.clientHeight ? Math.max(0, nextScrollTop) : 0,
        behavior: hasCenteredRef.current ? 'smooth' : 'auto',
      })
      hasCenteredRef.current = true
    })

    return () => cancelAnimationFrame(animationFrame)
  }, [bracketLevels])

  const startDragging = (event) => {
    if (event.button !== 0) return
    const viewport = event.currentTarget
    dragStateRef.current = {
      active: true,
      pointerId: event.pointerId,
      startX: event.clientX,
      scrollLeft: viewport.scrollLeft,
    }
    viewport.dataset.dragging = 'true'
    viewport.setPointerCapture?.(event.pointerId)
  }

  const dragBracket = (event) => {
    const dragState = dragStateRef.current
    if (!dragState.active || dragState.pointerId !== event.pointerId) return
    event.currentTarget.scrollLeft = dragState.scrollLeft - (event.clientX - dragState.startX)
  }

  const stopDragging = (event) => {
    const dragState = dragStateRef.current
    if (!dragState.active || dragState.pointerId !== event.pointerId) return
    dragStateRef.current = { active: false, pointerId: null, startX: 0, scrollLeft: 0 }
    delete event.currentTarget.dataset.dragging
    event.currentTarget.releasePointerCapture?.(event.pointerId)
  }

  return (
    <section className="competition-roster-panel">
      <header>
        <div>
          <span>TOURNAMENT ENTRANTS</span>
          <h2>128강 토너먼트 대진표</h2>
        </div>
        <div className="competition-roster-tools">
          <span className="tournament-scroll-hint">
            <MoveHorizontal size={17} />
            드래그하거나 가로로 스크롤
          </span>
          <div className="competition-roster-summary">
            <strong>{activeCount}</strong>
            <span>현재 생존</span>
          </div>
        </div>
      </header>

      <div
        ref={bracketViewportRef}
        className="tournament-bracket-viewport"
        role="region"
        aria-label="128강 토너먼트 대진표"
        tabIndex={0}
        onPointerDown={startDragging}
        onPointerMove={dragBracket}
        onPointerUp={stopDragging}
        onPointerCancel={stopDragging}
      >
        <div
          className="tournament-bracket-canvas"
          style={{ '--bracket-track-width': `${TOURNAMENT_BRACKET_TRACK_WIDTH}px` }}
        >
          {[...bracketLevels].reverse().map((level) => (
            <div
              className={`tournament-bracket-level level-${level.status}`}
              data-level={level.levelIndex}
              key={level.label}
            >
              <span className={`tournament-bracket-round-label${level.status === 'current' ? ' current' : ''}`}>
                <small>{level.levelIndex === TOURNAMENT_BRACKET_LABELS.length - 1 ? 'CHAMPION' : `ROUND ${level.levelIndex + 1}`}</small>
                <strong>{level.label}</strong>
              </span>

              {level.entries.map((entry) => {
                const { participant } = entry
                const isPlayer = participant?.id === PLAYER_PARTICIPANT_ID
                const isOpponent = participant?.id === opponentId && level.levelIndex === competition.round
                const tierClass = participant?.tier
                  ? ` tier-${participant.tier.toLowerCase().replace(/[^a-z0-9]/g, '')}`
                  : ''

                return (
                  <div
                    className={`tournament-bracket-slot${level.levelIndex > 0 ? ' has-children' : ''}${level.levelIndex < TOURNAMENT_BRACKET_LABELS.length - 1 ? ' has-parent' : ''}${participant ? ' is-filled' : ''}${entry.isAdvanced ? ' is-advanced' : ''}`}
                    key={`${level.levelIndex}-${entry.slotIndex}`}
                    style={{
                      gridColumn: `${(entry.slotIndex * level.slotSpan) + 2} / span ${level.slotSpan}`,
                      '--branch-width': `${TOURNAMENT_BRACKET_TRACK_WIDTH * level.slotSpan / 2}px`,
                    }}
                  >
                    {level.levelIndex < TOURNAMENT_BRACKET_LABELS.length - 1 && (
                      <span className={`tournament-bracket-parent-link${entry.isAdvanced ? ' advanced' : ''}`} />
                    )}
                    <article
                      className={`tournament-bracket-node${participant ? '' : ' is-empty'}${entry.isEliminated ? ' is-eliminated' : ''}${entry.isAdvanced ? ' is-winner' : ''}${isPlayer ? ' is-player' : ''}${isOpponent ? ' is-opponent' : ''}${level.levelIndex === TOURNAMENT_BRACKET_LABELS.length - 1 && participant ? ' is-champion' : ''}${tierClass}`}
                      data-player-path={isPlayer ? 'true' : undefined}
                      data-bracket-level={level.levelIndex}
                      title={participant ? `${participant.name} · ${participant.tier} TIER` : `${level.label} 진출자 대기`}
                    >
                      {participant ? (
                        <>
                          <TrainerSprite
                            trainer={participant}
                            isPlayer={isPlayer}
                            className="tournament-bracket-sprite"
                          />
                          <span className="tournament-bracket-node-copy">
                            <small>{isPlayer ? 'PLAYER' : `${participant.tier} TIER`}</small>
                            <strong>{participant.name}</strong>
                          </span>
                          {isPlayer && <Shield size={12} />}
                          {isOpponent && <Swords size={12} />}
                        </>
                      ) : (
                        <span className="tournament-bracket-placeholder" aria-label="진출자 대기">
                          <small>NEXT</small>
                          <strong>?</strong>
                        </span>
                      )}
                    </article>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function LeagueOverview({ competition, currentMatch }) {
  const standings = getSortedLeagueStandings(competition)
  const currentPairings = competition.schedule[competition.round] ?? []

  return (
    <section className="competition-league-workspace">
      <div className="competition-league-participants">
        <header>
          <div>
            <span>LEAGUE MEMBERS</span>
            <h2>8인 참가 명단</h2>
          </div>
          <UsersRound size={24} />
        </header>
        <div>
          {competition.participants.map((participant) => (
            <ParticipantCard
              key={participant.id}
              participant={participant}
              state="active"
              isOpponent={participant.id === currentMatch?.opponent?.id}
            />
          ))}
        </div>
      </div>

      <div className="competition-standings-panel">
        <header>
          <div>
            <span>LEAGUE TABLE</span>
            <h2>현재 순위</h2>
          </div>
          <Medal size={23} />
        </header>
        <div className="competition-standings-table">
          <div className="competition-standing-row heading">
            <span>순위</span><span>트레이너</span><span>승</span><span>패</span><span>득실</span><span>PTS</span>
          </div>
          {standings.map((standing, index) => {
            const participant = getCompetitionParticipant(competition, standing.participantId)
            return (
              <div
                className={`competition-standing-row${participant.isPlayer ? ' player' : ''}`}
                key={standing.participantId}
              >
                <strong>{index + 1}</strong>
                <span>{participant.name}</span>
                <b>{standing.wins}</b>
                <b>{standing.losses}</b>
                <em>{standing.differential > 0 ? '+' : ''}{standing.differential}</em>
                <strong>{standing.points}</strong>
              </div>
            )
          })}
        </div>
      </div>

      <div className="competition-fixtures-panel">
        <header>
          <span>CURRENT FIXTURES</span>
          <h2>{getCompetitionRoundLabel(competition)} 대진</h2>
        </header>
        <div>
          {currentPairings.map(([firstId, secondId]) => {
            const first = getCompetitionParticipant(competition, firstId)
            const second = getCompetitionParticipant(competition, secondId)
            const isPlayerPair = [firstId, secondId].includes(PLAYER_PARTICIPANT_ID)
            return (
              <article className={isPlayerPair ? 'player-match' : ''} key={`${firstId}-${secondId}`}>
                <span>{first.name}</span>
                <b>VS</b>
                <span>{second.name}</span>
              </article>
            )
          })}
        </div>
      </div>
    </section>
  )
}

function CompetitionScreen({ competition, onBack, onStartBattle, onRestart }) {
  const currentMatch = getCurrentCompetitionMatch(competition)
  const player = getCompetitionParticipant(competition, PLAYER_PARTICIPANT_ID)
  const opponent = currentMatch?.opponent
  const opponentTeam = opponent ? getTrainerTeam(opponent.name, opponent.teamNumber) : null
  const isTournament = competition.mode === 'tournament'
  const ModeIcon = isTournament ? Trophy : UsersRound
  const roundLabel = getCompetitionRoundLabel(competition)
  const standings = competition.mode === 'league' ? getSortedLeagueStandings(competition) : []
  const playerRank = standings.findIndex((standing) => standing.participantId === PLAYER_PARTICIPANT_ID) + 1
  const champion = competition.championId
    ? getCompetitionParticipant(competition, competition.championId)
    : null
  const isFinished = competition.status !== 'active'
  const matchRules = currentMatch?.rules
  const requiredPokemonCount = matchRules?.teamRule?.battleSize ?? competition.playerTeam.length
  const requiresTeamSelection = matchRules?.teamRule?.id === 'pick3'
  const [selectedCaptureIds, setSelectedCaptureIds] = useState([])

  useEffect(() => {
    const initialCount = matchRules?.teamRule?.battleSize ?? competition.playerTeam.length
    setSelectedCaptureIds(competition.playerTeam.slice(0, initialCount).map((pokemon) => pokemon.captureId))
  }, [competition.id, competition.round, matchRules?.id])

  const toggleSelectedPokemon = (captureId) => {
    setSelectedCaptureIds((currentIds) => {
      if (currentIds.includes(captureId)) return currentIds.filter((id) => id !== captureId)
      if (currentIds.length >= requiredPokemonCount) return [...currentIds.slice(1), captureId]
      return [...currentIds, captureId]
    })
  }

  return (
    <main className="competition-screen">
      <header className="competition-header">
        <button className="screen-back-button" type="button" onClick={onBack}>
          <ArrowLeft size={19} />
          <span>모드 선택</span>
        </button>
        <div className="competition-title-lockup">
          <span className={`competition-mode-emblem mode-${competition.mode}`}><ModeIcon size={25} /></span>
          <div>
            <span>{isTournament ? 'CHAMPIONS KNOCKOUT' : 'CHAMPIONS LEAGUE'}</span>
            <h1>{isTournament ? '128강 토너먼트' : '8인 리그전'}</h1>
          </div>
        </div>
        <div className="competition-round-chip">
          <small>{isFinished ? 'COMPETITION RESULT' : 'CURRENT ROUND'}</small>
          <strong>{isFinished ? '대회 종료' : roundLabel}</strong>
        </div>
      </header>

      {!isFinished && currentMatch && (
        <section className="competition-current-match-panel">
          <div className="competition-match-kicker">
            <span><Swords size={15} /> NEXT PLAYER BATTLE</span>
            <strong>{roundLabel}</strong>
          </div>
          <div className="competition-matchup-stage">
            <MatchTrainer participant={player} side="player" team={competition.playerTeam} />
            <div className="competition-versus-mark">
              <small>MATCH</small>
              <strong>VS</strong>
              <span>{matchRules?.teamRule?.shortLabel} · {matchRules?.format?.shortLabel}</span>
            </div>
            <MatchTrainer participant={opponent} side="opponent" team={opponentTeam.pokemon} />
          </div>
          <BattleRuleBoard rules={matchRules} />
          {requiresTeamSelection && (
            <BattleTeamSelection
              pokemon={competition.playerTeam}
              selectedCaptureIds={selectedCaptureIds}
              requiredCount={requiredPokemonCount}
              onToggle={toggleSelectedPokemon}
            />
          )}
          <footer>
            <span><Sparkles size={15} /> {matchRules?.weather?.label} · {matchRules?.terrain?.label}</span>
            <button
              type="button"
              disabled={selectedCaptureIds.length !== requiredPokemonCount}
              onClick={() => onStartBattle(selectedCaptureIds)}
            >
              <Swords size={18} />
              {roundLabel} 배틀 시작
              <ChevronRight size={18} />
            </button>
          </footer>
        </section>
      )}

      {isFinished && (
        <section className={`competition-result-panel result-${competition.status}`}>
          <span className="competition-result-crown">
            {competition.status === 'complete' && competition.championId === PLAYER_PARTICIPANT_ID
              ? <Crown size={42} />
              : <Trophy size={42} />}
          </span>
          <div>
            <small>{competition.status === 'eliminated' ? 'CHALLENGE OVER' : 'COMPETITION COMPLETE'}</small>
            <h2>
              {competition.status === 'eliminated'
                ? `${competition.roundHistory.at(-1)?.label ?? '토너먼트'}에서 탈락했습니다`
                : champion?.id === PLAYER_PARTICIPANT_ID
                  ? 'PLAYER_01 우승!'
                  : `${champion?.name ?? 'AI 트레이너'} 우승`}
            </h2>
            <p>
              {competition.mode === 'league'
                ? `최종 순위 ${playerRank || '-'}위 · ${standings.find((entry) => entry.participantId === PLAYER_PARTICIPANT_ID)?.wins ?? 0}승`
                : `총 ${competition.roundHistory.length}라운드에 참가했습니다.`}
            </p>
          </div>
          <button type="button" onClick={onRestart}>다른 대회 선택</button>
        </section>
      )}

      {isTournament ? (
        <TournamentOverview competition={competition} currentMatch={currentMatch} />
      ) : (
        <LeagueOverview competition={competition} currentMatch={currentMatch} />
      )}
    </main>
  )
}

export default CompetitionScreen
