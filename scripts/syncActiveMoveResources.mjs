import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const rootDirectory = path.resolve(scriptDirectory, '..')

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(rootDirectory, relativePath), 'utf8'))
}

function writeJson(relativePath, value) {
  writeFileSync(path.join(rootDirectory, relativePath), `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

const battleMoves = readJson('src/data/generatedBattleMoves.json')
const animationManifest = readJson('src/data/generatedMoveAnimationManifest.json')
const animationReference = readJson('src/data/generatedMoveAnimationReference.json')
const referenceRecords = new Map(animationReference.records.map((record) => [record.recordNo, record]))

const moves = {}
const activeMoveIndex = {}
const activeAvailability = {}
const missingManifestMoves = []
const missingReferenceMoves = []
let specificMoveCount = 0

battleMoves.moves.forEach((move) => {
  const resource = animationManifest.moves[move.id]
  if (!resource) {
    missingManifestMoves.push(move.id)
  } else {
    moves[move.id] = resource
    if (resource.specific) specificMoveCount += 1
  }

  const recordNo = animationReference.activeMoveIndex[move.id]
  const record = referenceRecords.get(recordNo)
  if (!record) {
    missingReferenceMoves.push(move.id)
  } else {
    activeMoveIndex[move.id] = recordNo
    activeAvailability[record.availability] = (activeAvailability[record.availability] ?? 0) + 1
  }
})

if (missingManifestMoves.length > 0 || missingReferenceMoves.length > 0) {
  const failures = [
    missingManifestMoves.length > 0 ? `animation manifest: ${missingManifestMoves.join(', ')}` : null,
    missingReferenceMoves.length > 0 ? `animation reference: ${missingReferenceMoves.join(', ')}` : null,
  ].filter(Boolean)
  throw new Error(`Active moves are missing generated resources (${failures.join('; ')}).`)
}

const moveCount = battleMoves.moves.length
const fallbackMoveCount = moveCount - specificMoveCount
animationManifest.moveCount = moveCount
animationManifest.specificMoveCount = specificMoveCount
animationManifest.fallbackMoveCount = fallbackMoveCount
animationManifest.moves = moves

animationReference.counts.activeMoves = moveCount
animationReference.counts.activeReferenceMatches = Object.keys(activeMoveIndex).length
animationReference.counts.dedicatedEbdx = specificMoveCount
animationReference.counts.fallbackEbdx = fallbackMoveCount
animationReference.counts.activeAvailability = Object.fromEntries(
  Object.entries(activeAvailability).sort(([left], [right]) => left.localeCompare(right)),
)
animationReference.unmatchedActiveMoveIds = []
animationReference.activeMoveIndex = activeMoveIndex

writeJson('src/data/generatedMoveAnimationManifest.json', animationManifest)
writeJson('src/data/generatedMoveAnimationReference.json', animationReference)

console.log(`Synchronized ${moveCount} active move resources (${specificMoveCount} dedicated, ${fallbackMoveCount} fallback).`)
