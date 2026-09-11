import { useEffect, useRef, useState } from 'react'
import { Bug, CheckCircle2, LoaderCircle, RotateCw, Send } from 'lucide-react'
import {
  BUG_REPORT_CATEGORIES,
  createBugReportDraft,
  getBugReportAvailability,
  makeBugReportPayload,
  sendBugReport,
  validateBugReportDraft,
} from './bugReportClient'

export default function BugReportPanel({ user, reportContext, active }) {
  const [draft, setDraft] = useState(() => createBugReportDraft(user?.email || ''))
  const [availability, setAvailability] = useState('unchecked')
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState(null)
  const [reportId, setReportId] = useState('')
  const mounted = useRef(false)
  const submitting = useRef(false)
  const availabilityRequest = useRef(null)
  const submitRequest = useRef(null)
  const retryPayload = useRef(null)
  const formRef = useRef(null)
  const successRef = useRef(null)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      availabilityRequest.current?.abort()
      submitRequest.current?.abort()
    }
  }, [])

  const checkAvailability = async () => {
    availabilityRequest.current?.abort()
    const controller = new AbortController()
    availabilityRequest.current = controller
    setAvailability('checking')
    const timeout = window.setTimeout(() => controller.abort(), 8000)
    try {
      const enabled = await getBugReportAvailability(controller.signal)
      if (mounted.current && availabilityRequest.current === controller) setAvailability(enabled ? 'enabled' : 'disabled')
    } catch {
      if (mounted.current && availabilityRequest.current === controller) setAvailability('unknown')
    } finally {
      window.clearTimeout(timeout)
    }
  }

  useEffect(() => {
    if (active && availability === 'unchecked') checkAvailability()
  }, [active, availability])

  useEffect(() => {
    if (status === 'success' && active) successRef.current?.focus()
  }, [status, active])

  const changeField = (field, value) => {
    setDraft((current) => ({ ...current, [field]: value }))
    retryPayload.current = null
    if (error) setError(null)
  }

  const submit = async (event) => {
    event.preventDefault()
    if (submitting.current || availability === 'disabled' || availability === 'checking') return
    const validation = validateBugReportDraft(draft)
    if (validation) {
      setError(validation)
      formRef.current?.elements.namedItem(validation.field)?.focus()
      return
    }
    submitting.current = true
    setStatus('sending')
    setError(null)
    const controller = new AbortController()
    submitRequest.current = controller
    const timeout = window.setTimeout(() => controller.abort(), 20000)
    try {
      retryPayload.current ??= makeBugReportPayload(draft, reportContext)
      const result = await sendBugReport(retryPayload.current, controller.signal)
      if (!mounted.current || submitRequest.current !== controller) return
      setReportId(result.reportId)
      setStatus('success')
      setAvailability('enabled')
    } catch (failure) {
      if (!mounted.current || submitRequest.current !== controller) return
      setStatus('idle')
      setError({ message: failure.name === 'AbortError'
        ? '전송 결과를 확인하지 못했습니다. 작성 내용은 유지되며 같은 신고로 다시 시도할 수 있습니다.'
        : failure.message })
      if (['DISABLED', 'NOT_CONFIGURED', 'ACTIVATION_REQUIRED'].includes(failure.code)) setAvailability('disabled')
    } finally {
      window.clearTimeout(timeout)
      if (submitRequest.current === controller) submitting.current = false
    }
  }

  const fieldAccessibility = (field) => ({
    'aria-invalid': error?.field === field || undefined,
    'aria-describedby': error?.field === field ? 'bug-report-error' : undefined,
  })
  const sending = status === 'sending'

  return (
    <div
      className="settings-panel settings-bug-report-panel"
      id="settings-bug-report-panel"
      role="tabpanel"
      aria-labelledby="settings-bug-report-tab"
      hidden={!active}
    >
      {status === 'success' ? (
        <div className="bug-report-success" ref={successRef} tabIndex={-1} role="status">
          <CheckCircle2 size={42} aria-hidden="true" />
          <h3>버그 신고를 보냈습니다</h3>
          <p>제보해 주셔서 감사합니다. 작성하신 내용이 운영자에게 전달되었습니다.</p>
          <span className="bug-report-reference">접수 번호 <code>{reportId}</code></span>
          <button type="button" className="bug-report-submit" onClick={() => {
            setDraft(createBugReportDraft(draft.replyTo))
            retryPayload.current = null
            setReportId('')
            setStatus('idle')
            setError(null)
            window.requestAnimationFrame(() => {
              if (mounted.current) formRef.current?.elements.namedItem('title')?.focus()
            })
          }}><Bug size={17} /> 새 신고 작성</button>
        </div>
      ) : (
        <form className="bug-report-form" ref={formRef} onSubmit={submit} noValidate aria-busy={sending}>
          <div className="bug-report-intro">
            <span><Bug size={22} aria-hidden="true" /></span>
            <div><h3>어떤 문제가 있었나요?</h3><p>상황을 자세히 알려 주시면 문제를 확인하는 데 도움이 됩니다.</p></div>
          </div>

          {(availability === 'disabled' || availability === 'unknown') && (
            <div className="bug-report-notice" role="status">
              <span>{availability === 'disabled'
                ? '버그 신고 메일 서비스를 준비 중입니다. 내용을 작성할 수 있으며 연결 후 전송할 수 있습니다.'
                : '서버 연결 상태를 확인하지 못했습니다. 연결을 다시 확인하거나 신고 전송을 시도해 주세요.'}</span>
              <button type="button" onClick={checkAvailability} disabled={sending}><RotateCw size={15} /> 연결 재확인</button>
            </div>
          )}

          <fieldset disabled={sending}>
            <div className="bug-report-heading-fields">
              <label className="bug-report-field">
                <span>제목 <b>필수</b></span>
                <input name="title" value={draft.title} onChange={(event) => changeField('title', event.target.value)} maxLength={100} required placeholder="예: 더블배틀에서 기술을 선택할 수 없어요" {...fieldAccessibility('title')} />
              </label>
              <label className="bug-report-field">
                <span>분류</span>
                <select name="category" value={draft.category} onChange={(event) => changeField('category', event.target.value)} {...fieldAccessibility('category')}>
                  {BUG_REPORT_CATEGORIES.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
            </div>

            <label className="bug-report-field">
              <span>상세 내용 <b>필수</b><small>{draft.description.length.toLocaleString()} / 4,000</small></span>
              <textarea name="description" value={draft.description} onChange={(event) => changeField('description', event.target.value)} minLength={10} maxLength={4000} required rows={4} placeholder="언제, 어떤 화면에서, 어떤 문제가 발생했나요? 포켓몬·기술·아이템 이름을 함께 적어 주세요. (10자 이상)" {...fieldAccessibility('description')} />
            </label>

            <div className="bug-report-detail-fields">
              <label className="bug-report-field">
                <span>재현 방법 <em>선택</em></span>
                <textarea name="steps" value={draft.steps} onChange={(event) => changeField('steps', event.target.value)} maxLength={2000} rows={3} placeholder={'예: 1. AI 대전 시작\n2. 포켓몬 교대\n3. 기술 선택'} {...fieldAccessibility('steps')} />
              </label>
              <label className="bug-report-field">
                <span>기대한 동작 <em>선택</em></span>
                <textarea name="expected" value={draft.expected} onChange={(event) => changeField('expected', event.target.value)} maxLength={1000} rows={3} placeholder="원래는 어떻게 작동해야 하나요?" {...fieldAccessibility('expected')} />
              </label>
            </div>

            <label className="bug-report-field">
              <span>답장받을 이메일 <em>선택</em></span>
              <input name="replyTo" type="email" autoComplete="email" inputMode="email" value={draft.replyTo} onChange={(event) => changeField('replyTo', event.target.value)} maxLength={254} placeholder="답장을 원하시면 이메일 주소를 입력해 주세요" {...fieldAccessibility('replyTo')} />
              <small>비워 두어도 신고할 수 있습니다. 입력한 주소는 신고 확인을 위한 연락에 사용됩니다.</small>
            </label>

            <label className="bug-report-diagnostics">
              <input type="checkbox" checked={draft.includeDiagnostics} onChange={(event) => changeField('includeDiagnostics', event.target.checked)} />
              <span><strong>브라우저·현재 화면 정보 함께 보내기</strong><small>브라우저 종류, 언어, 화면 크기와 현재 게임 화면을 함께 전달합니다.</small></span>
            </label>

            <label className="bug-report-honeypot" aria-hidden="true">
              웹사이트
              <input name="website" tabIndex={-1} autoComplete="off" value={draft.website} onChange={(event) => changeField('website', event.target.value)} />
            </label>
          </fieldset>

          <p className="bug-report-privacy">작성한 내용은 이메일 발송 서비스를 통해 운영자에게 전달됩니다. 비밀번호 등 민감한 정보는 적지 마세요. 게임 저장 데이터와 인증 정보는 첨부하지 않습니다.</p>
          {error && <p className="bug-report-error" id="bug-report-error" role="alert">{error.message}</p>}
          <div className="bug-report-actions">
            <small>작성 중인 내용은 다른 설정 탭으로 이동해도 유지됩니다.<br />설정 창을 닫으면 초안이 사라집니다.</small>
            <button className="bug-report-submit" type="submit" disabled={sending || availability === 'disabled' || availability === 'checking'}>
              {sending || availability === 'checking' ? <LoaderCircle size={18} className="bug-report-spinner" /> : <Send size={18} />}
              {sending ? '신고 전송 중' : availability === 'checking' ? '연결 확인 중' : '버그 신고 보내기'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
