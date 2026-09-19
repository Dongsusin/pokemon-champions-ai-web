import { captureRaidPresentation, stampRaidPresentationLog } from './raidPresentation.js'

// State is serializable. Policy is opt-in by raid.primaryBossId, never by species.
export const RAID_GATES = [75, 50, 25, 0]
export const RAID_SIDE_CLEAR_FIELDS = Object.freeze({
  healingWishPending: null, wishSlots: {}, futureMoveSlots: {}, pendingPledge: null, pledgeComboPlanned: false,
  firePledgeTurns: 0, grassPledgeTurns: 0, waterPledgeTurns: 0, zHealReplacement: false,
  auroraVeilTurns: 0, lightScreenTurns: 0, reflectTurns: 0, safeguardTurns: 0, mistTurns: 0,
  tailwindTurns: 0, luckyChantTurns: 0, wideGuardTurns: 0, quickGuardTurns: 0, craftyShieldTurns: 0,
  matBlockTurns: 0, gmaxResidual: null, hazards: { stealthRock: false, steelsurge: false, toxicSpikes: 0, spikes: 0, stickyWeb: false },
})
export const RAID_FIELD_CLEAR_FIELDS = Object.freeze(['gravityTurns', 'trickRoomTurns', 'wonderRoomTurns', 'magicRoomTurns', 'mudSportTurns', 'waterSportTurns', 'fairyLockTurns', 'ionDelugeTurns'])
export const isRaidBoss = (state, pokemon) => Boolean(state?.raid?.primaryBossId && pokemon?.battleId === state.raid.primaryBossId)
export const isBossShielded = state => Boolean(state?.raid?.campaign && state.raid.bossId === 'hooh'
  && state.raid.firedMechanics.includes(25)
  && state.opponent.team.some(p => p.battleId !== state.raid.primaryBossId && p.hp > 0 && !p.fainted))
export function raidEvent(state, kind, message, details = {}, { log = true } = {}) {
  if (!state.raid) return
  const number = (state.raid.eventSequence ?? 0) + 1
  state.raid.eventSequence = number
  const actor = details.actorId ? [...state.player.team, ...state.opponent.team].find((p) => p.battleId === details.actorId) : null
  const event = { id: `${state.raid.raidId}:${number}`, kind, message, turn: state.turn, phase: state.raid.phase, ...(actor ? { hp: actor.hp, maxHp: actor.maxHp, form: actor.raidForm ?? null } : {}), ...details }
  if (log) state.log.push(stampRaidPresentationLog(state, { message, tone: kind === 'damage-protection' ? 'muted' : 'field' }))
  event.presentation = captureRaidPresentation(state, { reset: kind === 'stage-transition' })
  state.raid.events = [...(state.raid.events ?? []), event].slice(-80)
}
export function beginRaidDamageRoot(state, id, kind = 'action') {
  if (!state.raid) return
  const boss = state.opponent.team.find((actor) => isRaidBoss(state, actor))
  state.raid.damageRoot = { id, kind, budget: boss ? Math.floor(boss.maxHp / 4) : 0, spent: 0, closed: false }
}
export function previewBattleHpLoss(state, pokemon, rawAmount) {
  if (!pokemon || pokemon.hp <= 0) return 0
  const requested = Math.min(pokemon.hp, Math.max(0, Math.floor(Number(rawAmount) || 0)))
  if (!isRaidBoss(state, pokemon)) return requested
  if (isBossShielded(state)) return 0
  const root = state.raid.damageRoot ?? { budget: Math.floor(pokemon.maxHp / 4), spent: 0, closed: false }
  const gate = RAID_GATES.find((value) => !(state.raid.crossedGates ?? []).includes(value) && pokemon.hp > Math.floor(pokemon.maxHp * value / 100)) ?? 0
  return root.closed ? 0 : Math.min(requested, Math.max(0, root.budget - root.spent), Math.max(0, pokemon.hp - Math.floor(pokemon.maxHp * gate / 100)))
}
export function applyBattleHpLoss(state, pokemon, rawAmount) {
  if (!pokemon || pokemon.hp <= 0) return 0
  const requested = Math.max(0, Math.floor(Number(rawAmount) || 0))
  let applied = Math.min(pokemon.hp, requested)
  if (isRaidBoss(state, pokemon)) {
    if (isBossShielded(state)) {
      raidEvent(state, 'damage-protection', '부활한 전설의 포켓몬을 모두 쓰러뜨려야 칠색조에게 피해를 줄 수 있다.')
      return 0
    }
    if (!state.raid.damageRoot) beginRaidDamageRoot(state, `entry:${state.turn}`, 'entry')
    const root = state.raid.damageRoot
    const crossed = state.raid.crossedGates ??= []
    const nextGate = RAID_GATES.find((gate) => !crossed.includes(gate) && pokemon.hp > Math.floor(pokemon.maxHp * gate / 100)) ?? 0
    const boundary = Math.floor(pokemon.maxHp * nextGate / 100)
    applied = root.closed ? 0 : Math.min(applied, Math.max(0, root.budget - root.spent), Math.max(0, pokemon.hp - boundary))
    root.spent += applied
    if (applied > 0 && pokemon.hp - applied === boundary) {
      crossed.push(nextGate)
      root.closed = true
      state.raid.pendingGates = [...(state.raid.pendingGates ?? []), nextGate]
    }
    if (requested > applied && !root.protectionAnnounced) {
      root.protectionAnnounced = true
      raidEvent(state, 'damage-protection', 'HP 구간 보호로 초과 피해가 차단되었다.', { actorId: pokemon.battleId, requested, applied, rootId: root.id })
    }
  }
  pokemon.hp = Math.max(0, pokemon.hp - applied)
  return applied
}
export function raiseRaidVitality(pokemon) {
  const ratio = pokemon.maxHp ? pokemon.hp / pokemon.maxHp : 0
  pokemon.baseRaidMaxHp ??= pokemon.maxHp
  pokemon.raidVitalityStage = (pokemon.raidVitalityStage ?? 0) + 1
  pokemon.maxHp = Math.ceil(pokemon.baseRaidMaxHp * (1 + pokemon.raidVitalityStage / 2))
  pokemon.baseMaxHp = pokemon.maxHp
  pokemon.originalMaxHp = pokemon.maxHp
  pokemon.stats.hp = pokemon.maxHp
  pokemon.hp = Math.min(pokemon.maxHp, Math.ceil(pokemon.maxHp * ratio))
  for (const key of ['attack', 'defense', 'specialAttack', 'specialDefense', 'speed']) pokemon.statStages[key] = Math.min(6, (pokemon.statStages[key] ?? 0) + 1)
}
export function raidBlocksWeather(state, kind) {
  if (kind !== 'weather' || !state?.raid?.weatherLock) return false
  raidEvent(state, 'weather-blocked', '다크루기아의 고정 비는 다른 날씨로 바꿀 수 없다.')
  return true
}
export function purgeRaidField(state) {
  for (const sideId of ['player', 'opponent']) Object.assign(state[sideId], structuredClone(RAID_SIDE_CLEAR_FIELDS))
  for (const field of RAID_FIELD_CLEAR_FIELDS) state.environment[field] = 0
  for (const pokemon of state.player.team) {
    for (const key of Object.keys(pokemon.statStages)) pokemon.statStages[key] = 0
  }
  state.rules.weather = { id: 'rain', label: '비' }
  state.rules.terrain = { id: 'neutral', label: '일반 필드' }
  Object.assign(state.environment, { baseWeather: { id: 'clear', label: '맑음' }, baseTerrain: { id: 'neutral', label: '일반 필드' }, weatherTurns: null, terrainTurns: null, weatherSource: '다크루기아', terrainSource: null, weatherSourceBattleId: null, weatherSourceAbility: null, weatherStrong: false })
  state.raid.weatherLock = { id: 'rain', duration: 'infinite', suppressionAllowed: true }
}
export function finishRaidDamageRoot(state, hooks = {}) {
  if (!state.raid) return
  const raid = state.raid
  const boss = state.opponent.team.find((actor) => isRaidBoss(state, actor))
  if (raid.campaign) {
    for (const gate of raid.pendingGates ?? []) {
      if (!boss || boss.hp <= 0 || ![75, 50, 25].includes(gate) || raid.firedMechanics.includes(gate)) continue
      raid.firedMechanics.push(gate)
      if (gate === 75) {
        raiseRaidVitality(boss)
        raidEvent(state, 'boss-mechanic', `${boss.name}의 체력·공격·방어·특공·특방·스피드가 1단계 올랐다!`, { gate })
      } else if (raid.bossId === 'mewtwo') {
        if (gate === 50) {
          boss.raidForm = 'armored'; boss.name = '아머드 뮤츠'
          boss.spriteFront = '/assets/pokemon/skins/armored-mewtwo-front.gif'
          boss.spriteBack = '/assets/pokemon/skins/armored-mewtwo-back.gif'
        } else {
          hooks.onMega?.(boss, raid.megaForm)
          boss.raidForm = raid.megaForm
          boss.megaActive = true
        }
        raidEvent(state, 'boss-mechanic', `${boss.name}(으)로 ${gate === 50 ? '폼체인지' : '메가진화'}했다!`, { gate })
      } else if (raid.bossId === 'hooh') {
        const summoned = structuredClone(raid.summonPool[raid.reviveOrder[gate === 50 ? 0 : 1]])
        summoned.activeFromTurn = state.turn + 1
        state.opponent.team.push(summoned)
        const slot = state.opponent.activeIndexes.length
        state.opponent.activeIndexes.push(state.opponent.team.length - 1)
        hooks.onSummon?.(slot)
        raidEvent(state, 'summon', `${summoned.name} 부활!${gate === 25 ? ' 남은 부활 포켓몬을 처치할 때까지 칠색조는 무적이다!' : ''}`, { gate })
      } else if (raid.bossId === 'lugia') {
        if (gate === 50) {
          boss.raidForm = 'dark'; boss.name = '다크루기아'
          boss.spriteFront = '/assets/pokemon/skins/shadow-lugia-sheet.png#front'
          boss.spriteBack = '/assets/pokemon/skins/shadow-lugia-sheet.png#back'
        } else {
          state.rules.weather = { id: 'rain', label: '비' }
          Object.assign(state.environment, { weatherTurns: null, weatherSource: '다크루기아', weatherSourceBattleId: null, weatherSourceAbility: null, weatherStrong: false })
          raid.weatherLock = { id: 'rain', duration: 'infinite', suppressionAllowed: true }
          hooks.onWeather?.()
        }
        raidEvent(state, 'boss-mechanic', gate === 50 ? '다크루기아로 폼체인지했다!' : '변경할 수 없는 비가 내리기 시작했다!', { gate })
      }
    }
    raid.pendingGates = []
    return
  }
  for (const gate of raid.pendingGates ?? []) {
    if (!boss || boss.hp <= 0 || ![50, 25].includes(gate) || raid.firedMechanics.includes(gate)) continue
    raid.firedMechanics.push(gate)
    if (raid.bossId === 'mewtwo') {
      if (gate === 50) { boss.raidForm = 'armored'; boss.name = '아머드 뮤츠'; raiseRaidVitality(boss) }
      else { raid.enraged = true; raid.enrageTurn = raid.damageRoot?.kind === 'residual' ? state.turn + 1 : state.turn }
      raidEvent(state, 'boss-mechanic', gate === 50 ? '뮤츠가 갑옷을 장착했다! 여섯 능력이 올랐다!' : '뮤츠가 격노했다! 매 턴 두 번 공격한다!', { gate, actorId: boss.battleId })
    } else if (raid.bossId === 'hooh') {
      const source = raid.summonPool[raid.reviveOrder[gate === 50 ? 0 : 1]]
      const summoned = structuredClone(source)
      summoned.activeFromTurn = state.turn + 1
      state.opponent.team.push(summoned)
      const slot = state.opponent.activeIndexes.length
      state.opponent.activeIndexes.push(state.opponent.team.length - 1)
      if (gate === 50) { raiseRaidVitality(boss); raiseRaidVitality(summoned) }
      hooks.onSummon?.(slot)
      raidEvent(state, 'summon', `${summoned.name}이(가) 부활했다!${gate === 50 ? ' 칠색조와 함께 여섯 능력이 올랐다!' : ''}`, { gate, actorId: summoned.battleId })
    } else if (raid.bossId === 'lugia') {
      if (gate === 50) { boss.raidForm = 'dark'; boss.name = '다크루기아'; purgeRaidField(state); hooks.onPurge?.() }
      else raiseRaidVitality(boss)
      raidEvent(state, 'boss-mechanic', gate === 50 ? '다크루기아가 필드와 아군 능력 변화를 정화했다! 고정 비가 내린다!' : '다크루기아의 여섯 능력이 올랐다!', { gate, actorId: boss.battleId })
    }
  }
  raid.pendingGates = []
}
export function raidMoveImmunity(state, target, move) {
  return isRaidBoss(state, target) && (move.ohko || ['fissure', 'sheercold', 'guillotine', 'horndrill', 'painsplit', 'endeavor', 'roar', 'whirlwind'].includes(move.id))
}
