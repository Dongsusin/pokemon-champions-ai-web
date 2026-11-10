import {splitSlot,joinSlotParts,jsonBatches} from './slot-parts.mjs';
const valid=x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(x);
const error=code=>{throw Object.assign(new Error(code),{code});};
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
export function createD1DocumentApi(db){
 const q=(sql,...args)=>db.prepare(sql).bind(...args);
 const witnessesSql="NOT EXISTS(SELECT 1 FROM json_each(?) r WHERE CASE WHEN json_extract(r.value,'$.list')=1 THEN COALESCE((SELECT version FROM collection_versions WHERE namespace=? AND collection=json_extract(r.value,'$.collection')),'') ELSE COALESCE((SELECT version FROM documents WHERE namespace=? AND collection=json_extract(r.value,'$.collection') AND key=json_extract(r.value,'$.key')),'') END <> json_extract(r.value,'$.version'))";
 const slots=(ns,c,key,keys=null,metadataOnly=false)=>q('SELECT slot,hash,bytes,CASE WHEN ?=1 THEN NULL WHEN ? IS NULL OR slot IN (SELECT value FROM json_each(?)) THEN data ELSE NULL END AS data FROM document_slots WHERE namespace=? AND collection=? AND key=?',metadataOnly?1:0,keys===null?null:JSON.stringify(keys),JSON.stringify(keys),ns,c,key);
 return async body=>{
  const {action,namespace:ns,collection:c,key}=body;
  if(!valid(ns))error('INVALID');
  if(['get','list'].includes(action)&&(!valid(c)||(action==='get'&&!valid(key))))error('INVALID');
  if(action==='get'){
   let sql='SELECT version,payload FROM documents WHERE namespace=? AND collection=? AND key=?',args=[ns,c,key];
   if(body.projection==='unchangedMatch'){
    sql="SELECT version, CASE WHEN json_extract(payload,'$.roomId') IS NULL AND json_extract(payload,'$.phase') IN ('select','battle') AND json_extract(payload,'$.revision')=? AND json_extract(payload,'$.timelineRevision')=? AND json_type(payload,'$.deadlineAt') IN ('integer','real') AND json_extract(payload,'$.deadlineAt')>? AND EXISTS(SELECT 1 FROM json_each(payload,'$.players') WHERE json_extract(value,'$.uid')=?) THEN json_set(json_remove(payload,'$.state','$.requests','$.players'),'$.players',json((SELECT json_group_array(json(json_remove(value,'$.team'))) FROM json_each(payload,'$.players')))) ELSE NULL END AS payload FROM documents WHERE namespace=? AND collection='matches' AND key=?";
    args=[body.revision,body.timelineRevision,body.timestamp,body.uid,ns,key];
   }
   const reads=[q(sql,...args)];if(c==='gameData')reads.push(slots(ns,c,key,body.slotKeys??null,body.metadataOnly===true));
   if(c==='gameData'&&!body.metadataOnly)reads.push(q('SELECT slot,part,data FROM document_slot_overflow WHERE namespace=? AND collection=? AND key=? AND (? IS NULL OR slot IN (SELECT value FROM json_each(?))) ORDER BY slot,part',ns,c,key,body.slotKeys==null?null:JSON.stringify(body.slotKeys),JSON.stringify(body.slotKeys??null)));
   const result=await db.batch(reads),row=result[0].results[0];
   return row?{version:row.version,value:row.payload===null?null:JSON.parse(row.payload),...(c==='gameData'?{slots:joinSlotParts(result[1].results,result[2]?.results??[])}:{})}:null;
  }
  if(action==='list'){
   if(c==='gameData')error('INVALID');
   const rows=await db.batch([q('SELECT version FROM collection_versions WHERE namespace=? AND collection=?',ns,c),q('SELECT key,version,payload FROM documents WHERE namespace=? AND collection=? ORDER BY key',ns,c)]);
   return {version:rows[0].results[0]?.version??'',rows:rows[1].results.map(r=>({key:r.key,version:r.version,value:JSON.parse(r.payload)}))};
  }
  if(action==='select') {
   const spec={
    rankedProfiles:{collection:'players',fields:"json_remove(payload,'$.queueTicket','$.activeMatchId','$.roomId','$.roomResult')",where:'1'},
    guestMatches:{collection:'matches',fields:"json_set(json_remove(payload,'$.state','$.selections','$.pendingActions','$.requests','$.players'),'$.players',json((SELECT json_group_array(json(json_set(json_remove(value,'$.team'),'$.team',json('[]')))) FROM json_each(payload,'$.players'))),'$.hadBattleState',json(CASE WHEN json_type(payload,'$.state') NOT IN ('null') THEN 'true' ELSE 'false' END))",where:"EXISTS(SELECT 1 FROM json_each(payload,'$.players') WHERE json_extract(value,'$.uid')=?)"},
    guestPlayers:{collection:'players',fields:'payload',where:"EXISTS(SELECT 1 FROM json_each(payload,'$.roomResult.standings') WHERE json_extract(value,'$.uid')=?)"},
    guestUsage:{collection:'pokemonUsageEvents',fields:"'{}'",where:"json_extract(payload,'$.owner')=?"},
    factoryCandidates:{collection:'factoryPersonalBest',fields:'payload',where:"key<>? AND COALESCE(json_extract(payload,'$.owner'),'')<>?",suffix:" ORDER BY json_extract(payload,'$.floor') DESC,json_extract(payload,'$.recordedAt') ASC,key ASC LIMIT 10"},
   }[body.projection];
   if(!spec || (body.projection!=='rankedProfiles'&&(typeof body.owner!=='string'||body.owner.length>256)))error('INVALID');
   const params=body.projection==='rankedProfiles'?[]:body.projection==='factoryCandidates'?[body.owner,body.owner]:[body.owner];
   const result=await db.batch([q('SELECT version FROM collection_versions WHERE namespace=? AND collection=?',ns,spec.collection),q('SELECT key,version,'+spec.fields+' AS payload FROM documents WHERE namespace=? AND collection=? AND '+spec.where+(spec.suffix??''),ns,spec.collection,...params)]);
   return {version:result[0].results[0]?.version??'',rows:result[1].results.map(r=>({key:r.key,version:r.version,value:JSON.parse(r.payload)}))};
  }
  if(action==='renewLease') {
   const {uid,ownerId,expectedVersion,nextVersion,nowMs,expiresAt,guestDeletionKey=null,id}=body;
   if(![uid,ownerId,expectedVersion,nextVersion,id].every(valid)||(guestDeletionKey!==null&&!valid(guestDeletionKey))||!Number.isSafeInteger(nowMs)||!Number.isSafeInteger(expiresAt)||expiresAt<=nowMs)error('INVALID');
   const r=await db.batch([
    q("UPDATE documents SET version=?,payload=json_set(payload,'$.version',?,'$.expiresAt',?) WHERE namespace=? AND collection='sessions' AND key=? AND json_extract(payload,'$.ownerId')=? AND json_extract(payload,'$.version')=? AND json_extract(payload,'$.expiresAt')>? AND (? IS NULL OR NOT EXISTS(SELECT 1 FROM documents WHERE namespace=? AND collection='guestDeletions' AND key=?))",id,nextVersion,expiresAt,ns,uid,ownerId,expectedVersion,nowMs,guestDeletionKey,ns,guestDeletionKey),
    q("INSERT INTO collection_versions(namespace,collection,version) SELECT ?,'sessions',? WHERE EXISTS(SELECT 1 FROM documents WHERE namespace=? AND collection='sessions' AND key=? AND version=?) ON CONFLICT(namespace,collection) DO UPDATE SET version=excluded.version",ns,id,ns,uid,id),
    q("SELECT payload FROM documents WHERE namespace=? AND collection='sessions' AND key=? AND version=?",ns,uid,id),
    q("SELECT 1 FROM documents WHERE namespace=? AND collection='guestDeletions' AND key=?",ns,guestDeletionKey),
   ]);
   return {guestDeleted:r[3].results.length>0,session:r[2].results.length?{ownerId,version:nextVersion,expiresAt}:null};
  }
  if(action==='countSessions') {
   if(!Number.isSafeInteger(body.timestamp)||body.timestamp<0)error('INVALID');
   const row=await q("SELECT COUNT(*) AS count FROM documents WHERE namespace=? AND collection='sessions' AND json_type(payload,'$.expiresAt') IN ('integer','real') AND json_extract(payload,'$.expiresAt')>?",ns,body.timestamp).first();return row;
  }
  if(action==='countQueue'){
   if(!Number.isSafeInteger(body.timestamp)||body.timestamp<0)error('INVALID');
   const row=await q("SELECT COALESCE(SUM(json_extract(q.payload,'$.format')='single'),0) AS single, COALESCE(SUM(json_extract(q.payload,'$.format')='double'),0) AS double,MIN(json_extract(q.payload,'$.expiresAt')) AS nextExpiry FROM documents q JOIN documents p ON p.namespace=q.namespace AND p.collection='players' AND p.key=q.key WHERE q.namespace=? AND q.collection='queue' AND json_extract(q.payload,'$.format') IN ('single','double') AND json_extract(q.payload,'$.uid')=q.key AND json_type(q.payload,'$.ticket')='text' AND json_extract(q.payload,'$.ticket')<>'' AND json_extract(p.payload,'$.queueTicket')=json_extract(q.payload,'$.ticket') AND COALESCE(json_extract(p.payload,'$.activeMatchId'),'')='' AND json_type(q.payload,'$.expiresAt')='integer' AND json_extract(q.payload,'$.expiresAt')>? AND json_extract(q.payload,'$.expiresAt')<=9007199254740991",ns,body.timestamp).first();return row;
  }
  if(action!=='commit'||!valid(body.id)||!Array.isArray(body.reads)||!Array.isArray(body.writes)||body.reads.length>20000||body.writes.length>20000)error('INVALID');
  for(const r of body.reads)if(!valid(r.collection)||(!r.list&&!valid(r.key))||typeof r.version!=='string')error('INVALID');
  const witnesses=JSON.stringify(body.reads),writes=body.writes;
  if(!writes.length){const row=await q('SELECT '+witnessesSql+' AS valid',witnesses,ns,ns).first();if(!row.valid)error('STORE_CONFLICT');return {ok:true};}
  const flattened=[];
  for(const w of writes){if(!valid(w.collection)||!valid(w.key)||(!w.deleted&&!plain(w.value)))error('INVALID');if(w.value&&new TextEncoder().encode(JSON.stringify(w.value)).length>1900000)error('INVALID');for(const slot of w.slots??[]){if(w.collection!=='gameData'||typeof slot.slot!=='string'||slot.slot.length>200||typeof slot.data!=='string'||slot.data.length>12000000||!/^[a-f0-9]{64}$/.test(slot.hash)||!Number.isSafeInteger(slot.bytes)||slot.bytes<0||slot.bytes>8*1024*1024)error('INVALID');flattened.push({...slot,collection:w.collection,key:w.key});}}
  const changes=JSON.stringify(writes.map(({slots,...w})=>w));
  if(new TextEncoder().encode(changes).length>1900000)error('INVALID');
  const heads=[],parts=[];for(const slot of flattened){const split=splitSlot(slot);heads.push(split.head);parts.push(...split.parts.map(part=>({...part,collection:slot.collection,key:slot.key})));}
  const addresses=JSON.stringify(flattened.map(({collection,key,slot})=>({collection,key,slot})));
  const headBatches=jsonBatches(heads),partBatches=jsonBatches(parts);
  const batch=[
   // A stale witness still fails CHECK(valid=1) and rolls back the whole batch.
   // Valid batches insert no guard row, avoiding an insert/delete on every save.
   q('INSERT INTO transaction_guard(id,valid) SELECT ?,0 WHERE NOT ('+witnessesSql+')',body.id,witnesses,ns,ns),
   q("DELETE FROM document_slot_overflow WHERE namespace=? AND (collection,key) IN (SELECT json_extract(value,'$.collection'),json_extract(value,'$.key') FROM json_each(?)) AND (EXISTS(SELECT 1 FROM json_each(?) w WHERE json_extract(w.value,'$.collection')=document_slot_overflow.collection AND json_extract(w.value,'$.key')=document_slot_overflow.key AND (json_extract(w.value,'$.deleted')=1 OR json_extract(w.value,'$.replaceSlots')=1 OR document_slot_overflow.slot IN (SELECT value FROM json_each(w.value,'$.removedSlots')))) OR EXISTS(SELECT 1 FROM json_each(?) w WHERE json_extract(w.value,'$.collection')=document_slot_overflow.collection AND json_extract(w.value,'$.key')=document_slot_overflow.key AND json_extract(w.value,'$.slot')=document_slot_overflow.slot))",ns,changes,changes,addresses),
   q("DELETE FROM document_slots WHERE namespace=? AND (collection,key) IN (SELECT json_extract(value,'$.collection'),json_extract(value,'$.key') FROM json_each(?)) AND EXISTS(SELECT 1 FROM json_each(?) w WHERE json_extract(w.value,'$.collection')=document_slots.collection AND json_extract(w.value,'$.key')=document_slots.key AND (json_extract(w.value,'$.deleted')=1 OR json_extract(w.value,'$.replaceSlots')=1 OR document_slots.slot IN (SELECT value FROM json_each(w.value,'$.removedSlots'))))",ns,changes,changes),
   q("INSERT INTO documents(namespace,collection,key,version,payload) SELECT ?,json_extract(value,'$.collection'),json_extract(value,'$.key'),?,json_extract(value,'$.value') FROM json_each(?) WHERE COALESCE(json_extract(value,'$.deleted'),0)=0 ON CONFLICT(namespace,collection,key) DO UPDATE SET version=excluded.version,payload=excluded.payload",ns,body.id,changes),
   q("DELETE FROM documents WHERE namespace=? AND (collection,key) IN (SELECT json_extract(value,'$.collection'),json_extract(value,'$.key') FROM json_each(?) WHERE json_extract(value,'$.deleted')=1)",ns,changes),
   ...headBatches.map(compressed=>q("INSERT INTO document_slots(namespace,collection,key,slot,data,hash,bytes) SELECT ?,json_extract(value,'$.collection'),json_extract(value,'$.key'),json_extract(value,'$.slot'),json_extract(value,'$.data'),json_extract(value,'$.hash'),json_extract(value,'$.bytes') FROM json_each(?) WHERE 1 ON CONFLICT(namespace,collection,key,slot) DO UPDATE SET data=excluded.data,hash=excluded.hash,bytes=excluded.bytes WHERE document_slots.hash<>excluded.hash",ns,compressed)),
   ...partBatches.map(partial=>q("INSERT INTO document_slot_overflow(namespace,collection,key,slot,part,data) SELECT ?,json_extract(value,'$.collection'),json_extract(value,'$.key'),json_extract(value,'$.slot'),json_extract(value,'$.part'),json_extract(value,'$.data') FROM json_each(?)",ns,partial)),
   q("INSERT INTO collection_versions(namespace,collection,version) SELECT ?,json_extract(value,'$.collection'),? FROM json_each(?) WHERE 1 GROUP BY json_extract(value,'$.collection') ON CONFLICT(namespace,collection) DO UPDATE SET version=excluded.version",ns,body.id,changes),
  ];
  try{await db.batch(batch);}catch(e){if(/CHECK constraint failed.*valid|CHECK constraint failed: valid=1/.test(e.message))error('STORE_CONFLICT');throw e;}
  return {ok:true};
 };
}
