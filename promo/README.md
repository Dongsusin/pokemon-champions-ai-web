# Pokémon Champions Arena · 프로모션 영상

**Break the Limit** — 한국어 게임 홍보 영상, 1분 24초, 1920×1080, 16:9, 30fps MP4(H.264/AAC).

- 완성 영상: `output/champions-arena-promo-1080p.mp4`
- 표지: `output/champions-arena-promo-poster.jpg`
- 한국어 자막: `output/champions-arena-promo-ko.srt` (영상에 큰 제목과 설명이 포함되어 있으며 MP4 내부 선택 자막도 제공)
- 편집 구성과 문구: `timeline.json`
- 재생·장면 이동·다운로드 페이지: `preview.html`
- 게임 장면의 촬영 범위·출처: `FOOTAGE.md`
- 오리지널 음악의 편곡·출처: `SOUNDTRACK.md`
- 실제 트레이너·아이템 이미지의 빛·입자·텍스트 연출: `cinematic.html`, `cinematic.css`, `cinematic.js`
- 완성 파일 검증 결과: `output/validation.json`

## 구성

| 시간 | 내용 |
| --- | --- |
| 00:00–00:06 | 기존 엔딩과 같은 게임 로고·로비 배너 |
| 00:06–00:14 | 실제 포켓몬 박스·팀 구성 화면 |
| 00:14–00:28 | 238명 전체 트레이너 이미지·대표 트레이너 전신 몽타주 |
| 00:28–00:36 | 배틀 아이템을 확대해 보여주는 오브젝트 연출 |
| 00:36–00:42 | 실제 도구 화면과 아이템 소개 |
| 00:42–00:49 | 실제 메가리자몽X·불대문자 |
| 00:49–00:55 | 실제 피카츄 Z기술·거북왕 격파 |
| 00:55–01:02 | 실제 거다이맥스 팬텀·거다이환영 |
| 01:02–01:08 | 실제 가디안 테라스탈·문포스 |
| 01:08–01:18 | 더블배틀과 불대문자 공격 |
| 01:18–01:24 | 엔딩·도전 문구 |

22초의 트레이너·아이템 이미지 연출, 12초의 오프닝·엔딩 배너, 36초의 실제 배틀, 14초의 게임 UI를 편집한다. 이전 버전에서 추가한 포켓몬 대치·파트너·라이벌·기믹 각성 생성 일러스트 네 장과 해당 장면은 제거했다. 현재 이미지 연출에는 게임에 등록된 실제 트레이너 전신 스프라이트와 아이템 아이콘을 사용한다. 트레이너 소개는 전체 238명의 이미지를 먼저 한 화면에 보여준 뒤 대표 트레이너들을 여러 명씩 크게 함께 등장시킨다.

포켓몬 박스·도구와 모든 배틀은 실제 게임 컴포넌트를 사용하는 촬영 전용 진입점에서 녹화한다. 트레이너 소개는 실제 게임 데이터와 스프라이트로 구성한 광고용 몽타주다. 게임 계정에 로그인하거나 사용자 저장 데이터를 변경하지 않는다. 준비된 1대1·2대2 매치를 사용하며, 배틀 결과·HP·기믹은 실제 엔진 계산으로 나온다.

음악은 160 BPM의 오리지널 전투곡이다. 빠른 현악·신스 리프, 디스토션 저음, 강한 킥·스네어·톰·금속 타격을 유지하면서 84초에 맞춰 편집했다. 42초 기믹 시작에 강하게 전개하고, 더블 배틀은 리듬을 이어가며 고조한다. 실제 게임 효과음을 Web Audio 출력에서 녹음해 혼합했으며, 최종 믹스는 -16 LUFS를 목표로 조정한다. 포켓몬 테마 음악을 복제하지 않았다. 영상 내 비공식 팬메이드 프로젝트 표기를 유지한다.

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
node promo/scripts/validateTrailer.mjs
```

촬영 서버는 `http://127.0.0.1:5184`를 사용하며 HMR을 꺼서 파일 저장 중 장면이 초기화되지 않게 한다. 원본 영상은 브라우저의 25fps 녹화이며 최종 편집에서 30fps로 변환한다. 원본과 중간 파일은 `raw/`, `generated/`에 저장하고 Git에서 제외한다. 완성 MP4·표지·자막과 소스는 저장소에 포함한다.

배틀 촬영은 액션 직전의 단색 동기화 프레임을 자동 검출하여 영상과 Web Audio 녹음의 시작점을 맞춘다. 이 프레임은 최종 영상에 포함되지 않는다. `raw/*.json`에 검출한 시작 시각과 브라우저 오류·장면 상태가 남는다. 최종 검수용 음량 분석은 `generated/final-audio-analysis.txt`에 기록한다. 검증 스크립트는 전체 영상·오디오 디코딩, 실제 프레임 수, 동기화 프레임 누출, 음량, 파일 해시와 트레이너 이미지 로딩을 점검하고 `output/validation.json`을 갱신한다.

다른 도구 경로나 서버를 쓰려면 `PROMO_BASE_URL`, `PROMO_CHROME`, `PROMO_NODE_MODULES`, `FFMPEG_PATH` 환경변수를 설정할 수 있다. 현재 로컬 작업 환경의 번들 Playwright/Chromium도 대체 경로로 지원한다. 촬영 중 브라우저가 자동 재생하도록 설정하고, 모션 줄이기를 끈다. 장면별 재촬영은 ID를 인수로 전달한다.

```powershell
node promo/scripts/captureTrailer.mjs zmove double
```

영상 배포는 별도다. 저장소 푸시는 광고 플랫폼 업로드나 광고 집행을 수행하지 않는다.
