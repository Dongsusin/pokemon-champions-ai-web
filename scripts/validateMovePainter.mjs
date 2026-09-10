import assert from 'node:assert/strict'
import battleMoves from '../src/data/generatedBattleMoves.json' with { type: 'json' }
import { getMoveAnimationProfile } from '../src/data/moveAnimationData.js'
import { getMoveChoreography, MOVE_CHOREOGRAPHY_FAMILIES } from '../src/data/moveChoreographyData.js'
import { paintBattleMove } from '../src/battleMovePainter.js'

// A strict recording Canvas2D implements the operations used by the renderer.
// Unlike a no-op mock, it checks geometry, compositing state, transform balance,
// actually visible draws, and the amount of work performed for every frame.
const stateKeys = ['globalAlpha', 'lineWidth', 'lineJoin', 'lineCap', 'strokeStyle', 'fillStyle', 'font', 'imageSmoothingEnabled']
const initialState = { globalAlpha: 1, lineWidth: 1, lineJoin: 'miter', lineCap: 'butt',
  strokeStyle: '#000000', fillStyle: '#000000', font: '10px sans-serif', imageSmoothingEnabled: true }
const identity = [1, 0, 0, 1, 0, 0]
const freeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze)
    Object.freeze(value)
  }
  return value
}
const finite = (...values) => values.forEach((value) => {
  assert.equal(typeof value, 'number', `Non-numeric canvas argument: ${value}`)
  assert(Number.isFinite(value), `Non-finite canvas argument: ${value}`)
  assert(Math.abs(value) < 1e6, `Unbounded canvas argument: ${value}`)
})

class RecordingContext {
  constructor(record = false) {
    this.state = { ...initialState }
    this.matrix = [...identity]
    this.stack = []
    this.path = []
    this.draws = []
    this.operations = 0
    this.visibleDraws = 0
    this.clears = 0
    this.record = record
    this.bounds = [Infinity, Infinity, -Infinity, -Infinity]
    stateKeys.forEach((key) => Object.defineProperty(this, key, {
      get: () => this.state[key],
      set: (value) => {
        this.operations++
        if (key === 'globalAlpha') { finite(value); assert(value >= 0 && value <= 1, 'Invalid canvas alpha') }
        if (key === 'lineWidth') { finite(value); assert(value > 0, 'Invalid stroke width') }
        this.state[key] = value
      },
    }))
  }
  point(x, y) {
    finite(x, y)
    const [a, b, c, d, e, f] = this.matrix
    const point = [a * x + c * y + e, b * x + d * y + f]
    finite(...point)
    return point
  }
  save() { this.operations++; this.stack.push({ state: { ...this.state }, matrix: [...this.matrix] }) }
  restore() {
    this.operations++
    assert(this.stack.length > 0, 'Canvas restore without save')
    const previous = this.stack.pop()
    this.state = previous.state
    this.matrix = previous.matrix
  }
  translate(x, y) {
    this.operations++
    const [tx, ty] = this.point(x, y)
    this.matrix[4] = tx
    this.matrix[5] = ty
  }
  rotate(angle) {
    this.operations++
    finite(angle)
    const [a, b, c, d, e, f] = this.matrix
    const cos = Math.cos(angle), sin = Math.sin(angle)
    this.matrix = [a * cos + c * sin, b * cos + d * sin, c * cos - a * sin, d * cos - b * sin, e, f]
  }
  clearRect(...args) { this.operations++; finite(...args); this.clears++ }
  beginPath() { this.operations++; this.path = [] }
  moveTo(x, y) { this.operations++; this.path.push(['move', ...this.point(x, y)]) }
  lineTo(x, y) { this.operations++; this.path.push(['line', ...this.point(x, y)]) }
  closePath() { this.operations++; this.path.push(['close']) }
  arc(x, y, radius, start, end) {
    this.operations++; finite(radius, start, end); assert(radius >= 0, 'Negative arc radius')
    this.path.push(['arc', ...this.point(x, y), radius, start, end])
  }
  ellipse(x, y, rx, ry, rotation, start, end) {
    this.operations++; finite(rx, ry, rotation, start, end); assert(rx >= 0 && ry >= 0, 'Negative ellipse radius')
    this.path.push(['ellipse', ...this.point(x, y), rx, ry, rotation, start, end])
  }
  createRadialGradient(...args) {
    this.operations++; finite(...args)
    assert(args[2] >= 0 && args[5] >= 0, 'Negative gradient radius')
    const gradient = { args, stops: [], addColorStop: (offset, color) => {
      this.operations++; finite(offset)
      assert(offset >= 0 && offset <= 1, 'Invalid gradient offset')
      assert(/^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(color), `Invalid gradient color: ${color}`)
      gradient.stops.push([offset, color])
    } }
    return gradient
  }
  renderPath(kind) {
    this.operations++
    if (this.globalAlpha <= 1e-6) return
    const points = this.path.filter((part) => part.length >= 3)
    if (!points.length) return
    const extent = [Infinity, Infinity, -Infinity, -Infinity]
    points.forEach(([type, x, y, rx = 0, ry = rx]) => {
      const radius = type === 'arc' ? rx : type === 'ellipse' ? Math.max(rx, ry) : 0
      extent[0] = Math.min(extent[0], x - radius)
      extent[1] = Math.min(extent[1], y - radius)
      extent[2] = Math.max(extent[2], x + radius)
      extent[3] = Math.max(extent[3], y + radius)
    })
    if (extent[0] === extent[2] && extent[1] === extent[3]) return
    this.visibleDraws++
    this.bounds = [Math.min(this.bounds[0], extent[0]), Math.min(this.bounds[1], extent[1]),
      Math.max(this.bounds[2], extent[2]), Math.max(this.bounds[3], extent[3])]
    if (this.record) {
      const color = kind === 'stroke' ? this.strokeStyle : this.fillStyle
      this.draws.push({ kind, path: structuredClone(this.path), alpha: this.globalAlpha,
        width: this.lineWidth, color: typeof color === 'object' ? { args: [...color.args], stops: structuredClone(color.stops) } : color })
    }
  }
  stroke() { this.renderPath('stroke') }
  fill() { this.renderPath('fill') }
  fillText(text, x, y) {
    this.operations++
    assert.equal(typeof text, 'string')
    const point = this.point(x, y)
    if (this.globalAlpha > 1e-6 && text) {
      this.visibleDraws++
      if (this.record) this.draws.push({ kind: 'text', text, point, font: this.font, alpha: this.globalAlpha })
    }
  }
}

const moves = new Map(battleMoves.moves.map((move) => [move.id, move]))
const failures = []
const checkedFamilies = new Set()
let frames = 0
let peakOperations = { count: 0, label: '' }
let peakDraws = { count: 0, label: '' }
const source = freeze({ x: 120, y: 238 })
const target = freeze({ x: 500, y: 110 })

function fixture(move, overrides = {}) {
  const cue = freeze({ moveId: move.id, moveType: move.type, moveCategory: move.categoryId,
    moveTarget: move.target, moveFlags: move.flags, sideId: 'player', targetSideId: move.target === 'self' ? 'player' : 'opponent',
    actorSlot: 0, targetSlot: 0, damage: move.categoryId === 'status' ? 0 : 30, effectiveness: 1,
    ...overrides })
  const profile = getMoveAnimationProfile({ ...move, ...cue })
  return { cue, recipe: freeze(getMoveChoreography(profile, cue)), seed: profile.seed }
}

function draw(fixture, progress = .5, options = {}, record = false) {
  const ctx = new RecordingContext(record)
  const input = freeze({ width: 640, height: 360, source, target, phase: 'attack', progress, ...fixture, ...options })
  paintBattleMove(ctx, input)
  frames++
  assert.equal(ctx.clears, 1, 'Each frame must clear its previous canvas contents')
  assert.equal(ctx.stack.length, 0, 'Canvas save/restore leak')
  assert.deepEqual(ctx.state, initialState, 'Renderer leaked canvas styling state')
  assert.deepEqual(ctx.matrix, identity, 'Renderer leaked a transform')
  const label = `${fixture.cue.moveId}/${input.phase}/${fixture.cue.result ?? 'normal'}/${progress}/${input.reducedMotion ? 'reduced' : 'full'}`
  assert(ctx.operations <= 2400, `${label} exceeded 2,400 canvas operations: ${ctx.operations}`)
  assert(ctx.visibleDraws <= 160, `${label} exceeded 160 visible draws: ${ctx.visibleDraws}`)
  if (ctx.operations > peakOperations.count) peakOperations = { count: ctx.operations, label }
  if (ctx.visibleDraws > peakDraws.count) peakDraws = { count: ctx.visibleDraws, label }
  return ctx
}

function check(name, fn) {
  try { fn() } catch (error) { failures.push(`${name}: ${error.message}`) }
}

for (const move of battleMoves.moves) {
  check(`Catalog renderer ${move.id}`, () => {
    let visibleAttack = 0
    const fixtures = ['normal', 'immune', 'blocked'].map((result) => fixture(move, {
      ...(result === 'normal' ? {} : { result, damage: 0 }),
      ...(result === 'immune' ? { effectiveness: 0 } : {}),
    }))
    checkedFamilies.add(fixtures[0].recipe.family)
    for (const phase of ['attack', 'impact']) for (const selected of fixtures) {
      for (const reducedMotion of [false, true]) for (const progress of [0, .12, .28, .48, .68, .88, 1]) {
        const ctx = draw(selected, progress, { phase, reducedMotion })
        if (progress === 0 || progress === 1) assert.equal(ctx.visibleDraws, 0, 'Endpoint left a visible effect')
        if (phase === 'impact' && selected.cue.result === 'immune') assert.equal(ctx.visibleDraws, 0, 'Immune result displayed a hit')
        if (phase === 'attack' && !selected.cue.result && !reducedMotion) visibleAttack += ctx.visibleDraws
      }
    }
    assert(visibleAttack > 0, 'No visible attack geometry during the animation')
  })
}

check('Every declared family renders visible geometry', () => {
  assert.deepEqual([...checkedFamilies].sort(), [...MOVE_CHOREOGRAPHY_FAMILIES].sort())
})

check('Blocked, missed and immune impacts preserve result meaning', () => {
  for (const result of ['miss', 'failed', 'immune', 'reflected']) {
    for (const reducedMotion of [false, true]) {
      const f = fixture(moves.get('thunderbolt'), { phase: 'impact', result, damage: 0 })
      assert.equal(draw(f, .5, { phase: 'impact', reducedMotion }).visibleDraws, 0, `${result} impact drew a hit`)
    }
  }
  for (const reducedMotion of [false, true]) {
    const f = fixture(moves.get('thunderbolt'), { phase: 'impact', result: 'blocked', damage: 0 })
    assert(draw(f, .5, { phase: 'impact', reducedMotion }).visibleDraws > 0, 'Blocked hit lost its protective barrier')
  }
})

check('Zero damage does not become a hit in reduced-motion mode', () => {
  const f = fixture(moves.get('thunderbolt'), { phase: 'impact', damage: 0 })
  for (const reducedMotion of [false, true]) {
    assert.equal(draw(f, .5, { phase: 'impact', reducedMotion }).visibleDraws, 0)
  }
})

check('Reduced-motion feedback is static and still shows a successful heal', () => {
  const f = fixture(moves.get('healpulse'), { phase: 'impact', result: 'heal', damage: 0 })
  const first = draw(f, .25, { phase: 'impact', reducedMotion: true }, true)
  const second = draw(f, .75, { phase: 'impact', reducedMotion: true }, true)
  assert(first.visibleDraws > 0)
  assert.deepEqual(first.draws, second.draws)
})

check('Identical cues produce identical geometry without a shared random source', () => {
  for (const id of ['fireblast', 'closecombat', 'thunderbolt', 'dracometeor', 'spore', 'gigadrain']) {
    const f = fixture(moves.get(id))
    assert.deepEqual(draw(f, .53, {}, true).draws, draw(f, .53, {}, true).draws, id)
  }
})

check('Authored silhouettes change actual geometry with palette and timing held equal', () => {
  const samples = [
    ['fireblast', 'fire-cross', 'volcano'], ['hydropump', 'water-jet', 'flame-jet'],
    ['thunder', 'sky-bolt', 'forked-bolt'], ['icebeam', 'ice-crystal', 'energy-ray'],
    ['dragonclaw', 'cross-cut', 'leaf-blade'], ['closecombat', 'fist-barrage', 'fangs'],
    ['moonblast', 'moon', 'shadow'], ['swordsdance', 'sword-orbit', 'inner-halo'],
    ['lightscreen', 'light-wall', 'shield-dome'], ['leechseed', 'seed-vine', 'hex-web'],
    ['dracometeor', 'dragon-meteor', 'rock-fall'], ['gigadrain', 'life-mote', 'heart'],
  ]
  samples.forEach(([id, a, b]) => {
    const f = fixture(moves.get(id))
    const first = { ...f, recipe: { ...f.recipe, signature: a } }
    const second = { ...f, recipe: { ...f.recipe, signature: b } }
    const geometry = (selected) => draw(selected, .55, {}, true).draws.map(({ kind, path, point, text }) => ({ kind, path, point, text }))
    assert.notDeepEqual(geometry(first), geometry(second), `${a} and ${b} were metadata-only variants`)
  })
})

check('Recipient-local effects track an ally target and mirrored battle positions', () => {
  for (const id of ['healpulse', 'protect', 'leechseed', 'spore', 'swordsdance']) {
    const f = fixture(moves.get(id))
    const original = draw(f, .55, {}, true)
    const dx = -270, dy = 110
    const moved = draw(f, .55, { target: { x: target.x + dx, y: target.y + dy } }, true)
    assert.equal(original.visibleDraws, moved.visibleDraws, id)
    assert.notDeepEqual(original.draws, moved.draws, `${id} ignored its target coordinates`)
  }
  const f = fixture(moves.get('flamethrower'))
  assert(draw(f, .6, { source: target, target: source }).visibleDraws > 0)
  assert(draw(f, .6, { width: 320, height: 200, source: { x: 50, y: 130 }, target: { x: 260, y: 65 } }).visibleDraws > 0)
})

check('Drain particles return from the defender toward their user', () => {
  const f = fixture(moves.get('gigadrain'))
  const drain = draw(f, .6, {}, true)
  const outgoing = draw({ ...f, recipe: { ...f.recipe, family: 'stream' } }, .6, {}, true)
  const center = (recording) => {
    const circles = recording.draws.flatMap((entry) => entry.path ?? []).filter(([kind]) => kind === 'arc')
    assert(circles.length > 0, 'No traveling particles were drawn')
    return circles.reduce((sum, entry) => sum + entry[1], 0) / circles.length
  }
  assert(center(drain) < center(outgoing) - 80, 'Drain used the outgoing projectile direction')
})

if (failures.length) {
  console.error(failures.slice(0, 20).join('\n'))
  assert.fail(`${failures.length} move painter checks failed`)
}
console.log(`Validated ${battleMoves.moves.length} move painters across ${frames.toLocaleString('en-US')} recorded frames and ${checkedFamilies.size} families.`)
console.log(`Peak Canvas work: ${peakOperations.count} operations / frame (${peakOperations.label}); ${peakDraws.count} visible draws / frame.`)
