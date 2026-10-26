import {splitSlot,joinSlotParts} from '../slot-parts.mjs';
import {isDeepStrictEqual} from 'node:util';
import {createHash} from 'node:crypto';
import {packDocument,unpackDocument} from '../../server/cloudflareCodec.js';
export function importRecord(db,kind,row) {
 if(kind!=='documents')throw Error('Unsupported document kind');
 const packed=packDocument(row.collection,row.payload);
 const version=createHash('sha256').update(JSON.stringify(row)).digest('hex');
 const meta=JSON.stringify(packed.value);
 if(Buffer.byteLength(meta)>1900000)throw Error('Document exceeds D1 row budget');
 db.prepare('INSERT INTO documents(namespace,collection,key,version,payload) VALUES(?,?,?,?,?)').run(row.namespace,row.collection,row.key,version,meta);
 for(const encoded of packed.slots){const {head:slot,parts}=splitSlot(encoded);for(const p of parts)db.prepare('INSERT INTO document_slot_overflow(namespace,collection,key,slot,part,data) VALUES(?,?,?,?,?,?)').run(row.namespace,row.collection,row.key,p.slot,p.part,p.data);db.prepare('INSERT INTO document_slots(namespace,collection,key,slot,data,hash,bytes) VALUES(?,?,?,?,?,?,?)').run(row.namespace,row.collection,row.key,slot.slot,slot.data,slot.hash,slot.bytes);}
 db.prepare('INSERT INTO collection_versions(namespace,collection,version) VALUES(?,?,?) ON CONFLICT(namespace,collection) DO UPDATE SET version=excluded.version').run(row.namespace,row.collection,version);
 const record=db.prepare('SELECT payload FROM documents WHERE namespace=? AND collection=? AND key=?').get(row.namespace,row.collection,row.key);
 const slots=db.prepare('SELECT slot,data,hash,bytes FROM document_slots WHERE namespace=? AND collection=? AND key=?').all(row.namespace,row.collection,row.key);
 const parts=db.prepare('SELECT slot,part,data FROM document_slot_overflow WHERE namespace=? AND collection=? AND key=?').all(row.namespace,row.collection,row.key);
 const roundtrip=unpackDocument(row.collection,{value:JSON.parse(record.payload),slots:joinSlotParts(slots,parts)});
 if(!isDeepStrictEqual(roundtrip,row.payload))throw Error('Document roundtrip mismatch');
}
