import { createHash } from 'node:crypto'
import { joinSlotParts } from '../slot-parts.mjs'
import { unpackDocument } from '../../server/cloudflareCodec.js'

// The Postgres store keeps all save slots inside payload. D1's transport
// version belongs to its optimistic locking protocol, outside that payload.
export function* readDocuments(db) {
  const orphan = db.prepare("SELECT 1 FROM document_slots s LEFT JOIN documents d USING(namespace,collection,key) WHERE d.key IS NULL OR s.collection <> 'gameData' LIMIT 1").get()
  const orphanPart = db.prepare('SELECT 1 FROM document_slot_overflow p LEFT JOIN document_slots s USING(namespace,collection,key,slot) WHERE s.slot IS NULL LIMIT 1').get()
  if (orphan || orphanPart) throw new Error('Export contains detached save slots')
  const heads = db.prepare('SELECT slot, data, hash, bytes FROM document_slots WHERE namespace=? AND collection=? AND key=?')
  const parts = db.prepare('SELECT slot, part, data FROM document_slot_overflow WHERE namespace=? AND collection=? AND key=? ORDER BY slot,part')
  const rows = db.prepare('SELECT namespace, collection, key, payload FROM documents ORDER BY namespace,collection,key')
  for (const row of rows.iterate()) {
    const { namespace, collection, key } = row
    const value = JSON.parse(row.payload)
    const slots = collection === 'gameData'
      ? joinSlotParts(heads.all(namespace, collection, key), parts.all(namespace, collection, key))
      : []
    yield { namespace, collection, key, payload: unpackDocument(collection, { value, slots }) }
  }
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
}

export function documentDigest(row) {
  return createHash('sha256').update(JSON.stringify(canonical(row))).digest('hex')
}
