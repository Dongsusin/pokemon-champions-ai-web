import assert from 'node:assert/strict'
import { createFactoryRun, selectFactoryRentals, selectFactoryLead, beginFactoryBattle, resolveFactoryBattle, advanceFactoryFloor } from '../src/data/battleFactory.js'
import { createBattle, playBattleTurnWithActions } from '../src/data/battleEngine.js'
import { FACTORY_RUN_STORAGE_KEY, loadFactoryRun, saveFactoryRun, checkpointFactoryBattle } from '../src/data/battleFactoryStorage.js'
import { readLocalPlayerData, replaceLocalPlayerData } from '../src/auth/accountStorage.js'

const values = new Map()
const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }
globalThis.window = { localStorage: storage }
let run = createFactoryRun({ seed: 34, id: 'persistence-challenge-fixture', mode: 'challenge' })
run = selectFactoryRentals(run, run.offers.slice(0, 3).map(p => p.captureId))
for (let floor = 1; floor < 95; floor++) {
  run = beginFactoryBattle(selectFactoryLead(run, run.party[0].captureId))
  run = resolveFactoryBattle(run, { battleId: run.battleId, winner: 'player',
    playerTeamHp: run.party.map(p => ({ captureId: p.captureId, hp: 60, maxHp: 100 })) })
  run = advanceFactoryFloor(run)
}
saveFactoryRun(run)
assert.deepEqual(loadFactoryRun(), run)
assert.equal(loadFactoryRun().floor, 95)
assert.equal(loadFactoryRun().party[0].startHpRatio, 0.6)
assert(run.towerPoints > 0)
console.log('PASS 95th-floor challenge restores party, HP, TP and floor history')

run = beginFactoryBattle(selectFactoryLead(loadFactoryRun(), run.party[0].captureId))
const state = createBattle({ playerPokemon: run.party, opponent: { name: 'fixture' }, opponentTeam: run.opponentTeam, rules: run.rules })
state.turn = 12
state.player.team[0].hp = 15
state.player.team[0].moves[0].currentPp = 1
state.player.team[0].status = { id: 'poison', label: '독', counter: 0 }
run = checkpointFactoryBattle(run, run.battleId, state)
saveFactoryRun(run)
const restored = loadFactoryRun()
assert.deepEqual(restored.battleState, state)
assert.deepEqual(playBattleTurnWithActions(restored.battleState, [], [], () => 0.5), playBattleTurnWithActions(state, [], [], () => 0.5))
assert.equal(checkpointFactoryBattle(run, 'old-floor', state), run)
console.log('PASS interrupted battle resumes exact turn, HP, PP and status; old callbacks ignored')

const payload = readLocalPlayerData()
assert.equal(payload[FACTORY_RUN_STORAGE_KEY], JSON.stringify(run))
replaceLocalPlayerData({})
assert.equal(loadFactoryRun(), null)
replaceLocalPlayerData(payload)
assert.deepEqual(loadFactoryRun(), run)
console.log('PASS account snapshot includes checkpoint; account switching clears and restores it')

assert.throws(() => saveFactoryRun(run, { setItem() { throw Error('quota') } }), /quota/)
assert.deepEqual(loadFactoryRun(), run)
assert.throws(() => loadFactoryRun({ getItem: () => '{broken' }))
const completed = resolveFactoryBattle(run, { battleId: run.battleId, winner: 'player' })
assert.equal(completed.battleState, null)
assert.equal(advanceFactoryFloor(completed).battleState, null)
console.log('PASS storage failure preserves checkpoint and new floors discard old battle states')
