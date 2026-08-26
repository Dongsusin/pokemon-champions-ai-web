import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const API_ROOT = 'https://pokeapi.co/api/v2'
const CONCURRENCY = 24
const OUTPUT_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../src/data/generatedPokemonGenderData.json',
)

async function fetchJson(url, attempt = 0) {
  const response = await fetch(url, { headers: { accept: 'application/json' } })

  if (response.ok) return response.json()

  if ((response.status === 429 || response.status >= 500) && attempt < 5) {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 400 * 2 ** attempt))
    return fetchJson(url, attempt + 1)
  }

  throw new Error(`${response.status} ${response.statusText}: ${url}`)
}

async function mapConcurrent(items, worker, concurrency = CONCURRENCY) {
  const results = new Array(items.length)
  let nextIndex = 0

  async function runWorker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex
      nextIndex += 1
      results[currentIndex] = await worker(items[currentIndex])
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runWorker))
  return results
}

async function main() {
  const resource = await fetchJson(`${API_ROOT}/pokemon-species?limit=2000`)
  const details = await mapConcurrent(resource.results, (entry) => fetchJson(entry.url))
  const species = Object.fromEntries(
    details
      .slice()
      .sort((firstEntry, secondEntry) => firstEntry.id - secondEntry.id)
      .map((entry) => [entry.id, {
        genderRate: entry.gender_rate,
        hasGenderDifferences: Boolean(entry.has_gender_differences),
      }]),
  )
  const output = {
    generatedAt: new Date().toISOString(),
    source: `${API_ROOT}/pokemon-species`,
    speciesCount: details.length,
    species,
  }

  await mkdir(dirname(OUTPUT_PATH), { recursive: true })
  await writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
  process.stdout.write(`Generated gender metadata for ${details.length} Pokémon species.\n`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
