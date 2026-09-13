# 배틀팩토리 업데이트 홍보 영상

**1분 26초 / 1920×1080 / 30fps / H.264 + AAC 스테레오**

- 최종 영상: [champions-arena-battle-factory-update-1080p.mp4](output/champions-arena-battle-factory-update-1080p.mp4)
- 미리보기: [preview.html](preview.html) — 장면 바로가기와 영상·표지·자막 다운로드
- 업로드 설명용 음악 표기: [CREDITS.md](CREDITS.md)
- 촬영 출처: [output/source-audit.json](output/source-audit.json)
- 렌더 출처·SHA-256: [output/render.json](output/render.json)
- 파일 검증: [output/validation.json](output/validation.json)
- 브라우저 재생 검증: [output/playback-validation.json](output/playback-validation.json)
- 장면별 사실·시각 검수: [output/visual-review.json](output/visual-review.json)

배틀팩토리의 렌탈 선택부터 선봉 지정, AI 대전, 승리 후 교환, 층별 도전, TOP 10 최종 팀 조회까지 소개하는 별도 업데이트 영상입니다. 기존 전체 게임·레이팅·사용률 영상은 각 폴더에 보존합니다.

## 구성

| 시작 | 길이 | 장면 |
|---|---:|---|
| 00:00 | 5초 | 로고와 게임 제목 |
| 00:05 | 6초 | 배틀팩토리 — 선택하고. 바꾸고. 올라가라. |
| 00:11 | 12초 | 무작위 렌탈 6마리 중 함께할 3마리 선택 |
| 00:23 | 8초 | 상대 팀 확인과 선봉 직접 선택 |
| 00:31 | 14초 | 랜덤 AI 팀과 실제 3 대 3 싱글배틀 |
| 00:45 | 12초 | 승리 후 이전 상대 1마리와 아군 1마리 교환 |
| 00:57 | 9초 | 교환 없이 진행하는 선택과 다음 층 도전 |
| 01:06 | 12초 | TOP 10 랭킹과 최종 포켓몬·아이템·기술 조회 |
| 01:18 | 8초 | 당신은 몇 층까지? 게임 로고와 접속 주소 |

큰 문구가 시간차로 나타나고 사라져 실제 게임 화면을 볼 시간을 확보합니다. 장면 사이에는 0.4초 분량의 여유 영상을 겹쳐 전환합니다. 촬영 화면의 확대는 일정한 배율과 위치를 사용합니다. 첫 장면은 로고와 제목만 표시하며, 작은 상단·하단 장면 설명이나 제작 과정 문구는 추가하지 않습니다. 한국어 자막은 별도 SRT로 제공하고 MP4에 자막 트랙을 넣지 않습니다.

랭킹 장면은 최종 팀의 도구·기술을 읽기 쉽도록 1.25배 고정 확대합니다. 층 변경 때 작은 트레이너 이미지가 잠깐 다시 로딩되는 부분은 같은 촬영본의 정상 표시된 이미지 영역으로 안정화했습니다. 포켓몬, 전투 결과, 층수, 선택 버튼의 실제 동작은 그대로 담았습니다. 다이맥스와 다이어스 명중 시점에는 촬영에서 확인한 시간에 맞춰 합성 효과음을 배치했습니다.

## 기능과 촬영 출처

촬영 대상 구현은 `src/data/battleFactory.js`, `src/BattleFactoryLobby.jsx`, `src/BattleFactoryRankings.jsx`입니다. 렌탈 6마리 중 3마리를 고르고 매 층 선봉 1마리를 직접 지정합니다. 무작위 3마리로 구성된 AI 팀에 승리하면 직전 상대 포켓몬 1마리와 아군 1마리를 교환하거나, 교환 없이 다음 층으로 진행할 수 있습니다.

팩토리 랭킹은 최고 도달 층수 순으로 최대 10개를 보여주며, 같은 층수에서는 먼저 기록한 순으로 정렬합니다. 전체 트레이너 랭킹에는 트레이너별 최고 기록 1개가 표시됩니다. 기록을 펼치면 도전 종료 시 최종 렌탈 팀의 포켓몬·지닌 도구·기술을 확인할 수 있습니다.

촬영은 실제 컴포넌트와 배틀 엔진을 사용하는 격리된 로컬 환경에서 진행합니다. 영상 속 도전과 랭킹은 촬영용 플레이 기록이며 운영 서비스 전체의 실제 순위·이용자 수를 나타내지 않습니다. 촬영 결과와 재현에 필요한 출처는 `output/source-audit.json`을 확인합니다. 운영 계정·게임 데이터에 촬영 기록을 쓰지 않습니다.

음악은 현재 웹게임의 `public/assets/audio/battle/battle-theme.ogg`, Spring Spring의 **Face The Champion!**입니다. CC BY 3.0 출처·제작자 표기와 발췌·페이드·음량 조정 내역은 [CREDITS.md](CREDITS.md)에 있습니다. 전환 효과음은 `scripts/prepareAudio.mjs`에서 직접 합성합니다. 게임 화면의 촬영 오디오는 사용하지 않고 BGM을 연속으로 믹싱합니다.

## 다시 만들기

저장소 루트에서 루트·영상 의존성을 설치합니다. Playwright Chromium은 기존 `promo/scripts/browserRuntime.mjs`의 탐색 규칙을 사용합니다.

```powershell
npm ci
npm --prefix promo ci
```

첫 터미널에서 모션·미리보기 서버를 실행합니다.

```powershell
node node_modules/vite/bin/vite.js --config promo/vite.config.mjs
```

두 번째 터미널에서 촬영과 합성을 실행합니다. 촬영 스크립트는 메모리 저장소와 별도 로컬 서버를 자동으로 준비하며, 기본 촬영 포트는 5279입니다.

```powershell
node promo/factory/capture/capture.mjs
node promo/factory/scripts/prepareAudio.mjs
node promo/factory/scripts/renderUpdate.mjs --reuse
node promo/factory/scripts/validateVideo.mjs
node promo/factory/scripts/reviewPlayback.mjs
```

미리보기 주소: `http://127.0.0.1:5184/promo/factory/preview.html`

부분 렌더:

```powershell
node promo/factory/scripts/renderUpdate.mjs --motion-only --reuse
node promo/factory/scripts/renderUpdate.mjs --footage-only --ids=rentals,lead,battle,swap,climb,rankings
node promo/factory/scripts/renderUpdate.mjs --final-only --reuse
```

`generated/`는 Git에서 제외되는 촬영 원본과 중간 렌더 폴더입니다. 장면별 입력 해시가 일치하는 경우 `--reuse`로 중간 영상을 재사용합니다. 최종 MP4와 표지·자막·크레딧·검증 결과는 `output/`에 보관합니다. 원격 스프라이트의 응답이나 UI 대기 시간에 따라 재촬영 화면은 달라질 수 있습니다.

## 검수

`validateVideo.mjs`는 길이·해상도·프레임 속도와 전체 디코드, 프레임 수, 음량·피크, 중간 검은 화면·무음 구간을 검사합니다. 정보 화면은 읽을 시간을 위해 머무를 수 있어 정지 구간 경고는 별도 시각 검수로 판단합니다. `reviewPlayback.mjs`는 격리된 Chromium에서 전체 86초를 재생하고 실제 미리보기의 장면 바로가기를 확인합니다.

검증 JSON은 실행한 검사와 실제 결과를 기록합니다. 콘택트 시트·장면 샘플을 통한 문구와 잘림 확인, 전체 재생 검증은 파일 자동 검사와 구분합니다. 자동 검사만으로 모든 기기의 시청 경험을 보장하지 않습니다.
