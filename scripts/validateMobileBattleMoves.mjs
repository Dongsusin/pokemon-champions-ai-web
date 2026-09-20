import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import {createRequire} from 'node:module'
import {createServer} from 'vite'
import {createBattle} from '../src/data/battleEngine.js'
import {normalizePokemon} from '../src/data/trainingData.js'
import {createFactoryRun,selectFactoryRentals,selectFactoryLead,beginFactoryBattle} from '../src/data/battleFactory.js'
const {chromium,webkit}=createRequire(new URL('../promo/package.json',import.meta.url))('playwright')
let run=createFactoryRun({seed:34});run=selectFactoryRentals(run,run.offers.slice(0,3).map(p=>p.captureId));run=beginFactoryBattle(selectFactoryLead(run,run.party[0].captureId));
const battle=createBattle({playerPokemon:run.party,opponent:{name:'테스트'},opponentTeam:run.opponentTeam,rules:run.rules});run.battleState=battle
const source=await fs.readFile('src/gameEntry.jsx','utf8');const styles=[...source.matchAll(/^import ['"](.+\.css)['"]/gm)].map(m=>`import '/src/${m[1].replace('./','')}';`).join('\n')
const entry=`import'/src/mobileViewport.js';import React from'react';import{createRoot}from'react-dom/client';import Battle from'/src/BattleScreen.jsx';import Factory from'/src/BattleFactoryScreen.jsx';${styles}
const battle=${JSON.stringify(battle)},seed=${JSON.stringify(run)};function App(){const[run,setRun]=React.useState(seed);return <div className={"app-shell battle-view"+(location.search.includes("factory")?" factory-view":"")}><header className="topbar">게임 상단바</header>{location.search.includes('factory')?<Factory run={run} onRunChange={setRun} user={{uid:'mobile-move-test',isLocalGuest:true}} soundEnabled={false} gameSettings={{attackAnimation:'skip',hpBarSpeed:'instant'}}/>:<Battle initialBattle={battle} skipIntro playerPokemon={seed.party} rules={seed.rules} opponent={{name:'テスト'}} opponentTeam={seed.opponentTeam} soundEnabled={false} gameSettings={{attackAnimation:'skip',hpBarSpeed:'instant'}}/>}</div>};createRoot(document.getElementById('root')).render(<App/>);`
const port=process.argv.includes('--webkit')?5231:5232;
const server=await createServer({logLevel:'error',plugins:[{name:'mobile-move-fixture',enforce:'pre',resolveId(id){if(id==='./gameEntry.jsx'||id.endsWith('/src/gameEntry.jsx'))return '/src/mobile-move-test.jsx';if(id.includes('firebaseClient'))return '\0auth'},load(id){if(id==='/src/mobile-move-test.jsx')return entry;if(id==='\0auth')return 'export const firebaseAuth=null;export const firebaseDb=null;export const isFirebaseConfigured=false;export const missingFirebaseEnvironmentVariables=[];'}}],server:{host:'127.0.0.1',port,strictPort:true}});await server.listen();let browser
try{browser=await (process.argv.includes('--webkit')?webkit.launch({headless:true}):chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'}));
for(const viewport of [{width:844,height:390},{width:667,height:375},{width:1024,height:768},{width:568,height:260},{width:1600,height:900}])for(const mode of ['ai','factory']){
 const page=await browser.newPage({viewport,isMobile:viewport.width<1280,hasTouch:viewport.width<1280});page.on('pageerror',e=>console.error(e.message));await page.goto('http://127.0.0.1:'+port+'/?'+mode,{waitUntil:'domcontentloaded'});const iframe=await page.locator('iframe[data-game-frame]').elementHandle();const frame=await iframe.contentFrame();const fight=frame.locator('.battle-command-buttons button').first();await fight.waitFor();assert.equal(await frame.locator('.battle-command-buttons button').count(),4);assert.equal(await frame.locator('.battle-command-buttons button').evaluateAll(buttons=>buttons.every(button=>{const r=button.getBoundingClientRect();return r.bottom<=innerHeight+1&&button.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})),true,'all four command buttons visible and reachable');await fight.click();await frame.locator('.battle-move-button').first().waitFor();
 const geo=await frame.evaluate(()=>{const box=e=>{const r=e.getBoundingClientRect(),c=getComputedStyle(e);return {selector:e.className,y:r.y,bottom:r.bottom,height:r.height,width:r.width,rows:c.gridTemplateRows,minHeight:c.minHeight,overflow:c.overflow}};return {vh:innerHeight,parts:[...document.querySelectorAll('.battle-game-screen,.battle-command-deck,.battle-command-panel,.battle-move-menu,.battle-move-grid,.battle-move-button')].map(box)}});if(process.argv.includes('--probe'))console.log(JSON.stringify({viewport,mode,...geo}));
 if(!process.argv.includes('--probe')){assert.equal(await frame.locator('.battle-move-button').count(),4);const panel=geo.parts.find(p=>p.selector.includes('battle-command-panel'));for(const b of geo.parts.filter(p=>p.selector.includes('battle-move-button')))assert(b.bottom<=Math.min(geo.vh,panel.bottom)+1,'move clipped '+JSON.stringify(b));}
 if(!process.argv.includes('--probe')){
 const hit=await frame.locator('.battle-move-button').evaluateAll(buttons=>buttons.every(button=>{const r=button.getBoundingClientRect();return button.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}));assert(hit,'all four move centers receive input');
 const host=await page.locator('iframe[data-game-frame]').boundingBox();assert(host.y>=-1&&host.y+host.height<=viewport.height+1,'scaled game stays inside visible height');
 await frame.evaluate(()=>{window.bottomMovePressed=false;document.querySelectorAll('.battle-move-button')[3].addEventListener('click',e=>{window.bottomMovePressed=e.isTrusted},{once:true})});
 if(viewport.width<1280)await frame.locator('.battle-move-button').nth(3).tap();else await frame.locator('.battle-move-button').nth(3).click();
 assert.equal(await frame.evaluate(()=>window.bottomMovePressed),true);
 console.log('PASS '+(process.argv.includes('--webkit')?'WebKit':'Chromium')+' '+viewport.width+'x'+viewport.height+' '+mode+': four moves visible, all hit targets clear, bottom move accepts input');
 }
 await page.close();}
}finally{await browser?.close();await server.close()}
