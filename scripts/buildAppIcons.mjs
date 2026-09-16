import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { resolveChromiumExecutable } from '../promo/scripts/browserRuntime.mjs'

// Renders the installable-app icon set from the single brand emblem. Chrome
// needs 192px and 512px icons before it offers installation, and Android crops
// a maskable icon to its own shape, so those keep the emblem inside the safe
// zone on the brand background.
const root = fileURLToPath(new URL('../', import.meta.url))
const source = path.join(root, 'public/assets/brand/champions-arena-emblem.png')
const outputDir = path.join(root, 'public/assets/brand')
const require = createRequire(new URL('../promo/package.json', import.meta.url))
const { chromium } = require('playwright')

const targets = [
  { file: 'app-icon-192.png', size: 192, maskable: false },
  { file: 'app-icon-512.png', size: 512, maskable: false },
  { file: 'app-icon-maskable-192.png', size: 192, maskable: true },
  { file: 'app-icon-maskable-512.png', size: 512, maskable: true },
  { file: 'apple-touch-icon-180.png', size: 180, maskable: true },
]

const emblem = `data:image/png;base64,${(await fs.readFile(source)).toString('base64')}`
const browser = await chromium.launch({ executablePath: await resolveChromiumExecutable(chromium), headless: true })
const page = await browser.newPage()
try {
  for (const target of targets) {
    const bytes = await page.evaluate(async ({ emblem, size, maskable }) => {
      const image = new Image()
      image.src = emblem
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = size
      const ctx = canvas.getContext('2d')
      ctx.imageSmoothingQuality = 'high'
      if (maskable) {
        // Android may crop to a circle, so the emblem stays inside the 80%
        // safe zone over an opaque brand ground.
        const gradient = ctx.createLinearGradient(0, 0, size, size)
        gradient.addColorStop(0, '#111c44')
        gradient.addColorStop(0.55, '#0a1030')
        gradient.addColorStop(1, '#131a3d')
        ctx.fillStyle = gradient
        ctx.fillRect(0, 0, size, size)
        const glow = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
        glow.addColorStop(0, 'rgba(79, 201, 239, 0.28)')
        glow.addColorStop(1, 'rgba(79, 201, 239, 0)')
        ctx.fillStyle = glow
        ctx.fillRect(0, 0, size, size)
        const inner = Math.round(size * 0.58)
        const offset = Math.round((size - inner) / 2)
        ctx.drawImage(image, offset, offset, inner, inner)
      } else {
        ctx.clearRect(0, 0, size, size)
        ctx.drawImage(image, 0, 0, size, size)
      }
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
      return [...new Uint8Array(await blob.arrayBuffer())]
    }, { emblem, size: target.size, maskable: target.maskable })
    const file = path.join(outputDir, target.file)
    await fs.writeFile(file, Buffer.from(bytes))
    const written = await fs.readFile(file)
    const width = written.readUInt32BE(16), height = written.readUInt32BE(20)
    if (width !== target.size || height !== target.size) throw new Error(`${target.file}: wrote ${width}x${height}`)
    console.log(`${target.file} ${width}x${height} ${(written.length / 1024).toFixed(1)}KB${target.maskable ? ' maskable' : ''}`)
  }
} finally {
  await browser.close()
}
