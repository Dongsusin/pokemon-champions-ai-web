import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import test from 'node:test'
import { RAID_BOSSES, RAID_NPCS, RAID_FORM_MANIFEST } from '../src/data/raidRules.js'
import { beginRaidDamageRoot, applyBattleHpLoss, finishRaidDamageRoot, raiseRaidVitality,
  purgeRaidField, raidMoveImmunity, RAID_SIDE_CLEAR_FIELDS, RAID_FIELD_CLEAR_FIELDS } from '../src/data/raidPolicy.js'
import { SPECIES_PROFILES, normalizePokemon, getLearnableMoves, getMoveById } from '../src/data/trainingData.js'
import { getMoveSoundProfile } from '../src/data/moveSoundData.js'
import { BATTLE_SAMPLE_PATHS } from '../src/battleAudio.js'
import { createBattle, playBattleTurnWithActions, getBattleMoveTargets, getBattleMoveSelectionState,
  getBattleStruggleAction, getAvailableBattleMechanics, getEffectiveBattleWeatherId } from '../src/data/battleEngine.js'
import { createRaidBattle, startRaidBossStage, resolveRaidTurn, getRaidBattleView,
  validateRaidCommand, getRaidOutcome, chooseRaidCommand } from '../server/raidBattle.js'

// Source of the raid-specific rules is the user's 2026-09-14 attachment,
// pokemon_champions_coop_boss_raid_codex_prompt.txt, sections 05–10 and QA matrix.
// Synthetic HP actors isolate integer boundaries; integrated fixtures below use
// actual legal species/moves and never expose forced HP controls to production.
const profiles = Object.values(SPECIES_PROFILES)
const statKeys = ['attack', 'defense', 'specialAttack', 'specialDefense', 'speed']
let serial = 0
function mon(slug, moves, options = {}) {
  const species = profiles.find(profile => profile.slug === slug)
  assert(species, `Unknown fixture species ${slug}`)
  const legal = new Set(getLearnableMoves(species.id).map(move => move.id))
  for (const move of moves) assert(legal.has(move), `${slug} cannot legally use ${move}`)
  return normalizePokemon({ speciesId: species.id, captureId: `raid-fixture-${++serial}`,
    moves: moves.map(move => getMoveById(move).name), ...options })
}
function actor(id, maxHp = 4000) {
  return { battleId: id, name: id, hp: maxHp, maxHp, baseMaxHp: maxHp, stats: { hp: maxHp },
    types: ['에스퍼'], moves: [{ id: 'tackle', currentPp: 35, pp: 35 }], status: null,
    statStages: { attack: 0, defense: 0, specialAttack: 0, specialDefense: 0, speed: 0, accuracy: 0, evasion: 0 } }
}
function policyState(bossId = 'mewtwo', maxHp = 4000) {
  return { turn: 1, log: [], rules: { weather: { id: 'clear' }, terrain: { id: 'neutral' } }, environment: {},
    player: { team: [actor('ally-1', 400), actor('ally-2', 400), actor('ally-3', 400)], activeIndexes: [0, 1, 2] },
    opponent: { team: [actor('boss', maxHp)], activeIndexes: [0] },
    raid: { raidId: 'policy-test', phase: 'stage2', bossId, primaryBossId: 'boss', crossedGates: [], firedMechanics: [],
      events: [], summonPool: [actor('entei', 400), actor('raikou', 400), actor('suicune', 400)], reviveOrder: [2, 0, 1] },
  }
}
const boss = state => state.opponent.team.find(pokemon => pokemon.battleId === state.raid.primaryBossId)
function damage(state, amount, id = `action-${++serial}`, kind = 'action') {
  beginRaidDamageRoot(state, id, kind)
  const applied = applyBattleHpLoss(state, boss(state), amount)
  finishRaidDamageRoot(state)
  return applied
}
function gate(state, percent) {
  while (boss(state).hp / boss(state).maxHp > percent / 100) damage(state, 999999)
}

test('DATA: all three bosses, nine prelude enemies and NPC presets retain actual legal moves', () => {
  assert.deepEqual(RAID_BOSSES.map(entry => entry.id), ['mewtwo', 'hooh', 'lugia'])
  assert.deepEqual(RAID_BOSSES.map(entry => entry.speciesId), [150, 250, 249])
  assert.deepEqual(RAID_BOSSES[0].stageOne.map(entry => [entry.trainer, entry.speciesId]), [['로사', 24], ['로이', 110], ['비주기', 34]])
  assert.deepEqual(RAID_BOSSES[1].stageOne.map(entry => entry.speciesId), [244, 243, 245])
  assert.deepEqual(RAID_BOSSES[2].stageOne.map(entry => entry.speciesId), [145, 146, 144])
  for (const entry of [...RAID_BOSSES, ...RAID_BOSSES.flatMap(entry => entry.stageOne), ...RAID_NPCS]) {
    const legal = new Set(getLearnableMoves(entry.speciesId).map(move => move.id))
    for (const id of entry.moves) assert(legal.has(id), `Species ${entry.speciesId} has illegal move ${id}`)
  }
  for (const presentation of Object.values(RAID_FORM_MANIFEST)) {
    for (const file of [presentation.front, presentation.back, presentation.sheet].filter(Boolean)) {
      assert(existsSync(new URL(`../public${file.split('#')[0]}`, import.meta.url)), `Missing raid art ${file}`)
    }
  }
  mon('blissey', ['healpulse', 'lifedew', 'helpinghand', 'softboiled'])
  mon('garchomp', ['earthquake', 'rockslide', 'swordsdance', 'protect'])
  mon('heracross', ['pinmissile', 'armthrust', 'megahorn', 'closecombat'])
})

test('H01–H04: one action caps at 25%, respects the next boundary, and preserves low damage', () => {
  const cases = [[4000, 6000, 1000, 3000], [3280, 2000, 280, 3000], [4000, 120, 120, 3880]]
  for (const [hp, raw, applied, result] of cases) {
    const state = policyState()
    boss(state).hp = hp
    assert.equal(damage(state, raw), applied)
    assert.equal(boss(state).hp, result)
  }
  const boundary = policyState()
  boss(boundary).hp = 3000
  assert.equal(damage(boundary, 2000), 1000, 'A restored state at exactly 75% must move toward 50%')
  assert.equal(boss(boundary).hp / boss(boundary).maxHp, 0.5)
})

test('H05–H07: five hits share one budget and a second human gets an independent root', () => {
  const state = policyState()
  boss(state).hp = 3200
  beginRaidDamageRoot(state, 'five-hits')
  const hits = Array.from({ length: 5 }, () => applyBattleHpLoss(state, boss(state), 560))
  assert.deepEqual(hits, [200, 0, 0, 0, 0])
  finishRaidDamageRoot(state)
  assert.equal(damage(state, 90000, 'second-human'), 1000)
  assert.equal(boss(state).hp / boss(state).maxHp, 0.5)
  assert.equal(state.raid.damageRoot.spent, 1000, '50% vitality must not replenish this root budget')
  assert.equal(applyBattleHpLoss(state, boss(state), 99999), 0)
})

test('H08/H11: one residual batch cannot cross multiple gates; zero and immunity do not trigger mechanics', () => {
  const state = policyState()
  beginRaidDamageRoot(state, 'residual:1', 'residual')
  const amounts = [700, 700, 700].map(amount => applyBattleHpLoss(state, boss(state), amount))
  assert.deepEqual(amounts, [700, 300, 0])
  finishRaidDamageRoot(state)
  assert.deepEqual(state.raid.crossedGates, [75])
  const clean = policyState()
  for (const amount of [0, -5, NaN]) assert.equal(damage(clean, amount), 0)
  assert.equal(boss(clean).hp, 4000)
  assert.deepEqual(clean.raid.crossedGates, [])
  assert.deepEqual(clean.raid.firedMechanics, [])
})

test('H12/H13: vitality preserves exact boundary ratios and healing cannot repeat a fired mechanic', () => {
  for (const ratio of [0.25, 0.5, 1]) {
    const target = actor('boundary', 4000)
    target.hp = 4000 * ratio
    target.statStages.attack = 6
    target.statStages.accuracy = -2
    target.statStages.evasion = 3
    raiseRaidVitality(target)
    assert.equal(target.maxHp, 6000)
    assert.equal(target.hp / target.maxHp, ratio)
    assert.equal(target.statStages.attack, 6)
    assert.equal(target.statStages.accuracy, -2)
    assert.equal(target.statStages.evasion, 3)
  }
  const state = policyState()
  gate(state, 50)
  const maxHp = boss(state).maxHp
  boss(state).hp = maxHp
  damage(state, maxHp)
  damage(state, maxHp)
  assert.equal(boss(state).maxHp, maxHp)
  assert.equal(boss(state).raidVitalityStage, 1)
  assert.equal(state.raid.events.filter(event => event.kind === 'boss-mechanic' && event.gate === 50).length, 1)
})

test('H14: seeded integer property sweep stays finite, nonnegative, capped and monotonic', () => {
  let seed = 0x51a7e
  const random = max => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max }
  for (let iteration = 0; iteration < 1600; iteration++) {
    const maxHp = (random(10000) + 1) * 8
    const state = policyState('lugia', maxHp)
    const startHp = random(maxHp + 1)
    boss(state).hp = startHp
    state.raid.crossedGates = [75, 50, 25].filter(value => startHp <= maxHp * value / 100)
    beginRaidDamageRoot(state, `property-${iteration}`)
    let total = 0
    for (let hit = 0; hit < 5; hit++) total += applyBattleHpLoss(state, boss(state), random(maxHp * 3))
    assert(Number.isSafeInteger(boss(state).hp), `Noninteger HP at seed ${seed}`)
    assert(boss(state).hp >= 0 && boss(state).hp <= maxHp)
    assert(total <= maxHp / 4 && total <= startHp)
    assert.equal(startHp - boss(state).hp, total)
  }
  for (const maxHp of [1, 8]) {
    const state = policyState('lugia', maxHp)
    for (const hp of [0, 1]) { boss(state).hp = hp; damage(state, Number.MAX_SAFE_INTEGER); assert(Number.isFinite(boss(state).hp)); assert(boss(state).hp >= 0) }
  }
})

test('H15/H16: ordinary enemies ignore the cap and instant-win immunity belongs only to the boss', () => {
  const state = policyState()
  const ordinary = actor('summon', 400)
  assert.equal(applyBattleHpLoss(state, ordinary, 350), 350)
  for (const id of ['sheercold', 'fissure', 'painsplit', 'endeavor', 'roar']) {
    assert.equal(Boolean(raidMoveImmunity(state, boss(state), getMoveById(id))), true, id)
    assert.equal(Boolean(raidMoveImmunity(state, ordinary, getMoveById(id))), false, id)
  }
})

test('M03–M05: armor only at 50%, original typing retained, enrage only at 25%', () => {
  const state = policyState()
  gate(state, 75)
  assert.equal(boss(state).raidForm, undefined)
  gate(state, 50)
  assert.equal(boss(state).raidForm, 'armored')
  assert.deepEqual(boss(state).types, ['에스퍼'])
  for (const key of statKeys) assert.equal(boss(state).statStages[key], 1)
  assert.equal(boss(state).maxHp, 6000)
  assert.equal(boss(state).hp, 3000)
  assert.equal(state.raid.enraged, undefined)
  gate(state, 25)
  assert.equal(state.raid.enraged, true)
  assert.equal(state.raid.enrageTurn, 1)
  assert.equal(boss(state).maxHp, 6000)
})

test('M08/M12: residual enrage begins next turn and serialized duplicate finishing is idempotent', () => {
  const state = policyState()
  gate(state, 50)
  damage(state, 99999, 'poison:1', 'residual')
  assert.equal(state.raid.enrageTurn, state.turn + 1)
  const restored = JSON.parse(JSON.stringify(state))
  const before = JSON.stringify(restored)
  finishRaidDamageRoot(restored)
  assert.equal(JSON.stringify(restored), before)
})

test('O02–O09: deterministic distinct revivals, clean full HP, and only the first pair is strengthened', () => {
  const state = policyState('hooh')
  gate(state, 50)
  assert.equal(state.opponent.activeIndexes.length, 2)
  const first = state.opponent.team[1]
  assert.equal(first.battleId, 'suicune')
  assert.equal(first.hp, 600)
  assert.equal(first.maxHp, 600)
  assert.equal(first.activeFromTurn, state.turn + 1)
  for (const key of statKeys) assert.equal(first.statStages[key], 1)
  first.hp = 0
  gate(state, 25)
  const second = state.opponent.team[2]
  assert.equal(second.battleId, 'entei')
  assert.equal(first.hp, 0, 'The already-revived summon must stay fainted')
  assert.equal(second.hp, 400)
  assert.equal(second.maxHp, 400)
  for (const key of statKeys) { assert.equal(second.statStages[key], 0); assert.equal(first.statStages[key], 1); assert.equal(boss(state).statStages[key], 1) }
  assert.equal(boss(state).raidVitalityStage, 1)
  const restored = JSON.parse(JSON.stringify(state))
  finishRaidDamageRoot(restored)
  assert.deepEqual(restored, state)
})

test('L02–L06/L14: dark transformation purges all classified fields while preserving personal state', () => {
  const state = policyState('lugia')
  for (const side of [state.player, state.opponent]) {
    for (const [key, value] of Object.entries(RAID_SIDE_CLEAR_FIELDS)) side[key] = typeof value === 'number' ? 7 : { dirty: true }
  }
  for (const key of RAID_FIELD_CLEAR_FIELDS) state.environment[key] = 7
  for (const [index, ally] of state.player.team.entries()) {
    ally.hp = index === 2 ? 0 : 199
    ally.status = 'poison'
    ally.substituteHp = 25
    ally.terastallized = true
    ally.moves[0].currentPp = 8
    for (const key of Object.keys(ally.statStages)) ally.statStages[key] = index ? -2 : 3
  }
  const personal = state.player.team.map(({ hp, status, substituteHp, terastallized, moves }) => ({ hp, status, substituteHp, terastallized, moves: structuredClone(moves) }))
  boss(state).statStages.defense = 2
  gate(state, 50)
  assert.equal(boss(state).raidForm, 'dark')
  assert.equal(boss(state).maxHp, 4000)
  assert.equal(boss(state).statStages.defense, 2)
  for (const side of [state.player, state.opponent]) for (const [key, value] of Object.entries(RAID_SIDE_CLEAR_FIELDS)) assert.deepEqual(side[key], value, key)
  for (const key of RAID_FIELD_CLEAR_FIELDS) assert.equal(state.environment[key], 0)
  for (const [index, ally] of state.player.team.entries()) {
    for (const value of Object.values(ally.statStages)) assert.equal(value, 0)
    for (const [key, value] of Object.entries(personal[index])) assert.deepEqual(ally[key], value)
  }
  assert.equal(state.rules.weather.id, 'rain')
  assert.equal(state.rules.terrain.id, 'neutral')
  assert.equal(state.raid.weatherLock.duration, 'infinite')
  state.player.reflectTurns = 3
  state.player.team[0].statStages.attack = 2
  gate(state, 25)
  assert.equal(boss(state).hp, 1500)
  assert.equal(boss(state).maxHp, 6000)
  assert.equal(state.player.reflectTurns, 3, '25% does not purge a newly created screen')
  assert.equal(state.player.team[0].statStages.attack, 2)
})

function coreRaid(players, foes = Array.from({ length: 3 }, () => mon('wailord', ['splash'])), { primaryBoss = false } = {}) {
  const state = createBattle({ playerPokemon: players, opponent: { name: 'RAID VALIDATION' },
    opponentTeam: { pokemon: foes, battleGimmicks: [] }, rules: {
      raid: true, pvp: true, weather: { id: 'clear' }, terrain: { id: 'neutral' },
      format: { id: 'raid_coop_3', activeSlots: 3, actionSlots: 3 }, teamRule: { id: 'full', battleSize: 3 },
    }, random: () => 0.5 })
  state.raid = { ...policyState().raid, phase: primaryBoss ? 2 : 1,
    primaryBossId: primaryBoss ? state.opponent.team[0].battleId : null, usedMechanicsByOwner: {} }
  for (const [index, pokemon] of state.player.team.entries()) pokemon.raidOwnerId = `owner-${index}`
  return state
}
const noop = () => mon('wailord', ['splash'])
function coreTurn(state, selected = {}, opponents = []) {
  return playBattleTurnWithActions(state, state.player.activeIndexes.map((_, actorSlot) => ({
    type: 'move', actorSlot, moveIndex: 0, targetSlot: 0, targetSideId: 'opponent', ...(selected[actorSlot] ?? {}),
  })), opponents, () => 0.5)
}

test('C11: actual Life Dew heals all three cooperative slots and no enemy', () => {
  const state = coreRaid([mon('blissey', ['lifedew']), noop(), noop()])
  for (const pokemon of state.player.team) pokemon.hp -= 100
  const before = structuredClone(state)
  const next = coreTurn(state)
  for (let index = 0; index < 3; index++) {
    const previous = before.player.team[index]
    assert.equal(next.player.team[index].hp, Math.min(previous.maxHp, previous.hp + Math.floor(previous.maxHp / 4)))
  }
  assert.deepEqual(next.opponent.team.map(pokemon => pokemon.hp), before.opponent.team.map(pokemon => pokemon.hp))
  assert.deepEqual(state, before, 'Resolving a turn cannot mutate its input snapshot')
})

test('C11: actual Heal Pulse can select the distant other human without healing other slots', () => {
  const state = coreRaid([mon('blissey', ['healpulse']), noop(), noop()])
  for (const pokemon of state.player.team) pokemon.hp -= 100
  assert(getBattleMoveTargets(state, 'player', 0, 0).some(target => target.sideId === 'player' && target.slot === 2))
  const next = coreTurn(state, { 0: { targetSideId: 'player', targetSlot: 2 } })
  assert.equal(next.player.team[0].hp, state.player.team[0].hp)
  assert.equal(next.player.team[1].hp, state.player.team[1].hp)
  assert.equal(next.player.team[2].hp, Math.min(state.player.team[2].maxHp, state.player.team[2].hp + Math.floor(state.player.team[2].maxHp / 2)))
})

test('C11/C12: Rock Slide reaches all three enemies; Earthquake also hits both allies', () => {
  for (const id of ['rockslide', 'earthquake']) {
    const state = coreRaid([mon('garchomp', [id]), noop(), noop()])
    const next = coreTurn(state)
    for (let index = 0; index < 3; index++) assert(next.opponent.team[index].hp < state.opponent.team[index].hp, `${id} missed enemy slot ${index}`)
    assert.equal(next.player.team[0].hp, state.player.team[0].hp)
    for (let index = 1; index < 3; index++) {
      if (id === 'earthquake') assert(next.player.team[index].hp < state.player.team[index].hp, `Earthquake missed ally slot ${index}`)
      else assert.equal(next.player.team[index].hp, state.player.team[index].hp)
    }
  }
})

test('C15: Volt Switch damages without opening a bench prompt; empty PP selects Struggle', () => {
  const state = coreRaid([mon('pikachu', ['voltswitch']), noop(), noop()])
  const next = coreTurn(state)
  assert(next.opponent.team[0].hp < state.opponent.team[0].hp)
  assert.equal(Boolean(next.awaitingPlayerSwitch), false)
  assert.equal(next.pendingHumanSwitch ?? null, null)
  for (const move of state.player.team[0].moves) move.currentPp = 0
  assert.equal(getBattleStruggleAction(state, 'player', 0).moveIndex, -1)
  assert(coreTurn(state).turn > state.turn)
  const banned = coreRaid([mon('mew', ['batonpass']), noop(), noop()])
  assert.equal(getBattleMoveSelectionState(banned, 'player', 0, 0).disabled, true)
})

test('H05/H10: real multihit and draining attacks use capped HP loss in the shared engine', () => {
  for (const [slug, move] of [['cloyster', 'iciclespear'], ['breloom', 'drainpunch']]) {
    const state = coreRaid([mon(slug, [move]), noop(), noop()], [mon('mewtwo', ['protect'])], { primaryBoss: true })
    const target = boss(state)
    target.hp = target.maxHp = target.baseMaxHp = 80
    state.player.team[0].stats.attack = 100000
    state.player.team[0].hp = 10
    const next = coreTurn(state)
    assert.equal(boss(next).hp, 60, move)
    if (move === 'drainpunch') assert.equal(next.player.team[0].hp, 20, 'Drain heals from actual 20 HP loss, not raw damage')
  }
})

test('H06: boss HP gates preserve Focus Sash, follow resistance berries and respect final-HP Endure', () => {
  const fullHpTarget = (heldItemId, move = 'tackle') => {
    const state = coreRaid([mon('snorlax', [move]), noop(), noop()], [mon('mewtwo', ['endure'], { heldItemId })], { primaryBoss: true })
    const target = boss(state)
    target.hp = target.maxHp = target.baseMaxHp = target.originalMaxHp = target.stats.hp = 80
    state.player.team[0].stats.attack = 100000
    return state
  }
  const sash = fullHpTarget('focus-sash')
  const sashAfter = coreTurn(sash)
  assert.equal(boss(sashAfter).hp, 60)
  assert.equal(boss(sashAfter).heldItemId, 'focus-sash')
  assert.equal(boss(sashAfter).consumedItem, false, 'A hit blocked at 75% cannot consume a survival item')
  assert.equal(boss(sashAfter).lastDamageTaken, 20)
  assert(!sashAfter.log.some(event => event.message.includes('기합의띠로 버텼다')))
  const protection = sashAfter.raid.events.find(event => event.kind === 'damage-protection')
  assert(protection.requested > 80, 'The uncapped attack must have been lethal')
  assert.equal(protection.applied, 20)

  const berry = fullHpTarget('colbur-berry', 'crunch')
  const berryAfter = coreTurn(berry)
  assert.equal(boss(berryAfter).hp, 60, 'Halving excessive raw damage still leaves a full 25% capped hit')
  assert.equal(boss(berryAfter).consumedItem, true)
  assert.equal(boss(berryAfter).ateBerry, true)
  assert.equal(boss(berryAfter).lastDamageTaken, 20)
  assert(berryAfter.log.some(event => event.message.includes('데미지를 줄였다')))
  assert(berryAfter.raid.events.some(event => event.kind === 'damage-protection' && event.requested > 80 && event.applied === 20))

  const enduring = fullHpTarget('')
  boss(enduring).hp = 10
  enduring.raid.crossedGates = [75, 50, 25]
  enduring.raid.firedMechanics = [50, 25]
  const endured = coreTurn(enduring, {}, [{ type: 'move', actorSlot: 0, moveIndex: 0, targetSideId: 'opponent', targetSlot: 0 }])
  assert.equal(boss(endured).hp, 1)
  assert.equal(boss(endured).fainted, false)
  assert.equal(boss(endured).lastDamageTaken, 9)
  assert.deepEqual(endured.raid.crossedGates, [75, 50, 25], 'Endure must not emit a zero-HP gate')
  assert(endured.log.some(event => event.message.includes('공격을 견뎠다')))
})

test('H09: actual reflected, current-HP fraction and delayed damage use the boss gate', () => {
  for (const [slug, move] of [['wobbuffet', 'mirrorcoat'], ['raticate', 'superfang'], ['mew', 'futuresight']]) {
    const state = coreRaid([mon(slug, move === 'futuresight' ? [move, 'protect'] : [move]), noop(), noop()], [mon('mewtwo', ['psystrike'])], { primaryBoss: true })
    const target = boss(state)
    target.hp = target.maxHp = target.baseMaxHp = target.originalMaxHp = target.stats.hp = 80
    let next = coreTurn(state, {}, move === 'mirrorcoat' ? [{ type: 'move', actorSlot: 0, moveIndex: 0, targetSideId: 'player', targetSlot: 0 }] : [])
    if (move === 'mirrorcoat') assert(next.player.team[0].lastDamageTaken > 10, 'The reflected raw damage must exceed the 20 HP cap')
    if (move === 'futuresight') {
      assert.equal(boss(next).hp, 80, 'Future Sight cannot damage on the setup turn')
      for (let turn = 0; turn < 3 && boss(next).hp === 80; turn++) next = coreTurn(next, { 0: { moveIndex: 1, targetSideId: 'player' } })
      assert(next.log.some(event => event.message.includes('미래 공격이')))
      assert.equal(next.raid.damageRoot.kind, 'residual')
    }
    assert.equal(boss(next).hp, 60, move)
    assert.deepEqual(next.raid.crossedGates, [75], move)
    assert.equal(boss(next).lastDamageTaken, 20, 'Damage records must contain capped HP loss')
  }
})

test('H17: actual Transform copies the species without raid HP, vitality, identity or event authority', () => {
  const state = coreRaid([mon('mew', ['transform']), noop(), noop()], [mon('mewtwo', ['protect'])], { primaryBoss: true })
  const target = boss(state)
  target.hp = target.maxHp = target.baseMaxHp = target.originalMaxHp = target.stats.hp = 800
  gate(state, 50)
  const original = structuredClone(state.player.team[0])
  const next = coreTurn(state)
  const transformed = next.player.team[0]
  assert.equal(transformed.speciesId, target.speciesId)
  for (const key of ['hp', 'maxHp', 'baseMaxHp', 'originalMaxHp', 'battleId', 'raidOwnerId']) assert.equal(transformed[key], original[key], key)
  assert.equal(transformed.stats.hp, original.stats.hp)
  for (const key of ['baseRaidMaxHp', 'raidVitalityStage', 'raidForm']) assert.equal(transformed[key], undefined, key)
  assert.equal(next.raid.primaryBossId, target.battleId)
  assert.equal(next.raid.events.filter(event => event.kind === 'boss-mechanic' && event.gate === 50).length, 1)
  beginRaidDamageRoot(next, 'copied-actor-damage')
  assert.equal(applyBattleHpLoss(next, transformed, transformed.maxHp), original.hp, 'A copied player receives ordinary uncapped damage')
  assert.equal(transformed.hp, 0)
  assert.equal(boss(next).hp, target.hp)
})

test('L07/L09/L12/L15: fixed rain rejects Sunny Day, survives a turn, and does not leak into normal battles', () => {
  const state = coreRaid([mon('mew', ['sunnyday', 'raindance', 'reflect']), noop(), noop()], [mon('lugia', ['protect'])], { primaryBoss: true })
  state.raid.bossId = 'lugia'
  purgeRaidField(state)
  for (const moveIndex of [0, 1, 2]) {
    const next = coreTurn(state, { 0: { moveIndex, targetSideId: 'player' } })
    assert.equal(next.rules.weather.id, 'rain')
    assert.equal(next.environment.weatherTurns, null)
    assert.equal(next.raid.weatherLock.duration, 'infinite')
    if (moveIndex === 2) assert(next.player.reflectTurns > 0)
  }
  const normal = createBattle({ playerPokemon: [mon('mew', ['sunnyday'])], opponent: { name: 'NORMAL REGRESSION' }, opponentTeam: { pokemon: [noop()], battleGimmicks: [] } })
  assert.equal(normal.raid, undefined)
  assert.equal(normal.rules.weather.id, 'clear')
  const next = playBattleTurnWithActions(normal, [{ type: 'move', actorSlot: 0, moveIndex: 0 }], [], () => 0.5)
  assert.equal(next.rules.weather.id, 'sun')
})

test('L08: Max Flare keeps its real damage but cannot replace the locked rain', () => {
  const state = coreRaid([mon('mew', ['flamethrower']), noop(), noop()], [mon('lugia', ['protect'])], { primaryBoss: true })
  state.raid.bossId = 'lugia'
  purgeRaidField(state)
  const before = boss(state).hp
  const next = coreTurn(state, { 0: { gimmick: 'dynamax' } })
  assert.equal(next.player.team[0].dynamaxActive, true)
  assert(boss(next).hp < before, 'The weather lock must not cancel Max Move damage')
  assert.equal(next.rules.weather.id, 'rain')
  assert.equal(next.environment.weatherTurns, null)
  assert(next.raid.events.some(event => event.kind === 'weather-blocked'))
})

test('L10/L11: actual Air Lock suppresses rain damage and Gastro Acid restores it without recreating the lock', () => {
  const state = coreRaid([mon('mew', ['waterpulse', 'gastroacid']), mon('rayquaza', ['dragondance']), noop()], [mon('lugia', ['protect'])], { primaryBoss: true })
  state.raid.bossId = 'lugia'
  purgeRaidField(state)
  const lock = structuredClone(state.raid.weatherLock)
  assert.equal(getEffectiveBattleWeatherId(state), 'clear')
  const dry = coreTurn(state)
  const dryDamage = boss(state).hp - boss(dry).hp
  assert(dryDamage > 0)
  const suppressedAbility = coreTurn(state, { 0: { moveIndex: 1, targetSideId: 'player', targetSlot: 1 } })
  assert.equal(getEffectiveBattleWeatherId(suppressedAbility), 'rain')
  assert.deepEqual(suppressedAbility.raid.weatherLock, lock)
  assert.equal(suppressedAbility.environment.weatherTurns, null)
  const wet = coreTurn(suppressedAbility)
  const rainDamage = boss(suppressedAbility).hp - boss(wet).hp
  assert(rainDamage > dryDamage, `Rain should strengthen real Water Pulse damage (${rainDamage} > ${dryDamage})`)
  assert.equal(wet.rules.weather.id, 'rain')
})

test('C16: one human using Tera leaves both other humans eligible for their own gimmick', () => {
  const state = coreRaid([mon('mew', ['protect']), mon('mew', ['protect']), mon('mew', ['protect'])])
  const next = coreTurn(state, { 0: { gimmick: 'tera' } })
  assert.equal(next.player.team[0].teraActive, true)
  assert.equal(getAvailableBattleMechanics(next, 'player', 0).length, 0)
  for (const slot of [1, 2]) assert(getAvailableBattleMechanics(next, 'player', slot).some(mechanic => mechanic.id === 'tera'))
})

function combatMewtwo({ bossFirst = false, residual = false } = {}) {
  const state = coreRaid([residual ? noop() : mon('snorlax', ['tackle']), noop(), noop()], [mon('mewtwo', ['psystrike'])], { primaryBoss: true })
  const target = boss(state)
  target.hp = residual ? 21 : 40
  target.maxHp = target.baseMaxHp = 80
  target.stats.speed = bossFirst ? 1000 : 1
  state.raid.crossedGates = [75, 50]
  state.raid.firedMechanics = [50]
  for (const pokemon of state.player.team) { pokemon.hp = pokemon.maxHp = 10000; pokemon.stats.speed = 100 }
  state.player.team[0].stats.attack = 100000
  if (residual) target.status = { id: 'poison' }
  return state
}
const enemyAttack = [{ type: 'move', actorSlot: 0, moveIndex: 0, targetSideId: 'player', targetSlot: 0 }]
const announcedAttacks = (before, after) => after.log.slice(before.log.length).filter(event => event.message === `${boss(before).name}의 사이코브레이크!`).length

test('M06/M07/M10: entering 25% before or after the basic action produces exactly two uses and PP costs', () => {
  for (const bossFirst of [false, true]) {
    const state = combatMewtwo({ bossFirst })
    const next = coreTurn(state, {}, enemyAttack)
    assert.equal(announcedAttacks(state, next), 2, `bossFirst=${bossFirst}`)
    assert.equal(boss(next).moves[0].currentPp, boss(state).moves[0].currentPp - 2)
    assert.equal(next.raid.bonusScheduledTurn, 1)
    assert.equal(next.turn, 2)
  }
})

test('M08/M11: poison-triggered rage waits until next turn and residual/status timers run once', () => {
  const state = combatMewtwo({ residual: true })
  const first = coreTurn(state, {}, enemyAttack)
  assert.equal(announcedAttacks(state, first), 1)
  assert.equal(first.raid.enrageTurn, 2)
  assert.equal(boss(first).hp, 20)
  const second = coreTurn(first, {}, enemyAttack)
  assert.equal(announcedAttacks(first, second), 2)
  assert.equal(boss(second).hp, 10, 'Poison ticks once, even with two boss attacks')
  const sleeping = combatMewtwo({ residual: true })
  sleeping.raid.enraged = true
  sleeping.raid.enrageTurn = 1
  boss(sleeping).hp = 20
  sleeping.raid.crossedGates.push(25)
  boss(sleeping).status = { id: 'sleep', counter: 3 }
  const asleepAfter = coreTurn(sleeping, {}, enemyAttack)
  assert.equal(announcedAttacks(sleeping, asleepAfter), 0)
  assert.equal(boss(asleepAfter).status.counter, 2, 'Bonus cannot consume a second sleep turn')
})

test('M11: Quash cannot move the basic action behind its raid bonus and consume two sleep turns', () => {
  const state = coreRaid([mon('mew', ['protect']), mon('sableye', ['quash'], { ability: '짓궂은마음' }), noop()], [mon('mewtwo', ['psystrike'])], { primaryBoss: true })
  const target = boss(state)
  target.hp = 20
  target.maxHp = target.baseMaxHp = target.originalMaxHp = target.stats.hp = 80
  target.status = { id: 'sleep', counter: 3 }
  Object.assign(state.raid, { crossedGates: [75, 50, 25], firedMechanics: [50, 25], enraged: true, enrageTurn: 1 })
  const next = coreTurn(state, { 0: { targetSideId: 'player' } }, enemyAttack)
  assert(next.log.some(event => event.message.includes('행동 순서가 뒤로 밀렸다')), 'The legal Quash must execute against the waiting boss')
  assert.equal(next.raid.bonusScheduledTurn, 1)
  assert.equal(boss(next).status.counter, 2, 'Quash may delay a regular action, but the bonus remains after every regular action')
  assert.equal(announcedAttacks(state, next), 0)
})

test('M09: a second human knocking out the enraged boss cancels its scheduled bonus', () => {
  const state = combatMewtwo()
  const attackMon = coreRaid([mon('snorlax', ['tackle']), noop(), noop()]).player.team[0]
  attackMon.battleId = state.player.team[1].battleId
  attackMon.raidOwnerId = state.player.team[1].raidOwnerId
  attackMon.stats.attack = 100000
  attackMon.stats.speed = 90
  state.player.team[1] = attackMon
  const next = coreTurn(state, {}, enemyAttack)
  assert.equal(boss(next).hp, 0)
  assert.equal(next.winner, 'player')
  assert.equal(announcedAttacks(state, next), 0)
})

test('H16: actual Perish Song and Destiny Bond cannot force the main boss to faint', () => {
  const song = coreRaid([mon('lapras', ['perishsong']), noop(), noop()], [mon('mewtwo', ['psystrike'])], { primaryBoss: true })
  const sang = coreTurn(song)
  assert.equal(boss(sang).perishCount, null)
  assert.equal(sang.player.team[0].perishCount, 3, 'Ordinary actors still receive the song')
  const bond = coreRaid([mon('gengar', ['destinybond']), noop(), noop()], [mon('mewtwo', ['psystrike'])], { primaryBoss: true })
  bond.player.team[0].hp = 1
  bond.player.team[0].stats.speed = 1000
  boss(bond).stats.speed = 1
  const bonded = coreTurn(bond, {}, enemyAttack)
  assert.equal(bonded.player.team[0].hp, 0)
  assert(boss(bonded).hp > 0)
})

test('H16: damaging phazing moves retain their capped damage while skipping the impossible replacement', () => {
  const state = coreRaid([mon('garchomp', ['dragontail']), noop(), noop()], [mon('mewtwo', ['protect'])], { primaryBoss: true })
  boss(state).hp = boss(state).maxHp = boss(state).baseMaxHp = 80
  state.player.team[0].stats.attack = 100000
  const next = coreTurn(state)
  assert.equal(boss(next).hp, 60)
  assert.equal(next.pendingHumanSwitch ?? null, null)
  assert.equal(next.pendingPlayerSwitch ?? null, null)
})

const member = (index, pokemon = mon('mew', ['psychic', 'lifedew', 'thunderbolt', 'reflect'])) => ({
  ownerId: `private-human-${index}`, displayName: `트레이너 ${index}`, pokemon, isNpc: false,
})
function registeredRaid(bossId = 'mewtwo', count = 3) {
  return createRaidBattle({ raidId: `fixture-${bossId}-${count}`, bossId,
    members: Array.from({ length: count }, (_, index) => member(index)), seed: `registered:${bossId}:${count}` })
}
function bossStage(bossId = 'mewtwo', count = 3) {
  const state = registeredRaid(bossId, count)
  for (const enemy of state.opponent.team) { enemy.hp = 0; enemy.fainted = true }
  return startRaidBossStage(state, { seed: `boss:${bossId}:${count}` })
}

test('C01/M01/O01/L01: all three bosses and one/two/three humans start with exact prelude teams and NPC counts', () => {
  for (const config of RAID_BOSSES) for (const count of [1, 2, 3]) {
    const state = registeredRaid(config.id, count)
    assert.equal(state.player.activeIndexes.length, 3)
    assert.equal(state.opponent.activeIndexes.length, 3)
    assert.deepEqual(state.opponent.team.map(pokemon => pokemon.speciesId), config.stageOne.map(pokemon => pokemon.speciesId))
    assert.equal(state.player.team.filter(pokemon => pokemon.raidNpc).length, 3 - count)
    assert.equal(state.raid.phase, 1)
    assert.equal(getRaidOutcome(state), null)
    assert.throws(() => startRaidBossStage(state), error => error.status === 409)
    const second = bossStage(config.id, count)
    assert.equal(second.raid.phase, 2)
    assert.equal(second.player.activeIndexes.length, 3)
    assert.equal(second.opponent.activeIndexes.length, 1)
    assert.equal(boss(second).speciesId, config.speciesId)
    assert.equal(boss(second).maxHp % 8, 0)
  }
})

test('C02/C03/C14: commands are actor-owned, only allow canonical move choices, and omit fainted input', () => {
  const state = registeredRaid()
  const command = chooseRaidCommand(state, 'private-human-0', { seed: 'command' })
  assert(command)
  const validated = validateRaidCommand(state, 'private-human-0', { ...command, damage: 9999, hp: 99999, ownerId: 'private-human-1' })
  assert.equal(validated.actorId, state.player.team[0].battleId)
  assert.equal(validated.damage, undefined)
  assert.equal(validated.hp, undefined)
  assert.throws(() => validateRaidCommand(state, 'private-human-1', command), error => error.status === 403)
  assert.throws(() => validateRaidCommand(state, 'outsider', command), error => error.status === 403)
  assert.throws(() => validateRaidCommand(state, 'private-human-0', { ...command, type: 'switch', targetIndex: 2 }))
  assert.throws(() => validateRaidCommand(state, 'private-human-0', { ...command, moveIndex: 999 }))
  state.player.team[0].hp = 0
  state.player.team[0].fainted = true
  assert.equal(chooseRaidCommand(state, 'private-human-0'), null)
  assert.throws(() => validateRaidCommand(state, 'private-human-0', command), error => error.status === 409)
  assert(resolveRaidTurn(state, {}, { seed: 'fainted-input' }).turn > state.turn)
})

test('C06/H17: deterministic command resolution survives JSON restart without mutating member saves', () => {
  const state = registeredRaid('hooh')
  const commands = Object.fromEntries(state.raid.members.map(entry => [entry.ownerId, chooseRaidCommand(state, entry.ownerId, { seed: entry.ownerId })]))
  const original = JSON.stringify(state)
  const first = resolveRaidTurn(state, commands, { seed: 'same-transaction' })
  const second = resolveRaidTurn(JSON.parse(original), Object.fromEntries(Object.entries(commands).reverse()), { seed: 'same-transaction' })
  assert.deepEqual(first, second)
  assert.equal(JSON.stringify(state), original)
  assert.deepEqual(first.raid.members, state.raid.members)
  for (const entry of first.raid.members) {
    assert.equal(entry.pokemon.raidVitalityStage, undefined)
    assert.equal(entry.pokemon.raidForm, undefined)
    assert.equal(entry.pokemon.hp, undefined)
  }
})

test('U04: actual move and faint cues retain sound metadata, deterministic cursors and a compact public payload', () => {
  const state = registeredRaid('hooh')
  state.opponent.team[0].hp = 1
  state.player.team[0].stats.speed = 100000
  const commands = Object.fromEntries(state.raid.members.map((entry, index) => [entry.ownerId, {
    type: 'move', actorId: state.player.team[index].battleId, moveIndex: index === 0 ? 0 : 3,
    ...(index === 0 ? { targetActorId: state.opponent.team[0].battleId } : {}),
  }]))
  const snapshot = JSON.stringify(state)
  const next = resolveRaidTurn(state, commands, { seed: 'public-cue-first-turn' })
  const replay = resolveRaidTurn(JSON.parse(snapshot), commands, { seed: 'public-cue-first-turn' })
  const cues = next.raid.events.filter(event => event.kind === 'battle-cue')
  assert(cues.length >= 2)
  assert.deepEqual(replay.raid.events, next.raid.events)
  assert.equal(replay.raid.eventSequence, next.raid.eventSequence)
  const moveCue = cues.find(event => event.cuePhase === 'announce' && event.actorId === state.player.team[0].battleId)
  const move = getMoveById('psychic')
  assert(moveCue, 'The actual Psychic command must produce its own move cue')
  assert.equal(moveCue.moveId, move.id)
  assert.equal(moveCue.moveName, move.name)
  assert.equal(moveCue.moveType, move.type)
  assert.equal(moveCue.moveCategory, 'special')
  assert.equal(moveCue.movePower, move.power)
  const impactCue = cues.find(event => event.cuePhase === 'impact' && event.moveId === move.id)
  assert(impactCue, 'Applied hit damage must be visible independently of HP protection notices')
  assert.equal(impactCue.targetName, state.opponent.team[0].name)
  assert.equal(impactCue.damage, 1, 'The cue reports applied damage, not the uncapped calculated damage')
  const sound = getMoveSoundProfile(moveCue)
  const canonicalSound = getMoveSoundProfile(move)
  assert.equal(sound.moveId, move.id)
  assert.equal(sound.soundFingerprint, canonicalSound.soundFingerprint)
  assert.deepEqual(sound.signatureFrequencies, canonicalSound.signatureFrequencies)
  for (const key of ['launchSample', 'textureSample', 'impactSample']) {
    assert.equal(sound[key], canonicalSound[key], key)
    assert(BATTLE_SAMPLE_PATHS[sound[key]], `Unknown sound sample: ${sound[key]}`)
    assert(existsSync(new URL(`../public${BATTLE_SAMPLE_PATHS[sound[key]]}`, import.meta.url)), `Missing sound sample: ${sound[key]}`)
  }
  const faintCue = cues.find(event => event.cuePhase === 'faint' && event.actorSpeciesId === 244)
  assert(faintCue, 'The actual Entei knockout must produce a faint/cry cue')
  assert.equal(faintCue.actorId, state.opponent.team[0].battleId)
  assert.equal(faintCue.actorName, state.opponent.team[0].name)
  assert.equal(faintCue.hp, 0)
  assert.equal(faintCue.maxHp, state.opponent.team[0].maxHp)
  const allowed = new Set(['id', 'kind', 'message', 'turn', 'phase', 'hp', 'maxHp', 'form', 'cuePhase', 'actorId',
    'sideId', 'targetSideId', 'actorSlot', 'targetSlot', 'actorName', 'actorSpeciesId', 'actorOriginalSpeciesId',
    'targetName', 'targetSpeciesId', 'moveId', 'moveName', 'moveType', 'moveCategory', 'movePower',
    'gimmickId', 'mechanicId', 'mechanicLabel', 'result', 'damage'])
  const publicEvents = getRaidBattleView(next, 'private-human-0').raid.events
  for (const cue of publicEvents.filter(event => event.kind === 'battle-cue')) {
    for (const [key, value] of Object.entries(cue)) {
      assert(allowed.has(key), `Unexpected public cue field: ${key}`)
      assert(value === null || ['string', 'number', 'boolean'].includes(typeof value), 'Cues cannot embed state, teams or move catalogs')
    }
    const serialized = JSON.stringify(cue)
    for (const secret of ['private-human-', 'raidOwnerId', 'pendingTurn', 'members', 'summonPool', 'reviveOrder']) assert(!serialized.includes(secret), secret)
  }
  const laterCommands = Object.fromEntries(next.raid.members.map(entry => [entry.ownerId, chooseRaidCommand(next, entry.ownerId, { seed: `public-cue:${entry.ownerId}` })]))
  const continuation = resolveRaidTurn(next, laterCommands, { seed: 'public-cue-second-turn' })
  const restoredContinuation = resolveRaidTurn(JSON.parse(JSON.stringify(next)), laterCommands, { seed: 'public-cue-second-turn' })
  assert.deepEqual(restoredContinuation.raid.events, continuation.raid.events)
  assert.equal(restoredContinuation.raid.eventSequence, continuation.raid.eventSequence)
  assert(continuation.raid.eventSequence > next.raid.eventSequence)
  assert(continuation.raid.events.length <= 80)
  assert.equal(new Set(continuation.raid.events.map(event => event.id)).size, continuation.raid.events.length)
  const cursorNumbers = continuation.raid.events.map(event => Number(event.id.split(':').at(-1)))
  assert(cursorNumbers.every((value, index) => index === 0 || value === cursorNumbers[index - 1] + 1))
  const normal = createBattle({ playerPokemon: [mon('mew', ['psychic'])], opponent: { name: 'NORMAL CUE REGRESSION' }, opponentTeam: { pokemon: [noop()], battleGimmicks: [] } })
  const normalNext = playBattleTurnWithActions(normal, [{ type: 'move', actorSlot: 0, moveIndex: 0 }], [], () => 0.5)
  assert.equal(normalNext.raid, undefined)
  assert(!JSON.stringify(normalNext).includes('battle-cue'))
})

test('R12/R13: stage transition revives the same actors once and restores HP, PP, status and gimmick quotas', () => {
  const state = registeredRaid('lugia')
  state.player.team[0].hp = 0
  state.player.team[0].fainted = true
  state.player.team[1].hp = 5
  state.player.team[1].status = { id: 'burn' }
  state.player.team[1].moves[0].currentPp = 0
  state.player.team[1].statStages.attack = 3
  state.raid.usedMechanicsByOwner['private-human-1'] = { tera: true }
  state.rules.weather = { id: 'sun' }
  for (const enemy of state.opponent.team) { enemy.hp = 0; enemy.fainted = true }
  const next = startRaidBossStage(state, { seed: 'transition' })
  for (const [index, pokemon] of next.player.team.entries()) {
    assert.equal(pokemon.speciesId, state.player.team[index].speciesId)
    assert.equal(pokemon.raidOwnerId, state.player.team[index].raidOwnerId)
    assert.equal(pokemon.hp, pokemon.maxHp)
    assert.equal(pokemon.fainted, false)
    assert.equal(pokemon.status, null)
    assert(pokemon.moves.every(move => move.currentPp > 0))
  }
  assert.deepEqual(next.raid.usedMechanicsByOwner, {})
  assert.equal(next.rules.weather.id, 'clear')
  assert.equal(next.pendingTurn ?? null, null)
  assert.deepEqual(startRaidBossStage(JSON.parse(JSON.stringify(next)), { seed: 'changed-seed' }), next)
  for (const pokemon of state.player.team) { pokemon.hp = 0; pokemon.fainted = true }
  assert.equal(getRaidOutcome(state), 'lost')
  assert.throws(() => startRaidBossStage(state), error => error.status === 409)
})

test('O12/R14: boss death wins with survivors even when summons live; simultaneous extinction loses', () => {
  const state = bossStage('hooh')
  gate(state, 25)
  assert.equal(state.opponent.team.length, 3)
  boss(state).hp = 0
  boss(state).fainted = true
  assert.equal(getRaidOutcome(state), 'won')
  assert.deepEqual(getRaidBattleView(state, 'private-human-0').opponent.team.map(actor => actor.actorId), [boss(state).battleId], 'Restored finished states must also hide departed summons')
  for (const pokemon of state.player.team) { pokemon.hp = 0; pokemon.fainted = true }
  assert.equal(getRaidOutcome(state), 'lost')
})

test('O12: an actual final hit retires living Ho-Oh summons once without falsifying their HP or actions', () => {
  const state = bossStage('hooh')
  gate(state, 25)
  boss(state).hp = 1
  state.player.team[0].stats.speed = 100000
  const summonsBefore = structuredClone(state.opponent.team.slice(1))
  const commands = Object.fromEntries(state.raid.members.map((entry, index) => [entry.ownerId, {
    type: 'move', actorId: state.player.team[index].battleId, moveIndex: index === 0 ? 0 : 3,
    ...(index === 0 ? { targetActorId: boss(state).battleId } : {}),
  }]))
  const next = resolveRaidTurn(state, commands, { seed: 'hooh-summons-retreat' })
  assert.equal(getRaidOutcome(next), 'won')
  assert.equal(boss(next).hp, 0)
  assert.deepEqual(next.opponent.activeIndexes, [0])
  assert.equal(next.raid.summonsRetreated, true)
  assert.equal(next.raid.events.filter(event => event.kind === 'summons-retreated').length, 1)
  for (const [index, summon] of next.opponent.team.slice(1).entries()) {
    assert.equal(summon.hp, summonsBefore[index].hp)
    assert.equal(summon.fainted, false, 'Retreat is not a fabricated knockout')
    assert.deepEqual(summon.moves.map(move => move.currentPp), summonsBefore[index].moves.map(move => move.currentPp))
  }
  for (const entry of next.raid.members) {
    const view = getRaidBattleView(next, entry.ownerId)
    assert.deepEqual(view.opponent.team.map(actor => actor.actorId), [boss(next).battleId])
    assert.deepEqual(view.opponent.activeIndexes, [0])
  }
  assert.deepEqual(resolveRaidTurn(JSON.parse(JSON.stringify(next)), commands, { seed: 'retry-after-win' }), next)
})

test('U09/H18: projected views agree on HP and hide UID, private templates, future revival order and other moves', () => {
  const state = bossStage('hooh')
  gate(state, 50)
  const views = state.raid.members.filter(entry => !entry.isNpc).map(entry => getRaidBattleView(state, entry.ownerId))
  const hp = view => view.opponent.team.map(pokemon => [pokemon.actorId, pokemon.hp, pokemon.maxHp])
  for (const view of views) {
    assert.deepEqual(hp(view), hp(views[0]))
    const serialized = JSON.stringify(view)
    for (const secret of ['private-human-', 'reviveOrder', 'summonPool', 'usedMechanicsByOwner', 'raidOwnerId']) assert(!serialized.includes(secret), secret)
    assert.equal(view.player.team.filter(pokemon => pokemon.isMine).length, 1)
    assert(view.moves.length > 0)
    assert(view.player.team.every(pokemon => pokemon.moves === undefined))
    assert.equal(view.opponent.team[0].hp / view.opponent.team[0].maxHp, 0.5)
  }
})

test('M10: a slow enraged boss reselects Struggle when its basic action consumes the last PP', () => {
  const state = bossStage('mewtwo')
  const target = boss(state)
  target.hp = target.maxHp / 4
  target.stats.speed = 1
  target.moves.forEach((move, index) => { move.currentPp = index === 0 ? 1 : 0 })
  Object.assign(state.raid, { crossedGates: [75, 50, 25], firedMechanics: [50, 25], enraged: true, enrageTurn: 1 })
  for (const ally of state.player.team) { ally.hp = ally.maxHp = 10000; ally.stats.speed = 500 }
  const commands = Object.fromEntries(state.raid.members.map(entry => [entry.ownerId, {
    type: 'move', actorId: state.player.team.find(pokemon => pokemon.raidOwnerId === entry.ownerId).battleId, moveIndex: 3,
  }]))
  const next = resolveRaidTurn(state, commands, { seed: 'bonus-pp-last' })
  const messages = next.log.slice(state.log.length).map(event => event.message)
  assert.equal(messages.filter(message => message === '뮤츠의 사이코브레이크!').length, 1)
  assert.equal(messages.filter(message => message === '뮤츠의 발버둥!').length, 1)
  assert(!messages.some(message => message.includes('PP가 남아 있지 않다')))
})

test('L03: every current side and field property is explicitly classified for purge or preservation', () => {
  const state = registeredRaid('lugia')
  const retainedSide = new Set(['id', 'name', 'team', 'achievementStart', 'faintCount', 'activeIndex', 'activeIndexes', 'rotationSlot', 'usedMechanics', 'roundUsedThisTurn', 'allyFaintedThisTurn', 'allyFaintedLastTurn'])
  for (const key of Object.keys(state.player)) assert(key in RAID_SIDE_CLEAR_FIELDS || retainedSide.has(key), `Unclassified side property: ${key}`)
  const weatherState = new Set(['baseWeather', 'baseTerrain', 'weatherTurns', 'terrainTurns', 'weatherSource', 'weatherSourceBattleId', 'weatherSourceAbility', 'weatherStrong', 'terrainSource'])
  for (const key of Object.keys(state.environment)) assert(RAID_FIELD_CLEAR_FIELDS.includes(key) || weatherState.has(key), `Unclassified field property: ${key}`)
})

test('BENCHMARK: three bosses × one/two/three humans run legal seeded two-stage simulations to a terminal result', () => {
  const records = []
  const teams = {
    mewtwo: () => mon('tyranitar', ['crunch', 'stoneedge', 'icepunch', 'dragondance']),
    hooh: () => mon('kyogre', ['originpulse', 'waterspout', 'icebeam', 'thunder']),
    lugia: () => mon('miraidon', ['electrodrift', 'thunderbolt', 'calmmind', 'protect']),
  }
  for (const config of RAID_BOSSES) for (const count of [1, 2, 3]) {
    const seed = `balance-${config.id}-${count}-v1`
    let state = createRaidBattle({ raidId: seed, bossId: config.id, members: Array.from({ length: count }, (_, i) => member(i, teams[config.id]())), seed })
    const stages = new Set([1]), latencies = [], gatesSeen = []
    const start = performance.now()
    for (let step = 0; step < 125; step++) {
      const outcome = getRaidOutcome(state)
      if (outcome === 'stage-cleared') {
        state = startRaidBossStage(state, { seed: `${seed}:stage2` })
        stages.add(2)
      } else if (outcome) break
      const commands = Object.fromEntries(state.raid.members.filter(entry => !entry.isNpc).map(entry => [entry.ownerId, chooseRaidCommand(state, entry.ownerId, { seed: `${seed}:input:${step}:${entry.ownerId}` })]).filter(([, value]) => value))
      const turnStart = performance.now()
      state = resolveRaidTurn(state, commands, { seed: `${seed}:turn:${step}` })
      latencies.push(performance.now() - turnStart)
      for (const event of state.raid.events) if (event.gate && !gatesSeen.some(saved => saved.id === event.id)) {
        const target = boss(state)
        gatesSeen.push({ id: event.id, gate: event.gate, kind: event.kind, hp: target?.hp, maxHp: target?.maxHp, form: target?.raidForm ?? null, enemies: state.opponent.activeIndexes.length })
      }
    }
    const outcome = getRaidOutcome(state)
    assert(['won', 'lost'].includes(outcome), `Simulation stalled: ${seed}`)
    records.push({ seed, bossId: config.id, humans: count, npcCount: 3 - count, speciesId: state.raid.members[0].pokemon.speciesId,
      outcome, stages: [...stages], totalTurns: state.raid.totalTurns, elapsedMs: Math.round((performance.now() - start) * 100) / 100,
      turnMinMs: Math.round(Math.min(...latencies) * 100) / 100, turnMaxMs: Math.round(Math.max(...latencies) * 100) / 100, gatesSeen })
  }
  const destination = new URL('./.cache/raid-mechanics/', import.meta.url)
  mkdirSync(destination, { recursive: true })
  writeFileSync(new URL('simulations.json', destination), JSON.stringify({ environment: 'Local Node.js deterministic engine; no network/OAuth/production deployment', records }, null, 2))
  console.log('Raid simulations:', JSON.stringify(records.map(({ gatesSeen, ...record }) => record)))
})
