import { useEffect, useState } from 'react'

const SHEET_COLUMNS = 16
const SHEET_TILE_SIZE = 24
const SHEET_WIDTH = SHEET_COLUMNS * SHEET_TILE_SIZE
const SHEET_HEIGHT = 48 * SHEET_TILE_SIZE

export default function BattleItemSprite({ item, size = 24, fallback = null, ...imageProps }) {
  const [imageFailed, setImageFailed] = useState(false)

  useEffect(() => {
    setImageFailed(false)
  }, [item?.id])

  if (Number.isInteger(item?.spriteSheetIndex) && item?.sprite) {
    const scale = size / SHEET_TILE_SIZE
    const left = item.spriteSheetIndex % SHEET_COLUMNS * SHEET_TILE_SIZE
    const top = Math.floor(item.spriteSheetIndex / SHEET_COLUMNS) * SHEET_TILE_SIZE
    return (
      <span
        className="battle-item-sheet-sprite"
        aria-hidden="true"
        style={{
          width: size,
          height: size,
          flex: `0 0 ${size}px`,
          backgroundImage: `url(${item.sprite})`,
          backgroundPosition: `${-left * scale}px ${-top * scale}px`,
          backgroundRepeat: 'no-repeat',
          backgroundSize: `${SHEET_WIDTH * scale}px ${SHEET_HEIGHT * scale}px`,
          imageRendering: 'pixelated',
        }}
      />
    )
  }

  if (!item?.sprite || imageFailed) return fallback
  return <img {...imageProps} src={item.sprite} alt="" onError={() => setImageFailed(true)} />
}
