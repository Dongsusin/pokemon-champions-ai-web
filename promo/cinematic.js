import { BATTLE_ITEMS } from '../src/data/shopData.js'

const SCENES = {
  clash: {art:'battle-clash',duration:8,accent:'#ffc174',copy:[
    {eyebrow:'뜨거운 승부의 시작',title:'단 한 번의 <em>선택.</em>',description:'당신의 한 수가 배틀의 흐름을 바꾼다.'},
    {eyebrow:'포켓몬 챔피언스 아레나',title:'지금, <em>한계를 넘어.</em>',description:'나만의 포켓몬. 나만의 전략. 나만의 승부.'},
  ]},
  partners: {art:'partners',duration:8,accent:'#b5ffbe',copy:[
    {eyebrow:'새로운 파트너와 함께',title:'수많은 <em>만남.</em>',description:'좋아하는 포켓몬을 모으고, 함께 강해져라.'},
    {eyebrow:'당신만의 배틀 팀',title:'가능성은, <em>당신의 조합 속에.</em>',description:'타입과 특성, 기술과 도구. 승리의 팀을 완성하라.'},
  ]},
  rivals: {art:'rivals',duration:8,accent:'#ffd580',copy:[
    {eyebrow:'익숙한 얼굴, 새로운 승부',title:'다음 상대는 <em>누구인가.</em>',description:'상대의 전략을 읽고, 한 수 앞서라.'},
    {eyebrow:'끝없이 달라지는 도전',title:'<em>238명</em>의 AI 트레이너.',description:'각자의 파트너와 전략을 가진 도전자들이 기다린다.'},
  ]},
  power: {art:'power',duration:4,accent:'#d8bbff',copy:[
    {eyebrow:'승부를 뒤집는 순간',title:'잠재력을 <em>깨워라.</em>',description:''},
    {eyebrow:'결정적인 순간, 당신의 선택',title:'새로운 힘으로, <em>새로운 승부.</em>',description:''},
  ]},
  items: {art:null,duration:8,accent:'#adf6fd',copy:[
    {eyebrow:'344종의 배틀 아이템',title:'하나의 도구. <em>무한한 변수.</em>',description:'공격을 강화하고, 위기를 버티고, 승부를 바꿔라.'},
    {eyebrow:'작은 선택이 만드는 큰 차이',title:'전략의 마지막 한 조각.',description:'포켓몬과 기술에 어울리는 도구로 완성하는 나만의 전술.'},
  ]},
}
const params = new URLSearchParams(location.search)
const sceneId = params.get('scene') || 'clash'
if (!SCENES[sceneId]) throw new Error(`Unknown cinematic scene: ${sceneId}`)
const scene = SCENES[sceneId]
const stage = document.querySelector('#cinematic')
stage.classList.add(`scene-${sceneId}`)
stage.style.setProperty('--accent',scene.accent)
const keyArt = document.querySelector('.key-art')
if (scene.art) keyArt.src = `/promo/assets/${scene.art}.png`
else keyArt.remove()
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

// Independent foreground particles and energy marks give the key art depth.
// They are original promotional overlays; no game rules or sprites are altered.
const canvas = document.querySelector('.atmosphere')
canvas.width = 1920;canvas.height = 1080
const ctx = canvas.getContext('2d',{alpha:true})
const random = index => { const value=Math.sin(index*127.1+7.37)*43758.5453;return value-Math.floor(value) }
const particles = Array.from({length:100},(_,i) => ({x:random(i+1)*1920,y:random(i+101)*1280,size:1+random(i+201)*3,speed:18+random(i+301)*48,phase:random(i+401)*6.28,hot:i%3===0}))
function energyLine(points,color,width,opacity) {
  ctx.save();ctx.strokeStyle=color;ctx.lineWidth=width;ctx.globalAlpha=opacity;ctx.shadowColor=color;ctx.shadowBlur=16;ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.stroke();ctx.restore()
}
function paint(time) {
  ctx.clearRect(0,0,1920,1080)
  particles.forEach((p,i) => {
    const y=(p.y-time*p.speed+1280*3)%1280-100
    const x=p.x+Math.sin(time*.4+p.phase)*23+time*(sceneId==='partners'?5:14)
    const alpha=(.18+.34*(.5+.5*Math.sin(time*1.2+p.phase)))*Math.min(1,time*1.5+.1)
    ctx.globalAlpha=alpha
    ctx.fillStyle=p.hot && sceneId!=='items' ? '#ffd08c' : '#a3ecff'
    ctx.beginPath();ctx.ellipse(x,y,p.size*.48,p.size*(p.hot?1.7:.7),.38,0,Math.PI*2);ctx.fill()
    if (i%9===0) {ctx.globalAlpha=alpha*.35;ctx.fillRect(x-.5,y+3,1,18)}
  })
  ctx.globalAlpha=1
  if (sceneId==='clash'||sceneId==='power'||sceneId==='rivals') {
    const pulse=Math.max(0,1-Math.abs(time-2.21)/.2)
    if(pulse>0){
      const points=Array.from({length:19},(_,i)=>[i*107,510+Math.sin(i*2.8)*29+Math.sin(time*24+i)*17])
      energyLine(points,'#a4ebff',2,pulse*.4)
    }
  }
  if (sceneId==='items') {
    ctx.save();ctx.translate(960,400)
    for(let ring=0;ring<3;ring++) {
      ctx.strokeStyle=ring%2?'#97fff5':'#b4bbff';ctx.globalAlpha=.16-ring*.025;ctx.lineWidth=2
      ctx.beginPath();ctx.ellipse(0,0,305+ring*140,90+ring*42,-.12+time*.015,0,Math.PI*2);ctx.stroke()
    }
    for(let i=0;i<9;i++) {const angle=time*.22+i*Math.PI*2/9;const x=Math.cos(angle)*530,y=Math.sin(angle)*145;ctx.fillStyle='#c4fdff';ctx.globalAlpha=.6;ctx.beginPath();ctx.arc(x,y,2,0,Math.PI*2);ctx.fill()}
    ctx.restore()
  }
}
paint(0)

function decodeImage(img) {
  if (img.complete && img.naturalWidth>0) return Promise.resolve()
  return new Promise((resolve,reject)=>{
    img.addEventListener('load',()=>resolve(),{once:true})
    img.addEventListener('error',()=>reject(new Error(`Cinematic asset failed to load: ${img.src}`)),{once:true})
  }).then(()=>img.decode?.().catch(()=>{}))
}
let startedAt=null
let frameId=null
let playing=false
let currentTime=0
function stop(){if(frameId!==null)cancelAnimationFrame(frameId);frameId=null;playing=false;document.getAnimations().forEach(animation=>animation.pause())}
function animate(now){currentTime=(now-startedAt)/1000;paint(currentTime);if(playing)frameId=requestAnimationFrame(animate)}
window.promoCinematic={
  sceneId,
  ready:Promise.all([document.fonts.ready,...[...document.images].map(decodeImage)]).then(()=>true),
  play(){stop();stage.classList.add('is-playing');void stage.offsetWidth;document.getAnimations().forEach(animation=>{animation.currentTime=0;animation.play()});startedAt=performance.now();currentTime=0;playing=true;paint(0);frameId=requestAnimationFrame(animate);return {sceneId,duration:scene.duration,playing:true}},
  stop,
  setTime(time){stop();stage.classList.add('is-playing');void stage.offsetWidth;currentTime=Math.max(0,Number(time)||0);document.getAnimations().forEach(animation=>{animation.currentTime=currentTime*1000;animation.pause()});paint(currentTime);return currentTime},
  status(){return {sceneId,playing,currentTime,duration:scene.duration,art:keyArt.currentSrc||null,artLoaded:!scene.art||(keyArt.complete&&keyArt.naturalWidth>0)}},
}
if(params.has('autoplay'))window.promoCinematic.ready.then(()=>window.promoCinematic.play())
window.addEventListener('pagehide',stop,{once:true})
