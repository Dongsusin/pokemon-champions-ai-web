# Pokémon Champions Arena — 로컬 게스트 버전

기존 게임과 메뉴를 유지하고, 트레이너와 모든 개인 진행 기록을 로컬에 저장한다.
Google 로그인, Firebase 저장 및 Vercel API가 없어도 플레이할 수 있다.
별도로 개발 중인 런처는 저장 연결 규격과 선택적인 개인 온라인 서비스를 연결하면 된다.

## 실행

Node.js 22 이상에서 다음 명령을 실행한다.

```powershell
npm ci
npm run build:local
npm run local:run
```

`http://127.0.0.1:4173/`를 열면 로컬 파일 저장으로 실행된다.
Windows의 기본 저장 파일은 `%LOCALAPPDATA%\ChampionsArena\saves\main.json`이다.
첫 빌드에서는 이미지·울음소리를 내려받는다. 완성된 `dist/`를 포함해 배포하면 플레이 중 인터넷 다운로드가 필요 없다.

환경 설정의 **저장 · 트레이너**에서 백업 파일을 내보내거나 한 번 가져올 수 있다.
시작 화면으로 돌아가도 같은 게스트와 기록이 유지된다.

랭크·대전방·채팅 메뉴도 유지한다. 개인 서버를 런처에 연결하기 전에는 준비 안내를 표시한다.
온라인 서비스의 게임 상태는 개인 서버가 판정하며, 개인 진행 기록을 클라우드에 자동 동기화하지 않는다.

[런처 저장/개인 서버 연결 규격과 검증 결과](docs/LOCAL_LAUNCHER.md)를 참고한다.
Vercel 자동 Git 배포는 `vercel.json`에서 전체 브랜치에 대해 비활성화했다.

## 로컬 버전 검증

```powershell
npm run validate:local-data
npm run validate:local-assets
npm run validate:z-mirror-move
npm run validate:battle-factory
```

`legacy/cloud/`의 API와 기존 클라우드 검증 명령은 이전 웹 서비스 참고 자료다.
현재 게임을 실행하는 데 클라우드 SDK나 인증 환경 변수가 필요하지 않다.
