import {gzipSync,gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
const bytes=value=>Buffer.from(JSON.stringify(value),'utf8');
export const hashValue=value=>createHash('sha256').update(bytes(value)).digest('hex');
export function encodeSlot(slot,value){const raw=bytes(value);return {slot,data:gzipSync(raw,{level:6}).toString('base64'),hash:hashValue(value),bytes:raw.length};}
export function decodeSlot(row){const raw=gunzipSync(Buffer.from(row.data,'base64'),{maxOutputLength:8*1024*1024});if(raw.length!==row.bytes||createHash('sha256').update(raw).digest('hex')!==row.hash)throw Error('Stored save checksum mismatch');return JSON.parse(raw.toString('utf8'));}
export function packDocument(collection,value){
 if(collection!=='gameData')return {value,slots:[],replaceSlots:true};
 const {payload,...metadata}=value;
 return {value:metadata,slots:Object.entries(payload??{}).map(([key,v])=>encodeSlot(key,v)),replaceSlots:true};
}
export function unpackDocument(collection,row){
 if(!row)return null;
 if(collection!=='gameData')return structuredClone(row.value);
 return {...row.value,payload:Object.fromEntries((row.slots??[]).map(s=>[s.slot,decodeSlot(s)]))};
}
