import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import pokemonData from '../src/data/generatedPokemonData.json' with { type: 'json' }
import {
  createBattle,
  getBattleMovePreview,
  getEffectiveBattleStat,
  playBattleTurnWithActions,
} from '../src/data/battleEngine.js'
import { getLearnableMoves, getMoveById } from '../src/data/trainingData.js'

const profiles = [...pokemonData.species, ...pokemonData.forms]
const profileBySlug = new Map(profiles.map((profile) => [profile.slug, profile]))

function pokemon(slug, moveIds = ['agility'], overrides = {}) {
  const profile = profileBySlug.get(slug)
  assert(profile, `Missing species fixture: ${slug}`)
  const learnableMoveIds = new Set(getLearnableMoves(profile.id).map((move) => move.id))
  const moves = moveIds.map((moveId) => {
    const move = getMoveById(moveId)
    assert(move, `Missing move fixture: ${moveId}`)
    assert(learnableMoveIds.has(moveId), `${slug} cannot learn fixture move: ${moveId}`)
    return move
  })
  return {
    captureId: `ability-effect-${slug}-${Math.random()}`,
    speciesId: profile.id,
    slug: profile.slug,
    ability: profile.abilities[0],
    moves: moves.map((move) => move.name),
    moveIds: moves.map((move) => move.id),
    ...overrides,
  }
}

function replaceRuntimeMove(state, sideId, teamIndex, moveIndex, moveId) {
  const move = getMoveById(moveId)
  assert(move, `Missing move fixture: ${moveId}`)
  const maxPp = Math.max(1, Number(move.pp) || 1)
  state[sideId].team[teamIndex].moves[moveIndex] = {
    ...move,
    maxPp,
    currentPp: maxPp,
  }
}

function replaceRuntimeAbility(state, sideId, teamIndex, ability) {
  state[sideId].team[teamIndex].ability = ability
}

function pokemonWithAbility(ability, moveIds = ['protect'], overrides = {}) {
  const profile = profiles.find((candidate) => {
    if (!candidate.abilities.includes(ability)) return false
    const learnableMoveIds = new Set(getLearnableMoves(candidate.id).map((move) => move.id))
    return moveIds.every((moveId) => learnableMoveIds.has(moveId))
  })
  assert(profile, `Missing legal fixture for ${ability}: ${moveIds.join(', ')}`)
  return pokemon(profile.slug, moveIds, { ability, ...overrides })
}

function rules({ activeSlots = 1 } = {}) {
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

function battle(playerPokemon, opponentPokemon, battleRules = rules()) {
  return createBattle({
    playerPokemon,
    opponent: { name: 'ABILITY EFFECT TEST', tier: 'S' },
    opponentTeam: {
      pokemon: opponentPokemon,
      battleGimmicks: [],
      strategy: { lead: opponentPokemon[0]?.name },
    },
    rules: battleRules,
  })
}

function turnActions(state, playerActions, opponentActions, random = () => 0.5) {
  return playBattleTurnWithActions(state, playerActions, opponentActions, random)
}

function turn(
  state,
  playerAction = { type: 'move', moveIndex: 0 },
  opponentAction = { type: 'move', moveIndex: 0 },
  random = () => 0.5,
) {
  return playBattleTurnWithActions(
    state,
    [{ actorSlot: 0, targetSlot: 0, gimmick: null, ...playerAction }],
    [{ actorSlot: 0, targetSlot: 0, gimmick: null, ...opponentAction }],
    random,
  )
}

function preventOpponentAction(state) {
  state.opponent.team[state.opponent.activeIndex].rechargeTurns = 1
  return state
}

function damageWithEntries({
  attacker,
  defender,
  mutate = null,
}) {
  let state = preventOpponentAction(battle([attacker], [defender]))
  state.opponent.team[0].hp = state.opponent.team[0].maxHp = 5000
  if (mutate) mutate(state)
  state = turn(state)
  return 5000 - state.opponent.team[0].hp
}

function damageAfterOpponentActs(attacker, mutate = null) {
  let state = battle(
    [attacker],
    [pokemon('smeargle', ['agility'])],
  )
  state.opponent.team[0].hp = state.opponent.team[0].maxHp = 5000
  if (mutate) mutate(state)
  state = turn(state)
  return 5000 - state.opponent.team[0].hp
}

{
  let state = battle(
    [pokemon('smeargle', ['surf'])],
    [pokemonWithAbility('마중물')],
  )
  preventOpponentAction(state)
  state.opponent.team[0].hp = Math.floor(state.opponent.team[0].maxHp / 2)
  const hpBefore = state.opponent.team[0].hp
  state = turn(state)
  assert.equal(state.opponent.team[0].hp, hpBefore)
  assert.equal(state.opponent.team[0].statStages.specialAttack, 1)
}

{
  let state = battle(
    [pokemon('smeargle', ['tackle'])],
    [pokemonWithAbility('프레셔')],
  )
  const ppBefore = state.player.team[0].moves[0].currentPp
  state = turn(state)
  assert.equal(state.player.team[0].moves[0].currentPp, ppBefore - 2)
}

{
  const baseline = damageWithEntries({
    attacker: pokemon('smeargle', ['tackle'], { ability: '마이페이스' }),
    defender: pokemon('smeargle', ['agility']),
  })
  const technician = damageWithEntries({
    attacker: pokemon('smeargle', ['tackle'], { ability: '테크니션' }),
    defender: pokemon('smeargle', ['agility']),
  })
  assert(technician > baseline * 1.4)

  const state = battle(
    [pokemonWithAbility('페어리스킨', ['tackle'])],
    [pokemon('smeargle')],
  )
  assert.equal(getBattleMovePreview(state, 'player', 0).type, '페어리')
}

{
  const state = battle(
    [pokemon('azumarill', ['tackle'], { ability: '천하장사' })],
    [pokemon('smeargle')],
  )
  const azumarill = state.player.team[0]
  assert.equal(getEffectiveBattleStat(state, azumarill, 'attack'), azumarill.stats.attack * 2)
}

{
  let state = battle(
    [pokemon('smeargle', ['growl'])],
    [pokemonWithAbility('클리어바디')],
  )
  preventOpponentAction(state)
  state = turn(state)
  assert.equal(state.opponent.team[0].statStages.attack, 0)
  assert(state.log.some((entry) => entry.message.includes('클리어바디')))
}

{
  const state = battle(
    [pokemonWithAbility('위협')],
    [pokemonWithAbility('오기')],
  )
  assert.equal(state.opponent.team[0].statStages.attack, 1)
}

{
  let blocked = battle(
    [pokemon('smeargle', ['earthquake'])],
    [pokemonWithAbility('부유')],
  )
  preventOpponentAction(blocked)
  const blockedHp = blocked.opponent.team[0].hp
  blocked = turn(blocked)
  assert.equal(blocked.opponent.team[0].hp, blockedHp)

  let bypassed = battle(
    [pokemonWithAbility('틀깨기', ['earthquake'])],
    [pokemonWithAbility('부유')],
  )
  preventOpponentAction(bypassed)
  const bypassedHp = bypassed.opponent.team[0].hp
  bypassed = turn(bypassed)
  assert(bypassed.opponent.team[0].hp < bypassedHp)
}

{
  let state = battle(
    [pokemon('smeargle', ['tackle'])],
    [pokemonWithAbility('까칠한피부')],
  )
  preventOpponentAction(state)
  const hpBefore = state.player.team[0].hp
  state = turn(state)
  assert.equal(state.player.team[0].hp, hpBefore - Math.floor(state.player.team[0].maxHp / 8))
}

{
  let state = battle(
    [pokemon('smeargle', ['tackle'])],
    [pokemonWithAbility('불꽃몸')],
  )
  preventOpponentAction(state)
  state = turn(state, undefined, undefined, () => 0.1)
  assert.equal(state.player.team[0].status?.id, 'burn')
}

{
  let state = battle(
    [pokemon('smeargle', ['tackle'])],
    [pokemonWithAbility('깨어진갑옷')],
  )
  preventOpponentAction(state)
  state = turn(state)
  assert.equal(state.opponent.team[0].statStages.defense, -1)
  assert.equal(state.opponent.team[0].statStages.speed, 2)
}

{
  const baseline = damageWithEntries({
    attacker: pokemon('smeargle', ['surf']),
    defender: pokemon('rhyperior', ['protect'], { ability: '피뢰침' }),
  })
  const reduced = damageWithEntries({
    attacker: pokemon('smeargle', ['surf']),
    defender: pokemon('rhyperior', ['protect'], { ability: '하드록' }),
  })
  assert(reduced < baseline)
  assert(reduced > baseline * 0.65)
}

{
  let state = battle(
    [pokemon('smeargle', ['aurasphere'])],
    [pokemonWithAbility('방탄')],
  )
  preventOpponentAction(state)
  const hpBefore = state.opponent.team[0].hp
  state = turn(state)
  assert.equal(state.opponent.team[0].hp, hpBefore)

  state = battle(
    [pokemon('smeargle', ['boomburst'])],
    [pokemonWithAbility('방음')],
  )
  preventOpponentAction(state)
  const soundHpBefore = state.opponent.team[0].hp
  state = turn(state)
  assert.equal(state.opponent.team[0].hp, soundHpBefore)
}

{
  let state = battle(
    [pokemon('smeargle', ['growl'])],
    [pokemonWithAbility('매직미러')],
  )
  preventOpponentAction(state)
  state = turn(state)
  assert.equal(state.player.team[0].statStages.attack, -1)
  assert.equal(state.opponent.team[0].statStages.attack, 0)
}

{
  let state = battle(
    [pokemon('smeargle', ['toxic'])],
    [pokemonWithAbility('황금몸')],
  )
  preventOpponentAction(state)
  state = turn(state)
  assert.equal(state.opponent.team[0].status, null)
}

{
  let state = battle(
    [
      pokemon('smeargle', ['tackle']),
      pokemon('snorlax', ['tackle'], { ability: '두꺼운지방' }),
    ],
    [pokemonWithAbility('독치장')],
  )
  preventOpponentAction(state)
  state = turn(state)
  assert.equal(state.player.hazards.toxicSpikes, 1)
  state = turn(state, { type: 'switch', targetIndex: 1 })
  assert.equal(state.player.team[1].status?.id, 'poison')
}

{
  let state = battle(
    [pokemon('smeargle', ['bite'])],
    [pokemonWithAbility('저주받은바디')],
  )
  preventOpponentAction(state)
  state = turn(state, undefined, undefined, () => 0.1)
  assert.equal(state.player.team[0].disabledMoveIndex, 0)
  const ppBefore = state.player.team[0].moves[0].currentPp
  state = turn(state)
  assert.equal(state.player.team[0].moves[0].currentPp, ppBefore)
  assert(state.log.some((entry) => entry.message.includes('봉인되어 있다')))
}

{
  const unawareDamage = damageWithEntries({
    attacker: pokemon('smeargle', ['tackle']),
    defender: pokemon('quagsire', ['protect'], { ability: '천진' }),
    mutate: (state) => { state.player.team[0].statStages.attack = 6 },
  })
  const baselineDamage = damageWithEntries({
    attacker: pokemon('smeargle', ['tackle']),
    defender: pokemon('quagsire', ['protect'], { ability: '습기' }),
  })
  assert.equal(unawareDamage, baselineDamage)
}

{
  const analyticDamage = damageAfterOpponentActs(
    pokemonWithAbility('애널라이즈', ['tackle']),
  )
  const baselineDamage = damageAfterOpponentActs(
    pokemonWithAbility('애널라이즈', ['tackle']),
    (state) => { state.player.team[0].ability = '자력' },
  )
  assert(analyticDamage > baselineDamage * 1.2)
}

{
  let state = battle(
    [pokemonWithAbility('잠복', ['tackle'])],
    [pokemon('smeargle', ['protect']), pokemon('snorlax', ['protect'])],
  )
  state.opponent.team[1].hp = state.opponent.team[1].maxHp = 5000
  state = turn(state, undefined, { type: 'switch', targetIndex: 1 })
  assert(5000 - state.opponent.team[1].hp > 0)
}

{
  let state = battle(
    [pokemonWithAbility('통찰', ['protect'])],
    [pokemon('smeargle', ['protect'], { heldItemId: 'leftovers', heldItemName: '먹다남은음식' })],
  )
  assert(state.log.some((entry) => entry.message.includes('통찰') && entry.message.includes('먹다남은음식')))

  state = battle(
    [pokemonWithAbility('위험예지', ['protect'])],
    [pokemon('smeargle', ['drainpunch'])],
  )
  assert(state.log.some((entry) => entry.message.includes('위험을 예지')))
}

{
  let state = battle(
    [pokemon('smeargle', ['protect']), pokemonWithAbility('파스텔베일', ['protect'])],
    [pokemon('snorlax', ['protect'])],
  )
  state.player.team[1].status = { id: 'poison', label: '독' }
  preventOpponentAction(state)
  state = turn(state, { type: 'switch', targetIndex: 1 })
  assert.equal(state.player.team[1].status, null)

  state = battle(
    [pokemon('smeargle', ['protect']), pokemonWithAbility('배리어프리', ['protect'])],
    [pokemon('snorlax', ['protect'])],
  )
  state.player.auroraVeilTurns = 5
  state.opponent.auroraVeilTurns = 5
  preventOpponentAction(state)
  state = turn(state, { type: 'switch', targetIndex: 1 })
  assert.equal(state.player.auroraVeilTurns, 0)
  assert.equal(state.opponent.auroraVeilTurns, 0)
}

{
  let state = battle(
    [pokemon('smeargle', ['protect']), pokemon('snorlax', ['protect'])],
    [pokemonWithAbility('그림자밟기', ['protect'])],
  )
  preventOpponentAction(state)
  state = turn(state, { type: 'switch', targetIndex: 1 })
  assert.equal(state.player.activeIndex, 0)
  assert(state.log.some((entry) => entry.message.includes('그림자밟기')))

  state = battle(
    [
      pokemon('smeargle', ['protect'], { heldItemId: 'shed-shell', heldItemName: '아름다운허물' }),
      pokemon('snorlax', ['protect']),
    ],
    [pokemonWithAbility('그림자밟기', ['protect'])],
  )
  preventOpponentAction(state)
  state = turn(state, { type: 'switch', targetIndex: 1 })
  assert.equal(state.player.activeIndex, 1)
}

{
  let state = battle(
    [pokemon('smeargle', ['tackle'])],
    [pokemonWithAbility('위기회피', ['protect']), pokemon('snorlax', ['protect'])],
  )
  state.opponent.team[0].hp = 31
  state.opponent.team[0].maxHp = 60
  const replacementPp = state.opponent.team[1].moves[0].currentPp
  preventOpponentAction(state)
  state = turn(state)
  assert.equal(state.opponent.activeIndex, 1)
  assert.equal(state.opponent.team[1].moves[0].currentPp, replacementPp)
  assert(state.log.some((entry) => entry.message.includes('위기회피')))
}

{
  let state = battle(
    [pokemon('smeargle', ['gigadrain'])],
    [pokemonWithAbility('해감액', ['protect'])],
  )
  state.player.team[0].hp -= 1
  state.opponent.team[0].hp = state.opponent.team[0].maxHp = 5000
  const hpBefore = state.player.team[0].hp
  preventOpponentAction(state)
  state = turn(state)
  assert(state.player.team[0].hp < hpBefore)
  assert(state.log.some((entry) => entry.message.includes('해감액')))
}

{
  let state = battle(
    [pokemon('smeargle', ['tackle'])],
    [pokemonWithAbility('전기로바꾸기', ['protect', 'thunderbolt'])],
  )
  preventOpponentAction(state)
  state = turn(state)
  assert.equal(state.opponent.team[0].chargeActive, true)
  state.player.team[0].rechargeTurns = 1
  const hpBefore = state.player.team[0].hp
  state = turn(state, undefined, { type: 'move', moveIndex: 1 })
  assert(state.player.team[0].hp < hpBefore)
  assert.equal(state.opponent.team[0].chargeActive, false)
}

{
  let state = battle(
    [pokemonWithAbility('메가솔라', ['solarbeam'])],
    [pokemon('smeargle', ['protect'])],
  )
  state.rules.weather = { id: 'rain', label: '비' }
  state.opponent.team[0].hp = state.opponent.team[0].maxHp = 5000
  preventOpponentAction(state)
  state = turn(state)
  assert(state.opponent.team[0].hp < 5000)
  assert.equal(state.player.team[0].chargingMove, null)
}

{
  const shadowShieldDamage = damageWithEntries({
    attacker: pokemon('smeargle', ['shadowball']),
    defender: pokemonWithAbility('스펙터가드', ['protect']),
  })
  const baselineDamage = damageWithEntries({
    attacker: pokemon('smeargle', ['shadowball']),
    defender: pokemonWithAbility('스펙터가드', ['protect']),
    mutate: (state) => { state.opponent.team[0].ability = '정신력' },
  })
  assert(shadowShieldDamage < baselineDamage * 0.6)

  const parentalBondDamage = damageWithEntries({
    attacker: pokemonWithAbility('부자유친', ['icepunch']),
    defender: pokemon('smeargle', ['protect']),
  })
  const singleHitDamage = damageWithEntries({
    attacker: pokemonWithAbility('부자유친', ['icepunch']),
    defender: pokemon('smeargle', ['protect']),
    mutate: (state) => { state.player.team[0].ability = '배짱' },
  })
  assert(parentalBondDamage > singleHitDamage * 1.15)
}

{
  let state = battle(
    [pokemon('smeargle', ['bite'], { ability: '마이페이스' })],
    [pokemonWithAbility('미라', ['protect'])],
  )
  preventOpponentAction(state)
  state = turn(state)
  assert.equal(state.player.team[0].ability, '미라')

  state = battle(
    [pokemon('smeargle', ['bite'])],
    [pokemonWithAbility('멸망의바디', ['protect'])],
  )
  state.opponent.team[0].hp = state.opponent.team[0].maxHp = 5000
  preventOpponentAction(state)
  state = turn(state)
  assert.equal(state.player.team[0].perishCount, 3)
  assert.equal(state.opponent.team[0].perishCount, 3)
}

{
  let state = battle(
    [pokemonWithAbility('매지션', ['tackle'])],
    [pokemon('smeargle', ['protect'], { heldItemId: 'leftovers', heldItemName: '먹다남은음식' })],
  )
  preventOpponentAction(state)
  state = turn(state)
  assert.equal(state.player.team[0].heldItemId, 'leftovers')
  assert.equal(state.opponent.team[0].heldItemId, '')

  state = battle(
    [pokemon('smeargle', ['bite'])],
    [pokemonWithAbility('주눅', ['protect'])],
  )
  preventOpponentAction(state)
  state = turn(state)
  assert.equal(state.opponent.team[0].statStages.speed, 1)
}

{
  let state = battle(
    [pokemon('smeargle', ['tackle'])],
    [pokemonWithAbility('컬리헤어', ['protect'])],
  )
  preventOpponentAction(state)
  state = turn(state)
  assert.equal(state.player.team[0].statStages.speed, -1)

  state = battle(
    [pokemon('smeargle', ['tackle'], { gender: 'male' })],
    [pokemonWithAbility('헤롱헤롱바디', ['protect'], { gender: 'female' })],
  )
  preventOpponentAction(state)
  state = turn(state, undefined, undefined, () => 0.1)
  assert.equal(state.player.team[0].infatuated, true)
}

{
  let state = battle(
    [pokemonWithAbility('보이지않는주먹', ['drainpunch'])],
    [pokemon('smeargle', ['protect'])],
  )
  const hpBefore = state.opponent.team[0].hp
  state = turn(state)
  assert(state.opponent.team[0].hp < hpBefore)

  state = battle(
    [pokemonWithAbility('균사의힘', ['spore'])],
    [pokemonWithAbility('황금몸', ['protect'])],
  )
  preventOpponentAction(state)
  state = turn(state)
  assert.equal(state.opponent.team[0].status?.id, 'sleep')
}

{
  let state = battle(
    [pokemonWithAbility('무아지경', ['tackle', 'icepunch'])],
    [pokemon('smeargle', ['protect'])],
  )
  const attacker = state.player.team[0]
  assert.equal(getEffectiveBattleStat(state, attacker, 'attack'), attacker.stats.attack * 1.5)
  preventOpponentAction(state)
  state = turn(state)
  const secondMovePp = state.player.team[0].moves[1].currentPp
  preventOpponentAction(state)
  state = turn(state, { type: 'move', moveIndex: 1 })
  assert.equal(state.player.team[0].moves[1].currentPp, secondMovePp)
  assert(state.log.some((entry) => entry.message.includes('무아지경 때문에')))
}

{
  let state = battle(
    [pokemonWithAbility('볼주머니', ['protect'], { heldItemId: 'sitrus-berry', heldItemName: '자뭉열매' })],
    [pokemon('smeargle', ['protect'])],
  )
  const pokemonWithPouch = state.player.team[0]
  pokemonWithPouch.hp = Math.floor(pokemonWithPouch.maxHp / 2)
  const hpBefore = pokemonWithPouch.hp
  state = turn(state)
  assert.equal(state.player.team[0].consumedItem, true)
  assert(state.player.team[0].hp > hpBefore + Math.floor(pokemonWithPouch.maxHp / 4))

  state = battle(
    [pokemonWithAbility('먹보', ['protect'], { heldItemId: 'salac-berry', heldItemName: '캄라열매' })],
    [pokemon('smeargle', ['protect'])],
  )
  state.player.team[0].hp = Math.floor(state.player.team[0].maxHp * 0.4)
  state = turn(state)
  assert.equal(state.player.team[0].consumedItem, true)
  assert.equal(state.player.team[0].statStages.speed, 1)
}

{
  let state = battle(
    [pokemonWithAbility('일루전', ['protect']), pokemon('snorlax', ['protect'])],
    [pokemon('smeargle', ['tackle'])],
  )
  const actualName = state.player.team[0].illusionSnapshot?.name
  assert(actualName)
  assert.equal(state.player.team[0].name, state.player.team[1].name)
  state.player.team[0].rechargeTurns = 1
  state = turn(state)
  assert.equal(state.player.team[0].name, actualName)
  assert.equal(state.player.team[0].illusionSnapshot, null)
  assert(state.log.some((entry) => entry.message.includes('일루전이 깨졌다')))
}

{
  let state = battle(
    [pokemon('smeargle', ['swordsdance'])],
    [pokemonWithAbility('무희', ['protect'])],
  )
  preventOpponentAction(state)
  state = turn(state)
  assert.equal(state.player.team[0].statStages.attack, 2)
  assert.equal(state.opponent.team[0].statStages.attack, 2)
  assert(state.log.some((entry) => entry.message.includes('무희')))
}

{
  const lightMetalState = battle(
    [pokemon('smeargle', ['tackle'])],
    [pokemon('scizor', ['protect'], { ability: '라이트메탈' })],
  )
  replaceRuntimeMove(lightMetalState, 'player', 0, 0, 'lowkick')
  assert.equal(getBattleMovePreview(lightMetalState, 'player', 0).power, 80)

  const moldBreakerState = battle(
    [pokemon('excadrill', ['scratch'], { ability: '틀깨기' })],
    [pokemon('scizor', ['protect'], { ability: '라이트메탈' })],
  )
  replaceRuntimeMove(moldBreakerState, 'player', 0, 0, 'lowkick')
  assert.equal(getBattleMovePreview(moldBreakerState, 'player', 0).power, 100)

  let dynamaxState = preventOpponentAction(battle(
    [pokemon('smeargle', ['tackle'])],
    [pokemon('metagross', ['protect'])],
  ))
  replaceRuntimeMove(dynamaxState, 'player', 0, 0, 'lowkick')
  dynamaxState.opponent.team[0].dynamaxActive = true
  dynamaxState.opponent.team[0].dynamaxTurns = 3
  dynamaxState.opponent.team[0].maxHp *= 2
  dynamaxState.opponent.team[0].hp *= 2
  const hpBefore = dynamaxState.opponent.team[0].hp
  dynamaxState = turn(dynamaxState)
  assert.equal(dynamaxState.opponent.team[0].hp, hpBefore)
  assert(dynamaxState.log.some((entry) => entry.message.includes('거대해져서')))
}

{
  let state = preventOpponentAction(battle(
    [pokemon('smeargle', ['tackle'])],
    [pokemon('smeargle', ['protect'])],
  ))
  replaceRuntimeAbility(state, 'player', 0, '무도한행동')
  state.opponent.team[0].status = { id: 'poison', label: '독', toxicCounter: 0 }
  state = turn(state)
  assert(state.log.some((entry) => entry.message.includes('급소에 맞았다')))

  state = preventOpponentAction(battle(
    [pokemon('smeargle', ['toxic'])],
    [pokemon('pikachu', ['protect'])],
  ))
  replaceRuntimeAbility(state, 'player', 0, '독조종')
  state = turn(state)
  assert.equal(state.opponent.team[0].status?.id, 'toxic')
  assert(state.opponent.team[0].confusionTurns > 0)
}

{
  let state = preventOpponentAction(battle(
    [pokemon('smeargle', ['toxic'])],
    [pokemonWithAbility('미라클스킨', ['protect'])],
  ))
  state = turn(state, undefined, undefined, () => 0.6)
  assert.equal(state.opponent.team[0].status, null)

  state = preventOpponentAction(battle(
    [pokemon('smeargle', ['tackle'], { gender: 'male' })],
    [pokemonWithAbility('둔감', ['protect'], { gender: 'female' })],
  ))
  replaceRuntimeMove(state, 'player', 0, 0, 'attract')
  state = turn(state)
  assert.equal(state.opponent.team[0].infatuated, false)
}

{
  const state = battle(
    [
      pokemon('plusle', ['protect'], { ability: '플러스' }),
      pokemon('minun', ['protect'], { ability: '마이너스' }),
    ],
    [pokemon('smeargle', ['protect']), pokemon('snorlax', ['protect'])],
    rules({ activeSlots: 2 }),
  )
  const plusle = state.player.team[0]
  assert.equal(getEffectiveBattleStat(state, plusle, 'specialAttack'), plusle.stats.specialAttack * 1.5)
}

{
  let state = battle(
    [
      pokemon('smeargle', ['protect']),
      pokemon('snorlax', ['protect']),
      pokemonWithAbility('기묘한약', ['protect']),
    ],
    [pokemon('smeargle', ['protect']), pokemon('snorlax', ['protect'])],
    rules({ activeSlots: 2 }),
  )
  state.player.team[0].statStages.attack = 3
  state.opponent.team.forEach((entry) => { entry.rechargeTurns = 1 })
  state = turnActions(
    state,
    [
      { type: 'move', actorSlot: 0, targetSlot: 0, moveIndex: 0 },
      { type: 'switch', actorSlot: 1, targetIndex: 2 },
    ],
    [
      { type: 'move', actorSlot: 0, targetSlot: 0, moveIndex: 0 },
      { type: 'move', actorSlot: 1, targetSlot: 0, moveIndex: 0 },
    ],
  )
  assert.equal(state.player.team[0].statStages.attack, 0)

  state = battle(
    [
      pokemon('smeargle', ['protect']),
      pokemon('snorlax', ['protect']),
      pokemonWithAbility('협연', ['protect']),
    ],
    [pokemon('smeargle', ['protect']), pokemon('snorlax', ['protect'])],
    rules({ activeSlots: 2 }),
  )
  state.player.team[0].statStages.specialAttack = 4
  state.opponent.team.forEach((entry) => { entry.rechargeTurns = 1 })
  state = turnActions(
    state,
    [
      { type: 'move', actorSlot: 0, targetSlot: 0, moveIndex: 0 },
      { type: 'switch', actorSlot: 1, targetIndex: 2 },
    ],
    [
      { type: 'move', actorSlot: 0, targetSlot: 0, moveIndex: 0 },
      { type: 'move', actorSlot: 1, targetSlot: 0, moveIndex: 0 },
    ],
  )
  assert.equal(state.player.team[2].statStages.specialAttack, 4)

  state = battle(
    [
      pokemon('smeargle', ['protect']),
      pokemon('snorlax', ['protect']),
      pokemonWithAbility('대접', ['protect']),
    ],
    [pokemon('smeargle', ['protect']), pokemon('snorlax', ['protect'])],
    rules({ activeSlots: 2 }),
  )
  state.player.team[0].hp = 1
  state.opponent.team.forEach((entry) => { entry.rechargeTurns = 1 })
  state = turnActions(
    state,
    [
      { type: 'move', actorSlot: 0, targetSlot: 0, moveIndex: 0 },
      { type: 'switch', actorSlot: 1, targetIndex: 2 },
    ],
    [
      { type: 'move', actorSlot: 0, targetSlot: 0, moveIndex: 0 },
      { type: 'move', actorSlot: 1, targetSlot: 0, moveIndex: 0 },
    ],
  )
  assert(state.player.team[0].hp > 1)
}

{
  const strongestMoveName = getMoveById('hyperbeam').name
  const state = battle(
    [pokemonWithAbility('예지몽', ['protect'])],
    [pokemon('smeargle', ['tackle', 'hyperbeam'])],
  )
  assert(state.log.some((entry) => entry.message.includes('예지몽') && entry.message.includes(strongestMoveName)))
}

{
  let state = battle(
    [
      pokemonWithAbility('리시버', ['protect']),
      pokemon('smeargle', ['protect'], { ability: '천하장사' }),
    ],
    [pokemon('smeargle', ['tackle']), pokemon('snorlax', ['protect'])],
    rules({ activeSlots: 2 }),
  )
  state.player.team[1].hp = 0
  replaceRuntimeAbility(state, 'player', 1, '천하장사')
  state.player.team[1].rechargeTurns = 1
  state.opponent.team[0].stats.speed = 999
  state.opponent.team[1].rechargeTurns = 1
  state = turnActions(
    state,
    [
      { type: 'move', actorSlot: 0, targetSlot: 0, moveIndex: 0 },
      { type: 'move', actorSlot: 1, targetSlot: 0, moveIndex: 0 },
    ],
    [
      { type: 'move', actorSlot: 0, targetSlot: 1, moveIndex: 0 },
      { type: 'move', actorSlot: 1, targetSlot: 0, moveIndex: 0 },
    ],
  )
  assert.equal(state.player.team[0].ability, '천하장사')

  state = battle(
    [pokemon('dondozo', ['protect']), pokemonWithAbility('사령탑', ['protect'])],
    [pokemon('smeargle', ['protect']), pokemon('snorlax', ['protect'])],
    rules({ activeSlots: 2 }),
  )
  assert.equal(state.player.team[1].commanding, true)
  assert.equal(state.player.team[0].commandedByBattleId, state.player.team[1].battleId)
  assert.equal(state.player.team[0].statStages.attack, 2)
  assert.equal(state.player.team[0].statStages.speed, 2)
}

{
  let state = battle(
    [
      pokemon('smeargle', ['thunderbolt']),
      pokemon('snorlax', ['protect']),
    ],
    [
      pokemon('smeargle', ['protect']),
      pokemon('rhyperior', ['protect'], { ability: '피뢰침' }),
    ],
    rules({ activeSlots: 2 }),
  )
  state.opponent.team.forEach((entry) => { entry.rechargeTurns = 1 })
  const requestedSlot = state.opponent.activeIndexes.findIndex((teamIndex) => (
    state.opponent.team[teamIndex].ability !== '피뢰침'
  ))
  const lightningRodSlot = state.opponent.activeIndexes.findIndex((teamIndex) => (
    state.opponent.team[teamIndex].ability === '피뢰침'
  ))
  const requestedTeamIndex = state.opponent.activeIndexes[requestedSlot]
  const lightningRodTeamIndex = state.opponent.activeIndexes[lightningRodSlot]
  const requestedTargetHp = state.opponent.team[requestedTeamIndex].hp
  state = turnActions(
    state,
    [
      { type: 'move', actorSlot: 0, targetSlot: requestedSlot, moveIndex: 0 },
      { type: 'move', actorSlot: 1, targetSlot: 0, moveIndex: 0 },
    ],
    [
      { type: 'move', actorSlot: 0, targetSlot: 0, moveIndex: 0 },
      { type: 'move', actorSlot: 1, targetSlot: 0, moveIndex: 0 },
    ],
  )
  assert.equal(state.opponent.team[requestedTeamIndex].hp, requestedTargetHp)
  assert.equal(state.opponent.team[lightningRodTeamIndex].statStages.specialAttack, 1)

  state = battle(
    [
      pokemon('smeargle', ['thunderbolt']),
      pokemon('snorlax', ['protect']),
    ],
    [
      pokemon('smeargle', ['protect']),
      pokemon('rhyperior', ['protect'], { ability: '피뢰침' }),
    ],
    rules({ activeSlots: 2 }),
  )
  replaceRuntimeAbility(state, 'player', 0, '굳건한신념')
  state.opponent.team.forEach((entry) => { entry.rechargeTurns = 1 })
  const directTargetSlot = state.opponent.activeIndexes.findIndex((teamIndex) => (
    state.opponent.team[teamIndex].ability !== '피뢰침'
  ))
  const directTargetTeamIndex = state.opponent.activeIndexes[directTargetSlot]
  const directTargetHp = state.opponent.team[directTargetTeamIndex].hp
  state = turnActions(
    state,
    [
      { type: 'move', actorSlot: 0, targetSlot: directTargetSlot, moveIndex: 0 },
      { type: 'move', actorSlot: 1, targetSlot: 0, moveIndex: 0 },
    ],
    [
      { type: 'move', actorSlot: 0, targetSlot: 0, moveIndex: 0 },
      { type: 'move', actorSlot: 1, targetSlot: 0, moveIndex: 0 },
    ],
  )
  assert(
    state.opponent.team[directTargetTeamIndex].hp < directTargetHp,
    state.log.map((entry) => entry.message).join(' | '),
  )
}

{
  let state = preventOpponentAction(battle(
    [pokemon('smeargle', ['tackle'], {
      heldItemId: 'leftovers',
      heldItemName: '먹다남은음식',
    })],
    [pokemonWithAbility('나쁜손버릇', ['protect'])],
  ))
  state = turn(state)
  assert.equal(state.opponent.team[0].heldItemId, 'leftovers')
  assert.equal(state.player.team[0].heldItemId, '')

  state = preventOpponentAction(battle(
    [pokemon('smeargle', ['bite'], { ability: '마이페이스' })],
    [pokemonWithAbility('떠도는영혼', ['protect'])],
  ))
  state = turn(state)
  assert.equal(state.player.team[0].ability, '떠도는영혼')
  assert.equal(state.opponent.team[0].ability, '마이페이스')
}

{
  let state = preventOpponentAction(battle(
    [pokemon('butterfree', ['gust'])],
    [pokemonWithAbility('풍력발전', ['protect'])],
  ))
  state = turn(state)
  assert.equal(state.opponent.team[0].chargeActive, true)

  state = battle(
    [pokemonWithAbility('악취', ['tackle'])],
    [pokemon('smeargle', ['tackle'])],
  )
  state.player.team[0].stats.speed = 999
  state.opponent.team[0].hp = state.opponent.team[0].maxHp = 5000
  const opponentPp = state.opponent.team[0].moves[0].currentPp
  state = turn(state, undefined, undefined, () => 0.05)
  assert.equal(state.opponent.team[0].moves[0].currentPp, opponentPp)
  assert(state.log.some((entry) => entry.message.includes('풀죽어서')))
}

{
  let state = battle(
    [pokemonWithAbility('숙성', ['protect'], { heldItemId: 'sitrus-berry', heldItemName: '자뭉열매' })],
    [pokemon('smeargle', ['protect'])],
  )
  const ripenPokemon = state.player.team[0]
  ripenPokemon.hp = 1
  state = turn(state)
  assert.equal(state.player.team[0].hp, 1 + Math.floor(ripenPokemon.maxHp / 2))

  state = battle(
    [pokemonWithAbility('되새김질', ['protect'], { heldItemId: 'sitrus-berry', heldItemName: '자뭉열매' })],
    [pokemon('smeargle', ['protect'])],
  )
  state.player.team[0].hp = 1
  state = turn(state)
  state.player.team[0].hp = 1
  state = turn(state)
  assert(state.player.team[0].hp > 1)
  assert(state.log.some((entry) => entry.message.includes('되새김질')))
}

{
  let state = battle(
    [
      pokemon('smeargle', ['protect'], { heldItemId: 'sitrus-berry', heldItemName: '자뭉열매' }),
      pokemonWithAbility('공생', ['protect'], { heldItemId: 'leftovers', heldItemName: '먹다남은음식' }),
    ],
    [pokemon('smeargle', ['protect']), pokemon('snorlax', ['protect'])],
    rules({ activeSlots: 2 }),
  )
  state.player.team[0].hp = 1
  state = turnActions(
    state,
    [
      { type: 'move', actorSlot: 0, targetSlot: 0, moveIndex: 0 },
      { type: 'move', actorSlot: 1, targetSlot: 0, moveIndex: 0 },
    ],
    [
      { type: 'move', actorSlot: 0, targetSlot: 0, moveIndex: 0 },
      { type: 'move', actorSlot: 1, targetSlot: 0, moveIndex: 0 },
    ],
  )
  assert.equal(state.player.team[0].heldItemId, 'leftovers')
  assert.equal(state.player.team[1].heldItemId, '')

  state = battle(
    [
      pokemon('smeargle', ['protect'], { heldItemId: 'sitrus-berry', heldItemName: '자뭉열매' }),
      pokemonWithAbility('픽업', ['protect']),
    ],
    [pokemon('smeargle', ['protect']), pokemon('snorlax', ['protect'])],
    rules({ activeSlots: 2 }),
  )
  state.player.team[0].hp = 1
  state = turnActions(
    state,
    [
      { type: 'move', actorSlot: 0, targetSlot: 0, moveIndex: 0 },
      { type: 'move', actorSlot: 1, targetSlot: 0, moveIndex: 0 },
    ],
    [
      { type: 'move', actorSlot: 0, targetSlot: 0, moveIndex: 0 },
      { type: 'move', actorSlot: 1, targetSlot: 0, moveIndex: 0 },
    ],
  )
  assert.equal(state.player.team[1].heldItemId, 'sitrus-berry')
}

{
  let state = battle(
    [
      pokemon('smeargle', ['protect']),
      pokemonWithAbility('치유의마음', ['protect']),
    ],
    [pokemon('smeargle', ['protect']), pokemon('snorlax', ['protect'])],
    rules({ activeSlots: 2 }),
  )
  state.player.team[0].status = { id: 'poison', label: '독', toxicCounter: 0 }
  state = turnActions(
    state,
    [
      { type: 'move', actorSlot: 0, targetSlot: 0, moveIndex: 0 },
      { type: 'move', actorSlot: 1, targetSlot: 0, moveIndex: 0 },
    ],
    [
      { type: 'move', actorSlot: 0, targetSlot: 0, moveIndex: 0 },
      { type: 'move', actorSlot: 1, targetSlot: 0, moveIndex: 0 },
    ],
    () => 0.1,
  )
  assert.equal(state.player.team[0].status, null)
}

{
  for (const ability of ['파수견', '흡반']) {
    let state = battle(
      [pokemon('ivysaur', ['roar'])],
      [pokemonWithAbility(ability, ['protect']), pokemon('snorlax', ['protect'])],
    )
    const abilityIndex = state.opponent.team.findIndex((entry) => entry.ability === ability)
    state.opponent.activeIndex = abilityIndex
    state.opponent.activeIndexes = [abilityIndex]
    preventOpponentAction(state)
    state = turn(state)
    assert.equal(state.opponent.activeIndex, abilityIndex)
    assert(
      state.log.some((entry) => entry.message.includes('강제 교체를 막아냈다')),
      `${ability}: ${state.log.map((entry) => entry.message).join(' | ')}`,
    )
  }
}

{
  let state = battle(
    [pokemon('excadrill-mega', ['bodyslam'], { ability: '관통드릴' })],
    [pokemon('smeargle', ['protect'])],
  )
  const hpBefore = state.opponent.team[0].hp
  state = turn(state)
  assert(state.opponent.team[0].hp < hpBefore)
  assert(state.log.some((entry) => entry.message.includes('관통드릴')))
}

{
  let state = battle(
    [pokemonWithAbility('퀵드로', ['tackle'])],
    [pokemon('smeargle', ['tackle'])],
  )
  state.player.team[0].stats.speed = 1
  state.opponent.team[0].stats.speed = 999
  const logStart = state.log.length
  state = turn(state, undefined, undefined, () => 0.1)
  const moveLogs = state.log.slice(logStart).filter((entry) => entry.message.endsWith('몸통박치기!'))
  assert(moveLogs[0]?.message.startsWith(state.player.team[0].name))
  assert(state.log.some((entry) => entry.message.includes('퀵드로')))

  state = battle(
    [pokemonWithAbility('시간벌기', ['scratch'])],
    [pokemon('smeargle', ['tackle'])],
  )
  state.player.team[0].stats.speed = 999
  state.opponent.team[0].stats.speed = 1
  const stallLogStart = state.log.length
  const opponentName = state.opponent.team[0].name
  state = turn(state)
  const firstMoveLog = state.log.slice(stallLogStart).find((entry) => (
    entry.message.endsWith('할퀴기!') || entry.message.endsWith('몸통박치기!')
  ))
  assert(firstMoveLog?.message.startsWith(opponentName))
}

const intentionallyBattleNeutralAbilities = new Set(['꿀모으기', '도주', '볼줍기'])
const battleAbilitySource = [
  '../src/data/abilitySupportData.js',
  '../src/data/battleEngine.js',
].map((relativePath) => readFileSync(new URL(relativePath, import.meta.url), 'utf8')).join('\n')
const unclassifiedAbilities = Object.keys(pokemonData.abilities).filter((ability) => (
  !intentionallyBattleNeutralAbilities.has(ability) && !battleAbilitySource.includes(ability)
))
assert.deepEqual(unclassifiedAbilities, [], `Unclassified battle abilities: ${unclassifiedAbilities.join(', ')}`)

console.log(`Validated shared battle ability effects and classified ${Object.keys(pokemonData.abilities).length} abilities.`)
