import {createD1DocumentApi} from './document-store.mjs';
const same=(a,b)=>{if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;};
export default {async fetch(request,env){
 const path=new URL(request.url).pathname;
 if(path==='/health'&&request.method==='GET')return Response.json({service:'champions-store',version:1},{headers:{'Cache-Control':'public,max-age=60'}});
 const headers={'Cache-Control':'private,no-store'};
 if(path!=='/internal/store'||request.method!=='POST')return new Response('Not found',{status:404,headers});
 if(request.headers.has('Origin')||typeof env.STORE_TOKEN!=='string'||env.STORE_TOKEN.length<32||!same(request.headers.get('Authorization'),'Bearer '+env.STORE_TOKEN))return new Response('Unauthorized',{status:401,headers});
 if(env.DATA_READY!=='true')return new Response('Migration incomplete',{status:503,headers});
 try{
  if(Number(request.headers.get('Content-Length'))>4000000)return new Response('Too large',{status:413,headers});
  const reader=request.body?.getReader();if(!reader)throw Error();let size=0;const chunks=[];
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>4000000){await reader.cancel();return new Response('Too large',{status:413,headers});}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  const body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  return Response.json(await createD1DocumentApi(env.DB)(body),{headers});
 }catch(error){return Response.json({error:error?.code==='STORE_CONFLICT'?'conflict':'unavailable'},{status:error?.code==='STORE_CONFLICT'?409:error?.code==='INVALID'?400:503,headers});}
}};
