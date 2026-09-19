# 보스전 홍보 영상

95초 / 1920×1080 / 30fps / H.264 + AAC 스테레오.

최종 영상은 `output/champions-arena-boss-battle-1080p.mp4`, 미리보기는 `preview.html`입니다. 같은 폴더에 표지, 한국어 SRT, 업로드용 크레딧과 검증 기록을 제공합니다.

| 시작 | 장면 |
|---|---|
| 00:00 | 게임 로고 |
| 00:05 | 세 개의 전설, 보스전 |
| 00:12 | 뮤츠·칠색조·루기아 선택 |
| 00:22 | 6마리 팀 준비 |
| 00:31 | 로사·로이 더블배틀 |
| 00:44 | 비주기 싱글배틀 |
| 00:54 | 뮤츠 최종전 |
| 01:06 | 칠색조 최종전 |
| 01:16 | 루기아 최종전 |
| 01:26 | 접속 안내 |

기존 배틀팩토리·대전방 영상의 큰 한국어 문구, 로고, BGM과 전환 효과음 스타일을 이어갑니다. 안내 문구는 각 플레이 장면 초반에만 나타났다 사라집니다. 한국어 자막은 선택해서 쓸 수 있는 별도 SRT입니다.

실제 게임 컴포넌트와 전투 엔진을 로컬 촬영 환경에서 실행했습니다. 선택한 팀과 후반 라운드의 시작 상태는 촬영용으로 구성했으며, 완주하거나 보상을 얻은 실황으로 표현하지 않습니다. 보스 변신과 소환 장면은 시작 HP를 조정한 후 실제 엔진의 이벤트와 기술 처리로 촬영합니다. 구체적인 촬영 조건은 `output/source-audit.json`과 촬영 스크립트에 기록합니다.

현재 구현 근거: `src/RaidScreen.jsx`, `src/data/bossChallenge.js`, `src/data/raidPolicy.js`, `src/data/bossChallengeLoadouts.js`. 1라운드는 더블, 2·3라운드는 싱글입니다. 1→2라운드는 회복하며 2→3라운드는 남은 HP와 기절 상태를 계승합니다.

## 재현

저장소 루트에서 기존 프로젝트와 promo 의존성을 설치한 뒤 진행합니다.

```powershell
node node_modules/vite/bin/vite.js --config promo/vite.config.mjs --port 5186
```

별도 터미널:

```powershell
$env:PROMO_BASE_URL='http://127.0.0.1:5186'
$env:PROMO_CHROME='C:\Program Files\Google\Chrome\Application\chrome.exe'
node promo/boss/capture/capture.mjs
node promo/boss/scripts/prepareAudio.mjs
node promo/boss/scripts/renderUpdate.mjs --reuse
node promo/boss/scripts/validateVideo.mjs
node promo/boss/scripts/reviewPlayback.mjs
```

미리보기 주소: `http://127.0.0.1:5186/promo/boss/preview.html`.

`generated/`에는 촬영 원본과 중간 렌더가 저장되며 Git에서 제외됩니다. 최종 산출물, 재현 스크립트, 음악 표기는 이 폴더에 보관합니다. 파일 검증은 길이·해상도·프레임·전체 디코드·무음·검은 화면·음량을 검사하며, 별도 재생 검증은 브라우저 전체 재생과 장면 이동을 확인합니다. 시각 검수 기록은 실제 장면 샘플을 확인한 뒤 남깁니다.
