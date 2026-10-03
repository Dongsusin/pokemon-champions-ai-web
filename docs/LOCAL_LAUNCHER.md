# 로컬 게스트 전환과 런처 연결 규격

## 동작 범위

뽑기, 박스, 팀 편성, 육성, 도구 상점, AI 리그·토너먼트, 팩토리, 보스전,
업적, 설정 및 사용률 화면을 유지한다. 개인 진행 기록은 로컬 저장소 하나에 함께 저장한다.
게스트 ID도 영구 저장하므로 게임을 종료하거나 시작 화면으로 돌아가도 이어서 플레이한다.
닉네임과 획득한 칭호 역시 같은 로컬 기록에 포함된다.

Google/Firebase 로그인과 자동 클라우드 동기화는 게임에서 제거했다.
랭크·대전방·채팅·접속자 메뉴는 유지하되, 런처가 개인 온라인 서비스를 제공할 때만 연결한다.
연결 전에는 서버를 호출하거나 가짜 랭크 대전을 생성하지 않는다.
서버에서 판정한 랭크 VP 보상은 기존 중복 지급 방지 장부로 로컬 지갑에 정산한다.
AI 및 연결된 랭크에서 실제 출전한 내 포켓몬의 사용률과 도구 기록은 로컬에 집계한다.

이 저장소는 게임 측 전환을 담당한다. 런처 설치 프로그램, 업데이트 UI와 개인 온라인 서버의 배포는 별도 작업이다.

## 빌드와 파일 저장 실행

Node.js 22 이상이 필요하다.

```powershell
npm ci
npm run build:local
npm run local:run
# 별도 저장 폴더/포트 지정
npm run local:run -- --data-dir C:/Games/ChampionsArena/saves --port 4173
```

기본 주소는 `http://127.0.0.1:4173/`이다. 로컬 런타임은 루프백 주소에만 바인딩한다.
설치된 `dist/`의 파일과 저장 API만 제공하며, 이전 `/api/account`, `/api/ranked`, `/api/chat`은 제공하지 않는다.
저장 API는 실행 때마다 생성한 접근 토큰과 Host/Origin 검사를 사용한다.
렌더러의 외부 네트워크 요청은 CSP로 차단한다. 개인 서버 연결은 런처의 별도 전송 계층에서 처리한다.

| 파일 | 역할 |
| --- | --- |
| `main.json` | 현재 로컬 저장 |
| `main.backup.json` | 직전 정상 저장 |
| `before-import.json` | 마지막 가져오기 직전 기록; 이후 자동 저장으로 덮어쓰지 않음 |
| `.runtime.lock` | 같은 저장 폴더를 두 런타임이 동시에 쓰지 못하도록 하는 실행 잠금 |

Windows 기본 위치는 `%LOCALAPPDATA%\ChampionsArena\saves`이다.
macOS는 `~/Library/Application Support/ChampionsArena/saves`, Linux는
`$XDG_DATA_HOME/ChampionsArena/saves` 또는 `~/.local/share/ChampionsArena/saves`를 사용한다.
실제 런처도 업데이트 때 교체되는 설치 폴더와 분리된 고정 저장 폴더를 사용해야 한다.

완성된 게임 `dist/`, `local-runtime/`, `src/local/saveSchema.js`와 모듈 실행 설정(`package.json`의 `type: module`)을
함께 제공하면 이 참고 런타임은 외부 npm 패키지 없이 Node.js 기본 모듈만으로 실행할 수 있다.
런처 자체 IPC 저장을 사용한다면 `dist/`와 아래 브리지 규격만 연결하면 된다.

`npm run dev`는 브리지 없이 개발할 때 IndexedDB를 사용한다.
이 저장은 해당 브라우저 프로필과 주소에 귀속된다. 실제 런처는 파일 저장 브리지를 제공해야 한다.
개발 모드의 이미지도 최초에 `npm run prepare:local-assets`로 준비한다.

## 리소스 준비

`npm run build:local`의 사전 단계가 Showdown/PokeAPI의 기존 게임 리소스를 로컬에 준비하고 SHA-256을 검증한다.
이번 전환에서 이미지·울음소리 9,106개(약 221.2 MiB), 포켓몬 프로필 1,574개와
리소스 선택 그룹 9,472개를 확인했다. 설치 후 플레이는 `/assets/vendor/` 등 설치 파일만 읽는다.
이전 저장에 포함된 외부 스프라이트 URL도 설치된 로컬 경로로 변환한다.

용량 때문에 `public/assets/vendor/`는 Git에 넣지 않는다. 새 체크아웃은 최초 준비 시 인터넷이 필요하다.
오프라인 빌드 환경으로 옮길 때에는 준비된 `public/assets/vendor/`를 함께 복사하고
`npm run validate:local-assets`를 실행한다. 플레이어에게 제공하는 `dist/`에는 이 파일들이 전부 포함되어야 한다.
누락되거나 손상된 파일을 그대로 출하하지 않도록 빌드 전 검증이 실패한다.
게임은 웹 서비스 워커를 새로 설치하지 않는다.

## 저장 브리지 v1

게임 스크립트가 실행되기 전에 호스트 창에 `window.championsLauncher`를 주입한다.
기존 크기 조절용 게임 iframe은 부모 호스트의 브리지를 사용한다.
Electron 등에서는 제한된 preload/IPC 함수로 연결하고 파일 시스템 전체를 렌더러에 노출하지 않는다.

```typescript
interface LocalSave {
  format: 'champions-arena-local'
  version: 1
  revision: number
  updatedAt: number // Unix milliseconds
  values: Record<string, string>
}

interface ChampionsLauncher {
  version: 1
  getInfo?(): Promise<{ saveLocation: string }>
  readSave(): Promise<LocalSave | null>
  writeSave(save: LocalSave, options: {
    expectedRevision: number
    reason?: 'import'
  }): Promise<LocalSave>
  onBeforeClose?(flush: () => Promise<boolean>): void
  online?: LauncherOnline
}
```

`readSave()`는 새 게임에서 `null`을 반환한다. 손상된 파일은 오류를 반환해야 한다.
`writeSave()`는 저장 성공 후에만 resolve하고, 현재 revision과 expectedRevision이 다르면 거부한다.
검증한 전체 스냅샷을 임시 파일에 쓴 뒤 원자적으로 교체하고, revision을 1 증가시킨 실제 저장 결과를 반환한다.
기존 파일을 백업하며 `reason: 'import'`일 때에는 가져오기 전 기록을 별도로 보존한다.
`local-runtime/fileSaveStore.mjs`가 이 동작의 참고 구현이다.

게임은 변경을 짧게 묶어 자동 저장하고, 저장 중 도착한 변경도 순서대로 반영한다.
임시 브라우저 변경 기록은 renderer 중단 후 아직 저장되지 않은 변경을 복구하는 데 사용한다.
완료된 저장의 revision보다 오래된 임시 기록은 다시 덮어쓰지 않는다.
런처는 `onBeforeClose()`로 받은 flush 함수를 창 종료 전에 await하고, 실패하면 창을 유지해 재시도할 수 있게 해야 한다.
용량/권한/충돌 오류는 저장 배지와 관리 화면에 표시한다. 잘못된 기록을 빈 새 게임으로 조용히 덮어쓰지 않는다.

저장 형식의 허용 키는 `src/local/saveSchema.js`를 기준으로 한다.
포켓몬·팀·지갑·도구·업적·팩토리·설정·게스트·개인 사용률과 화면 선호도를 포함한다.
Firebase 토큰, Google 연결 정보와 클라우드 요청 큐는 백업에 포함하지 않는다.
JSON 백업 파일의 허용 크기는 32 MiB다.

## 데이터 한 번 가져오기

1. 환경 설정 → **저장 · 트레이너**에서 현재 기록을 **백업 내보내기**로 보관한다.
2. **데이터 1회 가져오기**에서 JSON 게임 백업 파일을 선택한다.
3. 파일명, 포켓몬/팀 수와 VP를 확인하고 **이 데이터 가져오기**를 누른다.
4. 정상 저장 후 게임이 다시 시작되며, 이후에는 가져온 로컬 기록만 자동 저장한다.

취소하거나 유효하지 않은 파일을 선택하면 기존 기록은 유지된다.
파일 저장이 실패해도 게임의 현재 기록을 먼저 교체하지 않는다.
기존 개인 게임 값 맵 또는 `{ payload: { ... } }` 형식도 지원한다.
이전 형식에 게스트 프로필이 없으면 현재 로컬 트레이너를 유지한다.
같은 브라우저에 남은 이전 개인 저장은 로컬 저장 파일이 아직 없을 때만 한 번 옮긴다.
다른 웹 주소나 Google 계정의 서버에만 존재하는 기록은 자동 접근하지 않는다.
그 기록은 기존 서버/관리자가 내보낸 JSON 파일을 받아 한 번 가져와야 한다.

복구가 필요하면 런타임을 종료하고 현재 파일들을 먼저 별도 보관한 뒤,
`before-import.json` 또는 `main.backup.json`을 `main.json`으로 복원한다.
파일에 직접 손댈 때에는 열려 있는 게임 창이 없도록 한다.
유효하지 않은 원본은 자동 삭제하지 않고 시작 오류를 표시한다.

## 개인 온라인 서비스 연결

```typescript
interface LauncherOnline {
  channels: Array<'ranked' | 'chat' | 'presence'>
  request(channel: string, action: string, payload: object, options: {
    userId?: string
    requestId?: string
    signal?: AbortSignal
  }): Promise<object>
}
```

런처가 시작 전에 지원 채널을 명시한다. 채널이 없으면 해당 메뉴는 준비 안내만 표시한다.
`userId`는 저장된 게스트 ID이며 Google ID 토큰을 요구하지 않는다.
온라인 요청에 전체 저장 파일이나 계정 자격 증명을 전달하지 않는다.
게스트의 닉네임/칭호는 저장 브리지의 프로필을 읽어 개인 서비스의 신원 정보와 연결할 수 있다.

| 채널 | 게임이 사용하는 요청과 응답 |
| --- | --- |
| `ranked` | `status`, `join`, `cancel`, `select`, `submit`, `replace`, `forfeit`, `rankedLeaderboard`, `queueCounts` 및 대전방 요청. 기존 `src/rankedClient.js`, `RankedBattleScreen.jsx`, `BattleRoomsScreen.jsx`의 payload/화면 형식 유지 |
| `chat` | `read` (`expanded: true`이면 목록 포함), `send`; `src/globalChatClient.js`의 메시지/스냅샷 검증 형식 유지 |
| `presence` | `count`; `{ count: number, sampledAt: number, staleAfterMs: number }` (샘플 유효 기간 최대 60,000 ms) |

요청은 12초 제한과 AbortSignal 취소를 지원한다. 런처는 Electron IPC처럼 signal 객체를 직접 직렬화할 수 없는 전송에서
별도의 취소 ID/IPC 메시지로 변환해야 한다. `requestId`가 있는 변경 요청은 개인 서버에서도 중복 실행하지 않도록 처리한다.
응답 오류는 `{ error: { code, message } }` 또는 Promise rejection으로 전달한다.
서비스 로직과 서버에서 공개한 팀 상태/결과의 참고 자료는 `server/`에 남아 있다.
기존 서버의 Firebase 인증/저장 구현을 새 게스트 서버의 필수 조건으로 사용하지 않는다.

공유 순위, 실시간 대전방 및 채팅은 여러 기기가 함께 보는 개인 서버 기능이다.
게임 진행 파일과 개인 집계는 로컬에 유지하고 서버 판정이 필요한 요청만 런처를 통해 전달한다.

## 배포와 검증

`vercel.json`의 `git.deploymentEnabled: false`로 모든 브랜치의 자동 Git 배포를 비활성화했다.
이 변경 작업에서 Vercel 프로젝트를 재개하거나 새 웹 배포를 실행하지 않는다.
기존 API 진입점과 Firebase 배포 설정은 `legacy/cloud/`로 이동했다.
루트 의존성에서 Firebase, Firebase Admin, PostgreSQL 및 Vercel/Google 서버 SDK를 제거했다.

다음 검증을 실행한다.

```powershell
npm run validate:local-data
npm run validate:local-assets
npm run build:local
npm run validate:z-mirror-move
npm run validate:battle-factory
npm run validate:training-moves
npm run validate:draw-pool
npm run validate:game-text-scale
```

기존 전체 검증에서 확인한 선행 실패는 `validateBattleAchievementFacts.mjs`의 부활 관련 판정 2건과
`validateVpEconomy.mjs:64`의 업적 개수 기대값(278, 현재 목록 292)이다.
변경 전 HEAD를 별도 디렉터리에 추출해 같은 실패를 재현했다. 로컬 저장 전환의 통과 결과와 혼합해 보고하지 않는다.
과거 Firebase/웹 로그인 UI 검증은 새 게스트 흐름을 검증하는 명령이 아니다.

2026-10-03 확인 결과:

- 로컬 데이터/런타임 검증 24/24 통과: 진행·게스트·설정 보존, 이전 값 이관, 유효하지 않은 파일 차단,
  중단 복구, 디스크/할당량 오류, 순차 저장, 원자적 가져오기, revision 충돌, 개인 통계 중복 방지,
  개인 서비스의 취소/시간 제한, 파일 재시작·백업·잠금·로컬 API 접근 검사.
- 로컬 리소스 9,106개 SHA-256 검증과 최종 Vite 빌드 통과.
- Z따라하기 9/9, 팩토리의 기본/도전/지속 저장/난이도/코스트 검증,
  육성 기술 847개, 뽑기 후보 1,025개·보장 규칙 15개, 설정/글자 크기 검증 통과.
- 업적 저장·보상·기존 저장 페이로드와 칭호 검증 통과. 랭크 지갑 20건과 팀 내 도구 중복 규칙 통과.
- 실제 브라우저에서 게스트 시작, 10회 뽑기·부화, 팀 저장, JSON 백업 내보내기,
  시작 화면 복귀 및 재실행, 파일에서 이름·팀·VP 복원, AI 토너먼트 진입·기술 처리·기절 후 교대,
  팩토리 렌탈 팀의 재실행 복원, 개인 팩토리 순위, 랭크/대전방의 연결 전 안내와 보스 선택 화면 확인.
- 내보낸 JSON과 실제 저장 파일의 값이 같은지 검사했다. 가져오기 함수를 실제 파일 저장소에 연결해
  VP/팀/게스트 복원과 `before-import.json` 보존을 확인했다. 브라우저 네트워크 표본 30건에서
  외부 HTTP와 이전 클라우드 API 호출은 0건이며, 로비 이미지 9개가 모두 로컬에서 정상 표시됐다.
- 브라우저 파일 선택의 자동 검증은 Chrome 확장 기능의 파일 URL 접근 권한 때문에 완료하지 못했다.
  일반 파일 선택 UI, 가져오기 파서·저장 원자성 및 복원 화면 검증과 이 자동화 제한을 구분한다.
  이전 팩토리 순위 클라이언트 검증의 순수 로직 13건은 통과했고, 추가 Playwright 사례는
  해당 스크립트의 Chromium 실행 파일 설정이 없어 실행하지 못했다. 새 게스트의 팩토리 화면/저장 복원은 실제 Chrome에서 별도로 확인했다.
- 공개 웹 주소는 `503`과 `DEPLOYMENT_PAUSED`로 응답했다. Vercel 배포/재개는 수행하지 않았다.
