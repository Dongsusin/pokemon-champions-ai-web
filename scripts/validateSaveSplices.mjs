import assert from 'node:assert/strict'
import { gzipSync } from 'node:zlib'
import { createAccountSavePatch } from '../src/auth/accountSavePatch.js'

const tests = []
const test = (name, run) => tests.push({ name, run })
const key = 'champions-dex-v2'
const apply = (previous, delta) => {
  const next = { ...previous, ...delta.patch }
  for (const name of delta.removed) delete next[name]
  for (const [name, [start, removed, text]] of Object.entries(delta.splices ?? {})) {
    const points = [...next[name]]
    next[name] = points.slice(0, start).join('') + text + points.slice(start + removed).join('')
  }
  return next
}
const patch = (previous, next) => createAccountSavePatch(previous, next, { splices: true })

test('a single trained Pokemon uploads a small edit instead of the entire collection', () => {
  const collection = Array.from({ length: 1000 }, (_, i) => ({ captureId: `owned-${i}`, speciesId: i % 541 + 1,
    name: `포켓몬 ${i} 🐉`, moves: ['몸통박치기', '방어', '회복', '불꽃세례'], training: { hp: 10, attack: 20 } }))
  const previous = { [key]: JSON.stringify(collection), 'champions-vp-v1': '100' }
  collection[500].training.attack = 21
  const next = { ...previous, [key]: JSON.stringify(collection) }
  const delta = patch(previous, next)
  assert(delta.splices?.[key], 'Negotiated collection edit must produce a splice')
  assert.equal(delta.patch[key], undefined)
  assert.deepEqual(apply(previous, delta), next)
  const oldWire = gzipSync(JSON.stringify(createAccountSavePatch(previous, next))).length * 4 / 3
  const newWire = Buffer.byteLength(JSON.stringify(delta))
  assert(newWire < oldWire * 0.05, `Changed collection transfer was not reduced by 95%: ${oldWire} -> ${newWire}`)
  console.log(JSON.stringify({ scenario: '1000 Pokemon single training edit', oldWireBytes: Math.ceil(oldWire), newWireBytes: newWire }))
})
test('Unicode code point offsets preserve emoji, Korean and combined marks at both splice boundaries', () => {
  for (const [before, after] of [['😀'.repeat(800), '😀'.repeat(400) + '😃' + '😀'.repeat(399)],
    ['한글é🐉'.repeat(500), '한글é🐉'.repeat(250) + '수정🦊' + '한글é🐉'.repeat(250)],
    ['a'.repeat(2000), '🦊' + 'a'.repeat(2000)], ['a'.repeat(2000), 'a'.repeat(2000) + '🐉']]) {
    const previous = { [key]: before }, next = { [key]: after }, delta = patch(previous, next)
    assert(delta.splices?.[key])
    assert.deepEqual(apply(previous, delta), next)
  }
})
test('small values, entirely replaced strings and new keys retain ordinary patch compatibility', () => {
  const previous = { [key]: 'a'.repeat(2000), 'champions-vp-v1': '10' }
  const next = { [key]: 'b'.repeat(2000), 'champions-vp-v1': '20', 'champions-settings-v1': '{}' }
  const delta = patch(previous, next)
  assert.equal(delta.splices, undefined)
  assert.deepEqual(delta.patch, next)
  assert.deepEqual(apply(previous, delta), next)
})
test('whole key deletion and character deletion remain distinct, and unchanged snapshots are empty', () => {
  const previous = { [key]: '0123456789'.repeat(300), 'champions-settings-v1': '{}' }
  const next = { [key]: previous[key].slice(0, 700) + previous[key].slice(900) }
  const delta = patch(previous, next)
  assert(delta.splices?.[key])
  assert.deepEqual(delta.removed, ['champions-settings-v1'])
  assert.deepEqual(apply(previous, delta), next)
  assert.deepEqual(patch(next, next), { patch: {}, removed: [] })
})
test('a server negotiating version one continues receiving the complete changed storage key', () => {
  const previous = { [key]: 'a'.repeat(2000) }, next = { [key]: 'a'.repeat(1999) + 'b' }
  const delta = createAccountSavePatch(previous, next)
  assert.equal(delta.splices, undefined)
  assert.equal(delta.patch[key], next[key])
})

let failed = 0
for (const { name, run } of tests) {
  try { await run(); console.log(`PASS ${name}`) }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.message}`) }
}
console.log(JSON.stringify({ tests: tests.length, passed: tests.length - failed, failed }))
process.exitCode = failed ? 1 : 0
