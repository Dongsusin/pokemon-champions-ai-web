import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createFileSaveStore, acquireSaveDirectoryLock } from '../local-runtime/fileSaveStore.mjs'
import { createLocalRuntime } from '../local-runtime/server.mjs'
import { createSave, PROFILE_KEY } from '../src/local/saveSchema.js'

const testRoot = path.resolve('scripts/.cache/local-runtime-tests')
await mkdir(testRoot, { recursive: true })
const fresh = () => mkdtemp(path.join(testRoot, 'case-'))
async function cleanup(directory) {
  const absolute = path.resolve(directory)
  if (!absolute.startsWith(`${testRoot}${path.sep}`)) throw new Error('Unsafe test cleanup path')
  await rm(absolute, { recursive: true, force: true })
}
const values = { [PROFILE_KEY]: '{"uid":"local-guest-test","displayName":"로컬 테스트"}', 'champions-vp-v1': '75000' }

test('disk saves survive restarts and a different local origin', async () => {
  const dir = await fresh()
  try {
    const first = createFileSaveStore(dir)
    await first.write(createSave(values), 0)
    assert.deepEqual((await createFileSaveStore(dir).read()).values, values)
    assert.equal((await createFileSaveStore(dir).read()).revision, 1)
  } finally { await cleanup(dir) }
})
test('serialized concurrent disk writes reject stale revisions', async () => {
  const dir = await fresh()
  try {
    const store = createFileSaveStore(dir)
    const results = await Promise.allSettled([store.write(createSave(values), 0), store.write(createSave({ ...values, 'champions-vp-v1': '1' }), 0)])
    assert.equal(results[0].status, 'fulfilled')
    assert.equal(results[1].status, 'rejected')
    assert.equal((await store.read()).values['champions-vp-v1'], '75000')
  } finally { await cleanup(dir) }
})
test('import keeps a separate backup even after subsequent autosaves', async () => {
  const dir = await fresh()
  try {
    const store = createFileSaveStore(dir)
    await store.write(createSave(values), 0)
    await store.write(createSave({ ...values, 'champions-vp-v1': '999' }), 1, { reason: 'import' })
    await store.write(createSave({ ...values, 'champions-vp-v1': '888' }), 2)
    assert.equal(JSON.parse(await readFile(path.join(dir, 'before-import.json'))).values['champions-vp-v1'], '75000')
    assert.equal(JSON.parse(await readFile(store.backupPath)).values['champions-vp-v1'], '999')
    assert.equal((await store.read()).values['champions-vp-v1'], '888')
  } finally { await cleanup(dir) }
})
test('corrupt saves are reported and never overwritten with a blank save', async () => {
  const dir = await fresh()
  try {
    await writeFile(path.join(dir, 'main.json'), '{broken')
    const store = createFileSaveStore(dir)
    await assert.rejects(store.read(), /손상/)
    await assert.rejects(store.write(createSave(values), 0), /손상/)
    assert.equal(await readFile(path.join(dir, 'main.json'), 'utf8'), '{broken')
  } finally { await cleanup(dir) }
})
test('another runtime cannot hold the same save directory', async () => {
  const dir = await fresh()
  const release = await acquireSaveDirectoryLock(dir)
  try { await assert.rejects(acquireSaveDirectoryLock(dir), /이미 실행/) }
  finally { await release(); await cleanup(dir) }
})
test('local runtime serves the game and permits only authenticated local save operations', async () => {
  const dir = await fresh(), gameRoot = path.join(dir, 'game')
  await mkdir(gameRoot)
  await writeFile(path.join(gameRoot, 'index.html'), '<html><head></head><body>Local game</body></html>')
  await writeFile(path.join(gameRoot, 'data.json'), '{"local":true}')
  const runtime = await createLocalRuntime({ root: gameRoot, dataDirectory: path.join(dir, 'save'), port: 0 })
  try {
    const page = await fetch(runtime.origin)
    assert.ok((await page.text()).includes('launcher-bridge.js'))
    assert.ok(page.headers.get('content-security-policy').includes("connect-src 'self'"))
    assert.equal((await fetch(`${runtime.origin}/__local/save`)).status, 403)
    assert.equal((await fetch(`${runtime.origin}/launcher-bridge.js`, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403)
    const script = await (await fetch(`${runtime.origin}/launcher-bridge.js`)).text()
    const secret = script.match(/const secret = "([a-f0-9]+)"/)[1]
    const headers = { 'x-champions-local': secret, 'Content-Type': 'application/json' }
    assert.equal(await (await fetch(`${runtime.origin}/__local/save`, { headers })).json(), null)
    const saved = await fetch(`${runtime.origin}/__local/save`, { method: 'POST', headers,
      body: JSON.stringify({ save: createSave(values), expectedRevision: 0 }) })
    assert.equal(saved.status, 200)
    assert.deepEqual((await saved.json()).values, values)
    const denied = await fetch(`${runtime.origin}/__local/save`, { method: 'POST', headers: { ...headers, Origin: 'https://outside.example' },
      body: JSON.stringify({ save: createSave(values), expectedRevision: 1 }) })
    assert.equal(denied.status, 403)
    assert.equal((await fetch(`${runtime.origin}/__local/save`, { method: 'POST', headers,
      body: JSON.stringify({ save: createSave(values), expectedRevision: 0 }) })).status, 400)
    assert.equal((await fetch(`${runtime.origin}/data.json`)).status, 200)
    assert.equal((await fetch(`${runtime.origin}/%2e%2e%2foutside.txt`)).status, 403)
    assert.equal((await fetch(`${runtime.origin}/api/account`)).status, 404)
  } finally { await runtime.close(); await cleanup(dir) }
})
