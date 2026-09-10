import { BATTLE_ITEMS } from '../src/data/shopData.js'
import { TRAINERS } from '../src/data/trainerTeams.js'
import { getTrainerSpriteCandidates } from '../src/data/trainerSprites.js'

const SCENES = {
  trainers: {duration:14,accent:'#b2e9ff',copy:[
    {eyebrow:'모든 트레이너, 각자의 배틀',title:`<em>${TRAINERS.length}명</em>의 AI 트레이너.`,description:'익숙한 라이벌부터 챔피언까지, 끝없이 이어지는 도전.'},
    {eyebrow:'다음 상대는 누구인가',title:'각자의 파트너. <em>각자의 전략.</em>',description:'상대의 한 수를 읽고, 당신만의 승리를 만들어라.'},
  ]},
  items: {duration:8,accent:'#adf6fd',copy:[
    {eyebrow:`${BATTLE_ITEMS.length}종의 배틀 아이템`,title:'하나의 도구. <em>무한한 변수.</em>',description:'공격을 강화하고, 위기를 버티고, 승부를 바꿔라.'},
    {eyebrow:'작은 선택이 만드는 큰 차이',title:'전략의 마지막 한 조각.',description:'포켓몬과 기술에 어울리는 도구로 완성하는 나만의 전술.'},
  ]},
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
  target.querySelector('.eyebrow').textContent = copy.eyebrow
  target.querySelector('h1,h2').innerHTML = copy.title
  target.querySelector('p').textContent = copy.description
})

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
const REGIONS = {kanto:'관동',johto:'성도',hoenn:'호연',sinnoh:'신오',unova:'하나',kalos:'칼로스',alola:'알로라',galar:'가라르',paldea:'팔데아',anime:'애니메이션'}
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
      const region = document.createElement('small')
      region.textContent = REGIONS[trainer.region] ?? trainer.region
      const label = document.createElement('strong')
      label.textContent = trainer.name
      caption.append(region,label)
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
    const start = index ? 8.35 : 3.15
    const end = index ? 14.5 : 8.2
    const enter = smooth((time-start)/.55)
    const leave = smooth((time-(end-.4))/.4)
    group.style.opacity = String(enter*(1-leave))
    group.style.transform = `translateY(${(1-enter)*35-leave*18}px) scale(${.965+enter*.035+leave*.018})`
    group.style.visibility = enter>0 && leave<1 ? 'visible' : 'hidden'
    for (const [i,figure] of [...group.children].entries()) {
      figure.style.transform = `translateY(${Math.sin(time*.85+i*.8)*5}px)`
    }
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
  ctx.save();ctx.translate(960,sceneId==='trainers'?620:400)
  for(let ring=0;ring<3;ring++) {
    ctx.strokeStyle=ring%2?'#97fff5':'#b4bbff';ctx.globalAlpha=.16-ring*.025;ctx.lineWidth=2
    ctx.beginPath();ctx.ellipse(0,0,(sceneId==='trainers'?660:305)+ring*140,90+ring*42,-.12+time*.015,0,Math.PI*2);ctx.stroke()
  }
  for(let i=0;i<9;i++) {const angle=time*.22+i*Math.PI*2/9;const x=Math.cos(angle)*530,y=Math.sin(angle)*145;ctx.fillStyle='#c4fdff';ctx.globalAlpha=.6;ctx.beginPath();ctx.arc(x,y,2,0,Math.PI*2);ctx.fill()}
  ctx.restore()
  if(sceneId==='trainers')trainerMotion(time)
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
  ready:Promise.all([document.fonts.ready,sceneId==='trainers'?loadTrainerRoster():Promise.all([...document.images].map(decodeImage))]).then(()=>true),
  play(){stop();shownTrainerIds.clear();peakVisibleTrainerCount=0;stage.classList.add('is-playing');void stage.offsetWidth;document.getAnimations().forEach(animation=>{animation.currentTime=0;animation.play()});startedAt=performance.now();currentTime=0;playing=true;paint(0);frameId=requestAnimationFrame(animate);return {sceneId,duration:scene.duration,playing:true}},
  stop,
  setTime(time){stop();stage.classList.add('is-playing');void stage.offsetWidth;currentTime=Math.max(0,Number(time)||0);document.getAnimations().forEach(animation=>{animation.currentTime=currentTime*1000;animation.pause()});paint(currentTime);return currentTime},
  status(){
    const visibleRoster = Number(roster.style.opacity)>.1
    const activeGroups=featuredGroups.filter(group=>Number(group.style.opacity)>.1)
    return {sceneId,playing,currentTime,duration:scene.duration,art:null,artLoaded:true,
      totalTrainerCount:rosterImages.length,
      loadedTrainerCount:rosterImages.filter(img=>img.complete&&img.naturalWidth>0).length,
      trainerLoadRetries,
      shownTrainerCount:shownTrainerIds.size,
      peakVisibleTrainerCount,
      visibleTrainerCount:visibleRoster?rosterImages.length:activeGroups.reduce((count,group)=>count+group.children.length,0),
      featuredTrainerNames:activeGroups.flatMap(group=>[...group.querySelectorAll('strong')].map(label=>label.textContent)),
      failedAssets:[...document.images].filter(img=>img.dataset.loadFailed==='true').map(img=>img.alt),
    }
  },
}
if(params.has('autoplay'))window.promoCinematic.ready.then(()=>window.promoCinematic.play())
window.addEventListener('pagehide',stop,{once:true})
