import { BATTLE_ITEMS } from '../src/data/shopData.js'
import { TRAINERS } from '../src/data/trainerTeams.js'
import { getTrainerSpriteCandidates } from '../src/data/trainerSprites.js'
import { NATIONAL_DEX } from '../src/data/trainingData.js'
import { ACHIEVEMENTS } from '../src/data/achievementData.js'

const SCENES = {
  pokemon: {duration:12,accent:'#a6f6da',copy:[
    {title:'당신의 파트너. <em>가능성은 끝없이.</em>'},
    {title:`<em>${NATIONAL_DEX.length.toLocaleString('ko-KR')}종</em>의 포켓몬. 나만의 드림팀.`},
  ]},
  trainers: {duration:14,accent:'#b2e9ff',copy:[
    {title:`<em>${TRAINERS.length}명</em>의 AI 트레이너.`},
    {title:'각자의 파트너. <em>각자의 전략.</em>'},
  ]},
  items: {duration:8,accent:'#adf6fd',copy:[
    {title:'하나의 도구. <em>무한한 변수.</em>'},
    {title:`<em>${BATTLE_ITEMS.length}종</em>의 아이템. 전략을 완성하다.`},
  ]},
  challenges: {duration:10,accent:'#f4dba2',copy:[{title:'승리 너머의 <em>도전.</em>'}]},
}
const params = new URLSearchParams(location.search)
const sceneId = params.get('scene') || 'trainers'
if (!SCENES[sceneId]) throw new Error(`Unknown cinematic scene: ${sceneId}`)
const scene = SCENES[sceneId]
const stage = document.querySelector('#cinematic')
stage.classList.add(`scene-${sceneId}`)
stage.style.setProperty('--accent',scene.accent)
scene.copy.forEach((copy,index) => {
  const target = document.querySelector(index ? '.copy-two' : '.copy-one')
  target.querySelector('h1,h2').innerHTML = copy.title
  // Preserve the emphasis markup while giving each word an independent reveal.
  const title = target.querySelector('h1,h2')
  let wordIndex = 0
  function animateWords(element,className) {
    for (const node of [...element.childNodes]) {
      if (node.nodeType === Node.ELEMENT_NODE) { animateWords(node,className); continue }
      const fragment = document.createDocumentFragment()
      for (const token of node.textContent.split(/(\s+)/)) {
        if (!token.trim()) { fragment.append(document.createTextNode(token)); continue }
        const clip = document.createElement('span')
        clip.className = `${className}-clip`
        const glyph = document.createElement('span')
        glyph.className = `${className}-word`
        glyph.style.setProperty('--word',wordIndex++)
        glyph.textContent = token
        clip.append(glyph);fragment.append(clip)
      }
      node.replaceWith(fragment)
    }
  }
  animateWords(title,'title')
})

const CHALLENGE_FEATURES = [
  {id:'flawless-league',number:'7전 전승',condition:['노말 · 하드 난이도','한 번의 기절도 없이 리그 우승'],icon:'<path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Z"/><path d="m8 12 3 3 5-6"/>'},
  {id:'flawless-tournament',number:'128강 → 우승',condition:['노말 · 하드 난이도','한 번의 기절도 없이 7경기 돌파'],icon:'<path d="M8 3h8v6a4 4 0 0 1-8 0V3Z"/><path d="M8 5H4v3a4 4 0 0 0 4 4m8-7h4v3a4 4 0 0 1-4 4M12 13v7m-4 1h8"/>'},
  {id:'collection-all',number:`${NATIONAL_DEX.length.toLocaleString('ko-KR')}종`,condition:['세대를 넘어 모든 포켓몬 수집','전국도감을 당신의 컬렉션으로'],icon:'<path d="M12 5C9 3 5 3 3 4v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-2-1-6-1-9 1v15"/><path d="M6 8h3m-3 4h3m6-4h3m-3 4h3"/>'},
]
const challengeCards = []
if (sceneId === 'challenges') {
  for (const [index,feature] of CHALLENGE_FEATURES.entries()) {
    const achievement = ACHIEVEMENTS.find(entry=>entry.id===feature.id)
    if (!achievement) throw new Error(`Missing cinematic achievement: ${feature.id}`)
    const card = document.createElement('article')
    card.className = 'challenge-card'
    card.dataset.achievementId = achievement.id
    card.style.setProperty('--index',index)
    const icon = document.createElement('div')
    icon.className = 'challenge-icon'
    icon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${feature.icon}</svg>`
    const number = document.createElement('strong');number.className='challenge-number';number.textContent=feature.number
    const title = document.createElement('h3');title.textContent=achievement.title
    const condition = document.createElement('p')
    for (const line of feature.condition) {const span=document.createElement('span');span.textContent=line;condition.append(span)}
    card.append(icon,number,title,condition)
    document.querySelector('.challenge-lineup').append(card)
    challengeCards.push(card)
  }
}

const ITEM_IDS = ['life-orb','focus-sash','charizardite-x','choice-scarf','leftovers','assault-vest','lum-berry','electrium-z--held']
function itemArtwork(item,size) {
  if (Number.isInteger(item.spriteSheetIndex)) {
    const sprite = document.createElement('span')
    sprite.className = 'sheet-icon'
    const scale = size / 24
    sprite.style.cssText = `width:${size}px;height:${size}px;background-image:url('${item.sprite}');background-size:${384*scale}px ${1152*scale}px;background-position:${-(item.spriteSheetIndex%16)*size}px ${-Math.floor(item.spriteSheetIndex/16)*size}px;`
    return sprite
  }
  const img = document.createElement('img')
  img.src = item.sprite
  img.alt = item.name
  img.decoding = 'sync'
  return img
}
const selectedItems = ITEM_IDS.map(id => BATTLE_ITEMS.find(item => item.id === id))
if (sceneId === 'items') {
  if (selectedItems.some(item => !item)) throw new Error('Missing cinematic item fixture')
  const positions = [[355,263],[1585,252],[427,530],[1495,535],[679,145],[1240,136],[253,433],[1660,438]]
  selectedItems.forEach((item,index) => {
    const object = document.createElement('div')
    object.className = 'orbit-item'
    object.style.cssText = `--x:${positions[index][0]};--y:${positions[index][1]};--delay:${index*.035};`
    object.append(itemArtwork(item,150))
    const name = document.createElement('small');name.textContent=item.name;object.append(name)
    document.querySelector('.item-orbit').append(object)
  })
  selectedItems.slice(0,4).forEach((item,index) => {
    const hero = document.createElement('div');hero.className='hero-object';hero.style.setProperty('--index',index)
    hero.append(itemArtwork(item,250))
    const name=document.createElement('strong');name.textContent=item.name;hero.append(name)
    document.querySelector('.item-hero').append(hero)
  })
}

// Use the same complete roster and sprite candidate order as TrainerSprite.
// The full 238-member wall appears before two groups of six full-body figures.
const FEATURED_GROUPS = [
  ['레드','그린','성호','난천','목호','아이리스'],
  ['지우','카르네','단델','금랑','네모','태홍'],
]
const rosterImages = []
const featuredGroups = []
const trainerLoadQueue = []
let trainerLoadRetries = 0
const shownTrainerIds = new Set()
let peakVisibleTrainerCount = 0
const roster = document.querySelector('.trainer-roster')
function trainerArtwork(trainer) {
  const sources = getTrainerSpriteCandidates(trainer)
  if (!sources.length) throw new Error(`Missing trainer sprite: ${trainer.name}`)
  const img = document.createElement('img')
  img.alt = trainer.name
  img.dataset.trainerId = trainer.id
  img.decoding = 'sync'
  img.loading = 'eager'
  // Defer source assignment until a worker is available: 250 simultaneous
  // image requests can be rejected transiently by the sprite host.
  trainerLoadQueue.push(async () => {
    for (const source of sources) {
      for (let attempt=0;attempt<3;attempt++) {
        if (attempt) {
          trainerLoadRetries += 1
          await new Promise(resolve=>setTimeout(resolve,attempt*650))
        }
        const url = new URL(source,location.href)
        if (attempt) url.searchParams.set('promoRetry',String(attempt))
        try {
          await loadImageSource(img,url.href)
          return
        } catch { img.removeAttribute('src') }
      }
    }
    img.dataset.loadFailed = 'true'
    throw new Error(`Cinematic trainer failed to load after retries: ${trainer.name} (${sources.join(', ')})`)
  })
  return img
}
function loadImageSource(img,source) {
  return new Promise((resolve,reject) => {
    const finish = error => {
      clearTimeout(timeout)
      img.removeEventListener('load',onLoad)
      img.removeEventListener('error',onError)
      if (error) reject(error)
      else img.decode().then(resolve,reject)
    }
    const onLoad = () => finish()
    const onError = () => finish(new Error(`Image request failed: ${source}`))
    const timeout = setTimeout(()=>finish(new Error(`Image request timed out: ${source}`)),15000)
    img.addEventListener('load',onLoad,{once:true})
    img.addEventListener('error',onError,{once:true})
    img.src = source
  })
}
async function loadTrainerRoster() {
  let next = 0
  const worker = async () => {
    while (next<trainerLoadQueue.length) {
      const task = trainerLoadQueue[next++]
      await task()
    }
  }
  await Promise.all(Array.from({length:6},worker))
}

// Compose every supported species once as a static sprite atlas. One canvas
// camera then pulls back, avoiding the cost of 1,025 simultaneously playing GIFs.
const POKEMON_HERO_IDS = [6,448,658,282,25,445]
const pokemonRoster = document.querySelector('.pokemon-roster')
const pokemonRosterImages = []
const pokemonGroups = []
const pokemonLoadQueue = []
const shownPokemonIds = new Set()
const visiblePokemonIds = new Set()
const pokemonPositions = []
const pokemonAtlas = document.createElement('canvas')
const pokemonView = document.querySelector('.pokemon-wall')
const pokemonContext = pokemonView.getContext('2d')
const POKEMON_COLUMNS = 50
const POKEMON_CELL = {width:96,height:86}
const POKEMON_FRAME = {left:48,top:80,width:1824,height:654}
const POKEMON_CAMERA = {x:960,y:407}
let pokemonLoadRetries = 0
let peakVisiblePokemonCount = 0
let pokemonCameraScale = 1
let pokemonAtlasReady = false
pokemonView.width = 1920;pokemonView.height = 1080
function pokemonArtwork(pokemon) {
  // Real PokeAPI front PNGs allow transparent padding to be trimmed via CORS,
  // maximizing sprite size even in the final complete national-dex wall.
  const sources = [...new Set([
    `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${pokemon.id}.png`,
    pokemon.spriteFrontFallback,
  ].flat().filter(Boolean))]
  const img = document.createElement('img')
  img.alt = pokemon.name
  img.dataset.pokemonId = String(pokemon.id)
  img.decoding = 'sync'
  img.loading = 'eager'
  pokemonLoadQueue.push(async () => {
    for (const [sourceIndex,source] of sources.entries()) {
      if(sourceIndex===0)img.crossOrigin='anonymous'
      else img.removeAttribute('crossorigin')
      for (let attempt=0;attempt<3;attempt++) {
        if (attempt) {pokemonLoadRetries++;await new Promise(resolve=>setTimeout(resolve,attempt*450))}
        const url = new URL(source,location.href)
        if (attempt) url.searchParams.set('promoRetry',String(attempt))
        try {await loadImageSource(img,url.href);return} catch {img.removeAttribute('src')}
      }
    }
    img.dataset.loadFailed = 'true'
    throw new Error(`Cinematic Pokémon failed to load after retries: ${pokemon.name}`)
  })
  return img
}
function spriteContentBounds(img) {
  const scratch=document.createElement('canvas')
  scratch.width=img.naturalWidth;scratch.height=img.naturalHeight
  const context=scratch.getContext('2d',{willReadFrequently:true})
  context.drawImage(img,0,0)
  try {
    const {data}=context.getImageData(0,0,scratch.width,scratch.height)
    let left=scratch.width,top=scratch.height,right=0,bottom=0
    for(let y=0;y<scratch.height;y++)for(let x=0;x<scratch.width;x++) {
      if(data[(y*scratch.width+x)*4+3]>24){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y)}
    }
    if(right>=left&&bottom>=top)return {x:left,y:top,width:right-left+1,height:bottom-top+1}
  }catch{/* A non-CORS fallback keeps its original transparent frame. */}
  return {x:0,y:0,width:img.naturalWidth,height:img.naturalHeight}
}
function preparePokemonAtlas() {
  const rows=Math.ceil(pokemonRosterImages.length/POKEMON_COLUMNS)
  pokemonAtlas.width=POKEMON_COLUMNS*POKEMON_CELL.width
  pokemonAtlas.height=rows*POKEMON_CELL.height
  const atlas=pokemonAtlas.getContext('2d')
  atlas.imageSmoothingEnabled=false
  pokemonRosterImages.forEach((img,index)=>{
    const column=index%POKEMON_COLUMNS,row=Math.floor(index/POKEMON_COLUMNS)
    const rowLength=Math.min(POKEMON_COLUMNS,pokemonRosterImages.length-row*POKEMON_COLUMNS)
    const centerX=(column+.5+(POKEMON_COLUMNS-rowLength)/2)*POKEMON_CELL.width
    const centerY=(row+.5)*POKEMON_CELL.height
    const bounds=spriteContentBounds(img)
    const fit=Math.min(86/bounds.width,76/bounds.height)
    const width=bounds.width*fit,height=bounds.height*fit
    atlas.drawImage(img,bounds.x,bounds.y,bounds.width,bounds.height,centerX-width/2,centerY-height/2,width,height)
    pokemonPositions.push({id:img.dataset.pokemonId,loaded:img.complete&&img.naturalWidth>0,
      x:POKEMON_FRAME.left+centerX/pokemonAtlas.width*POKEMON_FRAME.width,
      y:POKEMON_FRAME.top+centerY/pokemonAtlas.height*POKEMON_FRAME.height,
      width:width/pokemonAtlas.width*POKEMON_FRAME.width,
      height:height/pokemonAtlas.height*POKEMON_FRAME.height})
  })
  pokemonAtlasReady=true
}
async function loadPokemonRoster() {
  let next=0
  const worker=async()=>{while(next<pokemonLoadQueue.length)await pokemonLoadQueue[next++]()}
  await Promise.all(Array.from({length:12},worker))
  preparePokemonAtlas()
}
if (sceneId === 'pokemon') {
  // Familiar partners from all nine generations surround the opening camera.
  // Every remaining species receives exactly one place in the full wall.
  const centralIds=[6,9,3,25,149,150,157,160,154,248,249,250,257,260,254,282,376,384,
    392,395,389,445,448,487,497,500,503,571,635,644,658,655,652,700,716,717,
    724,727,730,778,791,792,812,815,818,887,888,889,908,911,914,937,1007,1008]
  const selectedPokemon=Array(NATIONAL_DEX.length)
  const centralSet=new Set(centralIds)
  centralIds.forEach((id,index)=>{
    const row=6+Math.floor(index/9),column=20+index%9
    selectedPokemon[row*POKEMON_COLUMNS+column]=NATIONAL_DEX.find(pokemon=>pokemon.id===id)
  })
  const remaining=NATIONAL_DEX.filter(pokemon=>!centralSet.has(pokemon.id))
  let remainingIndex=0
  for(let i=0;i<selectedPokemon.length;i++)if(!selectedPokemon[i])selectedPokemon[i]=remaining[remainingIndex++]
  selectedPokemon.forEach(pokemon=>pokemonRosterImages.push(pokemonArtwork(pokemon)))
  const group=document.createElement('div')
  group.className='pokemon-group'
  POKEMON_HERO_IDS.forEach((id,index)=>{
    const pokemon=NATIONAL_DEX.find(entry=>entry.id===id)
    const figure=document.createElement('figure')
    figure.className='pokemon-object'
    figure.style.setProperty('--index',index)
    const img=pokemonArtwork(pokemon)
    const caption=document.createElement('figcaption')
    const label=document.createElement('strong');label.textContent=pokemon.name
    caption.append(label);figure.append(img,caption);group.append(figure)
  })
  document.querySelector('.pokemon-spotlight').append(group)
  pokemonGroups.push(group)
}
if (sceneId === 'trainers') {
  TRAINERS.forEach((trainer,index) => {
    const figure = document.createElement('div')
    figure.className = 'roster-trainer'
    figure.style.setProperty('--index',index)
    const img = trainerArtwork(trainer)
    rosterImages.push(img)
    figure.append(img)
    roster.append(figure)
  })
  FEATURED_GROUPS.forEach((names,groupIndex) => {
    const group = document.createElement('div')
    group.className = 'trainer-group'
    group.dataset.group = groupIndex
    names.forEach((name,index) => {
      const trainer = TRAINERS.find(entry => entry.name === name)
      if (!trainer) throw new Error(`Missing featured trainer: ${name}`)
      const figure = document.createElement('figure')
      figure.className = 'trainer-object'
      figure.style.setProperty('--index',index)
      const img = trainerArtwork(trainer)
      const caption = document.createElement('figcaption')
      const label = document.createElement('strong')
      label.textContent = trainer.name
      caption.append(label)
      figure.append(img,caption)
      group.append(figure)
    })
    document.querySelector('.trainer-spotlight').append(group)
    featuredGroups.push(group)
  })
}
const clamp = value => Math.max(0,Math.min(1,value))
const smooth = value => {const x=clamp(value);return x*x*(3-2*x)}
function trainerMotion(time) {
  const reveal = smooth((time-.05)/.65)
  const spotlight = smooth((time-3.05)/.6)
  roster.style.opacity = String(reveal*(1-spotlight*.88))
  roster.style.transform = `scale(${1+smooth(time/14)*.022}) translateY(${-spotlight*12}px)`
  if (Number(roster.style.opacity)>.5 && shownTrainerIds.size<rosterImages.length) {
    rosterImages.forEach(img => {
      const rect = img.getBoundingClientRect()
      if (img.complete && img.naturalWidth>0 && rect.left>=0 && rect.top>=0 && rect.right<=innerWidth && rect.bottom<=innerHeight) shownTrainerIds.add(img.dataset.trainerId)
    })
    peakVisibleTrainerCount = Math.max(peakVisibleTrainerCount,shownTrainerIds.size)
  }
  featuredGroups.forEach((group,index) => {
    const start = index ? 8 : 3.15
    const enter = smooth((time-start)/.75)
    const leave = index ? 0 : smooth((time-8)/.75)
    group.style.opacity = String(enter*(1-leave))
    group.style.transform = `translateY(${(1-enter)*35-leave*18}px) scale(${.965+enter*.035+leave*.018})`
    group.style.visibility = enter>0 && leave<1 ? 'visible' : 'hidden'
    for (const [i,figure] of [...group.children].entries()) {
      figure.style.transform = `translateY(${Math.sin(time*.85+i*.8)*5}px)`
    }
  })
}
function pokemonMotion(time) {
  visiblePokemonIds.clear()
  const reveal=smooth((time-.02)/.48)
  const transition=smooth((time-1.8)/.6)
  const group=pokemonGroups[0]
  if(group) {
    const opacity=reveal*(1-transition)
    group.style.opacity=String(opacity)
    group.style.visibility=opacity>0?'visible':'hidden'
    group.style.transform=`translateY(${(1-reveal)*25-transition*20}px) scale(${.94+reveal*.06-transition*.04})`
    for(const [i,figure]of[...group.children].entries()) {
      figure.style.transform=`translateY(${Math.sin(time*1.2+i*.9)*6}px)`
      const img=figure.querySelector('img'),rect=img.getBoundingClientRect()
      if(opacity>.5&&img.complete&&img.naturalWidth>0&&rect.left>=0&&rect.right<=innerWidth&&rect.top>=0&&rect.bottom<=innerHeight)visiblePokemonIds.add(img.dataset.pokemonId)
    }
  }
  // Logarithmic pullback reveals more partners continuously. The complete
  // 1,025-species wall is fully inside the frame from eight seconds onward.
  const pullback=smooth((time-2.25)/5.5)
  pokemonCameraScale=Math.exp(Math.log(6.3)*(1-pullback))
  pokemonContext.clearRect(0,0,1920,1080)
  if(pokemonAtlasReady&&transition>0) {
    pokemonContext.save()
    pokemonContext.beginPath();pokemonContext.rect(36,74,1848,670);pokemonContext.clip()
    pokemonContext.globalAlpha=transition
    pokemonContext.imageSmoothingEnabled=false
    pokemonContext.translate(POKEMON_CAMERA.x,POKEMON_CAMERA.y)
    pokemonContext.scale(pokemonCameraScale,pokemonCameraScale)
    pokemonContext.translate(-POKEMON_CAMERA.x,-POKEMON_CAMERA.y)
    pokemonContext.drawImage(pokemonAtlas,POKEMON_FRAME.left,POKEMON_FRAME.top,POKEMON_FRAME.width,POKEMON_FRAME.height)
    pokemonContext.restore()
    if(transition>.5)for(const position of pokemonPositions) {
      const x=POKEMON_CAMERA.x+(position.x-POKEMON_CAMERA.x)*pokemonCameraScale
      const y=POKEMON_CAMERA.y+(position.y-POKEMON_CAMERA.y)*pokemonCameraScale
      const halfWidth=position.width*pokemonCameraScale/2,halfHeight=position.height*pokemonCameraScale/2
      if(position.loaded&&x-halfWidth>=36&&x+halfWidth<=1884&&y-halfHeight>=74&&y+halfHeight<=744)visiblePokemonIds.add(position.id)
    }
  }
  visiblePokemonIds.forEach(id=>shownPokemonIds.add(id))
  peakVisiblePokemonCount=Math.max(peakVisiblePokemonCount,visiblePokemonIds.size)
  pokemonRoster.style.opacity=String(transition)
}

function challengeMotion(time) {
  challengeCards.forEach((card,index)=>{
    const enter=smooth((time-.65-index*.24)/1.05)
    card.style.opacity=String(enter)
    card.style.transform=`translateY(${(1-enter)*56+Math.sin(time*.65+index)*2}px) scale(${.97+enter*.03})`
  })
}

// Original light, rings and particles surround actual in-game pixel assets.
const canvas = document.querySelector('.atmosphere')
canvas.width = 1920;canvas.height = 1080
const ctx = canvas.getContext('2d',{alpha:true})
const random = index => {const value=Math.sin(index*127.1+7.37)*43758.5453;return value-Math.floor(value)}
const particles = Array.from({length:100},(_,i) => ({x:random(i+1)*1920,y:random(i+101)*1280,size:1+random(i+201)*3,speed:18+random(i+301)*48,phase:random(i+401)*6.28}))
function paint(time) {
  ctx.clearRect(0,0,1920,1080)
  particles.forEach((p,i) => {
    const y=(p.y-time*p.speed+1280*3)%1280-100
    const x=p.x+Math.sin(time*.4+p.phase)*23+time*14
    const alpha=(.18+.34*(.5+.5*Math.sin(time*1.2+p.phase)))*Math.min(1,time*1.5+.1)
    ctx.globalAlpha=alpha
    ctx.fillStyle='#a3ecff'
    ctx.beginPath();ctx.ellipse(x,y,p.size*.48,p.size*.7,.38,0,Math.PI*2);ctx.fill()
    if(i%9===0){ctx.globalAlpha=alpha*.35;ctx.fillRect(x-.5,y+3,1,18)}
  })
  ctx.globalAlpha=1
  ctx.save();ctx.translate(960,sceneId==='trainers'?620:sceneId==='pokemon'?560:400)
  for(let ring=0;ring<3;ring++) {
    ctx.strokeStyle=ring%2?'#97fff5':'#b4bbff';ctx.globalAlpha=.16-ring*.025;ctx.lineWidth=2
    ctx.beginPath();ctx.ellipse(0,0,(sceneId==='trainers'?660:305)+ring*140,90+ring*42,-.12+time*.015,0,Math.PI*2);ctx.stroke()
  }
  for(let i=0;i<9;i++) {const angle=time*.22+i*Math.PI*2/9;const x=Math.cos(angle)*530,y=Math.sin(angle)*145;ctx.fillStyle='#c4fdff';ctx.globalAlpha=.6;ctx.beginPath();ctx.arc(x,y,2,0,Math.PI*2);ctx.fill()}
  ctx.restore()
  if(sceneId==='trainers')trainerMotion(time)
  if(sceneId==='pokemon')pokemonMotion(time)
  if(sceneId==='challenges')challengeMotion(time)
}
paint(0)

async function decodeImage(img) {
  if (img.complete && img.naturalWidth>0) return
  await new Promise((resolve,reject) => {
    img.addEventListener('load',resolve,{once:true})
    img.addEventListener('error',()=>reject(new Error(`Cinematic asset failed to load: ${img.src}`)),{once:true})
  })
  await img.decode?.().catch(()=>{})
}
let startedAt=null
let frameId=null
let playing=false
let currentTime=0
function stop(){if(frameId!==null)cancelAnimationFrame(frameId);frameId=null;playing=false;document.getAnimations().forEach(animation=>animation.pause())}
function animate(now){currentTime=(now-startedAt)/1000;paint(currentTime);if(playing)frameId=requestAnimationFrame(animate)}
window.promoCinematic={
  sceneId,
  ready:Promise.all([document.fonts.ready,sceneId==='trainers'?loadTrainerRoster():sceneId==='pokemon'?loadPokemonRoster():Promise.all([...document.images].map(decodeImage))]).then(()=>true),
  play(){stop();shownTrainerIds.clear();shownPokemonIds.clear();peakVisibleTrainerCount=0;peakVisiblePokemonCount=0;stage.classList.add('is-playing');void stage.offsetWidth;document.getAnimations().forEach(animation=>{animation.currentTime=0;animation.play()});startedAt=performance.now();currentTime=0;playing=true;paint(0);frameId=requestAnimationFrame(animate);return {sceneId,duration:scene.duration,playing:true}},
  stop,
  setTime(time){stop();stage.classList.add('is-playing');void stage.offsetWidth;currentTime=Math.max(0,Number(time)||0);document.getAnimations().forEach(animation=>{animation.currentTime=currentTime*1000;animation.pause()});paint(currentTime);return currentTime},
  status(){
    const visibleRoster = Number(roster.style.opacity)>.1
    const activeGroups=featuredGroups.filter(group=>Number(group.style.opacity)>.1)
    const activePokemonGroups=pokemonGroups.filter(group=>Number(group.style.opacity)>.1)
    return {sceneId,playing,currentTime,duration:scene.duration,art:null,artLoaded:true,
      totalTrainerCount:rosterImages.length,
      loadedTrainerCount:rosterImages.filter(img=>img.complete&&img.naturalWidth>0).length,
      trainerLoadRetries,
      shownTrainerCount:shownTrainerIds.size,
      peakVisibleTrainerCount,
      visibleTrainerCount:visibleRoster?rosterImages.length:activeGroups.reduce((count,group)=>count+group.children.length,0),
      featuredTrainerNames:activeGroups.flatMap(group=>[...group.querySelectorAll('strong')].map(label=>label.textContent)),
      totalPokemonCount:pokemonRosterImages.length,
      selectedPokemonCount:pokemonRosterImages.length,
      selectedSpeciesIds:pokemonRosterImages.map(img=>Number(img.dataset.pokemonId)),
      loadedPokemonCount:pokemonRosterImages.filter(img=>img.complete&&img.naturalWidth>0).length,
      pokemonLoadRetries,
      shownPokemonCount:shownPokemonIds.size,
      peakVisiblePokemonCount,
      visiblePokemonCount:visiblePokemonIds.size,
      visibleSpeciesIds:[...visiblePokemonIds].map(Number),
      pokemonCameraScale,
      pokemonAtlasReady,
      featuredPokemonNames:activePokemonGroups.flatMap(group=>[...group.querySelectorAll('strong')].map(label=>label.textContent)),
      challengeIds:challengeCards.map(card=>card.dataset.achievementId),
      visibleChallengeCount:challengeCards.filter(card=>Number(card.style.opacity)>.5).length,
      headlineText:scene.copy.map(copy=>copy.title.replace(/<[^>]*>/g,'')),
      failedAssets:[...document.images,...pokemonRosterImages].filter(img=>img.dataset.loadFailed==='true').map(img=>img.alt),
    }
  },
}
if(params.has('autoplay'))window.promoCinematic.ready.then(()=>window.promoCinematic.play())
window.addEventListener('pagehide',stop,{once:true})
