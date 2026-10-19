import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import vm from 'node:vm'
const source=await fs.readFile(new URL('../public/resource-worker.js',import.meta.url),'utf8')
const origin='https://game.test'
function harness({quota=false,offline=false}={}) {
 const entries=new Map(),calls=[],handlers=new Map()
 const key=r=>new URL(typeof r==='string'?r:r.url,origin).href
 const cache={match:async r=>entries.get(key(r))?.clone(),put:async(r,v)=>{if(quota)throw Error('full');entries.set(key(r),v.clone())}}
 const ctx={self:{location:{origin},addEventListener:(n,f)=>handlers.set(n,f)},caches:{open:async()=>cache,match:cache.match},fetch:async r=>{calls.push(key(r));if(offline)throw Error('offline');assert.equal(r.headers.get('range'),null);return new Response('abcdefghij',{headers:{'content-type':'audio/ogg'}})},Request,Response,Headers,URL,Map,Set}
 vm.runInNewContext(source,ctx)
 return {calls,cache,ctx,async request(path,options={}) {let response;handlers.get('fetch')({request:new Request(origin+path,options),respondWith:p=>response=p});return response?await response:null}}
}
test('audio replay, seek and concurrent first ranges download one full file',async()=>{
 const h=harness();const result=await Promise.all(['bytes=0-2','bytes=3-5','bytes=-2','bytes=8-'].map(range=>h.request('/assets/bgm/song.ogg',{headers:{range}})));
 assert.deepEqual(await Promise.all(result.map(r=>r.text())),['abc','def','ij','ij']);assert.equal(h.calls.length,1);
 const again=await h.request('/assets/bgm/song.ogg',{headers:{range:'bytes=2-4'}});assert.equal(again.status,206);assert.equal(again.headers.get('content-range'),'bytes 2-4/10');assert.equal(await again.text(),'cde');assert.equal(h.calls.length,1)
})
test('invalid byte ranges return 416 without redownloading',async()=>{
 const h=harness();for(const range of ['bytes=10-','bytes=4-2','bytes=-0']){const r=await h.request('/assets/bgm/song.ogg',{headers:{range}});assert.equal(r.status,416)}assert.equal(h.calls.length,1)
})
test('revision changes fetch a fresh asset rather than ignoring the query',async()=>{
 const h=harness();await h.request('/assets/song.ogg?v=old');await h.request('/assets/song.ogg?v=new');await h.request('/assets/song.ogg?v=new');assert.equal(h.calls.length,2)
})
test('API and private no-store responses bypass every persistent cache',async()=>{
 const h=harness();assert.equal(await h.request('/api/account.json'),null);assert.equal(await h.request('/__/auth/iframe.js'),null);assert.equal(await h.request('/resource-manifest.json',{cache:'no-store'}),null);assert.equal(h.calls.length,0)
})
test('quota failures still allow playback and offline errors stay recoverable',async()=>{
 const h=harness({quota:true});const r=await h.request('/assets/song.ogg',{headers:{range:'bytes=0-2'}});assert.equal(await r.text(),'abc');const o=harness({offline:true});await assert.rejects(o.request('/assets/song.ogg'),/offline/);await assert.rejects(o.request('/assets/song.ogg'),/offline/);assert.equal(o.calls.length,2)
})
test('unchanged hashed build chunks survive worker upgrades without another fetch',async()=>{
 const h=harness();await h.cache.put(origin+'/assets/index-12345678.js',new Response('export const value=1'));await h.ctx.precacheBuildGraph(h.cache,[origin+'/assets/index-12345678.js']);assert.equal(h.calls.length,0)
})
