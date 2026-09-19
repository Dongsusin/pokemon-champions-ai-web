import assert from 'node:assert/strict'
import test from 'node:test'
import { BOSS_CHALLENGES, createBossChallengeBattle, createBossOpponent } from '../src/data/bossChallenge.js'
import { applyBattleHpLoss, beginRaidDamageRoot, finishRaidDamageRoot, isBossShielded, previewBattleHpLoss } from '../src/data/raidPolicy.js'
import { createBattlePreviewPokemon, playBattleTurnWithActions, getBattleMoveTargets, getEffectiveBattleWeatherId, getBattleMoveSelectionState, chooseAiActionsForSide, resumeBattleTurnTimeline } from '../src/data/battleEngine.js'
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

test('Ho-Oh revives two distinct beasts and blocks every HP loss until living summons are defeated', () => {
  const state = make('hooh')
  reach(state, 50)
  assert.equal(state.opponent.team.length, 2)
  assert.equal(isBossShielded(state), false)
  reach(state, 25)
  assert.equal(state.opponent.team.length, 3)
  assert.notEqual(state.opponent.team[1].speciesId, state.opponent.team[2].speciesId)
  assert.equal(isBossShielded(state), true)
  assert.equal(previewBattleHpLoss(state, boss(state), 9999), 0)
  assert.equal(hit(state), 0)
  state.opponent.team[1].hp = 0; state.opponent.team[1].fainted = true
  assert.equal(hit(state), 0)
  state.opponent.team[2].hp = 0; state.opponent.team[2].fainted = true
  assert.equal(isBossShielded(state), false)
  assert(hit(state) > 0)
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

test('revived beasts are selectable targets and act on the following turn', () => {
  let state = make('hooh')
  state = engineGate(state, 75)
  state = engineGate(state, 50)
  assert.equal(state.opponent.activeIndexes.length, 2)
  state.player.team[0].moves[0] = { ...getMoveById('tackle'), currentPp: 20, maxPp: 20 }
  assert(getBattleMoveTargets(state, 'player', 0).some(target => target.slot === 1))
  const summon = state.opponent.team[1]
  summon.moves[0] = { ...getMoveById('swift'), currentPp: 20, maxPp: 20, accuracy: true }
  const hp = state.player.team[0].hp
  state = playBattleTurnWithActions(state, [], [{ type: 'move', moveIndex: 0, actorSlot: 1, targetSlot: 0 }], () => .1)
  assert(state.player.team[0].hp < hp)
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
