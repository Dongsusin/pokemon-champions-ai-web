// Compact, public battle frames. This module contains no account identifiers,
// private move sets, pending commands, or full battle snapshots.
export const RAID_PRESENTATION_ACTOR_FIELDS = Object.freeze([
  'battleId', 'speciesId', 'originalSpeciesId', 'name', 'level', 'types', 'hp', 'maxHp',
  'statStages', 'status', 'fainted', 'ability', 'nature', 'heldItemId', 'heldItemName',
  'teraType', 'teraActive', 'dynamaxActive', 'dynamaxMode', 'megaActive', 'primalActive',
  'usedBattleMechanicId', 'raidForm', 'raidVitalityStage', 'baseRaidMaxHp',
  'spriteFront', 'spriteBack', 'spriteFrontFallback', 'spriteBackFallback', 'isShiny',
])
export const RAID_PRESENTATION_ENVIRONMENT_FIELDS = Object.freeze([
  'weatherTurns', 'terrainTurns', 'weatherStrong', 'gravityTurns', 'trickRoomTurns',
  'wonderRoomTurns', 'magicRoomTurns', 'mudSportTurns', 'waterSportTurns', 'fairyLockTurns',
  'ionDelugeTurns',
])
const clone = value => structuredClone(value)
const pick = (value, fields) => Object.fromEntries(fields.filter(key => value?.[key] !== undefined).map(key => [key, clone(value[key])]))
const signature = value => JSON.stringify(value)
const publicRule = value => pick(value, ['id', 'label'])
const publicLog = entry => pick(entry, ['message', 'tone'])
const STAT_STAGE_FIELDS = ['attack', 'defense', 'specialAttack', 'specialDefense', 'speed', 'accuracy', 'evasion']

export function stampRaidPresentationLog(state, entry) {
  if (!state.raid) return entry
  const sequence = (state.raid.presentationLogSequence ?? 0) + 1
  state.raid.presentationLogSequence = sequence
  return { ...entry, raidLogSequence: sequence }
}

export function sanitizeRaidPresentation(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const result = {}
  if (input.resetActors === true) result.resetActors = true
  if (Array.isArray(input.actors)) result.actors = input.actors.slice(0, 6).flatMap(actor => {
    if (!actor || typeof actor.actorId !== 'string' || !['player', 'opponent'].includes(actor.sideId)) return []
    const safe = { ...pick(actor, RAID_PRESENTATION_ACTOR_FIELDS), actorId: actor.actorId,
      sideId: actor.sideId, slot: Math.max(0, Math.min(2, Math.trunc(actor.slot) || 0)) }
    if (actor.statStages) safe.statStages = pick(actor.statStages, STAT_STAGE_FIELDS)
    if (Array.isArray(actor.types)) safe.types = actor.types.filter(type => typeof type === 'string').slice(0, 3)
    return [safe]
  })
  if (Array.isArray(input.removedActorIds)) result.removedActorIds = input.removedActorIds.filter(id => typeof id === 'string').slice(0, 6)
  if (input.rules) result.rules = { weather: publicRule(input.rules.weather), terrain: publicRule(input.rules.terrain) }
  if (input.environment) result.environment = pick(input.environment, RAID_PRESENTATION_ENVIRONMENT_FIELDS)
  if (input.raid) {
    result.raid = pick(input.raid, ['phase', 'primaryBossId', 'enraged'])
    if (input.raid.weatherLock === null) result.raid.weatherLock = null
    else if (input.raid.weatherLock) result.raid.weatherLock = pick(input.raid.weatherLock, ['id', 'duration', 'suppressionAllowed', 'suppressed'])
  }
  if (Array.isArray(input.logs)) result.logs = input.logs.slice(-32).map(publicLog)
  return result
}

export function captureRaidPresentation(state, { reset = false } = {}) {
  const previous = reset ? null : state.raid.presentationFrame
  const actors = ['player', 'opponent'].flatMap(sideId => {
    const side = state[sideId]
    return (side.activeIndexes ?? [side.activeIndex ?? 0]).flatMap((index, slot) => {
      const actor = side.team[index]
      if (!actor) return []
      // Explicit nulls let an item, major status, or old form disappear during
      // playback; omission would incorrectly retain the previous value.
      return [{ ...Object.fromEntries(RAID_PRESENTATION_ACTOR_FIELDS.map(key => [key, clone(actor[key] ?? null)])),
        actorId: actor.battleId, sideId, slot }]
    })
  })
  const current = {
    actors: Object.fromEntries(actors.map(actor => [actor.actorId, actor])),
    rules: { weather: publicRule(state.rules?.weather), terrain: publicRule(state.rules?.terrain) },
    environment: Object.fromEntries(RAID_PRESENTATION_ENVIRONMENT_FIELDS.map(key => [key, state.environment?.[key] ?? null])),
    raid: { ...pick(state.raid, ['phase', 'primaryBossId']),
      enraged: Boolean(state.raid.enraged), weatherLock: state.raid.weatherLock ? pick(state.raid.weatherLock, ['id', 'duration', 'suppressionAllowed']) : null },
    logSequence: state.raid.presentationLogSequence ?? 0,
  }
  const frame = {
    ...(!previous ? { resetActors: true } : {}),
    actors: actors.filter(actor => signature(previous?.actors?.[actor.actorId]) !== signature(actor)),
    removedActorIds: Object.keys(previous?.actors ?? {}).filter(id => !current.actors[id]),
    logs: state.log.filter(entry => !previous || (entry.raidLogSequence ?? 0) > previous.logSequence).slice(-32).map(publicLog),
  }
  for (const key of ['rules', 'environment', 'raid']) if (signature(previous?.[key]) !== signature(current[key])) frame[key] = clone(current[key])
  // This comparison cache remains server-only, outside the public view.
  state.raid.presentationFrame = current
  return sanitizeRaidPresentation(frame)
}

export function applyRaidPresentation(battle, input) {
  const frame = sanitizeRaidPresentation(input)
  if (!battle || !frame) return battle
  const removed = new Set(frame.removedActorIds ?? [])
  const next = { ...battle }
  for (const sideId of ['player', 'opponent']) {
    const previousTeam = battle[sideId]?.team ?? battle[sideId === 'player' ? 'allies' : 'enemies'] ?? []
    const previousById = new Map(previousTeam.map(actor => [actor.actorId ?? actor.battleId, actor]))
    const team = new Map((frame.resetActors ? [] : previousTeam).filter(actor => !removed.has(actor.actorId ?? actor.battleId)).map(actor => [actor.actorId ?? actor.battleId, actor]))
    for (const patch of frame.actors ?? []) if (patch.sideId === sideId) team.set(patch.actorId, { ...previousById.get(patch.actorId), ...patch })
    const ordered = [...team.values()].sort((left, right) => (left.slot ?? 0) - (right.slot ?? 0))
    next[sideId] = { ...battle[sideId], team: ordered, activeIndexes: ordered.map((_, index) => index) }
    next[sideId === 'player' ? 'allies' : 'enemies'] = ordered
  }
  if (frame.rules) next.rules = { ...battle.rules, ...frame.rules }
  if (frame.environment) next.environment = { ...battle.environment, ...frame.environment }
  if (frame.raid) next.raid = { ...battle.raid, ...frame.raid }
  if (frame.logs?.length) next.log = [...(battle.log ?? []), ...frame.logs].slice(-100)
  return next
}
