import fs from 'node:fs/promises'
import path from 'node:path'

export async function resolveChromiumExecutable(chromium) {
  if (process.env.PROMO_CHROME) return process.env.PROMO_CHROME
  const expected = chromium.executablePath()
  if (await fs.access(expected).then(() => true, () => false)) return expected
  // The desktop's package and cached browser revisions can differ. Prefer the
  // installed revision, then an available full Chromium from the same cache.
  const revisionDir = path.dirname(path.dirname(expected))
  const cacheDir = path.dirname(revisionDir)
  const suffix = path.relative(revisionDir, expected)
  const revisions = await fs.readdir(cacheDir).catch(() => [])
  for (const revision of revisions.filter(s => /^chromium-\d+$/.test(s)).sort((a,b) => Number(b.split('-')[1])-Number(a.split('-')[1]))) {
    const candidate = path.join(cacheDir, revision, suffix)
    if (await fs.access(candidate).then(() => true, () => false)) return candidate
  }
  throw new Error('Install Chromium with npx --prefix promo playwright install chromium, or set PROMO_CHROME.')
}
