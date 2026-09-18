import assert from 'node:assert/strict'
import {
  advanceFactoryFloor, beginFactoryBattle, createFactoryRun, FACTORY_TRAINER,
  healFactoryPokemon, rerollFactoryHeldItem, resolveFactoryBattle,
  selectFactoryLead, selectFactoryRentals,
} from '../src/data/battleFactory.js'
import {
  FACTORY_MODES, FACTORY_TP_ITEM_REROLL_COST, FACTORY_TP_MAX_AWARD, FACTORY_TP_SWAP_COST,
  getFactoryHealCost, getFactoryHpRatio, getFactoryPokemonRarity, getFactorySwapCost,
  getFactoryTpAward, isFactoryChallengeMode,
} from '../src/data/battleFactoryChallenge.js'
import { createBattle, getBattleSummary } from '../src/data/battleEngine.js'
import { DRAW_RARITY_ORDER } from '../src/data/pokemonPool.js'
import { getBattleItem } from '../src/data/shopData.js'

let passed = 0
const failures = []
const check = (name, run) => {
  try { run(); passed += 1; console.log(`PASS ${name}`) }
  catch (error) { failures.push(name); console.error(`FAIL ${name}: ${error.stack}`) }
}
const rejects = (fn, code) => assert.throws(fn, (error) => error.code === code, `expected ${code}`)

function readyRun(seed = 42, mode = 'challenge') {
  const run = createFactoryRun({ seed, id: `challenge-test-${mode}-${seed}`, mode })
  const selected = selectFactoryRentals(run, run.offers.slice(0, 3).map((entry) => entry.captureId))
  return selectFactoryLead(selected, selected.party[0].captureId)
}
// Finishing a floor with the given ending HP, as the battle screen reports it.
const winFloor = (run, hp) => resolveFactoryBattle(beginFactoryBattle(run), {
  battleId: `${run.id}:floor:${run.floor}`,
  winner: 'player',
  playerTeamHp: run.party.map((pokemon, index) => ({
    captureId: pokemon.captureId, hp: hp[index], maxHp: 100,
  })),
})

check('the mode catalog offers exactly the standard and challenge runs', () => {
  assert.deepEqual(FACTORY_MODES.map((mode) => mode.id), ['standard', 'challenge'])
  assert.equal(createFactoryRun({ seed: 1, id: 'm' }).mode, 'standard')
  assert.equal(createFactoryRun({ seed: 1, id: 'm', mode: 'challenge' }).mode, 'challenge')
  // An unknown mode falls back rather than producing an unplayable run.
  assert.equal(createFactoryRun({ seed: 1, id: 'm', mode: 'nonsense' }).mode, 'standard')
  assert.equal(isFactoryChallengeMode('challenge'), true)
  assert.equal(isFactoryChallengeMode('standard'), false)
})

check('a standard run is untouched: no points, no carried damage, free swaps', () => {
  let run = readyRun(11, 'standard')
  assert.equal(run.towerPoints, 0)
  run = winFloor(run, [3, 0, 91])
  assert.equal(run.towerPoints, 0, 'Standard mode pays no Tower Points')
  assert.equal(run.lastResult.towerPointsEarned, 0)
  assert(run.party.every((pokemon) => getFactoryHpRatio(pokemon) === 1), 'Standard mode heals between floors')
  const next = advanceFactoryFloor(run, {
    giveCaptureId: run.party[0].captureId, takeCaptureId: run.previousOpponent[0].captureId,
  })
  assert.equal(next.towerPoints, 0, 'A standard swap is free')
  assert.equal(getFactoryHpRatio(next.party[0]), 1)
  rejects(() => healFactoryPokemon(next, next.party[0].captureId), 'FACTORY_MODE')
  rejects(() => rerollFactoryHeldItem(next, next.party[0].captureId), 'FACTORY_MODE')
})

check('a challenge win records where each Pokemon finished and pays for the floor', () => {
  let run = readyRun(12)
  run = winFloor(run, [37, 0, 100])
  assert.equal(run.lastResult.towerPointsEarned, getFactoryTpAward(1))
  assert.equal(run.towerPoints, getFactoryTpAward(1))
  assert.deepEqual(run.party.map(getFactoryHpRatio), [0.37, 0, 1])
  const next = advanceFactoryFloor(run, null)
  assert.deepEqual(next.party.map(getFactoryHpRatio), [0.37, 0, 1], 'Damage carries into the next floor')
})

check('the payout grows with the floor and stops at the cap', () => {
  assert(getFactoryTpAward(1) < getFactoryTpAward(5))
  assert(getFactoryTpAward(5) < getFactoryTpAward(9))
  assert.equal(getFactoryTpAward(10), FACTORY_TP_MAX_AWARD)
  assert.equal(getFactoryTpAward(500), FACTORY_TP_MAX_AWARD, 'One win can never pay more than the cap')
  assert.equal(getFactoryTpAward(0), getFactoryTpAward(1), 'A malformed floor is treated as the first')
})

check('points die with the run and never survive a defeat', () => {
  let run = winFloor(readyRun(13), [80, 80, 80])
  assert(run.towerPoints > 0)
  run = advanceFactoryFloor(run, null)
  run = selectFactoryLead(run, run.party[0].captureId)
  const lost = resolveFactoryBattle(beginFactoryBattle(run), {
    battleId: `${run.id}:floor:${run.floor}`, winner: 'opponent',
  })
  assert.equal(lost.phase, 'finished')
  assert.equal(lost.towerPoints, 0, 'A defeat clears the balance')
  assert.equal(createFactoryRun({ seed: 1, id: 'fresh', mode: 'challenge' }).towerPoints, 0)
})

check('healing costs what the wound is worth and cannot be bought without points', () => {
  let run = winFloor(readyRun(14), [50, 0, 100])
  const [hurt, fainted, healthy] = run.party
  assert.equal(getFactoryHealCost(healthy), 0)
  assert(getFactoryHealCost(fainted) > getFactoryHealCost(hurt), 'A knocked out Pokemon costs the most')
  rejects(() => healFactoryPokemon(run, healthy.captureId), 'FACTORY_HEAL')
  rejects(() => healFactoryPokemon(run, 'not-in-this-party'), 'FACTORY_PARTY')
  rejects(() => healFactoryPokemon({ ...run, towerPoints: 0 }, hurt.captureId), 'FACTORY_TP')
  const cost = getFactoryHealCost(hurt)
  const healed = healFactoryPokemon({ ...run, towerPoints: 200 }, hurt.captureId)
  assert.equal(healed.towerPoints, 200 - cost)
  assert.equal(getFactoryHpRatio(healed.party[0]), 1)
  assert.equal(getFactoryHpRatio(healFactoryPokemon({ ...run, towerPoints: 200 }, fainted.captureId).party[1]), 1,
    'A fainted Pokemon can be brought back')
})

check('a swap is priced by the incoming grade and keeps the slot condition', () => {
  const order = DRAW_RARITY_ORDER.map((rarity) => FACTORY_TP_SWAP_COST[rarity])
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'A higher grade never costs less')
  assert.equal(new Set(order).size, order.length, 'Every grade has its own price')
  let run = winFloor(readyRun(15), [20, 100, 100])
  const give = run.party[0]
  const take = run.previousOpponent[0]
  const cost = getFactorySwapCost(take)
  assert.equal(cost, FACTORY_TP_SWAP_COST[getFactoryPokemonRarity(take)])
  rejects(() => advanceFactoryFloor({ ...run, towerPoints: cost - 1 },
    { giveCaptureId: give.captureId, takeCaptureId: take.captureId }), 'FACTORY_TP')
  const swapped = advanceFactoryFloor({ ...run, towerPoints: 300 },
    { giveCaptureId: give.captureId, takeCaptureId: take.captureId })
  assert.equal(swapped.towerPoints, 300 - cost)
  assert.equal(swapped.party[0].captureId, take.captureId)
  assert.equal(getFactoryHpRatio(swapped.party[0]), getFactoryHpRatio(give),
    'The incoming Pokemon inherits the slot condition, so a swap is not a free heal')
})

check('an item reroll costs a flat price and always hands over a different item', () => {
  const run = { ...winFloor(readyRun(16), [100, 100, 100]), towerPoints: 500 }
  rejects(() => rerollFactoryHeldItem({ ...run, towerPoints: 0 }, run.party[0].captureId), 'FACTORY_TP')
  let current = run
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const before = current.party[0].heldItemId
    const beforeHp = getFactoryHpRatio(current.party[0])
    current = rerollFactoryHeldItem(current, current.party[0].captureId)
    const after = current.party[0].heldItemId
    assert.notEqual(after, before, 'A reroll must change the item')
    assert(getBattleItem(after), 'The new item must be a real battle item')
    assert.equal(getBattleItem(after).rewardOnly, undefined, 'A reroll cannot hand out a reward-only item')
    assert.equal(getFactoryHpRatio(current.party[0]), beforeHp, 'A reroll must not change health')
  }
  assert.equal(current.towerPoints, 500 - FACTORY_TP_ITEM_REROLL_COST * 6)
})

check('points can only be spent while waiting between battles', () => {
  const standby = winFloor(readyRun(17), [40, 100, 100])
  const spendable = { ...standby, towerPoints: 300 }
  assert.equal(spendable.phase, 'exchange')
  assert.doesNotThrow(() => healFactoryPokemon(spendable, spendable.party[0].captureId))
  const ready = { ...advanceFactoryFloor(spendable, null), towerPoints: 300 }
  assert.equal(ready.phase, 'ready')
  assert.doesNotThrow(() => healFactoryPokemon(ready, ready.party[0].captureId))
  const fighting = beginFactoryBattle(selectFactoryLead(ready, ready.party[1].captureId))
  rejects(() => healFactoryPokemon(fighting, fighting.party[0].captureId), 'FACTORY_PHASE')
  rejects(() => rerollFactoryHeldItem(fighting, fighting.party[0].captureId), 'FACTORY_PHASE')
})

check('a knocked out Pokemon cannot lead until it is paid back to health', () => {
  const run = advanceFactoryFloor(winFloor(readyRun(18), [100, 0, 100]), null)
  const fainted = run.party[1]
  rejects(() => selectFactoryLead(run, fainted.captureId), 'FACTORY_LEAD')
  // A forged lead cannot sneak past selection either.
  rejects(() => beginFactoryBattle({ ...run, leadCaptureId: fainted.captureId }), 'FACTORY_LEAD')
  const healed = healFactoryPokemon({ ...run, towerPoints: 300 }, fainted.captureId)
  assert.doesNotThrow(() => beginFactoryBattle(selectFactoryLead(healed, fainted.captureId)))
})

check('the real battle engine starts the next floor at the carried health', () => {
  const run = advanceFactoryFloor(winFloor(readyRun(19), [45, 0, 100]), null)
  const battle = createBattle({
    playerPokemon: run.party,
    opponent: FACTORY_TRAINER,
    opponentTeam: run.opponentTeam,
    rules: run.rules,
  })
  const [hurt, fainted, healthy] = battle.player.team
  assert.equal(hurt.hp, Math.round(hurt.maxHp * 0.45))
  assert(hurt.hp > 0 && hurt.hp < hurt.maxHp, 'The damaged Pokemon starts wounded, not dead')
  assert.equal(hurt.fainted, false)
  assert.equal(fainted.hp, 0)
  assert.equal(fainted.fainted, true, 'A Pokemon carried over at zero starts knocked out')
  assert.equal(healthy.hp, healthy.maxHp)
  // A standard run still starts every floor at full health.
  const standard = advanceFactoryFloor(winFloor(readyRun(19, 'standard'), [45, 0, 100]), null)
  const fresh = createBattle({
    playerPokemon: standard.party, opponent: FACTORY_TRAINER,
    opponentTeam: standard.opponentTeam, rules: standard.rules,
  })
  assert(fresh.player.team.every((pokemon) => pokemon.hp === pokemon.maxHp && !pokemon.fainted))
})

check('the battle summary reports every player Pokemon so the run can record it', () => {
  const run = beginFactoryBattle(readyRun(20))
  const battle = createBattle({
    playerPokemon: run.party, opponent: FACTORY_TRAINER,
    opponentTeam: run.opponentTeam, rules: run.rules,
  })
  const summary = getBattleSummary(battle)
  assert.equal(summary.playerTeamHp.length, run.party.length)
  assert.deepEqual(summary.playerTeamHp.map((entry) => entry.captureId), battle.player.team.map((entry) => entry.captureId))
  assert(summary.playerTeamHp.every((entry) => entry.hp === entry.maxHp))
  // A result without the field leaves the recorded health untouched.
  const withoutHp = resolveFactoryBattle(run, { battleId: run.battleId, winner: 'player' })
  assert.deepEqual(withoutHp.party.map(getFactoryHpRatio), [1, 1, 1])
})

console.log(`Battle Factory challenge mode: ${passed} passed, ${failures.length} failed.`)
if (failures.length) process.exitCode = 1
