import assert from 'node:assert/strict'
import { createFactoryRun, selectFactoryRentals, selectFactoryLead, beginFactoryBattle, resolveFactoryBattle, advanceFactoryFloor } from '../src/data/battleFactory.js'
import { FACTORY_PARTY_COST_LIMIT, getFactoryPokemonCost, getFactoryPartyCost, hasFactoryCostLimit } from '../src/data/battleFactoryChallenge.js'
import { normalizePokemon } from '../src/data/trainingData.js'
const mon = id => normalizePokemon({ captureId: `cost-${id}`, speciesId: id })
const offers = [150, 445, 25, 151, 26, 6].map(mon)
assert.deepEqual([25, 26, 6, 445, 150].map(id => getFactoryPokemonCost(mon(id))), [1, 2, 3, 4, 5])
assert.equal(FACTORY_PARTY_COST_LIMIT, 10)
assert.equal(getFactoryPokemonCost({ ...mon(150), rarity: 'common', cost: 0 }), 5, 'derive cost from the draw catalog, never editable display fields')
const selection = { ...createFactoryRun({ seed: 5, mode: 'challenge' }), offers }
assert(hasFactoryCostLimit(JSON.parse(JSON.stringify(selection))), 'cost rules survive save/reload')
const legalIds = [150, 445, 25].map(id => `cost-${id}`)
const illegalIds = [150, 151, 25].map(id => `cost-${id}`)
const original = JSON.stringify(selection)
assert.throws(() => selectFactoryRentals(selection, illegalIds), { code: 'FACTORY_COST' })
assert.equal(JSON.stringify(selection), original)
let ready = selectFactoryRentals(selection, legalIds)
assert.equal(getFactoryPartyCost(ready.party), 10)
ready = selectFactoryLead(ready, legalIds[0])
assert.throws(() => beginFactoryBattle({ ...ready, party: [mon(150), mon(151), mon(25)] }), { code: 'FACTORY_COST' })
const battle = beginFactoryBattle(ready)
const won = { ...resolveFactoryBattle(battle, { battleId: battle.battleId, winner: 'player' }), towerPoints: 1000, previousOpponent: [mon(151), mon(26), mon(6)] }
const before = JSON.stringify(won)
assert.throws(() => advanceFactoryFloor(won, { giveCaptureId: 'cost-445', takeCaptureId: 'cost-151' }), { code: 'FACTORY_COST' })
assert.equal(JSON.stringify(won), before, 'failed swap must not consume TP or modify run')
const swapped = advanceFactoryFloor(won, { giveCaptureId: 'cost-150', takeCaptureId: 'cost-151' })
assert.equal(getFactoryPartyCost(swapped.party), 10)
assert.equal(swapped.towerPoints, 910)
assert.equal(getFactoryPartyCost(advanceFactoryFloor(won).party), 10)
assert.equal(getFactoryPartyCost(selectFactoryRentals({ ...selection, mode: 'standard' }, illegalIds).party), 11)
const legacy = { ...selection }; delete legacy.costRulesVersion
assert.equal(hasFactoryCostLimit(legacy), false)
assert.equal(getFactoryPartyCost(selectFactoryRentals(legacy, illegalIds).party), 11)
let repaired = 0
for (const seed of [...Array.from({length: 300}, (_, index) => index), 6901]) {
  const run = createFactoryRun({ seed, mode: 'challenge', id: 'budget' })
  const standard = createFactoryRun({ seed, mode: 'standard', id: 'budget' })
  const cheapest = [...run.offers].sort((a,b) => getFactoryPokemonCost(a) - getFactoryPokemonCost(b)).slice(0,3)
  assert(getFactoryPartyCost(cheapest) <= 10)
  assert.equal(run.offers.length, 6)
  assert.equal(new Set(run.offers.map(p => p.dexSpeciesId)).size, 6)
  assert.equal(new Set(run.offers.map(p => p.captureId)).size, 6)
  assert.deepEqual(run.offers, createFactoryRun({ seed, mode: 'challenge', id: 'budget' }).offers)
  selectFactoryRentals(run, cheapest.map(p => p.captureId))
  if (JSON.stringify(run.offers) !== JSON.stringify(standard.offers)) repaired++
}
assert(repaired > 0, 'test must exercise an unaffordable initial roll repaired into a legal choice')
console.log(`PASS factory cost: grades, selection, start guard, swaps, TP atomicity, standard/legacy compatibility, 301 legal offers (${repaired} repaired)`)
