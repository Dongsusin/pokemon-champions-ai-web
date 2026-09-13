# 레이팅 · 사용률 업데이트 홍보 영상

**1분 41초 / 1920×1080 / 30fps / H.264 + AAC 스테레오**

- 최종 영상: [champions-arena-update-ranked-usage-1080p.mp4](output/champions-arena-update-ranked-usage-1080p.mp4)
- 미리보기: [preview.html](preview.html) — 장면 이동, 영상·표지·자막 다운로드
- 업로드 설명용 음악 표기: [CREDITS.md](CREDITS.md)
- 기계 검증: [output/validation.json](output/validation.json)
- 브라우저 전체 재생: [output/playback-validation.json](output/playback-validation.json)
- 실제 촬영·통계 증거: [output/source-audit.json](output/source-audit.json)
- 렌더 출처·SHA-256: [output/render.json](output/render.json)

기존 `promo/output/`의 전체 게임 홍보 영상은 그대로 보존합니다. 이번 영상은 레이팅 배틀과 포켓몬·아이템 사용률 기능을 소개하는 별도 업데이트 영상입니다. 게임 소스와 운영 배포 설정은 변경하지 않습니다.

## 내용

| 시작 | 장면 |
|---|---|
| 00:00 | 로고와 게임 제목만 등장 |
| 00:05 | 레이팅 배틀 업데이트 타이틀 |
| 00:10 | 실제 UI의 레이팅 로비·팀 선택 |
| 00:20 | 몬스터볼 → 슈퍼볼 → 하이퍼볼 → 마스터볼 |
| 00:28 | 상대 팀을 보고 출전 포켓몬 선출 |
| 00:36 | 싱글배틀 실제 턴 |
| 00:48 | 더블배틀 실제 턴 |
| 01:01 | 승리·RP·VP 결과 |
| 01:06 | 포켓몬·아이템 통계 타이틀 |
| 01:11 | 대전별 사용률과 인기 아이템 TOP 3 |
| 01:21 | 장착창의 인기 도구 추천·선택 |
| 01:29 | 시작 50,000 VP · 배틀 보상 2배 |
| 01:34 | 게임 로고와 접속 주소 |

각 장면의 큰 두 줄 문구는 시간차로 나타나고 약 3.7초 후 사라집니다. 사용률과 장착 화면에는 점진적인 확대를 적용했습니다. 12개 전환은 0.4초의 여유 영상을 겹쳐 연결합니다. 중간에 검은 화면을 끼워 넣지 않습니다. 초반·마지막만 의도적으로 페이드합니다.

작은 상단·하단 장면 설명, 제작 과정 문구, 업적 소개, 생성형 이미지 삽입은 없습니다. 원래 게임 UI에 표시되는 글자는 실제 화면의 일부입니다. 한국어 자막은 별도 SRT로만 제공합니다. MP4에는 자막 트랙을 넣지 않아 플레이어 설정 때문에 하단에 작은 글씨가 추가로 뜨지 않습니다.

## 촬영 출처

게임 기준 커밋은 `3b15db6084c7348a6989c3bd76576fb4d1bc0ece`입니다. `capture/entry.jsx`는 실제 `GameApp`과 스타일을 사용합니다. `capture/capture.mjs`는 메모리 저장소를 사용하는 격리된 로컬 레이팅 서버와 두 테스트 계정으로 매칭·선출·명령 선택·정산을 수행합니다.

통계는 해당 로컬 대전의 실제 선출 기록과 아이템으로 생성됩니다. 임의의 집계 수치나 `createDemoUsageSnapshot`을 삽입하지 않습니다. 촬영용 팀·소지품·잔액만 로컬 계정에 준비합니다. 이 수치는 운영 서비스 전체 유저의 현재 사용률이나 이용 규모를 나타내지 않습니다. 촬영 과정에서 운영 API와 Firestore에 기록하지 않습니다.

배너·엠블럼은 기존 게임 자산, 타이틀에 사용한 포켓몬·도구 이미지는 `assets/manifest.json`의 출처·해시를 따릅니다. 음악은 실제 게임의 `battle-theme.ogg`이며, 크레딧과 편집 내용은 [CREDITS.md](CREDITS.md)에 있습니다. 전환 효과음은 로컬에서 직접 합성합니다.

## 다시 만들기

저장소 루트에서 실행합니다. 루트 의존성과 `promo/` 의존성을 설치하고 Playwright가 사용할 Chromium을 준비해야 합니다. 기존 `promo/scripts/browserRuntime.mjs`의 브라우저 탐색 규칙을 사용합니다.

```powershell
npm ci
npm --prefix promo ci
```

첫 터미널에서 미리보기·모션 서버를 시작합니다.

```powershell
node node_modules/vite/bin/vite.js --config promo/vite.config.mjs
```

두 번째 터미널에서 촬영, 음원 준비, 장면 렌더, 최종 합성을 실행합니다.

```powershell
node promo/update/capture/capture.mjs
node promo/update/capture/capture.mjs --normal-result
node promo/update/scripts/prepareAudio.mjs
node promo/update/scripts/renderUpdate.mjs --reuse
node promo/update/scripts/validateVideo.mjs
node promo/update/scripts/reviewPlayback.mjs
```

원본 촬영은 실제 UI·원격 공개 스프라이트의 로딩을 기다리므로 상황에 따라 시간이 걸립니다. 실패 시 출력된 단계와 `generated/footage/`의 캡처·실패 기록을 확인합니다. 촬영 중 원래 게임 UI나 검증 규칙을 우회해서 화면을 만들지 않습니다.

미리보기 주소: `http://127.0.0.1:5184/promo/update/preview.html`

부분 렌더:

```powershell
node promo/update/scripts/renderUpdate.mjs --motion-only --reuse
node promo/update/scripts/renderUpdate.mjs --footage-only --ids=usage,equipment
node promo/update/scripts/renderUpdate.mjs --final-only --reuse
```

`generated/`는 Git에서 제외되는 원본·중간 렌더 폴더입니다. 재촬영하면 로컬 시각·명령 대기·통계 표본에 따라 실제 화면이 달라질 수 있습니다. 최종 영상과 표지·크레딧·검증 결과는 `output/`에 보관합니다.

## 검수

`validateVideo.mjs`는 60–120초 길이, 1080p/30fps, 전체 영상·오디오 디코드, 프레임 수, 음량·피크, 중간 검은 화면·무음 구간을 검사합니다. 긴 정지 화면은 경고로 남깁니다. 데이터 화면은 읽을 시간을 위해 정지할 수 있으므로 경고만으로 오류로 처리하지 않습니다. 콘택트 시트와 실제 브라우저 재생으로 문구·전환·재생 품질을 별도 확인해야 합니다.

브라우저 검사는 격리된 Chromium에서 101초 전체를 무음 재생하고 36·71·81·94초 바로가기를 확인합니다. 탐색 중 이전 미디어 범위 요청이 취소되는 `ERR_ABORTED`는 별도 기록하며 영상 디코드 실패와 구분합니다.

검증 JSON의 `review`와 추가 검수 기록은 실제로 확인한 범위만 나타냅니다. 자동 검사만으로 시청 경험 전체를 보장하지 않습니다.
