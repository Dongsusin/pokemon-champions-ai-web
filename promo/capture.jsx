import { createRoot } from 'react-dom/client'
import BattleScreen from '../src/BattleScreen.jsx'
import { createPromoFixture, PROMO_SCENES } from './fixtures.mjs'
import '../src/styles.css'
import '../src/screenRedesign.css'
import '../src/battleGen5.css'
import '../src/titleCleanup.css'
import '../src/battleGimmicks.css'
import '../src/moveAnimationDirector.css'
import '../src/settings.css'
import './capture.css'

const params = new URLSearchParams(location.search)
const sceneId = params.get('scene') ?? 'mega'
const fixture = createPromoFixture(sceneId)
// Stable battle rolls make the recording reproducible; no stats or engine paths
// are replaced. This override lives only in the separate capture entry point.
Math.random = () => 0.5

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function until(read, timeout = 20000) {
  const deadline = performance.now() + timeout
  while (performance.now() < deadline) {
    const value = read()
    if (value) return value
    await sleep(40)
  }
  throw new Error(`Capture timed out in scene ${sceneId}`)
}
async function click(selector, index = 0) {
  const target = await until(() => {
    const element = document.querySelectorAll(selector)[index]
    return element && !element.disabled ? element : null
  })
  target.click()
  await sleep(65)
}

createRoot(document.getElementById('root')).render(
  <div className="app-shell battle-view promo-capture">
    <BattleScreen
      {...fixture}
      soundEnabled
      audioSettings={{ master: 100, music: 0, effects: 100, cries: 90, ui: 0 }}
      gameSettings={{ attackAnimation: 'normal', showDamageNumbers: true, hpBarSpeed: 'normal' }}
      onComplete={(result) => { window.promo.result = result }}
    />
  </div>,
)

const events = []
let playing = false
let prepared = false
window.promo = {
  sceneId,
  scenes: Object.keys(PROMO_SCENES),
  events,
  ready: until(() => document.querySelector('.battle-intro-overlay.is-ready'))
    .then(async () => {
      await document.fonts.ready
      await Promise.all([...document.images].map((img) => img.decode?.().catch(() => {})))
      return true
    }),
  async start() {
    if (prepared) return true
    await this.ready
    await click('.battle-intro-overlay > button')
    const dialogue = document.querySelector('.battle-trainer-dialogue-box')
    if (dialogue) await click('.battle-trainer-dialogue-box')
    await click('.battle-command-buttons .fight')
    await until(() => document.querySelector('.battle-move-button'))
    prepared = true
    return true
  },
  async play() {
    if (playing) return false
    await this.start()
    playing = true
    const startedAt = performance.now()
    events.push({ time: startedAt, event: 'play', sceneId })
    if (fixture.scene.mechanic) await click(`.battle-gimmick-selector .mechanic-${fixture.scene.mechanic}`)
    await click('.battle-move-button')
    if (fixture.scene.format === 'double') {
      if (document.querySelector('.battle-target-menu')) await click('.battle-target-card')
      await until(() => document.querySelector('.battle-move-button'))
      await click('.battle-move-button')
      // The second actor selects an actual opponent through the normal UI.
      if (document.querySelector('.battle-target-menu')) await click('.battle-target-card')
    }
    return { sceneId, startedAt }
  },
  status() {
    return {
      sceneId, prepared, playing,
      classes: document.querySelector('.battle-game-screen')?.className,
      message: document.querySelector('.battle-log-current-message')?.textContent,
      busy: document.querySelector('.battle-command-panel')?.getAttribute('aria-busy') === 'true',
      gimmick: document.querySelector('.battle-gimmick-title-card')?.textContent,
    }
  },
}

const observer = new MutationObserver(() => {
  const classes = document.querySelector('.battle-game-screen')?.className
  if (classes && events.at(-1)?.classes !== classes) events.push({ time: performance.now(), classes })
})
observer.observe(document.getElementById('root'), { subtree: true, attributes: true, attributeFilter: ['class'] })

if (params.get('autoplay') === '1') {
  window.promo.ready.then(() => window.promo.start()).then(() => sleep(500)).then(() => window.promo.play())
}
