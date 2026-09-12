import {
  createBattle, createBattleTurnTimeline, getActivePokemon, getActivePokemonList,
  getAvailableBattleMechanics, getBattleMovePreview, getBattleMoveSelectionState,
  getBattleMoveTargets, getBattleStruggleAction, getBattleSwitchIndexes,
  getForcedBattleAction, resumeHumanBattleTurnTimeline,
} from '../src/data/battleEngine.js'
import {
  getSpeciesProfile, getMove, getMoveById, getLearnableMoves, normalizePokemon,
  isSavablePokemonForm, NATURE_OPTIONS, STAT_META, STAT_POINT_TOTAL,
  STAT_POINT_PER_STAT, TERA_TYPES, HIDDEN_POWER_TYPES,
} from '../src/data/trainingData.js'
import { getBattleItem } from '../src/data/shopData.js'

function invalid(message) {
  const error = new Error(message)
  error.status = 400
  error.code = 'invalid-battle-action'
  throw error
}

const other = (sideId) => sideId === 'player' ? 'opponent' : 'player'
const plain = (value) => value && typeof value === 'object' && !Array.isArray(value)
const formatId = (format) => {
  if (!['single', 'double'].includes(format)) invalid('싱글 또는 더블 배틀을 선택해 주세요.')
  return format
}

// Only configuration fields are accepted. Sprites, stats, moves and item
// descriptions are reconstructed from the server's versioned game catalog.
export function canonicalizeRankedTeam(entries, { format = 'single', requireRegisteredTeam = true } = {}) {
  const size = requireRegisteredTeam ? 6 : formatId(format) === 'double' ? 4 : 3
  formatId(format)
  if (!Array.isArray(entries) || entries.length !== size) invalid(`${size}마리의 포켓몬을 선택해 주세요.`)
  const species = new Set()
  const items = new Set()
  const captures = new Set()
  return entries.map((entry, index) => {
    if (!plain(entry)) invalid('포켓몬 설정이 올바르지 않습니다.')
    const profile = getSpeciesProfile(Number(entry.speciesId))
    if (!profile || !isSavablePokemonForm(profile)) invalid('배틀에 등록할 수 없는 포켓몬 폼입니다.')
    const dexId = Number(profile.parentSpeciesId ?? profile.id)
    if (species.has(dexId)) invalid('같은 종류의 포켓몬을 중복 등록할 수 없습니다.')
    species.add(dexId)
    const captureId = String(entry.captureId ?? `registered-${index}`)
    if (!/^[A-Za-z0-9_.:-]{1,96}$/.test(captureId) || captures.has(captureId)) invalid('포켓몬 식별자가 올바르지 않습니다.')
    captures.add(captureId)
    const heldItemId = entry.heldItemId || ''
    const item = heldItemId ? getBattleItem(heldItemId) : null
    if (heldItemId && (!item || items.has(heldItemId))) invalid('존재하지 않거나 중복된 지닌 도구입니다.')
    if (item) items.add(item.id)
    const moves = entry.moveIds ?? entry.moves
    if (!Array.isArray(moves) || moves.length < 1 || moves.length > 4) invalid('기술을 1개에서 4개까지 설정해 주세요.')
    const canonicalMoves = moves.map((move) => {
      if (typeof move !== 'string') return null
      return getMoveById(move) ?? (getMove(move).name === move ? getMove(move) : null)
    })
    const learnable = new Set(getLearnableMoves(profile.id).map((move) => move.id))
    if (canonicalMoves.some((move) => !move || !learnable.has(move.id))
      || new Set(canonicalMoves.map((move) => move.id)).size !== moves.length) invalid('배울 수 없거나 중복된 기술입니다.')
    if (entry.ability != null && !profile.abilities.includes(entry.ability)) invalid('해당 포켓몬의 특성이 아닙니다.')
    if (entry.nature != null && !NATURE_OPTIONS.some((nature) => nature.label === entry.nature)) invalid('성격 설정이 올바르지 않습니다.')
    if (entry.teraType != null && !TERA_TYPES.includes(entry.teraType)) invalid('테라 타입 설정이 올바르지 않습니다.')
    if (entry.hiddenPowerType != null && !HIDDEN_POWER_TYPES.includes(entry.hiddenPowerType)) invalid('잠재파워 타입 설정이 올바르지 않습니다.')
    let trainingPoints
    if (entry.trainingPoints != null) {
      if (!plain(entry.trainingPoints)) invalid('능력치 포인트 설정이 올바르지 않습니다.')
      trainingPoints = Object.fromEntries(STAT_META.map(({ key }) => [key, entry.trainingPoints[key] ?? 0]))
      if (Object.values(trainingPoints).some((value) => !Number.isInteger(value) || value < 0 || value > STAT_POINT_PER_STAT)
        || Object.values(trainingPoints).reduce((sum, value) => sum + value, 0) > STAT_POINT_TOTAL) invalid('능력치 포인트 한도를 초과했습니다.')
    }
    const pokemon = normalizePokemon({
      captureId, speciesId: profile.id, dexSpeciesId: dexId,
      moves: canonicalMoves.map((move) => move.name),
      ability: entry.ability, nature: entry.nature, trainingPoints,
      teraType: entry.teraType, dynamaxMode: entry.dynamaxMode,
      hiddenPowerType: entry.hiddenPowerType,
      hiddenPowerTypeConfigured: Boolean(entry.hiddenPowerTypeConfigured),
      gender: entry.gender, isShiny: Boolean(entry.isShiny),
      // Cosmetics cannot grant mechanics; custom remote sprite URLs are never accepted.
      heldItemId: item?.id ?? '', heldItemName: item?.name ?? '',
    })
    return { ...pokemon, moveIds: pokemon.moves.map((name) => getMove(name).id) }
  })
}

export function createRankedBattle({ playerTeam, opponentTeam, format = 'single', playerName = '트레이너 1', opponentName = '트레이너 2', random = Math.random }) {
  const double = formatId(format) === 'double'
  const canonical = (team, sideId) => canonicalizeRankedTeam(team, { format, requireRegisteredTeam: false })
    .map((pokemon, index) => ({ ...pokemon, captureId: `ranked-${sideId}-${index}` }))
  return createBattle({
    random,
    playerPokemon: canonical(playerTeam, 'player'),
    playerName: String(playerName).slice(0, 40),
    opponent: { id: 'ranked-human', name: String(opponentName).slice(0, 40), tier: '레이팅' },
    opponentTeam: { pokemon: canonical(opponentTeam, 'opponent'), battleGimmicks: [], strategy: {} },
    rules: {
      pvp: true,
      weather: { id: 'clear', label: '맑음' }, terrain: { id: 'neutral', label: '일반 필드' },
      format: { id: format, label: double ? '더블배틀' : '싱글배틀', activeSlots: double ? 2 : 1, actionSlots: double ? 2 : 1 },
      teamRule: { id: 'ranked', label: double ? '4대4' : '3대3', battleSize: double ? 4 : 3 },
      disabledGimmickId: null, gimmickRestriction: { id: null, label: '기믹별 1회' },
      aiDifficulty: { id: 'normal', label: '레이팅', boostStage: 0 },
    },
  })
}

function assertSide(state, sideId) {
  if (!state?.rules?.pvp || !['player', 'opponent'].includes(sideId)) invalid('레이팅 배틀 상태가 아닙니다.')
}

export function validateRankedAction(state, sideId, requestedActions) {
  assertSide(state, sideId)
  if (state.winner || state.pendingHumanSwitch || state.pendingTurn) invalid('현재 행동을 선택할 수 없습니다.')
  const active = getActivePokemonList(state, sideId)
  const slots = active.flatMap((pokemon, slot) => pokemon.hp > 0 && !pokemon.fainted && !pokemon.commanding ? [slot] : [])
  const actions = Array.isArray(requestedActions) ? requestedActions : [requestedActions]
  if (actions.length !== slots.length || actions.some((action) => !plain(action))
    || new Set(actions.map((action) => action.actorSlot ?? 0)).size !== slots.length) invalid('행동 가능한 포켓몬마다 행동을 선택해 주세요.')
  const switching = new Set()
  const mechanics = new Set()
  return actions.map((action) => {
    const actorSlot = action.actorSlot ?? 0
    if (!Number.isInteger(actorSlot) || !slots.includes(actorSlot)) invalid('행동할 수 없는 포켓몬입니다.')
    const forced = getForcedBattleAction(state, sideId, actorSlot)
    if (forced) return { ...forced, actorSlot }
    if (action.type === 'switch') {
      if (!getBattleSwitchIndexes(state, sideId, actorSlot).includes(action.targetIndex) || switching.has(action.targetIndex)) invalid('이 포켓몬으로 교체할 수 없습니다.')
      switching.add(action.targetIndex)
      return { type: 'switch', actorSlot, targetIndex: action.targetIndex }
    }
    if (action.type !== 'move' || !Number.isInteger(action.moveIndex)) invalid('기술 선택이 올바르지 않습니다.')
    const gimmick = action.gimmick || null
    if (gimmick && (!getAvailableBattleMechanics(state, sideId, actorSlot).some(({ id }) => id === gimmick) || mechanics.has(gimmick))) invalid('해당 배틀 기믹을 사용할 수 없습니다.')
    if (gimmick) mechanics.add(gimmick)
    const selection = getBattleMoveSelectionState(state, sideId, action.moveIndex, actorSlot, gimmick)
    if (selection.disabled) invalid(selection.reason)
    const targets = getBattleMoveTargets(state, sideId, action.moveIndex, actorSlot, gimmick)
    const targetSideId = action.targetSideId ?? other(sideId)
    const targetSlot = action.targetSlot ?? 0
    if (!['player', 'opponent'].includes(targetSideId) || !Number.isInteger(targetSlot) || targetSlot < 0 || targetSlot > 1) invalid('기술 대상이 올바르지 않습니다.')
    if (targets.length && !targets.some((target) => target.sideId === targetSideId && target.slot === targetSlot)) invalid('이 포켓몬을 기술 대상으로 선택할 수 없습니다.')
    return { type: 'move', actorSlot, moveIndex: action.moveIndex, gimmick, targetSideId, targetSlot }
  })
}

export function resolveRankedTurn(state, actionsBySide, random = Math.random) {
  const player = validateRankedAction(state, 'player', actionsBySide?.player)
  const opponent = validateRankedAction(state, 'opponent', actionsBySide?.opponent)
  return createBattleTurnTimeline(state, player, random, opponent)
}

export function resolveRankedReplacement(state, sideId, targetIndex, random = Math.random) {
  assertSide(state, sideId)
  if (state.winner || state.pendingHumanSwitch?.sideId !== sideId) invalid('현재 교체를 선택할 차례가 아닙니다.')
  const result = resumeHumanBattleTurnTimeline(state, sideId, targetIndex, random)
  if (result.state === state) invalid('교체 대상이 올바르지 않습니다.')
  return result
}

const pick = (value, keys) => Object.fromEntries(keys.filter((key) => value[key] !== undefined).map((key) => [key, structuredClone(value[key])]))
const PUBLIC_POKEMON = [
  'battleId', 'name', 'speciesId', 'slug', 'formName', 'level', 'isShiny', 'gender',
  'spriteFront', 'spriteBack', 'spriteFrontFallback', 'spriteBackFallback', 'icon', 'iconFallback',
  'types', 'status', 'statStages', 'fainted', 'teraActive', 'dynamaxActive', 'dynamaxTurns',
  'megaActive', 'primalActive', 'ultraActive', 'usedBattleMechanicId', 'commanding',
  'commandedByBattleId', 'commanderHostBattleId', 'substituteHp', 'semiInvulnerable',
  'confusionTurns', 'perishCount', 'protected', 'yawnTurns', 'saltCureActive', 'cursedActive',
  'leechSeedSourceSideId', 'leechSeedSourceSlot', 'tauntTurns', 'trappedTurns', 'trapSourceName',
  'ingrainActive', 'aquaRingActive', 'magnetRiseTurns', 'telekinesisTurns',
]
const PUBLIC_SIDE = ['name', 'activeIndex', 'activeIndexes', 'rotationSlot', 'usedMechanics',
  'hazards', 'auroraVeilTurns', 'lightScreenTurns', 'reflectTurns', 'safeguardTurns',
  'mistTurns', 'tailwindTurns', 'luckyChantTurns', 'wideGuardTurns', 'quickGuardTurns',
  'craftyShieldTurns', 'matBlockTurns', 'firePledgeTurns', 'grassPledgeTurns', 'waterPledgeTurns', 'gmaxResidual']

function publicPokemon(pokemon, side) {
  if (!pokemon.rankedRevealed) return {
    battleId: pokemon.battleId, name: '미공개 포켓몬', speciesId: 0, types: [],
    level: 50, hp: 100, maxHp: 100, fainted: false, moves: [], stats: {}, statStages: {},
    ability: '', heldItemId: '', heldItemName: '', teraType: null, hidden: true,
  }
  const visible = pick(pokemon, PUBLIC_POKEMON)
  if (pokemon.illusionSnapshot) {
    const disguise = side.team.find((entry) => entry.battleId !== pokemon.battleId
      && entry.spriteFront === pokemon.spriteFront && !entry.illusionSnapshot)
    Object.assign(visible, pick(disguise ?? {}, ['speciesId', 'slug', 'types', 'gender', 'isShiny', 'icon', 'iconFallback']))
    visible.speciesId = disguise?.speciesId ?? 0
    visible.formName = pokemon.name
  }
  return {
    ...visible, originalSpeciesId: visible.speciesId,
    hp: pokemon.hp > 0 ? Math.max(1, Math.ceil(pokemon.hp / pokemon.maxHp * 100)) : 0,
    maxHp: 100, originalMaxHp: 100,
    substituteHp: pokemon.substituteHp > 0 ? 1 : 0,
    moves: [], stats: {}, ability: '', heldItemId: '', heldItemName: '',
    status: pokemon.status ? pick(pokemon.status, ['id', 'label']) : null,
    confusionTurns: pokemon.confusionTurns > 0 ? 1 : 0,
    teraType: pokemon.teraActive ? pokemon.teraType : null,
  }
}

function remapSideReferences(value, sideId) {
  if (sideId === 'player') return value
  if (Array.isArray(value)) return value.map((entry) => remapSideReferences(entry, sideId))
  if (!plain(value)) return value
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key,
    (key === 'id' || key === 'sideId' || key === 'winner' || key === 'tone' || key.endsWith('SideId'))
      && ['player', 'opponent'].includes(entry) ? other(entry) : remapSideReferences(entry, sideId),
  ]))
}

function commandOptions(state, sideId) {
  if (state.winner || state.pendingHumanSwitch || state.pendingTurn) return []
  // A move preview must not serve as an oracle for an opponent's hidden
  // training, item or unannounced ability (e.g. Electro Ball's speed ratio).
  const previewState = structuredClone(state)
  previewState[other(sideId)].team = previewState[other(sideId)].team.map((pokemon) => ({
    ...pokemon, ability: '', heldItemId: '', heldItemName: '', weightKg: 100,
    stats: { hp: 100, attack: 100, defense: 100, specialAttack: 100, specialDefense: 100, speed: 100 },
    hp: 100, maxHp: 100,
  }))
  return getActivePokemonList(state, sideId).map((pokemon, actorSlot) => {
    const mechanics = getAvailableBattleMechanics(state, sideId, actorSlot)
    const variant = (moveIndex, gimmick = null) => ({
      ...getBattleMoveSelectionState(state, sideId, moveIndex, actorSlot, gimmick),
      targets: getBattleMoveTargets(state, sideId, moveIndex, actorSlot, gimmick).map(({ sideId: targetSideId, slot }) => ({ sideId: targetSideId, slot })),
      preview: getBattleMovePreview(previewState, sideId, moveIndex, actorSlot, 0, gimmick),
    })
    const indexes = pokemon.moves.map((_, index) => index)
    if (getBattleStruggleAction(state, sideId, actorSlot)) indexes.push(-1)
    return {
      actorSlot, mechanics, forcedAction: getForcedBattleAction(state, sideId, actorSlot),
      switchIndexes: getBattleSwitchIndexes(state, sideId, actorSlot),
      moves: indexes.map((moveIndex) => ({ moveIndex, ...variant(moveIndex),
        variants: Object.fromEntries(mechanics.map(({ id }) => [id, variant(moveIndex, id)])),
      })),
    }
  })
}

export function getRankedBattleView(state, sideId, { includeCommandOptions = true } = {}) {
  assertSide(state, sideId)
  const own = state[sideId]
  const enemy = state[other(sideId)]
  const request = state.pendingHumanSwitch
  const awaiting = request?.sideId === sideId
  const player = { ...structuredClone(own), id: sideId }
  const opponent = { ...pick(enemy, PUBLIC_SIDE), id: other(sideId), team: enemy.team.map((pokemon) => publicPokemon(pokemon, enemy)) }
  const rawView = {
    turn: state.turn, phase: state.phase, rules: structuredClone(state.rules),
    environment: structuredClone(state.environment), player, opponent,
    opponentMeta: { id: 'ranked-human', name: enemy.name, tier: '레이팅' },
    opponentStrategy: {}, winner: state.winner,
    log: structuredClone(state.log), eventNonce: state.eventNonce,
    lastEvent: null, lastConsumedItem: null, lastUsedMove: null,
    awaitingPlayerSwitch: Boolean(awaiting),
    awaitingPlayerSwitchSlots: awaiting ? [request.actorSlot] : [],
    pendingPlayerSwitch: awaiting ? pick(request, ['kind', 'sideId', 'actorSlot', 'actorBattleId', 'moveName']) : null,
    pendingSwitches: [], pendingTurn: null,
    rankedWaitingForOpponent: Boolean(request && !awaiting),
    replacementIndexes: awaiting ? own.team.flatMap((pokemon, index) => request.kind === 'revival'
      ? pokemon.fainted || pokemon.hp <= 0 ? [index] : []
      : !own.activeIndexes.includes(index) && pokemon.hp > 0 && !pokemon.fainted
        && !state.humanReplacementBatch?.choices.some((choice) => choice.request.sideId === sideId && choice.targetIndex === index)
        ? [index] : []) : [],
    commandOptions: includeCommandOptions ? commandOptions(state, sideId) : [],
  }
  // Do not leak future move/item identities through copied side metadata.
  delete rawView.player.achievementStart
  rawView.player.futureMoveSlots = Object.fromEntries(Object.entries(own.futureMoveSlots ?? {}).map(([slot, entry]) => [slot,
    pick(entry, ['turns', 'sourceBattleId', 'sourceSideId']),
  ]))
  const view = remapSideReferences(rawView, sideId)
  view.player.id = 'player'
  view.opponent.id = 'opponent'
  return JSON.parse(JSON.stringify(view))
}

const TIMELINE_FIELDS = [
  'id', 'phase', 'actionOrder', 'sideId', 'targetSideId', 'actorSlot', 'targetSlot',
  'actorName', 'targetName', 'actorSpeciesId', 'targetSpeciesId', 'actorPreviousName',
  'moveName', 'moveId', 'moveType', 'moveCategory', 'movePower', 'moveTarget',
  'moveGeneration', 'movePriority', 'moveMultihit', 'moveDrain', 'moveRecoil', 'moveStatus',
  'moveSelfdestruct', 'moveFlags', 'moveDescription',
  'animationType', 'animationVariant', 'animationVariantKey', 'animationReferenceKey',
  'actorSpeciesSlug', 'result', 'critical', 'effectiveness', 'hitIndex', 'hitCount',
  'message', 'mechanicId', 'mechanicLabel', 'formSourceName',
  'spriteBeforeFront', 'spriteBeforeBack', 'spriteBeforeFrontFallback', 'spriteBeforeBackFallback',
  'spriteAfterFront', 'spriteAfterBack', 'spriteAfterFrontFallback', 'spriteAfterBackFallback',
]

export function getRankedTimelineView(timeline, sideId) {
  return (timeline ?? []).map((step) => {
    const safe = pick(step, TIMELINE_FIELDS)
    // Actual HP damage and an unannounced held item are not public information.
    if (step.sideId === other(sideId) && step.state) {
      const actor = getActivePokemon(step.state, step.sideId, step.actorSlot ?? 0)
      const visible = actor ? publicPokemon(actor, step.state[step.sideId]) : null
      if (actor?.illusionSnapshot) {
        safe.actorSpeciesId = visible.speciesId
        safe.actorSpeciesSlug = visible.slug ?? ''
      }
    }
    if (safe.phase === 'switch-out' && step.sideId === other(sideId)) delete safe.targetName
    if (step.targetSideId === other(sideId) && step.state) {
      const target = getActivePokemon(step.state, step.targetSideId, step.targetSlot ?? 0)
      if (target?.illusionSnapshot) safe.targetSpeciesId = publicPokemon(target, step.state[step.targetSideId]).speciesId
    }
    return { ...remapSideReferences(safe, sideId), state: getRankedBattleView(step.state, sideId, { includeCommandOptions: false }) }
  })
}
