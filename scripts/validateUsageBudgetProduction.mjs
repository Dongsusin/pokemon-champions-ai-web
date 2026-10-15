import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { loadEnv } from 'vite'
import { createAccountSavePatch } from '../src/auth/accountSavePatch.js'

// Opt-in: one new anonymous fixture only; never send chat, join a battle, submit
// a score, or touch existing accounts. Delete its game data and Firebase UID.
assert.deepEqual(process.argv.slice(2), ['--url', 'https://pokemon-champions-area-web.co.kr'])
const origin='https://pokemon-champions-area-web.co.kr', env=loadEnv('production',process.cwd(),''), started=Date.now()
const ownerId='cost-check-'+randomUUID(), checks=[], timings=[]
let user, lease, failed=false, cleanup=false
const output=new URL('scripts/.cache/usage-budget-production/',new URL('../',import.meta.url))
await fs.mkdir(output,{recursive:true})
async function json(url,init,status=200){const response=await fetch(url,{...init,signal:AbortSignal.timeout(20000)});const data=await response.json();if(response.status!==status)throw Object.assign(new Error('Unexpected response'),{code:'HTTP_'+response.status,apiCode:data.error?.code});return data}
const firebase=(action,data)=>json('https://identitytoolkit.googleapis.com/v1/accounts:'+action+'?key='+env.VITE_FIREBASE_API_KEY,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})
async function call(endpoint,action,data={},status=200){assert(endpoint==='account'?['sessionAcquire','sessionHeartbeat','load','save','savePatch','ensureProfile','deleteGuestAccount','onlinePlayers'].includes(action):endpoint==='ranked'?action==='guestProfile':endpoint==='chat'&&action==='read');const start=Date.now();try{return await json(origin+'/api/'+endpoint,{method:'POST',headers:{Authorization:'Bearer '+user.idToken,'Content-Type':'application/json'},body:JSON.stringify({action,...(endpoint==='account'?{ownerId}:{}),...data})},status)}finally{timings.push({endpoint,action,ms:Date.now()-start})}}
const pass=name=>{checks.push(name);console.log('PASS '+name)}
try{
  const signup=await firebase('signUp',{returnSecureToken:true});user={uid:signup.localId,idToken:signup.idToken}
  const profile=(await firebase('lookup',{idToken:user.idToken})).users?.[0]
  assert(profile?.localId===user.uid&&!profile.email&&!profile.providerUserInfo?.length&&Number(profile.createdAt)>=started-60000)
  await fs.writeFile(new URL('fixture.json',output),JSON.stringify({uid:user.uid,ownerId,createdAt:started}))
  lease=await call('account','sessionAcquire');assert.equal(lease.leaseMs,90000)
  await call('ranked','guestProfile');await call('account','ensureProfile')
  const empty=await call('account','load',{patchVersion:2});assert.equal(empty.gameData,null);assert.equal(empty.savePatchVersion,2)
  pass('production negotiates sparse saves for one new authenticated guest')
  const values=Array.from({length:600},(_,index)=>({captureId:'cost-fixture-'+index,speciesId:index%541+1,name:'포켓몬🐉',training:20}))
  const original={'champions-dex-v2':JSON.stringify(values),'champions-vp-v1':'1'}
  await call('account','save',{revision:'cost-base-'+started,saveSequence:1,payload:original})
  values[300].training=21;const expected={...original,'champions-dex-v2':JSON.stringify(values)},delta=createAccountSavePatch(original,expected,{splices:true})
  assert(delta.splices?.['champions-dex-v2'])
  const command={revision:'cost-next-'+started,baseRevision:'cost-base-'+started,saveSequence:2,...delta}
  await call('account','savePatch',command);await call('account','savePatch',command)
  const saved=(await call('account','load')).gameData;assert.deepEqual(saved.payload,expected);assert.equal(saved.revision,command.revision)
  pass('actual production PostgreSQL sparse Unicode edit and idempotent retry preserve every saved key')
  const wrong=await call('account','load',{ownerId:'foreign-cost-owner-'+randomUUID()},409);assert.equal(wrong.error.code,'account-session/lost')
  const invalid=await call('account','savePatch',{...command,baseRevision:command.revision,revision:'cost-bad-'+started,saveSequence:3,splices:{'champions-dex-v2':[999999,0,'x']}},400);assert.equal(invalid.error.code,'INVALID_SAVE')
  assert.deepEqual((await call('account','load')).gameData.payload,expected)
  pass('wrong owners and invalid splice ranges are rejected without modifying the save')
  lease=await call('account','sessionHeartbeat',{version:lease.version,includeOnlinePlayers:false});assert.equal(lease.leaseMs,90000);assert.equal(lease.onlinePlayers,undefined)
  const presence=await call('account','onlinePlayers');assert(Number.isSafeInteger(presence.onlinePlayers?.count));assert(presence.onlinePlayers.count>=0)
  assert.deepEqual(Object.keys(presence.onlinePlayers).sort(),['count','sampledAt','staleAfterMs'])
  const foreignPresence=await call('account','onlinePlayers',{ownerId:'foreign-cost-owner-'+randomUUID()},409);assert.equal(foreignPresence.error.code,'account-session/lost')
  pass('page-entry presence is owner-protected and opted-out heartbeat omits aggregate metadata')
  const chat=await call('chat','read',{expanded:false});assert(Number.isSafeInteger(chat.revision));assert(!chat.messages)
  pass('session renewal and compact chat reads still work; no chat messages were posted')
}catch(error){failed=true;console.error('FAIL '+JSON.stringify({code:typeof error.code==='string'?error.code:'ASSERTION_FAILED',apiCode:error.apiCode}))}
finally{
  if(user){try{lease=await call('account','sessionAcquire');assert.equal((await call('account','deleteGuestAccount',{version:lease.version})).deleted,true);await firebase('delete',{idToken:user.idToken});cleanup=true;pass('fixture game data, guest reservation and Firebase account deleted')}catch(error){failed=true;console.error('FAIL cleanup '+JSON.stringify({code:typeof error.code==='string'?error.code:'CLEANUP_FAILED',apiCode:error.apiCode}))}}
  const result={passed:!failed,checks:checks.length,cleanup,startedAt:new Date(started).toISOString(),finishedAt:new Date().toISOString(),checksPassed:checks,timings}
  await fs.writeFile(new URL('latest.json',output),JSON.stringify(result,null,2));console.log(JSON.stringify(result));process.exitCode=failed?1:0
}
