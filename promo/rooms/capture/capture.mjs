import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createServer } from 'vite'
import { createMemoryRankedStore } from '../../../server/rankedStore.js'
import { createRankedService } from '../../../server/rankedService.js'
import { createRankedHttpHandler } from '../../../server/rankedHttp.js'
import * as engine from '../../../server/rankedBattle.js'
import { normalizePokemon, getMoveById } from '../../../src/data/trainingData.js'
import { createSavedTeams } from '../../../src/data/teamData.js'
import { resolveChromiumExecutable } from '../../scripts/browserRuntime.mjs'

if (process.env.NODE_ENV === 'production' || process.env.VERCEL) throw Error('Local capture only')
const root = fileURLToPath(new URL('../../../', import.meta.url))
const output = path.join(root, 'promo/rooms/generated/footage')
await fs.mkdir(output, { recursive: true })
const sourcePaths = ['src/BattleRoomsScreen.jsx','src/BattleScreen.jsx','src/RankedTeamRoster.jsx','src/SpriteImage.jsx','src/rankedClient.js','src/battleRooms.css','src/ranked.css','src/styles.css','src/screenRedesign.css','src/battleGen5.css','src/battleGimmicks.css','src/moveAnimationDirector.css','src/auth.css','src/data/battleEngine.js','src/data/trainingData.js','server/rankedHttp.js','server/rankedService.js','server/rankedBattle.js','server/battleRoomService.js','promo/rooms/capture/entry.jsx']
const sourceGameCommit = spawnSync('git',['rev-parse','HEAD'],{cwd:root,windowsHide:true,encoding:'utf8'}).stdout.trim()
const sourceGameFiles = await Promise.all(sourcePaths.map(async relativePath => { const content=await fs.readFile(path.join(root,relativePath)); return {path:relativePath,bytes:content.length,sha256:createHash('sha256').update(content).digest('hex')} }))
const sourceWorkingTreeChanged = Boolean(spawnSync('git',['status','--porcelain','--',...sourcePaths],{cwd:root,windowsHide:true,encoding:'utf8'}).stdout.trim())
const sourceGameWorkingTreeChanged = Boolean(spawnSync('git',['status','--porcelain','--',...sourcePaths.filter(file=>file.startsWith('src/')||file.startsWith('server/'))],{cwd:root,windowsHide:true,encoding:'utf8'}).stdout.trim())
const sourceCaptureWorkingTreeChanged = Boolean(spawnSync('git',['status','--porcelain','--',...sourcePaths.filter(file=>file.startsWith('promo/'))],{cwd:root,windowsHide:true,encoding:'utf8'}).stdout.trim())
const require = createRequire(new URL('../../package.json', import.meta.url))
const { chromium } = require('playwright')
const ffmpeg = require('ffmpeg-static')
const profiles = [
  {id:'aria',name:'아리아'}, {id:'leo',name:'레오'}, {id:'luna',name:'루나'}, {id:'kai',name:'카이'},
].map(profile=>({...profile,uid:`rooms-film-${profile.id}`,token:`rooms-film-token-${profile.id}`}))
const pokemon = engine.canonicalizeRankedTeam([
  [6,['flamethrower','dragonclaw','airslash','protect'],'charizardite-x'],
  [445,['dragonclaw','earthquake','rockslide','protect'],'life-orb'],
  [448,['aurasphere','flashcannon','darkpulse','protect'],'focus-sash'],
  [9,['waterpulse','icebeam','aurasphere','protect'],'leftovers'],
  [94,['shadowball','sludgebomb','thunderbolt','protect'],'black-sludge'],
  [282,['moonblast','psychic','thunderbolt','protect'],'sitrus-berry'],
].map(([speciesId,moveIds,heldItemId])=>normalizePokemon({speciesId,captureId:`rooms-film-${speciesId}`,moves:moveIds.map(id=>getMoveById(id).name),heldItemId})))
const teams = createSavedTeams(pokemon.map(mon=>mon.captureId),pokemon.map(mon=>mon.captureId))
teams[0].name='챔피언즈'
let nextSeed=7
const store=createMemoryRankedStore()
const service=createRankedService({store,engine,makeSeed:()=>nextSeed,usageEnabled:false})
const handler=createRankedHttpHandler({service,enabled:true,allowLocalOrigins:true,authenticate:async(request,token)=>{
  assert.equal(new URL(request.url).hostname,'127.0.0.1')
  const profile=profiles.find(profile=>profile.token===token)
  assert(profile,'Unknown filming identity')
  return {uid:profile.uid,name:profile.name}
}})
const shots=[],errors=[],apiAudit=[],actions=[],battles=[],players=[]
const blocked=new Set()
let frontend,browser,origin,phase='setup'
const pause=(page,seconds)=>page.waitForTimeout(seconds*1000)
const snapshot=page=>page.evaluate(()=>window.__roomsCaptureSnapshot)
async function api(profile,action,payload={}) {
  const read=action==='rooms'
  const response=await fetch(`${origin}/api/ranked${read?'?action=rooms':''}`,{method:read?'GET':'POST',headers:{Authorization:`Bearer ${profile.token}`,...(!read?{'Content-Type':'application/json'}:{})},...(!read?{body:JSON.stringify({...payload,action,requestId:randomUUID()})}:{})})
  const result=await response.json();assert.equal(response.status,200,`${action}: ${JSON.stringify(result.error)}`);return result
}
async function loaded(page) {
  await page.evaluate(()=>document.fonts.ready)
  let verified
  for(let attempt=0;attempt<5;attempt++) {
    verified=await page.evaluate(async()=>{
      const nodes=[...document.querySelectorAll('img,image')].filter(node=>{const bounds=node.getBoundingClientRect();return bounds.width>0&&bounds.height>0&&getComputedStyle(node).visibility!=='hidden'})
      const urls=[...new Set(nodes.map(node=>node.currentSrc||node.src||node.href?.baseVal).filter(value=>typeof value==='string'&&value))]
      return Promise.all(urls.map(src=>new Promise(resolve=>{const image=new Image();const timeout=setTimeout(()=>resolve({src,loaded:false}),12000);image.onload=()=>{clearTimeout(timeout);resolve({src,loaded:image.naturalWidth>0})};image.onerror=()=>{clearTimeout(timeout);resolve({src,loaded:false})};image.src=src})))
    })
    if(verified.every(image=>image.loaded)) break
    await pause(page,1)
  }
  assert(verified.every(image=>image.loaded),`Visible images missing: ${JSON.stringify(verified.filter(image=>!image.loaded))}`)
  await pause(page,.4)
  return verified
}
async function click(player,locator) {
  if(await player.page.locator('.ranked-pokemon-tooltip').isVisible()){await player.page.mouse.move(1910,1070);await pause(player.page,.2)}
  await locator.click();await player.page.mouse.move(1910,1070)
}
async function shot(player,id,duration,action=async()=>{}) {
  phase=`capture ${id}`
  const page=player.page
  const visibleImages=await loaded(page)
  await page.mouse.move(1910,1070)
  await page.evaluate(()=>{const marker=document.createElement('div');marker.id='capture-marker';marker.style.cssText='position:fixed;inset:0;background:rgb(0,255,0);z-index:2147483647';document.body.append(marker)})
  await pause(page,.65)
  await page.evaluate(()=>document.getElementById('capture-marker').remove())
  const start=Date.now()
  const item={id,duration,viewport:{width:1920,height:1080},image:path.join(output,`${id}.png`),wallStart:start,visibleImages,recordingIdentity:player.id}
  shots.push(item);player.shots.push(item)
  await page.screenshot({path:item.image})
  await action()
  await pause(page,Math.max(0,duration+1.1-(Date.now()-start)/1000))
  item.recordedDuration=(Date.now()-start)/1000
  item.visibleText=await page.locator('body').innerText()
  item.visibleImagesEnd=await loaded(page)
  await page.screenshot({path:path.join(output,`${id}-end.png`)})
  console.log('SHOT',id,item.recordedDuration.toFixed(1))
}
async function ready(player) {
  await player.page.locator('.battle-game-screen').waitFor()
  await player.page.waitForFunction(()=>window.__captureBattle&&!window.__captureBattle.isTurnAnimating&&!window.__captureBattle.introVisible)
  await loaded(player.page)
}
async function selectUi(player,indices) {
  const buttons=player.page.locator('.rooms-selection button.ranked-pokemon-card')
  await buttons.first().waitFor()
  for(const index of indices) await click(player,buttons.nth(index))
  await click(player,player.page.getByRole('button',{name:'선출 확정',exact:true}))
}
async function selectOther(profile,indices) {
  const value=await api(profile,'rooms');assert.equal(value.match.phase,'select')
  return api(profile,'select',{matchId:value.match.id,revision:value.match.revision,selection:indices})
}
async function playUiMove(player,moveIndex,gimmick=null,targetSlot=0) {
  const page=player.page
  if(await page.locator('.battle-command-buttons .fight:visible').count()) await click(player,page.locator('.battle-command-buttons .fight'))
  if(gimmick) await click(player,page.locator(`.battle-gimmick-selector button.mechanic-${gimmick}`))
  await click(player,page.locator('.battle-move-button').nth(moveIndex))
  const targets=page.locator('.battle-target-grid button:not(:disabled)')
  if(await targets.count()) await click(player,targets.filter({hasText:`상대 ${String(targetSlot+1).padStart(2,'0')}`}).first())
}
async function opponentCommands(profile) {
  const value=await api(profile,'rooms');assert.equal(value.match.phase,'battle')
  const entries=value.match.state.player.activeIndexes.map((index,actorSlot)=>({type:'move',actorSlot,moveIndex:0,targetSideId:'opponent',targetSlot:actorSlot}))
  return api(profile,'submit',{matchId:value.match.id,revision:value.match.revision,actions:entries})
}
async function refresh(player) {
  await player.page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')))
  await pause(player.page,.25)
}
async function closeMatchResult(player) {
  const button=player.page.locator('.rooms-match-result > button')
  if(await button.isVisible()) await click(player,button)
}
async function finishCompetitionSetup() {
  for(let pass=0;pass<10;pass++) {
    const db=await store.inspect()
    if(!Object.keys(db.collections.battleRooms??{}).length)break
    for(const match of Object.values(db.collections.matches??{}).filter(match=>match.roomId&&match.phase!=='finished')) {
      const profile=profiles.find(profile=>profile.uid===match.players[0].uid)
      await api(profile,'forfeit',{matchId:match.id})
      actions.push({type:'setup-forfeit',matchId:match.id,uid:profile.uid,note:'Real voluntary forfeit used only to prepare the next filming session.'})
    }
  }
}
async function openPlayer(profile) {
  const context=await browser.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:1,serviceWorkers:'block',recordVideo:{dir:output,size:{width:1920,height:1080}}})
  await context.addInitScript(fixture=>{window.__roomsCaptureFixture=fixture},{user:{uid:profile.uid,displayName:profile.name},token:profile.token,pokemon,teams})
  await context.route('**/*',async route=>{
    const request=route.request(),target=new URL(request.url())
    if(target.origin!==origin) {
      if(request.method()==='GET'&&['raw.githubusercontent.com','play.pokemonshowdown.com'].includes(target.hostname)) return route.continue()
      blocked.add(`${request.method()} ${target.origin}`);return route.abort('blockedbyclient')
    }
    if(target.pathname==='/src/BattleScreen.jsx') {
      const response=await route.fetch();let body=await response.text();assert(body.includes('const currentLogEntry ='))
      body=body.replace('const currentLogEntry =','window.__captureBattle={battle,menu,commandSlot,isTurnAnimating,introVisible}; const currentLogEntry =')
      return route.fulfill({response,body})
    }
    return route.continue()
  })
  const page=await context.newPage();page.setDefaultTimeout(45000)
  page.on('pageerror',error=>{errors.push(error.message);console.error('BROWSER',error.message)})
  const player={...profile,page,context,shots:[]};players.push(player)
  await page.goto(`${origin}/rooms-capture.html`)
  await page.waitForFunction(()=>window.__roomsCaptureSnapshot?.rooms)
  await page.evaluate(async urls=>{window.__spriteWarmups=await Promise.all(urls.map(src=>new Promise(resolve=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>resolve(null);image.src=src})))},[...pokemon.flatMap(mon=>[mon.icon,mon.spriteFront,mon.spriteBack]),'https://play.pokemonshowdown.com/sprites/gen5ani/charizard-megax.gif','https://play.pokemonshowdown.com/sprites/gen5ani-back/charizard-megax.gif'])
  await loaded(page)
  return player
}

try {
  frontend=await createServer({root,cacheDir:path.join(output,'vite'),mode:'rooms-capture',logLevel:'error',plugins:[{name:'rooms-authenticated-local-capture',enforce:'pre',
    resolveId(source){if(/\/auth\/firebaseClient(?:\.js)?$/.test(source)||source==='./firebaseClient')return '\0rooms-capture-auth'},
    load(id){if(id==='\0rooms-capture-auth')return 'export const firebaseAuth=null;export const firebaseDb=null;export const isFirebaseConfigured=false;export const missingFirebaseEnvironmentVariables=[];'},
    configureServer(vite){vite.middlewares.use(async(request,response,next)=>{
      const url=new URL(request.url,'http://127.0.0.1')
      if(url.pathname==='/rooms-capture.html'){response.setHeader('Content-Type','text/html');response.end(await vite.transformIndexHtml('/rooms-capture.html','<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body><div id="root"></div><script type="module" src="/promo/rooms/capture/entry.jsx"></script></body></html>'));return}
      if(url.pathname!=='/api/ranked'){next();return}
      const chunks=[];for await(const chunk of request)chunks.push(chunk)
      const body=Buffer.concat(chunks).toString('utf8')
      const result=await handler(new Request(`${origin}${request.url}`,{method:request.method,headers:request.headers,...(!['GET','HEAD'].includes(request.method)?{body}:{})}))
      const text=await result.text();const data=JSON.parse(text);let action=url.searchParams.get('action')||'status';if(body)action=JSON.parse(body).action
      apiAudit.push({action,status:result.status,method:request.method,roomId:data.room?.id,roomPhase:data.room?.phase,matchId:data.match?.id,phase:data.match?.phase,turn:data.match?.state?.turn,roomResult:data.roomResult?.reason})
      response.writeHead(result.status,Object.fromEntries(result.headers));response.end(text)
    })},
  }],server:{host:'127.0.0.1',port:5289,strictPort:true,hmr:false}})
  await frontend.listen();origin=`http://127.0.0.1:${frontend.httpServer.address().port}`
  browser=await chromium.launch({executablePath:await resolveChromiumExecutable(chromium),headless:true,args:['--autoplay-policy=no-user-gesture-required','--disable-background-timer-throttling','--disable-renderer-backgrounding']})
  const aria=await openPlayer(profiles[0]);const leo=await openPlayer(profiles[1]);console.log('READY',origin)
  await click(aria,aria.page.getByRole('button',{name:'방 만들기',exact:true}))
  const createDialog=aria.page.getByRole('dialog',{name:'방 만들기',exact:true})
  await createDialog.getByLabel('방 이름',{exact:true}).fill('챔피언즈 프렌드 리그')
  await shot(aria,'create',12,async()=>{
    await pause(aria.page,4)
    await click(aria,createDialog.getByRole('button',{name:'리그전',exact:true}));await pause(aria.page,1)
    await click(aria,createDialog.getByRole('button',{name:'더블배틀',exact:true}));await pause(aria.page,1)
    await createDialog.locator('input[type="password"]').fill('2026');await aria.page.mouse.move(1910,1070)
  })
  await click(aria,createDialog.getByRole('button',{name:'방 만들기',exact:true}))
  await aria.page.waitForFunction(()=>window.__roomsCaptureSnapshot?.room?.members?.length===1)
  const leagueId=(await snapshot(aria.page)).room.id
  await api(profiles[2],'roomJoin',{roomId:leagueId,password:'2026',team:pokemon})
  await api(profiles[3],'roomJoin',{roomId:leagueId,password:'2026',team:pokemon})
  await click(leo,leo.page.getByRole('button',{name:'방 목록 새로고침',exact:true}))
  await click(leo,leo.page.getByRole('button',{name:'참가하기',exact:true}))
  const joinDialog=leo.page.getByRole('dialog',{name:'비밀번호 입력',exact:true})
  await shot(leo,'friends',10,async()=>{
    await pause(leo.page,4);await joinDialog.getByLabel('방 비밀번호',{exact:true}).fill('2026');await pause(leo.page,.8)
    await click(leo,joinDialog.getByRole('button',{name:'참가하기',exact:true}))
    await leo.page.waitForFunction(()=>window.__roomsCaptureSnapshot?.room?.members?.length===4)
  })
  await refresh(aria)
  await click(aria,aria.page.getByRole('button',{name:'대회 시작',exact:true}))
  await aria.page.locator('.rooms-selection').waitFor()
  await shot(aria,'selection',10,async()=>{
    await pause(aria.page,4)
    for(const index of [1,0,2,3]){await click(aria,aria.page.locator('.rooms-selection button.ranked-pokemon-card').nth(index));await pause(aria.page,.7)}
  })
  const doubleMatch=(await snapshot(aria.page)).match
  const doubleServer=(await store.inspect()).collections.matches[doubleMatch.id]
  const doubleOpponent=profiles.find(profile=>profile.uid===doubleServer.players.find(member=>member.uid!==aria.uid).uid)
  await selectOther(doubleOpponent,[3,2,4,5])
  await click(aria,aria.page.getByRole('button',{name:'선출 확정',exact:true}));await ready(aria)
  const doubleBefore=(await snapshot(aria.page)).match.state
  await opponentCommands(doubleOpponent)
  await shot(aria,'double',12,async()=>{
    await pause(aria.page,4)
    await playUiMove(aria,0,'dynamax',0);await playUiMove(aria,0,null,1)
    actions.push({type:'real-turn',format:'double',matchId:doubleMatch.id,gimmick:'dynamax',moves:['dragonclaw','flamethrower'],firstActionAfterSeconds:4})
    await aria.page.waitForFunction(()=>window.__roomsCaptureSnapshot?.match?.state?.turn>=2)
  })
  await ready(aria)
  const doubleAfter=(await snapshot(aria.page)).match.state
  assert(doubleAfter.opponent.team.some((mon,index)=>mon.hp<doubleBefore.opponent.team[index].hp))
  battles.push({format:'double',matchId:doubleMatch.id,before:doubleBefore,after:doubleAfter})
  await api(aria,'forfeit',{matchId:doubleMatch.id});actions.push({type:'setup-forfeit',matchId:doubleMatch.id,uid:aria.uid,note:'Actual forfeit creates a real first-round result for the league board; no invented victory.'})
  await aria.page.locator('.rooms-match-result').waitFor();await closeMatchResult(aria)
  await aria.page.locator('.rooms-progress-panel').waitFor()
  await shot(aria,'league',9,async()=>{await pause(aria.page,4);await aria.page.locator('.rooms-standings').scrollIntoViewIfNeeded();await aria.page.mouse.move(1910,1070)})
  await finishCompetitionSetup();await refresh(aria);await closeMatchResult(aria)
  await aria.page.locator('.rooms-final').waitFor();await click(aria,aria.page.getByRole('button',{name:'방 목록으로',exact:true}))
  // Deterministic genuine tournament shuffle: choose a server seed that gives
  // the filmed host the valid third-player bye. No bracket or result injection.
  const tournamentProfiles=profiles.slice(0,3)
  for(nextSeed=1;nextSeed<1000;nextSeed++){
    const ordered=[...tournamentProfiles].sort((a,b)=>createHash('sha256').update(`${nextSeed}:${a.uid}`).digest('hex').slice(0,40).localeCompare(createHash('sha256').update(`${nextSeed}:${b.uid}`).digest('hex').slice(0,40)))
    if(ordered[2].uid===aria.uid)break
  }
  const created=await api(aria,'roomCreate',{title:'챔피언즈 프렌드 컵',mode:'tournament',format:'single',password:'',team:pokemon})
  for(const profile of tournamentProfiles.slice(1))await api(profile,'roomJoin',{roomId:created.room.id,team:pokemon})
  await api(aria,'roomStart',{roomId:created.room.id});await refresh(aria)
  await aria.page.locator('.rooms-match.phase-bye').waitFor()
  await shot(aria,'tournament',9,async()=>{await pause(aria.page,4);await aria.page.locator('.rooms-match.phase-bye').hover();await pause(aria.page,1.8);await aria.page.mouse.move(1910,1070)})
  const initialTournament=await api(aria,'rooms');const semifinal=initialTournament.room.matches.find(match=>match.phase==='select')
  const semifinalLoser=profiles.find(profile=>profile.uid===semifinal.players[0].uid)
  await api(semifinalLoser,'forfeit',{matchId:semifinal.id});actions.push({type:'setup-forfeit',matchId:semifinal.id,uid:semifinalLoser.uid,note:'Actual semifinal forfeit advances the other entrant to face the bye holder.'})
  await aria.page.locator('.rooms-selection').waitFor();const singleMatch=(await snapshot(aria.page)).match
  const singleServer=(await store.inspect()).collections.matches[singleMatch.id]
  const singleOpponent=profiles.find(profile=>profile.uid===singleServer.players.find(member=>member.uid!==aria.uid).uid)
  await selectOther(singleOpponent,[3,4,5]);await selectUi(aria,[0,1,2]);await ready(aria)
  const singleBefore=(await snapshot(aria.page)).match.state
  await opponentCommands(singleOpponent)
  await shot(aria,'single',12,async()=>{
    await pause(aria.page,4);await playUiMove(aria,1,'mega',0)
    actions.push({type:'real-turn',format:'single',matchId:singleMatch.id,gimmick:'mega',moves:['dragonclaw'],firstActionAfterSeconds:4})
    await aria.page.waitForFunction(()=>window.__roomsCaptureSnapshot?.match?.state?.turn>=2)
  })
  await ready(aria)
  const singleAfter=(await snapshot(aria.page)).match.state
  assert(singleAfter.opponent.team.some((mon,index)=>mon.hp<singleBefore.opponent.team[index].hp))
  battles.push({format:'single',matchId:singleMatch.id,before:singleBefore,after:singleAfter})
  assert.equal(shots.length,7);assert.equal(errors.length,0);assert.equal(blocked.size,0)
} catch(error) {
  errors.push({phase,message:error.stack});console.error('FAIL',phase,error.stack);process.exitCode=1
  for(const player of players)await player.page.screenshot({path:path.join(output,`failure-${player.id}.png`)}).catch(()=>{})
} finally {
  await fs.writeFile(path.join(output,'local-api-state.json'),JSON.stringify(await store.inspect(),null,2))
  for(const player of players){
    const video=player.page.video();await player.context.close();const sourceVideo=path.join(output,`session-${player.id}.webm`);await video.saveAs(sourceVideo);await video.delete()
    const raw=spawnSync(ffmpeg,['-hide_banner','-loglevel','error','-i',sourceVideo,'-vf','fps=25,scale=4:4:flags=neighbor,format=rgb24','-f','rawvideo','pipe:1'],{windowsHide:true,maxBuffer:16*1024*1024});assert.equal(raw.status,0,raw.stderr.toString())
    const ends=[];let wasGreen=false
    for(let frame=0;frame<raw.stdout.length;frame+=48){let pixels=0;for(let pixel=frame;pixel<frame+48;pixel+=3)if(raw.stdout[pixel]<30&&raw.stdout[pixel+1]>220&&raw.stdout[pixel+2]<30)pixels++;const green=pixels>=15;if(wasGreen&&!green)ends.push(frame/48/25);wasGreen=green}
    for(const[index,item]of player.shots.entries()){
      item.sourceVideo=sourceVideo;item.cleanStartSeconds=ends[index]+.08;item.usableDuration=item.recordedDuration-.12;item.recommendedTrimOffset=0
      if(!Number.isFinite(item.cleanStartSeconds)){errors.push(`Missing marker for ${item.id}`);continue}
      item.video=path.join(output,`${item.id}.mp4`)
      const cut=spawnSync(ffmpeg,['-hide_banner','-loglevel','error','-y','-ss',String(item.cleanStartSeconds),'-i',sourceVideo,'-t',String(item.usableDuration),'-an','-r','30','-c:v','libx264','-preset','fast','-crf','17','-pix_fmt','yuv420p','-movflags','+faststart',item.video],{windowsHide:true,maxBuffer:1024*1024});assert.equal(cut.status,0,cut.stderr.toString())
    }
  }
  const changed=[];for(const item of sourceGameFiles){const content=await fs.readFile(path.join(root,item.path));if(createHash('sha256').update(content).digest('hex')!==item.sha256)changed.push(item.path)}
  if(changed.length){errors.push(`Game source changed during capture: ${changed.join(', ')}`);process.exitCode=1}
  await fs.writeFile(path.join(output,'manifest.json'),JSON.stringify({shots,errors,blocked:[...blocked],apiAudit,actions,battles,sourceGameCommit,sourceWorkingTreeChanged,sourceGameWorkingTreeChanged,sourceCaptureWorkingTreeChanged,sourceGameFiles,sourceGameFilesUnchangedDuringCapture:changed.length===0,
    imageVerification:{allVisibleImagesLoaded:shots.every(item=>[...item.visibleImages,...(item.visibleImagesEnd??[])].every(image=>image.loaded)),includesSvgSprites:true},
    provenance:'Actual shipped BattleRoomsScreen, BattleScreen, rankedHttp, rankedService and battle engine over authenticated loopback HTTP backed by an isolated memory store. Legal catalog-derived six-Pokemon loadouts; genuine three-entrant tournament bye and four-entrant round-robin schedule. Real damaging moves with Mega Evolution and Dynamax; setup forfeits are genuine API actions recorded in actions, never simulated HP/results. Static sprite CDNs allowed and all visible img/SVG image resources verified. Read-only observation hooks only. No production account/database or game source edits.'},null,2))
  await browser?.close();await frontend?.close();await store.close()
}
