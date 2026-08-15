import PokemonSprite from './PokemonSprite'
import { getBattleItem } from './data/shopData'
import { typeClassName } from './data/trainingData'

const BATTLE_STAT_STAGE_LABELS = [
  ['attack', '공격'],
  ['defense', '방어'],
  ['specialAttack', '특공'],
  ['specialDefense', '특방'],
  ['speed', '스피드'],
  ['accuracy', '명중'],
  ['evasion', '회피'],
]

function hpRatio(pokemon) {
  if (!pokemon?.maxHp) return 0
  return Math.max(0, Math.min(100, (pokemon.hp / pokemon.maxHp) * 100))
}

function hpTone(pokemon) {
  if (!pokemon?.maxHp) return 'critical'
  const ratio = pokemon.hp / pokemon.maxHp
  if (ratio <= 0.2) return 'critical'
  if (ratio <= 0.5) return 'warning'
  return 'healthy'
}

function battleStatStageEntries(pokemon) {
  return BATTLE_STAT_STAGE_LABELS
    .map(([id, label]) => ({ id, label, stage: pokemon.statStages?.[id] ?? 0 }))
    .filter(({ stage }) => stage !== 0)
}

function battleConditionEntries(pokemon) {
  const chargingMove = pokemon.chargingMove
    ? pokemon.moves?.[pokemon.chargingMove.moveIndex]
    : null
  const lockedMove = pokemon.lockedMove
    ? pokemon.moves?.[pokemon.lockedMove.moveIndex]
    : null

  return [
    pokemon.status && { id: `status-${pokemon.status.id}`, label: pokemon.status.label, tone: 'status' },
    pokemon.confusionTurns > 0 && { id: 'confusion', label: `혼란 ${pokemon.confusionTurns}턴`, tone: 'status' },
    pokemon.yawnTurns > 0 && { id: 'yawn', label: '졸음', tone: 'warning' },
    pokemon.perishCount != null && { id: 'perish', label: `멸망 ${pokemon.perishCount}`, tone: 'danger' },
    pokemon.rechargeTurns > 0 && { id: 'recharge', label: '반동 대기', tone: 'warning' },
    pokemon.protected && { id: 'protect', label: '방어 중', tone: 'positive' },
    pokemon.destinyBondActive && { id: 'destiny-bond', label: '길동무', tone: 'danger' },
    chargingMove && { id: 'charging', label: `${chargingMove.name} 준비`, tone: 'accent' },
    lockedMove && { id: 'locked', label: `${lockedMove.name} 연속`, tone: 'accent' },
    pokemon.semiInvulnerable && !chargingMove && { id: 'semi-invulnerable', label: '회피 상태', tone: 'positive' },
  ].filter(Boolean)
}

function battleGimmickEntries(pokemon) {
  return [
    pokemon.megaActive && { id: 'mega', label: '메가진화' },
    pokemon.primalActive && { id: 'primal', label: '원시회귀' },
    pokemon.teraActive && { id: 'tera', label: `${pokemon.teraType} 테라스탈` },
    pokemon.dynamaxActive && {
      id: pokemon.dynamaxMode === 'gigantamax' ? 'gigantamax' : 'dynamax',
      label: `${pokemon.dynamaxMode === 'gigantamax' ? '거다이맥스' : '다이맥스'} ${pokemon.dynamaxTurns}턴`,
    },
  ].filter(Boolean)
}

function BattlePokemonStatusTooltip({ id, pokemon, side, trainerName, visible }) {
  const hpPercent = Math.ceil(hpRatio(pokemon))
  const statStages = battleStatStageEntries(pokemon)
  const conditions = battleConditionEntries(pokemon)
  const gimmicks = battleGimmickEntries(pokemon)
  const heldItem = getBattleItem(pokemon.heldItemId)
  const heldItemName = heldItem?.name || pokemon.heldItemName || '없음'

  return (
    <aside
      className={`battle-pokemon-inspector side-${side}${visible ? ' is-visible' : ''}`}
      id={id}
      role="tooltip"
      aria-hidden={!visible}
    >
      <header className="battle-pokemon-inspector-header">
        <PokemonSprite
          animatedSrc={pokemon.icon}
          fallbackSrc={pokemon.iconFallback}
          frameClassName="battle-pokemon-inspector-icon"
          className="battle-pokemon-inspector-icon-sprite"
          alt={pokemon.name}
        />
        <span>
          <small>{side === 'player' ? 'MY POKÉMON' : `${trainerName} · OPPONENT`}</small>
          <strong>{pokemon.name}</strong>
          <em>
            Lv.{pokemon.level ?? 50}
            {side === 'player' ? ` · ${pokemon.nature ?? '노력'} 성격` : ''}
          </em>
        </span>
        <b>STATUS</b>
      </header>

      <div className="battle-pokemon-inspector-vitals">
        <span className="battle-pokemon-inspector-types">
          {(pokemon.types ?? []).map((type) => (
            <b className={`type-${typeClassName(type)}`} key={type}>{type}</b>
          ))}
        </span>
        <span className="battle-pokemon-inspector-hp">
          <small>HP</small>
          <span className={`battle-hp-meter tone-${hpTone(pokemon)}`}>
            <i style={{ width: `${hpRatio(pokemon)}%` }} />
          </span>
          <strong>{hpPercent}%</strong>
        </span>
      </div>

      {side === 'player' && (
        <div className="battle-pokemon-inspector-meta">
          <span>
            <small>특성</small>
            <strong>{pokemon.ability || '—'}</strong>
          </span>
          <span>
            <small>지닌 도구</small>
            <strong>
              {heldItem?.sprite && <img src={heldItem.sprite} alt="" draggable="false" />}
              {heldItemName}
            </strong>
          </span>
          <span>
            <small>테라스탈 타입</small>
            <strong>{pokemon.teraType || '—'}</strong>
          </span>
        </div>
      )}

      <div className="battle-pokemon-inspector-state">
        <small>현재 전투 상태</small>
        <span>
          {gimmicks.map((entry) => (
            <b className={`is-gimmick gimmick-${entry.id}`} key={entry.id}>{entry.label}</b>
          ))}
          {conditions.map((entry) => (
            <b className={`condition-${entry.tone}`} key={entry.id}>{entry.label}</b>
          ))}
          {statStages.map(({ id: statId, label, stage }) => (
            <b className={stage > 0 ? 'is-raised' : 'is-lowered'} key={statId}>
              {label}<em>{stage > 0 ? '+' : ''}{stage}</em>
            </b>
          ))}
          {gimmicks.length + conditions.length + statStages.length === 0 && <em className="is-neutral">변화 없음</em>}
        </span>
      </div>

      {side === 'player' && (
        <section className="battle-pokemon-inspector-moves">
          <header><small>배틀 기술</small><span>현재 PP</span></header>
          <div>
            {(pokemon.moves ?? []).map((move, index) => (
              <span className="battle-pokemon-inspector-move" key={`${move.id}-${index}`}>
                <i className={`type-${typeClassName(move.type)}`}>{move.type}</i>
                <strong>{move.name}</strong>
                <em>{move.currentPp}/{move.maxPp}</em>
              </span>
            ))}
          </div>
        </section>
      )}
    </aside>
  )
}

export default BattlePokemonStatusTooltip
