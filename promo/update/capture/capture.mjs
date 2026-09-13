import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createServer } from 'vite'
import { createMemoryRankedStore } from '../../../server/rankedStore.js'
import { createRankedTestTeams, startRankedDevServer } from '../../../scripts/rankedDevServer.mjs'
import { normalizePokemon } from '../../../src/data/trainingData.js'
import { createSavedTeams } from '../../../src/data/teamData.js'
import { INITIAL_VP_BALANCE } from '../../../src/data/pokemonPool.js'
import { resolveChromiumExecutable } from '../../scripts/browserRuntime.mjs'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const output = path.join(root, 'promo/update/generated/footage')
await fs.mkdir(output, { recursive: true })
const resumeStats = process.argv.includes('--resume-stats')
const statsOnly = process.argv.includes('--stats-only') || resumeStats
const normalResultOnly = process.argv.includes('--normal-result')
const priorManifest = (statsOnly || normalResultOnly) ? JSON.parse(await fs.readFile(path.join(output,'manifest.json'),'utf8')) : null
if(priorManifest) await fs.writeFile(path.join(output,'ranked-capture-audit.json'),JSON.stringify(priorManifest,null,2))
const require = createRequire(new URL('../../package.json', import.meta.url))
const { chromium } = require('playwright')
const ffmpeg = require('ffmpeg-static')
// A resumed filming pass restores the exact database produced by earlier local
// play. It never creates or edits aggregate counts.
const store = createMemoryRankedStore(resumeStats ? JSON.parse(await fs.readFile(path.join(output,'local-playback-state.json'),'utf8')) : undefined)
const shots = [], errors = [], blocked = new Set(), failedRequests = [], battleEvidence = []
let backend, frontend, browser, alice, bob, phase = 'setup'
const rosters = createRankedTestTeams()
const itemSets = [
  ['life-orb', 'charizardite-x', 'assault-vest', 'black-sludge', 'choice-specs', 'leftovers'],
  ['focus-sash', 'heavy-duty-boots', 'leftovers', 'black-sludge', 'choice-specs', 'assault-vest'],
  ['light-ball', 'choice-scarf', 'choice-specs', 'life-orb', 'focus-sash', 'sitrus-berry'],
]
const otherItems = ['lum-berry', 'leftovers', 'sitrus-berry', 'focus-sash', 'assault-vest', 'weakness-policy']
const owned = rosters.flatMap((team, side) => team.pokemon.map((pokemon, i) => normalizePokemon({ ...pokemon,
  captureId: `dex-${pokemon.speciesId}`, directDrawCount: 1, heldItemId: (side ? otherItems : itemSets[0])[i] })))
const teams = createSavedTeams(owned.slice(0,6).map(p=>p.captureId),owned.map(p=>p.captureId))
teams[1].pokemonIds = owned.slice(6).map(p=>p.captureId)
teams[2].pokemonIds = [0,2,4,6,8,10].map(i=>owned[i].captureId)
teams[3].pokemonIds = [1,3,5,7,9,11].map(i=>owned[i].captureId)
teams[4].pokemonIds = [0,1,6,7,8,11].map(i=>owned[i].captureId)
const inventory = Object.fromEntries([...new Set([...itemSets.flat(),...otherItems,'rocky-helmet','expert-belt','choice-band'])].map(id=>[id,10]))
const pause = (page,seconds)=>page.waitForTimeout(seconds*1000)
const live = ()=>backend.service.execute({uid:'ranked-test-alice',name:'테스트 트레이너 A'},{action:'usage'})

async function loaded(page) {
  await page.evaluate(()=>document.fonts.ready)
  await page.evaluate(()=>document.querySelectorAll('img').forEach(i=>{i.loading='eager'}))
  await page.waitForFunction(()=>[...document.images].filter(i=>i.getBoundingClientRect().width>0).every(i=>i.complete && i.naturalWidth>0),null,{timeout:60000})
  await pause(page,.35)
}
async function startShot(id,duration,action=async()=>{}) {
  if(statsOnly && id.startsWith('ranked-')) { await action({});return }
  phase = `capture ${id}`
  await loaded(alice)
  await alice.mouse.move(1910,1070)
  await alice.evaluate(()=>{const n=document.createElement('div');n.id='capture-marker';n.style.cssText='position:fixed;inset:0;background:rgb(0,255,0);z-index:2147483647';document.body.append(n)})
  await alice.screenshot({timeout:60000})
  await pause(alice,.55)
  await alice.evaluate(()=>document.getElementById('capture-marker').remove())
  const start=Date.now()
  const image=path.join(output,`${id}.png`)
  await alice.screenshot({path:image,timeout:60000})
  const info={id,duration,image,wallStart:start,actions:[],viewport:{width:1920,height:1080}}
  shots.push(info)
  await action(info)
  await pause(alice,Math.max(0,duration-(Date.now()-start)/1000))
  info.recordedDuration=(Date.now()-start)/1000
  info.visibleImages=await alice.evaluate(()=>[...document.images].filter(i=>i.getBoundingClientRect().width>0).map(i=>({source:i.currentSrc,loaded:i.complete&&i.naturalWidth>0})))
  await alice.screenshot({path:path.join(output,`${id}-end.png`),timeout:60000})
  console.log(`SHOT ${id} ${info.recordedDuration.toFixed(1)}s`)
}
async function openRanked(page) {
  await page.locator('.mode-start').click()
  await page.locator('.battle-hub-card.ranked').click()
  await page.getByRole('button',{name:'대전 상대 찾기',exact:true}).waitFor()
}
async function selectTeam(page,n) {
  await page.locator('.ranked-team-slots button').nth(n-1).click()
}
async function selectBattle(page,format,order) {
  await page.locator('.ranked-format-tabs').getByRole('button',{name:format==='single'?'싱글배틀':'더블배틀',exact:true}).click()
  await page.getByRole('button',{name:'대전 상대 찾기',exact:true}).click()
  await page.locator('.ranked-selection-heading').waitFor()
  for (const index of order) await page.locator('button.ranked-pokemon-card').nth(index).click()
}
async function ready(page) {
  await page.locator('.battle-game-screen').waitFor()
  const intro=page.locator('.battle-intro-overlay button')
  if(await intro.count())await intro.last().click()
  for(let i=0;i<5;i++) {
    const dialogue=page.locator('.battle-trainer-dialogue-box')
    if(!await dialogue.count())break
    await dialogue.click();await pause(page,.15)
  }
  await page.waitForFunction(()=>window.__captureBattle&&!window.__captureBattle.introVisible&&!window.__captureBattle.isTurnAnimating,null,{timeout:60000})
  await loaded(page)
}
async function move(page,preferred='') {
  await page.locator('.battle-command-buttons .fight').click()
  const slots=await page.evaluate(()=>window.__captureBattle.battle.player.activeIndexes.length)
  for(let i=0;i<slots;i++) {
    const moves=page.locator('.battle-move-button:not(:disabled)')
    await moves.first().waitFor()
    const match=preferred?moves.filter({hasText:preferred}):moves.filter({hasText:'NOT A MOVE'})
    await (await match.count()?match.first():moves.first()).click()
    const targets=page.locator('.battle-target-grid button:not(:disabled)')
    if(await targets.count()) await targets.first().click()
  }
}
async function endMatch(capture=false) {
  await bob.locator('.ranked-battle-connection').getByRole('button',{name:'기권',exact:true}).click()
  await bob.getByRole('button',{name:'기권하기',exact:true}).click()
  await Promise.all([alice,bob].map(p=>p.getByRole('button',{name:'레이팅 로비로',exact:true}).waitFor({timeout:60000})))
  if(capture) await startShot('ranked-result',7)
  battleEvidence.push({result:await alice.locator('.ranked-result').innerText().catch(()=>alice.locator('body').innerText())})
  await Promise.all([alice,bob].map(p=>p.getByRole('button',{name:'레이팅 로비로',exact:true}).click()))
}

try {
  backend=await startRankedDevServer({port:0,store,testAccounts:true,usageEnabled:true,timeouts:{selection:180000,turn:180000,playbackGrace:0}})
  Object.assign(process.env,{VITE_POKEMON_USAGE_ENABLED:'true',VITE_POKEMON_USAGE_DEMO:'false',VITE_POKEMON_USAGE_SEEDED_TEST:'false',VITE_RANKED_ENABLED:'true',VITE_RANKED_LOCAL_TEST:'false',VITE_RANKED_API_URL:'/api/ranked'})
  frontend=await createServer({root,mode:'update-capture',plugins:[{name:'update-isolated-auth',enforce:'pre',
    resolveId(source){if(/\/auth\/firebaseClient(?:\.js)?$/.test(source))return '\0capture-auth'},
    load(id){if(id==='\0capture-auth')return 'export const firebaseAuth={currentUser:window.__captureUser};export const firebaseDb=null;export const isFirebaseConfigured=false;export const missingFirebaseEnvironmentVariables=[];'},
  }],server:{host:'127.0.0.1',port:5268,strictPort:false,hmr:false,proxy:{'/api/ranked':{target:new URL(backend.url).origin,changeOrigin:true}}},logLevel:'error'})
  await frontend.listen()
  const url=`http://127.0.0.1:${frontend.httpServer.address().port}`
  const html=await frontend.transformIndexHtml('/capture.html','<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body><div id="root"></div><script type="module" src="/promo/update/capture/entry.jsx"></script></body></html>')
  const allowed=new Set([url,new URL(backend.url).origin])
  browser=await chromium.launch({executablePath:await resolveChromiumExecutable(chromium),headless:true,args:['--autoplay-policy=no-user-gesture-required','--disable-background-timer-throttling','--disable-renderer-backgrounding']})
  async function makePage(identity,record=false) {
    const context=await browser.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:1,serviceWorkers:'block',reducedMotion:'no-preference',...(record?{recordVideo:{dir:output,size:{width:1920,height:1080}}}:{})})
    await context.addInitScript(({identity,owned,teams,inventory,balance,normalResultOnly})=>{
      window.__captureUser={uid:`ranked-test-${identity}`,displayName:`테스트 트레이너 ${identity==='alice'?'A':'B'}`,isLocalGuest:false,getIdToken:async()=>`ranked-test-${identity}`}
      if(!localStorage.getItem('update-capture-ready')) {
        localStorage.setItem('champions-dex-v2',JSON.stringify(owned))
        localStorage.setItem('champions-teams-v1',JSON.stringify({activeTeamId:identity==='alice'?'team-1':'team-2',teams}))
        localStorage.setItem('champions-battle-items-v1',JSON.stringify(inventory))
        localStorage.setItem('champions-vp-v1',String(balance))
        localStorage.setItem('champions-draw-tutorial-v1','complete')
        localStorage.setItem('champions-settings-v1',JSON.stringify({audio:{enabled:false},game:{attackAnimation:normalResultOnly?'fast':'normal',hpBarSpeed:normalResultOnly?'fast':'normal'}}))
        localStorage.setItem('update-capture-ready','true')
      }
    },{identity,owned,teams,inventory,balance:INITIAL_VP_BALANCE,normalResultOnly})
    await context.route('**/*',async route=>{
      const request=route.request(),target=new URL(request.url())
      if(!allowed.has(target.origin)) {
        if(request.method()==='GET'&&['raw.githubusercontent.com','play.pokemonshowdown.com'].includes(target.hostname)) return route.continue()
        blocked.add(`${request.resourceType()} ${target.origin}`);return route.abort('blockedbyclient')
      }
      if(target.pathname==='/capture.html')return route.fulfill({contentType:'text/html',body:html})
      if(target.pathname==='/src/BattleScreen.jsx') {
        const response=await route.fetch();let body=await response.text()
        assert(body.includes('const currentLogEntry ='))
        body=body.replace('const currentLogEntry =','window.__captureBattle={battle,menu,commandSlot,isTurnAnimating,introVisible}; const currentLogEntry =')
        return route.fulfill({response,body})
      }
      return route.continue()
    })
    const page=await context.newPage();page.setDefaultTimeout(30000)
    page.on('pageerror',e=>errors.push({identity,message:e.message}));page.on('console',m=>{if(m.type()==='error')console.log('BROWSER',m.text())})
    page.on('requestfailed',r=>{if(r.resourceType()==='image')failedRequests.push(r.url())})
    await page.goto(`${url}/capture.html`)
    await page.locator('.mode-usage').waitFor()
    await loaded(page)
    return page
  }
  alice=await makePage('alice',true);bob=await makePage('bob')
  if(!resumeStats)assert(Object.values((await live()).buckets).every(b=>b.teamCount===0))
  await Promise.all([alice,bob].map(openRanked));await pause(alice,3);console.log('LOBBY',await alice.locator('.ranked-error').allTextContents())
  if(normalResultOnly) {
    phase='complete a normal single battle'
    await Promise.all([alice,bob].map(p=>p.getByRole('button',{name:'대전 상대 찾기',exact:true}).click()))
    await Promise.all([alice,bob].map(p=>p.locator('.ranked-selection-heading').waitFor()))
    for(const page of [alice,bob]) {
      for(const n of (page===alice?[0,1,2]:[1,5,2])) await page.locator('button.ranked-pokemon-card').nth(n).click()
      await page.getByRole('button',{name:'선출 확정',exact:true}).click()
    }
    await Promise.all([alice,bob].map(ready))
    let actions=0
    const deadline=Date.now()+360000
    while(Date.now()<deadline && !await alice.locator('.ranked-result').count()) {
      for(const page of [alice,bob]) {
        const replacement=page.locator('.battle-party-menu-grid button:not(:disabled)')
        if(await replacement.count()) {await replacement.first().click();continue}
        const fight=page.locator('.battle-command-buttons .fight:not(:disabled)')
        if(await fight.count()) {await move(page,page===bob?'방어':'');actions++}
      }
      await pause(alice,.4)
    }
    await alice.locator('.ranked-result.outcome-win').waitFor({timeout:30000})
    const result=await alice.locator('.ranked-result').innerText()
    assert(!result.includes('기권'))
    assert(result.includes('+600 VP'))
    battleEvidence.push({kind:'normal-win',actions,result})
    await startShot('ranked-result',8)
  } else {
  let aiFormat='double'
  if(!resumeStats) {
  await startShot('ranked-lobby',11,async()=>{
    await pause(alice,1)
    await alice.locator('.ranked-format-tabs').getByRole('button',{name:'더블배틀',exact:true}).click();await pause(alice,1.7)
    await selectTeam(alice,2);await pause(alice,1.3)
    await selectTeam(alice,1)
    await alice.locator('.ranked-roster-card').first().hover();await pause(alice,3)
    await alice.screenshot({path:path.join(output,'ranked-tooltip.png')})
    await alice.mouse.move(1910,1070)
    await alice.locator('.ranked-format-tabs').getByRole('button',{name:'싱글배틀',exact:true}).click()
  })
  for (const [index,format] of ['single','double'].entries()) {
    phase=`${format} match`
    for (const page of [alice,bob]) await page.locator('.ranked-format-tabs').getByRole('button',{name:format==='single'?'싱글배틀':'더블배틀',exact:true}).click()
    await Promise.all([alice,bob].map(p=>p.getByRole('button',{name:'대전 상대 찾기',exact:true}).click()))
    await Promise.all([alice,bob].map(p=>p.locator('.ranked-selection-heading').waitFor()))
    const orderA=format==='single'?[0,1,2]:[1,2,0,3],orderB=format==='single'?[1,0,2]:[0,2,1,3]
    if(index===0) await startShot('ranked-select',9,async()=>{
      for(const n of orderA){await pause(alice,.8);await alice.locator('button.ranked-pokemon-card').nth(n).click()}
      await pause(alice,2)
    })
    else for(const n of orderA)await alice.locator('button.ranked-pokemon-card').nth(n).click()
    for(const n of orderB)await bob.locator('button.ranked-pokemon-card').nth(n).click()
    await Promise.all([alice,bob].map(p=>p.getByRole('button',{name:'선출 확정',exact:true}).click()))
    await Promise.all([alice,bob].map(ready))
    const before=await alice.evaluate(()=>window.__captureBattle.battle.turn)
    await startShot(`ranked-${format}`,15,async()=>{
      await pause(alice,.8)
      await move(alice)
      await move(bob)
      await alice.waitForFunction(turn=>window.__captureBattle.battle.turn>turn&&!window.__captureBattle.isTurnAnimating,before,{timeout:90000})
    })
    battleEvidence.push({format,beforeTurn:before,afterTurn:await alice.evaluate(()=>window.__captureBattle.battle.turn),usage:await live()})
    await endMatch(index===0)
  }

  // Additional real selections populate three held-item choices. No count,
  // rate, result, or ranking is directly written to the statistics store.
  for(let variation=1;variation<3;variation++) {
    phase=`played item variation ${variation}`
    console.log('PHASE',phase)
    await alice.evaluate(items=>{
      const party=JSON.parse(localStorage.getItem('champions-dex-v2'))
      for(const [i,id] of [25,6,9,3,94,143].entries()) party.find(member=>member.speciesId===id).heldItemId=items[i]
      localStorage.setItem('champions-dex-v2',JSON.stringify(party))
    },itemSets[variation])
    await alice.reload();await alice.locator('.mode-usage').waitFor();await openRanked(alice)
    for(const page of [alice,bob]) await page.locator('.ranked-format-tabs').getByRole('button',{name:'싱글배틀',exact:true}).click()
    await Promise.all([alice,bob].map(p=>p.getByRole('button',{name:'대전 상대 찾기',exact:true}).click()))
    await Promise.all([alice,bob].map(p=>p.locator('.ranked-selection-heading').waitFor()))
    for(const page of [alice,bob]) {
      const order=page===alice?[0,1,2]:variation===1?[0,3,4]:[2,4,5]
      for(const n of order)await page.locator('button.ranked-pokemon-card').nth(n).click()
      await page.getByRole('button',{name:'선출 확정',exact:true}).click()
    }
    await Promise.all([alice,bob].map(ready))
    await Promise.all([alice,bob].map(p=>move(p,'방어')))
    await alice.waitForFunction(()=>window.__captureBattle.battle.turn>=2&&!window.__captureBattle.isTurnAnimating,null,{timeout:90000})
    await endMatch()
  }
  phase='real AI sample'
  console.log('PHASE',phase)
  await alice.locator('.ranked-header .screen-back-button').click()
  await alice.locator('.battle-hub-card.ai').click()
  await alice.locator('.battle-mode-option-card').filter({hasText:'128강 토너먼트'}).click()
  await alice.getByRole('button',{name:'이 모드로 시작',exact:true}).click()
  const selections=alice.locator('.competition-team-selection button')
  if(await selections.count()) {
    const count=Number((await alice.locator('.competition-team-selection header strong').textContent()).split('/')[1].trim())
    for(let i=0;i<count;i++)if(await selections.nth(i).getAttribute('aria-pressed')!=='true')await selections.nth(i).click()
  }
  await alice.getByRole('button',{name:/배틀 시작/}).click()
  await alice.locator('.battle-game-screen').waitFor()
  for(let i=0;i<6;i++){const d=alice.locator('.battle-trainer-dialogue-box');if(await d.count())await d.click();await pause(alice,.5)}
  await ready(alice);aiFormat=await alice.evaluate(()=>window.__captureBattle.battle.rules.format.id);await move(alice,'방어')
  await alice.waitForFunction(()=>window.__captureBattle.battle.turn>=2&&!window.__captureBattle.isTurnAnimating,null,{timeout:90000})
  for(let i=0;i<3;i++){const d=alice.locator('.battle-trainer-dialogue-box');if(await d.count())await d.click();await pause(alice,.2)}
  await alice.locator('.battle-command-buttons .surrender').click()
  await pause(alice,1)
  for(let i=0;i<4;i++){const d=alice.locator('.battle-trainer-dialogue-box');if(await d.count())await d.click();await pause(alice,.3)}
  if(await alice.locator('.battle-result-overlay').count())await alice.getByRole('button',{name:'배틀 마치기'}).click()
  await alice.locator('.mode-usage').waitFor()
  } else {
    await alice.locator('.ranked-header .screen-back-button').click()
    await alice.locator('.battle-hub-heading .screen-back-button').click()
  }
  await alice.locator('.mode-usage').click()
  await alice.locator('.pokemon-usage-screen').waitFor()
  await alice.getByRole('tab',{name:'레이팅 배틀',exact:true}).click()
  await alice.locator('.pokemon-usage-formats').getByRole('button',{name:'싱글배틀',exact:true}).click()
  await alice.waitForFunction(()=>document.querySelector('.pokemon-usage-panel')?.getAttribute('aria-busy')==='false')
  await startShot('usage',14,async()=>{
    await pause(alice,4)
    await alice.locator('.pokemon-usage-list-scroll').evaluate(e=>e.scrollTo({top:340,behavior:'smooth'}));await pause(alice,2)
    await alice.locator('.pokemon-usage-list-scroll').evaluate(e=>e.scrollTo({top:0,behavior:'smooth'}))
    await alice.locator('.pokemon-usage-formats').getByRole('button',{name:'더블배틀',exact:true}).click();await pause(alice,2.2)
    await alice.getByRole('tab',{name:'AI 대전',exact:true}).click()
    await alice.locator('.pokemon-usage-formats').getByRole('button',{name:aiFormat==='single'?'싱글배틀':'더블배틀',exact:true}).click();await pause(alice,2)
    await alice.getByRole('tab',{name:'레이팅 배틀',exact:true}).click()
    await alice.locator('.pokemon-usage-formats').getByRole('button',{name:'싱글배틀',exact:true}).click()
  })
  await alice.locator('.pokemon-usage-back').click()
  await alice.locator('.mode-collection').click()
  await alice.locator('.pc-party-card').filter({hasText:'피카츄'}).locator('button').first().click()
  await alice.locator('.pokedex-held-item-button').click()
  await alice.locator('.item-recommendation-card').first().waitFor()
  assert.equal(await alice.locator('.item-recommendation-card').count(),3)
  await startShot('equipment',11,async()=>{
    await pause(alice,2)
    await alice.getByRole('searchbox',{name:'보유 아이템 검색',exact:true}).fill('구애');await pause(alice,2.4)
    await alice.getByRole('searchbox',{name:'보유 아이템 검색',exact:true}).fill('');await pause(alice,2)
    await alice.locator('.item-recommendation-card[data-item-id="life-orb"]').click();await pause(alice,1.2)
    await alice.locator('.pokedex-held-item-button').click()
  })
  const usage=await live()
  await fs.writeFile(path.join(output,'actual-local-usage.json'),JSON.stringify(usage,null,2))
  }
  assert.equal(errors.length,0,JSON.stringify(errors))
} catch(error) {
  console.error(`FAIL ${phase}: ${error.stack}`)
  errors.push({phase,message:error.stack})
  await alice?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{})
  await fs.writeFile(path.join(output,'failure.txt'),await alice?.locator('body').innerText().catch(()=>'')??'')
  process.exitCode=1
} finally {
  await fs.writeFile(path.join(output,normalResultOnly?'normal-result-playback-state.json':'local-playback-state.json'),JSON.stringify(await store.inspect(),null,2))
  if(alice) {
    const video=alice.video();await alice.context().close()
    const file=path.join(output,normalResultOnly?'normal-result-session.webm':statsOnly?'stats-session.webm':'session.webm');await video.saveAs(file);await video.delete()
    const p=spawnSync(ffmpeg,['-hide_banner','-loglevel','error','-i',file,'-vf','fps=25,scale=4:4:flags=neighbor,format=rgb24','-f','rawvideo','pipe:1'],{windowsHide:true,maxBuffer:8*1024*1024})
    if(p.status!==0)throw Error(p.stderr.toString())
    const ends=[];let wasGreen=false
    for(let f=0;f<p.stdout.length;f+=48){let n=0;for(let i=f;i<f+48;i+=3)if(p.stdout[i]<30&&p.stdout[i+1]>220&&p.stdout[i+2]<30)n++
      const green=n>=15;if(wasGreen&&!green)ends.push(f/48/25);wasGreen=green}
    shots.forEach((shot,i)=>{
      shot.sourceVideo=file;shot.cleanStartSeconds=ends[i];shot.usableDuration=shot.recordedDuration;shot.recommendedTrimOffset=0
      if(ends[i]!==undefined&&shot.recordedDuration){shot.video=path.join(output,`${shot.id}.mp4`)
        const result=spawnSync(ffmpeg,['-hide_banner','-loglevel','error','-y','-ss',String(ends[i]),'-i',file,'-t',String(shot.recordedDuration),'-an','-c:v','libx264','-preset','fast','-crf','17','-pix_fmt','yuv420p','-movflags','+faststart',shot.video],{windowsHide:true,maxBuffer:1024*1024});assert.equal(result.status,0,result.stderr?.toString())
      }
    })
  }
  await fs.writeFile(path.join(output,'manifest.json'),JSON.stringify({shots:[...(priorManifest?.shots.filter(s=>normalResultOnly?!shots.some(next=>next.id===s.id):s.id.startsWith('ranked-'))??[]),...shots],errors,blocked:[...blocked],failedImageRequests:failedRequests,battleEvidence:[...(priorManifest?.battleEvidence??[]),...battleEvidence],provenance:'Actual production GameApp and ranked battle engine; separate loopback API, memory-only store, isolated test accounts. Statistics produced only by real selections and one actual GameApp AI start. No seeded or edited usage counts. All browser state is isolated from the user and production.'},null,2))
  await browser?.close();await frontend?.close();await backend?.close()
}
