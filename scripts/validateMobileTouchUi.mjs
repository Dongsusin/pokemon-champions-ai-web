import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const viewport = readFileSync(new URL('../src/mobileViewport.js', import.meta.url), 'utf8')
const entry = readFileSync(new URL('../src/gameEntry.jsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('../src/mobileTouch.css', import.meta.url), 'utf8')

assert(viewport.includes("width=device-width, initial-scale=1.0, viewport-fit=cover"))
assert(!viewport.includes('width=${DESKTOP_LANDSCAPE_WIDTH}'))
assert(entry.includes("import './mobileTouch.css'"))
assert(css.includes('(hover: none) and (pointer: coarse) and (orientation: landscape)'))
assert(css.includes('.app-shell:not(.raid-view)'))
assert(css.includes('min-height: 44px'))
assert(css.includes('.battle-game-screen'))
assert(css.includes('.global-chat-dialog'))
assert(css.includes('.settings-modal'))

console.log('Validated device-width mobile viewport, touch targets, overlays, and raid isolation.')
