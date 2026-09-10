import assert from 'node:assert/strict'
import battleMoves from '../src/data/generatedBattleMoves.json' with { type: 'json' }
import { getMoveAnimationProfile } from '../src/data/moveAnimationData.js'
import {
  AUTHORED_MOVE_CHOREOGRAPHIES,
  MOVE_CHOREOGRAPHY_FAMILIES,
  MOVE_CHOREOGRAPHY_SIGNATURES,
  getMoveChoreography,
} from '../src/data/moveChoreographyData.js'

const moves = new Map(battleMoves.moves.map((move) => [move.id, move]))
const targets = new Set(['self', 'ally', 'foe', 'field', 'ally-side', 'foe-side'])
const motions = new Set(['cast', 'lunge', 'dash', 'leap', 'pulse', 'rise', 'still'])
const impacts = new Set(['none', 'ring', 'slash', 'spark', 'splash', 'shatter', 'pulse'])
let scenarios = 0
function test(label, run) {
  try { run(); scenarios += 1 } catch (error) { error.message = `${label}: ${error.message}`; throw error }
}
function recipe(id, overrides = {}) {
  assert(moves.has(id), `Missing real move ${id}`)
  const cue = { ...moves.get(id), moveId: id, ...overrides }
  return getMoveChoreography(getMoveAnimationProfile(cue), cue)
}
function valid(result, label) {
  assert(MOVE_CHOREOGRAPHY_FAMILIES.includes(result.family), `${label}: unknown family`)
  assert(result.signature === null || MOVE_CHOREOGRAPHY_SIGNATURES.includes(result.signature), `${label}: unknown signature`)
  assert.equal(result.palette.length, 3, `${label}: palette length`)
  assert(result.palette.every((color) => /^#[0-9a-f]{6}$/i.test(color)), `${label}: invalid color`)
  assert(targets.has(result.target), `${label}: invalid target`)
  assert(motions.has(result.motion), `${label}: invalid motion`)
  assert(impacts.has(result.impact.style), `${label}: invalid impact style`)
  const { anticipation, release, arrival, settle } = result.timing
  assert([anticipation, release, arrival, settle, result.density, result.scale, result.impact.strength].every(Number.isFinite), `${label}: nonfinite value`)
  assert(0 < anticipation && anticipation < release && release < arrival && arrival < settle && settle === 1, `${label}: invalid timing order`)
  assert(Number.isInteger(result.density) && result.density >= 8 && result.density <= 32, `${label}: density outside budget`)
  assert(result.scale >= 0.75 && result.scale <= 1.6, `${label}: scale outside budget`)
  assert(result.impact.strength >= 0 && result.impact.strength <= 1, `${label}: invalid strength`)
  assert.equal(result.impact.style === 'none', result.impact.strength === 0, `${label}: inconsistent impact`)
  assert.equal(typeof result.field, 'boolean')
  assert.equal(typeof result.supportive, 'boolean')
}

test('Every catalog move has a bounded deterministic recipe without mutating input', () => {
  for (const move of moves.values()) {
    const cue = { ...move, moveId: move.id, sideId: 'player', actorSlot: 0, targetSideId: move.target === 'self' ? 'player' : 'opponent', targetSlot: 0 }
    const profile = getMoveAnimationProfile(cue)
    const before = JSON.stringify({ profile, cue })
    const first = getMoveChoreography(profile, cue)
    valid(first, move.id)
    assert.deepEqual(getMoveChoreography(profile, cue), first, move.id)
    assert.equal(JSON.stringify({ profile, cue }), before, `${move.id}: input mutated`)
    if (move.categoryId === 'status') assert.equal(first.impact.strength, 0, `${move.id}: status damage flash`)
  }
})

test('Authored IDs are reachable catalog moves, with varied shared silhouettes', () => {
  assert(Object.keys(AUTHORED_MOVE_CHOREOGRAPHIES).length >= 60)
  for (const id of Object.keys(AUTHORED_MOVE_CHOREOGRAPHIES)) assert(moves.has(id), `Unknown authored ID ${id}`)
  assert(new Set(Object.values(AUTHORED_MOVE_CHOREOGRAPHIES).map((entry) => entry.family)).size >= 16)
})

test('Fire Blast, Flamethrower and Ember have distinct silhouettes or scale', () => {
  assert.equal(recipe('fireblast').signature, 'fire-cross')
  assert.equal(recipe('fireblast').family, 'eruption')
  assert.equal(recipe('flamethrower').family, 'stream')
  assert(recipe('flamethrower').density > recipe('ember').density)
  assert(recipe('flamethrower').scale > recipe('ember').scale)
})
test('Sky lightning, crystal beam and charged solar beam retain their identities', () => {
  assert.equal(recipe('thunderbolt').signature, 'forked-bolt')
  assert.equal(recipe('thunder').signature, 'sky-bolt')
  assert(recipe('thunder').timing.release > recipe('thunderbolt').timing.release)
  assert.equal(recipe('icebeam').signature, 'ice-crystal')
  assert.equal(recipe('solarbeam').signature, 'solar-charge')
  assert(recipe('solarbeam').timing.release > recipe('icebeam').timing.release)
})
test('Signature orbs and ground/sky attacks use distinct silhouettes', () => {
  assert.equal(recipe('shadowball').signature, 'shadow')
  assert.equal(recipe('moonblast').signature, 'moon')
  assert.equal(recipe('aurasphere').signature, 'aura')
  assert.equal(recipe('earthquake').signature, 'ground-fissure')
  assert.equal(recipe('dracometeor').signature, 'dragon-meteor')
  assert.notEqual(recipe('earthquake').family, recipe('dracometeor').family)
})

test('Pollen Puff heals the distinct ally slot and damages the enemy slot', () => {
  const foe = recipe('pollenpuff', { sideId: 'player', actorSlot: 0, targetSideId: 'opponent', targetSlot: 1, phase: 'impact', damage: 40 })
  const ally = recipe('pollenpuff', { sideId: 'player', targetSideId: 'player', targetSlot: 1, phase: 'impact', damage: 0 })
  assert.equal(foe.family, 'orb'); assert.equal(foe.target, 'foe'); assert.equal(foe.supportive, false)
  assert(foe.impact.strength > 0)
  assert.equal(ally.family, 'heal'); assert.equal(ally.target, 'ally'); assert.equal(ally.supportive, true)
  assert.equal(ally.impact.strength, 0)
  // Missing slots default to actor slot 0; a same-side cue alone is not proof of healing.
  assert.equal(recipe('pollenpuff', { sideId: 'player', targetSideId: 'player' }).family, 'orb')
  assert.equal(recipe('pollenpuff', { animationBranch: 'HEAL_RESULT' }).family, 'heal')
  assert.equal(recipe('pollenpuff', { healsTarget: true }).family, 'heal')
})
test('Targeted healing follows its recipient, including a selected opponent', () => {
  for (const id of ['healpulse', 'floralhealing']) {
    const ally = recipe(id, { sideId: 'player', actorSlot: 1, targetSideId: 'player', targetSlot: 0 })
    const foe = recipe(id, { sideId: 'player', targetSideId: 'opponent' })
    assert.equal(ally.target, 'ally'); assert.equal(foe.target, 'foe')
    assert.equal(ally.family, 'heal'); assert.equal(foe.family, 'heal')
    assert.equal(foe.supportive, true); assert.equal(foe.impact.strength, 0)
  }
})
test('Hostile sleep and debuff moves never become self boosts', () => {
  for (const id of ['spore', 'hypnosis', 'featherdance', 'charm']) {
    const move = recipe(id)
    assert.equal(move.target, 'foe', id)
    assert.equal(move.family, 'status', id)
    assert.equal(move.supportive, false, id)
    assert.equal(move.impact.strength, 0, id)
  }
  assert.equal(recipe('stringshot').family, 'status')
  assert.equal(recipe('stringshot').target, 'foe-side')
  assert.equal(recipe('stickyweb').family, 'field')
  assert.equal(recipe('stickyweb').target, 'foe-side')
})
test('Self boosts, team screens and global weather retain their targeting scope', () => {
  assert.equal(recipe('swordsdance').target, 'self')
  assert.equal(recipe('swordsdance').family, 'boost')
  assert.equal(recipe('swordsdance').signature, 'sword-orbit')
  assert.equal(recipe('reflect').target, 'ally-side')
  assert.equal(recipe('reflect').family, 'barrier')
  assert.equal(recipe('raindance').target, 'field')
  assert.equal(recipe('raindance').family, 'field')
})
test('Failed, blocked, immune and incomplete actions have no damaging impact', () => {
  for (const result of ['miss', 'immune', 'blocked', 'failed', 'reflected', 'charging', 'waiting', 'protect-contact']) {
    const move = recipe('thunderbolt', { result, phase: 'impact', damage: 40 })
    assert.deepEqual(move.impact, { style: 'none', strength: 0 }, result)
  }
  assert.equal(recipe('thunderbolt', { phase: 'impact', damage: 0 }).impact.strength, 0)
  assert.equal(recipe('thunderbolt', { phase: 'impact', damage: 40, effectiveness: 0 }).impact.strength, 0)
  assert(recipe('thunderbolt', { phase: 'impact', damage: 40 }).impact.strength > 0)
})

test('Max and Z variants discard base move artwork and removed drain/contact effects', () => {
  const water = recipe('flamethrower', { animationVariant: 'MAX_MOVE', animationType: '물', moveCategory: 'special' })
  assert.equal(water.family, 'wave'); assert.equal(water.signature, null)
  assert.notDeepEqual(water.palette, recipe('flamethrower').palette)
  const drainMax = recipe('drainpunch', { animationVariant: 'MAX_MOVE', animationType: '격투', moveCategory: 'physical' })
  assert.notEqual(drainMax.family, 'drain'); assert.equal(drainMax.signature, null)
  const iceZ = recipe('icebeam', { animationVariant: 'Z_GENERIC_SPECIAL', animationType: '얼음', moveCategory: 'special' })
  assert.notEqual(iceZ.family, 'beam'); assert.equal(iceZ.signature, null)
  const gmax = recipe('shadowball', { animationVariant: 'GMAX_MOVE', animationType: '불꽃', actorSpeciesSlug: 'charizard', moveCategory: 'special' })
  assert.notEqual(gmax.family, 'orb'); assert.equal(gmax.signature, null)
})
test('Max Guard transforms a self-boost into a defensive self barrier', () => {
  const guard = recipe('swordsdance', { animationVariant: 'MAX_MOVE', moveCategory: 'status' })
  assert.equal(guard.family, 'barrier'); assert.equal(guard.target, 'self')
  assert.equal(guard.impact.strength, 0); assert.equal(guard.supportive, true)
})
test('Every catalog move remains bounded as a Max move and physical/special Z move', () => {
  for (const move of moves.values()) {
    for (const animationVariant of ['MAX_MOVE', move.categoryId === 'physical' ? 'Z_GENERIC_PHYSICAL' : 'Z_GENERIC_SPECIAL']) {
      const cue = { ...move, moveId: move.id, moveCategory: move.categoryId, animationVariant }
      const profile = getMoveAnimationProfile(cue)
      valid(getMoveChoreography(profile, cue), `${move.id}:${animationVariant}`)
    }
  }
})

test('Fallback uses structured flags and motif without deriving mechanics from descriptions', () => {
  const profile = { moveId: 'unlistedmove', category: 'special', motif: 'bolt', intensity: Infinity }
  const lightning = getMoveChoreography(profile)
  assert.equal(lightning.family, 'bolt'); assert.equal(lightning.signature, null); valid(lightning, 'fallback')
  assert.deepEqual(getMoveChoreography(profile, { moveDescription: 'heal poison sleep fire sword dance' }), lightning)
  assert.equal(getMoveChoreography(profile, { moveFlags: ['slicing'] }).family, 'slash')
  valid(getMoveChoreography({ ...profile, intensity: -200, primary: 'bad', secondary: null }), 'malformed profile fallback')
  valid(getMoveChoreography(), 'empty fallback')
})
test('Returned recipe mutation cannot affect later calls', () => {
  const before = recipe('moonblast')
  const mutated = recipe('moonblast')
  mutated.palette[0] = '#000000'; mutated.timing.arrival = 0; mutated.impact.strength = 0
  assert.deepEqual(recipe('moonblast'), before)
})

console.log(`Move choreography validation passed: ${scenarios} scenarios, ${moves.size} standard + ${moves.size * 2} transformed profiles.`)
console.log(`Authored move mappings: ${Object.keys(AUTHORED_MOVE_CHOREOGRAPHIES).length}; shared signatures: ${MOVE_CHOREOGRAPHY_SIGNATURES.length}; families: ${MOVE_CHOREOGRAPHY_FAMILIES.length}.`)
