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
    && (!migration.targetUid || migration.targetUid === userId)
}

function shouldPreferUnsyncedLocalData(syncState, cloudData, userId) {
  return syncState?.ownerUid === userId
    && syncState.dirty
    && (syncState.revision
      ? syncState.revision === cloudData.revision
      : syncState.localUpdatedAt > cloudData.updatedAtMs)
}

export function useAccountGameData(user) {
  const userId = user?.uid ?? ''
  const cloudEnabled = Boolean(userId && !user?.isLocalGuest)
  const [ready, setReady] = useState(false)
  const [syncError, setSyncError] = useState('')
  const [retryVersion, setRetryVersion] = useState(0)
  const timerRef = useRef(null)
  const savingRef = useRef(null)
  const bootstrapRef = useRef(null)
  const pausedRef = useRef(false)
  const bootstrapReadyRef = useRef(false)
  const pendingRef = useRef(false)
  const generationRef = useRef(0)

  const flush = useCallback(async () => {
    if (pausedRef.current) return false
    if (!cloudEnabled) return true
    if (!userId || !bootstrapReadyRef.current || !hasActiveAccountSession(userId)) return false
    window.clearTimeout(timerRef.current)
    if (savingRef.current) {
      pendingRef.current = true
      return savingRef.current
    }

    const generation = generationRef.current
    const ownerId = getActiveAccountSessionOwnerId(userId)
    const isCurrent = () => !pausedRef.current && generationRef.current === generation
      && getActiveAccountSessionOwnerId(userId) === ownerId
    const saving = (async () => {
      let latestRevision = ''
      try {
        do {
          if (!isCurrent()) return false
          pendingRef.current = false
          const payload = readLocalPlayerData()
          const result = await savePlayerGameData(userId, payload)
          latestRevision = result.revision
        } while (pendingRef.current && isCurrent())
        if (!isCurrent()) return false
        markLocalPlayerDataSynced(userId, latestRevision)
        setSyncError('')
        return true
      } catch {
        if (isCurrent()) setSyncError('게임 데이터를 계정에 저장하지 못했습니다. 연결을 확인한 뒤 다시 시도해주세요. 이 기기의 진행 기록은 유지됩니다.')
        return false
      }
    })()
    savingRef.current = saving
    try {
      return await saving
    } finally {
      if (savingRef.current === saving) savingRef.current = null
    }
  }, [cloudEnabled, userId])

  const scheduleSave = useCallback(() => {
    if (pausedRef.current || !cloudEnabled || !userId || !bootstrapReadyRef.current || !hasActiveAccountSession(userId)) return
    try {
      markLocalPlayerDataDirty(userId)
    } catch {
      setSyncError('이 기기의 저장 공간이 부족합니다. 저장 공간을 확보한 뒤 다시 시도해주세요.')
    }
    pendingRef.current = true
    window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      void flush()
    }, CLOUD_SAVE_DEBOUNCE_MS)
  }, [cloudEnabled, flush, userId])

  useEffect(() => {
    if (pausedRef.current) return undefined
    generationRef.current += 1
    window.clearTimeout(timerRef.current)
    pendingRef.current = false
    savingRef.current = null
    bootstrapReadyRef.current = false
    setSyncError('')

    if (!userId) {
      setReady(true)
      return undefined
    }

    if (!cloudEnabled) {
      try {
        const syncState = readPlayerSyncState()
        if (
          syncState?.ownerUid
          && syncState.ownerUid !== userId
          && !syncState.ownerUid.startsWith('local-guest-')
        ) {
          replaceLocalPlayerData({})
        }
        claimLocalPlayerData(userId)
        bootstrapReadyRef.current = true
        setReady(true)
      } catch {
        setReady(false)
        setSyncError('이 기기의 저장 공간에 접근하지 못했습니다. 브라우저 저장 설정을 확인한 뒤 다시 시도해주세요.')
      }
      return undefined
    }

    let active = true
    const ownerId = getActiveAccountSessionOwnerId(userId)
    const isCurrent = () => !pausedRef.current && active && ownerId && getActiveAccountSessionOwnerId(userId) === ownerId
    setReady(false)

    const bootstrap = async () => {
      try {
        const syncState = readPlayerSyncState()
        const pendingMigration = readPendingGoogleMigration()
        const migration = !pendingMigration?.targetUid || pendingMigration.targetUid === userId
          ? pendingMigration : null
        const localPayload = readLocalPlayerData()
        const localCopy = syncState?.ownerUid === userId && !syncState.dirty && syncState.revision
          ? { revision: syncState.revision, payload: localPayload }
          : undefined
        const cloudData = await loadPlayerGameData(userId, localCopy)
        if (!isCurrent()) return

        if (cloudData) {
          const localTransferAllowed = canTransferLocalData(syncState, migration, userId)
          const isExplicitGuestMigration = Boolean(migration?.sourceUid)
            && migration.sourceUid === syncState?.ownerUid
          const isFirstDeviceMigration = !syncState?.ownerUid
            && getPlayerDataProgressScore(localPayload) > getPlayerDataProgressScore(cloudData.payload)
          const keepLocalData = localTransferAllowed && (
            (isExplicitGuestMigration && !migration.preserveExistingCloud)
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
          const result = await savePlayerGameData(userId, localTransferAllowed ? localPayload : {})
          if (!isCurrent()) return
          if (!localTransferAllowed) replaceLocalPlayerData({})
          markLocalPlayerDataSynced(userId, result.revision)
        }

        if (migration) clearPendingGoogleMigration()
        bootstrapReadyRef.current = true
        setSyncError('')
        setReady(true)
      } catch {
        if (!isCurrent()) return
        setSyncError('계정 데이터를 불러오지 못했습니다. 저장 기록을 보호하기 위해 게임을 잠시 중단했습니다. 연결을 확인한 뒤 다시 시도해주세요.')
      }
    }

    const bootstrapWork = bootstrap()
    bootstrapRef.current = bootstrapWork
    void bootstrapWork.finally(() => {
      if (bootstrapRef.current === bootstrapWork) bootstrapRef.current = null
    })

    return () => {
      active = false
      bootstrapReadyRef.current = false
      generationRef.current += 1
      pendingRef.current = false
      window.clearTimeout(timerRef.current)
    }
  }, [cloudEnabled, userId, retryVersion])

  const retry = useCallback(() => {
    if (!pausedRef.current) setRetryVersion(value => value + 1)
  }, [])

  const pauseForGuestDeletion = useCallback(async () => {
    // Discard unsent changes, wait for requests already dispatched, and prevent
    // their responses from restoring local data while deletion is in progress.
    pausedRef.current = true
    generationRef.current += 1
    pendingRef.current = false
    window.clearTimeout(timerRef.current)
    await Promise.allSettled([savingRef.current, bootstrapRef.current])
  }, [])

  useEffect(() => {
    if (!cloudEnabled || ready || !syncError) return undefined
    window.addEventListener('online', retry)
    return () => window.removeEventListener('online', retry)
  }, [cloudEnabled, ready, retry, syncError])

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
    retry,
    flush,
    scheduleSave,
    pauseForGuestDeletion,
  }
}
