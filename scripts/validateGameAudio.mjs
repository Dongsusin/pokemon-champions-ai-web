import assert from 'node:assert/strict'
import { createGameAudio } from '../src/gameAudio.js'
import { MENU_MUSIC_TRACKS } from '../src/data/menuMusic.js'

// Observe scheduled Web Audio sources and their output buses under a virtual
// clock. No browser autoplay permission, speakers, or downloaded music is needed.
function installAudioEnvironment() {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const originalRandom = Math.random
  let nowMs = 0, nextTimerId = 0
  const timers = new Map(), contexts = []
  class Param {
    value = 0
    events = []
    record(kind, value, time) {
      assert.ok(Number.isFinite(value) && Number.isFinite(time), 'Audio automation must be finite')
      if (kind === 'exponential') assert.ok(value > 0, 'Exponential ramps require positive values')
      this.events.push({ kind, value, time }); this.value = value
    }
    setValueAtTime(value, time) { this.record('set', value, time) }
    setTargetAtTime(value, time) { this.record('target', value, time) }
    exponentialRampToValueAtTime(value, time) { this.record('exponential', value, time) }
    linearRampToValueAtTime(value, time) { this.record('linear', value, time) }
    cancelScheduledValues(time) { assert.ok(Number.isFinite(time)) }
    cancelAndHoldAtTime(time) { assert.ok(Number.isFinite(time)) }
  }
  class Node {
    constructor(context, kind) {
      this.context = context; this.kind = kind; this.connections = []; this.stopCalls = []
      for (const name of ['gain', 'frequency', 'detune', 'Q', 'pan', 'threshold', 'knee', 'ratio', 'attack', 'release']) this[name] = new Param()
      context.nodes.push(this)
    }
    connect(destination) { assert.ok(destination, 'Audio output is required'); this.connections.push(destination); return destination }
    disconnect() { this.connections.length = 0 }
    addEventListener(kind, callback) { if (kind === 'ended') this.endedListener = callback }
    removeEventListener(kind, callback) { if (kind === 'ended' && this.endedListener === callback) this.endedListener = null }
    start(time = this.context.currentTime) {
      assert.equal(this.startedAt, undefined, 'A source cannot start twice')
      assert.ok(Number.isFinite(time) && time >= 0, 'Source time must be finite and nonnegative')
      const outputs = []
      const visit = (node) => { for (const output of node.connections) if (!outputs.includes(output)) { outputs.push(output); visit(output) } }
      visit(this)
      this.outputs = outputs; this.startedAt = time; this.scheduledAt = this.context.currentTime
      this.initialFrequency = this.frequency.events.find(event => event.kind === 'set')?.value ?? this.frequency.value
      this.context.starts.push(this)
      this.context.active.add(this)
    }
    stop(time = this.context.currentTime) {
      assert.ok(Number.isFinite(time), 'Stop time must be finite')
      this.stopCalls.push(time); this.endsAt = time
      if (time <= this.context.currentTime) this.finish()
    }
    finish() { if (!this.ended) { this.ended = true; this.context.active.delete(this); this.onended?.(); this.endedListener?.() } }
  }
  class AudioContext {
    state = 'suspended'
    sampleRate = 8000
    nodes = []
    starts = []
    active = new Set()
    resumeCalls = 0
    constructor() { this.createdAtMs = nowMs; contexts.push(this); this.destination = new Node(this, 'destination') }
    get currentTime() { return (nowMs - this.createdAtMs) / 1000 }
    createGain() { return new Node(this, 'gain') }
    createDynamicsCompressor() { return new Node(this, 'compressor') }
    createBiquadFilter() { return new Node(this, 'filter') }
    createStereoPanner() { return new Node(this, 'pan') }
    createOscillator() { return new Node(this, 'oscillator') }
    createBufferSource() { return new Node(this, 'buffer') }
    createBuffer(channels, length, sampleRate) {
      const data = Array.from({ length: channels }, () => new Float32Array(length))
      return { duration: length / sampleRate, getChannelData: index => data[index] }
    }
    async resume() { assert.notEqual(this.state, 'closed'); this.state = 'running'; this.resumeCalls += 1 }
    async close() { this.state = 'closed'; for (const source of this.starts) source.finish() }
  }
  const window = { AudioContext,
    setInterval(callback, delay) { const id = ++nextTimerId; timers.set(id, { callback, delay, due: nowMs + delay }); return id },
    clearInterval(id) { timers.delete(id) },
  }
  Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: window })
  Math.random = () => .37
  const finishSources = () => { for (const context of contexts) for (const source of context.active) if (source.endsAt <= context.currentTime) source.finish() }
  return { contexts, timers,
    get now() { return nowMs / 1000 },
    advance(durationMs) {
      const target = nowMs + durationMs
      let count = 0
      while (true) {
        const next = [...timers.entries()].filter(([, timer]) => timer.due <= target).sort((a, b) => a[1].due - b[1].due)[0]
        if (!next) break
        assert.ok(++count < 30000, 'Audio scheduler did not settle')
        nowMs = next[1].due
        next[1].due += next[1].delay
        finishSources(); next[1].callback()
      }
      nowMs = target; finishSources()
    },
    stall(durationMs) {
      nowMs += durationMs; finishSources()
      for (const timer of [...timers.values()]) { timer.due = nowMs + timer.delay; timer.callback() }
    },
    restore() {
      Math.random = originalRandom
      if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
      else delete globalThis.window
    },
  }
}

// The three bus gains feed the master gain directly. The first is music;
// source graph snapshots survive disconnect/ended cleanup by the implementation.
const buses = context => {
  const master = context.nodes.find(node => node.kind === 'gain' && node.connections.some(output => output.kind === 'compressor'))
  const outputs = context.nodes.filter(node => node.kind === 'gain' && node.connections.includes(master))
  return { master, music: outputs[0], ui: outputs[1], event: outputs[2] }
}
const sources = (context, bus = 'music') => {
  const output = buses(context)[bus]
  return context.starts.filter(source => source.outputs.includes(output))
}
const lead = context => sources(context).filter(source => source.kind === 'oscillator'
  && source.outputs.some(output => output.kind === 'filter' && output.frequency.value > 2000))
const notes = context => lead(context).map(source => ({ frequency: source.initialFrequency, time: source.startedAt, wave: source.type }))
const approximately = (actual, expected, message, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} != ${expected}`)
const failures = []
let passed = 0
async function test(name, run) {
  const environment = installAudioEnvironment()
  try { await run(environment); passed += 1; console.log(`PASS ${name}`) }
  catch (error) { failures.push({ name, error: error.message }); console.error(`FAIL ${name}: ${error.stack}`) }
  finally { environment.restore() }
}

await test('13 playable themes contain distinct complete melodies with valid tempos and repeats', () => {
  assert.equal(MENU_MUSIC_TRACKS.length, 13)
  assert.equal(new Set(MENU_MUSIC_TRACKS.map(track => track.id)).size, 13)
  assert.equal(new Set(MENU_MUSIC_TRACKS.map(track => JSON.stringify(track.melody))).size, 13)
  for (const track of MENU_MUSIC_TRACKS) {
    assert.ok(track.label && track.melody.length >= 16 && track.bass.length >= 4, `${track.id} lacks a complete score`)
    assert.ok(track.bpm >= 60 && track.bpm <= 200, `${track.id} tempo is not playable`)
    assert.ok(Number.isInteger(track.loops) && track.loops > 0, `${track.id} needs a finite ending`)
    assert.ok([...track.melody, ...track.bass].every(value => Number.isFinite(value) && (value === 0 || value >= 30 && value <= 5000)))
    assert.ok(track.melody.some(value => value > 0), `${track.id} is silent`)
    const duration = track.melody.length * track.loops * 30 / track.bpm
    assert.ok(duration >= 45 && duration <= 100, `${track.id} should play as a track before changing (${duration}s)`)
  }
})

await test('activation starts one audible scheduler, including a future menu scene', environment => {
  const audio = createGameAudio()
  audio.setScene('future-community-menu')
  assert.equal(environment.contexts.length, 0)
  assert.equal(environment.timers.size, 0)
  audio.activate(); audio.activate()
  assert.equal(environment.contexts.length, 1)
  assert.equal(environment.timers.size, 1)
  environment.advance(700)
  const context = environment.contexts[0]
  assert.ok(lead(context).length >= 2)
  assert.ok(buses(context).music.gain.value > 0)
  audio.destroy()
  assert.equal(environment.timers.size, 0)
})

await test('all menu transitions preserve the same notes, timestamps, gain and scheduler', environment => {
  const control = createGameAudio(), audio = createGameAudio()
  control.activate(); audio.activate()
  const [reference, context] = environment.contexts
  const timers = [...environment.timers.keys()]
  const gainEvents = buses(context).music.gain.events.length
  for (const scene of ['hatch', 'training', 'box', 'shop', 'battle-select', 'competition', 'achievements', 'battle-hub', 'ranked', 'future-screen', 'lobby']) {
    environment.advance(350); audio.setScene(scene)
    assert.deepEqual([...environment.timers.keys()], timers, `${scene} restarted the scheduler`)
  }
  assert.deepEqual(notes(context), notes(reference), 'Changing menus restarted or skipped the playing melody')
  assert.equal(buses(context).music.gain.events.length, gainEvents, 'Changing menus faded the music bus')
  control.destroy(); audio.destroy()
})

await test('UI actions and rewards play on their own buses without interrupting music', environment => {
  const control = createGameAudio(), audio = createGameAudio()
  control.activate(); audio.activate()
  const [reference, context] = environment.contexts
  const timers = [...environment.timers.keys()]
  for (const kind of ['select', 'confirm', 'cancel', 'error']) { audio.playUi(kind); environment.advance(180) }
  for (const kind of ['reward', 'draw', 'shiny', 'equip', 'purchase', 'save', 'team', 'competition']) { audio.playEvent(kind); environment.advance(280) }
  assert.ok(sources(context, 'ui').length > 0)
  assert.ok(sources(context, 'event').length > 0)
  assert.deepEqual(notes(context), notes(reference))
  assert.deepEqual([...environment.timers.keys()], timers)
  control.destroy(); audio.destroy()
})

await test('mix changes update independent bus levels without restarting the current track', environment => {
  const control = createGameAudio(), audio = createGameAudio()
  control.activate(); audio.activate()
  const [reference, context] = environment.contexts
  const initial = Object.fromEntries(Object.entries(buses(context)).map(([name, node]) => [name, node.gain.value]))
  const timers = [...environment.timers.keys()]
  environment.advance(1500)
  audio.setMix({ master: 50, music: 25, ui: 30, event: 40 })
  for (const [name, ratio] of [['master', .5], ['music', .25], ['ui', .3], ['event', .4]]) approximately(buses(context)[name].gain.value, initial[name] * ratio, `${name} mix`)
  environment.advance(2000)
  assert.deepEqual(notes(context), notes(reference))
  assert.deepEqual([...environment.timers.keys()], timers)
  audio.setMix({ music: 120, ui: -20 })
  approximately(buses(context).music.gain.value, initial.music, 'Music mix upper bound')
  approximately(buses(context).ui.gain.value, 0, 'UI mix lower bound')
  control.destroy(); audio.destroy()
})

async function checkPauseResume(environment, mode) {
  const control = createGameAudio(), audio = createGameAudio()
  control.activate(); audio.activate()
  const [reference, context] = environment.contexts
  environment.advance(2100)
  const pauseTime = environment.now
  const played = lead(context).filter(source => source.startedAt < pauseTime).length
  if (mode === 'mute') audio.setEnabled(false)
  else audio.setScene(mode)
  assert.ok(sources(context).filter(source => !source.ended).every(source => source.endsAt <= pauseTime + .04), 'Pause left previously queued music sources running')
  const count = sources(context).length
  assert.equal(environment.timers.size, 1, 'Only the reference scheduler should remain while paused')
  if (mode === 'mute') approximately(buses(context).master.gain.value, 0, 'Muted master bus')
  else assert.ok(buses(context).music.gain.value <= .001, 'Battle must silence the music bus')
  audio.setMix({ master: 75, music: 60 })
  audio.playUi('confirm'); audio.playEvent('reward')
  environment.advance(10000)
  assert.equal(sources(context).length, count, 'A paused music scheduler restarted after an effect or mix change')
  if (mode !== 'mute') assert.ok(buses(context).music.gain.value <= .001, 'Mix changes unmuted menu music during battle')
  else approximately(buses(context).master.gain.value, 0, 'Mix changes unmuted master audio')
  const resumeTime = environment.now
  if (mode === 'mute') audio.setEnabled(true)
  else audio.setScene('ranked')
  environment.advance(2600)
  const resumed = lead(context).filter(source => source.scheduledAt >= resumeTime).slice(0, 7).map(source => source.initialFrequency)
  assert.ok(resumed.length >= 5, 'Music did not resume')
  const referenceNotes = lead(reference).map(source => source.initialFrequency)
  const candidates = [played - 1, played].filter(index => index >= 0).map(index => referenceNotes.slice(index, index + resumed.length))
  assert.ok(candidates.some(expected => JSON.stringify(expected) === JSON.stringify(resumed)), `Pause reset or skipped melody steps: heard ${JSON.stringify(resumed)}, expected near ${JSON.stringify(candidates)}`)
  assert.equal(environment.timers.size, 2)
  control.destroy(); audio.destroy()
}
await test('mute and unmute preserve the playing track and nearby melody position', environment => checkPauseResume(environment, 'mute'))
await test('battle entry silences menu music and resumes the same melody after battle', environment => checkPauseResume(environment, 'battle'))
await test('null scene pauses music without losing its place', environment => checkPauseResume(environment, null))

await test('disabled startup stays silent until unmuted, and repeated enable leaves one scheduler', environment => {
  const audio = createGameAudio(false)
  audio.activate(); audio.setScene('achievements'); audio.playEvent('reward')
  environment.advance(1000)
  assert.equal(environment.timers.size, 0)
  assert.equal(environment.contexts.flatMap(context => context.starts).length, 0)
  audio.setEnabled(true); environment.advance(1000)
  const before = notes(environment.contexts[0])
  audio.setEnabled(true)
  assert.equal(environment.timers.size, 1)
  assert.deepEqual(notes(environment.contexts[0]), before, 'Repeated enable inserted a new first beat')
  audio.destroy()
})

await test('destroy and reactivation support React StrictMode with no orphan scheduler or closed context reuse', environment => {
  const audio = createGameAudio()
  audio.activate(); environment.advance(1400)
  const previous = environment.contexts[0]
  audio.destroy(); audio.destroy()
  assert.equal(environment.timers.size, 0)
  assert.equal(previous.state, 'closed')
  const oldCount = previous.starts.length
  audio.activate(); environment.advance(800)
  assert.equal(environment.contexts.length, 2)
  assert.equal(previous.starts.length, oldCount)
  assert.equal(environment.timers.size, 1)
  assert.ok(lead(environment.contexts[1]).length > 0)
  audio.destroy()
})

await test('a throttled background scheduler skips missed wall time instead of bursting old notes', environment => {
  const audio = createGameAudio()
  audio.activate(); environment.advance(1000)
  const context = environment.contexts[0], before = context.starts.length
  environment.stall(180000)
  const resumed = context.starts.slice(before)
  assert.ok(resumed.length > 0 && resumed.length <= 16, `Background resume scheduled ${resumed.length} sources at once`)
  assert.ok(resumed.every(source => source.startedAt >= source.scheduledAt - .01), 'Background resume scheduled notes in the past')
  assert.equal(environment.timers.size, 1)
  audio.destroy()
})

await test('track endings use continuous note timing and move to a different song', environment => {
  const audio = createGameAudio()
  audio.activate()
  const context = environment.contexts[0]
  const identifyTrack = at => {
    const played = lead(context).filter(source => source.startedAt >= at - 1e-6).slice(0, 8).map(source => source.initialFrequency)
    const matches = MENU_MUSIC_TRACKS.filter(track => JSON.stringify(track.melody.filter(Boolean).slice(0, 8)) === JSON.stringify(played))
    assert.equal(matches.length, 1, `Cannot identify the scheduled melody ${JSON.stringify(played)}`)
    return matches[0]
  }
  environment.advance(3500)
  let start = lead(context)[0].startedAt, track = identifyTrack(start)
  const visited = new Set([track.id])
  for (let index = 0; index < MENU_MUSIC_TRACKS.length; index += 1) {
    const boundary = start + track.melody.length * track.loops * 30 / track.bpm
    environment.advance(Math.max(0, (boundary + 4 - environment.now) * 1000))
    const first = lead(context).find(source => source.startedAt >= boundary - 1e-6)
    assert.ok(first, 'Next song did not begin')
    approximately(first.startedAt, boundary, 'Track transition added an artificial pause')
    const next = identifyTrack(boundary)
    assert.notEqual(next.id, track.id, 'Playlist immediately repeated the song that just ended')
    visited.add(next.id)
    assert.ok(context.starts.every(source => source.startedAt >= source.scheduledAt - .01), 'Normal scheduling emitted a stale note')
    start = boundary; track = next
  }
  assert.equal(visited.size, MENU_MUSIC_TRACKS.length, 'A complete playlist cycle must reach every advertised track')
  assert.equal(environment.timers.size, 1, 'Track changes leaked timers')
  audio.destroy()
})

if (failures.length) {
  console.error(`Game audio validation failed: ${failures.length}/${passed + failures.length} checks.`)
  process.exitCode = 1
} else console.log(`Validated ${passed} menu audio lifecycle and playlist behaviors across ${MENU_MUSIC_TRACKS.length} tracks.`)
