import assert from 'node:assert/strict'
import pokemonData from '../src/data/generatedPokemonData.json' with { type: 'json' }
import { createBattle, getForcedBattleAction, playBattleTurnWithActions } from '../src/data/battleEngine.js'
import { getLearnableMoves, getMoveById } from '../src/data/trainingData.js'

// Regression fixtures use real selectable species, abilities, items, and legal moves.
// HP, sleep, and Substitute values describe reachable positions before a turn.
// Primary reference: Pokemon Showdown data/moves.ts (Substitute and screen breakers).
const profiles = new Map([...pokemonData.species, ...pokemonData.forms].map((profile) => [profile.slug, profile]))
const random = () => 0.5
const action = { type: 'move', actorSlot: 0, targetSlot: 0, moveIndex: 0, gimmick: null }
const failures = []
let checked = 0

function pokemon(slug, moveIds, overrides = {}) {
  const profile = profiles.get(slug)
  assert(profile, `Missing Pokemon fixture: ${slug}`)
  const legal = new Set(getLearnableMoves(profile.id).map((move) => move.id))
  for (const moveId of moveIds) assert(legal.has(moveId), `${slug} cannot learn ${moveId}`)
  return {
    captureId: `move-audit-${slug}`,
    speciesId: profile.id,
    slug,
    ability: profile.abilities[0],
    moveIds,
    moves: moveIds.map((moveId) => getMoveById(moveId).name),
    ...overrides,
  }
}

function position(attackerSlug, moveId, defenderSlug = 'blissey', defenderOverrides = {}, attackerOverrides = {}) {
  const state = createBattle({
    playerPokemon: [pokemon(attackerSlug, [moveId], attackerOverrides)],
    opponent: { name: 'MOVE SEMANTICS AUDIT' },
    opponentTeam: {
      pokemon: [pokemon(defenderSlug, ['substitute'], defenderOverrides)],
      battleGimmicks: [],
      strategy: {},
    },
  })
  const defender = state.opponent.team[0]
  defender.substituteHp = Math.floor(defender.maxHp / 4)
  defender.hp -= defender.substituteHp
  defender.status = { id: 'sleep', label: '잠듦', counter: 5, toxicCounter: 0 }
  return state
}

function turn(state, rng = random) {
  return playBattleTurnWithActions(state, [action], [action], rng)
}

function duel(playerPokemon, opponentPokemon) {
  return createBattle({
    playerPokemon: [playerPokemon],
    opponent: { name: 'MOVE SEMANTICS AUDIT' },
    opponentTeam: { pokemon: [opponentPokemon], battleGimmicks: [], strategy: {} },
  })
}

function check(name, fn) {
  checked += 1
  try { fn() } catch (error) { failures.push(`${name}: ${error.message}`) }
}

check('Giga Drain recovers from damage dealt to Substitute', () => {
  const before = position('venusaur', 'gigadrain', 'snorlax')
  before.player.team[0].hp -= 70
  const after = turn(before)
  const dealt = before.opponent.team[0].substituteHp - after.opponent.team[0].substituteHp
  assert(dealt > 0)
  assert.equal(after.player.team[0].hp - before.player.team[0].hp, Math.ceil(dealt / 2))
  assert.equal(after.opponent.team[0].hp, before.opponent.team[0].hp)
})

check('Double Edge recoil uses actual Substitute HP removed', () => {
  const before = position('snorlax', 'doubleedge')
  const after = turn(before)
  const dealt = before.opponent.team[0].substituteHp - after.opponent.team[0].substituteHp
  assert(dealt > 0)
  assert.equal(before.player.team[0].hp - after.player.team[0].hp, Math.round(dealt / 3))
})

check('Close Combat lowers the user defenses when hitting Substitute', () => {
  const after = turn(position('lucario', 'closecombat'))
  assert.equal(after.player.team[0].statStages.defense, -1)
  assert.equal(after.player.team[0].statStages.specialDefense, -1)
})

check('Hyper Beam requires recharge after hitting Substitute', () => {
  const after = turn(position('snorlax', 'hyperbeam'))
  assert.equal(after.player.team[0].rechargeTurns, 1)
  assert.equal(getForcedBattleAction(after, 'player', 0)?.forcedReason, 'recharge')
})

check('Outrage locks the next action after hitting Substitute', () => {
  const after = turn(position('dragonite', 'outrage'))
  assert.equal(after.player.team[0].lockedMove?.moveId, 'outrage')
  assert.equal(getForcedBattleAction(after, 'player', 0)?.forcedReason, 'locked')
})

check('Substitute damage is not capped by the real Pokemon remaining HP', () => {
  const before = position('dragonite', 'extremespeed')
  before.opponent.team[0].hp = 1
  const after = turn(before)
  assert.equal(after.opponent.team[0].substituteHp, 0)
  assert.equal(after.opponent.team[0].hp, 1)
})

check('A resistance berry does not activate behind Substitute', () => {
  const before = position('lucario', 'closecombat', 'blissey', { heldItemId: 'chople-berry' })
  const after = turn(before)
  assert.equal(after.opponent.team[0].consumedItem, false)
  assert.equal(after.opponent.team[0].heldItemId, 'chople-berry')
})

check('Focus Sash does not activate for damage absorbed by Substitute', () => {
  const before = position('flareon', 'flareblitz', 'froslass', { heldItemId: 'focus-sash' })
  before.opponent.team[0].hp = before.opponent.team[0].maxHp
  const after = turn(before)
  assert.equal(after.opponent.team[0].consumedItem, false)
  assert.equal(after.opponent.team[0].hp, before.opponent.team[0].hp)
})

check('Disguise remains intact while a Substitute absorbs the move', () => {
  const before = position('bisharp', 'ironhead', 'mimikyu')
  const after = turn(before)
  assert.equal(after.opponent.team[0].speciesId, before.opponent.team[0].speciesId)
  assert.equal(after.opponent.team[0].hp, before.opponent.team[0].hp)
})

check('Power-Up Punch raises the user Attack through Substitute', () => {
  const after = turn(position('lucario', 'poweruppunch'))
  assert.equal(after.player.team[0].statStages.attack, 1)
})

check('Life Orb recoil still applies after hitting Substitute', () => {
  const before = position('snorlax', 'tackle', 'blissey', {}, { heldItemId: 'life-orb' })
  const after = turn(before)
  assert.equal(before.player.team[0].hp - after.player.team[0].hp, Math.floor(before.player.team[0].maxHp / 10))
})

check('Life Orb uses normal maximum HP during an actual Dynamax attack', () => {
  const before = position('snorlax', 'tackle', 'blissey', {}, { heldItemId: 'life-orb', dynamaxMode: 'dynamax' })
  const after = playBattleTurnWithActions(before, [{ ...action, gimmick: 'dynamax' }], [action], random)
  const user = after.player.team[0]
  assert.equal(user.dynamaxActive, true)
  assert.equal(user.maxHp - user.hp, Math.floor(before.player.team[0].maxHp / 10))
})

check('Fling consumes its item without applying target effects through Substitute', () => {
  const after = turn(position('snorlax', 'fling', 'blissey', {}, { heldItemId: 'flame-orb' }))
  assert.equal(after.player.team[0].consumedItem, true)
  assert.equal(after.opponent.team[0].status.id, 'sleep')
})

check('An attack absorbed by Ice Face retains its user stat changes', () => {
  const before = duel(pokemon('lucario', ['closecombat']), pokemon('eiscue', ['substitute']))
  before.opponent.team[0].status = { id: 'sleep', label: '잠듦', counter: 5, toxicCounter: 0 }
  const after = turn(before)
  assert.equal(after.opponent.team[0].hp, before.opponent.team[0].hp)
  assert.equal(after.opponent.team[0].iceFaceBroken, true)
  assert.equal(after.player.team[0].statStages.defense, -1)
  assert.equal(after.player.team[0].statStages.specialDefense, -1)
})

check('Brick Break removes screens before damage through Substitute', () => {
  const before = position('lucario', 'brickbreak', 'snorlax')
  const screened = structuredClone(before)
  screened.opponent.reflectTurns = 3
  screened.opponent.lightScreenTurns = 3
  screened.opponent.auroraVeilTurns = 3
  const normal = turn(before)
  const after = turn(screened)
  assert.equal(after.opponent.team[0].substituteHp, normal.opponent.team[0].substituteHp)
  assert.equal(after.opponent.reflectTurns, 0)
  assert.equal(after.opponent.lightScreenTurns, 0)
  assert.equal(after.opponent.auroraVeilTurns, 0)
})

check('Target secondaries remain blocked by Substitute', () => {
  const after = turn(position('slowking', 'psychic', 'snorlax'), () => 0.01)
  assert.equal(after.opponent.team[0].statStages.specialDefense, 0)
})

check('Rapid Spin clears hazards and boosts Speed through Substitute', () => {
  const before = position('blastoise', 'rapidspin')
  before.player.hazards.spikes = 2
  before.player.hazards.stealthRock = true
  before.player.hazards.toxicSpikes = 1
  before.player.hazards.stickyWeb = true
  const after = turn(before)
  assert.equal(after.player.team[0].statStages.speed, 1)
  assert.equal(after.player.hazards.spikes, 0)
  assert.equal(after.player.hazards.stealthRock, false)
  assert.equal(after.player.hazards.toxicSpikes, 0)
  assert.equal(after.player.hazards.stickyWeb, false)
})

check('Ceaseless Edge lays Spikes through Substitute', () => {
  const after = turn(position('samurott-hisui', 'ceaselessedge'))
  assert.equal(after.opponent.hazards.spikes, 1)
})

check('Stone Axe lays Stealth Rock through Substitute', () => {
  const after = turn(position('kleavor', 'stoneaxe'))
  assert.equal(after.opponent.hazards.stealthRock, true)
})

check('Burn Up and Double Shock remove user types through Substitute', () => {
  for (const [slug, moveId, type] of [['typhlosion', 'burnup', '불꽃'], ['pawmot', 'doubleshock', '전기']]) {
    const after = turn(position(slug, moveId))
    assert(!after.player.team[0].types.includes(type), `${moveId} did not remove ${type}`)
  }
})

check('Counter retaliates against the final hit of a multi-hit move', () => {
  const before = duel(pokemon('cinccino', ['tailslap'], { ability: '스킬링크' }), pokemon('wobbuffet', ['counter']))
  const after = turn(before)
  const totalDamage = before.opponent.team[0].hp - after.opponent.team[0].hp
  const counterDamage = before.player.team[0].hp - after.player.team[0].hp
  assert(totalDamage > 0)
  assert.equal(counterDamage, 2 * totalDamage / 5)
})

check('Glaive Rush doubles next-turn damage until the user attempts its next move', () => {
  const before = duel(pokemon('baxcalibur', ['glaiverush', 'swordsdance']), pokemon('cinderace', ['quickattack']))
  const first = turn(before)
  assert.equal(first.player.team[0].glaiveRushVulnerable, true)
  const control = structuredClone(first)
  control.player.team[0].glaiveRushVulnerable = false
  const playerAction = [{ ...action, moveIndex: 1 }]
  const after = playBattleTurnWithActions(first, playerAction, [action], random)
  const normal = playBattleTurnWithActions(control, playerAction, [action], random)
  const damage = first.player.team[0].hp - after.player.team[0].hp
  const normalDamage = first.player.team[0].hp - normal.player.team[0].hp
  assert(damage >= normalDamage * 2 && damage <= normalDamage * 2 + 1)
  assert.equal(after.player.team[0].glaiveRushVulnerable, false)
})

check('Glaive Rush makes inaccurate attacks hit before the user acts again', () => {
  const before = duel(pokemon('baxcalibur', ['glaiverush', 'swordsdance']), pokemon('cinderace', ['pyroball']))
  before.opponent.team[0].status = { id: 'sleep', label: '잠듦', counter: 2, toxicCounter: 0 }
  const first = turn(before)
  const control = structuredClone(first)
  control.player.team[0].glaiveRushVulnerable = false
  const playerAction = [{ ...action, moveIndex: 1 }]
  const after = playBattleTurnWithActions(first, playerAction, [action], () => 0.99)
  const missed = playBattleTurnWithActions(control, playerAction, [action], () => 0.99)
  assert(after.player.team[0].hp < first.player.team[0].hp)
  assert.equal(missed.player.team[0].hp, first.player.team[0].hp)
})

check('Flame Burst splashes through Substitute using a Dynamax ally normal maximum HP', () => {
  const before = createBattle({
    playerPokemon: [pokemon('charizard', ['flameburst']), pokemon('slowbro', ['protect'])],
    opponent: { name: 'MOVE SEMANTICS AUDIT' },
    opponentTeam: {
      pokemon: [pokemon('blissey', ['substitute']), pokemon('snorlax', ['protect'], { dynamaxMode: 'dynamax', battleMechanics: ['dynamax'] })],
      battleGimmicks: [],
      strategy: {},
    },
    rules: {
      weather: { id: 'clear', label: '맑음' },
      terrain: { id: 'neutral', label: '일반 필드' },
      format: { id: 'double', label: '더블배틀', activeSlots: 2, actionSlots: 2 },
      teamRule: { id: 'full', label: '전체', battleSize: 2 },
    },
  })
  before.opponent.activeIndexes = [0, 1]
  before.opponent.activeIndex = 0
  const defender = before.opponent.team[0]
  defender.substituteHp = Math.floor(defender.maxHp / 4)
  defender.hp -= defender.substituteHp
  defender.status = { id: 'sleep', label: '잠듦', counter: 5, toxicCounter: 0 }
  const after = playBattleTurnWithActions(
    before,
    [action, { ...action, actorSlot: 1 }],
    [action, { ...action, actorSlot: 1, gimmick: 'dynamax' }],
    random,
  )
  const ally = after.opponent.team[1]
  assert.equal(ally.dynamaxActive, true)
  assert.equal(ally.maxHp - ally.hp, Math.floor(before.opponent.team[1].maxHp / 16))
  assert.equal(after.opponent.team[0].hp, before.opponent.team[0].hp)
})

if (failures.length) {
  console.error(failures.join('\n'))
  assert.fail(`${failures.length}/${checked} move-semantic audit scenarios failed`)
}
console.log(`Validated ${checked} legal move-semantic audit scenarios.`)
