import assert from 'node:assert/strict'
import test from 'node:test'
import { createBattle, getBattleSummary, playBattleTurnWithActions, resumeBattleTurnTimeline } from '../src/data/battleEngine.js'
import { SPECIES_PROFILES, getLearnableMoves, getMoveById } from '../src/data/trainingData.js'
import { BATTLE_TERRAINS } from '../src/data/battleRules.js'
import { beginFactoryBattle, createFactoryRun, resolveFactoryBattle, selectFactoryLead, selectFactoryRentals } from '../src/data/battleFactory.js'

// Terrain seeds follow item start/terrain change, including airborne holders.
// https://github.com/smogon/pokemon-showdown/blob/master/data/items.ts
// Standard recoil/Life Orb users win a final double KO; HP-cost moves,
// self-sacrifice, and Destiny Bond users lose.
// https://github.com/smogon/pokemon-showdown/blob/master/sim/battle.ts
const profiles = new Map(Object.values(SPECIES_PROFILES).map(profile => [profile.slug, profile]))
let fixtureId = 0
function pokemon(slug, moveIds = ['protect'], options = {}) {
  const profile = profiles.get(slug)
  assert(profile, 'Missing fixture species: ' + slug)
  const legal = new Set(getLearnableMoves(profile.id).map(move => move.id))
  for (const id of moveIds) assert(legal.has(id), slug + ' cannot learn ' + id)
  return { speciesId: profile.id, captureId: 'seed-recoil-' + ++fixtureId, ability: profile.abilities[0],
    moveIds, moves: moveIds.map(id => getMoveById(id).name), ...options }
}
function battle(player, opponent = [pokemon('snorlax', ['amnesia'])], { terrain = 'neutral', pvp = false, double = false } = {}) {
  const slots = double ? 2 : 1
  return createBattle({ playerPokemon: player, opponent: { name: 'REGRESSION' },
    opponentTeam: { pokemon: opponent, battleGimmicks: [], strategy: {} }, random: () => 0.5,
    rules: { pvp, weather: { id: 'clear', label: '맑음' }, terrain: BATTLE_TERRAINS.find(value => value.id === terrain),
      format: { id: double ? 'double' : 'single', activeSlots: slots, actionSlots: slots },
      teamRule: { id: 'full', battleSize: Math.max(player.length, opponent.length) } } })
}
const action = (moveIndex = 0, actorSlot = 0, extra = {}) => ({ type: 'move', moveIndex, actorSlot, targetSlot: 0, ...extra })
const switchAction = targetIndex => ({ type: 'switch', targetIndex, actorSlot: 0 })
const turn = (state, player = action(), opponent = action()) => playBattleTurnWithActions(state, player, opponent, () => 0.5)
function seedActivated(holder, stat = 'specialDefense', stage = 1) {
  assert.equal(holder.consumedItem, true, 'matching seed must be consumed')
  assert.equal(holder.statStages[stat], stage, 'seed must grant exactly one stage')
}
function finalKo(sideId = 'player', moveId = 'flareblitz', pvp = false) {
  const slug = ['explosion', 'selfdestruct'].includes(moveId) ? 'mew' : moveId === 'finalgambit' ? 'staraptor' : 'arcanine'
  const attacker = pokemon(slug, [moveId], { ability: slug === 'mew' ? '싱크로' : '위협' })
  const defender = pokemon('snorlax', ['amnesia'], { ability: '면역' })
  const state = sideId === 'player' ? battle([attacker], [defender], { pvp }) : battle([defender], [attacker], { pvp })
  const attacking = state[sideId].team[0]
  const defending = state[sideId === 'player' ? 'opponent' : 'player'].team[0]
  attacking.hp = moveId === 'finalgambit' ? 10 : 1
  defending.hp = 1
  attacking.stats.speed = 999
  defending.stats.speed = 1
  return turn(state)
}
for (const pvp of [false, true]) for (const sideId of ['player', 'opponent']) {
  test('Final recoil double KO awards the ' + sideId + ' attacker in ' + (pvp ? 'PvP' : 'AI battle'), () => {
    const state = finalKo(sideId, 'flareblitz', pvp)
    assert.equal(state.player.team[0].hp, 0)
    assert.equal(state.opponent.team[0].hp, 0)
    assert.equal(state.winner, sideId)
    assert.equal(state.phase, 'complete')
    assert(state.log.some(entry => /반동/.test(entry.message)))
  })
  for (const moveId of ['explosion', 'selfdestruct', 'finalgambit']) {
    test(moveId + ' final double KO makes its ' + sideId + ' user lose in ' + (pvp ? 'PvP' : 'AI battle'), () => {
      const state = finalKo(sideId, moveId, pvp)
      assert.equal(state.player.team[0].hp, 0)
      assert.equal(state.opponent.team[0].hp, 0)
      assert.equal(state.winner, sideId === 'player' ? 'opponent' : 'player')
    })
  }
  test('Destiny Bond final double KO makes its ' + sideId + ' user lose in ' + (pvp ? 'PvP' : 'AI battle'), () => {
    const state = battle([pokemon('mew', ['psychic'])], [pokemon('mew', ['psychic'])], { pvp })
    const bondUser = state[sideId].team[0]
    const attacker = state[sideId === 'player' ? 'opponent' : 'player'].team[0]
    bondUser.hp = 1
    bondUser.destinyBondActive = true
    attacker.stats.speed = 999
    bondUser.stats.speed = 1
    const next = turn(state)
    assert.equal(next.player.team[0].hp, 0)
    assert.equal(next.opponent.team[0].hp, 0)
    assert.equal(next.winner, sideId === 'player' ? 'opponent' : 'player')
  })
}
test('Recoil KO with a surviving enemy reserve still loses', () => {
  const state = battle([pokemon('arcanine', ['flareblitz'])], [pokemon('snorlax', ['amnesia']), pokemon('mew')])
  state.player.team[0].hp = 1
  state.opponent.team[0].hp = 1
  const next = turn(state)
  assert.equal(next.winner, 'opponent')
  assert(next.opponent.team.some(entry => entry.hp > 0))
})
test('Factory records the actual final recoil result as a victory and permits progression', () => {
  let run = createFactoryRun({ seed: 42, id: 'recoil-result-regression' })
  run = selectFactoryRentals(run, run.offers.slice(0, 3).map(entry => entry.captureId))
  run = beginFactoryBattle(selectFactoryLead(run, run.party[0].captureId))
  const state = finalKo()
  const resolved = resolveFactoryBattle(run, { battleId: run.battleId, winner: getBattleSummary(state).winner })
  assert.equal(resolved.lastResult.won, true)
  assert.equal(resolved.wins, run.wins + 1)
  assert.equal(resolved.phase, 'exchange')
})
for (const [itemId, terrain, stat] of [
  ['psychic-seed', 'psychic', 'specialDefense'], ['misty-seed', 'misty', 'specialDefense'],
  ['electric-seed', 'electric', 'defense'], ['grassy-seed', 'grassy', 'defense'],
]) {
  test(itemId + ' activates on the opening matching terrain exactly once', () => {
    let state = battle([pokemon('mew', ['protect'], { heldItemId: itemId })], undefined, { terrain })
    seedActivated(state.player.team[0], stat)
    state = turn(state)
    seedActivated(state.player.team[0], stat)
  })
  test(itemId + ' activates when a terrain move is used with its holder already active', () => {
    const state = battle([pokemon('mew', [terrain + 'terrain'], { heldItemId: itemId })])
    assert.equal(state.player.team[0].consumedItem, false)
    seedActivated(turn(state).player.team[0], stat)
  })
}
test('Psychic Surge activates an already active opponent seed immediately', () => {
  const state = battle([pokemon('tapu-lele', ['protect'], { ability: '사이코메이커' })], [pokemon('mew', ['protect'], { heldItemId: 'psychic-seed' })])
  seedActivated(state.opponent.team[0])
})
test('Psychic Seed activates on switch-in even with Magic Guard', () => {
  const state = battle([pokemon('mew'), pokemon('clefable', ['protect'], { ability: '매직가드', heldItemId: 'psychic-seed' })], undefined, { terrain: 'psychic' })
  seedActivated(turn(state, switchAction(1)).player.team[1])
})
for (const [slug, ability] of [['hawlucha', '곡예'], ['bronzong', '부유']]) {
  test('Psychic Seed activates for airborne ' + slug, () => {
    const state = battle([pokemon(slug, ['protect'], { ability, heldItemId: 'psychic-seed' })], undefined, { terrain: 'psychic' })
    seedActivated(state.player.team[0])
  })
}
test('Consumed Psychic Seed does not reactivate after switching out and back', () => {
  let state = battle([pokemon('mew', ['protect'], { heldItemId: 'psychic-seed' }), pokemon('mew')], undefined, { terrain: 'psychic' })
  seedActivated(state.player.team[0])
  state = turn(state, switchAction(1))
  state = turn(state, switchAction(0))
  assert.equal(state.player.team[0].consumedItem, true)
  assert.equal(state.player.team[0].statStages.specialDefense, 0)
})
test('Mismatched terrain leaves Psychic Seed intact', () => {
  const state = turn(battle([pokemon('mew', ['electricterrain'], { heldItemId: 'psychic-seed' })]))
  assert.equal(state.player.team[0].consumedItem, false)
  assert.equal(state.player.team[0].statStages.specialDefense, 0)
})
test('Klutz suppresses Psychic Seed until another matching terrain event', () => {
  let state = battle([pokemon('swoobat', ['skillswap', 'protect'], { ability: '서투름', heldItemId: 'psychic-seed' })], [pokemon('mew', ['amnesia'])], { terrain: 'psychic' })
  assert.equal(state.player.team[0].consumedItem, false)
  state = turn(state)
  assert.equal(state.player.team[0].consumedItem, false)
  state.player.team[0].moves = [{ ...getMoveById('psychicterrain'), currentPp: 10, maxPp: 10 }]
  seedActivated(turn(state).player.team[0])
})
test('Magic Room blocks a seed; ending suppression alone does not trigger it', () => {
  let state = battle([pokemon('mew', ['magicroom', 'psychicterrain', 'protect'], { heldItemId: 'psychic-seed' })])
  state = turn(state)
  state = turn(state, action(1))
  assert.equal(state.player.team[0].consumedItem, false)
  assert.equal(state.player.team[0].statStages.specialDefense, 0)
  state = turn(state, action(0))
  assert.equal(state.player.team[0].consumedItem, false)
  state = turn(state, action(1))
  seedActivated(state.player.team[0])
})
test('Embargo blocks a seed; after expiry another terrain event triggers it', () => {
  let state = battle([pokemon('mew', ['psychicterrain', 'protect'], { heldItemId: 'psychic-seed' })])
  state.player.team[0].embargoTurns = 2
  state = turn(state)
  assert.equal(state.player.team[0].consumedItem, false)
  state = turn(state, action(1))
  assert.equal(state.player.team[0].consumedItem, false)
  state = turn(state, action(0))
  seedActivated(state.player.team[0])
})
test('Trick gives an active Klutz holder seed to an eligible target on Psychic Terrain', () => {
  const state = battle([pokemon('swoobat', ['trick'], { ability: '서투름', heldItemId: 'psychic-seed' })], [pokemon('mew', ['amnesia'])], { terrain: 'psychic' })
  const next = turn(state)
  assert.equal(next.opponent.team[0].heldItemId, 'psychic-seed')
  seedActivated(next.opponent.team[0], 'specialDefense', 3)
})
test('A holder knocked out by entry hazards cannot consume Psychic Seed', () => {
  const state = battle([pokemon('mew'), pokemon('mew', ['protect'], { heldItemId: 'psychic-seed' })], undefined, { terrain: 'psychic' })
  state.player.team[1].hp = 1
  state.player.hazards.stealthRock = true
  const next = turn(state, switchAction(1))
  assert.equal(next.player.team[1].hp, 0)
  assert.equal(next.player.team[1].consumedItem, false)
})

for (const [slug, ability] of [['mew', '싱크로'], ['clefable', '매직가드']]) {
  test('Revival Blessing reactivates a surviving active seed holder with ' + ability, () => {
    const state = battle([pokemon('pawmot', ['revivalblessing']), pokemon(slug, ['protect'], { ability, heldItemId: 'psychic-seed' })],
      [pokemon('snorlax', ['amnesia']), pokemon('snorlax', ['amnesia'])], { double: true })
    state.player.team[1].hp = 0
    state.player.team[1].fainted = true
    state.rules.terrain = { ...BATTLE_TERRAINS.find(value => value.id === 'psychic') }
    const waiting = turn(state, [action(), action(0, 1)], [action(), action(0, 1)])
    assert.equal(waiting.pendingPlayerSwitch?.kind, 'revival')
    const revived = resumeBattleTurnTimeline(waiting, 1, () => 0.5).state
    assert(revived.player.team[1].hp > 0)
    seedActivated(revived.player.team[1])
  })
}

test('Psychic Seed is consumed even when Special Defense is already maximized', () => {
  const state = battle([pokemon('mew', ['psychicterrain'], { heldItemId: 'psychic-seed' })])
  state.player.team[0].statStages.specialDefense = 6
  seedActivated(turn(state).player.team[0], 'specialDefense', 6)
})
test('Neutralizing Gas does not disable a seed when its holder switches in', () => {
  const state = battle([pokemon('mew'), pokemon('bronzong', ['protect'], { ability: '부유', heldItemId: 'psychic-seed' })],
    [pokemon('weezing', ['protect'], { ability: '화학변화가스' })], { terrain: 'psychic' })
  const next = turn(state, switchAction(1))
  assert.equal(next.player.team[1].neutralizedAbility, '부유')
  seedActivated(next.player.team[1])
})

for (const pvp of [false, true]) for (const sideId of ['player', 'opponent']) {
  for (const moveId of ['flareblitz', 'flamethrower']) {
    test('Life Orb final KO after ' + moveId + ' awards its ' + sideId + ' user in ' + (pvp ? 'PvP' : 'AI battle'), () => {
      const attacker = pokemon('arcanine', [moveId], { ability: '위협', heldItemId: 'life-orb' })
      const defender = pokemon('snorlax', ['amnesia'], { ability: '면역' })
      const state = sideId === 'player' ? battle([attacker], [defender], { pvp }) : battle([defender], [attacker], { pvp })
      const own = state[sideId].team[0]
      const target = state[sideId === 'player' ? 'opponent' : 'player'].team[0]
      own.hp = moveId === 'flareblitz' ? 2 : 1
      own.stats.speed = 999
      target.hp = 1
      target.stats.speed = 1
      const next = turn(state)
      assert.equal(next.player.team[0].hp, 0)
      assert.equal(next.opponent.team[0].hp, 0)
      assert(next.log.some(entry => entry.message.includes('생명의구슬로 HP가 줄었다')))
      if (moveId === 'flareblitz') assert(next.log.some(entry => /반동으로/.test(entry.message)))
      assert.equal(next.winner, sideId)
    })
  }
}

for (const pvp of [false, true]) for (const sideId of ['player', 'opponent']) {
  for (const [slug, moveId] of [['blacephalon', 'mindblown'], ['lucario', 'steelbeam']]) {
    test(moveId + ' HP-cost final KO makes its ' + sideId + ' user lose in ' + (pvp ? 'PvP' : 'AI battle'), () => {
      const attacker = pokemon(slug, [moveId])
      const defender = pokemon('snorlax', ['amnesia'], { ability: '면역' })
      const state = sideId === 'player' ? battle([attacker], [defender], { pvp }) : battle([defender], [attacker], { pvp })
      const own = state[sideId].team[0]
      const target = state[sideId === 'player' ? 'opponent' : 'player'].team[0]
      own.hp = 1
      own.stats.speed = 999
      target.hp = 1
      target.stats.speed = 1
      const next = turn(state)
      assert.equal(next.player.team[0].hp, 0)
      assert.equal(next.opponent.team[0].hp, 0)
      assert(next.log.some(entry => entry.message.includes('자신의 HP를 크게 소모했다')))
      assert.equal(next.winner, sideId === 'player' ? 'opponent' : 'player')
    })
  }
}

for (const pvp of [false, true]) for (const sideId of ['player', 'opponent']) {
  for (const [slug, moveId] of [['blacephalon', 'mindblown'], ['lucario', 'steelbeam']]) {
    test(moveId + ' final HP-cost loss takes precedence over lethal Life Orb for ' + sideId + (pvp ? ' PvP' : ' AI battle'), () => {
      const attacker = pokemon(slug, [moveId], { heldItemId: 'life-orb' })
      const defender = pokemon('snorlax', ['amnesia'], { ability: '면역' })
      const state = sideId === 'player' ? battle([attacker], [defender], { pvp }) : battle([defender], [attacker], { pvp })
      const own = state[sideId].team[0]
      const target = state[sideId === 'player' ? 'opponent' : 'player'].team[0]
      own.hp = 1
      own.stats.speed = 999
      target.hp = 1
      target.stats.speed = 1
      const next = turn(state)
      assert.equal(next.player.team[0].hp, 0)
      assert.equal(next.opponent.team[0].hp, 0)
      assert(next.log.some(entry => entry.message.includes('생명의구슬로 HP가 줄었다')))
      assert.equal(next.winner, sideId === 'player' ? 'opponent' : 'player')
    })
  }
}

// Chloroblast uses successful-hit recoil and shares the ordinary recoil outcome.
// Source-order inference: Showdown sim/battle-actions.ts resolves target faints
// before applyRecoilDamage; data/moves.ts distinguishes it from Mind Blown.
for (const pvp of [false, true]) for (const sideId of ['player', 'opponent']) {
  for (const [slug, moveId] of [['electrode-hisui', 'chloroblast'], ['arcanine', 'struggle']]) {
    test(moveId + ' final recoil double KO awards its ' + sideId + ' user in ' + (pvp ? 'PvP' : 'AI battle'), () => {
      const attacker = pokemon(slug, [moveId === 'struggle' ? 'protect' : moveId])
      const defender = pokemon('snorlax', ['amnesia'], { ability: '면역' })
      const state = sideId === 'player' ? battle([attacker], [defender], { pvp }) : battle([defender], [attacker], { pvp })
      const own = state[sideId].team[0]
      const target = state[sideId === 'player' ? 'opponent' : 'player'].team[0]
      own.hp = 1
      own.stats.speed = 999
      target.hp = 1
      target.stats.speed = 1
      if (moveId === 'struggle') own.moves.forEach(move => { move.currentPp = 0 })
      const next = turn(state)
      assert.equal(next.player.team[0].hp, 0)
      assert.equal(next.opponent.team[0].hp, 0)
      assert(next.log.some(entry => entry.message.includes(getMoveById(moveId).name)))
      assert(next.log.some(entry => /반동으로/.test(entry.message)))
      assert.equal(next.winner, sideId)
    })
  }
}
