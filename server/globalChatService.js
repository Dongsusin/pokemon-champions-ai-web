import { createHash, randomUUID } from 'node:crypto'
import { maskRankedTrainerName } from '../src/data/rankedPrivacy.js'

export const GLOBAL_CHAT_MAX_MESSAGES = 30
export const GLOBAL_CHAT_MAX_TEXT_LENGTH = 200
export const GLOBAL_CHAT_SEND_COOLDOWN_MS = 3000
const RECEIPTS_PER_SENDER = 16
const COLLECTION = 'globalChat'
const SENDER_COLLECTION = 'globalChatSenders'
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value)
const plain = value => value && typeof value === 'object' && !Array.isArray(value)
const ownerKey = uid => createHash('sha256').update(`global-chat-owner:${uid}`).digest('hex')
const contentHash = text => createHash('sha256').update(text).digest('hex')
const publicName = (name, isGuest) => {
  const masked = maskRankedTrainerName(name, isGuest)
  const points = [...masked]
  return points.length <= 64 ? masked : `${points.slice(0, 62).join('')}**`
}
const publicMessage = (message, owner) => message ? {
  id: message.id, name: message.name, text: message.text, createdAt: message.createdAt,
  isOwn: message.owner === owner,
} : null

export class GlobalChatError extends Error {
  constructor(code, message, status = 400, retryAfterMs) {
    super(message)
    this.code = code
    this.status = status
    if (retryAfterMs !== undefined) this.retryAfterMs = retryAfterMs
  }
}
const fail = (...args) => { throw new GlobalChatError(...args) }

export function normalizeGlobalChatText(value) {
  if (typeof value !== 'string') fail('INVALID_TEXT', '채팅 내용을 입력해주세요.')
  // Keep emoji joiners intact, while removing invisible controls and replacing
  // line breaks with spaces so a message cannot impersonate other chat rows.
  const text = value.normalize('NFC').replace(/[\r\n\t]+/gu, ' ')
    .replace(/[\p{Cc}\p{Cs}\p{Bidi_Control}\u00ad\u180e\u200b\u2060-\u2064\ufeff]/gu, '').trim()
  if (!/[^\p{M}\p{Cf}\s]/u.test(text)) fail('INVALID_TEXT', '채팅 내용을 입력해주세요.')
  if ([...text].length > GLOBAL_CHAT_MAX_TEXT_LENGTH) fail('TEXT_TOO_LONG', '채팅은 200자까지 입력할 수 있습니다.')
  return text
}

const snapshot = (metadata, owner, messages) => ({
  revision: metadata?.revision ?? 0,
  latest: publicMessage(metadata?.latest, owner),
  ...(messages ? { messages: messages.map(message => publicMessage(message, owner)) } : {}),
})

// Run within the same transaction as guest identity erasure. The revision moves
// forward even if the last message is removed, so polling clients clear it.
export async function eraseGuestGlobalChat(tx, uid) {
  const owner = ownerKey(uid)
  const metadata = await tx.get(COLLECTION, 'metadata')
  const feed = await tx.get(COLLECTION, 'feed')
  const messages = (feed?.messages ?? []).filter(message => message.owner !== owner)
  tx.delete(SENDER_COLLECTION, owner)
  if (messages.length !== (feed?.messages ?? []).length) {
    tx.set(COLLECTION, 'feed', { messages })
    tx.set(COLLECTION, 'metadata', {
      revision: (metadata?.revision ?? 0) + 1, latest: messages.at(-1) ?? null,
    })
  }
}

export function createGlobalChatService({ store, guestRegistry, now = Date.now, newId = randomUUID }) {
  return {
    async execute(identity, command) {
      if (!identity || !validId(identity.uid)) fail('UNAUTHENTICATED', '로그인이 필요합니다.', 401)
      if (!plain(command) || !['read', 'send'].includes(command.action)) fail('UNKNOWN_ACTION', '지원하지 않는 채팅 요청입니다.')
      if (command.action === 'read') {
        if (command.expanded !== undefined && typeof command.expanded !== 'boolean') fail('INVALID_COMMAND', '채팅 요청 형식이 올바르지 않습니다.')
        if (command.revision !== undefined && (!Number.isSafeInteger(command.revision) || command.revision < 0)) fail('INVALID_REVISION', '채팅 버전이 올바르지 않습니다.')
      }
      const sending = command.action === 'send'
      const text = sending ? normalizeGlobalChatText(command.text) : null
      if (sending && (typeof command.requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(command.requestId))) {
        fail('INVALID_REQUEST_ID', '채팅 요청 식별자가 올바르지 않습니다.')
      }
      const id = sending ? newId() : null
      const owner = ownerKey(identity.uid)
      return store.transaction(async tx => {
        // This read participates in transaction conflict detection, closing the
        // race between a previously authenticated send and guest logout.
        const guest = identity.isGuest === true ? await guestRegistry.read(identity, tx) : null
        const metadata = await tx.get(COLLECTION, 'metadata')
        if (!sending) {
          if (!command.expanded || command.revision === (metadata?.revision ?? 0)) return snapshot(metadata, owner)
          const feed = await tx.get(COLLECTION, 'feed')
          return snapshot(metadata, owner, feed?.messages ?? [])
        }
        const timestamp = now()
        if (!Number.isSafeInteger(timestamp) || timestamp < 0 || timestamp > 8_640_000_000_000_000) throw new Error('Invalid chat clock')
        const sender = await tx.get(SENDER_COLLECTION, owner)
        const digest = contentHash(text)
        const receipt = sender?.receipts?.find(entry => entry.requestId === command.requestId)
        if (receipt && receipt.digest !== digest) fail('REQUEST_ID_REUSED', '이미 사용된 채팅 요청입니다. 다시 전송해주세요.', 409)
        if (!receipt && sender && timestamp - sender.lastSentAt < GLOBAL_CHAT_SEND_COOLDOWN_MS) {
          fail('SEND_RATE_LIMITED', '채팅은 3초마다 보낼 수 있습니다.', 429,
            Math.min(60_000, GLOBAL_CHAT_SEND_COOLDOWN_MS - (timestamp - sender.lastSentAt)))
        }
        const feed = await tx.get(COLLECTION, 'feed')
        // A lost response can be retried even after its message leaves the
        // latest thirty. Sender receipts retain no chat text or raw account ID,
        // and are bounded independently of message retention.
        if (receipt) return snapshot(metadata, owner, feed?.messages ?? [])
        const message = {
          id, owner, name: publicName(guest?.displayName ?? identity.name, identity.isGuest === true),
          text, createdAt: Math.max(timestamp, metadata?.latest?.createdAt ?? 0),
        }
        const messages = [...(feed?.messages ?? []), message].slice(-GLOBAL_CHAT_MAX_MESSAGES)
        const nextMetadata = { revision: (metadata?.revision ?? 0) + 1, latest: message }
        tx.set(COLLECTION, 'feed', { messages })
        tx.set(COLLECTION, 'metadata', nextMetadata)
        tx.set(SENDER_COLLECTION, owner, {
          lastSentAt: timestamp,
          receipts: [...(sender?.receipts ?? []), { requestId: command.requestId, digest }].slice(-RECEIPTS_PER_SENDER),
        })
        return snapshot(nextMetadata, owner, messages)
      })
    },
  }
}
