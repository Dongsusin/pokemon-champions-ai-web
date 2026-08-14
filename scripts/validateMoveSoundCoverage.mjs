import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { BATTLE_SAMPLE_PATHS } from '../src/battleAudio.js'
import { getMoveSoundProfile } from '../src/data/moveSoundData.js'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDirectory, '..')
const moveDataPath = path.join(projectRoot, 'src', 'data', 'generatedBattleMoves.json')
const moveData = JSON.parse(fs.readFileSync(moveDataPath, 'utf8'))
const profiles = moveData.moves.map((move) => getMoveSoundProfile(move))
const referencedSamples = new Set(
  profiles.flatMap((profile) => [profile.launchSample, profile.textureSample, profile.impactSample]).filter(Boolean),
)
const missingProfiles = profiles.filter(
  (profile) => !profile.launchSample || !profile.impactSample || profile.signatureFrequencies.length === 0,
)
const missingSampleKeys = [...referencedSamples].filter((sample) => !BATTLE_SAMPLE_PATHS[sample])
const missingAssetFiles = Object.entries(BATTLE_SAMPLE_PATHS)
  .filter(([, assetPath]) => !fs.existsSync(path.join(projectRoot, 'public', assetPath.replace(/^\//, ''))))
  .map(([sample]) => sample)
const fingerprints = new Set(profiles.map((profile) => profile.soundFingerprint))
const audibleSignatures = new Set(profiles.map((profile) => [
  profile.launchSample,
  profile.textureSample,
  profile.impactSample,
  profile.sampleRate.toFixed(3),
  profile.signatureFrequencies.map((frequency) => frequency.toFixed(2)).join(','),
  profile.signatureCadence.toFixed(3),
  profile.pulseCount,
].join('|')))

const failures = []
if (profiles.length !== moveData.moveCount) failures.push(`profile count ${profiles.length}/${moveData.moveCount}`)
if (missingProfiles.length > 0) failures.push(`${missingProfiles.length} incomplete profiles`)
if (missingSampleKeys.length > 0) failures.push(`unknown sample keys: ${missingSampleKeys.join(', ')}`)
if (missingAssetFiles.length > 0) failures.push(`missing assets: ${missingAssetFiles.join(', ')}`)
if (fingerprints.size !== profiles.length) failures.push(`fingerprint collisions: ${profiles.length - fingerprints.size}`)
if (audibleSignatures.size !== profiles.length) failures.push(`audible collisions: ${profiles.length - audibleSignatures.size}`)

if (failures.length > 0) {
  console.error(`Move sound validation failed: ${failures.join('; ')}`)
  process.exitCode = 1
} else {
  console.log(`Validated ${profiles.length} move sound profiles, ${referencedSamples.size} referenced samples, and ${audibleSignatures.size} unique audible signatures.`)
}
