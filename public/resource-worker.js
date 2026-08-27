const RESOURCE_CACHE_NAME = 'champions-arena-resource-cache-v1'

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (
    request.method !== 'GET'
    || request.headers.has('range')
    || request.headers.get('x-champions-preload') === '1'
  ) return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin || !url.pathname.startsWith('/assets/')) return

  event.respondWith((async () => {
    const cache = await caches.open(RESOURCE_CACHE_NAME)
    const cachedResponse = await cache.match(request, { ignoreSearch: true, ignoreVary: true })
    if (cachedResponse) return cachedResponse

    const networkResponse = await fetch(request)
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone()).catch(() => undefined)
    }
    return networkResponse
  })())
})
