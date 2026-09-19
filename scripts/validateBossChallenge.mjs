import assert from 'node:assert/strict'
import test from 'node:test'
import { BOSS_CHALLENGES, createBossChallengeBattle, createBossOpponent } from '../src/data/bossChallenge.js'
import { applyBattleHpLoss, beginRaidDamageRoot, finishRaidDamageRoot, isBossShielded, previewBattleHpLoss } from '../src/data/raidPolicy.js'
import { createBattle, createBattlePreviewPokemon, playBattleTurnWithActions, getBattleMoveTargets, getEffectiveBattleWeatherId, getBattleMoveSelectionState, chooseAiActionsForSide, resumeBattleTurnTimeline } from '../src/data/battleEngine.js'
import { getMoveById } from '../src/data/trainingData.js'
import { createRaidHttpHandler } from '../server/raidHttp.js'

const party = [6, 9, 3, 25, 94, 149].map((speciesId, i) => createBossOpponent({ speciesId }, `owned-${i}`))
const make = (bossId = 'mewtwo', random = () => 0.1) => createBossChallengeBattle({ bossId, round: 3, party, random })
const boss = state => state.opponent.team[0]
function hit(state, amount = 1e6) {
  beginRaidDamageRoot(state, `test-${state.raid.firedMechanics.length}`)
  const applied = applyBattleHpLoss(state, boss(state), amount)
  finishRaidDamageRoot(state)
  return applied
}
function reach(state, gate) {
  for (let i = 0; i < 10 && !state.raid.firedMechanics.includes(gate); i++) hit(state)
  assert(state.raid.firedMechanics.includes(gate), `gate ${gate} must fire`)
}
function engineGate(state, gate) {
  boss(state).hp = Math.floor(boss(state).maxHp * gate / 100) + 1
  const attacker = state.player.team[0]
  attacker.moves[0] = { ...getMoveById('swift'), currentPp: 20, maxPp: 20, power: 200, accuracy: true }
  return playBattleTurnWithActions(state, [{ type: 'move', moveIndex: 0, targetSideId: 'opponent', targetSlot: 0, actorSlot: 0 }], [], () => .1)
}

test('all nine encounters use six owned Pokemon and the requested formats/rosters', () => {
  for (const challenge of BOSS_CHALLENGES) {
    for (let round = 1; round <= 3; round++) {
      const state = createBossChallengeBattle({ bossId: challenge.id, round, party })
      assert.equal(state.player.team.length, 6)
      assert.equal(state.opponent.team.length, round === 1 ? 6 : round === 2 ? challenge.id === 'mewtwo' ? 6 : 3 : 1)
      assert.equal(state.rules.format.id, round === 1 ? 'double' : 'single')
      assert.equal(state.player.activeIndexes.length, round === 1 ? 2 : 1)
      assert.equal(Boolean(state.raid), round === 3)
      assert(state.player.team.every(p => p.hp === p.maxHp && p.moves.every(m => m.currentPp === m.maxPp)))
      if (round === 3) {
        const baseline = createBattlePreviewPokemon(createBossOpponent(challenge.rounds[2].pokemon[0], 'baseline'))
        assert.equal(boss(state).maxHp, baseline.maxHp)
        assert.deepEqual(boss(state).stats, baseline.stats)
      }
    }
  }
  assert.throws(() => createBossChallengeBattle({ bossId: 'mewtwo', round: 1, party: party.slice(0, 3) }))
  assert.throws(() => createBossChallengeBattle({ bossId: 'mewtwo', round: 1, party: Array(6).fill(party[0]) }))
})

test('boss HP carryover heals between rounds one and two, then preserves wounds and faints into round three by capture ID', () => {
  const duplicateParty = [6, 6, 3, 25, 94, 149].map((speciesId, index) => createBossOpponent({ speciesId }, `carry-${index}`))
  const savedParty = structuredClone(duplicateParty)
  for (const challenge of BOSS_CHALLENGES) {
    const first = createBossChallengeBattle({ bossId: challenge.id, round: 1, party: duplicateParty })
    first.player.team.forEach((pokemon, index) => {
      pokemon.hp = index === 0 || index === 3 ? 0 : index === 1 ? 7 : pokemon.maxHp - 17
      pokemon.fainted = pokemon.hp === 0
      pokemon.status = { id: 'poison', label: '독' }
      pokemon.moves.forEach(move => { move.currentPp = 0 })
      pokemon.teraActive = true
      pokemon.usedBattleMechanicId = 'tera'
    })
    const previousPlayerTeam = [...first.player.team].reverse()
    const previousSnapshot = structuredClone(previousPlayerTeam)
    const second = createBossChallengeBattle({ bossId: challenge.id, round: 2, party: duplicateParty, previousPlayerTeam })
    assert.deepEqual(second.player.activeIndexes, [0])
    assert.equal(second.player.faintCount, 0)
    for (const pokemon of second.player.team) {
      assert.equal(pokemon.hp, pokemon.maxHp, 'round two starts fully healed')
      assert.equal(pokemon.fainted, false, 'round one knockouts are restored before round two')
      assert.equal(pokemon.status, null)
      assert(pokemon.moves.every(move => move.currentPp === move.maxPp))
      assert.equal(pokemon.teraActive, false)
      assert.equal(pokemon.usedBattleMechanicId, null)
    }
    assert(Object.values(second.player.usedMechanics).every(used => !used))
    assert.deepEqual(previousPlayerTeam, previousSnapshot, 'creating a round cannot mutate the finished battle')
    second.player.team.forEach((pokemon, index) => {
      pokemon.hp = index === 0 || index === 3 ? 0 : index === 1 ? 1 : pokemon.maxHp - 23
      pokemon.fainted = pokemon.hp === 0
      pokemon.status = { id: 'poison', label: '독' }
      pokemon.moves.forEach(move => { move.currentPp = 0 })
      pokemon.teraActive = true
      pokemon.usedBattleMechanicId = 'tera'
    })
    const secondFinishedTeam = [...second.player.team].reverse()
    const secondSnapshot = structuredClone(secondFinishedTeam)
    const third = createBossChallengeBattle({ bossId: challenge.id, round: 3, party: duplicateParty, previousPlayerTeam: secondFinishedTeam })
    assert.deepEqual(third.player.activeIndexes, [1])
    assert.equal(third.player.faintCount, 2)
    for (const pokemon of third.player.team) {
      const previous = secondFinishedTeam.find(entry => entry.captureId === pokemon.captureId)
      assert.equal(pokemon.hp, previous.hp)
      assert.equal(pokemon.fainted, previous.fainted)
      assert.equal(pokemon.status, null)
      assert(pokemon.moves.every(move => move.currentPp === move.maxPp))
      assert.equal(pokemon.teraActive, false)
      assert.equal(pokemon.usedBattleMechanicId, null)
    }
    assert(Object.values(third.player.usedMechanics).every(used => !used))
    assert.equal(third.player.team[1].hp, 1, 'a living teammate at 1 HP must remain selectable')
    assert.deepEqual(secondFinishedTeam, secondSnapshot)
  }
  assert.deepEqual(duplicateParty, savedParty, 'the saved team must remain untouched')
})

test('boss HP carryover is ignored at the start of rounds one and two, including a fresh retry', () => {
  const finished = make().player.team
  finished.forEach(pokemon => { pokemon.hp = 0; pokemon.fainted = true })
  for (const challenge of BOSS_CHALLENGES) for (const round of [1, 2]) {
    const retry = createBossChallengeBattle({ bossId: challenge.id, round, party, previousPlayerTeam: finished })
    assert(retry.player.team.every(pokemon => pokemon.hp === pokemon.maxHp && !pokemon.fainted))
    assert.deepEqual(retry.player.activeIndexes, round === 1 ? [0, 1] : [0])
    assert.equal(retry.player.faintCount, 0)
  }
})

test('boss HP carryover normalizes active Dynamax HP without healing, reviving, or changing saved forms', () => {
  const previousPlayerTeam = createBossChallengeBattle({ bossId: 'mewtwo', round: 2, party }).player.team
  previousPlayerTeam.forEach((pokemon, index) => {
    pokemon.dynamaxActive = true
    pokemon.maxHp *= 2
    pokemon.hp = index === 0 ? 151 : index === 1 ? 0 : index === 2 ? 1 : 40
    pokemon.fainted = pokemon.hp === 0
  })
  const previousSnapshot = structuredClone(previousPlayerTeam)
  const next = createBossChallengeBattle({ bossId: 'mewtwo', round: 3, party, previousPlayerTeam })
  assert.deepEqual(next.player.team.map(pokemon => pokemon.hp), [76, 0, 1, 20, 20, 20])
  next.player.team.forEach((pokemon, index) => {
    assert.equal(pokemon.maxHp, previousPlayerTeam[index].originalMaxHp)
    assert.equal(pokemon.speciesId, party[index].speciesId)
    assert.equal(pokemon.dynamaxActive, false)
    assert.equal(pokemon.fainted, index === 1)
  })
  assert.deepEqual(previousPlayerTeam, previousSnapshot)
})

test('boss HP carryover selects the living lead before entry abilities run', () => {
  const entryParty = [373, 382, 3, 25, 94, 149].map((speciesId, index) => createBossOpponent({ speciesId }, `entry-${index}`))
  const previousPlayerTeam = createBossChallengeBattle({ bossId: 'hooh', round: 2, party: entryParty }).player.team
  previousPlayerTeam[0].hp = 0
  previousPlayerTeam[0].fainted = true
  previousPlayerTeam[1].hp = 41
  const next = createBossChallengeBattle({ bossId: 'hooh', round: 3, party: entryParty, previousPlayerTeam })
  assert.deepEqual(next.player.activeIndexes, [1])
  assert.equal(next.player.team[1].hp, 41)
  assert.equal(getEffectiveBattleWeatherId(next), 'rain', 'the living Kyogre must activate Drizzle')
  assert(next.opponent.team.every(pokemon => pokemon.statStages.attack === 0), 'the fainted Salamence cannot activate Intimidate')
  assert(!next.log.some(entry => entry.message.includes('위협')))
})

test('boss HP carryover initializes Supreme Overlord from teammates already fainted', () => {
  const entryParty = [6, 9, 983, 25, 94, 149].map((speciesId, index) => createBossOpponent({ speciesId }, `fallen-${index}`))
  entryParty[2].ability = '총대장'
  const previousPlayerTeam = createBossChallengeBattle({ bossId: 'hooh', round: 2, party: entryParty }).player.team
  previousPlayerTeam.slice(0, 2).forEach(pokemon => { pokemon.hp = 0; pokemon.fainted = true })
  const next = createBossChallengeBattle({ bossId: 'hooh', round: 3, party: entryParty, previousPlayerTeam })
  assert.deepEqual(next.player.activeIndexes, [2])
  assert.equal(next.player.faintCount, 2)
  assert.equal(next.player.team[2].supremeOverlordFallen, 2)
  assert(next.log.some(entry => entry.message.includes('총대장') && entry.message.includes('20%')))
})

test('boss HP carryover rejects incomplete, foreign, duplicate, invalid, and entirely fainted teams', () => {
  const previous = createBossChallengeBattle({ bossId: 'mewtwo', round: 2, party }).player.team
  const invalidTeams = [
    previous.slice(0, 5),
    previous.map((pokemon, index) => index === 5 ? { ...pokemon, captureId: 'foreign' } : pokemon),
    previous.map((pokemon, index) => index === 5 ? { ...pokemon, captureId: previous[0].captureId } : pokemon),
    previous.map((pokemon, index) => index === 0 ? { ...pokemon, hp: Number.NaN } : pokemon),
    previous.map((pokemon, index) => index === 0 ? { ...pokemon, maxHp: 0 } : pokemon),
    previous.map(pokemon => ({ ...pokemon, hp: 0, fainted: true })),
  ]
  for (const previousPlayerTeam of invalidTeams) {
    assert.throws(() => createBossChallengeBattle({ bossId: 'mewtwo', round: 3, party, previousPlayerTeam }))
  }
})

test('ordinary AI battle initialization still starts at full HP without carryover', () => {
  const reference = make()
  const woundedEntries = party.map(pokemon => ({ ...pokemon, hp: 0, fainted: true }))
  const state = createBattle({ playerPokemon: woundedEntries, opponent: reference.opponentMeta,
    opponentTeam: { pokemon: party, battleGimmicks: [], strategy: {} }, rules: reference.rules })
  assert(state.player.team.every(pokemon => pokemon.hp === pokemon.maxHp && !pokemon.fainted))
  assert.deepEqual(state.player.activeIndexes, [0])
})

test('damage cap covers the whole attack and 75% raises all six stats only once', () => {
  const state = make()
  const initialMax = boss(state).maxHp
  beginRaidDamageRoot(state, 'multi-hit')
  let total = 0
  for (let i = 0; i < 5; i++) total += applyBattleHpLoss(state, boss(state), 1000)
  assert(total <= Math.floor(initialMax / 4))
  finishRaidDamageRoot(state)
  reach(state, 75)
  assert.equal(boss(state).maxHp, Math.ceil(initialMax * 1.5))
  for (const stat of ['attack', 'defense', 'specialAttack', 'specialDefense', 'speed']) assert.equal(boss(state).statStages[stat], 1)
  assert.equal(boss(state).statStages.accuracy, 0)
  assert.equal(boss(state).statStages.evasion, 0)
  boss(state).hp = boss(state).maxHp
  reach(state, 50)
  assert.equal(boss(state).maxHp, Math.ceil(initialMax * 1.5))
  assert.equal(state.raid.firedMechanics.filter(gate => gate === 75).length, 1)
})

test('Mewtwo transforms at 50% and uses real Mega X/Y stats, types and sprites at 25%', () => {
  for (const random of [() => .1, () => .9]) {
    let state = make('mewtwo', random)
    state = engineGate(state, 75)
    const raisedMax = boss(state).maxHp
    state = engineGate(state, 50)
    assert.equal(boss(state).raidForm, 'armored')
    assert.match(boss(state).spriteFront, /armored-mewtwo/)
    assert.equal(boss(state).maxHp, raisedMax)
    state = engineGate(state, 25)
    assert.equal(boss(state).slug, random() < .5 ? 'mewtwo-mega-x' : 'mewtwo-mega-y')
    assert.equal(boss(state).megaActive, true)
    assert.equal(boss(state).maxHp, raisedMax)
    assert.equal(boss(state).statStages.attack, 1)
    assert(!boss(state).spriteFront.includes('armored'))
    assert(!state.raid.enraged)
  }
})

test('Ho-Oh shields both revival waves, blocks the next gate, and reuses one support slot', () => {
  const state = make('hooh')
  reach(state, 50)
  assert.equal(state.opponent.team.length, 2)
  const first = state.opponent.team[1]
  const protectedHp = boss(state).hp
  assert.equal(isBossShielded(state), true)
  for (const kind of ['action', 'residual', 'entry']) {
    beginRaidDamageRoot(state, `shield-${kind}`, kind)
    assert.equal(previewBattleHpLoss(state, boss(state), 9999), 0, `${kind} preview starts shielded`)
    for (let hitIndex = 0; hitIndex < 5; hitIndex++) assert.equal(applyBattleHpLoss(state, boss(state), 9999), 0)
    finishRaidDamageRoot(state)
  }
  assert.equal(boss(state).hp, protectedHp)
  assert(!state.raid.crossedGates.includes(25))
  assert(!state.raid.firedMechanics.includes(25))
  assert.deepEqual(state.raid.pendingGates, [])
  applyBattleHpLoss(state, first, first.hp)
  assert.equal(isBossShielded(state), false, 'zero HP removes the shield before faint bookkeeping')
  first.fainted = true
  reach(state, 25)
  assert.equal(state.opponent.team.length, 3)
  const second = state.opponent.team[2]
  assert.notEqual(first.speciesId, second.speciesId)
  assert.deepEqual(state.opponent.activeIndexes, [0, 2])
  assert.equal(first.hp, 0)
  assert.equal(first.fainted, true)
  assert.equal(second.hp, second.maxHp)
  assert.equal(isBossShielded(state), true)
  beginRaidDamageRoot(state, 'fresh-second-wave')
  assert.equal(previewBattleHpLoss(state, boss(state), 9999), 0)
  assert.equal(hit(state), 0)
  applyBattleHpLoss(state, second, second.hp)
  second.fainted = true
  assert.equal(isBossShielded(state), false)
  assert(hit(state, 1) > 0)
  boss(state).hp = boss(state).maxHp
  for (let index = 0; index < 5; index++) hit(state)
  assert.equal(state.opponent.team.length, 3, 'healing never revives another beast')
  assert.deepEqual(state.raid.firedMechanics, [75, 50, 25])
  assert.equal(state.raid.events.filter(event => event.kind === 'summon').length, 2)
})

test('resumed pending Ho-Oh waves wait for the current beast and fire only once', () => {
  const state = make('hooh')
  reach(state, 50)
  state.raid.pendingGates = [50, 25, 25]
  finishRaidDamageRoot(state)
  finishRaidDamageRoot(state)
  assert.equal(state.opponent.team.length, 2)
  assert.deepEqual(state.raid.pendingGates, [25])
  assert.deepEqual(state.raid.firedMechanics, [75, 50])
  applyBattleHpLoss(state, state.opponent.team[1], 9999)
  finishRaidDamageRoot(state)
  finishRaidDamageRoot(state)
  assert.equal(state.opponent.team.length, 3)
  assert.deepEqual(state.opponent.activeIndexes, [0, 2])
  assert.deepEqual(state.raid.pendingGates, [])
  assert.deepEqual(state.raid.firedMechanics, [75, 50, 25])
})

test('Ho-Oh shield blocks actual multihit, status, and weather damage at both thresholds', () => {
  let state = make('hooh')
  reach(state, 50)
  for (const gate of [50, 25]) {
    const protectedHp = boss(state).hp
    boss(state).status = { id: 'toxic', label: '맹독', toxicCounter: 10 }
    state.rules.weather = { id: 'sandstorm', label: '모래바람' }
    state.environment.weatherTurns = 5
    state.player.team[0].moves[0] = { ...getMoveById('doublehit'), currentPp: 20, maxPp: 20, power: 999, accuracy: 100 }
    state = playBattleTurnWithActions(state, [{ type: 'move', moveIndex: 0, targetSlot: 0 }], [], () => .1)
    assert.equal(boss(state).hp, protectedHp, `${gate}% shield survives the whole attack and residual phase`)
    assert(isBossShielded(state))
    assert.equal(state.opponent.activeIndexes.length, 2)
    boss(state).status = null
    state.rules.weather = { id: 'clear', label: '맑음' }
    state.environment.weatherTurns = null
    const supportIndex = state.opponent.activeIndexes[1]
    state.opponent.team[supportIndex].hp = 1
    state = playBattleTurnWithActions(state, [{ type: 'move', moveIndex: 0, targetSlot: 1 }], [], () => .1)
    assert.equal(state.opponent.team[supportIndex].fainted, true)
    assert.equal(boss(state).hp, protectedHp, 'defeating a targeted beast does not redirect later multihits to Ho-Oh')
    assert.equal(isBossShielded(state), false)
    if (gate === 50) reach(state, 25)
  }
})

test('a spread attack defeats the beast without passing through the shield onto Ho-Oh', () => {
  let state = make('hooh')
  reach(state, 50)
  const protectedHp = boss(state).hp
  state.opponent.team[1].hp = 1
  state.player.team[0].moves[0] = { ...getMoveById('swift'), currentPp: 20, maxPp: 20, power: 999, accuracy: true }
  state = playBattleTurnWithActions(state, [{ type: 'move', moveIndex: 0, targetSlot: 0 }], [], () => .1)
  assert.equal(boss(state).hp, protectedHp)
  assert.equal(state.opponent.team[1].fainted, true)
  assert.equal(isBossShielded(state), false)
  assert(!state.raid.firedMechanics.includes(25))
  assert(hit(state) > 0, 'the following damage root can advance toward 25%')
})

test('Lugia changes form at 50%, rain begins only at 25%, preserves field and rejects weather moves', () => {
  let state = make('lugia')
  state.player.team[0].statStages.attack = 2
  state.player.reflectTurns = 8
  state = engineGate(state, 75)
  state = engineGate(state, 50)
  assert.equal(boss(state).raidForm, 'dark')
  assert.equal(getEffectiveBattleWeatherId(state), 'clear')
  assert.equal(state.player.team[0].statStages.attack, 2)
  assert(state.player.reflectTurns > 0)
  state = engineGate(state, 25)
  assert.equal(getEffectiveBattleWeatherId(state), 'rain')
  assert.equal(state.environment.weatherTurns, null)
  state.player.team[0].moves[0] = { ...getMoveById('sunnyday'), currentPp: 10, maxPp: 10 }
  state = playBattleTurnWithActions(state, [{ type: 'move', moveIndex: 0 }], [], () => .1)
  assert.equal(getEffectiveBattleWeatherId(state), 'rain')
  assert.equal(state.environment.weatherTurns, null)
})

test('six-member boss rounds support normal voluntary switches and pivot moves', () => {
  const state = make()
  state.player.team[0].moves[0] = { ...getMoveById('uturn'), currentPp: 20, maxPp: 20 }
  assert.equal(getBattleMoveSelectionState(state, 'player', 0).disabled, false)
  const switched = playBattleTurnWithActions(state, [{ type: 'switch', targetIndex: 1, actorSlot: 0 }], [], () => .1)
  assert.equal(switched.player.activeIndexes[0], 1)
  const pivot = playBattleTurnWithActions(state, [{ type: 'move', moveIndex: 0, targetSlot: 0 }], [], () => .1)
  assert(pivot.awaitingPlayerSwitch)
})

test('both revived beasts are selectable in support slot one and act on the following turn', () => {
  let state = make('hooh')
  state = engineGate(state, 75)
  state = engineGate(state, 50)
  const species = []
  for (const gate of [50, 25]) {
    assert.equal(state.opponent.activeIndexes.length, 2)
    state.player.team[0].moves[0] = { ...getMoveById('tackle'), currentPp: 20, maxPp: 20 }
    const targets = getBattleMoveTargets(state, 'player', 0)
    assert(targets.some(target => target.slot === 1))
    assert(targets.every(target => target.slot < 2))
    const summonIndex = state.opponent.activeIndexes[1]
    const summon = state.opponent.team[summonIndex]
    species.push(summon.speciesId)
    assert.equal(summon.activeFromTurn, state.turn)
    summon.moves[0] = { ...getMoveById('swift'), currentPp: 20, maxPp: 20, accuracy: true }
    state.player.team[0].moves[0] = { ...getMoveById('splash'), currentPp: 20, maxPp: 20 }
    const hp = state.player.team[0].hp
    state = playBattleTurnWithActions(state, [{ type: 'move', moveIndex: 0 }], [{ type: 'move', moveIndex: 0, actorSlot: 1, targetSlot: 0 }], () => .1)
    assert(state.player.team[0].hp < hp, `${gate}% summon must act from the reused support slot`)
    assert(chooseAiActionsForSide(state, 'opponent', () => .1).every(action => action.actorSlot < 2))
    if (gate === 50) {
      applyBattleHpLoss(state, state.opponent.team[summonIndex], 9999)
      state.opponent.team[summonIndex].fainted = true
      state = engineGate(state, 25)
    }
  }
  assert.notEqual(species[0], species[1])
})

test('retired matchmaking rejects room operations before calling the legacy service', async () => {
  const handler = createRaidHttpHandler({ enabled: true, legacyMatching: false, allowLocalOrigins: true,
    authenticate: async () => { throw new Error('must not authenticate retired operation') }, service: {} })
  for (const action of ['roomCreate', 'roomJoin', 'roomReady', 'roomStart', 'roomHeartbeat']) {
    const response = await handler(new Request('http://localhost/api/raid', { method: 'POST', headers: {
      origin: 'http://localhost', authorization: 'Bearer test-token-long', 'content-type': 'application/json',
    }, body: JSON.stringify({ action }) }))
    assert.equal(response.status, 410)
  }
})

test('all nine actual engine encounters resolve with bench replacements and legal AI actions', () => {
  for (const challenge of BOSS_CHALLENGES) for (let round = 1; round <= 3; round++) {
    let state = createBossChallengeBattle({ bossId: challenge.id, round, party, random: () => .25 })
    let steps = 0
    while (!state.winner && steps++ < 180) {
      if (state.awaitingPlayerSwitch) {
        const index = state.player.team.findIndex((p, i) => p.hp > 0 && !p.fainted && !state.player.activeIndexes.includes(i))
        assert(index >= 0)
        state = resumeBattleTurnTimeline(state, index, () => .25).state
      } else {
        const actions = chooseAiActionsForSide(state, 'player', () => .25)
        const opponents = chooseAiActionsForSide(state, 'opponent', () => .25)
        state = playBattleTurnWithActions(state, actions, opponents, () => .25)
      }
      for (const p of [...state.player.team, ...state.opponent.team]) assert(Number.isFinite(p.hp) && p.hp >= 0 && p.hp <= p.maxHp)
    }
    assert(state.winner, `${challenge.id} round ${round} must reach a terminal result`)
  }
})
