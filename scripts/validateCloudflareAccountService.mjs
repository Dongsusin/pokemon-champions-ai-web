import {readFile,writeFile,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const source=(await readFile(new URL('./validateAccountServer.mjs',import.meta.url),'utf8')).replace("from '../server/rankedStore.js'","from '../cloudflare/test/store-fixture.mjs'");
const temporary=new URL('./.cloudflare-account-service-'+randomUUID()+'.mjs',import.meta.url);
await writeFile(temporary,source,{flag:'wx'});
try{await import(temporary.href);}finally{await unlink(temporary);}
