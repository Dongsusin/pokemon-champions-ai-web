import assert from 'node:assert/strict'
import {
  SPECIES_PROFILES,
  getBattleFormOptions,
  getFormMetadata,
  getPersistentFormOptions,
  getSpeciesProfile,
  isSavablePokemonForm,
  normalizePokemon,
  resolveMoveTriggeredFormSpeciesId,
} from '../src/data/trainingData.js'
import { migratePokemonCollection } from '../src/data/pokemonPool.js'
import { getTrainingCostBreakdown, TRAINING_COSTS } from '../src/data/trainingCosts.js'

const profiles = Object.values(SPECIES_PROFILES)
const profileBySlug = new Map(profiles.map((profile) => [profile.slug, profile]))

function requireProfile(slug) {
  const profile = profileBySlug.get(slug)
  assert(profile, `Missing form profile: ${slug}`)
  return profile
}

function slugs(options) {
  return new Set(options.map((option) => option.slug))
}

assert.equal(new Set(profiles.map((profile) => profile.id)).size, profiles.length)
assert.equal(new Set(profiles.map((profile) => profile.slug)).size, profiles.length)
assert(profiles.filter((profile) => profile.id >= 20_000).length >= 200)

for (const profile of profiles) {
  assert(profile.slug)
  assert(profile.name)
  assert(profile.spriteFront)
  assert(profile.spriteBack)
  assert(profile.spriteFrontFallback)
  assert(profile.spriteBackFallback)
  if (profile.parentSpeciesId) assert(getSpeciesProfile(profile.parentSpeciesId))
  assert.equal(Boolean(getFormMetadata(profile).saveable), isSavablePokemonForm(profile))
}

const zygardePersistent = slugs(getPersistentFormOptions(718))
assert(zygardePersistent.has('zygarde'))
assert(zygardePersistent.has('zygarde-10'))
assert(zygardePersistent.has('zygarde-10-power-construct'))
assert(zygardePersistent.has('zygarde-50-power-construct'))
assert(!zygardePersistent.has('zygarde-complete'))
assert(slugs(getBattleFormOptions(718)).has('zygarde-complete'))

const floettePersistent = slugs(getPersistentFormOptions(670))
for (const slug of ['floette', 'floette-blue', 'floette-orange', 'floette-white', 'floette-yellow', 'floette-eternal']) {
  assert(floettePersistent.has(slug), `Floette form is unavailable: ${slug}`)
}
assert(slugs(getBattleFormOptions(670)).has('floette-mega'))

assert(slugs(getPersistentFormOptions(423)).has('gastrodon-east'))
assert.equal(requireProfile('jellicent-f').gender, 'F')
assert.equal(requireProfile('meowstic').gender, 'M')
assert.equal(requireProfile('meowstic-female').gender, 'F')

const spikyPichu = requireProfile('pichu-spiky-eared')
assert.equal(spikyPichu.gender, 'F')
assert.deepEqual(spikyPichu.abilities, ['정전기'])
assert(spikyPichu.spriteFront.includes('/pichu-spikyeared.png'))
assert.equal(getFormMetadata(spikyPichu).evolutionLocked, true)

const greninjaPersistent = slugs(getPersistentFormOptions(658))
assert(greninjaPersistent.has('greninja-battle-bond'))
assert(!greninjaPersistent.has('greninja-ash'))
assert(slugs(getBattleFormOptions(658)).has('greninja-ash'))

const arceusForms = getBattleFormOptions(493)
assert.equal(arceusForms.filter((profile) => profile.formMetadata.formKind === 'item').length, 17)
assert.deepEqual(requireProfile('arceus-fire').types, ['불꽃'])
assert.deepEqual(requireProfile('silvally-water').types, ['물'])

const charizardBattleForms = slugs(getBattleFormOptions(6))
assert(charizardBattleForms.has('charizard-mega-x'))
assert(charizardBattleForms.has('charizard-mega-y'))
assert(charizardBattleForms.has('charizard-gmax'))
assert(!slugs(getPersistentFormOptions(6)).has('charizard-mega-x'))
for (const profile of profiles.filter((entry) => /(?:-mega(?:-x|-y|x|y)?|-gmax|-primal)$/.test(entry.slug))) {
  assert(!isSavablePokemonForm(profile), `Battle gimmick form became saveable: ${profile.slug}`)
}

const keldeoResolute = requireProfile('keldeo-resolute')
assert.equal(getFormMetadata(keldeoResolute).requiredMove, '신비의칼')
assert(isSavablePokemonForm(keldeoResolute))
assert(normalizePokemon({ speciesId: keldeoResolute.id, moves: ['방어'] }).moves.includes('신비의칼'))
assert.equal(resolveMoveTriggeredFormSpeciesId(647, ['신비의칼']), keldeoResolute.id)
assert.equal(resolveMoveTriggeredFormSpeciesId(keldeoResolute.id, ['방어']), 647)

assert.equal(requireProfile('koraidon-limited-build').name, '코라이돈 제한형태')
assert.equal(getFormMetadata(requireProfile('miraidon-drive-mode')).formKind, 'cosmetic')

const gastrodonEast = requireProfile('gastrodon-east')
const normalizedGastrodon = normalizePokemon({
  captureId: 'form-validation-gastrodon',
  speciesId: gastrodonEast.id,
  dexSpeciesId: 423,
  directDrawCount: 1,
})
const migratedGastrodon = migratePokemonCollection([normalizedGastrodon])
assert.equal(migratedGastrodon.find((pokemon) => pokemon.dexSpeciesId === 423)?.speciesId, gastrodonEast.id)

const baseGastrodon = normalizePokemon({ ...normalizedGastrodon, speciesId: 423 })
const formCost = getTrainingCostBreakdown(baseGastrodon, normalizedGastrodon)
assert.equal(formCost.total, TRAINING_COSTS.form)
assert.equal(formCost.items[0].id, 'form')

for (const baseProfile of profiles.filter((profile) => !profile.parentSpeciesId)) {
  assert(getPersistentFormOptions(baseProfile.id).every(isSavablePokemonForm))
  assert(getBattleFormOptions(baseProfile.id).every((profile) => !isSavablePokemonForm(profile)))
}

console.log(`Validated ${profiles.length} Pokémon profiles including persistent, gender, cosmetic, item, ability, move, and battle-only forms.`)
