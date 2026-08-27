const DESKTOP_LANDSCAPE_WIDTH = 1440
const DEFAULT_VIEWPORT = 'width=device-width, initial-scale=1.0, viewport-fit=cover'

const viewportMeta = document.querySelector('meta[name="viewport"]')
const touchPointerQuery = window.matchMedia('(hover: none) and (pointer: coarse)')
const landscapeQuery = window.matchMedia('(orientation: landscape)')

function isCompactTouchDevice() {
  const screenWidth = window.screen?.width || window.innerWidth
  const screenHeight = window.screen?.height || window.innerHeight
  const shortSide = Math.min(screenWidth, screenHeight)
  const longSide = Math.max(screenWidth, screenHeight)

  return touchPointerQuery.matches && shortSide <= 1024 && longSide <= 1600
}

function getLandscapeViewport() {
  const visualWidth = window.visualViewport?.width || window.innerWidth
  const visualScale = window.visualViewport?.scale || 1
  const availableWidth = Math.round(visualWidth * visualScale)
  const initialScale = Math.min(1, availableWidth / DESKTOP_LANDSCAPE_WIDTH)

  return `width=${DESKTOP_LANDSCAPE_WIDTH}, initial-scale=${initialScale.toFixed(5)}, viewport-fit=cover`
}

function syncMobileViewport() {
  const isTouchDevice = isCompactTouchDevice()
  const layout = isTouchDevice
    ? (landscapeQuery.matches ? 'landscape' : 'portrait')
    : 'desktop'
  const viewport = layout === 'landscape' ? getLandscapeViewport() : DEFAULT_VIEWPORT

  document.documentElement.dataset.mobileLayout = layout

  if (viewportMeta && viewportMeta.getAttribute('content') !== viewport) {
    viewportMeta.setAttribute('content', viewport)
  }
}

if (isCompactTouchDevice() && landscapeQuery.matches) {
  document.documentElement.dataset.mobileLayout = 'landscape'
  window.requestAnimationFrame(() => window.requestAnimationFrame(syncMobileViewport))
} else {
  syncMobileViewport()
}

window.addEventListener('orientationchange', syncMobileViewport)
window.addEventListener('resize', syncMobileViewport, { passive: true })
touchPointerQuery.addEventListener?.('change', syncMobileViewport)
landscapeQuery.addEventListener?.('change', syncMobileViewport)
