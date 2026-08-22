import { useEffect, useRef, useState } from 'react'
import {
  Boxes,
  ChevronRight,
  Dumbbell,
  PawPrint,
  Settings,
  ShoppingBag,
  Sparkles,
  Swords,
  Volume2,
  VolumeX,
  Zap,
} from 'lucide-react'
import BattleSelectScreen from './BattleSelectScreen'
import BattleScreen from './BattleScreen'
import BoxScreen from './BoxScreen'
import CompetitionScreen from './CompetitionScreen'
import HatchScreen from './HatchScreen'
import SettingsModal from './SettingsModal'
import ShopScreen from './ShopScreen'
import TrainingScreen from './TrainingScreen'
import TrainerSprite from './TrainerSprite'
import { createGameAudio } from './gameAudio'
import {
  SETTINGS_STORAGE_KEY,
  createDefaultGameSettings,
  loadGameSettings,
  normalizeGameSettings,
} from './gameSettings'
import {
  createCompletePokemonCollection,
  createPokemonDraw,
  getPokemonEvolutionFamilyKey,
  getTrainingRosterPokemon,
  mergePokemonDraws,
  migratePokemonCollection,
} from './data/pokemonPool'
import {
  DYNAMAX_MODES,
  TERA_TYPES,
  canGigantamax,
  getSpeciesProfile,
  normalizeDynamaxMode,
  normalizePokemon,
} from './data/trainingData'
import {
  attemptItemEquip,
  attemptItemPurchase,
  createCompleteBattleItemInventory,
  normalizeItemInventory,
} from './data/shopData'
import {
  BATTLE_TEAM_SIZE,
  normalizeSavedTeamState,
  sanitizeSavedTeams,
} from './data/teamData'
import {
  createCompetition,
  getCompetitionOpponentTeam,
  getCompetitionRoundLabel,
  getCurrentCompetitionMatch,
  resolveCompetitionMatch,
} from './data/competitionData'
import {
  selectOpponentBattlePokemon,
  selectPlayerBattlePokemon,
} from './data/battleRules'

const BOX_STORAGE_KEY = 'champions-dex-v2'
const LEGACY_BOX_STORAGE_KEY = 'champions-box-v1'
const TEAMS_STORAGE_KEY = 'champions-teams-v1'
const TEAM_STORAGE_KEY = 'champions-team-v2'
const LEGACY_TEAM_STORAGE_KEY = 'champions-team-v1'
const VP_STORAGE_KEY = 'champions-vp-v1'
const ITEM_STORAGE_KEY = 'champions-battle-items-v1'
const TEST_VP_BALANCE = 99_999
const TEST_UNLOCK_ALL_CONTENT = true

function interactiveSoundKind(element) {
  const label = `${element.getAttribute('aria-label') ?? ''} ${element.textContent ?? ''}`.toLowerCase()
  if (/돌아|닫기|취소|해제|지우기|이전|기권/.test(label)) return 'cancel'
  if (/구매|저장|확정|시작|개시|참가|뽑기|편성|장착|설정/.test(label)) return 'confirm'
  return 'select'
}

function loadStoredArray(key) {
  try {
    const storedValue = window.localStorage.getItem(key)
    const parsedValue = storedValue ? JSON.parse(storedValue) : []
    return Array.isArray(parsedValue) ? parsedValue : []
  } catch {
    return []
  }
}

function loadStoredBox() {
  const hasCurrentCollection = window.localStorage.getItem(BOX_STORAGE_KEY) !== null
  const storedPokemon = hasCurrentCollection
    ? loadStoredArray(BOX_STORAGE_KEY)
    : loadStoredArray(LEGACY_BOX_STORAGE_KEY)
  return TEST_UNLOCK_ALL_CONTENT
    ? createCompletePokemonCollection(storedPokemon)
    : migratePokemonCollection(storedPokemon)
}

function loadLegacyTeamIds(collection) {
  const hasCurrentTeam = window.localStorage.getItem(TEAM_STORAGE_KEY) !== null
  const storedTeam = hasCurrentTeam
    ? loadStoredArray(TEAM_STORAGE_KEY)
    : loadStoredArray(LEGACY_TEAM_STORAGE_KEY)

  if (hasCurrentTeam) return storedTeam.slice(0, BATTLE_TEAM_SIZE)

  const legacyPokemon = loadStoredArray(LEGACY_BOX_STORAGE_KEY)
  const legacySpeciesByCaptureId = new Map(
    legacyPokemon.map((pokemon) => [pokemon.captureId, Number(pokemon.speciesId)]),
  )
  const availableIds = new Set(collection.map((pokemon) => pokemon.captureId))

  return [...new Set(storedTeam.map((captureId) => {
    if (availableIds.has(captureId)) return captureId
    const speciesId = legacySpeciesByCaptureId.get(captureId)
    return speciesId ? `dex-${speciesId}` : null
  }).filter((captureId) => captureId && availableIds.has(captureId)))].slice(0, BATTLE_TEAM_SIZE)
}

function loadStoredTeamState(collection) {
  const availableCaptureIds = collection.map((pokemon) => pokemon.captureId)

  try {
    const storedValue = window.localStorage.getItem(TEAMS_STORAGE_KEY)
    const storedState = storedValue ? JSON.parse(storedValue) : null
    const hasStoredTeams = Array.isArray(storedState?.teams) && storedState.teams.length > 0
    const legacyTeamIds = hasStoredTeams ? [] : loadLegacyTeamIds(collection)
    const normalizedState = normalizeSavedTeamState(storedState, availableCaptureIds, legacyTeamIds)
    return {
      ...normalizedState,
      teams: removeEvolutionFamilyDuplicates(normalizedState.teams, collection),
    }
  } catch {
    const normalizedState = normalizeSavedTeamState(null, availableCaptureIds, loadLegacyTeamIds(collection))
    return {
      ...normalizedState,
      teams: removeEvolutionFamilyDuplicates(normalizedState.teams, collection),
    }
  }
}

function removeEvolutionFamilyDuplicates(teams, collection) {
  const pokemonByCaptureId = new Map(collection.map((pokemon) => [pokemon.captureId, pokemon]))

  return teams.map((team) => {
    const familyKeys = new Set()
    const pokemonIds = team.pokemonIds.filter((captureId) => {
      const pokemon = pokemonByCaptureId.get(captureId)
      if (!pokemon) return false
      const familyKey = getPokemonEvolutionFamilyKey(pokemon)
      if (familyKeys.has(familyKey)) return false
      familyKeys.add(familyKey)
      return true
    })

    return pokemonIds.length === team.pokemonIds.length ? team : { ...team, pokemonIds }
  })
}

function loadStoredVp() {
  const storedVp = Math.floor(Number(window.localStorage.getItem(VP_STORAGE_KEY)) || 0)
  return Math.max(TEST_VP_BALANCE, storedVp)
}

function loadStoredItems() {
  try {
    const storedItems = window.localStorage.getItem(ITEM_STORAGE_KEY)
    const inventory = normalizeItemInventory(storedItems ? JSON.parse(storedItems) : {})
    return TEST_UNLOCK_ALL_CONTENT ? createCompleteBattleItemInventory(inventory) : inventory
  } catch {
    return TEST_UNLOCK_ALL_CONTENT ? createCompleteBattleItemInventory() : {}
  }
}

const modes = [
  {
    id: 'start',
    eyebrow: 'START BATTLE',
    title: '시작하기',
    description: 'AI와 배틀 시작',
    icon: Swords,
    badge: '추천',
  },
  {
    id: 'hatch',
    eyebrow: 'POKÉMON DRAW',
    title: '포켓몬 뽑기',
    description: '새로운 파트너 만나기',
    icon: PawPrint,
  },
  {
    id: 'training',
    eyebrow: 'CUSTOMIZE',
    title: '트레이닝',
    description: '기술과 능력 자유 편집',
    icon: Dumbbell,
  },
  {
    id: 'collection',
    eyebrow: 'BOX & TEAM',
    title: '박스 · 팀 편성',
    description: '보관함과 배틀 팀 관리',
    icon: Boxes,
  },
  {
    id: 'shop',
    eyebrow: 'BATTLE SHOP',
    title: '상점',
    description: '배틀 아이템 구매',
    icon: ShoppingBag,
  },
]

function App() {
  const initialCollection = useRef(null)
  if (initialCollection.current === null) initialCollection.current = loadStoredBox()
  const initialTeamState = useRef(null)
  if (initialTeamState.current === null) initialTeamState.current = loadStoredTeamState(initialCollection.current)
  const vpBalance = useRef(null)
  if (vpBalance.current === null) vpBalance.current = loadStoredVp()
  const storedItemInventory = useRef(null)
  if (storedItemInventory.current === null) storedItemInventory.current = loadStoredItems()

  const [screen, setScreen] = useState('lobby')
  const [selectedMode, setSelectedMode] = useState('start')
  const [boxReturnScreen, setBoxReturnScreen] = useState('lobby')
  const [drawResults, setDrawResults] = useState([])
  const [boxPokemon, setBoxPokemon] = useState(initialCollection.current)
  const [teams, setTeams] = useState(initialTeamState.current.teams)
  const [activeTeamId, setActiveTeamId] = useState(initialTeamState.current.activeTeamId)
  const [vp, setVp] = useState(vpBalance.current)
  const [itemInventory, setItemInventory] = useState(storedItemInventory.current)
  const [settings, setSettings] = useState(loadGameSettings)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [competition, setCompetition] = useState(null)
  const [battleMatch, setBattleMatch] = useState(null)
  const noticeTimer = useRef(null)
  const gameAudioRef = useRef(null)
  if (!gameAudioRef.current) gameAudioRef.current = createGameAudio(settings.audio.enabled, settings.audio)
  const activeTeam = teams.find((team) => team.id === activeTeamId) ?? teams[0]
  const teamIds = activeTeam?.pokemonIds ?? []
  const soundEnabled = settings.audio.enabled

  useEffect(() => {
    return () => {
      window.clearTimeout(noticeTimer.current)
      gameAudioRef.current?.destroy()
    }
  }, [])

  useEffect(() => {
    gameAudioRef.current?.setEnabled(soundEnabled)
  }, [soundEnabled])

  useEffect(() => {
    gameAudioRef.current?.setMix(settings.audio)
  }, [settings.audio])

  useEffect(() => {
    gameAudioRef.current?.setScene(screen === 'battle' ? null : screen)
  }, [screen])

  useEffect(() => {
    if (screen === 'battle') return undefined

    const interactiveSelector = 'button, [role="button"], select, input[type="checkbox"], input[type="radio"], input[type="range"]'
    const findInteractive = (target) => target instanceof Element ? target.closest(interactiveSelector) : null
    const playPointerSound = (event) => {
      const interactive = findInteractive(event.target)
      if (!interactive || interactive.matches(':disabled, [aria-disabled="true"]')) return
      gameAudioRef.current?.playUi(interactiveSoundKind(interactive))
    }
    const playHoverSound = (event) => {
      if (event.pointerType && event.pointerType !== 'mouse') return
      const interactive = findInteractive(event.target)
      if (!interactive || interactive.matches(':disabled, [aria-disabled="true"]')) return
      if (event.relatedTarget instanceof Node && interactive.contains(event.relatedTarget)) return
      gameAudioRef.current?.playUi('cursor')
    }
    const activateFromKeyboard = (event) => {
      if (!['Enter', ' '].includes(event.key)) return
      const interactive = findInteractive(event.target)
      if (!interactive || interactive.matches(':disabled, [aria-disabled="true"]')) return
      gameAudioRef.current?.playUi(interactiveSoundKind(interactive))
    }

    document.addEventListener('pointerdown', playPointerSound, true)
    document.addEventListener('pointerover', playHoverSound, true)
    document.addEventListener('keydown', activateFromKeyboard, true)
    return () => {
      document.removeEventListener('pointerdown', playPointerSound, true)
      document.removeEventListener('pointerover', playHoverSound, true)
      document.removeEventListener('keydown', activateFromKeyboard, true)
    }
  }, [screen])

  useEffect(() => {
    try {
      window.localStorage.setItem(BOX_STORAGE_KEY, JSON.stringify(boxPokemon))
    } catch {}
  }, [boxPokemon])

  useEffect(() => {
    try {
      window.localStorage.setItem(TEAMS_STORAGE_KEY, JSON.stringify({
        version: 1,
        activeTeamId: activeTeam?.id,
        teams,
      }))
      window.localStorage.setItem(TEAM_STORAGE_KEY, JSON.stringify(teamIds))
    } catch {}
  }, [activeTeam?.id, teamIds, teams])

  useEffect(() => {
    try {
      window.localStorage.setItem(VP_STORAGE_KEY, String(vp))
    } catch {}
  }, [vp])

  useEffect(() => {
    try {
      window.localStorage.setItem(ITEM_STORAGE_KEY, JSON.stringify(itemInventory))
    } catch {}
  }, [itemInventory])

  useEffect(() => {
    try {
      window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings))
    } catch {}
  }, [settings])

  useEffect(() => {
    const availableCaptureIds = boxPokemon.map((pokemon) => pokemon.captureId)
    setTeams((currentTeams) => {
      const sanitizedTeams = sanitizeSavedTeams(currentTeams, availableCaptureIds)
      const nextTeams = removeEvolutionFamilyDuplicates(sanitizedTeams, boxPokemon)
      const isUnchanged = nextTeams.every((team, teamIndex) => (
        team.name === currentTeams[teamIndex]?.name
        && team.pokemonIds.length === currentTeams[teamIndex]?.pokemonIds.length
        && team.pokemonIds.every((captureId, index) => captureId === currentTeams[teamIndex].pokemonIds[index])
      ))

      return isUnchanged ? currentTeams : nextTeams
    })
  }, [boxPokemon])

  const showNotice = (message) => {
    setNotice(message)
    window.clearTimeout(noticeTimer.current)
    noticeTimer.current = window.setTimeout(() => setNotice(''), 2400)
  }

  const updateSetting = (section, key, value) => {
    setSettings((currentSettings) => normalizeGameSettings({
      ...currentSettings,
      [section]: {
        ...currentSettings[section],
        [key]: value,
      },
    }))
  }

  const toggleSound = () => {
    const nextEnabled = !soundEnabled
    updateSetting('audio', 'enabled', nextEnabled)
    showNotice(nextEnabled ? '사운드를 켰습니다.' : '사운드를 껐습니다.')
  }

  const resetSettings = () => {
    setSettings(createDefaultGameSettings())
    showNotice('설정을 기본값으로 복원했습니다.')
  }

  const createAndStoreDraw = () => {
    const nextResults = createPokemonDraw(10, boxPokemon)
    const mergedDraw = mergePokemonDraws(boxPokemon, nextResults)

    setDrawResults(nextResults)
    setBoxPokemon(mergedDraw.collection)
    gameAudioRef.current?.playEvent(mergedDraw.shinyCount > 0 ? 'shiny' : 'draw')
    showNotice(
      mergedDraw.shinyCount > 0
        ? `도감 ${mergedDraw.newlyUnlockedCount}칸 해금 · 이로치 ${mergedDraw.shinyCount}마리 발견!`
        : `10회 뽑기 완료 · 진화 계통 포함 ${mergedDraw.newlyUnlockedCount}칸을 해금했습니다.`,
    )
  }

  const enterHatchScreen = () => {
    createAndStoreDraw()
    setScreen('hatch')
  }

  const selectMode = (mode) => {
    setSelectedMode(mode.id)

    if (mode.id === 'start') {
      setScreen('battle-select')
      return
    }

    if (mode.id === 'hatch') {
      enterHatchScreen()
      return
    }

    if (mode.id === 'training') {
      setScreen('training')
      return
    }

    if (mode.id === 'collection') {
      setBoxReturnScreen('lobby')
      setScreen('box')
      return
    }

    if (mode.id === 'shop') {
      setScreen('shop')
      return
    }

  }

  const resetDraw = () => {
    createAndStoreDraw()
  }

  const returnToLobby = () => {
    setScreen('lobby')
  }

  const openBox = () => {
    setBoxReturnScreen('lobby')
    setScreen('box')
  }

  const openBoxFromBattleSelect = () => {
    setBoxReturnScreen('battle-select')
    setScreen('box')
  }

  const returnFromBox = () => {
    setScreen(boxReturnScreen)
  }

  const openShop = () => {
    setSelectedMode('shop')
    setScreen('shop')
  }

  const selectSavedTeam = (teamId) => {
    if (!teams.some((team) => team.id === teamId)) return
    setActiveTeamId(teamId)
  }

  const startBattleMode = (battleMode) => {
    if (teamIds.length !== BATTLE_TEAM_SIZE) {
      gameAudioRef.current?.playEvent('error')
      showNotice(`배틀에 참가하려면 ${activeTeam?.name ?? '선택한 팀'}에 포켓몬 6마리를 편성해주세요.`)
      return
    }

    const activeTeamPokemon = teamIds
      .map((captureId) => boxPokemon.find((pokemon) => pokemon.captureId === captureId))
      .filter(Boolean)
    const nextCompetition = createCompetition(
      battleMode,
      activeTeamPokemon,
      activeTeam.name,
    )
    const battleModeName = battleMode === 'league' ? '8인 리그전' : '128강 토너먼트'

    setCompetition(nextCompetition)
    setBattleMatch(null)
    setScreen('competition')
    gameAudioRef.current?.playEvent('competition')
    showNotice(`${activeTeam.name}으로 ${battleModeName} 참가 등록을 완료했습니다.`)
  }

  const startCompetitionBattle = (selectedCaptureIds = []) => {
    const currentMatch = getCurrentCompetitionMatch(competition)
    const opponentTeam = getCompetitionOpponentTeam(competition)

    if (!currentMatch?.opponent || !opponentTeam) {
      gameAudioRef.current?.playEvent('error')
      showNotice('진행할 대진을 찾을 수 없습니다.')
      return
    }

    const rules = currentMatch.rules
    const playerTeam = selectPlayerBattlePokemon(competition.playerTeam, rules, selectedCaptureIds)
    const selectedOpponentPokemon = selectOpponentBattlePokemon(opponentTeam.pokemon, rules)

    setBattleMatch({
      opponent: currentMatch.opponent,
      opponentTeam: { ...opponentTeam, pokemon: selectedOpponentPokemon },
      playerTeam,
      rules,
      competitionLabel: `${competition.mode === 'league' ? '8인 리그전' : '128강 토너먼트'} · ${getCompetitionRoundLabel(competition)}`,
    })
    setScreen('battle')
  }

  const finishCompetitionBattle = (battleSummary) => {
    const playerWon = battleSummary.winner === 'player'
    const reward = playerWon ? (competition.mode === 'league' ? 100 : 150) : 0
    const nextCompetition = resolveCompetitionMatch(
      competition,
      playerWon,
      battleSummary,
    )

    if (reward > 0) {
      const nextVp = vpBalance.current + reward
      vpBalance.current = nextVp
      setVp(nextVp)
      gameAudioRef.current?.playEvent('reward')
      showNotice(`배틀 승리 보상으로 ${reward} VP를 획득했습니다.`)
    }

    setCompetition(nextCompetition)
    setBattleMatch(null)
    setScreen('competition')
  }

  const leaveCompetition = () => {
    setCompetition(null)
    setBattleMatch(null)
    setScreen('battle-select')
  }

  const purchaseBattleItem = (itemId) => {
    const purchase = attemptItemPurchase(vpBalance.current, storedItemInventory.current, itemId)

    if (!purchase.ok) {
      gameAudioRef.current?.playEvent('error')
      if (purchase.reason === 'insufficient-vp') {
        showNotice(`${purchase.item.name} 구매에 ${purchase.shortfall.toLocaleString()} VP가 부족합니다.`)
      } else if (purchase.reason === 'already-owned') {
        showNotice(`${purchase.item.name}은(는) 이미 보유하고 있습니다.`)
      } else {
        showNotice('구매할 수 없는 아이템입니다.')
      }
      return
    }

    vpBalance.current = purchase.balance
    storedItemInventory.current = purchase.inventory
    setVp(purchase.balance)
    setItemInventory(purchase.inventory)
    gameAudioRef.current?.playEvent('purchase')
    showNotice(`${purchase.item.name}을(를) 구매했습니다. · 남은 ${purchase.balance.toLocaleString()} VP`)
  }

  const equipBattleItem = (captureId, itemId) => {
    const targetPokemon = boxPokemon.find((pokemon) => pokemon.captureId === captureId)
    const equipResult = attemptItemEquip(boxPokemon, itemInventory, captureId, itemId)

    if (!equipResult.ok) {
      gameAudioRef.current?.playEvent('error')
      if (equipResult.reason === 'item-unavailable') {
        showNotice(`${equipResult.item.name}은(는) 다른 포켓몬이 사용 중입니다.`)
      } else {
        showNotice('해당 지닌 도구를 장착할 수 없습니다.')
      }
      return
    }

    if (equipResult.unchanged || !targetPokemon) return

    setBoxPokemon(equipResult.pokemon)
    gameAudioRef.current?.playEvent('equip')
    showNotice(
      equipResult.item
        ? `${targetPokemon.name}에게 ${equipResult.item.name}을(를) 지니게 했습니다.`
        : `${targetPokemon.name}의 지닌 도구를 해제했습니다.`,
    )
  }

  const setPokemonTeraType = (captureId, teraType) => {
    const targetPokemon = boxPokemon.find((pokemon) => pokemon.captureId === captureId)

    if (!targetPokemon || !TERA_TYPES.includes(teraType)) {
      gameAudioRef.current?.playEvent('error')
      showNotice('선택할 수 없는 테라타입입니다.')
      return
    }

    if (targetPokemon.teraType === teraType) return

    setBoxPokemon((currentPokemon) => currentPokemon.map((pokemon) => (
      pokemon.captureId === captureId
        ? normalizePokemon({ ...pokemon, teraType })
        : pokemon
    )))
    gameAudioRef.current?.playEvent('equip')
    showNotice(`${targetPokemon.name}의 테라타입을 ${teraType} 타입으로 설정했습니다.`)
  }

  const setPokemonDynamaxMode = (captureId, dynamaxMode) => {
    const targetPokemon = boxPokemon.find((pokemon) => pokemon.captureId === captureId)
    const requestedMode = DYNAMAX_MODES.find((mode) => mode.id === dynamaxMode)

    if (!targetPokemon || !requestedMode) {
      gameAudioRef.current?.playEvent('error')
      showNotice('선택할 수 없는 다이맥스 설정입니다.')
      return
    }

    if (dynamaxMode === 'gigantamax' && !canGigantamax(targetPokemon.speciesId)) {
      gameAudioRef.current?.playEvent('error')
      showNotice(`${targetPokemon.name}은 거다이맥스가 가능한 포켓몬이 아닙니다.`)
      return
    }

    const normalizedMode = normalizeDynamaxMode(dynamaxMode, targetPokemon.speciesId)
    if ((targetPokemon.dynamaxMode ?? 'dynamax') === normalizedMode) return

    setBoxPokemon((currentPokemon) => currentPokemon.map((pokemon) => (
      pokemon.captureId === captureId
        ? normalizePokemon({ ...pokemon, dynamaxMode: normalizedMode })
        : pokemon
    )))
    gameAudioRef.current?.playEvent('equip')
    showNotice(`${targetPokemon.name}의 배틀 거대화 방식을 ${requestedMode.label}로 설정했습니다.`)
  }

  const toggleTeamPokemon = (captureId) => {
    const targetPokemon = boxPokemon.find((pokemon) => pokemon.captureId === captureId)

    if (!targetPokemon || !activeTeam) return

    if (teamIds.includes(captureId)) {
      setTeams((currentTeams) => currentTeams.map((team) => (
        team.id === activeTeam.id
          ? { ...team, pokemonIds: team.pokemonIds.filter((id) => id !== captureId) }
          : team
      )))
      gameAudioRef.current?.playEvent('team')
      showNotice(`${targetPokemon.name}을(를) ${activeTeam.name}에서 뺐습니다.`)
      return
    }

    const targetFamilyKey = getPokemonEvolutionFamilyKey(targetPokemon)
    const sameFamilyPokemon = teamIds
      .map((teamCaptureId) => boxPokemon.find((pokemon) => pokemon.captureId === teamCaptureId))
      .find((pokemon) => pokemon && getPokemonEvolutionFamilyKey(pokemon) === targetFamilyKey)

    if (sameFamilyPokemon) {
      gameAudioRef.current?.playEvent('error')
      showNotice(`${sameFamilyPokemon.name}과(와) 같은 진화 계열은 한 팀에 함께 편성할 수 없습니다.`)
      return
    }

    if (teamIds.length >= BATTLE_TEAM_SIZE) {
      gameAudioRef.current?.playEvent('error')
      showNotice('배틀 팀은 최대 6마리까지 편성할 수 있습니다.')
      return
    }

    setTeams((currentTeams) => currentTeams.map((team) => (
      team.id === activeTeam.id
        ? { ...team, pokemonIds: [...team.pokemonIds, captureId] }
        : team
    )))
    gameAudioRef.current?.playEvent('team')
    showNotice(`${targetPokemon.name}을(를) ${activeTeam.name}에 추가했습니다.`)
  }

  const confirmTeam = () => {
    if (teamIds.length === 0) {
      gameAudioRef.current?.playEvent('error')
      showNotice(`${activeTeam?.name ?? '선택한 팀'}에 넣을 포켓몬을 선택해주세요.`)
      return
    }

    gameAudioRef.current?.playEvent('save')
    showNotice(`${activeTeam.name}을(를) ${teamIds.length}마리 구성으로 저장했습니다.`)
  }

  const autoBuildTeam = () => {
    if (boxPokemon.length === 0) {
      gameAudioRef.current?.playEvent('error')
      showNotice('자동 편성할 포켓몬이 없습니다.')
      return
    }

    const nextTeamIds = getTrainingRosterPokemon(boxPokemon)
      .slice(0, BATTLE_TEAM_SIZE)
      .map((pokemon) => pokemon.captureId)
    setTeams((currentTeams) => currentTeams.map((team) => (
      team.id === activeTeam?.id
        ? { ...team, pokemonIds: nextTeamIds }
        : team
    )))
    gameAudioRef.current?.playEvent('team')
    showNotice(`${activeTeam?.name ?? '선택한 팀'}을(를) ${nextTeamIds.length}마리로 자동 편성했습니다.`)
  }

  const saveTraining = (pokemon) => {
    const profile = getSpeciesProfile(pokemon.speciesId)

    if (profile?.parentSpeciesId) {
      gameAudioRef.current?.playEvent('error')
      showNotice('배틀 기믹 폼은 미리보기 전용입니다. 일반 형태로 돌아온 뒤 저장해주세요.')
      return
    }

    setBoxPokemon((currentPokemon) => currentPokemon.map((entry) => (
      entry.captureId === pokemon.captureId
        ? normalizePokemon(pokemon)
        : entry
    )))
    gameAudioRef.current?.playEvent('save')
    showNotice(`${pokemon.name}의 트레이닝 설정을 저장했습니다.`)
  }

  return (
    <div className={`app-shell${screen === 'hatch' ? ' draw-view' : ''}${screen === 'box' ? ' pc-view' : ''}${screen === 'training' ? ' training-view' : ''}${screen === 'shop' ? ' shop-view' : ''}${screen === 'battle-select' ? ' battle-select-view' : ''}${screen === 'competition' ? ' competition-view' : ''}${screen === 'battle' ? ' battle-view' : ''}`}>
      <div className="ambient ambient-one" aria-hidden="true" />
      <div className="ambient ambient-two" aria-hidden="true" />

      <header className="topbar">
        <div className="brand" aria-label="Champions Arena">
          <span className="brand-mark">
            <img
              src="/assets/brand/champions-arena-emblem.png"
              alt=""
              aria-hidden="true"
              draggable="false"
            />
          </span>
        </div>

        <div className="top-status">
          <button
            className="status-card currency-card"
            type="button"
            onClick={openShop}
          >
            <span className="status-icon status-icon-cyan">
              <Zap size={18} fill="currentColor" />
            </span>
            <span>
              <small>BATTLE POINT</small>
              <strong>{vp.toLocaleString()} <em>VP</em></strong>
            </span>
          </button>

          <button
            className="icon-button"
            type="button"
            aria-label={soundEnabled ? '사운드 끄기' : '사운드 켜기'}
            onClick={toggleSound}
          >
            {soundEnabled ? <Volume2 size={21} /> : <VolumeX size={21} />}
          </button>

          <button
            className="icon-button"
            type="button"
            aria-label="설정"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings size={21} />
          </button>
        </div>
      </header>

      {screen === 'lobby' ? (
      <main className="lobby-layout">
        <aside className="profile-panel glass-panel" aria-label="트레이너 프로필">
          <div className="trainer-card trainer-card-minimal">
            <TrainerSprite
              isPlayer
              playerGender={settings.game.playerGender}
              className="trainer-avatar"
              alt="PLAYER_01 트레이너"
            />
            <div className="trainer-copy">
              <strong>PLAYER_01</strong>
            </div>
          </div>
        </aside>

        <section className="mode-panel glass-panel" aria-labelledby="mode-title">
          <div className="mode-heading">
            <div>
              <span className="section-kicker">BATTLE TERMINAL</span>
              <h2 id="mode-title">플레이 메뉴</h2>
            </div>
          </div>

          <div className="mode-grid">
            {modes.map((mode) => {
              const Icon = mode.icon
              const isSelected = selectedMode === mode.id

              return (
                <button
                  className={`mode-card mode-${mode.id}${isSelected ? ' selected' : ''}`}
                  key={mode.id}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => selectMode(mode)}
                >
                  <span className="mode-shine" aria-hidden="true" />
                  <span className="mode-icon"><Icon size={mode.id === 'start' ? 34 : 25} /></span>
                  <span className="mode-copy">
                    <small>{mode.eyebrow}</small>
                    <strong>{mode.title}</strong>
                    <span>{mode.description}</span>
                  </span>
                  {mode.badge && <span className="mode-badge">{mode.badge}</span>}
                  <ChevronRight className="mode-arrow" size={20} />
                </button>
              )
            })}
          </div>

        </section>
      </main>
      ) : screen === 'battle-select' ? (
        <BattleSelectScreen
          pokemon={boxPokemon}
          teams={teams}
          activeTeamId={activeTeam?.id}
          onBack={returnToLobby}
          onOpenBox={openBoxFromBattleSelect}
          onSelectTeam={selectSavedTeam}
          onStartMode={startBattleMode}
        />
      ) : screen === 'competition' && competition ? (
        <CompetitionScreen
          competition={competition}
          playerGender={settings.game.playerGender}
          onBack={leaveCompetition}
          onRestart={leaveCompetition}
          onStartBattle={startCompetitionBattle}
        />
      ) : screen === 'battle' && competition && battleMatch ? (
        <BattleScreen
          competitionLabel={battleMatch.competitionLabel}
          playerPokemon={battleMatch.playerTeam}
          opponent={battleMatch.opponent}
          opponentTeam={battleMatch.opponentTeam}
          rules={battleMatch.rules}
          soundEnabled={soundEnabled}
          gameSettings={settings.game}
          playerGender={settings.game.playerGender}
          audioSettings={settings.audio}
          onToggleSound={toggleSound}
          onOpenSettings={() => setSettingsOpen(true)}
          onComplete={finishCompetitionBattle}
        />
      ) : screen === 'hatch' ? (
        <HatchScreen
          results={drawResults}
          onBack={returnToLobby}
          onOpenBox={openBox}
          onReset={resetDraw}
        />
      ) : screen === 'training' ? (
        <TrainingScreen
          pokemon={boxPokemon}
          teams={teams}
          activeTeamId={activeTeam?.id}
          onBack={returnToLobby}
          onSave={saveTraining}
          onOpenHatch={enterHatchScreen}
        />
      ) : screen === 'shop' ? (
        <ShopScreen
          balance={vp}
          inventory={itemInventory}
          onBack={returnToLobby}
          onPurchase={purchaseBattleItem}
        />
      ) : (
        <BoxScreen
          pokemon={boxPokemon}
          teams={teams}
          activeTeamId={activeTeam?.id}
          teamIds={teamIds}
          inventory={itemInventory}
          onBack={returnFromBox}
          backLabel={boxReturnScreen === 'battle-select' ? '배틀 선택' : '로비'}
          onEquipItem={equipBattleItem}
          onSetTeraType={setPokemonTeraType}
          onSetDynamaxMode={setPokemonDynamaxMode}
          onSelectTeam={selectSavedTeam}
          onToggleTeam={toggleTeamPokemon}
          onAutoTeam={autoBuildTeam}
          onConfirmTeam={confirmTeam}
          onOpenHatch={enterHatchScreen}
          onOpenShop={openShop}
        />
      )}

      {settingsOpen && (
        <SettingsModal
          settings={settings}
          onChange={updateSetting}
          onClose={() => setSettingsOpen(false)}
          onReset={resetSettings}
        />
      )}

      <div className={`toast${notice ? ' visible' : ''}`} role="status" aria-live="polite">
        <Sparkles size={17} />
        <span>{notice}</span>
      </div>
    </div>
  )
}

export default App
