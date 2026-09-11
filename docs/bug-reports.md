# 버그 신고 운영

게임의 **설정 → 버그 신고**에서 제목, 분류, 상세 내용과 선택 항목(재현 방법, 기대 동작, 답장받을 이메일)을 작성한다. 브라우저·화면 정보 첨부는 사용자가 해제할 수 있다. 게임 저장 데이터, 인증 토큰, URL 쿼리·해시는 첨부하지 않는다.

폼은 같은 출처의 `/api/bug-report`를 호출한다. 수신자와 발송 자격 증명은 서버에만 존재한다. 작성 중인 내용은 설정 탭 이동 시 유지되며 설정 창을 닫으면 사라진다. 전송 실패 시 같은 내용을 재시도할 수 있다. 배틀 컴포넌트를 교체하지 않아 설정을 열거나 신고해도 대전 상태는 유지된다.

## 운영 환경변수

Vercel 프로젝트의 Production 환경에 아래 값을 설정한 후 배포한다. `.env.local`은 로컬 개발용이며 Git에 포함하지 않는다. 어떤 메일 설정에도 `VITE_` 접두사를 붙이지 않는다.

2026-09-11 운영 검증에서 FormSubmit은 Vercel의 발송 요청에 HTTP 403/HTML로 응답했다. 수신함 활성화 성공과 별개인 공급자 접근 실패이므로, 운영에서는 Resend 연결을 사용한다. Resend 키와 검증된 발신 주소가 준비되기 전에는 상태 API가 `enabled: false`를 반환하며 폼에 준비 중 안내를 표시한다. 연결 완료는 운영 폼 전송과 받은편지함의 접수 번호 일치로 확인한다.

| 변수 | 용도 |
| --- | --- |
| `BUG_REPORT_TO` | 신고를 받을 단일 이메일 주소. 서버에서 고정하며 요청으로 변경할 수 없다. |
| `BUG_REPORT_ENABLED` | 수신함 활성화를 확인한 뒤 `true`. 기본은 비활성이다. |
| `BUG_REPORT_PROVIDER` | 기본 `formsubmit`. 선택적으로 `resend`. |
| `BUG_REPORT_ALLOWED_ORIGINS` | 필요한 추가 출처를 쉼표로 구분. 현재 요청의 서버 출처는 자동 허용한다. |
| `RESEND_API_KEY` | Resend를 선택했을 때 필요한 서버용 키. |
| `BUG_REPORT_FROM` | Resend의 검증된 발신 이메일 또는 `표시 이름 <이메일>`. |

### FormSubmit 연결

1. 수신 주소를 서버에 설정한다.
2. 실제 서비스 출처로 연결 테스트를 한 번 전송한다. 첫 전송에서는 `ACTIVATION_REQUIRED` 응답과 함께 수신함에 활성화 메일이 도착할 수 있다.
3. 메일의 `Activate Form` 링크로 해당 사이트의 폼을 활성화한다.
4. 운영 환경에 `BUG_REPORT_ENABLED=true`를 설정하고 배포한다.
5. 실제 사이트에서 테스트 신고를 한 번 보내고 수신함에서 제목·본문·접수 번호를 확인한다. API 성공만으로 최종 받은편지함 도착을 단정하지 않는다.

다른 도메인이나 로컬호스트로 보내면 별도 활성화가 필요할 수 있다. 로컬은 `.env.example`처럼 기본 비활성으로 유지한다. FormSubmit은 JSON 본문을 `text/html` Content-Type으로 응답하기도 하므로 응답 본문과 성공 스키마까지 검사한다. 실제 HTML 오류 페이지는 전송 성공으로 처리하지 않는다.

서버 전송에서도 폼 출처를 식별하도록 검증된 요청 출처를 `_url`로 함께 전달한다. [FormSubmit 출처 확인 안내](https://formsubmit.co/help). 발송 실패는 Vercel 로그의 `[bug-report]`에서 실패 단계, HTTP 상태, 제한된 MIME·통신 오류 코드로 확인한다. 이 로그에는 신고 내용, 메일 주소, 요청 번호, 발송 키, 공급자의 응답 원문이 포함되지 않는다.

공식 자료: [FormSubmit AJAX](https://formsubmit.co/ajax-documentation), [FormSubmit 설정](https://formsubmit.co/documentation), [개인정보 처리](https://formsubmit.co/privacy.pdf). 신고 내용은 발송 서비스를 거쳐 이메일로 전달된다.

### Resend로 변경

검증된 발신 도메인을 준비하고 `BUG_REPORT_PROVIDER=resend`, `RESEND_API_KEY`, `BUG_REPORT_FROM`을 설정한 뒤 다시 배포한다. 수신 주소와 UI는 그대로 사용한다. 요청 UUID를 Resend의 `Idempotency-Key`로 전달한다.

공식 자료: [Resend 이메일 전송](https://resend.com/docs/api-reference/emails/send-email), [중복 요청 처리](https://resend.com/docs/dashboard/emails/idempotency-keys).

## API 및 제한

- `GET /api/bug-report`: `{ "enabled": true | false }`. 수신 주소나 키를 반환하지 않는다.
- `POST /api/bug-report`: UUID, 허용된 분류, 제목(1–100자), 상세 내용(10–4,000자)을 검증한다. 요청 크기는 최대 32 KiB다. 재현 방법은 2,000자, 기대 동작은 1,000자까지 허용한다.
- 성공: `{ "ok": true, "reportId": "BR-..." }`. 오류: `{ "ok": false, "error": "안내 문구", "code": "..." }`.
- 웹 요청의 출처, JSON 형식, 허용된 진단 정보, 이메일 형식, 숨겨진 스팸 필드를 검사한다. 외부 서비스 오류·비밀 값은 클라이언트에 노출하지 않는다.
- 동일한 UUID·내용의 진행 중 또는 성공한 요청은 **같은 서버 인스턴스 안에서** 합친다. 실패한 요청은 같은 UUID로 재시도할 수 있고, 다른 내용에 UUID를 재사용하면 409를 반환한다.
- **인스턴스별** IP 기준 30초 간격·10분에 5회 제한이다. UUID 캐시는 30분/최대 1,000건이며 IP 캐시는 최대 2,000개다. 서버리스 확장·재시작을 가로지르는 전역 제한/중복 방지는 아니다. 대규모 공개 트래픽에는 공유 저장소 기반 제한 또는 CAPTCHA를 추가해야 한다.
- 폼의 요청 취소가 이미 접수된 이메일을 회수하지는 않는다. 결과가 불확실하면 같은 초안을 재시도한다. 발송 서비스 장애 시 별도 영구 대기열은 없으며 작성 내용을 유지하고 오류를 표시한다.

## 검증

```powershell
npm run validate:bug-reports
npm run validate:bug-reports-ui
npm run build
```

서버 검증은 외부 요청을 주입한 응답으로 대체한다. UI 검증은 `promo/node_modules`의 Playwright와 설치된 Chromium을 사용하며, 서버 메일 전송을 모킹하므로 실제 이메일을 보내지 않는다. PC·모바일, 필수 항목, 중복 클릭, 실패 후 재시도, 설정 닫기 후 지연 응답, 초안 보존, 진단 정보, 실제 배틀 상태 유지 및 브라우저→Vite→실제 핸들러 연결을 확인한다. UI 결과와 스크린샷은 `scripts/.cache/bug-report-ui/`에 저장된다.

Vercel에서는 루트 `api/bug-report.js`가 Node 함수이며, Vite 개발/미리보기 서버는 같은 핸들러를 미들웨어로 연결한다. 배포 후 함수 응답을 직접 확인한다. [Vercel의 Vite 지원](https://vercel.com/docs/frameworks/frontend/vite)
