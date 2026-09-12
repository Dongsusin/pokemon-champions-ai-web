import assert from 'node:assert/strict'
import { ACHIEVEMENT_STORAGE_KEY, createAchievementState } from '../src/data/achievementData.js'
import { creditRankedVpRewards, loadAchievementWallet, saveAchievementWallet } from '../src/data/achievementStorage.js'
import { readLocalPlayerData, replaceLocalPlayerData } from '../src/auth/accountStorage.js'

const UID = 'ranked-wallet-player'
const LEGACY_VP_KEY = 'champions-vp-v1'
class Storage {
  values = new Map()
  failKey = null
  getItem(key) { return this.values.get(key) ?? null }
  setItem(key, value) {
    if (key === this.failKey) throw new Error('QuotaExceededError')
    this.values.set(key, String(value))
  }
  removeItem(key) { this.values.delete(key) }
}
const saved = storage => JSON.parse(storage.getItem(ACHIEVEMENT_STORAGE_KEY))
const cursor = storage => saved(storage)?.rankedVpRewards
const snapshot = storage => [...storage.values.entries()]
function initialized(balance = 1000) {
  const storage = new Storage()
  const progress = createAchievementState()
  progress.stats.wins = 3
  progress.stats.bestStreak = 2
  progress.unlocked['wins-1'] = 1700000000000
  progress.processedBattleIds = ['ai-history-1', 'ai-history-2', 'ai-history-3']
  saveAchievementWallet(progress, balance, storage)
  return { storage, progress }
}
function credit(storage, total, uid = UID, responseUid = uid) {
  const wallet = loadAchievementWallet(storage)
  return creditRankedVpRewards(wallet.progress, wallet.balance, { uid: responseUid, total }, uid, storage)
}
function withWindow(storage, action) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: storage, sessionStorage: new Storage() } })
  try { return action() }
  finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous)
    else delete globalThis.window
  }
}

let passed = 0
const failures = []
function test(name, action) {
  try { action(); passed += 1; console.log(`PASS ${name}`) }
  catch (error) { failures.push({ name, error }); console.error(`FAIL ${name}: ${error.stack}`) }
}

test('legacy VP-only saves migrate with their existing balance and an atomic ranked cursor', () => {
  const storage = new Storage()
  storage.setItem(LEGACY_VP_KEY, '2750')
  assert.deepEqual(credit(storage, 300), { balance: 3050, granted: 300, appliedTotal: 300 })
  assert.deepEqual(cursor(storage), { uid: UID, total: 300 })
  assert.deepEqual(loadAchievementWallet(storage), { progress: createAchievementState(), balance: 3050 })
  assert.equal(storage.getItem(LEGACY_VP_KEY), '3050')
})

test('existing achievement wallets receive only the server cumulative reward', () => {
  const { storage, progress } = initialized(4200)
  assert.deepEqual(credit(storage, 300), { balance: 4500, granted: 300, appliedTotal: 300 })
  assert.deepEqual(loadAchievementWallet(storage), { progress, balance: 4500 })
})

test('repeated polls and a lost successful response cannot award the same VP twice', () => {
  const { storage } = initialized()
  credit(storage, 300) // The caller never receives this first result.
  const committed = snapshot(storage)
  for (let attempt = 0; attempt < 12; attempt += 1) {
    assert.deepEqual(credit(storage, 300), { balance: 1300, granted: 0, appliedTotal: 300 })
  }
  assert.deepEqual(snapshot(storage), committed)
})

test('an older response cannot move the cursor backward or subtract VP', () => {
  const { storage } = initialized()
  credit(storage, 600)
  for (const total of [300, 0, 100, 600]) {
    assert.deepEqual(credit(storage, total), { balance: 1600, granted: 0, appliedTotal: 600 })
    assert.deepEqual(cursor(storage), { uid: UID, total: 600 })
  }
  assert.deepEqual(credit(storage, 750), { balance: 1750, granted: 150, appliedTotal: 750 })
})

test('a reconnect recovers rewards beyond the latest 20 matches without needing match history', () => {
  const { storage } = initialized()
  credit(storage, 300)
  assert.deepEqual(credit(storage, 300 * 75), { balance: 23500, granted: 22200, appliedTotal: 22500 })
  assert.deepEqual(credit(storage, 22500), { balance: 23500, granted: 0, appliedTotal: 22500 })
})

test('a long sequence of wins, losses and draws follows the cumulative ledger without a receipt cap', () => {
  const { storage } = initialized()
  let total = 0
  for (let match = 0; match < 80; match += 1) {
    const amount = [300, 100, 150, 0][match % 4]
    total += amount
    assert.deepEqual(credit(storage, total), { balance: 1000 + total, granted: amount, appliedTotal: total })
  }
  assert.equal(loadAchievementWallet(storage).balance, 12000)
})

test('a response for another account is rejected without changing either wallet key', () => {
  const { storage } = initialized()
  credit(storage, 300)
  const before = snapshot(storage)
  assert.throws(() => credit(storage, 900, UID, 'someone-else'))
  assert.deepEqual(snapshot(storage), before)
})

test('a wallet carrying another account receipt must be resynced instead of recredited', () => {
  const { storage } = initialized()
  credit(storage, 300)
  const before = snapshot(storage)
  assert.throws(() => credit(storage, 300, 'different-active-user'))
  assert.deepEqual(snapshot(storage), before)
})

test('missing or invalid account identity is rejected before committing money', () => {
  for (const uid of ['', null, undefined]) {
    const { storage, progress } = initialized()
    const before = snapshot(storage)
    assert.throws(() => creditRankedVpRewards(progress, 1000, { uid, total: 300 }, uid, storage))
    assert.deepEqual(snapshot(storage), before)
  }
})

test('noninteger, negative, missing and unsafe cumulative totals cannot corrupt a wallet', () => {
  const { storage, progress } = initialized()
  const before = snapshot(storage)
  for (const total of [-1, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, '300', null, undefined]) {
    assert.throws(() => creditRankedVpRewards(progress, 1000, { uid: UID, total }, UID, storage))
    assert.deepEqual(snapshot(storage), before)
  }
  for (const rewards of [null, undefined, {}]) {
    assert.throws(() => creditRankedVpRewards(progress, 1000, rewards, UID, storage))
    assert.deepEqual(snapshot(storage), before)
  }
})

test('zero cumulative rewards leave the balance unchanged', () => {
  const { storage } = initialized()
  assert.deepEqual(credit(storage, 0), { balance: 1000, granted: 0, appliedTotal: 0 })
  assert.equal(loadAchievementWallet(storage).balance, 1000)
})

test('a reward that would overflow the safe VP balance is rejected atomically', () => {
  const { storage } = initialized(Number.MAX_SAFE_INTEGER - 1)
  const before = snapshot(storage)
  assert.throws(() => credit(storage, 300))
  assert.deepEqual(snapshot(storage), before)
})

test('failure of the authoritative wallet write leaves VP and cursor uncredited for retry', () => {
  const { storage } = initialized()
  const before = snapshot(storage)
  storage.failKey = ACHIEVEMENT_STORAGE_KEY
  assert.throws(() => credit(storage, 300))
  assert.deepEqual(snapshot(storage), before)
  storage.failKey = null
  assert.deepEqual(credit(storage, 300), { balance: 1300, granted: 300, appliedTotal: 300 })
  assert.deepEqual(credit(storage, 300), { balance: 1300, granted: 0, appliedTotal: 300 })
})

test('failure of the legacy VP mirror cannot undo the committed reward or pay it twice', () => {
  const { storage } = initialized()
  storage.failKey = LEGACY_VP_KEY
  assert.deepEqual(credit(storage, 300), { balance: 1300, granted: 300, appliedTotal: 300 })
  assert.equal(storage.getItem(LEGACY_VP_KEY), '1000')
  assert.equal(loadAchievementWallet(storage).balance, 1300)
  assert.deepEqual(cursor(storage), { uid: UID, total: 300 })
  assert.deepEqual(credit(storage, 300), { balance: 1300, granted: 0, appliedTotal: 300 })
})

test('corrupt wallet JSON cannot be interpreted as a new unpaid ranked wallet', () => {
  const { storage, progress } = initialized()
  storage.setItem(ACHIEVEMENT_STORAGE_KEY, '{broken-wallet')
  const before = snapshot(storage)
  assert.throws(() => creditRankedVpRewards(progress, 1000, { uid: UID, total: 300 }, UID, storage))
  assert.deepEqual(snapshot(storage), before)
})

test('malformed persisted ranked receipts cannot be discarded by credit or ordinary wallet saves', () => {
  for (const receipt of [{ uid: UID, total: -1 }, { uid: UID, total: '300' }, { uid: '', total: 300 }, [], 300]) {
    const { storage, progress } = initialized()
    storage.setItem(ACHIEVEMENT_STORAGE_KEY, JSON.stringify({ ...saved(storage), rankedVpRewards: receipt }))
    const before = snapshot(storage)
    assert.throws(() => creditRankedVpRewards(progress, 1000, { uid: UID, total: 300 }, UID, storage))
    assert.deepEqual(snapshot(storage), before)
    assert.throws(() => saveAchievementWallet(progress, 1200, storage))
    assert.deepEqual(snapshot(storage), before)
  }
})

test('purchases, AI rewards and achievement rewards preserve the ranked receipt through normal saves', () => {
  const { storage } = initialized(4000)
  credit(storage, 300)
  let wallet = loadAchievementWallet(storage)
  saveAchievementWallet(wallet.progress, wallet.balance - 500, storage) // Purchase.
  assert.deepEqual(cursor(storage), { uid: UID, total: 300 })
  assert.deepEqual(credit(storage, 300), { balance: 3800, granted: 0, appliedTotal: 300 })
  wallet = loadAchievementWallet(storage)
  const aiProgress = structuredClone(wallet.progress)
  aiProgress.stats.wins += 1
  aiProgress.processedBattleIds.push('ai-history-4')
  saveAchievementWallet(aiProgress, wallet.balance + 150, storage)
  assert.deepEqual(cursor(storage), { uid: UID, total: 300 })
  wallet = loadAchievementWallet(storage)
  const achievementProgress = structuredClone(wallet.progress)
  achievementProgress.unlocked['wins-10'] = 1700000005000
  saveAchievementWallet(achievementProgress, wallet.balance + 300, storage)
  assert.deepEqual(cursor(storage), { uid: UID, total: 300 })
  assert.deepEqual(credit(storage, 400), { balance: 4350, granted: 100, appliedTotal: 400 })
  assert.deepEqual(loadAchievementWallet(storage).progress, achievementProgress)
})

test('ranked VP credit does not mutate or advance AI achievement progress', () => {
  const { storage, progress } = initialized()
  const input = structuredClone(progress)
  Object.freeze(progress.stats)
  Object.freeze(progress.unlocked)
  Object.freeze(progress.processedBattleIds)
  Object.freeze(progress)
  assert.deepEqual(creditRankedVpRewards(progress, 1000, { uid: UID, total: 300 }, UID, storage), {
    balance: 1300, granted: 300, appliedTotal: 300,
  })
  assert.deepEqual(progress, input)
  assert.deepEqual(loadAchievementWallet(storage).progress, input)
})

test('account payload sync carries the atomic wallet and cursor to a fresh device', () => {
  const { storage: first, progress } = initialized()
  credit(first, 300)
  const payload = withWindow(first, readLocalPlayerData)
  const second = new Storage()
  withWindow(second, () => replaceLocalPlayerData(payload))
  assert.deepEqual(loadAchievementWallet(second), { progress, balance: 1300 })
  assert.deepEqual(cursor(second), { uid: UID, total: 300 })
  assert.deepEqual(credit(second, 300), { balance: 1300, granted: 0, appliedTotal: 300 })
  assert.deepEqual(credit(second, 450), { balance: 1450, granted: 150, appliedTotal: 450 })
  const returnedPayload = withWindow(second, readLocalPlayerData)
  withWindow(first, () => replaceLocalPlayerData(returnedPayload))
  assert.deepEqual(credit(first, 450), { balance: 1450, granted: 0, appliedTotal: 450 })
})

test('a device change before the first cloud save recovers the missing reward once', () => {
  const { storage: first } = initialized()
  const beforeRewardCloud = withWindow(first, readLocalPlayerData)
  credit(first, 300) // Local success, but the page closes before cloud upload.
  const second = new Storage()
  withWindow(second, () => replaceLocalPlayerData(beforeRewardCloud))
  assert.deepEqual(credit(second, 300), { balance: 1300, granted: 300, appliedTotal: 300 })
  const synced = withWindow(second, readLocalPlayerData)
  withWindow(first, () => replaceLocalPlayerData(synced))
  assert.deepEqual(credit(first, 300), { balance: 1300, granted: 0, appliedTotal: 300 })
})

if (failures.length) {
  console.error(`Ranked VP wallet validation failed: ${failures.length}/${passed + failures.length} checks.`)
  process.exitCode = 1
} else {
  console.log(`Validated ${passed} ranked VP wallet cases: cumulative recovery, account identity, atomic storage and device sync.`)
}
