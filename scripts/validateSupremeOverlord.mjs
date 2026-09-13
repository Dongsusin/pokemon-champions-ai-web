import assert from 'node:assert/strict'
import test from 'node:test'
import { createBattle, createBattleTurnTimeline, playBattleTurnWithActions, resumeHumanBattleTurnTimeline } from '../src/data/battleEngine.js'
import { getLearnableMoves, getMoveById, SPECIES_PROFILES } from '../src/data/trainingData.js'
import { getRankedBattleView, getRankedTimelineView } from '../server/rankedBattle.js'

// Source: Pokemon Showdown data/abilities.ts, supremeoverlord onStart and
// onBasePower. The activation snapshots side.totalFainted, capped at five.
const profiles = new Map(Object.values(SPECIES_PROFILES).map(p => [p.slug, p]))
let serial = 0
function pokemon(slug, ids, ability) {
  const p = profiles.get(slug)
  assert(p)
  const legal = new Set(getLearnableMoves(p.id).map(m => m.id))
  ids.forEach(id => assert(legal.has(id), `${slug} cannot learn ${id}`))
  assert(!ability || p.abilities.includes(ability), `${slug}: ${ability}`)
  return { speciesId: p.id, captureId: `overlord-${++serial}`, ability: ability ?? p.abilities[0],
    moveIds: ids, moves: ids.map(id => getMoveById(id).name) }
}
const quiet = () => pokemon('wailord', ['splash'])
const king = (moves = ['kowtowcleave', 'darkpulse', 'protect']) => pokemon('kingambit', moves, '총대장')
function battle(players, opponents = [quiet(), quiet()], doubles = false) {
  return createBattle({ playerPokemon: players, opponent: { name: 'Supreme Overlord audit', tier: 'S' },
    opponentTeam: { pokemon: opponents, battleGimmicks: [], strategy: {} }, rules: {
      weather: { id: 'clear' }, terrain: { id: 'neutral' }, pvp: true,
      format: { id: doubles ? 'double' : 'single', activeSlots: doubles ? 2 : 1, actionSlots: doubles ? 2 : 1 },
      teamRule: { id: 'full', battleSize: 6 },
    }, random: () => 0.5 })
}
const move = (moveIndex = 0, actorSlot = 0, extra = {}) => ({ type: 'move', moveIndex, actorSlot, targetSlot: 0, ...extra })
const swap = (targetIndex, actorSlot = 0) => ({ type: 'switch', targetIndex, actorSlot })
const turn = (s, p = [], o = []) => playBattleTurnWithActions(s, p, o, () => 0.5)
function enter(fallen, side = 'player') {
  const s = side === 'player' ? battle([quiet(), king()]) : battle([quiet(), quiet()], [quiet(), king()])
  // Restore a battle history with fallen allies subsequently revived: all current
  // members are alive, so counting current corpses cannot pass this fixture.
  s[side].faintCount = fallen
  return side === 'player' ? turn(s, [swap(1)]) : turn(s, [], [swap(1)])
}
function damage(s, side = 'player', index = 0) {
  const targetSide = side === 'player' ? 'opponent' : 'player'
  const targetIndex = s[targetSide].activeIndexes[0]
  s[targetSide].team[targetIndex].hp = s[targetSide].team[targetIndex].maxHp = 5000
  const hp = s[targetSide].team[targetIndex].hp
  const after = side === 'player' ? turn(s, [move(index)]) : turn(s, [], [move(index)])
  return hp - after[targetSide].team[targetIndex].hp
}

for (const side of ['player', 'opponent']) for (const [fallen, power] of [[0,85],[1,94],[2,102],[3,111],[4,119],[5,127]]) {
  test(`${side}: ${fallen} prior faints use base power ${power}, with no stat stage boost`, () => {
    const s = enter(fallen, side)
    const attacker = s[side].team[1]
    assert.equal(attacker.supremeOverlordFallen, fallen)
    assert(Object.values(attacker.statStages).every(n => n === 0))
    assert.equal(s.log.filter(e => e.message.includes('의 총대장!')).length, fallen ? 1 : 0)
    // Independent control: same species, stats and move, neutral ability and
    // the source's fixed-point rounded base power. Final-damage multiplication
    // (the old implementation) produces a different damage roll.
    const control = structuredClone(s)
    control[side].team[1].ability = '프레셔'
    control[side].team[1].moves[0].power = power
    assert.equal(damage(s, side), damage(control, side))
  })
}

test('The boost also applies to special moves and caps at five cumulative faints', () => {
  const s = enter(9)
  assert.equal(s.player.team[1].supremeOverlordFallen, 5)
  const control = structuredClone(s)
  control.player.team[1].ability = '프레셔'
  control.player.team[1].moves[1].power = 120
  assert.equal(damage(s, 'player', 1), damage(control, 'player', 1))
})

test('An ally fainting in doubles does not increase an already-active Kingambit; re-entry does', () => {
  let s = battle([king(), pokemon('snorlax', ['selfdestruct']), quiet(), quiet()], [quiet(), quiet()], true)
  s.opponent.team.forEach(p => { p.hp = p.maxHp = 5000 })
  s = turn(s, [move(2), move(0, 1)])
  assert.equal(s.player.faintCount, 1)
  assert.equal(s.player.team[0].supremeOverlordFallen, 0)
  s = resumeHumanBattleTurnTimeline(s, 'player', 2, () => 0.5).state
  const control = structuredClone(s)
  control.player.team[0].ability = '프레셔'
  assert.equal(damage(structuredClone(s)), damage(control))
  s = turn(s, [swap(3), move(0, 1)])
  s = turn(s, [swap(0)])
  assert.equal(s.player.team[0].supremeOverlordFallen, 1)
})

test('Revival keeps the faint history; the same ally fainting again increases it', () => {
  let s = battle([pokemon('snorlax', ['selfdestruct']), pokemon('pawmot', ['revivalblessing']), king()])
  s.opponent.team.forEach(p => { p.hp = p.maxHp = 5000 })
  s = turn(s, [move()])
  assert.equal(s.player.faintCount, 1)
  s = resumeHumanBattleTurnTimeline(s, 'player', 1, () => 0.5).state
  let result = createBattleTurnTimeline(s, [move()], () => 0.5, [])
  assert.equal(result.state.pendingHumanSwitch?.kind, 'revival')
  result = resumeHumanBattleTurnTimeline(result.state, 'player', 0, () => 0.5)
  s = result.state
  assert.equal(s.player.team[0].fainted, false)
  assert.equal(s.player.faintCount, 1)
  s = turn(s, [swap(0)])
  s = turn(s, [move()])
  assert.equal(s.player.faintCount, 2)
  s = resumeHumanBattleTurnTimeline(s, 'player', 2, () => 0.5).state
  assert.equal(s.player.team[2].supremeOverlordFallen, 2)
})

test('Neutralizing Gas suppresses the boost and captures the latest history on restoration', () => {
  let s = enter(2)
  // Restore an available Weezing bench without disturbing current ability state.
  const withGas = battle([quiet(), king()], [quiet(), pokemon('weezing', ['haze'], '화학변화가스')])
  s.opponent = withGas.opponent
  s = turn(s, [], [swap(1)])
  assert.equal(s.player.team[1].ability, '')
  const control = structuredClone(s)
  control.player.team[1].ability = '프레셔'
  assert.equal(damage(structuredClone(s)), damage(control))
  s.player.faintCount = 3
  s = turn(s, [], [swap(0)])
  assert.equal(s.player.team[1].ability, '총대장')
  assert.equal(s.player.team[1].supremeOverlordFallen, 3)
})

test('Skill Swap uses the receiving side history and can refresh a later reacquisition', () => {
  let s = battle([king(['leer']), quiet()], [pokemon('alakazam', ['skillswap']), quiet()])
  s.player.faintCount = 2
  s.opponent.faintCount = 4
  s = turn(s, [move()], [move()])
  assert.equal(s.opponent.team[0].ability, '총대장')
  assert.equal(s.opponent.team[0].supremeOverlordFallen, 4)
  assert.equal(s.player.team[0].supremeOverlordFallen, null)
  s = turn(s, [move()], [move()])
  assert.equal(s.player.team[0].ability, '총대장')
  assert.equal(s.player.team[0].supremeOverlordFallen, 2)
})

test('Role Play, Entrainment and Doodle cannot refresh an unchanged Supreme Overlord', () => {
  let s = battle([pokemon('smeargle', ['roleplay', 'entrainment', 'doodle']), quiet()], [king(['sleeptalk']), quiet()], true)
  s = turn(s, [move(), move(0, 1)], [move(), move(0, 1)])
  assert.equal(s.player.team[0].ability, '총대장')
  assert.equal(s.player.team[0].supremeOverlordFallen, 0)
  s.player.faintCount = 3
  s.opponent.faintCount = 4
  for (const moveIndex of [0, 1, 2]) {
    s = turn(s, [move(moveIndex), move(0, 1)], [move(), move(0, 1)])
    assert.equal(s.player.team[0].supremeOverlordFallen, 0)
    assert.equal(s.opponent.team[0].supremeOverlordFallen, 0)
  }
  assert.equal(s.player.team[1].supremeOverlordFallen, 3, 'Doodle still activates for an ally with a different ability')
})

test('Turn and timeline clones preserve the activation and do not mutate source battle state', () => {
  const s = enter(3)
  const snapshot = structuredClone(s)
  const result = createBattleTurnTimeline(s, [move()], () => 0.5, [])
  assert.deepEqual(s, snapshot)
  assert.equal(result.state.player.team[1].supremeOverlordFallen, 3)
  assert(result.timeline.some(step => step.state?.player?.team?.[1]?.supremeOverlordFallen === 3))
})

for (const side of ['player', 'opponent']) test(`Ranked ${side} own view and persisted timeline preserve the activation`, () => {
  const s = JSON.parse(JSON.stringify(enter(3, side)))
  const result = createBattleTurnTimeline(s, [move()], () => 0.5, side === 'opponent' ? [move()] : [])
  const view = getRankedBattleView(result.state, side)
  assert.equal(view.player.team[1].ability, '총대장')
  assert.equal(view.player.team[1].supremeOverlordFallen, 3)
  const timeline = getRankedTimelineView(result.timeline, side)
  assert(timeline.some(step => step.state?.player?.team?.[1]?.supremeOverlordFallen === 3))
  assert(!('supremeOverlordFallen' in view.opponent.team[0]), 'Do not broaden unrevealed opponent metadata')
})
