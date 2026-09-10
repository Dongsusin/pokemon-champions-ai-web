import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPromoFixture, PROMO_GIMMICK_GROUPS } from '../fixtures.mjs'
import {
  createBattle,
  createBattleTurnTimeline,
  getAvailableBattleMechanics,
} from '../../src/data/battleEngine.js'
import { getLearnableMoves, getGigantamaxProfile } from '../../src/data/trainingData.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const output = path.join(root, 'promo/generated/gimmick-fixtures-validation.json')
const report = {
  generatedAt: new Date().toISOString(),
  seed: 0.5,
  sourceHashes: {},
  groups: [],
  checks: [],
  failures: [],
}
for (const file of ['promo/fixtures.mjs', 'promo/gimmickVariants.mjs']) {
  report.sourceHashes[file] = crypto.createHash('sha256')
    .update(await fs.readFile(path.join(root, file))).digest('hex')
}

for (const group of PROMO_GIMMICK_GROUPS) {
  const summary = {
    id: group.id,
    variantCount: group.variants.length,
    uniqueSpecies: new Set(group.variants.map(variant => variant.speciesId)).size,
    moveTypes: [...new Set(group.variants.map(variant => variant.resolvedMoveType))],
    ...(group.id === 'tera' ? { teraTypes: [...new Set(group.variants.map(variant => variant.teraType))] } : {}),
  }
  report.groups.push(summary)
  if (summary.variantCount !== 9 || summary.uniqueSpecies !== 9 || summary.moveTypes.length !== 9) {
    report.failures.push(`${group.id}: expected nine battles, species and attack types`)
  }
  if (summary.teraTypes && summary.teraTypes.length !== 9) {
    report.failures.push(`${group.id}: expected nine different Tera types`)
  }

  for (const variant of group.variants) {
    try {
      const fixture = createPromoFixture(variant.sceneId)
      const state = createBattle(fixture)
      const turn = createBattleTurnTimeline(state, {
        type: 'move', actorSlot: 0, targetSlot: 0, moveIndex: 0, gimmick: group.id,
      }, () => report.seed)
      const gimmick = turn.timeline.find(step => step.phase === 'gimmick' && step.sideId === 'player')
      const attack = turn.timeline.find(step => step.phase === 'attack' && step.sideId === 'player')
      const impact = turn.timeline.find(step => step.phase === 'impact' && step.sideId === 'player')
      const player = turn.state.player.team[0]
      const learnable = new Set(getLearnableMoves(variant.speciesId).map(move => move.id))
      const check = {
        sceneId: variant.sceneId,
        mechanic: group.id,
        pokemonName: variant.pokemonName,
        resolvedPokemonName: player.name,
        speciesId: variant.speciesId,
        heldItemId: fixture.playerPokemon[0].heldItemId,
        teraType: variant.teraType,
        allMovesLearnable: fixture.playerPokemon[0].moveIds.every(id => learnable.has(id)),
        mechanicAvailable: getAvailableBattleMechanics(state).some(mechanic => mechanic.id === group.id),
        mechanicUsed: turn.state.player.usedMechanics[group.id] === true,
        firstTimelineEvent: turn.timeline[0]?.phase,
        firstTimelineSide: turn.timeline[0]?.sideId,
        gimmickPresent: gimmick?.mechanicId === group.id,
        attackMoveId: attack?.moveId,
        attackMoveName: attack?.moveName,
        attackMoveType: attack?.moveType,
        impactDamage: impact?.damage,
        ...(group.id === 'dynamax' ? { gmaxProfile: getGigantamaxProfile(variant.speciesId)?.slug } : {}),
        playerDefeated: turn.state.winner === 'opponent',
        timeline: turn.timeline.map(step => ({
          phase: step.phase, sideId: step.sideId, moveId: step.moveId,
          moveName: step.moveName, damage: step.damage, mechanicId: step.mechanicId,
        })),
      }
      const requirements = {
        learnableMoves: check.allMovesLearnable,
        availableMechanic: check.mechanicAvailable,
        activatedMechanic: check.mechanicUsed && check.gimmickPresent,
        immediatePlayerGimmick: check.firstTimelineEvent === 'gimmick' && check.firstTimelineSide === 'player',
        actualAttackAndDamage: Boolean(attack && impact?.damage > 0),
        matchingCaptionMetadata: attack?.moveId === variant.resolvedMoveId
          && attack?.moveName === variant.resolvedMoveName
          && attack?.moveType === variant.resolvedMoveType,
        noPlayerDefeat: !check.playerDefeated,
        ...(group.id === 'dynamax' ? { supportedSignatureGmax: Boolean(check.gmaxProfile && attack?.moveId.startsWith('gmax')) } : {}),
        ...(group.id === 'tera' ? { selectedTeraType: player.teraActive && player.teraType === variant.teraType } : {}),
      }
      check.failedRequirements = Object.entries(requirements).filter(([, passed]) => !passed).map(([name]) => name)
      check.passed = check.failedRequirements.length === 0
      if (!check.passed) report.failures.push(`${variant.sceneId}: ${check.failedRequirements.join(', ')}`)
      report.checks.push(check)
    } catch (error) {
      report.failures.push(`${variant.sceneId}: ${error.message}`)
      report.checks.push({ sceneId: variant.sceneId, passed: false, error: error.message })
    }
  }
}
if (report.groups.length !== 4 || report.checks.length !== 36) {
  report.failures.push('Expected all four gimmicks and 36 engine-resolved battles')
}
report.passed = report.failures.length === 0
await fs.mkdir(path.dirname(output), { recursive: true })
await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify({ passed: report.passed, groups: report.groups, failures: report.failures, output }, null, 2))
assert(report.passed, 'All 36 first actions must immediately activate their mechanic and deal actual damage')
