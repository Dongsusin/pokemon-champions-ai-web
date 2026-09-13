# 운영 저장소 안내

게임 저장·세션·대전·통계는 Supabase로 이전하며 Firebase는 Google/익명 Auth와 기존 UID 유지에 사용합니다. 현재 구성과 이전·검증 절차는 [SUPABASE_STORAGE.md](SUPABASE_STORAGE.md)를 먼저 확인하세요. 아래 Firestore 설정은 이전 구성 및 명시적인 복구 작업의 참고입니다.

# Firebase Google 로그인 설정

## 1. Firebase 프로젝트 연결

현재 기본 프로젝트는 `Pokemon Champions Arena` (`pokemon-champions-arena-2026`)입니다.

1. Firebase Console에서 프로젝트와 Web App을 생성합니다.
2. Authentication > Sign-in method에서 Google 공급자를 활성화합니다.
3. Authentication > Settings > Authorized domains에 개발 및 배포 도메인을 등록합니다.
4. Cloud Firestore 데이터베이스를 생성합니다.

현재 승인 도메인은 다음과 같습니다.

- `localhost`
- `pokemon-champions-arena-2026.firebaseapp.com`
- `pokemon-champions-arena-2026.web.app`
- `pokemon-champions-ai-web.vercel.app`
- `pokemon-champions-area-web.co.kr`
- `www.pokemon-champions-area-web.co.kr`

Vercel 미리보기 주소에서 Google 로그인을 테스트하려면 해당 미리보기 도메인도 별도로 승인해야 합니다.

대표 게임 주소는 `https://pokemon-champions-area-web.co.kr`입니다. Firebase의 `authDomain`은 `pokemon-champions-arena-2026.firebaseapp.com`을 유지하며 Google 팝업 로그인을 사용합니다. 게임 접속 주소만 바꿀 때에는 승인 도메인에 새 주소를 추가하면 되고, 기존 Google OAuth 콜백 주소는 그대로 사용합니다.

도메인이 바뀌면 브라우저의 게스트 저장소와 로그인 상태는 공유되지 않습니다. 기존 주소의 게스트 기록을 옮길 때에는 먼저 기존 주소에서 Google 계정에 연결해 동기화한 뒤, 기존 게임 창을 닫고 새 주소에서 같은 계정으로 로그인합니다.

## 2. 로컬 환경 변수

`.env.example`을 `.env.local`로 복사하고 Firebase Web App 설정값을 입력합니다.

```powershell
Copy-Item .env.example .env.local
```

Vite 환경 변수는 브라우저 번들에 포함되므로 Firebase Web App 설정값만 사용하고 서비스 계정 비밀 키는 넣지 않습니다.

## 3. Firestore 규칙 배포

저장소의 `firestore.rules`는 로그인한 사용자가 자신의 `players/{uid}` 문서와 하위 게임 데이터만 읽고 쓸 수 있도록 제한합니다.

```powershell
npx firebase-tools login
npx firebase-tools deploy --only firestore:rules
```

로그인에 성공하면 `players/{uid}` 프로필 문서가 자동으로 생성되거나 갱신됩니다. 포켓몬 도감·트레이닝 설정은 `players/{uid}/gameData/collection`, VP·팀·아이템·게임 설정은 `players/{uid}/gameData/progress` 문서에 자동 저장됩니다.

기존 버전에서 브라우저에만 저장했던 데이터는 해당 기기에서 Google 계정으로 처음 접속할 때 자동으로 Firestore에 이전됩니다. 게스트 설정 화면에서 Google 계정 연결을 선택한 경우에도 현재 게스트 진행 상황을 연결된 계정으로 이전합니다. 이후 다른 PC나 모바일에서 같은 Google 계정으로 로그인하면 서버 데이터를 먼저 불러온 뒤 게임을 시작합니다.

서버 데이터를 처음 불러오지 못하면 게임 시작과 업로드를 중단하고 재시도 화면을 표시합니다. 이 상태에서는 기존 로컬 기록을 유지하며, `다시 불러오기` 또는 네트워크 복구 후 재시도로 서버 기록을 확인합니다. 로그인 화면으로 돌아갈 때에는 아직 확인하지 않은 로컬 데이터를 업로드하지 않습니다. 새 브라우저에 이전 설정이 없으면 이를 게스트 이전으로 취급하지 않습니다.

게임 중 로그아웃은 진행 중인 저장과 그동안 추가된 변경의 업로드가 모두 성공한 뒤 실행합니다. 저장에 실패하면 현재 게임을 유지하고 계정 탭에 오류를 표시하므로 연결을 복구한 뒤 다시 로그아웃할 수 있습니다. 저장 충돌 판단에는 마지막으로 동기화한 서버 revision을 우선 사용합니다. 로컬 저장소 읽기 실패는 부분 업로드를 중단하며, 데이터 교체 중 저장 공간 오류가 발생하면 교체 전 기록의 복원을 시도하고 게임 진입을 차단합니다.

## 4. 동시 로그인 방지

Google 로그인 인증과 게임 접속 권한을 분리합니다. 게임 화면이나 계정 데이터 동기화를 시작하기 전에 `accountSessions/{uid}`의 접속 권한을 확보합니다. 다른 창이나 기기에서 같은 계정으로 접속 중이면 기존 접속을 유지하고 새 창에 안내를 표시합니다. 안내를 받은 창에서는 사용 중인 창을 닫은 뒤 Google 로그인 버튼을 다시 누르면 됩니다. 자동 로그인에도 같은 검사가 적용됩니다.

- 접속 권한은 Firestore REST의 `currentDocument.updateTime` 조건으로 원자적으로 갱신합니다. 창마다 새 소유자 ID를 만들며, 복제된 탭의 `sessionStorage`를 접속 권한으로 사용하지 않습니다.
- 접속 중에는 20초마다 서버 시간으로 갱신하고, 마지막 갱신 후 90초가 지나면 다른 창에서 접속할 수 있습니다. 정상적인 창 닫기와 로그아웃은 즉시 해제 요청을 보냅니다. 브라우저 강제 종료나 네트워크 단절로 종료 요청이 전달되지 않으면 마지막 갱신으로부터 최대 90초의 복구 시간이 필요할 수 있습니다.
- 일반적인 탭 전환이나 창 최소화는 접속을 해제하지 않습니다. 장시간 브라우저가 실행을 중단해 권한이 만료되거나 연결 확인에 실패하면 게임을 중단하고 다시 로그인을 요구합니다. 뒤로 가기로 캐시된 페이지에 복귀할 때도 권한을 다시 확보합니다.
- 창 종료 요청에는 문서 버전 조건을 붙여 지연된 요청이 새 창의 접속 권한을 삭제하지 못하게 합니다. 게임 저장 요청의 `sessionOwnerId`도 서버에서 검사해 만료된 창의 지연 저장을 거부합니다.
- Firebase 인증 정보는 자동 로그인을 위해 다른 탭과 공유될 수 있습니다. 접속을 거부한 탭에서 Firebase 로그아웃을 호출하거나 인증 저장 방식을 변경하지 않습니다.
- 같은 브라우저의 게임 데이터는 공통 로컬 저장소를 사용하므로 Web Locks로 Google/게스트를 포함해 하나의 게임 창만 허용합니다. 게스트는 기기 내부 계정이며, 다른 기기에서 이어서 사용하려면 Google 계정을 연결해야 합니다. 게스트 접속에는 Web Locks를 지원하는 HTTPS 환경 또는 localhost가 필요합니다.

이 변경은 웹 앱과 `firestore.rules`를 함께 반영해야 합니다. 기존 규칙은 `accountSessions` 접근을 허용하지 않으며, 새 규칙은 `sessionOwnerId`가 없는 구버전 웹 앱의 저장을 거부합니다. 서비스 반영 시 두 변경을 함께 배포하고 열려 있는 구버전 창은 새로고침해야 합니다. 규칙 배포 명령은 위의 `npx firebase-tools deploy --only firestore:rules`입니다. 추가 Firebase 서비스나 환경 변수는 필요하지 않습니다.

검증:

```powershell
npm run validate:account-session
npm run validate:account-sync
npm run build
```

`validate:account-session`은 실제 접속 클라이언트에 원자적 Firestore 모형과 브라우저 이벤트/타이머를 주입해 동시 획득, 정상 종료, 만료, 지연 응답, 네트워크 오류 및 게스트 잠금을 검증합니다. 실제 Google 팝업 및 서로 다른 기기의 전체 로그인 흐름은 배포 환경에서 별도로 확인해야 합니다.

React 로그인 상태와 지연된 동기화 응답도 검증하려면 앱과 같은 버전의 테스트 렌더러를 임시 폴더에 설치합니다. 앱의 운영 의존성은 변경하지 않습니다.

```powershell
npm install --prefix "$env:TEMP/champions-auth-provider-validation" --no-package-lock --no-audit --no-fund react@19.2.8 react-test-renderer@19.2.8
node scripts/validateAuthProvider.mjs
node scripts/validateAccountSessionSync.mjs
```

저장 실패와 재시도, 저장 중 로그아웃 차단, 가로 화면의 복구 UI는 `npm run validate:account-recovery-ui`로 확인합니다. 이 브라우저 검증은 `promo`의 Playwright와 설치된 Chromium을 사용하며, 계정 데이터 훅을 로컬 모형으로 대체합니다. 운영 계정에는 접속하지 않습니다.

관련 Firebase 문서: [인증 정보의 탭 간 공유](https://firebase.google.com/docs/auth/web/auth-state-persistence), [Firestore REST API](https://firebase.google.com/docs/firestore/use-rest-api), [Firestore의 접속 상태 처리 제약](https://firebase.google.com/docs/firestore/solutions/presence).
