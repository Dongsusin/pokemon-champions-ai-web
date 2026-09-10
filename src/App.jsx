import { useEffect, useRef, useState } from 'react'
import {
  Boxes,
  ChevronRight,
  Dumbbell,
  PawPrint,
  RotateCw,
  Settings,
  ShoppingBag,
  Smartphone,
  Sparkles,
  Swords,
  Trophy,
  Volume2,
  VolumeX,
  Zap,
} from 'lucide-react'
import BattleSelectScreen from './BattleSelectScreen'
import BattleScreen from './BattleScreen'
import AchievementsScreen from './AchievementsScreen'
import { applyBattleAchievements } from './data/achievementData'
import { loadAchievementWallet, saveAchievementWallet } from './data/achievementStorage'
import BoxScreen from './BoxScreen'
import CompetitionScreen from './CompetitionScreen'
import HatchScreen from './HatchScreen'
import LobbyTeamPanel from './LobbyTeamPanel'
import SettingsModal from './SettingsModal'
import ShopScreen from './ShopScreen'
import TrainingScreen from './TrainingScreen'
import LoginScreen, { AuthLoadingScreen } from './LoginScreen'
import { useAuth } from './auth/AuthProvider'
import { useAccountGameData } from './auth/useAccountGameData'
import { createGameAudio } from './gameAudio'
import {
  SETTINGS_STORAGE_KEY,
  createDefaultGameSettings,
  loadGameSettings,
  normalizeGameSettings,
} from './gameSettings'
import {
  createPokemonDraw,
  getDrawBanner,
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
  isSavablePokemonForm,
  normalizeDynamaxMode,
  normalizePokemon,
} from './data/trainingData'
import { getTrainingCostBreakdown } from './data/trainingCosts'
import {
  attemptItemEquip,
  attemptItemPurchase,
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
  getAiBattleDifficultyLabel,
  selectPlayerBattlePokemon,
} from './data/battleRules'
import { selectCounterBattlePokemon } from './data/aiTeamSelection'
import { requestLandscapeMode } from './mobileViewport'

const BOX_STORAGE_KEY = 'champions-dex-v2'
const LEGACY_BOX_STORAGE_KEY = 'champions-box-v1'
const TEAMS_STORAGE_KEY = 'champions-teams-v1'
const TEAM_STORAGE_KEY = 'champions-team-v2'
const LEGACY_TEAM_STORAGE_KEY = 'champions-team-v1'
const ITEM_STORAGE_KEY = 'champions-battle-items-v1'
const DRAW_TUTORIAL_STORAGE_KEY = 'champions-draw-tutorial-v1'
const STANDARD_DRAW_PRICE = getDrawBanner('standard').price

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
  const obtainedPokemon = storedPokemon.filter((pokemon) => (
    pokemon?.directDrawCount === undefined
    || Math.max(0, Number(pokemon.directDrawCount) || 0) > 0
  ))

  return migratePokemonCollection(obtainedPokemon)
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

function loadStoredItems() {
  try {
    const storedItems = window.localStorage.getItem(ITEM_STORAGE_KEY)
    return normalizeItemInventory(storedItems ? JSON.parse(storedItems) : {})
  } catch {
    return {}
  }
}

function shouldStartDrawTutorial(collection, balance) {
  try {
    return collection.length === 0
      && balance >= STANDARD_DRAW_PRICE
      && window.localStorage.getItem(DRAW_TUTORIAL_STORAGE_KEY) !== 'complete'
  } catch {
    return false
  }
}

function saveDrawTutorialCompletion() {
  try {
    window.localStorage.setItem(DRAW_TUTORIAL_STORAGE_KEY, 'complete')
  } catch {}
}

const modes = [
  {
    id: 'start',
    eyebrow: 'START BATTLE',
    title: '시작하기',
    description: 'AI와 배틀 시작',
    icon: Swords,
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
  {
    id: 'achievements',
    eyebrow: 'ACHIEVEMENTS',
    title: '업적',
    description: '도전 달성과 VP 보상',
    icon: Trophy,
  },
]

function GameApp({
  user,
  accountError,
  authBusy,
  autoLogin,
  onAutoLoginChange,
  onConnectGoogle,
  onDeleteAccount,
  onPlayerDataChanged,
  onSignOut,
}) {
  const initialCollection = useRef(null)
  if (initialCollection.current === null) initialCollection.current = loadStoredBox()
  const initialTeamState = useRef(null)
  if (initialTeamState.current === null) initialTeamState.current = loadStoredTeamState(initialCollection.current)
  const initialAchievementWallet = useRef(null)
  if (initialAchievementWallet.current === null) initialAchievementWallet.current = loadAchievementWallet()
  const achievementProgressRef = useRef(initialAchievementWallet.current.progress)
  const vpBalance = useRef(null)
  if (vpBalance.current === null) vpBalance.current = initialAchievementWallet.current.balance
  const storedItemInventory = useRef(null)
  if (storedItemInventory.current === null) storedItemInventory.current = loadStoredItems()
  const initialDrawTutorialStep = useRef(undefined)
  if (initialDrawTutorialStep.current === undefined) {
    initialDrawTutorialStep.current = shouldStartDrawTutorial(initialCollection.current, vpBalance.current)
      ? 'draw'
      : null
  }

  const [screen, setScreen] = useState(initialDrawTutorialStep.current ? 'hatch' : 'lobby')
  const [selectedMode, setSelectedMode] = useState(initialDrawTutorialStep.current ? 'hatch' : 'start')
  const [boxReturnScreen, setBoxReturnScreen] = useState('lobby')
  const [achievementReturnScreen, setAchievementReturnScreen] = useState('lobby')
  const [drawResults, setDrawResults] = useState([])
  const [drawTutorialStep, setDrawTutorialStep] = useState(initialDrawTutorialStep.current)
  const [boxPokemon, setBoxPokemon] = useState(initialCollection.current)
  const [teams, setTeams] = useState(initialTeamState.current.teams)
  const [activeTeamId, setActiveTeamId] = useState(initialTeamState.current.activeTeamId)
  const [vp, setVp] = useState(vpBalance.current)
  const [achievementProgress, setAchievementProgress] = useState(achievementProgressRef.current)
  const [battleRewards, setBattleRewards] = useState(null)
  const resolvedCompetitionRef = useRef(null)
  const settledBattleRef = useRef(null)
  const finishedBattleRef = useRef(null)
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
  const isGuest = Boolean(user.isLocalGuest)
  const trainerName = user.displayName?.trim()
    || user.email?.split('@')[0]
    || (isGuest ? '게스트 트레이너' : '트레이너')
  const trainerInitial = Array.from(trainerName)[0]?.toUpperCase() ?? 'T'

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
      saveAchievementWallet(achievementProgress, vp)
    } catch {}
  }, [vp, achievementProgress])

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
    onPlayerDataChanged?.()
  }, [
    activeTeamId,
    achievementProgress,
    boxPokemon,
    drawTutorialStep,
    itemInventory,
    onPlayerDataChanged,
    settings,
    teams,
    vp,
  ])

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

  const createAndStoreDraw = (bannerId = 'standard') => {
    const drawTimestamp = Date.now()
    const banner = getDrawBanner(bannerId, drawTimestamp)

    if (vp < banner.price) {
      showNotice(`${banner.title}에 필요한 ${(banner.price - vp).toLocaleString()} VP가 부족합니다.`)
      return false
    }

    const nextResults = createPokemonDraw(10, boxPokemon, Math.random, {
      bannerId: banner.id,
      now: drawTimestamp,
    })
    const mergedDraw = mergePokemonDraws(boxPokemon, nextResults)
    const nextBalance = vp - banner.price + mergedDraw.duplicateRefundVp

    setDrawResults(mergedDraw.results)
    setBoxPokemon(mergedDraw.collection)
    vpBalance.current = nextBalance
    setVp(nextBalance)
    if (drawTutorialStep === 'draw' && banner.id === 'standard') setDrawTutorialStep('hatch')
    gameAudioRef.current?.playEvent(mergedDraw.shinyCount > 0 ? 'shiny' : 'draw')
    return true
  }

  const enterHatchScreen = () => {
    setDrawResults([])
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

    if (mode.id === 'achievements') {
      setAchievementReturnScreen('lobby')
      setScreen('achievements')
      return
    }

  }

  const returnToLobby = () => {
    setScreen('lobby')
  }

  const returnFromHatch = () => {
    if (drawTutorialStep) {
      saveDrawTutorialCompletion()
      setDrawTutorialStep(null)
    }
    returnToLobby()
  }

  const completeDrawTutorial = (pokemon) => {
    if (drawTutorialStep !== 'hatch') return
    saveDrawTutorialCompletion()
    setDrawTutorialStep(null)
    gameAudioRef.current?.playEvent('reward')
    showNotice(`${pokemon.name}과(와) 첫 파트너가 되었습니다.`)
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

  const openAchievements = () => {
    if (screen === 'achievements') return
    setAchievementReturnScreen(screen)
    setSelectedMode('achievements')
    setScreen('achievements')
  }

  const selectSavedTeam = (teamId) => {
    if (!teams.some((team) => team.id === teamId)) return
    setActiveTeamId(teamId)
  }

  const startBattleMode = (battleMode, aiDifficulty = 'normal') => {
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
      aiDifficulty,
    )
    const battleModeName = battleMode === 'league' ? '8인 리그전' : '128강 토너먼트'

    setCompetition(nextCompetition)
    setBattleMatch(null)
    setBattleRewards(null)
    resolvedCompetitionRef.current = null
    settledBattleRef.current = null
    finishedBattleRef.current = null
    setScreen('competition')
    gameAudioRef.current?.playEvent('competition')
    showNotice(`${activeTeam.name}으로 ${battleModeName} 참가 완료 · AI ${getAiBattleDifficultyLabel(nextCompetition.aiDifficulty)}`)
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
    const selectedOpponentPokemon = selectCounterBattlePokemon(opponentTeam.pokemon, playerTeam, rules)

    setBattleMatch({
      id: `${competition.id}:${competition.round}:${currentMatch.opponent.id}`,
      opponent: currentMatch.opponent,
      opponentTeam: { ...opponentTeam, pokemon: selectedOpponentPokemon },
      playerTeam,
      rules,
      competitionLabel: `${competition.mode === 'league' ? '8인 리그전' : '128강 토너먼트'} · ${getCompetitionRoundLabel(competition)}`,
    })
    setBattleRewards(null)
    resolvedCompetitionRef.current = null
    settledBattleRef.current = null
    setScreen('battle')
  }

  const settleCompetitionBattle = (battleSummary) => {
    if (!competition || !battleMatch) return null
    if (settledBattleRef.current?.battleId === battleMatch.id) return settledBattleRef.current
    const forfeited = battleSummary.forfeited === true
    if (!forfeited && !battleSummary.achievementFacts?.completed) return null
    const playerWon = battleSummary.winner === 'player'
    if (resolvedCompetitionRef.current?.battleId !== battleMatch.id) {
      resolvedCompetitionRef.current = {
        battleId: battleMatch.id,
        nextCompetition: resolveCompetitionMatch(competition, playerWon, battleSummary),
      }
    }
    // A failed storage write can be retried without rerolling the other AI matches.
    const { nextCompetition } = resolvedCompetitionRef.current
    const result = applyBattleAchievements(achievementProgressRef.current, {
      battleId: battleMatch.id,
      summary: battleSummary,
      opponent: battleMatch.opponent,
      competitionMode: competition.mode,
      competitionChampion: nextCompetition.status === 'complete' && nextCompetition.championId === 'player',
      competitionPerfect: nextCompetition.mode === 'league' && nextCompetition.status === 'complete'
        && nextCompetition.standings?.player?.wins === 7 && nextCompetition.standings?.player?.losses === 0,
      forfeited,
    })
    const baseVp = result.processed && playerWon && !forfeited ? (competition.mode === 'league' ? 100 : 150) : 0
    const rewardVp = result.rewardVp
    const nextVp = vpBalance.current + baseVp + rewardVp
    try {
      saveAchievementWallet(result.state, nextVp)
    } catch {
      gameAudioRef.current?.playEvent('error')
      showNotice('보상을 저장하지 못했습니다. 저장 공간을 확인한 뒤 배틀 마치기를 다시 눌러주세요.')
      return null
    }
    const settled = { battleId: battleMatch.id, nextCompetition, unlocked: result.unlocked, rewardVp, baseVp }
    settledBattleRef.current = settled
    achievementProgressRef.current = result.state
    vpBalance.current = nextVp
    setAchievementProgress(result.state)
    setVp(nextVp)
    setBattleRewards(settled)
    onPlayerDataChanged?.()
    if (baseVp + rewardVp > 0) {
      gameAudioRef.current?.playEvent('reward')
    }
    return settled
  }

  const finishCompetitionBattle = (battleSummary) => {
    if (!battleMatch || finishedBattleRef.current === battleMatch.id) return
    const settlement = settleCompetitionBattle(battleSummary)
    if (!settlement) return
    finishedBattleRef.current = battleMatch.id
    const { nextCompetition, baseVp, rewardVp, unlocked } = settlement
    if (baseVp + rewardVp > 0) showNotice(unlocked.length
      ? `업적 ${unlocked.length}개 달성! 보상 합계 ${(baseVp + rewardVp).toLocaleString()} VP 지급 완료`
      : `배틀 승리 보상 ${baseVp} VP 지급 완료`)
    setBattleMatch(null)

    if (nextCompetition.status !== 'active') {
      setCompetition(null)
      setScreen('lobby')
      return
    }

    setCompetition(nextCompetition)
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

    if (profile?.parentSpeciesId && !isSavablePokemonForm(profile)) {
      gameAudioRef.current?.playEvent('error')
      showNotice('배틀 중에만 변하는 폼은 미리보기 전용입니다. 저장 가능한 폼을 선택해주세요.')
      return false
    }

    const savedPokemon = boxPokemon.find((entry) => entry.captureId === pokemon.captureId)
    if (!savedPokemon) {
      gameAudioRef.current?.playEvent('error')
      showNotice('트레이닝할 포켓몬을 찾을 수 없습니다.')
      return false
    }

    const normalizedPokemon = normalizePokemon(pokemon)
    const trainingCost = getTrainingCostBreakdown(normalizePokemon(savedPokemon), normalizedPokemon)

    if (trainingCost.total > vpBalance.current) {
      const shortfall = trainingCost.total - vpBalance.current
      gameAudioRef.current?.playEvent('error')
      showNotice(`트레이닝에 필요한 ${shortfall.toLocaleString()} VP가 부족합니다.`)
      return false
    }

    const nextVp = vpBalance.current - trainingCost.total
    vpBalance.current = nextVp

    setBoxPokemon((currentPokemon) => currentPokemon.map((entry) => (
      entry.captureId === pokemon.captureId
        ? normalizedPokemon
        : entry
    )))
    setVp(nextVp)
    gameAudioRef.current?.playEvent('save')
    showNotice(trainingCost.total === 0
      ? `${normalizedPokemon.name} 설정 저장 완료 · 이로치 색상 전환 무료`
      : `${normalizedPokemon.name} 트레이닝 완료 · ${trainingCost.total.toLocaleString()} VP 사용 · 남은 ${nextVp.toLocaleString()} VP`)
    return true
  }

  return (
    <div className={`app-shell${screen === 'hatch' ? ' draw-view' : ''}${screen === 'box' ? ' pc-view' : ''}${screen === 'training' ? ' training-view' : ''}${screen === 'shop' ? ' shop-view' : ''}${screen === 'achievements' ? ' achievement-view' : ''}${screen === 'battle-select' ? ' battle-select-view' : ''}${screen === 'competition' ? ' competition-view' : ''}${screen === 'battle' ? ' battle-view' : ''}`}>
      <div className="ambient ambient-one" aria-hidden="true" />
      <div className="ambient ambient-two" aria-hidden="true" />

      <header className="topbar">
        <div className="brand" aria-label="Pokémon Champions Arena">
          <span className="brand-mark">
            <img
              src="/assets/brand/champions-arena-emblem.png"
              alt=""
              aria-hidden="true"
              draggable="false"
            />
          </span>
          <span className="brand-title" aria-hidden="true">
            <small>Pokémon</small>
            <strong>Champions Arena</strong>
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

          <div
            className={`player-account${accountError ? ' sync-error' : ''}`}
            title={accountError || user.email || trainerName}
          >
            <span className="player-account-avatar">
              {user.photoURL ? <img src={user.photoURL} alt="" referrerPolicy="no-referrer" /> : trainerInitial}
            </span>
            <span className="player-account-copy">
              <small>{accountError ? 'SYNC ERROR' : isGuest ? 'GUEST TRAINER' : 'GOOGLE TRAINER'}</small>
              <strong>{trainerName}</strong>
            </span>
          </div>

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

          {screen !== 'battle' && <button className="icon-button" type="button" aria-label="업적 보기" onClick={openAchievements}>
            <Trophy size={21} />
          </button>}

        </div>
      </header>

      {screen === 'lobby' ? (
      <main className="lobby-layout">
        <LobbyTeamPanel
          pokemon={boxPokemon}
          teams={teams}
          activeTeamId={activeTeam?.id}
          onSelectTeam={selectSavedTeam}
          onOpenBox={openBox}
        />

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
          onResolved={settleCompetitionBattle}
          battleRewards={battleRewards}
          onComplete={finishCompetitionBattle}
        />
      ) : screen === 'hatch' ? (
        <HatchScreen
          balance={vp}
          results={drawResults}
          tutorialStep={drawTutorialStep}
          onBack={returnFromHatch}
          onDraw={createAndStoreDraw}
          onOpenBox={openBox}
          onTutorialComplete={completeDrawTutorial}
        />
      ) : screen === 'training' ? (
        <TrainingScreen
          balance={vp}
          pokemon={boxPokemon}
          teams={teams}
          activeTeamId={activeTeam?.id}
          onBack={returnToLobby}
          onSave={saveTraining}
          onOpenHatch={enterHatchScreen}
        />
      ) : screen === 'achievements' ? (
        <AchievementsScreen progress={achievementProgress} balance={vp} onBack={() => setScreen(achievementReturnScreen)} />
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
          user={user}
          accountError={accountError}
          authBusy={authBusy}
          autoLogin={autoLogin}
          onAutoLoginChange={onAutoLoginChange}
          onConnectGoogle={onConnectGoogle}
          onDeleteAccount={onDeleteAccount}
          onChange={updateSetting}
          onClose={() => setSettingsOpen(false)}
          onReset={resetSettings}
          onSignOut={onSignOut}
        />
      )}

      <div className={`toast${notice ? ' visible' : ''}`} role="status" aria-live="polite">
        <Sparkles size={17} />
        <span>{notice}</span>
      </div>
    </div>
  )
}

function LandscapeOrientationGate() {
  const [requestState, setRequestState] = useState('idle')

  const enterLandscapeMode = async () => {
    setRequestState('requesting')
    const changedOrientation = await requestLandscapeMode()
    setRequestState(changedOrientation ? 'complete' : 'manual')
  }

  return (
    <aside className="landscape-orientation-gate" role="alert" aria-labelledby="landscape-orientation-title">
      <div className="landscape-orientation-card">
        <img
          className="landscape-orientation-brand"
          src="/assets/brand/champions-arena-emblem.png"
          alt=""
          aria-hidden="true"
          draggable="false"
        />
        <div className="landscape-orientation-visual" aria-hidden="true">
          <Smartphone className="landscape-orientation-phone" size={66} strokeWidth={1.7} />
          <RotateCw className="landscape-orientation-rotate" size={34} strokeWidth={2.2} />
        </div>
        <span>MOBILE LANDSCAPE MODE</span>
        <h1 id="landscape-orientation-title">기기를 가로로 돌려주세요</h1>
        <p>가로 모드에서 PC와 동일한 챔피언스 아레나 화면을 이용할 수 있습니다.</p>
        <button
          className="landscape-orientation-button"
          type="button"
          disabled={requestState === 'requesting'}
          onClick={enterLandscapeMode}
        >
          <RotateCw size={18} />
          {requestState === 'requesting' ? '가로 화면 전환 중' : '가로 화면으로 시작'}
        </button>
        {requestState === 'manual' && (
          <small>이 브라우저는 자동 회전을 지원하지 않습니다. 기기의 자동 회전을 켠 뒤 가로로 돌려주세요.</small>
        )}
      </div>
    </aside>
  )
}

function App() {
  const {
    user,
    ready,
    busy,
    error,
    profileSyncError,
    configured,
    missingConfiguration,
    autoLogin,
    setAutoLogin,
    signInWithGoogle,
    connectGuestToGoogle,
    signInAsGuest,
    signOut,
    deleteAccount,
  } = useAuth()

  if (!ready) {
    return (
      <>
        <LandscapeOrientationGate />
        <AuthLoadingScreen />
      </>
    )
  }

  if (!user) {
    return (
      <>
        <LandscapeOrientationGate />
        <LoginScreen
          configured={configured}
          busy={busy}
          error={error}
          missingConfiguration={missingConfiguration}
          autoLogin={autoLogin}
          onAutoLoginChange={setAutoLogin}
          onGoogleSignIn={signInWithGoogle}
          onGuestSignIn={signInAsGuest}
        />
      </>
    )
  }

  return (
    <>
      <LandscapeOrientationGate />
      <AccountGameApp
        key={user.uid}
        user={user}
        accountError={profileSyncError || error}
        authBusy={busy}
        autoLogin={autoLogin}
        onAutoLoginChange={setAutoLogin}
        onConnectGoogle={connectGuestToGoogle}
        onDeleteAccount={deleteAccount}
        onSignOut={signOut}
      />
    </>
  )
}

function AccountGameApp({ user, accountError, ...props }) {
  const {
    ready: gameDataReady,
    syncError,
    flush,
    scheduleSave,
  } = useAccountGameData(user)

  if (!gameDataReady) return <AuthLoadingScreen />

  return (
    <GameApp
      key={user.uid}
      {...props}
      user={user}
      accountError={syncError || accountError}
      onPlayerDataChanged={scheduleSave}
      onSignOut={async () => {
        await flush()
        await props.onSignOut?.()
      }}
    />
  )
}

export default App
