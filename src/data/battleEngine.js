import {
  calculateStats,
  getBattleFormOptions,
  getMove,
  getMoveById,
  getSpeciesProfile,
  normalizePokemon,
} from './trainingData.js'

const TYPE_CHART = {
  노말: { 바위: 0.5, 고스트: 0, 강철: 0.5 },
  불꽃: { 불꽃: 0.5, 물: 0.5, 풀: 2, 얼음: 2, 벌레: 2, 바위: 0.5, 드래곤: 0.5, 강철: 2 },
  물: { 불꽃: 2, 물: 0.5, 풀: 0.5, 땅: 2, 바위: 2, 드래곤: 0.5 },
  전기: { 물: 2, 전기: 0.5, 풀: 0.5, 땅: 0, 비행: 2, 드래곤: 0.5 },
  풀: { 불꽃: 0.5, 물: 2, 풀: 0.5, 독: 0.5, 땅: 2, 비행: 0.5, 벌레: 0.5, 바위: 2, 드래곤: 0.5, 강철: 0.5 },
  얼음: { 불꽃: 0.5, 물: 0.5, 풀: 2, 얼음: 0.5, 땅: 2, 비행: 2, 드래곤: 2, 강철: 0.5 },
  격투: { 노말: 2, 얼음: 2, 독: 0.5, 비행: 0.5, 에스퍼: 0.5, 벌레: 0.5, 바위: 2, 고스트: 0, 악: 2, 강철: 2, 페어리: 0.5 },
  독: { 풀: 2, 독: 0.5, 땅: 0.5, 바위: 0.5, 고스트: 0.5, 강철: 0, 페어리: 2 },
  땅: { 불꽃: 2, 전기: 2, 풀: 0.5, 독: 2, 비행: 0, 벌레: 0.5, 바위: 2, 강철: 2 },
  비행: { 전기: 0.5, 풀: 2, 격투: 2, 벌레: 2, 바위: 0.5, 강철: 0.5 },
  에스퍼: { 격투: 2, 독: 2, 에스퍼: 0.5, 악: 0, 강철: 0.5 },
  벌레: { 불꽃: 0.5, 풀: 2, 격투: 0.5, 독: 0.5, 비행: 0.5, 에스퍼: 2, 고스트: 0.5, 악: 2, 강철: 0.5, 페어리: 0.5 },
  바위: { 불꽃: 2, 얼음: 2, 격투: 0.5, 땅: 0.5, 비행: 2, 벌레: 2, 강철: 0.5 },
  고스트: { 노말: 0, 에스퍼: 2, 고스트: 2, 악: 0.5 },
  드래곤: { 드래곤: 2, 강철: 0.5, 페어리: 0 },
  악: { 격투: 0.5, 에스퍼: 2, 고스트: 2, 악: 0.5, 페어리: 0.5 },
  강철: { 불꽃: 0.5, 물: 0.5, 전기: 0.5, 얼음: 2, 바위: 2, 강철: 0.5, 페어리: 2 },
  페어리: { 불꽃: 0.5, 격투: 2, 독: 0.5, 드래곤: 2, 악: 2, 강철: 0.5 },
  스텔라: {},
}

const STATUS_MOVE_EFFECTS = {
  swordsdance: { self: { attack: 2 } },
  nastyplot: { self: { specialAttack: 2 } },
  dragondance: { self: { attack: 1, speed: 1 } },
  quiverdance: { self: { specialAttack: 1, specialDefense: 1, speed: 1 } },
  irondefense: { self: { defense: 2 } },
  agility: { self: { speed: 2 } },
  rockpolish: { self: { speed: 2 } },
  bulkup: { self: { attack: 1, defense: 1 } },
  workup: { self: { attack: 1, specialAttack: 1 } },
  amnesia: { self: { specialDefense: 2 } },
  calmmind: { self: { specialAttack: 1, specialDefense: 1 } },
  shellsmash: {
    self: { attack: 2, specialAttack: 2, speed: 2, defense: -1, specialDefense: -1 },
  },
  growl: { target: { attack: -1 } },
  charm: { target: { attack: -2 } },
  screech: { target: { defense: -2 } },
  faketears: { target: { specialDefense: -2 } },
  fakeout: {},
}

const PROTECT_MOVE_IDS = new Set([
  'protect',
  'detect',
  'spikyshield',
  'kingsshield',
  'banefulbunker',
  'silktrap',
  'burningbulwark',
])

const HEAL_MOVE_IDS = new Set([
  'recover',
  'roost',
  'softboiled',
  'slackoff',
  'moonlight',
  'synthesis',
  'morningsun',
  'milkdrink',
  'shoreup',
  'lifedew',
])

const STATUS_LABELS = {
  burn: '화상',
  paralysis: '마비',
  poison: '독',
  toxic: '맹독',
  sleep: '잠듦',
  freeze: '얼음',
}

const STAT_LABELS = {
  attack: '공격',
  defense: '방어',
  specialAttack: '특수공격',
  specialDefense: '특수방어',
  speed: '스피드',
}

const MECHANIC_LABELS = {
  tera: '테라스탈',
  dynamax: '다이맥스',
  mega: '메가진화',
  zmove: 'Z기술',
  primal: '원시회귀',
}

function statObject(pokemon) {
  return Object.fromEntries(calculateStats(pokemon).map((stat) => [stat.key, stat.value]))
}

function moveRuntime(move, fallbackIndex) {
  return {
    ...move,
    id: move.id ?? `move-${fallbackIndex}`,
    maxPp: Math.max(1, Number(move.pp) || 1),
    currentPp: Math.max(1, Number(move.pp) || 1),
  }
}

function buildBattlePokemon(entry, index, teamGimmicks = []) {
  const resolvedMoves = Array.from({ length: 4 }, (_, moveIndex) => (
    getMoveById(entry.moveIds?.[moveIndex])
      ?? getMove(entry.moves?.[moveIndex])
  ))
  const normalized = normalizePokemon({
    ...entry,
    captureId: entry.captureId ?? `ai-${entry.speciesId}-${index}`,
    moves: resolvedMoves.map((move) => move.name),
  })
  const profile = getSpeciesProfile(normalized.speciesId)
  const stats = statObject(normalized)
  const matchingGimmick = teamGimmicks.find((gimmick) => (
    gimmick.pokemonSlug === entry.slug
      || gimmick.pokemonName === normalized.name
      || Number(gimmick.pokemonSpeciesId) === Number(normalized.dexSpeciesId)
  ))

  return {
    ...normalized,
    battleId: `${normalized.captureId}-${index}`,
    originalSpeciesId: normalized.speciesId,
    originalTypes: [...normalized.types],
    types: [...normalized.types],
    stats,
    maxHp: stats.hp,
    originalMaxHp: stats.hp,
    hp: stats.hp,
    moves: resolvedMoves.map(moveRuntime),
    fainted: false,
    status: null,
    statStages: {
      attack: 0,
      defense: 0,
      specialAttack: 0,
      specialDefense: 0,
      speed: 0,
    },
    protected: false,
    protectChain: 0,
    flinched: false,
    teraActive: false,
    dynamaxActive: false,
    dynamaxTurns: 0,
    megaActive: false,
    primalActive: false,
    consumedItem: false,
    battleMechanics: [...(entry.battleMechanics ?? [])],
    gimmickFormId: matchingGimmick?.targetFormId ?? null,
    heldItemName: entry.heldItemName ?? '',
    role: entry.role ?? '',
    spriteFront: normalized.spriteFront ?? profile?.spriteFront,
    spriteBack: normalized.spriteBack ?? profile?.spriteBack,
  }
}

function reorderForLead(entries, leadName) {
  if (!leadName) return entries
  const leadIndex = entries.findIndex((entry) => entry.name === leadName)
  if (leadIndex <= 0) return entries
  return [entries[leadIndex], ...entries.slice(0, leadIndex), ...entries.slice(leadIndex + 1)]
}

function createSide(id, name, entries, teamGimmicks = [], leadName = '') {
  const team = reorderForLead(
    entries.map((entry, index) => buildBattlePokemon(entry, index, teamGimmicks)),
    leadName,
  )

  return {
    id,
    name,
    team,
    activeIndex: 0,
    usedMechanics: {
      tera: false,
      dynamax: false,
      mega: false,
      zmove: false,
      primal: false,
    },
  }
}

function appendLog(state, message, tone = 'normal') {
  state.log.push({
    id: `${state.turn}-${state.log.length}-${message}`,
    message,
    tone,
  })
  if (state.log.length > 80) state.log.splice(0, state.log.length - 80)
}

function clonePokemon(pokemon) {
  return {
    ...pokemon,
    types: [...pokemon.types],
    originalTypes: [...pokemon.originalTypes],
    stats: { ...pokemon.stats },
    moves: pokemon.moves.map((move) => ({ ...move })),
    statStages: { ...pokemon.statStages },
    status: pokemon.status ? { ...pokemon.status } : null,
    battleMechanics: [...pokemon.battleMechanics],
  }
}

function cloneSide(side) {
  return {
    ...side,
    team: side.team.map(clonePokemon),
    usedMechanics: { ...side.usedMechanics },
  }
}

function cloneBattle(state) {
  return {
    ...state,
    player: cloneSide(state.player),
    opponent: cloneSide(state.opponent),
    log: [...state.log],
    lastEvent: state.lastEvent ? { ...state.lastEvent } : null,
  }
}

function pushTimelineStep(timeline, state, step) {
  if (!timeline) return
  timeline.push({
    id: `${state.turn}-${timeline.length}-${step.phase}`,
    ...step,
    state: cloneBattle(state),
  })
}

function latestLogMessage(state, fallback) {
  return state.log[state.log.length - 1]?.message ?? fallback
}

function getSide(state, sideId) {
  return sideId === 'player' ? state.player : state.opponent
}

function getOtherSide(state, sideId) {
  return sideId === 'player' ? state.opponent : state.player
}

export function getActivePokemon(state, sideId) {
  const side = getSide(state, sideId)
  return side.team[side.activeIndex]
}

function availableIndexes(side) {
  return side.team
    .map((pokemon, index) => (!pokemon.fainted && pokemon.hp > 0 ? index : -1))
    .filter((index) => index >= 0)
}

function remainingCount(side) {
  return availableIndexes(side).length
}

function stageMultiplier(stage) {
  return stage >= 0 ? (2 + stage) / 2 : 2 / (2 - stage)
}

function effectiveStat(pokemon, statKey) {
  let value = pokemon.stats[statKey] * stageMultiplier(pokemon.statStages[statKey] ?? 0)

  if (statKey === 'speed' && pokemon.status?.id === 'paralysis') value *= 0.5
  if (statKey === 'speed' && pokemon.heldItemId === 'choice-scarf') value *= 1.5
  if (statKey === 'attack' && pokemon.heldItemId === 'choice-band') value *= 1.5
  if (statKey === 'specialAttack' && pokemon.heldItemId === 'choice-specs') value *= 1.5
  if (statKey === 'specialDefense' && pokemon.heldItemId === 'assault-vest') value *= 1.5

  return Math.max(1, value)
}

export function getTypeEffectiveness(moveType, defenderTypes) {
  return defenderTypes.reduce((multiplier, defenderType) => (
    multiplier * (TYPE_CHART[moveType]?.[defenderType] ?? 1)
  ), 1)
}

function getMoveStab(pokemon, moveType) {
  if (!pokemon.teraActive) {
    return pokemon.types.includes(moveType)
      ? (pokemon.ability === '적응력' ? 2 : 1.5)
      : 1
  }

  if (pokemon.teraType === moveType) {
    if (pokemon.originalTypes.includes(moveType)) return pokemon.ability === '적응력' ? 2.25 : 2
    return pokemon.ability === '적응력' ? 2 : 1.5
  }

  return pokemon.originalTypes.includes(moveType) ? 1.5 : 1
}

function abilityImmunity(defender, moveType) {
  if (moveType === '땅' && defender.ability === '부유') return '부유'
  if (moveType === '물' && ['저수', '마중물', '건조피부'].includes(defender.ability)) return defender.ability
  if (moveType === '전기' && ['축전', '피뢰침', '전기엔진'].includes(defender.ability)) return defender.ability
  if (moveType === '불꽃' && defender.ability === '타오르는불꽃') return defender.ability
  return null
}

function calculateDamage(attacker, defender, move, random, powerMultiplier = 1) {
  const category = move.categoryId ?? (move.category === '물리' ? 'physical' : 'special')
  const attackKey = category === 'physical' ? 'attack' : 'specialAttack'
  const defenseKey = category === 'physical' ? 'defense' : 'specialDefense'
  const power = Math.max(1, Number(move.power) || 1) * powerMultiplier
  let attack = effectiveStat(attacker, attackKey)
  const defense = effectiveStat(defender, defenseKey)

  if (category === 'physical' && attacker.status?.id === 'burn' && attacker.ability !== '근성') attack *= 0.5
  if (attacker.ability === '의욕' && category === 'physical') attack *= 1.5
  if (attacker.ability === '근성' && attacker.status) attack *= 1.5

  const baseDamage = (((2 * 50) / 5 + 2) * power * attack / defense) / 50 + 2
  const effectiveness = getTypeEffectiveness(move.type, defender.types)
  const critical = random() < 1 / 24
  const randomFactor = 0.85 + random() * 0.15
  let modifier = getMoveStab(attacker, move.type) * effectiveness * randomFactor * (critical ? 1.5 : 1)

  if (attacker.heldItemId === 'life-orb') modifier *= 1.3
  if (attacker.heldItemId === 'expert-belt' && effectiveness > 1) modifier *= 1.2
  if (attacker.ability === '심록' && attacker.hp <= attacker.maxHp / 3 && move.type === '풀') modifier *= 1.5
  if (attacker.ability === '맹화' && attacker.hp <= attacker.maxHp / 3 && move.type === '불꽃') modifier *= 1.5
  if (attacker.ability === '급류' && attacker.hp <= attacker.maxHp / 3 && move.type === '물') modifier *= 1.5
  if (defender.ability === '멀티스케일' && defender.hp === defender.maxHp) modifier *= 0.5
  if (defender.ability === '두꺼운지방' && ['불꽃', '얼음'].includes(move.type)) modifier *= 0.5

  return {
    damage: effectiveness === 0 ? 0 : Math.max(1, Math.floor(baseDamage * modifier)),
    effectiveness,
    critical,
  }
}

function setStatus(state, target, statusId, sourceName) {
  if (target.status || target.fainted) return false
  if (statusId === 'burn' && target.types.includes('불꽃')) return false
  if ((statusId === 'poison' || statusId === 'toxic') && target.types.some((type) => ['독', '강철'].includes(type))) return false
  if (statusId === 'paralysis' && target.types.includes('전기')) return false
  if (statusId === 'freeze' && target.types.includes('얼음')) return false

  target.status = {
    id: statusId,
    label: STATUS_LABELS[statusId],
    counter: statusId === 'sleep' ? 2 : 0,
    toxicCounter: statusId === 'toxic' ? 1 : 0,
  }
  appendLog(state, `${target.name}은(는) ${STATUS_LABELS[statusId]} 상태가 되었다!`, 'status')
  state.lastEvent = { kind: 'status', targetId: target.battleId, sourceName }
  return true
}

function changeStages(state, pokemon, changes) {
  const messages = []

  Object.entries(changes).forEach(([statKey, amount]) => {
    const previous = pokemon.statStages[statKey] ?? 0
    const next = Math.max(-6, Math.min(6, previous + amount))
    pokemon.statStages[statKey] = next
    if (next !== previous) {
      messages.push(`${STAT_LABELS[statKey]}${amount > 0 ? ' 상승' : ' 하락'}`)
    }
  })

  if (messages.length > 0) appendLog(state, `${pokemon.name}의 ${messages.join(' · ')}!`, 'status')
}

function healPokemon(state, pokemon, amount, source) {
  const healed = Math.min(Math.max(0, Math.floor(amount)), pokemon.maxHp - pokemon.hp)
  if (healed <= 0) return 0
  pokemon.hp += healed
  appendLog(state, `${pokemon.name}은(는) ${source}으로 HP를 ${healed} 회복했다.`, 'heal')
  return healed
}

function applyStatusMove(state, attacker, defender, move, random) {
  if (PROTECT_MOVE_IDS.has(move.id)) {
    const successRate = 1 / Math.max(1, 3 ** attacker.protectChain)
    if (random() <= successRate) {
      attacker.protected = true
      attacker.protectChain += 1
      appendLog(state, `${attacker.name}은(는) 몸을 지키고 있다!`, 'status')
    } else {
      attacker.protectChain = 0
      appendLog(state, '그러나 실패하고 말았다!', 'muted')
    }
    return
  }

  attacker.protectChain = 0

  if (move.id === 'rest') {
    attacker.hp = attacker.maxHp
    attacker.status = { id: 'sleep', label: STATUS_LABELS.sleep, counter: 2, toxicCounter: 0 }
    appendLog(state, `${attacker.name}은(는) 푹 잠들어 HP를 모두 회복했다.`, 'heal')
    return
  }

  if (HEAL_MOVE_IDS.has(move.id) || (move.flags?.includes('heal') && move.target === 'self')) {
    healPokemon(state, attacker, attacker.maxHp / 2, move.name)
    return
  }

  const scriptedEffect = STATUS_MOVE_EFFECTS[move.id]
  if (scriptedEffect?.self) changeStages(state, attacker, scriptedEffect.self)
  if (scriptedEffect?.target) changeStages(state, defender, scriptedEffect.target)
  if (scriptedEffect) return

  if (move.id === 'toxic') {
    setStatus(state, defender, 'toxic', move.name)
    return
  }
  if (['poisonpowder', 'poisongas'].includes(move.id)) {
    setStatus(state, defender, 'poison', move.name)
    return
  }
  if (['thunderwave', 'stunspore', 'glare', 'nuzzle'].includes(move.id)) {
    setStatus(state, defender, 'paralysis', move.name)
    return
  }
  if (move.id === 'willowisp') {
    setStatus(state, defender, 'burn', move.name)
    return
  }
  if (['sleeppowder', 'hypnosis', 'sing', 'spore', 'yawn'].includes(move.id)) {
    setStatus(state, defender, 'sleep', move.name)
    return
  }

  appendLog(state, `${move.name}의 전술 효과가 전개되었다.`, 'status')
}

function secondaryStatusFromDescription(state, attacker, defender, move, random) {
  const description = move.description ?? ''
  const percent = Number(description.match(/(\d+)%/)?.[1] ?? 0)
  if (!percent || random() * 100 >= percent) return

  if (description.includes('화상')) setStatus(state, defender, 'burn', move.name)
  else if (description.includes('마비')) setStatus(state, defender, 'paralysis', move.name)
  else if (description.includes('얼음 상태')) setStatus(state, defender, 'freeze', move.name)
  else if (description.includes('독 상태')) setStatus(state, defender, 'poison', move.name)
  else if (description.includes('풀죽')) {
    defender.flinched = true
    appendLog(state, `${defender.name}은(는) 풀죽었다!`, 'status')
  }
}

function canPokemonAct(state, pokemon, random) {
  if (pokemon.flinched) {
    appendLog(state, `${pokemon.name}은(는) 풀죽어서 움직일 수 없다!`, 'status')
    return false
  }

  if (pokemon.status?.id === 'sleep') {
    pokemon.status.counter -= 1
    if (pokemon.status.counter > 0) {
      appendLog(state, `${pokemon.name}은(는) 쿨쿨 잠들어 있다.`, 'status')
      return false
    }
    pokemon.status = null
    appendLog(state, `${pokemon.name}은(는) 잠에서 깨어났다!`, 'heal')
  }

  if (pokemon.status?.id === 'freeze') {
    if (random() >= 0.2) {
      appendLog(state, `${pokemon.name}은(는) 얼어붙어 움직일 수 없다!`, 'status')
      return false
    }
    pokemon.status = null
    appendLog(state, `${pokemon.name}의 얼음이 녹았다!`, 'heal')
  }

  if (pokemon.status?.id === 'paralysis' && random() < 0.25) {
    appendLog(state, `${pokemon.name}은(는) 몸이 저려 움직일 수 없다!`, 'status')
    return false
  }

  return true
}

function transformPokemon(state, pokemon, formId, mechanicId) {
  const fallbackOptions = getBattleFormOptions(pokemon.originalSpeciesId)
  const form = getSpeciesProfile(formId)
    ?? fallbackOptions.find((option) => (
      mechanicId === 'primal' ? option.slug.includes('-primal') : option.slug.includes('-mega')
    ))
  if (!form) return false

  const hpRatio = pokemon.hp / pokemon.maxHp
  const transformed = normalizePokemon({
    ...pokemon,
    speciesId: form.id,
    ability: form.abilities[0],
    moves: pokemon.moves.map((move) => move.name),
  })
  const nextStats = statObject(transformed)
  pokemon.speciesId = form.id
  pokemon.name = form.name
  pokemon.types = [...form.types]
  pokemon.ability = form.abilities[0]
  pokemon.stats = nextStats
  pokemon.maxHp = nextStats.hp
  pokemon.originalMaxHp = nextStats.hp
  pokemon.hp = Math.max(1, Math.ceil(pokemon.maxHp * hpRatio))
  pokemon.spriteFront = transformed.spriteFront
  pokemon.spriteBack = transformed.spriteBack
  pokemon.spriteFrontFallback = transformed.spriteFrontFallback
  pokemon.spriteBackFallback = transformed.spriteBackFallback
  pokemon.megaActive = mechanicId === 'mega'
  pokemon.primalActive = mechanicId === 'primal'
  return true
}

function inferConfiguredMechanics(pokemon) {
  return pokemon.battleMechanics.map((mechanic) => {
    if (mechanic === 'terastallization') return 'tera'
    if (mechanic === 'mega-evolution') return 'mega'
    if (mechanic === 'z-move') return 'zmove'
    if (mechanic === 'primal-reversion') return 'primal'
    if (mechanic === 'gigantamax' || mechanic === 'dynamax') return 'dynamax'
    return null
  }).filter(Boolean)
}

export function getAvailableBattleMechanics(state, sideId = 'player') {
  if (!state || state.winner) return []
  const side = getSide(state, sideId)
  const pokemon = getActivePokemon(state, sideId)
  if (!pokemon || pokemon.fainted) return []
  const configured = sideId === 'opponent' ? inferConfiguredMechanics(pokemon) : []
  const available = []
  const allow = (mechanicId) => sideId === 'player' || configured.includes(mechanicId)

  if (!side.usedMechanics.tera && allow('tera')) {
    available.push({ id: 'tera', label: `테라스탈 · ${pokemon.teraType}`, shortLabel: 'TERA' })
  }

  if (!side.usedMechanics.dynamax && allow('dynamax')) {
    available.push({
      id: 'dynamax',
      label: pokemon.dynamaxMode === 'gigantamax' ? '거다이맥스' : '다이맥스',
      shortLabel: pokemon.dynamaxMode === 'gigantamax' ? 'G-MAX' : 'D-MAX',
    })
  }

  const formOptions = getBattleFormOptions(pokemon.originalSpeciesId)
  const hasMegaForm = Boolean(pokemon.gimmickFormId || formOptions.some((form) => form.slug.includes('-mega')))
  const hasPrimalForm = Boolean(pokemon.gimmickFormId || formOptions.some((form) => form.slug.includes('-primal')))
  const hasMegaStone = pokemon.heldItemId?.includes('ite') || configured.includes('mega')
  const hasZCrystal = pokemon.heldItemId?.includes('-z') || pokemon.heldItemId?.includes('ium-z') || configured.includes('zmove')

  if (!side.usedMechanics.mega && allow('mega') && hasMegaForm && hasMegaStone) {
    available.push({ id: 'mega', label: '메가진화', shortLabel: 'MEGA' })
  }
  if (!side.usedMechanics.primal && allow('primal') && hasPrimalForm) {
    available.push({ id: 'primal', label: '원시회귀', shortLabel: 'PRIMAL' })
  }
  if (!side.usedMechanics.zmove && allow('zmove') && hasZCrystal) {
    available.push({ id: 'zmove', label: 'Z기술', shortLabel: 'Z-MOVE' })
  }

  return available
}

function activateMechanic(state, sideId, mechanicId) {
  if (!mechanicId) return 1
  const available = getAvailableBattleMechanics(state, sideId)
  if (!available.some((mechanic) => mechanic.id === mechanicId)) return 1
  const side = getSide(state, sideId)
  const pokemon = getActivePokemon(state, sideId)
  const trainerName = sideId === 'player' ? '플레이어' : side.name

  if (mechanicId === 'tera') {
    side.usedMechanics.tera = true
    pokemon.teraActive = true
    pokemon.types = [pokemon.teraType]
    appendLog(state, `${trainerName}의 ${pokemon.name}이(가) ${pokemon.teraType}타입으로 테라스탈했다!`, 'gimmick')
  } else if (mechanicId === 'dynamax') {
    side.usedMechanics.dynamax = true
    pokemon.dynamaxActive = true
    pokemon.dynamaxTurns = 3
    pokemon.hp += pokemon.maxHp
    pokemon.maxHp *= 2
    appendLog(
      state,
      `${trainerName}의 ${pokemon.name}이(가) ${pokemon.dynamaxMode === 'gigantamax' ? '거다이맥스' : '다이맥스'}했다!`,
      'gimmick',
    )
  } else if (mechanicId === 'mega' || mechanicId === 'primal') {
    if (transformPokemon(state, pokemon, pokemon.gimmickFormId, mechanicId)) {
      side.usedMechanics[mechanicId] = true
      appendLog(state, `${trainerName}의 ${pokemon.name}! ${MECHANIC_LABELS[mechanicId]} 성공!`, 'gimmick')
    }
  } else if (mechanicId === 'zmove') {
    side.usedMechanics.zmove = true
    appendLog(state, `${trainerName}와 ${pokemon.name}의 전력! Z파워가 기술에 모인다!`, 'gimmick')
    return 1.65
  }

  state.lastEvent = {
    kind: 'gimmick',
    sideId,
    mechanicId,
    nonce: state.eventNonce += 1,
  }
  return mechanicId === 'dynamax' ? 1.3 : 1
}

function executeMove(state, sideId, action, random, timeline = null, actionOrder = 0) {
  const side = getSide(state, sideId)
  const targetSide = getOtherSide(state, sideId)
  const attacker = side.team[side.activeIndex]
  const defender = targetSide.team[targetSide.activeIndex]
  const move = attacker.moves[action.moveIndex]
  const moveCategory = move?.categoryId
    ?? (move?.category === '물리' ? 'physical' : move?.category === '변화' ? 'status' : 'special')

  if (!move || move.currentPp <= 0 || attacker.fainted || defender.fainted) return
  if (!canPokemonAct(state, attacker, random)) {
    pushTimelineStep(timeline, state, {
      phase: 'status',
      actionOrder,
      sideId,
      targetSideId: sideId,
      actorName: attacker.name,
      moveName: move.name,
      moveType: move.type,
      moveCategory,
      message: latestLogMessage(state, `${attacker.name}은(는) 움직일 수 없다!`),
    })
    return
  }

  const mechanicWasUsed = action.gimmick ? side.usedMechanics[action.gimmick] : false
  const powerMultiplier = activateMechanic(state, sideId, action.gimmick)
  if (action.gimmick && !mechanicWasUsed && side.usedMechanics[action.gimmick]) {
    pushTimelineStep(timeline, state, {
      phase: 'gimmick',
      actionOrder,
      sideId,
      targetSideId: sideId,
      actorName: attacker.name,
      mechanicId: action.gimmick,
      message: latestLogMessage(state, `${attacker.name}의 배틀 기믹이 발동했다!`),
    })
  }

  move.currentPp = Math.max(0, move.currentPp - 1)
  appendLog(state, `${attacker.name}의 ${move.name}!`, sideId === 'player' ? 'player' : 'opponent')

  const moveStep = {
    actionOrder,
    sideId,
    targetSideId: move.target === 'self' ? sideId : targetSide.id,
    actorName: attacker.name,
    targetName: move.target === 'self' ? attacker.name : defender.name,
    moveId: move.id,
    moveName: move.name,
    moveType: move.type,
    moveCategory,
    movePower: Number(move.power) || 0,
    moveTarget: move.target,
    moveFlags: [...(move.flags ?? [])],
    moveDescription: move.description ?? '',
    message: `${attacker.name}의 ${move.name}!`,
  }
  pushTimelineStep(timeline, state, { phase: 'announce', ...moveStep })
  pushTimelineStep(timeline, state, { phase: 'attack', ...moveStep })

  const accuracy = move.accuracy == null ? 100 : Number(move.accuracy)
  const hustleAccuracy = attacker.ability === '의욕' && (move.categoryId === 'physical' || move.category === '물리')
    ? 0.8
    : 1

  if (random() * 100 >= accuracy * hustleAccuracy) {
    appendLog(state, `${attacker.name}의 공격은 빗나갔다!`, 'muted')
    pushTimelineStep(timeline, state, {
      phase: 'resolve',
      ...moveStep,
      result: 'miss',
      message: latestLogMessage(state, '공격은 빗나갔다!'),
    })
    return
  }

  const isStatusMove = move.categoryId === 'status' || move.category === '변화' || Number(move.power) === 0
  if (isStatusMove) {
    if (move.target !== 'self' && defender.protected) {
      appendLog(state, `${defender.name}은(는) 공격을 막아냈다!`, 'muted')
      pushTimelineStep(timeline, state, {
        phase: 'resolve',
        ...moveStep,
        result: 'blocked',
        message: latestLogMessage(state, `${defender.name}은(는) 공격을 막아냈다!`),
      })
      return
    }
    applyStatusMove(state, attacker, defender, move, random)
    pushTimelineStep(timeline, state, {
      phase: 'status',
      ...moveStep,
      message: latestLogMessage(state, `${move.name}의 효과가 발동했다!`),
    })
    return
  }

  attacker.protectChain = 0

  if (defender.protected) {
    appendLog(state, `${defender.name}은(는) 공격을 막아냈다!`, 'muted')
    pushTimelineStep(timeline, state, {
      phase: 'resolve',
      ...moveStep,
      result: 'blocked',
      message: latestLogMessage(state, `${defender.name}은(는) 공격을 막아냈다!`),
    })
    return
  }

  const immunity = abilityImmunity(defender, move.type)
  if (immunity) {
    appendLog(state, `${defender.name}의 ${immunity}! 공격을 무효화했다.`, 'ability')
    if (['저수', '축전'].includes(immunity)) healPokemon(state, defender, defender.maxHp / 4, immunity)
    pushTimelineStep(timeline, state, {
      phase: 'resolve',
      ...moveStep,
      result: 'immune',
      effectiveness: 0,
      message: latestLogMessage(state, `${defender.name}에게는 효과가 없다!`),
    })
    return
  }

  const result = calculateDamage(attacker, defender, move, random, powerMultiplier)
  let damage = result.damage

  if (damage >= defender.hp && defender.hp === defender.maxHp) {
    if (defender.ability === '옹골참') {
      damage = defender.hp - 1
      appendLog(state, `${defender.name}은(는) 옹골참으로 버텼다!`, 'ability')
    } else if (defender.heldItemId === 'focus-sash' && !defender.consumedItem) {
      damage = defender.hp - 1
      defender.consumedItem = true
      appendLog(state, `${defender.name}은(는) 기합의띠로 버텼다!`, 'item')
    }
  }

  defender.hp = Math.max(0, defender.hp - damage)
  state.lastEvent = {
    kind: 'hit',
    sideId,
    targetSideId: targetSide.id,
    damage,
    effectiveness: result.effectiveness,
    nonce: state.eventNonce += 1,
  }

  if (result.critical) appendLog(state, '급소에 맞았다!', 'critical')
  if (result.effectiveness > 1) appendLog(state, '효과가 굉장했다!', 'super')
  if (result.effectiveness === 0) appendLog(state, `${defender.name}에게는 효과가 없는 것 같다…`, 'muted')
  else if (result.effectiveness < 1) appendLog(state, '효과가 별로인 듯하다…', 'muted')

  if (damage > 0 && move.flags?.includes('heal')) {
    const drainRatio = move.id === 'drainingkiss' ? 0.75 : 0.5
    healPokemon(state, attacker, damage * drainRatio, move.name)
  }

  if (damage > 0 && (move.description?.includes('자신도') || move.description?.includes('반동'))) {
    const recoil = Math.max(1, Math.floor(damage / 3))
    attacker.hp = Math.max(0, attacker.hp - recoil)
    appendLog(state, `${attacker.name}은(는) 반동으로 ${recoil}의 데미지를 입었다.`, 'damage')
  }

  if (damage > 0 && attacker.heldItemId === 'life-orb') {
    const recoil = Math.max(1, Math.floor(attacker.maxHp / 10))
    attacker.hp = Math.max(0, attacker.hp - recoil)
    appendLog(state, `${attacker.name}은(는) 생명의구슬로 HP가 줄었다.`, 'item')
  }

  if (defender.hp > 0) secondaryStatusFromDescription(state, attacker, defender, move, random)

  pushTimelineStep(timeline, state, {
    phase: 'impact',
    ...moveStep,
    damage,
    effectiveness: result.effectiveness,
    critical: result.critical,
    message: damage > 0
      ? `${defender.name}에게 ${damage}의 데미지!`
      : `${defender.name}에게는 효과가 없는 것 같다…`,
  })
}

function endDynamax(state, pokemon) {
  if (!pokemon.dynamaxActive) return
  pokemon.dynamaxActive = false
  pokemon.dynamaxTurns = 0
  pokemon.hp = Math.max(1, Math.ceil(pokemon.hp / 2))
  pokemon.maxHp = pokemon.originalMaxHp
  appendLog(state, `${pokemon.name}의 다이맥스가 풀렸다.`, 'muted')
}

function activateEntryAbility(state, sideId) {
  const pokemon = getActivePokemon(state, sideId)
  const target = getActivePokemon(state, sideId === 'player' ? 'opponent' : 'player')
  if (!pokemon || !target || target.fainted) return

  if (pokemon.ability === '위협') {
    changeStages(state, target, { attack: -1 })
    appendLog(state, `${pokemon.name}의 위협!`, 'ability')
  }
}

function performSwitch(state, sideId, targetIndex, isAutomatic = false, timeline = null, actionOrder = null) {
  const side = getSide(state, sideId)
  const current = side.team[side.activeIndex]
  const target = side.team[targetIndex]
  if (!target || target.fainted || target.hp <= 0 || targetIndex === side.activeIndex) return false

  pushTimelineStep(timeline, state, {
    phase: 'switch-out',
    actionOrder,
    sideId,
    targetSideId: sideId,
    actorName: current.name,
    targetName: target.name,
    message: sideId === 'player'
      ? `${current.name}, 돌아와!`
      : `${side.name}은(는) ${current.name}을(를) 불러들였다!`,
  })

  if (current.dynamaxActive) endDynamax(state, current)
  current.statStages = Object.fromEntries(Object.keys(current.statStages).map((key) => [key, 0]))
  current.protected = false
  current.flinched = false
  side.activeIndex = targetIndex
  target.statStages = Object.fromEntries(Object.keys(target.statStages).map((key) => [key, 0]))
  appendLog(
    state,
    sideId === 'player'
      ? `${target.name}! 부탁해!`
      : `${side.name}은(는) ${target.name}을(를) 내보냈다!`,
    isAutomatic ? 'switch' : sideId,
  )
  activateEntryAbility(state, sideId)
  state.lastEvent = { kind: 'switch', sideId, nonce: state.eventNonce += 1 }
  pushTimelineStep(timeline, state, {
    phase: 'switch',
    actionOrder,
    sideId,
    targetSideId: sideId,
    actorName: target.name,
    message: latestLogMessage(state, `${target.name}이(가) 배틀에 나왔다!`),
  })
  return true
}

function residualEffects(state, sideId, timeline = null) {
  const pokemon = getActivePokemon(state, sideId)
  if (!pokemon || pokemon.fainted || pokemon.hp <= 0) return
  const previousHp = pokemon.hp
  const previousMaxHp = pokemon.maxHp
  const previousLogLength = state.log.length

  let damage = 0
  if (pokemon.status?.id === 'burn') damage = Math.max(1, Math.floor(pokemon.maxHp / 16))
  if (pokemon.status?.id === 'poison') damage = Math.max(1, Math.floor(pokemon.maxHp / 8))
  if (pokemon.status?.id === 'toxic') {
    damage = Math.max(1, Math.floor((pokemon.maxHp * pokemon.status.toxicCounter) / 16))
    pokemon.status.toxicCounter += 1
  }

  if (damage > 0) {
    pokemon.hp = Math.max(0, pokemon.hp - damage)
    appendLog(state, `${pokemon.name}은(는) ${pokemon.status.label}의 데미지를 입었다.`, 'damage')
  }

  if (pokemon.hp > 0 && pokemon.heldItemId === 'leftovers') {
    healPokemon(state, pokemon, pokemon.maxHp / 16, '먹다남은음식')
  }
  if (pokemon.hp > 0 && pokemon.heldItemId === 'black-sludge' && pokemon.types.includes('독')) {
    healPokemon(state, pokemon, pokemon.maxHp / 16, '검은오물')
  }
  if (
    pokemon.hp > 0
    && pokemon.hp <= pokemon.maxHp / 2
    && pokemon.heldItemId === 'sitrus-berry'
    && !pokemon.consumedItem
  ) {
    pokemon.consumedItem = true
    healPokemon(state, pokemon, pokemon.maxHp / 4, '자뭉열매')
  }

  if (pokemon.dynamaxActive) {
    pokemon.dynamaxTurns -= 1
    if (pokemon.dynamaxTurns <= 0) endDynamax(state, pokemon)
  }

  if (state.log.length > previousLogLength || pokemon.hp !== previousHp || pokemon.maxHp !== previousMaxHp) {
    pushTimelineStep(timeline, state, {
      phase: 'residual',
      sideId,
      targetSideId: sideId,
      actorName: pokemon.name,
      damage: Math.max(0, previousHp - pokemon.hp),
      message: latestLogMessage(state, `${pokemon.name}에게 턴 종료 효과가 적용되었다.`),
    })
  }
}

function settleFaints(state, timeline = null) {
  const faintedPokemon = []
  ;['player', 'opponent'].forEach((sideId) => {
    const pokemon = getActivePokemon(state, sideId)
    if (!pokemon || pokemon.hp > 0 || pokemon.fainted) return
    pokemon.fainted = true
    appendLog(state, `${pokemon.name}은(는) 쓰러졌다!`, 'faint')
    faintedPokemon.push({ sideId, name: pokemon.name })
  })

  faintedPokemon.forEach(({ sideId, name }) => {
    pushTimelineStep(timeline, state, {
      phase: 'faint',
      sideId: sideId === 'player' ? 'opponent' : 'player',
      targetSideId: sideId,
      actorName: name,
      message: `${name}은(는) 쓰러졌다!`,
    })
  })

  const playerRemaining = remainingCount(state.player)
  const opponentRemaining = remainingCount(state.opponent)

  if (playerRemaining === 0 || opponentRemaining === 0) {
    state.winner = playerRemaining > 0 ? 'player' : 'opponent'
    state.phase = 'complete'
    appendLog(
      state,
      state.winner === 'player' ? `${state.opponent.name}과의 승부에서 이겼다!` : `${state.opponent.name}에게 패배했다…`,
      state.winner === 'player' ? 'victory' : 'defeat',
    )
    pushTimelineStep(timeline, state, {
      phase: 'result',
      sideId: state.winner,
      message: latestLogMessage(state, '배틀이 끝났다!'),
    })
    return
  }

  const opponentActive = getActivePokemon(state, 'opponent')
  if (opponentActive.fainted) {
    const nextIndex = availableIndexes(state.opponent)[0]
    performSwitch(state, 'opponent', nextIndex, true, timeline)
  }

  const playerActive = getActivePokemon(state, 'player')
  state.awaitingPlayerSwitch = playerActive.fainted
  if (state.awaitingPlayerSwitch) {
    appendLog(state, '다음 포켓몬을 선택해 주세요.', 'prompt')
    pushTimelineStep(timeline, state, {
      phase: 'prompt',
      sideId: 'player',
      targetSideId: 'player',
      message: '다음 포켓몬을 선택해 주세요.',
    })
  }
}

function actionPriority(state, sideId, action) {
  if (action.type === 'switch') return 10
  const pokemon = getActivePokemon(state, sideId)
  const move = pokemon.moves[action.moveIndex]
  return Number(move?.priority ?? 0)
}

function orderedActions(state, playerAction, opponentAction, random) {
  const first = { sideId: 'player', action: playerAction }
  const second = { sideId: 'opponent', action: opponentAction }
  const playerPriority = actionPriority(state, 'player', playerAction)
  const opponentPriority = actionPriority(state, 'opponent', opponentAction)

  if (playerPriority !== opponentPriority) return playerPriority > opponentPriority ? [first, second] : [second, first]

  const playerSpeed = effectiveStat(getActivePokemon(state, 'player'), 'speed')
  const opponentSpeed = effectiveStat(getActivePokemon(state, 'opponent'), 'speed')
  if (playerSpeed !== opponentSpeed) return playerSpeed > opponentSpeed ? [first, second] : [second, first]
  return random() < 0.5 ? [first, second] : [second, first]
}

function scoreMove(attacker, defender, move) {
  if (move.currentPp <= 0) return -Infinity
  const isStatus = move.categoryId === 'status' || move.category === '변화' || Number(move.power) === 0
  if (isStatus) {
    if (PROTECT_MOVE_IDS.has(move.id) && attacker.hp < attacker.maxHp * 0.4) return 55
    if ((HEAL_MOVE_IDS.has(move.id) || move.flags?.includes('heal')) && attacker.hp < attacker.maxHp * 0.55) return 90
    if (STATUS_MOVE_EFFECTS[move.id]) return 48
    return 32
  }

  const effectiveness = getTypeEffectiveness(move.type, defender.types)
  const category = move.categoryId ?? (move.category === '물리' ? 'physical' : 'special')
  const offense = category === 'physical' ? effectiveStat(attacker, 'attack') : effectiveStat(attacker, 'specialAttack')
  const defense = category === 'physical' ? effectiveStat(defender, 'defense') : effectiveStat(defender, 'specialDefense')
  return (Number(move.power) || 1) * effectiveness * (offense / Math.max(1, defense)) * ((move.accuracy ?? 100) / 100)
}

export function chooseAiAction(state, random = Math.random) {
  const attacker = getActivePokemon(state, 'opponent')
  const defender = getActivePokemon(state, 'player')
  const scoredMoves = attacker.moves
    .map((move, moveIndex) => ({ moveIndex, score: scoreMove(attacker, defender, move) + random() * 8 }))
    .sort((first, second) => second.score - first.score)
  const availableMechanics = getAvailableBattleMechanics(state, 'opponent')
  const configuredMechanic = availableMechanics[0]

  if (
    attacker.hp < attacker.maxHp * 0.2
    && remainingCount(state.opponent) > 1
    && random() < 0.12
  ) {
    const switchOptions = availableIndexes(state.opponent).filter((index) => index !== state.opponent.activeIndex)
    return { type: 'switch', targetIndex: switchOptions[Math.floor(random() * switchOptions.length)] }
  }

  return {
    type: 'move',
    moveIndex: scoredMoves[0]?.moveIndex ?? 0,
    gimmick: configuredMechanic?.id ?? null,
  }
}

export function createBattle({ playerPokemon, opponent, opponentTeam }) {
  const player = createSide('player', 'PLAYER_01', playerPokemon)
  const opponentSide = createSide(
    'opponent',
    opponent.name,
    opponentTeam.pokemon,
    opponentTeam.battleGimmicks,
    opponentTeam.strategy?.lead,
  )
  const state = {
    turn: 1,
    phase: 'command',
    player,
    opponent: opponentSide,
    opponentMeta: opponent,
    opponentStrategy: opponentTeam.strategy,
    awaitingPlayerSwitch: false,
    winner: null,
    log: [],
    lastEvent: null,
    eventNonce: 0,
  }

  appendLog(state, `${opponent.name}이(가) 승부를 걸어왔다!`, 'opponent')
  appendLog(state, `${opponent.name}은(는) ${getActivePokemon(state, 'opponent').name}을(를) 내보냈다!`, 'opponent')
  appendLog(state, `${getActivePokemon(state, 'player').name}! 너로 정했다!`, 'player')
  activateEntryAbility(state, 'opponent')
  activateEntryAbility(state, 'player')
  return state
}

function resolveBattleTurn(state, playerAction, random, captureTimeline) {
  if (!state || state.winner || state.awaitingPlayerSwitch) {
    return { state, timeline: [] }
  }

  const nextState = cloneBattle(state)
  const timeline = captureTimeline ? [] : null
  nextState.lastEvent = null
  getActivePokemon(nextState, 'player').protected = false
  getActivePokemon(nextState, 'opponent').protected = false
  getActivePokemon(nextState, 'player').flinched = false
  getActivePokemon(nextState, 'opponent').flinched = false
  const opponentAction = chooseAiAction(nextState, random)
  const actions = orderedActions(nextState, playerAction, opponentAction, random)

  for (const [actionOrder, { sideId, action }] of actions.entries()) {
    if (nextState.winner) break
    const actor = getActivePokemon(nextState, sideId)
    if (!actor || actor.fainted || actor.hp <= 0) continue

    if (action.type === 'switch') {
      performSwitch(nextState, sideId, action.targetIndex, false, timeline, actionOrder)
    } else {
      executeMove(nextState, sideId, action, random, timeline, actionOrder)
    }
  }

  residualEffects(nextState, 'player', timeline)
  residualEffects(nextState, 'opponent', timeline)
  settleFaints(nextState, timeline)
  nextState.turn += 1
  return { state: nextState, timeline: timeline ?? [] }
}

export function createBattleTurnTimeline(state, playerAction, random = Math.random) {
  return resolveBattleTurn(state, playerAction, random, true)
}

export function playBattleTurn(state, playerAction, random = Math.random) {
  return resolveBattleTurn(state, playerAction, random, false).state
}

export function forcePlayerSwitch(state, targetIndex) {
  if (!state || state.winner || !state.awaitingPlayerSwitch) return state
  const nextState = cloneBattle(state)
  if (!performSwitch(nextState, 'player', targetIndex, true)) return state
  nextState.awaitingPlayerSwitch = false
  return nextState
}

export function getBattleSummary(state) {
  return {
    winner: state.winner,
    playerRemaining: remainingCount(state.player),
    opponentRemaining: remainingCount(state.opponent),
    turns: Math.max(1, state.turn - 1),
  }
}

export { MECHANIC_LABELS, STATUS_LABELS }
