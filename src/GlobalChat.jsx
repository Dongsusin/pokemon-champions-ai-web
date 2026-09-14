import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowDown, ChevronDown, MessageCircle, RefreshCw, Send, X } from 'lucide-react'
import useGlobalChat from './useGlobalChat'
import './globalChat.css'

const MAX_MESSAGE_LENGTH = 200
const NEAR_BOTTOM_DISTANCE = 64
const timeFormatter = new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

function messageTime(value) {
  const date = new Date(value)
  if (value == null || !Number.isFinite(date.getTime())) return { short: '--:--', full: '', iso: undefined }
  return { short: timeFormatter.format(date), full: date.toLocaleString('ko-KR'), iso: date.toISOString() }
}

function MessageTime({ value, className }) {
  const time = messageTime(value)
  return <time className={className} dateTime={time.iso} title={time.full}>{time.short}</time>
}

function trimMessage(value) {
  return Array.from(value).slice(0, MAX_MESSAGE_LENGTH).join('')
}

export default function GlobalChat({ user }) {
  const [expanded, setExpanded] = useState(false)
  const { latest, messages, loading, error, sendErrorCode, sending, sendMessage, refresh, available, clearSendError } = useGlobalChat(user, expanded)
  const [draft, setDraft] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [localError, setLocalError] = useState('')
  const [newMessageCount, setNewMessageCount] = useState(0)
  const [announcement, setAnnouncement] = useState('')
  const triggerRef = useRef(null)
  const dialogRef = useRef(null)
  const closeRef = useRef(null)
  const listRef = useRef(null)
  const composingRef = useRef(false)
  const requestRef = useRef(0)
  const submittingRef = useRef(false)
  const outsidePointerRef = useRef(false)
  const scrollRef = useRef({ initialized: false, nearBottom: true, ids: [], anchors: [] })
  const id = useId()
  const visibleMessages = useMemo(() => (messages || []).slice(-30), [messages])
  const messageLength = Array.from(draft).length
  const pending = sending || submitting
  const errorText = (typeof error === 'string' ? error : error?.message) || localError
  const contentRejected = ['CHAT_PROFANITY', 'INVALID_TEXT', 'TEXT_TOO_LONG'].includes(sendErrorCode)

  const captureScroll = useCallback(() => {
    const list = listRef.current
    if (!list) return
    const top = list.getBoundingClientRect().top
    scrollRef.current = {
      initialized: true,
      nearBottom: list.scrollHeight - list.scrollTop - list.clientHeight <= NEAR_BOTTOM_DISTANCE,
      ids: [...list.children].map((element) => element.dataset.messageId).filter(Boolean),
      anchors: [...list.children].filter((element) => element.dataset.messageId)
        .map((element) => ({ id: element.dataset.messageId, top: element.getBoundingClientRect().top - top, bottom: element.getBoundingClientRect().bottom - top }))
        .filter((anchor) => anchor.bottom >= 0),
    }
  }, [])

  const scrollToLatest = useCallback(() => {
    const list = listRef.current
    if (!list) return
    list.scrollTop = list.scrollHeight
    captureScroll()
    setNewMessageCount(0)
  }, [captureScroll])

  useLayoutEffect(() => {
    if (!expanded || !listRef.current) return
    const previous = scrollRef.current
    if (!previous.initialized || previous.nearBottom) {
      scrollToLatest()
      return
    }
    const list = listRef.current
    const rows = [...list.children].filter((element) => element.dataset.messageId)
    const previousIds = new Set(previous.ids)
    const added = rows.filter((row) => !previousIds.has(row.dataset.messageId)).length
    if (added) {
      // A rolling 30-message window can remove rows above the reader. Keep the
      // first surviving visible message at the same position when that happens.
      const anchor = previous.anchors.find((entry) => rows.some((row) => row.dataset.messageId === entry.id))
      if (anchor) {
        const row = rows.find((entry) => entry.dataset.messageId === anchor.id)
        list.scrollTop += row.getBoundingClientRect().top - list.getBoundingClientRect().top - anchor.top
      }
      setNewMessageCount((count) => count + added)
    }
    captureScroll()
  }, [expanded, visibleMessages, captureScroll, scrollToLatest])

  useEffect(() => {
    if (!expanded) return
    const dialog = dialogRef.current
    const trigger = triggerRef.current
    dialog.showModal()
    closeRef.current?.focus({ preventScroll: true })
    // showModal makes the rest of the document inert and provides native Tab
    // containment. Focus the close control first so touch keyboards stay closed.
    scrollToLatest()
    return () => {
      dialog.close()
      scrollRef.current = { initialized: false, nearBottom: true, ids: [], anchors: [] }
      if (trigger?.isConnected) trigger.focus({ preventScroll: true })
    }
  }, [expanded, scrollToLatest])

  useEffect(() => {
    requestRef.current += 1
    submittingRef.current = false
    setSubmitting(false)
    setDraft('')
    setLocalError('')
    setAnnouncement('')
    setExpanded(false)
  }, [user?.uid])

  async function handleSubmit(event) {
    event.preventDefault()
    if (composingRef.current || pending || submittingRef.current || !available || !draft.trim() || messageLength > MAX_MESSAGE_LENGTH) return
    const text = draft
    const request = ++requestRef.current
    submittingRef.current = true
    setSubmitting(true)
    setLocalError('')
    setAnnouncement('')
    try {
      const succeeded = await sendMessage(text)
      if (request !== requestRef.current) return
      if (succeeded) {
        setDraft((current) => current === text ? '' : current)
        setAnnouncement('메시지를 보냈습니다.')
      } else {
        setLocalError('메시지를 보내지 못했습니다. 입력한 내용을 확인하고 다시 보내 주세요.')
      }
    } catch {
      if (request === requestRef.current) setLocalError('메시지를 보내지 못했습니다. 잠시 후 다시 보내 주세요.')
    } finally {
      if (request === requestRef.current) {
        submittingRef.current = false
        setSubmitting(false)
      }
    }
  }

  async function retry() {
    setLocalError('')
    try { await refresh() } catch { setLocalError('채팅에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.') }
  }

  function isOutsideDialog(event) {
    if (event.target !== event.currentTarget) return false
    const bounds = event.currentTarget.getBoundingClientRect()
    return event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom
  }

  const preview = latest?.text || (loading ? '채팅을 불러오는 중…' : errorText ? '연결 상태를 확인해 주세요' : available ? '트레이너들과 이야기를 나눠 보세요' : '채팅 연결을 기다리는 중…')

  return <>
    <div className="global-chat">
      <button
        ref={triggerRef}
        type="button"
        className={`global-chat-trigger${errorText ? ' has-error' : ''}`}
        aria-label="전체 채팅 열기"
        aria-describedby={`${id}-preview`}
        aria-expanded={expanded}
        aria-haspopup="dialog"
        aria-controls={expanded ? `${id}-dialog` : undefined}
        title={latest ? `${latest.name} · ${messageTime(latest.createdAt).full}\n${latest.text}` : preview}
        onClick={() => setExpanded(true)}
      >
        <span className="global-chat-mark" aria-hidden="true"><MessageCircle size={19} /></span>
        <span className="global-chat-label">전체 채팅</span>
        <span className="global-chat-preview" id={`${id}-preview`}>
          {latest && <span className="global-chat-preview-meta"><strong>{latest.name}</strong><MessageTime value={latest.createdAt} /></span>}
          <span className="global-chat-preview-text">{preview}</span>
        </span>
        <ChevronDown className="global-chat-chevron" size={15} aria-hidden="true" />
      </button>
    </div>

    {expanded && createPortal(
      <dialog
        ref={dialogRef}
        id={`${id}-dialog`}
        className="global-chat-dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-description`}
        onCancel={(event) => { event.preventDefault(); setExpanded(false) }}
        onPointerDown={(event) => { outsidePointerRef.current = isOutsideDialog(event) }}
        onPointerUp={(event) => {
          if (outsidePointerRef.current && isOutsideDialog(event)) setExpanded(false)
          outsidePointerRef.current = false
        }}
      >
        <header className="global-chat-heading">
          <span className="global-chat-heading-icon" aria-hidden="true"><MessageCircle size={23} /></span>
          <div><h2 id={`${id}-title`}>전체 채팅</h2><p id={`${id}-description`}>최근 메시지 30개 · 모든 트레이너와 함께</p></div>
          <button ref={closeRef} type="button" className="global-chat-close" aria-label="전체 채팅 닫기" onClick={() => setExpanded(false)}><X size={22} aria-hidden="true" /></button>
        </header>

        <div className="global-chat-history">
          <ol ref={listRef} className="global-chat-messages" aria-label="최근 전체 채팅" aria-busy={loading} tabIndex={0} onScroll={() => {
            captureScroll()
            if (scrollRef.current.nearBottom) setNewMessageCount(0)
          }}>
            {visibleMessages.map((message) => <li key={message.id} data-message-id={message.id} className={`global-chat-message${message.isOwn ? ' is-own' : ''}`}>
              <div className="global-chat-message-meta"><strong className="global-chat-message-name">{message.name}</strong>{message.isOwn && <span className="global-chat-own-label">나</span>}<MessageTime className="global-chat-message-time" value={message.createdAt} /></div>
              <p className="global-chat-message-text">{message.text}</p>
            </li>)}
            {!visibleMessages.length && <li className="global-chat-empty"><MessageCircle size={30} aria-hidden="true" /><strong>{loading ? '채팅을 불러오는 중입니다' : errorText ? '채팅을 불러오지 못했습니다' : '아직 메시지가 없습니다'}</strong><span>{loading || errorText ? '연결 상태를 확인하고 있습니다.' : '첫 인사를 남겨 보세요.'}</span></li>}
          </ol>
          {newMessageCount > 0 && <button type="button" className="global-chat-jump" onClick={scrollToLatest}><ArrowDown size={16} aria-hidden="true" />새 메시지 {newMessageCount}개 · 최신으로</button>}
        </div>

        <form className="global-chat-composer" onSubmit={handleSubmit}>
          {errorText && <div className="global-chat-error" role="alert"><span>{errorText}</span>{!contentRejected && <button type="button" aria-label="채팅 다시 연결" disabled={loading} onClick={retry}><RefreshCw size={15} aria-hidden="true" />다시 연결</button>}</div>}
          {!available && !errorText && <p className="global-chat-unavailable" role="status">채팅에 연결되면 메시지를 보낼 수 있습니다.</p>}
          <div className="global-chat-input-row">
            <textarea
              aria-label="전체 채팅 메시지"
              aria-describedby={`${id}-counter`}
              placeholder="트레이너들에게 메시지 보내기"
              rows={2}
              value={draft}
              readOnly={pending}
              onChange={(event) => { setDraft(composingRef.current ? event.target.value : trimMessage(event.target.value)); setLocalError(''); clearSendError() }}
              onCompositionStart={() => { composingRef.current = true }}
              onCompositionEnd={(event) => { composingRef.current = false; setDraft(trimMessage(event.currentTarget.value)) }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || event.shiftKey || composingRef.current || event.nativeEvent.isComposing || event.keyCode === 229) return
                handleSubmit(event)
              }}
            />
            <button type="submit" className="global-chat-send" aria-label="메시지 보내기" disabled={pending || !available || !draft.trim() || messageLength > MAX_MESSAGE_LENGTH}><Send size={18} aria-hidden="true" /><span>{pending ? '전송 중' : '보내기'}</span></button>
          </div>
          <div className="global-chat-composer-meta"><span className="global-chat-policy">욕설·비속어 금지</span><span className="global-chat-input-hint">Enter 전송</span><span id={`${id}-counter`} className="global-chat-counter">{messageLength} / {MAX_MESSAGE_LENGTH}</span></div>
        </form>
        <span className="global-chat-sr-only" role="status" aria-live="polite">{newMessageCount ? `새 메시지 ${newMessageCount}개가 있습니다.` : announcement}</span>
      </dialog>, document.body,
    )}
  </>
}
