import assert from 'node:assert/strict'
import test from 'node:test'
import { TRAINERS } from '../src/data/trainerTeams.js'
import { getTrainerSpriteCandidates } from '../src/data/trainerSprites.js'
import { getLearnableMoves, getSpeciesProfile, normalizePokemon } from '../src/data/trainingData.js'
import { applyRaidPresentation } from '../src/data/raidPresentation.js'
import { createRaidNpcAssignments, getRaidNpcAssignments, getRaidNpcTrainer, getRaidNpcLoadout } from '../server/raidTrainers.js'
import { createRaidBattle, createRaidNpcMember, getRaidBattleView, chooseRaidCommand,
  validateRaidCommand, resolveRaidTurn, startRaidBossStage } from '../server/raidBattle.js'

const human = (index, slotId = index) => ({ ownerId: `trainer-fixture-human-${index}`, displayName: `트레이너 ${index}`,
  slotId, pokemon: normalizePokemon({ speciesId: 1008, captureId: `fixture-miraidon-${index}`,
    moves: ['라이트닝드라이브', '용의파동', '명상', '방어'] }) })

test('NPC partners are distinct existing AI trainers, randomized once and stable after restore', () => {
  const names = new Set()
  for (let index = 0; index < 100; index++) {
    const seed = `trainer-room-${index}`
    const pair = createRaidNpcAssignments(seed)
    assert.equal(pair.length, 2)
    assert.equal(new Set(pair.map(profile => profile.trainerId)).size, 2)
    assert.deepEqual(pair, createRaidNpcAssignments(seed))
    assert.deepEqual(pair, getRaidNpcAssignments({ id: 'changed-seed-does-not-reroll', npcTrainers: structuredClone(pair) }))
    for (const profile of pair) {
      const catalog = TRAINERS.find(trainer => trainer.id === profile.trainerId)
      assert(catalog)
      assert.equal(profile.name, catalog.name)
      assert(getTrainerSpriteCandidates(catalog).includes(profile.image))
      assert.equal(getRaidNpcLoadout(profile).speciesId, profile.speciesId)
      assert.equal(getRaidNpcTrainer({ ...profile, name: 'forged name', image: 'https://invalid.test/fake.png' }).name, catalog.name)
      names.add(profile.name)
    }
  }
  assert(names.size > 30, 'Different rooms should receive a varied AI roster')
  assert.deepEqual(getRaidNpcAssignments({ id: 'legacy-room' }), getRaidNpcAssignments({ id: 'legacy-room' }))
})

test('Every possible selected trainer set becomes a legal level-50 Pokemon with its catalog item', () => {
  let checked = 0
  for (const trainer of TRAINERS) for (const team of trainer.teams) {
    const aces = team.pokemon.flatMap((pokemon, index) => pokemon.speciesId === trainer.ace?.speciesId
      || pokemon.dexSpeciesId === trainer.ace?.dexSpeciesId ? [index] : [])
    for (const pokemonIndex of aces.length ? aces : team.pokemon.map((_, index) => index)) {
      const assignment = { trainerId: trainer.id, teamNumber: team.number, pokemonIndex }
      const source = getRaidNpcLoadout(assignment)
      const member = createRaidNpcMember(assignment, 1)
      const pokemon = member.pokemon
      const legal = new Set(getLearnableMoves(pokemon.speciesId).map(move => move.id))
      assert.equal(member.displayName, trainer.name)
      assert.equal(pokemon.level, 50)
      assert.equal(pokemon.speciesId, normalizePokemon(source).speciesId)
      assert.equal(pokemon.heldItemId, source.heldItemId ?? '')
      assert(getSpeciesProfile(pokemon.speciesId).abilities.includes(pokemon.ability))
      assert(pokemon.moveIds.length >= 1 && pokemon.moveIds.length <= 4)
      assert(pokemon.moveIds.every(moveId => legal.has(moveId)))
      assert.deepEqual(getRaidNpcLoadout(assignment), source, 'Canonicalization cannot alter the shared AI catalog')
      checked++
    }
  }
  assert(checked >= TRAINERS.length * 3)
  console.log(`Validated ${checked} selectable AI trainer sets.`)
})

test('Solo/duo/trio fill only vacant slots and retain preview trainer identities into the boss phase', () => {
  const pair = createRaidNpcAssignments('persisted-room')
  for (const count of [1, 2, 3]) {
    const members = Array.from({ length: count }, (_, index) => human(index))
    const npcTrainers = [1, 2].filter(slot => slot >= count).map(slotId => ({ ...pair[slotId - 1], slotId }))
    let battle = createRaidBattle({ raidId: `count-${count}`, bossId: 'mewtwo', members, npcTrainers, seed: 'new-start-seed' })
    assert.equal(battle.raid.members.filter(member => member.isNpc).length, 3 - count)
    const before = getRaidBattleView(battle, members[0].ownerId).player.team.filter(actor => actor.isNpc)
    let playbackView = getRaidBattleView(battle, members[0].ownerId)
    assert.deepEqual(before.map(actor => actor.trainer.id), npcTrainers.map(npc => npc.trainerId))
    assert.deepEqual(before.map(actor => actor.displayName), npcTrainers.map(npc => npc.name))
    assert.deepEqual(before.map(actor => actor.trainerImage), npcTrainers.map(npc => npc.image))
    for (const member of battle.raid.members) {
      const command = chooseRaidCommand(battle, member.ownerId, { seed: 'first-action' })
      assert(command)
      assert.doesNotThrow(() => validateRaidCommand(battle, member.ownerId, command))
    }
    battle = resolveRaidTurn(battle, {}, { seed: 'legal-random-trainer-turn' })
    assert.equal(battle.raid.members.filter(member => member.isNpc).length, 3 - count)
    // Engine-only fixture completes the prelude, so restoration is checked
    // without adding any forced-HP capability to the real API or UI.
    battle.opponent.team.forEach(actor => { actor.hp = 0; actor.fainted = true })
    const boss = startRaidBossStage(structuredClone(battle), { seed: 'different-boss-stage-seed' })
    assert.deepEqual(boss.raid.members, battle.raid.members)
    const after = getRaidBattleView(boss, members[0].ownerId).player.team.filter(actor => actor.isNpc)
    assert.deepEqual(after.map(actor => [actor.trainer, actor.trainerImage, actor.displayName]),
      before.map(actor => [actor.trainer, actor.trainerImage, actor.displayName]))
    assert(after.every(actor => actor.hp === actor.maxHp))
    for (const event of boss.raid.events) playbackView = applyRaidPresentation(playbackView, event.presentation)
    assert.deepEqual(playbackView.player.team.filter(actor => actor.isNpc).map(actor => [actor.trainer, actor.trainerImage, actor.displayName]),
      before.map(actor => [actor.trainer, actor.trainerImage, actor.displayName]), 'Public HP/move and stage-reset frames retain the actual trainer identity')
    const recovered = getRaidBattleView(structuredClone(boss), members[0].ownerId)
    assert.deepEqual(recovered.player.team, getRaidBattleView(boss, members[0].ownerId).player.team)
  }
})

test('An empty middle or host slot preserves room positions and command ownership', () => {
  const pair = createRaidNpcAssignments('slot-room')
  for (const vacant of [0, 1, 2]) {
    const slots = [0, 1, 2].filter(slot => slot !== vacant)
    const members = slots.map((slot, index) => human(index, slot))
    const assignment = { ...pair[0], slotId: vacant }
    const battle = createRaidBattle({ raidId: `slot-${vacant}`, bossId: 'lugia', members, npcTrainers: [assignment] })
    const view = getRaidBattleView(battle, members[1].ownerId)
    assert.equal(view.player.team[vacant].isNpc, true)
    assert.equal(view.player.team[vacant].trainer.id, assignment.trainerId)
    assert.equal(view.ownActorSlot, members[1].slotId)
    assert(view.player.team[view.ownActorSlot].isMine)
  }
})

test('Legacy role flags cannot select an NPC and invalid/duplicate descriptors recover a distinct server pair', () => {
  const options = { raidId: 'fallback', bossId: 'hooh', members: [human(0)], seed: 'fallback-seed' }
  const expected = createRaidBattle(options)
  const roleAttempt = createRaidBattle({ ...options, npcRoles: ['support', 'support'] })
  const pair = createRaidNpcAssignments('untrusted-duplicate')
  const duplicate = createRaidBattle({ ...options, npcTrainers: [pair[0], pair[0]] })
  const invalid = createRaidBattle({ ...options, npcTrainers: [{ trainerId: 'invented-trainer' }] })
  for (const battle of [roleAttempt, duplicate, invalid]) {
    assert.deepEqual(battle.raid.members, expected.raid.members)
    assert.equal(new Set(battle.raid.members.filter(member => member.isNpc).map(member => member.trainer.id)).size, 2)
  }
})
