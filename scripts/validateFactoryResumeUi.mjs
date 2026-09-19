import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createServer } from 'vite'
import { createFactoryRun, selectFactoryRentals, selectFactoryLead, beginFactoryBattle } from '../src/data/battleFactory.js'
import { createBattle } from '../src/data/battleEngine.js'
import { FACTORY_RUN_STORAGE_KEY } from '../src/data/battleFactoryStorage.js'
import { resolveChromiumExecutable } from '../promo/scripts/browserRuntime.mjs'

const require = createRequire(new URL('../promo/package.json', import.meta.url))
const { chromium } = require('playwright')
let run = createFactoryRun({ seed: 34, id: 'resume-ui-fixture', mode: 'challenge' })
run = selectFactoryRentals(run, run.offers.slice(0, 3).map(p => p.captureId))
run = beginFactoryBattle(selectFactoryLead(run, run.party[0].captureId))
run = { ...run, floor: 95, wins: 94, towerPoints: 1234, battleId: `${run.id}:floor:95` }
run.battleState = createBattle({ playerPokemon: run.party, opponent: { name: '팩토리 테스트' }, opponentTeam: run.opponentTeam, rules: run.rules })
run.battleState.turn = 12
run.battleState.player.team[0].hp = 35
const entry = `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import Factory from '/src/BattleFactoryScreen.jsx';
import{loadFactoryRun,saveFactoryRun}from'/src/data/battleFactoryStorage.js';
import '/src/styles.css';import '/src/battleGen5.css';import '/src/battleGimmicks.css';
function Test(){const[run,setRun]=useState(loadFactoryRun);return <Factory run={run} onRunChange={next=>{saveFactoryRun(next);setRun(next)}}
user={{uid:'resume-fixture',isLocalGuest:true}} soundEnabled={false} gameSettings={{attackAnimation:'skip',hpBarSpeed:'instant'}}/>}
createRoot(document.getElementById('root')).render(<Test/>);`
const server = await createServer({ logLevel: 'error', mode: 'factory-resume-test',
  plugins: [{ name: 'resume-fixture', enforce: 'pre',
    resolveId(id) { if (id === '/resume-test.jsx') return id; if (id.includes('firebaseClient')) return '\0offline-firebase' },
    load(id) { if (id === '/resume-test.jsx') return entry; if (id === '\0offline-firebase') return 'export const firebaseAuth=null;export const firebaseDb=null;export const isFirebaseConfigured=false;export const missingFirebaseEnvironmentVariables=[];' },
  }], server: { host: '127.0.0.1', port: 5293, strictPort: true, hmr: false } })
let browser
try {
  await server.listen()
  const html = await server.transformIndexHtml('/resume-test.html', '<html><body><div id="root"></div><script type="module" src="/resume-test.jsx"></script></body></html>')
  browser = await chromium.launch({ headless: true, executablePath: await resolveChromiumExecutable(chromium) })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await context.addInitScript(({ key, run }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(run)) }, { key: FACTORY_RUN_STORAGE_KEY, run })
  await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort())
  await context.route('**/resume-test.html', route => route.fulfill({ contentType: 'text/html', body: html }))
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('http://127.0.0.1:5293/resume-test.html')
  await page.locator('.battle-command-buttons .fight').waitFor()
  const read = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), FACTORY_RUN_STORAGE_KEY)
  assert.equal((await read()).battleState.turn, 12)
  await page.locator('.battle-command-buttons .fight').click()
  await page.locator('.battle-move-button').first().click()
  await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).battleState.turn > 12 || JSON.parse(localStorage.getItem(key)).battleState.winner, FACTORY_RUN_STORAGE_KEY)
  const checkpoint = await read()
  // Reload during playback: the final resolved state must already be durable.
  await page.reload()
  await page.locator('.battle-command-deck').waitFor()
  assert.deepEqual(await read(), checkpoint)
  assert.equal(checkpoint.floor, 95)
  assert.equal(checkpoint.towerPoints, 1234)
  assert.equal(errors.length, 0, errors.join('\n'))
  console.log('PASS real Factory/BattleScreen checkpoint survives reload during turn playback at floor 95')
} finally { await browser?.close(); await server.close() }
