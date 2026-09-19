import assert from 'node:assert/strict'
import {
  advanceFactoryFloor, beginFactoryBattle, createFactoryRun, FACTORY_TRAINER,
  resolveFactoryBattle, selectFactoryLead, selectFactoryRentals,
} from '../src/data/battleFactory.js'
import { getFactoryDifficulty, scoreFactorySet, scoreFactoryTeam } from '../src/data/battleFactoryDifficulty.js'
import { getLearnableMoves, getSpeciesProfile } from '../src/data/trainingData.js'
import { getBattleItem } from '../src/data/shopData.js'
import { createBattle } from '../src/data/battleEngine.js'

let checks = 0
const check = (name, fn) => {
  fn()
  checks += 1
  console.log(`PASS ${name}`)
}
const average = (values) => values.reduce((total, value) => total + value, 0) / values.length
const modes = ['standard', 'challenge']
const floors = [1, 10, 30, 60, 100]
const sampleSize = 32
const learnsets = new Map()
function readyAt({ seed = 73, floor = 1, mode = 'standard', id = `difficulty-${seed}` } = {}) {
  const selection = createFactoryRun({ seed, mode, id })
  return selectFactoryRentals({ ...selection, floor }, selection.offers.slice(0, 3).map((pokemon) => pokemon.captureId))
}
function assertLegalTeam(team) {
  assert.equal(team.pokemon.length, 3)
  assert.equal(new Set(team.pokemon.map((pokemon) => pokemon.dexSpeciesId)).size, 3)
  assert.equal(new Set(team.pokemon.map((pokemon) => pokemon.captureId)).size, 3)
  for (const pokemon of team.pokemon) {
    const profile = getSpeciesProfile(pokemon.speciesId)
    assert(profile, `Missing species ${pokemon.speciesId}`)
    assert.equal(pokemon.level, 50)
    assert(profile.abilities.includes(pokemon.ability), `${pokemon.name}: illegal ability`)
    assert(pokemon.moves.length >= 1 && pokemon.moves.length <= 4)
    assert.equal(new Set(pokemon.moves).size, pokemon.moves.length)
    if (!learnsets.has(profile.id)) learnsets.set(profile.id, new Set(getLearnableMoves(profile.id).map((move) => move.name)))
    assert(pokemon.moves.every((move) => learnsets.get(profile.id).has(move)), `${pokemon.name}: illegal moves`)
    assert(!pokemon.heldItemId || getBattleItem(pokemon.heldItemId), `${pokemon.name}: unknown held item`)
    assert(Number.isFinite(scoreFactorySet(pokemon, pokemon.factoryGimmicks)))
    assert.equal(pokemon.rental, true)
  }
}

check('difficulty normalizes malformed floors and ramps selectivity in both modes', () => {
  for (const value of [undefined, null, NaN, Infinity, -Infinity, 0, -23, 'invalid']) {
    assert.equal(getFactoryDifficulty(value, 'standard').floor, 1, `Invalid floor ${String(value)}`)
  }
  assert.equal(getFactoryDifficulty(12.9, 'standard').floor, 12)
  assert.equal(getFactoryDifficulty('30', 'challenge').floor, 30)
  assert.equal(getFactoryDifficulty(1e9, 'challenge').floor, 10000)
  assert.equal(getFactoryDifficulty(10, 'unknown').mode, 'standard')
  for (const mode of modes) {
    let previous = null
    for (const floor of floors) {
      const profile = getFactoryDifficulty(floor, mode)
      assert.equal(profile.floor, floor)
      assert.equal(profile.mode, mode)
      assert(profile.minPercentile >= 0 && profile.minPercentile < 1)
      assert(Number.isInteger(profile.teamCandidates) && profile.teamCandidates > 1)
      assert(Number.isInteger(profile.setCandidates) && profile.setCandidates >= 1)
      assert(profile.label)
      if (previous) {
        assert(profile.minPercentile >= previous.minPercentile)
        assert(profile.teamCandidates >= previous.teamCandidates)
      }
      previous = profile
    }
    assert(getFactoryDifficulty(100, mode).minPercentile > getFactoryDifficulty(1, mode).minPercentile)
  }
  for (const floor of floors) {
    assert(getFactoryDifficulty(floor, 'challenge').minPercentile >= getFactoryDifficulty(floor, 'standard').minPercentile)
  }
})

check('same seed, floor and mode reproduce the whole team while initial six offers stay mode-independent', () => {
  const standard = createFactoryRun({ seed: 982, mode: 'standard', id: 'same-start' })
  const challenge = createFactoryRun({ seed: 982, mode: 'challenge', id: 'same-start' })
  assert.deepEqual(standard.offers, challenge.offers)
  assert.equal(standard.offers.length, 6)
  for (const mode of modes) {
    for (const floor of [1, 30, 100]) {
      const first = readyAt({ seed: 982, floor, mode })
      const second = readyAt({ seed: 982, floor, mode })
      assert.deepEqual(first.opponentTeam, second.opponentTeam)
      assert.notDeepEqual(first.opponentTeam.pokemon, readyAt({ seed: 983, floor, mode }).opponentTeam.pokemon)
      assertLegalTeam(first.opponentTeam)
    }
  }
})

const distributions = new Map()
check('persistent rain discourages fire partners but primal weather does not', () => {
  const setter = { speciesId: 382, ability: '잔비', moves: ['파도타기'], trainingPoints: {} }
  const fire = { speciesId: 643, ability: '터보블레이즈', moves: ['푸른불꽃'], trainingPoints: {} }
  const neutral = scoreFactoryTeam([{ ...setter, ability: '프레셔' }, fire])
  assert(scoreFactoryTeam([setter, fire]) < neutral)
  assert.equal(scoreFactoryTeam([{ ...setter, ability: '시작의바다' }, fire]), neutral)
})
check('actual generated opponent strength rises across low, middle and high floors in both modes', () => {
  for (const mode of modes) {
    const rows = []
    for (const floor of floors) {
      const teams = Array.from({ length: sampleSize }, (_, seed) => readyAt({ seed: `difficulty-sample-${seed}`, floor, mode }).opponentTeam)
      teams.forEach(assertLegalTeam)
      const entries = teams.flatMap((team) => team.pokemon)
      const row = {
        floor,
        team: average(teams.map((team) => scoreFactoryTeam(team.pokemon))),
        set: average(entries.map((pokemon) => scoreFactorySet(pokemon, pokemon.factoryGimmicks))),
        bst: average(entries.map((pokemon) => getSpeciesProfile(pokemon.speciesId).stats.reduce((sum, stat) => sum + stat, 0))),
        unique: new Set(entries.map((pokemon) => pokemon.dexSpeciesId)).size,
      }
      assert(row.unique >= 9, `${mode} floor ${floor}: random team diversity collapsed to ${row.unique} species`)
      rows.push(row)
    }
    // Statistical cohorts must improve, rather than requiring every individual
    // random matchup to be harder or relying only on the configured percentile.
    for (let index = 1; index < rows.length; index += 1) {
      const previous = rows[index - 1]
      const current = rows[index]
      const ramping = getFactoryDifficulty(current.floor, mode).minPercentile > getFactoryDifficulty(previous.floor, mode).minPercentile
      if (ramping) {
        assert(current.team > previous.team, `${mode} team quality declined from floor ${previous.floor} (${previous.team}) to ${current.floor} (${current.team})`)
        assert(current.set > previous.set, `${mode} individual set strength did not improve by floor ${current.floor}`)
      } else {
        assert(current.team >= previous.team * 0.97, `${mode}: high-floor team quality regressed after reaching the cap`)
        assert(current.set >= previous.set * 0.97, `${mode}: high-floor loadouts regressed after reaching the cap`)
      }
    }
    assert(rows.at(-1).bst > rows[0].bst + 20, `${mode}: high floors should also contain stronger species by independent base stats`)
    distributions.set(mode, rows)
    console.log(`  ${mode}: ${rows.map((row) => `F${row.floor} team=${row.team.toFixed(1)} set=${row.set.toFixed(1)} BST=${row.bst.toFixed(1)} species=${row.unique}`).join(' / ')}`)
  }
})

check('challenge mode produces stronger early and middle opponents than standard mode', () => {
  for (const floor of [1, 10, 30]) {
    const standard = distributions.get('standard').find((row) => row.floor === floor)
    const challenge = distributions.get('challenge').find((row) => row.floor === floor)
    assert(challenge.team > standard.team, `Floor ${floor}: challenge team quality must exceed standard`)
    assert(challenge.set > standard.set, `Floor ${floor}: challenge loadouts must exceed standard`)
  }
})

check('floor progression uses the new generation without changing party health, TP or level-50 stats', () => {
  assert.equal(FACTORY_TRAINER.tier, 'S')
  for (const mode of modes) {
    const ready = readyAt({ seed: 991, floor: 59, mode })
    const battle = beginFactoryBattle(selectFactoryLead(ready, ready.party[0].captureId))
    assert.equal(battle.rules.aiDecisionLevel, 'hard')
    assert.equal(battle.rules.aiDifficulty.id, 'normal')
    const engine = createBattle({ playerPokemon: battle.party, opponent: FACTORY_TRAINER, opponentTeam: battle.opponentTeam, rules: battle.rules, random: () => 0.5 })
    assert.equal(engine.rules.aiDecisionLevel, 'hard')
    assert.equal(engine.rules.aiDifficulty.id, 'normal')
    const won = resolveFactoryBattle(battle, {
      battleId: battle.battleId, winner: 'player',
      playerTeamHp: battle.party.map((pokemon) => ({ captureId: pokemon.captureId, hp: 45, maxHp: 100 })),
    })
    const next = advanceFactoryFloor(won)
    assert.equal(next.floor, 60)
    assert.deepEqual(next.party, won.party)
    assert.equal(next.towerPoints, won.towerPoints)
    if (mode === 'challenge') assert(next.party.every((pokemon) => pokemon.startHpRatio === 0.45))
    assert.deepEqual(next.opponentTeam, readyAt({ seed: 991, floor: 60, mode }).opponentTeam)
    assertLegalTeam(next.opponentTeam)
    assert.equal(next.rules.aiDecisionLevel, 'hard')
  }
})

check('saved standby runs gain hard tactical rules while an active checkpoint remains unchanged', () => {
  const ready = readyAt({ seed: 804, floor: 91, mode: 'challenge' })
  const legacyRules = { ...ready.rules }
  delete legacyRules.aiDecisionLevel
  const legacy = { ...ready, rules: legacyRules }
  const started = beginFactoryBattle(selectFactoryLead(legacy, legacy.party[0].captureId))
  assert.equal(started.rules.aiDecisionLevel, 'hard')
  assert.deepEqual(started.party, legacy.party)
  assert.deepEqual(started.opponentTeam, legacy.opponentTeam)

  const existingBattle = {
    ...started, rules: legacyRules,
    battleState: { turn: 12, player: { hp: 17 }, opponent: { hp: 38 } },
  }
  assert.equal(beginFactoryBattle(existingBattle), existingBattle)
  assert.equal(existingBattle.rules.aiDecisionLevel, undefined)
  assert.deepEqual(existingBattle.battleState, { turn: 12, player: { hp: 17 }, opponent: { hp: 38 } })
})

console.log(`Factory difficulty validation passed: ${checks} checks; ${sampleSize * floors.length * modes.length} sampled opponent teams.`)
