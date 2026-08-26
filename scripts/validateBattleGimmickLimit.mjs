import assert from 'node:assert/strict'
import pokemonData from '../src/data/generatedPokemonData.json' with { type: 'json' }
import {
  createBattle,
  createBattleTurnTimeline,
  getAvailableBattleMechanics,
} from '../src/data/battleEngine.js'
import { getMoveById } from '../src/data/trainingData.js'

const profiles = [...pokemonData.species, ...pokemonData.forms]
const profileBySlug = new Map(profiles.map((profile) => [profile.slug, profile]))

function battlePokemon(slug, moveId, overrides = {}) {
  const profile = profileBySlug.get(slug)
  const move = getMoveById(moveId)
  assert(profile, `Missing species fixture: ${slug}`)
  assert(move, `Missing move fixture: ${moveId}`)

  return {
    captureId: `gimmick-limit-${slug}`,
    speciesId: profile.id,
    slug: profile.slug,
    ability: profile.abilities[0],
    moves: [move.name],
    moveIds: [move.id],
    ...overrides,
  }
}

const battle = createBattle({
  playerPokemon: [
    battlePokemon('charizard', 'dragondance', {
      heldItemId: 'charizardite-x',
      heldItemName: '리자몽나이트X',
      teraType: '불꽃',
      dynamaxMode: 'dynamax',
    }),
    battlePokemon('venusaur', 'protect', {
      teraType: '풀',
      dynamaxMode: 'dynamax',
    }),
  ],
  opponent: { name: 'GIMMICK LIMIT TEST' },
  opponentTeam: {
    pokemon: [
      battlePokemon('magikarp', 'splash', { captureId: 'gimmick-target-1' }),
      battlePokemon('magikarp', 'splash', { captureId: 'gimmick-target-2' }),
    ],
    battleGimmicks: [],
    strategy: {},
  },
  rules: {
    weather: { id: 'clear', label: '맑음' },
    terrain: { id: 'neutral', label: '일반 필드' },
    format: { id: 'double', label: '더블배틀', activeSlots: 2, actionSlots: 2 },
    teamRule: { id: 'full', label: '6대6', battleSize: 2 },
    disabledGimmickId: null,
    gimmickRestriction: { id: null, label: '제한 없음' },
  },
})

const initialCharizardMechanics = getAvailableBattleMechanics(battle, 'player', 0)
  .map((mechanic) => mechanic.id)
assert(initialCharizardMechanics.includes('mega'), 'Charizard should initially be able to Mega Evolve')
assert(initialCharizardMechanics.includes('tera'), 'Charizard should initially be able to Terastallize')
assert(initialCharizardMechanics.includes('dynamax'), 'Charizard should initially be able to Dynamax')

const firstTurn = createBattleTurnTimeline(battle, [
  { type: 'move', actorSlot: 0, targetSlot: 0, moveIndex: 0, gimmick: 'mega' },
  { type: 'move', actorSlot: 1, targetSlot: 1, moveIndex: 0, gimmick: null },
], () => 0.5)

const megaCharizard = firstTurn.state.player.team[0]
assert.equal(megaCharizard.usedBattleMechanicId, 'mega')
assert.equal(megaCharizard.name, '메가리자몽X')
assert.equal(getAvailableBattleMechanics(firstTurn.state, 'player', 0).length, 0)

const venusaurMechanics = getAvailableBattleMechanics(firstTurn.state, 'player', 1)
  .map((mechanic) => mechanic.id)
assert(venusaurMechanics.includes('tera'), 'A teammate should still be able to use a different gimmick')

const secondTurn = createBattleTurnTimeline(firstTurn.state, [
  { type: 'move', actorSlot: 0, targetSlot: 0, moveIndex: 0, gimmick: 'dynamax' },
  { type: 'move', actorSlot: 1, targetSlot: 1, moveIndex: 0, gimmick: 'tera' },
], () => 0.5)

const finalCharizard = secondTurn.state.player.team[0]
const finalVenusaur = secondTurn.state.player.team[1]
assert.equal(finalCharizard.usedBattleMechanicId, 'mega')
assert.equal(finalCharizard.dynamaxActive, false)
assert.equal(finalVenusaur.usedBattleMechanicId, 'tera')
assert.equal(finalVenusaur.teraActive, true)
assert(secondTurn.state.log.some((entry) => entry.message.includes('이미 메가진화')))
assert(!secondTurn.timeline.some((step) => (
  step.phase === 'gimmick'
    && step.sideId === 'player'
    && step.actorSlot === 0
    && step.mechanicId === 'dynamax'
)))

function createDynamaxNameBattle(slug, mode) {
  return createBattle({
    playerPokemon: [battlePokemon(slug, 'protect', { dynamaxMode: mode })],
    opponent: { name: 'DYNAMAX NAME TEST' },
    opponentTeam: {
      pokemon: [battlePokemon('magikarp', 'splash', { captureId: `dynamax-name-target-${mode}` })],
      battleGimmicks: [],
      strategy: {},
    },
    rules: {
      weather: { id: 'clear', label: '맑음' },
      terrain: { id: 'neutral', label: '일반 필드' },
      format: { id: 'single', label: '싱글배틀', activeSlots: 1, actionSlots: 1 },
      teamRule: { id: 'full', label: '6대6', battleSize: 1 },
      disabledGimmickId: null,
      gimmickRestriction: { id: null, label: '제한 없음' },
    },
  })
}

const dynamaxTurn = createBattleTurnTimeline(
  createDynamaxNameBattle('gyarados', 'dynamax'),
  [{ type: 'move', actorSlot: 0, targetSlot: 0, moveIndex: 0, gimmick: 'dynamax' }],
  () => 0.5,
)
assert.equal(dynamaxTurn.state.player.team[0].name, '다이맥스 갸라도스')
assert(dynamaxTurn.timeline.some((step) => step.phase === 'gimmick' && step.actorName === '다이맥스 갸라도스'))

const dynamaxSecondTurn = createBattleTurnTimeline(
  dynamaxTurn.state,
  [{ type: 'move', actorSlot: 0, targetSlot: 0, moveIndex: 0, gimmick: null }],
  () => 0.5,
)
const dynamaxFinalTurn = createBattleTurnTimeline(
  dynamaxSecondTurn.state,
  [{ type: 'move', actorSlot: 0, targetSlot: 0, moveIndex: 0, gimmick: null }],
  () => 0.5,
)
assert.equal(dynamaxFinalTurn.state.player.team[0].dynamaxActive, false)
assert.equal(dynamaxFinalTurn.state.player.team[0].name, '갸라도스')

const gigantamaxTurn = createBattleTurnTimeline(
  createDynamaxNameBattle('charizard', 'gigantamax'),
  [{ type: 'move', actorSlot: 0, targetSlot: 0, moveIndex: 0, gimmick: 'dynamax' }],
  () => 0.5,
)
assert.equal(gigantamaxTurn.state.player.team[0].name, '거다이맥스 리자몽')
assert(gigantamaxTurn.timeline.some((step) => step.phase === 'gimmick' && step.actorName === '거다이맥스 리자몽'))

console.log('Validated one battle gimmick per Pokemon while allowing different teammates to use other gimmicks.')
