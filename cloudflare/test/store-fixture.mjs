import {readFileSync} from 'node:fs';
import {sqliteD1} from './d1-sqlite.mjs';
import {createD1DocumentApi} from '../document-store.mjs';
import {createCloudflareStore} from '../../server/cloudflareStore.js';
import {packDocument,unpackDocument} from '../../server/cloudflareCodec.js';
const schema=readFileSync(new URL('../migrations/0001_documents.sql',import.meta.url),'utf8');
export function createMemoryRankedStore(initial={version:1,collections:{}}){
 const db=sqliteD1(schema),ns='test';
 for(const [c,entries] of Object.entries(initial.collections)){
  db.sqlite.prepare('INSERT INTO collection_versions VALUES(?,?,?)').run(ns,c,'seed');
  for(const [key,value] of Object.entries(entries)){
   const packed=packDocument(c,value);db.sqlite.prepare('INSERT INTO documents VALUES(?,?,?,?,?)').run(ns,c,key,'seed',JSON.stringify(packed.value));
   for(const s of packed.slots)db.sqlite.prepare('INSERT INTO document_slots VALUES(?,?,?,?,?,?,?)').run(ns,c,key,s.slot,s.data,s.hash,s.bytes);
  }
 }
 const store=createCloudflareStore({namespace:ns,request:createD1DocumentApi(db),retryDelay:async()=>{}});
 return {...store,async inspect(){const collections={};for(const r of db.sqlite.prepare('SELECT collection FROM collection_versions WHERE namespace=?').all(ns))collections[r.collection]={};for(const row of db.sqlite.prepare('SELECT * FROM documents WHERE namespace=?').all(ns)){collections[row.collection]??={};collections[row.collection][row.key]=unpackDocument(row.collection,{value:JSON.parse(row.payload),slots:db.sqlite.prepare('SELECT * FROM document_slots WHERE namespace=? AND collection=? AND key=?').all(ns,row.collection,row.key)});}return {version:1,collections};}};
}
