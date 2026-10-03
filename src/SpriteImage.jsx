import { useState } from 'react'
import { localAssetUrl } from './local/localAssets.js'

// Sprites render from their original files. A source that fails is remembered so
// the next fallback is tried once rather than on every re-render.
export default function SpriteImage({
  src, fallbackSrc, alt = '', className = '', style, onLoad, onError,
  loading, decoding, fetchPriority, preserveAspectRatio, ...imageProps
}) {
  const [failedSources, setFailedSources] = useState([])
  const fallbackSources = Array.isArray(fallbackSrc) ? fallbackSrc : [fallbackSrc]
  const candidates = [...new Set([src, ...fallbackSources].map(localAssetUrl).filter(Boolean))]
  const displaySrc = candidates.find((candidate) => !failedSources.includes(candidate))
  if (!displaySrc) return null

  const handleError = (event) => {
    setFailedSources((previous) => previous.includes(displaySrc) ? previous : [...previous, displaySrc])
    onError?.(event)
  }

  return <img {...imageProps} data-sprite-source={displaySrc} className={className || undefined}
    src={displaySrc} alt={alt} style={style} loading={loading} decoding={decoding}
    fetchPriority={fetchPriority} onLoad={onLoad} onError={handleError} />
}
