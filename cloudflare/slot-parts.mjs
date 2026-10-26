export const SLOT_CHUNK=600000;
export function splitSlot(slot) {
 const head={...slot,data:slot.data.slice(0,SLOT_CHUNK)},parts=[];
 for(let offset=SLOT_CHUNK,part=1;offset<slot.data.length;offset+=SLOT_CHUNK,part++)parts.push({slot:slot.slot,part,data:slot.data.slice(offset,offset+SLOT_CHUNK)});
 return {head,parts};
}
export function joinSlotParts(slots,parts) {
 const grouped=new Map();for(const part of parts){const rows=grouped.get(part.slot)??[];rows.push(part);grouped.set(part.slot,rows);}
 return slots.map(slot=>slot.data===null?slot:{...slot,data:slot.data+(grouped.get(slot.slot)??[]).sort((a,b)=>a.part-b.part).map(p=>p.data).join('')});
}
export function jsonBatches(rows,limit=900000){
 const batches=[];let current=[],length=2;
 for(const row of rows){const encoded=JSON.stringify(row),bytes=new TextEncoder().encode(encoded).length+1;if(bytes>limit)throw Error('Record exceeds query budget');if(length+bytes>limit){batches.push(JSON.stringify(current));current=[];length=2;}current.push(row);length+=bytes;}
 if(current.length)batches.push(JSON.stringify(current));return batches;
}
