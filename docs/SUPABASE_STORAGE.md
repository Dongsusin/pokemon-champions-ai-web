# 게임 저장소 이전

Firestore의 일일 쓰기 한도로 로그인 세션 저장이 HTTP 429로 실패하여 게임 저장소를 Supabase PostgreSQL로 이전한다. Google·익명 로그인은 기존 Firebase Auth를 사용하므로 UID와 계정 연결은 유지된다. 기존 Firestore 데이터는 백업을 보관하고, 운영 전환 시 이전 클라이언트와 서버의 쓰기를 차단한다.

## 구성

- Supabase: `Pokemon Champions Arena`, 프로젝트 `wwbcrixyoxeauylavwrf`, 서울 `ap-northeast-2`, `Dongsusin's Org` Free.
- 비공개 `champions.documents` 테이블. `account` namespace에 `profiles`, `gameData`, `sessions`; `ranked` namespace에 레이팅·게스트 이름 예약·사용률·팩토리 TOP 10.
- 브라우저는 Firebase ID 토큰을 `/api/account`, `/api/ranked`로 전달한다. 서버가 토큰과 계정 소유권을 검증한다. Supabase DB 접속 키는 브라우저에 전달하지 않는다.
- DB 전용 `champions_server` 역할만 게임 테이블 CRUD를 허용한다. 일반 `anon`, `authenticated`, PUBLIC에는 접근 권한이 없고 RLS도 강제한다.
- `SERIALIZABLE` 트랜잭션과 제한된 충돌 재시도로 세션·매칭·점수·게스트 번호 예약을 원자적으로 처리한다. 연결 풀 최대 3개, Vercel의 풀 수명 관리, 엄격한 인증서·호스트명 검증을 사용한다.
- 게스트 이름은 검증된 익명 UID에 `guest-000000` 형식으로 배정한다. 숫자 6자리를 트랜잭션으로 예약하며 사용 중인 번호는 중복 배정하지 않는다. 게스트가 명시적으로 로그아웃하면 계정 정보를 삭제하고 번호 예약을 해제한다. Google 사용자의 이름은 첫 글자 뒤를 가린다.
- 로그인 창은 90초 서버 세션과 20초 갱신으로 보호한다. 정상 종료에서는 해당 소유자와 버전의 세션만 해제하며, 비정상 종료는 임대 만료 후 복구된다.
- 완료된 배틀의 큰 연출 데이터는 24시간 후 매시간 정리한다. 점수·VP·사용률·팩토리 기록과 작은 승패 결과는 보존한다. [보관 정책](BATTLE_RETENTION.md)

## 무료 범위

2026-09-13 공식 가격표: 월 $0, API 요청 횟수 무제한, DB 500MB, 월 외부 전송량 5GB. 무료 DB 용량은 Firestore의 1GB보다 작지만 일일 쓰기 횟수 한도가 없다. CPU·연결 수·전송량은 여전히 제한되며 무한 용량을 의미하지 않는다. 무료 프로젝트는 일주일 비활성 시 일시 정지될 수 있고 자동 백업은 포함되지 않는다. 유료 요금제나 추가 기능은 설정하지 않는다.

근거: [Supabase 가격](https://supabase.com/pricing), [연결 풀](https://supabase.com/docs/guides/database/connecting-to-postgres), [SSL 검증](https://supabase.com/docs/guides/platform/ssl-enforcement).

전송량 절감과 게스트 로그아웃 삭제 정책은 [Egress 및 게스트 데이터 관리](EGRESS_AND_GUEST_DATA.md)를 참고한다.

## 환경변수

동일 배포에 `GAME_STORAGE_PROVIDER=supabase`, `VITE_GAME_STORAGE_PROVIDER=supabase`, 서버 비밀 `DATABASE_URL`, `DATABASE_SSL_CA`를 함께 적용한다. `RANKED_FIREBASE_PROJECT_ID`, Firebase Admin 인증, 기존 Vite Firebase Auth 설정은 유지한다. 레이팅·통계 활성화 플래그도 유지한다. `RANKED_FIRESTORE_PREFIX=ranked`는 기존 호환성을 위한 이름이며 Supabase 모드에서는 DB namespace가 된다.

Supabase 모드에서 DB 장애가 발생하면 저장 오류를 표시한다. 빈 계정으로 초기화하거나 Firestore로 자동 전환하지 않는다. 접속 URL에는 인증서 검증을 바꾸는 `sslmode` 등의 매개변수를 넣지 않고 `DATABASE_SSL_CA`에 공식 CA 인증서를 설정한다.

## 이전 절차

1. 서비스 운영 중 원본 백업과 체크섬을 생성하고 별도 `rehearsal_ranked`·`rehearsal_account` namespace에서 이전을 검증한다.
2. 코드·계정 및 대전 통합 검증을 완료하고 운영 환경변수를 준비한다.
3. 짧은 전환 시간 동안 Firestore 클라이언트 쓰기를 읽기 전용 규칙으로 차단하고, 이전 서버 서비스 계정의 `roles/datastore.user` 권한을 회수한다. `roles/firebaseauth.viewer`는 유지한다. 이전 서버가 더 이상 쓸 수 없는지 확인한다.
4. 관리 사용자 권한으로 최종 백업을 생성한다. 포켓몬과 진행 기록의 revision이 다르면 중단한다. 기존 세션 임대는 이전하지 않아 새 창에서 다시 획득하도록 한다.
5. 비어 있는 `ranked`·`account` namespace로 원자적으로 가져온 뒤 모든 레코드 값과 개수를 원본과 비교한다. 이미 데이터가 있으면 가져오기를 거부한다.
6. 검증한 커밋을 Production으로 배포하고 실제 도메인에서 계정 저장·게스트·레이팅·사용률·팩토리를 확인한다. 백업은 Git에 포함하지 않는다.

백업 도구는 명시한 `players`, `accountSessions`, 레이팅 접두사 문서만 읽고 원본을 수정하지 않는다. 부모 문서가 없는 하위 저장 문서도 탐색한다. 같은 문서 경로의 중복, 부분 저장, 잘못된 revision 및 충돌 payload는 가져오기를 중단시킨다.

```powershell
node scripts/migrateFirestoreToPostgres.mjs export --backup scripts/.cache/storage-migration/firestore-backup.json --project YOUR_PROJECT_ID --credentials PRIVATE_SERVICE_ACCOUNT_FILE
node scripts/migrateFirestoreToPostgres.mjs inspect --backup scripts/.cache/storage-migration/firestore-backup.json
node --env-file=.env.storage.local scripts/migrateFirestoreToPostgres.mjs import --backup scripts/.cache/storage-migration/firestore-backup.json
node --env-file=.env.storage.local scripts/migrateFirestoreToPostgres.mjs verify --backup scripts/.cache/storage-migration/firestore-backup.json
```

되돌리기는 자동으로 수행하지 않는다. 새 DB에 실제 진행 기록이 생긴 뒤에는 오래된 Firestore 백업을 그대로 활성화하면 데이터가 되돌아갈 수 있다. 두 저장소의 최신 기록을 비교하고 역이전한 다음 코드·환경변수·권한을 함께 전환해야 한다.

## 검증

- `node scripts/validateAccountSession.mjs --supabase`: 세션 획득 경쟁, 만료, 지연 응답, 창 종료, 연결 실패.
- `node scripts/validateAccountApiClient.mjs`, `node scripts/validateAccountServer.mjs`: UID·소유자 보호, 저장 형식, API 인증, DB 키 순서와 관계없는 동일 요청 재시도.
- `node scripts/validatePostgresStore.mjs`: DB 어댑터. `POSTGRES_STORE_INTEGRATION=true`와 비밀 환경변수가 있으면 실제 DB의 독립 검증 namespace를 사용하고 정리한다.
- `node scripts/validateStorageMigration.mjs`: 백업 변환과 계정·VP·팀·아이템·업적·레이팅·통계·팩토리 값 보존.
- 게스트 이름·실제 API·레이팅·팩토리 관련 검증은 package.json의 `validate:guest-*`, `validate:ranked`, `validate:battle-factory-*` 명령을 사용한다.
- 배포 후 `node scripts/validateDeployedStorage.mjs --url https://pokemon-champions-area-web.co.kr`로 새 익명 계정 하나의 실제 API·SQL 저장·재접속·통계/팩토리 조회를 확인한다. 매칭 참가나 통계·랭킹 보고는 하지 않으며 테스트 계정의 행만 정리한다.

로컬 `.env.storage.local`, 서비스 계정 파일, 백업과 실행 결과는 모두 무시된 경로에 보관한다. 테스트는 별도 namespace와 새로 만든 테스트 UID만 변경하고 실제 계정 기록을 수정하지 않는다.
