import { useEffect, useState } from 'react'

const RESOURCE_MANIFEST_URL = '/resource-manifest.json'
const RESOURCE_CACHE_NAME = 'champions-arena-resource-cache-v1'
const RESOURCE_CACHE_MARKER_URL = '/__champions-arena-resource-cache-marker__'
const REMOTE_CACHE_MARKER_KEY = 'champions-arena-remote-resource-cache-v1'
const REMOTE_CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000
const REMOTE_FAILURE_RETRY_AGE = 60 * 60 * 1000
const RESOURCE_REQUEST_TIMEOUT = 15000
const PRELOAD_CONCURRENCY = 18

const GROUP_LABELS = {
  interface: '인터페이스 준비',
  'battle-field': '배틀 필드 준비',
  audio: '배틀 사운드 준비',
  'move-effect': '기술 연출 준비',
  pokemon: '포켓몬 스프라이트 준비',
  trainer: '트레이너 이미지 준비',
  item: '배틀 아이템 준비',
  draw: '뽑기 연출 준비',
  cry: '포켓몬 울음소리 준비',
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

function loadExternalImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    const timeoutId = window.setTimeout(() => {
      image.src = ''
      reject(new Error(`Timed out while loading ${url}`))
    }, RESOURCE_REQUEST_TIMEOUT)
    const finish = (callback) => {
      window.clearTimeout(timeoutId)
      image.onload = null
      image.onerror = null
      callback()
    }
    image.decoding = 'async'
    image.onload = () => finish(resolve)
    image.onerror = () => finish(() => reject(new Error(`Failed to load ${url}`)))
    image.src = url
  })
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

async function loadRemoteResource(resource) {
  if (resource.kind === 'image') {
    await loadExternalImage(resource.url)
    return false
  }

  const response = await fetchWithTimeout(resource.url, { cache: 'force-cache', mode: 'cors' })
  if (!response.ok) throw new Error(`Failed to load ${resource.url} (${response.status})`)
  await response.arrayBuffer()
  return false
}

async function loadResource(resource, cache) {
  const loader = resource.source === 'local'
    ? () => loadLocalResource(resource, cache)
    : () => loadRemoteResource(resource)

  let lastError
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await loader()
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

async function findUnavailableRemoteOrigins(resources) {
  const firstResourceByOrigin = new Map()
  for (const resource of resources) {
    try {
      const origin = new URL(resource.url).origin
      if (!firstResourceByOrigin.has(origin)) firstResourceByOrigin.set(origin, resource)
    } catch {}
  }

  const unavailableOrigins = new Set()
  await Promise.all([...firstResourceByOrigin.entries()].map(async ([origin, resource]) => {
    try {
      await loadResource(resource, null)
    } catch {
      unavailableOrigins.add(origin)
    }
  }))
  return unavailableOrigins
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

function readRemoteCacheMarker(version) {
  try {
    const marker = JSON.parse(localStorage.getItem(REMOTE_CACHE_MARKER_KEY) || 'null')
    if (marker?.version !== version) return false
    const maxAge = Number(marker.failed) > 0 ? REMOTE_FAILURE_RETRY_AGE : REMOTE_CACHE_MAX_AGE
    return Date.now() - Number(marker.completedAt) < maxAge
  } catch {
    return false
  }
}

function writeRemoteCacheMarker(version, failed = 0) {
  try {
    localStorage.setItem(REMOTE_CACHE_MARKER_KEY, JSON.stringify({
      version,
      completedAt: Date.now(),
      failed,
    }))
  } catch {}
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

  const localResources = resources.filter((resource) => resource.source === 'local')
  const remoteResources = resources.filter((resource) => resource.source !== 'local')
  const { cache, complete: localCacheComplete } = await openVersionedLocalCache(manifest.version)
  const remoteCacheComplete = readRemoteCacheMarker(manifest.version)
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
    loaded += localResources.length
    loadedBytes += localResources.reduce((total, resource) => total + Number(resource.bytes || 0), 0)
    cached += localResources.length
    reportProgress(localResources.at(-1), true)
  } else {
    await mapWithConcurrency(localResources, async (resource) => {
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

  if (remoteCacheComplete) {
    loaded += remoteResources.length
    cached += remoteResources.length
    reportProgress(remoteResources.at(-1), true)
  } else {
    let remoteFailures = 0
    const unavailableOrigins = await findUnavailableRemoteOrigins(remoteResources)
    await mapWithConcurrency(remoteResources, async (resource) => {
      try {
        if (unavailableOrigins.has(new URL(resource.url).origin)) {
          throw new Error(`Unavailable resource origin: ${new URL(resource.url).origin}`)
        }
        await loadResource(resource, cache)
      } catch {
        failed += 1
        remoteFailures += 1
      } finally {
        loaded += 1
        reportProgress(resource)
      }
    })
    writeRemoteCacheMarker(manifest.version, remoteFailures)
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
