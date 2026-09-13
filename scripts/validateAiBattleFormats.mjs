import assert from 'node:assert/strict'
import { createBattle, getActivePokemonList } from '../src/data/battleEngine.js'
import { createBattleMatchRules, getPlayerBattleSelectionCount, selectPlayerBattlePokemon, selectOpponentBattlePokemon } from '../src/data/battleRules.js'
import { createCompetition, getCurrentCompetitionMatch, resolveCompetitionMatch } from '../src/data/competitionData.js'
import { selectCounterBattlePokemon } from '../src/data/aiTeamSelection.js'
import { getRankedFormat } from '../src/data/rankedRules.js'
import { normalizePokemon } from '../src/data/trainingData.js'
import { createRankedBattle } from '../server/rankedBattle.js'

const roster = [6, 9, 3, 25, 143, 149].map((speciesId, index) => normalizePokemon({ speciesId, captureId: `ai-format-${index}` }))
let passed = 0
const check = (name, run) => { run(); passed++; console.log(`PASS ${name}`) }
const random = () => 0.37

for (const formatId of ['single', 'double']) {
  const format = getRankedFormat(formatId)
  check(`${formatId}: chosen format and neutral opening do not depend on random or difficulty`, () => {
    for (const value of [0, 0.15, 0.5, 0.85, 0.999999]) {
      for (const difficulty of ['easy', 'normal', { id: 'hard', boostStage: 3 }]) {
        const rules = createBattleMatchRules(() => value, difficulty, formatId)
        assert.equal(rules.weather.id, 'clear')
        assert.equal(rules.terrain.id, 'neutral')
        assert.equal(rules.format.id, formatId)
        assert.equal(rules.format.activeSlots, format.activeSlots)
        assert.equal(rules.teamRule.battleSize, format.battleSize)
        assert.equal(rules.disabledGimmickId, null)
        assert.equal(rules.gimmickRestriction.id, null)
        assert.equal(rules.aiDifficulty.id, typeof difficulty === 'string' ? difficulty : difficulty.id)
        assert.equal(rules.aiDifficulty.boostStage, typeof difficulty === 'string' ? 0 : 3)
      }
    }
  })
  check(`${formatId}: exact selected roster and lead order match ranked battle size and active slots`, () => {
    const rules = createBattleMatchRules(random, 'normal', formatId)
    const chosenIds = [4, 2, 5, 1].slice(0, format.battleSize).map(index => roster[index].captureId)
    assert.equal(getPlayerBattleSelectionCount(rules, roster.length), format.battleSize)
    const selected = selectPlayerBattlePokemon(roster, rules, chosenIds)
    assert.deepEqual(selected.map(pokemon => pokemon.captureId), chosenIds)
    const counter = selectCounterBattlePokemon(roster, selected, rules)
    assert.equal(counter.length, format.battleSize)
    assert.equal(selectOpponentBattlePokemon(roster, rules).length, format.battleSize)
    const ai = createBattle({ playerPokemon: selected, opponent: { id: 'format-ai', name: 'AI 검증', tier: 'B' }, opponentTeam: { pokemon: counter, battleGimmicks: [] }, rules, random })
    const ranked = createRankedBattle({ playerTeam: selected, opponentTeam: counter, format: formatId, random })
    for (const sideId of ['player', 'opponent']) {
      assert.equal(ai[sideId].team.length, ranked[sideId].team.length)
      assert.equal(getActivePokemonList(ai, sideId).length, getActivePokemonList(ranked, sideId).length)
      assert(ai[sideId].team.every(pokemon => pokemon.level === 50))
    }
    assert.deepEqual(getActivePokemonList(ai, 'player').map(pokemon => pokemon.captureId), chosenIds.slice(0, format.activeSlots))
    assert.equal(ai.rules.weather.id, ranked.rules.weather.id)
    assert.equal(ai.rules.terrain.id, ranked.rules.terrain.id)
    assert.equal(ai.rules.gimmickRestriction.label, ranked.rules.gimmickRestriction.label)
  })
  for (const mode of ['tournament', 'league']) {
    check(`${mode} ${formatId}: all seven rounds retain format and reset opening rules`, () => {
      let competition = createCompetition(mode, roster, '검증 팀', 'normal', random, formatId)
      for (let round = 0; round < 7; round++) {
        assert.equal(competition.status, 'active')
        assert.equal(competition.battleFormat, formatId)
        const match = getCurrentCompetitionMatch(competition)
        assert.equal(match.rules.format.id, formatId)
        assert.equal(match.rules.teamRule.battleSize, format.battleSize)
        assert.equal(match.rules.weather.id, 'clear')
        assert.equal(match.rules.terrain.id, 'neutral')
        assert.equal(match.rules.disabledGimmickId, null)
        const before = structuredClone(competition)
        competition = resolveCompetitionMatch(competition, true, { winner: 'player', playerRemaining: format.battleSize, opponentRemaining: 0 }, () => 0.999999)
        assert(competition.roundHistory.at(-1).matches.every(result => result.winnerRemaining <= format.battleSize), 'Simulated AI matches must use the same roster limit and league differential as the player')
        assert.deepEqual(before.currentMatchRules, match.rules, 'Resolving a round must not mutate its previous rules')
      }
      assert.equal(competition.status, 'complete')
      assert.equal(competition.championId, 'player')
      assert.equal(competition.battleFormat, formatId)
    })
  }
}
check('Independent rule snapshots and legacy full-team lead selection remain intact', () => {
  const first = createBattleMatchRules(random)
  first.weather.id = 'rain'
  first.terrain.id = 'electric'
  const next = createBattleMatchRules(random)
  assert.equal(next.weather.id, 'clear')
  assert.equal(next.terrain.id, 'neutral')
  assert.equal(next.format.id, 'single')
  const full = { ...next, format: { id: 'double', activeSlots: 2 }, teamRule: { id: 'full', battleSize: 6 } }
  assert.equal(getPlayerBattleSelectionCount(full, 6), 2)
  const ordered = selectPlayerBattlePokemon(roster, full, [roster[5].captureId, roster[4].captureId])
  assert.equal(ordered.length, 6)
  assert.deepEqual(ordered.slice(0, 2).map(pokemon => pokemon.captureId), [roster[5].captureId, roster[4].captureId])
})
console.log(`AI battle format validation passed (${passed} checks).`)
