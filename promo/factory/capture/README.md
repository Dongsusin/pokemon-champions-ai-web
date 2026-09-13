# 배틀팩토리 업데이트 실기 촬영

저장소 루트에서 `node promo/factory/capture/capture.mjs`를 실행한다. 기존 `promo`의 Playwright와 ffmpeg 의존성, 로컬 Chromium을 사용한다. 결과물은 `promo/factory/generated/footage/`에 생성한다.

## 촬영 근거

- 실제 `GameApp`, `BattleFactoryScreen`, `BattleFactoryLobby`, `BattleScreen`, `BattleFactoryRankings`를 렌더링한다. 게임 소스 파일은 수정하지 않는다.
- 화면 상태만 관찰하는 Vite 응답 계측을 사용한다. 승패, HP, 전투 결과, 층수, 랭킹을 직접 만들거나 변경하지 않는다.
- 렌탈은 실제 `createFactoryRun`의 시드 `factory-promo-10`을 사용한다. 제공된 6마리 가운데 드닐레이브, 한카리아스, 칠색조를 UI에서 선택한다. 능력치와 기술 창, 선봉 선택도 실제 버튼으로 연다.
- 전투 행동은 실제 AI 판단 함수의 추천을 받아 UI에서 기술·기믹·교체 버튼을 클릭한다. 상대는 원래의 보통 난이도 AI이다.
- 첫 승리 후 드닐레이브와 방금 상대했던 샤미드를 교환한다. 다음 승리 후 교환 없이 3층으로 올라가며, 이 층에서 UI의 기권으로 도전을 마친다.
- 이 실제로 종료된 한 도전만 `reportFactoryRun` API를 통해 로컬 메모리 저장소에 기록한다. TOP 10 화면은 실제 API 응답에 있는 1개 기록을 보여준다. 10개의 참가자나 기록을 채워 넣지 않는다.
- 브라우저와 저장소는 사용자의 브라우저·계정으로부터 독립적이다. Firebase는 인증되지 않은 로컬 모듈로 대체하고, API는 루프백 주소의 실제 HTTP 처리 함수로 연결한다. 게임 이미지 읽기를 제외한 외부 요청을 차단한다. 운영 데이터에 접근하거나 쓰지 않는다.

## 산출물

`manifest.json`은 `shots` 배열에 아래 각 장면의 `video`, `image`, `duration`, `usableDuration`, `sourceVideo`, `cleanStartSeconds`를 포함한다. 각 원본은 본편 길이보다 최소 1초 길게 녹화한다. 녹색 마커가 사라진 프레임으로 원본 녹화에서 장면의 시작점을 찾아 자르므로 브라우저 시작 지연에 의존하지 않는다.

| 장면 ID | 본편 길이 | 내용 |
| --- | ---: | --- |
| rentals | 12초 | 렌탈 6마리, 상세 정보, 3마리 선택 |
| lead | 8초 | 아군·상대 팀 확인과 선봉 선택 |
| battle | 14초 | 실제 명령·기믹·공격 연출 |
| swap | 12초 | 방금 쓰러뜨린 상대의 1마리와 교환 |
| climb | 9초 | 교환 없이 다음 층, 선봉 다시 선택 |
| rankings | 12초 | TOP 10 기록, 최종 팀·도구·기술 상세 |

첫 4초는 본편의 큰 제목과 겹치지 않게 주요 선택을 기다린다. 카메라 흔들림, 화면 줌, 인위적인 HP 변화는 추가하지 않는다. 본편 텍스트·전환·BGM은 별도 렌더러가 합성한다.

전투 장면은 전체 연속 녹화에서 2턴의 실제 명령 직전부터 선택한다. 따라서 첫 준비 기술 뒤의 다이맥스·공격·HP 감소·상대 교체가 한 연속 장면에 들어간다. `markerStartSeconds`는 처음 촬영 마커 위치, `cleanStartSeconds`는 최종 사용 구간의 위치이다.

`initial-run.json`, `completed-run.json`, `local-api-state.json`, `manifest.json`의 전투 요약·명령·API 결과가 실제 렌탈 구성부터 종료된 기록까지의 출처를 보존한다. `victory-1.png`, `victory-2.png`는 엔진이 판정한 승리 화면이다. 전체 연속 원본은 `session.webm`이다.
