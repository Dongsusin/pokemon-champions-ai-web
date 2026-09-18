import { createRequire } from 'node:module'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolveChromiumExecutable } from './browserRuntime.mjs'

// Cuts the recorded co-op boss raid into a promo-length video: trims each scene
// out of the single continuous take, lays Korean titles over it, dissolves
// between scenes and mixes the game's battle theme under the captured effects.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
process.chdir(root)
const require = createRequire(import.meta.url)
const ffmpeg = process.env.FFMPEG_PATH || require('ffmpeg-static')
const runtimeModules = process.env.PROMO_NODE_MODULES || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules')
let chromium
try { ({ chromium } = require('playwright')) } catch { ({ chromium } = require(path.join(runtimeModules, 'playwright'))) }

const generated = 'promo/generated/raid'
const output = 'promo/output'
await fs.mkdir(generated, { recursive: true })
await fs.mkdir(output, { recursive: true })

const session = JSON.parse(await fs.readFile('promo/raw/raid-session.json', 'utf8'))
const markAt = label => session.marks.find(entry => entry.label === label)?.seconds
const marksLike = prefix => session.marks.filter(entry => entry.label.startsWith(prefix))
const sync = session.syncStartSeconds ?? 0
const bgm = 'public/assets/audio/battle/battle-theme.ogg'
const transition = 0.4
const audioStart = session.audioStartSeconds ?? 0
const hasAudio = await fs.access('promo/raw/raid-session-audio.webm').then(() => true, () => false)

function run(args, allowFailure = false) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpeg, ['-hide_banner', '-nostdin', '-y', ...args], { windowsHide: true })
    let err = ''
    proc.stderr.on('data', chunk => { err += chunk; if (err.length > 120000) err = err.slice(-90000) })
    proc.on('error', reject)
    proc.on('close', code => (code === 0 || allowFailure ? resolve(err) : reject(new Error(err.slice(-8000)))))
  })
}
async function duration(file) {
  const probe = await run(['-i', file], true)
  const match = probe.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/)
  if (!match) throw new Error(`Cannot read duration: ${file}`)
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
}

// Each scene names the capture mark it starts from. Lengths are promo pacing
// decisions; the footage underneath is the untouched recording.
const bossMark = markAt('scene:boss-stage')
const resultMark = markAt('scene:result') ?? markAt('scene:timeout')
// A raider whose Pokemon is down cannot answer, and the run then waits out the
// server's command timeout. Those stretches are dead footage, so no scene may
// start inside one.
const stalls = session.marks.filter(entry => /^(skip|stall|warn):/.test(entry.label)).map(entry => entry.seconds)
const clearOf = (at, length) => Number.isFinite(at) && !stalls.some(stall => stall > at - 1.5 && stall < at + length)
const commands = session.marks.filter(entry => entry.label.startsWith('command:alice')).map(entry => entry.seconds)
const turns = session.marks.filter(entry => entry.label.startsWith('turn:')).map(entry => entry.seconds)
const before = (list, limit) => list.filter(seconds => !Number.isFinite(limit) || seconds < limit)
const after = (list, limit) => list.filter(seconds => Number.isFinite(limit) && seconds >= limit)
const usable = (list, length) => list.filter(seconds => clearOf(seconds, length))

const preludeActions = usable(before(commands, bossMark), 13)
const bossActions = usable(after(commands, bossMark), 13)
// A raid turn resolves over a minute of attacks, far longer than the gap
// between marks, so the boss section is sampled at offsets into that
// resolution rather than at the next mark.
const sampleFrom = (base, offset) => (Number.isFinite(base) ? base + offset : undefined)
const bossSample = offset => sampleFrom(bossActions.at(-1) ?? bossMark, offset)
// The prelude's second turn is the long one: every raider is still standing
// and its resolution runs for a minute, so sample the fight from there.
const preludeSample = offset => sampleFrom(preludeActions[1] ?? preludeActions[0], offset)

const scenes = [
  { id: '01-boss', at: markAt('scene:boss-select'), length: 7,
    title: '협동 보스전', eyebrow: 'CO-OP BOSS RAID', description: '전설의 보스를 셋이서 공략한다.' },
  { id: '02-room', at: markAt('scene:room-list'), length: 8,
    title: '방을 만들고 모인다', eyebrow: 'RAID ROOM', description: '최대 3인. 빈자리는 AI 트레이너가 채운다.' },
  { id: '03-pick', at: markAt('scene:pokemon-picker'), length: 6,
    title: '출전은 단 한 마리', eyebrow: 'CHOOSE YOUR ACE', description: '각자 한 마리로 보스에 맞선다.' },
  { id: '04-ready', at: markAt('scene:room-join-charlie') ?? markAt('scene:room-two'), length: 7,
    title: '전원 준비 완료', eyebrow: 'READY', description: '세 명이 모두 준비하면 보스전이 열린다.' },
  { id: '05-open', at: markAt('scene:battle-open'), length: 9,
    title: '1단계 · 전초전', eyebrow: 'STAGE 1', description: '보스의 수하 세 마리가 먼저 가로막는다.' },
  { id: '06-prelude', at: preludeActions[0], length: 13, title: null },
  // One raid turn resolves over a minute of attacks, so the fight is sampled
  // along that resolution instead of at the next mark.
  { id: '07-prelude-mid', at: preludeSample(14), length: 13,
    title: '한 턴에 함께 움직인다', eyebrow: 'SIMULTANEOUS', description: '세 사람의 명령이 한 턴에 같이 해결된다.' },
  { id: '08-prelude-late', at: preludeSample(38), length: 12, title: null },
  { id: '09-boss', at: bossMark, length: 13,
    title: '2단계 · 본 보스전', eyebrow: 'FINAL BOSS', description: 'HP 1,704의 뮤츠. 45초 안에 명령을 낸다.' },
  // Describes what this stretch actually shows: a downed raider watching the
  // allies keep the fight going.
  { id: '10-boss-action', at: bossSample(13), length: 13,
    title: '쓰러져도 끝이 아니다', eyebrow: 'TEAM FIGHT', description: '남은 동료가 보스 공략을 이어간다.' },
].filter(scene => Number.isFinite(scene.at))

// Two scenes can resolve to the same moment when a stage ends in few turns.
for (let index = scenes.length - 1; index > 0; index--) {
  if (Math.abs(scenes[index].at - scenes[index - 1].at) < 3) scenes.splice(index, 1)
}

const endCard = session.outcome === 'won'
  ? { title: '보스 격파', eyebrow: 'VICTORY', description: 'pokemon-champions-area-web.co.kr' }
  : { title: '지금, 함께 도전한다', eyebrow: 'CO-OP BOSS RAID', description: 'pokemon-champions-area-web.co.kr' }
const endCardSeconds = 6

if (scenes.length < 6) throw new Error(`Capture marks are missing; only ${scenes.length} scenes resolved`)

const videoLength = await duration('promo/raw/raid-session.webm')
for (const scene of scenes) {
  const start = sync + scene.at
  scene.start = start
  scene.length = Math.max(4, Math.min(scene.length, videoLength - start - 0.2))
}
// Pace the cut to the promo target: a take with fewer usable turns holds each
// scene a little longer rather than producing a 40-second video.
const target = 96
const raw0 = scenes.reduce((seconds, scene) => seconds + scene.length, 0)
const scale = target / Math.max(1, raw0 - transition * (scenes.length - 1))
for (const scene of scenes) {
  const room = videoLength - scene.start - 0.2
  scene.length = Math.max(4.5, Math.min(20, scene.length * scale, room))
}
// Keep the cut moving forward: a scene that would replay the previous one is
// pushed to just after it, and dropped if that lands in a dead stretch.
for (let index = 1; index < scenes.length; index++) {
  const previousEnd = scenes[index - 1].at + scenes[index - 1].length
  if (scenes[index].at < previousEnd - 0.5) scenes[index].at = previousEnd
  scenes[index].start = sync + scenes[index].at
}
// Nothing may run into the defeat screen: the closing card, not the footage,
// states how the run ended.
const lastUsable = Number.isFinite(resultMark) ? resultMark - 1 : Infinity
for (let index = scenes.length - 1; index > 0; index--) {
  const scene = scenes[index]
  if (scene.at + scene.length > lastUsable) scene.length = lastUsable - scene.at
  if (scene.length < 4.5 || !clearOf(scene.at, scene.length) || scene.start + scene.length > videoLength - 0.2) scenes.splice(index, 1)
}
const total = scenes.reduce((seconds, scene) => seconds + scene.length, 0) - transition * (scenes.length - 1)
if (total < 55 || total > 130) throw new Error(`Edit length ${total.toFixed(1)}s is outside the 55–130s promo window`)

// Titles are rendered as transparent PNGs from a self-contained page so the
// edit needs no dev server.
const card = scene => `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>
  html,body{margin:0;width:1920px;height:1080px;background:transparent}
  /* The battle log and command deck own the bottom quarter of the screen, so
     the card sits above them, over the arena floor. */
  .card{position:absolute;left:92px;bottom:352px;max-width:1080px;display:flex;flex-direction:column;gap:12px;
    padding:26px 40px 30px;border-radius:20px;
    background:linear-gradient(105deg,rgba(6,13,28,.82) 0%,rgba(6,13,28,.58) 62%,rgba(6,13,28,0) 100%);
    font-family:"Malgun Gothic","Apple SD Gothic Neo",system-ui,sans-serif;color:#f6f9ff;
    text-shadow:0 4px 20px rgba(4,10,22,.9),0 1px 0 rgba(4,10,22,.9)}
  .eyebrow{display:flex;align-items:center;gap:14px;font-size:24px;letter-spacing:.32em;font-weight:700;color:#8fd8ff}
  .eyebrow::before{content:"";width:56px;height:5px;border-radius:3px;background:linear-gradient(90deg,#63e0ff,#3f7bff)}
  .title{font-size:74px;font-weight:800;letter-spacing:-.01em;line-height:1.05}
  .description{font-size:30px;font-weight:600;color:#dbe6ff;letter-spacing:-.01em}
</style></head><body><div class="card">
  <div class="eyebrow">${scene.eyebrow}</div>
  <div class="title">${scene.title}</div>
  <div class="description">${scene.description}</div>
</div></body></html>`

const titled = [...scenes.filter(scene => scene.title), { id: '99-end', ...endCard }]
const browser = await chromium.launch({ executablePath: await resolveChromiumExecutable(chromium), headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
  for (const scene of titled) {
    await page.setContent(card(scene), { waitUntil: 'load' })
    await page.evaluate(() => document.fonts.ready)
    const file = path.join(generated, `${scene.id}-title.png`)
    await page.screenshot({ path: file, omitBackground: true })
    scene.titleFile = file.replace(/\\/g, '/')
    if (scene.id === '99-end') endCard.titleFile = scene.titleFile
  }
} finally { await browser.close() }

const encoding = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', '30',
  '-video_track_timescale', '15360', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2']

// Cut one scene: picture from the take, effects from the tapped Web Audio, and
// the title fading in after the scene has settled.
for (const scene of scenes) {
  const args = ['-ss', String(scene.start), '-t', String(scene.length), '-i', 'promo/raw/raid-session.webm']
  // Effects were tapped from the moment the battle mounted, so a scene's audio
  // offset is measured from that point; earlier scenes simply have none.
  const audioOffset = scene.at - audioStart
  if (hasAudio && audioOffset >= 0) args.push('-ss', String(audioOffset), '-t', String(scene.length), '-i', 'promo/raw/raid-session-audio.webm')
  else args.push('-f', 'lavfi', '-t', String(scene.length), '-i', 'anullsrc=r=48000:cl=stereo')
  if (scene.titleFile) args.push('-framerate', '30', '-loop', '1', '-i', scene.titleFile)
  const fadeOut = Math.max(0, scene.length - 0.5)
  let filters = `[0:v]setpts=PTS-STARTPTS,fps=30,setsar=1,scale=1920:1080,eq=contrast=1.02:saturation=1.05[scene];`
  if (scene.titleFile) {
    const hold = Math.max(1.6, scene.length - 1.6)
    filters += `[2:v]format=rgba,fade=t=in:st=0.45:d=0.5:alpha=1,fade=t=out:st=${hold.toFixed(2)}:d=0.45:alpha=1[title];`
      + `[scene][title]overlay=0:0:format=auto,fade=t=in:st=0:d=0.3,fade=t=out:st=${fadeOut.toFixed(2)}:d=0.4[v]`
  } else {
    filters += `[scene]fade=t=in:st=0:d=0.3,fade=t=out:st=${fadeOut.toFixed(2)}:d=0.4[v]`
  }
  args.push('-filter_complex', filters, '-map', '[v]', '-map', '1:a:0',
    '-af', `asetpts=PTS-STARTPTS,apad,atrim=duration=${scene.length},afade=t=in:st=0:d=0.25,afade=t=out:st=${fadeOut.toFixed(2)}:d=0.4`,
    '-t', String(scene.length), ...encoding, `${generated}/${scene.id}.mp4`)
  await run(args)
  console.log(`cut ${scene.id}: ${scene.start.toFixed(2)}s +${scene.length.toFixed(1)}s${scene.title ? ` · ${scene.title}` : ''}`)
}

// The video ends on a still card rather than on footage an earlier scene has
// already shown.
const stillAt = sync + (bossMark ?? scenes.at(-1).at) + 2
await run(['-ss', String(stillAt), '-i', 'promo/raw/raid-session.webm', '-frames:v', '1', `${generated}/end-frame.png`])
await run(['-loop', '1', '-framerate', '30', '-t', String(endCardSeconds), '-i', `${generated}/end-frame.png`,
  '-framerate', '30', '-loop', '1', '-i', endCard.titleFile,
  '-f', 'lavfi', '-t', String(endCardSeconds), '-i', 'anullsrc=r=48000:cl=stereo',
  '-filter_complex',
  `[0:v]scale=1920:1080,setsar=1,eq=brightness=-0.16:saturation=0.72,gblur=sigma=6[back];`
  + `[1:v]format=rgba,fade=t=in:st=0.35:d=0.55:alpha=1[card];`
  + `[back][card]overlay=0:0:format=auto,fps=30,fade=t=in:st=0:d=0.4,fade=t=out:st=${(endCardSeconds - 1).toFixed(2)}:d=1[v]`,
  '-map', '[v]', '-map', '2:a:0', '-t', String(endCardSeconds), ...encoding, `${generated}/99-end.mp4`])
scenes.push({ id: '99-end', length: endCardSeconds, title: endCard.title })
console.log(`cut 99-end: still card · ${endCard.title}`)

// Dissolve the scenes together in one graph so the transitions land on frames.
const inputs = scenes.flatMap(scene => ['-i', `${generated}/${scene.id}.mp4`])
let graph = ''
let previous = '0:v'
let previousAudio = '0:a'
let offset = scenes[0].length - transition
for (let index = 1; index < scenes.length; index++) {
  const label = `v${index}`
  const audioLabel = `a${index}`
  graph += `[${previous}][${index}:v]xfade=transition=fade:duration=${transition}:offset=${offset.toFixed(3)}[${label}];`
  graph += `[${previousAudio}][${index}:a]acrossfade=d=${transition}:c1=tri:c2=tri[${audioLabel}];`
  previous = label
  previousAudio = audioLabel
  if (index < scenes.length - 1) offset += scenes[index].length - transition
}
graph += `[${previous}]format=yuv420p[vout];[${previousAudio}]anull[aout]`
await run([...inputs, '-filter_complex', graph, '-map', '[vout]', '-map', '[aout]', ...encoding, `${generated}/picture-lock.mp4`])
const lockLength = await duration(`${generated}/picture-lock.mp4`)
console.log(`picture lock: ${lockLength.toFixed(2)}s`)

// Music sits under the captured effects and ducks whenever the battle speaks.
const finalFile = `${output}/champions-arena-raid-1080p.mp4`
const musicFade = Math.max(0, lockLength - 2.4)
await run(['-i', `${generated}/picture-lock.mp4`, '-i', bgm,
  '-filter_complex',
  `[1:a]atrim=duration=${lockLength},asetpts=PTS-STARTPTS,volume=0.42,afade=t=in:st=0:d=1.2,afade=t=out:st=${musicFade.toFixed(2)}:d=2.2[music];`
  // The effects feed both the mix and the ducking key, and an ffmpeg label can
  // only be consumed once, so split it.
  + `[0:a]asetpts=PTS-STARTPTS,volume=1.25,asplit=2[sfxmix][sfxkey];`
  + `[music][sfxkey]sidechaincompress=threshold=0.05:ratio=6:attack=12:release=420[ducked];`
  + `[ducked][sfxmix]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.97,loudnorm=I=-16:TP=-1.5:LRA=11[aout]`,
  '-map', '0:v:0', '-map', '[aout]', '-t', String(lockLength), ...encoding, '-movflags', '+faststart', finalFile])

const finalLength = await duration(finalFile)
await run(['-ss', String(Math.min(finalLength - 1, (markAt('scene:boss-stage') ? 0 : 0) + 62)), '-i', finalFile, '-frames:v', '1', '-q:v', '2', `${output}/champions-arena-raid-poster.jpg`])
await fs.writeFile(`${output}/champions-arena-raid-credits.txt`, [
  'Pokémon Champions Arena · 협동 보스전 소개 영상',
  '',
  '게임 화면: 실제 협동 보스전(코옵 레이드)을 로컬 레이드 서버로 진행하며 촬영했습니다.',
  '배틀 결과·HP·턴 순서·기믹은 모두 실제 게임 엔진의 계산입니다.',
  '',
  '음악: Spring Spring, "Face The Champion!" (https://opengameart.org/content/face-the-champion)',
  '라이선스: CC BY 3.0 (https://creativecommons.org/licenses/by/3.0/)',
  '편집: 길이에 맞춰 발췌하고 페이드인·페이드아웃과 효과음 기준 더킹을 적용했습니다.',
  '',
  '비공식 팬메이드 프로젝트이며 Nintendo·Creatures·GAME FREAK와 관련이 없습니다.',
].join('\n'), 'utf8')

const report = {
  source: 'promo/raw/raid-session.webm',
  syncStartSeconds: sync,
  scenes: scenes.map(({ id, start, length, title }) => ({ id, ...(Number.isFinite(start) ? { start: Number(start.toFixed(2)) } : {}), length: Number(length.toFixed(2)), title })),
  pictureLockSeconds: Number(lockLength.toFixed(2)),
  finalSeconds: Number(finalLength.toFixed(2)),
  output: finalFile,
}
await fs.writeFile(`${output}/champions-arena-raid.json`, JSON.stringify(report, null, 2))
console.log(`\nfinal: ${finalFile} (${finalLength.toFixed(2)}s)`)
