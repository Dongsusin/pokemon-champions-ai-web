import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createFileRankedStore } from '../server/rankedStore.js'
import { createRankedService } from '../server/rankedService.js'
import { createLocalRankedAuthenticator, createRankedHttpHandler } from '../server/rankedHttp.js'
import pokemonData from '../src/data/generatedPokemonData.json' with { type: 'json' }
import { getLearnableMoves, getMoveById } from '../src/data/trainingData.js'

export function createRankedTestTeams() {
  const rosters = [
    ['pikachu', 'charizard', 'blastoise', 'venusaur', 'gengar', 'snorlax'],
    ['dragonite', 'gyarados', 'arcanine', 'alakazam', 'machamp', 'lapras'],
  ]
  const preferred = ['thunderbolt', 'flamethrower', 'surf', 'energyball', 'shadowball', 'icebeam', 'rockslide', 'dragonclaw', 'bodypress', 'earthquake', 'voltswitch', 'uturn', 'protect']
  return rosters.map((slugs, number) => ({
    id: `ranked-test-team-${number + 1}`, name: number === 0 ? '관동 챌린저' : '관동 라이벌',
    pokemon: slugs.map(slug => {
      const profile = pokemonData.species.find(pokemon => pokemon.slug === slug)
      if (!profile) throw new Error(`Missing local test species: ${slug}`)
      const legal = getLearnableMoves(profile.id)
      const legalIds = new Set(legal.map(move => move.id))
      const moveIds = preferred.filter(id => legalIds.has(id)).slice(0, 3)
      if (legalIds.has('protect') && !moveIds.includes('protect')) moveIds.push('protect')
      for (const move of legal) if (moveIds.length < 4 && !moveIds.includes(move.id)) moveIds.push(move.id)
      return {
        captureId: `ranked-fixture-${slug}`, speciesId: profile.id, slug,
        nature: '노력', ability: profile.abilities[0], teraType: profile.types[0],
        trainingPoints: { hp: 0, attack: 0, defense: 0, specialAttack: 0, specialDefense: 0, speed: 0 },
        moveIds, moves: moveIds.map(id => getMoveById(id).name),
      }
    }),
  }))
}

export async function startRankedDevServer({ port = 8787, host = '127.0.0.1', testAccounts = false,
  filename = 'scripts/.cache/ranked-test/state.json', store: suppliedStore, engine: suppliedEngine, timeouts, usageEnabled = false } = {}) {
  if (!['127.0.0.1', '::1'].includes(host)) throw new Error('Ranked development server must bind a loopback address')
  const authenticate = createLocalRankedAuthenticator({ enabled: testAccounts })
  const engine = suppliedEngine ?? await import('../server/rankedBattle.js')
  const fixtures = createRankedTestTeams().map(team => ({ ...team, pokemon: engine.canonicalizeRankedTeam(team.pokemon, { format: 'single' }) }))
  const store = suppliedStore ?? await createFileRankedStore(filename)
  const service = createRankedService({ store, engine, fixtures, timeouts, usageEnabled })
  const handler = createRankedHttpHandler({ service, authenticate, enabled: true, allowLocalOrigins: true })
  let baseUrl
  const server = createServer(async (incoming, outgoing) => {
    try {
      const path = new URL(incoming.url, baseUrl)
      if (path.pathname !== '/api/ranked') { outgoing.writeHead(404); outgoing.end('Not found'); return }
      const request = new Request(path, {
        method: incoming.method,
        headers: incoming.headers,
        ...(!['GET', 'HEAD'].includes(incoming.method) ? { body: Readable.toWeb(incoming), duplex: 'half' } : {}),
      })
      const response = await handler(request)
      outgoing.writeHead(response.status, Object.fromEntries(response.headers))
      outgoing.end(Buffer.from(await response.arrayBuffer()))
    } catch {
      outgoing.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      outgoing.end(JSON.stringify({ error: { code: 'LOCAL_SERVER_ERROR', message: '로컬 대전 서버 요청에 실패했습니다.' } }))
    }
  })
  try {
    await new Promise((accept, reject) => { server.once('error', reject); server.listen(port, host, accept) })
  } catch (error) { await store.close(); throw error }
  const address = server.address()
  baseUrl = `http://${host.includes(':') ? `[${host}]` : host}:${address.port}`
  let closed = false
  return {
    url: `${baseUrl}/api/ranked`, port: address.port, service, server,
    async close() {
      if (closed) return
      closed = true
      await new Promise((accept, reject) => server.close(error => error ? reject(error) : accept()))
      await store.close()
    },
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2)
  if (!args.includes('--test-accounts')) throw new Error('Use --test-accounts to start an explicitly isolated local test server')
  const portIndex = args.indexOf('--port')
  const port = portIndex >= 0 ? Number(args[portIndex + 1]) : 8787
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port')
  const server = await startRankedDevServer({ port, testAccounts: true })
  console.log(`Local ranked test server: ${server.url}`)
  console.log('Test accounts: alice / bob / charlie. Data stays in scripts/.cache/ranked-test/state.json.')
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await server.close(); process.exit(0) })
}
