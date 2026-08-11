import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const cacheDir = path.join(__dirname, '.cache')
const localizationCachePath = path.join(cacheDir, 'pokeapi-move-localization.json')
const showdownCachePath = path.join(cacheDir, 'showdown-moves.json')
const outputPath = path.join(rootDir, 'src', 'data', 'generatedBattleMoves.json')
const refresh = process.argv.includes('--refresh')
const concurrency = 24

const TYPE_LABELS = {
  normal: '노말',
  fire: '불꽃',
  water: '물',
  electric: '전기',
  grass: '풀',
  ice: '얼음',
  fighting: '격투',
  poison: '독',
  ground: '땅',
  flying: '비행',
  psychic: '에스퍼',
  bug: '벌레',
  rock: '바위',
  ghost: '고스트',
  dragon: '드래곤',
  dark: '악',
  steel: '강철',
  fairy: '페어리',
  stellar: '스텔라',
}

const CATEGORY_LABELS = {
  physical: '물리',
  special: '특수',
  status: '변화',
}

const GENERATION_NUMBERS = {
  'generation-i': 1,
  'generation-ii': 2,
  'generation-iii': 3,
  'generation-iv': 4,
  'generation-v': 5,
  'generation-vi': 6,
  'generation-vii': 7,
  'generation-viii': 8,
  'generation-ix': 9,
}

const cleanText = (value = '') => value.replace(/[\n\f\r]+/g, ' ').replace(/\s+/g, ' ').trim()
const toId = (value = '') => value.toLowerCase().replace(/[^a-z0-9]+/g, '')

async function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'))
  } catch {
    return null
  }
}

async function fetchJson(url, attempt = 0) {
  const response = await fetch(url, { headers: { accept: 'application/json' } })
  if (response.ok) return response.json()

  if ((response.status === 429 || response.status >= 500) && attempt < 5) {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 350 * 2 ** attempt))
    return fetchJson(url, attempt + 1)
  }

  throw new Error(`${response.status} ${response.statusText}: ${url}`)
}

async function mapConcurrent(entries, worker) {
  const results = new Array(entries.length)
  let nextIndex = 0

  async function runWorker() {
    while (nextIndex < entries.length) {
      const currentIndex = nextIndex
      nextIndex += 1
      results[currentIndex] = await worker(entries[currentIndex], currentIndex)
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, entries.length) }, runWorker))
  return results
}

function localizedName(move, language) {
  return move.names.find((entry) => entry.language.name === language)?.name ?? ''
}

function localizedDescription(move) {
  const flavorText = move.flavor_text_entries.filter((entry) => entry.language.name === 'ko').at(-1)?.flavor_text
  const effectText = move.effect_entries.find((entry) => entry.language.name === 'ko')?.short_effect
  return cleanText(flavorText || effectText)
}

function compactMove(move) {
  return {
    number: move.id,
    pokeApiSlug: move.name,
    englishName: localizedName(move, 'en'),
    name: localizedName(move, 'ko'),
    description: localizedDescription(move),
    typeId: move.type.name,
    categoryId: move.damage_class.name,
    power: move.power,
    pp: move.pp,
    accuracy: move.accuracy,
    priority: move.priority,
    target: move.target.name,
    generation: GENERATION_NUMBERS[move.generation.name] ?? null,
  }
}

async function loadLocalizedMoves() {
  const cached = !refresh && await readJsonIfPresent(localizationCachePath)
  if (cached) return cached

  const resources = await fetchJson('https://pokeapi.co/api/v2/move?limit=2000')
  const details = await mapConcurrent(resources.results, (entry) => fetchJson(entry.url))
  const compact = details.map(compactMove)
  await fs.writeFile(localizationCachePath, `${JSON.stringify(compact)}\n`, 'utf8')
  return compact
}

async function loadShowdownMoves() {
  const cached = !refresh && await readJsonIfPresent(showdownCachePath)
  if (cached) return cached

  const data = await fetchJson('https://play.pokemonshowdown.com/data/moves.json')
  await fs.writeFile(showdownCachePath, `${JSON.stringify(data)}\n`, 'utf8')
  return data
}

function fallbackDescription(move) {
  if (move.categoryId === 'status') return `배틀의 흐름을 바꾸는 ${TYPE_LABELS[move.typeId]}타입 변화 기술이다.`
  return `상대를 공격하는 ${TYPE_LABELS[move.typeId]}타입 기술이다.`
}

await fs.mkdir(cacheDir, { recursive: true })

const [localizedMoves, showdownMoves] = await Promise.all([
  loadLocalizedMoves(),
  loadShowdownMoves(),
])
const localizedByNumber = new Map(localizedMoves.map((move) => [move.number, move]))
const localizedById = new Map(localizedMoves.map((move) => [toId(move.pokeApiSlug), move]))
const moves = Object.entries(showdownMoves).flatMap(([showdownId, showdownMove]) => {
  if (showdownMove.num <= 0 || showdownMove.isZ || showdownMove.isMax) return []
  if (['CAP', 'Custom'].includes(showdownMove.isNonstandard)) return []

  const localized = localizedByNumber.get(showdownMove.num) ?? localizedById.get(showdownId)
  if (!localized?.name || !TYPE_LABELS[localized.typeId] || !CATEGORY_LABELS[localized.categoryId]) return []

  return [{
    id: showdownId,
    number: showdownMove.num,
    name: localized.name,
    englishName: showdownMove.name || localized.englishName,
    type: TYPE_LABELS[localized.typeId],
    typeId: localized.typeId,
    category: CATEGORY_LABELS[localized.categoryId],
    categoryId: localized.categoryId,
    power: Number(showdownMove.basePower ?? localized.power) || 0,
    pp: Number(showdownMove.pp ?? localized.pp) || 1,
    accuracy: typeof showdownMove.accuracy === 'number' ? showdownMove.accuracy : localized.accuracy,
    accuracyLabel: showdownMove.accuracy === true || localized.accuracy === null ? '필중' : null,
    priority: Number(showdownMove.priority ?? localized.priority) || 0,
    target: showdownMove.target ?? localized.target,
    generation: localized.generation,
    description: localized.description || fallbackDescription(localized),
    flags: Object.keys(showdownMove.flags ?? {}),
  }]
}).sort((left, right) => left.number - right.number || left.name.localeCompare(right.name, 'ko'))

const output = {
  generatedAt: new Date().toISOString(),
  source: {
    battleData: 'https://play.pokemonshowdown.com/data/moves.json',
    localization: 'https://pokeapi.co/api/v2/move',
  },
  moveCount: moves.length,
  moves,
}

await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
console.log(`Generated ${moves.length} localized battle moves.`)
console.log(`Wrote ${path.relative(rootDir, outputPath)}`)
