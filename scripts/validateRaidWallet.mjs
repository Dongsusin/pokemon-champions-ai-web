import assert from 'node:assert/strict'
import test from 'node:test'
import { createAccountService } from '../server/accountService.js'
import { createAccountHttpHandler } from '../server/accountHttp.js'
import { createMemoryRankedStore } from '../server/rankedStore.js'
import { reconcileRaidWallet, createRaidRewardTotalResolver } from '../server/raidWallet.js'
import { creditRaidVpRewards, creditRankedVpRewards, loadAchievementWallet, saveAchievementWallet } from '../src/data/achievementStorage.js'
import { INITIAL_VP_BALANCE } from '../src/data/pokemonPool.js'
import { migrateOnlineWalletReceipts } from '../src/auth/raidWalletMigration.js'

const key = 'champions-achievements-v1'
const uid = 'raid-wallet-player'
const identity = { uid, name: 'Player', isGuest: false }
const ownerId = 'wallet-owner-1234567890123'
const payload = (balance, total) => ({ 'champions-vp-v1': String(balance), [key]: JSON.stringify({ walletBalance: balance, ...(total === undefined ? {} : { raidVpRewards: { uid, total } }) }) })
const balanceOf = data => JSON.parse(data[key]).walletBalance
const memoryStorage = () => { const map = new Map(); return { getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)) } }

test('client wallet credits each raid receipt once and preserves independent ranked and achievement receipts', () => {
  const storage = memoryStorage()
  const progress = loadAchievementWallet(storage).progress
  saveAchievementWallet(progress, 1000, storage)
  let result = creditRaidVpRewards(progress, 1000, { uid, total: 800 }, uid, storage)
  assert.equal(result.balance, 1800)
  result = creditRaidVpRewards(progress, result.balance, { uid, total: 800 }, uid, storage)
  assert.equal(result.granted, 0)
  result = creditRankedVpRewards(progress, result.balance, { uid, total: 600 }, uid, storage)
  assert.equal(result.balance, 2400)
  saveAchievementWallet(progress, 1900, storage)
  const saved = JSON.parse(storage.getItem(key))
  assert.deepEqual(saved.raidVpRewards, { uid, total: 800 })
  assert.deepEqual(saved.rankedVpRewards, { uid, total: 600 })
  result = creditRaidVpRewards(progress, 1900, { uid, total: 1100 }, uid, storage)
  assert.equal(result.balance, 2200)
  assert.throws(() => creditRaidVpRewards(progress, result.balance, { uid: 'other', total: 1100 }, uid, storage))
})

test('authoritative reconciliation restores missing reward but never trusts a larger or foreign client receipt', () => {
  const initial = payload(1000)
  const once = reconcileRaidWallet(initial, uid, 800)
  assert.equal(balanceOf(once.payload), 1800)
  assert.deepEqual(reconcileRaidWallet(once.payload, uid, 800, once.appliedTotal).payload, once.payload)
  assert.throws(() => reconcileRaidWallet(payload(9999, 900), uid, 800), { code: 'INVALID_RAID_REWARD_RECEIPT' })
  assert.throws(() => reconcileRaidWallet(initial, uid, 800, 800, { rejectStale: true }), { code: 'STALE_RAID_REWARD_SAVE' })
  const spent = reconcileRaidWallet(payload(1200, 800), uid, 1100, 800)
  assert.equal(balanceOf(spent.payload), 1500)
})

async function fixture() {
  const store = createMemoryRankedStore(), rankedStore = createMemoryRankedStore()
  const service = createAccountService({ store, now: () => 1000, resolveRaidRewardTotal: createRaidRewardTotalResolver(rankedStore) })
  const call = (action, values = {}) => service.execute(identity, { action, ownerId, ...values })
  await call('sessionAcquire')
  return { store, rankedStore, service, call, grant: total => rankedStore.transaction(tx => tx.set('raidPlayers', uid, { uid, vpRewardTotal: total })) }
}

test('actual account load restores missed settlement once, stale cloud save cannot rewind it, and spending survives restart', async () => {
  const f = await fixture()
  await f.call('save', { revision: 'save-initial', saveSequence: 1, payload: payload(1000) })
  await f.grant(800)
  const first = await f.call('load')
  assert.equal(balanceOf(first.gameData.payload), 1800)
  const again = await f.call('load')
  assert.equal(balanceOf(again.gameData.payload), 1800)
  assert.equal(first.gameData.revision, again.gameData.revision)
  await assert.rejects(f.call('save', { revision: 'save-old-copy', saveSequence: 2, payload: payload(1000) }), { code: 'STALE_RAID_REWARD_SAVE' })
  await f.call('save', { revision: 'save-spending', saveSequence: 3, payload: payload(1400, 800) })
  const restarted = createAccountService({ store: f.store, now: () => 1000, resolveRaidRewardTotal: createRaidRewardTotalResolver(f.rankedStore) })
  assert.equal(balanceOf((await restarted.execute(identity, { action: 'load', ownerId })).gameData.payload), 1400)
  await f.grant(1100)
  assert.equal(balanceOf((await f.call('load')).gameData.payload), 1700)
})

test('client receipt save and server load converge without a duplicate grant or save retry mismatch', async () => {
  const f = await fixture()
  await f.grant(800)
  const command = { revision: 'client-award-save', saveSequence: 1, payload: payload(1800, 800) }
  await f.call('save', command)
  await f.call('save', command)
  assert.equal(balanceOf((await f.call('load')).gameData.payload), 1800)
  const before = await f.store.inspect()
  await assert.rejects(f.call('save', { revision: 'forged-award', saveSequence: 2, payload: payload(9800, 8800) }), { code: 'INVALID_RAID_REWARD_RECEIPT' })
  assert.deepEqual(await f.store.inspect(), before)
})

test('settlement racing with an ordinary save leaves the missing credit for load and does not change the client save body', async () => {
  const f = await fixture()
  await f.grant(800)
  const ordinary = { revision: 'race-ordinary-save', saveSequence: 1, payload: payload(1000) }
  await f.call('save', ordinary)
  await f.call('save', ordinary)
  const stored = (await f.store.inspect()).collections.gameData[uid]
  assert.equal(balanceOf(stored.payload), 1000)
  assert.equal(balanceOf((await f.call('load')).gameData.payload), 1800)
})

test('failed primary browser write can retry the whole grant, while a failed legacy mirror cannot grant twice', () => {
  const storage = memoryStorage()
  const progress = loadAchievementWallet(storage).progress
  saveAchievementWallet(progress, 1000, storage)
  const original = storage.getItem(key)
  const failPrimary = { getItem: storage.getItem, setItem: (k, v) => {
    if (k === key) throw new Error('Storage quota exceeded')
    storage.setItem(k, v)
  } }
  assert.throws(() => creditRaidVpRewards(progress, 1000, { uid, total: 800 }, uid, failPrimary))
  assert.equal(storage.getItem(key), original)
  const failMirror = { getItem: storage.getItem, setItem: (k, v) => {
    if (k === 'champions-vp-v1') throw new Error('Storage quota exceeded')
    storage.setItem(k, v)
  } }
  const first = creditRaidVpRewards(progress, 1000, { uid, total: 800 }, uid, failMirror)
  assert.equal(first.balance, 1800)
  assert.equal(storage.getItem('champions-vp-v1'), '1000')
  const reloaded = loadAchievementWallet(storage)
  assert.equal(reloaded.balance, 1800)
  assert.equal(creditRaidVpRewards(reloaded.progress, reloaded.balance, { uid, total: 800 }, uid, storage).granted, 0)
})

test('delayed smaller reward responses cannot rewind a receipt or restore VP already spent', () => {
  const storage = memoryStorage()
  const progress = loadAchievementWallet(storage).progress
  saveAchievementWallet(progress, 1000, storage)
  assert.equal(creditRaidVpRewards(progress, 1000, { uid, total: 1100 }, uid, storage).balance, 2100)
  saveAchievementWallet(progress, 300, storage)
  const before = storage.getItem(key)
  assert.deepEqual(creditRaidVpRewards(progress, 300, { uid, total: 800 }, uid, storage), {
    balance: 300, granted: 0, appliedTotal: 1100,
  })
  assert.equal(storage.getItem(key), before)
  assert.equal(creditRaidVpRewards(progress, 300, { uid, total: 1400 }, uid, storage).balance, 600)
})

test('lost settlement and account response recover after restart without duplicate VP or unrelated data loss', async () => {
  const f = await fixture()
  const unrelated = { 'champions-settings-v1': '{"textScale":1.5}', 'champions-dex-v2': '[{"captureId":"kept-pokemon","speciesId":25}]' }
  await f.call('save', { revision: 'before-lost-response', saveSequence: 1, payload: { ...payload(1000), ...unrelated } })
  await f.grant(800) // The raid settlement committed, but its browser response never arrived.
  await f.call('load') // The first recovery response also never arrived at the browser.
  const restarted = createAccountService({ store: f.store, now: () => 1000, resolveRaidRewardTotal: createRaidRewardTotalResolver(f.rankedStore) })
  const recovered = await restarted.execute(identity, { action: 'load', ownerId })
  assert.equal(balanceOf(recovered.gameData.payload), 1800)
  for (const [name, value] of Object.entries(unrelated)) assert.equal(recovered.gameData.payload[name], value)
  const afterSpend = { revision: 'lost-save-response', saveSequence: 2, payload: { ...payload(1300, 800), ...unrelated } }
  await f.call('save', afterSpend) // A successful commit with a lost response may be retried.
  await f.call('save', afterSpend)
  assert.equal(balanceOf((await restarted.execute(identity, { action: 'load', ownerId })).gameData.payload), 1300)
})

const httpRequest = (body, token = 'valid-test-bearer') => new Request('https://game.example.test/api/account', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
})

test('actual account HTTP resolves rewards only for verified identity and rejects missing auth, wrong lease and forged receipt', async () => {
  const f = await fixture()
  const otherUid = 'other-wallet-player'
  await f.rankedStore.transaction(tx => tx.set('raidPlayers', otherUid, { vpRewardTotal: 9000 }))
  const http = createAccountHttpHandler({ service: f.service, authenticate: async () => identity, now: () => 1000 })
  const save = { action: 'save', ownerId, revision: 'http-identity-save', saveSequence: 1, uid: otherUid, rewards: { uid: otherUid, total: 9000 }, payload: payload(1000) }
  assert.equal((await http(httpRequest(save, ''))).status, 401)
  assert.equal((await http(httpRequest({ ...save, ownerId: 'wrong-lease-owner-000000' }))).status, 409)
  assert.equal((await http(httpRequest(save))).status, 200)
  const loaded = await (await http(httpRequest({ action: 'load', ownerId, uid: otherUid }))).json()
  assert.equal(balanceOf(loaded.gameData.payload), 1000)
  const before = await f.store.inspect()
  const forged = await http(httpRequest({ ...save, revision: 'http-forged-receipt', saveSequence: 2, payload: payload(10000, 9000) }))
  assert.equal(forged.status, 409)
  assert.equal((await forged.json()).error.code, 'INVALID_RAID_REWARD_RECEIPT')
  assert.deepEqual(await f.store.inspect(), before)
  assert.equal((await f.store.inspect()).collections.gameData[otherUid], undefined)
})

test('reward source outage leaves the confirmed account untouched and hides infrastructure errors over HTTP', async () => {
  const f = await fixture()
  await f.call('save', { revision: 'before-source-outage', saveSequence: 1, payload: payload(1000) })
  let available = false
  const service = createAccountService({ store: f.store, now: () => 1000, resolveRaidRewardTotal: async () => {
    if (!available) throw new Error('private-database-host-and-credential')
    return 800
  } })
  const http = createAccountHttpHandler({ service, authenticate: async () => identity, now: () => 1000 })
  const before = await f.store.inspect()
  for (const action of ['load', 'save']) {
    const response = await http(httpRequest({ action, ownerId, revision: 'during-source-outage', saveSequence: 2, payload: payload(1300, 800) }))
    assert.equal(response.status, 503)
    assert.equal((await response.text()).includes('private-database-host-and-credential'), false)
    assert.deepEqual(await f.store.inspect(), before)
  }
  available = true
  const recovered = await (await http(httpRequest({ action: 'load', ownerId }))).json()
  assert.equal(balanceOf(recovered.gameData.payload), 1800)
})

test('explicit game-data deletion permits a fresh same-UID save without restoring old progress or previously earned raid VP', async () => {
  const f = await fixture()
  await f.call('save', { revision: 'before-explicit-delete', saveSequence: 1, payload: {
    ...payload(1000), 'champions-dex-v2': '[{"captureId":"deleted-pokemon","speciesId":25}]',
    'champions-settings-v1': '{"textScale":2}',
  } })
  await f.grant(800)
  await f.call('load')
  await f.grant(1100) // Even a previously unobserved award is part of the discarded game's history.
  assert.equal((await f.call('deleteGameData')).deleted, true)
  const restarted = createAccountService({ store: f.store, now: () => 1000, resolveRaidRewardTotal: createRaidRewardTotalResolver(f.rankedStore) })
  const reset = await restarted.execute(identity, { action: 'load', ownerId })
  assert.equal(balanceOf(reset.gameData.payload), INITIAL_VP_BALANCE)
  assert.equal(reset.gameData.payload['champions-dex-v2'], undefined)
  assert.equal(reset.gameData.payload['champions-settings-v1'], undefined)
  assert.deepEqual(JSON.parse(reset.gameData.payload[key]).raidVpRewards, { uid, total: 1100 })
  const command = { revision: 'fresh-after-delete', saveSequence: 2, payload: reset.gameData.payload }
  await f.call('save', command)
  await f.call('save', command)
  assert.equal(balanceOf((await f.call('load')).gameData.payload), INITIAL_VP_BALANCE)
  await f.grant(1400)
  assert.equal(balanceOf((await f.call('load')).gameData.payload), INITIAL_VP_BALANCE + 300)
})

test('lost fresh-game load response after explicit deletion cannot issue old VP again on retry', async () => {
  const f = await fixture()
  await f.grant(800)
  await f.call('save', { revision: 'credited-before-delete', saveSequence: 1, payload: payload(1800, 800) })
  await f.call('deleteGameData')
  await f.call('load') // The first reset response is lost before local state is replaced.
  const retry = await f.call('load')
  assert.equal(balanceOf(retry.gameData.payload), INITIAL_VP_BALANCE)
  const repeated = await f.call('load')
  assert.deepEqual(repeated, retry)
  await f.call('save', { revision: 'retried-fresh-game', saveSequence: 2, payload: retry.gameData.payload })
  assert.equal(balanceOf((await f.call('load')).gameData.payload), INITIAL_VP_BALANCE)
})

test('a delayed pre-deletion save cannot recreate the discarded game before the reset load', async () => {
  const f = await fixture()
  await f.grant(800)
  const oldPayload = { ...payload(1800, 800), 'champions-dex-v2': '[{"captureId":"must-stay-deleted","speciesId":25}]' }
  await f.call('save', { revision: 'before-delete-race', saveSequence: 1, payload: oldPayload })
  await f.call('deleteGameData')
  await assert.rejects(f.call('save', { revision: 'late-before-delete', saveSequence: 2, payload: oldPayload }), error => error.status === 409)
  const fresh = await f.call('load')
  assert.equal(fresh.gameData.payload['champions-dex-v2'], undefined)
  assert.equal(balanceOf(fresh.gameData.payload), INITIAL_VP_BALANCE)
  await f.call('save', { revision: 'after-delete-race', saveSequence: 3, payload: fresh.gameData.payload })
})

test('explicit different-UID guest migration preserves VP and collection but drops source online receipts before the real account save', async () => {
  const guestUid = 'guest-wallet-migration'
  const source = { ...payload(50800), 'champions-dex-v2': '[{"captureId":"guest-kept-mon","speciesId":25}]' }
  source[key] = JSON.stringify({ walletBalance: 50800, raidVpRewards: { uid: guestUid, total: 800 }, rankedVpRewards: { uid: guestUid, total: 600 } })
  const original = structuredClone(source)
  const migrated = migrateOnlineWalletReceipts(source, { sourceUid: guestUid, targetUid: uid })
  assert.deepEqual(source, original)
  assert.equal(balanceOf(migrated), 50800)
  assert.equal(migrated['champions-dex-v2'], source['champions-dex-v2'])
  assert.equal(JSON.parse(migrated[key]).raidVpRewards, undefined)
  assert.equal(JSON.parse(migrated[key]).rankedVpRewards, undefined)
  const f = await fixture()
  await f.call('save', { revision: 'migrated-guest-wallet', saveSequence: 1, payload: migrated })
  assert.deepEqual((await f.call('load')).gameData.payload, migrated)
  await f.grant(300)
  assert.equal(balanceOf((await f.call('load')).gameData.payload), 51100)
})

test('guest migration copies only valid target-account receipts and never reissues target historical VP', async () => {
  const guestUid = 'guest-wallet-migration'
  const source = payload(50800)
  source[key] = JSON.stringify({ walletBalance: 50800, raidVpRewards: { uid: guestUid, total: 800 }, rankedVpRewards: { uid: guestUid, total: 600 } })
  const targetPayload = payload(300, 1100)
  targetPayload[key] = JSON.stringify({ walletBalance: 300, raidVpRewards: { uid, total: 1100 }, rankedVpRewards: { uid, total: 900 } })
  const originalTarget = structuredClone(targetPayload)
  const migrated = migrateOnlineWalletReceipts(source, { sourceUid: guestUid, targetUid: uid, targetPayload })
  assert.deepEqual(targetPayload, originalTarget)
  const wallet = JSON.parse(migrated[key])
  assert.equal(wallet.walletBalance, 50800)
  assert.deepEqual(wallet.raidVpRewards, { uid, total: 1100 })
  assert.deepEqual(wallet.rankedVpRewards, { uid, total: 900 })
  const f = await fixture()
  await f.grant(1100)
  await f.call('save', { revision: 'target-before-migrate', saveSequence: 1, payload: targetPayload })
  await f.call('save', { revision: 'target-after-migrate', saveSequence: 2, payload: migrated })
  assert.equal(balanceOf((await f.call('load')).gameData.payload), 50800)
  await f.grant(1400)
  assert.equal(balanceOf((await f.call('load')).gameData.payload), 51100)
  const invalidTarget = { [key]: JSON.stringify({ raidVpRewards: { uid: 'foreign-account', total: 1100 }, rankedVpRewards: { uid, total: -1 } }) }
  const sanitized = JSON.parse(migrateOnlineWalletReceipts(source, { sourceUid: guestUid, targetUid: uid, targetPayload: invalidTarget })[key])
  assert.equal(sanitized.raidVpRewards, undefined)
  assert.equal(sanitized.rankedVpRewards, undefined)
})

test('same-UID Google linking and non-migration calls retain the original receipts exactly', () => {
  const original = payload(50800, 800)
  assert.equal(migrateOnlineWalletReceipts(original, { sourceUid: uid, targetUid: uid }), original)
  assert.equal(migrateOnlineWalletReceipts(original, { targetUid: uid }), original)
  assert.equal(migrateOnlineWalletReceipts(original, { sourceUid: uid }), original)
  assert.equal(migrateOnlineWalletReceipts(original), original)
})
