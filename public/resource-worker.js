const RESOURCE_CACHE_NAME = 'champions-arena-resource-cache-v1'
// The installed app has to boot without a network, so the document and its
// hashed build files are cached separately from the /assets/ media above.
const SHELL_CACHE_NAME = 'champions-arena-shell-cache-v1'
const SHELL_DOCUMENT = '/index.html'
const KNOWN_CACHES = new Set([RESOURCE_CACHE_NAME, SHELL_CACHE_NAME])

// On the very first visit the document and its bundle are fetched before this
// worker controls the page, so they would never reach the cache on their own.
// Reading the shell here and following its own script and style references
// captures the hashed build files without a build-time asset list.
async function precacheShell(cache) {
  const response = await fetch(new Request(SHELL_DOCUMENT, { cache: 'reload' }))
  if (!response.ok) return
  await cache.put(SHELL_DOCUMENT, response.clone()).catch(() => undefined)
  const html = await response.text()
  const urls = new Set(['/resource-manifest.json', '/manifest.webmanifest'])
  for (const [, value] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    if (/^(?:https?:)?\/\//.test(value)) continue
    if (/\.(?:js|mjs|css)$/.test(value)) urls.add(value)
  }
  await Promise.all([...urls].map(url => cache.add(new Request(url, { cache: 'reload' })).catch(() => undefined)))
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE_NAME)
    // A build without these files still installs; the fetch handler fills the
    // shell in on the first successful navigation.
    await precacheShell(cache).catch(() => undefined)
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (!KNOWN_CACHES.has(name)) await caches.delete(name)
    await self.clients.claim()
  })())
})

// Navigations come from the network first so a new build is picked up, and fall
// back to the cached document when the device is offline.
async function handleNavigation(request) {
  const cache = await caches.open(SHELL_CACHE_NAME)
  try {
    const networkResponse = await fetch(request)
    if (networkResponse.ok) cache.put(SHELL_DOCUMENT, networkResponse.clone()).catch(() => undefined)
    return networkResponse
  } catch (error) {
    const cachedDocument = await cache.match(SHELL_DOCUMENT) ?? await cache.match(request, { ignoreSearch: true })
    if (cachedDocument) return cachedDocument
    throw error
  }
}

// Hashed build files never change under one name and the media is immutable
// too, so both are served from the cache first. The lookup spans every cache
// because the build bundle lives under /assets/ yet is precached with the
// shell, and only the fill is directed at one of them.
async function cacheFirst(request, cacheName) {
  const cachedResponse = await caches.match(request, { ignoreSearch: true, ignoreVary: true })
  if (cachedResponse) return cachedResponse
  const networkResponse = await fetch(request)
  if (networkResponse.ok) {
    const cache = await caches.open(cacheName)
    cache.put(request, networkResponse.clone()).catch(() => undefined)
  }
  return networkResponse
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (
    request.method !== 'GET'
    || request.headers.has('range')
    || request.headers.get('x-champions-preload') === '1'
  ) return

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request))
    return
  }

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  // Vite emits the hashed bundle under /assets/ in production and serves the
  // entry module from the root in development, so both shapes are handled.
  const isBuildFile = /\.(?:js|mjs|css|json|webmanifest|woff2?)$/.test(url.pathname)
  if (isBuildFile) {
    event.respondWith(cacheFirst(request, SHELL_CACHE_NAME))
    return
  }
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request, RESOURCE_CACHE_NAME))
  }
})
