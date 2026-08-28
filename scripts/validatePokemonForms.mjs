import assert from 'node:assert/strict'
import trainerData from '../src/data/generatedTrainerTeams.json' with { type: 'json' }
import {
  SPECIES_PROFILES,
  canGigantamax,
  getBattleFormOptions,
  getFormMetadata,
  getGigantamaxProfile,
  getLearnableMoves,
  getPokemonGenderOptions,
  getPersistentFormOptions,
  getRelatedFormOptions,
  getSpeciesProfile,
  isBattleFormCompatible,
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
assert.deepEqual(zygardePersistent, new Set(['zygarde', 'zygarde-10']))
assert.deepEqual(slugs(getBattleFormOptions(718)), new Set(['zygarde-complete']))
assert.deepEqual(slugs(getBattleFormOptions(requireProfile('zygarde-10').id)), new Set())
assert.deepEqual(new Set(requireProfile('zygarde').abilities), new Set(['오라브레이크', '스웜체인지']))
assert.deepEqual(requireProfile('zygarde-10').abilities, ['오라브레이크'])

const zygarde10PowerConstruct = requireProfile('zygarde-10-power-construct')
const zygarde50PowerConstruct = requireProfile('zygarde-50-power-construct')
assert.equal(getFormMetadata(zygarde10PowerConstruct).canonicalFormSlug, 'zygarde-10')
assert.equal(getFormMetadata(zygarde50PowerConstruct).canonicalFormSlug, 'zygarde')
assert.equal(normalizePokemon({ speciesId: zygarde10PowerConstruct.id }).speciesId, requireProfile('zygarde-10').id)
assert.equal(normalizePokemon({ speciesId: zygarde10PowerConstruct.id }).ability, '오라브레이크')
assert.equal(
  normalizePokemon({ speciesId: requireProfile('zygarde-10').id, ability: '스웜체인지' }).ability,
  '오라브레이크',
)
assert.equal(normalizePokemon({ speciesId: zygarde50PowerConstruct.id }).speciesId, requireProfile('zygarde').id)
assert.equal(normalizePokemon({ speciesId: zygarde50PowerConstruct.id }).ability, '스웜체인지')

const migratedZygarde = migratePokemonCollection([{
  captureId: 'legacy-zygarde-power-construct',
  speciesId: zygarde10PowerConstruct.id,
  dexSpeciesId: 718,
  directDrawCount: 1,
}]).find((pokemon) => pokemon.dexSpeciesId === 718)
assert.equal(migratedZygarde?.speciesId, requireProfile('zygarde-10').id)
assert.equal(migratedZygarde?.ability, '오라브레이크')

const floettePersistent = slugs(getPersistentFormOptions(670))
for (const slug of ['floette', 'floette-blue', 'floette-orange', 'floette-white', 'floette-yellow', 'floette-eternal']) {
  assert(floettePersistent.has(slug), `Floette form is unavailable: ${slug}`)
}
assert(!slugs(getBattleFormOptions(670)).has('floette-mega'))
assert(slugs(getBattleFormOptions(requireProfile('floette-eternal').id)).has('floette-mega'))

assert(slugs(getPersistentFormOptions(423)).has('gastrodon-east'))
assert.equal(requireProfile('jellicent-f').gender, 'F')
assert.equal(requireProfile('meowstic').gender, 'M')
assert.equal(requireProfile('meowstic-female').gender, 'F')
assert.equal(requireProfile('cacturne-f').name, requireProfile('cacturne').name)
assert.equal(requireProfile('meowstic-female').name, requireProfile('meowstic').name)
assert.equal(requireProfile('ninetales-alola').name, requireProfile('ninetales').name)
assert.equal(requireProfile('ninetales-alola').formName, '나인테일 알로라의 모습')
assert.equal(requireProfile('rotom-wash').name, requireProfile('rotom').name)
assert.equal(requireProfile('aegislash-blade').name, requireProfile('aegislash').name)

const normalizedAlolanNinetales = normalizePokemon({ speciesId: requireProfile('ninetales-alola').id })
assert.equal(normalizedAlolanNinetales.name, '나인테일')
assert.equal(normalizedAlolanNinetales.formName, '나인테일 알로라의 모습')

assert.deepEqual(getPokemonGenderOptions(requireProfile('bulbasaur')), ['M', 'F'])
assert.deepEqual(getPokemonGenderOptions(requireProfile('magnemite')), [])
assert.deepEqual(getPokemonGenderOptions(requireProfile('tauros')), ['M'])
assert.deepEqual(getPokemonGenderOptions(requireProfile('miltank')), ['F'])
assert.deepEqual(getPokemonGenderOptions(requireProfile('pichu-spiky-eared')), ['F'])

const femaleBulbasaur = normalizePokemon({ speciesId: requireProfile('bulbasaur').id, gender: 'F' })
assert.equal(femaleBulbasaur.speciesId, requireProfile('bulbasaur').id)
assert.equal(femaleBulbasaur.gender, 'F')
assert.equal(
  getTrainingCostBreakdown(
    normalizePokemon({ ...femaleBulbasaur, gender: 'M' }),
    femaleBulbasaur,
  ).total,
  0,
)

const maleHippowdon = normalizePokemon({ speciesId: requireProfile('hippowdon').id, gender: 'M' })
const femaleHippowdon = normalizePokemon({ ...maleHippowdon, gender: 'F' })
assert.equal(femaleHippowdon.speciesId, requireProfile('hippowdon-f').id)
assert.equal(femaleHippowdon.gender, 'F')
assert(femaleHippowdon.spriteFront.includes('hippowdon-f'))
assert.equal(
  normalizePokemon({ ...femaleHippowdon, gender: 'M' }).speciesId,
  requireProfile('hippowdon').id,
)

const maleMeowstic = normalizePokemon({
  speciesId: requireProfile('meowstic').id,
  gender: 'M',
  moves: ['미라클아이', '방어'],
})
const femaleMeowstic = normalizePokemon({ ...maleMeowstic, gender: 'F' })
const femaleMeowsticLearnset = new Set(
  getLearnableMoves(femaleMeowstic.speciesId).map((move) => move.name),
)
assert.equal(femaleMeowstic.speciesId, requireProfile('meowstic-female').id)
assert(!femaleMeowstic.moves.includes('미라클아이'))
assert(femaleMeowsticLearnset.has('미래예지'))
assert(!femaleMeowsticLearnset.has('미라클아이'))
assert(!getTrainingCostBreakdown(maleMeowstic, femaleMeowstic).items.some((item) => item.id === 'form'))

const cosmeticGenderProfiles = profiles.filter((profile) => (
  profile.id >= 20_000
  && getFormMetadata(profile).formKind === 'gender'
  && /-f$/.test(profile.slug)
))
assert(cosmeticGenderProfiles.length > 0)
for (const profile of cosmeticGenderProfiles) {
  assert.equal(getFormMetadata(profile).hiddenFromFormPicker, true)
  assert(isSavablePokemonForm(profile))
  assert(!slugs(getPersistentFormOptions(profile.parentSpeciesId)).has(profile.slug))
}

for (const slug of ['meowstic-female', 'indeedee-female', 'oinkologne-female', 'basculegion-female']) {
  const profile = requireProfile(slug)
  assert.equal(getFormMetadata(profile).hiddenFromFormPicker, false)
  assert(!slugs(getPersistentFormOptions(profile.parentSpeciesId)).has(slug))
}

const spikyPichu = requireProfile('pichu-spiky-eared')
assert.equal(spikyPichu.gender, 'F')
assert.deepEqual(spikyPichu.abilities, ['정전기'])
assert(spikyPichu.spriteFront.includes('/pichu-spikyeared.png'))
assert.equal(getFormMetadata(spikyPichu).evolutionLocked, true)

const greninjaPersistent = slugs(getPersistentFormOptions(658))
const greninja = requireProfile('greninja')
const legacyBattleBondGreninja = requireProfile('greninja-battle-bond')
assert(!greninjaPersistent.has('greninja-battle-bond'))
assert(!greninjaPersistent.has('greninja-ash'))
assert.deepEqual(new Set(greninja.abilities), new Set(['급류', '변환자재', '유대변화']))
assert.equal(getFormMetadata(legacyBattleBondGreninja).canonicalFormSlug, 'greninja')
assert.equal(getFormMetadata(legacyBattleBondGreninja).hiddenFromFormPicker, true)
assert.equal(isSavablePokemonForm(legacyBattleBondGreninja), false)
assert.equal(normalizePokemon({ speciesId: legacyBattleBondGreninja.id }).speciesId, greninja.id)
assert.equal(normalizePokemon({ speciesId: legacyBattleBondGreninja.id }).ability, '유대변화')
assert.deepEqual(slugs(getBattleFormOptions(658)), new Set(['greninja-ash', 'greninja-mega']))
assert.equal(getFormMetadata(requireProfile('greninja-ash')).requiredAbility, '유대변화')

const migratedBattleBondGreninja = migratePokemonCollection([{
  captureId: 'legacy-greninja-battle-bond',
  speciesId: legacyBattleBondGreninja.id,
  dexSpeciesId: 658,
  directDrawCount: 1,
}]).find((pokemon) => pokemon.dexSpeciesId === 658)
assert.equal(migratedBattleBondGreninja?.speciesId, greninja.id)
assert.equal(migratedBattleBondGreninja?.ability, '유대변화')

assert.deepEqual(slugs(getBattleFormOptions(555)), new Set(['darmanitan-zen']))
assert.deepEqual(
  slugs(getBattleFormOptions(requireProfile('darmanitan-galar-standard').id)),
  new Set(['darmanitan-galar-zen']),
)
assert.deepEqual(slugs(getBattleFormOptions(778)), new Set(['mimikyu-busted']))
assert.deepEqual(
  slugs(getBattleFormOptions(requireProfile('mimikyu-totem-disguised').id)),
  new Set(['mimikyu-totem-busted']),
)
assert.deepEqual(
  slugs(getBattleFormOptions(requireProfile('minior-blue').id)),
  new Set(['minior-blue-meteor']),
)
assert.equal(getFormMetadata(requireProfile('minior-blue-meteor')).requiredAbility, '리밋실드')
assert.deepEqual(slugs(getBattleFormOptions(678)), new Set(['meowstic-male-mega']))
assert.deepEqual(
  slugs(getBattleFormOptions(requireProfile('meowstic-female').id)),
  new Set(['meowstic-female-mega']),
)
assert.deepEqual(slugs(getBattleFormOptions(800)), new Set())
assert.deepEqual(
  slugs(getBattleFormOptions(requireProfile('necrozma-dusk').id)),
  new Set(['necrozma-ultra']),
)
assert(isBattleFormCompatible(requireProfile('necrozma-dawn'), requireProfile('necrozma-ultra')))

assert.equal(getGigantamaxProfile(849)?.slug, 'toxtricity-amped-gmax')
assert.equal(
  getGigantamaxProfile(requireProfile('toxtricity-low-key').id)?.slug,
  'toxtricity-low-key-gmax',
)
assert.equal(getGigantamaxProfile(892)?.slug, 'urshifu-single-strike-gmax')
assert.equal(
  getGigantamaxProfile(requireProfile('urshifu-rapid-strike').id)?.slug,
  'urshifu-rapid-strike-gmax',
)
assert(canGigantamax(52))
assert(!canGigantamax(requireProfile('meowth-galar').id))
assert(!canGigantamax(requireProfile('pikachu-world-cap').id))
assert(!canGigantamax(requireProfile('eevee-starter').id))
assert.deepEqual(slugs(getBattleFormOptions(requireProfile('raichu-alola').id)), new Set())
assert.deepEqual(slugs(getBattleFormOptions(requireProfile('slowbro-galar').id)), new Set())

const arceusForms = getBattleFormOptions(493)
assert.equal(arceusForms.filter((profile) => profile.formMetadata.formKind === 'item').length, 17)
assert.deepEqual(requireProfile('arceus-fire').types, ['불꽃'])
assert.deepEqual(requireProfile('silvally-water').types, ['물'])

const charizardBattleForms = slugs(getBattleFormOptions(6))
assert(charizardBattleForms.has('charizard-mega-x'))
assert(charizardBattleForms.has('charizard-mega-y'))
assert(charizardBattleForms.has('charizard-gmax'))
assert(!slugs(getPersistentFormOptions(6)).has('charizard-mega-x'))
assert.equal(requireProfile('gyarados-mega').name, '메가갸라도스')
assert.equal(requireProfile('charizard-mega-x').name, '메가리자몽X')
assert.equal(requireProfile('charizard-gmax').name, '거다이맥스 리자몽')
assert.equal(requireProfile('groudon-primal').name, '원시그란돈')
for (const profile of profiles.filter((entry) => /(?:-mega(?:-x|-y|x|y)?|-gmax|-primal)$/.test(entry.slug))) {
  assert(!isSavablePokemonForm(profile), `Battle gimmick form became saveable: ${profile.slug}`)
}

for (const form of profiles.filter((profile) => (
  profile.parentSpeciesId
  && !isSavablePokemonForm(profile)
  && !getFormMetadata(profile).hiddenFromFormPicker
))) {
  const compatibleSources = getRelatedFormOptions(form.parentSpeciesId)
    .filter((source) => isSavablePokemonForm(source) && isBattleFormCompatible(source, form))
  assert(compatibleSources.length > 0, `Battle form has no compatible source form: ${form.slug}`)
}

let trainerBattleFormCount = 0
for (const trainer of trainerData.trainers) {
  for (const team of trainer.teams ?? []) {
    for (const gimmick of team.battleGimmicks ?? []) {
      if (!gimmick.targetFormSlug) continue
      trainerBattleFormCount += 1
      const sourceSlot = (team.pokemon ?? []).find((pokemon) => pokemon.slug === gimmick.pokemonSlug)
      const source = profileBySlug.get(sourceSlot?.slug)
      const target = profileBySlug.get(gimmick.targetFormSlug)
      assert(source, `Trainer battle form source is missing: ${trainer.name} team ${team.number} / ${gimmick.pokemonSlug}`)
      assert(target, `Trainer battle form target is missing: ${trainer.name} team ${team.number} / ${gimmick.targetFormSlug}`)
      assert(
        isBattleFormCompatible(source, target),
        `Trainer battle form mismatch: ${trainer.name} team ${team.number} / ${source.slug} -> ${target.slug}`,
      )
    }
  }
}
assert(trainerBattleFormCount > 0)

const keldeoResolute = requireProfile('keldeo-resolute')
assert.equal(getFormMetadata(keldeoResolute).requiredMove, '신비의칼')
assert(isSavablePokemonForm(keldeoResolute))
assert(normalizePokemon({ speciesId: keldeoResolute.id, moves: ['방어'] }).moves.includes('신비의칼'))
assert.equal(resolveMoveTriggeredFormSpeciesId(647, ['신비의칼']), keldeoResolute.id)
assert.equal(resolveMoveTriggeredFormSpeciesId(keldeoResolute.id, ['방어']), 647)

assert.equal(requireProfile('koraidon-limited-build').name, '코라이돈')
assert.equal(requireProfile('koraidon-limited-build').formName, '코라이돈 제한형태')
assert.equal(getFormMetadata(requireProfile('miraidon-drive-mode')).formKind, 'cosmetic')

const rideOnlyFormSlugs = [
  'koraidon-limited-build',
  'koraidon-sprinting-build',
  'koraidon-swimming-build',
  'koraidon-gliding-build',
  'miraidon-low-power-mode',
  'miraidon-drive-mode',
  'miraidon-aquatic-mode',
  'miraidon-glide-mode',
]

for (const slug of rideOnlyFormSlugs) {
  const profile = requireProfile(slug)
  const metadata = getFormMetadata(profile)
  const canonicalSlug = slug.startsWith('koraidon-') ? 'koraidon' : 'miraidon'

  assert.equal(metadata.formKind, 'cosmetic')
  assert.equal(metadata.saveable, false)
  assert.equal(metadata.hiddenFromFormPicker, true)
  assert.equal(metadata.canonicalFormSlug, canonicalSlug)
  assert(!slugs(getPersistentFormOptions(profile.parentSpeciesId)).has(slug))
  assert(!slugs(getBattleFormOptions(profile.parentSpeciesId)).has(slug))
  assert.equal(normalizePokemon({ speciesId: profile.id }).speciesId, profile.parentSpeciesId)
}

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

const shinyGastrodon = normalizePokemon({
  ...baseGastrodon,
  shinyObtained: true,
  isShiny: true,
})
const shinyToggleCost = getTrainingCostBreakdown(
  shinyGastrodon,
  normalizePokemon({ ...shinyGastrodon, isShiny: false }),
)
assert.equal(TRAINING_COSTS.shiny, 0)
assert.equal(shinyToggleCost.total, 0)
assert.deepEqual(shinyToggleCost.items.map((item) => item.id), ['shiny'])
assert.equal(shinyToggleCost.items[0].free, true)

for (const baseProfile of profiles.filter((profile) => !profile.parentSpeciesId)) {
  assert(getPersistentFormOptions(baseProfile.id).every(isSavablePokemonForm))
  assert(getBattleFormOptions(baseProfile.id).every((profile) => !isSavablePokemonForm(profile)))
}

console.log(`Validated ${profiles.length} Pokémon profiles and ${trainerBattleFormCount} trainer battle-form assignments.`)
