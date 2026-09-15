import { useEffect, useState } from 'react'
import { MOBILE_LAYOUT_EVENT, getMobileLayout } from './mobileViewport.js'

/**
 * Current layout frame: 'landscape' | 'portrait' | 'desktop'.
 * Screens use this when a layout needs a different composition rather than
 * only different styling — for example dropping controls that do not earn
 * their space on a phone.
 */
export function useMobileLayout() {
  const [layout, setLayout] = useState(getMobileLayout)

  useEffect(() => {
    const sync = () => setLayout(getMobileLayout())
    sync()
    window.addEventListener(MOBILE_LAYOUT_EVENT, sync)
    return () => window.removeEventListener(MOBILE_LAYOUT_EVENT, sync)
  }, [])

  return layout
}

export function useIsCompactLayout() {
  return useMobileLayout() !== 'desktop'
}
