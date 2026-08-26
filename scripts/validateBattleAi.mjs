import assert from 'node:assert/strict'
import {
  chooseAiAction,
  chooseAiActionsForSide,
  chooseAiReplacementIndex,
  createBattle,
  createBattleTurnTimeline,
  getActivePokemon,
  playBattleTurnWithActions,
} from '../src/data/battleEngine.js'
import {
  selectCounterBattlePokemon,
  selectCounterTeamNumber,
} from '../src/data/aiTeamSelection.js'
import { getMoveById } from '../src/data/trainingData.js'

function runtimeMove(moveId) {
  const move = getMoveById(moveId)
  return { ...move, maxPp: move.pp, currentPp: move.pp }
}

function battleRules(activeSlots = 1, aiDifficulty = 'normal') {
  return {
    weather: { id: 'clear', label: '맑음' },
    terrain: { id: 'neutral', label: '일반 필드' },
    format: {
      id: activeSlots === 1 ? 'single' : 'double',
      label: activeSlots === 1 ? '싱글배틀' : '더블배틀',
      activeSlots,
      actionSlots: activeSlots,
    },
    teamRule: { id: 'full', label: '6대6', battleSize: 6 },
    disabledGimmickId: null,
    aiDifficulty,
    gimmickRestriction: { id: null, label: '제한 없음' },
  }
}

function makeBattle({
  playerCount = 1,
  opponentCount = 1,
  activeSlots = 1,
  opponentEntry = {},
  aiDifficulty = 'normal',
} = {}) {
  const state = createBattle({
    playerPokemon: Array.from({ length: playerCount }, (_, index) => ({
      speciesId: [9, 450, 3][index] ?? 9,
      captureId: `player-${index}`,
    })),
    opponent: { name: '검증 AI', tier: 'S' },
    opponentTeam: {
      pokemon: Array.from({ length: opponentCount }, (_, index) => ({
        speciesId: [25, 6, 149][index] ?? 25,
        captureId: `ai-${index}`,
        ...opponentEntry,
      })),
      battleGimmicks: [],
      strategy: {},
    },
    rules: battleRules(activeSlots, aiDifficulty),
  })
  state.opponent.activeIndexes = Array.from({ length: activeSlots }, (_, index) => index)
  state.opponent.activeIndex = state.opponent.activeIndexes[0] ?? 0
  return state
}

function playerMoveDamage(moveId, configure = () => {}) {
  const state = makeBattle()
  state.player.team[0].moves = [runtimeMove(moveId)]
  state.opponent.team[0].moves = [runtimeMove('splash')]
  state.opponent.team[0].stats.hp = 1000
  state.opponent.team[0].maxHp = 1000
  state.opponent.team[0].originalMaxHp = 1000
  state.opponent.team[0].hp = 1000
  configure(state)
  const initialHp = state.opponent.team[0].hp
  const nextState = playBattleTurnWithActions(
    state,
    [{ type: 'move', actorSlot: 0, targetSlot: 0, moveIndex: 0, gimmick: null }],
    [{ type: 'move', actorSlot: 0, targetSlot: 0, moveIndex: 0, gimmick: null }],
    () => 0.5,
  )
  return initialHp - nextState.opponent.team[0].hp
}

{
  const state = makeBattle()
  state.opponent.team[0].moves = [runtimeMove('thunderbolt'), runtimeMove('tackle')]
  state.player.team[0].types = ['물']
  const action = chooseAiAction(state, () => 0)
  assert.equal(state.opponent.team[0].moves[action.moveIndex].id, 'thunderbolt')
}

{
  const state = makeBattle({ playerCount: 2, opponentCount: 2, activeSlots: 2 })
  state.opponent.team[0].moves = [runtimeMove('thunderbolt')]
  state.player.team[0].types = ['땅']
  state.player.team[1].types = ['물']
  const action = chooseAiAction(state, () => 0, 0, 0)
  assert.equal(action.targetSlot, 1)
}

{
  const state = makeBattle()
  state.opponent.team[0].moves = [runtimeMove('recover'), runtimeMove('tackle')]
  const action = chooseAiAction(state, () => 0)
  assert.equal(state.opponent.team[0].moves[action.moveIndex].id, 'tackle')
}

{
  const state = makeBattle()
  state.opponent.team[0].moves = [runtimeMove('rest'), runtimeMove('bodyslam')]
  state.opponent.team[0].status = { id: 'sleep', label: '잠듦', counter: 1, toxicCounter: 0 }
  state.opponent.team[0].hp = Math.floor(state.opponent.team[0].maxHp * 0.45)
  const action = chooseAiAction(state, () => 0)
  assert.equal(state.opponent.team[0].moves[action.moveIndex].id, 'bodyslam')
}

{
  const state = makeBattle({ opponentCount: 2 })
  state.opponent.team[0].moves = [runtimeMove('thunderbolt')]
  state.opponent.team[0].types = ['전기']
  state.player.team[0].moves = [runtimeMove('earthquake')]
  state.player.team[0].types = ['땅']
  state.opponent.team[1].moves = [runtimeMove('icebeam')]
  state.opponent.team[1].types = ['비행']
  const action = chooseAiAction(state, () => 0)
  assert.equal(action.type, 'switch')
  assert.equal(action.targetIndex, 1)
}

{
  const state = makeBattle({ opponentCount: 3 })
  state.opponent.team[0].moves = [runtimeMove('thunderbolt')]
  state.opponent.team[0].types = ['전기']
  state.opponent.team[0].hp = 1
  state.opponent.team[1].moves = [runtimeMove('icebeam')]
  state.opponent.team[1].types = ['노말']
  state.opponent.team[1].hp = Math.ceil(state.opponent.team[1].maxHp * 0.3)
  state.opponent.team[2].moves = [runtimeMove('tackle')]
  state.opponent.team[2].types = ['비행']
  state.player.team[0].moves = [runtimeMove('earthquake')]
  state.player.team[0].types = ['땅']
  state.player.team[0].stats.attack = 300
  const action = chooseAiAction(state, () => 0)
  assert.equal(action.type, 'switch')
  assert.equal(action.targetIndex, 2)
}

{
  const state = makeBattle({ opponentCount: 2 })
  state.opponent.team[0].moves = [runtimeMove('icebeam')]
  state.opponent.team[0].stats.speed = 220
  state.opponent.team[0].hp = 1
  state.opponent.team[1].types = ['비행']
  state.opponent.team[1].moves = [runtimeMove('tackle')]
  state.player.team[0].types = ['땅']
  state.player.team[0].moves = [runtimeMove('earthquake')]
  state.player.team[0].stats.speed = 80
  state.player.team[0].hp = 1
  const action = chooseAiAction(state, () => 0)
  assert.equal(action.type, 'move')
  assert.equal(state.opponent.team[0].moves[action.moveIndex].id, 'icebeam')
}

{
  const state = makeBattle({ opponentCount: 2 })
  state.opponent.team[0].types = ['불꽃']
  state.opponent.team[0].moves = [runtimeMove('flamethrower')]
  state.opponent.team[0].hp = 1
  state.opponent.team[1].types = ['불꽃']
  state.opponent.team[1].moves = [runtimeMove('tackle')]
  state.opponent.team[1].hp = 1
  state.player.team[0].types = ['물']
  state.player.team[0].moves = [runtimeMove('surf')]
  state.player.team[0].stats.speed = 220
  const action = chooseAiAction(state, () => 0)
  assert.equal(action.type, 'move')
}

{
  const trainer = {
    teams: [
      { number: 1, pokemon: [{ speciesId: 3, moveIds: ['gigadrain'], moves: ['기가드레인'] }] },
      { number: 2, pokemon: [{ speciesId: 445, moveIds: ['earthquake'], moves: ['지진'] }] },
      { number: 3, pokemon: [{ speciesId: 25, moveIds: ['thunderbolt'], moves: ['10만볼트'] }] },
    ],
  }
  const playerTeam = [{ speciesId: 485, moveIds: ['magmastorm'], moves: ['마그마스톰'] }]
  assert.equal(selectCounterTeamNumber(trainer, playerTeam, () => 0), 2)
}

{
  const roster = [
    { speciesId: 3, moveIds: ['gigadrain'], moves: ['기가드레인'] },
    { speciesId: 6, moveIds: ['flamethrower'], moves: ['화염방사'] },
    { speciesId: 445, moveIds: ['earthquake'], moves: ['지진'] },
    { speciesId: 25, moveIds: ['thunderbolt'], moves: ['10만볼트'] },
    { speciesId: 9, moveIds: ['surf'], moves: ['파도타기'] },
    { speciesId: 143, moveIds: ['bodyslam'], moves: ['누르기'] },
  ]
  const playerTeam = [{ speciesId: 485, moveIds: ['magmastorm'], moves: ['마그마스톰'] }]
  const selection = selectCounterBattlePokemon(roster, playerTeam, {
    teamRule: { id: 'pick3', battleSize: 3 },
  })
  assert.equal(selection.length, 3)
  assert.ok(selection.some((pokemon) => pokemon.speciesId === 445))
}

{
  const state = makeBattle({
    opponentEntry: {
      battleMechanics: ['z-move'],
      heldItemId: 'electrium-z--held',
    },
  })
  state.opponent.team[0].moves = [runtimeMove('thunderbolt'), runtimeMove('tackle')]
  state.player.team[0].types = ['물']
  state.player.team[0].hp = Math.ceil(state.player.team[0].maxHp * 0.7)
  const action = chooseAiAction(state, () => 0)
  assert.equal(action.gimmick, 'zmove')
}

{
  const state = makeBattle({
    playerCount: 2,
    opponentCount: 2,
    activeSlots: 2,
    opponentEntry: {
      battleMechanics: ['z-move'],
      heldItemId: 'electrium-z--held',
    },
  })
  state.player.team.forEach((pokemon) => {
    pokemon.types = ['물']
    pokemon.moves = [runtimeMove('tackle')]
  })
  state.opponent.team.forEach((pokemon) => {
    pokemon.moves = [runtimeMove('thunderbolt')]
  })
  const { timeline } = createBattleTurnTimeline(state, [
    { type: 'move', actorSlot: 0, targetSlot: 0, moveIndex: 0, gimmick: null },
    { type: 'move', actorSlot: 1, targetSlot: 1, moveIndex: 0, gimmick: null },
  ], () => 0.5)
  const opponentZMoves = timeline.filter((step) => (
    step.phase === 'gimmick' && step.sideId === 'opponent' && step.mechanicId === 'zmove'
  ))
  assert.equal(opponentZMoves.length, 1)
}

{
  const state = makeBattle({ playerCount: 2 })
  state.opponent.team[0].types = ['전기']
  state.opponent.team[0].moves = [runtimeMove('thunderbolt'), runtimeMove('icebeam')]
  state.player.team[0].types = ['물']
  state.player.team[0].moves = [runtimeMove('splash')]
  state.player.team[0].hp = Math.ceil(state.player.team[0].maxHp * 0.22)
  state.player.team[1].types = ['땅']
  state.player.team[1].moves = [runtimeMove('earthquake')]
  const action = chooseAiAction(state, () => 0)
  assert.equal(state.opponent.team[0].moves[action.moveIndex].id, 'icebeam')
}

{
  const state = makeBattle()
  state.opponent.team[0].moves = [runtimeMove('tackle'), runtimeMove('swordsdance')]
  state.player.team[0].moves = [runtimeMove('protect')]
  const action = chooseAiAction(state, () => 0)
  assert.equal(state.opponent.team[0].moves[action.moveIndex].id, 'swordsdance')
}

{
  const state = makeBattle({ opponentCount: 2 })
  state.opponent.team.forEach((pokemon) => { pokemon.types = ['불꽃'] })
  state.opponent.team[0].moves = [runtimeMove('sunnyday'), runtimeMove('tackle')]
  state.player.team[0].types = ['물']
  state.player.team[0].moves = [runtimeMove('surf')]
  Object.keys(state.player.usedMechanics).forEach((mechanicId) => {
    state.player.usedMechanics[mechanicId] = true
  })
  state.opponent.team[0].stats.speed = state.player.team[0].stats.speed + 40
  const action = chooseAiAction(state, () => 0)
  assert.equal(state.opponent.team[0].moves[action.moveIndex].id, 'sunnyday')
}

{
  const state = makeBattle()
  state.opponent.team[0].moves = [runtimeMove('quickattack'), runtimeMove('tackle')]
  state.opponent.team[0].hp = Math.ceil(state.opponent.team[0].maxHp * 0.15)
  state.opponent.team[0].stats.speed = 40
  state.player.team[0].moves = [runtimeMove('earthquake')]
  state.player.team[0].hp = Math.ceil(state.player.team[0].maxHp * 0.08)
  state.player.team[0].stats.speed = 200
  const action = chooseAiAction(state, () => 0)
  assert.equal(state.opponent.team[0].moves[action.moveIndex].id, 'quickattack')
}

{
  const state = makeBattle()
  state.opponent.team[0].moves = [runtimeMove('thunderbolt'), runtimeMove('tackle')]
  state.opponent.team[0].tormented = true
  state.opponent.team[0].lastMoveIndex = 0
  state.player.team[0].types = ['물']
  const action = chooseAiAction(state, () => 0)
  assert.equal(state.opponent.team[0].moves[action.moveIndex].id, 'tackle')
}

{
  const state = makeBattle()
  state.opponent.team[0].moves = [runtimeMove('thunder'), runtimeMove('thunderbolt')]
  state.player.team[0].types = ['물']
  const action = chooseAiAction(state, () => 0)
  assert.equal(state.opponent.team[0].moves[action.moveIndex].id, 'thunderbolt')
}

{
  const state = makeBattle({ opponentCount: 2 })
  state.opponent.team[0].moves = [runtimeMove('revivalblessing'), runtimeMove('tackle')]
  state.opponent.team[1].hp = 0
  state.opponent.team[1].fainted = true
  state.player.team[0].moves = [runtimeMove('splash')]
  const action = chooseAiAction(state, () => 0)
  assert.equal(state.opponent.team[0].moves[action.moveIndex].id, 'revivalblessing')
  const nextState = playBattleTurnWithActions(
    state,
    [{ type: 'move', actorSlot: 0, targetSlot: 0, moveIndex: 0, gimmick: null }],
    [action],
    () => 0.5,
  )
  assert.equal(nextState.opponent.team[1].fainted, false)
  assert.equal(nextState.opponent.team[1].hp, Math.floor(nextState.opponent.team[1].maxHp / 2))
  assert.equal(nextState.opponent.activeIndexes[0], 0)
}

{
  const state = makeBattle()
  state.player.team[0].moves = [runtimeMove('tackle'), runtimeMove('scratch')]
  state.player.team[0].lastMoveIndex = 1
  state.opponent.team[0].moves = [runtimeMove('splash')]
  const [action] = chooseAiActionsForSide(state, 'player', () => 0)
  assert.equal(state.player.team[0].moves[action.moveIndex].id, 'tackle')
}

{
  const standardDamage = playerMoveDamage('bodypress')
  const boostedDamage = playerMoveDamage('bodypress', (state) => {
    state.player.team[0].statStages.defense = 2
  })
  assert.ok(boostedDamage >= standardDamage * 1.8)
}

{
  const standardDamage = playerMoveDamage('foulplay')
  const boostedDamage = playerMoveDamage('foulplay', (state) => {
    state.opponent.team[0].statStages.attack = 2
  })
  assert.ok(boostedDamage >= standardDamage * 1.8)
}

{
  const lowDefenseDamage = playerMoveDamage('psyshock', (state) => {
    state.opponent.team[0].stats.defense = 60
    state.opponent.team[0].stats.specialDefense = 240
  })
  const highDefenseDamage = playerMoveDamage('psyshock', (state) => {
    state.opponent.team[0].stats.defense = 240
    state.opponent.team[0].stats.specialDefense = 60
  })
  assert.ok(lowDefenseDamage >= highDefenseDamage * 2)
}

{
  const state = makeBattle()
  state.player.team[0].moves = [runtimeMove('rest')]
  state.player.team[0].heldItemId = 'chesto-berry'
  state.player.team[0].heldItemName = '유루열매'
  state.player.team[0].hp = Math.floor(state.player.team[0].maxHp / 3)
  state.opponent.team[0].moves = [runtimeMove('splash')]
  const nextState = playBattleTurnWithActions(
    state,
    [{ type: 'move', actorSlot: 0, targetSlot: 0, moveIndex: 0, gimmick: null }],
    [{ type: 'move', actorSlot: 0, targetSlot: 0, moveIndex: 0, gimmick: null }],
    () => 0.5,
  )
  assert.equal(nextState.player.team[0].hp, nextState.player.team[0].maxHp)
  assert.equal(nextState.player.team[0].status, null)
  assert.equal(nextState.player.team[0].consumedItem, true)
}

{
  const state = makeBattle()
  state.player.team[0].moves = [runtimeMove('rest')]
  state.player.team[0].heldItemId = 'leftovers'
  state.player.team[0].hp = Math.floor(state.player.team[0].maxHp / 3)
  state.opponent.team[0].moves = [runtimeMove('splash')]
  const nextState = playBattleTurnWithActions(
    state,
    [{ type: 'move', actorSlot: 0, targetSlot: 0, moveIndex: 0, gimmick: null }],
    [{ type: 'move', actorSlot: 0, targetSlot: 0, moveIndex: 0, gimmick: null }],
    () => 0.5,
  )
  assert.equal(nextState.player.team[0].status?.id, 'sleep')
  assert.equal(nextState.player.team[0].consumedItem, false)
}

{
  const state = makeBattle()
  state.player.team[0].moves = [runtimeMove('tackle')]
  state.opponent.team[0].moves = [runtimeMove('kingsshield')]
  state.opponent.team[0].stats.speed = state.player.team[0].stats.speed + 100
  const nextState = playBattleTurnWithActions(
    state,
    [{ type: 'move', actorSlot: 0, targetSlot: 0, moveIndex: 0, gimmick: null }],
    [{ type: 'move', actorSlot: 0, targetSlot: 0, moveIndex: 0, gimmick: null }],
    () => 0.5,
  )
  assert.equal(nextState.player.team[0].statStages.attack, -1)
  assert.equal(nextState.opponent.team[0].hp, nextState.opponent.team[0].maxHp)
}

{
  const state = makeBattle({ opponentCount: 3 })
  state.opponent.team[0].hp = 0
  state.opponent.team[0].fainted = true
  state.opponent.team[1].types = ['전기']
  state.opponent.team[1].moves = [runtimeMove('thunderbolt')]
  state.opponent.team[2].types = ['비행']
  state.opponent.team[2].moves = [runtimeMove('icebeam')]
  state.player.team[0].types = ['땅']
  state.player.team[0].moves = [runtimeMove('earthquake')]
  assert.equal(chooseAiReplacementIndex(state, 'opponent', 0), 2)
}

{
  const state = makeBattle()
  state.player.team[0].moves = [runtimeMove('thunderbolt'), runtimeMove('tackle')]
  state.opponent.team[0].types = ['물']
  const [action] = chooseAiActionsForSide(state, 'player', () => 0)
  assert.equal(state.player.team[0].moves[action.moveIndex].id, 'thunderbolt')
}

{
  const state = createBattle({
    playerPokemon: [{ speciesId: 9, moveIds: ['surf', 'icebeam'] }],
    opponent: { name: '선발 검증 AI', tier: 'S' },
    opponentTeam: {
      pokemon: [
        { speciesId: 6, moveIds: ['flamethrower', 'airslash'], role: '특수 어태커' },
        { speciesId: 25, moveIds: ['thunderbolt', 'voltswitch'], role: '선봉·교대' },
      ],
      battleGimmicks: [],
      strategy: { lead: '리자몽' },
    },
    rules: battleRules(1),
  })
  assert.equal(getActivePokemon(state, 'opponent').name, '피카츄')
}

{
  const state = makeBattle({ playerCount: 4 })
  state.player.team.forEach((pokemon) => { pokemon.moves = [runtimeMove('splash')] })
  state.opponent.team[0].moves = [runtimeMove('spikes'), runtimeMove('tackle')]
  const action = chooseAiAction(state, () => 0)
  assert.equal(state.opponent.team[0].moves[action.moveIndex].id, 'spikes')
}

{
  const state = makeBattle({ playerCount: 4 })
  state.player.team.forEach((pokemon) => { pokemon.moves = [runtimeMove('splash')] })
  state.opponent.team[0].moves = [runtimeMove('spikes'), runtimeMove('tackle')]
  state.player.hazards.spikes = 3
  const action = chooseAiAction(state, () => 0)
  assert.equal(state.opponent.team[0].moves[action.moveIndex].id, 'tackle')
}

{
  const state = makeBattle({ opponentCount: 3 })
  state.player.team[0].moves = [runtimeMove('splash')]
  state.opponent.team[0].moves = [runtimeMove('defog'), runtimeMove('tackle')]
  state.opponent.hazards.stealthRock = true
  state.opponent.hazards.spikes = 3
  const action = chooseAiAction(state, () => 0)
  assert.equal(state.opponent.team[0].moves[action.moveIndex].id, 'defog')
}

{
  const state = makeBattle()
  state.player.team[0].moves = [runtimeMove('surf')]
  state.player.team[0].stats.speed = 180
  state.player.team[0].stats.specialAttack = 70
  state.opponent.team[0].moves = [runtimeMove('tailwind'), runtimeMove('tackle')]
  state.opponent.team[0].stats.speed = 60
  const action = chooseAiAction(state, () => 0)
  assert.equal(state.opponent.team[0].moves[action.moveIndex].id, 'tailwind')
}

{
  const state = createBattle({
    playerPokemon: [{
      speciesId: 25,
      battleMechanics: ['z-move'],
      heldItemId: 'electrium-z--held',
      moveIds: ['thunderbolt'],
    }],
    opponent: { name: 'Hard AI', tier: 'S' },
    opponentTeam: {
      pokemon: [
        { speciesId: 9, moveIds: ['tackle'] },
        { speciesId: 450, moveIds: ['earthquake'] },
      ],
      battleGimmicks: [],
      strategy: {},
    },
    rules: battleRules(1, 'hard'),
  })
  state.player.activeIndexes = [0]
  state.player.activeIndex = 0
  state.opponent.activeIndexes = [0]
  state.opponent.activeIndex = 0
  state.player.team[0].moves = [runtimeMove('thunderbolt')]
  state.player.team[0].stats.specialAttack = 150
  state.player.team[0].stats.speed = 500
  state.opponent.team[0].moves = [runtimeMove('tackle')]
  state.opponent.team[0].hp = Math.ceil(state.opponent.team[0].maxHp * 0.15)
  state.opponent.team[1].moves = [runtimeMove('earthquake')]
  const action = chooseAiAction(state, () => 0)
  assert.equal(action.type, 'switch')
  assert.equal(action.targetIndex, 1)
}

process.stdout.write('Validated 34 predictive battle AI and damage decisions.\n')
