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
const heroCaption = document.querySelector('.hero-caption')
const titleWords = [], descriptionWords = []
const errors = [], loadedIds = new Set(), playedIds = new Set(), shownIds = new Set()
let tiles = [], peakVisibleCount = 0, openingVisibleCount = 0, playing = false, currentTime = 0, startedAt = 0, frameId = null

function fitStage() {
  stage.style.transform = `scale(${Math.min(innerWidth / 1920,innerHeight / 1080)})`
}
fitStage()
addEventListener('resize',fitStage)
const clamp = value => Math.max(0,Math.min(1,value))
const easeOut = value => 1 - (1 - clamp(value)) ** 3
const smooth = value => { const p = clamp(value); return p * p * (3 - 2 * p) }
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
  video.setAttribute('aria-label',`${data.pokemonName} · ${data.moveName}`)
  const caption = document.createElement('figcaption'); caption.className = 'tile-caption'
  const copy = document.createElement('span'); copy.className = 'tile-copy'
  const name = document.createElement('strong'); name.className = 'tile-name'; name.textContent = data.pokemonName
  const move = document.createElement('span'); move.className = 'tile-move'; move.textContent = data.moveName
  copy.append(name,move)
  const [typeLabel,typeColor] = typeInfo(data.type)
  const type = document.createElement('span'); type.className = 'type-badge'; type.textContent = typeLabel
  figure.style.setProperty('--type-color',typeColor)
  caption.append(copy,type); figure.append(video,caption)
  // The first manifest clip is the opening hero, placed in the center cell.
  const position = index === 0 ? 4 : index <= 4 ? index - 1 : index
  figure.style.gridColumn = String(position % 3 + 1)
  figure.style.gridRow = String(Math.floor(position / 3) + 1)
  grid.append(figure)
  const delay = index === 0 ? 0 : 2.05 + (index - 1) * .25
  return { ...data,index,figure,video,caption,delay,hasStarted:false,playPending:false }
}
function recordVisibility() {
  const bounds = viewport.getBoundingClientRect()
  let visible = 0
  for (const tile of tiles) {
    const rect = tile.figure.getBoundingClientRect()
    const width = Math.max(0,Math.min(rect.right,bounds.right) - Math.max(rect.left,bounds.left))
    const height = Math.max(0,Math.min(rect.bottom,bounds.bottom) - Math.max(rect.top,bounds.top))
    if (width * height >= rect.width * rect.height * .75 && tile.video.readyState >= 2) {
      shownIds.add(tile.id); visible++
    }
  }
  peakVisibleCount = Math.max(peakVisibleCount,visible)
  return visible
}
function render(time) {
  currentTime = Math.max(0,Math.min(DURATION,time))
  // A gentle camera move takes three seconds; all nine scenes then stay readable.
  const reveal = smooth(progress(currentTime,2,3))
  grid.style.transform = `scale(${3.05 - 2.05 * reveal})`
  const captionAlpha = easeOut(progress(currentTime,4.2,.8))
  // Reserve a separate caption rail once the wall opens; battle sprites near
  // the bottom of the original footage remain completely unobstructed.
  grid.style.setProperty('--caption-height',`${36 * captionAlpha}px`)
  for (const tile of tiles) tile.caption.style.opacity = String(captionAlpha)
  const heroIn = easeOut(progress(currentTime,.12,.45))
  const heroOut = 1 - smooth(progress(currentTime,3.05,.9))
  heroCaption.style.opacity = String(heroIn * heroOut)
  heroCaption.style.transform = `translateY(${(1 - heroIn) * 20}px)`
  titleWords.forEach((word,index) => {
    const enter = easeOut(progress(currentTime,.22 + index * .08,.65))
    word.style.opacity = String(clamp(enter * 2))
    word.style.transform = `translateY(${(1 - enter) * 108}%) rotate(${(1 - enter) * 4}deg)`
    word.style.backgroundPosition = `${150 - 270 * progress(currentTime,1.25,1.2)}% 0`
  })
  descriptionWords.forEach((word,index) => {
    const enter = easeOut(progress(currentTime,.7 + index * .035,.48))
    word.style.opacity = String(enter)
    word.style.transform = `translateY(${(1 - enter) * 105}%)`
  })
  document.querySelector('.bottom-streak').style.transform = `translateX(${-65 + currentTime / DURATION * 140}%)`
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
  document.querySelector('.gimmick-label').textContent = scene.label
  wordsInto(document.querySelector('.headline-base'),scene.title,titleWords)
  wordsInto(document.querySelector('.headline-emphasis'),scene.emphasis,titleWords)
  const species = new Set(group.tiles.map(tile => tile.pokemonName)).size
  const moves = new Set(group.tiles.map(tile => tile.moveName)).size
  const types = new Set(group.tiles.map(tile => tile.type)).size
  wordsInto(document.querySelector('.description'),`${species}마리의 포켓몬 · ${moves}가지 기술 · ${types}가지 타입. 같은 기믹, 서로 다른 승부.`,descriptionWords)
  const hero = group.tiles[0]
  document.querySelector('.hero-name').textContent = hero.pokemonName
  document.querySelector('.hero-move').textContent = `${hero.moveName} · ${typeInfo(hero.type)[0]}`
  tiles = group.tiles.map(buildTile)
  render(0)
  await Promise.all([document.fonts.ready,...tiles.map(tile => preload(tile.video,tile.id))])
  for (const tile of tiles) {
    if (tile.video.duration + .1 < tile.duration) throw new Error(`Gimmick clip is shorter than its metadata: ${tile.id}`)
  }
  render(0)
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
