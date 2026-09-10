import {
  doc,
  getDoc,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore'
import { firebaseDb } from './firebaseClient'
import { getActiveAccountSessionOwnerId } from './accountSession'

const GAME_DATA_SCHEMA_VERSION = 1
const COLLECTION_STORAGE_KEYS = new Set([
  'champions-dex-v2',
  'champions-box-v1',
])

function gameDataReference(userId, documentId) {
  return doc(firebaseDb, 'players', userId, 'gameData', documentId)
}

function sanitizePayload(payload) {
  return Object.entries(payload ?? {}).reduce((result, [key, value]) => {
    if (typeof key === 'string' && typeof value === 'string') result[key] = value
    return result
  }, {})
}

function splitPayload(payload) {
  const core = {}
  const collection = {}

  for (const [key, value] of Object.entries(sanitizePayload(payload))) {
    if (COLLECTION_STORAGE_KEYS.has(key)) collection[key] = value
    else core[key] = value
  }

  return { core, collection }
}

function timestampMillis(value) {
  if (typeof value?.toMillis === 'function') return value.toMillis()
  return 0
}

function createRevision() {
  const randomId = globalThis.crypto?.randomUUID?.()
    ?? Math.random().toString(36).slice(2)
  return `${Date.now()}-${randomId}`
}

export async function loadPlayerGameData(userId) {
  if (!firebaseDb || !userId) return null

  const [coreSnapshot, collectionSnapshot] = await Promise.all([
    getDoc(gameDataReference(userId, 'progress')),
    getDoc(gameDataReference(userId, 'collection')),
  ])

  if (!coreSnapshot.exists() && !collectionSnapshot.exists()) return null

  const coreData = coreSnapshot.exists() ? coreSnapshot.data() : {}
  const collectionData = collectionSnapshot.exists() ? collectionSnapshot.data() : {}
  const updatedAtMs = Math.max(
    timestampMillis(coreData.updatedAt),
    timestampMillis(collectionData.updatedAt),
  )

  return {
    schemaVersion: Math.max(
      Number(coreData.schemaVersion) || 0,
      Number(collectionData.schemaVersion) || 0,
    ),
    revision: coreData.revision || collectionData.revision || '',
    updatedAtMs,
    payload: {
      ...sanitizePayload(coreData.payload),
      ...sanitizePayload(collectionData.payload),
    },
  }
}

export async function savePlayerGameData(userId, payload) {
  if (!firebaseDb || !userId) throw new Error('Firebase game data storage is unavailable.')
  const sessionOwnerId = getActiveAccountSessionOwnerId(userId)
  if (!sessionOwnerId) throw new Error('An active account session is required to save game data.')

  const revision = createRevision()
  const split = splitPayload(payload)
  const batch = writeBatch(firebaseDb)
  const sharedMetadata = {
    uid: userId,
    sessionOwnerId,
    schemaVersion: GAME_DATA_SCHEMA_VERSION,
    revision,
    updatedAt: serverTimestamp(),
  }

  batch.set(gameDataReference(userId, 'progress'), {
    ...sharedMetadata,
    payload: split.core,
  })
  batch.set(gameDataReference(userId, 'collection'), {
    ...sharedMetadata,
    payload: split.collection,
  })
  await batch.commit()

  return { revision }
}

export async function deletePlayerGameData(userId) {
  if (!firebaseDb || !userId) return

  const batch = writeBatch(firebaseDb)
  batch.delete(gameDataReference(userId, 'progress'))
  batch.delete(gameDataReference(userId, 'collection'))
  await batch.commit()
}
