import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
process.chdir(root)
const manifest = JSON.parse(await fs.readFile('promo/rooms/generated/footage/manifest.json', 'utf8'))
const auditPath = 'promo/rooms/output/source-audit.json'
const audit = JSON.parse(await fs.readFile(auditPath, 'utf8'))
const gameFiles = (manifest.sourceGameFiles ?? []).filter(entry => entry.path.startsWith('src/') || entry.path.startsWith('server/'))
const verified = []
for (const entry of gameFiles) {
  const currentSha256 = crypto.createHash('sha256').update(await fs.readFile(entry.path)).digest('hex')
  verified.push({ path: entry.path, sha256: entry.sha256, currentSha256, matches: currentSha256 === entry.sha256 })
}
if (!verified.length || verified.some(entry => !entry.matches)) throw new Error('Captured game files do not match the current verified game sources')
const revised = { ...audit,
  sourceGameWorkingTreeChanged: manifest.sourceGameWorkingTreeChanged,
  sourceCaptureWorkingTreeChanged: manifest.sourceCaptureWorkingTreeChanged,
  sourceGameFilesUnchangedDuringCapture: manifest.sourceGameFilesUnchangedDuringCapture,
  sourceGameFilesVerifiedAfterRendering: verified,
  sourceProvenanceNote: 'Game source changes and capture-only entry changes are recorded separately. The combined legacy sourceWorkingTreeChanged flag can be true because the capture entry was newly added; it does not imply a modified game build.',
}
await fs.writeFile(auditPath, JSON.stringify(revised, null, 2) + '\n')
console.log(JSON.stringify({ gameFiles: verified.length, sourceGameWorkingTreeChanged: revised.sourceGameWorkingTreeChanged, sourceCaptureWorkingTreeChanged: revised.sourceCaptureWorkingTreeChanged, passed: true }, null, 2))
