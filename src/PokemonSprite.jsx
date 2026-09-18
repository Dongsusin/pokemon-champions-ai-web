import { useState } from 'react'
import SpriteImage from './SpriteImage'

function PokemonSprite({
  animatedSrc,
  fallbackSrc,
  frameClassName = '',
  className = '',
  alt = '',
  decodingMode = 'sync',
  onLoad,
  onError,
  ...imageProps
}) {
  const [failedSources, setFailedSources] = useState([])
  const fallbackSources = Array.isArray(fallbackSrc) ? fallbackSrc : [fallbackSrc]
  const sourceCandidates = [...new Set([animatedSrc, ...fallbackSources].filter(Boolean))]
  const displaySrc = sourceCandidates.find((source) => !failedSources.includes(source)) ?? ''
  const frameClasses = ['pokemon-sprite-frame', frameClassName].filter(Boolean).join(' ')
  const imageClasses = ['pokemon-sprite-layer', className].filter(Boolean).join(' ')

  return (
    <span className={frameClasses} role="img" aria-label={alt}>
      {displaySrc && (
        <SpriteImage
          {...imageProps}
          className={imageClasses}
          src={displaySrc}
          alt=""
          aria-hidden="true"
          loading="eager"
          decoding={decodingMode}
          fetchPriority="high"
          onLoad={onLoad}
          onError={(event) => {
            setFailedSources((sources) => (
              sources.includes(displaySrc) ? sources : [...sources, displaySrc]
            ))
            onError?.(event)
          }}
        />
      )}
    </span>
  )
}

export default PokemonSprite
