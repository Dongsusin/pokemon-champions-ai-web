import assert from 'node:assert/strict'
import pokemonData from '../src/data/generatedPokemonData.json' with { type: 'json' }
import {
  createBattle,
  getAvailableBattleMechanics,
  playBattleTurnWithActions,
} from '../src/data/battleEngine.js'
import {
  createBattleMatchRules,
  normalizeAiBattleDifficulty,
} from '../src/data/battleRules.js'
import { getMoveById } from '../src/data/trainingData.js'

const profiles = [...pokemonData.species, ...pokemonData.forms]
const profileBySlug = new Map(profiles.map((profile) => [profile.slug, profile]))
const stageStats = ['attack', 'defense', 'specialAttack', 'specialDefense', 'speed', 'accuracy', 'evasion']

function battlePokemon(slug, moveIds, overrides = {}) {
  const profile = profileBySlug.get(slug)
  assert(profile, `Missing species fixture: ${slug}`)
  const moves = moveIds.map((moveId) => {
    const move = getMoveById(moveId)
    assert(move, `Missing move fixture: ${moveId}`)
    return move
  })

  return {
    captureId: `difficulty-${slug}-${overrides.captureId ?? 'default'}`,
    speciesId: profile.id,
    slug: profile.slug,
    ability: profile.abilities[0],
    moves: moves.map((move) => move.name),
    moveIds: moves.map((move) => move.id),
    ...overrides,
  }
}

function battleRules(difficulty) {
  return {
    weather: { id: 'clear', label: '맑음' },
    terrain: { id: 'neutral', label: '일반 필드' },
    format: { id: 'single', label: '싱글배틀', activeSlots: 1, actionSlots: 1 },
    teamRule: { id: 'full', label: '6대6', battleSize: 2 },
    disabledGimmickId: null,
    gimmickRestriction: { id: null, label: '제한 없음' },
    aiDifficulty: normalizeAiBattleDifficulty(difficulty),
  }
}

function createDifficultyBattle(difficulty) {
  return createBattle({
    playerPokemon: [battlePokemon('magikarp', ['splash'], { captureId: 'player' })],
    opponent: { name: '난이도 검증 AI', tier: 'S' },
    opponentTeam: {
      pokemon: [
        battlePokemon('charizard', ['dragondance'], {
          captureId: 'charizard',
          heldItemId: 'charizardite-x',
          heldItemName: '리자몽나이트X',
          teraType: '불꽃',
          dynamaxMode: 'dynamax',
          battleMechanics: ['mega-evolution', 'terastallization', 'dynamax'],
        }),
        battlePokemon('snorlax', ['protect'], {
          captureId: 'snorlax',
          heldItemId: 'leftovers',
          heldItemName: '먹다남은음식',
        }),
      ],
      battleGimmicks: [],
      strategy: { lead: '리자몽' },
    },
    rules: battleRules(difficulty),
  })
}

assert.equal(normalizeAiBattleDifficulty().id, 'normal')
assert.equal(normalizeAiBattleDifficulty({ id: 'hard', boostStage: -5 }).boostStage, 1)
assert.equal(normalizeAiBattleDifficulty({ id: 'hard', boostStage: 99 }).boostStage, 3)
assert.equal(createBattleMatchRules(() => 0.5).aiDifficulty.id, 'normal')

{
  const battle = createDifficultyBattle('easy')
  battle.opponent.team.forEach((pokemon) => {
    assert.equal(pokemon.heldItemId, '')
    assert.equal(pokemon.heldItemName, '')
    assert.equal(pokemon.hadHeldItem, false)
    assert.deepEqual(pokemon.battleMechanics, [])
  })
  assert.deepEqual(getAvailableBattleMechanics(battle, 'opponent', 0), [])
  assert(battle.log.some((entry) => entry.message.includes('이지 난이도')))
}

{
  const battle = createDifficultyBattle('normal')
  assert.equal(battle.opponent.team[0].heldItemId, 'charizardite-x')
  assert.equal(battle.opponent.team[1].heldItemId, 'leftovers')
  const mechanics = getAvailableBattleMechanics(battle, 'opponent', 0)
    .map((mechanic) => mechanic.id)
  assert(mechanics.includes('mega'))
  assert(mechanics.includes('tera'))
  assert(mechanics.includes('dynamax'))
  battle.opponent.team.forEach((pokemon) => {
    stageStats.forEach((statKey) => assert.equal(pokemon.statStages[statKey], 0))
  })
}

{
  let battle = createDifficultyBattle({ id: 'hard', boostStage: 3 })
  battle.opponent.team.forEach((pokemon) => {
    stageStats.forEach((statKey) => assert.equal(pokemon.statStages[statKey], 3))
  })
  stageStats.forEach((statKey) => assert.equal(battle.player.team[0].statStages[statKey], 0))
  assert.equal(battle.opponent.team[0].heldItemId, 'charizardite-x')

  for (let turn = 0; turn < 4; turn += 1) {
    battle = playBattleTurnWithActions(
      battle,
      [{ type: 'move', actorSlot: 0, targetSlot: 0, moveIndex: 0, gimmick: null }],
      [{ type: 'move', actorSlot: 0, targetSlot: 0, moveIndex: 0, gimmick: null }],
      () => 0.5,
    )
  }

  assert.equal(battle.opponent.team[0].statStages.attack, 6)
  assert.equal(battle.opponent.team[0].statStages.speed, 6)
  assert(battle.log.some((entry) => entry.message.includes('하드 난이도')))
}

{
  let battle = createDifficultyBattle({ id: 'hard', boostStage: 2 })
  assert.equal(battle.opponent.team[1].difficultyBoostPending, true)
  battle = playBattleTurnWithActions(
    battle,
    [{ type: 'move', actorSlot: 0, targetSlot: 0, moveIndex: 0, gimmick: null }],
    [{ type: 'switch', actorSlot: 0, targetIndex: 1, targetSlot: 0, gimmick: null }],
    () => 0.5,
  )
  stageStats.forEach((statKey) => assert.equal(battle.opponent.team[1].statStages[statKey], 2))
  assert.equal(battle.opponent.team[1].difficultyBoostPending, false)

  battle = playBattleTurnWithActions(
    battle,
    [{ type: 'move', actorSlot: 0, targetSlot: 0, moveIndex: 0, gimmick: null }],
    [{ type: 'switch', actorSlot: 0, targetIndex: 0, targetSlot: 0, gimmick: null }],
    () => 0.5,
  )
  stageStats.forEach((statKey) => assert.equal(battle.opponent.team[0].statStages[statKey], 0))
}

console.log('Validated easy, normal, and adjustable hard AI battle difficulty rules.')
