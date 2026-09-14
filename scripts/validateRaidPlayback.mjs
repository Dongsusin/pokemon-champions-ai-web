import assert from 'node:assert/strict'
import { createRaidBattlePlayback, raidPlaybackVersion } from '../src/raidBattlePlayback.js'
import { createRaidCommandBattle } from '../src/data/raidCommandView.js'

let passed = 0
const test = (name, run) => { run(); console.log(`PASS ${name}`); passed++ }
const actor = (id, sideId, hp) => ({ actorId: id, battleId: id, speciesId: 150, sideId, slot: 0, name: id, hp, maxHp: 100, types: ['에스퍼'] })
const event = (number, hp, extra = {}) => ({ id: `raid:${number}`, kind: 'battle-cue', cuePhase: 'impact', message: `hit ${number}`, damage: 10,
  presentation: { actors: [actor('boss', 'opponent', hp)], logs: [{ message: `hit ${number}` }] }, ...extra })
const raid = (revision, hp, events, extra = {}) => ({ id: 'raid', revision, turnNumber: revision, lifecycle: 'input', events,
  battle: { turn: revision, player: { team: [actor('ally', 'player', 100)], activeIndexes: [0] }, opponent: { team: [actor('boss', 'opponent', hp)], activeIndexes: [0] }, log: [], raid: { eventSequence: events.at(-1) ? Number(events.at(-1).id.split(':').at(-1)) : 0 } }, ...extra })
function harness() {
  let clock = 0
  const timers = new Map()
  const frames = []
  const queue = createRaidBattlePlayback({ publish: frame => frames.push(structuredClone(frame)), duration: () => 1,
    schedule: callback => { const key = ++clock; timers.set(key, callback); return key }, unschedule: key => timers.delete(key) })
  const step = () => { const next = timers.entries().next().value; assert(next); timers.delete(next[0]); next[1]() }
  const flush = () => { for (let n = 0; timers.size; n++) { assert(n < 200); step() } }
  return { queue, frames, timers, step, flush }
}
test('new visit adopts current state without replaying old battles', () => {
  const h = harness(); const current = raid(2, 60, [event(1, 90), event(2, 60)])
  h.queue.receive(current)
  assert.equal(h.queue.getSnapshot().battle.opponent.team[0].hp, 60)
  assert.equal(h.timers.size, 0)
  assert.equal(h.queue.getSnapshot().readyVersion, raidPlaybackVersion(current))
})
test('one turn presents separate impacts in order without jumping to final HP', () => {
  const h = harness(); h.queue.receive(raid(1, 100, []))
  h.queue.receive(raid(2, 60, [event(1, 90), event(2, 60)]))
  assert.equal(h.queue.getSnapshot().battle.opponent.team[0].hp, 90)
  assert(h.queue.getSnapshot().playing)
  h.step(); assert.equal(h.queue.getSnapshot().battle.opponent.team[0].hp, 60)
  h.flush(); assert(!h.queue.getSnapshot().playing)
})
test('polling during playback does not restart sounds or duplicate cues', () => {
  const h = harness(); h.queue.receive(raid(1, 100, []))
  const next = raid(2, 60, [event(1, 90), event(2, 60)])
  h.queue.receive(next); h.queue.receive(next); h.queue.receive(next); h.flush()
  assert.deepEqual(h.frames.filter(frame => frame.cue).map(frame => frame.cue.id), ['raid:1', 'raid:2'])
})
test('intermission and terminal result wait for final hit and faint presentation', () => {
  for (const lifecycle of ['intermission', 'finished']) {
    const h = harness(); h.queue.receive(raid(1, 100, []))
    const final = raid(2, 0, [event(1, 0), event(2, 0, { cuePhase: 'faint' })], { lifecycle })
    h.queue.receive(final)
    assert.notEqual(h.queue.getSnapshot().readyVersion, raidPlaybackVersion(final))
    h.flush(); assert.equal(h.queue.getSnapshot().readyVersion, raidPlaybackVersion(final))
  }
})
test('new turn received during replay queues after the current turn', () => {
  const h = harness(); h.queue.receive(raid(1, 100, []))
  h.queue.receive(raid(2, 80, [event(1, 90), event(2, 80)]))
  h.queue.receive(raid(3, 70, [event(1, 90), event(2, 80), event(3, 70)])); h.flush()
  assert.deepEqual(h.frames.filter(frame => frame.cue).map(frame => frame.cue.id), ['raid:1', 'raid:2', 'raid:3'])
})
test('missing retained events restores server state instead of replaying incomplete deltas', () => {
  const h = harness(); h.queue.receive(raid(1, 90, [event(1, 90)]))
  h.queue.receive(raid(5, 20, [event(8, 30), event(9, 20)]))
  assert(!h.queue.getSnapshot().playing); assert.equal(h.queue.getSnapshot().battle.opponent.team[0].hp, 20)
})
test('leaving or changing raid cancels scheduled work', () => {
  const h = harness(); h.queue.receive(raid(1, 100, [])); h.queue.receive(raid(2, 80, [event(1, 90), event(2, 80)]))
  h.queue.receive(null); assert.equal(h.timers.size, 0); assert.equal(h.queue.getSnapshot().battle, null)
  h.queue.dispose(); h.queue.receive(raid(3, 70, [])); assert.equal(h.queue.getSnapshot().battle, null)
})
test('standard move menu receives only own server choices and real gimmick previews', () => {
  const current = raid(1, 100, []).battle
  current.moves = [{ id: 'psychic', name: '사이코키네시스', moveIndex: 0, variants: { dynamax: { preview: { name: '다이사이코', power: 130 }, disabled: false, targets: [{ actorId: 'boss', sideId: 'opponent', slot: 0 }] } } }]
  const adapted = createRaidCommandBattle(current, { ownActorId: 'ally' })
  assert.equal(adapted.activeSlot, 0)
  assert.equal(adapted.battle.commandOptions[0].moves[0].variants.dynamax.preview.name, '다이사이코')
  assert.equal(adapted.battle.commandOptions[0].moves[0].variants.tera, undefined)
  assert.equal(adapted.battle.rules.format.activeSlots, 3)
})
console.log(`${passed} raid playback checks passed`)
