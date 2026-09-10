import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { BATTLE_SAMPLE_PATHS, createBattleAudio } from '../src/battleAudio.js'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const moveData = JSON.parse(fs.readFileSync(path.join(projectRoot, 'src/data/generatedBattleMoves.json'), 'utf8'))
const failures = []
let passed = 0

// The fake clock also finishes scheduled audio sources. This catches sounds that
// survive mute, a new animation phase, or React's destroy/recreate effect cycle.
function installAudioEnvironment({ missingSamples = false, holdCries = false } = {}) {
  const originalGlobals = new Map(['window', 'Audio', 'fetch', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  const originalNow = Date.now
  let nowMs = 0
  let nextTimerId = 0
  const timers = new Map()
  const contexts = []
  const media = []
  const pendingFetches = []
  const requests = []

  const addTimer = (callback, delay = 0, interval = 0) => {
    const id = ++nextTimerId
    timers.set(id, { callback, due: nowMs + Math.max(0, delay), interval })
    return id
  }
  const removeTimer = (id) => timers.delete(id)
  class Param {
    value = 0
    events = []
    record(kind, value, when) {
      assert.ok(Number.isFinite(value), `${kind} value must be finite: ${value}`)
      assert.ok(Number.isFinite(when), `${kind} time must be finite: ${when}`)
      if (kind === 'exponential') assert.ok(value > 0, 'Exponential gain/frequency ramps require positive values')
      this.events.push({ kind, value, when })
      this.value = value
    }
    setValueAtTime(value, when) { this.record('set', value, when) }
    setTargetAtTime(value, when) { this.record('target', value, when) }
    exponentialRampToValueAtTime(value, when) { this.record('exponential', value, when) }
    linearRampToValueAtTime(value, when) { this.record('linear', value, when) }
    cancelScheduledValues(when) { assert.ok(Number.isFinite(when)) }
    cancelAndHoldAtTime(when) { assert.ok(Number.isFinite(when)) }
  }
  class Node {
    constructor(context, kind) {
      this.context = context
      this.kind = kind
      this.connections = []
      this.disconnected = false
      this.gain = new Param()
      this.frequency = new Param()
      this.detune = new Param()
      this.Q = new Param()
      this.pan = new Param()
      this.playbackRate = new Param()
      this.playbackRate.value = 1
      this.threshold = new Param()
      this.knee = new Param()
      this.ratio = new Param()
      this.attack = new Param()
      this.release = new Param()
      context.nodes.push(this)
    }
    connect(destination) { assert.ok(destination, 'Audio node requires an output'); this.connections.push(destination); return destination }
    disconnect() { this.disconnected = true; this.connections.length = 0 }
    addEventListener(kind, callback) { if (kind === 'ended') this.endedListener = callback }
    removeEventListener(kind, callback) { if (kind === 'ended' && this.endedListener === callback) this.endedListener = null }
    start(when = this.context.currentTime, offset = 0, duration) {
      assert.equal(this.startedAt, undefined, 'Audio sources cannot start twice')
      assert.ok(Number.isFinite(when) && when >= 0, `Invalid source start ${when}`)
      this.startedAt = when
      this.offset = offset
      this.sourceDuration = duration
      if (this.kind === 'buffer') {
        assert.ok(this.buffer, 'A buffer source requires decoded audio')
        assert.ok(offset >= 0 && offset < this.buffer.duration, 'Sample offset must remain inside the recording')
        if (duration !== undefined) {
          assert.ok(Number.isFinite(duration) && duration > 0, 'Sample duration must be positive')
          assert.ok(offset + duration <= this.buffer.duration + 1e-6, 'Sample playback cannot read past the recording')
        }
        this.endsAt = when + (duration ?? this.buffer.duration - offset) / this.playbackRate.value
      }
      this.context.starts.push(this)
    }
    stop(when = this.context.currentTime) {
      assert.ok(Number.isFinite(when), 'Source stop time must be finite')
      this.stoppedAt = when
      this.endsAt = when
      if (when <= this.context.currentTime) this.finish()
    }
    finish() {
      if (this.ended) return
      this.ended = true
      this.onended?.()
      this.endedListener?.()
    }
  }
  class AudioContext {
    state = 'suspended'
    sampleRate = 8000
    nodes = []
    starts = []
    resumeCalls = 0
    constructor() { contexts.push(this); this.destination = new Node(this, 'destination') }
    get currentTime() { return nowMs / 1000 }
    createGain() { return new Node(this, 'gain') }
    createDynamicsCompressor() { return new Node(this, 'compressor') }
    createBiquadFilter() { return new Node(this, 'filter') }
    createStereoPanner() { return new Node(this, 'pan') }
    createOscillator() { return new Node(this, 'oscillator') }
    createBufferSource() { return new Node(this, 'buffer') }
    createMediaElementSource() { return new Node(this, 'media') }
    createBuffer(channels, length, sampleRate) {
      const channelData = Array.from({ length: channels }, () => new Float32Array(length))
      return { duration: length / sampleRate, length, sampleRate, numberOfChannels: channels, getChannelData: (index) => channelData[index] }
    }
    async decodeAudioData(encoded) {
      const assetPath = new TextDecoder().decode(encoded)
      const buffer = this.createBuffer(1, this.sampleRate * (assetPath.includes('/cries/') ? 0.8 : 1.5), this.sampleRate)
      buffer.assetPath = assetPath
      return buffer
    }
    async resume() { assert.notEqual(this.state, 'closed'); this.resumeCalls += 1; this.state = 'running' }
    async close() { this.state = 'closed'; for (const source of this.starts) source.finish() }
  }
  class Audio {
    currentTime = 0
    paused = true
    playCalls = 0
    constructor(src) { this.src = src; media.push(this) }
    load() {}
    async play() { this.paused = false; this.playCalls += 1 }
    pause() { this.paused = true }
    removeAttribute(attribute) { delete this[attribute] }
    addEventListener() {}
    removeEventListener() {}
  }
  const responseFor = (url) => ({
    ok: !(missingSamples && !url.includes('/cries/')),
    arrayBuffer: async () => new TextEncoder().encode(url).buffer,
  })
  const fetch = (input, options = {}) => {
    const url = String(input)
    requests.push(url)
    if (holdCries && url.includes('/cries/')) return new Promise((resolve, reject) => {
      const abort = () => reject(new DOMException('Audio request aborted', 'AbortError'))
      if (options.signal?.aborted) { abort(); return }
      options.signal?.addEventListener('abort', abort, { once: true })
      pendingFetches.push(() => {
        options.signal?.removeEventListener('abort', abort)
        resolve(responseFor(url))
      })
    })
    return Promise.resolve(responseFor(url))
  }
  const setTimeout = (callback, delay) => addTimer(callback, delay)
  const setInterval = (callback, delay) => addTimer(callback, delay, delay)
  const window = { AudioContext, Audio, setTimeout, clearTimeout: removeTimer, setInterval, clearInterval: removeTimer }
  Object.assign(globalThis, { window, Audio, fetch, setTimeout, clearTimeout: removeTimer, setInterval, clearInterval: removeTimer })
  Date.now = () => nowMs
  const flush = async () => { for (let index = 0; index < 16; index += 1) await Promise.resolve() }
  return {
    contexts, media, requests, timers, flush,
    get starts() { return contexts.flatMap((context) => context.starts) },
    async releaseCries() { for (const resolve of pendingFetches.splice(0)) resolve(); await flush() },
    async advance(durationMs) {
      const target = nowMs + durationMs
      let iterations = 0
      while (true) {
        const next = [...timers.entries()].filter(([, timer]) => timer.due <= target).sort((a, b) => a[1].due - b[1].due)[0]
        if (!next) break
        assert.ok(++iterations < 2000, 'Unexpected repeating audio timer')
        nowMs = next[1].due
        timers.delete(next[0])
        if (next[1].interval) timers.set(next[0], { ...next[1], due: nowMs + next[1].interval })
        next[1].callback()
        await flush()
      }
      nowMs = target
      for (const context of contexts) for (const source of context.starts) {
        if (source.endsAt <= context.currentTime) source.finish()
      }
      await flush()
    },
    restore() {
      Date.now = originalNow
      for (const [key, descriptor] of originalGlobals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor)
        else delete globalThis[key]
      }
    },
  }
}

async function test(name, body, environmentOptions) {
  const environment = installAudioEnvironment(environmentOptions)
  try {
    await body(environment)
    passed += 1
    console.log(`PASS ${name}`)
  } catch (error) {
    failures.push({ name, error })
    console.error(`FAIL ${name}: ${error.stack}`)
  } finally {
    environment.restore()
  }
}

const basicAttack = { phase: 'attack', sideId: 'player', targetSideId: 'opponent', moveId: 'thunderbolt', moveName: '10만볼트', type: '전기', category: '특수', power: 90 }
const pokemon = (speciesId, name = `Pokemon ${speciesId}`) => ({ speciesId, originalSpeciesId: speciesId, name })
const cuePokemon = (speciesId) => ({ actorSpeciesId: speciesId, actorOriginalSpeciesId: speciesId, actorName: `Pokemon ${speciesId}` })
const cries = (environment) => environment.starts.filter((source) => source.buffer?.assetPath?.includes('/cries/'))

await test('all generated moves produce sample and synthesized attack audio', async (environment) => {
  const audio = createBattleAudio()
  await audio.preload()
  for (const move of moveData.moves) {
    const before = environment.starts.length
    audio.playCue({ ...move, ...basicAttack, moveId: move.id, moveName: move.name, type: move.type, category: move.category, power: move.power, id: `move-${move.id}` }, { durationMs: 650, animationMode: 'normal' })
    const sources = environment.starts.slice(before)
    assert.ok(sources.some((source) => source.buffer?.assetPath), `${move.id} is missing recorded effects`)
    assert.ok(sources.some((source) => source.kind === 'oscillator'), `${move.id} is missing its synthesized signature`)
  }
  audio.destroy()
})

await test('all generated moves remain audible with missing audio files', async (environment) => {
  const audio = createBattleAudio()
  await audio.preload()
  for (const move of moveData.moves) {
    const before = environment.starts.length
    audio.playCue({ ...move, ...basicAttack, moveId: move.id, moveName: move.name, type: move.type, category: move.category, power: move.power, id: `fallback-${move.id}` })
    assert.ok(environment.starts.length > before, `${move.id} became silent after asset failure`)
  }
  audio.destroy()
}, { missingSamples: true })

await test('duplicate IDs are suppressed while anonymous cues both play', async (environment) => {
  const audio = createBattleAudio()
  audio.playCue({ ...basicAttack, id: 'unique' })
  const first = environment.starts.length
  audio.playCue({ ...basicAttack, id: 'unique' })
  assert.equal(environment.starts.length, first)
  for (const id of [undefined, undefined, null, null, '', '']) {
    const before = environment.starts.length
    audio.playCue({ ...basicAttack, id })
    assert.ok(environment.starts.length > before, `Anonymous cue ${String(id)} should play`)
  }
  audio.destroy()
})

await test('attack, hit and missed attacks remain audible with animations skipped', async (environment) => {
  const audio = createBattleAudio()
  for (const [phase, result] of [['attack'], ['impact'], ['resolve', 'miss']]) {
    const before = environment.starts.length
    audio.playCue({ ...basicAttack, id: phase, phase, result, effectiveness: 1 }, { durationMs: 70, animationMode: 'skip' })
    assert.ok(environment.starts.length > before, `${phase} is silent in skip mode`)
  }
  audio.destroy()
})

await test('switch-out, sendout and faint play distinct lifecycle effects', async (environment) => {
  const audio = createBattleAudio()
  await audio.preload([pokemon(25)])
  const lifecyclePaths = []
  for (const phase of ['switch-out', 'switch', 'faint']) {
    const before = environment.starts.length
    audio.playCue({ id: phase, phase, sideId: 'player', targetSideId: 'player', ...cuePokemon(25) }, { durationMs: 1000 })
    await environment.advance(400)
    const sources = environment.starts.slice(before)
    const samples = sources.map((source) => source.buffer?.assetPath).filter((assetPath) => assetPath && !assetPath.includes('/cries/'))
    assert.ok(samples.length, `${phase} needs its recorded lifecycle effect`)
    lifecyclePaths.push(samples[0])
    if (phase !== 'switch-out') assert.ok(sources.some((source) => source.buffer?.assetPath?.endsWith('/25.ogg')), `${phase} must play the correct Pokemon cry`)
  }
  assert.equal(new Set(lifecyclePaths).size, 3, 'Recall, sendout and faint must have distinct recorded effects')
  audio.destroy()
})

await test('a new phase cancels scheduled effects from the previous phase', async (environment) => {
  const audio = createBattleAudio()
  audio.playCue({ ...basicAttack, id: 'old' }, { durationMs: 1000 })
  const previousSources = [...environment.starts]
  audio.playCue({ id: 'new', phase: 'prompt' }, { durationMs: 200 })
  assert.ok(previousSources.length > 0)
  assert.ok(previousSources.every((source) => source.ended || source.stoppedAt <= source.context.currentTime + 0.05), 'Previous phase left scheduled sound running')
  audio.destroy()
})

await test('late cries cannot play after the cue advances', async (environment) => {
  const audio = createBattleAudio()
  audio.playCue({ id: 'sendout', phase: 'switch', sideId: 'player', ...cuePokemon(25) }, { durationMs: 1000 })
  audio.playCue({ ...basicAttack, id: 'next-phase' })
  const before = environment.starts.length
  await environment.releaseCries()
  await environment.advance(1500)
  assert.equal(cries(environment).length, 0, 'A stale Pokemon cry played over the next phase')
  assert.equal(environment.starts.length, before, 'A stale fallback cry played over the next phase')
  audio.destroy()
}, { holdCries: true })

await test('slow cry downloads use one timely fallback without a delayed double cry', async (environment) => {
  const audio = createBattleAudio()
  audio.playCue({ id: 'sendout', phase: 'switch', sideId: 'player', ...cuePokemon(25) }, { durationMs: 1200 })
  const immediate = environment.starts.length
  await environment.advance(600)
  assert.ok(environment.starts.length > immediate, 'Slow cry download should produce a scheduled synthesized fallback')
  const afterFallback = environment.starts.length
  await environment.releaseCries()
  await environment.advance(200)
  assert.equal(environment.starts.length, afterFallback, 'A late download doubled the already played fallback')
  audio.destroy()
}, { holdCries: true })

await test('mute cancels old sources and late cries, including after unmute', async (environment) => {
  const audio = createBattleAudio()
  audio.playCue({ id: 'sendout', phase: 'switch', sideId: 'player', ...cuePokemon(25) }, { durationMs: 1000 })
  const previousSources = [...environment.starts]
  audio.setEnabled(false)
  audio.setEnabled(true)
  const before = environment.starts.length
  await environment.releaseCries()
  await environment.advance(1500)
  assert.equal(environment.starts.length, before, 'Mute/unmute resurrected stale cry playback')
  assert.ok(previousSources.every((source) => source.ended || source.stoppedAt <= 0.05), 'Mute left scheduled effects alive')
  audio.destroy()
}, { holdCries: true })

await test('phase transitions preserve menu clicks while mute stops clicks and cached cries', async (environment) => {
  const audio = createBattleAudio()
  await audio.preload([pokemon(25)])
  audio.playMenu('select')
  const menuSource = environment.starts.at(-1)
  audio.playCue({ id: 'sendout', phase: 'switch', sideId: 'player', ...cuePokemon(25) }, { durationMs: 1000 })
  assert.ok(!menuSource.ended, 'Starting a battle cue cut off the menu selection sound')
  assert.equal(cries(environment).length, 1)
  audio.setEnabled(false)
  assert.ok(environment.starts.every((source) => source.ended || source.stoppedAt <= 0.05), 'Mute left a menu effect or cached Pokemon cry running')
  const before = environment.starts.length
  audio.playMenu('cursor')
  audio.playCue({ ...basicAttack, id: 'muted-attack' })
  assert.equal(environment.starts.length, before, 'Muted effects still scheduled audio sources')
  audio.destroy()
})

await test('battle results stop music and unregister the low HP warning interval', async (environment) => {
  const audio = createBattleAudio()
  await audio.preload()
  audio.start()
  await environment.advance(2000)
  audio.setLowHpWarning(true)
  audio.playCue({ id: 'victory', phase: 'result', sideId: 'player' })
  assert.ok(environment.media.every((element) => element.paused), 'Battle result left music playing')
  assert.equal(environment.timers.size, 0, 'Battle result left low HP or intro timers active')
  const before = environment.starts.length
  await environment.advance(2500)
  assert.equal(environment.starts.length, before, 'Low HP warning sounded during the result screen')
  audio.destroy()
})

await test('destroy cancels pending intro music, warning timers and cry callbacks', async (environment) => {
  const audio = createBattleAudio()
  audio.start({ player: pokemon(25), opponent: pokemon(6) })
  audio.setLowHpWarning(true)
  audio.destroy()
  const before = environment.starts.length
  await environment.releaseCries()
  await environment.advance(3000)
  assert.equal(environment.starts.length, before, 'Destroyed instance created delayed sources')
  assert.equal(environment.contexts.length, 1, 'Destroy callback recreated its AudioContext')
  assert.ok(environment.media.every((element) => element.paused), 'Destroyed music resumed')
  assert.equal(environment.timers.size, 0, 'Destroy left owned timers registered')
}, { holdCries: true })

await test('StrictMode destroy/recreate reuses the controller without stale cry callbacks', async (environment) => {
  const audio = createBattleAudio()
  audio.playCue({ id: 'old', phase: 'switch', sideId: 'player', ...cuePokemon(25) })
  const oldContext = environment.contexts[0]
  audio.destroy()
  audio.playCue({ ...basicAttack, id: 'fresh' })
  assert.equal(environment.contexts.length, 2)
  assert.equal(oldContext.state, 'closed')
  const before = environment.starts.length
  await environment.releaseCries()
  await environment.advance(1500)
  assert.equal(environment.starts.length, before, 'Old generation cry mutated the recreated controller')
  assert.equal(cries(environment).length, 0)
  audio.destroy()
}, { holdCries: true })

await test('unlock resumes a suspended browser audio context', async (environment) => {
  const audio = createBattleAudio()
  await audio.preload()
  const context = environment.contexts[0]
  context.state = 'suspended'
  await audio.unlock()
  assert.equal(context.state, 'running')
  assert.ok(context.resumeCalls > 0)
  audio.destroy()
})

await test('double battles announce every active Pokemon once', async (environment) => {
  const playerPokemon = [pokemon(25), pokemon(94)]
  const opponentPokemon = [pokemon(6), pokemon(9)]
  const audio = createBattleAudio()
  await audio.preload([...playerPokemon, ...opponentPokemon])
  audio.start({ player: playerPokemon[0], opponent: opponentPokemon[0], playerPokemon, opponentPokemon })
  await environment.advance(2400)
  const ids = cries(environment).map((source) => Number(source.buffer.assetPath.match(/\/(\d+)\.ogg$/)[1])).sort((a, b) => a - b)
  assert.deepEqual(ids, [6, 9, 25, 94], 'Opening cries must include both slots on both sides exactly once')
  audio.destroy()
})

await test('attack and impact source timing fits fast and normal animation windows', async (environment) => {
  const audio = createBattleAudio()
  await audio.preload()
  for (const [animationMode, durationMs] of [['normal', 650], ['fast', 180]]) {
    for (const phase of ['attack', 'impact']) {
      const before = environment.starts.length
      const startTime = environment.contexts[0].currentTime
      audio.playCue({ ...basicAttack, id: `${animationMode}-${phase}`, phase, effectiveness: 2, critical: true }, { durationMs, animationMode })
      const sources = environment.starts.slice(before)
      assert.ok(sources.length > 0)
      for (const source of sources) {
        assert.ok(source.startedAt >= startTime && source.startedAt < startTime + durationMs / 1000, `${animationMode} ${phase} starts after its animation`)
        assert.ok(source.endsAt <= startTime + durationMs / 1000 + 0.035, `${animationMode} ${phase} outlasts its animation: ${source.endsAt - startTime}s`)
      }
      await environment.advance(durationMs + 40)
    }
  }
  audio.destroy()
})

await test('all registered sound assets have valid audio containers and lifecycle PCM', () => {
  let pcmFiles = 0
  for (const [name, url] of Object.entries(BATTLE_SAMPLE_PATHS)) {
    const assetPath = path.join(projectRoot, 'public', url.replace(/^\//, ''))
    const bytes = fs.readFileSync(assetPath)
    assert.ok(bytes.length > 44, `${name} audio asset is empty`)
    if (url.endsWith('.ogg')) {
      assert.equal(bytes.toString('ascii', 0, 4), 'OggS', `${name} has an invalid Ogg header`)
      continue
    }
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF', `${name} has an invalid WAV header`)
    assert.equal(bytes.toString('ascii', 8, 12), 'WAVE', `${name} has an invalid WAV type`)
    let format
    let data
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const kind = bytes.toString('ascii', offset, offset + 4)
      const length = bytes.readUInt32LE(offset + 4)
      assert.ok(offset + 8 + length <= bytes.length, `${name} has a truncated WAV chunk`)
      if (kind === 'fmt ') format = bytes.subarray(offset + 8, offset + 8 + length)
      if (kind === 'data') data = bytes.subarray(offset + 8, offset + 8 + length)
      offset += 8 + length + length % 2
    }
    assert.ok(format && data, `${name} is missing WAV format or audio samples`)
    const encoding = format.readUInt16LE(0)
    const channels = format.readUInt16LE(2)
    const rate = format.readUInt32LE(4)
    const bits = format.readUInt16LE(14)
    const duration = data.length / (rate * channels * bits / 8)
    assert.ok(duration > 0.02 && duration < 30, `${name} has an unexpected duration: ${duration}s`)
    if (encoding !== 1 || bits !== 16) continue
    pcmFiles += 1
    let peak = 0
    let squareSum = 0
    for (let offset = 0; offset < data.length; offset += 2) {
      const sample = data.readInt16LE(offset) / 32768
      peak = Math.max(peak, Math.abs(sample))
      squareSum += sample * sample
    }
    assert.ok(peak > 0.005, `${name} recording is silent`)
    assert.ok(Math.sqrt(squareSum / (data.length / 2)) > 0.001, `${name} recording has no usable signal`)
    if (url.includes('/retro/')) {
      assert.equal(channels, 1, `${name} must be mono`)
      assert.equal(rate, 22050, `${name} has an unexpected sample rate`)
      assert.ok(duration >= 0.18 && duration <= 0.75, `${name} effect is outside the intended short cue duration`)
      assert.ok(peak >= 0.80 && peak <= 0.83, `${name} peak must retain clipping headroom`)
      const trailingSamples = Math.floor(rate * 0.035) * channels * 2
      assert.ok(data.subarray(data.length - trailingSamples).every((value) => value === 0), `${name} requires a quiet ending`)
    }
  }
  assert.ok(pcmFiles >= 4, 'Expected PCM move and lifecycle recordings to be checked')
})

if (failures.length) {
  console.error(`Battle audio validation failed: ${failures.length}/${passed + failures.length} checks.`)
  process.exitCode = 1
} else {
  console.log(`Validated ${passed} battle audio behaviors and ${moveData.moves.length} moves with and without audio assets.`)
}
