import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { createBattlePreviewPokemon } from '../src/data/battleEngine.js'
import { getAbility } from '../src/data/trainingData.js'
import { resolveChromiumExecutable } from '../promo/scripts/browserRuntime.mjs'

// Render production tooltip components with local fixtures. No account or
// matchmaking service is available from this isolated test page.
const root = fileURLToPath(new URL('../', import.meta.url))
const output = path.join(root, 'scripts/.cache/kingambit-ability-ui')
await fs.mkdir(output, { recursive: true })
const pokemon = createBattlePreviewPokemon({
  captureId: 'kingambit-ability-ui', speciesId: 983, ability: '총대장', moves: ['도각참'],
})
const styles = ['styles', 'screenRedesign', 'battleGen5', 'mobileLandscape']
const entry = `import React,{useState}from'react';import{createRoot}from'react-dom/client';
import BattlePokemonStatusTooltip from'/src/BattlePokemonStatusTooltip.jsx';
import FactoryInfoTooltip from'/src/FactoryInfoTooltip.jsx';import{getAbility}from'/src/data/trainingData.js';
${styles.map(name => `import'/src/${name}.css';`).join('\n')}
const base=${JSON.stringify(pokemon)};
function Harness(){
 const[values,setValues]=useState({});const[mode,setMode]=useState('status');
 const[anchor,setAnchor]=useState(null);const[abilityName,setAbilityName]=useState('총대장');
 const pokemon={...base,...values,statStages:{...base.statStages,...values.statStages}};
 const ability=getAbility(abilityName);
 window.__kingambitUi={values,mode,load:values=>{setMode('status');setValues(values);},description:name=>{setMode('description');setAbilityName(name);}};
 return React.createElement('main',{className:'app-shell battle-view',style:{minHeight:'100vh',position:'relative'}},
  React.createElement('div',{style:{position:'fixed',left:'50%',top:'65%',transform:'translateX(-50%)'}},
   mode==='status'?React.createElement('button',{ref:setAnchor,type:'button'},'대도각참 상태'):
   React.createElement(FactoryInfoTooltip,{key:abilityName,title:abilityName,description:ability.description,meta:'발동 조건 · '+ability.trigger},React.createElement('button',{type:'button'},abilityName))),
  mode==='status'&&React.createElement(BattlePokemonStatusTooltip,{id:'kingambit-status',pokemon,side:'player',trainerName:'로컬 검증',visible:true,anchorElement:anchor,showBattleState:values.showBattleState!==false}));
}
createRoot(document.getElementById('root')).render(React.createElement(Harness));`
const server = await createServer({ root, logLevel: 'error',
  plugins: [{ name: 'kingambit-ability-ui-fixture',
    resolveId: id => id === '/kingambit-ability-entry.js' ? id : undefined,
    load: id => id === '/kingambit-ability-entry.js' ? entry : undefined,
  }], server: { host: '127.0.0.1', port: 0, hmr: false },
})
await server.listen()
const origin = `http://127.0.0.1:${server.httpServer.address().port}`
const html = await server.transformIndexHtml('/kingambit-ability.html', '<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body><div id="root"></div><script type="module" src="/kingambit-ability-entry.js"></script></body></html>')
const require = createRequire(new URL('../promo/package.json', import.meta.url))
const { chromium } = require('playwright')
const checks = []
const errors = []
let browser
try {
  browser = await chromium.launch({ executablePath: await resolveChromiumExecutable(chromium), headless: true })
  for (const device of [
    { id: 'desktop', viewport: { width: 1440, height: 900 } },
    { id: 'mobile', viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true },
  ]) {
    const context = await browser.newContext({ ...device, reducedMotion: 'reduce' })
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
    await context.route('**/kingambit-ability.html', route => route.fulfill({ contentType: 'text/html', body: html }))
    const page = await context.newPage()
    page.setDefaultTimeout(15_000)
    page.on('pageerror', error => errors.push({ device: device.id, error: error.message }))
    await page.goto(`${origin}/kingambit-ability.html`)
    await page.waitForFunction(() => window.__kingambitUi)
    for (const scenario of [
      { id: 'bench', count: null, expected: null },
      { id: 'zero', count: 0, expected: null },
      { id: 'one', count: 1, expected: '1.1' },
      { id: 'three', count: 3, expected: '1.3' },
      { id: 'five', count: 5, expected: '1.5' },
      { id: 'suppressed', count: 5, ability: '', expected: null },
      { id: 'different-ability', count: 5, ability: '오기', expected: null },
      { id: 'restored', count: 3, expected: '1.3' },
      { id: 'reentered', count: 4, expected: '1.4' },
      { id: 'separate-attack-rank', count: 3, expected: '1.3', attackStage: 2 },
      { id: 'preview-without-state', count: 3, showBattleState: false, expected: null },
    ]) {
      await page.evaluate(values => window.__kingambitUi.load(values), {
        supremeOverlordFallen: scenario.count, ability: scenario.ability ?? '총대장',
        statStages: { attack: scenario.attackStage ?? 0 }, showBattleState: scenario.showBattleState,
      })
      const inspector = page.locator('#kingambit-status.is-visible')
      await inspector.waitFor()
      const chip = inspector.locator('.battle-pokemon-inspector-state b').filter({ hasText: '총대장' })
      assert.equal(await chip.count(), scenario.expected ? 1 : 0, `${device.id} ${scenario.id}: active multiplier visibility`)
      if (scenario.expected) {
        assert.equal(await chip.innerText(), `총대장 · 기술 위력 ×${scenario.expected}`)
        assert.equal(await chip.getAttribute('class'), 'condition-positive', 'A power multiplier is separate from stat-stage badges')
        assert.equal(await chip.evaluate(element => {
          const rect = element.getBoundingClientRect()
          const parent = element.closest('.battle-pokemon-inspector').getBoundingClientRect()
          return rect.left >= Math.max(parent.left, 0) && rect.top >= Math.max(parent.top, 0)
            && rect.right <= Math.min(parent.right, innerWidth) && rect.bottom <= Math.min(parent.bottom, innerHeight)
            && element.scrollWidth <= element.clientWidth + 1
        }), true, `${device.id} ${scenario.id}: multiplier chip must fit the tooltip and viewport`)
      }
      const raised = inspector.locator('.battle-pokemon-inspector-state .is-raised')
      assert.equal(await raised.count(), scenario.attackStage ? 1 : 0)
      if (scenario.attackStage) assert.equal((await raised.innerText()).replace(/\s/g, ''), '공격+2')
      if (scenario.id === 'three') await page.screenshot({ path: path.join(output, `${device.id}-supreme-overlord-x1.3.png`) })
      checks.push(`${device.id}:${scenario.id}`)
    }
    for (const name of ['총대장', '오기', '프레셔']) {
      await page.evaluate(name => window.__kingambitUi.description(name), name)
      const anchor = page.getByRole('button', { name, exact: true })
      if (device.hasTouch) await anchor.tap()
      else await anchor.hover()
      const tooltip = page.locator('.factory-info-tooltip')
      await tooltip.waitFor({ state: 'visible' })
      await page.waitForFunction(description => document.querySelector('.factory-info-tooltip-description')?.innerText === description, getAbility(name).description)
      assert.equal(await tooltip.locator('.factory-info-tooltip-description').innerText(), getAbility(name).description)
      assert.equal(await tooltip.locator('.factory-info-tooltip-meta').innerText(), `발동 조건 · ${getAbility(name).trigger}`)
      assert.equal(await tooltip.evaluate(element => {
        const rect = element.getBoundingClientRect()
        return rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight
      }), true, `${device.id} ${name}: full description must fit the viewport`)
      if (name === '총대장') await page.screenshot({ path: path.join(output, `${device.id}-supreme-overlord-description.png`) })
      await page.keyboard.press('Escape')
      checks.push(`${device.id}:${name}:description`)
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false)
    await context.close()
  }
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ ok: true, checks, screenshots: output }, null, 2))
} finally {
  await browser?.close()
  await server.close()
}
