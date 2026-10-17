import assert from 'node:assert/strict'
import { canonicalizeRankedTeam, createRankedBattle, validateRankedAction, resolveRankedTurn,
  resolveRankedReplacement, getRankedBattleView, getRankedTimelineView } from '../server/rankedBattle.js'
import { normalizePokemon, getMoveById } from '../src/data/trainingData.js'
import { getActivePokemon, getAvailableBattleMechanics } from '../src/data/battleEngine.js'

const tests = []
const test = (name, fn) => tests.push({ name, fn })
const mon = (speciesId, moves = ['protect'], extra = {}) => normalizePokemon({
  speciesId, captureId: `test-${speciesId}`, moves: moves.map((id) => getMoveById(id).name), ...extra,
})
const trio = (ids = [25, 6, 9]) => ids.map((id) => mon(id))
const battle = (playerTeam = trio(), opponentTeam = trio([143, 68, 131]), format = 'single') => createRankedBattle({
  playerTeam, opponentTeam, format, playerName: '첫째', opponentName: '둘째',
})
const act = (state, sideId, moveId = 'protect', actorSlot = 0, extra = {}) => ({
  type: 'move', actorSlot, moveIndex: getActivePokemon(state, sideId, actorSlot).moves.findIndex((move) => move.id === moveId),
  targetSideId: moveId === 'protect' ? sideId : sideId === 'player' ? 'opponent' : 'player',
  targetSlot: moveId === 'protect' ? actorSlot : 0, ...extra,
})
const turn = (state, first, second, random = () => 0.5) => resolveRankedTurn(state, { player: first, opponent: second }, random)

test('registered teams rebuild stats and reject malformed training or unknown moves', () => {
  const registered = [...trio(), ...trio([143, 68, 131])]
  registered[0].stats = { hp: 999999 }
  registered[0].spriteFront = 'https://attacker.invalid/private'
  registered[0].hp = 999999
  const safe = canonicalizeRankedTeam(registered)
  assert.equal(safe[0].stats, undefined)
  assert.equal(safe[0].hp, undefined)
  assert.notEqual(safe[0].spriteFront, registered[0].spriteFront)
  assert.throws(() => canonicalizeRankedTeam(registered.map((p, i) => i ? p : { ...p, trainingPoints: { hp: Infinity } })))
  assert.throws(() => canonicalizeRankedTeam(registered.map((p, i) => i ? p : { ...p, moves: ['made-up-move'] })))
})
test('species and item clauses reject duplicate registrations', () => {
  assert.throws(() => canonicalizeRankedTeam([...trio(), ...trio()]))
  const team = [...trio(), ...trio([143, 68, 131])]
  team[0].heldItemId = team[1].heldItemId = 'leftovers'
  assert.throws(() => canonicalizeRankedTeam(team))
  assert.throws(() => battle(trio().slice(1)))
})
test('both humans retain selected lead order, items and symmetrical gimmicks without AI boosts', () => {
  const state = battle(trio(), [mon(143, ['protect'], { heldItemId: 'leftovers' }), mon(68), mon(131)])
  assert.equal(getActivePokemon(state, 'opponent').speciesId, 143)
  assert.equal(getActivePokemon(state, 'opponent').heldItemId, 'leftovers')
  assert.equal(getActivePokemon(state, 'opponent').difficultyBoostStage, undefined)
  assert.equal(state.rules.pvp, true)
  assert.deepEqual(getAvailableBattleMechanics(state, 'player').map(({ id }) => id), getAvailableBattleMechanics(state, 'opponent').map(({ id }) => id))
})
test('simultaneous opening weather abilities use Speed on either assigned server side', () => {
  const sun = [mon(324, ['protect'], { ability: '가뭄' }), mon(6), mon(9)]
  const rain = [mon(279, ['protect'], { ability: '잔비' }), mon(143), mon(131)]
  const first = battle(sun, rain)
  const reverse = battle(rain, sun)
  assert.equal(first.rules.weather.id, 'sun')
  assert.equal(reverse.rules.weather.id, 'sun')
})
test('actions reject missing doubles slot, duplicates, illegal switches, invalid targets and injected types', () => {
  const state = battle([...trio(), mon(150)], [...trio([143, 68, 131]), mon(94)], 'double')
  assert.throws(() => validateRankedAction(state, 'player', [act(state, 'player')]))
  assert.throws(() => validateRankedAction(state, 'player', [act(state, 'player'), act(state, 'player')]))
  assert.throws(() => validateRankedAction(state, 'player', [{ type: 'switch', actorSlot: 0, targetIndex: 2 }, { type: 'switch', actorSlot: 1, targetIndex: 2 }]))
  assert.throws(() => validateRankedAction(state, 'player', [act(state, 'player', 'protect', 0, { targetSideId: 'opponent' }), act(state, 'player', 'protect', 1)]))
  assert.throws(() => validateRankedAction(state, 'player', [{ type: 'mechanic', actorSlot: 0 }, act(state, 'player', 'protect', 1)]))
  const result = validateRankedAction(state, 'player', [act(state, 'player', 'protect', 0, { power: 999999 }), act(state, 'player', 'protect', 1)])
  assert.equal(result[0].power, undefined)
})
test('opponent Volt Switch pauses for that human and resumes remaining moves on selected replacement', () => {
  const state = battle([mon(143, ['tackle']), mon(68), mon(131)], [mon(25, ['voltswitch']), mon(6), mon(9)])
  state.opponent.team[0].stats.speed = 500
  const first = turn(state, act(state, 'player', 'tackle'), act(state, 'opponent', 'voltswitch'))
  assert.equal(first.state.pendingHumanSwitch.sideId, 'opponent')
  assert.equal(first.state.opponent.activeIndex, 0)
  assert.equal(first.state.player.team[0].moves[0].currentPp, state.player.team[0].moves[0].currentPp)
  assert.throws(() => resolveRankedReplacement(first.state, 'player', 2))
  const second = resolveRankedReplacement(first.state, 'opponent', 2, () => 0.5)
  assert.equal(second.state.opponent.activeIndex, 2)
  assert(second.state.opponent.team[2].hp < second.state.opponent.team[2].maxHp)
  assert.equal(second.state.turn, 2)
  assert.equal(second.state.pendingHumanSwitch, null)
})
test('PP exhaustion, trapping and forced charge commitments are enforced by server state', () => {
  const state = battle([mon(25, ['thunderbolt']), mon(6), mon(9)], trio([143, 68, 131]))
  state.player.team[0].moves[0].currentPp = 0
  assert.throws(() => validateRankedAction(state, 'player', act(state, 'player', 'thunderbolt')))
  state.player.team[0].trappedTurns = 3
  assert.throws(() => validateRankedAction(state, 'player', { type: 'switch', targetIndex: 2 }))
  state.player.team[0].trappedTurns = 0
  state.player.team[0].rechargeTurns = 1
  const forced = validateRankedAction(state, 'player', { type: 'switch', targetIndex: 2 })[0]
  assert.equal(forced.type, 'move')
  assert.equal(forced.forcedReason, 'recharge')
})
test('both pivot users choose sequentially; turn and residual effects execute only once', () => {
  const state = battle([mon(25, ['voltswitch']), mon(6), mon(9)], [mon(235, ['uturn']), mon(143), mon(131)])
  state.player.team[0].stats.speed = 500
  const first = turn(state, act(state, 'player', 'voltswitch'), act(state, 'opponent', 'uturn'))
  assert.equal(first.state.pendingHumanSwitch.sideId, 'player')
  const next = resolveRankedReplacement(first.state, 'player', 1, () => 0.5)
  assert.equal(next.state.pendingHumanSwitch.sideId, 'opponent')
  const last = resolveRankedReplacement(next.state, 'opponent', 2, () => 0.5)
  assert.equal(last.state.turn, 2)
  assert.equal(last.state.pendingTurn, null)
})
test('opponent faint replacement waits until the turn ends and does not auto-select', () => {
  const state = battle([mon(25, ['thunderbolt']), mon(6), mon(9)], [mon(143, ['tackle']), mon(68), mon(131)])
  state.player.team[0].stats.speed = 500
  state.opponent.team[0].hp = 1
  const result = turn(state, act(state, 'player', 'thunderbolt'), act(state, 'opponent', 'tackle'))
  assert.equal(result.state.turn, 2)
  assert.equal(result.state.pendingHumanSwitch.sideId, 'opponent')
  assert.equal(result.state.opponent.activeIndex, 0)
  assert.equal(result.state.player.team[0].hp, result.state.player.team[0].maxHp)
  const resumed = resolveRankedReplacement(result.state, 'opponent', 1)
  assert.equal(resumed.state.turn, 2)
  assert.equal(resumed.state.opponent.activeIndex, 1)
})
test('both doubles slots can switch to different bench members in one human turn', () => {
  const state = battle([...trio(), mon(150)], [...trio([143, 68, 131]), mon(94)], 'double')
  const result = turn(state,
    [{ type: 'switch', actorSlot: 0, targetIndex: 3 }, { type: 'switch', actorSlot: 1, targetIndex: 2 }],
    [act(state, 'opponent'), act(state, 'opponent', 'protect', 1)])
  assert.deepEqual(result.state.player.activeIndexes, [3, 2])
})
test('double knockouts enqueue two human replacements without duplicate bench choices', () => {
  const state = battle([...trio(), mon(150)], [...trio([143, 68, 131]), mon(94)], 'double')
  state.opponent.team[0].hp = state.opponent.team[1].hp = 1
  state.opponent.team[0].status = state.opponent.team[1].status = { id: 'poison', label: '독' }
  const first = turn(state, [act(state, 'player'), act(state, 'player', 'protect', 1)], [act(state, 'opponent'), act(state, 'opponent', 'protect', 1)])
  assert.equal(first.state.pendingHumanSwitch.sideId, 'opponent')
  const next = resolveRankedReplacement(first.state, 'opponent', 3)
  assert.equal(next.state.pendingHumanSwitch.actorSlot, 1)
  assert.throws(() => resolveRankedReplacement(next.state, 'opponent', 3))
  const last = resolveRankedReplacement(next.state, 'opponent', 2)
  assert.deepEqual(last.state.opponent.activeIndexes, [3, 2])
  assert.equal(last.state.pendingHumanSwitch, null)
})
test('replacement killed by hazards asks the same human again', () => {
  const state = battle()
  state.opponent.team[0].hp = 1
  state.opponent.team[0].status = { id: 'poison', label: '독' }
  state.opponent.team[1].hp = 1
  state.opponent.hazards.stealthRock = true
  const first = turn(state, act(state, 'player'), act(state, 'opponent'))
  const next = resolveRankedReplacement(first.state, 'opponent', 1)
  assert.equal(next.state.opponent.team[1].hp, 0)
  assert.equal(next.state.pendingHumanSwitch.sideId, 'opponent')
  assert.equal(next.state.pendingHumanSwitch.actorSlot, 0)
  const last = resolveRankedReplacement(next.state, 'opponent', 2)
  assert.equal(last.state.pendingHumanSwitch, null)
})
test('simultaneous opposing faint replacements conceal the first choice until both have chosen', () => {
  const state = battle()
  for (const sideId of ['player', 'opponent']) {
    state[sideId].team[0].hp = 1
    state[sideId].team[0].status = { id: 'poison', label: '독' }
  }
  const first = turn(state, act(state, 'player'), act(state, 'opponent'))
  assert.equal(first.state.pendingHumanSwitch.sideId, 'player')
  const chosen = resolveRankedReplacement(first.state, 'player', 2)
  assert.equal(chosen.state.player.activeIndex, 0)
  assert.equal(chosen.state.pendingHumanSwitch.sideId, 'opponent')
  const enemyView = getRankedBattleView(chosen.state, 'opponent')
  assert.equal(enemyView.opponent.team[2].speciesId, 0)
  assert.equal(enemyView.humanReplacementBatch, undefined)
  const final = resolveRankedReplacement(chosen.state, 'opponent', 1, () => 0.5)
  assert.equal(final.state.player.activeIndex, 2)
  assert.equal(final.state.opponent.activeIndex, 1)
  assert.equal(final.state.humanReplacementBatch, null)
})
test('Revival Blessing selection is owned by either human and cannot revive living allies', () => {
  const state = battle(trio(), [mon(923, ['revivalblessing']), mon(143), mon(131)])
  state.opponent.team[1].hp = 0
  state.opponent.team[1].fainted = true
  const first = turn(state, act(state, 'player'), act(state, 'opponent', 'revivalblessing', 0, { targetSideId: 'opponent' }))
  assert.equal(first.state.pendingHumanSwitch.kind, 'revival')
  assert.equal(first.state.pendingHumanSwitch.sideId, 'opponent')
  assert.throws(() => resolveRankedReplacement(first.state, 'opponent', 2))
  const next = resolveRankedReplacement(first.state, 'opponent', 1)
  assert.equal(next.state.opponent.team[1].fainted, false)
  assert.equal(next.state.opponent.team[1].hp, Math.floor(next.state.opponent.team[1].maxHp / 2))
})
test('human opponent can activate Tera before a faster enemy move', () => {
  const state = battle([mon(25, ['thunderbolt']), mon(6), mon(9)], [mon(143, ['tackle'], { teraType: '땅' }), mon(68), mon(131)])
  state.player.team[0].stats.speed = 500
  const result = turn(state, act(state, 'player', 'thunderbolt'), act(state, 'opponent', 'tackle', 0, { gimmick: 'tera' }))
  assert.equal(result.state.opponent.team[0].teraActive, true)
  assert.equal(result.state.opponent.team[0].hp, result.state.opponent.team[0].maxHp)
})
for (const attackerSide of ['player', 'opponent']) {
  test('last-Pokemon Explosion user loses on the ' + attackerSide + ' server side', () => {
    const attackerTeam = [mon(235, ['explosion']), mon(6), mon(9)]
    const defenderTeam = [mon(143, ['tackle']), mon(68), mon(131)]
    const state = attackerSide === 'player' ? battle(attackerTeam, defenderTeam) : battle(defenderTeam, attackerTeam)
    for (const sideId of ['player', 'opponent']) {
      state[sideId].team.slice(1).forEach((pokemon) => { pokemon.hp = 0; pokemon.fainted = true })
      state[sideId].team[0].hp = 1
    }
    state[attackerSide].team[0].stats.speed = 500
    const winnerSide = attackerSide === 'player' ? 'opponent' : 'player'
    const result = turn(state, act(state, 'player', attackerSide === 'player' ? 'explosion' : 'tackle'),
      act(state, 'opponent', attackerSide === 'opponent' ? 'explosion' : 'tackle')).state
    assert.equal(result.player.team[0].hp, 0)
    assert.equal(result.opponent.team[0].hp, 0)
    assert.equal(result.winner, winnerSide)
    assert.equal(getRankedBattleView(result, attackerSide).winner, 'opponent')
    assert.equal(getRankedBattleView(result, winnerSide).winner, 'player')
  })
}

test('Leech Seed and Liquid Ooze final residual knockouts remain a draw for both perspectives', () => {
  const state = battle([mon(3, ['protect']), mon(6), mon(9)],
    [mon(73, ['protect'], { ability: '해감액' }), mon(68), mon(131)])
  for (const sideId of ['player', 'opponent']) {
    state[sideId].team.slice(1).forEach((pokemon) => { pokemon.hp = 0; pokemon.fainted = true })
    state[sideId].team[0].hp = 1
  }
  state.opponent.team[0].leechSeedSourceSideId = 'player'
  state.opponent.team[0].leechSeedSourceSlot = 0
  const result = turn(state, act(state, 'player'), act(state, 'opponent')).state
  assert.equal(result.player.team[0].hp, 0)
  assert.equal(result.opponent.team[0].hp, 0)
  assert(result.log.some((entry) => entry.message.includes('씨뿌리기')))
  assert(result.log.some((entry) => entry.message.includes('해감액')))
  assert.equal(result.winner, 'draw')
  assert.equal(getRankedBattleView(result, 'player').winner, 'draw')
  assert.equal(getRankedBattleView(result, 'opponent').winner, 'draw')
})

test('perspectives hide bench selection, moves, abilities, item, Tera type, pending turn and future snapshots', () => {
  const state = battle()
  state.opponent.team[0].heldItemId = 'secret-item'
  state.opponent.team[0].moves[0].id = 'secret-move'
  state.opponent.team[0].ability = 'secret-ability'
  state.opponent.team[0].teraType = '비밀타입'
  state.pendingTurn = { actions: [{ moveId: 'secret-future-command' }] }
  state.player.futureMoveSlots[0] = { turns: 3, sourceSnapshot: structuredClone(state.opponent.team[0]) }
  const view = getRankedBattleView(state, 'player')
  const json = JSON.stringify(view)
  for (const privateValue of ['secret-item', 'secret-move', 'secret-ability', '비밀타입', 'secret-future-command']) assert(!json.includes(privateValue))
  assert.equal(view.opponent.team[1].name, '미공개 포켓몬')
  assert.equal(view.opponent.team[1].speciesId, 0)
  assert.equal(view.opponent.team[0].maxHp, 100)
  assert.deepEqual(view.opponent.team[0].stats, {})
})
test('second human receives mirrored sides, targets, winner and only their own forced switch prompt', () => {
  const state = battle([mon(25, ['voltswitch']), mon(6), mon(9)], trio([143, 68, 131]))
  const second = getRankedBattleView(state, 'opponent')
  assert.equal(second.player.team[0].name, state.opponent.team[0].name)
  assert(second.commandOptions[0].moves.find((move) => move.preview.id === 'protect').targets.some(({ sideId }) => sideId === 'player'))
  state.pendingHumanSwitch = { kind: 'faint', sideId: 'opponent', actorSlot: 0, actorBattleId: state.opponent.team[0].battleId }
  assert.equal(getRankedBattleView(state, 'player').awaitingPlayerSwitch, false)
  assert.equal(getRankedBattleView(state, 'opponent').awaitingPlayerSwitch, true)
  state.winner = 'opponent'
  assert.equal(getRankedBattleView(state, 'opponent').winner, 'player')
})
test('Illusion conceals real species in snapshots and attack cues', () => {
  const state = battle(trio(), [mon(571, ['uturn'], { ability: '일루전' }), mon(143), mon(131)])
  const view = getRankedBattleView(state, 'player')
  assert.equal(view.opponent.team[0].speciesId, 131)
  assert.equal(view.opponent.team[0].originalSpeciesId, 131)
  const timeline = getRankedTimelineView([{ phase: 'announce', sideId: 'opponent', actorSlot: 0, actorSpeciesId: 571, actorOriginalSpeciesId: 571, state }], 'player')
  assert.equal(timeline[0].actorSpeciesId, 131)
  assert.equal(timeline[0].actorOriginalSpeciesId, undefined)
})
test('timeline masks pending second moves, hidden HP and held-item animation hints', () => {
  const state = battle()
  state.pendingTurn = { actions: [{ moveId: 'secret-followup' }] }
  const timeline = getRankedTimelineView([{ phase: 'impact', sideId: 'opponent', actorHeldItemId: 'secret-equipment', damage: 198, state }], 'player')
  assert(!JSON.stringify(timeline).includes('secret-'))
  assert.equal(timeline[0].damage, undefined)
})
test('JSON roundtrip retains suspended turn and seeded resolution is reproducible', () => {
  const state = battle([mon(25, ['voltswitch']), mon(6), mon(9)], [mon(143, ['tackle']), mon(68), mon(131)])
  const first = turn(state, act(state, 'player', 'voltswitch'), act(state, 'opponent', 'tackle'))
  const saved = JSON.parse(JSON.stringify(first.state))
  assert.deepEqual(resolveRankedReplacement(saved, 'player', 2, () => 0.5), resolveRankedReplacement(saved, 'player', 2, () => 0.5))
  console.log(`  Canonical suspended state: ${Buffer.byteLength(JSON.stringify(saved))} bytes`)
})

let failures = 0
for (const { name, fn } of tests) {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failures += 1; console.error(`FAIL ${name}\n${error.stack}`) }
}
console.log(`Ranked battle: ${tests.length - failures}/${tests.length} passed`)
if (failures) process.exitCode = 1
