import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { encodeSlot } from '../server/cloudflareCodec.js'
import { splitSlot } from '../cloudflare/slot-parts.mjs'
import { readDocuments, documentDigest } from '../cloudflare/migration/export-to-postgres.mjs'

function fixture() {
  const db = new DatabaseSync(':memory:')
  db.exec(readFileSync(new URL('../cloudflare/migrations/0001_documents.sql', import.meta.url), 'utf8'))
  return db
}

test('reassembles save slots and keeps the exact namespace, payload, revision and lease metadata', () => {
  const db = fixture()
  const metadata = { revision: 'save-5', lastSaveSequence: 5, updatedAtMs: 123, patchHash: 'pending' }
  db.prepare('INSERT INTO documents VALUES (?,?,?,?,?)').run('account', 'gameData', 'u', 'worker-version', JSON.stringify(metadata))
  const box = JSON.stringify({ name: '피카츄😀', moves: ['thunder'], count: 12 })
  const slot = encodeSlot('box', box)
  const { head } = splitSlot(slot)
  db.prepare('INSERT INTO document_slots VALUES (?,?,?,?,?,?,?)').run('account', 'gameData', 'u', head.slot, head.data.slice(0, 20), head.hash, head.bytes)
  db.prepare('INSERT INTO document_slot_overflow VALUES (?,?,?,?,?,?)').run('account', 'gameData', 'u', 'box', 1, head.data.slice(20))
  db.prepare('INSERT INTO documents VALUES (?,?,?,?,?)').run('ranked', 'matches', 'm', 'v', '{"phase":"battle","state":{"turn":2}}')
  assert.deepEqual([...readDocuments(db)], [
    { namespace: 'account', collection: 'gameData', key: 'u', payload: { ...metadata, payload: { box } } },
    { namespace: 'ranked', collection: 'matches', key: 'm', payload: { phase: 'battle', state: { turn: 2 } } },
  ])
  db.close()
})

test('rejects a truncated or corrupt save instead of migrating an empty slot', () => {
  const db = fixture()
  db.prepare('INSERT INTO documents VALUES (?,?,?,?,?)').run('account', 'gameData', 'u', 'v', '{}')
  const slot = encodeSlot('box', 'value')
  db.prepare('INSERT INTO document_slots VALUES (?,?,?,?,?,?,?)').run('account', 'gameData', 'u', 'box', slot.data, '0'.repeat(64), slot.bytes)
  assert.throws(() => [...readDocuments(db)], /checksum/)
  db.close()
})

test('digest ignores object key order and distinguishes changed saves and addresses', () => {
  const first = { namespace: 'account', collection: 'gameData', key: 'u', payload: { a: 1, b: ['x', null] } }
  assert.equal(documentDigest(first), documentDigest({ ...first, payload: { b: ['x', null], a: 1 } }))
  assert.notEqual(documentDigest(first), documentDigest({ ...first, key: 'other' }))
  assert.notEqual(documentDigest(first), documentDigest({ ...first, payload: { ...first.payload, a: 2 } }))
})
