import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createServer } from 'vite'
import { createFactoryRun, selectFactoryRentals, selectFactoryLead, beginFactoryBattle, resolveFactoryBattle } from '../src/data/battleFactory.js'
import { normalizePokemon } from '../src/data/trainingData.js'
const { chromium } = createRequire(new URL('../promo/package.json', import.meta.url))('playwright')
const mon = id => normalizePokemon({ speciesId:id, captureId:`cost-${id}` })
const selection = { ...createFactoryRun({seed:5,mode:'challenge'}), offers:[150,445,25,151,26,6].map(mon) }
let ready = selectFactoryRentals(selection, ['cost-150','cost-445','cost-25'])
let battle = beginFactoryBattle(selectFactoryLead(ready, 'cost-150'))
const exchange = {...resolveFactoryBattle(battle,{battleId:battle.battleId,winner:'player'}),towerPoints:1000,previousOpponent:[151,26,6].map(mon)}
const entry = `import React from 'react';import{createRoot}from'react-dom/client';import Lobby from '/src/BattleFactoryLobby.jsx';import '/src/styles.css';import '/src/screenRedesign.css';
const fixtures=${JSON.stringify({selection,exchange})};function App(){const [run,setRun]=React.useState(fixtures.selection);window.loadCostFixture=id=>setRun(fixtures[id]);return <div className="app-shell factory-view"><Lobby run={run} onChooseRentals={()=>{window.confirmed=true}} onChooseLead={()=>{}} onStartBattle={()=>{}} onAdvanceFloor={()=>{window.advanced=true}} onRestart={()=>{}} onBack={()=>{}}/></div>};createRoot(document.getElementById('root')).render(<App/>);`
const server = await createServer({plugins:[{name:'cost-ui',resolveId:id=>id==='/cost-ui.jsx'?id:undefined,load:id=>id==='/cost-ui.jsx'?entry:undefined}],server:{host:'127.0.0.1',port:5220,strictPort:true},logLevel:'error'})
await server.listen()
let browser
try {
 browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
 const page=await browser.newPage({viewport:{width:1600,height:900}})
 const errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.route('**/test.html',async route=>route.fulfill({contentType:'text/html',body:await server.transformIndexHtml('/test.html','<html><body><div id="root"></div><script type="module" src="/cost-ui.jsx"></script></body></html>')}))
 await page.goto('http://127.0.0.1:5220/test.html')
 const cards=page.locator('.factory-rental-grid .factory-rental-select')
 await cards.first().waitFor()
 assert.equal(await page.locator('.factory-rental-grid .factory-card-rarity').count(),6)
 for(const index of [0,1,2]) await cards.nth(index).click()
 assert.match(await page.locator('.factory-cost-total').textContent(),/10\/10/)
 assert.equal(await cards.nth(3).isDisabled(),true)
 assert.equal(await cards.first().isDisabled(),false,'must allow deselection at cap')
 await page.getByRole('button',{name:/렌탈 팀 확정/}).click()
 assert.equal(await page.evaluate(()=>window.confirmed),true)
 await page.evaluate(()=>window.loadCostFixture('exchange'))
 const groups=page.locator('.factory-team-grid')
 await groups.first().locator('.factory-rental-select').nth(1).click()
 await groups.nth(1).locator('.factory-rental-select').nth(0).click()
 assert.match(await page.locator('.factory-exchange-warning').innerText(),/11\/10/)
 const confirm=page.getByRole('button',{name:/교환하고 다음 층/})
 assert.equal(await confirm.isDisabled(),true)
 await groups.first().locator('.factory-rental-select').nth(0).click()
 assert.equal(await confirm.isDisabled(),false)
 await confirm.click()
 assert.equal(await page.evaluate(()=>window.advanced),true)
 assert.deepEqual(errors,[])
 console.log('PASS cost UI: all six grades/costs, total, cap, deselection, confirmation, rejected/allowed exchanges')
} finally { await browser?.close();await server.close() }
