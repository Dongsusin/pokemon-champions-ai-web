import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import {
  claimLocalPlayerData,
  clearPendingGoogleMigration,
  getPlayerDataProgressScore,
  markLocalPlayerDataDirty,
  markLocalPlayerDataSynced,
  readLocalPlayerData,
  readPendingGoogleMigration,
  readPlayerSyncState,
  replaceLocalPlayerData,
} from './accountStorage'
import { loadPlayerGameData, savePlayerGameData } from './playerGameData'
import { getActiveAccountSessionOwnerId, hasActiveAccountSession } from './accountSession'

const CLOUD_SAVE_DEBOUNCE_MS = 700

function canTransferLocalData(syncState, migration, userId) {
  if (!syncState?.ownerUid || syncState.ownerUid === userId) return true
  return migration?.sourceUid === syncState.ownerUid
}

function shouldPreferUnsyncedLocalData(syncState, cloudData, userId) {
  return syncState?.ownerUid === userId
    && syncState.dirty
    && syncState.localUpdatedAt > cloudData.updatedAtMs
}

export function useAccountGameData(user) {
  const userId = user?.uid ?? ''
  const cloudEnabled = Boolean(userId && !user?.isLocalGuest)
  const [ready, setReady] = useState(false)
  const [syncError, setSyncError] = useState('')
  const timerRef = useRef(null)
  const savingRef = useRef(false)
  const pendingRef = useRef(false)
  const generationRef = useRef(0)

  const flush = useCallback(async () => {
    if (!cloudEnabled || !userId || !hasActiveAccountSession(userId)) return
    if (savingRef.current) {
      pendingRef.current = true
      return
    }

    savingRef.current = true
    const generation = generationRef.current
    const ownerId = getActiveAccountSessionOwnerId(userId)
    const isCurrent = () => generationRef.current === generation
      && getActiveAccountSessionOwnerId(userId) === ownerId
    let latestRevision = ''
    try {
      do {
        if (!isCurrent()) return
        pendingRef.current = false
        const payload = readLocalPlayerData()
        const result = await savePlayerGameData(userId, payload)
        latestRevision = result.revision
      } while (pendingRef.current && isCurrent())
      if (!isCurrent()) return
      markLocalPlayerDataSynced(userId, latestRevision)
      setSyncError('')
    } catch {
      if (isCurrent()) setSyncError('게임 데이터를 계정에 저장하지 못했습니다. 연결이 복구되면 다시 동기화합니다.')
    } finally {
      if (generationRef.current === generation) savingRef.current = false
    }
  }, [cloudEnabled, userId])

  const scheduleSave = useCallback(() => {
    if (!cloudEnabled || !userId || !hasActiveAccountSession(userId)) return
    markLocalPlayerDataDirty(userId)
    pendingRef.current = true
    window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      void flush()
    }, CLOUD_SAVE_DEBOUNCE_MS)
  }, [cloudEnabled, flush, userId])

  useEffect(() => {
    generationRef.current += 1
    window.clearTimeout(timerRef.current)
    pendingRef.current = false
    savingRef.current = false
    setSyncError('')

    if (!userId) {
      setReady(true)
      return undefined
    }

    if (!cloudEnabled) {
      const syncState = readPlayerSyncState()
      if (
        syncState?.ownerUid
        && syncState.ownerUid !== userId
        && !syncState.ownerUid.startsWith('local-guest-')
      ) {
        replaceLocalPlayerData({})
      }
      claimLocalPlayerData(userId)
      setReady(true)
      return undefined
    }

    let active = true
    const ownerId = getActiveAccountSessionOwnerId(userId)
    const isCurrent = () => active && ownerId && getActiveAccountSessionOwnerId(userId) === ownerId
    setReady(false)

    const bootstrap = async () => {
      const syncState = readPlayerSyncState()
      const migration = readPendingGoogleMigration()
      const localPayload = readLocalPlayerData()

      try {
        const cloudData = await loadPlayerGameData(userId)
        if (!isCurrent()) return

        if (cloudData) {
          const localTransferAllowed = canTransferLocalData(syncState, migration, userId)
          const isExplicitGuestMigration = migration?.sourceUid === syncState?.ownerUid
          const isFirstDeviceMigration = !syncState?.ownerUid
            && getPlayerDataProgressScore(localPayload) > getPlayerDataProgressScore(cloudData.payload)
          const keepLocalData = localTransferAllowed && (
            isExplicitGuestMigration
            || isFirstDeviceMigration
            || shouldPreferUnsyncedLocalData(syncState, cloudData, userId)
          )

          if (keepLocalData) {
            const result = await savePlayerGameData(userId, localPayload)
            if (!isCurrent()) return
            markLocalPlayerDataSynced(userId, result.revision)
          } else {
            replaceLocalPlayerData(cloudData.payload)
            markLocalPlayerDataSynced(userId, cloudData.revision)
          }
        } else {
          const localTransferAllowed = canTransferLocalData(syncState, migration, userId)
          if (!localTransferAllowed) replaceLocalPlayerData({})
          const result = await savePlayerGameData(userId, readLocalPlayerData())
          if (!isCurrent()) return
          markLocalPlayerDataSynced(userId, result.revision)
        }

        if (migration) clearPendingGoogleMigration()
        if (active) setSyncError('')
      } catch {
        if (!isCurrent()) return
        const localTransferAllowed = canTransferLocalData(syncState, migration, userId)
        if (!localTransferAllowed) replaceLocalPlayerData({})
        claimLocalPlayerData(userId)
        if (active) {
          setSyncError('계정 데이터를 불러오지 못해 이 기기의 저장 데이터를 사용합니다.')
        }
      } finally {
        if (active) setReady(true)
      }
    }

    void bootstrap()

    return () => {
      active = false
      generationRef.current += 1
      pendingRef.current = false
      window.clearTimeout(timerRef.current)
    }
  }, [cloudEnabled, userId])

  useEffect(() => {
    if (!cloudEnabled || !ready) return undefined

    const flushPendingSave = () => {
      if (readPlayerSyncState()?.dirty) {
        window.clearTimeout(timerRef.current)
        void flush()
      }
    }
    const flushWhenHidden = () => {
      if (document.visibilityState === 'hidden') flushPendingSave()
    }
    const retryWhenOnline = () => {
      if (readPlayerSyncState()?.dirty) scheduleSave()
    }

    document.addEventListener('visibilitychange', flushWhenHidden)
    window.addEventListener('pagehide', flushPendingSave)
    window.addEventListener('online', retryWhenOnline)
    return () => {
      document.removeEventListener('visibilitychange', flushWhenHidden)
      window.removeEventListener('pagehide', flushPendingSave)
      window.removeEventListener('online', retryWhenOnline)
    }
  }, [cloudEnabled, flush, ready, scheduleSave])

  return {
    ready,
    syncError,
    flush,
    scheduleSave,
  }
}
