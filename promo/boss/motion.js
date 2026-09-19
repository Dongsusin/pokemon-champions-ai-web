const SCENES = Object.freeze({ intro: 5, boss: 7, outro: 9 })
const requested = new URLSearchParams(location.search).get('scene') || 'intro'
if (!(requested in SCENES)) throw new Error(`Unknown boss motion scene: ${requested}`)
const sceneId = requested
const duration = SCENES[sceneId]
const stage = document.querySelector('#stage')
const content = document.querySelector('#content')
stage.classList.add(sceneId)
const logo = '<img class="brand-logo" src="/assets/brand/champions-arena-emblem.png" alt="Champions Arena 로고">'
const brand = `<div class="brand">${logo}<h1 class="brand-name"><span class="brand-pokemon">POKÉMON</span><span class="brand-arena">CHAMPIONS ARENA</span></h1></div>`
const arrow = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12h16m-7-7 7 7-7 7"/></svg>'
if (sceneId === 'intro') content.innerHTML = brand
if (sceneId === 'outro') content.innerHTML = `${brand}<p class="outro-tagline">전설에 도전하세요</p><a class="outro-url" href="https://pokemon-champions-area-web.co.kr"><span>pokemon-champions-area-web.co.kr</span>${arrow}</a>`
if (sceneId === 'boss') {
  const pokemon = [{ id: 150, key: 'mewtwo', name: '뮤츠' }, { id: 250, key: 'hooh', name: '칠색조' }, { id: 249, key: 'lugia', name: '루기아' }]
  content.innerHTML = `<div class="boss-copy"><h1 class="boss-title">보스<span class="highlight">전</span></h1><p class="boss-tagline">세 개의 전설. 세 번의 승부.</p><div class="boss-rule"></div></div><div class="legend-trio">${pokemon.map(entry => `<div class="legend ${entry.key}"><div class="legend-environment"></div><div class="legend-aura"></div><div class="legend-platform"></div><img class="legend-art" src="/promo/boss/assets/pokemon-${entry.id}.png" alt="${entry.name}"></div>`).join('')}</div>`
}
const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value))
const easeOut = value => 1 - (1 - clamp(value)) ** 3
const q = selector => content.querySelector(selector)
const qa = selector => [...content.querySelectorAll(selector)]
const backdrop = document.querySelector('.backdrop')
const orbits = [...document.querySelectorAll('.orbit')]
const horizon = document.querySelector('.horizon')
const ctx = document.querySelector('.atmosphere').getContext('2d')
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
const titleWords = splitWords(q('.boss-title,.outro-tagline'))
const subtitleWords = splitWords(q('.boss-tagline'))
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
  for (let i = 0; i < 54; i++) {
    const x = (i * 439 + 65 + time * (3 + i % 3)) % 1980 - 30
    const y = ((i * 223 + 1230 - time * (11 + i % 9)) % 1230 + 1230) % 1230 - 75
    const edge = clamp(Math.min(y + 75, 1155 - y) / 110)
    const alpha = edge * (.22 + .12 * Math.sin(time * .6 + i) ** 2)
    ctx.fillStyle = i % 3 === 0 ? `rgba(255,222,153,${alpha})` : i % 3 === 1 ? `rgba(188,157,255,${alpha})` : `rgba(167,233,255,${alpha})`
    ctx.beginPath(); ctx.arc(x, y, i % 6 === 0 ? 2.4 : 1.3, 0, Math.PI * 2); ctx.fill()
  }
}
function seek(value) {
  const time = clamp(Number(value) || 0, 0, duration + .75)
  const progress = time / duration
  backdrop.style.transform = `scale(${1.026 + progress * .022}) translate3d(${-progress * 10}px,${progress * 5}px,0)`
  orbits.forEach((node, i) => { node.style.transform = `rotate(${(i ? -1 : 1) * (24 + progress * 16)}deg) scale(${1 + progress * .025})` })
  horizon.style.transform = `translateY(${-progress * 14}px)`
  particles(time)
  if (sceneId === 'intro' || sceneId === 'outro') {
    reveal(q('.brand-logo'), time, .06, 1.13, { y: 27, scale: .9 })
    q('.brand-logo').style.filter = 'drop-shadow(0 18px 30px #0008) drop-shadow(0 0 42px #b891ff40)'
    reveal(q('.brand-pokemon'), time, .3, .84, { y: 28, blur: 4 })
    reveal(q('.brand-arena'), time, .48, .92, { y: 42, blur: 5 })
  }
  if (sceneId === 'boss') {
    revealWords(titleWords, time, .16, 52)
    revealWords(subtitleWords, time, .62, 31)
    const rule = easeOut((time - .85) / .9)
    q('.boss-rule').style.transform = `scaleX(${rule})`
    q('.boss-rule').style.opacity = String(rule)
    qa('.legend').forEach((node, index) => {
      reveal(node, time, .38 + index * .2, 1.02, { x: (1 - index) * 35, y: 60, scale: .91 })
      const settled = easeOut((time - 1.4 - index * .2) / .8)
      node.querySelector('.legend-art').style.transform = `translateY(${-Math.sin(time * .72 + index * .8) * 5 * settled}px) scale(${1 + progress * .022})`
      node.querySelector('.legend-aura').style.opacity = String(.8 + .2 * Math.sin(time * .65 + index) ** 2)
    })
  }
  if (sceneId === 'outro') {
    revealWords(titleWords, time, 1.03, 47)
    reveal(q('.outro-url'), time, 1.55, .88, { y: 31, scale: .98, base: 'translateX(-50%)' })
  }
  return { sceneId, time, duration }
}
const imagesReady = Promise.all([...document.images].map(image => image.decode()))
const backgroundPaths = ['/assets/boss-backgrounds/mewtwo-round-3.webp', ...(sceneId === 'boss' ? ['/assets/boss-backgrounds/hooh-round-1.webp', '/assets/boss-backgrounds/lugia-round-1.webp'] : [])]
const backgroundsReady = Promise.all(backgroundPaths.map(src => new Promise((resolve, reject) => {
  const image = new Image()
  image.onload = resolve
  image.onerror = () => reject(new Error(`Boss background failed to load: ${src}`))
  image.src = src
})))
window.updateMotion = {
  ready: Promise.all([document.fonts.ready, imagesReady, backgroundsReady]).then(() => { seek(0); return { sceneId, duration, width: 1920, height: 1080 } }),
  seek,
  status() {
    return { sceneId, duration, visibleText: document.body.innerText.trim().split(/\n+/).filter(Boolean), brokenImages: [...document.images].filter(image => !image.complete || !image.naturalWidth).map(image => image.src), animations: document.getAnimations().length }
  },
}
