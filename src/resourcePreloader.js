import { useEffect, useState } from 'react'

const RESOURCE_MANIFEST_URL = '/resource-manifest.json'
const RESOURCE_CACHE_NAME = 'champions-arena-resource-cache-v1'
const RESOURCE_CACHE_MARKER_URL = '/__champions-arena-resource-cache-marker__'
const RESOURCE_REQUEST_TIMEOUT = 15000
const PRELOAD_CONCURRENCY = 4

const GROUP_LABELS = {
  interface: '인터페이스 준비',
}

let preloadPromise = null
let preloadState = {
  status: 'idle',
  phase: 'manifest',
  loaded: 0,
  total: 0,
  loadedBytes: 0,
  totalBytes: 0,
  percent: 0,
  currentGroup: 'interface',
  cached: 0,
  failed: 0,
  error: '',
}
const listeners = new Set()

function emitState(nextState) {
  preloadState = { ...preloadState, ...nextState }
  listeners.forEach((listener) => listener(preloadState))
}

function subscribe(listener) {
  listeners.add(listener)
  listener(preloadState)
  return () => listeners.delete(listener)
}

function sleep(duration) {
  return new Promise((resolve) => window.setTimeout(resolve, duration))
}

async function ensureResourceWorker() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return false
  try {
    await navigator.serviceWorker.register('/resource-worker.js', { updateViaCache: 'none' })
    await navigator.serviceWorker.ready
    if (!navigator.serviceWorker.controller) {
      await Promise.race([
        new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true })),
        sleep(1600),
      ])
    }
    return true
  } catch {
    return false
  }
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), RESOURCE_REQUEST_TIMEOUT)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    window.clearTimeout(timeoutId)
  }
}

async function loadLocalResource(resource, cache) {
  const cacheRequest = new Request(resource.url, { credentials: 'same-origin' })
  if (cache) {
    const cachedResponse = await cache.match(cacheRequest, { ignoreSearch: true, ignoreVary: true })
    if (cachedResponse) return true
  }

  const request = new Request(resource.url, {
    cache: 'force-cache',
    credentials: 'same-origin',
    headers: { 'x-champions-preload': '1' },
  })
  const response = await fetchWithTimeout(request)
  if (!response.ok) throw new Error(`Failed to load ${resource.url} (${response.status})`)
  if (cache) {
    await cache.put(cacheRequest, response).catch(() => undefined)
    return false
  }
  await response.arrayBuffer()
  return false
}

async function loadResource(resource, cache) {
  let lastError
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await loadLocalResource(resource, cache)
    } catch (error) {
      lastError = error
      if (attempt === 0) await sleep(180)
    }
  }
  throw lastError
}

async function mapWithConcurrency(resources, task) {
  let nextIndex = 0
  const workerCount = Math.min(PRELOAD_CONCURRENCY, Math.max(1, resources.length))
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < resources.length) {
      const index = nextIndex
      nextIndex += 1
      await task(resources[index], index)
    }
  }))
}

async function readCacheMarker(cache) {
  if (!cache) return null
  try {
    const response = await cache.match(RESOURCE_CACHE_MARKER_URL)
    return response ? await response.json() : null
  } catch {
    return null
  }
}

async function writeCacheMarker(cache, marker) {
  if (!cache) return
  await cache.put(
    RESOURCE_CACHE_MARKER_URL,
    new Response(JSON.stringify(marker), { headers: { 'content-type': 'application/json' } }),
  ).catch(() => undefined)
}

async function openVersionedLocalCache(version) {
  if (!('caches' in window)) return { cache: null, complete: false }
  let cache = await caches.open(RESOURCE_CACHE_NAME)
  const marker = await readCacheMarker(cache)
  if (marker?.version && marker.version !== version) {
    await caches.delete(RESOURCE_CACHE_NAME)
    cache = await caches.open(RESOURCE_CACHE_NAME)
    return { cache, complete: false }
  }
  return { cache, complete: marker?.version === version && marker?.complete === true }
}

async function runResourcePreload() {
  emitState({
    status: 'loading',
    phase: 'manifest',
    loaded: 0,
    total: 0,
    loadedBytes: 0,
    totalBytes: 0,
    percent: 0,
    currentGroup: 'interface',
    cached: 0,
    failed: 0,
    error: '',
  })

  const manifestResponse = await fetchWithTimeout(RESOURCE_MANIFEST_URL, { cache: 'no-store' })
  if (!manifestResponse.ok) throw new Error('리소스 목록을 불러오지 못했습니다.')
  const manifest = await manifestResponse.json()
  const resources = Array.isArray(manifest.resources) ? manifest.resources : []
  if (!resources.length) throw new Error('준비할 게임 리소스가 없습니다.')

  emitState({
    phase: 'worker',
    total: resources.length,
    totalBytes: Number(manifest.totalBytes) || 0,
  })
  await ensureResourceWorker()

  const { cache, complete: localCacheComplete } = await openVersionedLocalCache(manifest.version)
  let loaded = 0
  let loadedBytes = 0
  let cached = 0
  let failed = 0
  const requiredFailures = []
  let lastEmission = 0

  const reportProgress = (resource, force = false) => {
    const now = performance.now()
    if (!force && now - lastEmission < 48) return
    lastEmission = now
    emitState({
      phase: 'resources',
      loaded,
      loadedBytes,
      cached,
      failed,
      currentGroup: resource?.group ?? preloadState.currentGroup,
      percent: Math.min(100, Math.round((loaded / resources.length) * 100)),
    })
  }

  if (localCacheComplete) {
    loaded += resources.length
    loadedBytes += resources.reduce((total, resource) => total + Number(resource.bytes || 0), 0)
    cached += resources.length
    reportProgress(resources.at(-1), true)
  } else {
    await mapWithConcurrency(resources, async (resource) => {
      try {
        const wasCached = await loadResource(resource, cache)
        if (wasCached) cached += 1
      } catch (error) {
        failed += 1
        if (resource.required) requiredFailures.push({ resource, error })
      } finally {
        loaded += 1
        loadedBytes += Number(resource.bytes || 0)
        reportProgress(resource)
      }
    })
    if (!requiredFailures.length) {
      await writeCacheMarker(cache, { version: manifest.version, complete: true })
    }
  }

  reportProgress(resources.at(-1), true)
  if (requiredFailures.length) {
    throw new Error(`필수 리소스 ${requiredFailures.length}개를 준비하지 못했습니다.`)
  }

  emitState({
    status: 'complete',
    phase: 'complete',
    loaded: resources.length,
    loadedBytes: Number(manifest.totalBytes) || loadedBytes,
    percent: 100,
    failed,
  })
}

export function startResourcePreload({ retry = false } = {}) {
  if (preloadState.status === 'complete' && !retry) return Promise.resolve(preloadState)
  if (preloadPromise && !retry) return preloadPromise
  preloadPromise = runResourcePreload()
    .catch((error) => {
      emitState({
        status: 'error',
        phase: 'error',
        error: error instanceof Error ? error.message : '게임 리소스를 준비하지 못했습니다.',
      })
      throw error
    })
    .finally(() => {
      preloadPromise = null
    })
  return preloadPromise
}

export function retryResourcePreload() {
  return startResourcePreload({ retry: true })
}

export function useResourcePreloader() {
  const [state, setState] = useState(preloadState)

  useEffect(() => {
    const unsubscribe = subscribe(setState)
    startResourcePreload().catch(() => undefined)
    return unsubscribe
  }, [])

  return {
    ...state,
    currentGroupLabel: GROUP_LABELS[state.currentGroup] ?? '게임 데이터 준비',
    retry: () => retryResourcePreload().catch(() => undefined),
  }
}
