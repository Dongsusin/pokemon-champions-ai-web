import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import pokemonData from '../src/data/generatedPokemonData.json' with { type: 'json' }
import generatedBattleMoves from '../src/data/generatedBattleMoves.json' with { type: 'json' }
import battleItems from '../src/data/generatedBattleItems.js'
import {
  createBattle,
  createBattleTurnTimeline,
  forcePlayerSwitch,
  getForcedBattleAction,
  getBattleMovePreview,
  getBattleMoveSelectionState,
  getBattleSwitchIndexes,
  getEffectiveBattleStat,
  playBattleTurnWithActions,
  chooseAiAction,
} from '../src/data/battleEngine.js'
import {
  isBattleMoveSupported,
  SUPPORTED_VOLATILE_STATUS_IDS,
} from '../src/data/moveSupportData.js'
import { getMoveById } from '../src/data/trainingData.js'

const profiles = [...pokemonData.species, ...pokemonData.forms]
const profileBySlug = new Map(profiles.map((profile) => [profile.slug, profile]))
const fixedRandom = () => 0.5
const battleEngineSource = readFileSync(new URL('../src/data/battleEngine.js', import.meta.url), 'utf8')
const volatileStatusSupportSource = battleEngineSource
  + readFileSync(new URL('../src/data/moveSupportData.js', import.meta.url), 'utf8')
const heldItemSupportSource = [
  '../src/data/abilitySupportData.js',
  '../src/data/battleEngine.js',
  '../src/data/trainingData.js',
  '../src/data/zMoveData.js',
  '../src/data/zaMegaData.js',
].map((relativePath) => readFileSync(new URL(relativePath, import.meta.url), 'utf8')).join('\n')
const requiredModernBattleItems = [
  'ability-shield',
  'adamant-crystal',
  'booster-energy',
  'cornerstone-mask',
  'fairy-feather',
  'griseous-core',
  'hearthflame-mask',
  'lustrous-globe',
  'rusted-shield',
  'rusted-sword',
  'wellspring-mask',
]

assert(battleItems.length >= 339, 'The battle item catalog should include historical and modern held items')
requiredModernBattleItems.forEach((itemId) => {
  const item = battleItems.find((entry) => entry.id === itemId)
  assert(item, `Missing modern battle item: ${itemId}`)
  assert(/[가-힣]/.test(item.name), `${itemId} should have a Korean name`)
  assert(item.description && item.effect && item.sprite, `${itemId} should have complete battle metadata`)
})

assert.deepEqual(
  generatedBattleMoves.moves.filter((move) => !isBattleMoveSupported(move)).map((move) => move.id),
  [],
  'Every selectable move should have a battle implementation path',
)
assert.deepEqual(
  generatedBattleMoves.moves
    .filter((move) => move.basePowerCallback)
    .filter((move) => !battleEngineSource.includes(`'${move.id}'`))
    .map((move) => move.id),
  [],
  'Every variable-power move should have an explicit engine resolver',
)
assert.deepEqual(
  [...SUPPORTED_VOLATILE_STATUS_IDS]
    .filter((statusId) => !volatileStatusSupportSource.includes(`'${statusId}'`)),
  [],
  'Every generated volatile status should have an engine handler',
)
assert.deepEqual(
  battleItems
    .filter((item) => item.category === 'held')
    .filter((item) => (
      !heldItemSupportSource.includes(`'${item.id}'`)
      && !heldItemSupportSource.includes(`${item.id}:`)
    ))
    .map((item) => item.id),
  [],
  'Every held battle item should have an explicit or mapped engine path',
)

function pokemon(slug, moveIds, overrides = {}) {
  const profile = profileBySlug.get(slug)
  assert(profile, `Missing species fixture: ${slug}`)
  moveIds.forEach((moveId) => assert(getMoveById(moveId), `Missing move fixture: ${moveId}`))
  return {
    captureId: `mechanic-${slug}-${Math.random()}`,
    speciesId: profile.id,
    slug,
    ability: profile.abilities[0],
    moves: moveIds.map((moveId) => getMoveById(moveId).name),
    moveIds,
    ...overrides,
  }
}

function rules(activeSlots = 1) {
  return {
    weather: { id: 'clear', label: '맑음' },
    terrain: { id: 'neutral', label: '일반 필드' },
    format: {
      id: activeSlots > 1 ? 'double' : 'single',
      label: activeSlots > 1 ? '더블배틀' : '싱글배틀',
      activeSlots,
      actionSlots: activeSlots,
    },
    teamRule: { id: 'full', label: '6대6', battleSize: 6 },
    disabledGimmickId: null,
    gimmickRestriction: { id: null, label: '제한 없음' },
  }
}

function battle(playerPokemon, opponentPokemon, activeSlots = 1) {
  const state = createBattle({
    playerPokemon,
    opponent: { name: 'MECHANIC TEST', tier: 'S' },
    opponentTeam: {
      pokemon: opponentPokemon,
      battleGimmicks: [],
      strategy: {},
    },
    rules: rules(activeSlots),
  })
  ;[
    [state.player, playerPokemon],
    [state.opponent, opponentPokemon],
  ].forEach(([side, entries]) => {
    side.team.forEach((battlePokemon, index) => {
      battlePokemon.moves = entries[index].moveIds.map((moveId) => {
        const selectedMove = getMoveById(moveId)
        return {
          ...selectedMove,
          maxPp: Math.max(1, Number(selectedMove.pp) || 1),
          currentPp: Math.max(1, Number(selectedMove.pp) || 1),
        }
      })
    })
  })
  return state
}

function move(moveIndex = 0, actorSlot = 0, targetSlot = 0, extra = {}) {
  return { type: 'move', moveIndex, actorSlot, targetSlot, gimmick: null, ...extra }
}

function turn(state, playerActions, opponentActions, random = fixedRandom) {
  return playBattleTurnWithActions(state, playerActions, opponentActions, random)
}

function preventOpponent(state, slot = 0) {
  state.opponent.team[state.opponent.activeIndexes[slot]].rechargeTurns = 1
}

{
  const state = battle(
    [pokemon('morpeko-hangry', ['aurawheel'])],
    [pokemon('snorlax', ['splash'])],
  )
  assert.equal(getBattleMovePreview(state, 'player', 0).type, '악')
}

{
  // A Quick Attack based Max Strike is an ordinary-priority move. Psychic
  // Terrain protects grounded targets only from true priority moves.
  const state = battle(
    [pokemon('pikachu', ['quickattack'])],
    [pokemon('snorlax', ['splash'])],
  )
  state.rules.terrain = { id: 'psychic', label: '사이코필드' }
  const preview = getBattleMovePreview(state, 'player', 0, 0, 0, 'dynamax')
  assert.equal(preview.id, 'maxstrike')
  assert.equal(preview.priority, 0)
  const targetHp = state.opponent.team[0].hp
  const result = createBattleTurnTimeline(
    state,
    move(0, 0, 0, { gimmick: 'dynamax' }),
    fixedRandom,
    [move(0)],
  )
  assert(result.state.opponent.team[0].hp < targetHp)
  assert(!result.state.log.some((entry) => entry.message.includes('사이코필드가')))
}

{
  // Dynamaxed attackers are immune to Destiny Bond's forced faint.
  const state = battle(
    [pokemon('gengar', ['destinybond'])],
    [pokemon('snorlax', ['darkpulse'])],
  )
  state.player.team[0].hp = 1
  state.opponent.team[0].dynamaxActive = true
  state.opponent.team[0].destinyBondActive = false
  state.player.team[0].destinyBondActive = true
  const result = createBattleTurnTimeline(
    state,
    move(0),
    fixedRandom,
    move(0),
  )
  assert.equal(result.state.player.team[0].fainted, true)
  assert.equal(result.state.opponent.team[0].fainted, false)
  assert(result.state.log.some((entry) => entry.message.includes('다이맥스 상태라 길동무를 무시했다')))
}

{
  // Mold Breaker must continue bypassing Levitate after a Ground move is
  // converted to Max Quake.  Max conversion used to overwrite the source
  // move's ignoreAbility flag, making the Dynamaxed attacker miss entirely.
  const state = battle(
    [pokemon('excadrill', ['earthquake'], { ability: '틀깨기' })],
    [pokemon('bronzong', ['protect'], { ability: '부유' })],
  )
  const preview = getBattleMovePreview(state, 'player', 0, 0, 0, 'dynamax')
  assert.equal(preview.id, 'maxquake')
  assert.equal(preview.ignoreAbility, true)
  preventOpponent(state)
  const targetHp = state.opponent.team[0].hp
  const result = createBattleTurnTimeline(
    state,
    move(0, 0, 0, { gimmick: 'dynamax' }),
    fixedRandom,
    [],
  )
  assert(result.state.opponent.team[0].hp < targetHp)
  assert(!result.state.log.some((entry) => entry.message.includes('부유! 공격을 무효화했다')))
}

{
  // Destiny Bond cannot be selected by the AI on the immediately following
  // turn, preventing Froslass from chaining the move indefinitely.
  let state = battle(
    [pokemon('snorlax', ['splash'])],
    [pokemon('froslass', ['destinybond', 'shadowball'])],
  )
  state = turn(state, [move()], [move(0)])
  assert.equal(state.opponent.team[0].destinyBondLastTurn, 1)
  assert.equal(getBattleMoveSelectionState(state, 'opponent', 0).disabled, true)
  assert.match(getBattleMoveSelectionState(state, 'opponent', 0).reason, /길동무/)
  assert.notEqual(chooseAiAction(state, fixedRandom, 0, 0).moveIndex, 0)
}

{
  const maskTypes = [
    ['teal-mask', '풀'],
    ['wellspring-mask', '물'],
    ['hearthflame-mask', '불꽃'],
    ['cornerstone-mask', '바위'],
  ]
  maskTypes.forEach(([heldItemId, expectedType]) => {
    const state = battle(
      [pokemon('ogerpon', ['ivycudgel'], { heldItemId })],
      [pokemon('blissey', ['splash'])],
    )
    assert.equal(
      getBattleMovePreview(state, 'player', 0).type,
      expectedType,
      `Ivy Cudgel should follow ${heldItemId} type`,
    )
    const { timeline } = createBattleTurnTimeline(
      state,
      move(),
      fixedRandom,
      [move()],
    )
    const announce = timeline.find((step) => step.phase === 'announce' && step.sideId === 'player')
    assert.equal(announce?.moveId, 'ivycudgel')
    assert.equal(announce?.moveType, expectedType)
  })
}

{
  let state = battle(
    [pokemon('charizard', ['dig', 'tackle'])],
    [pokemon('snorlax', ['splash'])],
  )
  const targetHp = state.opponent.team[0].hp
  const digPp = state.player.team[0].moves[0].currentPp
  const tacklePp = state.player.team[0].moves[1].currentPp
  preventOpponent(state)
  state = turn(state, [move(0)], [move()])
  assert.equal(state.opponent.team[0].hp, targetHp)
  assert.equal(state.player.team[0].chargingMove?.moveId, 'dig')
  assert.deepEqual(getForcedBattleAction(state, 'player', 0), {
    type: 'move',
    moveIndex: 0,
    targetSlot: 0,
    targetSideId: 'opponent',
    gimmick: null,
    forcedReason: 'charge',
  })
  assert.equal(state.player.team[0].moves[0].currentPp, digPp - 1)

  preventOpponent(state)
  state = turn(state, [move(1)], [move()])
  assert(state.opponent.team[0].hp < targetHp)
  assert.equal(state.player.team[0].chargingMove, null)
  assert.equal(state.player.team[0].moves[0].currentPp, digPp - 1)
  assert.equal(state.player.team[0].moves[1].currentPp, tacklePp)
}

{
  let state = battle(
    [
      pokemon('charizard', ['dig', 'tackle']),
      pokemon('pikachu', ['tackle']),
    ],
    [
      pokemon('snorlax', ['splash']),
      pokemon('blissey', ['splash']),
    ],
    2,
  )
  state.player.team[0].stats.speed = 999
  state.player.team[1].stats.speed = 998
  preventOpponent(state, 0)
  preventOpponent(state, 1)
  state = turn(
    state,
    [move(0, 0, 0), move(0, 1, 1)],
    [move(0, 0, 0), move(0, 1, 1)],
  )
  const firstTargetHp = state.opponent.team[0].hp
  const secondTargetHp = state.opponent.team[1].hp
  const tacklePp = state.player.team[0].moves[1].currentPp

  preventOpponent(state, 0)
  preventOpponent(state, 1)
  state = turn(
    state,
    [move(1, 0, 1), move(0, 1, 1)],
    [move(0, 0, 0), move(0, 1, 1)],
  )
  assert(state.opponent.team[0].hp < firstTargetHp)
  assert(state.opponent.team[1].hp < secondTargetHp)
  assert.equal(state.player.team[0].moves[1].currentPp, tacklePp)
  assert.equal(state.player.team[0].chargingMove, null)
}

{
  let state = battle(
    [pokemon('scizor', ['falseswipe'])],
    [pokemon('snorlax', ['splash'])],
  )
  state.opponent.team[0].hp = 1
  preventOpponent(state)
  state = turn(state, [move()], [move()])
  assert.equal(state.opponent.team[0].hp, 1)
}

{
  let state = battle(
    [pokemon('toxtricity', ['belch'])],
    [pokemon('snorlax', ['splash'])],
  )
  preventOpponent(state)
  const hpBefore = state.opponent.team[0].hp
  state = turn(state, [move()], [move()])
  assert.equal(state.opponent.team[0].hp, hpBefore)
  state.player.team[0].ateBerry = true
  preventOpponent(state)
  state = turn(state, [move()], [move()])
  assert(state.opponent.team[0].hp < hpBefore)
}

{
  let state = battle(
    [pokemon('charizard', ['burnup'])],
    [pokemon('snorlax', ['splash'])],
  )
  preventOpponent(state)
  state = turn(state, [move()], [move()])
  assert(!state.player.team[0].types.includes('불꽃'))
  const hpBefore = state.opponent.team[0].hp
  preventOpponent(state)
  state = turn(state, [move()], [move()])
  assert.equal(state.opponent.team[0].hp, hpBefore)
}

{
  let state = battle(
    [pokemon('absol', ['suckerpunch'])],
    [pokemon('snorlax', ['splash'])],
  )
  const hpBefore = state.opponent.team[0].hp
  state = turn(state, [move()], [move()])
  assert.equal(state.opponent.team[0].hp, hpBefore)

  state = battle(
    [pokemon('absol', ['suckerpunch'])],
    [pokemon('snorlax', ['tackle'])],
  )
  const attackHpBefore = state.opponent.team[0].hp
  state = turn(state, [move()], [move()])
  assert(state.opponent.team[0].hp < attackHpBefore)
}

{
  let state = battle(
    [pokemon('breloom', ['focuspunch'])],
    [pokemon('snorlax', ['tackle'])],
  )
  state.player.team[0].stats.speed = 1
  state.opponent.team[0].stats.speed = 999
  const hpBefore = state.opponent.team[0].hp
  state = turn(state, [move()], [move()])
  assert.equal(state.opponent.team[0].hp, hpBefore)
}

{
  let state = battle(
    [pokemon('beedrill', ['fellstinger'])],
    [pokemon('caterpie', ['splash'])],
  )
  state.opponent.team[0].hp = 1
  preventOpponent(state)
  state = turn(state, [move()], [move()])
  assert.equal(state.player.team[0].statStages.attack, 3)
}

{
  let state = battle(
    [pokemon('kleavor', ['stoneaxe'])],
    [pokemon('snorlax', ['splash'])],
  )
  preventOpponent(state)
  state = turn(state, [move()], [move()])
  assert.equal(state.opponent.hazards.stealthRock, true)
}

{
  let state = battle(
    [pokemon('smeargle', ['agility', 'batonpass']), pokemon('snorlax', ['splash'])],
    [pokemon('blissey', ['splash'])],
  )
  preventOpponent(state)
  state = turn(state, [move(0)], [move()])
  preventOpponent(state)
  const passPpBefore = state.player.team[0].moves[1].currentPp
  const passTurn = state.turn
  state = turn(state, [move(1)], [move()])
  assert.equal(state.awaitingPlayerSwitch, true)
  assert.equal(state.pendingPlayerSwitch?.kind, 'pivot')
  assert.equal(state.player.activeIndex, 0, 'Baton Pass must wait for the player to choose a replacement')
  assert.equal(state.turn, passTurn)
  assert.equal(state.player.team[0].moves[1].currentPp, passPpBefore - 1)
  assert.equal(state.player.team[0].statStages.speed, 2)
  assert.equal(state.player.team[1].statStages.speed, 0, 'The unselected bench Pokemon must not receive effects early')
  state = forcePlayerSwitch(state, 1, fixedRandom)
  assert.equal(state.awaitingPlayerSwitch, false)
  assert.equal(state.player.activeIndex, 1)
  assert.equal(state.player.team[1].statStages.speed, 2)
  assert.equal(state.player.team[0].statStages.speed, 0)
  assert.equal(state.player.team[0].moves[1].currentPp, passPpBefore - 1)
  assert.equal(state.turn, passTurn + 1)
}

{
  let state = battle(
    [pokemon('cyclizar', ['shedtail']), pokemon('snorlax', ['splash'])],
    [pokemon('blissey', ['splash'])],
  )
  preventOpponent(state)
  const source = state.player.team[0]
  const hpAfterCost = source.hp - Math.ceil(source.maxHp / 2)
  const substituteHp = Math.floor(source.maxHp / 4)
  const shedTailPpBefore = source.moves[0].currentPp
  const shedTailTurn = state.turn
  state = turn(state, [move()], [move()])
  assert.equal(state.awaitingPlayerSwitch, true)
  assert.equal(state.pendingPlayerSwitch?.kind, 'pivot')
  assert.equal(state.player.activeIndex, 0, 'Shed Tail must wait for the player replacement choice')
  assert.equal(state.turn, shedTailTurn)
  assert.equal(state.player.team[0].hp, hpAfterCost)
  assert.equal(state.player.team[0].moves[0].currentPp, shedTailPpBefore - 1)
  assert.equal(state.pendingPlayerSwitch.shedTailHp, substituteHp)
  assert.equal(state.player.team[1].substituteHp, 0)
  state = forcePlayerSwitch(state, 1, fixedRandom)
  assert.equal(state.awaitingPlayerSwitch, false)
  assert.equal(state.player.activeIndex, 1)
  assert.equal(state.player.team[1].substituteHp, substituteHp)
  assert.equal(state.player.team[0].hp, hpAfterCost)
  assert.equal(state.player.team[0].moves[0].currentPp, shedTailPpBefore - 1)
  assert.equal(state.turn, shedTailTurn + 1)
}

{
  let state = battle(
    [pokemon('glaceon', ['freezyfrost'])],
    [pokemon('snorlax', ['splash'])],
  )
  state.player.team[0].statStages.specialAttack = 3
  state.opponent.team[0].statStages.defense = -2
  preventOpponent(state)
  state = turn(state, [move()], [move()])
  assert.equal(state.player.team[0].statStages.specialAttack, 0)
  assert.equal(state.opponent.team[0].statStages.defense, 0)
}

{
  let state = battle(
    [pokemon('zygarde', ['coreenforcer'])],
    [pokemon('snorlax', ['agility'], { ability: '면역' })],
  )
  state.player.team[0].stats.speed = 1
  state.opponent.team[0].stats.speed = 999
  state = turn(state, [move()], [move()])
  assert.equal(state.opponent.team[0].ability, '')
  assert.equal(state.opponent.team[0].abilitySuppressed, true)
}

{
  let state = battle(
    [pokemon('drednaw', ['jawlock']), pokemon('wailord', ['splash'])],
    [pokemon('snorlax', ['protect']), pokemon('wailord', ['splash'])],
  )
  state.opponent.activeIndex = 0
  state.opponent.activeIndexes = [0]
  assert.deepEqual(getBattleSwitchIndexes(state, 'player'), [1])
  assert.deepEqual(getBattleSwitchIndexes(state, 'opponent'), [1])
  preventOpponent(state)
  state = turn(state, [move()], [move()])
  assert.equal(state.player.team[0].trappedByMoveSourceBattleId, state.opponent.team[0].battleId)
  assert.equal(state.opponent.team[0].trappedByMoveSourceBattleId, state.player.team[0].battleId)
  assert.deepEqual(getBattleSwitchIndexes(state, 'player'), [])
  assert.deepEqual(getBattleSwitchIndexes(state, 'opponent'), [])
}

{
  let state = battle(
    [pokemon('maushold', ['populationbomb'], {
      heldItemId: 'loaded-dice',
      heldItemName: '속임수주사위',
    })],
    [pokemon('blissey', ['splash'])],
  )
  state.opponent.team[0].hp = state.opponent.team[0].maxHp = 10000
  preventOpponent(state)
  state = turn(state, [move()], [move()])
  assert(state.log.some((entry) => entry.message.includes('10번 맞았다')))
}

{
  let state = battle(
    [
      pokemon('weezing-galar', ['explosion'], { ability: '화학변화가스' }),
      pokemon('rotom', ['splash'], { ability: '부유' }),
    ],
    [pokemon('snorlax', ['tackle']), pokemon('blissey', ['splash'])],
    2,
  )
  assert.equal(state.player.team[1].ability, '')
  assert.equal(state.player.team[1].neutralizedAbility, '부유')
  preventOpponent(state, 0)
  preventOpponent(state, 1)
  state = turn(state, [move(0, 0), move(0, 1)], [move(0, 0, 0), move(0, 1, 1)])
  assert.equal(state.player.team[0].fainted, true)
  assert.equal(state.player.team[1].ability, '부유')
  assert.equal(state.player.team[1].neutralizedAbility, null)
}

{
  const state = battle(
    [pokemon('weezing-galar', ['splash'], { ability: '화학변화가스' })],
    [pokemon('rotom', ['splash'], {
      ability: '부유',
      heldItemId: 'ability-shield',
      heldItemName: '특성가드',
    })],
  )
  assert.equal(state.opponent.team[0].ability, '부유')
  assert.equal(state.opponent.team[0].neutralizedAbility, null)
}

{
  let state = battle(
    [pokemon('smeargle', ['aurawheel'])],
    [pokemon('snorlax', ['splash'])],
  )
  preventOpponent(state)
  const hpBefore = state.opponent.team[0].hp
  state = turn(state, [move()], [move()])
  assert.equal(state.opponent.team[0].hp, hpBefore)
  assert(state.log.some((entry) => entry.message.includes('모르페코가 아니어서')))

  state = battle(
    [pokemon('smeargle', ['hyperspacefury'])],
    [pokemon('snorlax', ['splash'])],
  )
  preventOpponent(state)
  const furyHpBefore = state.opponent.team[0].hp
  state = turn(state, [move()], [move()])
  assert.equal(state.opponent.team[0].hp, furyHpBefore)
  assert(state.log.some((entry) => entry.message.includes('굴레를 벗어난 후파가 아니어서')))
}

{
  let state = battle(
    [pokemon('komala', ['snore'], { ability: '절대안깸' })],
    [pokemon('snorlax', ['splash'])],
  )
  preventOpponent(state)
  const hpBefore = state.opponent.team[0].hp
  state = turn(state, [move()], [move()])
  assert(state.opponent.team[0].hp < hpBefore)

  state = battle(
    [pokemon('gengar', ['dreameater'])],
    [pokemon('komala', ['splash'], { ability: '절대안깸' })],
  )
  preventOpponent(state)
  const comatoseHpBefore = state.opponent.team[0].hp
  state = turn(state, [move()], [move()])
  assert(state.opponent.team[0].hp < comatoseHpBefore)

  state = battle(
    [pokemon('snorlax', ['snore'])],
    [pokemon('blissey', ['splash'])],
  )
  preventOpponent(state)
  const awakeHpBefore = state.opponent.team[0].hp
  state = turn(state, [move()], [move()])
  assert.equal(state.opponent.team[0].hp, awakeHpBefore)
}

{
  let state = battle(
    [pokemon('snorlax', ['rest', 'tackle'])],
    [pokemon('blissey', ['splash'])],
  )
  state.player.team[0].hp -= 30
  preventOpponent(state)
  state = turn(state, [move(0)], [move()])
  assert.equal(state.player.team[0].status?.id, 'sleep')
  const hpBeforeWake = state.opponent.team[0].hp
  preventOpponent(state)
  state = turn(state, [move(1)], [move()])
  preventOpponent(state)
  state = turn(state, [move(1)], [move()])
  assert.equal(state.opponent.team[0].hp, hpBeforeWake)
  preventOpponent(state)
  state = turn(state, [move(1)], [move()])
  assert(state.opponent.team[0].hp < hpBeforeWake)

  state = battle(
    [pokemon('snorlax', ['tackle'])],
    [pokemon('blissey', ['splash'])],
  )
  state.player.team[0].confusionTurns = 2
  state.player.team[0].stats.speed = 999
  preventOpponent(state)
  const confusionTargetHp = state.opponent.team[0].hp
  state = turn(state, [move()], [move()], () => 0.4)
  assert(state.opponent.team[0].hp < confusionTargetHp)
}

{
  let state = battle(
    [pokemon('smeargle', ['mefirst'])],
    [pokemon('snorlax', ['hyperbeam'])],
  )
  state.player.team[0].stats.speed = 999
  state.opponent.team[0].stats.speed = 1
  const hpBefore = state.opponent.team[0].hp
  state = turn(state, [move()], [move()])
  assert(state.opponent.team[0].hp < hpBefore)
}

{
  let state = battle(
    [pokemon('smeargle', ['afteryou']), pokemon('magikarp', ['splash'])],
    [pokemon('snorlax', ['tackle']), pokemon('persian', ['scratch'])],
    2,
  )
  state.opponent.activeIndex = 0
  state.opponent.activeIndexes = [0, 1]
  state.player.team[0].stats.speed = 999
  state.player.team[1].stats.speed = 1
  state.opponent.team[0].stats.speed = 100
  state.opponent.team[1].stats.speed = 200
  const logStart = state.log.length
  state = turn(
    state,
    [move(0, 0, 0), move(0, 1, 0)],
    [move(0, 0, 0), move(0, 1, 0)],
  )
  const afterYouLogs = state.log.slice(logStart)
  const advancedIndex = afterYouLogs.findIndex((entry) => entry.message === `${state.opponent.team[0].name}의 ${getMoveById('tackle').name}!`)
  const fasterIndex = afterYouLogs.findIndex((entry) => entry.message === `${state.opponent.team[1].name}의 ${getMoveById('scratch').name}!`)
  assert(advancedIndex >= 0 && advancedIndex < fasterIndex)

  state = battle(
    [pokemon('smeargle', ['quash']), pokemon('magikarp', ['splash'])],
    [pokemon('snorlax', ['tackle']), pokemon('persian', ['scratch'])],
    2,
  )
  state.opponent.activeIndex = 0
  state.opponent.activeIndexes = [0, 1]
  state.player.team[0].stats.speed = 999
  state.player.team[1].stats.speed = 1
  state.opponent.team[0].stats.speed = 500
  state.opponent.team[1].stats.speed = 400
  const quashLogStart = state.log.length
  state = turn(
    state,
    [move(0, 0, 0), move(0, 1, 0)],
    [move(0, 0, 0), move(0, 1, 0)],
  )
  const quashLogs = state.log.slice(quashLogStart)
  const delayedIndex = quashLogs.findIndex((entry) => entry.message === `${state.opponent.team[0].name}의 ${getMoveById('tackle').name}!`)
  const slowAllyIndex = quashLogs.findIndex((entry) => entry.message === `${state.player.team[1].name}의 ${getMoveById('splash').name}!`)
  assert(delayedIndex > slowAllyIndex)
}

{
  let state = battle(
    [pokemon('latios', ['psychic'], { heldItemId: 'soul-dew', heldItemName: '마음의물방울' })],
    [pokemon('blissey', ['splash'])],
  )
  const latios = state.player.team[0]
  assert.equal(getEffectiveBattleStat(state, latios, 'specialAttack'), latios.stats.specialAttack)
  assert.equal(getEffectiveBattleStat(state, latios, 'specialDefense'), latios.stats.specialDefense)

  state = battle(
    [pokemon('ditto', ['tackle'], { heldItemId: 'metal-powder', heldItemName: '금속파우더' })],
    [pokemon('blissey', ['splash'])],
  )
  const ditto = state.player.team[0]
  assert.equal(getEffectiveBattleStat(state, ditto, 'defense'), ditto.stats.defense * 2)
  assert.equal(getEffectiveBattleStat(state, ditto, 'specialDefense'), ditto.stats.specialDefense)
}

{
  let state = battle(
    [pokemon('hawlucha', ['acrobatics'], { heldItemId: 'leftovers', heldItemName: '먹다남은음식' })],
    [pokemon('blissey', ['splash'])],
  )
  state.player.team[0].embargoTurns = 3
  assert.equal(getBattleMovePreview(state, 'player', 0).power, 55)

  state = battle(
    [pokemon('absol', ['knockoff'])],
    [pokemon('blissey', ['splash'], { heldItemId: 'leftovers', heldItemName: '먹다남은음식' })],
  )
  state.opponent.team[0].embargoTurns = 3
  assert.equal(getBattleMovePreview(state, 'player', 0).power, 97)
  preventOpponent(state)
  state = turn(state, [move()], [move()])
  assert.equal(state.opponent.team[0].heldItemId, '')

  state = battle(
    [pokemon('snorlax', ['tackle'], { heldItemId: 'leftovers', heldItemName: '먹다남은음식' })],
    [pokemon('blissey', ['splash'], { heldItemId: 'sticky-barb', heldItemName: '끈적끈적바늘' })],
  )
  state.player.team[0].embargoTurns = 3
  preventOpponent(state)
  state = turn(state, [move()], [move()])
  assert.equal(state.player.team[0].heldItemId, 'leftovers')
  assert.equal(state.opponent.team[0].heldItemId, 'sticky-barb')
}

{
  let state = battle(
    [pokemon('charizard', ['ember'])],
    [pokemon('caterpie', ['splash'], { heldItemId: 'weakness-policy', heldItemName: '약점보험' })],
  )
  state.opponent.team[0].hp = 1
  preventOpponent(state)
  state = turn(state, [move()], [move()])
  assert.equal(state.opponent.team[0].consumedItem, false)
  assert.equal(state.opponent.team[0].statStages.attack, 0)

  state = battle(
    [pokemon('charizard', ['ember']), pokemon('magikarp', ['splash'])],
    [pokemon('caterpie', ['splash'], { heldItemId: 'red-card', heldItemName: '레드카드' })],
  )
  state.opponent.team[0].hp = 1
  preventOpponent(state)
  state = turn(state, [move()], [move()])
  assert.equal(state.player.activeIndex, 0)

  state = battle(
    [pokemon('snorlax', ['tackle'], { heldItemId: 'kings-rock', heldItemName: '왕의징표석' })],
    [pokemon('blissey', ['splash'], { heldItemId: 'covert-cloak', heldItemName: '은밀망토' })],
  )
  state.player.team[0].stats.speed = 999
  state.opponent.team[0].stats.speed = 1
  state.opponent.team[0].hp = state.opponent.team[0].maxHp = 5000
  state = turn(state, [move()], [move()], () => 0.05)
  assert(!state.log.some((entry) => entry.message.includes('풀죽어서 움직일 수 없다')))
}

{
  let state = battle(
    [pokemon('absol', ['knockoff'])],
    [pokemon('arceus', ['splash'], { heldItemId: 'flame-plate', heldItemName: '불구슬플레이트' })],
  )
  assert.equal(getBattleMovePreview(state, 'player', 0).power, 65)
  preventOpponent(state)
  state = turn(state, [move()], [move()])
  assert.equal(state.opponent.team[0].heldItemId, 'flame-plate')

  state = battle(
    [pokemon('absol', ['knockoff'])],
    [pokemon('charizard', ['splash'], { heldItemId: 'charizardite-x', heldItemName: '리자몽나이트X' })],
  )
  assert.equal(getBattleMovePreview(state, 'player', 0).power, 65)
  preventOpponent(state)
  state = turn(state, [move()], [move()])
  assert.equal(state.opponent.team[0].heldItemId, 'charizardite-x')

  state = battle(
    [pokemon('absol', ['knockoff'])],
    [pokemon('blissey', ['splash'], { heldItemId: 'charizardite-x', heldItemName: '리자몽나이트X' })],
  )
  assert.equal(getBattleMovePreview(state, 'player', 0).power, 97)
  preventOpponent(state)
  state = turn(state, [move()], [move()])
  assert.equal(state.opponent.team[0].heldItemId, '')

  state = battle(
    [pokemon('smeargle', ['trick'], { heldItemId: 'leftovers', heldItemName: '먹다남은음식' })],
    [pokemon('blissey', ['splash'], { heldItemId: 'buginium-z--held', heldItemName: '벌레Z' })],
  )
  preventOpponent(state)
  state = turn(state, [move()], [move()])
  assert.equal(state.player.team[0].heldItemId, 'leftovers')
  assert.equal(state.opponent.team[0].heldItemId, 'buginium-z--held')
}

{
  let state = battle(
    [pokemon('scizor', ['bugbite'], { heldItemId: 'leftovers', heldItemName: '먹다남은음식' })],
    [pokemon('blissey', ['splash'], { heldItemId: 'sitrus-berry', heldItemName: '자뭉열매' })],
  )
  const attacker = state.player.team[0]
  const defender = state.opponent.team[0]
  attacker.hp = 1
  defender.hp = defender.maxHp = 5000
  defender.embargoTurns = 3
  preventOpponent(state)
  state = turn(state, [move()], [move()])
  assert(state.player.team[0].hp > 1)
  assert.equal(state.player.team[0].heldItemId, 'leftovers')
  assert.equal(state.opponent.team[0].heldItemId, '')

  state = battle(
    [pokemon('charizard', ['incinerate'])],
    [pokemon('blissey', ['splash'], { heldItemId: 'fire-gem', heldItemName: '불꽃주얼' })],
  )
  state.opponent.team[0].hp = state.opponent.team[0].maxHp = 5000
  state.opponent.team[0].embargoTurns = 3
  preventOpponent(state)
  state = turn(state, [move()], [move()])
  assert.equal(state.opponent.team[0].heldItemId, '')
}

{
  let state = battle(
    [pokemon('hawlucha', ['skydrop'])],
    [pokemon('pikachu', ['tackle']), pokemon('magikarp', ['splash'])],
  )
  state.player.team[0].stats.speed = 999
  state.opponent.team[0].stats.speed = 1
  const targetHp = state.opponent.team[0].hp
  const targetPp = state.opponent.team[0].moves[0].currentPp
  state = turn(state, [move()], [move()])
  assert.equal(state.opponent.team[0].hp, targetHp)
  assert.equal(state.opponent.team[0].moves[0].currentPp, targetPp)
  assert.equal(state.opponent.team[0].skyDropSourceBattleId, state.player.team[0].battleId)
  assert.equal(state.player.team[0].chargingMove?.targetBattleId, state.opponent.team[0].battleId)

  state = turn(
    state,
    [move()],
    [{ type: 'switch', actorSlot: 0, targetIndex: 1 }],
  )
  assert.equal(state.opponent.activeIndex, 0)
  assert(state.opponent.team[0].hp < targetHp)
  assert.equal(state.opponent.team[0].skyDropSourceBattleId, null)
  assert.equal(state.player.team[0].chargingMove, null)

  state = battle(
    [pokemon('hawlucha', ['skydrop'])],
    [pokemon('pidgeot', ['splash'])],
  )
  state.player.team[0].stats.speed = 999
  const flyingHp = state.opponent.team[0].hp
  preventOpponent(state)
  state = turn(state, [move()], [move()])
  preventOpponent(state)
  state = turn(state, [move()], [move()])
  assert.equal(state.opponent.team[0].hp, flyingHp)
  assert.equal(state.opponent.team[0].skyDropSourceBattleId, null)

  state = battle(
    [pokemon('hawlucha', ['skydrop'])],
    [pokemon('snorlax', ['splash'])],
  )
  preventOpponent(state)
  state = turn(state, [move()], [move()])
  assert.equal(state.player.team[0].chargingMove, null)
  assert(state.log.some((entry) => entry.message.includes('너무 무거워')))

  state = battle(
    [pokemon('hawlucha', ['skydrop', 'honeclaws'])],
    [pokemon('pikachu', ['splash'])],
  )
  // Keep a legal alternative available: this scenario checks the rejected
  // Sky Drop request, while an entirely blocked moveset must use Struggle.
  state.environment.gravityTurns = 3
  preventOpponent(state)
  state = turn(state, [move()], [move()])
  assert.equal(state.player.team[0].chargingMove, null)
  assert(state.log.some((entry) => entry.message.includes('중력이 강해')))
}

{
  let state = battle(
    [pokemon('dialga', ['flashcannon'], {
      heldItemId: 'adamant-crystal',
      heldItemName: '큰금강옥',
    })],
    [pokemon('blissey', ['splash'])],
  )
  assert.equal(state.player.team[0].slug, 'dialga-origin')

  state = battle(
    [pokemon('zacian', ['tackle'], {
      heldItemId: 'rusted-sword',
      heldItemName: '녹슨검',
    })],
    [pokemon('blissey', ['splash'])],
  )
  assert.equal(state.player.team[0].slug, 'zacian-crowned')

  state = battle(
    [pokemon('ogerpon', ['ivycudgel'], {
      heldItemId: 'wellspring-mask',
      heldItemName: '우물의가면',
    })],
    [pokemon('blissey', ['splash'])],
  )
  assert.equal(state.player.team[0].slug, 'ogerpon-wellspring-mask')
  assert(state.player.team[0].originalTypes.includes('물'))

  const control = battle(
    [pokemon('sylveon', ['moonblast'])],
    [pokemon('blissey', ['splash'])],
  )
  const boosted = battle(
    [pokemon('sylveon', ['moonblast'], {
      heldItemId: 'fairy-feather',
      heldItemName: '요정의깃털',
    })],
    [pokemon('blissey', ['splash'])],
  )
  control.opponent.team[0].hp = control.opponent.team[0].maxHp = 5000
  boosted.opponent.team[0].hp = boosted.opponent.team[0].maxHp = 5000
  preventOpponent(control)
  preventOpponent(boosted)
  const controlResult = turn(control, [move()], [move()])
  const boostedResult = turn(boosted, [move()], [move()])
  const controlDamage = 5000 - controlResult.opponent.team[0].hp
  const boostedDamage = 5000 - boostedResult.opponent.team[0].hp
  assert(boostedDamage > controlDamage)
}

{
  let state = battle(
    [pokemon('tinkaton', ['gigatonhammer', 'tackle'])],
    [pokemon('blissey', ['splash'])],
  )
  state.opponent.team[0].hp = state.opponent.team[0].maxHp = 5000
  preventOpponent(state)
  state = turn(state, [move(0)], [move()])
  const hpAfterFirstHammer = state.opponent.team[0].hp
  const ppAfterFirstHammer = state.player.team[0].moves[0].currentPp
  preventOpponent(state)
  state = turn(state, [move(0)], [move()])
  assert.equal(state.opponent.team[0].hp, hpAfterFirstHammer)
  assert.equal(state.player.team[0].moves[0].currentPp, ppAfterFirstHammer)
  assert(state.log.some((entry) => entry.message.includes('연속해서 사용할 수 없다')))
  preventOpponent(state)
  state = turn(state, [move(1)], [move()])
  preventOpponent(state)
  state = turn(state, [move(0)], [move()])
  assert(state.opponent.team[0].hp < hpAfterFirstHammer)
}

{
  let state = battle(
    [pokemon('smeargle', ['copycat'])],
    [pokemon('eternatus', ['dynamaxcannon'])],
  )
  state.lastUsedMove = {
    moveId: 'dynamaxcannon',
    userBattleId: state.opponent.team[0].battleId,
    sideId: 'opponent',
    targetBattleId: state.player.team[0].battleId,
  }
  preventOpponent(state)
  const targetHp = state.opponent.team[0].hp
  state = turn(state, [move()], [move()])
  assert.equal(state.opponent.team[0].hp, targetHp)
  assert(state.log.some((entry) => entry.message.includes('불러낼 기술이 없어')))
}

{
  let state = battle(
    [pokemon('smeargle', ['instruct'])],
    [pokemon('venusaur', ['solarbeam'])],
  )
  state.opponent.team[0].lastMoveIndex = 0
  preventOpponent(state)
  state = turn(state, [move()], [move()])
  assert.equal(state.opponent.team[0].chargingMove, null)
  assert(state.log.some((entry) => entry.message.includes('불러낼 기술이 없어')))
}

{
  let state = battle(
    [pokemon('smeargle', ['mimic'])],
    [pokemon('eternatus', ['dynamaxcannon'])],
  )
  state.opponent.team[0].lastMoveIndex = 0
  preventOpponent(state)
  state = turn(state, [move()], [move()])
  assert.equal(state.player.team[0].moves[0].id, 'mimic')

  state = battle(
    [pokemon('smeargle', ['sketch'])],
    [pokemon('terapagos', ['terastarstorm'])],
  )
  state.opponent.team[0].lastMoveIndex = 0
  preventOpponent(state)
  state = turn(state, [move()], [move()])
  assert.equal(state.player.team[0].moves[0].id, 'sketch')
}

{
  let state = battle(
    [pokemon('smeargle', ['encore'])],
    [pokemon('smeargle', ['mimic'])],
  )
  state.opponent.team[0].lastMoveIndex = 0
  preventOpponent(state)
  state = turn(state, [move()], [move()])
  assert.equal(state.opponent.team[0].encoreTurns, 0)
  assert.equal(state.opponent.team[0].encoredMoveIndex, null)
}

{
  const flavorBerryResult = (nature) => {
    let state = battle(
      [pokemon('charizard', ['ember'])],
      [pokemon('snorlax', ['splash'], {
        nature,
        heldItemId: 'figy-berry',
        heldItemName: '무화열매',
      })],
    )
    state.opponent.team[0].maxHp = 1000
    state.opponent.team[0].hp = 260
    preventOpponent(state)
    return turn(state, [move()], [move()])
  }
  const disliked = flavorBerryResult('대담')
  const tolerated = flavorBerryResult('고집')
  assert(disliked.opponent.team[0].confusionTurns > 0)
  assert.equal(tolerated.opponent.team[0].confusionTurns, 0)
  assert.equal(disliked.opponent.team[0].consumedItem, true)
}

{
  let state = battle(
    [pokemon('pikachu', ['nuzzle'])],
    [pokemon('snorlax', ['splash'], {
      heldItemId: 'lum-berry',
      heldItemName: '리샘열매',
    })],
  )
  state.opponent.team[0].confusionTurns = 3
  preventOpponent(state)
  state = turn(state, [move()], [move()])
  assert.equal(state.opponent.team[0].status, null)
  assert.equal(state.opponent.team[0].confusionTurns, 0)
  assert.equal(state.opponent.team[0].consumedItem, true)
}

{
  let state = battle(
    [pokemon('snorlax', ['rest'], {
      heldItemId: 'chesto-berry',
      heldItemName: '유루열매',
    })],
    [pokemon('blissey', ['splash'])],
  )
  state.player.team[0].hp = 1
  preventOpponent(state)
  state = turn(state, [move()], [move()])
  assert.equal(state.player.team[0].hp, state.player.team[0].maxHp)
  assert.equal(state.player.team[0].status, null)
  assert.equal(state.player.team[0].consumedItem, true)
}

{
  const berries = battleItems.filter((item) => item.category === 'berry')
  assert(berries.length > 0)
  berries.forEach((item) => {
    assert(item.flingPower > 0, `${item.id} should define Fling power`)
    assert(item.naturalGiftPower > 0, `${item.id} should define Natural Gift power`)
    assert(item.naturalGiftType, `${item.id} should define Natural Gift type`)
  })
  assert.equal(battleItems.find((item) => item.id === 'iron-ball')?.flingPower, 130)
  assert.equal(battleItems.find((item) => item.id === 'ability-shield')?.flingPower, 30)
  assert.equal(battleItems.find((item) => item.id === 'roseli-berry')?.naturalGiftType, '페어리')
}

{
  const naturalGiftPreview = (heldItemId) => {
    const heldItem = battleItems.find((item) => item.id === heldItemId)
    const state = battle(
      [pokemon('snorlax', ['naturalgift'], {
        heldItemId,
        heldItemName: heldItem.name,
      })],
      [pokemon('blissey', ['splash'])],
    )
    return getBattleMovePreview(state)
  }
  assert.deepEqual(
    [naturalGiftPreview('sitrus-berry').power, naturalGiftPreview('sitrus-berry').type],
    [80, '에스퍼'],
  )
  assert.deepEqual(
    [naturalGiftPreview('liechi-berry').power, naturalGiftPreview('liechi-berry').type],
    [100, '풀'],
  )
}

{
  let state = battle(
    [pokemon('snorlax', ['fling'], {
      heldItemId: 'toxic-orb',
      heldItemName: '맹독구슬',
    })],
    [pokemon('blissey', ['splash'])],
  )
  state.opponent.team[0].hp = state.opponent.team[0].maxHp = 5000
  preventOpponent(state)
  state = turn(state, [move()], [move()])
  assert.equal(state.opponent.team[0].status?.id, 'toxic')
  assert.equal(state.player.team[0].consumedItem, true)

  state = battle(
    [pokemon('snorlax', ['fling'], {
      heldItemId: 'light-ball',
      heldItemName: '전기구슬',
    })],
    [pokemon('blissey', ['splash'])],
  )
  state.opponent.team[0].hp = state.opponent.team[0].maxHp = 5000
  preventOpponent(state)
  state = turn(state, [move()], [move()])
  assert.equal(state.opponent.team[0].status?.id, 'paralysis')

  state = battle(
    [pokemon('snorlax', ['fling'], {
      heldItemId: 'white-herb',
      heldItemName: '하양허브',
    })],
    [pokemon('blissey', ['splash'])],
  )
  state.opponent.team[0].hp = state.opponent.team[0].maxHp = 5000
  state.opponent.team[0].statStages.attack = -2
  preventOpponent(state)
  state = turn(state, [move()], [move()])
  assert.equal(state.opponent.team[0].statStages.attack, 0)

  state = battle(
    [pokemon('snorlax', ['fling'], {
      heldItemId: 'liechi-berry',
      heldItemName: '치리열매',
    })],
    [pokemon('blissey', ['splash'])],
  )
  state.opponent.team[0].hp = state.opponent.team[0].maxHp = 5000
  preventOpponent(state)
  state = turn(state, [move()], [move()])
  assert.equal(state.opponent.team[0].statStages.attack, 1)
  assert.equal(state.opponent.team[0].ateBerry, true)
}

console.log('Validated move conditions, sleep states, turn order, held items, Fling, Natural Gift, ability suppression, and move-call restrictions.')
