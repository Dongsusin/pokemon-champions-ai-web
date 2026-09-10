# Pokémon Champions Arena · 프로모션 영상

**Choose Your Moment** — 한국어 게임 홍보 영상, 1분 36초, 1920×1080, 16:9, 30fps MP4(H.264/AAC).

- 완성 영상: `output/champions-arena-promo-1080p.mp4`
- 표지: `output/champions-arena-promo-poster.jpg`
- 한국어 자막: `output/champions-arena-promo-ko.srt` (영상에 큰 제목과 설명이 포함되어 있으며 MP4 내부 선택 자막도 제공)
- 편집 구성과 문구: `timeline.json`
- 재생·장면 이동·다운로드 페이지: `preview.html`
- 게임 장면의 촬영 범위·출처: `FOOTAGE.md`
- 오리지널 음악의 편곡·출처: `SOUNDTRACK.md`

## 구성

| 시간 | 내용 |
| --- | --- |
| 00:00–00:03 | 실제 메가진화·Z기술·거다이맥스 배틀 하이라이트 |
| 00:03–00:08 | 게임 타이틀과 슬로건 |
| 00:08–00:24 | 포켓몬 박스와 팀 구성·테라타입 설정 |
| 00:24–00:38 | 238명의 AI 트레이너 소개와 실제 대회 화면 |
| 00:38–00:50 | 344종의 도구, 지닌 도구·기믹 아이템 |
| 00:50–01:20 | 메가리자몽X, 피카츄 Z기술, 거다이맥스 팬텀, 테라스탈 가디안 |
| 01:20–01:30 | 더블배틀과 불대문자 공격 |
| 01:30–01:36 | 엔딩·도전 문구 |

포켓몬 박스·도구·대회와 모든 배틀은 실제 게임 컴포넌트를 사용하는 촬영 전용 진입점에서 녹화한다. 트레이너 소개만 실제 게임 데이터와 스프라이트로 구성한 광고용 몽타주이며 화면에도 이를 표시한다. 게임 계정에 로그인하거나 사용자 저장 데이터를 변경하지 않는다. 준비된 1대1·2대2 매치를 사용하며, 배틀 결과·HP·기믹은 실제 엔진 계산으로 나온다.

실제 게임 효과음을 Web Audio 출력에서 녹음해 오리지널 96초 음악과 혼합했다. 게임 BGM은 중복되지 않게 끄고, 최종 믹스는 효과음에 맞춰 음악을 낮춘 후 -16 LUFS를 목표로 조정한다. 포켓몬 테마 음악을 복제하지 않았다. 영상 내 비공식 팬메이드 프로젝트 표기를 유지한다.

## 재제작

저장소의 기본 의존성 설치 후, 영상 도구는 별도 디렉터리에 설치한다. 게임의 프로덕션 의존성이나 진입점은 바뀌지 않는다.

```powershell
npm install --prefix promo
npx --prefix promo playwright install chromium
node node_modules/vite/bin/vite.js --config promo/vite.config.mjs
```

다른 터미널에서 저장소 루트를 기준으로 실행한다.

```powershell
node promo/scripts/generateSoundtrack.mjs
node promo/scripts/captureTrailer.mjs
node promo/scripts/renderTrailer.mjs
```

촬영 서버는 `http://127.0.0.1:5184`를 사용하며 HMR을 꺼서 파일 저장 중 장면이 초기화되지 않게 한다. 원본 영상은 브라우저의 25fps 녹화이며 최종 편집에서 30fps로 변환한다. 원본과 중간 파일은 `raw/`, `generated/`에 저장하고 Git에서 제외한다. 완성 MP4·표지·자막과 소스는 저장소에 포함한다.

배틀 촬영은 액션 직전의 단색 동기화 프레임을 자동 검출하여 영상과 Web Audio 녹음의 시작점을 맞춘다. 이 프레임은 최종 영상에 포함되지 않는다. `raw/*.json`에 검출한 시작 시각과 브라우저 오류·장면 상태가 남는다. 최종 검수용 음량 분석은 `generated/final-audio-analysis.txt`에 기록한다.

다른 도구 경로나 서버를 쓰려면 `PROMO_BASE_URL`, `PROMO_CHROME`, `PROMO_NODE_MODULES`, `FFMPEG_PATH` 환경변수를 설정할 수 있다. 현재 로컬 작업 환경의 번들 Playwright/Chromium도 대체 경로로 지원한다. 촬영 중 브라우저가 자동 재생하도록 설정하고, 모션 줄이기를 끈다. 장면별 재촬영은 ID를 인수로 전달한다.

```powershell
node promo/scripts/captureTrailer.mjs zmove double
```

영상 배포는 별도다. 저장소 푸시는 광고 플랫폼 업로드나 광고 집행을 수행하지 않는다.
