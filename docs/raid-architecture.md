# 협동 보스전 서버 구조

이 문서는 `pokemon_champions_coop_boss_raid_codex_prompt.txt`를 기준으로 구현한 1~3인 협동 보스전의 서버 경계와 복구 절차를 설명한다. `server/raidBattle.js`는 순수·결정론적 전투 엔진이고, `server/raidService.js`는 인증된 참가자, 방, 저장된 전투 상태, 명령, 보상을 조율한다. 클라이언트는 서버가 만든 상태를 표시하고 자신의 명령만 요청한다.

운영 활성화와 배포는 이 문서의 범위가 아니다. 기본 플래그는 `RAID_ENABLED=false`, `VITE_RAID_ENABLED=false`다. 일반 화면의 진입점에는 프런트 플래그가, 서버 요청 허용에는 서버 플래그가 각각 필요하다. 프런트 플래그는 서버 접근 권한을 대신하지 않는다.

## 저장 모델과 소유권

모든 변경은 현재 `GAME_STORAGE_PROVIDER`가 선택한 `rankedStore.transaction` 안에서 처리한다. 메모리 저장소는 검증 전용이다. 저장 컬렉션은 기존 레이팅·대전방 컬렉션과 분리되어 있으며, 레이드가 그 컬렉션을 직접 노출하지 않는다.

| 컬렉션 | 용도 | 공개 여부 |
| --- | --- | --- |
| `raidRooms` | 대기실의 선택 개체·준비·비공개 코드 hash | 서버 전용 |
| `raidRoomIndex` | 공개 목록용 작은 대기실 인덱스 | 서버 전용, 안전한 투영만 응답 |
| `raidPlayers` | 사용자별 활성 방/전투 포인터, 마지막 결과, 레이드 VP 합계 | 서버 전용 |
| `raidRuns` | 전투 스냅샷, seed, 명령, lease, 결과 | 서버 전용 |
| `raidRunHeads` | 폴링용 작은 전투 헤더 | 서버 전용, 안전한 투영만 응답 |
| `raidEvents` | 정해진 이벤트 청크 | 서버 전용, 참가자에게 allowlist 투영 |
| `raidResults` | 사용자별 최근 결과 요약 | 서버 전용 |
| `raidRewardReceipts` / `raidFirstClears` | 중복 지급과 최초 클리어 방지 | 서버 전용이며 장기 보존 |
| `raidExpiryIndex` | 종료 전투·이벤트·결과의 작은 만료 인덱스 | 서버 전용 |

`raidRuns`에는 외부 wrapper와 `battle.raid` 모두 `schemaVersion`, `ruleVersion`, `engineVersion`을 저장한다. 어떤 버전이라도 현재 서버가 지원하지 않으면 서비스는 `RAID_VERSION_UNSUPPORTED`(409)를 반환하고 그 기록을 변경하거나 정리하지 않는다. 이 규칙은 전체 상태 GET, compact 헤더 GET, 이탈·포기·단계 진행 등 엔진을 우회할 수 있는 변경 경로에도 적용한다.

방의 실제 사람 슬롯은 최대 3개다. 같은 UID는 두 슬롯을 차지할 수 없고, 시작 뒤에는 새 사람이 참가할 수 없다. 빈 칸은 서버 NPC가 채우며, 각 사람은 자신의 포켓몬 한 마리만 선택·조작한다. 선택 요청의 species, 기술, 도구 값은 신뢰하지 않는다. `resolvePokemon`이 서버에 동기화된 보유 개체와 도구 소유를 다시 확인하고, 시작 직전에 불변 전투 스냅샷으로 고정한다.

## 방과 모드 상호 배제

방 생성·참가·시작·퇴장 모두 사용자 `raidPlayers` 포인터와 기존 `players.activeRaidId`를 같은 트랜잭션에서 갱신한다. 레이드 참가 중에는 레이팅 큐, 진행 레이팅 대전, 기존 대전방에 들어갈 수 없고, 반대로 그 상태인 사용자는 레이드 방을 만들거나 들어갈 수 없다. 유효하지 않은 이전 포인터만 조심스럽게 해제한다. 새 레이드나 새 일반 대전의 포인터를 오래된 정리 작업이 지우지 않도록 ID가 일치할 때만 해제한다.

공개 방 목록은 `raidRoomIndex`만 읽는다. 비공개 방은 목록에서 숨기고, 방 생성자가 한 번 받는 서버 생성 8자리 초대 코드로만 참가한다. 코드 원문은 저장하지 않고 salt/hash만 저장한다. 실패 횟수는 사용자와 코드 범위별로 서버에 보존하여 재시작·다중 인스턴스에서도 무차별 추측을 제한한다.

## 전투 상태와 명령

전투 엔진의 입력/출력 계약은 다음과 같다.

```js
createRaidBattle({ raidId, bossId, members, npcRoles, seed })
validateRaidCommand(battle, ownerId, command)
resolveRaidTurn(battle, commandsByOwner, { seed })
startRaidBossStage(battle, { seed })
getRaidOutcome(battle)
chooseRaidCommand(battle, ownerId, { seed })
getRaidBattleView(battle, ownerId)
```

랜덤 seed는 서버가 요청 시작 전에 생성해 저장하고, transaction 재시도와 lease 인수인계에는 이미 잠긴 seed를 재사용한다. 클라이언트 HP, 피해, 보스 폼, 승패, VP는 입력받지 않는다. `validateRaidCommand`는 명령을 canonical `move` 형식으로 정규화한 뒤 소유자 actor·기술·타깃·기믹을 확인한다.

대기실 변경은 `roomRevision`으로 잠근다. 전투 입력은 `decisionToken`과 사용자별 단조 증가 `commandVersion`으로 잠근다. 명령을 취소해도 버전 카운터는 되돌리지 않아 오래된 재제출의 ABA 문제가 생기지 않는다. 같은 `requestId`를 같은 payload로 재시도하면 원래 요청이 실제로 잠근 동일한 resolution만 재개할 수 있다. 완료된 이전 턴의 요청은 새 deadline이나 새 턴을 진행시키지 않는 읽기 전용 재응답이다.

살아 있는 인간 포켓몬의 명령이 모두 들어오거나 서버 deadline이 지나면 resolution을 잠근다. 기절한 참가자의 불가능한 명령을 기다리지 않으며, 사람의 포켓몬이 모두 기절하고 NPC만 남았다면 다음 명시적 heartbeat/advance에서 NPC 행동을 처리한다. 입력이 없는 사람·NPC는 저장된 battle과 seed로 서버가 `chooseRaidCommand`를 수행한다. `resolving` 상태의 20초 lease가 살아 있는 동안에는 다른 요청이 엔진 계산을 중복 실행하지 않는다. lease가 만료되면 새 claim ID가 동일 commands·seed를 인계하고, 이전 작업자는 compare-and-commit에서 거절된다.

## 재접속과 종료

`status` GET은 상태를 변경하지 않는다. 참가자는 `raidHeartbeat`와 대기실의 `roomHeartbeat`로 접속을 갱신한다. 일시 단절한 인간은 다음 마감에서 AI가 원래 개체를 대행한다. 모든 인간이 유예 시간 이후에도 부재면 `suspended`가 되고 최대 5분 동안 복구할 수 있다. 복구 기간에 재접속하면 현재 입력 또는 단계 전환 상태로 돌아가며, 잠긴 AI 명령은 해당 턴에 유지된다. 기간이 끝난 뒤 유효한 변경 요청이나 정리에서만 패배로 종료한다. 명시적 퇴장은 그 슬롯을 AI가 맡되 승리 보상 대상에서 제외한다.

종료는 `settleRun` 한 곳에서 수행한다. 결과, 수령 영수증, 최초 클리어, 사용자별 레이드 VP 합계, 포인터 해제를 같은 transaction에 기록한다. `raidRewardReceipts`와 `raidFirstClears`는 영구 보존하며, 계정 동기화의 raid-wallet watermark가 오래된 클라이언트 저장으로 이미 지급된 VP를 되돌리거나 다시 지급하지 않게 한다.

종료 run, 이벤트 청크, 사용자별 결과는 `raidExpiryIndex`에 기록한 `finishedAt + 7일` 뒤 작은 batch로 제거한다. 정리는 `raidRuns` 전체를 스캔하지 않고 만료 인덱스 후보 최대 5개만 직접 읽으며, 로비 변경과 결과 닫기 요청에서만 실행한다. turn submit·advance·heartbeat는 과거 만료 인덱스나 전역 cleanup cursor를 읽지 않는다. 영수증, 최초 클리어, 사용자 레이드 VP 누계와 wallet watermark는 제거하지 않는다. 지원하지 않는 버전, 활성 run, 잘못된 인덱스 참조는 삭제 대신 보존한다. 지원되지 않는 run이 앞에 있어도 별도 cursor가 다음 후보로 진행하므로 정상적인 뒤쪽 만료 기록을 막지 않는다.

결과 닫기 요청은 화면에 표시된 `raidId`가 현재 `lastRaidId`와 일치할 때만 허용한다. 같은 transaction에서 바로 그 7일 지난 결과가 정리되어 `lastRaidId`가 비워진 경우는 이미 닫힌 성공으로 처리한다. 다른 더 최신 결과가 있으면 이전 화면의 닫기 요청은 `STALE_RESULT`로 거절한다.

게스트 로그아웃/삭제는 기존 guest 정리 transaction에서 레이드 컬렉션도 함께 처리한다. 남은 사람의 전투를 유지하기 위해 떠난 게스트 slot은 익명 AI surrogate로 바꾸고 capture·이름·UID·결과 식별 정보를 제거한다. 게스트 영수증/최초 클리어/결과·포인터는 삭제한다.

## 안전한 상태 투영과 폴링

`getRaidBattleView`와 서비스의 `publicRoom`, `publicRunHead`, `publicEvents`는 allowlist 기반이다. 응답은 다른 참가자의 raw UID, 이메일, capture ID, seed, 전체 보유 목록, 내부 명령, 비공개 코드 hash를 포함하지 않는다. 다른 사람의 이름은 기존 마스킹 규칙으로 표시한다. 참가자가 아닌 사용자는 run·이벤트·결과를 읽을 수 없다.

클라이언트는 입력 중 1.5초, 대기실 5초, 숨은 탭 10~15초 간격으로 확인한다. 오류가 반복되면 최대 30초까지 재시도 간격을 늘리고 결과 확정 후에는 폴링을 멈춘다. `GET /api/raid?action=status&raidId=<id>&sinceRevision=<revision>&eventCursor=<cursor>`에서 `raidRunHeads.revision`이 같으면 다음처럼 battle/events 없이 `unchanged: true` 헤더만 돌려준다.

```json
{
  "raid": {
    "unchanged": true,
    "id": "...",
    "revision": 17,
    "decisionToken": "...",
    "ownCommandVersion": 2,
    "pendingSubmitted": true,
    "participants": []
  }
}
```

클라이언트는 이 헤더를 마지막 전체 battle view에 병합한다. revision이 달라질 때만 full run을 읽어 안전한 battle과 새 이벤트를 보낸다. 대기실 목록도 full `raidRooms`가 아니라 `raidRoomIndex`만 읽는다. GET은 방 만료, 턴 진행, presence 갱신, 포인터 해제를 하지 않는다.

## HTTP 경계

`api/raid.js`는 `server/raidHttp.js`의 단일 handler를 Vercel 경로에 연결한다. GET은 `catalog`, `rooms`, `raidList`, `status`만 허용한다. 나머지는 JSON POST와 인증 bearer가 필요하다.

| POST action | 핵심 입력 |
| --- | --- |
| `roomCreate` | `bossId`, `title`, `visibility`, 선택 `npcRoles` |
| `roomJoin` | 공개 `roomId` + `roomRevision`, 또는 비공개 `code` |
| `roomLeave` | `roomId`, `roomRevision` |
| `roomReady` | `roomId`, `roomRevision`, 서버 보유 `captureId`, `ready`, 선택 `npcRoles` |
| `roomHeartbeat` | `roomId`, 선택 `roomRevision` |
| `roomStart` | `roomId`, `roomRevision` |
| `raidSubmit` | `raidId`, `decisionToken`, `commandVersion`, `command` |
| `raidRevoke` | `raidId`, `decisionToken`, `commandVersion` |
| `raidAdvance` / `raidHeartbeat` | `raidId`, 선택 `decisionToken` |
| `raidWithdraw` / `raidForfeit` | `raidId`, 선택 `roomRevision` |
| `raidDismissResult` | 표시 중인 결과의 `raidId`를 포함해 결과 화면을 닫는 요청 |

HTTP handler는 body 128 KiB, method, JSON 형식, bearer, same-origin/로컬 개발 origin, 사용자별 짧은 요청량을 확인한다. 오류 응답은 내부 DB·인증·코드·battle 정보를 넣지 않는다. `RAID_ENABLED=true`여도 production store, Firebase 인증, 보유 개체 resolver를 초기화하지 못하면 메모리 저장소로 전환하지 않고 503을 반환한다.

## 로컬 검증과 운영 전 확인

현재 로컬 검증 명령은 `npm run validate:raid`와 `npm run raid:test`다. 세 보스×1/2/3인 실제 서버 여정, version/replay/lease, compact poll, HTTP 입력 경계, 보상 wallet, 전투 규칙은 각 전용 스크립트로 분리한다. 실행 결과와 운영 경계는 [raid-qa.md](raid-qa.md)에 기록한다.

운영 전에는 별도 승인된 환경에서 실제 Firebase 인증·선택된 DB 공급자·동시 transaction·cold start·세 개 독립 브라우저와 모바일 화면을 확인해야 한다. 이 저장소의 메모리 저장소 테스트와 로컬 HTTP 실행은 운영 배포·운영 데이터 지급·운영 성능 검증을 의미하지 않는다.
