import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  Boxes,
  ChevronLeft,
  ChevronRight,
  Clock3,
  RotateCcw,
  Sparkles,
  Star,
  Ticket,
  Zap,
} from 'lucide-react'
import PokemonSprite from './PokemonSprite'
import {
  BASE_SHINY_ODDS,
  DRAW_BANNER_ORDER,
  DRAW_RARITY_ORDER,
  POKEMON_POOL,
  RARITY_META,
  getDrawBanner,
  getPickupRotationRemainingMs,
} from './data/pokemonPool'
import {
  calculateStats,
  getDefaultMoves,
  getMove,
  getSpeciesProfile,
  typeClassName,
} from './data/trainingData'

const BANNER_FEATURED_SPECIES = {
  standard: [6, 448, 700],
  shiny: [130, 282, 635],
}

const EGG_SPRITES = {
  common: '/assets/draw/eggs/common.png',
  rare: '/assets/draw/eggs/rare.png',
  elite: '/assets/draw/eggs/elite.png',
  champion: '/assets/draw/eggs/champion.png',
  legend: '/assets/draw/eggs/legend.png',
}

const EGG_HATCH_DURATION_MS = 920
const EGG_REVEAL_BURST_MS = 680

function formatRate(rate) {
  const percentage = Math.round(rate * 1000) / 10
  return Number.isInteger(percentage) ? `${percentage}%` : `${percentage.toFixed(1)}%`
}

function formatCountdown(remainingMs) {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':')
}

function BannerPokemon({ profile, shiny, featuredIndex, solo }) {
  return (
    <PokemonSprite
      className="pokemon-battle-sprite"
      frameClassName={`draw-banner-pokemon-frame feature-${featuredIndex}${solo ? ' solo' : ''}`}
      animatedSrc={shiny ? profile.spriteFrontShiny : profile.spriteFront}
      fallbackSrc={shiny ? profile.spriteFrontShinyFallback : profile.spriteFrontFallback}
      alt={`${shiny ? '이로치 ' : ''}${profile.name}`}
      draggable="false"
    />
  )
}

function DrawBannerCard({ banner, pickupRemainingMs }) {
  const featuredProfiles = banner.id === 'pickup'
    ? [banner.pickup]
    : BANNER_FEATURED_SPECIES[banner.id].map(getSpeciesProfile)

  return (
    <article className={`draw-banner-card banner-${banner.id}`}>
      <span className="draw-banner-glow" aria-hidden="true" />
      <div className="draw-banner-copy">
        <span>{banner.eyebrow}</span>
        <h2>{banner.title}</h2>
        {banner.pickup && <strong>{banner.pickup.name} 픽업</strong>}
        <div className="draw-banner-tags">
          <span>최종 진화형 {POKEMON_POOL.length}종</span>
          <span>EX {formatRate(RARITY_META.legend.rate)}</span>
          <span>{banner.shinyOnly ? '이로치 100%' : `이로치 1/${BASE_SHINY_ODDS.toLocaleString()}`}</span>
        </div>
      </div>

      <div className={`draw-banner-art${featuredProfiles.length === 1 ? ' solo' : ''}`}>
        <span className="draw-banner-art-orbit" aria-hidden="true" />
        {featuredProfiles.map((profile, index) => (
          <BannerPokemon
            profile={profile}
            shiny={banner.shinyOnly}
            featuredIndex={index}
            solo={featuredProfiles.length === 1}
            key={`${banner.id}-${profile.id}`}
          />
        ))}
      </div>

      <div className="draw-banner-footer">
        <span>{String(DRAW_BANNER_ORDER.indexOf(banner.id) + 1).padStart(2, '0')} / 03</span>
        {banner.pickup ? (
          <strong><Clock3 size={14} /> 다음 픽업까지 {formatCountdown(pickupRemainingMs)}</strong>
        ) : (
          <strong>{banner.shinyOnly ? '모든 결과가 이로치로 등장' : '일반·전설·환상 이로치 등장 가능'}</strong>
        )}
      </div>
    </article>
  )
}

function HatchScreen({ balance, results, onBack, onDraw, onOpenBox }) {
  const initialBannerId = results[0]?.bannerId ?? DRAW_BANNER_ORDER[0]
  const [selectedBannerIndex, setSelectedBannerIndex] = useState(() => (
    Math.max(0, DRAW_BANNER_ORDER.indexOf(initialBannerId))
  ))
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [view, setView] = useState(results.length > 0 ? 'results' : 'banner')
  const [now, setNow] = useState(Date.now)
  const [revealedSlotIds, setRevealedSlotIds] = useState(() => new Set())
  const [hatchingSlotId, setHatchingSlotId] = useState(null)
  const [revealBurstSlotId, setRevealBurstSlotId] = useState(null)
  const hatchTimerRef = useRef(null)
  const burstTimerRef = useRef(null)
  const drawKey = results[0]?.slotId
  const resultBannerId = results[0]?.bannerId
  const selectedBannerId = DRAW_BANNER_ORDER[selectedBannerIndex]
  const activeBanner = getDrawBanner(selectedBannerId, now)
  const pickupRemainingMs = getPickupRotationRemainingMs(now)
  const selectedResult = results[selectedIndex] ?? results[0] ?? null
  const selectedProfile = selectedResult ? getSpeciesProfile(selectedResult.id) : null
  const selectedRarity = selectedResult ? RARITY_META[selectedResult.rarity] : null
  const selectedIsRevealed = Boolean(selectedResult && revealedSlotIds.has(selectedResult.slotId))
  const selectedIsHatching = selectedResult?.slotId === hatchingSlotId
  const selectedHasRevealBurst = selectedResult?.slotId === revealBurstSlotId
  const revealedCount = results.filter((result) => revealedSlotIds.has(result.slotId)).length
  const revealedShinyCount = results.filter((result) => (
    revealedSlotIds.has(result.slotId) && result.isShiny
  )).length
  const showingResults = view === 'results' && selectedResult
  const canAfford = balance >= activeBanner.price
  const selectedStats = useMemo(
    () => (selectedResult ? calculateStats({ speciesId: selectedResult.id, nature: '노력' }) : []),
    [selectedResult?.id],
  )
  const selectedMoves = selectedResult ? getDefaultMoves(selectedResult.id).map(getMove) : []

  useEffect(() => {
    if (view !== 'banner') return undefined

    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [view])

  useEffect(() => {
    if (!drawKey) {
      setView('banner')
      return
    }

    window.clearTimeout(hatchTimerRef.current)
    window.clearTimeout(burstTimerRef.current)
    const resultBannerIndex = DRAW_BANNER_ORDER.indexOf(resultBannerId)
    if (resultBannerIndex >= 0) setSelectedBannerIndex(resultBannerIndex)
    setSelectedIndex(0)
    setRevealedSlotIds(new Set())
    setHatchingSlotId(null)
    setRevealBurstSlotId(null)
    setView('results')
  }, [drawKey, resultBannerId])

  useEffect(() => () => {
    window.clearTimeout(hatchTimerRef.current)
    window.clearTimeout(burstTimerRef.current)
  }, [])

  const cycleBanner = (direction) => {
    setSelectedBannerIndex((currentIndex) => (
      (currentIndex + direction + DRAW_BANNER_ORDER.length) % DRAW_BANNER_ORDER.length
    ))
  }

  const requestDraw = () => {
    onDraw(activeBanner.id)
  }

  const revealResultAt = (index) => {
    const result = results[index]
    if (!result || hatchingSlotId) return

    setSelectedIndex(index)
    if (revealedSlotIds.has(result.slotId)) return

    setRevealBurstSlotId(null)
    setHatchingSlotId(result.slotId)
    hatchTimerRef.current = window.setTimeout(() => {
      setRevealedSlotIds((currentSlotIds) => {
        const nextSlotIds = new Set(currentSlotIds)
        nextSlotIds.add(result.slotId)
        return nextSlotIds
      })
      setHatchingSlotId(null)
      setRevealBurstSlotId(result.slotId)
      burstTimerRef.current = window.setTimeout(() => {
        setRevealBurstSlotId(null)
      }, EGG_REVEAL_BURST_MS)
    }, EGG_HATCH_DURATION_MS)
  }

  return (
    <main className={`draw-screen${showingResults ? ' showing-results' : ' showing-banner'}`}>
      <header className="draw-header">
        <button className="screen-back-button" type="button" aria-label="로비로 돌아가기" onClick={onBack}>
          <ArrowLeft size={19} />
          <span>로비</span>
        </button>

        <div className="draw-title">
          <span>{showingResults ? 'SCOUT RESULT' : activeBanner.eyebrow}</span>
          <h1>{showingResults ? '포켓몬 뽑기 결과' : activeBanner.title}</h1>
        </div>

        <div
          className="draw-count"
          aria-label={showingResults ? `${revealedCount}마리 개봉, 이로치 ${revealedShinyCount}마리` : `보유 ${balance} VP`}
        >
          {showingResults ? <Boxes size={17} /> : <Zap size={17} fill="currentColor" />}
          <span>{showingResults ? '획득' : '보유 VP'}</span>
          <strong>
            {showingResults ? revealedCount : balance.toLocaleString()}
            <em>{showingResults ? '/10' : 'VP'}</em>
          </strong>
          {showingResults && revealedShinyCount > 0 && (
            <i className="draw-shiny-count"><Star size={10} fill="currentColor" /> {revealedShinyCount}</i>
          )}
        </div>
      </header>

      {!showingResults ? (
        <section className="draw-banner-view" aria-label="뽑기 배너 선택">
          <div className="draw-banner-stage">
            <button type="button" className="draw-banner-arrow previous" aria-label="이전 뽑기" onClick={() => cycleBanner(-1)}>
              <ChevronLeft size={30} />
            </button>
            <DrawBannerCard
              banner={activeBanner}
              pickupRemainingMs={pickupRemainingMs}
              key={`${activeBanner.id}-${activeBanner.pickup?.id ?? 'all'}`}
            />
            <button type="button" className="draw-banner-arrow next" aria-label="다음 뽑기" onClick={() => cycleBanner(1)}>
              <ChevronRight size={30} />
            </button>
          </div>

          <div className="draw-banner-rate-board" aria-label="등급별 등장 확률">
            {DRAW_RARITY_ORDER.map((rarity) => (
              <div className={`draw-rate-chip rarity-${rarity}`} key={rarity}>
                <span>{RARITY_META[rarity].stars}</span>
                <strong>{RARITY_META[rarity].label}</strong>
                <em>{formatRate(RARITY_META[rarity].rate)}</em>
              </div>
            ))}
          </div>

          <footer className="draw-banner-purchase">
            <div className="draw-banner-pagination" aria-label="뽑기 종류">
              {DRAW_BANNER_ORDER.map((bannerId, index) => (
                <button
                  type="button"
                  className={index === selectedBannerIndex ? 'active' : ''}
                  aria-label={getDrawBanner(bannerId, now).title}
                  aria-pressed={index === selectedBannerIndex}
                  onClick={() => setSelectedBannerIndex(index)}
                  key={bannerId}
                />
              ))}
            </div>
            <div className="draw-banner-price">
              <span>10회 스카우트</span>
              <strong><Zap size={15} fill="currentColor" /> {activeBanner.price.toLocaleString()} VP</strong>
            </div>
            <button type="button" className="draw-purchase-button" disabled={!canAfford} onClick={requestDraw}>
              <Ticket size={19} />
              <span>{canAfford ? '10회 뽑기' : 'VP 부족'}</span>
              <ChevronRight size={18} />
            </button>
          </footer>
        </section>
      ) : (
        <>
          <section className={`draw-showcase${selectedIsRevealed && selectedResult.isShiny ? ' is-shiny' : ''}`}>
            <aside className={`draw-data-panel draw-stat-panel${selectedIsRevealed ? '' : ' is-concealed'}`}>
              {selectedIsRevealed ? (
                <>
                  <div className="draw-panel-heading">
                    <span>능력치</span>
                    <strong>종족값 {selectedResult.baseStatTotal}</strong>
                  </div>

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
                <div className="draw-concealed-panel" aria-hidden="true">
                  <span>?</span>
                  <strong>능력치 미확인</strong>
                </div>
              )}
            </aside>

            <div className="draw-center-stage" aria-live="polite">
              <span className="draw-stage-ring" aria-hidden="true" />
              <span className="draw-stage-light" aria-hidden="true" />
              {selectedIsRevealed ? (
                <div
                  className={`draw-revealed-pokemon rarity-${selectedResult.rarity}${selectedResult.isShiny ? ' is-shiny' : ''}`}
                  key={selectedResult.slotId}
                >
                  {selectedHasRevealBurst && <span className="draw-hatch-burst" aria-hidden="true" />}
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
                </div>
              ) : (
                <button
                  className={`draw-egg-reveal rarity-${selectedResult.rarity}${selectedIsHatching ? ' is-hatching' : ''}`}
                  type="button"
                  disabled={selectedIsHatching}
                  aria-label={`${selectedRarity.label} 알 열기`}
                  onClick={() => revealResultAt(selectedIndex)}
                  key={selectedResult.slotId}
                >
                  <span className="draw-egg-aura" aria-hidden="true" />
                  <span className="draw-rarity">{selectedRarity.stars} {selectedRarity.label}</span>
                  <img src={EGG_SPRITES[selectedResult.rarity]} alt="" draggable="false" />
                  <span className="draw-egg-cracks" aria-hidden="true"><i /><i /><i /></span>
                  <span className="draw-egg-flash" aria-hidden="true" />
                  <strong>{selectedIsHatching ? '부화 중...' : '알을 클릭해 확인'}</strong>
                  <small>{String(selectedIndex + 1).padStart(2, '0')} / 10</small>
                </button>
              )}
            </div>

            <aside className={`draw-data-panel draw-move-panel${selectedIsRevealed ? '' : ' is-concealed'}`}>
              {selectedIsRevealed ? (
                <>
                  <div className="draw-panel-heading">
                    <span>기술</span>
                    <strong>4</strong>
                  </div>
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
                <div className="draw-concealed-panel" aria-hidden="true">
                  <span>?</span>
                  <strong>기술·특성 미확인</strong>
                </div>
              )}
            </aside>
          </section>

          <footer className="draw-dock">
            <div className="draw-dock-toolbar">
              <div className="draw-guide">
                <Sparkles size={16} />
                <span>{selectedIsRevealed ? `${selectedRarity.label} · ${activeBanner.title}` : `${selectedRarity.label} 알 · 클릭해서 확인`}</span>
              </div>
              <div className="draw-actions">
                <button type="button" onClick={() => setView('banner')}><Sparkles size={16} /> 배너 선택</button>
                <button type="button" onClick={onOpenBox}><Boxes size={16} /> 박스</button>
                <button type="button" disabled={!canAfford} onClick={requestDraw}>
                  <RotateCcw size={16} /> 다시 10회 · {activeBanner.price.toLocaleString()} VP
                </button>
              </div>
            </div>

            <div className="draw-slot-strip" aria-label="뽑은 포켓몬 10마리">
              {results.map((result, index) => {
                const rarity = RARITY_META[result.rarity]
                const isSelected = index === selectedIndex
                const isRevealed = revealedSlotIds.has(result.slotId)
                const isHatching = hatchingSlotId === result.slotId

                return (
                  <button
                    className={`draw-slot ${isRevealed ? 'revealed' : 'sealed'} rarity-${result.rarity}${isRevealed && result.isShiny ? ' is-shiny' : ''}${isHatching ? ' cracking' : ''}${isSelected ? ' selected' : ''}`}
                    key={result.slotId}
                    type="button"
                    style={{ '--draw-index': index }}
                    aria-label={isRevealed ? `${result.isShiny ? '이로치 ' : ''}${result.name}, ${rarity.label}` : `${rarity.label} 알 열기`}
                    aria-pressed={isSelected}
                    disabled={Boolean(hatchingSlotId && !isHatching)}
                    onClick={() => revealResultAt(index)}
                  >
                    <span className="draw-slot-number">{String(index + 1).padStart(2, '0')}</span>
                    {isRevealed ? (
                      <>
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
                      </>
                    ) : (
                      <>
                        <img className="draw-slot-egg" src={EGG_SPRITES[result.rarity]} alt="" draggable="false" />
                        <strong>{isHatching ? '부화 중...' : rarity.label}</strong>
                      </>
                    )}
                  </button>
                )
              })}
            </div>
          </footer>
        </>
      )}
    </main>
  )
}

export default HatchScreen
