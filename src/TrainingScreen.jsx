import SpriteImage from './SpriteImage'
import { useEffect, useMemo, useState } from 'react'
import {
  ArrowDownAZ,
  ArrowLeft,
  Check,
  ChevronDown,
  Dna,
  Eye,
  Gauge,
  Info,
  LockKeyhole,
  Minus,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  X,
  Zap,
} from 'lucide-react'
import PokemonSprite from './PokemonSprite'
import { getPokemonEvolutionFamilyKey, getTrainingRosterPokemon } from './data/pokemonPool'
import {
  BATTLE_LEVEL,
  canPokemonLearnMove,
  calculateStats,
  getAbility,
  getBattleFormOptions,
  getEvolutionOptions,
  getFormMetadata,
  getLearnableMoves,
  getMove,
  getPokemonGenderOptions,
  getPersistentFormOptions,
  getSpeciesProfile,
  HIDDEN_POWER_TYPES,
  NATURE_OPTIONS,
  normalizePokemon,
  resolveMoveForPokemon,
  resolveMoveTriggeredFormSpeciesId,
  resolvePokemonGenderProfile,
  STAT_META,
  STAT_POINT_PER_STAT,
  STAT_POINT_TOTAL,
  typeClassName,
} from './data/trainingData'
import { getTrainingCostBreakdown, TRAINING_COSTS } from './data/trainingCosts'
import { getZaMegaStoneByFormSlug } from './data/zaMegaData'
import { getUnlockedPokemonSkins } from './data/rareRewards.js'

const MOVE_CATEGORY_FILTERS = ['전체', '물리', '특수', '변화']
const STAT_LABEL_BY_KEY = Object.fromEntries(STAT_META.map(({ key, label }) => [key, label]))

function fallbackImageHandler(fallback) {
  return (event) => {
    if (!fallback || event.currentTarget.dataset.fallbackApplied) return
    event.currentTarget.dataset.fallbackApplied = 'true'
    event.currentTarget.src = fallback
  }
}

function getNatureEffect(nature) {
  if (!nature?.up || !nature?.down) {
    return {
      summary: '능력 보정 없음',
      description: '올라가거나 내려가는 능력치 없이 모든 능력치가 그대로 적용됩니다.',
    }
  }

  return {
    summary: `${STAT_LABEL_BY_KEY[nature.up]} ↑ · ${STAT_LABEL_BY_KEY[nature.down]} ↓`,
    description: `${STAT_LABEL_BY_KEY[nature.up]} 10% 상승 · ${STAT_LABEL_BY_KEY[nature.down]} 10% 하락`,
  }
}

function trainingSignature(pokemon) {
  if (!pokemon) return ''

  return JSON.stringify({
    speciesId: pokemon.speciesId,
    gender: pokemon.gender,
    isShiny: Boolean(pokemon.isShiny),
    skinId: pokemon.skinId ?? null,
    nature: pokemon.nature,
    ability: pokemon.ability,
    moves: pokemon.moves,
    hiddenPowerType: pokemon.hiddenPowerType,
    hiddenPowerTypeConfigured: pokemon.hiddenPowerTypeConfigured,
    trainingPoints: STAT_META.map(({ key }) => Number(pokemon.trainingPoints?.[key] ?? 0)),
  })
}

function BattleTooltip({
  id,
  eyebrow,
  title,
  description,
  meta,
  visible,
  label = '기술 정보',
  side = 'left',
  accentClass = '',
  className = '',
  style,
}) {
  return (
    <span
      className={`battle-tooltip tooltip-${side} ${accentClass} ${className}${visible ? ' is-visible' : ''}`}
      id={id}
      role="tooltip"
      aria-hidden={!visible}
      style={style}
    >
      <span className="battle-tooltip-eyebrow">{eyebrow}</span>
      <strong>{title}</strong>
      <span className="battle-tooltip-description">{description}</span>
      <span className="battle-tooltip-meta">
        {meta.map((entry) => (
          <span key={entry.label}>
            <small>{entry.label}</small>
            <b>{entry.value}</b>
          </span>
        ))}
      </span>
      <em>{label}</em>
    </span>
  )
}

function TrainingScreen({ balance = 0, pokemon, teams = [], activeTeamId, progress, onBack, onSave, onOpenHatch }) {
  const trainingPokemon = useMemo(
    () => getTrainingRosterPokemon(pokemon).map((entry) => normalizePokemon(entry)),
    [pokemon],
  )
  const [selectedId, setSelectedId] = useState(trainingPokemon[0]?.captureId ?? null)
  const [pokemonSearch, setPokemonSearch] = useState('')
  const [pokemonSort, setPokemonSort] = useState('obtained')
  const [draftPokemonById, setDraftPokemonById] = useState({})
  const [spriteSide, setSpriteSide] = useState('front')
  const [movePickerSlot, setMovePickerSlot] = useState(null)
  const [moveSearch, setMoveSearch] = useState('')
  const [moveCategory, setMoveCategory] = useState('전체')
  const [profilePicker, setProfilePicker] = useState(null)
  const [activeTooltipId, setActiveTooltipId] = useState(null)
  const [movePickerTooltip, setMovePickerTooltip] = useState(null)
  const [abilityPickerTooltip, setAbilityPickerTooltip] = useState(null)
  const [previewSpeciesId, setPreviewSpeciesId] = useState(null)
  const teamMembershipByFamily = useMemo(() => {
    const pokemonByCaptureId = new Map(pokemon.map((entry) => [entry.captureId, entry]))
    const membershipMap = new Map()

    teams.forEach((team) => {
      (team.pokemonIds ?? []).forEach((captureId) => {
        const teamPokemon = pokemonByCaptureId.get(captureId)
        if (!teamPokemon) return
        const familyKey = getPokemonEvolutionFamilyKey(teamPokemon)
        const memberships = membershipMap.get(familyKey) ?? []
        memberships.push({ id: team.id, name: team.name })
        membershipMap.set(familyKey, memberships)
      })
    })

    return membershipMap
  }, [pokemon, teams])
  const filteredTrainingPokemon = useMemo(() => {
    const query = pokemonSearch.trim().toLocaleLowerCase('ko-KR')
    const matchingPokemon = query ? trainingPokemon.filter((entry) => (
      entry.name.toLocaleLowerCase('ko-KR').includes(query)
    )) : trainingPokemon

    if (pokemonSort === 'obtained') return matchingPokemon
    return [...matchingPokemon].sort((left, right) => {
      const leftNumber = Number(left.dexSpeciesId ?? left.speciesId ?? Number.MAX_SAFE_INTEGER)
      const rightNumber = Number(right.dexSpeciesId ?? right.speciesId ?? Number.MAX_SAFE_INTEGER)
      return leftNumber - rightNumber || left.name.localeCompare(right.name, 'ko-KR')
    })
  }, [pokemonSearch, pokemonSort, trainingPokemon])

  useEffect(() => {
    if (!trainingPokemon.some((entry) => entry.captureId === selectedId)) {
      setSelectedId(trainingPokemon[0]?.captureId ?? null)
    }
  }, [trainingPokemon, selectedId])

  useEffect(() => {
    if (movePickerSlot === null && profilePicker === null) return undefined

    const closeOnEscape = (event) => {
      if (event.key !== 'Escape') return
      setMovePickerSlot(null)
      setProfilePicker(null)
      setActiveTooltipId(null)
      setMovePickerTooltip(null)
      setAbilityPickerTooltip(null)
    }

    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [movePickerSlot, profilePicker])

  const savedPokemon = trainingPokemon.find((entry) => entry.captureId === selectedId) ?? null
  const editablePokemon = savedPokemon
    ? draftPokemonById[selectedId] ?? savedPokemon
    : null
  const editableSpecies = editablePokemon ? getSpeciesProfile(editablePokemon.speciesId) : null
  const previewSpecies = previewSpeciesId ? getSpeciesProfile(previewSpeciesId) : null
  const selectedPokemon = previewSpecies && editablePokemon
    ? normalizePokemon({ ...editablePokemon, speciesId: previewSpecies.id })
    : editablePokemon
  const species = previewSpecies ?? editableSpecies
  const isPreviewForm = Boolean(previewSpecies)
  const unlockedSkins = getUnlockedPokemonSkins(progress, editablePokemon)
  const zaMegaStone = species ? getZaMegaStoneByFormSlug(species.slug) : null
  const evolutionOptions = editablePokemon ? getEvolutionOptions(editablePokemon.speciesId) : []
  const persistentFormOptions = editablePokemon ? getPersistentFormOptions(editablePokemon.speciesId) : []
  const battleFormOptions = editablePokemon ? getBattleFormOptions(editablePokemon.speciesId) : []
  const genderOptions = editableSpecies ? getPokemonGenderOptions(editableSpecies) : []
  const selectedGender = genderOptions.includes(editablePokemon?.gender)
    ? editablePokemon.gender
    : genderOptions[0] ?? null
  const canToggleGender = genderOptions.length > 1
  const stats = useMemo(
    () => (selectedPokemon ? calculateStats(selectedPokemon) : []),
    [selectedPokemon],
  )
  const trainingPointTotal = stats.reduce((total, stat) => total + stat.trainingPoint, 0)
  const trainingPointRemaining = STAT_POINT_TOTAL - trainingPointTotal
  const selectedAbility = selectedPokemon ? getAbility(selectedPokemon.ability) : null
  const selectedNature = selectedPokemon
    ? NATURE_OPTIONS.find((option) => option.label === selectedPokemon.nature) ?? NATURE_OPTIONS[0]
    : null
  const selectedNatureEffect = getNatureEffect(selectedNature)
  const editableFormMetadata = getFormMetadata(editableSpecies)
  const editableEvolutionSpeciesId = Number(editableSpecies?.parentSpeciesId ?? editableSpecies?.id)
  const editableEvolutionSpecies = evolutionOptions.find((option) => option.id === editableEvolutionSpeciesId)
    ?? editableSpecies
  const selectedEvolutionIndex = editablePokemon
    ? evolutionOptions.findIndex((option) => option.id === editableEvolutionSpeciesId)
    : -1
  const hasBranchingEvolution = evolutionOptions.length > 3
  const hasChanges = trainingSignature(editablePokemon) !== trainingSignature(savedPokemon)
  const trainingCost = useMemo(
    () => getTrainingCostBreakdown(savedPokemon, editablePokemon),
    [editablePokemon, savedPokemon],
  )
  const displayedTrainingCostItems = trainingCost.items.filter((item) => !item.free)
  const trainingShortfall = Math.max(0, trainingCost.total - balance)
  const canAffordTraining = trainingShortfall === 0
  const canSave = hasChanges && !isPreviewForm && canAffordTraining
  const activePickerMove = movePickerSlot !== null && selectedPokemon
    ? resolveMoveForPokemon(getMove(selectedPokemon.moves[movePickerSlot]), selectedPokemon)
    : null
  const learnableMoves = useMemo(
    () => (selectedPokemon
      ? getLearnableMoves(selectedPokemon.speciesId).map((move) => resolveMoveForPokemon(move, selectedPokemon))
      : []),
    [selectedPokemon?.hiddenPowerType, selectedPokemon?.speciesId],
  )
  const filteredMoves = useMemo(() => {
    const query = moveSearch.trim().toLocaleLowerCase('ko-KR')
    const activeMoveName = activePickerMove?.name ?? ''

    return learnableMoves.filter((move) => {
      const matchesCategory = moveCategory === '전체' || move.category === moveCategory
      const matchesSearch = !query
        || move.name.toLocaleLowerCase('ko-KR').includes(query)
        || move.type.toLocaleLowerCase('ko-KR').includes(query)

      return matchesCategory && matchesSearch
    }).sort((firstMove, secondMove) => (
      Number(secondMove.name === activeMoveName) - Number(firstMove.name === activeMoveName)
    ))
  }, [activePickerMove?.name, learnableMoves, moveCategory, moveSearch])

  const writeSelected = (updates) => {
    if (!editablePokemon) return

    setDraftPokemonById((currentDrafts) => ({
      ...currentDrafts,
      [editablePokemon.captureId]: normalizePokemon({ ...editablePokemon, ...updates }),
    }))
  }

  const updateSelected = (updates) => {
    if (isPreviewForm) return
    writeSelected(updates)
  }

  const toggleShiny = () => {
    if (!editablePokemon?.shinyObtained) return
    writeSelected({ isShiny: !editablePokemon.isShiny })
  }

  const toggleGender = () => {
    if (!editablePokemon || !editableSpecies || !canToggleGender) return
    const nextGender = selectedGender === 'M' ? 'F' : 'M'
    const nextSpecies = resolvePokemonGenderProfile(editableSpecies, nextGender)

    setPreviewSpeciesId(null)
    writeSelected({
      gender: nextGender,
      speciesId: nextSpecies?.id ?? editableSpecies.id,
    })
  }

  const updateMove = (slotIndex, moveName) => {
    const moves = [...selectedPokemon.moves]
    moves[slotIndex] = moveName
    const speciesId = resolveMoveTriggeredFormSpeciesId(editableSpecies.id, moves)
    updateSelected({ moves, speciesId })
  }

  const openMovePicker = (slotIndex) => {
    if (isPreviewForm) return
    setActiveTooltipId(null)
    setMovePickerTooltip(null)
    setAbilityPickerTooltip(null)
    setProfilePicker(null)
    setMovePickerSlot(slotIndex)
    setMoveSearch('')
    setMoveCategory('전체')
  }

  const chooseMove = (move) => {
    if (
      movePickerSlot === null
      || !selectedPokemon
      || !canPokemonLearnMove(selectedPokemon.speciesId, move.name)
    ) return
    updateMove(movePickerSlot, move.name)
    setMovePickerSlot(null)
    setMovePickerTooltip(null)
    if (move.id === 'hiddenpower') setProfilePicker('hidden-power')
  }

  const openProfilePicker = (picker) => {
    if (isPreviewForm && !['evolution', 'persistent-form', 'battle-form'].includes(picker)) return
    setActiveTooltipId(null)
    setMovePickerTooltip(null)
    setAbilityPickerTooltip(null)
    setMovePickerSlot(null)
    setProfilePicker(picker)
  }

  const chooseNature = (nature) => {
    updateSelected({ nature })
    setProfilePicker(null)
  }

  const chooseEvolution = (speciesId) => {
    setPreviewSpeciesId(null)
    writeSelected({ speciesId })
    setProfilePicker(null)
  }

  const choosePersistentForm = (speciesId) => {
    const targetForm = getSpeciesProfile(speciesId)
    if (!targetForm || !editablePokemon) return
    const metadata = getFormMetadata(targetForm)
    const moves = [...editablePokemon.moves]

    if (metadata.requiredMove && !moves.includes(metadata.requiredMove)) {
      if (moves.length < 4) moves.push(metadata.requiredMove)
      else moves[moves.length - 1] = metadata.requiredMove
    }

    setPreviewSpeciesId(null)
    writeSelected({ speciesId, moves })
    setProfilePicker(null)
  }

  const chooseBattleForm = (speciesId) => {
    setPreviewSpeciesId(speciesId || null)
    setProfilePicker(null)
  }

  const chooseAbility = (ability) => {
    updateSelected({ ability })
    setAbilityPickerTooltip(null)
    setProfilePicker(null)
  }

  const chooseHiddenPowerType = (hiddenPowerType) => {
    updateSelected({ hiddenPowerType, hiddenPowerTypeConfigured: true })
    setProfilePicker(null)
  }

  const tooltipAnchorProps = (tooltipId, callbacks = {}) => ({
    onMouseEnter: (event) => {
      setActiveTooltipId(tooltipId)
      callbacks.onShow?.(event)
    },
    onMouseLeave: (event) => {
      setActiveTooltipId((currentId) => (
        currentId === tooltipId ? null : currentId
      ))
      callbacks.onHide?.(event)
    },
    onPointerCancel: (event) => {
      setActiveTooltipId((currentId) => (
        currentId === tooltipId ? null : currentId
      ))
      callbacks.onHide?.(event)
    },
    onFocus: (event) => {
      setActiveTooltipId(tooltipId)
      callbacks.onShow?.(event)
    },
    onBlur: (event) => {
      if (event.currentTarget.contains(event.relatedTarget)) return
      setActiveTooltipId((currentId) => (currentId === tooltipId ? null : currentId))
      callbacks.onHide?.(event)
    },
    onKeyDown: (event) => {
      if (event.key !== 'Escape') return
      setActiveTooltipId(null)
      callbacks.onHide?.(event)
      event.currentTarget.blur()
    },
  })

  const getPickerTooltipPosition = (event) => {
    const panel = event.currentTarget.closest('.move-picker-panel, .profile-picker-panel')
    if (!panel) return null

    const anchorRect = event.currentTarget.getBoundingClientRect()
    const panelRect = panel.getBoundingClientRect()
    const tooltipWidth = Math.min(292, panelRect.width - 20)
    const gap = 10
    const availableLeft = anchorRect.left - panelRect.left
    const availableRight = panelRect.right - anchorRect.right
    const openRight = availableRight >= tooltipWidth + gap || availableRight >= availableLeft
    const requestedLeft = openRight
      ? anchorRect.right - panelRect.left + gap
      : anchorRect.left - panelRect.left - tooltipWidth - gap
    const left = Math.max(10, Math.min(requestedLeft, panelRect.width - tooltipWidth - 10))
    const anchorCenter = anchorRect.top - panelRect.top + (anchorRect.height / 2)
    const top = Math.max(82, Math.min(anchorCenter, panelRect.height - 82))

    return { left, top }
  }

  const showMovePickerTooltip = (event, option, tooltipId) => {
    const position = getPickerTooltipPosition(event)
    if (!position) return
    setMovePickerTooltip({ option, tooltipId, ...position })
  }

  const hideMovePickerTooltip = (tooltipId) => {
    setMovePickerTooltip((currentTooltip) => (
      currentTooltip?.tooltipId === tooltipId ? null : currentTooltip
    ))
  }

  const showAbilityPickerTooltip = (event, ability, abilityInfo, tooltipId) => {
    const position = getPickerTooltipPosition(event)
    if (!position) return
    setAbilityPickerTooltip({ ability, abilityInfo, tooltipId, ...position })
  }

  const hideAbilityPickerTooltip = (tooltipId) => {
    setAbilityPickerTooltip((currentTooltip) => (
      currentTooltip?.tooltipId === tooltipId ? null : currentTooltip
    ))
  }

  const setTrainingPoint = (statKey, requestedValue) => {
    if (!selectedPokemon || isPreviewForm) return

    const currentValue = Number(selectedPokemon.trainingPoints[statKey] ?? 0)
    const pointsWithoutCurrentStat = trainingPointTotal - currentValue
    const nextValue = Math.max(0, Math.min(
      STAT_POINT_PER_STAT,
      STAT_POINT_TOTAL - pointsWithoutCurrentStat,
      Number(requestedValue),
    ))

    updateSelected({
      trainingPoints: {
        ...selectedPokemon.trainingPoints,
        [statKey]: nextValue,
      },
    })
  }

  const adjustTrainingPoint = (statKey, amount) => {
    const currentValue = Number(selectedPokemon?.trainingPoints[statKey] ?? 0)
    setTrainingPoint(statKey, currentValue + amount)
  }

  const resetTraining = () => {
    if (!savedPokemon) return

    setPreviewSpeciesId(null)

    setDraftPokemonById((currentDrafts) => {
      const nextDrafts = { ...currentDrafts }
      delete nextDrafts[savedPokemon.captureId]
      return nextDrafts
    })
  }

  const saveTraining = () => {
    if (!editablePokemon || !canSave) return
    const didSave = onSave(editablePokemon)
    if (didSave === false) return

    setDraftPokemonById((currentDrafts) => {
      const nextDrafts = { ...currentDrafts }
      delete nextDrafts[editablePokemon.captureId]
      return nextDrafts
    })
  }

  const selectPokemon = (captureId) => {
    setSelectedId(captureId)
    setPreviewSpeciesId(null)
    setSpriteSide('front')
    setMovePickerSlot(null)
    setProfilePicker(null)
    setActiveTooltipId(null)
    setMovePickerTooltip(null)
    setAbilityPickerTooltip(null)
  }

  const isEvolutionPicker = profilePicker === 'evolution'
  const isPersistentFormPicker = profilePicker === 'persistent-form'
  const isBattleFormPicker = profilePicker === 'battle-form'
  const isHiddenPowerPicker = profilePicker === 'hidden-power'
  const isFormPicker = isEvolutionPicker || isPersistentFormPicker || isBattleFormPicker
  const formPickerOptions = isBattleFormPicker
    ? [...new Map([editableSpecies, ...battleFormOptions].filter(Boolean).map((option) => [option.id, option])).values()]
    : isPersistentFormPicker
      ? persistentFormOptions
      : evolutionOptions

  return (
    <main className="training-screen">
      <header className="training-header">
        <button className="screen-back-button" type="button" aria-label="로비로 돌아가기" onClick={onBack}>
          <ArrowLeft size={19} />
          <span>로비</span>
        </button>

        <div className="training-title">
          <span>POKÉMON TRAINING LAB</span>
          <h1>트레이닝</h1>
          <p>진화 계열마다 처음 만난 파트너를 선택해 배틀 설정을 조정하세요.</p>
        </div>

        <div className="training-level-badge">
          <Gauge size={18} />
          <span>배틀 기준</span>
          <strong>{BATTLE_LEVEL}</strong>
        </div>
      </header>

      <section className="training-workspace">
        <section className="training-roster-panel" aria-label="트레이닝 포켓몬 선택">
          <div className="training-roster-heading">
            <div>
              <span>BOX POKÉMON</span>
              <h2>포켓몬 선택</h2>
            </div>
            <strong aria-live="polite">
              {filteredTrainingPokemon.length}
              <em>{pokemonSearch.trim() ? ` / ${trainingPokemon.length}계열` : '계열'}</em>
            </strong>
          </div>

          <div className="training-filter-row">
            <div className="training-sort-control" role="group" aria-label="포켓몬 정렬 기준">
              <ArrowDownAZ size={14} aria-hidden="true" />
              <button
                className={pokemonSort === 'obtained' ? 'active' : ''}
                type="button"
                aria-pressed={pokemonSort === 'obtained'}
                onClick={() => setPokemonSort('obtained')}
              >
                입수순
              </button>
              <button
                className={pokemonSort === 'number' ? 'active' : ''}
                type="button"
                aria-pressed={pokemonSort === 'number'}
                onClick={() => setPokemonSort('number')}
              >
                번호순
              </button>
            </div>
            <label className="training-roster-search">
              <Search size={14} aria-hidden="true" />
              <input
                type="search"
                value={pokemonSearch}
                aria-label="포켓몬 이름 검색"
                placeholder="포켓몬 이름 검색"
                onChange={(event) => setPokemonSearch(event.target.value)}
              />
              {pokemonSearch && (
                <button type="button" aria-label="포켓몬 검색어 지우기" onClick={() => setPokemonSearch('')}>
                  <X size={12} />
                </button>
              )}
            </label>
          </div>

          <div className="training-roster-grid">
            {filteredTrainingPokemon.map((entry) => {
              const teamMemberships = teamMembershipByFamily.get(getPokemonEvolutionFamilyKey(entry)) ?? []
              const isInTeam = teamMemberships.length > 0
              const isInActiveTeam = teamMemberships.some((membership) => membership.id === activeTeamId)
              const teamLabel = isInTeam
                ? `${teamMemberships.map((membership) => membership.name).join(', ')} 편성 중`
                : ''

              return (
                <button
                  className={`training-roster-card${entry.isShiny ? ' is-shiny' : ''}${entry.captureId === selectedId ? ' selected' : ''}${isInTeam ? ' in-team' : ''}${isInActiveTeam ? ' in-active-team' : ''}`}
                  key={entry.captureId}
                  type="button"
                  aria-label={`${entry.isShiny ? '이로치 ' : ''}${entry.name}, 레벨 ${BATTLE_LEVEL} 트레이닝${teamLabel ? `, ${teamLabel}` : ''}`}
                  aria-pressed={entry.captureId === selectedId}
                  onClick={() => selectPokemon(entry.captureId)}
                >
                  <span className="training-card-level">Lv.{BATTLE_LEVEL}</span>
                  {isInTeam && (
                    <span
                      className={`training-team-badge${isInActiveTeam ? ' active' : ''}`}
                      title={teamLabel}
                      aria-hidden="true"
                    >
                      <ShieldCheck size={11} />
                    </span>
                  )}
                  {entry.isShiny && <span className="pokemon-shiny-mark" aria-hidden="true">★</span>}
                  <span className="pokemon-icon-frame training-roster-sprite-frame" aria-hidden="true">
                    <SpriteImage
                      className="pokemon-box-icon"
                      src={entry.icon}
                      alt=""
                      draggable="false"
                      fallbackSrc={entry.iconFallback}
                    />
                  </span>
                  <strong>{entry.name}</strong>
                  <span className="training-card-types">{entry.types.join(' · ')}</span>
                </button>
              )
            })}
            {trainingPokemon.length > 0 && filteredTrainingPokemon.length === 0 && (
              <div className="training-roster-no-results" role="status">
                <Search size={26} />
                <strong>검색 결과가 없습니다.</strong>
                <span>다른 포켓몬 이름을 입력해 보세요.</span>
                <button type="button" onClick={() => setPokemonSearch('')}>검색 초기화</button>
              </div>
            )}
          </div>

          {trainingPokemon.length === 0 && (
            <div className="training-empty-roster">
              <span><Sparkles size={26} /></span>
              <strong>트레이닝할 포켓몬이 없습니다.</strong>
              <p>먼저 포켓몬 뽑기에서 새로운 파트너를 획득하세요.</p>
              <button type="button" onClick={onOpenHatch}><Sparkles size={16} /> 포켓몬 뽑기</button>
            </div>
          )}
        </section>

        <section className={`training-editor-panel${selectedPokemon ? ' active' : ''}`} aria-label="포켓몬 설정 편집">
          {selectedPokemon && species ? (
            <>
              <div className="training-editor-heading">
                <div className="training-editor-name">
                  <span className="training-ball-dot" />
                  <div>
                    <small>NO. {String(species.id).padStart(4, '0')}</small>
                    <h2>{species.name}</h2>
                  </div>
                  {selectedGender && (
                    <button
                      className={`training-gender-toggle ${selectedGender === 'F' ? 'female' : 'male'}${canToggleGender ? '' : ' fixed'}`}
                      type="button"
                      aria-label={canToggleGender
                        ? `${selectedGender === 'M' ? '암컷' : '수컷'}으로 변경`
                        : `${selectedGender === 'M' ? '수컷' : '암컷'} 고정`}
                      title={canToggleGender
                        ? `${selectedGender === 'M' ? '암컷' : '수컷'}으로 변경`
                        : `${selectedGender === 'M' ? '수컷' : '암컷'} 고정`}
                      disabled={!canToggleGender}
                      onClick={toggleGender}
                    >
                      <strong aria-hidden="true">{selectedGender === 'M' ? '♂' : '♀'}</strong>
                      <span>{selectedGender === 'M' ? '수컷' : '암컷'}</span>
                    </button>
                  )}
                  {selectedPokemon.isShiny && <span className="inline-shiny-label">★ 이로치</span>}
                  {isPreviewForm && (
                    <span className={`training-preview-badge${zaMegaStone ? ' za-mega' : ''}`}>
                      {zaMegaStone ? <Sparkles size={12} /> : <Eye size={12} />}
                      {zaMegaStone ? 'ZA 메가 미리보기' : '임시 미리보기'}
                    </span>
                  )}
                </div>
                <div className="type-chip-list">
                  {species.types.map((type) => (
                    <span className={`game-type-chip type-${typeClassName(type)}`} key={type}>{type}</span>
                  ))}
                </div>
                <strong className="training-fixed-level">Lv.{BATTLE_LEVEL}</strong>
              </div>

              <div className="training-editor-body">
                <div className="training-profile-column">
                  <div className={`training-art-card${selectedPokemon.isShiny ? ' is-shiny' : ''}`}>
                    <span className="training-art-ring" aria-hidden="true" />
                    {selectedPokemon.shinyObtained && (
                      <button
                        className={`training-art-shiny-toggle${selectedPokemon.isShiny ? ' active' : ''}`}
                        type="button"
                        aria-label={`이로치 색상 ${selectedPokemon.isShiny ? '끄기' : '켜기'}`}
                        aria-pressed={selectedPokemon.isShiny}
                        title={`이로치 색상 ${selectedPokemon.isShiny ? '끄기' : '켜기'}`}
                        onClick={toggleShiny}
                      >
                        <Sparkles size={10} aria-hidden="true" />
                        <span>SHINY</span>
                        <em>{selectedPokemon.isShiny ? 'ON' : 'OFF'}</em>
                      </button>
                    )}
                    <div className="training-sprite-facing" role="group" aria-label="전투 스프라이트 방향">
                      <button
                        className={spriteSide === 'front' ? 'active' : ''}
                        type="button"
                        aria-pressed={spriteSide === 'front'}
                        onClick={() => setSpriteSide('front')}
                      >
                        적군 · 앞
                      </button>
                      <button
                        className={spriteSide === 'back' ? 'active' : ''}
                        type="button"
                        aria-pressed={spriteSide === 'back'}
                        onClick={() => setSpriteSide('back')}
                      >
                        아군 · 뒤
                      </button>
                    </div>
                    <PokemonSprite
                      className="pokemon-battle-sprite"
                      frameClassName="training-main-sprite-frame"
                      animatedSrc={spriteSide === 'back' ? selectedPokemon.spriteBack : selectedPokemon.spriteFront}
                      fallbackSrc={
                        spriteSide === 'back'
                          ? selectedPokemon.spriteBackFallback
                          : selectedPokemon.spriteFrontFallback
                      }
                      alt={`${selectedPokemon.name} ${spriteSide === 'back' ? '뒷모습' : '앞모습'}`}
                      draggable="false"
                    />
                    <strong>{selectedPokemon.name}</strong>
                  </div>

                  <div className="training-select-stack">
                    {unlockedSkins.length > 0 && (
                      <label className="training-picker-field training-reward-skin-picker">
                        <span><Sparkles size={14} /> 특별 스킨 <em className="training-field-cost">변경 무료</em></span>
                        <select aria-label="획득한 특별 스킨 선택" value={editablePokemon.skinId ?? ''} disabled={isPreviewForm} onChange={(event) => updateSelected({ skinId: event.target.value || null })}>
                          <option value="">기본 모습</option>
                          {unlockedSkins.map((skin) => <option key={skin.id} value={skin.id}>{skin.name}</option>)}
                        </select>
                        <small>업적으로 획득한 모습입니다. 변경 후 저장하면 배틀에도 적용됩니다.</small>
                      </label>
                    )}
                    <div className="training-picker-field">
                      <span>
                        <Dna size={14} /> 진화 형태
                        <em className="training-field-cost">변경 {TRAINING_COSTS.evolution} VP</em>
                      </span>
                      <button
                        className="training-profile-picker-button"
                        type="button"
                        disabled={editableFormMetadata.evolutionLocked}
                        aria-label={`진화 형태 변경, 현재 ${editableEvolutionSpecies.name}`}
                        aria-haspopup="dialog"
                        aria-expanded={profilePicker === 'evolution'}
                        onClick={() => openProfilePicker('evolution')}
                      >
                        <span>
                          <strong>{editableEvolutionSpecies.name}</strong>
                          <small>
                            {editableFormMetadata.evolutionLocked
                              ? '이 모습은 진화할 수 없음'
                              : `NO. ${String(editableEvolutionSpecies.id).padStart(4, '0')} · ${editableEvolutionSpecies.types.join(' / ')}`}
                          </small>
                        </span>
                        <ChevronDown size={14} />
                      </button>
                    </div>
                    {persistentFormOptions.length > 1 && (
                      <div className="training-picker-field persistent-form-picker-field">
                        <span>
                          <Dna size={14} /> 폼 설정
                          <em className="training-field-cost">변경 {TRAINING_COSTS.form} VP</em>
                        </span>
                        <button
                          className="training-profile-picker-button"
                          type="button"
                          aria-label={`폼 변경, 현재 ${editableSpecies.name}`}
                          aria-haspopup="dialog"
                          aria-expanded={profilePicker === 'persistent-form'}
                          onClick={() => openProfilePicker('persistent-form')}
                        >
                          <span>
                            <strong>{editableSpecies.name}</strong>
                            <small>
                              {editableFormMetadata.label}
                              {editableFormMetadata.requirement
                                ? ` · ${editableFormMetadata.requirement}`
                                : ''}
                            </small>
                          </span>
                          <ChevronDown size={14} />
                        </button>
                      </div>
                    )}
                    {battleFormOptions.length > 0 && (
                      <div className={`training-picker-field battle-form-picker-field${isPreviewForm ? ' is-previewing' : ''}`}>
                        <span><Sparkles size={14} /> 배틀 기믹 폼 확인</span>
                        <button
                          className="training-profile-picker-button"
                          type="button"
                          aria-label={`배틀 기믹 폼 미리보기, 현재 ${isPreviewForm ? species.name : '선택 안 함'}`}
                          aria-haspopup="dialog"
                          aria-expanded={profilePicker === 'battle-form'}
                          onClick={() => openProfilePicker('battle-form')}
                        >
                          <span>
                            <strong>{isPreviewForm ? species.name : '미리보기 선택'}</strong>
                            <small>배틀 중 변화 · 저장되지 않음</small>
                          </span>
                          <ChevronDown size={14} />
                        </button>
                      {zaMegaStone && (
                        <span className="training-mega-stone-preview">
                          <img src={zaMegaStone.sprite} alt="" draggable="false" />
                          <span>
                            <small>REQUIRED MEGA STONE</small>
                            <strong>{zaMegaStone.name}</strong>
                          </span>
                          <em>장착 필요</em>
                        </span>
                      )}
                      </div>
                    )}
                    <div className="training-picker-field">
                      <span>
                        성격
                        <em className="training-field-cost">변경 {TRAINING_COSTS.nature} VP</em>
                      </span>
                      <button
                        className="training-profile-picker-button"
                        type="button"
                        disabled={isPreviewForm}
                        aria-label={`성격 변경, 현재 ${selectedPokemon.nature}`}
                        aria-haspopup="dialog"
                        aria-expanded={profilePicker === 'nature'}
                        onClick={() => openProfilePicker('nature')}
                      >
                        <span>
                          <strong>{selectedPokemon.nature}</strong>
                          <small>{selectedNatureEffect.summary}</small>
                        </span>
                        <ChevronDown size={14} />
                      </button>
                    </div>
                    <div
                      className="training-picker-field training-tooltip-anchor ability-picker-field"
                      {...tooltipAnchorProps(`ability-select-tooltip-${selectedPokemon.captureId}`)}
                    >
                      <span>
                        특성
                        <button
                          className="training-inline-info"
                          type="button"
                          aria-label={`${selectedPokemon.ability} 특성 설명`}
                          aria-describedby={`ability-select-tooltip-${selectedPokemon.captureId}`}
                        >
                          <Info size={11} />
                        </button>
                        <em className="training-field-cost">변경 {TRAINING_COSTS.ability} VP</em>
                      </span>
                      <button
                        className="training-profile-picker-button"
                        type="button"
                        disabled={isPreviewForm}
                        aria-label={`특성 변경, 현재 ${selectedPokemon.ability}`}
                        aria-describedby={`ability-select-tooltip-${selectedPokemon.captureId}`}
                        aria-haspopup="dialog"
                        aria-expanded={profilePicker === 'ability'}
                        onClick={() => openProfilePicker('ability')}
                      >
                        <span>
                          <strong>{selectedPokemon.ability}</strong>
                          <small>{selectedAbility.trigger}</small>
                        </span>
                        <ChevronDown size={14} />
                      </button>
                      <BattleTooltip
                        id={`ability-select-tooltip-${selectedPokemon.captureId}`}
                        eyebrow="ABILITY"
                        title={selectedPokemon.ability}
                        description={selectedAbility.description}
                        visible={activeTooltipId === `ability-select-tooltip-${selectedPokemon.captureId}`}
                        label="특성 정보"
                        side="right"
                        accentClass="ability-tooltip"
                        meta={[{ label: '발동 조건', value: selectedAbility.trigger }]}
                      />
                    </div>
                  </div>
                </div>

                <div className="training-stat-column">
                  <div className="training-section-title">
                    <span>
                      <SlidersHorizontal size={15} /> 능력 포인트
                      <em className="training-field-cost">1P · {TRAINING_COSTS.trainingPoint} VP</em>
                    </span>
                    <div className="training-point-summary">
                      <small>남은 포인트 {trainingPointRemaining}</small>
                      <strong>{trainingPointTotal}<em>/{STAT_POINT_TOTAL}</em></strong>
                    </div>
                  </div>
                  <div className="training-budget-track" aria-hidden="true">
                    <span style={{ width: `${(trainingPointTotal / STAT_POINT_TOTAL) * 100}%` }} />
                  </div>
                  <div className="training-stat-list">
                    {stats.map((stat) => (
                      <div className={`training-stat-row trend-${stat.trend}`} key={stat.key}>
                        <span className="training-stat-name">{stat.label}</span>
                        <strong className="training-stat-value">{stat.value}</strong>
                        <i className="training-stat-value-bar"><b style={{ width: `${Math.max(5, stat.ratio * 100)}%` }} /></i>
                        <div className="training-stat-controls">
                          <button
                            type="button"
                            aria-label={`${stat.label} 능력 포인트 1 감소`}
                            disabled={isPreviewForm || stat.trainingPoint === 0}
                            onClick={() => adjustTrainingPoint(stat.key, -1)}
                          >
                            <Minus size={12} />
                          </button>
                          <input
                            type="range"
                            min="0"
                            max={STAT_POINT_PER_STAT}
                            value={stat.trainingPoint}
                            disabled={isPreviewForm}
                            aria-label={`${stat.label} 능력 포인트`}
                            onChange={(event) => setTrainingPoint(stat.key, Number(event.target.value))}
                          />
                          <button
                            type="button"
                            aria-label={`${stat.label} 능력 포인트 1 증가`}
                            disabled={isPreviewForm || stat.trainingPoint === STAT_POINT_PER_STAT || trainingPointRemaining === 0}
                            onClick={() => adjustTrainingPoint(stat.key, 1)}
                          >
                            <Plus size={12} />
                          </button>
                          <em><strong>{stat.trainingPoint}</strong><small>/{STAT_POINT_PER_STAT}</small></em>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="training-stat-footer">
                    <div className="training-stat-rule">
                      <strong>배분 규칙</strong>
                      <span>최대 32 · 합계 66 · 1P = +1</span>
                    </div>
                    <div className="training-nature-effect">
                      <span>능력 보정</span>
                      <strong>{selectedPokemon.nature}</strong>
                    </div>
                  </div>
                </div>

                <div className="training-move-column">
                  <div className="training-section-title">
                    <span>배틀 기술</span>
                    <strong>1개 변경 · {TRAINING_COSTS.move} VP</strong>
                  </div>
                  <div className="training-move-list">
                    {selectedPokemon.moves.map((moveName, index) => {
                      const move = resolveMoveForPokemon(getMove(moveName), selectedPokemon)
                      const tooltipId = `move-tooltip-${selectedPokemon.captureId}-${index}`
                      const accuracy = move.accuracyLabel ?? move.accuracy ?? '—'
                      const categoryClass = move.category === '물리'
                        ? 'physical'
                        : move.category === '특수' ? 'special' : 'status'

                      return (
                        <div
                          className={`training-move-card training-tooltip-anchor move-type-${typeClassName(move.type)}`}
                          key={`${index}-${moveName}`}
                          {...tooltipAnchorProps(tooltipId)}
                        >
                          <span className="training-move-slot">0{index + 1}</span>
                          <span className={`training-move-type type-${typeClassName(move.type)}`}>{move.type}</span>
                          <div className="training-move-select">
                            <span className="training-move-select-heading">
                              <small>MOVE {index + 1}</small>
                              {move.id === 'hiddenpower' && !isPreviewForm && (
                                <button
                                  className={`training-hidden-power-config type-${typeClassName(move.type)}`}
                                  type="button"
                                  aria-label={`잠재파워 타입 설정, 현재 ${move.type}타입`}
                                  onClick={() => openProfilePicker('hidden-power')}
                                >
                                  <Sparkles size={8} />
                                  {move.type} 설정
                                </button>
                              )}
                            </span>
                            <button
                              className="training-move-select-button"
                              type="button"
                              disabled={isPreviewForm}
                              aria-label={`${index + 1}번 기술 변경, 현재 ${moveName}`}
                              aria-describedby={tooltipId}
                              aria-haspopup="dialog"
                              aria-expanded={movePickerSlot === index}
                              onClick={() => openMovePicker(index)}
                            >
                              <span>{moveName}</span>
                              <ChevronDown size={13} />
                            </button>
                          </div>
                          <span className="training-move-metrics">
                            <span className={`training-category-chip category-${categoryClass}`}>{move.category}</span>
                            <span><small>위력</small><strong>{move.power || '—'}</strong></span>
                            <span><small>명중</small><strong>{accuracy}</strong></span>
                            <span><small>PP</small><strong>{move.pp}</strong></span>
                          </span>
                          <button
                            className="training-tooltip-trigger"
                            type="button"
                            aria-label={`${move.name} 설명`}
                            aria-describedby={tooltipId}
                          >
                            <Info size={13} />
                          </button>
                          <BattleTooltip
                            id={tooltipId}
                            eyebrow={`${move.type}타입 · ${move.category}`}
                            title={move.name}
                            description={move.description}
                            visible={activeTooltipId === tooltipId}
                            accentClass={`type-accent-${typeClassName(move.type)}`}
                            meta={[
                              { label: '위력', value: move.power || '—' },
                              { label: '명중', value: accuracy },
                              { label: 'PP', value: move.pp },
                            ]}
                          />
                        </div>
                      )
                    })}
                  </div>
                  <div
                    className="training-ability-preview training-tooltip-anchor"
                    {...tooltipAnchorProps(`ability-preview-tooltip-${selectedPokemon.captureId}`)}
                  >
                    <span>특성</span>
                    <strong>{selectedPokemon.ability}</strong>
                    <small>{selectedAbility.trigger}</small>
                    <button
                      className="training-tooltip-trigger"
                      type="button"
                      aria-label={`${selectedPokemon.ability} 특성 설명`}
                      aria-describedby={`ability-preview-tooltip-${selectedPokemon.captureId}`}
                    >
                      <Info size={13} />
                    </button>
                    <BattleTooltip
                      id={`ability-preview-tooltip-${selectedPokemon.captureId}`}
                      eyebrow="ABILITY"
                      title={selectedPokemon.ability}
                      description={selectedAbility.description}
                      visible={activeTooltipId === `ability-preview-tooltip-${selectedPokemon.captureId}`}
                      label="특성 정보"
                      accentClass="ability-tooltip"
                      meta={[{ label: '발동 조건', value: selectedAbility.trigger }]}
                    />
                  </div>
                </div>
              </div>

              <div className="training-editor-actions">
                <div className="training-save-summary">
                  {(isPreviewForm || !hasChanges || !canAffordTraining || trainingCost.total > 0) && (
                    <span className={`training-save-state${hasChanges ? ' changed' : ''}${isPreviewForm ? ' preview-only' : ''}${hasChanges && !canAffordTraining ? ' insufficient' : ''}`}>
                      {isPreviewForm
                        ? '배틀 기믹 폼은 미리보기 전용이며 저장할 수 없습니다.'
                        : hasChanges
                          ? canAffordTraining
                            ? '변경한 항목만 계산됩니다.'
                            : `${trainingShortfall.toLocaleString()} VP가 부족합니다.`
                          : '현재 저장된 설정입니다.'}
                    </span>
                  )}
                  {hasChanges && !isPreviewForm && displayedTrainingCostItems.length > 0 && (
                    <div className="training-cost-breakdown" aria-label={`트레이닝 비용 ${trainingCost.total.toLocaleString()} VP`}>
                      <div>
                        {displayedTrainingCostItems.map((item) => (
                          <span key={item.id}>
                            <small>{item.label} {item.units}{item.unitLabel}</small>
                            <strong>{item.cost.toLocaleString()} VP</strong>
                          </span>
                        ))}
                      </div>
                      <strong className={`training-cost-total${canAffordTraining ? '' : ' insufficient'}`}>
                        <Zap size={13} fill="currentColor" />
                        {trainingCost.total.toLocaleString()} <em>VP</em>
                      </strong>
                    </div>
                  )}
                </div>
                <button type="button" disabled={!hasChanges && !isPreviewForm} onClick={resetTraining}>
                  <RotateCcw size={16} /> {isPreviewForm ? '미리보기 종료' : '저장값으로 초기화'}
                </button>
                <button className="primary" type="button" disabled={!canSave} onClick={saveTraining}>
                  {isPreviewForm
                    ? <LockKeyhole size={17} />
                    : hasChanges
                      ? trainingCost.total === 0 ? <Sparkles size={17} /> : <Zap size={17} />
                      : <Check size={17} />}
                  {isPreviewForm
                    ? '미리보기는 저장 불가'
                    : hasChanges
                      ? canAffordTraining
                        ? trainingCost.total === 0
                          ? '설정 저장 · 무료'
                          : `트레이닝 · ${trainingCost.total.toLocaleString()} VP`
                        : `${trainingShortfall.toLocaleString()} VP 부족`
                      : '설정 저장'}
                </button>
              </div>

              {movePickerSlot !== null && activePickerMove && (
                <div
                  className="move-picker-backdrop"
                  onMouseDown={(event) => {
                    if (event.target === event.currentTarget) setMovePickerSlot(null)
                  }}
                >
                  <section className="move-picker-panel" role="dialog" aria-modal="true" aria-labelledby="move-picker-title">
                    <header className="move-picker-header">
                      <span className={`move-picker-current-type type-${typeClassName(activePickerMove.type)}`}>
                        {activePickerMove.type}
                      </span>
                      <div>
                        <small>MOVE LIBRARY · SLOT 0{movePickerSlot + 1}</small>
                        <h3 id="move-picker-title">배울 수 있는 기술</h3>
                        <p>{selectedPokemon.name}가 실제 게임에서 배울 수 있는 기술만 표시됩니다.</p>
                      </div>
                      <button type="button" aria-label="기술 목록 닫기" onClick={() => setMovePickerSlot(null)}>
                        <X size={18} />
                      </button>
                    </header>

                    <div className="move-picker-toolbar">
                      <div className="move-picker-search">
                        <Search size={15} />
                        <input
                          autoFocus
                          type="search"
                          value={moveSearch}
                          aria-label="기술 이름 검색"
                          placeholder="기술 이름 또는 타입 검색"
                          onChange={(event) => setMoveSearch(event.target.value)}
                        />
                        {moveSearch && (
                          <button type="button" aria-label="검색어 지우기" onClick={() => setMoveSearch('')}>
                            <X size={13} />
                          </button>
                        )}
                      </div>
                      <div className="move-picker-filters" aria-label="기술 분류 필터">
                        {MOVE_CATEGORY_FILTERS.map((category) => (
                          <button
                            className={moveCategory === category ? 'active' : ''}
                            type="button"
                            key={category}
                            aria-pressed={moveCategory === category}
                            onClick={() => setMoveCategory(category)}
                          >
                            {category}
                          </button>
                        ))}
                      </div>
                      <strong className="move-picker-count">{filteredMoves.length}<em>/{learnableMoves.length}</em></strong>
                    </div>

                    <div className="move-picker-list" role="listbox" aria-label={`${selectedPokemon.name}가 배울 수 있는 기술 목록`}>
                      {filteredMoves.map((option) => {
                        const optionAccuracy = option.accuracyLabel ?? option.accuracy ?? '—'
                        const optionCategory = option.category === '물리'
                          ? 'physical'
                          : option.category === '특수' ? 'special' : 'status'
                        const optionTooltipId = `move-picker-tooltip-${selectedPokemon.captureId}-${option.id}`
                        const isSelected = selectedPokemon.moves[movePickerSlot] === option.name
                        const usedInOtherSlot = selectedPokemon.moves.some(
                          (moveName, slotIndex) => slotIndex !== movePickerSlot && moveName === option.name,
                        )

                        return (
                          <div
                            className="move-picker-choice-shell training-tooltip-anchor"
                            key={option.id}
                            {...tooltipAnchorProps(optionTooltipId, {
                              onShow: (event) => showMovePickerTooltip(event, option, optionTooltipId),
                              onHide: () => hideMovePickerTooltip(optionTooltipId),
                            })}
                          >
                            <button
                              className={`move-picker-choice move-type-${typeClassName(option.type)}${isSelected ? ' selected' : ''}`}
                              type="button"
                              role="option"
                              aria-selected={isSelected}
                              aria-describedby={optionTooltipId}
                              disabled={usedInOtherSlot}
                              onClick={() => chooseMove(option)}
                            >
                              <span className={`move-picker-choice-type type-${typeClassName(option.type)}`}>{option.type}</span>
                              <span className="move-picker-choice-name">
                                <strong>{option.name}</strong>
                                <small>{option.description}</small>
                              </span>
                              <span className="move-picker-choice-state">
                                {isSelected && <><Check size={12} /> 선택됨</>}
                                {usedInOtherSlot && '장착중'}
                              </span>
                              <span className="move-picker-choice-stats">
                                <em className={`category-${optionCategory}`}>{option.category}</em>
                                <span><small>위력</small><b>{option.power || '—'}</b></span>
                                <span><small>명중</small><b>{optionAccuracy}</b></span>
                                <span><small>PP</small><b>{option.pp}</b></span>
                              </span>
                            </button>
                          </div>
                        )
                      })}
                      {filteredMoves.length === 0 && (
                        <div className="move-picker-empty">
                          <Search size={24} />
                          <strong>검색 결과가 없습니다.</strong>
                          <span>다른 기술 이름이나 분류를 선택해보세요.</span>
                        </div>
                      )}
                    </div>

                    <footer className="move-picker-footer">
                      <span>실제 게임에서 배울 수 있는 기술만 선택할 수 있으며 중복 등록은 불가능합니다.</span>
                      <strong>ESC 닫기</strong>
                    </footer>
                    {movePickerTooltip && (
                      <BattleTooltip
                        id={movePickerTooltip.tooltipId}
                        eyebrow={`${movePickerTooltip.option.type}타입 · ${movePickerTooltip.option.category}`}
                        title={movePickerTooltip.option.name}
                        description={movePickerTooltip.option.description}
                        visible={activeTooltipId === movePickerTooltip.tooltipId}
                        side="floating"
                        accentClass={`type-accent-${typeClassName(movePickerTooltip.option.type)}`}
                        className="picker-floating-tooltip"
                        style={{ left: movePickerTooltip.left, top: movePickerTooltip.top }}
                        meta={[
                          { label: '위력', value: movePickerTooltip.option.power || '—' },
                          {
                            label: '명중',
                            value: movePickerTooltip.option.accuracyLabel
                              ?? movePickerTooltip.option.accuracy
                              ?? '—',
                          },
                          { label: 'PP', value: movePickerTooltip.option.pp },
                        ]}
                      />
                    )}
                  </section>
                </div>
              )}

              {profilePicker && selectedNature && selectedAbility && (
                <div
                  className="move-picker-backdrop profile-picker-backdrop"
                  onMouseDown={(event) => {
                    if (event.target === event.currentTarget) setProfilePicker(null)
                  }}
                >
                  <section
                    className={`profile-picker-panel picker-${profilePicker}`}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="profile-picker-title"
                  >
                    <header className="move-picker-header profile-picker-header">
                      <span className={`profile-picker-icon picker-${profilePicker}`}>
                        {isEvolutionPicker || isPersistentFormPicker
                          ? <Dna size={23} />
                          : isBattleFormPicker
                            ? <Sparkles size={23} />
                            : isHiddenPowerPicker
                              ? <Sparkles size={23} />
                              : profilePicker === 'nature' ? <Sparkles size={23} /> : <Gauge size={23} />}
                      </span>
                      <div>
                        <small>
                          {isEvolutionPicker
                            ? 'EVOLUTION PATH'
                            : isPersistentFormPicker
                              ? 'FORM LIBRARY'
                            : isBattleFormPicker
                              ? 'BATTLE FORM PREVIEW'
                              : isHiddenPowerPicker
                                ? 'HIDDEN POWER TYPE'
                                : profilePicker === 'nature' ? 'NATURE LIBRARY' : 'ABILITY LIBRARY'}
                        </small>
                        <h3 id="profile-picker-title">
                          {isEvolutionPicker
                            ? '진화 형태 선택'
                            : isPersistentFormPicker
                              ? '폼 설정'
                            : isBattleFormPicker
                              ? '배틀 기믹 폼 확인'
                              : isHiddenPowerPicker
                                ? '잠재파워 타입 설정'
                                : profilePicker === 'nature' ? '성격 선택' : '특성 선택'}
                        </h3>
                        <p>
                          {isEvolutionPicker
                            ? '진화 계통의 모습과 타입, 능력치를 비교해 사용할 형태를 선택하세요.'
                            : isPersistentFormPicker
                              ? '기본·외형·성별·특성·기술 폼 중 저장할 모습을 선택하세요.'
                            : isBattleFormPicker
                              ? '배틀 중에만 변하는 모습을 확인합니다. 포켓몬의 진화나 저장 데이터에는 적용되지 않습니다.'
                              : isHiddenPowerPicker
                                ? '잠재파워가 배틀에서 사용할 타입을 선택하세요.'
                                : profilePicker === 'nature'
                                  ? '능력치 보정을 비교하고 배틀에 맞는 성격을 선택하세요.'
                                  : `${species.name}의 사용 가능한 특성과 발동 효과를 확인하세요.`}
                        </p>
                      </div>
                      <button type="button" aria-label="선택창 닫기" onClick={() => setProfilePicker(null)}>
                        <X size={18} />
                      </button>
                    </header>

                    <div className="profile-picker-summary">
                      <span>현재 설정</span>
                      <strong>
                        {isEvolutionPicker
                          ? editableEvolutionSpecies.name
                          : isPersistentFormPicker
                            ? editableSpecies.name
                            : isBattleFormPicker
                              ? isPreviewForm ? species.name : '선택 안 함'
                              : isHiddenPowerPicker
                                ? `${selectedPokemon.hiddenPowerType}타입`
                                : profilePicker === 'nature' ? selectedPokemon.nature : selectedPokemon.ability}
                      </strong>
                      <em>
                        {isEvolutionPicker
                          ? hasBranchingEvolution
                            ? selectedEvolutionIndex === 0
                              ? '기본 형태'
                              : `분기 진화 ${selectedEvolutionIndex} / ${evolutionOptions.length - 1}`
                            : `진화 단계 ${selectedEvolutionIndex + 1} / ${evolutionOptions.length}`
                          : isPersistentFormPicker
                            ? `${editableFormMetadata.label}${editableFormMetadata.requirement ? ` · ${editableFormMetadata.requirement}` : ''}`
                            : isBattleFormPicker
                              ? '확인 전용 · 진화 및 저장 불가'
                              : isHiddenPowerPicker
                                ? '위력 60 · 특수 기술 · 타입 자유 설정'
                                : profilePicker === 'nature' ? selectedNatureEffect.summary : selectedAbility.trigger}
                      </em>
                    </div>

                    {isFormPicker ? (
                      <div
                        className="profile-picker-list evolution-picker-list"
                        role="listbox"
                        aria-label={
                          isBattleFormPicker
                            ? `${editableSpecies.name} 배틀 기믹 폼`
                            : isPersistentFormPicker
                              ? `${editableSpecies.name} 저장 가능 폼`
                              : `${editableSpecies.name} 진화 계통`
                        }
                      >
                        {formPickerOptions.map((option, index) => {
                          const isBasePreviewOption = isBattleFormPicker && option.id === editableSpecies.id
                          const isSelected = isBattleFormPicker
                            ? option.id === (previewSpeciesId ?? editableSpecies.id)
                            : editablePokemon.speciesId === option.id
                          const isPreviewOnly = isBattleFormPicker && !isBasePreviewOption
                          const formMetadata = getFormMetadata(option)
                          const baseStatTotal = option.stats.reduce((total, stat) => total + stat, 0)
                          const optionZaMegaStone = getZaMegaStoneByFormSlug(option.slug)
                          const sprite = selectedPokemon.isShiny
                            ? option.spriteFrontShinyFallback
                            : option.spriteFrontFallback

                          return (
                            <button
                              className={`profile-picker-choice evolution-picker-choice${isSelected ? ' selected' : ''}${isPreviewOnly ? ' preview-only' : ''}`}
                              type="button"
                              role="option"
                              aria-selected={isSelected}
                              autoFocus={isSelected}
                              key={option.id}
                              onClick={() => {
                                if (isBattleFormPicker) chooseBattleForm(isBasePreviewOption ? null : option.id)
                                else if (isPersistentFormPicker) choosePersistentForm(option.id)
                                else chooseEvolution(option.id)
                              }}
                            >
                              <span className="evolution-choice-sprite">
                                <img
                                  src={sprite}
                                  alt=""
                                  draggable="false"
                                  onError={fallbackImageHandler(
                                    selectedPokemon.isShiny
                                      ? option.spriteFrontShinyFallback
                                      : option.spriteFrontFallback,
                                  )}
                                />
                              </span>
                              <span className="evolution-choice-copy">
                                <small>NO. {String(option.parentSpeciesId ?? option.id).padStart(4, '0')}</small>
                                <strong>{option.name}</strong>
                                <span className="evolution-type-list">
                                  {option.types.map((type) => (
                                    <em className={`type-${typeClassName(type)}`} key={type}>{type}</em>
                                  ))}
                                </span>
                                {optionZaMegaStone && (
                                  <span className="evolution-mega-stone-chip">
                                    <img src={optionZaMegaStone.sprite} alt="" draggable="false" />
                                    <span>
                                      <small>필요 메가스톤</small>
                                      <b>{optionZaMegaStone.name}</b>
                                    </span>
                                  </span>
                                )}
                              </span>
                              <span className="evolution-stage-chip">
                                {isBasePreviewOption
                                  ? 'BASE FORM'
                                  : optionZaMegaStone
                                  ? <><Sparkles size={11} /> ZA MEGA</>
                                  : isPreviewOnly
                                  ? <><Eye size={11} /> PREVIEW ONLY</>
                                  : isPersistentFormPicker
                                  ? formMetadata.eyebrow
                                  : hasBranchingEvolution
                                  ? index === 0 ? 'BASE FORM' : `BRANCH ${String(index).padStart(2, '0')}`
                                  : `STAGE ${String(index + 1).padStart(2, '0')}`}
                              </span>
                              <span className="evolution-stat-total">
                                <small>
                                  {isPreviewOnly
                                    ? `특성 ${option.abilities[0]}`
                                    : isPersistentFormPicker && formMetadata.requirement
                                      ? formMetadata.requirement
                                      : '종족값 합계'}
                                </small>
                                <b>{baseStatTotal}</b>
                              </span>
                              <span className="profile-choice-state">
                                {isSelected && (
                                  isPreviewOnly
                                    ? <><Eye size={12} /> 미리보기 중</>
                                    : <><Check size={12} /> 선택됨</>
                                )}
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    ) : isHiddenPowerPicker ? (
                      <div
                        className="profile-picker-list hidden-power-picker-list"
                        role="listbox"
                        aria-label="잠재파워 타입 목록"
                      >
                        {HIDDEN_POWER_TYPES.map((type) => {
                          const isSelected = selectedPokemon.hiddenPowerType === type

                          return (
                            <button
                              className={`profile-picker-choice hidden-power-picker-choice move-type-${typeClassName(type)}${isSelected ? ' selected' : ''}`}
                              type="button"
                              role="option"
                              aria-selected={isSelected}
                              autoFocus={isSelected}
                              key={type}
                              onClick={() => chooseHiddenPowerType(type)}
                            >
                              <span className={`hidden-power-choice-type type-${typeClassName(type)}`}>{type}</span>
                              <span className="profile-choice-copy">
                                <strong>{type}타입</strong>
                                <small>잠재파워가 {type}타입 특수 기술로 발동합니다.</small>
                              </span>
                              <span className="profile-choice-state">
                                {isSelected && <><Check size={12} /> 선택됨</>}
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    ) : profilePicker === 'nature' ? (
                      <div className="profile-picker-list nature-picker-list" role="listbox" aria-label="전체 성격 목록">
                        {NATURE_OPTIONS.map((option) => {
                          const effect = getNatureEffect(option)
                          const isSelected = selectedPokemon.nature === option.label

                          return (
                            <button
                              className={`profile-picker-choice nature-picker-choice${isSelected ? ' selected' : ''}`}
                              type="button"
                              role="option"
                              aria-selected={isSelected}
                              autoFocus={isSelected}
                              key={option.label}
                              onClick={() => chooseNature(option.label)}
                            >
                              <span className="profile-choice-symbol"><Sparkles size={15} /></span>
                              <span className="profile-choice-copy">
                                <strong>{option.label}</strong>
                                <small>{effect.description}</small>
                              </span>
                              <span className="nature-effect-chips">
                                {option.up && option.down ? (
                                  <>
                                    <em className="nature-up">{STAT_LABEL_BY_KEY[option.up]} ↑</em>
                                    <em className="nature-down">{STAT_LABEL_BY_KEY[option.down]} ↓</em>
                                  </>
                                ) : (
                                  <em className="nature-neutral">보정 없음</em>
                                )}
                              </span>
                              <span className="profile-choice-state">
                                {isSelected && <><Check size={12} /> 선택됨</>}
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    ) : (
                      <div className="profile-picker-list ability-picker-list" role="listbox" aria-label={`${species.name} 특성 목록`}>
                        {species.abilities.map((ability) => {
                          const abilityInfo = getAbility(ability)
                          const abilityTooltipId = `ability-picker-tooltip-${selectedPokemon.captureId}-${ability}`
                          const isSelected = selectedPokemon.ability === ability

                          return (
                            <button
                              className={`profile-picker-choice ability-picker-choice${isSelected ? ' selected' : ''}`}
                              type="button"
                              role="option"
                              aria-selected={isSelected}
                              aria-describedby={abilityTooltipId}
                              autoFocus={isSelected}
                              key={ability}
                              onClick={() => chooseAbility(ability)}
                              {...tooltipAnchorProps(abilityTooltipId, {
                                onShow: (event) => showAbilityPickerTooltip(
                                  event,
                                  ability,
                                  abilityInfo,
                                  abilityTooltipId,
                                ),
                                onHide: () => hideAbilityPickerTooltip(abilityTooltipId),
                              })}
                            >
                              <span className="profile-choice-symbol"><Dna size={18} /></span>
                              <span className="profile-choice-copy">
                                <strong>{ability}</strong>
                                <small>{abilityInfo.description}</small>
                              </span>
                              <span className="ability-trigger-chip">
                                <small>발동 조건</small>
                                <b>{abilityInfo.trigger}</b>
                              </span>
                              <span className="profile-choice-state">
                                {isSelected && <><Check size={12} /> 선택됨</>}
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    )}

                    <footer className="move-picker-footer profile-picker-footer">
                      <span>
                        {profilePicker === 'evolution'
                          ? '이 메뉴에서는 전국도감 번호가 있는 일반 진화만 변경하고 저장할 수 있습니다.'
                          : profilePicker === 'persistent-form'
                            ? '기술·특성이 필요한 폼은 선택할 때 조건을 함께 적용하며, 외형·성별 폼도 저장됩니다.'
                          : profilePicker === 'battle-form'
                            ? '메가진화·거다이맥스 등 배틀 기믹 폼은 확인 전용이며 포켓몬 데이터에 저장되지 않습니다.'
                            : profilePicker === 'hidden-power'
                              ? '잠재파워는 페어리·스텔라를 제외한 17개 타입 중 하나로 설정할 수 있습니다.'
                          : profilePicker === 'nature'
                            ? '상승 능력치는 1.1배, 하락 능력치는 0.9배로 계산됩니다.'
                            : '현재 진화 형태에서 사용할 수 있는 특성만 표시됩니다.'}
                      </span>
                      <strong>ESC 닫기</strong>
                    </footer>
                    {profilePicker === 'ability' && abilityPickerTooltip && (
                      <BattleTooltip
                        id={abilityPickerTooltip.tooltipId}
                        eyebrow="ABILITY"
                        title={abilityPickerTooltip.ability}
                        description={abilityPickerTooltip.abilityInfo.description}
                        visible={activeTooltipId === abilityPickerTooltip.tooltipId}
                        label="특성 정보"
                        side="floating"
                        accentClass="ability-tooltip"
                        className="picker-floating-tooltip"
                        style={{ left: abilityPickerTooltip.left, top: abilityPickerTooltip.top }}
                        meta={[
                          { label: '발동 조건', value: abilityPickerTooltip.abilityInfo.trigger },
                        ]}
                      />
                    )}
                  </section>
                </div>
              )}
            </>
          ) : (
            <div className="training-editor-empty">
              <Dna size={34} />
              <strong>포켓몬을 선택해주세요</strong>
              <span>선택한 포켓몬의 능력치와 배틀 설정이 표시됩니다.</span>
            </div>
          )}
        </section>
      </section>
    </main>
  )
}

export default TrainingScreen
