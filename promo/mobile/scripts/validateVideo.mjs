import fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
process.chdir(root)
const require = createRequire(import.meta.url)
const ffmpeg = process.env.FFMPEG_PATH || require('ffmpeg-static')
const sink = process.platform === 'win32' ? 'NUL' : '/dev/null'
const file = path.resolve(process.argv[2] || 'promo/mobile/output/champions-arena-mobile-update-1080p.mp4')
const outputDir = path.dirname(file)
await fs.mkdir(outputDir, { recursive: true })
const report = {
  generatedAt: new Date().toISOString(), file,
  passed: false, failures: [], warnings: [],
  review: { required: true, completed: false, note: 'Review the contact sheet and play scene transitions. Stable title/data scenes can legitimately trigger freeze warnings; automatic detection alone cannot certify pacing or readability.' },
}
const check = (condition, message) => { if (!condition) report.failures.push(message) }
function run(args, allowedExitCodes = [0]) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpeg, ['-hide_banner', '-nostdin', '-threads', '2', ...args], { windowsHide: true })
    let stdout = '', stderr = ''
    proc.stdout.on('data', chunk => { stdout += chunk })
    proc.stderr.on('data', chunk => { stderr += chunk })
    proc.on('error', reject)
    proc.on('close', code => allowedExitCodes.includes(code)
      ? resolve({ stdout, stderr, code })
      : reject(new Error(`FFmpeg exited ${code}: ${stderr}`)))
  })
}
const hashFile = file => new Promise((resolve, reject) => {
  const hash = crypto.createHash('sha256')
  createReadStream(file).on('data', chunk => hash.update(chunk)).on('error', reject).on('end', () => resolve(hash.digest('hex')))
})
const number = value => Number.isFinite(Number(value)) ? Number(value) : null
function segments(text, prefix, duration) {
  const events = [...text.matchAll(new RegExp(`${prefix}_(start|end):\\s*([\\d.]+)`, 'g'))]
  const result = []
  let start = null
  for (const event of events) {
    if (event[1] === 'start') start = Number(event[2])
    else if (start !== null) {
      result.push({ start, end: Number(event[2]), duration: Number(event[2]) - start })
      start = null
    }
  }
  if (start !== null) result.push({ start, end: duration, duration: duration - start })
  return result
}

try {
  const probe = await run(['-i', file], [1])
  const videoLine = probe.stderr.split(/\r?\n/).find(line => /Stream #.*Video:/.test(line)) || ''
  const audioLine = probe.stderr.split(/\r?\n/).find(line => /Stream #.*Audio:/.test(line)) || ''
  report.embeddedSubtitleTracks = probe.stderr.split(/\r?\n/).filter(line => /Stream #.*Subtitle:/.test(line)).length
  check(report.embeddedSubtitleTracks === 0, 'Keep subtitles in the separate SRT to avoid unwanted small text during playback')
  const time = probe.stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
  const durationSeconds = time ? Number(time[1]) * 3600 + Number(time[2]) * 60 + Number(time[3]) : NaN
  const size = videoLine.match(/,\s*(\d+)x(\d+)(?:\s|,)/)
  const channel = audioLine.match(/,\s*(\d+) Hz,\s*([^,]+)/)
  report.durationSeconds = number(durationSeconds)
  report.video = {
    codec: videoLine.match(/Video:\s*([^\s,(]+)/)?.[1] || null,
    width: Number(size?.[1]), height: Number(size?.[2]),
    fps: Number(videoLine.match(/,\s*(\d+(?:\.\d+)?) fps(?:,|$)/)?.[1]),
    pixelFormat: videoLine.match(/,\s*((?:yuv|yuva|rgb|bgr|gbr|gray|pal|nv|p0)[a-zA-Z0-9]+)(?:\(|\s|,)/)?.[1] || null,
  }
  report.audio = { codec: audioLine.match(/Audio:\s*([^\s,(]+)/)?.[1] || null,
    sampleRate: Number(channel?.[1]), channelLayout: channel?.[2]?.trim() || null }
  check(durationSeconds >= 60 && durationSeconds <= 120.05, `Expected 60–120 seconds, received ${durationSeconds}`)
  check(report.video.width === 1920 && report.video.height === 1080, 'Video must be 1920 × 1080')
  check(report.video.fps === 30, 'Video must be 30 fps')
  check(report.video.codec === 'h264' && report.video.pixelFormat === 'yuv420p', 'Video must be H.264 / yuv420p')
  check(report.audio.codec === 'aac' && report.audio.sampleRate === 48000 && report.audio.channelLayout === 'stereo', 'Audio must be AAC / 48 kHz / stereo')
  if (!Number.isFinite(durationSeconds)) throw new Error('Could not read the final duration')

  const [decode, analysis] = await Promise.all([
    run(['-v', 'error', '-xerror', '-err_detect', 'explode', '-i', file, '-map', '0:v:0', '-map', '0:a:0', '-progress', 'pipe:1', '-f', 'null', sink], [0, 1, 69]),
    run(['-i', file, '-map', '0:v:0', '-map', '0:a:0', '-vf', 'scale=480:-2,blackdetect=d=0.15:pix_th=0.08:pic_th=0.98,freezedetect=n=-55dB:d=2.5', '-af', 'silencedetect=n=-45dB:d=1,loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json', '-f', 'null', sink]),
  ])
  const frames = [...decode.stdout.matchAll(/^frame=(\d+)$/gm)].at(-1)?.[1]
  report.video.decodedFrames = Number(frames)
  report.video.frameDurationSeconds = Number(frames) / 30
  report.decode = { passed: decode.code === 0 && !decode.stderr.trim(), errors: decode.stderr.trim() }
  check(report.decode.passed, 'Full video/audio decode reported errors')
  check(Math.abs(report.video.frameDurationSeconds - durationSeconds) < .08, 'Decoded frame count does not match the container duration')

  const loudness = analysis.stderr.match(/\{\s*"input_i"[\s\S]*?\}/)?.[0]
  const measurement = loudness ? JSON.parse(loudness) : null
  report.audio.integratedLUFS = number(measurement?.input_i)
  report.audio.truePeakDbTP = number(measurement?.input_tp)
  report.audio.loudnessRangeLU = number(measurement?.input_lra)
  check(measurement && Number.isFinite(Number(measurement.input_i)), 'Audio is silent or its loudness could not be measured')
  check(report.audio.integratedLUFS >= -22 && report.audio.integratedLUFS <= -12, 'Finished audio is outside the acceptable -22 to -12 LUFS range')
  check(report.audio.truePeakDbTP !== null && report.audio.truePeakDbTP < 0, 'Audio reaches full scale or cannot be measured')
  if (report.audio.truePeakDbTP > -1) report.warnings.push('True peak exceeds -1 dBTP; lower the final mix ceiling to give AAC encoding more headroom.')
  const interiorDuration = event => Math.max(0, Math.min(event.end, durationSeconds - 1.8) - Math.max(event.start, .7))
  report.scan = {
    blackSegments: segments(analysis.stderr, 'black', durationSeconds),
    freezeSegments: segments(analysis.stderr, 'freeze', durationSeconds),
    silenceSegments: segments(analysis.stderr, 'silence', durationSeconds),
  }
  // FFmpeg's blackdetect uses black_start/black_end; freezedetect uses freeze_start/freeze_end.
  const middleBlack = report.scan.blackSegments.filter(event => interiorDuration(event) >= .15)
  const middleSilence = report.scan.silenceSegments.filter(event => interiorDuration(event) >= 1)
  check(middleBlack.length === 0, `${middleBlack.length} unexpected interior black segment(s) detected`)
  check(middleSilence.length === 0, `${middleSilence.length} unexpected interior silent segment(s) detected`)
  if (report.scan.freezeSegments.length) report.warnings.push(`${report.scan.freezeSegments.length} still segment(s) exceed 2.5 seconds. Review them; stable titles and readable data cards are allowed.`)

  const contactSheet = path.join(outputDir, 'contact-sheet.jpg')
  await run(['-y', '-i', file, '-vf', `fps=16/${durationSeconds},scale=480:270,tile=4x4:padding=4:margin=4:color=0x111827`, '-frames:v', '1', '-q:v', '2', contactSheet])
  report.contactSheet = { file: contactSheet, rows: 4, columns: 4,
    approximateSampleSeconds: Array.from({ length: 16 }, (_, index) => Number(((index + .5) * durationSeconds / 16).toFixed(3))) }
  report.bytes = (await fs.stat(file)).size
  report.sha256 = await hashFile(file)
  await fs.writeFile(path.join(outputDir, 'audio-video-analysis.txt'), analysis.stderr.replace(/\r\n?/g, '\n').split('\n').map(line => line.trimEnd()).join('\n').trimEnd() + '\n')
} catch (error) {
  report.failures.push(error.message)
}
report.passed = report.failures.length === 0
await fs.writeFile(path.join(outputDir, 'validation.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
if (!report.passed) process.exitCode = 1
