import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import battleItems from '../src/data/generatedBattleItems.js'
import { POKEMON_POOL } from '../src/data/pokemonPool.js'
import { getSpeciesProfile } from '../src/data/trainingData.js'
import {
  TRAINER_SPRITE_SLUGS,
  getPlayerTrainerSpriteCandidates,
} from '../src/data/trainerSprites.js'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const publicRoot = path.join(projectRoot, 'public')
const outputPath = path.join(publicRoot, 'resource-manifest.json')
const trainerTeamsPath = path.join(projectRoot, 'src', 'data', 'generatedTrainerTeams.json')
const showdownTrainerRoot = 'https://play.pokemonshowdown.com/sprites/trainers'
const pokemonCryRoot = 'https://raw.githubusercontent.com/PokeAPI/cries/main/cries/pokemon'
const ignoredPublicFiles = new Set(['resource-manifest.json', 'resource-worker.js'])
const runtimeExtensions = new Set([
  '.gif',
  '.jpeg',
  '.jpg',
  '.json',
  '.mp3',
  '.ogg',
  '.png',
  '.svg',
  '.wav',
  '.webmanifest',
  '.webp',
])

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nestedFiles = await Promise.all(entries.map((entry) => {
    const entryPath = path.join(directory, entry.name)
    return entry.isDirectory() ? listFiles(entryPath) : [entryPath]
  }))
  return nestedFiles.flat()
}

function resourceKind(url) {
  const pathname = new URL(url, 'https://champions-arena.local').pathname.toLowerCase()
  if (/\.(gif|jpe?g|png|svg|webp)$/.test(pathname)) return 'image'
  if (/\.(mp3|ogg|wav)$/.test(pathname)) return 'audio'
  return 'data'
}

function localResourceGroup(url) {
  if (url.includes('/brand/') || url.endsWith('/champions-lobby-bg.png')) return 'interface'
  if (url.includes('/battle-fields/')) return 'battle-field'
  if (url.includes('/audio/')) return 'audio'
  if (url.includes('/move-fx/')) return 'move-effect'
  if (url.includes('/pokemon/')) return 'pokemon'
  if (url.includes('/trainers/')) return 'trainer'
  if (url.includes('/items/')) return 'item'
  if (url.includes('/draw/')) return 'draw'
  return 'interface'
}

function groupPriority(group) {
  return {
    interface: 0,
    'battle-field': 1,
    audio: 2,
    'move-effect': 3,
    pokemon: 4,
    trainer: 5,
    item: 6,
    draw: 7,
    cry: 8,
  }[group] ?? 9
}

function collectTrainerSpeciesIds(value, speciesIds) {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectTrainerSpeciesIds(entry, speciesIds))
    return
  }
  if (!value || typeof value !== 'object') return
  if (Number.isInteger(value.speciesId)) speciesIds.add(value.speciesId)
  Object.values(value).forEach((entry) => collectTrainerSpeciesIds(entry, speciesIds))
}

function appendUrl(resources, url, group, source = 'remote') {
  if (typeof url !== 'string' || !url.startsWith('http')) return
  const current = resources.get(url)
  if (current && groupPriority(current.group) <= groupPriority(group)) return
  resources.set(url, {
    url,
    bytes: 0,
    group,
    kind: resourceKind(url),
    required: false,
    source,
  })
}

function appendSources(resources, value, group) {
  const sources = Array.isArray(value) ? value : [value]
  sources.forEach((source) => appendUrl(resources, source, group))
}

const resources = new Map()
const versionHash = createHash('sha256')
const publicFiles = await listFiles(publicRoot)

for (const filePath of publicFiles) {
  const relativePath = path.relative(publicRoot, filePath).split(path.sep).join('/')
  if (ignoredPublicFiles.has(relativePath) || !runtimeExtensions.has(path.extname(relativePath).toLowerCase())) {
    continue
  }

  const fileBuffer = await readFile(filePath)
  const revision = createHash('sha256').update(fileBuffer).digest('hex').slice(0, 16)
  const url = `/${relativePath}`
  resources.set(url, {
    url,
    bytes: fileBuffer.byteLength,
    group: localResourceGroup(url),
    kind: resourceKind(url),
    required: true,
    revision,
    source: 'local',
  })
  versionHash.update(url)
  versionHash.update(revision)
}

const trainerTeams = JSON.parse(await readFile(trainerTeamsPath, 'utf8'))
const battleSpeciesIds = new Set(POKEMON_POOL.map((pokemon) => pokemon.id))
collectTrainerSpeciesIds(trainerTeams, battleSpeciesIds)

const crySpeciesIds = new Set()
for (const speciesId of battleSpeciesIds) {
  const profile = getSpeciesProfile(speciesId)
  if (!profile) continue

  appendSources(resources, profile.icon, 'pokemon')
  appendSources(resources, profile.spriteFront, 'pokemon')
  appendSources(resources, profile.spriteBack, 'pokemon')
  appendSources(resources, profile.spriteFrontShiny, 'pokemon')
  appendSources(resources, profile.spriteBackShiny, 'pokemon')

  const crySpeciesId = Number(profile.parentSpeciesId ?? profile.id)
  if (Number.isInteger(crySpeciesId) && crySpeciesId > 0 && crySpeciesId <= 1025) {
    crySpeciesIds.add(crySpeciesId)
  }
}

for (const speciesId of crySpeciesIds) {
  const collection = speciesId <= 649 ? 'legacy' : 'latest'
  appendUrl(resources, `${pokemonCryRoot}/${collection}/${speciesId}.ogg`, 'cry')
}

for (const slug of Object.values(TRAINER_SPRITE_SLUGS)) {
  appendUrl(resources, `${showdownTrainerRoot}/${slug}.png`, 'trainer')
}
for (const url of getPlayerTrainerSpriteCandidates('male')) appendUrl(resources, url, 'trainer')
for (const url of getPlayerTrainerSpriteCandidates('female')) appendUrl(resources, url, 'trainer')
for (const item of battleItems) appendUrl(resources, item.sprite, 'item')

const sortedResources = [...resources.values()].sort((first, second) => (
  Number(second.required) - Number(first.required)
  || groupPriority(first.group) - groupPriority(second.group)
  || first.url.localeCompare(second.url)
))

for (const resource of sortedResources.filter((entry) => !entry.required)) {
  versionHash.update(resource.url)
}

const groups = Object.fromEntries([...new Set(sortedResources.map((entry) => entry.group))].map((group) => {
  const entries = sortedResources.filter((entry) => entry.group === group)
  return [group, {
    count: entries.length,
    bytes: entries.reduce((total, entry) => total + entry.bytes, 0),
  }]
}))

const manifest = {
  version: versionHash.digest('hex').slice(0, 20),
  resourceCount: sortedResources.length,
  requiredCount: sortedResources.filter((entry) => entry.required).length,
  totalBytes: sortedResources.reduce((total, entry) => total + entry.bytes, 0),
  groups,
  resources: sortedResources,
}

await writeFile(outputPath, `${JSON.stringify(manifest)}\n`)
console.log(`Generated ${path.relative(projectRoot, outputPath)} (${manifest.resourceCount} resources, ${manifest.version})`)
