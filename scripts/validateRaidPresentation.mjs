import assert from 'node:assert/strict'
import test from 'node:test'
import { createBattleTurnTimeline, getActivePokemonList } from '../src/data/battleEngine.js'
import { createRaidBattle, getRaidBattleView, raidRandom, validateRaidCommand, resolveRaidTurn } from '../server/raidBattle.js'
import { normalizePokemon, getLearnableMoves, getMoveById } from '../src/data/trainingData.js'
import { applyRaidPresentation, captureRaidPresentation, sanitizeRaidPresentation, stampRaidPresentationLog } from '../src/data/raidPresentation.js'
import { createRaidCommandBattle } from '../src/data/raidCommandView.js'
import { raidEvent, beginRaidDamageRoot, applyBattleHpLoss, finishRaidDamageRoot } from '../src/data/raidPolicy.js'

const owner = index => `private-presentation-owner-${index}`
function fixture(speciesId, ids) {
  const legal = new Set(getLearnableMoves(speciesId).map(move => move.id))
  ids.forEach(id => assert(legal.has(id), `Illegal fixture move: ${speciesId}/${id}`))
  return createRaidBattle({ raidId: 'presentation-test', bossId: 'mewtwo', members: [0, 1, 2].map(index => ({
    ownerId: owner(index), displayName: `참가자 ${index + 1}`,
    pokemon: normalizePokemon({ speciesId, captureId: `presentation-${index}`, moves: ids.map(id => getMoveById(id).name) }),
  })) })
}
function actions(state, moveIndex = 0, gimmick = null) {
  return [0, 1, 2].map(index => validateRaidCommand(state, owner(index), {
    type: 'move', moveIndex, gimmick: index === 0 ? gimmick : null,
    targetActorId: state.opponent.team[0].battleId,
  }))
}
const actorState = actor => ({ hp: actor.hp, maxHp: actor.maxHp, name: actor.name, status: actor.status ?? null,
  fainted: actor.fainted ?? null, statStages: actor.statStages, types: actor.types,
  teraActive: actor.teraActive ?? null, dynamaxActive: actor.dynamaxActive ?? null,
  raidForm: actor.raidForm ?? null, raidVitalityStage: actor.raidVitalityStage ?? null })
const cuePhases = new Set(['announce', 'impact', 'gimmick', 'form', 'status', 'resolve', 'switch', 'switch-out', 'faint', 'residual'])

function assertReplay(state, playerActions, seed) {
  const initial = getRaidBattleView(state, owner(0))
  const cursor = state.raid.eventSequence
  // The reference is the existing engine's actual per-step timeline, not the
  // presentation code. Opponents use legal moves selected explicitly here.
  const opponent = [0, 1, 2].map(actorSlot => ({ type: 'move', actorSlot, moveIndex: 0, targetSideId: 'player', targetSlot: 0 }))
  const resolution = createBattleTurnTimeline(state, playerActions, raidRandom(seed), opponent)
  const steps = resolution.timeline.filter(step => cuePhases.has(step.phase))
  const events = resolution.state.raid.events.filter(event => Number(event.id.split(':').at(-1)) > cursor)
  let shown = initial, index = 0
  const frames = []
  for (const event of events) {
    shown = applyRaidPresentation(shown, event.presentation)
    frames.push({ event, shown })
    if (event.kind !== 'battle-cue') continue
    const step = steps[index++]
    assert(step, `Missing engine step for ${event.cuePhase}`)
    assert.equal(event.cuePhase, step.phase)
    for (const sideId of ['player', 'opponent']) {
      const actual = new Map(shown[sideId].team.map(actor => [actor.battleId, actor]))
      for (const actor of getActivePokemonList(step.state, sideId)) {
        assert.deepEqual(actorState(actual.get(actor.battleId)), actorState(actor), `${event.id}/${event.cuePhase}/${actor.battleId}`)
      }
    }
    assert.deepEqual(shown.rules.weather, step.state.rules.weather)
    assert.deepEqual(shown.rules.terrain, step.state.rules.terrain)
  }
  assert.equal(index, steps.length)
  return { initial, frames, resolution }
}

test('spread damage, faints and residuals replay the same intermediate HP as the standard battle timeline', () => {
  const state = fixture(445, ['earthquake', 'rockslide', 'swordsdance', 'protect'])
  const { frames } = assertReplay(state, actions(state), 'spread-frames')
  const impacts = frames.filter(({ event }) => event.cuePhase === 'impact' && event.moveId === 'earthquake')
  assert(impacts.length >= 3, 'Actual spread attacks must contain each resolved hit')
  assert(new Set(impacts.map(({ event }) => event.targetActorId)).size >= 3)
  const first = impacts[0]
  const target = first.shown[first.event.targetSideId].team.find(actor => actor.battleId === first.event.targetActorId)
  assert.equal(target.hp, first.event.presentation.actors.find(actor => actor.battleId === target.battleId).hp)
  assert(frames.some(({ event }) => event.cuePhase === 'announce' && event.presentation.actors.length === 0), 'Unchanged actors are omitted from compact frames')
})

test('tera activation is sent before attacks and reflects the actual transformed types', () => {
  const state = fixture(445, ['earthquake', 'rockslide', 'swordsdance', 'protect'])
  const { frames } = assertReplay(state, actions(state, 0, 'tera'), 'tera-frames')
  const gimmickIndex = frames.findIndex(({ event }) => event.cuePhase === 'gimmick')
  const attackIndex = frames.findIndex(({ event }) => event.cuePhase === 'announce')
  assert(gimmickIndex >= 0 && gimmickIndex < attackIndex)
  const { event, shown } = frames[gimmickIndex]
  assert.equal(event.mechanicId, 'tera')
  assert.equal(shown.player.team[0].teraActive, true)
})

test('multi-hit attacks preserve each actual impact instead of jumping to final HP', () => {
  const state = fixture(214, ['pinmissile', 'armthrust', 'swordsdance', 'protect'])
  const { frames } = assertReplay(state, actions(state), 'multihit-frames')
  const impacts = frames.filter(({ event }) => event.cuePhase === 'impact' && event.moveId === 'pinmissile' && event.actorId === state.player.team[0].battleId)
  assert(impacts.length >= 2)
  const hp = impacts.map(({ event, shown }) => shown.opponent.team.find(actor => actor.battleId === event.targetActorId).hp)
  assert(hp.every((value, index) => index === 0 || value <= hp[index - 1]))
  assert(new Set(hp).size >= 2)
})

test('recovery and status moves have real resolve frames, including all healed allies', () => {
  const state = fixture(242, ['lifedew', 'healpulse', 'thunderwave', 'protect'])
  // Local pre-damage isolates healing without introducing any production hook.
  state.player.team.forEach(actor => { actor.hp = Math.ceil(actor.maxHp / 2) })
  const { frames } = assertReplay(state, actions(state), 'recovery-frames')
  const recovery = frames.filter(({ event }) => ['resolve', 'status'].includes(event.cuePhase) && event.moveId === 'lifedew' && event.actorId === state.player.team[0].battleId)
  assert(recovery.length >= 3, 'Each actually healed ally must receive its own standard status frame')
  assert.equal(new Set(recovery.flatMap(({ event }) => event.presentation.actors.filter(actor => actor.sideId === 'player').map(actor => actor.actorId))).size, 3)
  assert(recovery.every(({ event }) => event.presentation.logs.some(entry => entry.message.includes('회복'))))
})

test('dynamax move previews and targets match actual engine command variants', () => {
  const state = fixture(445, ['earthquake', 'rockslide', 'swordsdance', 'protect'])
  const view = getRaidBattleView(state, owner(0))
  assert.equal(view.moves[0].preview.name, '지진')
  assert.equal(view.moves[0].variants.dynamax.preview.name, '다이어스')
  assert.equal(view.moves[0].variants.dynamax.preview.isMaxMove, true)
  assert(view.moves[0].variants.dynamax.targets.every(target => target.sideId === 'opponent'))
  assert.equal(view.moves[3].variants.dynamax.preview.name, '다이월')
  assert(view.moves.every(move => !move.variants.dynamax.disabled))
})

test('charging and recharging expose authoritative forced actions accepted without reselecting a target', () => {
  for (const moveId of ['solarbeam', 'hyperbeam']) {
    const state = fixture(150, [moveId, 'psychic', 'recover', 'protect'])
    const commands = Object.fromEntries(actions(state).map((action, index) => [owner(index), action]))
    const next = resolveRaidTurn(state, commands, { seed: `forced-${moveId}` })
    const view = getRaidBattleView(next, owner(0))
    assert(view.forcedAction, `Expected ${moveId} continuation`)
    const accepted = validateRaidCommand(next, owner(0), { ...view.forcedAction, actorId: view.ownActorId })
    assert.deepEqual(accepted, { ...view.forcedAction, actorSlot: view.ownActorSlot, actorId: view.ownActorId })
  }
})

test('boss gate frames preserve HP ratio, transformed identity and raid additions separately', () => {
  const state = fixture(150, ['psychic', 'aurasphere', 'recover', 'protect'])
  state.raid.phase = 2
  state.raid.primaryBossId = state.opponent.team[0].battleId
  state.raid.bossId = 'mewtwo'
  const boss = state.opponent.team[0]
  boss.maxHp = 4000; boss.hp = 3000
  raidEvent(state, 'fixture-start', '보스 구간 검증')
  const before = getRaidBattleView(state, owner(0))
  const cursor = state.raid.eventSequence
  beginRaidDamageRoot(state, 'gate-test')
  applyBattleHpLoss(state, boss, 1000)
  finishRaidDamageRoot(state)
  let shown = before
  for (const event of state.raid.events.filter(event => Number(event.id.split(':').at(-1)) > cursor)) shown = applyRaidPresentation(shown, event.presentation)
  assert.equal(shown.opponent.team[0].name, '아머드 뮤츠')
  assert.equal(shown.opponent.team[0].hp / shown.opponent.team[0].maxHp, 0.5)
  assert.equal(shown.opponent.team[0].raidForm, 'armored')
  assert.deepEqual(shown.raid.firedMechanics, [50])
})

test('presentation sanitizer rejects private state and caps actors, logs and removals', () => {
  const state = fixture(445, ['earthquake', 'rockslide', 'swordsdance', 'protect'])
  const frame = structuredClone(state.raid.events[0].presentation)
  frame.state = { secret: 'hidden-state' }
  frame.actors[0].raidOwnerId = 'hidden-owner'
  frame.actors[0].moves = [{ name: 'hidden-move' }]
  frame.actors = [...frame.actors, ...frame.actors]
  frame.logs = Array.from({ length: 100 }, () => ({ message: '공개', tone: 'normal', command: 'hidden-command' }))
  frame.removedActorIds = Array.from({ length: 20 }, (_, index) => `removed-${index}`)
  const safe = sanitizeRaidPresentation(frame)
  assert.equal(safe.actors.length, 6)
  assert.equal(safe.logs.length, 32)
  assert.equal(safe.removedActorIds.length, 6)
  for (const secret of ['hidden-state', 'hidden-owner', 'hidden-move', 'hidden-command', owner(0)]) assert(!JSON.stringify(safe).includes(secret))
  assert(!JSON.stringify(getRaidBattleView(state, owner(0))).includes('presentationFrame'))
})

test('identical log entries remain sequenced after the engine trims its eighty-entry log', () => {
  const state = fixture(445, ['earthquake', 'rockslide', 'swordsdance', 'protect'])
  for (let index = 0; index < 100; index++) {
    state.log.push(stampRaidPresentationLog(state, { id: 'repeated-engine-id', message: '효과가 굉장했다!', tone: 'damage' }))
    if (state.log.length > 80) state.log.splice(0, state.log.length - 80)
    const frame = captureRaidPresentation(state)
    assert.deepEqual(frame.logs, [{ message: '효과가 굉장했다!', tone: 'damage' }])
    assert(!JSON.stringify(frame).includes('raidLogSequence'))
  }
})

test('standard command adapter retains each human slot and uses server-owned target and gimmick variants', () => {
  const state = fixture(242, ['healpulse', 'lifedew', 'thunderwave', 'protect'])
  for (let index = 0; index < 3; index++) {
    const view = getRaidBattleView(state, owner(index))
    const adapted = createRaidCommandBattle(view, { ownActorId: view.ownActorId })
    assert.equal(adapted.activeSlot, index)
    assert.equal(adapted.battle.player.team[index].battleId, state.player.team[index].battleId)
    assert.equal(adapted.battle.commandOptions[index].moves.length, 4)
    assert(adapted.battle.commandOptions.filter((_, slot) => slot !== index).every(option => option.moves.length === 0))
    const healing = adapted.battle.commandOptions[index].moves[0]
    for (const target of healing.targets) {
      const command = { type: 'move', moveIndex: 0, targetActorId: target.actorId }
      assert.doesNotThrow(() => validateRaidCommand(state, owner(index), command))
    }
    assert.equal(adapted.battle.commandOptions[index].moves[3].variants.dynamax.preview.name, '다이월')
  }
})
