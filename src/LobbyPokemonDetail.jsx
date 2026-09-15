import { Gem, Package, Sparkles } from 'lucide-react'
import PokemonSprite from './PokemonSprite'
import { ALL_BATTLE_ITEMS as BATTLE_ITEMS } from './data/shopData'
import { calculateStats, typeClassName } from './data/trainingData'

const ITEM_BY_ID = new Map(BATTLE_ITEMS.map((item) => [item.id, item]))

function moveName(move) {
  return typeof move === 'string' ? move : move?.name
}

/** Compact loadout readout for the mobile lobby's middle column. */
function LobbyPokemonDetail({ pokemon, onOpenTraining }) {
  if (!pokemon) {
    return (
      <section className="lobby-detail-panel glass-panel is-empty" aria-label="선택한 포켓몬 정보">
        <Sparkles size={26} aria-hidden="true" />
        <strong>포켓몬을 선택하세요</strong>
        <small>팀 슬롯을 누르면 세팅을 확인할 수 있습니다.</small>
      </section>
    )
  }

  const heldItem = ITEM_BY_ID.get(pokemon.heldItemId)
  const teraType = pokemon.teraType ?? pokemon.types?.[0] ?? '노말'
  const stats = calculateStats(pokemon)
  const moves = (pokemon.moves ?? []).map(moveName).filter(Boolean)

  return (
    <section className="lobby-detail-panel glass-panel" aria-label={`${pokemon.name} 세팅`}>
      <header className="lobby-detail-heading">
        <span className="lobby-detail-name">
          <strong>{pokemon.name}</strong>
          <em>Lv.{pokemon.level ?? 50}</em>
        </span>
        <span className="lobby-detail-types">
          {(pokemon.types ?? []).map((type) => (
            <b className={`game-type-chip type-${typeClassName(type)}`} key={type}>{type}</b>
          ))}
        </span>
      </header>

      <div className="lobby-detail-body">
        <div className="lobby-detail-art">
          <PokemonSprite
            className="pokemon-battle-sprite"
            frameClassName="lobby-detail-sprite-frame"
            animatedSrc={pokemon.spriteFront}
            fallbackSrc={pokemon.spriteFrontFallback}
            alt={pokemon.name}
            draggable="false"
          />
        </div>

        <dl className="lobby-detail-facts">
          <div>
            <dt>특성</dt>
            <dd>{pokemon.ability ?? '미설정'}</dd>
          </div>
          <div>
            <dt>성격</dt>
            <dd>{pokemon.nature ?? '노력'}</dd>
          </div>
          <div>
            <dt><Package size={10} aria-hidden="true" /> 도구</dt>
            <dd>{heldItem?.name ?? '없음'}</dd>
          </div>
          <div>
            <dt><Gem size={10} aria-hidden="true" /> 테라</dt>
            <dd className={`type-${typeClassName(teraType)}`}>{teraType}</dd>
          </div>
        </dl>
      </div>

      <ul className="lobby-detail-stats" aria-label="능력치">
        {stats.map((stat) => (
          <li className={`trend-${stat.trend}`} key={stat.key}>
            <small>{stat.shortLabel}</small>
            <strong>{stat.value}</strong>
          </li>
        ))}
      </ul>

      <ul className="lobby-detail-moves" aria-label="기술">
        {Array.from({ length: 4 }, (_, index) => (
          <li className={moves[index] ? '' : 'empty'} key={`lobby-detail-move-${index}`}>
            {moves[index] ?? '—'}
          </li>
        ))}
      </ul>

      <button className="lobby-detail-edit" type="button" onClick={onOpenTraining}>
        트레이닝에서 편집
      </button>
    </section>
  )
}

export default LobbyPokemonDetail
