import assert from 'node:assert/strict'
import {
  createBattle,
  chooseAiAction,
  forcePlayerSwitch,
  getActivePokemonList,
  getBattleMovePreview,
  getBattleMoveTargets,
  getEffectiveBattleStat,
  playBattleTurnWithActions,
  STATUS_LABELS,
} from '../src/data/battleEngine.js'
import {
  MOVE_CATALOG,
  SPECIES_PROFILES,
  getLearnableMoves,
  getMoveById,
  isSavablePokemonForm,
} from '../src/data/trainingData.js'

// A deterministic state-integrity sweep, separate from semantic rule assertions.
// Every catalog move is exercised in singles, doubles, and altered field/status
// conditions. Seven runtime-only/unlearnable moves use an explicit injected slot;
// that tests their engine path, not their availability in team building.
const learnerByMove = new Map()
const holderByAbility = new Map()
for (const profile of Object.values(SPECIES_PROFILES)) {
  for (const ability of profile.abilities) if (!holderByAbility.has(ability)) holderByAbility.set(ability, profile.id)
}
for (const profile of Object.values(SPECIES_PROFILES).filter(isSavablePokemonForm)) {
  for (const move of getLearnableMoves(profile.id)) {
    if (!learnerByMove.has(move.id)) learnerByMove.set(move.id, profile.id)
  }
}
const scenarios = [
  { name: 'single-clear', slots: 1, weather: 'clear', terrain: 'neutral', turns: 6, seed: 11 },
  { name: 'double-sand', slots: 2, weather: 'sand', terrain: 'grassy', turns: 4, seed: 79 },
  { name: 'single-rain-status', slots: 1, weather: 'rain', terrain: 'neutral', turns: 4, seed: 203 },
]
const templates = new Map()
const runtimeOnly = new Set()
let cases = 0
let turns = 0
let abilityCases = 0
const failures = []

function randomGenerator(seed) {
  let value = seed >>> 0
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0
    return value / 4294967296
  }
}

function fixture(speciesId, captureId, moveIds, heldItemId = '') {
  return { speciesId, captureId, heldItemId, moves: moveIds.map((id) => getMoveById(id).name) }
}

function initialState(move, scenario) {
  const speciesId = learnerByMove.get(move.id) ?? 235
  if (!learnerByMove.has(move.id)) runtimeOnly.add(move.id)
  const key = `${speciesId}/${scenario.name}`
  if (!templates.has(key)) {
    const state = createBattle({
      playerPokemon: [fixture(speciesId, 'sweep-player', ['protect']), fixture(235, 'sweep-ally', ['agility']), fixture(143, 'sweep-bench', ['tackle'])],
      opponent: { name: 'STATE SWEEP', tier: 'S' },
      opponentTeam: {
        pokemon: [fixture(143, 'sweep-target', ['tackle']), fixture(235, 'sweep-target2', ['growl']), fixture(242, 'sweep-target3', ['tackle'])],
        battleGimmicks: [],
        strategy: { lead: '잠만보' },
      },
      rules: {
        weather: { id: scenario.weather, label: scenario.weather },
        terrain: { id: scenario.terrain, label: scenario.terrain },
        format: { id: scenario.slots === 1 ? 'single' : 'double', label: scenario.name, activeSlots: scenario.slots, actionSlots: scenario.slots },
        teamRule: { id: 'full', label: '3대3', battleSize: 3 },
        disabledGimmickId: null,
        gimmickRestriction: { id: null, label: '제한 없음' },
      },
    })
    for (const pokemon of [...state.player.team, ...state.opponent.team]) {
      pokemon.originalMaxHp = pokemon.maxHp = pokemon.stats.hp = 4096
      pokemon.hp = 3072
      // Control incidental entry/passive effects while semantic ability suites
      // verify their exact behavior independently.
      pokemon.ability = ''
    }
    templates.set(key, state)
  }
  const state = structuredClone(templates.get(key))
  const actor = state.player.team[0]
  actor.moves = [{ ...move, maxPp: Math.max(1, move.pp), currentPp: Math.max(1, move.pp) }]
  if (scenario.name === 'single-rain-status') {
    actor.status = { id: 'burn', label: '화상', counter: 0, toxicCounter: 0 }
    state.opponent.team[0].status = { id: 'toxic', label: '맹독', counter: 0, toxicCounter: 1 }
    actor.statStages.attack = -2
    actor.statStages.specialAttack = 2
    state.opponent.team[0].statStages.defense = 2
  }
  return state
}

function assertState(state, label) {
  assert(Number.isInteger(state.turn) && state.turn >= 1, `${label}: invalid turn`)
  for (const sideId of ['player', 'opponent']) {
    const side = state[sideId]
    assert.equal(new Set(side.activeIndexes).size, side.activeIndexes.length, `${label}: duplicate active slots`)
    for (const pokemon of side.team) {
      const detail = `${label}/${sideId}/${pokemon.name}`
      assert(Number.isInteger(pokemon.hp) && pokemon.hp >= 0 && pokemon.hp <= pokemon.maxHp, `${detail}: HP ${pokemon.hp}/${pokemon.maxHp}`)
      assert(Number.isInteger(pokemon.maxHp) && pokemon.maxHp > 0, `${detail}: invalid maxHP`)
      assert(!pokemon.fainted || pokemon.hp === 0, `${detail}: fainted Pokemon has HP`)
      assert(!pokemon.status || STATUS_LABELS[pokemon.status.id], `${detail}: invalid status ${pokemon.status?.id}`)
      for (const [stat, value] of Object.entries(pokemon.statStages)) {
        assert(Number.isInteger(value) && value >= -6 && value <= 6, `${detail}: invalid ${stat} stage ${value}`)
      }
      for (const stat of ['attack', 'defense', 'specialAttack', 'specialDefense', 'speed']) {
        const value = getEffectiveBattleStat(state, pokemon, stat)
        assert(Number.isFinite(value) && value > 0, `${detail}: invalid ${stat} ${value}`)
      }
      for (const move of pokemon.moves) {
        assert(Number.isInteger(move.currentPp) && move.currentPp >= 0 && move.currentPp <= move.maxPp,
          `${detail}: ${move.id} PP ${move.currentPp}/${move.maxPp}`)
      }
    }
  }
}

function actions(state, sideId) {
  return getActivePokemonList(state, sideId).flatMap((pokemon, actorSlot) => {
    if (!pokemon || pokemon.fainted || pokemon.hp <= 0) return []
    const move = pokemon.moves[0]
    const options = getBattleMoveTargets(state, sideId, 0, actorSlot)
    const supportsAlly = ['healpulse', 'floralhealing', 'pollenpuff', 'purify'].includes(move?.id)
    const target = (supportsAlly ? options.find((option) => option.sideId === sideId) : null) ?? options[0]
    return [{ type: 'move', actorSlot, targetSlot: target?.slot ?? 0,
      ...(target ? { targetSideId: target.sideId } : {}), moveIndex: 0, gimmick: null }]
  })
}

for (const move of MOVE_CATALOG) {
  for (const scenario of scenarios) {
    const label = `${move.id}/${scenario.name}`
    try {
      let state = initialState(move, scenario)
      const random = randomGenerator(scenario.seed + move.number)
      getBattleMovePreview(state, 'player', 0, 0)
      for (let turn = 0; turn < scenario.turns && !state.winner; turn += 1) {
        while (state.awaitingPlayerSwitch && !state.winner) {
          const bench = state.player.team.findIndex((pokemon, index) => !pokemon.fainted && pokemon.hp > 0 && !state.player.activeIndexes.includes(index))
          assert(bench >= 0, `${label}: switch requested without a replacement`)
          const replacementState = forcePlayerSwitch(state, bench)
          assert.notEqual(replacementState, state, `${label}: replacement deadlock`)
          state = replacementState
        }
        const playerActions = actions(state, 'player')
        const opponentActions = actions(state, 'opponent')
        const before = turn === 0 ? JSON.stringify(state) : null
        const next = playBattleTurnWithActions(state, playerActions, opponentActions, random)
        if (before && JSON.stringify(state) !== before) {
          const initial = JSON.parse(before)
          const changed = []
          const compare = (a, b, path = '') => {
            if (JSON.stringify(a) === JSON.stringify(b)) return
            if (a && b && typeof a === 'object' && typeof b === 'object') {
              for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) compare(a[key], b[key], `${path}.${key}`)
            } else if (changed.length < 6) changed.push(`${path}: ${a} -> ${b}`)
          }
          compare(initial, state)
          throw new Error(`input state mutated: ${changed.join('; ')}`)
        }
        assertState(next, `${label}/turn${turn + 1}`)
        turns += 1
        state = next
      }
      cases += 1
    } catch (error) {
      failures.push(`${label}: ${error.message}`)
    }
  }
}
for (const [ability, speciesId] of holderByAbility) {
  for (const scenario of [scenarios[0], scenarios[1]]) {
    const label = `${ability}/${scenario.name}`
    try {
      const move = getLearnableMoves(speciesId).find((entry) => entry.category !== '변화') ?? getMoveById('tackle')
      let state = initialState(move, scenario)
      // Use the real holder's typing/stats for species-dependent abilities.
      const holderState = createBattle({
        playerPokemon: [fixture(speciesId, 'sweep-ability-holder', [move.id])],
        opponent: { name: 'ABILITY STATE SWEEP', tier: 'S' },
        opponentTeam: { pokemon: [fixture(143, 'sweep-ability-target', ['tackle'])], battleGimmicks: [] },
      })
      const holder = holderState.player.team[0]
      holder.ability = ability
      holder.originalAbility = ability
      holder.originalMaxHp = holder.maxHp = holder.stats.hp = 4096
      holder.hp = 3072
      state.player.team[0] = holder
      const random = randomGenerator(scenario.seed + speciesId)
      for (let turn = 0; turn < 4 && !state.winner && !state.awaitingPlayerSwitch; turn += 1) {
        state = playBattleTurnWithActions(state, actions(state, 'player'), actions(state, 'opponent'), random)
        assertState(state, `${label}/turn${turn + 1}`)
        turns += 1
      }
      abilityCases += 1
    } catch (error) {
      failures.push(`${label}: ${error.message}`)
    }
  }
}

// Predictive simulations must never mark moves as used in the live battle.
const predictionState = initialState(getMoveById('tackle'), scenarios[0])
const beforePrediction = JSON.stringify(predictionState)
chooseAiAction(predictionState, () => 0.5)
assert(JSON.stringify(predictionState) === beforePrediction, 'AI prediction mutated live battle state')
assert(failures.length === 0, `${failures.length} state sweep failures:\n${failures.slice(0, 30).join('\n')}`)
console.log(`Validated ${MOVE_CATALOG.length} moves (${cases} scenarios) and ${holderByAbility.size} available abilities (${abilityCases} scenarios), ${turns} turns: HP, PP, stat stages, finite stats, replacement, and input immutability.`)
console.log(`Runtime-only injected fixtures (${runtimeOnly.size}): ${[...runtimeOnly].join(', ')}`)
