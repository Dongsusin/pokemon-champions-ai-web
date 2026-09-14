import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { containsChatProfanity } from '../server/chatModeration.js'
import { createGlobalChatService, normalizeGlobalChatText } from '../server/globalChatService.js'
import { createGlobalChatHttpHandler } from '../server/globalChatHttp.js'
import { createMemoryRankedStore } from '../server/rankedStore.js'
import { SPECIES_PROFILES, MOVE_CATALOG, ABILITY_CATALOG, NATURE_OPTIONS } from '../src/data/trainingData.js'
import { ALL_BATTLE_ITEMS } from '../src/data/shopData.js'
import { STANDARD_Z_MOVES, SIGNATURE_Z_MOVES } from '../src/data/zMoveData.js'

// Independently chosen chat-moderation examples. This is a bounded lexical
// regression corpus, not a claim to classify every offensive sentence.
// Neither external moderation services nor production chat are contacted.
const output = fileURLToPath(new URL('./.cache/chat-moderation/', import.meta.url))
await fs.mkdir(output, { recursive: true })
const blocked = new Map()
const addBlocked = (text, category) => blocked.set(text, category)
const syllableVariants = word => [word, word.normalize('NFD'), [...word].join(' '), [...word].join('.'), [...word].join('_'), [...word].join('1'), [...word].join('\u200b'), [...word].join('\u200d'), [...word].join('\u2060')]
for (const word of ['씨발', '시발', '씨팔', '시팔', '병신', '븅신', '개새끼', '씹새끼', '좆같다', '존나', '지랄']) {
  for (const text of syllableVariants(word)) addBlocked(text, 'Korean word and obfuscation')
}
for (const text of ['야 씨발놈아', '너 진짜 병신이냐', '개새끼야', '시발ㅋㅋ', '존나 짜증나', '지랄하지마',
  'ㅆㅣㅂㅏㄹ', 'ㅅㅣㅂㅏㄹ', 'ㅂㅕㅇㅅㅣㄴ', 'ㅈㅗㄴㄴㅏ', 'ㅈㅣㄹㅏㄹ',
  '씨발', '병신', '시\u200b\u2060발', '씨\ufe0f발']) addBlocked(text, 'Korean inflection, jamo and invisible formatting')
for (const word of ['ㅅㅂ', 'ㅆㅂ', 'ㅂㅅ', 'ㅈㄴ', 'ㅈㄹ']) {
  for (const text of [word, `야 ${word}`, `${word}ㅋㅋ`, [...word].join(' '), [...word].join('.'), [...word].join('1'), [...word].join('\u200b')]) addBlocked(text, 'Common abusive Korean initials')
}
const fullWidth = word => [...word].map(char => /[!-~]/.test(char) ? String.fromCharCode(char.charCodeAt(0) + 0xfee0) : char).join('')
for (const word of ['fuck', 'shit', 'bitch', 'asshole', 'motherfucker', 'dickhead', 'cunt']) {
  for (const text of [word, word.toUpperCase(), fullWidth(word), [...word].join('.'), [...word].join(' '), [...word].join('_'), [...word].join('\u200b')]) addBlocked(text, 'English strong profanity and obfuscation')
}
for (const text of ['fuck you', 'you asshole!', 'FuCk', 'sh1t', 'sh!t', '$hit', 'b1tch', 'b!tch', 'a$$hole', 'a55hole', '@sshole', 'm0therfucker', 'd1ckhead', 'f1u2c3k']) addBlocked(text, 'English context and common leetspeak')
for (const text of ['닥쳐', '꺼져', '이새끼야', '호로새끼', '찐따']) addBlocked(text, 'Direct hostile insults')
for (const text of ['시발점 씨발', '교체 시 발동 개새끼', '시발역에서 병신', '졸라매다 씨발']) addBlocked(text, 'A legitimate phrase must not exempt other profanity in the message')

const ordinary = [
  '안녕하세요! 잘 부탁드립니다.', '좋은 배틀이었어요 gg', '지금 18명 접속 중이에요', '오늘 18시에 시작해요', '18',
  '이번 시합에 발바로를 골랐어요', '씨뿌리기로 회복하고 시드플레어로 공격해요', '병상첨병은 상태이상 상대에게 강해요',
  '모래두지와 왕의징표석을 얻었어요', '이상해씨 진화는 이상해풀 다음 이상해꽃이에요',
  '저는 이 전략이 싫어요', '패배해서 화가 나지만 다음에는 이겨볼게요', '아쉽네요! 수고하셨습니다',
  'ㅊㅋㅊㅋ', 'ㄱㄱ', 'ㄴㄴ', 'ㅇㅇ', 'ㅋㅋㅋㅋ', 'ㅎㅎ', 'ㅈㅅ', '고마워요 ㅠㅠ',
  '시작 버튼을 눌러 주세요', '설명 부탁합니다', '병원에 다녀왔어요', '지금 나갈게요', '시드가 달라졌어요',
  'hello', 'Hello everyone!', 'class', 'classic', 'classification', 'assistant', 'grass', 'Grass Knot', 'Shell Smash', 'Passimian',
  'shellfish', 'assignment', 'pass', 'compass', 'Scunthorpe', 'Fuchsia City', 'Pikachu is fast.',
  'Please switch to your Grass type.', 'Use Shell Smash before attacking.', 'Great game, thanks!', 'level 18',
  '배틀 즐거웠어요 ⚡🔥😀', '가족 이모지 👨‍👩‍👧‍👦와 함께 안녕하세요', '한글 자모 연습 ㄱ ㄴ ㄷ',
  '시발점', '시발역', '기술 사용 시 발동합니다', '교체 시 발동하는 특성', '발바로 진화 후 좋아요', '졸라매다',
]
const canonical = new Map()
function addNames(category, names) {
  for (const name of names) if (typeof name === 'string' && name.trim()) {
    const value = name.trim()
    if (!canonical.has(value)) canonical.set(value, category)
  }
}
const profiles = Object.values(SPECIES_PROFILES)
addNames('Pokemon names and forms', profiles.flatMap(profile => [profile.name, profile.formName, profile.slug, profile.englishName]))
addNames('Move names', MOVE_CATALOG.flatMap(move => [move.name, move.englishName]))
addNames('Ability names', [...Object.keys(ABILITY_CATALOG), ...profiles.flatMap(profile => profile.abilities ?? [])])
addNames('Item names', ALL_BATTLE_ITEMS.flatMap(item => [item.name, item.englishName]))
addNames('Nature names', NATURE_OPTIONS.flatMap(nature => [nature.label, nature.name, nature.englishName]))
addNames('Z-Move names', [...Object.values(STANDARD_Z_MOVES), ...Object.values(SIGNATURE_Z_MOVES)].flatMap(move => [move.name, move.englishName]))

const misses = [...blocked].filter(([text]) => !containsChatProfanity(text)).map(([text, category]) => ({ text, category }))
const falsePositives = ordinary.filter(text => containsChatProfanity(text)).map(text => ({ text, category: 'Ordinary conversation' }))
for (const [name, category] of canonical) {
  for (const text of [name, `${name} 좋아요`, `${name.normalize('NFD')} 추천해요`]) {
    if (containsChatProfanity(text)) falsePositives.push({ text, category })
  }
}
const inventory = {
  pokemonProfiles: profiles.length, moves: MOVE_CATALOG.length, abilities: new Set([...Object.keys(ABILITY_CATALOG), ...profiles.flatMap(profile => profile.abilities ?? [])]).size,
  items: ALL_BATTLE_ITEMS.length, natures: NATURE_OPTIONS.length, uniqueCanonicalNames: canonical.size,
  canonicalInputs: canonical.size * 3, blockedInputs: blocked.size, ordinaryInputs: ordinary.length,
}
await fs.writeFile(path.join(output, 'corpus-results.json'), JSON.stringify({ inventory, misses, falsePositives }, null, 2))
console.log(`Moderation corpus: ${blocked.size} blocked examples, ${ordinary.length} ordinary examples, ${canonical.size} canonical names (${canonical.size * 3} contexts).`)

test('curated Korean and English profanity variants are blocked', () => {
  assert.deepEqual(misses, [], `${misses.length} blocked examples were missed; see .cache/chat-moderation/corpus-results.json`)
})
test('ordinary conversations and complete Pokemon game name catalogs remain allowed', () => {
  assert.deepEqual(falsePositives, [], `${falsePositives.length} ordinary/catalog strings were overblocked; see .cache/chat-moderation/corpus-results.json`)
})
test('server normalization rejects every blocked variant with the stable 422 error', () => {
  const failures = []
  for (const [text, category] of blocked) {
    try { normalizeGlobalChatText(text); failures.push({ text, category, reason: 'accepted' }) }
    catch (error) { if (error.code !== 'CHAT_PROFANITY' || error.status !== 422) failures.push({ text, category, reason: `${error.code}:${error.status}` }) }
  }
  assert.deepEqual(failures, [])
})
test('server normalization preserves allowed game messages, Unicode and emoji', () => {
  for (const text of ordinary) assert.equal(normalizeGlobalChatText(text), text.normalize('NFC'))
  for (const name of canonical.keys()) assert.equal(normalizeGlobalChatText(name), name.normalize('NFC'))
})
test('rejected sends never enter a storage transaction or consume a sender cooldown', async () => {
  let transactions = 0, createdIds = 0
  const database = createMemoryRankedStore()
  const store = { transaction: work => { transactions += 1; return database.transaction(work) } }
  const service = createGlobalChatService({ store, now: () => 1_000_000, newId: () => `moderation-${++createdIds}` })
  const identity = { uid: 'moderation-test-user', name: '테스트', isGuest: false }
  await assert.rejects(service.execute(identity, { action: 'send', text: '씨 발', requestId: 'blocked-message-001' }), error => error.status === 422 && error.code === 'CHAT_PROFANITY')
  assert.equal(transactions, 0)
  assert.equal(createdIds, 0)
  assert.deepEqual((await database.inspect()).collections, {})
  const accepted = await service.execute(identity, { action: 'send', text: '병상첨병을 사용해요', requestId: 'allowed-message-001' })
  assert.equal(accepted.revision, 1)
  assert.equal(accepted.latest.text, '병상첨병을 사용해요')
})
test('an HTTP client cannot bypass moderation and a subsequent valid send still succeeds', async () => {
  const store = createMemoryRankedStore()
  const service = createGlobalChatService({ store, now: () => 2_000_000, newId: () => 'http-moderation-message' })
  const handler = createGlobalChatHttpHandler({ service, authenticate: async () => ({ uid: 'http-moderation-user', name: '유저', isGuest: false }) })
  const post = (text, requestId) => handler(new Request('http://localhost/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer local-only-test-token', Origin: 'http://localhost' }, body: JSON.stringify({ action: 'send', text, requestId }) }))
  const blockedResponse = await post('ＦＵＣＫ', 'http-blocked-001')
  assert.equal(blockedResponse.status, 422)
  const body = await blockedResponse.json()
  assert.equal(body.error.code, 'CHAT_PROFANITY')
  assert.doesNotMatch(JSON.stringify(body), /ＦＵＣＫ|http-moderation-user/)
  assert.deepEqual((await store.inspect()).collections, {})
  const accepted = await post('시드플레어와 씨뿌리기', 'http-allowed-001')
  assert.equal(accepted.status, 200)
  assert.equal((await accepted.json()).revision, 1)
})
