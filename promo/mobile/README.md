# 모바일 최적화 업데이트 홍보 영상

실제 게임을 **932×430 가로 휴대폰 뷰포트**에서 그대로 실행해 촬영한 **102초, 1920×1080, 30fps** 업데이트 영상입니다. 촬영본은 1400×646 크기의 휴대폰 화면으로 1080p 화면 안에 합성합니다.

## 편집 구성

- 00:00 로고·게임 제목
- 00:04 모바일 최적화 — 가로 모드, 한 화면에 전부
- 00:10 가로 모드 로비
- 00:18 뽑기 — 확률표 버튼과 툴팁
- 00:30 박스 · 팀 편성
- 00:40 트레이닝 — 기술 이름 우선
- 00:50 모드 선택 — 싱글/더블, 토너먼트/리그전, 난이도
- 00:59 배틀 준비
- 01:08 싱글배틀 — 줄어든 체력 카드와 2×2 커맨드
- 01:21 더블배틀 — 네 마리와 체력·기술 정보
- 01:34 로고·참가 안내·게임 주소

모든 화면은 고정된 구도로 촬영하며 카메라 흔들림이나 동적 확대를 넣지 않습니다. 장면은 0.4초 겹침 전환을 사용합니다. 큰 한국어 문구가 순차 등장한 뒤 약 3.4초에 사라져 실제 게임 조작을 보여줍니다. 작은 장면 설명·제작 문구는 영상에 넣지 않았으며, 자막은 별도 SRT로 제공합니다.

## 재생성

저장소 루트에서 `promo/node_modules`의 기존 Playwright·FFmpeg 의존성을 사용합니다. 먼저 실제 게임 화면을 촬영합니다. 촬영 스크립트가 `scripts/startPokemonUsageTest.mjs` 로컬 서버를 직접 띄우고 종료하며, 운영 서버에는 접속하지 않습니다.

```powershell
node promo/mobile/capture/capture.mjs
```

`generated/footage/manifest.json`이 생성되면, 모션 렌더·미리보기에 필요한 Vite를 별도로 실행합니다.

```powershell
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5288 --strictPort
```

다른 터미널에서:

```powershell
$env:PROMO_BASE_URL = 'http://127.0.0.1:5288'
node promo/mobile/scripts/validateProject.mjs
node promo/mobile/scripts/prepareAudio.mjs
node promo/mobile/scripts/renderUpdate.mjs --reuse
node promo/mobile/scripts/writeSourceAudit.mjs
node promo/mobile/scripts/validateVideo.mjs
node promo/mobile/scripts/reviewPlayback.mjs
```

부분 렌더는 `--motion-only`, `--footage-only`, `--final-only`, `--ids=intro,lobby,outro`로 선택합니다. `--reuse`는 소스·타임라인·이미지·자막·촬영 파일의 지문이 일치하는 경우에만 캐시를 재사용합니다.

`generated/`는 Git에서 제외됩니다. 최종 파일은 `output/champions-arena-mobile-update-1080p.mp4`이며, 포스터·한국어 자막·업로드용 크레딧을 함께 제공합니다. `preview.html`은 로컬 플레이어와 장면별 바로가기를 제공합니다.

## 휴대폰 화면 합성

`frame.html`이 배경과 베젤 두 장의 1920×1080 레이어를 만듭니다. 촬영본은 `x:260, y:368, 1400×646` 창에 그대로 확대해 넣고, 베젤을 그 위에 올려 둥근 모서리를 가립니다. 화면 안의 내용을 잘라내거나 합성해 바꾸지 않으며, 932×430 원본을 1.502배로 확대만 합니다.

## 검증과 출처

`output/validation.json`은 전체 영상·오디오 디코딩, 1080p/30fps, AAC 48kHz 스테레오, 검은 화면·무음·정지 구간과 음량을 검사합니다. `playback-validation.json`은 Chromium에서 본편 전체 재생 및 장면 이동을 검사합니다. 정지 구간 경고는 읽을 수 있도록 머무는 UI인지 컨택트 시트와 실제 장면을 검수해 판단합니다.

BGM은 현재 웹게임의 **Face The Champion! — Spring Spring**, CC BY 3.0 음원을 이어 사용합니다. 102초 발췌·페이드·음량 정규화와 직접 합성한 전환 효과음을 적용합니다. 자세한 표기는 `CREDITS.md`를 따릅니다. 음악의 라이선스가 게임 캐릭터 등 다른 자료의 권리를 허락하는 것은 아닙니다. 본 프로젝트는 비공식 팬메이드 게임입니다.

## 완성본 검증 결과

- 최종 영상: 102초 · 1920×1080 · H.264/yuv420p · 30fps · 3,060프레임
- 파일 크기: 16,655,815바이트(약 16.7MB)
- 오디오: AAC 48kHz 스테레오 · −16.07 LUFS · −4.83 dBTP
- 전체 디코딩: 오류 0 · 중간 검은화면 0 · 중간 무음 0
- Chromium 전체 재생: 102초 완료 · 오류 0 · 장면별 바로가기 정상
- 촬영 8장면 전부 `data-mobile-layout="landscape"`에서 기록되었음을 촬영 시점에 확인했습니다.
- 자동 정지구간 경고 7개는 로고·읽는 구간의 정적인 UI이며, 컨택트 시트로 확인했습니다.
- 촬영 중 게임 소스 해시가 변경되지 않았음을 확인했습니다.

SHA-256: `667ba7fb0ef4f9614b98a9d2b10583850da80d7b5de6018c04dfc335085fb635`
