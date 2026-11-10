import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {sqliteD1} from '../cloudflare/test/d1-sqlite.mjs';
import {createD1DocumentApi} from '../cloudflare/document-store.mjs';
import {createCloudflareStore} from '../server/cloudflareStore.js';
import {createAccountService} from '../server/accountService.js';
import {packDocument,unpackDocument,decodeSlot} from '../server/cloudflareCodec.js';
const schema=await readFile(new URL('../cloudflare/migrations/0001_documents.sql',import.meta.url),'utf8');
const fixture=()=>{const db=sqliteD1(schema),api=createD1DocumentApi(db),calls=[];const store=createCloudflareStore({namespace:'account',request:async body=>{calls.push(body);return api(body);},retryDelay:async()=>{}});return {db,api,store,calls};};
test('compressed save exactly roundtrips Unicode and substantially reduces repeated collection bytes',()=>{const value={revision:'version-1',payload:{box:JSON.stringify(Array.from({length:1000},(_,i)=>({id:i,name:'피카츄😀',moves:['thunder','quick-attack']})))}};const packed=packDocument('gameData',value);assert.deepEqual(unpackDocument('gameData',{value:packed.value,slots:packed.slots}),value);assert.ok(packed.slots.reduce((n,s)=>n+s.data.length,0)<JSON.stringify(value).length/3);const bad={...packed.slots[0],hash:'0'.repeat(64)};assert.throws(()=>decodeSlot(bad),/checksum/);});
test('transactions retain read-your-writes, namespaces and atomic multi-document commits',async()=>{const {store,api}=fixture();await store.transaction(async tx=>{tx.set('profiles','a',{name:'Alice'});assert.deepEqual(await tx.get('profiles','a'),{name:'Alice'});tx.set('sessions','a',{version:'lease'});});assert.equal((await store.transaction(tx=>tx.get('profiles','a'))).name,'Alice');assert.equal(await api({action:'get',namespace:'ranked',collection:'profiles',key:'a'}),null);await assert.rejects(store.transaction(async tx=>{tx.set('profiles','a',{name:'lost'});throw Error('stop');}));assert.equal((await store.transaction(tx=>tx.get('profiles','a'))).name,'Alice');});
test('conflicting concurrent increments replay safely instead of losing a write',async()=>{const {store}=fixture();await store.transaction(tx=>tx.set('counters','one',{n:0}));await Promise.all([1,2,3].map(()=>store.transaction(async tx=>{const current=await tx.get('counters','one');tx.set('counters','one',{n:current.n+1});})));assert.equal((await store.transaction(tx=>tx.get('counters','one'))).n,3);});
test('read-only transactions perform zero writes; list phantoms cause a conflict',async()=>{const {store,db,api}=fixture();await store.transaction(tx=>tx.set('players','one',{rating:1000}));const before=db.sqlite.prepare('SELECT total_changes() as n').get().n;await store.transaction(tx=>tx.list('players'));assert.equal(db.sqlite.prepare('SELECT total_changes() as n').get().n,before);const listed=await api({action:'list',namespace:'account',collection:'players'});await store.transaction(tx=>tx.set('players','two',{rating:1000}));await assert.rejects(api({action:'commit',namespace:'account',id:'test-guard',reads:[{collection:'players',key:'',version:listed.version,list:true}],writes:[]}),{code:'STORE_CONFLICT'});});
test('metadata comparisons never download a save slot',async()=>{const {store,calls}=fixture();await store.transaction(tx=>tx.set('gameData','a',{revision:'one',payload:{box:'x'.repeat(10000),money:'500'}}));await store.transaction(async tx=>{assert.deepEqual(await tx.compareGameData('a',{money:'500',box:'x'.repeat(10000)}),{revision:'one',payloadMatches:true});});assert.equal(calls.findLast(x=>x.action==='get').metadataOnly,true);});
test('partial save and Unicode splice update only the changed slots',async()=>{const {store,calls}=fixture();await store.transaction(tx=>tx.set('gameData','a',{revision:'one',payload:{box:'A😀B',money:'500',settings:'{}'}}));await store.transaction(async tx=>{const result=await tx.readGameDataPatch('a',{money:'400'},['settings'],{box:[1,1,'🌟']});assert.equal(result.splicesValid,true);await tx.writeGameDataPatch('a',{money:'400'},['settings'],{revision:'two',patchHash:'hash'},'one',{box:[1,1,'🌟']});});assert.deepEqual((await store.transaction(tx=>tx.get('gameData','a'))).payload,{box:'A🌟B',money:'400'});const write=calls.filter(x=>x.action==='commit'&&x.writes.length).at(-1).writes[0];assert.equal(write.replaceSlots,false);assert.deepEqual(write.removedSlots,['settings']);});
test('invalid splices and failed guards do not mutate data',async()=>{const {store,api}=fixture();await store.transaction(tx=>tx.set('gameData','a',{revision:'one',payload:{box:'abc'}}));await store.transaction(async tx=>assert.equal((await tx.readGameDataPatch('a',{},[],{box:[99,1,'x']})).splicesValid,false));await assert.rejects(api({action:'commit',namespace:'account',id:'failed',reads:[{collection:'gameData',key:'a',version:'stale'}],writes:[{collection:'gameData',key:'a',deleted:true}]}),{code:'STORE_CONFLICT'});assert.equal((await store.transaction(tx=>tx.get('gameData','a'))).revision,'one');});
test('real account service keeps session ownership, save sequences and cross-device load',async()=>{const {store}=fixture();let version=0;const service=createAccountService({store,now:()=>1000,newVersion:()=> 'lease-version-'+(++version)});const identity={uid:'alice',isGuest:false},ownerId='owner-a-1234567890123456';const call=(action,extra={})=>service.execute(identity,{action,ownerId,...extra});await call('sessionAcquire');await call('save',{revision:'revision-first',saveSequence:1,payload:{'champions-vp-v1':'50000'}});await call('save',{revision:'revision-second',saveSequence:2,payload:{'champions-vp-v1':'40000'}});await assert.rejects(call('save',{revision:'revision-first',saveSequence:1,payload:{'champions-vp-v1':'50000'}}),e=>e.code==='STALE_SAVE');assert.equal((await call('load')).gameData.payload['champions-vp-v1'],'40000');await assert.rejects(service.execute(identity,{action:'load',ownerId:'owner-b-1234567890123456'}),e=>e.code==='account-session/lost');});
test('unchanged battle status excludes teams and state without leaking to outsiders',async()=>{const {store}=fixture();await store.transaction(tx=>tx.set('matches','m',{revision:2,timelineRevision:3,phase:'battle',deadlineAt:9000,players:[{uid:'a',team:['secret']}],state:{large:true},requests:{a:1},other:1}));const compact=await store.transaction(tx=>tx.readUnchangedMatch('m','a',2,3,1000));assert.equal(compact.state,undefined);assert.equal(compact.requests,undefined);assert.equal(compact.players[0].team,undefined);assert.equal(await store.transaction(tx=>tx.readUnchangedMatch('m','other',2,3,1000)),null);});

test('targeted queries keep unrelated saves and battle teams off the wire',async()=>{
 const {store,calls,api}=fixture();
 await store.transaction(tx=>{
  tx.set('matches','owned',{players:[{uid:'a',team:['secret']}],state:{huge:true},requests:{a:'private'},phase:'ended'});
  tx.set('matches','other',{players:[{uid:'b',team:['private']}],state:{huge:true}});
  tx.set('pokemonUsageEvents','mine',{owner:'a',large:'x'.repeat(1000)});
  tx.set('pokemonUsageEvents','theirs',{owner:'b',large:'y'.repeat(1000)});
  for(let i=0;i<12;i++)tx.set('factoryPersonalBest','r'+i,{owner:'user'+i,floor:i,recordedAt:i});
 });
 const rows=await store.transaction(tx=>tx.listGuestMatches('a'));
 assert.equal(rows.length,1);assert.equal(rows[0].state,undefined);assert.equal(rows[0].requests,undefined);assert.deepEqual(rows[0].players[0].team,[]);assert.equal(rows[0].hadBattleState,true);
 assert.equal((await store.transaction(tx=>tx.listFactoryBestCandidates('user11')))[0].floor,10);
 assert.equal(await store.transaction(tx=>tx.deleteGuestUsageEvents('a')),1);
 assert.ok(await store.transaction(tx=>tx.get('pokemonUsageEvents','theirs')));
 assert.equal(await store.transaction(tx=>tx.get('pokemonUsageEvents','mine')),null);
 assert.equal(calls.filter(x=>x.action==='list').length,0);
 await assert.rejects(api({action:'select',namespace:'account',projection:'sql',owner:'a'}),{code:'INVALID'});
});
test('single reads and identical updates avoid validation requests and database writes',async()=>{
 const {store,calls,db}=fixture();await store.transaction(tx=>tx.set('profiles','a',{name:'same'}));calls.length=0;
 const before=db.sqlite.prepare('SELECT total_changes() AS n').get().n;
 await store.transaction(async tx=>tx.set('profiles','a',await tx.get('profiles','a')));
 assert.equal(calls.length,1);assert.equal(calls[0].action,'get');assert.equal(db.sqlite.prepare('SELECT total_changes() AS n').get().n,before);
});

test('successful transactions spend writes only on durable documents and collection versions',async()=>{
 const {store,db}=fixture();
 const before=db.sqlite.prepare('SELECT total_changes() AS n').get().n;
 for(const name of ['first','second','third'])await store.transaction(tx=>tx.set('profiles','alice',{name}));
 // Three document updates plus three collection-version updates. The guard
 // must validate every batch without inserting and then deleting a receipt.
 assert.equal(db.sqlite.prepare('SELECT total_changes() AS n').get().n-before,6);
 assert.equal((await store.transaction(tx=>tx.get('profiles','alice'))).name,'third');
 assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM transaction_guard').get().n,0);
});

test('a stale document or collection witness aborts all writes with the zero-write guard',async()=>{
 const {store,api,db}=fixture();
 await store.transaction(tx=>tx.set('profiles','alice',{name:'original'}));
 const snapshot=await api({action:'get',namespace:'account',collection:'profiles',key:'alice'});
 const listed=await api({action:'list',namespace:'account',collection:'profiles'});
 await store.transaction(tx=>tx.set('profiles','alice',{name:'newer'}));
 for(const witness of [
  {collection:'profiles',key:'alice',version:snapshot.version},
  {collection:'profiles',key:'',version:listed.version,list:true},
 ]){
  await assert.rejects(api({action:'commit',namespace:'account',id:'stale-guard',reads:[witness],writes:[
   {collection:'profiles',key:'alice',value:{name:'stale'}},
   {collection:'profiles',key:'bob',value:{name:'must-not-appear'}},
  ]}),{code:'STORE_CONFLICT'});
  assert.equal((await store.transaction(tx=>tx.get('profiles','alice'))).name,'newer');
  assert.equal(await store.transaction(tx=>tx.get('profiles','bob')),null);
 }
 assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM transaction_guard').get().n,0);
});

test('valid near-2MiB incompressible saves use bounded rows and smaller replacements remove overflow',async()=>{
 const {randomBytes}=await import('node:crypto');const {store,db}=fixture();const value=randomBytes(1560000).toString('base64');
 await store.transaction(tx=>tx.set('gameData','big',{revision:'one',payload:{box:value}}));
 assert.equal((await store.transaction(tx=>tx.get('gameData','big'))).payload.box,value);
 assert.ok(db.sqlite.prepare('SELECT count(*) AS n FROM document_slot_overflow').get().n>0);
 assert.ok(db.sqlite.prepare('SELECT max(length(data)) AS n FROM document_slots').get().n<=600000);
 await store.transaction(async tx=>{await tx.readGameDataPatch('big',{box:'small'},[]);await tx.writeGameDataPatch('big',{box:'small'},[],{revision:'two'},'one');});
 assert.equal((await store.transaction(tx=>tx.get('gameData','big'))).payload.box,'small');
 assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM document_slot_overflow').get().n,0);
});

test('session renewal uses one atomic request and keeps takeover/deletion fences',async()=>{
 const {store,calls}=fixture();await store.transaction(tx=>tx.set('sessions','a',{ownerId:'owner-a',version:'v1',expiresAt:5000,saveSequence:7}));calls.length=0;
 const args={uid:'a',ownerId:'owner-a',expectedVersion:'v1',nextVersion:'v2',nowMs:1000,expiresAt:10000};
 assert.deepEqual(await store.renewSessionLease(args),{guestDeleted:false,session:{ownerId:'owner-a',version:'v2',expiresAt:10000}});assert.equal(calls.length,1);
 assert.equal((await store.renewSessionLease(args)).session,null);
 assert.equal((await store.transaction(tx=>tx.get('sessions','a'))).saveSequence,7);
 await store.transaction(tx=>tx.set('guestDeletions','deleted',{yes:true}));assert.deepEqual(await store.renewSessionLease({...args,expectedVersion:'v2',nextVersion:'v3',guestDeletionKey:'deleted'}),{guestDeleted:true,session:null});
});

test('saving one account uses indexed document addresses and leaves other accounts untouched',async()=>{
 const {store,db}=fixture();
 await store.transaction(tx=>{for(let i=0;i<100;i++)tx.set('gameData','u'+i,{revision:'one',payload:{box:'data-'+i}});});
 const plans=[],batch=db.batch.bind(db);
 db.batch=async statements=>{for(const s of statements)if(/^DELETE FROM document/.test(s.sql)){const table=s.sql.split(' ')[2];plans.push({table,details:db.sqlite.prepare('EXPLAIN QUERY PLAN '+s.sql).all(...s.args).map(x=>x.detail)});}return batch(statements);};
 await store.transaction(async tx=>{await tx.readGameDataPatch('u1',{box:'edited'},[]);await tx.writeGameDataPatch('u1',{box:'edited'},[],{revision:'two'},'one');});
 assert.equal(plans.length,3);
 for(const {table,details}of plans)assert.ok(details.some(d=>d.startsWith('SEARCH '+table+' ')&&d.includes('(namespace=? AND collection=? AND key=?)')),table+' must address a single account through the composite index');
 assert.equal((await store.transaction(tx=>tx.get('gameData','u1'))).payload.box,'edited');
 assert.equal((await store.transaction(tx=>tx.get('gameData','u99'))).payload.box,'data-99');
});

const httpOptions = { url: 'https://test.example.workers.dev/internal/store', token: 'test-token-'.repeat(5), namespace: 'account', retryDelay: async () => {}, upstreamRetryDelay: async () => {} };

test('a temporary upstream 503 retries one safe read and then returns its result', async () => {
 let attempts=0;
 const store=createCloudflareStore({...httpOptions,fetchImpl:async()=>++attempts===1?new Response('',{status:503}):Response.json(null)});
 assert.equal(await store.transaction(tx=>tx.get('profiles','alice')),null);
 assert.equal(attempts,2);
});

test('upstream read retries stop after two attempts and never expose private diagnostics', async () => {
 let attempts=0;
 const store=createCloudflareStore({...httpOptions,fetchImpl:async()=>{attempts++;return new Response('private upstream diagnostics',{status:503})}});
 await assert.rejects(store.countActiveSessions(1000),error=>error.code==='STORE_UNAVAILABLE'&&!error.message.includes('private'));
 assert.equal(attempts,2);
});

test('authentication and rate limits are not retried and an ambiguous commit is never replayed', async () => {
 for(const status of [400,401,403,413,429]){
  let attempts=0;const store=createCloudflareStore({...httpOptions,fetchImpl:async()=>{attempts++;return new Response('',{status})}});
  await assert.rejects(store.countActiveSessions(1000));assert.equal(attempts,1);
 }
 const actions=[];const store=createCloudflareStore({...httpOptions,fetchImpl:async(_url,options)=>{const body=JSON.parse(options.body);actions.push(body.action);return body.action==='get'?Response.json(null):new Response('',{status:503})}});
 await assert.rejects(store.transaction(tx=>tx.set('profiles','alice',{name:'Alice'})));
 assert.equal(actions.filter(x=>x==='commit').length,1);
});

test('a lost lease reply recovers after a concurrent save without changing session ownership', async () => {
 for(const scenario of ['saved','replaced','deleted']){
  const replaced=scenario==='replaced',deleted=scenario==='deleted';
  const {store:seed,api,db}=fixture();
  await seed.transaction(tx=>tx.set('sessions','alice',{ownerId:'owner-a',version:'v1',expiresAt:5000,saveSequence:7}));
  const actions=[],leaseBodies=[];let lost=false;
  const store=createCloudflareStore({...httpOptions,fetchImpl:async(_url,options)=>{
   const body=JSON.parse(options.body);actions.push(body.action);if(body.action==='renewLease')leaseBodies.push(body);const value=await api(body);
   if(body.action==='renewLease'&&!lost){lost=true;
    db.sqlite.prepare("UPDATE documents SET version='concurrent-save',payload=json_set(payload,'$.saveSequence',8) WHERE namespace='account' AND collection='sessions' AND key='alice'").run();
    if(replaced)db.sqlite.prepare("UPDATE documents SET payload=json_set(payload,'$.ownerId','owner-b','$.version','v3') WHERE namespace='account' AND collection='sessions' AND key='alice'").run();
    if(deleted)await seed.transaction(tx=>tx.set('guestDeletions','deleted-alice',{yes:true}));
    throw new TypeError('fetch failed');
   }
   return Response.json(value);
  }});
  const result=await store.renewSessionLease({uid:'alice',ownerId:'owner-a',expectedVersion:'v1',nextVersion:'v2',nowMs:1000,expiresAt:10000,guestDeletionKey:deleted?'deleted-alice':null});
  assert.equal(actions.filter(x=>x==='renewLease').length,2);
  assert.deepEqual(leaseBodies[0],leaseBodies[1]);
  assert.equal(result.guestDeleted,deleted);
  assert.deepEqual(result.session,replaced||deleted?null:{ownerId:'owner-a',version:'v2',expiresAt:10000});
  const saved=await seed.transaction(tx=>tx.get('sessions','alice'));
  assert.equal(saved.ownerId,replaced?'owner-b':'owner-a');assert.equal(saved.saveSequence,8);
 }
});

test('gateway errors recover but timeouts and malformed responses stop without extra requests', async () => {
 for(const status of [502,504]){
  let attempts=0;
  const store=createCloudflareStore({...httpOptions,fetchImpl:async()=>++attempts===1?new Response('',{status}):Response.json({count:4})});
  assert.equal(await store.countActiveSessions(1000),4);assert.equal(attempts,2);
 }
 for(const error of [new DOMException('private timeout','TimeoutError'),new SyntaxError('private response')]){
  let attempts=0;const store=createCloudflareStore({...httpOptions,fetchImpl:async()=>{attempts++;throw error}});
  await assert.rejects(store.countActiveSessions(1000),failure=>failure.code==='STORE_UNAVAILABLE'&&!failure.message.includes('private'));
  assert.equal(attempts,1);
 }
});

test('an errored response body cannot override HTTP rejection or a confirmed commit conflict', async () => {
 const failedBody=status=>new Response(new ReadableStream({start(controller){controller.error(new TypeError('private stream failure'))}}),{status});
 for(const status of [400,401,403,413,429,503]){
  let attempts=0;const store=createCloudflareStore({...httpOptions,fetchImpl:async()=>{attempts++;return failedBody(status)}});
  await assert.rejects(store.countActiveSessions(1000),error=>error.code==='STORE_UNAVAILABLE'&&error.upstreamStatus===status);
  assert.equal(attempts,status===503?2:1);
 }
 const actions=[];let commits=0;
 const store=createCloudflareStore({...httpOptions,fetchImpl:async(_url,options)=>{
  const {action}=JSON.parse(options.body);actions.push(action);
  if(action==='commit'&&++commits===1)return failedBody(409);
  return Response.json(action==='get'?null:{ok:true});
 }});
 await store.transaction(tx=>tx.set('profiles','alice',{name:'Alice'}));
 assert.deepEqual(actions,['get','commit','get','commit']);
});
