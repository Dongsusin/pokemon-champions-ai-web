// Text offsets are Unicode code points, matching PostgreSQL substring semantics.
// Ordinary patches remain the wire format until the server negotiates version 2.
export function createAccountSavePatch(previous, next, { splices: enabled = false } = {}) {
  const patch = {}, splices = {}
  for (const [key, value] of Object.entries(next)) {
    if (previous[key] === value) continue
    if (enabled && typeof previous[key] === 'string' && previous[key].length >= 1024) {
      const before = [...previous[key]], after = [...value]
      let start = 0, suffix = 0
      while (start < before.length && start < after.length && before[start] === after[start]) start++
      while (suffix < before.length - start && suffix < after.length - start
        && before[before.length - suffix - 1] === after[after.length - suffix - 1]) suffix++
      const splice = [start, before.length - start - suffix, after.slice(start, after.length - suffix).join('')]
      if (JSON.stringify(splice).length < JSON.stringify(value).length * 0.75) {
        splices[key] = splice
        continue
      }
    }
    patch[key] = value
  }
  const removed = Object.keys(previous).filter(key => !Object.hasOwn(next, key))
  return { patch, removed, ...(Object.keys(splices).length ? { splices } : {}) }
}

export function applyAccountSaveSplices(payload, splices) {
  const result = { ...payload }
  for (const [key, [start, removed, text]] of Object.entries(splices)) {
    if (typeof result[key] !== 'string') throw new RangeError('Splice source is missing')
    const points = [...result[key]]
    if (start > points.length || removed > points.length - start) throw new RangeError('Splice exceeds its source')
    result[key] = points.slice(0, start).join('') + text + points.slice(start + removed).join('')
  }
  return result
}

export async function fingerprintAccountPayload(payload) {
  if (!globalThis.crypto?.subtle) return null
  const encoder = new TextEncoder()
  const parts = []
  const unpairedSurrogate = /[\uD800-\uDFFF]/u
  for (const key of Object.keys(payload).sort()) {
    const value = payload[key]
    if (typeof value !== 'string' || unpairedSurrogate.test(key) || unpairedSurrogate.test(value)) return null
    parts.push(`${encoder.encode(key).length}:${key}${encoder.encode(value).length}:${value}`)
  }
  const text = parts.join('')
  const bytes = await globalThis.crypto.subtle.digest('SHA-256', encoder.encode(text))
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('')
}
