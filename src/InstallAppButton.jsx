import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight, Download, Share, SquarePlus, X } from 'lucide-react'

const INSTALLED_QUERY = '(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui)'

function isStandalone() {
  if (typeof window === 'undefined') return false
  // iOS reports the home-screen launch on navigator instead of display-mode.
  return window.matchMedia?.(INSTALLED_QUERY).matches || window.navigator.standalone === true
}

function isAppleMobile() {
  if (typeof navigator === 'undefined') return false
  const agent = navigator.userAgent
  return /iPad|iPhone|iPod/.test(agent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

// Chrome hands over a deferred prompt; iOS Safari has no such event, so there
// the control explains the Share menu route instead. `variant` picks between
// the compact topbar icon and the full-width option used beside the login
// buttons.
export default function InstallAppButton({ variant = 'icon' }) {
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [installed, setInstalled] = useState(isStandalone)
  const [guideOpen, setGuideOpen] = useState(false)
  const appleGuide = isAppleMobile()

  useEffect(() => {
    const capture = (event) => {
      event.preventDefault()
      setDeferredPrompt(event)
    }
    const markInstalled = () => { setInstalled(true); setDeferredPrompt(null); setGuideOpen(false) }
    window.addEventListener('beforeinstallprompt', capture)
    window.addEventListener('appinstalled', markInstalled)
    const display = window.matchMedia?.(INSTALLED_QUERY)
    const sync = () => setInstalled(isStandalone())
    display?.addEventListener?.('change', sync)
    return () => {
      window.removeEventListener('beforeinstallprompt', capture)
      window.removeEventListener('appinstalled', markInstalled)
      display?.removeEventListener?.('change', sync)
    }
  }, [])

  useEffect(() => {
    if (!guideOpen) return undefined
    const closeOnEscape = (event) => { if (event.key === 'Escape') setGuideOpen(false) }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [guideOpen])

  const install = useCallback(async () => {
    if (!deferredPrompt) { setGuideOpen(true); return }
    deferredPrompt.prompt()
    const choice = await deferredPrompt.userChoice.catch(() => null)
    setDeferredPrompt(null)
    if (choice?.outcome === 'accepted') setInstalled(true)
  }, [deferredPrompt])

  if (installed) return null
  if (!deferredPrompt && !appleGuide) return null

  // The dialog is portalled to the document so a transformed or clipping
  // ancestor cannot squash the fixed backdrop against the header.
  const guide = guideOpen && typeof document !== 'undefined' ? createPortal(
    <div className="install-guide-backdrop" role="presentation" onClick={() => setGuideOpen(false)}>
      <section
        className="install-guide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="install-guide-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span>INSTALL</span>
            <h2 id="install-guide-title">홈 화면에 앱으로 추가</h2>
          </div>
          <button type="button" aria-label="닫기" onClick={() => setGuideOpen(false)}><X size={20} /></button>
        </header>
        <ol>
          <li><Share size={18} /> 사파리 아래쪽의 <b>공유</b> 버튼을 누르세요.</li>
          <li><SquarePlus size={18} /> <b>홈 화면에 추가</b>를 선택하세요.</li>
          <li>홈 화면 아이콘으로 실행하면 주소창 없이 전체 화면으로 플레이할 수 있습니다.</li>
        </ol>
      </section>
    </div>,
    document.body,
  ) : null

  if (variant === 'card') {
    return (
      <>
        <button className="install-app-option" type="button" onClick={install}>
          <span className="install-app-option-mark"><Download size={22} aria-hidden="true" /></span>
          <span>
            <strong>앱으로 설치</strong>
            <small>홈 화면에서 전체 화면으로 플레이</small>
          </span>
          <ChevronRight size={21} aria-hidden="true" />
        </button>
        {guide}
      </>
    )
  }

  return (
    <>
      <button
        className="icon-button install-app-button"
        type="button"
        aria-label="앱으로 설치"
        title="앱으로 설치"
        onClick={install}
      >
        <Download size={21} />
      </button>
      {guide}
    </>
  )
}
