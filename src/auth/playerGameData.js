import {
  doc,
  getDoc,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore'
import { firebaseAuth, firebaseDb } from './firebaseClient'
import { getActiveAccountSessionOwnerId } from './accountSession'
import { isServerGameStorage } from './gameStorageConfig.js'
import { AccountRequestError, createAccountApiClient } from './accountApiClient.js'
import { createAccountSavePatch } from './accountSavePatch.js'

const GAME_DATA_SCHEMA_VERSION = 1
const accountSaveSequences = new Map()
let saveBaseline = null
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

export function createPlayerAccountClient(userId) {
  const authenticatedUser = firebaseAuth?.currentUser
  if (!userId || authenticatedUser?.uid !== userId || typeof authenticatedUser.getIdToken !== 'function') {
    throw new AccountRequestError('현재 로그인 계정의 저장 기록만 사용할 수 있습니다.', 'account/identity-changed', 401)
  }
  return createAccountApiClient({
    getIdToken: authenticatedUser.getIdToken.bind(authenticatedUser),
    isCurrent: () => firebaseAuth?.currentUser?.uid === userId,
  })
}

export function requireAccountSessionOwner(userId) {
  const ownerId = getActiveAccountSessionOwnerId(userId)
  if (!ownerId) throw new AccountRequestError('게임 데이터를 사용하려면 활성 접속이 필요합니다.', 'account-session/lost', 409)
  return ownerId
}

function validateServerGameData(data) {
  if (data === null) return null
  if (!data || typeof data !== 'object' || !Number.isSafeInteger(data.schemaVersion) || data.schemaVersion < 1
    || typeof data.revision !== 'string' || !data.revision || !Number.isFinite(data.updatedAtMs)
    || !data.payload || typeof data.payload !== 'object' || Array.isArray(data.payload)
    || Object.values(data.payload).some(value => typeof value !== 'string')) {
    throw new AccountRequestError('서버 저장 기록을 확인하지 못했습니다.', 'account/invalid-response')
  }
  return data
}

export async function loadPlayerGameData(userId) {
  if (isServerGameStorage) {
    const ownerId = requireAccountSessionOwner(userId)
    saveBaseline = null
    const result = await createPlayerAccountClient(userId).request('load', { ownerId, patchVersion: 2 })
    const data = validateServerGameData(result.gameData)
    if ([1, 2].includes(result.savePatchVersion) && getActiveAccountSessionOwnerId(userId) === ownerId) {
      saveBaseline = { userId, ownerId, revision: data?.revision ?? null, patchVersion: result.savePatchVersion, payload: { ...data?.payload } }
    }
    return data
  }
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
  if (isServerGameStorage) {
    const ownerId = requireAccountSessionOwner(userId)
    const client = createPlayerAccountClient(userId)
    const nextPayload = { ...payload }
    const baseline = saveBaseline?.userId === userId && saveBaseline.ownerId === ownerId ? saveBaseline : null
    const delta = baseline?.revision ? createAccountSavePatch(baseline.payload, nextPayload, { splices: baseline.patchVersion === 2 }) : null
    if (delta && !Object.keys(delta.patch).length && !delta.removed.length && !Object.keys(delta.splices ?? {}).length) return { revision: baseline.revision }
    const revision = createRevision()
    // A timed-out HTTP request can still reach the database. Ordering belongs to
    // the entire lease, so a late older save cannot replace a newer confirmed one.
    // Heartbeat versions change within that lease and must not reset this count.
    const saveSequence = (accountSaveSequences.get(ownerId) ?? 0) + 1
    if (!Number.isSafeInteger(saveSequence)) throw new AccountRequestError('저장 세션을 다시 시작해주세요.', 'account-session/lost', 409)
    accountSaveSequences.set(ownerId, saveSequence)
    // While a write is uncertain, no overlapping caller may skip a save using
    // the old baseline. Restore it only after the newest write is confirmed.
    saveBaseline = null
    try {
      let result
      try {
        result = delta
          ? await client.request('savePatch', { ownerId, revision, saveSequence, baseRevision: baseline.revision, ...delta })
          : await client.request('save', { ownerId, revision, payload: nextPayload, saveSequence })
      } catch (error) {
        // Only a rejected base (never a stale sequence/auth/network failure)
        // permits a full retry. Keep the sequence so a newer save always wins.
        if (!delta || error.code !== 'SAVE_BASE_MISMATCH') throw error
        result = await client.request('save', { ownerId, revision, payload: nextPayload, saveSequence })
      }
      if (result.revision !== revision) throw new AccountRequestError('서버 저장 결과를 확인하지 못했습니다.', 'account/invalid-response')
      if (baseline && getActiveAccountSessionOwnerId(userId) === ownerId && accountSaveSequences.get(ownerId) === saveSequence) {
        saveBaseline = { userId, ownerId, revision, patchVersion: baseline.patchVersion, payload: nextPayload }
      }
    } catch (error) {
      if (saveBaseline?.ownerId === ownerId && accountSaveSequences.get(ownerId) === saveSequence) saveBaseline = null
      throw error
    }
    return { revision }
  }
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
  if (saveBaseline?.userId === userId) saveBaseline = null
  if (isServerGameStorage) {
    const ownerId = requireAccountSessionOwner(userId)
    await createPlayerAccountClient(userId).request('deleteGameData', { ownerId })
    return
  }
  if (!firebaseDb || !userId) return

  const batch = writeBatch(firebaseDb)
  batch.delete(gameDataReference(userId, 'progress'))
  batch.delete(gameDataReference(userId, 'collection'))
  await batch.commit()
}
