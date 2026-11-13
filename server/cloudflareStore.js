import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {packDocument,unpackDocument,encodeSlot,decodeSlot,hashValue} from './cloudflareCodec.js';
import {applyAccountSaveSplices} from '../src/auth/accountSavePatch.js';
const clone=x=>x===undefined?undefined:structuredClone(x);
const valid=x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(x);
const conflict=()=>Object.assign(new Error('Concurrent document change'),{code:'STORE_CONFLICT'});
const retryableActions=new Set(['get','list','select','countSessions','countQueue','renewLease']);
const storeActions=new Set([...retryableActions,'commit']);
const unavailable=(action,status)=>Object.assign(new Error('Cloudflare storage unavailable'),{
 code:'STORE_UNAVAILABLE',storeAction:storeActions.has(action)?action:'unknown',
 ...(Number.isInteger(status)?{upstreamStatus:status}:{}),
});
export function createCloudflareStore({url=process.env.CLOUDFLARE_STORE_URL,token=process.env.CLOUDFLARE_STORE_TOKEN,namespace='ranked',fetchImpl=fetch,maxAttempts=4,retryDelay=attempt=>new Promise(r=>setTimeout(r,20*(attempt+1))),request:injected,upstreamRetryDelay=()=>new Promise(r=>setTimeout(r,150))}={}) {
 if(!valid(namespace))throw TypeError('Invalid namespace');
 if(!injected){const endpoint=new URL(url);if(endpoint.username||endpoint.password||endpoint.search||endpoint.hash||endpoint.pathname!=='/internal/store'||!(endpoint.protocol==='https:'&&/^[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev$/.test(endpoint.hostname))||typeof token!=='string'||token.length<32)throw TypeError('Cloudflare storage is not configured');}
 let closed=false;
 const request=injected??(async(body,onRetry=()=>{})=>{
  // Reuse the same serialized command (including the lease ID) on a replay.
  // A commit may already have succeeded, so it must never be replayed here.
  const serialized=JSON.stringify(body),deadline=Date.now()+10000;
  for(let attempt=0;attempt<2;attempt++){
   let failure,retryable=false;
   const remaining=deadline-Date.now();
   if(remaining<=0)throw unavailable(body.action);
   try{
    const response=await fetchImpl(url,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:serialized,signal:AbortSignal.timeout(remaining),redirect:'error',cache:'no-store'});
    if(response.ok)return await response.json();
    // An errored body can reject cancellation; the received HTTP status wins.
    try{await response.body?.cancel();}catch{}
    if(response.status===409)throw conflict();
    failure=unavailable(body.action,response.status);
    retryable=[502,503,504].includes(response.status);
   }catch(error){
    if(error?.code==='STORE_CONFLICT')throw error;
    failure=unavailable(body.action);
    retryable=error instanceof TypeError;
   }
   if(attempt>0||!retryableActions.has(body.action)||!retryable)throw failure;
   await upstreamRetryDelay();
   if(Date.now()>=deadline)throw failure;
   onRetry();
  }
 });
 const check=(c,k='list')=>{if(!valid(c)||!valid(k))throw TypeError('Invalid document address');};
 async function transaction(work){
  if(closed)throw Error('Store is closed');
  for(let attempt=0;attempt<maxAttempts;attempt++){
   const witnesses=new Map(),reads=new Map(),writes=new Map(),lists=new Map(),patches=new Map();let active=true;
   const assert=()=>{if(!active)throw Error('Document transaction has ended');};
   const observe=(c,key,version,list=false)=>{const address=(list?'list:':'get:')+c+'/'+key;const expected=version??'';const old=witnesses.get(address);if(old&&old.version!==expected)throw conflict();witnesses.set(address,{collection:c,key,version:expected,list});};
   const read=async(c,key,options={})=>{assert();check(c,key);const row=await request({action:'get',namespace,collection:c,key,...options});observe(c,key,row?.version);return row;};
   const select=async(c,projection,owner)=>{
    assert();if([...writes.values()].some(w=>w.collection===c))return null;
    const result=await request({action:'select',namespace,projection,owner});observe(c,'',result.version,true);
    return result.rows.map(r=>({id:r.key,...r.value}));
   };
   const view={
    async get(c,key){assert();check(c,key);const a=c+'/'+key;if(writes.has(a)){const w=writes.get(a);if(w.deleted)return null;if(!w.partial)return clone(w.original);}
     if(!reads.has(a))reads.set(a,read(c,key).then(row=>unpackDocument(c,row)));const result=clone(await reads.get(a));
     const pending=writes.get(a);if(pending?.partial&&result){for(const k of pending.removedSlots)delete result.payload[k];for(const slot of pending.slots)result.payload[slot.slot]=decodeSlot(slot);return {...result,...pending.value};}return result;},
    async list(c){assert();check(c);if(!lists.has(c))lists.set(c,request({action:'list',namespace,collection:c}).then(r=>{observe(c,'',r.version,true);return r.rows;}));const rows=new Map((await lists.get(c)).map(row=>[row.key,unpackDocument(c,row)]));for(const w of writes.values()){if(w.collection!==c)continue;if(w.deleted)rows.delete(w.key);else rows.set(w.key,await view.get(c,w.key));}return [...rows].map(([id,value])=>({id,...clone(value)}));},
    set(c,key,value){assert();check(c,key);if(JSON.stringify(value)===undefined||Buffer.byteLength(JSON.stringify(value))>8*1024*1024)throw TypeError('Document size limit');writes.set(c+'/'+key,{collection:c,key,...packDocument(c,clone(value)),original:clone(value)});},
    delete(c,key){assert();check(c,key);writes.set(c+'/'+key,{collection:c,key,deleted:true});},
    async readUnchangedMatch(key,uid,revision,timelineRevision,timestamp){assert();check('matches',key);if(writes.has('matches/'+key))return null;const row=await read('matches',key,{projection:'unchangedMatch',uid,revision,timelineRevision,timestamp});return row?.value??null;},
    async readGameDataForLoad(key, revision, fingerprint, mode) {
      if (mode !== 'slots-v1' || writes.has('gameData/'+key)) return { saved: await view.get('gameData', key), matches: false };
      const row = await read('gameData', key, { metadataOnly: true });
      if (!row) return { saved: null, matches: false };
      const slots = row.slots.map(({slot, hash}) => [slot, hash]).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
      const matches = row.value.revision === revision && hashValue(slots) === fingerprint;
      return { saved: matches ? row.value : await view.get('gameData', key), matches };
    },
    async compareGameData(key,payload){assert();if(writes.has('gameData/'+key)){const saved=await view.get('gameData',key);return saved?{revision:saved.revision,payloadMatches:isDeepStrictEqual(saved.payload,payload)}:null;}const row=await read('gameData',key,{metadataOnly:true});if(!row)return null;const matches=row.slots.length===Object.keys(payload).length&&row.slots.every(s=>Object.hasOwn(payload,s.slot)&&hashValue(payload[s.slot])===s.hash);return {revision:row.value.revision,payloadMatches:matches};},
    async readGameDataPatch(key,patch,removed,splices={}){assert();if(writes.has('gameData/'+key))throw Error('Cannot patch buffered save');const row=await read('gameData',key,{slotKeys:Object.keys(splices)});if(!row)return null;
     let validSplices=true,edited={...patch};try{const sources=Object.fromEntries(row.slots.filter(s=>Object.hasOwn(splices,s.slot)).map(s=>[s.slot,decodeSlot(s)]));edited={...patch,...applyAccountSaveSplices(sources,splices)};}catch{validSplices=false;}
     const sizes=new Map(row.slots.map(s=>[s.slot,s.bytes]));for(const k of removed)sizes.delete(k);for(const [k,v] of Object.entries(edited))sizes.set(k,Buffer.byteLength(JSON.stringify(v)));
     const mergedBytes=2+[...sizes].reduce((sum,[k,n])=>sum+Buffer.byteLength(JSON.stringify(k))+1+n+1,0)-(sizes.size?1:0);
     patches.set(key,{row,edited,removed,validSplices});return {revision:row.value.revision,patchHash:row.value.patchHash,mergedBytes,splicesValid:validSplices};},
    async writeGameDataPatch(key,patch,removed,metadata,baseRevision,splices={}){assert();const p=patches.get(key);if(!p||!p.validSplices||p.row.value.revision!==baseRevision)throw conflict();writes.set('gameData/'+key,{collection:'gameData',key,value:clone(metadata),slots:Object.entries(p.edited).map(([k,v])=>encodeSlot(k,v)),removedSlots:removed,partial:true,replaceSlots:false});reads.delete('gameData/'+key);},
    async listRankedProfiles(){const rows=await select('players','rankedProfiles')??await view.list('players');return rows.map(({id,uid,name,nickname,isGuest,profiles})=>({id,uid:uid??id,name,...(typeof nickname==='string'?{nickname}:{}),isGuest,profiles}));},
    async listGuestMatches(uid){const selected=await select('matches','guestMatches',uid);if(selected)return selected;return (await view.list('matches')).filter(m=>m.players?.some(p=>p.uid===uid)).map(({state,selections,pendingActions,requests,players,...m})=>({...m,players:players.map(({team,...p})=>({...p,team:[]})),hadBattleState:Boolean(state)}));},
    async listGuestRelatedPlayers(uid){const selected=await select('players','guestPlayers',uid);if(selected)return selected;return (await view.list('players')).filter(p=>p.roomResult?.standings?.some(x=>x.uid===uid));},
    async deleteGuestUsageEvents(owner){const rows=await select('pokemonUsageEvents','guestUsage',owner)??(await view.list('pokemonUsageEvents')).filter(x=>x.owner===owner);for(const row of rows)view.delete('pokemonUsageEvents',row.id);return rows.length;},
    async listFactoryBestCandidates(owner){const selected=await select('factoryPersonalBest','factoryCandidates',owner);if(selected)return selected;return (await view.list('factoryPersonalBest')).filter(x=>x.id!==owner&&x.owner!==owner).sort((a,b)=>b.floor-a.floor||a.recordedAt-b.recordedAt||a.id.localeCompare(b.id)).slice(0,10);},
   };
   try{
    const result=clone(await work(view));
    for (const [address,w] of writes) if (!w.deleted && !w.partial && reads.has(address) && isDeepStrictEqual(await reads.get(address),w.original)) writes.delete(address);
    for(const w of writes.values())if(!witnesses.has('get:'+w.collection+'/'+w.key)&&!witnesses.has('list:'+w.collection+'/'))await read(w.collection,w.key,{metadataOnly:true});
    active=false;
    if(writes.size||witnesses.size>1)await request({action:'commit',namespace,id:randomUUID(),reads:[...witnesses.values()],writes:[...writes.values()].map(({original,partial,...w})=>w)});
    return result;
   }catch(e){active=false;if(e?.code!=='STORE_CONFLICT'||attempt+1>=maxAttempts)throw e;await retryDelay(attempt);}
  }
 }
 return {transaction,
  async countActiveSessions(timestamp){return (await request({action:'countSessions',namespace,timestamp})).count;},
  async countRankedQueue(timestamp){return request({action:'countQueue',namespace,timestamp});},
  async renewSessionLease(args){
   if(closed)throw Error('Store is closed');
   let replayed=false;
   const result=await request({action:'renewLease',namespace,id:randomUUID(),...args},()=>{replayed=true;});
   if(!replayed||result.session||result.guestDeleted)return result;
   // A save can change the document revision after a successful lease update
   // whose reply was lost. Recover only that exact lease, under read guards.
   return transaction(async tx=>{
    const session=await tx.get('sessions',args.uid);
    const guestDeleted=args.guestDeletionKey?Boolean(await tx.get('guestDeletions',args.guestDeletionKey)):false;
    const owned=!guestDeleted&&session?.ownerId===args.ownerId&&session.version===args.nextVersion&&session.expiresAt===args.expiresAt;
    return {guestDeleted,session:owned?{ownerId:session.ownerId,version:session.version,expiresAt:session.expiresAt}:null};
   });
  },
  async close(){closed=true;}
 };
}
