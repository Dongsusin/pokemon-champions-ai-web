export const BUG_REPORT_CATEGORIES = [
  { value: 'battle', label: '배틀·기술·특성' },
  { value: 'account', label: '로그인·저장' },
  { value: 'collection', label: '포켓몬·아이템·뽑기' },
  { value: 'display', label: '화면·표시' },
  { value: 'sound', label: '사운드' },
  { value: 'other', label: '기타' },
]

export function createBugReportDraft(email = '') {
  return {
    title: '', category: 'battle', description: '', steps: '', expected: '',
    replyTo: email.slice(0, 254), includeDiagnostics: true, website: '',
  }
}

export function validateBugReportDraft(draft) {
  if (!draft.title.trim()) return { field: 'title', message: '제목을 입력해 주세요.' }
  if (draft.title.trim().length > 100) return { field: 'title', message: '제목은 100자 이내로 입력해 주세요.' }
  if (!BUG_REPORT_CATEGORIES.some(({ value }) => value === draft.category)) {
    return { field: 'category', message: '오류 분류를 선택해 주세요.' }
  }
  const descriptionLength = draft.description.trim().length
  if (descriptionLength < 10 || descriptionLength > 4000) {
    return { field: 'description', message: '상세 내용은 10자 이상, 4,000자 이내로 입력해 주세요.' }
  }
  if (draft.steps.trim().length > 2000) return { field: 'steps', message: '재현 방법은 2,000자 이내로 입력해 주세요.' }
  if (draft.expected.trim().length > 1000) return { field: 'expected', message: '기대 동작은 1,000자 이내로 입력해 주세요.' }
  const replyTo = draft.replyTo.trim()
  if (replyTo && (replyTo.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyTo))) {
    return { field: 'replyTo', message: '답장받을 이메일 주소를 확인해 주세요.' }
  }
  return null
}

export function collectBugReportDiagnostics(reportContext = {}) {
  return {
    page: window.location.pathname.slice(0, 300),
    viewport: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio },
    userAgent: navigator.userAgent.slice(0, 400),
    language: navigator.language.slice(0, 35),
    screen: String(reportContext?.screen || 'unknown').slice(0, 80),
  }
}

export function makeBugReportPayload(draft, reportContext) {
  return {
    requestId: crypto.randomUUID(),
    title: draft.title.trim(),
    category: draft.category,
    description: draft.description.trim(),
    steps: draft.steps.trim(),
    expected: draft.expected.trim(),
    replyTo: draft.replyTo.trim(),
    diagnostics: draft.includeDiagnostics ? collectBugReportDiagnostics(reportContext) : null,
    website: draft.website,
  }
}

export async function getBugReportAvailability(signal) {
  const response = await fetch('/api/bug-report', {
    method: 'GET', cache: 'no-store', credentials: 'omit', signal,
  })
  const result = await response.json()
  if (!response.ok || typeof result.enabled !== 'boolean') throw new Error('신고 기능의 연결 상태를 확인하지 못했습니다.')
  return result.enabled
}

export async function sendBugReport(payload, signal) {
  let response
  try {
    response = await fetch('/api/bug-report', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      credentials: 'omit', referrerPolicy: 'no-referrer',
      body: JSON.stringify(payload), signal,
    })
  } catch (error) {
    if (error.name === 'AbortError') throw error
    throw new Error('서버에 연결하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 보내 주세요. 작성 내용은 유지됩니다.')
  }
  const result = await response.json().catch(() => null)
  if (!response.ok || result?.ok !== true || typeof result.reportId !== 'string' || !result.reportId) {
    const error = new Error(typeof result?.error === 'string'
      ? result.error.slice(0, 500)
      : '신고를 보내지 못했습니다. 잠시 후 다시 시도해 주세요. 작성 내용은 유지됩니다.')
    error.code = result?.code
    error.retryAfter = result?.retryAfter
    throw error
  }
  return result
}
