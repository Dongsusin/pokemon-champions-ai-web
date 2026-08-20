import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Boxes, RotateCcw, Sparkles, Star } from 'lucide-react'
import PokemonSprite from './PokemonSprite'
import { BASE_SHINY_ODDS, POKEMON_POOL, RARITY_META } from './data/pokemonPool'
import {
  calculateStats,
  getDefaultMoves,
  getMove,
  getSpeciesProfile,
  typeClassName,
} from './data/trainingData'

function HatchScreen({ results, onBack, onOpenBox, onReset }) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const drawKey = results[0]?.slotId
  const selectedResult = results[selectedIndex] ?? results[0] ?? null
  const selectedProfile = selectedResult ? getSpeciesProfile(selectedResult.id) : null
  const selectedRarity = selectedResult ? RARITY_META[selectedResult.rarity] : null
  const shinyCount = results.filter((result) => result.isShiny).length
  const selectedStats = useMemo(
    () => (selectedResult ? calculateStats({ speciesId: selectedResult.id, nature: '노력' }) : []),
    [selectedResult?.id],
  )
  const selectedMoves = selectedResult ? getDefaultMoves(selectedResult.id).map(getMove) : []

  useEffect(() => {
    setSelectedIndex(0)
  }, [drawKey])

  return (
    <main className="draw-screen">
      <header className="draw-header">
        <button className="screen-back-button" type="button" aria-label="로비로 돌아가기" onClick={onBack}>
          <ArrowLeft size={19} />
          <span>로비</span>
        </button>

        <div className="draw-title">
          <span>PARTNER DISCOVERY</span>
          <h1>포켓몬 뽑기</h1>
          <p>전설·환상을 포함한 최종 진화형 {POKEMON_POOL.length.toLocaleString()}종이 모두 같은 확률로 등장합니다.</p>
        </div>

        <div className="draw-count" aria-label={`${results.length}마리 획득, 이로치 ${shinyCount}마리`}>
          <Boxes size={17} />
          <span>획득</span>
          <strong>{results.length}<em>/10</em></strong>
          {shinyCount > 0 && <i className="draw-shiny-count"><Star size={10} fill="currentColor" /> {shinyCount}</i>}
        </div>
      </header>

      <section className={`draw-showcase${selectedResult?.isShiny ? ' is-shiny' : ''}`}>
        <aside className="draw-data-panel draw-stat-panel">
          <div className="draw-panel-heading">
            <span>능력치</span>
            <strong>{selectedResult ? 'Lv.50' : '--'}</strong>
          </div>

          {selectedResult && selectedProfile ? (
            <>
              <div className="draw-pokemon-heading">
                <small>NO. {String(selectedProfile.id).padStart(4, '0')}</small>
                <h2>{selectedProfile.name}</h2>
                <div className="type-chip-list">
                  {selectedProfile.types.map((type) => (
                    <span className={`game-type-chip type-${typeClassName(type)}`} key={type}>{type}</span>
                  ))}
                </div>
              </div>
              <div className="game-stat-list">
                {selectedStats.map((stat) => (
                  <div className="game-stat-row" key={stat.key}>
                    <span>{stat.shortLabel}</span>
                    <strong>{stat.value}</strong>
                    <i><b style={{ width: `${Math.max(6, stat.ratio * 100)}%` }} /></i>
                    <em>{stat.trainingPoint}</em>
                  </div>
                ))}
              </div>
              <div className="draw-nature-strip"><span>성격</span><strong>노력</strong></div>
            </>
          ) : (
            <div className="draw-panel-empty">뽑기 결과가 없습니다.</div>
          )}
        </aside>

        <div className="draw-center-stage" aria-live="polite">
          <span className="draw-stage-ring" aria-hidden="true" />
          <span className="draw-stage-light" aria-hidden="true" />

          {selectedResult && (
            <div
              className={`draw-revealed-pokemon rarity-${selectedResult.rarity}${selectedResult.isShiny ? ' is-shiny' : ''}`}
              key={drawKey}
            >
              {selectedResult.isShiny && <span className="draw-shiny-aura" aria-hidden="true" />}
              <span className="draw-rarity">{selectedRarity.stars} {selectedRarity.label}</span>
              {selectedResult.isShiny && (
                <span className="draw-shiny-label"><Star size={11} fill="currentColor" /> 이로치</span>
              )}
              <PokemonSprite
                className="pokemon-battle-sprite"
                frameClassName="draw-main-sprite-frame"
                animatedSrc={selectedResult.spriteFront}
                fallbackSrc={selectedResult.spriteFrontFallback}
                alt={`${selectedResult.isShiny ? '이로치 ' : ''}${selectedResult.name} 앞모습`}
                draggable="false"
              />
              <strong>{selectedResult.name}</strong>
              <small>
                {selectedResult.isShiny ? 'SHINY · ' : ''}
                직접 획득 {selectedResult.previousDrawCount + 1}회 · 이로치 1/{selectedResult.shinyOdds.toLocaleString()}
              </small>
            </div>
          )}
        </div>

        <aside className="draw-data-panel draw-move-panel">
          <div className="draw-panel-heading">
            <span>기술</span>
            <strong>{selectedResult ? '4' : '--'}</strong>
          </div>

          {selectedResult && selectedProfile ? (
            <>
              <div className="draw-move-list">
                {selectedMoves.map((move) => (
                  <div className="draw-move-row" key={move.name}>
                    <span className={`move-type-icon type-${typeClassName(move.type)}`}>{move.type.slice(0, 1)}</span>
                    <strong>{move.name}</strong>
                    <em>PP {move.pp}</em>
                  </div>
                ))}
              </div>
              <div className="draw-ability-box">
                <span>특성</span>
                <strong>{selectedProfile.abilities[0]}</strong>
              </div>
            </>
          ) : (
            <div className="draw-panel-empty">뽑기 결과가 없습니다.</div>
          )}
        </aside>
      </section>

      <footer className="draw-dock">
        <div className="draw-dock-toolbar">
          <div className="draw-guide">
            <Sparkles size={16} />
            <span>
              각 최종 진화형은 1/{POKEMON_POOL.length.toLocaleString()}로 동일합니다. 이로치는 기본 1/{BASE_SHINY_ODDS.toLocaleString()}, 같은 종을 직접 뽑을 때만 조금씩 상승합니다.
            </span>
          </div>
          <div className="draw-actions">
            <button type="button" onClick={onOpenBox}><Boxes size={16} /> 박스</button>
            <button type="button" onClick={onReset}><RotateCcw size={16} /> 다시 뽑기 10회</button>
          </div>
        </div>

        <div className="draw-slot-strip" aria-label="뽑은 포켓몬 10마리">
          {results.map((result, index) => {
            const rarity = RARITY_META[result.rarity]
            const isSelected = index === selectedIndex

            return (
              <button
                className={`draw-slot revealed rarity-${result.rarity}${result.isShiny ? ' is-shiny' : ''}${isSelected ? ' selected' : ''}`}
                key={result.slotId}
                type="button"
                style={{ '--draw-index': index }}
                aria-label={`${result.isShiny ? '이로치 ' : ''}${result.name}, ${rarity.label}`}
                aria-pressed={isSelected}
                onClick={() => setSelectedIndex(index)}
              >
                <span className="draw-slot-number">{String(index + 1).padStart(2, '0')}</span>
                {result.isShiny && <span className="pokemon-shiny-mark" aria-hidden="true">★</span>}
                <span className="pokemon-icon-frame draw-result-frame" aria-hidden="true">
                  <img
                    className="draw-result-sprite pokemon-box-icon"
                    src={result.icon}
                    alt=""
                    draggable="false"
                    onError={(event) => {
                      if (event.currentTarget.dataset.fallbackApplied) return
                      event.currentTarget.dataset.fallbackApplied = 'true'
                      event.currentTarget.src = result.iconFallback
                    }}
                  />
                </span>
                <strong>{result.name}</strong>
              </button>
            )
          })}
        </div>
      </footer>
    </main>
  )
}

export default HatchScreen
