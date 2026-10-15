import { useCallback, useEffect, useRef, useState } from 'react'
import { CHAT_MAX_CHARACTERS, createGlobalChatClient } from './globalChatClient'

const fresh = () => ({ latest: null, messages: [], loading: true, error: '', sendError: '', sendErrorCode: '', sending: false })

export default function useGlobalChat(user, expanded, pageKey) {
  const available = Boolean(user?.uid && !user.isLocalGuest && typeof user.getIdToken === 'function')
  const [state, setState] = useState(fresh)
  const sessionRef = useRef(null)
  const userRef = useRef(user)
  userRef.current = user
  const expandedRef = useRef(expanded)
  expandedRef.current = expanded

  useEffect(() => {
    setState(fresh())
    if (!available) {
      setState({ ...fresh(), loading: false })
      return undefined
    }
    const session = { uid: user.uid, active: true, read: null, send: null,
      revision: -1, messagesRevision: -1, pendingSend: null, refreshPending: false }
    sessionRef.current = session
    const current = () => session.active && userRef.current?.uid === session.uid
    const client = createGlobalChatClient({
      getIdToken: () => userRef.current?.getIdToken(), isCurrent: current,
    })
    session.apply = (snapshot) => {
      if (!current() || snapshot.revision < session.revision) return
      session.revision = snapshot.revision
      if (snapshot.messages) session.messagesRevision = snapshot.revision
      setState(previous => ({ ...previous, latest: snapshot.latest,
        ...(snapshot.messages ? { messages: snapshot.messages } : {}), loading: false }))
    }
    session.refresh = async ({ queue = false } = {}) => {
      if (!current()) return
      if (session.read) { if (queue) session.refreshPending = true; return }
      if (navigator.onLine === false) {
        setState(previous => ({ ...previous, loading: false, error: '인터넷 연결 후 새로고침해 주세요.' }))
        return
      }
      session.refreshPending = false
      const controller = new AbortController()
      session.read = controller
      const includeMessages = expandedRef.current
      const revision = includeMessages ? session.messagesRevision : session.revision
      try {
        const snapshot = await client.request('read', { expanded: includeMessages,
          ...(revision >= 0 ? { revision } : {}) }, { signal: controller.signal })
        if (!current()) return
        session.apply(snapshot)
        setState(previous => ({ ...previous, error: '' }))
      } catch (error) {
        if (!current() || error.name === 'AbortError') return
        setState(previous => ({ ...previous, loading: false, error: error.message }))
      } finally {
        if (session.read === controller) session.read = null
        if (current()) {
          // Opening while the compact request was in flight still fetches the list.
          if (!controller.signal.aborted && (session.refreshPending || (!includeMessages && expandedRef.current))) void session.refresh()
        }
      }
    }
    session.sendMessage = async text => {
      if (!current() || session.send) return false
      const content = text.trim()
      if (!content || [...content].length > CHAT_MAX_CHARACTERS) {
        setState(previous => ({ ...previous, sendError: `채팅은 1~${CHAT_MAX_CHARACTERS}자까지 입력해주세요.`, sendErrorCode: 'INVALID_TEXT' }))
        return false
      }
      const controller = new AbortController()
      session.send = controller
      // Reuse the receipt after an uncertain network result, preventing duplicates.
      if (session.pendingSend?.text !== content) session.pendingSend = { text: content, requestId: crypto.randomUUID() }
      setState(previous => ({ ...previous, sending: true, error: '', sendError: '', sendErrorCode: '' }))
      try {
        const snapshot = await client.request('send', session.pendingSend, { signal: controller.signal })
        if (!current()) return false
        session.apply(snapshot)
        session.pendingSend = null
        setState(previous => ({ ...previous, error: '', sendError: '', sendErrorCode: '' }))
        return true
      } catch (error) {
        if (current() && error.name !== 'AbortError') setState(previous => ({ ...previous, sendError: error.message, sendErrorCode: error.code ?? '' }))
        return false
      } finally {
        session.send = null
        if (current()) setState(previous => ({ ...previous, sending: false }))
      }
    }
    void session.refresh()
    return () => {
      session.active = false
      session.read?.abort()
      session.send?.abort()
      if (sessionRef.current === session) sessionRef.current = null
    }
  }, [user?.uid, available])

  useEffect(() => { if (expanded) void sessionRef.current?.refresh() }, [expanded])
  const pageRef = useRef(pageKey)
  useEffect(() => {
    if (pageRef.current !== pageKey) {
      pageRef.current = pageKey
      void sessionRef.current?.refresh({ queue: true })
    }
  }, [pageKey])
  const refresh = useCallback(() => sessionRef.current?.refresh({ queue: true }), [])
  const sendMessage = useCallback(text => sessionRef.current?.sendMessage(text) ?? Promise.resolve(false), [])
  const clearSendError = useCallback(() => setState(previous => ({ ...previous, sendError: '', sendErrorCode: '' })), [])
  // Do not show one account's private isOwn flags while another signs in.
  const view = sessionRef.current?.uid === user?.uid && available ? state : { ...fresh(), loading: false }
  // A manual read must not erase a rejected
  // send's explanation before the player has a chance to edit the message.
  return { ...view, error: view.sendError || view.error, available, refresh, sendMessage, clearSendError }
}
