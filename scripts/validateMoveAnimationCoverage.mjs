import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const rootDirectory = path.resolve(scriptDirectory, '..')

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(rootDirectory, relativePath), 'utf8'))
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const reference = readJson('src/data/generatedMoveAnimationReference.json')
const battleMoves = readJson('src/data/generatedBattleMoves.json')
const animationManifest = readJson('src/data/generatedMoveAnimationManifest.json')
const qaPath = path.join(rootDirectory, 'docs/move-animation-qa-checklist.csv')
const {
  getMoveAnimationAssets,
  getMoveAnimationProfile,
  getMovePixelAnimationPlan,
} = await import('../src/data/moveAnimationData.js')

assert(reference.counts.records === 971, `Expected 971 reference records, found ${reference.counts.records}.`)
assert(reference.records.length === 971, `Expected 971 runtime records, found ${reference.records.length}.`)
assert(reference.counts.manualQueue === 62, `Expected 62 manual queue records, found ${reference.counts.manualQueue}.`)
assert(reference.manualQueue.length === 62, `Expected 62 runtime manual queue records, found ${reference.manualQueue.length}.`)
assert(reference.records.every((record, index) => record.recordNo === index + 1), 'Reference record numbers are not sequential.')
assert(reference.unmatchedActiveMoveIds.length === 0, `Unmatched active moves: ${reference.unmatchedActiveMoveIds.join(', ')}`)
assert(reference.counts.activeMoves === battleMoves.moves.length, 'Active move count does not match generatedBattleMoves.json.')
assert(reference.counts.activeReferenceMatches === battleMoves.moves.length, 'Not every active move has a reference record.')

const missingManifestMoves = battleMoves.moves
  .map((move) => move.id)
  .filter((moveId) => !animationManifest.moves[moveId])
assert(missingManifestMoves.length === 0, `Moves missing animation resources: ${missingManifestMoves.join(', ')}`)

const missingAssets = []
Object.values(animationManifest.moves).forEach((resource) => {
  ;[...(resource.assets ?? []), ...(resource.backgrounds ?? [])].forEach((asset) => {
    const assetPath = path.join(rootDirectory, 'public/assets/move-fx/ebdx', asset.file)
    if (!existsSync(assetPath)) missingAssets.push(asset.file)
  })
})
assert(missingAssets.length === 0, `Missing EBDX files: ${[...new Set(missingAssets)].join(', ')}`)

const runtimePlans = battleMoves.moves.map((move) => {
  const profile = getMoveAnimationProfile(move)
  return { move, profile, plan: getMovePixelAnimationPlan(profile) }
})

runtimePlans.forEach(({ move, profile, plan }) => {
  assert(profile.duration >= 760 && profile.duration <= 1720, `${move.id} has an invalid attack duration.`)
  assert(plan.impactDuration >= 500 && plan.impactDuration <= 760, `${move.id} has an invalid impact duration.`)
  const sceneSources = new Set(plan.sceneAssets.map((asset) => asset.src))
  const movingSources = [
    ...plan.sourceAssets,
    ...plan.trajectoryAssets,
    ...plan.impactAssets,
    plan.beamAsset,
  ].filter(Boolean).map((asset) => asset.src)
  assert(movingSources.every((src) => !sceneSources.has(src)), `${move.id} reuses a scene asset as a moving effect.`)
  const preloadSources = new Set(getMoveAnimationAssets(move))
  ;[...sceneSources, ...movingSources].forEach((src) => {
    assert(preloadSources.has(src), `${move.id} does not preload ${src}.`)
  })
})

const surfPlan = runtimePlans.find(({ move }) => move.id === 'surf')?.plan
assert(surfPlan?.sceneAssets.length >= 2, 'Surf must retain side-aware field scene assets.')
assert(!surfPlan?.inlineImpact, 'Damaging spread moves must resolve impact during the damage phase.')
const tacklePlan = runtimePlans.find(({ move }) => move.id === 'tackle')?.plan
assert(tacklePlan?.sourceAssets.length === 0, 'Contact moves must not render a detached charge orb.')

assert(existsSync(qaPath), 'QA checklist was not generated.')
const qaLines = readFileSync(qaPath, 'utf8').trimEnd().split(/\r?\n/)
assert(qaLines.length === 972, `Expected QA header plus 971 rows, found ${qaLines.length} lines.`)

console.log('Move animation coverage validation passed.')
console.log(`Reference records: ${reference.records.length}`)
console.log(`Active moves matched: ${reference.counts.activeReferenceMatches}/${reference.counts.activeMoves}`)
console.log(`EBDX resources: ${reference.counts.dedicatedEbdx} dedicated, ${reference.counts.fallbackEbdx} fallback`)
console.log(`Manual queue: ${reference.manualQueue.length}`)
console.log(`Referenced assets verified: ${animationManifest.assetCount}`)
