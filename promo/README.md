# Pokémon Champions Arena · 프로모션 영상

**Break the Limit** — 한국어 게임 홍보 영상, 1분 24초, 1920×1080, 16:9, 30fps MP4(H.264/AAC).

- 완성 영상: `output/champions-arena-promo-1080p.mp4`
- 표지: `output/champions-arena-promo-poster.jpg`
- 한국어 자막: `output/champions-arena-promo-ko.srt` (영상에 큰 제목과 설명이 포함되어 있으며 MP4 내부 선택 자막도 제공)
- 편집 구성과 문구: `timeline.json`
- 재생·장면 이동·다운로드 페이지: `preview.html`
- 게임 장면의 촬영 범위·출처: `FOOTAGE.md`
- 사용 음악의 출처·편집 방법: `SOUNDTRACK.md`
- 영상과 함께 배포할 음악 크레딧: `output/champions-arena-promo-credits.txt`
- 실제 포켓몬·트레이너·아이템 이미지와 문구 애니메이션: `cinematic.html`, `cinematic.css`, `cinematic.js`
- 게임 화면 위에 합성하는 제목·설명 애니메이션: `overlay.html`, `scripts/renderTrailer.mjs`
- 완성 파일 검증 결과: `output/validation.json`

## 구성

| 시간 | 내용 |
| --- | --- |
| 00:00–00:06 | 로고와 게임 제목만 등장하는 오프닝 |
| 00:06–00:14 | 실제 포켓몬 이미지 모음·주역 포켓몬 팀 소개 |
| 00:14–00:28 | 238명 전체 트레이너 이미지·대표 트레이너 전신 몽타주 |
| 00:28–00:36 | 배틀 아이템을 확대해 보여주는 오브젝트 연출 |
| 00:36–00:42 | 실제 도구 화면과 아이템 소개 |
| 00:42–00:49 | 실제 메가리자몽X·불대문자 |
| 00:49–00:55 | 실제 피카츄 Z기술·거북왕 격파 |
| 00:55–01:02 | 실제 거다이맥스 팬텀·거다이환영 |
| 01:02–01:08 | 실제 가디안 테라스탈·문포스 |
| 01:08–01:18 | 더블배틀과 불대문자 공격 |
| 01:18–01:24 | 엔딩·도전 문구 |

30초의 포켓몬·트레이너·아이템 이미지 연출, 12초의 오프닝·엔딩, 36초의 실제 배틀, 6초의 도구 화면을 편집한다. 생성 일러스트는 사용하지 않으며, 이미지 연출은 게임에 등록된 포켓몬·트레이너 스프라이트와 아이템 아이콘으로 구성한다. 포켓몬은 다양한 종의 이미지 모음과 큰 팀 소개를 교차하고, 트레이너는 전체 238명의 이미지를 먼저 한 화면에 보여준 뒤 대표 트레이너들을 여러 명씩 크게 등장시킨다.

오프닝은 로고와 게임 제목 두 줄만 표시한다. 부제·설명·버튼·상하단 문구는 제거했다. 포켓몬·트레이너·아이템 제목은 단어별로 나타나고 강조색이 이동하며, 설명은 짧은 시간차로 등장한다. 실제 게임 화면의 제목·분류·설명·태그도 별도 레이어로 나누어 이동·등장·퇴장 모션을 합성한다. 문구가 읽히도록 진입 뒤에는 안정적으로 유지한다.

도구 화면과 모든 배틀은 실제 게임 컴포넌트를 사용하는 촬영 전용 진입점에서 녹화한다. 포켓몬·트레이너 소개는 실제 게임 데이터와 스프라이트로 구성한 광고용 몽타주다. 게임 계정에 로그인하거나 사용자 저장 데이터를 변경하지 않는다. 준비된 1대1·2대2 매치를 사용하며, 배틀 결과·HP·기믹은 실제 엔진 계산으로 나온다.

음악은 현재 웹게임 대전에서 재생하는 `public/assets/audio/battle/battle-theme.ogg`를 사용한다. Spring Spring의 [“Face The Champion!”](https://opengameart.org/content/face-the-champion)이며 [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)으로 제공된다. 원음의 0–84초를 발췌하고 0.25초 페이드인, 마지막 1.75초 페이드아웃을 적용한다. 48 kHz 스테레오로 변환하고 두 번의 음량 측정을 거쳐 음악을 -18 LUFS로 조정한 뒤, 실제 게임 효과음이 나올 때 음악을 낮추어 혼합한다. 최종 믹스는 -16 LUFS를 목표로 조정한다. 실제 완성 파일 측정값은 `output/validation.json`에 기록한다.

배틀 촬영에서는 게임 음악을 음소거하고 효과음과 포켓몬 울음소리를 Web Audio 출력에서 녹음하므로, 영상 전체에 이어지는 음악과 촬영 음악이 겹치지 않는다. 이전 홍보 영상의 오리지널 전투곡은 이번 영상에 사용하지 않는다. 제목·저작자·원본 및 라이선스 링크·편집 사실은 미리보기 페이지와 별도 크레딧 파일에 표기한다. 영상 배포 시 크레딧 파일의 문구를 함께 제공한다. 비공식 팬메이드 프로젝트 표기는 유지한다.

## 재제작

저장소의 기본 의존성 설치 후, 영상 도구는 별도 디렉터리에 설치한다. 게임의 프로덕션 의존성이나 진입점은 바뀌지 않는다.

```powershell
npm install --prefix promo
npx --prefix promo playwright install chromium
node node_modules/vite/bin/vite.js --config promo/vite.config.mjs
```

다른 터미널에서 저장소 루트를 기준으로 실행한다.

```powershell
node promo/scripts/prepareWebSoundtrack.mjs
node promo/scripts/captureTrailer.mjs
node promo/scripts/renderTrailer.mjs
node promo/scripts/validateTrailer.mjs
```

장면 편집이 완료된 `promo/generated/picture-lock.mp4`가 있으면 영상 장면을 다시 렌더링하지 않고 음악만 재합성할 수 있다.

```powershell
node promo/scripts/prepareWebSoundtrack.mjs
node promo/scripts/renderTrailer.mjs --audio-only
node promo/scripts/validateTrailer.mjs
```

이전 오리지널 전투곡 생성기는 보관용이다. 별도 파일로 생성해 현재 영상의 음악 파일을 덮어쓰지 않는다.

```powershell
node promo/scripts/generateSoundtrack.mjs --out=promo/generated/original-soundtrack.wav
```

촬영 서버는 `http://127.0.0.1:5184`를 사용하며 HMR을 꺼서 파일 저장 중 장면이 초기화되지 않게 한다. 원본 영상은 브라우저의 25fps 녹화이며 최종 편집에서 30fps로 변환한다. 원본과 중간 파일은 `raw/`, `generated/`에 저장하고 Git에서 제외한다. 완성 MP4·표지·자막과 소스는 저장소에 포함한다.

배틀 촬영은 액션 직전의 단색 동기화 프레임을 자동 검출하여 영상과 Web Audio 녹음의 시작점을 맞춘다. 이 프레임은 최종 영상에 포함되지 않는다. `raw/*.json`에 검출한 시작 시각과 브라우저 오류·장면 상태가 남는다. 최종 검수용 음량 분석은 `generated/final-audio-analysis.txt`에 기록한다. 검증 스크립트는 전체 영상·오디오 디코딩, 실제 프레임 수, 동기화 프레임 누출, 음량, 파일 해시와 트레이너 이미지 로딩을 점검하고 `output/validation.json`을 갱신한다.

다른 도구 경로나 서버를 쓰려면 `PROMO_BASE_URL`, `PROMO_CHROME`, `PROMO_NODE_MODULES`, `FFMPEG_PATH` 환경변수를 설정할 수 있다. 현재 로컬 작업 환경의 번들 Playwright/Chromium도 대체 경로로 지원한다. 촬영 중 브라우저가 자동 재생하도록 설정하고, 모션 줄이기를 끈다. 장면별 재촬영은 ID를 인수로 전달한다.

```powershell
node promo/scripts/captureTrailer.mjs zmove double
```

영상 배포는 별도다. 저장소 푸시는 광고 플랫폼 업로드나 광고 집행을 수행하지 않는다.
