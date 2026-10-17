import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createMemoryRankedStore } from '../server/rankedStore.js'
import { createGuestIdentityRegistry } from '../server/guestIdentity.js'
import { createRankedService } from '../server/rankedService.js'
import { startRankedDevServer } from './rankedDevServer.mjs'

const root = new URL('../', import.meta.url)
const removed = [
  'api/chat.js', 'src/GlobalChat.jsx', 'src/useGlobalChat.js', 'src/globalChatClient.js',
  'src/globalChat.css', 'server/globalChatHttp.js', 'server/globalChatService.js', 'server/chatModeration.js',
  'scripts/validateGlobalChatUi.mjs', 'scripts/validateGlobalChatServer.mjs', 'scripts/validateGlobalChatClient.mjs',
  'scripts/validateChatModeration.mjs',
]
for (const file of removed) {
  await assert.rejects(fs.access(new URL(file, root)), error => error.code === 'ENOENT', file)
}
console.log('PASS chat UI, polling client, HTTP endpoint, send/read service and retired validators are absent')

async function runtimeFiles(directory) {
  const paths = []
  for (const entry of await fs.readdir(new URL(directory + '/', root), { withFileTypes: true })) {
    const relative = directory + '/' + entry.name
    if (entry.isDirectory()) paths.push(...await runtimeFiles(relative))
    else if (/\.(js|jsx|mjs|css)$/.test(entry.name)) paths.push(relative)
  }
  return paths
}
const runtime = (await Promise.all(['src', 'server', 'api'].map(runtimeFiles))).flat()
for (const file of runtime) {
  const source = await fs.readFile(new URL(file, root), 'utf8')
  // This deletion-only helper retains the collection keys of older releases.
  if (file === 'server/guestAccountCleanup.js') {
    assert.doesNotMatch(source, /globalChatService|createGlobalChat|handleProductionGlobalChat|containsChatProfanity/)
  } else assert.doesNotMatch(source, /GlobalChat|globalChat|global-chat|\/api\/chat|chatModeration|containsChatProfanity/, file)
}
const packageJson = JSON.parse(await fs.readFile(new URL('package.json', root), 'utf8'))
for (const [name, command] of Object.entries(packageJson.scripts)) {
  assert.doesNotMatch(name + ' ' + command, /global-chat|validateGlobalChat|validateChatModeration/, name)
}
console.log('PASS runtime imports, header styles and package scripts contain no active chat dependency')

const localStore = createMemoryRankedStore()
const local = await startRankedDevServer({ port: 0, testAccounts: true, store: localStore, engine: {}, fixtures: [] })
try {
  const origin = new URL(local.url).origin
  for (const method of ['GET', 'POST']) {
    const response = await fetch(origin + '/api/chat', {
      method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ranked-test-alice' },
      ...(method === 'POST' ? { body: JSON.stringify({ action: 'send', text: 'removed feature' }) } : {}),
    })
    assert.equal(response.status, 404, method)
    assert.equal(await response.text(), 'Not found')
  }
  assert.deepEqual((await localStore.inspect()).collections, {}, 'Retired requests must not write storage')
  console.log('PASS real local HTTP GET and POST /api/chat return 404 without storage writes')
  const ranked = await fetch(local.url + '?action=status', { headers: { Authorization: 'Bearer ranked-test-alice' } })
  assert.equal(ranked.status, 200)
  assert.equal((await ranked.json()).match, null)
  console.log('PASS required authenticated ranked HTTP traffic still succeeds')
} finally { await local.close() }

const store = createMemoryRankedStore()
const identity = { uid: 'legacy-chat-guest', isGuest: true }
const registry = createGuestIdentityRegistry({ store, chooseNumber: () => 123456 })
await registry.create(identity)
const owner = createHash('sha256').update('global-chat-owner:' + identity.uid).digest('hex')
const own = { id: 'removed-message', owner, name: 'guest-123456', text: 'old guest message', createdAt: 1 }
const other = { id: 'retained-message', owner: 'different-owner', name: 'other-player', text: 'preserve', createdAt: 2 }
await store.transaction(tx => {
  tx.set('globalChat', 'feed', { messages: [own, other] })
  tx.set('globalChat', 'metadata', { revision: 7, latest: other })
  tx.set('globalChatSenders', owner, { receipts: [{ requestId: 'old-send' }] })
  tx.set('globalChatSenders', other.owner, { receipts: [{ requestId: 'retained-send' }] })
})
const service = createRankedService({ store, guestRegistry: registry })
await service.deleteGuestAccount(identity)
const after = (await store.inspect()).collections
assert.deepEqual(after.globalChat.feed.messages, [other])
assert.deepEqual(after.globalChat.metadata, { revision: 8, latest: other })
assert.equal(after.globalChatSenders[owner], undefined)
assert.deepEqual(after.globalChatSenders[other.owner], { receipts: [{ requestId: 'retained-send' }] })
console.log('PASS authenticated guest deletion still erases legacy messages and receipts while preserving other users')
await service.deleteGuestAccount(identity)
const repeat = (await store.inspect()).collections
assert.deepEqual(repeat.globalChat, after.globalChat)
assert.deepEqual(repeat.globalChatSenders, after.globalChatSenders)
console.log('PASS legacy guest message erasure remains idempotent after chat retirement')
console.log('Chat removal: 6/6 passed')
