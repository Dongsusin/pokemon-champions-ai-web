export const GAME_FRAME_RATIO = 16 / 9
export const GAME_FRAME_SIZES = {
  compact: { width: 960, height: 540 },
  desktop: { width: 1600, height: 900 },
}

export function fitGameFrame(width, height, canvas = GAME_FRAME_SIZES.desktop) {
  const scale = Math.max(0, Math.min(width / canvas.width, height / canvas.height))
  return { scale, width: canvas.width * scale, height: canvas.height * scale }
}

export function isGameFrame() {
  try { return window.frameElement?.hasAttribute('data-game-frame') === true }
  catch { return false }
}

export function getGameHostWindow() {
  return isGameFrame() ? window.parent : window
}

export function mountGameViewport(root) {
  const touch = matchMedia('(pointer: coarse)')
  const mobile = /Android|iPhone|iPad|iPod|IEMobile|Opera Mini/i.test(navigator.userAgent)
  const stage = document.createElement('main')
  stage.className = 'game-viewport-stage'
  const frame = document.createElement('iframe')
  frame.title = 'Pokémon Champions Arena 게임 화면'
  frame.setAttribute('data-game-frame', '')
  frame.allow = 'autoplay; fullscreen'
  frame.allowFullscreen = true
  // Keep test routes and deep links; frameElement prevents recursive hosts.
  frame.src = location.href
  const gate = document.createElement('aside')
  gate.className = 'game-viewport-rotate'
  gate.setAttribute('role', 'alert')
  gate.innerHTML = '<div><img src="/assets/brand/champions-arena-emblem.png" alt="" /><span aria-hidden="true">↻</span><h1>기기를 가로로 돌려주세요</h1><p>기기를 직접 가로로 돌리면 게임 화면이 표시됩니다.</p><small>회전 잠금을 해제하거나 자동 회전을 켜주세요.</small></div>'
  stage.append(frame)
  root.replaceChildren(stage, gate)
  document.documentElement.dataset.gameViewportHost = 'true'

  let scheduled = 0
  function sync() {
    const viewport = window.visualViewport
    const touchDevice = mobile || touch.matches || navigator.maxTouchPoints > 0
    // Desktop layout is anchored to the containing stage. Visual-viewport
    // offsets are only needed for a touch keyboard; stale offsets must never
    // move the desktop game below the browser window. Preserve pinch zoom.
    const visual = touchDevice && viewport && Math.abs(viewport.scale - 1) < .01
    const width = visual ? viewport.width : stage.clientWidth
    const height = visual ? viewport.height : stage.clientHeight
    const insets = getComputedStyle(stage)
    const left = parseFloat(insets.paddingLeft) || 0
    const right = parseFloat(insets.paddingRight) || 0
    const top = parseFloat(insets.paddingTop) || 0
    const bottom = parseFloat(insets.paddingBottom) || 0
    const compact = touchDevice || window.innerWidth < 1280
    const canvas = GAME_FRAME_SIZES[compact ? 'compact' : 'desktop']
    const fitted = fitGameFrame(Math.max(0, width - left - right), Math.max(0, height - top - bottom), canvas)
    frame.style.width = `${canvas.width}px`
    frame.style.height = `${canvas.height}px`
    frame.style.transform = `scale(${fitted.scale})`
    frame.style.left = `${(visual ? viewport.offsetLeft : 0) + left + (width - left - right - fitted.width) / 2}px`
    frame.style.top = `${(visual ? viewport.offsetTop : 0) + top + (height - top - bottom - fitted.height) / 2}px`
    const layout = compact ? 'landscape' : 'desktop'
    if (frame.dataset.layout !== layout) {
      frame.dataset.layout = layout
      frame.contentWindow?.dispatchEvent(new Event('champions:frame-layout'))
    }
    // Opening the keyboard must not count as rotation.
    const portrait = touchDevice && window.innerHeight > window.innerWidth
    gate.hidden = !portrait
    frame.inert = portrait
    frame.style.visibility = portrait ? 'hidden' : 'visible'
  }
  function schedule() {
    cancelAnimationFrame(scheduled)
    scheduled = requestAnimationFrame(sync)
  }
  sync()
  // The containing viewport can settle after browser chrome or zoom changes
  // without a matching visualViewport event.
  const stageObserver = new ResizeObserver(sync)
  stageObserver.observe(stage)
  window.addEventListener('resize', schedule, { passive: true })
  window.addEventListener('orientationchange', schedule, { passive: true })
  window.addEventListener('pageshow', schedule)
  window.visualViewport?.addEventListener('resize', schedule, { passive: true })
  window.visualViewport?.addEventListener('scroll', schedule, { passive: true })
  touch.addEventListener('change', schedule)

  // Install events arrive in the top-level document, sometimes before the
  // game's login/header button mounts. Keep that deferred prompt available.
  const captureInstall = event => { event.preventDefault(); window.__championsInstallPrompt = event }
  const installed = () => { window.__championsInstallPrompt = null }
  window.addEventListener('beforeinstallprompt', captureInstall)
  window.addEventListener('appinstalled', installed)
  return () => {
    cancelAnimationFrame(scheduled)
    stageObserver.disconnect()
    window.removeEventListener('resize', schedule)
    window.removeEventListener('orientationchange', schedule)
    window.removeEventListener('pageshow', schedule)
    window.visualViewport?.removeEventListener('resize', schedule)
    window.visualViewport?.removeEventListener('scroll', schedule)
    touch.removeEventListener('change', schedule)
    window.removeEventListener('beforeinstallprompt', captureInstall)
    window.removeEventListener('appinstalled', installed)
  }
}
