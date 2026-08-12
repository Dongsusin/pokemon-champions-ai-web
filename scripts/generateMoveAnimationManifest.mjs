import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const moveDataPath = path.join(rootDir, 'src', 'data', 'generatedBattleMoves.json')
const outputPath = path.join(rootDir, 'src', 'data', 'generatedMoveAnimationManifest.json')
const outputAssetDir = path.join(rootDir, 'public', 'assets', 'move-fx', 'ebdx')

function argumentValue(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : null
}

const sourceRoot = path.resolve(argumentValue('--source') ?? process.env.EBDX_SOURCE_DIR ?? '')
if (!sourceRoot || sourceRoot === path.parse(sourceRoot).root) {
  throw new Error('Pass the extracted EBDX animation pack with --source or EBDX_SOURCE_DIR.')
}

const animationCodeDir = path.join(
  sourceRoot,
  'Plugins',
  'Elite Battle DX',
  '[002] Animation Code',
  'Move Animations',
)
const sourceAssetDir = path.join(sourceRoot, 'Graphics', 'EBDX', 'Animations', 'Moves')

const TYPE_FALLBACKS = {
  normal: { physical: ['tackle'], special: ['hyperbeam'], status: ['doubleteam', 'growl'] },
  fighting: { physical: ['closecombat', 'brickbreak'], special: ['aurasphere'], status: ['bulkup'] },
  flying: { physical: ['wingattack', 'aerialace'], special: ['airslash'], status: ['roost'] },
  poison: { physical: ['poisonjab'], special: ['sludgebomb'], status: ['toxic'] },
  ground: { physical: ['earthquake'], special: ['earthpower'], status: ['mudsport', 'sandattack'] },
  rock: { physical: ['rockslide'], special: ['ancientpower'], status: ['rockpolish'] },
  bug: { physical: ['bugbite', 'xscissor'], special: ['strugglebug', 'bugbuzz'], status: ['ragepowder', 'stringshot'] },
  ghost: { physical: ['shadowclaw'], special: ['shadowball'], status: ['confuseray', 'spite'] },
  steel: { physical: ['ironhead'], special: ['flashcannon', 'magnetbomb'], status: ['autotomize', 'irondefense'] },
  fire: { physical: ['flareblitz', 'firepunch'], special: ['flamethrower'], status: ['willowisp'] },
  water: { physical: ['waterfall', 'crabhammer'], special: ['watergun', 'surf'], status: ['aquaring', 'raindance'] },
  grass: { physical: ['leafblade', 'vinewhip'], special: ['leafstorm', 'energyball'], status: ['ingrain', 'synthesis'] },
  electric: { physical: ['spark', 'thunderpunch'], special: ['thunderbolt'], status: ['thunderwave'] },
  psychic: { physical: ['psychocut'], special: ['psychic'], status: ['calmmind', 'meditate'] },
  ice: { physical: ['iciclecrash', 'icepunch'], special: ['icebeam'], status: ['mist', 'hail'] },
  dragon: { physical: ['dragonclaw'], special: ['dragonpulse', 'dragonbreath'], status: ['dragondance'] },
  dark: { physical: ['nightslash', 'crunch'], special: ['darkpulse'], status: ['nastyplot'] },
  fairy: { physical: ['playrough'], special: ['moonblast', 'dazzlinggleam'], status: ['charm'] },
  stellar: { physical: ['tackle'], special: ['hyperbeam'], status: ['doubleteam'] },
}

const GLOBAL_FALLBACKS = {
  physical: ['tackle', 'quickattack', 'bite'],
  special: ['swift', 'hyperbeam', 'watergun'],
  status: ['doubleteam', 'growl', 'protect'],
}

const normalizeId = (value = '') => value.toLowerCase().replace(/[^a-z0-9]+/g, '')
const unique = (values) => [...new Set(values)]
const clamp = (minimum, value, maximum) => Math.min(maximum, Math.max(minimum, value))

async function assertDirectory(directoryPath, label) {
  const stat = await fs.stat(directoryPath).catch(() => null)
  if (!stat?.isDirectory()) throw new Error(`${label} not found: ${directoryPath}`)
}

function pngDimensions(buffer) {
  if (buffer.length < 24 || buffer.toString('ascii', 1, 4) !== 'PNG') return null
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  }
}

function expandAssetToken(token, assetStems) {
  const cleanToken = token.replace(/\.png$/i, '')
  if (!cleanToken.includes('#{')) return assetStems.has(cleanToken) ? [cleanToken] : []

  const prefix = cleanToken.slice(0, cleanToken.indexOf('#{'))
  const suffix = cleanToken.slice(cleanToken.indexOf('}') + 1)
  return [...assetStems].filter((assetName) => assetName.startsWith(prefix) && assetName.endsWith(suffix))
}

function extractAssetTokens(sourceText) {
  const tokens = []
  const patterns = [
    /Graphics\/EBDX\/Animations\/Moves\/([^"')]+)/gi,
    /["'](eb[A-Za-z0-9_#{}+\-]+)["']/g,
  ]

  patterns.forEach((pattern) => {
    for (const match of sourceText.matchAll(pattern)) tokens.push(match[1])
  })
  return unique(tokens)
}

function extractAssetNames(sourceText, assetStems) {
  return unique(extractAssetTokens(sourceText).flatMap((token) => expandAssetToken(token, assetStems)))
}

function extractBackgroundNames(sourceText, assetStems) {
  const names = []
  sourceText.split(/\r?\n/).forEach((line) => {
    if (!/(?:\["bg|battlebg|background|setBitmap)/i.test(line)) return
    names.push(...extractAssetNames(line, assetStems))
  })
  return unique(names)
}

function extractFrameCrops(sourceText, pngMetadata) {
  const crops = new Map()
  const literalPattern = /pbBitmap\(["']Graphics\/EBDX\/Animations\/Moves\/([A-Za-z0-9_]+)["']\)(?:(?!pbBitmap\()[\s\S]){0,700}?src_rect\.set\(\s*[^,\r\n]+\s*,\s*[^,\r\n]+\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/g

  for (const match of sourceText.matchAll(literalPattern)) {
    const [, assetName, frameWidthText, frameHeightText] = match
    const dimensions = pngMetadata.get(assetName)
    const frameWidth = Number(frameWidthText)
    const frameHeight = Number(frameHeightText)
    if (!dimensions || frameWidth <= 0 || frameHeight <= 0) continue
    if (dimensions.width % frameWidth || dimensions.height % frameHeight) continue

    const columns = dimensions.width / frameWidth
    const rows = dimensions.height / frameHeight
    if (columns * rows <= 1 || columns * rows > 32) continue
    crops.set(assetName, { frameWidth, frameHeight, columns, rows, count: columns * rows })
  }

  return crops
}

function estimateDuration(sourceText) {
  const loopFrames = []
  const patterns = [/(\d+)\.times\s+do/g, /(?:for|while)\s+\w+\s+in\s+0\.\.\.(\d+)/g]
  patterns.forEach((pattern) => {
    for (const match of sourceText.matchAll(pattern)) loopFrames.push(Number(match[1]))
  })

  const explicitWaits = [...sourceText.matchAll(/@scene\.wait\(\s*(\d+)/g)].map((match) => Number(match[1]))
  loopFrames.sort((left, right) => right - left)
  const weightedFrames = (loopFrames[0] ?? 36) + (loopFrames[1] ?? 0) * 0.35 + explicitWaits.reduce((sum, value) => sum + value, 0)
  return Math.round(clamp(1200, weightedFrames * 25, 3000))
}

function sourceKindForMove(generation, specific) {
  if (generation <= 5) return specific ? 'ebdx-bw2-style-specific' : 'ebdx-bw2-style-fallback'
  return specific ? 'ebdx-fanmade-specific' : 'ebdx-fanmade-fallback'
}

await assertDirectory(animationCodeDir, 'EBDX move animation scripts')
await assertDirectory(sourceAssetDir, 'EBDX move graphics')

const [moveData, scriptFiles, pngFiles] = await Promise.all([
  fs.readFile(moveDataPath, 'utf8').then(JSON.parse),
  fs.readdir(animationCodeDir, { withFileTypes: true }),
  fs.readdir(sourceAssetDir, { withFileTypes: true }),
])

const pngNames = pngFiles
  .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.png'))
  .map((entry) => entry.name)
  .sort((left, right) => left.localeCompare(right, 'en'))
const assetStems = new Set(pngNames.map((fileName) => path.basename(fileName, path.extname(fileName))))
const pngMetadata = new Map()

await Promise.all(pngNames.map(async (fileName) => {
  const buffer = await fs.readFile(path.join(sourceAssetDir, fileName))
  const dimensions = pngDimensions(buffer)
  if (dimensions) pngMetadata.set(path.basename(fileName, '.png'), dimensions)
}))

const definitions = new Map()
const scripts = scriptFiles
  .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.rb'))
  .sort((left, right) => left.name.localeCompare(right.name, 'en'))

for (const scriptFile of scripts) {
  const scriptPath = path.join(animationCodeDir, scriptFile.name)
  const sourceText = await fs.readFile(scriptPath, 'utf8')
  const definitionMatches = [...sourceText.matchAll(/EliteBattle\.defineMoveAnimation\(\s*:([A-Z0-9_]+)\s*\)/gi)]
  const fileAssets = extractAssetNames(sourceText, assetStems)
  const fileBackgrounds = extractBackgroundNames(sourceText, assetStems)
  const frameCrops = extractFrameCrops(sourceText, pngMetadata)

  definitionMatches.forEach((match, definitionIndex) => {
    const nextMatch = definitionMatches[definitionIndex + 1]
    const section = sourceText.slice(match.index, nextMatch?.index ?? sourceText.length)
    const definitionId = normalizeId(match[1])
    const delegatedId = normalizeId(section.match(/EliteBattle\.playMoveAnimation\(\s*:([A-Z0-9_]+)/i)?.[1] ?? '')
    const sectionAssets = extractAssetNames(section, assetStems)
    const sectionBackgrounds = extractBackgroundNames(section, assetStems)

    definitions.set(definitionId, {
      definitionId,
      script: scriptFile.name,
      delegatedId: delegatedId || null,
      assets: sectionAssets.length ? sectionAssets : fileAssets,
      backgrounds: sectionBackgrounds.length ? sectionBackgrounds : fileBackgrounds,
      durationMs: estimateDuration(section),
      frameCrops,
    })
  })
}

function resolveDefinition(definitionId, trail = new Set()) {
  const definition = definitions.get(definitionId)
  if (!definition || trail.has(definitionId)) return null
  if (!definition.delegatedId) return definition

  const nextTrail = new Set(trail)
  nextTrail.add(definitionId)
  const delegated = resolveDefinition(definition.delegatedId, nextTrail)
  if (!delegated) return definition

  return {
    ...delegated,
    definitionId,
    script: definition.script,
    durationMs: definition.durationMs || delegated.durationMs,
  }
}

function definitionWithGraphics(definitionId) {
  const definition = resolveDefinition(definitionId)
  return definition?.assets?.length ? definition : null
}

function fallbackDefinition(move) {
  const candidates = [
    ...(TYPE_FALLBACKS[move.typeId]?.[move.categoryId] ?? []),
    ...(GLOBAL_FALLBACKS[move.categoryId] ?? []),
  ]
  for (const candidate of candidates) {
    const definition = definitionWithGraphics(candidate)
    if (definition) return definition
  }
  return [...definitions.keys()].map(definitionWithGraphics).find(Boolean) ?? null
}

function assetRecord(assetName, definition) {
  const dimensions = pngMetadata.get(assetName) ?? { width: 1, height: 1 }
  const frame = definition.frameCrops?.get(assetName) ?? null
  const background = definition.backgrounds.includes(assetName)
    || assetName.toLowerCase().includes('_bg')

  return {
    file: `${assetName}.png`,
    width: dimensions.width,
    height: dimensions.height,
    kind: background ? 'background' : 'sprite',
    ...(frame ? { frame } : {}),
  }
}

const manifestMoves = {}
let specificMoveCount = 0

for (const move of moveData.moves) {
  const moveIds = unique([normalizeId(move.id), normalizeId(move.englishName)])
  const exactDefinition = moveIds.map(definitionWithGraphics).find(Boolean) ?? null
  const definition = exactDefinition ?? fallbackDefinition(move)
  if (!definition) throw new Error(`No EBDX fallback animation is available for ${move.id}.`)

  const specific = Boolean(exactDefinition)
  if (specific) specificMoveCount += 1
  const assets = unique(definition.assets).map((assetName) => assetRecord(assetName, definition))
  const backgrounds = assets.filter((asset) => asset.kind === 'background')
  const sprites = assets.filter((asset) => asset.kind === 'sprite')

  manifestMoves[move.id] = {
    generation: move.generation,
    specific,
    sourceKind: sourceKindForMove(move.generation, specific),
    templateMoveId: definition.definitionId,
    script: definition.script,
    durationMs: definition.durationMs,
    backgrounds,
    assets: sprites.length ? sprites : assets,
  }
}

await fs.rm(outputAssetDir, { recursive: true, force: true })
await fs.mkdir(outputAssetDir, { recursive: true })
await Promise.all(pngNames.map((fileName) => (
  fs.copyFile(path.join(sourceAssetDir, fileName), path.join(outputAssetDir, fileName))
)))

const manifest = {
  generatedAt: new Date().toISOString(),
  source: {
    name: 'EBDX Animation Pack',
    styleBaseline: 'Pokémon Black 2 and White 2 inspired 2D battle effects',
    resourcePage: 'https://eeveeexpo.com/resources/1230/',
    enginePage: 'https://luka-sj.com/essentials/resources/EBDX',
    authors: ['Luka S.J.', 'NikDie'],
    note: 'Fan-made EBDX resources are used as a BW2-style web adaptation, not as an official BW2 ROM extraction.',
  },
  assetRoot: '/assets/move-fx/ebdx',
  assetCount: pngNames.length,
  scriptCount: scripts.length,
  definitionCount: definitions.size,
  moveCount: moveData.moves.length,
  specificMoveCount,
  fallbackMoveCount: moveData.moves.length - specificMoveCount,
  moves: manifestMoves,
}

await fs.writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
console.log(`Copied ${pngNames.length} EBDX move graphics.`)
console.log(`Mapped ${specificMoveCount}/${moveData.moves.length} moves to dedicated animation scripts.`)
console.log(`Wrote ${path.relative(rootDir, outputPath)}`)
