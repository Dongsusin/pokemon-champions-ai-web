import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { RARE_BATTLE_ITEMS } from '../src/data/rareRewards.js'

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

for (const item of RARE_BATTLE_ITEMS) await dimensions(item.sprite)
console.log(`Rare reward artwork passed: ${RARE_BATTLE_ITEMS.length} item and ${sources.size} local files.`)
