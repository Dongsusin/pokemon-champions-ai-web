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

Vercel 미리보기 주소에서 Google 로그인을 테스트하려면 해당 미리보기 도메인도 별도로 승인해야 합니다.

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
