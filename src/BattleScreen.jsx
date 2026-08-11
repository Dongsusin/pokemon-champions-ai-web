import { useMemo, useRef, useState } from 'react'
import {
  ArrowLeftRight,
  ChevronLeft,
  ChevronRight,
  Circle,
  Gem,
  RotateCcw,
  Shield,
  Sparkles,
  Swords,
  Trophy,
} from 'lucide-react'
import PokemonSprite from './PokemonSprite'
import TrainerSprite from './TrainerSprite'
import {
  createBattle,
  forcePlayerSwitch,
  getActivePokemon,
  getAvailableBattleMechanics,
  getBattleSummary,
  playBattleTurn,
} from './data/battleEngine'
import { typeClassName } from './data/trainingData'

function fallbackImageHandler(fallback) {
  return (event) => {
    if (!fallback || event.currentTarget.dataset.fallbackApplied) return
    event.currentTarget.dataset.fallbackApplied = 'true'
    event.currentTarget.src = fallback
  }
}

function hpRatio(pokemon) {
  return Math.max(0, Math.min(100, (pokemon.hp / pokemon.maxHp) * 100))
}

function hpTone(pokemon) {
  const ratio = pokemon.hp / pokemon.maxHp
  if (ratio <= 0.2) return 'critical'
  if (ratio <= 0.5) return 'warning'
  return 'healthy'
}

function PartyIndicators({ side }) {
  return (
    <div className="battle-party-indicators" aria-label={`${side.name} 남은 포켓몬`}>
      {side.team.map((pokemon) => (
        <span
          className={`${pokemon.fainted ? 'fainted' : ''}${pokemon.status ? ' statused' : ''}`}
          key={pokemon.battleId}
          title={`${pokemon.name}${pokemon.fainted ? ' · 기절' : ''}`}
        >
          <Circle size={10} fill="currentColor" />
        </span>
      ))}
    </div>
  )
}

function BattleStatusPanel({ pokemon, side, trainerName }) {
  return (
    <section className={`battle-hp-panel side-${side}`}>
      <header>
        <div>
          <strong>{pokemon.name}</strong>
          {pokemon.teraActive && <span className={`type-${typeClassName(pokemon.teraType)}`}><Gem size={10} /> {pokemon.teraType}</span>}
          {pokemon.dynamaxActive && <span className="dynamax-state">MAX</span>}
        </div>
        <span>Lv.50</span>
      </header>
      <div className="battle-hp-meter-row">
        <small>HP</small>
        <span className={`battle-hp-meter tone-${hpTone(pokemon)}`}>
          <i style={{ width: `${hpRatio(pokemon)}%` }} />
        </span>
      </div>
      <footer>
        {side === 'player' ? <b>{pokemon.hp} / {pokemon.maxHp}</b> : <span>{trainerName}</span>}
        {pokemon.status && <em className={`status-${pokemon.status.id}`}>{pokemon.status.label}</em>}
      </footer>
    </section>
  )
}

function PokemonPartyMenu({ battle, forced, onSelect, onBack }) {
  const activeIndex = battle.player.activeIndex

  return (
    <section className="battle-party-menu">
      <header>
        <div>
          <small>{forced ? 'CHOOSE NEXT POKÉMON' : 'POKÉMON'}</small>
          <strong>{forced ? '다음 포켓몬을 선택하세요' : '교대할 포켓몬 선택'}</strong>
        </div>
        {!forced && <button type="button" onClick={onBack}><ChevronLeft size={17} /> 돌아가기</button>}
      </header>
      <div className="battle-party-menu-grid">
        {battle.player.team.map((pokemon, index) => {
          const isActive = index === activeIndex
          const isDisabled = pokemon.fainted || pokemon.hp <= 0 || isActive
          return (
            <button
              className={`${isActive ? 'active' : ''}${pokemon.fainted ? ' fainted' : ''}`}
              type="button"
              disabled={isDisabled}
              key={pokemon.battleId}
              onClick={() => onSelect(index)}
            >
              <span className="battle-party-menu-icon">
                <img
                  src={pokemon.icon}
                  alt=""
                  draggable="false"
                  onError={fallbackImageHandler(pokemon.iconFallback)}
                />
              </span>
              <span>
                <strong>{pokemon.name}</strong>
                <small>{isActive ? '배틀 중' : pokemon.fainted ? '기절' : pokemon.status?.label ?? '정상'}</small>
              </span>
              <span className={`battle-party-mini-hp tone-${hpTone(pokemon)}`}>
                <i style={{ width: `${hpRatio(pokemon)}%` }} />
              </span>
              <em>{pokemon.hp}/{pokemon.maxHp}</em>
            </button>
          )
        })}
      </div>
    </section>
  )
}

function MoveMenu({ battle, pendingGimmick, onGimmick, onMove, onBack }) {
  const pokemon = getActivePokemon(battle, 'player')
  const mechanics = getAvailableBattleMechanics(battle, 'player')

  return (
    <section className="battle-move-menu">
      <header>
        <button type="button" onClick={onBack}><ChevronLeft size={17} /> 행동 선택</button>
        <div className="battle-gimmick-selector">
          {mechanics.map((mechanic) => (
            <button
              className={`${pendingGimmick === mechanic.id ? 'selected' : ''} mechanic-${mechanic.id}`}
              type="button"
              aria-pressed={pendingGimmick === mechanic.id}
              key={mechanic.id}
              onClick={() => onGimmick(pendingGimmick === mechanic.id ? null : mechanic.id)}
            >
              {mechanic.id === 'tera' ? <Gem size={13} /> : <Sparkles size={13} />}
              {mechanic.shortLabel}
            </button>
          ))}
        </div>
      </header>
      <div className="battle-move-grid">
        {pokemon.moves.map((move, moveIndex) => (
          <button
            className={`battle-move-button type-${typeClassName(move.type)}`}
            type="button"
            disabled={move.currentPp <= 0}
            title={move.description}
            key={`${pokemon.battleId}-${move.id}-${moveIndex}`}
            onClick={() => onMove(moveIndex)}
          >
            <span className="battle-move-type">{move.type}</span>
            <span className="battle-move-name">
              <strong>{move.name}</strong>
              <small>{move.category}</small>
            </span>
            <span className="battle-move-pp">
              <small>PP</small>
              <strong>{move.currentPp}/{move.maxPp}</strong>
            </span>
            <span className="battle-move-power">
              <small>위력</small>
              <strong>{move.power || '—'}</strong>
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}

function BattleIntro({ opponent, opponentTeam, playerTeam, onStart }) {
  return (
    <section className="battle-intro-overlay">
      <div className="battle-intro-light battle-intro-light-player" />
      <div className="battle-intro-light battle-intro-light-opponent" />
      <article className="battle-intro-trainer player">
        <TrainerSprite isPlayer className="battle-intro-trainer-sprite" />
        <div>
          <small>CHALLENGER</small>
          <strong>PLAYER_01</strong>
          <span>{playerTeam.map((pokemon) => (
            <img
              key={pokemon.captureId}
              src={pokemon.icon}
              alt={pokemon.name}
              draggable="false"
              onError={fallbackImageHandler(pokemon.iconFallback)}
            />
          ))}</span>
        </div>
      </article>
      <div className="battle-intro-versus">
        <Swords size={36} />
        <strong>VS</strong>
        <small>6 POKÉMON SINGLE BATTLE</small>
      </div>
      <article className="battle-intro-trainer opponent">
        <TrainerSprite trainer={opponent} className="battle-intro-trainer-sprite" />
        <div>
          <small>{opponent.tier} TIER · TEAM {opponent.teamNumber}</small>
          <strong>{opponent.name}</strong>
          <span>{opponentTeam.pokemon.map((pokemon, index) => (
            <img
              key={`${pokemon.speciesId}-${index}`}
              src={pokemon.icon ?? pokemon.iconFallback ?? ''}
              alt={pokemon.name}
              draggable="false"
              onError={fallbackImageHandler(pokemon.iconFallback)}
            />
          ))}</span>
        </div>
      </article>
      <div className="battle-intro-strategy">
        <small>AI BATTLE PLAN</small>
        <strong>{opponentTeam.strategy?.summary ?? `${opponent.name}의 정예 팀과 맞붙습니다.`}</strong>
      </div>
      <button type="button" onClick={onStart}>
        <Swords size={19} /> 배틀 개시 <ChevronRight size={19} />
      </button>
    </section>
  )
}

function BattleScreen({ competitionLabel, playerPokemon, opponent, opponentTeam, onComplete }) {
  const [battle, setBattle] = useState(() => createBattle({ playerPokemon, opponent, opponentTeam }))
  const [introVisible, setIntroVisible] = useState(true)
  const [menu, setMenu] = useState('command')
  const [pendingGimmick, setPendingGimmick] = useState(null)
  const logRef = useRef(null)
  const playerActive = getActivePokemon(battle, 'player')
  const opponentActive = getActivePokemon(battle, 'opponent')
  const summary = useMemo(() => getBattleSummary(battle), [battle])
  const lastEvent = battle.lastEvent

  const chooseMove = (moveIndex) => {
    setBattle((state) => playBattleTurn(state, {
      type: 'move',
      moveIndex,
      gimmick: pendingGimmick,
    }))
    setPendingGimmick(null)
    setMenu('command')
    requestAnimationFrame(() => {
      if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
    })
  }

  const chooseSwitch = (targetIndex) => {
    setBattle((state) => (
      state.awaitingPlayerSwitch
        ? forcePlayerSwitch(state, targetIndex)
        : playBattleTurn(state, { type: 'switch', targetIndex })
    ))
    setMenu('command')
  }

  const completeBattle = (forcedWinner) => {
    onComplete({
      ...summary,
      winner: forcedWinner ?? summary.winner,
      playerRemaining: forcedWinner === 'opponent' ? 0 : summary.playerRemaining,
    })
  }

  return (
    <main className="battle-game-screen">
      <header className="battle-game-header">
        <div>
          <span><Swords size={15} /> LIVE BATTLE</span>
          <strong>{competitionLabel}</strong>
        </div>
        <div className="battle-game-turn">
          <small>TURN</small>
          <strong>{Math.max(1, battle.turn)}</strong>
        </div>
        <button type="button" onClick={() => completeBattle('opponent')}>
          <RotateCcw size={16} /> 기권
        </button>
      </header>

      <section className="battle-arena">
        <div className="battle-arena-scanlines" />
        <div className="battle-platform opponent-platform" />
        <div className="battle-platform player-platform" />

        <div className="battle-status-anchor opponent-status-anchor">
          <BattleStatusPanel pokemon={opponentActive} side="opponent" trainerName={opponent.name} />
          <PartyIndicators side={battle.opponent} />
        </div>
        <div className="battle-status-anchor player-status-anchor">
          <BattleStatusPanel pokemon={playerActive} side="player" trainerName="PLAYER_01" />
          <PartyIndicators side={battle.player} />
        </div>

        <div
          className={`battle-pokemon-stage opponent${lastEvent?.targetSideId === 'opponent' ? ' is-hit' : ''}${opponentActive.dynamaxActive ? ' is-dynamax' : ''}`}
          key={`opponent-stage-${opponentActive.battleId}-${lastEvent?.nonce ?? 0}`}
        >
          <PokemonSprite
            animatedSrc={opponentActive.spriteFront}
            fallbackSrc={opponentActive.spriteFrontFallback}
            frameClassName="battle-live-sprite-frame opponent-sprite-frame"
            className="battle-live-sprite"
            alt={opponentActive.name}
          />
        </div>

        <div
          className={`battle-pokemon-stage player${lastEvent?.targetSideId === 'player' ? ' is-hit' : ''}${playerActive.dynamaxActive ? ' is-dynamax' : ''}`}
          key={`player-stage-${playerActive.battleId}-${lastEvent?.nonce ?? 0}`}
        >
          <PokemonSprite
            animatedSrc={playerActive.spriteBack}
            fallbackSrc={playerActive.spriteBackFallback}
            frameClassName="battle-live-sprite-frame player-sprite-frame"
            className="battle-live-sprite"
            alt={playerActive.name}
          />
        </div>

        <aside className="battle-log-panel" ref={logRef} aria-live="polite">
          {battle.log.slice(-8).map((entry) => (
            <p className={`tone-${entry.tone}`} key={entry.id}>{entry.message}</p>
          ))}
        </aside>
      </section>

      <section className="battle-command-deck">
        {battle.awaitingPlayerSwitch || menu === 'party' ? (
          <PokemonPartyMenu
            battle={battle}
            forced={battle.awaitingPlayerSwitch}
            onSelect={chooseSwitch}
            onBack={() => setMenu('command')}
          />
        ) : menu === 'fight' ? (
          <MoveMenu
            battle={battle}
            pendingGimmick={pendingGimmick}
            onGimmick={setPendingGimmick}
            onMove={chooseMove}
            onBack={() => {
              setPendingGimmick(null)
              setMenu('command')
            }}
          />
        ) : (
          <section className="battle-command-menu">
            <div className="battle-dialogue-box">
              <small>WHAT WILL YOU DO?</small>
              <strong>{playerActive.name}은(는) 무엇을 할까?</strong>
              <span>{opponentActive.name} · HP {Math.ceil(hpRatio(opponentActive))}%</span>
            </div>
            <div className="battle-command-buttons">
              <button className="fight" type="button" onClick={() => setMenu('fight')}>
                <Swords size={25} />
                <span><small>FIGHT</small><strong>싸운다</strong></span>
                <ChevronRight size={18} />
              </button>
              <button className="pokemon" type="button" onClick={() => setMenu('party')}>
                <ArrowLeftRight size={25} />
                <span><small>POKÉMON</small><strong>포켓몬</strong></span>
                <ChevronRight size={18} />
              </button>
            </div>
          </section>
        )}
      </section>

      {introVisible && (
        <BattleIntro
          opponent={opponent}
          opponentTeam={{ ...opponentTeam, pokemon: battle.opponent.team }}
          playerTeam={playerPokemon}
          onStart={() => setIntroVisible(false)}
        />
      )}

      {battle.winner && !introVisible && (
        <section className={`battle-result-overlay result-${battle.winner}`}>
          <span>{battle.winner === 'player' ? <Trophy size={42} /> : <Shield size={42} />}</span>
          <div>
            <small>{battle.winner === 'player' ? 'BATTLE WON' : 'BATTLE LOST'}</small>
            <h2>{battle.winner === 'player' ? `${opponent.name}에게 승리!` : `${opponent.name}에게 패배`}</h2>
            <p>{summary.turns}턴 · 아군 {summary.playerRemaining}마리 · 상대 {summary.opponentRemaining}마리</p>
          </div>
          <button type="button" onClick={() => completeBattle()}>
            대회 결과로 <ChevronRight size={18} />
          </button>
        </section>
      )}
    </main>
  )
}

export default BattleScreen
