# 레이팅 서버: 로컬 테스트와 배포 전 확인 사항

레이팅 서버는 실제 로그인 계정의 Firebase ID 토큰으로 사용자를 확인하고 Firestore에서 경기와 등급을 관리한다. 2026-09-12 사용자 승인으로 운영용 서버 인증 설정을 완료했다. 일반 개발·빌드에서는 `RANKED_ENABLED`가 기본적으로 꺼져 있고 `/api/ranked`는 503 `RANKED_DISABLED`를 반환한다.

## 두 사용자로 실행하기

```powershell
npm run ranked:test
```

- 프런트엔드: `http://127.0.0.1:5185`
- 서버: `http://127.0.0.1:8787/api/ranked`
- 브라우저 창을 두 개 열고 테스트 트레이너 A / B를 각각 선택한다.
- 제공된 서로 다른 6마리 팀으로 같은 싱글/더블 대기열에 참가한다.
- 매칭 뒤 싱글 3마리 또는 더블 4마리를 순서대로 확정한다.
- 두 사용자 모두 행동을 확정하면 서버가 기술, 교체, 기믹, 데미지와 승패를 처리한다.
- 종료는 실행 중인 터미널에서 `Ctrl+C`를 누른다.

서버만 실행하려면 `node scripts/rankedDevServer.mjs --test-accounts`를 사용한다. `--test-accounts`를 생략하면 실행을 거절하며, 127.0.0.1 / ::1 외의 주소에는 바인딩하지 않는다. `NODE_ENV=production` 또는 Vercel 환경에서는 테스트 인증기를 생성할 수 없다. 테스트 토큰은 고정된 로컬 테스트 식별자이며 실제 계정의 Firebase ID 토큰이 아니다.

테스트 데이터는 Git에서 제외된 `scripts/.cache/ranked-test/state.json`에 저장된다. 정상 종료 후 다시 실행하면 대전/레이팅이 이어진다. 서버가 강제로 종료되어 잠금 파일 `state.json.lock`이 남으면 기록된 PID의 프로세스가 없음을 확인한 경우에만 자동 복구한다. 복구 중에도 별도 잠금으로 두 프로세스가 동시에 파일을 여는 것을 막는다. PID가 비어 있거나 잘못됐거나, 기존 서버가 아직 실행 중이면 시작을 거절한다. 이런 경우 기존 서버가 종료됐는지 직접 확인한 뒤 해당 잠금 파일만 정리한다. 실행 중인 서버의 잠금 파일이나 실제 게임 저장 데이터는 삭제하지 않는다.

## 서버가 확정하는 사항

- 사용자 신원은 인증기에서 정하며 요청 본문의 사용자 ID는 사용하지 않는다.
- 싱글/더블 프로필과 대기열은 분리된다. 자신과 매칭되지 않고 한 계정은 한 대기열/진행 대전만 가질 수 있다.
- 초기 실력 차 허용폭은 Elo 100이다. 기다린 시간 15초마다 100씩 넓어지며 최대 800이다. 오래 기다린 후보를 먼저 선택한다.
- 대기열은 30초 리스로 유지된다. 정상 폴링은 리스를 연장하고, 연결이 끊긴 대기열은 매칭에서 제외된다.
- 출전 선택 90초, 턴 행동 60초, 강제 교체 45초 제한이 있다. 연출이 생성된 뒤에는 추가 15초를 주어 화면 재생으로 선택 시간이 소모되는 것을 줄인다.
- 시간 내 한쪽만 제출했으면 미제출 쪽이 패배한다. 양쪽 모두 미제출이면 무승부로 처리하고 포인트를 지급하지 않는다. 접속이 끊겨도 제한 시간 내 재접속하면 같은 상태에서 이어갈 수 있다.
- 타임아웃은 해당 대전에 대한 다음 인증 요청/폴링 시 트랜잭션으로 확정한다. 양쪽 모두 오프라인이면 배경 작업이 임의로 실행되는 구조가 아니며, 다음 재접속에서 동일 결과가 확정된다.
- 선택한 포켓몬, 아직 실행되지 않은 행동, 비공개 상대 능력치·기술·도구를 응답에 그대로 포함하지 않는다. 매칭 프리뷰에는 상대 6마리의 공개 종 정보만 제공한다.
- 제출마다 `requestId`, 행동마다 매치 `revision`을 검증한다. 양쪽 제출은 서버 저장소 트랜잭션 안에서 한 번만 진행되며, 승패·양쪽 레이팅도 같은 트랜잭션에서 한 번만 반영된다. 최근 64개 요청은 중복 전송을 재처리하지 않으며, 더 오래된 턴 요청은 revision으로 차단된다.
- 경기 정산 시 양쪽 계정의 현재 경기 연결을 함께 해제한다. 새로 접속한 페이지에는 갱신된 점수·전적만 전달하고 종료된 경기를 복구하지 않는다. 기존에 종료됐으나 연결이 남은 기록도 상태 조회 시 재정산 없이 해제한다.
- 상대 관점의 타겟 지정은 서버에서 변환한다. 피해량·기술 위력·상대 행동·승패를 클라이언트가 지정할 수 없다.
- 턴 300회 초과는 무승부 처리한다. 대전 결과 기록은 계정별 최근 20개를 유지한다.

## VP 지급

정상 승리 600 VP, 패배 200 VP, 무승부 300 VP이며 싱글·더블에 같은 기준을 적용한다. 기존 지급액의 2배이며 새로 정산하는 경기에 적용한다. 배틀 시작 후 상대 기권·행동/교대 시간 초과로 이기면 600 VP, 해당 패자는 0 VP다. 배틀 시작 전 종료와 양쪽 시간 초과에는 VP를 지급하지 않는다. 이미 완료된 경기는 소급 지급하지 않으며 과거 지급액을 현재 보상표로 다시 계산하지 않는다.

VP는 승패와 같은 서버 트랜잭션에서 한 번만 확정한다. 계정별 `vpRewardTotal`은 최근 20개 경기 기록과 별개인 누적 합계이며 모든 상태 응답의 `vpRewards: {uid, total}`로 전달한다. 경기 결과의 `rewardVp`는 해당 경기 지급액을 표시하는 용도다.

신규 게임 계정의 시작 지갑 잔액은 50,000 VP이며 `vpRewardTotal`의 초기값 0과 구분한다. 기존 지갑 잔액, 레이팅 누적 합계·수령 기록, 기지급 업적은 보상 인상으로 변경하지 않는다. 과거 승리 300 VP를 지급받은 계정이 인상 후 정상 승리하면 새 경기 보상 600 VP만 누적 합계에 더한다.

클라이언트는 현재 계정의 활성 세션을 확인하고, 서버 합계에서 같은 UID의 수령 합계를 뺀 양수 차이만 적립한다. 잔액과 `rankedVpRewards: {uid, total}` 수령 기록은 `champions-achievements-v1` 지갑에 단일 쓰기로 저장한다. 업적·구매·훈련·AI 보상 저장에서도 수령 기록을 보존하고 기존 계정 동기화로 함께 저장한다. 결과 창을 닫거나 새로고침해도 중복 지급하지 않으며, 지급 응답을 놓쳤으면 다음 레이팅 접속 때 누적 차액을 회수한다. 계정 저장 실패는 재시도 안내를 표시하고 재적립 없이 저장만 재시도한다. 로컬 테스트 계정의 보상은 실제 게임 지갑에 지급하지 않는다.

## HTTP 계약

인증은 `Authorization: Bearer <Firebase ID token>`이다. 명시적 로컬 서버만 `ranked-test-alice`, `ranked-test-bob`, `ranked-test-charlie`를 받는다.

| 요청 | 주요 필드 |
| --- | --- |
| `GET /api/ranked` | 자기 프로필, 대기열, 진행 중인 매치 조회 |
| `GET /api/ranked?action=fixtures` | 로컬 테스트 팀만 반환. 운영에서는 404 |
| `POST` `action: join` | `requestId`, `format: single/double`, `team: [6명]` |
| `POST` `action: cancel` | `requestId`, `queueTicket` |
| `POST` `action: select` | `requestId`, `matchId`, `revision`, `selection: [팀 인덱스]` |
| `POST` `action: submit` | `requestId`, `matchId`, `revision`, `actions: [...]` |
| `POST` `action: replace` | `requestId`, `matchId`, `revision`, `targetIndex` |
| `POST` `action: forfeit` | `requestId`, `matchId` |

기본 응답은 `{profile: {single, double}, vpRewards: {uid, total}, queue, match, serverTime}`이다. 매치는 `phase: select/battle/finished`, `revision`, `timelineRevision`, 개인화된 `state`, `timeline`, 제출 여부, 서버 제한 시간, 자기 결과를 제공한다. 상태 폴링에 `matchId`와 이미 받은 `timelineRevision`을 함께 보내면 같은 연출의 대용량 재전송을 생략한다. 이때 `timeline`만 빈 배열이고 현재 상태는 계속 반환한다. 오류는 `{error: {code, message}}`이며 클라이언트는 409 이후 최신 상태를 다시 불러온다.

경기가 끝난 직후에도 해당 경기를 보고 있던 클라이언트의 `matchId` 조회와 종료 명령 응답에는 마지막 턴과 결과를 전달한다. 새로운 대기열이나 진행 경기가 있으면 그 상태를 우선한다. `matchId` 없는 새 상태 조회는 완료 경기를 반환하지 않는다. 화면에서 결과를 닫으면 로컬 경기 데이터와 조회용 `matchId`를 제거하고 진행 중이던 이전 응답도 무효화한다. 서버의 완료 기록은 중복 정산 방지를 위해 보존하며, 진행 중인 경기의 재접속 복구는 유지한다.

## 운영 설정

Vercel Production에서 아래 설정을 사용한다. 서버 계정 생성과 비밀 키 등록은 별도 인증 설정 단계다.

| 서버 환경변수 | 의미 |
| --- | --- |
| `RANKED_ENABLED=true` | HTTP 서버 활성화 |
| `RANKED_FIREBASE_PROJECT_ID=pokemon-champions-arena-2026` | 실제 게임 계정의 Firebase 프로젝트 |
| `RANKED_FIRESTORE_PREFIX=ranked` | 운영 레이팅 전용 컬렉션 이름 접두어 |
| `RANKED_FIREBASE_SERVICE_ACCOUNT_JSON` | 서버 전용 서비스 계정 JSON. 생략 시 ADC 사용 |
| `NODE_OPTIONS=--experimental-require-module` | Vercel Node 24에서 Firebase Admin의 CommonJS → ESM 의존성 로딩 허용 |

Vercel은 Node 런타임의 `require(esm)`을 기본적으로 비활성화한다. 현재 Firebase Admin 14.4.0의 `jwks-rsa` 4.1.0은 CommonJS에서 ESM 전용 `jose` 6을 불러오므로 위 `NODE_OPTIONS` 설정이 필요하다. 설정이 빠지면 서버 인증 모듈을 불러오는 `initialization / firebase-auth` 단계에서 `ERR_REQUIRE_ESM`이 발생한다. Node 버전만 24로 맞춘 것으로는 충분하지 않으며 환경변수를 등록한 뒤 새 배포에 반영해야 한다. [Vercel 공식 require(esm) 설정](https://vercel.com/docs/functions/runtimes/node-js/advanced-node-configuration#experimental-nodejs-require-of-es-module), [Firebase Admin 관련 이슈](https://github.com/firebase/firebase-admin-node/issues/3181).

서비스 계정이나 토큰을 `VITE_` 변수, 소스, 커밋에 넣지 않는다. Firebase Admin은 만료·취소된 ID 토큰과 비활성 계정을 거절한다. 실제 계정의 팀은 `players/{uid}/gameData/collection`의 저장된 보유 포켓몬으로 다시 구성한다. 요청 본문에 넣은 종·능력치·도구를 그대로 채택하지 않는다. 장착 도구는 `progress` 문서의 보유 도구 정보도 확인한다.

전용 서비스 계정은 Firestore 읽기/쓰기용 `roles/datastore.user`와 취소·비활성 계정 확인용 `roles/firebaseauth.viewer`를 사용한다. 후자의 읽기 권한에는 인증 사용자 정보 조회가 포함되므로 비밀 키는 Vercel 서버에서만 보관한다. 참고: [Firestore IAM](https://firebase.google.com/docs/firestore/security/iam), [Firebase Authentication 역할](https://docs.cloud.google.com/iam/docs/roles-permissions/firebaseauth).

현재 게임의 기존 보유 데이터 자체는 클라이언트 동기화 방식으로 저장된다. 따라서 이 구현은 **계정 저장에 없는 포켓몬 등록 및 전투 명령 변조를 차단**하지만, 기존 수집/재화 저장 시스템 전체를 변조 불가능한 서버 게임으로 전환한 것은 아니다. 공개 경쟁 시즌 전에는 수집·재화 획득 검증과 부정 사용 대응이 별도로 필요하다.

Firestore는 `${prefix}_players`, `${prefix}_queue`, `${prefix}_matches`, `${prefix}_timelines`, `${prefix}_meta`를 서버 권한으로만 읽고 쓴다. 클라이언트 규칙으로 이 컬렉션을 열지 않는다. 대전 상태는 중첩 배열을 보존하는 JSON 문자열로 저장하고, 문서당 850KB 상한을 둔다. 연출은 700KB 이하 청크로 나눠 별도 저장하고 다음 연출 생성 때 이전 청크를 제거한다. 한 번의 전체 연출은 3.5MB를 넘지 않아야 하며, 이를 넘어서는 엔진 결과는 저장 전에 트랜잭션 전체를 취소한다. 이는 이전 연출 삭제와 새 연출 저장이 함께 일어나는 Firestore 트랜잭션 크기 및 Vercel 응답 크기에 여유를 남긴다. 매칭은 로비 문서, 턴/결과는 매치와 양쪽 프로필을 Firestore 트랜잭션으로 함께 보호한다.

운영 로그의 `Ranked server failure`는 `initialization`, `authentication`, `request` 단계와 허용된 Firebase/gRPC 오류 코드만 기록한다. 토큰, 관리자 자격 증명, SDK 오류 원문, 팀 자료는 출력하지 않는다. 기능을 끈 경우는 `RANKED_DISABLED`, 초기화·인증 서버 장애는 `RANKED_UNAVAILABLE`(503), 실제 만료·취소·잘못된 ID 토큰은 `UNAUTHENTICATED`(401)로 구분한다. 동기화 중 컬렉션과 진행 자료의 저장 리비전이 다르면 참가를 확정하지 않고 `ACCOUNT_SYNC_REQUIRED`(409)로 다시 동기화하도록 안내한다.

로컬 파일 저장과 Firestore 어댑터 계약은 검증되었다. 2026-09-12 전용 계정으로 실제 Firestore의 별도 검증 공간에서 싱글·더블 매칭과 정산 등 9개 검사를 통과했고 생성한 문서 8개를 정리했다. 이는 공개 API를 통한 두 Google 계정 간 대전 시험과 구분한다. 동시 접속 부하, 데이터 보존 정책과 요금은 후속 운영 검증 대상이다. 완료 매치 문서 정리 작업과 반복 상대를 이용한 점수 획득 방지 정책은 아직 추가하지 않았다.

운영 공개키 인증서는 2027-09-12 만료된다. 해당 날짜 전에 새 키를 등록하고 Vercel Production Secret을 교체한 다음 인증된 API와 저장소 연결을 재검증해야 한다. 비밀 파일은 로컬의 Git 제외 경로에서만 다루며 문서나 소스에 내용을 기록하지 않는다. 공개키 등록 방식: [Google IAM 키 업로드](https://docs.cloud.google.com/iam/docs/keys-upload).

## 검증

```powershell
node scripts/validateRankedService.mjs
node scripts/validateRankedBattle.mjs
node scripts/validateRankedFirestore.mjs --dry-run
```

실제 Firestore 연결 검증은 `npm run validate:ranked-firestore -- --credentials <서비스계정JSON경로> --project-id <기대프로젝트ID>`로 실행한다. 임의의 `ranked_validation_...` 접두어만 사용하며 기존 사용자·운영 점수 컬렉션에는 쓰지 않는다. 종료 시 자신의 자료만 제거한 뒤 빈 상태를 확인한다. 검증용 식별자는 Firebase Auth 계정이 아니며 공개 API의 인증을 우회하는 경로는 제공하지 않는다.

서비스 검증은 동시 매칭·취소 경쟁, 요청 중복, 리비전, 비공개 정보, 재접속, 결과 한 번 반영, 단계별 타임아웃, 파일 재시작, Firestore JSON 계약, 서버 소유권 확인, 인증 우회 방지, 실제 두 HTTP 클라이언트의 싱글/더블 기술 데미지와 승패 정산을 포함한다. 실제 Firebase/Vercel을 변경하지 않는다.

Vercel 기본값과 같은 모듈 로딩 실패를 자격 증명 없이 재현하려면 아래 명령을 실행한다. 현재 의존성 조합에서는 `ERR_REQUIRE_ESM`과 종료 코드 1이 재현 결과다.

```powershell
node --no-experimental-require-module --input-type=module -e "await import('firebase-admin/auth')"
```

배포에 사용할 설정으로 Firebase Admin 세 진입점과 엔진을 검증한다. 이 명령은 인증키를 읽거나 Firestore에 접속하지 않는다.

```powershell
node --experimental-require-module --input-type=module -e "await Promise.all([import('firebase-admin/app'),import('firebase-admin/auth'),import('firebase-admin/firestore'),import('./server/rankedBattle.js')]); console.log('runtime imports passed')"
```
