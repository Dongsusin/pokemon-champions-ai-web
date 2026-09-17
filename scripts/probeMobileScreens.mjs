import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { normalizePokemon } from '../src/data/trainingData.js'
import { createSavedTeams } from '../src/data/teamData.js'
import { resolveChromiumExecutable } from '../promo/scripts/browserRuntime.mjs'

// Walks the phone tab bar through the real GameApp and reports what the frame
// cuts off: anything under the bottom bar, content clipped inside its own box,
// and artwork that does not sit centred in the slot drawn for it.
const root = fileURLToPath(new URL('../', import.meta.url))
const output = path.join(root, 'scripts/.cache/mobile-screens')
await fs.mkdir(output, { recursive: true })
const port = Number(process.env.MOBILE_SCREENS_PORT ?? 5293)
const origin = `http://127.0.0.1:${port}`
const owned = [6, 9, 3, 25, 94, 149, 130, 143, 68, 65, 445, 448]
  .map(speciesId => normalizePokemon({ speciesId, captureId: `dex-${speciesId}`, directDrawCount: 1 }))
const ids = owned.slice(0, 6).map(pokemon => pokemon.captureId)
const teams = createSavedTeams(ids, ids)
const styles = ['styles', 'screenRedesign', 'battleGen5', 'titleCleanup', 'battleGimmicks', 'moveAnimationDirector',
  'settings', 'auth', 'mobileLandscape', 'gameTextScale', 'scaledBoxCards', 'scaledBattleCards', 'scaledTrainingEditor',
  'mobileTouch', 'mobileUiV2', 'mobileReferenceLayout', 'installApp']
const entry = `import React from 'react';import{createRoot}from'react-dom/client';import{GameApp}from'/src/App.jsx';import '/src/mobileViewport.js';
${styles.map(name => `import '/src/${name}.css';`).join('\n')}
createRoot(document.getElementById('root')).render(React.createElement(GameApp,{
user:{uid:'mobile-screens-offline',displayName:'모바일 검증',isLocalGuest:true},onPlayerDataChanged:()=>{}
}));`
const storage = {
  'champions-dex-v2': JSON.stringify(owned),
  'champions-teams-v1': JSON.stringify({ version: 1, activeTeamId: 'team-1', teams }),
  'champions-team-v2': JSON.stringify(ids),
  'champions-vp-v1': '22150',
  'champions-draw-tutorial-v1': 'complete',
  'champions-settings-v1': JSON.stringify({ audio: { enabled: false }, game: { attackAnimation: 'skip', hpBarSpeed: 'instant', playerGender: 'male' } }),
}

const server = await createServer({
  root,
  mode: 'mobile-screens-probe',
  logLevel: 'error',
  plugins: [{
    name: 'mobile-screens-fixture',
    enforce: 'pre',
    resolveId(source) {
      if (source === '/mobile-screens-entry.js') return source
      if (/firebaseClient(?:\.js)?$/.test(source)) return '\0mobile-screens-offline-auth'
      return undefined
    },
    load(id) {
      if (id === '/mobile-screens-entry.js') return entry
      if (id === '\0mobile-screens-offline-auth') return 'export const firebaseAuth=null;export const firebaseDb=null;export const isFirebaseConfigured=false;export const missingFirebaseEnvironmentVariables=[];'
      return undefined
    },
  }],
  server: { host: '127.0.0.1', port, strictPort: true, hmr: false },
})
await server.listen()
const html = await server.transformIndexHtml('/mobile-screens.html', '<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body><div id="root"></div><script type="module" src="/mobile-screens-entry.js"></script></body></html>')

// Runs in the page.
function audit() {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const shell = document.querySelector('.app-shell') ?? document.body
  const tabbar = document.querySelector('.mobile-tabbar')
  const tabTop = tabbar ? Math.round(tabbar.getBoundingClientRect().top) : vh
  const label = node => {
    const classes = typeof node.className === 'string' ? node.className.trim().split(/\s+/).filter(Boolean) : []
    return node.tagName.toLowerCase() + (classes.length ? '.' + classes.slice(0, 2).join('.') : '')
  }
  const shown = node => {
    const style = getComputedStyle(node)
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false
    const box = node.getBoundingClientRect()
    return box.width > 1 && box.height > 1
  }
  const decorative = node => /glow|aura|sheen|particle|ring|halo|flash|beam|trail|blur|light|orbit|burst|crack|shell|piece/i.test(String(node.className))
  const scrolls = node => {
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent)
      if (/(auto|scroll)/.test(style.overflowY) && parent.scrollHeight > parent.clientHeight + 2) return label(parent)
    }
    return null
  }
  const nodes = [...shell.querySelectorAll('*')].filter(shown)
  const belowFrame = []
  const underTabbar = []
  const cut = []
  const offCentre = []
  for (const node of nodes) {
    if (node.closest('.mobile-tabbar')) continue
    const box = node.getBoundingClientRect()
    const style = getComputedStyle(node)
    const pane = scrolls(node)
    if (box.bottom > vh + 2 && !pane) {
      belowFrame.push({ node: label(node), by: Math.round(box.bottom - vh), decorative: decorative(node), text: (node.textContent ?? '').trim().slice(0, 32) })
    } else if (tabbar && box.bottom > tabTop + 2 && box.top < tabTop && !pane && !decorative(node)
      && (!node.querySelector('*') || node.matches('button, a, input, select')) && (node.textContent ?? '').trim()) {
      underTabbar.push({ node: label(node), by: Math.round(box.bottom - tabTop), text: node.textContent.trim().slice(0, 32) })
    }
    const hiddenY = /(hidden|clip)/.test(style.overflowY)
    const hiddenX = /(hidden|clip)/.test(style.overflowX)
    // Report a box as cut only when the part that overflows is content, not a
    // decorative layer the box is meant to crop.
    const spills = [...node.children].some(child => {
      if (decorative(child) || !shown(child)) return false
      const childBox = child.getBoundingClientRect()
      return childBox.bottom > box.bottom + 2 || childBox.right > box.right + 2
    }) || node.scrollHeight > node.clientHeight + 2 && !node.children.length
    if (((hiddenY && node.scrollHeight > node.clientHeight + 2) || (hiddenX && node.scrollWidth > node.clientWidth + 2))
      && spills && (node.textContent ?? '').trim() && !decorative(node)) {
      cut.push({ node: label(node), client: `${node.clientWidth}x${node.clientHeight}`, scroll: `${node.scrollWidth}x${node.scrollHeight}`,
        parts: [...node.children].filter(shown).map(child => `${label(child)}:${Math.round(child.getBoundingClientRect().height)}`).join(' '),
        text: node.textContent.trim().slice(0, 32) })
    }
    // Artwork should sit in the middle of the box drawn for it.
    if (node.matches('img, svg.sprite-image-viewport') && node.parentElement) {
      const parent = node.parentElement.getBoundingClientRect()
      if (parent.width > 8 && box.width > 4) {
        const drift = Math.round(((box.left + box.right) / 2) - ((parent.left + parent.right) / 2))
        const room = Math.round((parent.width - box.width) / 2)
        if (Math.abs(drift) > 3 && Math.abs(drift) > room * 0.34) {
          offCentre.push({ node: label(node), parent: label(node.parentElement), drift, parentWidth: Math.round(parent.width), width: Math.round(box.width) })
        }
      }
    }
  }
  belowFrame.sort((a, b) => b.by - a.by)
  underTabbar.sort((a, b) => b.by - a.by)
  offCentre.sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift))
  return {
    viewport: { width: vw, height: vh },
    layoutAttribute: document.documentElement.dataset.mobileLayout ?? null,
    tabbarTop: tabbar ? tabTop : null,
    pageScroll: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
    belowFrame: belowFrame.slice(0, 8),
    belowFrameCount: belowFrame.length,
    underTabbar: underTabbar.slice(0, 8),
    underTabbarCount: underTabbar.length,
    cut: cut.slice(0, 8),
    cutCount: cut.length,
    drawStage: (() => {
      const stage = document.querySelector('.draw-center-stage')
      if (!stage) return null
      const walk = (node, depth) => {
        const box = node.getBoundingClientRect()
        const style = getComputedStyle(node)
        const row = { node: label(node), h: Math.round(box.height), scroll: node.scrollHeight,
          minHeight: style.minHeight, height: style.height, padding: style.padding }
        return depth > 1 ? [row] : [row, ...[...node.children].filter(shown).flatMap(child => walk(child, depth + 1))]
      }
      return { client: stage.clientHeight, scroll: stage.scrollHeight, children: walk(stage, 0).slice(0, 12) }
    })(),
    offCentre: offCentre.slice(0, 6),
    offCentreCount: offCentre.length,
  }
}

const require = createRequire(new URL('../promo/package.json', import.meta.url))
const { chromium } = require('playwright')
const browser = await chromium.launch({ headless: true, executablePath: await resolveChromiumExecutable(chromium) })
const findings = []

const sizes = (process.argv.slice(2).length ? process.argv.slice(2) : ['932x430', '844x390', '800x360'])
  .map(size => { const [width, height] = size.split('x').map(Number); return { width, height } })

try {
  for (const viewport of sizes) {
    const tag = `${viewport.width}x${viewport.height}`
    console.log(`\n========== ${tag} ==========`)
    const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
    await context.addInitScript(seed => {
      localStorage.clear()
      for (const [key, value] of Object.entries(seed)) localStorage.setItem(key, value)
    }, storage)
    await context.route('**/*', async route => {
      const url = new URL(route.request().url())
      // Sprite artwork is part of what is being measured, so the shipped sprite
      // CDNs are allowed while every API stays blocked.
      const allowed = ['127.0.0.1', 'localhost', '[::1]', 'play.pokemonshowdown.com', 'raw.githubusercontent.com']
      if (!allowed.includes(url.hostname) || url.pathname.startsWith('/api/')) { await route.abort('blockedbyclient'); return }
      await route.continue()
    })
    await context.route('**/mobile-screens.html', route => route.fulfill({ contentType: 'text/html', body: html }))
    const page = await context.newPage()
    page.setDefaultTimeout(25_000)
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    const tap = locator => locator.tap()

    const report = async (name) => {
      await page.evaluate(() => document.fonts.ready)
      await page.waitForTimeout(420)
      const result = await page.evaluate(audit)
      result.screen = name
      result.tag = tag
      findings.push(result)
      await page.screenshot({ path: path.join(output, `${tag}-${name}.png`) })
      console.log(`\n--- ${name} (${result.viewport.width}x${result.viewport.height}, tabbar top ${result.tabbarTop}) ---`)
      console.log(`  below frame ${result.belowFrameCount} | under tabbar ${result.underTabbarCount} | clipped ${result.cutCount} | off-centre art ${result.offCentreCount}`)
      for (const item of result.belowFrame.filter(entry => !entry.decorative).slice(0, 5)) console.log(`   BELOW ${item.node} by ${item.by}px "${item.text}"`)
      for (const item of result.underTabbar.slice(0, 5)) console.log(`   TABBAR ${item.node} by ${item.by}px "${item.text}"`)
      for (const item of result.cut.slice(0, 3)) console.log(`   CUT ${item.node} ${item.client} < ${item.scroll} [${item.parts}]`)
      for (const item of result.offCentre.slice(0, 5)) console.log(`   ART ${item.node} in ${item.parent} drift ${item.drift}px (art ${item.width} of ${item.parentWidth})`)
      if (result.drawStage && result.drawStage.scroll > result.drawStage.client + 2) { console.log('   STAGE', result.drawStage.client, '<', result.drawStage.scroll); for (const row of result.drawStage.children) console.log('     ', JSON.stringify(row)) }
      if (result.pageScroll.height > result.viewport.height + 1) console.log(`   page scrolls down ${result.pageScroll.height} > ${result.viewport.height}`)
      if (errors.length) console.log('   page errors:', errors.slice(0, 2))
    }

    try {
      await page.goto(`${origin}/mobile-screens.html`)
      // The app boots straight into the lobby; there is no landing screen.
      await page.locator('.lobby-layout').waitFor()
      await report('lobby')

      for (const [name, label] of [['box', '박스'], ['training', '트레이닝'], ['shop', '상점'], ['achievements', '업적']]) {
        await tap(page.locator('.mobile-tabbar-item').filter({ hasText: label }).first())
        await page.waitForTimeout(700)
        await report(name)
        // The box only shows its detail panel once a Pokemon is picked, and that
        // panel is what runs into the bottom bar.
        if (name === 'box') {
          const card = page.locator('.pc-box-grid-wrap button, .team-box-card-select').first()
          if (await card.count()) {
            await tap(card)
            await page.waitForTimeout(700)
            await report('box-detail')
          }
        }
      }

      // The draw result is the screen the bottom strip and the revealed artwork
      // actually belong to, so run a real ten-pull.
      await tap(page.locator('.mobile-tabbar-item').filter({ hasText: '메인' }).first())
      await page.locator('.lobby-layout').waitFor()
      await tap(page.locator('.mode-card, .mode-grid button').filter({ hasText: '포켓몬 뽑기' }).first())
      await page.locator('.draw-screen').waitFor()
      await report('draw-banner')

      const pull = page.getByRole('button', { name: /10회 뽑기|10회 스카우트/ }).first()
      if (await pull.count()) {
        await tap(pull)
        await page.locator('.draw-slot-strip').waitFor({ timeout: 30_000 })
        await page.waitForTimeout(900)
        await report('draw-results')
        const hatchAll = page.getByRole('button', { name: /전체 부화/ }).first()
        if (await hatchAll.count() && await hatchAll.isEnabled()) {
          await tap(hatchAll)
          await page.waitForTimeout(3200)
          await report('draw-revealed')
        }
      }
    } catch (error) {
      console.log(`  !! ${tag} stopped: ${error.message.split('\n')[0]}`)
      await page.screenshot({ path: path.join(output, `${tag}-ERROR.png`) }).catch(() => {})
    } finally {
      await context.close()
    }
  }
} finally {
  await browser.close()
  await server.close()
}

await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(findings, null, 2))
console.log('\n===== summary =====')
for (const item of findings) {
  const real = item.belowFrame.filter(entry => !entry.decorative).length
  console.log(`${item.tag} ${item.screen}: below ${real}/${item.belowFrameCount}, tabbar ${item.underTabbarCount}, clipped ${item.cutCount}, art ${item.offCentreCount}`)
}
console.log(`\nscreenshots: ${output}`)
