const SCENES = Object.freeze({ intro: 4, rooms: 6, outro: 8 })
const requested = new URLSearchParams(location.search).get('scene') || 'intro'
if (!(requested in SCENES)) throw new Error(`Unknown room motion scene: ${requested}`)
const sceneId = requested
const duration = SCENES[sceneId]
const stage = document.querySelector('#stage')
const content = document.querySelector('#content')
stage.classList.add(sceneId)
const logo = '<img class="brand-logo" src="/assets/brand/champions-arena-emblem.png" alt="Champions Arena 로고">'
const brand = `<div class="brand">${logo}<h1 class="brand-name"><span class="brand-pokemon">POKÉMON</span><span class="brand-arena">CHAMPIONS ARENA</span></h1></div>`
const arrow = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12h16m-7-7 7 7-7 7"/></svg>'
if (sceneId === 'intro') content.innerHTML = brand
if (sceneId === 'outro') content.innerHTML = `${brand}<p class="outro-tagline">친구들과, 지금 대전방으로</p><a class="outro-url" href="https://pokemon-champions-area-web.co.kr"><span>pokemon-champions-area-web.co.kr</span>${arrow}</a>`
if (sceneId === 'rooms') {
  content.innerHTML = `<div class="rooms-copy"><h1 class="rooms-title">대전<span class="highlight">방</span></h1><p class="rooms-tagline">친구들과, 우리만의 대회</p><div class="rooms-rule"></div></div><div class="room-capacity"><div class="capacity-card"><b>최대</b><strong>10</strong><span>개의 방</span></div><i>×</i><div class="capacity-card"><b>방마다 최대</b><strong>4</strong><span>명의 트레이너</span></div></div><div class="competition-path"><span>토너먼트</span><i></i><span>리그전</span></div>`
}

document.querySelector('.arena-structure').innerHTML = Array.from({ length: 10 }, (_, i) => `<i style="top:${i * 164}px"></i>`).join('')
const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value))
const easeOut = value => 1 - (1 - clamp(value)) ** 3
const q = selector => content.querySelector(selector)
const qa = selector => [...content.querySelectorAll(selector)]
const backdrop = document.querySelector('.backdrop')
const light = document.querySelector('.arena-light')
const floorLines = [...document.querySelectorAll('.floor-line')]
const canvas = document.querySelector('.atmosphere')
const ctx = canvas.getContext('2d')
function splitWords(element) {
  if (!element) return []
  const result = []
  for (const child of [...element.childNodes]) {
    if (child.nodeType === Node.ELEMENT_NODE) { result.push(...splitWords(child)); continue }
    const fragment = document.createDocumentFragment()
    for (const token of child.textContent.split(/(\s+)/)) {
      if (!token.trim()) { fragment.append(document.createTextNode(token)); continue }
      const span = document.createElement('span')
      span.className = 'word'; span.textContent = token; fragment.append(span); result.push(span)
    }
    child.replaceWith(fragment)
  }
  return result
}
const titleWords = splitWords(q('.rooms-title,.outro-tagline'))
const subtitleWords = splitWords(q('.rooms-tagline'))
function reveal(node, time, start = .2, length = .8, { x = 0, y = 35, scale = 1, blur = 0, base = '' } = {}) {
  if (!node) return
  const p = easeOut((time - start) / length)
  node.style.opacity = String(p)
  node.style.transform = `${base} translate3d(${x * (1 - p)}px,${y * (1 - p)}px,0) scale(${scale + (1 - scale) * p})`
  node.style.filter = blur && p < 1 ? `blur(${blur * (1 - p)}px)` : 'none'
}
function revealWords(nodes, time, start, y = 46) {
  nodes.forEach((node, i) => reveal(node, time, start + i * .13, .82, { y, blur: 5 }))
}
function particles(time) {
  ctx.clearRect(0, 0, 1920, 1080)
  for (let i = 0; i < 42; i++) {
    const x = (i * 439 + 65 + time * (2 + i % 3)) % 1980 - 30
    const y = ((i * 223 + 1230 - time * (13 + i % 9)) % 1230 + 1230) % 1230 - 75
    const edge = clamp(Math.min(y + 75, 1155 - y) / 110)
    ctx.fillStyle = i % 4 === 0 ? `rgba(255,218,132,${.36 * edge})` : `rgba(162,237,255,${.23 * edge})`
    ctx.beginPath(); ctx.arc(x, y, i % 5 === 0 ? 2.3 : 1.3, 0, Math.PI * 2); ctx.fill()
  }
}
function seek(value) {
  const time = clamp(Number(value) || 0, 0, duration + .75)
  const progress = time / duration
  backdrop.style.transform = 'none'
  light.style.transform = `translate3d(${-progress * 95}px,0,0) rotate(20deg)`
  floorLines.forEach((node, i) => { node.style.transform = `translateY(${-progress * (14 + i * 10)}px) rotate(-10deg)` })
  particles(time)
  if (sceneId === 'intro' || sceneId === 'outro') {
    reveal(q('.brand-logo'), time, .06, 1.13, { y: 27, scale: .9 })
    q('.brand-logo').style.filter = 'drop-shadow(0 18px 30px #0008) drop-shadow(0 0 42px #47bfff32)'
    reveal(q('.brand-pokemon'), time, .3, .84, { y: 28, blur: 4 })
    reveal(q('.brand-arena'), time, .48, .92, { y: 42, blur: 5 })
  }
  if (sceneId === 'rooms') {
    revealWords(titleWords, time, .15, 56)
    revealWords(subtitleWords, time, .52, 30)
    const rule = easeOut((time - .7) / .75)
    q('.rooms-rule').style.transform = `scaleX(${rule})`
    q('.rooms-rule').style.opacity = String(rule)
    qa('.capacity-card').forEach((node, index) => reveal(node, time, .65 + index * .18, .85, { y: 38, scale: .98 }))
    reveal(q('.room-capacity > i'), time, 1.05, .6, { y: 10 })
    reveal(q('.competition-path'), time, 1.2, .75, { y: 22 })
  }
  if (sceneId === 'outro') {
    revealWords(titleWords, time, 1.03, 47)
    reveal(q('.outro-url'), time, 1.55, .88, { y: 31, scale: .98, base: 'translateX(-50%)' })
  }
  return { sceneId, time, duration }
}
const imagesReady = Promise.all([...document.images].map(image => image.decode()))
const backgroundReady = new Promise((resolve, reject) => {
  const image = new Image()
  image.onload = resolve
  image.onerror = () => reject(new Error('Lobby banner failed to load'))
  image.src = '/assets/champions-lobby-bg.jpg'
})
window.updateMotion = {
  ready: Promise.all([document.fonts.ready, imagesReady, backgroundReady]).then(() => { seek(0); return { sceneId, duration, width: 1920, height: 1080 } }),
  seek,
  status() {
    return { sceneId, duration, visibleText: document.body.innerText.trim().split(/\n+/).filter(Boolean), brokenImages: [...document.images].filter(image => !image.complete || !image.naturalWidth).map(image => image.src), animations: document.getAnimations().length }
  },
}
