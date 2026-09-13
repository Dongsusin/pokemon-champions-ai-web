# Champions Arena — 대전방 업데이트 영상 크레딧

이 파일의 음악 표기를 영상 업로드 설명이나 영상과 함께 제공하는 크레딧에 포함해 주세요. 영상 안에는 작은 제작 설명·크레딧 문구를 넣지 않습니다.

## 음악

- **Face The Champion! — Spring Spring**
- 원저작자 표기: **Produced by Julie Damsgaard / Spring Spring / Spring Enterprises**
- 원문: https://opengameart.org/content/face-the-champion
- 제작자: https://spring-enterprises.neocities.org
- 선택 라이선스: **Creative Commons Attribution 3.0 Unported (CC BY 3.0)** — https://creativecommons.org/licenses/by/3.0/
- 사용 파일: 현재 웹게임의 `public/assets/audio/battle/battle-theme.ogg`
- 편집: 원곡 앞부분 발췌, 0.2초 페이드 인·1.6초 페이드 아웃, 음량 정규화, 48 kHz 스테레오 변환 및 최종 영상의 효과음 믹싱.
- 이 표기는 이 프로젝트의 기존 `promo/factory/CREDITS.md`에 기록된 원곡·라이선스 정보를 이어받았습니다. 이번 영상의 발췌 길이·음량·원본 해시는 `generated/music.json`에 기록합니다.

업로드 설명에 사용할 표기:

> Music: “Face The Champion!” by Spring Spring. Produced by Julie Damsgaard / Spring Spring / Spring Enterprises (https://spring-enterprises.neocities.org). Licensed under CC BY 3.0 (https://creativecommons.org/licenses/by/3.0/). Source: https://opengameart.org/content/face-the-champion . Edited for this update trailer: excerpt, fades, loudness adjustment, resampling and procedural transition-effects mix. The music creator does not endorse this project.

## 게임 화면과 효과음

게임 화면은 이 저장소의 Champions Arena에서 촬영합니다. 실제 대전방 컴포넌트, 인증 요청 흐름, 로컬 서버와 배틀 엔진으로 방을 생성하고 여러 트레이너가 참가·선출·대전하는 과정을 녹화합니다. 촬영용 계정과 대회 데이터는 격리된 로컬 환경에만 저장되며, 운영 사용자 수나 운영 경기 결과를 나타내지 않습니다.

소개 모션은 게임에서 사용하는 로고·로비 배경과 직접 작성한 타이포그래피·도형만 사용합니다. 새로 생성한 포켓몬·트레이너 이미지는 넣지 않았습니다. 배틀 녹화본의 실제 조작 및 결과 판정 근거는 `output/source-audit.json`과 촬영 매니페스트에 기록합니다.

이번 영상의 전환 효과음 `generated/whoosh.wav`, `generated/impact.wav`, `generated/chime.wav`는 `scripts/prepareAudio.mjs`에서 노이즈 필터, 사인파와 진폭·주파수 변화를 이용해 절차적으로 합성했습니다. 외부 녹음, 상용 게임 사운드 샘플, 사운드폰트를 사용하지 않았습니다. 각각 스테레오 48 kHz, 최대 피크 −14 dBFS로 생성하고 최종 편집에 맞춰 배치합니다.

게임 화면 촬영본은 무음으로 사용하며, 연속 BGM과 위 전환 효과음을 별도로 합성합니다. 포켓몬 이름·이미지 및 관련 시청각 자료의 권리는 각 권리자에게 있습니다.

본 프로젝트는 **비공식 팬메이드 게임**입니다. Pokémon, Nintendo, GAME FREAK, Creatures 및 원저작권자와 공식적인 제휴·후원 관계가 없으며, 공식 Pokémon Champions의 광고가 아닙니다. 음악 라이선스는 포켓몬 이름·캐릭터·이미지 등 다른 자료의 권리까지 허락하는 것은 아닙니다.
