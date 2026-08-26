import assert from 'node:assert/strict'
import {
  rankTrainerTeamsAgainstPlayer,
  selectCounterTeamNumber,
} from '../src/data/aiTeamSelection.js'
import { TRAINERS } from '../src/data/trainerTeams.js'

const requestedTrainerNames = (process.env.BATTLE_AI_DECK_COVERAGE_TRAINERS ?? '')
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean)
const requestedDeckLimit = Number.parseInt(
  process.env.BATTLE_AI_DECK_COVERAGE_LIMIT ?? '',
  10,
)
const selectedTrainers = requestedTrainerNames.length > 0
  ? TRAINERS.filter((trainer) => requestedTrainerNames.includes(trainer.name))
  : TRAINERS
const allDecks = TRAINERS.flatMap((trainer) => trainer.teams.map((team) => ({
  trainerName: trainer.name,
  teamNumber: team.number,
  pokemon: team.pokemon,
})))
const selectedDecks = Number.isFinite(requestedDeckLimit) && requestedDeckLimit > 0
  ? allDecks.slice(0, requestedDeckLimit)
  : allDecks

assert(selectedTrainers.length > 0, 'No trainers matched the requested deck coverage filter.')
assert(selectedDecks.length > 0, 'No player decks were available for AI deck coverage validation.')

const startedAt = performance.now()
const selectedTeamCounts = new Map()
const selectedVariantsByTrainer = new Map()
const teamNumberCounts = { 1: 0, 2: 0, 3: 0 }
let matchupCount = 0

selectedTrainers.forEach((trainer) => {
  selectedDecks.forEach((playerDeck) => {
    const ranking = rankTrainerTeamsAgainstPlayer(trainer, playerDeck.pokemon)
    assert.equal(ranking.length, trainer.teams.length)
    ranking.forEach((entry, index) => {
      assert(Number.isFinite(entry.score), `${trainer.name} team ${entry.number} produced a non-finite score.`)
      if (index === 0) return
      const previous = ranking[index - 1]
      assert(
        previous.score > entry.score
        || (previous.score === entry.score && previous.number < entry.number),
        `${trainer.name} counter-team ranking was not deterministic.`,
      )
    })
    const selectedTeamNumber = selectCounterTeamNumber(trainer, playerDeck.pokemon, () => 0)
    assert.equal(selectedTeamNumber, ranking[0].number)
    const selectionKey = `${trainer.name}:${selectedTeamNumber}`
    selectedTeamCounts.set(selectionKey, (selectedTeamCounts.get(selectionKey) ?? 0) + 1)
    const trainerVariants = selectedVariantsByTrainer.get(trainer.name) ?? new Set()
    trainerVariants.add(selectedTeamNumber)
    selectedVariantsByTrainer.set(trainer.name, trainerVariants)
    teamNumberCounts[selectedTeamNumber] += 1
    matchupCount += 1
  })
})

const elapsedMs = Math.round(performance.now() - startedAt)

process.stdout.write(`${JSON.stringify({
  trainers: selectedTrainers.length,
  playerDecks: selectedDecks.length,
  matchupCount,
  elapsedMs,
  selectedTeamVariants: selectedTeamCounts.size,
  trainersUsingMultipleVariants: [...selectedVariantsByTrainer.values()]
    .filter((variants) => variants.size > 1).length,
  teamNumberCounts,
}, null, 2)}\n`)
