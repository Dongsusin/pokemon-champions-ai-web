import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
process.chdir(root)
const require = createRequire(import.meta.url)
const ffmpeg = process.env.FFMPEG_PATH || require('ffmpeg-static')
const baselineMode = process.argv.includes('--baseline')
const positional = process.argv.slice(2).filter(arg => !arg.startsWith('--'))
if (positional.length > 1 || process.argv.slice(2).some(arg => arg.startsWith('--') && arg !== '--baseline')) throw new Error('Usage: node promo/scripts/validateSmoothness.mjs [--baseline] [video.mp4]')
const video = positional[0] || 'promo/output/champions-arena-promo-1080p.mp4'
const reportFile = `promo/generated/smoothness-${baselineMode ? 'baseline' : 'validation'}.json`
const shots = JSON.parse(await fs.readFile('promo/timeline.json', 'utf8'))
const timelineDuration = shots.reduce((sum, shot) => sum + shot.duration, 0)
const FPS = 30
const thresholds = {
  expectedFramesPerSecond: FPS,
  maximumFrameIntervalErrorSeconds: .002,
  nearBlackMeanGray: 1,
  maximumBoundaryBlackFrames: 0,
  nearDuplicateMeanGrayDifference: .05,
  maximumCameraHoldSeconds: 4 / FPS,
  maximumCameraNearDuplicateRatio: .15,
}

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, ['-hide_banner', '-nostdin', ...args], { windowsHide: true })
    const chunks = []; let stderr = ''
    child.stdout.on('data', chunk => chunks.push(chunk))
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('error', reject)
    child.on('close', code => code === 0 ? resolve({ stdout: Buffer.concat(chunks), stderr }) : reject(new Error(stderr.slice(-12000))))
  })
}
const round = value => Number(value.toFixed(6))
async function grayFrames(start, duration, width, height, crop) {
  const filter = `${crop ? `crop=${crop.join(':')},` : ''}scale=${width}:${height},format=gray`
  // Passthrough is intentional: inserting an fps filter would hide bad PTS and
  // synthesize repeated frames in the very footage that this script audits.
  const { stdout } = await run(['-loglevel', 'error', '-ss', String(start), '-i', video, '-t', String(duration), '-an', '-vf', filter, '-fps_mode', 'passthrough', '-f', 'rawvideo', 'pipe:1'])
  const frameBytes = width * height
  if (!stdout.length || stdout.length % frameBytes) throw new Error(`Incomplete grayscale frames at ${start}s`)
  return { data: stdout, frameBytes, frameCount: stdout.length / frameBytes }
}
async function measureBoundary(shotId, boundary) {
  const start = boundary - .15
  const { data, frameBytes, frameCount } = await grayFrames(start, .65, 16, 9)
  const brightness = []
  for (let frame = 0; frame < frameCount; frame++) {
    let sum = 0
    for (let pixel = 0; pixel < frameBytes; pixel++) sum += data[frame * frameBytes + pixel]
    brightness.push(round(sum / frameBytes))
  }
  const blackFrames = brightness.filter(value => value < thresholds.nearBlackMeanGray).length
  return { shotId, boundarySeconds: boundary, sampleStartSeconds: start, sampleDurationSeconds: .65, frameCount, minimumMeanGray: Math.min(...brightness), blackFrames, brightness, passed: blackFrames <= thresholds.maximumBoundaryBlackFrames }
}
async function measureCamera(shot, shotStart) {
  // These windows exclude the eased camera's intentionally still endpoints.
  // Crop to the moving picture, so animated captions cannot conceal a freeze.
  const localStart = shot.kind === 'wall' ? 2.15 : 2.5
  const duration = shot.kind === 'wall' ? 2.7 : 5
  const crop = shot.kind === 'wall' ? [1840, 770, 40, 80] : [1848, 670, 36, 74]
  const start = shotStart + localStart
  const { data, frameBytes, frameCount } = await grayFrames(start, duration, 160, 90, crop)
  const differences = []
  for (let frame = 1; frame < frameCount; frame++) {
    let difference = 0
    for (let pixel = 0; pixel < frameBytes; pixel++) difference += Math.abs(data[frame * frameBytes + pixel] - data[(frame - 1) * frameBytes + pixel])
    differences.push(difference / frameBytes)
  }
  let run = 0, maximumRun = 0
  const holds = []
  for (let index = 0; index <= differences.length; index++) {
    if (index < differences.length && differences[index] < thresholds.nearDuplicateMeanGrayDifference) {
      run++; maximumRun = Math.max(maximumRun, run)
    } else if (run) {
      if (run >= 2) holds.push({ atSeconds: round(start + (index - run) / FPS), durationSeconds: round((run + 1) / FPS), nearDuplicateIntervals: run })
      run = 0
    }
  }
  const nearDuplicateIntervals = differences.filter(value => value < thresholds.nearDuplicateMeanGrayDifference).length
  const nearDuplicateRatio = nearDuplicateIntervals / differences.length
  const maximumHoldSeconds = (maximumRun + 1) / FPS
  return {
    shotId: shot.id, sampleStartSeconds: start, sampleDurationSeconds: duration, crop,
    frameCount, nearDuplicateIntervals, nearDuplicateRatio: round(nearDuplicateRatio),
    maximumHoldSeconds: round(maximumHoldSeconds), holds,
    passed: maximumHoldSeconds <= thresholds.maximumCameraHoldSeconds + 1e-6 && nearDuplicateRatio <= thresholds.maximumCameraNearDuplicateRatio,
  }
}

const failures = [], boundaries = [], cameras = []
let at = 0
for (const [index, shot] of shots.entries()) {
  if (index) {
    const boundary = await measureBoundary(shot.id, at)
    boundaries.push(boundary)
    if (!boundary.passed) failures.push(`${shot.id}: ${boundary.blackFrames} near-black frames at ${at}s transition`)
  }
  if (shot.kind === 'wall' || shot.id === 'pokemon') {
    const camera = await measureCamera(shot, at)
    cameras.push(camera)
    if (!camera.passed) failures.push(`${shot.id}: camera held ${camera.maximumHoldSeconds}s; ${(camera.nearDuplicateRatio * 100).toFixed(1)}% near-duplicate intervals`)
  }
  at += shot.duration
}
const { stderr } = await run(['-i', video, '-an', '-vf', 'scale=16:9,showinfo', '-fps_mode', 'passthrough', '-f', 'null', process.platform === 'win32' ? 'NUL' : '/dev/null'])
const timeBase = stderr.match(/config in time_base: (\d+)\/(\d+)/)
if (!timeBase) throw new Error('Cannot read the decoded video time base')
const tick = Number(timeBase[1]) / Number(timeBase[2])
const timestamps = [...stderr.matchAll(/ n:\s*\d+ pts:\s*(-?\d+) pts_time:/g)].map(match => Number(match[1]) * tick)
const intervals = timestamps.slice(1).map((time, index) => time - timestamps[index])
if (!intervals.length) throw new Error('No decoded frame timestamps')
const badIntervals = intervals.map((interval, index) => ({ atSeconds: round(timestamps[index]), intervalSeconds: round(interval) })).filter(({ intervalSeconds }) => Math.abs(intervalSeconds - 1 / FPS) > thresholds.maximumFrameIntervalErrorSeconds)
const expectedFrames = Math.round(timelineDuration * FPS)
const cadence = {
  frameCount: timestamps.length, expectedFrames,
  firstTimestampSeconds: round(timestamps[0]), lastTimestampSeconds: round(timestamps.at(-1)),
  minimumIntervalSeconds: round(Math.min(...intervals)), maximumIntervalSeconds: round(Math.max(...intervals)),
  badIntervals,
  passed: timestamps.length === expectedFrames && badIntervals.length === 0,
}
if (!cadence.passed) failures.push(`Cadence: ${timestamps.length}/${expectedFrames} frames, ${badIntervals.length} irregular intervals`)
const videoSha256 = crypto.createHash('sha256').update(await fs.readFile(video)).digest('hex')
const baseline = baselineMode ? null : await fs.readFile('promo/generated/smoothness-baseline.json', 'utf8').then(JSON.parse, () => null)
const comparison = baseline ? {
  baselineSha256: baseline.videoSha256,
  baselineBoundaryBlackFrames: baseline.boundaries.reduce((sum, boundary) => sum + boundary.blackFrames, 0),
  currentBoundaryBlackFrames: boundaries.reduce((sum, boundary) => sum + boundary.blackFrames, 0),
  cameras: cameras.map(camera => ({ shotId: camera.shotId, baselineMaximumHoldSeconds: baseline.cameras.find(before => before.shotId === camera.shotId)?.maximumHoldSeconds ?? null, currentMaximumHoldSeconds: camera.maximumHoldSeconds, baselineNearDuplicateRatio: baseline.cameras.find(before => before.shotId === camera.shotId)?.nearDuplicateRatio ?? null, currentNearDuplicateRatio: camera.nearDuplicateRatio })),
} : null
const report = {
  revision: 1, generatedAt: new Date().toISOString(), mode: baselineMode ? 'baseline' : 'validation',
  videoPath: video.replaceAll('\\', '/'), videoSha256,
  method: 'Decoded native frames; grayscale boundary luminance; picture-only camera frame differences; native PTS cadence. No fps insertion or motion interpolation in the audit.',
  thresholds, timelineDurationSeconds: timelineDuration, cadence, boundaries, cameras, comparison,
  failures, passed: failures.length === 0,
}
await fs.mkdir('promo/generated', { recursive: true })
await fs.writeFile(reportFile, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ reportFile, videoSha256, passed: report.passed, cadence, boundaryBlackFrames: boundaries.reduce((sum, boundary) => sum + boundary.blackFrames, 0), cameras, comparison, failures }, null, 2))
if (!baselineMode && failures.length) process.exitCode = 1
