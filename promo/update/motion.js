import { RANKED_TIERS } from '../../src/data/rankedRules.js'
import spriteManifest from './assets/manifest.json' with { type: 'json' }

const SCENES = Object.freeze({intro:5,update:5,ranks:8,stats:5,outro:7})
const requested = new URLSearchParams(location.search).get('scene') || 'intro'
if (!(requested in SCENES)) throw new Error(`Unknown update motion scene: ${requested}`)
const sceneId = requested
const duration = SCENES[sceneId]
const stage = document.querySelector('#stage')
stage.classList.add(sceneId)
const content = document.querySelector('#content')
const logo = '<img class="brand-logo" src="/assets/brand/champions-arena-emblem.png" alt="Champions Arena 로고">'
const brand = `<div class="brand">${logo}<h1 class="brand-name"><span class="brand-pokemon">POKÉMON</span><span class="brand-arena">CHAMPIONS ARENA</span></h1></div>`
const arrow = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12h16m-7-7 7 7-7 7"/></svg>'
if (sceneId === 'intro') content.innerHTML = brand
if (sceneId === 'outro') content.innerHTML = `${brand}<p class="outro-tagline">당신의 팀으로. <em>다음 랭크로.</em></p><a class="outro-url" href="https://pokemon-champions-area-web.co.kr"><span>pokemon-champions-area-web.co.kr</span>${arrow}</a>`
if (sceneId === 'update') content.innerHTML = '<div class="vs-mark" aria-hidden="true">VS</div><h1 class="headline update-copy">새로운 승부의 시작</h1><p class="update-sub">레이팅 배틀 업데이트</p><div class="title-rule"></div>'
if (sceneId === 'ranks') content.innerHTML = `<h1 class="headline">승부를 쌓아.<em>마스터볼로.</em></h1><div class="rank-track">${RANKED_TIERS.map((tier,index)=>`<article class="rank-card tier-${tier.id}" style="--rank-color:${tier.color}" data-tier="${tier.id}"><span class="rank-icon" aria-hidden="true"><i></i></span><h2>${tier.name}</h2><p>${index === 3 ? 'MASTER' : 'IV → III → II → I'}</p></article>`).join('')}</div><div class="rank-link"><div class="rank-link-fill"></div><i></i></div>`
if (sceneId === 'stats') content.innerHTML = '<div class="orbit-ring"></div><div class="orbit-ring ring-inner"></div><div class="orbit"></div><div class="stats-shade"></div><div class="stats-copy"><h1>데이터로 완성하는 전략</h1><h2>포켓몬 사용률 · 인기 아이템 TOP 3</h2></div>'

const clamp = (value,min=0,max=1) => Math.min(max,Math.max(min,value))
const easeOut = value => 1-(1-clamp(value))**3
const easeInOut = value => { const x=clamp(value);return x*x*(3-2*x) }
const q = selector => content.querySelector(selector)
const qa = selector => [...content.querySelectorAll(selector)]
const nodes = {
  backdrop:document.querySelector('.backdrop'),arc:document.querySelector('.arc-one'),arc2:document.querySelector('.arc-two'),
  beam:document.querySelector('.beam-one'),beam2:document.querySelector('.beam-two'),
}
function words(element) {
  if(!element)return []
  const groups=[]
  for(const text of [...element.childNodes]) {
    if(text.nodeType===Node.ELEMENT_NODE){groups.push(...words(text));continue}
    const fragment=document.createDocumentFragment()
    for(const token of text.textContent.split(/(\s+)/)){
      if(!token.trim()){fragment.append(document.createTextNode(token));continue}
      const span=document.createElement('span');span.className='word';span.textContent=token;fragment.append(span);groups.push(span)
    }
    text.replaceWith(fragment)
  }
  return groups
}
const titleWords = words(q('.headline,.stats-copy h1,.outro-tagline'))
const subWords = words(q('.update-sub,.stats-copy h2'))
const orbitObjects=[]
if(sceneId==='stats') {
  const positions=[
    {id:445,x:960,y:394,size:320,hero:true},
    {id:6,x:402,y:319,size:205},{id:25,x:315,y:568,size:170},
    {id:384,x:1461,y:284,size:230},{id:448,x:1463,y:562,size:200},
    {id:658,x:667,y:584,size:190},{id:149,x:714,y:192,size:180},
    {id:887,x:1228,y:657,size:210},
    {id:'life-orb',x:573,y:426,size:92},{id:'focus-sash',x:1218,y:242,size:104},
    {id:'choice-scarf',x:1646,y:418,size:99},{id:'leftovers',x:895,y:642,size:92},
  ]
  positions.forEach((position,index)=>{
    const asset=spriteManifest.entries.find(entry=>entry.id===position.id)
    if(!asset)throw new Error(`Missing sprite: ${position.id}`)
    const node=document.createElement('div');node.className=`orbit-object ${asset.kind === 'item' ? 'item' : ''} ${position.hero ? 'hero' : ''}`
    node.style.width=`${position.size}px`;node.style.height=`${position.size}px`
    node.innerHTML=`<img src="/promo/update/assets/${asset.file}" alt="${asset.name}" width="${position.size}" height="${position.size}">`
    q('.orbit').append(node);orbitObjects.push({...position,index,node})
  })
}
const canvas=document.querySelector('.atmosphere')
const ctx=canvas.getContext('2d')
function particles(time){
  ctx.clearRect(0,0,1920,1080)
  for(let i=0;i<45;i++){
    const phase=(time*.055+i*.071)%1
    const x=(i*397+35+time*(7+i%7))%1970-25
    const y=(i*227+1080-time*(9+i%11))%1180-50
    const alpha=.09+Math.sin(phase*Math.PI)*.18
    ctx.fillStyle=`rgba(185,237,255,${alpha})`;ctx.beginPath();ctx.arc(x,y,i%4===0?2:1.2,0,Math.PI*2);ctx.fill()
  }
}
function reveal(node,time,start=.2,length=.8,{y=45,x=0,scale=.97,rotate=0,blur=7,base=''}={}){
  if(!node)return
  const p=easeOut((time-start)/length)
  node.style.opacity=String(p)
  node.style.transform=`${base} translate3d(${x*(1-p)}px,${y*(1-p)}px,0) scale(${scale+(1-scale)*p}) rotate(${rotate*(1-p)}deg)`
  node.style.filter=blur&&p<1?`blur(${blur*(1-p)}px)`:'none'
}
function revealWords(list,time,start){list.forEach((node,index)=>reveal(node,time,start+index*.09,.8,{y:46,scale:1.025,rotate:1.8,blur:8}))}
function seek(value){
  const time=clamp(Number(value)||0,0,duration+.75)
  const progress=time/duration
  nodes.backdrop.style.transform=`scale(${1.02+progress*.028}) translate3d(${-progress*12}px,${progress*8}px,0)`
  nodes.arc.style.transform=`rotate(${-8+progress*5}deg) scale(${.99+progress*.025})`
  nodes.arc2.style.transform=`rotate(${8-progress*4}deg) scale(${1+progress*.025})`
  nodes.beam.style.transform=`translateY(${-progress*55}px) rotate(-22deg)`
  nodes.beam2.style.transform=`translateY(${progress*40}px) rotate(-22deg)`
  particles(time)
  if(sceneId==='intro'||sceneId==='outro'){
    reveal(q('.brand-logo'),time,.06,1.1,{y:26,scale:.88,blur:0})
    // Preserve the logo's drop shadows while varying opacity and placement only.
    q('.brand-logo').style.filter='drop-shadow(0 20px 30px #0009) drop-shadow(0 0 30px #39c1ff25)'
    reveal(q('.brand-pokemon'),time,.27,.85,{y:34,scale:1,blur:4})
    reveal(q('.brand-arena'),time,.43,1,{y:46,scale:1.018,blur:5})
  }
  if(sceneId==='outro'){
    revealWords(titleWords,time,1.0)
    reveal(q('.outro-url'),time,1.5,.9,{y:28,scale:.97,blur:3,base:'translateX(-50%)'})
    q('.outro-url svg').style.transform=`translateX(${Math.sin(time*1.1)*3}px)`
  }
  if(sceneId==='update'){
    revealWords(titleWords,time,.12);revealWords(subWords,time,.6)
    q('.vs-mark').style.transform=`translateX(${-25+progress*45}px) scale(${1.02-progress*.06})`
    const p=easeOut((time-.9)/.8);q('.title-rule').style.transform=`scaleX(${p})`;q('.title-rule').style.opacity=String(p)
  }
  if(sceneId==='ranks'){
    revealWords(titleWords,time,.13)
    const advancement=easeInOut((time-1.25)/5.3)*3
    qa('.rank-card').forEach((card,index)=>{
      const entrance=easeOut((time-.48-index*.13)/.9)
      const lit=clamp(1.1-Math.abs(advancement-index)*.6,.3,1)
      const lifted=easeInOut(clamp(1.1-Math.abs(advancement-index),0,1))
      card.style.opacity=String((.62+lit*.38)*entrance)
      card.style.transform=`translate3d(0,${(1-entrance)*65-lifted*23}px,${lifted*36}px) rotateX(${(1-entrance)*10+2-lifted*2}deg) rotateY(${(index-1.5)*-2.7*(1-lifted)}deg) scale(${.98+lifted*.04})`
      card.style.setProperty('--lit',lit)
    })
    q('.rank-link').style.opacity=String(easeOut((time-.8)/.7))
    q('.rank-link-fill').style.transform=`scaleX(${advancement/3})`
    q('.rank-link i').style.left=`${advancement/3*100}%`
  }
  if(sceneId==='stats'){
    orbitObjects.forEach(({node,x,y,size,index,hero})=>{
      const p=easeOut((time-.06-index*.036)/1)
      const driftX=Math.sin(time*.26+index)*5
      const driftY=Math.sin(time*.66+index*.9)*(hero?4:10)
      node.style.opacity=String(p)
      node.style.transform=`translate3d(${x-size/2+driftX}px,${y-size/2+driftY+(1-p)*28}px,0) scale(${.76+.24*p}) rotate(${hero?0:Math.sin(time*.35+index)*1.7}deg)`
    })
    revealWords(titleWords,time,.52);revealWords(subWords,time,.95)
  }
  return {sceneId,time,duration}
}

const imageReady=Promise.all([...document.images].map(image=>image.decode()))
const backgroundReady=new Promise((resolve,reject)=>{const image=new Image();image.onload=resolve;image.onerror=()=>reject(new Error('Lobby background failed to load'));image.src='/assets/champions-lobby-bg.jpg'})
window.updateMotion={
  ready:Promise.all([document.fonts.ready,imageReady,backgroundReady]).then(()=>{seek(0);return {sceneId,duration,width:1920,height:1080}}),
  seek,
  status(){return {sceneId,duration,visibleText:document.body.innerText.trim().split(/\n+/).filter(Boolean),brokenImages:[...document.images].filter(image=>!image.complete||!image.naturalWidth).map(image=>image.src),animations:document.getAnimations().length}},
}
