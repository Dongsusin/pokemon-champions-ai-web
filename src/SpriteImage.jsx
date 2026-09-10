import { useId, useState } from 'react'
import { getSkinSpritePresentation } from './data/rareRewards.js'

// Keep animations in their original files. Sheet artwork is framed at render
// time, with a clip path preventing adjacent sprites from entering letterboxes.
export default function SpriteImage({
  src, fallbackSrc, alt = '', className = '', style, onLoad, onError,
  loading, decoding, fetchPriority, preserveAspectRatio = 'xMidYMid meet', ...imageProps
}) {
  const [failedSources, setFailedSources] = useState([])
  const clipId = `sprite-frame-${useId().replace(/:/g, '')}`
  const fallbackSources = Array.isArray(fallbackSrc) ? fallbackSrc : [fallbackSrc]
  const candidates = [...new Set([src, ...fallbackSources].filter(Boolean))]
  const displaySrc = candidates.find((candidate) => !failedSources.includes(candidate))
  if (!displaySrc) return null

  const presentation = getSkinSpritePresentation(displaySrc)
  const source = presentation?.source ?? displaySrc
  const renderedStyle = presentation?.filter ? {
    ...style,
    '--sprite-cosmetic-filter': presentation.filter,
    filter: [presentation.filter, 'var(--sprite-lighting-filter, brightness(1))', style?.filter].filter(Boolean).join(' '),
  } : style
  const handleError = (event) => {
    setFailedSources((previous) => previous.includes(displaySrc) ? previous : [...previous, displaySrc])
    onError?.(event)
  }
  const frame = presentation?.frame
  const commonProps = {
    ...imageProps,
    'data-cosmetic-skin': displaySrc.startsWith('/assets/pokemon/skins/') || undefined,
    'data-sprite-source': displaySrc,
  }

  if (!frame) {
    return <img {...commonProps} className={className || undefined} src={source} alt={alt}
      style={renderedStyle} loading={loading} decoding={decoding} fetchPriority={fetchPriority}
      onLoad={onLoad} onError={handleError} />
  }

  const hidden = imageProps['aria-hidden'] ?? (alt ? undefined : true)
  const isHidden = hidden === true || hidden === 'true'
  return (
    <svg {...commonProps} className={['sprite-image-viewport', className].filter(Boolean).join(' ')}
      viewBox={`${frame.x} ${frame.y} ${frame.width} ${frame.height}`}
      preserveAspectRatio={preserveAspectRatio} role={isHidden ? undefined : 'img'}
      aria-label={isHidden ? undefined : imageProps['aria-label'] ?? alt} aria-hidden={hidden}
      focusable="false" style={{ overflow: 'hidden', imageRendering: 'pixelated', ...renderedStyle }}>
      <defs><clipPath id={clipId} clipPathUnits="userSpaceOnUse">
        <rect x={frame.x} y={frame.y} width={frame.width} height={frame.height} />
      </clipPath></defs>
      <image href={source} width={frame.sheetWidth} height={frame.sheetHeight}
        clipPath={`url(#${clipId})`} onLoad={onLoad} onError={handleError} />
    </svg>
  )
}
