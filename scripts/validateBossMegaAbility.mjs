import assert from 'node:assert/strict'
import test from 'node:test'
import { createBossChallengeBattle, createBossOpponent } from '../src/data/bossChallenge.js'
import { playBattleTurnWithActions } from '../src/data/battleEngine.js'
import { getSpeciesProfile } from '../src/data/trainingData.js'

const move = moveIndex => ({ type: 'move', actorSlot: 0, targetSlot: 0, moveIndex })
const turn = (state, action) => playBattleTurnWithActions(state, [action], [], () => 0.5)
function battle(lead, megaForm) {
  const party = [lead, ...[143, 3, 6, 9, 25].map(speciesId => ({ speciesId }))]
    .map((entry, index) => createBossOpponent(entry, `boss-mega-ability-${index}`))
  const state = createBossChallengeBattle({ bossId: 'mewtwo', round: 3, party, random: () => 0.5 })
  state.raid.megaForm = megaForm
  // Isolate gated forms from Life Orb damage paid by the boss itself.
  state.opponent.team[0].heldItemId = ''
  state.opponent.team[0].heldItemName = ''
  return state
}

function reachMega(state, moveIndex) {
  for (const gate of [75, 50, 25]) {
    const boss = state.opponent.team[0]
    const maximumBefore = boss.maxHp
    boss.hp = Math.floor(boss.maxHp * gate / 100) + 1
    state = turn(state, move(moveIndex))
    assert(state.raid.firedMechanics.includes(gate), `${gate}% mechanic ran`)
    if (gate !== 75) assert.equal(state.opponent.team[0].maxHp, maximumBefore, 'form changes preserve boosted boss max HP')
  }
  assert.equal(state.opponent.team[0].hp, Math.floor(state.opponent.team[0].maxHp / 4), 'Mega Evolution does not heal')
  return state
}

for (const [form, speciesId] of [['mewtwo-mega-x', 10043], ['mewtwo-mega-y', 10044]]) {
  const expectedAbility = getSpeciesProfile(speciesId).abilities[0]

  test(`${form}: gated evolution stores the new permanent ability and keeps HP`, () => {
    const state = reachMega(battle({ speciesId: 235, moves: ['swift', 'agility'] }, form), 0)
    const boss = state.opponent.team[0]
    assert.equal(boss.slug, form)
    assert.equal(boss.ability, expectedAbility)
    assert.equal(boss.originalAbility, expectedAbility)
    assert.equal(boss.neutralizedAbility, null)
  })

  test(`${form}: Neutralizing Gas suppresses the new ability, then restores it when Gas leaves`, () => {
    let state = reachMega(battle({ speciesId: 110, ability: '화학변화가스', moves: ['sludgebomb', 'protect'] }, form), 0)
    let boss = state.opponent.team[0]
    assert.equal(boss.ability, '')
    assert.equal(boss.originalAbility, expectedAbility)
    assert.equal(boss.neutralizedAbility, expectedAbility)
    state = turn(state, { type: 'switch', actorSlot: 0, targetIndex: 1 })
    boss = state.opponent.team[0]
    assert.equal(boss.ability, expectedAbility)
    assert.equal(boss.neutralizedAbility, null)
  })

  test(`${form}: Gastro Acid remains active across the gate without reviving the old ability`, () => {
    let state = battle({ speciesId: 235, moves: ['gastroacid', 'swift', 'agility'] }, form)
    state = turn(state, move(0))
    assert.equal(state.opponent.team[0].abilitySuppressed, true)
    state = reachMega(state, 1)
    const boss = state.opponent.team[0]
    assert.equal(boss.abilitySuppressed, true)
    assert.equal(boss.ability, '')
    assert.equal(boss.originalAbility, expectedAbility)
    assert.equal(boss.neutralizedAbility, null)
  })
}
