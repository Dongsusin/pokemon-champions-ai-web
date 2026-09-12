const DESKTOP_LANDSCAPE_WIDTH = 1440
const DESKTOP_LANDSCAPE_HEIGHT = 720
const DEFAULT_VIEWPORT = 'width=device-width, initial-scale=1.0, viewport-fit=cover'
const KEYBOARD_HEIGHT_RATIO = 0.62

const viewportMeta = document.querySelector('meta[name="viewport"]')
const touchPointerQuery = window.matchMedia('(hover: none) and (pointer: coarse)')
const landscapeQuery = window.matchMedia('(orientation: landscape)')
const MOBILE_USER_AGENT_PATTERN = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i

let syncFrame = null
let settleTimer = null
let stableLandscapeHeight = null

function isCompactTouchDevice() {
  const screenWidth = window.screen?.width || window.innerWidth
  const screenHeight = window.screen?.height || window.innerHeight
  const shortSide = Math.min(screenWidth, screenHeight)
  const longSide = Math.max(screenWidth, screenHeight)
  const hasTouchInput = touchPointerQuery.matches || navigator.maxTouchPoints > 0
  const reportsMobileBrowser = MOBILE_USER_AGENT_PATTERN.test(navigator.userAgent)

  return (hasTouchInput || reportsMobileBrowser) && shortSide <= 1200 && longSide <= 2048
}

function getLandscapeViewport() {
  const visualWidth = window.visualViewport?.width || window.innerWidth
  const visualHeight = window.visualViewport?.height || window.innerHeight
  const visualScale = window.visualViewport?.scale || 1
  const projectedVisualWidth = visualWidth * visualScale
  const projectedVisualHeight = visualHeight * visualScale
  const screenLongSide = Math.max(
    window.screen?.width || 0,
    window.screen?.height || 0,
  )
  const screenShortSide = Math.min(
    window.screen?.width || Number.POSITIVE_INFINITY,
    window.screen?.height || Number.POSITIVE_INFINITY,
  )
  const dimensionsAreStillPortrait = window.innerWidth < window.innerHeight
  const availableWidth = Math.round(
    landscapeQuery.matches && dimensionsAreStillPortrait && screenLongSide > projectedVisualWidth
      ? screenLongSide
      : projectedVisualWidth,
  )
  const measuredHeight = Math.round(
    landscapeQuery.matches && dimensionsAreStillPortrait && Number.isFinite(screenShortSide)
      ? screenShortSide
      : projectedVisualHeight,
  )
  const keyboardIsLikelyOpen = stableLandscapeHeight !== null
    && measuredHeight < stableLandscapeHeight * KEYBOARD_HEIGHT_RATIO

  if (!keyboardIsLikelyOpen && measuredHeight > 0) {
    stableLandscapeHeight = stableLandscapeHeight === null
      ? measuredHeight
      : Math.min(stableLandscapeHeight, measuredHeight)
  }

  const availableHeight = stableLandscapeHeight ?? measuredHeight
  const initialScale = Math.min(
    1,
    availableWidth / DESKTOP_LANDSCAPE_WIDTH,
    availableHeight / DESKTOP_LANDSCAPE_HEIGHT,
  )

  return `width=${DESKTOP_LANDSCAPE_WIDTH}, initial-scale=${initialScale.toFixed(5)}, viewport-fit=cover`
}

export function syncMobileViewport() {
  const isTouchDevice = isCompactTouchDevice()
  const layout = isTouchDevice
    ? (landscapeQuery.matches ? 'landscape' : 'portrait')
    : 'desktop'
  const viewport = layout === 'landscape' ? getLandscapeViewport() : DEFAULT_VIEWPORT

  if (layout !== 'landscape') stableLandscapeHeight = null

  document.documentElement.dataset.mobileLayout = layout

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
