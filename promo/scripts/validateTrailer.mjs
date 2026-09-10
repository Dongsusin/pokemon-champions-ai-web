import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { NATIONAL_DEX } from '../../src/data/trainingData.js'
import { PROMO_GIMMICK_GROUPS } from '../fixtures.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
process.chdir(root)
const require = createRequire(import.meta.url)
const ffmpeg = process.env.FFMPEG_PATH || require('ffmpeg-static')
const file = 'promo/output/champions-arena-promo-1080p.mp4'
const sink = process.platform === 'win32' ? 'NUL' : '/dev/null'
const assert = (condition, message) => { if (!condition) throw new Error(message) }
const readJson = async name => JSON.parse(await fs.readFile(name, 'utf8'))

function run(args, allowedExitCodes = [0]) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpeg, ['-hide_banner', '-nostdin', ...args], { windowsHide: true })
    const out = [], err = []
    proc.stdout.on('data', data => out.push(data))
    proc.stderr.on('data', data => err.push(data))
    proc.on('error', reject)
    proc.on('close', code => {
      const result = { stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString() }
      allowedExitCodes.includes(code) ? resolve(result) : reject(new Error(result.stderr || `FFmpeg exited ${code}`))
    })
  })
}

const shots = await readJson('promo/timeline.json')
assert(shots.length > 0 && new Set(shots.map(s => s.id)).size === shots.length, 'Timeline must contain unique shots')
assert(shots.every(s => Number.isFinite(s.duration) && s.duration > 0), 'Every shot needs a positive duration')
const timelineDuration = shots.reduce((total, shot) => total + shot.duration, 0)
assert(timelineDuration >= 60 && timelineDuration <= 180, `Trailer is outside the requested 1–3 minutes: ${timelineDuration}s`)
const captures = await Promise.all(shots.map(shot => readJson(`promo/raw/${shot.id}.json`)))
const trainerRoster = []
const pokemonRoster = []
const titles = []
const gimmickWalls = []
for (const [index, capture] of captures.entries()) {
  const shot = shots[index]
  assert(capture.id === shot.id, `Capture ID mismatch for ${shot.id}`)
  const captureDuration = capture.captureDuration ?? capture.duration
  const sourceOffset = shot.sourceOffset ?? 0
  assert(Number.isFinite(sourceOffset) && sourceOffset >= 0, `Capture ${shot.id} has an invalid source offset`)
  assert(Number.isFinite(captureDuration) && captureDuration >= sourceOffset + shot.duration,
    `Capture ${shot.id} covers ${captureDuration}s but its selected cut requires ${sourceOffset + shot.duration}s`)
  assert(Array.isArray(capture.errors) && capture.errors.length === 0, `Capture ${shot.id} has errors: ${JSON.stringify(capture.errors)}`)
  assert(capture.status?.playing !== false, `Capture ${shot.id} did not play`)
  assert(capture.status?.artLoaded !== false, `Capture ${shot.id} has an unloaded image`)
  if (capture.status?.failedAssets) assert(capture.status.failedAssets.length === 0, `Capture ${shot.id} has failed assets: ${JSON.stringify(capture.status.failedAssets)}`)
  if (shot.kind === 'battle') assert(capture.audio === true, `Battle ${shot.id} has no recorded game audio`)
  const sceneParams = new URL(shot.url, 'http://localhost').searchParams
  if (shot.kind === 'title' && sceneParams.has('intro')) {
    const status = capture.status ?? {}
    assert(status.logoLoaded === true, 'Opening logo failed to load')
    assert(JSON.stringify(status.visibleText) === JSON.stringify(['POKÉMON', 'CHAMPIONS ARENA']), 'Opening must contain only the logo and game title')
    titles.push({ shotId: shot.id, logoLoaded: status.logoLoaded, visibleText: status.visibleText })
  }
  if (shot.kind === 'cinematic' && sceneParams.get('scene') === 'pokemon') {
    const status = capture.status ?? {}
    const ids = status.selectedSpeciesIds
    assert(Array.isArray(ids) && ids.length === NATIONAL_DEX.length && new Set(ids).size === ids.length, 'Pokémon montage must contain the complete national Pokédex')
    assert(ids.every(id => NATIONAL_DEX.some(entry => entry.id === id)), 'Pokémon montage contains an unsupported species')
    for (const key of ['totalPokemonCount', 'selectedPokemonCount', 'loadedPokemonCount', 'shownPokemonCount', 'peakVisiblePokemonCount']) {
      assert(status[key] === ids.length, `Pokémon capture ${shot.id}: ${key}=${status[key]}, expected ${ids.length}`)
    }
    assert(Array.isArray(status.failedAssets) && status.failedAssets.length === 0, 'Pokémon montage has unverified or failed image loads')
    pokemonRoster.push({ shotId: shot.id, selectedSpeciesIds: ids, selectedCount: ids.length, loadedCount: status.loadedPokemonCount, shownCount: status.shownPokemonCount, peakVisibleCount: status.peakVisiblePokemonCount })
  }
  if (shot.kind === 'wall') {
    const group = PROMO_GIMMICK_GROUPS.find(group => group.id === sceneParams.get('scene'))
    const status = capture.status ?? {}
    assert(group && group.variants.length === 9, `Missing nine-battle fixture group for ${shot.id}`)
    for (const field of ['totalCount', 'loadedCount', 'playedCount', 'shownCount', 'peakVisibleCount']) assert(status[field] === 9, `${shot.id}: ${field}=${status[field]}, expected 9`)
    assert(status.openingVisibleCount === 1, `${shot.id} must open with one battle`)
    assert(Array.isArray(status.errors) && status.errors.length === 0, `${shot.id} has video wall errors`)
    assert(new Set(status.pokemonNames).size === 9 && new Set(status.types).size === 9, `${shot.id} must show nine different species and types`)
    assert(JSON.stringify(status.clipIds) === JSON.stringify(group.variants.map(v => v.sceneId)), `${shot.id} uses unexpected battle videos`)
    for (const variant of group.variants) {
      const take = await readJson(`promo/raw/take-${variant.sceneId}.json`)
      assert(take.audio === true && take.errors.length === 0 && take.status?.sceneId === variant.sceneId && take.status?.playing === true, `Failed source battle capture: ${variant.sceneId}`)
      assert(take.captureDuration >= group.captureDuration && Number.isFinite(take.syncStartSeconds), `Incomplete source capture: ${variant.sceneId}`)
    }
    assert(status.videos.every(video => video.started && video.currentTime > 1 && video.readyState >= 2), `${shot.id} includes a video that did not advance`)
    const hero = await readJson(`promo/raw/${shot.audioSource}.json`)
    assert(hero.audio === true, `${shot.id} is missing recorded hero battle audio`)
    gimmickWalls.push({ shotId: shot.id, openingVisibleCount: status.openingVisibleCount, peakVisibleCount: status.peakVisibleCount, clipIds: status.clipIds, pokemonNames: status.pokemonNames, moveNames: status.moveNames, types: status.types })
  }
  const requiresTrainerRoster = shot.kind === 'cinematic' && new URL(shot.url, 'http://localhost').searchParams.get('scene') === 'trainers'
  if (requiresTrainerRoster || capture.status?.totalTrainerCount > 0) {
    const status = capture.status ?? {}
    const expectedCount = (await readJson('src/data/generatedTrainerTeams.json')).trainers.length
    assert(status.totalTrainerCount === expectedCount, `Trainer capture ${shot.id} contains ${status.totalTrainerCount}/${expectedCount} trainers`)
    assert(status.loadedTrainerCount === expectedCount, `Trainer capture ${shot.id} loaded ${status.loadedTrainerCount}/${expectedCount} images`)
    assert(status.shownTrainerCount === expectedCount, `Trainer capture ${shot.id} displayed ${status.shownTrainerCount}/${expectedCount} unique trainers`)
    assert(status.peakVisibleTrainerCount === expectedCount, `Trainer capture ${shot.id} never displayed the complete roster`)
    assert(Array.isArray(status.failedAssets) && status.failedAssets.length === 0, `Trainer capture ${shot.id} is missing successful asset-load verification`)
    trainerRoster.push({ shotId: shot.id, expectedCount, totalCount: status.totalTrainerCount, loadedCount: status.loadedTrainerCount,
      shownCount: status.shownTrainerCount, visibleCountAtCaptureEnd: status.visibleTrainerCount, peakVisibleCount: status.peakVisibleTrainerCount })
  }
}

console.log(`Validating ${shots.length} shots / ${timelineDuration}s and decoding the final video…`)
const [probe, decode, pixels, analysis] = await Promise.all([
  run(['-i', file], [1]),
  run(['-v', 'error', '-i', file, '-map', '0:v:0', '-map', '0:a:0', '-f', 'null', sink]),
  // Do not add an fps filter: it can duplicate the last frame to cover AAC padding.
  run(['-v', 'error', '-i', file, '-map', '0:v:0', '-vf', 'scale=4:4:flags=neighbor,format=rgb24', '-fps_mode', 'passthrough', '-f', 'rawvideo', 'pipe:1']),
  run(['-i', file, '-map', '0:a:0', '-vn', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json', '-f', 'null', sink]),
])
assert(!decode.stderr.trim(), `Full audio/video decode reported errors: ${decode.stderr}`)
const pixelBytesPerFrame = 4 * 4 * 3
assert(!pixels.stderr.trim() && pixels.stdout.length % pixelBytesPerFrame === 0, `Frame scan failed: ${pixels.stderr}`)

const videoLine = probe.stderr.split(/\r?\n/).find(line => /Stream #0:.*Video:/.test(line)) || ''
const audioLine = probe.stderr.split(/\r?\n/).find(line => /Stream #0:.*Audio:/.test(line)) || ''
const durationMatch = probe.stderr.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/)
const dimensions = videoLine.match(/,\s*(\d+)x(\d+)(?:\s|,)/)
const video = {
  width: Number(dimensions?.[1]), height: Number(dimensions?.[2]),
  fps: Number(videoLine.match(/,\s*(\d+(?:\.\d+)?) fps(?:,|$)/)?.[1]),
  frames: pixels.stdout.length / pixelBytesPerFrame,
  codec: videoLine.match(/Video:\s*([^\s,(]+)/)?.[1],
  pixelFormat: videoLine.match(/,\s*((?:yuv|yuva|rgb|bgr|gbr|gray|pal|nv|p0)[a-zA-Z0-9]+)(?:\(|\s|,)/)?.[1],
}
assert(durationMatch, 'Cannot read the final container duration')
const durationSeconds = Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3])
assert(Math.abs(durationSeconds - timelineDuration) < .1, `Container duration ${durationSeconds}s differs from timeline ${timelineDuration}s`)
assert(video.width === 1920 && video.height === 1080 && video.fps === 30, `Unexpected video dimensions/rate: ${JSON.stringify(video)}`)
assert(video.codec === 'h264' && video.pixelFormat === 'yuv420p', `Unexpected video format: ${JSON.stringify(video)}`)
const expectedFrames = Math.round(timelineDuration * video.fps)
assert(video.frames === expectedFrames, `Expected ${expectedFrames} actual frames; decoded ${video.frames}`)
let greenFrames = 0
for (let frame = 0; frame < pixels.stdout.length; frame += pixelBytesPerFrame) {
  let greenPixels = 0
  for (let i = frame; i < frame + pixelBytesPerFrame; i += 3) {
    if (pixels.stdout[i] < 30 && pixels.stdout[i + 1] > 220 && pixels.stdout[i + 2] < 30) greenPixels++
  }
  // A grass-type attack may contain one green pixel; the sync marker fills
  // the entire image and is detected across all sixteen sample positions.
  if (greenPixels >= 15) greenFrames++
}
assert(greenFrames === 0, `${greenFrames} frames contain the green capture synchronization marker`)

const loudnessMatch = analysis.stderr.match(/\{\s*"input_i"[\s\S]*?\}/)
assert(loudnessMatch, 'Cannot read the final audio loudness analysis')
const loudness = JSON.parse(loudnessMatch[0])
const sampleRateMatch = audioLine.match(/,\s*(\d+) Hz,\s*([^,]+)/)
const channelLayout = sampleRateMatch?.[2].trim()
const audio = {
  codec: audioLine.match(/Audio:\s*([^\s,(]+)/)?.[1],
  sampleRate: Number(sampleRateMatch?.[1]),
  channels: channelLayout === 'stereo' ? 2 : channelLayout === 'mono' ? 1 : null,
  channelLayout,
  // input_* measures the finished MP4; output_* describes a hypothetical second normalization.
  integratedLUFS: Number(loudness.input_i), truePeakDbTP: Number(loudness.input_tp),
  loudnessRangeLU: Number(loudness.input_lra),
}
assert(audio.codec === 'aac' && audio.sampleRate === 48000 && audio.channels === 2, `Unexpected audio format: ${JSON.stringify(audio)}`)
assert(Number.isFinite(audio.integratedLUFS) && Number.isFinite(audio.truePeakDbTP), 'Final audio is silent or has invalid loudness measurements')
assert(audio.truePeakDbTP < 0, `Final audio reaches/exceeds full scale: ${audio.truePeakDbTP} dBTP`)
assert(audio.integratedLUFS >= -18 && audio.integratedLUFS <= -14, `Final mix is outside the trailer loudness range: ${audio.integratedLUFS} LUFS`)
const score = await readJson('promo/generated/soundtrack.json')
assert(score.durationSeconds === timelineDuration, `Soundtrack ${score.durationSeconds}s differs from the ${timelineDuration}s timeline`)
assert(score.kind === 'web-battle-bgm' && score.sourcePath === 'public/assets/audio/battle/battle-theme.ogg', 'Trailer must use the actual web battle music')
const hashFile = async name => crypto.createHash('sha256').update(await fs.readFile(name)).digest('hex')
const frameRenders = []
const verifiedSources = new Map()
for (const shot of shots.filter(shot => ['title','cinematic','wall'].includes(shot.kind))) {
  const frameRender = await readJson(`promo/generated/smooth/${shot.id}.json`)
  const expectedDuration = shot.duration + (shot === shots.at(-1) ? 0 : .4)
  assert(frameRender.shotId === shot.id && frameRender.sample === false && frameRender.start === 0, `Invalid deterministic render: ${shot.id}`)
  assert(frameRender.fps === 30 && frameRender.frames === Math.round(expectedDuration * 30) && frameRender.durationSeconds === expectedDuration, `Incomplete deterministic frames: ${shot.id}`)
  assert(frameRender.errors.length === 0 && !frameRender.status?.errors?.length && !frameRender.status?.failedAssets?.length, `Deterministic scene errors: ${shot.id}`)
  assert(frameRender.sha256 === await hashFile(frameRender.output), `Deterministic movie differs from its report: ${shot.id}`)
  for (const [source,sha256] of Object.entries(frameRender.sourceHashes)) {
    if (!verifiedSources.has(source)) verifiedSources.set(source, await hashFile(source))
    assert(verifiedSources.get(source) === sha256, `Scene source changed after rendering: ${source}`)
  }
  const status = frameRender.status
  if (shot.id === 'pokemon') {
    for (const field of ['totalPokemonCount','loadedPokemonCount','shownPokemonCount','peakVisiblePokemonCount']) assert(status[field] === NATIONAL_DEX.length, `Rendered Pokémon roster is incomplete: ${field}`)
  }
  if (shot.id === 'trainers') {
    const expected = trainerRoster.find(roster => roster.shotId === shot.id).expectedCount
    for (const field of ['totalTrainerCount','loadedTrainerCount','shownTrainerCount','peakVisibleTrainerCount']) assert(status[field] === expected, `Rendered trainer roster is incomplete: ${field}`)
  }
  if (shot.id === 'intro') assert(JSON.stringify(status.visibleText) === JSON.stringify(['POKÉMON','CHAMPIONS ARENA']) && status.logoLoaded, 'Rendered opening must contain only the loaded logo and title')
  if (shot.kind === 'wall') {
    assert(frameRender.initialStatus.visibleCount === 1 && status.visibleCount === 9 && status.peakVisibleCount === 9, `Rendered ${shot.id} must reveal one battle to nine`)
    assert(status.videos.every(video => video.readyState >= 2 && video.currentTime > 1), `Rendered ${shot.id} contains an undecoded battle frame`)
  }
  frameRenders.push({ shotId:shot.id, frames:frameRender.frames, fps:frameRender.fps, duration:frameRender.durationSeconds, timingMethod:frameRender.timingMethod, sha256:frameRender.sha256,
    openingVisibleCount:frameRender.initialStatus?.visibleCount, finalVisibleCount:status?.visibleCount,
    peakVisiblePokemonCount:status?.peakVisiblePokemonCount, peakVisibleTrainerCount:status?.peakVisibleTrainerCount,
    errors:frameRender.errors })
}
const fixtureCheck = await readJson('promo/generated/gimmick-fixtures-validation.json')
assert(fixtureCheck.passed === true && fixtureCheck.failures.length === 0 && fixtureCheck.checks.length === 36 && fixtureCheck.checks.every(check => check.passed), 'The 36 gimmick battles have not passed engine verification')
for (const [file, sha256] of Object.entries(fixtureCheck.sourceHashes)) assert(sha256 === await hashFile(file), `Gimmick fixture changed after validation: ${file}`)
assert(score.sourceSha256 === await hashFile(score.sourcePath), 'Soundtrack source no longer matches the web game BGM')
assert(score.outputSha256 === await hashFile('promo/generated/soundtrack.wav'), 'Prepared soundtrack differs from its report')
assert(probe.stderr.includes(score.title) && probe.stderr.includes(score.artist) && probe.stderr.includes(score.licenseUrl), 'Final MP4 is missing the music attribution')
audio.soundtrack = score

const bytes = await fs.readFile(file)
const sha256 = crypto.createHash('sha256').update(bytes).digest('hex')
const smoothness = await readJson('promo/generated/smoothness-validation.json')
assert(smoothness.mode === 'validation' && smoothness.passed && smoothness.failures.length === 0 && smoothness.videoSha256 === sha256, 'Run validateSmoothness.mjs on this final movie; transition/camera validation is missing or failed')
assert(smoothness.boundaries.length === shots.length - 1 && smoothness.cameras.length === 5 && smoothness.cadence.expectedFrames === expectedFrames, 'Smoothness report does not cover all transitions and camera reveals')
const pictureEdit = await readJson('promo/generated/picture-lock.render.json')
const editFingerprint = crypto.createHash('sha256').update(await fs.readFile('promo/scripts/renderTrailer.mjs')).update(JSON.stringify(shots)).digest('hex')
assert(pictureEdit.editFingerprint === editFingerprint && pictureEdit.transitionDuration === .4 && pictureEdit.transitions === shots.length-1 && pictureEdit.duration === timelineDuration, 'Final picture composition is stale or lacks all transitions')
assert(Object.keys(pictureEdit.sourceHashes || {}).length >= shots.length * 4, 'Picture composition is missing its source hashes')
for (const [source, expectedHash] of Object.entries(pictureEdit.sourceHashes)) assert(expectedHash === await hashFile(source), `Picture source changed after composition: ${source}`)
const compositionSeconds = shots.reduce((totals, shot) => {
  totals[shot.kind] = (totals[shot.kind] || 0) + shot.duration
  return totals
}, {})
const report = {
  date: new Date().toISOString().slice(0, 10), generatedAt: new Date().toISOString(), revision: 7,
  title: probe.stderr.match(/^\s*title\s*:\s*(.+)$/m)?.[1].trim() || path.basename(file),
  durationSeconds, timelineDurationSeconds: timelineDuration, video, audio,
  bytes: bytes.length, sha256,
  compositionSeconds,
  shots: shots.map((shot, index) => ({ id: shot.id, kind: shot.kind, duration: shot.duration, captureStatus: captures[index].status })),
  verification: {
    fullAudioVideoDecode: true, expectedVideoFrames: expectedFrames, visibleSyncMarkerFrames: greenFrames,
    capturePageErrors: 0, capturesWithSyncMarkers: captures.filter(c => Number.isFinite(c.syncStartSeconds)).length,
    trainerRoster, pokemonRoster, titles, gimmickWalls, frameRenders, smoothness,
    gimmickEngine: { passed: fixtureCheck.passed, variants: fixtureCheck.checks.length, sourceHashes: fixtureCheck.sourceHashes, groups: fixtureCheck.groups },
  },
}
await fs.writeFile('promo/generated/final-audio-analysis.txt', analysis.stderr)
await fs.writeFile('promo/output/validation.json', JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
