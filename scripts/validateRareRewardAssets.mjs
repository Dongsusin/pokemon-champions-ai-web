import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { POKEMON_SKINS, RARE_BATTLE_ITEMS, getSkinSpritePresentation } from '../src/data/rareRewards.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public')
const sources = new Map()
async function dimensions(source) {
  assert(source.startsWith('/assets/'), 'Rewards must ship with local artwork')
  const file = path.resolve(root, `.${source}`)
  assert(file.startsWith(`${root}${path.sep}`))
  const bytes = await readFile(file)
  assert(bytes.length > 1000, `${source} must contain actual artwork`)
  let size
  if (bytes.toString('ascii', 0, 3) === 'GIF') {
    size = { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) }
  } else {
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${source} must decode as PNG or GIF`)
    size = { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
  }
  assert(size.width > 16 && size.height > 16)
  sources.set(source, size)
  return size
}

for (const skin of POKEMON_SKINS) {
  assert.notEqual(skin.spriteFront, skin.spriteBack, 'Battle backs must have their own view')
  for (const sprite of [skin.spriteFront, skin.spriteBack]) {
    const presentation = getSkinSpritePresentation(sprite)
    assert(presentation)
    const size = await dimensions(presentation.source)
    if (presentation.frame) {
      const { x, y, width, height, sheetWidth, sheetHeight } = presentation.frame
      assert.deepEqual(size, { width: sheetWidth, height: sheetHeight })
      assert(x >= 0 && y >= 0 && width > 0 && height > 0)
      assert(x + width <= sheetWidth && y + height <= sheetHeight)
      // The next artwork row starts immediately after each 90px cell.
      assert.equal(height, 90, 'Do not expose the neighboring row of the source sheet')
    }
  }
}
for (const item of RARE_BATTLE_ITEMS) await dimensions(item.sprite)
assert.equal(getSkinSpritePresentation('https://example.invalid/ordinary.gif'), null)
console.log(`Rare reward artwork passed: ${POKEMON_SKINS.length * 2} front/back views, ${RARE_BATTLE_ITEMS.length} item, ${sources.size} local files and safe atlas bounds.`)
