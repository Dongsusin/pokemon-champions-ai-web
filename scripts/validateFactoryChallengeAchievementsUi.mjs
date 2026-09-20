import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {createServer} from 'vite'
import {createFactoryRun,selectFactoryRentals} from '../src/data/battleFactory.js'
import {getFactoryPokemonCost} from '../src/data/battleFactoryChallenge.js'
const {chromium}=createRequire(new URL('../promo/package.json',import.meta.url))('playwright')
let run=createFactoryRun({seed:5,mode:'challenge'})
run=selectFactoryRentals(run,[...run.offers].sort((a,b)=>getFactoryPokemonCost(a)-getFactoryPokemonCost(b)).slice(0,3).map(p=>p.captureId))
const entry=`import React from 'react';import{createRoot}from'react-dom/client';import Factory from '/src/BattleFactoryScreen.jsx';import Achievements from '/src/AchievementsScreen.jsx';import{applyFactoryAchievements,createAchievementState}from'/src/data/achievementData.js';import '/src/styles.css';
const base=${JSON.stringify(run)};
function App(){const[run,setRun]=React.useState({...base,mode:'standard',floor:100}),[screen,setScreen]=React.useState(false),[progress,setProgress]=React.useState(createAchievementState);const ref=React.useRef(progress);window.fixture=(mode,floor)=>setRun({...base,mode,floor});window.progress=()=>ref.current;window.showAchievements=()=>setScreen(true);const receive=React.useCallback((floor,mode)=>{const next=applyFactoryAchievements(ref.current,floor,1234,mode);ref.current=next.state;setProgress(next.state)},[]);return screen?<Achievements progress={progress} balance={30000} onBack={()=>{}}/>:<Factory run={run} onRunChange={setRun} user={{uid:'factory-achievements-test',isLocalGuest:true}} onFactoryBestFloor={receive} soundEnabled={false}/>};createRoot(document.getElementById('root')).render(<App/>);`
const server=await createServer({logLevel:'error',plugins:[{name:'factory-achievements-test',enforce:'pre',resolveId(id){if(id==='/test-entry.jsx')return id;if(id.includes('firebaseClient'))return '\0offline-firebase'},load(id){if(id==='/test-entry.jsx')return entry;if(id==='\0offline-firebase')return 'export const firebaseAuth=null;export const firebaseDb=null;export const isFirebaseConfigured=false;export const missingFirebaseEnvironmentVariables=[];'}}],server:{host:'127.0.0.1',port:5223,strictPort:true}})
await server.listen();let browser
try{
 browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
 const page=await browser.newPage({viewport:{width:1600,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.route('**/test.html',async route=>route.fulfill({contentType:'text/html',body:await server.transformIndexHtml('/test.html','<html><body><div id="root"></div><script type="module" src="/test-entry.jsx"></script></body></html>')}))
 await page.goto('http://127.0.0.1:5223/test.html',{waitUntil:'domcontentloaded'})
 await page.waitForFunction(()=>window.progress?.().stats.factoryBestFloor===100)
 assert.equal(await page.evaluate(()=>window.progress().stats.factoryChallengeBestFloor),0)
 await page.evaluate(()=>window.fixture('challenge',95))
 await page.waitForFunction(()=>window.progress().stats.factoryChallengeBestFloor===95)
 assert.equal(await page.evaluate(()=>Object.keys(window.progress().unlocked).filter(id=>id.startsWith('factory-challenge-')).length),3)
 await page.evaluate(()=>window.fixture('challenge',100))
 await page.waitForFunction(()=>Boolean(window.progress().unlocked['factory-challenge-100']))
 await page.evaluate(()=>window.showAchievements())
 await page.getByRole('button',{name:/팩토리 도전/}).click()
 assert.equal(await page.locator('.achievement-card').count(),4)
 assert.equal(await page.getByText('도전의 정점',{exact:false}).count()>0,true)
 assert.deepEqual(errors,[])
 console.log('PASS factory UI: standard 100F isolated, restored challenge 95F grants three titles, 100F fourth title, four achievement cards')
}finally{await browser?.close();await server.close()}
