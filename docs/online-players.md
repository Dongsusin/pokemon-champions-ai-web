# 현재 플레이 중인 유저

메인 로비의 로고 오른쪽에서 서버에 접속 중인 계정 수를 표시한다. Google 계정과 Firebase 익명 게스트를 모두 포함한다. UID당 하나인 기존 로그인 세션을 집계하므로 같은 계정의 중복 창은 추가 인원으로 세지 않는다. 배틀이나 다른 메뉴를 이용 중인 유저도 포함한다.

서버는 Supabase/PostgreSQL `account` 네임스페이스의 `sessions` 중 서버 시각 기준 `expiresAt`이 지나지 않은 행을 `COUNT`한다. 전체 유저 목록이나 개인정보를 브라우저로 보내지 않는다. 기존 로그인 획득/20초 간격 heartbeat 응답의 선택 필드 `onlinePlayers`에 `{ count, sampledAt, staleAfterMs }`를 추가하므로 별도 요청·접속 기록 쓰기·실시간 연결을 만들지 않는다.

집계는 세션 트랜잭션 커밋 후 별도 읽기로 실행한다. `SERIALIZABLE` 세션 갱신과 전체 집계의 경합을 피한다. 집계 쿼리는 2초 제한이며, 서비스 인스턴스마다 결과/실패를 15초 캐시하고 동시 조회를 합친다. 집계에 실패해도 로그인·게임 저장·세션 갱신은 정상 처리한다.

정상 종료/로그아웃 시 기존 세션을 해제한다. 종료 요청이 전달되지 않은 경우 마지막 갱신 후 90초 만료 기준으로 제외된다. 다른 유저의 화면에는 다음 집계·heartbeat 응답 때 반영되므로 숫자는 약간 지연될 수 있다. 백그라운드 탭도 heartbeat가 유지되는 동안 접속 중이다.

클라이언트는 수신한 숫자를 메모리에서만 보관한다. 서버가 알려준 남은 유효 시간(최대 60초)이 지나거나 로그아웃·오프라인·계정 전환이 발생하면 무효화한다. 응답 누락/오류, 서버와 연결하지 않는 로컬 게스트에서는 숫자 대신 `—명`과 확인 중 안내를 표시한다. UI 표시 문제로 정상 로그인 세션을 끊지 않는다.

검증:

```powershell
npm run validate:online-players
npm run validate:online-players-ui
node scripts/validateAccountSession.mjs --supabase
npm run validate:account-api
npm run validate:postgres-store
npm run build
```
