import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import postcss from 'postcss'
import gameTextScale from './postcssGameTextScale.mjs'
import { applyGameTextScale } from '../src/gameTextScale.js'

const source = fileURLToPath(new URL('../src/text-scale-fixture.css', import.meta.url))
const processCss = async (css, from = source) => (await postcss([gameTextScale()]).process(css, { from })).css
const checks = []
async function test(name, run) { await run(); checks.push(name); console.log(`PASS ${name}`) }

await test('responsive absolute text scales inside media, container and pseudo-element rules', async () => {
  const css = await processCss('.log { font-size: 14px !important; width: 30px; } @media (max-width: 900px) { .log {font-size:clamp(9px, 2vw, 14px)} } @container (max-height: 400px) { .log::after {font-size: min(12px, 3cqh)} }')
  assert(css.includes('font-size: calc(14px * var(--game-text-scale, 1)) !important'))
  assert(css.includes('calc(clamp(9px, 2vw, 14px) * var(--game-text-scale, 1))'))
  assert(css.includes('calc(min(12px, 3cqh) * var(--game-text-scale, 1))'))
  assert(css.includes('width: 30px'))
})
await test('relative children and hidden labels preserve inheritance without double scaling', async () => {
  const css = '.relative {font-size:.75em} .percentage {font-size:80%} .hidden {font-size:0} .parent {font-size:inherit} .reset {font:inherit} .mixed {font-size:calc(100% - 2px)}'
  assert.equal(await processCss(css), css)
})
await test('rem scales once while the document root and geometry stay unchanged', async () => {
  const css = await processCss('html {font-size:16px} :root {font-size:16px} body {font-size:16px} .title {font-size:1.5rem; width:10rem; transform:scale(1)}')
  assert(css.includes('html {font-size:16px} :root {font-size:16px}'))
  assert(css.includes('body {font-size:calc(16px * var(--game-text-scale, 1))}'))
  assert(css.includes('calc(1.5rem * var(--game-text-scale, 1))'))
  assert(css.includes('width:10rem; transform:scale(1)'))
})
await test('explicit font shorthand retains its weight, line height and family', async () => {
  assert.equal(await processCss('.symbol {font:1000 42px/1 monospace}'), '.symbol {font:1000 calc(42px * var(--game-text-scale, 1))/1 monospace}')
})
await test('CSS transform is idempotent and excluded from dependencies and promotion assets', async () => {
  const input = '.title {font-size:clamp(12px,2vw,24px)}'
  const once = await processCss(input)
  assert.equal(await processCss(once), once)
  assert.equal(await processCss(input, fileURLToPath(new URL('../promo/style.css', import.meta.url))), input)
  assert.equal(await processCss(input, fileURLToPath(new URL('../node_modules/fixture/style.css', import.meta.url))), input)
})
await test('applying settings touches only typography variables and accepts the four supported scales', () => {
  const properties = new Map()
  const root = { style: { setProperty: (name, value) => properties.set(name, value) }, dataset: {} }
  globalThis.document = { documentElement: root }
  try {
    for (const scale of [0.5, 1, 1.5, 2]) {
      assert.equal(applyGameTextScale(scale), scale)
      assert.equal(properties.get('--game-text-scale'), String(scale))
      assert.equal(root.dataset.gameTextScale, String(scale))
    }
    for (const value of [undefined, null, '2', 3, NaN]) assert.equal(applyGameTextScale(value), 1)
    assert.equal(properties.size, 1)
    assert.deepEqual(Object.keys(root.dataset), ['gameTextScale'])
  } finally { delete globalThis.document }
  assert.equal(applyGameTextScale(2), 2, 'Server-side imports do not require a document')
})
console.log(`Game text scale validation passed: ${checks.length}/${checks.length}`)
