const DURATION = 12
const GROUPS = {
  mega: {label:'MEGA EVOLUTION',title:'메가진화.',emphasis:'잠재력을 깨워라.',accent:'#c1b1ff'},
  zmove: {label:'Z-MOVE',title:'Z기술.',emphasis:'한 방에 뒤집어라.',accent:'#ffd77b'},
  dynamax: {label:'GIGANTAMAX',title:'거다이맥스.',emphasis:'전장을 압도하라.',accent:'#ff9fc6'},
  tera: {label:'TERASTALLIZATION',title:'테라스탈.',emphasis:'상성을 뒤집어라.',accent:'#9aeff2'},
}
const TYPES = {
  normal:['노말','#a8a77a'],fire:['불꽃','#ee8130'],water:['물','#6390f0'],electric:['전기','#f7d02c'],
  grass:['풀','#7ac74c'],ice:['얼음','#96d9d6'],fighting:['격투','#c22e28'],poison:['독','#a33ea1'],
  ground:['땅','#e2bf65'],flying:['비행','#a98ff3'],psychic:['에스퍼','#f95587'],bug:['벌레','#a6b91a'],
  rock:['바위','#b6a136'],ghost:['고스트','#735797'],dragon:['드래곤','#6f35fc'],dark:['악','#705746'],
  steel:['강철','#b7b7ce'],fairy:['페어리','#d685ad'],
}
const sceneId = new URLSearchParams(location.search).get('scene') || 'mega'
const scene = GROUPS[sceneId]
const stage = document.querySelector('#gimmick-wall')
const grid = document.querySelector('.video-grid')
const viewport = document.querySelector('.wall-viewport')
const titleWords = []
const errors = [], loadedIds = new Set(), playedIds = new Set(), shownIds = new Set()
let tiles = [], peakVisibleCount = 0, openingVisibleCount = 0, playing = false, currentTime = 0, startedAt = 0, frameId = null

function fitStage() {
  stage.style.transform = `scale(${Math.min(innerWidth / 1920,innerHeight / 1080)})`
}
fitStage()
addEventListener('resize',fitStage)
const clamp = value => Math.max(0,Math.min(1,value))
const easeOut = value => 1 - (1 - clamp(value)) ** 3
const smooth = value => { const p = clamp(value); return p * p * p * (p * (p * 6 - 15) + 10) }
const progress = (time,start,duration) => clamp((time - start) / duration)
function fail(error) {
  const message = error instanceof Error ? error.message : String(error)
  if (!errors.includes(message)) errors.push(message)
  const notice = document.querySelector('.load-error')
  notice.textContent = `기믹 영상 준비에 실패했습니다. ${message}`
  notice.hidden = false
}
function wordsInto(element,text,collection) {
  for (const token of text.split(/(\s+)/)) {
    if (!token.trim()) { element.append(document.createTextNode(token)); continue }
    const clip = document.createElement('span'); clip.className = 'word-clip'
    const word = document.createElement('span'); word.className = 'word'; word.textContent = token
    clip.append(word); element.append(clip); collection.push(word)
  }
}
function typeInfo(type) {
  const value = String(type || '')
  const info = TYPES[value.toLowerCase()] || Object.values(TYPES).find(([name]) => name === value)
  return info || [value || '배틀','#8faeca']
}
function preload(video,id) {
  return new Promise((resolve,reject) => {
    const finish = error => {
      clearTimeout(timeout)
      video.removeEventListener('canplay',onReady)
      video.removeEventListener('error',onError)
      if (error) reject(error)
      else { loadedIds.add(id); resolve() }
    }
    const onReady = () => {
      if (video.readyState >= 3 && video.videoWidth > 0 && video.videoHeight > 0) finish()
    }
    const onError = () => finish(new Error(`Cannot load ${id}: ${video.error?.message || video.currentSrc}`))
    const timeout = setTimeout(() => finish(new Error(`Video preload timed out: ${id}`)),60000)
    video.addEventListener('canplay',onReady)
    video.addEventListener('error',onError)
    video.load()
    onReady()
  })
}
function buildTile(data,index) {
  const figure = document.createElement('figure')
  figure.className = `battle-tile${index === 0 ? ' is-hero' : ''}`
  figure.dataset.clipId = data.id
  const video = document.createElement('video')
  video.muted = true; video.defaultMuted = true; video.playsInline = true; video.preload = 'auto'
  video.setAttribute('muted',''); video.setAttribute('playsinline','')
  video.src = data.url
  video.setAttribute('aria-label',`${data.pokemonName} · ${data.moveName} · ${typeInfo(data.type)[0]} 타입 · ${scene.label}`)
  figure.append(video)
  // The first manifest clip is the opening hero, placed in the center cell.
  const position = index === 0 ? 4 : index <= 4 ? index - 1 : index
  figure.style.gridColumn = String(position % 3 + 1)
  figure.style.gridRow = String(Math.floor(position / 3) + 1)
  grid.append(figure)
  // Neighbouring battles arrive first, then the four corners complete the wall.
  const revealOrder = [3,1,5,7,0,2,6,8].indexOf(position)
  const delay = index === 0 ? 0 : 1.55 + revealOrder * .27
  return { ...data,index,position,figure,video,delay,revealAlpha:index === 0 ? 1 : 0,hasStarted:false,playPending:false }
}
function recordVisibility() {
  const bounds = viewport.getBoundingClientRect()
  let visible = 0
  for (const tile of tiles) {
    const rect = tile.figure.getBoundingClientRect()
    const width = Math.max(0,Math.min(rect.right,bounds.right) - Math.max(rect.left,bounds.left))
    const height = Math.max(0,Math.min(rect.bottom,bounds.bottom) - Math.max(rect.top,bounds.top))
    if (width * height >= rect.width * rect.height * .75 && tile.revealAlpha >= .95 && tile.video.readyState >= 2) {
      shownIds.add(tile.id); visible++
    }
  }
  peakVisibleCount = Math.max(peakVisibleCount,visible)
  return visible
}
function render(time) {
  currentTime = Math.max(0,Math.min(DURATION,time))
  // A held hero shot opens into the wall with zero velocity at both ends.
  // The final small settle keeps the composition alive without a new cut.
  const reveal = smooth(progress(currentTime,1.2,5.6))
  const settle = smooth(progress(currentTime,6.8,5.2))
  grid.style.transform = `scale(${3.1 - 2.082 * reveal - .018 * settle})`
  for (const tile of tiles) {
    const enter = tile.index === 0 ? 1 : smooth(progress(currentTime,tile.delay,1.05))
    const column = tile.position % 3 - 1
    const row = Math.floor(tile.position / 3) - 1
    tile.revealAlpha = enter
    tile.figure.style.opacity = String(enter)
    tile.figure.style.transform = `translate3d(${column * (1 - enter) * 10}px,${row * (1 - enter) * 10}px,0) scale(${.975 + .025 * enter})`
  }
  titleWords.forEach((word,index) => {
    const enter = easeOut(progress(currentTime,.14 + index * .13,.9))
    word.style.opacity = String(enter)
    word.style.transform = `translate3d(0,${(1 - enter) * 104}%,0)`
  })
  recordVisibility()
}
function startVideo(tile) {
  if (tile.hasStarted || tile.playPending) return
  tile.playPending = true
  tile.video.play().then(() => {
    tile.hasStarted = true; tile.playPending = false; playedIds.add(tile.id)
    if (!playing) tile.video.pause()
  }).catch(error => { tile.playPending = false; fail(new Error(`Video playback failed for ${tile.id}: ${error.message}`)) })
}
function tick(now) {
  if (!playing) return
  const time = Math.min(DURATION,(now - startedAt) / 1000)
  render(time)
  for (const tile of tiles) if (time >= tile.delay) startVideo(tile)
  if (time >= DURATION) {
    // Hold the completed composition until the capture calls stop(). Keeping the
    // session active matches the other promo scenes during their capture tail.
    tiles.forEach(tile => tile.video.pause()); frameId = null
  } else frameId = requestAnimationFrame(tick)
}
async function seekVideo(tile,time) {
  const maxTime = Math.max(0,Math.min(tile.duration, tile.video.duration) - .05)
  const target = Math.min(maxTime,Math.max(0,time - tile.delay))
  tile.video.pause(); tile.hasStarted = false; tile.playPending = false
  if (Math.abs(tile.video.currentTime - target) < .015 && !tile.video.seeking) return
  await new Promise((resolve,reject) => {
    const finish = error => { clearTimeout(timeout); tile.video.removeEventListener('seeked',onSeek); error ? reject(error) : resolve() }
    const onSeek = () => finish()
    const timeout = setTimeout(() => finish(new Error(`Video seek timed out: ${tile.id}`)),15000)
    tile.video.addEventListener('seeked',onSeek,{once:true})
    tile.video.currentTime = target
  })
}
const ready = (async () => {
  if (!scene) throw new Error(`Unknown gimmick scene: ${sceneId}`)
  const response = await fetch('/promo/generated/gimmick-clips.json')
  if (!response.ok) throw new Error(`Missing gimmick clip manifest: HTTP ${response.status}`)
  const manifest = await response.json()
  const group = manifest.groups?.[sceneId]
  if (!group || !Array.isArray(group.tiles) || group.tiles.length !== 9) throw new Error(`${sceneId} requires exactly nine real battle clips`)
  if (new Set(group.tiles.map(tile => tile.id)).size !== 9) throw new Error(`${sceneId} contains duplicate clip IDs`)
  for (const tile of group.tiles) {
    if (!tile.id || !tile.pokemonName || !tile.moveName || !tile.type || !tile.url || !Number.isFinite(tile.duration) || tile.duration <= 0) throw new Error(`Incomplete gimmick clip metadata: ${tile.id || 'unknown'}`)
  }
  stage.style.setProperty('--accent',group.accent || scene.accent)
  wordsInto(document.querySelector('.headline-base'),scene.title,titleWords)
  wordsInto(document.querySelector('.headline-emphasis'),scene.emphasis,titleWords)
  tiles = group.tiles.map(buildTile)
  render(0)
  await Promise.all([document.fonts.ready,...tiles.map(tile => preload(tile.video,tile.id))])
  for (const tile of tiles) {
    if (tile.video.duration + .1 < tile.duration) throw new Error(`Gimmick clip is shorter than its metadata: ${tile.id}`)
  }
  render(0)
  openingVisibleCount = recordVisibility()
})()
// Keep the error visible and collect it in status while preserving rejection for capture callers.
ready.catch(fail)
window.promoWall = {
  ready,
  async play() {
    await ready
    this.stop()
    await Promise.all(tiles.map(tile => seekVideo(tile,0)))
    playedIds.clear(); shownIds.clear(); peakVisibleCount = 0
    playing = true; startedAt = performance.now(); render(0)
    openingVisibleCount = recordVisibility()
    startVideo(tiles[0]); frameId = requestAnimationFrame(tick)
  },
  stop() {
    playing = false
    if (frameId != null) cancelAnimationFrame(frameId)
    frameId = null
    tiles.forEach(tile => tile.video.pause())
  },
  async setTime(time) {
    await ready
    if (!Number.isFinite(time)) throw new Error('Wall seek time must be finite')
    this.stop()
    await Promise.all(tiles.map(tile => seekVideo(tile,Math.max(0,Math.min(DURATION,time)))))
    render(time)
  },
  status() {
    const visibleCount = recordVisibility()
    return {
      sceneId,duration:DURATION,currentTime,playing,totalCount:tiles.length,
      loadedCount:loadedIds.size,playedCount:playedIds.size,shownCount:shownIds.size,
      visibleCount,openingVisibleCount,peakVisibleCount,completed:currentTime >= DURATION,
      clipIds:tiles.map(tile => tile.id),pokemonNames:tiles.map(tile => tile.pokemonName),
      moveNames:tiles.map(tile => tile.moveName),types:tiles.map(tile => tile.type),
      videos:tiles.map(tile => ({id:tile.id,currentTime:tile.video.currentTime,readyState:tile.video.readyState,started:tile.hasStarted,delay:tile.delay})),
      errors:[...errors],
    }
  },
}
if (new URLSearchParams(location.search).has('autoplay')) ready.then(() => window.promoWall.play()).catch(fail)
addEventListener('pagehide',() => window.promoWall.stop(),{once:true})
