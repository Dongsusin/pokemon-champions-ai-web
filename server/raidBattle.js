import { createHash } from 'node:crypto'
import { createBattle, createBattlePreviewPokemon, playBattleTurnWithActions, getActivePokemonList, getBattleMoveSelectionState, getBattleMoveTargets, getBattleMovePreview, getAvailableBattleMechanics, getForcedBattleAction, getBattleStruggleAction, chooseRaidEngineAction, getEffectiveBattleWeatherId, getTypeEffectiveness } from '../src/data/battleEngine.js'
import { normalizePokemon, getSpeciesProfile, getMoveById, getLearnableMoves } from '../src/data/trainingData.js'
import { canonicalizeRankedTeam } from './rankedBattle.js'
import { RAID_BOSSES, RAID_NPCS, RAID_DEFAULTS, RAID_SCHEMA_VERSION, RAID_ENGINE_VERSION, RAID_RULE_VERSION, getRaidBoss } from '../src/data/raidRules.js'
import { raidEvent } from '../src/data/raidPolicy.js'
import { RAID_PRESENTATION_ENVIRONMENT_FIELDS } from '../src/data/raidPresentation.js'

export { RAID_BOSSES, RAID_DEFAULTS }
export function raidRandom(seed) {
  let value = createHash('sha256').update(String(seed)).digest().readUInt32LE(0)
  return () => { value += 0x6D2B79F5; let t = value; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296 }
}
function invalid(message, status = 400) { const error = new Error(message); error.code = 'invalid-raid-command'; error.status = status; throw error }
function assertVersion(battle) {
  if (battle?.raid?.schemaVersion !== RAID_SCHEMA_VERSION || battle.raid.engineVersion !== RAID_ENGINE_VERSION || battle.raid.ruleVersion !== RAID_RULE_VERSION) invalid('이 보스전 기록의 버전을 지원하지 않습니다. 기록은 보존됩니다.', 409)
}
export function createRaidPreset(entry, captureId) {
  const profile = getSpeciesProfile(entry.speciesId)
  if (!profile) throw new Error(`Unknown raid species: ${entry.speciesId}`)
  const learnable = new Set(getLearnableMoves(profile.id).map((move) => move.id))
  for (const id of entry.moves) if (!getMoveById(id) || !learnable.has(id)) throw new Error(`Invalid raid move ${profile.slug}/${id}`)
  const moves = entry.moves.map(id => getMoveById(id))
  const physical = moves.filter(move => move.category === '물리').length
  const special = moves.filter(move => move.category === '특수').length
  const attackKey = physical > special ? 'attack' : 'specialAttack'
  return normalizePokemon({ captureId, speciesId: profile.id, moves: moves.map(move => move.name), ability: profile.abilities[0], nature: '노력', teraType: profile.types[0], trainingPoints: { hp: 32, attack: 0, defense: 0, specialAttack: 0, specialDefense: 0, speed: 0, [attackKey]: 32 } })
}
function rules() { return { raid: true, pvp: true, weather: { id: 'clear', label: '맑음' }, terrain: { id: 'neutral', label: '일반 필드' }, format: { id: 'raid', label: '협동 보스전', activeSlots: 3, actionSlots: 3 }, teamRule: { id: 'raid', label: '3인 협동', battleSize: 3 }, disabledGimmickId: null, gimmickRestriction: { id: null, label: '참가자마다 단계별 1회' }, aiDifficulty: { id: 'normal', label: '보스전', boostStage: 0 } } }
function createStage(raidId, bossId, members, phase, seed) {
  const boss = getRaidBoss(bossId)
  if (!boss) invalid('존재하지 않는 보스입니다.')
  const enemies = phase === 1 ? boss.stageOne : [{ speciesId: boss.speciesId, moves: boss.moves, trainer: boss.name }]
  const random = raidRandom(seed)
  const battle = createBattle({ playerPokemon: members.map((member, index) => ({ ...member.pokemon, captureId: `raid-ally-${index}` })), playerName: '협동 트레이너', opponent: { id: `raid-${bossId}`, name: phase === 1 ? `${boss.name} 전초전` : boss.name, tier: 'S' }, opponentTeam: { pokemon: enemies.map((entry, index) => createRaidPreset(entry, `raid-enemy-${phase}-${index}`)), battleGimmicks: [], strategy: {} }, rules: rules(), random })
  battle.raid = { raidId, bossId, phase, phaseEpoch: phase, schemaVersion: RAID_SCHEMA_VERSION, engineVersion: RAID_ENGINE_VERSION, ruleVersion: RAID_RULE_VERSION, members: structuredClone(members), usedMechanicsByOwner: {}, primaryBossId: phase === 2 ? battle.opponent.team[0].battleId : null, crossedGates: [], firedMechanics: [], pendingGates: [], events: [], eventSequence: 0, totalTurns: 0 }
  battle.player.team.forEach((actor, index) => { actor.raidOwnerId = members[index].ownerId; actor.raidDisplayName = members[index].displayName; actor.raidNpc = Boolean(members[index].isNpc) })
  battle.opponent.team.forEach((actor, index) => { actor.raidDisplayName = enemies[index].trainer })
  if (phase === 2) {
    const actor = battle.opponent.team[0]
    actor.baseRaidMaxHp = Math.ceil(actor.maxHp * RAID_DEFAULTS.bossHpMultiplier / 8) * 8
    actor.maxHp = actor.baseRaidMaxHp; actor.baseMaxHp = actor.maxHp; actor.originalMaxHp = actor.maxHp; actor.stats.hp = actor.maxHp; actor.hp = actor.maxHp; actor.raidVitalityStage = 0
    battle.raid.summonPool = boss.stageOne.map((entry, index) => { const summoned = createBattlePreviewPokemon(createRaidPreset(entry, `raid-summon-${index}`)); summoned.battleId = `raid-summon-${index}`; summoned.raidDisplayName = entry.trainer; return summoned })
    const order = [0, 1, 2]
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]] }
    battle.raid.reviveOrder = order
  }
  raidEvent(battle, 'stage-start', `${boss.name} ${phase === 1 ? '전초전' : '본 보스전'}을 시작합니다.`)
  return battle
}
export function createRaidBattle({ raidId, bossId, members, npcRoles = [], seed = 'raid' }) {
  if (!Array.isArray(members) || members.length < 1 || members.length > 3 || new Set(members.map((m) => m.ownerId)).size !== members.length) invalid('참가자는 1~3명이어야 합니다.')
  const registered = members.map((member) => ({ ownerId: String(member.ownerId), displayName: String(member.displayName || '트레이너').slice(0, 24), isNpc: Boolean(member.isNpc), pokemon: canonicalizeRankedTeam([member.pokemon], { registeredSize: 1 })[0] }))
  while (registered.length < 3) {
    const i = registered.length
    const role = npcRoles[i - members.length] ?? (i === 2 ? 'support' : 'attack')
    const candidates = RAID_NPCS.filter((preset) => role === 'support' ? preset.role === 'support' : preset.role !== 'support')
    const commonWeakness = (preset) => {
      const types = getSpeciesProfile(preset.speciesId).types
      return ['불꽃', '물', '전기', '풀', '얼음', '격투', '독', '땅', '비행', '에스퍼', '벌레', '바위', '고스트', '드래곤', '악', '강철', '페어리'].reduce((sum, type) => sum + (getTypeEffectiveness(type, types) > 1 ? registered.filter((member) => getTypeEffectiveness(type, member.pokemon.types) > 1).length : 0), 0)
    }
    const preset = candidates.sort((a, b) => commonWeakness(a) - commonWeakness(b))[0] ?? RAID_NPCS[1]
    registered.push({ ownerId: `npc-${i}`, displayName: preset.role === 'support' ? '지원 AI' : '공격 AI', isNpc: true, pokemon: createRaidPreset(preset, `npc-${i}`) })
  }
  return createStage(String(raidId), bossId, registered, 1, seed)
}
export function startRaidBossStage(battle, { seed = 'boss-stage' } = {}) {
  assertVersion(battle)
  if (battle.raid.phase === 2) return structuredClone(battle)
  if (getRaidOutcome(battle) !== 'stage-cleared') invalid('전초전을 먼저 완료해 주세요.', 409)
  const next = createStage(battle.raid.raidId, battle.raid.bossId, battle.raid.members, 2, seed)
  next.raid.totalTurns = battle.raid.totalTurns
  next.raid.eventSequence = battle.raid.eventSequence
  next.raid.events = structuredClone(battle.raid.events)
  raidEvent(next, 'stage-transition', '전초전 완료! 같은 아군의 HP·PP·상태와 기믹을 회복하고 본 보스전에 돌입합니다.')
  return next
}
export function getRaidOutcome(battle) {
  assertVersion(battle)
  const alliesAlive = battle.player.team.some((p) => p.hp > 0 && !p.fainted)
  if (!alliesAlive) return 'lost'
  if (battle.raid.phase === 1 && battle.opponent.team.every((p) => p.hp <= 0 || p.fainted)) return 'stage-cleared'
  if (battle.raid.phase === 2 && battle.opponent.team.find((p) => p.battleId === battle.raid.primaryBossId)?.hp <= 0) return 'won'
  if (battle.winner === 'opponent' || battle.raid.totalTurns >= RAID_DEFAULTS.totalTurnLimit || battle.turn > RAID_DEFAULTS.stageTurnLimit) return 'lost'
  return null
}
function ownedActor(battle, ownerId) { return battle.player.team.find((p) => p.raidOwnerId === ownerId) }
function actorLocation(battle, actorId) {
  for (const sideId of ['player', 'opponent']) { const slot = battle[sideId].activeIndexes.findIndex((index) => battle[sideId].team[index]?.battleId === actorId); if (slot >= 0) return { sideId, slot, actor: battle[sideId].team[battle[sideId].activeIndexes[slot]] } }
  return null
}
export function validateRaidCommand(battle, ownerId, command) {
  assertVersion(battle)
  const actor = ownedActor(battle, ownerId)
  if (!actor) invalid('자신의 포켓몬만 조작할 수 있습니다.', 403)
  if (command?.actorId && command.actorId !== actor.battleId) invalid('다른 참가자의 포켓몬을 조작할 수 없습니다.', 403)
  if (getRaidOutcome(battle) || actor.hp <= 0 || actor.fainted) invalid('현재 행동을 제출할 수 없습니다.', 409)
  const actorSlot = battle.player.activeIndexes.indexOf(battle.player.team.indexOf(actor))
  const forced = getForcedBattleAction(battle, 'player', actorSlot)
  if (forced) return { ...forced, actorSlot, actorId: actor.battleId }
  if (command?.type !== 'move' || !Number.isInteger(command.moveIndex)) invalid('기술을 선택해 주세요.')
  const gimmick = command.gimmickId ?? command.gimmick ?? null
  if (gimmick && !getAvailableBattleMechanics(battle, 'player', actorSlot).some((m) => m.id === gimmick)) invalid('사용할 수 없는 배틀 기믹입니다.')
  if (command.moveIndex === -1) { const struggle = getBattleStruggleAction(battle, 'player', actorSlot); if (!struggle) invalid('발버둥을 사용할 수 없습니다.'); return { ...struggle, actorSlot, actorId: actor.battleId } }
  if (command.moveIndex < 0 || command.moveIndex >= actor.moves.length) invalid('존재하지 않는 기술입니다.')
  const selection = getBattleMoveSelectionState(battle, 'player', command.moveIndex, actorSlot, gimmick)
  if (selection.disabled) invalid(selection.reason)
  const targets = getBattleMoveTargets(battle, 'player', command.moveIndex, actorSlot, gimmick)
  const selected = command.targetActorId ? actorLocation(battle, command.targetActorId) : null
  if (targets.length && (!selected || !targets.some((target) => target.sideId === selected.sideId && target.slot === selected.slot))) invalid('유효한 기술 대상을 선택해 주세요.')
  const fallback = targets[0] ?? { sideId: 'opponent', slot: 0 }
  return { type: 'move', actorId: actor.battleId, actorSlot, moveIndex: command.moveIndex, gimmick, gimmickId: gimmick, targetActorId: command.targetActorId ?? null, targetSideId: selected?.sideId ?? fallback.sideId, targetSlot: selected?.slot ?? fallback.slot }
}
export function chooseRaidCommand(battle, ownerId, { seed = 'auto' } = {}) {
  const actor = ownedActor(battle, ownerId)
  if (!actor || actor.hp <= 0 || actor.fainted) return null
  const slot = battle.player.activeIndexes.indexOf(battle.player.team.indexOf(actor))
  const action = chooseRaidEngineAction(battle, 'player', slot, raidRandom(seed))
  if (!action) return null
  const target = battle[action.targetSideId ?? 'opponent'].team[battle[action.targetSideId ?? 'opponent'].activeIndexes[action.targetSlot ?? 0]]
  return { ...action, actorId: actor.battleId, targetActorId: target?.battleId }
}
export function resolveRaidTurn(battle, commandsByOwner, { seed = 'turn' } = {}) {
  assertVersion(battle)
  if (getRaidOutcome(battle)) return structuredClone(battle)
  const random = raidRandom(seed)
  const working = structuredClone(battle)
  const player = working.raid.members.flatMap((member) => { const actor = ownedActor(working, member.ownerId); if (!actor || actor.hp <= 0 || actor.fainted) return []; const command = commandsByOwner?.[member.ownerId] ?? chooseRaidCommand(working, member.ownerId, { seed: `${seed}:${member.ownerId}` }); return command ? [validateRaidCommand(working, member.ownerId, command)] : [] })
  const opponent = getActivePokemonList(working, 'opponent').flatMap((actor, slot) => { const action = chooseRaidEngineAction(working, 'opponent', slot, random); return action ? [action] : [] })
  for (const action of player) action.raidTargetActorIds = getActivePokemonList(working, action.targetSideId ?? 'opponent').map((actor) => actor.battleId)
  const next = playBattleTurnWithActions(working, player, opponent, random)
  next.raid.totalTurns += 1
  const changes = ['player', 'opponent'].flatMap((sideId) => next[sideId].team.flatMap((actor) => {
    const before = battle[sideId].team.find((old) => old.battleId === actor.battleId)
    return !before || before.hp !== actor.hp || before.maxHp !== actor.maxHp || before.raidForm !== actor.raidForm ? [{ actorId: actor.battleId, sideId, beforeHp: before?.hp ?? null, hp: actor.hp, maxHp: actor.maxHp, form: actor.raidForm ?? null }] : []
  }))
  if (changes.length) raidEvent(next, 'turn-resolved', `${battle.turn}턴 행동이 처리되었습니다.`, { changes })
  next.log = next.log.slice(-100)
  const outcome = getRaidOutcome(next)
  if (outcome === 'won' && next.raid.bossId === 'hooh') {
    next.opponent.activeIndexes = [next.opponent.team.findIndex((actor) => actor.battleId === next.raid.primaryBossId)]
    next.raid.summonsRetreated = true
    raidEvent(next, 'summons-retreated', '칠색조가 쓰러져 소환수들이 전장을 떠났다.')
  }
  if (outcome) raidEvent(next, 'outcome', outcome === 'stage-cleared' ? '전초전 승리!' : outcome === 'won' ? '보스 격파 성공!' : '보스전 도전이 종료되었습니다.', { outcome })
  return next
}
const ACTOR_FIELDS = ['battleId', 'speciesId', 'originalSpeciesId', 'name', 'level', 'types', 'hp', 'maxHp', 'stats', 'statStages', 'status', 'fainted', 'ability', 'nature', 'heldItemId', 'heldItemName', 'teraType', 'teraActive', 'dynamaxActive', 'dynamaxMode', 'usedBattleMechanicId', 'raidForm', 'raidVitalityStage', 'baseRaidMaxHp', 'activeFromTurn', 'raidDisplayName', 'spriteFront', 'spriteBack', 'spriteFrontFallback', 'spriteBackFallback', 'isShiny']
function publicActor(actor, ownerId, index, sideId) { return { ...Object.fromEntries(ACTOR_FIELDS.filter((key) => actor[key] !== undefined).map((key) => [key, structuredClone(actor[key])])), actorId: actor.battleId, slot: index, sideId, isMine: actor.raidOwnerId === ownerId, isNpc: Boolean(actor.raidNpc), ownerId: sideId === 'player' ? `ally-${index + 1}` : null, displayName: actor.raidDisplayName ?? actor.name } }
export function getRaidBattleView(battle, ownerId) {
  assertVersion(battle)
  const actor = ownedActor(battle, ownerId)
  const ownActorSlot = actor ? battle.player.activeIndexes.indexOf(battle.player.team.indexOf(actor)) : -1
  const side = (id) => {
    const actors = getActivePokemonList(battle, id).filter((p) => id !== 'opponent' || battle.raid.bossId !== 'hooh' || getRaidOutcome(battle) !== 'won' || p.battleId === battle.raid.primaryBossId)
    return { id, name: battle[id].name, team: actors.map((p, i) => publicActor(p, ownerId, i, id)), activeIndexes: actors.map((_, index) => index) }
  }
  const optionsFor = (moveIndex, gimmick) => getBattleMoveTargets(battle, 'player', moveIndex, ownActorSlot, gimmick).map((target) => ({ actorId: target.target.battleId, sideId: target.sideId, slot: target.slot, name: target.target.name, friendly: target.sideId === 'player' }))
  const mechanics = actor && actor.hp > 0 ? getAvailableBattleMechanics(battle, 'player', ownActorSlot) : []
  const previewFields = ['id', 'name', 'type', 'category', 'categoryId', 'power', 'accuracy', 'accuracyLabel', 'currentPp', 'maxPp', 'description', 'target', 'isMaxMove', 'isGmaxMove', 'isZMove', 'zMoveCompatible']
  const variantFor = (moveIndex, gimmick = null) => {
    const preview = getBattleMovePreview(battle, 'player', moveIndex, ownActorSlot, 0, gimmick)
    return { ...getBattleMoveSelectionState(battle, 'player', moveIndex, ownActorSlot, gimmick), targets: optionsFor(moveIndex, gimmick),
      preview: preview ? Object.fromEntries(previewFields.filter(key => preview[key] !== undefined).map(key => [key, structuredClone(preview[key])])) : null }
  }
  const moves = actor?.moves.map((move, moveIndex) => {
    const variants = Object.fromEntries(mechanics.map(g => [g.id, variantFor(moveIndex, g.id)]))
    return { id: move.id, name: move.name, type: move.type, category: move.category, power: move.power, accuracy: move.accuracy,
      currentPp: move.currentPp, maxPp: move.maxPp, description: move.description, moveIndex, ...variantFor(moveIndex),
      friendlyFire: move.target === 'allAdjacent', variants,
      gimmickTargets: Object.fromEntries(Object.entries(variants).map(([id, variant]) => [id, variant.targets])) }
  }) ?? []
  return {
    turn: battle.turn, phase: battle.raid.phase, outcome: getRaidOutcome(battle),
    player: side('player'), opponent: side('opponent'), ownActorId: actor?.battleId ?? null, ownActorSlot, moves,
    mechanics, forcedAction: actor ? getForcedBattleAction(battle, 'player', ownActorSlot) : null,
    canStruggle: Boolean(actor && getBattleStruggleAction(battle, 'player', ownActorSlot)),
    rules: { ...structuredClone(battle.rules), raid: true },
    environment: Object.fromEntries(RAID_PRESENTATION_ENVIRONMENT_FIELDS.filter(key => battle.environment?.[key] !== undefined).map(key => [key, structuredClone(battle.environment[key])])),
    raid: {
      raidId: battle.raid.raidId, bossId: battle.raid.bossId, phase: battle.raid.phase, phaseEpoch: battle.raid.phaseEpoch,
      primaryBossId: battle.raid.primaryBossId, crossedGates: [...battle.raid.crossedGates], firedMechanics: [...battle.raid.firedMechanics],
      enraged: Boolean(battle.raid.enraged),
      weatherLock: battle.raid.weatherLock ? { ...battle.raid.weatherLock, suppressed: getEffectiveBattleWeatherId(battle) !== 'rain' } : null,
      events: structuredClone(battle.raid.events), eventSequence: battle.raid.eventSequence,
    },
    log: battle.log.map(({ message, tone }) => ({ message, tone })),
  }
}
