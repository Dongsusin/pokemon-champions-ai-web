# 채팅 기능 제거

2026-10-17 변경에서 전체 채팅 기능을 제거했습니다.

- 게임 상단 채팅 UI, 메시지 조회와 전송, 자동 폴링 및 채팅 전용 스타일을 삭제했습니다.
- 배포 API 진입점 `api/chat.js` 및 채팅 서버 모듈을 삭제했습니다.
- 계정 닉네임의 욕설 검사는 `server/nicknameModeration.js`에서 유지합니다.
- 이전 버전의 `globalChat` / `globalChatSenders` 저장 데이터는 원격에서 일괄 삭제하지 않았습니다. 게스트 계정 삭제 시 본인 기록을 지우는 코드만 `server/guestAccountCleanup.js`에 남아 있습니다.
- 계정 세션, 저장, 접속 인원 및 대전 통신은 기존 흐름을 유지합니다.

검증: `npm run validate:chat-removal`은 삭제한 모듈과 런타임 참조, 로컬 HTTP의 채팅 요청 404, 정상 대전 요청, 과거 게스트 기록 삭제를 확인합니다. 실제 게임 화면과 채팅 요청 부재는 `npm run validate:battle-factory-ui`에서 확인합니다. 이 문서와 검증만으로 실제 배포 환경 반영이나 과거 저장 데이터의 전체 삭제를 주장하지 않습니다.
