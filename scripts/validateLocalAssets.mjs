import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SPECIES_PROFILES } from '../src/data/trainingData.js'
import { ALL_BATTLE_ITEMS } from '../src/data/shopData.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await readFile(path.join(root, 'public/assets/vendor/manifest.json'), 'utf8'))
let bytes = 0, checked = 0
for (const [url, entry] of Object.entries(manifest.files)) {
  assert.ok(url.startsWith('/assets/') && !url.includes('..'), `Invalid asset path ${url}`)
  const data = await readFile(path.join(root, 'public', url.slice(1)))
  assert.equal(data.length, entry.bytes, `Truncated asset ${url}`)
  assert.equal(createHash('sha256').update(data).digest('hex'), entry.sha256, `Modified asset ${url}`)
  bytes += data.length
  checked++
}
for (const [group, choice] of Object.entries(manifest.choices)) assert.ok(choice && manifest.files[choice], `Missing offline resource ${group}`)
for (const profile of Object.values(SPECIES_PROFILES)) for (const key of ['icon', 'spriteFront', 'spriteBack', 'spriteFrontShiny', 'spriteBackShiny']) {
  assert.ok(profile[key]?.startsWith('/assets/'), `External or missing Pokémon resource: ${profile.id}:${key}`)
  assert.ok(manifest.files[profile[key]], `Uninstalled Pokémon resource: ${profile.id}:${key}`)
}
for (const item of ALL_BATTLE_ITEMS) if (item.sprite) assert.ok(item.sprite.startsWith('/assets/'), `External item resource: ${item.id}`)
assert.equal(manifest.failures.length, 0, 'Some resources failed to download')
assert.equal(manifest.missing.length, 0, 'Some resource groups are incomplete')
console.log(JSON.stringify({ checkedFiles: checked, profileCount: Object.keys(SPECIES_PROFILES).length,
  coveredGroups: Object.keys(manifest.choices).length, megabytes: +(bytes / 1024 / 1024).toFixed(1), missing: 0 }))
