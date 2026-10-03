import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, realpath, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { acquireSaveDirectoryLock, createFileSaveStore } from './fileSaveStore.mjs'
import { MAX_SAVE_BYTES } from '../src/local/saveSchema.js'

export function defaultDataDirectory() {
  const localRoot = process.env.LOCALAPPDATA || (process.platform === 'darwin'
    ? path.join(homedir(), 'Library', 'Application Support') : process.env.XDG_DATA_HOME || path.join(homedir(), '.local', 'share'))
  return path.join(localRoot, 'ChampionsArena', 'saves')
}
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2' }
const inside = (root, target) => target === root || (!path.relative(root, target).startsWith('..') && !path.isAbsolute(path.relative(root, target)))

export async function createLocalRuntime({ root, dataDirectory = defaultDataDirectory(), port = 4173 } = {}) {
  root = await realpath(path.resolve(root ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '../dist')))
  await stat(path.join(root, 'index.html'))
  const unlock = await acquireSaveDirectoryLock(dataDirectory)
  const store = createFileSaveStore(dataDirectory)
  const secret = randomBytes(32).toString('hex')
  let origin
  const json = (response, status, value) => { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(value)) }
  const bridgeScript = () => `(() => {
    const secret = ${JSON.stringify(secret)};
    async function request(path, body) {
      const response = await fetch('/__local/' + path, { method: body ? 'POST' : 'GET', cache: 'no-store',
        headers: { 'x-champions-local': secret, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '로컬 저장에 실패했습니다.');
      return result;
    }
    Object.defineProperty(window, 'championsLauncher', { configurable: false, value: Object.freeze({
      version: 1, getInfo: () => request('info'), readSave: () => request('save'),
      writeSave: (save, options) => request('save', { save, expectedRevision: options.expectedRevision, reason: options.reason })
    }) });
  })();`
  const server = createServer(async (request, response) => {
    try {
      if (request.headers.host !== new URL(origin).host) return json(response, 403, { error: '잘못된 로컬 호스트입니다.' })
      const url = new URL(request.url, origin)
      response.setHeader('X-Content-Type-Options', 'nosniff')
      response.setHeader('Referrer-Policy', 'no-referrer')
      response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; frame-src 'self'; frame-ancestors 'self'; object-src 'none'; base-uri 'self'")
      if (url.pathname === '/launcher-bridge.js') {
        if (request.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(request.headers['sec-fetch-site'])) return json(response, 403, { error: '외부 접근은 허용되지 않습니다.' })
        response.writeHead(200, { 'Content-Type': mime['.js'], 'Cache-Control': 'no-store' }); return response.end(bridgeScript())
      }
      if (url.pathname.startsWith('/__local/')) {
        const token = request.headers['x-champions-local']
        if (typeof token !== 'string' || token.length !== secret.length || !timingSafeEqual(Buffer.from(token), Buffer.from(secret)) ||
          (request.headers.origin && request.headers.origin !== origin)) return json(response, 403, { error: '로컬 저장 접근이 거부됐습니다.' })
        if (url.pathname === '/__local/info' && request.method === 'GET') return json(response, 200, { saveLocation: store.savePath, version: 1 })
        if (url.pathname === '/__local/save' && request.method === 'GET') return json(response, 200, await store.read())
        if (url.pathname === '/__local/save' && request.method === 'POST') {
          let size = 0
          const chunks = []
          for await (const chunk of request) { size += chunk.length; if (size > MAX_SAVE_BYTES + 1024) return json(response, 413, { error: '저장 파일이 너무 큽니다.' }); chunks.push(chunk) }
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          return json(response, 200, await store.write(body.save, body.expectedRevision, { reason: body.reason === 'import' ? 'import' : undefined }))
        }
        return json(response, 404, { error: '지원하지 않는 로컬 작업입니다.' })
      }
      if (!['GET', 'HEAD'].includes(request.method)) return json(response, 405, { error: '허용되지 않는 요청입니다.' })
      let target = path.resolve(root, `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`)
      if (!inside(root, target)) return json(response, 403, { error: '게임 폴더 밖의 파일은 읽을 수 없습니다.' })
      try { target = await realpath(target) } catch { return json(response, 404, { error: '게임 파일이 없습니다.' }) }
      if (!inside(root, target) || !(await stat(target)).isFile()) return json(response, 404, { error: '게임 파일이 없습니다.' })
      response.setHeader('Content-Type', mime[path.extname(target)] ?? 'application/octet-stream')
      if (target === path.join(root, 'index.html')) {
        response.setHeader('Cache-Control', 'no-store')
        const html = (await readFile(target, 'utf8')).replace('<head>', '<head><script src="/launcher-bridge.js"></script>')
        response.writeHead(200); return response.end(request.method === 'HEAD' ? '' : html)
      }
      const size = (await stat(target)).size
      response.setHeader('Content-Length', size)
      response.writeHead(200)
      if (request.method === 'HEAD') return response.end()
      const stream = createReadStream(target)
      stream.on('error', () => response.destroy())
      stream.pipe(response)
    } catch (error) { if (!response.headersSent) json(response, 400, { error: error.message }); else response.destroy() }
  })
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve) })
    origin = `http://127.0.0.1:${server.address().port}`
  } catch (error) { await unlock(); throw error }
  return { origin, store, async close() { await new Promise(resolve => server.close(resolve)); await store.idle(); await unlock() } }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const option = key => { const index = args.indexOf(key); return index < 0 ? undefined : args[index + 1] }
  const runtime = await createLocalRuntime({ root: option('--root'), dataDirectory: option('--data-dir'), port: Number(option('--port') ?? 4173) })
  console.log(`Champions Arena local: ${runtime.origin}\nSave file: ${runtime.store.savePath}`)
  let closing = false
  const close = async () => { if (closing) return; closing = true; await runtime.close(); process.exit(0) }
  process.on('SIGINT', close); process.on('SIGTERM', close)
}
