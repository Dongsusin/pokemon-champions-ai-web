import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { resolveChromiumExecutable } from '../../scripts/browserRuntime.mjs'

const root = fileURLToPath(new URL('../../../',import.meta.url))
const output = path.join(root,'promo/boss/generated/footage')
const require = createRequire(new URL('../../package.json',import.meta.url))
const { chromium } = require('playwright')
const ffmpeg = require('ffmpeg-static')
const args = process.argv.slice(2)
const only = args.find(a=>a.startsWith('--ids='))?.slice(6).split(',')
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
await fs.mkdir(output,{recursive:true})
const sourcePaths = ['src/RaidScreen.jsx','src/main.jsx','src/fixedGameViewport.js','src/fixedGameViewport.css','src/gameTextScale.js','src/BattleScreen.jsx','src/RankedTeamRoster.jsx','src/data/bossChallenge.js','src/data/bossChallengeLoadouts.js','src/data/battleEngine.js','src/data/raidPolicy.js','src/bossChallenge.css','src/styles.css','src/battleGen5.css','src/battleGimmicks.css','src/moveAnimationDirector.css','promo/boss/capture/entry.jsx','promo/boss/capture/capture.mjs']
const sourceGameFiles = await Promise.all(sourcePaths.map(async name=>{const b=await fs.readFile(path.join(root,name));return{path:name,bytes:b.length,sha256:hash(b)}}))
const sourceGameCommit = spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',windowsHide:true}).stdout.trim()
const sourceWorkingTreeChanged = !!spawnSync('git',['status','--porcelain','--',...sourcePaths],{cwd:root,encoding:'utf8',windowsHide:true}).stdout.trim()
const gameEntry = await fs.readFile(path.join(root,'src/gameEntry.jsx'),'utf8')
const styles = [...gameEntry.matchAll(/import ['"]\.\/([^'"]+\.css)['"]/g)].map(m=>`import '/src/${m[1]}';`).join('\n')
const previous = only ? JSON.parse(await fs.readFile(path.join(output,'manifest.json'),'utf8').catch(()=>'{}')) : {}
const shots=(previous.shots??[]).filter(s=>!only.includes(s.id)),errors=[],actions=(previous.actions??[]).filter(a=>!only?.includes(a.phase?.replace('capture ',''))),staging=(previous.staging??[]).filter(s=>!(only?.includes('lugia')&&s.bossId==='lugia'))
let server,browser,page,frame,context,phase='setup'
const pause = s => page.waitForTimeout(s*1000)
async function loaded() {
  await frame.evaluate(()=>document.fonts.ready)
  await frame.evaluate(()=>document.querySelectorAll('img').forEach(i=>i.loading='eager'))
  await frame.waitForFunction(()=>[...document.images].filter(i=>i.getBoundingClientRect().width>0).every(i=>i.complete&&i.naturalWidth>0),null,{timeout:60000})
  await pause(.2)
  return frame.evaluate(()=>[...document.images].filter(i=>i.getBoundingClientRect().width>0).map(i=>({src:i.currentSrc,loaded:i.complete&&i.naturalWidth>0})))
}
async function shot(id,duration,action) {
  if(only&&!only.includes(id))return
  phase='capture '+id
  const visibleImages=await loaded()
  await page.mouse.move(1910,1070)
  const dir=path.join(output,id+'-frames');await fs.mkdir(dir,{recursive:true})
  const cdp=await context.newCDPSession(page),frames=[],writes=[]
  cdp.on('Page.screencastFrame',event=>{
    const index=frames.length,file=path.join(dir,`${String(index).padStart(5,'0')}.jpg`)
    frames.push({file,timestamp:event.metadata.timestamp})
    writes.push(fs.writeFile(file,Buffer.from(event.data,'base64')))
    cdp.send('Page.screencastFrameAck',{sessionId:event.sessionId}).catch(()=>{})
  })
  const start=Date.now()
  await cdp.send('Page.startScreencast',{format:'jpeg',quality:85,maxWidth:1920,maxHeight:1080,everyNthFrame:1})
  const item={id,duration,viewport:{width:1920,height:1080},gameViewport:{width:1600,height:900,textScale:1.5},visibleImages,image:path.join(output,id+'.png'),video:path.join(output,id+'.mp4'),recommendedTrimOffset:.2,usableDuration:duration+1,errors:[]}
  await page.screenshot({path:item.image})
  const sample=(async()=>{await pause(4);await page.screenshot({path:path.join(output,id+'-4s.png')})})()
  await action?.()
  await pause(Math.max(0,duration+1-(Date.now()-start)/1000))
  await sample
  await cdp.send('Page.stopScreencast');await Promise.all(writes);await cdp.detach()
  item.wallDuration=(Date.now()-start)/1000
  item.visibleText=await frame.locator('body').innerText()
  item.recording={method:'Chromium CDP Page.startScreencast, every rendered frame, timestamp-preserving CFR conversion',capturedFrames:frames.length,firstTimestamp:frames[0]?.timestamp,lastTimestamp:frames.at(-1)?.timestamp,averageRenderedFps:frames.length/(frames.at(-1).timestamp-frames[0].timestamp),outputFps:30}
  await page.screenshot({path:path.join(output,id+'-end.png')})
  assert(frames.length>20,'Not enough captured frames')
  const concat=frames.map((f,i)=>`file '${f.file.replaceAll('\\','/').replaceAll("'","'\\''")}'\nduration ${Math.max(.001,(frames[i+1]?.timestamp??f.timestamp+1/30)-f.timestamp).toFixed(6)}`).join('\n')+`\nfile '${frames.at(-1).file.replaceAll('\\','/')}'\n`
  const list=path.join(dir,'frames.txt');await fs.writeFile(list,concat)
  const cut=spawnSync(ffmpeg,['-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',list,'-vf',`fps=30,tpad=stop_mode=clone:stop_duration=1`,'-t',String(item.usableDuration),'-an','-c:v','libx264','-preset','fast','-crf','17','-pix_fmt','yuv420p','-threads','2','-movflags','+faststart',item.video],{windowsHide:true,maxBuffer:1024*1024})
  assert.equal(cut.status,0,cut.stderr.toString())
  shots.push(item)
  console.log('SHOT',id,JSON.stringify(item.recording))
  await saveManifest()
}
async function dismiss() {
  const intro=frame.getByRole('button',{name:'배틀 개시',exact:true});if(await intro.count()){await intro.click();await pause(.3)}
  const dialogue=frame.locator('.battle-trainer-dialogue-box');if(await dialogue.count()){await dialogue.click();await pause(.3)}
}
async function start(bossId,round) {
  phase=`stage ${bossId} round ${round}`
  await page.goto(base+'/capture.html',{waitUntil:'networkidle'});frame=await(await page.locator('iframe[data-game-frame]').elementHandle()).contentFrame()
  await frame.locator('.boss-selection-workspace').waitFor();await loaded()
  if(round===1){await frame.locator('.boss-challenge-choices > button').nth({mewtwo:0,hooh:1,lugia:2}[bossId]).click();await frame.locator('.boss-start-footer button').click()}
  else {await frame.evaluate(async({bossId,round})=>{
    let party=window.__captureParty
    if(round===3){const{createBossOpponent}=await import('/src/data/bossChallenge.js');party=[createBossOpponent({speciesId:442,moves:['darkpulse','taunt','willowisp','protect'],heldItemId:'focus-sash'},'boss-film-spiritomb'),...party.slice(1)]}
    window.__captureStartRound(party,round,bossId)
  },{bossId,round});staging.push({bossId,round,method:'Call actual RaidScreen.startRound with a normal legal six-Pokemon party. Round starting point staged for filming; earlier victories and carryover HP are not claimed.',alternateLead:round===3?'Level-50 Spiritomb with legal Dark Pulse, Taunt, Will-O-Wisp, Protect and Focus Sash':null})}
  await frame.locator('.battle-game-screen').waitFor();await loaded();await dismiss()
  await frame.waitForFunction(()=>window.__captureBattle&&!window.__captureBattle.introVisible&&!window.__captureBattle.isTurnAnimating)
  await pause(.2)
}
async function stageMechanic(bossId){
  const details=await frame.evaluate(async bossId=>{
    const{playBattleTurnWithActions}=await import('/src/data/battleEngine.js')
    let battle=structuredClone(window.__captureBattle.battle)
    const stagedGates=bossId==='mewtwo'?[75,50]:[75]
    for(const gate of stagedGates){
      battle.opponent.team[0].hp=Math.floor(battle.opponent.team[0].maxHp*gate/100)+1
      battle=playBattleTurnWithActions(battle,[{type:'move',moveIndex:0,actorSlot:0,targetSlot:0}],[],()=>.5)
    }
    battle=playBattleTurnWithActions(battle,[{type:'move',moveIndex:1,actorSlot:0,targetSlot:0}],[],()=>.5)
    const nextGate=bossId==='mewtwo'?25:50
    battle.opponent.team[0].hp=Math.floor(battle.opponent.team[0].maxHp*nextGate/100)+1
    window.__setCaptureBattle(battle)
    return {bossId,stagedGates,nextGate,turn:battle.turn,party:battle.player.team.map(p=>({name:p.name,hp:p.hp,maxHp:p.maxHp})),boss:{name:battle.opponent.team[0].name,hp:battle.opponent.team[0].hp,maxHp:battle.opponent.team[0].maxHp}}
  },bossId)
  staging.push({...details,method:'Transparent filming fixture: boss HP placed one point above earlier gates; real battle engine legal Dark Pulse (with no opponent action offcamera) establishes prior forms, then legal Taunt establishes status. Next threshold HP staged one point above gate. The recorded turn uses ordinary game UI and normal opponent AI; no fabricated win or reward.'})
  await loaded();await pause(.5)
}
async function command(moveIndex=0) {
  await dismiss()
  const state=await frame.evaluate(()=>window.__captureBattle)
  if(!state||state.isTurnAnimating||state.battle.winner)return false
  const fight=frame.locator('.battle-command-buttons .fight:not(:disabled)')
  if(await fight.count())await fight.click()
  const moves=frame.locator('.battle-move-button:not(:disabled)')
  if(!await moves.count())return false
  const index=Math.min(moveIndex,await moves.count()-1)
  actions.push({phase,turn:state.battle.turn,slot:state.commandSlot,moveIndex:index,time:Date.now()})
  await moves.nth(index).click()
  const targets=frame.locator('.battle-target-grid button:not(:disabled)');if(await targets.count())await targets.first().click()
  await page.mouse.move(1910,1070)
  return true
}
async function combat(seconds,moveIndex=0){const end=Date.now()+seconds*1000;while(Date.now()<end){await command(moveIndex);await pause(.3)}}
async function oneTurn(seconds,moveIndex=0){const turn=await frame.evaluate(()=>window.__captureBattle.battle.turn),end=Date.now()+seconds*1000;while(Date.now()<end){if(await frame.evaluate(turn=>window.__captureBattle.battle.turn>turn,turn))break;await command(moveIndex);await pause(.3)}}
async function saveManifest(){await fs.writeFile(path.join(output,'manifest.json'),JSON.stringify({shots,errors,actions,staging,sourceGameCommit,sourceWorkingTreeChanged,sourceGameFiles,sourceGameFilesUnchangedDuringCapture:await Promise.all(sourceGameFiles.map(async item=>hash(await fs.readFile(path.join(root,item.path)))===item.sha256)).then(values=>values.every(Boolean)),imageVerification:{allVisibleImagesLoaded:shots.every(s=>s.visibleImages.every(i=>i.loaded)),countsRecorded:true},provenance:'Actual shipped RaidScreen, BattleScreen and combat engine, with local legal level-50 party. No cloud account, production write, fabricated victory or reward. Later rounds are isolated staged starting points, disclosed in staging. UI commands and their damage/animations run through the actual engine. CDP timestamps preserve actual motion before encoding to 1920x1080 30 fps.'},null,2))}
let base
try{
  server=await createServer({root,configFile:false,logLevel:'error',cacheDir:'promo/boss/generated/.vite-capture',plugins:[react(),{name:'boss-capture',enforce:'pre',resolveId(id){if(id==='./gameEntry.jsx'||id.replaceAll('\\','/').endsWith('/src/gameEntry.jsx'))return path.join(root,'promo/boss/capture/entry.jsx');if(id==='virtual:boss-capture-styles')return'\0boss-capture-styles'},load(id){if(id==='\0boss-capture-styles')return styles},transform(code,id){if(id.endsWith('/src/RaidScreen.jsx'))return code.replace('  const active = run?.phase','  window.__bossRun=()=>run;window.__captureStartRound=startRound;\n  const active = run?.phase');if(id.endsWith('/src/BattleScreen.jsx'))return code.replace('  const currentLogEntry =','  window.__captureBattle={battle,menu,commandSlot,isTurnAnimating,introVisible};window.__setCaptureBattle=setBattle;\n  const currentLogEntry =')}}],server:{host:'127.0.0.1',port:5299,strictPort:true,hmr:false}})
  await server.listen();base='http://127.0.0.1:5299'
  const html=await server.transformIndexHtml('/capture.html','<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>')
  browser=await chromium.launch({executablePath:await resolveChromiumExecutable(chromium),headless:true,args:['--autoplay-policy=no-user-gesture-required','--disable-background-timer-throttling','--disable-renderer-backgrounding']})
  context=await browser.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:1,serviceWorkers:'block'})
  await context.addInitScript(()=>localStorage.setItem('champions-settings-v1',JSON.stringify({game:{textScale:1.5},audio:{enabled:false}})))
  await context.route('**/capture.html',route=>route.fulfill({contentType:'text/html',body:html}))
  page=await context.newPage();page.on('pageerror',error=>{errors.push({phase,message:error.message});console.error('BROWSER',error.message)})
  await page.goto(base+'/capture.html',{waitUntil:'networkidle'});frame=await(await page.locator('iframe[data-game-frame]').elementHandle()).contentFrame();await frame.locator('.boss-selection-workspace').waitFor();await loaded()
  await page.screenshot({path:path.join(output,'setup.png')});console.log('SETUP_READY',path.join(output,'setup.png'))
  await shot('selection',10.4,async()=>{await pause(2);await frame.locator('.boss-challenge-choices > button').nth(1).click();await pause(3);await frame.locator('.boss-challenge-choices > button').nth(2).click();await pause(3);await frame.locator('.boss-challenge-choices > button').nth(0).click()})
  await shot('team',9.4,async()=>{await pause(1);await frame.locator('.boss-team-switcher button').nth(1).click();await pause(2);await frame.locator('.boss-team-switcher button').nth(0).click();await pause(1);await frame.getByRole('button',{name:'마기라스 정보 보기',exact:true}).hover();await pause(3);await page.mouse.move(1910,1070)})
  if(!only||only.includes('mewtwo')){await start('mewtwo',1);await shot('mewtwo',13.4,async()=>{await pause(.8);await combat(11)})}
  if(!only||only.includes('giovanni')){await start('mewtwo',2);await shot('giovanni',10.4,async()=>{await pause(1);await combat(8)})}
  if(!only||only.includes('finale')){await start('mewtwo',3);await stageMechanic('mewtwo');await shot('finale',12.4,async()=>{await pause(.5);await oneTurn(10)})}
  if(!only||only.includes('hooh')){await start('hooh',3);await stageMechanic('hooh');await shot('hooh',10.4,async()=>{await pause(.5);await oneTurn(8)})}
  if(!only||only.includes('lugia')){await start('lugia',3);await shot('lugia',10.4,async()=>{await pause(.5);await command(0)})}
  assert.equal(errors.length,0,JSON.stringify(errors))
}catch(error){errors.push({phase,message:error.stack});console.error('FAIL',phase,error.stack);await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});await fs.writeFile(path.join(output,'failure.txt'),await page?.locator('body').innerText().catch(()=>'')??'');process.exitCode=1}
finally{await saveManifest();await browser?.close();await server?.close()}
