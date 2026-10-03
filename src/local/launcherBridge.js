export function getLauncherBridge() {
  if (typeof window === 'undefined') return null
  try { return window.championsLauncher ?? window.parent?.championsLauncher ?? null } catch { return null }
}
export function hasLauncherOnline(channel = 'ranked') {
  const online = getLauncherBridge()?.online
  return typeof online?.request === 'function' && online.channels?.includes(channel) === true
}
// Only the selected battle operation goes to the personal service. Save files
// and Google tokens are never passed to this transport.
export async function requestLauncherOnline(channel, action, payload, options = {}) {
  if (!hasLauncherOnline(channel)) throw new Error('런처의 온라인 서비스가 아직 연결되지 않았습니다.')
  if (options.signal?.aborted) throw new DOMException('Request cancelled', 'AbortError')
  const controller = new AbortController()
  const abort = () => controller.abort()
  const { timeoutMs = 12_000, ...transportOptions } = options
  let rejectCancelled
  const cancelled = new Promise((_, reject) => { rejectCancelled = reject })
  controller.signal.addEventListener('abort', () => {
    if (options.signal?.aborted) rejectCancelled(new DOMException('Request cancelled', 'AbortError'))
    else rejectCancelled(Object.assign(new Error('온라인 응답이 지연되고 있습니다. 다시 연결해주세요.'), { code: 'network-error' }))
  }, { once: true })
  options.signal?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(abort, timeoutMs)
  try {
    return await Promise.race([
      Promise.resolve().then(() => getLauncherBridge().online.request(channel, action, payload,
        { ...transportOptions, signal: controller.signal })), cancelled,
    ])
  } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort) }
}
