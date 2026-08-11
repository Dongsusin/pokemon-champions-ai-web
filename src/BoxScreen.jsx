import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  Backpack,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  CircleOff,
  Crown,
  Dna,
  Gem,
  LockKeyhole,
  Maximize2,
  Package,
  Plus,
  Search,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Star,
  WandSparkles,
  X,
} from 'lucide-react'
import PokemonSprite from './PokemonSprite'
import { getPokemonEvolutionFamilyKey, getShinyOdds } from './data/pokemonPool'
import {
  BATTLE_ITEMS,
  SHOP_CATEGORIES,
  getEquippedBattleItemCounts,
} from './data/shopData'
import {
  DYNAMAX_MODES,
  NATIONAL_DEX,
  NATIONAL_DEX_COUNT,
  TERA_TYPES,
  canGigantamax,
  getGigantamaxProfile,
  typeClassName,
} from './data/trainingData'

const PAGE_SIZE = 12
const PARTY_SIZE = 6
const GENERATIONS = Array.from({ length: 9 }, (_, index) => index + 1)
const ITEM_BY_ID = new Map(BATTLE_ITEMS.map((item) => [item.id, item]))
const ITEM_CATEGORY_BY_ID = new Map(SHOP_CATEGORIES.map((category) => [category.id, category]))

function normalizeItemSearch(value) {
  return String(value ?? '').toLocaleLowerCase('ko-KR').replace(/[\s_-]/g, '')
}

function BattleItemArtwork({ item, compact = false }) {
  const [imageFailed, setImageFailed] = useState(false)

  useEffect(() => {
    setImageFailed(false)
  }, [item?.id])

  return (
    <span className={`held-item-artwork${compact ? ' compact' : ''}`} aria-hidden="true">
      {item?.sprite && !imageFailed ? (
        <img src={item.sprite} alt="" onError={() => setImageFailed(true)} />
      ) : (
        <Package size={compact ? 13 : 21} />
      )}
    </span>
  )
}

function fallbackImageHandler(fallback) {
  return (event) => {
    if (!fallback || event.currentTarget.dataset.fallbackApplied) return
    event.currentTarget.dataset.fallbackApplied = 'true'
    event.currentTarget.src = fallback
  }
}

function BoxScreen({
  pokemon,
  teams = [],
  activeTeamId,
  teamIds,
  inventory = {},
  onBack,
  backLabel = '로비',
  onEquipItem,
  onSetTeraType,
  onSetDynamaxMode,
  onSelectTeam,
  onToggleTeam,
  onAutoTeam,
  onConfirmTeam,
  onOpenHatch,
  onOpenShop,
}) {
  const [page, setPage] = useState(0)
  const [selectedDexId, setSelectedDexId] = useState(pokemon[0]?.dexSpeciesId ?? 1)
  const [search, setSearch] = useState('')
  const [generation, setGeneration] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [showShiny, setShowShiny] = useState(false)
  const [itemPickerOpen, setItemPickerOpen] = useState(false)
  const [teraPickerOpen, setTeraPickerOpen] = useState(false)
  const [dynamaxPickerOpen, setDynamaxPickerOpen] = useState(false)
  const [itemSearch, setItemSearch] = useState('')
  const [itemCategory, setItemCategory] = useState('all')
  const collectionByDexId = useMemo(
    () => new Map(pokemon.map((entry) => [Number(entry.dexSpeciesId ?? entry.speciesId), entry])),
    [pokemon],
  )
  const shinyCount = pokemon.filter((entry) => entry.shinyObtained).length
  const activeTeam = teams.find((team) => team.id === activeTeamId) ?? teams[0]
  const teamPokemon = teamIds
    .map((captureId) => pokemon.find((entry) => entry.captureId === captureId))
    .filter(Boolean)

  const filteredDex = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase('ko-KR')

    return NATIONAL_DEX.filter((profile) => {
      const collectedPokemon = collectionByDexId.get(profile.id)
      const isCollected = Boolean(collectedPokemon)
      const numberMatches = String(profile.id).includes(normalizedSearch.replace(/^#/, ''))
      const nameMatches = isCollected && profile.name.toLocaleLowerCase('ko-KR').includes(normalizedSearch)
      const searchMatches = !normalizedSearch || numberMatches || nameMatches
      const generationMatches = generation === 'all' || profile.generation === Number(generation)
      const statusMatches = statusFilter === 'all'
        || (statusFilter === 'collected' && isCollected)
        || (statusFilter === 'unseen' && !isCollected)
        || (statusFilter === 'shiny' && collectedPokemon?.shinyObtained)
        || (statusFilter === 'legendary' && profile.isLegendary)
        || (statusFilter === 'mythical' && profile.isMythical)

      return searchMatches && generationMatches && statusMatches
    })
  }, [collectionByDexId, generation, search, statusFilter])

  const pageCount = Math.max(1, Math.ceil(filteredDex.length / PAGE_SIZE))
  const pageEntries = filteredDex.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const selectedProfile = NATIONAL_DEX.find((entry) => entry.id === selectedDexId) ?? null
  const selectedPokemon = collectionByDexId.get(selectedDexId) ?? null
  const selectedTeamIndex = selectedPokemon ? teamIds.indexOf(selectedPokemon.captureId) : -1
  const selectedIsInTeam = selectedTeamIndex !== -1
  const selectedFamilyConflict = selectedPokemon && !selectedIsInTeam
    ? teamPokemon.find((entry) => (
      getPokemonEvolutionFamilyKey(entry) === getPokemonEvolutionFamilyKey(selectedPokemon)
    ))
    : null
  const selectedHeldItem = selectedPokemon ? ITEM_BY_ID.get(selectedPokemon.heldItemId) ?? null : null
  const selectedTeraType = selectedPokemon?.teraType ?? selectedProfile?.types[0] ?? '노말'
  const selectedDynamaxMode = selectedPokemon?.dynamaxMode ?? 'dynamax'
  const selectedCanGigantamax = selectedPokemon ? canGigantamax(selectedPokemon.speciesId) : false
  const selectedGigantamaxProfile = selectedPokemon ? getGigantamaxProfile(selectedPokemon.speciesId) : null
  const equippedItemCounts = useMemo(() => getEquippedBattleItemCounts(pokemon), [pokemon])
  const ownedItems = useMemo(
    () => BATTLE_ITEMS.filter((item) => (inventory[item.id] ?? 0) > 0),
    [inventory],
  )
  const itemCategoryCounts = useMemo(() => Object.fromEntries(SHOP_CATEGORIES.map((category) => [
    category.id,
    category.id === 'all'
      ? ownedItems.length
      : ownedItems.filter((item) => item.category === category.id).length,
  ])), [ownedItems])
  const filteredOwnedItems = useMemo(() => {
    const normalizedSearch = normalizeItemSearch(itemSearch)

    return ownedItems.filter((item) => {
      if (itemCategory !== 'all' && item.category !== itemCategory) return false
      if (!normalizedSearch) return true
      return [item.name, item.englishName, item.id]
        .some((value) => normalizeItemSearch(value).includes(normalizedSearch))
    })
  }, [itemCategory, itemSearch, ownedItems])
  const partySlots = Array.from({ length: PARTY_SIZE }, (_, index) => teamPokemon[index] ?? null)
  const selectedSprite = selectedProfile
    ? showShiny ? selectedProfile.spriteFrontShiny : selectedProfile.spriteFront
    : null
  const selectedSpriteFallback = selectedProfile
    ? showShiny ? selectedProfile.spriteFrontShinyFallback : selectedProfile.spriteFrontFallback
    : null

  useEffect(() => {
    setPage(0)
  }, [generation, search, statusFilter])

  useEffect(() => {
    setPage((currentPage) => Math.min(currentPage, pageCount - 1))
  }, [pageCount])

  useEffect(() => {
    if (!filteredDex.some((entry) => entry.id === selectedDexId)) {
      setSelectedDexId(filteredDex[0]?.id ?? 1)
    }
  }, [filteredDex, selectedDexId])

  useEffect(() => {
    setShowShiny(false)
    setItemPickerOpen(false)
    setTeraPickerOpen(false)
    setDynamaxPickerOpen(false)
  }, [selectedDexId])

  useEffect(() => {
    if (!itemPickerOpen && !teraPickerOpen && !dynamaxPickerOpen) return undefined

    const closeOnEscape = (event) => {
      if (event.key === 'Escape') {
        setItemPickerOpen(false)
        setTeraPickerOpen(false)
        setDynamaxPickerOpen(false)
      }
    }

    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [dynamaxPickerOpen, itemPickerOpen, teraPickerOpen])

  const availableItemQuantity = (itemId) => (
    (inventory[itemId] ? 1 : 0)
    - (equippedItemCounts.get(itemId) ?? 0)
    + (selectedPokemon?.heldItemId === itemId ? 1 : 0)
  )

  const openItemPicker = () => {
    setItemSearch('')
    setItemCategory('all')
    setTeraPickerOpen(false)
    setDynamaxPickerOpen(false)
    setItemPickerOpen(true)
  }

  const chooseHeldItem = (itemId) => {
    if (!selectedPokemon) return
    onEquipItem(selectedPokemon.captureId, itemId)
    setItemPickerOpen(false)
  }

  const openTeraPicker = () => {
    setItemPickerOpen(false)
    setDynamaxPickerOpen(false)
    setTeraPickerOpen(true)
  }

  const chooseTeraType = (teraType) => {
    if (!selectedPokemon) return
    onSetTeraType(selectedPokemon.captureId, teraType)
    setTeraPickerOpen(false)
  }

  const openDynamaxPicker = () => {
    setItemPickerOpen(false)
    setTeraPickerOpen(false)
    setDynamaxPickerOpen(true)
  }

  const chooseDynamaxMode = (dynamaxMode) => {
    if (!selectedPokemon) return
    if (dynamaxMode === 'gigantamax' && !selectedCanGigantamax) return
    onSetDynamaxMode(selectedPokemon.captureId, dynamaxMode)
    setDynamaxPickerOpen(false)
  }

  return (
    <main className="pc-screen pokedex-screen">
      <header className="pc-header">
        <button className="screen-back-button" type="button" aria-label={`${backLabel} 화면으로 돌아가기`} onClick={onBack}>
          <ArrowLeft size={19} />
          <span>{backLabel}</span>
        </button>

        <div className="pc-title">
          <span>NATIONAL POKÉDEX & BATTLE PARTY</span>
          <h1>전국도감 · 팀 편성</h1>
          <p>뽑기로 진화 계통을 해금하고, 직접 뽑은 포켓몬마다 이로치 확률을 성장시키세요.</p>
        </div>

        <div className="pc-summary" aria-label={`도감 ${pokemon.length}, 이로치 ${shinyCount}, 팀 ${teamPokemon.length}`}>
          <span><Dna size={15} /> {pokemon.length}<em>/{NATIONAL_DEX_COUNT}</em></span>
          <span><Star size={15} /> {shinyCount}<em>SHINY</em></span>
          <span><ShieldCheck size={15} /> {teamPokemon.length}<em>/6</em></span>
        </div>
      </header>

      <section className="pc-workspace pokedex-workspace">
        <aside className="pc-party-panel" aria-label="배틀 팀">
          <div className="pc-party-heading">
            <div>
              <span>BATTLE PARTY · SAVED SLOT</span>
              <h2>{activeTeam?.name ?? '팀 1'}</h2>
            </div>
            <strong>{teamPokemon.length}/6</strong>
          </div>

          <div className="pc-team-presets" aria-label="저장된 팀 선택">
            {teams.map((team, index) => (
              <button
                className={team.id === activeTeam?.id ? 'selected' : ''}
                type="button"
                aria-label={`${team.name}, ${team.pokemonIds.length}마리`}
                aria-pressed={team.id === activeTeam?.id}
                key={team.id}
                onClick={() => onSelectTeam(team.id)}
              >
                <strong>{index + 1}</strong>
                <small>{team.pokemonIds.length}/6</small>
              </button>
            ))}
          </div>

          <div className="pc-party-list">
            {partySlots.map((entry, index) => (
              entry ? (
                <div className={`pc-party-card${entry.isShiny ? ' is-shiny' : ''}${entry.captureId === selectedPokemon?.captureId ? ' selected' : ''}`} key={entry.captureId}>
                  <button type="button" onClick={() => setSelectedDexId(entry.dexSpeciesId)}>
                    <span className="pc-party-index">{index + 1}</span>
                    {entry.isShiny && <span className="pokemon-shiny-mark" aria-hidden="true">★</span>}
                    <span className="pokemon-icon-frame pc-party-sprite-frame" aria-hidden="true">
                      <img
                        className="pokemon-box-icon"
                        src={entry.icon}
                        alt=""
                        draggable="false"
                        onError={fallbackImageHandler(entry.iconFallback)}
                      />
                    </span>
                    <span>
                      <strong>{entry.name}</strong>
                      <small>Lv.50 · {entry.types.join(' / ')}</small>
                      <small className="pc-party-loadout">
                        {entry.heldItemId && ITEM_BY_ID.has(entry.heldItemId) ? (
                          <span className="pc-party-held-item">
                            <BattleItemArtwork item={ITEM_BY_ID.get(entry.heldItemId)} compact />
                            <span>{ITEM_BY_ID.get(entry.heldItemId).name}</span>
                          </span>
                        ) : (
                          <span className="pc-party-held-item empty"><Package size={11} /><span>지닌 도구 없음</span></span>
                        )}
                        <span className={`pc-party-tera-chip type-${typeClassName(entry.teraType ?? entry.types[0])}`}>
                          <Gem size={9} /> {entry.teraType ?? entry.types[0]}
                        </span>
                        <span
                          className={`pc-party-dynamax-chip ${entry.dynamaxMode === 'gigantamax' ? 'gigantamax' : 'dynamax'}`}
                          title={entry.dynamaxMode === 'gigantamax' ? '거다이맥스' : '다이맥스'}
                        >
                          {entry.dynamaxMode === 'gigantamax' ? <Crown size={8} /> : <Maximize2 size={8} />}
                          {entry.dynamaxMode === 'gigantamax' ? 'G-MAX' : 'D-MAX'}
                        </span>
                      </small>
                    </span>
                  </button>
                  <button
                    className="pc-party-remove"
                    type="button"
                    aria-label={`${entry.name} 팀에서 빼기`}
                    onClick={() => onToggleTeam(entry.captureId)}
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <div className="pc-party-card empty" key={`party-empty-${index}`}>
                  <span className="pc-party-index">{index + 1}</span>
                  <Plus size={20} />
                  <span><strong>빈 슬롯</strong><small>도감에서 선택하세요</small></span>
                </div>
              )
            ))}
          </div>

          <div className="pc-party-actions">
            <button type="button" onClick={onAutoTeam} disabled={pokemon.length === 0}>
              <WandSparkles size={16} /> 자동 편성
            </button>
            <button className="primary" type="button" onClick={onConfirmTeam}>
              <Check size={16} /> 팀 저장
            </button>
          </div>
        </aside>

        <section className="pc-box-panel pokedex-panel" aria-label="전국도감">
          <div className="pokedex-toolbar">
            <label className="pokedex-search">
              <Search size={15} />
              <input
                type="search"
                value={search}
                placeholder="이름 또는 도감 번호"
                aria-label="포켓몬 검색"
                onChange={(event) => setSearch(event.target.value)}
              />
              {search && <button type="button" aria-label="검색어 지우기" onClick={() => setSearch('')}><X size={13} /></button>}
            </label>

            <div className="pokedex-generation-filter" aria-label="세대 필터">
              <button className={generation === 'all' ? 'active' : ''} type="button" onClick={() => setGeneration('all')}>전체</button>
              {GENERATIONS.map((value) => (
                <button
                  className={generation === String(value) ? 'active' : ''}
                  type="button"
                  key={value}
                  onClick={() => setGeneration(String(value))}
                >
                  {value}세대
                </button>
              ))}
            </div>

            <select value={statusFilter} aria-label="도감 상태 필터" onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">모든 상태</option>
              <option value="collected">발견 완료</option>
              <option value="unseen">미발견</option>
              <option value="shiny">이로치 발견</option>
              <option value="legendary">전설</option>
              <option value="mythical">환상</option>
            </select>
          </div>

          <div className="pokedex-progress" aria-label={`도감 완성도 ${pokemon.length} / ${NATIONAL_DEX_COUNT}`}>
            <span><b style={{ width: `${(pokemon.length / NATIONAL_DEX_COUNT) * 100}%` }} /></span>
            <strong>{((pokemon.length / NATIONAL_DEX_COUNT) * 100).toFixed(1)}%</strong>
            <em>{filteredDex.length} ENTRIES</em>
          </div>

          <div className="pc-box-grid-wrap pokedex-grid-wrap">
            <div className="pc-box-grid pokedex-grid" aria-label={`전국도감 목록, 페이지당 ${PAGE_SIZE}마리`}>
              {pageEntries.map((profile) => {
                const collectedPokemon = collectionByDexId.get(profile.id)
                const isCollected = Boolean(collectedPokemon)
                const teamIndex = collectedPokemon ? teamIds.indexOf(collectedPokemon.captureId) : -1
                const isSelected = profile.id === selectedDexId

                return (
                  <button
                    className={`pokedex-entry${isCollected ? ' collected' : ' unseen'}${isSelected ? ' selected' : ''}${teamIndex !== -1 ? ' in-team' : ''}${collectedPokemon?.shinyObtained ? ' has-shiny' : ''}`}
                    key={profile.id}
                    type="button"
                    aria-label={isCollected ? `${profile.name}, 도감 번호 ${profile.id}` : `미발견 포켓몬, 도감 번호 ${profile.id}`}
                    aria-pressed={isSelected}
                    onClick={() => setSelectedDexId(profile.id)}
                  >
                    <span className="pokedex-entry-number">#{String(profile.id).padStart(4, '0')}</span>
                    {teamIndex !== -1 && <span className="pc-team-badge">{teamIndex + 1}</span>}
                    {collectedPokemon?.shinyObtained && <span className="pokemon-shiny-mark" aria-label="이로치 발견">★</span>}
                    {collectedPokemon?.heldItemId && ITEM_BY_ID.has(collectedPokemon.heldItemId) && (
                      <span
                        className="pokedex-held-item-badge"
                        aria-label={`지닌 도구 ${ITEM_BY_ID.get(collectedPokemon.heldItemId).name}`}
                        title={ITEM_BY_ID.get(collectedPokemon.heldItemId).name}
                      >
                        <BattleItemArtwork item={ITEM_BY_ID.get(collectedPokemon.heldItemId)} compact />
                      </span>
                    )}
                    {isCollected ? (
                      <span className="pokemon-icon-frame pokedex-entry-sprite-frame" aria-hidden="true">
                        <img
                          className="pokemon-box-icon"
                          src={profile.icon}
                          alt=""
                          draggable="false"
                          onError={fallbackImageHandler(profile.iconFallback)}
                        />
                      </span>
                    ) : (
                      <span className="pokedex-question" aria-hidden="true">?</span>
                    )}
                    <strong>{isCollected ? profile.name : '???'}</strong>
                    <small>{isCollected ? `직접 획득 ${collectedPokemon.directDrawCount}회` : '미발견'}</small>
                  </button>
                )
              })}
            </div>

            {pageEntries.length === 0 && (
              <div className="pc-empty-box">
                <span><CircleHelp size={27} /></span>
                <strong>조건에 맞는 도감 항목이 없습니다.</strong>
                <p>검색어나 세대·수집 필터를 변경해보세요.</p>
              </div>
            )}
          </div>

          <div className="pokedex-footer">
            <div className="pc-pagination">
              <button type="button" aria-label="이전 페이지" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>
                <ChevronLeft size={18} />
              </button>
              <span>{page + 1} / {pageCount}</span>
              <button type="button" aria-label="다음 페이지" disabled={page === pageCount - 1} onClick={() => setPage((value) => value + 1)}>
                <ChevronRight size={18} />
              </button>
            </div>
          </div>

          <div className={`pc-selection-bar pokedex-selection${selectedPokemon ? ' has-selection' : ''}`}>
            {selectedPokemon && selectedProfile ? (
              <>
                <div className={`pokedex-selected-art${showShiny ? ' shiny' : ''}`}>
                  <PokemonSprite
                    className="pokemon-battle-sprite"
                    frameClassName="pokedex-selected-sprite-frame"
                    animatedSrc={selectedSprite}
                    fallbackSrc={selectedSpriteFallback}
                    alt={`${showShiny ? '이로치 ' : ''}${selectedProfile.name}`}
                    draggable="false"
                  />
                </div>
                <div className="pc-selection-name">
                  <small>NO. {String(selectedProfile.id).padStart(4, '0')}</small>
                  <strong>{selectedProfile.name}</strong>
                  <span className="pokedex-category">
                    {selectedProfile.isMythical ? '환상' : selectedProfile.isLegendary ? '전설' : `${selectedProfile.generation}세대`}
                  </span>
                </div>
                <div className="type-chip-list">
                  {selectedProfile.types.map((type) => (
                    <span className={`game-type-chip type-${typeClassName(type)}`} key={type}>{type}</span>
                  ))}
                </div>
                <div className="pc-selection-meta pokedex-selection-meta">
                  <span>직접 획득 <strong>{selectedPokemon.directDrawCount}회</strong></span>
                  <span>다음 이로치 <strong>1/{getShinyOdds(selectedPokemon.directDrawCount).toLocaleString()}</strong></span>
                </div>
                <button
                  className={`pokedex-held-item-button${selectedHeldItem ? ' equipped' : ''}`}
                  type="button"
                  aria-haspopup="dialog"
                  aria-expanded={itemPickerOpen}
                  onClick={openItemPicker}
                >
                  <BattleItemArtwork item={selectedHeldItem} compact />
                  <span>
                    <small>HELD ITEM</small>
                    <strong>{selectedHeldItem?.name ?? '지닌 도구 없음'}</strong>
                  </span>
                </button>
                <button
                  className="pokedex-tera-button"
                  type="button"
                  aria-haspopup="dialog"
                  aria-expanded={teraPickerOpen}
                  onClick={openTeraPicker}
                >
                  <span className={`pokedex-tera-gem type-${typeClassName(selectedTeraType)}`}><Gem size={14} /></span>
                  <span>
                    <small>TERA TYPE</small>
                    <strong>{selectedTeraType}</strong>
                  </span>
                </button>
                <button
                  className={`pokedex-dynamax-button ${selectedDynamaxMode}`}
                  type="button"
                  aria-haspopup="dialog"
                  aria-expanded={dynamaxPickerOpen}
                  onClick={openDynamaxPicker}
                >
                  <span className={`pokedex-dynamax-mark ${selectedDynamaxMode}`}>
                    {selectedDynamaxMode === 'gigantamax' ? <Crown size={14} /> : <Maximize2 size={14} />}
                  </span>
                  <span>
                    <small>MAX BATTLE</small>
                    <strong>{selectedDynamaxMode === 'gigantamax' ? '거다이맥스' : '다이맥스'}</strong>
                  </span>
                </button>
                <button
                  className={`pokedex-shiny-toggle${showShiny ? ' active' : ''}`}
                  type="button"
                  disabled={!selectedPokemon.shinyObtained}
                  onClick={() => setShowShiny((visible) => !visible)}
                >
                  {selectedPokemon.shinyObtained ? <Star size={15} fill={showShiny ? 'currentColor' : 'none'} /> : <LockKeyhole size={15} />}
                  {selectedPokemon.shinyObtained ? showShiny ? '일반색 보기' : '이로치 보기' : '이로치 미발견'}
                </button>
                <button
                  className={selectedIsInTeam ? 'remove' : ''}
                  type="button"
                  onClick={() => onToggleTeam(selectedPokemon.captureId)}
                >
                  {selectedIsInTeam ? <X size={16} /> : <Plus size={16} />}
                  {selectedIsInTeam
                    ? `팀 ${selectedTeamIndex + 1}번에서 빼기`
                    : selectedFamilyConflict
                      ? `${selectedFamilyConflict.name}과 같은 진화 계열`
                      : teamPokemon.length >= PARTY_SIZE
                        ? '팀이 가득 찼습니다'
                        : '팀에 추가'}
                </button>
              </>
            ) : selectedProfile ? (
              <div className="pokedex-unseen-detail">
                <span>?</span>
                <div><small>NO. {String(selectedProfile.id).padStart(4, '0')}</small><strong>아직 발견하지 못한 포켓몬</strong></div>
                <p>뽑기에서 이 포켓몬 또는 같은 진화 계통을 만나면 도감이 해금됩니다.</p>
                <button type="button" onClick={onOpenHatch}><Sparkles size={16} /> 10회 뽑기</button>
              </div>
            ) : (
              <span className="pc-no-selection">도감 항목을 선택하세요.</span>
            )}
          </div>
        </section>
      </section>

      {itemPickerOpen && selectedPokemon && (
        <div
          className="item-equip-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setItemPickerOpen(false)
          }}
        >
          <section
            className="item-equip-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="item-equip-title"
          >
            <header className="item-equip-header">
              <span className="item-equip-header-icon"><Backpack size={24} /></span>
              <div>
                <small>HELD ITEM STORAGE</small>
                <h2 id="item-equip-title">{selectedPokemon.name}의 지닌 도구</h2>
                <p>보유한 배틀 아이템은 포켓몬 한 마리에게만 장착할 수 있습니다.</p>
              </div>
              <button type="button" aria-label="지닌 도구 선택창 닫기" onClick={() => setItemPickerOpen(false)}>
                <X size={20} />
              </button>
            </header>

            <div className="item-equip-current">
              <span>현재 장착</span>
              <BattleItemArtwork item={selectedHeldItem} />
              <div>
                <strong>{selectedHeldItem?.name ?? '지닌 도구 없음'}</strong>
                <small>{selectedHeldItem?.effect ?? '아이템을 선택하면 배틀에 적용됩니다.'}</small>
              </div>
              <button type="button" disabled={!selectedHeldItem} onClick={() => chooseHeldItem(null)}>
                <CircleOff size={16} /> 장착 해제
              </button>
            </div>

            <div className="item-equip-toolbar">
              <label className="item-equip-search">
                <Search size={16} />
                <input
                  type="search"
                  value={itemSearch}
                  placeholder="보유 아이템 검색"
                  aria-label="보유 아이템 검색"
                  onChange={(event) => setItemSearch(event.target.value)}
                />
                {itemSearch && (
                  <button type="button" aria-label="아이템 검색어 지우기" onClick={() => setItemSearch('')}>
                    <X size={13} />
                  </button>
                )}
              </label>

              <div className="item-equip-categories" aria-label="아이템 분류">
                {SHOP_CATEGORIES.map((category) => (
                  <button
                    className={itemCategory === category.id ? 'active' : ''}
                    type="button"
                    key={category.id}
                    onClick={() => setItemCategory(category.id)}
                  >
                    <small>{category.eyebrow}</small>
                    <strong>{category.label}</strong>
                    <em>{itemCategoryCounts[category.id]}</em>
                  </button>
                ))}
              </div>
            </div>

            <div className="item-equip-grid" role="listbox" aria-label="보유 배틀 아이템">
              {filteredOwnedItems.map((item) => {
                const available = availableItemQuantity(item.id)
                const isSelected = selectedHeldItem?.id === item.id
                const isUnavailable = !isSelected && available <= 0
                const categoryMeta = ITEM_CATEGORY_BY_ID.get(item.category)

                return (
                  <button
                    className={`item-equip-card category-${item.category}${isSelected ? ' selected' : ''}${isUnavailable ? ' unavailable' : ''}`}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    disabled={isUnavailable}
                    key={item.id}
                    onClick={() => chooseHeldItem(item.id)}
                  >
                    <BattleItemArtwork item={item} />
                    <span className="item-equip-card-copy">
                      <small>{categoryMeta?.eyebrow}</small>
                      <strong>{item.name}</strong>
                      <em>{item.effect}</em>
                    </span>
                    <span className="item-equip-possession">
                      <small>소유 상태</small>
                      <strong>보유</strong>
                      <em>{isSelected ? '현재 장착' : isUnavailable ? '다른 포켓몬 사용 중' : '장착 가능'}</em>
                    </span>
                    <span className="item-equip-state">
                      {isSelected ? <><Check size={14} /> 장착 중</> : isUnavailable ? '사용 중' : '선택'}
                    </span>
                  </button>
                )
              })}

              {ownedItems.length === 0 ? (
                <div className="item-equip-empty">
                  <span><ShoppingBag size={28} /></span>
                  <strong>보유한 배틀 아이템이 없습니다.</strong>
                  <p>상점에서 지닌 도구를 구매한 뒤 장착할 수 있습니다.</p>
                  <button type="button" onClick={onOpenShop}><ShoppingBag size={16} /> 상점 열기</button>
                </div>
              ) : filteredOwnedItems.length === 0 ? (
                <div className="item-equip-empty">
                  <span><Search size={28} /></span>
                  <strong>조건에 맞는 아이템이 없습니다.</strong>
                  <p>검색어나 아이템 분류를 변경해보세요.</p>
                </div>
              ) : null}
            </div>

            <footer className="item-equip-footer">
              <span>팀에서 빼더라도 장착한 아이템은 그대로 유지됩니다.</span>
              <button type="button" onClick={onOpenShop}><ShoppingBag size={15} /> 상점 열기</button>
            </footer>
          </section>
        </div>
      )}

      {teraPickerOpen && selectedPokemon && selectedProfile && (
        <div
          className="tera-picker-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setTeraPickerOpen(false)
          }}
        >
          <section
            className="tera-picker-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="tera-picker-title"
          >
            <header className="tera-picker-header">
              <span className="tera-picker-header-icon"><Gem size={24} /></span>
              <div>
                <small>TERASTAL CONFIGURATION</small>
                <h2 id="tera-picker-title">{selectedPokemon.name}의 테라타입</h2>
                <p>배틀에서 테라스탈할 때 변화할 타입을 설정합니다.</p>
              </div>
              <button type="button" aria-label="테라타입 선택창 닫기" onClick={() => setTeraPickerOpen(false)}>
                <X size={20} />
              </button>
            </header>

            <div className="tera-picker-current">
              <span className="pokemon-icon-frame tera-picker-pokemon" aria-hidden="true">
                <img
                  className="pokemon-box-icon"
                  src={selectedProfile.icon}
                  alt=""
                  draggable="false"
                  onError={fallbackImageHandler(selectedProfile.iconFallback)}
                />
              </span>
              <div>
                <small>CURRENT TERA TYPE</small>
                <strong>{selectedPokemon.name}</strong>
                <span>원래 타입 · {selectedProfile.types.join(' / ')}</span>
              </div>
              <span className={`tera-current-type type-${typeClassName(selectedTeraType)}`}>
                <Gem size={20} />
                <span><small>TERA</small><strong>{selectedTeraType}</strong></span>
              </span>
            </div>

            <div className="tera-type-grid" role="listbox" aria-label="테라타입 목록">
              {TERA_TYPES.map((teraType) => {
                const isSelected = teraType === selectedTeraType
                const isNaturalType = selectedProfile.types.includes(teraType)

                return (
                  <button
                    className={`tera-type-option${isSelected ? ' selected' : ''}`}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    key={teraType}
                    onClick={() => chooseTeraType(teraType)}
                  >
                    <span className={`tera-type-gem type-${typeClassName(teraType)}`}><Gem size={17} /></span>
                    <span>
                      <small>TERA TYPE</small>
                      <strong>{teraType}</strong>
                    </span>
                    <em>{teraType === '스텔라' ? '특수 타입' : isNaturalType ? '원래 타입' : '변경 타입'}</em>
                    {isSelected && <Check className="tera-type-check" size={15} />}
                  </button>
                )
              })}
            </div>

            <footer className="tera-picker-footer">
              <span><Sparkles size={14} /> 선택한 타입은 포켓몬 데이터와 함께 자동 저장됩니다.</span>
              <strong>{TERA_TYPES.length} TYPES</strong>
            </footer>
          </section>
        </div>
      )}

      {dynamaxPickerOpen && selectedPokemon && selectedProfile && (
        <div
          className="dynamax-picker-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setDynamaxPickerOpen(false)
          }}
        >
          <section
            className="dynamax-picker-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dynamax-picker-title"
          >
            <header className="dynamax-picker-header">
              <span className="dynamax-picker-header-icon"><Maximize2 size={24} /></span>
              <div>
                <small>DYNAMAX CONFIGURATION</small>
                <h2 id="dynamax-picker-title">{selectedPokemon.name}의 거대화 설정</h2>
                <p>배틀에서 사용할 다이맥스 방식을 포켓몬별로 지정합니다.</p>
              </div>
              <button type="button" aria-label="다이맥스 설정 창 닫기" onClick={() => setDynamaxPickerOpen(false)}>
                <X size={20} />
              </button>
            </header>

            <div className="dynamax-picker-current">
              <span className="pokemon-icon-frame dynamax-picker-pokemon" aria-hidden="true">
                <img
                  className="pokemon-box-icon"
                  src={selectedProfile.icon}
                  alt=""
                  draggable="false"
                  onError={fallbackImageHandler(selectedProfile.iconFallback)}
                />
              </span>
              <div>
                <small>CURRENT MAX MODE</small>
                <strong>{selectedPokemon.name}</strong>
                <span>{selectedCanGigantamax ? '거다이맥스 가능 종' : '일반 다이맥스 전용'}</span>
              </div>
              <span className={`dynamax-current-mode ${selectedDynamaxMode}`}>
                {selectedDynamaxMode === 'gigantamax' ? <Crown size={20} /> : <Maximize2 size={20} />}
                <span>
                  <small>{selectedDynamaxMode === 'gigantamax' ? 'G-MAX' : 'D-MAX'}</small>
                  <strong>{selectedDynamaxMode === 'gigantamax' ? '거다이맥스' : '다이맥스'}</strong>
                </span>
              </span>
            </div>

            <div className="dynamax-mode-grid" role="radiogroup" aria-label="다이맥스 방식">
              {DYNAMAX_MODES.map((mode) => {
                const isSelected = mode.id === selectedDynamaxMode
                const isGigantamax = mode.id === 'gigantamax'
                const isLocked = isGigantamax && !selectedCanGigantamax
                const previewProfile = isGigantamax && selectedGigantamaxProfile
                  ? selectedGigantamaxProfile
                  : selectedProfile

                return (
                  <button
                    className={`dynamax-mode-option ${mode.id}${isSelected ? ' selected' : ''}${isLocked ? ' locked' : ''}`}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    disabled={isLocked}
                    key={mode.id}
                    onClick={() => chooseDynamaxMode(mode.id)}
                  >
                    <span className="dynamax-option-art" aria-hidden="true">
                      <img
                        src={previewProfile.icon}
                        alt=""
                        draggable="false"
                        onError={fallbackImageHandler(previewProfile.iconFallback)}
                      />
                      <span>{isGigantamax ? <Crown size={18} /> : <Maximize2 size={18} />}</span>
                    </span>
                    <span className="dynamax-option-copy">
                      <small>{mode.shortLabel}</small>
                      <strong>{mode.label}</strong>
                      <p>{mode.description}</p>
                      <em className={isLocked ? 'locked' : 'available'}>
                        {isLocked ? <LockKeyhole size={12} /> : <ShieldCheck size={12} />}
                        {isLocked ? '이 포켓몬은 설정할 수 없음' : isGigantamax ? '거다이맥스 가능' : '기본 거대화 방식'}
                      </em>
                    </span>
                    {isSelected && <Check className="dynamax-mode-check" size={17} />}
                  </button>
                )
              })}
            </div>

            <footer className="dynamax-picker-footer">
              <span><Sparkles size={14} /> 거다이맥스는 고유 거다이맥스 폼이 존재하는 포켓몬만 설정할 수 있습니다.</span>
              <strong>{selectedCanGigantamax ? 'G-MAX READY' : 'D-MAX ONLY'}</strong>
            </footer>
          </section>
        </div>
      )}
    </main>
  )
}

export default BoxScreen
