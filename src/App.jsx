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
  UserRound,
  Volume2,
  VolumeX,
  Zap,
} from 'lucide-react'
import BoxScreen from './BoxScreen'
import HatchScreen from './HatchScreen'
import ShopScreen from './ShopScreen'
import TrainingScreen from './TrainingScreen'
import {
  createPokemonDraw,
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
  normalizeItemInventory,
} from './data/shopData'

const BOX_STORAGE_KEY = 'champions-dex-v2'
const LEGACY_BOX_STORAGE_KEY = 'champions-box-v1'
const TEAM_STORAGE_KEY = 'champions-team-v2'
const LEGACY_TEAM_STORAGE_KEY = 'champions-team-v1'
const VP_STORAGE_KEY = 'champions-vp-v1'
const ITEM_STORAGE_KEY = 'champions-battle-items-v1'

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
  return migratePokemonCollection(storedPokemon)
}

function loadStoredTeam(collection) {
  const hasCurrentTeam = window.localStorage.getItem(TEAM_STORAGE_KEY) !== null
  const storedTeam = hasCurrentTeam
    ? loadStoredArray(TEAM_STORAGE_KEY)
    : loadStoredArray(LEGACY_TEAM_STORAGE_KEY)

  if (hasCurrentTeam) return storedTeam.slice(0, 6)

  const legacyPokemon = loadStoredArray(LEGACY_BOX_STORAGE_KEY)
  const legacySpeciesByCaptureId = new Map(
    legacyPokemon.map((pokemon) => [pokemon.captureId, Number(pokemon.speciesId)]),
  )
  const availableIds = new Set(collection.map((pokemon) => pokemon.captureId))

  return [...new Set(storedTeam.map((captureId) => {
    if (availableIds.has(captureId)) return captureId
    const speciesId = legacySpeciesByCaptureId.get(captureId)
    return speciesId ? `dex-${speciesId}` : null
  }).filter((captureId) => captureId && availableIds.has(captureId)))].slice(0, 6)
}

function loadStoredVp() {
  const storedVp = Math.floor(Number(window.localStorage.getItem(VP_STORAGE_KEY)) || 0)
  return Math.max(0, storedVp)
}

function loadStoredItems() {
  try {
    const storedItems = window.localStorage.getItem(ITEM_STORAGE_KEY)
    return normalizeItemInventory(storedItems ? JSON.parse(storedItems) : {})
  } catch {
    return {}
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
  const vpBalance = useRef(null)
  if (vpBalance.current === null) vpBalance.current = loadStoredVp()
  const storedItemInventory = useRef(null)
  if (storedItemInventory.current === null) storedItemInventory.current = loadStoredItems()

  const [screen, setScreen] = useState('lobby')
  const [selectedMode, setSelectedMode] = useState('start')
  const [drawResults, setDrawResults] = useState([])
  const [boxPokemon, setBoxPokemon] = useState(initialCollection.current)
  const [teamIds, setTeamIds] = useState(() => loadStoredTeam(initialCollection.current))
  const [vp, setVp] = useState(vpBalance.current)
  const [itemInventory, setItemInventory] = useState(storedItemInventory.current)
  const [soundEnabled, setSoundEnabled] = useState(true)
  const [notice, setNotice] = useState('')
  const noticeTimer = useRef(null)

  useEffect(() => {
    return () => window.clearTimeout(noticeTimer.current)
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem(BOX_STORAGE_KEY, JSON.stringify(boxPokemon))
    } catch {}
  }, [boxPokemon])

  useEffect(() => {
    try {
      window.localStorage.setItem(TEAM_STORAGE_KEY, JSON.stringify(teamIds))
    } catch {}
  }, [teamIds])

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
    const availableIds = new Set(boxPokemon.map((pokemon) => pokemon.captureId))
    setTeamIds((currentIds) => {
      const validIds = currentIds.filter((captureId) => availableIds.has(captureId)).slice(0, 6)
      const isUnchanged = validIds.length === currentIds.length
        && validIds.every((captureId, index) => captureId === currentIds[index])

      return isUnchanged ? currentIds : validIds
    })
  }, [boxPokemon])

  const showNotice = (message) => {
    setNotice(message)
    window.clearTimeout(noticeTimer.current)
    noticeTimer.current = window.setTimeout(() => setNotice(''), 2400)
  }

  const createAndStoreDraw = () => {
    const nextResults = createPokemonDraw(10, boxPokemon)
    const mergedDraw = mergePokemonDraws(boxPokemon, nextResults)

    setDrawResults(nextResults)
    setBoxPokemon(mergedDraw.collection)
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

    if (mode.id === 'hatch') {
      enterHatchScreen()
      return
    }

    if (mode.id === 'training') {
      setScreen('training')
      return
    }

    if (mode.id === 'collection') {
      setScreen('box')
      return
    }

    if (mode.id === 'shop') {
      setScreen('shop')
      return
    }

    showNotice(`${mode.title} 모드를 선택했습니다.`)
  }

  const resetDraw = () => {
    createAndStoreDraw()
  }

  const returnToLobby = () => {
    setScreen('lobby')
  }

  const openBox = () => {
    setScreen('box')
  }

  const openShop = () => {
    setSelectedMode('shop')
    setScreen('shop')
  }

  const purchaseBattleItem = (itemId) => {
    const purchase = attemptItemPurchase(vpBalance.current, storedItemInventory.current, itemId)

    if (!purchase.ok) {
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
    showNotice(`${purchase.item.name}을(를) 구매했습니다. · 남은 ${purchase.balance.toLocaleString()} VP`)
  }

  const equipBattleItem = (captureId, itemId) => {
    const targetPokemon = boxPokemon.find((pokemon) => pokemon.captureId === captureId)
    const equipResult = attemptItemEquip(boxPokemon, itemInventory, captureId, itemId)

    if (!equipResult.ok) {
      if (equipResult.reason === 'item-unavailable') {
        showNotice(`${equipResult.item.name}은(는) 다른 포켓몬이 사용 중입니다.`)
      } else {
        showNotice('해당 지닌 도구를 장착할 수 없습니다.')
      }
      return
    }

    if (equipResult.unchanged || !targetPokemon) return

    setBoxPokemon(equipResult.pokemon)
    showNotice(
      equipResult.item
        ? `${targetPokemon.name}에게 ${equipResult.item.name}을(를) 지니게 했습니다.`
        : `${targetPokemon.name}의 지닌 도구를 해제했습니다.`,
    )
  }

  const setPokemonTeraType = (captureId, teraType) => {
    const targetPokemon = boxPokemon.find((pokemon) => pokemon.captureId === captureId)

    if (!targetPokemon || !TERA_TYPES.includes(teraType)) {
      showNotice('선택할 수 없는 테라타입입니다.')
      return
    }

    if (targetPokemon.teraType === teraType) return

    setBoxPokemon((currentPokemon) => currentPokemon.map((pokemon) => (
      pokemon.captureId === captureId
        ? normalizePokemon({ ...pokemon, teraType })
        : pokemon
    )))
    showNotice(`${targetPokemon.name}의 테라타입을 ${teraType} 타입으로 설정했습니다.`)
  }

  const setPokemonDynamaxMode = (captureId, dynamaxMode) => {
    const targetPokemon = boxPokemon.find((pokemon) => pokemon.captureId === captureId)
    const requestedMode = DYNAMAX_MODES.find((mode) => mode.id === dynamaxMode)

    if (!targetPokemon || !requestedMode) {
      showNotice('선택할 수 없는 다이맥스 설정입니다.')
      return
    }

    if (dynamaxMode === 'gigantamax' && !canGigantamax(targetPokemon.speciesId)) {
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
    showNotice(`${targetPokemon.name}의 배틀 거대화 방식을 ${requestedMode.label}로 설정했습니다.`)
  }

  const toggleTeamPokemon = (captureId) => {
    const targetPokemon = boxPokemon.find((pokemon) => pokemon.captureId === captureId)

    if (!targetPokemon) return

    if (teamIds.includes(captureId)) {
      setTeamIds((currentIds) => currentIds.filter((id) => id !== captureId))
      showNotice(`${targetPokemon.name}을(를) 팀에서 뺐습니다.`)
      return
    }

    if (teamIds.length >= 6) {
      showNotice('배틀 팀은 최대 6마리까지 편성할 수 있습니다.')
      return
    }

    setTeamIds((currentIds) => [...currentIds, captureId])
    showNotice(`${targetPokemon.name}을(를) 팀에 추가했습니다.`)
  }

  const confirmTeam = () => {
    if (teamIds.length === 0) {
      showNotice('박스에서 팀에 넣을 포켓몬을 선택해주세요.')
      return
    }

    showNotice(`${teamIds.length}마리 배틀 팀을 저장했습니다.`)
  }

  const autoBuildTeam = () => {
    if (boxPokemon.length === 0) {
      showNotice('자동 편성할 포켓몬이 없습니다.')
      return
    }

    const nextTeamIds = boxPokemon.slice(0, 6).map((pokemon) => pokemon.captureId)
    setTeamIds(nextTeamIds)
    showNotice(`${nextTeamIds.length}마리로 팀을 자동 편성했습니다.`)
  }

  const saveTraining = (pokemon) => {
    const profile = getSpeciesProfile(pokemon.speciesId)

    if (profile?.parentSpeciesId) {
      showNotice('배틀 기믹 폼은 미리보기 전용입니다. 일반 형태로 돌아온 뒤 저장해주세요.')
      return
    }

    setBoxPokemon((currentPokemon) => currentPokemon.map((entry) => (
      entry.captureId === pokemon.captureId
        ? normalizePokemon(pokemon)
        : entry
    )))
    showNotice(`${pokemon.name}의 트레이닝 설정을 저장했습니다.`)
  }

  return (
    <div className={`app-shell${screen === 'hatch' ? ' draw-view' : ''}${screen === 'box' ? ' pc-view' : ''}${screen === 'training' ? ' training-view' : ''}${screen === 'shop' ? ' shop-view' : ''}`}>
      <div className="ambient ambient-one" aria-hidden="true" />
      <div className="ambient ambient-two" aria-hidden="true" />

      <header className="topbar">
        <div className="brand" aria-label="Champions Arena">
          <span className="brand-mark">
            <Sparkles size={22} strokeWidth={2.6} />
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
            onClick={() => {
              setSoundEnabled((enabled) => !enabled)
              showNotice(soundEnabled ? '사운드를 껐습니다.' : '사운드를 켰습니다.')
            }}
          >
            {soundEnabled ? <Volume2 size={21} /> : <VolumeX size={21} />}
          </button>

          <button
            className="icon-button"
            type="button"
            aria-label="설정"
            onClick={() => showNotice('환경 설정 화면은 준비 중입니다.')}
          >
            <Settings size={21} />
          </button>
        </div>
      </header>

      {screen === 'lobby' ? (
      <main className="lobby-layout">
        <aside className="profile-panel glass-panel" aria-label="트레이너 프로필">
          <div className="trainer-card trainer-card-minimal">
            <div className="trainer-avatar">
              <UserRound size={38} strokeWidth={1.8} />
            </div>
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
          teamIds={teamIds}
          inventory={itemInventory}
          onBack={returnToLobby}
          onEquipItem={equipBattleItem}
          onSetTeraType={setPokemonTeraType}
          onSetDynamaxMode={setPokemonDynamaxMode}
          onToggleTeam={toggleTeamPokemon}
          onAutoTeam={autoBuildTeam}
          onConfirmTeam={confirmTeam}
          onOpenHatch={enterHatchScreen}
          onOpenShop={openShop}
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
