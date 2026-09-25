import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  Boxes,
  ChartNoAxesCombined,
  ChevronRight,
  Dumbbell,
  Home,
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
import InstallAppButton from './InstallAppButton'
import BattleHub from './BattleHub'
import RaidScreen from './RaidScreen'
import RankedBattleScreen from './RankedBattleScreen'
import BattleRoomsScreen from './BattleRoomsScreen'
import BattleRoomsTestLobby from './BattleRoomsTestLobby'
import BattleFactoryScreen from './BattleFactoryScreen'
import { loadFactoryRun, saveFactoryRun } from './data/battleFactoryStorage.js'
import { isRankedLocalTest } from './rankedClient'
import BattleScreen from './BattleScreen'
import AchievementsScreen from './AchievementsScreen'
import AchievementToast from './AchievementToast'
import PokemonUsagePanel from './PokemonUsagePanel'
import usePokemonUsage from './usePokemonUsage'
import { creditBattleFactoryVpReward, creditRankedVpRewards, loadAchievementWallet, saveAchievementWallet } from './data/achievementStorage'
import { prepareAchievementRewards, restoreAchievementRewards } from './data/achievementRewards'
import { applyBossAchievements, applyFactoryAchievements, applyRankedAchievements } from './data/achievementData'
import { getAiBattleVpReward } from './data/aiBattleRewards'
import BoxScreen from './BoxScreen'
import CompetitionScreen from './CompetitionScreen'
import HatchScreen from './HatchScreen'
import LobbyPokemonDetail from './LobbyPokemonDetail'
import { useIsCompactLayout } from './useMobileLayout'
import LobbyTeamPanel from './LobbyTeamPanel'
import SettingsModal from './SettingsModal'
import ShopScreen from './ShopScreen'
import TrainingScreen from './TrainingScreen'
import LoginScreen, { AccountDataErrorScreen, AuthLoadingScreen } from './LoginScreen'
import { AuthProvider, useAuth } from './auth/AuthProvider'
import { useAccountGameData } from './auth/useAccountGameData'
import { hasActiveAccountSession } from './auth/accountSession'
import { maskRankedTrainerName } from './data/rankedPrivacy'
import { createGameAudio } from './gameAudio'
import { applyGameTextScale } from './gameTextScale'
import OnlinePlayersBadge from './OnlinePlayersBadge'
import GlobalChat from './GlobalChat'
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
  canPokemonLearnMove,
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

function loadStoredBox(progress) {
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

function shuffled(entries, random = Math.random) {
  const shuffledEntries = [...entries]

  for (let index = shuffledEntries.length - 1; index > 0; index -= 1) {
    const targetIndex = Math.floor(random() * (index + 1))
    ;[shuffledEntries[index], shuffledEntries[targetIndex]] = [shuffledEntries[targetIndex], shuffledEntries[index]]
  }

  return shuffledEntries
}

/**
 * Auto-build draws a random party so repeated presses keep offering something
 * new. When the box holds more than one party's worth, a draw that repeats the
 * current team swaps one member out, so a press always visibly changes it.
 */
function pickAutoTeamIds(roster, size, currentIds = [], random = Math.random) {
  const candidateIds = roster.map((pokemon) => pokemon.captureId)
  const picked = shuffled(candidateIds, random).slice(0, size)
  const current = new Set(currentIds)
  const unchanged = picked.length === current.size && picked.every((id) => current.has(id))
  if (!unchanged) return picked

  const spares = candidateIds.filter((id) => !current.has(id))
  if (spares.length === 0) return picked

  const replacement = spares[Math.floor(random() * spares.length)]
  const slot = Math.floor(random() * picked.length)
  return picked.map((id, index) => (index === slot ? replacement : id))
}

// Mobile-only bottom navigation. Desktop keeps the existing mode grid and
// per-screen back buttons; the bar is hidden outside the compact layouts.
const MOBILE_TABS = [
  { id: 'lobby', screen: 'lobby', label: '메인', icon: Home },
  { id: 'box', screen: 'box', label: '박스', icon: Boxes },
  { id: 'training', screen: 'training', label: '트레이닝', icon: Dumbbell },
  { id: 'shop', screen: 'shop', label: '상점', icon: ShoppingBag },
  { id: 'achievements', screen: 'achievements', label: '업적', icon: Trophy },
]

const modes = [
  {
    id: 'start',
    eyebrow: 'START BATTLE',
    title: '시작하기',
    description: '레이팅 · AI 대전 선택',
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
  {
    id: 'usage',
    eyebrow: 'POKÉMON USAGE',
    title: '포켓몬 사용률',
    description: 'AI · 레이팅 인기 포켓몬 TOP 100',
    icon: ChartNoAxesCombined,
  },
]

export function GameApp({
  user,
  accountError,
  authBusy,
  autoLogin,
  onAutoLoginChange,
  onConnectGoogle,
  onDeleteAccount,
  onSetNickname,
  onSetTitle,
  onPlayerDataChanged,
  onSyncBeforeRanked,
  onSignOut,
}) {
  const pokemonUsage = usePokemonUsage(user)
  const initialAchievementWallet = useRef(null)
  if (initialAchievementWallet.current === null) initialAchievementWallet.current = loadAchievementWallet()
  const initialRewards = useRef(null)
  if (initialRewards.current === null) initialRewards.current = restoreAchievementRewards(
    initialAchievementWallet.current.progress,
    loadStoredBox(initialAchievementWallet.current.progress), loadStoredItems(),
  )
  const initialCollection = useRef(initialRewards.current.collection)
  const initialTeamState = useRef(null)
  if (initialTeamState.current === null) initialTeamState.current = loadStoredTeamState(initialCollection.current)
  const achievementProgressRef = useRef(initialAchievementWallet.current.progress)
  const vpBalance = useRef(null)
  if (vpBalance.current === null) vpBalance.current = initialAchievementWallet.current.balance
  const storedItemInventory = useRef(null)
  if (storedItemInventory.current === null) storedItemInventory.current = initialRewards.current.inventory
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
  const [lobbyCaptureId, setLobbyCaptureId] = useState(null)
  const [boxPokemon, setBoxPokemon] = useState(initialCollection.current)
  const [teams, setTeams] = useState(initialTeamState.current.teams)
  const [activeTeamId, setActiveTeamId] = useState(initialTeamState.current.activeTeamId)
  const [vp, setVp] = useState(vpBalance.current)
  const [achievementProgress, setAchievementProgress] = useState(achievementProgressRef.current)
  const [battleRewards, setBattleRewards] = useState(null)
  const [achievementToasts, setAchievementToasts] = useState([])
  const notifiedAchievementIds = useRef(new Set())
  const achievementToastSequence = useRef(0)
  const resolvedCompetitionRef = useRef(null)
  const settledBattleRef = useRef(null)
  const finishedBattleRef = useRef(null)
  const [itemInventory, setItemInventory] = useState(storedItemInventory.current)
  const [settings, setSettings] = useState(loadGameSettings)
  useLayoutEffect(() => { applyGameTextScale(settings.game.textScale) }, [settings.game.textScale])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsInitialTab, setSettingsInitialTab] = useState('game')
  const [settingsOpenId, setSettingsOpenId] = useState(0)
  const [notice, setNotice] = useState('')
  const [competition, setCompetition] = useState(null)
  const [battleMatch, setBattleMatch] = useState(null)
  const [rankedBattleActive, setRankedBattleActive] = useState(false)
  const [bossBattleActive, setBossBattleActive] = useState(false)
  const [selectedBossId, setSelectedBossId] = useState('mewtwo')
  const factoryRestoreError = useRef('')
  const [factoryRun, setFactoryRun] = useState(() => {
    try { return loadFactoryRun() }
    catch { factoryRestoreError.current = '팩토리 저장 기록을 읽지 못했습니다. 기존 기록은 보존했습니다. 저장 공간을 확인한 후 다시 접속해주세요.'; return null }
  })
  const changeFactoryRun = useCallback(next => {
    saveFactoryRun(next)
    setFactoryRun(next)
    onPlayerDataChanged?.()
  }, [onPlayerDataChanged])
  const noticeTimer = useRef(null)
  const gameAudioRef = useRef(null)
  const rankedRewardSyncPending = useRef(false)
  if (!gameAudioRef.current) gameAudioRef.current = createGameAudio(settings.audio.enabled, settings.audio)
  const activeTeam = teams.find((team) => team.id === activeTeamId) ?? teams[0]
  const teamIds = activeTeam?.pokemonIds ?? []
  // The lobby detail column follows the party: an explicit pick wins, and the
  // first filled slot covers the initial render and any team switch.
  const lobbyParty = teamIds
    .map((captureId) => boxPokemon.find((entry) => entry.captureId === captureId))
    .filter(Boolean)
  const lobbyPokemon = lobbyParty.find((entry) => entry.captureId === lobbyCaptureId) ?? lobbyParty[0] ?? null
  const soundEnabled = settings.audio.enabled
  const factoryBattleVisible = screen === 'factory' && factoryRun?.phase === 'battle'
  const battleMusicActive = screen === 'battle' || rankedBattleActive || factoryBattleVisible || bossBattleActive
  const isGuest = Boolean(user.isAnonymous || user.isLocalGuest)
  const accountTrainerName = user.displayName?.trim()
    || user.email?.split('@')[0]
    || (isGuest ? '게스트 트레이너' : '트레이너')
  const trainerName = isGuest ? accountTrainerName : maskRankedTrainerName(accountTrainerName, false, user.nickname)
  const trainerInitial = Array.from(trainerName)[0]?.toUpperCase() ?? 'T'
  const onlineScreen = screen === 'ranked' || screen === 'rooms'
  // The draw tutorial and every in-battle surface own the full canvas, so the
  // mobile tab bar stays out of them. Desktop renders no bar at all rather
  // than relying on a stylesheet to hide it.
  const compactLayout = useIsCompactLayout()
  const mobileTabsVisible = compactLayout && !battleMusicActive && !drawTutorialStep
    && !['battle', 'competition', 'hatch'].includes(screen)
  const displayedTrainerName = trainerName

  const receiveRankedVpRewards = useCallback(async rewards => {
    if (user.isLocalGuest || !hasActiveAccountSession(user.uid)) {
      throw new Error('계정 연결을 확인한 뒤 레이팅 보상을 다시 받아주세요.')
    }
    const result = creditRankedVpRewards(achievementProgressRef.current, vpBalance.current, rewards, user.uid)
    if (result.granted > 0) {
      vpBalance.current = result.balance
      setVp(result.balance)
      rankedRewardSyncPending.current = true
      onPlayerDataChanged?.()
    }
    if (rankedRewardSyncPending.current) {
      if (onSyncBeforeRanked && await onSyncBeforeRanked() === false) {
        throw new Error('VP는 이 기기에 지급됐습니다. 계정 저장을 다시 시도해주세요.')
      }
      rankedRewardSyncPending.current = false
    }
    return result
  }, [user.uid, user.isLocalGuest, onPlayerDataChanged, onSyncBeforeRanked])

  const receiveFactoryVpReward = result => {
    let credited
    try {
      credited = creditBattleFactoryVpReward(achievementProgressRef.current, vpBalance.current,
        { ...result, uid: user.uid }, user.uid)
    } catch (error) {
      showNotice('팩토리 VP를 저장하지 못했습니다. 저장 공간을 확인한 뒤 배틀 마치기를 다시 눌러주세요.')
      throw error
    }
    if (credited.granted > 0) {
      vpBalance.current = credited.balance
      setVp(credited.balance)
      onPlayerDataChanged?.()
      showNotice(`배틀팩토리 ${result.floor}층 승리 보상 ${credited.granted.toLocaleString()} VP 지급 완료`)
      gameAudioRef.current?.playEvent('reward')
    }
    settleFactoryAchievements(result.floor, result.mode)
    return credited
  }

  // Both ladders settle the same way: report the best result seen so far and
  // let the achievement record decide whether that is new. Reporting a record
  // the player already held is a no-op, so a stored best earned before this
  // update still unlocks its achievement the first time it is observed.
  function settleLadderAchievements(result) {
    if (!result.processed) return true
    const nextVp = vpBalance.current + result.rewardVp
    try {
      saveAchievementWallet(result.state, nextVp)
    } catch {
      showNotice('업적을 저장하지 못했습니다. 잠시 후 다시 시도합니다.')
      return false
    }
    achievementProgressRef.current = result.state
    vpBalance.current = nextVp
    setAchievementProgress(result.state)
    setVp(nextVp)
    if (result.unlocked.length > 0) {
      enqueueAchievementToasts(result.unlocked)
      gameAudioRef.current?.playEvent('reward')
    }
    onPlayerDataChanged?.()
    return true
  }

  const settleBossAchievements = useCallback(event => {
    return settleLadderAchievements(applyBossAchievements(achievementProgressRef.current, event))
  }, [onPlayerDataChanged])

  const settleFactoryAchievements = useCallback((floor, mode) => {
    settleLadderAchievements(applyFactoryAchievements(achievementProgressRef.current, floor, Date.now(), mode))
  }, [onPlayerDataChanged])

  const settleRankedAchievements = useCallback(points => {
    settleLadderAchievements(applyRankedAchievements(achievementProgressRef.current, points))
  }, [onPlayerDataChanged])

  function enqueueAchievementToasts(unlocked) {
    const fresh = unlocked.filter((definition) => {
      if (notifiedAchievementIds.current.has(definition.id)) return false
      notifiedAchievementIds.current.add(definition.id)
      return true
    })
    if (fresh.length === 0) return
    const id = `achievement-${++achievementToastSequence.current}`
    setAchievementToasts(current => [...current, { id, unlocked: fresh }])
  }

  function dismissAchievementToast(id) {
    setAchievementToasts(current => current[0]?.id === id ? current.slice(1) : current)
  }

  function openSettings(tab = 'game') {
    setSettingsInitialTab(tab)
    setSettingsOpenId(current => current + 1)
    setSettingsOpen(true)
  }

  useEffect(() => {
    const result = prepareAchievementRewards(achievementProgressRef.current, boxPokemon, storedItemInventory.current)
    if (!result.progressChanged) return
    const nextVp = vpBalance.current + result.rewardVp
    try {
      saveAchievementWallet(result.state, nextVp)
    } catch {
      showNotice('수집 업적을 저장하지 못했습니다. 업적 화면을 다시 열면 재시도합니다.')
      return
    }
    achievementProgressRef.current = result.state
    vpBalance.current = nextVp
    storedItemInventory.current = result.inventory
    setAchievementProgress(result.state)
    setVp(nextVp)
    if (result.collection !== boxPokemon) setBoxPokemon(result.collection)
    setItemInventory(result.inventory)
    if (result.unlocked.length > 0) {
      enqueueAchievementToasts(result.unlocked)
      gameAudioRef.current?.playEvent('reward')
    }
    onPlayerDataChanged?.()
  }, [boxPokemon, screen, onPlayerDataChanged])

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
    gameAudioRef.current?.setScene(battleMusicActive ? null : 'menu')
  }, [battleMusicActive])

  useEffect(() => {
    if (battleMusicActive) return undefined

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
  }, [battleMusicActive])

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
    if (achievementProgress !== achievementProgressRef.current || vp !== vpBalance.current) return
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
      setScreen('battle-hub')
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

    if (mode.id === 'usage') {
      setScreen('usage')
      return
    }

  }

  const returnToLobby = () => {
    setScreen('lobby')
  }

  const openMobileTab = (tab) => {
    if (screen === tab.screen) return
    if (tab.screen === 'box') setBoxReturnScreen('lobby')
    if (tab.screen === 'achievements') setAchievementReturnScreen('lobby')
    if (tab.screen !== 'lobby') setSelectedMode(tab.id === 'box' ? 'collection' : tab.id)
    setScreen(tab.screen)
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

  const openBoxFromRanked = () => {
    setBoxReturnScreen('ranked')
    setScreen('box')
  }

  const openBoxFromRooms = () => {
    setBoxReturnScreen('rooms')
    setScreen('box')
  }

  const openBoxFromBoss = () => {
    setBoxReturnScreen('raid')
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

  const startBattleMode = (battleMode, aiDifficulty = 'normal', battleFormat = 'single') => {
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
      Math.random,
      battleFormat,
      trainerName,
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

    const usageBattleId = `${competition.id}:${competition.round}:${currentMatch.opponent.id}`
    setBattleMatch({
      id: usageBattleId,
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
    if (!pokemonUsage.recordAiBattle({ battleId: usageBattleId, format: rules.format.id,
      speciesIds: playerTeam.map(pokemon => pokemon.speciesId),
      team: playerTeam.map(pokemon => ({ speciesId: pokemon.speciesId, heldItemId: pokemon.heldItemId || null })) })) {
      showNotice('대전은 시작됐지만 사용률 기록을 저장하지 못했습니다. 사용률 창의 집계 알림을 확인해주세요.')
    }
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
    const result = prepareAchievementRewards(achievementProgressRef.current, boxPokemon, storedItemInventory.current, {
      battleId: battleMatch.id,
      summary: battleSummary,
      opponent: battleMatch.opponent,
      competitionMode: competition.mode,
      competitionRun: nextCompetition.achievementRun,
      competitionChampion: nextCompetition.status === 'complete' && nextCompetition.championId === 'player',
      competitionPerfect: nextCompetition.mode === 'league' && nextCompetition.status === 'complete'
        && nextCompetition.standings?.player?.wins === 7 && nextCompetition.standings?.player?.losses === 0,
      forfeited,
    })
    const baseVp = getAiBattleVpReward({ mode: competition.mode, battleProcessed: result.battleProcessed, playerWon, forfeited })
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
    storedItemInventory.current = result.inventory
    setItemInventory(result.inventory)
    if (result.collection !== boxPokemon) setBoxPokemon(result.collection)
    setVp(nextVp)
    setBattleRewards(settled)
    enqueueAchievementToasts(result.unlocked)
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
    if (baseVp + rewardVp > 0 && unlocked.length === 0) showNotice(`배틀 승리 보상 ${baseVp} VP 지급 완료`)
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
    const equipResult = attemptItemEquip(boxPokemon, itemInventory, captureId, itemId, teamIds)

    if (!equipResult.ok) {
      gameAudioRef.current?.playEvent('error')
      if (equipResult.reason === 'item-unavailable') {
        showNotice(`${equipResult.item.name}은(는) 현재 팀의 다른 포켓몬이 사용 중입니다.`)
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

  const reorderTeamPokemon = (fromIndex, toIndex) => {
    const teamId = activeTeam?.id
    if (!teamId || !Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) return

    setTeams((currentTeams) => currentTeams.map((team) => {
      if (team.id !== teamId || fromIndex === toIndex
        || fromIndex < 0 || toIndex < 0
        || fromIndex >= team.pokemonIds.length || toIndex >= team.pokemonIds.length) return team

      const pokemonIds = [...team.pokemonIds]
      const [movedId] = pokemonIds.splice(fromIndex, 1)
      pokemonIds.splice(toIndex, 0, movedId)
      return { ...team, pokemonIds }
    }))
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

    const nextTeamIds = pickAutoTeamIds(
      getTrainingRosterPokemon(boxPokemon, { includeDirectDraws: false }),
      BATTLE_TEAM_SIZE,
      activeTeam?.pokemonIds ?? [],
    )
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

    if (!Array.isArray(pokemon.moves) || !pokemon.moves.some((move) => canPokemonLearnMove(pokemon.speciesId, move))) {
      gameAudioRef.current?.playEvent('error')
      showNotice('최소 1개의 기술은 반드시 설정해야 합니다.')
      return false
    }

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
      ? `${normalizedPokemon.name} 설정 저장 완료 · 외형 변경 무료`
      : `${normalizedPokemon.name} 트레이닝 완료 · ${trainingCost.total.toLocaleString()} VP 사용 · 남은 ${nextVp.toLocaleString()} VP`)
    return true
  }

  return (
    <div className={`app-shell${screen === 'hatch' ? ' draw-view' : ''}${screen === 'box' ? ' pc-view' : ''}${screen === 'training' ? ' training-view' : ''}${screen === 'shop' ? ' shop-view' : ''}${screen === 'achievements' ? ' achievement-view' : ''}${screen === 'battle-select' ? ' battle-select-view' : ''}${screen === 'ranked' ? ' ranked-view' : ''}${screen === 'rooms' ? ' rooms-view ranked-view' : ''}${screen === 'factory' ? ' factory-view' : ''}${screen === 'raid' && !bossBattleActive ? ' raid-view' : ''}${screen === 'competition' ? ' competition-view' : ''}${battleMusicActive ? ' battle-view' : ''}`}>
      <div className="ambient ambient-one" aria-hidden="true" />
      <div className="ambient ambient-two" aria-hidden="true" />

      <header className={`topbar${!battleMusicActive ? ' has-online-players has-global-chat' : ''}`}>
        <div className="topbar-brand-group">
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

          {!battleMusicActive && <OnlinePlayersBadge userId={user.uid} />}
        </div>

        {!battleMusicActive && <GlobalChat key={user.uid} user={user} />}

        <div className="top-status">
          <button
            className="status-card currency-card"
            type="button"
            disabled={onlineScreen}
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
            title={accountError || displayedTrainerName}
          >
            <span className="player-account-avatar">
              {user.photoURL ? <img src={user.photoURL} alt="" referrerPolicy="no-referrer" /> : trainerInitial}
            </span>
            <span className="player-account-copy">
              <small>{accountError ? 'SYNC ERROR' : isGuest ? 'GUEST TRAINER' : 'GOOGLE TRAINER'}</small>
              <strong>{displayedTrainerName}</strong>
            </span>
          </div>

          <InstallAppButton />

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
            onClick={() => openSettings()}
          >
            <Settings size={21} />
          </button>

          {!battleMusicActive && !onlineScreen && <button className="icon-button" type="button" aria-label="업적 보기" onClick={openAchievements}>
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
          selectedCaptureId={lobbyPokemon?.captureId ?? null}
          onSelectPokemon={setLobbyCaptureId}
          onSelectTeam={selectSavedTeam}
          onOpenBox={openBox}
        />

        <LobbyPokemonDetail pokemon={lobbyPokemon} onOpenTraining={() => setScreen('training')} />

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
      ) : screen === 'battle-hub' ? (
        <BattleHub user={user} onBack={returnToLobby} onSelectAi={() => setScreen('battle-select')} onSelectRanked={() => setScreen('ranked')}
          onSelectFactory={() => setScreen('factory')} onSelectRooms={() => setScreen('rooms')} onSelectRaid={() => setScreen('raid')} />
      ) : screen === 'raid' ? (
        <RaidScreen onBossClear={settleBossAchievements} boxPokemon={boxPokemon} teams={teams} activeTeamId={activeTeam?.id}
          onSelectTeam={selectSavedTeam} onOpenBox={openBoxFromBoss} onBack={() => setScreen('battle-hub')}
          selectedBossId={selectedBossId} onSelectBoss={setSelectedBossId} onExit={returnToLobby} playerName={trainerName}
          soundEnabled={soundEnabled} gameSettings={settings.game} audioSettings={settings.audio}
          onToggleSound={toggleSound} onOpenSettings={() => openSettings()} onBattleActiveChange={setBossBattleActive} />
      ) : screen === 'rooms' ? (
        <BattleRoomsScreen user={user} teams={teams} boxPokemon={boxPokemon} activeTeamId={activeTeam?.id}
          onSelectTeam={selectSavedTeam} onOpenBox={openBoxFromRooms} onBack={() => setScreen('battle-hub')}
          soundEnabled={soundEnabled} gameSettings={settings.game} playerGender={settings.game.playerGender}
          audioSettings={settings.audio} onToggleSound={toggleSound} onOpenSettings={() => openSettings()}
          onBattleActiveChange={setRankedBattleActive} onBeforeJoin={onSyncBeforeRanked} />
      ) : screen === 'ranked' ? (
        <RankedBattleScreen user={user} teams={teams} boxPokemon={boxPokemon} activeTeamId={activeTeam?.id}
          onOpenRooms={() => setScreen('rooms')}
          onSelectTeam={selectSavedTeam} onOpenBox={openBoxFromRanked} onBack={() => setScreen('battle-hub')}
          soundEnabled={soundEnabled} gameSettings={settings.game} playerGender={settings.game.playerGender}
          audioSettings={settings.audio} onToggleSound={toggleSound} onOpenSettings={() => openSettings()}
          onBattleActiveChange={setRankedBattleActive} onBeforeJoin={onSyncBeforeRanked} onVpRewards={receiveRankedVpRewards}
          onRankedPoints={settleRankedAchievements} />
      ) : screen === 'factory' ? (
        <BattleFactoryScreen user={user} run={factoryRun} restoreError={factoryRestoreError.current} onRunChange={changeFactoryRun} onBack={() => setScreen('battle-hub')}
          onVpReward={receiveFactoryVpReward} onFactoryBestFloor={settleFactoryAchievements}
          playerName={trainerName}
          soundEnabled={soundEnabled} gameSettings={settings.game} playerGender={settings.game.playerGender}
          audioSettings={settings.audio} onToggleSound={toggleSound} onOpenSettings={() => openSettings()} />
      ) : screen === 'battle-select' ? (
        <BattleSelectScreen
          pokemon={boxPokemon}
          teams={teams}
          activeTeamId={activeTeam?.id}
          onBack={() => setScreen('battle-hub')}
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
          playerName={trainerName}
          opponent={battleMatch.opponent}
          opponentTeam={battleMatch.opponentTeam}
          rules={battleMatch.rules}
          soundEnabled={soundEnabled}
          gameSettings={settings.game}
          playerGender={settings.game.playerGender}
          audioSettings={settings.audio}
          onToggleSound={toggleSound}
          onOpenSettings={() => openSettings()}
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
          progress={achievementProgress}
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
      ) : screen === 'usage' ? (
        <PokemonUsagePanel usage={pokemonUsage} inventory={itemInventory} onBack={returnToLobby} />
      ) : screen === 'shop' ? (
        <ShopScreen
          progress={achievementProgress}
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
          pokemonUsage={pokemonUsage}
          backLabel={boxReturnScreen === 'battle-select' ? 'AI 대전' : boxReturnScreen === 'ranked' ? '레이팅 배틀' : boxReturnScreen === 'rooms' ? '대전방' : boxReturnScreen === 'raid' ? '보스전' : '로비'}
          onEquipItem={equipBattleItem}
          onSetTeraType={setPokemonTeraType}
          onSetDynamaxMode={setPokemonDynamaxMode}
          onSelectTeam={selectSavedTeam}
          onToggleTeam={toggleTeamPokemon}
          onReorderTeam={reorderTeamPokemon}
          onAutoTeam={autoBuildTeam}
          onConfirmTeam={confirmTeam}
          onOpenHatch={enterHatchScreen}
          onOpenShop={openShop}
        />
      )}

      {mobileTabsVisible && (
        <nav className="mobile-tabbar" aria-label="주요 화면 바로가기">
          {MOBILE_TABS.map((tab) => {
            const Icon = tab.icon
            const isActive = screen === tab.screen

            return (
              <button
                className={`mobile-tabbar-item${isActive ? ' active' : ''}`}
                key={tab.id}
                type="button"
                aria-current={isActive ? 'page' : undefined}
                onClick={() => openMobileTab(tab)}
              >
                <Icon size={19} aria-hidden="true" />
                <small>{tab.label}</small>
              </button>
            )
          })}
        </nav>
      )}

      {achievementToasts[0] && (
        <AchievementToast key={achievementToasts[0].id} notification={achievementToasts[0]}
          onDismiss={() => dismissAchievementToast(achievementToasts[0].id)}
          onOpenAchievements={() => {
            dismissAchievementToast(achievementToasts[0].id)
            openSettings('achievements')
          }} />
      )}

      {settingsOpen && (
        <SettingsModal
          key={settingsOpenId}
          initialTab={settingsInitialTab}
          achievementProgress={achievementProgress}
          balance={vp}
          settings={settings}
          pokemonUsage={pokemonUsage}
          itemInventory={itemInventory}
          user={user}
          accountError={accountError}
          authBusy={authBusy}
          autoLogin={autoLogin}
          onAutoLoginChange={onAutoLoginChange}
          onConnectGoogle={onConnectGoogle}
          onDeleteAccount={onDeleteAccount}
          onSetNickname={onSetNickname}
          onSetTitle={onSetTitle}
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
        <p>기기를 직접 가로로 돌리면 게임 화면이 자동으로 표시됩니다.</p>
        <small>화면이 돌아가지 않으면 기기의 회전 잠금을 해제하거나 자동 회전을 켜주세요.</small>
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
    setNickname,
    setTitle,
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
        onSetNickname={setNickname}
        onSetTitle={setTitle}
        onSignOut={signOut}
      />
    </>
  )
}

function AccountGameApp({ user, accountError, ...props }) {
  const [signingOut, setSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState('')
  const [guestDeletionStarted, setGuestDeletionStarted] = useState(false)
  const isGuest = Boolean(user.isAnonymous || user.isLocalGuest)
  const signOutPending = useRef(false)
  const {
    ready: gameDataReady,
    syncError,
    flush,
    scheduleSave,
    retry,
    pauseForGuestDeletion,
  } = useAccountGameData(user)

  const leaveAccount = async (saveFirst) => {
    if (signOutPending.current) return
    signOutPending.current = true
    setSigningOut(true)
    setSignOutError('')
    try {
      if (isGuest) {
        setGuestDeletionStarted(true)
        await pauseForGuestDeletion()
        if (await props.onSignOut?.() === false) {
          setSignOutError('게스트 정보 삭제를 완료하지 못했습니다. 연결을 확인한 뒤 다시 시도해주세요.')
        }
      } else if (!saveFirst || await flush()) await props.onSignOut?.()
    } catch {
      setSignOutError('로그아웃하지 못했습니다. 다시 시도해 주세요.')
    } finally {
      signOutPending.current = false
      setSigningOut(false)
    }
  }

  if (guestDeletionStarted) {
    if (signingOut || props.authBusy) return <AuthLoadingScreen />
    return <AccountDataErrorScreen message={signOutError || accountError || '게스트 정보 삭제를 다시 시도해주세요.'}
      deletingGuest busy={false} onRetry={() => leaveAccount(false)} onSignOut={() => leaveAccount(false)} />
  }

  if (!gameDataReady && syncError) {
    return <AccountDataErrorScreen message={signOutError || accountError || syncError}
      busy={signingOut || props.authBusy} onRetry={retry} onSignOut={() => leaveAccount(false)} />
  }
  if (!gameDataReady) return <AuthLoadingScreen />

  return (
    <GameApp
      key={user.uid}
      {...props}
      user={user}
      accountError={signOutError || syncError || accountError}
      authBusy={signingOut || props.authBusy}
      onPlayerDataChanged={scheduleSave}
      onSyncBeforeRanked={flush}
      onSignOut={() => leaveAccount(true)}
      onDeleteAccount={isGuest ? () => leaveAccount(false) : props.onDeleteAccount}
    />
  )
}

// A separate development-only entry avoids creating or changing real accounts
// when two browsers exercise the local ranked server.
export function RankedTestApp() {
  const [page, setPage] = useState(() => new URLSearchParams(window.location.search).has('roomPlayer') ? 'rooms' : 'hub')
  const [battleActive, setBattleActive] = useState(false)
  const [factoryRun, setFactoryRun] = useState(null)
  const [sound, setSound] = useState(false)
  const battleVisible = page === 'factory' ? factoryRun?.phase === 'battle' : ['ranked', 'rooms'].includes(page) && battleActive
  if (!isRankedLocalTest) return null
  if (page === 'ai') return <AuthProvider><App /></AuthProvider>
  return <>
    <LandscapeOrientationGate />
    <div className={`app-shell${page === 'factory' ? ' factory-view' : ' ranked-view'}${page === 'rooms' ? ' rooms-view' : ''}${battleVisible ? ' battle-view' : ''}`}>
      {page === 'hub'
        ? <BattleHub onBack={() => setPage('ai')} onSelectAi={() => setPage('ai')} onSelectRanked={() => setPage('ranked')}
            onSelectFactory={() => setPage('factory')} onSelectRooms={() => setPage('rooms')} />
        : page === 'rooms'
          ? <BattleRoomsTestLobby onBack={() => setPage('hub')} onBattleActiveChange={setBattleActive}
              soundEnabled={sound} onToggleSound={() => setSound(value => !value)}
              gameSettings={{ attackAnimation: 'fast', hpBarSpeed: 'fast' }} audioSettings={{ enabled: sound }} />
        : page === 'factory'
          ? <BattleFactoryScreen user={{uid:'ranked-factory-local',displayName:'팩토리 테스트',isLocalGuest:true}} run={factoryRun} onRunChange={setFactoryRun} onBack={() => setPage('hub')}
              soundEnabled={sound} onToggleSound={() => setSound(value => !value)}
              playerGender="male" gameSettings={{ attackAnimation: 'fast', hpBarSpeed: 'fast' }} audioSettings={{ enabled: sound }} />
        : <RankedBattleScreen onBack={() => setPage('hub')} onBattleActiveChange={setBattleActive} onOpenRooms={() => setPage('rooms')}
            soundEnabled={sound} onToggleSound={() => setSound(value => !value)}
            gameSettings={{ attackAnimation: 'fast', hpBarSpeed: 'fast' }} audioSettings={{ enabled: sound }} />}
    </div>
  </>
}

export default App
