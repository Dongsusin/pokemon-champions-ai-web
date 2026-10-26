// Temporary migration transport. Only a pre-shared, expiring migration token
// can request fixed, read-only RPC pages. Credentials and SQL are never returned.
export function createMigrationExportHandler({tokenHash,expiresAt,rpc,now=Date.now}) {
 if(!/^[a-f0-9]{64}$/.test(tokenHash)||!Number.isSafeInteger(expiresAt))throw TypeError('Invalid migration access configuration');
 return async request=>{
  const headers={'Cache-Control':'private,no-store','Vary':'Authorization','X-Content-Type-Options':'nosniff'};
  if(request.method!=='POST'||request.headers.has('Origin')||now()>=expiresAt)return new Response('Not found',{status:404,headers});
  const token=request.headers.get('Authorization')??'';
  if(!/^Bearer [a-f0-9]{64}$/.test(token))return new Response('Unauthorized',{status:401,headers});
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token.slice(7)))),b=>b.toString(16).padStart(2,'0')).join('');
  let difference=0;for(let i=0;i<64;i++)difference|=hash.charCodeAt(i)^tokenHash.charCodeAt(i);
  if(difference)return new Response('Unauthorized',{status:401,headers});
  try{
   const reader=request.body?.getReader();if(!reader)throw Error('body');let length=0;const chunks=[];
   for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>4096){await reader.cancel();return new Response('Too large',{status:413,headers});}chunks.push(value);}
   const buffer=new Uint8Array(length);let offset=0;for(const chunk of chunks){buffer.set(chunk,offset);offset+=chunk.length;}
   const {kind='manifest',cursor=[],limit=10}=JSON.parse(new TextDecoder().decode(buffer));
   if(!['manifest','catalog','documents','profiles','sessions','journal','delta'].includes(kind)||!Array.isArray(cursor)||cursor.length>3||cursor.some(x=>typeof x!=='string'||x.length>200)||!Number.isInteger(limit)||limit<1||limit>100)throw Error('invalid');
   const value=await rpc({p_kind:kind,p_cursor:cursor,p_limit:limit});
   const encoded=new Response(JSON.stringify(value)).body.pipeThrough(new CompressionStream('gzip'));
   return new Response(encoded,{headers:{...headers,'Content-Type':'application/octet-stream','X-Migration-Encoding':'gzip'}});
  }catch{return new Response('Export unavailable',{status:503,headers});}
 };
}
