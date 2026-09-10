import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { PROMO_GIMMICK_GROUPS } from '../fixtures.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
process.chdir(root)
const require = createRequire(import.meta.url)
const ffmpeg = process.env.FFMPEG_PATH || require('ffmpeg-static')
const accents = { mega: '#f4a0ff', zmove: '#ffe179', dynamax: '#ff8aad', tera: '#94ecff' }
await fs.mkdir('promo/generated/gimmicks', { recursive: true })
const manifest = { groups: {} }
const sourceCode = await fs.readFile(fileURLToPath(import.meta.url))
function run(args, probe = false) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpeg, ['-hide_banner','-nostdin','-y',...args], { windowsHide: true })
    let error = ''
    proc.stderr.on('data', chunk => { error += chunk })
    proc.on('error', reject)
    proc.on('close', code => code === 0 || (probe && code === 1) ? resolve(error) : reject(new Error(error)))
  })
}
const selectedGroups = process.argv.slice(2)
for (const group of PROMO_GIMMICK_GROUPS.filter(group => !selectedGroups.length || selectedGroups.includes(group.id))) {
  const tiles = []
  for (const [index, variant] of group.variants.entries()) {
    const captureId = `take-${variant.sceneId}`
    const metadata = JSON.parse(await fs.readFile(`promo/raw/${captureId}.json`, 'utf8'))
    if (metadata.errors.length || !Number.isFinite(metadata.syncStartSeconds) || metadata.captureDuration < group.captureDuration) throw new Error(`Invalid gimmick capture: ${captureId}`)
    const source = `promo/raw/${captureId}.webm`
    // UI preparation can be delayed under recording load. For auxiliary
    // panels, start at the recorded gimmick event instead of showing that wait.
    const event = metadata.events?.find(event => event.classes?.includes('cue-gimmick') && event.classes.includes('actor-player'))
    const actionOffset = index === 0 ? 0 : Math.max(0, (event?.seconds ?? 0) - .15)
    const sourceStart = metadata.syncStartSeconds + actionOffset
    const probe = await run(['-i',source], true)
    const duration = probe.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/)
    const sourceDuration = duration ? Number(duration[1])*3600+Number(duration[2])*60+Number(duration[3]) : NaN
    if (!Number.isFinite(sourceDuration) || sourceStart + group.captureDuration > sourceDuration + .05) throw new Error(`Source footage is too short for ${captureId}`)
    const sourceStat = await fs.stat(source)
    const file = `promo/generated/gimmicks/${variant.sceneId}.mp4`
    const fingerprint = crypto.createHash('sha256').update(sourceCode).update(JSON.stringify({variant, metadata, size: sourceStat.size, modified: sourceStat.mtimeMs})).digest('hex')
    const cached = await fs.readFile(`${file}.json`, 'utf8').then(JSON.parse, () => null)
    const exists = await fs.access(file).then(() => true, () => false)
    if (!exists || cached?.fingerprint !== fingerprint) {
      // Only crop the original battle field. Pokémon, effects, HP and gimmicks
      // remain the actual game recording; the command panel is outside the cut.
      const scale = index === 0 ? '1920:792' : '960:396'
      await run(['-ss',String(sourceStart),'-i',source,'-t',String(group.captureDuration),'-vf',`crop=1920:792:0:68,scale=${scale},setsar=1,fps=25`,'-an','-c:v','libx264','-crf','21','-preset','fast','-threads','4','-pix_fmt','yuv420p','-movflags','+faststart',file])
      await fs.writeFile(`${file}.json`, JSON.stringify({ fingerprint }))
    }
    tiles.push({
      id: variant.sceneId, captureId, pokemonName: variant.pokemonName,
      moveName: variant.resolvedMoveName || variant.moveName,
      type: variant.resolvedMoveType || variant.teraType || variant.type,
      pokemonSlug: variant.pokemonSlug, moveId: variant.moveId,
      url: `/${file}`, duration: group.captureDuration, sourceStart, actionOffset,
    })
    console.log(`Prepared ${variant.sceneId}`)
  }
  manifest.groups[group.id] = { title: group.label, accent: accents[group.id], tiles }
}
await fs.writeFile('promo/generated/gimmick-clips.json', JSON.stringify(manifest, null, 2) + '\n')
console.log(`Prepared ${Object.values(manifest.groups).reduce((n, group) => n + group.tiles.length, 0)} actual battle clips`)
