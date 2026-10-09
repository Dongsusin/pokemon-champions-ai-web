import { useCallback, useEffect, useRef, useState } from 'react'
import { CHAT_MAX_CHARACTERS, createGlobalChatClient } from './globalChatClient'
import { chatPollDelay } from './requestCadence.js'

const fresh = () => ({ latest: null, messages: [], loading: true, error: '', sendError: '', sendErrorCode: '', sending: false })

export default function useGlobalChat(user, expanded) {
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
    const session = { uid: user.uid, active: true, timer: null, read: null, send: null,
      revision: -1, messagesRevision: -1, pendingSend: null, failureCount: 0 }
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
    const schedule = () => {
      clearTimeout(session.timer)
      if (!current() || document.visibilityState === 'hidden') return
      session.timer = setTimeout(() => session.refresh(), chatPollDelay(expandedRef.current, session.failureCount))
    }
    session.refresh = async () => {
      clearTimeout(session.timer)
      if (!current() || session.read || document.visibilityState === 'hidden') return
      const controller = new AbortController()
      session.read = controller
      const includeMessages = expandedRef.current
      const revision = includeMessages ? session.messagesRevision : session.revision
      try {
        const snapshot = await client.request('read', { expanded: includeMessages,
          ...(revision >= 0 ? { revision } : {}) }, { signal: controller.signal })
        if (!current()) return
        session.apply(snapshot)
        session.failureCount = 0
        setState(previous => ({ ...previous, error: '' }))
      } catch (error) {
        if (!current() || error.name === 'AbortError') return
        session.failureCount += 1
        setState(previous => ({ ...previous, loading: false, error: error.message }))
      } finally {
        if (session.read === controller) session.read = null
        if (current()) {
          // Opening while the compact request was in flight still fetches the list.
          if (!controller.signal.aborted && !includeMessages && expandedRef.current) void session.refresh()
          else schedule()
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
        session.failureCount = 0
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
    const visibility = () => {
      clearTimeout(session.timer)
      if (document.visibilityState === 'hidden') session.read?.abort()
      else void session.refresh()
    }
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('online', visibility)
    void session.refresh()
    return () => {
      session.active = false
      clearTimeout(session.timer)
      session.read?.abort()
      session.send?.abort()
      if (sessionRef.current === session) sessionRef.current = null
      document.removeEventListener('visibilitychange', visibility)
      window.removeEventListener('online', visibility)
    }
  }, [user?.uid, available])

  useEffect(() => { void sessionRef.current?.refresh() }, [expanded])
  const refresh = useCallback(() => { void sessionRef.current?.refresh() }, [])
  const sendMessage = useCallback(text => sessionRef.current?.sendMessage(text) ?? Promise.resolve(false), [])
  const clearSendError = useCallback(() => setState(previous => ({ ...previous, sendError: '', sendErrorCode: '' })), [])
  // Do not show one account's private isOwn flags while another signs in.
  const view = sessionRef.current?.uid === user?.uid && available ? state : { ...fresh(), loading: false }
  // Background polling can recover a connection, but must not erase a rejected
  // send's explanation before the player has a chance to edit the message.
  return { ...view, error: view.sendError || view.error, available, refresh, sendMessage, clearSendError }
}
