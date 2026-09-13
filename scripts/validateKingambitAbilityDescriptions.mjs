import assert from 'node:assert/strict'
import pokemonData from '../src/data/generatedPokemonData.json' with { type: 'json' }
import { getAbility, getSpeciesProfile, normalizePokemon } from '../src/data/trainingData.js'

// These descriptions are maintained in the existing curated ability override,
// which must remain authoritative after a catalog regeneration. Engine effects
// are covered separately; this check protects player-facing conditions/numbers.
const names = ['총대장', '오기', '프레셔']
assert.deepEqual(new Set(getSpeciesProfile(983).abilities), new Set(names))
const descriptions = Object.fromEntries(names.map(name => [name, getAbility(name)]))
for (const name of names) {
  const pokemon = normalizePokemon({ speciesId: 983, captureId: `ability-copy-${name}`, ability: name })
  assert.equal(pokemon.ability, name)
  assert.notEqual(descriptions[name].trigger, '조건 충족 시')
  assert.doesNotMatch(descriptions[name].description, /조건을 만족하면 배틀 중 효과가 발동/)
}

const supreme = descriptions.총대장
assert.match(supreme.trigger, /등장 시/)
assert.match(supreme.description, /등장 시점.*누적 횟수당 기술 위력.*10%/)
assert.match(supreme.description, /최대 50%.*1\.5배/)
assert.match(supreme.description, /부활 후 다시 기절한 횟수도 포함/)
assert.match(supreme.description, /교대할 때까지 유지.*재등장 시 갱신/)
assert.match(supreme.description, /능력치 랭크는 변하지 않는다/)
assert.match(descriptions.오기.description, /상대.*능력치 랭크.*공격이 2랭크/)
assert.match(descriptions.오기.description, /자신이나 아군.*발동하지 않는다/)
assert.match(descriptions.프레셔.description, /자신을 대상으로.*상대.*PP를 1 더 소모/)
assert.match(descriptions.프레셔.description, /여러 프레셔.*각각 추가 소모/)
assert.match(descriptions.프레셔.description, /아군의 기술에는 적용되지 않는다/)

// Model PokeAPI regeneration replacing localized flavor text with generic or
// missing descriptions. Only the imported JSON object is changed in memory;
// the checked-in generated file and all other abilities remain untouched.
const generatedAbilities = pokemonData.abilities
try {
  pokemonData.abilities = {
    ...generatedAbilities,
    ...Object.fromEntries(names.map(name => [name, {
      trigger: '조건 충족 시', description: `${name}의 조건을 만족하면 배틀 중 효과가 발동한다.`,
    }])),
  }
  const regenerated = await import('../src/data/trainingData.js?kingambit-description-regeneration')
  for (const name of names) assert.deepEqual(regenerated.getAbility(name), descriptions[name], `${name}: curated copy must survive regeneration`)
  console.log('PASS Kingambit ability descriptions: three selectable abilities, exact conditions/numbers, regeneration-safe overrides.')
} finally {
  pokemonData.abilities = generatedAbilities
}
