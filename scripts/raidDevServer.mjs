import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { createMemoryRankedStore } from '../server/rankedStore.js'
import { createRaidPreset } from '../server/raidBattle.js'
import * as engine from '../server/raidBattle.js'
import { createRaidHttpHandler, createLocalRaidAuthenticator } from '../server/raidHttp.js'
import { createRaidService } from '../server/raidService.js'
import { migratePokemonCollection } from '../src/data/pokemonPool.js'

const LOOPBACK = new Set(['127.0.0.1', '::1'])
export const RAID_TEST_IDENTITIES = Object.freeze(['alice', 'bob', 'charlie'])

export function createRaidTestBoxes() {
  const presets = [
    { speciesId: 150, captureId: 'raid-test-mewtwo', moves: ['psystrike', 'aurasphere', 'icebeam', 'shadowball'] },
    { speciesId: 248, captureId: 'raid-test-tyranitar', moves: ['crunch', 'stoneedge', 'earthquake', 'dragondance'] },
    { speciesId: 382, captureId: 'raid-test-kyogre', moves: ['waterspout', 'originpulse', 'icebeam', 'thunder'] },
    { speciesId: 1008, captureId: 'raid-test-miraidon', moves: ['electrodrift', 'dracometeor', 'paraboliccharge', 'protect'] },
    { speciesId: 131, captureId: 'raid-test-lapras', moves: ['freezedry', 'hydropump', 'lifedew', 'reflect'] },
  ]
  return Object.fromEntries(RAID_TEST_IDENTITIES.map(identity => [identity, migratePokemonCollection(presets.map(preset => (
    // Every isolated loopback account receives the same opaque capture ids,
    // but the service still resolves each one against that account only.
    // `createRaidPreset` is an engine fixture and marks a Pokémon as an
    // undrawn template. The real GameApp collection intentionally hides
    // those templates, so promote these explicit local-test fixtures to
    // owned captures before the browser writes its box storage.
    { ...createRaidPreset(preset, preset.captureId), directDrawCount: 1 }
  )))]))
}

function nodeHandler(handler, originRef) {
  return createServer(async (incoming, outgoing) => {
    try {
      const url = new URL(incoming.url, originRef.value)
      if (url.pathname !== '/api/raid') {
        outgoing.writeHead(404, { 'Content-Type': 'application/json' })
        outgoing.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not found' } }))
        return
      }
      const request = new Request(url, {
        method: incoming.method,
        headers: incoming.headers,
        ...(!['GET', 'HEAD'].includes(incoming.method ?? 'GET') ? { body: Readable.toWeb(incoming), duplex: 'half' } : {}),
      })
      const response = await handler(request)
      outgoing.writeHead(response.status, Object.fromEntries(response.headers))
      outgoing.end(Buffer.from(await response.arrayBuffer()))
    } catch {
      outgoing.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      outgoing.end(JSON.stringify({ error: { code: 'LOCAL_SERVER_ERROR', message: '로컬 보스전 서버 요청에 실패했습니다.' } }))
    }
  })
}

// This launcher uses the same raid service and battle engine as production,
// but binds only loopback and accepts only the three explicit test identities.
// Fixture Pokémon are resolved on the server; browser input still sends only a
// capture id, as it does in a production raid room.
export async function startRaidDevServer({ port = 8789, host = '127.0.0.1', boxes = createRaidTestBoxes(), now = Date.now, timeouts } = {}) {
  if (!LOOPBACK.has(host)) throw new Error('Raid development server must bind a loopback address')
  const store = createMemoryRankedStore()
  const resolvePokemon = async (identity, selected) => {
    const suffix = String(identity?.uid ?? '').replace(/^ranked-test-/, '')
    const owned = boxes[suffix]?.find(pokemon => pokemon.captureId === selected?.captureId)
    if (!owned) {
      const error = new Error('Fixture does not own the requested Pokémon')
      error.code = 'POKEMON_NOT_OWNED'
      error.status = 403
      throw error
    }
    return structuredClone(owned)
  }
  const service = createRaidService({ store, engine, resolvePokemon, now, timeouts })
  const handler = createRaidHttpHandler({
    enabled: true,
    service,
    authenticate: createLocalRaidAuthenticator({ enabled: true, production: false }),
    allowLocalOrigins: true,
    now,
  })
  const originRef = { value: `http://${host}:${port}` }
  const server = nodeHandler(handler, originRef)
  try {
    await new Promise((resolvePromise, reject) => { server.once('error', reject); server.listen(port, host, resolvePromise) })
  } catch (error) {
    await store.close()
    throw error
  }
  const address = server.address()
  originRef.value = `http://${host}:${address.port}`
  let closed = false
  return {
    url: `${originRef.value}/api/raid`,
    port: address.port,
    boxes,
    service,
    store,
    async close() {
      if (closed) return
      closed = true
      await new Promise((resolvePromise, reject) => server.close(error => error ? reject(error) : resolvePromise()))
      await store.close()
    },
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2)
  if (!args.includes('--test-accounts')) throw new Error('Use --test-accounts to start an explicit loopback-only raid server')
  const portIndex = args.indexOf('--port')
  const port = portIndex >= 0 ? Number(args[portIndex + 1]) : 8789
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port')
  const server = await startRaidDevServer({ port })
  console.log(`Local raid test server: ${server.url}`)
  console.log('Test accounts: alice / bob / charlie. Data stays in memory and is erased on exit.')
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await server.close(); process.exit(0) })
}
