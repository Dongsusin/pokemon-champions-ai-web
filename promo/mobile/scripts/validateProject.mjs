import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { resolveChromiumExecutable } from '../../scripts/browserRuntime.mjs'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..')
process.chdir(root)
const base=process.env.PROMO_BASE_URL||'http://127.0.0.1:5288'
await fs.mkdir('promo/mobile/output',{recursive:true})
const require=createRequire(path.resolve('promo/package.json'))
const {chromium}=require('playwright')
const timeline=JSON.parse(await fs.readFile('promo/mobile/timeline.json','utf8'))
const browser=await chromium.launch({executablePath:await resolveChromiumExecutable(chromium),headless:true})
const page=await browser.newPage({viewport:{width:1920,height:1080}})
const errors=[];page.on('pageerror',error=>errors.push(error.message))
const report={duration:timeline.reduce((n,s)=>n+s.duration,0),scenes:[],overlays:[],errors}
try{
 for(const shot of timeline.filter(s=>s.kind==='motion')){
  await page.goto(`${base}/promo/mobile/motion.html?scene=${shot.scene}`,{waitUntil:'networkidle'})
  const details=await page.evaluate(async()=>{await window.updateMotion.ready;window.updateMotion.seek(3);const info=window.updateMotion.status();const bounds=[...document.querySelectorAll('.brand-name,.mobile-title,.mobile-tagline,.mobile-chips span,.phone-body,.outro-tagline,.outro-url')].map(e=>{const r=e.getBoundingClientRect();return{text:e.textContent.trim(),left:r.left,top:r.top,right:r.right,bottom:r.bottom}});return{...info,bounds}})
  if(details.brokenImages.length||details.bounds.some(r=>r.left<0||r.top<0||r.right>1920||r.bottom>1080))errors.push(`Invalidmotionbounds:${shot.id}`)
  if(shot.id==='intro'&&details.visibleText.join(' ')!=='POKÉMON CHAMPIONS ARENA')errors.push('Introcontainsunexpectedtext')
  report.scenes.push({id:shot.id,...details})
 }
 for(const shot of timeline.filter(s=>s.kind==='footage')){
  await page.goto(`${base}/promo/mobile/overlay.html?data=${encodeURIComponent(JSON.stringify(shot))}`)
  const details=await page.evaluate(async()=>{await window.updateOverlay.ready;return[...document.querySelectorAll('.copy')].map(e=>{const r=e.getBoundingClientRect();return{text:e.textContent,left:r.left,top:r.top,right:r.right,bottom:r.bottom}})})
  if(details.some(r=>r.left<0||r.top<0||r.right>1920||r.bottom>1080))errors.push(`Captionclipped:${shot.id}`)
  report.overlays.push({id:shot.id,lines:details})
 }
 report.passed=errors.length===0&&report.duration>=60&&report.duration<=120
 await fs.writeFile('promo/mobile/output/project-validation.json',JSON.stringify(report,null,2)+'\n')
 console.log(JSON.stringify({passed:report.passed,seconds:report.duration,motionScenes:report.scenes.length,overlays:report.overlays.length,errors},null,2))
 if(!report.passed)process.exitCode=1
}finally{await browser.close()}
