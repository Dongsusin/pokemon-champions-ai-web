import assert from 'node:assert/strict'
import { attemptItemEquip } from '../src/data/shopData.js'

const pokemon = [
  { captureId: 'team-1-holder', heldItemId: 'leftovers' },
  { captureId: 'team-1-target', heldItemId: null },
  { captureId: 'team-2-target', heldItemId: null },
]
const inventory = { leftovers: 1 }

const sameTeam = attemptItemEquip(
  pokemon,
  inventory,
  'team-1-target',
  'leftovers',
  ['team-1-holder', 'team-1-target'],
)
assert.equal(sameTeam.ok, false)
assert.equal(sameTeam.reason, 'item-unavailable')

const otherTeam = attemptItemEquip(
  pokemon,
  inventory,
  'team-2-target',
  'leftovers',
  ['team-2-target'],
)
assert.equal(otherTeam.ok, true)
assert.equal(otherTeam.pokemon.find((entry) => entry.captureId === 'team-2-target').heldItemId, 'leftovers')
assert.equal(otherTeam.pokemon.find((entry) => entry.captureId === 'team-1-holder').heldItemId, 'leftovers')

const legacyGlobalScope = attemptItemEquip(pokemon, inventory, 'team-2-target', 'leftovers')
assert.equal(legacyGlobalScope.ok, false)

console.log('Team-scoped held item validation passed: duplicates are blocked within a team and allowed across teams.')
