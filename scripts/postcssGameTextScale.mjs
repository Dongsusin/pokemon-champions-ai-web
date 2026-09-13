import path from 'node:path'
import { fileURLToPath } from 'node:url'

const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url))
const absoluteSize = /(?:\d*\.)?\d+(?:px|rem|vw|vh|vmin|vmax|dvw|dvh|svw|svh|lvw|lvh|cqw|cqh|cqi|cqb|cqmin|cqmax|pt|pc|in|cm|mm)\b/i
const relativeSize = /(?:\d*\.)?\d+(?:(?:em|ex|ch|cap|ic|lh)\b|%)/i

// Transform authored game typography at build/dev time, including responsive
// rules and pseudo-elements. Relative children inherit the already scaled font;
// rem remains based on the unchanged browser root size. No DOM measurements,
// observers, page zoom, sprite scaling, or per-frame work are needed.
export default function gameTextScale() {
  return {
    postcssPlugin: 'champions-game-text-scale',
    Declaration(declaration) {
      if (!['font-size', 'font'].includes(declaration.prop.toLowerCase())) return
      const filename = declaration.source?.input?.file
      if (!filename) return
      const relative = path.relative(sourceRoot, filename)
      if (relative.startsWith('..') || path.isAbsolute(relative)) return
      if (declaration.parent.type === 'rule' && declaration.parent.selector.split(',').some(selector => /^(?:html|:root)$/.test(selector.trim()))) return
      const value = declaration.value
      if (value.includes('--game-text-scale') || !absoluteSize.test(value) || relativeSize.test(value)) return
      declaration.value = declaration.prop.toLowerCase() === 'font-size'
        ? `calc(${value} * var(--game-text-scale, 1))`
        : value.replace(absoluteSize, size => `calc(${size} * var(--game-text-scale, 1))`)
    },
  }
}
gameTextScale.postcss = true
