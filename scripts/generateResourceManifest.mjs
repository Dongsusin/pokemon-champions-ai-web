import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const publicRoot = path.join(projectRoot, 'public')
const outputPath = path.join(publicRoot, 'resource-manifest.json')
const startupAssetPaths = [
  'assets/brand/champions-arena-emblem.png',
  'assets/champions-lobby-bg.jpg',
]

function resourceKind(url) {
  const pathname = new URL(url, 'https://champions-arena.local').pathname.toLowerCase()
  if (/\.(gif|jpe?g|png|svg|webp)$/.test(pathname)) return 'image'
  if (/\.(mp3|ogg|wav)$/.test(pathname)) return 'audio'
  return 'data'
}

const versionHash = createHash('sha256')
const resources = []

for (const relativePath of startupAssetPaths) {
  const normalizedPath = relativePath.split(path.sep).join('/')
  const fileBuffer = await readFile(path.join(publicRoot, relativePath))
  const revision = createHash('sha256').update(fileBuffer).digest('hex').slice(0, 16)
  const url = `/${normalizedPath}`

  resources.push({
    url,
    bytes: fileBuffer.byteLength,
    group: 'interface',
    kind: resourceKind(url),
    required: true,
    revision,
    source: 'local',
  })
  versionHash.update(url)
  versionHash.update(revision)
}

const totalBytes = resources.reduce((total, resource) => total + resource.bytes, 0)
const manifest = {
  version: versionHash.digest('hex').slice(0, 20),
  strategy: 'startup-critical',
  resourceCount: resources.length,
  requiredCount: resources.length,
  totalBytes,
  groups: {
    interface: {
      count: resources.length,
      bytes: totalBytes,
    },
  },
  resources,
}

await writeFile(outputPath, `${JSON.stringify(manifest)}\n`)
console.log(`Generated ${path.relative(projectRoot, outputPath)} (${manifest.resourceCount} startup resources, ${manifest.version})`)
