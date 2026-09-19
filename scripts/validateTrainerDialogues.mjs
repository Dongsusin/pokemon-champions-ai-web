import { TRAINERS } from '../src/data/trainerTeams.js'
import { getTrainerDialogue, TRAINER_DIALOGUE_EVENTS } from '../src/data/trainerDialogues.js'

const events = Object.values(TRAINER_DIALOGUE_EVENTS)
const placeholderPattern = /\{[^}]+\}/
const errors = []
const dialogueTexts = new Set()

for (const trainer of TRAINERS) {
  for (const eventId of events) {
    const dialogue = getTrainerDialogue(trainer, eventId, {
      aceName: trainer.ace?.name,
      activeName: trainer.teams?.[0]?.pokemon?.[0]?.name,
      turn: 4,
    })

    if (!dialogue.text?.trim()) errors.push(`${trainer.name}/${eventId}: 빈 대사`)
    if (placeholderPattern.test(dialogue.text)) errors.push(`${trainer.name}/${eventId}: 치환되지 않은 변수`)
    if (dialogue.text.length > 90) errors.push(`${trainer.name}/${eventId}: 대사가 너무 김 (${dialogue.text.length})`)
    dialogueTexts.add(dialogue.text)
  }
}

const minimumUniqueDialogueCount = Math.min(TRAINERS.length, 30)
if (dialogueTexts.size < minimumUniqueDialogueCount) {
  errors.push(`시작 대사 다양성이 부족함: ${dialogueTexts.size}/${minimumUniqueDialogueCount}`)
}

if (getTrainerDialogue(TRAINERS[0], 'mid', {}) !== null) {
  errors.push('배틀 시작 외 NPC 대사가 남아 있음')
}

if (errors.length > 0) {
  console.error(errors.join('\n'))
  process.exitCode = 1
} else {
  console.log(`트레이너 ${TRAINERS.length}명 시작 대사 검증 완료 (${dialogueTexts.size}개 고유 대사)`)
}

if (errors.length === 0 && process.argv.includes('--ui')) {
  const { default: assert } = await import('node:assert/strict')
  const { createRequire } = await import('node:module')
  const { fileURLToPath } = await import('node:url')
  const { createServer } = await import('vite')
  const { resolveChromiumExecutable } = await import('../promo/scripts/browserRuntime.mjs')
  const require = createRequire(new URL('../promo/package.json', import.meta.url))
  const { chromium } = require(process.env.ACHIEVEMENT_PLAYWRIGHT_MODULE || 'playwright')
  const entry = `
    import React, {useCallback, useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import BattleScreen, {TrainerDialogueScene} from '/src/BattleScreen.jsx';
    import {TRAINERS} from '/src/data/trainerTeams.js';
    import {getTrainerDialogue} from '/src/data/trainerDialogues.js';
    const trainer = TRAINERS.find(entry => entry.name === '레드');
    const playerPokemon = [{speciesId:6,captureId:'dialogue-player',moveIds:['flamethrower']}];
    const opponentTeam = {pokemon:[{speciesId:129,captureId:'dialogue-opponent',moveIds:['splash']}],battleGimmicks:[],strategy:{}};
    const rules = {format:{id:'single',label:'싱글배틀',activeSlots:1,actionSlots:1},teamRule:{id:'full',label:'풀 배틀',battleSize:1},aiDifficulty:{id:'normal'}};
    function Harness() {
      const [config,setConfig] = useState(null);
      const [renderCount,setRenderCount] = useState(0);
      const onContinue = useCallback(() => {
        window.__dialogueCalls += 1;
        if (!window.__keepDialogue) setConfig(null);
      }, []);
      window.__dialogueQA = {show:setConfig, hide:()=>setConfig(null), rerender:()=>setRenderCount(value=>value+1)};
      if (!config) return null;
      if (config.kind === 'battle') return React.createElement(BattleScreen, {
        key:config.id,playerPokemon,opponent:trainer,opponentTeam,rules,soundEnabled:false,onComplete:()=>{}
      });
      return React.createElement(TrainerDialogueScene, {trainer,onContinue,
        dialogue:{...getTrainerDialogue(trainer),id:config.id,eventId:config.eventId??'start'},'data-render':renderCount
      });
    }
    window.__dialogueCalls = 0;
    createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement(Harness)));
  `
  const server = await createServer({
    root: fileURLToPath(new URL('../', import.meta.url)),
    plugins: [{ name: 'trainer-dialogue-qa',
      resolveId: id => id === '/trainer-dialogue-qa.js' ? id : undefined,
      load: id => id === '/trainer-dialogue-qa.js' ? entry : undefined,
    }],
    server: { host: '127.0.0.1', port: 5193, strictPort: true, hmr: false }, logLevel: 'error',
  })
  let browser
  try {
    await server.listen()
    const html = await server.transformIndexHtml('/trainer-dialogue-qa.html', '<!doctype html><html lang="ko"><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/trainer-dialogue-qa.js"></script></body></html>')
    browser = await chromium.launch({ executablePath: await resolveChromiumExecutable(chromium), headless: true })
    const page = await browser.newPage()
    const pageErrors = []
    page.on('pageerror', error => pageErrors.push(error.message))
    await page.route('**/trainer-dialogue-qa.html', route => route.fulfill({ contentType: 'text/html', body: html }))
    // Export the real component only in this intercepted test response.
    await page.route('**/src/BattleScreen.jsx', async route => {
      const response = await route.fetch()
      await route.fulfill({ response, body: `${await response.text()}\nexport {TrainerDialogueScene};\n` })
    })
    await page.goto('http://127.0.0.1:5193/trainer-dialogue-qa.html')
    await page.waitForFunction(() => Boolean(window.__dialogueQA))
    // Freeze wall-clock advancement so browser assertions cannot consume the
    // last millisecond of the dialogue's three-second visibility check.
    await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') })
    await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'))
    const dialogue = page.locator('.battle-trainer-dialogue-layer')
    const dialogueButton = page.locator('.battle-trainer-dialogue-box')
    const calls = () => page.evaluate(() => window.__dialogueCalls)
    async function show(config) {
      await page.evaluate(config => window.__dialogueQA.show(config), config)
      await dialogue.waitFor({ state: 'visible' })
    }

    // No timer starts while the opening dialogue has not been mounted.
    await page.clock.runFor(5000)
    await show({ id: 'automatic' })
    assert.match(await dialogueButton.innerText(), /3초 후 자동 진행/)
    await page.clock.runFor(1900)
    await page.evaluate(() => window.__dialogueQA.rerender())
    await page.clock.runFor(1099)
    assert.equal(await dialogue.count(), 1, 'Opening dialogue must remain visible for the full three seconds')
    await page.clock.runFor(1)
    await dialogue.waitFor({ state: 'detached' })
    assert.equal(await calls(), 1, 'An unrelated re-render must not restart the timer')

    await show({ id: 'manual' })
    await page.clock.runFor(500)
    // Keep the component mounted to prove repeated clicks and its later timer cannot advance twice.
    await page.evaluate(() => { window.__keepDialogue = true })
    await dialogueButton.evaluate(button => { button.click(); button.click() })
    assert.equal(await calls(), 2, 'Manual continue must be immediate and only run once')
    await page.clock.runFor(4000)
    assert.equal(await calls(), 2, 'The automatic timer must not advance an already dismissed dialogue')
    await page.evaluate(() => { window.__keepDialogue = false; window.__dialogueQA.hide() })
    await dialogue.waitFor({ state: 'detached' })

    await show({ id: 'unmount' })
    await page.clock.runFor(2000)
    await page.evaluate(() => window.__dialogueQA.hide())
    await dialogue.waitFor({ state: 'detached' })
    await show({ id: 'next-battle' })
    await page.clock.runFor(1500)
    assert.equal(await calls(), 2, 'A removed dialogue must cancel its pending continuation')
    assert.equal(await dialogue.count(), 1, 'An earlier battle timer must not dismiss the next dialogue')
    await page.clock.runFor(1500)
    await dialogue.waitFor({ state: 'detached' })
    assert.equal(await calls(), 3)

    await show({ id: 'non-opening', eventId: 'mid' })
    await page.clock.runFor(5000)
    assert.equal(await calls(), 3, 'Only the START event may automatically continue')
    assert.equal(await dialogue.count(), 1)
    await dialogueButton.evaluate(button => button.click())
    await dialogue.waitFor({ state: 'detached' })
    assert.equal(await calls(), 4)

    // Exercise the real BattleScreen's intro -> dialogue -> unlocked commands sequence.
    await page.evaluate(() => window.__dialogueQA.show({ kind: 'battle', id: 'real-battle' }))
    await page.locator('.battle-intro-overlay').waitFor({ state: 'visible' })
    await page.clock.runFor(10000)
    assert.equal(await page.locator('.battle-intro-overlay').count(), 1, 'The battle intro itself must stay manual')
    assert.equal(await dialogue.count(), 0)
    await page.waitForFunction(() => !document.querySelector('.battle-intro-overlay button')?.disabled)
    await page.locator('.battle-intro-overlay button').evaluate(button => button.click())
    await dialogue.waitFor({ state: 'visible' })
    assert.equal(await page.locator('button.surrender').isDisabled(), true, 'Opening dialogue locks battle commands')
    await page.clock.runFor(2999)
    assert.equal(await dialogue.count(), 1)
    await page.clock.runFor(1)
    await dialogue.waitFor({ state: 'detached' })
    assert.equal(await page.locator('button.surrender').isEnabled(), true, 'Commands unlock automatically after the dialogue')
    assert.deepEqual(pageErrors, [], 'Dialogue flow must not produce browser runtime errors')
    console.log('트레이너 대사 UI 검증 완료: 표시 후 3초, 재렌더 유지, 수동 진행, 중복 방지, 타이머 정리, 시작 대사만 적용, 실제 배틀 진입')
  } finally {
    await browser?.close()
    await server.close()
  }
}
