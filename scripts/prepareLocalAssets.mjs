import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { NATIONAL_DEX, SPECIES_PROFILES } from '../src/data/trainingData.js'
import { ALL_BATTLE_ITEMS } from '../src/data/shopData.js'
import { TRAINER_SPRITE_SLUGS, getTrainerSpriteCandidates } from '../src/data/trainerSprites.js'
import { assetDownloadUrl, localAssetUrl } from '../src/local/localAssets.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const publicRoot = path.join(root, 'public')
const manifestPath = path.join(publicRoot, 'assets/vendor/manifest.json')
const groups = []
const add = (name, sources) => groups.push({ name, sources: [...new Set(sources.flat(2).filter(Boolean))] })
for (const profile of Object.values(SPECIES_PROFILES)) {
  const parent = SPECIES_PROFILES[profile.parentSpeciesId]
  for (const [primary, fallback] of [['icon', 'iconFallback'], ['spriteFront', 'spriteFrontFallback'], ['spriteBack', 'spriteBackFallback'],
    ['spriteFrontShiny', 'spriteFrontShinyFallback'], ['spriteBackShiny', 'spriteBackShinyFallback']]) {
    add(`pokemon:${profile.id}:${primary}`, [profile[primary], profile[fallback], parent?.[primary], parent?.[fallback]])
  }
}
for (const item of ALL_BATTLE_ITEMS) if (item.sprite) add(`item:${item.id}`, [item.sprite])
for (const name of Object.keys(TRAINER_SPRITE_SLUGS)) add(`trainer:${name}`, getTrainerSpriteCandidates({ name }))
for (const id of NATIONAL_DEX.map(entry => entry.id)) add(`cry:${id}`, (id <= 649 ? ['legacy', 'latest'] : ['latest', 'legacy'])
  .map(collection => `/assets/vendor/cries/pokemon/${collection}/${id}.ogg`))
const specHash = createHash('sha256').update(JSON.stringify(groups)).digest('hex')
let previous
try { previous = JSON.parse(await readFile(manifestPath, 'utf8')) } catch {}
if (previous?.specHash === specHash && !process.argv.includes('--verify')) {
  console.log(`Offline assets already prepared: ${Object.keys(previous.files).length} files`)
  process.exit(0)
}
const files = {}, attempts = new Map(), failures = []
let finished = 0, downloaded = 0
async function resolveAsset(source) {
  const local = localAssetUrl(source)
  if (!local || !local.startsWith('/assets/')) return false
  if (attempts.has(local)) return attempts.get(local)
  const promise = (async () => {
    const destination = path.resolve(publicRoot, `.${local}`)
    if (path.relative(publicRoot, destination).startsWith('..')) throw new Error('Invalid asset path')
    let data
    try { data = await readFile(destination) } catch (error) { if (error.code !== 'ENOENT') throw error }
    if (!data) {
      const remote = assetDownloadUrl(local)
      if (!remote.startsWith('https:')) return false
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const response = await fetch(remote, { signal: AbortSignal.timeout(20000) })
          if (response.status === 404) return false
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          data = Buffer.from(await response.arrayBuffer())
          if (!data.length || data.length > 8 * 1024 * 1024 || !/^(image|audio|application\/octet-stream)/.test(response.headers.get('content-type') ?? '')) throw new Error('Invalid asset response')
          await mkdir(path.dirname(destination), { recursive: true })
          await writeFile(destination, data)
          downloaded++
          break
        } catch (error) { if (attempt === 2) { failures.push({ source: remote, reason: error.message }); return false } }
      }
    }
    files[local] = { bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') }
    return true
  })()
  attempts.set(local, promise)
  return promise
}
let cursor = 0
const results = {}
await Promise.all(Array.from({ length: 16 }, async () => {
  while (cursor < groups.length) {
    const group = groups[cursor++]
    let chosen = null
    for (const source of group.sources) if (await resolveAsset(source)) { chosen = localAssetUrl(source); break }
    results[group.name] = chosen
    finished++
    if (finished % 500 === 0) console.log(`Offline assets ${finished}/${groups.length}, downloaded ${downloaded}`)
  }
}))
const missing = Object.entries(results).filter(([, selected]) => !selected).map(([name]) => name)
// Cry failure leaves the existing synthesized battle audio available. Missing
// art for known unavailable forms is listed explicitly, never fetched at play.
const manifest = { version: 1, specHash, generatedAt: new Date().toISOString(), files, choices: results, missing, failures }
await mkdir(path.dirname(manifestPath), { recursive: true })
await writeFile(manifestPath, JSON.stringify(manifest))
await writeFile(path.join(root, 'src/data/generatedLocalAssetChoices.json'), `${JSON.stringify(results)}\n`)
const bytes = Object.values(files).reduce((sum, file) => sum + file.bytes, 0)
console.log(JSON.stringify({ files: Object.keys(files).length, megabytes: +(bytes / 1024 / 1024).toFixed(1), missing: missing.length, networkFailures: failures.length }))
if (failures.length) { console.error('Some asset downloads failed. Retry npm run prepare:local-assets.'); process.exitCode = 1 }
