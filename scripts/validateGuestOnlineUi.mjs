import assert from 'node:assert/strict'
import { createServer as createHttpServer } from 'node:http'
import { Readable } from 'node:stream'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { resolveChromiumExecutable } from '../promo/scripts/browserRuntime.mjs'
import { createRankedService, RankedError } from '../server/rankedService.js'
import { createMemoryRankedStore } from '../server/rankedStore.js'
import { createRankedHttpHandler } from '../server/rankedHttp.js'
import { rankedIdentityFromVerifiedToken } from '../server/guestIdentity.js'
import * as engine from '../server/rankedBattle.js'
import { normalizePokemon } from '../src/data/trainingData.js'
import { createRankedClient } from '../src/rankedClient.js'

// Real React hooks/components talk to the real HTTP/service/engine on loopback.
// Only Firebase token verification and the saved-team loader are local fixtures;
// no production accounts, Firestore records, or synthetic published ranks exist.
const root = fileURLToPath(new URL('../', import.meta.url))
const store = createMemoryRankedStore()
const anonymous = rankedIdentityFromVerifiedToken({ uid: 'anonymous-ui-account', firebase: { sign_in_provider: 'anonymous' } })
const google = rankedIdentityFromVerifiedToken({ uid: 'google-ui-account', name: '김테스트', firebase: { sign_in_provider: 'google.com' } })
const team = [25, 6, 9, 143, 68, 131].map(speciesId => normalizePokemon({ speciesId, captureId: `guest-ui-${speciesId}` }))
const savedTeamsRead = []
const service = createRankedService({ store, engine, usageEnabled: true,
  resolveTeam: async (identity, supplied) => { savedTeamsRead.push(identity.uid); assert.deepEqual(supplied.map(p => p.captureId), team.map(p => p.captureId)); return team },
})
const profile = await service.execute(anonymous, { action: 'guestProfile' })
const requests = []
const handler = createRankedHttpHandler({ service, enabled: true, allowLocalOrigins: true,
  authenticate: async (_request, token) => {
    if (/^anonymous-access-\d+$/.test(token)) return anonymous
    if (token === 'google-ui-access') return google
    throw new RankedError('UNAUTHENTICATED', 'Test credential rejected', 401)
  },
})
const api = createHttpServer(async (request, response) => {
  try {
    const url = `http://127.0.0.1:${api.address().port}${request.url}`
    const body = ['GET', 'HEAD'].includes(request.method) ? undefined : Readable.toWeb(request)
    const result = await handler(new Request(url, { method: request.method, headers: request.headers,
      ...(body ? { body, duplex: 'half' } : {}) }))
    requests.push({ path: request.url, method: request.method, token: request.headers.authorization, status: result.status })
    response.writeHead(result.status, Object.fromEntries(result.headers))
    response.end(Buffer.from(await result.arrayBuffer()))
  } catch (error) { response.writeHead(500); response.end(error.message) }
})
await new Promise(resolve => api.listen(0, '127.0.0.1', resolve))
const apiUrl = `http://127.0.0.1:${api.address().port}/api/ranked`
let browser, vite, page, checked = 0
const pass = name => { checked++; console.log(`PASS ${name}`) }
try {
  let calls = 0
  const unauthenticated = createRankedClient({ apiUrl, fetchImpl: async () => { calls++; throw new Error('must not send') } })
  await assert.rejects(unauthenticated.request('status'), error => error.code === 'authentication-required')
  assert.equal(calls, 0)
  assert.throws(() => createRankedClient({ apiUrl, localTestIdentity: 'alice' }), error => error.code === 'local-test-only')
  assert.equal((await fetch(`${apiUrl}?action=status`)).status, 401)
  assert.equal((await fetch(`${apiUrl}?action=status`, { headers: { Authorization: 'Bearer ranked-test-alice' } })).status, 401)
  pass('production transport has no unauthenticated or local-test guest bypass')

  const entry = `import React,{useState}from'react';import{createRoot}from'react-dom/client';
import RankedBattleScreen from'/src/RankedBattleScreen.jsx';import usePokemonUsage from'/src/usePokemonUsage.js';import useBattleFactoryRankings from'/src/useBattleFactoryRankings.js';
import {createFactoryRun,selectFactoryRentals,selectFactoryLead,beginFactoryBattle,resolveFactoryBattle} from'/src/data/battleFactory.js';
import LoginScreen from'/src/LoginScreen.jsx';import SettingsModal from'/src/SettingsModal.jsx';import{DEFAULT_GAME_SETTINGS as DEFAULT_SETTINGS}from'/src/gameSettings.js';
const user={uid:${JSON.stringify(anonymous.uid)},displayName:${JSON.stringify(profile.displayName)},isAnonymous:true};const team=${JSON.stringify(team)};
function App(){const[mode,setMode]=useState('ranked');const[local,setLocal]=useState(false);const active=local?{...user,isAnonymous:false,isLocalGuest:true}:user;window.__activeUser=active;
const usage=usePokemonUsage(active);const ranking=useBattleFactoryRankings(active);window.__usage=usage;window.__ranking=ranking;window.__local=setLocal;
window.__finishFactory=()=>{const run=createFactoryRun({seed:11,id:'anonymous-ui-factory'});const ready=selectFactoryRentals(run,run.offers.slice(0,3).map(p=>p.captureId));const battle=beginFactoryBattle(selectFactoryLead(ready,ready.party[0].captureId));ranking.recordRun(resolveFactoryBattle(battle,{battleId:battle.battleId,winner:'opponent',forfeited:true}))};
return <div className="app-shell ranked-view"><nav className="topbar"><button onClick={()=>setMode('ranked')}>Ranked</button><button onClick={()=>setMode('usage')}>Usage</button><button onClick={()=>setMode('login')}>Login</button><button onClick={()=>setMode('settings')}>Settings</button></nav>
{mode==='ranked'?<RankedBattleScreen user={active}teams={[{id:'team-1',name:'팀 1',pokemonIds:team.map(p=>p.captureId)}]}boxPokemon={team}activeTeamId="team-1"onBeforeJoin={async()=>{window.__teamFlushes=(window.__teamFlushes??0)+1;return true}}onVpRewards={async reward=>{window.__vp=reward;return{appliedTotal:reward.total}}}/>
:mode==='login'?<LoginScreen configured={true}missingConfiguration={[]}/>:mode==='settings'?<SettingsModal settings={DEFAULT_SETTINGS}user={active}initialTab="account"onClose={()=>setMode('usage')}/>
:<output>{JSON.stringify({source:ranking.source,usage:usage.snapshot,usageError:usage.error,ranking:ranking.ownBest,rankingError:ranking.error})}</output>}</div>}
createRoot(document.getElementById('root')).render(<App/>);`
  Object.assign(process.env, { VITE_RANKED_ENABLED: 'true', VITE_RANKED_LOCAL_TEST: 'false',
    VITE_FACTORY_LOCAL_TEST: 'false', VITE_POKEMON_USAGE_ENABLED: 'true', VITE_POKEMON_USAGE_DEMO: 'false',
    VITE_RANKED_API_URL: '/api/ranked' })
  vite = await createServer({ root, mode: 'guest-ui-integration', logLevel: 'error',
    define: { 'import.meta.env.VITE_RANKED_ENABLED': '"true"', 'import.meta.env.VITE_RANKED_LOCAL_TEST': '"false"',
      'import.meta.env.VITE_FACTORY_LOCAL_TEST': '"false"', 'import.meta.env.VITE_POKEMON_USAGE_ENABLED': '"true"',
      'import.meta.env.VITE_POKEMON_USAGE_DEMO': '"false"', 'import.meta.env.VITE_RANKED_API_URL': JSON.stringify('/api/ranked') },
    plugins: [{ name: 'guest-ui-fixtures', enforce: 'pre', configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (request.url !== '/guest-ui.html') return next()
        const html = await server.transformIndexHtml('/guest-ui.html', '<!doctype html><html><head><style>*{box-sizing:border-box}body{margin:0}</style></head><body><div id="root"></div><script type="module" src="/guest-ui-entry.jsx"></script></body></html>')
        response.setHeader('Content-Type', 'text/html'); response.end(html)
      })
    }, resolveId(source) {
      if (source === '/guest-ui-entry.jsx') return source
      if (/\/auth\/firebaseClient(?:\.js)?$/.test(source)) return '\0guest-ui-auth'
    }, load(id) {
      if (id === '/guest-ui-entry.jsx') return entry
      if (id === '\0guest-ui-auth') return 'export const firebaseAuth={get currentUser(){return{...window.__activeUser,getIdToken:async()=>{window.__tokens=(window.__tokens??0)+1;return"anonymous-access-"+window.__tokens}}}};'
    } }], server: { host: '127.0.0.1', port: 0, hmr: false, proxy: { '/api/ranked': { target: new URL(apiUrl).origin } } } })
  await vite.listen()
  const pageUrl = `http://127.0.0.1:${vite.httpServer.address().port}/guest-ui.html`
  const { chromium } = createRequire(new URL('../promo/package.json', import.meta.url))('playwright')
  browser = await chromium.launch({ headless: true, executablePath: await resolveChromiumExecutable(chromium) })
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route(url => url.hostname !== '127.0.0.1', route => route.abort())
  await page.goto(pageUrl)
  await page.getByRole('button', { name: '대전 상대 찾기', exact: true }).waitFor()
  await page.waitForFunction(() => window.__vp?.uid === 'anonymous-ui-account')
  await page.getByRole('button', { name: '대전 상대 찾기', exact: true }).click()
  await page.getByText('대전 상대를 찾고 있습니다', { exact: true }).waitFor()
  assert.equal(await page.evaluate(() => window.__teamFlushes), 1)
  assert.deepEqual(savedTeamsRead, [anonymous.uid])
  pass('anonymous React ranked lobby joins with its saved six-member team after account flush')

  const opponent = await service.execute(google, { action: 'join', requestId: 'guest-ui-opponent-join', format: 'single', team })
  await page.getByText('3마리를 출전 순서대로 선택하세요', { exact: true }).waitFor()
  assert.equal(await page.locator('.ranked-team-preview').first().locator('header strong').textContent(), '김**')
  assert.equal(opponent.match.opponent.name, profile.displayName)
  assert.equal(opponent.match.opponent.isGuest, true)
  await page.getByRole('button', { name: '선출 포기', exact: true }).click()
  const selectionForfeitDialog = page.getByRole('dialog', { name: '레이팅 대전 기권', exact: true })
  await selectionForfeitDialog.waitFor()
  assert.equal(await page.getByRole('button', { name: '레이팅 로비로', exact: true }).count(), 0, 'Selection forfeit waits for explicit confirmation')
  await selectionForfeitDialog.getByRole('button', { name: '기권하기', exact: true }).click()
  await page.getByRole('button', { name: '레이팅 로비로', exact: true }).waitFor()
  pass('anonymous player matches a Google player with canonical guest display and masked Google name')

  await page.getByRole('button', { name: 'Usage', exact: true }).click()
  await page.evaluate(async () => { await window.__usage.refresh(); await window.__ranking.refresh() })
  assert.equal(await page.evaluate(() => window.__ranking.source), 'global')
  assert.equal(await page.evaluate(() => window.__usage.snapshot.source), 'live')
  await page.evaluate(() => window.__usage.recordAiBattle({ battleId: 'guest-ui-ai-usage', format: 'single', speciesIds: [25, 6, 9],
    team: [25, 6, 9].map(speciesId => ({ speciesId, heldItemId: null })) }))
  await page.waitForFunction(() => window.__usage.snapshot.buckets['ai-single'].teamCount === 1)
  await page.evaluate(() => window.__usage.recordAiBattle({ battleId: 'guest-ui-ai-usage', format: 'single', speciesIds: [25, 6, 9],
    team: [25, 6, 9].map(speciesId => ({ speciesId, heldItemId: null })) }))
  await page.evaluate(async () => window.__usage.refresh())
  assert.equal(await page.evaluate(() => window.__usage.snapshot.buckets['ai-single'].teamCount), 1)
  pass('anonymous usage hook reads real aggregates and submits deduplicated Pokémon/item observations')

  await page.evaluate(() => window.__finishFactory())
  await page.waitForFunction(() => window.__ranking.ownBest?.runId === 'anonymous-ui-factory')
  assert.equal(await page.evaluate(() => window.__ranking.ownBest.trainerName), profile.displayName)
  assert.equal((await service.execute(google, { action: 'factoryLeaderboard' })).entries[0].trainerName, profile.displayName)
  await page.reload()
  await page.getByRole('button', { name: 'Usage', exact: true }).click()
  await page.evaluate(async () => { await window.__ranking.refresh(); await window.__usage.refresh() })
  assert.equal(await page.evaluate(() => window.__ranking.ownBest.runId), 'anonymous-ui-factory')
  assert.equal(await page.evaluate(() => window.__usage.snapshot.buckets['ai-single'].teamCount), 1)
  pass('anonymous factory hook stores shared server ranking and reloads the same account record')

  await page.getByRole('button', { name: 'Login', exact: true }).click()
  assert.match(await page.locator('.guest-login-button').textContent(), /레이팅·통계/)
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Google 계정에 연결', exact: true }).waitFor()
  assert.match(await page.locator('.settings-account-card').textContent(), /GUEST TRAINER/)
  assert.match(await page.locator('.settings-account-card').textContent(), /클라우드 동기화/)
  assert.ok(!(await page.locator('.settings-account-warning').textContent()).includes('서버에 전송되지'))
  pass('login and account settings describe online guest storage and keep Google linking available')

  await page.getByRole('button', { name: 'Usage', exact: true }).click()
  await page.evaluate(() => window.__local(true))
  await page.waitForFunction(() => window.__ranking.source === 'local')
  const before = requests.length
  await page.evaluate(async () => { await window.__usage.refresh(); await window.__ranking.refresh() })
  assert.equal(requests.length, before)
  assert.match(await page.evaluate(() => window.__usage.error), /로그인 후/)
  await page.getByRole('button', { name: 'Ranked', exact: true }).click()
  await page.getByText('온라인 계정으로 참가하세요', { exact: true }).waitFor()
  assert.equal(requests.length, before)
  assert.deepEqual(errors, [])
  assert(requests.filter(r => r.status === 200 && r.token).every(r => /^Bearer anonymous-access-\d+$/.test(r.token)))
  pass('offline guest remains isolated and every online request uses a fresh authenticated token')
  console.log(`Guest online UI validation passed: ${checked}/${checked}`)
} catch (error) {
  console.error('Guest UI failure context', { requests: requests.map(({ path, method, status }) => ({ path, method, status })),
    alerts: await page?.locator('[role="alert"]').allTextContents(), client: await page?.evaluate(async () => {
      const client = await import('/src/rankedClient.js'); return { endpoint: client.rankedApiUrl, enabled: client.isRankedEnabled, tokens: window.__tokens }
    }) })
  throw error
} finally {
  await browser?.close()
  await vite?.close()
  await new Promise(resolve => api.close(resolve))
}
