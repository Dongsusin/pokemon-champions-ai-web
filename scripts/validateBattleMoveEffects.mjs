import assert from 'node:assert/strict'
import pokemonData from '../src/data/generatedPokemonData.json' with { type: 'json' }
import generatedBattleMoves from '../src/data/generatedBattleMoves.json' with { type: 'json' }
import {
  createBattle,
  playBattleTurnWithActions,
} from '../src/data/battleEngine.js'
import { SUPPORTED_VOLATILE_STATUS_IDS } from '../src/data/moveSupportData.js'
import { getMoveById } from '../src/data/trainingData.js'

const profiles = [...pokemonData.species, ...pokemonData.forms]
const profileBySlug = new Map(profiles.map((profile) => [profile.slug, profile]))
const supportedEffectKeys = new Set(['chance', 'status', 'volatileStatus', 'boosts', 'self'])
const supportedSelfEffectKeys = new Set(['boosts'])
const supportedStatusIds = new Set(['brn', 'par', 'psn', 'tox', 'slp', 'frz'])
const supportedMoveFlags = new Set([
  'allyanim',
  'bite',
  'bullet',
  'bypasssub',
  'cantusetwice',
  'charge',
  'contact',
  'dance',
  'defrost',
  'distance',
  'failcopycat',
  'failencore',
  'failinstruct',
  'failmefirst',
  'failmimic',
  'futuremove',
  'gravity',
  'heal',
  'metronome',
  'minimize',
  'mirror',
  'mustpressure',
  'noassist',
  'nonsky',
  'noparentalbond',
  'nosketch',
  'nosleeptalk',
  'pledgecombo',
  'powder',
  'protect',
  'pulse',
  'punch',
  'recharge',
  'reflectable',
  'slicing',
  'snatch',
  'sound',
  'wind',
])

function battlePokemon(slug, moveIds, overrides = {}) {
  const profile = profileBySlug.get(slug)
  const moves = moveIds.map((moveId) => getMoveById(moveId))
  assert(profile, `Missing species fixture: ${slug}`)
  moves.forEach((move, index) => assert(move, `Missing move fixture: ${moveIds[index]}`))

  return {
    captureId: `move-effects-${slug}-${Math.random()}`,
    speciesId: profile.id,
    slug: profile.slug,
    ability: profile.abilities[0],
    moves: moves.map((move) => move.name),
    moveIds,
    ...overrides,
  }
}

function singleBattle(playerPokemon, opponentPokemon) {
  return createBattle({
    playerPokemon: [playerPokemon],
    opponent: { name: 'MOVE EFFECT TEST' },
    opponentTeam: {
      pokemon: [opponentPokemon],
      battleGimmicks: [],
      strategy: {},
    },
  })
}

const fixedRandom = () => 0.5
const moveAction = (moveIndex = 0) => ({
  type: 'move',
  actorSlot: 0,
  targetSlot: 0,
  moveIndex,
  gimmick: null,
})
const splashAction = moveAction(0)

let effectCount = 0
for (const move of generatedBattleMoves.moves) {
  assert.deepEqual(
    move.flags.filter((flag) => !supportedMoveFlags.has(flag)),
    [],
    `${move.id} has an unclassified battle flag`,
  )
  const effects = move.secondaries ?? (move.secondary ? [move.secondary] : [])
  for (const effect of effects) {
    effectCount += 1
    const unsupportedKeys = Object.keys(effect).filter((key) => !supportedEffectKeys.has(key))
    assert.deepEqual(unsupportedKeys, [], `${move.id} has unsupported secondary keys`)
    if (effect.status) assert(supportedStatusIds.has(effect.status), `${move.id} has unsupported status ${effect.status}`)
    if (effect.volatileStatus) {
      assert(
        SUPPORTED_VOLATILE_STATUS_IDS.has(effect.volatileStatus),
        `${move.id} has unsupported volatile status ${effect.volatileStatus}`,
      )
    }
    if (effect.self) {
      const unsupportedSelfKeys = Object.keys(effect.self)
        .filter((key) => !supportedSelfEffectKeys.has(key))
      assert.deepEqual(unsupportedSelfKeys, [], `${move.id} has unsupported self-secondary keys`)
    }
  }
}
assert(effectCount >= 200, 'Expected the generated move catalog to contain all secondary-effect records')

let state = singleBattle(
  battlePokemon('primarina', ['sparklingaria']),
  battlePokemon('snorlax', ['splash']),
)
state.opponent.team[0].status = { id: 'burn', label: '화상', counter: 0, toxicCounter: 0 }
state = playBattleTurnWithActions(state, [moveAction()], [splashAction], fixedRandom)
assert.equal(state.opponent.team[0].status, null, 'Sparkling Aria should cure the target burn')

const saltCureBattle = singleBattle(
  battlePokemon('garganacl', ['saltcure']),
  battlePokemon('empoleon', ['splash']),
)
const saltCureControl = structuredClone(saltCureBattle)
saltCureControl.player.team[0].moves[0].secondary = null
const saltedState = playBattleTurnWithActions(
  saltCureBattle,
  [moveAction()],
  [splashAction],
  fixedRandom,
)
const saltControlState = playBattleTurnWithActions(
  saltCureControl,
  [moveAction()],
  [splashAction],
  fixedRandom,
)
assert.equal(saltedState.opponent.team[0].saltCureActive, true)
assert.equal(
  saltControlState.opponent.team[0].hp - saltedState.opponent.team[0].hp,
  Math.floor(saltedState.opponent.team[0].maxHp / 4),
  'Salt Cure should remove 1/4 max HP from Water- or Steel-type targets',
)

state = singleBattle(
  battlePokemon('dipplin', ['syrupbomb', 'splash']),
  battlePokemon('snorlax', ['splash']),
)
state = playBattleTurnWithActions(state, [moveAction(0)], [splashAction], fixedRandom)
assert.equal(state.opponent.team[0].statStages.speed, -1)
assert.equal(state.opponent.team[0].syrupBombTurns, 2)
state = playBattleTurnWithActions(state, [moveAction(1)], [splashAction], fixedRandom)
state = playBattleTurnWithActions(state, [moveAction(1)], [splashAction], fixedRandom)
assert.equal(state.opponent.team[0].statStages.speed, -3)
assert.equal(state.opponent.team[0].syrupBombTurns, 0)

state = singleBattle(
  battlePokemon('gardevoir', ['psychicnoise', 'calmmind']),
  battlePokemon('blissey', ['softboiled']),
)
state.opponent.team[0].hp = Math.floor(state.opponent.team[0].maxHp / 2)
state = playBattleTurnWithActions(state, [moveAction(0)], [moveAction(0)], fixedRandom)
const healBlockedHp = state.opponent.team[0].hp
assert.equal(state.opponent.team[0].healBlockTurns, 1)
assert(state.log.some((entry) => entry.message.includes('회복봉인 때문에')))
state = playBattleTurnWithActions(state, [moveAction(1)], [moveAction(0)], fixedRandom)
assert.equal(state.opponent.team[0].hp, healBlockedHp)
assert.equal(state.opponent.team[0].healBlockTurns, 0)
state = playBattleTurnWithActions(state, [moveAction(1)], [moveAction(0)], fixedRandom)
assert(state.opponent.team[0].hp > healBlockedHp, 'Recovery should work after Heal Block expires')

const covertCloakBattle = singleBattle(
  battlePokemon('pikachu', ['nuzzle']),
  battlePokemon('snorlax', ['splash'], { heldItemId: 'covert-cloak', heldItemName: '은밀망토' }),
)
state = playBattleTurnWithActions(covertCloakBattle, [moveAction()], [splashAction], fixedRandom)
assert.equal(state.opponent.team[0].status, null, 'Covert Cloak should block move secondary effects')

const sheerForceControlBattle = singleBattle(
  battlePokemon('nidoking', ['sludgebomb'], {
    ability: '독가시',
    heldItemId: 'life-orb',
    heldItemName: '생명의구슬',
  }),
  battlePokemon('blissey', ['calmmind']),
)
const sheerForceBattle = singleBattle(
  battlePokemon('nidoking', ['sludgebomb'], {
    ability: '우격다짐',
    heldItemId: 'life-orb',
    heldItemName: '생명의구슬',
  }),
  battlePokemon('blissey', ['calmmind']),
)
const sheerForceControlState = playBattleTurnWithActions(
  sheerForceControlBattle,
  [moveAction()],
  [splashAction],
  fixedRandom,
)
const sheerForceState = playBattleTurnWithActions(
  sheerForceBattle,
  [moveAction()],
  [splashAction],
  fixedRandom,
)
const normalSecondaryState = playBattleTurnWithActions(
  sheerForceControlBattle,
  [moveAction()],
  [splashAction],
  () => 0.1,
)
const sheerForceSecondaryState = playBattleTurnWithActions(
  sheerForceBattle,
  [moveAction()],
  [splashAction],
  () => 0.1,
)
const normalDamage = sheerForceControlBattle.opponent.team[0].hp - sheerForceControlState.opponent.team[0].hp
const sheerForceDamage = sheerForceBattle.opponent.team[0].hp - sheerForceState.opponent.team[0].hp
assert(sheerForceDamage > normalDamage, 'Sheer Force should boost moves with secondary effects')
assert.equal(normalSecondaryState.opponent.team[0].status?.id, 'poison')
assert.equal(
  sheerForceSecondaryState.opponent.team[0].status,
  null,
  'Sheer Force should suppress move secondary effects',
)
assert.equal(
  sheerForceState.player.team[0].hp,
  sheerForceState.player.team[0].maxHp,
  'Sheer Force-boosted moves should suppress Life Orb recoil',
)

const diamondStormFailure = singleBattle(
  battlePokemon('diancie', ['diamondstorm']),
  battlePokemon('snorlax', ['splash']),
)
const failedDiamondStormState = playBattleTurnWithActions(
  diamondStormFailure,
  [moveAction()],
  [splashAction],
  () => 0.75,
)
assert.equal(failedDiamondStormState.player.team[0].statStages.defense, 0)
const diamondStormSuccess = singleBattle(
  battlePokemon('diancie', ['diamondstorm']),
  battlePokemon('snorlax', ['splash']),
)
const successfulDiamondStormState = playBattleTurnWithActions(
  diamondStormSuccess,
  [moveAction()],
  [splashAction],
  () => 0.25,
)
assert.equal(successfulDiamondStormState.player.team[0].statStages.defense, 2)

state = singleBattle(
  battlePokemon('beedrill', ['twineedle']),
  battlePokemon('chansey', ['splash'], { ability: '자연회복' }),
)
let randomCall = 0
const secondHitSecondaryRandom = () => {
  const value = randomCall === 8 ? 0.1 : 0.5
  randomCall += 1
  return value
}
state = playBattleTurnWithActions(
  state,
  [moveAction()],
  [splashAction],
  secondHitSecondaryRandom,
)
assert.equal(state.opponent.team[0].status?.id, 'poison', 'Multi-hit moves should roll effects per hit')

const sereneGraceBattle = singleBattle(
  battlePokemon('togekiss', ['airslash'], { ability: '하늘의은총' }),
  battlePokemon('snorlax', ['splash']),
)
state = playBattleTurnWithActions(sereneGraceBattle, [moveAction()], [splashAction], fixedRandom)
assert(state.log.some((entry) => entry.message.includes('풀죽어서 움직일 수 없다')))

console.log(`Validated ${effectCount} generated secondary effects and 9 battle-effect interaction scenarios.`)
