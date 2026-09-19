import assert from 'node:assert/strict'
import test from 'node:test'
import {
  chooseAiActionsForSide,
  createBattle,
  createBattlePreviewPokemon,
  getActivePokemon,
  getAvailableBattleMechanics,
  playBattleTurnWithActions,
} from '../src/data/battleEngine.js'
import { BOSS_CHALLENGES, createBossChallengeBattle, createBossOpponent } from '../src/data/bossChallenge.js'
import { getLearnableMoves, getMoveById, getSpeciesProfile, normalizePokemon } from '../src/data/trainingData.js'

const random = () => 0.5
const action = (moveIndex, extra = {}) => ({ type: 'move', actorSlot: 0, targetSlot: 0, moveIndex, ...extra })
const party = Array.from({ length: 6 }, (_, index) => normalizePokemon({
  speciesId: 292,
  captureId: `boss-ai-shedinja-${index}`,
  ability: '불가사의부적',
  heldItemId: 'air-balloon',
  teraType: '전기',
  moves: ['protect', 'swordsdance', 'shadowsneak', 'xscissor'].map(id => getMoveById(id).name),
}))

function activateElectricTera(state) {
  const next = playBattleTurnWithActions(state, [action(0, { gimmick: 'tera' })], [], random)
  const target = next.player.team[0]
  assert.equal(target.teraActive, true)
  assert.deepEqual(target.types, ['전기'])
  assert.equal(target.heldItemId, 'air-balloon')
  assert.equal(target.consumedItem, false)
  assert.equal(target.maxHp, 1)
  assert.equal(target.hp, 1)
  return next
}

function singleBossSetBattle(entry, player = party[0]) {
  return createBattle({
    playerPokemon: [player],
    opponent: { name: '보스전 전술 검증', tier: 'S' },
    opponentTeam: { pokemon: [createBossOpponent(entry, 'boss-ai-counter')], battleGimmicks: [] },
    rules: {
      weather: { id: 'clear', label: '맑음' }, terrain: { id: 'neutral', label: '일반 필드' },
      format: { id: 'single', label: '싱글배틀', activeSlots: 1, actionSlots: 1 },
      teamRule: { id: 'full', label: '전체 출전', battleSize: 1 },
      gimmickRestriction: { id: null, label: '제한 없음' },
      aiDifficulty: { id: 'normal' }, aiDecisionLevel: 'hard',
    },
  })
}

test('all nine boss encounters opt into hard decisions without starting stat or HP boosts', () => {
  for (const challenge of BOSS_CHALLENGES) {
    for (const [roundIndex, encounter] of challenge.rounds.entries()) {
      const state = createBossChallengeBattle({ bossId: challenge.id, round: roundIndex + 1, party, random })
      assert.equal(state.rules.aiDecisionLevel, 'hard')
      assert.equal(state.rules.aiDifficulty.id, 'normal')
      assert.equal(state.rules.aiDifficulty.boostStage, 0)
      encounter.pokemon.forEach((entry, index) => {
        const opponent = state.opponent.team[index]
        const baseline = createBattlePreviewPokemon(createBossOpponent(entry, `baseline-${index}`))
        assert.equal(opponent.maxHp, baseline.maxHp)
        assert.deepEqual(opponent.stats, baseline.stats)
        assert.equal(opponent.difficultyBoostStage ?? 0, 0)
        assert.equal(opponent.difficultyHpMultiplier ?? 1, 1)
        assert(opponent.moves.length === 4 && opponent.moves.every(move => move.currentPp === move.maxPp))
        const legal = new Set(getLearnableMoves(entry.speciesId).map(move => move.id))
        assert(opponent.moves.every(move => legal.has(move.id)), `${challenge.id} round ${roundIndex + 1}: legal moves`)
        assert(getSpeciesProfile(entry.speciesId).abilities.includes(opponent.originalAbility))
        assert(opponent.heldItemId, `${opponent.name} has a held item`)
      })
      if (roundIndex < 2) {
        assert(state.opponent.team.some(pokemon => pokemon.battleMechanics.length > 0), 'trainer rounds can use gimmicks')
      } else {
        assert.deepEqual(getAvailableBattleMechanics(state, 'opponent', 0), [], 'final boss forms remain gate controlled')
      }
    }
  }
})

for (const challenge of BOSS_CHALLENGES) {
  test(`${challenge.id}: actual final-boss AI defeats Electric Tera + Air Balloon Shedinja with Toxic`, () => {
    const initial = createBossChallengeBattle({ bossId: challenge.id, round: 3, party, random })
    const state = activateElectricTera(initial)
    assert.equal(state.player.team[0].ability, '불가사의부적')
    const snapshot = structuredClone(state)
    const decisions = chooseAiActionsForSide(state, 'opponent', random)
    assert.deepEqual(state, snapshot, 'planning must not mutate live state')
    assert.equal(decisions.length, 1)
    assert.equal(decisions[0].type, 'move')
    const selectedMove = getActivePokemon(state, 'opponent').moves[decisions[0].moveIndex]
    assert.equal(selectedMove.id, 'toxic', 'the policy must choose its counter instead of an immune attack')
    assert.equal(decisions[0].gimmick ?? null, null, 'the counter must remain a status move')
    const next = playBattleTurnWithActions(state, [action(1)], decisions, random)
    assert.equal(next.player.team[0].hp, 0)
    assert.equal(next.player.team[0].fainted, true)
    assert.equal(next.player.team[0].status?.id, 'toxic')
    assert.equal(next.player.team[0].consumedItem, false, 'poison bypasses the combo without inventing a balloon pop')
    assert.equal(next.opponent.team[0].moves[decisions[0].moveIndex].currentPp, selectedMove.currentPp - 1)
  })
}

test('the configured Entei set chooses sandstorm to defeat the combo through indirect damage', () => {
  const entry = BOSS_CHALLENGES.find(challenge => challenge.id === 'hooh').rounds[1].pokemon.find(pokemon => pokemon.speciesId === 244)
  const state = activateElectricTera(singleBossSetBattle(entry))
  const decisions = chooseAiActionsForSide(state, 'opponent', random)
  assert.equal(state.opponent.team[0].moves[decisions[0].moveIndex].id, 'sandstorm')
  assert.equal(decisions[0].gimmick ?? null, null)
  const next = playBattleTurnWithActions(state, [action(1)], decisions, random)
  assert.equal(next.rules.weather.id, 'sandstorm')
  assert.equal(next.player.team[0].hp, 0)
  assert.equal(next.player.team[0].consumedItem, false)
})

test('the configured Neutralizing Gas Weezing set attacks through the suppressed Wonder Guard', () => {
  const entry = BOSS_CHALLENGES.find(challenge => challenge.id === 'mewtwo').rounds[0].pokemon.find(pokemon => pokemon.speciesId === 110)
  assert.equal(entry.ability, '화학변화가스')
  const state = activateElectricTera(singleBossSetBattle(entry))
  assert.equal(state.player.team[0].neutralizedAbility, '불가사의부적')
  assert.equal(state.player.team[0].ability, '')
  const decisions = chooseAiActionsForSide(state, 'opponent', random)
  const move = state.opponent.team[0].moves[decisions[0].moveIndex]
  assert(move.power > 0 && move.type !== '땅', 'select real non-Ground damage when Wonder Guard is suppressed')
  const next = playBattleTurnWithActions(state, [action(1)], decisions, random)
  assert.equal(next.player.team[0].hp, 0)
  assert.equal(next.player.team[0].consumedItem, true, 'a landed damaging hit must pop the balloon')
})

const gimmickMatchups = [
  { bossId: 'mewtwo', round: 2, speciesId: 115, mechanic: 'mega',
    playerSpeciesId: 143, playerMoves: ['bodyslam', 'earthquake', 'crunch', 'rest'] },
  { bossId: 'mewtwo', round: 1, speciesId: 24, mechanic: 'dynamax',
    playerSpeciesId: 9, playerMoves: ['hydropump', 'icebeam', 'scald', 'protect'] },
  { bossId: 'mewtwo', round: 1, speciesId: 24, mechanic: 'tera',
    playerSpeciesId: 249, playerMoves: ['aeroblast', 'psychic', 'icebeam', 'recover'] },
  { bossId: 'mewtwo', round: 1, speciesId: 469, mechanic: 'zmove', spentDynamax: true,
    playerSpeciesId: 249, playerMoves: ['psychic', 'icebeam', 'rest'] },
]

for (const matchup of gimmickMatchups) {
  test(`configured boss AI chooses and executes ${matchup.mechanic} when it improves its matchup`, () => {
    const entry = BOSS_CHALLENGES.find(challenge => challenge.id === matchup.bossId)
      .rounds[matchup.round - 1].pokemon.find(pokemon => pokemon.speciesId === matchup.speciesId)
    const learnable = new Set(getLearnableMoves(matchup.playerSpeciesId).map(move => move.id))
    assert(matchup.playerMoves.every(moveId => learnable.has(moveId)), 'the opposing fixture uses legal moves')
    const player = normalizePokemon({ speciesId: matchup.playerSpeciesId, captureId: 'gimmick-matchup-player',
      moves: matchup.playerMoves.map(moveId => getMoveById(moveId).name) })
    const state = singleBossSetBattle(entry, player)
    // A later team member can still use its Z crystal after the side spent Dynamax.
    if (matchup.spentDynamax) state.opponent.usedMechanics.dynamax = true
    assert(getAvailableBattleMechanics(state, 'opponent', 0).some(mechanic => mechanic.id === matchup.mechanic))
    const decisions = chooseAiActionsForSide(state, 'opponent', random)
    assert.equal(decisions[0].gimmick, matchup.mechanic)
    const next = playBattleTurnWithActions(state, [action(0)], decisions, random)
    assert.equal(next.opponent.usedMechanics[matchup.mechanic], true)
    assert.equal(next.opponent.team[0].usedBattleMechanicId, matchup.mechanic)
    assert(!getAvailableBattleMechanics(next, 'opponent', 0).some(mechanic => mechanic.id === matchup.mechanic))
  })
}

test('a normal non-boss battle keeps the existing difficulty and rule defaults', () => {
  const opponent = createBossOpponent({ speciesId: 150 }, 'normal-ai')
  const state = createBattle({
    playerPokemon: [party[0]],
    opponent: { name: '일반 대전 AI', tier: 'S' },
    opponentTeam: { pokemon: [opponent], battleGimmicks: [] },
  })
  assert.equal(state.rules.aiDecisionLevel, undefined)
  assert.equal(state.rules.aiDifficulty.id, 'normal')
  assert.equal(state.opponent.team[0].difficultyBoostStage ?? 0, 0)
})
