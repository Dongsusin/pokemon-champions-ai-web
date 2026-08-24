# Firebase Google 로그인 설정

## 1. Firebase 프로젝트 연결

현재 기본 프로젝트는 `Pokemon Champions Arena` (`pokemon-champions-arena-2026`)입니다.

1. Firebase Console에서 프로젝트와 Web App을 생성합니다.
2. Authentication > Sign-in method에서 Google 공급자를 활성화합니다.
3. Authentication > Settings > Authorized domains에 개발·배포 도메인을 등록합니다.
4. Cloud Firestore 데이터베이스를 생성합니다.

## 2. 로컬 환경변수

`.env.example`을 `.env.local`로 복사하고 Firebase Web App 설정값을 입력합니다.

```powershell
Copy-Item .env.example .env.local
```

Vite 환경변수는 브라우저 번들에 포함되므로 Firebase Web App 설정값만 사용하고 서비스 계정 비밀키는 절대 넣지 않습니다.

## 3. Firestore 규칙 배포

저장소의 `firestore.rules`는 로그인한 사용자가 자신의 `players/{uid}` 문서와 하위 게임 데이터만 읽고 쓸 수 있도록 제한합니다.

```powershell
npx firebase-tools login
npx firebase-tools deploy --only firestore:rules
```

로그인 성공 시 `players/{uid}` 프로필 문서가 자동으로 생성 또는 갱신됩니다. 포켓몬, 팀, 아이템 등 기존 로컬 게임 데이터의 Firestore 이전은 다음 백엔드 데이터 동기화 단계에서 진행합니다.
