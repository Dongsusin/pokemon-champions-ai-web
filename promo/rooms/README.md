# 대전방 업데이트 홍보 영상

실제 대전방 UI와 로컬 서버·배틀 엔진에서 촬영한 **92초, 1920×1080, 30fps** 업데이트 영상입니다.

## 편집 구성

- 00:00 로고·제목만 표시
- 00:04 대전방 소개 — 최대 10개 방 / 방마다 4명
- 00:10 방 만들기·비밀번호·대회 형식
- 00:22 네 명의 참가자
- 00:32 팀·선봉 선출
- 00:42 싱글배틀
- 00:54 더블배틀
- 01:06 토너먼트·부전승
- 01:15 리그전·최종 순위
- 01:24 로고·참가 안내·게임 주소

모든 화면은 고정된 구도로 촬영하며 카메라 흔들림이나 동적 확대를 넣지 않습니다. 방 만들기 장면만 중앙 모달을 일정한 1.45배 구도로 잘라 입력 항목의 가독성을 높였습니다. 장면은 0.4초 겹침 전환을 사용합니다. 큰 한국어 문구가 순차 등장한 뒤 약 3.5초에 사라져 실제 게임 조작을 보여줍니다. 작은 장면 설명·제작 문구는 영상에 넣지 않았으며, 자막은 별도 SRT로 제공합니다.

## 재생성

저장소 루트에서 `promo/node_modules`의 기존 Playwright·FFmpeg 의존성을 사용합니다. 먼저 실제 게임 화면을 촬영합니다. 캡처 스크립트가 자체 로컬 Vite·메모리 서버와 촬영 계정을 생성하고 종료하며, 운영 서버에는 접속하지 않습니다.

```powershell
node promo/rooms/capture/capture.mjs
```

`generated/footage/manifest.json`이 생성되면, 모션 렌더·미리보기에 필요한 Vite를 별도로 실행합니다.

```powershell
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5288 --strictPort
```

다른 터미널에서:

```powershell
$env:PROMO_BASE_URL = 'http://127.0.0.1:5288'
node promo/rooms/scripts/validateProject.mjs
node promo/rooms/scripts/prepareAudio.mjs
node promo/rooms/scripts/renderUpdate.mjs --reuse
node promo/rooms/scripts/writeSourceAudit.mjs
node promo/rooms/scripts/validateVideo.mjs
node promo/rooms/scripts/reviewPlayback.mjs
```

부분 렌더는 `--motion-only`, `--footage-only`, `--final-only`, `--ids=intro,rooms,outro`로 선택합니다. `--reuse`는 소스·타임라인·이미지·자막·촬영 파일의 지문이 일치하는 경우에만 캐시를 재사용합니다.

`generated/`는 Git에서 제외됩니다. 최종 파일은 `output/champions-arena-battle-rooms-update-1080p.mp4`이며, 포스터·한국어 자막·업로드용 크레딧을 함께 제공합니다. `preview.html`은 로컬 플레이어와 장면별 바로가기를 제공합니다.

## 검증과 출처

`output/validation.json`은 전체 영상·오디오 디코딩, 1080p/30fps, AAC 48kHz 스테레오, 검은 화면·무음·정지 구간과 음량을 검사합니다. `playback-validation.json`은 Chromium에서 본편 전체 재생 및 장면 이동을 검사합니다. 정지 구간 경고는 읽을 수 있도록 머무는 UI인지 컨택트 시트와 실제 장면을 검수해 판단합니다.

BGM은 현재 웹게임의 **Face The Champion! — Spring Spring**, CC BY 3.0 음원을 이어 사용합니다. 92초 발췌·페이드·음량 정규화와 직접 합성한 전환 효과음을 적용합니다. 자세한 표기는 `CREDITS.md`를 따릅니다. 음악의 라이선스가 게임 캐릭터 등 다른 자료의 권리를 허락하는 것은 아닙니다. 본 프로젝트는 비공식 팬메이드 게임입니다.

## 완성본 검증 결과

- 최종 영상: 92초 · 1920×1080 · H.264/yuv420p · 30fps · 2,760프레임
- 파일 크기: 20,196,011바이트(약20.2MB)
- 오디오: AAC 48kHz 스테레오 · −16.07 LUFS · −5.08 dBTP
- 전체 디코딩: 오류0 · 중간 검은화면0 · 중간 무음0
- Chromium 전체 재생:92초 완료 · 정지0 · 누락/손상 프레임0 · 장면별 바로가기 정상
- 자동 정지구간 경고9개는 로고·입력 완료된 모달·대진표·엔딩을 읽는 정적인 구간이며, 컨택트시트와 개별 프레임으로 확인했습니다. 배틀 액션 구간은 해당 경고가 없습니다.
- 독립 배틀 검수: 싱글 메가진화·드래곤클로·HP 감소, 더블 다이맥스·다이드라군·타격/HP 감소가 각 편집 구간에 포함됩니다.
- 배포 게임 소스19개와 촬영 당시 해시가 일치합니다. 게임 소스 변경 여부는 false, 새 촬영 entry 변경 여부는 true로 분리 기록했습니다.

SHA-256: `fc9ba4a630385379e4bd93736101acbe7f58ab484856253e1a7b5fd735fccd96`
