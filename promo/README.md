# Pokémon Champions Arena · 프로모션 영상

**Break the Limit** — 한국어 게임 홍보 영상의 최종 편집 타임라인은 **2분 12초(132초)**다. 출력 규격은 1920×1080, 16:9, 30fps MP4(H.264/AAC)이며, 렌더 완료 후 실제 파일의 길이·프레임·음량·검증 결과는 `output/validation.json`에서 확인한다.

- 완성 영상: `output/champions-arena-promo-1080p.mp4`
- 표지: `output/champions-arena-promo-poster.jpg`
- 한국어 자막: `output/champions-arena-promo-ko.srt` (큰 핵심 문구를 영상에 표시하고 MP4 내부 선택 자막도 제공)
- 편집 구성과 문구: `timeline.json`
- 재생·장면 이동·다운로드 페이지: `preview.html`
- 게임 장면의 촬영 범위·출처: `FOOTAGE.md`
- 사용 음악의 출처·편집 방법: `SOUNDTRACK.md`
- 영상과 함께 배포할 음악 크레딧: `output/champions-arena-promo-credits.txt`
- 실제 포켓몬·트레이너·아이템 이미지와 문구 애니메이션: `cinematic.html`, `cinematic.css`, `cinematic.js`
- 게임 화면 위에 합성하는 큰 제목 애니메이션: `overlay.html`, `scripts/renderTrailer.mjs`
- 기믹별 실제 배틀 구성과 3×3 화면: `gimmickVariants.mjs`, `gimmickWall.html`, `gimmickWall.css`, `gimmickWall.js`
- 완성 파일 검증 결과: `output/validation.json`

## 구성

| 시간 | 내용 | 진입 전환 (`timeline.json`) |
| --- | --- | --- |
| 00:00–00:06 | 로고와 게임 제목만 등장하는 오프닝 | 시작 페이드 |
| 00:06–00:18 | 대표 포켓몬에서 1,025종 전체 도감으로 넓어지는 이미지 벽 | `smoothup` |
| 00:18–00:32 | 238명 전체 트레이너 이미지와 대표 트레이너 전신 | `smoothleft` |
| 00:32–00:40 | 실제 128강 토너먼트 대회 준비 화면 소개 | `fade` |
| 00:40–00:48 | 실제 배틀 아이템 이미지 확대 연출 | `smoothright` |
| 00:48–00:54 | 실제 도구 화면 | `fade` |
| 00:54–01:06 | 메가진화: 하나의 배틀에서 서로 다른 9종의 배틀로 확장 | `diagbr` |
| 01:06–01:18 | Z기술: 9종 포켓몬·9가지 공격 타입 | `smoothleft` |
| 01:18–01:30 | 거다이맥스: 9종 포켓몬·전용 거다이 기술 | `diagbr` |
| 01:30–01:42 | 테라스탈: 9종 포켓몬·9가지 테라 타입 | `smoothup` |
| 01:42–01:52 | 무기절 리그·토너먼트 우승과 전체 도감 수집 도전 | `fade` |
| 01:52–02:00 | 냉동빔·스톤샤워가 이어지는 더블배틀 | `smoothleft` |
| 02:00–02:06 | 리자몽의 불대문자 공격 | `fade` |
| 02:06–02:12 | 엔딩·도전 문구·새 게임 주소 | `fade` |

1,025종 전체 포켓몬, 238명 전체 트레이너, 실제 아이템 이미지 몽타주는 유지한다. 여기에 대회 준비 화면 8초와 업적 도전 10초를 추가하고, 더블배틀은 8초, 싱글 공격은 6초로 보여준다. 더블은 13초 원본의 시작 후 2.4초부터 사용한다. 엔딩은 [pokemon-champions-area-web.co.kr](https://pokemon-champions-area-web.co.kr)로 안내한다.

오프닝은 로고와 게임 제목만 표시한다. 영상 전체의 상하단 제작 메모, 장면 분류, 작은 수치·설명 자막과 기믹 타일의 이름·기술·타입 설명줄은 제거하고 큰 핵심 제목을 남긴다. 도전 장면에는 실제 업적의 달성 조건을 보여주며 비밀 보상은 공개하지 않는다. 제목은 단어별로 등장하고, 읽는 구간에는 안정적으로 유지한다.

각 12초 기믹 장면은 중앙 배틀을 1.2초 동안 크게 보여준 뒤 약 5.6초에 걸쳐 3×3 화면으로 펼쳐진다. 주변과 모서리 영상이 차례로 나타나고, 후반에는 9개 배틀을 유지하며 카메라가 천천히 멈춘다. 각 영상의 포켓몬·기술·타입 정보는 접근성 설명과 검증용 상태에 보존한다.

대회 준비 화면·도구 화면과 모든 배틀은 실제 게임 컴포넌트를 사용하는 촬영 전용 진입점에서 녹화한다. 이번 편집은 포켓몬이 더 크고 양 진영이 가까워진 현재 배틀 구도로 기믹 원본 36개와 싱글·더블 장면을 다시 촬영해 사용한다. 포켓몬·트레이너·아이템·업적 소개는 실제 데이터와 에셋을 바탕으로 한 광고용 구성이다. 생성형 삽화나 가짜 배틀을 추가하지 않으며, 게임 계정과 사용자 저장 데이터를 변경하지 않는다. 촬영 매치는 준비된 1대1·2대2이고 배틀 결과·HP·기믹은 실제 엔진 계산으로 나온다.

음악은 현재 웹게임 대전의 `public/assets/audio/battle/battle-theme.ogg`, Spring Spring의 [“Face The Champion!”](https://opengameart.org/content/face-the-champion)을 [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)으로 사용한다. 원음의 **0–132초**를 발췌하고 0.25초 페이드인과 마지막 1.75초 페이드아웃을 적용한다. 48 kHz 스테레오로 변환하고 음악은 -18 LUFS, 효과음과 합친 최종 믹스는 -16 LUFS를 목표로 조정한다. 실제 완성 파일 측정값은 `output/validation.json`에 기록한다.

배틀 촬영에서는 게임 음악을 음소거하고 효과음과 울음소리를 Web Audio로 녹음한다. 최종 믹스에서 효과음이 나올 때 음악을 낮춘다. 음악의 제목·저작자·원본·라이선스·편집 사실과 비공식 팬메이드 안내는 미리보기 페이지와 별도 크레딧 파일에 둔다. 영상의 작은 제작 자막을 없애도 출처 표기는 유지하며, 배포할 때 크레딧 파일의 문구를 함께 제공한다.

## 재제작

14개 장면 사이의 **13개 경계**에 각각 0.4초 진입 전환을 적용한다. 위 표의 `transition`은 들어오는 장면의 전환이며, 상하·좌우 이동, 대각선, 디졸브를 구간에 맞춰 사용한다. 앞 장면에 12프레임의 여유 구간을 더해 전환은 각 챕터 시작 시각에 시작하고 전체 132초 길이·자막·BGM은 유지한다. 효과음은 같은 구간에서 교차 페이드하며 검정 페이드는 처음과 끝에만 적용한다.

포켓몬·트레이너·아이템·업적 몽타주, 타이틀, 9분할 기믹 화면은 `renderSceneFrames.mjs`에서 1/30초 간격으로 렌더링한다. 기믹 화면은 9개 영상을 해당 시각으로 이동시키고 디코딩을 기다린 뒤 프레임을 저장한다. 실시간 촬영 부하와 최종 카메라·문구 애니메이션의 프레임 간격을 분리하는 방식이다.

저장소의 기본 의존성 설치 후, 영상 도구는 별도 디렉터리에 설치한다. 게임의 프로덕션 의존성이나 진입점은 바뀌지 않는다.

```powershell
npm install --prefix promo
npx --prefix promo playwright install chromium
node node_modules/vite/bin/vite.js --config promo/vite.config.mjs
```

다른 터미널에서 저장소 루트를 기준으로 실행한다.

```powershell
node promo/scripts/prepareWebSoundtrack.mjs
node promo/scripts/validateGimmickFixtures.mjs
node promo/scripts/captureTrailer.mjs --variants
node promo/scripts/prepareGimmickClips.mjs
node promo/scripts/captureTrailer.mjs
node promo/scripts/renderSceneFrames.mjs --reuse
node promo/scripts/renderTrailer.mjs
node promo/scripts/validateSmoothness.mjs
node promo/scripts/validateTrailer.mjs
```

현재 타임라인·촬영 원본과 일치하는 `promo/generated/picture-lock.mp4`가 있을 때만 영상 장면을 다시 렌더링하지 않고 음악을 재합성할 수 있다. 이번처럼 촬영·구성·길이가 바뀌면 먼저 전체 영상 편집을 갱신한다.

```powershell
node promo/scripts/prepareWebSoundtrack.mjs
node promo/scripts/renderTrailer.mjs --audio-only
node promo/scripts/validateSmoothness.mjs
node promo/scripts/validateTrailer.mjs
```

보관 중인 이전 오리지널 전투곡 생성기는 현재 영상에 사용하지 않는다. 필요하면 별도 파일로 생성한다.

```powershell
node promo/scripts/generateSoundtrack.mjs --out=promo/generated/original-soundtrack.wav
```

촬영 서버는 `http://127.0.0.1:5184`를 사용하며 HMR을 꺼서 파일 저장 중 장면이 초기화되지 않게 한다. 실제 배틀 원본은 브라우저의 25fps 녹화이며, 광고용 카메라·텍스트·화면 구성은 정확한 30fps로 별도 렌더링한다. 원본과 중간 파일은 `raw/`, `generated/`에 저장하고 Git에서 제외한다. 완성 MP4·표지·자막과 소스는 저장소에 포함한다.

배틀 촬영은 액션 직전의 단색 동기화 프레임을 자동 검출해 영상과 Web Audio 녹음의 시작점을 맞춘다. 이 프레임은 최종 영상에서 제외하며 `raw/*.json`에 시작 시각·브라우저 오류·장면 상태를 남긴다. 검증 스크립트는 디코딩, 프레임 수, 동기화 프레임 누출, 음량, 파일 해시, 이미지·영상 로딩, 전환의 연속성을 점검한다. **최종 통과 여부는 새 렌더 후 생성된 `output/validation.json`을 기준으로 확인**하고, 음량 세부 분석은 `generated/final-audio-analysis.txt`를 참고한다.

다른 도구 경로나 서버를 쓰려면 `PROMO_BASE_URL`, `PROMO_CHROME`, `PROMO_NODE_MODULES`, `FFMPEG_PATH` 환경변수를 설정할 수 있다. 현재 로컬 작업 환경의 번들 Playwright/Chromium도 대체 경로로 지원한다. 촬영 중 브라우저가 자동 재생하도록 설정하고, 모션 줄이기를 끈다. 장면별 재촬영은 ID를 인수로 전달한다.

```powershell
node promo/scripts/captureTrailer.mjs zmove double
```

영상 배포는 별도다. 저장소 푸시는 광고 플랫폼 업로드나 광고 집행을 수행하지 않는다.
