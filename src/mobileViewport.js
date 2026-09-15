import { loadGameSettings } from './gameSettings.js'
import { applyGameTextScale } from './gameTextScale.js'

const DEFAULT_VIEWPORT = 'width=device-width, initial-scale=1.0, viewport-fit=cover'

const viewportMeta = document.querySelector('meta[name="viewport"]')
const touchPointerQuery = window.matchMedia('(hover: none) and (pointer: coarse)')
const landscapeQuery = window.matchMedia('(orientation: landscape)')
const MOBILE_USER_AGENT_PATTERN = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i

let syncFrame = null
let settleTimer = null

function isCompactTouchDevice() {
  const screenWidth = window.screen?.width || window.innerWidth
  const screenHeight = window.screen?.height || window.innerHeight
  const shortSide = Math.min(screenWidth, screenHeight)
  const longSide = Math.max(screenWidth, screenHeight)
  const hasTouchInput = touchPointerQuery.matches || navigator.maxTouchPoints > 0
  const reportsMobileBrowser = MOBILE_USER_AGENT_PATTERN.test(navigator.userAgent)
  // Treat a tablet-sized landscape viewport as compact even when a desktop
  // browser is emulating the viewport without exposing touch points. This
  // keeps the same information-priority frame in device emulation and on
  // convertible tablets while leaving wide desktop layouts untouched.
  const tabletLandscapeViewport = window.innerWidth > window.innerHeight && window.innerWidth <= 1200

  return (hasTouchInput || reportsMobileBrowser || tabletLandscapeViewport) && shortSide <= 1200 && longSide <= 2048
}

export function syncMobileViewport() {
  const isTouchDevice = isCompactTouchDevice()
  const layout = isTouchDevice
    ? (landscapeQuery.matches ? 'landscape' : 'portrait')
    : 'desktop'
  // Keep one CSS pixel equal to one device-independent pixel on phones. The
  // old 1440x720 virtual desktop shrank every control, making 40px buttons
  // roughly 20px wide on common landscape phones and difficult to tap.
  const viewport = DEFAULT_VIEWPORT

  const layoutChanged = document.documentElement.dataset.mobileLayout !== layout
  document.documentElement.dataset.mobileLayout = layout
  // The text-scale presets are desktop-only, so crossing the mobile boundary
  // has to re-resolve the stored setting against the new layout.
  if (layoutChanged) applyGameTextScale(loadGameSettings().game.textScale)

  if (viewportMeta && viewportMeta.getAttribute('content') !== viewport) {
    viewportMeta.setAttribute('content', viewport)
  }
}

function scheduleMobileViewportSync() {
  if (syncFrame !== null) window.cancelAnimationFrame(syncFrame)
  if (settleTimer !== null) window.clearTimeout(settleTimer)

  syncFrame = window.requestAnimationFrame(() => {
    syncFrame = window.requestAnimationFrame(() => {
      syncFrame = null
      syncMobileViewport()
    })
  })
  settleTimer = window.setTimeout(() => {
    settleTimer = null
    syncMobileViewport()
  }, 240)
}

syncMobileViewport()
scheduleMobileViewportSync()

window.addEventListener('orientationchange', scheduleMobileViewportSync)
window.addEventListener('resize', scheduleMobileViewportSync, { passive: true })
window.addEventListener('pageshow', scheduleMobileViewportSync)
window.visualViewport?.addEventListener('resize', scheduleMobileViewportSync, { passive: true })
window.screen?.orientation?.addEventListener?.('change', scheduleMobileViewportSync)
touchPointerQuery.addEventListener?.('change', scheduleMobileViewportSync)
landscapeQuery.addEventListener?.('change', scheduleMobileViewportSync)
