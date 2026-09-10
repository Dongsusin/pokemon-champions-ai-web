import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { BATTLE_SAMPLE_PATHS } from '../src/battleAudio.js'
import { getMoveSoundProfile } from '../src/data/moveSoundData.js'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDirectory, '..')
const moveDataPath = path.join(projectRoot, 'src', 'data', 'generatedBattleMoves.json')
const moveData = JSON.parse(fs.readFileSync(moveDataPath, 'utf8'))
const profiles = moveData.moves.map((move) => getMoveSoundProfile(move))
const profilesById = new Map(profiles.map((profile) => [profile.moveId, profile]))
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
const audibleSignature = (profile) => [
  profile.launchSample,
  profile.textureSample,
  profile.impactSample,
  profile.sampleRate.toFixed(3),
  profile.signatureFrequencies.map((frequency) => frequency.toFixed(2)).join(','),
  profile.signatureCadence.toFixed(3),
  profile.pulseCount,
].join('|')
const audibleSignatures = new Set(profiles.map(audibleSignature))

const failures = []
if (profiles.length !== moveData.moveCount) failures.push(`profile count ${profiles.length}/${moveData.moveCount}`)
if (missingProfiles.length > 0) failures.push(`${missingProfiles.length} incomplete profiles`)
if (missingSampleKeys.length > 0) failures.push(`unknown sample keys: ${missingSampleKeys.join(', ')}`)
if (missingAssetFiles.length > 0) failures.push(`missing assets: ${missingAssetFiles.join(', ')}`)
if (fingerprints.size !== profiles.length) failures.push(`fingerprint collisions: ${profiles.length - fingerprints.size}`)
if (audibleSignatures.size !== profiles.length) failures.push(`audible collisions: ${profiles.length - audibleSignatures.size}`)

let regressionChecks = 0
const check = (name, run) => {
  try {
    run()
    regressionChecks += 1
  } catch (error) {
    failures.push(`${name}: ${error.message}`)
  }
}

check('source metadata matches battle timeline cues for every move', () => {
  for (const move of moveData.moves) {
    const cue = {
      moveId: move.id, moveType: move.type, moveCategory: move.categoryId,
      moveGeneration: move.generation, movePower: move.power, moveTarget: move.target,
      moveFlags: move.flags, moveMultihit: move.multihit, moveDrain: move.drain,
      moveStatus: move.status, moveSelfdestruct: Boolean(move.selfdestruct),
    }
    const profile = getMoveSoundProfile(cue)
    assert.equal(audibleSignature(profile), audibleSignature(profilesById.get(move.id)), move.id)
  }
})

check('translated names and descriptions never determine sound recipes', () => {
  for (const move of moveData.moves) {
    const translated = getMoveSoundProfile({
      ...move, name: '새로운 번역', moveName: 'another translated name',
      description: 'psychic dream beam fire sleep', moveDescription: 'psy drain sword',
    })
    assert.equal(audibleSignature(translated), audibleSignature(profilesById.get(move.id)), move.id)
  }
})

check('all 19 types have different local motifs and audible fallback recipes', () => {
  const typeIds = ['normal', 'fire', 'water', 'electric', 'grass', 'ice', 'fighting', 'poison', 'ground', 'flying', 'psychic', 'bug', 'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy', 'stellar']
  const typeProfiles = typeIds.map((typeId) => getMoveSoundProfile({ id: 'futuremove', typeId, categoryId: 'special', power: 80 }))
  assert.equal(new Set(typeProfiles.map((profile) => profile.typeTextureSample)).size, 19)
  assert.equal(new Set(typeProfiles.map(audibleSignature)).size, 19)
  for (const profile of typeProfiles) {
    assert.ok(BATTLE_SAMPLE_PATHS[profile.typeTextureSample], profile.type)
    assert.ok([profile.launchSample, profile.textureSample].includes(profile.typeTextureSample), profile.type)
    assert.equal(profile.soundSource, 'type-archetype')
  }
})

check('sound and drain flags survive move animation variants', () => {
  for (const move of moveData.moves.filter((move) => move.flags?.includes('sound'))) {
    assert.equal(profilesById.get(move.id).isSoundMove, true, move.id)
    assert.equal(profilesById.get(move.id).archetype, 'sound', move.id)
    assert.equal(profilesById.get(move.id).wave, 'sine', move.id)
  }
  for (const move of moveData.moves.filter((move) => move.drain)) {
    assert.equal(profilesById.get(move.id).isDrainMove, true, move.id)
    assert.equal(profilesById.get(move.id).archetype, 'drain', move.id)
  }
  assert.equal(getMoveSoundProfile({ moveId: 'sparklingaria', moveType: '물', moveCategory: 'special', moveFlags: ['sound'], animationVariant: 'Z_GENERIC_SPECIAL' }).archetype, 'sound')
})

check('healing, charge and consecutive-hit metadata remain audible', () => {
  for (const id of ['recover', 'roost', 'rest', 'synthesis']) assert.equal(profilesById.get(id).isHealingMove, true, id)
  assert.equal(profilesById.get('solarbeam').isChargeMove, true)
  assert.equal(profilesById.get('tackle').isChargeMove, false)
  assert.equal(profilesById.get('doublehit').pulseCount, 2)
  assert.ok(profilesById.get('bulletseed').pulseCount >= 2)
  assert.equal(profilesById.get('selfdestruct').impactSample, 'explosionHeavy')
})

check('iconic moves use authored recipes with distinct identities', () => {
  const groups = [
    ['tackle', 'quickattack', 'extremespeed'],
    ['ember', 'flamethrower', 'fireblast'],
    ['watergun', 'surf', 'hydropump'],
    ['thundershock', 'thunderbolt', 'thunder'],
    ['icepunch', 'icebeam', 'blizzard'],
    ['calmmind', 'protect', 'recover'],
  ]
  for (const group of groups) {
    const selected = group.map((id) => profilesById.get(id))
    assert.equal(new Set(selected.map(audibleSignature)).size, group.length)
    for (const profile of selected) assert.equal(profile.soundSource, 'authored-move', profile.moveId)
  }
})

check('special variants and minimal unknown moves keep complete profiles', () => {
  const inputs = [
    {},
    { id: 'unknownmove', type: 'unknown', categoryId: 'physical' },
    { moveId: 'flamethrower', moveType: '불꽃', moveCategory: 'special', animationVariant: 'MAX_MOVE' },
    { moveId: 'flamethrower', moveType: '불꽃', moveCategory: 'special', animationVariant: 'GMAX_MOVE', actorSpeciesSlug: 'charizard' },
    { moveId: 'surf', moveType: '물', moveCategory: 'special', animationVariant: 'Z_GENERIC_SPECIAL' },
    { moveId: 'tackle', moveType: '노말', moveCategory: 'physical', animationVariant: 'Z_GENERIC_PHYSICAL' },
    { moveId: 'terablast', moveType: '스텔라', moveCategory: 'special', animationVariant: 'TERA_TYPE_VARIANTS' },
  ]
  for (const input of inputs) {
    const profile = getMoveSoundProfile(input)
    for (const sample of [profile.launchSample, profile.textureSample, profile.impactSample]) assert.ok(BATTLE_SAMPLE_PATHS[sample], sample)
    for (const key of ['sampleRate', 'sampleDuration', 'textureRate', 'textureDuration', 'signatureCadence', 'signatureDuration', 'impactDuration', 'impactRate', 'pulseGap']) {
      assert.ok(Number.isFinite(profile[key]) && profile[key] > 0, key)
    }
    assert.ok(profile.signatureFrequencies.every((frequency) => Number.isFinite(frequency) && frequency > 0))
  }
})

if (failures.length > 0) {
  console.error(`Move sound validation failed: ${failures.join('; ')}`)
  process.exitCode = 1
} else {
  const authoredProfiles = profiles.filter((profile) => profile.soundSource === 'authored-move').length
  console.log(`Validated ${profiles.length} move sound profiles (${authoredProfiles} authored recipes), ${referencedSamples.size} referenced samples, ${audibleSignatures.size} unique audible signatures, and ${regressionChecks} metadata/fallback regressions.`)
}
