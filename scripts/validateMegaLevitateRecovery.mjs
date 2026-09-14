import assert from 'node:assert/strict'
import test from 'node:test'
import { createBattle, playBattleTurnWithActions } from '../src/data/battleEngine.js'
import { SPECIES_PROFILES, getLearnableMoves, getMoveById } from '../src/data/trainingData.js'

// Primary reference: Showdown sim/pokemon.ts formeChange/ignoringAbility/isGrounded.
// A permanent form replaces its base ability; ongoing Gastro Acid/Gas still
// suppress it, and switching/restoring Gas must recover the new form ability.
const profiles = new Map(Object.values(SPECIES_PROFILES).map(profile => [profile.slug, profile]))
let serial = 0
function mon(slug, moveIds, options = {}) {
  const profile = profiles.get(slug)
  assert(profile, slug)
  const legal = new Set(getLearnableMoves(profile.id).map(move => move.id))
  for (const id of moveIds) assert(legal.has(id), `${slug}: ${id}`)
  const ability = options.ability ?? profile.abilities[0]
  assert(profile.abilities.includes(ability), `${slug}: ${ability}`)
  return { speciesId: profile.id, captureId: `levitate-recovery-${++serial}`, ability,
    moveIds, moves: moveIds.map(id => getMoveById(id).name), ...options }
}
const garchomp = () => mon('garchomp', ['swordsdance'], { heldItemId: 'garchompite-z' })
const idle = () => mon('smeargle', ['agility'])
const move = (moveIndex = 0, extra = {}) => ({ type: 'move', actorSlot: 0, targetSlot: 0, moveIndex, ...extra })
const switchTo = targetIndex => ({ type: 'switch', actorSlot: 0, targetIndex })
function battle(players, opponents, double = false) {
  return createBattle({ playerPokemon: players, opponent: { name: 'Levitate recovery', tier: 'S' },
    opponentTeam: { pokemon: opponents, battleGimmicks: [] }, rules: {
      weather: { id: 'clear' }, terrain: { id: 'neutral' }, aiDifficulty: { id: 'normal' },
      format: { id: double ? 'double' : 'single', activeSlots: double ? 2 : 1, actionSlots: double ? 2 : 1 },
      teamRule: { id: 'full', battleSize: 6 }, pvp: true,
    } })
}
const turn = (state, player = move(), opponent = move()) => playBattleTurnWithActions(state,
  Array.isArray(player) ? player : [player], Array.isArray(opponent) ? opponent : [opponent], () => 0.5)
const mega = move(0, { gimmick: 'mega' })
function assertMegaLevitate(pokemon) {
  assert.equal(pokemon.slug, 'garchomp-mega-z')
  assert.equal(pokemon.ability, '부유')
}

for (const groundMove of ['earthquake', 'earthpower']) test(`Mega Z gains Levitate before ${groundMove} on its evolution turn`, () => {
  const before = battle([garchomp()], [mon('smeargle', [groundMove])])
  const after = turn(before, mega)
  assertMegaLevitate(after.player.team[0])
  assert.equal(after.player.team[0].hp, after.player.team[0].maxHp)
  assert(after.log.some(entry => entry.message.includes('부유')))
})

test('Mega Z is immune to allied spread Earthquake immediately in doubles', () => {
  const before = battle([garchomp(), mon('garchomp', ['earthquake'])], [idle(), idle()], true)
  const after = turn(before, [mega, move(0, { actorSlot: 1 })], [move(), move(0, { actorSlot: 1 })])
  assertMegaLevitate(after.player.team[0])
  assert.equal(after.player.team[0].hp, after.player.team[0].maxHp)
  assert(after.opponent.team.every(pokemon => pokemon.hp < pokemon.maxHp))
})

function gasBattle() {
  return battle([garchomp(), idle()], [mon('weezing', ['protect'], { ability: '화학변화가스' }), mon('smeargle', ['earthquake'])])
}
test('Mega Evolution cannot activate Levitate while Neutralizing Gas remains active', () => {
  const after = turn(gasBattle(), mega)
  assert.equal(after.player.team[0].slug, 'garchomp-mega-z')
  assert.equal(after.player.team[0].ability, '', JSON.stringify({
    allies: after.player.team.map(({ ability, neutralizedAbility }) => ({ ability, neutralizedAbility })),
    enemies: after.opponent.team.map(({ ability, neutralizedAbility }) => ({ ability, neutralizedAbility })),
    log: after.log.map(entry => entry.message),
  }))
  assert.equal(after.player.team[0].neutralizedAbility, '부유')
})
test('Gas leaving restores Mega Z Levitate instead of the pre-Mega ability', () => {
  let state = turn(gasBattle(), mega)
  state = turn(state, move(), switchTo(1))
  assertMegaLevitate(state.player.team[0])
  const beforeHp = state.player.team[0].hp
  state = turn(state)
  assert.equal(state.player.team[0].hp, beforeHp)
})
test('Switching Mega Z out under Gas retains Levitate when it returns', () => {
  let state = turn(gasBattle(), mega)
  state = turn(state, switchTo(1), switchTo(1))
  state = turn(state, switchTo(0))
  assertMegaLevitate(state.player.team[0])
  assert.equal(state.player.team[0].hp, state.player.team[0].maxHp)
})
test('Pre-Mega Gastro Acid stays suppressed until switching, then restores Levitate', () => {
  let state = battle([garchomp(), idle()], [mon('smeargle', ['gastroacid', 'earthquake', 'agility'])])
  state = turn(state)
  assert.equal(state.player.team[0].abilitySuppressed, true)
  state = turn(state, mega, move(2))
  assert.equal(state.player.team[0].ability, '')
  assert.equal(state.player.team[0].originalAbility, '부유')
  state = turn(state, switchTo(1), move(2))
  state = turn(state, switchTo(0), move(1))
  assertMegaLevitate(state.player.team[0])
  assert.equal(state.player.team[0].hp, state.player.team[0].maxHp)
})
test('Mold Breaker still bypasses Mega Z Levitate after the fix', () => {
  const after = turn(battle([garchomp()], [mon('excadrill', ['earthquake'], { ability: '틀깨기' })]), mega)
  assertMegaLevitate(after.player.team[0])
  assert(after.player.team[0].hp < after.player.team[0].maxHp)
})
test('Switching after suppressed Mega Evolution restores the new form instead of Sand Veil', () => {
  let state = battle([garchomp(), idle()], [mon('smeargle', ['gastroacid', 'earthquake', 'agility'])])
  state = turn(state)
  state = turn(state, mega, move(2))
  state = turn(state, switchTo(1), move(2))
  state = turn(state, switchTo(0), move(1))
  assertMegaLevitate(state.player.team[0])
  assert.equal(state.player.team[0].hp, state.player.team[0].maxHp)
})
